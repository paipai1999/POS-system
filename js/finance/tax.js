'use strict';

// Tax: what was charged on sales (less refunds) and what suppliers charged on purchases and expenses.
// Used by both the browser (loaded as a script, see index.html) and the Node server (through js/finance.js).
(function (root) {
  const inNode = typeof module !== 'undefined' && module.exports;
  const { roundTo, decimalsOf } = inNode ? require('../shared.js') : root;
  const { num, inRange, sum, sold, refunded, live, netOf } = inNode ? require('./core.js') : root.Finance;

  // ----- tax -----
  // Output tax is what was charged on sales (less what refunds gave back); input tax is what suppliers charged on
  // purchases and expenses, when it was entered. The difference is what is owed to (or can be claimed from) the tax office.
  function taxReport(range, data, settings) {
    const [a, b] = range;
    const r = n => roundTo(n, decimalsOf(settings));
    const orders = data.orders || [];
    const soldOrders = sold(orders, a, b), refundOrders = refunded(orders, a, b);
    const rates = new Map();
    const add = (o, sign) => {
      const rate = num(o.totals.taxRate);
      const row = rates.get(rate) || { rate, sales: 0, tax: 0 };
      row.sales += sign * netOf(o);
      row.tax += sign * num(o.totals.tax);
      rates.set(rate, row);
    };
    soldOrders.forEach(o => add(o, 1));
    refundOrders.forEach(o => add(o, -1));
    const byRate = [...rates.values()].sort((x, y) => y.rate - x.rate).map(x => ({ rate: x.rate, sales: r(x.sales), tax: r(x.tax) }));
    const outputTax = sum(soldOrders, o => num(o.totals.tax)) - sum(refundOrders, o => num(o.totals.tax));
    const inPurchases = sum(live(data.purchases).filter(p => inRange(p.date, a, b)), p => num(p.taxAmount));
    const inExpenses = sum(live(data.expenses).filter(e => inRange(e.date, a, b)), e => num(e.taxAmount));
    const serviceCharge = sum(soldOrders, o => num(o.totals.service)) - sum(refundOrders, o => num(o.totals.service));
    return {
      range: [a, b], byRate, outputTax: r(outputTax), inputPurchases: r(inPurchases), inputExpenses: r(inExpenses),
      inputTax: r(inPurchases + inExpenses), payable: r(outputTax - inPurchases - inExpenses), serviceCharge: r(serviceCharge),
    };
  }

  const api = { taxReport };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Finance = Object.assign(root.Finance || {}, api);   // one global, so these short names cannot clash with anything else
})(typeof window !== 'undefined' ? window : globalThis);
