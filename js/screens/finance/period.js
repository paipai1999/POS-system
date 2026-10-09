'use strict';

// Finance: the period the statements are about, and the earlier period they are compared with.
Object.assign(Screens.finance, {
  RANGES: [['today', 'Today'], ['yesterday', 'Yesterday'], ['week', '7 days'], ['month', 'This month'], ['lastmonth', 'Last month'], ['year', 'This year'], ['custom', 'Custom']],

  // The chosen period as [start, end) in milliseconds (the end is the start of the day after the last day).
  bounds() {
    const st = this.state;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const day = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
    const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
    let a, b;
    switch (st.range) {
      case 'yesterday': a = day(today, -1); b = today; break;
      case 'week': a = day(today, -6); b = day(today, 1); break;
      case 'month': a = new Date(today.getFullYear(), today.getMonth(), 1); b = day(today, 1); break;
      case 'lastmonth': a = new Date(today.getFullYear(), today.getMonth() - 1, 1); b = new Date(today.getFullYear(), today.getMonth(), 1); break;
      case 'year': a = new Date(today.getFullYear(), 0, 1); b = day(today, 1); break;
      case 'custom': {
        const f = st.from ? parse(st.from) : today, t = st.to ? parse(st.to) : today;
        [a, b] = f <= t ? [f, day(t, 1)] : [t, day(f, 1)];
        break;
      }
      default: a = today; b = day(today, 1);
    }
    return [a.getTime(), b.getTime()];
  },

  // The period to compare with: the same stretch of the month or year before for "this month" / "this year" (so 8 days into
  // October are compared with the first 8 days of September), otherwise the stretch of equal length just before.
  previous() {
    const [a, b] = this.bounds();
    const start = new Date(a);
    const days = Math.round((b - a) / 86400000);
    const shifted = d => new Date(start.getFullYear() - (this.state.range === 'year' ? 1 : 0), start.getMonth() - (this.state.range === 'month' ? 1 : 0), d);
    if (this.state.range === 'month' || this.state.range === 'year') {
      const pa = shifted(1);
      const pb = new Date(pa); pb.setDate(pb.getDate() + days);
      return [pa.getTime(), Math.min(pb.getTime(), a)];
    }
    return Finance.previousRange([a, b]);
  },

  dayText: ts => new Date(ts).toLocaleDateString([], { dateStyle: 'medium' }),

  // "1 Oct 2026 – 8 Oct 2026", or one date when the period is a single day.
  periodLabel(range = this.bounds()) {
    const first = range[0], last = range[1] - 1;
    return Finance.dayKey(first) === Finance.dayKey(last) ? this.dayText(first) : `${this.dayText(first)} – ${this.dayText(last)}`;
  },

  periodToolbarHTML() {
    const st = this.state;
    return `
      <div class="toolbar">
        <div class="seg">
          ${this.RANGES.map(([k, label]) => `<button data-act="range" data-range="${k}" class="${st.range === k ? 'active' : ''}">${label}</button>`).join('')}
        </div>
        ${st.range === 'custom' ? `
          <input class="input" type="date" data-role="from" value="${st.from}" aria-label="From">
          <span class="muted">to</span>
          <input class="input" type="date" data-role="to" value="${st.to}" aria-label="To">` : ''}
        <span class="muted small period-label">${esc(this.periodLabel())}</span>
      </div>`;
  },

  // Percentages and signed changes used in several tabs.
  pct: x => `${(x * 100).toFixed(1)}%`,
  change(cur, prev) {
    if (!prev) return cur ? '—' : '';
    const d = (cur - prev) / Math.abs(prev);
    return `<span class="${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${Math.abs(d * 100).toFixed(0)}%</span>`;
  },
});
