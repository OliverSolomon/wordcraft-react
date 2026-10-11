/**
 * The AI bar's request shape and default task wording. Server-safe (no React, no DOM), so an
 * API route can import it from `@gamine/wordcraft-react/core`.
 */

export type AiAction =
  | 'write'
  | 'continue'
  | 'rewrite'
  | 'shorten'
  | 'elaborate'
  | 'formal'
  | 'casual'
  | 'fix'
  | 'summarize'
  | 'meeting-notes'
  | 'email'
  | 'outline'
  | 'brainstorm'
  | 'match-format';

export interface AiRequest {
  /** What the person typed (may be empty for quick actions, or add details to one). */
  prompt: string;
  /** The quick action picked, or `write` for a typed request. */
  action: AiAction;
  /** The selected text, or an empty string. */
  selection: string;
  /** The document's text, for context (trim it on your server if your model needs a shorter one). */
  document: string;
  /**
   * Extra instructions from AI Studio (an Extra): the writing skills that are on, such as the
   * Humaniser, and the letterhead as context. Add them to your system prompt. May be empty.
   */
  instructions?: string;
  /** Names of the skills that are on. */
  skills?: string[];
  /** Aborted when the person cancels. */
  signal: AbortSignal;
}

/** Default prompts for quick actions, for `complete` functions that only send `prompt`. */
export function describeAiRequest(r: Pick<AiRequest, 'action' | 'prompt' | 'selection'>): string {
  const task = baseTask(r);
  const extra = r.prompt.trim();
  return r.action === 'write' || !extra ? task : `${task}\nDetails from the writer: ${extra}`;
}

function baseTask(r: Pick<AiRequest, 'action' | 'prompt' | 'selection'>): string {
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
    case 'meeting-notes':
      return 'Write meeting notes: title, date, attendees, agenda, discussion, decisions and action items with owners. Use the document for context and leave [placeholders] for details you do not know.';
    case 'email':
      return `Draft an email${r.selection ? ' based on the selected text' : ' about the document'}: a subject line, a greeting, a short body and a sign-off.`;
    case 'outline':
      return `Write an outline for ${r.selection ? 'the selected text' : 'the document'}: short headings, each with a few points.`;
    case 'brainstorm':
      return `Brainstorm a list of ideas for ${r.selection ? 'the selected text' : 'the document'}, one per line.`;
    case 'match-format':
      return `Rewrite ${r.selection ? 'the selected text' : 'the last paragraph'} so its structure, length and tone match the rest of the document.`;
    default:
      return r.prompt;
  }
}
