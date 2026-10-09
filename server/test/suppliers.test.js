'use strict';

// Suppliers, what is owed to them, and paying them. Run with:  node --test server/test
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
  async remove(col, id) {
    const { data } = await call('/api/sync', { token: this.token, method: 'POST', body: { changes: [{ col, id, base: this.vers[col + '/' + id] || 0, deleted: true }] } });
    return data.results[0];
  }
}

async function login(name, pin) {
  const users = (await call('/api/public')).data.users;
  const r = await call('/api/login', { method: 'POST', body: { userId: users.find(u => u.name === name).id, pin } });
  const dev = new Device(r.data.token, r.data.user);
  await dev.load();
  return dev;
}

const supplier = id => app.db.doc('suppliers', id);
const beans = () => app.db.all('ingredients').find(i => i.name === 'Coffee beans');
const purchase = (extra = {}) => ({ id: 'pu_' + Math.random().toString(36).slice(2), lines: [{ ingredientId: beans().id, qty: 1000, total: 40 }], ...extra });

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-sup-'));
  app = start({ port: 0, dataDir, quiet: true });
  await new Promise(r => app.server.once('listening', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

test.after(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('suppliers are for managers; the amount owed is kept by the server', async () => {
  const admin = await login('Admin', '1234');
  const cashier = await login('Maya', '1111');
  assert.equal((await cashier.put('suppliers', { id: 's_c', name: 'Nope' })).status, 'error');
  assert.equal((await admin.put('suppliers', { id: 's_bad', name: '' })).status, 'error');
  assert.equal((await admin.put('suppliers', { id: 's_bad', name: 'X', phone: 'call' })).status, 'error');
  const made = await admin.put('suppliers', { id: 's_gv', name: ' Green Valley ', phone: '09 123 456', note: 'dairy', owed: 99999 });
  assert.equal(made.status, 'ok', made.error);
  assert.deepEqual([made.doc.name, made.doc.owed, made.doc.active], ['Green Valley', 0, true], 'a device cannot set what is owed');
  assert.equal((await admin.put('suppliers', { id: 's_dup', name: 'green valley' })).status, 'error', 'the same name twice');
  const edited = await admin.put('suppliers', { ...made.doc, owed: 5, note: 'dairy and eggs' });
  assert.equal(edited.doc.owed, 0);
  assert.equal(edited.doc.note, 'dairy and eggs');
  await cashier.load();
  assert.equal(cashier.find('suppliers', () => true).length, 0, 'cashiers do not receive suppliers');
});

test('a purchase not paid in full adds to what is owed; voiding takes it back', async () => {
  const admin = await login('Admin', '1234');
  const cashier = await login('Maya', '1111');

  assert.equal((await admin.put('purchases', purchase({ supplierId: 'nope' }))).status, 'error', 'unknown supplier');
  assert.equal((await admin.put('purchases', purchase({ supplierId: 's_gv', paid: 41 }))).status, 'error', 'paid more than the total');
  assert.equal((await admin.put('purchases', purchase({ supplierId: 's_gv', paid: -1 }))).status, 'error');
  assert.equal((await admin.put('purchases', purchase({ paid: 10 }))).status, 'error', 'an amount owed needs a supplier on the list');
  assert.equal(supplier('s_gv').owed, 0, 'refused purchases change nothing');

  const paidInFull = await admin.put('purchases', purchase({ supplierId: 's_gv' }));
  assert.equal(paidInFull.status, 'ok', paidInFull.error);
  assert.equal(paidInFull.doc.paid, 40, 'paid in full unless said otherwise');
  assert.equal(paidInFull.doc.supplier, 'Green Valley');
  assert.equal(supplier('s_gv').owed, 0);

  const onCredit = await admin.put('purchases', purchase({ supplierId: 's_gv', paid: 15 }));
  assert.equal(onCredit.status, 'ok', onCredit.error);
  assert.equal(supplier('s_gv').owed, 25);
  const second = await admin.put('purchases', purchase({ supplierId: 's_gv', paid: 0 }));
  assert.equal(supplier('s_gv').owed, 65);

  assert.notEqual((await cashier.put('purchases', { ...onCredit.doc, status: 'void' })).status, 'ok');
  const voided = await admin.put('purchases', { ...second.doc, status: 'void' });
  assert.equal(voided.status, 'ok', voided.error);
  assert.equal(supplier('s_gv').owed, 25, 'voiding it removes what it added');

  // A purchase typed with just a name (no supplier on the list) still works, paid in full.
  const plain = await admin.put('purchases', purchase({ supplier: 'Market stall' }));
  assert.equal(plain.status, 'ok');
  assert.equal(plain.doc.supplier, 'Market stall');
  assert.equal(plain.doc.supplierId, undefined);
});

test('paying a supplier takes from what is owed, never more, and a payment can be voided', async () => {
  const admin = await login('Admin', '1234');
  const cashier = await login('Maya', '1111');
  const pay = (extra = {}) => ({ id: 'sp_' + Math.random().toString(36).slice(2), supplierId: 's_gv', amount: 10, method: 'other', ...extra });

  assert.equal((await cashier.put('supplierPayments', pay())).status, 'error');
  assert.equal((await admin.put('supplierPayments', pay({ supplierId: 'nope' }))).status, 'error');
  assert.equal((await admin.put('supplierPayments', pay({ amount: 0 }))).status, 'error');
  assert.equal((await admin.put('supplierPayments', pay({ amount: -3 }))).status, 'error');
  const over = await admin.put('supplierPayments', pay({ amount: 26 }));
  assert.equal(over.status, 'error');
  assert.match(over.error, /Only 25 is owed to Green Valley/);

  const first = await admin.put('supplierPayments', pay({ amount: 10, note: 'cheque 17' }));
  assert.equal(first.status, 'ok', first.error);
  assert.deepEqual([first.doc.supplierName, first.doc.status, first.doc.method, first.doc.by], ['Green Valley', 'paid', 'other', admin.user.id]);
  assert.equal(supplier('s_gv').owed, 15);
  const rest = await admin.put('supplierPayments', pay({ amount: 15, method: 'cash' }));
  assert.equal(rest.status, 'ok', rest.error);
  assert.equal(supplier('s_gv').owed, 0);

  assert.equal((await admin.put('supplierPayments', { ...first.doc, amount: 1 })).status, 'error', 'a payment cannot be edited');
  const del = await admin.remove('supplierPayments', first.doc.id);
  assert.equal(del.status, 'error');
  const voided = await admin.put('supplierPayments', { ...first.doc, status: 'void' });
  assert.equal(voided.status, 'ok', voided.error);
  assert.equal(supplier('s_gv').owed, 10, 'the 10 is owed again');
  assert.equal((await admin.put('supplierPayments', { ...voided.doc, status: 'void' })).status, 'error', 'cannot void twice');
});

test('a supplier with money owed or history cannot be deleted', async () => {
  const admin = await login('Admin', '1234');
  const owed = await admin.remove('suppliers', 's_gv');
  assert.equal(owed.status, 'error');
  assert.match(owed.error, /still owed money/);
  await admin.put('supplierPayments', { id: 'sp_clear', supplierId: 's_gv', amount: 10, method: 'other' });
  await admin.load(); // the payment changed the supplier's version
  const history = await admin.remove('suppliers', 's_gv');
  assert.equal(history.status, 'error');
  assert.match(history.error, /on record/);
  const fresh = await admin.put('suppliers', { id: 's_tmp', name: 'Temp' });
  assert.equal((await admin.remove('suppliers', 's_tmp')).status, 'ok');
  assert.ok(fresh);
});

test('cash paid to a supplier leaves the till: the drawer expects less, and the cashier sees only that', async () => {
  const admin = await login('Admin', '1234');
  const cashier = await login('Maya', '1111');
  await admin.put('purchases', purchase({ supplierId: 's_gv', paid: 0 }));            // 40 owed
  assert.equal((await cashier.put('shifts', { id: 'sh_1', openingFloat: 100 })).status, 'ok');

  const cashPay = await admin.put('supplierPayments', { id: 'sp_cash', supplierId: 's_gv', amount: 12, method: 'cash', note: 'for the eggs' });
  assert.equal(cashPay.status, 'ok', cashPay.error);
  const bankPay = await admin.put('supplierPayments', { id: 'sp_bank', supplierId: 's_gv', amount: 8, method: 'other' });
  assert.equal(bankPay.status, 'ok');

  await cashier.load();
  const seen = cashier.find('supplierPayments', () => true);
  assert.ok(seen.some(p => p.id === 'sp_cash'), 'the cash payment is sent to the cashier');
  assert.ok(!seen.some(p => p.id === 'sp_bank'), 'the bank payment is not');
  assert.ok(seen.every(p => p.method === 'cash'));
  assert.deepEqual(Object.keys(seen.find(p => p.id === 'sp_cash')).sort(), ['amount', 'date', 'id', 'method', 'status'], 'with no supplier name or note');

  const closed = await cashier.put('shifts', { id: 'sh_1', countedCash: 88 });
  assert.equal(closed.status, 'ok', closed.error);
  assert.equal(closed.doc.payouts, 12);
  assert.equal(closed.doc.expectedCash, 88, '100 − 12 paid to a supplier');
  assert.equal(closed.doc.difference, 0);
  const { rows } = (await call('/api/audit', { token: admin.token })).data;
  assert.match(rows.find(r => r.action === 'supplier paid').detail, /(12 \(cash\)|8 \(other\))/);
  assert.ok(rows.find(r => r.action === 'supplier added'));
});

test('odd values from a device are refused cleanly', async () => {
  const admin = await login('Admin', '1234');
  assert.equal((await admin.put('purchases', purchase({ supplierId: { a: 1 } }))).status, 'error');
  assert.equal((await admin.put('supplierPayments', { id: 'sp_odd', supplierId: ['s_gv'], amount: 1 })).status, 'error');
  assert.equal((await admin.put('suppliers', { id: 's_odd', name: { x: 1 } })).status, 'error');
  assert.equal((await call('/api/public')).status, 200);
});
