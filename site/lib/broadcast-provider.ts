/**
 * A tiny Yjs provider over BroadcastChannel, for demos that need no server: editors in the same
 * page, or in other tabs of this site, share one document. Real apps use y-websocket, Hocuspocus,
 * Liveblocks or similar; `yjsCollaboration` accepts any of them the same way.
 */
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';

type Msg =
  | { t: 'hello'; from: number; sv: Uint8Array }
  | { t: 'state'; from: number; to: number; update: Uint8Array; sv: Uint8Array }
  | { t: 'update'; from: number; update: Uint8Array }
  | { t: 'awareness'; from: number; update: Uint8Array };

export class BroadcastProvider {
  readonly awareness: Awareness;
  synced = false;
  private ch: BroadcastChannel;
  private handlers = new Map<string, Set<(...a: unknown[]) => void>>();
  private id: number;

  constructor(
    room: string,
    readonly doc: Y.Doc,
    { alone = 600 }: { alone?: number } = {},
  ) {
    this.id = doc.clientID;
    this.awareness = new Awareness(doc);
    this.ch = new BroadcastChannel(`wordcraft-demo:${room}`);
    this.ch.onmessage = (e: MessageEvent<Msg>) => this.receive(e.data);
    doc.on('update', this.onUpdate);
    this.awareness.on('update', this.onAwareness);
    this.post({ t: 'hello', from: this.id, sv: Y.encodeStateVector(doc) });
    // Nobody answered: this is the first editor in the room.
    setTimeout(() => this.markSynced(), alone);
    window.addEventListener('pagehide', this.destroy);
  }

  on(event: string, cb: (...a: unknown[]) => void) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(cb);
  }
  off(event: string, cb: (...a: unknown[]) => void) {
    this.handlers.get(event)?.delete(cb);
  }
  private emit(event: string, ...a: unknown[]) {
    for (const cb of this.handlers.get(event) ?? []) cb(...a);
  }
  private markSynced() {
    if (this.synced) return;
    this.synced = true;
    this.emit('sync', true);
    this.emit('synced', true);
  }
  private post(m: Msg) {
    try {
      this.ch.postMessage(m);
    } catch {
      // the channel closed
    }
  }
  private onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin !== this) this.post({ t: 'update', from: this.id, update });
  };
  private onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
    const changed = added.concat(updated, removed);
    this.post({ t: 'awareness', from: this.id, update: encodeAwarenessUpdate(this.awareness, changed) });
  };
  private receive(m: Msg) {
    if (m.from === this.id) return;
    if (m.t === 'hello') {
      // Someone joined: send them what they're missing, and our presence.
      this.post({ t: 'state', from: this.id, to: m.from, update: Y.encodeStateAsUpdate(this.doc, m.sv), sv: Y.encodeStateVector(this.doc) });
      this.post({ t: 'awareness', from: this.id, update: encodeAwarenessUpdate(this.awareness, [this.id]) });
    } else if (m.t === 'state' && m.to === this.id) {
      Y.applyUpdate(this.doc, m.update, this);
      this.markSynced();
    } else if (m.t === 'update') {
      Y.applyUpdate(this.doc, m.update, this);
    } else if (m.t === 'awareness') {
      applyAwarenessUpdate(this.awareness, m.update, this);
    }
  }
  destroy = () => {
    removeAwarenessStates(this.awareness, [this.id], 'destroy');
    this.doc.off('update', this.onUpdate);
    this.awareness.off('update', this.onAwareness);
    this.ch.close();
    window.removeEventListener('pagehide', this.destroy);
  };
}
