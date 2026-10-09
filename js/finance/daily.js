'use strict';

// The daily close: everything about one calendar day, frozen when the day is closed.
// Used by both the browser (loaded as a script, see index.html) and the Node server (through js/finance.js).
(function (root) {
  const inNode = typeof module !== 'undefined' && module.exports;
  const { roundTo, decimalsOf, paymentByMethod } = inNode ? require('../shared.js') : root;
  const { num, inRange, sum, sold, channel, zero, dayBounds } = inNode ? require('./core.js') : root.Finance;
  const { profitAndLoss } = inNode ? require('./profit-loss.js') : root.Finance;
  const { cashFlow } = inNode ? require('./cash-flow.js') : root.Finance;
  const { taxReport } = inNode ? require('./tax.js') : root.Finance;
  const { controls } = inNode ? require('./controls.js') : root.Finance;

  // ----- the daily close -----
  // Everything about one calendar day, frozen when the day is closed.
  function daySummary(key, data, settings) {
    const range = dayBounds(key);
    const [a, b] = range;
    const pl = profitAndLoss(range, data, settings);
    const cash = cashFlow(range, data, settings);
    const tax = taxReport(range, data, settings);
    const ctl = controls(range, data, settings);
    const soldOrders = sold(data.orders || [], a, b);
    const methods = zero();
    for (const o of soldOrders) for (const [m, amount] of Object.entries(paymentByMethod(o.payment))) if (m !== 'credit') methods[channel(m)] += num(amount);
    const onAccount = sum(soldOrders, o => num(paymentByMethod(o.payment).credit));
    const shifts = (data.shifts || []).filter(s => inRange(s.openedAt, a, b));
    const done = shifts.filter(s => s.closedAt);
    const r = n => roundTo(n, decimalsOf(settings));
    return {
      date: key,
      orders: soldOrders.length,
      grossSales: pl.grossSales, discounts: pl.discounts + pl.pointsUsed, refunds: pl.refunds, revenue: pl.revenue,
      service: pl.service, tax: tax.outputTax, tips: cash.tips, taxPayable: tax.payable,
      byMethod: Object.fromEntries(Object.entries(methods).map(([k, v]) => [k, r(v)])),
      onAccount: r(onAccount), customerPaid: r(cash.totals.customerIn),
      cogs: pl.cogs.total, grossProfit: pl.grossProfit, expenses: pl.expensesTotal, expenseRows: pl.expenses, netProfit: pl.netProfit,
      bought: pl.cogs.purchases, cashNet: cash.net, cashTotals: cash.totals,
      voids: ctl.voids, discountsGiven: ctl.discounts.count, refundCount: ctl.refunds.count,
      shifts: {
        count: shifts.length, open: shifts.length - done.length,
        expected: r(sum(done, s => num(s.expectedCash))), counted: r(sum(done, s => num(s.countedCash))), difference: r(sum(done, s => num(s.difference))),
      },
    };
  }

  const api = { daySummary };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Finance = Object.assign(root.Finance || {}, api);   // one global, so these short names cannot clash with anything else
})(typeof window !== 'undefined' ? window : globalThis);
