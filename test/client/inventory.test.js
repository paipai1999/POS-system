'use strict';

// Ingredients, recipes, purchases, stocktakes, customers and loyalty, clicked through in jsdom. Run with:  npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM, startServer, openApp } = require('./harness.js');

const opts = JSDOM ? {} : { skip: 'jsdom is not installed (run "npm install" once)' };

let srv;
const tabs = [];
const open = async (o) => { const t = await openApp(srv.base, o); tabs.push(t); return t; };
const pid = (tab, name) => tab.get(`Store.data.products.find(p => p.name === ${JSON.stringify(name)}).id`);

test.before(async () => { if (JSDOM) srv = await startServer(); });
test.after(async () => {
  tabs.forEach(t => { try { t.close(); } catch (e) { /* already closed */ } });
  if (srv) await srv.stop();
});

const db = () => srv.app.db;
const oat = () => db().all('ingredients').find(i => i.name === 'Oat milk');

test('inventory through the screens: ingredient, purchase, recipe; a sale in another tab uses it up; stocktake', opts, async () => {
  const admin = await open();
  await admin.signIn('Admin', '1234', '482915');
  admin.click('[data-nav=inventory]');
  await admin.until(() => admin.screen() === 'inventory');
  assert.match(admin.text('.stats'), /Stock value/);

  // A new ingredient with some stock.
  admin.click('[data-act=new-ingredient]');
  await admin.until(() => admin.modalTitle() === 'New ingredient');
  admin.type('.modal [name=name]', 'Oat milk'); admin.type('.modal [name=unit]', 'ml');
  admin.type('.modal [name=cost]', '0.002'); admin.type('.modal [name=lowStock]', '500'); admin.type('.modal [name=stock]', '1000');
  admin.click('.modal [data-act=save]');
  await admin.until(() => oat(), { what: 'the ingredient on the server' });
  assert.deepEqual([oat().stock, oat().cost, oat().unit], [1000, 0.002, 'ml']);

  // A purchase: 2,000 ml for 6.00 (0.003 each). The cost becomes the weighted average.
  admin.click('[data-act=tab][data-tab=purchases]');
  admin.click('[data-act=new-purchase]');
  await admin.until(() => admin.modalTitle() === 'New purchase');
  admin.type('.modal [name=newSupplier]', 'Green Valley');
  admin.type('.modal [data-role=ing]', oat().id);
  admin.type('.modal [data-role=qty]', '2000'); admin.type('.modal [data-role=total]', '6');
  assert.match(admin.text('.modal [data-role=sum]'), /Total \$6\.00/);
  admin.click('.modal [data-act=save]');
  await admin.until(() => db().all('purchases').length === 1, { what: 'the purchase on the server' });
  assert.equal(oat().stock, 3000);
  assert.equal(oat().cost, Math.round(((1000 * 0.002 + 2000 * 0.003) / 3000) * 10000) / 10000);
  await admin.until(() => /Green Valley/.test(admin.text('table.data tbody') || ''), { what: 'the purchase in the list' });

  // A recipe for Espresso: its 18 g of beans plus 30 ml of oat milk.
  admin.click('[data-nav=products]');
  await admin.until(() => admin.screen() === 'products');
  admin.click(`[data-act=edit][data-id="${pid(admin, 'Espresso')}"]`);
  await admin.until(() => admin.modalTitle() === 'Edit item');
  assert.equal(admin.$$('.modal .line-row.recipe').length, 1, 'the existing recipe is shown');
  admin.click('.modal [data-act=rc-add]');
  admin.type('.modal .line-row.recipe:last-of-type [data-role=rc-ing]', oat().id);
  admin.type('.modal .line-row.recipe:last-of-type [data-role=rc-qty]', '30');
  assert.match(admin.text('.modal [data-role=rc-sum]'), /Cost per portion/);
  admin.click('.modal [data-act=save]');
  await admin.until(() => db().all('products').find(p => p.name === 'Espresso').recipe.length === 2, { what: 'the recipe on the server' });

  // A cashier in another tab sells two espressos.
  const cashier = await open();
  await cashier.signIn('Maya', '1111', '735192');
  cashier.click('[data-act=table][data-id]:not(.busy)');
  await cashier.until(() => cashier.screen() === 'order');
  const beansBefore = db().all('ingredients').find(i => i.name === 'Coffee beans').stock;
  cashier.click(`[data-act=add][data-id="${pid(cashier, 'Espresso')}"]`);
  cashier.click(`[data-act=add][data-id="${pid(cashier, 'Espresso')}"]`);
  await cashier.until(() => cashier.get('Sync.pendingCount()') === 0);
  cashier.click('[data-act=pay]');
  await cashier.until(() => /^Payment/.test(cashier.modalTitle() || ''));
  cashier.click('.modal [data-act=quick]');
  cashier.click('.modal [data-act=complete]');
  await cashier.until(() => oat().stock === 3000 - 60, { what: 'the ingredients to be used up' });
  assert.equal(db().all('ingredients').find(i => i.name === 'Coffee beans').stock, beansBefore - 36);
  assert.equal(cashier.get('Store.data.ingredients.length'), 0, 'the cashier never receives ingredients or costs');

  // The manager's screen follows live and the reports show the cost.
  await admin.until(() => admin.get(`Store.ingredient(${JSON.stringify(oat().id)}).stock`) === 2940, { what: 'the live stock update' });
  admin.click('[data-nav=reports]');
  await admin.until(() => admin.screen() === 'reports');
  await admin.until(() => /Ingredient cost/.test(admin.text('.stats') || ''), { what: 'the cost figure' });
  assert.match(admin.text('.stats'), /Profit on those items/);

  // Stocktake: the count of Oat milk is 100 ml short.
  admin.click('[data-nav=inventory]');
  await admin.until(() => admin.screen() === 'inventory');
  admin.click('[data-act=tab][data-tab=stocktakes]');
  admin.click('[data-act=new-stocktake]');
  await admin.until(() => admin.modalTitle() === 'New stocktake');
  const row = admin.$$('.modal tr[data-i]').find(r => r.textContent.includes('Oat milk'));
  admin.type(row.querySelector('[data-role=counted]'), '2840');
  assert.match(row.querySelector('[data-role=diff]').textContent, /-100/);
  admin.click('.modal [data-act=save]');
  await admin.until(() => db().all('stocktakes').length === 1, { what: 'the stocktake on the server' });
  assert.equal(oat().stock, 2840);
  const st = db().all('stocktakes')[0];
  assert.equal(st.lines[0].diff, -100);
  assert.equal(st.value, Math.round(-100 * oat().cost * 100) / 100);
});

test('loyalty through the screens: switch on, add a customer, earn points, spend points, see them on the receipt', opts, async () => {
  const admin = await open();
  await admin.signIn('Admin', '482915');
  admin.click('[data-nav=settings]');
  await admin.until(() => admin.screen() === 'settings');
  admin.$('[name=loyaltyEnabled]').checked = true;
  admin.type('[name=earnPercent]', '10');
  admin.type('[name=maxRedeemPercent]', '50');
  admin.click('[data-role=general] [data-act=save]');
  await admin.until(() => (db().doc('settings', 'main').loyalty || {}).enabled === true, { what: 'loyalty to be switched on' });

  admin.click('[data-nav=customers]');
  await admin.until(() => admin.screen() === 'customers');
  assert.match(admin.text('.page-head + p'), /Loyalty points are on: customers earn 10%/);
  admin.click('[data-act=new]');
  await admin.until(() => admin.modalTitle() === 'New customer');
  admin.type('.modal [name=name]', 'Zaw Zaw'); admin.type('.modal [name=phone]', '09 555 1234');
  admin.type('.modal [name=points]', '50'); admin.type('.modal [name=discountPercent]', '0');
  admin.click('.modal [data-act=save]');
  await admin.until(() => db().all('customers').length === 1, { what: 'the customer on the server' });
  const cust = () => db().all('customers')[0];
  assert.deepEqual([cust().name, cust().points], ['Zaw Zaw', 50]);

  // The cashier rings up 3 lattes: 12.00. At most 50% = 6.00 of it can be paid with points.
  const cashier = await open();
  await cashier.signIn('Maya', '735192');
  await cashier.get('Sync.catchUp()');
  cashier.click('[data-act=table][data-id]:not(.busy)');
  await cashier.until(() => cashier.screen() === 'order');
  const latte = pid(cashier, 'Latte');
  for (let i = 0; i < 3; i++) cashier.click(`[data-act=add][data-id="${latte}"]`);
  await cashier.until(() => cashier.get('Sync.pendingCount()') === 0);
  cashier.click('[data-act=pay]');
  await cashier.until(() => /^Payment/.test(cashier.modalTitle() || ''));
  cashier.click('.modal [data-act=pick-customer]');
  await cashier.until(() => cashier.modalTitle() === 'Choose customer');
  cashier.type('.modal [data-role=q]', '5551');
  cashier.click('.modal [data-act=choose]');
  await cashier.until(() => /^Payment/.test(cashier.modalTitle() || ''), { what: 'back to the payment dialog' });
  assert.match(cashier.text('.cust-line'), /Zaw Zaw · 50 points/);
  assert.match(cashier.text('.modal'), /This bill earns 1\.28 points/);
  cashier.click('.modal [data-act=max-points]');
  await cashier.until(() => cashier.get('Store.order(Checkout.orderId).pointsUsed') === 6, { what: 'the points to be applied' });
  assert.match(cashier.text('.summary'), /Points used−\$6\.00/);
  assert.match(cashier.text('.summary'), /Total\$6\.42/); // (12 − 6) × 1.07
  cashier.click('.modal [data-act=quick]');
  cashier.click('.modal [data-act=complete]');
  await cashier.until(() => cashier.modalTitle() === 'Payment complete ✓', { what: 'the receipt' });
  await cashier.until(() => cust().visits === 1, { what: 'the customer to be updated' });
  assert.deepEqual([cust().points, cust().spent], [Math.round((50 - 6 + 0.64) * 100) / 100, 6.42]);
  await cashier.until(() => /Points earned/.test(cashier.text('.modal .receipt') || ''), { what: 'the receipt to show the points the server worked out' });
  assert.match(cashier.text('.modal .receipt'), /Customer: Zaw Zaw/);
  assert.match(cashier.text('.modal .receipt'), /Points used-\$6\.00/);
  assert.match(cashier.text('.modal .receipt'), /Points earned0\.64/);
  assert.match(cashier.text('.modal .receipt'), /Points balance44\.64/);
});

test('loyalty levels through the screens: set up levels, see the level at checkout, discount applied automatically', opts, async () => {
  const admin = await open();
  await admin.signIn('Admin', '482915');
  admin.click('[data-nav=settings]');
  await admin.until(() => admin.screen() === 'settings');
  admin.click('[data-act=tier-add]');
  admin.click('[data-act=tier-add]');
  const rows = () => admin.$$('.tier-row');
  admin.type(rows()[0].querySelector('[data-f=name]'), 'Silver'); admin.type(rows()[0].querySelector('[data-f=minSpent]'), '5');
  admin.type(rows()[0].querySelector('[data-f=earnPercent]'), '20'); admin.type(rows()[0].querySelector('[data-f=discountPercent]'), '10');
  admin.type(rows()[1].querySelector('[data-f=name]'), 'Gold'); admin.type(rows()[1].querySelector('[data-f=minSpent]'), '1000');
  admin.type(rows()[1].querySelector('[data-f=discountPercent]'), '15');
  admin.type('[name=expiryMonths]', '6'); admin.type('[name=visitEvery]', '5'); admin.type('[name=visitPercent]', '25');
  // A level without a name is refused before anything is sent.
  admin.click('[data-act=tier-add]');
  admin.type(admin.$$('.tier-row')[2].querySelector('[data-f=minSpent]'), '50');
  admin.click('[data-role=general] [data-act=save]');
  await admin.until(() => admin.toasts().some(x => /needs a name/.test(x)), { what: 'the missing-name message' });
  admin.click('[data-act=tier-del][data-i="2"]');
  admin.click('[data-role=general] [data-act=save]');
  await admin.until(() => (db().doc('settings', 'main').loyalty.tiers || []).length === 2, { what: 'the levels on the server' });
  const saved = db().doc('settings', 'main').loyalty;
  assert.deepEqual(saved.tiers.map(t => [t.name, t.minSpent, t.earnPercent, t.discountPercent]), [['Silver', 5, 20, 10], ['Gold', 1000, null, 15]]);
  assert.equal(saved.expiryMonths, 6);
  assert.deepEqual(saved.visitReward, { every: 5, discountPercent: 25 });

  admin.click('[data-nav=customers]');
  await admin.until(() => admin.screen() === 'customers');
  await admin.until(() => /Levels: Silver from/.test(admin.text('.page-head + p + p') || ''), { what: 'the levels line' });
  assert.match(admin.text('table.data tbody'), /Silver/, 'Zaw Zaw has spent 6.42, so he is Silver');

  // The cashier sees the level, and the level's 10% discount is put on the bill by itself.
  const cashier = await open();
  await cashier.signIn('Maya', '735192');
  await cashier.get('Sync.catchUp()');
  cashier.click('[data-act=table][data-id]:not(.busy)');
  await cashier.until(() => cashier.screen() === 'order');
  const latte = pid(cashier, 'Latte');
  for (let i = 0; i < 5; i++) cashier.click(`[data-act=add][data-id="${latte}"]`);
  await cashier.until(() => cashier.get('Sync.pendingCount()') === 0);
  cashier.click('[data-act=pay]');
  await cashier.until(() => /^Payment/.test(cashier.modalTitle() || ''));
  cashier.click('.modal [data-act=pick-customer]');
  await cashier.until(() => cashier.modalTitle() === 'Choose customer');
  cashier.type('.modal [data-role=q]', 'Zaw');
  cashier.click('.modal [data-act=choose]');
  await cashier.until(() => /^Payment/.test(cashier.modalTitle() || ''));
  assert.match(cashier.text('.cust-line'), /Silver · .* points · 10% off \(Silver level\)/);
  assert.match(cashier.text('.summary'), /Discount−\$2\.00/);                     // 10% of 20.00
  assert.match(cashier.text('.modal'), /This bill earns 3\.85 points/);          // 20% of (18.00 + 7%) = 19.26 → 3.85
  cashier.click('.modal [data-act=quick]');
  cashier.click('.modal [data-act=complete]');
  await cashier.until(() => cashier.modalTitle() === 'Payment complete ✓');
  await cashier.until(() => /Customer: Zaw Zaw \(Silver\)/.test(cashier.text('.modal .receipt') || ''), { what: 'the level on the receipt' });
  assert.equal(db().all('orders').find(o => o.loyalty && o.loyalty.tier === 'Silver').loyalty.earned, 3.85);
});

test('an option that uses an ingredient, set up in the item editor and sold at the counter', opts, async () => {
  const admin = await open();
  await admin.signIn('Admin', '482915');
  admin.click('[data-nav=products]');
  await admin.until(() => admin.screen() === 'products');
  admin.click(`[data-act=edit][data-id="${pid(admin, 'Latte')}"]`);
  await admin.until(() => admin.modalTitle() === 'Edit item');
  admin.click('.modal [data-act=o-add]');
  admin.type('.modal [data-role=o-name]', 'Oat swap'); admin.type('.modal [data-role=o-price]', '0.6');
  admin.click('.modal [data-act=u-add]');
  admin.type('.modal [data-role=u-ing]', oat().id);
  admin.type('.modal [data-role=u-qty]', '100');
  // An option with a missing price is fine (free), a missing amount is not.
  admin.click('.modal [data-act=o-add]');
  admin.type('.modal .opt-edit:last-of-type [data-role=o-name]', 'Decaf');
  admin.click('.modal [data-act=save]');
  await admin.until(() => (db().all('products').find(p => p.name === 'Latte').options || []).some(o => o.name === 'Oat swap'), { what: 'the options on the server' });
  const opts2 = db().all('products').find(p => p.name === 'Latte').options;
  assert.deepEqual(opts2.map(o => [o.name, o.price]), [['Oat swap', 0.6], ['Decaf', 0]]);
  assert.deepEqual(opts2[0].uses, [{ ingredientId: oat().id, qty: 100 }]);

  const cashier = await open();
  await cashier.signIn('Maya', '735192');
  await cashier.get('Sync.catchUp()');
  cashier.click('[data-act=table][data-id]:not(.busy)');
  await cashier.until(() => cashier.screen() === 'order');
  cashier.click(`[data-act=add][data-id="${pid(cashier, 'Latte')}"]`);
  await cashier.until(() => cashier.modalTitle() === 'Latte');
  const box = cashier.$$('.modal .opt-row').find(r => r.textContent.includes('Oat swap')).querySelector('input');
  box.checked = true; box.dispatchEvent(new cashier.w.Event('change', { bubbles: true }));
  assert.equal(cashier.text('.modal [data-role=sum]'), '$4.60');
  cashier.click('.modal [data-act=add]');
  await cashier.until(() => cashier.get('Sync.pendingCount()') === 0);
  const oatBefore = oat().stock;
  cashier.click('[data-act=pay]');
  await cashier.until(() => /^Payment/.test(cashier.modalTitle() || ''));
  cashier.click('.modal [data-act=quick]');
  cashier.click('.modal [data-act=complete]');
  await cashier.until(() => oat().stock === oatBefore - 100, { what: 'the option to use up the oat milk' });
});

test('when an ingredient runs out: a warning on the dish, then "stop selling", then a purchase puts it right', opts, async () => {
  db().all('orders').filter(o => o.status === 'open').forEach(o => db().put('orders', o.id, null, true)); // open bills hold ingredients
  const admin = await open();
  await admin.signIn('Admin', '482915');
  const cashier = await open();
  await cashier.signIn('Maya', '735192');
  await cashier.get('Sync.catchUp()');
  cashier.click('[data-act=table][data-id]:not(.busy)');
  await cashier.until(() => cashier.screen() === 'order');
  const tile = name => cashier.$(`[data-act=add][data-id="${pid(cashier, name)}"]`);

  // The manager picks "warn" in Settings and counts the milk: only 10 ml left.
  admin.click('[data-nav=settings]');
  await admin.until(() => admin.screen() === 'settings');
  admin.type('[name=ingredientStock]', 'warn');
  admin.click('[data-role=general] [data-act=save]');
  await admin.until(() => db().doc('settings', 'main').ingredientStock === 'warn', { what: 'the setting on the server' });
  const milk = db().all('ingredients').find(i => i.name === 'Milk');
  admin.get(`Store.addStocktake({ lines: [{ kind: 'ingredient', refId: ${JSON.stringify(milk.id)}, counted: 10 }] })`);
  await admin.until(() => (db().all('products').find(p => p.name === 'Latte').lacks || []).includes('Milk'), { what: 'the dish list on the server' });

  // The cashier's screen (which never receives ingredients) shows the warning but still sells.
  await cashier.until(() => /Running out: Milk/.test(tile('Latte').textContent), { what: 'the warning on the Latte' });
  assert.equal(tile('Latte').disabled, false);
  assert.doesNotMatch(tile('Espresso').textContent, /Running out/);

  // "Stop selling": the Latte is sold out and cannot be added; the Espresso is untouched.
  admin.type('[name=ingredientStock]', 'block');
  admin.click('[data-role=general] [data-act=save]');
  await admin.until(() => db().doc('settings', 'main').ingredientStock === 'block', { what: 'the "stop selling" setting on the server' });
  await cashier.until(() => cashier.get('Store.settings.ingredientStock') === 'block', { what: 'the setting to reach the cashier' });
  await cashier.until(() => tile('Latte').disabled, { what: 'the Latte to be sold out' });
  assert.match(tile('Latte').textContent, /Sold out: Milk/);
  assert.equal(tile('Espresso').disabled, false);

  // A purchase of milk puts it right on every screen.
  admin.get(`Store.addPurchase({ supplier: 'Dairy', lines: [{ ingredientId: ${JSON.stringify(milk.id)}, qty: 5000, total: 6 }] })`);
  await cashier.until(() => !tile('Latte').disabled, { what: 'the Latte to be on sale again' });
  assert.doesNotMatch(tile('Latte').textContent, /Sold out|Running out/);
  cashier.click(`[data-act=add][data-id="${pid(cashier, 'Latte')}"]`);
  await cashier.until(() => cashier.modalTitle() === 'Latte', { what: 'the options dialog (the Latte has options)' });
  cashier.click('.modal [data-act=add]');
  await cashier.until(() => cashier.get('Sync.pendingCount()') === 0);
  assert.equal(cashier.get('Store.order(Screens.order.orderId).items.length'), 1);
  // Back to the quiet default for the tests that follow.
  admin.type('[name=ingredientStock]', 'off');
  admin.click('[data-role=general] [data-act=save]');
  await admin.until(() => db().doc('settings', 'main').ingredientStock === 'off');
});

test('suppliers: buy on credit, see what is owed, pay in cash from the till, and the drawer follows', opts, async () => {
  const admin = await open();
  await admin.signIn('Admin', '482915');
  admin.click('[data-nav=inventory]');
  await admin.until(() => admin.screen() === 'inventory');
  admin.click('[data-act=tab][data-tab=suppliers]');
  admin.click('[data-act=new-supplier]');
  await admin.until(() => admin.modalTitle() === 'New supplier');
  admin.type('.modal [name=name]', 'Fresh Eggs Co'); admin.type('.modal [name=phone]', '09 777 000');
  admin.click('.modal [data-act=save]');
  const sup = () => db().all('suppliers').find(x => x.name === 'Fresh Eggs Co');
  await admin.until(() => sup(), { what: 'the supplier on the server' });

  // A purchase of 40.00 of which 10.00 is paid now: 30.00 stays owed.
  admin.click('[data-act=tab][data-tab=purchases]');
  admin.click('[data-act=new-purchase]');
  await admin.until(() => admin.modalTitle() === 'New purchase');
  admin.type('.modal [name=supplierId]', sup().id);
  admin.type('.modal [data-role=ing]', oat().id);
  admin.type('.modal [data-role=qty]', '500'); admin.type('.modal [data-role=total]', '40');
  admin.type('.modal [name=paid]', '10');
  admin.click('.modal [data-act=save]');
  await admin.until(() => db().all('purchases').some(x => x.supplierId === sup().id), { what: 'the purchase on the server' });
  assert.equal(sup().owed, 30);
  await admin.until(() => /owes \$30\.00/.test(admin.text('table.data tbody') || ''), { what: 'the amount owed in the purchases list' });

  // Owing without a supplier on the list is refused before anything is sent.
  admin.click('[data-act=new-purchase]');
  await admin.until(() => admin.modalTitle() === 'New purchase');
  admin.type('.modal [data-role=qty]', '10'); admin.type('.modal [data-role=total]', '5'); admin.type('.modal [name=paid]', '1');
  admin.click('.modal [data-act=save]');
  await admin.until(() => admin.toasts().some(x => /Choose a supplier/.test(x)), { what: 'the refusal' });
  admin.get('Modal.close(true)');

  // A cashier starts a shift with 100 in the drawer.
  const cashier = await open();
  await cashier.signIn('Maya', '735192');
  cashier.click('[data-nav=drawer]');
  await cashier.until(() => cashier.screen() === 'drawer');
  cashier.type('[name=float]', '100');
  cashier.click('[data-act=start-shift]');
  await cashier.until(() => db().all('shifts').some(x => !x.closedAt), { what: 'the shift on the server' });

  // The manager pays 12.00 of the debt in cash.
  admin.click('[data-act=tab][data-tab=suppliers]');
  await admin.until(() => /\$30\.00/.test(admin.text('table.data tbody') || ''), { what: 'the supplier list to show the debt' });
  admin.click(`[data-act=pay-supplier][data-id="${sup().id}"]`);
  await admin.until(() => admin.modalTitle() === 'Pay Fresh Eggs Co');
  assert.equal(admin.$('.modal [name=amount]').value, '30', 'the whole debt is suggested');
  admin.type('.modal [name=amount]', '12'); admin.type('.modal [name=method]', 'cash'); admin.type('.modal [name=note]', 'for the eggs');
  admin.click('.modal [data-act=save]');
  await admin.until(() => sup().owed === 18, { what: 'the debt to go down' });
  const payment = db().all('supplierPayments')[0];
  assert.deepEqual([payment.amount, payment.method, payment.supplierName], [12, 'cash', 'Fresh Eggs Co']);
  await admin.until(() => /\$18\.00/.test(admin.text('table.data tbody') || ''));
  // More than is owed is refused.
  admin.click(`[data-act=pay-supplier][data-id="${sup().id}"]`);
  await admin.until(() => admin.modalTitle() === 'Pay Fresh Eggs Co');
  admin.type('.modal [name=amount]', '19');
  admin.click('.modal [data-act=save]');
  await admin.until(() => admin.toasts().some(x => /Only 18 is owed/.test(x)), { what: 'the over-payment message' });
  admin.get('Modal.close(true)');

  // The cashier's drawer already counts the cash that left the till.
  await cashier.until(() => /Cash paid to suppliers\$12\.00/.test(cashier.text('.drawer-grid') || ''), { what: 'the payout on the drawer screen' });
  assert.match(cashier.text('.drawer-grid'), /Should be in the drawer\$88\.00/);
  assert.equal(cashier.get('Store.data.suppliers.length'), 0, 'and the cashier never receives the supplier list');
  cashier.click('[data-act=close-shift]');
  await cashier.until(() => cashier.modalTitle() === 'Close shift');
  cashier.type('[name=counted]', '88');
  assert.match(cashier.text('[data-role=diff]'), /The drawer matches/);
  cashier.click('.modal [data-act=confirm]');
  await cashier.until(() => db().all('shifts').every(x => x.closedAt), { what: 'the shift to close' });
  const shift = db().all('shifts').pop();
  assert.deepEqual([shift.expectedCash, shift.difference, shift.payouts], [88, 0, 12]);

  // The statement lists both, and a manager can void the payment: the debt comes back.
  admin.click('[data-act=tab][data-tab=suppliers]');
  admin.click(`[data-act=supplier-statement][data-id="${sup().id}"]`);
  await admin.until(() => /statement/.test(admin.modalTitle() || ''));
  assert.match(admin.text('.modal'), /Purchase/);
  assert.match(admin.text('.modal'), /Payment \(cash\)/);
  admin.click('.modal [data-act=void-payment]');
  await admin.until(() => sup().owed === 30, { what: 'the debt to come back' });
});

test('single-device mode: recipes use up ingredients, a refund puts them back, and loyalty points follow the bill', opts, async () => {
  const t = await open({ apiDown: true });
  await t.signIn('Admin', '1234', '582913');
  const r = JSON.parse(t.get(`JSON.stringify((() => {
    const find = n => Store.data.products.find(p => p.name === n);
    const beans = Store.data.ingredients.find(i => i.name === 'Coffee beans');
    const milk = Store.data.ingredients.find(i => i.name === 'Milk');
    Store.settings.loyalty = { enabled: true, earnPercent: 10, maxRedeemPercent: 50 };
    const cust = Screens.customers.create({ name: 'Local Lou', phone: '0911' });
    cust.points = 20;
    const o = Store.createOrder({ tableId: null, staffId: App.user.id });
    Store.addItem(o, find('Latte'), 2);
    o.customerId = cust.id;
    o.pointsUsed = 4;
    const total = Store.totals(o).total;
    const before = { beans: beans.stock, milk: milk.stock };
    Store.payOrder(o, { method: 'cash', tendered: 5 }, App.user.id);
    const afterPay = { beans: beans.stock, milk: milk.stock, cost: o.items[0].cost, points: cust.points, visits: cust.visits, loyalty: o.loyalty };
    Store.refundOrder(o, App.user.id);
    const afterRefund = { beans: beans.stock, milk: milk.stock, points: cust.points, visits: cust.visits };
    return { total, before, afterPay, afterRefund };
  })())`));
  assert.equal(r.total, 4.28, '(8 − 4 points) × 1.07');
  assert.equal(r.afterPay.beans, r.before.beans - 36);
  assert.equal(r.afterPay.milk, r.before.milk - 440);
  assert.equal(r.afterPay.cost, 0.984);
  assert.equal(r.afterPay.loyalty.earned, 0.42);
  assert.equal(r.afterPay.loyalty.used, 4);
  assert.equal(r.afterPay.points, 16.42);
  assert.deepEqual(r.afterRefund, { beans: r.before.beans, milk: r.before.milk, points: 20, visits: 0 });
});

test('single-device mode: suppliers, purchases on credit and payments follow the same rules', opts, async () => {
  const t = await open({ apiDown: true });
  await t.signIn('Admin', '1234', '582913');
  const r = JSON.parse(t.get(`JSON.stringify((() => {
    const milk = Store.data.ingredients.find(i => i.name === 'Milk');
    const try_ = fn => { try { fn(); return ''; } catch (e) { return e.message; } };
    const sup = Store.addSupplier({ name: 'Local Dairy' });
    const dup = try_(() => Store.addSupplier({ name: 'local dairy' }));
    const buy = (extra) => Store.addPurchase({ lines: [{ ingredientId: milk.id, qty: 1000, total: 50 }], ...extra });
    const noSupplier = try_(() => buy({ paid: 10 }));
    const tooMuch = try_(() => buy({ supplierId: sup.id, paid: 60 }));
    const p = buy({ supplierId: sup.id, paid: 20 });
    const afterBuy = { owed: sup.owed, stock: milk.stock };
    const over = try_(() => Store.addSupplierPayment({ supplierId: sup.id, amount: 31 }));
    const pay = Store.addSupplierPayment({ supplierId: sup.id, amount: 10, method: 'cash' });
    const afterPay = sup.owed;
    Store.voidSupplierPayment(pay);
    const afterVoidPayment = sup.owed;
    Store.voidPurchase(p);
    const afterVoidPurchase = { owed: sup.owed, stock: milk.stock };
    // The drawer: 100 at the start, 5 of cash handed to the supplier.
    buy({ supplierId: sup.id, paid: 0 });
    const shift = Store.startShift(100);
    Store.addSupplierPayment({ supplierId: sup.id, amount: 5, method: 'cash' });
    Store.addSupplierPayment({ supplierId: sup.id, amount: 7, method: 'other' });
    Store.closeShift(shift, 95, '');
    return { dup, noSupplier, tooMuch, afterBuy, over, afterPay, afterVoidPayment, afterVoidPurchase, shift: { expected: shift.expectedCash, difference: shift.difference, payouts: shift.payouts }, startStock: milk.stock };
  })())`));
  assert.match(r.dup, /already exists/);
  assert.match(r.noSupplier, /Choose a supplier/);
  assert.match(r.tooMuch, /between 0 and the total/);
  assert.equal(r.afterBuy.owed, 30);
  assert.match(r.over, /Only 30 is owed/);
  assert.equal(r.afterPay, 20);
  assert.equal(r.afterVoidPayment, 30);
  assert.equal(r.afterVoidPurchase.owed, 0);
  assert.equal(r.afterVoidPurchase.stock, r.afterBuy.stock - 1000, 'voiding takes the stock back out');
  assert.deepEqual(r.shift, { expected: 95, difference: 0, payouts: 5 }, 'only the cash payment leaves the till');
});

test('Myanmar interface covers the inventory, customers and recipe screens', opts, async () => {
  const t = await open({ lang: 'my' });
  await t.signIn('Admin', '482915');
  // A string counts as untranslated when it has English words and no Myanmar at all (names typed by people are not listed).
  const english = sel => t.$$(sel).map(e => e.textContent.trim()).filter(x => /[A-Za-z]{3,}/.test(x) && !/[က-႟]/.test(x));
  for (const [nav, tab] of [['inventory', null], ['inventory', 'purchases'], ['inventory', 'stocktakes'], ['customers', null], ['products', null]]) {
    t.click(`[data-nav=${nav}]`);
    await t.until(() => t.screen() === nav);
    if (tab) t.click(`[data-act=tab][data-tab=${tab}]`);
    await t.sleep(30);
    assert.deepEqual(english('.page-head h1, .page-head .btn, .seg button, table.data th'), [], `${nav}${tab ? '/' + tab : ''}: every heading, button and column title is Myanmar`);
  }
  t.click('[data-nav=inventory]'); await t.until(() => t.screen() === 'inventory');
  t.click('[data-act=tab][data-tab=ingredients]');
  t.click('[data-act=new-ingredient]'); await t.sleep(30);
  assert.deepEqual(english('.modal h2, .modal label, .modal button, .modal p'), [], 'new ingredient');
  t.click('.modal [data-act=__close]');
  t.click('[data-act=tab][data-tab=purchases]'); await t.sleep(30);
  t.click('[data-act=new-purchase]'); await t.sleep(30);
  assert.deepEqual(english('.modal h2, .modal .field-label, .modal label span, .modal button'), [], 'new purchase');
  t.click('.modal [data-act=__close]');
  t.click('[data-act=tab][data-tab=suppliers]'); await t.sleep(30);
  assert.deepEqual(english('.page-head h1, .page-head .btn, .seg button, table.data th, .stats .label, .page-content p, .main > p'), [], 'suppliers tab');
  t.click('[data-act=new-supplier]'); await t.sleep(30);
  assert.deepEqual(english('.modal h2, .modal label, .modal button, .modal p'), [], 'new supplier');
  t.click('.modal [data-act=__close]');
  t.click('[data-act=edit-supplier]'); await t.sleep(30);
  t.click('.modal [data-act=__close]');
  t.click('[data-act=supplier-statement]'); await t.sleep(30);
  assert.deepEqual(english('.modal h2, .modal th, .modal button, .modal p'), [], 'supplier statement');
  t.click('.modal [data-act=__close]');
  t.click('[data-act=pay-supplier]:not([disabled])'); await t.sleep(30);
  assert.deepEqual(english('.modal h2, .modal label, .modal button, .modal p'), [], 'pay supplier');
  t.click('.modal [data-act=__close]');
  t.click('[data-act=tab][data-tab=stocktakes]'); await t.sleep(30);
  t.click('[data-act=new-stocktake]'); await t.sleep(30);
  assert.deepEqual(english('.modal h2, .modal th, .modal button, .modal p'), [], 'new stocktake');
  t.click('.modal [data-act=__close]');
  // The item editor, with a recipe and options, and the settings that decide what happens when an ingredient runs out.
  t.click('[data-nav=products]'); await t.until(() => t.screen() === 'products');
  t.click(`[data-act=edit][data-id="${pid(t, 'Latte')}"]`); await t.sleep(30);
  t.click('.modal [data-act=o-add]'); t.click('.modal [data-act=u-add]'); await t.sleep(30);
  assert.deepEqual(english('.modal h2, .modal .field-label, .modal label, .modal button, .modal [data-role=rc-sum]'), [], 'item editor');
  assert.equal(t.$$('.modal input[placeholder]').filter(i => /[A-Za-z]{3,}/.test(i.placeholder) && !/[က-႟]/.test(i.placeholder)).length, 0, 'item editor placeholders');
  t.click('.modal [data-act=__close]');
  t.click('[data-nav=settings]'); await t.until(() => t.screen() === 'settings'); await t.sleep(30);
  assert.deepEqual(english('.settings-grid label, .settings-grid select[name=ingredientStock] option, .settings-grid .field-label, .settings-grid p'), [], 'settings');
  t.click('[data-nav=customers]'); await t.until(() => t.screen() === 'customers');
  t.click('[data-act=new]'); await t.sleep(30);
  assert.deepEqual(english('.modal h2, .modal label span, .modal button, .modal p'), [], 'new customer');
});
