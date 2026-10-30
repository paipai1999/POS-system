'use strict';

// Reservations: when a booking ends, which bookings clash, and which one a table should show.
// Used by both the browser app (loaded as a script, see index.html) and the Node server (through js/shared.js).
(function (root) {
  const RESERVATION_STATUSES = ['booked', 'seated', 'cancelled', 'noshow'];
  const DEFAULT_STAY = 90;          // minutes a booking holds its table unless the booking says otherwise
  const MIN_STAY = 15, MAX_STAY = 480, MAX_GUESTS = 50;

  const stayOf = r => { const n = Math.floor(Number(r && r.duration)); return n >= MIN_STAY && n <= MAX_STAY ? n : DEFAULT_STAY; };
  const reservationEnd = r => Number(r.at) + stayOf(r) * 60000;

  // The other booking that holds the same table at the same time as `cand`, or null. Only bookings still waiting for their
  // guests ("booked") hold a table; a seated, cancelled or no-show booking does not. A booking with no table clashes with nothing.
  function reservationConflict(list, cand) {
    if (!cand || !cand.tableId || cand.status !== 'booked') return null;
    const start = Number(cand.at), end = reservationEnd(cand);
    return (list || []).find(r => r.id !== cand.id && r.status === 'booked' && r.tableId === cand.tableId && Number(r.at) < end && start < reservationEnd(r)) || null;
  }

  // Bookings that start on the day beginning at `dayStart`, earliest first.
  function reservationsOnDay(list, dayStart) {
    const next = new Date(dayStart); next.setDate(next.getDate() + 1);
    return (list || []).filter(r => Number(r.at) >= dayStart && Number(r.at) < next.getTime()).sort((a, b) => a.at - b.at || String(a.name).localeCompare(String(b.name)));
  }

  // The booking a table should warn about: the earliest still-waiting booking for it that has not ended and starts within
  // `horizon` ms (a guest due soon, or one who is late and still expected).
  function nextReservation(list, tableId, now, horizon = 2 * 3600000) {
    return (list || []).filter(r => r.tableId === tableId && r.status === 'booked' && reservationEnd(r) > now && Number(r.at) <= now + horizon)
      .sort((a, b) => a.at - b.at)[0] || null;
  }

  const api = { RESERVATION_STATUSES, DEFAULT_STAY, MIN_STAY, MAX_STAY, MAX_GUESTS, stayOf, reservationEnd, reservationConflict, reservationsOnDay, nextReservation };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
