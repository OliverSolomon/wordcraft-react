// Phone smoke test: the mobile layout and touch gestures, in headless Chromium with phone
// emulation (touch events through the DevTools protocol, as a finger sends them).
//
// Usage: npm run build && npm start &  then  node smoke-mobile.mjs [http://localhost:3000]
// Writes smoke-mobile-*.png next to this file. Exits non-zero on any failure.
import { chromium, devices } from 'playwright';
import assert from 'node:assert/strict';

const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

const logs = [];
let failed = false;

async function phone(name, device, fn) {
  const ctx = await browser.newContext({ ...device, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  page.on('console', (m) => logs.push(`[${name} ${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[${name} pageerror] ${e.message}`));
  const cdp = await ctx.newCDPSession(page);
  const touch = {
    async tap(x, y) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await page.waitForTimeout(60);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(250);
    },
    async press(x, y, ms = 700) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await page.waitForTimeout(ms);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(300);
    },
    async drag(x, y, dx, dy, { steps = 12, hold = 0, lift = true } = {}) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      if (hold) await page.waitForTimeout(hold);
      for (let i = 1; i <= steps; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / steps, y: y + (dy * i) / steps }] });
        await page.waitForTimeout(16);
      }
      if (lift) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(300);
    },
    async pinch(cx, cy, from, to, steps = 10) {
      const pts = (d) => [
        { x: cx - d / 2, y: cy, id: 1 },
        { x: cx + d / 2, y: cy, id: 2 },
      ];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(from) });
      for (let i = 1; i <= steps; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(from + ((to - from) * i) / steps) });
        await page.waitForTimeout(16);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(400);
    },
  };
  try {
    await fn(page, touch);
    console.log(`ok ${name}`);
  } catch (e) {
    failed = true;
    console.error(`FAIL ${name}:`, e);
    await page.screenshot({ path: `smoke-mobile-failure-${name}.png` }).catch(() => {});
  } finally {
    await ctx.close();
  }
}

const ready = async (page) => {
  await page.waitForFunction(() => !!window.wordcraft, null, { timeout: 240_000 });
  await page.waitForSelector('.wcm-top', { timeout: 30_000 });
  await page.waitForTimeout(2500);
};
const info = (page) => page.evaluate(() => window.wordcraft.selectionInfo());
const canvasBox = (page) => page.evaluate(() => {
  const r = window.wordcraft.canvas.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});

// ---------------------------------------------------------------------------------------------

await phone('pixel', devices['Pixel 7'], async (page, touch) => {
  await page.goto(`${base}/mobile`, { waitUntil: 'load' });
  await ready(page);

  // The phone layout replaced WordCraft's own chrome, and the page sits between the bars.
  const prefs = await page.evaluate(() => window.wordcraft.getPrefs());
  assert.equal(prefs.hideTitleBar, true, 'title bar hidden');
  assert.equal(prefs.hideRibbon, true, 'ribbon hidden');
  assert.equal(prefs.hideStatusBar, true, 'status bar hidden');
  const box = await canvasBox(page);
  assert.ok(Math.abs(box.y - 48) < 1, `page starts under the title bar (${box.y})`);
  const view = await page.evaluate(() => window.wordcraft.execute('view.state'));
  console.log('  view', JSON.stringify({ mode: view.mode, zoom: view.zoom }));
  await page.screenshot({ path: 'smoke-mobile-1-start.png' });

  // Tap: the caret moves to the tapped spot.
  const before = await info(page);
  await touch.tap(box.x + 120, box.y + 260);
  const tapped = await info(page);
  assert.equal(tapped.collapsed, true);
  assert.ok(tapped.rect && Math.abs(tapped.rect.y + tapped.rect.height / 2 - (box.y + 260 - box.y)) < 40, `caret near the tap: ${JSON.stringify(tapped.rect)}`);
  assert.notDeepEqual(tapped.rect, before.rect, 'caret moved');

  // Drag: the page scrolls (the caret's rectangle moves up with it) instead of selecting.
  await touch.drag(box.x + 200, box.y + 500, 0, -320, { steps: 16 });
  await page.waitForTimeout(900);
  const scrolled = await info(page);
  assert.equal(scrolled.collapsed, true, 'a drag does not select');
  assert.ok(scrolled.scrolled <= -300, `touch scrolled ${scrolled.scrolled}`);
  assert.ok(!scrolled.rect || scrolled.rect.y < tapped.rect.y - 250, `content moved up: ${tapped.rect.y} -> ${scrolled.rect?.y}`);
  await page.screenshot({ path: 'smoke-mobile-2-scrolled.png' });
  // Shy chrome: scrolling down hid the title bar.
  assert.equal(await page.locator('.wcm-top[data-hidden]').count(), 1, 'title bar slid away');
  await touch.drag(box.x + 200, box.y + 300, 0, 120, { steps: 8 });
  assert.equal(await page.locator('.wcm-top[data-hidden]').count(), 0, 'title bar came back');
  await touch.drag(box.x + 200, box.y + 300, 0, 260, { steps: 10 });
  await page.waitForTimeout(800);

  // Long press: selects the word under the finger, shows handles and the floatie.
  const b2 = await canvasBox(page);
  await touch.press(b2.x + 150, b2.y + 240);
  const word = await page.evaluate(() => window.wordcraft.getSelectedText());
  const sel = await info(page);
  console.log('  long press selected', JSON.stringify(word));
  assert.ok(word.trim().length > 1 && !/\s/.test(word.trim()), `a word: ${JSON.stringify(word)}`);
  assert.equal(sel.touch, true, 'handles show');
  await page.waitForSelector('.wcm-floatie', { timeout: 3000 });
  await page.screenshot({ path: 'smoke-mobile-3-long-press.png' });

  // The end handle drags the selection further.
  const r = sel.rect;
  const endX = r.x + r.width;
  const endY = b2.y + r.y + r.height + 11;
  await touch.drag(b2.x + endX, endY, 90, 0, { steps: 10 });
  const longer = await page.evaluate(() => window.wordcraft.getSelectedText());
  console.log('  after handle drag', JSON.stringify(longer));
  assert.ok(longer.length > word.length, `handle extended the selection (${word.length} -> ${longer.length})`);

  // Floatie Copy reaches the system clipboard.
  await page.click('.wcm-fl[aria-label="Copy"]');
  await page.waitForTimeout(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch((e) => `ERR ${e}`));
  assert.equal(clip, longer, 'copied to the clipboard');

  // Bold from the quick bar.
  await page.click('.wcm-peek [aria-label="Bold"]');
  await page.waitForTimeout(300);
  assert.equal((await page.evaluate(() => window.wordcraft.execute('format.state'))).bold, true, 'bold applied');
  assert.equal(await page.locator('.wcm-peek [aria-label="Bold"][aria-pressed="true"]').count(), 1, 'bold shows as on');

  // Typing goes into the document after a tap (the soft keyboard's hidden input has focus).
  await touch.tap(b2.x + 60, b2.y + 200);
  await page.keyboard.type('Thumbs ');
  await page.waitForTimeout(400);
  assert.ok((await page.evaluate(() => window.wordcraft.getText())).includes('Thumbs '), 'typed text arrived');

  // The palette: open it, switch to Insert, insert a table through the drill-in page.
  await page.click('.wcm-top [aria-label="Show commands"]');
  await page.waitForSelector('.wcm-sheet[data-open]');
  await page.screenshot({ path: 'smoke-mobile-4-palette-home.png' });
  await page.click('.wcm-switch');
  await page.click('.wcm-tab:has-text("Insert")');
  await page.click('.wcm-item:has-text("Table")');
  await page.waitForSelector('.wcm-stepper');
  await page.screenshot({ path: 'smoke-mobile-5-insert-table.png' });
  await page.click('.wcm-primary:has-text("Insert Table")');
  await page.waitForTimeout(800);
  const ctxTabs = (await info(page)).contextual;
  assert.ok(ctxTabs.includes('Table Layout'), `in the new table: ${ctxTabs}`);
  await page.click('.wcm-top [aria-label="Show commands"]').catch(() => {});
  await page.waitForTimeout(300);
  if (!(await page.locator('.wcm-sheet[data-open]').count())) await page.click('.wcm-top [aria-label="Show commands"]');
  await page.waitForTimeout(400);
  const tabName = (await page.locator('.wcm-switch').textContent()).trim();
  assert.equal(tabName, 'Table', 'the contextual Table tab opened');
  await page.screenshot({ path: 'smoke-mobile-6-table-tab.png' });
  await page.click('.wcm-item:has-text("Delete Table")');
  await page.waitForTimeout(400);

  // Find from the More menu.
  await page.click('.wcm-top [aria-label="More options"]').catch(async () => {
    await page.click('.wcm-sheet-head [aria-label="Hide commands"]');
    await page.click('.wcm-top [aria-label="More options"]');
  });
  await page.screenshot({ path: 'smoke-mobile-7-menu.png' });
  await page.click('.wcm-menu-item:has-text("Find")');
  await page.fill('.wcm-find-input', 'Studio');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const found = await page.evaluate(() => window.wordcraft.getSelectedText());
  assert.equal(found.toLowerCase(), 'studio', `find selected the match (${found})`);
  await page.screenshot({ path: 'smoke-mobile-8-find.png' });
  await page.click('.wcm-find [aria-label="Close find"]');

  // Pinch in Print Layout zooms the page.
  await page.evaluate(() => {
    window.wordcraft.execute('view.printLayout');
    window.wordcraft.execute('view.zoom', { value: 60 });
  });
  await page.waitForTimeout(800);
  const z0 = (await page.evaluate(() => window.wordcraft.execute('view.state'))).zoom;
  const b3 = await canvasBox(page);
  await touch.pinch(b3.x + b3.width / 2, b3.y + b3.height / 2, 80, 220);
  const z1 = (await page.evaluate(() => window.wordcraft.execute('view.state'))).zoom;
  console.log('  pinch zoom', z0, '->', z1);
  assert.ok(z1 > z0 * 1.3, `pinch zoomed in (${z0} -> ${z1})`);
  await page.screenshot({ path: 'smoke-mobile-9-print-layout.png' });
});

await phone('iphone', devices['iPhone 13'], async (page) => {
  await page.goto(`${base}/mobile`, { waitUntil: 'load' });
  await ready(page);
  // Viewing mode: no palette, an Edit button instead.
  await page.evaluate(() => window.wordcraft.setMode('viewing'));
  await page.waitForTimeout(600);
  assert.equal(await page.locator('.wcm-sheet').count(), 0, 'no palette while viewing');
  await page.screenshot({ path: 'smoke-mobile-10-iphone-viewing.png' });
  await page.click('.wcm-edit');
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.wordcraft.getMode()), 'editing');
  await page.emulateMedia({ colorScheme: 'dark' });
});

// A foldable: phone layout folded, Word's ribbon unfolded, switching live.
await phone('fold', { ...devices['Pixel 7'], viewport: { width: 344, height: 882 }, screen: { width: 344, height: 882 } }, async (page) => {
  await page.goto(`${base}/mobile`, { waitUntil: 'load' });
  await ready(page);
  await page.screenshot({ path: 'smoke-mobile-11-fold-closed.png' });
  await page.setViewportSize({ width: 884, height: 1104 });
  await page.waitForTimeout(2000);
  assert.equal(await page.locator('.wcm').count(), 0, 'unfolded: no phone layout');
  const prefs = await page.evaluate(() => window.wordcraft.getPrefs());
  assert.equal(prefs.hideRibbon, false, 'unfolded: the ribbon is back');
  assert.equal(prefs.hideStatusBar, false, 'unfolded: the status bar is back');
  await page.screenshot({ path: 'smoke-mobile-12-fold-open.png' });
  await page.setViewportSize({ width: 344, height: 882 });
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('.wcm').count(), 1, 'folded again: phone layout');
});

await browser.close();
if (failed) {
  console.error(logs.filter((l) => /error|warn|FAIL/i.test(l)).slice(-40).join('\n'));
  process.exit(1);
}
console.log('mobile smoke test passed');
