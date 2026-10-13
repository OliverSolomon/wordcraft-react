/**
 * One way for every AI feature (the bar, document chat, writing checks, originality rewrites,
 * structured blocks) to get an answer: the person's own key first, then the app's provider, then
 * the app's `complete` function, the same order as the AI bar.
 */
import type { AiRequest } from './ai-core.js';
import { completeWith, readStoredAi } from './ai-providers.js';
import type { AiProviderConfig } from './ai-providers.js';

export interface AiSource {
  complete?: (request: AiRequest) => Promise<string> | AsyncIterable<string>;
  provider?: AiProviderConfig;
  allowUserKey?: boolean;
}

/** The function that answers, or null when no source is set up. */
export function resolveComplete(options: AiSource): ((r: AiRequest) => Promise<string> | AsyncIterable<string>) | null {
  const own = (options.allowUserKey ?? true) && typeof window !== 'undefined' ? readStoredAi() : null;
  const active = own || (options.provider?.apiKey ? options.provider : null);
  if (active) return (r) => completeWith(active, r);
  return options.complete ?? null;
}

export type PartialRequest = Partial<Omit<AiRequest, 'signal'>> & Pick<AiRequest, 'action'> & { signal?: AbortSignal };

/** Ask for a whole answer (streamed chunks go to `onChunk` as they come). */
export async function completeText(options: AiSource, partial: PartialRequest, onChunk?: (soFar: string) => void): Promise<string> {
  const fn = resolveComplete(options);
  if (!fn) throw new Error('AI is not set up: add a key in AI Studio, or ask your administrator.');
  const request: AiRequest = {
    prompt: '',
    selection: '',
    document: '',
    instructions: '',
    skills: [],
    ...partial,
    signal: partial.signal ?? new AbortController().signal,
  };
  const out = fn(request);
  if (typeof (out as AsyncIterable<string>)[Symbol.asyncIterator] === 'function') {
    let acc = '';
    for await (const chunk of out as AsyncIterable<string>) {
      if (request.signal.aborted) break;
      acc += chunk;
      onChunk?.(acc);
    }
    return acc;
  }
  const whole = await (out as Promise<string>);
  onChunk?.(whole);
  return whole;
}

/** Pull the first JSON value out of a model's answer (fenced or bare). */
export function parseJsonAnswer<T>(answer: string): T | null {
  const fence = answer.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  for (const c of [fence?.[1], answer]) {
    if (!c) continue;
    const start = c.search(/[[{]/);
    if (start < 0) continue;
    const open = c[start];
    const end = c.lastIndexOf(open === '[' ? ']' : '}');
    if (end <= start) continue;
    try {
      return JSON.parse(c.slice(start, end + 1)) as T;
    } catch {
      // try the next candidate
    }
  }
  return null;
}
