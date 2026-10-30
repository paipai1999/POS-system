'use strict';

// Branches: sales, costs and profit side by side for several shops, each taken from its own backup file (a shop's POS server
// holds only its own data, so the owner brings the backups together). Each shop is worked out with that shop's own settings
// and the same statements as everywhere else (js/finance/kpis.js), so a branch's figures here equal its own Business health tab.
// Totals are added up only when every shop uses the same currency and decimals; otherwise each branch stands on its own.
// Used by both the browser (loaded as a script, see index.html) and the Node server (through js/finance.js).
(function (root) {
  const inNode = typeof module !== 'undefined' && module.exports;
  const { roundTo, decimalsOf } = inNode ? require('../shared.js') : root;
  const { isSale } = inNode ? require('./core.js') : root.Finance;
  const businessKpis = inNode ? require('./kpis.js').businessKpis : (...a) => root.Finance.businessKpis(...a);

  const DAY = 86400000;

  // branches: [{ id, label, data, settings }]. Returns { rows, totals (or null), mixed, notes }.
  function branchReport(range, branches, now = Date.now()) {
    const [, b] = range;
    const end = Math.min(b, now);
    const rows = branches.map(br => {
      const s = br.settings || {};
      const k = businessKpis(range, br.data, s);
      const line = key => k.lines.find(l => l.key === key);
      const sales = (br.data.orders || []).filter(o => isSale(o) && Number.isFinite(o.paidAt));
      const latestSale = sales.length ? Math.max(...sales.map(o => o.paidAt)) : null;
      return {
        id: br.id, label: br.label, currency: s.currency || '', currencyAfter: !!s.currencyAfter, decimals: decimalsOf(s),
        revenue: k.revenue, orders: k.orders, avgCheck: k.avgCheck,
        food: line('food').amount, foodRatio: line('food').ratio,
        labour: line('labour').amount, labourRatio: line('labour').ratio, labourEstimated: !!line('labour').estimated,
        grossProfit: k.grossProfit, netProfit: k.netProfit, netMargin: k.netMargin,
        staffHours: k.staffHours, salesPerHour: k.salesPerHour,
        latestSale,
        // The backup was saved before the period ended, so it may be missing the last days (or all of the period).
        stale: latestSale === null ? sales.length === 0 : latestSale < end - 36 * 3600000,
      };
    });

    const mixed = rows.length > 1 && new Set(rows.map(r => `${r.currency}|${r.currencyAfter}|${r.decimals}`)).size > 1;
    let totals = null;
    if (rows.length && !mixed) {
      const dec = rows[0].decimals;
      const r = n => roundTo(n, dec);
      const sum = f => rows.reduce((n, x) => n + f(x), 0);
      const revenue = sum(x => x.revenue), food = sum(x => x.food), labour = sum(x => x.labour), net = sum(x => x.netProfit), hours = sum(x => x.staffHours);
      const orders = sum(x => x.orders);
      totals = {
        revenue: r(revenue), orders, avgCheck: orders ? r(revenue / orders) : 0,
        food: r(food), foodRatio: revenue > 0 ? food / revenue : null, labour: r(labour), labourRatio: revenue > 0 ? labour / revenue : null,
        grossProfit: r(sum(x => x.grossProfit)), netProfit: r(net), netMargin: revenue > 0 ? net / revenue : 0,
        staffHours: roundTo(hours, 2), salesPerHour: hours > 0 ? r(revenue / hours) : null,
      };
      for (const x of rows) x.share = revenue > 0 ? x.revenue / revenue : null;
    }

    // Two files named alike are probably the same shop saved twice: adding both would count its sales twice.
    const names = rows.map(x => x.label.trim().toLowerCase());
    const duplicates = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
    return { range, rows, totals, mixed, duplicates, best: rows.length > 1 ? rows.reduce((m, x) => (x.revenue > 0 && x.netMargin > (m ? m.netMargin : -Infinity) ? x : m), null) : null };
  }

  const api = { branchReport };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Finance = Object.assign(root.Finance || {}, api);   // one global, so these short names cannot clash with anything else
})(typeof window !== 'undefined' ? window : globalThis);
