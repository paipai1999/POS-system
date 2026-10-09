'use strict';

// Cash drawer shifts: the server works out what the drawer should hold when a shift is closed.
const { roundTo, decimalsOf, computeShift } = require('../../js/shared.js');
const { reject, need } = require('../base.js');

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
  const payments = db.where('supplierPayments', "json_extract(data, '$.date') >= ?", prev.openedAt).map(r => r.data);
  const since = col => db.where(col, "json_extract(data, '$.date') >= ?", prev.openedAt).map(r => r.data);
  const sums = computeShift({ ...prev, closedAt: now }, orders, dec, payments, { expenses: since('expenses'), purchases: since('purchases'), ownerMoves: since('ownerMoves'), customerPayments: since('customerPayments') });
  return {
    ...prev, closedAt: now, closedBy: ctx.user.id, countedCash: counted,
    expectedCash: sums.expected, difference: roundTo(counted - sums.expected, dec),
    cashIn: sums.cashIn, cashOut: sums.cashOut, payouts: sums.payouts, spent: sums.spent, bought: sums.bought, ownerIn: sums.ownerIn, ownerOut: sums.ownerOut, received: sums.received,
    tips: sums.tips, sales: sums.sales, orders: sums.orders,
    note: String(data.note || '').trim().slice(0, 300),
  };
}

module.exports = { prepareShift };
