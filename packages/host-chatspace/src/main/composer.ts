// Composers and their drafts (architecture.md §6.3, §6.4) on the MAIN side.
// - The active composer: the one translator slot whose composer box is
//   connected, visible along the whole chain and has a non-zero box — exactly
//   one, or none (two visible ones are ambiguous and count as none).
// - Each composer node gets its own composerInstanceId; a replaced node is a
//   new composer with a new id. A node is bound to the chat ChatSpace rendered
//   it for (its account's active chat tab, read by the runtime when the tab
//   and the route agree) when it is first seen active, and never to another chat.
// - The draft revision comes from the editor's own document stream: MAIN
//   listens passively to `transaction` of the Tiptap object behind
//   `.ProseMirror` (`view.dom.editor`). Our transactions are those that happen
//   synchronously inside our bridge call; any other one is human-or-unknown.
//   Without an observed editor there is no CAS promise: the revision follows
//   `input` events and changed text, and a non-empty draft always needs consent.
// Writes go only through ChatSpace's own `__omComposerBridge` (setText,
// insertText, focus) — never insertMessage, never into .ProseMirror directly.

import { type InsertWire } from './requests';
import { CG_COMPOSER_MISSING, CG_DRAFT_CHANGED, CG_INSERT_FAILED, CG_MISPLACED, CG_UNCERTAIN, EDITOR_SELECTOR, FRAME_SELECTOR, SLOT_SELECTOR } from './protocol';

export type Provenance = 'empty' | 'our-insert' | 'human-or-unknown';
type TxListener = (payload: { transaction?: { docChanged?: boolean } }) => void;

interface Bridge {
  setText(text: string): void;
  insertText(text: string): void;
  focus(): void;
}

/** The parts of a Tiptap editor MAIN uses. */
export interface Editor {
  on(event: string, listener: TxListener): unknown;
  off(event: string, listener: TxListener): unknown;
  getJSON(): unknown;
  getText(): string;
  readonly isEmpty: boolean;
  readonly commands: { focus(position?: unknown): boolean };
}

export interface Composer {
  readonly id: string;
  readonly slot: Element;
  readonly acc: string;
  readonly fan: string;
  editor: Editor | null;
  off: (() => void) | null;
  revision: number;
  provenance: Provenance;
  /** The insert intent of our unchanged insert; null once anything else changed the draft. */
  ours: string | null;
  /** Without an editor: the last text digest read, to notice changes we could not observe. */
  seen: string | null;
}

export interface Draft {
  readonly text: string;
  readonly digest: string;
  readonly empty: boolean;
}

export type Receipt =
  | { readonly state: 'applied'; readonly draftRevision: number; readonly draftDigest: string; readonly ms: number }
  | { readonly state: 'rejected'; readonly code: string; readonly needs?: 'confirm-human-draft' | 'confirm-changed-draft' }
  | { readonly state: 'uncertain'; readonly code: string };

export const rejected = (code: string, needs?: 'confirm-human-draft' | 'confirm-changed-draft'): Receipt => (needs ? { state: 'rejected', code, needs } : { state: 'rejected', code });

/** 53-bit string hash (cyrb53) as 16 hex digits: the local fingerprint of a whole document. */
export function digest(value: string): string {
  let a = 0xdeadbeef;
  let b = 0x41c6ce57;
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    a = Math.imul(a ^ c, 2654435761);
    b = Math.imul(b ^ c, 1597334677);
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return (b >>> 0).toString(16).padStart(8, '0') + (a >>> 0).toString(16).padStart(8, '0');
}

/** Line breaks and non-breaking spaces made plain, runs of spaces folded, outer whitespace trimmed. */
export const normalize = (value: string): string =>
  value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00a0\t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .trim();

export type Composers = ReturnType<typeof createComposers>;

/**
 * `changed` — a draft or an editor changed (the bridge re-reads the composer
 * state on the next frame); `draftOf` names the composer whose document
 * changed when nothing else did (typing), so the runtime may skip the layout
 * reads of a full search. `frame` — one frame, or the fallback timer.
 */
export function createComposers(win: Window, changed: (draftOf?: Composer) => void, frame: (callback: () => void) => void) {
  const doc = win.document;
  const bySlot = new WeakMap<Element, Composer>();
  let next = 1;
  /** The composer of the bridge call in progress. */
  let writing: Composer | null = null;
  /** A transaction of another composer happened inside our call: exact evidence of a misplaced write. */
  let stray = false;

  /** The visible box of a composer: the frame root, or the slot's parent when the frame changed. */
  const box = (slot: Element): Element | null => slot.closest(FRAME_SELECTOR)?.parentElement ?? slot.parentElement;
  const visible = (element: Element | null): boolean => {
    if (!element?.isConnected || !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  /**
   * The `.ProseMirror` of a composer: inside its frame; when the frame
   * changed, a few levels up from the slot while the ancestor holds no other composer.
   */
  const editorElement = (slot: Element): (Element & { editor?: unknown }) | null => {
    const frame = slot.closest(FRAME_SELECTOR);
    if (frame) return frame.querySelector(EDITOR_SELECTOR);
    let node: Element | null = slot;
    for (let depth = 0; depth < 4 && (node = node.parentElement); depth += 1) {
      if (node.querySelectorAll(SLOT_SELECTOR).length > 1) return null;
      const found = node.querySelector(EDITOR_SELECTOR);
      if (found) return found;
    }
    return null;
  };

  const detach = (composer: Composer): void => {
    try {
      composer.off?.();
    } catch {
      // The editor is gone with its node.
    }
    composer.editor = null;
    composer.off = null;
  };

  const onTransaction = (composer: Composer, payload: { transaction?: { docChanged?: boolean } }): void => {
    if (payload.transaction?.docChanged === false) return;
    composer.revision += 1;
    if (writing) {
      if (writing === composer) composer.provenance = 'our-insert';
      else stray = true;
    } else {
      composer.ours = null;
      composer.provenance = composer.editor?.isEmpty ? 'empty' : 'human-or-unknown';
    }
    changed(composer);
  };

  /** Listens to the editor behind `view.dom.editor` once it exists (TipTap loads after the composer). */
  const attach = (composer: Composer): void => {
    const editor = editorElement(composer.slot)?.editor as Editor | undefined;
    if (!editor || editor === composer.editor || typeof editor.on !== 'function' || typeof editor.getJSON !== 'function' || !editor.commands) return;
    detach(composer);
    const listener: TxListener = (payload) => onTransaction(composer, payload);
    const destroyed = (): void => detach(composer);
    try {
      editor.on('transaction', listener);
      editor.on('destroy', destroyed);
    } catch {
      return;
    }
    composer.editor = editor;
    composer.off = () => {
      editor.off('transaction', listener);
      editor.off('destroy', destroyed);
    };
    composer.seen = null;
    if (composer.provenance === 'empty' && !editor.isEmpty) composer.provenance = 'human-or-unknown';
    changed();
  };

  const bridgeOf = (composer: Composer): Bridge | null => {
    const bridge = (composer.slot as Element & { __omComposerBridge?: Partial<Bridge> }).__omComposerBridge;
    return bridge && typeof bridge.setText === 'function' && typeof bridge.insertText === 'function' && typeof bridge.focus === 'function' ? (bridge as Bridge) : null;
  };

  /** Reads the draft synchronously; without an editor a changed text bumps the revision (a change we did not observe). */
  const read = (composer: Composer): Draft => {
    attach(composer);
    const editor = composer.editor;
    if (editor) {
      try {
        return { text: editor.getText(), digest: digest(JSON.stringify(editor.getJSON())), empty: editor.isEmpty };
      } catch {
        detach(composer);
      }
    }
    const value = (editorElement(composer.slot) as HTMLElement | null)?.innerText ?? '';
    const print = digest(value);
    if (composer.seen !== null && composer.seen !== print) {
      composer.revision += 1;
      composer.ours = null;
      composer.provenance = 'human-or-unknown';
    }
    composer.seen = print;
    return { text: value, digest: print, empty: value.trim() === '' };
  };

  /** Without an observed editor, typing in a composer frame is the revision signal (degraded); one capture listener on the document. */
  const onInput = (event: Event): void => {
    const slot = event.target instanceof Element ? event.target.closest(FRAME_SELECTOR)?.querySelector(SLOT_SELECTOR) : null;
    const composer = slot ? bySlot.get(slot) : undefined;
    if (!composer || composer.editor) return;
    composer.revision += 1;
    composer.ours = null;
    composer.provenance = 'human-or-unknown';
    changed();
  };
  doc.addEventListener('input', onInput, true);

  return {
    box,
    editorElement,
    bridgeOf,
    read,
    attach,
    /** The one active composer slot; null when none, false when ambiguous (two or more visible). */
    activeSlot(): Element | null | false {
      let found: Element | null = null;
      for (const slot of doc.querySelectorAll(SLOT_SELECTOR)) {
        if (!visible(box(slot))) continue;
        if (found) return false;
        found = slot;
      }
      return found;
    },
    /** The composer of a slot, bound on first sight to the chat ChatSpace rendered it for; null when the node belongs to another chat. */
    bind(slot: Element, acc: string, fan: string): Composer | null {
      let composer = bySlot.get(slot);
      if (!composer) {
        composer = { id: `c${next++}`, slot, acc, fan, editor: null, off: null, revision: 0, provenance: 'empty', ours: null, seen: null };
        bySlot.set(slot, composer);
      }
      if (composer.acc !== acc || composer.fan !== fan) return null;
      attach(composer);
      return composer;
    },
    /** Provenance as reported: an empty draft is `empty` whatever wrote it. */
    provenance: (composer: Composer, draft: Draft): Provenance => (draft.empty ? 'empty' : composer.provenance),

    /**
     * The guarded write (§6.4 п. 3–4), the caller having checked document,
     * route and composer in the same synchronous step. `expected` — the CAS of
     * an open intent; null — a deferred one, which writes only into an empty
     * draft or our own unchanged insert. Verified after a microtask and a
     * frame: applied | rejected | uncertain.
     */
    write(composer: Composer, intent: InsertWire, expected: { readonly revision: number; readonly digest: string } | null, consents: Set<string>): Receipt | Promise<Receipt> {
      const started = win.performance.now();
      const bridge = bridgeOf(composer);
      if (!bridge || !editorElement(composer.slot)) return rejected(CG_COMPOSER_MISSING);
      const draft = read(composer);
      if (expected && (composer.revision !== expected.revision || draft.digest !== expected.digest)) return rejected(CG_DRAFT_CHANGED, 'confirm-changed-draft');
      /** The whole document is our own unchanged insert (observed editor only). */
      const ours = !draft.empty && !!composer.editor && composer.provenance === 'our-insert' && !!composer.ours;
      if (!draft.empty && !ours) {
        const consent = intent.confirmationId;
        if (!expected || !consent || consents.has(consent)) return rejected(CG_DRAFT_CHANGED, 'confirm-human-draft');
        consents.add(consent);
      }
      const before = composer.revision;
      const append = intent.mode === 'append' && !draft.empty;
      // After the write the document is ours only if all of it came from us: a replace, or an append to our own unchanged insert.
      // An append to a human draft keeps the human's text in it — a later plain «Вставить» must ask again (Б2).
      const wholeOurs = !append || ours;
      writing = composer;
      stray = false;
      try {
        if (append && composer.editor) {
          composer.editor.commands.focus('end');
          bridge.insertText(`\n${intent.text}`);
        } else bridge.setText(append ? `${draft.text}\n${intent.text}` : intent.text);
      } catch {
        return { state: 'uncertain', code: CG_UNCERTAIN };
      } finally {
        writing = null;
      }
      if (stray) return { state: 'uncertain', code: CG_MISPLACED };
      if (composer.editor && composer.revision !== before) {
        composer.provenance = wholeOurs ? 'our-insert' : 'human-or-unknown';
        composer.ours = wholeOurs ? intent.intentId : null;
      }
      const wanted = normalize(intent.text);
      return Promise.resolve().then(
        () =>
          new Promise<Receipt>((resolve) =>
            frame(() => {
              const after = read(composer);
              const value = normalize(after.text);
              // An append must also have changed the document: a draft that already ended with the text proves nothing.
              if (append ? value.endsWith(wanted) && after.digest !== draft.digest : value === wanted) {
                if (!composer.editor) {
                  composer.seen = after.digest;
                  composer.provenance = wholeOurs ? 'our-insert' : 'human-or-unknown';
                }
                resolve({ state: 'applied', draftRevision: composer.revision, draftDigest: after.digest, ms: Math.max(0, win.performance.now() - started) });
              } else resolve(after.digest === draft.digest ? rejected(CG_INSERT_FAILED) : { state: 'uncertain', code: CG_UNCERTAIN });
            }),
          ),
      );
    },

    /** `bridge.focus()` keeps the person's cursor; after our insert it is already at the end. */
    focus(composer: Composer): boolean {
      try {
        bridgeOf(composer)?.focus();
      } catch {
        return false;
      }
      const active = doc.activeElement;
      return !!active && box(composer.slot)?.contains(active) === true;
    },
    dispose(): void {
      doc.removeEventListener('input', onInput, true);
    },
  };
}
