'use strict';

// Deposits: money paid in advance for a booking or an event, kept as credit on the customer's account and used first when a
// bill is put on account. The figures below were worked out by hand. Run with:  node --test server/test
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, newId } = require('./support.js');
const { creditRoom, settleOrder, computeShift, computeTotals } = require('../../js/shared.js');
const F = require('../../js/finance.js');

const SETTINGS = { currency: '$', decimals: 2, taxRate: 0, serviceRate: 0 };
const bill = total => ({ items: [{ productId: 'p', name: 'Set menu', price: total, qty: 1 }], discount: null });
const at = (d, h = 12) => new Date(2026, 2, d, h).getTime();

// ----- the rule for putting a bill on account -----

test('how much a customer may put on account: the limit less what they owe, or just the deposit when there is no limit', () => {
  assert.equal(creditRoom({ creditLimit: 0, owing: -50 }, 2), 50, 'a deposit and no limit: the deposit');
  assert.equal(creditRoom({ creditLimit: 100, owing: -50 }, 2), 150, 'a deposit adds to the limit');
  assert.equal(creditRoom({ creditLimit: 100, owing: 30 }, 2), 70);
  assert.equal(creditRoom({ creditLimit: 0, owing: 30 }, 2), 0, 'owing money and no limit: nothing');
  assert.equal(creditRoom({ creditLimit: 0, owing: 0 }, 2), 0);
  assert.equal(creditRoom(null, 2), 0);
});

test('a bill can be put on account with a deposit and no credit limit, up to the deposit', () => {
  const c = { id: 'c1', name: 'Ma Hla', creditLimit: 0, owing: -50 };
  assert.equal(settleOrder(bill(40), { method: 'credit' }, SETTINGS, c).payment.method, 'credit');
  assert.equal(settleOrder(bill(50), { method: 'credit' }, SETTINGS, c).payment.method, 'credit', 'exactly the deposit');
  assert.throws(() => settleOrder(bill(60), { method: 'credit' }, SETTINGS, c), /Only 50 is left of Ma Hla's deposit/);
  assert.throws(() => settleOrder(bill(40), { method: 'credit' }, SETTINGS, { ...c, owing: 0 }), /has no credit/);
  assert.throws(() => settleOrder(bill(40), { method: 'credit' }, SETTINGS, { ...c, owing: 20 }), /has no credit/, 'owing money is not a deposit');
  assert.throws(() => settleOrder(bill(40), { method: 'credit' }, SETTINGS, { ...c, active: false }), /not active/);
});

test('a bigger bill is paid by splitting: the deposit on account, the rest in cash', () => {
  const c = { id: 'c1', name: 'Ma Hla', creditLimit: 0, owing: -50 };
  const { payment } = settleOrder(bill(80), { method: 'split', parts: [{ method: 'credit', amount: 50 }, { method: 'cash', amount: 30, tendered: 30 }] }, SETTINGS, c);
  assert.deepEqual(payment.parts.map(p => [p.method, p.amount]), [['credit', 50], ['cash', 30]]);
  assert.throws(() => settleOrder(bill(80), { method: 'split', parts: [{ method: 'credit', amount: 60 }, { method: 'cash', amount: 20, tendered: 20 }] }, SETTINGS, c), /Only 50 is left/);
});

test('with a credit limit the deposit counts as room too', () => {
  const c = { id: 'c1', name: 'U Ba', creditLimit: 100, owing: -50 };
  assert.equal(settleOrder(bill(150), { method: 'credit' }, SETTINGS, c).payment.method, 'credit');
  assert.throws(() => settleOrder(bill(151), { method: 'credit' }, SETTINGS, c), /Credit limit: only 150 is available/);
});

// ----- the money in the drawer, the cash flow and the position -----

test('the drawer: a cash deposit is cash in, a cash deposit given back is cash out, other methods and voided ones do not count', () => {
  const shift = { openedAt: at(10, 8), openingFloat: 100 };
  const pay = (over) => ({ customerId: 'c1', amount: 0, method: 'cash', status: 'received', date: at(10, 12), ...over });
  const sums = computeShift(shift, [], 2, [], { customerPayments: [
    pay({ kind: 'deposit', amount: 200 }), pay({ amount: 30 }),                                // a deposit and an ordinary payment, both cash in
    pay({ kind: 'depositRefund', amount: 50 }),                                                // given back
    pay({ kind: 'deposit', amount: 500, method: 'card' }),                                     // card: not in the drawer
    pay({ kind: 'deposit', amount: 70, status: 'void' }),                                      // voided
    pay({ kind: 'deposit', amount: 90, date: at(9, 12) }),                                     // before the shift
  ] });
  assert.equal(sums.received, 230);
  assert.equal(sums.returned, 50);
  assert.equal(sums.expected, 100 + 230 - 50);
});

const customerPay = (over) => ({ id: newId('cp_'), customerId: 'c1', customerName: 'Ma Hla', amount: 0, method: 'cash', status: 'received', date: at(5), ...over });
const DATA = { orders: [], customerPayments: [
  customerPay({ kind: 'deposit', amount: 200 }), customerPay({ kind: 'deposit', amount: 300, method: 'other' }),
  customerPay({ kind: 'depositRefund', amount: 40, date: at(6) }), customerPay({ kind: 'depositRefund', amount: 60, method: 'other', date: at(6) }),
  customerPay({ amount: 25, date: at(6) }), customerPay({ kind: 'deposit', amount: 999, status: 'void' }),
] };

test('cash flow: deposits are money in, deposits given back are money out, by channel', () => {
  const cf = F.cashFlow([at(1, 0), at(31, 0)], DATA, SETTINGS);
  assert.deepEqual(cf.customerIn, { cash: 225, card: 0, other: 300 }, 'the deposits and the ordinary payment');
  assert.deepEqual(cf.customerOut, { cash: 40, card: 0, other: 60 });
  assert.deepEqual(cf.net, { cash: 185, card: 0, other: 240 });
  assert.equal(cf.totals.net, 425);
});

test('position: the cash and bank follow the deposits, and the deposit still held is owed to the customer', () => {
  const settings = { ...SETTINGS, finance: { openingCash: 1000, openingBank: 0, startDate: at(1, 0), categories: [] } };
  const data = { ...DATA, customers: [{ id: 'c1', name: 'Ma Hla', owing: -400 }, { id: 'c2', name: 'U Ba', owing: 75 }] };
  const p = F.position(at(31, 0), data, settings);
  assert.equal(p.cash, 1000 + 185);
  assert.equal(p.bank, 240);
  assert.equal(p.customerCredit, 400, 'deposits held are a debt to the customer, not income');
  assert.equal(p.receivable, 75);
  assert.equal(p.net, 1185 + 240 + 75 - 400);
});

test('the account statement shows the deposit as credit, and giving it back takes the credit away', () => {
  const data = {
    customers: [{ id: 'c1', name: 'Ma Hla', owing: -160, createdAt: 0 }],
    customerPayments: [customerPay({ kind: 'deposit', amount: 200, date: at(5) }), customerPay({ kind: 'depositRefund', amount: 40, date: at(6) })],
    orders: [],
  };
  const st = F.statement('c1', data, SETTINGS, 0);
  assert.deepEqual(st.entries.map(e => [e.kind, e.amount, e.balance]), [['deposit', -200, -200], ['depositRefund', 40, -160]]);
  assert.equal(st.owing, -160);
});

test('ageing: a deposit pays the next bill before any debt is counted', () => {
  const settings = SETTINGS;
  const onAccount = (id, total, day) => ({ id, number: 1, customerId: 'c1', status: 'paid', paidAt: at(day), totals: { total }, payment: { method: 'credit', amount: total } });
  const make = (bills) => ({
    customers: [{ id: 'c1', name: 'Ma Hla', owing: 0, createdAt: 0 }],
    customerPayments: [customerPay({ kind: 'deposit', amount: 100, date: at(1) })], orders: bills,
  });
  const owingOf = (d, owing) => F.receivables({ ...d, customers: [{ ...d.customers[0], owing }] }, settings, at(20), 0).rows;
  const credit = owingOf(make([onAccount('b', 80, 5)]), -20);
  assert.equal(credit.length, 1, 'a customer still in credit is listed');
  assert.equal(credit[0].owing, -20, 'in credit by 100 − 80');
  assert.ok(Object.values(credit[0].buckets).every(v => v === 0) && credit[0].oldest === null, 'but no debt is counted or aged');
  const rows = owingOf(make([onAccount('b', 130, 5)]), 30);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].owing, 30);
  assert.equal(Object.values(rows[0].buckets).reduce((n, v) => n + v, 0), 30, 'the ageing adds up to what is owed: 130 − 100');
  const refunded = make([onAccount('b', 80, 5)]);
  refunded.customerPayments.push(customerPay({ kind: 'depositRefund', amount: 20, date: at(6) }));
  assert.deepEqual(owingOf(refunded, 0), [], 'what is left of the deposit is given back; nothing owed');
});

// ----- through the server -----

async function setup() {
  const t = await boot();
  const cashier = await t.login('Maya', '1111');
  const customer = (await cashier.put('customers', { id: newId('c_'), name: 'Ma Hla', phone: '09 111 222', note: '', active: true })).doc;
  const deposit = (over = {}) => ({ id: newId('cp_'), customerId: customer.id, amount: 50, method: 'cash', note: 'Wedding', kind: 'deposit', ...over });
  const owing = () => t.app.db.doc('customers', customer.id).owing;
  return { t, cashier, customer, deposit, owing };
}

test('a cashier takes a deposit: the account goes into credit, with the booking it is for', async () => {
  const { t, cashier, customer, deposit, owing } = await setup();
  try {
    const r = await cashier.put('customerPayments', deposit({ reservationId: 'r_123', amount: 80 }));
    assert.equal(r.status, 'ok', r.error);
    assert.equal(r.doc.kind, 'deposit');
    assert.equal(r.doc.reservationId, 'r_123');
    assert.equal(r.doc.customerName, 'Ma Hla');
    assert.equal(r.doc.by, cashier.user.id);
    assert.equal(owing(), -80, 'in credit');
    assert.equal((await cashier.put('customerPayments', deposit({ amount: 20, reservationId: 'x'.repeat(100) }))).doc.reservationId, undefined, 'a silly reference is dropped');
    assert.equal(owing(), -100);
    const log = t.app.db.auditPage(20).filter(a => a.action === 'deposit received');
    assert.equal(log.length, 2);
    assert.equal(log[1].target, 'Ma Hla');
  } finally { await t.stop(); }
});

test('an ordinary payment still cannot be more than is owed, and the kinds and methods are checked', async () => {
  const { t, cashier, deposit } = await setup();
  try {
    assert.equal((await cashier.put('customerPayments', deposit({ kind: 'payment', amount: 10 }))).status, 'error', 'nothing is owed, so nothing can be paid');
    assert.equal((await cashier.put('customerPayments', deposit({ kind: 'bonus' }))).status, 'error');
    assert.equal((await cashier.put('customerPayments', deposit({ method: 'writeoff' }))).status, 'error', 'a deposit cannot be a write-off');
    assert.equal((await cashier.put('customerPayments', deposit({ amount: 0 }))).status, 'error');
    assert.equal((await cashier.put('customerPayments', deposit({ amount: -5 }))).status, 'error');
    assert.equal((await cashier.put('customerPayments', deposit({ customerId: 'c_nope' }))).status, 'error');
    const waiter = await t.login('Leo', '2222');
    assert.equal((await waiter.put('customerPayments', deposit())).status, 'error', 'a waiter does not take money');
  } finally { await t.stop(); }
});

test('the deposit is used when a bill is put on account, and runs out', async () => {
  const { t, cashier, customer, deposit, owing } = await setup();
  try {
    await cashier.put('customerPayments', deposit({ amount: 50 }));
    const latte = cashier.all('products').find(p => p.name === 'Latte');
    const open = () => ({ id: newId('o_'), number: null, tableId: null, tableName: '', staffId: cashier.user.id, customerId: customer.id, status: 'open', note: '', discount: null, createdAt: Date.now(),
      items: [{ id: newId('l_'), productId: latte.id, name: latte.name, price: latte.price, qty: 3, note: '', sentQty: 0 }] });
    const payOnAccount = async (o, payment) => {
      const total = computeTotals(o, t.app.db.doc('settings', 'main')).total;
      return cashier.put('orders', { ...cashier.doc('orders', o.id), status: 'paid', totals: { total }, payment: { amount: total, ...payment } });
    };
    const a = open(); await cashier.put('orders', a);
    const total = computeTotals(a, t.app.db.doc('settings', 'main')).total;                 // 3 lattes with tax
    assert.ok(total < 50 && total > 10);
    const paid = await payOnAccount(a, { method: 'credit' });
    assert.equal(paid.status, 'ok', paid.error);
    assert.equal(owing(), Math.round((-50 + total) * 100) / 100, 'the bill used part of the deposit');

    // The next bill is too big for what is left.
    const b = open(); b.items[0].qty = 9; await cashier.put('orders', b);
    const tooBig = await payOnAccount(b, { method: 'credit' });
    assert.equal(tooBig.status, 'error');
    assert.match(tooBig.error, /is left of Ma Hla's deposit/);
    assert.equal(t.app.db.doc('orders', b.id).status, 'open');
  } finally { await t.stop(); }
});

test('giving a deposit back needs a manager, cannot exceed what is held, and lowers the credit', async () => {
  const { t, cashier, customer, deposit, owing } = await setup();
  try {
    await cashier.put('customerPayments', deposit({ amount: 100 }));
    const refund = (over = {}) => ({ id: newId('cp_'), customerId: customer.id, amount: 40, method: 'cash', kind: 'depositRefund', ...over });
    const admin = await t.login('Admin', '1234');

    const alone = await cashier.put('customerPayments', refund({ approvedBy: admin.user.id }));
    assert.equal(alone.status, 'error');
    assert.match(alone.error, /Manager approval required/);
    assert.equal(owing(), -100, 'nothing changed');

    assert.equal((await t.call('/api/verify-pin', { token: cashier.token, method: 'POST', body: { pin: '1234' } })).status, 200);
    const ok = await cashier.put('customerPayments', refund({ approvedBy: admin.user.id }));
    assert.equal(ok.status, 'ok', ok.error);
    assert.equal(ok.doc.kind, 'depositRefund');
    assert.equal(ok.doc.approvedBy, admin.user.id);
    assert.equal(owing(), -60);

    const tooMuch = await cashier.put('customerPayments', refund({ amount: 61, approvedBy: admin.user.id }));
    assert.equal(tooMuch.status, 'error');
    assert.match(tooMuch.error, /Only 60 of Ma Hla's deposit is left to give back/);

    // A manager signed in needs no approval of their own.
    const direct = await admin.put('customerPayments', refund({ amount: 60, approvedBy: admin.user.id }));
    assert.equal(direct.status, 'ok', direct.error);
    assert.equal(owing(), 0);
    const log = t.app.db.auditPage(30).filter(a => a.action === 'deposit given back');
    assert.equal(log.length, 2);
    assert.match(log[0].detail, /approved by Admin/);
  } finally { await t.stop(); }
});

test('voiding: a manager can void a deposit that was not used, and not one that was', async () => {
  const { t, cashier, customer, deposit, owing } = await setup();
  try {
    const d = (await cashier.put('customerPayments', deposit({ amount: 100 }))).doc;
    assert.equal((await cashier.put('customerPayments', { ...d, status: 'void' })).status, 'error', 'a cashier cannot void');
    const admin = await t.login('Admin', '1234');
    const voided = await admin.put('customerPayments', { ...admin.doc('customerPayments', d.id), status: 'void' });
    assert.equal(voided.status, 'ok', voided.error);
    assert.equal(owing(), 0, 'the credit is gone again');

    // Use part of a second deposit, then try to void it.
    const d2 = (await cashier.put('customerPayments', deposit({ amount: 100 }))).doc;
    t.app.db.put('customers', customer.id, { ...t.app.db.doc('customers', customer.id), owing: -30 });   // 70 of it was used on a bill
    await admin.load();
    const refused = await admin.put('customerPayments', { ...admin.doc('customerPayments', d2.id), status: 'void' });
    assert.equal(refused.status, 'error');
    assert.match(refused.error, /already been used on a bill/);
    assert.equal(owing(), -30);

    // Voiding a deposit that was given back restores what the refund took away.
    t.app.db.put('customers', customer.id, { ...t.app.db.doc('customers', customer.id), owing: -100 });
    const r = (await admin.put('customerPayments', { id: newId('cp_'), customerId: customer.id, amount: 40, method: 'cash', kind: 'depositRefund', approvedBy: admin.user.id })).doc;
    assert.equal(owing(), -60);
    assert.equal((await admin.put('customerPayments', { ...admin.doc('customerPayments', r.id), status: 'void' })).status, 'ok');
    assert.equal(owing(), -100, 'the refund is undone');
  } finally { await t.stop(); }
});
