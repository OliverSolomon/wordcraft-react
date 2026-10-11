'use client';

import { useRef, useState } from 'react';
import type { WordcraftEditorRef } from '@gamine/wordcraft-react';

import { Editor } from '@/components/Editor';

export function ViewerDemo() {
  const ref = useRef<WordcraftEditorRef>(null);
  const [name, setName] = useState('The Open Studio Handbook');
  return (
    <div className="panel">
      <div className="controls">
        <label className="btn">
          Open a .docx…
          <input
            type="file"
            accept=".docx,.doc,.odt,.rtf,.md,.html,.txt"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f || !ref.current) return;
              await ref.current.load(f);
              ref.current.setMode('viewing');
              setName(f.name);
            }}
          />
        </label>
        <button type="button" className="btn" onClick={() => ref.current?.print()}>
          Print
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            const blob = ref.current?.exportBlob('pdf');
            if (!blob) return;
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${name.replace(/\.[^.]+$/, '')}.pdf`;
            a.click();
          }}
        >
          Download PDF
        </button>
        <span style={{ color: 'var(--muted)' }}>{name}</span>
      </div>
      <Editor ref={ref} sample mode="viewing" titleBar={false} ribbon="hidden" fonts={false} />
    </div>
  );
}
