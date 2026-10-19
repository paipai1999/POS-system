'use strict';

// Table reservations (the rules themselves are in js/shared/reservations.js, and the server checks them again).
Object.assign(Store, {
  reservation(id) { return this.data.reservations.find(r => r.id === id); },

  reservationsOnDay(dayStart) { return reservationsOnDay(this.data.reservations, dayStart); },

  // The booking a table should warn about (due soon, or a guest who is late and still expected).
  nextReservationFor(tableId, now = Date.now()) { return nextReservation(this.data.reservations, tableId, now); },

  // What is wrong with this booking, in words for the person taking it, or '' when it can be saved. Mirrors the server's checks
  // so a mistake is explained at once instead of after the change has travelled to the server and back.
  reservationProblem(r) {
    if (!String(r.name || '').trim()) return 'Enter the name the table is booked under';
    if (r.phone && !/^[0-9+\-() ]{3,30}$/.test(String(r.phone).trim())) return 'Enter the phone number with digits only';
    if (!Number.isInteger(r.guests) || r.guests < 1 || r.guests > MAX_GUESTS) return `Guests must be between 1 and ${MAX_GUESTS}`;
    if (!Number.isFinite(r.at)) return 'Choose the date and time';
    const before = this.reservation(r.id);
    if (!(before && before.at === r.at) && (r.at < Date.now() - 86400000 || r.at > Date.now() + 400 * 86400000)) return 'Choose a time from yesterday to a year ahead';
    if (r.tableId && !this.table(r.tableId)) return 'That table no longer exists';
    const clash = reservationConflict(this.data.reservations, r);
    if (clash) return `${this.table(r.tableId).name} is already booked ${fmtTime(clash.at)}–${fmtTime(reservationEnd(clash))} for ${clash.name}`;
    return '';
  },

  // Adds a booking, or replaces the fields of an existing one. Returns the stored booking.
  saveReservation(fields) {
    const existing = fields.id && this.reservation(fields.id);
    if (existing) {
      Object.assign(existing, fields);
      this.save();
      return existing;
    }
    const r = { status: 'booked', ...fields, id: uid('r_'), createdAt: Date.now(), createdBy: App.user ? App.user.id : null };
    this.data.reservations.push(r);
    this.save();
    return r;
  },

  setReservationStatus(id, status, extra = {}) {
    const r = this.reservation(id);
    if (!r) return null;
    r.status = status;
    Object.assign(r, extra);
    if (status === 'seated') { r.seatedAt = Date.now(); r.seatedBy = App.user ? App.user.id : null; }
    this.save();
    return r;
  },

  removeReservation(id) {
    this.data.reservations = this.data.reservations.filter(r => r.id !== id);
    this.save();
  },
});
