'use client';

import { useState } from 'react';

export function CopyInstall() {
  const cmd = 'npm i @gamine/wordcraft-react';
  const [done, setDone] = useState(false);
  return (
    <span className="install">
      <span>{cmd}</span>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(cmd).then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          });
        }}
      >
        {done ? 'Copied' : 'Copy'}
      </button>
    </span>
  );
}
