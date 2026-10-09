'use strict';

// Financial position: what the business holds and owes as of a moment.
// Used by both the browser (loaded as a script, see index.html) and the Node server (through js/finance.js).
(function (root) {
  const inNode = typeof module !== 'undefined' && module.exports;
  const { roundTo, decimalsOf } = inNode ? require('../shared.js') : root;
  const { num, sum, financeOf } = inNode ? require('./core.js') : root.Finance;
  const { cashFlow } = inNode ? require('./cash-flow.js') : root.Finance;

  // ----- financial position -----
  // What the business holds and owes as of a moment: the cash and bank balances (opening balances from setup plus every
  // movement since the start date), the ingredients on the shelf, and what is still owed to suppliers.
  function position(asOf, data, settings) {
    const fin = financeOf(settings);
    const r = n => roundTo(n, decimalsOf(settings));
    const flow = cashFlow([fin.startDate, asOf + 1], data, settings);
    const cash = fin.openingCash + flow.net.cash;
    const bank = fin.openingBank + flow.net.card + flow.net.other;
    const stock = sum((data.ingredients || []).filter(i => i.active !== false), i => Math.max(0, num(i.stock)) * num(i.cost));
    const owed = sum(data.suppliers || [], s => num(s.owed));
    // Customers who have not paid yet are an asset; a customer in credit (paid too much, or a refund after paying) is owed money.
    const receivable = sum(data.customers || [], c => Math.max(0, num(c.owing)));
    const customerCredit = sum(data.customers || [], c => Math.max(0, -num(c.owing)));
    const assets = cash + bank + stock + receivable;
    return {
      asOf, configured: fin.startDate > 0, startDate: fin.startDate,
      cash: r(cash), bank: r(bank), stock: r(stock), receivable: r(receivable), assets: r(assets),
      owed: r(owed), customerCredit: r(customerCredit), net: r(assets - owed - customerCredit),
    };
  }

  const api = { position };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Finance = Object.assign(root.Finance || {}, api);   // one global, so these short names cannot clash with anything else
})(typeof window !== 'undefined' ? window : globalThis);
