'use strict';

// Payment dialog opened from the order screen: discount, optional tip, one payment method or a split between methods.
const Checkout = {
  orderId: null,
  method: 'cash',
  tendered: '',
  tip: '',
  split: { cash: '', cashGiven: '', card: '', other: '' },
  discType: 'percent',
  discValue: '',

  open(orderId) {
    const order = Store.order(orderId);
    if (!order || !order.items.length) return toast('Add items first', 'error');
    this.orderId = orderId;
    this.method = 'cash';
    this.tendered = '';
    this.tip = '';
    this.split = { cash: '', cashGiven: '', card: '', other: '' };
    this.discType = order.discount ? order.discount.type : 'percent';
    this.discValue = order.discount ? String(order.discount.value) : '';
    this.render();
  },

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

  // Attaches a customer to the bill. A customer's standing discount is applied unless the bill already has a discount.
  attachCustomer(c) {
    const o = Store.order(this.orderId);
    if (!o) return;
    if (o.discount && o.discount.customerId) { o.discount = null; this.discValue = ''; }
    o.customerId = c.id;
    delete o.pointsUsed;
    if (c.discountPercent > 0) {
      if (o.discount) toast('This bill already has a discount, so the customer\'s discount was not added');
      else { o.discount = { type: 'percent', value: c.discountPercent, customerId: c.id }; this.discType = 'percent'; this.discValue = String(c.discountPercent); }
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

  tipAmount() { return Math.max(0, rmoney(parseFloat(this.tip) || 0)); },

  // After the discount changes, the points used must still fit.
  clampPoints(o) {
    const c = o.customerId && Store.customer(o.customerId);
    if (!o.pointsUsed) return;
    const max = c ? maxRedeemable(o, c, Store.settings) : 0;
    if (o.pointsUsed > max) { if (max > 0) o.pointsUsed = max; else delete o.pointsUsed; }
  },

  billTotal() {
    const order = Store.order(this.orderId);
    return order ? Store.totals(order).total : 0;
  },

  // What the customer hands over in total: the bill plus the tip.
  due() { return rmoney(this.billTotal() + this.tipAmount()); },

  render() {
    const order = Store.order(this.orderId);
    if (!order || order.status !== 'open') return Modal.close();
    const t = Store.totals(order);
    const s = Store.settings;
    const d = order.discount;
    const methods = [['cash', '💵 Cash'], ['card', '💳 Card'], ['other', '📱 Other'], ['split', '➗ Split']];
    const fmt = n => (n === '' ? '' : esc(n));

    const actions = {
      dtype: el => { this.discType = el.dataset.type; this.render(); },
      'apply-disc': () => this.applyDiscount(),
      'remove-disc': () => {
        const o = Store.order(this.orderId);
        o.discount = null;
        this.discValue = '';
        this.clampPoints(o);
        Store.save();
        App.render();
        this.render();
      },
      'pick-customer': () => Screens.customers.pick(c => this.attachCustomer(c), () => this.render()),
      'clear-customer': () => this.clearCustomer(),
      'max-points': el => this.setPoints(parseFloat(el.dataset.v)),
      'no-points': () => this.setPoints(0),
      method: el => { this.method = el.dataset.method; this.render(); },
      quick: el => {
        this.tendered = el.dataset.v;
        Modal.el().querySelector('[name=tendered]').value = el.dataset.v;
        this.updateChange();
      },
      tip: el => {
        this.tip = el.dataset.v;
        Modal.el().querySelector('[name=tip]').value = el.dataset.v;
        this.refreshAmounts();
      },
      rest: el => {
        // Put whatever is still unpaid on this method.
        const key = el.dataset.m;
        const others = ['cash', 'card', 'other'].filter(k => k !== key).reduce((n, k) => n + (parseFloat(this.split[k]) || 0), 0);
        const left = rmoney(this.due() - others);
        this.split[key] = left > 0 ? String(left) : '';
        Modal.el().querySelector(`[name=split-${key}]`).value = this.split[key];
        this.updateChange();
      },
      complete: () => this.complete(),
      __change: e => { if (e.target.name === 'points') this.setPoints(parseFloat(e.target.value)); },
      __input: e => {
        const n = e.target.name;
        if (n === 'tendered') { this.tendered = e.target.value; this.updateChange(); }
        else if (n === 'disc') this.discValue = e.target.value;
        else if (n === 'tip') { this.tip = e.target.value; this.refreshAmounts(); }
        else if (n && n.startsWith('split-')) { this.split[n.slice(6)] = e.target.value; this.updateChange(); }
      },
    };
    actions.__enter = () => {
      if (document.activeElement && document.activeElement.name === 'disc') actions['apply-disc']();
      else actions.complete();
    };

    const cust = order.customerId && Store.customer(order.customerId);
    const loy = loyaltyOf(s);
    const maxPts = cust ? maxRedeemable(order, cust, s) : 0;
    const tipPercents = [5, 10, 15];
    Modal.open({
      title: `Payment · ${whereLabel(order)} #${orderNo(order)}`,
      wide: true,
      body: `
        <div class="summary totals">${totalsHTML(t)}</div>
        <div class="field-label">Discount${d ? ` — ${d.type === 'percent' ? d.value + '%' : money(d.value)} applied` : ''}</div>
        <div class="discount-row">
          <div class="seg">
            <button data-act="dtype" data-type="percent" class="${this.discType === 'percent' ? 'active' : ''}">%</button>
            <button data-act="dtype" data-type="amount" class="${this.discType === 'amount' ? 'active' : ''}">${esc(s.currency)}</button>
          </div>
          <input class="input" name="disc" type="number" min="0" step="${moneyStep()}" inputmode="decimal" placeholder="0" value="${esc(this.discValue)}">
          <button class="btn" data-act="apply-disc">Apply</button>
          ${d ? '<button class="btn danger" data-act="remove-disc">Remove</button>' : ''}
        </div>
        <div class="field-label">Customer</div>
        <div class="cust-line">
          <span>${cust
            ? `👤 <b>${esc(cust.name)}</b>${loy.enabled ? ` · ${qtyText(cust.points)} points` : ''}${cust.discountPercent ? ` · ${cust.discountPercent}% discount` : ''}`
            : '<span class="muted">No customer on this bill</span>'}</span>
          <span class="row-actions">
            <button class="btn small" data-act="pick-customer">${cust ? 'Change' : 'Choose customer'}</button>
            ${cust ? '<button class="btn small danger" data-act="clear-customer">Remove</button>' : ''}
          </span>
        </div>
        ${cust && loy.enabled && (maxPts > 0 || order.pointsUsed) ? `
          <div class="discount-row">
            <label class="field grow"><span>Use points (up to ${qtyText(maxPts + (order.pointsUsed || 0))})</span>
              <input class="input" name="points" type="number" min="0" step="${moneyStep()}" inputmode="decimal" placeholder="0" value="${order.pointsUsed || ''}"></label>
            <button class="btn small" data-act="max-points" data-v="${maxPts + (order.pointsUsed || 0)}">Use all</button>
            ${order.pointsUsed ? '<button class="btn small" data-act="no-points">None</button>' : ''}
          </div>` : ''}
        ${cust && loy.enabled ? `<p class="muted small">This bill earns ${qtyText(loyaltyEarn(t.total, s))} points.</p>` : ''}
        <div class="field-label">Tip (optional)</div>
        <div class="discount-row">
          <input class="input" name="tip" type="number" min="0" step="${moneyStep()}" inputmode="decimal" placeholder="0" value="${esc(this.tip)}">
          ${tipPercents.map(p => `<button class="btn small" data-act="tip" data-v="${rmoney(t.total * p / 100)}">${p}%</button>`).join('')}
          <button class="btn small" data-act="tip" data-v="">No tip</button>
        </div>
        <div class="tip-line" data-role="due"></div>
        <div class="field-label">Payment method</div>
        <div class="pay-methods four">
          ${methods.map(([m, label]) => `<button data-act="method" data-method="${m}" class="${this.method === m ? 'active' : ''}">${label}</button>`).join('')}
        </div>
        ${this.method === 'cash' ? `
          <label class="field"><span>Cash received</span>
            <input class="input big-input" name="tendered" type="number" min="0" step="${moneyStep()}" inputmode="decimal" value="${esc(this.tendered)}" autofocus></label>
          <div class="quick-cash" data-role="quick">${this.quickHTML()}</div>` : ''}
        ${this.method === 'split' ? `
          <p class="muted small">Enter how much is paid by each method. The amounts must add up to the total to pay.</p>
          ${[['cash', '💵 Cash'], ['card', '💳 Card'], ['other', '📱 Other']].map(([k, label]) => `
            <div class="split-row">
              <span>${label}</span>
              <input class="input" name="split-${k}" type="number" min="0" step="${moneyStep()}" inputmode="decimal" placeholder="0" value="${fmt(this.split[k])}">
              <button class="btn small" data-act="rest" data-m="${k}">Rest</button>
            </div>`).join('')}
          <label class="field spaced"><span>Cash handed over (only if more than the cash amount)</span>
            <input class="input" name="split-cashGiven" type="number" min="0" step="${moneyStep()}" inputmode="decimal" value="${fmt(this.split.cashGiven)}"></label>` : ''}
        <div class="change" data-role="change"></div>`,
      footer: `<button class="btn" data-act="__close">Cancel</button>
        <button class="btn primary big" data-act="complete" data-role="complete">Complete payment</button>`,
      actions,
    });
    this.refreshAmounts();
  },

  quickHTML() {
    return this.quickCash(this.due()).map((v, i) => `<button class="btn small" data-act="quick" data-v="${v}">${i === 0 ? 'Exact ' : ''}${money(v)}</button>`).join('');
  },

  // Tip changed: the amount to pay and the quick-cash buttons follow it.
  refreshAmounts() {
    const el = Modal.el();
    if (!el) return;
    const tip = this.tipAmount();
    el.querySelector('[data-role=due]').innerHTML = tip
      ? `Bill ${money(this.billTotal())} + tip ${money(tip)} = <b>${money(this.due())}</b>`
      : `To pay: <b>${money(this.due())}</b>`;
    const quick = el.querySelector('[data-role=quick]');
    if (quick) quick.innerHTML = this.quickHTML();
    el.querySelector('[data-role=complete]').textContent = `Complete payment · ${money(this.due())}`;
    this.updateChange();
  },

  // Cash given and change (single method) or how much is left to allocate (split).
  updateChange() {
    const el = Modal.el();
    const order = Store.order(this.orderId);
    if (!el || !order) return;
    const btn = el.querySelector('[data-role=complete]');
    const box = el.querySelector('[data-role=change]');
    const due = this.due();
    if (this.method === 'cash') {
      const diff = rmoney((parseFloat(this.tendered) || 0) - due);
      box.className = 'change' + (diff < 0 ? ' short' : '');
      box.innerHTML = diff < 0 ? `Still due <span>${money(-diff)}</span>` : `Change <span>${money(diff)}</span>`;
      btn.disabled = diff < 0;
    } else if (this.method === 'split') {
      const given = ['cash', 'card', 'other'].reduce((n, k) => n + (parseFloat(this.split[k]) || 0), 0);
      const left = rmoney(due - given);
      const parts = ['cash', 'card', 'other'].filter(k => (parseFloat(this.split[k]) || 0) > 0).length;
      const cash = parseFloat(this.split.cash) || 0;
      const handed = parseFloat(this.split.cashGiven);
      const cashShort = cash > 0 && this.split.cashGiven !== '' && handed < cash;
      box.className = 'change' + (left !== 0 || cashShort ? ' short' : '');
      box.innerHTML = left > 0 ? `Still to allocate <span>${money(left)}</span>`
        : left < 0 ? `Too much by <span>${money(-left)}</span>`
          : cashShort ? 'Cash handed over is less than the cash amount'
            : `Change <span>${money(cash > 0 && handed > cash ? rmoney(handed - cash) : 0)}</span>`;
      btn.disabled = left !== 0 || parts < 2 || cashShort;
    } else {
      box.className = 'change';
      box.innerHTML = '';
      btn.disabled = false;
    }
  },

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
      for (const k of ['cash', 'card', 'other']) {
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

  complete() {
    const order = Store.order(this.orderId);
    if (!order || order.status !== 'open') return Modal.close();
    try {
      Store.payOrder(order, this.buildPayment(Store.totals(order).total), App.user.id);
    } catch (e) {
      return toast(e.message, 'error');
    }
    showReceipt(order.id, { title: 'Payment complete ✓', onClose: () => App.go('tables') });
  },
};
