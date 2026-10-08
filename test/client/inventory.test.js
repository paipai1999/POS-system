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
  admin.type('.modal [name=supplier]', 'Green Valley');
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
  assert.match(cashier.text('.modal .receipt'), /Customer: Zaw Zaw/);
  assert.match(cashier.text('.modal .receipt'), /Points used-\$6\.00/);
  assert.match(cashier.text('.modal .receipt'), /Points earned0\.64/);
  assert.match(cashier.text('.modal .receipt'), /Points balance44\.64/);
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

test('Myanmar interface covers the inventory, customers and recipe screens', opts, async () => {
  const t = await open({ lang: 'my' });
  await t.signIn('Admin', '482915');
  const english = sel => t.$$(sel).map(e => e.textContent.trim()).filter(x => /[A-Za-z]{3,}/.test(x));
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
  assert.deepEqual(english('.modal h2, .modal label span, .modal button, .modal p'), [], 'new ingredient');
  t.click('.modal [data-act=__close]');
  t.click('[data-act=tab][data-tab=purchases]'); await t.sleep(30);
  t.click('[data-act=new-purchase]'); await t.sleep(30);
  assert.deepEqual(english('.modal h2, .modal .field-label, .modal label span, .modal button'), [], 'new purchase');
  t.click('.modal [data-act=__close]');
  t.click('[data-act=tab][data-tab=stocktakes]'); await t.sleep(30);
  t.click('[data-act=new-stocktake]'); await t.sleep(30);
  assert.deepEqual(english('.modal h2, .modal th, .modal button, .modal p'), [], 'new stocktake');
  t.click('.modal [data-act=__close]');
  t.click('[data-nav=customers]'); await t.until(() => t.screen() === 'customers');
  t.click('[data-act=new]'); await t.sleep(30);
  assert.deepEqual(english('.modal h2, .modal label span, .modal button, .modal p'), [], 'new customer');
});
