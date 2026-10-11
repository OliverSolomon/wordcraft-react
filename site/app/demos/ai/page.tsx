import { DemoHead } from '@/components/DemoHead';
import { AiDemo } from './AiDemo';

export const metadata = { title: 'AI demo' };

export default function Page() {
  return (
    <div className="wrap" style={{ paddingBottom: 64 }}>
      <DemoHead title="AI writing and AI Studio" extra doc="ai">
        Click the sparkle at the bottom of the editor. This site has no server, so the first time it asks for your own OpenRouter, OpenAI, Anthropic or Gemini key, which stays in your browser and goes only to that provider. Then try the quick actions, the templates under +, and AI Studio (the sliders): turn skills on and off, design a letterhead and apply a palette.
      </DemoHead>
      <AiDemo />
    </div>
  );
}
