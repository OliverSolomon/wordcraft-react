import { DemoHead } from '@/components/DemoHead';
import { Playground } from './Playground';

export const metadata = { title: 'Playground' };

export default function Page() {
  return (
    <>
      <DemoHead title="Playground" doc="props">
        Change the props above the editor and watch them apply. The code underneath follows, ready to paste into your app.
      </DemoHead>
      <Playground />
    </>
  );
}
