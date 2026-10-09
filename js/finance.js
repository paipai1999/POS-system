'use strict';

// Node entry point for the financial statements.
// The code itself lives in js/finance/ (one file per statement); the browser loads those files directly (see index.html)
// and finds everything on the `Finance` global, while Node gathers them here:
//   const F = require('./js/finance.js');   F.profitAndLoss(range, data, settings)
//
//   core.js         dates, channels, which records count in a period, the finance setup
//   profit-loss.js  revenue, cost of goods, expenses and profit
//   cash-flow.js    money in and out by cash / card / other
//   tax.js          tax charged on sales and tax paid on purchases and expenses
//   controls.js     discounts, refunds and voids by person
//   position.js     cash and bank, stock on the shelf, and what is owed
//   daily.js        the figures frozen by the daily close
//   recurring.js    monthly expenses that repeat (rent, salaries)
//   receivables.js  what customers owe for bills on account: statements and ageing
module.exports = Object.assign({},
  require('./finance/core.js'),
  require('./finance/profit-loss.js'),
  require('./finance/cash-flow.js'),
  require('./finance/tax.js'),
  require('./finance/controls.js'),
  require('./finance/position.js'),
  require('./finance/daily.js'),
  require('./finance/recurring.js'),
  require('./finance/receivables.js')
);
