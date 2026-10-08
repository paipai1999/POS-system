'use strict';

Screens.tables = {
  perm: 'tables',
  live: ['orders', 'tables', 'guestRequests', 'kitchenTickets', 'users', 'settings'],

  render(root) {
    const pending = App.can('guest') ? Store.pendingRequests() : [];
    const ready = Store.readyTickets();
    const takeaways = Store.openOrders().filter(o => !o.tableId);
    root.innerHTML = `
      <div class="page-head">
        <h1>Tables</h1>
        <div class="actions">
          ${App.can('guest') ? '<button class="btn" data-act="guest">📖 Guest menu mode</button>' : ''}
          <button class="btn primary" data-act="takeaway">＋ New takeaway</button>
        </div>
      </div>
      ${ready.length ? `
        <h2 class="section-title">🍽️ Ready to serve (${ready.length})</h2>
        <div class="requests">${ready.map(t => this.readyCard(t)).join('')}</div>` : ''}
      ${pending.length ? `
        <h2 class="section-title">🔔 Guest requests (${pending.length})</h2>
        <div class="requests">${pending.map(r => this.requestCard(r)).join('')}</div>` : ''}
      <div class="table-grid">
        ${Store.data.tables.map(t => this.tableTile(t, pending, ready)).join('') || '<p class="empty">No tables yet. Add some in Settings.</p>'}
      </div>
      ${takeaways.length ? `
        <h2 class="section-title">🥡 Takeaway orders</h2>
        <div class="table-grid">${takeaways.map(o => this.orderTile(o, ready)).join('')}</div>` : ''}`;

    root.onclick = e => {
      const t = e.target.closest('[data-act]');
      if (!t) return;
      const id = t.dataset.id;
      switch (t.dataset.act) {
        case 'table': {
          const open = Store.openOrderForTable(id);
          const order = open || Store.createOrder({ tableId: id, staffId: App.user.id });
          App.go('order', { orderId: order.id });
          break;
        }
        case 'order': App.go('order', { orderId: id }); break;
        case 'takeaway': App.go('order', { orderId: Store.createOrder({ staffId: App.user.id }).id }); break;
        case 'guest': this.pickGuestTable(); break;
        case 'served':
          Store.setTicketStatus(id, 'served', App.user.id);
          this.render(root);
          break;
        case 'accept': {
          const res = Store.acceptGuestRequest(id, App.user.id);
          if (!res) return this.render(root);
          if (res.skipped.length) toast('Not available, skipped: ' + res.skipped.join(', '), 'error');
          if (res.order) { toast('Guest order added', 'ok'); App.go('order', { orderId: res.order.id }); }
          else this.render(root);
          break;
        }
        case 'done':
          Store.resolveRequest(id, 'done', App.user.id);
          App.render();
          break;
        case 'reject':
          confirmDialog({
            title: 'Reject this guest order?',
            message: 'Let the guest know in person why it can\'t be made.',
            okLabel: 'Reject',
            danger: true,
            onOk: () => { Store.resolveRequest(id, 'rejected', App.user.id); App.render(); },
          });
          break;
      }
    };
  },

  pickGuestTable() {
    const tables = Store.data.tables;
    if (!tables.length) return toast('Add tables in Settings first', 'error');
    Modal.open({
      title: 'Guest menu for which table?',
      body: `
        <p class="muted">You will be signed out and this device will show the menu to guests. A staff PIN is needed to leave guest mode.</p>
        <div class="user-grid">${tables.map(t => `<button class="user-tile" data-act="pick" data-id="${t.id}"><span class="avatar">🪑</span><span>${esc(t.name)}</span></button>`).join('')}</div>`,
      actions: { pick: t => App.enterGuest(t.dataset.id) },
    });
  },

  tableTile(t, pending, ready) {
    const o = Store.openOrderForTable(t.id);
    const alert = pending.some(r => r.tableId === t.id);
    const food = o && ready.some(k => k.orderId === o.id);
    const items = o ? o.items.reduce((n, l) => n + l.qty, 0) : 0;
    const staff = o && Store.user(o.staffId);
    return `
      <button class="table-tile ${o ? 'busy' : ''} ${alert ? 'alert' : ''} ${food ? 'ready' : ''}" data-act="table" data-id="${t.id}">
        <span class="t-name">${esc(t.name)}</span>
        ${o ? `
          <span class="t-meta">${items} item${items === 1 ? '' : 's'} · ${timeAgo(o.createdAt)}</span>
          <span class="t-meta">${esc(staff ? staff.name : '')}</span>
          <span class="t-total">${money(Store.totals(o).total)}</span>` : '<span class="t-meta">Free</span>'}
        ${alert || food ? `<span class="t-bell">${food ? '🍽️' : ''}${alert ? '🔔' : ''}</span>` : ''}
      </button>`;
  },

  orderTile(o, ready) {
    const items = o.items.reduce((n, l) => n + l.qty, 0);
    const food = ready.some(k => k.orderId === o.id);
    return `
      <button class="table-tile busy ${food ? 'ready' : ''}" data-act="order" data-id="${o.id}">
        <span class="t-name">Takeaway #${orderNo(o)}</span>
        <span class="t-meta">${items} item${items === 1 ? '' : 's'} · ${timeAgo(o.createdAt)}</span>
        <span class="t-total">${money(Store.totals(o).total)}</span>
        ${food ? '<span class="t-bell">🍽️</span>' : ''}
      </button>`;
  },

  readyCard(k) {
    const order = Store.order(k.orderId);
    const mine = k.staffId === App.user.id;
    return `
      <div class="card request ready ${mine ? 'mine' : ''}">
        <header><span>${esc(k.where)} · #${orderNo(order || k)}</span><span class="muted small">${timeAgo(k.readyAt)}</span></header>
        <ul>${k.items.map(l => `<li>${l.qty} × ${esc(l.name)}</li>`).join('')}</ul>
        <div class="row-actions start">
          <button class="btn small primary" data-act="served" data-id="${k.id}">✓ Served</button>
          ${mine ? '<span class="muted small">Your table</span>' : ''}
        </div>
      </div>`;
  },

  requestCard(r) {
    const table = Store.table(r.tableId);
    return `
      <div class="card request ${r.kind}">
        <header><span>${esc(table ? table.name : 'Unknown table')}</span><span class="muted small">${timeAgo(r.createdAt)}</span></header>
        ${r.kind === 'call'
          ? '<p>🙋 Guest is asking for a waiter</p>'
          : `<ul>${r.items.map(l => `<li>${l.qty} × ${esc(l.name)}</li>`).join('')}</ul>
             ${r.note ? `<p class="line-note">“${esc(r.note)}”</p>` : ''}`}
        <div class="row-actions start">
          ${r.kind === 'call'
            ? `<button class="btn small primary" data-act="done" data-id="${r.id}">On my way</button>`
            : `<button class="btn small primary" data-act="accept" data-id="${r.id}">Accept &amp; open</button>
               <button class="btn small danger" data-act="reject" data-id="${r.id}">Reject</button>`}
        </div>
      </div>`;
  },
};
