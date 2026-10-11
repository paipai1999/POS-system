'use strict';

// The dashboard's Overview tab: KPI cards with a comparison and a sparkline, what is happening right now, and charts of the
// week, today by hour, best sellers, categories and payment methods. The numbers come from Finance.overview (js/finance/overview.js).
Object.assign(Screens.dashboard, {
  // Two weeks of orders are needed for "this week against the one before". In server mode older ones are fetched first.
  overviewHTML(g) {
    const from = this.startOfDay() - 13 * 86400000;
    if (!Sync.ordersLoaded(from)) {
      Sync.loadOrders(from)
        .then(() => { if (App.screen === 'dashboard' && this.root) this.render(this.root); })
        .catch(() => { /* the other tabs still work; the next live update retries */ });
      return '<p class="empty">Loading sales…</p>';
    }
    const categoryOf = id => {
      const p = Store.product(id);
      const c = p && Store.category(p.categoryId);
      return c ? c.name : 'Other';
    };
    const ov = Finance.overview(Store.data.orders, Date.now(), Store.settings, categoryOf);
    const change = Finance.overviewChange;
    const t = ov.today, y = ov.yesterday;
    const avg = w => (w.count ? w.sales / w.count : 0);
    const margin = t.costedSales > 0 ? Math.round(t.profit / t.costedSales * 100) : null;
    const spark = key => sparkline(ov.days.map(d => (key === 'avg' ? avg(d) : d[key])), '');

    const kpi = (label, value, delta, sub, chart = '', cls = '') => `
      <div class="card kpi ${cls}">
        <div class="kpi-top"><span class="label">${label}</span>${delta}</div>
        <div class="kpi-value">${value}</div>
        <div class="kpi-sub muted small">${sub}</div>
        ${chart}
      </div>`;

    const stage = s => g.open.filter(x => x.stage === s).length;
    const dayLabel = d => new Date(d.date).toLocaleDateString(undefined, { weekday: 'short' });
    const nowHour = new Date().getHours();
    const active = ov.hours.map((v, h) => (v > 0 ? h : -1)).filter(h => h >= 0);
    const h0 = Math.min(active.length ? active[0] : nowHour, 8, nowHour);
    const h1 = Math.max(active.length ? active[active.length - 1] : nowHour, nowHour);
    const hourRows = ov.hours.slice(h0, h1 + 1).map((v, i) => ({ label: pad2(h0 + i), value: v, text: money(v), hot: h0 + i === nowHour }));
    const dayRows = ov.days.map((d, i) => ({ label: dayLabel(d), value: d.sales, text: money(d.sales), hot: i === ov.days.length - 1 }));

    return `
      <div class="ov-date muted">${esc(new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }))}</div>
      <div class="kpis">
        ${kpi('Sales today', money(t.sales), deltaBadge(change(t.sales, y.sales)), `vs ${money(y.sales)} yesterday so far`, spark('sales'))}
        ${kpi('Orders', t.count, deltaBadge(change(t.count, y.count)), `vs ${y.count} yesterday so far`, spark('count'))}
        ${kpi('Average bill', money(avg(t)), deltaBadge(change(avg(t), avg(y))), `vs ${money(avg(y))} yesterday so far`, spark('avg'))}
        ${t.costedSales > 0
          ? kpi('Profit on recipe items', money(t.profit), deltaBadge(change(t.profit, y.profit)), `${margin}% margin`, '')
          : kpi('Open orders', g.open.length, '', money(g.open.reduce((n, x) => n + x.total, 0)))}
      </div>
      <div class="now-strip">
        <span class="now-title">Right now</span>
        <button class="chip" data-act="tab" data-tab="orders"><b>${g.open.length}</b> Open orders</button>
        <button class="chip ${stage('cooking') ? 'busy' : ''}" data-act="tab" data-tab="orders"><b>${stage('cooking')}</b> In the kitchen</button>
        <button class="chip ${stage('ready') ? 'ok' : ''}" data-act="tab" data-tab="orders"><b>${stage('ready')}</b> Ready to serve</button>
        <button class="chip" data-act="tab" data-tab="orders"><b>${stage('payment')}</b> Waiting for payment</button>
      </div>
      <div class="ov-grid">
        <section class="card ov-wide">
          <div class="ov-head"><h2>Last 7 days</h2>
            <span class="ov-total">${money(ov.week.sales)} ${deltaBadge(change(ov.week.sales, ov.before.sales))}<span class="muted small"> vs previous 7 days</span></span></div>
          ${columnChart(dayRows)}
        </section>
        <section class="card">
          <h2>Sales by hour</h2>
          ${columnChart(hourRows, { labelEvery: hourRows.length > 12 ? 3 : hourRows.length > 7 ? 2 : 1 })}
        </section>
        <section class="card">
          <h2>Best sellers</h2>
          ${barList(ov.topItems.map(i => ({ label: i.name, value: i.amount, text: `${money(i.amount)} · ${i.qty}` })))}
        </section>
        <section class="card">
          <h2>Sales by category</h2>
          ${donut(ov.categories.slice(0, 6).map(c => ({ label: c.name, value: c.amount, text: money(c.amount) })))}
        </section>
        <section class="card">
          <h2>Payment methods</h2>
          ${donut(ov.methods.slice(0, 6).map(m => ({ label: PAY_METHODS[m.method] || m.method, value: m.amount, text: money(m.amount) })))}
        </section>
      </div>`;
  },
});
