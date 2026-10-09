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
