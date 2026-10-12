'use strict';

// Who is calling: session tokens, protection against guessing PINs, and manager approvals.
const { HttpError } = require('./http/util.js');

const APPROVAL_TTL = 10 * 60 * 1000;   // a manager's PIN approval is good for 10 minutes on the session it was entered in
const LOCK_AFTER = 5;                  // wrong PINs in a row from one address…
const LOCK_FOR = 30 * 1000;            // …lock it for this long
const PIN_CHANGES = 5;                 // a signed-in person may try this many new PINs…
const PIN_CHANGE_WINDOW = 10 * 60 * 1000;   // …within this time (see pinChangeAttempt)

function createAuth(db) {
  const failures = new Map();     // ip -> { n, until }
  const approvals = new Map();    // session token -> Map(managerId -> time the manager entered their PIN)
  const pinChanges = new Map();   // user id -> times of their recent attempts to choose a new PIN

  // Throws while an address is locked out after too many wrong PINs.
  function checkLock(ip) {
    const f = failures.get(ip);
    if (f && f.until > Date.now()) throw new HttpError(429, 'Too many wrong PINs. Wait 30 seconds and try again.');
  }

  function pinFailed(ip, who = '') {
    const f = failures.get(ip) || { n: 0, until: 0 };
    f.n++;
    if (f.n >= LOCK_AFTER) {
      f.n = 0;
      f.until = Date.now() + LOCK_FOR;
      db.addAudit({ action: 'sign-in blocked', target: who, detail: `${LOCK_AFTER} wrong PINs in a row from ${ip}; locked for 30 seconds` });
    }
    failures.set(ip, f);
  }

  // Choosing a PIN that a colleague already has is refused ("already used"), so every attempt is a yes/no question about
  // everyone else's PIN. Without a limit, any signed-in person could ask it for all 10,000 four-digit PINs in minutes and
  // never trip the sign-in lock. This allows a few attempts per person per window; call it once per attempt.
  function pinChangeAttempt(userId) {
    const now = Date.now();
    const recent = (pinChanges.get(userId) || []).filter(t => now - t < PIN_CHANGE_WINDOW);
    if (recent.length >= PIN_CHANGES) {
      pinChanges.set(userId, recent);
      throw new HttpError(429, 'Too many PIN changes. Wait a few minutes and try again.');
    }
    recent.push(now);
    pinChanges.set(userId, recent);
  }

  // The signed-in person for a request (Bearer token, or ?token= for event streams), or null.
  function authenticate(req, url) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : url.searchParams.get('token');
    const s = db.session(token);
    if (!s) return null;
    const user = db.doc('users', s.userId);
    if (!user || !user.active) return null;
    return { token: s.token, user };
  }

  // A manager typed their PIN on this session: they may approve a void, refund or discount for a while.
  function approve(token, managerId) {
    if (!approvals.has(token)) approvals.set(token, new Map());
    approvals.get(token).set(managerId, Date.now());
  }

  function hasApproval(token, managerId) {
    const t = approvals.get(token)?.get(managerId);
    return !!t && Date.now() - t < APPROVAL_TTL;
  }

  // Everyone whose PIN was entered on this session recently, newest first (for approvals that name no one in particular).
  function approvers(token) {
    return [...(approvals.get(token) || [])].filter(([, t]) => Date.now() - t < APPROVAL_TTL).sort((a, b) => b[1] - a[1]).map(([id]) => id);
  }

  return {
    checkLock, pinFailed, pinChangeAttempt,
    clearFailures: ip => failures.delete(ip),
    authenticate, approve, hasApproval, approvers,
    forget: token => approvals.delete(token),
    forgetAll: () => approvals.clear(),
  };
}

module.exports = { createAuth };
