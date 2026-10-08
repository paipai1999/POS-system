'use strict';

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
            <thead><tr><th>Item</th><th>Category</th><th class="num">Price</th><th class="num">Stock</th><th>On sale</th><th></th></tr></thead>
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

  itemRows() {
    const st = this.state;
    const q = st.q.trim().toLowerCase();
    const list = Store.data.products.filter(p =>
      (st.cat === 'all' || p.categoryId === st.cat) && (!q || p.name.toLowerCase().includes(q)));
    if (!list.length) return '<tr><td colspan="6" class="empty">No items</td></tr>';
    return list.map(p => {
      const cat = Store.category(p.categoryId);
      return `
        <tr>
          <td><span class="cell-emoji">${esc(p.emoji || '🍽️')}</span> <b>${esc(p.name)}</b></td>
          <td>${esc(cat ? cat.name : '-')}</td>
          <td class="num">${money(p.price)}</td>
          <td class="num">${p.trackStock
            ? `<span class="${p.stock <= p.lowStock ? 'low-stock' : ''}">${p.stock}</span> <button class="btn small" data-act="stock" data-id="${p.id}">±</button>`
            : '<span class="muted">not tracked</span>'}</td>
          <td><label class="switch"><input type="checkbox" data-act="toggle" data-id="${p.id}" ${p.active ? 'checked' : ''}><span></span></label></td>
          <td><div class="row-actions"><button class="btn small" data-act="edit" data-id="${p.id}">Edit</button></div></td>
        </tr>`;
    }).join('');
  },

  edit(id) {
    const cats = Store.data.categories;
    if (!cats.length) return toast('Create a category first', 'error');
    const p = id ? Store.product(id) : {
      name: '', emoji: '🍽️', categoryId: this.state.cat !== 'all' ? this.state.cat : cats[0].id,
      price: '', description: '', trackStock: false, stock: 0, lowStock: 5, active: true,
    };
    const actions = {
      __change: e => {
        if (e.target.name === 'trackStock') Modal.el().querySelector('[data-role=stock]').hidden = !e.target.checked;
      },
      save: () => {
        const v = formValues(Modal.el());
        const price = parseFloat(v.price);
        if (!v.name) return toast('Name is required', 'error');
        if (!(price >= 0)) return toast('Enter a valid price', 'error');
        const data = {
          name: v.name, emoji: v.emoji || '🍽️', categoryId: v.categoryId, price: round2(price),
          description: v.description, active: v.active, trackStock: v.trackStock,
          stock: Math.max(0, parseInt(v.stock, 10) || 0), lowStock: Math.max(0, parseInt(v.lowStock, 10) || 0),
        };
        if (id) Object.assign(Store.product(id), data);
        else Store.data.products.push({ id: uid('p_'), ...data });
        Store.save();
        Modal.close();
        this.render(this.root);
        toast('Saved', 'ok');
      },
      delete: () => confirmDialog({
        title: `Delete ${p.name}?`,
        message: 'Past orders keep their records. To hide it temporarily, turn off "On sale" instead.',
        okLabel: 'Delete',
        danger: true,
        onOk: () => {
          Store.data.products = Store.data.products.filter(x => x.id !== id);
          Store.save();
          this.render(this.root);
        },
      }),
    };
    actions.__enter = actions.save;
    Modal.open({
      title: id ? 'Edit item' : 'New item',
      body: `
        <div class="grid-name">
          <label class="field"><span>Name</span><input class="input" name="name" value="${esc(p.name)}" autofocus></label>
          <label class="field"><span>Icon</span><input class="input" name="emoji" value="${esc(p.emoji)}" maxlength="8"></label>
        </div>
        <div class="grid-2">
          <label class="field"><span>Category</span>
            <select class="input" name="categoryId">${cats.map(c => `<option value="${c.id}" ${c.id === p.categoryId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
          <label class="field"><span>Price (${esc(Store.settings.currency)})</span>
            <input class="input" name="price" type="number" min="0" step="0.01" inputmode="decimal" value="${p.price}"></label>
        </div>
        <label class="field"><span>Description (shown on the guest menu)</span>
          <textarea class="input" name="description" rows="2">${esc(p.description)}</textarea></label>
        <label class="check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> On sale</label>
        <label class="check"><input type="checkbox" name="trackStock" ${p.trackStock ? 'checked' : ''}> Track stock</label>
        <div class="grid-2" data-role="stock" ${p.trackStock ? '' : 'hidden'}>
          <label class="field"><span>In stock</span><input class="input" name="stock" type="number" min="0" step="1" value="${p.stock}"></label>
          <label class="field"><span>Low-stock alert at</span><input class="input" name="lowStock" type="number" min="0" step="1" value="${p.lowStock}"></label>
        </div>`,
      footer: `${id ? '<button class="btn danger" data-act="delete">Delete</button><span class="spacer"></span>' : ''}
        <button class="btn" data-act="__close">Cancel</button><button class="btn primary" data-act="save">Save</button>`,
      actions,
    });
  },

  adjustStock(id) {
    const p = Store.product(id);
    const actions = {
      quick: t => { Modal.el().querySelector('[name=delta]').value = t.dataset.v; },
      save: () => {
        const delta = parseInt(Modal.el().querySelector('[name=delta]').value, 10);
        if (!delta) return toast('Enter a number, e.g. 10 or -2', 'error');
        const cur = Store.product(id);
        if (!cur) return Modal.close();
        cur.stock = Math.max(0, cur.stock + delta);
        Store.save();
        Modal.close();
        this.render(this.root);
        toast(`${cur.name}: ${cur.stock} in stock`, 'ok');
      },
    };
    actions.__enter = actions.save;
    Modal.open({
      title: `Adjust stock · ${p.name}`,
      body: `
        <p class="muted">Currently <b>${p.stock}</b> in stock. Use a positive number for deliveries and a negative number for waste.</p>
        <label class="field"><span>Change by</span><input class="input" name="delta" type="number" step="1" placeholder="e.g. 10 or -2" autofocus></label>
        <div class="quick-cash">${[5, 10, 20, 50, -1].map(v => `<button class="btn small" data-act="quick" data-v="${v}">${v > 0 ? '+' : ''}${v}</button>`).join('')}</div>`,
      footer: '<button class="btn" data-act="__close">Cancel</button><button class="btn primary" data-act="save">Update stock</button>',
      actions,
    });
  },

  catsHTML() {
    const cats = Store.data.categories;
    if (!cats.length) return '<p class="empty">No categories yet.</p>';
    return `
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Category</th><th class="num">Items</th><th></th></tr></thead>
          <tbody>${cats.map((c, i) => `
            <tr>
              <td><b>${esc(c.name)}</b></td>
              <td class="num">${Store.data.products.filter(p => p.categoryId === c.id).length}</td>
              <td><div class="row-actions">
                <button class="btn small" data-act="up" data-id="${c.id}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
                <button class="btn small" data-act="down" data-id="${c.id}" ${i === cats.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
                <button class="btn small" data-act="edit-cat" data-id="${c.id}">Rename</button>
                <button class="btn small danger" data-act="del-cat" data-id="${c.id}">Delete</button>
              </div></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  },

  editCategory(id) {
    const c = id ? Store.category(id) : null;
    const actions = {
      save: () => {
        const name = Modal.el().querySelector('[name=name]').value.trim();
        if (!name) return toast('Name is required', 'error');
        if (c) c.name = name;
        else Store.data.categories.push({ id: uid('c_'), name, sort: Store.data.categories.reduce((m, x) => Math.max(m, x.sort ?? 0), -1) + 1 });
        Store.save();
        Modal.close();
        this.render(this.root);
      },
    };
    actions.__enter = actions.save;
    Modal.open({
      title: c ? 'Rename category' : 'New category',
      body: `<label class="field"><span>Name</span><input class="input" name="name" value="${esc(c ? c.name : '')}" autofocus></label>`,
      footer: '<button class="btn" data-act="__close">Cancel</button><button class="btn primary" data-act="save">Save</button>',
      actions,
    });
  },

  deleteCategory(id) {
    const c = Store.category(id);
    if (Store.data.products.some(p => p.categoryId === id)) {
      return toast('Move or delete the items in this category first', 'error');
    }
    confirmDialog({
      title: `Delete ${c.name}?`,
      okLabel: 'Delete',
      danger: true,
      onOk: () => {
        Store.data.categories = Store.data.categories.filter(x => x.id !== id);
        Store.save();
        this.render(this.root);
      },
    });
  },

  // Order is stored in each category's `sort` so it is the same on every device.
  moveCategory(id, dir) {
    const cats = Store.data.categories;
    const i = cats.findIndex(c => c.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cats.length) return;
    cats.forEach((c, n) => { c.sort = n; });
    cats[i].sort = j;
    cats[j].sort = i;
    Store.sortCategories();
    Store.save();
    this.render(this.root);
  },
};
