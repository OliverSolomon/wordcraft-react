/**
 * AI providers the bar can call straight from the browser with an API key: OpenRouter (any
 * model), OpenAI, Anthropic, Google Gemini, or any OpenAI-compatible endpoint. Each streams
 * plain text.
 *
 * A key used here is visible to the page, so use it for a person's *own* key (they add it in
 * the bar's settings and it stays in their browser), or a short-lived key your backend issues
 * for them. For your organisation's key, keep it on your server and pass `complete` instead.
 */
import type { AiRequest } from './ai-core.js';
import { describeAiRequest } from './ai-core.js';

export type AiProviderId = 'openrouter' | 'openai' | 'anthropic' | 'gemini' | 'custom';

export interface AiProviderConfig {
  provider: AiProviderId;
  apiKey: string;
  /** Model id; each provider has a default. */
  model?: string;
  /** For `custom`: an OpenAI-compatible base URL, e.g. `https://my-llm.example.com/v1`. */
  baseUrl?: string;
}

export const AI_PROVIDERS: Record<AiProviderId, { name: string; defaultModel: string; keyHint: string; keyUrl?: string }> = {
  openrouter: { name: 'OpenRouter', defaultModel: 'openrouter/auto', keyHint: 'sk-or-…', keyUrl: 'https://openrouter.ai/keys' },
  openai: { name: 'OpenAI', defaultModel: 'gpt-4o-mini', keyHint: 'sk-…', keyUrl: 'https://platform.openai.com/api-keys' },
  anthropic: { name: 'Anthropic (Claude)', defaultModel: 'claude-sonnet-5-5', keyHint: 'sk-ant-…', keyUrl: 'https://console.anthropic.com/settings/keys' },
  gemini: { name: 'Google Gemini', defaultModel: 'gemini-2.5-flash', keyHint: 'AIza…', keyUrl: 'https://aistudio.google.com/apikey' },
  custom: { name: 'Other (OpenAI-compatible)', defaultModel: '', keyHint: 'API key' },
};

export const AI_SYSTEM_PROMPT =
  'You help people write in a word processor. Reply with only the text to put in the document: no preamble, no quotes around it, no Markdown headings or bold markers. Use blank lines between paragraphs. Match the document\'s language and tone unless asked otherwise.';

const MAX_CONTEXT = 24_000;

/** The system prompt for a request: the base prompt plus AI Studio's skills and context. */
export function aiSystemPrompt(r: Pick<AiRequest, 'instructions'>): string {
  return r.instructions?.trim() ? `${AI_SYSTEM_PROMPT}\n\nFollow these writing instructions:\n${r.instructions.trim()}` : AI_SYSTEM_PROMPT;
}

/** The user message for a request: the document (trimmed), the selection and the task. */
export function aiUserMessage(r: Omit<AiRequest, 'signal' | 'instructions' | 'skills'>): string {
  const doc = r.document.length > MAX_CONTEXT ? r.document.slice(-MAX_CONTEXT) : r.document;
  return [
    `Document so far:\n<document>\n${doc}\n</document>`,
    r.selection ? `Selected text:\n<selection>\n${r.selection}\n</selection>` : '',
    `Task: ${describeAiRequest(r)}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Read a server-sent-events body, yielding what `pick` extracts from each `data:` JSON line. */
async function* sse(res: Response, pick: (ev: any) => string | undefined): AsyncIterable<string> {
  if (!res.ok || !res.body) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.text();
      const j = JSON.parse(body);
      msg = j?.error?.message ?? j?.message ?? body.slice(0, 200);
    } catch {
      // keep the status line
    }
    throw new Error(`AI request failed: ${msg}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const t = pick(JSON.parse(data));
        if (t) yield t;
      } catch {
        // partial or keep-alive line
      }
    }
  }
}

/** Stream an answer from a provider with an API key. */
export function completeWith(cfg: AiProviderConfig, request: AiRequest): AsyncIterable<string> {
  const meta = AI_PROVIDERS[cfg.provider];
  const model = cfg.model?.trim() || meta.defaultModel;
  const user = aiUserMessage(request);
  const system = aiSystemPrompt(request);
  const { signal } = request;
  if (!cfg.apiKey.trim()) throw new Error('Add an API key in the AI settings first.');

  if (cfg.provider === 'anthropic') {
    return (async function* () {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal,
        headers: {
          'x-api-key': cfg.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ model, max_tokens: 1500, stream: true, system, messages: [{ role: 'user', content: user }] }),
      });
      yield* sse(res, (ev) => (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' ? ev.delta.text : undefined));
    })();
  }

  if (cfg.provider === 'gemini') {
    return (async function* () {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
      const res = await fetch(url, {
        method: 'POST',
        signal,
        headers: { 'x-goog-api-key': cfg.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
        }),
      });
      yield* sse(res, (ev) => ev.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join(''));
    })();
  }

  // OpenRouter, OpenAI and OpenAI-compatible endpoints share the chat completions API.
  const base =
    cfg.provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : cfg.provider === 'openai' ? 'https://api.openai.com/v1' : (cfg.baseUrl ?? '').replace(/\/$/, '');
  if (!base) throw new Error('Set the endpoint URL in the AI settings.');
  if (!model) throw new Error('Set a model in the AI settings.');
  return (async function* () {
    const headers: Record<string, string> = { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' };
    if (cfg.provider === 'openrouter') {
      headers['HTTP-Referer'] = typeof location !== 'undefined' ? location.origin : 'https://github.com/OliverSolomon/wordcraft-react';
      headers['X-Title'] = 'WordCraft';
    }
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal,
      headers,
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    yield* sse(res, (ev) => ev.choices?.[0]?.delta?.content);
  })();
}

const KEY = 'wordcraft.ai';

/** The person's own provider and key, kept in this browser. */
export function readStoredAi(): AiProviderConfig | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as AiProviderConfig | null;
    return v && v.provider in AI_PROVIDERS && typeof v.apiKey === 'string' && v.apiKey ? v : null;
  } catch {
    return null;
  }
}

export function writeStoredAi(cfg: AiProviderConfig | null): void {
  try {
    if (cfg) localStorage.setItem(KEY, JSON.stringify(cfg));
    else localStorage.removeItem(KEY);
  } catch {
    // storage unavailable: the key lasts for this visit
  }
}
