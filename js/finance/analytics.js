'use strict';

// Sales patterns: when the restaurant is busy (weekday, hour, day by hour), how the days trend, dine-in against takeaway,
// and how each table and each server performs. Pure: it only reads the orders it is given.
// Used by both the browser (loaded as a script, see index.html) and the Node server (through js/finance.js).
// "Sales" here is what customers paid (tax and service included), as on the Reports screen. Refunded bills are left out.
(function (root) {
  const inNode = typeof module !== 'undefined' && module.exports;
  const { roundTo, decimalsOf } = inNode ? require('../shared.js') : root;
  const { num, inRange } = inNode ? require('./core.js') : root.Finance;

  const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const MAX_DAYS = 400;                 // the daily trend is cut to this many days (a year and a bit)
  const MAX_SEAT_MINUTES = 8 * 60;      // a bill open longer than this was left open, not a meal

  const dayStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const nextDay = t => { const d = new Date(t); d.setDate(d.getDate() + 1); return d.getTime(); };
  const weekdayIndex = t => (new Date(t).getDay() + 6) % 7;          // Monday = 0 … Sunday = 6

  const paidIn = (orders, a, b) => orders.filter(o => o.status === 'paid' && !!o.totals && inRange(o.paidAt, a, b));

  // A split-off bill has no table of its own but still belongs to the dining room.
  const isTakeaway = o => !o.tableId && !o.splitFrom;

  // `names.table(order)` and `names.server(userId)` give the words for the table and server columns.
  function salesPatterns(range, data, settings, names = {}) {
    const [a, b] = range;
    const r = n => roundTo(n, decimalsOf(settings));
    const tableName = names.table || (o => o.tableName || 'Table');
    const serverName = names.server || (id => id || '—');
    const orders = paidIn(data.orders || [], a, b);

    // How many of each weekday the period holds, so "average Friday" is not spoiled by a period with five Fridays.
    const dayCount = Array(7).fill(0);
    const trend = [];
    for (let t = dayStart(a), n = 0; t < b && n < MAX_DAYS; t = nextDay(t), n++) {
      dayCount[weekdayIndex(t)]++;
      trend.push({ date: t, sales: 0, orders: 0 });
    }
    const trendAt = new Map(trend.map(d => [d.date, d]));

    const heat = WEEKDAYS.map(() => Array(24).fill(0));
    const heatOrders = WEEKDAYS.map(() => Array(24).fill(0));
    const weekday = WEEKDAYS.map((name, i) => ({ day: i, name, days: dayCount[i], sales: 0, orders: 0 }));
    const hours = Array(24).fill(0);
    const channel = { dineIn: { orders: 0, sales: 0 }, takeaway: { orders: 0, sales: 0 } };
    const tables = new Map(), servers = new Map();
    let total = 0, seatedMinutes = 0, seatedBills = 0;

    for (const o of orders) {
      const sales = num(o.totals.total);
      const d = new Date(o.paidAt);
      const wd = weekdayIndex(o.paidAt), h = d.getHours();
      total += sales;
      heat[wd][h] += sales; heatOrders[wd][h]++;
      weekday[wd].sales += sales; weekday[wd].orders++;
      hours[h] += sales;
      const day = trendAt.get(dayStart(o.paidAt));
      if (day) { day.sales += sales; day.orders++; }

      const ch = isTakeaway(o) ? channel.takeaway : channel.dineIn;
      ch.orders++; ch.sales += sales;

      const minutes = (num(o.paidAt) - num(o.createdAt)) / 60000;
      const seated = !isTakeaway(o) && minutes > 0 && minutes <= MAX_SEAT_MINUTES;
      if (!isTakeaway(o)) {
        const key = o.tableId || ('split:' + (o.tableName || ''));
        const t = tables.get(key) || { name: tableName(o), orders: 0, sales: 0, minutes: 0, seated: 0 };
        t.orders++; t.sales += sales;
        if (seated) { t.minutes += minutes; t.seated++; seatedMinutes += minutes; seatedBills++; }
        tables.set(key, t);
      }
      const s = servers.get(o.staffId || '') || { userId: o.staffId || '', orders: 0, sales: 0, items: 0 };
      s.orders++; s.sales += sales; s.items += (o.items || []).reduce((n, l) => n + num(l.qty), 0);
      servers.set(o.staffId || '', s);
    }

    for (const w of weekday) {
      w.avgCheck = w.orders ? r(w.sales / w.orders) : 0;
      w.avgPerDay = w.days ? r(w.sales / w.days) : 0;
      w.ordersPerDay = w.days ? Math.round(w.orders / w.days * 10) / 10 : 0;
      w.sales = r(w.sales);
    }
    const trading = weekday.filter(w => w.days > 0 && w.orders > 0);
    const busiest = trading.length ? trading.reduce((x, y) => (y.avgPerDay > x.avgPerDay ? y : x)) : null;
    const quietest = trading.length > 1 ? trading.reduce((x, y) => (y.avgPerDay < x.avgPerDay ? y : x)) : null;

    const hourRows = hours.map((sales, hour) => ({ hour, sales: r(sales) }));
    const active = hourRows.filter(x => x.sales > 0);
    const peak = active.length ? active.reduce((x, y) => (y.sales > x.sales ? y : x)) : null;
    // Hours inside the trading span that bring in under a quarter of the peak hour: where staff cost more than they earn.
    const slow = peak ? hourRows.filter(x => x.hour >= active[0].hour && x.hour <= active[active.length - 1].hour && x.sales < peak.sales * 0.25) : [];

    const cell = (grid, gridOrders) => grid.map((row, wd) => row.map((sales, hour) => ({ sales: r(sales), orders: gridOrders[wd][hour] })));
    const heatmap = cell(heat, heatOrders);
    const heatMax = Math.max(0, ...heat.flat());

    return {
      range: [a, b],
      orders: orders.length, sales: r(total), avgCheck: orders.length ? r(total / orders.length) : 0,
      avgPerDay: trend.length ? r(total / trend.length) : 0,
      weekday, busiest, quietest,
      hours: hourRows, peakHour: peak ? peak.hour : null, slowHours: slow.map(x => x.hour),
      heatmap, heatMax: r(heatMax),
      trend: trend.map(d => ({ date: d.date, sales: r(d.sales), orders: d.orders })),
      channel: {
        dineIn: { orders: channel.dineIn.orders, sales: r(channel.dineIn.sales) },
        takeaway: { orders: channel.takeaway.orders, sales: r(channel.takeaway.sales) },
        takeawayShare: total > 0 ? channel.takeaway.sales / total : 0,
      },
      avgSeatMinutes: seatedBills ? Math.round(seatedMinutes / seatedBills) : null,
      tables: [...tables.values()].map(t => ({
        name: t.name, orders: t.orders, sales: r(t.sales), avgCheck: r(t.sales / t.orders),
        avgMinutes: t.seated ? Math.round(t.minutes / t.seated) : null,
        salesPerHour: t.minutes > 0 ? r(t.sales / (t.minutes / 60)) : null,
      })).sort((x, y) => y.sales - x.sales),
      servers: [...servers.values()].map(s => ({
        userId: s.userId, name: serverName(s.userId), orders: s.orders, sales: r(s.sales), avgCheck: r(s.sales / s.orders), itemsPerBill: Math.round(s.items / s.orders * 10) / 10,
      })).sort((x, y) => y.sales - x.sales),
    };
  }

  const api = { salesPatterns, WEEKDAYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Finance = Object.assign(root.Finance || {}, api);   // one global, so these short names cannot clash with anything else
})(typeof window !== 'undefined' ? window : globalThis);
