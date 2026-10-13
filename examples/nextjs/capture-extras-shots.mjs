// Takes the documentation site's screenshots of the 0.3.5 Extras (site/public/shots/*.jpg) from
// /extras?mock=1 in the running example. Usage: WORDCRAFT_FAKE_AI=1 npm start, then
//   node capture-extras-shots.mjs [http://localhost:3000]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', '..', 'site', 'public', 'shots');
mkdirSync(OUT, { recursive: true });
const app = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function open() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`${app}/extras?mock=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.wordcraft && !!window.WC, null, { timeout: 240_000 });
  await page.waitForTimeout(3000);
  return { page, ctx };
}
const save = async (page, name) => {
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, `${name}.jpg`), type: 'jpeg', quality: 82 });
  console.log('shot', name);
};
const atEnd = (page) =>
  page.evaluate(() => {
    const ed = window.wordcraft;
    ed.execute('caret.docEnd');
    ed.execute('text.newParagraph');
  });
const insertPanel = async (page, label) => {
  await page.evaluate(() => window.wordcraft.canvas.focus());
  await page.getByRole('button', { name: /Write with/ }).first().click();
  await page.getByRole('button', { name: /^Insert/ }).first().click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
};

async function shot(name, fn) {
  const { page, ctx } = await open();
  try {
    await fn(page);
  } catch (e) {
    console.error(`could not take ${name}:`, e.message);
  } finally {
    await ctx.close();
  }
}

await shot('structure', async (page) => {
  await atEnd(page);
  await insertPanel(page, 'Table');
  await page.getByRole('button', { name: 'Paste CSV' }).click();
  await page.getByPlaceholder(/Funder,Amount,Deadline/).fill('Funder,Amount,Deadline\nAcme Trust,25000,2026-12-01\nBaobab Fund,40000,2027-02-15\nCoral Foundation,12500,2026-11-20');
  await page.getByPlaceholder(/What should the table show/).fill('a table sorted by amount with a total');
  await page.getByRole('button', { name: 'Generate' }).click();
  await page.locator('.wcst-table').waitFor({ timeout: 15000 });
  await save(page, 'structure-table');
  await page.getByRole('button', { name: 'Close' }).click();
  await insertPanel(page, 'Diagram');
  await page.getByPlaceholder(/What should the diagram show/).fill('a flowchart of our case referral process');
  await page.getByRole('button', { name: 'Generate' }).click();
  await page.locator('.wcst-preview img').waitFor({ timeout: 30000 });
  await save(page, 'structure-diagram');
  await page.getByRole('button', { name: 'Close' }).click();
  await insertPanel(page, 'Chart');
  await page.getByPlaceholder(/What should the chart show/).fill('bar chart of the amounts by funder');
  await page.getByRole('button', { name: 'Generate' }).click();
  await page.locator('.wcst-preview img').waitFor({ timeout: 15000 });
  await save(page, 'structure-chart');
});

await shot('slash', async (page) => {
  await atEnd(page);
  await page.evaluate(() => window.wordcraft.canvas.focus());
  await page.keyboard.type('/');
  await page.getByRole('listbox', { name: 'Insert' }).waitFor({ timeout: 5000 });
  await save(page, 'slash-menu');
});

await shot('brand', async (page) => {
  const pics = await page.evaluate(() => {
    const logo = document.createElement('canvas');
    logo.width = 240;
    logo.height = 120;
    const g = logo.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 240, 120);
    g.fillStyle = '#5b2a86';
    g.beginPath();
    g.arc(60, 60, 44, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#f2a541';
    g.fillRect(118, 30, 100, 60);
    const photo = document.createElement('canvas');
    photo.width = 300;
    photo.height = 200;
    const h = photo.getContext('2d');
    const grad = h.createLinearGradient(0, 0, 300, 200);
    grad.addColorStop(0, '#2a9d8f');
    grad.addColorStop(1, '#e9c46a');
    h.fillStyle = grad;
    h.fillRect(0, 0, 300, 200);
    return [logo.toDataURL('image/png'), photo.toDataURL('image/png')];
  });
  await page.evaluate(() => window.wordcraft.canvas.focus());
  await page.getByRole('button', { name: /Write with/ }).first().click();
  await page.getByRole('button', { name: 'AI Studio' }).click();
  await page.getByRole('tab', { name: 'Palette' }).click();
  await page.getByRole('button', { name: 'From a logo or photo' }).click();
  const input = page.locator('.wcbr-drop input[type=file]');
  const toFile = (url, name) => ({ name, mimeType: 'image/png', buffer: Buffer.from(url.split(',')[1], 'base64') });
  await input.setInputFiles([toFile(pics[0], 'logo.png'), toFile(pics[1], 'field-photo.png')]);
  await page.locator('.wcbr-swatch').first().waitFor({ timeout: 10000 });
  await save(page, 'brand-palette');
  await page.getByRole('tab', { name: 'Letterhead' }).click();
  await page.locator('input[type=file][accept*="image/png"]').first().setInputFiles([toFile(pics[0], 'logo.png')]);
  await page.getByRole('button', { name: 'Placement' }).click();
  await save(page, 'brand-placement');
});

await shot('chat', async (page) => {
  await page.getByRole('button', { name: /^Ask$/ }).click();
  const box = page.getByRole('textbox', { name: 'Ask about this document' });
  await box.fill('What does the document say about membership?');
  await box.press('Enter');
  await page.locator('.wcsp-cite').first().waitFor({ timeout: 15000 });
  await save(page, 'chat');
});

await shot('checks', async (page) => {
  await atEnd(page);
  await page.evaluate(() => window.wordcraft.execute('text.insert', { text: 'In order to utilise the space, members should basically book the kiln prior to arriving.' }));
  await page.waitForFunction(() => document.querySelector('[aria-label^="Writing checks,"]')?.textContent?.trim() !== '0', null, { timeout: 15000 });
  await page.getByRole('button', { name: /^Writing checks,/ }).click();
  await page.waitForTimeout(2500);
  await save(page, 'checks');
});

await shot('originality', async (page) => {
  await atEnd(page);
  await page.evaluate(() => window.wordcraft.execute('text.insert', { text: 'Sauti Salama runs a survivor-centred referral network across the county.' }));
  await page.getByRole('button', { name: 'Tools ▾' }).click();
  await page.getByRole('menuitem', { name: 'Originality' }).click();
  await page.getByRole('button', { name: 'Check originality' }).click();
  await page.getByText('2025 grant proposal (Ford)').waitFor({ timeout: 10000 });
  await save(page, 'originality');
});

await shot('outline', async (page) => {
  await page.getByRole('button', { name: 'Tools ▾' }).click();
  await page.getByRole('menuitem', { name: 'Outline' }).click();
  await save(page, 'outline');
});

await browser.close();
