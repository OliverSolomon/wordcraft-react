import { Playground } from './Playground';

export const metadata = { title: 'Playground' };

export default function Page() {
  return (
    <div className="wrap">
      <div className="demo-head">
        <span className="eyebrow">Playground</span>
        <h1>Every prop, live</h1>
        <p>Change the props above the editor and watch them apply. The code underneath updates to match, ready to paste into your app.</p>
      </div>
      <Playground />
    </div>
  );
}
