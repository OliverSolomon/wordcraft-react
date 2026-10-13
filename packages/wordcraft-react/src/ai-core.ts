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
  | 'match-format'
  /** Document chat: answer a question from numbered passages, citing them as [n]. */
  | 'ask'
  /** Structured output: a JSON block list (headings, lists, tables, diagrams, charts…). */
  | 'structure'
  /** Writing checks: a JSON list of issues in one paragraph. */
  | 'check'
  /** Translate the text into `language`, keeping its structure. */
  | 'translate';

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
  /** Document chat: the conversation so far (oldest first). */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Writing checks: the goals (audience, formality, domain, intent) the check follows. */
  goals?: Record<string, string>;
  /** Translate: the target language. */
  language?: string;
  /** Structured output: data the answer must take its values from (CSV or JSON). */
  data?: string;
}

/** The system prompt for document chat. */
export const CHAT_SYSTEM_PROMPT =
  'You answer questions about a document. The document is given as numbered passages [1], [2]… Answer only from them; if they do not contain the answer, say so plainly. After each sentence that uses a passage, cite it like [3]. Be concise. Plain text, no Markdown headings.';

/** The system prompt for structured output (see `BLOCKS_PROMPT` for the schema). */
export const STRUCTURE_SYSTEM_PROMPT = 'You build document content for a word processor as structured blocks.';

/** The block schema the model is asked to follow. */
export const BLOCKS_PROMPT = `Answer with a JSON array of blocks in a \`\`\`json fence, and nothing else. Block types:
{"type":"heading","level":1-4,"text":"…"}
{"type":"paragraph","text":"… (**bold**, *italic*, [link](https://…) allowed)"}
{"type":"list","ordered":false,"items":["…",{"text":"…","children":["…"]}]}
{"type":"checklist","items":[{"text":"…","done":false}]}
{"type":"table","columns":["…"],"rows":[["…"]],"align":["left","right"],"caption":"…"}
{"type":"callout","variant":"note|tip|warning","title":"…","text":"…"}
{"type":"quote","text":"…","cite":"…"}
{"type":"code","language":"…","text":"…"}
{"type":"diagram","source":"<Mermaid code: flowchart TD, sequenceDiagram, timeline, gantt, mindmap, erDiagram, stateDiagram-v2; an org chart is flowchart TD>","alt":"one sentence describing the diagram"}
{"type":"chart","chart":"column|bar|line|area|pie|donut|scatter|stacked","title":"…","categories":["…"],"series":[{"name":"…","values":[1,2]}],"xTitle":"…","yTitle":"…"}
{"type":"equation","latex":"…"}
{"type":"qr","text":"https://…"}
{"type":"toc"} {"type":"rule"} {"type":"pageBreak"} {"type":"signature","name":"…","title":"…"} {"type":"date"}
Rules: when data is given, every value must come from it exactly; never invent figures, names or dates: write [number], [name] or [to confirm] instead. No HTML, no scripts, no image URLs.`;

/** The system prompt for writing checks. */
export const CHECK_SYSTEM_PROMPT =
  'You are a careful editor. Find problems in one paragraph and reply with only a JSON array (no prose, no fence) of issues: {"text": exact substring of the paragraph, "category": "correctness"|"clarity"|"engagement"|"delivery", "message": short explanation, "replacements": [suggested replacement text], "confidence": 0 to 1}. Report at most 8 issues, only real ones. Reply [] when there are none.';

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
    case 'ask':
      return `Question: ${r.prompt}`;
    case 'structure':
      return r.prompt;
    case 'check':
      return `Check this paragraph:\n<paragraph>\n${r.selection}\n</paragraph>`;
    case 'translate':
      return `Translate ${target} into ${r.prompt || 'English'}. Keep its structure, names and numbers. Reply with only the translation.`;
    case 'match-format':
      return `Rewrite ${r.selection ? 'the selected text' : 'the last paragraph'} so its structure, length and tone match the rest of the document.`;
    default:
      return r.prompt;
  }
}
