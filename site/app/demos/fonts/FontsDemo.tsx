'use client';

import { useRef, useState } from 'react';
import type { WordcraftEditorRef } from '@gamine/wordcraft-react';

import { Editor } from '@/components/Editor';

const PICKS = ['Playfair Display', 'Merriweather', 'Lato', 'Montserrat', 'Caveat', 'JetBrains Mono'];

export function FontsDemo() {
  const ref = useRef<WordcraftEditorRef>(null);
  const [note, setNote] = useState('Select some text, then pick a font.');
  const apply = async (font: string) => {
    const ed = ref.current;
    if (!ed) return;
    if (!ed.getSelectedText()) ed.execute('select.paragraph');
    ed.execute('format.font', { name: font });
    setNote(`${font}: downloading…`);
    for (let i = 0; i < 40 && !ed.hasFont(font); i++) await new Promise((r) => setTimeout(r, 250));
    setNote(ed.hasFont(font) ? `${font} is loaded and in use.` : `${font} is still downloading.`);
  };
  return (
    <div className="demo-frame">
      <div className="controls">
        {PICKS.map((f) => (
          <button key={f} type="button" className="btn" onClick={() => void apply(f)}>
            {f}
          </button>
        ))}
        <span style={{ color: 'var(--muted)' }}>{note}</span>
      </div>
      <Editor ref={ref} sample user={{ name: 'You' }} />
    </div>
  );
}
