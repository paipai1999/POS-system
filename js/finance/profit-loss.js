'use strict';

// Profit and loss for a period.
// Used by both the browser (loaded as a script, see index.html) and the Node server (through js/finance.js).
(function (root) {
  const inNode = typeof module !== 'undefined' && module.exports;
  const { roundTo, decimalsOf } = inNode ? require('../shared.js') : root;
  const { num, inRange, sum, sold, refunded, live, netOf, costOf, purchaseNet, TIPS_CATEGORY } = inNode ? require('./core.js') : root.Finance;

  // ----- profit and loss -----
  // cogsMethod 'recipe': what the dishes sold cost to make (from their recipes) plus stock lost or found in stocktakes.
  // cogsMethod 'purchases': what was bought in the period, ignoring what is left on the shelf.
  function profitAndLoss(range, data, settings, { cogsMethod = 'recipe' } = {}) {
    const [a, b] = range;
    const r = n => roundTo(n, decimalsOf(settings));
    const orders = data.orders || [];
    const soldOrders = sold(orders, a, b), refundOrders = refunded(orders, a, b);
    const gross = sum(soldOrders, o => num(o.totals.subtotal));
    const discounts = sum(soldOrders, o => num(o.totals.discount));
    const points = sum(soldOrders, o => num(o.totals.points));
    const salesNet = sum(soldOrders, netOf), refundNet = sum(refundOrders, netOf);
    const serviceSold = sum(soldOrders, o => num(o.totals.service)), serviceRefunded = sum(refundOrders, o => num(o.totals.service));

    const itemSales = sum(soldOrders, o => sum(o.items || [], l => num(l.price) * num(l.qty)));
    const costedSales = sum(soldOrders, o => sum((o.items || []).filter(l => l.cost !== undefined && l.cost !== null), l => num(l.price) * num(l.qty)));
    const recipeCost = sum(soldOrders, costOf) - sum(refundOrders, costOf);
    const shrink = -sum((data.stocktakes || []).filter(s => inRange(s.date, a, b)), s => num(s.value));  // a loss counts as a cost
    const purchases = sum(live(data.purchases).filter(p => inRange(p.date, a, b)), purchaseNet);
    const cogsTotal = cogsMethod === 'purchases' ? purchases : recipeCost + shrink;

    const revenueSales = salesNet - refundNet, revenueService = serviceSold - serviceRefunded;
    const revenue = revenueSales + revenueService;
    const grossProfit = revenue - cogsTotal;

    const byCat = new Map();
    for (const e of live(data.expenses).filter(x => inRange(x.date, a, b) && x.category !== TIPS_CATEGORY)) {
      byCat.set(e.category || 'Other', (byCat.get(e.category || 'Other') || 0) + num(e.amount) - num(e.taxAmount));
    }
    // Debts that will not be paid (written off by a manager) are an expense of the period.
    const badDebts = sum(live(data.customerPayments).filter(x => x.method === 'writeoff' && inRange(x.date, a, b)), x => num(x.amount));
    if (badDebts > 0) byCat.set('Bad debts written off', badDebts);
    const expenseRows = [...byCat].map(([category, amount]) => ({ category, amount: r(amount) })).sort((x, y) => y.amount - x.amount);
    const expensesTotal = sum(expenseRows, x => x.amount);
    const netProfit = grossProfit - expensesTotal;

    return {
      range: [a, b], cogsMethod,
      orders: soldOrders.length, refundedOrders: refundOrders.length,
      grossSales: r(gross), discounts: r(discounts), pointsUsed: r(points),
      salesNet: r(salesNet), refunds: r(refundNet), revenueSales: r(revenueSales), service: r(revenueService), revenue: r(revenue),
      cogs: { recipe: r(recipeCost), shrink: r(shrink), purchases: r(purchases), total: r(cogsTotal), coverage: itemSales > 0 ? costedSales / itemSales : 0 },
      grossProfit: r(grossProfit), grossMargin: revenue > 0 ? grossProfit / revenue : 0,
      expenses: expenseRows, expensesTotal: r(expensesTotal),
      netProfit: r(netProfit), netMargin: revenue > 0 ? netProfit / revenue : 0,
    };
  }

  const api = { profitAndLoss };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Finance = Object.assign(root.Finance || {}, api);   // one global, so these short names cannot clash with anything else
})(typeof window !== 'undefined' ? window : globalThis);
