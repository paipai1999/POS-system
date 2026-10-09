'use strict';

// Finance tab: cash flow - the money that actually moved, by cash / card / other (bank transfer, mobile wallet…).
(() => {
  const CHANNELS = [['cash', 'Cash'], ['card', 'Card'], ['other', 'Bank / wallet']];

  // Rows: { label, values: { cash, card, other, total }, kind }
  function model(f) {
    const cf = Finance.cashFlow(f.bounds(), Store.data, Store.settings);
    const rows = [];
    const add = (label, source, kind = 'line', sign = 1) => {
      const v = { ...source };
      for (const k of Object.keys(v)) v[k] *= sign;
      rows.push({ label, values: { ...v, total: CHANNELS.reduce((n, [c]) => n + v[c], 0) }, kind });
    };
    rows.push({ label: 'Money in', kind: 'heading' });
    add('Customers paid (tips included)', cf.receipts, 'sub');
    add('Customers paying their accounts', cf.customerIn, 'sub');
    add('Put in by the owner', cf.ownerIn, 'sub');
    add('Total money in', cf.inflow, 'total');
    rows.push({ label: 'Money out', kind: 'heading' });
    add('Refunds to customers', cf.refundsOut, 'sub', -1);
    add('Purchases paid at the time', cf.boughtOut, 'sub', -1);
    add('Paid to suppliers later', cf.suppliersOut, 'sub', -1);
    add('Expenses', cf.expensesOut, 'sub', -1);
    add('Taken out by the owner', cf.ownerOut, 'sub', -1);
    add('Total money out', cf.outflow, 'total', -1);
    add('Net movement', cf.net, 'grand');
    return { rows, cf };
  }

  function html(f) {
    const { rows, cf } = model(f);
    const head = CHANNELS.map(([, label]) => `<th class="num">${label}</th>`).join('') + '<th class="num">Total</th>';
    const body = rows.map(r => r.kind === 'heading'
      ? `<tr class="st-heading"><td colspan="5">${r.label}</td></tr>`
      : `<tr class="st-${r.kind}"><td>${esc(r.label)}</td>${CHANNELS.map(([c]) => `<td class="num">${money(r.values[c])}</td>`).join('')}<td class="num"><b>${money(r.values.total)}</b></td></tr>`).join('');
    return `
      <div class="table-wrap">
        <table class="data statement">
          <thead><tr><th>${esc(f.periodLabel())}</th>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      <div class="notes">
        ${cf.tips ? `<p class="small"><span>Tips among the money in</span> <b>${money(cf.tips)}</b> <span>(they belong to staff; record paying them out as an expense in the category "Tips paid to staff")</span></p>` : ''}
        <p class="muted small">This is money, not profit: a purchase counts when it is paid, and sales on credit do not exist here. Card and bank/wallet money reaches the bank account; "Cash" is what goes through the till and the safe.</p>
      </div>`;
  }

  function csv(f) {
    const { rows } = model(f);
    return [['', ...CHANNELS.map(([, l]) => l), 'Total'],
      ...rows.filter(r => r.kind !== 'heading').map(r => [r.label, ...CHANNELS.map(([c]) => r.values[c]), r.values.total])];
  }

  Screens.finance.tabs.cash = { label: 'Cash flow', uses: 'period', html, csv, filename: 'cash-flow' };
})();
