import { DemoHead } from '@/components/DemoHead';
import { FontsDemo } from './FontsDemo';

export const metadata = { title: 'Fonts demo' };

export default function Page() {
  return (
    <div>
      <DemoHead title="Fonts on demand" extra doc="fonts">
        Open the font box on the Home tab. Theme Fonts, Recently Used Fonts and All Fonts are listed as in Word, and every name is drawn in its own font: the ones on screen are fetched as you scroll. Pick one and the rest of its faces download. The buttons below apply a few through the API.
      </DemoHead>
      <FontsDemo />
    </div>
  );
}
