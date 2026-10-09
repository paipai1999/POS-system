'use strict';

// Menu photos: upload, serving, who may use them, backups and clean-up. Run with:  node --test server/test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start } = require('../server.js');
const photos = require('../photos.js');

let app, base, dataDir;

// A real 1×1 PNG, and the first bytes of a JPEG and a WebP (the server only looks at what kind of file it is).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), Buffer.from('JFIF'), Buffer.alloc(40)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([40, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(40)]);

async function call(pathname, { token, method = 'GET', body, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + pathname, { method, headers, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body) });
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, data: ct.includes('json') ? await res.json().catch(() => null) : Buffer.from(await res.arrayBuffer()) };
}
const upload = (token, buf) => call('/api/photo', { token, method: 'POST', raw: buf });

class Device {
  constructor(token, user) { this.token = token; this.user = user; this.vers = {}; this.docs = {}; }
  async load() {
    const { data } = await call('/api/snapshot', { token: this.token });
    this.vers = {}; this.docs = {};
    for (const r of data.rows) { this.vers[r.col + '/' + r.id] = r.ver; this.docs[r.col + '/' + r.id] = r.data; }
  }
  doc(col, id) { return structuredClone(this.docs[col + '/' + id]); }
  async put(col, doc, id = doc.id) {
    const change = { col, id, base: this.vers[col + '/' + id] || 0, data: doc };
    const { data } = await call('/api/sync', { token: this.token, method: 'POST', body: { changes: [change] } });
    const r = data.results[0];
    this.vers[col + '/' + id] = r.ver;
    this.docs[col + '/' + id] = r.doc;
    return r;
  }
}
async function login(name, pin) {
  const users = (await call('/api/public')).data.users;
  const r = await call('/api/login', { method: 'POST', body: { userId: users.find(u => u.name === name).id, pin } });
  const dev = new Device(r.data.token, r.data.user);
  await dev.load();
  return dev;
}
const prod = name => app.db.all('products').find(p => p.name === name);
const photoFiles = () => fs.existsSync(path.join(dataDir, 'photos')) ? fs.readdirSync(path.join(dataDir, 'photos')) : [];

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-photos-'));
  app = start({ port: 0, dataDir, quiet: true });
  await new Promise(r => app.server.once('listening', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

test.after(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('what kind of picture a file really is does not depend on its name or what the sender says', () => {
  assert.equal(photos.sniff(PNG), 'png');
  assert.equal(photos.sniff(JPG), 'jpg');
  assert.equal(photos.sniff(WEBP), 'webp');
  assert.equal(photos.sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>')), null, 'SVG can carry scripts');
  assert.equal(photos.sniff(Buffer.from('<html><script>alert(1)</script></html>')), null);
  assert.equal(photos.sniff(Buffer.from('GIF89a......')), null);
  assert.equal(photos.sniff(Buffer.alloc(0)), null);
  assert.equal(photos.sniff(Buffer.from('RIFF....WAVEfmt ')), null, 'a RIFF file that is not WebP');
});

test('only signed-in staff who manage the menu can upload, and only real pictures', async () => {
  const admin = await login('Admin', '1234');
  const waiter = await login('Leo', '2222');
  const cashier = await login('Maya', '1111');
  assert.equal((await upload(null, PNG)).status, 401, 'no sign-in');
  assert.equal((await upload(waiter.token, PNG)).status, 403);
  assert.equal((await upload(cashier.token, PNG)).status, 403);
  assert.deepEqual(photoFiles(), [], 'nothing was stored by the refused uploads');

  for (const [buf, ext] of [[PNG, 'png'], [JPG, 'jpg'], [WEBP, 'webp']]) {
    const r = await upload(admin.token, buf);
    assert.equal(r.status, 200, ext);
    assert.match(r.data.photo, new RegExp(`^[a-f0-9]{24}\\.${ext}$`));
  }
  assert.equal(photoFiles().length, 3);

  for (const bad of [Buffer.from('<svg onload="alert(1)"/>'), Buffer.from('not a picture at all'), Buffer.alloc(0), Buffer.from('GIF89a......')]) {
    const r = await upload(admin.token, bad);
    assert.equal(r.status, 400, bad.toString().slice(0, 12));
    assert.ok(r.data.error);
  }
  const big = await upload(admin.token, Buffer.concat([PNG, Buffer.alloc(photos.MAX_BYTES)]));
  assert.equal(big.status, 413, 'larger than the limit');
  assert.equal(photoFiles().length, 3, 'refused uploads leave no file behind');
});

test('a stored picture is public, has the right type, and can be cached for good', async () => {
  const admin = await login('Admin', '1234');
  const { data } = await upload(admin.token, PNG);
  const r = await call('/photos/' + data.photo);     // no sign-in: guests see the menu too
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('cache-control'), /immutable/);
  assert.deepEqual(r.data, PNG);
});

test('the photo address cannot be used to read other files', async () => {
  for (const p of [
    '/photos/../server/data/pos.db', '/photos/..%2fpos.db', '/photos/%2e%2e%2fpos.db', '/photos/..%5cpos.db', '/photos/', '/photos/x.png',
    '/photos/' + 'a'.repeat(24) + '.png', '/photos/' + 'A'.repeat(24) + '.png', '/photos/%zz', '/photos/' + 'a'.repeat(24) + '.svg',
  ]) {
    const r = await call(p);
    assert.equal(r.status, 404, p);
  }
});

test('an item can use a stored picture; names that were never uploaded are refused', async () => {
  const admin = await login('Admin', '1234');
  const { data } = await upload(admin.token, JPG);
  const latte = prod('Latte');
  const base0 = admin.doc('products', latte.id);

  let r = await admin.put('products', { ...base0, photo: data.photo });
  assert.equal(r.status, 'ok', r.error);
  assert.equal(prod('Latte').photo, data.photo);

  for (const photo of ['../../etc/passwd', 'b'.repeat(24) + '.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA', { a: 1 }, 5]) {
    r = await admin.put('products', { ...admin.doc('products', latte.id), photo });
    assert.notEqual(r.status, 'ok', JSON.stringify(photo));
  }
  assert.equal(prod('Latte').photo, data.photo, 'refused changes did not touch the item');

  // A device without the menu permission cannot set one either.
  const waiter = await login('Leo', '2222');
  r = await waiter.put('products', { ...waiter.doc('products', latte.id), photo: data.photo });
  assert.notEqual(r.status, 'ok');

  r = await admin.put('products', { ...admin.doc('products', latte.id), photo: '' });
  assert.equal(r.status, 'ok', r.error);
  assert.equal('photo' in prod('Latte'), false, 'an empty photo means none');
});

test('an item whose picture file went missing (restored database) can still be edited', async () => {
  const admin = await login('Admin', '1234');
  const { data } = await upload(admin.token, PNG);
  const espresso = prod('Espresso');
  let r = await admin.put('products', { ...admin.doc('products', espresso.id), photo: data.photo });
  assert.equal(r.status, 'ok', r.error);
  fs.unlinkSync(path.join(dataDir, 'photos', data.photo));
  r = await admin.put('products', { ...admin.doc('products', espresso.id), price: espresso.price + 1 });
  assert.equal(r.status, 'ok', r.error);
  assert.equal(prod('Espresso').photo, data.photo, 'the name is kept; the app shows the icon instead');
  r = await admin.put('products', { ...admin.doc('products', espresso.id), photo: '' });
  assert.equal(r.status, 'ok', r.error);
});

test('the guest menu carries the photo', async () => {
  const admin = await login('Admin', '1234');
  const { data } = await upload(admin.token, WEBP);
  const mocha = prod('Latte');
  await admin.put('products', { ...admin.doc('products', mocha.id), photo: data.photo, active: true });
  const table = app.db.all('tables')[0];
  const g = await call('/api/guest/state?table=' + table.guestCode);
  assert.equal(g.status, 200);
  assert.equal(g.data.products.find(p => p.id === mocha.id).photo, data.photo);
});

test('pictures nobody uses are removed after a day; the ones in use and fresh uploads stay', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-photos-clean-'));
  try {
    const used = photos.save(dir, PNG), fresh = photos.save(dir, JPG), old = photos.save(dir, WEBP);
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    for (const n of [used, old]) fs.utimesSync(path.join(dir, 'photos', n), twoDaysAgo, twoDaysAgo);
    fs.writeFileSync(path.join(dir, 'photos', 'notes.txt'), 'not mine');
    assert.equal(photos.cleanup(dir, [used, undefined, null]), 1);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'photos')).sort(), [fresh, 'notes.txt', used].sort());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a backup file carries the pictures, and restoring it brings them back', async () => {
  const admin = await login('Admin', '1234');
  const { data } = await upload(admin.token, PNG);
  const cappuccino = prod('Cappuccino');
  let r = await admin.put('products', { ...admin.doc('products', cappuccino.id), photo: data.photo });
  assert.equal(r.status, 'ok', r.error);

  const exp = await call('/api/export', { token: admin.token });
  assert.equal(exp.status, 200);
  const dataset = exp.data;
  const exported = dataset.products.find(p => p.id === cappuccino.id).photo;
  assert.equal(exported, 'data:image/png;base64,' + PNG.toString('base64'), 'exported as a data: URL');

  // A dataset from single-device mode: one good picture, one that is not a picture, one pointing at nothing.
  const espresso = dataset.products.find(p => p.name === 'Espresso');
  espresso.photo = 'data:image/png;base64,' + PNG.toString('base64');
  const latte = dataset.products.find(p => p.name === 'Latte');
  latte.photo = 'data:image/png;base64,' + Buffer.from('definitely not a png').toString('base64');
  const mocha = dataset.products.find(p => p.name === 'Chai Latte');
  mocha.photo = 'c'.repeat(24) + '.png';
  const imp = await call('/api/import', { token: admin.token, method: 'POST', body: dataset });
  assert.equal(imp.status, 200, JSON.stringify(imp.data));

  const after = n => app.db.all('products').find(p => p.name === n);
  assert.match(after('Cappuccino').photo, photos.NAME);
  assert.match(after('Espresso').photo, photos.NAME);
  assert.ok(photos.exists(dataDir, after('Cappuccino').photo) && photos.exists(dataDir, after('Espresso').photo));
  assert.equal('photo' in after('Latte'), false, 'bytes that are not a picture are dropped');
  assert.equal('photo' in after('Chai Latte'), false, 'a name with no file is dropped');
  const served = await call('/photos/' + after('Cappuccino').photo);
  assert.deepEqual(served.data, PNG);
});

test('the daily backup also copies the pictures to the extra folders', async () => {
  const admin = await login('Admin', '1234');
  const { data } = await upload(admin.token, JPG);
  const extra = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-photos-extra-'));
  try {
    const r = await call('/api/backup/folders', { token: admin.token, method: 'POST', body: { dirs: [extra] } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.ok(fs.existsSync(path.join(extra, 'photos', data.photo)), 'copied next to the database copy');
    assert.deepEqual(fs.readFileSync(path.join(extra, 'photos', data.photo)), JPG);
    await call('/api/backup/folders', { token: admin.token, method: 'POST', body: { dirs: [] } });
  } finally { fs.rmSync(extra, { recursive: true, force: true }); }
});
