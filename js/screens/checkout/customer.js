'use strict';

// Checkout: attaching a customer and spending their loyalty points.
Object.assign(Checkout, {
  // Attaches a customer to the bill. A customer's standing discount is applied unless the bill already has a discount.
  attachCustomer(c) {
    const o = Store.order(this.orderId);
    if (!o) return;
    if (o.discount && o.discount.customerId) { o.discount = null; this.discValue = ''; }
    o.customerId = c.id;
    delete o.pointsUsed;
    const cd = customerDiscount(c, Store.settings);
    if (cd.percent > 0) {
      if (o.discount) toast('This bill already has a discount, so the customer\'s discount was not added');
      else { o.discount = { type: 'percent', value: cd.percent, customerId: c.id }; this.discType = 'percent'; this.discValue = String(cd.percent); }
    }
    Store.save();
    App.render();
    this.render();
  },

  clearCustomer() {
    const o = Store.order(this.orderId);
    if (!o) return;
    delete o.customerId;
    delete o.pointsUsed;
    if (o.discount && o.discount.customerId) { o.discount = null; this.discValue = ''; }
    Store.save();
    App.render();
    this.render();
  },

  // Points used are limited to a share of the bill after discount, and to what the customer has.
  setPoints(n) {
    const o = Store.order(this.orderId);
    const c = o && o.customerId && Store.customer(o.customerId);
    if (!o || !c) return;
    const value = Math.min(Math.max(0, rmoney(n || 0)), maxRedeemable(o, c, Store.settings));
    if (value > 0) o.pointsUsed = value; else delete o.pointsUsed;
    Store.save();
    App.render();
    this.render();
  },

  // The customer's credit, when the bill has a customer who may buy on account: { customer, limit, owing, room }, else null.
  creditInfo() {
    const o = Store.order(this.orderId);
    const c = o && o.customerId && Store.customer(o.customerId);
    if (!c || c.active === false || !(Number(c.creditLimit) > 0)) return null;
    return { customer: c, limit: c.creditLimit, owing: c.owing || 0, room: Math.max(0, rmoney(c.creditLimit - (c.owing || 0))) };
  },

  // The methods a bill may be split between (on account only for a customer with credit).
  splitKeys() {
    return this.creditInfo() ? ['cash', 'card', 'other', 'credit'] : ['cash', 'card', 'other'];
  },

  // After the discount changes, the points used must still fit.
  clampPoints(o) {
    const c = o.customerId && Store.customer(o.customerId);
    if (!o.pointsUsed) return;
    const max = c ? maxRedeemable(o, c, Store.settings) : 0;
    if (o.pointsUsed > max) { if (max > 0) o.pointsUsed = max; else delete o.pointsUsed; }
  },
});
