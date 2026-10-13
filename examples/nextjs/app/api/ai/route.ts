// The AI bar's endpoint: streams Claude's answer as plain text. Set ANTHROPIC_API_KEY (and
// optionally ANTHROPIC_MODEL). With WORDCRAFT_FAKE_AI=1 it streams a canned answer, for tests.
// Any model works: the editor only needs text back.
import { aiSystemPrompt, aiUserMessage, describeAiRequest, type AiRequest } from '@gamine/wordcraft-react/core';

export const runtime = 'nodejs';

type Body = Omit<AiRequest, 'signal'>;

export async function POST(req: Request) {
  const body = (await req.json()) as Body;
  const task = describeAiRequest(body);
  // The package builds the message for every kind of request: writing, document chat (numbered
  // passages and history), writing checks, structured blocks (with data) and translation.
  const user = aiUserMessage(body);

  if (process.env.WORDCRAFT_FAKE_AI === '1') {
    const skills = body.instructions?.includes('Humaniser') ? ' with the Humaniser' : '';
    const words = `Here is a draft paragraph for "${task.slice(0, 40)}". It was written by the test model${skills}.`.split(' ');
    const stream = new ReadableStream({
      async start(ctl) {
        for (const w of words) {
          ctl.enqueue(new TextEncoder().encode(w + ' '));
          await new Promise((r) => setTimeout(r, 20));
        }
        ctl.close();
      },
    });
    return new Response(stream, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return new Response('Set ANTHROPIC_API_KEY on the server to use the AI bar.', { status: 501 });

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5',
      max_tokens: 4000,
      stream: true,
      system: aiSystemPrompt(body),
      messages: [{ role: 'user', content: user }],
    }),
    signal: req.signal,
  });
  if (!upstream.ok || !upstream.body) return new Response(`AI request failed (${upstream.status}).`, { status: 502 });

  // Turn Claude's server-sent events into a plain text stream of the answer.
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  const text = upstream.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctl) {
        buffer += decoder.decode(chunk, { stream: true });
        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          try {
            const ev = JSON.parse(line.slice(5));
            if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') ctl.enqueue(encoder.encode(ev.delta.text));
          } catch {
            // keep-alive or partial line
          }
        }
      },
    }),
  );
  return new Response(text, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}
