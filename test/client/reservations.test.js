'use strict';

// Reservations in the real app: taking a booking, the hint on the table, double-booking, seating, cancelling, permissions,
// Myanmar and single-device mode. Needs jsdom:  npm install      Run with:  npm test
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
const pad = n => String(n).padStart(2, '0');
const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const inMinutes = m => new Date(Date.now() + m * 60000);

// Fills in and saves the booking form.
async function book(t, { name, phone = '09 555 1234', guests = 4, when, table = '', note = '', stay = '90' }) {
  t.click('[data-act=new]');
  await t.until(() => t.modalTitle() === 'New reservation', { what: 'the booking form' });
  t.type('.modal [name=name]', name);
  t.type('.modal [name=phone]', phone);
  t.type('.modal [name=guests]', String(guests));
  t.type('.modal [name=day]', isoDay(when));
  t.type('.modal [name=time]', hhmm(when));
  t.type('.modal [name=note]', note);
  t.$('.modal [name=tableId]').value = table;
  t.$('.modal [name=duration]').value = stay;
  t.click('.modal [data-act=save]');
}
const cards = t => t.$$('.res').map(c => c.textContent.replace(/\s+/g, ' ').trim());

test('a waiter takes a booking, sees it on the day and on the table, and the double booking is refused', opts, async () => {
  const t = await open();
  await t.signIn('Leo', '2222', '618204');
  assert.ok(t.$('[data-nav=reservations]'), 'the menu has Reservations');
  t.click('[data-nav=reservations]');
  await t.until(() => t.screen() === 'reservations');
  assert.match(t.text('.empty'), /No bookings on this day/);

  const table1 = db().all('tables').find(x => x.name === 'Table 1');
  const when = inMinutes(30);
  await book(t, { name: 'Ma Hla', guests: 4, when, table: table1.id, note: 'Birthday' });
  await t.until(() => t.$('.res'), { what: 'the booking on the day' });
  const [card] = cards(t);
  assert.match(card, /Ma Hla/);
  assert.match(card, /4 guests/);
  assert.match(card, /Table 1/);
  assert.match(card, /Birthday/);
  assert.match(card, /Waiting/);
  await t.until(() => db().all('reservations').length === 1, { what: 'the booking on the server' });
  const saved = db().all('reservations')[0];
  assert.equal(saved.createdBy, t.get('App.user.id'));
  assert.equal(saved.status, 'booked');
  assert.equal(saved.duration, 90);
  assert.match(t.text('.stats'), /Waiting bookings\s*1/);
  assert.match(t.text('.stats'), /Guests expected\s*4/);

  // The table shows who is coming.
  t.click('[data-nav=tables]');
  await t.until(() => t.screen() === 'tables');
  const tile = t.$$('.table-tile').find(x => /Table 1/.test(x.textContent));
  assert.match(tile.textContent, new RegExp(`${hhmm(when).replace(':', ':')}.*Ma Hla \\(4\\)`));
  assert.ok(tile.classList.contains('booked'));
  const other = t.$$('.table-tile').find(x => /Table 2/.test(x.textContent));
  assert.ok(!other.querySelector('.t-booked'), 'another table has no hint');

  // A second booking for the same table at an overlapping time is refused, with the reason.
  t.click('[data-nav=reservations]');
  await t.until(() => t.screen() === 'reservations');
  await book(t, { name: 'U Ba', when: inMinutes(60), table: table1.id });
  await t.until(() => t.toasts().some(x => /Table 1 is already booked .* for Ma Hla/.test(x)), { what: 'the clash message' });
  assert.equal(t.modalTitle(), 'New reservation', 'the form stays open so it can be corrected');
  assert.equal(t.$$('.res').length, 1);
  assert.equal(db().all('reservations').length, 1);

  // Other mistakes are explained too.
  t.type('.modal [name=name]', '');
  t.click('.modal [data-act=save]');
  await t.until(() => t.toasts().some(x => /Enter the name the table is booked under/.test(x)));
  t.type('.modal [name=name]', 'U Ba');
  t.type('.modal [name=guests]', '0');
  t.click('.modal [data-act=save]');
  await t.until(() => t.toasts().some(x => /Guests must be between 1 and 50/.test(x)));

  // Another table at the same time is fine.
  t.type('.modal [name=guests]', '2');
  t.$('.modal [name=tableId]').value = db().all('tables').find(x => x.name === 'Table 2').id;
  t.click('.modal [data-act=save]');
  await t.until(() => t.$$('.res').length === 2, { what: 'the second booking' });
});

test('seating a booking opens the bill at its table and takes the hint off the table', opts, async () => {
  const t = await open();
  await t.signIn('Maya', '1111', '735192');
  t.click('[data-nav=reservations]');
  await t.until(() => t.screen() === 'reservations');
  await t.until(() => t.$$('.res').length === 2, { what: 'the bookings made on the other device' });
  const ma = t.$$('.res').find(c => /Ma Hla/.test(c.textContent));
  ma.querySelector('[data-act=seat]').click();
  await t.until(() => t.screen() === 'order', { what: 'the order screen' });
  await t.until(() => db().all('orders').some(o => o.status === 'open' && o.tableName === 'Table 1'), { what: 'the bill at Table 1 on the server' });
  const order = db().all('orders').find(o => o.status === 'open' && o.tableName === 'Table 1');
  await t.until(() => db().all('reservations').find(r => r.name === 'Ma Hla').status === 'seated', { what: 'the booking seated on the server' });
  const r = db().all('reservations').find(x => x.name === 'Ma Hla');
  assert.equal(r.orderId, order.id);
  assert.equal(r.seatedBy, t.get('App.user.id'));

  // The waiter takes their first order (an empty bill is dropped when you leave it), then goes back to the tables.
  t.click(`[data-act=add][data-id="${db().all('products').find(p => p.name === 'Espresso').id}"]`);
  await t.until(() => db().doc('orders', order.id).items.length === 1, { what: 'the first item on the server' });
  t.click('[data-nav=tables]');
  await t.until(() => t.screen() === 'tables');
  const tile = t.$$('.table-tile').find(x => /Table 1/.test(x.textContent));
  assert.ok(!tile.querySelector('.t-booked'), 'the guests are here, so the hint is gone');

  // Back on the list the booking says so and offers the bill.
  t.click('[data-nav=reservations]');
  await t.until(() => t.screen() === 'reservations');
  const card = t.$$('.res').find(c => /Ma Hla/.test(c.textContent));
  assert.match(card.textContent, /Arrived/);
  assert.ok(card.querySelector('[data-act=order]'), 'Open bill');
  assert.equal(card.querySelector('[data-act=seat]'), null);
});

test('a table that is already in use cannot be seated over', opts, async () => {
  const t = await open();
  await t.signIn('Leo', '618204');
  t.click('[data-nav=reservations]');
  await t.until(() => t.screen() === 'reservations');
  // Another device puts a bill on Table 2 first.
  const table2 = db().all('tables').find(x => x.name === 'Table 2');
  const other = await open();
  await other.signIn('Maya', '735192');
  other.get(`Store.createOrder({ tableId: '${table2.id}', staffId: App.user.id })`);
  await t.until(() => t.get(`!!Store.openOrderForTable('${table2.id}')`), { what: 'the busy table to reach this device' });
  t.$$('.res').find(c => /U Ba/.test(c.textContent)).querySelector('[data-act=seat]').click();   // (the list was redrawn when the bill arrived, so find the button again)
  await t.until(() => t.toasts().some(x => /Table 2 is already in use/.test(x)), { what: 'the message' });
  assert.equal(db().all('reservations').find(r => r.name === 'U Ba').status, 'booked');
  assert.equal(t.screen(), 'reservations', 'nothing was opened');
});

test('a booking with no table is seated by choosing a free table', opts, async () => {
  const t = await open();
  await t.signIn('Leo', '618204');
  t.click('[data-nav=reservations]');
  await t.until(() => t.screen() === 'reservations');
  await book(t, { name: 'Walk-in Aye', guests: 3, when: inMinutes(5) });
  await t.until(() => t.$$('.res').some(c => /Walk-in Aye/.test(c.textContent)));
  const card = t.$$('.res').find(c => /Walk-in Aye/.test(c.textContent));
  assert.match(card.textContent, /No table yet/);
  card.querySelector('[data-act=seat]').click();
  await t.until(() => /^Seat Walk-in Aye/.test(t.modalTitle() || ''), { what: 'the table choice' });
  assert.match(t.text('.modal p'), /Choose a free table for 3 guests/);
  const tableTile = t.$$('.modal [data-act=pick]').find(b => /Table 5/.test(b.textContent));
  tableTile.click();
  await t.until(() => t.screen() === 'order', { what: 'the bill at the chosen table' });
  await t.until(() => (db().all('reservations').find(x => x.name === 'Walk-in Aye') || {}).status === 'seated', { what: 'the booking seated on the server' });
  const r = db().all('reservations').find(x => x.name === 'Walk-in Aye');
  assert.equal(db().doc('tables', r.tableId).name, 'Table 5');
  assert.equal(r.status, 'seated');
});

test('cancelling and no-shows free the table; only a manager can reopen or delete', opts, async () => {
  const t = await open();
  await t.signIn('Leo', '618204');
  t.click('[data-nav=reservations]');
  await t.until(() => t.screen() === 'reservations');
  await book(t, { name: 'Cancel Me', guests: 2, when: inMinutes(300), table: db().all('tables').find(x => x.name === 'Table 3').id });
  await t.until(() => t.$$('.res').some(c => /Cancel Me/.test(c.textContent)));
  const find = name => t.$$('.res').find(c => new RegExp(name).test(c.textContent));
  find('Cancel Me').querySelector('[data-act=cancel]').click();
  await t.until(() => t.modalTitle() === 'Cancel this booking?');
  t.click('.modal [data-act=ok]');
  await t.until(() => db().all('reservations').find(r => r.name === 'Cancel Me').status === 'cancelled', { what: 'the cancellation on the server' });
  assert.match(find('Cancel Me').textContent, /Cancelled/);
  assert.equal(find('Cancel Me').querySelector('[data-act=reopen]'), null, 'a waiter cannot reopen');
  assert.equal(find('Cancel Me').querySelector('[data-act=delete]'), null, 'nor delete');

  // The freed slot can be booked again.
  await book(t, { name: 'Takes Over', guests: 2, when: inMinutes(300), table: db().all('tables').find(x => x.name === 'Table 3').id });
  await t.until(() => t.$$('.res').some(c => /Takes Over/.test(c.textContent)), { what: 'the new booking in the freed slot' });
  find('Takes Over').querySelector('[data-act=noshow]').click();
  await t.until(() => t.modalTitle() === 'Mark as a no-show?');
  t.click('.modal [data-act=ok]');
  await t.until(() => db().all('reservations').find(r => r.name === 'Takes Over').status === 'noshow');

  const admin = await open();
  await admin.signIn('Admin', '1234', '482915');
  admin.click('[data-nav=reservations]');
  await admin.until(() => admin.screen() === 'reservations');
  await admin.until(() => admin.$$('.res').some(c => /Cancel Me/.test(c.textContent)));
  const adminCard = name => admin.$$('.res').find(c => new RegExp(name).test(c.textContent));
  adminCard('Cancel Me').querySelector('[data-act=reopen]').click();
  await admin.until(() => db().all('reservations').find(r => r.name === 'Cancel Me').status === 'booked', { what: 'the manager reopening it' });
  adminCard('Takes Over').querySelector('[data-act=delete]').click();
  await admin.until(() => /^Delete the booking for Takes Over/.test(admin.modalTitle() || ''));
  admin.click('.modal [data-act=ok]');
  await admin.until(() => !db().all('reservations').some(r => r.name === 'Takes Over'), { what: 'the booking deleted' });
});

test('the day can be changed, and a booking made for another day shows there', opts, async () => {
  const t = await open();
  await t.signIn('Maya', '735192');
  t.click('[data-nav=reservations]');
  await t.until(() => t.screen() === 'reservations');
  const tomorrow = new Date(Date.now() + 86400000); tomorrow.setHours(13, 0, 0, 0);
  await book(t, { name: 'Tomorrow Lunch', guests: 6, when: tomorrow });
  await t.until(() => t.$$('.res').some(c => /Tomorrow Lunch/.test(c.textContent)), { what: 'the booking' });
  assert.equal(t.$('[data-role=day]').value, isoDay(tomorrow), 'the screen moved to the booked day');
  assert.ok(!t.$$('.res').some(c => /Ma Hla/.test(c.textContent)), 'today\'s bookings are not on tomorrow');
  t.click('[data-act=today]');
  assert.equal(t.$('[data-role=day]').value, isoDay(new Date()));
  t.click('[data-act=next]');
  assert.equal(t.$('[data-role=day]').value, isoDay(tomorrow));
  t.click('[data-act=prev]'); t.click('[data-act=prev]');
  assert.equal(t.$('[data-role=day]').value, isoDay(new Date(Date.now() - 86400000)));
});

test('the kitchen screen has no Reservations', opts, async () => {
  const t = await open();
  await t.signIn('Kitchen', '3333', '927153');
  assert.equal(t.$('[data-nav=reservations]'), null);
});

test('Myanmar: the menu, the screen and the form are translated', opts, async () => {
  const t = await open({ lang: 'my' });
  await t.signIn('Leo', '618204');
  const nav = t.$('[data-nav=reservations] span');
  assert.ok(nav && !/[A-Za-z]/.test(nav.textContent), `menu label: ${nav && nav.textContent}`);
  t.click('[data-nav=reservations]');
  await t.until(() => t.screen() === 'reservations');
  await t.sleep(80);
  const latin = sel => t.$$(sel).map(e => e.textContent.replace(/\s+/g, ' ').replace(/Walk-in Aye|Ma Hla|U Ba|Cancel Me|Takes Over|Tomorrow Lunch|Table \d+|Birthday/g, '').trim())
    .filter(x => /[A-Za-z]/.test(x));   // names people typed stay as typed
  assert.deepEqual(latin('.page-head h1, .page-head .btn, .stats .label, .res .pill, .res .btn, .res-name, .empty, .day-nav .btn'), []);
  t.click('[data-act=new]');
  await t.until(() => t.get('Modal.isOpen'));
  await t.sleep(80);
  assert.deepEqual(latin('.modal-head h2, .modal label span, .modal .btn, .modal option'), [], 'the form');
});

test('single-device mode: bookings, clashes and seating work without a server', opts, async () => {
  const t = await open({ apiDown: true });
  assert.equal(t.get('Store.mode'), 'local');
  await t.signIn('Admin', '1234', '582913');
  t.click('[data-nav=reservations]');
  await t.until(() => t.screen() === 'reservations');
  const table1 = t.get("Store.data.tables[0].id");
  await book(t, { name: 'Local Aye', guests: 2, when: inMinutes(30), table: table1 });
  await t.until(() => t.$('.res'));
  await book(t, { name: 'Clash', when: inMinutes(45), table: table1 });
  await t.until(() => t.toasts().some(x => /already booked/.test(x)));
  t.click('.modal [data-act=__close]');
  t.$('.res [data-act=seat]').click();
  await t.until(() => t.screen() === 'order');
  assert.equal(t.get("Store.data.reservations[0].status"), 'seated');
  assert.equal(t.get("Store.data.orders.filter(o => o.status === 'open').length"), 1);
});
