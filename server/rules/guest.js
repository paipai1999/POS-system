'use strict';

// Guests at a table (no sign-in): the menu and bill they see, and the requests they send.
const { uid, guestCode, ingredientStockMode } = require('../../js/shared.js');
const { reject, isObj } = require('../base.js');

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
  const blocking = ingredientStockMode(settings) === 'block';
  const products = db.all('products').filter(p => p.active).map(p => {
    const short = blocking && p.lacks && p.lacks.length > 0;
    return {
      id: p.id, name: p.name, categoryId: p.categoryId, price: p.price, emoji: p.emoji, description: p.description, photo: p.photo,
      active: true, trackStock: p.trackStock || short, lowStock: p.lowStock,
      stock: short ? 0 : p.trackStock ? Math.max(0, p.stock - (reserved[p.id] || 0)) + (reservedHere[p.id] || 0) : 0,
    };
  });
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
      if (ingredientStockMode(db.doc('settings', 'main')) === 'block' && p.lacks && p.lacks.length) reject(`${p.name} is sold out right now. Please refresh the menu.`);
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

module.exports = { tableByCode, guestState, createGuestRequest };
