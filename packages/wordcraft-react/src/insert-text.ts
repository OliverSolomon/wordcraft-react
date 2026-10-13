import type { WordcraftEditor } from './core.js';

/** Put plain text into the document at the caret (replacing a selection), paragraph by paragraph. */
export function insertText(editor: WordcraftEditor, text: string): void {
  const paras = text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').split(/\n\n|\n/);
  paras.forEach((p, i) => {
    if (i > 0) editor.execute('text.newParagraph');
    if (p) editor.execute('text.insert', { text: p });
  });
}
