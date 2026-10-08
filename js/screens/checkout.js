'use strict';

// Payment dialog opened from the order screen.
const Checkout = {
  orderId: null,
  method: 'cash',
  tendered: '',
  discType: 'percent',
  discValue: '',

  open(orderId) {
    const order = Store.order(orderId);
    if (!order || !order.items.length) return toast('Add items first', 'error');
    this.orderId = orderId;
    this.method = 'cash';
    this.tendered = '';
    this.discType = order.discount ? order.discount.type : 'percent';
    this.discValue = order.discount ? String(order.discount.value) : '';
    this.render();
  },

  quickCash(total) {
    const values = [total];
    for (const step of [5, 10, 20, 50, 100]) {
      const v = Math.ceil(total / step) * step;
      if (v > total && !values.includes(v)) values.push(v);
    }
    return values.slice(0, 5);
  },

  render() {
    const order = Store.order(this.orderId);
    if (!order || order.status !== 'open') return Modal.close();
    const t = Store.totals(order);
    const s = Store.settings;
    const d = order.discount;
    const methods = [['cash', '💵 Cash'], ['card', '💳 Card'], ['other', '📱 Other']];

    const actions = {
      dtype: el => { this.discType = el.dataset.type; this.render(); },
      'apply-disc': () => this.applyDiscount(),
      'remove-disc': () => {
        const o = Store.order(this.orderId);
        o.discount = null;
        this.discValue = '';
        Store.save();
        App.render();
        this.render();
      },
      method: el => { this.method = el.dataset.method; this.render(); },
      quick: el => {
        this.tendered = el.dataset.v;
        Modal.el().querySelector('[name=tendered]').value = el.dataset.v;
        this.updateChange();
      },
      complete: () => this.complete(),
      __input: e => {
        if (e.target.name === 'tendered') { this.tendered = e.target.value; this.updateChange(); }
        if (e.target.name === 'disc') this.discValue = e.target.value;
      },
    };
    actions.__enter = () => {
      if (document.activeElement && document.activeElement.name === 'disc') actions['apply-disc']();
      else actions.complete();
    };

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
          <input class="input" name="disc" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0" value="${esc(this.discValue)}">
          <button class="btn" data-act="apply-disc">Apply</button>
          ${d ? '<button class="btn danger" data-act="remove-disc">Remove</button>' : ''}
        </div>
        <div class="field-label">Payment method</div>
        <div class="pay-methods">
          ${methods.map(([m, label]) => `<button data-act="method" data-method="${m}" class="${this.method === m ? 'active' : ''}">${label}</button>`).join('')}
        </div>
        ${this.method === 'cash' ? `
          <label class="field"><span>Cash received</span>
            <input class="input big-input" name="tendered" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(this.tendered)}" autofocus></label>
          <div class="quick-cash">
            ${this.quickCash(t.total).map((v, i) => `<button class="btn small" data-act="quick" data-v="${v}">${i === 0 ? 'Exact ' : ''}${money(v)}</button>`).join('')}
          </div>
          <div class="change" data-role="change"></div>` : ''}`,
      footer: `<button class="btn" data-act="__close">Cancel</button>
        <button class="btn primary big" data-act="complete" data-role="complete">Complete payment · ${money(t.total)}</button>`,
      actions,
    });
    this.updateChange();
  },

  updateChange() {
    const el = Modal.el();
    const order = Store.order(this.orderId);
    if (!el || !order) return;
    const btn = el.querySelector('[data-role=complete]');
    if (this.method !== 'cash') { btn.disabled = false; return; }
    const total = Store.totals(order).total;
    const diff = round2((parseFloat(this.tendered) || 0) - total);
    const box = el.querySelector('[data-role=change]');
    box.className = 'change' + (diff < 0 ? ' short' : '');
    box.innerHTML = diff < 0 ? `Still due <span>${money(-diff)}</span>` : `Change <span>${money(diff)}</span>`;
    btn.disabled = diff < 0;
  },

  applyDiscount() {
    const value = parseFloat(this.discValue);
    if (!(value > 0)) return toast('Enter a discount amount', 'error');
    if (this.discType === 'percent' && value > 100) return toast('Percent discount cannot exceed 100', 'error');
    const type = this.discType;
    requireManager('Apply a discount to this order.', mgr => {
      const o = Store.order(this.orderId);
      o.discount = { type, value: round2(value), by: mgr.id };
      Store.save();
      App.render();
      this.render();
      toast('Discount applied', 'ok');
    }, () => this.render());
  },

  complete() {
    const order = Store.order(this.orderId);
    if (!order || order.status !== 'open') return Modal.close();
    const total = Store.totals(order).total;
    const payment = { method: this.method, amount: total };
    if (this.method === 'cash') {
      const tendered = round2(parseFloat(this.tendered) || 0);
      if (tendered < total) return toast('Cash received is less than the total', 'error');
      payment.tendered = tendered;
      payment.change = round2(tendered - total);
    }
    Store.payOrder(order, payment, App.user.id);
    showReceipt(order.id, { title: 'Payment complete ✓', onClose: () => App.go('tables') });
  },
};
