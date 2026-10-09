'use strict';

// Finance tab: controls - who gave discounts, made refunds and voided bills, with the big ones listed so they can be checked.
(() => {
  const who = id => (Store.user(id) || {}).name || '—';

  // A clickable order number: opens the order's details (see the Orders screen).
  const orderLink = (id, number) => `<button class="link" data-act="order" data-id="${id}">#${number ?? '…'}</button>`;

  function html(f) {
    const c = Finance.controls(f.bounds(), Store.data, Store.settings);
    const stat = (label, value, sub = '') => `<div class="card stat"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="muted small">${sub}</div>` : ''}</div>`;
    return `
      <div class="stats compact">
        ${stat('Discounts given', money(c.discounts.amount), `${c.discounts.count} <span>bills</span> · ${f.pct(c.discounts.percentOfSales)} <span>of sales</span>`)}
        ${stat('Manual discounts', money(c.discounts.manual.amount), `${c.discounts.manual.count} <span>bills</span>`)}
        ${stat('Customer discounts', money(c.discounts.automatic.amount), `${c.discounts.automatic.count} <span>bills</span>`)}
        ${stat('Refunds', money(c.refunds.amount), `${c.refunds.count} <span>bills</span>`)}
        ${stat('Voided bills', money(c.voids.amount), `${c.voids.count} <span>bills</span>${c.voids.afterKitchen ? ` · ${c.voids.afterKitchen} <span>after the kitchen had them</span>` : ''}`)}
      </div>

      <h2 class="section-title">By person</h2>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Person</th><th class="num">Discounts</th><th class="num">Discount value</th><th class="num">Refunds</th><th class="num">Refund value</th><th class="num">Voids</th><th class="num">Void value</th></tr></thead>
          <tbody>${c.staff.map(s => `
            <tr><td>${esc(who(s.userId))}</td><td class="num">${s.discounts}</td><td class="num">${money(s.discountAmount)}</td><td class="num">${s.refunds}</td><td class="num">${money(s.refundAmount)}</td><td class="num">${s.voids}</td><td class="num">${money(s.voidAmount)}</td></tr>`).join('')
            || '<tr><td colspan="7" class="empty">Nothing to check in this period</td></tr>'}
          </tbody>
        </table>
      </div>

      ${section('Big discounts (20% or more of the bill)', ['Bill', 'Date', 'Given by', 'Discount', 'Share'],
        c.bigDiscounts.map(d => [orderLink(d.orderId, d.number), fmtDateTime(d.at), esc(who(d.userId)), money(d.amount), f.pct(d.percent)]))}
      ${section('Largest refunds', ['Bill', 'Refunded on', 'By', 'Amount', 'Sold on'],
        c.refundList.map(d => [orderLink(d.orderId, d.number), fmtDateTime(d.at), esc(who(d.userId)), money(d.amount), fmtDateTime(d.paidAt)]))}
      ${section('Largest voided bills', ['Bill', 'Voided on', 'By', 'Value', 'Kitchen'],
        c.voidList.map(d => [orderLink(d.orderId, d.number), fmtDateTime(d.at), esc(who(d.userId)), money(d.amount), d.sent ? 'Already sent' : 'Not sent']))}`;
  }

  // A small table; the cells are HTML. Skipped when there are no rows.
  function section(title, heads, rows) {
    if (!rows.length) return '';
    return `
      <h2 class="section-title">${title}</h2>
      <div class="table-wrap">
        <table class="data">
          <thead><tr>${heads.map((h, i) => `<th class="${i >= 3 ? 'num' : ''}">${h}</th>`).join('')}</tr></thead>
          <tbody>${rows.map(r => `<tr>${r.map((cell, i) => `<td class="${i >= 3 ? 'num' : ''}">${cell}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  function csv(f) {
    const c = Finance.controls(f.bounds(), Store.data, Store.settings);
    return [['Person', 'Discounts', 'Discount value', 'Refunds', 'Refund value', 'Voids', 'Void value'],
      ...c.staff.map(s => [who(s.userId), s.discounts, s.discountAmount, s.refunds, s.refundAmount, s.voids, s.voidAmount]),
      [], ['Big discounts', 'Date', 'Given by', 'Discount', 'Share'],
      ...c.bigDiscounts.map(d => [`#${d.number}`, isoDate(new Date(d.at)), who(d.userId), d.amount, f.pct(d.percent)])];
  }

  Screens.finance.tabs.controls = {
    label: 'Controls', uses: 'period', html, csv, filename: 'controls',
    // Opens the Orders screen first, so the bill's dialog (refund, receipt…) works as it does there.
    actions: { order: (f, t) => { App.go('orders'); Screens.orders.detail(t.dataset.id); } },
  };
})();
