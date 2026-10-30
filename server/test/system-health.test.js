'use strict';

// Settings → System health: what the owner is told about the machine and the data. Run with:  node --test server/test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { boot } = require('./support.js');
const { warningsFor, VERSION } = require('../health.js');
const { verifyCopy } = require('../db.js');
const pkg = require('../../package.json');

const HOUR = 60 * 60 * 1000;
const folder = (over = {}) => ({ path: '/data/backups', kind: 'main', count: 3, at: Date.now() - HOUR, stale: false, error: null, check: { ok: true, orders: 5 }, offDisk: false, ...over });
const base = (over = {}) => ({ backup: { folders: [folder()], safe: true }, disk: { free: 50 * 1024 ** 3, total: 200 * 1024 ** 3 }, demoUsers: [], ...over });
const codes = w => w.map(x => x.code);

test('an owner with healthy backups, free disk and own PINs sees no warnings', () => {
  assert.deepEqual(warningsFor(base()), []);
});

test('each problem is reported once, in plain words, worst first', () => {
  assert.deepEqual(codes(warningsFor(base({ backup: { folders: [folder({ count: 0, at: null, stale: true, check: null })], safe: false } }))), ['no-backup', 'same-disk']);

  const old = warningsFor(base({ backup: { folders: [folder({ stale: true, at: Date.now() - 60 * HOUR })], safe: true } }));
  assert.deepEqual(codes(old), ['backup-old']);
  assert.match(old[0].text, /3 days old/);

  const damaged = warningsFor(base({ backup: { folders: [folder({ check: { ok: false, error: 'Damaged (page 3)' } })], safe: true } }));
  assert.equal(damaged[0].level, 'error');
  assert.equal(damaged[0].code, 'backup-damaged');
  assert.match(damaged[0].text, /Damaged \(page 3\)/);

  const usb = warningsFor(base({ backup: { folders: [folder(), folder({ kind: 'extra', path: 'E:\\POS', error: 'Folder or drive not found' })], safe: false } }));
  assert.deepEqual(codes(usb), ['backup-folder', 'same-disk']);
  assert.match(usb[0].text, /E:\\POS: Folder or drive not found/);

  const oldUsb = warningsFor(base({ backup: { folders: [folder(), folder({ kind: 'extra', path: 'E:\\POS', stale: true, at: Date.now() - 50 * HOUR, offDisk: true })], safe: false } }));
  assert.ok(codes(oldUsb).includes('backup-folder-old'));

  assert.deepEqual(codes(warningsFor(base({ disk: { free: 300 * 1024 ** 2, total: 200 * 1024 ** 3 } }))), ['disk-low']);
  assert.deepEqual(codes(warningsFor(base({ disk: { free: 5 * 1024 ** 3, total: 200 * 1024 ** 3 } }))), ['disk-low'], 'under 5% is low even with gigabytes left');
  assert.deepEqual(codes(warningsFor(base({ disk: null }))), [], 'a disk that cannot be read is not reported as full');

  const demo = warningsFor(base({ demoUsers: ['Maya', 'Leo'] }));
  assert.equal(demo[0].code, 'demo-pins');
  assert.match(demo[0].text, /2 people still use a PIN from the demo data \(Maya, Leo\)/);
  assert.match(warningsFor(base({ demoUsers: ['Leo'] }))[0].text, /One person still uses/);
});

test('errors come before warnings', () => {
  const w = warningsFor(base({
    backup: { folders: [folder({ stale: true, at: Date.now() - 60 * HOUR, check: { ok: false, error: 'x' } })], safe: false },
    demoUsers: ['Leo'],
  }));
  const firstWarn = w.findIndex(x => x.level === 'warn');
  assert.ok(w.slice(0, firstWarn).every(x => x.level === 'error') && w.slice(firstWarn).every(x => x.level === 'warn'));
});

// ----- the real server -----

test('an admin gets the machine report; nobody else does', async () => {
  const t = await boot();
  try {
    const admin = await t.login('Admin', '1234');
    const r = await t.call('/api/system', { token: admin.token });
    assert.equal(r.status, 200);
    const s = r.data;
    assert.equal(s.version, pkg.version);
    assert.equal(s.version, VERSION);
    assert.match(s.node, /^v\d+\./);
    assert.ok(s.uptimeMs >= 0 && s.startedAt > 0);
    assert.ok(s.data.bytes > 0, 'the database has a size');
    assert.ok(s.data.products > 0 && s.data.staff >= 4);
    assert.ok(s.disk === null || (s.disk.free > 0 && s.disk.total >= s.disk.free));
    const main = s.backup.folders[0];
    assert.equal(main.kind, 'main');
    assert.equal(main.check.ok, true, 'the daily copy opens and looks like a POS database');
    assert.ok(main.check.products > 0);
    assert.equal(s.lastBackupAt, main.at);
    // A fresh install: backups only on this disk, and the demo PINs are still there.
    assert.deepEqual(s.warnings.map(w => w.code).filter(c => ['same-disk', 'demo-pins'].includes(c)).sort(), ['demo-pins', 'same-disk']);
    assert.match(s.warnings.find(w => w.code === 'demo-pins').text, /Admin/);

    const maya = await t.login('Maya', '1111');
    assert.equal((await t.call('/api/system', { token: maya.token })).status, 403);
    assert.equal((await t.call('/api/system')).status, 401);
  } finally { await t.stop(); }
});

test('a damaged backup copy is noticed and reported as an error', async () => {
  const t = await boot();
  try {
    const admin = await t.login('Admin', '1234');
    assert.equal((await t.call('/api/backup/run', { token: admin.token, method: 'POST' })).status, 200);
    const dir = path.join(t.dataDir, 'backups');
    const file = path.join(dir, fs.readdirSync(dir).find(f => /^pos-.*\.db$/.test(f)));
    fs.writeFileSync(file, Buffer.alloc(8192, 7));                // what a failing disk or a half-copied file looks like

    const s = (await t.call('/api/system', { token: admin.token })).data;
    assert.equal(s.backup.folders[0].check.ok, false);
    const w = s.warnings.find(x => x.code === 'backup-damaged');
    assert.equal(w.level, 'error');
    assert.equal(s.warnings[0].code, 'backup-damaged', 'listed first');

    // Making a fresh copy puts it right.
    await t.call('/api/backup/run', { token: admin.token, method: 'POST' });
    const again = (await t.call('/api/system', { token: admin.token })).data;
    assert.equal(again.backup.folders[0].check.ok, true);
    assert.ok(!again.warnings.some(x => x.code === 'backup-damaged'));
  } finally { await t.stop(); }
});

test('a copy is checked: damaged, empty and foreign files are refused; a real copy passes', async () => {
  const t = await boot();
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-verify-'));
    try {
      const garbage = path.join(dir, 'garbage.db');
      fs.writeFileSync(garbage, Buffer.alloc(4096, 1));
      assert.equal(verifyCopy(garbage).ok, false);

      const foreign = path.join(dir, 'foreign.db');
      const f = new DatabaseSync(foreign);
      f.exec('CREATE TABLE other (x)');
      f.close();
      const foreignCheck = verifyCopy(foreign);
      assert.equal(foreignCheck.ok, false);

      const noSettings = path.join(dir, 'empty.db');
      const e = new DatabaseSync(noSettings);
      e.exec('CREATE TABLE docs (col TEXT, id TEXT, ver INTEGER, seq INTEGER, deleted INTEGER, data TEXT)');
      e.close();
      assert.match(verifyCopy(noSettings).error, /no settings/);

      assert.equal(verifyCopy(path.join(dir, 'missing.db')).ok, false, 'a missing file is not a copy');

      const good = t.app.db.backup(path.join(dir, 'copies'));
      const ok = verifyCopy(good);
      assert.equal(ok.ok, true);
      assert.ok(ok.orders >= 0 && ok.products > 0 && ok.users >= 4);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  } finally { await t.stop(); }
});
