'use strict';

// Staff hours: clocking in and out, and a manager's corrections to the time sheet (the rules are in js/shared/attendance.js,
// and the server checks them again; there it also sets the times, so a device's clock does not matter).
Object.assign(Store, {
  shift(id) { return this.data.attendance.find(e => e.id === id); },

  // The shift this person has not ended yet (it may be a forgotten one: see onShift).
  runningShift(userId) { return this.data.attendance.find(e => e.userId === userId && e.out == null) || null; },

  // The shift this person is on right now, or null. One left running for more than 16 hours does not count: it was forgotten.
  onShift(userId, now = Date.now()) {
    const e = this.runningShift(userId);
    return e && !attendanceUnsure(e, now) ? e : null;
  },

  // Clocks `user` in (a forgotten earlier shift is closed and flagged for a manager). Returns the new record.
  clockIn(user) {
    if (this.onShift(user.id)) return null;
    const old = this.runningShift(user.id);
    if (old) Object.assign(old, { out: old.in + 60000, autoClosed: true });
    const e = { id: uid('at_'), userId: user.id, userName: user.name, in: Date.now(), out: null, by: user.id };
    this.data.attendance.push(e);
    this.save();
    return e;
  },

  clockOut(user) {
    const e = this.onShift(user.id);
    if (!e) return null;
    e.out = Date.now();
    this.save();
    return e;
  },

  // What is wrong with this shift (a manager typing it in), in words for them, or '' when it can be saved.
  shiftProblem(e) {
    const problem = attendanceProblem(e);
    if (problem) return problem;
    const clash = attendanceOverlap(this.data.attendance, e);
    if (clash) return `This shift overlaps another one for ${e.userName} (${fmtDateTime(clash.in)}${clash.out ? ' – ' + fmtTime(clash.out) : ', still running'})`;
    return '';
  },

  // Adds a shift a manager typed in, or replaces the times of an existing one.
  saveShift(fields) {
    const existing = fields.id && this.shift(fields.id);
    const stamp = { edited: true, editedBy: App.user.id, editedAt: Date.now() };
    if (existing) {
      Object.assign(existing, fields, stamp);
      if (!fields.note) delete existing.note;
      if (!fields.breakMinutes) delete existing.breakMinutes;
      this.save();
      return existing;
    }
    const u = this.user(fields.userId);
    const e = { ...fields, id: uid('at_'), userName: u ? u.name : '', by: App.user.id, ...stamp };
    if (!e.note) delete e.note;
    if (!e.breakMinutes) delete e.breakMinutes;
    this.data.attendance.push(e);
    this.save();
    return e;
  },

  removeShift(id) {
    this.data.attendance = this.data.attendance.filter(e => e.id !== id);
    this.save();
  },
});
