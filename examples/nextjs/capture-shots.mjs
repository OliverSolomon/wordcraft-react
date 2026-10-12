// Takes the documentation site's screenshots (site/public/shots/*.jpg) from the running example
// app and the built site. Usage, with both served:
//   WORDCRAFT_FAKE_AI=1 npm start   (the example, on :3005)
//   a static server for site/out    (on :3100, under /wordcraft-react)
//   node capture-shots.mjs http://localhost:3005 http://localhost:3100/wordcraft-react
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', '..', 'site', 'public', 'shots');
mkdirSync(OUT, { recursive: true });
const app = (process.argv[2] ?? 'http://localhost:3005').replace(/\/$/, '');
const site = (process.argv[3] ?? 'http://localhost:3100/wordcraft-react').replace(/\/$/, '');

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });
const page = await ctx.newPage();

const save = async (name, clip) => {
  await page.screenshot({ path: join(OUT, `${name}.jpg`), type: 'jpeg', quality: 82, clip });
  console.log('shot', name);
};
const editorBox = async (p = page) => {
  const b = await p.locator('[data-wordcraft-root]').first().boundingBox();
  return { x: b.x, y: b.y, width: b.width, height: Math.min(b.height, 860) };
};
const ready = async (p = page) => {
  await p.waitForFunction(() => !!window.wordcraft, null, { timeout: 180_000 });
  await p.waitForTimeout(2500);
};
const at = async (x, y, opts) => {
  await page.mouse.move(x, y);
  await page.waitForTimeout(250);
  await page.mouse.click(x, y, opts);
};

// `site` as a third argument retakes only the site's shots.
const siteOnly = process.argv[4] === 'site';
const editorReady = async (p) => {
  await p.waitForSelector('canvas[data-wordcraft]', { timeout: 180_000 });
  await p.waitForTimeout(9000);
};
if (!siteOnly) {
// The example app, in the editor's dark interface.
await page.goto(`${app}/`, { waitUntil: 'load' });
await ready();
await page.click('button:has-text("Dark UI")');
await page.waitForTimeout(1200);
const box = await editorBox();
const X = box.x;
const Y = box.y;
await save('editor', box);

// The mini toolbar over a double-clicked word, then with the right-click menu.
await page.mouse.dblclick(X + 560, Y + 405);
await page.waitForTimeout(700);
await save('mini-toolbar', { x: X + 180, y: Y + 270, width: 900, height: 330 });
await page.mouse.click(X + 560, Y + 405, { button: 'right' });
await page.waitForTimeout(700);
await save('context-menu', { x: X + 180, y: Y + 300, width: 900, height: 480 });
await page.keyboard.press('Escape');
await page.mouse.click(X + 900, Y + 600);

// Font previews in the font box.
await at(X + 286, Y + 85);
await page.waitForFunction(() => window.wordcraft.hasFont('ABeeZee') || window.wordcraft.hasFont('Abel'), null, { timeout: 30_000 }).catch(() => {});
await page.waitForTimeout(2500);
await save('font-previews', { x: X + 100, y: Y + 60, width: 820, height: 560 });
await page.keyboard.press('Escape');
await page.mouse.click(X + 900, Y + 600);

// The collapsed ribbon.
await at(X + box.width - 20, Y + 147);
await page.waitForTimeout(800);
await save('collapsed', { x: X, y: Y, width: box.width, height: 520 });
await page.evaluate(() => window.wordcraft.setPrefs({ ribbonCollapsed: false }));
await page.waitForTimeout(600);

// The AI bar, a result, and AI Studio.
await page.evaluate(() => window.wordcraft.execute('caret.docEnd'));
await page.click('.wcai-launch');
await page.waitForTimeout(700);
await save('ai-bar', { x: X, y: Y + box.height - 520, width: box.width, height: 520 });
await page.click('.wcai-chip:has-text("Email draft")');
await page.waitForFunction(() => document.querySelector('.wcai-result')?.textContent?.includes('test model'), null, { timeout: 15_000 });
await page.waitForTimeout(800);
await save('ai-result', { x: X, y: Y + box.height - 520, width: box.width, height: 520 });
await page.click('.wcai-result [aria-label="Discard"]');
await page.click('[aria-label="AI Studio"]');
await page.waitForTimeout(600);
const studio = async () => {
  const b = await page.locator('.wcai-studio').boundingBox();
  return { x: b.x - 40, y: b.y - 30, width: b.width + 80, height: b.height + 130 };
};
await save('ai-skills', await studio());
await page.click('.wcai-tab:has-text("Letterhead")');
await page.fill('input[placeholder="e.g. Open Studio Collective"]', 'Mazingira Trust');
await page.fill('.wcai-field:has-text("Tagline") input', 'Restoring river basins since 2011');
await page.fill('input[placeholder="12 Alder Street, Nairobi"]', 'Ngong Road, Nairobi');
await page.fill('input[placeholder^="hello@"]', 'hello@mazingira.org · +254 711 482 905');
await page.waitForTimeout(400);
await save('ai-letterhead', await studio());
await page.click('.wcai-tab:has-text("Palette")');
await page.click('.wcai-palette:has-text("Forest")');
await page.waitForTimeout(400);
await save('ai-palette', await studio());
await page.click('[aria-label="Close AI Studio"]');
await page.click('[aria-label="More options"]');
await page.click('.wcai-item:has-text("Close")');

// Version history, with a version open.
await page.evaluate(() => window.scrollTo(0, 0));
await at(X + box.width / 2, Y + 18);
await page.waitForSelector('.wcvh-panel', { timeout: 5_000 });
await page.click('.wcvh-link:has-text("Name current version")');
await page.fill('.wcvh-input', 'Board draft');
await page.keyboard.press('Enter');
await page.waitForSelector('.wcvh-name:has-text("Board draft")');
await page.click('.wcvh-item:has(.wcvh-name:has-text("Board draft"))');
await page.waitForSelector('.wcvh-preview-doc canvas', { timeout: 60_000 });
await page.waitForSelector('.wcvh-loading', { state: 'detached', timeout: 60_000 });
await page.waitForTimeout(2500);
await save('versions', await editorBox());
await page.click('.wcvh-banner button:has-text("Back to current version")');
await page.click('[aria-label="Close version history"]');

// Viewing mode with the chrome hidden.
await page.click('text=Title bar');
await page.selectOption('select[aria-label="Ribbon display"]', 'hidden');
await page.selectOption('select[aria-label="Mode"]', 'viewing');
await page.waitForTimeout(1200);
await save('viewer', await editorBox());

}

// From the site: co-editing, the command API and the playground.
const s = await ctx.newPage();
await s.goto(`${site}/demos/collaboration/`, { waitUntil: 'load' });
await s.waitForFunction(() => document.querySelectorAll('canvas[data-wordcraft]').length === 2, null, { timeout: 240_000 });
await s.waitForTimeout(9000);
const two = await s.locator('.two').boundingBox();
await s.screenshot({ path: join(OUT, 'collab.jpg'), type: 'jpeg', quality: 82, clip: { x: two.x, y: two.y, width: two.width, height: Math.min(two.height, 700) } });
console.log('shot collab');

await s.goto(`${site}/demos/api/`, { waitUntil: 'load' });
await editorReady(s);
await s.click('.api-list button:has-text("Insert a 3 × 4 table")');
await s.click('.api-list button:has-text("Count the commands")');
await s.waitForTimeout(1000);
const api = await s.locator('.api-grid').boundingBox();
await s.screenshot({ path: join(OUT, 'api.jpg'), type: 'jpeg', quality: 82, clip: { x: api.x, y: api.y, width: api.width, height: Math.min(api.height, 760) } });
console.log('shot api');

await s.goto(`${site}/playground/`, { waitUntil: 'load' });
await editorReady(s);
const pg = await s.locator('.demo-frame').boundingBox();
await s.screenshot({ path: join(OUT, 'playground.jpg'), type: 'jpeg', quality: 82, clip: { x: pg.x, y: pg.y, width: pg.width, height: Math.min(pg.height, 760) } });
console.log('shot playground');

await browser.close();
