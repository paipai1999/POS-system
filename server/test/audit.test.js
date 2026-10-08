'use strict';

// The activity log. Run with:  node --test server/test
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
  assert.equal(r.status, 200);
  const dev = new Device(r.data.token, r.data.user);
  await dev.load();
  return dev;
}

const log = async (dev, query = '') => (await call('/api/audit' + query, { token: dev.token })).data;
const find = (rows, action) => rows.find(r => r.action === action);

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-audit-'));
  app = start({ port: 0, dataDir, quiet: true });
  await new Promise(r => app.server.once('listening', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

test.after(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('only an admin can read the activity log', async () => {
  const waiter = await login('Leo', '2222');
  assert.equal((await call('/api/audit', { token: waiter.token })).status, 403);
  assert.equal((await call('/api/audit')).status, 401);
});

test('price, stock, staff and settings changes are recorded with who made them', async () => {
  const admin = await login('Admin', '1234');
  const latte = admin.find('products', p => p.name === 'Latte')[0];
  assert.equal((await admin.put('products', { ...latte, price: 4.5 })).status, 'ok');
  const brownie = admin.find('products', p => p.name === 'Chocolate Brownie')[0];
  assert.equal((await admin.put('products', { ...brownie, stock: brownie.stock + 12 })).status, 'ok');
  assert.equal((await admin.put('settings', { ...admin.doc('settings', 'main'), taxRate: 10 }, 'main')).status, 'ok');
  const leo = admin.find('users', u => u.name === 'Leo')[0];
  assert.equal((await admin.put('users', { ...leo, role: 'cashier', pin: '6543' })).status, 'ok');

  const { rows } = await log(admin);
  const price = find(rows, 'price changed');
  assert.equal(price.user, 'Admin');
  assert.equal(price.target, 'Latte');
  assert.equal(price.detail, 'price 4 → 4.5');
  assert.match(find(rows, 'item edited').detail, /stock 10 → 22/);
  assert.match(find(rows, 'settings changed').detail, /taxRate 7 → 10/);
  const staff = find(rows, 'staff PIN/role changed');
  assert.equal(staff.target, 'Leo');
  assert.match(staff.detail, /role waiter → cashier/);
  assert.match(staff.detail, /PIN changed/);
  assert.ok(!JSON.stringify(rows).includes('6543'), 'the new PIN itself is never written to the log');
});

test('voids, refunds and discounts are recorded with the manager who approved them', async () => {
  const admin = await login('Admin', '1234');
  const cashier = await login('Maya', '1111');
  const adminId = admin.user.id;
  const mk = (dev, lines) => ({
    id: 'o_' + Math.random().toString(36).slice(2), number: null, tableId: null, tableName: '', staffId: dev.user.id,
    status: 'open', note: '', discount: null, createdAt: Date.now(),
    items: lines.map(([name, qty], i) => {
      const p = dev.find('products', x => x.name === name)[0];
      return { id: 'l_' + i, productId: p.id, name: p.name, price: p.price, qty, note: '', sentQty: 0 };
    }),
  });

  // Discount (needs the manager's PIN on this device), then pay.
  const order = (await cashier.put('orders', mk(cashier, [['Espresso', 2]]))).doc;
  assert.equal((await call('/api/verify-pin', { token: cashier.token, method: 'POST', body: { pin: '1234' } })).status, 200);
  const discounted = await cashier.put('orders', { ...order, discount: { type: 'percent', value: 10, by: adminId } });
  assert.equal(discounted.status, 'ok', discounted.error);
  const total = Math.round((5 * 0.9 * 1.1) * 100) / 100;
  const paid = await cashier.put('orders', { ...discounted.doc, status: 'paid', totals: { total }, payment: { method: 'cash', tendered: 20 } });
  assert.equal(paid.status, 'ok', paid.error);

  // Refund.
  const refunded = await cashier.put('orders', { ...paid.doc, status: 'refunded', refundedBy: adminId });
  assert.equal(refunded.status, 'ok', refunded.error);

  // Void another order.
  const second = (await cashier.put('orders', mk(cashier, [['Latte', 1]]))).doc;
  const voided = await cashier.put('orders', { ...second, status: 'void', voidedBy: adminId });
  assert.equal(voided.status, 'ok', voided.error);

  const { rows } = await log(admin);
  assert.match(find(rows, 'discount applied').detail, /10% approved by Admin/);
  assert.equal(find(rows, 'discount applied').user, 'Maya');
  assert.match(find(rows, 'order paid').detail, /by cash.*discount 10%/);
  assert.match(find(rows, 'order refunded').detail, /approved by Admin/);
  assert.match(find(rows, 'order voided').detail, /approved by Admin/);
});

test('sign-ins, lockouts, exports and PIN changes are recorded; imports do not erase the log', async () => {
  const users = (await call('/api/public')).data.users;
  const leo = users.find(u => u.name === 'Leo');
  for (let i = 0; i < 5; i++) await call('/api/login', { method: 'POST', body: { userId: leo.id, pin: '0001' } });
  await app.close();
  app = start({ port: 0, dataDir, quiet: true }); // a restart also clears the lockout
  await new Promise(r => app.server.once('listening', r));
  base = `http://127.0.0.1:${app.server.address().port}`;

  const admin = await login('Admin', '1234');
  const exported = (await call('/api/export', { token: admin.token })).data;
  assert.equal((await call('/api/me/pin', { token: admin.token, method: 'POST', body: { pin: '482915' } })).status, 200);
  assert.equal((await call('/api/import', { token: admin.token, method: 'POST', body: exported })).status, 200);

  const admin2 = await login('Admin', '1234');
  const { rows } = await log(admin2);
  assert.ok(find(rows, 'signed in'));
  assert.match(find(rows, 'sign-in blocked').detail, /5 wrong PINs/);
  assert.ok(find(rows, 'data exported'));
  assert.ok(find(rows, 'own PIN changed'));
  assert.match(find(rows, 'backup imported').detail, /replaced all data/);
  assert.ok(find(rows, 'price changed'), 'entries from before the import are still there');
});

test('the log is read in pages, newest first', async () => {
  const admin = await login('Admin', '1234');
  for (let i = 0; i < 7; i++) app.db.addAudit({ user: { id: 'x', name: 'Test' }, action: 'test entry', target: String(i) });
  const first = await log(admin, '?limit=5');
  assert.equal(first.rows.length, 5);
  assert.equal(first.rows[0].target, '6');
  assert.equal(first.more, true);
  const second = await log(admin, '?limit=5&before=' + first.rows[4].id);
  assert.ok(second.rows.every(r => r.id < first.rows[4].id));
  assert.ok(second.rows.some(r => r.target === '1'));
  for (let i = 1; i < first.rows.length; i++) assert.ok(first.rows[i].id < first.rows[i - 1].id);
});
