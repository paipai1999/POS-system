'use strict';

// Guests choosing priced options (extra shot, oat milk…) from the table QR menu. Run with:  node --test server/test
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./support.js');

async function setup() {
  const t = await boot();
  const admin = await t.login('Admin', '1234');
  const latte = admin.all('products').find(p => p.name === 'Latte');
  const espresso = admin.all('products').find(p => p.name === 'Espresso');
  const ing = admin.all('ingredients')[0];
  // Latte offers two options; the oat milk one also uses up an ingredient (which a guest must never see).
  const r = await admin.put('products', {
    ...latte,
    options: [{ name: 'Extra shot', price: 0.5 }, { name: 'Oat milk', price: 0.7, ...(ing ? { uses: [{ ingredientId: ing.id, qty: 5 }] } : {}) }],
  });
  assert.equal(r.status, 'ok', r.error);
  const table = admin.all('tables')[0];
  const guest = {
    state: () => t.call('/api/guest/state?table=' + table.guestCode),
    request: body => t.call('/api/guest/request', { method: 'POST', body: { table: table.guestCode, kind: 'order', ...body } }),
  };
  return { t, admin, latte, espresso, table, guest };
}

test('the guest menu offers each dish\'s options with their prices, and nothing behind them', async () => {
  const { t, guest, latte, espresso } = await setup();
  try {
    const { data } = await guest.state();
    const l = data.products.find(p => p.id === latte.id);
    assert.deepEqual(l.options, [{ name: 'Extra shot', price: 0.5 }, { name: 'Oat milk', price: 0.7 }]);
    assert.ok(!JSON.stringify(data).includes('ingredientId'), 'no ingredient details reach a guest');
    assert.deepEqual(data.products.find(p => p.id === espresso.id).options, [], 'a dish with no options has an empty list');
  } finally { await t.stop(); }
});

test('an order with options is stored with the menu\'s prices', async () => {
  const { t, guest, latte } = await setup();
  try {
    const r = await guest.request({ items: [{ productId: latte.id, qty: 2, mods: ['Extra shot', 'Oat milk'] }] });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const saved = t.app.db.all('guestRequests')[0];
    assert.equal(saved.items[0].price, Math.round((latte.price + 0.5 + 0.7) * 100) / 100, 'the line price includes the options');
    assert.deepEqual(saved.items[0].mods, [{ name: 'Extra shot', price: 0.5 }, { name: 'Oat milk', price: 0.7 }]);
    assert.equal(saved.items[0].qty, 2);
  } finally { await t.stop(); }
});

test('a guest cannot choose their own price, or an option the dish does not have', async () => {
  const { t, guest, latte, espresso } = await setup();
  try {
    // A price sent along is ignored: only names count, and prices come from the menu.
    let r = await guest.request({ items: [{ productId: latte.id, qty: 1, mods: [{ name: 'Extra shot', price: 0 }], price: 0.01 }] });
    assert.equal(r.status, 200);
    assert.equal(t.app.db.all('guestRequests')[0].items[0].mods[0].price, 0.5);
    assert.equal(t.app.db.all('guestRequests')[0].items[0].price, latte.price + 0.5);
    t.app.db.all('guestRequests').forEach(q => t.app.db.put('guestRequests', q.id, { ...q, status: 'rejected' }));

    for (const [mods, productId] of [[['Free coffee'], latte.id], [['Extra shot', 'Extra shot'], latte.id], [['Extra shot'], espresso.id], ['Extra shot', latte.id], [Array(9).fill('Extra shot'), latte.id], [[null], latte.id]]) {
      t.app.db.all('guestRequests').filter(q => q.status === 'pending').forEach(q => t.app.db.put('guestRequests', q.id, { ...q, status: 'rejected' }));
      // (the table's five-second pause between requests does not apply while testing a refusal)
      for (const q of t.app.db.all('guestRequests')) t.app.db.put('guestRequests', q.id, { ...q, createdAt: Date.now() - 10000 });
      r = await guest.request({ items: [{ productId, qty: 1, mods }] });
      assert.equal(r.status, 400, JSON.stringify(mods));
      assert.match(r.data.error, /not an option|Invalid options/);
    }
  } finally { await t.stop(); }
});

test('an order without options works exactly as before', async () => {
  const { t, guest, espresso } = await setup();
  try {
    const r = await guest.request({ items: [{ productId: espresso.id, qty: 2 }] });
    assert.equal(r.status, 200);
    const saved = t.app.db.all('guestRequests')[0];
    assert.equal(saved.items[0].price, espresso.price);
    assert.equal(saved.items[0].mods, undefined);
  } finally { await t.stop(); }
});
