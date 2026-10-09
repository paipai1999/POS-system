'use strict';

// Suppliers and what is owed to them: the list, and the payments that reduce what is owed.
const { roundTo, decimalsOf } = require('../../js/shared.js');
const { reject, can, need, cleanText } = require('../base.js');
const ledger = require('./ledger.js');
const { docCache } = require('./helpers.js');

// `owed` is kept by the server (purchases not paid in full add to it, payments take from it); a device cannot set it.
function prepareSupplier(db, ctx, id, prev, data, deleted) {
  need(ctx.user, 'products');
  if (deleted) {
    if ((prev.owed || 0) !== 0) reject(`${prev.name} is still owed money. Pay it first, or deactivate the supplier instead.`);
    if (db.where('purchases', "json_extract(data, '$.supplierId') = ?", id).length || db.where('supplierPayments', "json_extract(data, '$.supplierId') = ?", id).length) {
      reject('This supplier has purchases or payments on record. Deactivate it instead so the history stays.');
    }
    return null;
  }
  const name = cleanText(data.name, 60);
  if (!name) reject('Supplier name is required');
  if (db.all('suppliers').some(s => s.id !== id && s.name.toLowerCase() === name.toLowerCase())) reject('A supplier with that name already exists');
  const phone = cleanText(data.phone, 30);
  if (phone && !/^[0-9+\-() ]{3,30}$/.test(phone)) reject('Enter the phone number with digits only');
  return { id, name, phone, note: cleanText(data.note, 200), active: data.active !== false, owed: prev ? prev.owed || 0 : 0 };
}

function prepareSupplierPayment(db, ctx, id, prev, data, deleted, changed) {
  need(ctx.user, 'products');
  if (deleted) reject('A payment cannot be deleted. Void it instead.');
  const dec = decimalsOf(db.doc('settings', 'main'));
  const suppliers = docCache(db, 'suppliers');
  if (prev) {
    if (prev.status === 'void') reject('This payment is already void');
    if (data.status !== 'void') reject('A payment cannot be edited. Void it and enter it again.');
    need(ctx.user, 'manage');
    ledger.needOpenDay(db, prev.date, 'this payment cannot be voided');
    const sup = suppliers(prev.supplierId);
    if (sup) {
      sup.owed = roundTo((sup.owed || 0) + prev.amount, dec);
      changed.push(db.put('suppliers', sup.id, sup));
    }
    return { ...prev, status: 'void', voidedAt: Date.now(), voidedBy: ctx.user.id };
  }
  const sup = suppliers(data.supplierId);
  if (!sup) reject('That supplier no longer exists');
  ledger.needOpenDay(db, Date.now(), 'nothing can be added to it');
  const amount = roundTo(Number(data.amount), dec);
  if (!(amount > 0)) reject('Enter the amount paid');
  if (amount > (sup.owed || 0) + 0.005) reject(`Only ${roundTo(sup.owed || 0, dec)} is owed to ${sup.name}`);
  sup.owed = roundTo((sup.owed || 0) - amount, dec);
  changed.push(db.put('suppliers', sup.id, sup));
  return {
    id, supplierId: sup.id, supplierName: sup.name, date: Date.now(), amount, method: data.method === 'other' ? 'other' : 'cash',
    note: cleanText(data.note, 200), by: ctx.user.id, status: 'paid',
  };
}

module.exports = { prepareSupplier, prepareSupplierPayment };
