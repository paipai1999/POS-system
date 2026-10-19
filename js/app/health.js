'use strict';

// Problems an admin should hear about (backups, disk space, demo PINs) show as a mark in the menu bar on every screen.
// The server works them out (GET /api/system); this asks every ten minutes while someone is signed in.
const HEALTH_EVERY = 10 * 60 * 1000;

Object.assign(App, {
  healthWarnings: [],

  healthAt: 0,

  setHealth(warnings) {
    this.healthWarnings = warnings || [];
    this.healthAt = Date.now();
    if (this.user && !Screens[this.screen]?.fullscreen) this.renderTopbar();
  },

  // Called on every screen change; asks the server only when the last answer is old.
  async maybeRefreshHealth() {
    if (!Store.server || !this.user || !this.can('settings')) {
      this.healthWarnings = [];
      this.healthAt = 0;                                // the next admin to sign in gets a fresh answer
      return;
    }
    if (Date.now() - this.healthAt < HEALTH_EVERY) return;
    this.healthAt = Date.now();                       // (also stops two screen changes in a row from asking twice)
    try { this.setHealth((await Sync.api('/api/system')).warnings); } catch (e) { /* the mark simply stays as it was */ }
  },

  healthChip() {
    const w = this.healthWarnings;
    if (!w.length) return '';
    const worst = w.some(x => x.level === 'error');
    return `<button class="health-chip ${worst ? 'error' : ''}" data-nav="settings" title="${esc(w.map(x => x.text).join('\n'))}" aria-label="${w.length} problem${w.length === 1 ? '' : 's'} to look at">${icon('alert')} ${w.length}</button>`;
  },
});
