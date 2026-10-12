'use client';

import { forwardRef, useEffect, useState } from 'react';
import { WordcraftEditor, type WordcraftEditorProps, type WordcraftEditorRef } from '@gamine/wordcraft-react';

/** Follows the site's light or dark theme, so the editor's ribbon matches the page around it. */
function useSiteDark(): boolean {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setDark(root.dataset.theme !== 'light');
    read();
    const obs = new MutationObserver(read);
    obs.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

/** The editor as the demos use it: tall, themed with the site, with a quiet loading state. */
export const Editor = forwardRef<WordcraftEditorRef, WordcraftEditorProps>(function Editor(props, ref) {
  const siteDark = useSiteDark();
  return (
    <WordcraftEditor
      ref={ref}
      height="min(76vh, 820px)"
      dark={props.dark ?? siteDark}
      loading={
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'var(--panel)', color: 'var(--muted)', fontSize: 14 }}>
          <div style={{ textAlign: 'center' }}>
            <div className="spinner" />
            Starting the editor (about 12 MB, cached after the first visit)
          </div>
        </div>
      }
      {...props}
    />
  );
});
