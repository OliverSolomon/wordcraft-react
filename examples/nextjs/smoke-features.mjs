// Acceptance tests for the Google Docs style features on /features: the organisation letterhead,
// access levels, comments with mentions and a store, and marks over the text.
//
// Usage: npm run build && npm start &  then  node smoke-features.mjs [http://localhost:3000]
// Writes smoke-features-*.png next to this file. Exits non-zero on any failure.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const logs = [];
let failed = false;

async function scenario(name, query, fn) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 880 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  page.on('console', (m) => logs.push(`[${name} ${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[${name} pageerror] ${e.message}`));
  try {
    await page.goto(`${base}/features${query}`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.wordcraft && !!window.features, null, { timeout: 240_000 });
    await page.waitForTimeout(2500);
    await fn(page, ctx);
    console.log(`ok ${name}`);
  } catch (e) {
    failed = true;
    console.error(`FAIL ${name}:`, e);
    await page.screenshot({ path: `smoke-features-failure-${name}.png` }).catch(() => {});
  } finally {
    await ctx.close();
  }
}

const text = (page) => page.evaluate(() => window.wordcraft.getText());
const typeAtStart = async (page, s) => {
  await page.evaluate(() => {
    window.wordcraft.canvas.focus();
    try {
      window.wordcraft.execute('caret.docStart');
    } catch {}
  });
  await page.keyboard.type(s);
  await page.waitForTimeout(500);
};
/** The text of every header part in the .docx the editor saves. */
const headerXml = async (page) => {
  const bytes = await page.evaluate(() => Array.from(window.wordcraft.export('docx')));
  const dir = mkdtempSync(join(tmpdir(), 'wc-docx-'));
  const file = join(dir, 'doc.docx');
  writeFileSync(file, Buffer.from(bytes));
  try {
    return execFileSync('unzip', ['-p', file, 'word/header*.xml'], { encoding: 'utf8' });
  } catch {
    return '';
  }
};
const openLetterhead = async (page) => {
  await page.click('.wcai-launch');
  await page.click('[aria-label="AI Studio"]');
  await page.click('.wcai-tab:has-text("Letterhead")');
  await page.waitForTimeout(300);
};
const nameField = (page) => page.locator('input[placeholder="e.g. Open Studio Collective"]');

// ---------------------------------------------------------------------------------------------

await scenario('letterhead-late', '', async (page) => {
  // 1. Set after mount: the page shows it and Apply is enabled.
  await openLetterhead(page);
  assert.equal(await nameField(page).inputValue(), 'Sauti Salama');
  const apply = page.locator('button:has-text("Apply to document")');
  assert.equal(await apply.isEnabled(), true);
  await page.screenshot({ path: 'smoke-features-1-letterhead.png' });
  // 4. Apply twice: one letterhead in the header, and the host hears about it.
  await apply.click();
  await page.waitForTimeout(600);
  await apply.click();
  await page.waitForTimeout(600);
  const xml = await headerXml(page);
  assert.equal((xml.match(/Sauti Salama/g) ?? []).length, 1, 'one letterhead in word/header*.xml');
  assert.ok((await page.evaluate(() => window.features.events)).includes('letterhead:Sauti Salama'), 'onLetterheadApplied');
  await page.click('button:has-text("Remove from document")');
  await page.waitForTimeout(600);
  assert.ok(!(await headerXml(page)).includes('Sauti Salama'), 'Remove clears it');
});

await scenario('letterhead-toggle-reload', '', async (page) => {
  // 2. Toggle the accent rule and reload: still the organisation's name.
  await openLetterhead(page);
  await page.click('.wcai-check input');
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!window.wordcraft && !!window.features, null, { timeout: 240_000 });
  await page.waitForTimeout(2500);
  await openLetterhead(page);
  assert.equal(await nameField(page).inputValue(), 'Sauti Salama');
});

await scenario('letterhead-host-change', '', async (page) => {
  // 3. The host changes its letterhead: shown at once (no override in this browser).
  await openLetterhead(page);
  await page.evaluate(() => window.features.setLetterhead({ name: 'Mazingira Trust', rule: true }));
  await page.waitForTimeout(400);
  assert.equal(await nameField(page).inputValue(), 'Mazingira Trust');
  // An override wins until it is reset.
  await nameField(page).fill('Mazingira Trust Kenya');
  await page.evaluate(() => window.features.setLetterhead({ name: 'Mazingira Trust', tagline: 'New tagline', rule: true }));
  await page.waitForTimeout(400);
  assert.equal(await nameField(page).inputValue(), 'Mazingira Trust Kenya');
  await page.click('button:has-text("Reset to organisation letterhead")');
  assert.equal(await nameField(page).inputValue(), 'Mazingira Trust');
});

await scenario('viewer', '?permission=view', async (page) => {
  const before = await text(page);
  await typeAtStart(page, 'VIEWER');
  assert.equal(await text(page), before, 'a viewer cannot type');
  await page.evaluate(() => navigator.clipboard.writeText('PASTED'));
  await page.keyboard.press('Control+V');
  await page.waitForTimeout(400);
  assert.equal(await text(page), before, 'a viewer cannot paste');
  const refused = await page.evaluate(() => {
    try {
      window.wordcraft.execute('text.insert', { text: 'API' });
      return false;
    } catch {
      return true;
    }
  });
  assert.ok(refused || (await text(page)) === before, 'commands refuse too');
  assert.equal(await page.locator('.wcai-launch').count(), 0, 'no AI writing for viewers');
  assert.equal(await page.locator('.wcws-chip:has-text("Viewing")').count(), 1, 'access chip');
  await page.screenshot({ path: 'smoke-features-2-viewer.png' });
});

await scenario('commenter', '?permission=comment', async (page) => {
  const before = await text(page);
  await typeAtStart(page, 'COMMENTER');
  assert.equal(await text(page), before, 'a commenter cannot type');
  // But can comment, through the panel.
  await page.evaluate(() => {
    const p = window.wordcraft.paragraphs().find((x) => x.text.length > 20);
    window.wordcraft.selectText(p.path, 0, 9);
  });
  await page.click('.wccm-launch');
  await page.click('.wccm-top button:has-text("Comment")');
  await page.locator('.wccm-compose textarea').fill('Can we check this? @Otieno');
  await page.click('.wccm-people button:has-text("Otieno Odhiambo")').catch(() => {});
  await page.click('.wccm-compose button.wccm-primary');
  await page.waitForTimeout(800);
  const list = await page.evaluate(() => window.wordcraft.comments());
  assert.equal(list.length, 1, 'comment added');
  assert.equal(await text(page), before, 'the text is unchanged');
  await page.screenshot({ path: 'smoke-features-3-commenter.png' });
});

await scenario('suggester', '?permission=suggest', async (page) => {
  await typeAtStart(page, 'SUGGESTED ');
  assert.ok((await text(page)).includes('SUGGESTED'), 'a suggester can type');
  const bytes = await page.evaluate(() => Array.from(window.wordcraft.export('docx')));
  const dir = mkdtempSync(join(tmpdir(), 'wc-docx-'));
  writeFileSync(join(dir, 'd.docx'), Buffer.from(bytes));
  const doc = execFileSync('unzip', ['-p', join(dir, 'd.docx'), 'word/document.xml'], { encoding: 'utf8' });
  assert.ok(/<w:ins\b[^>]*w:author="Wanjiru Kamau"/.test(doc), 'the edit is a tracked insertion');
  assert.equal(await page.evaluate(() => window.wordcraft.getMode()), 'reviewing');
});

await scenario('lower-live', '', async (page) => {
  await typeAtStart(page, 'EDIT ');
  assert.ok((await text(page)).includes('EDIT'), 'an editor can type');
  const t0 = Date.now();
  await page.evaluate(() => window.features.setPermission('view'));
  await page.waitForSelector('.wcws-notice', { timeout: 2000 });
  const before = await text(page);
  await typeAtStart(page, 'LATE');
  assert.equal(await text(page), before, 'lowered to view: typing stops');
  assert.ok(Date.now() - t0 < 4000);
});

await scenario('comments', '', async (page) => {
  // Comment on a range, mention someone, reply, resolve; the store hears each step.
  await page.evaluate(() => {
    const p = window.wordcraft.paragraphs().find((x) => x.text.length > 20);
    window.wordcraft.selectText(p.path, 0, 12);
  });
  await page.click('.wccm-launch');
  await page.click('.wccm-top button:has-text("Comment")');
  const box = page.locator('.wccm-compose textarea');
  await box.click();
  await box.type('Please confirm the figures @Ami');
  await page.waitForSelector('.wccm-people button:has-text("Amina Yusuf")');
  await page.keyboard.press('Enter');
  assert.ok((await box.inputValue()).includes('@Amina Yusuf'), 'the picker completes the name');
  await page.click('.wccm-assign input');
  await page.click('.wccm-compose button.wccm-primary');
  await page.waitForTimeout(1500);
  let events = await page.evaluate(() => window.features.events);
  assert.ok(events.some((e) => e.startsWith('create:Please confirm')), `create: ${events}`);
  assert.ok(events.includes('mention:amina'), `mention: ${events}`);
  assert.equal(await page.locator('.wccm-assigned:has-text("Amina Yusuf")').count(), 1, 'assigned');
  // Reply.
  await page.locator('.wccm-replybox textarea').first().fill('Done, they match.');
  await page.click('.wccm-replybox button:has-text("Reply")');
  await page.waitForTimeout(1500);
  events = await page.evaluate(() => window.features.events);
  assert.ok(events.includes('reply:Done, they match.'), `reply: ${events}`);
  await page.screenshot({ path: 'smoke-features-4-comments.png' });
  // Resolve: it leaves Open and shows under Resolved.
  await page.click('.wccm-thread [aria-label="Resolve"]');
  await page.waitForTimeout(1500);
  events = await page.evaluate(() => window.features.events);
  assert.ok(events.some((e) => /^resolve:\d+:true$/.test(e)), `resolve: ${events}`);
  await page.click('.wccm-filters button:has-text("Resolved")');
  assert.equal(await page.locator('.wccm-thread').count(), 1);
  // Round trip through .docx: thread, author and resolved state survive.
  const after = await page.evaluate(async () => {
    const ed = window.wordcraft;
    const bytes = ed.export('docx');
    await ed.load({ name: 'round.docx', data: bytes });
    return ed.comments();
  });
  const first = after.find((c) => c.parent == null);
  const reply = after.find((c) => c.parent != null);
  assert.ok(first && first.resolved && first.author === 'Wanjiru Kamau' && first.text.includes('@Amina Yusuf'), JSON.stringify(after));
  assert.ok(reply && reply.parent === first.id && reply.text === 'Done, they match.', JSON.stringify(after));
});

await scenario('marks', '', async (page) => {
  const r = await page.evaluate(() => {
    const ed = window.wordcraft;
    const p = ed.paragraphs().find((x) => x.text.length > 30);
    ed.setMarks([{ id: 'issue-1', path: p.path, start: 4, end: 12, color: '#d93025' }]);
    ed.selectText(p.path, 6, 6);
    return p.path;
  });
  await page.waitForTimeout(600);
  const info = await page.evaluate(() => window.wordcraft.selectionInfo());
  assert.deepEqual(info.marks, ['issue-1'], JSON.stringify(info.marks));
  await page.screenshot({ path: 'smoke-features-5-marks.png' });
  await page.evaluate((path) => window.wordcraft.selectText(path, 25, 25), r);
  await page.waitForTimeout(400);
  assert.deepEqual((await page.evaluate(() => window.wordcraft.selectionInfo())).marks, []);
});

await browser.close();
if (failed) {
  console.error(logs.filter((l) => /error|warn|FAIL/i.test(l)).slice(-40).join('\n'));
  process.exit(1);
}
console.log('features smoke test passed');
