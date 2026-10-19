'use strict';

// Customers paying what they owe on their account (sales on account are made at checkout, see orders.js).
// A payment takes from the customer's balance (`owing`, kept by the server); a write-off clears a debt that will not be paid
// (a manager's decision, counted as an expense in the profit and loss). A payment cannot be edited, only voided, and a day
// that has been closed is locked.
const { roundTo, decimalsOf } = require('../../js/shared.js');
const { reject, need, cleanText } = require('../base.js');
const { needOpenDay } = require('./ledger.js');
const { needApproval } = require('./helpers.js');

const METHODS = ['cash', 'card', 'other', 'writeoff'];
// A customer payment is one of: 'payment' (towards what they owe), 'deposit' (money paid in advance, which puts the account in
// credit to be used on a later bill) or 'depositRefund' (a deposit given back: money out, and a manager must approve it).
const KINDS = ['payment', 'deposit', 'depositRefund'];

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
      if (prev.kind === 'deposit' && -(c.owing || 0) < prev.amount - 0.005) reject('This deposit has already been used on a bill, so it cannot be voided.');
      // Voiding undoes what the entry did: a payment or deposit had lowered the balance, a deposit given back had raised it.
      c.owing = roundTo((c.owing || 0) + (prev.kind === 'depositRefund' ? -prev.amount : prev.amount), dec);
      changed.push(db.put('customers', c.id, c));
    }
    return { ...prev, status: 'void', voidedAt: Date.now(), voidedBy: ctx.user.id };
  }

  const c = customer(data.customerId);
  if (!c) reject('That customer no longer exists');
  const kind = data.kind === undefined || data.kind === null ? 'payment' : data.kind;
  if (!KINDS.includes(kind)) reject('Invalid payment');
  if (!METHODS.includes(data.method) || (kind !== 'payment' && data.method === 'writeoff')) reject('Choose how the customer paid');
  if (data.method === 'writeoff') need(ctx.user, 'manage');
  const amount = roundTo(Number(data.amount), dec);
  if (!(amount > 0) || amount > 1e12) reject('Enter the amount');
  const credit = roundTo(Math.max(0, -(c.owing || 0)), dec);
  if (kind === 'payment' && amount > (c.owing || 0) + 0.005) reject(`Only ${roundTo(c.owing || 0, dec)} is owed by ${c.name}`);
  if (kind === 'depositRefund') {
    if (amount > credit + 0.005) reject(`Only ${credit} of ${c.name}'s deposit is left to give back`);
    needApproval(db, ctx, data.approvedBy);
  }
  needOpenDay(db, Date.now(), 'nothing can be added to it');
  c.owing = roundTo((c.owing || 0) + (kind === 'depositRefund' ? amount : -amount), dec);
  changed.push(db.put('customers', c.id, c));
  const doc = {
    id, customerId: c.id, customerName: c.name, date: Date.now(), amount, method: data.method,
    note: cleanText(data.note, 200), by: ctx.user.id, status: 'received',
  };
  if (kind !== 'payment') doc.kind = kind;
  if (kind === 'deposit' && typeof data.reservationId === 'string' && data.reservationId.length <= 80) doc.reservationId = data.reservationId;
  if (kind === 'depositRefund') doc.approvedBy = data.approvedBy;
  return doc;
}

module.exports = { prepareCustomerPayment };
