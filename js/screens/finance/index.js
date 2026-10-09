'use strict';

// Finance (managers and admins): the financial statements and the money records behind them.
// This file is the screen itself: the tabs, loading older records, and sending clicks to the right tab.
//   period.js       the period (today, this month, custom…) and the "compared with" period
//   profit-loss.js  cash-flow.js  position.js  tax.js  expenses.js  daily-close.js  controls.js     one file per tab
//   export.js       CSV files and printing
//
// A tab is an object registered in Screens.finance.tabs:
//   { label, uses: 'period' | 'now' | 'day', perm?, needFrom?(f), html(f), csv?(f), actions?: { name: (f, target) => … }, changes?: { role: (f, target) => … } }
// `perm` hides the tab from people without that permission; `needFrom` says how far back its records must reach (a moment).
// `f` is this screen. `uses` says which period the tab works on: the chosen period, "as of now", or one calendar day.
const FINANCE_TAB_ORDER = ['pl', 'cash', 'position', 'tax', 'receivables', 'expenses', 'close', 'controls'];

Screens.finance = {
  perm: 'reports',
  live: ['orders', 'purchases', 'supplierPayments', 'stocktakes', 'expenses', 'recurringExpenses', 'ownerMoves', 'dayCloses', 'shifts', 'ingredients', 'suppliers', 'settings', 'users'],
  state: { tab: 'pl', range: 'month', from: isoDate(new Date()), to: isoDate(new Date()), cogs: 'recipe', compare: true, day: isoDate(new Date()) },
  root: null,
  tabs: {},   // filled in by the tab files

  // The tabs this person may open, in order.
  visibleTabs() { return FINANCE_TAB_ORDER.filter(id => this.tabs[id] && (!this.tabs[id].perm || App.can(this.tabs[id].perm))); },

  tab() { return this.tabs[this.visibleTabs().includes(this.state.tab) ? this.state.tab : 'pl']; },

  // The oldest moment the current tab needs data from.
  needFrom() {
    const tab = this.tab();
    if (tab.needFrom) return tab.needFrom(this);
    if (tab.uses === 'now') return Finance.financeOf(Store.settings).startDate;
    if (tab.uses === 'day') return Finance.dayBounds(this.state.day)[0];
    const [a] = this.bounds();
    return this.state.tab === 'pl' && this.state.compare ? Math.min(a, this.previous()[0]) : a;
  },

  render(root) {
    this.root = root;
    const st = this.state;
    // In server mode a device holds only the last days; older bills and money records are fetched first.
    const from = this.needFrom();
    if (!Sync.historyLoaded(from)) {
      root.innerHTML = '<div class="page-head"><h1>Finance</h1></div><p class="empty">Loading records…</p>';
      Sync.loadHistory(from)
        .then(() => { if (App.screen === 'finance') this.render(root); })
        .catch(e => { root.innerHTML = `<p class="empty">${esc(e.message)}</p>`; });
      return;
    }
    const tab = this.tab();
    root.innerHTML = `
      <div class="page-head">
        <h1>Finance</h1>
        <div class="actions">
          ${tab.csv ? '<button class="btn" data-act="export-csv">⬇️ Export CSV</button>' : ''}
          ${st.tab === 'pl' ? '<button class="btn" data-act="export-pack">⬇️ All statements (CSV)</button>' : ''}
          <button class="btn" data-act="print">🖨️ Print</button>
        </div>
      </div>
      <nav class="tabs" role="tablist">
        ${this.visibleTabs().map(id => `<button role="tab" data-act="tab" data-tab="${id}" class="${this.tab() === this.tabs[id] ? 'active' : ''}">${this.tabs[id].label}</button>`).join('')}
      </nav>
      ${tab.uses === 'period' ? this.periodToolbarHTML() : ''}
      <div data-role="statement">${tab.html(this)}</div>`;

    root.onclick = e => {
      const t = e.target.closest('[data-act]');
      if (!t || t.disabled) return;
      const act = t.dataset.act;
      if (act === 'tab') { st.tab = t.dataset.tab; this.render(root); }
      else if (act === 'range') { st.range = t.dataset.range; this.render(root); }
      else if (act === 'export-csv') this.exportCSV();
      else if (act === 'export-pack') this.exportPack();
      else if (act === 'print') this.printStatement();
      else if (tab.actions && tab.actions[act]) tab.actions[act](this, t);
    };
    root.onchange = e => {
      const role = e.target.dataset.role;
      if (role === 'from' || role === 'to') { st[role] = e.target.value; this.render(root); }
      else if (role === 'cogs') { st.cogs = e.target.value; this.render(root); }
      else if (role === 'compare') { st.compare = e.target.checked; this.render(root); }
      else if (tab.changes && tab.changes[role]) tab.changes[role](this, e.target);
    };
  },
};
