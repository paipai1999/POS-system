'use strict';

// Order screen: the bill on the right - lines, quantities, notes and sending to the kitchen.
Object.assign(Screens.order, {
  ticketHTML(order) {
    const t = Store.totals(order);
    const staff = Store.user(order.staffId);
    const unsent = order.items.reduce((n, l) => n + Math.max(0, l.qty - l.sentQty), 0);
    const empty = !order.items.length;
    const ready = Store.readyTickets().some(k => k.orderId === order.id);
    return `
      <div class="ticket-head">
        <button class="btn small" data-act="back">← Tables</button>
        <div class="grow">
          <div class="t-title">${esc(whereLabel(order))}</div>
          <div class="muted small">#${orderNo(order)} · ${esc(staff ? staff.name : '')} · ${fmtTime(order.createdAt)}</div>
          ${order.customerId && Store.customer(order.customerId) ? `<div class="small">👤 ${esc(Store.customer(order.customerId).name)}</div>` : ''}
        </div>
        <button class="icon-btn" data-act="more" title="More options" aria-label="More options">⋯</button>
      </div>
      ${ready ? '<div class="ready-banner">🍽️ Food is ready in the kitchen <button class="btn small" data-act="served">Mark served</button></div>' : ''}
      ${order.note ? `<div class="order-note">📝 ${esc(order.note)}</div>` : ''}
      <div class="ticket-lines">
        ${empty ? '<p class="empty">Tap menu items to add them</p>' : order.items.map(l => `
          <div class="line">
            <div class="line-main" data-act="edit-line" data-id="${l.id}" title="Add note / remove">
              <div class="line-name">${esc(l.name)}</div>
              ${modsText(l) ? `<div class="line-mods">${esc(modsText(l))}</div>` : ''}
              ${l.note ? `<div class="line-note">${esc(l.note)}</div>` : ''}
              <div class="line-meta">${money(l.price)}${l.sentQty ? ` · <span class="sent">✓ ${l.sentQty} sent</span>` : ''}</div>
            </div>
            <div class="qty">
              <button data-act="dec" data-id="${l.id}" aria-label="Less">−</button>
              <span>${l.qty}</span>
              <button data-act="inc" data-id="${l.id}" aria-label="More">+</button>
            </div>
            <div class="line-total">${money(l.price * l.qty)}</div>
          </div>`).join('')}
      </div>
      <div class="totals">${totalsHTML(t)}</div>
      <div class="ticket-actions">
        <button class="btn" data-act="send" ${unsent ? '' : 'disabled'}>🍳 Send${unsent ? ` (${unsent})` : ''}</button>
        <button class="btn" data-act="bill" ${empty ? 'disabled' : ''}>🧾 Print bill</button>
        ${App.can('checkout') ? `<button class="btn primary big span-2" data-act="pay" ${empty ? 'disabled' : ''}>Pay ${money(t.total)}</button>` : ''}
      </div>`;
  },

  changeQty(lineId, delta) {
    const order = this.order();
    const line = order && order.items.find(l => l.id === lineId);
    if (!line) return;
    const newQty = line.qty + delta;
    if (delta > 0) {
      const p = Store.product(line.productId);
      if (p && Store.available(p) < delta) return toast(`${p.name} is out of stock`, 'error');
    }
    const apply = () => {
      const o = this.order();
      const l = o && o.items.find(x => x.id === lineId);
      if (!l) return;
      l.qty = newQty;
      l.sentQty = Math.min(l.sentQty, newQty);
      if (l.qty <= 0) o.items = o.items.filter(x => x !== l);
      Store.save();
      this.update();
    };
    if (newQty < line.sentQty) requireManager(`Remove "${line.name}" — it was already sent to the kitchen.`, apply);
    else apply();
  },

  editLine(lineId) {
    const order = this.order();
    const line = order && order.items.find(l => l.id === lineId);
    if (!line) return;
    const actions = {
      quick: t => {
        const input = Modal.el().querySelector('[name=note]');
        input.value = input.value ? `${input.value}, ${t.dataset.note}` : t.dataset.note;
      },
      save: () => {
        const note = Modal.el().querySelector('[name=note]').value.trim();
        const o = this.order();
        const l = o && o.items.find(x => x.id === lineId);
        if (l) { l.note = note; Store.save(); }
        Modal.close();
        this.update();
      },
      remove: () => { Modal.close(); this.changeQty(lineId, -line.qty); },
    };
    actions.__enter = actions.save;
    Modal.open({
      title: line.name,
      body: `
        <label class="field"><span>Note for the kitchen</span>
          <input class="input" name="note" value="${esc(line.note)}" placeholder="e.g. no onions, oat milk" autofocus></label>
        <div class="chips wrap">${QUICK_NOTES.map(n => `<button class="chip" data-act="quick" data-note="${esc(n)}">${esc(n)}</button>`).join('')}</div>`,
      footer: `<button class="btn danger" data-act="remove">Remove item</button><span class="spacer"></span>
        <button class="btn" data-act="__close">Cancel</button><button class="btn primary" data-act="save">Save</button>`,
      actions,
    });
  },

  sendToKitchen() {
    const order = this.order();
    if (!order) return;
    const lines = order.items.filter(l => l.qty > l.sentQty).map(l => ({ ...l, qty: l.qty - l.sentQty }));
    if (!lines.length) return toast('Nothing new to send');
    order.items.forEach(l => { l.sentQty = l.qty; });
    order.sentAt = Date.now();
    Store.addKitchenTicket(order, lines);
    this.update();
    toast(`Sent ${lines.reduce((n, l) => n + l.qty, 0)} item(s) to the kitchen`, 'ok');
    if (Store.settings.printKitchenTickets) printHTML(kitchenTicketHTML(order, lines), 'kitchen');
  },
});
