'use strict';

// Table reservations: the clash rules (shared by the browser and the server) and the server's checks.
// Run with:  node --test server/test
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, newId } = require('./support.js');
const { stayOf, reservationEnd, reservationConflict, reservationsOnDay, nextReservation, DEFAULT_STAY } = require('../../js/shared.js');

const MIN = 60000;
const base = new Date(2026, 9, 12, 12, 0).getTime();        // Monday 12 Oct 2026, 12:00
const at = (h, m = 0) => new Date(2026, 9, 12, h, m).getTime();
const res = (id, over = {}) => ({ id, name: id, guests: 2, at: at(19), tableId: 'T1', status: 'booked', ...over });

// ----- the shared rules -----

test('a booking holds its table for 90 minutes unless it says otherwise', () => {
  assert.equal(DEFAULT_STAY, 90);
  assert.equal(stayOf(res('a')), 90);
  assert.equal(stayOf(res('a', { duration: 120 })), 120);
  assert.equal(stayOf(res('a', { duration: 5 })), 90, 'too short to be believed');
  assert.equal(stayOf(res('a', { duration: 'soon' })), 90);
  assert.equal(reservationEnd(res('a', { at: at(19), duration: 60 })), at(20));
});

test('two waiting bookings clash when their times overlap on the same table', () => {
  const list = [res('a', { at: at(19) })];                                    // 19:00–20:30
  const clash = (over) => reservationConflict(list, res('b', over));
  assert.equal(clash({ at: at(19, 30) }).id, 'a', 'starts while a is still there');
  assert.equal(clash({ at: at(18, 0) }).id, 'a', 'starts at 18:00, 90 minutes, so it runs into 19:00');
  assert.equal(clash({ at: at(19) }).id, 'a', 'the same time');
  assert.equal(clash({ at: at(17, 29) }), null, 'ends at 18:59: fits before');
  assert.equal(clash({ at: at(20, 30) }), null, 'starts exactly when a ends: fits after');
  assert.equal(clash({ at: at(20, 29) }).id, 'a');
  assert.equal(clash({ at: at(19), tableId: 'T2' }), null, 'another table');
  assert.equal(clash({ at: at(19), tableId: null }), null, 'no table yet clashes with nothing');
  assert.equal(clash({ at: at(19), status: 'cancelled' }), null, 'only a waiting booking holds a table');
});

test('a booking does not clash with itself, nor with bookings that no longer hold a table', () => {
  const a = res('a');
  assert.equal(reservationConflict([a], a), null, 'editing a booking is not a clash with its old self');
  for (const status of ['seated', 'cancelled', 'noshow']) assert.equal(reservationConflict([res('a', { status })], res('b')), null, status);
  assert.equal(reservationConflict([], res('b')), null);
  assert.equal(reservationConflict(undefined, res('b')), null);
});

test('a day lists its bookings earliest first', () => {
  const list = [res('late', { at: at(21) }), res('early', { at: at(11) }), res('yesterday', { at: at(19) - 24 * 60 * MIN }), res('tomorrow', { at: at(12) + 24 * 60 * MIN }), res('mid', { at: at(13) })];
  assert.deepEqual(reservationsOnDay(list, at(0)).map(r => r.id), ['early', 'mid', 'late']);
  assert.deepEqual(reservationsOnDay(list, at(0) - 24 * 60 * MIN).map(r => r.id), ['yesterday']);
  assert.deepEqual(reservationsOnDay(undefined, at(0)), []);
});

test('a table warns about the next booking due within two hours, and about a guest who is late', () => {
  const list = [res('soon', { at: at(14) }), res('later', { at: at(18) }), res('late', { at: at(11), tableId: 'T2' }), res('done', { at: at(13), status: 'seated' })];
  assert.equal(nextReservation(list, 'T1', at(12))?.id, 'soon', 'due in two hours');
  assert.equal(nextReservation(list, 'T1', at(12, 1))?.id, 'soon', 'a minute closer');
  assert.equal(nextReservation(list, 'T1', at(11, 59)), null, 'two hours and a minute away is just outside the window');
  assert.equal(nextReservation(list, 'T1', at(10, 0)), null, 'more than two hours away: nothing yet');
  assert.equal(nextReservation(list, 'T1', at(15, 40)), null, 'this one ended at 15:30 and the next is at 18:00');
  assert.equal(nextReservation(list, 'T2', at(12, 15))?.id, 'late', 'expected at 11:00, still holds the table until 12:30');
  assert.equal(nextReservation(list, 'T2', at(12, 31)), null);
  assert.equal(nextReservation(list, 'T9', at(12)), null);
  assert.equal(nextReservation(list, 'T1', at(12), 5 * 60 * MIN)?.id, 'soon', 'a longer look-ahead still finds the earliest');
});

// ----- the server -----

async function setup() {
  const t = await boot();
  const waiter = await t.login('Leo', '2222');
  const tables = waiter.all('tables');
  const soon = () => Date.now() + 3 * 3600000;
  const make = (over = {}) => ({ id: newId('r_'), name: 'Mr Aye', phone: '09 123 456', guests: 4, at: soon(), tableId: tables[0].id, note: '', status: 'booked', ...over });
  return { t, waiter, tables, soon, make };
}

test('a waiter takes a booking; the server fills in who and when', async () => {
  const { t, waiter, make } = await setup();
  try {
    const r = await waiter.put('reservations', make({ createdBy: 'someone-else', createdAt: 1, seatedAt: 5 }));
    assert.equal(r.status, 'ok', r.error);
    assert.equal(r.doc.createdBy, waiter.user.id, 'not what the device claimed');
    assert.ok(r.doc.createdAt > 1e12);
    assert.equal(r.doc.seatedAt, undefined);
    assert.equal(r.doc.status, 'booked');
    const rows = t.app.db.auditPage(20).filter(a => a.action === 'reservation made');
    assert.equal(rows.length, 1);
    assert.match(rows[0].detail, /4 guests/);
  } finally { await t.stop(); }
});

test('every field is checked', async () => {
  const { t, waiter, make, soon } = await setup();
  try {
    const bad = {
      'a name': make({ name: '   ' }), 'a phone with letters': make({ phone: 'call me' }), 'no guests': make({ guests: 0 }), 'too many guests': make({ guests: 51 }),
      'part of a guest': make({ guests: 2.5 }), 'no time': make({ at: 'tonight' }), 'long ago': make({ at: Date.now() - 3 * 86400000 }),
      'far ahead': make({ at: Date.now() + 500 * 86400000 }), 'a table that is not there': make({ tableId: 'T_nope' }), 'a stay of 5 minutes': make({ duration: 5 }),
      'a stay of a day': make({ duration: 1440 }), 'a made-up status': make({ status: 'vip' }),
    };
    for (const [what, doc] of Object.entries(bad)) assert.equal((await waiter.put('reservations', doc)).status, 'error', what);
    const ok = await waiter.put('reservations', make({ at: Date.now() - 3600000, guests: 50, duration: 480, tableId: null, phone: '' }));
    assert.equal(ok.status, 'ok', `${ok.error}: an hour ago, 50 guests, 8 hours, no table, no phone is acceptable`);
    assert.ok(soon() > 0);
  } finally { await t.stop(); }
});

test('two bookings cannot hold one table at the same time, and the message says who has it', async () => {
  const { t, waiter, make, soon } = await setup();
  try {
    const first = make({ name: 'Mr Aye', at: soon() });
    assert.equal((await waiter.put('reservations', first)).status, 'ok');
    const clash = await waiter.put('reservations', make({ name: 'Ma Hla', at: soon() + 45 * MIN }));
    assert.equal(clash.status, 'error');
    assert.match(clash.error, /Table 1 is already booked \d\d?:\d\d.*–\d\d?:\d\d.* for Mr Aye/);
    assert.equal((await waiter.put('reservations', make({ name: 'Ma Hla', at: soon() + 90 * MIN }))).status, 'ok', 'right after is fine');
    assert.equal((await waiter.put('reservations', make({ name: 'U Ba', at: soon(), tableId: waiter.all('tables')[1].id }))).status, 'ok', 'another table is fine');

    // Moving a booking onto a taken slot is a clash too.
    const mine = (await waiter.put('reservations', make({ name: 'Third', at: soon() + 400 * MIN }))).doc;
    const moved = await waiter.put('reservations', { ...mine, at: soon() + 10 * MIN });
    assert.equal(moved.status, 'error');
  } finally { await t.stop(); }
});

test('cancelling frees the table; seating does too', async () => {
  const { t, waiter, make, soon } = await setup();
  try {
    const a = (await waiter.put('reservations', make({ name: 'First' }))).doc;
    const wanted = make({ name: 'Second', at: soon() + 30 * MIN });
    assert.equal((await waiter.put('reservations', wanted)).status, 'error');
    assert.equal((await waiter.put('reservations', { ...a, status: 'cancelled' })).status, 'ok');
    assert.equal((await waiter.put('reservations', wanted)).status, 'ok', 'the table is free once the first is cancelled');
    const audit = t.app.db.auditPage(50).filter(x => x.action === 'reservation cancelled');
    assert.equal(audit.length, 1);
    assert.equal(audit[0].target, 'First');
  } finally { await t.stop(); }
});

test('seating a booking records who seated it and the bill, and no-shows are logged', async () => {
  const { t, waiter, make } = await setup();
  try {
    const a = (await waiter.put('reservations', make())).doc;
    const seated = await waiter.put('reservations', { ...a, status: 'seated', orderId: 'o_123', seatedBy: 'u_fake' });
    assert.equal(seated.status, 'ok', seated.error);
    assert.equal(seated.doc.seatedBy, waiter.user.id);
    assert.equal(seated.doc.orderId, 'o_123');
    assert.ok(seated.doc.seatedAt > 1e12);

    const b = (await waiter.put('reservations', make({ name: 'No one', at: Date.now() + 8 * 3600000 }))).doc;
    assert.equal((await waiter.put('reservations', { ...b, status: 'noshow' })).status, 'ok');
    assert.equal(t.app.db.auditPage(50).filter(x => x.action === 'reservation no-show').length, 1);
  } finally { await t.stop(); }
});

test('a booking that was seated, cancelled or a no-show stays so unless a manager changes it', async () => {
  const { t, waiter, make } = await setup();
  try {
    const a = (await waiter.put('reservations', make())).doc;
    const cancelled = (await waiter.put('reservations', { ...a, status: 'cancelled' })).doc;
    const back = await waiter.put('reservations', { ...cancelled, status: 'booked' });
    assert.equal(back.status, 'error');
    assert.match(back.error, /Only a manager/);
    const other = await waiter.put('reservations', { ...cancelled, status: 'seated' });
    assert.equal(other.status, 'error', 'not from one final state to another either');
    // Editing the details of a cancelled booking without changing its status is fine.
    assert.equal((await waiter.put('reservations', { ...cancelled, note: 'sorry' })).status, 'ok');

    const admin = await t.login('Admin', '1234');
    const reopened = await admin.put('reservations', { ...admin.doc('reservations', a.id), status: 'booked' });
    assert.equal(reopened.status, 'ok', reopened.error);
  } finally { await t.stop(); }
});

test('only a manager can delete a booking', async () => {
  const { t, waiter, make } = await setup();
  try {
    const a = (await waiter.put('reservations', make())).doc;
    assert.equal((await waiter.remove('reservations', a.id)).status, 'error');
    const admin = await t.login('Admin', '1234');
    assert.equal((await admin.remove('reservations', a.id)).status, 'ok');
    assert.equal(t.app.db.auditPage(20).filter(x => x.action === 'reservation deleted').length, 1);
  } finally { await t.stop(); }
});

test('the kitchen cannot read or write bookings; floor staff, cashiers and managers can', async () => {
  const { t, waiter, make } = await setup();
  try {
    await waiter.put('reservations', make());
    const kitchen = await t.login('Kitchen', '3333');
    assert.equal(kitchen.all('reservations').length, 0, 'not sent to the kitchen display');
    assert.equal((await kitchen.put('reservations', make({ name: 'Sneaky' }))).status, 'error');
    const cashier = await t.login('Maya', '1111');
    assert.equal(cashier.all('reservations').length, 1);
    assert.equal((await cashier.put('reservations', make({ name: 'By the cashier', tableId: null }))).status, 'ok');
  } finally { await t.stop(); }
});

test('a device signing in is sent coming bookings and recent ones, not old finished ones', async () => {
  const { t, waiter, make } = await setup();
  try {
    const db = t.app.db;
    const put = (id, over) => db.put('reservations', id, { ...make(), id, createdAt: Date.now(), createdBy: 'x', ...over });
    put('r_future', { at: Date.now() + 30 * 86400000 });
    put('r_today_done', { at: Date.now() - 3600000, status: 'seated' });
    put('r_old_done', { at: Date.now() - 10 * 86400000, status: 'seated', tableId: null });
    put('r_old_waiting', { at: Date.now() - 10 * 86400000, status: 'booked', tableId: null });
    await waiter.load();
    const ids = waiter.all('reservations').map(r => r.id).sort();
    assert.deepEqual(ids, ['r_future', 'r_old_waiting', 'r_today_done'], 'an old finished booking is not sent; one still waiting is, so it can be closed');
  } finally { await t.stop(); }
});

test('guests never see bookings', async () => {
  const { t, waiter, tables, make } = await setup();
  try {
    await waiter.put('reservations', make());
    const state = await t.call('/api/guest/state?table=' + tables[0].guestCode);
    assert.ok(!('reservations' in state.data) && !JSON.stringify(state.data).includes('Mr Aye'));
  } finally { await t.stop(); }
});

test('a backup carries the bookings and a restored one starts without them when it has none', async () => {
  const { t, waiter, make } = await setup();
  try {
    await waiter.put('reservations', make());
    const exported = t.app.db.exportDataset();
    assert.equal(exported.reservations.length, 1);
    const { normalizeDataset, isValidDataset } = require('../../js/shared.js');
    const old = { ...exported }; delete old.reservations;
    assert.equal(isValidDataset(old), true, 'a backup from before reservations is still valid');
    assert.deepEqual(normalizeDataset(old).reservations, []);
  } finally { await t.stop(); }
});
