// Telegram's main field as the port follows it, and our write into it (docs/specs/2026-10-27-telegram-site.md §4.4).
// The field is TipTap 3 / ProseMirror: a `contenteditable` root whose document the page's model is. Until the editor
// loads, a stub with the same id and no `contenteditable` stands there: nothing is written into it.
//
// - The REVISION counts the `input` events seen on the field; a text that changed without one (Telegram restored its
//   cloud draft, cleared the field after a send) ends the chain of our insert, and the CAS compares the digest too.
// - The write, in one task from its last check (Fansly's guarantees, host-fansly/src/isolated/insert.ts): the port's
//   checks, the focus, the checks again, the CAS on the revision and the digest, the draft rule Б2 (a draft that is not
//   empty and not our own unchanged insert needs the person's one-time consent for exactly that revision); then a
//   Range selection inside the field — all of it to replace, its end to append — and `execCommand('insertText')` line
//   by line with `insertParagraph` between lines; never a `value` or `innerHTML` write. ProseMirror reads each change
//   from the DOM in a microtask, so the steps of one write yield to microtasks only: no person's key comes between.
// - TipTap's input rules (Web A: `--` → «—», `<<`, `>>`, its marks) look at the text right before the caret when a
//   text goes in: a line whose last character could close a rule goes in last character first, then the rest in front
//   of it, so no rule sees its pattern end at the caret.
// - The text is read back: what the field shows must be what we meant, else a write that may have half-happened is
//   `uncertain` and never retried; one that provably changed nothing is refused («Текст не вставился»). After a task
//   of the page it is read once more.

import type { CgCode } from '@cg/contracts/errors';
import type { InsertReceipt, InsertWire } from '@cg/contracts/host';
import type { ChatRef, DraftProvenance, PartRef } from '@cg/contracts/ids';
import { digest } from '@cg/host-kit/common/digest';

import { fieldText } from './dom';

/** What our write left in the field: the chain the draft descends from until the field changes. */
export interface InsertionRecord {
  readonly intentId: string;
  readonly operationId: string;
  readonly part: PartRef;
  readonly chat: ChatRef;
  readonly composerInstanceId: string;
  readonly revision: number;
  readonly digest: string;
  /** The whole draft is ours: a replace, or an append to our own unchanged insert. */
  readonly whole: boolean;
}

export interface WriteNote {
  readonly receipt: InsertReceipt;
  readonly mode: 'replace' | 'append';
  /** The lines that went in last character first (TipTap's input rules). */
  readonly guarded: number;
}

export interface TelegramField {
  element(): HTMLElement | null;
  /** The port's field now (null — none) and its instance token. A new field ends the record. */
  follow(next: HTMLElement | null, instance: string | null): void;
  revision(): number;
  composing(): boolean;
  /** The field's text as the person sees it ('' — none). */
  text(): string;
  provenance(): DraftProvenance;
  insertion(): InsertionRecord | null;
  write(intent: InsertWire, check: () => InsertReceipt | null): Promise<InsertReceipt>;
  dispose(): void;
}

export interface TelegramFieldOptions {
  readonly win: Window;
  /** The draft changed (an input, our write): the port says what the views read. */
  readonly changed: () => void;
  /** Every write's outcome, for the tab's log (never the text). */
  readonly onWrite?: (note: WriteNote) => void;
}

export const rejected = (code: CgCode, needs?: 'confirm-human-draft' | 'confirm-changed-draft'): InsertReceipt => (needs === undefined ? { state: 'rejected', code } : { state: 'rejected', code, needs });

const UNCERTAIN: InsertReceipt = { state: 'uncertain', code: 'CG-INSERT-UNCERTAIN' };
/** One-time consents remembered (Б2): a consent is good for one write only. */
const CONSENTS_KEPT = 64;
/** A last character that could end an input rule's pattern at the caret (Web A's replacements and marks, markdown). */
const RULE_CLOSER = /[-<>:*_~`|)\]}$\s]$/u;

/** Lets ProseMirror read what the last command did (its MutationObserver's microtask runs first). */
const settle = (): Promise<void> => new Promise((resolve) => queueMicrotask(resolve));

/** How a line goes in: whole, or its last character first (RULE_CLOSER). */
export function splitForRules(line: string): { readonly head: string; readonly last: string } | null {
  const chars = Array.from(line);
  if (chars.length < 2 || !RULE_CLOSER.test(line)) return null;
  const last = chars[chars.length - 1] ?? '';
  return { head: line.slice(0, line.length - last.length), last };
}

export function createTelegramField(options: TelegramFieldOptions): TelegramField {
  const { win } = options;
  const doc = win.document;
  let field: HTMLElement | null = null;
  let instance: string | null = null;
  let revision = 0;
  let composing = false;
  let writing = false;
  /** The text as of the last event we saw (or our write): one that differs from it changed without one. */
  let seen = '';
  let record: InsertionRecord | null = null;
  const consents = new Set<string>();

  const read = (): string => (field === null ? '' : fieldText(field));
  const look = (): string => {
    const value = read();
    if (value !== seen) {
      seen = value;
      record = null;
    }
    return value;
  };

  const onInput = (): void => {
    revision += 1;
    if (writing) return;
    seen = read();
    if (seen.trim() === '') record = null;
    options.changed();
  };
  const onCompositionStart = (): void => {
    composing = true;
  };
  const onCompositionEnd = (): void => {
    composing = false;
  };
  const listen = (target: HTMLElement | null, on: boolean): void => {
    if (target === null) return;
    const method = on ? 'addEventListener' : 'removeEventListener';
    target[method]('input', onInput);
    target[method]('compositionstart', onCompositionStart);
    target[method]('compositionend', onCompositionEnd);
  };

  const provenance = (): DraftProvenance => {
    const value = look();
    if (value.trim() === '') return 'empty';
    return record !== null && record.whole && record.revision === revision ? 'our-insert' : 'human-or-unknown';
  };

  /** The caret (collapsed) at a point of the field, as the editor reads the DOM selection. */
  const caretAt = (node: Node, offset: number): void => {
    const selection = doc.getSelection();
    if (selection === null) return;
    const range = doc.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  };
  /** The caret back over the character just typed. */
  const caretBack = (length: number): boolean => {
    const selection = doc.getSelection();
    const node = selection?.focusNode ?? null;
    const offset = selection?.focusOffset ?? 0;
    if (node !== null && node.nodeType === 3 && offset >= length) {
      caretAt(node, offset - length);
      return true;
    }
    if (selection !== null && typeof selection.modify === 'function') {
      selection.modify('move', 'backward', 'character');
      return true;
    }
    return false;
  };
  /** The caret at the end of the paragraph it stands in. */
  const caretToBlockEnd = (target: HTMLElement): void => {
    let node: Node | null = doc.getSelection()?.focusNode ?? null;
    while (node !== null && node.parentNode !== target) node = node.parentNode;
    const block = node ?? target;
    const range = doc.createRange();
    range.selectNodeContents(block);
    range.collapse(false);
    const selection = doc.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };
  const exec = (command: 'insertText' | 'insertParagraph' | 'delete', value?: string): void => {
    try {
      doc.execCommand(command, false, value);
    } catch {
      // No editor command here: the read-back tells what happened.
    }
  };

  const write = async (intent: InsertWire, check: () => InsertReceipt | null): Promise<InsertReceipt> => {
    const started = win.performance.now();
    let guarded = 0;
    const note = (receipt: InsertReceipt): InsertReceipt => {
      options.onWrite?.({ receipt, mode: intent.mode, guarded });
      return receipt;
    };
    const target = field;
    const token = instance;
    if (target === null || token === null || target.getAttribute('contenteditable') !== 'true') return note(rejected('CG-HOST-COMPOSER-MISSING'));
    const refuse = (): InsertReceipt | null => check() ?? (composing ? rejected('CG-DRAFT-CHANGED', 'confirm-changed-draft') : null);
    let refusal = refuse();
    if (refusal !== null) return note(refusal);
    target.focus();
    // The focus ran the page's handlers: everything again, then nothing but the write.
    refusal = refuse() ?? (field !== target || doc.activeElement !== target ? rejected('CG-INSERT-CHAT-CHANGED') : null);
    if (refusal !== null) return note(refusal);
    const before = look();
    const expected = intent.expected;
    if (expected.kind === 'open' && (revision !== expected.draftRevision || digest(before) !== expected.draftDigest)) return note(rejected('CG-DRAFT-CHANGED', 'confirm-changed-draft'));
    const empty = before.trim() === '';
    const ours = !empty && provenance() === 'our-insert';
    if (!empty && !ours) {
      const consent = intent.confirmationId;
      if (expected.kind !== 'open' || consent === null || consents.has(consent)) return note(rejected('CG-DRAFT-CHANGED', 'confirm-human-draft'));
      consents.add(consent);
      if (consents.size > CONSENTS_KEPT) consents.delete(consents.values().next().value as string);
    }
    const append = intent.mode === 'append' && !empty;
    const text = intent.text.replace(/\r\n?/g, '\n');
    const wanted = append ? `${before}\n${text}` : text;
    const revisionBefore = revision;

    // The selection: the whole document to replace, its end to append.
    const range = doc.createRange();
    range.selectNodeContents(target);
    if (append) range.collapse(false);
    const selection = doc.getSelection();
    if (selection === null) return note(rejected('CG-INSERT-FAILED'));
    selection.removeAllRanges();
    selection.addRange(range);

    writing = true;
    try {
      if (append) {
        exec('insertParagraph');
        await settle();
      } else if (text === '' && !empty) {
        exec('delete');
        await settle();
      }
      const lines = text === '' ? [] : text.split('\n');
      for (const [index, line] of lines.entries()) {
        if (index > 0) {
          exec('insertParagraph');
          await settle();
        }
        if (line === '') continue;
        const split = splitForRules(line);
        if (split === null) {
          exec('insertText', line);
          await settle();
          continue;
        }
        // The last character first, then the rest in front of it: no rule sees its pattern end at the caret.
        guarded += 1;
        exec('insertText', split.last);
        await settle();
        if (!caretBack(split.last.length)) {
          exec('insertText', split.head);
          await settle();
          continue;
        }
        exec('insertText', split.head);
        await settle();
        caretToBlockEnd(target);
      }
    } finally {
      writing = false;
    }
    await settle();
    const after = target.isConnected ? fieldText(target) : '';
    if (after !== wanted) {
      // The field as it was: nothing was written; anything else is unclear and never written again.
      if (after === before && revision === revisionBefore) return note(rejected('CG-INSERT-FAILED'));
      seen = after;
      record = null;
      return note(UNCERTAIN);
    }
    // The text is there, but no `input` was seen: the editor's model may not have it, so a send could carry another.
    if (revision === revisionBefore) return note(UNCERTAIN);
    seen = wanted;
    const left: InsertionRecord = {
      intentId: intent.intentId,
      operationId: intent.operationId,
      part: intent.part,
      chat: intent.target,
      composerInstanceId: token,
      revision,
      digest: digest(wanted),
      whole: !append || ours,
    };
    record = left;
    options.changed();
    // After a task of the page (its microtasks, its timers of 0 ms): still what we wrote?
    return new Promise((resolve) =>
      win.setTimeout(() => {
        const ms = Math.max(0, Math.round(win.performance.now() - started));
        const still = target.isConnected && target === field ? fieldText(target) === wanted : true;
        resolve(note(still ? { state: 'applied', draftRevision: left.revision, draftDigest: left.digest, ms } : UNCERTAIN));
      }, 0),
    );
  };

  return {
    element: () => field,
    follow(next, token) {
      if (next === field && token === instance) return;
      listen(field, false);
      field = next;
      instance = next === null ? null : token;
      composing = false;
      record = null;
      seen = next === null ? '' : fieldText(next);
      listen(field, true);
    },
    revision: () => revision,
    composing: () => composing,
    text: () => look(),
    provenance,
    insertion() {
      look();
      return record;
    },
    write,
    dispose() {
      listen(field, false);
      field = null;
      instance = null;
      record = null;
      consents.clear();
    },
  };
}
