import { DemoHead } from '@/components/DemoHead';
import { Collaboration } from './Collaboration';

export const metadata = { title: 'Co-editing demo' };

export default function Page() {
  return (
    <div className="wrap" style={{ paddingBottom: 64 }}>
      <DemoHead title="Real-time co-editing" extra doc="co-editing">
        Ada and Grace edit the same document. Type in either one: the words, formatting and cursors show in the other, and each person&apos;s Undo takes back only their own changes. Open this page in another tab and you join as a third person. The demo syncs through your browser; a real app uses a server such as y-websocket.
      </DemoHead>
      <Collaboration />
    </div>
  );
}
