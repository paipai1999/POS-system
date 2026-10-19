'use strict';

// Reservations: the day's bookings, taking a new one, and seating a booking at its table (which opens the bill).
Screens.reservations = {
  perm: 'tables',

  live: ['reservations', 'tables', 'orders', 'users'],

  state: { day: isoDate(new Date()) },

  root: null,

  dayStart() { const [y, m, d] = this.state.day.split('-').map(Number); return new Date(y, m - 1, d).getTime(); },

  shiftDay(n) { const d = new Date(this.dayStart()); d.setDate(d.getDate() + n); this.state.day = isoDate(d); },

  dayText() {
    const d = new Date(this.dayStart());
    return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  },

  render(root) {
    this.root = root;
    const list = Store.reservationsOnDay(this.dayStart());
    const waiting = list.filter(r => r.status === 'booked');
    const guests = waiting.reduce((n, r) => n + r.guests, 0);
    const isToday = this.state.day === isoDate(new Date());
    root.innerHTML = `
      <div class="page-head">
        <h1>Reservations</h1>
        <div class="actions"><button class="btn primary" data-act="new">${icon('clock')} New reservation</button></div>
      </div>
      <div class="toolbar day-nav">
        <button class="btn" data-act="prev" aria-label="Previous day">${icon('arrow-left')}</button>
        <button class="btn ${isToday ? 'active' : ''}" data-act="today">Today</button>
        <button class="btn" data-act="next" aria-label="Next day">${icon('arrow-up', 1)}</button>
        <input class="input" type="date" data-role="day" value="${this.state.day}" aria-label="Day">
        <span class="muted day-text">${esc(this.dayText())}</span>
      </div>
      <div class="stats compact">
        <div class="card stat"><div class="label">Waiting bookings</div><div class="value">${waiting.length}</div></div>
        <div class="card stat"><div class="label">Guests expected</div><div class="value">${guests}</div></div>
      </div>
      ${list.length ? `<div class="res-list">${list.map(r => this.card(r)).join('')}</div>` : '<p class="empty">No bookings on this day</p>'}`;

    root.onclick = e => {
      const t = e.target.closest('[data-act]');
      if (!t || t.disabled) return;
      const id = t.dataset.id;
      switch (t.dataset.act) {
        case 'new': this.form(); break;
        case 'edit': this.form(Store.reservation(id)); break;
        case 'prev': this.shiftDay(-1); this.render(root); break;
        case 'next': this.shiftDay(1); this.render(root); break;
        case 'today': this.state.day = isoDate(new Date()); this.render(root); break;
        case 'seat': this.seat(id); break;
        case 'cancel': this.close(id, 'cancelled', 'Cancel this booking?', 'The table is free for other bookings again.', 'Cancel booking'); break;
        case 'noshow': this.close(id, 'noshow', 'Mark as a no-show?', 'The guests did not come. The table is free for other bookings again.', 'No-show'); break;
        case 'reopen': Store.setReservationStatus(id, 'booked'); App.render(); break;
        case 'delete': this.remove(id); break;
        case 'order': App.go('order', { orderId: id }); break;
      }
    };
    root.onchange = e => { if (e.target.dataset.role === 'day' && e.target.value) { this.state.day = e.target.value; this.render(root); } };
  },

  card(r) {
    const table = r.tableId && Store.table(r.tableId);
    const late = r.status === 'booked' && Date.now() > r.at + 15 * 60000;
    const done = r.status !== 'booked';
    const label = { booked: 'Waiting', seated: 'Arrived', cancelled: 'Cancelled', noshow: 'No-show' }[r.status];
    return `
      <div class="card res ${done ? 'done' : ''} ${late ? 'late' : ''}">
        <div class="res-time"><b>${fmtTime(r.at)}</b><span class="muted small">${fmtTime(reservationEnd(r))}</span></div>
        <div class="res-main">
          <div class="res-name"><b>${esc(r.name)}</b> <span class="muted">· ${r.guests} <span>guests</span></span></div>
          <div class="res-meta">
            ${table ? `<span class="pill muted">${esc(table.name)}</span>` : '<span class="pill open">No table yet</span>'}
            ${r.phone ? `<span class="muted small">${esc(r.phone)}</span>` : ''}
          </div>
          ${r.note ? `<div class="line-note">“${esc(r.note)}”</div>` : ''}
        </div>
        <div class="res-side">
          <span class="pill ${r.status === 'booked' ? (late ? 'refunded' : 'open') : r.status === 'seated' ? 'paid' : 'void'}">${late ? 'Late' : label}</span>
          <div class="row-actions">
            ${r.status === 'booked' ? `
              <button class="btn small primary" data-act="seat" data-id="${r.id}">Seat</button>
              <button class="btn small" data-act="edit" data-id="${r.id}">Edit</button>
              <button class="btn small danger" data-act="cancel" data-id="${r.id}">Cancel</button>
              <button class="btn small" data-act="noshow" data-id="${r.id}">No-show</button>`
              : `${App.can('manage') ? `<button class="btn small" data-act="reopen" data-id="${r.id}">Reopen</button>` : ''}
                 ${r.status === 'seated' && r.orderId && Store.order(r.orderId) && Store.order(r.orderId).status === 'open' ? `<button class="btn small" data-act="order" data-id="${r.orderId}">Open bill</button>` : ''}`}
            ${App.can('manage') ? `<button class="btn small danger" data-act="delete" data-id="${r.id}" aria-label="Delete booking">${icon('trash', 1)}</button>` : ''}
          </div>
        </div>
      </div>`;
  },

  // The form for a new booking, or for changing one.
  form(r = null) {
    const tables = Store.data.tables;
    const when = new Date(r ? r.at : this.dayStart());
    const day = r ? isoDate(when) : this.state.day;
    const time = r ? `${pad2(when.getHours())}:${pad2(when.getMinutes())}` : '19:00';
    const stay = r ? stayOf(r) : DEFAULT_STAY;
    const stays = [...new Set([60, 90, 120, 150, 180, stay])].sort((a, b) => a - b);
    const actions = {
      save: () => {
        const v = formValues(Modal.el());
        const [y, mo, d] = String(v.day).split('-').map(Number);
        const [h, mi] = String(v.time).split(':').map(Number);
        const fields = {
          ...(r ? { id: r.id } : {}), name: v.name, phone: v.phone, guests: parseInt(v.guests, 10),
          at: new Date(y, mo - 1, d, h, mi).getTime(), duration: parseInt(v.duration, 10), tableId: v.tableId || null, note: v.note,
        };
        const problem = Store.reservationProblem({ ...(r || {}), status: r ? r.status : 'booked', ...fields });
        if (problem) return toast(problem, 'error');
        const saved = Store.saveReservation(fields);
        Modal.close();
        this.state.day = isoDate(new Date(saved.at));
        App.render();
        toast(r ? 'Booking changed' : 'Booking saved', 'ok');
      },
    };
    actions.__enter = actions.save;
    Modal.open({
      title: r ? 'Edit reservation' : 'New reservation',
      body: `
        <label class="field"><span>Name</span><input class="input" name="name" value="${esc(r ? r.name : '')}" autofocus></label>
        <div class="grid-2">
          <label class="field"><span>Phone</span><input class="input" name="phone" type="tel" value="${esc(r ? r.phone : '')}"></label>
          <label class="field"><span>Guests</span><input class="input" name="guests" type="number" min="1" max="${MAX_GUESTS}" inputmode="numeric" value="${r ? r.guests : 2}"></label>
        </div>
        <div class="grid-2">
          <label class="field"><span>Date</span><input class="input" name="day" type="date" value="${day}"></label>
          <label class="field"><span>Time</span><input class="input" name="time" type="time" value="${time}"></label>
        </div>
        <div class="grid-2">
          <label class="field"><span>Table</span>
            <select class="input" name="tableId">
              <option value="">No table yet</option>
              ${tables.map(t => `<option value="${t.id}" ${r && r.tableId === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
            </select></label>
          <label class="field"><span>Hold the table for</span>
            <select class="input" name="duration">${stays.map(m => `<option value="${m}" ${m === stay ? 'selected' : ''}>${m} min</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>Note</span><input class="input" name="note" value="${esc(r ? r.note : '')}" placeholder="Birthday, high chair, window seat…"></label>`,
      footer: '<button class="btn" data-act="__close">Cancel</button><button class="btn primary" data-act="save">Save booking</button>',
      actions,
    });
  },

  // The guests have arrived: put them at their table, which opens a bill for it.
  seat(id) {
    const r = Store.reservation(id);
    if (!r || r.status !== 'booked') return;
    if (!r.tableId) return this.chooseTable(r);
    const table = Store.table(r.tableId);
    if (Store.openOrderForTable(table.id)) return toast(`${table.name} is already in use`, 'error');
    const order = Store.createOrder({ tableId: table.id, staffId: App.user.id });
    Store.setReservationStatus(r.id, 'seated', { orderId: order.id });
    App.go('order', { orderId: order.id });
  },

  // A booking with no table yet: pick one of the free tables, then seat it.
  chooseTable(r) {
    const free = Store.data.tables.filter(t => !Store.openOrderForTable(t.id));
    if (!free.length) return toast('Every table is in use', 'error');
    Modal.open({
      title: `Seat ${r.name}`,
      body: `<p class="muted">Choose a free table for ${r.guests} guests.</p>
        <div class="user-grid">${free.map(t => `<button class="user-tile" data-act="pick" data-id="${t.id}"><span class="avatar">${icon('layout-grid', 1)}</span><span>${esc(t.name)}</span></button>`).join('')}</div>`,
      actions: {
        pick: t => {
          const problem = Store.reservationProblem({ ...r, tableId: t.dataset.id });
          if (problem) return toast(problem, 'error');
          Modal.close();
          Store.saveReservation({ id: r.id, tableId: t.dataset.id });
          this.seat(r.id);
        },
      },
    });
  },

  close(id, status, title, message, okLabel) {
    confirmDialog({ title, message, okLabel, danger: true, onOk: () => { Store.setReservationStatus(id, status); App.render(); } });
  },

  remove(id) {
    const r = Store.reservation(id);
    confirmDialog({
      title: `Delete the booking for ${r ? r.name : ''}?`, message: 'It is removed completely. To keep a record, cancel it instead.', okLabel: 'Delete', danger: true,
      onOk: () => { Store.removeReservation(id); App.render(); },
    });
  },
};
