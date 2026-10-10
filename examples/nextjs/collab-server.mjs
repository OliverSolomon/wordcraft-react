// A minimal Yjs sync server for the co-editing example (the y-websocket protocol: sync + awareness).
// One shared Y.Doc per room, kept in memory while anyone is connected. Swap it for Hocuspocus,
// Liveblocks, PartyKit or y-redis in production; the editor works with any Yjs provider.
//
// Usage: PORT=1234 node collab-server.mjs
import http from 'node:http';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const port = Number(process.env.PORT ?? 1234);
const host = process.env.HOST ?? '127.0.0.1';

/** room name → { doc, awareness, conns: Map<ws, Set<clientId>> } */
const rooms = new Map();

function room(name) {
  let r = rooms.get(name);
  if (r) return r;
  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState(null);
  r = { doc, awareness, conns: new Map() };
  doc.on('update', (update, origin) => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeUpdate(enc, update);
    const msg = encoding.toUint8Array(enc);
    for (const conn of r.conns.keys()) if (conn !== origin) send(conn, msg);
  });
  awareness.on('update', ({ added, updated, removed }, origin) => {
    const changed = added.concat(updated, removed);
    if (origin && r.conns.has(origin)) {
      const ids = r.conns.get(origin);
      added.forEach((id) => ids.add(id));
      removed.forEach((id) => ids.delete(id));
    }
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
    const msg = encoding.toUint8Array(enc);
    for (const conn of r.conns.keys()) send(conn, msg);
  });
  rooms.set(name, r);
  return r;
}

function send(conn, msg) {
  if (conn.readyState !== conn.OPEN) return;
  conn.send(msg, (err) => err && conn.close());
}

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('wordcraft collaboration server\n');
});
const wss = new WebSocketServer({ server });

wss.on('connection', (conn, req) => {
  conn.binaryType = 'arraybuffer';
  const name = decodeURIComponent((req.url ?? '/').slice(1).split('?')[0]) || 'default';
  const r = room(name);
  r.conns.set(conn, new Set());

  conn.on('message', (data) => {
    try {
      const dec = decoding.createDecoder(new Uint8Array(data));
      const enc = encoding.createEncoder();
      switch (decoding.readVarUint(dec)) {
        case MESSAGE_SYNC:
          encoding.writeVarUint(enc, MESSAGE_SYNC);
          syncProtocol.readSyncMessage(dec, enc, r.doc, conn);
          if (encoding.length(enc) > 1) send(conn, encoding.toUint8Array(enc));
          break;
        case MESSAGE_AWARENESS:
          awarenessProtocol.applyAwarenessUpdate(r.awareness, decoding.readVarUint8Array(dec), conn);
          break;
      }
    } catch (e) {
      console.error('bad message', e);
    }
  });

  conn.on('close', () => {
    const ids = r.conns.get(conn);
    r.conns.delete(conn);
    if (ids) awarenessProtocol.removeAwarenessStates(r.awareness, [...ids], null);
    if (r.conns.size === 0) {
      // Everyone left: the merged document was already AutoSaved to the shared file by the editors.
      r.doc.destroy();
      rooms.delete(name);
    }
  });

  // Start the sync: send our state vector, and the current awareness.
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(enc, r.doc);
  send(conn, encoding.toUint8Array(enc));
  const states = r.awareness.getStates();
  if (states.size > 0) {
    const a = encoding.createEncoder();
    encoding.writeVarUint(a, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(r.awareness, [...states.keys()]));
    send(conn, encoding.toUint8Array(a));
  }
});

server.listen(port, host, () => console.log(`wordcraft collaboration server on ws://${host}:${port}`));
