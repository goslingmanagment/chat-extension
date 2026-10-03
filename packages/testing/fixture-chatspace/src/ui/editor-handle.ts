// What the composer and its bridge hold: the editor COMPONENT's surface, like
// ChatSpace's OmRichTextEditor exposes it. It exists as soon as the composer
// mounts; TipTap arrives later (its chunk loads asynchronously), and until then
// every command silently does nothing and every read is empty — so a bridge
// call in that window is lost, not deferred. Commands run through
// `chain().focus()`, and `focus()` keeps the current selection (no position).
// Only types come from TipTap here: the editor chunk stays lazy.

import type { Content, Editor, JSONContent } from '@tiptap/core';

export interface EditorHandle {
  insertContent(content: Content): void;
  clear(): void;
  focus(): void;
  blur(): void;
  toggleBold(): void;
  toggleItalic(): void;
  getText(): string;
  getHTML(): string;
  getJSON(): JSONContent | null;
  isEmpty(): boolean;
  /** The TipTap editor once loaded (stand-internal: tests read marks through it). */
  readonly tiptap: Editor | null;
}

export interface OwnedEditorHandle extends EditorHandle {
  attach(editor: Editor): void;
  detach(): void;
}

export function createEditorHandle(): OwnedEditorHandle {
  let editor: Editor | null = null;
  return {
    get tiptap() {
      return editor;
    },
    attach: (next) => {
      editor = next;
    },
    detach: () => {
      editor?.destroy();
      editor = null;
    },
    insertContent: (content) => {
      editor?.chain().focus().insertContent(content).run();
    },
    clear: () => {
      editor?.chain().focus().clearContent(true).run();
    },
    focus: () => {
      editor?.commands.focus();
    },
    blur: () => {
      editor?.commands.blur();
    },
    toggleBold: () => {
      editor?.chain().focus().toggleBold().run();
    },
    toggleItalic: () => {
      editor?.chain().focus().toggleItalic().run();
    },
    getText: () => editor?.getText() ?? '',
    getHTML: () => editor?.getHTML() ?? '',
    getJSON: () => editor?.getJSON() ?? null,
    isEmpty: () => editor?.isEmpty ?? true,
  };
}
