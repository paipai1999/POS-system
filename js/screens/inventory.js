'use strict';

// Inventory: the ingredients behind the menu, stock coming in (purchases) and stock counted (stocktakes).
// Dishes use up ingredients when a bill is paid; that is set per item under Menu & Stock (the recipe).
const INGREDIENT_UNITS = ['g', 'kg', 'ml', 'l', 'pcs', 'portion'];

Screens.inventory = {
  perm: 'products',
  live: ['ingredients', 'purchases', 'stocktakes', 'products', 'settings', 'users'],
  state: { tab: 'ingredients', q: '' },
  root: null,

  render(root) {
    this.root = root;
    const st = this.state;
    const add = { ingredients: ['new-ingredient', '＋ Add ingredient'], purchases: ['new-purchase', '＋ New purchase'], stocktakes: ['new-stocktake', '＋ New stocktake'] }[st.tab];
    root.innerHTML = `
      <div class="page-head">
        <h1>Inventory</h1>
        <div class="actions">
          <div class="seg">
            ${[['ingredients', 'Ingredients'], ['purchases', 'Purchases'], ['stocktakes', 'Stocktake']].map(([k, label]) =>
              `<button data-act="tab" data-tab="${k}" class="${st.tab === k ? 'active' : ''}">${label}</button>`).join('')}
          </div>
          <button class="btn primary" data-act="${add[0]}">${add[1]}</button>
        </div>
      </div>
      ${st.tab === 'ingredients' ? this.ingredientsHTML() : st.tab === 'purchases' ? this.purchasesHTML() : this.stocktakesHTML()}`;

    root.onclick = e => {
      const t = e.target.closest('[data-act]');
      if (!t || t.disabled) return;
      const id = t.dataset.id;
      switch (t.dataset.act) {
        case 'tab': st.tab = t.dataset.tab; st.q = ''; this.render(root); break;
        case 'new-ingredient': this.editIngredient(null); break;
        case 'edit-ingredient': this.editIngredient(id); break;
        case 'new-purchase': this.newPurchase(); break;
        case 'view-purchase': this.viewPurchase(id); break;
        case 'void-purchase': this.voidPurchase(id); break;
        case 'new-stocktake': this.newStocktake(); break;
        case 'view-stocktake': this.viewStocktake(id); break;
      }
    };
    root.oninput = e => {
      if (e.target.dataset.role !== 'q') return;
      st.q = e.target.value;
      const body = root.querySelector('tbody');
      if (body) body.innerHTML = this.ingredientRows();
    };
  },

  who(id) { const u = Store.user(id); return u ? esc(u.name) : '—'; },

  usedIn(id) {
    const names = Store.data.products.filter(p => recipeOf(p).some(r => r.ingredientId === id)).map(p => p.name);
    return names.length ? esc(names.slice(0, 3).join(', ')) + (names.length > 3 ? ` +${names.length - 3}` : '') : '<span class="muted">not used</span>';
  },

  // ----- ingredients -----
  ingredientRows() {
    const q = this.state.q.trim().toLowerCase();
    const list = Store.data.ingredients.filter(i => !q || i.name.toLowerCase().includes(q));
    if (!list.length) return '<tr><td colspan="7" class="empty">No ingredients yet</td></tr>';
    return list.map(i => {
      const low = i.active !== false && i.stock <= i.lowStock;
      return `
        <tr>
          <td><b>${esc(i.name)}</b>${i.active === false ? ' <span class="pill muted">off</span>' : ''}</td>
          <td>${esc(i.unit)}</td>
          <td class="num"><span class="${low ? 'low-stock' : ''}">${qtyText(i.stock)}</span></td>
          <td class="num">${costMoney(i.cost)}</td>
          <td class="num">${money(Math.max(i.stock, 0) * (i.cost || 0))}</td>
          <td class="small wrap-cell">${this.usedIn(i.id)}</td>
          <td><div class="row-actions"><button class="btn small" data-act="edit-ingredient" data-id="${i.id}">Edit</button></div></td>
        </tr>`;
    }).join('');
  },

  ingredientsHTML() {
    const value = Store.data.ingredients.reduce((n, i) => n + Math.max(i.stock, 0) * (i.cost || 0), 0);
    const low = Store.lowIngredients();
    const stat = (label, v, sub = '') => `<div class="card stat"><div class="label">${label}</div><div class="value">${v}</div>${sub ? `<div class="muted small">${sub}</div>` : ''}</div>`;
    return `
      <div class="stats">
        ${stat('Stock value', money(value), 'at cost')}
        ${stat('Ingredients', Store.data.ingredients.length)}
        ${stat('Running low', low.length)}
      </div>
      ${low.length ? `<div class="alert-box">⚠️ Running low: ${low.map(i => `${esc(i.name)} (${qtyText(i.stock)} ${esc(i.unit)})`).join(', ')}</div>` : ''}
      <p class="muted small">Stock goes up with purchases, down when a dish that uses the ingredient is paid, and is corrected by a stocktake. Set what each dish uses under <b>Menu &amp; Stock</b>.</p>
      <div class="toolbar"><input class="input" type="search" data-role="q" placeholder="Search ingredients…" value="${esc(this.state.q)}"></div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Ingredient</th><th>Unit</th><th class="num">In stock</th><th class="num">Cost per unit</th><th class="num">Value</th><th>Used in</th><th></th></tr></thead>
          <tbody>${this.ingredientRows()}</tbody>
        </table>
      </div>`;
  },

  editIngredient(id) {
    const cur = id ? Store.ingredient(id) : null;
    const p = cur || { name: '', unit: 'g', cost: '', lowStock: '', stock: '', active: true };
    const usedBy = id ? Store.data.products.filter(x => recipeOf(x).some(r => r.ingredientId === id)).map(x => x.name) : [];
    const actions = {
      save: () => {
        const v = formValues(Modal.el());
        if (!v.name) return toast('Ingredient name is required', 'error');
        const cost = parseFloat(v.cost) || 0, low = parseFloat(v.lowStock) || 0, stock = parseFloat(v.stock) || 0;
        if (cost < 0 || low < 0 || stock < 0) return toast('Amounts cannot be negative', 'error');
        const data = { name: v.name, unit: v.unit || 'pcs', cost: round4(cost), lowStock: round4(low), active: v.active };
        if (cur) Object.assign(Store.ingredient(id), data);
        else Store.data.ingredients.push({ id: uid('i_'), ...data, stock: round4(stock) });
        Store.save();
        Modal.close();
        this.render(this.root);
        toast('Saved', 'ok');
      },
      delete: () => {
        if (usedBy.length) return toast(`${cur.name} is used in the recipe of ${usedBy.join(', ')}. Remove it from the recipe first.`, 'error');
        confirmDialog({
          title: `Delete ${cur.name}?`,
          message: 'Past purchases and stocktakes keep their records. To stop using it for now, untick "In use" instead.',
          okLabel: 'Delete',
          danger: true,
          onOk: () => {
            Store.data.ingredients = Store.data.ingredients.filter(x => x.id !== id);
            Store.save();
            this.render(this.root);
          },
        });
      },
    };
    actions.__enter = actions.save;
    Modal.open({
      title: id ? 'Edit ingredient' : 'New ingredient',
      body: `
        <div class="grid-name">
          <label class="field"><span>Name</span><input class="input" name="name" value="${esc(p.name)}" autofocus></label>
          <label class="field"><span>Unit</span><input class="input" name="unit" value="${esc(p.unit)}" list="ingredient-units" maxlength="10">
            <datalist id="ingredient-units">${INGREDIENT_UNITS.map(u => `<option value="${u}">`).join('')}</datalist></label>
        </div>
        <div class="grid-2">
          <label class="field"><span>Cost per unit (${esc(Store.settings.currency)})</span><input class="input" name="cost" type="number" min="0" step="any" inputmode="decimal" value="${p.cost}"></label>
          <label class="field"><span>Low-stock alert at</span><input class="input" name="lowStock" type="number" min="0" step="any" inputmode="decimal" value="${p.lowStock}"></label>
        </div>
        ${id ? '' : '<label class="field"><span>Stock now</span><input class="input" name="stock" type="number" min="0" step="any" inputmode="decimal" placeholder="0"></label>'}
        <label class="check"><input type="checkbox" name="active" ${p.active !== false ? 'checked' : ''}> In use</label>
        <p class="muted small">${id ? 'To change the amount in stock, record a purchase or a stocktake.' : 'The cost is updated automatically as you record purchases at different prices.'}</p>`,
      footer: `${id ? '<button class="btn danger" data-act="delete">Delete</button><span class="spacer"></span>' : ''}
        <button class="btn" data-act="__close">Cancel</button><button class="btn primary" data-act="save">Save</button>`,
      actions,
    });
  },

  // ----- purchases -----
  purchasesHTML() {
    const list = Store.data.purchases.slice().sort((a, b) => b.date - a.date).slice(0, 100);
    return `
      <p class="muted small">Record stock you buy. The amount goes into stock and each ingredient's cost moves to the average of what you paid. Showing the last 90 days.</p>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Date</th><th>Supplier</th><th>Items</th><th class="num">Total</th><th>By</th><th>Status</th><th></th></tr></thead>
          <tbody>${list.map(p => `
            <tr>
              <td>${fmtDateTime(p.date)}</td>
              <td>${esc(p.supplier || '—')}</td>
              <td class="small wrap-cell">${esc(p.lines.map(l => `${qtyText(l.qty)} ${l.unit || ''} ${l.name || (Store.ingredient(l.ingredientId) || {}).name || ''}`.replace(/\s+/g, ' ')).join(', '))}</td>
              <td class="num">${money(p.total)}</td>
              <td>${this.who(p.by)}</td>
              <td><span class="pill ${p.status === 'void' ? 'void' : 'paid'}">${p.status === 'void' ? 'void' : 'received'}</span></td>
              <td><div class="row-actions">
                <button class="btn small" data-act="view-purchase" data-id="${p.id}">View</button>
                ${p.status === 'received' && App.can('manage') ? `<button class="btn small danger" data-act="void-purchase" data-id="${p.id}">Void</button>` : ''}
              </div></td>
            </tr>`).join('') || '<tr><td colspan="7" class="empty">No purchases yet</td></tr>'}
          </tbody>
        </table>
      </div>`;
  },

  newPurchase() {
    const ings = Store.data.ingredients.filter(i => i.active !== false);
    if (!ings.length) return toast('Add an ingredient first', 'error');
    const suppliers = [...new Set(Store.data.purchases.map(p => p.supplier).filter(Boolean))];
    const state = { lines: [{ ingredientId: ings[0].id, qty: '', total: '' }] };
    const unitOf = id => (Store.ingredient(id) || {}).unit || '';
    const rowsHTML = () => state.lines.map((l, i) => `
      <div class="line-row" data-i="${i}">
        <select class="input" data-role="ing">${ings.map(x => `<option value="${x.id}" ${x.id === l.ingredientId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
        <input class="input" type="number" min="0" step="any" inputmode="decimal" placeholder="Amount" data-role="qty" value="${esc(l.qty)}">
        <span class="unit">${esc(unitOf(l.ingredientId))}</span>
        <input class="input" type="number" min="0" step="${moneyStep()}" inputmode="decimal" placeholder="Price paid" data-role="total" value="${esc(l.total)}">
        <button class="icon-btn" data-act="del" data-i="${i}" aria-label="Remove">✕</button>
      </div>`).join('');
    const sumText = () => {
      const total = state.lines.reduce((n, l) => n + (parseFloat(l.total) || 0), 0);
      return `Total <b>${money(total)}</b>`;
    };
    const refresh = () => {
      const m = Modal.el();
      m.querySelector('[data-role=lines]').innerHTML = rowsHTML();
      m.querySelector('[data-role=sum]').innerHTML = sumText();
    };
    const lineOf = el => state.lines[+el.closest('.line-row').dataset.i];
    const actions = {
      add: () => { state.lines.push({ ingredientId: ings[0].id, qty: '', total: '' }); refresh(); },
      del: t => { state.lines.splice(+t.dataset.i, 1); if (!state.lines.length) state.lines.push({ ingredientId: ings[0].id, qty: '', total: '' }); refresh(); },
      __input: e => {
        const role = e.target.dataset.role;
        if (role === 'qty' || role === 'total') { lineOf(e.target)[role] = e.target.value; Modal.el().querySelector('[data-role=sum]').innerHTML = sumText(); }
      },
      __change: e => { if (e.target.dataset.role === 'ing') { lineOf(e.target).ingredientId = e.target.value; refresh(); } },
      save: () => {
        const m = Modal.el();
        const lines = state.lines.filter(l => l.qty !== '' || l.total !== '').map(l => ({ ingredientId: l.ingredientId, qty: parseFloat(l.qty), total: parseFloat(l.total) }));
        if (!lines.length) return toast('Add at least one ingredient to the purchase', 'error');
        if (lines.some(l => !(l.qty > 0) || !(l.total >= 0))) return toast('Each line needs an amount above 0 and the price paid', 'error');
        Store.addPurchase({ supplier: m.querySelector('[name=supplier]').value, note: m.querySelector('[name=note]').value, lines });
        Modal.close();
        this.render(this.root);
        toast('Purchase recorded', 'ok');
      },
    };
    Modal.open({
      title: 'New purchase',
      wide: true,
      body: `
        <div class="grid-2">
          <label class="field"><span>Supplier (optional)</span><input class="input" name="supplier" list="supplier-list" maxlength="60" autofocus>
            <datalist id="supplier-list">${suppliers.map(s => `<option value="${esc(s)}">`).join('')}</datalist></label>
          <label class="field"><span>Note (optional)</span><input class="input" name="note" maxlength="300" placeholder="e.g. invoice 1042"></label>
        </div>
        <div class="field-label">What was bought</div>
        <div data-role="lines">${rowsHTML()}</div>
        <button class="btn small" data-act="add">＋ Add another ingredient</button>
        <div class="totals-inline spaced" data-role="sum">${sumText()}</div>`,
      footer: '<button class="btn" data-act="__close">Cancel</button><button class="btn primary" data-act="save">Add to stock</button>',
      actions,
    });
  },

  viewPurchase(id) {
    const p = Store.data.purchases.find(x => x.id === id);
    if (!p) return;
    Modal.open({
      title: `Purchase · ${fmtDateTime(p.date)}`,
      body: `
        <p class="muted">${esc(p.supplier || 'No supplier')} · by ${this.who(p.by)}${p.note ? ` · ${esc(p.note)}` : ''}${p.status === 'void' ? ' · <b>void</b>' : ''}</p>
        <table class="data compact">
          <thead><tr><th>Ingredient</th><th class="num">Amount</th><th class="num">Price paid</th><th class="num">Per unit</th></tr></thead>
          <tbody>${p.lines.map(l => `<tr><td>${esc(l.name || (Store.ingredient(l.ingredientId) || {}).name || '')}</td><td class="num">${qtyText(l.qty)} ${esc(l.unit || '')}</td><td class="num">${money(l.total)}</td><td class="num">${costMoney(l.unitCost ?? (l.qty ? l.total / l.qty : 0))}</td></tr>`).join('')}</tbody>
        </table>
        <div class="totals-inline spaced"><span>Total</span><b>${money(p.total)}</b></div>`,
      footer: '<button class="btn primary" data-act="__close">Close</button>',
    });
  },

  voidPurchase(id) {
    const p = Store.data.purchases.find(x => x.id === id);
    if (!p || p.status !== 'received') return;
    requireManager('Void this purchase.', () => confirmDialog({
      title: 'Void this purchase?',
      message: 'The amounts are taken back out of stock. Use this only if the purchase was entered by mistake.',
      okLabel: 'Void purchase',
      danger: true,
      onOk: () => {
        Store.voidPurchase(Store.data.purchases.find(x => x.id === id));
        this.render(this.root);
        toast('Purchase voided');
      },
    }));
  },

  // ----- stocktakes -----
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
};
