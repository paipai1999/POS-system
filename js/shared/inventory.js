'use strict';

// Ingredients, recipes, purchases, stocktakes and the stock of items sold.
// Used by both the browser app (loaded as a script, see index.html) and the Node server (through js/shared.js).
(function (root) {
  // In Node the other shared modules are required; in the browser they are already on `window`.
  const shared = mod => (typeof module !== 'undefined' && module.exports ? require('./' + mod + '.js') : root);
  const { round4, roundTo } = shared('core');

  // ----- ingredients and recipes -----
  // A menu item can have a recipe: [{ ingredientId, qty }] = how much of each ingredient one portion uses.
  // Paying a bill uses up the ingredients (and remembers what was used and what it cost, so a refund puts back exactly that);
  // ingredient stock may go below zero, because the food was served anyway and a stocktake sets it right again.
  const recipeOf = product => (product && Array.isArray(product.recipe) ? product.recipe : []);

  // Cost of one portion at today's ingredient costs; null when the item has no recipe.
  function recipeCost(product, getIngredient) {
    const recipe = recipeOf(product);
    if (!recipe.length) return null;
    return round4(recipe.reduce((n, r) => n + r.qty * ((getIngredient(r.ingredientId) || {}).cost || 0), 0));
  }

  // What one unit of a bill line uses: the item's recipe plus whatever the options picked on it use (extra shot → more beans).
  // Returns [{ ingredientId, qty }] with each ingredient once.
  function usesOf(product, mods) {
    const total = new Map();
    const add = (id, qty) => total.set(id, (total.get(id) || 0) + qty);
    for (const r of recipeOf(product)) add(r.ingredientId, r.qty);
    for (const m of mods || []) {
      const option = ((product && product.options) || []).find(o => o.name === m.name);
      for (const u of (option && option.uses) || []) add(u.ingredientId, u.qty);
    }
    return [...total].map(([ingredientId, qty]) => ({ ingredientId, qty: round4(qty) }));
  }

  // What to do when an ingredient runs out: 'off' (nothing), 'warn' (show a warning on the dish) or 'block' (stop selling it).
  function ingredientStockMode(settings) {
    const m = settings && settings.ingredientStock;
    return m === 'warn' || m === 'block' ? m : 'off';
  }

  // Names of the watched ingredients of which there is not enough left for even one portion of the item's recipe.
  function lacksOf(product, getIngredient) {
    const out = [];
    for (const r of recipeOf(product)) {
      const ing = getIngredient(r.ingredientId);
      if (!ing || ing.watch === false || ing.active === false) continue;
      if ((ing.stock || 0) < r.qty) out.push(ing.name);
    }
    return out;
  }

  // Keeps `product.lacks` up to date (the list is what devices that are not sent ingredient figures rely on).
  // Returns the products that changed.
  function refreshLacks(products, getIngredient) {
    const changed = [];
    for (const p of products) {
      const lacks = lacksOf(p, getIngredient);
      if (JSON.stringify(lacks) === JSON.stringify(p.lacks || [])) continue;
      if (lacks.length) p.lacks = lacks; else delete p.lacks;
      changed.push(p);
    }
    return changed;
  }

  // How much of each ingredient a set of bill lines needs, as a Map of ingredientId -> amount.
  function ingredientNeeds(items, getProduct) {
    const need = new Map();
    for (const l of items) {
      for (const u of usesOf(getProduct(l.productId), l.mods)) need.set(u.ingredientId, (need.get(u.ingredientId) || 0) + u.qty * l.qty);
    }
    return need;
  }

  // Returns the ingredients that changed.
  function consumeIngredients(items, getProduct, getIngredient) {
    const changed = new Set();
    for (const l of items) {
      const recipe = usesOf(getProduct(l.productId), l.mods);
      delete l.used;
      delete l.cost;
      if (!recipe.length) continue;
      const used = [];
      let unitCost = 0;
      for (const r of recipe) {
        const ing = getIngredient(r.ingredientId);
        if (!ing) continue;
        const qty = round4(r.qty * l.qty);
        ing.stock = round4((ing.stock || 0) - qty);
        used.push({ ingredientId: ing.id, qty });
        unitCost += r.qty * (ing.cost || 0);
        changed.add(ing);
      }
      l.used = used;
      l.cost = round4(unitCost);
    }
    return [...changed];
  }

  function restoreIngredients(items, getIngredient) {
    const changed = new Set();
    for (const l of items) {
      for (const u of l.used || []) {
        const ing = getIngredient(u.ingredientId);
        if (!ing) continue;
        ing.stock = round4((ing.stock || 0) + u.qty);
        changed.add(ing);
      }
    }
    return [...changed];
  }

  // ----- purchases (stock coming in) and stocktakes (stock counted) -----
  // A purchase line is { ingredientId, qty, total } (total = what was paid for that quantity). Receiving it adds the stock and
  // moves the ingredient's cost to the weighted average of what was in stock and what was bought.
  function receivePurchase(purchase, getIngredient) {
    const changed = new Set();
    for (const l of purchase.lines) {
      const ing = getIngredient(l.ingredientId);
      if (!ing) continue;
      // Tax charged by the supplier (entered on the purchase) is not part of what the goods cost.
      const share = Number(purchase.total) > 0 ? Math.max(0, Number(purchase.total) - Number(purchase.taxAmount || 0)) / Number(purchase.total) : 1;
      const unitCost = l.qty > 0 ? l.total * share / l.qty : 0;
      const had = Math.max(ing.stock || 0, 0);
      ing.cost = had + l.qty > 0 ? round4((had * (ing.cost || 0) + l.qty * unitCost) / (had + l.qty)) : round4(unitCost);
      ing.stock = round4((ing.stock || 0) + l.qty);
      l.name = ing.name;
      l.unit = ing.unit;
      l.unitCost = round4(unitCost);
      changed.add(ing);
    }
    return [...changed];
  }

  // Voiding a purchase takes the stock back out; the average cost is left as it is.
  function voidPurchase(purchase, getIngredient) {
    const changed = new Set();
    for (const l of purchase.lines) {
      const ing = getIngredient(l.ingredientId);
      if (!ing) continue;
      ing.stock = round4((ing.stock || 0) - l.qty);
      changed.add(ing);
    }
    return [...changed];
  }

  // A stocktake line is { kind: 'ingredient' | 'product', refId, counted }. Fills in what was expected, the difference and its
  // value, and sets the stock to the counted figure. Returns { changed, value } (value is negative for a loss).
  function applyStocktake(stocktake, getIngredient, getProduct, decimals = 2) {
    const changed = new Set();
    let value = 0;
    for (const l of stocktake.lines) {
      const target = l.kind === 'product' ? getProduct(l.refId) : getIngredient(l.refId);
      if (!target) continue;
      const unitCost = l.kind === 'product' ? 0 : target.cost || 0;
      l.name = target.name;
      l.unit = l.kind === 'product' ? 'pcs' : target.unit;
      l.expected = round4(target.stock || 0);
      l.counted = round4(l.counted);
      l.diff = round4(l.counted - l.expected);
      l.value = roundTo(l.diff * unitCost, decimals);
      value += l.diff * unitCost;
      target.stock = l.counted;
      changed.add(target);
    }
    return { changed: [...changed], value: roundTo(value, decimals) };
  }

  // ----- stock -----
  // Stock is taken once, at payment, and a refund returns exactly what was taken. Used by both the browser (single-device
  // mode) and the server, so the two cannot drift apart. `getProduct(id)` returns the product object to change (or null).
  // Returns the products that changed.
  function takeStockLines(items, getProduct) {
    const changed = new Set();
    for (const l of items) {
      const p = getProduct(l.productId);
      if (!p || !p.trackStock) continue;
      l.stockTaken = Math.min(p.stock, l.qty);
      p.stock -= l.stockTaken;
      changed.add(p);
    }
    return [...changed];
  }

  function returnStockLines(items, getProduct) {
    const changed = new Set();
    for (const l of items) {
      const p = getProduct(l.productId);
      if (!p || !p.trackStock) continue;
      p.stock += l.stockTaken ?? l.qty;
      changed.add(p);
    }
    return [...changed];
  }

  const api = { recipeOf, recipeCost, usesOf, ingredientStockMode, lacksOf, refreshLacks, ingredientNeeds, consumeIngredients, restoreIngredients, receivePurchase, voidPurchase, applyStocktake, takeStockLines, returnStockLines };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
