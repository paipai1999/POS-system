'use strict';

// Bills: item and price checks, stock, payment settlement, customer/loyalty on a bill, and splitting a bill.
const { uid, roundTo, decimalsOf, computeTotals, lineUnitPrice, settleOrder, paymentByMethod, usesOf, ingredientStockMode, ingredientNeeds, consumeIngredients, restoreIngredients, loyaltyOf, customerDiscount, maxRedeemable, applyLoyalty, reverseLoyalty } = require('../../js/shared.js');
const { reject, can, need, isObj } = require('../base.js');
const { docCache, needApproval, nextOrderNo, returnStock, takeStock, writeBack } = require('./helpers.js');

const json = v => JSON.stringify(v ?? null);

function cleanItems(items) {
  if (!Array.isArray(items) || items.length > 200) reject('Invalid order items');
  for (const l of items) {
    if (!isObj(l) || !Number.isInteger(l.qty) || l.qty < 1 || l.qty > 999 || typeof l.price !== 'number' || l.price < 0) {
      reject('Invalid order line');
    }
    if (l.mods !== undefined && (!Array.isArray(l.mods) || l.mods.length > 8 ||
        l.mods.some(m => !isObj(m) || typeof m.name !== 'string' || typeof m.price !== 'number'))) {
      reject('Invalid order line');
    }
  }
}

// Line prices are copied from the menu when an item is added and never change afterwards, so a device
// cannot invent a price: a new line must match the menu, an existing line must keep its price.
function checkLinePrices(db, prev, items) {
  for (const l of items) {
    const old = prev && prev.items.find(x => x.id === l.id);
    if (old) {
      if (l.price !== old.price || l.productId !== old.productId || json(l.mods || []) !== json(old.mods || [])) {
        reject(`The price of ${old.name} cannot be changed`);
      }
      continue;
    }
    const p = typeof l.productId === 'string' ? db.doc('products', l.productId) : null;
    if (!p) reject(`${l.name || 'An item'} is no longer on the menu`);
    // Options (extra shot, large...) must be ones the menu offers, at the menu's price.
    const picked = new Set();
    for (const m of l.mods || []) {
      const offered = (p.options || []).find(o => o.name === m.name);
      if (!offered || offered.price !== m.price || picked.has(m.name)) reject(`"${m.name}" is not an option for ${p.name}`);
      picked.add(m.name);
    }
    if (l.price !== lineUnitPrice(p, l.mods)) reject(`The price of ${p.name} has changed. Please add it again.`);
  }
}

// Items on open orders are reserved (stock is taken at payment), so an order may not claim more than is left.
function checkIngredients(db, prev, data) {
  const mode = ingredientStockMode(db.doc('settings', 'main'));
  if (mode !== 'block') return;
  const products = docCache(db, 'products'), ings = docCache(db, 'ingredients');
  const others = db.where('orders', "json_extract(data, '$.status') = 'open'").map(r => r.data).filter(o => o.id !== data.id);
  const reserved = ingredientNeeds(others.flatMap(o => o.items), products);
  const had = prev ? ingredientNeeds(prev.items, products) : new Map();
  for (const [id, want] of ingredientNeeds(data.items, products)) {
    if (want <= (had.get(id) || 0) + 1e-9) continue; // only additions are checked
    const ing = ings(id);
    if (!ing || ing.watch === false || ing.active === false) continue;
    if ((reserved.get(id) || 0) + want > (ing.stock || 0) + 1e-9) {
      const dish = data.items.find(l => usesOf(products(l.productId), l.mods).some(u => u.ingredientId === id));
      reject(`Not enough ${ing.name}${dish ? ' for ' + dish.name : ''}`);
    }
  }
}

function checkStock(db, prev, data) {
  const sum = (items, pid) => items.filter(l => l.productId === pid).reduce((n, l) => n + l.qty, 0);
  const others = db.where('orders', "json_extract(data, '$.status') = 'open'").map(r => r.data).filter(o => o.id !== data.id);
  for (const pid of new Set(data.items.map(l => l.productId))) {
    const want = sum(data.items, pid);
    if (want <= (prev ? sum(prev.items, pid) : 0)) continue; // only additions are checked
    const p = db.doc('products', pid);
    if (!p || !p.trackStock) continue;
    const reserved = others.reduce((n, o) => n + sum(o.items, pid), 0);
    if (reserved + want > p.stock) reject(`Not enough ${p.name} in stock`);
  }
}

// Recalculates the bill from the server's own prices, tax and discount. The device's figure must agree,
// and what is stored is the server's version (same rules as single-device mode: shared.js settleOrder).
// A bill (or part of it) put on account is checked against the customer's credit limit.
function settlePayment(db, data) {
  const settings = db.doc('settings', 'main');
  const customer = typeof data.customerId === 'string' ? db.doc('customers', data.customerId) : null;
  const t = computeTotals(data, settings);
  if (isObj(data.totals) && Math.abs(Number(data.totals.total) - t.total) > 0.005) {
    reject('The total no longer matches the current prices or tax. Please reopen the order and pay again.');
  }
  try {
    const settled = settleOrder(data, data.payment, settings, customer);
    data.totals = settled.totals;
    data.payment = settled.payment;
  } catch (e) {
    reject(e.message);
  }
}

// Moves some items of an open bill onto a new bill in one step, so items can never be lost or counted twice.
function splitOrder(db, ctx, body) {
  need(ctx.user, 'tables');
  const row = db.get('orders', String((body && body.orderId) || ''));
  const src = row && !row.deleted ? row.data : null;
  if (!src || src.status !== 'open') reject('That bill is not open');
  if ((body.base || 0) !== row.ver) reject('This bill was changed on another device. Please try again.');
  const moves = Array.isArray(body.moves) ? body.moves : [];
  if (!moves.length || moves.length > 100) reject('Choose the items to move');
  const items = src.items.map(l => ({ ...l }));
  const moved = [];
  const seen = new Set();
  for (const mv of moves) {
    const line = isObj(mv) ? items.find(l => l.id === mv.lineId) : null;
    const qty = isObj(mv) ? Number(mv.qty) : 0;
    if (!line || seen.has(line.id) || !Number.isInteger(qty) || qty < 1 || qty > line.qty) reject('Invalid split');
    seen.add(line.id);
    const sent = Math.min(line.sentQty || 0, qty);
    moved.push({ ...line, id: uid('l_'), qty, sentQty: sent });
    line.qty -= qty;
    line.sentQty = Math.max(0, (line.sentQty || 0) - sent);
  }
  const rest = items.filter(l => l.qty > 0);
  if (!rest.length) reject('Leave at least one item on the original bill');
  const table = src.tableId ? db.doc('tables', src.tableId) : null;
  const created = {
    id: uid('o_'), number: nextOrderNo(db), tableId: null, tableName: (table && table.name) || src.tableName || '',
    splitFrom: src.id, staffId: src.staffId, status: 'open', items: moved, note: '', discount: null, createdAt: Date.now(),
  };
  const srcRow = db.put('orders', src.id, { ...src, items: rest });
  const newRow = db.put('orders', created.id, created);
  db.addAudit({ user: ctx.user, action: 'bill split', target: `#${src.number}`, detail: `${moved.reduce((n, l) => n + l.qty, 0)} item(s) moved to #${created.number}` });
  return [srcRow, newRow];
}

// The customer on a bill and the points they spend: only people who take payments may change these, the customer must
// exist, points must be switched on, and the bill may take only a share of it (and no more than the customer has).
function checkCustomer(db, ctx, prev, data) {
  const settings = db.doc('settings', 'main');
  const dec = decimalsOf(settings);
  if (data.customerId !== undefined && data.customerId !== null && typeof data.customerId !== 'string') reject('Invalid customer');
  if (data.discount && data.discount.customerId !== undefined && typeof data.discount.customerId !== 'string') reject('Invalid customer discount');
  const cust = data.customerId ? db.doc('customers', data.customerId) : null;
  if (data.customerId && !cust) reject('That customer no longer exists');
  if (!data.customerId) {
    delete data.customerId;
    if (data.discount && data.discount.customerId) reject('A customer discount needs the customer on the bill');
  } else if (data.discount && data.discount.customerId && data.discount.customerId !== data.customerId) {
    reject('A customer discount needs the customer on the bill');
  }
  const points = roundTo(Number(data.pointsUsed) || 0, dec);
  if (!(points >= 0)) reject('Invalid points');
  if (points > 0) {
    if (!cust) reject('Choose the customer before using points');
    if (!loyaltyOf(settings).enabled) reject('Loyalty points are not switched on');
    const max = maxRedeemable(data, cust, settings);
    if (points > max + 0.005) reject(`At most ${max} points can be used on this bill`);
    data.pointsUsed = points;
  } else {
    delete data.pointsUsed;
  }
  const before = (prev && prev.customerId) || null;
  if (before !== (data.customerId || null) || roundTo(Number(prev && prev.pointsUsed) || 0, dec) !== points) need(ctx.user, 'checkout');
}

function prepareOrder(db, ctx, id, prev, data, deleted, changed) {
  const { user } = ctx;
  need(user, 'tables');
  if (deleted) {
    if (prev && (prev.status !== 'open' || prev.items.some(l => l.sentQty > 0))) reject('Only unsent open orders can be removed');
    return null;
  }
  cleanItems(data.items);

  if (prev && prev.status !== 'open') {
    if (prev.status === 'paid' && data.status === 'refunded') {
      need(user, 'checkout');
      needApproval(db, ctx, data.refundedBy);
      const out = { ...prev, items: prev.items.map(l => ({ ...l })), status: 'refunded', refundedAt: Date.now(), refundedBy: data.refundedBy };
      returnStock(db, out.items, changed);
      writeBack(db, 'ingredients', restoreIngredients(out.items, docCache(db, 'ingredients')), changed);
      // The customer gets their points back and the part that was put on account comes off what they owe.
      const settings = db.doc('settings', 'main');
      const c = out.customerId ? db.doc('customers', out.customerId) : null;
      if (c) {
        if (out.loyalty) reverseLoyalty(out, c, settings);
        const credit = paymentByMethod(out.payment).credit || 0;
        if (credit) c.owing = roundTo((c.owing || 0) - credit, decimalsOf(settings));
        changed.push(db.put('customers', c.id, c));
      }
      return out;
    }
    if (json({ ...data, number: prev.number }) === json(prev)) return prev;
    reject(`Order #${prev.number} is already ${prev.status}`);
  }

  if (!prev && data.status !== 'open' && data.status !== 'paid') reject('New orders must be open');
  // The server owns order numbers; a number is given once the order has items, so abandoned empty orders don't use one up.
  data.number = prev ? prev.number : null;
  if (data.number == null && data.items.length) data.number = nextOrderNo(db);

  checkLinePrices(db, prev, data.items);
  if (data.status === 'open') { checkStock(db, prev, data); checkIngredients(db, prev, data); }

  if (data.discount && json(data.discount) !== json(prev && prev.discount)) {
    const d = data.discount;
    if (!isObj(d) || !(d.value > 0) || !['percent', 'amount'].includes(d.type) || (d.type === 'percent' && d.value > 100)) {
      reject('Invalid discount');
    }
    if (d.customerId) {
      // A customer's own discount (set by a manager on their card) needs no one to approve it again.
      const c = typeof d.customerId === 'string' ? db.doc('customers', d.customerId) : null;
      const owed = c ? customerDiscount(c, db.doc('settings', 'main')).percent : 0;
      if (!c || d.type !== 'percent' || !(owed > 0) || Math.abs(d.value - owed) > 0.005 || data.customerId !== d.customerId) reject('Invalid customer discount');
    } else {
      needApproval(db, ctx, d.by);
    }
  }
  checkCustomer(db, ctx, prev, data);

  if (data.status === 'paid') {
    need(user, 'checkout');
    if (!data.items.length) reject('Cannot pay an empty order');
    settlePayment(db, data);
    data.cashierId = user.id;
    data.paidAt = Date.now();
    takeStock(db, data.items, changed);
    // Ingredients are used up and the dish's cost is written on each line.
    const ing = docCache(db, 'ingredients');
    writeBack(db, 'ingredients', consumeIngredients(data.items, docCache(db, 'products'), ing), changed);
    if (data.customerId) {
      const c = db.doc('customers', data.customerId);
      if (data.totals.points && data.totals.points > (c.points || 0) + 0.005) reject('The customer does not have that many points');
      applyLoyalty(data, c, db.doc('settings', 'main'));
      const credit = paymentByMethod(data.payment).credit || 0;
      if (credit) c.owing = roundTo((c.owing || 0) + credit, decimalsOf(db.doc('settings', 'main')));   // settleOrder checked the limit
      changed.push(db.put('customers', c.id, c));
    } else {
      delete data.loyalty;
    }
  } else if (data.status === 'void') {
    needApproval(db, ctx, data.voidedBy);
  } else if (data.status !== 'open') {
    reject('Invalid order status');
  }
  return data;
}

module.exports = { prepareOrder, splitOrder };
