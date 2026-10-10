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

import type { CollabCursor, CollabPeer, Collaboration, WordcraftEditor, WordcraftUser } from './core.js';

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
  return {
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
        awareness.setLocalStateField('user', { name: user.name, color: user.color ?? null, id: user.id ?? null });
        editor.collab.onCursor((cursor: CollabCursor | null) => awareness.setLocalStateField('cursor', cursor));
        cleanups.push(() => {
          editor.collab.onCursor(null);
          awareness.setLocalStateField('cursor', null);
        });

        const onAwareness = () => {
          if (editor.destroyed) return;
          const peers: CollabPeer[] = [];
          awareness.getStates().forEach((state, clientId) => {
            if (clientId === awareness.clientID) return;
            const u = (state.user ?? {}) as { name?: string; color?: string | null };
            const c = (state.cursor ?? null) as CollabCursor | null;
            if (!u.name) return;
            peers.push({ name: u.name, color: u.color ?? undefined, anchor: c?.anchor ?? null, head: c?.head ?? null });
          });
          editor.collab.setPeers(peers);
        };
        awareness.on('change', onAwareness);
        cleanups.push(() => awareness.off('change', onAwareness));
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
      };
    },
  };
}

/** Encode bytes as base64 (handy for storing a shared state snapshot as text). */
export { toB64 as encodeBase64 };
