'use strict';

// Node entry point for the code shared by the browser app and the server.
// The code itself lives in js/shared/ (one file per area); the browser loads those files directly (see index.html),
// while Node gathers them here:  const { computeTotals, ROLES, ... } = require('./js/shared.js');
module.exports = Object.assign({},
  require('./shared/core.js'),
  require('./shared/bill.js'),
  require('./shared/inventory.js'),
  require('./shared/loyalty.js'),
  require('./shared/payments.js'),
  require('./shared/shifts.js'),
  require('./shared/dataset.js')
);
