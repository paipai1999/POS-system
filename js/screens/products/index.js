'use strict';

// Menu & Stock: the item list and categories. The item editor is in editor.js, categories in categories.js.

Screens.products = {
  perm: 'products',

  live: ['products', 'categories'],

  state: { tab: 'items', cat: 'all', q: '' },

  root: null,

  render(root) {
    this.root = root;
    const st = this.state;
    const low = Store.data.products.filter(p => p.trackStock && p.active && p.stock <= p.lowStock);
    root.innerHTML = `
      <div class="page-head">
        <h1>Menu &amp; Stock</h1>
        <div class="actions">
          <div class="seg">
            <button data-act="tab" data-tab="items" class="${st.tab === 'items' ? 'active' : ''}">Items</button>
            <button data-act="tab" data-tab="cats" class="${st.tab === 'cats' ? 'active' : ''}">Categories</button>
          </div>
          ${st.tab === 'items'
            ? '<button class="btn primary" data-act="new">＋ Add item</button>'
            : '<button class="btn primary" data-act="new-cat">＋ Add category</button>'}
        </div>
      </div>
      ${st.tab === 'items' ? `
        ${low.length ? `<div class="alert-box">⚠️ Low stock: ${low.map(p => `${esc(p.name)} (${p.stock})`).join(', ')}</div>` : ''}
        <div class="toolbar">
          <input class="input" type="search" data-role="q" placeholder="Search items…" value="${esc(st.q)}">
          <select class="input" data-role="cat">
            <option value="all">All categories</option>
            ${Store.data.categories.map(c => `<option value="${c.id}" ${st.cat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
        </div>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Item</th><th>Category</th><th class="num">Price</th><th class="num">Cost</th><th class="num">Margin</th><th class="num">Stock</th><th>On sale</th><th></th></tr></thead>
            <tbody>${this.itemRows()}</tbody>
          </table>
        </div>` : this.catsHTML()}`;

    root.onclick = e => {
      const t = e.target.closest('[data-act]');
      if (!t) return;
      const id = t.dataset.id;
      switch (t.dataset.act) {
        case 'tab': st.tab = t.dataset.tab; this.render(root); break;
        case 'new': this.edit(null); break;
        case 'edit': this.edit(id); break;
        case 'stock': this.adjustStock(id); break;
        case 'toggle': {
          const p = Store.product(id);
          p.active = t.checked;
          Store.save();
          toast(`${p.name} ${p.active ? 'is on sale' : 'hidden from menu'}`);
          break;
        }
        case 'new-cat': this.editCategory(null); break;
        case 'edit-cat': this.editCategory(id); break;
        case 'del-cat': this.deleteCategory(id); break;
        case 'up': case 'down': this.moveCategory(id, t.dataset.act === 'up' ? -1 : 1); break;
      }
    };
    root.oninput = e => {
      if (e.target.dataset.role !== 'q') return;
      st.q = e.target.value;
      root.querySelector('tbody').innerHTML = this.itemRows();
    };
    root.onchange = e => {
      if (e.target.dataset.role !== 'cat') return;
      st.cat = e.target.value;
      root.querySelector('tbody').innerHTML = this.itemRows();
    };
  },

  // What one portion costs from its recipe, and what is left of the price (a dash when the item has no recipe).
  costCells(p) {
    const cost = recipeCost(p, id => Store.ingredient(id));
    if (cost === null) return '<td class="num muted">—</td><td class="num muted">—</td>';
    const margin = p.price > 0 ? Math.round((p.price - cost) / p.price * 100) : 0;
    return `<td class="num">${costMoney(cost)}</td><td class="num ${margin < 30 ? 'low-stock' : ''}">${margin}%</td>`;
  },

  itemRows() {
    const st = this.state;
    const q = st.q.trim().toLowerCase();
    const list = Store.data.products.filter(p =>
      (st.cat === 'all' || p.categoryId === st.cat) && (!q || p.name.toLowerCase().includes(q)));
    if (!list.length) return '<tr><td colspan="8" class="empty">No items</td></tr>';
    return list.map(p => {
      const cat = Store.category(p.categoryId);
      return `
        <tr>
          <td>${Photo.img(p, 'cell-photo', 'cell-emoji') || `<span class="cell-emoji">${esc(p.emoji || '🍽️')}</span>`} <b>${esc(p.name)}</b>${p.lacks && p.lacks.length ? ` <span class="pill void" title="Not enough for even one portion">short: ${esc(p.lacks.join(', '))}</span>` : ''}</td>
          <td>${esc(cat ? cat.name : '-')}</td>
          <td class="num">${money(p.price)}</td>
          ${this.costCells(p)}
          <td class="num">${p.trackStock
            ? `<span class="${p.stock <= p.lowStock ? 'low-stock' : ''}">${p.stock}</span> <button class="btn small" data-act="stock" data-id="${p.id}">±</button>`
            : '<span class="muted">not tracked</span>'}</td>
          <td><label class="switch"><input type="checkbox" data-act="toggle" data-id="${p.id}" ${p.active ? 'checked' : ''}><span></span></label></td>
          <td><div class="row-actions"><button class="btn small" data-act="edit" data-id="${p.id}">Edit</button></div></td>
        </tr>`;
    }).join('');
  },
};
