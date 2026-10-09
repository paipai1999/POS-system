'use strict';

// How numbers, money, dates and order labels are shown.

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
// Why a customer gets an automatic discount, for the checkout line and the customer list.
function discountReason(cd) {
  return cd.reason === 'level' ? `${cd.tier} level` : cd.reason === 'visit' ? 'visit reward' : cd.reason === 'card' ? 'customer discount' : '';
}

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
