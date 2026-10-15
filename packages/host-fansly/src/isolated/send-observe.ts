// The person's send on Fansly, linked to our draft (docs/project-unite/
// architecture.md §5.9 п. 7, §7.5 п. 5, §9.3; FS-SEND-2; D-17). We never
// send: MAIN watches the person's own Enter or Send click and says
// `fx.sent {groupId, msgId, contentDigest}` for a send it proved to be that
// gesture's (main/send-gesture.ts) — the text itself never crosses. Here:
// - AT THE SAME GESTURE — the trusted Enter (no Shift, no IME composition) in
//   the field the port owns, or the trusted click on that field's own
//   `.send-button` — the draft is read before the page clears the field (a
//   microtask after its send, without events — fansly-web.md §3): the chat
//   and group of the route, the draft as a send carries it (`sentDraft`,
//   insert.ts: its revision, its provenance, the insert it descends from and
//   whether it changed since), and the digest of its text normalized as MAIN
//   digests the sent `content`. An empty field is no send.
// - An `fx.sent` is linked to the ONE reading of its group whose digest is
//   the sent text's: the port says `humanSend` — with our insert's intent and
//   «edited since» when the draft descends from one —, and the tab reports
//   it for its operation (`op.reportSent`, telemetry `sent`). None — not
//   linked (the text changed between the gesture and the send, a gesture
//   this side did not see); two — not linked either: the link is one or
//   none, and the readings it could not tell apart go with it.
// - The same text pressed again from the same draft — the page sent nothing
//   the first time (the neighbour's word filter, S5 §2.6) — replaces the
//   earlier reading; any other reading waits for its send until it is old.
// - A text equal to our insert sent with no gesture — from another device, by
//   a script's click — gets no `fx.sent` from MAIN, and so nothing here: a
//   matching text alone never makes a `sent`.

import type { HumanSendFact, SentDraft } from '@cg/contracts/host';
import type { ChatRef } from '@cg/contracts/ids';
import { digest, normalize } from '@cg/host-kit/common/digest';

/** Readings waiting for their send: at most this many… */
export const READINGS_MAX = 16;
/** …each at most this long (MAIN waits as long for a receipt's echo). */
export const READING_MS = 60_000;

const SEND_BUTTON = '.send-button';
const COMPOSER = 'app-group-message-input';

/** The draft read at one gesture. */
interface Reading {
  readonly serial: number;
  readonly groupId: string;
  readonly chat: ChatRef;
  readonly draft: SentDraft;
  readonly contentDigest: string;
  readonly at: number;
}

export interface SendObserveStats {
  /** Trusted gestures in the field the port owns. */
  readonly gestures: number;
  /** `fx.sent` linked to a reading, and the port's `humanSend` said. */
  readonly linked: number;
  /** `fx.sent` with no reading of its group and text. */
  readonly unmatched: number;
  /** `fx.sent` with two or more such readings. */
  readonly ambiguous: number;
}

/** What the tab's log hears of a send — its link, never its text or a fan. */
export interface SendDiagnostic {
  readonly event: 'human-send';
  readonly detail: { readonly link: 'linked' | 'unmatched' | 'ambiguous'; readonly ours: boolean | null; readonly edited: boolean | null };
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
  sent(payload: { readonly groupId: string; readonly msgId: string; readonly contentDigest: string }): void;
  /** Another creator: what was read under the old one is gone. */
  reset(): void;
  stats(): SendObserveStats;
  dispose(): void;
}

/** In the capture phase on the window, passive: before the page's own handlers, and nothing is cancelled. */
const CAPTURE: AddEventListenerOptions = { capture: true, passive: true };

const sameLink = (a: SentDraft, b: SentDraft): boolean => a.insertIntentId === b.insertIntentId && a.editedSinceInsert === b.editedSinceInsert && a.provenance === b.provenance;

export function createSendObserver(options: SendObserverOptions): SendObserver {
  const { win, now } = options;
  let readings: Reading[] = [];
  let serial = 0;
  const stats = { gestures: 0, linked: 0, unmatched: 0, ambiguous: 0 };

  const fresh = (): void => {
    const at = now();
    readings = readings.filter((reading) => at - reading.at <= READING_MS);
  };

  const read = (field: HTMLTextAreaElement): void => {
    stats.gestures += 1;
    const where = options.chat();
    const draft = options.draft();
    const text = normalize(field.value);
    if (where === null || draft === null || text === '') return;
    fresh();
    serial += 1;
    const reading: Reading = { serial, groupId: where.groupId, chat: where.chat, draft, contentDigest: digest(text), at: now() };
    // The same draft pressed again: whatever the first press did, it sent nothing this reading could still be told from.
    readings = readings.filter((other) => !(other.groupId === reading.groupId && other.contentDigest === reading.contentDigest && sameLink(other.draft, reading.draft)));
    readings.push(reading);
    if (readings.length > READINGS_MAX) readings.shift();
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.isTrusted !== true || event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    const field = options.field();
    if (field !== null && event.target === field) read(field);
  };
  const onClick = (event: MouseEvent): void => {
    if (event.isTrusted !== true) return;
    const field = options.field();
    const target = event.target as Partial<Element> | null;
    if (field === null || typeof target?.closest !== 'function') return;
    const button = target.closest(SEND_BUTTON);
    const composer = button?.closest(COMPOSER) ?? null;
    if (composer !== null && composer === field.closest(COMPOSER)) read(field);
  };
  win.addEventListener('keydown', onKey, CAPTURE);
  win.addEventListener('click', onClick, CAPTURE);

  const note = (link: SendDiagnostic['detail']['link'], draft: SentDraft | null): void =>
    options.onDiagnostic?.({ event: 'human-send', detail: { link, ours: draft === null ? null : draft.insertIntentId !== null, edited: draft?.editedSinceInsert ?? null } });

  return {
    sent(payload) {
      fresh();
      const found = readings.filter((reading) => reading.groupId === payload.groupId && reading.contentDigest === payload.contentDigest);
      const reading = found[0];
      if (found.length !== 1 || reading === undefined) {
        if (found.length === 0) stats.unmatched += 1;
        else stats.ambiguous += 1;
        // Readings a send could not tell apart are no better for the next one.
        readings = readings.filter((other) => !found.includes(other));
        return note(found.length === 0 ? 'unmatched' : 'ambiguous', null);
      }
      readings = readings.filter((other) => other !== reading);
      stats.linked += 1;
      note('linked', reading.draft);
      options.said({ chat: reading.chat, pendingId: `g${String(reading.serial)}`, platformMessageId: payload.msgId, textDigest: payload.contentDigest, draft: reading.draft });
    },
    reset() {
      readings = [];
    },
    stats: () => ({ ...stats }),
    dispose() {
      win.removeEventListener('keydown', onKey, CAPTURE);
      win.removeEventListener('click', onClick, CAPTURE);
      readings = [];
    },
  };
}
