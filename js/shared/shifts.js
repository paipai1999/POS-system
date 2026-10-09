'use strict';

// The cash drawer for one shift.
// Used by both the browser app (loaded as a script, see index.html) and the Node server (through js/shared.js).
(function (root) {
  // In Node the other shared modules are required; in the browser they are already on `window`.
  const shared = mod => (typeof module !== 'undefined' && module.exports ? require('./' + mod + '.js') : root);
  const { roundTo } = shared('core');
  const { paymentCash } = shared('payments');

  // The cash drawer for one shift: opening float + cash taken − cash paid back out in refunds.
  // `extra` holds the other cash that left or entered the drawer: { expenses, purchases, ownerMoves, customerPayments }
  // (only cash ones count; customers paying off their account in cash puts cash in).
  function computeShift(shift, orders, decimals = 2, supplierPayments = [], extra = {}) {
    const from = shift.openedAt, to = shift.closedAt || Infinity;
    let cashIn = 0, cashOut = 0, tips = 0, sales = 0, count = 0, payouts = 0, spent = 0, bought = 0, ownerIn = 0, ownerOut = 0, received = 0;
    for (const o of orders) {
      if ((o.status === 'paid' || o.status === 'refunded') && o.paidAt >= from && o.paidAt <= to) {
        cashIn += paymentCash(o.payment);
        tips += Number(o.payment && o.payment.tip || 0);
        sales += Number(o.totals && o.totals.total || 0);
        count++;
      }
      if (o.status === 'refunded' && o.refundedAt >= from && o.refundedAt <= to) cashOut += paymentCash(o.payment);
    }
    // Cash handed to suppliers out of the till during the shift.
    for (const p of supplierPayments) if (p.method === 'cash' && p.status !== 'void' && p.date >= from && p.date <= to) payouts += Number(p.amount || 0);
    const within = t => t >= from && t <= to;
    for (const e of extra.expenses || []) if (e.method === 'cash' && e.status !== 'void' && within(e.date)) spent += Number(e.amount || 0);
    for (const p of extra.purchases || []) if (p.payMethod === 'cash' && p.status !== 'void' && within(p.date)) bought += Number(p.paid ?? p.total ?? 0);
    for (const m of extra.ownerMoves || []) {
      if (m.method !== 'cash' || m.status === 'void' || !within(m.date)) continue;
      if (m.type === 'in') ownerIn += Number(m.amount || 0); else ownerOut += Number(m.amount || 0);
    }
    // Customers paying what they owe, in cash.
    for (const c of extra.customerPayments || []) if (c.method === 'cash' && c.status !== 'void' && within(c.date)) received += Number(c.amount || 0);
    const r = n => roundTo(n, decimals);
    const expected = r(Number(shift.openingFloat || 0) + cashIn - cashOut - payouts - spent - bought + ownerIn - ownerOut + received);
    return { cashIn: r(cashIn), cashOut: r(cashOut), payouts: r(payouts), spent: r(spent), bought: r(bought), ownerIn: r(ownerIn), ownerOut: r(ownerOut), received: r(received), tips: r(tips), sales: r(sales), orders: count, expected };
  }

  const api = { computeShift };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
