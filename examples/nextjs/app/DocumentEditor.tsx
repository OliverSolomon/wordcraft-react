'use client';

import { useRef, useState } from 'react';
import { WordcraftEditor, type WordcraftEditorRef, type ChangeInfo, type EditorMode, type RibbonDisplay } from '@gamine/wordcraft-react';
import { ai } from './ai';

export function DocumentEditor() {
  const editor = useRef<WordcraftEditorRef>(null);
  const [status, setStatus] = useState<ChangeInfo>({ rev: 0, dirty: false });
  const [dark, setDark] = useState(false);
  const [name, setName] = useState('Ada Lovelace');
  const [titleBar, setTitleBar] = useState(true);
  const [ribbon, setRibbon] = useState<RibbonDisplay>('full');
  const [lastSave, setLastSave] = useState<string>('');
  const [mode, setMode] = useState<EditorMode>('editing');
  const [lean, setLean] = useState(false);
  // Where AI answers come from: this app's /api/ai route, or only people's own API keys.
  const [aiSource, setAiSource] = useState<'app' | 'own' | 'off'>('app');

  const download = (format: 'docx' | 'pdf' | 'odt' | 'md') => {
    const blob = editor.current?.exportBlob(format);
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${editor.current?.title() || 'document'}.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  };

  const btn = { padding: '6px 10px', border: '1px solid #ccc', borderRadius: 6, background: '#fff', cursor: 'pointer', font: 'inherit' } as const;

  return (
    <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <label style={btn}>
          Open…
          <input
            type="file"
            accept=".docx,.docm,.dotx,.doc,.odt,.rtf,.md,.html,.txt"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) editor.current?.load(f);
              e.target.value = '';
            }}
          />
        </label>
        <button style={btn} onClick={() => download('docx')}>Download .docx</button>
        <button style={btn} onClick={() => download('pdf')}>Download .pdf</button>
        <button style={btn} onClick={() => editor.current?.execute('text.insert', { text: 'Hello from React. ' })}>Insert text via API</button>
        <button style={btn} onClick={() => setDark((d) => !d)}>{dark ? 'Light' : 'Dark'} UI</button>
        <label>
          Name{' '}
          <input aria-label="Your name" value={name} onChange={(e) => setName(e.target.value)} style={{ ...btn, cursor: 'text', width: 140 }} />
        </label>
        <label>
          <input type="checkbox" checked={titleBar} onChange={(e) => setTitleBar(e.target.checked)} /> Title bar
        </label>
        <label>
          Ribbon{' '}
          <select aria-label="Ribbon display" value={ribbon} onChange={(e) => setRibbon(e.target.value as RibbonDisplay)} style={btn}>
            <option value="full">Always show</option>
            <option value="tabs">Show tabs only</option>
            <option value="hidden">Hidden</option>
          </select>
        </label>
        <label>
          Mode{' '}
          <select aria-label="Mode" value={mode} onChange={(e) => setMode(e.target.value as EditorMode)} style={btn}>
            <option value="editing">Editing</option>
            <option value="reviewing">Reviewing</option>
            <option value="viewing">Viewing</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={lean} onChange={(e) => setLean(e.target.checked)} /> Hide Mailings, Zotero, Open
        </label>
        <label>
          AI{' '}
          <select aria-label="AI" value={aiSource} onChange={(e) => setAiSource(e.target.value as 'app' | 'own' | 'off')} style={btn}>
            <option value="app">App endpoint (+ own keys)</option>
            <option value="own">Own API keys only</option>
            <option value="off">Off</option>
          </select>
        </label>
        <span data-testid="status" style={{ color: '#555' }}>
          rev {status.rev} · {status.dirty ? 'unsaved changes' : 'saved'} {lastSave && `· last save: ${lastSave}`}
        </span>
      </div>

      <WordcraftEditor
        ref={editor}
        sample
        dark={dark}
        user={{ name: name.trim() || 'Guest', color: '#c2410c' }}
        titleBar={titleBar}
        ribbon={ribbon}
        mode={mode}
        hiddenTabs={lean ? ['Mailings', 'Zotero'] : []}
        disabledCommands={lean ? ['file.open'] : []}
        ai={aiSource === 'app' ? ai : aiSource === 'own' ? true : null}
        autoSave
        height="calc(100vh - 110px)"
        style={{ borderRadius: 8, border: '1px solid #ddd' }}
        onChange={setStatus}
        // Handy for poking at the API from the browser console: window.wordcraft.commands()
        onReady={(ed) => Object.assign(window, { wordcraft: ed })}
        onSave={async (file) => {
          // Replace with an upload to your API, e.g. fetch('/api/documents/42', { method: 'PUT', body: file.blob })
          setLastSave(`${file.name} (${file.reason}, ${Math.round(file.bytes.byteLength / 1024)} KB)`);
        }}
      />
    </div>
  );
}
