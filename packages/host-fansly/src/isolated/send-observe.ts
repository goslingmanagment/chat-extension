// The person's send on Fansly, linked to our draft (docs/project-unite/
// architecture.md §5.9 п. 7, §7.5 п. 5, §9.3; FS-SEND-2; D-17). We never
// send: MAIN watches the person's own Enter or Send click and says
// `fx.sent {groupId, msgId, contentDigest, gestureAt}` for a send it proved to
// be that gesture's (main/send-gesture.ts) — the text itself never crosses.
// `gestureAt` is the `timeStamp` of the gesture's event, which both worlds
// read from the same event: it names the gesture on both sides. Here:
// - AT THE SAME GESTURE — the trusted Enter (no Shift, no IME composition) in
//   the field the port owns, or the trusted click on that field's own
//   `.send-button` — the draft is read before the page clears the field (a
//   microtask after its send, without events — fansly-web.md §3): the chat
//   and group of the route, the draft as a send carries it (`sentDraft`,
//   insert.ts: its revision, its provenance, the insert it descends from and
//   whether it changed since), the digest of its text normalized as MAIN
//   digests the sent `content`, and the event's `timeStamp`. An empty field
//   is no send.
// - An `fx.sent` is linked only to the reading of ITS gesture (`gestureAt`),
//   checked by its group and the digest of the sent text: the port says
//   `humanSend` — with our insert's intent and «edited since» when the draft
//   descends from one —, and the tab reports it for its operation
//   (`op.reportSent`, telemetry `sent`). Drafts of other operations with the
//   same text, read at other gestures, are never taken for this send.
// - A gesture's name is not unique: Firefox reduces the precision of
//   `timeStamp`, and two gestures may share one. So every gesture MAIN could
//   count (its own filter, repeated here) is noted with its name, read or not,
//   and a name is POISONED — no send carrying it is linked, whatever reading
//   is left — when two gestures share it, when its note leaves the bound, or
//   when the gesture was noted without a reading (an empty field, a chat not
//   named yet, a field the port does not own). Rarely a send goes
//   unattributed; never to the wrong draft (re-check of P7f).
// - A note waits for its send at most READING_MS (MAIN says a send at most as
//   long after its gesture): a press the page never sent — the neighbour's
//   word filter swallowed it (S5 §2.6) — simply ages out.
// - A text equal to our insert sent with no gesture — from another device, by
//   a script's click — gets no `fx.sent` from MAIN, and so nothing here.

import type { HumanSendFact, SentDraft } from '@cg/contracts/host';
import type { ChatRef } from '@cg/contracts/ids';
import { digest, normalize } from '@cg/host-kit/common/digest';

/** Gestures noted, read or not: at most this many — one more poisons the oldest one's name… */
export const READINGS_MAX = 64;
/** …each at most this long (MAIN says a send at most as long after its gesture: GESTURE_SEND_MS). */
export const READING_MS = 120_000;
/** Poisoned names kept; past it, nothing is linked for a while (nothing can be told apart). */
const POISON_MAX = 256;

/** MAIN's gesture filter (main/send-gesture.ts), repeated: the isolated bundle carries no MAIN code; a test pins them. */
export const MAIN_COMPOSER = 'app-messages-conversation-route > app-group-message-container > app-group-message-input';
export const MAIN_FIELD = 'textarea.message-input';
export const SEND_BUTTON = '.send-button';
const COMPOSER = 'app-group-message-input';

/** The draft read at one gesture. */
interface Reading {
  readonly serial: number;
  readonly groupId: string;
  readonly chat: ChatRef;
  readonly draft: SentDraft;
  readonly contentDigest: string;
}

/** One gesture MAIN could count: its name (its event's `timeStamp`), when it was noted, and its reading if one was taken. */
interface Note {
  readonly gestureAt: number;
  readonly at: number;
  readonly reading: Reading | null;
}

export interface SendObserveStats {
  /** Trusted gestures MAIN could count (its filter). */
  readonly gestures: number;
  /** `fx.sent` linked to a reading, and the port's `humanSend` said. */
  readonly linked: number;
  /** `fx.sent` of a gesture this side has no note of. */
  readonly unmatched: number;
  /** `fx.sent` whose gesture's reading is of another group or text. */
  readonly mismatched: number;
  /** `fx.sent` of a poisoned name: shared by two gestures, lost to the bound, or noted with no reading. */
  readonly ambiguous: number;
}

/** What the tab's log hears of a send — its link, never its text or a fan. */
export interface SendDiagnostic {
  readonly event: 'human-send';
  readonly detail: { readonly link: 'linked' | 'unmatched' | 'mismatched' | 'ambiguous'; readonly ours: boolean | null; readonly edited: boolean | null };
}

export interface SendObserverOptions {
  readonly win: Window;
  /** The field the port owns now; null — none. */
  readonly field: () => HTMLTextAreaElement | null;
  /** That field's draft as a send carries it (insert.ts `sentDraft`); null — no field. */
  readonly draft: () => SentDraft | null;
  /** The open chat — its fan known — and its group; null — none. */
  readonly chat: () => { readonly chat: ChatRef; readonly groupId: string } | null;
  readonly now: () => number;
  /** A send of the person, linked: the port's `humanSend`. */
  readonly said: (fact: HumanSendFact) => void;
  readonly onDiagnostic?: (diagnostic: SendDiagnostic) => void;
}

export interface SendObserver {
  /** MAIN's `fx.sent`. */
  sent(payload: { readonly groupId: string; readonly msgId: string; readonly contentDigest: string; readonly gestureAt: number }): void;
  /** Another creator: what was read under the old one is gone. */
  reset(): void;
  stats(): SendObserveStats;
  dispose(): void;
}

/** In the capture phase on the window, passive: before the page's own handlers, and nothing is cancelled. */
const CAPTURE: AddEventListenerOptions = { capture: true, passive: true };

const isElement = (target: EventTarget | null): target is Element => typeof (target as Partial<Element> | null)?.closest === 'function';

export function createSendObserver(options: SendObserverOptions): SendObserver {
  const { win, now } = options;
  let notes: Note[] = [];
  /** Poisoned names (name → until), and a window in which nothing is linked because the poison overflowed. */
  const poisoned = new Map<number, number>();
  let blindUntil = -Infinity;
  let serial = 0;
  const stats = { gestures: 0, linked: 0, unmatched: 0, mismatched: 0, ambiguous: 0 };

  const poison = (gestureAt: number): void => {
    const at = now();
    poisoned.set(gestureAt, at + READING_MS);
    if (poisoned.size > POISON_MAX) {
      blindUntil = at + READING_MS;
      poisoned.clear();
    }
  };
  const fresh = (): void => {
    const at = now();
    notes = notes.filter((note) => at - note.at <= READING_MS);
    for (const [name, until] of poisoned) if (until <= at) poisoned.delete(name);
  };

  /** A gesture MAIN could count: noted with its name; read too when it is the field this port owns, with text. */
  const noteGesture = (event: Event, field: HTMLTextAreaElement | null): void => {
    stats.gestures += 1;
    fresh();
    const gestureAt = event.timeStamp;
    const where = options.chat();
    const draft = options.draft();
    const text = field === null ? '' : normalize(field.value);
    let reading: Reading | null = null;
    if (field !== null && where !== null && draft !== null && text !== '') {
      serial += 1;
      reading = { serial, groupId: where.groupId, chat: where.chat, draft, contentDigest: digest(text) };
    }
    // Seen without a reading, or a name another gesture of the window has: no send of that name can be linked.
    if (reading === null || notes.some((note) => note.gestureAt === gestureAt)) poison(gestureAt);
    notes.push({ gestureAt, at: now(), reading });
    const left = notes.length > READINGS_MAX ? notes.shift() : undefined;
    if (left !== undefined) poison(left.gestureAt);
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.isTrusted !== true || event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    const target = event.target;
    if (!isElement(target) || !target.matches(MAIN_FIELD) || target.closest(MAIN_COMPOSER) === null) return;
    const field = options.field();
    noteGesture(event, field !== null && target === field ? field : null);
  };
  const onClick = (event: MouseEvent): void => {
    if (event.isTrusted !== true) return;
    const target = event.target;
    const button = isElement(target) ? target.closest(SEND_BUTTON) : null;
    if (button === null || button.closest(MAIN_COMPOSER) === null) return;
    const field = options.field();
    noteGesture(event, field !== null && button.closest(COMPOSER) === field.closest(COMPOSER) ? field : null);
  };
  win.addEventListener('keydown', onKey, CAPTURE);
  win.addEventListener('click', onClick, CAPTURE);

  const report = (link: SendDiagnostic['detail']['link'], draft: SentDraft | null): void =>
    options.onDiagnostic?.({ event: 'human-send', detail: { link, ours: draft === null ? null : draft.insertIntentId !== null, edited: draft?.editedSinceInsert ?? null } });

  return {
    sent(payload) {
      fresh();
      // Only the note of this very gesture — MAIN says one send a gesture at most, so its notes go with it.
      const found = notes.filter((note) => note.gestureAt === payload.gestureAt);
      notes = notes.filter((note) => note.gestureAt !== payload.gestureAt);
      if (now() < blindUntil || poisoned.has(payload.gestureAt) || found.length > 1) {
        stats.ambiguous += 1;
        return report('ambiguous', null);
      }
      const reading = found[0]?.reading ?? null;
      if (reading === null) {
        stats.unmatched += 1;
        return report('unmatched', null);
      }
      // Its group and text — a check: a gesture whose send is not what was read there is not linked.
      if (reading.groupId !== payload.groupId || reading.contentDigest !== payload.contentDigest) {
        stats.mismatched += 1;
        return report('mismatched', reading.draft);
      }
      stats.linked += 1;
      report('linked', reading.draft);
      options.said({ chat: reading.chat, pendingId: `g${String(reading.serial)}`, platformMessageId: payload.msgId, textDigest: payload.contentDigest, draft: reading.draft });
    },
    reset() {
      // What was noted under the old creator names nothing of the new one's: those names are poisoned, not forgotten.
      for (const note of notes) poison(note.gestureAt);
      notes = [];
    },
    stats: () => ({ ...stats }),
    dispose() {
      win.removeEventListener('keydown', onKey, CAPTURE);
      win.removeEventListener('click', onClick, CAPTURE);
      notes = [];
      poisoned.clear();
    },
  };
}
