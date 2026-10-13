'use client';

/**
 * Comments in the Google Docs style, on top of WordCraft's own Word-style comments.
 *
 * WordCraft keeps the comments in the document (anchored ranges, threads, resolved state, saved
 * to `word/comments.xml` and `commentsExtended.xml`) and draws them as cards in the margin. This
 * adds what a web app needs around them: a panel that lists every thread with filters (Open,
 * Resolved, Mine, Mentions me, by author), replies with `@mentions` and a people picker, Assign
 * to, and a store adapter that hears every create, reply, edit, resolve and delete so the host
 * can keep them and send notifications.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';

import type { DocComment, WordcraftEditor, WordcraftUser } from './core.js';

/** Someone who can be mentioned or assigned. */
export interface Person {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string;
  color?: string;
}

/** A comment as the host's store sees it. */
export interface StoredComment extends DocComment {
  /** The people `@mentioned` in the text. */
  mentions: Person[];
  /** The person the comment is assigned to (an action item), if any. */
  assignee?: Person | null;
}

export type CommentEventType = 'create' | 'reply' | 'update' | 'resolve' | 'remove';

/** A change to the comments, from this editor or (through `subscribe`) from elsewhere. */
export interface CommentEvent {
  type: CommentEventType;
  comment: StoredComment;
  /** For `reply`: the thread's first comment. */
  parent?: StoredComment;
}

/**
 * Where comments are kept. Every method is optional and may return a promise; a failing store
 * never stops anyone commenting (errors are logged). The document itself also carries the
 * comments, so a store is for notifications, search and a record outside the file.
 */
export interface CommentStore {
  create?(comment: StoredComment): unknown;
  reply?(comment: StoredComment, parent: StoredComment): unknown;
  update?(comment: StoredComment): unknown;
  resolve?(comment: StoredComment, resolved: boolean): unknown;
  remove?(comment: StoredComment): unknown;
  /**
   * Comments made elsewhere (another app, an email reply), applied to this document as they
   * arrive. Not needed with real-time co-editing, which brings other people's comments by itself.
   * Returns a function that stops listening.
   */
  subscribe?(listener: (event: CommentEvent) => void): () => void;
}

export interface CommentsOptions {
  store?: CommentStore;
  /** The people to offer after `@`: a list, or a search (`query` is what follows the `@`). */
  people?: Person[] | ((query: string) => Person[] | Promise<Person[]>);
  onCreate?(comment: StoredComment): void;
  onReply?(comment: StoredComment, parent: StoredComment): void;
  onResolve?(comment: StoredComment, resolved: boolean): void;
  /** Someone was mentioned (or assigned): send them a notification. */
  onMention?(event: { comment: StoredComment; people: Person[]; assignee: Person | null }): void;
}

// ---------------------------------------------------------------------------------------------
// Following the document's comments

function mentionsIn(text: string, people: Person[]): Person[] {
  const lower = text.toLowerCase();
  return people.filter((p) => lower.includes(`@${p.name.toLowerCase()}`) || (p.email && lower.includes(`@${p.email.toLowerCase()}`)));
}

function call(f: (() => unknown) | undefined) {
  if (!f) return;
  try {
    const out = f();
    if (out && typeof (out as Promise<unknown>).then === 'function') (out as Promise<unknown>).catch((e) => console.warn('[wordcraft] comment store', e));
  } catch (e) {
    console.warn('[wordcraft] comment store', e);
  }
}

/**
 * Watch the editor's comments and tell the host about every change. `known` people (the list, or
 * everyone seen so far) are matched against `@mentions`. Returns the current comments.
 */
export function useCommentSync(editor: WordcraftEditor | null, options: CommentsOptions | null, people: Person[], assignees: Map<number, Person | null>): DocComment[] {
  const [list, setList] = useState<DocComment[]>([]);
  const prev = useRef<Map<number, DocComment> | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const peopleRef = useRef(people);
  peopleRef.current = people;
  const applying = useRef(false);
  const remoteIds = useRef(new Map<number, number>());

  const stored = useCallback(
    (c: DocComment): StoredComment => ({ ...c, mentions: mentionsIn(c.text, peopleRef.current), assignee: assignees.get(c.id) ?? null }),
    [assignees],
  );

  const refresh = useCallback(() => {
    if (!editor || editor.destroyed) return;
    let now: DocComment[];
    try {
      now = editor.comments();
    } catch {
      return;
    }
    const map = new Map(now.map((c) => [c.id, c]));
    const before = prev.current;
    prev.current = map;
    setList((old) => (JSON.stringify(old) === JSON.stringify(now) ? old : now));
    if (!before || applying.current) return;
    const o = latest.current;
    if (!o) return;
    const store = o.store;
    for (const c of now) {
      const was = before.get(c.id);
      const s = stored(c);
      if (!was) {
        if (c.parent == null) {
          call(() => store?.create?.(s));
          o.onCreate?.(s);
        } else {
          const parent = map.get(c.parent);
          const p = parent ? stored(parent) : undefined;
          if (p) {
            call(() => store?.reply?.(s, p));
            o.onReply?.(s, p);
          }
        }
        if (s.mentions.length || s.assignee) o.onMention?.({ comment: s, people: s.mentions, assignee: s.assignee ?? null });
        continue;
      }
      if (was.resolved !== c.resolved) {
        call(() => store?.resolve?.(s, c.resolved));
        o.onResolve?.(s, c.resolved);
      }
      if (was.text !== c.text) {
        call(() => store?.update?.(s));
        const added = s.mentions.filter((p) => !mentionsIn(was.text, peopleRef.current).some((q) => q.id === p.id));
        if (added.length) o.onMention?.({ comment: s, people: added, assignee: s.assignee ?? null });
      }
    }
    for (const [id, c] of before) if (!map.has(id)) call(() => store?.remove?.(stored(c)));
  }, [editor, stored]);

  // After every edit (comments are edits), and now and then for changes that arrive otherwise.
  useEffect(() => {
    if (!editor) return;
    refresh();
    const off = editor.onSelection(() => refresh());
    const t = window.setInterval(refresh, 1200);
    return () => {
      off();
      window.clearInterval(t);
    };
  }, [editor, refresh]);

  // Comments from elsewhere, through the store.
  useEffect(() => {
    const store = options?.store;
    if (!editor || !store?.subscribe) return;
    return store.subscribe((e) => {
      if (editor.destroyed) return;
      applying.current = true;
      try {
        applyRemote(editor, e, remoteIds.current);
      } catch (err) {
        console.warn('[wordcraft] could not apply a comment from the store', err);
      } finally {
        applying.current = false;
        prev.current = null;
        refresh();
      }
    });
  }, [editor, options?.store, refresh]);

  return list;
}

/** Apply a comment change from the store to this document. `ids` maps the store's ids to ours. */
function applyRemote(editor: WordcraftEditor, e: CommentEvent, ids: Map<number, number>) {
  const c = e.comment;
  const local = ids.get(c.id);
  if (e.type === 'create' && c.anchor && local == null) {
    const me = editor.getUser();
    editor.selectText(c.anchor.path, c.anchor.start, c.anchor.end);
    editor.setUser({ ...me, name: c.author });
    try {
      editor.execute('review.newComment', { text: c.text });
    } finally {
      editor.setUser(me);
    }
    const mine = editor.comments().filter((x) => x.parent == null && x.text === c.text && x.author === c.author);
    const made = mine[mine.length - 1];
    if (made) ids.set(c.id, made.id);
    if (made && c.resolved) editor.execute('review.resolveComment', { id: made.id, value: true });
  } else if (e.type === 'reply' && e.parent && local == null) {
    const parent = ids.get(e.parent.id) ?? e.parent.id;
    const me = editor.getUser();
    editor.setUser({ ...me, name: c.author });
    try {
      editor.execute('review.reply', { id: parent, text: c.text });
    } finally {
      editor.setUser(me);
    }
  } else if (local != null || editor.comments().some((x) => x.id === c.id)) {
    const id = local ?? c.id;
    if (e.type === 'resolve') editor.execute('review.resolveComment', { id, value: c.resolved });
    if (e.type === 'update') editor.execute('review.editComment', { id, text: c.text });
    if (e.type === 'remove') editor.execute('review.deleteComment', { id });
  }
}

// ---------------------------------------------------------------------------------------------
// The panel

type Filter = 'open' | 'resolved' | 'mine' | 'mentions';

export interface CommentsPanelProps {
  editor: WordcraftEditor;
  comments: DocComment[];
  user?: WordcraftUser;
  people: Person[];
  options: CommentsOptions;
  /** Can add, reply to and resolve comments (commenters and above). */
  canComment: boolean;
  /** Assignments made here (comment id to person), kept by the editor component. */
  assignees: Map<number, Person | null>;
  onAssign: (id: number, person: Person | null) => void;
  onClose: () => void;
  dark?: boolean;
  /** A bottom sheet (phones) instead of a side panel. */
  sheet?: boolean;
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '?'
  );
}

export function personColor(name: string): string {
  const palette = ['#c2410c', '#1d4ed8', '#047857', '#7e22ce', '#be185d', '#0e7490', '#a16207', '#4338ca'];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length]!;
}

function when(date: string): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  const sameDay = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return sameDay ? time : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}

/** Text with `@mentions` set apart. */
function Rich({ text, people }: { text: string; people: Person[] }) {
  if (!people.length) return <>{text}</>;
  const names = people.map((p) => p.name).sort((a, b) => b.length - a.length);
  const re = new RegExp(`(@(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))`, 'gi');
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 ? (
          <span key={i} className="wccm-mention">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

function Avatar({ name, person, size = 28 }: { name: string; person?: Person; size?: number }) {
  if (person?.avatarUrl) return <img className="wccm-avatar" src={person.avatarUrl} alt="" style={{ width: size, height: size }} />;
  return (
    <span className="wccm-avatar" aria-hidden="true" style={{ width: size, height: size, background: person?.color ?? personColor(name), fontSize: size * 0.4 }}>
      {initials(name)}
    </span>
  );
}

/** A text box with an `@` people picker. */
function MentionBox({
  value,
  onChange,
  onSubmit,
  people,
  options,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  people: Person[];
  options: CommentsOptions;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [found, setFound] = useState<Person[]>([]);
  const [pick, setPick] = useState(0);
  useEffect(() => {
    if (query === null) return;
    let gone = false;
    const src = options.people;
    const p = typeof src === 'function' ? src(query) : (src ?? people).filter((x) => x.name.toLowerCase().includes(query.toLowerCase()) || x.email?.toLowerCase().includes(query.toLowerCase()));
    Promise.resolve(p)
      .then((list) => !gone && (setFound(list.slice(0, 8)), setPick(0)))
      .catch(() => !gone && setFound([]));
    return () => {
      gone = true;
    };
  }, [query, options.people, people]);
  const track = (v: string, caret: number) => {
    const m = /(?:^|\s)@([^\s@]{0,30})$/.exec(v.slice(0, caret));
    setQuery(m ? m[1]! : null);
  };
  const choose = (p: Person) => {
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    const before = value.slice(0, caret).replace(/@([^\s@]{0,30})$/, `@${p.name} `);
    const next = before + value.slice(caret);
    onChange(next);
    setQuery(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    });
  };
  const onKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (query !== null && found.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setPick((i) => (i + (e.key === 'ArrowDown' ? 1 : found.length - 1)) % found.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        choose(found[pick]!);
        return;
      }
      if (e.key === 'Escape') {
        setQuery(null);
        return;
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSubmit();
    }
  };
  return (
    <div className="wccm-box">
      <textarea
        ref={ref}
        rows={2}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          track(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={onKey}
        onClick={(e) => track(value, (e.target as HTMLTextAreaElement).selectionStart)}
      />
      {query !== null && found.length > 0 && (
        <div className="wccm-people" role="listbox" aria-label="People">
          {found.map((p, i) => (
            <button key={p.id} type="button" role="option" aria-selected={i === pick} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(p)}>
              <Avatar name={p.name} person={p} size={24} />
              <span>
                {p.name}
                {p.email && <small>{p.email}</small>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CommentsPanel({ editor, comments, user, people, options, canComment, assignees, onAssign, onClose, dark, sheet }: CommentsPanelProps) {
  const [filter, setFilter] = useState<Filter>('open');
  const [author, setAuthor] = useState('');
  const [draft, setDraft] = useState('');
  const [composing, setComposing] = useState(false);
  const [assign, setAssign] = useState(false);
  const [replies, setReplies] = useState<Record<number, string>>({});
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const [announce, setAnnounce] = useState('');
  const me = user?.name ?? editor.getUser().name;
  const byName = useMemo(() => new Map(people.map((p) => [p.name, p])), [people]);

  const threads = useMemo(() => {
    const first = comments.filter((c) => c.parent == null);
    const kids = new Map<number, DocComment[]>();
    for (const c of comments) if (c.parent != null) kids.set(c.parent, [...(kids.get(c.parent) ?? []), c]);
    return first.map((c) => ({ c, replies: kids.get(c.id) ?? [] }));
  }, [comments]);
  const authors = useMemo(() => [...new Set(comments.map((c) => c.author))].sort(), [comments]);
  const mentionsMe = (t: { c: DocComment; replies: DocComment[] }) => [t.c, ...t.replies].some((x) => x.text.toLowerCase().includes(`@${me.toLowerCase()}`)) || assignees.get(t.c.id)?.name === me;
  const shown = threads.filter((t) => {
    if (author && t.c.author !== author) return false;
    if (filter === 'open') return !t.c.resolved;
    if (filter === 'resolved') return t.c.resolved;
    if (filter === 'mine') return t.c.author === me || t.replies.some((r) => r.author === me);
    return mentionsMe(t);
  });
  const counts = { open: threads.filter((t) => !t.c.resolved).length, resolved: threads.filter((t) => t.c.resolved).length };

  // Announce new comments to screen readers.
  const seen = useRef(comments.length);
  useEffect(() => {
    if (comments.length > seen.current) setAnnounce(`${comments.length - seen.current} new comment${comments.length - seen.current > 1 ? 's' : ''}`);
    seen.current = comments.length;
  }, [comments.length]);

  const run = (command: string, params?: Record<string, unknown>) => {
    try {
      editor.execute(command, params);
      return true;
    } catch (e) {
      setAnnounce(e instanceof Error ? e.message : String(e));
      return false;
    }
  };
  const mentioned = mentionsIn(draft, people);
  const post = () => {
    const text = draft.trim();
    if (!text) return;
    if (!editor.getSelectedText().trim()) {
      setAnnounce('Select the text to comment on first.');
      return;
    }
    if (!run('review.newComment', { text })) return;
    if (assign && mentioned[0]) {
      const made = editor.comments().filter((c) => c.parent == null && c.text === text);
      const last = made[made.length - 1];
      if (last) onAssign(last.id, mentioned[0]);
    }
    setDraft('');
    setAssign(false);
    setComposing(false);
  };
  const reply = (id: number) => {
    const text = replies[id]?.trim();
    if (!text) return;
    if (run('review.reply', { id, text })) setReplies((r) => ({ ...r, [id]: '' }));
  };
  const go = (c: DocComment) => {
    if (c.anchor) editor.selectText(c.anchor.path, c.anchor.start, c.anchor.end);
  };

  const card = (c: DocComment, isReply: boolean, thread: DocComment) => {
    const own = c.author === me;
    const editingThis = editing?.id === c.id;
    return (
      <div className={isReply ? 'wccm-reply' : 'wccm-head'} key={c.id}>
        <div className="wccm-who">
          <Avatar name={c.author} person={byName.get(c.author)} size={isReply ? 24 : 28} />
          <div className="wccm-meta">
            <strong>{c.author}</strong>
            <span>{when(c.date)}</span>
          </div>
          {!isReply && canComment && (
            <button type="button" className="wccm-icon" title={thread.resolved ? 'Reopen' : 'Resolve'} aria-label={thread.resolved ? 'Reopen' : 'Resolve'} onClick={() => run('review.resolveComment', { id: thread.id, value: !thread.resolved })}>
              {thread.resolved ? '↺' : '✓'}
            </button>
          )}
          {own && canComment && !editingThis && (
            <details className="wccm-more">
              <summary aria-label="More">⋯</summary>
              <div>
                <button type="button" onClick={() => setEditing({ id: c.id, text: c.text })}>
                  Edit
                </button>
                <button type="button" onClick={() => run('review.deleteComment', { id: c.id })}>
                  Delete
                </button>
              </div>
            </details>
          )}
        </div>
        {editingThis ? (
          <div className="wccm-edit">
            <MentionBox value={editing.text} onChange={(t) => setEditing({ id: c.id, text: t })} onSubmit={() => run('review.editComment', { id: c.id, text: editing.text.trim() }) && setEditing(null)} people={people} options={options} placeholder="Edit comment" autoFocus />
            <div className="wccm-actions">
              <button type="button" className="wccm-btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="button" className="wccm-btn wccm-primary" disabled={!editing.text.trim()} onClick={() => run('review.editComment', { id: c.id, text: editing.text.trim() }) && setEditing(null)}>
                Save
              </button>
            </div>
          </div>
        ) : (
          <p className="wccm-text">
            <Rich text={c.text} people={people} />
          </p>
        )}
      </div>
    );
  };

  return (
    <aside className={`wccm${sheet ? ' wccm-sheet' : ''}`} data-theme={dark ? 'dark' : 'light'} aria-label="Comments" onKeyDown={(e) => e.stopPropagation()} onKeyUp={(e) => e.stopPropagation()}>
      <style>{CSS}</style>
      <div className="wccm-top">
        <h2>Comments</h2>
        {canComment && (
          <button type="button" className="wccm-btn wccm-primary" onClick={() => setComposing((v) => !v)}>
            + Comment
          </button>
        )}
        <button type="button" className="wccm-icon" aria-label="Close comments" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="wccm-filters" role="tablist" aria-label="Show">
        {(
          [
            ['open', `Open${counts.open ? ` ${counts.open}` : ''}`],
            ['resolved', `Resolved${counts.resolved ? ` ${counts.resolved}` : ''}`],
            ['mine', 'Mine'],
            ['mentions', 'Mentions me'],
          ] as Array<[Filter, string]>
        ).map(([f, label]) => (
          <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>
            {label}
          </button>
        ))}
        {authors.length > 1 && (
          <select aria-label="Author" value={author} onChange={(e) => setAuthor(e.target.value)}>
            <option value="">Everyone</option>
            {authors.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        )}
      </div>
      {composing && canComment && (
        <div className="wccm-thread wccm-compose">
          <p className="wccm-hint">{editor.getSelectedText().trim() ? `On “${editor.getSelectedText().trim().slice(0, 60)}”` : 'Select text in the document, then write your comment.'}</p>
          <MentionBox value={draft} onChange={setDraft} onSubmit={post} people={people} options={options} placeholder="Comment or add others with @" autoFocus />
          {mentioned.length > 0 && (
            <label className="wccm-assign">
              <input type="checkbox" checked={assign} onChange={(e) => setAssign(e.target.checked)} /> Assign to {mentioned[0]!.name}
            </label>
          )}
          <div className="wccm-actions">
            <button type="button" className="wccm-btn" onClick={() => setComposing(false)}>
              Cancel
            </button>
            <button type="button" className="wccm-btn wccm-primary" disabled={!draft.trim()} onClick={post}>
              {assign && mentioned[0] ? 'Assign' : 'Comment'}
            </button>
          </div>
        </div>
      )}
      <div className="wccm-list">
        {shown.length === 0 && <p className="wccm-empty">{filter === 'open' ? 'No open comments.' : 'Nothing here.'}</p>}
        {shown.map((t) => {
          const assignee = assignees.get(t.c.id);
          return (
            <div key={t.c.id} className="wccm-thread" data-resolved={t.c.resolved || undefined}>
              {t.c.quote && (
                <button type="button" className="wccm-quote" onClick={() => go(t.c)} title="Show in the document">
                  {t.c.quote}
                </button>
              )}
              {assignee && (
                <div className="wccm-assigned">
                  Assigned to <strong>{assignee.name}</strong>
                </div>
              )}
              {card(t.c, false, t.c)}
              {t.replies.map((r) => card(r, true, t.c))}
              {canComment && !t.c.resolved && (
                <div className="wccm-replybox">
                  <MentionBox value={replies[t.c.id] ?? ''} onChange={(v) => setReplies((r) => ({ ...r, [t.c.id]: v }))} onSubmit={() => reply(t.c.id)} people={people} options={options} placeholder="Reply or add others with @" />
                  {(replies[t.c.id] ?? '').trim() && (
                    <div className="wccm-actions">
                      <button type="button" className="wccm-btn wccm-primary" onClick={() => reply(t.c.id)}>
                        Reply
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="wccm-live" aria-live="polite">
        {announce}
      </div>
    </aside>
  );
}

/** The number of open comment threads, for a toolbar button. */
export function openThreads(comments: DocComment[]): number {
  return comments.filter((c) => c.parent == null && !c.resolved).length;
}

export function CommentsButton({ count, onClick, children }: { count: number; onClick: () => void; children?: ReactNode }) {
  return (
    <button type="button" className="wccm-launch" onClick={onClick} aria-label={`Comments, ${count} open`}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 5h16v11H11l-5 4v-4H4Z" />
      </svg>
      {count > 0 && <span>{count}</span>}
      {children}
    </button>
  );
}

const CSS = `
.wccm{--bg:var(--wc-bg,#fff);--fg:var(--wc-fg,#1f1f1f);--dim:var(--wc-dim,#5f6368);--line:var(--wc-line,#e0e3e7);--soft:var(--wc-soft,#f1f4f9);--accent:var(--wc-accent,#0b57d0);--accent-soft:var(--wc-accent-soft,#e8f0fe);--accent-fg:var(--wc-accent-fg,#fff);--shadow:0 2px 6px rgba(60,64,67,.15),0 8px 24px rgba(60,64,67,.12);
position:absolute;top:0;right:0;bottom:0;width:min(340px,100%);z-index:6;display:flex;flex-direction:column;background:var(--bg);color:var(--fg);border-left:1px solid var(--line);box-shadow:var(--shadow);font:14px/1.45 "Google Sans Text","Google Sans",Inter,"Segoe UI",system-ui,sans-serif;animation:wccm-in .2s cubic-bezier(.2,.8,.2,1)}
.wccm[data-theme=dark]{--bg:var(--wc-bg,#1e1f20);--fg:var(--wc-fg,#e3e3e3);--dim:var(--wc-dim,#a8abb0);--line:var(--wc-line,#3c4043);--soft:var(--wc-soft,#282a2c);--accent:var(--wc-accent,#a8c7fa);--accent-soft:var(--wc-accent-soft,#0b3a7a);--accent-fg:var(--wc-accent-fg,#062e6f);--shadow:0 2px 6px rgba(0,0,0,.5),0 8px 24px rgba(0,0,0,.45)}
.wccm-sheet{top:auto;left:0;width:auto;height:min(72%,560px);border-left:0;border-top:1px solid var(--line);border-radius:16px 16px 0 0;animation:wccm-up .22s cubic-bezier(.2,.8,.2,1)}
.wccm *{box-sizing:border-box}
.wccm button,.wccm select,.wccm textarea{font:inherit;color:inherit}
.wccm-top{display:flex;align-items:center;gap:8px;padding:14px 10px 8px 18px}
.wccm-top h2{margin:0 auto 0 0;font-size:17px;font-weight:500}
.wccm-icon{width:32px;height:32px;border:0;border-radius:50%;background:transparent;color:var(--dim);cursor:pointer;display:grid;place-items:center;font-size:15px}
.wccm-icon:hover{background:var(--soft);color:var(--fg)}
.wccm-btn{height:32px;padding:0 14px;border:1px solid var(--line);border-radius:16px;background:var(--bg);cursor:pointer;font-size:13px;font-weight:500}
.wccm-btn:hover{background:var(--soft)}
.wccm .wccm-primary{background:var(--accent);border-color:var(--accent);color:var(--accent-fg)}
.wccm-primary:disabled{opacity:.45;cursor:default}
.wccm-filters{display:flex;flex-wrap:wrap;gap:6px;padding:4px 14px 10px;border-bottom:1px solid var(--line)}
.wccm-filters button{height:28px;padding:0 10px;border:1px solid var(--line);border-radius:14px;background:none;cursor:pointer;font-size:12px}
.wccm-filters button[aria-selected=true]{background:var(--accent-soft);border-color:transparent;color:var(--accent);font-weight:500}
.wccm-filters select{height:28px;border:1px solid var(--line);border-radius:14px;background:var(--bg);padding:0 8px;font-size:12px}
.wccm-list{flex:1;overflow:auto;padding:10px 12px 16px;display:grid;gap:10px;align-content:start}
.wccm-thread{border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:var(--bg)}
.wccm-thread[data-resolved]{opacity:.75}
.wccm-compose{margin:10px 12px 0}
.wccm-quote{display:block;width:100%;margin:0 0 8px;padding:2px 0 2px 8px;border:0;border-left:3px solid #f3c74a;background:none;text-align:left;color:var(--dim);font-size:12px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wccm-assigned{margin:0 0 8px;font-size:12px;color:var(--dim)}
.wccm-who{display:flex;align-items:center;gap:8px}
.wccm-avatar{display:inline-grid;place-items:center;border-radius:50%;color:#fff;font-weight:600;flex:none;object-fit:cover}
.wccm-meta{display:grid;margin-right:auto;min-width:0}
.wccm-meta strong{font-size:13px;font-weight:600}
.wccm-meta span{font-size:11px;color:var(--dim)}
.wccm-text{margin:6px 0 0;white-space:pre-wrap;word-break:break-word}
.wccm-reply{margin-top:10px;padding-top:10px;border-top:1px solid var(--line)}
.wccm-mention{color:var(--accent);font-weight:500}
.wccm-more{position:relative}
.wccm-more summary{list-style:none;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;cursor:pointer;color:var(--dim)}
.wccm-more summary::-webkit-details-marker{display:none}
.wccm-more div{position:absolute;right:0;top:34px;z-index:2;min-width:120px;padding:4px 0;background:var(--bg);border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow)}
.wccm-more div button{display:block;width:100%;padding:8px 14px;border:0;background:none;text-align:left;cursor:pointer}
.wccm-more div button:hover{background:var(--soft)}
.wccm-box{position:relative}
.wccm-box textarea{width:100%;min-height:38px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);resize:vertical;outline:none}
.wccm-box textarea:focus{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)}
.wccm-replybox{margin-top:10px}
.wccm-people{position:absolute;left:0;right:0;top:100%;z-index:3;margin-top:4px;padding:4px 0;background:var(--bg);border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow);max-height:220px;overflow:auto}
.wccm-people button{display:flex;align-items:center;gap:8px;width:100%;padding:6px 10px;border:0;background:none;text-align:left;cursor:pointer}
.wccm-people button[aria-selected=true],.wccm-people button:hover{background:var(--soft)}
.wccm-people span{display:grid}
.wccm-people small{color:var(--dim);font-size:11px}
.wccm-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}
.wccm-assign{display:flex;align-items:center;gap:6px;margin-top:6px;font-size:13px}
.wccm-hint{margin:0 0 6px;font-size:12px;color:var(--dim)}
.wccm-empty{color:var(--dim);font-size:13px;text-align:center;margin:24px 0}
.wccm-live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.wccm-launch{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border:1px solid var(--wc-line,#dadce0);border-radius:16px;background:var(--wc-bg,#fff);color:var(--wc-fg,#1f1f1f);box-shadow:0 1px 3px rgba(0,0,0,.12);cursor:pointer;font:500 13px system-ui,sans-serif}
@keyframes wccm-in{from{transform:translateX(16px);opacity:0}to{transform:none;opacity:1}}
@keyframes wccm-up{from{transform:translateY(24px)}to{transform:none}}
@media (prefers-reduced-motion:reduce){.wccm,.wccm *{animation:none!important;transition:none!important}}
`;
