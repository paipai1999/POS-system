'use strict';

// Menu & Stock: categories.
Object.assign(Screens.products, {
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
});
