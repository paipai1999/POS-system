'use strict';

// The menu and the room: tables, categories and menu items (price, recipe, priced options, photo).
const { guestCode, roundTo, decimalsOf, round4, lacksOf } = require('../../js/shared.js');
const { reject, need, isObj } = require('../base.js');
const photos = require('../photos.js');
const { docCache } = require('./helpers.js');

// ----- tables -----
function prepareTable(db, ctx, id, prev, data, deleted) {
  need(ctx.user, 'settings');
  if (deleted) {
    if (db.where('orders', "json_extract(data, '$.status') = 'open' AND json_extract(data, '$.tableId') = ?", id).length) {
      reject('That table has an open order');
    }
    return null;
  }
  if (typeof data.name !== 'string' || !data.name.trim()) reject('Table name is required');
  data.guestCode = prev && prev.guestCode ? prev.guestCode : guestCode();   // the QR code part is never taken from a device
  return data;
}

// ----- categories -----
function prepareCategory(db, ctx, id, prev, data, deleted) {
  need(ctx.user, 'products');
  if (deleted && db.where('products', "json_extract(data, '$.categoryId') = ?", id).length) {
    reject('Move or delete the items in this category first');
  }
  return deleted ? null : data;
}

// ----- menu items -----

// Photo: only the name of a picture uploaded earlier (POST /api/photo). Keeping the one already stored is always allowed,
// so an item can still be edited after a restored backup that has no picture files.
function cleanPhoto(db, prev, data) {
  if (data.photo === undefined || data.photo === null || data.photo === '') delete data.photo;
  else if (!(prev && prev.photo === data.photo) && !photos.exists(db.dataDir, data.photo)) reject('That photo was not uploaded. Choose it again.');
}

// Recipe: how much of each ingredient one portion uses.
function cleanRecipe(db, data) {
  const raw = Array.isArray(data.recipe) ? data.recipe : [];
  if (raw.length > 20) reject('At most 20 ingredients per recipe');
  const used = new Set();
  data.recipe = raw.map(r => {
    const qty = isObj(r) ? round4(Number(r.qty)) : 0;
    if (!isObj(r) || typeof r.ingredientId !== 'string' || !db.doc('ingredients', r.ingredientId)) reject('A recipe uses an ingredient that does not exist');
    if (!(qty > 0) || qty > 1e6 || used.has(r.ingredientId)) reject('Each recipe ingredient needs a different ingredient and an amount above 0');
    used.add(r.ingredientId);
    return { ingredientId: r.ingredientId, qty };
  });
}

// What picking an option uses up besides the recipe (an extra shot uses more beans).
function cleanOptionUses(db, option) {
  const raw = Array.isArray(option.uses) ? option.uses : [];
  if (raw.length > 6) reject('At most 6 ingredients per option');
  const seen = new Set();
  return raw.map(u => {
    const qty = isObj(u) ? round4(Number(u.qty)) : 0;
    if (!isObj(u) || typeof u.ingredientId !== 'string' || !db.doc('ingredients', u.ingredientId)) reject('An option uses an ingredient that does not exist');
    if (!(qty > 0) || qty > 1e6 || seen.has(u.ingredientId)) reject('Each ingredient an option uses needs a different ingredient and an amount above 0');
    seen.add(u.ingredientId);
    return { ingredientId: u.ingredientId, qty };
  });
}

// Priced options ("Extra shot +0.50"): a short list of unique names with non-negative prices.
function cleanOptions(db, data) {
  const dec = decimalsOf(db.doc('settings', 'main'));
  const raw = Array.isArray(data.options) ? data.options : [];
  if (raw.length > 8) reject('At most 8 options per item');
  const names = new Set();
  data.options = raw.map(o => {
    const name = isObj(o) ? String(o.name ?? '').trim().slice(0, 30) : '';
    const price = isObj(o) ? roundTo(Number(o.price) || 0, dec) : -1;
    if (!name || !(price >= 0) || names.has(name)) reject('Each option needs a different name and a price of 0 or more');
    names.add(name);
    const uses = cleanOptionUses(db, o);
    return uses.length ? { name, price, uses } : { name, price };
  });
}

function prepareProduct(db, ctx, id, prev, data, deleted) {
  need(ctx.user, 'products');
  if (deleted) return null;
  delete data.lacks;   // worked out from the ingredients; a device cannot set it
  cleanPhoto(db, prev, data);
  cleanRecipe(db, data);
  const lacks = lacksOf(data, docCache(db, 'ingredients'));
  if (lacks.length) data.lacks = lacks;
  cleanOptions(db, data);
  return data;
}

module.exports = { prepareTable, prepareCategory, prepareProduct };
