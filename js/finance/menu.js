'use strict';

// Menu engineering: which dishes earn their place. Each dish is judged on two things, how often it sells (popularity) and
// how much each portion leaves after its ingredients (margin), and put in one of four groups:
//   star       popular and profitable   keep it, protect the quality, show it first
//   plowhorse  popular, thin margin     raise the price a little or trim the cost of the recipe
//   puzzle     profitable, rarely sold  move it up the menu, rename it, have waiters suggest it
//   dog        neither                  rework it or take it off
// A dish is popular when it sells at least 70% of an equal share of all sales (the usual rule of thumb), and profitable
// when its margin per portion is at least the average margin per portion sold.
// Margin needs the dish's cost, which comes from its recipe (every paid line carries the cost it had at the time); a dish
// with no recipe is listed as "unknown" rather than guessed. Pure: it only reads the orders it is given.
// Used by both the browser (loaded as a script, see index.html) and the Node server (through js/finance.js).
(function (root) {
  const inNode = typeof module !== 'undefined' && module.exports;
  const { roundTo, decimalsOf } = inNode ? require('../shared.js') : root;
  const { num, sold } = inNode ? require('./core.js') : root.Finance;

  const POPULAR_SHARE = 0.7;
  const GROUPS = ['star', 'plowhorse', 'puzzle', 'dog'];

  // `categoryOf(productId)` gives a category name for the table (unknown → "Other").
  function menuEngineering(range, data, settings, categoryOf = () => 'Other') {
    const [a, b] = range;
    const r = n => roundTo(n, decimalsOf(settings));
    const orders = sold(data.orders || [], a, b).filter(o => o.status === 'paid');
    const byItem = new Map();
    for (const o of orders) {
      for (const l of o.items || []) {
        const key = l.productId || ('name:' + l.name);
        const it = byItem.get(key) || { productId: l.productId || null, name: l.name, qty: 0, revenue: 0, costedQty: 0, costedRevenue: 0, cost: 0 };
        const qty = num(l.qty), price = num(l.price);
        it.qty += qty; it.revenue += price * qty;
        if (l.cost !== undefined && l.cost !== null) { it.costedQty += qty; it.costedRevenue += price * qty; it.cost += num(l.cost) * qty; }
        byItem.set(key, it);
      }
    }
    const items = [...byItem.values()];
    const totalQty = items.reduce((n, i) => n + i.qty, 0);
    const known = items.filter(i => i.costedQty > 0);
    const knownQty = known.reduce((n, i) => n + i.costedQty, 0);
    const contribution = known.reduce((n, i) => n + (i.costedRevenue - i.cost), 0);
    // Popular = at least 70% of an equal share (of the dishes that can be judged).
    const popularAt = known.length ? POPULAR_SHARE / known.length : 0;
    const knownSold = known.reduce((n, i) => n + i.qty, 0);
    const marginAt = knownQty ? contribution / knownQty : 0;     // average margin per portion sold

    const rows = items.map(i => {
      const margin = i.costedQty ? (i.costedRevenue - i.cost) / i.costedQty : null;
      const share = knownSold && i.costedQty ? i.qty / knownSold : null;
      let group = 'unknown';
      if (margin !== null) {
        const popular = share >= popularAt - 1e-9, profitable = margin >= marginAt - 1e-9;
        group = popular ? (profitable ? 'star' : 'plowhorse') : (profitable ? 'puzzle' : 'dog');
      }
      return {
        productId: i.productId, name: i.name, category: categoryOf(i.productId) || 'Other', qty: i.qty, revenue: r(i.revenue),
        unitPrice: i.qty ? r(i.revenue / i.qty) : 0,
        unitCost: i.costedQty ? r(i.cost / i.costedQty) : null,
        margin: margin === null ? null : r(margin),
        marginPercent: i.costedRevenue > 0 ? (i.costedRevenue - i.cost) / i.costedRevenue : null,
        contribution: margin === null ? null : r(i.costedRevenue - i.cost),
        share, group,
      };
    }).sort((x, y) => (y.contribution ?? -Infinity) - (x.contribution ?? -Infinity) || y.qty - x.qty);

    const count = Object.fromEntries([...GROUPS, 'unknown'].map(g => [g, rows.filter(x => x.group === g).length]));
    return {
      range: [a, b], items: rows, count,
      judged: known.length, unknownRevenue: r(rows.filter(x => x.group === 'unknown').reduce((n, x) => n + x.revenue, 0)),
      totalQty, popularAt, marginAt: r(marginAt),
      coverage: items.length ? known.length / items.length : 0,
    };
  }

  const api = { menuEngineering, MENU_GROUPS: GROUPS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Finance = Object.assign(root.Finance || {}, api);   // one global, so these short names cannot clash with anything else
})(typeof window !== 'undefined' ? window : globalThis);
