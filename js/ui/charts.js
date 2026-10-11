'use strict';

// Simple bar charts for the reports.

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

// ----- dashboard charts: small, dependency-free, drawn with HTML/CSS and inline SVG that follow the theme colours -----

// A line over `values` (0..n), drawn to fill its box. Used as a sparkline inside a KPI card.
function sparkline(values, label = '') {
  if (!values.length || Math.max(...values) <= 0) return '';
  const max = Math.max(...values), n = values.length;
  const pts = values.map((v, i) => `${(n === 1 ? 50 : i / (n - 1) * 100).toFixed(1)},${(30 - v / max * 28).toFixed(1)}`);
  return `<svg class="spark" viewBox="0 0 100 32" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">
    <polygon class="spark-fill" points="0,32 ${pts.join(' ')} 100,32"/>
    <polyline class="spark-line" points="${pts.join(' ')}"/></svg>`;
}

// Vertical columns. rows: [{ label, value, text, hot? }]; `hot` marks the current hour or day. Hover or long-press shows `text`.
function columnChart(rows, { labelEvery = 1 } = {}) {
  const max = Math.max(0, ...rows.map(r => r.value));
  if (max <= 0) return '<p class="empty small">No sales yet</p>';
  return `<div class="cols" role="img" aria-label="${esc(rows.map(r => `${r.label} ${r.text}`).join(', '))}">
    ${rows.map((r, i) => `
      <div class="col ${r.hot ? 'hot' : ''} ${r.value <= 0 ? 'zero' : ''}" title="${esc(r.label)}: ${esc(r.text)}">
        <span class="col-bar" style="height:${(r.value / max * 100).toFixed(1)}%"></span>
        <span class="col-label">${i % labelEvery === 0 ? esc(r.label) : ''}</span>
      </div>`).join('')}
  </div>`;
}

// A ring split into slices. rows: [{ label, value, text }]. The legend beside it carries the numbers.
function donut(rows) {
  const total = rows.reduce((n, r) => n + r.value, 0);
  if (total <= 0) return '<p class="empty small">No sales yet</p>';
  const R = 15.9155; // circumference 100, so a slice's length is its percentage
  let offset = 0;
  const arcs = rows.map((r, i) => {
    const pct = r.value / total * 100;
    const arc = `<circle class="slice c${i % 6}" r="${R}" cx="21" cy="21" stroke-dasharray="${pct.toFixed(2)} ${(100 - pct).toFixed(2)}" stroke-dashoffset="${(25 - offset).toFixed(2)}"><title>${esc(r.label)}: ${esc(r.text)}</title></circle>`;
    offset += pct;
    return arc;
  }).join('');
  return `<div class="donut-wrap">
    <svg class="donut" viewBox="0 0 42 42" role="img" aria-label="${esc(rows.map(r => `${r.label} ${Math.round(r.value / total * 100)}%`).join(', '))}">
      <circle class="ring" r="${R}" cx="21" cy="21"/>${arcs}</svg>
    <ul class="donut-legend">${rows.map((r, i) => `
      <li><i class="sw c${i % 6}"></i><span class="dl-name">${esc(r.label)}</span><b>${Math.round(r.value / total * 100)}%</b></li>`).join('')}
    </ul></div>`;
}

// "+12%" / "−5%" with a class for colouring; `null` when there is nothing to compare with.
function deltaBadge(fraction, { goodWhenUp = true } = {}) {
  if (fraction === null || !isFinite(fraction)) return '<span class="delta flat">–</span>';
  const pct = Math.round(Math.abs(fraction) * 100);
  if (pct === 0) return '<span class="delta flat">0%</span>';
  const up = fraction > 0;
  const good = up === goodWhenUp;
  return `<span class="delta ${good ? 'good' : 'bad'}"><span aria-hidden="true">${up ? '▲' : '▼'}</span> ${pct}%</span>`;
}
