// The attachment window (telegram-tt components/middle/composer/AttachmentModal.tsx in a `Modal`, portaled into
// `#portals`): a picture and its caption field `#editable-message-text-modal`. Web A's composer has one editor: the
// window takes it, with the text the main field held, and the main field goes inactive (`isActive` false) until the
// window closes. Its own MessageInput listens to `document` the same way the main one does, so Enter outside a field
// sends the attachment. The window's root classes are CSS-module ones (hashed in Web A's build): only the caption
// field's id is an anchor.

import { type Editor, type JSONContent } from '@tiptap/core';

import { editorText, focusAtEnd, isSendShortcut, mountEditor } from './composer';
import { h, ICONS, scenery, svgIcon } from './dom';

export interface AttachmentHooks {
  /** Send pressed (the button, or Enter): the caption goes out with the picture. */
  readonly onSend: (caption: string) => void;
  /** Closed without a send: the caption goes back to the main field. */
  readonly onClose: (caption: JSONContent | null) => void;
}

export class AttachmentWindow {
  readonly root: HTMLElement;
  readonly field: HTMLElement;
  private readonly editor: Editor;

  constructor(content: JSONContent | null, private readonly hooks: AttachmentHooks) {
    this.field = h('div', { id: 'editable-message-text-modal' });
    const scroller = h('div', { class: 'input-scroller-content' }, [this.field, h('span', { class: 'placeholder-text', dir: 'auto' }, ['Add a caption...'])]);
    scroller.addEventListener(
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
    const close = h('button', { class: 'Button close-button default translucent round', type: 'button', 'aria-label': 'Cancel attachments' }, [svgIcon(ICONS.close)]);
    close.addEventListener('click', () => this.close());
    const send = h('button', { class: 'Button send-button default primary', type: 'button' }, ['Send']);
    send.addEventListener('click', () => this.send());
    // Web A's Portal: a bare `div` in `#portals`, the Modal inside it.
    this.root = h('div', {}, [h('div', { class: 'Modal opacity-transition fast open shown Kc8Zl9fa' }, [
      h('div', { class: 'modal-container' }, [
        h('div', { class: 'modal-backdrop' }),
        h('div', { class: 'modal-dialog' }, [
          h('div', { class: 'modal-header-condensed-wide' }, [close, h('div', { class: 'modal-title' }, ['Send Photo'])]),
          h('div', { class: 'modal-content custom-scroll' }, [
            h('div', { class: 'rM1aTq6X' }, [h('img', { src: scenery(7, 384, 256), alt: '', draggable: 'false' })]),
            h('div', { class: 'p9VdHn3e' }, [h('div', { id: 'caption-input-text' }, [h('div', { class: 'custom-scroll input-scroller' }, [scroller])]), send]),
          ]),
        ]),
      ]),
    ])]);
    this.editor = mountEditor(this.field, content, () => scroller.classList.toggle('is-empty', editorText(this.editor) === ''), 'Add a caption...');
    scroller.classList.toggle('is-empty', editorText(this.editor) === '');
  }

  /** The caption as text: paragraphs joined by `\n`. */
  text(): string {
    return editorText(this.editor);
  }

  focus(): void {
    focusAtEnd(this.field);
  }

  send(): void {
    const caption = this.text().trim();
    this.editor.destroy();
    this.root.remove();
    this.hooks.onSend(caption);
  }

  close(): void {
    const content = this.editor.getJSON();
    this.editor.destroy();
    this.root.remove();
    this.hooks.onClose(content);
  }
}
