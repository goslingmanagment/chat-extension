// A chat's composer as Web A draws it (telegram-tt components/common/Composer.tsx, middle/composer/MessageInput.tsx,
// ComposerEmbeddedMessage.tsx, helpers/richEditor.ts):
//
//   .middle-column-footer > .Composer
//     [.ComposerEmbeddedMessage.open.shown > .ComposerEmbeddedMessage_inner > .embedded-left-icon > i.icon.icon-edit]
//     .composer-wrapper > .message-input-wrapper > #message-input-text > … > .input-scroller-content
//                                                     > #editable-message-text   (TipTap 3 mounted ON it: the root)
//     button.Button.send.main-button   (`record` while the field is empty)
//
// The field is a stub with the same id and no `contenteditable` until the editor's chunk loads (~400 ms after the
// chat opens); then TipTap mounts with `element: { mount }`, so the ProseMirror root IS `#editable-message-text`.
// The editor: StarterKit without lists, quotes, headings, code, links, strike and underline (Web A's set), so bold
// and italic keep their input rules (`**x**`, `*x*`), plus Web A's text replacements (`--` → «—», `<<` → «, `>>` →
// »). Enter without Shift sends from inside the field (Web A's onKeyDownCapture, before ProseMirror sees it);
// Shift+Enter starts a new paragraph.

import { Editor, Extension, InputRule, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

import { cn, h, ICONS, svgIcon } from './dom';
import { renderText } from './emoji';
import { type ChatMessage } from './messages';

/** Web A's `messageSendKeyCombo === 'enter'`: Enter sends, ⌘/Ctrl+Enter too; Shift+Enter never. */
export const isSendShortcut = (event: KeyboardEvent): boolean => event.key === 'Enter' && !event.shiftKey;

/** How long the stub stands before the editor mounts. */
export const EDITOR_LOAD_MS = 400;

const TextReplacements = Extension.create({
  name: 'textReplacements',
  addInputRules() {
    const rules: ReadonlyArray<readonly [RegExp, string]> = [
      [/--$/, '—'],
      [/<<$/, '«'],
      [/>>$/, '»'],
    ];
    return rules.map(
      ([find, replacement]) =>
        new InputRule({
          find,
          handler: ({ state, range }) => {
            state.tr.insertText(replacement, range.from, range.to);
          },
        }),
    );
  },
});

/** Shift+Enter: a new paragraph (ahead of StarterKit's hard break). */
const NewParagraph = Extension.create({
  name: 'standNewParagraph',
  priority: 1000,
  addKeyboardShortcuts() {
    return { 'Shift-Enter': () => this.editor.commands.splitBlock() };
  },
});

/** The field's text: paragraphs joined by `\n`. */
export const editorText = (editor: Editor): string => editor.getText({ blockSeparator: '\n' });

/** Text as editor content: each line a paragraph. */
export function paragraphs(text: string): JSONContent[] {
  return text.split('\n').map((line) => ({ type: 'paragraph', ...(line === '' ? {} : { content: [{ type: 'text', text: line }] }) }));
}

/** Web A's `focusEditableElement(input, true, true)`: the focus in the field, the caret at its end. */
export function focusAtEnd(element: HTMLElement): void {
  element.focus({ preventScroll: true });
  const selection = window.getSelection();
  if (selection === null) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** A TipTap editor of Web A's set mounted on `field` (which becomes the ProseMirror root). */
export function mountEditor(field: HTMLElement, content: JSONContent | null, onUpdate: () => void, label: string): Editor {
  return new Editor({
    element: { mount: field },
    ...(content === null ? {} : { content }),
    extensions: [
      StarterKit.configure({
        blockquote: false,
        bulletList: false,
        code: false,
        codeBlock: false,
        heading: false,
        horizontalRule: false,
        listItem: false,
        link: false,
        orderedList: false,
        strike: false,
        underline: false,
      }),
      TextReplacements,
      NewParagraph,
    ],
    editorProps: { attributes: { class: 'form-control allow-selection', role: 'textbox', dir: 'auto', 'aria-label': label } },
    onUpdate,
  });
}

export interface ComposerHooks {
  /** A send from the main field: a new message, or the edit of a sent one. */
  readonly onSend: (text: string, edited: ChatMessage | null) => void;
  /** The attachment button. */
  readonly onAttach: () => void;
}

export class Composer {
  /** `.middle-column-footer`. */
  readonly root: HTMLElement;
  /** `#editable-message-text`: the stub, then the editor's root. */
  readonly field: HTMLElement;
  private readonly composer: HTMLElement;
  private readonly content: HTMLElement;
  private readonly button: HTMLButtonElement;
  private editor: Editor | null = null;
  /** The editor is unmounted while the attachment window has the text (Web A moves its one editor there). */
  private parked = false;
  private editing: ChatMessage | null = null;
  private embedded: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly peerId: string,
    private draft: JSONContent | null,
    private readonly hooks: ComposerHooks,
  ) {
    this.field = h('div', { id: 'editable-message-text', class: 'form-control' });
    this.content = h('div', { class: 'input-scroller-content is-empty' }, [this.field, h('span', { class: 'placeholder-text', dir: 'auto' }, ['Message'])]);
    // Web A's onKeyDownCapture on the scroller's content: a send shortcut inside the field, before ProseMirror.
    this.content.addEventListener(
      'keydown',
      (event) => {
        if (!(event.target instanceof Node) || !this.field.contains(event.target)) return;
        if (!event.isComposing && isSendShortcut(event)) {
          event.preventDefault();
          event.stopPropagation();
          this.send();
        }
      },
      true,
    );
    this.field.addEventListener('click', () => this.editor?.commands.focus());
    const attach = h('button', { class: 'Button composer-action-button attachment-button default translucent round', type: 'button', 'aria-label': 'Add an attachment', title: 'Add an attachment' }, [svgIcon(ICONS.attach)]);
    attach.addEventListener('click', () => this.hooks.onAttach());
    this.button = h('button', { class: 'Button record main-button default secondary round', type: 'button', 'aria-label': 'Record Voice Message' }, [svgIcon(ICONS.mic)]);
    this.button.addEventListener('click', () => this.send());
    this.composer = h('div', { class: 'Composer shown mounted' }, [
      h('div', { class: 'composer-wrapper' }, [
        h('div', { class: 'message-input-wrapper' }, [
          h('button', { class: 'Button composer-action-button symbol-menu-button default translucent round', type: 'button', 'aria-label': 'Choose emoji, sticker or GIF' }, [svgIcon(ICONS.smile)]),
          h('div', { id: 'message-input-text' }, [h('div', { class: 'shared-canvas-container' }, [h('div', { class: 'custom-scroll input-scroller' }, [this.content])])]),
          attach,
        ]),
      ]),
      this.button,
    ]);
    this.root = h('div', { class: 'middle-column-footer' }, [this.composer]);
  }

  /** The editor's chunk loads: the stub becomes the editor after `ms`. */
  load(ms = EDITOR_LOAD_MS): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      this.field.removeAttribute('class');
      this.editor = mountEditor(this.field, this.draft, () => this.refresh(), 'Message');
      this.draft = null;
      this.refresh();
    }, ms);
  }

  /** The editor is mounted and active (not the stub, not parked under the attachment window). */
  get active(): boolean {
    return this.editor !== null && !this.parked;
  }

  /** Paragraphs joined by `\n`; null — the stub still stands. */
  text(): string | null {
    if (this.editor === null) return null;
    return this.parked ? (this.field.textContent ?? '') : editorText(this.editor);
  }

  insert(text: string): void {
    if (this.editor === null || this.parked) throw new Error('the field has no active editor');
    const empty = editorText(this.editor) === '';
    const chain = this.editor.chain().focus('end');
    (empty ? chain.setContent(paragraphs(text)) : chain.insertContent(paragraphs(text))).run();
    this.refresh();
  }

  clear(): void {
    this.editor?.commands.clearContent(true);
    this.refresh();
  }

  focus(): void {
    if (this.active) focusAtEnd(this.field);
  }

  /** Sends what the field holds (a new message, or the edit), then empties it, as Web A's `onSend`. */
  send(): void {
    const text = this.text()?.trim() ?? '';
    if (!this.active || text === '') return;
    const edited = this.editing;
    this.hooks.onSend(text, edited);
    this.cancelEdit();
    this.clear();
  }

  /** The edit mode of a sent message: the bar with the edit icon over the field, the field holds its text. */
  edit(message: ChatMessage): void {
    if (this.editor === null || this.parked) throw new Error('the field has no active editor');
    this.cancelEdit();
    this.editing = message;
    const cancel = h('button', { class: 'Button embedded-cancel default translucent round faded', type: 'button', 'aria-label': 'Cancel' }, [h('i', { class: 'icon icon-close' })]);
    cancel.addEventListener('click', () => {
      this.cancelEdit();
      this.clear();
    });
    this.embedded = h('div', { class: 'ComposerEmbeddedMessage opacity-transition fast open shown' }, [
      h('div', { class: 'ComposerEmbeddedMessage_inner' }, [
        h('div', { class: 'embedded-left-icon', role: 'button', tabindex: '0' }, [h('i', { class: 'icon icon-edit' })]),
        h('div', { class: 'EmbeddedMessage inside-input no-selection', dir: 'auto' }, [
          h('div', { class: 'hover-effect' }),
          h('div', { class: 'message-text' }, [h('p', { class: 'embedded-text-wrapper' }, renderText(message.text)), h('div', { class: 'message-title' }, ['Edit Message'])]),
        ]),
        cancel,
      ]),
    ]);
    this.composer.prepend(this.embedded);
    this.editor.chain().setContent(paragraphs(message.text)).focus('end').run();
    this.refresh();
  }

  get editingMessage(): ChatMessage | null {
    return this.editing;
  }

  cancelEdit(): void {
    this.editing = null;
    this.embedded?.remove();
    this.embedded = null;
  }

  /** The attachment window takes the text: the editor leaves the field (its content goes with it), the field goes inactive. */
  park(): JSONContent | null {
    if (this.editor === null || this.parked) return null;
    const content = this.editor.getJSON();
    this.parked = true;
    this.editor.unmount();
    this.field.textContent = '';
    this.field.setAttribute('contenteditable', 'false');
    this.field.blur();
    this.refresh();
    return content;
  }

  /** The window closed: the editor comes back to the field with the caption's text. */
  unpark(content: JSONContent | null): void {
    if (this.editor === null || !this.parked) return;
    this.parked = false;
    this.editor.mount({ mount: this.field });
    if (content !== null) this.editor.commands.setContent(content);
    this.refresh();
  }

  /** The chat's slide is dropped: what the field held, for the next composer of this chat (Web A's draft). */
  destroy(): JSONContent | null {
    if (this.timer !== null) clearTimeout(this.timer);
    const content = this.editor === null || this.parked ? this.draft : this.editor.getJSON();
    this.editor?.destroy();
    this.editor = null;
    return content;
  }

  /** The placeholder and the main button follow the field: «record» while empty, «send» with text. */
  private refresh(): void {
    const empty = (this.text() ?? '') === '';
    this.content.className = cn('input-scroller-content', empty && 'is-empty');
    const state = empty && this.editing === null ? 'record' : 'send';
    if (!this.button.classList.contains(state)) {
      this.button.className = cn('Button', state, 'main-button default secondary round');
      this.button.setAttribute('aria-label', state === 'send' ? 'Send Message' : 'Record Voice Message');
      this.button.replaceChildren(svgIcon(state === 'send' ? ICONS.send : ICONS.mic));
    }
  }
}
