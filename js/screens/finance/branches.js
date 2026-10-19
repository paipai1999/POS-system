'use strict';

// Finance tab: branches. Backup files from several shops, side by side: sales, orders, food cost, labour and profit.
// The files are read in this browser only, kept in memory while this page is open, and never uploaded. The calculation is in
// js/finance/branches.js; this reads the files and draws it.
(() => {
  const files = [];   // { id, label, fileName, data, settings }

  const branches = f => {
    const list = [];
    if (f.state.branchSelf !== false) list.push({ id: 'self', label: `${Store.settings.name} (this device)`, data: Store.data, settings: Store.settings });
    return [...list, ...files];
  };

  const report = f => Finance.branchReport(f.bounds(), branches(f));

  const pct = v => (v === null || v === undefined ? '–' : `${Math.round(v * 1000) / 10}%`);

  const when = ts => new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

  function html(f) {
    const rep = report(f);
    const fmt = (r, n) => moneyWith({ currency: r.currency, currencyAfter: r.currencyAfter, decimals: r.decimals }, n);
    const head = `
      <div class="toolbar">
        <label class="btn">${icon('upload')} Add backup files<input type="file" accept=".json,application/json" multiple data-role="branchfile" hidden></label>
        <label class="check"><input type="checkbox" data-role="branchself" ${f.state.branchSelf !== false ? 'checked' : ''}> Include this shop (this device's own data)</label>
      </div>
      <p class="muted small">Each shop has its own POS and its own data. To see them together, save a backup from each branch (Settings → Export backup), then add the files here. The files are read in this browser only: nothing is uploaded or kept after you leave this page. A backup shows the shop as it was when it was saved, so save fresh ones first.</p>
      ${files.length ? `
        <ul class="plain branch-files">${files.map(x => `
          <li>
            <input class="input" data-role="branchlabel" data-id="${x.id}" value="${esc(x.label)}" aria-label="Branch name">
            <span class="muted small">${esc(x.fileName)}</span>
            <button class="btn small" data-act="branch-remove" data-id="${x.id}" aria-label="Remove">${icon('x', 1)}</button>
          </li>`).join('')}
        </ul>` : ''}`;
    if (!rep.rows.length) return `${head}<p class="empty">Add the backup file of each branch to compare them.</p>`;

    const stale = rep.rows.filter(r => r.stale);
    const col = r => `${esc(r.label)}`;
    const money_ = (r, n) => fmt(r, n);
    const total = rep.totals;
    return `
      ${head}
      ${rep.duplicates.length ? `<div class="alert-box">${icon('alert')} <span>Some branches have the same name: ${rep.duplicates.map(esc).join(', ')}. If two files are the same shop, remove one so its sales are not counted twice.</span></div>` : ''}
      ${rep.mixed ? `<div class="alert-box">${icon('alert')} <span>The branches use different currencies or number formats, so nothing is added up. Each branch is shown in its own money.</span></div>` : ''}
      ${stale.map(r => `<div class="alert-box">${icon('alert')} <span>${r.latestSale === null ? `${esc(r.label)}: this backup has no sales, so the figures may not cover the whole period. Save a fresh backup from that branch.` : `${esc(r.label)}: the last sale in this backup is from ${when(r.latestSale)}, so the figures may not cover the whole period. Save a fresh backup from that branch.`}</span></div>`).join('')}
      <div class="table-wrap"><table class="data compact branch-table">
        <thead><tr><th>Branch</th><th class="num">Sales</th>${total ? '<th class="num">Share</th>' : ''}<th class="num">Orders</th><th class="num">Average bill</th><th class="num">Food cost</th><th class="num">Labour</th><th class="num">Net profit</th><th class="num">Margin</th></tr></thead>
        <tbody>${rep.rows.map(r => `
          <tr class="${rep.best === r ? 'best' : ''}">
            <td><b>${col(r)}</b>${rep.best === r ? ' <span class="pill paid">Best margin</span>' : ''}</td>
            <td class="num"><b>${money_(r, r.revenue)}</b></td>
            ${total ? `<td class="num">${pct(r.share)}</td>` : ''}
            <td class="num">${r.orders}</td><td class="num">${money_(r, r.avgCheck)}</td>
            <td class="num">${pct(r.foodRatio)}</td>
            <td class="num">${pct(r.labourRatio)}${r.labourEstimated ? ' <span class="muted small" title="Estimated from staff hours">~</span>' : ''}</td>
            <td class="num ${r.netProfit < 0 ? 'neg' : ''}">${money_(r, r.netProfit)}</td>
            <td class="num">${pct(r.netMargin)}</td>
          </tr>`).join('')}
          ${total && rep.rows.length > 1 ? `
          <tr class="total-row">
            <td><b>All branches</b></td><td class="num"><b>${money_(rep.rows[0], total.revenue)}</b></td><td class="num">100%</td><td class="num">${total.orders}</td>
            <td class="num">${money_(rep.rows[0], total.avgCheck)}</td><td class="num">${pct(total.foodRatio)}</td><td class="num">${pct(total.labourRatio)}</td>
            <td class="num ${total.netProfit < 0 ? 'neg' : ''}"><b>${money_(rep.rows[0], total.netProfit)}</b></td><td class="num">${pct(total.netMargin)}</td>
          </tr>` : ''}
        </tbody>
      </table></div>
      ${total && rep.rows.length > 1 ? `
        <div class="report-grid">
          <section class="card"><h2>Sales by branch</h2>${barList(rep.rows.map(r => ({ label: r.label, value: Math.max(0, r.revenue), text: money_(r, r.revenue) })))}</section>
          <section class="card"><h2>Net profit by branch</h2>${barList(rep.rows.map(r => ({ label: r.label, value: Math.max(0, r.netProfit), text: money_(r, r.netProfit) })))}</section>
        </div>` : ''}
      <p class="muted small">Every branch is worked out with its own settings by the same rules as its own Business health tab: sales are after discounts and refunds, before tax; food cost comes from recipes; labour from the salaries recorded as expenses (marked ~ when estimated from staff hours); net profit is after all recorded expenses. Percentages are of that branch's sales.</p>`;
  }

  function csv(f) {
    const rep = report(f);
    const header = ['Branch', 'Currency', 'Sales', 'Orders', 'Average bill', 'Food cost', 'Food cost %', 'Labour', 'Labour %', 'Net profit', 'Margin %', 'Last sale in the file'];
    const p = v => (v === null ? '' : Math.round(v * 1000) / 10);
    const line = r => [r.label, r.currency, r.revenue, r.orders, r.avgCheck, r.food, p(r.foodRatio), r.labour, p(r.labourRatio), r.netProfit, p(r.netMargin), r.latestSale ? isoDate(new Date(r.latestSale)) : ''];
    const t = rep.totals;
    return [header, ...rep.rows.map(line), ...(t && rep.rows.length > 1 ? [['All branches', rep.rows[0].currency, t.revenue, t.orders, t.avgCheck, t.food, p(t.foodRatio), t.labour, p(t.labourRatio), t.netProfit, p(t.netMargin), '']] : [])];
  }

  const readText = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });

  // Reads the chosen backup files into memory.
  async function addFiles(f, input) {
    for (const file of [...input.files]) {
      let data = null;
      try { data = JSON.parse(await readText(file)); } catch (e) { data = null; }
      if (!isValidDataset(data)) { toast(`${file.name} is not a valid POS backup`, 'error'); continue; }
      normalizeDataset(data);
      const settings = { ...seedData().settings, ...data.settings };
      let label = String(settings.name || file.name).trim() || file.name;
      const taken = new Set([...files.map(x => x.label), ...(f.state.branchSelf !== false ? [`${Store.settings.name} (this device)`] : [])]);
      for (let n = 2; taken.has(label); n++) label = `${settings.name} (${n})`;
      files.push({ id: uid('b_'), label, fileName: file.name, data, settings });
    }
    input.value = '';
    f.render(f.root);
  }

  Screens.finance.tabs.branches = {
    label: 'Branches',
    uses: 'period',
    // This shop's own bills must be on this device for the period; with this shop left out, nothing needs fetching.
    needFrom: f => (f.state.branchSelf !== false ? f.bounds()[0] : Date.now()),
    html, csv, filename: 'branches',
    actions: {
      'branch-remove': (f, t) => { const i = files.findIndex(x => x.id === t.dataset.id); if (i >= 0) files.splice(i, 1); f.render(f.root); },
    },
    changes: {
      branchfile: (f, input) => addFiles(f, input),
      branchself: (f, input) => { f.state.branchSelf = input.checked; f.render(f.root); },
      branchlabel: (f, input) => { const x = files.find(y => y.id === input.dataset.id); if (x && input.value.trim()) x.label = input.value.trim(); f.render(f.root); },
    },
  };
})();
