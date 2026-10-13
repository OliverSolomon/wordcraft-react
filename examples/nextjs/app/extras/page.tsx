'use client';

import { useEffect, useMemo, useState } from 'react';
import * as WC from '@gamine/wordcraft-react';
import {
  WordcraftEditor,
  languageTool,
  llmChecker,
  plainLanguageChecker,
  type AiOptions,
  type AiRequest,
  type Checker,
  type DataTable,
  type HostAction,
  type OriginalityOptions,
  type Permission,
} from '@gamine/wordcraft-react';
import { ai as liveAi } from '../ai';

/**
 * The 0.3.5 Extras in one place: document chat, writing checks, originality, the tools panels,
 * AI that builds structure (tables, diagrams, charts…), the slash menu, palettes from a logo and
 * logo placement. Used by smoke-extras.mjs.
 *
 * /extras?mock=1 answers every AI request with a deterministic test model in the browser, and
 * mocks the organisation corpus, the AI-writing detector and the data picker, so the acceptance
 * tests need no network. Without it the AI goes to /api/ai like the other examples.
 * ?permission=view|comment|suggest|edit and ?sensitive=1 set those props.
 */

const GRANTS: DataTable = {
  label: 'Grants.xlsx',
  columns: ['Funder', 'Amount', 'Deadline'],
  rows: [
    ['Acme Trust', 25000, '2026-12-01'],
    ['Baobab Fund', 40000, '2027-02-15'],
    ['Coral Foundation', 12500, '2026-11-20'],
  ],
};

/** A test model: the same answer for the same request, shaped like a real model's. */
async function* mockComplete(r: AiRequest): AsyncIterable<string> {
  let out = '';
  if (r.action === 'ask') {
    const n = (r.document.match(/^\[(\d+)\][^\n]*budget/im) ?? r.document.match(/^\[(\d+)\]/m))?.[1] ?? '1';
    out = `The document answers this in one place [${n}]. It is the passage to read first [${n}].`;
  } else if (r.action === 'check') {
    out = r.selection.includes('utilise') ? '[{"text":"utilise","category":"clarity","message":"A plainer word reads better.","replacements":["use"],"confidence":0.9}]' : '[]';
  } else if (r.action === 'translate') {
    out = `[${r.prompt.split('.')[0]}] ${r.selection}`;
  } else if (r.action === 'structure') {
    const p = r.prompt.toLowerCase();
    if (p.includes('script')) out = '```json\n[{"type":"paragraph","text":"Safe <script>window.__pwned=1</script> text"},{"type":"image","src":"https://evil.example/x.png","alt":"remote"},{"type":"table","columns":["A<img src=x onerror=window.__pwned=2>"],"rows":[["1"]]}]\n```';
    else if (p.includes('diagram') || p.includes('flowchart')) out = '```json\n[{"type":"diagram","source":"flowchart TD\\n  A[Survivor reaches out] --> B{Safe to talk?}\\n  B -->|Yes| C[Intake call]\\n  B -->|No| D[Safety plan]\\n  C --> E[Referral]","alt":"Flowchart of the case referral process: reach out, safety check, intake call or safety plan, referral."}]\n```';
    else if (p.includes('chart')) out = '```json\n[{"type":"chart","chart":"column","title":"Grant amounts by funder","categories":["Acme Trust","Baobab Fund","Coral Foundation"],"series":[{"name":"Amount","values":[25000,40000,12500]}],"xTitle":"Funder","yTitle":"Amount (USD)"}]\n```';
    else if (r.data) {
      // With data: sorted by amount, with a total, every value from the data.
      const rows = GRANTS.rows.slice().sort((a, b) => Number(b[1]) - Number(a[1]));
      out = JSON.stringify([{ type: 'table', columns: GRANTS.columns, rows: [...rows.map((x) => x.map(String)), ['Total', '77500', '']], total: true }]);
    } else out = '```json\n[{"type":"table","columns":["Funder","Amount","Deadline"],"rows":[["Acme Trust","[number]","[to confirm]"],["Baobab Fund","[number]","[to confirm]"],["Coral Foundation","[number]","[to confirm]"]],"align":["left","right","left"]}]\n```';
  } else out = 'Here is a short paragraph from the test model.';
  for (const w of out.match(/.{1,24}/gs) ?? []) {
    if (r.signal.aborted) return;
    yield w;
    await new Promise((res) => setTimeout(res, 5));
  }
}

const corpus: OriginalityOptions['corpus'] = {
  async search(text) {
    const needle = 'survivor-centred referral network';
    const at = text.toLowerCase().indexOf(needle);
    return at < 0 ? [] : [{ start: at, end: at + needle.length, similarity: 0.92, sourceTitle: '2025 grant proposal (Ford)', snippet: 'a survivor-centred referral network across five counties' }];
  },
};

export default function ExtrasPage() {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => setQ(new URLSearchParams(window.location.search)), []);
  const mock = q?.get('mock') === '1';
  const permission = (q?.get('permission') as Permission) ?? 'edit';
  const sensitive = q?.get('sensitive') === '1';
  const [translated, setTranslated] = useState('');

  const actions: HostAction[] = useMemo(
    () => [
      {
        id: 'donor',
        label: 'Our standard donor paragraph',
        icon: '♥',
        run: () => [{ type: 'paragraph', text: 'Your gift funds **safe referrals** for survivors. Thank you.' }],
      },
    ],
    [],
  );

  const aiOptions: AiOptions = useMemo(() => {
    const base: AiOptions = mock ? { complete: (r) => mockComplete(r), allowUserKey: false } : liveAi;
    const checkers: Checker[] = [plainLanguageChecker(), llmChecker(mock ? { complete: (r) => mockComplete(r), allowUserKey: false } : liveAi)];
    const lt = q?.get('languagetool');
    if (lt) checkers.push(languageTool({ url: lt }));
    return {
      ...base,
      structure: true,
      chat: true,
      checker: checkers,
      mermaid: () => import('mermaid'),
      pickData: async () => GRANTS,
      actions,
      brand: { name: 'Sauti Salama' },
      letterhead: { name: 'Sauti Salama', tagline: 'Survivor-centred referral network', address: 'Nairobi', rule: true },
      originality: {
        vendor: 'the test detector',
        corpus,
        detectAi: async (text) => {
          const at = text.indexOf('As an AI');
          return { score: at < 0 ? 0.1 : 0.7, spans: at < 0 ? [] : [{ start: at, end: at + 40, likelihood: 0.7 }] };
        },
      },
      onPaletteCreated: (p) => console.log('[extras] palette created', p.name),
    };
  }, [mock, q, actions]);

  useEffect(() => {
    Object.assign(window, { WC, extras: { translated } });
  }, [translated]);

  if (!q) return null;
  return (
    <main style={{ height: '100dvh' }}>
      <WordcraftEditor
        sample
        user={{ name: 'Wanjiru Kamau' }}
        permission={permission}
        sensitive={sensitive}
        comments
        ai={aiOptions}
        tools={{ outline: true, accessibility: true, sources: true, wordCount: { goal: 1500 }, voice: true, translate: { languages: ['French', 'Swahili'] }, onTranslated: (d) => setTranslated(d.markdown) }}
        height="100%"
        onReady={(ed) => Object.assign(window, { wordcraft: ed })}
        onSave={async () => undefined}
      />
    </main>
  );
}
