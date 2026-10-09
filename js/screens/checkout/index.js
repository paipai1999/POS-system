'use strict';

// Checkout (the payment dialog). This file draws it and completes the payment; the customer/points part is in customer.js and
// the amounts, discount and payment object are in payment.js.

// Payment dialog opened from the order screen: discount, optional tip, one payment method or a split between methods.

const Checkout = {
  orderId: null,

  method: 'cash',

  tendered: '',

  tip: '',

  split: { cash: '', cashGiven: '', card: '', other: '', credit: '' },

  discType: 'percent',

  discValue: '',

  open(orderId) {
    const order = Store.order(orderId);
    if (!order || !order.items.length) return toast('Add items first', 'error');
    this.orderId = orderId;
    this.method = 'cash';
    this.tendered = '';
    this.tip = '';
    this.split = { cash: '', cashGiven: '', card: '', other: '', credit: '' };
    this.discType = order.discount ? order.discount.type : 'percent';
    this.discValue = order.discount ? String(order.discount.value) : '';
    this.render();
  },

  render() {
    const order = Store.order(this.orderId);
    if (!order || order.status !== 'open') return Modal.close();
    const t = Store.totals(order);
    const s = Store.settings;
    const d = order.discount;
    const credit = this.creditInfo();
    const methods = [['cash', '💵 Cash'], ['card', '💳 Card'], ['other', '📱 Other'], ...(credit ? [['credit', '🧾 On account']] : []), ['split', '➗ Split']];
    if (this.method === 'credit' && !credit) this.method = 'cash';   // the customer was changed or removed
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
        const others = this.splitKeys().filter(k => k !== key).reduce((n, k) => n + (parseFloat(this.split[k]) || 0), 0);
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
    const cd = cust ? customerDiscount(cust, s) : { percent: 0 };
    const level = cust ? tierOf(cust, s) : null;
    const lapsed = cust && pointsLapsed(cust, s) && cust.points > 0;
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
            ? `👤 <b>${esc(cust.name)}</b>${level ? ` · ${esc(level.name)}` : ''}${loy.enabled ? ` · ${qtyText(pointsOf(cust, s))} points${lapsed ? ` (${qtyText(cust.points)} expired)` : ''}` : ''}${cd.percent ? ` · ${cd.percent}% off (${esc(discountReason(cd))})` : ''}`
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
        ${cust && loy.enabled ? `<p class="muted small">This bill earns ${qtyText(loyaltyEarn(t.total, s, cust))} points.</p>` : ''}
        <div class="field-label">Tip (optional)</div>
        <div class="discount-row">
          <input class="input" name="tip" type="number" min="0" step="${moneyStep()}" inputmode="decimal" placeholder="0" value="${esc(this.tip)}">
          ${tipPercents.map(p => `<button class="btn small" data-act="tip" data-v="${rmoney(t.total * p / 100)}">${p}%</button>`).join('')}
          <button class="btn small" data-act="tip" data-v="">No tip</button>
        </div>
        <div class="tip-line" data-role="due"></div>
        <div class="field-label">Payment method</div>
        <div class="pay-methods ${methods.length > 4 ? 'five' : 'four'}">
          ${methods.map(([m, label]) => `<button data-act="method" data-method="${m}" class="${this.method === m ? 'active' : ''}">${label}</button>`).join('')}
        </div>
        ${this.method === 'cash' ? `
          <label class="field"><span>Cash received</span>
            <input class="input big-input" name="tendered" type="number" min="0" step="${moneyStep()}" inputmode="decimal" value="${esc(this.tendered)}" autofocus></label>
          <div class="quick-cash" data-role="quick">${this.quickHTML()}</div>` : ''}
        ${this.method === 'credit' && credit ? `
          <p class="credit-line"><b>${esc(credit.customer.name)}</b> <span>owes</span> ${money(credit.owing)} · <span>credit limit</span> ${money(credit.limit)} · <span>available</span> <b>${money(credit.room)}</b></p>
          <p class="muted small">The whole bill goes on their account and is paid later. A tip cannot be put on account.</p>` : ''}
        ${this.method === 'split' ? `
          <p class="muted small">Enter how much is paid by each method. The amounts must add up to the total to pay.${credit ? ` <span>${esc(credit.customer.name)} can put up to ${money(credit.room)} on account.</span>` : ''}</p>
          ${[['cash', '💵 Cash'], ['card', '💳 Card'], ['other', '📱 Other'], ...(credit ? [['credit', '🧾 On account']] : [])].map(([k, label]) => `
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
      const keys = this.splitKeys();
      const given = keys.reduce((n, k) => n + (parseFloat(this.split[k]) || 0), 0);
      const left = rmoney(due - given);
      const parts = keys.filter(k => (parseFloat(this.split[k]) || 0) > 0).length;
      const onAccount = parseFloat(this.split.credit) || 0;
      const credit = this.creditInfo();
      const tooMuchCredit = onAccount > 0 && (!credit || onAccount > credit.room + 0.005 || onAccount > this.billTotal() + 0.005);
      const cash = parseFloat(this.split.cash) || 0;
      const handed = parseFloat(this.split.cashGiven);
      const cashShort = cash > 0 && this.split.cashGiven !== '' && handed < cash;
      box.className = 'change' + (left !== 0 || cashShort || tooMuchCredit ? ' short' : '');
      box.innerHTML = left > 0 ? `Still to allocate <span>${money(left)}</span>`
        : left < 0 ? `Too much by <span>${money(-left)}</span>`
          : cashShort ? 'Cash handed over is less than the cash amount'
            : tooMuchCredit ? 'More than the customer can put on account'
              : `Change <span>${money(cash > 0 && handed > cash ? rmoney(handed - cash) : 0)}</span>`;
      btn.disabled = left !== 0 || parts < 2 || cashShort || tooMuchCredit;
    } else if (this.method === 'credit') {
      const credit = this.creditInfo();
      const problem = !credit ? 'Choose a customer with credit' : this.tipAmount() > 0 ? 'A tip cannot be put on account' : this.billTotal() > credit.room + 0.005 ? 'More than the customer can put on account' : '';
      box.className = 'change' + (problem ? ' short' : '');
      box.innerHTML = problem;
      btn.disabled = !!problem;
    } else {
      box.className = 'change';
      box.innerHTML = '';
      btn.disabled = false;
    }
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
