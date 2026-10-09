'use strict';

// Staff accounts: roles, PINs (stored hashed) and keeping at least one active admin.
const { ROLES } = require('../../js/shared.js');
const { reject, need } = require('../base.js');
const { hashPin, pinMatches, hasPin } = require('../pins.js');

function prepareUser(db, ctx, id, prev, data, deleted) {
  need(ctx.user, 'users');
  const others = db.all('users').filter(u => u.id !== id);
  if (deleted) {
    if (id === ctx.user.id) reject('You cannot delete yourself');
    if (!others.some(u => u.role === 'admin' && u.active)) reject('At least one active admin is required');
    const used = db.where('orders', "json_extract(data, '$.staffId') = ? OR json_extract(data, '$.cashierId') = ?", id, id);
    if (used.length) reject('This person has order history. Deactivate them instead so reports stay accurate.');
    db.deleteUserSessions(id);
    return null;
  }
  if (typeof data.name !== 'string' || !data.name.trim()) reject('Name is required');
  if (!ROLES[data.role]) reject('Invalid role');
  data.active = !!data.active;
  // A device can only ever send digits; the stored hash is never taken from the request.
  const newPin = data.pin ? String(data.pin) : '';
  delete data.pin;
  delete data.pinHash;
  if (newPin) {
    if (!/^\d{4,6}$/.test(newPin)) reject('PIN must be 4–6 digits');
    if (others.some(u => pinMatches(u, newPin))) reject('That PIN is already used by someone else');
    data.pinHash = hashPin(newPin);
  } else if (hasPin(prev)) {
    data.pinHash = typeof prev.pinHash === 'string' ? prev.pinHash : hashPin(prev.pin);
  } else {
    reject('Set a PIN');
  }
  if (!others.some(u => u.role === 'admin' && u.active) && !(data.role === 'admin' && data.active)) {
    reject('At least one active admin is required');
  }
  if (id === ctx.user.id && !data.active) reject('You cannot deactivate yourself');
  if (!data.active) db.deleteUserSessions(id);
  return data;
}

module.exports = { prepareUser };
