'use strict';

// Ingredients, purchases (stock coming in) and stocktakes (stock counted).
const { roundTo, decimalsOf, round4, recipeOf, receivePurchase, voidPurchase, applyStocktake } = require('../../js/shared.js');
const { reject, can, need, isObj, cleanText } = require('../base.js');
const ledger = require('./ledger.js');
const { docCache, writeBack } = require('./helpers.js');

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
  return { id, name, unit: cleanText(data.unit, 10) || 'pcs', cost, lowStock: low, active: data.active !== false, watch: data.watch !== false, stock: prev ? prev.stock : start };
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
    ledger.needOpenDay(db, prev.date, 'this purchase cannot be voided');
    const out = { ...prev, lines: prev.lines.map(l => ({ ...l })), status: 'void', voidedAt: Date.now(), voidedBy: ctx.user.id };
    writeBack(db, 'ingredients', voidPurchase(out, ings), changed);
    const sup = out.supplierId && docCache(db, 'suppliers')(out.supplierId);
    if (sup) {
      sup.owed = roundTo((sup.owed || 0) - (out.total - (out.paid ?? out.total)), decimalsOf(db.doc('settings', 'main')));
      changed.push(db.put('suppliers', sup.id, sup));
    }
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
  const total = roundTo(lines.reduce((n, l) => n + l.total, 0), dec);
  // Who it was bought from (a supplier on the list, so what is still owed can be followed) and how much was paid now.
  let supplier = null;
  if (data.supplierId !== undefined && data.supplierId !== null && data.supplierId !== '') {
    supplier = typeof data.supplierId === 'string' ? db.doc('suppliers', data.supplierId) : null;
    if (!supplier) reject('That supplier no longer exists');
  }
  const paid = data.paid === undefined || data.paid === null || data.paid === '' ? total : roundTo(Number(data.paid), dec);
  if (!(paid >= 0) || paid > total + 0.005) reject('The amount paid must be between 0 and the total');
  if (!supplier && paid < total) reject('Choose a supplier to record an amount that is still owed');
  ledger.needOpenDay(db, Date.now(), 'nothing can be added to it');
  const purchase = {
    id, date: Date.now(), supplier: supplier ? supplier.name : cleanText(data.supplier, 60), note: cleanText(data.note, 300), by: ctx.user.id, status: 'received',
    lines, total, paid,
    // How the part paid now left the business (cash comes out of the till) and the tax in the price, if the supplier charged it.
    payMethod: ['cash', 'card', 'other'].includes(data.payMethod) ? data.payMethod : 'other',
    taxAmount: ledger.taxPart(data.taxAmount, total, dec),
  };
  if (supplier) purchase.supplierId = supplier.id;
  writeBack(db, 'ingredients', receivePurchase(purchase, ings), changed);
  if (supplier && total > paid) {
    supplier.owed = roundTo((supplier.owed || 0) + total - paid, dec);
    changed.push(db.put('suppliers', supplier.id, supplier));
  }
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

module.exports = { prepareIngredient, preparePurchase, prepareStocktake };
