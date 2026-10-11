'use client';

/**
 * An AI writing bar at the bottom of the editor, in the spirit of Google Docs' "Help me write":
 * describe what you want, or pick a quick action for the selected text, preview the answer, then
 * insert it, replace the selection with it, try again or discard it.
 *
 * The package never calls an AI service itself: `complete` is your function (usually a call to
 * your own API route), so any model and any provider works.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';

import type { WordcraftEditor } from './core.js';
import type { AiAction, AiRequest } from './ai-core.js';
export { describeAiRequest } from './ai-core.js';
export type { AiAction, AiRequest } from './ai-core.js';

export interface AiOptions {
  /** Produce the text: return it whole, or stream it as an async iterable of chunks. */
  complete(request: AiRequest): Promise<string> | AsyncIterable<string>;
  /** The bar's label. Default "Help me write". */
  label?: string;
  /** Where the bar sits. `none` hides it (open it with `openAiBar()` on the ref instead). */
  placement?: 'bottom' | 'none';
}

const ACTIONS_WITH_SELECTION: Array<[AiAction, string]> = [
  ['rewrite', 'Rewrite'],
  ['shorten', 'Shorten'],
  ['elaborate', 'Elaborate'],
  ['formal', 'More formal'],
  ['casual', 'More casual'],
  ['fix', 'Fix spelling & grammar'],
  ['summarize', 'Summarize'],
];
const ACTIONS_WITHOUT_SELECTION: Array<[AiAction, string]> = [
  ['continue', 'Continue writing'],
  ['summarize', 'Summarize document'],
];

/** Put plain text into the document at the caret (replacing a selection), paragraph by paragraph. */
export function insertText(editor: WordcraftEditor, text: string): void {
  const paras = text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').split(/\n\n|\n/);
  paras.forEach((p, i) => {
    if (i > 0) editor.execute('text.newParagraph');
    if (p) editor.execute('text.insert', { text: p });
  });
}

const Sparkle = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
    <path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9z" fill="currentColor" />
    <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" fill="currentColor" opacity=".7" />
  </svg>
);

export interface AiBarProps {
  editor: WordcraftEditor | null;
  options: AiOptions;
  /** Open on mount (or when this becomes true). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Distance from the bottom of the editor, clearing WordCraft's status bar. */
  bottom?: number;
  dark?: boolean;
}

/** The AI bar. `<WordcraftEditor ai={...} />` renders it for you. */
export function AiBar({ editor, options, open: openProp, onOpenChange, bottom = 34, dark }: AiBarProps) {
  const [open, setOpen] = useState(!!openProp);
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selection, setSelection] = useState('');
  const last = useRef<{ action: AiAction; prompt: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const show = useCallback(
    (v: boolean) => {
      setOpen(v);
      onOpenChange?.(v);
      if (v && editor && !editor.destroyed) setSelection(editor.getSelectedText());
      if (!v) {
        abort.current?.abort();
        setResult('');
        setError('');
        setBusy(false);
      }
    },
    [editor, onOpenChange],
  );
  useEffect(() => {
    if (openProp !== undefined && openProp !== open) show(openProp);
  }, [openProp]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const run = async (action: AiAction, text: string) => {
    if (!editor || editor.destroyed) return;
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    last.current = { action, prompt: text };
    setBusy(true);
    setError('');
    setResult('');
    try {
      const out = options.complete({ prompt: text, action, selection, document: editor.getText(), signal: ctl.signal });
      if (typeof (out as AsyncIterable<string>)[Symbol.asyncIterator] === 'function') {
        let acc = '';
        for await (const chunk of out as AsyncIterable<string>) {
          if (ctl.signal.aborted) return;
          acc += chunk;
          setResult(acc);
        }
      } else {
        const whole = await (out as Promise<string>);
        if (!ctl.signal.aborted) setResult(whole);
      }
    } catch (e) {
      if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (abort.current === ctl) setBusy(false);
    }
  };

  const accept = (mode: 'replace' | 'below') => {
    if (!editor || editor.destroyed || !result) return;
    if (mode === 'below' && selection) {
      // Leave the selection and add the text after it, in a new paragraph.
      editor.execute('caret.right');
      editor.execute('text.newParagraph');
    }
    insertText(editor, result.trim());
    show(false);
    setPrompt('');
    editor.canvas.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (prompt.trim()) void run('write', prompt.trim());
    } else if (e.key === 'Escape') {
      show(false);
    }
  };

  if (options.placement === 'none' && !open) return null;

  const c = dark
    ? { bg: '#2b2b2b', fg: '#f0f0f0', dim: '#b5b5b5', border: '#4a4a4a', chip: '#383838', accent: '#8ab4f8', accentFg: '#1b1b1b' }
    : { bg: '#ffffff', fg: '#1f1f1f', dim: '#5f6368', border: '#dadce0', chip: '#f1f3f4', accent: '#2b579a', accentFg: '#ffffff' };
  const font = '13px Inter, "Segoe UI", system-ui, sans-serif';
  const btn: CSSProperties = { border: `1px solid ${c.border}`, background: c.bg, color: c.fg, borderRadius: 16, padding: '5px 12px', font, cursor: 'pointer' };
  const primary: CSSProperties = { ...btn, background: c.accent, color: c.accentFg, borderColor: c.accent };
  const wrap: CSSProperties = { position: 'absolute', left: 0, right: 0, bottom, display: 'flex', justifyContent: 'center', pointerEvents: 'none', zIndex: 5 };

  if (!open) {
    return (
      <div style={wrap}>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => show(true)}
          style={{ ...btn, pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 1px 3px rgba(0,0,0,.18)', color: c.accent, fontWeight: 600 }}
        >
          <Sparkle /> {options.label ?? 'Help me write'}
        </button>
      </div>
    );
  }

  const chips = selection ? ACTIONS_WITH_SELECTION : ACTIONS_WITHOUT_SELECTION;
  return (
    <div style={wrap}>
      <div
        role="dialog"
        aria-label={options.label ?? 'Help me write'}
        style={{ pointerEvents: 'auto', width: 'min(640px, calc(100% - 32px))', background: c.bg, color: c.fg, border: `1px solid ${c.border}`, borderRadius: 12, boxShadow: '0 4px 16px rgba(0,0,0,.18)', padding: 12, font, display: 'grid', gap: 8 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: c.accent, fontWeight: 600 }}>
          <Sparkle /> {options.label ?? 'Help me write'}
          {selection && <span style={{ color: c.dim, fontWeight: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>· about the selected text</span>}
          <button type="button" aria-label="Close" onClick={() => show(false)} style={{ marginLeft: 'auto', border: 0, background: 'none', color: c.dim, cursor: 'pointer', font: '18px system-ui', lineHeight: 1 }}>
            ×
          </button>
        </div>
        {result || busy || error ? (
          <div
            aria-live="polite"
            style={{ maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap', border: `1px solid ${c.border}`, borderRadius: 8, padding: 10, background: c.chip, color: error ? '#c5221f' : c.fg }}
          >
            {error || result || 'Writing…'}
          </div>
        ) : null}
        {result && !busy ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" style={primary} onClick={() => accept('replace')}>
              {selection ? 'Replace' : 'Insert'}
            </button>
            {selection && (
              <button type="button" style={btn} onClick={() => accept('below')}>
                Insert below
              </button>
            )}
            <button type="button" style={btn} onClick={() => last.current && void run(last.current.action, last.current.prompt)}>
              Try again
            </button>
            <button type="button" style={btn} onClick={() => setResult('')}>
              Discard
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <textarea
                ref={input}
                rows={1}
                value={prompt}
                placeholder={selection ? 'How should it change? e.g. "make it friendlier"' : 'Describe what to write, e.g. "an intro paragraph about our project"'}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={onKey}
                style={{ flex: 1, resize: 'none', border: `1px solid ${c.border}`, borderRadius: 8, padding: '8px 10px', font, background: c.bg, color: c.fg, minHeight: 36 }}
              />
              {busy ? (
                <button type="button" style={btn} onClick={() => abort.current?.abort()}>
                  Stop
                </button>
              ) : (
                <button type="button" style={primary} disabled={!prompt.trim()} onClick={() => void run('write', prompt.trim())}>
                  Create
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {chips.map(([action, label]) => (
                <button key={action} type="button" disabled={busy} style={{ ...btn, background: c.chip, borderColor: 'transparent', padding: '4px 10px' }} onClick={() => void run(action, '')}>
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
