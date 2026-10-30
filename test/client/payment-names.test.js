'use strict';

// Payment names for "Other" payments (KBZPay, Wave Pay…): set up in Settings, picked at checkout, shown on the receipt,
// in the order list and in the reports. Needs jsdom:  npm install      Run with:  npm test
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
const names = () => db().doc('settings', 'main').payNames;

// A cashier opens a table, adds two espressos (5.35 with tax) and opens the payment dialog.
async function startPayment(t) {
  t.click('[data-nav=tables]');
  await t.until(() => t.screen() === 'tables');
  t.click('[data-act=table][data-id]:not(.busy)');
  await t.until(() => t.screen() === 'order');
  const espresso = pid(t, 'Espresso');
  t.click(`[data-act=add][data-id="${espresso}"]`);
  t.click(`[data-act=add][data-id="${espresso}"]`);
  t.click('[data-act=pay]');
  await t.until(() => /^Payment/.test(t.modalTitle() || ''));
}

test('Settings: an admin adds payment names with the quick buttons or by typing, and mistakes are explained', opts, async () => {
  const admin = await open();
  await admin.signIn('Admin', '1234', '482915');
  admin.click('[data-nav=settings]');
  await admin.until(() => admin.$('[data-role=paynames]'), { what: 'the payment names card' });
  assert.match(admin.text('[data-role=paynames]'), /No names yet/);
  assert.equal(admin.$$('[data-role=paynames] .suggestions .chip').length, 6, 'six suggestions for Myanmar shops');

  admin.click('[data-role=paynames] [data-act=pay-add][data-name=KBZPay]');
  await admin.until(() => (names() || []).includes('KBZPay'), { what: 'KBZPay on the server' });
  assert.ok(!admin.$('[data-role=paynames] [data-name=KBZPay].chip'), 'an added name leaves the suggestions');
  assert.match(admin.text('[data-role=paynames] ul'), /KBZPay/);

  admin.type('[data-role=new-payname]', 'Wave Pay');
  admin.click('[data-role=paynames] [data-act=pay-add]:not([data-name])');
  await admin.until(() => (names() || []).includes('Wave Pay'), { what: 'Wave Pay on the server' });
  assert.deepEqual(names(), ['KBZPay', 'Wave Pay']);

  admin.type('[data-role=new-payname]', 'cash');
  admin.click('[data-role=paynames] [data-act=pay-add]:not([data-name])');
  await admin.until(() => admin.toasts().some(x => /already a payment method/.test(x)), { what: 'the reserved-name message' });
  admin.type('[data-role=new-payname]', 'kbzpay');
  admin.click('[data-role=paynames] [data-act=pay-add]:not([data-name])');
  await admin.until(() => admin.toasts().some(x => /already in the list/.test(x)), { what: 'the repeat message' });
  assert.deepEqual(names(), ['KBZPay', 'Wave Pay'], 'neither mistake changed anything');
});

test('Checkout: Other offers the names; the chosen one is on the receipt, the order list and the reports', opts, async () => {
  const t = await open();
  await t.signIn('Maya', '1111', '735192');
  await startPayment(t);

  t.click('.modal [data-act=method][data-method=other]');
  await t.until(() => t.$('.modal .pay-via'), { what: 'the payment names' });
  assert.deepEqual(t.$$('.modal .pay-via .chip').map(c => c.textContent), ['Other', 'KBZPay', 'Wave Pay']);
  assert.ok(t.$('.modal .pay-via .chip.active').textContent === 'Other', 'nothing is chosen for the cashier');
  t.click('.modal [data-act=via][data-via=KBZPay]');
  await t.until(() => t.$('.modal .pay-via .chip.active').textContent === 'KBZPay');
  t.click('.modal [data-act=complete]');
  await t.until(() => t.modalTitle() === 'Payment complete ✓', { what: 'the receipt' });
  assert.match(t.text('.modal .receipt'), /KBZPay/);
  assert.ok(!/Other/.test(t.text('.modal .receipt')), 'the receipt says KBZPay, not Other');
  await t.until(() => db().all('orders').some(o => o.payment && o.payment.via === 'KBZPay'), { what: 'the payment on the server' });
  const paid = db().all('orders').find(o => o.payment && o.payment.via === 'KBZPay');
  assert.equal(paid.payment.method, 'other', 'the money still counts as bank / other');
  t.click('.modal [data-act=__close]');
  await t.until(() => t.screen() === 'tables');

  // A plain Other payment (no name chosen) is recorded as before.
  await startPayment(t);
  t.click('.modal [data-act=method][data-method=other]');
  await t.until(() => t.$('.modal .pay-via'));
  t.click('.modal [data-act=complete]');
  await t.until(() => t.modalTitle() === 'Payment complete ✓');
  await t.until(() => db().all('orders').filter(o => o.status === 'paid').length === 2);
  const plain = db().all('orders').filter(o => o.status === 'paid').find(o => o.payment.via === undefined);
  assert.equal(plain.payment.method, 'other');
  t.click('.modal [data-act=__close]');

  // The order list shows the name.
  t.click('[data-nav=orders]');
  await t.until(() => t.screen() === 'orders');
  await t.until(() => /KBZPay/.test(t.text('.main') || ''), { what: 'the name in the order list' });
});

test('Checkout: in a split payment the Other part can carry a name', opts, async () => {
  const t = await open();
  await t.signIn('Maya', '735192');
  await startPayment(t);
  t.click('.modal [data-act=method][data-method=split]');
  await t.until(() => t.$('.modal [name=split-other]'));
  assert.ok(t.$('.modal [name=split-via]'), 'a choice of name next to the Other amount');
  assert.deepEqual([...t.$('.modal [name=split-via]').options].map(o => o.textContent), ['Other', 'KBZPay', 'Wave Pay']);
  t.type('.modal [name=split-cash]', '2');
  t.type('.modal [name=split-other]', '3.35');
  const via = t.$('.modal [name=split-via]');
  via.value = 'Wave Pay';
  via.dispatchEvent(new t.w.Event('change', { bubbles: true }));
  t.click('.modal [data-act=complete]');
  await t.until(() => t.modalTitle() === 'Payment complete ✓', { what: 'the receipt' });
  assert.match(t.text('.modal .receipt'), /Wave Pay/);
  await t.until(() => db().all('orders').some(o => o.payment && o.payment.method === 'split'), { what: 'the split payment on the server' });
  const split = db().all('orders').find(o => o.payment.method === 'split');
  assert.deepEqual(split.payment.parts.map(p => [p.method, p.via]), [['cash', undefined], ['other', 'Wave Pay']]);
  t.click('.modal [data-act=__close]');
});

test('Reports: payments are listed by name, and the CSV carries it', opts, async () => {
  const admin = await open();
  await admin.signIn('Admin', '482915');
  admin.w.eval('window.__files = []; downloadFile = (name, content, type) => window.__files.push({ name, content, type })');
  admin.click('[data-nav=reports]');
  await admin.until(() => admin.screen() === 'reports');
  await admin.until(() => admin.$('.report-grid'), { what: 'the reports' });
  const card = [...admin.$$('.report-grid .card')].find(c => /Payment methods/.test(c.textContent));
  const labels = [...card.querySelectorAll('.bar-label')].map(e => e.textContent);
  assert.ok(labels.includes('KBZPay') && labels.includes('Wave Pay') && labels.includes('Other'), `by name: ${labels}`);
  admin.click('[data-act=csv]');
  const csv = admin.get('window.__files')[0].content;
  assert.match(csv, /other \(KBZPay\)/);
  assert.match(csv, /split: cash 2 \+ other \(Wave Pay\) 3.35/);
});

test('Myanmar: the payment names card and the checkout choice are translated', opts, async () => {
  const admin = await open({ lang: 'my' });
  await admin.signIn('Admin', '482915');
  admin.click('[data-nav=settings]');
  await admin.until(() => admin.$('[data-role=paynames]'), { what: 'the payment names card' });
  await admin.sleep(80);
  const latin = sel => admin.$$(sel).map(e => e.textContent.replace(/\s+/g, ' ').trim()).filter(x => /[A-Za-z]/.test(x))
    .filter(x => !/^(\+ )?(KBZPay|Wave Pay|AYA Pay|CB Pay|UAB Pay|Bank transfer)$/.test(x));
  assert.deepEqual(latin('[data-role=paynames] h2, [data-role=paynames] p, [data-role=paynames] button, [data-role=paynames] .muted'), []);
});
