'use strict';

// Finance tab: financial position - what the business holds and what it owes right now.
(() => {
  function model() {
    const p = Finance.position(Date.now(), Store.data, Store.settings);
    const rows = [
      { label: 'Cash on hand (till and safe)', value: p.cash, kind: 'line' },
      { label: 'Bank and mobile wallets', value: p.bank, kind: 'line' },
      { label: 'Ingredients on the shelf', value: p.stock, kind: 'line' },
      ...(p.receivable ? [{ label: 'Owed by customers', value: p.receivable, kind: 'line' }] : []),
      { label: 'Total assets', value: p.assets, kind: 'total' },
      { label: 'Owed to suppliers', value: -p.owed, kind: 'line' },
      ...(p.customerCredit ? [{ label: 'Customers in credit', value: -p.customerCredit, kind: 'line' }] : []),
      { label: 'Net position', value: p.net, kind: 'grand' },
    ];
    return { rows, p };
  }

  function html() {
    const { rows, p } = model();
    return `
      ${p.configured ? '' : `
        <p class="alert-box">⚠️ <span>The opening balances are not set. Without them the cash and bank figures only show the money that moved since the first record. Enter them in Settings → Finance setup.</span></p>`}
      <div class="table-wrap">
        <table class="data statement">
          <thead><tr><th>${p.configured ? `<span>Balances from</span> ${esc(Screens.finance.dayText(p.startDate))}` : 'Since the first record'}</th><th class="num">Now</th></tr></thead>
          <tbody>${rows.map(r => `<tr class="st-${r.kind}"><td>${esc(r.label)}</td><td class="num">${money(r.value)}</td></tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="notes">
        <p class="muted small">Cash and bank start from the opening balances and add every movement since then (sales, refunds, purchases, supplier payments, expenses and the owner's money). Ingredients are valued at their average cost. Tips held for staff and money other people owe the restaurant are not included.</p>
      </div>`;
  }

  function csv() {
    const { rows } = model();
    return [['', 'Now'], ...rows.map(r => [r.label, r.value])];
  }

  Screens.finance.tabs.position = { label: 'Financial position', uses: 'now', html, csv, filename: 'financial-position' };
})();
