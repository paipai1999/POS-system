'use strict';

// Finance tab: business health - food, labour and prime cost, rent, net margin and the break-even point, each with a verdict.
// The calculation is in js/finance/kpis.js; this draws it.
(() => {
  const VERDICT = { good: 'Good', watch: 'Watch', high: 'Too high', none: 'No data' };

  function html(f) {
    const k = Finance.businessKpis(f.bounds(), Store.data, Store.settings);
    if (!(k.revenue > 0)) return '<p class="empty">No sales in this period</p>';
    const card = l => `
      <div class="card stat kpi">
        <div class="label">${l.label}</div>
        <div class="value">${l.ratio === null ? '—' : f.pct(l.ratio)}</div>
        <div class="muted small">${money(l.amount)}</div>
        <span class="pill ${l.status}">${VERDICT[l.status]}</span>
        <div class="muted small kpi-hint">${l.hint}</div>
      </div>`;
    const b = k.breakEven;
    const stat = (label, value, sub = '') => `<div class="card stat"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="muted small">${sub}</div>` : ''}</div>`;
    return `
      ${k.notes.map(n => `<div class="alert-box">${icon('alert')} ${esc(n)}</div>`).join('')}
      <div class="stats compact">
        ${stat('Revenue', money(k.revenue), '<span>sales after discounts, before tax, with service charge</span>')}
        ${stat('Net profit', money(k.netProfit))}
      </div>
      <div class="stats">
        ${k.lines.map(card).join('')}
        <div class="card stat kpi">
          <div class="label">Net margin</div>
          <div class="value">${f.pct(k.netMargin)}</div>
          <div class="muted small">${money(k.netProfit)} <span>left after every cost</span></div>
          <span class="pill ${k.netStatus}">${VERDICT[k.netStatus]}</span>
          <div class="muted small kpi-hint">Many restaurants keep 5–15%.</div>
        </div>
      </div>
      <p class="muted small">Each percentage is of revenue.</p>

      <h2 class="section-title">Break-even</h2>
      ${b.perDay === null ? '<p class="muted">Break-even cannot be worked out: the ingredients cost more than the sales.</p>' : `
      <div class="stats compact">
        ${stat('Running costs in this period', money(k.running))}
        ${stat('Sales needed per day to break even', money(b.perDay))}
        ${stat('Your sales per day', money(b.actualPerDay))}
        ${b.cushion === null ? '' : b.cushion >= 0
          ? stat('Sales can fall by', f.pct(b.cushion), '<span>before this period loses money</span>')
          : stat('Short of break-even by', f.pct(-b.cushion), '<span>of your sales</span>')}
      </div>
      <p class="muted small">All running costs in the period (rent, salaries, utilities…) are treated as fixed, and the cost of ingredients as varying with sales.</p>`}

      <div class="notes">
        <p class="muted small">Prime cost (food + labour) is the figure restaurant owners watch hardest: it is the biggest part of the money going out, and the part you can steer. The verdicts compare with common ranges for table-service restaurants and cafes; yours may differ. Salaries and wages are taken from expenses with a name like Salaries, Wages or Payroll.</p>
      </div>`;
  }

  function csv(f) {
    const k = Finance.businessKpis(f.bounds(), Store.data, Store.settings);
    return [['Measure', 'Amount', 'Share of revenue', 'Verdict'],
      ['Revenue', k.revenue, '', ''],
      ...k.lines.map(l => [l.label, l.amount, l.ratio === null ? '' : Math.round(l.ratio * 1000) / 10 + '%', VERDICT[l.status]]),
      ['Net profit', k.netProfit, Math.round(k.netMargin * 1000) / 10 + '%', VERDICT[k.netStatus]],
      [], ['Break-even revenue for the period', k.breakEven.revenue ?? ''], ['Break-even per day', k.breakEven.perDay ?? ''], ['Actual per day', k.breakEven.actualPerDay]];
  }

  Screens.finance.tabs.kpis = { label: 'Business health', uses: 'period', html, csv, filename: 'business-health' };
})();
