'use strict';

// Selling on account, clicked through in jsdom: a manager gives a customer a credit limit, the cashier puts a bill on their
// account (all of it, or one part of a split), the customer pays later, and the receivables list follows. Run with:  npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM, startServer, openApp } = require('./harness.js');

const opts = JSDOM ? {} : { skip: 'jsdom is not installed (run "npm install" once)' };

let srv;
const tabs = [];
const open = async o => { const t = await openApp(srv.base, o); tabs.push(t); return t; };
const pid = (tab, name) => tab.get(`Store.data.products.find(p => p.name === ${JSON.stringify(name)}).id`);
const db = () => srv.app.db;

test.before(async () => { if (JSDOM) srv = await startServer(); });
test.after(async () => {
  tabs.forEach(t => { try { t.close(); } catch (e) { /* already closed */ } });
  if (srv) await srv.stop();
});

// The cashier opens a table, adds some espressos and opens the payment dialog.
async function startPayment(t, qty) {
  t.click('[data-nav=tables]');
  await t.until(() => t.screen() === 'tables');
  t.click('[data-act=table][data-id]:not(.busy)');
  await t.until(() => t.screen() === 'order');
  for (let i = 0; i < qty; i++) t.click(`[data-act=add][data-id="${pid(t, 'Espresso')}"]`);
  t.click('[data-act=pay]');
  await t.until(() => /^Payment/.test(t.modalTitle() || ''));
}
async function chooseCustomer(t, name) {
  t.click('.modal [data-act=pick-customer]');
  await t.until(() => t.modalTitle() === 'Choose customer');
  t.click(t.$$('.modal [data-act=choose]').find(b => b.textContent.includes(name)));
  await t.until(() => /^Payment/.test(t.modalTitle() || ''));
}
const customerDoc = name => db().all('customers').find(c => c.name === name);

test('a manager sets a credit limit in the customer\'s details; a cashier cannot', opts, async () => {
  const admin = await open();
  await admin.signIn('Admin', '1234', '482915');
  admin.click('[data-nav=customers]');
  await admin.until(() => admin.screen() === 'customers');
  admin.click('[data-act=new]');
  await admin.until(() => admin.modalTitle() === 'New customer');
  admin.type('.modal [name=name]', 'Daw Hla');
  admin.type('.modal [name=creditLimit]', '100');
  admin.click('.modal [data-act=save]');
  await admin.until(() => customerDoc('Daw Hla'), { what: 'the customer on the server' });
  assert.deepEqual([customerDoc('Daw Hla').creditLimit, customerDoc('Daw Hla').owing], [100, 0]);
  await admin.until(() => /Limit\s*\$100\.00/.test(admin.text('table.data tbody')), { what: 'the limit in the list' });

  const cashier = await open();
  await cashier.signIn('Maya', '1111', '735192');
  cashier.click('[data-nav=customers]');
  await cashier.until(() => cashier.screen() === 'customers');
  cashier.click(`[data-act=edit][data-id="${customerDoc('Daw Hla').id}"]`);
  await cashier.until(() => cashier.modalTitle() === 'Edit Daw Hla');
  assert.equal(cashier.$('.modal [name=creditLimit]'), null, 'a cashier does not even see the limit field');
});

test('putting a bill on account: the customer owes it, the limit is respected, and a tip cannot go on account', opts, async () => {
  const cashier = await open();
  await cashier.signIn('Maya', '735192');
  await startPayment(cashier, 2);

  // No customer on the bill yet: there is no "On account" button.
  assert.equal(cashier.$('.modal [data-act=method][data-method=credit]'), null);
  await chooseCustomer(cashier, 'Daw Hla');
  assert.ok(cashier.$('.modal [data-act=method][data-method=credit]'));
  cashier.click('.modal [data-act=method][data-method=credit]');
  assert.match(cashier.text('.modal .credit-line'), /Daw Hla owes \$0\.00 · credit limit \$100\.00 · available \$100\.00/);

  // A tip cannot be put on account.
  cashier.type('.modal [name=tip]', '1');
  assert.equal(cashier.$('.modal [data-act=complete]').disabled, true);
  assert.match(cashier.text('[data-role=change]'), /tip cannot be put on account/);
  cashier.type('.modal [name=tip]', '');
  assert.equal(cashier.$('.modal [data-act=complete]').disabled, false);

  cashier.click('.modal [data-act=complete]');
  await cashier.until(() => cashier.modalTitle() === 'Payment complete ✓', { what: 'the receipt' });
  assert.match(cashier.text('.modal .receipt'), /On account/);
  await cashier.until(() => db().all('orders').some(o => o.status === 'paid' && o.payment.method === 'credit'), { what: 'the bill paid on account on the server' });
  const paid = db().all('orders').find(o => o.status === 'paid' && o.payment.method === 'credit');
  assert.equal(customerDoc('Daw Hla').owing, paid.totals.total);
  cashier.click('.modal [data-act=__close]');

  // A bill bigger than what is left: the button is on, but the payment cannot be completed.
  await startPayment(cashier, 40);
  await chooseCustomer(cashier, 'Daw Hla');
  cashier.click('.modal [data-act=method][data-method=credit]');
  assert.equal(cashier.$('.modal [data-act=complete]').disabled, true);
  assert.match(cashier.text('[data-role=change]'), /More than the customer can put on account/);

  // Split: cash for most of it and the rest on account.
  cashier.click('.modal [data-act=method][data-method=split]');
  assert.ok(cashier.$('.modal [name=split-credit]'), 'an on-account line in the split');
  const total = cashier.get('Checkout.billTotal()');
  cashier.type('.modal [name=split-credit]', '10');
  cashier.click('.modal [data-act=rest][data-m=cash]');
  assert.equal(cashier.$('.modal [data-act=complete]').disabled, false);
  cashier.click('.modal [data-act=complete]');
  await cashier.until(() => cashier.modalTitle() === 'Payment complete ✓');
  await cashier.until(() => db().all('orders').some(o => o.status === 'paid' && o.payment.method === 'split'), { what: 'the split bill on the server' });
  const split = db().all('orders').find(o => o.status === 'paid' && o.payment.method === 'split');
  assert.deepEqual(split.payment.parts.map(p => [p.method, p.amount]), [['cash', Math.round((total - 10) * 100) / 100], ['credit', 10]]);
  assert.equal(customerDoc('Daw Hla').owing, Math.round((paid.totals.total + 10) * 100) / 100);
});

test('receiving a payment, the statement, the receivables list and a write-off', opts, async () => {
  const owedBefore = customerDoc('Daw Hla').owing;
  const admin = await open();
  await admin.signIn('Admin', '482915');
  admin.click('[data-nav=customers]');
  await admin.until(() => admin.screen() === 'customers');
  assert.match(admin.text('table.data tbody'), new RegExp('\\$' + owedBefore.toFixed(2).replace('.', '\\.') + '\\s*/ \\$100\\.00'));

  admin.click(`[data-act=receive][data-id="${customerDoc('Daw Hla').id}"]`);
  await admin.until(() => admin.modalTitle() === 'Payment from Daw Hla');
  assert.equal(admin.$('.modal [name=amount]').value, String(owedBefore), 'the whole debt is suggested');
  admin.type('.modal [name=amount]', '5');
  admin.type('.modal [name=method]', 'card');
  admin.click('.modal [data-act=save]');
  await admin.until(() => db().all('customerPayments').length === 1, { what: 'the payment on the server' });
  assert.deepEqual([db().all('customerPayments')[0].amount, db().all('customerPayments')[0].method], [5, 'card']);
  assert.equal(customerDoc('Daw Hla').owing, Math.round((owedBefore - 5) * 100) / 100);

  // Too much is refused.
  admin.click(`[data-act=receive][data-id="${customerDoc('Daw Hla').id}"]`);
  await admin.until(() => admin.modalTitle() === 'Payment from Daw Hla');
  admin.type('.modal [name=amount]', '99999');
  admin.click('.modal [data-act=save]');
  assert.ok(admin.toasts().some(m => /Only .* is owed by Daw Hla/.test(m)), admin.toasts().join('|'));
  admin.click('.modal [data-act=__close]');

  // The statement lists the bills and the payment, with the balance after each.
  admin.click(`[data-act=statement][data-id="${customerDoc('Daw Hla').id}"]`);
  await admin.until(() => admin.modalTitle() === 'Statement · Daw Hla');
  const lines = admin.$$('.modal tbody tr').map(r => r.textContent.replace(/\s+/g, ' ').trim());
  assert.equal(lines.length, 3, lines.join(' | '));
  assert.match(lines[0], /Bill on account/);
  assert.match(lines[2], /Payment by card/);
  assert.match(admin.text('.modal'), /Owes \$/);
  admin.click('.modal [data-act=print]');
  assert.ok(admin.prints.some(p => /Daw Hla/.test(p)));
  admin.click('.modal [data-act=__close]');

  // Finance → Receivables: the customer, the total and how old the debt is.
  admin.click('[data-nav=finance]');
  await admin.until(() => admin.screen() === 'finance');
  await admin.until(() => admin.$('.tabs'), { what: 'the finance tabs' });
  admin.click('[data-act=tab][data-tab=receivables]');
  await admin.until(() => /Owed by customers/.test(admin.text('[data-role=statement]')), { what: 'the receivables' });
  const owed = customerDoc('Daw Hla').owing;
  assert.match(admin.text('[data-role=statement] .stats'), new RegExp('Owed by customers\\s*\\$' + owed.toFixed(2).replace('.', '\\.')));
  assert.match(admin.text('[data-role=statement] tbody'), /Daw Hla/);

  // A manager writes the rest off: it is no longer owed, and it is an expense in the profit and loss.
  admin.click('[data-act=receive]');
  await admin.until(() => admin.modalTitle() === 'Payment from Daw Hla');
  admin.click('.modal [data-act=writeoff]');
  await admin.until(() => /^Write off/.test(admin.modalTitle() || ''), { what: 'the confirmation (a manager PIN may be asked first)' }).catch(() => {});
  if (/Staff PIN|PIN/.test(admin.modalTitle() || '')) {
    admin.type('.modal .pin-input', '482915');
    admin.click('.modal [data-act=ok]');
    await admin.until(() => /^Write off/.test(admin.modalTitle() || ''));
  }
  admin.click('.modal [data-act=ok]');
  await admin.until(() => customerDoc('Daw Hla').owing === 0, { what: 'the write-off' });
  assert.equal(db().all('customerPayments').filter(p => p.method === 'writeoff').length, 1);
  const pl = require('../../js/finance.js').profitAndLoss([0, Date.now() + 86400000], { orders: db().all('orders'), customerPayments: db().all('customerPayments'), expenses: [] }, db().doc('settings', 'main'));
  assert.ok(pl.expenses.some(e => e.category === 'Bad debts written off' && e.amount === owed), 'a bad debt in the profit and loss');
});

test('single-device mode: on account, payments, write-off and refund work from the browser alone', opts, async () => {
  const t = await open({ apiDown: true });
  await t.signIn('Admin', '1234', '582913');
  const ev = code => t.get(code);
  ev("Store.data.customers.push({ id: 'c_local', name: 'Local', phone: '', note: '', active: true, discountPercent: 0, points: 0, creditLimit: 30, owing: 0, spent: 0, visits: 0, lastVisit: null, createdAt: Date.now() })");
  const order = qty => ev(`(() => { const p = Store.data.products.find(x => x.name === 'Espresso'); const o = Store.createOrder({ staffId: App.user.id }); o.customerId = 'c_local'; Store.addItem(o, p, ${qty}); return o.id; })()`);

  const a = order(2);
  ev(`Store.payOrder(Store.order('${a}'), { method: 'credit' }, App.user.id)`);
  const total = ev(`Store.order('${a}').totals.total`);
  assert.equal(ev("Store.customer('c_local').owing"), total);
  const b = order(30);
  assert.throws(() => ev(`Store.payOrder(Store.order('${b}'), { method: 'credit' }, App.user.id)`), /Credit limit: only/);
  assert.throws(() => ev(`Store.payOrder(Store.order('${b}'), { method: 'credit', tip: 1 }, App.user.id)`), /tip/);

  ev("Store.addCustomerPayment({ customerId: 'c_local', amount: 2, method: 'cash' })");
  assert.equal(ev("Store.customer('c_local').owing"), Math.round((total - 2) * 100) / 100);
  assert.throws(() => ev("Store.addCustomerPayment({ customerId: 'c_local', amount: 9999, method: 'cash' })"), /Only .* is owed/);
  ev("Store.voidCustomerPayment(Store.data.customerPayments[0])");
  assert.equal(ev("Store.customer('c_local').owing"), total);

  ev(`Store.refundOrder(Store.order('${a}'), App.user.id)`);
  assert.equal(ev("Store.customer('c_local').owing"), 0, 'a refund takes the debt back');
  assert.equal(ev("Finance.receivables(Store.data, Store.settings).rows.length"), 0);
});

test('Myanmar: the on-account screens and dialogs are translated', opts, async () => {
  const admin = await open();
  await admin.signIn('Admin', '482915');
  admin.w.eval("I18N.set('my')");
  // Dates keep their English month names, and people's and dishes' names stay as typed.
  const latin = sel => admin.$$(sel)
    .map(e => e.textContent.replace(/\s+/g, ' ').replace(/[A-Z][a-z]{2} \d{1,2}, \d{4}(, \d{1,2}:\d\d [AP]M)?/g, '').replace(/\b(Admin|Maya|Leo|Daw Hla|Espresso|Local)\b/g, '').trim())
    .filter(x => /[A-Za-z]/.test(x));
  const id = customerDoc('Daw Hla').id;

  admin.click('[data-nav=customers]');
  await admin.until(() => admin.screen() === 'customers');
  await admin.sleep(80);
  assert.deepEqual(latin('.page-head h1, table.data th, .row-actions .btn'), []);
  admin.click(`[data-act=edit][data-id="${id}"]`);
  await admin.until(() => /Daw Hla/.test(admin.modalTitle() || ''));
  await admin.sleep(80);
  assert.deepEqual(latin('.modal-head h2, .modal label span, .modal p'), []);
  admin.get('Modal.close(true)');

  admin.get(`Screens.customers.receivePayment('${id}')`);
  await admin.sleep(80);
  assert.deepEqual(latin('.modal-head h2, .modal label span, .modal p, .modal .btn, .modal option'), []);
  admin.get('Modal.close(true)');
  admin.click(`[data-act=statement][data-id="${id}"]`);
  await admin.until(() => /Daw Hla/.test(admin.modalTitle() || ''));
  await admin.sleep(80);
  assert.deepEqual(latin('.modal-head h2, .modal th, .modal td, .modal p, .modal .btn'), []);
  admin.get('Modal.close(true)');

  // Checkout with the customer on the bill, on account.
  await startPayment(admin, 1);
  await chooseCustomer(admin, 'Daw Hla');
  admin.click('.modal [data-act=method][data-method=credit]');
  await admin.sleep(80);
  assert.deepEqual(latin('.modal .pay-methods button, .modal .credit-line, .modal .muted, [data-role=change]'), []);
  admin.click('.modal [data-act=method][data-method=split]');
  await admin.sleep(80);
  assert.deepEqual(latin('.modal .split-row span, .modal .muted'), []);
  admin.get('Modal.close(true)');

  // Finance → Receivables (after one more bill so something is owed).
  admin.click('[data-nav=finance]');
  await admin.until(() => admin.screen() === 'finance');
  await admin.until(() => admin.$('.tabs'), { what: 'the finance tabs' });
  admin.click('[data-act=tab][data-tab=receivables]');
  await admin.sleep(150);
  assert.deepEqual(latin('.tabs button, [data-role=statement] th, [data-role=statement] .label, [data-role=statement] .notes, [data-role=statement] td.empty, [data-role=statement] .btn'), []);
});
