'use strict';

// Finance tab: tax - what was charged on sales, what suppliers charged, and the difference owed to the tax office.
(() => {
  function model(f) {
    const t = Finance.taxReport(f.bounds(), Store.data, Store.settings);
    return { t };
  }

  function html(f) {
    const { t } = model(f);
    const owed = t.payable >= 0;
    return `
      <div class="table-wrap">
        <table class="data statement">
          <thead><tr><th>${esc(f.periodLabel())}</th><th class="num">Sales</th><th class="num">Tax</th></tr></thead>
          <tbody>
            ${t.byRate.map(r => `<tr class="st-sub"><td><span>Tax charged on sales</span> ${r.rate}%</td><td class="num">${money(r.sales)}</td><td class="num">${money(r.tax)}</td></tr>`).join('')
              || '<tr class="st-note"><td colspan="3" class="muted">No sales in this period</td></tr>'}
            <tr class="st-total"><td>Tax collected (less refunds)</td><td></td><td class="num">${money(t.outputTax)}</td></tr>
            <tr class="st-sub"><td>Tax paid on purchases</td><td></td><td class="num">${money(-t.inputPurchases)}</td></tr>
            <tr class="st-sub"><td>Tax paid on expenses</td><td></td><td class="num">${money(-t.inputExpenses)}</td></tr>
            <tr class="st-grand"><td>${owed ? 'Tax to pay' : 'Tax to claim back'}</td><td></td><td class="num">${money(Math.abs(t.payable))}</td></tr>
          </tbody>
        </table>
      </div>
      <div class="notes">
        <p class="small"><span>Service charge collected</span> <b>${money(t.serviceCharge)}</b></p>
        <p class="muted small">Tax paid on purchases and expenses only appears when it was entered with them ("Tax included in the price"). Check with your accountant whether you may offset it.</p>
      </div>`;
  }

  function csv(f) {
    const { t } = model(f);
    return [['', 'Sales', 'Tax'],
      ...t.byRate.map(r => [`Tax charged on sales ${r.rate}%`, r.sales, r.tax]),
      ['Tax collected (less refunds)', '', t.outputTax], ['Tax paid on purchases', '', -t.inputPurchases], ['Tax paid on expenses', '', -t.inputExpenses],
      [t.payable >= 0 ? 'Tax to pay' : 'Tax to claim back', '', Math.abs(t.payable)], ['Service charge collected', '', t.serviceCharge]];
  }

  Screens.finance.tabs.tax = { label: 'Tax', uses: 'period', html, csv, filename: 'tax' };
})();
