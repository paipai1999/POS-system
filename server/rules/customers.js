'use strict';

// Customers: contact details, loyalty (points, standing discount) and credit (a limit, and what they owe).
// Points, discount and the credit limit are a manager's to set; what a customer owes is kept by the server only
// (bills put on account add to it, payments and write-offs take from it - see receivables.js).
const { roundTo, decimalsOf } = require('../../js/shared.js');
const { reject, can, need, cleanText } = require('../base.js');

function prepareCustomer(db, ctx, id, prev, data, deleted) {
  need(ctx.user, 'checkout');
  const dec = decimalsOf(db.doc('settings', 'main'));
  if (deleted) {
    need(ctx.user, 'manage');
    if (db.where('orders', "json_extract(data, '$.customerId') = ?", id).length) reject('This customer has bills. Deactivate them instead so reports stay accurate.');
    if (prev && (prev.owing || 0) !== 0) reject(`${prev.name} owes money. Settle or write off the account first.`);
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
  const wantLimit = roundTo(Number(data.creditLimit) || 0, dec);
  if (!(wantLimit >= 0 && wantLimit < 1e12)) reject('The credit limit cannot be negative');
  if (!manager && ((prev ? prev.discountPercent || 0 : 0) !== wantDiscount || (prev ? prev.points || 0 : 0) !== wantPoints)) {
    reject("Only a manager can change a customer's points or discount");
  }
  if (!manager && (prev ? prev.creditLimit || 0 : 0) !== wantLimit) reject('Only a manager can set a credit limit');
  // spent / visits / last visit / owing are kept by the server and never taken from a device.
  return {
    id, name, phone, note: cleanText(data.note, 200), active: data.active !== false,
    discountPercent: wantDiscount, points: wantPoints, creditLimit: wantLimit, owing: prev ? prev.owing || 0 : 0,
    spent: prev ? prev.spent || 0 : 0, visits: prev ? prev.visits || 0 : 0, lastVisit: prev ? prev.lastVisit || null : null,
    createdAt: prev ? prev.createdAt : Date.now(),
  };
}

module.exports = { prepareCustomer };
