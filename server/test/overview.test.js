'use strict';

// The dashboard overview figures (js/finance/overview.js), worked out by hand. Run with:  npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { overview, overviewChange } = require('../../js/finance.js');

const settings = { decimals: 2 };
// Noon on a fixed day; "yesterday so far" therefore means up to noon yesterday.
const now = new Date(2026, 9, 14, 12, 0, 0).getTime();
const at = (dayOffset, h, m = 0) => new Date(2026, 9, 14 + dayOffset, h, m, 0).getTime();
const order = (paidAt, total, extra = {}) => ({
  id: 'o' + Math.random(), status: 'paid', paidAt, totals: { total, subtotal: total, discount: 0, tax: 0, service: 0 },
  items: [{ productId: 'p1', name: 'Latte', qty: 1, price: total }], payment: { method: 'cash', amount: total }, ...extra,
});

test('today is compared with yesterday only up to the same time of day', () => {
  const o = overview([
    order(at(0, 9), 10), order(at(0, 11), 20),             // today so far: 30, 2 bills
    order(at(-1, 9), 15),                                  // yesterday before noon: counts
    order(at(-1, 18), 100),                                // yesterday evening: not yet comparable
  ], now, settings);
  assert.equal(o.today.sales, 30);
  assert.equal(o.today.count, 2);
  assert.equal(o.yesterday.sales, 15);
  assert.equal(o.yesterday.count, 1);
  assert.equal(overviewChange(o.today.sales, o.yesterday.sales), 1);   // +100%
});

test('a refund comes off on the day it is made and its dish cost is given back', () => {
  const sold = order(at(-2, 10), 40, { status: 'refunded', refundedAt: at(0, 9), items: [{ productId: 'p1', name: 'Latte', qty: 2, price: 20, cost: 5 }] });
  const o = overview([sold, order(at(0, 10), 25)], now, settings);
  assert.equal(o.today.gross, 25);
  assert.equal(o.today.refunds, 40);
  assert.equal(o.today.sales, -15, 'today: 25 sold less 40 refunded');
  const twoDaysAgo = o.days[4];            // days run oldest first, today last
  assert.equal(twoDaysAgo.sales, 40, 'the sale stays on the day it was made');
  assert.equal(o.week.sales, 25);
});

test('the week is compared with the 7 days before, and there are 7 days oldest first', () => {
  const o = overview([order(at(0, 8), 70), order(at(-3, 8), 30), order(at(-8, 8), 50), order(at(-20, 8), 999)], now, settings);
  assert.equal(o.days.length, 7);
  assert.equal(o.days[6].sales, 70);
  assert.equal(o.days[3].sales, 30);
  assert.equal(o.week.sales, 100);
  assert.equal(o.before.sales, 50, '8 days ago is in the previous 7; 20 days ago is in neither');
  assert.equal(overviewChange(o.week.sales, o.before.sales), 1);
  assert.equal(overviewChange(5, 0), null, 'nothing to compare with');
});

test('hours, best sellers, categories and payment methods add up', () => {
  const lat = (qty, price) => ({ productId: 'p1', name: 'Latte', qty, price });
  const cake = (qty, price) => ({ productId: 'p2', name: 'Cake', qty, price });
  const o = overview([
    order(at(0, 9, 30), 17, { items: [lat(1, 5), cake(2, 6)], payment: { method: 'cash', amount: 17 } }),
    order(at(0, 9, 45), 5, { items: [lat(1, 5)], payment: { method: 'card', amount: 5 } }),
    order(at(-1, 15), 12, { items: [cake(2, 6)], payment: { method: 'card', amount: 12 } }),
  ], now, settings, id => (id === 'p1' ? 'Drinks' : 'Food'));
  assert.equal(o.hours[9], 22, 'both of this morning\'s bills fall in the 9 o\'clock hour');
  assert.equal(o.hours[15], 0, 'hours are for today only');
  assert.deepEqual(o.topItems.map(i => [i.name, i.qty, i.amount]), [['Cake', 4, 24], ['Latte', 2, 10]]);
  assert.deepEqual(o.categories, [{ name: 'Food', amount: 24 }, { name: 'Drinks', amount: 10 }]);
  assert.deepEqual(Object.fromEntries(o.methods.map(m => [m.method, m.amount])), { cash: 17, card: 17 }, 'card 5 + 12, cash 17');
});

test('open and void orders never count', () => {
  const o = overview([order(at(0, 9), 10, { status: 'open' }), order(at(0, 9), 10, { status: 'void' }), order(at(0, 9), 7)], now, settings);
  assert.equal(o.today.sales, 7);
  assert.equal(o.today.count, 1);
});
