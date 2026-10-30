'use strict';

// Payment names for "Other" payments (mobile wallets, bank transfer): rules, the settings list and what reports show.
// Run with:  node --test server/test
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, newId } = require('./support.js');
const { settleOrder, paymentByWay, paymentByMethod, computeTotals } = require('../../js/shared.js');
const F = require('../../js/finance.js');

const SETTINGS = { currency: '$', decimals: 2, taxRate: 0, serviceRate: 0, payNames: ['KBZPay', 'Wave Pay'] };
const bill = { items: [{ productId: 'p', name: 'Latte', price: 10, qty: 1 }], discount: null };

// ----- the rules (shared by the browser and the server) -----

test('an Other payment may carry one of the owner\'s names, which is stored with it', () => {
  const { payment } = settleOrder(bill, { method: 'other', via: 'KBZPay' }, SETTINGS);
  assert.deepEqual(payment, { method: 'other', amount: 10, via: 'KBZPay' });
  assert.deepEqual(settleOrder(bill, { method: 'other' }, SETTINGS).payment, { method: 'other', amount: 10 }, 'no name is still fine');
  assert.deepEqual(settleOrder(bill, { method: 'other', via: '' }, SETTINGS).payment, { method: 'other', amount: 10 });
});

test('a name that is not in the list is refused, so a device cannot invent one', () => {
  assert.throws(() => settleOrder(bill, { method: 'other', via: 'Bitcoin' }, SETTINGS), /no longer in Settings/);
  assert.throws(() => settleOrder(bill, { method: 'other', via: 'KBZPay' }, { ...SETTINGS, payNames: [] }), /no longer in Settings/);
  assert.throws(() => settleOrder(bill, { method: 'other', via: 'KBZPay' }, { ...SETTINGS, payNames: undefined }), /no longer in Settings/);
  assert.throws(() => settleOrder(bill, { method: 'other', via: 42 }, SETTINGS), /no longer in Settings/);
  assert.throws(() => settleOrder(bill, { method: 'other', via: 'kbzpay' }, SETTINGS), /no longer in Settings/, 'the name must match exactly');
});

test('a name only goes with Other, never with cash, card or on account', () => {
  assert.throws(() => settleOrder(bill, { method: 'card', via: 'KBZPay' }, SETTINGS), /Invalid payment method/);
  assert.throws(() => settleOrder(bill, { method: 'cash', via: 'KBZPay', tendered: 10 }, SETTINGS), /Invalid payment method/);
});

test('in a split payment the Other part may carry a name, and no other part may', () => {
  const split = (parts) => settleOrder(bill, { method: 'split', parts }, SETTINGS).payment;
  const ok = split([{ method: 'cash', amount: 4, tendered: 4 }, { method: 'other', amount: 6, via: 'Wave Pay' }]);
  assert.deepEqual(ok.parts.find(p => p.method === 'other'), { method: 'other', amount: 6, via: 'Wave Pay' });
  assert.throws(() => split([{ method: 'cash', amount: 4, tendered: 4, via: 'KBZPay' }, { method: 'other', amount: 6 }]), /Invalid payment method/);
  assert.throws(() => split([{ method: 'cash', amount: 4, tendered: 4 }, { method: 'other', amount: 6, via: 'Nope' }]), /no longer in Settings/);
});

test('reports can list wallets apart while the money channels stay as they were', () => {
  assert.deepEqual(paymentByWay({ method: 'other', amount: 10, via: 'KBZPay' }), { 'other:KBZPay': 10 });
  assert.deepEqual(paymentByWay({ method: 'other', amount: 10, tip: 2 }), { other: 12 });
  assert.deepEqual(paymentByWay({ method: 'cash', amount: 10 }), { cash: 10 });
  assert.deepEqual(paymentByWay({ method: 'split', parts: [{ method: 'cash', amount: 4 }, { method: 'other', amount: 6, via: 'Wave Pay' }] }), { cash: 4, 'other:Wave Pay': 6 });
  assert.deepEqual(paymentByWay(null), {});
  // The accounting view (cash flow, drawer) still sees plain "other".
  assert.deepEqual(paymentByMethod({ method: 'other', amount: 10, via: 'KBZPay' }), { other: 10 });
});

test('the dashboard payment mix lists each wallet separately', () => {
  const at = new Date(2026, 2, 10, 12).getTime();
  const order = (id, payment) => ({ id, status: 'paid', paidAt: at, createdAt: at, totals: { total: 10 }, items: [], payment });
  const ov = F.overview([
    order('a', { method: 'other', amount: 10, via: 'KBZPay' }), order('b', { method: 'other', amount: 10, via: 'KBZPay' }),
    order('c', { method: 'other', amount: 10, via: 'Wave Pay' }), order('d', { method: 'other', amount: 10 }), order('e', { method: 'cash', amount: 10 }),
  ], at, SETTINGS);
  assert.deepEqual(Object.fromEntries(ov.methods.map(m => [m.method, m.amount])), { 'other:KBZPay': 20, 'other:Wave Pay': 10, other: 10, cash: 10 });
  assert.equal(ov.methods[0].method, 'other:KBZPay', 'biggest first');
});

// ----- the settings list and paying through the server -----

const settingsOf = async admin => admin.doc('settings', 'main');
async function setNames(admin, payNames) {
  return admin.put('settings', { ...(await settingsOf(admin)), payNames }, 'main');
}

test('the list is cleaned: trimmed, no repeats, no markup, no look-alikes of the built-in methods, a short length', async () => {
  const t = await boot();
  try {
    const admin = await t.login('Admin', '1234');
    let r = await setNames(admin, ['  KBZPay  ', 'kbzpay', 'Wave <b>Pay</b>', '', 'A very long wallet name that goes on and on']);
    assert.equal(r.status, 'ok', r.error);
    assert.deepEqual(r.doc.payNames, ['KBZPay', 'Wave bPay/b', 'A very long wallet n'], 'a name that is only a repeat in another case is dropped; markup characters and anything past 20 are cut');

    for (const reserved of ['Cash', 'card', 'OTHER', 'On account', 'Split']) {
      r = await setNames(admin, ['KBZPay', reserved]);
      assert.equal(r.status, 'error', reserved);
      assert.match(r.error, /already a payment method/);
    }
    r = await setNames(admin, Array.from({ length: 9 }, (_, i) => 'Wallet ' + i));
    assert.equal(r.status, 'error');
    assert.match(r.error, /At most 8 payment names/);
    r = await setNames(admin, 'KBZPay');
    assert.deepEqual(r.doc.payNames, [], 'anything that is not a list becomes an empty list');
  } finally { await t.stop(); }
});

test('only an admin can change the list', async () => {
  const t = await boot();
  try {
    const manager = await t.login('Maya', '1111');
    const r = await manager.put('settings', { ...manager.doc('settings', 'main'), payNames: ['KBZPay'] }, 'main');
    assert.equal(r.status, 'error');
    assert.match(r.error, /permission/);
  } finally { await t.stop(); }
});

function openBill(dev) {
  const p = dev.all('products').find(x => x.name === 'Latte');
  return { id: newId('o_'), number: null, tableId: null, tableName: '', staffId: dev.user.id, status: 'open', note: '', discount: null, createdAt: Date.now(),
    items: [{ id: newId('l_'), productId: p.id, name: p.name, price: p.price, qty: 1, note: '', sentQty: 0 }] };
}
const totalOf = (t, o) => computeTotals(o, t.app.db.doc('settings', 'main')).total;   // the bill with the demo settings' tax
const pay = (t, dev, o, payment) => dev.put('orders', { ...dev.doc('orders', o.id), status: 'paid', totals: { total: totalOf(t, o) }, payment: { ...payment, amount: totalOf(t, o) } });

test('through the server: a wallet payment is stored with its name, and an unknown name is refused', async () => {
  const t = await boot();
  try {
    const admin = await t.login('Admin', '1234');
    assert.equal((await setNames(admin, ['KBZPay', 'Wave Pay'])).status, 'ok');
    const cashier = await t.login('Maya', '1111');

    const a = openBill(cashier); await cashier.put('orders', a);
    const paid = await pay(t, cashier, a, { method: 'other', via: 'KBZPay' });
    assert.equal(paid.status, 'ok', paid.error);
    assert.equal(paid.doc.payment.via, 'KBZPay');
    assert.equal(t.app.db.doc('orders', a.id).payment.via, 'KBZPay');

    const b = openBill(cashier); await cashier.put('orders', b);
    const bad = await pay(t, cashier, b, { method: 'other', via: 'Bitcoin' });
    assert.equal(bad.status, 'error');
    assert.match(bad.error, /no longer in Settings/);
    assert.equal(t.app.db.doc('orders', b.id).status, 'open', 'the bill is still open');

    const withCard = await pay(t, cashier, b, { method: 'card', via: 'KBZPay' });
    assert.equal(withCard.status, 'error');
  } finally { await t.stop(); }
});

test('taking a name off the list does not change bills already paid with it', async () => {
  const t = await boot();
  try {
    const admin = await t.login('Admin', '1234');
    await setNames(admin, ['KBZPay']);
    const cashier = await t.login('Maya', '1111');
    const o = openBill(cashier); await cashier.put('orders', o);
    assert.equal((await pay(t, cashier, o, { method: 'other', via: 'KBZPay' })).status, 'ok');
    await setNames(admin, []);
    assert.equal(t.app.db.doc('orders', o.id).payment.via, 'KBZPay', 'history keeps the name it was paid with');
    const later = openBill(cashier); await cashier.put('orders', later);
    assert.equal((await pay(t, cashier, later, { method: 'other', via: 'KBZPay' })).status, 'error', 'but it cannot be used again');
  } finally { await t.stop(); }
});
