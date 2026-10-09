'use strict';

// Turns a change to a document into short, readable audit entries ("Latte: price 4 → 4.5").
// Only things an owner would want to trace are recorded: money, prices, stock, staff, settings, voids and refunds.

const num = n => (typeof n === 'number' ? String(Math.round(n * 100) / 100) : String(n ?? '–'));
const diff = (label, a, b) => (a !== b ? [`${label} ${num(a)} → ${num(b)}`] : []);

function describe(col, prev, next, deleted, nameOf = () => null) {
  const out = [];
  const add = (action, target, detail = '') => out.push({ action, target, detail });
  const who = id => (typeof id === 'string' && nameOf(id)) || id || '–';

  switch (col) {
    case 'products': {
      if (deleted) return [{ action: 'item deleted', target: prev?.name || '', detail: `price ${num(prev?.price)}` }];
      if (!prev) return [{ action: 'item created', target: next.name, detail: `price ${num(next.price)}` }];
      const d = [
        ...diff('price', prev.price, next.price),
        ...(prev.name !== next.name ? [`renamed from "${prev.name}"`] : []),
        ...(prev.active !== next.active ? [next.active ? 'put on sale' : 'taken off sale'] : []),
        ...(prev.trackStock !== next.trackStock ? [next.trackStock ? 'stock tracking on' : 'stock tracking off'] : []),
        ...(next.trackStock || prev.trackStock ? diff('stock', prev.stock, next.stock) : []),
      ];
      if (d.length) add(d.some(x => x.startsWith('price')) ? 'price changed' : 'item edited', next.name, d.join('; '));
      break;
    }
    case 'users': {
      if (deleted) return [{ action: 'staff deleted', target: prev?.name || '', detail: prev?.role || '' }];
      if (!prev) return [{ action: 'staff created', target: next.name, detail: next.role }];
      const d = [
        ...(prev.role !== next.role ? [`role ${prev.role} → ${next.role}`] : []),
        ...(prev.active !== next.active ? [next.active ? 'activated' : 'deactivated'] : []),
        ...(prev.name !== next.name ? [`renamed from "${prev.name}"`] : []),
        ...(prev.pinHash !== next.pinHash ? ['PIN changed'] : []),
      ];
      if (d.length) add(d.includes('PIN changed') ? 'staff PIN/role changed' : 'staff edited', next.name, d.join('; '));
      break;
    }
    case 'settings': {
      if (!prev) break;
      const keys = ['name', 'currency', 'taxRate', 'serviceRate', 'decimals', 'currencyAfter', 'receiptFooter', 'address', 'phone', 'printKitchenTickets', 'ingredientStock'];
      const d = keys.filter(k => prev[k] !== next[k]).map(k => `${k} ${num(prev[k])} → ${num(next[k])}`);
      const lp = prev.loyalty || {}, ln = next.loyalty || {};
      for (const k of ['enabled', 'earnPercent', 'maxRedeemPercent', 'expiryMonths']) if (lp[k] !== ln[k]) d.push(`loyalty ${k} ${num(lp[k])} → ${num(ln[k])}`);
      if (JSON.stringify(lp.tiers || []) !== JSON.stringify(ln.tiers || [])) d.push(`member levels changed (${(ln.tiers || []).map(t => t.name).join(', ') || 'none'})`);
      if (JSON.stringify(lp.visitReward || {}) !== JSON.stringify(ln.visitReward || {})) d.push('visit reward changed');
      if (d.length) add('settings changed', 'settings', d.join('; '));
      break;
    }
    case 'tables':
      if (deleted) return [{ action: 'table deleted', target: prev?.name || '', detail: '' }];
      if (!prev) return [{ action: 'table created', target: next.name, detail: '' }];
      if (prev.name !== next.name) add('table renamed', next.name, `from "${prev.name}"`);
      break;
    case 'categories':
      if (deleted) return [{ action: 'category deleted', target: prev?.name || '', detail: '' }];
      if (!prev) return [{ action: 'category created', target: next.name, detail: '' }];
      if (prev.name !== next.name) add('category renamed', next.name, `from "${prev.name}"`);
      break;
    case 'ingredients': {
      if (deleted) return [{ action: 'ingredient deleted', target: prev?.name || '', detail: '' }];
      if (!prev) return [{ action: 'ingredient created', target: next.name, detail: `${num(next.stock)} ${next.unit}, cost ${num(next.cost)} per ${next.unit}` }];
      const d = [
        ...diff('cost', prev.cost, next.cost),
        ...(prev.name !== next.name ? [`renamed from "${prev.name}"`] : []),
        ...(prev.unit !== next.unit ? [`unit ${prev.unit} → ${next.unit}`] : []),
        ...diff('low-stock alert', prev.lowStock, next.lowStock),
      ];
      if (d.length) add('ingredient edited', next.name, d.join('; '));
      break;
    }
    case 'customers': {
      if (deleted) return [{ action: 'customer deleted', target: prev?.name || '', detail: '' }];
      if (!prev) return [{ action: 'customer added', target: next.name, detail: next.phone || '' }];
      const d = [
        ...diff('points', prev.points, next.points),
        ...diff('discount %', prev.discountPercent || 0, next.discountPercent || 0),
        ...diff('credit limit', prev.creditLimit || 0, next.creditLimit || 0),
        ...(prev.active !== next.active ? [next.active ? 'activated' : 'deactivated'] : []),
      ];
      if (d.length) add(d.some(x => x.startsWith('points')) ? 'customer points adjusted' : 'customer edited', next.name, d.join('; '));
      break;
    }
    case 'customerPayments': {
      if (deleted || !next) break;
      if (!prev) add(next.method === 'writeoff' ? 'debt written off' : 'customer paid', next.customerName || '', `${num(next.amount)}${next.method === 'writeoff' ? '' : ' (' + next.method + ')'}`);
      else if (prev.status !== 'void' && next.status === 'void') add('customer payment voided', next.customerName || '', num(next.amount));
      break;
    }
    case 'suppliers': {
      if (deleted) return [{ action: 'supplier deleted', target: prev?.name || '', detail: '' }];
      if (!prev) return [{ action: 'supplier added', target: next.name, detail: next.phone || '' }];
      const d = [...(prev.name !== next.name ? [`renamed from "${prev.name}"`] : []), ...(prev.active !== next.active ? [next.active ? 'activated' : 'deactivated'] : [])];
      if (d.length) add('supplier edited', next.name, d.join('; '));
      break;
    }
    case 'supplierPayments': {
      if (deleted || !next) break;
      if (!prev) add('supplier paid', next.supplierName || '', `${num(next.amount)} (${next.method})`);
      else if (prev.status !== 'void' && next.status === 'void') add('supplier payment voided', next.supplierName || '', num(next.amount));
      break;
    }
    case 'purchases': {
      if (deleted || !next) break;
      if (!prev) add('purchase received', next.supplier || '', `${next.lines.length} item(s), total ${num(next.total)}${next.paid < next.total ? `, ${num(next.total - next.paid)} still owed` : ''}`);
      else if (prev.status !== 'void' && next.status === 'void') add('purchase voided', next.supplier || '', `total ${num(next.total)}`);
      break;
    }
    case 'expenses': {
      if (deleted || !next) break;
      if (!prev) add('expense added', next.category, `${num(next.amount)} by ${next.method}${next.description ? ': ' + next.description : ''}${next.recurringId ? ' (repeating)' : ''}`);
      else if (prev.status !== 'void' && next.status === 'void') add('expense voided', next.category, num(next.amount));
      break;
    }
    case 'recurringExpenses': {
      if (deleted) return [{ action: 'repeating expense removed', target: prev?.category || '', detail: '' }];
      if (!prev) return [{ action: 'repeating expense added', target: next.category, detail: `${num(next.amount)} on day ${next.day} of each month` }];
      const d = [...diff('amount', prev.amount, next.amount), ...diff('day', prev.day, next.day), ...(prev.active !== next.active ? [next.active ? 'turned on' : 'turned off'] : [])];
      if (d.length) add('repeating expense changed', next.category, d.join('; '));
      break;
    }
    case 'ownerMoves': {
      if (deleted || !next) break;
      if (!prev) add(next.type === 'in' ? 'owner put money in' : 'owner took money out', next.method, `${num(next.amount)}${next.note ? ': ' + next.note : ''}`);
      else if (prev.status !== 'void' && next.status === 'void') add('owner money record voided', next.method, num(next.amount));
      break;
    }
    case 'dayCloses': {
      if (deleted) return [{ action: 'day reopened', target: prev?.id || '', detail: '' }];
      if (!prev && next) add('day closed', next.id, `net sales ${num(next.summary && next.summary.revenue)}, net profit ${num(next.summary && next.summary.netProfit)}`);
      break;
    }
    case 'stocktakes': {
      if (deleted || !next || prev) break;
      add('stocktake', '', `${next.lines.length} item(s) counted, value ${next.value > 0 ? '+' : ''}${num(next.value)}`);
      break;
    }
    case 'shifts': {
      if (deleted || !next) break;
      if (!prev) add('shift opened', '', `cash in drawer ${num(next.openingFloat)}`);
      else if (!prev.closedAt && next.closedAt) {
        const gap = next.difference;
        add(gap ? 'shift closed with a difference' : 'shift closed', '',
          `counted ${num(next.countedCash)}, expected ${num(next.expectedCash)}${gap ? `, difference ${gap > 0 ? '+' : ''}${num(gap)}` : ''}`);
      }
      break;
    }
    case 'orders': {
      if (deleted || !next) break;
      const label = `#${next.number ?? '–'}${next.tableName ? ' ' + next.tableName : ''}`;
      const total = next.totals ? num(next.totals.total) : '';
      if (next.status === 'paid' && (!prev || prev.status !== 'paid')) {
        add('order paid', label, `${total} by ${next.payment?.method || '?'}${next.payment?.tip ? `, tip ${num(next.payment.tip)}` : ''}${next.discount ? `, discount ${next.discount.type === 'percent' ? next.discount.value + '%' : num(next.discount.value)}` : ''}${next.loyalty && next.loyalty.used ? `, ${num(next.loyalty.used)} points used` : ''}`);
      } else if (next.status === 'void' && (!prev || prev.status !== 'void')) {
        add('order voided', label, `approved by ${who(next.voidedBy)}; ${next.items.length} line(s)`);
      } else if (next.status === 'refunded' && prev && prev.status !== 'refunded') {
        add('order refunded', label, `${total} approved by ${who(next.refundedBy)}`);
      } else if (next.status === 'open') {
        const was = prev?.discount, now = next.discount;
        if (JSON.stringify(was || null) !== JSON.stringify(now || null)) {
          add(now ? 'discount applied' : 'discount removed', label,
            now ? `${now.type === 'percent' ? now.value + '%' : num(now.value)} ${now.customerId ? "from the customer's card" : 'approved by ' + who(now.by)}` : '');
        }
      }
      break;
    }
    default:
      break;
  }
  return out;
}

module.exports = { describe };
