'use strict';

// Item editor, options part: options with a price ("Extra shot +0.50"), each of which can also use extra ingredients
// (an extra shot uses more beans). See photoSection for the shape of a part.
Object.assign(Screens.products, {
  optionsSection(p, ings) {
    const options = (p.options || []).map(o => ({ name: o.name, price: String(o.price), uses: (o.uses || []).map(u => ({ ingredientId: u.ingredientId, qty: String(u.qty) })) }));
    const unitOf = id => (Store.ingredient(id) || {}).unit || '';
    const optOf = el => options[+el.closest('[data-oi]').dataset.oi];
    const useOf = el => optOf(el).uses[+el.closest('[data-ui]').dataset.ui];

    const rows = () => options.map((o, oi) => `
      <div class="opt-edit" data-oi="${oi}">
        <div class="opt-head">
          <input class="input" data-role="o-name" placeholder="Option name, e.g. Extra shot" maxlength="30" value="${esc(o.name)}">
          <input class="input" type="number" min="0" step="${moneyStep()}" inputmode="decimal" data-role="o-price" placeholder="Extra price" value="${esc(o.price)}">
          <button class="icon-btn" data-act="o-del" data-oi="${oi}" aria-label="Remove option">✕</button>
        </div>
        ${o.uses.map((u, ui) => `
          <div class="line-row recipe opt-use" data-oi="${oi}" data-ui="${ui}">
            <select class="input" data-role="u-ing">${this.ingredientOptions(ings, u.ingredientId)}</select>
            <input class="input" type="number" min="0" step="any" inputmode="decimal" placeholder="Extra amount" data-role="u-qty" value="${esc(u.qty)}">
            <span class="unit">${esc(unitOf(u.ingredientId))}</span>
            <button class="icon-btn" data-act="u-del" data-oi="${oi}" data-ui="${ui}" aria-label="Remove">✕</button>
          </div>`).join('')}
        <button class="btn small" data-act="u-add" data-oi="${oi}" ${ings.length ? '' : 'disabled'}>＋ Uses an ingredient</button>
      </div>`).join('');
    const refresh = () => { Modal.el().querySelector('[data-role=opt-rows]').innerHTML = rows(); };

    return {
      html: () => `
        <div class="field-label">Options with a price — optional (e.g. Extra shot +0.50; an option can use extra ingredients)</div>
        <div data-role="opt-rows">${rows()}</div>
        <button class="btn small" data-act="o-add">＋ Add option</button>`,
      actions: {
        'o-add': () => { options.push({ name: '', price: '', uses: [] }); refresh(); },
        'o-del': t => { options.splice(+t.dataset.oi, 1); refresh(); },
        'u-add': t => {
          if (!ings.length) return toast('Add ingredients under Inventory first', 'error');
          options[+t.dataset.oi].uses.push({ ingredientId: ings[0].id, qty: '' });
          refresh();
        },
        'u-del': t => { options[+t.dataset.oi].uses.splice(+t.dataset.ui, 1); refresh(); },
      },
      input(e) {
        const role = e.target.dataset.role;
        if (role === 'o-name') optOf(e.target).name = e.target.value;
        else if (role === 'o-price') optOf(e.target).price = e.target.value;
        else if (role === 'u-qty') useOf(e.target).qty = e.target.value;
      },
      change(e) { if (e.target.dataset.role === 'u-ing') { useOf(e.target).ingredientId = e.target.value; refresh(); } },
      read() {
        const clean = [];
        for (const o of options) {
          const name = o.name.trim();
          if (!name && o.price === '' && !o.uses.length) continue; // an empty row
          const extra = o.price === '' ? 0 : parseFloat(o.price);
          if (!name || !(extra >= 0)) throw new Error('Each option needs a name and a price of 0 or more');
          if (clean.some(x => x.name === name)) throw new Error(`Option "${name}" is listed twice`);
          const uses = o.uses.filter(u => u.qty !== '');
          if (uses.some(u => !(parseFloat(u.qty) > 0))) throw new Error(`Option "${name}": each ingredient needs an amount above 0`);
          if (new Set(uses.map(u => u.ingredientId)).size !== uses.length) throw new Error(`Option "${name}": an ingredient is listed twice`);
          clean.push({ name, price: rmoney(extra), ...(uses.length ? { uses: uses.map(u => ({ ingredientId: u.ingredientId, qty: round4(parseFloat(u.qty)) })) } : {}) });
        }
        if (clean.length > 8) throw new Error('At most 8 options per item');
        return { options: clean };
      },
    };
  },
});
