// The composer's rich-text editor: a real TipTap editor (loaded lazily, as
// ChatSpace loads its editor chunk when the first composer mounts), so
// `.ProseMirror`, `view.dom.editor`, transaction/update events and the
// ⌘B/⌘I/⌘E/⌘⇧S marks behave like the real thing (metadata.ts «editor»).
// Enter without Shift sends (also with Ctrl/⌘/Alt); Shift+Enter is a hard break.

import { Editor, type Content, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

export interface OmEditor {
  readonly tiptap: Editor;
  clear(): void;
  insertContent(content: Content): void;
  setContent(content: JSONContent): void;
  focus(position?: 'start' | 'end'): void;
  blur(): void;
  getText(): string;
  getHTML(): string;
  getJSON(): JSONContent;
  isEmpty(): boolean;
  isActive(mark: string): boolean;
  destroy(): void;
}

export interface EditorHooks {
  readonly onEnter: () => void;
  readonly onUpdate: (json: JSONContent, text: string) => void;
  readonly onPaste: (text: string) => void;
  readonly onTransaction: () => void;
  /** A «build» without the editor handle on its DOM node (§6.2). */
  readonly hideHandle: boolean;
}

export function createOmEditor(host: HTMLElement, hooks: EditorHooks): OmEditor {
  const tiptap = new Editor({
    element: host,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        listKeymap: false,
        underline: false,
        link: false,
        dropcursor: false,
        trailingNode: false,
      }),
    ],
    editorProps: {
      attributes: { class: 'om-rich-text-editor__content', 'aria-label': 'Message', spellcheck: 'false' },
      handleKeyDown: (_view, event) => {
        if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return false;
        hooks.onEnter();
        return true;
      },
      handlePaste: (_view, event) => {
        const text = event.clipboardData?.getData('text/plain') ?? '';
        if (text !== '') hooks.onPaste(text);
        return false;
      },
    },
    onUpdate: ({ editor }) => hooks.onUpdate(editor.getJSON(), editor.getText()),
    onTransaction: () => hooks.onTransaction(),
  });
  if (hooks.hideHandle) Reflect.deleteProperty(tiptap.view.dom, 'editor');

  return {
    tiptap,
    clear: () => {
      tiptap.commands.clearContent(true);
    },
    insertContent: (content) => {
      tiptap.chain().insertContent(content).run();
    },
    setContent: (content) => {
      tiptap.commands.setContent(content, { emitUpdate: false });
    },
    focus: (position = 'end') => {
      tiptap.commands.focus(position);
    },
    blur: () => {
      tiptap.commands.blur();
    },
    getText: () => tiptap.getText(),
    getHTML: () => tiptap.getHTML(),
    getJSON: () => tiptap.getJSON(),
    isEmpty: () => tiptap.isEmpty,
    isActive: (mark) => tiptap.isActive(mark),
    destroy: () => tiptap.destroy(),
  };
}
