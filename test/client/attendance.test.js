'use strict';

// Staff hours in the real app: clocking in and out from the menu bar, the manager's time sheet and corrections, hourly pay on the
// Staff form, Myanmar and single-device mode. Needs jsdom:  npm install      Run with:  npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM, startServer, openApp } = require('./harness.js');

const opts = JSDOM ? {} : { skip: 'jsdom is not installed (run "npm install" once)' };

let srv;
const tabs = [];
const open = async o => { const t = await openApp(srv.base, o); tabs.push(t); return t; };
test.before(async () => { if (JSDOM) srv = await startServer(); });
test.after(async () => {
  tabs.forEach(t => { try { t.close(); } catch (e) { /* already closed */ } });
  if (srv) await srv.stop();
});

const db = () => srv.app.db;
const HOUR = 3600000;
const pad = n => String(n).padStart(2, '0');
const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
// The default period is this week, which on a Monday holds nothing from yesterday: look at the last few days instead.
async function lastDays(t) {
  // (From Tuesday on, this week's start is older than the bills a device holds, so the screen first fetches them.)
  await t.until(() => t.$('[data-act=range][data-range=custom]'), { what: 'the period buttons (older bills are fetched first)' });
  t.click('[data-act=range][data-range=custom]');
  await t.until(() => t.$('[data-role=from]'));
  t.type('[data-role=from]', isoDay(new Date(Date.now() - 4 * 24 * HOUR)));
  await t.until(() => t.$('[data-role=to]') && !t.$('.empty:not(.small)'), { what: 'older bills to be fetched' });   // (the bills of an older period are loaded first)
  t.type('[data-role=to]', isoDay(new Date()));
  await t.until(() => /Custom/.test(t.text('.seg .active') || ''));
}
const rows = t => t.$$('.table-wrap').flatMap(w => [...w.querySelectorAll('tbody tr')]).map(r => r.textContent.replace(/\s+/g, ' ').trim());

test('a waiter clocks in and out from the menu bar, on the server\'s time, and cannot see the time sheet', opts, async () => {
  const t = await open();
  await t.signIn('Leo', '2222', '618204');
  assert.equal(t.$('[data-nav=attendance]'), null, 'staff hours are for managers');
  const btn = () => t.$('[data-nav=clock]');
  assert.match(btn().textContent, /Clock in/);
  assert.ok(!btn().classList.contains('on'));

  const before = Date.now();
  t.click(btn());
  await t.until(() => /On shift/.test(btn().textContent), { what: 'the button to show the shift' });
  assert.ok(btn().classList.contains('on'));
  await t.until(() => db().all('attendance').length === 1, { what: 'the shift on the server' });
  const [shift] = db().all('attendance');
  assert.equal(shift.userName, 'Leo');
  assert.equal(shift.out, null);
  assert.ok(shift.in >= before - 1000 && shift.in <= Date.now());
  assert.ok(t.toasts().some(x => /Clocked in at/.test(x)));

  // Clocking out asks first, and shows the hours so far.
  t.click(btn());
  await t.until(() => t.modalTitle() === 'Clock out?');
  assert.match(t.text('.modal-body'), /You started at/);
  assert.match(t.text('.modal-body'), /1 shift and .* this week/);
  t.click('.modal [data-act=__close]');
  assert.equal(db().all('attendance')[0].out, null, 'staying on shift changes nothing');
  t.click(btn());
  await t.until(() => t.modalTitle() === 'Clock out?');
  t.click('.modal [data-act=out]');
  await t.until(() => /Clock in/.test(btn().textContent), { what: 'the button to go back' });
  await t.until(() => db().all('attendance')[0].out, { what: 'the clock-out on the server' });
  assert.ok(db().all('attendance')[0].out >= shift.in);
  assert.ok(t.toasts().some(x => /Clocked out at/.test(x)));
});

test('a manager sees who is in, adds a missed shift, is refused a clash, and corrects a forgotten clock-out', opts, async () => {
  // Maya clocked in yesterday morning and never out; Leo is on shift now (the test above left his shift ended, so start one).
  const maya = db().all('users').find(u => u.name === 'Maya');
  const leo = db().all('users').find(u => u.name === 'Leo');
  db().put('attendance', 'forgot1', { id: 'forgot1', userId: maya.id, userName: 'Maya', in: Date.now() - 30 * HOUR, out: null, by: maya.id });
  db().put('attendance', 'leo_on', { id: 'leo_on', userId: leo.id, userName: 'Leo', in: Date.now() - 2 * HOUR, out: null, by: leo.id });

  const t = await open();
  await t.signIn('Admin', '1234', '582913');
  assert.ok(t.$('[data-nav=attendance]'), 'the menu has Staff hours');
  t.click('[data-nav=attendance]');
  await t.until(() => t.screen() === 'attendance');
  await lastDays(t);
  assert.match(t.text('.alert-box'), /no real clock-out.*Maya/);
  assert.match(t.text('.onshift'), /On shift now: Leo since/);
  assert.match(t.text('.stats'), /Hours worked/);
  const people = rows(t);
  assert.ok(people.some(r => /^Leo .*On shift/.test(r)), 'Leo is on shift');
  assert.ok(people.some(r => /^Maya .*Check/.test(r)), 'Maya\'s forgotten shift is flagged');
  assert.ok(!/^Maya 1 1 /.test(people.find(r => /^Maya/.test(r))) || /0h/.test(people.find(r => /^Maya/.test(r))), 'and counts for nothing yet');

  // Add a shift nobody clocked.
  const day = new Date(Date.now() - 24 * HOUR);
  t.click('[data-act=new]');
  await t.until(() => t.modalTitle() === 'Add a shift');
  const fill = (who, d1, t1, d2, t2, extra = {}) => {
    t.$('.modal [name=userId]').value = who;
    t.type('.modal [name=inDay]', d1); t.type('.modal [name=inTime]', t1);
    t.type('.modal [name=outDay]', d2); t.type('.modal [name=outTime]', t2);
    t.type('.modal [name=breakMinutes]', extra.brk || '');
    t.type('.modal [name=note]', extra.note || '');
  };
  fill('', isoDay(day), '09:00', isoDay(day), '15:00');
  t.click('.modal [data-act=save]');
  await t.until(() => t.toasts().some(x => /Choose the person/.test(x)));
  fill(leo.id, isoDay(day), '15:00', isoDay(day), '09:00');
  t.click('.modal [data-act=save]');
  await t.until(() => t.toasts().some(x => /must end after it starts/.test(x)));
  fill(maya.id, isoDay(day), '09:00', isoDay(day), '16:30');
  t.click('.modal [data-act=save]');
  await t.until(() => t.toasts().some(x => /overlaps another one for Maya.*still running/.test(x)), { what: 'the forgotten shift to be named as the clash' });
  fill(leo.id, isoDay(day), '09:00', isoDay(day), '16:30', { brk: '30', note: 'Covered lunch' });
  t.click('.modal [data-act=save]');
  await t.until(() => !t.get('Modal.isOpen'), { what: 'the form to close' });
  await t.until(() => db().all('attendance').some(e => e.note === 'Covered lunch'), { what: 'the shift on the server' });
  const added = db().all('attendance').find(e => e.note === 'Covered lunch');
  assert.equal(added.userName, 'Leo');
  assert.equal(added.edited, true);
  assert.equal(added.breakMinutes, 30);
  assert.equal(added.out - added.in, 7.5 * HOUR);

  // The same person cannot have two shifts at once.
  t.click('[data-act=new]');
  await t.until(() => t.modalTitle() === 'Add a shift');
  fill(leo.id, isoDay(day), '12:00', isoDay(day), '13:00');
  t.click('.modal [data-act=save]');
  await t.until(() => t.toasts().some(x => /overlaps another one for Leo/.test(x)), { what: 'the clash to be explained' });
  t.click('.modal [data-act=__close]');

  // Correct the forgotten one: she left at 18:00 the day she started.
  const forgot = db().all('attendance').find(e => e.id === 'forgot1');
  const start = new Date(forgot.in);
  await t.until(() => t.$$('[data-act=edit]').length >= 3);
  t.click(`[data-act=edit][data-id=forgot1]`);
  await t.until(() => /Correct Maya/.test(t.modalTitle()));
  assert.equal(t.$('.modal [name=outDay]').value, '', 'a running shift has no end yet');
  t.type('.modal [name=outDay]', isoDay(start));
  t.type('.modal [name=outTime]', `${pad(Math.min(23, start.getHours() + 5))}:00`);
  t.click('.modal [data-act=save]');
  await t.until(() => db().get('attendance', 'forgot1').data.out, { what: 'the correction on the server' });
  assert.equal(db().get('attendance', 'forgot1').data.edited, true);
  await t.until(() => !t.$('.alert-box'), { what: 'the warning to go' });
  assert.ok(db().auditPage(30).some(a => a.action === 'shift changed' && a.target === 'Maya'), 'the correction is in the activity log');

  // Delete the shift typed in above.
  t.click(`[data-act=edit][data-id="${added.id}"]`);
  await t.until(() => /Correct Leo/.test(t.modalTitle()));
  t.click('.modal [data-act=delete]');
  await t.until(() => t.modalTitle() === 'Delete this shift of Leo?');
  t.click('.modal [data-act=ok]');
  await t.until(() => !db().get('attendance', added.id) || db().get('attendance', added.id).deleted, { what: 'the deletion' });
});

test('hourly pay is set on the Staff form and turns hours into wages', opts, async () => {
  const t = await open();
  await t.signIn('Admin', '582913');
  t.click('[data-nav=users]');
  await t.until(() => t.screen() === 'users');
  const leo = db().all('users').find(u => u.name === 'Leo');
  t.click(`[data-act=edit][data-id="${leo.id}"]`);
  await t.until(() => /Edit Leo/.test(t.modalTitle()));
  t.type('.modal [name=hourlyRate]', '-5');
  t.click('.modal [data-act=save]');
  await t.until(() => t.toasts().some(x => /hourly pay as a number/.test(x)), { what: 'a negative pay to be refused' });
  t.type('.modal [name=hourlyRate]', '4');
  t.click('.modal [data-act=save]');
  await t.until(() => db().doc('users', leo.id).hourlyRate === 4, { what: 'the pay on the server' });

  t.click('[data-nav=attendance]');
  await t.until(() => t.screen() === 'attendance');
  await lastDays(t);
  await t.until(() => /Wages/.test(t.text('.stats') || ''), { what: 'wages once a rate is set' });
  const leoRow = rows(t).find(r => /^Leo/.test(r));
  assert.match(leoRow, /\$4\.00/, 'his pay per hour');
  assert.match(t.text('#main'), /No hourly pay is set for Maya/);

  // The pay is not given to the cashier.
  const cashier = await open();
  await cashier.signIn('Maya', '1111', '314159');
  assert.equal(cashier.get(`(Store.user('${leo.id}') || {}).hourlyRate`), undefined);
  assert.equal(cashier.get(`Store.user('${leo.id}').name`), 'Leo');

  // And can be cleared again.
  t.click('[data-nav=users]');
  await t.until(() => t.screen() === 'users');
  t.click(`[data-act=edit][data-id="${leo.id}"]`);
  await t.until(() => /Edit Leo/.test(t.modalTitle()));
  t.type('.modal [name=hourlyRate]', '');
  t.click('.modal [data-act=save]');
  await t.until(() => db().doc('users', leo.id).hourlyRate === undefined, { what: 'the pay to be cleared' });
});

test('tips: collected, paid out, own and shared by hours, and the kitchen can be left out of the pool', opts, async () => {
  const leo = db().all('users').find(u => u.name === 'Leo');
  const maya = db().all('users').find(u => u.name === 'Maya');
  const bill = (id, who, tip, ago) => db().put('orders', id, {
    id, number: 900 + Number(id.slice(-1)), status: 'paid', staffId: who.id, cashierId: maya.id, createdAt: Date.now() - ago - HOUR, paidAt: Date.now() - ago, items: [],
    totals: { subtotal: 20, discount: 0, points: 0, service: 0, tax: 0, total: 20 }, payment: { method: 'cash', amount: 20, tip },
  });
  const kit = db().all('users').find(u => u.name === 'Kitchen');
  db().put('attendance', 'kitshift', { id: 'kitshift', userId: kit.id, userName: 'Kitchen', in: Date.now() - 30 * HOUR, out: Date.now() - 26 * HOUR, by: kit.id });
  bill('tipo1', leo, 3, 2 * HOUR); bill('tipo2', leo, 2, 3 * HOUR); bill('tipo3', maya, 1, 4 * HOUR);
  db().put('expenses', 'tipx1', { id: 'tipx1', date: Date.now() - HOUR, category: 'Tips paid to staff', amount: 2, method: 'cash', status: 'active', note: '', by: maya.id });

  const t = await open();
  await t.signIn('Admin', '582913');
  t.click('[data-nav=attendance]');
  await t.until(() => t.screen() === 'attendance');
  await lastDays(t);
  await t.until(() => t.$$('.section-title').some(h => /^Tips$/.test(h.textContent.trim())), { what: 'the tips section' });
  const stats = () => t.$$('.stats.compact .stat').map(c => c.textContent.replace(/\s+/g, ' ').trim()).join(' | ');
  assert.match(stats(), /Tips collected\s*\$6\.00\s*3 bills/);
  assert.match(stats(), /Paid out to staff\s*\$2\.00/);
  assert.match(stats(), /Still to pay\s*\$4\.00/);
  const table = () => t.$$('.table-wrap').map(w => [...w.querySelectorAll('tbody tr')].map(r => r.textContent.replace(/\s+/g, ' ').trim())).find(rs => rs.some(r => /^Total/.test(r)));
  const leoRow = table().find(r => /^Leo/.test(r));
  assert.match(leoRow, /^Leo 2 \$5\.00 /, 'two bills with tips, $5 in all');
  assert.match(table().find(r => /^Total/.test(r)), /^Total\s*3\s*\$6\.00/);
  const sharesTo = () => table().filter(r => !/^Total/.test(r)).map(r => Number((r.match(/\$([\d.]+)$/) || [])[1] || 0)).reduce((n, v) => n + v, 0);
  assert.ok(Math.abs(sharesTo() - 6) < 0.011, `the shares add up to the pool: ${sharesTo()}`);
  assert.ok(table().some(r => /^Kitchen/.test(r) && /\$[\d.]+$/.test(r)), 'the kitchen shares by default');
  t.click('[data-role=kitchen]');
  await t.until(() => !table().some(r => /^Kitchen/.test(r) && /\$[\d.]+$/.test(r)), { what: 'the kitchen to leave the pool' });
  assert.ok(Math.abs(sharesTo() - 6) < 0.011, 'still adds up');
  assert.match(t.text('#main'), /record the payment in Finance → Expenses/);
});

test('Myanmar: the clock, the screen and the form are translated', opts, async () => {
  const t = await open({ lang: 'my' });
  await t.signIn('Admin', '582913');
  const latin = sel => t.$$(sel).map(e => e.textContent.replace(/\s+/g, ' ').replace(/Leo|Maya|Admin|Covered lunch|CSV|[AP]M|\$[\d.,]+/g, '').trim()).filter(x => /[A-Za-z]/.test(x));
  assert.deepEqual(latin('[data-nav=clock]'), [], 'the clock button');
  const nav = t.$('[data-nav=attendance] span');
  assert.ok(nav && !/[A-Za-z]/.test(nav.textContent), `menu label: ${nav && nav.textContent}`);
  t.click('[data-nav=attendance]');
  await t.until(() => t.screen() === 'attendance');
  await lastDays(t);
  await t.sleep(80);
  assert.deepEqual(latin('.page-head h1, .page-head .btn, .toolbar .seg button, .stats .label, .section-title, .data th, .pill, .empty, .onshift, .check, p.muted.small span, .total-row td:first-child'), []);
  t.click('[data-act=new]');
  await t.until(() => t.get('Modal.isOpen'));
  await t.sleep(80);
  assert.deepEqual(latin('.modal-head h2, .modal label span, .modal .btn, .modal option:not([value=""]), .modal p'), [], 'the form');
  t.click('.modal [data-act=__close]');
  t.click('[data-nav=clock]');
  await t.until(() => t.get('Modal.isOpen') || t.$('[data-nav=clock].on'));
  await t.sleep(80);
  if (t.get('Modal.isOpen')) assert.deepEqual(latin('.modal-head h2, .modal-body p, .modal .btn'), [], 'the clock-out question');
});

test('single-device mode: clock in and out, add a shift and see the hours without a server', opts, async () => {
  const t = await open({ apiDown: true });
  assert.equal(t.get('Store.mode'), 'local');
  await t.signIn('Admin', '1234', '582913');
  const btn = () => t.$('[data-nav=clock]');
  t.click(btn());
  await t.until(() => /On shift/.test(btn().textContent));
  assert.equal(t.get('Store.data.attendance.length'), 1);
  assert.equal(t.get('Store.data.attendance[0].out'), null);
  t.click(btn());
  await t.until(() => t.modalTitle() === 'Clock out?');
  t.click('.modal [data-act=out]');
  await t.until(() => /Clock in/.test(btn().textContent));
  assert.ok(t.get('Store.data.attendance[0].out') >= t.get('Store.data.attendance[0].in'));

  t.click('[data-nav=attendance]');
  await t.until(() => t.screen() === 'attendance');
  await lastDays(t);
  assert.match(t.text('.stats'), /Hours worked/);
  assert.ok(rows(t).some(r => /^Admin/.test(r)));

  // A running shift left from long ago does not stop anyone clocking in again; it is closed and flagged.
  t.get(`Store.data.attendance.push({ id: 'old', userId: Store.data.users.find(u => u.name === 'Admin').id, userName: 'Admin', in: Date.now() - 40 * 3600000, out: null })`);
  t.get('Store.save()');
  assert.equal(t.get("Store.onShift(App.user.id)"), null);
  t.click(btn());
  await t.until(() => /On shift/.test(btn().textContent));
  assert.equal(t.get("Store.data.attendance.find(e => e.id === 'old').autoClosed"), true);
  assert.notEqual(t.get("Store.data.attendance.find(e => e.id === 'old').out"), null);
});
