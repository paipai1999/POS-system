'use strict';

// The list of screens and the menu bar.
// Each screen registers itself here:
// { perm?, fullscreen?, live?: [collections that should re-render it], render(root, params), refresh?(), leave?(params) }
const Screens = {};

const NAV = [
  { id: 'tables', label: 'Tables', icon: '🪑', perm: 'tables' },
  { id: 'dashboard', label: 'Dashboard', icon: '📋', perm: 'tables' },
  { id: 'kitchen', label: 'Kitchen', icon: '👨‍🍳', perm: 'kitchen' },
  { id: 'orders', label: 'Orders', icon: '🧾', perm: 'orders' },
  { id: 'drawer', label: 'Cash drawer', icon: '💰', perm: 'checkout' },
  { id: 'products', label: 'Menu & Stock', icon: '📦', perm: 'products' },
  { id: 'inventory', label: 'Inventory', icon: '🧂', perm: 'products' },
  { id: 'customers', label: 'Customers', icon: '👤', perm: 'checkout' },
  { id: 'reports', label: 'Reports', icon: '📊', perm: 'reports' },
  { id: 'finance', label: 'Finance', icon: '💹', perm: 'reports' },
  { id: 'users', label: 'Staff', icon: '👥', perm: 'users' },
  { id: 'settings', label: 'Settings', icon: '⚙️', perm: 'settings' },
];
