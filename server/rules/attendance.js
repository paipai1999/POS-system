'use strict';

// Attendance: staff clocking in and out, and a manager correcting the record.
// Anyone signed in can clock themselves in and out, and only themselves. The server's clock decides when: a device cannot
// choose its own times. A recorded shift can only be changed or deleted by a manager (a forgotten clock-out, a missed shift),
// and every such change is written to the activity log.
const { attendanceProblem, attendanceOverlap, ATTENDANCE_MAX_BREAK } = require('../../js/shared.js');
const { reject, need, can, cleanText } = require('../base.js');

const clock = t => new Date(t).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });

function prepareAttendance(db, ctx, id, prev, data, deleted) {
  const me = ctx.user;
  if (!me || !me.active) reject('You do not have permission to do that');
  const manager = can(me, 'manage');
  const all = db.all('attendance');
  const now = Date.now();

  if (deleted) { need(me, 'manage'); return null; }

  let doc;
  if (!prev) {
    const forSomeoneElse = data.userId && data.userId !== me.id;
    if (forSomeoneElse) {
      // A manager adds a shift that was missed.
      need(me, 'manage');
      const person = typeof data.userId === 'string' ? db.doc('users', data.userId) : null;
      if (!person) reject('That person no longer exists');
      doc = { id, userId: person.id, userName: person.name, in: Number(data.in), out: data.out == null ? null : Number(data.out), by: me.id, edited: true };
    } else {
      // Clocking in: now, for yourself.
      if (all.some(e => e.userId === me.id && e.out == null)) reject('You are already clocked in');
      doc = { id, userId: me.id, userName: me.name, in: now, out: null, by: me.id };
      if (data.out != null) reject('Clock out when the shift is over');
    }
  } else if (!manager) {
    // The only change a person can make is to end their own running shift.
    if (prev.userId !== me.id || prev.out != null) reject('Only a manager can change a recorded shift');
    if (data.out == null) reject('Only a manager can change a recorded shift');
    return { ...prev, out: now };
  } else {
    doc = { ...prev, in: Number(data.in), out: data.out == null ? null : Number(data.out), edited: true, editedBy: me.id, editedAt: now };
  }

  const note = cleanText(data.note, 200);
  if (note) doc.note = note; else delete doc.note;
  const brk = data.breakMinutes === undefined || data.breakMinutes === null || data.breakMinutes === '' ? 0 : Number(data.breakMinutes);
  if (brk && (doc.edited || (prev && manager))) doc.breakMinutes = brk; else delete doc.breakMinutes;
  if (brk > ATTENDANCE_MAX_BREAK) reject(`The break must be 0 to ${ATTENDANCE_MAX_BREAK} minutes`);

  const problem = attendanceProblem(doc, now);
  if (problem) reject(problem);
  const clash = attendanceOverlap(all, doc);
  if (clash) reject(`This shift overlaps another one for ${doc.userName} (${clock(clash.in)}${clash.out ? ' – ' + clock(clash.out) : ', still running'})`);
  return doc;
}

module.exports = { prepareAttendance };
