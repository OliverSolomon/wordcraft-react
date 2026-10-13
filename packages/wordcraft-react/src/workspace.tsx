'use client';

/**
 * Access levels (view, comment, suggest, edit), presence avatars and the small row of controls
 * at the editor's bottom right (access chip, comments, people), as in Google Docs.
 *
 * Access is enforced by the editor itself, through WordCraft's Restrict Editing and modes, not
 * only by hiding buttons: typing, paste, drag and drop, AutoCorrect, find and replace and AI
 * results all go through the same commands, and the commands refuse.
 */
import type { CSSProperties, ReactNode } from 'react';

import type { EditorMode, PresenceUser, WordcraftEditor } from './core.js';

/** What a person may do with the document. */
export type Permission = 'view' | 'comment' | 'suggest' | 'edit';

export const PERMISSION_LABEL: Record<Permission, string> = {
  view: 'Viewing',
  comment: 'Commenting',
  suggest: 'Suggesting',
  edit: 'Editing',
};

const RANK: Record<Permission, number> = { view: 0, comment: 1, suggest: 2, edit: 3 };

/** Is `a` less than `b`? */
export function lowerPermission(a: Permission, b: Permission): boolean {
  return RANK[a] < RANK[b];
}

/** Commands no one below Edit may run: they would lift or change the level. */
const LOCKS = ['ui.mode', 'review.restrict', 'file.protect', 'review.trackChanges', 'review.acceptAll', 'review.rejectAll', 'review.accept', 'review.reject'];

/**
 * Put `level` into force: the mode, Restrict Editing and the commands it turns off, on top of the
 * host's own `disabled` list. `allowCopy: false` also stops copying for viewers and commenters.
 */
export function applyPermission(editor: WordcraftEditor, level: Permission, hostDisabled: string[], options: { allowCopy?: boolean; mode?: EditorMode } = {}): void {
  // Lift the locks first, so the level itself can be changed.
  editor.setDisabledCommands(hostDisabled);
  const restrict = level === 'comment' ? 'comments' : level === 'suggest' ? 'trackedChanges' : 'none';
  try {
    editor.execute('review.restrict', { mode: restrict });
  } catch (e) {
    console.warn('[wordcraft] Restrict Editing', e);
  }
  const mode: EditorMode = level === 'view' ? 'viewing' : level === 'suggest' ? 'reviewing' : level === 'comment' ? 'editing' : (options.mode ?? 'editing');
  if (editor.getMode() !== mode) editor.setMode(mode);
  if (level === 'edit') return;
  const extra = [...LOCKS];
  if (options.allowCopy === false && (level === 'view' || level === 'comment')) extra.push('edit.copy', 'edit.cut', 'file.saveAs', 'file.exportPdf', 'file.print');
  editor.setDisabledCommands([...hostDisabled, ...extra]);
}

/** Can a person at `level` add and reply to comments? */
export function canComment(level: Permission): boolean {
  return level !== 'view';
}

/** Can a person at `level` change the text (directly or as suggestions)? */
export function canWrite(level: Permission): boolean {
  return level === 'edit' || level === 'suggest';
}

// ---------------------------------------------------------------------------------------------

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

/**
 * Who is in the document: overlapping avatars with a `+n` counter. Clicking someone follows
 * them (their caret stays in view until you scroll yourself). Use it in your own header too.
 */
export function PresenceAvatars({ users, max = 4, following, onFollow, size = 28 }: { users: PresenceUser[]; max?: number; following?: string | null; onFollow?: (name: string | null) => void; size?: number }) {
  const others = users.filter((u) => !u.self);
  if (!others.length) return null;
  const shown = others.slice(0, max);
  const more = others.length - shown.length;
  return (
    <div className="wcws-avatars" role="group" aria-label={`${others.length} other ${others.length === 1 ? 'person' : 'people'} here`}>
      {shown.map((u) => {
        const label = `${u.name}, ${u.idle ? 'idle' : u.state}${following === u.name ? ' (following)' : ''}`;
        const style: CSSProperties = { width: size, height: size, borderColor: u.color, opacity: u.idle ? 0.5 : 1 };
        return (
          <button
            key={u.clientId}
            type="button"
            className="wcws-avatar"
            data-following={following === u.name || undefined}
            title={label}
            aria-label={onFollow ? `Follow ${label}` : label}
            aria-pressed={onFollow ? following === u.name : undefined}
            style={style}
            onClick={() => onFollow?.(following === u.name ? null : u.name)}
          >
            {u.avatarUrl ? <img src={u.avatarUrl} alt="" /> : <span style={{ background: u.color }}>{u.anonymous ? '?' : initials(u.name)}</span>}
          </button>
        );
      })}
      {more > 0 && (
        <span className="wcws-more" title={others.slice(max).map((u) => u.name).join(', ')} style={{ width: size, height: size }}>
          +{more}
        </span>
      )}
    </div>
  );
}

/** The person's access level, as a chip ("You are commenting"). */
export function AccessChip({ level }: { level: Permission }) {
  if (level === 'edit') return null;
  return (
    <span className="wcws-chip" role="status" title={`You are ${PERMISSION_LABEL[level].toLowerCase()}`}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {level === 'view' ? <path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Zm9.5-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" /> : level === 'comment' ? <path d="M4 5h16v11H11l-5 4v-4H4Z" /> : <path d="M4 20h4L19 9l-4-4L4 16v4Z" />}
      </svg>
      {PERMISSION_LABEL[level]}
    </span>
  );
}

/** The row at the editor's bottom right: access chip, comments button, people. */
export function WorkspaceRow({ children, dark, bottom = 34 }: { children: ReactNode; dark?: boolean; bottom?: number }) {
  return (
    <div className="wcws" data-theme={dark ? 'dark' : 'light'} style={{ bottom }}>
      <style>{CSS}</style>
      {children}
    </div>
  );
}

/** A short notice (the access level changed), dismissed by itself. */
export function Notice({ children, onClose, dark }: { children: ReactNode; onClose: () => void; dark?: boolean }) {
  return (
    <div className="wcws-notice" data-theme={dark ? 'dark' : 'light'} role="alert">
      <style>{CSS}</style>
      <span>{children}</span>
      <button type="button" aria-label="Dismiss" onClick={onClose}>
        ✕
      </button>
    </div>
  );
}

const CSS = `
.wcws,.wcws-notice{--bg:var(--wc-bg,#fff);--fg:var(--wc-fg,#1f1f1f);--dim:var(--wc-dim,#5f6368);--line:var(--wc-line,#dadce0);--accent:var(--wc-accent,#0b57d0);--accent-soft:var(--wc-accent-soft,#e8f0fe)}
.wcws[data-theme=dark],.wcws-notice[data-theme=dark]{--bg:var(--wc-bg,#1e1f20);--fg:var(--wc-fg,#e3e3e3);--dim:var(--wc-dim,#a8abb0);--line:var(--wc-line,#3c4043);--accent:var(--wc-accent,#a8c7fa);--accent-soft:var(--wc-accent-soft,#0b3a7a)}
.wcws{position:absolute;right:14px;z-index:5;display:flex;align-items:center;gap:8px;pointer-events:none;font:500 13px "Google Sans Text",Inter,"Segoe UI",system-ui,sans-serif}
.wcws>*{pointer-events:auto}
.wcws-chip{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border:1px solid var(--line);border-radius:16px;background:var(--bg);color:var(--fg);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.wcws .wccm-launch{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border:1px solid var(--line);border-radius:16px;background:var(--bg);color:var(--fg);box-shadow:0 1px 3px rgba(0,0,0,.12);cursor:pointer;font:inherit}
.wcws .wccm-launch:hover{background:var(--accent-soft)}
.wcws-avatars{display:flex;align-items:center;padding:2px 6px 2px 2px;border:1px solid var(--line);border-radius:18px;background:var(--bg);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.wcws-avatar{position:relative;margin-left:-6px;padding:0;border:2px solid;border-radius:50%;background:var(--bg);cursor:pointer;overflow:hidden;transition:transform .12s}
.wcws-avatar:first-child{margin-left:0}
.wcws-avatar:hover{transform:translateY(-1px);z-index:1}
.wcws-avatar[data-following]{box-shadow:0 0 0 2px var(--bg),0 0 0 4px var(--accent)}
.wcws-avatar img,.wcws-avatar span{display:grid;place-items:center;width:100%;height:100%;object-fit:cover;color:#fff;font-size:11px;font-weight:600}
.wcws-more{display:grid;place-items:center;margin-left:-6px;border-radius:50%;background:var(--accent-soft);color:var(--accent);font-size:11px;font-weight:600}
.wcws-notice{position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:8;display:flex;align-items:center;gap:10px;max-width:calc(100% - 24px);padding:10px 8px 10px 16px;border-radius:10px;background:var(--fg);color:var(--bg);box-shadow:0 4px 16px rgba(0,0,0,.25);font:14px system-ui,sans-serif}
.wcws-notice button{width:28px;height:28px;border:0;border-radius:14px;background:none;color:inherit;cursor:pointer}
@media (prefers-reduced-motion:reduce){.wcws *{transition:none!important}}
`;
