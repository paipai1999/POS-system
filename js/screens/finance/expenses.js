'use strict';

// Finance tab: expenses - what the restaurant spends besides ingredients (rent, salaries, utilities…), the expenses that
// repeat every month, and the owner's money moves. Voiding is allowed; editing is not (void and enter it again).
(() => {
  const METHOD_LABEL = { cash: 'Cash from the till', card: 'Card', other: 'Bank transfer / mobile wallet' };
  const todayInput = () => isoDate(new Date());

  // The date a dialog's date box means: now for today, otherwise midday of that day.
  const dateOf = value => {
    if (!value || value === todayInput()) return undefined;
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d, 12).getTime();
  };

  const inPeriod = (list, f) => {
    const [a, b] = f.bounds();
    return list.filter(x => x.date >= a && x.date < b).sort((x, y) => y.date - x.date);
  };

  const methodSelect = (name, allowCash = true) => `
    <select class="input" name="${name}">
      ${(allowCash ? ['cash', 'card', 'other'] : ['other', 'card']).map(k => `<option value="${k}">${METHOD_LABEL[k]}</option>`).join('')}
    </select>`;

  function html(f) {
    const expenses = inPeriod(Store.data.expenses, f);
    const active = expenses.filter(e => e.status !== 'void');
    const total = active.reduce((n, e) => n + e.amount, 0);
    const byCategory = {};
    for (const e of active) byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
    const owner = inPeriod(Store.data.ownerMoves, f);
    const who = id => (id === 'system' ? 'Automatic' : (Store.user(id) || {}).name || '');
    return `
      <div class="toolbar">
        <button class="btn primary" data-act="new-expense">＋ Add expense</button>
        <button class="btn" data-act="new-recurring">🔁 Repeating expense</button>
        <button class="btn" data-act="new-owner">👤 Owner money in / out</button>
      </div>
      <div class="stats compact">
        <div class="card stat"><div class="label">Expenses</div><div class="value">${money(total)}</div><div class="muted small">${active.length} <span>records</span></div></div>
      </div>
      <div class="report-grid">
        <section class="card"><h2>By category</h2>${barList(Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([name, v]) => ({ label: name, value: v, text: money(v) })))}</section>
      </div>

      <h2 class="section-title">Expenses</h2>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Date</th><th>Category</th><th>Details</th><th>Paid with</th><th class="num">Amount</th><th></th></tr></thead>
          <tbody>${expenses.map(e => `
            <tr class="${e.status === 'void' ? 'is-void' : ''}">
              <td>${esc(f.dayText(e.date))}</td>
              <td><span>${esc(e.category)}</span>${e.recurringId ? ' <span title="Repeating expense" aria-hidden="true">🔁</span>' : ''}</td>
              <td class="wrap">${esc([e.description, e.payee].filter(Boolean).join(' · '))}${e.note ? `<div class="muted small">${esc(e.note)}</div>` : ''}${e.by && e.by !== 'system' ? `<div class="muted small">${esc(who(e.by))}</div>` : ''}</td>
              <td>${METHOD_LABEL[e.method] || esc(e.method)}</td>
              <td class="num">${money(e.amount)}${e.taxAmount ? `<div class="muted small"><span>Tax</span> ${money(e.taxAmount)}</div>` : ''}</td>
              <td>${e.status === 'void' ? '<span class="pill void">void</span>' : `<button class="btn small danger" data-act="void-expense" data-id="${e.id}">Void</button>`}</td>
            </tr>`).join('') || '<tr><td colspan="6" class="empty">No expenses in this period</td></tr>'}
          </tbody>
        </table>
      </div>

      <h2 class="section-title">Repeating expenses</h2>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Category</th><th>Details</th><th>Paid with</th><th>Day of the month</th><th class="num">Amount</th><th>On</th><th></th></tr></thead>
          <tbody>${Store.data.recurringExpenses.map(r => `
            <tr>
              <td>${esc(r.category)}</td>
              <td class="wrap">${esc([r.description, r.payee].filter(Boolean).join(' · '))}</td>
              <td>${METHOD_LABEL[r.method] || esc(r.method)}</td>
              <td>${r.day}</td>
              <td class="num">${money(r.amount)}</td>
              <td><label class="switch"><input type="checkbox" data-act="toggle-recurring" data-id="${r.id}" ${r.active !== false ? 'checked' : ''}><span></span></label></td>
              <td><div class="row-actions"><button class="btn small" data-act="edit-recurring" data-id="${r.id}">Edit</button><button class="btn small danger" data-act="del-recurring" data-id="${r.id}">Remove</button></div></td>
            </tr>`).join('') || '<tr><td colspan="7" class="empty">No repeating expenses. Add rent or salaries once and they are recorded every month.</td></tr>'}
          </tbody>
        </table>
      </div>

      <h2 class="section-title">Owner money</h2>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Date</th><th>Money</th><th>Paid with</th><th class="num">Amount</th><th>Note</th><th></th></tr></thead>
          <tbody>${owner.map(m => `
            <tr class="${m.status === 'void' ? 'is-void' : ''}">
              <td>${esc(f.dayText(m.date))}</td>
              <td>${m.type === 'in' ? 'Put in' : 'Taken out'}</td>
              <td>${METHOD_LABEL[m.method] || esc(m.method)}</td>
              <td class="num">${money(m.amount)}</td>
              <td class="wrap">${esc(m.note || '')}</td>
              <td>${m.status === 'void' ? '<span class="pill void">void</span>' : `<button class="btn small danger" data-act="void-owner" data-id="${m.id}">Void</button>`}</td>
            </tr>`).join('') || '<tr><td colspan="6" class="empty">No owner money in this period</td></tr>'}
          </tbody>
        </table>
      </div>`;
  }

  // ----- dialogs -----
  function categoryOptions(selected) {
    return Finance.financeOf(Store.settings).categories.map(c => `<option value="${esc(c)}" ${c === selected ? 'selected' : ''}>${esc(c)}</option>`).join('');
  }

  function expenseDialog(f) {
    const actions = {
      save: () => {
        const m = Modal.el();
        const v = formValues(m);
        try {
          Store.addExpense({
            date: dateOf(v.date), category: v.category, amount: parseFloat(v.amount), taxAmount: v.taxAmount === '' ? 0 : parseFloat(v.taxAmount),
            method: v.method, payee: v.payee, description: v.description, note: v.note,
          });
        } catch (e) { return toast(e.message, 'error'); }
        Modal.close();
        f.render(f.root);
        toast('Expense recorded', 'ok');
      },
    };
    actions.__enter = actions.save;
    Modal.open({
      title: 'Add expense',
      body: `
        <div class="grid-2">
          <label class="field"><span>Date</span><input class="input" type="date" name="date" value="${todayInput()}" max="${todayInput()}"></label>
          <label class="field"><span>Category</span><select class="input" name="category">${categoryOptions('')}</select></label>
        </div>
        <div class="grid-2">
          <label class="field"><span>Amount</span><input class="input big-input" name="amount" type="number" min="0" step="${moneyStep()}" inputmode="decimal" autofocus></label>
          <label class="field"><span>Tax included (optional)</span><input class="input" name="taxAmount" type="number" min="0" step="${moneyStep()}" inputmode="decimal"></label>
        </div>
        <div class="grid-2">
          <label class="field"><span>Paid with</span>${methodSelect('method')}</label>
          <label class="field"><span>Paid to (optional)</span><input class="input" name="payee" maxlength="60"></label>
        </div>
        <label class="field"><span>Description (optional)</span><input class="input" name="description" maxlength="120" placeholder="e.g. electricity bill, March"></label>
        <label class="field"><span>Note (optional)</span><input class="input" name="note" maxlength="300"></label>
        <p class="muted small">Cash comes out of the till and is counted in the shift. A day that has been closed cannot be changed.</p>`,
      footer: '<button class="btn" data-act="__close">Cancel</button><button class="btn primary" data-act="save">Save expense</button>',
      actions,
    });
  }

  function recurringDialog(f, id) {
    const r = id ? Store.data.recurringExpenses.find(x => x.id === id) : null;
    const actions = {
      save: () => {
        const v = formValues(Modal.el());
        try {
          Store.saveRecurring({
            id: r ? r.id : undefined, category: v.category, description: v.description, amount: parseFloat(v.amount), taxAmount: v.taxAmount === '' ? 0 : parseFloat(v.taxAmount),
            method: v.method, payee: v.payee, day: parseInt(v.day, 10), startMonth: v.startMonth, active: r ? r.active !== false : true,
          });
        } catch (e) { return toast(e.message, 'error'); }
        Modal.close();
        f.render(f.root);
        toast('Saved', 'ok');
      },
    };
    actions.__enter = actions.save;
    Modal.open({
      title: r ? 'Edit repeating expense' : 'Repeating expense',
      body: `
        <p class="muted small">Recorded automatically once a month, for example rent or salaries. It is never taken from the till.</p>
        <div class="grid-2">
          <label class="field"><span>Category</span><select class="input" name="category">${categoryOptions(r ? r.category : '')}</select></label>
          <label class="field"><span>Amount</span><input class="input" name="amount" type="number" min="0" step="${moneyStep()}" inputmode="decimal" value="${r ? r.amount : ''}" autofocus></label>
        </div>
        <div class="grid-2">
          <label class="field"><span>Day of the month (1-28)</span><input class="input" name="day" type="number" min="1" max="28" step="1" value="${r ? r.day : 1}"></label>
          <label class="field"><span>First month</span><input class="input" type="month" name="startMonth" value="${r ? r.startMonth : Finance.monthKey(Date.now())}" ${r ? 'disabled' : ''}></label>
        </div>
        <div class="grid-2">
          <label class="field"><span>Paid with</span>${methodSelect('method', false)}</label>
          <label class="field"><span>Tax included (optional)</span><input class="input" name="taxAmount" type="number" min="0" step="${moneyStep()}" inputmode="decimal" value="${r && r.taxAmount ? r.taxAmount : ''}"></label>
        </div>
        <label class="field"><span>Paid to (optional)</span><input class="input" name="payee" maxlength="60" value="${esc(r ? r.payee : '')}"></label>
        <label class="field"><span>Description (optional)</span><input class="input" name="description" maxlength="120" value="${esc(r ? r.description : '')}"></label>`,
      footer: '<button class="btn" data-act="__close">Cancel</button><button class="btn primary" data-act="save">Save</button>',
      actions,
    });
    if (r) Modal.el().querySelector('[name=method]').value = r.method;
  }

  function ownerDialog(f) {
    const actions = {
      save: () => {
        const v = formValues(Modal.el());
        try {
          Store.addOwnerMove({ date: dateOf(v.date), type: v.type, amount: parseFloat(v.amount), method: v.method, note: v.note });
        } catch (e) { return toast(e.message, 'error'); }
        Modal.close();
        f.render(f.root);
        toast('Recorded', 'ok');
      },
    };
    actions.__enter = actions.save;
    Modal.open({
      title: 'Owner money in / out',
      body: `
        <p class="muted small">Money the owner puts into the business (a float, a loan) or takes out for themselves. It is not a sale or an expense, but it changes the cash and bank balances.</p>
        <div class="grid-2">
          <label class="field"><span>Money</span><select class="input" name="type"><option value="in">Put in</option><option value="out">Taken out</option></select></label>
          <label class="field"><span>Amount</span><input class="input big-input" name="amount" type="number" min="0" step="${moneyStep()}" inputmode="decimal" autofocus></label>
        </div>
        <div class="grid-2">
          <label class="field"><span>Date</span><input class="input" type="date" name="date" value="${todayInput()}" max="${todayInput()}"></label>
          <label class="field"><span>Paid with</span>${methodSelect('method')}</label>
        </div>
        <label class="field"><span>Note (optional)</span><input class="input" name="note" maxlength="300"></label>`,
      footer: '<button class="btn" data-act="__close">Cancel</button><button class="btn primary" data-act="save">Save</button>',
      actions,
    });
  }

  const voidWith = (f, title, find, voidFn) => id => {
    const rec = find(id);
    if (!rec) return;
    confirmDialog({
      title, message: `${money(rec.amount)} will be marked void and no longer counted.`, okLabel: 'Void', danger: true,
      onOk: () => {
        try { voidFn(rec); } catch (e) { return toast(e.message, 'error'); }
        f.render(f.root);
      },
    });
  };

  // ----- CSV: expenses, then the owner's money -----
  function csv(f) {
    const rows = [['Date', 'Category', 'Description', 'Paid to', 'Paid with', 'Amount', 'Tax included', 'Status']];
    for (const e of inPeriod(Store.data.expenses, f)) rows.push([isoDate(new Date(e.date)), e.category, e.description, e.payee, e.method, e.amount, e.taxAmount || 0, e.status]);
    rows.push([], ['Owner money', 'Type', 'Note', '', 'Paid with', 'Amount', '', 'Status']);
    for (const m of inPeriod(Store.data.ownerMoves, f)) rows.push([isoDate(new Date(m.date)), m.type === 'in' ? 'Put in' : 'Taken out', m.note, '', m.method, m.amount, '', m.status]);
    return rows;
  }

  Screens.finance.tabs.expenses = {
    label: 'Expenses', uses: 'period', html, csv, filename: 'expenses',
    actions: {
      'new-expense': f => expenseDialog(f),
      'new-recurring': f => recurringDialog(f, null),
      'edit-recurring': (f, t) => recurringDialog(f, t.dataset.id),
      'new-owner': f => ownerDialog(f),
      'void-expense': (f, t) => voidWith(f, 'Void this expense?', id => Store.data.expenses.find(e => e.id === id), e => Store.voidExpense(e))(t.dataset.id),
      'void-owner': (f, t) => voidWith(f, 'Void this record?', id => Store.data.ownerMoves.find(m => m.id === id), m => Store.voidOwnerMove(m))(t.dataset.id),
      'del-recurring': (f, t) => confirmDialog({
        title: 'Remove this repeating expense?', message: 'Expenses already recorded stay. No more will be added.', okLabel: 'Remove', danger: true,
        onOk: () => { Store.removeRecurring(t.dataset.id); f.render(f.root); },
      }),
      'toggle-recurring': (f, t) => {
        const r = Store.data.recurringExpenses.find(x => x.id === t.dataset.id);
        if (!r) return;
        try { Store.saveRecurring({ ...r, active: t.checked }); } catch (e) { toast(e.message, 'error'); }
        f.render(f.root);
      },
    },
  };
})();
