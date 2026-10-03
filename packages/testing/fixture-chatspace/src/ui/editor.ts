// The composer's rich-text editor: a real TipTap editor (loaded lazily, as
// ChatSpace loads its editor chunk when the first composer mounts), so
// `.ProseMirror`, `view.dom.editor`, transaction/update events and the
// ⌘B/⌘I/⌘E/⌘⇧S marks behave like the real thing (metadata.ts «editor»).
// Extensions as on the host: StarterKit without headings, code blocks,
// quotes, rules, lists and underline — so Link stays, with autolink and
// link-on-paste — plus class-based colour and size marks and a placeholder.
// Enter without Shift sends (also with Ctrl/⌘/Alt); Shift+Enter is a hard break.

import { Editor, Mark, mergeAttributes, type JSONContent } from '@tiptap/core';
import { Placeholder } from '@tiptap/extensions';
import StarterKit from '@tiptap/starter-kit';

export interface EditorHooks {
  readonly onEnter: () => void;
  readonly onUpdate: (json: JSONContent, text: string) => void;
  readonly onPaste: (text: string) => void;
  /** A «build» without the editor handle on its DOM node (§6.2). */
  readonly hideHandle: boolean;
}

/** A mark that only carries a class name, rendered as `span[<attribute>]`. */
function classMark(name: string, attribute: string): Mark {
  return Mark.create({
    name,
    addAttributes: () => ({
      class: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute(attribute),
        renderHTML: (attributes: Record<string, unknown>) => {
          const value = attributes['class'];
          return typeof value === 'string' && value !== '' ? { class: value, [attribute]: value } : {};
        },
      },
    }),
    parseHTML: () => [{ tag: `span[${attribute}]` }],
    renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes), 0],
  });
}

export function createOmEditor(host: HTMLElement, content: JSONContent | null, placeholder: string, hooks: EditorHooks): Editor {
  const tiptap = new Editor({
    element: host,
    ...(content !== null ? { content } : {}),
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        underline: false,
      }),
      classMark('textColorClass', 'data-color-class'),
      classMark('textSizeClass', 'data-size-class'),
      Placeholder.configure({ placeholder }),
    ],
    editorProps: {
      attributes: { class: 'om-rich-text-editor__content' },
      handleKeyDown: (_view, event) => {
        if (event.key !== 'Enter' || event.shiftKey) return false;
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
  });
  if (hooks.hideHandle) Reflect.deleteProperty(tiptap.view.dom, 'editor');
  return tiptap;
}
