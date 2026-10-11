'use client';

import { useState } from 'react';
import { preloadWordcraft } from '@gamine/wordcraft-react';

import { Editor } from './Editor';

/** The landing page's editor: starts on request, so the page itself stays light. */
export function LaunchEditor() {
  const [on, setOn] = useState(false);
  return (
    <div className="frame">
      <div className="frame-bar">
        <i />
        <i />
        <i />
        <span>The Open Studio Handbook.docx</span>
      </div>
      {on ? (
        <Editor sample ai versionHistory={{ documentId: 'landing' }} user={{ name: 'You', color: '#2554c7' }} style={{ borderRadius: 0 }} />
      ) : (
        <div className="launch" style={{ height: 'min(70vh, 640px)' }}>
          <div>
            <h3>The whole word processor, live in this page</h3>
            <p>Ribbon, dialogs, page layout, tracked changes, comments, export to .docx and PDF.</p>
            <button type="button" className="btn primary" onMouseEnter={() => void preloadWordcraft()} onClick={() => setOn(true)}>
              Launch the editor
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
