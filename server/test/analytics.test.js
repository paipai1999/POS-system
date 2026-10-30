'use strict';

// Owner reports: sales patterns, menu engineering and business health. The figures below were worked out by hand.
// Run with:  node --test server/test
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../../js/finance.js');

const SETTINGS = { currency: '$', decimals: 2, taxRate: 5, serviceRate: 10 };
const at = (d, h = 12, m = 0) => new Date(2026, 2, d, h, m).getTime();   // 2026-03-<d> local time (the 2nd is a Monday)
const near = (actual, expected, msg) => assert.ok(Math.abs(actual - expected) < 0.005, `${msg}: ${actual} is not ${expected}`);

// ----- sales patterns -----

// Two weeks, Monday 2 March to Sunday 15 March.
const RANGE = [at(2, 0), at(16, 0)];
function bill(id, { total, created, paid, table = 'T1', staff = 'u_leo', status = 'paid', items = 2, splitFrom = null }) {
  return {
    id, status, staffId: staff, tableId: table, tableName: table || '', splitFrom, createdAt: created, paidAt: paid,
    items: [{ name: 'Item', price: total / items, qty: items }],
    totals: { subtotal: total, discount: 0, points: 0, service: 0, tax: 0, total },
  };
}
const ORDERS = [
  bill('o1', { total: 100, created: at(2, 12, 5), paid: at(2, 12, 50), table: 'T1' }),                                   // Mon, 45 min
  bill('o2', { total: 200, created: at(2, 18), paid: at(2, 19), table: 'T2' }),                                          // Mon, 60 min
  bill('o3', { total: 300, created: at(6, 12), paid: at(6, 13), table: 'T1', staff: 'u_maya' }),                         // Fri, 60 min
  bill('o4', { total: 150, created: at(13, 13), paid: at(13, 13, 30), table: 'T1', staff: 'u_maya' }),                   // Fri, 30 min
  bill('o5', { total: 50, created: at(7, 19, 55), paid: at(7, 20), table: null }),                                       // Sat, takeaway
  bill('o6', { total: 80, created: at(7, 20), paid: at(7, 20, 15), table: null, splitFrom: 'o3' }),                      // Sat, split-off bill: dining room
  bill('o7', { total: 999, created: at(6, 12), paid: at(6, 14), status: 'refunded' }),                                   // refunded: left out
  bill('o8', { total: 999, created: at(6, 12), paid: null, status: 'void' }),                                            // void: left out
  bill('o9', { total: 999, created: at(20, 12), paid: at(20, 13) }),                                                     // outside the period
  bill('o10', { total: 999, created: at(6, 12), paid: null, status: 'open' }),                                           // still open
];
const patterns = () => F.salesPatterns(RANGE, { orders: ORDERS }, SETTINGS, { table: o => (o.tableId ? o.tableName : 'Split bill'), server: id => ({ u_leo: 'Leo', u_maya: 'Maya' })[id] });

test('patterns: totals count paid bills in the period only', () => {
  const p = patterns();
  assert.equal(p.orders, 6);
  assert.equal(p.sales, 880);
  near(p.avgCheck, 146.67, 'average bill');
  near(p.avgPerDay, 62.86, 'average per day (880 over 14 days)');
});

test('patterns: weekdays are Monday-first, averaged over how many of each the period holds', () => {
  const p = patterns();
  assert.deepEqual(p.weekday.map(w => w.name), ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
  assert.deepEqual(p.weekday.map(w => w.days), [2, 2, 2, 2, 2, 2, 2]);
  const [mon, , , , fri, sat, sun] = p.weekday;
  assert.deepEqual([mon.sales, mon.orders, mon.avgPerDay, mon.avgCheck], [300, 2, 150, 150]);
  assert.deepEqual([fri.sales, fri.orders, fri.avgPerDay, fri.avgCheck], [450, 2, 225, 225]);
  assert.deepEqual([sat.sales, sat.orders, sat.avgPerDay], [130, 2, 65]);
  assert.deepEqual([sun.sales, sun.orders], [0, 0]);
  assert.equal(p.busiest.name, 'Friday');
  assert.equal(p.quietest.name, 'Saturday', 'the quietest day that traded; a day with no sales at all is not "quiet", it is closed');
});

test('patterns: a period with five of one weekday does not inflate that weekday\'s average', () => {
  // Monday 2 March to Tuesday 31 March holds five Mondays and Tuesdays and four of each other day.
  const p = F.salesPatterns([at(2, 0), at(32, 0)], { orders: [ORDERS[0]] }, SETTINGS);
  assert.deepEqual(p.weekday.map(w => w.days), [5, 5, 4, 4, 4, 4, 4]);
  assert.equal(p.weekday[0].avgPerDay, 20, '100 on one of five Mondays');
});

test('patterns: hours, the peak hour and the slow hours inside the trading span', () => {
  const p = patterns();
  assert.deepEqual([12, 13, 19, 20].map(h => p.hours[h].sales), [100, 450, 200, 130]);
  assert.equal(p.peakHour, 13);
  assert.deepEqual(p.slowHours, [12, 14, 15, 16, 17, 18], 'under a quarter of the peak hour (112.50), between the first and last sale');
  assert.equal(p.hours.length, 24);
});

test('patterns: the weekday-by-hour grid', () => {
  const p = patterns();
  assert.equal(p.heatmap.length, 7);
  assert.equal(p.heatmap[0].length, 24);
  assert.deepEqual(p.heatmap[4][13], { sales: 450, orders: 2 });          // Friday 13:00
  assert.deepEqual(p.heatmap[0][19], { sales: 200, orders: 1 });          // Monday 19:00
  assert.deepEqual(p.heatmap[5][20], { sales: 130, orders: 2 });          // Saturday 20:00
  assert.equal(p.heatMax, 450);
  assert.equal(p.heatmap.flat().reduce((n, c) => n + c.sales, 0), 880, 'every sale is in exactly one cell');
});

test('patterns: daily trend has one entry per day, including days with no sales', () => {
  const p = patterns();
  assert.equal(p.trend.length, 14);
  assert.deepEqual(p.trend[0], { date: at(2, 0), sales: 300, orders: 2 });
  assert.deepEqual(p.trend[1], { date: at(3, 0), sales: 0, orders: 0 });
  assert.equal(p.trend.reduce((n, d) => n + d.sales, 0), 880);
});

test('patterns: dine-in and takeaway (a split-off bill is still the dining room)', () => {
  const c = patterns().channel;
  assert.deepEqual(c.takeaway, { orders: 1, sales: 50 });
  assert.deepEqual(c.dineIn, { orders: 5, sales: 830 });
  near(c.takeawayShare, 50 / 880, 'takeaway share');
});

test('patterns: tables ranked by sales with how long guests stay and what a seat-hour earns', () => {
  const p = patterns();
  assert.deepEqual(p.tables.map(t => t.name), ['T1', 'T2', 'Split bill']);
  const [t1, t2, split] = p.tables;
  assert.deepEqual([t1.orders, t1.sales], [3, 550]);
  near(t1.avgCheck, 183.33, 'T1 average bill');
  assert.equal(t1.avgMinutes, 45, '(45 + 60 + 30) / 3');
  near(t1.salesPerHour, 244.44, '550 over 2.25 hours');
  assert.deepEqual([t2.sales, t2.avgMinutes, t2.salesPerHour], [200, 60, 200]);
  assert.deepEqual([split.sales, split.avgMinutes], [80, 15]);
  assert.equal(p.avgSeatMinutes, 42, '210 minutes over 5 dining-room bills');
});

test('patterns: a bill left open for a day is not counted as a long meal', () => {
  const left = bill('o11', { total: 60, created: at(4, 9), paid: at(5, 9), table: 'T9' });
  const p = F.salesPatterns(RANGE, { orders: [left] }, SETTINGS);
  assert.equal(p.tables[0].avgMinutes, null);
  assert.equal(p.tables[0].salesPerHour, null);
  assert.equal(p.avgSeatMinutes, null);
  assert.equal(p.sales, 60, 'but the sale itself counts');
});

test('patterns: servers by sales, with average bill and items per bill', () => {
  const [maya, leo] = patterns().servers;
  assert.deepEqual([maya.name, maya.orders, maya.sales, maya.avgCheck, maya.itemsPerBill], ['Maya', 2, 450, 225, 2]);
  assert.deepEqual([leo.name, leo.orders, leo.sales, leo.avgCheck], ['Leo', 4, 430, 107.5]);
});

test('patterns: an empty period is all zeros, not an error', () => {
  const p = F.salesPatterns(RANGE, { orders: [] }, SETTINGS);
  assert.equal(p.orders, 0);
  assert.equal(p.busiest, null);
  assert.equal(p.quietest, null);
  assert.equal(p.peakHour, null);
  assert.deepEqual(p.slowHours, []);
  assert.equal(p.avgCheck, 0);
  assert.equal(p.channel.takeawayShare, 0);
  assert.equal(p.tables.length + p.servers.length, 0);
  assert.equal(F.salesPatterns(RANGE, {}, SETTINGS).orders, 0, 'and a data set with no orders list');
});

// ----- menu engineering -----

const line = (id, name, price, qty, cost) => ({ productId: id, name, price, qty, ...(cost === undefined ? {} : { cost }) });
const MENU_ORDERS = [
  {
    id: 'm1', status: 'paid', paidAt: at(10), createdAt: at(10), staffId: 'u_leo',
    items: [line('p_latte', 'Latte', 4, 40, 1), line('p_cake', 'Cake', 5, 30, 3.5), line('p_steak', 'Steak', 20, 5, 8), line('p_soup', 'Soup', 3, 3, 2.5), line('p_water', 'Water', 1, 20)],
    totals: { subtotal: 0, discount: 0, total: 0 },
  },
  { id: 'm2', status: 'refunded', paidAt: at(11), refundedAt: at(11), createdAt: at(11), items: [line('p_latte', 'Latte', 4, 100, 1)], totals: { subtotal: 0, discount: 0, total: 0 } },
  { id: 'm3', status: 'paid', paidAt: at(30), createdAt: at(30), items: [line('p_latte', 'Latte', 4, 100, 1)], totals: { subtotal: 0, discount: 0, total: 0 } },
];
const CATEGORY = { p_latte: 'Drinks', p_cake: 'Desserts', p_steak: 'Mains', p_soup: 'Mains' };
const menu = () => F.menuEngineering([at(1, 0), at(15, 0)], { orders: MENU_ORDERS }, SETTINGS, id => CATEGORY[id]);

test('menu: each dish lands in the right group', () => {
  const m = menu();
  const by = Object.fromEntries(m.items.map(i => [i.name, i]));
  assert.equal(by.Latte.group, 'star', 'sells a lot and leaves 3.00 a cup, above the average');
  assert.equal(by.Cake.group, 'plowhorse', 'sells a lot but leaves only 1.50');
  assert.equal(by.Steak.group, 'puzzle', 'leaves 12.00 but few are sold');
  assert.equal(by.Soup.group, 'dog', 'few sold and 0.50 each');
  assert.equal(by.Water.group, 'unknown', 'no recipe, so no margin to judge');
  assert.deepEqual(m.count, { star: 1, plowhorse: 1, puzzle: 1, dog: 1, unknown: 1 });
});

test('menu: margins, contribution and the two thresholds', () => {
  const m = menu();
  const by = Object.fromEntries(m.items.map(i => [i.name, i]));
  assert.deepEqual([by.Latte.unitCost, by.Latte.margin, by.Latte.contribution], [1, 3, 120]);
  near(by.Latte.marginPercent, 0.75, 'latte margin share of price');
  assert.deepEqual([by.Cake.margin, by.Cake.contribution], [1.5, 45]);
  assert.deepEqual([by.Steak.margin, by.Steak.contribution], [12, 60]);
  assert.equal(by.Water.margin, null);
  assert.equal(by.Water.contribution, null);
  assert.equal(by.Water.revenue, 20);
  near(m.marginAt, 2.9, 'average margin per portion sold: 226.50 over 78 portions');
  near(m.popularAt, 0.175, '70% of an equal share among 4 judged dishes');
  assert.equal(m.judged, 4);
  near(m.coverage, 0.8, '4 of 5 dishes have a recipe');
  assert.equal(m.unknownRevenue, 20);
  assert.equal(m.items[0].name, 'Latte', 'listed by what each dish contributes, best first');
  assert.equal(m.items[m.items.length - 1].name, 'Water', 'dishes with no margin last');
});

test('menu: only bills paid in the period count (refunded and out-of-period bills do not)', () => {
  const latte = menu().items.find(i => i.name === 'Latte');
  assert.equal(latte.qty, 40, 'not 40 + 100 refunded + 100 later');
  assert.equal(latte.category, 'Drinks');
  assert.equal(menu().items.find(i => i.name === 'Water').category, 'Other', 'a dish with no category');
});

test('menu: a dish sold at two costs uses the average, and part-costed sales use only the costed part', () => {
  const orders = [
    { id: 'a', status: 'paid', paidAt: at(3), items: [line('p', 'Pie', 10, 2, 4), line('p', 'Pie', 10, 2, 6), line('p', 'Pie', 10, 6)], totals: {} },
  ];
  const pie = F.menuEngineering([at(1, 0), at(15, 0)], { orders }, SETTINGS).items[0];
  assert.equal(pie.qty, 10);
  assert.equal(pie.revenue, 100);
  assert.equal(pie.unitCost, 5, '(2×4 + 2×6) / 4 costed portions');
  assert.equal(pie.margin, 5);
  assert.equal(pie.contribution, 20, 'only the four costed portions: 40 − 20');
});

test('menu: nothing sold is an empty list', () => {
  const m = F.menuEngineering([at(1, 0), at(15, 0)], { orders: [] }, SETTINGS);
  assert.deepEqual(m.items, []);
  assert.equal(m.coverage, 0);
  assert.equal(m.judged, 0);
});

// ----- business health -----

const expense = (id, category, amount) => ({ id, date: at(5), category, amount, method: 'cash', status: 'active' });
function kpiData({ cost = 300, expenses }) {
  return {
    orders: [{
      id: 'k1', status: 'paid', paidAt: at(5), createdAt: at(5), staffId: 'u_leo',
      items: [{ name: 'Set meal', price: 1000, qty: 1, cost }],
      totals: { subtotal: 1000, discount: 0, points: 0, service: 0, tax: 0, total: 1000 },
    }],
    expenses,
  };
}
const TEN_DAYS = [at(1, 0), at(11, 0)];

test('health: a well-run month gets good verdicts and a break-even figure', () => {
  const k = F.businessKpis(TEN_DAYS, kpiData({ expenses: [expense('e1', 'Rent', 100), expense('e2', 'Salaries', 250), expense('e3', 'Utilities', 50)] }), SETTINGS);
  assert.equal(k.revenue, 1000);
  assert.equal(k.days, 10);
  const by = Object.fromEntries(k.lines.map(l => [l.key, l]));
  near(by.food.ratio, 0.30, 'food cost'); assert.equal(by.food.status, 'good');
  near(by.labour.ratio, 0.25, 'labour'); assert.equal(by.labour.status, 'good');
  near(by.prime.ratio, 0.55, 'prime cost'); assert.equal(by.prime.status, 'good');
  near(by.occupancy.ratio, 0.10, 'rent'); assert.equal(by.occupancy.status, 'good');
  assert.equal(by.prime.amount, 550);
  assert.equal(k.netProfit, 300);
  assert.equal(k.netStatus, 'good');
  assert.equal(k.running, 400);
  near(k.breakEven.revenue, 571.43, '400 / (1 − 0.30)');
  near(k.breakEven.perDay, 57.14, 'per day');
  assert.equal(k.breakEven.actualPerDay, 100);
  near(k.breakEven.cushion, 0.4286, 'sales could fall by 43% before the month loses money');
  assert.deepEqual(k.notes, []);
});

test('health: high food and labour cost are called out', () => {
  const k = F.businessKpis(TEN_DAYS, kpiData({ cost: 400, expenses: [expense('e1', 'Rent', 100), expense('e2', 'Salaries', 400), expense('e3', 'Utilities', 50)] }), SETTINGS);
  const by = Object.fromEntries(k.lines.map(l => [l.key, l]));
  assert.equal(by.food.status, 'high');          // 40%
  assert.equal(by.labour.status, 'high');        // 40%
  assert.equal(by.prime.status, 'high');         // 80%
  assert.equal(by.occupancy.status, 'good');
  assert.equal(k.netProfit, 50);
  assert.equal(k.netStatus, 'watch');            // 5% margin
  assert.ok(by.food.hint.includes('28–35%'));
});

test('health: between the ranges is "watch"', () => {
  const k = F.businessKpis(TEN_DAYS, kpiData({ cost: 350, expenses: [expense('e1', 'Salaries', 330)] }), SETTINGS);
  const by = Object.fromEntries(k.lines.map(l => [l.key, l]));
  assert.equal(by.food.status, 'watch');         // 35%
  assert.equal(by.labour.status, 'watch');       // 33%
  assert.equal(by.prime.status, 'watch');        // 68.0% is exactly on the line, and the line itself is still "watch"
  const over = F.businessKpis(TEN_DAYS, kpiData({ cost: 360, expenses: [expense('e1', 'Salaries', 330)] }), SETTINGS);
  assert.equal(over.lines.find(l => l.key === 'prime').status, 'high', '69% is over it');
});

test('health: a loss shows a negative cushion', () => {
  const k = F.businessKpis(TEN_DAYS, kpiData({ expenses: [expense('e1', 'Rent', 900)] }), SETTINGS);
  assert.ok(k.netProfit < 0);
  assert.equal(k.netStatus, 'high');
  assert.ok(k.breakEven.cushion < 0);
});

test('health: warns when food cost or labour cannot be trusted', () => {
  const noRecipe = kpiData({ expenses: [expense('e1', 'Rent', 100)] });
  delete noRecipe.orders[0].items[0].cost;
  const k = F.businessKpis(TEN_DAYS, noRecipe, SETTINGS);
  assert.equal(k.notes.length, 2);
  assert.match(k.notes[0], /Only 0% of item sales have a recipe/);
  assert.match(k.notes[1], /No salaries or wages are recorded/);
});

test('health: wages and salary categories are recognised by name', () => {
  for (const category of ['Salaries', 'Staff wages', 'Payroll', 'Casual labour']) {
    const k = F.businessKpis(TEN_DAYS, kpiData({ expenses: [expense('e1', category, 200)] }), SETTINGS);
    assert.equal(k.lines.find(l => l.key === 'labour').amount, 200, category);
  }
  const k = F.businessKpis(TEN_DAYS, kpiData({ expenses: [expense('e1', 'Marketing', 200)] }), SETTINGS);
  assert.equal(k.lines.find(l => l.key === 'labour').amount, 0);
});

test('health: no sales gives no verdicts, not divisions by zero', () => {
  const k = F.businessKpis(TEN_DAYS, { orders: [], expenses: [expense('e1', 'Rent', 100)] }, SETTINGS);
  assert.equal(k.revenue, 0);
  assert.ok(k.lines.every(l => l.status === 'none' && l.ratio === null));
  assert.equal(k.netStatus, 'none');
  assert.equal(k.breakEven.cushion, null);
  assert.equal(k.breakEven.revenue, 100, 'what it would take to cover the costs');
  assert.deepEqual(k.notes, []);
});
