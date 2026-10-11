/**
 * Version history, in the style of Google Docs (an Extra: WordCraft has no version history UI,
 * and Word keeps versions only for files in OneDrive or SharePoint).
 *
 * The editor records a version of the document as people work: every few minutes while it
 * changes, on each save, and before a restore. A `VersionStore` keeps them. The default store
 * keeps them in the browser (IndexedDB); pass your own to keep them on your server, so everyone
 * editing a shared document sees the same history.
 *
 * Versions are WordCraft's own JSON format, which keeps everything in the document exactly.
 * Server-safe: no React, and no DOM at import time.
 */

/** One saved version of a document. */
export interface VersionMeta {
  /** Unique id (also the key the store uses for the bytes). */
  id: string;
  /** When it was recorded, ISO 8601. */
  createdAt: string;
  /** Who was editing. */
  author?: { name: string; color?: string };
  /** A name someone gave it ("First draft"). Named versions are never pruned. */
  name?: string;
  /** Why it was recorded. */
  reason: 'open' | 'autosave' | 'save' | 'manual' | 'restore';
  /** Size of the saved bytes. */
  size: number;
  /** The document's title then. */
  title?: string;
  /** The document's word count then, shown as a hint in the list. */
  words?: number;
}

/** Where versions are kept. Every method may be async. */
export interface VersionStore {
  /** Every version, newest first. */
  list(): Promise<VersionMeta[]>;
  /** The bytes of one version (WordCraft JSON), or null when it's gone. */
  get(id: string): Promise<Uint8Array | null>;
  /** Keep a new version. */
  put(meta: VersionMeta, bytes: Uint8Array): Promise<void>;
  /** Name a version, or clear its name with `null`. */
  rename(id: string, name: string | null): Promise<void>;
  /** Delete a version. */
  remove(id: string): Promise<void>;
}

export interface VersionHistoryOptions {
  /** Where versions are kept. Default: this browser (IndexedDB), per `documentId`. */
  store?: VersionStore;
  /** Identifies the document in the default store. Default `"default"`. */
  documentId?: string;
  /** Record a version at most this often while the document changes, in ms. Default 5 minutes. */
  interval?: number;
  /** Keep at most this many unnamed versions (oldest go first). Default 200. */
  max?: number;
}

/** A store that lives as long as the page (for tests and demos). */
export function memoryVersionStore(): VersionStore {
  const metas: VersionMeta[] = [];
  const bytes = new Map<string, Uint8Array>();
  return {
    async list() {
      return [...metas].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async get(id) {
      return bytes.get(id) ?? null;
    },
    async put(meta, data) {
      metas.push({ ...meta });
      bytes.set(meta.id, data);
    },
    async rename(id, name) {
      const m = metas.find((x) => x.id === id);
      if (m) m.name = name ?? undefined;
    },
    async remove(id) {
      const i = metas.findIndex((x) => x.id === id);
      if (i >= 0) metas.splice(i, 1);
      bytes.delete(id);
    },
  };
}

const DB = 'wordcraft-versions';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' }).createIndex('doc', 'doc');
      if (!db.objectStoreNames.contains('bytes')) db.createObjectStore('bytes');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Versions kept in this browser with IndexedDB, separately for each `documentId`. Falls back to
 * memory where IndexedDB is unavailable (private windows in some browsers).
 */
export function browserVersionStore(documentId = 'default'): VersionStore {
  if (typeof indexedDB === 'undefined') return memoryVersionStore();
  let db: Promise<IDBDatabase> | null = null;
  const fallback = memoryVersionStore();
  const get = () => (db ??= openDb());
  const tx = async (mode: IDBTransactionMode) => (await get()).transaction(['meta', 'bytes'], mode);
  const safe = async <T>(f: () => Promise<T>, g: () => Promise<T>) => {
    try {
      return await f();
    } catch {
      return g();
    }
  };
  return {
    list: () =>
      safe(
        async () => {
          const t = await tx('readonly');
          const all = (await done(t.objectStore('meta').index('doc').getAll(documentId))) as Array<VersionMeta & { doc: string }>;
          return all.map(({ doc: _doc, ...m }) => m).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        },
        () => fallback.list(),
      ),
    get: (id) =>
      safe(
        async () => {
          const t = await tx('readonly');
          const v = (await done(t.objectStore('bytes').get(id))) as Uint8Array | undefined;
          return v ?? null;
        },
        () => fallback.get(id),
      ),
    put: (meta, bytes) =>
      safe(
        async () => {
          const t = await tx('readwrite');
          t.objectStore('meta').put({ ...meta, doc: documentId });
          t.objectStore('bytes').put(bytes, meta.id);
          await new Promise<void>((resolve, reject) => {
            t.oncomplete = () => resolve();
            t.onerror = () => reject(t.error);
          });
        },
        () => fallback.put(meta, bytes),
      ),
    rename: (id, name) =>
      safe(
        async () => {
          const t = await tx('readwrite');
          const m = (await done(t.objectStore('meta').get(id))) as (VersionMeta & { doc: string }) | undefined;
          if (m) {
            if (name) m.name = name;
            else delete m.name;
            t.objectStore('meta').put(m);
          }
        },
        () => fallback.rename(id, name),
      ),
    remove: (id) =>
      safe(
        async () => {
          const t = await tx('readwrite');
          t.objectStore('meta').delete(id);
          t.objectStore('bytes').delete(id);
        },
        () => fallback.remove(id),
      ),
  };
}

/**
 * Versions kept by your server over HTTP. `baseUrl` answers:
 * `GET {baseUrl}` with the list (JSON array of `VersionMeta`), `GET {baseUrl}/{id}` with the
 * bytes, `PUT {baseUrl}/{id}` with the bytes (metadata in the `x-version-meta` header, as JSON),
 * `PATCH {baseUrl}/{id}` with `{"name": …}`, and `DELETE {baseUrl}/{id}`.
 */
export function httpVersionStore(baseUrl: string, init: RequestInit = {}): VersionStore {
  const url = (id?: string) => (id ? `${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(id)}` : baseUrl);
  const ok = async (r: Response) => {
    if (!r.ok) throw new Error(`Version history request failed (${r.status})`);
    return r;
  };
  return {
    async list() {
      return (await (await ok(await fetch(url(), init))).json()) as VersionMeta[];
    },
    async get(id) {
      const r = await fetch(url(id), init);
      if (r.status === 404) return null;
      return new Uint8Array(await (await ok(r)).arrayBuffer());
    },
    async put(meta, bytes) {
      const headers = new Headers(init.headers);
      headers.set('content-type', 'application/json');
      headers.set('x-version-meta', encodeURIComponent(JSON.stringify(meta)));
      await ok(await fetch(url(meta.id), { ...init, method: 'PUT', headers, body: bytes as BodyInit }));
    },
    async rename(id, name) {
      const headers = new Headers(init.headers);
      headers.set('content-type', 'application/json');
      await ok(await fetch(url(id), { ...init, method: 'PATCH', headers, body: JSON.stringify({ name }) }));
    },
    async remove(id) {
      await ok(await fetch(url(id), { ...init, method: 'DELETE' }));
    },
  };
}

/** Drop the oldest unnamed versions beyond `max`. */
export async function pruneVersions(store: VersionStore, max: number): Promise<void> {
  const unnamed = (await store.list()).filter((v) => !v.name);
  for (const v of unnamed.slice(max)) await store.remove(v.id);
}

export function newVersionId(): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${rand}`;
}
