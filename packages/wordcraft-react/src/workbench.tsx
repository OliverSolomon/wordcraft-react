'use client';

/**
 * The buttons beside the comments and avatars (bottom right) that open the Extras' panels: Ask
 * this document, Writing checks, and a Tools menu for the rest. Also the "Edit diagram" chip over
 * a selected diagram.
 */
import { useEffect, useState } from 'react';

import type { SelectionInfo, WordcraftEditor } from './core.js';
import type { IconsOptions } from './surfaces.js';
import { AiStar } from './ai.js';
import { DIAGRAM_TITLE } from './blocks.js';

export type PanelId = 'chat' | 'checks' | 'originality' | 'outline' | 'accessibility' | 'sources' | 'count' | 'translate';

export const PANEL_LABEL: Record<PanelId, string> = {
  chat: 'Ask this document',
  checks: 'Writing checks',
  originality: 'Originality',
  outline: 'Outline',
  accessibility: 'Accessibility',
  sources: 'Sources and bibliography',
  count: 'Word count',
  translate: 'Translate document',
};

export function ToolsBar({ available, open, onOpen, issues, voice, icons = {} }: { available: PanelId[]; open: PanelId | null; onOpen: (p: PanelId | null) => void; issues: number; voice?: { on: boolean; toggle: () => void; error: string } | null; icons?: IconsOptions }) {
  const [menu, setMenu] = useState(false);
  const rest = available.filter((p) => p !== 'chat' && p !== 'checks');
  return (
    <>
      <style>{CSS}</style>
      {available.includes('chat') && open !== 'chat' && (
        <button type="button" className="wccm-launch wcwb-ask" onClick={() => onOpen('chat')} title="Ask this document (an Extra)">
          {icons.ask ?? <AiStar size={16} />} Ask
        </button>
      )}
      {available.includes('checks') && open !== 'checks' && (
        <button type="button" className="wccm-launch" onClick={() => onOpen('checks')} title="Writing checks (an Extra)" aria-label={`Writing checks, ${issues} suggestions`}>
          {icons.checks ?? <span className="wcwb-dot" data-zero={issues === 0 ? '' : undefined} />} {issues}
        </button>
      )}
      {voice && (
        <button type="button" className="wccm-launch" aria-pressed={voice.on} onClick={voice.toggle} title={voice.error || (voice.on ? 'Stop voice typing' : 'Voice typing')}>
          {icons.voice ?? (
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <path fill={voice.on ? '#d93025' : 'currentColor'} d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
            </svg>
          )}
          {voice.on ? 'Listening' : ''}
        </button>
      )}
      {rest.length > 0 && (
        <span className="wcwb-anchor">
          <button type="button" className="wccm-launch" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            {icons.tools}
            Tools ▾
          </button>
          {menu && (
            <span className="wcwb-menu" role="menu" onMouseLeave={() => setMenu(false)}>
              {rest.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    onOpen(p);
                  }}
                >
                  {PANEL_LABEL[p]}
                </button>
              ))}
            </span>
          )}
        </span>
      )}
    </>
  );
}

/** "Edit diagram" over a selected picture made from a Mermaid diagram. */
export function DiagramChip({ editor, onEdit }: { editor: WordcraftEditor; onEdit: (source: string) => void }) {
  const [at, setAt] = useState<{ x: number; y: number; source: string } | null>(null);
  useEffect(
    () =>
      editor.onSelection((info: SelectionInfo) => {
        if (!info.contextual.includes('Picture Format') || !info.rect || info.scrolling) return setAt(null);
        try {
          const o = editor.selectedObject();
          if (o?.title?.startsWith(DIAGRAM_TITLE)) setAt({ x: info.rect.x, y: Math.max(4, info.rect.y - 40), source: o.title.slice(DIAGRAM_TITLE.length) });
          else setAt(null);
        } catch {
          setAt(null);
        }
      }),
    [editor],
  );
  if (!at) return null;
  return (
    <button type="button" className="wccm-launch wcwb-chip" style={{ position: 'absolute', left: at.x, top: at.y, zIndex: 7 }} onMouseDown={(e) => e.preventDefault()} onClick={() => onEdit(at.source)}>
      <style>{CSS}</style>
      <AiStar size={14} /> Edit diagram
    </button>
  );
}

const CSS = `
.wcwb-anchor{position:relative;display:inline-flex}
.wcwb-menu{position:absolute;right:0;bottom:38px;z-index:8;display:grid;min-width:210px;padding:6px;border:1px solid var(--line,#dadce0);border-radius:12px;background:var(--bg,#fff);box-shadow:0 4px 18px rgba(0,0,0,.18)}
.wcwb-menu button{height:34px;padding:0 12px;border:0;border-radius:8px;background:none;color:var(--fg,#1f1f1f);text-align:left;cursor:pointer;font:inherit}
.wcwb-menu button:hover{background:var(--accent-soft,#e8f0fe)}
.wcwb-dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:conic-gradient(#d93025 0 25%,#1a73e8 0 50%,#188038 0 75%,#9334e6 0)}
.wcwb-dot[data-zero]{background:#188038}
.wcwb-chip{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border:1px solid #dadce0;border-radius:15px;background:#fff;color:#1f1f1f;box-shadow:0 1px 4px rgba(0,0,0,.18);cursor:pointer;font:500 13px system-ui,sans-serif}
.wccm-launch[aria-pressed=true]{border-color:#d93025}
`;
