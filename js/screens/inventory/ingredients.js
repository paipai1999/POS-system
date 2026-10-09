'use strict';

// Inventory, Ingredients tab: the list and the ingredient editor.
Object.assign(Screens.inventory, {
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
      <p class="muted small">When an ingredient runs out: <b>${{ off: 'nothing happens', warn: 'the dishes that need it show a warning', block: 'the dishes that need it cannot be sold' }[ingredientStockMode(Store.settings)]}</b> (change in Settings).</p>
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
        const data = { name: v.name, unit: v.unit || 'pcs', cost: round4(cost), lowStock: round4(low), active: v.active, watch: v.watch };
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
        <label class="check"><input type="checkbox" name="watch" ${p.watch !== false ? 'checked' : ''}> Watch this ingredient (warn or stop selling when it runs out; set in Settings)</label>
        <p class="muted small">${id ? 'To change the amount in stock, record a purchase or a stocktake.' : 'The cost is updated automatically as you record purchases at different prices.'}</p>`,
      footer: `${id ? '<button class="btn danger" data-act="delete">Delete</button><span class="spacer"></span>' : ''}
        <button class="btn" data-act="__close">Cancel</button><button class="btn primary" data-act="save">Save</button>`,
      actions,
    });
  },
});
