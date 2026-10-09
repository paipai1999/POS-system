'use strict';

// Inventory: ingredients, purchases, suppliers and stocktakes (one tab each). This file is the screen itself; the tabs are in
// ingredients.js, purchases.js, suppliers.js and stocktakes.js.

// Inventory: the ingredients behind the menu, stock coming in (purchases) and stock counted (stocktakes).
// Dishes use up ingredients when a bill is paid; that is set per item under Menu & Stock (the recipe).
const INGREDIENT_UNITS = ['g', 'kg', 'ml', 'l', 'pcs', 'portion'];

Screens.inventory = {
  perm: 'products',

  live: ['ingredients', 'purchases', 'stocktakes', 'suppliers', 'supplierPayments', 'products', 'settings', 'users'],

  state: { tab: 'ingredients', q: '' },

  root: null,

  render(root) {
    this.root = root;
    const st = this.state;
    const add = { ingredients: ['new-ingredient', '＋ Add ingredient'], purchases: ['new-purchase', '＋ New purchase'], suppliers: ['new-supplier', '＋ Add supplier'], stocktakes: ['new-stocktake', '＋ New stocktake'] }[st.tab];
    root.innerHTML = `
      <div class="page-head">
        <h1>Inventory</h1>
        <div class="actions">
          <div class="seg">
            ${[['ingredients', 'Ingredients'], ['purchases', 'Purchases'], ['suppliers', 'Suppliers'], ['stocktakes', 'Stocktake']].map(([k, label]) =>
              `<button data-act="tab" data-tab="${k}" class="${st.tab === k ? 'active' : ''}">${label}</button>`).join('')}
          </div>
          <button class="btn primary" data-act="${add[0]}">${add[1]}</button>
        </div>
      </div>
      ${st.tab === 'ingredients' ? this.ingredientsHTML() : st.tab === 'purchases' ? this.purchasesHTML() : st.tab === 'suppliers' ? this.suppliersHTML() : this.stocktakesHTML()}`;

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
        case 'new-supplier': this.editSupplier(null); break;
        case 'edit-supplier': this.editSupplier(id); break;
        case 'pay-supplier': this.paySupplier(id); break;
        case 'supplier-statement': this.statement(id); break;
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
};
