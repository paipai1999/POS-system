'use strict';

// Sends each /api request to the right handler:
//   public.js  no sign-in needed (status, sign-in, guest menu, printer stations)
//   staff.js   any signed-in person
//   admin.js   admins only
const rules = require('../rules');
const { HttpError } = require('../http/util.js');
const { hasDemoPin, DEMO_PINS } = require('../pins.js');
const publicRoutes = require('./public.js');
const staffRoutes = require('./staff.js');
const adminRoutes = require('./admin.js');

// A person still using a PIN that came with the demo data may do nothing but choose their own PIN (or sign out).
// The screen asks for it too, but only the server can make sure nobody carries on with a PIN that anyone could guess.
const BEFORE_OWN_PIN = new Set(['POST /api/me/pin', 'POST /api/logout']);

async function handleApi(app, req, res, url) {
  const route = `${req.method} ${url.pathname}`;

  if (Object.hasOwn(publicRoutes, route)) return publicRoutes[route](app, req, res, url);
  if (!url.pathname.startsWith('/api/')) throw new HttpError(404, 'Not found');

  const session = app.auth.authenticate(req, url);
  if (!session) throw new HttpError(401, 'Please sign in again');
  if (!app.allowDemoPins && !BEFORE_OWN_PIN.has(route) && hasDemoPin(session.user, DEMO_PINS)) {
    throw new HttpError(403, 'Please choose your own PIN first');
  }
  if (Object.hasOwn(staffRoutes, route)) return staffRoutes[route](app, req, res, url, session);

  if (!rules.can(session.user, 'settings')) throw new HttpError(403, 'Only an admin can do that');
  if (Object.hasOwn(adminRoutes, route)) return adminRoutes[route](app, req, res, url, session);
  throw new HttpError(404, 'Not found');
}

module.exports = { handleApi };
