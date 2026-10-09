'use strict';

// Bills on paper and on screen: totals, the receipt, the kitchen ticket and showing a receipt in a dialog.

function totalsHTML(t) {
  return `
    <div class="row"><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
    ${t.discount ? `<div class="row disc"><span>Discount</span><span>−${money(t.discount)}</span></div>` : ''}
    ${t.points ? `<div class="row disc"><span>Points used</span><span>−${money(t.points)}</span></div>` : ''}
    ${t.service ? `<div class="row"><span>Service ${t.serviceRate}%</span><span>${money(t.service)}</span></div>` : ''}
    <div class="row"><span>Tax ${t.taxRate}%</span><span>${money(t.tax)}</span></div>
    <div class="row grand"><span>Total</span><span>${money(t.total)}</span></div>`;
}

const PAY_METHODS = { cash: 'Cash', card: 'Card', other: 'Other', credit: 'On account', split: 'Split' };

// The options picked on a line, e.g. "+ Extra shot, Large".
function modsText(l) {
  return l.mods && l.mods.length ? '+ ' + l.mods.map(m => m.name).join(', ') : '';
}

// Receipt lines for how the bill was paid (tip, each method of a split, change).
function paymentRowsHTML(payment, row) {
  if (!payment) return '';
  const out = [];
  if (payment.tip) {
    out.push(row('Tip', money(payment.tip)));
    out.push(row('To pay', money(payment.amount + payment.tip), 'b'));
  }
  if (payment.method === 'split' && payment.parts) {
    for (const p of payment.parts) out.push(row(PAY_METHODS[p.method] || p.method, money(p.tendered ?? p.amount)));
    const change = payment.parts.reduce((n, p) => n + (p.change || 0), 0);
    if (change) out.push(row('Change', money(change)));
  } else {
    out.push(row(PAY_METHODS[payment.method] || payment.method, money(payment.tendered ?? (payment.amount + (payment.tip || 0)))));
    if (payment.change) out.push(row('Change', money(payment.change)));
  }
  return out.join('');
}

function receiptHTML(order) {
  const s = Store.settings;
  const t = Store.totals(order);
  const staff = Store.user(order.staffId);
  const cashier = order.cashierId && Store.user(order.cashierId);
  const customer = order.customerId && Store.customer(order.customerId);
  const row = (label, val, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="r">${val}</td></tr>`;
  const title = order.status === 'open' ? 'BILL' : 'RECEIPT';
  return `
    <div class="receipt">
      <div class="c b big">${esc(s.name)}</div>
      ${s.address ? `<div class="c">${esc(s.address)}</div>` : ''}
      ${s.phone ? `<div class="c">${esc(s.phone)}</div>` : ''}
      <div class="c b r-title">${title}</div>
      <div>Order #${orderNo(order)} · ${esc(whereLabel(order))}</div>
      <div>${fmtDateTime(order.paidAt || Date.now())}</div>
      <div>Server: ${esc(staff ? staff.name : '-')}${cashier ? ` · Cashier: ${esc(cashier.name)}` : ''}</div>
      ${customer ? `<div>Customer: ${esc(customer.name)}${order.loyalty && order.loyalty.tier ? ` (${esc(order.loyalty.tier)})` : ''}</div>` : ''}
      <hr>
      <table>
        ${order.items.map(l => `<tr><td>${l.qty} x ${esc(l.name)}${modsText(l) ? `<div class="r-note">${esc(modsText(l))}</div>` : ''}${l.note ? `<div class="r-note">${esc(l.note)}</div>` : ''}</td><td class="r">${money(l.price * l.qty)}</td></tr>`).join('')}
      </table>
      <hr>
      <table>
        ${row('Subtotal', money(t.subtotal))}
        ${t.discount ? row('Discount', '-' + money(t.discount)) : ''}
        ${t.points ? row('Points used', '-' + money(t.points)) : ''}
        ${t.service ? row(`Service ${t.serviceRate}%`, money(t.service)) : ''}
        ${row(`Tax ${t.taxRate}%`, money(t.tax))}
        ${row('TOTAL', money(t.total), 'b big')}
        ${paymentRowsHTML(order.payment, row)}
        ${order.loyalty && order.loyalty.earned ? row('Points earned', qtyText(order.loyalty.earned)) : ''}
        ${order.loyalty ? row('Points balance', qtyText(order.loyalty.balance)) : ''}
      </table>
      ${order.status === 'refunded' ? '<div class="c b r-title">*** REFUNDED ***</div>' : ''}
      <hr>
      <div class="c">${esc(s.receiptFooter)}</div>
    </div>`;
}

function kitchenTicketHTML(order, lines) {
  const staff = Store.user(order.staffId);
  return `
    <div class="receipt kitchen">
      <div class="c b big">KITCHEN</div>
      <div class="b big">${esc(whereLabel(order))} · #${orderNo(order)}</div>
      <div>${fmtTime(Date.now())} · ${esc(staff ? staff.name : '')}</div>
      <hr>
      ${lines.map(l => `<div class="k-line"><b>${l.qty} x ${esc(l.name)}</b>${l.mods && l.mods.length ? `<div class="r-note">${esc('+ ' + l.mods.join(', '))}</div>` : ''}${l.note ? `<div class="r-note">» ${esc(l.note)}</div>` : ''}</div>`).join('')}
      ${order.note ? `<hr><div class="r-note">NOTE: ${esc(order.note)}</div>` : ''}
    </div>`;
}

function showReceipt(orderId, { title = 'Receipt', onClose = null } = {}) {
  const order = Store.order(orderId);
  if (!order) return;
  const change = order.payment && order.payment.change;
  Modal.open({
    title,
    body: `${change ? `<div class="change">Change due <span>${money(change)}</span></div>` : ''}<div data-role="receipt" data-order="${esc(orderId)}">${receiptHTML(order)}</div>`,
    footer: `<button class="btn" data-act="__close">Done</button><button class="btn primary" data-act="print">🖨️ Print</button>`,
    // Printed from the current copy of the bill, which in server mode gains the points earned a moment after payment.
    actions: { print: () => { const o = Store.order(orderId); if (o) printHTML(receiptHTML(o)); } },
    onClose,
  });
}

// In server mode the server finishes the bill after payment (points earned, balance); show that on the open receipt.
function refreshReceipt(orderId) {
  const el = Modal.isOpen && Modal.el() && Modal.el().querySelector(`[data-role=receipt][data-order="${orderId}"]`);
  const order = Store.order(orderId);
  if (el && order) el.innerHTML = receiptHTML(order);
}
