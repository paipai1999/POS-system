'use strict';

// Staff hours (managers and admins): who worked when and for how long, what that cost in wages, and the corrections a time sheet needs
// (a forgotten clock-out, a shift nobody clocked). Staff clock themselves in and out from the menu bar (js/app/clock.js).
// The sums are in js/finance/attendance.js; this draws them.
Screens.attendance = {
  perm: 'manage',

  live: ['attendance', 'users', 'settings', 'orders', 'expenses'],

  state: { range: 'week', from: isoDate(new Date()), to: isoDate(new Date()), kitchenShares: true },

  root: null,

  RANGES: [['week', 'This week'], ['lastweek', 'Last week'], ['month', 'This month'], ['lastmonth', 'Last month'], ['custom', 'Custom']],

  // [from, to) in ms. Weeks run Monday to Sunday.
  bounds() {
    const st = this.state;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
    const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
    const monday = addDays(today, -((today.getDay() + 6) % 7));
    let a, b;
    switch (st.range) {
      case 'lastweek': a = addDays(monday, -7); b = monday; break;
      case 'month': a = new Date(today.getFullYear(), today.getMonth(), 1); b = new Date(today.getFullYear(), today.getMonth() + 1, 1); break;
      case 'lastmonth': a = new Date(today.getFullYear(), today.getMonth() - 1, 1); b = new Date(today.getFullYear(), today.getMonth(), 1); break;
      case 'custom': {
        const from = st.from ? parse(st.from) : today, to = st.to ? parse(st.to) : today;
        [a, b] = from <= to ? [from, addDays(to, 1)] : [to, addDays(from, 1)];
        break;
      }
      default: a = monday; b = addDays(monday, 7);
    }
    return [a.getTime(), b.getTime()];
  },

  report() { return Finance.attendanceReport(this.bounds(), Store.data, Store.settings); },

  tips() { return Finance.tipsReport(this.bounds(), Store.data, Store.settings, { excludeRoles: this.state.kitchenShares ? [] : ['kitchen'] }); },

  render(root) {
    this.root = root;
    const st = this.state;
    // In server mode a device holds only the last weeks of records; an older period is fetched first (the bills too, for the tips).
    const from = this.bounds()[0];
    if (!Sync.historyLoaded(from)) {
      root.innerHTML = '<div class="page-head"><h1>Staff hours</h1></div><p class="empty">Loading time sheets…</p>';
      Sync.loadHistory(from)
        .then(() => { if (App.screen === 'attendance') this.render(root); })
        .catch(e => { root.innerHTML = `<p class="empty">${esc(e.message)}</p>`; });
      return;
    }
    const rep = this.report();
    const anyRate = rep.people.some(p => p.rate !== null);
    const now = Store.data.attendance.filter(e => e.out == null && !attendanceUnsure(e));
    const stat = (label, value, sub = '') => `<div class="card stat"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="muted small">${sub}</div>` : ''}</div>`;
    root.innerHTML = `
      <div class="page-head">
        <h1>Staff hours</h1>
        <div class="actions">
          <button class="btn" data-act="csv" ${rep.shifts.length || this.tips().total > 0 ? '' : 'disabled'}>${icon('download')} Export CSV</button>
          <button class="btn primary" data-act="new">＋ Add a shift</button>
        </div>
      </div>
      <div class="toolbar">
        <div class="seg">
          ${this.RANGES.map(([k, label]) => `<button data-act="range" data-range="${k}" class="${st.range === k ? 'active' : ''}">${label}</button>`).join('')}
        </div>
        ${st.range === 'custom' ? `
          <input class="input" type="date" data-role="from" value="${st.from}" aria-label="From">
          <span class="muted">to</span>
          <input class="input" type="date" data-role="to" value="${st.to}" aria-label="To">` : ''}
      </div>
      ${rep.forgotten.length ? `
        <div class="alert-box">${icon('alert')} <span>${rep.forgotten.length === 1 ? 'One shift has no real clock-out' : `${rep.forgotten.length} shifts have no real clock-out`}: ${rep.forgotten.map(r => `${esc(r.name)} (${fmtDateTime(r.in)})`).join(', ')}.</span>
          <span>They count for nothing until you set the time they left: press Edit on the shift below.</span></div>` : ''}
      ${now.length ? `<p class="onshift">${icon('clock')} <b>On shift now:</b> ${now.map(e => `${esc(e.userName)} <span class="muted small">since ${fmtTime(e.in)}</span>`).join(' · ')}</p>` : ''}
      <div class="stats">
        ${stat('Hours worked', hoursText(rep.hours), `${rep.people.length} ${rep.people.length === 1 ? 'person' : 'people'} · ${rep.shifts.length} shift${rep.shifts.length === 1 ? '' : 's'}`)}
        ${anyRate ? stat('Wages', money(rep.wages), 'hours × hourly pay') : ''}
        ${rep.people.length ? stat('Average per person', hoursText(rep.hours / rep.people.length)) : ''}
      </div>
      ${anyRate && rep.withoutRate.length ? `<p class="muted small">No hourly pay is set for ${rep.withoutRate.map(esc).join(', ')}, so their wages are not counted. Set it under Staff → Edit.</p>` : ''}
      <h2 class="section-title">By person</h2>
      ${rep.people.length ? `
        <div class="table-wrap"><table class="data compact">
          <thead><tr><th>Name</th><th class="num">Days</th><th class="num">Shifts</th><th class="num">Hours</th><th class="num">Average shift</th>${anyRate ? '<th class="num">Pay per hour</th><th class="num">Wages</th>' : ''}<th></th></tr></thead>
          <tbody>${rep.people.map(p => `
            <tr>
              <td><b>${esc(p.name)}</b></td>
              <td class="num">${p.days}</td><td class="num">${p.shifts}</td>
              <td class="num"><b>${hoursText(p.hours)}</b></td><td class="num">${hoursText(p.avgShift)}</td>
              ${anyRate ? `<td class="num">${p.rate === null ? '<span class="muted">–</span>' : money(p.rate)}</td><td class="num">${p.wages === null ? '<span class="muted">–</span>' : money(p.wages)}</td>` : ''}
              <td>${p.onShift ? '<span class="pill paid">On shift</span>' : ''}${p.forgotten ? ' <span class="pill open">Check</span>' : ''}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>` : '<p class="empty small">No shifts in this period</p>'}
      <h2 class="section-title">Shifts</h2>
      ${rep.shifts.length ? `
        <div class="table-wrap"><table class="data compact">
          <thead><tr><th>Date</th><th>Name</th><th>In</th><th>Out</th><th class="num">Break</th><th class="num">Hours</th><th></th></tr></thead>
          <tbody>${rep.shifts.map(r => `
            <tr class="${r.forgotten ? 'needs-check' : ''}">
              <td>${new Date(r.in).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}</td>
              <td>${esc(r.name)}</td>
              <td>${fmtTime(r.in)}</td>
              <td>${r.forgotten ? '<span class="pill open">No clock-out</span>' : r.out == null ? '<span class="pill paid">On shift</span>' : fmtTime(r.out) + (new Date(r.out).toDateString() === new Date(r.in).toDateString() ? '' : ' <span class="muted small">+1 day</span>')}</td>
              <td class="num">${r.breakMinutes ? `${r.breakMinutes} min` : ''}</td>
              <td class="num">${r.forgotten ? '<span class="muted">–</span>' : hoursText(r.hours)}</td>
              <td><div class="row-actions">${r.edited ? `<span class="muted small" title="${esc(this.editedTitle(r))}">${icon('pencil', 1)} edited</span>` : ''}${r.note ? `<span class="muted small" title="${esc(r.note)}">${icon('file-text', 1)}</span>` : ''}<button class="btn small" data-act="edit" data-id="${r.id}">Edit</button></div></td>
            </tr>`).join('')}
          </tbody>
        </table></div>` : '<p class="empty small">No shifts in this period</p>'}
      ${this.tipsHTML()}
      <p class="muted small spaced">Staff clock themselves in and out with the clock button in the menu bar; the time is the server's. A shift counts on the day it started. A shift left running for more than 16 hours is taken to be a forgotten clock-out and counts for nothing until you correct it. Wages are hours × the hourly pay set under Staff, before any tax or deduction.</p>`;

    root.onclick = e => {
      const t = e.target.closest('[data-act]');
      if (!t || t.disabled) return;
      switch (t.dataset.act) {
        case 'range': st.range = t.dataset.range; this.render(root); break;
        case 'new': this.form(); break;
        case 'edit': this.form(Store.shift(t.dataset.id)); break;
        case 'csv': this.exportCSV(); break;
      }
    };
    root.onchange = e => {
      const role = e.target.dataset.role;
      if (role === 'from' || role === 'to') { st[role] = e.target.value; this.render(root); }
      else if (role === 'kitchen') { st.kitchenShares = e.target.checked; this.render(root); }
    };
  },

  // Tips of the period: collected, paid out, and how each person's amount comes out by their own bills and by shared hours.
  tipsHTML() {
    const tp = this.tips();
    if (!(tp.total > 0) && !(tp.paidOut > 0)) return `<h2 class="section-title">Tips</h2><p class="empty small">No tips in this period</p>`;
    const stat = (label, value, sub = '') => `<div class="card stat"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="muted small">${sub}</div>` : ''}</div>`;
    return `
      <h2 class="section-title">Tips</h2>
      <div class="stats compact">
        ${stat('Tips collected', money(tp.total), `${tp.bills} bill${tp.bills === 1 ? '' : 's'}`)}
        ${stat('Paid out to staff', money(tp.paidOut))}
        ${stat('Still to pay', money(tp.toPay))}
      </div>
      <label class="check"><input type="checkbox" data-role="kitchen" ${this.state.kitchenShares ? 'checked' : ''}> Kitchen staff share in the pool</label>
      <div class="table-wrap"><table class="data compact">
        <thead><tr><th>Name</th><th class="num">Bills with a tip</th><th class="num">Own tips</th><th class="num">Hours</th><th class="num">Shared by hours</th></tr></thead>
        <tbody>${tp.people.map(p => `
          <tr>
            <td><b>${esc(p.name)}</b></td>
            <td class="num">${p.bills || '<span class="muted">–</span>'}</td>
            <td class="num">${p.own ? money(p.own) : '<span class="muted">–</span>'}</td>
            <td class="num">${p.hours > 0 ? hoursText(p.hours) : '<span class="muted">–</span>'}</td>
            <td class="num">${p.share > 0 ? `<b>${money(p.share)}</b>` : '<span class="muted">–</span>'}</td>
          </tr>`).join('')}
          <tr class="total-row"><td><b>Total</b></td><td class="num">${tp.bills}</td><td class="num"><b>${money(tp.total)}</b></td><td class="num">${tp.canShare ? hoursText(tp.poolHours) : ''}</td><td class="num">${tp.canShare ? `<b>${money(tp.total)}</b>` : ''}</td></tr>
        </tbody>
      </table></div>
      <p class="muted small">
        <span>Own tips are the tips on the bills each person took. Shared by hours divides all the tips of the period by the hours people worked, so a tip is shared with whoever was on shift.</span>
        ${tp.canShare ? '' : '<span>Nobody has hours in this period yet, so there is nothing to share by.</span>'}
        ${tp.withoutHours.length ? `<span>${tp.withoutHours.map(esc).join(', ')} took tips but have no hours recorded, so they have no share.</span>` : ''}
        <span>Choose whichever way you pay tips out; then record the payment in Finance → Expenses, category “Tips paid to staff” (it is not a cost of the restaurant).</span>
        ${tp.byMethod.cash && (tp.byMethod.card || tp.byMethod.other) ? `<span>Of the tips, ${money(tp.byMethod.cash)} was handed over in cash and ${money(tp.byMethod.card + tp.byMethod.other)} by card or another way.</span>` : ''}
      </p>`;
  },

  editedTitle(r) {
    const by = r.editedBy && Store.user(r.editedBy);
    return `Corrected by ${by ? by.name : 'a manager'}`;
  },

  // A date and a time field pair into a moment, or NaN when either is empty.
  moment(day, time) {
    const [y, mo, d] = String(day).split('-').map(Number);
    const [h, mi] = String(time).split(':').map(Number);
    return day && time ? new Date(y, mo - 1, d, h, mi).getTime() : NaN;
  },

  // Adding a shift nobody clocked, or correcting one.
  form(e = null) {
    const people = Store.data.users.filter(u => u.active || (e && u.id === e.userId));
    const stamp = ts => (ts == null ? { day: '', time: '' } : { day: isoDate(new Date(ts)), time: `${pad2(new Date(ts).getHours())}:${pad2(new Date(ts).getMinutes())}` });
    const a = e ? stamp(e.in) : { day: isoDate(new Date()), time: '09:00' };
    const z = e ? stamp(e.out) : { day: isoDate(new Date()), time: '17:00' };
    const actions = {
      save: () => {
        const v = formValues(Modal.el());
        const userId = e ? e.userId : v.userId;
        const person = Store.user(userId);
        if (!person) return toast('Choose the person', 'error');
        const fields = {
          ...(e ? { id: e.id } : {}), userId, userName: person.name, in: this.moment(v.inDay, v.inTime),
          out: v.outDay || v.outTime ? this.moment(v.outDay, v.outTime) : null,
          breakMinutes: v.breakMinutes === '' ? 0 : Number(v.breakMinutes), note: v.note,
        };
        const problem = Store.shiftProblem({ ...(e || {}), ...fields });
        if (problem) return toast(problem, 'error');
        Store.saveShift(fields);
        Modal.close();
        App.render();
        toast(e ? 'Shift corrected' : 'Shift added', 'ok');
      },
      delete: () => {
        Modal.close();
        confirmDialog({
          title: `Delete this shift of ${e.userName}?`, message: 'It is removed completely and the change is recorded in the activity log.', okLabel: 'Delete', danger: true,
          onOk: () => { Store.removeShift(e.id); App.render(); },
        });
      },
    };
    actions.__enter = actions.save;
    Modal.open({
      title: e ? `Correct ${e.userName}'s shift` : 'Add a shift',
      body: `
        ${e ? '' : `<label class="field"><span>Person</span>
          <select class="input" name="userId"><option value="">Choose…</option>${people.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></label>`}
        <div class="grid-2">
          <label class="field"><span>Started: date</span><input class="input" name="inDay" type="date" value="${a.day}"></label>
          <label class="field"><span>Time</span><input class="input" name="inTime" type="time" value="${a.time}"></label>
        </div>
        <div class="grid-2">
          <label class="field"><span>Ended: date</span><input class="input" name="outDay" type="date" value="${z.day}"></label>
          <label class="field"><span>Time</span><input class="input" name="outTime" type="time" value="${z.time}"></label>
        </div>
        <p class="muted small">Leave the end empty if the person is still working.</p>
        <label class="field"><span>Unpaid break (minutes)</span><input class="input" name="breakMinutes" type="number" min="0" max="${ATTENDANCE_MAX_BREAK}" inputmode="numeric" value="${e && e.breakMinutes ? e.breakMinutes : ''}" placeholder="0"></label>
        <label class="field"><span>Note</span><input class="input" name="note" maxlength="200" value="${esc(e ? e.note || '' : '')}" placeholder="Forgot to clock out, covered a shift…"></label>`,
      footer: `${e ? '<button class="btn danger" data-act="delete">Delete</button><span class="spacer"></span>' : ''}
        <button class="btn" data-act="__close">Cancel</button><button class="btn primary" data-act="save">${e ? 'Save' : 'Add shift'}</button>`,
      actions,
    });
  },

  exportCSV() {
    const [a, b] = this.bounds();
    const rep = this.report();
    const tp = this.tips();
    const h = n => Math.round(n * 100) / 100;
    const cell = v => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [
      ['Name', 'Days', 'Shifts', 'Hours', 'Pay per hour', 'Wages'],
      ...rep.people.map(p => [p.name, p.days, p.shifts, h(p.hours), p.rate ?? '', p.wages ?? '']),
      ['Total', '', rep.shifts.length, h(rep.hours), '', rep.wages],
      [],
      ['Date', 'Name', 'In', 'Out', 'Break (min)', 'Hours', 'Note', 'Corrected by a manager'],
      ...rep.shifts.map(r => [isoDate(new Date(r.in)), r.name, fmtTime(r.in), r.out == null ? '' : `${isoDate(new Date(r.out))} ${fmtTime(r.out)}`, r.breakMinutes || '', r.forgotten ? 'no clock-out' : h(r.hours), r.note || '', r.edited ? 'yes' : '']),
      ...(tp.total > 0 ? [[], ['Tips'], ['Name', 'Bills with a tip', 'Own tips', 'Hours', 'Shared by hours'],
        ...tp.people.map(p => [p.name, p.bills, p.own, h(p.hours), p.share]), ['Total', tp.bills, tp.total, h(tp.poolHours), tp.canShare ? tp.total : ''], ['Paid out', '', tp.paidOut], ['Still to pay', '', tp.toPay]] : []),
    ];
    downloadFile(`staff-hours_${isoDate(new Date(a))}_to_${isoDate(new Date(b - 1))}.csv`, rows.map(r => r.map(cell).join(',')).join('\n'), 'text/csv');
  },
};
