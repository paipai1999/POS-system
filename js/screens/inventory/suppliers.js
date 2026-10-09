'use strict';

// Inventory, Suppliers tab: the supplier list, what is owed, payments and statements.
Object.assign(Screens.inventory, {
  suppliersHTML() {
    const list = Store.data.suppliers.slice().sort((a, b) => (b.owed || 0) - (a.owed || 0) || a.name.localeCompare(b.name));
    const owed = list.reduce((n, s) => n + (s.owed || 0), 0);
    const stat = (label, v, sub = '') => `<div class="card stat"><div class="label">${label}</div><div class="value">${v}</div>${sub ? `<div class="muted small">${sub}</div>` : ''}</div>`;
    return `
      <div class="stats">
        ${stat('Owed to suppliers', money(owed), 'not paid yet')}
        ${stat('Suppliers', list.length)}
      </div>
      <p class="muted small">Choose a supplier when you record a purchase. Whatever you do not pay then is owed to them until you record a payment here. A cash payment also leaves the till, so the cash drawer counts it.</p>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Supplier</th><th>Phone</th><th class="num">Owed</th><th></th></tr></thead>
          <tbody>${list.map(s => `
            <tr>
              <td><b>${esc(s.name)}</b>${s.active === false ? ' <span class="pill muted">inactive</span>' : ''}${s.note ? `<div class="muted small">${esc(s.note)}</div>` : ''}</td>
              <td>${esc(s.phone || '—')}</td>
              <td class="num ${(s.owed || 0) > 0 ? 'diff-bad' : ''}">${money(s.owed || 0)}</td>
              <td><div class="row-actions">
                <button class="btn small primary" data-act="pay-supplier" data-id="${s.id}" ${(s.owed || 0) > 0 ? '' : 'disabled'}>Pay</button>
                <button class="btn small" data-act="supplier-statement" data-id="${s.id}">Statement</button>
                <button class="btn small" data-act="edit-supplier" data-id="${s.id}">Edit</button>
              </div></td>
            </tr>`).join('') || '<tr><td colspan="4" class="empty">No suppliers yet</td></tr>'}
          </tbody>
        </table>
      </div>`;
  },

  editSupplier(id) {
    const cur = id ? Store.supplier(id) : null;
    const s = cur || { name: '', phone: '', note: '', active: true };
    const actions = {
      save: () => {
        const v = formValues(Modal.el());
        try {
          if (!cur) Store.addSupplier({ name: v.name, phone: v.phone, note: v.note });
          else {
            if (!v.name) throw new Error('Supplier name is required');
            if (Store.data.suppliers.some(x => x.id !== id && x.name.toLowerCase() === v.name.toLowerCase())) throw new Error('A supplier with that name already exists');
            Object.assign(Store.supplier(id), { name: v.name, phone: v.phone, note: v.note, active: v.active });
            Store.save();
          }
        } catch (e) { return toast(e.message, 'error'); }
        Modal.close();
        this.render(this.root);
        toast('Saved', 'ok');
      },
      delete: () => confirmDialog({
        title: `Delete ${s.name}?`,
        message: 'A supplier that is owed money, or has purchases on record, cannot be deleted; untick "Active" instead.',
        okLabel: 'Delete',
        danger: true,
        onOk: () => {
          if ((cur.owed || 0) !== 0) return toast(`${cur.name} is still owed money. Pay it first, or deactivate the supplier instead.`, 'error');
          Store.data.suppliers = Store.data.suppliers.filter(x => x.id !== id);
          Store.save();
          this.render(this.root);
        },
      }),
    };
    actions.__enter = actions.save;
    Modal.open({
      title: id ? `Edit ${s.name}` : 'New supplier',
      body: `
        <div class="grid-2">
          <label class="field"><span>Name</span><input class="input" name="name" value="${esc(s.name)}" maxlength="60" autofocus></label>
          <label class="field"><span>Phone</span><input class="input" name="phone" type="tel" value="${esc(s.phone)}" maxlength="30"></label>
        </div>
        <label class="field"><span>Note</span><input class="input" name="note" value="${esc(s.note)}" maxlength="200" placeholder="e.g. delivers on Mondays"></label>
        <label class="check"><input type="checkbox" name="active" ${s.active !== false ? 'checked' : ''}> Active</label>`,
      footer: `${id ? '<button class="btn danger" data-act="delete">Delete</button><span class="spacer"></span>' : ''}
        <button class="btn" data-act="__close">Cancel</button><button class="btn primary" data-act="save">Save</button>`,
      actions,
    });
  },

  paySupplier(id) {
    const s = Store.supplier(id);
    if (!s || !(s.owed > 0)) return;
    const actions = {
      save: () => {
        const m = Modal.el();
        try {
          Store.addSupplierPayment({ supplierId: id, amount: parseFloat(m.querySelector('[name=amount]').value), method: m.querySelector('[name=method]').value, note: m.querySelector('[name=note]').value });
        } catch (e) { return toast(e.message, 'error'); }
        Modal.close();
        this.render(this.root);
        toast('Payment recorded', 'ok');
      },
    };
    actions.__enter = actions.save;
    Modal.open({
      title: `Pay ${s.name}`,
      body: `
        <p class="muted">Owed to ${esc(s.name)}: <b>${money(s.owed)}</b></p>
        <label class="field"><span>Amount paid</span><input class="input big-input" name="amount" type="number" min="0" step="${moneyStep()}" inputmode="decimal" value="${s.owed}" autofocus></label>
        <label class="field"><span>Paid from</span>
          <select class="input" name="method"><option value="cash">Cash from the till</option><option value="other">Bank, cheque or other</option></select></label>
        <label class="field"><span>Note (optional)</span><input class="input" name="note" maxlength="200" placeholder="e.g. cheque 17"></label>
        <p class="muted small">Cash from the till is taken off what the cash drawer should hold.</p>`,
      footer: '<button class="btn" data-act="__close">Cancel</button><button class="btn primary" data-act="save">Record payment</button>',
      actions,
    });
  },

  // What was bought from a supplier and what was paid, newest first (the last 90 days are loaded).
  statement(id) {
    const s = Store.supplier(id);
    if (!s) return;
    const rows = [
      ...Store.data.purchases.filter(p => p.supplierId === id).map(p => ({ at: p.date, kind: 'purchase', p })),
      ...Store.data.supplierPayments.filter(p => p.supplierId === id).map(p => ({ at: p.date, kind: 'payment', p })),
    ].sort((a, b) => b.at - a.at);
    const actions = {
      'void-payment': t => requireManager('Void this payment.', () => {
        const pay = Store.data.supplierPayments.find(x => x.id === t.dataset.id);
        if (!pay || pay.status === 'void') return;
        Store.voidSupplierPayment(pay);
        Modal.close();
        this.render(this.root);
        toast('Payment voided');
      }),
    };
    Modal.open({
      title: `${s.name} · statement`,
      wide: true,
      body: `
        <p class="muted">Owed now: <b>${money(s.owed || 0)}</b>${s.phone ? ` · ${esc(s.phone)}` : ''}</p>
        <div class="table-wrap audit-wrap">
          <table class="data compact">
            <thead><tr><th>Date</th><th>What</th><th class="num">Amount</th><th class="num">Owed change</th><th></th></tr></thead>
            <tbody>${rows.map(r => r.kind === 'purchase' ? `
              <tr class="${r.p.status === 'void' ? 'muted' : ''}">
                <td>${fmtDateTime(r.at)}</td>
                <td>Purchase${r.p.status === 'void' ? ' (void)' : ''}</td>
                <td class="num">${money(r.p.total)}</td>
                <td class="num">${r.p.status === 'void' ? '—' : (r.p.paid ?? r.p.total) < r.p.total ? '+' + money(r.p.total - r.p.paid) : '—'}</td>
                <td></td>
              </tr>` : `
              <tr class="${r.p.status === 'void' ? 'muted' : ''}">
                <td>${fmtDateTime(r.at)}</td>
                <td>Payment${r.p.method === 'cash' ? ' (cash)' : ''}${r.p.status === 'void' ? ' (void)' : ''}${r.p.note ? ` · ${esc(r.p.note)}` : ''}</td>
                <td class="num">${money(r.p.amount)}</td>
                <td class="num">${r.p.status === 'void' ? '—' : '−' + money(r.p.amount)}</td>
                <td>${r.p.status !== 'void' && App.can('manage') ? `<button class="btn small danger" data-act="void-payment" data-id="${r.p.id}">Void</button>` : ''}</td>
              </tr>`).join('') || '<tr><td colspan="5" class="empty">Nothing recorded yet</td></tr>'}
            </tbody>
          </table>
        </div>`,
      footer: '<button class="btn primary" data-act="__close">Close</button>',
      actions,
    });
  },
});
