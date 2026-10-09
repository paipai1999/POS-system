'use strict';

// Small pieces shared by the server's rule files (sync.js, ledger.js).
const { ROLES } = require('../js/shared.js');

class Rejection extends Error {}
const reject = msg => { throw new Rejection(msg); };

function can(user, perm) {
  return !!user && user.active && !!ROLES[user.role] && ROLES[user.role].perms.includes(perm);
}

function need(user, perm) {
  if (!can(user, perm)) reject('You do not have permission to do that');
}

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

// Text from a device: control characters out, trimmed, cut to length. Anything that is not text or a number is empty.
const cleanText = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

module.exports = { Rejection, reject, can, need, isObj, cleanText };
