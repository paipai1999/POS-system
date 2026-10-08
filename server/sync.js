'use strict';

// Business rules the server enforces on every change sent by a device: permissions, version checks,
// order numbering, stock movements and guest requests.
const { ROLES, COLLECTIONS, uid, guestCode, round2, computeTotals } = require('../js/shared.js');
const { hashPin, pinMatches, hasPin } = require('./pins.js');

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

// Removes what `user` may not see. With `tombstone`, an order that is no longer visible (e.g. a colleague's
// table that was just paid) is sent as a deletion so the device drops its stale copy instead of showing it open forever.
function rowsFor(user, rows, { tombstone = false } = {}) {
  if (!user) return [];
  const out = [];
  for (const row of rows) {
    if (row.col !== 'orders' || row.deleted || !row.data || canSeeOrder(user, row.data)) out.push(row);
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

// Mirrors Store.payOrder/refundOrder in local mode: remember what was taken so a refund returns exactly that.
function takeStock(db, items, changed) {
  for (const l of items) {
    const row = db.get('products', l.productId);
    const p = row && !row.deleted ? row.data : null;
    if (!p || !p.trackStock) continue;
    l.stockTaken = Math.min(p.stock, l.qty);
    p.stock -= l.stockTaken;
    changed.push(db.put('products', p.id, p));
  }
}

function returnStock(db, items, changed) {
  for (const l of items) {
    const row = db.get('products', l.productId);
    const p = row && !row.deleted ? row.data : null;
    if (!p || !p.trackStock) continue;
    p.stock += l.stockTaken ?? l.qty;
    changed.push(db.put('products', p.id, p));
  }
}

function cleanItems(items) {
  if (!Array.isArray(items) || items.length > 200) reject('Invalid order items');
  for (const l of items) {
    if (!isObj(l) || !Number.isInteger(l.qty) || l.qty < 1 || l.qty > 999 || typeof l.price !== 'number' || l.price < 0) {
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
      if (l.price !== old.price || l.productId !== old.productId) reject(`The price of ${old.name} cannot be changed`);
      continue;
    }
    const p = typeof l.productId === 'string' ? db.doc('products', l.productId) : null;
    if (!p) reject(`${l.name || 'An item'} is no longer on the menu`);
    if (l.price !== p.price) reject(`The price of ${p.name} has changed. Please add it again.`);
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

// Recalculates the bill from the server's own prices, tax and discount. The device's figures must agree,
// and what is stored is the server's version.
function settlePayment(db, data) {
  const t = computeTotals(data, db.doc('settings', 'main'));
  if (isObj(data.totals) && Math.abs(Number(data.totals.total) - t.total) > 0.005) {
    reject('The total no longer matches the current prices or tax. Please reopen the order and pay again.');
  }
  data.totals = t;
  const pay = isObj(data.payment) ? data.payment : {};
  if (!['cash', 'card', 'other'].includes(pay.method)) reject('Invalid payment method');
  const payment = { method: pay.method, amount: t.total };
  if (pay.method === 'cash') {
    const tendered = round2(Number(pay.tendered));
    if (!(tendered >= t.total)) reject('Cash received is less than the total');
    payment.tendered = tendered;
    payment.change = round2(tendered - t.total);
  }
  data.payment = payment;
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
    needApproval(db, ctx, d.by);
  }

  if (data.status === 'paid') {
    need(user, 'checkout');
    if (!data.items.length) reject('Cannot pay an empty order');
    settlePayment(db, data);
    data.cashierId = user.id;
    data.paidAt = Date.now();
    takeStock(db, data.items, changed);
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
      return deleted ? null : data;
    case 'orders':
      return prepareOrder(db, ctx, id, prev, data, deleted, changed);
    case 'guestRequests':
      need(ctx.user, 'guest');
      return deleted ? null : data;
    case 'kitchenTickets':
      if (!can(ctx.user, 'tables') && !can(ctx.user, 'kitchen')) reject('You do not have permission to do that');
      return deleted ? null : data;
    case 'printJobs':
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
    settings: { name: settings.name, currency: settings.currency, taxRate: settings.taxRate, serviceRate: settings.serviceRate },
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

module.exports = { applyChanges, guestState, createGuestRequest, tableByCode, publicRow, stripUser, can, rowsFor, Rejection };
