// Fansly's message field as the port follows it, and our write into it
// (docs/project-unite/architecture.md §7.5; FS-INS-1…3; UI-021). The field is
// a plain `textarea.message-input` under Angular's NgModel: what a send sends
// is the MODEL, which only an `input` event updates (fansly-web.md §3).
//
// - The field's REVISION counts the `input` events we saw on it: typing, the
//   neighbour's writes (FBuddy: the native setter and an untrusted `input`),
//   our own. The page's own writes come without one — a restored draft, the
//   clearing after a send — so a CAS compares the text's digest too.
// - IME: while a composition runs Angular does not update the model (S6 Q6):
//   nothing is written then.
// - The write, in ONE synchronous step from the last check (FS-INS-1): the
//   port's checks, `focus()`, the checks again, the CAS on the revision and the
//   digest, the draft rule Б2 (a draft that is not empty and not our own
//   unchanged insert needs the person's one-time consent for exactly that
//   revision; a deferred insert has none: it writes only into an empty field),
//   the selection (all of it to replace, the end to append), then
//   `document.execCommand('insertText')` — Firefox takes it for the person's
//   input: `beforeinput` and `input`, the undo stack, the model, the typing
//   announcement, as by hand. The value is checked at once and after a task of
//   the page. The fallback — the `value` and an `input` of ours — only when the
//   field provably did not change (FS-INS-2); a partial or unclear outcome is
//   `uncertain`, never written again.
// - The INSERTION RECORD (§7.5 п. 5, §5.9 п. 7): what our write left — the
//   intent, the field's instance, its revision and digest, the digest of the
//   text as MAIN digests a sent message's content. It is the chain the draft
//   descends from until the field changes, the person empties it, or the field
//   changes with no event we saw. P7f links a human send to it (`sentDraft`).

import type { CgCode } from '@cg/contracts/errors';
import type { InsertReceipt, InsertWire, SentDraft } from '@cg/contracts/host';
import type { ChatRef, DraftProvenance, PartRef } from '@cg/contracts/ids';
import { digest, normalize } from '@cg/host-kit/common/digest';

/** What our write left in the field: what a human send is linked to (P7f). */
export interface InsertionRecord {
  readonly intentId: string;
  readonly operationId: string;
  readonly part: PartRef;
  readonly chat: ChatRef;
  readonly composerInstanceId: string;
  /** The field's revision right after our write. */
  readonly revision: number;
  /** The digest of the field's whole value right after it (as `readDraft` says it). */
  readonly digest: string;
  /** The digest of that text normalized as MAIN digests a sent message's `content` (`fx.sent.contentDigest`). */
  readonly contentDigest: string;
  /** The whole draft is ours: a replace, or an append to our own unchanged insert. */
  readonly whole: boolean;
}

/** How a write went: through the editor, our fallback, or not at all. */
export type WritePath = 'exec' | 'fallback' | 'none';

export interface WriteNote {
  readonly receipt: InsertReceipt;
  readonly path: WritePath;
  readonly mode: 'replace' | 'append';
}

export interface ComposerField {
  element(): HTMLTextAreaElement | null;
  /** The port's field now (null — none) and its instance token. A new field ends the record. */
  follow(next: HTMLTextAreaElement | null, instance: string | null): void;
  revision(): number;
  composing(): boolean;
  provenance(): DraftProvenance;
  /** The record of our write the draft descends from; null — none. */
  insertion(): InsertionRecord | null;
  /** The draft as a send would carry it (§5.9 п. 7): its revision, provenance and our insert it descends from. */
  sentDraft(): SentDraft | null;
  /**
   * The write of `intent` (open: a CAS on its revision and digest; deferred: an empty field only), `check` being the
   * port's checks, asked before and after the focus: a refusal, or null. Synchronous up to the write; the receipt
   * comes after a task of the page.
   */
  write(intent: InsertWire, check: () => InsertReceipt | null): InsertReceipt | Promise<InsertReceipt>;
  dispose(): void;
}

export interface ComposerFieldOptions {
  readonly win: Window;
  /** The field's draft changed (an input, a composition, our write): the port says what the views read. */
  readonly changed: () => void;
  /** Every write's outcome, for the tab's log (never the text). */
  readonly onWrite?: (note: WriteNote) => void;
}

export const rejected = (code: CgCode, needs?: 'confirm-human-draft' | 'confirm-changed-draft'): InsertReceipt => (needs === undefined ? { state: 'rejected', code } : { state: 'rejected', code, needs });

const UNCERTAIN: InsertReceipt = { state: 'uncertain', code: 'CG-INSERT-UNCERTAIN' };
/** One-time consents remembered (Б2): a consent is good for one write only. */
const CONSENTS_KEPT = 64;

export function createComposerField(options: ComposerFieldOptions): ComposerField {
  const { win } = options;
  const doc = win.document;
  let field: HTMLTextAreaElement | null = null;
  let instance: string | null = null;
  let revision = 0;
  let composing = false;
  /** Our own write is running: its `input` is ours. */
  let writing = false;
  /** The value as of the last event we saw (or our write): a value that differs from it changed without one. */
  let seen = '';
  let record: InsertionRecord | null = null;
  const consents = new Set<string>();

  /** The field changed with no event of ours to see — the page restored or cleared it: the chain of our insert ends. */
  const look = (): string => {
    const value = field?.value ?? '';
    if (value !== seen) {
      seen = value;
      record = null;
    }
    return value;
  };

  const onBeforeInput = (): void => {
    if (!writing) look();
  };
  const onInput = (): void => {
    revision += 1;
    if (writing) return;
    seen = field?.value ?? '';
    // The person emptied the field: what follows does not descend from our insert.
    if (seen.trim() === '') record = null;
    options.changed();
  };
  const onCompositionStart = (): void => {
    composing = true;
  };
  const onCompositionEnd = (): void => {
    composing = false;
  };
  const listen = (target: HTMLTextAreaElement | null, on: boolean): void => {
    if (target === null) return;
    const method = on ? 'addEventListener' : 'removeEventListener';
    target[method]('beforeinput', onBeforeInput);
    target[method]('input', onInput);
    target[method]('compositionstart', onCompositionStart);
    target[method]('compositionend', onCompositionEnd);
  };

  const provenance = (): DraftProvenance => {
    const value = look();
    if (value.trim() === '') return 'empty';
    return record !== null && record.whole && record.revision === revision ? 'our-insert' : 'human-or-unknown';
  };

  const write = (intent: InsertWire, check: () => InsertReceipt | null): InsertReceipt | Promise<InsertReceipt> => {
    const started = win.performance.now();
    const note = (receipt: InsertReceipt, path: WritePath): InsertReceipt => {
      options.onWrite?.({ receipt, path, mode: intent.mode });
      return receipt;
    };
    const target = field;
    const token = instance;
    if (target === null || token === null) return note(rejected('CG-HOST-COMPOSER-MISSING'), 'none');
    const refuse = (): InsertReceipt | null => check() ?? (composing ? rejected('CG-DRAFT-CHANGED', 'confirm-changed-draft') : null);
    let refusal = refuse();
    if (refusal !== null) return note(refusal, 'none');
    target.focus();
    // The focus ran the page's handlers: everything again (FS-INS-1 п. 3), then nothing but the write.
    refusal = refuse() ?? (field !== target ? rejected('CG-INSERT-CHAT-CHANGED') : null);
    if (refusal !== null) return note(refusal, 'none');
    const before = look();
    const expected = intent.expected;
    if (expected.kind === 'open' && (revision !== expected.draftRevision || digest(before) !== expected.draftDigest)) return note(rejected('CG-DRAFT-CHANGED', 'confirm-changed-draft'), 'none');
    const empty = before.trim() === '';
    const ours = !empty && provenance() === 'our-insert';
    if (!empty && !ours) {
      const consent = intent.confirmationId;
      if (expected.kind !== 'open' || consent === null || consents.has(consent)) return note(rejected('CG-DRAFT-CHANGED', 'confirm-human-draft'), 'none');
      consents.add(consent);
      if (consents.size > CONSENTS_KEPT) consents.delete(consents.values().next().value as string);
    }
    const append = intent.mode === 'append' && !empty;
    const text = intent.text.replace(/\r\n?/g, '\n');
    const wanted = append ? `${before}\n${text}` : text;
    const revisionBefore = revision;
    if (append) target.setSelectionRange(before.length, before.length);
    else target.setSelectionRange(0, before.length);

    // The editor command writes where the focus is: only into this field, never into whatever else holds the focus.
    let path: WritePath = doc.activeElement === target ? 'exec' : 'fallback';
    if (path === 'exec') {
      writing = true;
      try {
        doc.execCommand('insertText', false, append ? `\n${text}` : text);
      } catch {
        // No editor command here: the field tells what happened.
      } finally {
        writing = false;
      }
    }
    if (target.value !== wanted) {
      // Changed, but not into what we wrote — or something moved: a partial outcome, never written again.
      if (target.value !== before || revision !== revisionBefore) return note(UNCERTAIN, path);
      // Provably untouched (FS-INS-2): the value and our `input`, which the model reads.
      path = 'fallback';
      writing = true;
      try {
        target.value = wanted;
        target.dispatchEvent(new Event('input', { bubbles: true }));
      } catch {
        // Judged by what the field holds below.
      } finally {
        writing = false;
      }
      // The field as it was: nothing was written (ER-074 «Текст не вставился»); anything else is unclear.
      if (target.value !== wanted) return note(target.value === before ? rejected('CG-INSERT-FAILED') : UNCERTAIN, path);
    }
    // The text is there, but no `input` was seen: the page's model may not have it, so a send could carry another text.
    if (revision === revisionBefore) return note(UNCERTAIN, path);
    seen = wanted;
    const left: InsertionRecord = {
      intentId: intent.intentId,
      operationId: intent.operationId,
      part: intent.part,
      chat: intent.target,
      composerInstanceId: token,
      revision,
      digest: digest(wanted),
      contentDigest: digest(normalize(wanted)),
      whole: !append || ours,
    };
    record = left;
    options.changed();
    const applied: InsertReceipt = { state: 'applied', draftRevision: left.revision, draftDigest: left.digest, ms: 0 };
    // After a task of the page — its microtasks (NgModel, a restored draft) and its timers of 0 ms have run: still
    // what we wrote? A field gone with its chat keeps what the write gave the page's model; a field that now holds
    // something else was written over in between (the neighbour, the page): `uncertain`, never again.
    return new Promise((resolve) =>
      win.setTimeout(() => {
        const ms = Math.max(0, Math.round(win.performance.now() - started));
        resolve(note(target.isConnected && target === field && target.value !== wanted ? UNCERTAIN : { ...applied, ms }, path));
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
      seen = next?.value ?? '';
      listen(field, true);
    },
    revision: () => revision,
    composing: () => composing,
    provenance,
    insertion() {
      look();
      return record;
    },
    sentDraft() {
      if (field === null) return null;
      const now = provenance();
      const from = record;
      return { revision, provenance: now, insertIntentId: from?.intentId ?? null, editedSinceInsert: from === null ? null : now !== 'our-insert' };
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
