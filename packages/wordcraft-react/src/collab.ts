/**
 * Real-time co-editing over Yjs, the way Word's co-authoring works: everyone edits the same
 * document at once, changes merge character by character, each person's Undo takes back only
 * their own changes, and other people's cursors and selections show on the page with their
 * names, plus their avatars in the title bar.
 *
 * Works with any Yjs provider: y-websocket, Hocuspocus, Liveblocks, PartyKit, y-webrtc,
 * y-indexeddb (offline), or your own.
 *
 * ```tsx
 * import * as Y from 'yjs';
 * import { WebsocketProvider } from 'y-websocket';
 * import { yjsCollaboration } from '@gamine/wordcraft-react/collab';
 *
 * const doc = new Y.Doc();
 * const provider = new WebsocketProvider('wss://collab.example.com', 'doc-42', doc);
 * <WordcraftEditor user={{ name: 'Ada' }} collaboration={yjsCollaboration({ doc, provider })} />
 * ```
 *
 * Needs `yjs` (a peer dependency of this entry point only).
 */
import * as Y from 'yjs';

import type { CollabCursor, CollabPeer, Collaboration, PresenceUser, WordcraftEditor, WordcraftUser } from './core.js';

/** The parts of a y-protocols `Awareness` this uses. */
export interface AwarenessLike {
  clientID: number;
  getStates(): Map<number, Record<string, unknown>>;
  setLocalStateField(field: string, value: unknown): void;
  on(event: 'change', cb: () => void): void;
  off(event: 'change', cb: () => void): void;
}

/** The parts of a Yjs provider this uses (y-websocket, Hocuspocus, Liveblocks, ...). */
export interface ProviderLike {
  awareness?: AwarenessLike | null;
  synced?: boolean;
  isSynced?: boolean;
  on?(event: string, cb: (...args: unknown[]) => void): void;
  off?(event: string, cb: (...args: unknown[]) => void): void;
}

export interface YjsCollaborationOptions {
  /** The shared Yjs document (one per WordCraft document). */
  doc: Y.Doc;
  /** The provider syncing `doc`; used to wait for the first sync and for its awareness. */
  provider?: ProviderLike;
  /** Awareness for presence (defaults to `provider.awareness`). */
  awareness?: AwarenessLike | null;
  /**
   * Resolves once `doc` holds the server's state. Joining before that could put a second copy of
   * the document into the shared one, so this waits for `provider`'s first sync when not given.
   */
  whenSynced?: Promise<unknown>;
  /** The person editing; defaults to the editor's user. */
  user?: WordcraftUser;
  /** Called if joining fails. */
  onError?: (error: Error) => void;
  /** Who is in the document, whenever that changes (for avatars in your own header). */
  onPresenceChange?: (users: PresenceUser[]) => void;
  /** After how long without activity someone shows as idle. Default 60 s. */
  idleAfter?: number;
}

const ANIMALS = ['Otter', 'Heron', 'Lynx', 'Ibis', 'Gecko', 'Oryx', 'Puffin', 'Marten', 'Kudu', 'Tapir', 'Wren', 'Serval'];
const COLORS = ['#c2410c', '#1d4ed8', '#047857', '#7e22ce', '#be185d', '#0e7490', '#a16207', '#4338ca'];

/** A stable colour for a name. */
function colorFor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length]!;
}

const ORIGIN = 'wordcraft';

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function synced(provider: ProviderLike | undefined, explicit: Promise<unknown> | undefined): Promise<unknown> {
  if (explicit) return explicit;
  if (!provider || provider.synced === true || provider.isSynced === true || !provider.on) return Promise.resolve();
  return new Promise((resolve) => {
    const done = (...args: unknown[]) => {
      // y-websocket emits `sync` with a boolean; Hocuspocus emits `synced`.
      if (args.length && args[0] === false) return;
      provider.off?.('sync', done);
      provider.off?.('synced', done);
      resolve(undefined);
    };
    provider.on!('sync', done);
    provider.on!('synced', done);
  });
}

/** Connect a WordCraft editor to a Yjs document (and awareness, for cursors and avatars). */
export function yjsCollaboration(options: YjsCollaborationOptions): Collaboration {
  const listeners = new Set<(users: PresenceUser[]) => void>();
  let last: PresenceUser[] = [];
  const publish = (users: PresenceUser[]) => {
    if (JSON.stringify(users) === JSON.stringify(last)) return;
    last = users;
    options.onPresenceChange?.(users);
    listeners.forEach((cb) => cb(users));
  };
  return {
    onPresence(cb) {
      listeners.add(cb);
      cb(last);
      return () => listeners.delete(cb);
    },
    attach(editor: WordcraftEditor) {
      const { doc } = options;
      const awareness = options.awareness ?? options.provider?.awareness ?? null;
      let stopped = false;
      const cleanups: Array<() => void> = [];

      const start = async () => {
        await synced(options.provider, options.whenSynced);
        if (stopped || editor.destroyed) return;

        // Local edits → shared document.
        editor.collab.onUpdate((update) => Y.applyUpdate(doc, update, ORIGIN));
        cleanups.push(() => editor.collab.onUpdate(null));

        // Join: take the shared document, or share ours when it's empty.
        editor.collab.start(doc.clientID + 1, Y.encodeStateAsUpdate(doc));

        // Shared document → editor.
        const onDocUpdate = (update: Uint8Array, origin: unknown) => {
          if (origin !== ORIGIN && !editor.destroyed) editor.collab.apply(update);
        };
        doc.on('update', onDocUpdate);
        cleanups.push(() => doc.off('update', onDocUpdate));

        if (!awareness) return;
        const user = options.user ?? editor.getUser();
        // Someone who joins through a link without a name is "Anonymous <animal>".
        const anonymous = !user.name?.trim() || user.name === 'Guest';
        const name = anonymous ? `Anonymous ${ANIMALS[awareness.clientID % ANIMALS.length]}` : user.name.trim();
        const color = user.color ?? colorFor(name);
        const mode = () => (editor.destroyed || editor.getMode() === 'viewing' ? 'viewing' : 'editing');
        awareness.setLocalStateField('user', { name, color, id: user.id ?? null, avatarUrl: user.avatarUrl ?? null, anonymous });
        awareness.setLocalStateField('active', Date.now());
        awareness.setLocalStateField('mode', mode());
        // Activity: moving the caret or editing (announced at most every 10 s).
        let lastActive = Date.now();
        const touch = () => {
          if (Date.now() - lastActive < 10_000) return;
          lastActive = Date.now();
          awareness.setLocalStateField('active', lastActive);
        };
        editor.collab.onCursor((cursor: CollabCursor | null) => {
          awareness.setLocalStateField('cursor', cursor);
          touch();
        });
        cleanups.push(() => {
          editor.collab.onCursor(null);
          awareness.setLocalStateField('cursor', null);
        });

        const idleAfter = options.idleAfter ?? 60_000;
        const onAwareness = () => {
          if (editor.destroyed) return;
          const peers: CollabPeer[] = [];
          const users: PresenceUser[] = [];
          const now = Date.now();
          awareness.getStates().forEach((state, clientId) => {
            const u = (state.user ?? {}) as { name?: string; color?: string | null; id?: string | null; avatarUrl?: string | null; anonymous?: boolean };
            if (!u.name) return;
            const idle = typeof state.active === 'number' ? now - state.active > idleAfter : false;
            users.push({
              clientId,
              id: u.id ?? null,
              name: u.name,
              color: u.color ?? colorFor(u.name),
              avatarUrl: u.avatarUrl ?? null,
              state: state.mode === 'viewing' ? 'viewing' : 'editing',
              idle,
              self: clientId === awareness.clientID,
              anonymous: !!u.anonymous,
            });
            if (clientId === awareness.clientID) return;
            const c = (state.cursor ?? null) as CollabCursor | null;
            peers.push({ name: u.name, color: u.color ?? undefined, anchor: c?.anchor ?? null, head: c?.head ?? null });
          });
          editor.collab.setPeers(peers);
          users.sort((a, b) => Number(b.self) - Number(a.self) || a.name.localeCompare(b.name));
          publish(users);
        };
        awareness.on('change', onAwareness);
        cleanups.push(() => awareness.off('change', onAwareness));
        // Idle times pass without awareness changes, and the mode can change: look every 15 s.
        const tick = setInterval(() => {
          const m = mode();
          if (awareness.getStates().get(awareness.clientID)?.mode !== m) awareness.setLocalStateField('mode', m);
          onAwareness();
        }, 15_000);
        cleanups.push(() => clearInterval(tick));
        onAwareness();
      };

      start().catch((e: unknown) => {
        const err = e instanceof Error ? e : new Error(String(e));
        if (options.onError) options.onError(err);
        else console.error('[wordcraft] collaboration failed to start', err);
      });

      return () => {
        stopped = true;
        for (const c of cleanups.reverse()) c();
        if (!editor.destroyed) {
          editor.collab.setPeers([]);
          editor.collab.stop();
        }
        publish([]);
      };
    },
  };
}

/** Encode bytes as base64 (handy for storing a shared state snapshot as text). */
export { toB64 as encodeBase64 };
