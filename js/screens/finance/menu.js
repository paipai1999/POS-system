'use strict';

// Finance tab: menu engineering - which dishes are stars, which sell well but earn little, which earn well but hide, and
// which could go. The calculation is in js/finance/menu.js; this draws it.
(() => {
  const GROUPS = {
    star: { label: 'Stars', one: 'Star', what: 'Popular and profitable. Keep the quality up and show them first.' },
    plowhorse: { label: 'Plowhorses', one: 'Plowhorse', what: 'Popular but they leave little. Raise the price a little, or trim the recipe cost.' },
    puzzle: { label: 'Puzzles', one: 'Puzzle', what: 'Profitable but rarely ordered. Move them up the menu, rename them, have waiters suggest them.' },
    dog: { label: 'Dogs', one: 'Dog', what: 'Rarely ordered and they leave little. Rework them, or take them off.' },
    unknown: { label: 'No recipe', one: 'No recipe', what: 'No ingredient cost is recorded, so the margin is unknown. Add a recipe under Menu & Stock.' },
  };

  function model(f) {
    return Finance.menuEngineering(f.bounds(), Store.data, Store.settings, id => { const p = Store.product(id); const c = p && Store.category(p.categoryId); return c ? c.name : 'Other'; });
  }

  const box = (m, g) => {
    const names = m.items.filter(i => i.group === g);
    return `
      <section class="card quad ${g}">
        <h3>${GROUPS[g].label} <span class="muted">${names.length}</span></h3>
        <p class="muted small">${GROUPS[g].what}</p>
        <p class="names">${names.slice(0, 8).map(i => esc(i.name)).join(' · ') || '<span class="muted">none</span>'}${names.length > 8 ? ` <span class="muted">+ ${names.length - 8} more</span>` : ''}</p>
      </section>`;
  };

  function html(f) {
    const m = model(f);
    if (!m.items.length) return '<p class="empty">No sales in this period</p>';
    return `
      ${m.judged < 4 ? `<div class="alert-box">${icon('alert')} Only ${m.judged} dish${m.judged === 1 ? ' has' : 'es have'} a recipe cost, so the groups below are rough. Add recipes under Menu &amp; Stock for the rest.</div>` : ''}
      <div class="quad-grid">
        ${box(m, 'puzzle')}${box(m, 'star')}
        ${box(m, 'dog')}${box(m, 'plowhorse')}
      </div>
      <p class="muted small quad-axes">Left: less popular · Right: popular (sells at least 70% of an equal share) · Top: margin per portion at or above the average · Bottom: below it.</p>
      <div class="stats compact">
        <div class="card stat"><div class="label">Average margin per portion</div><div class="value">${money(m.marginAt)}</div></div>
        <div class="card stat"><div class="label">Dishes judged</div><div class="value">${m.judged}</div></div>
        <div class="card stat"><div class="label">Dishes with no recipe</div><div class="value">${m.count.unknown}</div></div>
      </div>
      ${m.count.unknown ? box(m, 'unknown') : ''}

      <h2 class="section-title">Every dish</h2>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Dish</th><th>Category</th><th class="num">Sold</th><th class="num">Price</th><th class="num">Cost</th><th class="num">Margin</th><th class="num">Margin %</th><th class="num">Earned</th><th>Group</th></tr></thead>
          <tbody>${m.items.map(i => `
            <tr>
              <td>${esc(i.name)}</td><td>${esc(i.category)}</td><td class="num">${i.qty}</td><td class="num">${money(i.unitPrice)}</td>
              <td class="num">${i.unitCost === null ? '—' : money(i.unitCost)}</td><td class="num">${i.margin === null ? '—' : money(i.margin)}</td>
              <td class="num">${i.marginPercent === null ? '—' : f.pct(i.marginPercent)}</td><td class="num">${i.contribution === null ? '—' : money(i.contribution)}</td>
              <td><span class="pill ${i.group}">${GROUPS[i.group].one}</span></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p class="muted small">Earned = what the sales left after ingredients. Margin is per portion, from each dish's recipe at the time it was sold. Dishes sold in this period only; refunded bills are left out.</p>`;
  }

  function csv(f) {
    const m = model(f);
    return [['Dish', 'Category', 'Sold', 'Price', 'Cost', 'Margin', 'Margin %', 'Earned', 'Group'],
      ...m.items.map(i => [i.name, i.category, i.qty, i.unitPrice, i.unitCost ?? '', i.margin ?? '', i.marginPercent === null ? '' : Math.round(i.marginPercent * 1000) / 10, i.contribution ?? '', GROUPS[i.group].one])];
  }

  Screens.finance.tabs.menu = { label: 'Menu engineering', uses: 'period', html, csv, filename: 'menu-engineering' };
})();
