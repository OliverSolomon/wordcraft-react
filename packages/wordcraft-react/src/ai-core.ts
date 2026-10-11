/**
 * The AI bar's request shape and default task wording. Server-safe (no React, no DOM), so an
 * API route can import it from `@gamine/wordcraft-react/core`.
 */

export type AiAction = 'write' | 'continue' | 'rewrite' | 'shorten' | 'elaborate' | 'formal' | 'casual' | 'fix' | 'summarize';

export interface AiRequest {
  /** What the person typed (empty for quick actions). */
  prompt: string;
  /** The quick action picked, or `write` for a typed request. */
  action: AiAction;
  /** The selected text, or an empty string. */
  selection: string;
  /** The document's text, for context (trim it on your server if your model needs a shorter one). */
  document: string;
  /** Aborted when the person cancels. */
  signal: AbortSignal;
}

/** Default prompts for quick actions, for `complete` functions that only send `prompt`. */
export function describeAiRequest(r: Pick<AiRequest, 'action' | 'prompt' | 'selection'>): string {
  const target = r.selection ? 'the selected text' : 'the document';
  switch (r.action) {
    case 'continue':
      return 'Continue writing the document from where it ends, in the same voice. Write one or two paragraphs.';
    case 'rewrite':
      return `Rewrite ${target}, keeping its meaning.`;
    case 'shorten':
      return `Make ${target} shorter without losing the key points.`;
    case 'elaborate':
      return `Expand ${target} with more detail.`;
    case 'formal':
      return `Rewrite ${target} in a more formal tone.`;
    case 'casual':
      return `Rewrite ${target} in a more casual tone.`;
    case 'fix':
      return `Fix the spelling and grammar of ${target}. Change nothing else.`;
    case 'summarize':
      return `Summarize ${target} in a short paragraph.`;
    default:
      return r.prompt;
  }
}

