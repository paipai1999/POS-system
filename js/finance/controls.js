'use strict';

// Controls: discounts, refunds and voids by person, with the big ones listed.
// Used by both the browser (loaded as a script, see index.html) and the Node server (through js/finance.js).
(function (root) {
  const inNode = typeof module !== 'undefined' && module.exports;
  const { roundTo, decimalsOf, computeTotals } = inNode ? require('../shared.js') : root;
  const { num, inRange, sum, sold, refunded, refundTime } = inNode ? require('./core.js') : root.Finance;

  // ----- controls: discounts, refunds and voids by person -----
  function controls(range, data, settings) {
    const [a, b] = range;
    const r = n => roundTo(n, decimalsOf(settings));
    const orders = data.orders || [];
    const soldOrders = sold(orders, a, b), refundOrders = refunded(orders, a, b);
    const voidOrders = orders.filter(o => o.status === 'void' && inRange(o.voidedAt || o.createdAt, a, b));
    const staff = new Map();
    const row = id => {
      const key = id || '';
      if (!staff.has(key)) staff.set(key, { userId: key, discounts: 0, discountAmount: 0, refunds: 0, refundAmount: 0, voids: 0, voidAmount: 0 });
      return staff.get(key);
    };
    const disc = { count: 0, amount: 0, manual: { count: 0, amount: 0 }, automatic: { count: 0, amount: 0 } };
    const big = [];
    for (const o of soldOrders) {
      const amount = num(o.totals.discount);
      if (!(amount > 0)) continue;
      const kind = o.discount && o.discount.customerId ? 'automatic' : 'manual';
      const who = (o.discount && o.discount.by) || o.cashierId || o.staffId;
      disc.count++; disc.amount += amount; disc[kind].count++; disc[kind].amount += amount;
      const x = row(who); x.discounts++; x.discountAmount += amount;
      const percent = num(o.totals.subtotal) > 0 ? amount / num(o.totals.subtotal) : 0;
      if (percent >= 0.2) big.push({ orderId: o.id, number: o.number, amount: r(amount), percent, userId: who || '', at: o.paidAt, kind });
    }
    let refundAmount = 0;
    const refundList = [];
    for (const o of refundOrders) {
      const amount = num(o.totals.total);
      refundAmount += amount;
      const x = row(o.refundedBy); x.refunds++; x.refundAmount += amount;
      refundList.push({ orderId: o.id, number: o.number, amount: r(amount), userId: o.refundedBy || '', at: refundTime(o), paidAt: o.paidAt });
    }
    let voidAmount = 0, afterKitchen = 0;
    const voidList = [];
    for (const o of voidOrders) {
      const amount = computeTotals(o, settings).total;
      const sent = (o.items || []).some(l => num(l.sentQty) > 0);
      voidAmount += amount; if (sent) afterKitchen++;
      const x = row(o.voidedBy); x.voids++; x.voidAmount += amount;
      voidList.push({ orderId: o.id, number: o.number, amount: r(amount), userId: o.voidedBy || '', at: o.voidedAt || o.createdAt, sent });
    }
    const gross = sum(soldOrders, o => num(o.totals.subtotal));
    const byAmount = (x, y) => y.amount - x.amount;
    return {
      range: [a, b],
      discounts: { count: disc.count, amount: r(disc.amount), percentOfSales: gross > 0 ? disc.amount / gross : 0, manual: { count: disc.manual.count, amount: r(disc.manual.amount) }, automatic: { count: disc.automatic.count, amount: r(disc.automatic.amount) } },
      refunds: { count: refundOrders.length, amount: r(refundAmount) },
      voids: { count: voidOrders.length, amount: r(voidAmount), afterKitchen },
      staff: [...staff.values()].map(x => ({ ...x, discountAmount: r(x.discountAmount), refundAmount: r(x.refundAmount), voidAmount: r(x.voidAmount) }))
        .sort((x, y) => (y.discountAmount + y.refundAmount + y.voidAmount) - (x.discountAmount + x.refundAmount + x.voidAmount)),
      bigDiscounts: big.sort(byAmount).slice(0, 15),
      refundList: refundList.sort(byAmount).slice(0, 15),
      voidList: voidList.sort(byAmount).slice(0, 15),
    };
  }

  const api = { controls };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Finance = Object.assign(root.Finance || {}, api);   // one global, so these short names cannot clash with anything else
})(typeof window !== 'undefined' ? window : globalThis);
