'use strict';

// Cash flow by channel (cash, card, other): money that actually moved in a period.
// Used by both the browser (loaded as a script, see index.html) and the Node server (through js/finance.js).
(function (root) {
  const inNode = typeof module !== 'undefined' && module.exports;
  const { roundTo, decimalsOf, paymentByMethod } = inNode ? require('../shared.js') : root;
  const { num, inRange, sum, sold, refunded, live, channel, zero, CHANNELS } = inNode ? require('./core.js') : root.Finance;

  // ----- cash flow -----
  // Money that actually moved, by channel. Sales and refunds are what customers handed over / got back (tips included).
  function cashFlow(range, data, settings) {
    const [a, b] = range;
    const r = n => roundTo(n, decimalsOf(settings));
    const orders = data.orders || [];
    const receipts = zero(), refundsOut = zero(), boughtOut = zero(), suppliersOut = zero(), expensesOut = zero(), ownerIn = zero(), ownerOut = zero(), customerIn = zero();
    const soldOrders = sold(orders, a, b);
    // A bill put on account is not money: nothing is received (or given back) until the customer pays.
    for (const o of soldOrders) for (const [m, amount] of Object.entries(paymentByMethod(o.payment))) if (m !== 'credit') receipts[channel(m)] += num(amount);
    for (const o of refunded(orders, a, b)) for (const [m, amount] of Object.entries(paymentByMethod(o.payment))) if (m !== 'credit') refundsOut[channel(m)] += num(amount);
    // Customers paying what they owe (a write-off is not money either).
    for (const c of live(data.customerPayments).filter(x => x.method !== 'writeoff' && inRange(x.date, a, b))) customerIn[channel(c.method)] += num(c.amount);
    for (const p of live(data.purchases).filter(x => inRange(x.date, a, b))) boughtOut[channel(p.payMethod)] += num(p.paid ?? p.total);
    for (const p of live(data.supplierPayments).filter(x => inRange(x.date, a, b))) suppliersOut[channel(p.method)] += num(p.amount);
    for (const e of live(data.expenses).filter(x => inRange(x.date, a, b))) expensesOut[channel(e.method)] += num(e.amount);
    for (const m of live(data.ownerMoves).filter(x => inRange(x.date, a, b))) (m.type === 'in' ? ownerIn : ownerOut)[channel(m.method)] += num(m.amount);

    const rows = { receipts, customerIn, ownerIn, refundsOut, boughtOut, suppliersOut, expensesOut, ownerOut };
    const inflow = zero(), outflow = zero(), net = zero();
    for (const c of CHANNELS) {
      inflow[c] = receipts[c] + customerIn[c] + ownerIn[c];
      outflow[c] = refundsOut[c] + boughtOut[c] + suppliersOut[c] + expensesOut[c] + ownerOut[c];
      net[c] = inflow[c] - outflow[c];
    }
    const round = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r(v)]));
    const total = o => r(sum(CHANNELS, c => o[c]));
    const tips = sum(soldOrders, o => num(o.payment && o.payment.tip));
    return {
      range: [a, b],
      ...Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, round(v)])),
      inflow: round(inflow), outflow: round(outflow), net: round(net),
      totals: { receipts: total(receipts), customerIn: total(customerIn), ownerIn: total(ownerIn), inflow: total(inflow), outflow: total(outflow), net: total(net) },
      tips: r(tips),
    };
  }

  const api = { cashFlow };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Finance = Object.assign(root.Finance || {}, api);   // one global, so these short names cannot clash with anything else
})(typeof window !== 'undefined' ? window : globalThis);
