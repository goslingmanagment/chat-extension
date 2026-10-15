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
//   (`op.reportSent`, telemetry `sent`). No reading of that gesture, two of
//   it, or one of another group or text — not linked; MAIN says one send a
//   gesture at most, so the readings of that gesture go with it. A text alone
//   links nothing: drafts of other operations with the same text, read at
//   other gestures, are never taken for this send (review of P7f).
// - A reading waits for its send at most READING_MS (MAIN waits as long for a
//   receipt's echo): one the page never sent — the neighbour's word filter
//   swallowed it (S5 §2.6) — simply ages out.
// - A text equal to our insert sent with no gesture — from another device, by
//   a script's click — gets no `fx.sent` from MAIN, and so nothing here.

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
  /** The gesture's event `timeStamp`: its name in both worlds. */
  readonly gestureAt: number;
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
  /** `fx.sent` of a gesture this side has no reading of. */
  readonly unmatched: number;
  /** `fx.sent` whose gesture's reading is of another group or text. */
  readonly mismatched: number;
  /** `fx.sent` of a gesture read twice. */
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

export function createSendObserver(options: SendObserverOptions): SendObserver {
  const { win, now } = options;
  let readings: Reading[] = [];
  let serial = 0;
  const stats = { gestures: 0, linked: 0, unmatched: 0, mismatched: 0, ambiguous: 0 };

  const fresh = (): void => {
    const at = now();
    readings = readings.filter((reading) => at - reading.at <= READING_MS);
  };

  const read = (field: HTMLTextAreaElement, event: Event): void => {
    stats.gestures += 1;
    const where = options.chat();
    const draft = options.draft();
    const text = normalize(field.value);
    if (where === null || draft === null || text === '') return;
    fresh();
    serial += 1;
    readings.push({ serial, gestureAt: event.timeStamp, groupId: where.groupId, chat: where.chat, draft, contentDigest: digest(text), at: now() });
    if (readings.length > READINGS_MAX) readings.shift();
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.isTrusted !== true || event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    const field = options.field();
    if (field !== null && event.target === field) read(field, event);
  };
  const onClick = (event: MouseEvent): void => {
    if (event.isTrusted !== true) return;
    const field = options.field();
    const target = event.target as Partial<Element> | null;
    if (field === null || typeof target?.closest !== 'function') return;
    const button = target.closest(SEND_BUTTON);
    const composer = button?.closest(COMPOSER) ?? null;
    if (composer !== null && composer === field.closest(COMPOSER)) read(field, event);
  };
  win.addEventListener('keydown', onKey, CAPTURE);
  win.addEventListener('click', onClick, CAPTURE);

  const note = (link: SendDiagnostic['detail']['link'], draft: SentDraft | null): void =>
    options.onDiagnostic?.({ event: 'human-send', detail: { link, ours: draft === null ? null : draft.insertIntentId !== null, edited: draft?.editedSinceInsert ?? null } });

  return {
    sent(payload) {
      fresh();
      // Only the reading of this very gesture — MAIN says one send a gesture at most, so its readings go with it.
      const found = readings.filter((reading) => reading.gestureAt === payload.gestureAt);
      readings = readings.filter((reading) => reading.gestureAt !== payload.gestureAt);
      const reading = found[0];
      if (found.length !== 1 || reading === undefined) {
        if (found.length === 0) stats.unmatched += 1;
        else stats.ambiguous += 1;
        return note(found.length === 0 ? 'unmatched' : 'ambiguous', null);
      }
      // Its group and text — a check: a gesture whose send is not what was read there is not linked.
      if (reading.groupId !== payload.groupId || reading.contentDigest !== payload.contentDigest) {
        stats.mismatched += 1;
        return note('mismatched', reading.draft);
      }
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
