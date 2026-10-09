'use strict';

// Customers paying what they owe on their account (sales on account are made at checkout, see orders.js).
// A payment takes from the customer's balance (`owing`, kept by the server); a write-off clears a debt that will not be paid
// (a manager's decision, counted as an expense in the profit and loss). A payment cannot be edited, only voided, and a day
// that has been closed is locked.
const { roundTo, decimalsOf } = require('../../js/shared.js');
const { reject, need, cleanText } = require('../base.js');
const { needOpenDay } = require('./ledger.js');

const METHODS = ['cash', 'card', 'other', 'writeoff'];

function prepareCustomerPayment(db, ctx, id, prev, data, deleted, changed) {
  need(ctx.user, 'checkout');                          // whoever takes payments at the counter may take one on account
  if (deleted) reject('A payment cannot be deleted. Void it instead.');
  const dec = decimalsOf(db.doc('settings', 'main'));
  const customer = id => (typeof id === 'string' ? db.doc('customers', id) : null);

  if (prev) {
    if (prev.status === 'void') reject('This payment is already void');
    if (data.status !== 'void') reject('A payment cannot be edited. Void it and enter it again.');
    need(ctx.user, 'manage');
    needOpenDay(db, prev.date, 'this payment cannot be voided');
    const c = customer(prev.customerId);
    if (c) {
      c.owing = roundTo((c.owing || 0) + prev.amount, dec);
      changed.push(db.put('customers', c.id, c));
    }
    return { ...prev, status: 'void', voidedAt: Date.now(), voidedBy: ctx.user.id };
  }

  const c = customer(data.customerId);
  if (!c) reject('That customer no longer exists');
  if (!METHODS.includes(data.method)) reject('Choose how the customer paid');
  if (data.method === 'writeoff') need(ctx.user, 'manage');
  const amount = roundTo(Number(data.amount), dec);
  if (!(amount > 0) || amount > 1e12) reject('Enter the amount');
  if (amount > (c.owing || 0) + 0.005) reject(`Only ${roundTo(c.owing || 0, dec)} is owed by ${c.name}`);
  needOpenDay(db, Date.now(), 'nothing can be added to it');
  c.owing = roundTo((c.owing || 0) - amount, dec);
  changed.push(db.put('customers', c.id, c));
  return {
    id, customerId: c.id, customerName: c.name, date: Date.now(), amount, method: data.method,
    note: cleanText(data.note, 200), by: ctx.user.id, status: 'received',
  };
}

module.exports = { prepareCustomerPayment };
