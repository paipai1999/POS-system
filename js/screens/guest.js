'use strict';

// Self-service menu for guests. The device is assigned to a table; orders go to staff as requests
// that a waiter accepts. Leaving guest mode requires a staff PIN.
// In server mode the guest's data comes from the public guest API, and `locked` means the menu was opened
// from a table's QR code on the guest's own phone (no staff options).
Screens.guest = {
  fullscreen: true,
  live: ['guest'],
  state: { tableId: null, cart: [], note: '', cat: 'all', locked: false },

  reset() { this.state = { tableId: null, cart: [], note: '', cat: 'all', locked: false }; },

  render(root) {
    const st = this.state;
    if (!st.tableId || !Store.table(st.tableId)) {
      st.tableId = null;
      return this.renderTablePicker(root);
    }
    const table = Store.table(st.tableId);
    const products = Store.data.products.filter(p => p.active);
    const cats = Store.data.categories.filter(c => products.some(p => p.categoryId === c.id));
    if (st.cat !== 'all' && !cats.some(c => c.id === st.cat)) st.cat = 'all';
    const shown = st.cat === 'all' ? cats : cats.filter(c => c.id === st.cat);
    const count = st.cart.reduce((n, l) => n + l.qty, 0);
    const total = st.cart.reduce((s, l) => s + l.qty * l.price, 0);

    root.innerHTML = `
      <div class="guest">
        <div class="guest-top">
          <div class="guest-head">
            <div class="grow">
              <h1>${esc(Store.settings.name)}</h1>
              <div class="small guest-sub">${esc(table.name)} · Menu</div>
            </div>
            ${I18N.button('lang')}
            <button class="btn" data-act="call">🔔 Call waiter</button>
          </div>
          <div class="chips guest-chips">
            <button class="chip ${st.cat === 'all' ? 'active' : ''}" data-act="cat" data-id="all">All</button>
            ${cats.map(c => `<button class="chip ${st.cat === c.id ? 'active' : ''}" data-act="cat" data-id="${c.id}">${esc(c.name)}</button>`).join('')}
          </div>
        </div>
        <div class="guest-body">
          ${shown.map(c => `
            <section class="menu-section">
              <h2>${esc(c.name)}</h2>
              <div class="menu-grid">${products.filter(p => p.categoryId === c.id).map(p => this.card(p)).join('')}</div>
            </section>`).join('') || '<p class="empty">The menu is empty.</p>'}
          ${st.locked ? '' : '<button class="guest-staff" data-act="staff">Staff</button>'}
        </div>
        <button class="cart-bar ${count ? '' : 'ghost'}" data-act="cart">
          ${count
            ? `<span>View order · ${count} item${count > 1 ? 's' : ''}</span><span>${money(total)}</span>`
            : '<span>Your table\'s order</span><span>›</span>'}
        </button>
      </div>`;

    root.onclick = e => {
      const t = e.target.closest('[data-act]');
      if (!t || t.disabled) return;
      const act = t.dataset.act;
      if (act === 'cat') { st.cat = t.dataset.id; this.render(root); window.scrollTo(0, 0); }
      else if (act === 'add') this.add(root, t.dataset.id);
      else if (act === 'cart') this.openCart(root);
      else if (act === 'call') this.callWaiter();
      else if (act === 'lang') { I18N.toggle(); this.render(root); }
      else if (act === 'staff') this.staffMenu(root);
    };
  },

  inCart(productId) {
    return this.state.cart.filter(l => l.productId === productId).reduce((n, l) => n + l.qty, 0);
  },

  canAdd(p) {
    return Store.available(p) - this.inCart(p.id) > 0;
  },

  card(p) {
    const avail = Store.available(p);
    const inCart = this.inCart(p.id);
    return `
      <div class="menu-card ${avail <= 0 ? 'soldout' : ''}">
        ${Photo.img(p, 'photo', 'emoji') || `<div class="emoji">${esc(p.emoji || '🍽️')}</div>`}
        <div class="info">
          <div class="mc-name">${esc(p.name)}</div>
          <div class="desc">${esc(p.description || '')}</div>
          <div class="foot">
            <span class="price">${money(p.price)}</span>
            ${avail <= 0
              ? '<span class="pill muted">Sold out</span>'
              : `<span class="add-wrap">${inCart ? `<span class="in-cart">${inCart} added</span>` : ''}
                 <button class="btn small primary" data-act="add" data-id="${p.id}" ${this.canAdd(p) ? '' : 'disabled'}>Add</button></span>`}
          </div>
        </div>
      </div>`;
  },

  add(root, productId) {
    const p = Store.product(productId);
    if (!p || !this.canAdd(p)) return;
    const line = this.state.cart.find(l => l.productId === p.id);
    if (line) line.qty++;
    else this.state.cart.push({ productId: p.id, name: p.name, price: p.price, qty: 1 });
    toast(`Added ${p.name}`);
    this.render(root);
  },

  openCart(root) {
    const st = this.state;
    const order = Store.openOrderForTable(st.tableId);
    const pending = Store.pendingRequests().filter(r => r.kind === 'order' && r.tableId === st.tableId);
    const total = st.cart.reduce((s, l) => s + l.qty * l.price, 0);
    const body = `
      ${st.cart.length ? `
        <div>${st.cart.map((l, i) => `
          <div class="line">
            <div class="line-main"><div class="line-name">${esc(l.name)}</div><div class="line-meta">${money(l.price)}</div></div>
            <div class="qty"><button data-act="dec" data-i="${i}" aria-label="Less">−</button><span>${l.qty}</span><button data-act="inc" data-i="${i}" aria-label="More">+</button></div>
            <div class="line-total">${money(l.price * l.qty)}</div>
          </div>`).join('')}
        </div>
        <label class="field spaced"><span>Special requests</span>
          <textarea class="input" name="note" rows="2" placeholder="Allergies, no ice, extra spicy…">${esc(st.note)}</textarea></label>
        <div class="totals-inline"><span>Estimated total (before tax)</span><b>${money(total)}</b></div>
        <p class="muted small">A waiter will confirm your order.</p>`
      : '<p class="empty">Nothing new yet. Add items from the menu.</p>'}
      ${pending.length ? `
        <h3 class="sub">Waiting for confirmation</h3>
        <ul class="plain">${pending.flatMap(r => r.items).map(l => `<li><span>${l.qty} × ${esc(l.name)}</span></li>`).join('')}</ul>` : ''}
      ${order && order.items.length ? `
        <h3 class="sub">Already ordered</h3>
        <ul class="plain">${order.items.map(l => `<li><span>${l.qty} × ${esc(l.name)}</span><span>${money(l.qty * l.price)}</span></li>`).join('')}</ul>
        <div class="totals-inline"><span>Bill so far (incl. tax)</span><b>${money(Store.totals(order).total)}</b></div>` : ''}`;

    const refresh = () => { this.render(root); this.openCart(root); };
    Modal.open({
      title: 'Your order',
      body,
      footer: `<button class="btn" data-act="__close">Keep browsing</button>${st.cart.length ? '<button class="btn primary" data-act="send">Send order</button>' : ''}`,
      actions: {
        inc: t => {
          const l = st.cart[+t.dataset.i];
          const p = Store.product(l.productId);
          if (!p || !this.canAdd(p)) return toast('No more available', 'error');
          l.qty++;
          refresh();
        },
        dec: t => {
          const i = +t.dataset.i;
          st.cart[i].qty--;
          if (st.cart[i].qty <= 0) st.cart.splice(i, 1);
          refresh();
        },
        send: () => this.send(root),
        __input: e => { if (e.target.name === 'note') st.note = e.target.value; },
      },
    });
  },

  send(root) {
    const st = this.state;
    if (!st.cart.length || this.sending) return;
    this.sending = true;
    Store.addGuestRequest({ kind: 'order', tableId: st.tableId, items: st.cart.map(l => ({ ...l })), note: st.note.trim() })
      .then(() => {
        st.cart = [];
        st.note = '';
        this.render(root);
        Modal.open({
          title: 'Order sent 🎉',
          body: '<p>Thank you! A waiter will confirm your order shortly.</p>',
          footer: '<button class="btn primary" data-act="__close">Back to menu</button>',
        });
      })
      .catch(e => toast(e.message, 'error'))
      .finally(() => { this.sending = false; });
  },

  callWaiter() {
    const tableId = this.state.tableId;
    if (Store.pendingRequests().some(r => r.kind === 'call' && r.tableId === tableId)) {
      return toast('A waiter has already been called 👍');
    }
    confirmDialog({
      title: 'Call a waiter?',
      message: 'We\'ll let the staff know you need help.',
      okLabel: 'Call waiter',
      onOk: () => {
        Store.addGuestRequest({ kind: 'call', tableId, items: [], note: '' })
          .then(() => toast('A waiter is on the way 👍', 'ok'))
          .catch(e => toast(e.message, 'error'));
      },
    });
  },

  staffMenu(root) {
    pinPrompt({
      title: 'Staff access',
      message: 'Enter a staff PIN to change the table or leave guest mode.',
      onOk: () => {
        // In server mode the device only holds this table's menu, so changing table goes via a staff sign-in.
        Modal.open({
          title: 'Guest mode',
          body: `<p class="muted">${Store.server ? 'To use this device for another table, exit and choose “Guest menu mode” on the Tables screen.' : 'What would you like to do?'}</p>`,
          footer: `${Store.server ? '' : '<button class="btn" data-act="table">Change table</button>'}<button class="btn primary" data-act="exit">Exit guest mode</button>`,
          actions: {
            table: () => { this.reset(); Modal.close(); this.render(root); },
            exit: () => App.exitGuest(),
          },
        });
      },
    });
  },

  renderTablePicker(root) {
    const tables = Store.data.tables;
    root.innerHTML = `
      <div class="login-wrap">
        <div class="login-card">
          <div class="login-brand">📖</div>
          <h1>Guest menu</h1>
          <p class="muted">Staff: choose which table this device is for.</p>
          <div class="user-grid">
            ${tables.map(t => `<button class="user-tile" data-act="table" data-id="${t.id}"><span class="avatar">🪑</span><span>${esc(t.name)}</span></button>`).join('')
              || '<p class="empty">No tables yet. Add some in Settings.</p>'}
          </div>
          <button class="btn" data-act="cancel">Cancel</button>
        </div>
      </div>`;
    root.onclick = e => {
      const t = e.target.closest('[data-act]');
      if (!t) return;
      if (t.dataset.act === 'table') { this.state.tableId = t.dataset.id; this.render(root); }
      else if (t.dataset.act === 'cancel') App.exitGuest();
    };
  },
};
