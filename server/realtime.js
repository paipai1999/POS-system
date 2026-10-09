'use strict';

// Live updates: the open event streams (Server-Sent Events) and telling each device what changed.
// Three kinds of client: staff devices (changed documents they may see), guests (only a nudge to refetch their menu)
// and printer stations (print jobs).
const rules = require('./rules');
const { SECURITY_HEADERS } = require('./http/util.js');

function createRealtime(db) {
  const clients = new Set();   // { res, kind: 'staff' | 'guest' | 'station', token?, userId?, tableId?, key? }

  const stationKeys = () => db.meta('stationKeys', []);
  const stationCount = () => new Set([...clients].filter(c => c.kind === 'station').map(c => c.key)).size;

  const send = (client, msg) => {
    try { client.res.write(`data: ${JSON.stringify(msg)}\n\n`); } catch (e) { clients.delete(client); }
  };

  // Staff devices get the changed documents; guests only a nudge; printer stations only print jobs.
  function broadcast(rows) {
    if (!rows.length) return;
    const pub = rows.map(rules.publicRow);
    const seq = Math.max(...rows.map(r => r.seq));
    const jobs = pub.filter(r => r.col === 'printJobs');
    const users = new Map();     // one lookup per signed-in user, shared by all of their devices
    const guestRelevant = rows.some(r => !['printJobs', 'kitchenTickets', 'users'].includes(r.col));
    for (const c of clients) {
      if (c.kind === 'staff') {
        if (!users.has(c.userId)) users.set(c.userId, db.doc('users', c.userId));
        const visible = rules.rowsFor(users.get(c.userId), pub, { tombstone: true });
        if (visible.length) send(c, { type: 'change', seq, rows: visible });
      } else if (c.kind === 'station' && jobs.length) send(c, { type: 'jobs', rows: jobs });
      else if (c.kind === 'guest' && guestRelevant) send(c, { type: 'ping' });
    }
  }

  // Tells staff devices how many printer stations are connected.
  const broadcastStations = () => {
    const count = stationCount();
    for (const c of clients) if (c.kind === 'staff') send(c, { type: 'stations', count });
  };

  // After all data was replaced (restore or reset) every device must load it again.
  const broadcastReload = () => { for (const c of clients) send(c, { type: 'reload' }); };

  // Starts an event stream for `client` and returns it (so the caller can send it a first message).
  function openStream(req, res, client) {
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n');
    client.res = res;
    clients.add(client);
    req.on('close', () => {
      clients.delete(client);
      if (client.kind === 'station') broadcastStations();
    });
    return client;
  }

  // Keeps streams alive through Wi-Fi power saving and proxies.
  const heartbeat = () => { for (const c of clients) { try { c.res.write(': hb\n\n'); } catch (e) { clients.delete(c); } } };

  return {
    stationKeys, stationCount, send, broadcast, broadcastStations, broadcastReload, openStream, heartbeat,
    endWhere: test => { for (const c of clients) if (test(c)) c.res.end(); },
    closeAll: () => { for (const c of clients) c.res.end(); clients.clear(); },
  };
}

module.exports = { createRealtime };
