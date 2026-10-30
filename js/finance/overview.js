'use strict';

// Overview: the few numbers an owner looks at first (today against yesterday so far, the last 7 days against the 7 before,
// sales by hour, best sellers, categories and payment methods). Pure: it only reads the orders it is given.
// Used by both the browser (loaded as a script, see index.html) and the Node server (through js/finance.js).
(function (root) {
  const inNode = typeof module !== 'undefined' && module.exports;
  const { roundTo, decimalsOf } = inNode ? require('../shared.js') : root;
  const { paymentByWay } = inNode ? require('../shared.js') : root;
  const { num, inRange, isSale, refundTime } = inNode ? require('./core.js') : root.Finance;

  const startOfDay = (t, plusDays = 0) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + plusDays);
    return d.getTime();
  };

  // Sales, bill count and ingredient cost of the orders sold in [a, b), less refunds made in [a, b).
  function window(orders, a, b) {
    let gross = 0, count = 0, refunds = 0, cost = 0, costedSales = 0;
    for (const o of orders) {
      if (!isSale(o)) continue;
      if (inRange(o.paidAt, a, b)) {
        gross += num(o.totals.total);
        count++;
        for (const l of o.items || []) {
          if (l.cost !== undefined) { cost += num(l.cost) * num(l.qty); costedSales += num(l.price) * num(l.qty); }
        }
      }
      if (o.status === 'refunded' && inRange(refundTime(o), a, b)) {
        refunds += num(o.totals.total);
        for (const l of o.items || []) {
          if (l.cost !== undefined) { cost -= num(l.cost) * num(l.qty); costedSales -= num(l.price) * num(l.qty); }
        }
      }
    }
    return { sales: gross - refunds, gross, refunds, count, cost, costedSales, profit: costedSales - cost };
  }

  // `categoryOf(productId)` gives a category name for the mix chart (anything unknown counts as "Other").
  function overview(orders, now, settings, categoryOf = () => 'Other') {
    const r = n => roundTo(n, decimalsOf(settings));
    const today = startOfDay(now), tomorrow = startOfDay(now, 1), yesterday = startOfDay(now, -1);
    // Yesterday only up to this time of day, so a morning is not compared with a whole finished day.
    const sameTime = yesterday + (now - today);

    const cut = w => ({ ...w, sales: r(w.sales), gross: r(w.gross), refunds: r(w.refunds), cost: r(w.cost), profit: r(w.profit) });
    const todayW = cut(window(orders, today, tomorrow));
    const yesterdayW = cut(window(orders, yesterday, sameTime));

    // The last 7 days, oldest first, and the 7 before for the comparison.
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const a = startOfDay(now, -i), b = startOfDay(now, -i + 1);
      days.push({ date: a, ...cut(window(orders, a, b)) });
    }
    const weekStart = startOfDay(now, -6);
    const week = cut(window(orders, weekStart, tomorrow));
    const before = cut(window(orders, startOfDay(now, -13), weekStart));

    // Breakdowns of the 7 days: sold orders only (a refund's share is not subtracted from item or method rows).
    const hours = Array(24).fill(0);
    const items = new Map(), cats = new Map(), methods = new Map();
    for (const o of orders) {
      if (!isSale(o)) continue;
      if (inRange(o.paidAt, today, tomorrow)) hours[new Date(num(o.paidAt)).getHours()] += num(o.totals.total);
      if (!inRange(o.paidAt, weekStart, tomorrow)) continue;
      for (const [k, amount] of Object.entries(paymentByWay(o.payment) || {})) methods.set(k, (methods.get(k) || 0) + num(amount));   // 'other:KBZPay' is listed apart from plain 'other'
      for (const l of o.items || []) {
        const amount = num(l.qty) * num(l.price);
        const it = items.get(l.productId) || { name: l.name, qty: 0, amount: 0 };
        it.qty += num(l.qty); it.amount += amount;
        items.set(l.productId, it);
        const c = categoryOf(l.productId) || 'Other';
        cats.set(c, (cats.get(c) || 0) + amount);
      }
    }
    const ranked = m => [...m.entries()].sort((a, b) => b[1] - a[1]);
    return {
      today: todayW,
      yesterday: yesterdayW,
      week,
      before,
      days,
      hours: hours.map(r),
      topItems: [...items.values()].sort((a, b) => b.amount - a.amount || b.qty - a.qty).slice(0, 5)
        .map(i => ({ ...i, amount: r(i.amount) })),
      categories: ranked(cats).map(([name, amount]) => ({ name, amount: r(amount) })),
      methods: ranked(methods).map(([method, amount]) => ({ method, amount: r(amount) })),
    };
  }

  // Change from `before` to `now` as a fraction (0.12 = 12% more); null when there is nothing to compare with.
  function change(now, before) {
    return before > 0 ? (now - before) / before : null;
  }

  const api = { overview, overviewChange: change };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Finance = Object.assign(root.Finance || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
