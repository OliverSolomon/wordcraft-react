'use client';

import { useState } from 'react';

import { Editor } from '@/components/Editor';

export function VersionsDemo() {
  const [open, setOpen] = useState(false);
  return (
    <div className="demo-frame">
      <div className="controls">
        <button type="button" className="btn" onClick={() => setOpen(!open)}>
          {open ? 'Close version history' : 'Open version history'}
        </button>
        <span style={{ color: 'var(--muted)' }}>Versions are kept in this browser (IndexedDB).</span>
      </div>
      <Editor
        sample
        user={{ name: 'You', color: '#0f9d58' }}
        versionHistory={{ documentId: 'demo-versions', interval: 20_000 }}
        versionsOpen={open}
        onVersionsOpenChange={setOpen}
      />
    </div>
  );
}
