'use strict';

// Customers and loyalty points. Run with:  node --test server/test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start } = require('../server.js');

let app, base, dataDir;

async function call(pathname, { token, method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
}

class Device {
  constructor(token, user) { this.token = token; this.user = user; this.vers = {}; this.docs = {}; }
  async load() {
    const { data } = await call('/api/snapshot', { token: this.token });
    this.vers = {}; this.docs = {};
    for (const r of data.rows) { this.vers[r.col + '/' + r.id] = r.ver; this.docs[r.col + '/' + r.id] = r.data; }
  }
  doc(col, id) { return structuredClone(this.docs[col + '/' + id]); }
  find(col, pred) { return Object.entries(this.docs).filter(([k, d]) => k.startsWith(col + '/') && d && pred(d)).map(([, d]) => structuredClone(d)); }
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

const customer = id => app.db.doc('customers', id);
const without = (o, key) => { const { [key]: _, ...rest } = o; return rest; };
const line = (dev, name, qty) => {
  const p = dev.find('products', x => x.name === name)[0];
  return { id: 'l_' + Math.random().toString(36).slice(2), productId: p.id, name: p.name, price: p.price, qty, note: '', sentQty: 0 };
};
const order = (dev, items, extra = {}) => ({
  id: 'o_' + Math.random().toString(36).slice(2), number: null, tableId: null, tableName: '', staffId: dev.user.id,
  status: 'open', note: '', discount: null, createdAt: Date.now(), items, ...extra,
});
const pay = (dev, o, total) => dev.put('orders', { ...dev.doc('orders', o.id), status: 'paid', totals: { total }, payment: { method: 'card' } });

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-loy-'));
  app = start({ port: 0, dataDir, quiet: true });
  await new Promise(r => app.server.once('listening', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

test.after(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('customers: cashiers add them, only managers set points and discounts, waiters never see them', async () => {
  const cashier = await login('Maya', '1111');
  const admin = await login('Admin', '1234');
  const waiter = await login('Leo', '2222');

  assert.equal((await waiter.put('customers', { id: 'c_w', name: 'Nope' })).status, 'error');
  assert.equal((await cashier.put('customers', { id: 'c_bad', name: '' })).status, 'error');
  assert.equal((await cashier.put('customers', { id: 'c_bad', name: 'Zed', phone: 'call me' })).status, 'error');
  const made = await cashier.put('customers', { id: 'c_ann', name: ' Ann Lee ', phone: '09 111 222', note: 'likes oat milk', points: 500, discountPercent: 50 });
  assert.equal(made.status, 'error', 'a cashier cannot give a new customer points or a discount');
  const ok = await cashier.put('customers', { id: 'c_ann', name: ' Ann Lee ', phone: '09 111 222', note: 'likes oat milk' });
  assert.equal(ok.status, 'ok', ok.error);
  assert.equal(ok.doc.name, 'Ann Lee');
  assert.deepEqual([ok.doc.points, ok.doc.spent, ok.doc.visits, ok.doc.discountPercent], [0, 0, 0, 0]);
  assert.equal((await cashier.put('customers', { id: 'c_dup', name: 'Other Ann', phone: '09111222' })).status, 'error', 'the same phone number twice');

  assert.equal((await cashier.put('customers', { ...ok.doc, spent: 99999, visits: 50 })).doc.spent, 0, 'spent and visits are kept by the server');
  assert.equal((await cashier.put('customers', { ...cashier.doc('customers', 'c_ann'), points: 100 })).status, 'error');
  await admin.load();
  const adj = await admin.put('customers', { ...admin.doc('customers', 'c_ann'), points: 40, discountPercent: 10 });
  assert.equal(adj.status, 'ok', adj.error);
  assert.deepEqual([adj.doc.points, adj.doc.discountPercent], [40, 10]);

  await waiter.load();
  assert.equal(waiter.find('customers', () => true).length, 0);
  assert.equal((await call('/api/changes?since=0', { token: waiter.token })).data.rows.filter(r => r.col === 'customers').length, 0);
  const { rows } = (await call('/api/audit', { token: admin.token })).data;
  assert.match(rows.find(r => r.action === 'customer points adjusted').detail, /points 0 → 40/);
});

test('points cannot be used until loyalty is switched on', async () => {
  const cashier = await login('Maya', '1111');
  const o = order(cashier, [line(cashier, 'Latte', 1)], { customerId: 'c_ann', pointsUsed: 5 });
  const res = await cashier.put('orders', o);
  assert.equal(res.status, 'error');
  assert.match(res.error, /not switched on/);
  assert.equal((await cashier.put('orders', order(cashier, [line(cashier, 'Latte', 1)], { customerId: 'c_nobody' }))).status, 'error', 'an unknown customer');
});

test('a paid bill earns points, a bill can spend them, and a refund undoes both', async () => {
  const admin = await login('Admin', '1234');
  const cashier = await login('Maya', '1111');
  const s = admin.doc('settings', 'main');
  assert.equal((await admin.put('settings', { ...s, loyalty: { enabled: true, earnPercent: 10, maxRedeemPercent: 50 } }, 'main')).status, 'ok');
  await cashier.load();

  // Bill 1: 5 lattes = 20.00 + 7% tax = 21.40. Earn 10% = 2.14 points.
  const o1 = (await cashier.put('orders', order(cashier, [line(cashier, 'Latte', 5)], { customerId: 'c_ann' }))).doc;
  const p1 = await pay(cashier, o1, 21.4);
  assert.equal(p1.status, 'ok', p1.error);
  assert.deepEqual(without(p1.doc.loyalty, 'prevLastVisit'), { customerId: 'c_ann', earned: 2.14, used: 0, balance: 42.14 });
  let c = customer('c_ann');
  assert.deepEqual([c.points, c.spent, c.visits], [42.14, 21.4, 1]);
  assert.ok(c.lastVisit > 0);

  // Bill 2: 2 lattes = 8.00. At most 50% = 4.00 points can be used, and no more than the customer has.
  const o2 = (await cashier.put('orders', order(cashier, [line(cashier, 'Latte', 2)], { customerId: 'c_ann' }))).doc;
  const over = await cashier.put('orders', { ...cashier.doc('orders', o2.id), pointsUsed: 4.5 });
  assert.equal(over.status, 'error');
  assert.match(over.error, /At most 4 points/);
  const use = await cashier.put('orders', { ...cashier.doc('orders', o2.id), pointsUsed: 4 });
  assert.equal(use.status, 'ok', use.error);
  // 8.00 − 4.00 points = 4.00, + 7% tax = 4.28
  const wrong = await pay(cashier, o2, 8.56);
  assert.equal(wrong.status, 'error', 'a total that ignores the points is refused');
  const p2 = await pay(cashier, o2, 4.28);
  assert.equal(p2.status, 'ok', p2.error);
  assert.equal(p2.doc.totals.points, 4);
  assert.equal(p2.doc.totals.total, 4.28);
  assert.deepEqual(without(p2.doc.loyalty, 'prevLastVisit'), { customerId: 'c_ann', earned: 0.42, used: 4, balance: 38.56 }, '42.14 − 4 + 0.42');
  assert.equal(customer('c_ann').visits, 2);

  // Refund bill 2: the 4 points come back, the 0.42 earned goes away, and the visit is not counted.
  await call('/api/verify-pin', { token: cashier.token, method: 'POST', body: { pin: '1234' } });
  assert.equal((await cashier.put('orders', { ...cashier.doc('orders', o2.id), status: 'refunded', refundedBy: admin.user.id })).status, 'ok');
  c = customer('c_ann');
  assert.deepEqual([c.points, c.spent, c.visits], [42.14, 21.4, 1], 'back to where it was after bill 1');

  // Points spent on a bill that were already spent elsewhere are refused at payment.
  const o3 = (await cashier.put('orders', order(cashier, [line(cashier, 'Latte', 10)], { customerId: 'c_ann' }))).doc;
  const o4 = (await cashier.put('orders', order(cashier, [line(cashier, 'Latte', 10)], { customerId: 'c_ann' }))).doc;
  for (const o of [o3, o4]) assert.equal((await cashier.put('orders', { ...cashier.doc('orders', o.id), pointsUsed: 20 })).status, 'ok');
  assert.equal((await pay(cashier, o3, 24.1 + 0)).status, 'error', 'wrong total (20 points off 40 + tax = 21.4)');
  assert.equal((await pay(cashier, o3, 21.4)).status, 'ok');
  assert.equal(customer('c_ann').points, Math.round((42.14 - 20 + 2.14) * 100) / 100);
  assert.equal((await pay(cashier, o4, 21.4)).status, 'ok', 'still enough left for the second bill');
  const o5 = (await cashier.put('orders', order(cashier, [line(cashier, 'Latte', 10)], { customerId: 'c_ann' }))).doc;
  const left = customer('c_ann').points;
  assert.equal((await cashier.put('orders', { ...cashier.doc('orders', o5.id), pointsUsed: Math.floor(left) + 1 })).status, 'error', 'more than the customer has');
});

test('a customer\'s own discount needs no manager PIN, but must match the customer card', async () => {
  const cashier = await login('Maya', '1111');
  const admin = await login('Admin', '1234');
  const o = (await cashier.put('orders', order(cashier, [line(cashier, 'Latte', 5)], { customerId: 'c_ann' }))).doc;   // 20.00

  const withDiscount = d => cashier.put('orders', { ...cashier.doc('orders', o.id), discount: d });
  assert.equal((await withDiscount({ type: 'percent', value: 10, by: admin.user.id })).status, 'error', 'an ordinary discount still needs approval');
  assert.equal((await withDiscount({ type: 'percent', value: 25, customerId: 'c_ann' })).status, 'error', 'not what the card says');
  assert.equal((await withDiscount({ type: 'amount', value: 10, customerId: 'c_ann' })).status, 'error', 'only a percentage');
  assert.equal((await withDiscount({ type: 'percent', value: 10, customerId: 'c_nobody' })).status, 'error');
  const ok = await withDiscount({ type: 'percent', value: 10, customerId: 'c_ann' });
  assert.equal(ok.status, 'ok', ok.error);

  // Taking the customer off the bill while the customer discount stays is refused.
  const { customerId, ...without } = cashier.doc('orders', o.id);
  assert.equal((await cashier.put('orders', without)).status, 'error');
  // 20.00 − 10% = 18.00, + 7% = 19.26
  const paid = await pay(cashier, o, 19.26);
  assert.equal(paid.status, 'ok', paid.error);
  assert.equal(paid.doc.totals.discount, 2);
});

test('customers with bills cannot be deleted; points and bills show in the activity log', async () => {
  const admin = await login('Admin', '1234');
  const del = await call('/api/sync', { token: admin.token, method: 'POST', body: { changes: [{ col: 'customers', id: 'c_ann', base: admin.vers['customers/c_ann'], deleted: true }] } });
  assert.equal(del.data.results[0].status, 'error');
  assert.match(del.data.results[0].error, /has bills/);
  const unused = await admin.put('customers', { id: 'c_tmp', name: 'Temp' });
  assert.equal(unused.status, 'ok');
  const gone = await call('/api/sync', { token: admin.token, method: 'POST', body: { changes: [{ col: 'customers', id: 'c_tmp', base: unused.ver, deleted: true }] } });
  assert.equal(gone.data.results[0].status, 'ok');
  const { rows } = (await call('/api/audit', { token: admin.token })).data;
  assert.ok(rows.some(r => r.action === 'order paid' && /points used/.test(r.detail)));
});

test('odd values from a device are refused cleanly instead of crashing the server', async () => {
  const cashier = await login('Maya', '1111');
  const admin = await login('Admin', '1234');
  for (const odd of [{ customerId: { x: 1 } }, { customerId: 42 }, { customerId: ['c_ann'] }, { discount: { type: 'percent', value: 5, customerId: {} } }]) {
    const res = await cashier.put('orders', order(cashier, [line(cashier, 'Latte', 1)], odd));
    assert.equal(res.status, 'error', JSON.stringify(odd));
  }
  const junk = await cashier.put('orders', order(cashier, [line(cashier, 'Latte', 1)], { pointsUsed: 'lots' }));
  assert.equal(junk.status, 'ok');
  assert.equal(junk.doc.pointsUsed, undefined, 'an unreadable number counts as no points');
  assert.equal((await admin.put('purchases', { id: 'pu_odd', lines: [{ ingredientId: { a: 1 }, qty: 1, total: 1 }] })).status, 'error');
  assert.equal((await admin.put('stocktakes', { id: 'st_odd', lines: [{ kind: 'ingredient', refId: { a: 1 }, counted: 1 }] })).status, 'error');
  assert.equal((await admin.put('products', { ...admin.find('products', p => p.name === 'Latte')[0], recipe: [{ ingredientId: { a: 1 }, qty: 1 }] })).status, 'error');
  assert.equal((await call('/api/public')).status, 200, 'the server is still up');
});
