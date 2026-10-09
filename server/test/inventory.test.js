'use strict';

// Ingredients, recipes, purchases and stocktakes. Run with:  node --test server/test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start } = require('../server.js');

let app, base, dataDir;

async function call(pathname, { token, method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
}

class Device {
  constructor(token, user) { this.token = token; this.user = user; this.vers = {}; this.docs = {}; }
  async load() {
    const { data } = await call('/api/snapshot', { token: this.token });
    this.vers = {}; this.docs = {};
    for (const r of data.rows) { this.vers[r.col + '/' + r.id] = r.ver; this.docs[r.col + '/' + r.id] = r.data; }
  }
  doc(col, id) { return structuredClone(this.docs[col + '/' + id]); }
  find(col, pred) { return Object.entries(this.docs).filter(([k, d]) => k.startsWith(col + '/') && d && pred(d)).map(([, d]) => structuredClone(d)); }
  async put(col, doc, id = doc.id) {
    const change = { col, id, base: this.vers[col + '/' + id] || 0, data: doc };
    const { data } = await call('/api/sync', { token: this.token, method: 'POST', body: { changes: [change] } });
    const r = data.results[0];
    this.vers[col + '/' + id] = r.ver;
    this.docs[col + '/' + id] = r.doc;
    return r;
  }
}

async function login(name, pin) {
  const users = (await call('/api/public')).data.users;
  const r = await call('/api/login', { method: 'POST', body: { userId: users.find(u => u.name === name).id, pin } });
  const dev = new Device(r.data.token, r.data.user);
  await dev.load();
  return dev;
}

const ing = name => app.db.all('ingredients').find(i => i.name === name);
const line = (dev, name, qty) => {
  const p = dev.find('products', x => x.name === name)[0];
  return { id: 'l_' + Math.random().toString(36).slice(2), productId: p.id, name: p.name, price: p.price, qty, note: '', sentQty: 0 };
};
const order = (dev, items) => ({
  id: 'o_' + Math.random().toString(36).slice(2), number: null, tableId: null, tableName: '', staffId: dev.user.id,
  status: 'open', note: '', discount: null, createdAt: Date.now(), items,
});
const pay = (dev, o, total, method = 'card') => dev.put('orders', { ...dev.doc('orders', o.id), status: 'paid', totals: { total }, payment: { method } });

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-inv-'));
  app = start({ port: 0, dataDir, quiet: true });
  await new Promise(r => app.server.once('listening', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

test.after(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('selling a dish uses up its ingredients, records its cost, and a refund puts back exactly that', async () => {
  const cashier = await login('Maya', '1111');
  const beans = ing('Coffee beans'), milk = ing('Milk');
  const o = (await cashier.put('orders', order(cashier, [line(cashier, 'Latte', 2)]))).doc;     // 2 × (18 g beans + 220 ml milk)
  assert.equal(ing('Coffee beans').stock, beans.stock, 'nothing is used until the bill is paid');

  const paid = await pay(cashier, o, 8.56);
  assert.equal(paid.status, 'ok', paid.error);
  assert.equal(ing('Coffee beans').stock, beans.stock - 36);
  assert.equal(ing('Milk').stock, milk.stock - 440);
  const l = app.db.doc('orders', o.id).items[0];
  assert.equal(l.cost, 0.984, '18 × 0.04 + 220 × 0.0012 per latte');
  assert.deepEqual(l.used.map(u => u.qty).sort((a, b) => a - b), [36, 440]);

  const admin = await login('Admin', '1234');
  await call('/api/verify-pin', { token: cashier.token, method: 'POST', body: { pin: '1234' } });
  const refunded = await cashier.put('orders', { ...cashier.doc('orders', o.id), status: 'refunded', refundedBy: admin.user.id });
  assert.equal(refunded.status, 'ok', refunded.error);
  assert.equal(ing('Coffee beans').stock, beans.stock);
  assert.equal(ing('Milk').stock, milk.stock);
});

test('what a dish costs is for managers: cashiers get neither the ingredients, the costs nor the purchases', async () => {
  const cashier = await login('Maya', '1111');
  const admin = await login('Admin', '1234');
  const o = (await cashier.put('orders', order(cashier, [line(cashier, 'Espresso', 1)]))).doc;
  assert.equal((await pay(cashier, o, 2.68)).status, 'ok');

  await cashier.load(); await admin.load();
  assert.equal(admin.doc('orders', o.id).items[0].cost, 0.72);
  assert.equal(cashier.doc('orders', o.id).items[0].cost, undefined);
  assert.equal(cashier.doc('orders', o.id).items[0].used, undefined);
  assert.equal(cashier.find('ingredients', () => true).length, 0);
  assert.equal(cashier.find('products', p => p.name === 'Latte')[0].recipe, undefined, 'recipes are not sent to cashiers either');
  assert.ok(admin.find('products', p => p.name === 'Latte')[0].recipe.length >= 2);
  assert.ok(admin.find('ingredients', () => true).length >= 3);
  // The cashier's paid bill still reads as paid and is not "changed" by the missing figures.
  assert.equal(cashier.doc('orders', o.id).status, 'paid');
  assert.equal((await call('/api/changes?since=0', { token: cashier.token })).data.rows.filter(r => ['ingredients', 'purchases', 'stocktakes'].includes(r.col)).length, 0);
  assert.equal((await cashier.put('ingredients', { id: 'i_x', name: 'Sugar', unit: 'g' })).status, 'error');
});

test('recipes are checked: real ingredients, an amount above zero, no repeats', async () => {
  const admin = await login('Admin', '1234');
  const latte = admin.find('products', p => p.name === 'Latte')[0];
  const beans = ing('Coffee beans').id;
  const tryRecipe = recipe => admin.put('products', { ...admin.doc('products', latte.id), recipe });
  assert.equal((await tryRecipe([{ ingredientId: 'nope', qty: 5 }])).status, 'error');
  assert.equal((await tryRecipe([{ ingredientId: beans, qty: 0 }])).status, 'error');
  assert.equal((await tryRecipe([{ ingredientId: beans, qty: -2 }])).status, 'error');
  assert.equal((await tryRecipe([{ ingredientId: beans, qty: 5 }, { ingredientId: beans, qty: 6 }])).status, 'error', 'same ingredient twice');
  assert.equal((await tryRecipe('flour')).status, 'ok', 'a non-list is treated as no recipe');
  const ok = await tryRecipe([{ ingredientId: beans, qty: 18.5 }]);
  assert.equal(ok.status, 'ok', ok.error);
  assert.deepEqual(ok.doc.recipe, [{ ingredientId: beans, qty: 18.5 }]);
  await tryRecipe([{ ingredientId: beans, qty: 18 }, { ingredientId: ing('Milk').id, qty: 220 }]); // back as it was
});

test('ingredient stock only moves through purchases, stocktakes and sales; one in a recipe cannot be deleted', async () => {
  const admin = await login('Admin', '1234');
  const made = await admin.put('ingredients', { id: 'i_sugar', name: ' Sugar ', unit: 'g', stock: 2000, cost: 0.002, lowStock: 200 });
  assert.equal(made.status, 'ok', made.error);
  assert.equal(made.doc.name, 'Sugar');
  assert.equal(made.doc.stock, 2000, 'a new ingredient may start with some stock');

  const edited = await admin.put('ingredients', { ...made.doc, stock: 999999, cost: 0.003, name: 'White sugar' });
  assert.equal(edited.status, 'ok');
  assert.equal(edited.doc.stock, 2000, 'editing cannot change the stock');
  assert.equal(edited.doc.cost, 0.003);
  assert.equal((await admin.put('ingredients', { id: 'i_bad', name: '', unit: 'g' })).status, 'error');
  assert.equal((await admin.put('ingredients', { id: 'i_bad', name: 'Salt', unit: 'g', cost: -1 })).status, 'error');
  assert.equal((await admin.put('ingredients', { id: 'i_bad', name: 'Salt', unit: 'g', stock: -5 })).status, 'error');

  const beans = admin.find('ingredients', i => i.name === 'Coffee beans')[0];
  const res = await call('/api/sync', { token: admin.token, method: 'POST', body: { changes: [{ col: 'ingredients', id: beans.id, base: admin.vers['ingredients/' + beans.id], deleted: true }] } });
  assert.equal(res.data.results[0].status, 'error');
  assert.match(res.data.results[0].error, /used in the recipe of/);

  const del = await call('/api/sync', { token: admin.token, method: 'POST', body: { changes: [{ col: 'ingredients', id: 'i_sugar', base: admin.vers['ingredients/i_sugar'], deleted: true }] } });
  assert.equal(del.data.results[0].status, 'ok', 'an unused ingredient can be deleted');
});

test('a purchase adds stock and moves the cost to the weighted average; voiding takes the stock back', async () => {
  const admin = await login('Admin', '1234');
  const cashier = await login('Maya', '1111');
  const before = ing('Tea leaves');                         // 1000 g at 0.05 (less anything sold earlier)
  const purchase = (extra = {}) => ({
    id: 'pu_' + Math.random().toString(36).slice(2), supplier: '  Green Valley  ', note: 'weekly order',
    lines: [{ ingredientId: before.id, qty: 1000, total: 70 }], ...extra,
  });

  assert.equal((await cashier.put('purchases', purchase())).status, 'error', 'cashiers cannot receive stock');
  for (const bad of [
    purchase({ lines: [] }),
    purchase({ lines: [{ ingredientId: 'nope', qty: 5, total: 1 }] }),
    purchase({ lines: [{ ingredientId: before.id, qty: 0, total: 1 }] }),
    purchase({ lines: [{ ingredientId: before.id, qty: 5, total: -1 }] }),
  ]) assert.equal((await admin.put('purchases', bad)).status, 'error');
  assert.equal(ing('Tea leaves').stock, before.stock, 'rejected purchases change nothing');

  const got = await admin.put('purchases', purchase());
  assert.equal(got.status, 'ok', got.error);
  assert.equal(got.doc.supplier, 'Green Valley');
  assert.equal(got.doc.total, 70);
  assert.equal(got.doc.status, 'received');
  assert.equal(got.doc.lines[0].unitCost, 0.07);
  assert.equal(got.doc.by, admin.user.id);
  const after = ing('Tea leaves');
  assert.equal(after.stock, before.stock + 1000);
  const expected = Math.round(((before.stock * before.cost + 1000 * 0.07) / (before.stock + 1000)) * 10000) / 10000;
  assert.equal(after.cost, expected, 'weighted average of what was in stock and what was bought');

  // It cannot be edited, deleted, or voided by a cashier; a manager can void it.
  assert.equal((await admin.put('purchases', { ...got.doc, note: 'changed' })).status, 'error');
  const del = await call('/api/sync', { token: admin.token, method: 'POST', body: { changes: [{ col: 'purchases', id: got.doc.id, base: admin.vers['purchases/' + got.doc.id], deleted: true }] } });
  assert.equal(del.data.results[0].status, 'error');
  await cashier.load();
  assert.notEqual((await cashier.put('purchases', { ...got.doc, status: 'void' })).status, 'ok', 'cashiers cannot void it (they cannot even see it)');
  const voided = await admin.put('purchases', { ...got.doc, status: 'void' });
  assert.equal(voided.status, 'ok', voided.error);
  assert.equal(ing('Tea leaves').stock, before.stock, 'the stock is taken back out');
  assert.equal(ing('Tea leaves').cost, expected, 'the average cost stays');
  assert.equal((await admin.put('purchases', { ...voided.doc, status: 'void' })).status, 'error', 'cannot void twice');
});

test('a stocktake sets the stock to what was counted and records the difference and its value', async () => {
  const admin = await login('Admin', '1234');
  const cashier = await login('Maya', '1111');
  const milk = ing('Milk');
  const toast = app.db.all('products').find(p => p.name === 'Avocado Toast');
  const take = (lines, extra = {}) => ({ id: 'st_' + Math.random().toString(36).slice(2), note: 'end of week', lines, ...extra });

  assert.equal((await cashier.put('stocktakes', take([{ kind: 'ingredient', refId: milk.id, counted: 10 }]))).status, 'error');
  assert.equal((await admin.put('stocktakes', take([]))).status, 'error');
  assert.equal((await admin.put('stocktakes', take([{ kind: 'ingredient', refId: 'nope', counted: 1 }]))).status, 'error');
  assert.equal((await admin.put('stocktakes', take([{ kind: 'ingredient', refId: milk.id, counted: -1 }]))).status, 'error');
  assert.equal((await admin.put('stocktakes', take([{ kind: 'ingredient', refId: milk.id, counted: 1 }, { kind: 'ingredient', refId: milk.id, counted: 2 }]))).status, 'error');
  assert.equal(ing('Milk').stock, milk.stock, 'rejected counts change nothing');

  const counted = milk.stock - 1500;
  const res = await admin.put('stocktakes', take([
    { kind: 'ingredient', refId: milk.id, counted, expected: 123456 },       // an "expected" sent by the device is ignored
    { kind: 'product', refId: toast.id, counted: toast.stock - 2 },
  ]));
  assert.equal(res.status, 'ok', res.error);
  const [a, b] = res.doc.lines;
  assert.deepEqual([a.expected, a.counted, a.diff], [milk.stock, counted, -1500]);
  assert.equal(a.value, Math.round(-1500 * milk.cost * 100) / 100, 'value of the loss at the ingredient cost');
  assert.deepEqual([b.name, b.diff, b.value], ['Avocado Toast', -2, 0]);
  assert.equal(res.doc.value, a.value);
  assert.equal(ing('Milk').stock, counted);
  assert.equal(app.db.all('products').find(p => p.id === toast.id).stock, toast.stock - 2);
  assert.equal((await admin.put('stocktakes', { ...res.doc, note: 'edited' })).status, 'error', 'a stocktake is a record: it cannot be changed');

  // The activity log has it.
  const { rows } = (await call('/api/audit', { token: admin.token })).data;
  assert.match(rows.find(r => r.action === 'stocktake').detail, /2 item\(s\) counted/);
  assert.ok(rows.find(r => r.action === 'purchase received'));
});

test('an option can use extra ingredients: an extra shot uses more beans, and the dish costs more', async () => {
  const admin = await login('Admin', '1234');
  const cashier = await login('Maya', '1111');
  const latte = admin.find('products', p => p.name === 'Latte')[0];
  const beans = ing('Coffee beans'), milk = ing('Milk');
  const setOptions = options => admin.put('products', { ...admin.doc('products', latte.id), options });

  for (const bad of [
    [{ name: 'Shot', price: 0.5, uses: [{ ingredientId: 'nope', qty: 9 }] }],
    [{ name: 'Shot', price: 0.5, uses: [{ ingredientId: beans.id, qty: 0 }] }],
    [{ name: 'Shot', price: 0.5, uses: [{ ingredientId: beans.id, qty: 9 }, { ingredientId: beans.id, qty: 3 }] }],
    [{ name: 'Shot', price: 0.5, uses: Array.from({ length: 7 }, () => ({ ingredientId: beans.id, qty: 1 })) }],
    [{ name: 'Shot', price: 0.5, uses: [{ ingredientId: { a: 1 }, qty: 9 }] }],
  ]) assert.equal((await setOptions(bad)).status, 'error', JSON.stringify(bad).slice(0, 70));
  const ok = await setOptions([{ name: 'Extra shot', price: 0.5, uses: [{ ingredientId: beans.id, qty: 9 }] }, { name: 'Large', price: 1 }]);
  assert.equal(ok.status, 'ok', ok.error);
  assert.deepEqual(ok.doc.options[0].uses, [{ ingredientId: beans.id, qty: 9 }]);
  assert.equal(ok.doc.options[1].uses, undefined, 'an option with no ingredients stays plain');

  await cashier.load();
  const l = line(cashier, 'Latte', 2);
  const withShot = { ...l, mods: [{ name: 'Extra shot', price: 0.5 }, { name: 'Large', price: 1 }], price: 5.5 };
  const o = (await cashier.put('orders', order(cashier, [withShot]))).doc;
  const beansBefore = ing('Coffee beans').stock, milkBefore = ing('Milk').stock;
  const paid = await pay(cashier, o, 11.77);        // 2 × 5.50 = 11.00 + 7%
  assert.equal(paid.status, 'ok', paid.error);
  assert.equal(ing('Coffee beans').stock, beansBefore - 54, '2 × (18 + 9) g');
  assert.equal(ing('Milk').stock, milkBefore - 440);
  const stored = app.db.doc('orders', o.id).items[0];
  assert.equal(stored.cost, 1.344, '27 g × 0.04 + 220 ml × 0.0012 per cup');
  assert.deepEqual(stored.used.map(u => u.qty).sort((a, b) => a - b), [54, 440]);

  // A plain latte on another bill still uses the recipe only, and a refund returns exactly what each bill used.
  const plain = (await cashier.put('orders', order(cashier, [line(cashier, 'Latte', 1)]))).doc;
  assert.equal((await pay(cashier, plain, 4.28)).status, 'ok');
  assert.equal(ing('Coffee beans').stock, beansBefore - 54 - 18);
  await call('/api/verify-pin', { token: cashier.token, method: 'POST', body: { pin: '1234' } });
  assert.equal((await cashier.put('orders', { ...cashier.doc('orders', o.id), status: 'refunded', refundedBy: admin.user.id })).status, 'ok');
  assert.equal(ing('Coffee beans').stock, beansBefore - 18, 'only the first bill is put back');
  assert.equal(ing('Milk').stock, milkBefore - 220);
  await setOptions([{ name: 'Extra shot', price: 0.5 }, { name: 'Large', price: 1 }]); // back as the other tests expect
  assert.ok(milk);
});
