'use strict';

// Checkout: amounts due, quick cash buttons, the discount and building the payment to send.
Object.assign(Checkout, {
  quickCash(due) {
    const values = [due];
    // Notes people actually hand over: 5/10/20/50/100 in dollars, 500…50,000 in kyat.
    const steps = decimalsOf(Store.settings) === 0 ? [500, 1000, 5000, 10000, 50000] : [5, 10, 20, 50, 100];
    for (const step of steps) {
      const v = Math.ceil(due / step) * step;
      if (v > due && !values.includes(v)) values.push(v);
    }
    return values.slice(0, 5);
  },

  tipAmount() { return Math.max(0, rmoney(parseFloat(this.tip) || 0)); },

  billTotal() {
    const order = Store.order(this.orderId);
    return order ? Store.totals(order).total : 0;
  },

  // What the customer hands over in total: the bill plus the tip.
  due() { return rmoney(this.billTotal() + this.tipAmount()); },

  applyDiscount() {
    const value = parseFloat(this.discValue);
    if (!(value > 0)) return toast('Enter a discount amount', 'error');
    if (this.discType === 'percent' && value > 100) return toast('Percent discount cannot exceed 100', 'error');
    const type = this.discType;
    requireManager('Apply a discount to this order.', mgr => {
      const o = Store.order(this.orderId);
      o.discount = { type, value: type === 'percent' ? roundTo(value, 2) : rmoney(value), by: mgr.id };
      this.clampPoints(o);
      Store.save();
      App.render();
      this.render();
      toast('Discount applied', 'ok');
    }, () => this.render());
  },

  buildPayment(total) {
    const tip = this.tipAmount();
    const due = rmoney(total + tip);
    const payment = { method: this.method, amount: total };
    if (tip) payment.tip = tip;
    if (this.method === 'cash') {
      const tendered = rmoney(parseFloat(this.tendered) || 0);
      if (tendered < due) throw new Error('Cash received is less than the total');
      payment.tendered = tendered;
      payment.change = rmoney(tendered - due);
    } else if (this.method === 'split') {
      const parts = [];
      for (const k of this.splitKeys()) {
        const amount = rmoney(parseFloat(this.split[k]) || 0);
        if (!(amount > 0)) continue;
        const part = { method: k, amount };
        if (k === 'cash') {
          const given = this.split.cashGiven === '' ? amount : rmoney(parseFloat(this.split.cashGiven) || 0);
          if (given < amount) throw new Error('Cash received is less than the total');
          part.tendered = given;
          part.change = rmoney(given - amount);
        }
        parts.push(part);
      }
      if (parts.length < 2 || Math.abs(rmoney(parts.reduce((n, p) => n + p.amount, 0)) - due) > 0.005) {
        throw new Error('The parts of a split payment must add up to the total');
      }
      payment.parts = parts;
    }
    return payment;
  },
});
