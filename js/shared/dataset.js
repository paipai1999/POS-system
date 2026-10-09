'use strict';

// Demo data for a new install, and checks for a data file being restored.
// Used by both the browser app (loaded as a script, see index.html) and the Node server (through js/shared.js).
(function (root) {
  // In Node the other shared modules are required; in the browser they are already on `window`.
  const shared = mod => (typeof module !== 'undefined' && module.exports ? require('./' + mod + '.js') : root);
  const { uid, guestCode, COLLECTIONS } = shared('core');

  function seedData() {
    const cats = ['Coffee', 'Tea', 'Breakfast', 'Mains', 'Desserts', 'Cold Drinks'].map((name, i) => ({ id: uid('c_'), name, sort: i }));
    const catId = Object.fromEntries(cats.map(c => [c.name, c.id]));
    const ings = [
      ['Coffee beans', 'g', 5000, 500, 0.04],
      ['Milk', 'ml', 20000, 3000, 0.0012],
      ['Tea leaves', 'g', 1000, 100, 0.05],
    ].map(([name, unit, stock, lowStock, cost]) => ({ id: uid('i_'), name, unit, stock, lowStock, cost, active: true }));
    const ingId = Object.fromEntries(ings.map(i => [i.name, i.id]));
    const p = (name, cat, price, emoji, description, stock = null, recipe = []) => ({
      id: uid('p_'), name, categoryId: catId[cat], price, emoji, description,
      trackStock: stock !== null, stock: stock ?? 0, lowStock: 5, active: true,
      recipe: recipe.map(([ing, qty]) => ({ ingredientId: ingId[ing], qty })),
    });
    return {
      version: 1,
      settings: {
        name: 'My Cafe',
        address: '123 Main Street',
        phone: '',
        currency: '$',
        decimals: 2,
        currencyAfter: false,
        taxRate: 7,
        serviceRate: 0,
        receiptFooter: 'Thank you! Please come again.',
        printKitchenTickets: true,
        nextOrderNo: 1,
        loyalty: { enabled: false, earnPercent: 5, maxRedeemPercent: 50 },
        ingredientStock: 'warn',
      },
      users: [
        { id: uid('u_'), name: 'Admin', role: 'admin', pin: '1234', active: true },
        { id: uid('u_'), name: 'Maya', role: 'cashier', pin: '1111', active: true },
        { id: uid('u_'), name: 'Leo', role: 'waiter', pin: '2222', active: true },
        { id: uid('u_'), name: 'Kitchen', role: 'kitchen', pin: '3333', active: true },
      ],
      categories: cats,
      products: [
        p('Espresso', 'Coffee', 2.5, '☕', 'Double shot, rich and bold', null, [['Coffee beans', 18]]),
        p('Cappuccino', 'Coffee', 3.8, '☕', 'Espresso with steamed milk foam', null, [['Coffee beans', 18], ['Milk', 120]]),
        p('Latte', 'Coffee', 4.0, '🥛', 'Smooth espresso with plenty of milk', null, [['Coffee beans', 18], ['Milk', 220]]),
        p('Iced Americano', 'Coffee', 3.5, '🧊', 'Espresso over ice and water', null, [['Coffee beans', 18]]),
        p('Green Tea', 'Tea', 2.8, '🍵', 'Japanese sencha', null, [['Tea leaves', 3]]),
        p('Chai Latte', 'Tea', 3.9, '🫖', 'Spiced black tea with milk', null, [['Tea leaves', 4], ['Milk', 200]]),
        p('Avocado Toast', 'Breakfast', 8.5, '🥑', 'Sourdough, smashed avocado, chilli flakes', 20),
        p('Pancake Stack', 'Breakfast', 9.0, '🥞', 'Maple syrup, berries and butter', 15),
        p('Club Sandwich', 'Mains', 11.5, '🥪', 'Chicken, bacon, lettuce and tomato', 15),
        p('Chicken Burger', 'Mains', 12.9, '🍔', 'Crispy chicken, slaw and fries', 12),
        p('Pasta Pomodoro', 'Mains', 11.0, '🍝', 'Tomato, basil and parmesan'),
        p('Cheesecake', 'Desserts', 5.5, '🍰', 'New York style', 8),
        p('Chocolate Brownie', 'Desserts', 4.5, '🍫', 'Served warm with vanilla ice cream', 10),
        p('Fresh Orange Juice', 'Cold Drinks', 4.2, '🍊', 'Squeezed to order'),
        p('Lemonade', 'Cold Drinks', 3.5, '🍋', 'House-made, lightly sweet'),
        p('Sparkling Water', 'Cold Drinks', 2.0, '💧', '330 ml bottle', 40),
      ],
      tables: Array.from({ length: 10 }, (_, i) => ({ id: uid('t_'), name: 'Table ' + (i + 1), guestCode: guestCode() })),
      orders: [],
      guestRequests: [],
      kitchenTickets: [],
      printJobs: [],
      shifts: [],
      ingredients: ings,
      customers: [],
      purchases: [],
      stocktakes: [],
      suppliers: [],
      supplierPayments: [],
      expenses: [],
      recurringExpenses: [],
      ownerMoves: [],
      dayCloses: [],
      customerPayments: [],
    };
  }

  function isValidDataset(d) {
    return !!d && d.version === 1 && !!d.settings && typeof d.settings === 'object' &&
      ['users', 'categories', 'products', 'tables', 'orders'].every(k => Array.isArray(d[k])) &&
      d.users.some(u => u && u.role === 'admin' && u.active);
  }

  // Brings data saved by older versions up to date.
  function normalizeDataset(d) {
    for (const col of COLLECTIONS) if (!Array.isArray(d[col])) d[col] = [];
    d.categories.forEach((c, i) => { if (typeof c.sort !== 'number') c.sort = i; });
    d.tables.forEach(t => { if (!t.guestCode) t.guestCode = guestCode(); });
    return d;
  }

  const api = { seedData, isValidDataset, normalizeDataset };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
