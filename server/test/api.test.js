'use strict';

// Run with:  node --test server/test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start } = require('../server.js');

let app, base, dataDir;

async function boot() {
  app = start({ port: 0, dataDir, quiet: true });
  await new Promise(r => app.server.once('listening', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
}

async function call(pathname, { token, method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

// A minimal stand-in for a device: keeps the versions it has seen, like js/sync.js does.
class Device {
  constructor(token) { this.token = token; this.vers = {}; this.docs = {}; }
  async load() {
    const { data } = await call('/api/snapshot', { token: this.token });
    for (const r of data.rows) this.remember(r.col, r.id, r.ver, r.data);
    return data;
  }
  remember(col, id, ver, doc) { this.vers[col + '/' + id] = ver; this.docs[col + '/' + id] = doc; }
  doc(col, id) { return structuredClone(this.docs[col + '/' + id]); }
  find(col, pred) { return Object.entries(this.docs).filter(([k, d]) => k.startsWith(col + '/') && d && pred(d)).map(([, d]) => structuredClone(d)); }
  async put(col, doc, { deleted = false } = {}) {
    const id = col === 'settings' ? 'main' : doc.id;
    const change = { col, id, base: this.vers[col + '/' + id] || 0 };
    if (deleted) change.deleted = true; else change.data = doc;
    const { status, data } = await call('/api/sync', { token: this.token, method: 'POST', body: { changes: [change] } });
    assert.equal(status, 200, JSON.stringify(data));
    const r = data.results[0];
    this.remember(col, id, r.ver, r.doc);
    return r;
  }
}

async function login(name, pin) {
  const { data: pub } = await call('/api/public');
  const user = pub.users.find(u => u.name === name);
  const { status, data } = await call('/api/login', { method: 'POST', body: { userId: user.id, pin } });
  assert.equal(status, 200);
  const dev = new Device(data.token);
  await dev.load();
  return dev;
}

const newOrder = (dev, items) => {
  const products = dev.find('products', () => true);
  return {
    id: 'o_' + Math.random().toString(36).slice(2), number: null, tableId: null, tableName: '', staffId: 'x',
    status: 'open', note: '', discount: null, createdAt: Date.now(),
    items: items.map(([name, qty], i) => {
      const p = products.find(x => x.name === name);
      return { id: 'l_' + i, productId: p.id, name: p.name, price: p.price, qty, note: '', sentQty: 0 };
    }),
  };
};

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-test-'));
  await boot();
});

test.after(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('public endpoints never expose PINs', async () => {
  const { data } = await call('/api/public');
  assert.ok(data.users.length >= 4);
  assert.ok(!JSON.stringify(data).includes('"pin"'));
  const admin = await login('Admin', '1234');
  const { data: snap } = await call('/api/snapshot', { token: admin.token });
  assert.ok(!JSON.stringify(snap).includes('"pin"'));
  assert.ok(!JSON.stringify(snap).includes('pinHash'));
  assert.ok(!JSON.stringify(data).includes('pinHash'));
});

test('wrong PIN is rejected and repeated guessing is locked out', async () => {
  const { data: pub } = await call('/api/public');
  const leo = pub.users.find(u => u.name === 'Leo');
  for (let i = 0; i < 5; i++) {
    const r = await call('/api/login', { method: 'POST', body: { userId: leo.id, pin: '0000' } });
    assert.equal(r.status, 401);
  }
  const locked = await call('/api/login', { method: 'POST', body: { userId: leo.id, pin: '2222' } });
  assert.equal(locked.status, 429);
  // Reset lockout for the remaining tests (all requests come from the same IP).
  await app.close();
  await boot();
});

test('requests without a session are refused', async () => {
  assert.equal((await call('/api/snapshot')).status, 401);
  assert.equal((await call('/api/sync', { method: 'POST', body: { changes: [] } })).status, 401);
});

test('orders from two devices at once get unique numbers', async () => {
  const a = await login('Leo', '2222');
  const b = await login('Maya', '1111');
  const results = await Promise.all([
    ...[1, 2, 3].map(() => a.put('orders', newOrder(a, [['Latte', 1]]))),
    ...[1, 2, 3].map(() => b.put('orders', newOrder(b, [['Espresso', 1]]))),
  ]);
  const numbers = results.map(r => r.doc.number);
  assert.ok(numbers.every(n => Number.isInteger(n)));
  assert.equal(new Set(numbers).size, 6);
});

test('empty orders do not use up an order number', async () => {
  const a = await login('Leo', '2222');
  const r = await a.put('orders', newOrder(a, []));
  assert.equal(r.doc.number, null);
});

test('stock is taken once on payment and returned on refund; waiters cannot take payment', async () => {
  const waiter = await login('Leo', '2222');
  const cashier = await login('Maya', '1111');
  const toastBefore = cashier.find('products', p => p.name === 'Avocado Toast')[0].stock;

  const created = await waiter.put('orders', newOrder(waiter, [['Avocado Toast', 2]]));
  const order = created.doc;
  const asWaiter = { ...order, status: 'paid', totals: { total: 18.19 }, payment: { method: 'card', amount: 18.19 } };
  const denied = await waiter.put('orders', asWaiter);
  assert.equal(denied.status, 'error');

  await cashier.load();
  const paid = await cashier.put('orders', { ...cashier.doc('orders', order.id), status: 'paid', totals: { total: 18.19 }, payment: { method: 'card', amount: 18.19 } });
  assert.equal(paid.status, 'ok');
  await cashier.load();
  assert.equal(cashier.find('products', p => p.name === 'Avocado Toast')[0].stock, toastBefore - 2);

  // Refund needs a manager: the cashier alone is refused…
  const admin = (await call('/api/public')).data.users.find(u => u.name === 'Admin');
  const noApproval = await cashier.put('orders', { ...cashier.doc('orders', order.id), status: 'refunded', refundedBy: admin.id });
  assert.equal(noApproval.status, 'error');
  // …but works after the admin enters their PIN on the cashier's device.
  const v = await call('/api/verify-pin', { token: cashier.token, method: 'POST', body: { pin: '1234' } });
  assert.equal(v.status, 200);
  const refunded = await cashier.put('orders', { ...cashier.doc('orders', order.id), status: 'refunded', refundedBy: admin.id });
  assert.equal(refunded.status, 'ok');
  await cashier.load();
  assert.equal(cashier.find('products', p => p.name === 'Avocado Toast')[0].stock, toastBefore);
});

test('stale writes are rejected as conflicts', async () => {
  const a = await login('Admin', '1234');
  const b = await login('Admin', '1234');
  const p = a.find('products', x => x.name === 'Lemonade')[0];
  assert.equal((await a.put('products', { ...p, price: 3.9 })).status, 'ok');
  const stale = await b.put('products', { ...p, price: 9.9 });
  assert.equal(stale.status, 'conflict');
  assert.equal(stale.doc.price, 3.9);
});

test('server enforces role permissions', async () => {
  const waiter = await login('Leo', '2222');
  const r = await waiter.put('settings', { ...waiter.doc('settings', 'main'), taxRate: 0 });
  assert.equal(r.status, 'error');
  const p = waiter.find('products', x => x.name === 'Latte')[0];
  assert.equal((await waiter.put('products', { ...p, price: 0 })).status, 'error');
  assert.equal((await call('/api/export', { token: waiter.token })).status, 403);
});

test('staff PINs must be unique and are never returned', async () => {
  const admin = await login('Admin', '1234');
  const dup = await admin.put('users', { id: 'u_new', name: 'Sam', role: 'waiter', pin: '2222', active: true });
  assert.equal(dup.status, 'error');
  const ok = await admin.put('users', { id: 'u_new', name: 'Sam', role: 'waiter', pin: '5555', active: true });
  assert.equal(ok.status, 'ok');
  assert.equal(ok.doc.pin, undefined);
  // Editing without a PIN keeps the existing one.
  const renamed = await admin.put('users', { ...admin.doc('users', 'u_new'), name: 'Samuel' });
  assert.equal(renamed.status, 'ok');
  const { data: pub } = await call('/api/public');
  const sam = pub.users.find(u => u.name === 'Samuel');
  assert.equal((await call('/api/login', { method: 'POST', body: { userId: sam.id, pin: '5555' } })).status, 200);
});

test('guests see only the menu and their own table', async () => {
  const admin = await login('Admin', '1234');
  const [t1, t2] = admin.find('tables', () => true);
  const other = newOrder(admin, [['Cheesecake', 1]]);
  other.tableId = t2.id;
  await admin.put('orders', other);

  assert.equal((await call('/api/guest/state?table=nope')).status, 400);
  const { data } = await call('/api/guest/state?table=' + t1.guestCode);
  assert.deepEqual(data.users, []);
  assert.equal(data.tables.length, 1);
  assert.equal(data.orders.length, 0);
  assert.ok(!JSON.stringify(data).includes('"pin"'));

  const latte = data.products.find(p => p.name === 'Latte');
  const sent = await call('/api/guest/request', { method: 'POST', body: { table: t1.guestCode, kind: 'order', items: [{ productId: latte.id, qty: 2 }], note: 'oat milk' } });
  assert.equal(sent.status, 200);
  const again = await call('/api/guest/request', { method: 'POST', body: { table: t1.guestCode, kind: 'order', items: [{ productId: latte.id, qty: 1 }] } });
  assert.equal(again.status, 400, 'rapid repeat requests are throttled');
  const { data: after } = await call('/api/guest/state?table=' + t1.guestCode);
  assert.equal(after.guestRequests.length, 1);
  assert.equal(after.guestRequests[0].items[0].price, latte.price, 'price comes from the server, not the guest');
});

test('data and sessions survive a server restart', async () => {
  const a = await login('Maya', '1111');
  const r = await a.put('orders', newOrder(a, [['Green Tea', 1]]));
  await app.close();
  await boot();
  const { status, data } = await call('/api/snapshot', { token: a.token });
  assert.equal(status, 200);
  assert.ok(data.rows.some(x => x.col === 'orders' && x.id === r.id));
  // Changes queued while the server was down still apply with their old base version.
  const order = { ...r.doc, note: 'written after restart' };
  assert.equal((await a.put('orders', order)).status, 'ok');
});

test('a backup copy is written on start', () => {
  const backups = fs.readdirSync(path.join(dataDir, 'backups'));
  assert.ok(backups.some(f => /^pos-\d{4}-\d{2}-\d{2}\.db$/.test(f)));
});

const pay = (dev, order, extra = {}) => dev.put('orders', {
  ...dev.doc('orders', order.id), status: 'paid', totals: { total: order.totals?.total }, payment: { method: 'card' }, ...extra,
});

test('only an admin can remove a printer station', async () => {
  const admin = await login('Admin', '1234');
  const waiter = await login('Leo', '2222');
  const { data } = await call('/api/station/register', { token: admin.token, method: 'POST' });
  assert.ok(data.key);
  assert.equal((await call('/api/station/unregister', { token: waiter.token, method: 'POST', body: { key: data.key } })).status, 403);
  const job = { method: 'POST', body: { key: data.key, id: 'none', status: 'printing' } };
  assert.equal((await call('/api/station/job', job)).status, 404, 'station is still registered');
  assert.equal((await call('/api/station/unregister', { token: admin.token, method: 'POST', body: { key: data.key } })).status, 200);
  assert.equal((await call('/api/station/job', job)).status, 403, 'now removed');
});

test('line prices cannot be invented or changed by a device', async () => {
  const waiter = await login('Leo', '2222');
  const cheap = newOrder(waiter, [['Latte', 1]]);
  cheap.items[0].price = 0.01;
  const bad = await waiter.put('orders', cheap);
  assert.equal(bad.status, 'error');
  assert.match(bad.error, /price/i);

  const ok = await waiter.put('orders', newOrder(waiter, [['Latte', 1]]));
  assert.equal(ok.status, 'ok');
  const edited = waiter.doc('orders', ok.doc.id);
  edited.items[0].price = 0.01;
  const tampered = await waiter.put('orders', edited);
  assert.equal(tampered.status, 'error');
});

test('the server recalculates the bill and the change at payment', async () => {
  const waiter = await login('Leo', '2222');
  const cashier = await login('Maya', '1111');
  const created = (await waiter.put('orders', newOrder(waiter, [['Latte', 2]]))).doc;   // 8.00 + 7% tax = 8.56
  await cashier.load();

  const wrong = await pay(cashier, created, { totals: { total: 1 } });
  assert.equal(wrong.status, 'error');
  assert.match(wrong.error, /total/i);

  await cashier.load();
  const short = await pay(cashier, created, { totals: { total: 8.56 }, payment: { method: 'cash', tendered: 5 } });
  assert.equal(short.status, 'error');

  await cashier.load();
  const done = await pay(cashier, created, { totals: { total: 8.56, subtotal: 0 }, payment: { method: 'cash', tendered: 10, change: 99 } });
  assert.equal(done.status, 'ok', done.error);
  assert.equal(done.doc.totals.subtotal, 8, 'stored totals come from the server');
  assert.equal(done.doc.payment.change, 1.44, 'change is calculated by the server');
  assert.equal(done.doc.payment.amount, 8.56);

  const odd = (await waiter.put('orders', newOrder(waiter, [['Latte', 1]]))).doc;
  await cashier.load();
  assert.equal((await pay(cashier, odd, { totals: { total: 4.28 }, payment: { method: 'bitcoin' } })).status, 'error');
});

test('open orders cannot reserve more stock than is left', async () => {
  const waiter = await login('Leo', '2222');
  const brownie = waiter.find('products', p => p.name === 'Chocolate Brownie')[0];
  const first = await waiter.put('orders', newOrder(waiter, [['Chocolate Brownie', brownie.stock - 4]]));
  assert.equal(first.status, 'ok');
  const second = await waiter.put('orders', newOrder(waiter, [['Chocolate Brownie', 5]]));
  assert.equal(second.status, 'error');
  assert.match(second.error, /stock/i);
  assert.equal((await waiter.put('orders', newOrder(waiter, [['Chocolate Brownie', 4]]))).status, 'ok');
  // Lowering a quantity is always allowed, even when stock is short.
  const lowered = waiter.doc('orders', first.doc.id);
  lowered.items[0].qty = 1;
  assert.equal((await waiter.put('orders', lowered)).status, 'ok');
});

test('waiters do not receive other waiters\' paid orders; kitchen has no order history', async () => {
  const admin = await login('Admin', '1234');
  await admin.put('users', { id: 'u_ann', name: 'Ann', role: 'waiter', pin: '6666', active: true });
  const ann = await login('Ann', '6666');
  const leo = await login('Leo', '2222');
  const cashier = await login('Maya', '1111');

  const mine = (await ann.put('orders', newOrder(ann, [['Green Tea', 1]]))).doc;
  mine.staffId = 'u_ann';
  assert.equal((await ann.put('orders', mine)).status, 'ok');
  const since = (await call('/api/changes?since=0', { token: leo.token })).data.seq;
  assert.ok((await leo.load()).rows.some(r => r.id === mine.id), 'open orders are shared so the table map is accurate');

  await cashier.load();
  assert.equal((await pay(cashier, mine, { totals: { total: 2.8 * 1.07 } })).status, 'ok');

  const { data } = await call('/api/changes?since=' + since, { token: leo.token });
  const row = data.rows.find(r => r.col === 'orders' && r.id === mine.id);
  assert.equal(row.deleted, true, "Leo's device is told to drop the order instead of showing it open forever");
  assert.ok(!JSON.stringify(data).includes('"payment"'));

  const leoHistory = await call('/api/orders?from=0', { token: leo.token });
  assert.ok(!leoHistory.data.rows.some(r => r.id === mine.id));
  const annHistory = await call('/api/orders?from=0', { token: ann.token });
  assert.ok(annHistory.data.rows.some(r => r.id === mine.id), 'staff still see their own orders');
  const cashierHistory = await call('/api/orders?from=0', { token: cashier.token });
  assert.ok(cashierHistory.data.rows.some(r => r.id === mine.id));

  const kitchen = await login('Kitchen', '3333');
  assert.equal((await call('/api/orders?from=0', { token: kitchen.token })).status, 403);
});

test('PINs are stored only as salted hashes', async () => {
  const stored = app.db.all('users');
  assert.ok(stored.length >= 4);
  for (const u of stored) {
    assert.equal(u.pin, undefined, `${u.name} has no plain PIN`);
    assert.match(u.pinHash, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  }
  assert.ok(!fs.readFileSync(path.join(dataDir, 'pos.db')).includes('"pin":"'), 'no plain PIN written to the database file');
  const hashes = stored.map(u => u.pinHash);
  assert.equal(new Set(hashes).size, hashes.length, 'every hash has its own salt');

  const admin = await login('Admin', '1234');
  assert.equal((await call('/api/verify-pin', { token: admin.token, method: 'POST', body: { pin: '2222' } })).status, 200);
  assert.equal((await call('/api/verify-pin', { token: admin.token, method: 'POST', body: { pin: '9998' } })).status, 401);
});

test('changing a PIN re-hashes it, and a device cannot supply a hash', async () => {
  const admin = await login('Admin', '1234');
  const before = app.db.doc('users', 'u_new').pinHash;
  const changed = await admin.put('users', { ...admin.doc('users', 'u_new'), pin: '7777' });
  assert.equal(changed.status, 'ok', changed.error);
  const after = app.db.doc('users', 'u_new');
  assert.notEqual(after.pinHash, before);
  assert.equal(after.pin, undefined);
  const { data: pub } = await call('/api/public');
  const uid = pub.users.find(u => u.id === 'u_new').id;
  assert.equal((await call('/api/login', { method: 'POST', body: { userId: uid, pin: '5555' } })).status, 401, 'old PIN no longer works');
  assert.equal((await call('/api/login', { method: 'POST', body: { userId: uid, pin: '7777' } })).status, 200);

  // Trying to plant a known hash (taken from another account) is ignored: the hash is never read from the request.
  const planted = await admin.put('users', { ...admin.doc('users', 'u_new'), pinHash: app.db.doc('users', admin.doc('users', 'u_new').id).pinHash });
  assert.equal(planted.status, 'ok');
  assert.equal(app.db.doc('users', 'u_new').pinHash, after.pinHash, 'kept the real hash');
});

test('plain PINs from an old database or backup are converted', async () => {
  const admin = await login('Admin', '1234');
  // An old database: a user stored with a plain PIN.
  app.db.put('users', 'u_old', { id: 'u_old', name: 'Olga', role: 'waiter', pin: '4321', active: true });
  await app.close();
  await boot();
  const olga = app.db.doc('users', 'u_old');
  assert.equal(olga.pin, undefined);
  assert.ok(olga.pinHash);
  for (const f of ['pos.db', 'pos.db-wal']) {
    const file = path.join(dataDir, f);
    if (fs.existsSync(file)) assert.ok(!fs.readFileSync(file).includes('"pin":"4321"'), `${f} no longer holds the old plain PIN`);
  }
  const { data: pub } = await call('/api/public');
  assert.equal((await call('/api/login', { method: 'POST', body: { userId: 'u_old', pin: '4321' } })).status, 200);

  // The exported backup carries hashes, and an old-style backup (plain PINs) imports fine.
  const adminAgain = await login('Admin', '1234');
  const exported = (await call('/api/export', { token: adminAgain.token })).data;
  assert.ok(exported.users.every(u => u.pinHash && u.pin === undefined));
  const legacy = { ...exported, users: exported.users.map(({ pinHash, ...u }) => ({ ...u, pin: u.name === 'Admin' ? '8888' : String(1000 + Math.floor(Math.random() * 8999)) })) };
  const imported = await call('/api/import', { token: adminAgain.token, method: 'POST', body: legacy });
  assert.equal(imported.status, 200);
  assert.ok(app.db.all('users').every(u => u.pinHash && u.pin === undefined));
  const adminUser = (await call('/api/public')).data.users.find(u => u.name === 'Admin');
  assert.equal((await call('/api/login', { method: 'POST', body: { userId: adminUser.id, pin: '8888' } })).status, 200);
  assert.equal(pub.demo, true);
});

test('the demo-PIN warning disappears once the admin PIN is changed', async () => {
  const admin = await login('Admin', '8888');
  assert.equal((await call('/api/public')).data.demo, false);
  const adminDoc = admin.doc('users', admin.find('users', u => u.name === 'Admin')[0].id);
  assert.equal((await admin.put('users', { ...adminDoc, pin: '1234' })).status, 'ok');
  assert.equal((await call('/api/public')).data.demo, true);
});
