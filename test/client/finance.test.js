'use strict';

// The Finance screen, clicked through in jsdom: expenses, the statements, the daily close and its lock, CSV and printing,
// Myanmar, and single-device mode. Run with:  npm test
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
const startOfToday = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
const todayAt = minute => startOfToday + minute * 60000;   // minutes after midnight, so a test is the same at any time of day
const user = name => db().all('users').find(u => u.name === name);
const product = name => db().all('products').find(p => p.name === name);
const fmt = n => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// A finished bill, written straight into the database (the screen only reads it).
function bill({ number, lines, method = 'cash', tip = 0, at, discount = 0, discountBy = null }) {
  const items = lines.map(([name, qty]) => { const p = product(name); return { id: `l${number}${name}`, productId: p.id, name, price: p.price, qty, sentQty: qty }; });
  const subtotal = Math.round(items.reduce((n, l) => n + l.price * l.qty, 0) * 100) / 100;
  const total = Math.round((subtotal - discount) * 100) / 100;
  const o = {
    id: 'o_fin' + number, number, tableId: null, tableName: '', staffId: user('Leo').id, cashierId: user('Maya').id, status: 'paid', note: '', createdAt: at - 10000, paidAt: at, items,
    discount: discount ? { type: 'amount', value: discount, by: discountBy } : null,
    totals: { subtotal, discount, points: 0, service: 0, serviceRate: 0, tax: 0, taxRate: 0, total },
    payment: { method, amount: total, tip, tendered: total + tip },
  };
  db().put('orders', o.id, o);
  return o;
}

// The cells of the statement row that starts with this label.
const row = (t, label) => {
  const tr = t.$$('[data-role=statement] tr').find(r => r.cells[0] && r.cells[0].textContent.replace(/\s+/g, ' ').trim().startsWith(label));
  if (!tr) throw new Error(`No statement row "${label}"`);
  return [...tr.cells].map(c => c.textContent.replace(/\s+/g, ' ').trim());
};

async function openFinance(t, tab = 'pl') {
  t.click('[data-nav=finance]');
  await t.until(() => t.screen() === 'finance');
  await t.until(() => t.$('.tabs'), { what: 'the finance tabs (older records may be loading)' });
  await goTab(t, tab);
}
async function goTab(t, tab) {
  t.click(`[data-act=tab][data-tab=${tab}]`);
  await t.until(() => t.$('.tabs') && t.$(`.tabs .active[data-tab=${tab}]`), { what: `the ${tab} tab` });
}
const today = t => t.click('[data-act=range][data-range=today]');

// Captures what would be downloaded.
function captureDownloads(t) {
  const files = [];
  t.w.eval('window.__files = []; downloadFile = (name, content, type) => window.__files.push({ name, content, type })');
  return () => t.get('window.__files');
}

test('the Finance menu is for managers and admins only', opts, async () => {
  const admin = await open();
  await admin.signIn('Admin', '1234', '482915');
  assert.ok(admin.$('[data-nav=finance]'));
  const cashier = await open();
  await cashier.signIn('Maya', '1111', '735192');
  assert.equal(cashier.$('[data-nav=finance]'), null);
  const waiter = await open();
  await waiter.signIn('Leo', '2222', '618204');
  assert.equal(waiter.$('[data-nav=finance]'), null);
});

test('expenses: add one, see it in the list and in the profit and loss, void it', opts, async () => {
  const admin = await open();
  await admin.signIn('Admin', '482915');
  await openFinance(admin, 'expenses');
  today(admin);

  admin.click('[data-act=new-expense]');
  await admin.until(() => admin.modalTitle() === 'Add expense');
  admin.type('.modal [name=category]', 'Utilities');
  admin.type('.modal [name=amount]', '84');
  admin.type('.modal [name=taxAmount]', '4');
  admin.type('.modal [name=method]', 'other');
  admin.type('.modal [name=payee]', 'City power');
  admin.type('.modal [name=description]', 'March electricity');
  admin.click('.modal [data-act=save]');
  await admin.until(() => db().all('expenses').length === 1, { what: 'the expense on the server' });
  const saved = db().all('expenses')[0];
  assert.deepEqual([saved.category, saved.amount, saved.taxAmount, saved.method, saved.payee, saved.status], ['Utilities', 84, 4, 'other', 'City power', 'active']);
  await admin.until(() => /City power/.test(admin.text('[data-role=statement]')), { what: 'the expense in the list' });
  assert.match(admin.text('[data-role=statement]'), /\$84\.00/);

  // A missing amount is refused with a message; nothing is saved.
  admin.click('[data-act=new-expense]');
  await admin.until(() => admin.modalTitle() === 'Add expense');
  admin.click('.modal [data-act=save]');
  assert.ok(admin.toasts().some(m => /Enter the amount/.test(m)));
  admin.click('.modal [data-act=__close]');

  // Profit and loss: the expense without its tax (84 − 4) is under its category.
  await goTab(admin, 'pl');
  today(admin);
  assert.deepEqual(row(admin, 'Utilities').slice(0, 2), ['Utilities', '-$80.00']);
  assert.deepEqual(row(admin, 'Operating expenses').slice(0, 2), ['Operating expenses', '-$80.00']);

  // Voiding asks first, then the record stays in the list but no longer counts.
  await goTab(admin, 'expenses');
  today(admin);
  admin.click('[data-act=void-expense]');
  await admin.until(() => admin.modalTitle() === 'Void this expense?');
  admin.click('.modal [data-act=ok]');
  await admin.until(() => db().all('expenses')[0].status === 'void', { what: 'the void on the server' });
  assert.ok(admin.$('tr.is-void'));
  await goTab(admin, 'pl');
  today(admin);
  assert.equal(row(admin, 'Operating expenses')[1], '$0.00');
});

test('a repeating expense is recorded by the server every month, and the owner\'s money is recorded', opts, async () => {
  const admin = await open();
  await admin.signIn('Admin', '482915');
  await openFinance(admin, 'expenses');

  admin.click('[data-act=new-recurring]');
  await admin.until(() => admin.modalTitle() === 'Repeating expense');
  admin.type('.modal [name=category]', 'Rent');
  admin.type('.modal [name=amount]', '500');
  admin.type('.modal [name=day]', '1');
  admin.click('.modal [data-act=save]');
  await admin.until(() => db().all('recurringExpenses').length === 1, { what: 'the template on the server' });
  await admin.until(() => db().all('expenses').some(e => e.recurringId), { what: 'this month\'s rent' });
  const rent = db().all('expenses').find(e => e.recurringId);
  assert.deepEqual([rent.category, rent.amount, rent.by, rent.method], ['Rent', 500, 'system', 'other']);
  const rows = () => admin.$$('[data-role=statement] .table-wrap')[2].querySelectorAll('tbody tr');
  assert.equal(rows().length, 1, 'listed under repeating expenses');

  // Turn it off with the switch.
  admin.click('[data-act=toggle-recurring]');
  await admin.until(() => db().all('recurringExpenses')[0].active === false, { what: 'switched off' });

  // The owner puts in cash: one record, and it can be voided.
  admin.click('[data-act=new-owner]');
  await admin.until(() => admin.modalTitle() === 'Owner money in / out');
  admin.type('.modal [name=type]', 'in');
  admin.type('.modal [name=amount]', '300');
  admin.type('.modal [name=method]', 'cash');
  admin.type('.modal [name=note]', 'float');
  admin.click('.modal [data-act=save]');
  await admin.until(() => db().all('ownerMoves').length === 1, { what: 'the owner money record' });
  assert.deepEqual([db().all('ownerMoves')[0].type, db().all('ownerMoves')[0].amount], ['in', 300]);
});

test('profit and loss, cash flow and tax from real bills', opts, async () => {
  const latte = product('Latte').price, espresso = product('Espresso').price;
  const A = bill({ number: 901, lines: [['Latte', 2]], at: todayAt(1) });
  const B = bill({ number: 902, lines: [['Espresso', 1]], method: 'card', tip: 1, at: todayAt(2) });
  const gross = Math.round((A.totals.subtotal + B.totals.subtotal) * 100) / 100;
  assert.equal(gross, Math.round((latte * 2 + espresso) * 100) / 100);
  const admin = await open();
  await admin.signIn('Admin', '482915');
  await openFinance(admin, 'pl');
  today(admin);

  assert.equal(row(admin, 'Gross sales')[1], fmt(gross));
  assert.equal(row(admin, 'Net sales')[1], fmt(gross));
  assert.equal(row(admin, 'Revenue')[1], fmt(gross));
  assert.equal(row(admin, 'Gross profit')[1], fmt(gross), 'no recipe costs on these bills');
  // (Expenses of the earlier tests are not in the table of this test only if they are voided/other days; rent is dated today.)
  const spentToday = db().all('expenses').filter(e => e.status !== 'void' && e.date >= startOfToday && e.category !== 'Tips paid to staff').reduce((n, e) => n + e.amount - (e.taxAmount || 0), 0);
  assert.equal(row(admin, 'Net profit')[1], fmt(gross - spentToday));
  assert.match(admin.text('.notes'), /of sales have a recipe/, 'a warning that the cost of goods is understated');

  // The cost of goods can come from purchases instead.
  admin.type('[data-role=cogs]', 'purchases');
  assert.ok(admin.$$('[data-role=statement] tr').some(r => /ingredients bought/.test(r.textContent)));
  admin.type('[data-role=cogs]', 'recipe');
  // Comparing with the period before can be switched off.
  assert.equal(admin.$$('[data-role=statement] thead th').length, 4);
  admin.click('[data-role=compare]');
  assert.equal(admin.$$('[data-role=statement] thead th').length, 2);

  // Cash flow by channel: A in cash, B on the card with its tip.
  await goTab(admin, 'cash');
  today(admin);
  const paid = row(admin, 'Customers paid');
  assert.deepEqual(paid.slice(1), [fmt(A.totals.total), fmt(B.totals.total + 1), '$0.00', fmt(A.totals.total + B.totals.total + 1)]);
  assert.match(admin.text('.notes'), /Tips among the money in\s*\$1\.00/);

  // Tax: nothing was charged on these bills, so there is nothing to pay.
  await goTab(admin, 'tax');
  today(admin);
  assert.equal(row(admin, 'Tax collected')[2], '$0.00');
  assert.deepEqual(row(admin, 'Tax to pay').slice(2), ['$0.00']);
});

test('financial position: set the opening balances in Settings, and the movements are added', opts, async () => {
  const admin = await open();
  await admin.signIn('Admin', '482915');
  admin.click('[data-nav=settings]');
  await admin.until(() => admin.screen() === 'settings');
  const yesterday = new Date(Date.now() - 86400000);
  const iso = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  admin.type('[data-role=finance] [name=startDate]', iso);
  admin.type('[data-role=finance] [name=openingCash]', '1000');
  admin.type('[data-role=finance] [name=openingBank]', '2000');
  admin.type('[data-role=finance] [name=categories]', 'Rent\nFuel\nRent');
  admin.click('[data-act=save-finance]');
  await admin.until(() => (db().doc('settings', 'main').finance || {}).openingCash === 1000, { what: 'the setup on the server' });
  assert.deepEqual(db().doc('settings', 'main').finance.categories, ['Rent', 'Fuel']);

  await openFinance(admin, 'position');
  const cf = require('../../js/finance.js').cashFlow([startOfToday - 86400000, Date.now() + 86400000], { orders: db().all('orders'), purchases: db().all('purchases'), supplierPayments: db().all('supplierPayments'), expenses: db().all('expenses'), ownerMoves: db().all('ownerMoves') }, db().doc('settings', 'main'));
  assert.equal(row(admin, 'Cash on hand')[1], fmt(1000 + cf.net.cash));
  assert.equal(row(admin, 'Bank and mobile')[1], fmt(2000 + cf.net.card + cf.net.other));
  assert.ok(!/opening balances are not set/.test(admin.text('[data-role=statement]')));
  assert.deepEqual(row(admin, 'Owed to suppliers').slice(1), ['$0.00']);
  // The new category list is what the expense dialog offers.
  await goTab(admin, 'expenses');
  admin.click('[data-act=new-expense]');
  await admin.until(() => admin.modalTitle() === 'Add expense');
  assert.deepEqual([...admin.$('.modal [name=category]').options].map(o => o.value), ['Rent', 'Fuel']);
  admin.click('.modal [data-act=__close]');
});

test('the daily close: figures from the day, frozen when closed, and everything dated in it is locked until an admin reopens it', opts, async () => {
  const admin = await open();
  await admin.signIn('Admin', '482915');
  await openFinance(admin, 'close');
  assert.match(admin.text('[data-role=statement]'), /Bills paid\s*\d/);
  admin.click('[data-act=close-day]');
  await admin.until(() => /^Close /.test(admin.modalTitle() || ''), { what: 'the confirmation' });
  admin.type('.modal [name=note]', 'good day');
  admin.click('.modal [data-act=confirm]');
  await admin.until(() => db().doc('dayCloses', new Date().toISOString().slice(0, 10)) || db().all('dayCloses').length === 1, { what: 'the close on the server' });
  const close = db().all('dayCloses')[0];
  assert.equal(close.note, 'good day');
  assert.equal(close.summary.orders, 2, 'the two bills of the earlier test');
  await admin.until(() => admin.$('[data-act=view-close]'), { what: 'the closed state' });
  assert.match(admin.text('.toolbar'), /Closed/);

  // The report can be viewed and printed.
  admin.click('[data-act=view-close]');
  await admin.until(() => admin.modalTitle() === 'Daily close');
  assert.match(admin.text('.modal'), /Gross sales/);
  admin.click('.modal [data-act=print]');
  assert.ok(admin.prints.some(p => /Daily close/.test(p)), 'printed');
  admin.click('.modal [data-act=__close]');

  // A new expense dated today is refused, and so is voiding one that is already in the day.
  await goTab(admin, 'expenses');
  today(admin);
  admin.click('[data-act=new-expense]');
  await admin.until(() => admin.modalTitle() === 'Add expense');
  admin.type('.modal [name=amount]', '5');
  admin.click('.modal [data-act=save]');
  assert.ok(admin.toasts().some(m => /already closed/.test(m)), admin.toasts().join('|'));
  admin.click('.modal [data-act=__close]');

  // An admin reopens the day; then it works again.
  await goTab(admin, 'close');
  admin.click('[data-act=reopen]');
  await admin.until(() => admin.modalTitle() === 'Reopen this day?');
  admin.click('.modal [data-act=ok]');
  await admin.until(() => db().all('dayCloses').length === 0, { what: 'the day reopened on the server' });
  await admin.until(() => admin.$('[data-act=close-day]'), { what: 'the open state' });
});

test('controls: who gave discounts, refunds and voids, with the big ones listed', opts, async () => {
  bill({ number: 910, lines: [['Latte', 2]], at: todayAt(20), discount: 3, discountBy: user('Maya').id });
  const admin = await open();
  await admin.signIn('Admin', '482915');
  await openFinance(admin, 'controls');
  today(admin);
  assert.match(admin.text('.stats'), /Discounts given\s*\$3\.00/);
  assert.match(admin.text('[data-role=statement]'), /Maya/);
  assert.match(admin.text('[data-role=statement]'), /Big discounts/, 'a discount of 3 on a bill of about 8 is over 20%');
  // The bill number opens the order history's details.
  admin.click('[data-act=order]');
  await admin.until(() => admin.screen() === 'orders' && /^Order #910/.test(admin.modalTitle() || ''), { what: 'the bill\'s details' });
});

test('CSV for the accountant, all statements at once, and printing a statement', opts, async () => {
  const admin = await open();
  await admin.signIn('Admin', '482915');
  await openFinance(admin, 'pl');
  today(admin);
  const files = captureDownloads(admin);

  admin.click('[data-act=export-csv]');
  assert.equal(files().length, 1);
  assert.match(files()[0].name, /^profit-and-loss_\d{4}-\d\d-\d\d_to_\d{4}-\d\d-\d\d\.csv$/);
  assert.equal(files()[0].type, 'text/csv');
  const lines = files()[0].content.split('\n');
  assert.match(lines[0], /^,/);
  assert.ok(lines.some(l => /^Gross sales,/.test(l)));
  assert.ok(lines.some(l => /^Net profit,/.test(l)));

  admin.click('[data-act=export-pack]');
  await admin.until(() => files().length === 8, { what: 'the seven statement files' });
  const names = files().slice(1).map(f => f.name.replace(/_\d{4}.*$/, ''));
  assert.deepEqual([...names].sort(), ['cash-flow', 'controls', 'expenses', 'profit-and-loss', 'purchases', 'supplier-payments', 'tax']);

  // The CSV helper quotes anything with a comma, a quote or a line break.
  const csv = admin.get(`Screens.finance.csvText([['a,b', 'say "hi"', 3], ['x\\ny']])`);
  assert.equal(csv, '"a,b","say ""hi""",3\n"x\ny"');

  admin.click('[data-act=print]');
  assert.equal(admin.prints.length, 1);
  assert.match(admin.prints[0], /Profit &amp; loss/);
  assert.match(admin.prints[0], /Gross sales/);
  assert.ok(!/<button/.test(admin.prints[0]), 'no buttons on paper');
});

test('Myanmar: every tab and dialog of the Finance screen is translated', opts, async () => {
  const admin = await open();
  await admin.signIn('Admin', '482915');
  admin.w.eval("I18N.set('my')");
  await openFinance(admin, 'pl');
  // Dates keep their English month names, and people's names stay as typed; everything else must be Myanmar.
  const latin = sel => admin.$$(sel)
    .map(e => e.textContent.replace(/\s+/g, ' ').replace(/[A-Z][a-z]{2} \d{1,2}, \d{4}(, \d{1,2}:\d\d [AP]M)?/g, '').trim())
    .filter(x => /[A-Za-z]/.test(x))
    .filter(x => !/^(Admin|Maya|Leo|Rent|Fuel|Utilities|Salaries|\$?[\d.,]+)$/.test(x));
  for (const tab of ['pl', 'cash', 'position', 'tax', 'expenses', 'close', 'controls']) {
    await goTab(admin, tab);
    await admin.sleep(80);
    assert.deepEqual(latin('.page-head h1, .tabs button, .toolbar .seg button, [data-role=statement] th, [data-role=statement] h2, [data-role=statement] .label, [data-role=statement] .notes, [data-role=statement] .alert-box, [data-role=statement] td.empty'), [], tab);
  }
  // Dialogs.
  await goTab(admin, 'expenses');
  for (const act of ['new-expense', 'new-recurring', 'new-owner']) {
    admin.click(`[data-act=${act}]`);
    await admin.sleep(80);
    assert.deepEqual(latin('.modal-head h2, .modal label span, .modal p, .modal .btn'), [], act);
    admin.get('Modal.close(true)');
  }
});

test('single-device mode: expenses, the cash drawer, the lock of a closed day and repeating expenses work without a server', opts, async () => {
  const t = await open({ apiDown: true });
  assert.equal(t.get('Store.mode'), 'local');
  await t.signIn('Admin', '1234', '582913');

  // A shift is open; cash spent during it comes out of the drawer, the owner's cash goes in and out.
  t.click('[data-nav=drawer]');
  await t.until(() => t.screen() === 'drawer');
  t.type('[name=float]', '100');
  t.click('[data-act=start-shift]');
  t.get("Store.addExpense({ category: 'Rent', amount: 7, method: 'cash', description: 'Ice' })");
  t.get("Store.addExpense({ category: 'Rent', amount: 50, method: 'other' })");
  t.get("Store.addOwnerMove({ type: 'in', amount: 40, method: 'cash' })");
  t.get("Store.addOwnerMove({ type: 'out', amount: 5, method: 'cash' })");
  assert.equal(t.get('computeShift(Store.openShift(), Store.data.orders, 2, Store.data.supplierPayments, Store.shiftExtras()).expected'), 100 - 7 + 40 - 5);
  t.click('[data-nav=tables]');
  t.click('[data-nav=drawer]');
  await t.until(() => /Cash paid for expenses/.test(t.text('.drawer-grid') || ''), { what: 'the expense line on the drawer' });

  // Validation is the same as on the server.
  assert.throws(() => t.get("Store.addExpense({ category: 'Rent', amount: -1, method: 'cash' })"), /Enter the amount/);
  assert.throws(() => t.get("Store.addExpense({ category: '', amount: 1, method: 'cash' })"), /category/);
  assert.throws(() => t.get("Store.saveRecurring({ category: 'Rent', amount: 5, method: 'cash', day: 1 })"), /till/);
  assert.throws(() => t.get('Store.addExpense({ category: "Rent", amount: 1, method: "cash", date: Date.now() + 3 * 86400000 })'), /future/);

  // A repeating expense is recorded at once for this month, and only once.
  t.get("Store.saveRecurring({ category: 'Salaries', amount: 900, method: 'other', day: 1 })");
  assert.equal(t.get('Store.data.expenses.filter(e => e.recurringId).length'), 1);
  t.get('Store.runRecurring()');
  assert.equal(t.get('Store.data.expenses.filter(e => e.recurringId).length'), 1);

  // The statements read the same records (Rent: 7 + 50; the salary is dated the 1st, not today).
  await openFinance(t, 'pl');
  today(t);
  assert.equal(row(t, 'Rent')[1], '-$57.00');
  await goTab(t, 'cash');
  today(t);
  assert.equal(row(t, 'Expenses')[1], '-$7.00', 'in cash');

  // The day cannot be closed while the shift is open; after counting the drawer it can, and then it is locked.
  await goTab(t, 'close');
  assert.equal(t.$('[data-act=close-day]').disabled, true);
  assert.throws(() => t.get('Store.closeDay(Finance.dayKey(Date.now()))'), /shift .* still open/);
  t.click('[data-nav=drawer]');
  await t.until(() => t.screen() === 'drawer');
  t.click('[data-act=close-shift]');
  await t.until(() => t.modalTitle() === 'Close shift');
  t.type('.modal [name=counted]', '128');
  t.click('.modal [data-act=confirm]');
  await t.until(() => t.get('Store.openShift()') === null, { what: 'the shift closed' });
  assert.equal(t.get('Store.data.shifts[0].difference'), 0);
  t.get("Store.closeDay(Finance.dayKey(Date.now()), 'done')");
  assert.equal(t.get('Store.data.dayCloses.length'), 1);
  assert.equal(t.get('Store.data.dayCloses[0].summary.shifts.counted'), 128);
  assert.throws(() => t.get("Store.addExpense({ category: 'Rent', amount: 1, method: 'other' })"), /already closed/);
  assert.throws(() => t.get('Store.voidExpense(Store.data.expenses[0])'), /already closed/);
  assert.throws(() => t.get("Store.addPurchase({ supplier: 'X', lines: [{ ingredientId: Store.data.ingredients[0].id, qty: 1, total: 1 }] })"), /already closed/);
  t.get('Store.reopenDay(Finance.dayKey(Date.now()))');
  t.get("Store.addExpense({ category: 'Rent', amount: 1, method: 'other' })");
});
