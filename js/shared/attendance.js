'use strict';

// Attendance: when staff were at work. A record is { userId, in, out (null while the person is still on shift), breakMinutes? }.
// Used by both the browser app (loaded as script) and the Node server (through js/shared.js).
(function (root) {
  const HOUR = 3600000;
  const MAX_SHIFT = 24 * HOUR;
  const MAX_BREAK = 600;                 // minutes of unpaid break a record may subtract
  const SLACK = 5 * 60000;               // a clock a few minutes fast is not "the future"
  const STALE = 16 * HOUR;               // still "on shift" after this long: almost certainly someone forgot to clock out

  const num = v => Number(v) || 0;

  // Paid hours of a record: its length less the unpaid break. A shift still running counts up to `now`.
  function shiftHours(e, now = Date.now()) {
    const end = e.out == null ? now : e.out;
    return Math.max(0, (end - e.in) / HOUR - num(e.breakMinutes) / 60);
  }

  // A shift that is running but has been for so long that the clock-out was surely forgotten.
  const forgotten = (e, now = Date.now()) => e.out == null && now - e.in > STALE;

  // Hours that cannot be trusted until a manager looks at them: a forgotten clock-out, or a shift the server closed itself
  // (when the person clocked in again without ever clocking out, `autoClosed`; the end it was given is only a placeholder).
  const attendanceUnsure = (e, now = Date.now()) => forgotten(e, now) || (!!e.autoClosed && !e.edited);

  // The other record of the same person that overlaps `e` in time, or null. A shift still running overlaps everything after it began.
  function attendanceOverlap(list, e) {
    const end = e.out == null ? Infinity : e.out;
    return (list || []).find(o => o.id !== e.id && o.userId === e.userId && o.in < end && (o.out == null ? Infinity : o.out) > e.in) || null;
  }

  // What is wrong with a record, in words for the person entering it, or '' when it is fine. (A clash with another record is
  // found with attendanceOverlap, which the caller words with its own time format.)
  function attendanceProblem(e, now = Date.now()) {
    if (!Number.isFinite(e.in)) return 'Choose when the shift started';
    if (e.in > now + SLACK) return 'A shift cannot start in the future';
    if (e.out != null) {
      if (!Number.isFinite(e.out)) return 'Choose when the shift ended';
      if (e.out <= e.in) return 'The shift must end after it starts';
      if (e.out - e.in > MAX_SHIFT) return 'A shift can be at most 24 hours';
      if (e.out > now + SLACK) return 'A shift cannot end in the future';
    }
    const brk = e.breakMinutes;
    if (brk !== undefined && brk !== null && brk !== '') {
      if (!Number.isInteger(Number(brk)) || brk < 0 || brk > MAX_BREAK) return `The break must be 0 to ${MAX_BREAK} minutes`;
      if (e.out != null && Number(brk) * 60000 >= e.out - e.in) return 'The break cannot be as long as the shift';
    }
    return '';
  }

  const api = { ATTENDANCE_STALE: STALE, ATTENDANCE_MAX_BREAK: MAX_BREAK, shiftHours, attendanceUnsure, attendanceOverlap, attendanceProblem };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
