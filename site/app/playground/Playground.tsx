'use client';

import { useMemo, useRef, useState } from 'react';
import { RIBBON_TABS, type ChangeInfo, type EditorMode, type RibbonDisplay, type RibbonTab, type WordcraftEditorRef } from '@gamine/wordcraft-react';

import { Editor } from '@/components/Editor';

export function Playground() {
  const ref = useRef<WordcraftEditorRef>(null);
  const [name, setName] = useState('Ada Lovelace');
  const [dark, setDark] = useState(false);
  const [titleBar, setTitleBar] = useState(true);
  const [ribbon, setRibbon] = useState<RibbonDisplay>('full');
  const [mode, setMode] = useState<EditorMode>('editing');
  const [hidden, setHidden] = useState<RibbonTab[]>([]);
  const [noOpen, setNoOpen] = useState(false);
  const [ai, setAi] = useState(true);
  const [versions, setVersions] = useState(true);
  const [status, setStatus] = useState<ChangeInfo>({ rev: 0, dirty: false });
  const [saved, setSaved] = useState('');

  const code = useMemo(() => {
    const props = [
      `user={{ name: ${JSON.stringify(name)} }}`,
      dark && 'dark',
      !titleBar && 'titleBar={false}',
      ribbon !== 'full' && `ribbon="${ribbon}"`,
      mode !== 'editing' && `mode="${mode}"`,
      hidden.length > 0 && `hiddenTabs={${JSON.stringify(hidden)}}`,
      noOpen && `disabledCommands={['file.open']}`,
      ai && 'ai',
      versions && 'versionHistory',
      'onSave={(file) => upload(file.blob)}',
    ].filter(Boolean);
    return `<WordcraftEditor\n  ${props.join('\n  ')}\n/>`;
  }, [name, dark, titleBar, ribbon, mode, hidden, noOpen, ai, versions]);

  return (
    <div className="panel" style={{ marginBottom: 48 }}>
      <div className="controls">
        <label>
          Name <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 150 }} />
        </label>
        <label>
          Ribbon
          <select value={ribbon} onChange={(e) => setRibbon(e.target.value as RibbonDisplay)}>
            <option value="full">Always show</option>
            <option value="tabs">Show tabs only</option>
            <option value="hidden">Hidden</option>
          </select>
        </label>
        <label>
          Mode
          <select value={mode} onChange={(e) => setMode(e.target.value as EditorMode)}>
            <option value="editing">Editing</option>
            <option value="reviewing">Reviewing</option>
            <option value="viewing">Viewing</option>
          </select>
        </label>
        <label>
          Hide tab
          <select
            value=""
            onChange={(e) => {
              const t = e.target.value as RibbonTab;
              if (t) setHidden((h) => (h.includes(t) ? h.filter((x) => x !== t) : [...h, t]));
            }}
          >
            <option value="">{hidden.length ? `${hidden.length} hidden` : 'None'}</option>
            {RIBBON_TABS.map((t) => (
              <option key={t} value={t}>
                {hidden.includes(t) ? '✓ ' : ''}
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={titleBar} onChange={(e) => setTitleBar(e.target.checked)} /> Title bar
        </label>
        <label>
          <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} /> Dark
        </label>
        <label>
          <input type="checkbox" checked={noOpen} onChange={(e) => setNoOpen(e.target.checked)} /> Turn off File › Open
        </label>
        <label>
          <input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} /> AI <span className="extra">Extra</span>
        </label>
        <label>
          <input type="checkbox" checked={versions} onChange={(e) => setVersions(e.target.checked)} /> Version history <span className="extra">Extra</span>
        </label>
      </div>
      <Editor
        ref={ref}
        // Version history is read when the editor starts, so switching it starts a fresh editor.
        key={versions ? 'with-versions' : 'without-versions'}
        sample
        dark={dark}
        user={{ name: name.trim() || 'Guest', color: '#2554c7' }}
        titleBar={titleBar}
        ribbon={ribbon}
        mode={mode}
        hiddenTabs={hidden}
        disabledCommands={noOpen ? ['file.open'] : []}
        ai={ai || null}
        versionHistory={versions ? { documentId: 'playground' } : false}
        onChange={setStatus}
        onReady={(ed) => Object.assign(window, { wordcraft: ed })}
        onSave={async (file) => setSaved(`${file.name} (${file.reason}, ${Math.round(file.bytes.byteLength / 1024)} KB)`)}
      />
      <div className="note">
        rev {status.rev} · {status.dirty ? 'unsaved changes' : 'saved'}
        {saved && ` · last onSave: ${saved}`} · The editor is on <code>window.wordcraft</code> for your console.
      </div>
      <pre className="codeblock" style={{ margin: 16, boxShadow: 'none' }}>
        {code}
      </pre>
    </div>
  );
}
