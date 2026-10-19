'use strict';

// Branches: several shops' backups side by side. Each branch is worked out with its own settings by the same rules as its own
// Business health tab. The figures below were worked out by hand.   Run with:  node --test server/test
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../../js/finance.js');

const at = (d, h = 12) => new Date(2026, 2, d, h).getTime();      // March 2026
const NOW = at(12);
const RANGE = [at(1, 0), at(11, 0)];
const sale = (id, total, cost, paid) => ({ id, status: 'paid', staffId: 'u', paidAt: paid, items: [{ name: 'Set', price: total, qty: 1, cost }], totals: { subtotal: total, discount: 0, points: 0, service: 0, tax: 0, total } });
const expense = (id, category, amount, date = at(4)) => ({ id, date, category, amount, method: 'cash', status: 'active' });
const shop = (label, settings, data) => ({ id: label, label, settings: { currency: '$', decimals: 2, ...settings }, data: { users: [], attendance: [], expenses: [], orders: [], ...data } });

const north = shop('North', {}, { orders: [sale('n1', 1000, 300, at(3)), sale('n2', 500, 150, at(10))], expenses: [expense('e1', 'Salaries', 250), expense('e2', 'Rent', 100)] });
const south = shop('South', {}, { orders: [sale('s1', 600, 300, at(5)), sale('s2', 400, 100, at(10, 10))], expenses: [expense('e3', 'Salaries', 400)] });

test('branches: each branch equals its own Business health figures', () => {
  const r = F.branchReport(RANGE, [north, south], NOW);
  for (const [i, b] of [north, south].entries()) {
    const k = F.businessKpis(RANGE, b.data, b.settings);
    const x = r.rows[i];
    assert.equal(x.revenue, k.revenue);
    assert.equal(x.netProfit, k.netProfit);
    assert.equal(x.orders, k.orders);
    assert.equal(x.avgCheck, k.avgCheck);
    assert.equal(x.foodRatio, k.lines.find(l => l.key === 'food').ratio);
  }
  const [n, s] = r.rows;
  assert.deepEqual([n.revenue, n.orders, n.avgCheck, n.food, n.labour, n.netProfit], [1500, 2, 750, 450, 250, 700]);
  assert.deepEqual([s.revenue, s.orders, s.avgCheck, s.food, s.labour, s.netProfit], [1000, 2, 500, 400, 400, 200]);
  assert.equal(n.netMargin, 700 / 1500);
  assert.equal(s.netMargin, 0.2);
});

test('branches: the total adds the branches up and works its ratios from the sums, not by averaging percentages', () => {
  const r = F.branchReport(RANGE, [north, south], NOW);
  const t = r.totals;
  assert.deepEqual([t.revenue, t.orders, t.avgCheck, t.food, t.labour, t.netProfit], [2500, 4, 625, 850, 650, 900]);
  assert.equal(t.foodRatio, 850 / 2500);
  assert.equal(t.labourRatio, 650 / 2500);
  assert.equal(t.netMargin, 900 / 2500, '36%, not the mean of 46.7% and 20%');
  assert.equal(r.rows[0].share, 0.6);
  assert.equal(r.rows[1].share, 0.4);
  assert.equal(r.best.label, 'North', 'the better margin');
  assert.equal(r.mixed, false);
  assert.deepEqual(r.duplicates, []);
});

test('branches: nothing is added up across different currencies, and each keeps its own', () => {
  const kyat = shop('Yangon', { currency: 'K', decimals: 0, currencyAfter: true }, { orders: [sale('y1', 2000000, 600000, at(3))] });
  const r = F.branchReport(RANGE, [north, kyat], NOW);
  assert.equal(r.mixed, true);
  assert.equal(r.totals, null);
  assert.equal(r.rows[1].currency, 'K');
  assert.equal(r.rows[1].revenue, 2000000);
  assert.equal(r.rows[0].share, undefined, 'a share of a total that does not exist');
  assert.equal(r.best.label, 'Yangon', 'margins are ratios, so they still compare across currencies (70% against 47%)');
});

test('branches: a backup saved before the end of the period is flagged, and so is one with no sales', () => {
  const early = shop('Early', {}, { orders: [sale('e1', 100, 30, at(3))] });          // last sale on the 3rd; the period ran to the 11th
  const empty = shop('Empty', {}, {});
  const r = F.branchReport(RANGE, [north, early, empty], NOW);
  assert.deepEqual(r.rows.map(x => x.stale), [false, true, true]);
  assert.equal(r.rows[1].latestSale, at(3));
  assert.equal(r.rows[2].latestSale, null);
  // A period still running is only compared with now: a sale from this morning is fresh.
  const live = F.branchReport([at(1, 0), at(31, 0)], [shop('Live', {}, { orders: [sale('l1', 100, 30, at(12, 8))] })], NOW);
  assert.equal(live.rows[0].stale, false);
});

test('branches: files named alike are reported, so one shop saved twice is not counted twice', () => {
  const r = F.branchReport(RANGE, [north, { ...north, id: 'again', label: ' north ' }, south], NOW);
  assert.deepEqual(r.duplicates, ['north']);
});

test('branches: one branch, none, and no sales', () => {
  const one = F.branchReport(RANGE, [north], NOW);
  assert.equal(one.rows.length, 1);
  assert.equal(one.best, null, 'nothing to compare with');
  assert.equal(one.totals.revenue, 1500);
  const none = F.branchReport(RANGE, [], NOW);
  assert.deepEqual([none.rows, none.totals, none.mixed, none.best], [[], null, false, null]);
  const quiet = F.branchReport(RANGE, [shop('Quiet', {}, {}), shop('Quiet 2', {}, {})], NOW);
  assert.equal(quiet.totals.revenue, 0);
  assert.equal(quiet.totals.foodRatio, null, 'no division by zero');
  assert.equal(quiet.rows[0].share, null);
  assert.equal(quiet.best, null);
});

test('branches: staff hours and the estimated labour of a branch carry through', () => {
  const staff = [{ id: 'l', name: 'Leo', role: 'waiter', hourlyRate: 2 }];
  const b = shop('Hours', {}, { users: staff, orders: [sale('h1', 1000, 300, at(3))], attendance: [{ id: 'a', userId: 'l', in: at(3, 9), out: at(3, 17) }] });
  const r = F.branchReport(RANGE, [b], NOW).rows[0];
  assert.equal(r.staffHours, 8);
  assert.equal(r.labour, 16);
  assert.equal(r.labourEstimated, true);
  assert.equal(r.salesPerHour, 125);
});
