'use strict';

// Restoring a backup copy: node server/restore.js. Run with:  node --test server/test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Database, verifyCopy } = require('../db.js');
const { seedData } = require('../../js/shared.js');
const { restore, listBackups } = require('../restore.js');
const { start } = require('../server.js');

const FREE_PORT = 1;   // nothing listens here, so "is the server running?" is answered no
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pos-restore-'));
const names = db => db.all('customers').map(c => c.name).sort();

// A data folder holding a database that contains the customers given.
function makeData(customers) {
  const dataDir = tmp();
  const db = new Database(path.join(dataDir, 'pos.db'));
  db.loadDataset(seedData());
  customers.forEach((name, i) => db.put('customers', 'c' + i, { id: 'c' + i, name }));
  return { dataDir, db };
}

test('a backup copy replaces the live data, and the data it replaced is kept', async () => {
  const { dataDir, db } = makeData(['Alice']);
  try {
    const copy = db.backup(path.join(dataDir, 'backups'));        // Alice only
    db.put('customers', 'c1', { id: 'c1', name: 'Bob' });          // changed after the backup
    db.close();

    const r = await restore({ dataDir, file: copy, port: FREE_PORT, now: new Date(2026, 9, 12, 8, 30, 5) });
    assert.equal(r.check.ok, true);
    assert.equal(path.basename(r.safety), 'before-restore-20261012-083005.db');

    const after = new Database(path.join(dataDir, 'pos.db'));
    assert.deepEqual(names(after), ['Alice'], 'the data is what the backup held');
    after.close();
    const kept = new Database(r.safety);
    assert.deepEqual(names(kept), ['Alice', 'Bob'], 'what was replaced is saved, so a restore can be undone');
    kept.close();
    assert.equal(verifyCopy(r.safety).ok, true);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('a server started afterwards runs on the restored data', async () => {
  const { dataDir, db } = makeData(['Alice']);
  try {
    const copy = db.backup(path.join(dataDir, 'backups'));
    db.put('customers', 'c1', { id: 'c1', name: 'Bob' });
    db.close();
    await restore({ dataDir, file: copy, port: FREE_PORT });

    const app = start({ port: 0, dataDir, quiet: true, allowDemoPins: true });
    await new Promise(r => app.server.once('listening', r));
    try {
      assert.deepEqual(names(app.db), ['Alice']);
      const base = `http://127.0.0.1:${app.server.address().port}`;
      const users = (await (await fetch(base + '/api/public')).json()).users;
      const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: users.find(u => u.name === 'Admin').id, pin: '1234' }) });
      assert.equal(login.status, 200, 'the staff and their PINs came back too');
    } finally { await app.close(); }
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('a damaged, missing or wrong file is refused and nothing is changed', async () => {
  const { dataDir, db } = makeData(['Alice']);
  try {
    const garbage = path.join(dataDir, 'garbage.db');
    fs.writeFileSync(garbage, Buffer.alloc(4096, 9));
    await assert.rejects(restore({ dataDir, file: garbage, port: FREE_PORT }), /cannot be used as a backup/);
    await assert.rejects(restore({ dataDir, file: path.join(dataDir, 'nope.db'), port: FREE_PORT }), /File not found/);
    await assert.rejects(restore({ dataDir, file: path.join(dataDir, 'pos.db'), port: FREE_PORT }), /database the POS is using now/);
    assert.deepEqual(names(db), ['Alice'], 'the live data is untouched');
    assert.deepEqual(fs.readdirSync(dataDir).filter(f => f.startsWith('before-restore')), [], 'and no safety copy was made for a restore that did not happen');
    db.close();
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('it will not run while the POS server is running', async () => {
  const dataDir = tmp();
  const app = start({ port: 0, dataDir, quiet: true, allowDemoPins: true });
  await new Promise(r => app.server.once('listening', r));
  try {
    const copy = app.db.backup(path.join(dataDir, 'backups'), { force: true });   // (the server already made today's copy)
    app.db.put('customers', 'c9', { id: 'c9', name: 'Carol' });
    await assert.rejects(restore({ dataDir, file: copy, port: app.server.address().port }), /server is running/);
    assert.deepEqual(names(app.db), ['Carol'], 'nothing was replaced');
  } finally { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('menu pictures kept beside an extra backup copy are put back, without overwriting', async () => {
  const { dataDir, db } = makeData(['Alice']);
  const usb = tmp();
  try {
    const copy = db.backup(usb);
    db.close();
    fs.mkdirSync(path.join(usb, 'photos'));
    fs.writeFileSync(path.join(usb, 'photos', 'a1.jpg'), 'from the usb copy');
    fs.writeFileSync(path.join(usb, 'photos', 'b2.jpg'), 'from the usb copy');
    fs.mkdirSync(path.join(dataDir, 'photos'));
    fs.writeFileSync(path.join(dataDir, 'photos', 'b2.jpg'), 'already here');

    const r = await restore({ dataDir, file: copy, port: FREE_PORT });
    assert.equal(r.photos, 1);
    assert.equal(fs.readFileSync(path.join(dataDir, 'photos', 'a1.jpg'), 'utf8'), 'from the usb copy');
    assert.equal(fs.readFileSync(path.join(dataDir, 'photos', 'b2.jpg'), 'utf8'), 'already here');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(usb, { recursive: true, force: true }); }
});

test('the list shows every copy in the data folder and the extra folders, newest first, and flags damaged ones', () => {
  const { dataDir, db } = makeData(['Alice']);
  const usb = tmp();
  try {
    const first = db.backup(path.join(dataDir, 'backups'));
    fs.renameSync(first, path.join(dataDir, 'backups', 'pos-2026-10-10.db'));
    db.put('customers', 'c1', { id: 'c1', name: 'Bob' });
    const second = db.backup(usb);
    fs.renameSync(second, path.join(usb, 'pos-2026-10-12.db'));
    fs.writeFileSync(path.join(usb, 'pos-2026-10-11.db'), Buffer.alloc(2048, 3));       // a half-written copy
    fs.writeFileSync(path.join(usb, 'notes.txt'), 'not a copy');
    db.close();

    const list = listBackups(dataDir, [usb]);
    assert.deepEqual(list.map(c => c.name), ['pos-2026-10-12.db', 'pos-2026-10-11.db', 'pos-2026-10-10.db']);
    assert.deepEqual(list.map(c => c.check.ok), [true, false, true]);
    assert.ok(list[0].check.orders >= 0 && list[0].check.users >= 4);
    assert.equal(listBackups(path.join(dataDir, 'nowhere'), []).length, 0, 'a folder with no copies is an empty list, not an error');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(usb, { recursive: true, force: true }); }
});

test('the extra backup folders the owner chose are found from the live database', () => {
  const { dataDir, db } = makeData([]);
  const usb = tmp();
  try {
    db.backup(path.join(dataDir, 'backups'));
    const copy = db.backup(usb);
    fs.renameSync(copy, path.join(usb, 'pos-2026-10-12.db'));
    db.setMeta('backupDirs', [usb]);
    db.close();
    assert.ok(listBackups(dataDir).some(c => c.dir === usb), 'listed without being told about the folder');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(usb, { recursive: true, force: true }); }
});
