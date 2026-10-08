'use strict';

const $ = (sel, root = document) => root.querySelector(sel);

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Amounts follow the Settings: symbol before or after the number, 2 or 0 decimals, thousands separated by commas.
function money(n) {
  const s = Store.settings;
  const dec = decimalsOf(s);
  const v = roundTo(n, dec);
  const body = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return (v < 0 ? '-' : '') + (s.currencyAfter ? `${body} ${s.currency}` : s.currency + body);
}

// Rounds an amount the way the bill does, and gives the matching <input step>.
function rmoney(n) { return roundTo(n, decimalsOf(Store.settings)); }

// Costs per gram or per millilitre are tiny (0.0012), so they are shown with up to 4 decimals instead of the bill's 2.
function costMoney(n) {
  const s = Store.settings;
  const v = Number(n) || 0;
  const body = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: v !== 0 && Math.abs(v) < 1 ? 0 : decimalsOf(s), maximumFractionDigits: 4 });
  return (v < 0 ? '-' : '') + (s.currencyAfter ? `${body} ${s.currency}` : s.currency + body);
}

// Amounts of an ingredient (grams, litres…) and loyalty points: whole numbers where possible, at most 2 decimals.
function qtyText(n) {
  return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
}
function moneyStep() { return decimalsOf(Store.settings) === 0 ? '1' : '0.01'; }

function pad2(n) { return String(n).padStart(2, '0'); }
function isoDate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function fmtTime(ts) { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function fmtDateTime(ts) { return new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }

function timeAgo(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

function initials(name) {
  return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
}

// In server mode a new order gets its number once the server has seen it.
function orderNo(order) {
  return order && order.number != null ? order.number : (order && order.orderNo != null ? order.orderNo : '…');
}

function whereLabel(order) {
  if (!order.tableId) return order.splitFrom ? `${order.tableName || 'Table'} (split)` : 'Takeaway';
  const t = Store.table(order.tableId);
  return t ? t.name : (order.tableName || 'Table');
}

function formValues(el) {
  const out = {};
  el.querySelectorAll('[name]').forEach(f => { out[f.name] = f.type === 'checkbox' ? f.checked : f.value.trim(); });
  return out;
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3000);
}

function downloadFile(name, content, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// One modal at a time. Buttons use data-act="name", handled by actions[name].
// Special handlers: __input, __change (form events), __enter (Enter key).
const Modal = {
  handlers: {},
  onClose: null,

  init() {
    const root = $('#modal-root');
    let downOnBackdrop = false;
    root.addEventListener('mousedown', e => { downOnBackdrop = e.target.classList.contains('modal-backdrop'); });
    root.addEventListener('click', e => {
      if (e.target.classList.contains('modal-backdrop')) {
        if (downOnBackdrop) this.close();
        return;
      }
      const t = e.target.closest('[data-act]');
      if (!t || t.disabled) return;
      if (t.dataset.act === '__close') return this.close();
      const fn = this.handlers[t.dataset.act];
      if (fn) fn(t, e);
    });
    root.addEventListener('input', e => this.handlers.__input && this.handlers.__input(e));
    root.addEventListener('change', e => this.handlers.__change && this.handlers.__change(e));
  },

  // Opening a modal replaces the current one without running its onClose.
  // A `locked` modal cannot be dismissed (Esc, backdrop, ✕) – only by its own actions calling close(true).
  open({ title, body, footer = '', wide = false, actions = {}, onClose = null, locked = false }) {
    const root = $('#modal-root');
    this.locked = locked;
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
          <header class="modal-head"><h2>${esc(title)}</h2>${locked ? '' : '<button class="icon-btn" data-act="__close" aria-label="Close">✕</button>'}</header>
          <div class="modal-body">${body}</div>
          ${footer ? `<footer class="modal-foot">${footer}</footer>` : ''}
        </div>
      </div>`;
    this.handlers = actions;
    this.onClose = onClose;
    root.hidden = false;
    const focus = root.querySelector('[autofocus]');
    if (focus) focus.focus();
    return this.el();
  },

  close(force = false) {
    const root = $('#modal-root');
    if (root.hidden || (this.locked && !force)) return;
    this.locked = false;
    const cb = this.onClose;
    this.onClose = null;
    this.handlers = {};
    root.innerHTML = '';
    root.hidden = true;
    if (cb) cb();
  },

  get isOpen() { return !$('#modal-root').hidden; },
  el() { return $('#modal-root .modal'); },

  onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    else if (e.key === 'Enter' && this.handlers.__enter && !e.target.matches('textarea, button')) {
      e.preventDefault();
      this.handlers.__enter();
    }
  },
};

function confirmDialog({ title, message = '', okLabel = 'Confirm', danger = false, onOk }) {
  Modal.open({
    title,
    body: `<p>${esc(message)}</p>`,
    footer: `<button class="btn" data-act="__close">Cancel</button><button class="btn ${danger ? 'danger solid' : 'primary'}" data-act="ok">${esc(okLabel)}</button>`,
    actions: { ok: () => { Modal.close(); onOk(); } },
  });
}

// Asks for any staff PIN; `allow(user)` can restrict who may approve.
function pinPrompt({ title = 'Staff PIN', message = '', allow = () => true, onOk, onCancel }) {
  let done = false;
  let busy = false;
  const actions = {
    ok: async () => {
      const modal = Modal.el();
      const input = modal && modal.querySelector('.pin-input');
      if (!input || busy) return;
      busy = true;
      let user;
      try {
        user = await Store.verifyPin(input.value);
      } catch (e) {
        busy = false;
        toast(e.message || 'Wrong PIN', 'error');
        input.value = '';
        input.focus();
        return;
      }
      busy = false;
      if (Modal.el() !== modal) return; // closed while the server was checking
      if (!allow(user)) { toast(`${user.name} is not allowed to approve this`, 'error'); input.value = ''; return; }
      done = true;
      Modal.close();
      onOk(user);
    },
  };
  actions.__enter = actions.ok;
  Modal.open({
    title,
    body: `${message ? `<p class="muted">${esc(message)}</p>` : ''}
      <input class="input pin-input" type="password" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="PIN" autofocus>`,
    footer: `<button class="btn" data-act="__close">Cancel</button><button class="btn primary" data-act="ok">Confirm</button>`,
    actions,
    onClose: () => { if (!done && onCancel) onCancel(); },
  });
}

// A staff member still using a demo PIN must choose their own before doing anything else.
function forcePinChange(onDone) {
  let busy = false;
  const actions = {
    save: async () => {
      if (busy) return;
      const m = Modal.el();
      const pin = m.querySelector('[name=pin]').value.trim();
      const again = m.querySelector('[name=again]').value.trim();
      if (!/^\d{4,6}$/.test(pin)) return toast('PIN must be 4–6 digits', 'error');
      if (pin !== again) return toast('The two PINs do not match', 'error');
      busy = true;
      try {
        await Store.changeOwnPin(pin);
        Modal.close(true);
        toast('PIN changed', 'ok');
        if (onDone) onDone();
      } catch (e) {
        toast(e.message, 'error');
      }
      busy = false;
    },
    logout: () => { Modal.close(true); App.logout(); },
  };
  actions.__enter = actions.save;
  Modal.open({
    title: 'Choose your own PIN',
    locked: true,
    body: `
      <p class="muted">You are signed in with a PIN that came with the demo data, which anyone could guess. Choose a new 4–6 digit PIN that only you know.</p>
      <label class="field"><span>New PIN</span><input class="input pin-input" name="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" autofocus></label>
      <label class="field"><span>Repeat new PIN</span><input class="input pin-input" name="again" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></label>`,
    footer: '<button class="btn" data-act="logout">Sign out</button><button class="btn primary" data-act="save">Save PIN</button>',
    actions,
  });
}

function requireManager(reason, onOk, onCancel) {
  if (App.can('manage')) return onOk(App.user);
  pinPrompt({ title: 'Manager approval', message: reason, allow: u => App.can('manage', u), onOk, onCancel });
}

function totalsHTML(t) {
  return `
    <div class="row"><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
    ${t.discount ? `<div class="row disc"><span>Discount</span><span>−${money(t.discount)}</span></div>` : ''}
    ${t.points ? `<div class="row disc"><span>Points used</span><span>−${money(t.points)}</span></div>` : ''}
    ${t.service ? `<div class="row"><span>Service ${t.serviceRate}%</span><span>${money(t.service)}</span></div>` : ''}
    <div class="row"><span>Tax ${t.taxRate}%</span><span>${money(t.tax)}</span></div>
    <div class="row grand"><span>Total</span><span>${money(t.total)}</span></div>`;
}

const PAY_METHODS = { cash: 'Cash', card: 'Card', other: 'Other', split: 'Split' };

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
      ${customer ? `<div>Customer: ${esc(customer.name)}</div>` : ''}
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

// Prints at the counter's printer station when one is online; otherwise on this device.
function printHTML(html, kind = 'receipt') {
  if (Store.server && Sync.token && !Station.active && Sync.stations > 0) {
    Store.data.printJobs.push({ id: uid('j_'), html, kind, status: 'pending', createdAt: Date.now(), by: App.user ? App.user.id : null });
    Store.save();
    toast('🖨️ Sent to the counter printer', 'ok');
    return;
  }
  printLocal(html, kind === 'sheet');
}

// Print jobs come from other devices, so strip anything that could run code before showing them on this one.
function cleanPrintHTML(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html);
  tpl.content.querySelectorAll('script, iframe, object, embed, link, meta, base, form').forEach(el => el.remove());
  tpl.content.querySelectorAll('*').forEach(el => {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name) || /^\s*(javascript|data):/i.test(a.value) && /^(href|src|xlink:href|action)$/i.test(a.name)) el.removeAttribute(a.name);
    }
  });
  return tpl.innerHTML;
}

// A page that shows whether the printer prints at the right width, cuts cleanly and can print Myanmar text.
function testPageHTML() {
  const ruler = n => '1234567890'.repeat(Math.ceil(n / 10)).slice(0, n);
  return `
    <div class="receipt">
      <div class="c b big">${esc(Store.settings.name)}</div>
      <div class="c b r-title">PRINTER TEST</div>
      <div>${fmtDateTime(Date.now())}</div>
      <hr>
      <div>Width check: every line below should be fully visible, not cut off at the right edge.</div>
      <div style="white-space:nowrap;overflow:hidden">${ruler(48)}</div>
      <div style="white-space:nowrap;overflow:hidden">${ruler(42)}</div>
      <div style="white-space:nowrap;overflow:hidden">${ruler(32)}</div>
      <hr>
      <table>
        <tr><td>2 x Chicken Burger with extra long name that wraps</td><td class="r">${money(25.8)}</td></tr>
        <tr><td>1 x Latte</td><td class="r">${money(4)}</td></tr>
        <tr class="b big"><td>TOTAL</td><td class="r">${money(29.8)}</td></tr>
      </table>
      <hr>
      <div>မြန်မာစာ စမ်းသပ်ခြင်း — ကော်ဖီ၊ လက်ဖက်ရည်၊ ထမင်းကြော်</div>
      <div>Letters: ÀÉÎÕÜ àéîõü ñ ç · Symbols: ${esc(Store.settings.currency)} # % &amp; @ ✓</div>
      <hr>
      <div class="c b">If the Myanmar line shows boxes or gaps, install a Myanmar font on this PC (e.g. "Myanmar Text" or "Noto Sans Myanmar").</div>
      <div class="c">Paper should cut after this line.</div>
      <div>&nbsp;</div><div>&nbsp;</div>
    </div>`;
}

// `sheet` uses the full page width (QR code sheets) instead of the 80 mm receipt width.
function printLocal(html, sheet = false) {
  const area = $('#print-area');
  area.className = sheet ? 'sheet' : '';
  area.innerHTML = html;
  window.print();
}

let audioCtx = null;
function beep(times = 1) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < times; i++) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const t = audioCtx.currentTime + i * 0.25;
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    }
  } catch (e) { /* sound is optional */ }
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

function barList(rows) {
  if (!rows.length) return '<p class="empty small">No sales in this period</p>';
  const max = Math.max(...rows.map(r => r.value)) || 1;
  return rows.map(r => `
    <div class="bar-row">
      <span class="bar-label" title="${esc(r.label)}">${esc(r.label)}</span>
      <div class="bar"><span style="width:${(r.value / max * 100).toFixed(1)}%"></span></div>
      <span class="bar-val">${r.text}</span>
    </div>`).join('');
}
