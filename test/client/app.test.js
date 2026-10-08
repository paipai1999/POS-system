'use strict';

// The real web app, clicked through in jsdom against a real server. Needs jsdom:  npm install
// Run with:  npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM, startServer, openApp, until, sleep } = require('./harness.js');

const opts = JSDOM ? {} : { skip: 'jsdom is not installed (run "npm install" once)' };

let srv;
const tabs = [];
const open = async (o) => { const t = await openApp(srv.base, o); tabs.push(t); return t; };
const pid = (tab, name) => tab.get(`Store.data.products.find(p => p.name === ${JSON.stringify(name)}).id`);
const orders = () => srv.app.db.all('orders');
const money = n => Math.round(n * 100) / 100;

test.before(async () => { if (JSDOM) srv = await startServer(); });
test.after(async () => {
  tabs.forEach(t => { try { t.close(); } catch (e) { /* already closed */ } });
  if (srv) await srv.stop();
});

test('signing in: a demo PIN must be replaced before the app can be used', opts, async () => {
  const t = await open();
  assert.equal(t.text('.login-card h1'), 'My Cafe');
  await t.pressPin('Admin', '1234');
  await t.until(() => t.modalTitle() === 'Choose your own PIN', { what: 'the PIN change dialog' });
  t.key('Escape');
  t.click('.modal-backdrop');
  assert.equal(t.get('Modal.isOpen'), true, 'the dialog cannot be dismissed');
  assert.equal(t.$('.modal-head .icon-btn'), null, 'and has no close button');

  t.type('[name=pin]', '1111'); t.type('[name=again]', '1111');
  t.click('.modal [data-act=save]');
  await t.until(() => t.toasts().some(x => /too easy/.test(x)), { what: 'the weak PIN message' });
  t.type('[name=pin]', '482915'); t.type('[name=again]', '4829');
  t.click('.modal [data-act=save]');
  await t.until(() => t.toasts().some(x => /do not match/.test(x)), { what: 'the mismatch message' });
  t.type('[name=again]', '482915');
  t.click('.modal [data-act=save]');
  await t.until(() => !t.get('Modal.isOpen'), { what: 'the dialog to close' });
  assert.equal(t.screen(), 'tables');
  assert.ok(t.$$('.nav-btn').length >= 6, 'the admin sees the full menu');

  // The old PIN no longer works; the new one does.
  t.click('[data-nav=logout]');
  await t.until(() => t.screen() === 'login');
  await t.pressPin('Admin', '1234');
  await t.until(() => t.$('.pin-dots.shake'), { what: 'the wrong-PIN shake' });
  assert.equal(t.get('!!App.user'), false);
  await t.pressPin('Admin', '482915');
  await t.until(() => t.get('!!App.user'));
  assert.equal(t.get('Store.mustChangePin(App.user)'), false);
});

test('a cashier takes an order, sends it to the kitchen and is paid; the receipt stays on screen', opts, async () => {
  const t = await open();
  await t.signIn('Maya', '1111', '735192');
  t.click('[data-act=table][data-id]:not(.busy)');
  await t.until(() => t.screen() === 'order');
  const espresso = pid(t, 'Espresso');
  t.click(`[data-act=add][data-id="${espresso}"]`);
  t.click(`[data-act=add][data-id="${espresso}"]`);
  assert.match(t.text('.ticket-lines'), /Espresso/);
  assert.match(t.text('.totals'), /Total\$5\.35/);

  t.click('[data-act=send]');
  await t.until(() => srv.app.db.all('kitchenTickets').length === 1, { what: 'the kitchen ticket on the server' });
  assert.equal(t.prints.length, 1, 'a kitchen ticket was printed');
  assert.match(t.prints[0], /2 x Espresso/);

  t.click('[data-act=pay]');
  await t.until(() => /^Payment/.test(t.modalTitle() || ''));
  t.click('.modal [data-act=quick]');
  t.click('.modal [data-act=complete]');
  await t.until(() => t.modalTitle() === 'Payment complete ✓', { what: 'the receipt' });
  await t.until(() => orders().some(o => o.status === 'paid'), { what: 'the payment on the server' });
  const paid = orders().find(o => o.status === 'paid');
  assert.equal(paid.totals.total, 5.35);
  assert.equal(paid.payment.method, 'cash');
  assert.equal(paid.cashierId, t.get('App.user.id'));
  await t.sleep(700); // the server's reply arrives; it must not close the receipt
  assert.equal(t.modalTitle(), 'Payment complete ✓');
  assert.match(t.text('.modal .receipt'), /Espresso/);
  t.click('.modal [data-act=__close]');
  await t.until(() => t.screen() === 'tables');
});

test('offline: changes are queued, shown as waiting, and sent when the connection returns', opts, async () => {
  const t = await open();
  await t.signIn('Leo', '2222', '618204');
  t.click('[data-act=table][data-id]:not(.busy)');
  await t.until(() => t.screen() === 'order');
  const espresso = pid(t, 'Espresso'), latte = pid(t, 'Latte');
  t.click(`[data-act=add][data-id="${espresso}"]`);
  await t.until(() => t.get('Sync.pendingCount()') === 0, { what: 'the first item to sync' });
  const id = t.get('Screens.order.orderId');
  assert.equal(srv.app.db.doc('orders', id).items.length, 1);

  t.net.up = false; // Wi-Fi drops
  t.click(`[data-act=add][data-id="${latte}"]`);
  t.click(`[data-act=add][data-id="${latte}"]`);
  t.click(`[data-act=add][data-id="${espresso}"]`);
  await t.until(() => /Offline/.test(t.text('#sync-status') || ''), { what: 'the offline indicator' });
  assert.match(t.text('#sync-status'), /Offline · \d+ waiting/);
  assert.ok(t.get('Sync.pendingCount()') > 0);
  assert.match(t.text('.ticket-lines'), /Latte/, 'the waiter can keep working');
  assert.equal(srv.app.db.doc('orders', id).items.length, 1, 'the server has not seen the new items yet');

  t.net.up = true; // Wi-Fi returns
  await t.until(() => t.get('Sync.pendingCount()') === 0, { timeout: 8000, what: 'the queue to be sent' });
  const stored = srv.app.db.doc('orders', id);
  const qty = Object.fromEntries(stored.items.map(l => [l.name, l.qty]));
  assert.deepEqual(qty, { Espresso: 2, Latte: 2 });
  assert.match(t.text('#sync-status'), /Live/);
});

test('offline edit that collides with a change made elsewhere: the newer server copy wins and the user is told', opts, async () => {
  const t = await open();
  await t.signIn('Maya', '735192');
  t.click('[data-act=table][data-id]:not(.busy)');
  await t.until(() => t.screen() === 'order');
  t.click(`[data-act=add][data-id="${pid(t, 'Espresso')}"]`);
  await t.until(() => t.get('Sync.pendingCount()') === 0);
  const id = t.get('Screens.order.orderId');

  t.net.up = false;
  t.get(`(() => { Store.order(${JSON.stringify(id)}).note = 'typed on the phone'; Store.save(); })()`);
  const doc = srv.app.db.doc('orders', id);
  srv.app.db.put('orders', id, { ...doc, note: 'typed at the counter' }); // someone else saved meanwhile
  t.net.up = true;
  await t.until(() => t.toasts().some(x => /Someone changed this on another device/.test(x)), { timeout: 8000, what: 'the conflict message' });
  await t.until(() => t.get('Sync.pendingCount()') === 0);
  assert.equal(t.get(`Store.order(${JSON.stringify(id)}).note`), 'typed at the counter');
  assert.equal(srv.app.db.doc('orders', id).note, 'typed at the counter', 'nothing was overwritten on the server');
});

test('a price edited in the browser is refused by the server and put back', opts, async () => {
  const t = await open();
  await t.signIn('Maya', '735192');
  t.click('[data-act=table][data-id]:not(.busy)');
  await t.until(() => t.screen() === 'order');
  t.click(`[data-act=add][data-id="${pid(t, 'Latte')}"]`);
  await t.until(() => t.get('Sync.pendingCount()') === 0);
  const id = t.get('Screens.order.orderId');
  t.get(`(() => { Store.order(${JSON.stringify(id)}).items[0].price = 0.01; Store.save(); })()`);
  await t.until(() => t.toasts().some(x => /price of Latte cannot be changed/.test(x)), { what: 'the refusal' });
  await t.until(() => t.get(`Store.order(${JSON.stringify(id)}).items[0].price`) === 4, { what: 'the price to be restored' });
  assert.equal(srv.app.db.doc('orders', id).items[0].price, 4);
});

test('options, splitting the bill, tip, split payment and the cash drawer, all through the screens', opts, async () => {
  // The owner adds options to the Latte.
  const latteDoc = srv.app.db.all('products').find(p => p.name === 'Latte');
  srv.app.db.put('products', latteDoc.id, { ...latteDoc, options: [{ name: 'Extra shot', price: 0.5 }, { name: 'Large', price: 1 }] });

  const t = await open();
  await t.signIn('Maya', '735192');
  await t.get('Sync.catchUp()');

  // Start a shift with 100 in the drawer.
  t.click('[data-nav=drawer]');
  await t.until(() => t.screen() === 'drawer');
  t.type('[name=float]', '100');
  t.click('[data-act=start-shift]');
  await t.until(() => srv.app.db.all('shifts').length === 1, { what: 'the shift on the server' });
  assert.match(t.text('.drawer-grid'), /Should be in the drawer\$100\.00/);

  // Order: a Latte with both options and three espressos.
  t.click('[data-nav=tables]');
  await t.until(() => t.screen() === 'tables');
  t.click('[data-act=table][data-id]:not(.busy)');
  await t.until(() => t.screen() === 'order');
  t.click(`[data-act=add][data-id="${pid(t, 'Latte')}"]`);
  await t.until(() => t.modalTitle() === 'Latte', { what: 'the options dialog' });
  t.$$('.modal [name=opt]').forEach(i => { i.checked = true; i.dispatchEvent(new t.w.Event('change', { bubbles: true })); });
  assert.equal(t.text('.modal [data-role=sum]'), '$5.50');
  t.click('.modal [data-act=add]');
  const espresso = pid(t, 'Espresso');
  for (let i = 0; i < 3; i++) t.click(`[data-act=add][data-id="${espresso}"]`);
  assert.match(t.text('.ticket-lines'), /\+ Extra shot, Large/);
  await t.until(() => t.get('Sync.pendingCount()') === 0);
  const sourceId = t.get('Screens.order.orderId');
  assert.equal(srv.app.db.doc('orders', sourceId).items[0].price, 5.5);

  // Split two espressos onto their own bill.
  t.click('[data-act=more]');
  t.click('.modal [data-act=split]');
  await t.until(() => /^Split bill/.test(t.modalTitle() || ''));
  const espressoRow = () => t.$$('.split-lines .line').find(l => l.textContent.includes('Espresso'));
  t.click(espressoRow().querySelector('[data-act=more]'));
  t.click(espressoRow().querySelector('[data-act=more]'));
  t.click('.modal [data-act=go]');
  await t.until(() => t.get('Screens.order.orderId') !== sourceId, { what: 'the new bill to open' });
  const splitId = t.get('Screens.order.orderId');
  await t.until(() => srv.app.db.doc('orders', splitId), { what: 'the second bill on the server' });
  const [src, split] = [srv.app.db.doc('orders', sourceId), srv.app.db.doc('orders', splitId)];
  assert.equal(src.items.reduce((n, l) => n + l.qty, 0), 2, 'one latte and one espresso stay');
  assert.equal(split.items[0].qty, 2);
  assert.equal(split.splitFrom, sourceId);
  assert.match(t.text('.ticket-head'), /\(split\)/);

  // Pay the new bill (2 espressos = 5.35) with a 10% tip, 2.00 in cash and the rest by card.
  t.click('[data-act=pay]');
  await t.until(() => /^Payment/.test(t.modalTitle() || ''));
  t.type('[name=tip]', '0.54');
  assert.match(t.text('[data-role=due]'), /Bill \$5\.35 \+ tip \$0\.54 = \$5\.89/);
  t.click('.modal [data-act=method][data-method=split]');
  t.type('[name=split-cash]', '2');
  t.click('.modal [data-act=rest][data-m=card]');
  assert.equal(t.$('.modal [data-act=complete]').disabled, false);
  t.click('.modal [data-act=complete]');
  await t.until(() => orders().find(o => o.id === split.id).status === 'paid', { what: 'the split payment' });
  const paid = orders().find(o => o.id === split.id);
  assert.equal(paid.payment.tip, 0.54);
  assert.deepEqual(paid.payment.parts.map(p => [p.method, p.amount]), [['cash', 2], ['card', 3.89]]);
  assert.match(t.text('.modal .receipt'), /Tip\$0\.54/);
  assert.match(t.text('.modal .receipt'), /Card\$3\.89/);
  t.click('.modal [data-act=__close]');

  // Close the shift: 100 + 2.00 cash should be in the drawer; count 101 and see the shortfall.
  t.click('[data-nav=drawer]');
  await t.until(() => t.screen() === 'drawer');
  assert.match(t.text('.drawer-grid'), /Should be in the drawer\$102\.00/);
  t.click('[data-act=close-shift]');
  await t.until(() => t.modalTitle() === 'Close shift');
  t.type('[name=counted]', '101');
  assert.match(t.text('[data-role=diff]'), /Short by \$1\.00/);
  t.click('.modal [data-act=confirm]');
  await t.until(() => srv.app.db.all('shifts')[0].closedAt, { what: 'the shift to close on the server' });
  const shift = srv.app.db.all('shifts')[0];
  assert.deepEqual([shift.expectedCash, shift.countedCash, shift.difference, shift.tips], [102, 101, -1, 0.54]);
  await t.until(() => /-\$1\.00/.test(t.text('table.data tbody') || ''), { what: 'the shift in the list' });
});

test('Myanmar interface: switches on and off without losing anything, and covers the main screens', opts, async () => {
  const t = await open({ lang: 'my' });
  assert.equal(t.text('.login-card p.muted'), 'ဝင်ရန် သင့်အမည်ကို နှိပ်ပါ');
  t.click('.lang-btn');
  assert.equal(t.text('.login-card p.muted'), 'Tap your name to sign in', 'back to English');
  t.click('.lang-btn');
  await t.sleep(20); // the page is translated a moment after it is drawn
  assert.equal(t.text('.login-card p.muted'), 'ဝင်ရန် သင့်အမည်ကို နှိပ်ပါ');

  await t.signIn('Admin', '482915');
  const navText = () => t.$$('.nav-btn span').map(s => s.textContent);
  assert.ok(navText().every(x => !/[A-Za-z]/.test(x)), `every menu label is Myanmar: ${navText()}`);
  for (const [nav, heading] of [['settings', 'ဆက်တင်များ'], ['drawer', 'ငွေအံဆွဲ'], ['reports', 'အစီရင်ခံစာများ'], ['users', 'ဝန်ထမ်းများ']]) {
    t.click(`[data-nav=${nav}]`);
    await t.until(() => t.text('.page-head h1') === heading, { what: `the ${nav} heading in Myanmar` });
  }
  t.click('[data-nav=settings]');
  await t.until(() => t.screen() === 'settings');
  assert.ok(t.$$('.settings-grid h2').every(h => !/[A-Za-z]/.test(h.textContent)), 'every settings card title is Myanmar');
  assert.ok(t.$$('.settings-grid button.btn').every(b => !/^[\sA-Za-z]+$/.test(b.textContent)), 'no button is left in plain English');

  // Things typed by people are never translated: a table named "Kitchen" stays as typed.
  assert.equal(t.get('I18N.tr("Latte")'), null);
  t.click('[data-nav=lang]');
  await t.until(() => t.text('.page-head h1') === 'Settings', { what: 'English to come back' });
  assert.ok(t.$$('.nav-btn span').map(s => s.textContent).includes('Tables'));
  assert.equal(t.get('document.documentElement.lang'), 'en');
});

test('single-device mode (no server): sign-in, bill splitting and the drawer work from the browser alone', opts, async () => {
  const t = await open({ apiDown: true });
  assert.equal(t.get('Store.mode'), 'local');
  await t.signIn('Admin', '1234', '582913');
  assert.equal(t.get('Store.data.users.find(u => u.name === "Admin").pin'), '582913');

  t.click('[data-nav=drawer]');
  await t.until(() => t.screen() === 'drawer');
  t.type('[name=float]', '20');
  t.click('[data-act=start-shift]');
  assert.equal(t.get('Store.openShift().openingFloat'), 20);

  t.click('[data-nav=tables]');
  await t.until(() => t.screen() === 'tables');
  t.click('[data-act=table][data-id]:not(.busy)');
  await t.until(() => t.screen() === 'order');
  const latte = pid(t, 'Latte');
  t.click(`[data-act=add][data-id="${latte}"]`);
  t.click(`[data-act=add][data-id="${latte}"]`);
  t.click(`[data-act=add][data-id="${pid(t, 'Espresso')}"]`);
  const first = t.get('Screens.order.orderId');
  t.click('[data-act=more]');
  t.click('.modal [data-act=split]');
  await t.until(() => /^Split bill/.test(t.modalTitle() || ''));
  t.click(t.$$('.split-lines .line').find(l => l.textContent.includes('Espresso')).querySelector('[data-act=more]'));
  t.click('.modal [data-act=go]');
  await t.until(() => t.get('Screens.order.orderId') !== first, { what: 'the new bill' });
  assert.equal(t.get('Store.data.orders.length'), 2);
  assert.equal(t.get(`Store.order(${JSON.stringify(first)}).items.map(l => l.name + l.qty).join()`), 'Latte2');

  // Pay the espresso bill in cash with a tip, then close the drawer.
  t.click('[data-act=pay]');
  await t.until(() => /^Payment/.test(t.modalTitle() || ''));
  t.type('[name=tip]', '1');
  t.type('[name=tendered]', '10');
  assert.match(t.text('[data-role=change]'), /Change \$6\.32/); // 10 − (2.68 + 1.00)
  t.click('.modal [data-act=complete]');
  await t.until(() => t.modalTitle() === 'Payment complete ✓');
  assert.equal(t.get('Store.data.orders.filter(o => o.status === "paid").length'), 1);
  t.click('.modal [data-act=__close]');

  t.click('[data-nav=drawer]');
  await t.until(() => t.screen() === 'drawer');
  assert.match(t.text('.drawer-grid'), /Should be in the drawer\$23\.68/); // 20 + 2.68 + 1.00
  t.click('[data-act=close-shift]');
  await t.until(() => t.modalTitle() === 'Close shift');
  t.type('[name=counted]', '23.68');
  assert.match(t.text('[data-role=diff]'), /The drawer matches/);
  t.click('.modal [data-act=confirm]');
  await t.until(() => t.get('Store.data.shifts[0].closedAt'));
  assert.equal(t.get('Store.data.shifts[0].difference'), 0);
});

test('single-device mode applies the same payment and stock rules as the server', opts, async () => {
  const t = await open({ apiDown: true });
  await t.signIn('Admin', '1234', '582913');
  const result = JSON.parse(t.get(`JSON.stringify((() => {
    const toast = [];
    const p = Store.data.products.find(x => x.name === 'Avocado Toast');
    const order = Store.createOrder({ tableId: null, staffId: App.user.id });
    Store.addItem(order, p, 2);
    const total = Store.totals(order).total;                                  // 17 + 7% = 18.19
    const attempts = [
      { method: 'cash', tendered: total - 1 },                                // short
      { method: 'cash', tendered: total + 1, tip: -2 },                       // negative tip
      { method: 'bitcoin' },
      { method: 'split', parts: [{ method: 'cash', amount: 5, tendered: 5 }, { method: 'card', amount: 5 }] },
    ];
    for (const a of attempts) { try { Store.payOrder(order, a, App.user.id); toast.push('accepted'); } catch (e) { toast.push(e.message); } }
    const stockBefore = p.stock;
    Store.payOrder(order, { method: 'cash', tendered: 20, tip: 1 }, App.user.id);
    const afterPay = { status: order.status, stock: p.stock, change: order.payment.change, tip: order.payment.tip };
    Store.refundOrder(order, App.user.id);
    return { rejections: toast, stockBefore, afterPay, stockAfterRefund: p.stock };
  })())`));
  assert.deepEqual(result.rejections, [
    'Cash received is less than the total', 'Invalid tip', 'Invalid payment method', 'The parts of a split payment must add up to the total',
  ]);
  assert.equal(result.afterPay.stock, result.stockBefore - 2, 'stock is taken once, at payment');
  assert.equal(result.afterPay.change, 0.81, '20 − (18.19 + 1.00)');
  assert.equal(result.stockAfterRefund, result.stockBefore, 'a refund returns exactly what was taken');
});
