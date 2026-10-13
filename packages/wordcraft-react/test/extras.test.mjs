import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockHtml, markdownToBlocks, parseBlocks, parseDelimited, sanitizeBlocks, safeImageSrc, tableTools, inlineHtml, cellNumber } from '../dist/blocks.js';
import { qrMatrix, qrSvg } from '../dist/qr.js';
import { plainLanguageChecker, readability, writingScore, sentencesOf } from '../dist/checks.js';
import { contrast, fixContrast, fixPalette, paletteWarnings, assignRoles, withHash } from '../dist/theme.js';
import { aiSystemPrompt, aiUserMessage } from '../dist/ai-providers.js';
import { parseJsonAnswer } from '../dist/ai-run.js';
import { hashText, countText, sections, rangesFor } from '../dist/doc-text.js';
import { scrubSvg, diagramAlt, chartSvg } from '../dist/renderers.js';

const P = { id: 'p', name: 'P', primary: '1A5C8A', secondary: '2E7D32', accent: 'E07A1F', muted: '6B7280' };

test('JSON blocks are validated, capped and repaired', () => {
  const b = parseBlocks('Here you go:\n```json\n[{"type":"heading","level":9,"text":"Plan"},{"type":"bogus","text":"kept as text"},{"type":"table","columns":["A","B"],"rows":[["1"],["2","3","4"]]},{"type":"image","src":"https://evil.example/x.png","alt":"x"}]\n```');
  assert.deepEqual(b.map((x) => x.type), ['heading', 'paragraph', 'table']);
  assert.equal(b[0].level, 4);
  assert.deepEqual(b[2].rows, [['1', ''], ['2', '3']], 'rows padded and cut to the columns');
  assert.equal(safeImageSrc('https://evil.example/x.png'), null);
  assert.ok(safeImageSrc('data:image/png;base64,iVBORw0KGgo='));
  assert.equal(safeImageSrc('data:image/svg+xml;base64,PHN2Zz4='), null, 'SVG could carry script');
});

test('Markdown becomes structure', () => {
  const b = markdownToBlocks('# Title\n\nSome **bold** text.\n\n- one\n  - nested\n- two\n\n1. first\n2. second\n\n| Funder | Amount |\n|---|---:|\n| Acme | 10 |\n\n> [!WARNING] Mind the date\n\n- [x] done\n- [ ] todo\n\n```mermaid\nflowchart TD\nA-->B\n```\n\n$$E=mc^2$$\n\n---');
  assert.deepEqual(b.map((x) => x.type), ['heading', 'paragraph', 'list', 'list', 'table', 'callout', 'checklist', 'diagram', 'equation', 'rule']);
  assert.equal(b[2].items[0].children[0].text, 'nested');
  assert.equal(b[3].ordered, true);
  assert.deepEqual(b[4].align, ['left', 'right']);
  assert.equal(b[5].variant, 'warning');
  assert.equal(b[6].items[0].done, true);
});

test('HTML for the document escapes everything the model wrote', () => {
  const html = blockHtml({ type: 'paragraph', text: 'a <script>x()</script> [ok](https://ok.org) [bad](javascript:alert(1)) **b**' }, P);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('<a href="https://ok.org">ok</a>'));
  assert.ok(!html.includes('href="javascript'));
  assert.ok(html.includes('<b>b</b>'));
  const t = blockHtml({ type: 'table', columns: ['A"><img src=x>'], rows: [['1']] }, P);
  assert.ok(!t.includes('<img'));
  assert.ok(t.includes('bgcolor="#1A5C8A"'), 'header shaded with the palette');
  assert.equal(inlineHtml('<b>'), '&lt;b&gt;');
});

test('table tools: sort, total, format', () => {
  const t = { type: 'table', columns: ['Funder', 'Amount'], rows: [['A', '$10,000'], ['B', '$2,500'], ['C', '$40,000']] };
  const sorted = tableTools(t).sort(1, true);
  assert.deepEqual(sorted.rows.map((r) => r[0]), ['C', 'A', 'B']);
  const total = tableTools(sorted).withTotal();
  assert.equal(total.rows.at(-1)[1], '$52,500');
  assert.equal(cellNumber('(1,200)'), -1200);
  const pct = tableTools({ type: 'table', columns: ['x'], rows: [['50']] }).format(0, 'percent', 'USD', 'en-US');
  assert.equal(pct.rows[0][0], '50%');
});

test('CSV and TSV parse with quotes', () => {
  const d = parseDelimited('Name,Note\n"Acme, Inc","said ""hi"""\nBaobab,ok');
  assert.deepEqual(d.columns, ['Name', 'Note']);
  assert.deepEqual(d.rows[0], ['Acme, Inc', 'said "hi"']);
  assert.deepEqual(parseDelimited('a\tb\n1\t2').rows, [['1', '2']]);
});

test('QR codes have the right size and quiet zone', () => {
  assert.equal(qrMatrix('HELLO', 'M').length, 21);
  assert.equal(qrMatrix('https://example.org/donate', 'M').length, 25);
  assert.ok(qrSvg('x').startsWith('<svg'));
  assert.throws(() => qrMatrix('x'.repeat(4000)));
});

test('plain-language rules', () => {
  const issues = plainLanguageChecker().check('In order to utilise the the funds, the report was written by the team.', { goals: { domain: 'plain' }, language: 'en', dictionary: [], signal: new AbortController().signal });
  const ids = issues.map((i) => i.ruleId);
  assert.ok(ids.includes('wordy:in-order-to'));
  assert.ok(ids.some((x) => x.startsWith('plain:utili')));
  assert.ok(ids.includes('repeated-word'));
  assert.ok(ids.includes('passive'));
  const fix = issues.find((i) => i.ruleId === 'wordy:in-order-to');
  assert.deepEqual(fix.replacements, ['to']);
  assert.equal(sentencesOf('One. Two! Three?').length, 3);
});

test('readability and score', () => {
  const easy = readability('The cat sat on the mat. It was warm. We like cats.');
  const hard = readability('Notwithstanding the aforementioned considerations, institutional stakeholders must operationalise comprehensive interdisciplinary methodologies.');
  assert.ok(easy.ease > hard.ease);
  assert.ok(hard.grade > easy.grade);
  assert.ok(easy.tone.length >= 2);
  assert.equal(writingScore([], 100), 100);
});

test('contrast and the palette fix', () => {
  assert.ok(Math.abs(contrast('#000000', '#ffffff') - 21) < 0.01);
  const pale = { ...P, primary: 'F5D76E', secondary: 'FAE3A0' };
  assert.ok(paletteWarnings(pale).length >= 2);
  const fixed = fixPalette(pale);
  assert.ok(contrast(`#${fixed.primary}`, '#ffffff') >= 4.5);
  assert.equal(paletteWarnings(fixed).length, 0);
  assert.ok(contrast(fixContrast('#ffcc00'), '#ffffff') >= 4.5);
  const roles = assignRoles([{ hex: '#f5d76e', share: 0.6, source: 0 }, { hex: '#1a5c8a', share: 0.3, source: 0 }, { hex: '#e4572e', share: 0.1, source: 0 }]);
  assert.equal(roles.primary, '#1a5c8a', 'the readable colour is primary');
  assert.equal(withHash(P).primary, '#1A5C8A');
});

test('prompts for chat, checks and structure', () => {
  assert.match(aiSystemPrompt({ action: 'ask' }), /cite it like \[3\]/);
  assert.match(aiSystemPrompt({ action: 'structure' }), /"type":"table"/);
  assert.match(aiSystemPrompt({ action: 'check', goals: { formality: 'formal' } }), /formality: formal/);
  assert.ok(!aiSystemPrompt({ action: 'check', instructions: 'Humaniser' }).includes('Humaniser'), 'skills do not change checks');
  const m = aiUserMessage({ action: 'structure', prompt: 'table', selection: '', document: 'doc', data: 'a,b\n1,2' });
  assert.match(m, /<data>\na,b\n1,2/);
  assert.match(aiUserMessage({ action: 'ask', prompt: 'Why?', selection: '', document: '[1] Because.', history: [{ role: 'user', content: 'Hi' }] }), /Q: Hi/);
  assert.deepEqual(parseJsonAnswer('Sure!\n```json\n[{"a":1}]\n```'), [{ a: 1 }]);
  assert.deepEqual(parseJsonAnswer('[{"text":"x"}] trailing'), [{ text: 'x' }]);
});

test('document helpers', () => {
  assert.equal(hashText('abc'), hashText('abc'));
  assert.notEqual(hashText('abc'), hashText('abd'));
  assert.equal(countText('One two three.').words, 3);
  const paras = [
    { path: [0], text: 'Intro', style: 'Normal', styleName: 'Normal', heading: 0 },
    { path: [1], text: 'Budget', style: 'Heading1', styleName: 'Heading 1', heading: 1 },
    { path: [2], text: 'We need 10.', style: 'Normal', styleName: 'Normal', heading: 0 },
  ];
  assert.deepEqual(sections(paras).map((s) => s.title), ['Start of the document', 'Budget']);
  const index = { paragraphs: paras, text: paras.map((p) => p.text).join('\n'), starts: [0, 6, 13] };
  assert.deepEqual(rangesFor(index, 3, 10).map((r) => [r.path[0], r.start, r.end]), [[0, 3, 5], [1, 0, 4]]);
});

test('SVG scrubbing and alt text', () => {
  const dirty = '<svg onload="x()"><script>x()</script><foreignObject><div>hi</div></foreignObject><a href="https://evil"><text>t</text></a><use href="#ok"/></svg>';
  const clean = scrubSvg(dirty);
  assert.ok(!/script|onload|foreignObject|https:\/\/evil/.test(clean));
  assert.ok(clean.includes('href="#ok"'));
  assert.match(diagramAlt('flowchart TD\nA[Intake] --> B{Safe?}'), /^Flowchart\. Steps: Intake, Safe\?/);
  assert.ok(chartSvg({ type: 'chart', chart: 'pie', categories: ['a', 'b'], series: [{ name: 's', values: [1, 2] }] }, P).includes('<path'));
});

test('sanitizeBlocks drops non-arrays and caps lists', () => {
  assert.deepEqual(sanitizeBlocks({ type: 'heading' }), []);
  const many = sanitizeBlocks([{ type: 'list', items: Array.from({ length: 500 }, (_, i) => String(i)) }]);
  assert.equal(many[0].items.length, 200);
});
