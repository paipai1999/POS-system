'use strict';

// Order history: period, filters, search, sort, totals, the detail view and the CSV of the filtered list. Run with:  npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM, startServer, openApp } = require('./harness.js');

const opts = JSDOM ? {} : { skip: 'jsdom is not installed (run "npm install" once)' };

let srv;
const tabs = [];
const open = async o => { const t = await openApp(srv.base, o); tabs.push(t); return t; };

test.before(async () => { if (JSDOM) srv = await startServer(); });
test.after(async () => {
  tabs.forEach(t => { try { t.close(); } catch (e) { /* already closed */ } });
  if (srv) await srv.stop();
});

const DAY = 24 * 3600 * 1000;
const startOfToday = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
const todayAt = minute => startOfToday + minute * 60000;   // minutes after midnight, so a test is the same at any time of day
const db = () => srv.app.db;
const user = name => db().all('users').find(u => u.name === name);
const product = name => db().all('products').find(p => p.name === name);
const table = i => db().all('tables')[i];

// Writes finished bills straight into the database (the screen only reads them).
function bill({ number, tableIdx = null, staff = 'Leo', lines, status = 'paid', method = 'cash', parts = null, at, customer = null, note = '', discount = null, refunded = false }) {
  const items = lines.map(([name, qty]) => { const p = product(name); return { id: 'l_' + number + name, productId: p.id, name, price: p.price, qty, sentQty: qty, note: '' }; });
  const subtotal = Math.round(items.reduce((n, l) => n + l.price * l.qty, 0) * 100) / 100;
  const discountAmt = discount ? Math.round(subtotal * discount / 100 * 100) / 100 : 0;
  const total = Math.round((subtotal - discountAmt) * 100) / 100;
  const o = {
    id: 'o_hist' + number, number, tableId: tableIdx === null ? null : table(tableIdx).id, tableName: tableIdx === null ? '' : table(tableIdx).name,
    staffId: user(staff).id, cashierId: user('Maya').id, status, note, createdAt: at - 10000, items,
    discount: discount ? { type: 'percent', value: discount, by: user('Admin').id } : null,
    customerId: customer,
  };
  if (status === 'paid' || status === 'refunded') {
    o.paidAt = at;
    o.totals = { subtotal, discount: discountAmt, points: 0, service: 0, serviceRate: 0, tax: 0, taxRate: 0, total };
    o.payment = parts
      ? { method: 'split', amount: total, tip: 0, parts: parts.map(([m, a]) => ({ method: m, amount: a, tendered: a })) }
      : { method, amount: total, tip: 0, tendered: total };
  }
  if (status === 'refunded') { o.refundedAt = at + 600000; o.refundedBy = user('Admin').id; }
  db().put('orders', o.id, o);
  return o;
}

const rowsText = tab => tab.$$('table.data tbody tr.clickable').map(r => r.textContent.replace(/\s+/g, ' ').trim());
const numbers = tab => tab.$$('table.data tbody tr.clickable td:first-child').map(td => td.textContent.trim());

test('the order history: period, filters, search, sort and totals', opts, async () => {
  const esp = product('Espresso').price, latte = product('Latte').price;
  const customer = { id: 'c_hist', name: 'Daw Hla', phone: '09123', points: 0, spent: 0, visits: 0, createdAt: Date.now() };
  db().put('customers', customer.id, customer);
  bill({ number: 101, tableIdx: 0, staff: 'Leo', lines: [['Espresso', 2]], method: 'cash', at: todayAt(1) });
  bill({ number: 102, tableIdx: 1, staff: 'Maya', lines: [['Latte', 1], ['Espresso', 1]], method: 'card', at: todayAt(2), customer: customer.id, discount: 10 });
  bill({ number: 103, staff: 'Maya', lines: [['Latte', 3]], parts: [['cash', 5], ['card', 5.45]], at: todayAt(3), note: 'birthday' });
  bill({ number: 104, tableIdx: 0, staff: 'Leo', lines: [['Espresso', 1]], status: 'refunded', at: todayAt(4) });
  bill({ number: 105, tableIdx: 2, staff: 'Leo', lines: [['Espresso', 1]], status: 'open', at: todayAt(5) });
  bill({ number: 106, staff: 'Maya', lines: [['Latte', 1]], method: 'cash', at: startOfToday - 3600000 });          // yesterday
  bill({ number: 107, staff: 'Maya', lines: [['Latte', 1]], method: 'cash', at: startOfToday - 20 * DAY });               // this month or last month

  const admin = await open();
  await admin.signIn('Admin', '1234', '482915');
  admin.click('[data-nav=orders]');
  await admin.until(() => admin.screen() === 'orders');

  // Today: five of them, newest first.
  assert.deepEqual(numbers(admin), ['#105', '#104', '#103', '#102', '#101']);
  const stats = () => admin.text('.stats');
  assert.match(stats(), /Orders\s*5/);
  const sales = Math.round(((2 * esp) + ((latte + esp) * 0.9) + latte * 3) * 100) / 100;
  assert.ok(stats().includes('$' + sales.toFixed(2)), `sales ${sales} in ${stats()}`);
  assert.match(stats(), /Refunds\s*\$\d+\.\d\d\s*1 order/);
  assert.match(stats(), /Items sold\s*7/, '2 + 2 + 3 paid items; the open and refunded ones do not count');

  // Status, payment method (a split bill counts under each method it used), server, table.
  const pick = (role, value) => admin.type(`[data-role=${role}]`, value);
  pick('status', 'paid');
  assert.deepEqual(numbers(admin), ['#103', '#102', '#101']);
  pick('status', 'all'); pick('method', 'card');
  assert.deepEqual(numbers(admin), ['#103', '#102'], 'card and the card part of the split bill');
  pick('method', 'split');
  assert.deepEqual(numbers(admin), ['#103']);
  pick('method', 'all'); pick('staff', user('Leo').id);
  assert.deepEqual(numbers(admin), ['#105', '#104', '#101']);
  pick('staff', 'all'); pick('where', 'takeaway');
  assert.deepEqual(numbers(admin), ['#103'], 'takeaway orders have no table');
  pick('where', table(0).id);
  assert.deepEqual(numbers(admin), ['#104', '#101']);
  pick('where', 'all');

  // Search: number, dish, customer, table, note, with or without the #.
  const search = q => admin.type('[data-role=q]', q);
  search('#102'); assert.deepEqual(numbers(admin), ['#102']);
  search('daw hla'); assert.deepEqual(numbers(admin), ['#102'], 'by customer');
  search('birthday'); assert.deepEqual(numbers(admin), ['#103'], 'by order note');
  search('latte'); assert.deepEqual(numbers(admin), ['#103', '#102'], 'by dish');
  search(table(2).name); assert.deepEqual(numbers(admin), ['#105'], 'by table');
  search('nothing like this'); assert.deepEqual(numbers(admin), []);
  assert.match(admin.text('table.data tbody'), /No orders found/);
  search('');

  // Sorting.
  pick('sort', 'oldest'); assert.deepEqual(numbers(admin), ['#101', '#102', '#103', '#104', '#105']);
  pick('sort', 'highest');
  assert.equal(numbers(admin)[0], '#103', 'three lattes + the split bill is the biggest');
  pick('sort', 'lowest');
  assert.equal(numbers(admin)[numbers(admin).length - 1], '#103');
  pick('sort', 'newest');

  // Periods.
  admin.click('[data-act=range][data-range=yesterday]');
  assert.deepEqual(numbers(admin), ['#106']);
  admin.click('[data-act=range][data-range=week]');
  await admin.until(() => numbers(admin).length === 6, { what: 'seven days' });
  assert.ok(numbers(admin).includes('#106') && !numbers(admin).includes('#107'));
  admin.click('[data-act=range][data-range=all]');
  await admin.until(() => numbers(admin).length === 7, { what: 'everything' });
  admin.click('[data-act=range][data-range=custom]');
  const day = ms => { const d = new Date(Date.now() - ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  admin.type('[data-role=from]', day(21 * DAY));
  admin.type('[data-role=to]', day(19 * DAY));
  await admin.until(() => numbers(admin).join() === '#107', { what: 'a custom range of one day' });
  admin.type('[data-role=from]', day(0));
  admin.type('[data-role=to]', day(0));
  await admin.until(() => numbers(admin).length === 5, { what: 'back to today' });
});

test('the detail view of an order, and what it can do', opts, async () => {
  const admin = await open();
  await admin.signIn('Admin', '482915');
  admin.click('[data-nav=orders]');
  await admin.until(() => admin.screen() === 'orders');

  // A paid bill with a discount, a customer and a split payment.
  admin.click('tr.clickable[data-id="o_hist102"]');
  await admin.until(() => /^Order #102/.test(admin.modalTitle() || ''), { what: 'the detail view' });
  const m = () => admin.text('.modal');
  assert.match(m(), /Paid/);
  assert.match(m(), /Server\s*Maya/);
  assert.match(m(), /Cashier\s*Maya/);
  assert.match(m(), /Customer\s*Daw Hla/);
  assert.match(m(), /Discount\s*10%/);
  assert.match(m(), /Approved by\s*Admin/);
  assert.match(m(), /1\s*Latte/);
  assert.match(m(), /1\s*Espresso/);
  assert.match(m(), /Subtotal/);
  assert.match(m(), /Card/);
  assert.ok(admin.$('.modal [data-act=refund]'), 'a manager can refund from here');
  assert.ok(admin.$('.modal [data-act=receipt]'));

  // Receipt, and back to the detail when it is closed.
  admin.click('.modal [data-act=receipt]');
  await admin.until(() => admin.modalTitle() === 'Receipt', { what: 'the receipt' });
  admin.click('.modal [data-act=__close]');
  await admin.until(() => /^Order #102/.test(admin.modalTitle() || ''), { what: 'the detail again' });
  admin.click('.modal [data-act=__close]');
  assert.equal(admin.get('Modal.isOpen'), false);

  // A refunded one says when and by whom; an open one can be opened.
  admin.click('tr.clickable[data-id="o_hist104"]');
  await admin.until(() => /^Order #104/.test(admin.modalTitle() || ''));
  assert.match(m(), /Refunded by\s*Admin/);
  assert.equal(admin.$('.modal [data-act=refund]'), null, 'already refunded');
  admin.click('.modal [data-act=__close]');
  admin.click('tr.clickable[data-id="o_hist105"]');
  await admin.until(() => /^Order #105/.test(admin.modalTitle() || ''));
  assert.equal(admin.$('.modal [data-act=receipt]'), null, 'an open bill has no receipt yet');
  admin.click('.modal [data-act=open]');
  await admin.until(() => admin.screen() === 'order', { what: 'the open order' });
});

test('"Show more" reveals the rest of a long list, and the CSV holds exactly what is filtered', opts, async () => {
  for (let i = 0; i < 110; i++) bill({ number: 200 + i, staff: 'Maya', lines: [['Espresso', 1]], at: startOfToday + i * 500 });
  const admin = await open();
  await admin.signIn('Admin', '482915');
  admin.click('[data-nav=orders]');
  await admin.until(() => admin.screen() === 'orders');
  assert.equal(numbers(admin).length, 100);
  assert.match(admin.text('.more-row'), /Showing 100 of 115/);
  admin.click('[data-act=more]');
  assert.equal(numbers(admin).length, 115);
  assert.equal(admin.$('.more-row'), null);

  // CSV of the filtered list (Maya's orders from the second cashier filter), captured instead of downloaded.
  admin.w.eval('downloadFile = (name, content) => window.__saved = { name, content }');
  admin.type('[data-role=q]', 'birthday');
  admin.click('[data-act=csv]');
  const file = admin.get('window.__saved');
  assert.match(file.name, /^orders_\d{4}-\d\d-\d\d_to_\d{4}-\d\d-\d\d\.csv$/);
  const lines = file.content.split('\n');
  assert.equal(lines.length, 2, 'the header and the one order that matches');
  assert.match(lines[0], /^Order,Paid at,Status,Table,Server,Cashier,Items/);
  assert.match(lines[1], /^103,/);
  assert.match(lines[1], /3x Latte/);

  admin.type('[data-role=q]', 'zzzz');
  admin.w.eval('window.__saved = null');
  admin.click('[data-act=csv]');
  assert.equal(admin.get('window.__saved'), null, 'nothing is downloaded for an empty list');
  assert.ok(admin.toasts().some(t => /Nothing to export/.test(t)));
});

test('a waiter sees only their own orders and has no server filter', opts, async () => {
  const waiter = await open();
  await waiter.signIn('Leo', '2222', '618204');
  waiter.click('[data-nav=orders]');
  await waiter.until(() => waiter.screen() === 'orders');
  assert.match(waiter.text('.page-head h1'), /My orders/);
  assert.equal(waiter.$('[data-role=staff]'), null);
  const nums = numbers(waiter);
  assert.ok(nums.includes('#101') && nums.includes('#105'));
  assert.ok(!nums.includes('#102') && !nums.includes('#103'), 'Maya\'s orders are not listed');
});

test('Myanmar: the order history words are translated', opts, async () => {
  const admin = await open({ lang: 'my' });
  await admin.signIn('Admin', '482915');
  admin.click('[data-nav=orders]');
  await admin.until(() => admin.screen() === 'orders');
  admin.click('tr.clickable[data-id="o_hist102"]');
  await admin.until(() => admin.$('.modal .kv-grid'));
  await admin.sleep(100);
  const latin = sel => admin.$$(sel).map(e => e.textContent.trim()).filter(x => /[A-Za-z]/.test(x));
  // Names (Maya, Daw Hla, Latte, Espresso, Admin) and card/cash words that are data stay as they are.
  const names = /^(Maya|Daw Hla|Latte|Espresso|Admin|Leo|#?\d+)$/;
  assert.deepEqual(latin('.modal .kv span, .modal h3, .modal th, .modal .totals td:first-child, .modal-foot .btn').filter(x => !names.test(x)), []);
  admin.click('.modal [data-act=__close]');
  assert.deepEqual(latin('.page-head h1, .toolbar .seg button, .stats .label, table.data th, .toolbar select option').filter(x => !names.test(x) && !/^(Table \d+|Takeaway)$/.test(x)), []);
});
