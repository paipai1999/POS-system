'use strict';

// Staff hours: who worked how long in a period, what that cost in wages, and who forgot to clock out.
// A shift belongs to the day it started (a night shift is not split at midnight). A shift still running counts up to now; one
// that has been "running" for more than 16 hours was almost certainly forgotten, and so is one the server closed itself when
// the person clocked in again; both count for nothing until a manager has set the real end, and are listed so it gets done. Pay is hours × the person's hourly rate (Staff → Edit), when a rate is set.
// Used by both the browser (loaded as a script, see index.html) and the Node server (through js/finance.js).
(function (root) {
  const inNode = typeof module !== 'undefined' && module.exports;
  const { roundTo, decimalsOf, shiftHours, attendanceUnsure } = inNode ? require('../shared.js') : root;

  const pad = n => String(n).padStart(2, '0');
  const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

  function attendanceReport(range, data, settings, now = Date.now()) {
    const [a, b] = range;
    const dec = decimalsOf(settings);
    const users = new Map((data.users || []).map(u => [u.id, u]));
    const entries = (data.attendance || []).filter(e => e && Number.isFinite(e.in) && e.in >= a && e.in < b);

    const byPerson = new Map();
    const person = e => {
      if (!byPerson.has(e.userId)) {
        const u = users.get(e.userId);
        const rate = u && Number(u.hourlyRate) > 0 ? Number(u.hourlyRate) : null;
        byPerson.set(e.userId, { userId: e.userId, name: (u && u.name) || e.userName || 'Unknown', role: u ? u.role : null, rate, shifts: 0, days: new Set(), hours: 0, onShift: false, forgotten: 0, edited: 0 });
      }
      return byPerson.get(e.userId);
    };

    const rows = [];
    const byDay = new Map();
    for (const e of entries) {
      const p = person(e);
      const running = e.out == null;
      const forgotten = attendanceUnsure(e, now);        // hours that count for nothing until a manager has looked
      const hours = forgotten ? 0 : shiftHours(e, now);
      p.shifts++; p.days.add(dayKey(e.in)); p.hours += hours;
      if (running && !forgotten) p.onShift = true;
      if (forgotten) p.forgotten++;
      if (e.edited) p.edited++;
      const day = byDay.get(dayKey(e.in)) || { date: dayKey(e.in), hours: 0, people: new Set() };
      day.hours += hours; day.people.add(e.userId); byDay.set(day.date, day);
      rows.push({ ...e, name: p.name, hours, running, forgotten });
    }

    const people = [...byPerson.values()].map(p => ({
      userId: p.userId, name: p.name, role: p.role, rate: p.rate, shifts: p.shifts, days: p.days.size,
      hours: roundTo(p.hours, 2), avgShift: p.shifts ? roundTo(p.hours / p.shifts, 2) : 0,
      wages: p.rate ? roundTo(p.hours * p.rate, dec) : null,
      onShift: p.onShift, forgotten: p.forgotten, edited: p.edited,
    })).sort((x, y) => y.hours - x.hours || x.name.localeCompare(y.name));

    const hours = roundTo(people.reduce((n, p) => n + p.hours, 0), 2);
    const paid = people.filter(p => p.wages !== null);
    return {
      range: [a, b], people, shifts: rows.sort((x, y) => y.in - x.in),
      days: [...byDay.values()].sort((x, y) => x.date.localeCompare(y.date)).map(d => ({ date: d.date, hours: roundTo(d.hours, 2), people: d.people.size })),
      hours,
      wages: roundTo(paid.reduce((n, p) => n + p.wages, 0), dec),
      withoutRate: people.filter(p => p.rate === null && p.hours > 0).map(p => p.name),   // wages for these cannot be worked out
      forgotten: rows.filter(r => r.forgotten),
      onShift: people.filter(p => p.onShift).map(p => p.name),
    };
  }

  const api = { attendanceReport };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Finance = Object.assign(root.Finance || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
