'use client';

/**
 * Originality (an Extra): similarity against your organisation's own documents (the private
 * default), a plagiarism service you choose, and a soft AI-writing signal. Nothing runs until the
 * person asks, nothing is written into the file, and nothing ever blocks saving, sharing or
 * exporting. A document marked sensitive sends nothing at all.
 */
import { useState } from 'react';

import type { WordcraftEditor } from './core.js';
import { indexDocument, rangesFor } from './doc-text.js';
import type { DocIndex, MarkLayers } from './doc-text.js';
import { completeText } from './ai-run.js';
import type { AiSource } from './ai-run.js';
import { ICONS, PanelIcon, SidePanel } from './panel.js';

export interface PlagiarismMatch {
  /** UTF-16 offsets in the text that was sent. */
  start: number;
  end: number;
  /** 0 to 1. */
  similarity: number;
  sourceTitle: string;
  url?: string;
}

export interface CorpusMatch extends PlagiarismMatch {
  /** The matching passage in your own document, to show beside it. */
  snippet?: string;
}

export interface OriginalityOptions {
  /** The service's name, shown in the notice of what is sent ("Copyleaks", "our server"). */
  vendor?: string;
  /** A plagiarism service. */
  checkPlagiarism?: (text: string, ctx: { signal: AbortSignal }) => Promise<{ score: number; matches: PlagiarismMatch[] }>;
  /** An AI-writing detector. Its result is only ever shown as a soft, per-paragraph signal. */
  detectAi?: (text: string, ctx: { signal: AbortSignal }) => Promise<{ score: number; spans: Array<{ start: number; end: number; likelihood: number }> }>;
  /** Your own documents: near matches to reused grant text, boilerplate and so on. Nothing leaves your organisation. */
  corpus?: { search(text: string, ctx: { signal: AbortSignal }): Promise<CorpusMatch[]> };
}

interface Report {
  similarity: number;
  matches: Array<(PlagiarismMatch | CorpusMatch) & { own: boolean; ranges: ReturnType<typeof rangesFor> }>;
  aiParas: Array<{ para: number; likelihood: number }>;
  at: string;
}

const MATCH_COLOR = '#f9ab00';
const AI_COLOR = '#a142f4';

export function OriginalityPanel({ editor, options, ai, sensitive, canWrite, marks, onClose, dark, sheet }: { editor: WordcraftEditor; options: OriginalityOptions; ai: AiSource | null; sensitive?: boolean; canWrite: boolean; marks: MarkLayers; onClose: () => void; dark?: boolean; sheet?: boolean }) {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [index, setIndex] = useState<DocIndex | null>(null);
  const [rewriting, setRewriting] = useState<number | null>(null);
  const kinds = [options.corpus && 'your organisation’s documents', options.checkPlagiarism && (options.vendor ?? 'the plagiarism service'), options.detectAi && `${options.vendor ?? 'the'} AI-writing detector`].filter(Boolean) as string[];

  const run = async () => {
    setBusy(true);
    setError('');
    const ctl = new AbortController();
    const idx = indexDocument(editor);
    setIndex(idx);
    const text = idx.text;
    const matches: Report['matches'] = [];
    let similarity = 0;
    const aiParas: Report['aiParas'] = [];
    const errs: string[] = [];
    await Promise.all([
      options.corpus
        ?.search(text, { signal: ctl.signal })
        .then((ms) => ms.forEach((m) => matches.push({ ...m, own: true, ranges: rangesFor(idx, m.start, m.end) })))
        .catch((e: unknown) => errs.push(`Your documents: ${e instanceof Error ? e.message : String(e)}`)),
      options.checkPlagiarism?.(text, { signal: ctl.signal })
        .then((r) => {
          similarity = r.score;
          r.matches.forEach((m) => matches.push({ ...m, own: false, ranges: rangesFor(idx, m.start, m.end) }));
        })
        .catch((e: unknown) => errs.push(`${options.vendor ?? 'Plagiarism check'}: ${e instanceof Error ? e.message : String(e)}`)),
      options.detectAi?.(text, { signal: ctl.signal })
        .then((r) => {
          const per = new Map<number, number>();
          for (const s of r.spans) for (const g of rangesFor(idx, s.start, s.end)) per.set(g.para, Math.max(per.get(g.para) ?? 0, s.likelihood));
          per.forEach((likelihood, para) => likelihood >= 0.5 && aiParas.push({ para, likelihood }));
        })
        .catch((e: unknown) => errs.push(`AI-writing signal: ${e instanceof Error ? e.message : String(e)}`)),
    ]);
    // Overall similarity: the vendor's score, else the share of text covered by matches.
    if (!options.checkPlagiarism && matches.length) {
      const covered = new Set<number>();
      matches.forEach((m) => {
        for (let i = m.start; i < m.end && i < text.length; i++) covered.add(i);
      });
      similarity = covered.size / Math.max(1, text.replace(/\n/g, '').length);
    }
    matches.sort((a, b) => b.similarity - a.similarity);
    setReport({ similarity: Math.max(0, Math.min(1, similarity > 1 ? similarity / 100 : similarity)), matches, aiParas: aiParas.sort((a, b) => a.para - b.para), at: new Date().toISOString() });
    marks.set(
      'originality',
      matches.flatMap((m, i) => m.ranges.map((r, k) => ({ id: `orig:${i}:${k}`, path: r.path, start: r.start, end: r.end, color: MATCH_COLOR, style: 'highlight' as const }))),
    );
    setError(errs.join(' '));
    setBusy(false);
  };

  const close = () => {
    marks.clear('originality');
    onClose();
  };

  const cite = (m: Report['matches'][number]) => {
    const r = m.ranges[m.ranges.length - 1];
    if (!r) return;
    try {
      editor.selectText(r.path, r.end, r.end);
      editor.execute('references.citation', { source: { kind: m.url ? 'website' : 'report', title: m.sourceTitle, url: m.url ?? '', year: '', author: '' } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const rewrite = async (m: Report['matches'][number], i: number) => {
    if (!ai || !index) return;
    const r = m.ranges[0];
    const p = r && editor.paragraphs().find((q) => q.path.join() === r.path.join());
    if (!r || !p) return;
    const passage = p.text.slice(r.start, r.end);
    setRewriting(i);
    try {
      const out = await completeText(ai, { action: 'rewrite', selection: passage, prompt: 'Say it in new words, keeping the meaning and any facts exactly.', document: '' });
      editor.selectText(r.path, r.start, r.end);
      editor.execute('text.insert', { text: out.trim() });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRewriting(null);
    }
  };

  return (
    <SidePanel title="Originality" icon={<PanelIcon d={ICONS.shield} />} onClose={close} dark={dark} sheet={sheet}>
      <div className="wcsp-body">
        {sensitive ? (
          <p className="wcsp-note">This document is marked sensitive, so originality checks are off and nothing is sent.</p>
        ) : (
          <>
            <p className="wcsp-note">
              Checking sends the document's text to {kinds.join(', ') || 'nothing (no service is set up)'}. Results are not saved in the file and never stop you saving, sharing or exporting.
            </p>
            <button type="button" className="wcsp-btn wcsp-primary" disabled={busy || !kinds.length} onClick={() => void run()}>
              {busy ? 'Checking…' : report ? 'Check again' : 'Check originality'}
            </button>
            {report && (
              <>
                <div className="wcsp-card">
                  <div className="wcsp-row">
                    <span className="wcsp-score">{Math.round(report.similarity * 100)}%</span>
                    <div className="wcsp-grow">
                      <strong>Similarity</strong>
                      <div className="wcsp-dim">
                        {report.matches.length} matched passage{report.matches.length === 1 ? '' : 's'}
                      </div>
                    </div>
                  </div>
                </div>
                {report.matches.map((m, i) => (
                  <div key={i} className="wcsp-card">
                    <div className="wcsp-row">
                      <span className="wcsp-dot" style={{ background: MATCH_COLOR }} />
                      <strong className="wcsp-grow">{m.url ? <a href={m.url} target="_blank" rel="noreferrer noopener">{m.sourceTitle}</a> : m.sourceTitle}</strong>
                      <span className="wcsp-dim">{Math.round(m.similarity * 100)}%</span>
                    </div>
                    <p className="wcsp-dim">{m.own ? 'One of your organisation’s documents' : options.vendor ?? 'Web source'}</p>
                    {'snippet' in m && m.snippet && <p className="wcsp-dim">“{m.snippet.slice(0, 160)}”</p>}
                    <div className="wcsp-row">
                      <button
                        type="button"
                        className="wcsp-btn wcsp-small"
                        onClick={() => {
                          const r = m.ranges[0];
                          if (r) {
                            editor.selectText(r.path, r.start, r.end);
                            marks.flash(r.path, r.start, r.end, MATCH_COLOR);
                          }
                        }}
                      >
                        Go to
                      </button>
                      {canWrite && (
                        <button type="button" className="wcsp-btn wcsp-small" onClick={() => cite(m)}>
                          Add citation
                        </button>
                      )}
                      {canWrite && ai && (
                        <button type="button" className="wcsp-btn wcsp-small" disabled={rewriting !== null} onClick={() => void rewrite(m, i)}>
                          {rewriting === i ? 'Rewriting…' : 'Rewrite'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {report.aiParas.length > 0 && index && (
                  <div className="wcsp-card">
                    <h3>AI-writing signal</h3>
                    <p className="wcsp-dim">Detectors are often wrong, especially for people writing in a second language. Treat this as a prompt to look, never as a verdict.</p>
                    {report.aiParas.map(({ para, likelihood }) => {
                      const p = index.paragraphs[para];
                      return (
                        <button
                          key={para}
                          type="button"
                          className="wcsp-item"
                          onClick={() => {
                            editor.selectText(p.path, 0, 0);
                            marks.flash(p.path, 0, p.text.length, AI_COLOR);
                          }}
                        >
                          <span className="wcsp-dot" style={{ background: AI_COLOR, opacity: 0.4 + likelihood * 0.6 }} />
                          <span className="wcsp-grow wcsp-dim">
                            “{p.text.slice(0, 60)}…” may contain AI-generated text ({likelihood >= 0.85 ? 'medium' : 'low'} confidence)
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {!report.matches.length && !report.aiParas.length && <p className="wcsp-empty">No matches found.</p>}
              </>
            )}
            {error && (
              <p className="wcsp-note" role="status">
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </SidePanel>
  );
}
