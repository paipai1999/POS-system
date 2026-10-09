'use strict';

// Records that staff and guests create while the restaurant is running: guest requests, kitchen tickets and print jobs.
// They carry no money rules of their own; the server only checks who may write them.
const { reject, can, need } = require('../base.js');

function prepareGuestRequest(db, ctx, id, prev, data, deleted) {
  need(ctx.user, 'guest');
  return deleted ? null : data;
}

function prepareKitchenTicket(db, ctx, id, prev, data, deleted) {
  if (!can(ctx.user, 'tables') && !can(ctx.user, 'kitchen')) reject('You do not have permission to do that');
  return deleted ? null : data;
}

function preparePrintJob(db, ctx, id, prev, data, deleted) {
  need(ctx.user, 'tables');
  if (!deleted && typeof data.html !== 'string') reject('Invalid print job');
  return deleted ? null : data;
}

module.exports = { prepareGuestRequest, prepareKitchenTicket, preparePrintJob };
