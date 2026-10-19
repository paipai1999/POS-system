'use strict';

// Attendance: the shared rules, and the server's checks on clocking in and out and on a manager's corrections.
// Run with:  node --test server/test
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, newId } = require('./support.js');
const { shiftHours, attendanceOverlap, attendanceProblem } = require('../../js/shared.js');

const HOUR = 3600000;
const MIN = 60000;
const NOW = new Date(2026, 9, 12, 18, 0).getTime();
const e = (id, over = {}) => ({ id, userId: 'u1', in: NOW - 8 * HOUR, out: NOW, ...over });

// ----- the shared rules -----

test('paid hours are the length of the shift less the unpaid break; a running shift counts up to now', () => {
  assert.equal(shiftHours(e('a')), 8);
  assert.equal(shiftHours(e('a', { breakMinutes: 30 })), 7.5);
  assert.equal(shiftHours(e('a', { out: null }), NOW), 8, 'still on shift');
  assert.equal(shiftHours(e('a', { out: null, breakMinutes: 60 }), NOW), 7);
  assert.equal(shiftHours(e('a', { in: NOW, out: NOW - HOUR })), 0, 'never negative');
  assert.equal(shiftHours(e('a', { breakMinutes: 'x' })), 8, 'nonsense in the break counts as none');
});

test('a shift overlaps another of the same person only', () => {
  const list = [e('a', { in: NOW - 10 * HOUR, out: NOW - 6 * HOUR })];
  const clash = over => attendanceOverlap(list, e('b', over));
  assert.equal(clash({ in: NOW - 7 * HOUR, out: NOW - 5 * HOUR })?.id, 'a');
  assert.equal(clash({ in: NOW - 6 * HOUR, out: NOW }), null, 'starting the minute the other ended is fine');
  assert.equal(clash({ in: NOW - 12 * HOUR, out: NOW - 10 * HOUR }), null, 'ending when the other began is fine');
  assert.equal(clash({ in: NOW - 12 * HOUR, out: NOW })?.id, 'a', 'around it');
  assert.equal(clash({ userId: 'u2', in: NOW - 9 * HOUR, out: NOW - 7 * HOUR }), null, 'a colleague works at the same time, of course');
  assert.equal(clash({ id: 'a', in: NOW - 9 * HOUR, out: NOW - 7 * HOUR }), null, 'a record does not clash with itself');
  const running = [e('r', { in: NOW - 2 * HOUR, out: null })];
  assert.equal(attendanceOverlap(running, e('x', { in: NOW - 5 * HOUR, out: NOW - HOUR }))?.id, 'r', 'a running shift covers everything after it began');
  assert.equal(attendanceOverlap(running, e('x', { in: NOW - 5 * HOUR, out: NOW - 3 * HOUR })), null);
  assert.equal(attendanceOverlap(undefined, e('x')), null);
});

test('a record is checked: start, end, length, break', () => {
  const bad = (over, re) => assert.match(attendanceProblem(e('a', over), NOW), re);
  assert.equal(attendanceProblem(e('a'), NOW), '');
  assert.equal(attendanceProblem(e('a', { out: null }), NOW), '', 'running');
  bad({ in: undefined }, /Choose when the shift started/);
  bad({ in: NaN }, /Choose when the shift started/);
  bad({ in: NOW + HOUR, out: null }, /cannot start in the future/);
  bad({ out: NOW - 9 * HOUR }, /must end after it starts/);
  bad({ in: NOW - 25 * HOUR, out: NOW }, /at most 24 hours/);
  bad({ in: NOW - HOUR, out: NOW + HOUR }, /cannot end in the future/);
  bad({ breakMinutes: -5 }, /break must be 0 to 600/);
  bad({ breakMinutes: 601 }, /break must be 0 to 600/);
  bad({ breakMinutes: 1.5 }, /break must be 0 to 600/);
  bad({ in: NOW - HOUR, out: NOW, breakMinutes: 60 }, /break cannot be as long as the shift/);
  assert.equal(attendanceProblem(e('a', { in: NOW + 3 * MIN, out: null }), NOW), '', 'a clock a few minutes fast is not the future');
});

// ----- the server -----

async function setup() {
  const t = await boot();
  const admin = await t.login('Admin', '1234');
  const cashier = await t.login('Maya', '1111');
  const waiter = await t.login('Leo', '2222');
  const kitchen = await t.login('Kitchen', '3333');
  const rows = who => t.app.db.all('attendance').filter(a => !who || a.userId === who.user.id);
  // A shift that was missed, entered by a manager: from `startH` hours ago to `endH` hours ago.
  const past = (who, startH, endH, over = {}) => ({ id: newId('at_'), userId: who.user.id, in: Date.now() - startH * HOUR, out: endH === null ? null : Date.now() - endH * HOUR, ...over });
  return { t, admin, cashier, waiter, kitchen, rows, past };
}

test('anyone clocks themselves in and out, on the server\'s clock', async () => {
  const { t, waiter, kitchen, rows } = await setup();
  try {
    const before = Date.now();
    const inn = await waiter.put('attendance', { id: newId('at_'), userId: waiter.user.id, in: 5, out: null, edited: true, breakMinutes: 400, by: 'someone' });
    assert.equal(inn.status, 'ok', inn.error);
    assert.ok(inn.doc.in >= before && inn.doc.in <= Date.now(), 'what time the device claims does not matter');
    assert.equal(inn.doc.out, null);
    assert.equal(inn.doc.userName, 'Leo');
    assert.equal(inn.doc.edited, undefined, 'an ordinary clock-in is not an edit');
    assert.equal(inn.doc.breakMinutes, undefined, 'only a manager enters a break');
    assert.equal(inn.doc.by, waiter.user.id);

    const dup = await waiter.put('attendance', { id: newId('at_'), userId: waiter.user.id });
    assert.equal(dup.status, 'error');
    assert.match(dup.error, /already clocked in/);

    const out = await waiter.put('attendance', { ...inn.doc, out: 1, in: 1 });
    assert.equal(out.status, 'ok', out.error);
    assert.ok(out.doc.out >= before && out.doc.out <= Date.now(), 'the server decides when the shift ended');
    assert.equal(out.doc.in, inn.doc.in, 'and cannot move the start');

    const again = await waiter.put('attendance', { ...out.doc, out: Date.now() });
    assert.equal(again.status, 'error', 'a finished shift is final for the person');
    assert.match(again.error, /Only a manager/);

    // The kitchen has no other screen, yet can clock in all the same.
    const k = await kitchen.put('attendance', { id: newId('at_'), userId: kitchen.user.id });
    assert.equal(k.status, 'ok', k.error);
    assert.equal(rows().length, 2);
    // After the shift ended, the same person can start another one.
    assert.equal((await waiter.put('attendance', { id: newId('at_'), userId: waiter.user.id })).status, 'ok');
  } finally { await t.stop(); }
});

test('nobody clocks in for someone else, adds or changes a record, or deletes one — except a manager', async () => {
  const { t, admin, waiter, cashier, rows, past } = await setup();
  try {
    const forOther = await waiter.put('attendance', past(cashier, 5, 1));
    assert.equal(forOther.status, 'error');
    assert.match(forOther.error, /permission/);
    const backdated = await waiter.put('attendance', { id: newId('at_'), userId: waiter.user.id, in: Date.now() - 5 * HOUR, out: Date.now() - HOUR });
    assert.equal(backdated.status, 'error', 'a finished shift is not a clock-in');
    assert.equal(rows().length, 0);

    const mine = (await admin.put('attendance', past(waiter, 6, 2))).doc;
    await waiter.load();
    const edit = await waiter.put('attendance', { ...waiter.doc('attendance', mine.id), in: mine.in - HOUR });
    assert.equal(edit.status, 'error', 'a person cannot give themselves longer hours');
    const del = await waiter.remove('attendance', mine.id);
    assert.equal(del.status, 'error');
    assert.equal(rows().length, 1);
    assert.notEqual((await cashier.remove('attendance', mine.id)).status, 'ok', 'a colleague cannot even see it, let alone delete it');
    assert.equal(rows().length, 1);
    assert.equal((await admin.remove('attendance', mine.id)).status, 'ok');
    assert.equal(rows().length, 0);
  } finally { await t.stop(); }
});

test('a manager adds a missed shift, corrects a forgotten clock-out and the change is logged', async () => {
  const { t, admin, waiter, rows, past } = await setup();
  try {
    const added = await admin.put('attendance', past(waiter, 30, 22, { breakMinutes: 30, note: 'Covered the weekend', edited: false }));
    assert.equal(added.status, 'ok', added.error);
    assert.equal(added.doc.edited, true, 'a typed-in shift is marked as such');
    assert.equal(added.doc.userName, 'Leo');
    assert.equal(added.doc.breakMinutes, 30);
    assert.equal(added.doc.note, 'Covered the weekend');

    // A forgotten clock-out: Leo clocked in, never out; the manager ends it.
    const open = (await waiter.put('attendance', { id: newId('at_'), userId: waiter.user.id })).doc;
    await admin.load();
    const fixed = await admin.put('attendance', { ...admin.doc('attendance', open.id), in: open.in - 3 * HOUR, out: open.in - 1000 });
    assert.equal(fixed.status, 'ok', fixed.error);
    assert.equal(fixed.doc.editedBy, admin.user.id);
    assert.ok(fixed.doc.editedAt > 1e12);

    const log = t.app.db.auditPage(50);
    assert.equal(log.filter(a => a.action === 'shift added').length, 1);
    const changed = log.find(a => a.action === 'shift changed');
    assert.ok(changed && changed.target === 'Leo');
    assert.match(changed.detail, /→/);
    assert.equal(log.some(a => /clock/.test(a.action)), false, 'ordinary clocking in and out is not noise in the log');

    assert.equal((await admin.remove('attendance', added.doc.id)).status, 'ok');
    assert.equal(t.app.db.auditPage(50).filter(a => a.action === 'shift deleted').length, 1);
    assert.equal(rows().length, 1);
  } finally { await t.stop(); }
});

test('a record that is impossible or clashes with another is refused, with the reason', async () => {
  const { t, admin, waiter, past } = await setup();
  try {
    assert.equal((await admin.put('attendance', past(waiter, 10, 6))).status, 'ok');
    const put = doc => admin.put('attendance', doc);
    const clash = await put(past(waiter, 8, 4));
    assert.equal(clash.status, 'error');
    assert.match(clash.error, /overlaps another one for Leo/);
    assert.equal((await put(past(waiter, 6, 3))).status, 'ok', 'starting when the other ended');

    const refused = {
      'ends before it starts': past(waiter, 20, 21),
      'longer than a day': past(waiter, 60, 30),
      'in the future': { ...past(waiter, 0, null), in: Date.now() + 2 * HOUR },
      'ends in the future': past(waiter, 2, -2),
      'a negative break': past(waiter, 40, 36, { breakMinutes: -1 }),
      'a break as long as the shift': past(waiter, 41, 40, { breakMinutes: 60 }),
      'a break of 11 hours': past(waiter, 50, 40, { breakMinutes: 660 }),
      'no start': { id: newId('at_'), userId: waiter.user.id, in: 'yesterday', out: Date.now() - HOUR },
      'a person who is not there': { ...past(waiter, 20, 16), userId: 'u_nobody' },
    };
    for (const [what, doc] of Object.entries(refused)) assert.equal((await put(doc)).status, 'error', what);

    // Leo is clocked in now: a manager cannot add a second running shift or one that runs into it.
    assert.equal((await waiter.put('attendance', { id: newId('at_'), userId: waiter.user.id })).status, 'ok');
    const into = await put(past(waiter, 1, null));
    assert.equal(into.status, 'error');
    assert.match(into.error, /overlaps another one.*still running/);
    // A long note is cut, not refused.
    const noted = await put(past(waiter, 70, 66, { note: 'x'.repeat(500) }));
    assert.equal(noted.status, 'ok', noted.error);
    assert.equal(noted.doc.note.length, 200);
  } finally { await t.stop(); }
});

test('a person sees only their own time sheet; a manager sees everyone\'s', async () => {
  const { t, admin, waiter, cashier, kitchen, past } = await setup();
  try {
    await admin.put('attendance', past(waiter, 10, 6));
    await admin.put('attendance', past(cashier, 10, 6));
    await waiter.put('attendance', { id: newId('at_'), userId: waiter.user.id });
    for (const dev of [waiter, cashier, kitchen, admin]) await dev.load();
    assert.deepEqual(waiter.all('attendance').map(a => a.userName), ['Leo', 'Leo']);
    assert.deepEqual(cashier.all('attendance').map(a => a.userName), ['Maya']);
    assert.deepEqual(kitchen.all('attendance'), []);
    assert.equal(admin.all('attendance').length, 3);

    // Live updates follow the same rule: Maya is not told when Leo clocks out.
    const seen = [];
    const res = await fetch(t.base + '/api/events', { headers: { Authorization: 'Bearer ' + cashier.token } });
    const reader = res.body.getReader();
    const pump = (async () => { const dec = new TextDecoder(); for (;;) { const { value, done } = await reader.read(); if (done) break; seen.push(dec.decode(value)); } })();
    await new Promise(r => setTimeout(r, 150));
    const open = waiter.all('attendance').find(a => a.out === null);
    await waiter.put('attendance', { ...open, out: Date.now() });
    await new Promise(r => setTimeout(r, 300));
    await reader.cancel().catch(() => {});
    await pump.catch(() => {});
    assert.equal(seen.join('').includes('"attendance"'), false, 'a colleague\'s clock-out is not sent to Maya');
  } finally { await t.stop(); }
});

test('hourly pay is seen by managers and the person themselves, and only an admin sets it', async () => {
  const { t, admin, waiter, cashier } = await setup();
  try {
    const leo = admin.doc('users', waiter.user.id);
    const set = await admin.put('users', { ...leo, hourlyRate: '1500.456' });
    assert.equal(set.status, 'ok', set.error);
    assert.equal(set.doc.hourlyRate, 1500.46, 'to the shop\'s decimals');
    assert.equal(set.doc.pinHash === undefined, true, 'the PIN hash does not leave the server');
    assert.equal(t.app.db.doc('users', waiter.user.id).hourlyRate, 1500.46);

    for (const dev of [waiter, cashier, admin]) await dev.load();
    assert.equal(admin.doc('users', waiter.user.id).hourlyRate, 1500.46, 'the owner sees it');
    assert.equal(waiter.doc('users', waiter.user.id).hourlyRate, 1500.46, 'Leo sees his own');
    assert.equal(cashier.doc('users', waiter.user.id).hourlyRate, undefined, 'Maya does not');
    assert.equal(cashier.doc('users', waiter.user.id).name, 'Leo', 'she still sees who he is');

    // Not in the list of names at the sign-in screen, either.
    const listed = (await t.call('/api/public')).data.users.find(u => u.name === 'Leo');
    assert.equal(listed.hourlyRate, undefined);
    assert.equal(waiter.user.hourlyRate, undefined, 'it was set after Leo signed in');

    // Nobody but an admin writes staff accounts, so nobody can raise their own pay.
    assert.equal((await waiter.put('users', { ...waiter.doc('users', waiter.user.id), hourlyRate: 99999 })).status, 'error');

    // Left out of an edit = kept; empty = cleared; rubbish = refused.
    const { hourlyRate, ...without } = admin.doc('users', waiter.user.id);
    assert.equal((await admin.put('users', { ...without, name: 'Leo K' })).doc.hourlyRate, 1500.46);
    assert.equal((await admin.put('users', { ...admin.doc('users', waiter.user.id), hourlyRate: -5 })).status, 'error');
    assert.equal((await admin.put('users', { ...admin.doc('users', waiter.user.id), hourlyRate: 'lots' })).status, 'error');
    assert.equal((await admin.put('users', { ...admin.doc('users', waiter.user.id), hourlyRate: '' })).doc.hourlyRate, undefined);

    const log = t.app.db.auditPage(50).filter(a => a.action === 'staff edited');
    assert.ok(log.some(a => /hourly pay 0 → 1500.46/.test(a.detail)), 'a change of pay is logged');
  } finally { await t.stop(); }
});

test('a backup and the one-day ledger carry the time sheets', async () => {
  const { t, admin, waiter, past } = await setup();
  try {
    await admin.put('attendance', past(waiter, 10, 6));
    await admin.put('attendance', past(waiter, 24 * 400, 24 * 400 - 8));              // more than a year ago
    await waiter.put('attendance', { id: newId('at_'), userId: waiter.user.id });
    const snap = (await t.call('/api/snapshot', { token: admin.token })).data.rows.filter(r => r.col === 'attendance');
    assert.equal(snap.length, 2, 'recent and running ones are sent to the device; last year\'s stay on the server');
    const from = Date.now() - 24 * 400 * HOUR - HOUR, to = Date.now() - 24 * 400 * HOUR + 12 * HOUR;
    const old = (await t.call(`/api/ledger?from=${from}&to=${to}`, { token: admin.token })).data.rows.filter(r => r.col === 'attendance');
    assert.equal(old.length, 1, 'an old period can be fetched');
    const exported = (await t.call('/api/export', { token: admin.token })).data;
    assert.equal((Buffer.isBuffer(exported) ? JSON.parse(exported.toString()) : exported).attendance.length, 3);
  } finally { await t.stop(); }
});
