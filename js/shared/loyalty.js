'use strict';

// Customers and loyalty: points, member levels, expiry and the visit reward.
// Used by both the browser app (loaded as a script, see index.html) and the Node server (through js/shared.js).
(function (root) {
  // In Node the other shared modules are required; in the browser they are already on `window`.
  const shared = mod => (typeof module !== 'undefined' && module.exports ? require('./' + mod + '.js') : root);
  const { roundTo, decimalsOf } = shared('core');
  const { computeTotals } = shared('bill');

  // ----- customers and loyalty points -----
  // With loyalty on, a paid bill earns a % of the total as points (1 point = 1 unit of money, kept to the currency's
  // decimals), and a customer may pay part of a bill with points (at most `maxRedeemPercent` % of it). On top of that:
  //  - member levels: by total spent, a level can earn at a different % and give an automatic discount;
  //  - expiry: points lapse after `expiryMonths` without a visit (0 = never), checked when the customer next pays;
  //  - visit reward: every Nth visit gets an automatic discount.
  const DAY_MS = 86400000;

  function loyaltyOf(settings) {
    const l = (settings && settings.loyalty) || {};
    const tiers = (Array.isArray(l.tiers) ? l.tiers : [])
      .filter(t => t && typeof t.name === 'string' && t.name && Number(t.minSpent) >= 0)
      .map(t => ({
        name: t.name, minSpent: Number(t.minSpent),
        earnPercent: t.earnPercent === undefined || t.earnPercent === null || t.earnPercent === '' ? null : Number(t.earnPercent),
        discountPercent: Number(t.discountPercent) || 0,
      }))
      .sort((x, y) => x.minSpent - y.minSpent);
    const reward = l.visitReward || {};
    return {
      enabled: !!l.enabled, earnPercent: Number(l.earnPercent) || 0,
      maxRedeemPercent: l.maxRedeemPercent === undefined ? 50 : Number(l.maxRedeemPercent) || 0,
      tiers, expiryMonths: Math.max(0, Math.floor(Number(l.expiryMonths) || 0)),
      visitEvery: Math.max(0, Math.floor(Number(reward.every) || 0)), visitPercent: Number(reward.discountPercent) || 0,
    };
  }

  function floorTo(n, decimals) {
    const f = decimals === 0 ? 1 : 100;
    return Math.floor((Number(n) + 1e-9) * f) / f;
  }

  // The member level a customer has reached (null when there are none or loyalty is off).
  function tierOf(customer, settings) {
    const l = loyaltyOf(settings);
    if (!l.enabled) return null;
    let found = null;
    for (const t of l.tiers) if ((customer.spent || 0) >= t.minSpent) found = t;
    return found;
  }

  function nextTierOf(customer, settings) {
    const l = loyaltyOf(settings);
    return l.enabled ? l.tiers.find(t => t.minSpent > (customer.spent || 0)) || null : null;
  }

  // Points lapse when the customer has not visited for `expiryMonths`; they are cleared the next time the customer pays.
  function pointsLapsed(customer, settings, now = Date.now()) {
    const l = loyaltyOf(settings);
    return l.enabled && l.expiryMonths > 0 && !!customer.lastVisit && now - customer.lastVisit > l.expiryMonths * 30.4375 * DAY_MS;
  }

  // The points a customer can really use today.
  function pointsOf(customer, settings, now = Date.now()) {
    return pointsLapsed(customer, settings, now) ? 0 : customer.points || 0;
  }

  // The automatic discount a customer gets on their next bill: the best of their own, their level's, and a visit reward.
  function customerDiscount(customer, settings, now = Date.now()) {
    const l = loyaltyOf(settings);
    let best = (customer.discountPercent || 0) > 0 ? { percent: customer.discountPercent, reason: 'card' } : { percent: 0, reason: null };
    if (l.enabled) {
      const t = tierOf(customer, settings);
      if (t && t.discountPercent > best.percent) best = { percent: t.discountPercent, reason: 'level', tier: t.name };
      if (l.visitEvery > 0 && l.visitPercent > best.percent && ((customer.visits || 0) + 1) % l.visitEvery === 0) best = { percent: l.visitPercent, reason: 'visit' };
    }
    return best;
  }

  function loyaltyEarn(total, settings, customer) {
    const l = loyaltyOf(settings);
    if (!l.enabled) return 0;
    const t = customer && tierOf(customer, settings);
    const percent = t && t.earnPercent !== null ? t.earnPercent : l.earnPercent;
    return floorTo(total * percent / 100, decimalsOf(settings));
  }

  // The most points a bill can take: a share of the bill after discount, never more than the customer has.
  function maxRedeemable(order, customer, settings) {
    const l = loyaltyOf(settings);
    if (!l.enabled || !customer) return 0;
    const t = computeTotals({ ...order, pointsUsed: 0 }, settings);
    const room = floorTo((t.subtotal - t.discount) * l.maxRedeemPercent / 100, decimalsOf(settings));
    return Math.max(0, Math.min(room, floorTo(pointsOf(customer, settings), decimalsOf(settings))));
  }

  // At payment: points spent leave the balance, points earned join it, and the visit is counted.
  function applyLoyalty(order, customer, settings, now = Date.now()) {
    const dec = decimalsOf(settings);
    const used = order.totals && order.totals.points ? order.totals.points : 0;
    const base = pointsOf(customer, settings, now);
    const lapsed = roundTo((customer.points || 0) - base, dec);
    const tier = tierOf(customer, settings);
    const earned = loyaltyEarn(order.totals.total, settings, customer);
    const prevLastVisit = customer.lastVisit ?? null;
    customer.points = roundTo(base - used + earned, dec);
    customer.spent = roundTo((customer.spent || 0) + order.totals.total, dec);
    customer.visits = (customer.visits || 0) + 1;
    customer.lastVisit = now;
    order.loyalty = {
      customerId: customer.id, earned, used, balance: customer.points, prevLastVisit,
      ...(lapsed > 0 ? { expired: lapsed } : {}), ...(tier ? { tier: tier.name } : {}),
    };
  }

  function reverseLoyalty(order, customer, settings) {
    const dec = decimalsOf(settings);
    const { earned = 0, used = 0, expired = 0 } = order.loyalty || {};
    customer.points = Math.max(0, roundTo((customer.points || 0) - earned + used + expired, dec));
    customer.spent = Math.max(0, roundTo((customer.spent || 0) - (order.totals ? order.totals.total : 0), dec));
    customer.visits = Math.max(0, (customer.visits || 0) - 1);
    if (order.loyalty && 'prevLastVisit' in order.loyalty) customer.lastVisit = order.loyalty.prevLastVisit;
  }

  const api = { loyaltyOf, floorTo, tierOf, nextTierOf, pointsLapsed, pointsOf, customerDiscount, loyaltyEarn, maxRedeemable, applyLoyalty, reverseLoyalty };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
