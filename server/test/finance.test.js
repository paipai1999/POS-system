'use strict';

// Financial statements: profit and loss, cash flow, tax, controls, position, daily summary and monthly expenses.
// The figures below were worked out by hand. Run with:  node --test server/test
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../../js/finance.js');

const SETTINGS = { currency: '$', decimals: 2, taxRate: 5, serviceRate: 10 };
const at = (d, h = 12, m = 0) => new Date(2026, 2, d, h, m).getTime();   // 2026-03-<d> local time
const MARCH = [at(1, 0), at(31, 24)];

// A finished bill. `cost` is the ingredient cost of each unit (a dish with a recipe).
function bill(id, { day, subtotal, discount = 0, points = 0, service = 0, tax = 0, taxRate = 5, lines, pay, refundedDay = null, by = 'u_leo', cashier = 'u_maya', discountInfo = null, status = 'paid' }) {
  const total = subtotal - discount - points + service + tax;
  const o = {
    id, number: Number(id.replace(/\D/g, '')), staffId: by, cashierId: cashier, status: refundedDay ? 'refunded' : status, createdAt: at(day, 11),
    items: lines.map(([name, price, qty, cost]) => ({ name, price, qty, ...(cost === undefined ? {} : { cost }) })),
    totals: { subtotal, discount, points, service, tax, taxRate, total },
    payment: pay(total), paidAt: at(day, 13), discount: discountInfo,
  };
  if (refundedDay) { o.refundedAt = at(refundedDay, 15); o.refundedBy = 'u_admin'; }
  return o;
}
const cash = total => ({ method: 'cash', amount: total, tip: 0, tendered: total });
const card = total => ({ method: 'card', amount: total, tip: 0 });

// March: A (cash, discounted), B (card, tip, no recipe), C (sold in February, refunded in March), D (sold in March, refunded in April)
const A = bill('o1', { day: 10, subtotal: 100, discount: 10, service: 5, tax: 4.75, lines: [['Latte', 50, 2, 12]], pay: cash, discountInfo: { type: 'percent', value: 10, by: 'u_maya' } });
const B = bill('o2', { day: 11, subtotal: 40, tax: 2, lines: [['Salad', 40, 1]], pay: t => ({ method: 'card', amount: t, tip: 3 }) });
const C = { ...bill('o3', { day: 20, subtotal: 30, tax: 1.5, lines: [['Tea', 30, 1, 5]], pay: card, refundedDay: 15 }), paidAt: new Date(2026, 1, 25, 13).getTime() };
const D = bill('o4', { day: 12, subtotal: 60, tax: 3, lines: [['Burger', 60, 1, 20]], pay: cash, refundedDay: 3 });
D.refundedAt = new Date(2026, 3, 2, 10).getTime();   // refunded in April
const V = { id: 'o5', number: 5, status: 'void', voidedAt: at(12, 17), voidedBy: 'u_maya', createdAt: at(12, 16), staffId: 'u_leo', items: [{ name: 'Latte', price: 50, qty: 2, sentQty: 2 }] };

const DATA = {
  orders: [A, B, C, D, V],
  purchases: [
    { id: 'p1', date: at(5), status: 'received', total: 105, taxAmount: 5, paid: 105, payMethod: 'cash' },
    { id: 'p2', date: at(6), status: 'received', total: 200, paid: 50, payMethod: 'other' },
    { id: 'p3', date: at(7), status: 'void', total: 999, paid: 999, payMethod: 'cash' },
  ],
  supplierPayments: [
    { id: 'sp1', date: at(8), amount: 40, method: 'cash', status: 'paid' },
    { id: 'sp2', date: at(9), amount: 30, method: 'other', status: 'paid' },
    { id: 'sp3', date: at(9), amount: 77, method: 'cash', status: 'void' },
  ],
  stocktakes: [{ id: 'st1', date: at(14), value: -8.5 }, { id: 'st2', date: at(21), value: 2 }],
  expenses: [
    { id: 'e1', date: at(1), category: 'Rent', amount: 500, method: 'other', status: 'active' },
    { id: 'e2', date: at(2), category: 'Utilities', amount: 84, taxAmount: 4, method: 'cash', status: 'active' },
    { id: 'e3', date: at(3), category: 'Rent', amount: 20, method: 'cash', status: 'active' },
    { id: 'e4', date: at(4), category: 'Tips paid to staff', amount: 10, method: 'cash', status: 'active' },
    { id: 'e5', date: at(5), category: 'Marketing', amount: 999, method: 'cash', status: 'void' },
    { id: 'e6', date: new Date(2026, 3, 1).getTime(), category: 'Rent', amount: 500, method: 'other', status: 'active' },
  ],
  ownerMoves: [{ id: 'm1', date: at(2), type: 'in', amount: 300, method: 'cash', status: 'active' }, { id: 'm2', date: at(3), type: 'out', amount: 100, method: 'other', status: 'active' }],
  suppliers: [{ id: 's1', owed: 150 }, { id: 's2', owed: 0 }],
  ingredients: [{ id: 'i1', stock: 1000, cost: 0.04 }, { id: 'i2', stock: -50, cost: 1 }, { id: 'i3', stock: 10, cost: 2, active: false }],
  shifts: [
    { id: 's1', openedAt: at(10, 9), closedAt: at(10, 21), expectedCash: 300, countedCash: 295, difference: -5 },
    { id: 's2', openedAt: at(11, 9) },
  ],
};

test('profit and loss: sales belong to the day they were paid, refunds to the day they were made', () => {
  const pl = F.profitAndLoss(MARCH, DATA, SETTINGS);
  // Sold in March: A, B, D (C was sold in February). Refunded in March: C only (D is refunded in April).
  assert.equal(pl.orders, 3);
  assert.equal(pl.grossSales, 200, '100 + 40 + 60');
  assert.equal(pl.discounts, 10);
  assert.equal(pl.salesNet, 190, '90 + 40 + 60');
  assert.equal(pl.refunds, 30, 'C: 30 sold in February, refunded in March');
  assert.equal(pl.revenueSales, 160);
  assert.equal(pl.service, 5);
  assert.equal(pl.revenue, 165);
  // Costs: recipes (A 24, D 20) minus the refunded C (5) = 39; stock lost 8.5 and found 2 = 6.5 lost.
  assert.equal(pl.cogs.recipe, 39);
  assert.equal(pl.cogs.shrink, 6.5);
  assert.equal(pl.cogs.total, 45.5);
  assert.ok(Math.abs(pl.cogs.coverage - (100 + 60) / (100 + 40 + 60)) < 1e-9, 'B has no recipe, so 80% of sales are costed');
  assert.equal(pl.grossProfit, 119.5);
  // Expenses: rent 520 (a voided one, the April rent and the tips payout do not count); utilities 84 less the 4 tax = 80.
  assert.deepEqual(pl.expenses, [{ category: 'Rent', amount: 520 }, { category: 'Utilities', amount: 80 }]);
  assert.equal(pl.expensesTotal, 600);
  assert.equal(pl.netProfit, -480.5);
  assert.ok(Math.abs(pl.grossMargin - 119.5 / 165) < 1e-9);
});

test('profit and loss can take the cost from what was bought instead of the recipes', () => {
  const pl = F.profitAndLoss(MARCH, DATA, SETTINGS, { cogsMethod: 'purchases' });
  assert.equal(pl.cogs.purchases, 300, '(105 − 5 tax) + 200; the voided purchase is ignored');
  assert.equal(pl.cogs.total, 300);
  assert.equal(pl.grossProfit, -135);
});

test('the same sale and refund fall in different months, and an empty period is all zeros', () => {
  const april = [new Date(2026, 3, 1).getTime(), new Date(2026, 4, 1).getTime()];
  const pl = F.profitAndLoss(april, DATA, SETTINGS);
  assert.equal(pl.orders, 0);
  assert.equal(pl.refunds, 60, 'D (sold in March) is refunded in April');
  assert.equal(pl.revenue, -60);
  assert.equal(pl.cogs.recipe, -20, 'its ingredient cost comes back with it');
  assert.equal(pl.expensesTotal, 500);
  const none = F.profitAndLoss([at(1, 0) - 400 * 86400000, at(1, 0) - 399 * 86400000], DATA, SETTINGS);
  assert.deepEqual([none.orders, none.revenue, none.cogs.total, none.expensesTotal, none.netProfit, none.grossMargin, none.cogs.coverage], [0, 0, 0, 0, 0, 0, 0]);
});

test('cash flow by channel: receipts, refunds, purchases, supplier payments, expenses and the owner', () => {
  const cf = F.cashFlow(MARCH, DATA, SETTINGS);
  // Receipts: A cash 99.75?  A total = 100 − 10 + 5 + 4.75 = 99.75; B card 42 + 3 tip; D cash 63.
  assert.deepEqual(cf.receipts, { cash: 162.75, card: 45, other: 0 });
  assert.equal(cf.tips, 3);
  assert.deepEqual(cf.refundsOut, { cash: 0, card: 31.5, other: 0 }, 'C is refunded by card in March');
  assert.deepEqual(cf.boughtOut, { cash: 105, card: 0, other: 50 }, 'what was paid at purchase time, by how it was paid');
  assert.deepEqual(cf.suppliersOut, { cash: 40, card: 0, other: 30 }, 'the voided payment is ignored');
  assert.deepEqual(cf.expensesOut, { cash: 114, card: 0, other: 500 });
  assert.deepEqual(cf.ownerIn, { cash: 300, card: 0, other: 0 });
  assert.deepEqual(cf.ownerOut, { cash: 0, card: 0, other: 100 });
  assert.deepEqual(cf.net, { cash: 162.75 + 300 - 105 - 40 - 114, card: 45 - 31.5, other: -50 - 30 - 500 - 100 });
  assert.equal(cf.totals.net, Math.round((cf.net.cash + cf.net.card + cf.net.other) * 100) / 100);
});

test('tax: output tax by rate less what refunds gave back, input tax from purchases and expenses', () => {
  const tx = F.taxReport(MARCH, DATA, SETTINGS);
  assert.equal(tx.outputTax, 4.75 + 2 + 3 - 1.5);
  assert.deepEqual(tx.byRate, [{ rate: 5, sales: 190 + 40 + 60 - 30, tax: 8.25 }].map(x => ({ ...x, sales: 90 + 40 + 60 - 30 })));
  assert.equal(tx.inputPurchases, 5);
  assert.equal(tx.inputExpenses, 4);
  assert.equal(tx.inputTax, 9);
  assert.equal(tx.payable, -0.75, 'more input tax than output tax: a claim');
  assert.equal(tx.serviceCharge, 5);
});

test('controls: discounts, refunds and voids by person, with the big ones listed', () => {
  const big = bill('o6', { day: 13, subtotal: 100, discount: 50, tax: 2.5, lines: [['Latte', 50, 2, 12]], pay: cash, discountInfo: { type: 'percent', value: 50, by: 'u_admin' } });
  const auto = bill('o7', { day: 14, subtotal: 100, discount: 5, tax: 4.75, lines: [['Latte', 50, 2, 12]], pay: cash, discountInfo: { type: 'percent', value: 5, customerId: 'c1' } });
  const c = F.controls(MARCH, { ...DATA, orders: [...DATA.orders, big, auto] }, SETTINGS);
  assert.equal(c.discounts.count, 3);
  assert.equal(c.discounts.amount, 65);
  assert.deepEqual(c.discounts.manual, { count: 2, amount: 60 });
  assert.deepEqual(c.discounts.automatic, { count: 1, amount: 5 });
  assert.ok(Math.abs(c.discounts.percentOfSales - 65 / 400) < 1e-9, '65 off 400 of sales (A 100, B 40, D 60, o6 100, o7 100)');
  assert.deepEqual(c.refunds, { count: 1, amount: 31.5 });
  assert.deepEqual(c.voids, { count: 1, amount: 115.5, afterKitchen: 1 }, '2 lattes + 10% service + 5% tax, already sent to the kitchen');
  assert.deepEqual(c.bigDiscounts.map(x => [x.number, x.amount, x.userId]), [[6, 50, 'u_admin']], 'only 20% or more is listed');
  const maya = c.staff.find(x => x.userId === 'u_maya');
  assert.equal(maya.discounts, 2, 'her own 10 and the automatic 5, which is put on the cashier who took the payment');
  assert.equal(maya.discountAmount, 15);
  assert.equal(maya.voids, 1);
  const admin = c.staff.find(x => x.userId === 'u_admin');
  assert.deepEqual([admin.discounts, admin.discountAmount, admin.refunds, admin.refundAmount], [1, 50, 1, 31.5]);
  assert.deepEqual(c.staff.map(x => x.userId), ['u_maya', 'u_admin'], 'the person with the most to explain (15 + 115.5 voided) comes first');
});

test('financial position: opening balances plus every movement since the start date, stock on the shelf, minus what is owed', () => {
  const settings = { ...SETTINGS, finance: { openingCash: 1000, openingBank: 2000, startDate: at(1, 0) } };
  const p = F.position(at(31, 23), DATA, settings);
  const cf = F.cashFlow([at(1, 0), at(31, 23) + 1], DATA, settings);
  assert.equal(p.configured, true);
  assert.equal(p.cash, Math.round((1000 + cf.net.cash) * 100) / 100);
  assert.equal(p.bank, Math.round((2000 + cf.net.card + cf.net.other) * 100) / 100);
  assert.equal(p.stock, 40, '1000 × 0.04; a negative count and an inactive ingredient are left out');
  assert.equal(p.owed, 150);
  assert.equal(p.net, Math.round((p.cash + p.bank + p.stock - p.owed) * 100) / 100);
  assert.equal(F.position(Date.now(), DATA, SETTINGS).configured, false, 'no start date set yet');
});

test('the daily summary gathers one day', () => {
  const s = F.daySummary('2026-03-10', DATA, SETTINGS);
  assert.equal(s.date, '2026-03-10');
  assert.equal(s.orders, 1);
  assert.equal(s.grossSales, 100);
  assert.equal(s.discounts, 10);
  assert.equal(s.revenue, 95, '90 + 5 service');
  assert.equal(s.tax, 4.75);
  assert.deepEqual(s.byMethod, { cash: 99.75, card: 0, other: 0 });
  assert.deepEqual(s.shifts, { count: 1, open: 0, expected: 300, counted: 295, difference: -5 });
  const eleventh = F.daySummary('2026-03-11', DATA, SETTINGS);
  assert.equal(eleventh.tips, 3);
  assert.deepEqual(eleventh.shifts, { count: 1, open: 1, expected: 0, counted: 0, difference: 0 }, 'a shift still open is counted as such');
  assert.deepEqual(F.dayBounds('2026-03-10'), [at(10, 0), at(11, 0)]);
  assert.equal(F.dayKey(at(10, 23, 59)), '2026-03-10');
});

test('monthly expenses: one per month from the start month, fixed ids, never twice, never brought back when voided', () => {
  const rent = { id: 't1', category: 'Rent', description: 'Shop', amount: 500, method: 'cash', day: 31, startMonth: '2026-01', active: true };
  const now = at(15);   // March 15th
  let due = F.dueRecurring([rent], [], now);
  assert.deepEqual(due.map(e => e.id), ['rx_t1_202601', 'rx_t1_202602'], 'January and February are due; March 28th is still ahead (day 31 is capped to 28)');
  assert.equal(due[0].date, new Date(2026, 0, 28).getTime());
  assert.equal(due[0].method, 'other', 'a repeating expense is never taken from the till automatically');
  assert.deepEqual([due[0].by, due[0].recurringId, due[0].status, due[0].amount], ['system', 't1', 'active', 500]);
  assert.deepEqual(F.dueRecurring([rent], due, now), [], 'creating them again adds nothing');
  const voided = due.map(e => (e.id.endsWith('01') ? { ...e, status: 'void' } : e));
  assert.deepEqual(F.dueRecurring([rent], voided, now), [], 'a voided one is not recreated');
  due = F.dueRecurring([rent], [], at(29));
  assert.equal(due.length, 3, 'March 28th has passed');
  assert.deepEqual(F.dueRecurring([{ ...rent, active: false }], [], now), []);
  assert.deepEqual(F.dueRecurring([{ ...rent, startMonth: '2026-04' }], [], now), [], 'starts in the future');
  assert.deepEqual(F.dueRecurring([{ ...rent, startMonth: 'nonsense' }, null, { amount: 1 }], [], now), []);
  const closed = F.dueRecurring([rent], [], now, key => key === '2026-01-28');
  assert.equal(closed[0].date, now, 'a day that is already closed is booked today');
  assert.equal(closed[1].date, new Date(2026, 1, 28).getTime());
  assert.equal(F.dueRecurring([{ ...rent, startMonth: '2020-01' }], [], now).length, 36, 'catching up is limited to three years');
});

test('the period before is as long as the period', () => {
  assert.deepEqual(F.previousRange(MARCH.map((t, i) => (i ? at(11, 0) : at(4, 0)))), [at(4, 0) - 7 * 86400000, at(4, 0)]);
  const [a, b] = F.previousRange([at(10, 0), at(11, 0)]);
  assert.equal(b, at(10, 0));
  assert.equal(a, at(9, 0));
});

test('finance setup falls back to defaults', () => {
  const f = F.financeOf({});
  assert.deepEqual([f.openingCash, f.openingBank, f.startDate], [0, 0, 0]);
  assert.ok(f.categories.includes('Rent') && f.categories.includes(F.TIPS_CATEGORY));
  assert.deepEqual(F.financeOf({ finance: { categories: [' Rent ', '', 5, 'Fuel'] } }).categories, ['Rent', 'Fuel']);
});

test('receivables: a statement per customer, and how old each debt is (payments settle the oldest bills first)', () => {
  const NOW = at(20);
  const ago = d => NOW - d * 86400000;
  const credit = (id, number, daysAgo, amount, extra = {}) => ({
    id, number, customerId: 'c1', status: 'paid', paidAt: ago(daysAgo), createdAt: ago(daysAgo), items: [], totals: { total: amount },
    payment: { method: 'credit', amount }, ...extra,
  });
  const data = {
    customers: [{ id: 'c1', name: 'Daw Hla', owing: 110, creditLimit: 500 }, { id: 'c2', name: 'Paid Up', owing: 0 }],
    orders: [
      credit('b1', 1, 70, 100), credit('b2', 2, 40, 50), credit('b3', 3, 5, 30),
      { ...credit('b4', 4, 3, 25), status: 'refunded', refundedAt: ago(2) },   // sold and refunded: nets to nothing
      { id: 'b5', number: 5, customerId: 'c1', status: 'paid', paidAt: ago(1), items: [], totals: { total: 8 }, payment: { method: 'cash', amount: 8 } },   // not on account
    ],
    customerPayments: [
      { id: 'p1', customerId: 'c1', date: ago(35), amount: 60, method: 'cash', status: 'received' },
      { id: 'p2', customerId: 'c1', date: ago(2), amount: 10, method: 'writeoff', status: 'received' },
      { id: 'p3', customerId: 'c1', date: ago(1), amount: 99, method: 'cash', status: 'void' },
    ],
  };
  const st = F.statement('c1', data, SETTINGS);
  assert.deepEqual(st.entries.map(e => [e.kind, e.amount, e.balance]),
    [['bill', 100, 100], ['bill', 50, 150], ['payment', -60, 90], ['bill', 30, 120], ['bill', 25, 145], ['refund', -25, 120], ['writeoff', -10, 110]]);
  assert.equal(st.owing, 110);

  const rec = F.receivables(data, SETTINGS, NOW);
  assert.equal(rec.rows.length, 1, 'a customer who owes nothing is not listed');
  const row = rec.rows[0];
  // 60 paid settles the 70-day-old bill first (40 left), the write-off then takes 10 more: 30 left in 61-90 days.
  assert.deepEqual(row.buckets, { current: 30, d31: 50, d61: 30, d90: 0 });
  assert.equal(row.owing, 110);
  assert.equal(row.limit, 500);
  assert.equal(row.oldest, ago(70));
  assert.deepEqual(rec.totals, { owing: 110, current: 30, d31: 50, d61: 30, d90: 0 });

  // What this device does not know about is shown as "earlier", so the balance is always the customer's real one.
  const partial = { ...data, orders: data.orders.slice(2), customers: [{ id: 'c1', name: 'Daw Hla', owing: 110 }] };
  const part = F.statement('c1', partial, SETTINGS);
  assert.equal(part.entries[0].kind, 'earlier');
  assert.equal(part.entries[part.entries.length - 1].balance, 110);
});
