// Browser smoke test: drives the example app in headless Chromium (WebGL2 through SwiftShader)
// and checks that WordCraft starts and that the embedding API works end to end.
//
// Usage: npm run build && npm start &  then  node smoke-test.mjs [http://localhost:3000]
// Writes smoke-*.png screenshots next to this file. Exits non-zero on any failure.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const url = process.argv[2] ?? 'http://localhost:3000/';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('response', (r) => r.status() >= 400 && logs.push(`[http ${r.status()}] ${r.url()}`));

let failed = false;
try {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.wordcraft, null, { timeout: 180_000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'smoke-1-start.png' });

  const r = await page.evaluate(async () => {
    const ed = window.wordcraft;
    const out = { commands: ed.commands().length, title: ed.title(), text: ed.getText().length };
    ed.execute('text.insert', { text: 'SMOKE-MARKER ' });
    out.dirty = ed.isDirty();
    const docx = ed.export('docx');
    out.docx = docx.byteLength;
    out.pdf = ed.export('pdf').byteLength;
    out.html = ed.getHTML().includes('SMOKE-MARKER');
    out.md = ed.getMarkdown().includes('SMOKE-MARKER');
    ed.newDocument();
    out.blank = ed.getText().trim().length;
    await ed.load({ name: 'roundtrip.docx', data: docx });
    out.roundtrip = ed.getText().includes('SMOKE-MARKER');
    ed.setPrefs({ tab: 'Insert' });
    out.tab = ed.getPrefs().tab;
    try {
      ed.execute('no.such.command');
      out.badCommandThrows = false;
    } catch {
      out.badCommandThrows = true;
    }
    return out;
  });
  console.log(JSON.stringify(r));
  assert.ok(r.commands > 100, 'command registry is populated');
  assert.ok(r.text > 0, 'sample document loaded');
  assert.equal(r.dirty, true, 'edits mark the document dirty');
  assert.ok(r.docx > 1000 && r.pdf > 1000, 'docx and pdf export');
  assert.ok(r.html && r.md, 'html and markdown export');
  assert.equal(r.blank, 0, 'newDocument clears the document');
  assert.ok(r.roundtrip, 'docx round trip keeps the text');
  assert.equal(r.tab, 'Insert', 'prefs apply');
  assert.ok(r.badCommandThrows, 'unknown commands throw');

  // The person editing is configurable and readable.
  assert.equal(await page.evaluate(() => window.wordcraft.getUser().name), 'Ada Lovelace', 'user name from props');
  // AutoSave is on when the host has onSave.
  assert.equal(await page.evaluate(() => window.wordcraft.isAutoSaving()), true, 'AutoSave on');

  // Keyboard typing; AutoSave then writes through onSave by itself.
  await page.mouse.click(700, 500);
  await page.keyboard.type('Typed. ');
  await page.waitForTimeout(500);
  assert.ok(await page.evaluate(() => window.wordcraft.getText().includes('Typed.')), 'keyboard typing reaches the editor');
  await page.waitForFunction(() => document.querySelector('[data-testid=status]')?.textContent?.includes('autosave'), null, { timeout: 20_000 });
  await page.screenshot({ path: 'smoke-2-autosaved.png' });

  // The AutoSave toggle in the title bar switches it off and on.
  assert.equal(await page.evaluate(() => window.wordcraft.setAutoSave(false)), false, 'AutoSave off');
  assert.equal(await page.evaluate(() => window.wordcraft.setAutoSave(true)), true, 'AutoSave back on');

  // Ctrl+S reaches onSave as a save.
  await page.mouse.click(700, 500);
  await page.keyboard.press('Control+S');
  await page.waitForFunction(() => document.querySelector('[data-testid=status]')?.textContent?.includes('(save'), null, { timeout: 15_000 });

  // Renaming the user applies live.
  await page.fill('input[aria-label="Your name"]', 'Grace Hopper');
  await page.waitForFunction(() => window.wordcraft.getUser().name === 'Grace Hopper', null, { timeout: 5_000 });

  // Word's mode switch: Viewing refuses changes, Reviewing turns on Track Changes.
  await page.selectOption('select[aria-label="Mode"]', 'viewing');
  await page.waitForFunction(() => window.wordcraft.getMode() === 'viewing', null, { timeout: 5_000 });
  const refused = await page.evaluate(() => {
    try {
      window.wordcraft.execute('text.insert', { text: 'nope' });
      return false;
    } catch {
      return true;
    }
  });
  assert.ok(refused, 'Viewing mode refuses edits');
  await page.selectOption('select[aria-label="Mode"]', 'reviewing');
  await page.waitForFunction(() => window.wordcraft.getMode() === 'reviewing', null, { timeout: 5_000 });
  await page.selectOption('select[aria-label="Mode"]', 'editing');
  await page.waitForFunction(() => window.wordcraft.getMode() === 'editing', null, { timeout: 5_000 });

  // The app chooses ribbon tabs and turns commands off.
  await page.click('text=Hide Mailings, Zotero, Open');
  await page.waitForFunction(() => JSON.stringify(window.wordcraft.getPrefs().hiddenTabs) === '["Mailings","Zotero"]', null, { timeout: 5_000 });
  const openRefused = await page.evaluate(() => {
    try {
      window.wordcraft.execute('file.open', {});
      return false;
    } catch (e) {
      return /turned off/.test(String(e.message));
    }
  });
  assert.ok(openRefused, 'turned-off commands are refused');
  await page.click('text=Hide Mailings, Zotero, Open');

  // The AI bar (the example's /api/ai streams a canned answer when WORDCRAFT_FAKE_AI=1).
  if (process.env.WORDCRAFT_FAKE_AI === '1') {
    await page.evaluate(() => window.wordcraft.execute('caret.docEnd'));
    await page.click('text=Help me write');
    await page.fill('[role=dialog] textarea', 'one sentence');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[role=dialog]')?.textContent?.includes('test model'), null, { timeout: 15_000 });
    await page.click('[role=dialog] button:has-text("Insert")');
    await page.waitForFunction(() => window.wordcraft.getText().includes('written by the test model'), null, { timeout: 5_000 });
  }

  // A web font loads on demand and is used.
  if (process.env.SMOKE_FONTS !== '0') {
    await page.evaluate(() => {
      window.wordcraft.execute('select.all');
      window.wordcraft.execute('format.font', { name: 'Lato' });
    });
    await page.waitForFunction(() => window.wordcraft.hasFont('Lato'), null, { timeout: 30_000 });
  }

  // Title bar and ribbon can be hidden, like Word's Ribbon Display Options.
  await page.click('text=Title bar');
  await page.selectOption('select[aria-label="Ribbon display"]', 'hidden');
  await page.waitForFunction(() => window.wordcraft.getPrefs().hideTitleBar === true && window.wordcraft.getPrefs().hideRibbon === true, null, { timeout: 5_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'smoke-3-no-chrome.png' });
  await page.selectOption('select[aria-label="Ribbon display"]', 'tabs');
  await page.waitForFunction(() => window.wordcraft.getPrefs().ribbonCollapsed === true && window.wordcraft.getPrefs().hideRibbon === false, null, { timeout: 5_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'smoke-4-tabs-only.png' });
  console.log('smoke test passed');
} catch (e) {
  failed = true;
  console.error('smoke test FAILED:', e.message);
  await page.screenshot({ path: 'smoke-failure.png' }).catch(() => {});
  console.error(logs.slice(-40).join('\n'));
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
