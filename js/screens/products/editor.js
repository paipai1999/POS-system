'use strict';

// Menu & Stock: the item editor and the stock adjustment dialog.
// The editor is this file plus three parts that each manage their own piece of the form (see editor-photo.js for the shape):
// the photo (editor-photo.js), the priced options (editor-options.js) and the recipe (editor-recipe.js).
Object.assign(Screens.products, {
  edit(id) {
    const cats = Store.data.categories;
    if (!cats.length) return toast('Create a category first', 'error');
    const p = id ? Store.product(id) : {
      name: '', emoji: '🍽️', categoryId: this.state.cat !== 'all' ? this.state.cat : cats[0].id,
      price: '', description: '', trackStock: false, stock: 0, lowStock: 5, active: true,
    };
    const ings = Store.data.ingredients.filter(i => i.active !== false);
    const photo = this.photoSection(p);
    const options = this.optionsSection(p, ings);
    const recipe = this.recipeSection(p, ings);
    const parts = [photo, options, recipe];

    // Checks the whole form and returns the item's fields (throws an Error with a message for the person).
    const readForm = () => {
      const v = formValues(Modal.el());
      const photoData = photo.read();
      if (!v.name) throw new Error('Name is required');
      const recipeData = recipe.read();
      const price = parseFloat(v.price);
      if (!(price >= 0)) throw new Error('Enter a valid price');
      const optionsData = options.read();
      return {
        name: v.name, emoji: v.emoji || '🍽️', categoryId: v.categoryId, price: rmoney(price), description: v.description,
        ...photoData, ...optionsData, ...recipeData,
        active: v.active, trackStock: v.trackStock,
        stock: Math.max(0, parseInt(v.stock, 10) || 0), lowStock: Math.max(0, parseInt(v.lowStock, 10) || 0),
      };
    };

    const actions = {
      ...photo.actions, ...options.actions, ...recipe.actions,
      __input: e => parts.forEach(part => part.input && part.input(e)),
      __change: e => {
        parts.forEach(part => part.change && part.change(e));
        if (e.target.name === 'trackStock') Modal.el().querySelector('[data-role=stock]').hidden = !e.target.checked;
      },
      save: () => {
        let data;
        try { data = readForm(); } catch (e) { return toast(e.message, 'error'); }
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
        ${photo.html()}
        <div class="grid-2">
          <label class="field"><span>Category</span>
            <select class="input" name="categoryId">${cats.map(c => `<option value="${c.id}" ${c.id === p.categoryId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
          <label class="field"><span>Price (${esc(Store.settings.currency)})</span>
            <input class="input" name="price" type="number" min="0" step="${moneyStep()}" inputmode="decimal" value="${p.price}"></label>
        </div>
        <label class="field"><span>Description (shown on the guest menu)</span>
          <textarea class="input" name="description" rows="2">${esc(p.description)}</textarea></label>
        ${options.html()}
        ${recipe.html()}
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
    parts.forEach(part => part.afterOpen && part.afterOpen());
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
});
