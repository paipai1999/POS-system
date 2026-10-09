'use strict';

// Rules for the single settings document (shop name, money format, tax, ingredient stock, finance setup, loyalty).
// Only an admin may change it. Everything is checked again here because the browser's checks can be bypassed.
const { roundTo, decimalsOf } = require('../../js/shared.js');
const { reject, need, isObj, cleanText } = require('../base.js');

// The currency symbol ends up in every page and receipt, so markup characters are removed.
function cleanMoneyFormat(data) {
  data.currency = String(data.currency ?? '$').replace(/[<>&"'`]/g, '').trim().slice(0, 4) || '$';
  data.decimals = data.decimals === 0 ? 0 : 2;
  data.currencyAfter = !!data.currencyAfter;
}

// Opening balances (as of a start date) and the list of expense categories used by the financial statements.
function cleanFinance(data) {
  const f = isObj(data.finance) ? data.finance : {};
  const open = v => {
    const n = roundTo(Number(v) || 0, decimalsOf(data));
    if (!(n > -1e12 && n < 1e12)) reject('Check the opening balances');
    return n;
  };
  const categories = [...new Set((Array.isArray(f.categories) ? f.categories : []).map(c => cleanText(c, 30)).filter(Boolean))];
  if (categories.length > 40) reject('At most 40 expense categories');
  const start = Number(f.startDate) || 0;
  if (start < 0 || start > Date.now() + 86400000) reject('Check the date the opening balances are for');
  data.finance = { openingCash: open(f.openingCash), openingBank: open(f.openingBank), startDate: Math.floor(start), categories };
}

// Loyalty: earn %, how much of a bill points can pay, member levels (by total spent), points expiry and the visit reward.
function cleanLoyalty(data) {
  const l = isObj(data.loyalty) ? data.loyalty : {};
  const pct = (v, fallback) => { const n = Number(v); return n >= 0 && n <= 100 ? roundTo(n, 2) : fallback; };
  const rawTiers = Array.isArray(l.tiers) ? l.tiers : [];
  if (rawTiers.length > 6) reject('At most 6 member levels');
  const seen = new Set();
  const tiers = rawTiers.map(t => {
    const name = isObj(t) ? cleanText(t.name, 20) : '';
    const minSpent = isObj(t) ? roundTo(Number(t.minSpent), decimalsOf(data)) : NaN;
    const earn = isObj(t) && t.earnPercent !== null && t.earnPercent !== undefined && t.earnPercent !== '' ? Number(t.earnPercent) : null;
    const disc = isObj(t) ? Number(t.discountPercent) || 0 : 0;
    if (!name || !(minSpent >= 0) || (earn !== null && !(earn >= 0 && earn <= 100)) || !(disc >= 0 && disc <= 100)) {
      reject('Each member level needs a name, a spending amount, and percentages between 0 and 100');
    }
    if (seen.has(minSpent) || seen.has(name)) reject('Member levels must have different names and different spending amounts');
    seen.add(minSpent); seen.add(name);
    return { name, minSpent, earnPercent: earn === null ? null : roundTo(earn, 2), discountPercent: roundTo(disc, 2) };
  }).sort((x, y) => x.minSpent - y.minSpent);
  const reward = isObj(l.visitReward) ? l.visitReward : {};
  const months = Math.floor(Number(l.expiryMonths) || 0);
  const every = Math.floor(Number(reward.every) || 0);
  if (months < 0 || months > 120 || every < 0 || every > 1000) reject('Check the points expiry and visit reward numbers');
  data.loyalty = {
    enabled: !!l.enabled, earnPercent: pct(l.earnPercent, 5), maxRedeemPercent: pct(l.maxRedeemPercent, 50),
    tiers, expiryMonths: months, visitReward: { every, discountPercent: pct(reward.discountPercent, 0) },
  };
}

function prepareSettings(db, ctx, id, prev, data, deleted) {
  need(ctx.user, 'settings');
  if (deleted) reject('Settings cannot be deleted');
  delete data.nextOrderNo;   // the order counter belongs to the server
  cleanMoneyFormat(data);
  data.ingredientStock = ['off', 'warn', 'block'].includes(data.ingredientStock) ? data.ingredientStock : 'off';
  cleanFinance(data);
  cleanLoyalty(data);
  return data;
}

module.exports = { prepareSettings };
