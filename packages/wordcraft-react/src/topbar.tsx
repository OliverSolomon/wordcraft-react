'use client';

/**
 * The host's top bar (✦ Extra): three zones (left, centre, right), each an ordered list of
 * built-in items (back, quick access, title, save state, presence, share, user, comments, history)
 * and the host's own buttons and components. It replaces WordCraft's title bar when given.
 *
 * At narrow widths it gives way in order: the title shortens first, then the avatars collapse to
 * "+N", then Share becomes an icon. Nothing overflows at 360px.
 */
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import type { PresenceUser, WordcraftEditor, WordcraftUser } from './core.js';
import type { IconsOptions, SurfaceContext } from './surfaces.js';

// ---------------------------------------------------------------------------------------------
// Items

export interface TopBarButton {
  type: 'button';
  /** A stable key (defaults to the label). */
  id?: string;
  label: string;
  icon?: ReactNode;
  /** Show only the icon (the label becomes its tooltip and accessible name). */
  iconOnly?: boolean;
  onClick: () => void;
  disabled?: boolean | string;
  className?: string;
  style?: CSSProperties;
}

export interface TopBarCustom {
  type: 'custom';
  id: string;
  render: (ctx: TopBarRenderContext) => ReactNode;
}

export interface TopBarBack {
  type: 'back';
  onClick?: () => void;
  href?: string;
  label?: string;
  icon?: ReactNode;
  /** Ask before leaving with unsaved changes: `true` for the default question, or your own text. */
  confirmUnsaved?: boolean | string;
}

export type QuickAccessEntry = 'undo' | 'redo' | 'save' | 'print' | 'find' | 'separator' | TopBarButton;

export interface TopBarQuickAccess {
  type: 'quickAccess';
  /** Default `['undo', 'redo', 'save']`. */
  items?: QuickAccessEntry[];
}

export interface TopBarTitle {
  type: 'title';
  /** Default: the document's title. */
  text?: string;
  /** Clicking the title (default: version history when it is on). */
  onClick?: () => void;
}

export interface TopBarSaveState {
  type: 'saveState';
  /** Your own words for each state. */
  labels?: { saved?: string; saving?: string; unsaved?: string };
}

export interface TopBarPresence {
  type: 'presence';
  /** Avatars before "+N" (default 4; fewer at narrow widths). */
  max?: number;
}

export interface TopBarShare {
  type: 'share';
  label?: string;
  icon?: ReactNode;
  /** Default: WordCraft's Share (or your `onShare`). */
  onClick?: () => void;
  hidden?: boolean;
  /** Greyed out; a string is the reason, shown as its tooltip. */
  disabled?: boolean | string;
  className?: string;
  style?: CSSProperties;
}

export interface UserMenuItem {
  label: string;
  onClick?: () => void;
  href?: string;
  /** A line above this item. */
  separator?: boolean;
  danger?: boolean;
}

export interface TopBarUser {
  type: 'user';
  /** Default: the editor's `user`. */
  user?: WordcraftUser & { avatarUrl?: string; email?: string };
  menu?: UserMenuItem[];
}

export interface TopBarComments {
  type: 'comments';
}

export interface TopBarHistory {
  type: 'history';
  label?: string;
}

export type TopBarItem =
  | 'back'
  | 'quickAccess'
  | 'title'
  | 'saveState'
  | 'presence'
  | 'share'
  | 'user'
  | 'comments'
  | 'history'
  | TopBarBack
  | TopBarQuickAccess
  | TopBarTitle
  | TopBarSaveState
  | TopBarPresence
  | TopBarShare
  | TopBarUser
  | TopBarComments
  | TopBarHistory
  | TopBarButton
  | TopBarCustom
  | null
  | false
  | undefined;

export interface TopBarOptions {
  left?: TopBarItem[];
  center?: TopBarItem[];
  right?: TopBarItem[];
  /** Height in CSS pixels (default 48). */
  height?: number;
  className?: string;
  style?: CSSProperties;
}

/** `true` for the default bar, the zones, or a function of who is here and what they may do. */
export type TopBarProp = boolean | TopBarOptions | ((ctx: SurfaceContext) => TopBarOptions | boolean);

export const DEFAULT_TOP_BAR: TopBarOptions = {
  left: ['back', 'quickAccess', 'title', 'saveState'],
  right: ['presence', 'comments', 'history', 'share', 'user'],
};

export function resolveTopBar(prop: TopBarProp | undefined, ctx: SurfaceContext): TopBarOptions | null {
  const v = typeof prop === 'function' ? prop(ctx) : prop;
  if (!v) return null;
  return v === true ? DEFAULT_TOP_BAR : v;
}

/** What the bar knows, handed to custom items too. */
export interface TopBarRenderContext extends SurfaceContext {
  editor: WordcraftEditor;
  /** 0 (wide) to 3 (phone width): how much the bar has given way. */
  compact: number;
}

export interface TopBarProps {
  editor: WordcraftEditor;
  options: TopBarOptions;
  context: SurfaceContext;
  icons?: IconsOptions;
  dark?: boolean;
  following?: string | null;
  onFollow?: (name: string | null) => void;
  /** The comments item, when comments are on. */
  comments?: { count: number; onClick: () => void } | null;
  /** The history item, when version history is on. */
  onHistory?: () => void;
  /** Share when the item has no `onClick`. */
  onShare?: () => void;
  /** The measured height, for laying out the page below. */
  onHeight?: (px: number) => void;
  /** A save is on its way to the host. */
  saving?: boolean;
}

// ---------------------------------------------------------------------------------------------

const ICON = {
  back: 'M15 5 8 12l7 7',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  save: 'M5 4h11l3 3v13H5ZM8 4v5h7V4M8 20v-6h8v6',
  print: 'M7 9V4h10v5M7 17H5v-6h14v6h-2M7 14h10v6H7Z',
  find: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20 20l-4-4',
  share: 'M12 3v12M7 8l5-5 5 5M5 13v7h14v-7',
  comments: 'M4 5h16v11H11l-5 4v-4H4Z',
  history: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4M12 8v4l3 2',
};

function Svg({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
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

const reason = (d: boolean | string | undefined) => (typeof d === 'string' ? d : d ? 'Not available' : '');

function norm(i: TopBarItem): Exclude<TopBarItem, string | null | false | undefined> | null {
  if (!i) return null;
  return typeof i === 'string' ? ({ type: i } as Exclude<TopBarItem, string | null | false | undefined>) : i;
}

/** How far the bar gives way at `width`: 0 roomy, 1 fewer avatars, 2 "+N" and an icon Share, 3 phone. */
export function compactLevel(width: number): number {
  return width >= 760 ? 0 : width >= 600 ? 1 : width >= 460 ? 2 : 3;
}

export function TopBar({ editor, options, context, icons = {}, dark, following, onFollow, comments, onHistory, onShare, onHeight, saving }: TopBarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(0);
  const height = options.height ?? 48;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      setCompact(compactLevel(el.getBoundingClientRect().width));
      onHeight?.(el.getBoundingClientRect().height);
    };
    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [onHeight]);

  // Title, save state and undo/redo follow the document.
  const [doc, setDoc] = useState(() => read(editor));
  useEffect(() => {
    const t = window.setInterval(() => {
      if (editor.destroyed) return;
      const next = read(editor);
      setDoc((d) => (d.title === next.title && d.dirty === next.dirty && d.canUndo === next.canUndo && d.canRedo === next.canRedo && d.saving === next.saving ? d : next));
    }, 400);
    return () => window.clearInterval(t);
  }, [editor]);

  const ctx: TopBarRenderContext = { ...context, editor, compact };
  const run = (id: string) => {
    try {
      editor.execute(id);
    } catch (e) {
      console.warn(`[wordcraft] ${id}`, e);
    }
  };

  const zone = (items: TopBarItem[] | undefined, name: string) => {
    const list = (items ?? []).map(norm).filter((x): x is NonNullable<ReturnType<typeof norm>> => !!x);
    if (!list.length) return <div className={`wctb-zone wctb-${name}`} />;
    return (
      <div className={`wctb-zone wctb-${name}`}>
        {list.map((item, i) => {
          const key = `${item.type}-${'id' in item && item.id ? item.id : 'label' in item && item.label ? item.label : i}`;
          return <Fragment key={key}>{renderItem(item)}</Fragment>;
        })}
      </div>
    );
  };

  function renderItem(item: NonNullable<ReturnType<typeof norm>>): ReactNode {
    switch (item.type) {
      case 'back': {
        if (!item.onClick && !item.href) return null;
        const label = item.label ?? 'Back';
        const leave = (e: { preventDefault(): void }) => {
          if (item.confirmUnsaved && !editor.destroyed && editor.isDirty()) {
            const q = typeof item.confirmUnsaved === 'string' ? item.confirmUnsaved : 'You have unsaved changes. Leave anyway?';
            if (!window.confirm(q)) {
              e.preventDefault();
              return;
            }
          }
          if (item.onClick) {
            e.preventDefault();
            item.onClick();
          }
        };
        const body = (
          <>
            {item.icon ?? icons.back ?? <Svg d={ICON.back} />}
            {item.label && compact < 2 && <span className="wctb-text">{item.label}</span>}
          </>
        );
        return item.href ? (
          <a className="wctb-btn wctb-back" href={item.href} onClick={leave} aria-label={label} title={label}>
            {body}
          </a>
        ) : (
          <button type="button" className="wctb-btn wctb-back" onClick={leave} aria-label={label} title={label}>
            {body}
          </button>
        );
      }
      case 'quickAccess': {
        const entries = item.items ?? ['undo', 'redo', 'save'];
        const shown = compact >= 3 ? entries.filter((e) => e === 'undo' || e === 'redo') : entries;
        return (
          <div className="wctb-qat" role="toolbar" aria-label="Quick Access">
            {shown.map((e, i) => {
              if (e === 'separator') return <span key={`s${i}`} className="wctb-sep" aria-hidden="true" />;
              if (typeof e === 'object') return <Fragment key={e.id ?? e.label}>{button({ ...e, iconOnly: e.iconOnly ?? !!e.icon })}</Fragment>;
              const spec = { undo: ['Undo', 'edit.undo', !doc.canUndo], redo: ['Redo', 'edit.redo', !doc.canRedo], save: ['Save', 'file.save', false], print: ['Print', 'file.print', false], find: ['Find', 'edit.find', false] }[e] as [string, string, boolean];
              const [label, id, off] = spec;
              const blocked = !off && !editor.can(id);
              return (
                <button key={e} type="button" className="wctb-btn wctb-icon" title={label} aria-label={label} disabled={off || blocked} onClick={() => run(id)}>
                  <Svg d={ICON[e]} />
                </button>
              );
            })}
          </div>
        );
      }
      case 'title': {
        const text = item.text ?? doc.title;
        const click = item.onClick ?? onHistory;
        return click ? (
          <button type="button" className="wctb-title" title={text} onClick={click}>
            {text}
          </button>
        ) : (
          <span className="wctb-title" title={text}>
            {text}
          </span>
        );
      }
      case 'saveState': {
        if (compact >= 3) return null;
        const l = item.labels ?? {};
        const text = saving ? (l.saving ?? 'Saving…') : doc.dirty ? (l.unsaved ?? 'Unsaved changes') : (l.saved ?? 'Saved');
        return (
          <span className="wctb-state" role="status" data-dirty={doc.dirty || undefined}>
            {text}
          </span>
        );
      }
      case 'presence':
        return <Presence users={context.collaborators} max={Math.min(item.max ?? 4, compact === 0 ? 4 : compact === 1 ? 2 : 0)} following={following} onFollow={onFollow} />;
      case 'share': {
        if (item.hidden) return null;
        const why = reason(item.disabled);
        const label = item.label ?? 'Share';
        const iconOnly = compact >= 2;
        const click = item.onClick ?? onShare ?? (() => run('file.share'));
        return (
          <span className="wctb-tip" title={why || (iconOnly ? label : undefined)}>
            <button type="button" className={`wctb-share${iconOnly ? ' wctb-icon' : ''}${item.className ? ` ${item.className}` : ''}`} style={item.style} disabled={!!why} aria-label={why ? `${label} (${why})` : label} onClick={click}>
              {item.icon ?? icons.share ?? <Svg d={ICON.share} size={16} />}
              {!iconOnly && <span>{label}</span>}
            </button>
          </span>
        );
      }
      case 'user':
        return <UserMenu user={item.user ?? context.user} menu={item.menu ?? []} />;
      case 'comments':
        if (!comments) return null;
        return (
          <button type="button" className="wctb-btn wctb-icon wctb-count" title="Comments" aria-label={`Comments, ${comments.count} open`} onClick={comments.onClick}>
            {icons.comments ?? <Svg d={ICON.comments} />}
            {comments.count > 0 && <span className="wctb-badge">{comments.count}</span>}
          </button>
        );
      case 'history':
        if (!onHistory) return null;
        return (
          <button type="button" className="wctb-btn wctb-icon" title={item.label ?? 'Version history'} aria-label={item.label ?? 'Version history'} onClick={onHistory}>
            {icons.history ?? <Svg d={ICON.history} />}
          </button>
        );
      case 'button':
        return button(item);
      case 'custom':
        return <>{item.render(ctx)}</>;
    }
  }

  function button(b: TopBarButton) {
    const why = reason(b.disabled);
    const iconOnly = (b.iconOnly || compact >= 3) && !!b.icon;
    return (
      <span className="wctb-tip" title={why || (iconOnly ? b.label : undefined)}>
        <button type="button" className={`wctb-btn${iconOnly ? ' wctb-icon' : ''}${b.className ? ` ${b.className}` : ''}`} style={b.style} disabled={!!why} aria-label={why ? `${b.label} (${why})` : b.label} onClick={b.onClick}>
          {b.icon}
          {!iconOnly && <span className="wctb-text">{b.label}</span>}
        </button>
      </span>
    );
  }

  return (
    <div ref={ref} className={`wctb${options.className ? ` ${options.className}` : ''}`} data-theme={dark ? 'dark' : 'light'} data-compact={compact} role="banner" style={{ height, ...options.style }}>
      <style>{CSS}</style>
      {zone(options.left, 'left')}
      {zone(options.center, 'center')}
      {zone(options.right, 'right')}
    </div>
  );
}

function read(editor: WordcraftEditor) {
  try {
    return { title: editor.title(), dirty: editor.isDirty(), canUndo: editor.canUndo(), canRedo: editor.canRedo(), saving: false };
  } catch {
    return { title: '', dirty: false, canUndo: false, canRedo: false, saving: false };
  }
}

/** Collaborators: each in their cursor's colour, click to follow, "+N" for the rest, "Guest" for anyone without a name. */
export function Presence({ users, max = 4, following, onFollow }: { users: PresenceUser[]; max?: number; following?: string | null; onFollow?: (name: string | null) => void }) {
  const others = users.filter((u) => !u.self);
  const [open, setOpen] = useState(false);
  if (!others.length) return null;
  const name = (u: PresenceUser) => (u.anonymous ? 'Guest' : u.name);
  const shown = others.slice(0, max);
  const rest = others.slice(shown.length);
  const avatar = (u: PresenceUser) => {
    const label = `${name(u)}, ${u.idle ? 'idle' : u.state}${following === u.name ? ' (following)' : ''}`;
    return (
      <button
        key={u.clientId}
        type="button"
        className="wctb-avatar"
        data-following={following === u.name || undefined}
        style={{ borderColor: u.color, opacity: u.idle ? 0.55 : 1 }}
        title={label}
        aria-label={`Follow ${label}`}
        aria-pressed={following === u.name}
        onClick={() => {
          onFollow?.(following === u.name ? null : u.name);
          setOpen(false);
        }}
      >
        {u.avatarUrl ? <img src={u.avatarUrl} alt="" /> : <span style={{ background: u.color }}>{u.anonymous ? 'G' : initials(u.name)}</span>}
      </button>
    );
  };
  return (
    <div className="wctb-people" role="group" aria-label={`${others.length} other ${others.length === 1 ? 'person' : 'people'} here`}>
      {shown.map(avatar)}
      {rest.length > 0 && (
        <span className="wctb-pop">
          <button type="button" className="wctb-more" aria-expanded={open} aria-label={`${rest.length} more: ${rest.map(name).join(', ')}`} title={rest.map(name).join(', ')} onClick={() => setOpen((v) => !v)}>
            +{rest.length}
          </button>
          {open && (
            <div className="wctb-menu" role="menu">
              {rest.map((u) => (
                <button key={u.clientId} type="button" role="menuitem" onClick={() => (onFollow?.(u.name), setOpen(false))}>
                  <i style={{ background: u.color }} />
                  {name(u)}
                  {following === u.name ? ' (following)' : ''}
                </button>
              ))}
            </div>
          )}
        </span>
      )}
    </div>
  );
}

function UserMenu({ user, menu }: { user?: WordcraftUser & { avatarUrl?: string; email?: string }; menu: UserMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  if (!user) return null;
  const pic = user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span style={{ background: user.color ?? '#0b57d0' }}>{initials(user.name)}</span>;
  return (
    <span className="wctb-pop" ref={ref}>
      <button type="button" className="wctb-avatar wctb-me" aria-haspopup={menu.length ? 'menu' : undefined} aria-expanded={menu.length ? open : undefined} aria-label={user.name} title={user.name} onClick={() => menu.length && setOpen((v) => !v)}>
        {pic}
      </button>
      {open && menu.length > 0 && (
        <div className="wctb-menu wctb-right" role="menu">
          <div className="wctb-who">
            <strong>{user.name}</strong>
            {user.email && <small>{user.email}</small>}
          </div>
          {menu.map((m, i) => {
            const cls = `${m.separator ? 'wctb-line' : ''}${m.danger ? ' wctb-danger' : ''}`;
            return m.href ? (
              <a key={i} role="menuitem" className={cls} href={m.href} onClick={() => setOpen(false)}>
                {m.label}
              </a>
            ) : (
              <button key={i} type="button" role="menuitem" className={cls} onClick={() => (setOpen(false), m.onClick?.())}>
                {m.label}
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}

const CSS = `
.wctb{--bg:var(--wc-bg,#f9fbfd);--fg:var(--wc-fg,#1f1f1f);--dim:var(--wc-dim,#5f6368);--line:var(--wc-line,#dadce0);--soft:var(--wc-soft,#e9eef6);--accent:var(--wc-accent,#0b57d0);--accent-soft:var(--wc-accent-soft,#c2e7ff);--accent-fg:var(--wc-accent-fg,#fff);
position:relative;z-index:7;box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;min-width:0;padding:0 8px;background:var(--bg);color:var(--fg);border-bottom:1px solid var(--line);font:14px/1.3 "Google Sans Text","Google Sans",Inter,"Segoe UI",system-ui,sans-serif}
.wctb[data-theme=dark]{--bg:var(--wc-bg,#1b1c1d);--fg:var(--wc-fg,#e3e3e3);--dim:var(--wc-dim,#a8abb0);--line:var(--wc-line,#3c4043);--soft:var(--wc-soft,#2a2b2d);--accent:var(--wc-accent,#a8c7fa);--accent-soft:var(--wc-accent-soft,#004a77);--accent-fg:var(--wc-accent-fg,#062e6f)}
.wctb *{box-sizing:border-box}
.wctb button,.wctb a{font:inherit;color:inherit}
.wctb-zone{display:flex;align-items:center;gap:4px;min-width:0}
.wctb-left{flex:1 1 auto;overflow:hidden}
.wctb-center{flex:0 1 auto;justify-content:center;overflow:hidden}
.wctb-right{flex:0 0 auto;justify-content:flex-end}
.wctb-btn{display:inline-flex;align-items:center;gap:6px;flex:none;height:36px;min-width:36px;padding:0 10px;border:0;border-radius:18px;background:none;cursor:pointer;text-decoration:none}
.wctb-icon{justify-content:center;width:36px;padding:0}
.wctb-btn:hover:not(:disabled),.wctb-title:hover{background:var(--soft)}
.wctb-btn:focus-visible,.wctb-share:focus-visible,.wctb-title:focus-visible,.wctb-avatar:focus-visible,.wctb-more:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.wctb button:disabled{opacity:.4;cursor:default}
.wctb-qat{display:flex;align-items:center;flex:none}
.wctb-sep{width:1px;height:20px;margin:0 4px;background:var(--line)}
.wctb-title{flex:0 1 auto;min-width:24px;max-width:100%;height:32px;padding:0 8px;border:0;border-radius:6px;background:none;font-size:18px!important;font-weight:400;line-height:32px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left;cursor:pointer}
span.wctb-title{cursor:default}
.wctb-state{flex:none;color:var(--dim);font-size:12px;white-space:nowrap}
.wctb-state[data-dirty]{color:var(--fg)}
.wctb-share{display:inline-flex;align-items:center;justify-content:center;gap:8px;flex:none;height:36px;padding:0 18px;border:0;border-radius:18px;background:var(--accent-soft);color:var(--fg);font-weight:500!important;cursor:pointer}
.wctb-share.wctb-icon{width:36px;padding:0}
.wctb-share:hover:not(:disabled){filter:brightness(.96)}
.wctb-tip{display:inline-flex;flex:none}
.wctb-people{display:flex;align-items:center;flex:none;padding-left:6px}
.wctb-avatar{position:relative;display:grid;place-items:center;flex:none;width:32px;height:32px;margin-left:-6px;padding:0;border:2px solid transparent;border-radius:50%;background:var(--bg);cursor:pointer;overflow:hidden;transition:transform .12s}
.wctb-avatar:first-child,.wctb-me{margin-left:0}
.wctb-avatar:hover{transform:translateY(-1px);z-index:1}
.wctb-avatar[data-following]{box-shadow:0 0 0 2px var(--bg),0 0 0 4px var(--accent)}
.wctb-avatar img,.wctb-avatar span{display:grid;place-items:center;width:100%;height:100%;border-radius:50%;object-fit:cover;color:#fff;font-size:11px;font-weight:600}
.wctb-more{display:grid;place-items:center;width:32px;height:32px;margin-left:-6px;border:2px solid var(--bg);border-radius:50%;background:var(--soft);font-size:11px;font-weight:600;cursor:pointer}
.wctb-people .wctb-pop:first-child .wctb-more{margin-left:0}
.wctb-count{position:relative}
.wctb-badge{position:absolute;top:3px;right:2px;min-width:15px;height:15px;padding:0 4px;border-radius:8px;background:var(--accent);color:var(--accent-fg);font-size:10px;font-weight:600;line-height:15px;text-align:center}
.wctb-pop{position:relative;display:inline-flex;flex:none}
.wctb-menu{position:absolute;top:calc(100% + 6px);left:0;z-index:9;min-width:200px;max-width:min(280px,calc(100vw - 16px));padding:6px 0;background:var(--bg);border:1px solid var(--line);border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.18)}
.wctb-menu.wctb-right,.wctb-right .wctb-menu{left:auto;right:0}
.wctb-menu button,.wctb-menu a{display:flex;align-items:center;gap:8px;width:100%;padding:8px 14px;border:0;background:none;text-align:left;cursor:pointer;text-decoration:none}
.wctb-menu button:hover,.wctb-menu a:hover{background:var(--soft)}
.wctb-menu i{width:10px;height:10px;border-radius:50%}
.wctb-who{display:grid;padding:6px 14px 8px;border-bottom:1px solid var(--line);margin-bottom:4px}
.wctb-who small{color:var(--dim)}
.wctb-line{border-top:1px solid var(--line)!important}
.wctb-danger{color:#b3261e!important}
.wctb-text{white-space:nowrap}
.wctb[data-compact="3"]{gap:4px;padding:0 4px}
.wctb[data-compact="3"] .wctb-title{font-size:16px!important}
@media (prefers-reduced-motion:reduce){.wctb *{transition:none!important}}
`;
