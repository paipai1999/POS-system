'use strict';

// Money records that are not bills (expenses, repeating expenses, the owner's cash moves, the daily close), as the server
// enforces them: who may write and see them, validation, closed days, and the cash drawer. Run with:  node --test server/test
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../../js/finance.js');
const { computeShift } = require('../../js/shared.js');
const rules = require('../rules');
const { boot, newId } = require('./support.js');

const DAY = 24 * 3600 * 1000;
const noonDaysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(12, 0, 0, 0); return d.getTime(); };
const todayKey = () => F.dayKey(Date.now());

const expense = (over = {}) => ({ id: newId('ex_'), category: 'Rent', description: 'Shop', amount: 100, method: 'other', ...over });
const ownerMove = (over = {}) => ({ id: newId('om_'), type: 'in', amount: 50, method: 'cash', ...over });

// An admin, a manager (Mina), a cashier (Maya), a waiter (Leo) and the kitchen, all signed in.
async function team(t) {
  const admin = await t.login('Admin', '1234');
  const r = await admin.put('users', { id: newId('u_'), name: 'Mina', role: 'manager', pin: '4826', active: true });
  assert.equal(r.status, 'ok', r.error);
  return { admin, mina: await t.login('Mina', '4826'), maya: await t.login('Maya', '1111'), leo: await t.login('Leo', '2222'), cook: await t.login('Kitchen', '3333') };
}

test('expenses: only managers write them, every field is checked, and a record can only be voided', async () => {
  const t = await boot();
  try {
    const { admin, mina, maya, leo } = await team(t);

    // Who may write.
    for (const [who, dev] of [['cashier', maya], ['waiter', leo]]) {
      const r = await dev.put('expenses', expense());
      assert.equal(r.status, 'error', who);
      assert.match(r.error, /permission/);
    }
    const ok = await mina.put('expenses', expense({ description: '  Shop, March  ', hacked: true, by: 'someone', recurringId: 'x', status: 'void', taxAmount: 5 }));
    assert.equal(ok.status, 'ok', ok.error);
    assert.deepEqual([ok.doc.description, ok.doc.status, ok.doc.by, ok.doc.taxAmount, ok.doc.amount], ['Shop, March', 'active', mina.user.id, 5, 100]);
    assert.equal('hacked' in ok.doc, false, 'unknown fields are dropped');
    assert.equal('recurringId' in ok.doc, false, 'only the server marks a repeating expense');
    assert.ok(Math.abs(ok.doc.date - Date.now()) < 5000, 'dated now when no date is sent');
    assert.equal((await admin.put('expenses', expense())).status, 'ok', 'an admin may too');

    // What is checked.
    const bad = {
      'no amount': { amount: 0 }, 'negative amount': { amount: -3 }, 'text amount': { amount: 'lots' }, 'huge amount': { amount: 1e13 },
      'no category': { category: '' }, 'object as category': { category: { a: 1 } }, 'unknown method': { method: 'bitcoin' },
      'tomorrow': { date: Date.now() + 2 * DAY }, 'long ago': { date: Date.now() - 900 * DAY }, 'tax above amount': { amount: 10, taxAmount: 11 }, 'negative tax': { taxAmount: -1 },
    };
    for (const [what, over] of Object.entries(bad)) {
      const r = await mina.put('expenses', expense(over));
      assert.equal(r.status, 'error', what);
    }
    const back = await mina.put('expenses', expense({ date: noonDaysAgo(3) }));
    assert.equal(back.status, 'ok', 'an earlier day is fine');
    assert.equal(back.doc.date, noonDaysAgo(3));

    // No editing, no deleting; voiding by a manager.
    assert.match((await mina.put('expenses', { ...ok.doc, amount: 1 })).error, /cannot be edited/);
    assert.match((await mina.remove('expenses', ok.doc.id)).error, /cannot be deleted/);
    const cashEx = (await mina.put('expenses', expense({ method: 'cash', amount: 3 }))).doc;
    await maya.load();
    const byCashier = await maya.put('expenses', { ...maya.doc('expenses', cashEx.id), status: 'void' });
    assert.equal(byCashier.status, 'error', 'a cashier cannot void one');
    assert.match(byCashier.error, /permission/);
    await mina.load();
    const voided = await mina.put('expenses', { ...mina.doc('expenses', ok.doc.id), status: 'void' });
    assert.equal(voided.status, 'ok', voided.error);
    assert.deepEqual([voided.doc.status, voided.doc.voidedBy], ['void', mina.user.id]);
    assert.match((await mina.put('expenses', { ...voided.doc, status: 'void' })).error, /already void/);
  } finally { await t.stop(); }
});

test('who sees expenses and the owner\'s money moves: managers all of it, the till only the cash, nobody else anything', async () => {
  const t = await boot();
  try {
    const { mina, maya, leo, cook } = await team(t);
    const cashEx = (await mina.put('expenses', expense({ method: 'cash', amount: 7, payee: 'Ice seller', note: 'secret' }))).doc;
    const bankEx = (await mina.put('expenses', expense({ method: 'other', amount: 900 }))).doc;
    const ownerCash = (await mina.put('ownerMoves', ownerMove({ type: 'out', amount: 12, note: 'private' }))).doc;
    const ownerBank = (await mina.put('ownerMoves', ownerMove({ method: 'other', amount: 400 }))).doc;
    const rent = (await mina.put('recurringExpenses', { id: newId('rc_'), category: 'Rent', amount: 500, method: 'other', day: 1 })).doc;

    for (const d of [mina, maya, leo, cook]) await d.load();
    const entered = mina.all('expenses').filter(e => !e.recurringId);   // (the repeating expense makes its own record for this month)
    assert.deepEqual(entered.map(e => e.id).sort(), [cashEx.id, bankEx.id].sort());
    assert.equal(mina.doc('expenses', cashEx.id).payee, 'Ice seller');
    assert.ok(mina.doc('recurringExpenses', rent.id), 'managers see repeating expenses');

    // The cashier counts the drawer, so sees the cash records, and only the figures the drawer needs.
    assert.deepEqual(maya.all('expenses'), [{ id: cashEx.id, date: cashEx.date, amount: 7, method: 'cash', status: 'active' }]);
    assert.deepEqual(maya.all('ownerMoves'), [{ id: ownerCash.id, date: ownerCash.date, amount: 12, method: 'cash', status: 'active', type: 'out' }]);
    assert.deepEqual(maya.all('recurringExpenses'), []);
    for (const d of [leo, cook]) assert.deepEqual([d.all('expenses'), d.all('ownerMoves'), d.all('recurringExpenses'), d.all('dayCloses')], [[], [], [], []]);
    assert.ok(!JSON.stringify(maya.docs).includes('Ice seller') && !JSON.stringify(maya.docs).includes('private') && !ownerBank.id.includes(' '));
  } finally { await t.stop(); }
});

test('the owner\'s money moves: put in or taken out, in cash or not, voided rather than edited', async () => {
  const t = await boot();
  try {
    const { mina, maya } = await team(t);
    assert.equal((await maya.put('ownerMoves', ownerMove())).status, 'error');
    const inn = await mina.put('ownerMoves', ownerMove({ note: 'float' }));
    assert.equal(inn.status, 'ok', inn.error);
    assert.deepEqual([inn.doc.type, inn.doc.method, inn.doc.status, inn.doc.by], ['in', 'cash', 'active', mina.user.id]);
    for (const over of [{ type: 'sideways' }, { amount: 0 }, { method: 'gold' }, { date: Date.now() + 2 * DAY }]) {
      assert.equal((await mina.put('ownerMoves', ownerMove(over))).status, 'error', JSON.stringify(over));
    }
    assert.match((await mina.put('ownerMoves', { ...inn.doc, amount: 1 })).error, /cannot be edited/);
    const v = await mina.put('ownerMoves', { ...inn.doc, status: 'void' });
    assert.equal(v.status, 'ok', v.error);
    assert.equal(v.doc.status, 'void');
  } finally { await t.stop(); }
});

test('the cash drawer also counts cash expenses, cash purchases and the owner\'s cash moves', async () => {
  const t = await boot();
  try {
    const { mina, maya } = await team(t);
    const beans = mina.all('ingredients').find(i => i.name === 'Coffee beans');
    const shiftId = newId('s_');
    assert.equal((await maya.put('shifts', { id: shiftId, openingFloat: 100 })).status, 'ok');

    await mina.put('expenses', expense({ method: 'cash', amount: 7 }));
    await mina.put('expenses', expense({ method: 'other', amount: 50 }));                 // not from the till
    await mina.put('ownerMoves', ownerMove({ type: 'in', amount: 20 }));
    await mina.put('ownerMoves', ownerMove({ type: 'out', amount: 5 }));
    await mina.put('ownerMoves', ownerMove({ type: 'out', amount: 400, method: 'other' }));
    const bought = await mina.put('purchases', { id: newId('pu_'), supplier: 'Market', lines: [{ ingredientId: beans.id, qty: 100, total: 10 }], paid: 10, payMethod: 'cash' });
    assert.equal(bought.status, 'ok', bought.error);
    await mina.put('purchases', { id: newId('pu_'), supplier: 'Market', lines: [{ ingredientId: beans.id, qty: 100, total: 30 }], paid: 30, payMethod: 'other' });

    // The cashier's own device has everything the drawer needs, and works out the same figure as the server will.
    await maya.load();
    const shift = maya.doc('shifts', shiftId);
    const extras = { expenses: maya.all('expenses'), purchases: maya.all('purchases'), ownerMoves: maya.all('ownerMoves') };
    assert.equal(maya.all('purchases').length, 1, 'only the cash purchase reaches the till');
    assert.deepEqual(Object.keys(maya.all('purchases')[0]).sort(), ['date', 'id', 'paid', 'payMethod', 'status']);
    const onDevice = computeShift(shift, maya.all('orders'), 2, maya.all('supplierPayments'), extras);
    assert.equal(onDevice.expected, 100 - 7 + 20 - 5 - 10);

    const closed = await maya.put('shifts', { ...shift, countedCash: 98 });
    assert.equal(closed.status, 'ok', closed.error);
    assert.deepEqual([closed.doc.expectedCash, closed.doc.difference, closed.doc.spent, closed.doc.bought, closed.doc.ownerIn, closed.doc.ownerOut], [98, 0, 7, 10, 20, 5]);
  } finally { await t.stop(); }
});

test('purchases: how the part paid now left the business, and the tax in the price is not part of the cost', async () => {
  const t = await boot();
  try {
    const { admin, mina } = await team(t);
    const flour = (await admin.put('ingredients', { id: newId('i_'), name: 'Flour', unit: 'g', cost: 0, stock: 0, lowStock: 0, active: true })).doc;
    const buy = over => ({ id: newId('pu_'), supplier: 'Mill', lines: [{ ingredientId: flour.id, qty: 100, total: 105 }], ...over });

    const r = await mina.put('purchases', buy({ payMethod: 'card', taxAmount: 5 }));
    assert.equal(r.status, 'ok', r.error);
    assert.deepEqual([r.doc.payMethod, r.doc.taxAmount, r.doc.paid, r.doc.total], ['card', 5, 105, 105]);
    await mina.load();
    assert.equal(mina.doc('ingredients', flour.id).cost, 1, '(105 − 5 tax) ÷ 100 g');
    assert.equal(mina.doc('ingredients', flour.id).stock, 100);

    const plain = await mina.put('purchases', buy({}));
    assert.deepEqual([plain.doc.payMethod, plain.doc.taxAmount], ['other', 0], 'an older device that sends nothing changes nothing about the till');
    assert.equal((await mina.put('purchases', buy({ payMethod: 'gold' }))).doc.payMethod, 'other');
    assert.equal((await mina.put('purchases', buy({ taxAmount: 200 }))).status, 'error', 'tax above the total');
    assert.equal((await mina.put('purchases', buy({ taxAmount: -1 }))).status, 'error');
  } finally { await t.stop(); }
});

test('repeating expenses: made automatically from the first month, never twice, never brought back, never from the till', async () => {
  const t = await boot();
  try {
    const { mina, maya, admin } = await team(t);
    const monthsAgo = n => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - n); return d; };
    const startMonth = F.monthKey(monthsAgo(2).getTime());
    const rent = { id: newId('rc_'), category: 'Rent', description: 'Shop', amount: 500, method: 'other', day: 1, startMonth, payee: 'Landlord' };

    assert.equal((await maya.put('recurringExpenses', rent)).status, 'error', 'a cashier cannot');
    const bad = { 'cash': { method: 'cash' }, 'day 0': { day: 0 }, 'day 29': { day: 29 }, 'amount 0': { amount: 0 }, 'no category': { category: '' }, 'next month': { startMonth: F.monthKey(monthsAgo(-1).getTime()) } };
    for (const [what, over] of Object.entries(bad)) assert.equal((await mina.put('recurringExpenses', { ...rent, id: newId('rc_'), ...over })).status, 'error', what);

    const made = await mina.put('recurringExpenses', rent);
    assert.equal(made.status, 'ok', made.error);
    await mina.load();
    const ids = months => months.map(n => `rx_${rent.id}_${F.monthKey(monthsAgo(n).getTime()).replace('-', '')}`);
    assert.deepEqual(mina.all('expenses').map(e => e.id).sort(), ids([2, 1, 0]).sort(), 'two months ago, last month and this month are all due');
    const one = mina.doc('expenses', ids([0])[0]);
    assert.deepEqual([one.amount, one.method, one.category, one.payee, one.by, one.recurringId, one.status], [500, 'other', 'Rent', 'Landlord', 'system', rent.id, 'active']);

    // Running it again (the hourly job, a restart) adds nothing; a voided one stays voided.
    assert.deepEqual(rules.runRecurringDb(t.app.db), []);
    const v = await mina.put('expenses', { ...one, status: 'void' });
    assert.equal(v.status, 'ok', v.error);
    assert.deepEqual(rules.runRecurringDb(t.app.db), []);
    assert.equal(t.app.db.all('expenses').filter(e => e.recurringId === rent.id).length, 3);

    // Turning it off and removing it.
    await mina.load();
    const off = await mina.put('recurringExpenses', { ...mina.doc('recurringExpenses', rent.id), active: false });
    assert.equal(off.doc.active, false);
    assert.equal(off.doc.startMonth, startMonth, 'the first month cannot be moved by an edit');
    assert.notEqual((await maya.remove('recurringExpenses', rent.id)).status, 'ok', 'a cashier cannot remove it');
    assert.equal((await mina.remove('recurringExpenses', rent.id)).status, 'ok');
    assert.equal(admin.user.role, 'admin');
  } finally { await t.stop(); }
});

test('closing a day freezes it: the server works out the figures, nothing can be added or voided in that day, an admin can reopen it', async () => {
  const t = await boot();
  try {
    const { admin, mina, maya, leo } = await team(t);
    const key = todayKey();
    const earlier = (await mina.put('expenses', expense({ amount: 30 }))).doc;
    const beans = mina.all('ingredients').find(i => i.name === 'Coffee beans');
    const purchase = (await mina.put('purchases', { id: newId('pu_'), supplier: 'Market', lines: [{ ingredientId: beans.id, qty: 10, total: 5 }], paid: 5, payMethod: 'other' })).doc;

    // A shift still open that day blocks it.
    const shiftId = newId('s_');
    await maya.put('shifts', { id: shiftId, openingFloat: 50 });
    assert.match((await mina.put('dayCloses', { id: key })).error, /shift .* still open/);
    await maya.load();
    assert.equal((await maya.put('shifts', { ...maya.doc('shifts', shiftId), countedCash: 50 })).status, 'ok');

    // Who and what.
    assert.equal((await leo.put('dayCloses', { id: key })).status, 'error');
    assert.equal((await maya.put('dayCloses', { id: key })).status, 'error');
    for (const id of ['2999-01-01', 'not-a-day', '2026-13-45', F.dayKey(Date.now() + 2 * DAY)]) assert.equal((await mina.put('dayCloses', { id })).status, 'error', id);

    const closed = await mina.put('dayCloses', { id: key, note: 'quiet day', summary: { revenue: 999999, netProfit: 999999 }, closedBy: 'someone else' });
    assert.equal(closed.status, 'ok', closed.error);
    assert.deepEqual([closed.doc.id, closed.doc.date, closed.doc.closedBy, closed.doc.note], [key, key, mina.user.id, 'quiet day']);
    assert.equal(closed.doc.summary.revenue, 0, 'the figures come from the records, not from the device');
    assert.equal(closed.doc.summary.expenses, 30);
    assert.equal(closed.doc.summary.bought, 5);
    assert.deepEqual(closed.doc.summary.shifts, { count: 1, open: 0, expected: 50, counted: 50, difference: 0 });
    assert.match((await mina.put('dayCloses', { id: key })).error, /already closed/);

    // Everything dated in that day is locked.
    const locked = /already closed/;
    assert.match((await mina.put('expenses', expense())).error, locked);
    assert.match((await mina.put('ownerMoves', ownerMove())).error, locked);
    assert.match((await mina.put('expenses', { ...mina.doc('expenses', earlier.id), status: 'void' })).error, locked);
    assert.match((await mina.put('purchases', { id: newId('pu_'), supplier: 'Market', lines: [{ ingredientId: beans.id, qty: 1, total: 1 }] })).error, locked);
    await mina.load();
    assert.match((await mina.put('purchases', { ...mina.doc('purchases', purchase.id), status: 'void' })).error, locked);
    assert.equal((await mina.put('expenses', expense({ date: noonDaysAgo(1) }))).status, 'ok', 'an earlier day that is still open is fine');

    // Only an admin reopens; the activity log keeps the story.
    assert.equal((await mina.remove('dayCloses', key)).status, 'error');
    await admin.load();
    assert.equal((await admin.remove('dayCloses', key)).status, 'ok');
    assert.equal((await mina.put('expenses', expense())).status, 'ok', 'open again');
    const log = (await t.call('/api/audit?limit=100', { token: admin.token })).data.rows.map(r => r.action);
    for (const a of ['day closed', 'day reopened', 'expense added']) assert.ok(log.includes(a), a);
  } finally { await t.stop(); }
});

test('older records are fetched on request, for managers only; a refund counts on the day it was made', async () => {
  const t = await boot();
  try {
    const { mina, maya, leo } = await team(t);
    const old = (await mina.put('expenses', expense({ date: noonDaysAgo(200) }))).doc;
    await mina.put('expenses', expense());
    const lookup = (dev, from, to) => t.call(`/api/ledger?from=${from}&to=${to}`, { token: dev.token });
    const r = await lookup(mina, noonDaysAgo(201), noonDaysAgo(199));
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.rows.map(x => x.id), [old.id]);
    assert.equal((await lookup(leo, 0, Date.now())).status, 403);
    assert.equal((await lookup(maya, 0, Date.now())).status, 403);

    // The snapshot says how far back the records go.
    const snap = await mina.load();
    assert.ok(Math.abs(snap.ledgerSince - (Date.now() - 90 * DAY)) < 60000);
    assert.equal(mina.doc('expenses', old.id), undefined, 'a 200-day-old expense is not sent at sign-in');

    // A bill sold long ago but refunded today is found by a search of today.
    const bill = { id: 'o_oldsale', number: 1, status: 'refunded', createdAt: noonDaysAgo(40), paidAt: noonDaysAgo(40), refundedAt: Date.now(), items: [], totals: { total: 5 } };
    t.app.db.put('orders', bill.id, bill);
    const found = await t.call(`/api/orders?from=${Date.now() - 3600000}&to=${Date.now() + 1000}`, { token: mina.token });
    assert.ok(found.data.rows.some(x => x.id === bill.id), 'found by the day of the refund');
    const notFound = await t.call(`/api/orders?from=${noonDaysAgo(41)}&to=${noonDaysAgo(39)}`, { token: mina.token });
    assert.ok(notFound.data.rows.some(x => x.id === bill.id), 'and by the day of the sale');
  } finally { await t.stop(); }
});

test('settings: the finance setup (opening balances and expense categories) is cleaned and only an admin sets it', async () => {
  const t = await boot();
  try {
    const { admin, mina } = await team(t);
    await admin.load();
    const s = admin.doc('settings', 'main');
    const start = noonDaysAgo(10);
    const r = await admin.put('settings', { ...s, finance: { openingCash: '1000.555', openingBank: 200, startDate: start, categories: [' Rent ', 'Rent', '', 'Fuel', 7] } }, 'main');
    assert.equal(r.status, 'ok', r.error);
    assert.deepEqual(r.doc.finance, { openingCash: 1000.56, openingBank: 200, startDate: start, categories: ['Rent', 'Fuel', '7'] });
    const f = { openingCash: 0, openingBank: 0, startDate: 0, categories: [] };
    assert.equal((await admin.put('settings', { ...r.doc, finance: { ...f, categories: Array.from({ length: 41 }, (_, i) => 'c' + i) } }, 'main')).status, 'error');
    assert.equal((await admin.put('settings', { ...r.doc, finance: { ...f, startDate: Date.now() + 10 * DAY } }, 'main')).status, 'error');
    assert.equal((await admin.put('settings', { ...r.doc, finance: { ...f, openingCash: 1e13 } }, 'main')).status, 'error');
    const garbage = await admin.put('settings', { ...r.doc, finance: 'lots' }, 'main');
    assert.deepEqual(garbage.doc.finance, f, 'not an object: treated as empty');
    await mina.load();
    assert.equal((await mina.put('settings', { ...mina.doc('settings', 'main'), name: 'Hacked' }, 'main')).status, 'error', 'a manager cannot change settings');
  } finally { await t.stop(); }
});
