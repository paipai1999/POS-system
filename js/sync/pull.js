'use strict';

// Receiving changes made on other devices: the live event stream and catching up after being offline.
Object.assign(Sync, {
  // ----- receiving changes -----
  applyRemote(rows, { advanceSeq = true } = {}) {
    const events = [];
    for (const row of rows) {
      if (row.col !== 'settings' && !COLLECTIONS.includes(row.col)) continue;
      if (advanceSeq && row.seq) this.seq = Math.max(this.seq, row.seq);
      const prev = this.synced[row.col] && this.synced[row.col][row.id];
      if (prev && prev.ver >= row.ver) continue;
      const local = this.find(row.col, row.id);
      const before = local ? { status: local.status } : null;
      // Unsent local edits win for now; the next flush will either apply them or come back as a conflict.
      const edited = !!local && (!prev || JSON.stringify(local) !== prev.json);
      if (row.deleted) {
        this.forget(row.col, row.id);
        if (local && !edited) this.removeLocal(row.col, row.id);
      } else {
        this.remember(row.col, row.id, row.ver, row.data);
        if (!local) this.addLocal(row.col, row.data);
        else if (!edited) this.replaceInPlace(local, row.data);
      }
      events.push({ col: row.col, id: row.id, doc: row.deleted ? null : this.find(row.col, row.id), before, isNew: !local && !prev });
    }
    if (!events.length) return;
    if (events.some(e => e.col === 'categories')) Store.sortCategories();
    App.onRemote(events);
  },

  connect() {
    this.disconnect();
    if (!this.token) return;
    const es = new EventSource('/api/events?token=' + encodeURIComponent(this.token));
    this.es = es;
    es.onmessage = e => {
      let m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.type === 'hello') { this.stations = m.stations; this.catchUp(); }
      else if (m.type === 'change') this.applyRemote(m.rows);
      else if (m.type === 'stations') this.stations = m.count;
      else if (m.type === 'reload') location.reload();
    };
    es.onerror = () => {
      this.setOnline(false);
      // The browser reconnects by itself unless the server refused the stream (e.g. session ended).
      if (es.readyState === EventSource.CLOSED) {
        setTimeout(() => { if (this.es === es) { this.catchUp(); this.connect(); } }, 3000);
      }
    };
  },

  disconnect() {
    if (this.es) this.es.close();
    this.es = null;
  },

  // After (re)connecting: fetch anything missed while offline, then send what was queued.
  async catchUp() {
    if (!this.token) return;
    try {
      const r = await this.api('/api/changes?since=' + this.seq);
      this.applyRemote(r.rows);
      this.setOnline(true);
      this.flush();
    } catch (e) {
      if (e.status === 401) App.sessionExpired();
    }
  },

  setOnline(v) {
    if (this.online === v) return;
    this.online = v;
    App.renderSyncStatus();
  },
});
