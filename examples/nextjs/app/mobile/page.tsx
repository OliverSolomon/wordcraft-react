'use client';

import { WordcraftEditor } from '@gamine/wordcraft-react';
import { ai } from '../ai';

// The phone layout, full screen. On a narrow touch screen `mobile="auto"` (the default) picks it
// by itself; `?mobile=1` forces it on a desktop browser.
export default function MobilePage() {
  const forced = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('mobile');
  return (
    <main style={{ height: '100dvh', overflow: 'hidden' }}>
      <WordcraftEditor
        sample
        mobile={forced ? true : 'auto'}
        mobileOptions={{ onBack: () => history.back() }}
        user={{ name: 'Ada Lovelace', color: '#c2410c' }}
        ai={ai}
        versionHistory={{ documentId: 'mobile-example' }}
        height="100%"
        onReady={(ed) => Object.assign(window, { wordcraft: ed })}
        onSave={async () => undefined}
      />
    </main>
  );
}
