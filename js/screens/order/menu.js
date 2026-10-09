'use strict';

// Order screen: the menu tiles and adding an item (with its options).
Object.assign(Screens.order, {
  productTiles() {
    const st = this.state;
    const q = st.q.trim().toLowerCase();
    const list = Store.data.products.filter(p =>
      p.active && (st.cat === 'all' || p.categoryId === st.cat) && (!q || p.name.toLowerCase().includes(q)));
    if (!list.length) return '<p class="empty">No items found</p>';
    return list.map(p => {
      const avail = Store.available(p);
      const out = avail <= 0;
      // A dish short of an ingredient is flagged (and, with "stop selling" on, sold out) when that setting is not "do nothing".
      const short = p.lacks && p.lacks.length && ingredientStockMode(Store.settings) !== 'off';
      return `
        <button class="product-tile ${out ? 'soldout' : ''}" data-act="add" data-id="${p.id}" ${out ? 'disabled' : ''}>
          ${Photo.img(p, 'p-photo', 'p-emoji') || `<span class="p-emoji">${esc(p.emoji || '🍽️')}</span>`}
          <span class="p-name">${esc(p.name)}</span>
          ${short ? `<span class="p-stock low">${out ? 'Sold out' : '⚠ Running out'}: ${esc(p.lacks.join(', '))}</span>`
            : p.trackStock ? `<span class="p-stock ${avail <= p.lowStock ? 'low' : ''}">${out ? 'Sold out' : avail + ' left'}</span>` : ''}
          <span class="p-price">${money(p.price)}</span>
        </button>`;
    }).join('');
  },

  add(productId) {
    const order = this.order();
    const p = Store.product(productId);
    if (!order || !p) return;
    if (Store.available(p) < 1) return toast(`${p.name} is out of stock`, 'error');
    if (p.options && p.options.length) return this.pickOptions(p);
    Store.addItem(order, p);
    Store.save();
    this.update();
  },

  // Items with priced options (extra shot, large…): tick the ones the guest wants, then add.
  pickOptions(p) {
    const base = lineUnitPrice(p, []);
    const picked = () => [...Modal.el().querySelectorAll('[name=opt]:checked')].map(i => p.options[+i.value]);
    const refresh = () => {
      Modal.el().querySelector('[data-role=sum]').textContent = money(lineUnitPrice(p, picked()));
    };
    const actions = {
      __change: e => { if (e.target.name === 'opt') refresh(); },
      add: () => {
        const o = this.order();
        if (!o || Store.available(p) < 1) return Modal.close();
        Store.addItem(o, p, 1, '', picked());
        Store.save();
        Modal.close();
        this.update();
      },
    };
    actions.__enter = actions.add;
    Modal.open({
      title: p.name,
      body: `
        <div class="opt-list">
          ${p.options.map((o, i) => `
            <label class="opt-row"><span><input type="checkbox" name="opt" value="${i}"> ${esc(o.name)}</span><span>${o.price ? '+' + money(o.price) : ''}</span></label>`).join('')}
        </div>
        <div class="totals-inline spaced"><span>Price</span><b data-role="sum">${money(base)}</b></div>`,
      footer: '<button class="btn" data-act="__close">Cancel</button><button class="btn primary" data-act="add">Add to order</button>',
      actions,
    });
  },
});
