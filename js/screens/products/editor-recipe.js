'use strict';

// Item editor, recipe part: what one portion uses of each ingredient, with its cost and margin.
// Rows are kept here while editing so typing is not lost when one is added or removed. See photoSection for the shape of a part.
Object.assign(Screens.products, {
  // <option> list of the ingredients; an ingredient that was switched off but is already chosen stays selectable.
  ingredientOptions(ings, selected) {
    const known = ings.some(x => x.id === selected) || !Store.ingredient(selected) ? ings : [Store.ingredient(selected), ...ings];
    return known.map(x => `<option value="${x.id}" ${x.id === selected ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  },

  recipeSection(p, ings) {
    const recipe = (p.recipe || []).map(r => ({ ingredientId: r.ingredientId, qty: String(r.qty) }));
    const unitOf = id => (Store.ingredient(id) || {}).unit || '';
    const rowOf = el => recipe[+el.closest('.line-row').dataset.i];

    const rows = () => recipe.map((r, i) => `
      <div class="line-row recipe" data-i="${i}">
        <select class="input" data-role="rc-ing">${this.ingredientOptions(ings, r.ingredientId)}</select>
        <input class="input" type="number" min="0" step="any" inputmode="decimal" placeholder="Amount" data-role="rc-qty" value="${esc(r.qty)}">
        <span class="unit">${esc(unitOf(r.ingredientId))}</span>
        <button class="icon-btn" data-act="rc-del" data-i="${i}" aria-label="Remove">✕</button>
      </div>`).join('');

    // Cost per portion and what is left of the price, shown under the rows.
    const summary = () => {
      const m = Modal.el();
      const price = parseFloat(m.querySelector('[name=price]').value) || 0;
      const cost = recipe.reduce((n, r) => n + (parseFloat(r.qty) || 0) * ((Store.ingredient(r.ingredientId) || {}).cost || 0), 0);
      m.querySelector('[data-role=rc-sum]').innerHTML = recipe.length
        ? `Cost per portion <b>${costMoney(cost)}</b> · profit <b>${costMoney(price - cost)}</b> (${price > 0 ? Math.round((price - cost) / price * 100) : 0}% margin)`
        : 'No recipe: selling this item does not use up any ingredients.';
    };
    const refresh = () => { Modal.el().querySelector('[data-role=rc-rows]').innerHTML = rows(); summary(); };

    return {
      html: () => `
        <div class="field-label">Recipe — what one portion uses (optional)</div>
        <div data-role="rc-rows">${rows()}</div>
        <button class="btn small" data-act="rc-add" ${ings.length ? '' : 'disabled'}>＋ Add ingredient</button>
        <div class="recipe-sum" data-role="rc-sum"></div>`,
      actions: {
        'rc-add': () => {
          if (!ings.length) return toast('Add ingredients under Inventory first', 'error');
          const unused = ings.find(i => !recipe.some(r => r.ingredientId === i.id)) || ings[0];
          recipe.push({ ingredientId: unused.id, qty: '' });
          refresh();
        },
        'rc-del': t => { recipe.splice(+t.dataset.i, 1); refresh(); },
      },
      input(e) {
        if (e.target.dataset.role === 'rc-qty') { rowOf(e.target).qty = e.target.value; summary(); }
        else if (e.target.name === 'price') summary();   // the margin follows the price
      },
      change(e) { if (e.target.dataset.role === 'rc-ing') { rowOf(e.target).ingredientId = e.target.value; refresh(); } },
      afterOpen: summary,
      read() {
        const filled = recipe.filter(r => r.qty !== '');
        if (filled.some(r => !(parseFloat(r.qty) > 0))) throw new Error('Each recipe ingredient needs an amount above 0');
        if (new Set(filled.map(r => r.ingredientId)).size !== filled.length) throw new Error('An ingredient is listed twice in the recipe');
        return { recipe: filled.map(r => ({ ingredientId: r.ingredientId, qty: round4(parseFloat(r.qty)) })) };
      },
    };
  },
});
