'use strict';

// The list of screens and the menu bar.
// Each screen registers itself here:
// { perm?, fullscreen?, live?: [collections that should re-render it], render(root, params), refresh?(), leave?(params) }
const Screens = {};

const NAV = [
  { id: 'tables', label: 'Tables', icon: 'layout-grid', perm: 'tables' },
  { id: 'reservations', label: 'Reservations', icon: 'calendar', perm: 'tables' },
  { id: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard', perm: 'tables' },
  { id: 'kitchen', label: 'Kitchen', icon: 'chef-hat', perm: 'kitchen' },
  { id: 'orders', label: 'Orders', icon: 'receipt', perm: 'orders' },
  { id: 'drawer', label: 'Cash drawer', icon: 'wallet', perm: 'checkout' },
  { id: 'products', label: 'Menu & Stock', icon: 'package', perm: 'products' },
  { id: 'inventory', label: 'Inventory', icon: 'clipboard-list', perm: 'products' },
  { id: 'customers', label: 'Customers', icon: 'user', perm: 'checkout' },
  { id: 'reports', label: 'Reports', icon: 'bar-chart', perm: 'reports' },
  { id: 'finance', label: 'Finance', icon: 'trending-up', perm: 'reports' },
  { id: 'attendance', label: 'Hours', icon: 'clock', perm: 'manage' },
  { id: 'users', label: 'Staff', icon: 'users', perm: 'users' },
  { id: 'settings', label: 'Settings', icon: 'settings', perm: 'settings' },
];
