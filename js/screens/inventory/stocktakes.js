'use strict';

// Inventory, Stocktakes tab: counting what is on the shelf and correcting the stock.
Object.assign(Screens.inventory, {
  stocktakesHTML() {
    const list = Store.data.stocktakes.slice().sort((a, b) => b.date - a.date).slice(0, 50);
    return `
      <p class="muted small">Count what is really on the shelves. Stock is set to your count, and the difference (and what it cost) is kept as a record.</p>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Date</th><th>By</th><th class="num">Items counted</th><th class="num">Value of the difference</th><th>Note</th><th></th></tr></thead>
          <tbody>${list.map(s => `
            <tr>
              <td>${fmtDateTime(s.date)}</td>
              <td>${this.who(s.by)}</td>
              <td class="num">${s.lines.length}</td>
              <td class="num ${s.value < 0 ? 'diff-bad' : s.value > 0 ? 'diff-ok' : ''}">${s.value > 0 ? '+' : ''}${money(s.value || 0)}</td>
              <td class="muted small wrap-cell">${esc(s.note || '')}</td>
              <td><div class="row-actions"><button class="btn small" data-act="view-stocktake" data-id="${s.id}">View</button></div></td>
            </tr>`).join('') || '<tr><td colspan="6" class="empty">No stocktakes yet</td></tr>'}
          </tbody>
        </table>
      </div>`;
  },

  newStocktake() {
    const items = [
      ...Store.data.ingredients.filter(i => i.active !== false).map(i => ({ kind: 'ingredient', id: i.id, name: i.name, unit: i.unit, stock: i.stock })),
      ...Store.data.products.filter(p => p.trackStock).map(p => ({ kind: 'product', id: p.id, name: p.name, unit: 'pcs', stock: p.stock })),
    ];
    if (!items.length) return toast('Nothing to count yet', 'error');
    const diffText = (item, v) => {
      if (v === '') return '';
      const d = Math.round((parseFloat(v) - item.stock) * 10000) / 10000;
      return d === 0 ? '0' : `<span class="${d < 0 ? 'diff-bad' : 'diff-ok'}">${d > 0 ? '+' : ''}${qtyText(d)}</span>`;
    };
    const actions = {
      __input: e => {
        const row = e.target.closest('tr');
        if (row && e.target.dataset.role === 'counted') row.querySelector('[data-role=diff]').innerHTML = diffText(items[+row.dataset.i], e.target.value);
      },
      save: () => {
        const rows = [...Modal.el().querySelectorAll('tr[data-i]')];
        const lines = [];
        for (const row of rows) {
          const v = row.querySelector('[data-role=counted]').value;
          if (v === '') continue;
          const counted = parseFloat(v);
          if (!(counted >= 0)) return toast('Counted amounts cannot be negative', 'error');
          const item = items[+row.dataset.i];
          lines.push({ kind: item.kind, refId: item.id, counted });
        }
        if (!lines.length) return toast('Enter what you counted for at least one item', 'error');
        Store.addStocktake({ note: Modal.el().querySelector('[name=note]').value, lines });
        Modal.close();
        this.render(this.root);
        toast('Stocktake saved – stock updated', 'ok');
      },
    };
    Modal.open({
      title: 'New stocktake',
      wide: true,
      body: `
        <p class="muted small">Type what you counted. Leave a box empty for items you did not count; they stay as they are.</p>
        <div class="table-wrap audit-wrap">
          <table class="data compact">
            <thead><tr><th>Item</th><th class="num">In the system</th><th>Counted</th><th class="num">Difference</th></tr></thead>
            <tbody>${items.map((it, i) => `
              <tr data-i="${i}">
                <td>${esc(it.name)}${it.kind === 'product' ? ' <span class="pill muted">menu item</span>' : ''}</td>
                <td class="num">${qtyText(it.stock)} ${esc(it.unit)}</td>
                <td><input class="input" type="number" min="0" step="any" inputmode="decimal" data-role="counted" style="max-width:9rem"></td>
                <td class="num" data-role="diff"></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <label class="field spaced"><span>Note (optional)</span><input class="input" name="note" maxlength="300" placeholder="e.g. monthly count"></label>`,
      footer: '<button class="btn" data-act="__close">Cancel</button><button class="btn primary" data-act="save">Save and update stock</button>',
      actions,
    });
  },

  viewStocktake(id) {
    const s = Store.data.stocktakes.find(x => x.id === id);
    if (!s) return;
    Modal.open({
      title: `Stocktake · ${fmtDateTime(s.date)}`,
      wide: true,
      body: `
        <p class="muted">By ${this.who(s.by)}${s.note ? ` · ${esc(s.note)}` : ''}</p>
        <div class="table-wrap audit-wrap">
          <table class="data compact">
            <thead><tr><th>Item</th><th class="num">Expected</th><th class="num">Counted</th><th class="num">Difference</th><th class="num">Value</th></tr></thead>
            <tbody>${s.lines.map(l => `
              <tr>
                <td>${esc(l.name || '')}</td>
                <td class="num">${qtyText(l.expected)} ${esc(l.unit || '')}</td>
                <td class="num">${qtyText(l.counted)}</td>
                <td class="num ${l.diff < 0 ? 'diff-bad' : l.diff > 0 ? 'diff-ok' : ''}">${l.diff > 0 ? '+' : ''}${qtyText(l.diff)}</td>
                <td class="num">${l.value ? money(l.value) : '—'}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="totals-inline spaced"><span>Value of the difference</span><b>${s.value > 0 ? '+' : ''}${money(s.value || 0)}</b></div>`,
      footer: '<button class="btn primary" data-act="__close">Close</button>',
    });
  },
});
