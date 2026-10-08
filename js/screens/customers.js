'use strict';

// Customers and loyalty points. A customer chosen at checkout earns points on the bill and can pay part of a bill with
// points (1 point = 1 unit of money). Managers can also give a customer a standing discount. Loyalty is switched on in Settings.
Screens.customers = {
  perm: 'checkout',
  live: ['customers', 'settings', 'orders'],
  state: { q: '' },
  root: null,

  digits: s => String(s || '').replace(/\D/g, ''),

  // Creates a customer record from the form fields; returns it, or throws an Error with a message to show.
  create({ name, phone, note }) {
    name = String(name || '').trim();
    phone = String(phone || '').trim();
    if (!name) throw new Error('Customer name is required');
    if (phone && !/^[0-9+\-() ]{3,30}$/.test(phone)) throw new Error('Enter the phone number with digits only');
    if (this.digits(phone) && Store.data.customers.some(c => this.digits(c.phone) === this.digits(phone))) {
      throw new Error('A customer with that phone number already exists');
    }
    const c = { id: uid('c_'), name, phone, note: String(note || '').trim(), active: true, discountPercent: 0, points: 0, spent: 0, visits: 0, lastVisit: null, createdAt: Date.now() };
    Store.data.customers.push(c);
    Store.save();
    return c;
  },

  // A small dialog to find a customer by name or phone, or add a new one on the spot.
  pick(onPick, onCancel) {
    const state = { q: '' };
    let chosen = false;
    const listHTML = () => {
      const q = state.q.trim().toLowerCase();
      const d = this.digits(q);
      const list = Store.data.customers
        .filter(c => c.active !== false && (!q || c.name.toLowerCase().includes(q) || (d && this.digits(c.phone).includes(d))))
        .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 30);
      return list.map(c => `
        <button data-act="choose" data-id="${c.id}">
          <span><b>${esc(c.name)}</b>${c.phone ? ` · ${esc(c.phone)}` : ''}</span>
          <span class="muted small">${loyaltyOf(Store.settings).enabled ? `${qtyText(c.points)} pts` : ''}${c.discountPercent ? ` · ${c.discountPercent}% off` : ''}</span>
        </button>`).join('') || '<p class="empty small">No customer found</p>';
    };
    const actions = {
      choose: t => { const c = Store.customer(t.dataset.id); if (c) { chosen = true; Modal.close(); onPick(c); } },
      create: () => {
        const m = Modal.el();
        try {
          const c = this.create({ name: m.querySelector('[name=new-name]').value, phone: m.querySelector('[name=new-phone]').value });
          chosen = true;
          Modal.close();
          onPick(c);
        } catch (e) { toast(e.message, 'error'); }
      },
      __input: e => { if (e.target.dataset.role === 'q') { state.q = e.target.value; Modal.el().querySelector('[data-role=list]').innerHTML = listHTML(); } },
    };
    Modal.open({
      title: 'Choose customer',
      body: `
        <input class="input" type="search" data-role="q" placeholder="Search by name or phone…" autofocus>
        <div class="cust-list" data-role="list">${listHTML()}</div>
        <div class="field-label">New customer</div>
        <div class="grid-2">
          <label class="field"><span>Name</span><input class="input" name="new-name" maxlength="60"></label>
          <label class="field"><span>Phone</span><input class="input" name="new-phone" type="tel" maxlength="30"></label>
        </div>
        <button class="btn" data-act="create">＋ Add and choose</button>`,
      footer: '<button class="btn" data-act="__close">Cancel</button>',
      actions,
      onClose: () => { if (!chosen && onCancel) onCancel(); },
    });
  },

  rows() {
    const q = this.state.q.trim().toLowerCase();
    const d = this.digits(q);
    const list = Store.data.customers
      .filter(c => !q || c.name.toLowerCase().includes(q) || (d && this.digits(c.phone).includes(d)))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!list.length) return '<tr><td colspan="8" class="empty">No customers yet</td></tr>';
    return list.map(c => `
      <tr>
        <td><b>${esc(c.name)}</b>${c.active === false ? ' <span class="pill muted">inactive</span>' : ''}${c.note ? `<div class="muted small">${esc(c.note)}</div>` : ''}</td>
        <td>${esc(c.phone || '—')}</td>
        <td class="num">${qtyText(c.points)}</td>
        <td class="num">${money(c.spent || 0)}</td>
        <td class="num">${c.visits || 0}</td>
        <td>${c.lastVisit ? fmtDateTime(c.lastVisit) : '—'}</td>
        <td class="num">${c.discountPercent ? c.discountPercent + '%' : '—'}</td>
        <td><div class="row-actions"><button class="btn small" data-act="edit" data-id="${c.id}">Edit</button></div></td>
      </tr>`).join('');
  },

  render(root) {
    this.root = root;
    const loyalty = loyaltyOf(Store.settings);
    const points = Store.data.customers.reduce((n, c) => n + (c.points || 0), 0);
    root.innerHTML = `
      <div class="page-head">
        <h1>Customers</h1>
        <div class="actions"><button class="btn primary" data-act="new">＋ Add customer</button></div>
      </div>
      ${loyalty.enabled
        ? `<p class="muted small">Loyalty points are on: customers earn ${loyalty.earnPercent}% of each bill as points and can pay up to ${loyalty.maxRedeemPercent}% of a bill with them (1 point = 1 ${esc(Store.settings.currency)}). Points outstanding: <b>${qtyText(points)}</b>.</p>`
        : '<div class="alert-box">Loyalty points are switched off, so customers do not earn or spend points. An admin can turn them on under Settings. Customer discounts still work.</div>'}
      <div class="toolbar"><input class="input" type="search" data-role="q" placeholder="Search name or phone…" value="${esc(this.state.q)}"></div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Customer</th><th>Phone</th><th class="num">Points</th><th class="num">Spent</th><th class="num">Visits</th><th>Last visit</th><th class="num">Discount</th><th></th></tr></thead>
          <tbody>${this.rows()}</tbody>
        </table>
      </div>`;
    root.onclick = e => {
      const t = e.target.closest('[data-act]');
      if (!t) return;
      if (t.dataset.act === 'new') this.edit(null);
      else if (t.dataset.act === 'edit') this.edit(t.dataset.id);
    };
    root.oninput = e => {
      if (e.target.dataset.role !== 'q') return;
      this.state.q = e.target.value;
      root.querySelector('tbody').innerHTML = this.rows();
    };
  },

  edit(id) {
    const cur = id ? Store.customer(id) : null;
    const c = cur || { name: '', phone: '', note: '', active: true, points: 0, discountPercent: 0 };
    const manager = App.can('manage');
    const actions = {
      save: () => {
        const v = formValues(Modal.el());
        try {
          if (!cur) {
            const made = this.create(v);
            if (manager) {
              made.points = Math.max(0, rmoney(parseFloat(v.points) || 0));
              made.discountPercent = Math.min(100, Math.max(0, roundTo(parseFloat(v.discountPercent) || 0, 2)));
              Store.save();
            }
          } else {
            if (!v.name) throw new Error('Customer name is required');
            if (v.phone && !/^[0-9+\-() ]{3,30}$/.test(v.phone)) throw new Error('Enter the phone number with digits only');
            if (this.digits(v.phone) && Store.data.customers.some(x => x.id !== id && this.digits(x.phone) === this.digits(v.phone))) {
              throw new Error('A customer with that phone number already exists');
            }
            const live = Store.customer(id);
            Object.assign(live, { name: v.name, phone: v.phone, note: v.note, active: v.active });
            if (manager) {
              live.points = Math.max(0, rmoney(parseFloat(v.points) || 0));
              live.discountPercent = Math.min(100, Math.max(0, roundTo(parseFloat(v.discountPercent) || 0, 2)));
            }
            Store.save();
          }
        } catch (e) { return toast(e.message, 'error'); }
        Modal.close();
        this.render(this.root);
        toast('Saved', 'ok');
      },
      delete: () => requireManager('Delete this customer.', () => confirmDialog({
        title: `Delete ${c.name}?`,
        message: 'A customer who already has bills cannot be deleted; untick "Active" instead so reports stay accurate.',
        okLabel: 'Delete',
        danger: true,
        onOk: () => {
          if (Store.data.orders.some(o => o.customerId === id)) return toast(`${c.name} has bills. Deactivate instead so reports stay accurate.`, 'error');
          Store.data.customers = Store.data.customers.filter(x => x.id !== id);
          Store.save();
          this.render(this.root);
        },
      })),
    };
    actions.__enter = actions.save;
    Modal.open({
      title: id ? `Edit ${c.name}` : 'New customer',
      body: `
        <div class="grid-2">
          <label class="field"><span>Name</span><input class="input" name="name" value="${esc(c.name)}" maxlength="60" autofocus></label>
          <label class="field"><span>Phone</span><input class="input" name="phone" type="tel" value="${esc(c.phone)}" maxlength="30"></label>
        </div>
        <label class="field"><span>Note</span><input class="input" name="note" value="${esc(c.note)}" maxlength="200" placeholder="e.g. likes oat milk"></label>
        ${manager ? `
        <div class="grid-2">
          <label class="field"><span>Points balance</span><input class="input" name="points" type="number" min="0" step="${moneyStep()}" inputmode="decimal" value="${c.points || 0}"></label>
          <label class="field"><span>Standing discount %</span><input class="input" name="discountPercent" type="number" min="0" max="100" step="0.5" inputmode="decimal" value="${c.discountPercent || 0}"></label>
        </div>` : '<p class="muted small">A manager sets a customer\'s points and standing discount.</p>'}
        <label class="check"><input type="checkbox" name="active" ${c.active !== false ? 'checked' : ''}> Active</label>`,
      footer: `${id && manager ? '<button class="btn danger" data-act="delete">Delete</button><span class="spacer"></span>' : ''}
        <button class="btn" data-act="__close">Cancel</button><button class="btn primary" data-act="save">Save</button>`,
      actions,
    });
  },
};
