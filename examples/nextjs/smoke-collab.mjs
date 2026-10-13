// Two people co-editing in two browsers through a y-websocket server.
//
// Needs the example running (npm run build && npm start) and the collaboration server
// (npm run collab-server). Usage: node smoke-collab.mjs [http://localhost:3000]
// Writes collab-*.png screenshots. Exits non-zero on failure.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const docId = `smoke-${Date.now()}`;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function person(name) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 860 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`[${name} ${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[${name} pageerror] ${e.message}`));
  await page.goto(`${base}/collab?doc=${docId}&name=${encodeURIComponent(name)}`);
  await page.waitForFunction(() => !!window.wordcraft, null, { timeout: 180_000 });
  return { page, logs, name };
}

const text = (p) => p.page.evaluate(() => window.wordcraft.getText());
const until = (p, fn, arg, what, timeout = 30_000) =>
  p.page.waitForFunction(fn, arg, { timeout }).catch(() => {
    throw new Error(`${p.name}: timed out waiting for ${what}`);
  });

let failed = false;
let a, b;
try {
  a = await person('Alice Achieng');
  await a.page.waitForTimeout(2500); // Alice joins first and shares her (blank) document.
  b = await person('Brian Otieno');
  await b.page.waitForTimeout(2500);

  // Alice types through the API, Brian sees it.
  await a.page.evaluate(() => window.wordcraft.execute('text.insert', { text: 'Hello from Alice. ' }));
  await until(b, () => window.wordcraft.getText().includes('Hello from Alice.'), null, "Alice's text");

  // Brian types with the keyboard at the end, Alice sees it.
  await b.page.mouse.click(650, 430);
  await b.page.keyboard.press('Control+End');
  await b.page.keyboard.type('Brian was here. ');
  await until(a, () => window.wordcraft.getText().includes('Brian was here.'), null, "Brian's typing");

  // Both type at the same moment in the same paragraph: both words survive, both converge.
  await Promise.all([
    a.page.evaluate(() => window.wordcraft.execute('text.insert', { text: '[A1] ' })),
    b.page.evaluate(() => window.wordcraft.execute('text.insert', { text: '[B1] ' })),
  ]);
  await until(a, () => window.wordcraft.getText().includes('[B1]'), null, 'concurrent edit from Brian');
  await until(b, () => window.wordcraft.getText().includes('[A1]'), null, 'concurrent edit from Alice');
  await a.page.waitForTimeout(800);
  assert.equal(await text(a), await text(b), 'documents converge');

  // Alice's Undo takes back only Alice's last change.
  await a.page.mouse.click(650, 430);
  await a.page.keyboard.press('Control+z');
  await until(a, () => !window.wordcraft.getText().includes('[A1]'), null, "Alice's undo");
  await until(b, () => !window.wordcraft.getText().includes('[A1]'), null, "Alice's undo reaching Brian");
  const after = await text(b);
  assert.ok(after.includes('[B1]') && after.includes('Brian was here.') && after.includes('Hello from Alice.'), `undo kept others' work: ${after}`);

  // Presence: Brian's caret, selection and name show on Alice's page; avatars in the title bar.
  await b.page.evaluate(() => window.wordcraft.execute('select.all'));
  await until(
    a,
    () => [...window.wordcraftProvider.awareness.getStates().values()].some((s) => s.user?.name === 'Brian Otieno' && s.cursor?.anchor && s.cursor?.head),
    null,
    "Brian's selection in awareness",
  );
  // Presence avatars at the bottom right: each sees the other within two seconds, and
  // clicking one follows that person until you scroll yourself.
  await a.page.waitForSelector('.wcws-avatar[title^="Brian Otieno"]', { timeout: 2000 });
  await b.page.waitForSelector('.wcws-avatar[title^="Alice Achieng"]', { timeout: 2000 });
  await a.page.click('.wcws-avatar[title^="Brian Otieno"]');
  await until(a, () => window.wordcraft.selectionInfo()?.following === 'Brian Otieno', null, 'following Brian');
  await a.page.mouse.move(650, 500);
  await a.page.mouse.wheel(0, 300);
  await until(a, () => window.wordcraft.selectionInfo()?.following === null, null, 'following stops when Alice scrolls');
  // A comment travels with the document.
  await b.page.evaluate(() => {
    const p = window.wordcraft.paragraphs().find((x) => x.text.length > 5);
    window.wordcraft.selectText(p.path, 0, 5);
    window.wordcraft.execute('review.newComment', { text: 'Seen by both?' });
  });
  await until(a, () => window.wordcraft.comments().some((c) => c.text === 'Seen by both?' && c.author === 'Brian Otieno'), null, "Brian's comment");
  await a.page.waitForTimeout(1200);
  await a.page.screenshot({ path: 'collab-alice-sees-brian.png' });
  await b.page.screenshot({ path: 'collab-brian.png' });

  // AutoSave overwrites the one shared file with the merged document.
  await until(a, () => document.querySelector('[data-testid=saved]')?.textContent?.includes('AutoSaved'), null, 'AutoSave', 60_000); // slow on CI's software GPU
  const res = await fetch(`${base}/api/documents/${docId}`);
  assert.equal(res.status, 200, 'shared file exists');
  assert.ok((await res.arrayBuffer()).byteLength > 1000, 'shared file is a docx');

  // A third person joining gets the live shared document (not the stored file).
  const c = await person('Chidi Okafor');
  await until(c, () => window.wordcraft.getText().includes('Brian was here.'), null, 'shared document for a late joiner');
  assert.equal(await text(c), await text(a), 'late joiner converges');
  console.log('collab smoke test passed');
} catch (e) {
  failed = true;
  console.error('collab smoke test FAILED:', e.message);
  for (const p of [a, b].filter(Boolean)) {
    console.error(`${p.name} text:`, JSON.stringify(await text(p).catch((e) => String(e))));
    await p.page.screenshot({ path: `collab-failure-${p.name.split(' ')[0]}.png` }).catch(() => {});
    console.error(p.logs.filter((l) => !l.includes('debug')).slice(-20).join('\n'));
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
