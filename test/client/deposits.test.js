'use strict';

// Deposits in the real app: taking one on a customer's account, spending it at checkout (alone or in a split), giving it back with
// a manager's approval, and taking one from a booking. Needs jsdom:  npm install      Run with:  npm test
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
const pid = (tab, name) => tab.get(`Store.data.products.find(p => p.name === ${JSON.stringify(name)}).id`);
const customer = name => db().all('customers').find(c => c.name === name);
const money = n => '$' + n.toFixed(2);

const App_render = t => t.get('App.render()');

async function addCustomer(t, name, phone) {
  t.get(`Screens.customers.create({ name: ${JSON.stringify(name)}, phone: ${JSON.stringify(phone)} })`);
  await t.until(() => customer(name), { what: `${name} on the server` });
}

async function deposit(t, name, amount, method = 'cash') {
  t.click('[data-nav=customers]');
  await t.until(() => t.screen() === 'customers');
  const row = () => t.$$('tbody tr').find(r => r.querySelector('b') && r.querySelector('b').textContent === name);
  await t.until(() => row(), { what: `${name} in the list` });
  row().querySelector('[data-act=deposit]').click();
  await t.until(() => t.modalTitle() === `Deposit from ${name}`, { what: 'the deposit form' });
  t.type('.modal [name=amount]', String(amount));
  t.$('.modal [name=method]').value = method;
  t.click('.modal [data-act=save]');
  await t.until(() => (customer(name) || {}).owing < 0, { what: 'the account in credit on the server' });
}

// Opens a table, adds `qty` espressos (2.675 each with the demo tax) and opens the payment dialog with the customer chosen.
async function startPayment(t, name, qty) {
  t.click('[data-nav=tables]');
  await t.until(() => t.screen() === 'tables');
  t.click('[data-act=table][data-id]:not(.busy)');
  await t.until(() => t.screen() === 'order');
  const espresso = pid(t, 'Espresso');
  for (let i = 0; i < qty; i++) t.click(`[data-act=add][data-id="${espresso}"]`);
  t.click('[data-act=pay]');
  await t.until(() => /^Payment/.test(t.modalTitle() || ''));
  t.click('.modal [data-act=pick-customer]');
  await t.until(() => t.modalTitle() === 'Choose customer');
  t.click(`.modal [data-act=choose][data-id="${customer(name).id}"]`);
  await t.until(() => /^Payment/.test(t.modalTitle() || '') && t.$('.modal [data-act=method]'), { what: 'the payment dialog again' });
}

test('a cashier takes a deposit, and the customer is shown in credit', opts, async () => {
  const t = await open();
  await t.signIn('Maya', '1111', '735192');
  await addCustomer(t, 'Daw Hla', '09 700 111');
  await deposit(t, 'Daw Hla', 20);
  const p = db().all('customerPayments')[0];
  assert.equal(p.kind, 'deposit');
  assert.equal(p.amount, 20);
  assert.equal(p.method, 'cash');
  assert.equal(customer('Daw Hla').owing, -20);
  await t.until(() => /In credit\s*\$20\.00/.test(t.text('tbody') || ''), { what: 'In credit in the list' });
  assert.ok(t.$('[data-act=return-deposit]'), 'and a way to give it back');
});

test('the deposit is used first when the bill is put on account, and what is left stays', opts, async () => {
  const t = await open();
  await t.signIn('Maya', '735192');
  await startPayment(t, 'Daw Hla', 2);                              // 5.35
  t.click('.modal [data-act=method][data-method=credit]');
  await t.until(() => t.$('.modal .credit-line'), { what: 'the account line' });
  assert.match(t.text('.modal .credit-line'), /Daw Hla deposit \$20\.00 · available \$20\.00/);
  assert.match(t.text('.modal'), /the deposit is used first/);
  t.click('.modal [data-act=complete]');
  await t.until(() => t.modalTitle() === 'Payment complete ✓', { what: 'the receipt' });
  assert.match(t.text('.modal .receipt'), /On account/);
  await t.until(() => db().all('orders').some(o => o.status === 'paid'), { what: 'the bill on the server' });
  const paid = db().all('orders').find(o => o.status === 'paid');
  assert.equal(paid.payment.method, 'credit');
  assert.equal(paid.totals.total, 5.35);
  assert.equal(customer('Daw Hla').owing, -14.65, '20 less the bill');
  t.click('.modal [data-act=__close]');
});

test('a bigger bill is split: the rest of the deposit on account, the balance in cash', opts, async () => {
  const t = await open();
  await t.signIn('Maya', '735192');
  await startPayment(t, 'Daw Hla', 8);                              // 21.40
  t.click('.modal [data-act=method][data-method=split]');
  await t.until(() => t.$('.modal [data-act=use-deposit]'), { what: 'the use-deposit button' });
  assert.match(t.text('.modal [data-act=use-deposit]'), /Use the deposit \(\$14\.65\)/);
  t.click('.modal [data-act=use-deposit]');
  await t.until(() => t.$('.modal [name=split-credit]').value === '14.65', { what: 'the deposit in the account row' });
  t.click('.modal [data-act=rest][data-m=cash]');
  assert.equal(t.$('.modal [name=split-cash]').value, '6.75', 'the cash row takes the rest');
  t.click('.modal [data-act=complete]');
  await t.until(() => t.modalTitle() === 'Payment complete ✓', { what: 'the receipt' });
  await t.until(() => db().all('orders').filter(o => o.status === 'paid').length === 2, { what: 'the second bill on the server' });
  const split = db().all('orders').find(o => o.payment && o.payment.method === 'split');
  assert.deepEqual(split.payment.parts.map(p => [p.method, p.amount]).sort(), [['cash', 6.75], ['credit', 14.65]]);
  assert.equal(customer('Daw Hla').owing, 0, 'the deposit is all used');
  t.click('.modal [data-act=__close]');

  // With nothing left, On account is no longer offered for this customer.
  await startPayment(t, 'Daw Hla', 1);
  assert.equal(t.$('.modal [data-act=method][data-method=credit]'), null);
});

test('giving a deposit back needs a manager PIN, and the money is recorded as going out', opts, async () => {
  const t = await open();
  await t.signIn('Maya', '735192');
  await addCustomer(t, 'U Aung', '09 800 222');
  await deposit(t, 'U Aung', 30, 'other');
  const row = () => t.$$('tbody tr').find(r => r.querySelector('b') && r.querySelector('b').textContent === 'U Aung');
  row().querySelector('[data-act=return-deposit]').click();
  await t.until(() => t.modalTitle() === 'Manager approval', { what: 'the manager prompt' });
  t.type('.modal .pin-input', '1234');
  t.click('.modal [data-act=ok]');
  await t.until(() => t.modalTitle() === "Give back U Aung's deposit", { what: 'the give-back form' });
  assert.equal(t.$('.modal [name=amount]').value, '30', 'the whole deposit by default');
  t.type('.modal [name=amount]', '12');
  t.$('.modal [name=method]').value = 'other';
  t.click('.modal [data-act=save]');
  await t.until(() => customer('U Aung').owing === -18, { what: 'part of the deposit given back' });
  const refund = db().all('customerPayments').find(p => p.kind === 'depositRefund');
  assert.equal(refund.amount, 12);
  assert.equal(refund.approvedBy, db().all('users').find(u => u.name === 'Admin').id);
  assert.equal(refund.method, 'other');
  const cf = t.get("Finance.cashFlow([Date.now() - 86400000, Date.now() + 86400000], Store.data, Store.settings)");
  assert.equal(cf.customerOut.other, 12);
  assert.equal(cf.customerIn.other, 30);
});

test('a wrong manager PIN gives nothing back', opts, async () => {
  const t = await open();
  await t.signIn('Maya', '735192');
  t.click('[data-nav=customers]');
  await t.until(() => t.screen() === 'customers');
  const row = () => t.$$('tbody tr').find(r => r.querySelector('b') && r.querySelector('b').textContent === 'U Aung');
  row().querySelector('[data-act=return-deposit]').click();
  await t.until(() => t.modalTitle() === 'Manager approval');
  t.type('.modal .pin-input', '9999');
  t.click('.modal [data-act=ok]');
  await t.until(() => t.toasts().some(x => /Wrong PIN/.test(x)), { what: 'the wrong-PIN message' });
  assert.equal(customer('U Aung').owing, -18);
  assert.equal(db().all('customerPayments').filter(p => p.kind === 'depositRefund').length, 1, 'still only the earlier one');
});

test('a booking takes a deposit from its card; the guest becomes a customer, and the card shows it', opts, async () => {
  const t = await open();
  await t.signIn('Maya', '735192');
  t.click('[data-nav=reservations]');
  await t.until(() => t.screen() === 'reservations');
  const booking = t.get(`Store.saveReservation({ name: 'Ma Su Su', phone: '09 555 777', guests: 8, at: ${Date.now() + 3 * 3600000}, duration: 90, tableId: null, note: '' }).id`);
  await t.until(() => db().all('reservations').some(r => r.id === booking), { what: 'the booking on the server' });
  App_render(t);
  await t.until(() => t.$$('.res').some(c => /Ma Su Su/.test(c.textContent)), { what: 'the booking' });
  const card = () => t.$$('.res').find(c => /Ma Su Su/.test(c.textContent));
  card().querySelector('[data-act=deposit]').click();
  await t.until(() => t.modalTitle() === 'Deposit from Ma Su Su', { what: 'the deposit form' });
  assert.match(t.$('.modal [name=note]').value, /^Booking /);
  t.type('.modal [name=amount]', '25');
  t.click('.modal [data-act=save]');
  await t.until(() => (db().all('customerPayments').find(p => p.reservationId === booking) || {}).amount === 25, { what: 'the deposit tied to the booking' });
  assert.equal(customer('Ma Su Su').phone, '09 555 777', 'a customer was added from the booking');
  await t.until(() => /Deposit\s*\$25\.00/.test(card().textContent), { what: 'the deposit on the card' });

  // A second deposit for the same booking finds the same customer and adds up.
  card().querySelector('[data-act=deposit]').click();
  await t.until(() => t.modalTitle() === 'Deposit from Ma Su Su');
  assert.match(t.text('.modal'), /Deposit already held\s*\$25\.00/);
  t.type('.modal [name=amount]', '15');
  t.click('.modal [data-act=save]');
  await t.until(() => customer('Ma Su Su').owing === -40);
  assert.equal(db().all('customers').filter(c => c.name === 'Ma Su Su').length, 1);
  await t.until(() => /Deposit\s*\$40\.00/.test(card().textContent));
});

test('a waiter, who takes no money, has no Deposit button', opts, async () => {
  const t = await open();
  await t.signIn('Leo', '2222', '618204');
  t.click('[data-nav=reservations]');
  await t.until(() => t.screen() === 'reservations');
  await t.until(() => t.$$('.res').length > 0);
  assert.equal(t.$('.res [data-act=deposit]'), null);
});

test('Myanmar: the deposit dialogs are translated', opts, async () => {
  const t = await open({ lang: 'my' });
  await t.signIn('Maya', '735192');
  t.click('[data-nav=customers]');
  await t.until(() => t.screen() === 'customers');
  await t.until(() => t.$('[data-act=deposit]'));
  t.click('[data-act=deposit]');
  await t.until(() => t.get('Modal.isOpen'));
  await t.sleep(80);
  const latin = sel => t.$$(sel).map(e => e.textContent.replace(/\s+/g, ' ').replace(/Daw Hla|U Aung|Ma Su Su/g, '').trim()).filter(x => /[A-Za-z]/.test(x));
  assert.deepEqual(latin('.modal-head h2, .modal label span, .modal p, .modal .btn, .modal option'), []);
  t.key('Escape');
  await t.sleep(30);
  assert.deepEqual(latin('[data-act=deposit], [data-act=return-deposit]'), [], 'and the buttons');
});

test('single-device mode: a deposit is kept on the account, used at checkout, and given back', opts, async () => {
  const t = await open({ apiDown: true });
  assert.equal(t.get('Store.mode'), 'local');
  await t.signIn('Admin', '1234', '582913');
  const id = t.get("Screens.customers.create({ name: 'Local Aye', phone: '' }).id");
  t.get(`Store.addCustomerPayment({ customerId: '${id}', amount: 30, method: 'cash', kind: 'deposit' })`);
  assert.equal(t.get(`Store.customer('${id}').owing`), -30);

  // An ordinary payment is still refused when nothing is owed; a bill is put on account against the deposit.
  assert.throws(() => t.get(`Store.addCustomerPayment({ customerId: '${id}', amount: 5, method: 'cash' })`), /Only -30 is owed|is owed/);
  t.get(`(() => { const o = Store.createOrder({ staffId: App.user.id }); o.customerId = '${id}';
    Store.addItem(o, Store.data.products.find(p => p.name === 'Espresso'), 2);
    Store.payOrder(o, { method: 'credit', amount: Store.totals(o).total }, App.user.id); })()`);
  assert.equal(t.get(`Store.customer('${id}').owing`), -24.65, '30 less a bill of 5.35');

  // A bill bigger than what is left is refused with the reason.
  assert.throws(() => t.get(`(() => { const o = Store.createOrder({ staffId: App.user.id }); o.customerId = '${id}';
    Store.addItem(o, Store.data.products.find(p => p.name === 'Espresso'), 20);
    Store.payOrder(o, { method: 'credit', amount: Store.totals(o).total }, App.user.id); })()`), /left of Local Aye's deposit/);

  t.get(`Store.addCustomerPayment({ customerId: '${id}', amount: 24.65, method: 'cash', kind: 'depositRefund', approvedBy: App.user.id })`);
  assert.equal(t.get(`Store.customer('${id}').owing`), 0);
  assert.equal(t.get("Store.data.customerPayments.map(p => p.kind || 'payment').join()"), 'deposit,depositRefund');
});
