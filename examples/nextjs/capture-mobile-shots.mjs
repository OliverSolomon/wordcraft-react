// Takes the phone layout's screenshots for the documentation site (site/public/shots/mobile-*.jpg)
// from the example app's /mobile page. Usage, with the example served on :3005:
//   node capture-mobile-shots.mjs http://localhost:3005
// The page runs at a device pixel ratio of 1 (see smoke-mobile.mjs for why).
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', '..', 'site', 'public', 'shots');
mkdirSync(OUT, { recursive: true });
const app = (process.argv[2] ?? 'http://localhost:3005').replace(/\/$/, '');

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ...devices['Pixel 7'], deviceScaleFactor: 1 });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const save = async (name) => {
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, `${name}.jpg`), type: 'jpeg', quality: 86 });
  console.log('shot', name);
};

await page.goto(`${app}/mobile`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.wordcraft, null, { timeout: 240_000 });
await page.waitForSelector('.wcm-top');
await page.waitForTimeout(3000);
await save('mobile-page');

// A long-pressed word: handles and the floating toolbar.
const box = await page.evaluate(() => {
  const r = window.wordcraft.canvas.getBoundingClientRect();
  return { x: r.x, y: r.y };
});
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 150, y: box.y + 240 }] });
await page.waitForTimeout(700);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForSelector('.wcm-floatie');
await save('mobile-select');

// The palette on Home, then Insert Table.
await page.click('.wcm-top [aria-label="Show commands"]');
await page.waitForSelector('.wcm-sheet[data-open]');
await save('mobile-palette');
await page.click('.wcm-switch');
await page.click('.wcm-tab:has-text("Insert")');
await page.click('.wcm-item:has-text("Table")');
await page.click('.wcm-stepper [aria-label="More columns"]');
await save('mobile-table');

await browser.close();
