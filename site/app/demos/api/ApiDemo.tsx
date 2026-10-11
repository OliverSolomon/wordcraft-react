'use client';

import { useRef, useState } from 'react';
import type { WordcraftEditorRef } from '@gamine/wordcraft-react';

type WordcraftEditor = NonNullable<WordcraftEditorRef>;

import { Editor } from '@/components/Editor';

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

const ACTIONS: Array<{ label: string; code: string; run: (ed: WordcraftEditor) => unknown }> = [
  { label: 'Insert a heading and a paragraph', code: "execute('text.insert', { text }) · execute('para.heading1')", run: (ed) => {
      ed.execute('caret.docEnd');
      ed.execute('text.newParagraph');
      ed.execute('text.insert', { text: 'Added from code' });
      ed.execute('para.heading1');
      ed.execute('text.newParagraph');
      ed.execute('para.normal');
      ed.execute('text.insert', { text: 'Anything the ribbon can do, a command can do.' });
      return 'inserted';
    } },
  { label: 'Make the selection bold and blue', code: "execute('format.bold') · execute('format.color', { color: '2554C7' })", run: (ed) => {
      if (!ed.getSelectedText()) ed.execute('select.paragraph');
      ed.execute('format.bold');
      ed.execute('format.color', { color: '2554C7' });
      return ed.getSelectedText();
    } },
  { label: 'Insert a 3 × 4 table', code: "execute('insert.table', { rows: 3, cols: 4 })", run: (ed) => ed.execute('insert.table', { rows: 3, cols: 4 }) },
  { label: 'Add a comment on the selection', code: "execute('review.newComment')", run: (ed) => {
      if (!ed.getSelectedText()) ed.execute('select.word');
      return ed.execute('review.newComment');
    } },
  { label: 'Read the text', code: 'getText()', run: (ed) => ed.getText().slice(0, 600) + '…' },
  { label: 'Count the commands', code: 'commands().length', run: (ed) => `${ed.commands().length} commands` },
  { label: 'Download as .docx', code: "exportBlob('docx')", run: (ed) => (download(ed.exportBlob('docx'), 'document.docx'), 'downloaded') },
  { label: 'Download as PDF', code: "exportBlob('pdf')", run: (ed) => (download(ed.exportBlob('pdf'), 'document.pdf'), 'downloaded') },
  { label: 'Get the Markdown', code: 'getMarkdown()', run: (ed) => ed.getMarkdown().slice(0, 600) + '…' },
  { label: 'Undo', code: 'undo()', run: (ed) => (ed.undo(), `canUndo: ${ed.canUndo()}`) },
];

export function ApiDemo() {
  const ref = useRef<WordcraftEditorRef>(null);
  const [out, setOut] = useState('Results appear here.');
  return (
    <div className="api-grid">
      <div className="panel">
        <div className="api-list">
          {ACTIONS.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={() => {
                const ed = ref.current;
                if (!ed) return;
                try {
                  const r = a.run(ed);
                  setOut(typeof r === 'string' ? r : JSON.stringify(r, null, 2));
                } catch (e) {
                  setOut(`Error: ${e instanceof Error ? e.message : String(e)}`);
                }
              }}
            >
              {a.label}
              <code>{a.code}</code>
            </button>
          ))}
        </div>
        <pre className="output">{out}</pre>
      </div>
      <div className="panel">
        <Editor ref={ref} sample user={{ name: 'You' }} />
      </div>
    </div>
  );
}
