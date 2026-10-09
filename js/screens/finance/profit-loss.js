'use strict';

// Finance tab: profit and loss - what was earned, what it cost and what is left, with the period before for comparison.
(() => {
  // The statement as rows: { label, cur, prev, kind } where kind is 'line', 'sub' (indented), 'total' or 'note'.
  // cur / prev are numbers (prev is null when not comparing).
  function model(f) {
    const st = f.state;
    const opts = { cogsMethod: st.cogs };
    const cur = Finance.profitAndLoss(f.bounds(), Store.data, Store.settings, opts);
    const prev = st.compare ? Finance.profitAndLoss(f.previous(), Store.data, Store.settings, opts) : null;
    const get = fn => ({ cur: fn(cur), prev: prev ? fn(prev) : null });
    const rows = [];
    const add = (label, fn, kind = 'line', extra = {}) => rows.push({ label, ...get(fn), kind, ...extra });

    add('Gross sales', p => p.grossSales);
    add('Discounts', p => -(p.discounts + p.pointsUsed), 'sub');
    add('Refunds made in this period', p => -p.refunds, 'sub');
    add('Net sales', p => p.revenueSales, 'total');
    add('Service charge', p => p.service, 'sub');
    add('Revenue', p => p.revenue, 'total');
    if (st.cogs === 'purchases') {
      add('Cost of goods: ingredients bought', p => -p.cogs.purchases, 'sub');
    } else {
      add('Cost of goods: ingredients used by the dishes sold', p => -p.cogs.recipe, 'sub');
      add('Cost of goods: stock lost or found in stocktakes', p => -p.cogs.shrink, 'sub');
    }
    add('Gross profit', p => p.grossProfit, 'total', { margin: p => p.grossMargin });
    const categories = [...new Set([...cur.expenses.map(e => e.category), ...(prev ? prev.expenses.map(e => e.category) : [])])];
    for (const c of categories) {
      add(c, p => -((p.expenses.find(e => e.category === c) || {}).amount || 0), 'expense');
    }
    if (!categories.length) rows.push({ label: 'No expenses recorded in this period', cur: null, prev: null, kind: 'note' });
    add('Operating expenses', p => -p.expensesTotal, 'total');
    add('Net profit', p => p.netProfit, 'grand', { margin: p => p.netMargin });
    for (const r of rows) if (r.margin) { r.marginCur = r.margin(cur); r.marginPrev = prev ? r.margin(prev) : null; }
    return { rows, cur, prev };
  }

  function html(f) {
    const st = f.state;
    const { rows, cur, prev } = model(f);
    const cell = v => (v === null || v === undefined ? '' : money(v));
    const body = rows.map(r => {
      if (r.kind === 'note') return `<tr class="st-note"><td colspan="${prev ? 4 : 2}" class="muted">${r.label}</td></tr>`;
      return `
        <tr class="st-${r.kind}">
          <td>${esc(r.label)}${r.marginCur !== undefined ? ` <span class="muted small">${f.pct(r.marginCur)}</span>` : ''}</td>
          <td class="num">${cell(r.cur)}</td>
          ${prev ? `<td class="num muted">${cell(r.prev)}</td><td class="num">${f.change(r.cur, r.prev)}</td>` : ''}
        </tr>`;
    }).join('');
    const coverage = cur.cogs.coverage;
    return `
      <div class="toolbar">
        <label class="field inline"><span>Cost of goods</span>
          <select class="input" data-role="cogs">
            <option value="recipe" ${st.cogs === 'recipe' ? 'selected' : ''}>From recipes (what the dishes cost to make)</option>
            <option value="purchases" ${st.cogs === 'purchases' ? 'selected' : ''}>From purchases (what was bought)</option>
          </select></label>
        <label class="check inline"><input type="checkbox" data-role="compare" ${st.compare ? 'checked' : ''}> Compare with the period before</label>
        ${prev ? `<span class="muted small">${esc(f.periodLabel(f.previous()))}</span>` : ''}
      </div>
      <div class="table-wrap">
        <table class="data statement">
          <thead><tr><th>${esc(f.periodLabel())}</th><th class="num">Amount</th>${prev ? '<th class="num">Before</th><th class="num">Change</th>' : ''}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      <div class="notes">
        ${st.cogs === 'recipe' && cur.revenueSales > 0 && coverage < 0.95
          ? `<p class="alert-box"><b>${f.pct(coverage)}</b> <span>of sales have a recipe. The cost of goods is understated until the other dishes get one (Menu &amp; Stock), so profit looks higher than it is.</span></p>` : ''}
        <p class="muted small">Tax collected and tips are not income, so they are left out. Expenses are shown without the tax entered on them. A sale counts on the day it was paid and a refund on the day it was made.</p>
      </div>`;
  }

  // CSV: the same rows.
  function csv(f) {
    const { rows, prev } = model(f);
    return [['', f.periodLabel(), ...(prev ? [f.periodLabel(f.previous())] : [])],
      ...rows.filter(r => r.kind !== 'note').map(r => [r.label, r.cur, ...(prev ? [r.prev] : [])])];
  }

  Screens.finance.tabs.pl = { label: 'Profit & loss', uses: 'period', html, csv, filename: 'profit-and-loss', model };
})();
