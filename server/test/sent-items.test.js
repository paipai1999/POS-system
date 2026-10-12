'use strict';

// Food that has gone to the kitchen cannot be taken off the bill without a manager. The screen asks for a manager PIN;
// these tests check that the server asks too, so a changed app (or a script) cannot skip it.
// Run with:  node --test server/test
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, newId } = require('./support.js');

const NEEDS_MANAGER = /Manager approval required/;

// A bill with Espresso x2 (already sent to the kitchen) and Latte x1 (not sent yet).
function billWithSentItems(dev) {
  const product = name => dev.all('products').find(p => p.name === name);
  const line = (name, qty, sentQty) => {
    const p = product(name);
    return { id: newId('l_'), productId: p.id, name: p.name, price: p.price, qty, note: '', sentQty };
  };
  return {
    id: newId('o_'), number: null, tableId: null, tableName: '', staffId: dev.user.id, status: 'open', note: '', discount: null,
    createdAt: Date.now(), items: [line('Espresso', 2, 2), line('Latte', 1, 0)],
  };
}

const sentRemovedLog = t => t.app.db.auditPage(100).filter(r => r.action === 'sent items removed');
const withItems = (order, items) => ({ ...order, items });
const edit = (order, id, change) => order.items.map(l => (l.id === id ? { ...l, ...change } : l));

async function setup() {
  const t = await boot();
  const waiter = await t.login('Leo', '2222');
  const order = billWithSentItems(waiter);
  assert.equal((await waiter.put('orders', order)).status, 'ok');
  const sent = order.items[0], unsent = order.items[1];
  return { t, waiter, order: waiter.doc('orders', order.id), sent, unsent };
}

test('a waiter cannot take sent items off the bill, however it is done', async () => {
  const { t, waiter, order, sent } = await setup();
  try {
    const attempts = {
      'remove the line': order.items.filter(l => l.id !== sent.id),
      'lower the quantity': edit(order, sent.id, { qty: 1, sentQty: 1 }),
      'lower the quantity but keep the sent count': edit(order, sent.id, { qty: 1 }),
      'set the sent count to zero first': edit(order, sent.id, { sentQty: 0 }),
      'remove the line and add the same dish again as unsent': [...order.items.filter(l => l.id !== sent.id), { ...sent, id: newId('l_'), sentQty: 0 }],
    };
    for (const [how, items] of Object.entries(attempts)) {
      const r = await waiter.put('orders', withItems(order, items));
      assert.equal(r.status, 'error', how);
      assert.match(r.error, NEEDS_MANAGER, how);
    }
    // The bill on the server is untouched, and nothing was logged for the refused tries.
    const stored = t.app.db.doc('orders', order.id);
    assert.deepEqual(stored.items.map(l => [l.name, l.qty, l.sentQty]), [['Espresso', 2, 2], ['Latte', 1, 0]]);
    assert.equal(sentRemovedLog(t).length, 0);
  } finally { await t.stop(); }
});

test('items that were not sent yet can still be changed freely', async () => {
  const { t, waiter, order, unsent } = await setup();
  try {
    assert.equal((await waiter.put('orders', withItems(order, edit(order, unsent.id, { qty: 3 })))).status, 'ok');
    const now = waiter.doc('orders', order.id);
    assert.equal((await waiter.put('orders', withItems(now, now.items.filter(l => l.id !== unsent.id)))).status, 'ok');
    assert.equal(sentRemovedLog(t).length, 0, 'nothing sent was removed, so nothing is logged');
  } finally { await t.stop(); }
});

test('sending more to the kitchen, and adding items, needs no approval', async () => {
  const { t, waiter, order, unsent } = await setup();
  try {
    const sendAll = order.items.map(l => ({ ...l, sentQty: l.qty }));
    assert.equal((await waiter.put('orders', withItems(order, sendAll))).status, 'ok');
    const now = waiter.doc('orders', order.id);
    assert.equal((await waiter.put('orders', withItems(now, edit(now, unsent.id, { qty: 4 })))).status, 'ok');
  } finally { await t.stop(); }
});

test('a manager typing their PIN on the waiter\'s device approves it, and the log says who and what', async () => {
  const { t, waiter, order, sent } = await setup();
  try {
    assert.equal((await t.call('/api/verify-pin', { token: waiter.token, method: 'POST', body: { pin: '1234' } })).status, 200);
    const r = await waiter.put('orders', withItems(order, edit(order, sent.id, { qty: 1, sentQty: 1 })));
    assert.equal(r.status, 'ok', r.error);
    const log = sentRemovedLog(t);
    assert.equal(log.length, 1);
    assert.equal(log[0].user, 'Leo');
    assert.match(log[0].detail, /1 x Espresso/);
    assert.match(log[0].detail, /approved by Admin/);
  } finally { await t.stop(); }
});

test('a manager approving on someone else\'s device does not help this device', async () => {
  const { t, waiter, order, sent } = await setup();
  try {
    const other = await t.login('Maya', '1111');
    assert.equal((await t.call('/api/verify-pin', { token: other.token, method: 'POST', body: { pin: '1234' } })).status, 200);
    const r = await waiter.put('orders', withItems(order, order.items.filter(l => l.id !== sent.id)));
    assert.equal(r.status, 'error');
    assert.match(r.error, NEEDS_MANAGER);
  } finally { await t.stop(); }
});

test('the waiter typing their own PIN is not a manager approval', async () => {
  const { t, waiter, order, sent } = await setup();
  try {
    assert.equal((await t.call('/api/verify-pin', { token: waiter.token, method: 'POST', body: { pin: '2222' } })).status, 200);
    const r = await waiter.put('orders', withItems(order, order.items.filter(l => l.id !== sent.id)));
    assert.equal(r.status, 'error');
    assert.match(r.error, NEEDS_MANAGER);
  } finally { await t.stop(); }
});

test('a manager who is signed in does it directly, and it is still logged', async () => {
  const { t, order, sent } = await setup();
  try {
    const admin = await t.login('Admin', '1234');
    const r = await admin.put('orders', withItems(order, order.items.filter(l => l.id !== sent.id)));
    assert.equal(r.status, 'ok', r.error);
    const log = sentRemovedLog(t);
    assert.equal(log.length, 1);
    assert.match(log[0].detail, /2 x Espresso.*approved by Admin/);
  } finally { await t.stop(); }
});

test('paying cannot be used to slip sent items off the bill', async () => {
  const { t, order, sent } = await setup();
  try {
    const cashier = await t.login('Maya', '1111');
    const items = order.items.filter(l => l.id !== sent.id);
    const total = items.reduce((n, l) => n + l.price * l.qty, 0);
    const r = await cashier.put('orders', {
      ...order, items, status: 'paid', totals: { total }, payment: { method: 'cash', amount: total, tendered: total },
    });
    assert.equal(r.status, 'error');
    assert.match(r.error, NEEDS_MANAGER);
    assert.equal(t.app.db.doc('orders', order.id).status, 'open');
  } finally { await t.stop(); }
});

test('two lines cannot share one id (it could hide a removal)', async () => {
  const { t, waiter, order, sent } = await setup();
  try {
    const r = await waiter.put('orders', withItems(order, [...order.items, { ...sent, qty: 1, sentQty: 0 }]));
    assert.equal(r.status, 'error');
    assert.match(r.error, /Invalid order line/);
  } finally { await t.stop(); }
});

// ----- deleting a whole bill -----

const ticketFor = (order, status = 'new') => ({
  id: newId('k_'), orderId: order.id, orderNo: order.number, where: 'Takeaway', staffId: order.staffId,
  items: order.items.map(l => ({ name: l.name, qty: l.qty, note: '' })), note: '', status, createdAt: Date.now(),
});

test('a bill the kitchen has a ticket for cannot be deleted, even when its sent counts say zero', async () => {
  const t = await boot();
  try {
    const waiter = await t.login('Leo', '2222');
    const order = billWithSentItems(waiter);
    order.items.forEach(l => { l.sentQty = 0; });          // a changed app that never records what it sent
    assert.equal((await waiter.put('orders', order)).status, 'ok');
    assert.equal((await waiter.put('kitchenTickets', ticketFor(order))).status, 'ok');
    const r = await waiter.remove('orders', order.id);
    assert.equal(r.status, 'error');
    assert.match(r.error, /Only unsent open orders can be removed/);
    assert.ok(t.app.db.doc('orders', order.id), 'the bill is still there');
  } finally { await t.stop(); }
});

test('a bill nothing was sent for can still be deleted, and so can one whose ticket was voided', async () => {
  const t = await boot();
  try {
    const waiter = await t.login('Leo', '2222');
    const plain = billWithSentItems(waiter);
    plain.items.forEach(l => { l.sentQty = 0; });
    await waiter.put('orders', plain);
    assert.equal((await waiter.remove('orders', plain.id)).status, 'ok');

    const cancelled = billWithSentItems(waiter);
    cancelled.items.forEach(l => { l.sentQty = 0; });
    await waiter.put('orders', cancelled);
    await waiter.put('kitchenTickets', ticketFor(cancelled, 'void'));
    assert.equal((await waiter.remove('orders', cancelled.id)).status, 'ok');
  } finally { await t.stop(); }
});

test('a bill with sent items still cannot be deleted by anyone, a manager included (it is voided instead)', async () => {
  const { t, order } = await setup();
  try {
    const admin = await t.login('Admin', '1234');
    const r = await admin.remove('orders', order.id);
    assert.equal(r.status, 'error');
    assert.match(r.error, /Only unsent open orders can be removed/);
  } finally { await t.stop(); }
});
