'use strict';

// Small helpers the other rule files share: manager approval, order numbers and reading/writing documents.
const { takeStockLines, returnStockLines } = require('../../js/shared.js');
const { reject, can } = require('../base.js');

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

module.exports = { needApproval, nextOrderNo, stockProducts, docCache, writeBack, takeStock, returnStock };
