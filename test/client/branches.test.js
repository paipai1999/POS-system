'use strict';

// The Branches tab in the real app: backup files from other shops, side by side. Needs jsdom:  npm install      Run with:  npm test
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
const sale = (id, total, cost, who) => db().put('orders', id, {
  id, number: Number(id.replace(/\D/g, '')) || 1, status: 'paid', staffId: who, cashierId: who, createdAt: Date.now() - 60000, paidAt: Date.now() - 1000, tableId: null, items: [{ id: 'l' + id, productId: 'p', name: 'Set', price: total, qty: 1, cost }],
  totals: { subtotal: total, discount: 0, points: 0, service: 0, tax: 0, total }, payment: { method: 'cash', amount: total },
});

// Another shop's backup: this shop's own export with the name, the currency and the sales changed.
async function backupOf(t, name, { currency, decimals, sales }) {
  const res = await fetch(srv.base + '/api/export', { headers: { Authorization: 'Bearer ' + t.get('Sync.token') } });
  const data = await res.json();
  data.settings = { ...data.settings, name, ...(currency ? { currency, decimals: decimals ?? data.settings.decimals } : {}) };
  data.orders = sales.map(([id, total, cost]) => ({ id, number: 1, status: 'paid', staffId: data.users[0].id, createdAt: Date.now() - 60000, paidAt: Date.now() - 1000, items: [{ id: 'l' + id, productId: 'p', name: 'Set', price: total, qty: 1, cost }], totals: { subtotal: total, discount: 0, points: 0, service: 0, tax: 0, total }, payment: { method: 'cash', amount: total } }));
  return JSON.stringify(data);
}

// Chooses files in the "Add backup files" box, like a person would.
async function pick(t, files) {
  const input = t.$('[data-role=branchfile]');
  Object.defineProperty(input, 'files', { configurable: true, value: files.map(([name, text]) => new t.w.File([text], name, { type: 'application/json' })) });
  input.dispatchEvent(new t.w.Event('change', { bubbles: true }));
}
const rows = t => t.$$('.branch-table tbody tr').map(r => r.textContent.replace(/\s+/g, ' ').trim());

async function openBranches(t) {
  t.click('[data-nav=finance]');
  await t.until(() => t.$('[data-act=tab][data-tab=branches]'), { what: 'the finance tabs (older records are fetched first)' });
  t.click('[data-act=tab][data-tab=branches]');
  await t.until(() => /Add backup files/.test(t.text('#main') || ''), { what: 'the Branches tab' });
}

test('backups of other shops are added, compared with this shop, flagged when stale, and removed', opts, async () => {
  const admin = db().all('users').find(u => u.name === 'Admin');
  sale('b1', 1000, 300, admin.id);                                   // this shop: 1000 sold, 300 cost
  const t = await open();
  await t.signIn('Admin', '1234', '582913');
  await openBranches(t);
  assert.match(t.text('#main'), /Include this shop/);
  await t.until(() => rows(t).length === 1, { what: 'this shop to be listed' });
  assert.match(rows(t)[0], /My Cafe \(this device\).*\$1,000\.00/);
  assert.equal(t.$('.total-row'), null, 'a total is for two or more');

  const north = await backupOf(t, 'North', { sales: [['n1', 3000, 900], ['n2', 1000, 300]] });
  await pick(t, [['north.json', north], ['junk.json', '{"not":"a backup"}']]);
  await t.until(() => rows(t).length === 3, { what: 'North, and the total' });
  assert.ok(t.toasts().some(x => /junk\.json is not a valid POS backup/.test(x)));
  const north_ = rows(t).find(r => /^North/.test(r));
  assert.match(north_, /\$4,000\.00/);
  assert.match(north_, /\b2\b/, 'two orders');
  assert.match(rows(t).find(r => /^All branches/.test(r)), /\$5,000\.00.*100%/);
  assert.match(rows(t).find(r => /^North/.test(r)), /80%/, 'its share of the sales');
  assert.equal(t.$$('.report-grid .bar-row').length, 4, 'two bars for each of two charts');
  assert.ok(rows(t).some(r => /Best margin/.test(r)));

  // The same file twice is named and numbered, and the duplicate warning is shown for a shop named like another.
  await pick(t, [['north-again.json', north]]);
  await t.until(() => rows(t).length === 4, { what: 'a third file' });
  assert.ok(t.$$('.branch-files input').map(i => i.value).includes('North (2)'));
  t.type('.branch-files li:last-child input', 'north');
  await t.until(() => /same name/.test(t.text('.alert-box') || ''), { what: 'the duplicate warning' });

  // Remove the duplicate; a branch can be renamed.
  t.click('.branch-files li:last-child [data-act=branch-remove]');
  await t.until(() => rows(t).length === 3);
  t.type('.branch-files li:first-child input', 'Northside');
  await t.until(() => rows(t).some(r => /^Northside/.test(r)));

  // A shop in another money: nothing is added up.
  const yangon = await backupOf(t, 'Yangon', { currency: 'K', decimals: 0, sales: [['y1', 2000000, 500000]] });
  await pick(t, [['yangon.json', yangon]]);
  await t.until(() => /different currencies/.test(t.text('.alert-box') || ''), { what: 'the currency warning' });
  assert.equal(t.$('.total-row'), null);
  assert.match(rows(t).find(r => /^Yangon/.test(r)), /K2,000,000/);

  // Nothing is sent anywhere or kept: the server has no record of any of this, and leaving the tab keeps the files only in memory.
  assert.equal(db().all('orders').length, 1);
  t.click('[data-act=tab][data-tab=pl]');
  await t.until(() => !t.$('.branch-table'));
  t.click('[data-act=tab][data-tab=branches]');
  await t.until(() => t.$('.branch-table'));
  assert.ok(rows(t).some(r => /^Yangon/.test(r)), 'the files stay while the page is open');
});

test('without this shop, only the files are compared; an old backup warns that it may not cover the period', opts, async () => {
  const t = await open();
  await t.signIn('Admin', '582913');
  await openBranches(t);
  await t.until(() => rows(t).length === 1);
  t.click('[data-role=branchself]');
  await t.until(() => /Add the backup file of each branch/.test(t.text('#main') || ''), { what: 'the empty state' });
  const old = JSON.parse(await backupOf(t, 'Old Branch', { sales: [['o1', 500, 100]] }));
  old.orders[0].paidAt = Date.now() - 5 * 86400000;
  await pick(t, [['old.json', JSON.stringify(old)]]);
  await t.until(() => rows(t).length === 1 && /^Old Branch/.test(rows(t)[0]));
  assert.match(t.text('.alert-box'), /Old Branch: the last sale in this backup is from/);
});

test('Myanmar: the Branches tab is translated', opts, async () => {
  const t = await open({ lang: 'my' });
  await t.signIn('Admin', '582913');
  t.click('[data-nav=finance]');
  await t.until(() => t.$('[data-act=tab][data-tab=branches]'), { what: 'the finance tabs' });
  t.click('[data-act=tab][data-tab=branches]');
  await t.until(() => t.$('[data-role=branchfile]'));
  await t.sleep(80);
  const latin = sel => t.$$(sel).map(e => e.textContent.replace(/\s+/g, ' ').replace(/POS|My Cafe \(this device\)|\(this device\)|North|Yangon|\.json|[A-Z]?[a-z]*\.json|K$|\$[\d.,]+/g, '').trim()).filter(x => /[A-Za-z]/.test(x));
  assert.deepEqual(latin('.tabs button.active, .toolbar .btn, .toolbar .check, [data-role=statement] > p, .empty, .data th, .pill, .alert-box'), []);
  const backup = await backupOf(t, 'North', { sales: [['n1', 3000, 900]] });
  await pick(t, [['north.json', backup]]);
  await t.until(() => t.$$('.branch-table tbody tr').length >= 2);
  await t.sleep(80);
  assert.deepEqual(latin('.branch-table th, .branch-table .pill, .total-row td:first-child, .report-grid h2, [data-role=statement] > p'), []);
});

test('single-device mode: backup files are compared without a server', opts, async () => {
  const t = await open({ apiDown: true });
  assert.equal(t.get('Store.mode'), 'local');
  await t.signIn('Admin', '1234', '582913');
  await openBranches(t);
  const other = JSON.stringify({ ...JSON.parse(t.get('JSON.stringify(Store.data)')), settings: { ...t.get('Store.data.settings'), name: 'Mandalay' }, orders: [] });
  await pick(t, [['mandalay.json', other]]);
  await t.until(() => rows(t).length === 3, { what: 'both shops and the total' });
  assert.ok(rows(t).some(r => /^Mandalay/.test(r) && /\$0\.00/.test(r)));
  assert.ok(t.$('.alert-box'), 'no sales in that backup is said');
});
