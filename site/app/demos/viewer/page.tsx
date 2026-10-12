import { DemoHead } from '@/components/DemoHead';
import { ViewerDemo } from './ViewerDemo';

export const metadata = { title: 'Viewer demo' };

export default function Page() {
  return (
    <div>
      <DemoHead title="Document viewer" doc="props">
        <code>mode=&quot;viewing&quot;</code> with <code>titleBar=&#123;false&#125;</code> and <code>ribbon=&quot;hidden&quot;</code>: real pages, read only. People can still select, copy and search. Open your own .docx to see it the way Word lays it out.
      </DemoHead>
      <ViewerDemo />
    </div>
  );
}
