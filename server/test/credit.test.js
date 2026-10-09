'use strict';

// Sales on account: a customer takes the goods now and pays later. The server checks the credit limit, keeps what each
// customer owes, and lets customers pay it off (or a manager write it off). Run with:  node --test server/test
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../../js/finance.js');
const { computeShift } = require('../../js/shared.js');
const { boot, newId } = require('./support.js');

// An admin, a manager (Mina), a cashier (Maya), a waiter (Leo) and the kitchen, all signed in.
async function team(t) {
  const admin = await t.login('Admin', '1234');
  const r = await admin.put('users', { id: newId('u_'), name: 'Mina', role: 'manager', pin: '4826', active: true });
  assert.equal(r.status, 'ok', r.error);
  return { admin, mina: await t.login('Mina', '4826'), maya: await t.login('Maya', '1111'), leo: await t.login('Leo', '2222'), cook: await t.login('Kitchen', '3333') };
}

const customer = (over = {}) => ({ id: newId('c_'), name: 'Daw Hla', phone: '', note: '', active: true, ...over });

// Opens a bill with some espressos for a customer; returns what is needed to pay it.
async function openBill(dev, qty, customerId) {
  const p = dev.all('products').find(x => x.name === 'Espresso');
  const doc = {
    id: newId('o_'), number: null, tableId: null, tableName: '', staffId: dev.user.id, status: 'open', note: '', discount: null, createdAt: Date.now(),
    ...(customerId ? { customerId } : {}), items: [{ id: newId('l_'), productId: p.id, name: p.name, price: p.price, qty, sentQty: 0, note: '' }],
  };
  const r = await dev.put('orders', doc);
  assert.equal(r.status, 'ok', r.error);
  return r.doc;
}
const pay = (dev, order, payment) => dev.put('orders', { ...dev.doc('orders', order.id), status: 'paid', payment });
const owing = (t, id) => t.app.db.doc('customers', id).owing || 0;

test('only a manager sets a credit limit; what a customer owes can never be set from a device', async () => {
  const t = await boot();
  try {
    const { mina, maya } = await team(t);
    const made = await maya.put('customers', customer());
    assert.equal(made.status, 'ok', made.error);
    assert.deepEqual([made.doc.creditLimit, made.doc.owing], [0, 0]);

    assert.match((await maya.put('customers', { ...made.doc, creditLimit: 100 })).error, /manager/);
    assert.equal((await maya.put('customers', customer({ creditLimit: 50 }))).status, 'error', 'not even on a new customer');
    await mina.load();
    const limited = await mina.put('customers', { ...mina.doc('customers', made.doc.id), creditLimit: 100, owing: 9999 });
    assert.equal(limited.status, 'ok', limited.error);
    assert.deepEqual([limited.doc.creditLimit, limited.doc.owing], [100, 0], 'owing was not taken from the device');
    assert.equal((await mina.put('customers', { ...limited.doc, creditLimit: -5 })).status, 'error');
    assert.equal((await mina.put('customers', { ...limited.doc, creditLimit: 'lots' })).doc.creditLimit, 0, 'text counts as none');
  } finally { await t.stop(); }
});

test('a bill goes on account within the limit, adds to what the customer owes, and a refund takes it back', async () => {
  const t = await boot();
  try {
    const { mina, maya, leo } = await team(t);
    const c = (await mina.put('customers', customer({ creditLimit: 100 }))).doc;
    await maya.load();

    // One bill on account.
    const bill = await openBill(maya, 2, c.id);
    const paid = await pay(maya, bill, { method: 'credit' });
    assert.equal(paid.status, 'ok', paid.error);
    const total = paid.doc.totals.total;
    assert.equal(paid.doc.payment.method, 'credit');
    assert.equal(owing(t, c.id), total);

    // A waiter cannot take payment, so cannot put a bill on account either.
    const wb = await openBill(leo, 1);   // (a waiter cannot even put a customer on a bill)
    assert.equal((await pay(leo, wb, { method: 'credit' })).status, 'error');

    // Over the limit, with no customer, with a tip, on a customer with no credit: all refused.
    const big = await openBill(maya, 40, c.id);
    assert.match((await pay(maya, big, { method: 'credit' })).error, /Credit limit: only/);
    const none = await openBill(maya, 1);
    assert.match((await pay(maya, none, { method: 'credit' })).error, /Choose a customer/);
    const tipped = await openBill(maya, 1, c.id);
    assert.match((await pay(maya, tipped, { method: 'credit', tip: 1 })).error, /tip/);
    const plain = (await maya.put('customers', customer({ name: 'No Credit' }))).doc;
    const nb = await openBill(maya, 1, plain.id);
    assert.match((await pay(maya, nb, { method: 'credit' })).error, /no credit/);
    assert.equal(owing(t, c.id), total, 'refused bills changed nothing');

    // Part on account, part in cash: the credit part is what is owed.
    const split = await openBill(maya, 2, c.id);
    const doc = maya.doc('orders', split.id);
    const tot = Math.round(2 * doc.items[0].price * 1.07 * 100) / 100;   // the demo tax rate is 7%
    const credit = 3;
    const sp = await pay(maya, split, { method: 'split', parts: [{ method: 'cash', amount: Math.round((tot - credit) * 100) / 100 }, { method: 'credit', amount: credit }] });
    assert.equal(sp.status, 'ok', sp.error);
    assert.equal(owing(t, c.id), Math.round((total + credit) * 100) / 100);
    // The credit part can only be the bill, never more.
    const sp2 = await openBill(maya, 1, c.id);
    assert.match((await pay(maya, sp2, { method: 'split', parts: [{ method: 'cash', amount: 0.5 }, { method: 'credit', amount: 99 }] })).error, /bill itself|add up|limit/);

    // A manager refunds the first bill: the debt comes off, and the customer can use that room again.
    await mina.load();
    const refunded = await mina.put('orders', { ...mina.doc('orders', paid.doc.id), status: 'refunded', refundedBy: mina.user.id });
    assert.equal(refunded.status, 'ok', refunded.error);
    assert.equal(owing(t, c.id), credit);
  } finally { await t.stop(); }
});

test('customers pay their account in cash, card or by bank; a manager writes off what will not be paid; payments can be voided', async () => {
  const t = await boot();
  try {
    const { mina, maya, leo, cook } = await team(t);
    const c = (await mina.put('customers', customer({ creditLimit: 500 }))).doc;
    await maya.load();
    const bill = await openBill(maya, 20, c.id);
    const total = (await pay(maya, bill, { method: 'credit' })).doc.totals.total;
    assert.equal(owing(t, c.id), total);

    const payment = over => ({ id: newId('cp_'), customerId: c.id, amount: 10, method: 'cash', ...over });
    assert.equal((await leo.put('customerPayments', payment())).status, 'error', 'a waiter cannot');
    const first = await maya.put('customerPayments', payment({ note: '  first part ' }));
    assert.equal(first.status, 'ok', first.error);
    assert.deepEqual([first.doc.status, first.doc.customerName, first.doc.note, first.doc.by], ['received', 'Daw Hla', 'first part', maya.user.id]);
    assert.equal(owing(t, c.id), Math.round((total - 10) * 100) / 100);

    for (const [what, over] of Object.entries({ 'no amount': { amount: 0 }, 'text': { amount: 'ten' }, 'unknown method': { method: 'gold' }, 'more than owed': { amount: 99999 }, 'no such customer': { customerId: 'c_nobody' } })) {
      assert.equal((await maya.put('customerPayments', payment(over))).status, 'error', what);
    }
    assert.match((await maya.put('customerPayments', payment({ method: 'writeoff' }))).error, /permission/, 'a cashier cannot write a debt off');
    assert.equal((await maya.put('customerPayments', { ...first.doc, amount: 1 })).status, 'error', 'no editing');

    // By card, then the manager writes off 5.
    assert.equal((await maya.put('customerPayments', payment({ method: 'card', amount: 20 }))).status, 'ok');
    const off = await mina.put('customerPayments', payment({ method: 'writeoff', amount: 5 }));
    assert.equal(off.status, 'ok', off.error);
    assert.equal(owing(t, c.id), Math.round((total - 35) * 100) / 100);

    // Voiding is a manager's job and gives the debt back.
    await maya.load();
    assert.equal((await maya.put('customerPayments', { ...maya.doc('customerPayments', first.doc.id), status: 'void' })).status, 'error');
    await mina.load();
    const v = await mina.put('customerPayments', { ...mina.doc('customerPayments', first.doc.id), status: 'void' });
    assert.equal(v.status, 'ok', v.error);
    assert.equal(owing(t, c.id), Math.round((total - 25) * 100) / 100);

    // Who sees the payments: those who take money and manage; not the waiter or the kitchen.
    for (const d of [mina, maya, leo, cook]) await d.load();
    assert.equal(maya.all('customerPayments').length, 3);
    assert.equal(mina.all('customerPayments').length, 3);
    assert.deepEqual([leo.all('customerPayments').length, cook.all('customerPayments').length], [0, 0]);

    // A customer who owes cannot be deleted.
    assert.match((await mina.remove('customers', c.id)).error, /owes money|has bills/);
  } finally { await t.stop(); }
});

test('cash paid by a customer is in the drawer; the statements know the difference between a sale on account and money', async () => {
  const t = await boot();
  try {
    const { mina, maya } = await team(t);
    const c = (await mina.put('customers', customer({ creditLimit: 500 }))).doc;
    await maya.load();
    const shiftId = newId('s_');
    await maya.put('shifts', { id: shiftId, openingFloat: 100 });
    const bill = await openBill(maya, 10, c.id);
    const total = (await pay(maya, bill, { method: 'credit' })).doc.totals.total;
    await maya.put('customerPayments', { id: newId('cp_'), customerId: c.id, amount: 12, method: 'cash' });
    await maya.put('customerPayments', { id: newId('cp_'), customerId: c.id, amount: 8, method: 'card' });

    await maya.load();
    const onDevice = computeShift(maya.doc('shifts', shiftId), maya.all('orders'), 2, [], { customerPayments: maya.all('customerPayments') });
    assert.equal(onDevice.received, 12);
    assert.equal(onDevice.expected, 112, 'the sale on account put nothing in the drawer; the 12 in cash did');
    const closed = await maya.put('shifts', { ...maya.doc('shifts', shiftId), countedCash: 112 });
    assert.equal(closed.status, 'ok', closed.error);
    assert.deepEqual([closed.doc.expectedCash, closed.doc.difference, closed.doc.received], [112, 0, 12]);

    // The statements: the bill is revenue but no money; the payments are money.
    const data = { orders: t.app.db.all('orders'), customerPayments: t.app.db.all('customerPayments'), customers: t.app.db.all('customers'), shifts: t.app.db.all('shifts') };
    const settings = t.app.db.doc('settings', 'main');
    const day = [new Date().setHours(0, 0, 0, 0), new Date().setHours(0, 0, 0, 0) + 86400000];
    const cf = F.cashFlow(day, data, settings);
    assert.deepEqual(cf.receipts, { cash: 0, card: 0, other: 0 }, 'a sale on account is not money received');
    assert.deepEqual(cf.customerIn, { cash: 12, card: 8, other: 0 });
    assert.equal(F.profitAndLoss(day, data, settings).revenue, Math.round(total / 1.07 * 100) / 100, 'it is revenue (without the 7% tax)');
    const pos = F.position(Date.now(), data, settings);
    assert.equal(pos.receivable, Math.round((total - 20) * 100) / 100, 'what is still owed is an asset');
    const sum = F.daySummary(F.dayKey(Date.now()), data, settings);
    assert.equal(sum.onAccount, total);
    assert.equal(sum.customerPaid, 20);
    assert.deepEqual(sum.byMethod, { cash: 0, card: 0, other: 0 });
  } finally { await t.stop(); }
});

test('a day that has been closed does not take customer payments or voids', async () => {
  const t = await boot();
  try {
    const { mina, maya } = await team(t);
    const c = (await mina.put('customers', customer({ creditLimit: 500 }))).doc;
    await maya.load();
    const bill = await openBill(maya, 5, c.id);
    await pay(maya, bill, { method: 'credit' });
    const early = await maya.put('customerPayments', { id: newId('cp_'), customerId: c.id, amount: 2, method: 'cash' });
    assert.equal((await mina.put('dayCloses', { id: F.dayKey(Date.now()) })).status, 'ok');
    assert.match((await maya.put('customerPayments', { id: newId('cp_'), customerId: c.id, amount: 1, method: 'cash' })).error, /already closed/);
    await mina.load();
    assert.match((await mina.put('customerPayments', { ...mina.doc('customerPayments', early.doc.id), status: 'void' })).error, /already closed/);
  } finally { await t.stop(); }
});

test('the activity log records credit limits, payments and write-offs', async () => {
  const t = await boot();
  try {
    const { admin, mina, maya } = await team(t);
    const c = (await mina.put('customers', customer({ creditLimit: 100 }))).doc;
    await maya.load();
    const bill = await openBill(maya, 3, c.id);
    await pay(maya, bill, { method: 'credit' });
    await maya.put('customerPayments', { id: newId('cp_'), customerId: c.id, amount: 1, method: 'cash' });
    await mina.put('customerPayments', { id: newId('cp_'), customerId: c.id, amount: 1, method: 'writeoff' });
    const log = (await t.call('/api/audit?limit=100', { token: admin.token })).data.rows.map(r => r.action);
    for (const a of ['customer paid', 'debt written off']) assert.ok(log.includes(a), a);
  } finally { await t.stop(); }
});
