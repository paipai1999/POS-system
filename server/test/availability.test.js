'use strict';

// What happens when an ingredient runs out: nothing, a warning, or stop selling. Run with:  node --test server/test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start } = require('../server.js');
const { lacksOf, ingredientNeeds, ingredientStockMode } = require('../../js/shared.js');

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
const prod = name => app.db.all('products').find(p => p.name === name);
const line = (dev, name, qty) => {
  const p = dev.find('products', x => x.name === name)[0];
  return { id: 'l_' + Math.random().toString(36).slice(2), productId: p.id, name: p.name, price: p.price, qty, note: '', sentQty: 0 };
};
const order = (dev, items) => ({
  id: 'o_' + Math.random().toString(36).slice(2), number: null, tableId: null, tableName: '', staffId: dev.user.id,
  status: 'open', note: '', discount: null, createdAt: Date.now(), items,
});
// Open bills hold ingredients, so each test that counts on room starts with none open.
const clearOpenBills = () => {
  for (const r of app.db.where('orders', "json_extract(data, '$.status') = 'open'")) app.db.put('orders', r.id, null, true);
};
const setMode = async (admin, mode) => {
  await admin.load();
  const r = await admin.put('settings', { ...admin.doc('settings', 'main'), ingredientStock: mode }, 'main');
  assert.equal(r.status, 'ok', r.error);
};
// Sets an ingredient's stock the proper way: a stocktake.
const countStock = async (admin, name, counted) => {
  const r = await admin.put('stocktakes', { id: 'st_' + Math.random().toString(36).slice(2), lines: [{ kind: 'ingredient', refId: ing(name).id, counted }] });
  assert.equal(r.status, 'ok', r.error);
};

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-avail-'));
  app = start({ port: 0, dataDir, quiet: true });
  await new Promise(r => app.server.once('listening', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

test.after(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('the pure rules', () => {
  assert.equal(ingredientStockMode({}), 'off');
  assert.equal(ingredientStockMode({ ingredientStock: 'block' }), 'block');
  assert.equal(ingredientStockMode({ ingredientStock: 'sideways' }), 'off');
  const milk = { id: 'm', name: 'Milk', stock: 100 };
  const getter = id => (id === 'm' ? milk : null);
  const latte = { recipe: [{ ingredientId: 'm', qty: 220 }, { ingredientId: 'gone', qty: 5 }] };
  assert.deepEqual(lacksOf(latte, getter), ['Milk']);
  milk.stock = 220;
  assert.deepEqual(lacksOf(latte, getter), [], 'exactly one portion is enough');
  milk.watch = false; milk.stock = 0;
  assert.deepEqual(lacksOf(latte, getter), [], 'an ingredient that is not watched is ignored');
  assert.deepEqual(lacksOf({}, getter), []);
  const needs = ingredientNeeds([{ productId: 'p', qty: 2, mods: [{ name: 'Extra' }] }], () => ({ recipe: [{ ingredientId: 'm', qty: 10 }], options: [{ name: 'Extra', uses: [{ ingredientId: 'm', qty: 5 }] }] }));
  assert.equal(needs.get('m'), 30, '2 × (10 + 5)');
});

test('the server keeps each dish\'s list of missing ingredients up to date, and every role can see it', async () => {
  const admin = await login('Admin', '1234');
  const cashier = await login('Maya', '1111');
  assert.equal(prod('Latte').lacks, undefined);

  await countStock(admin, 'Milk', 100);                       // not enough for a latte (220), a cappuccino (120) or a chai (200)
  for (const name of ['Latte', 'Cappuccino', 'Chai Latte']) assert.deepEqual(prod(name).lacks, ['Milk'], name);
  assert.equal(prod('Espresso').lacks, undefined, 'espresso does not use milk');

  await cashier.load();
  assert.deepEqual(cashier.find('products', p => p.name === 'Latte')[0].lacks, ['Milk'], 'a cashier is told which dish is short, though not sent the ingredients');
  assert.equal(cashier.find('ingredients', () => true).length, 0);

  // A purchase puts it right again, for everyone.
  const purchase = await admin.put('purchases', { id: 'pu_milk', lines: [{ ingredientId: ing('Milk').id, qty: 5000, total: 6 }] });
  assert.equal(purchase.status, 'ok', purchase.error);
  for (const name of ['Latte', 'Cappuccino', 'Chai Latte']) assert.equal(prod(name).lacks, undefined, name);
  const { data } = await call('/api/changes?since=0', { token: cashier.token });
  assert.equal(data.rows.filter(r => r.col === 'products' && r.data.name === 'Latte').pop().data.lacks, undefined);

  // A device cannot set the list itself, and saving a recipe works it out at once.
  await admin.load();
  const latte = admin.doc('products', prod('Latte').id);
  const forged = await admin.put('products', { ...latte, lacks: ['Fake'] });
  assert.equal(forged.status, 'ok');
  assert.equal(forged.doc.lacks, undefined);
  await countStock(admin, 'Milk', 10);
  await admin.load();
  assert.deepEqual(admin.doc('products', latte.id).lacks, ['Milk']);
  const resaved = await admin.put('products', { ...admin.doc('products', latte.id), lacks: [] });
  assert.deepEqual(resaved.doc.lacks, ['Milk'], 'the list is worked out from the stock when the item is saved');
});

test('"warn" never stops a sale', async () => {
  const admin = await login('Admin', '1234');
  const cashier = await login('Maya', '1111');
  await setMode(admin, 'warn');
  await cashier.load();
  const res = await cashier.put('orders', order(cashier, [line(cashier, 'Latte', 3)]));
  assert.equal(res.status, 'ok', res.error);
  assert.ok(prod('Latte').lacks);
});

test('"block" refuses what the ingredients cannot make, counting what other open bills already hold', async () => {
  const admin = await login('Admin', '1234');
  const cashier = await login('Maya', '1111');
  clearOpenBills();
  await setMode(admin, 'block');
  await cashier.load();

  const refused = await cashier.put('orders', order(cashier, [line(cashier, 'Latte', 1)]));       // milk is at 10 ml
  assert.equal(refused.status, 'error');
  assert.match(refused.error, /Not enough Milk for Latte/);
  assert.equal((await cashier.put('orders', order(cashier, [line(cashier, 'Espresso', 1)]))).status, 'ok', 'a dish that does not use milk is fine');

  await countStock(admin, 'Milk', 500);                                                           // two lattes (440 ml), not three
  await cashier.load();
  const a = await cashier.put('orders', order(cashier, [line(cashier, 'Latte', 2)]));
  assert.equal(a.status, 'ok', a.error);
  const b = await cashier.put('orders', order(cashier, [line(cashier, 'Latte', 1)]));
  assert.equal(b.status, 'error', 'the first bill already holds 440 of the 500 ml');
  assert.match(b.error, /Not enough Milk/);
  const more = { ...cashier.doc('orders', a.doc.id) };
  more.items[0].qty = 3;
  assert.equal((await cashier.put('orders', more)).status, 'error', 'adding to an open bill is checked too');
  const fewer = { ...cashier.doc('orders', a.doc.id) };
  fewer.items[0].qty = 1;
  assert.equal((await cashier.put('orders', fewer)).status, 'ok', 'taking items off is always allowed');
  assert.equal((await cashier.put('orders', order(cashier, [line(cashier, 'Latte', 1)]))).status, 'ok', 'now there is room for another');

  // An ingredient that is not watched never blocks.
  await admin.load();
  const milk = admin.doc('ingredients', ing('Milk').id);
  assert.equal((await admin.put('ingredients', { ...milk, watch: false })).status, 'ok');
  await countStock(admin, 'Milk', 0);
  await cashier.load();
  assert.equal((await cashier.put('orders', order(cashier, [line(cashier, 'Latte', 5)]))).status, 'ok');
  assert.equal(prod('Latte').lacks, undefined, 'and a dish is not marked short for it');
  await admin.load();
  assert.equal((await admin.put('ingredients', { ...admin.doc('ingredients', milk.id), watch: true })).status, 'ok');
  assert.deepEqual(prod('Latte').lacks, ['Milk'], 'watching it again marks the dishes straight away');
});

test('an option that uses an ingredient is checked as well', async () => {
  const admin = await login('Admin', '1234');
  const cashier = await login('Maya', '1111');
  clearOpenBills();
  await setMode(admin, 'block');
  await countStock(admin, 'Milk', 5000);
  const beans = ing('Coffee beans');
  await admin.load();
  const espresso = admin.doc('products', prod('Espresso').id);
  assert.equal((await admin.put('products', { ...espresso, options: [{ name: 'Triple', price: 1, uses: [{ ingredientId: beans.id, qty: 30 }] }] })).status, 'ok');
  await countStock(admin, 'Coffee beans', 70);               // a plain espresso needs 18, a triple 48
  await cashier.load();
  const triple = line(cashier, 'Espresso', 1);
  const mk = qty => ({ ...triple, id: 'l_' + Math.random().toString(36).slice(2), qty, mods: [{ name: 'Triple', price: 1 }], price: 3.5 });
  assert.equal((await cashier.put('orders', order(cashier, [mk(1)]))).status, 'ok');
  const two = await cashier.put('orders', order(cashier, [mk(2)]));
  assert.equal(two.status, 'error', '2 × 48 = 96 g, and 48 g is already held by the first bill');
  assert.match(two.error, /Not enough Coffee beans for Espresso/);
});

test('guests see a dish that is short of an ingredient as sold out, and cannot order it', async () => {
  const admin = await login('Admin', '1234');
  await countStock(admin, 'Milk', 10);
  await setMode(admin, 'block');
  const table = admin.find('tables', () => true)[0];
  const guest = (await call('/api/guest/state?table=' + table.guestCode)).data;
  const latte = guest.products.find(p => p.name === 'Latte');
  assert.deepEqual([latte.trackStock, latte.stock], [true, 0], 'sold out');
  assert.ok(guest.products.find(p => p.name === 'Espresso').stock >= 0);
  const sent = await call('/api/guest/request', { method: 'POST', body: { table: table.guestCode, kind: 'order', items: [{ productId: latte.id, qty: 1 }] } });
  assert.equal(sent.status, 400);
  assert.match(sent.data.error, /sold out/);
  assert.ok(!JSON.stringify(guest).includes('lacks'), 'the guest menu does not carry the internal list');

  await setMode(admin, 'warn');
  const open = (await call('/api/guest/state?table=' + table.guestCode)).data.products.find(p => p.name === 'Latte');
  assert.equal(open.trackStock, false, 'with only warnings on, guests may still order');
});

test('the setting is saved cleanly and logged', async () => {
  const admin = await login('Admin', '1234');
  await admin.load();
  const odd = await admin.put('settings', { ...admin.doc('settings', 'main'), ingredientStock: 'sideways' }, 'main');
  assert.equal(odd.doc.ingredientStock, 'off', 'anything unknown means off');
  await setMode(admin, 'block');
  const { rows } = (await call('/api/audit', { token: admin.token })).data;
  assert.match(rows.find(r => r.action === 'settings changed' && /ingredientStock off → block/.test(r.detail)).detail, /ingredientStock/);
});
