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

  // Font previews: opening the font box fetches the regular face of the web fonts on screen, so
  // each name is drawn in its own font.
  if (process.env.SMOKE_FONTS !== '0') {
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      window.wordcraft.setPrefs({ tab: 'Home' });
    });
    await page.waitForTimeout(500);
    await page.mouse.move(302, 217);
    await page.waitForTimeout(200);
    await page.mouse.click(302, 217);
    await page.waitForFunction(() => window.wordcraft.hasFont('ABeeZee') || window.wordcraft.hasFont('Abel'), null, { timeout: 30_000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'smoke-font-previews.png' });
    await page.keyboard.press('Escape');
    await page.mouse.click(700, 600);
  }

  // The mini toolbar shows straight after a double-click (it used to wait for another mouse-up).
  await page.mouse.dblclick(560, 560);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'smoke-mini-toolbar.png' });
  await page.mouse.click(700, 600);

  // Version history (an Extra): the title opens it; name a version, change the document, view the
  // version, restore it, and undo the restore.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(700, 151);
  await page.waitForTimeout(300);
  await page.mouse.click(700, 151);
  await page.waitForSelector('.wcvh-panel', { timeout: 5_000 });
  await page.click('.wcvh-link:has-text("Name current version")');
  await page.fill('.wcvh-input', 'Smoke snapshot');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.wcvh-name:has-text("Smoke snapshot")', { timeout: 10_000 });
  await page.evaluate(() => {
    window.wordcraft.execute('caret.docEnd');
    window.wordcraft.execute('text.insert', { text: ' AFTER-SNAPSHOT' });
  });
  await page.click('.wcvh-item:has(.wcvh-name:has-text("Smoke snapshot"))');
  await page.waitForSelector('.wcvh-preview-doc canvas', { timeout: 60_000 });
  await page.waitForSelector('.wcvh-loading', { state: 'detached', timeout: 60_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'smoke-versions.png' });
  await page.click('.wcvh-banner button:has-text("Restore this version")');
  await page.waitForFunction(() => !window.wordcraft.getText().includes('AFTER-SNAPSHOT'), null, { timeout: 10_000 });
  await page.evaluate(() => window.wordcraft.undo());
  await page.waitForFunction(() => window.wordcraft.getText().includes('AFTER-SNAPSHOT'), null, { timeout: 5_000 });

  // AI (an Extra): the sparkle at the bottom centre opens the bar; /api/ai streams a canned answer
  // when WORDCRAFT_FAKE_AI=1. AI Studio's Humaniser is on by default and reaches the request.
  if (process.env.WORDCRAFT_FAKE_AI === '1') {
    await page.evaluate(() => window.wordcraft.execute('caret.docEnd'));
    await page.click('.wcai-launch');
    await page.waitForSelector('[role=dialog] textarea', { timeout: 5_000 });
    await page.screenshot({ path: 'smoke-ai-bar.png' });
    await page.fill('[role=dialog] textarea', 'one sentence');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[role=dialog]')?.textContent?.includes('with the Humaniser'), null, { timeout: 15_000 });
    await page.click('[role=dialog] button:has-text("Insert")');
    await page.waitForFunction(() => window.wordcraft.getText().includes('written by the test model'), null, { timeout: 5_000 });
    await page.waitForSelector('.wcai-launch', { timeout: 5_000 });

    // AI Studio: a palette recolours the headings and a letterhead fills the header.
    await page.click('.wcai-launch');
    await page.click('[aria-label="AI Studio"]');
    await page.click('.wcai-tab:has-text("Palette")');
    await page.click('.wcai-palette:has-text("Forest")');
    await page.click('button:has-text("Apply to headings")');
    await page.click('.wcai-tab:has-text("Letterhead")');
    await page.fill('input[placeholder="e.g. Open Studio Collective"]', 'Smoke Test Collective');
    await page.click('button:has-text("Apply to document")');
    await page.waitForFunction(() => document.querySelector('.wcai-note-inline')?.textContent?.includes('added'), null, { timeout: 5_000 });
    await page.screenshot({ path: 'smoke-ai-studio.png' });
    await page.click('[aria-label="Close AI Studio"]');
    await page.click('[aria-label="More options"]');
    await page.click('.wcai-item:has-text("Close")');
    await page.waitForSelector('.wcai-launch', { timeout: 5_000 });

    // Own keys only: the sparkle asks for a key, then calls the provider straight from the browser.
    let auth = '';
    let system = '';
    await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
      auth = route.request().headers()['authorization'] ?? '';
      system = JSON.parse(route.request().postData() ?? '{}').messages?.[0]?.content ?? '';
      const ev = (t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`;
      await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: ev('Written with ') + ev('my own key.') + 'data: [DONE]\n\n' });
    });
    await page.selectOption('select[aria-label="AI"]', 'own');
    await page.click('.wcai-launch');
    await page.fill('[role=dialog] input[type=password]', 'sk-or-test');
    await page.click('[role=dialog] button:has-text("Save")');
    await page.fill('[role=dialog] textarea', 'a closing line');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[role=dialog]')?.textContent?.includes('my own key'), null, { timeout: 15_000 });
    assert.equal(auth, 'Bearer sk-or-test', 'own key sent to the provider');
    assert.ok(system.includes('Humaniser') && system.includes('Smoke Test Collective'), 'skills and letterhead reach the system prompt');
    await page.click('[role=dialog] button:has-text("Insert")');
    await page.waitForFunction(() => window.wordcraft.getText().includes('Written with my own key.'), null, { timeout: 5_000 });
    await page.evaluate(() => localStorage.removeItem('wordcraft.ai'));
    await page.selectOption('select[aria-label="AI"]', 'app');
  }

  // Word's ribbon collapse: ^ leaves the tabs and ruler; a tab click opens it over the page.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(1365, 279);
  await page.waitForTimeout(300);
  await page.mouse.click(1365, 279);
  await page.waitForFunction(() => window.wordcraft.getPrefs().ribbonCollapsed === true, null, { timeout: 5_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'smoke-collapsed.png' });
  await page.evaluate(() => window.wordcraft.setPrefs({ ribbonCollapsed: false }));

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
  console.error('smoke test FAILED:', e.stack ?? e.message);
  await page.screenshot({ path: 'smoke-failure.png' }).catch(() => {});
  console.error(logs.slice(-40).join('\n'));
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
