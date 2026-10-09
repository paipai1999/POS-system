'use strict';

// Inventory, Purchases tab: stock bought, who it was bought from and how much was paid.
Object.assign(Screens.inventory, {
  purchasesHTML() {
    const list = Store.data.purchases.slice().sort((a, b) => b.date - a.date).slice(0, 100);
    return `
      <p class="muted small">Record stock you buy. The amount goes into stock and each ingredient's cost moves to the average of what you paid. Showing the last 90 days.</p>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Date</th><th>Supplier</th><th>Items</th><th class="num">Total</th><th class="num">Paid</th><th>By</th><th>Status</th><th></th></tr></thead>
          <tbody>${list.map(p => `
            <tr>
              <td>${fmtDateTime(p.date)}</td>
              <td>${esc(p.supplier || '—')}</td>
              <td class="small wrap-cell">${esc(p.lines.map(l => `${qtyText(l.qty)} ${l.unit || ''} ${l.name || (Store.ingredient(l.ingredientId) || {}).name || ''}`.replace(/\s+/g, ' ')).join(', '))}</td>
              <td class="num">${money(p.total)}</td>
              <td class="num">${p.status === 'void' ? '—' : (p.paid ?? p.total) < p.total ? `${money(p.paid)} <span class="pill open">owes ${money(p.total - p.paid)}</span>` : money(p.paid ?? p.total)}</td>
              <td>${this.who(p.by)}</td>
              <td><span class="pill ${p.status === 'void' ? 'void' : 'paid'}">${p.status === 'void' ? 'void' : 'received'}</span></td>
              <td><div class="row-actions">
                <button class="btn small" data-act="view-purchase" data-id="${p.id}">View</button>
                ${p.status === 'received' && App.can('manage') ? `<button class="btn small danger" data-act="void-purchase" data-id="${p.id}">Void</button>` : ''}
              </div></td>
            </tr>`).join('') || '<tr><td colspan="8" class="empty">No purchases yet</td></tr>'}
          </tbody>
        </table>
      </div>`;
  },

  newPurchase() {
    const ings = Store.data.ingredients.filter(i => i.active !== false);
    if (!ings.length) return toast('Add an ingredient first', 'error');
    const suppliers = Store.data.suppliers.filter(s => s.active !== false);
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
        try {
          let supplierId = m.querySelector('[name=supplierId]').value || null;
          const newName = m.querySelector('[name=newSupplier]').value.trim();
          if (newName) supplierId = (Store.data.suppliers.find(s => s.name.toLowerCase() === newName.toLowerCase()) || Store.addSupplier({ name: newName })).id;
          const paid = m.querySelector('[name=paid]').value;
          const tax = m.querySelector('[name=taxAmount]').value;
          Store.addPurchase({
            supplierId, note: m.querySelector('[name=note]').value, lines, paid: paid === '' ? null : parseFloat(paid),
            payMethod: m.querySelector('[name=payMethod]').value, taxAmount: tax === '' ? 0 : parseFloat(tax),
          });
        } catch (e) { return toast(e.message, 'error'); }
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
          <label class="field"><span>Supplier</span>
            <select class="input" name="supplierId" autofocus><option value="">— none —</option>${suppliers.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
          <label class="field"><span>Or a new supplier</span><input class="input" name="newSupplier" maxlength="60"></label>
        </div>
        <div class="grid-2">
          <label class="field"><span>Note (optional)</span><input class="input" name="note" maxlength="300" placeholder="e.g. invoice 1042"></label>
          <label class="field"><span>Paid now (empty = paid in full)</span><input class="input" name="paid" type="number" min="0" step="${moneyStep()}" inputmode="decimal" placeholder="all"></label>
        </div>
        <div class="grid-2">
          <label class="field"><span>Paid with</span>
            <select class="input" name="payMethod">
              <option value="cash">Cash from the till</option><option value="card">Card</option><option value="other">Bank transfer / mobile wallet</option>
            </select></label>
          <label class="field"><span>Tax included in the price (optional)</span><input class="input" name="taxAmount" type="number" min="0" step="${moneyStep()}" inputmode="decimal" placeholder="none"></label>
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
        ${(p.paid ?? p.total) < p.total ? `<p class="small">Paid ${money(p.paid)} of ${money(p.total)}: <b>${money(p.total - p.paid)}</b> is owed to the supplier.</p>` : ''}
        ${p.payMethod && (p.paid ?? p.total) > 0 ? `<p class="small muted"><span>Paid with</span> <b>${{ cash: 'Cash from the till', card: 'Card', other: 'Bank transfer / mobile wallet' }[p.payMethod]}</b></p>` : ''}
        ${p.taxAmount ? `<p class="small muted"><span>Tax included in the price</span> <b>${money(p.taxAmount)}</b></p>` : ''}
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
});
