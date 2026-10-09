'use strict';

// Reacting to changes that arrive from other devices: redraw the screen unless the person is typing, and alert on new requests.
Object.assign(App, {
  isTyping() {
    const a = document.activeElement;
    return !!a && $('#main').contains(a) && a.matches('input:not([type=checkbox]), textarea, select');
  },

  // Re-render after data changed on another device, if the current screen shows that data.
  liveRefresh(cols) {
    if (this.user && !Screens[this.screen]?.fullscreen) this.renderTopbar();
    const scr = Screens[this.screen];
    if (!scr) return;
    if (scr.live && !cols.some(c => scr.live.includes(c))) return;
    if (this.isTyping()) { this.deferredRender = true; return; }
    this.refreshScreen();
  },

  refreshScreen() {
    const scr = Screens[this.screen];
    if (scr && scr.refresh) scr.refresh();
    else this.render();
  },

  // Alerts for events that happened on other devices.
  onRemote(events) {
    for (const ev of events) {
      const d = ev.doc;
      if (!d) continue;
      if (ev.col === 'guestRequests' && ev.isNew && d.status === 'pending' && this.can('guest')) {
        const t = Store.table(d.tableId);
        toast(`🔔 ${t ? t.name : 'A table'}: ${d.kind === 'call' ? 'guest is calling a waiter' : 'new guest order'}`, 'ok');
        beep();
      }
      if (ev.col === 'kitchenTickets') {
        if (d.status === 'ready' && (!ev.before || ev.before.status !== 'ready') && this.user && d.staffId === this.user.id) {
          toast(`🍽️ ${d.where} #${orderNo(Store.order(d.orderId) || d)} is ready to serve`, 'ok');
          beep(2);
          if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        }
        if (ev.isNew && d.status === 'new' && this.screen === 'kitchen') beep();
      }
    }
    const me = this.user && Store.user(this.user.id);
    if (this.user && (!me || !me.active)) return this.sessionExpired();
    this.liveRefresh([...new Set(events.map(e => e.col))]);
  },
});
