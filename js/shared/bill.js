'use strict';

// A bill: its totals, the price of a line, and where an open order is in its life.
// Used by both the browser app (loaded as a script, see index.html) and the Node server (through js/shared.js).
(function (root) {
  // In Node the other shared modules are required; in the browser they are already on `window`.
  const shared = mod => (typeof module !== 'undefined' && module.exports ? require('./' + mod + '.js') : root);
  const { roundTo, decimalsOf } = shared('core');

  // The one place order totals are calculated: the browser shows them and the server re-checks them at payment.
  function computeTotals(order, settings) {
    const r = n => roundTo(n, decimalsOf(settings));
    const subtotal = r(order.items.reduce((sum, l) => sum + l.price * l.qty, 0));
    let discount = 0;
    if (order.discount && order.discount.value > 0) {
      discount = order.discount.type === 'percent' ? subtotal * order.discount.value / 100 : order.discount.value;
    }
    discount = r(Math.min(discount, subtotal));
    const afterDiscount = subtotal - discount;
    // Loyalty points the customer spends (1 point = 1 unit of money) come off before service charge and tax.
    const points = r(Math.min(Math.max(0, Number(order.pointsUsed) || 0), afterDiscount));
    const net = afterDiscount - points;
    const serviceRate = Number(settings.serviceRate) || 0;
    const taxRate = Number(settings.taxRate) || 0;
    const service = r(net * serviceRate / 100);
    const tax = r((net + service) * taxRate / 100);
    const total = r(net + service + tax);
    return { subtotal, discount, ...(points ? { points } : {}), serviceRate, service, taxRate, tax, total };
  }

  // The price of a line = menu price + the options picked (kept to the cent; the bill rounds as a whole).
  function lineUnitPrice(product, mods) {
    return roundTo(Number(product.price) + (mods || []).reduce((n, m) => n + Number(m.price || 0), 0), 2);
  }

  // Where an open order is in its life, for the dashboard. Its kitchen tickets decide first (food that is ready to serve
  // beats food still cooking); then whether anything is still unsent; an order with everything sent and served is
  // waiting for payment.
  function orderStage(order, tickets) {
    const mine = (tickets || []).filter(t => t.orderId === order.id);
    if (mine.some(t => t.status === 'ready')) return 'ready';
    if (mine.some(t => t.status === 'new')) return 'cooking';
    if (!order.items.length || order.items.some(l => l.qty > (l.sentQty || 0))) return 'ordering';
    return 'payment';
  }

  const api = { computeTotals, lineUnitPrice, orderStage };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
