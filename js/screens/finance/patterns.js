'use strict';

// Finance tab: sales patterns - which days and hours are busy, how the days trend, how tables and servers perform.
(() => {
  const hh = h => `${pad2(h)}:00`;

  // [12, 14, 15, 16] → "12:00, 14:00–17:00" (an hour is shown as its start; a run shows from the first start to the last end)
  function hourRanges(hours) {
    const out = [];
    for (let i = 0; i < hours.length; i++) {
      let j = i;
      while (j + 1 < hours.length && hours[j + 1] === hours[j] + 1) j++;
      out.push(i === j ? hh(hours[i]) : `${hh(hours[i])}–${hh(hours[j] + 1)}`);
      i = j;
    }
    return out.join(', ');
  }

  function model(f) {
    return Finance.salesPatterns(f.bounds(), Store.data, Store.settings, {
      table: o => whereLabel(o),
      server: id => (Store.user(id) || {}).name || 'Unknown',
    });
  }

  // Short findings; each is a fixed label, a value, and a note, so every piece can be translated on its own.
  function insights(f, p) {
    const out = [];
    const row = (label, value, note = '') => `<li><b>${label}</b> <span>${value}</span>${note ? ` <span class="muted">${note}</span>` : ''}</li>`;
    if (p.busiest) out.push(row('Busiest day', p.busiest.name, `${money(p.busiest.avgPerDay)} <span>a day</span>`));
    if (p.quietest && p.quietest.day !== p.busiest.day) out.push(row('Quietest day that traded', p.quietest.name, `${money(p.quietest.avgPerDay)} <span>a day</span>`));
    if (p.peakHour !== null) out.push(row('Busiest hour', `${hh(p.peakHour)}–${hh(p.peakHour + 1)}`, `${money(p.hours[p.peakHour].sales)} <span>in this period</span>`));
    if (p.slowHours.length) out.push(row('Slow hours', hourRanges(p.slowHours), '<span>under a quarter of the busiest hour: fewer staff, or an offer, might pay</span>'));
    if (p.avgSeatMinutes !== null) out.push(row('Guests stay about', `${p.avgSeatMinutes} min`, '<span>from opening the bill to paying it</span>'));
    if (p.channel.takeaway.orders) out.push(row('Takeaway share of sales', f.pct(p.channel.takeawayShare), `${p.channel.takeaway.orders} <span>bills</span>`));
    return out.length ? `<ul class="plain insights">${out.join('')}</ul>` : '';
  }

  function heatmapHTML(p) {
    const active = p.hours.filter(x => x.sales > 0).map(x => x.hour);
    if (!active.length) return '';
    const from = active[0], to = active[active.length - 1];
    const cols = []; for (let h = from; h <= to; h++) cols.push(h);
    return `
      <div class="table-wrap heat-wrap">
        <table class="heat" aria-label="Sales by weekday and hour">
          <thead><tr><th></th>${cols.map(h => `<th>${pad2(h)}</th>`).join('')}</tr></thead>
          <tbody>${p.weekday.map((w, wd) => `
            <tr><th class="day">${w.name.slice(0, 3)}</th>${cols.map(h => {
              const c = p.heatmap[wd][h];
              if (!c.orders) return '<td></td>';
              const i = p.heatMax ? Math.max(0.1, c.sales / p.heatMax) : 0;
              return `<td class="${i > 0.55 ? 'hot' : ''}" style="--i:${i.toFixed(2)}" title="${esc(`${w.name} ${hh(h)}: ${money(c.sales)} · ${c.orders} bill${c.orders === 1 ? '' : 's'}`)}">${c.orders}</td>`;
            }).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p class="muted small">Darker means more sales; the number is how many bills were paid in that hour.</p>`;
  }

  function trendHTML(p) {
    if (p.trend.length > 62) return '<p class="muted small">Choose a period of two months or less to see sales day by day.</p>';
    const every = p.trend.length > 31 ? 5 : p.trend.length > 14 ? 2 : 1;
    return columnChart(p.trend.map(d => ({ label: String(new Date(d.date).getDate()), value: d.sales, text: `${fmtDate(d.date)}: ${money(d.sales)} · ${d.orders}` })), { labelEvery: every });
  }

  const fmtDate = ts => new Date(ts).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });

  function html(f) {
    const p = model(f);
    if (!p.orders) return '<p class="empty">No sales in this period</p>';
    const stat = (label, value, sub = '') => `<div class="card stat"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="muted small">${sub}</div>` : ''}</div>`;
    return `
      <div class="stats compact">
        ${stat('Sales', money(p.sales), 'tax and service included, refunded bills left out')}
        ${stat('Bills', p.orders)}
        ${stat('Average bill', money(p.avgCheck))}
        ${stat('Sales per day', money(p.avgPerDay), `over ${p.trend.length} day${p.trend.length === 1 ? '' : 's'}`)}
      </div>
      ${insights(f, p)}

      <h2 class="section-title">Average sales by day of the week</h2>
      <section class="card">${barList(p.weekday.map(w => ({ label: w.name, value: w.avgPerDay, text: w.orders ? `${money(w.avgPerDay)} <span>a day</span>` : '—' })))}</section>
      <div class="table-wrap">
        <table class="data compact">
          <thead><tr><th>Day</th><th class="num">Days</th><th class="num">Bills</th><th class="num">Sales</th><th class="num">Average bill</th></tr></thead>
          <tbody>${p.weekday.map(w => `<tr><td>${w.name}</td><td class="num">${w.days}</td><td class="num">${w.orders}</td><td class="num">${money(w.sales)}</td><td class="num">${w.orders ? money(w.avgCheck) : '—'}</td></tr>`).join('')}</tbody>
        </table>
      </div>

      <h2 class="section-title">Day and hour</h2>
      ${heatmapHTML(p)}

      <h2 class="section-title">Day by day</h2>
      <section class="card">${trendHTML(p)}</section>

      <h2 class="section-title">Tables</h2>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Table</th><th class="num">Bills</th><th class="num">Sales</th><th class="num">Average bill</th><th class="num">Guests stay</th><th class="num">Sales per hour seated</th></tr></thead>
          <tbody>${p.tables.map(t => `<tr><td>${esc(t.name)}</td><td class="num">${t.orders}</td><td class="num">${money(t.sales)}</td><td class="num">${money(t.avgCheck)}</td><td class="num">${t.avgMinutes === null ? '—' : t.avgMinutes + ' min'}</td><td class="num">${t.salesPerHour === null ? '—' : money(t.salesPerHour)}</td></tr>`).join('')
            || '<tr><td colspan="6" class="empty">No table sales in this period</td></tr>'}</tbody>
        </table>
      </div>
      <p class="muted small">A table with a high sales-per-hour earns more for the time it is occupied. A bill left open for more than 8 hours is not counted as a meal.</p>

      <h2 class="section-title">Servers</h2>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Server</th><th class="num">Bills</th><th class="num">Sales</th><th class="num">Average bill</th><th class="num">Items per bill</th></tr></thead>
          <tbody>${p.servers.map(s => `<tr><td>${esc(s.name)}</td><td class="num">${s.orders}</td><td class="num">${money(s.sales)}</td><td class="num">${money(s.avgCheck)}</td><td class="num">${s.itemsPerBill}</td></tr>`).join('')}</tbody>
        </table>
      </div>
      <p class="muted small">Average bill and items per bill show who sells more per table (suggesting a drink, a side or a dessert), not just who is busiest.</p>`;
  }

  function csv(f) {
    const p = model(f);
    return [
      ['Day', 'Days in period', 'Bills', 'Sales', 'Average per day', 'Average bill'],
      ...p.weekday.map(w => [w.name, w.days, w.orders, w.sales, w.avgPerDay, w.avgCheck]),
      [], ['Hour', 'Sales'], ...p.hours.filter(h => h.sales > 0).map(h => [hh(h.hour), h.sales]),
      [], ['Date', 'Bills', 'Sales'], ...p.trend.map(d => [isoDate(new Date(d.date)), d.orders, d.sales]),
      [], ['Table', 'Bills', 'Sales', 'Average bill', 'Average minutes', 'Sales per hour seated'],
      ...p.tables.map(t => [t.name, t.orders, t.sales, t.avgCheck, t.avgMinutes ?? '', t.salesPerHour ?? '']),
      [], ['Server', 'Bills', 'Sales', 'Average bill', 'Items per bill'],
      ...p.servers.map(s => [s.name, s.orders, s.sales, s.avgCheck, s.itemsPerBill]),
    ];
  }

  Screens.finance.tabs.patterns = { label: 'Sales patterns', uses: 'period', html, csv, filename: 'sales-patterns' };
})();
