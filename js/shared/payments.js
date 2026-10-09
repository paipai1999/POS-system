'use strict';

// Payments: methods, a split bill, and checking a payment against the bill.
// Used by both the browser app (loaded as a script, see index.html) and the Node server (through js/shared.js).
(function (root) {
  // In Node the other shared modules are required; in the browser they are already on `window`.
  const shared = mod => (typeof module !== 'undefined' && module.exports ? require('./' + mod + '.js') : root);
  const { roundTo, decimalsOf } = shared('core');
  const { computeTotals } = shared('bill');

  // ----- payments -----
  // A payment is { method: 'cash'|'card'|'other'|'credit'|'split', amount (the bill), tip, tendered/change (cash), parts[] (split) }.
  // What the customer handed over in total is amount + tip. 'credit' means "on account": the customer takes the goods now
  // and pays later (see customer.creditLimit / customer.owing); no money changes hands, so it is not cash, card or bank.
  const PAY_METHODS = ['cash', 'card', 'other', 'credit'];

  // How much of a payment went through each method (tips included): { cash: 12, card: 8 }.
  function paymentByMethod(payment) {
    if (!payment) return {};
    if (payment.method === 'split' && Array.isArray(payment.parts)) {
      const out = {};
      for (const part of payment.parts) out[part.method] = (out[part.method] || 0) + Number(part.amount || 0);
      return out;
    }
    return { [payment.method]: Number(payment.amount || 0) + Number(payment.tip || 0) };
  }

  // Cash that stayed in the till for this payment (what was handed over minus the change given back).
  function paymentCash(payment) {
    return paymentByMethod(payment).cash || 0;
  }

  // Putting `amount` on a customer's account: the customer must be on the bill, have a credit limit, and have room left.
  function checkCredit(customer, amount, dec) {
    if (!customer) throw new Error('Choose a customer to put the bill on account');
    if (customer.active === false) throw new Error(`${customer.name} is not active`);
    const limit = Number(customer.creditLimit) || 0;
    if (!(limit > 0)) throw new Error(`${customer.name} has no credit. A manager can set a credit limit.`);
    const room = roundTo(limit - (Number(customer.owing) || 0), dec);
    if (amount > room + 0.005) throw new Error(`Credit limit: only ${room} is available for ${customer.name}`);
  }

  // Checks a payment against the bill and returns the figures to store: { totals, payment }.
  // Throws an Error with a message fit to show the cashier. The server and the browser both use this.
  // `customer` is the customer on the bill (needed to put something on account).
  function settleOrder(order, payment, settings, customer = null) {
    const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
    const dec = decimalsOf(settings);
    const t = computeTotals(order, settings);
    const pay = isObj(payment) ? payment : {};
    const tip = pay.tip === undefined || pay.tip === null || pay.tip === '' ? 0 : roundTo(Number(pay.tip), dec);
    if (!(tip >= 0) || tip > Math.max(t.total * 10, 1000)) throw new Error('Invalid tip');
    const due = roundTo(t.total + tip, dec); // the bill plus the tip is what the customer hands over
    const out = { method: pay.method, amount: t.total };
    if (tip) out.tip = tip;
    if (pay.method === 'cash') {
      const tendered = roundTo(Number(pay.tendered), dec);
      if (!(tendered >= due)) throw new Error('Cash received is less than the total');
      out.tendered = tendered;
      out.change = roundTo(tendered - due, dec);
    } else if (pay.method === 'credit') {
      if (tip) throw new Error('A bill on account cannot have a tip');   // the tip is handed over now, not put on the account
      checkCredit(customer, t.total, dec);
    } else if (pay.method === 'split') {
      const parts = Array.isArray(pay.parts) ? pay.parts : [];
      if (parts.length < 2 || parts.length > PAY_METHODS.length) throw new Error('A split payment needs two or three parts');
      const seen = new Set();
      let sum = 0;
      out.parts = parts.map(p => {
        if (!isObj(p) || !PAY_METHODS.includes(p.method) || seen.has(p.method)) throw new Error('Invalid payment method');
        seen.add(p.method);
        const amount = roundTo(Number(p.amount), dec);
        if (!(amount > 0)) throw new Error('Invalid split amount');
        sum += amount;
        const part = { method: p.method, amount };
        if (p.method === 'credit') {
          if (amount > t.total + 0.005) throw new Error('Only the bill itself can be put on account, not the tip');
          checkCredit(customer, amount, dec);
        }
        if (p.method === 'cash') {
          const tendered = roundTo(Number(p.tendered ?? amount), dec);
          if (!(tendered >= amount)) throw new Error('Cash received is less than the total');
          part.tendered = tendered;
          part.change = roundTo(tendered - amount, dec);
        }
        return part;
      });
      if (Math.abs(roundTo(sum, dec) - due) > 0.005) throw new Error('The parts of a split payment must add up to the total');
    } else if (!PAY_METHODS.includes(pay.method)) {
      throw new Error('Invalid payment method');
    }
    return { totals: t, payment: out };
  }

  const api = { PAY_METHODS, paymentByMethod, paymentCash, settleOrder };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
