// Acceptance tests for the host owning the screen, on /host: comments owned by the host (the native
// pane never opens, compose before create), the `ui` switches applied live, the top bar (zones,
// presence before Share and the user icon, nothing overflowing at 360px), the File menu, and a
// snapshot showing default props render as before.
//
// Usage: npm run build && npm start &  (and npm run collab-server & for the presence scenario)
//        then  node smoke-host.mjs [http://localhost:3000]
// Writes smoke-host-*.png next to this file. Exits non-zero on any failure.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const logs = [];
let failed = false;

async function open(ctx, query, name) {
  const page = await ctx.newPage();
  page.on('console', (m) => logs.push(`[${name} ${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[${name} pageerror] ${e.message}`));
  await page.goto(`${base}/host${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.wordcraft && !!window.host, null, { timeout: 240_000 });
  await page.waitForTimeout(2500);
  return page;
}

async function scenario(name, query, fn, viewport = { width: 1360, height: 880 }) {
  const ctx = await browser.newContext({ viewport });
  let page;
  try {
    page = await open(ctx, query, name);
    await fn(page, ctx);
    const errors = logs.filter((l) => l.startsWith(`[${name} pageerror]`));
    assert.deepEqual(errors, [], 'no page errors');
    console.log(`ok ${name}`);
  } catch (e) {
    failed = true;
    console.error(`FAIL ${name}:`, e);
    await page?.screenshot({ path: `smoke-host-failure-${name}.png` }).catch(() => {});
  } finally {
    await ctx.close();
  }
}

/** Select a word in the first paragraph with text. */
const selectWord = (page) =>
  page.evaluate(() => {
    const ed = window.wordcraft;
    const p = ed.paragraphs().find((x) => x.text.trim().length > 8);
    const start = p.text.search(/\S/);
    const end = start + p.text.slice(start).search(/\s|$/);
    ed.selectText(p.path, start, end);
    return p.text.slice(start, end);
  });
const pane = (page) => page.evaluate(() => !!window.wordcraft.execute('view.state').commentsPane);
const count = (page) => page.evaluate(() => window.wordcraft.comments().length);
const newCommentKey = async (page) => {
  // A click gives the page keyboard focus, as a person's would; then select again and press.
  const box = await page.evaluate(() => window.wordcraft.canvas.getBoundingClientRect().toJSON());
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.7);
  await page.waitForTimeout(150);
  await selectWord(page);
  await page.keyboard.press('Control+Alt+KeyM');
  await page.waitForTimeout(400);
};

// ---------------------------------------------------------------------------------------------

await scenario('default-snapshot', '', async (page) => {
  // Default props: WordCraft's own title bar and ribbon, none of the host's surfaces.
  assert.equal(await page.locator('.wctb').count(), 0, 'no host top bar');
  assert.equal(await page.locator('.wcws').count(), 0, 'no workspace row');
  const prefs = await page.evaluate(() => window.wordcraft.getPrefs());
  for (const k of ['hideTitleBar', 'hideRibbon', 'hideStatusBar', 'hideContextMenu', 'hideRulers', 'hidePresence', 'hideShare', 'hideZoom', 'hideViewSwitcher', 'hostComments']) assert.equal(prefs[k], false, `${k} off by default`);
  assert.equal(prefs.miniToolbar, true);
  // The canvas fills the editor, as before.
  const box = await page.evaluate(() => {
    const r = document.querySelector('[data-wordcraft-root]').getBoundingClientRect();
    const c = window.wordcraft.canvas.getBoundingClientRect();
    return { top: c.top - r.top, h: c.height - r.height, w: c.width - r.width };
  });
  assert.deepEqual(box, { top: 0, h: 0, w: 0 }, 'the page fills the editor');
  const shot = await page.screenshot({ path: 'smoke-host-1-default.png' });
  // A snapshot of the chrome (title bar and ribbon), compared with the one kept on first run.
  const band = await sharp(shot).extract({ left: 0, top: 0, width: 1360, height: 150 }).removeAlpha().raw().toBuffer();
  mkdirSync('snapshots', { recursive: true });
  const file = 'snapshots/host-default-chrome.png';
  if (!existsSync(file)) writeFileSync(file, await sharp(band, { raw: { width: 1360, height: 150, channels: 3 } }).png().toBuffer());
  else {
    const want = await sharp(file).removeAlpha().raw().toBuffer();
    let diff = 0;
    for (let i = 0; i < band.length; i += 3) if (Math.abs(band[i] - want[i]) + Math.abs(band[i + 1] - want[i + 1]) + Math.abs(band[i + 2] - want[i + 2]) > 48) diff++;
    assert.ok(diff / (band.length / 3) < 0.01, `the default chrome matches its snapshot (${diff} pixels differ)`);
  }
  // The chrome is drawn (not blank): the band has many colours.
  const stats = await sharp(band, { raw: { width: 1360, height: 150, channels: 3 } }).stats();
  assert.ok(stats.channels[0].stdev > 10, 'title bar and ribbon are drawn');
});

await scenario('exclusive-drawer-10-runs', '?exclusive=drawer', async (page) => {
  const before = await count(page);
  for (let i = 0; i < 10; i++) {
    const word = await selectWord(page);
    // Alternate the keyboard shortcut and the command the ribbon, mini toolbar and menu run.
    if (i % 2) await newCommentKey(page);
    else await page.evaluate(() => window.wordcraft.execute('review.newComment'));
    await page.waitForTimeout(300);
    await page.evaluate(() => window.wordcraft.execute('view.commentsPane', { value: true }));
    await page.waitForTimeout(200);
    assert.equal(await pane(page), false, `run ${i + 1}: the native pane stays shut`);
    assert.equal(await count(page), before + Math.ceil(i / 2), `run ${i + 1}: no empty comment`);
    const compose = page.locator('.wccm-compose');
    await compose.waitFor({ timeout: 3000 });
    assert.ok((await compose.locator('.wccm-hint').innerText()).includes(word), `run ${i + 1}: the composer is on the selection`);
    if (i % 2) {
      await compose.locator('button:has-text("Cancel")').click();
      assert.equal(await count(page), before + Math.ceil(i / 2), 'cancelling leaves nothing');
    } else {
      await compose.locator('textarea').fill(`Note ${i}`);
      await compose.locator('button:has-text("Comment")').click();
      await page.waitForTimeout(300);
      assert.equal(await count(page), before + i / 2 + 1, 'submitting makes it');
    }
  }
  await page.screenshot({ path: 'smoke-host-2-drawer.png' });
  // Edit and Delete sit under the text as icons.
  const card = page.locator('.wccm-thread').first();
  assert.equal(await card.locator('.wccm-tools [aria-label^="Edit comment"]').count(), 1);
  await card.locator('.wccm-tools [aria-label^="Delete comment"]').click();
  await page.waitForTimeout(300);
  assert.equal(await count(page), before + 4, 'deleted from its icon');
  // The host API is never blocked by disabledCommands.
  const made = await page.evaluate(() => {
    const ed = window.wordcraft;
    ed.setDisabledCommands(['review.*', 'select.*']);
    const p = ed.paragraphs().find((x) => x.text.trim().length > 8);
    const id = ed.comments.create({ text: 'From the host', anchor: { path: p.path, start: 0, end: 4 } });
    ed.comments.reply(id, 'A reply');
    ed.comments.edit(id, 'Edited by the host');
    ed.comments.resolve(id);
    const resolved = ed.comments.list().find((c) => c.id === id).resolved;
    ed.comments.reopen(id);
    let empty = 'no error';
    try {
      ed.comments.create({ text: '  ' });
    } catch (e) {
      empty = String(e);
    }
    const out = { text: ed.comments.list().find((c) => c.id === id).text, resolved, empty };
    ed.comments.delete(id);
    ed.setDisabledCommands([]);
    return out;
  });
  assert.equal(made.text, 'Edited by the host');
  assert.equal(made.resolved, true);
  assert.match(made.empty, /needs text/);
});

await scenario('exclusive-callback', '?exclusive=callback', async (page) => {
  const before = await count(page);
  const word = await selectWord(page);
  await newCommentKey(page);
  const composer = page.locator('[data-testid=host-composer]');
  await composer.waitFor({ timeout: 3000 });
  assert.ok((await composer.innerText()).includes(word), "the host's composer has the selection");
  assert.equal(await count(page), before, 'nothing made before submitting');
  assert.equal(await pane(page), false);
  assert.equal(await page.locator('.wccm-compose').count(), 0, "the package's composer stays out of the way");
  await composer.locator('button:has-text("Cancel")').click();
  assert.equal(await count(page), before, 'cancel leaves nothing');
  await selectWord(page);
  await page.evaluate(() => window.wordcraft.execute('review.newComment'));
  await composer.waitFor({ timeout: 3000 });
  await composer.locator('textarea').fill('Posted from the host');
  await composer.locator('button:has-text("Post")').click();
  await page.waitForTimeout(1500);
  assert.equal(await count(page), before + 1);
  // The standalone drawer lists it, fitting its 300px column.
  const drawer = page.locator('[data-testid=host-panel] .wccm');
  await drawer.locator('text=Posted from the host').waitFor({ timeout: 3000 });
  const fits = await drawer.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  assert.ok(fits, 'the drawer fits its width');
  await page.screenshot({ path: 'smoke-host-3-callback.png' });
});

await scenario('ui-live', '?comments=1', async (page) => {
  const word = await selectWord(page);
  const before = await page.evaluate(() => ({ text: window.wordcraft.getText(), caret: JSON.stringify(window.wordcraft.caret()) }));
  const ed1 = await page.evaluate(() => (window.__first = window.wordcraft, true));
  assert.ok(ed1);
  const steps = [
    { ribbon: false },
    { ribbon: false, titleBar: false, statusBar: false },
    { ribbon: 'tabs', rulers: false, contextMenu: false, selectionToolbar: false, navigationPane: false },
    { workspace: { comments: false } },
    'paper',
    {},
  ];
  for (const ui of steps) {
    await page.evaluate((u) => window.host.setUi(u), ui);
    await page.waitForTimeout(500);
    const now = await page.evaluate(() => ({ same: window.__first === window.wordcraft && !window.wordcraft.destroyed, text: window.wordcraft.getText(), caret: JSON.stringify(window.wordcraft.caret()), prefs: window.wordcraft.getPrefs() }));
    assert.ok(now.same, `${JSON.stringify(ui)}: no remount`);
    assert.equal(now.text, before.text, `${JSON.stringify(ui)}: document kept`);
    assert.equal(now.caret, before.caret, `${JSON.stringify(ui)}: selection kept`);
    if (ui === 'paper') {
      for (const k of ['hideTitleBar', 'hideRibbon', 'hideStatusBar', 'hideContextMenu', 'hideRulers', 'hideNavPane']) assert.equal(now.prefs[k], true, `paper: ${k}`);
      assert.equal(now.prefs.miniToolbar, false);
      assert.equal(await page.locator('.wcws').count(), 0, 'paper: no workspace row');
      assert.equal(await page.evaluate(() => window.wordcraft.can('file.print')), false, 'paper: Ctrl+P is off with the File menu');
      await page.screenshot({ path: 'smoke-host-4-paper.png' });
    }
    if (ui.workspace) assert.equal(await page.locator('.wcws .wccm-launch').count(), 0, 'the Comments button is gone');
  }
  const back = await page.evaluate(() => window.wordcraft.getPrefs());
  assert.equal(back.hideRibbon, false, 'back to the default');
  assert.equal(back.hideTitleBar, false);
  assert.equal(await page.evaluate(() => window.wordcraft.can('file.print')), true, 'Ctrl+P is back');
  assert.ok(word.length > 0);
});

await scenario('file-menu', '?fileMenu=1', async (page) => {
  const can = await page.evaluate(() => Object.fromEntries(['file.print', 'file.open', 'file.exportPdf', 'file.save', 'file.new'].map((id) => [id, window.wordcraft.can(id)])));
  assert.deepEqual(can, { 'file.print': false, 'file.open': false, 'file.exportPdf': true, 'file.save': true, 'file.new': false }, 'shortcuts follow the menu');
  const menu = await page.evaluate(() => window.wordcraft.getPrefs().fileMenu.map((i) => `${i.id}${i.host ? '*' : ''}${i.disabled ? '!' : ''}${i.hidden ? '-' : ''}`));
  assert.deepEqual(menu, ['info', 'save', 'print!', 'share*', 'export', 'export.docx-', 'export.pdf', 'moveToFolder*']);
  await page.evaluate(() => window.wordcraft.execute('ui.backstage', { value: true, page: 'export' }));
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'smoke-host-5-file-menu.png' });
});

for (const width of [1360, 360]) {
  await scenario(
    `top-bar-${width}`,
    '?topBar=1',
    async (page) => {
      const bar = page.locator('.wctb');
      await bar.waitFor();
      assert.equal((await page.evaluate(() => window.wordcraft.getPrefs())).hideTitleBar, true, "the host's bar replaces the title bar");
      const fit = await bar.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const out = [...el.querySelectorAll('button,a,span.wctb-title')].filter((b) => b.getBoundingClientRect().width > 0).map((b) => ({ k: b.className, l: b.getBoundingClientRect().left, r: b.getBoundingClientRect().right }));
        return { scroll: el.scrollWidth <= el.clientWidth + 1, inside: out.every((b) => b.l >= r.left - 1 && b.r <= r.right + 1), page: document.documentElement.scrollWidth <= window.innerWidth };
      });
      assert.deepEqual(fit, { scroll: true, inside: true, page: true }, `nothing overflows at ${width}px`);
      // Back (keyboard accessible), Share and the user menu.
      await page.locator('.wctb-back').focus();
      await page.keyboard.press('Enter');
      await page.locator('.wctb-share').click();
      await page.locator('.wctb-me').click();
      await page.locator('.wctb-menu >> text=Sign out').click();
      await page.waitForTimeout(200);
      const events = await page.evaluate(() => window.host.events);
      for (const e of ['back', 'share', 'signout']) assert.ok(events.includes(e), `${e} reached the host: ${events}`);
      if (width === 360) assert.equal(await page.locator('.wctb-share > span').count(), 0, 'Share is an icon at 360px');
      await page.screenshot({ path: `smoke-host-6-top-bar-${width}.png` });
    },
    { width, height: width === 360 ? 760 : 880 },
  );
}

// Two live collaborators: avatars (in their cursor colours) before Share and the user icon, and
// clicking one follows that person.
{
  const name = 'presence';
  const room = `p${Date.now()}`;
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 880 } });
  try {
    const host = await open(ctx, `?topBar=1&doc=${room}&name=Oliver&color=%230e7490`, name);
    const ana = await open(ctx, `?doc=${room}&name=Ana%20Lima&color=%23c2410c`, name);
    const ben = await open(ctx, `?doc=${room}&name=Ben%20Otieno&color=%237e22ce`, name);
    await host.waitForFunction(() => document.querySelectorAll('.wctb-people .wctb-avatar').length === 2, null, { timeout: 30_000 });
    const order = await host.evaluate(() => {
      const right = document.querySelector('.wctb-right');
      const pos = (sel) => [...right.querySelectorAll('*')].indexOf(right.querySelector(sel));
      return { people: pos('.wctb-people'), share: pos('.wctb-share'), me: pos('.wctb-me'), colors: [...document.querySelectorAll('.wctb-people .wctb-avatar')].map((a) => getComputedStyle(a).borderColor) };
    });
    assert.ok(order.people >= 0 && order.people < order.share && order.share < order.me, `avatars, then Share, then the user: ${JSON.stringify(order)}`);
    assert.deepEqual(order.colors.sort(), ['rgb(126, 34, 206)', 'rgb(194, 65, 12)'], 'each in their cursor colour');
    await host.locator('.wctb-avatar[title^="Ana Lima"]').click();
    await host.waitForTimeout(500);
    assert.equal(await host.locator('.wctb-avatar[title^="Ana Lima"]').getAttribute('aria-pressed'), 'true', 'following Ana');
    await host.screenshot({ path: 'smoke-host-7-presence.png' });
    void ana;
    void ben;
    console.log(`ok ${name}`);
  } catch (e) {
    failed = true;
    console.error(`FAIL ${name}:`, e);
  } finally {
    await ctx.close();
  }
}

await browser.close();
if (failed) {
  console.error(logs.filter((l) => /error|warn/i.test(l)).slice(-40).join('\n'));
  process.exit(1);
}
console.log('all host scenarios passed');
