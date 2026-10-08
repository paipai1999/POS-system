'use strict';

// Backup folders (USB / cloud) and their status. Run with:  node --test server/test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start } = require('../server.js');

let app, base, dataDir, extra, admin, waiter;

async function call(pathname, { token, method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function token(name, pin) {
  const users = (await call('/api/public')).data.users;
  const r = await call('/api/login', { method: 'POST', body: { userId: users.find(u => u.name === name).id, pin } });
  return r.data.token;
}

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-bk-'));
  extra = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-usb-'));
  app = start({ port: 0, dataDir, quiet: true });
  await new Promise(r => app.server.once('listening', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  admin = await token('Admin', '1234');
  waiter = await token('Leo', '2222');
});

test.after(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(extra, { recursive: true, force: true });
});

const copies = dir => fs.readdirSync(dir).filter(f => /^pos-\d{4}-\d{2}-\d{2}\.db$/.test(f));

test('only an admin sees or changes backup settings', async () => {
  assert.equal((await call('/api/backup', { token: waiter })).status, 403);
  assert.equal((await call('/api/backup/folders', { token: waiter, method: 'POST', body: { dirs: [extra] } })).status, 403);
  assert.equal((await call('/api/backup/run', { token: waiter, method: 'POST' })).status, 403);
});

test('at first there is one backup folder, on the PC itself, and the status warns about it', async () => {
  const { data } = await call('/api/backup', { token: admin });
  assert.equal(data.folders.length, 1);
  assert.equal(data.folders[0].kind, 'main');
  assert.equal(data.safe, false);
  assert.equal(data.folders[0].count, 1);
});

test('a folder that does not exist, is a file, or is not a full path is refused', async () => {
  const missing = path.join(extra, 'nope');
  assert.equal((await call('/api/backup/folders', { token: admin, method: 'POST', body: { dirs: [missing] } })).status, 400);
  const file = path.join(extra, 'a-file.txt');
  fs.writeFileSync(file, 'x');
  assert.equal((await call('/api/backup/folders', { token: admin, method: 'POST', body: { dirs: [file] } })).status, 400);
  assert.equal((await call('/api/backup/folders', { token: admin, method: 'POST', body: { dirs: ['POS-backups'] } })).status, 400);
  assert.equal((await call('/api/backup/folders', { token: admin, method: 'POST', body: { dirs: [extra, extra + '2', extra + '3'] } })).status, 400);
  assert.deepEqual(app.db.meta('backupDirs', null), null, 'nothing was saved');
});

test('an extra folder gets a copy straight away and every day after', async () => {
  const res = await call('/api/backup/folders', { token: admin, method: 'POST', body: { dirs: [extra] } });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(copies(extra).length, 1);
  const folder = res.data.folders.find(f => f.kind === 'extra');
  assert.equal(folder.path, path.resolve(extra));
  assert.equal(folder.count, 1);
  assert.equal(folder.error, null);
  assert.equal(fs.existsSync(path.join(extra, '.pos-write-test')), false, 'the write test leaves nothing behind');

  // The copy is a real, readable database that holds the data.
  const { DatabaseSync } = require('node:sqlite');
  const copy = new DatabaseSync(path.join(extra, copies(extra)[0]));
  assert.ok(copy.prepare("SELECT COUNT(*) AS n FROM docs WHERE col = 'products'").get().n >= 10);
  copy.close();
});

test('"Back up now" refreshes today\'s copy with the latest data', async () => {
  const admin2 = await call('/api/snapshot', { token: admin });
  assert.ok(admin2.data.rows.length > 0);
  const before = fs.statSync(path.join(extra, copies(extra)[0])).mtimeMs;
  await new Promise(r => setTimeout(r, 30));
  const res = await call('/api/backup/run', { token: admin, method: 'POST' });
  assert.equal(res.status, 200);
  assert.ok(fs.statSync(path.join(extra, copies(extra)[0])).mtimeMs > before);
});

test('a drive that was unplugged shows an error and recovers when it is back', async () => {
  fs.rmSync(extra, { recursive: true, force: true });
  let st = (await call('/api/backup/run', { token: admin, method: 'POST' })).data;
  const folder = st.folders.find(f => f.kind === 'extra');
  assert.ok(folder.error, 'the problem is reported');
  assert.equal(st.safe, false);
  assert.equal(st.folders[0].error, null, 'the main folder is unaffected');
  fs.mkdirSync(extra, { recursive: true });
  st = (await call('/api/backup/run', { token: admin, method: 'POST' })).data;
  assert.equal(st.folders.find(f => f.kind === 'extra').error, null);
  assert.equal(copies(extra).length, 1);
});

test('clearing the folders goes back to the main folder only', async () => {
  const res = await call('/api/backup/folders', { token: admin, method: 'POST', body: { dirs: [] } });
  assert.equal(res.status, 200);
  assert.equal(res.data.folders.length, 1);
});
