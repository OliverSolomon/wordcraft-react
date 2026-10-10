'use client';

import { useRef, useState } from 'react';
import { WordcraftEditor, type WordcraftEditorRef, type ChangeInfo } from '@gamine/wordcraft-react';

export function DocumentEditor() {
  const editor = useRef<WordcraftEditorRef>(null);
  const [status, setStatus] = useState<ChangeInfo>({ rev: 0, dirty: false });
  const [dark, setDark] = useState(false);
  const [lastSave, setLastSave] = useState<string>('');

  const download = (format: 'docx' | 'pdf' | 'odt' | 'md') => {
    const blob = editor.current?.exportBlob(format);
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${editor.current?.title() || 'document'}.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  };

  const btn = { padding: '6px 10px', border: '1px solid #ccc', borderRadius: 6, background: '#fff', cursor: 'pointer' } as const;

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <label style={btn}>
          Open…
          <input
            type="file"
            accept=".docx,.docm,.dotx,.odt,.rtf,.md,.html,.txt"
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
        <span style={{ fontSize: 13, color: '#555' }}>
          rev {status.rev} · {status.dirty ? 'unsaved changes' : 'saved'} {lastSave && `· last save: ${lastSave}`}
        </span>
      </div>

      <WordcraftEditor
        ref={editor}
        sample
        dark={dark}
        height="calc(100vh - 110px)"
        style={{ borderRadius: 8, border: '1px solid #ddd' }}
        onChange={setStatus}
        // Handy for poking at the API from the browser console: window.wordcraft.commands()
        onReady={(ed) => Object.assign(window, { wordcraft: ed })}
        onSave={async (file) => {
          // Replace with an upload to your API, e.g. fetch('/api/documents', { method: 'PUT', body: file.bytes })
          setLastSave(`${file.name} (${Math.round(file.bytes.byteLength / 1024)} KB)`);
        }}
      />
    </div>
  );
}
