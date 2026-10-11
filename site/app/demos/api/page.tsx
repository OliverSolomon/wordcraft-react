import { DemoHead } from '@/components/DemoHead';
import { ApiDemo } from './ApiDemo';

export const metadata = { title: 'Command API demo' };

export default function Page() {
  return (
    <div className="wrap" style={{ paddingBottom: 64 }}>
      <DemoHead title="Command API" doc="editor-api">
        Every button on the left calls the editor through its ref. <code>execute</code> runs the same commands as the ribbon and the keyboard, so anything a person can do, your code can do too.
      </DemoHead>
      <ApiDemo />
    </div>
  );
}
