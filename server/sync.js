'use strict';

// Business rules the server enforces on every change sent by a device: permissions, version checks,
// order numbering, stock movements and guest requests.
const { ROLES, COLLECTIONS, uid, guestCode, roundTo, decimalsOf, computeTotals, computeShift, lineUnitPrice, settleOrder, takeStockLines, returnStockLines,
  round4, recipeOf, consumeIngredients, restoreIngredients, receivePurchase, voidPurchase, applyStocktake,
  loyaltyOf, maxRedeemable, applyLoyalty, reverseLoyalty } = require('../js/shared.js');
const { hashPin, pinMatches, hasPin } = require('./pins.js');
const { describe } = require('./audit.js');

class Rejection extends Error {}
const reject = msg => { throw new Rejection(msg); };

function can(user, perm) {
  return !!user && user.active && !!ROLES[user.role] && ROLES[user.role].perms.includes(perm);
}

function need(user, perm) {
  if (!can(user, perm)) reject('You do not have permission to do that');
}

function stripUser(u) {
  if (!u) return u;
  const { pin, pinHash, ...rest } = u;
  return rest;
}

// Rows leave the server without PINs.
function publicRow(row) {
  return row.col === 'users' && row.data ? { ...row, data: stripUser(row.data) } : row;
}

// Cashiers, managers and admins see every order. Waiters see open orders (they need the table map)
// and the orders they took themselves, but not other people's takings.
function canSeeOrder(user, order) {
  if (can(user, 'checkout') || can(user, 'reports')) return true;
  return order.status === 'open' || order.staffId === user.id;
}

// The kitchen display only needs the tickets (they carry the order number and table name), staff names and settings.
const KITCHEN_ONLY = new Set(['settings', 'users', 'kitchenTickets']);
const isKitchenOnly = user => !can(user, 'tables') && !can(user, 'checkout') && !can(user, 'orders') && !can(user, 'products');

// Costs and purchases are for managers; customer details are for whoever takes payments.
const COST_COLS = new Set(['ingredients', 'purchases', 'stocktakes']);

// A line's cost and the ingredients used (written at payment) show how much a dish costs: managers only.
function withoutCosts(order) {
  return { ...order, items: order.items.map(({ cost, used, ...line }) => line) };
}

// Removes what `user` may not see. With `tombstone`, an order that is no longer visible (e.g. a colleague's
// table that was just paid) is sent as a deletion so the device drops its stale copy instead of showing it open forever.
function rowsFor(user, rows, { tombstone = false } = {}) {
  if (!user) return [];
  if (isKitchenOnly(user)) rows = rows.filter(r => KITCHEN_ONLY.has(r.col));
  const out = [];
  for (const row of rows) {
    if (row.col === 'shifts' && !(can(user, 'checkout') || can(user, 'reports'))) continue;
    if (COST_COLS.has(row.col) && !can(user, 'products')) continue;
    if (row.col === 'products' && row.data && row.data.recipe && !can(user, 'products')) {
      const { recipe, ...product } = row.data; // recipes show what a dish costs to make: managers only
      out.push({ ...row, data: product });
      continue;
    }
    if (row.col === 'customers' && !(can(user, 'checkout') || can(user, 'products'))) continue;
    if (row.col !== 'orders' || row.deleted || !row.data) out.push(row);
    else if (canSeeOrder(user, row.data)) out.push(can(user, 'products') ? row : { ...row, data: withoutCosts(row.data) });
    else if (tombstone) out.push({ ...row, deleted: true, data: null });
  }
  return out;
}

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const json = v => JSON.stringify(v ?? null);

// ctx = { user, hasApproval(userId) } — hasApproval is true when that manager entered their PIN on this session recently.
function needApproval(db, ctx, approverId) {
  const approver = typeof approverId === 'string' ? db.doc('users', approverId) : null;
  if (!approver || !can(approver, 'manage')) reject('Manager approval required');
  if (approverId !== ctx.user.id && !ctx.hasApproval(approverId)) reject('Manager approval required');
}

function nextOrderNo(db) {
  const n = db.meta('nextOrderNo', 1);
  db.setMeta('nextOrderNo', n + 1);
  return n;
}

// Stock moves use the same rules as single-device mode (shared.js); here each changed product is written back.
function stockProducts(db) {
  const cache = new Map();
  return id => {
    if (!cache.has(id)) {
      const row = db.get('products', id);
      cache.set(id, row && !row.deleted ? row.data : null);
    }
    return cache.get(id);
  };
}

// Look up documents of one collection, reading each from the database once; changed ones are written back with writeBack().
function docCache(db, col) {
  const cache = new Map();
  return id => {
    if (typeof id !== 'string') return null; // ids from a device may be anything
    if (!cache.has(id)) {
      const row = db.get(col, id);
      cache.set(id, row && !row.deleted ? row.data : null);
    }
    return cache.get(id);
  };
}

function writeBack(db, col, docs, changed) {
  for (const d of docs) changed.push(db.put(col, d.id, d));
}

function takeStock(db, items, changed) {
  for (const p of takeStockLines(items, stockProducts(db))) changed.push(db.put('products', p.id, p));
}

function returnStock(db, items, changed) {
  for (const p of returnStockLines(items, stockProducts(db))) changed.push(db.put('products', p.id, p));
}

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
function settlePayment(db, data) {
  const settings = db.doc('settings', 'main');
  const t = computeTotals(data, settings);
  if (isObj(data.totals) && Math.abs(Number(data.totals.total) - t.total) > 0.005) {
    reject('The total no longer matches the current prices or tax. Please reopen the order and pay again.');
  }
  try {
    const settled = settleOrder(data, data.payment, settings);
    data.totals = settled.totals;
    data.payment = settled.payment;
  } catch (e) {
    reject(e.message);
  }
}

// ----- ingredients, purchases, stocktakes -----
const cleanText = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

function prepareIngredient(db, ctx, id, prev, data, deleted) {
  need(ctx.user, 'products');
  if (deleted) {
    const user = db.all('products').find(p => recipeOf(p).some(r => r.ingredientId === id));
    if (user) reject(`${prev.name} is used in the recipe of ${user.name}. Remove it from the recipe first.`);
    return null;
  }
  const name = cleanText(data.name, 60);
  if (!name) reject('Ingredient name is required');
  const cost = round4(Number(data.cost) || 0);
  const low = round4(Number(data.lowStock) || 0);
  if (!(cost >= 0) || !(low >= 0)) reject('Cost and low-stock level cannot be negative');
  // Stock moves only through purchases, stocktakes and sales; an edit cannot change it. A new ingredient may start with some.
  const start = round4(Number(data.stock) || 0);
  if (!prev && !(start >= 0)) reject('Starting stock cannot be negative');
  return { id, name, unit: cleanText(data.unit, 10) || 'pcs', cost, lowStock: low, active: data.active !== false, stock: prev ? prev.stock : start };
}

function preparePurchase(db, ctx, id, prev, data, deleted, changed) {
  need(ctx.user, 'products');
  if (deleted) reject('A purchase cannot be deleted. Void it instead.');
  const ings = docCache(db, 'ingredients');
  if (prev) {
    // The only change allowed afterwards is voiding it (by a manager), which takes the stock back out.
    if (prev.status === 'void') reject('This purchase is already void');
    if (data.status !== 'void') reject('A purchase cannot be edited. Void it and enter it again.');
    need(ctx.user, 'manage');
    const out = { ...prev, lines: prev.lines.map(l => ({ ...l })), status: 'void', voidedAt: Date.now(), voidedBy: ctx.user.id };
    writeBack(db, 'ingredients', voidPurchase(out, ings), changed);
    return out;
  }
  const dec = decimalsOf(db.doc('settings', 'main'));
  const raw = Array.isArray(data.lines) ? data.lines : [];
  if (!raw.length || raw.length > 100) reject('Add at least one ingredient to the purchase');
  const lines = raw.map(l => {
    const qty = round4(Number(isObj(l) ? l.qty : 0));
    const total = roundTo(Number(isObj(l) ? l.total : 0), dec);
    if (!isObj(l) || !ings(l.ingredientId)) reject('A purchase line uses an ingredient that does not exist'); // ings() is null for non-strings
    if (!(qty > 0) || qty > 1e7 || !(total >= 0)) reject('Each purchase line needs an amount above 0 and a price of 0 or more');
    return { ingredientId: l.ingredientId, qty, total };
  });
  const purchase = {
    id, date: Date.now(), supplier: cleanText(data.supplier, 60), note: cleanText(data.note, 300), by: ctx.user.id, status: 'received',
    lines, total: roundTo(lines.reduce((n, l) => n + l.total, 0), dec),
  };
  writeBack(db, 'ingredients', receivePurchase(purchase, ings), changed);
  return purchase;
}

function prepareStocktake(db, ctx, id, prev, data, deleted, changed) {
  need(ctx.user, 'products');
  if (prev || deleted) reject('A stocktake cannot be changed afterwards');
  const dec = decimalsOf(db.doc('settings', 'main'));
  const raw = Array.isArray(data.lines) ? data.lines : [];
  if (!raw.length || raw.length > 500) reject('Count at least one item');
  const seen = new Set();
  const lines = raw.map(l => {
    const kind = isObj(l) && l.kind === 'product' ? 'product' : 'ingredient';
    const counted = round4(Number(isObj(l) ? l.counted : NaN));
    const key = kind + ':' + (isObj(l) ? l.refId : '');
    if (!isObj(l) || typeof l.refId !== 'string' || seen.has(key) || !db.doc(kind === 'product' ? 'products' : 'ingredients', l.refId)) reject('A stocktake line uses an item that does not exist');
    seen.add(key);
    if (!(counted >= 0)) reject('Counted amounts cannot be negative');
    return { kind, refId: l.refId, counted };
  });
  const stocktake = { id, date: Date.now(), by: ctx.user.id, note: cleanText(data.note, 300), lines };
  const { changed: touched, value } = applyStocktake(stocktake, docCache(db, 'ingredients'), docCache(db, 'products'), dec);
  stocktake.value = value;
  for (const d of touched) changed.push(db.put(d.recipe !== undefined || d.trackStock !== undefined ? 'products' : 'ingredients', d.id, d));
  return stocktake;
}

// ----- customers -----
function prepareCustomer(db, ctx, id, prev, data, deleted) {
  need(ctx.user, 'checkout');
  const dec = decimalsOf(db.doc('settings', 'main'));
  if (deleted) {
    need(ctx.user, 'manage');
    if (db.where('orders', "json_extract(data, '$.customerId') = ?", id).length) reject('This customer has bills. Deactivate them instead so reports stay accurate.');
    return null;
  }
  const name = cleanText(data.name, 60);
  if (!name) reject('Customer name is required');
  const phone = cleanText(data.phone, 30);
  if (phone && !/^[0-9+\-() ]{3,30}$/.test(phone)) reject('Enter the phone number with digits only');
  const digits = phone.replace(/\D/g, '');
  if (digits && db.all('customers').some(c => c.id !== id && String(c.phone || '').replace(/\D/g, '') === digits)) reject('A customer with that phone number already exists');
  const manager = can(ctx.user, 'manage');
  const wantDiscount = roundTo(Number(data.discountPercent) || 0, 2);
  if (!(wantDiscount >= 0 && wantDiscount <= 100)) reject('The discount must be between 0 and 100');
  const wantPoints = roundTo(Number(data.points) || 0, dec);
  if (!(wantPoints >= 0)) reject('Points cannot be negative');
  if (!manager && ((prev ? prev.discountPercent || 0 : 0) !== wantDiscount || (prev ? prev.points || 0 : 0) !== wantPoints)) {
    reject('Only a manager can change a customer\'s points or discount');
  }
  // spent / visits / last visit are kept by the server and never taken from a device.
  return {
    id, name, phone, note: cleanText(data.note, 200), active: data.active !== false,
    discountPercent: wantDiscount, points: wantPoints,
    spent: prev ? prev.spent || 0 : 0, visits: prev ? prev.visits || 0 : 0, lastVisit: prev ? prev.lastVisit || null : null,
    createdAt: prev ? prev.createdAt : Date.now(),
  };
}

// ----- cash drawer shifts -----
function prepareShift(db, ctx, id, prev, data, deleted) {
  need(ctx.user, 'checkout');
  if (deleted) reject('A shift record cannot be deleted');
  const dec = decimalsOf(db.doc('settings', 'main'));
  if (!prev) {
    const float = roundTo(Number(data.openingFloat), dec);
    if (!(float >= 0)) reject('Enter the cash in the drawer to start the shift');
    if (db.where('shifts', "json_extract(data, '$.closedAt') IS NULL").length) reject('A shift is already open');
    return { id, openedAt: Date.now(), openedBy: ctx.user.id, openingFloat: float, closedAt: null };
  }
  if (prev.closedAt) reject('This shift is already closed');
  // Closing: the server works out what the drawer should hold; the counted cash is the only figure taken from the device.
  const counted = roundTo(Number(data.countedCash), dec);
  if (!(counted >= 0)) reject('Enter the cash you counted');
  const now = Date.now();
  const orders = db.where('orders', "json_extract(data, '$.paidAt') >= ? OR json_extract(data, '$.refundedAt') >= ?", prev.openedAt, prev.openedAt).map(r => r.data);
  const sums = computeShift({ ...prev, closedAt: now }, orders, dec);
  return {
    ...prev, closedAt: now, closedBy: ctx.user.id, countedCash: counted,
    expectedCash: sums.expected, difference: roundTo(counted - sums.expected, dec),
    cashIn: sums.cashIn, cashOut: sums.cashOut, tips: sums.tips, sales: sums.sales, orders: sums.orders,
    note: String(data.note || '').trim().slice(0, 300),
  };
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
      const c = out.loyalty && db.doc('customers', out.loyalty.customerId);
      if (c) {
        reverseLoyalty(out, c, db.doc('settings', 'main'));
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
  if (data.status === 'open') checkStock(db, prev, data);

  if (data.discount && json(data.discount) !== json(prev && prev.discount)) {
    const d = data.discount;
    if (!isObj(d) || !(d.value > 0) || !['percent', 'amount'].includes(d.type) || (d.type === 'percent' && d.value > 100)) {
      reject('Invalid discount');
    }
    if (d.customerId) {
      // A customer's own discount (set by a manager on their card) needs no one to approve it again.
      const c = typeof d.customerId === 'string' ? db.doc('customers', d.customerId) : null;
      if (!c || d.type !== 'percent' || d.value !== c.discountPercent || data.customerId !== d.customerId) reject('Invalid customer discount');
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

function prepareUser(db, ctx, id, prev, data, deleted) {
  need(ctx.user, 'users');
  const others = db.all('users').filter(u => u.id !== id);
  if (deleted) {
    if (id === ctx.user.id) reject('You cannot delete yourself');
    if (!others.some(u => u.role === 'admin' && u.active)) reject('At least one active admin is required');
    const used = db.where('orders', "json_extract(data, '$.staffId') = ? OR json_extract(data, '$.cashierId') = ?", id, id);
    if (used.length) reject('This person has order history. Deactivate them instead so reports stay accurate.');
    db.deleteUserSessions(id);
    return null;
  }
  if (typeof data.name !== 'string' || !data.name.trim()) reject('Name is required');
  if (!ROLES[data.role]) reject('Invalid role');
  data.active = !!data.active;
  // A device can only ever send digits; the stored hash is never taken from the request.
  const newPin = data.pin ? String(data.pin) : '';
  delete data.pin;
  delete data.pinHash;
  if (newPin) {
    if (!/^\d{4,6}$/.test(newPin)) reject('PIN must be 4–6 digits');
    if (others.some(u => pinMatches(u, newPin))) reject('That PIN is already used by someone else');
    data.pinHash = hashPin(newPin);
  } else if (hasPin(prev)) {
    data.pinHash = typeof prev.pinHash === 'string' ? prev.pinHash : hashPin(prev.pin);
  } else {
    reject('Set a PIN');
  }
  if (!others.some(u => u.role === 'admin' && u.active) && !(data.role === 'admin' && data.active)) {
    reject('At least one active admin is required');
  }
  if (id === ctx.user.id && !data.active) reject('You cannot deactivate yourself');
  if (!data.active) db.deleteUserSessions(id);
  return data;
}

function prepare(db, ctx, col, id, prev, data, deleted, changed) {
  if (!deleted) {
    if (!isObj(data)) reject('Invalid data');
    if (col !== 'settings') data.id = id;
  }
  switch (col) {
    case 'settings':
      need(ctx.user, 'settings');
      if (deleted) reject('Settings cannot be deleted');
      delete data.nextOrderNo;
      // Money format: validated here too, because the currency symbol ends up in every page and receipt.
      data.currency = String(data.currency ?? '$').replace(/[<>&"'`]/g, '').trim().slice(0, 4) || '$';
      data.decimals = data.decimals === 0 ? 0 : 2;
      data.currencyAfter = !!data.currencyAfter;
      {
        const l = isObj(data.loyalty) ? data.loyalty : {};
        const pct = (v, d) => { const n = Number(v); return n >= 0 && n <= 100 ? roundTo(n, 2) : d; };
        data.loyalty = { enabled: !!l.enabled, earnPercent: pct(l.earnPercent, 5), maxRedeemPercent: pct(l.maxRedeemPercent, 50) };
      }
      return data;
    case 'tables':
      need(ctx.user, 'settings');
      if (deleted) {
        if (db.where('orders', "json_extract(data, '$.status') = 'open' AND json_extract(data, '$.tableId') = ?", id).length) {
          reject('That table has an open order');
        }
        return null;
      }
      if (typeof data.name !== 'string' || !data.name.trim()) reject('Table name is required');
      data.guestCode = prev && prev.guestCode ? prev.guestCode : guestCode();
      return data;
    case 'users':
      return prepareUser(db, ctx, id, prev, data, deleted);
    case 'categories':
    case 'products':
      need(ctx.user, 'products');
      if (deleted && col === 'categories' && db.where('products', "json_extract(data, '$.categoryId') = ?", id).length) {
        reject('Move or delete the items in this category first');
      }
      if (col === 'products' && !deleted) {
        // Recipe: how much of each ingredient one portion uses.
        const rawRecipe = Array.isArray(data.recipe) ? data.recipe : [];
        if (rawRecipe.length > 20) reject('At most 20 ingredients per recipe');
        const used = new Set();
        data.recipe = rawRecipe.map(r => {
          const qty = isObj(r) ? round4(Number(r.qty)) : 0;
          if (!isObj(r) || typeof r.ingredientId !== 'string' || !db.doc('ingredients', r.ingredientId)) reject('A recipe uses an ingredient that does not exist');
          if (!(qty > 0) || qty > 1e6 || used.has(r.ingredientId)) reject('Each recipe ingredient needs a different ingredient and an amount above 0');
          used.add(r.ingredientId);
          return { ingredientId: r.ingredientId, qty };
        });
        // Priced options ("Extra shot +0.50"): a short list of unique names with non-negative prices.
        const dec = decimalsOf(db.doc('settings', 'main'));
        const raw = Array.isArray(data.options) ? data.options : [];
        if (raw.length > 8) reject('At most 8 options per item');
        const names = new Set();
        data.options = raw.map(o => {
          const name = isObj(o) ? String(o.name ?? '').trim().slice(0, 30) : '';
          const price = isObj(o) ? roundTo(Number(o.price) || 0, dec) : -1;
          if (!name || !(price >= 0) || names.has(name)) reject('Each option needs a different name and a price of 0 or more');
          names.add(name);
          return { name, price };
        });
      }
      return deleted ? null : data;
    case 'orders':
      return prepareOrder(db, ctx, id, prev, data, deleted, changed);
    case 'guestRequests':
      need(ctx.user, 'guest');
      return deleted ? null : data;
    case 'kitchenTickets':
      if (!can(ctx.user, 'tables') && !can(ctx.user, 'kitchen')) reject('You do not have permission to do that');
      return deleted ? null : data;
    case 'ingredients':
      return prepareIngredient(db, ctx, id, prev, data, deleted);
    case 'customers':
      return prepareCustomer(db, ctx, id, prev, data, deleted);
    case 'purchases':
      return preparePurchase(db, ctx, id, prev, data, deleted, changed);
    case 'stocktakes':
      return prepareStocktake(db, ctx, id, prev, data, deleted, changed);
    case 'shifts':
      return prepareShift(db, ctx, id, prev, data, deleted);
    case 'printJobs':
      need(ctx.user, 'tables');
      if (!deleted && typeof data.html !== 'string') reject('Invalid print job');
      return deleted ? null : data;
  }
  reject('Unknown collection');
}

// Applies a batch of changes from one device in a single transaction.
// Each change: { col, id, base (version the device last saw), data | deleted }.
function applyChanges(db, ctx, changes) {
  const changed = [];
  const results = db.tx(() => changes.map(ch => {
    const { col, id } = ch || {};
    const known = (col === 'settings' && id === 'main') || COLLECTIONS.includes(col);
    if (!known || typeof id !== 'string' || !id || id.length > 80) return { col, id, status: 'error', error: 'Invalid change', ver: 0, deleted: true, doc: null };
    const cur = db.get(col, id);
    const live = cur && !cur.deleted ? cur.data : null;
    const reply = (status, error) => ({ col, id, status, error, ver: cur ? cur.ver : 0, deleted: !live, doc: live });
    if ((ch.base || 0) !== (cur ? cur.ver : 0)) return reply('conflict');
    if (ch.deleted && !live) return reply('ok');
    try {
      const data = prepare(db, ctx, col, id, live, ch.deleted ? null : ch.data, !!ch.deleted, changed);
      const row = db.put(col, id, data, !!ch.deleted);
      changed.push(row);
      const nameOf = uid => (typeof uid === 'string' && (db.doc('users', uid) || {}).name) || null;
      for (const e of describe(col, live, ch.deleted ? null : data, !!ch.deleted, nameOf)) db.addAudit({ user: ctx.user, ...e });
      return { col, id, status: 'ok', ver: row.ver, deleted: row.deleted, doc: row.data };
    } catch (e) {
      if (e instanceof Rejection) return reply('error', e.message);
      throw e;
    }
  }));
  return { results, changed };
}

// ----- Guests (no sign-in) -----

function tableByCode(db, code) {
  if (typeof code !== 'string' || !code) return null;
  return db.where('tables', "json_extract(data, '$.guestCode') = ?", code)[0]?.data || null;
}

// Menu plus this table's own order and requests. Stock is adjusted so the guest app's
// "available = stock − items on this table's order" works out to what is really left.
function guestState(db, code) {
  const table = tableByCode(db, code);
  if (!table) reject('This table link is not valid. Please ask a member of staff.');
  const settings = db.doc('settings', 'main');
  const open = db.where('orders', "json_extract(data, '$.status') = 'open'").map(r => r.data);
  const mine = open.find(o => o.tableId === table.id);
  const reserved = {}, reservedHere = {};
  for (const o of open) for (const l of o.items) {
    reserved[l.productId] = (reserved[l.productId] || 0) + l.qty;
    if (o === mine) reservedHere[l.productId] = (reservedHere[l.productId] || 0) + l.qty;
  }
  const products = db.all('products').filter(p => p.active).map(p => ({
    id: p.id, name: p.name, categoryId: p.categoryId, price: p.price, emoji: p.emoji, description: p.description,
    active: true, trackStock: p.trackStock, lowStock: p.lowStock,
    stock: p.trackStock ? Math.max(0, p.stock - (reserved[p.id] || 0)) + (reservedHere[p.id] || 0) : 0,
  }));
  return {
    version: 1,
    settings: { name: settings.name, currency: settings.currency, decimals: settings.decimals, currencyAfter: settings.currencyAfter, taxRate: settings.taxRate, serviceRate: settings.serviceRate },
    users: [],
    categories: db.all('categories'),
    products,
    tables: [{ id: table.id, name: table.name, guestCode: table.guestCode }],
    orders: mine ? [{
      id: mine.id, tableId: mine.tableId, status: 'open', discount: mine.discount, createdAt: mine.createdAt,
      items: mine.items.map(l => ({ productId: l.productId, name: l.name, price: l.price, qty: l.qty })),
    }] : [],
    guestRequests: db.where('guestRequests', "json_extract(data, '$.status') = 'pending' AND json_extract(data, '$.tableId') = ?", table.id)
      .map(r => r.data),
    kitchenTickets: [],
    printJobs: [],
  };
}

function createGuestRequest(db, code, body) {
  const table = tableByCode(db, code);
  if (!table) reject('This table link is not valid. Please ask a member of staff.');
  if (!isObj(body)) reject('Invalid request');
  const kind = body.kind === 'call' ? 'call' : 'order';
  const pending = db.where('guestRequests', "json_extract(data, '$.status') = 'pending' AND json_extract(data, '$.tableId') = ?", table.id)
    .map(r => r.data);
  if (pending.length >= 10) reject('Please wait for a waiter to confirm your earlier requests');
  if (pending.some(r => Date.now() - r.createdAt < 5000)) reject('Please wait a moment before sending again');
  if (kind === 'call' && pending.some(r => r.kind === 'call')) reject('A waiter has already been called 👍');

  const items = [];
  if (kind === 'order') {
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > 30) reject('Your order is empty');
    for (const it of body.items) {
      const p = isObj(it) && typeof it.productId === 'string' ? db.doc('products', it.productId) : null;
      const qty = isObj(it) ? Number(it.qty) : 0;
      if (!p || !p.active) reject('Some items are no longer available. Please refresh the menu.');
      if (!Number.isInteger(qty) || qty < 1 || qty > 50) reject('Invalid quantity');
      items.push({ productId: p.id, name: p.name, price: p.price, qty });
    }
  }
  const doc = {
    id: uid('g_'), kind, tableId: table.id, items,
    note: String(body.note || '').trim().slice(0, 300),
    status: 'pending', createdAt: Date.now(),
  };
  return db.put('guestRequests', doc.id, doc);
}

module.exports = { applyChanges, guestState, createGuestRequest, tableByCode, publicRow, stripUser, can, rowsFor, splitOrder, Rejection };
