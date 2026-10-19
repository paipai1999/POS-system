'use strict';

// Business health: the handful of ratios an owner steers by, each with a plain verdict.
//   food cost %   what the ingredients of the dishes sold cost, of revenue
//   labour %      salaries and wages, of revenue
//   prime cost %  food cost + labour, the two big costs you can influence; the figure restaurant owners watch hardest
//   occupancy %   rent, of revenue
//   net margin    what is left of each unit of revenue
//   break-even    the revenue per day at which the period's running costs are just covered
// The verdicts compare with common ranges for table-service restaurants and cafes; they are a guide, not a rule, so every
// ratio is also shown as a number. Pure: it reads the same records as the profit and loss.
// Used by both the browser (loaded as a script, see index.html) and the Node server (through js/finance.js).
(function (root) {
  const inNode = typeof module !== 'undefined' && module.exports;
  const { roundTo, decimalsOf } = inNode ? require('../shared.js') : root;
  const finance = () => (inNode ? { ...require('./core.js'), ...require('./profit-loss.js') } : root.Finance);

  const LABOUR = /salar|wage|payroll|labou?r|staff cost/i;
  const RENT = /rent|lease/i;

  // [good up to, high above]. Revenue ratios where lower is better.
  const BENCHMARKS = {
    food: { good: 0.32, high: 0.38, text: 'Food cost is usually 28–35% of revenue.' },
    labour: { good: 0.30, high: 0.36, text: 'Labour is usually 25–35% of revenue.' },
    prime: { good: 0.60, high: 0.68, text: 'Prime cost (food + labour) should stay under about 60–65% of revenue.' },
    occupancy: { good: 0.10, high: 0.15, text: 'Rent is usually under 10% of revenue.' },
  };

  const verdict = (key, ratio) => {
    const b = BENCHMARKS[key];
    return ratio <= b.good ? 'good' : ratio <= b.high ? 'watch' : 'high';
  };

  function businessKpis(range, data, settings) {
    const F = finance();
    const [a, b] = range;
    const r = n => roundTo(n, decimalsOf(settings));
    const pl = F.profitAndLoss(range, data, settings);
    const revenue = pl.revenue;
    const days = Math.max(1, Math.round((b - a) / 86400000));
    const ratio = x => (revenue > 0 ? x / revenue : null);

    const sumOf = re => pl.expenses.filter(e => re.test(e.category)).reduce((n, e) => n + e.amount, 0);
    const labour = sumOf(LABOUR), rent = sumOf(RENT);
    const food = pl.cogs.total;
    const prime = food + labour;

    const lines = [
      { key: 'food', label: 'Food cost', amount: r(food), ratio: ratio(food) },
      { key: 'labour', label: 'Labour', amount: r(labour), ratio: ratio(labour) },
      { key: 'prime', label: 'Prime cost (food + labour)', amount: r(prime), ratio: ratio(prime) },
      { key: 'occupancy', label: 'Rent', amount: r(rent), ratio: ratio(rent) },
    ].map(l => ({ ...l, status: l.ratio === null ? 'none' : verdict(l.key, l.ratio), hint: BENCHMARKS[l.key].text }));

    // Every running cost of the period is treated as fixed; what an extra sale brings in is the revenue less its ingredients.
    const running = pl.expensesTotal;
    const variable = revenue > 0 ? food / revenue : 0;
    const contribution = 1 - variable;
    const breakEven = contribution > 0 ? running / contribution : null;

    const notes = [];
    if (pl.cogs.coverage < 0.7 && revenue > 0) {
      notes.push(`Only ${Math.round(pl.cogs.coverage * 100)}% of item sales have a recipe, so food cost is understated. Add recipes under Menu & Stock to see the true figure.`);
    }
    if (revenue > 0 && labour === 0) notes.push('No salaries or wages are recorded as expenses in this period, so labour and prime cost look better than they are. Record them under Finance → Expenses (category Salaries).');

    return {
      range: [a, b], days, revenue: r(revenue), orders: pl.orders,
      avgCheck: pl.orders ? r(revenue / pl.orders) : 0, revenuePerDay: r(revenue / days),
      grossProfit: pl.grossProfit, netProfit: pl.netProfit, netMargin: pl.netMargin,
      netStatus: revenue <= 0 ? 'none' : pl.netMargin >= 0.10 ? 'good' : pl.netMargin >= 0.03 ? 'watch' : 'high',
      lines, running: r(running),
      breakEven: {
        revenue: breakEven === null ? null : r(breakEven),
        perDay: breakEven === null ? null : r(breakEven / days),
        actualPerDay: r(revenue / days),
        // How far sales can fall before the period loses money, as a share of today's sales (negative = already losing).
        cushion: breakEven === null || revenue <= 0 ? null : (revenue - breakEven) / revenue,
      },
      notes,
    };
  }

  const api = { businessKpis, KPI_BENCHMARKS: BENCHMARKS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Finance = Object.assign(root.Finance || {}, api);   // one global, so these short names cannot clash with anything else
})(typeof window !== 'undefined' ? window : globalThis);
