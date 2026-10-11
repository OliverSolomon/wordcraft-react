'use client';

import { Editor } from '@/components/Editor';

export function AiDemo() {
  return (
    <div className="panel">
      <Editor sample user={{ name: 'You', color: '#2554c7' }} ai={{ letterhead: { name: 'Open Studio Collective', tagline: 'Makers sharing space since 2019', contact: 'hello@openstudio.example', align: 'left' } }} />
    </div>
  );
}
