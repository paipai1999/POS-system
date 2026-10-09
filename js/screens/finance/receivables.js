'use strict';

// Finance tab: receivables - what customers owe for bills put on account, how old each debt is, and receiving payments.
(() => {
  const AGE_LABELS = { current: '0-30 days', d31: '31-60 days', d61: '61-90 days', d90: 'Over 90 days' };

  const model = () => Finance.receivables(Store.data, Store.settings, Date.now(), Sync.historySince());

  function html() {
    const { rows, totals, buckets } = model();
    const stat = (label, value, sub = '') => `<div class="card stat"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="muted small">${sub}</div>` : ''}</div>`;
    const overdue = totals.d61 + totals.d90;
    return `
      <div class="stats compact">
        ${stat('Owed by customers', money(totals.owing), `${rows.length} <span>customers</span>`)}
        ${stat('Over 60 days', money(overdue), overdue ? 'Time to remind them' : '', overdue ? 'late' : '')}
      </div>
      <div class="table-wrap">
        <table class="data statement">
          <thead><tr><th>Customer</th><th class="num">Owes</th>${buckets.map(b => `<th class="num">${AGE_LABELS[b.id]}</th>`).join('')}<th>Oldest bill</th><th></th></tr></thead>
          <tbody>${rows.map(r => `
            <tr>
              <td>${esc(r.name)}${r.limit > 0 ? `<div class="muted small"><span>Limit</span> ${money(r.limit)}</div>` : ''}</td>
              <td class="num"><b>${money(r.owing)}</b></td>
              ${buckets.map(b => `<td class="num ${b.id === 'd90' && r.buckets[b.id] ? 'down' : ''}">${r.buckets[b.id] ? money(r.buckets[b.id]) : '—'}</td>`).join('')}
              <td>${r.oldest ? esc(Screens.finance.dayText(r.oldest)) : '—'}</td>
              <td><div class="row-actions">
                <button class="btn small" data-act="statement" data-id="${r.customerId}">Statement</button>
                ${r.owing > 0 ? `<button class="btn small primary" data-act="receive" data-id="${r.customerId}">Receive payment</button>` : ''}
              </div></td>
            </tr>`).join('') || '<tr><td colspan="8" class="empty">No customer owes anything</td></tr>'}
            ${rows.length ? `<tr class="st-total"><td>Total</td><td class="num">${money(totals.owing)}</td>${buckets.map(b => `<td class="num">${money(totals[b.id])}</td>`).join('')}<td></td><td></td></tr>` : ''}
          </tbody>
        </table>
      </div>
      <div class="notes">
        <p class="muted small">A bill is put on account at checkout for a customer who has a credit limit (set in Customers by a manager). Payments settle the oldest bills first. Debts that will not be paid can be written off; they count as an expense.</p>
      </div>`;
  }

  function csv() {
    const { rows, buckets } = model();
    return [['Customer', 'Owes', 'Credit limit', ...buckets.map(b => AGE_LABELS[b.id]), 'Oldest bill'],
      ...rows.map(r => [r.name, r.owing, r.limit, ...buckets.map(b => r.buckets[b.id]), r.oldest ? isoDate(new Date(r.oldest)) : ''])];
  }

  Screens.finance.tabs.receivables = {
    label: 'Receivables', uses: 'now', html, csv, filename: 'receivables',
    // Bills on account can be months old: look back over the last 400 days (older amounts show as "earlier").
    needFrom: () => Date.now() - 400 * 86400000,
    actions: {
      statement: (f, t) => Screens.customers.statement(t.dataset.id),
      receive: (f, t) => Screens.customers.receivePayment(t.dataset.id, () => f.render(f.root)),
    },
  };
})();
