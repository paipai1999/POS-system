'use strict';

// Tips, split payments, bill splitting, priced options and the cash drawer. Run with:  node --test server/test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start } = require('../server.js');
const { computeShift, paymentByMethod, paymentCash } = require('../../js/shared.js');

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
  remember(r) { this.vers[r.col + '/' + r.id] = r.ver; this.docs[r.col + '/' + r.id] = r.deleted ? null : (r.doc ?? r.data); }
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

const line = (dev, name, qty, extra = {}) => {
  const p = dev.find('products', x => x.name === name)[0];
  return { id: 'l_' + Math.random().toString(36).slice(2), productId: p.id, name: p.name, price: p.price, qty, note: '', sentQty: 0, ...extra };
};
const order = (dev, items, extra = {}) => ({
  id: 'o_' + Math.random().toString(36).slice(2), number: null, tableId: null, tableName: '', staffId: dev.user.id,
  status: 'open', note: '', discount: null, createdAt: Date.now(), items, ...extra,
});
const pay = (dev, o, payment, total) => dev.put('orders', { ...dev.doc('orders', o.id), status: 'paid', totals: { total }, payment });

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-feat-'));
  app = start({ port: 0, dataDir, quiet: true });
  await new Promise(r => app.server.once('listening', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

test.after(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('a tip is added to what the customer pays; change is worked out after the tip', async () => {
  const cashier = await login('Maya', '1111');
  const o1 = (await cashier.put('orders', order(cashier, [line(cashier, 'Latte', 2)]))).doc;     // 8.00 + 7% = 8.56
  const short = await pay(cashier, o1, { method: 'cash', tendered: 9, tip: 1 }, 8.56);            // needs 9.56
  assert.equal(short.status, 'error');
  assert.match(short.error, /less than the total/);
  const ok = await pay(cashier, o1, { method: 'cash', tendered: 10, tip: 1 }, 8.56);
  assert.equal(ok.status, 'ok', ok.error);
  assert.equal(ok.doc.payment.tip, 1);
  assert.equal(ok.doc.payment.amount, 8.56);
  assert.equal(ok.doc.payment.change, 0.44);
  assert.equal(paymentCash(ok.doc.payment), 9.56, 'bill + tip stayed in the till');

  const o2 = (await cashier.put('orders', order(cashier, [line(cashier, 'Latte', 1)]))).doc;
  const bad = await pay(cashier, o2, { method: 'card', tip: -5 }, 4.28);
  assert.equal(bad.status, 'error');
  assert.equal((await pay(cashier, o2, { method: 'card', tip: 'abc' }, 4.28)).status, 'error');
  const card = await pay(cashier, o2, { method: 'card', tip: 0.5 }, 4.28);
  assert.equal(card.status, 'ok');
  assert.deepEqual(paymentByMethod(card.doc.payment), { card: 4.78 });
});

test('a bill can be paid part by cash and part by card', async () => {
  const cashier = await login('Maya', '1111');
  const o = (await cashier.put('orders', order(cashier, [line(cashier, 'Latte', 5)]))).doc;   // 20 + 7% = 21.40
  const total = 21.4;
  const parts = p => ({ method: 'split', parts: p });

  for (const bad of [
    parts([{ method: 'cash', amount: 10, tendered: 10 }]),                                       // only one part
    parts([{ method: 'cash', amount: 10, tendered: 10 }, { method: 'card', amount: 10 }]),       // adds up to 20
    parts([{ method: 'cash', amount: 10, tendered: 10 }, { method: 'cash', amount: 11.4 }]),     // same method twice
    parts([{ method: 'cash', amount: 10, tendered: 5 }, { method: 'card', amount: 11.4 }]),      // cash given < cash part
    parts([{ method: 'bitcoin', amount: 10 }, { method: 'card', amount: 11.4 }]),
    parts([{ method: 'cash', amount: -1 }, { method: 'card', amount: 22.4 }]),
  ]) {
    assert.equal((await pay(cashier, o, bad, total)).status, 'error', JSON.stringify(bad));
  }
  const ok = await pay(cashier, o, parts([{ method: 'cash', amount: 10, tendered: 20 }, { method: 'card', amount: 11.4 }]), total);
  assert.equal(ok.status, 'ok', ok.error);
  assert.equal(ok.doc.payment.parts[0].change, 10);
  assert.deepEqual(paymentByMethod(ok.doc.payment), { cash: 10, card: 11.4 });
  assert.equal(paymentCash(ok.doc.payment), 10, 'only the cash part goes into the drawer');
});

test('items can be moved to a new bill in one safe step', async () => {
  const waiter = await login('Leo', '2222');
  const table = waiter.find('tables', () => true)[0];
  const o = order(waiter, [line(waiter, 'Latte', 3, { sentQty: 2 }), line(waiter, 'Espresso', 1)], { tableId: table.id, tableName: table.name });
  const made = (await waiter.put('orders', o)).doc;
  const latte = made.items[0].id;

  const split = (body) => call('/api/orders/split', { token: waiter.token, method: 'POST', body });
  assert.equal((await split({ orderId: made.id, base: 999, moves: [{ lineId: latte, qty: 1 }] })).status, 400, 'a stale copy is refused');
  const ver = waiter.vers['orders/' + made.id];
  assert.equal((await split({ orderId: made.id, base: ver, moves: [{ lineId: latte, qty: 9 }] })).status, 400, 'cannot move more than exists');
  assert.equal((await split({ orderId: made.id, base: ver, moves: [{ lineId: latte, qty: 3 }, { lineId: made.items[1].id, qty: 1 }] })).status, 400, 'something must stay on the original bill');
  assert.equal((await split({ orderId: made.id, base: ver, moves: [] })).status, 400);

  const res = await split({ orderId: made.id, base: ver, moves: [{ lineId: latte, qty: 2 }] });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const [src, created] = res.data.rows.map(r => r.data);
  assert.equal(src.items.find(l => l.name === 'Latte').qty, 1);
  assert.equal(created.items[0].qty, 2);
  assert.equal(created.items[0].price, made.items[0].price);
  assert.equal(created.splitFrom, made.id);
  assert.equal(created.tableName, table.name);
  assert.equal(created.tableId, null);
  assert.ok(Number.isInteger(created.number) && created.number !== src.number, 'the new bill gets its own number');
  // 2 of the 3 Lattes were already sent to the kitchen: the sent count is shared out, never invented.
  assert.equal(src.items.find(l => l.name === 'Latte').sentQty + created.items[0].sentQty, 2);
  const totalQty = [...src.items, ...created.items].filter(l => l.name === 'Latte').reduce((n, l) => n + l.qty, 0);
  assert.equal(totalQty, 3, 'nothing lost, nothing doubled');
  // Both bills can be paid on their own.
  const cashier = await login('Maya', '1111');
  assert.equal((await pay(cashier, created, { method: 'card' }, 8.56)).status, 'ok');

  const kitchen = await login('Kitchen', '3333');
  const denied = await call('/api/orders/split', { token: kitchen.token, method: 'POST', body: { orderId: made.id, base: 1, moves: [] } });
  assert.equal(denied.status, 400);
  assert.match(denied.data.error, /permission/);
});

test('priced options must be ones the menu offers, at the menu price', async () => {
  const admin = await login('Admin', '1234');
  const waiter = await login('Leo', '2222');
  const latte = admin.find('products', p => p.name === 'Latte')[0];
  const set = await admin.put('products', { ...latte, options: [{ name: 'Extra shot', price: 0.5 }, { name: 'Large', price: 1 }] });
  assert.equal(set.status, 'ok', set.error);
  assert.equal((await admin.put('products', { ...set.doc, options: [{ name: 'A', price: 1 }, { name: 'A', price: 2 }] })).status, 'error', 'duplicate names');
  assert.equal((await admin.put('products', { ...set.doc, options: [{ name: 'Free', price: -1 }] })).status, 'error', 'negative price');
  assert.equal((await admin.put('products', { ...set.doc, options: Array.from({ length: 9 }, (_, i) => ({ name: 'o' + i, price: 1 })) })).status, 'error', 'too many');
  await waiter.load();

  const withMods = (mods, price) => order(waiter, [{ ...line(waiter, 'Latte', 1), mods, price }]);
  const ok = await waiter.put('orders', withMods([{ name: 'Extra shot', price: 0.5 }, { name: 'Large', price: 1 }], 5.5));
  assert.equal(ok.status, 'ok', ok.error);
  assert.equal((await waiter.put('orders', withMods([{ name: 'Extra shot', price: 0.5 }], 4))).status, 'error', 'price must include the option');
  assert.equal((await waiter.put('orders', withMods([{ name: 'Extra shot', price: 0 }], 4))).status, 'error', 'option price cannot be changed');
  assert.equal((await waiter.put('orders', withMods([{ name: 'Gold leaf', price: 0 }], 4))).status, 'error', 'unknown option');
  assert.equal((await waiter.put('orders', withMods([{ name: 'Large', price: 1 }, { name: 'Large', price: 1 }], 6))).status, 'error', 'same option twice');
  assert.equal((await waiter.put('orders', withMods('x', 4))).status, 'error');

  // Options on a line cannot be edited afterwards.
  const edited = waiter.doc('orders', ok.doc.id);
  edited.items[0].mods = [];
  edited.items[0].price = 4;
  assert.equal((await waiter.put('orders', edited)).status, 'error');
});

test('the cash drawer: open, take cash, refund, close; the server works out what should be there', async () => {
  const cashier = await login('Maya', '1111');
  const waiter = await login('Leo', '2222');
  const admin = await login('Admin', '1234');

  assert.equal((await waiter.put('shifts', { id: 's_w', openingFloat: 50 })).status, 'error', 'waiters cannot open the drawer');
  assert.equal((await cashier.put('shifts', { id: 's_bad', openingFloat: -5 })).status, 'error');
  const opened = await cashier.put('shifts', { id: 's_1', openingFloat: 100, openedAt: 1, expectedCash: 99999 });
  assert.equal(opened.status, 'ok', opened.error);
  assert.equal(opened.doc.openingFloat, 100);
  assert.ok(opened.doc.openedAt > 1000, 'the opening time comes from the server');
  assert.equal(opened.doc.expectedCash, undefined, 'figures sent by a device are ignored');
  assert.equal((await admin.put('shifts', { id: 's_2', openingFloat: 10 })).status, 'error', 'only one shift at a time');

  // 8.56 cash with a 1.00 tip, a card sale and a split sale.
  const sale = async (items, payment, total) => {
    const o = (await cashier.put('orders', order(cashier, items))).doc;
    const r = await pay(cashier, o, payment, total);
    assert.equal(r.status, 'ok', r.error);
    return r.doc;
  };
  const cashSale = await sale([line(cashier, 'Latte', 2)], { method: 'cash', tendered: 10, tip: 1 }, 8.56);   // +9.56 cash
  await sale([line(cashier, 'Latte', 1)], { method: 'card' }, 4.28);                                           // no cash
  await sale([line(cashier, 'Latte', 5)], { method: 'split', parts: [{ method: 'cash', amount: 10, tendered: 20 }, { method: 'card', amount: 11.4 }] }, 21.4); // +10 cash

  // Refund the first sale: its cash goes back out.
  await call('/api/verify-pin', { token: cashier.token, method: 'POST', body: { pin: '1234' } });
  const refunded = await cashier.put('orders', { ...cashier.doc('orders', cashSale.id), status: 'refunded', refundedBy: admin.user.id });
  assert.equal(refunded.status, 'ok', refunded.error);

  // 100 + 9.56 + 10 − 9.56 = 110.00 should be in the drawer.
  const wrong = await cashier.put('shifts', { id: 's_1', countedCash: 107.5, note: '  short  ' });
  assert.equal(wrong.status, 'ok', wrong.error);
  assert.equal(wrong.doc.expectedCash, 110);
  assert.equal(wrong.doc.difference, -2.5);
  assert.equal(wrong.doc.cashIn, 19.56);
  assert.equal(wrong.doc.cashOut, 9.56);
  assert.equal(wrong.doc.tips, 1);
  assert.equal(wrong.doc.orders, 3);
  assert.equal(wrong.doc.note, 'short');
  assert.ok(wrong.doc.closedAt >= wrong.doc.openedAt);
  assert.equal(wrong.doc.closedBy, cashier.user.id);

  assert.equal((await cashier.put('shifts', { id: 's_1', countedCash: 110 })).status, 'error', 'a closed shift cannot be changed');
  await admin.load();
  assert.equal((await admin.put('shifts', { id: 's_1', countedCash: 1 })).status, 'error', 'a closed shift cannot be changed by anyone');

  // The shift record appears in the activity log, with the difference.
  const { rows } = (await call('/api/audit', { token: admin.token })).data;
  assert.match(rows.find(r => r.action === 'shift closed with a difference').detail, /counted 107\.5, expected 110, difference -2\.5/);
  assert.ok(rows.find(r => r.action === 'shift opened'));

  // Only cashiers, managers and admins receive shift records.
  await waiter.load();
  assert.ok(!waiter.find('shifts', () => true).length);
  await admin.load();
  assert.equal(admin.find('shifts', () => true).length, 1);
});

test('the drawer sums are the same whether the browser or the server works them out', () => {
  const orders = [
    { status: 'paid', paidAt: 10, totals: { total: 8.56 }, payment: { method: 'cash', amount: 8.56, tip: 1, tendered: 10, change: 0.44 } },
    { status: 'refunded', paidAt: 20, refundedAt: 30, totals: { total: 4 }, payment: { method: 'cash', amount: 4, tendered: 4, change: 0 } },
    { status: 'paid', paidAt: 5, totals: { total: 100 }, payment: { method: 'cash', amount: 100 } }, // before the shift
    { status: 'paid', paidAt: 40, totals: { total: 7 }, payment: { method: 'card', amount: 7 } },
  ];
  const sums = computeShift({ openedAt: 8, openingFloat: 50 }, orders);
  assert.deepEqual(sums, { cashIn: 13.56, cashOut: 4, tips: 1, sales: 19.56, orders: 3, expected: 59.56 });
});
