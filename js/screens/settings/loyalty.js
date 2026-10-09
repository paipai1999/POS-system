'use strict';

// Settings: customer loyalty - points, member levels (by total spent), expiry and the visit reward.
Object.assign(Screens.settings, {
  loyaltyHTML(s) {
    return `
      <label class="check"><input type="checkbox" name="loyaltyEnabled" ${loyaltyOf(s).enabled ? 'checked' : ''}> Customer loyalty points</label>
      <div class="grid-2">
        <label class="field"><span>Points earned (% of each bill)</span><input class="input" name="earnPercent" type="number" min="0" max="100" step="0.5" value="${loyaltyOf(s).earnPercent}"></label>
        <label class="field"><span>Most of a bill points can pay (%)</span><input class="input" name="maxRedeemPercent" type="number" min="0" max="100" step="1" value="${loyaltyOf(s).maxRedeemPercent}"></label>
      </div>
      <p class="muted small">With points on, a customer chosen at checkout earns points on the bill and can pay part of a later bill with them. 1 point is worth 1 ${esc(s.currency)}.</p>
      <div class="grid-2">
        <label class="field"><span>Points lapse after (months without a visit, 0 = never)</span><input class="input" name="expiryMonths" type="number" min="0" max="120" step="1" value="${loyaltyOf(s).expiryMonths}"></label>
        <label class="field"><span>Reward every … visits (0 = off)</span><input class="input" name="visitEvery" type="number" min="0" step="1" value="${loyaltyOf(s).visitEvery}"></label>
      </div>
      <label class="field"><span>Discount on a rewarded visit (%)</span><input class="input" name="visitPercent" type="number" min="0" max="100" step="0.5" value="${loyaltyOf(s).visitPercent}"></label>
      <div class="field-label">Member levels (by total spent)</div>
      <div data-role="tiers">${this.tierRows()}</div>
      <button class="btn small" data-act="tier-add" ${this.tiers.length >= 6 ? 'disabled' : ''}>＋ Add a level</button>
      <p class="muted small">A level earns its own % of each bill (leave blank to use the standard one) and can give an automatic discount.</p>`;
  },

  tierRows() {
    return this.tiers.map((t, i) => `
      <div class="tier-row" data-i="${i}">
        <input class="input" data-f="name" placeholder="Level name" maxlength="20" value="${esc(t.name)}">
        <input class="input" data-f="minSpent" type="number" min="0" step="any" placeholder="From spent" value="${esc(t.minSpent)}">
        <input class="input" data-f="earnPercent" type="number" min="0" max="100" step="0.5" placeholder="Earn %" value="${esc(t.earnPercent ?? '')}">
        <input class="input" data-f="discountPercent" type="number" min="0" max="100" step="0.5" placeholder="Discount %" value="${esc(t.discountPercent ?? '')}">
        <button class="icon-btn" data-act="tier-del" data-i="${i}" aria-label="Remove">✕</button>
      </div>`).join('') || '<p class="muted small">No levels yet.</p>';
  },

  // Checks the loyalty part of the form and returns the loyalty settings (throws an Error with a message for the person).
  readLoyalty(v) {
    const earn = parseFloat(v.earnPercent), redeem = parseFloat(v.maxRedeemPercent);
    if (!(earn >= 0 && earn <= 100) || !(redeem >= 0 && redeem <= 100)) throw new Error('Loyalty percentages must be between 0 and 100');
    const months = parseInt(v.expiryMonths, 10) || 0, every = parseInt(v.visitEvery, 10) || 0, visitPct = parseFloat(v.visitPercent) || 0;
    if (months < 0 || every < 0 || !(visitPct >= 0 && visitPct <= 100)) throw new Error('Check the points expiry and the visit reward');
    const tiers = [];
    for (const t of this.tiers) {
      if (!t.name.trim() && t.minSpent === '' && t.earnPercent === '' && t.discountPercent === '') continue; // an empty row
      const level = { name: t.name.trim(), minSpent: parseFloat(t.minSpent), earnPercent: t.earnPercent === '' || t.earnPercent === null ? null : parseFloat(t.earnPercent), discountPercent: parseFloat(t.discountPercent) || 0 };
      if (!level.name || !(level.minSpent >= 0)) throw new Error('Each member level needs a name and the amount spent to reach it');
      if (tiers.some(x => x.name === level.name || x.minSpent === level.minSpent)) throw new Error('Member levels need different names and different amounts');
      if ((level.earnPercent !== null && !(level.earnPercent >= 0 && level.earnPercent <= 100)) || !(level.discountPercent >= 0 && level.discountPercent <= 100)) throw new Error('Level percentages must be between 0 and 100');
      tiers.push(level);
    }
    return { enabled: v.loyaltyEnabled, earnPercent: earn, maxRedeemPercent: redeem, expiryMonths: months, visitReward: { every, discountPercent: visitPct }, tiers };
  }
});
