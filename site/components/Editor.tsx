'use client';

import { forwardRef } from 'react';
import { WordcraftEditor, type WordcraftEditorProps, type WordcraftEditorRef } from '@gamine/wordcraft-react';

/** The editor as the demos use it: a framed, tall container and a friendly loading state. */
export const Editor = forwardRef<WordcraftEditorRef, WordcraftEditorProps>(function Editor(props, ref) {
  return (
    <WordcraftEditor
      ref={ref}
      height="min(78vh, 860px)"
      loading={
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'var(--bg-soft)', color: 'var(--muted)', fontSize: 15 }}>
          <div style={{ textAlign: 'center' }}>
            <div className="spinner" />
            Starting WordCraft (about 12 MB, cached after the first visit)…
          </div>
        </div>
      }
      {...props}
    />
  );
});
