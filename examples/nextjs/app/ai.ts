import type { AiOptions } from '@gamine/wordcraft-react';

/** The AI bar's options for these examples: stream text from /api/ai (Claude). */
export const ai: AiOptions = {
  async *complete({ signal, ...request }) {
    const res = await fetch('/api/ai', { method: 'POST', body: JSON.stringify(request), signal });
    if (!res.ok || !res.body) throw new Error(await res.text().catch(() => `AI request failed (${res.status})`));
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield decoder.decode(value, { stream: true });
    }
  },
};
