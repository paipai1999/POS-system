'use strict';

// The dashboard (order board and table overview), driven by orders taken, cooked and paid in other tabs. Run with:  npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM, startServer, openApp } = require('./harness.js');
const { orderStage } = require('../../js/shared.js');

const opts = JSDOM ? {} : { skip: 'jsdom is not installed (run "npm install" once)' };

let srv;
const tabs = [];
const open = async o => { const t = await openApp(srv.base, o); tabs.push(t); return t; };
const pid = (tab, name) => tab.get(`Store.data.products.find(p => p.name === ${JSON.stringify(name)}).id`);

test.before(async () => { if (JSDOM) srv = await startServer(); });
test.after(async () => {
  tabs.forEach(t => { try { t.close(); } catch (e) { /* already closed */ } });
  if (srv) await srv.stop();
});

test('the stage of an open order follows its kitchen tickets and what is still unsent', () => {
  const item = (qty, sentQty) => ({ qty, sentQty });
  const o = items => ({ id: 'o1', items });
  const tk = (status, orderId = 'o1') => ({ orderId, status });
  assert.equal(orderStage(o([]), []), 'ordering', 'nothing on it yet');
  assert.equal(orderStage(o([item(2, 0)]), []), 'ordering', 'not sent');
  assert.equal(orderStage(o([item(2, 2)]), [tk('new')]), 'cooking');
  assert.equal(orderStage(o([item(2, 1)]), [tk('new')]), 'cooking', 'cooking beats a new unsent item');
  assert.equal(orderStage(o([item(2, 2)]), [tk('new'), tk('ready')]), 'ready', 'food that is ready beats food still cooking');
  assert.equal(orderStage(o([item(2, 2)]), [tk('served')]), 'payment', 'everything served: waiting for payment');
  assert.equal(orderStage(o([item(2, 2), item(1, 0)]), [tk('served')]), 'ordering', 'more was added after serving');
  assert.equal(orderStage(o([item(2, 2)]), [tk('ready', 'other')]), 'payment', 'tickets of other orders do not count');
  assert.equal(orderStage(o([item(1, undefined)]), undefined), 'ordering');
});

test('orders move across the board as they are taken, sent, cooked, served and paid in other tabs', opts, async () => {
  const admin = await open();
  await admin.signIn('Admin', '1234', '482915');
  admin.click('[data-nav=dashboard]');
  await admin.until(() => admin.screen() === 'dashboard');
  assert.match(admin.text('.page-head h1'), /Dashboard/);
  assert.equal(admin.$$('.dash-card').length, 0, 'quiet to start with');
  assert.equal(admin.$$('.dash-col').length, 5);
  const col = n => admin.$$('.dash-col')[n];
  const cards = n => col(n).querySelectorAll('.dash-card').length;

  // A cashier opens a table and adds two espressos: the order is on the board, still being ordered.
  const cashier = await open();
  await cashier.signIn('Maya', '1111', '735192');
  cashier.click('[data-act=table][data-id]:not(.busy)');
  await cashier.until(() => cashier.screen() === 'order');
  const where = cashier.text('.ticket-head .t-title');
  const espresso = pid(cashier, 'Espresso');
  cashier.click(`[data-act=add][data-id="${espresso}"]`);
  cashier.click(`[data-act=add][data-id="${espresso}"]`);
  await admin.until(() => cards(0) === 1, { what: 'the order in the Ordering column' });
  assert.match(col(0).textContent, new RegExp(where));
  assert.match(col(0).textContent, /2×\s*Espresso/);
  assert.match(col(0).textContent, /\$5\.35/);
  assert.match(admin.text('.stats'), /Open orders\s*1/);

  // Sent to the kitchen.
  cashier.click('[data-act=send]');
  await admin.until(() => cards(1) === 1, { what: 'the order in the kitchen column' });
  assert.equal(cards(0), 0);
  assert.match(admin.text('.stats'), /In the kitchen\s*1/);

  // The cook marks it ready: it is waiting to be served.
  const kitchen = await open();
  await kitchen.signIn('Kitchen', '3333', '917305');
  await kitchen.until(() => kitchen.screen() === 'kitchen');
  await kitchen.until(() => kitchen.$('[data-act=ready]'), { what: 'the ticket on the kitchen screen' });
  kitchen.click('[data-act=ready]');
  await admin.until(() => cards(2) === 1, { what: 'the order in the Ready to serve column' });
  assert.match(admin.text('.stats'), /Ready to serve\s*1/);

  // Table overview: the table shows as ready to serve and needs attention.
  admin.click('[data-act=tab][data-tab=tables]');
  assert.ok(admin.$('.floor-tile.s-ready'), 'the table is marked ready');
  assert.match(admin.text('.stats'), /Occupied\s*1\s*of \d+ tables/);
  admin.click('[data-act=filter][data-filter=attention]');
  assert.equal(admin.$$('.floor-tile').length, 1, 'only the table that needs attention');
  admin.click('[data-act=filter][data-filter=free]');
  assert.ok(admin.$$('.floor-tile').length >= 1 && admin.$$('.floor-tile:not(.s-free)').length === 0, 'only free tables');
  admin.click('[data-act=filter][data-filter=all]');
  admin.click('[data-act=tab][data-tab=orders]');

  // Mark served from the card: now waiting for payment.
  admin.click('.dash-col.is-ready [data-act=served]');
  await admin.until(() => cards(3) === 1, { what: 'the order in the Waiting for payment column' });
  assert.equal(cards(2), 0);

  // Paid: gone from the open columns, listed under Paid today.
  cashier.click('[data-act=pay]');
  await cashier.until(() => /^Payment/.test(cashier.modalTitle() || ''));
  cashier.click('.modal [data-act=quick]');
  cashier.click('.modal [data-act=complete]');
  await admin.until(() => cards(4) === 1, { what: 'the order under Paid today' });
  assert.equal(cards(3), 0);
  assert.match(admin.text('.stats'), /Open orders\s*0/);
  assert.match(admin.text('.stats'), /Paid today\s*1/);
  assert.match(col(4).textContent, /\$5\.35/);

  // Tapping a paid card shows its receipt.
  admin.click('.dash-col.is-paid .dash-card');
  await admin.until(() => /Payment complete|Receipt/.test(admin.modalTitle() || ''), { what: 'the receipt' });
});

test('a waiter sees the board and the tables but not the day\'s takings; a kitchen screen has no dashboard', opts, async () => {
  const waiter = await open();
  await waiter.signIn('Leo', '2222', '618204');
  assert.ok(waiter.$('[data-nav=dashboard]'));
  waiter.click('[data-nav=dashboard]');
  await waiter.until(() => waiter.screen() === 'dashboard');
  assert.doesNotMatch(waiter.text('.stats'), /Paid today/);
  assert.match(waiter.text('.stats'), /Open orders/);

  const kitchen = await open();
  await kitchen.signIn('Kitchen', '917305');
  assert.equal(kitchen.$('[data-nav=dashboard]'), null);
});

test('Myanmar: the dashboard words are translated', opts, async () => {
  const admin = await open({ lang: 'my' });
  await admin.signIn('Admin', '482915');
  admin.click('[data-nav=dashboard]');
  await admin.until(() => admin.screen() === 'dashboard');
  await admin.sleep(100);
  const latin = sel => admin.$$(sel).map(e => e.textContent.trim()).filter(x => /[A-Za-z]/.test(x));
  assert.deepEqual(latin('.page-head h1, .page-head .seg button, .stats .label, .dash-col h2 span:first-child, .dash-col .empty'), []);
  admin.click('[data-act=tab][data-tab=tables]');
  await admin.sleep(100);
  assert.deepEqual(latin('.stats .label, .stats .muted, .seg button, .legend span, .floor-tile .ft-status, .floor-tile .ft-meta'), []);
});
