'use strict';

// Tips: what was tipped, who took the bills, and how the pool divides when it is shared by hours worked.
// A tip belongs to the person who took the bill (`staffId`); it is not part of sales (see Finance → Cash flow). Paying tips out is
// recorded as an expense in the category "Tips paid to staff", which is how "paid out" and "still to pay" are worked out.
// The shared pool is the whole period's tips divided in proportion to the hours each person worked (js/finance/attendance.js), so
// anyone who clocked hours takes part, kitchen included unless `excludeRoles` leaves them out. The shares always add up to the pool.
// Used by both the browser (loaded as a script, see index.html) and the Node server (through js/finance.js).
(function (root) {
  const inNode = typeof module !== 'undefined' && module.exports;
  const { roundTo, decimalsOf } = inNode ? require('../shared.js') : root;
  const { num, inRange, sum, sold, live, TIPS_CATEGORY } = inNode ? require('./core.js') : root.Finance;
  const attendanceReport = inNode ? require('./attendance.js').attendanceReport : (...a) => root.Finance.attendanceReport(...a);

  function tipsReport(range, data, settings, { excludeRoles = [] } = {}) {
    const [a, b] = range;
    const dec = decimalsOf(settings);
    const r = n => roundTo(n, dec);
    const users = new Map((data.users || []).map(u => [u.id, u]));
    const hours = attendanceReport(range, data, settings);

    const rows = new Map();
    const row = id => {
      const key = id || '';
      if (!rows.has(key)) {
        const u = users.get(key);
        rows.set(key, { userId: key, name: u ? u.name : key ? 'Former staff' : 'Unknown', role: u ? u.role : null, bills: 0, own: 0, hours: 0, share: 0 });
      }
      return rows.get(key);
    };

    const byMethod = { cash: 0, card: 0, other: 0 };
    let total = 0, bills = 0;
    for (const o of sold(data.orders || [], a, b)) {
      const tip = num(o.payment && o.payment.tip);
      if (!(tip > 0)) continue;
      const x = row(o.staffId || o.cashierId);
      x.bills++; x.own += tip; total += tip; bills++;
      byMethod[o.payment.method === 'cash' || o.payment.method === 'card' ? o.payment.method : 'other'] += tip;
    }
    const paidOut = sum(live(data.expenses).filter(e => e.category === TIPS_CATEGORY && inRange(e.date, a, b)), e => num(e.amount));

    // The shared pool: by the hours each person worked.
    const sharers = hours.people.filter(p => p.hours > 0 && !excludeRoles.includes(p.role));
    for (const p of hours.people) if (p.hours > 0 || rows.has(p.userId)) row(p.userId).hours = p.hours;
    const poolHours = sum(sharers, p => p.hours);
    if (poolHours > 0 && total > 0) {
      let given = 0;
      for (const p of sharers) { const x = row(p.userId); x.share = r(total * p.hours / poolHours); given += x.share; }
      const top = sharers.reduce((m, p) => (p.hours > m.hours ? p : m), sharers[0]);
      row(top.userId).share = r(row(top.userId).share + total - given);   // what rounding left over goes to the longest worker
    }

    const people = [...rows.values()].map(x => ({ ...x, own: r(x.own), shared: x.share > 0 })).sort((x, y) => y.own - x.own || y.share - x.share || x.name.localeCompare(y.name));
    return {
      range: [a, b], total: r(total), bills, paidOut: r(paidOut), toPay: r(total - paidOut), byMethod: Object.fromEntries(Object.entries(byMethod).map(([k, v]) => [k, r(v)])),
      people, poolHours: roundTo(poolHours, 2),
      canShare: poolHours > 0,
      // People who were tipped but clocked no hours cannot take part in the shared pool.
      withoutHours: people.filter(p => p.own > 0 && !(p.hours > 0)).map(p => p.name),
    };
  }

  const api = { tipsReport };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Finance = Object.assign(root.Finance || {}, api);   // one global, so these short names cannot clash with anything else
})(typeof window !== 'undefined' ? window : globalThis);
