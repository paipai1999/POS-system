'use strict';

// Table reservations: who is coming, when, for how many, and which table is held for them.
// Anyone who works the floor may take, change, cancel or seat a booking; only a manager can delete one or bring back a
// booking that was already seated, cancelled or marked as a no-show. Two waiting bookings may not hold the same table at the
// same time; the server checks it so two devices booking at once cannot double-book.
const { RESERVATION_STATUSES, MAX_GUESTS, MIN_STAY, MAX_STAY, stayOf, reservationEnd, reservationConflict } = require('../../js/shared.js');
const { reject, need, can, cleanText } = require('../base.js');

const DAY = 24 * 60 * 60 * 1000;
const clock = ts => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function prepareReservation(db, ctx, id, prev, data, deleted) {
  need(ctx.user, 'tables');
  if (deleted) { need(ctx.user, 'manage'); return null; }

  const name = cleanText(data.name, 60);
  if (!name) reject('Enter the name the table is booked under');
  const phone = cleanText(data.phone, 30);
  if (phone && !/^[0-9+\-() ]{3,30}$/.test(phone)) reject('Enter the phone number with digits only');
  const guests = Number(data.guests);
  if (!Number.isInteger(guests) || guests < 1 || guests > MAX_GUESTS) reject(`Guests must be between 1 and ${MAX_GUESTS}`);
  const at = Number(data.at);
  if (!Number.isFinite(at)) reject('Choose the date and time');
  // A booking may be written for any time up to a year ahead, and for the past day (a walk-in that is entered afterwards).
  // One that already exists keeps its time even if that is now long gone.
  if (!(prev && prev.at === at) && (at < Date.now() - DAY || at > Date.now() + 400 * DAY)) reject('Choose a time from yesterday to a year ahead');
  const duration = data.duration === undefined || data.duration === null || data.duration === '' ? 0 : Math.floor(Number(data.duration));
  if (duration && !(duration >= MIN_STAY && duration <= MAX_STAY)) reject(`The table is held for ${MIN_STAY} to ${MAX_STAY} minutes`);

  let tableId = data.tableId || null;
  let table = null;
  if (tableId) {
    table = typeof tableId === 'string' ? db.doc('tables', tableId) : null;
    if (!table) reject('That table no longer exists');
  }

  const status = data.status === undefined ? 'booked' : data.status;
  if (!RESERVATION_STATUSES.includes(status)) reject('Invalid status');
  const before = prev ? prev.status : null;
  // Once a booking is seated, cancelled or marked no-show it stays so, unless a manager says otherwise.
  if (before && before !== 'booked' && status !== before && !can(ctx.user, 'manage')) reject('Only a manager can change a booking that was already seated, cancelled or marked as a no-show');

  const doc = {
    id, name, phone, guests, at, duration: duration || undefined, tableId, note: cleanText(data.note, 200), status,
    createdAt: prev ? prev.createdAt : Date.now(), createdBy: prev ? prev.createdBy : ctx.user.id,
  };
  if (!doc.duration) delete doc.duration;
  if (status === 'seated') {
    doc.seatedAt = before === 'seated' && prev.seatedAt ? prev.seatedAt : Date.now();
    doc.seatedBy = before === 'seated' && prev.seatedBy ? prev.seatedBy : ctx.user.id;
    if (typeof data.orderId === 'string' && data.orderId.length <= 80) doc.orderId = data.orderId;
    else if (prev && prev.orderId) doc.orderId = prev.orderId;
  }

  const clash = reservationConflict(db.all('reservations'), doc);
  if (clash) {
    reject(`${table ? table.name : 'That table'} is already booked ${clock(clash.at)}–${clock(reservationEnd(clash))} for ${clash.name}`);
  }
  return doc;
}

module.exports = { prepareReservation };
