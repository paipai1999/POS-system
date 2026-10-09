'use strict';

// Order screen: the "more" menu - split the bill, change the order note, move to another table.
Object.assign(Screens.order, {
  moreMenu() {
    const order = this.order();
    if (!order) return;
    Modal.open({
      title: `Order #${orderNo(order)}`,
      body: `
        <div class="stack">
          <button class="btn block" data-act="note">📝 Order note</button>
          <button class="btn block" data-act="move">🔀 Move to another table</button>
          <button class="btn block" data-act="split" ${order.items.length > 1 || order.items.some(l => l.qty > 1) ? '' : 'disabled'}>✂️ Split the bill</button>
          <button class="btn block danger" data-act="void">🗑️ Void order</button>
        </div>`,
      actions: {
        note: () => this.editOrderNote(),
        move: () => this.moveTable(),
        split: () => this.splitBill(),
        void: () => requireManager('Void this whole order.', mgr => {
          confirmDialog({
            title: `Void order #${orderNo(order)}?`,
            message: 'The order will be cancelled and kept in history as void.',
            okLabel: 'Void order',
            danger: true,
            onOk: () => {
              Store.voidOrder(this.order(), mgr.id);
              toast('Order voided');
              App.go('tables');
            },
          });
        }),
      },
    });
  },

  // Pick which items (and how many) go onto a separate bill, e.g. when friends pay separately.
  splitBill() {
    const order = this.order();
    if (!order) return;
    const moves = {}; // line id -> quantity to move
    const total = () => order.items.reduce((n, l) => n + l.qty, 0);
    const moving = () => Object.values(moves).reduce((n, q) => n + q, 0);
    const linesHTML = () => order.items.map(l => `
      <div class="line">
        <div class="line-main"><div class="line-name">${esc(l.name)}</div>${modsText(l) ? `<div class="line-mods">${esc(modsText(l))}</div>` : ''}<div class="line-meta">${money(l.price)} × ${l.qty}</div></div>
        <div class="qty"><button data-act="less" data-id="${l.id}" aria-label="Less">−</button><span>${moves[l.id] || 0}</span><button data-act="more" data-id="${l.id}" aria-label="More">+</button></div>
      </div>`).join('');
    const refresh = () => {
      const m = Modal.el();
      m.querySelector('[data-role=lines]').innerHTML = linesHTML();
      m.querySelector('[data-role=go]').disabled = moving() === 0 || moving() >= total();
    };
    Modal.open({
      title: `Split bill #${orderNo(order)}`,
      body: `
        <p class="muted small">Choose what goes on the new bill. The new bill is paid separately; the rest stays here.</p>
        <div class="split-lines" data-role="lines">${linesHTML()}</div>`,
      footer: '<button class="btn" data-act="__close">Cancel</button><button class="btn primary" data-act="go" data-role="go" disabled>Move to a new bill</button>',
      actions: {
        more: t => {
          const l = order.items.find(x => x.id === t.dataset.id);
          if (l && (moves[l.id] || 0) < l.qty) moves[l.id] = (moves[l.id] || 0) + 1;
          refresh();
        },
        less: t => {
          if (moves[t.dataset.id] > 0) moves[t.dataset.id]--;
          if (!moves[t.dataset.id]) delete moves[t.dataset.id];
          refresh();
        },
        go: async () => {
          const list = Object.entries(moves).map(([lineId, qty]) => ({ lineId, qty }));
          try {
            const created = await Store.splitOrder(order, list);
            Modal.close();
            toast(`New bill #${orderNo(created)} created`, 'ok');
            App.go('order', { orderId: created.id });
          } catch (e) {
            toast(e.message, 'error');
          }
        },
      },
    });
  },

  editOrderNote() {
    const order = this.order();
    const actions = {
      save: () => {
        const o = this.order();
        if (o) o.note = Modal.el().querySelector('[name=note]').value.trim();
        Store.save();
        Modal.close();
        App.render();
      },
    };
    Modal.open({
      title: 'Order note',
      body: `<label class="field"><span>Shown on the ticket and kitchen print-out</span>
        <textarea class="input" name="note" rows="3" autofocus>${esc(order.note)}</textarea></label>`,
      footer: '<button class="btn" data-act="__close">Cancel</button><button class="btn primary" data-act="save">Save</button>',
      actions,
    });
  },

  moveTable() {
    const order = this.order();
    const free = Store.data.tables.filter(t => !Store.openOrderForTable(t.id));
    Modal.open({
      title: 'Move to table',
      body: free.length
        ? `<div class="user-grid">${free.map(t => `<button class="user-tile" data-act="pick" data-id="${t.id}"><span>${esc(t.name)}</span></button>`).join('')}</div>`
        : '<p class="empty">No free tables.</p>',
      actions: {
        pick: t => {
          const table = Store.table(t.dataset.id);
          const o = this.order();
          if (!table || !o) return Modal.close();
          if (Store.openOrderForTable(table.id)) return toast(`${table.name} is already in use`, 'error');
          o.tableId = table.id;
          o.tableName = table.name;
          Store.save();
          Modal.close();
          toast(`Moved to ${table.name}`, 'ok');
          App.render();
        },
      },
    });
  },
});
