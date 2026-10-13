// Acceptance tests for the 0.3.5 Extras on /extras?mock=1: document chat with citations, writing
// checks, originality, the theme from a logo, logo placement, and AI that builds structure
// (tables, CSV data, diagrams, charts), the permission rules and sanitising.
//
// Usage: npm run build && npm start &  then  node smoke-extras.mjs [http://localhost:3000]
// Exits non-zero on any failure, and writes smoke-extras-failure-*.png for failures.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const logs = [];
let failed = false;

async function scenario(name, query, fn) {
  if (only && !only.test(name)) return;
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 880 }, deviceScaleFactor: 1, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const remote = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (!['localhost', '127.0.0.1'].includes(u.hostname) && !u.protocol.startsWith('data')) remote.push(r.url());
  });
  page.on('console', (m) => logs.push(`[${name} ${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[${name} pageerror] ${e.message}`));
  try {
    await page.goto(`${base}/extras?mock=1${query}`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.wordcraft && !!window.WC, null, { timeout: 240_000 });
    await page.waitForTimeout(2000);
    await fn(page, { remote });
    console.log(`ok ${name}`);
  } catch (e) {
    failed = true;
    console.error(`FAIL ${name}:`, e);
    await page.screenshot({ path: `smoke-extras-failure-${name}.png` }).catch(() => {});
  } finally {
    await ctx.close();
  }
}

/** A part of the .docx the editor saves, as text (`word/document.xml`, `word/theme/theme1.xml`…). */
async function docxPart(page, part) {
  const bytes = await page.evaluate(() => Array.from(window.wordcraft.export('docx')));
  const dir = mkdtempSync(join(tmpdir(), 'wc-docx-'));
  const file = join(dir, 'doc.docx');
  writeFileSync(file, Buffer.from(bytes));
  try {
    return execFileSync('unzip', ['-p', file, part], { encoding: 'utf8', maxBuffer: 64 << 20 });
  } catch {
    return '';
  }
}
const parts = async (page) => {
  const bytes = await page.evaluate(() => Array.from(window.wordcraft.export('docx')));
  const dir = mkdtempSync(join(tmpdir(), 'wc-docx-'));
  const file = join(dir, 'doc.docx');
  writeFileSync(file, Buffer.from(bytes));
  return execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' }).split('\n');
};

/** Put the caret at the end of the document on a new empty paragraph. */
const atEnd = (page) =>
  page.evaluate(() => {
    const ed = window.wordcraft;
    ed.execute('caret.docEnd');
    ed.execute('text.newParagraph');
  });

const PALETTE = { id: 't', name: 'Test', primary: '1A5C8A', secondary: '2E7D32', accent: 'E07A1F', muted: '6B7280' };

// ----- Part 2: chat, checks, originality ----------------------------------------------------

await scenario('chat-citation', '', async (page) => {
  await page.getByRole('button', { name: /^Ask$/ }).click();
  const box = page.getByRole('textbox', { name: 'Ask about this document' });
  await box.fill('What does the document say about membership?');
  await box.press('Enter');
  const chip = page.locator('.wcsp-cite').first();
  await chip.waitFor({ timeout: 15000 });
  const before = await page.evaluate(() => JSON.stringify(window.wordcraft.caret()));
  await chip.click();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => window.wordcraft.caret());
  assert.notEqual(JSON.stringify(after), before, 'clicking a citation moves to its paragraph');
  const marks = await page.evaluate(() => window.wordcraft.selectionInfo());
  assert.ok(after.focus, 'the caret is in the body');
  void marks;
  // Insert at cursor works for an editor.
  await page.getByRole('button', { name: 'Insert at cursor' }).first().click();
  await page.waitForTimeout(300);
  assert.match(await page.evaluate(() => window.wordcraft.getText()), /The document answers this in one place\./);
});

await scenario('chat-viewer-cannot-insert', '&permission=view', async (page) => {
  await page.getByRole('button', { name: /^Ask$/ }).click();
  const box = page.getByRole('textbox', { name: 'Ask about this document' });
  await box.fill('Summarise');
  await box.press('Enter');
  await page.locator('.wcsp-cite').first().waitFor({ timeout: 15000 });
  assert.equal(await page.getByRole('button', { name: 'Insert at cursor' }).count(), 0, 'a viewer can ask but not insert');
  assert.equal(await page.getByRole('button', { name: 'Copy' }).count() > 0, true);
});

await scenario('checks-underline-and-apply', '', async (page) => {
  await atEnd(page);
  await page.evaluate(() => window.wordcraft.execute('text.insert', { text: 'We will utilise the funds in order to help.' }));
  // Wait for the pause, the check and the underline.
  await page.waitForFunction(() => document.querySelector('[aria-label^="Writing checks,"]')?.textContent?.trim() !== '0', null, { timeout: 15000 });
  await page.getByRole('button', { name: /^Writing checks,/ }).click();
  const panel = page.getByRole('complementary', { name: 'Writing checks' });
  await panel.waitFor();
  const fix = panel.getByRole('button', { name: /^to$/ }).first();
  await fix.click();
  await page.waitForTimeout(400);
  const t = await page.evaluate(() => window.wordcraft.getText());
  assert.match(t, /utilise the funds to help\./, 'the wordy phrase was replaced');
  // The AI checker found "utilise" (clarity) too.
  await page.waitForTimeout(2500);
  assert.ok((await panel.textContent()).includes('plainer word'), 'a clarity issue is listed');
  assert.ok((await panel.textContent()).match(/reading ease \d+/), 'readability is shown');
});

await scenario('checks-off-when-sensitive', '&sensitive=1', async (page) => {
  assert.equal(await page.getByRole('button', { name: /^Writing checks,/ }).count(), 0, 'no checks on a sensitive document');
  assert.equal(await page.getByRole('button', { name: /^Ask$/ }).count(), 0, 'no chat on a sensitive document');
});

await scenario('originality', '', async (page) => {
  await atEnd(page);
  await page.evaluate(() => window.wordcraft.execute('text.insert', { text: 'We run a survivor-centred referral network. As an AI language model I can write this sentence.' }));
  await page.getByRole('button', { name: 'Tools ▾' }).click();
  await page.getByRole('menuitem', { name: 'Originality' }).click();
  await page.getByRole('button', { name: 'Check originality' }).click();
  await page.getByText('2025 grant proposal (Ford)').waitFor({ timeout: 10000 });
  await page.getByText(/may contain AI-generated text/).waitFor();
  assert.ok(await page.getByText(/Detectors are often wrong/).isVisible(), 'the AI signal carries its caveat');
  // Nothing is written into the file.
  assert.ok(!(await docxPart(page, 'word/document.xml')).includes('grant proposal'), 'results are not saved in the document');
});

// ----- Part 3: theme from a logo, placement -------------------------------------------------

await scenario('theme-from-logo', '', async (page) => {
  // A two-colour logo, drawn in the page.
  const swatches = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 100;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 200, 100);
    g.fillStyle = '#1a5c8a';
    g.fillRect(10, 10, 120, 80);
    g.fillStyle = '#e07a1f';
    g.fillRect(140, 10, 50, 80);
    const logo = c.toDataURL('image/png');
    const photo = (() => {
      const d = document.createElement('canvas');
      d.width = 300;
      d.height = 200;
      const h = d.getContext('2d');
      const grad = h.createLinearGradient(0, 0, 300, 200);
      grad.addColorStop(0, '#3a7d44');
      grad.addColorStop(1, '#9bc53d');
      h.fillStyle = grad;
      h.fillRect(0, 0, 300, 200);
      return d.toDataURL('image/png');
    })();
    const sw = await window.WC.extractColors([logo, photo]);
    return sw.map((s) => ({ hex: s.hex, source: s.source }));
  });
  const near = (hex, want) => {
    const n = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [a, b] = [n(hex), n(want)];
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 40;
  };
  assert.ok(swatches.some((s) => near(s.hex, '#1a5c8a')), `the logo's blue is found: ${JSON.stringify(swatches)}`);
  assert.ok(swatches.some((s) => near(s.hex, '#e07a1f')), "the logo's orange is found");
  assert.ok(swatches.some((s) => s.source === 1), 'the photo contributes too');
  // Applied as the document theme.
  await page.evaluate((p) => window.WC.applyTheme(window.wordcraft, p, { scope: 'document', fonts: { heading: 'Georgia', body: 'Lato' } }), PALETTE);
  const theme = await docxPart(page, 'word/theme/theme1.xml');
  assert.match(theme, /<a:accent1><a:srgbClr val="1A5C8A"\/>/, 'accent1 is the primary');
  assert.match(theme, /<a:accent2><a:srgbClr val="2E7D32"\/>/, 'accent2 is the secondary');
  assert.match(theme, /typeface="Georgia"/, 'the heading font is in the theme');
  const styles = await docxPart(page, 'word/styles.xml');
  assert.match(styles, /w:styleId="Heading1"[\s\S]*?<w:color w:val="1A5C8A"/, 'Heading 1 takes the primary');
  // Low contrast: a warning, and the fix passes 4.5:1.
  const fixed = await page.evaluate(() => {
    const bad = { id: 'pale', name: 'Pale', primary: 'F5D76E', secondary: 'FAE3A0', accent: 'FFE08A', muted: 'EEEEEE' };
    const w = window.WC.paletteWarnings(bad).length;
    const f = window.WC.fixPalette(bad);
    return { w, ratio: window.WC.contrast(`#${f.primary}`, '#ffffff') };
  });
  assert.ok(fixed.w > 0, 'a pale palette warns');
  assert.ok(fixed.ratio >= 4.5, `the fix makes headings pass (${fixed.ratio})`);
});

const LOGO = async (page) =>
  page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 120;
    c.height = 60;
    const g = c.getContext('2d');
    g.fillStyle = '#1a5c8a';
    g.fillRect(0, 0, 120, 60);
    return c.toDataURL('image/png');
  });

await scenario('logo-placement', '', async (page) => {
  const src = await LOGO(page);
  const lh = (placement, extra = {}) => ({ name: 'Sauti Salama', tagline: 'Referral network', rule: true, logo: { src, placement, ...extra } });
  // Header right, then replaced (not stacked) by a watermark.
  await page.evaluate(([l, p]) => window.WC.applyLetterheadPlaced(window.wordcraft, l, p), [lh('header-right'), PALETTE]);
  let header = await docxPart(page, 'word/header*.xml');
  assert.match(header, /Sauti Salama/, 'the header has the name');
  assert.equal((header.match(/<pic:pic/g) ?? []).length, 1, 'one logo in the header');
  await page.evaluate(([l, p]) => window.WC.applyLetterheadPlaced(window.wordcraft, l, p), [lh('watermark', { opacity: 0.2, rotation: -45 }), PALETTE]);
  header = await docxPart(page, 'word/header*.xml');
  assert.equal((header.match(/<pic:pic/g) ?? []).length, 1, 'the watermark replaced the header logo');
  assert.match(header, /behindDoc="1"/, 'the watermark sits behind the text');
  assert.equal((header.match(/Sauti Salama<\/w:t>/g) ?? []).length, 1, 'the letterhead is not stacked');
  // First page only.
  await page.evaluate(([l, p]) => window.WC.applyLetterheadPlaced(window.wordcraft, l, p), [lh('header-left', { pages: 'first' }), PALETTE]);
  const doc = await docxPart(page, 'word/document.xml');
  assert.match(doc, /<w:titlePg\/>/, 'Different First Page is on');
  assert.match(doc, /headerReference w:type="first"/, 'a first-page header exists');
  // Logo beside the text: a borderless table in the header.
  await page.evaluate(([l, p]) => window.WC.applyLetterheadPlaced(window.wordcraft, l, p), [lh('header-logo-left-text-right'), PALETTE]);
  header = await docxPart(page, 'word/header*.xml');
  assert.match(header, /<w:tbl>/, 'logo and text side by side in a table');
  // Remove clears it all.
  await page.evaluate(() => window.WC.removeLetterheadPlaced(window.wordcraft));
  header = await docxPart(page, 'word/header*.xml');
  assert.ok(!/<pic:pic/.test(header), 'no logo left after Remove');
});

// ----- Part 4: structure ----------------------------------------------------------------------

const openInsert = async (page, label) => {
  await page.evaluate(() => window.wordcraft.canvas.focus());
  await page.getByRole('button', { name: /Write with/ }).first().click();
  await page.getByRole('button', { name: /^Insert/ }).first().click();
  await page.getByRole('menuitem', { name: new RegExp(label) }).click();
};

await scenario('table-native-shaded', '', async (page) => {
  await atEnd(page);
  await openInsert(page, 'Table');
  await page.getByPlaceholder(/What should the table show/).fill('three funders with amount and deadline');
  await page.getByRole('button', { name: 'Generate' }).click();
  await page.locator('.wcst-table').waitFor({ timeout: 15000 });
  await page.getByText('AI-generated: check it before use.').waitFor();
  await page.getByRole('button', { name: /^Insert$/ }).click();
  await page.waitForTimeout(800);
  const doc = await docxPart(page, 'word/document.xml');
  const tbl = doc.slice(doc.lastIndexOf('<w:tbl>'));
  assert.match(tbl, /<w:tblHeader\/>/, 'a real header row');
  assert.match(tbl, /w:fill="[0-9A-F]{6}"/, 'the header is shaded');
  assert.match(tbl, /Baobab Fund/);
});

await scenario('csv-values-exact', '', async (page) => {
  await atEnd(page);
  await openInsert(page, 'Table');
  await page.getByRole('button', { name: 'Paste CSV' }).click();
  await page.getByPlaceholder(/Funder,Amount,Deadline/).fill('Funder,Amount,Deadline\nAcme Trust,25000,2026-12-01\nBaobab Fund,40000,2027-02-15\nCoral Foundation,12500,2026-11-20');
  await page.getByPlaceholder(/What should the table show/).fill('a table sorted by amount with a total');
  await page.getByRole('button', { name: 'Generate' }).click();
  await page.locator('.wcst-table').waitFor({ timeout: 15000 });
  const cells = await page.locator('.wcst-table td').allTextContents();
  assert.deepEqual(cells.slice(0, 3), ['Baobab Fund', '40000', '2027-02-15'], 'sorted by amount, values from the CSV');
  assert.ok(cells.includes('77500'), 'the total is the sum of the column');
  assert.ok(!cells.includes('[to confirm]'), 'no value had to be held back');
  assert.equal(await page.locator('.wcst-table td[data-bad]').count(), 0);
  await page.getByRole('button', { name: /^Insert$/ }).click();
  await page.waitForTimeout(800);
  assert.match(await page.evaluate(() => window.wordcraft.getText()), /Baobab Fund\s+40000/);
});

await scenario('diagram', '', async (page) => {
  await atEnd(page);
  await openInsert(page, 'Diagram');
  await page.getByPlaceholder(/What should the diagram show/).fill('a flowchart of our case referral process');
  await page.getByRole('button', { name: 'Generate' }).click();
  await page.locator('.wcst-preview img[alt="Diagram preview"]').waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: /^Insert$/ }).click();
  await page.waitForTimeout(1500);
  const doc = await docxPart(page, 'word/document.xml');
  assert.match(doc, /descr="Flowchart of the case referral process/, 'the picture has alt text');
  assert.match(doc, /title="mermaid:flowchart TD/, 'the Mermaid source is kept with the picture');
  // Edit diagram: select the picture, the chip reopens the source.
  await page.evaluate(() => {
    const ed = window.wordcraft;
    const p = ed.paragraphs().filter((x) => x.text.includes('￼')).pop();
    ed.selectText(p.path, p.text.indexOf('￼'), p.text.indexOf('￼') + 1);
  });
  await page.getByRole('button', { name: 'Edit diagram' }).waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: 'Edit diagram' }).click();
  await page.getByRole('textbox', { name: 'Mermaid source' }).waitFor();
  assert.match(await page.getByRole('textbox', { name: 'Mermaid source' }).inputValue(), /Survivor reaches out/);
  // A syntax error offers the AI fix.
  await page.getByRole('textbox', { name: 'Mermaid source' }).fill('flowchart TD\n  A[Start --> ');
  await page.getByRole('button', { name: 'Preview' }).click();
  await page.getByRole('button', { name: 'Ask AI to fix the diagram' }).waitFor({ timeout: 10000 });
});

await scenario('chart-native', '', async (page) => {
  await atEnd(page);
  await openInsert(page, 'Chart');
  await page.getByPlaceholder(/What should the chart show/).fill('bar chart of these amounts by funder');
  await page.getByRole('button', { name: 'Generate' }).click();
  await page.locator('.wcst-preview img[alt="Grant amounts by funder"]').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: /^Insert$/ }).click();
  await page.waitForTimeout(1000);
  const list = await parts(page);
  const chart = list.find((p) => /^word\/charts\/chart\d+\.xml$/.test(p));
  assert.ok(chart, `a native chart part: ${list.join(' ')}`);
  const xml = await docxPart(page, chart);
  assert.match(xml, /Baobab Fund/);
  assert.match(xml, /<c:legend>|<c:title>/, 'title or legend present');
});

await scenario('slash-menu', '', async (page) => {
  await atEnd(page);
  await page.evaluate(() => window.wordcraft.canvas.focus());
  await page.keyboard.type('/');
  await page.getByRole('listbox', { name: 'Insert' }).waitFor({ timeout: 5000 });
  await page.keyboard.type('div');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const t = await page.evaluate(() => window.wordcraft.paragraphs().slice(-3).map((p) => p.text));
  assert.ok(!t.some((x) => x.includes('/div')), 'the slash text is removed');
  assert.match(await docxPart(page, 'word/document.xml'), /<w:pBdr><w:bottom/, 'a divider was inserted');
});

await scenario('viewer-sees-no-structure', '&permission=view', async (page) => {
  await page.evaluate(() => window.wordcraft.canvas.focus());
  await page.keyboard.type('/');
  await page.waitForTimeout(500);
  assert.equal(await page.getByRole('listbox', { name: 'Insert' }).count(), 0, 'no slash menu for a viewer');
  assert.equal(await page.getByRole('button', { name: /Help me write/ }).count(), 0, 'no AI launcher for a viewer');
});

await scenario('suggester-inserts-tracked', '&permission=suggest', async (page) => {
  await page.evaluate(async () => {
    const ed = window.wordcraft;
    ed.execute('caret.docEnd');
    await window.WC.insertBlocks(ed, [{ type: 'table', columns: ['A', 'B'], rows: [['1', '2']] }], { palette: { id: 'x', name: 'x', primary: '1A5C8A', secondary: '2E7D32', accent: 'E07A1F', muted: '6B7280' } });
  });
  const doc = await docxPart(page, 'word/document.xml');
  const tbl = doc.slice(doc.lastIndexOf('<w:tbl>'));
  assert.match(tbl, /<w:ins /, "a suggester's table is a tracked insertion");
});

await scenario('sanitised', '', async (page, { remote }) => {
  await atEnd(page);
  await openInsert(page, 'Table');
  await page.getByPlaceholder(/What should the table show/).fill('script test');
  await page.getByRole('button', { name: 'Generate' }).click();
  await page.locator('.wcst-preview').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: /^Insert$/ }).click();
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => window.__pwned), undefined, 'nothing ran');
  assert.deepEqual(remote.filter((u) => u.includes('evil.example')), [], 'nothing was fetched');
  const t = await page.evaluate(() => window.wordcraft.getText());
  assert.match(t, /Safe <script>window.__pwned=1<\/script> text/, 'the script is plain text');
});

await scenario('qr-and-blocks-api', '', async (page) => {
  const ok = await page.evaluate(() => {
    const m = window.WC.qrMatrix('https://example.org/donate');
    return m.length === 25 || m.length === 29;
  });
  assert.ok(ok, 'a QR matrix of the right version');
  const blocks = await page.evaluate(() => window.WC.markdownToBlocks('# Title\n\n- a\n  - b\n\n| x | y |\n|---|--:|\n| 1 | 2 |\n\n```mermaid\nflowchart TD\nA-->B\n```'));
  assert.deepEqual(blocks.map((b) => b.type), ['heading', 'list', 'table', 'diagram']);
});

await browser.close();
if (failed) {
  console.error(logs.slice(-60).join('\n'));
  process.exit(1);
}
console.log('all extras scenarios passed');
