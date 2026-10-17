import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAPER_UI, resolveFileMenu, resolveUi, uiDisabled, uiPrefs, workspaceOn } from '../dist/surfaces.js';
import { DEFAULT_TOP_BAR, compactLevel, resolveTopBar } from '../dist/topbar.js';
import { hostOwnsComments } from '../dist/comments.js';

test('no ui prop changes nothing', () => {
  assert.deepEqual(uiPrefs(resolveUi(undefined)), {});
  assert.deepEqual(uiDisabled(resolveUi(undefined)), []);
});

test('each switch maps to its preference', () => {
  const p = uiPrefs({ titleBar: false, ribbon: false, statusBar: false, selectionToolbar: false, contextMenu: false, rulers: false, navigationPane: false, presence: false, share: false, modeSwitch: false, zoom: false, viewSwitcher: false });
  assert.deepEqual(p, { hideTitleBar: true, hideRibbon: true, ribbonCollapsed: false, hideStatusBar: true, miniToolbar: false, hideContextMenu: true, hideRulers: true, hideNavPane: true, hidePresence: true, hideShare: true, hideModeSwitch: true, hideZoom: true, hideViewSwitcher: true });
  assert.deepEqual(uiPrefs({ ribbon: 'tabs' }), { hideRibbon: false, ribbonCollapsed: true });
  assert.deepEqual(uiPrefs({ ribbon: true }), { hideRibbon: false, ribbonCollapsed: false });
});

test('paper hides everything, and its shortcuts', () => {
  const ui = resolveUi('paper');
  assert.equal(ui, PAPER_UI);
  const p = uiPrefs(ui);
  assert.equal(Object.entries(p).filter(([k, v]) => k.startsWith('hide') && v !== true).length, 0);
  const off = uiDisabled(ui);
  for (const id of ['ui.backstage', 'file.print', 'file.save', 'file.open', 'view.navigationPane', 'view.ruler', 'file.share']) assert.ok(off.includes(id), id);
  for (const k of ['ask', 'comments', 'checks', 'tools', 'voice']) assert.equal(workspaceOn(ui, k), false);
});

test('workspace switches one by one', () => {
  const ui = { workspace: { ask: false } };
  assert.equal(workspaceOn(ui, 'ask'), false);
  assert.equal(workspaceOn(ui, 'comments'), true);
  assert.equal(workspaceOn({}, 'voice'), true);
});

test('the File menu as a list: order, hidden, disabled, host items, sections, export formats', () => {
  const moved = () => {};
  const r = resolveFileMenu([
    { id: 'info' },
    { id: 'print', disabled: 'Printing is off' },
    { id: 'export.docx', hidden: true },
    { id: 'export.pdf', label: 'PDF' },
    { id: 'moveToFolder', label: 'Move to folder', section: 'Organise', onSelect: moved },
  ]);
  assert.deepEqual(
    r.pref.map((i) => [i.id, i.label, i.hidden, i.disabled, i.host, i.section]),
    [
      ['info', '', false, '', false, ''],
      ['print', '', false, 'Printing is off', false, ''],
      ['export.docx', '', true, '', false, ''],
      ['export.pdf', 'PDF', false, '', false, ''],
      ['moveToFolder', 'Move to folder', false, '', true, 'Organise'],
    ],
  );
  assert.equal(r.actions.get('moveToFolder'), moved);
  // A disabled print turns off Ctrl+P; pages left out of the list lose their shortcuts.
  for (const id of ['file.print', 'file.open', 'file.save', 'file.new']) assert.ok(r.disabled.includes(id), id);
  assert.ok(!r.disabled.includes('file.exportPdf'), 'PDF stays allowed');
});

test('the File menu by id leaves the rest alone', () => {
  const r = resolveFileMenu({ print: false, open: { label: 'Browse' } });
  assert.deepEqual(r.disabled, ['file.print', 'file.printPdf', 'file.printMarkup']);
  assert.equal(r.pref.find((i) => i.id === 'open').label, 'Browse');
});

test('the top bar resolves from true, zones or a function', () => {
  const ctx = { permission: 'view', collaborators: [] };
  assert.equal(resolveTopBar(undefined, ctx), null);
  assert.equal(resolveTopBar(true, ctx), DEFAULT_TOP_BAR);
  const fn = ({ permission }) => ({ right: [{ type: 'share', disabled: permission === 'view' ? 'Only editors' : false }] });
  assert.equal(resolveTopBar(fn, ctx).right[0].disabled, 'Only editors');
  assert.deepEqual([1360, 700, 500, 360].map(compactLevel), [0, 1, 2, 3]);
});

test('who owns comments', () => {
  assert.equal(hostOwnsComments({ exclusive: true }), true);
  assert.equal(hostOwnsComments({ nativePane: false }), true);
  assert.equal(hostOwnsComments({}), false);
  assert.equal(hostOwnsComments(null), false);
});
