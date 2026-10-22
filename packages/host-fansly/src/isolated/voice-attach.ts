// The voice note's MP3 into the open chat's composer: `HostPort.attachFile` of a Fansly tab
// (docs/project-unite/architecture.md §7.10, §7.12; FS-VOI-2; R20 P12c). The file goes into Fansly's own
// `input[type=file]` of the main composer the way the person's file picker puts it there (handoff.ts: two paths, one
// `change`); Fansly does the rest — its upload modal, where the person chooses Free or PPV and presses «Upload» (S2
// Q5). Nothing is sent: the person sends the message with Fansly's own Send. The old extension did the same handoff
// (fansly-chat `src/content/voice/attach-adapter.ts`) and confirmed it by a `waveform` this build no longer has.
//
// - Before anything reaches the page, in this order: the document, the creator, the route, the chat and the composer
//   the intent was made for are the ones open (`identity`); no attempt of ours is still open (`busy`); exactly one
//   file input in the main composer — the conversation route's own, never the mini-chat's or an editor's — with its
//   attachments and the field the port owns, not copy only (`anchor-missing`); no modal of Fansly open (`busy`). The
//   click's token is spent after these checks, so a stale intent spends none — and they are all asked again after
//   it, with nothing between the last of them and the handoff.
// - The confirmation (§7.10): Fansly's «Upload» puts a NEW `app-account-media-create-template.attachment` into the
//   main composer's `div.message-attachments`, then closes its modal — `body.modal-opened` goes — in the same task
//   (main:42646, :55967-55972). The two together are `attached`. The modal closed and nothing new: the person closed
//   it (its ✕, the backdrop) — `not-attached` (`dismissed`) once 20 s more brought nothing late. Anything else is not
//   seen to its end, `unknown`: two new attachments; a modal again after ours closed empty; no modal at all (the page
//   did not take the file); another document, creator, route or chat, the composer gone; the modal still open at the
//   attempt's cap; a dispatch that threw once it began.
// - Watched only while an attempt is open: a `childList` observer on the attachments and one on `<body>`'s class,
//   armed before the handoff and gone with its outcome. The person may take a while in the modal — the old
//   extension's fixed 20 s cut them short —, so an open modal is waited out, up to the attempt's cap.
// - One handoff per click at most, whatever came of it: «Прикрепить ещё раз» is a new click of the person.

import type { FanslyHandoffPath } from '@cg/contracts/fansly';
import type { AttachIntent, AttachReceipt, AttachRefusal, ComposerState, HostEvent, Unsubscribe } from '@cg/contracts/host';
import type { HostIdentity } from '@cg/contracts/ids';

import { FANSLY_SELECTORS, type AnchorWatcher } from './anchors';
import { handFile, type HandoffResult } from './handoff';
import { identityMatches } from './identity';

/** How long an attempt is watched (§7.10). */
export const ATTACH_LIMITS = {
  /** After Fansly's modal closed, how long an attachment may still come. */
  afterCloseMs: 20_000,
  /** The longest an attempt is watched from its handoff: the person in Fansly's modal. */
  capMs: 5 * 60 * 1000,
} as const;

const S = FANSLY_SELECTORS;
/** Fansly's create template among the composer's attachments: one per «Upload» (main:55189). */
const ATTACHMENT = 'app-account-media-create-template.attachment';
/**
 * The main composer's input on the page's own document, for the second path of handoff.ts (it must name exactly one):
 * the conversation route's chain as locateConversation reads it — never the mini-chat's or an editor's composer.
 */
const PAGE_INPUT = `${S.conversationRoute} > ${S.container} > ${S.composer} ${S.fileInput}`;
/** A name the fan may see as it is; any other goes as `voice-<id>.mp3`. */
const PLAIN_NAME = /^\w[\w.-]{0,95}\.mp3$/i;

export interface AttachTimer {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

/** Which way the files went and what came of them, since the port began (client_health's counters: no dashes). */
export interface VoiceAttachStats {
  readonly dataTransfer: number;
  readonly cloneInto: number;
  readonly attached: number;
  readonly notAttached: number;
  readonly unknown: number;
}

/** What the tab's log hears of an attempt: its outcome, why, its path and time — never the file or a name. */
export interface AttachDiagnostic {
  readonly event: 'voice-attach';
  readonly detail: { readonly state: AttachReceipt['state']; readonly reason: string | null; readonly path: FanslyHandoffPath | null; readonly ms: number | null };
}

export interface VoiceAttachEnv {
  readonly win: Window;
  readonly anchors: Pick<AnchorWatcher, 'current'>;
  /** Our UI acts: the address verified, the anchors read again (the port's `acting`). */
  readonly acting: () => void;
  /** The port's identity now; null — none. */
  readonly identity: () => HostIdentity | null;
  /** The open composer as the port says it. */
  readonly composer: () => ComposerState | null;
  /** The field the port owns now. */
  readonly field: () => HTMLTextAreaElement | null;
  /** The background's `token.redeem` for the click; false — not spent, nothing is handed over. */
  readonly redeem: (request: { readonly kind: 'insert'; readonly actionToken: string; readonly intentId: string }) => Promise<boolean>;
  /** The port's events: another route, composer or account — an open attempt looks again. */
  readonly subscribe: (listener: (event: HostEvent) => void) => Unsubscribe;
  readonly now: () => number;
  readonly timer?: AttachTimer;
  readonly onDiagnostic?: (diagnostic: AttachDiagnostic) => void;
}

export interface VoiceAttach {
  attach(intent: AttachIntent): Promise<AttachReceipt>;
  stats(): VoiceAttachStats;
  /** The port goes: an attempt still open is not seen to its end. */
  dispose(): void;
}

/** Where an attempt hands its file and watches for it. */
interface Target {
  readonly identity: HostIdentity;
  readonly composer: Element;
  readonly attachments: Element;
  readonly input: HTMLInputElement;
}

/** An attempt from its first check to its outcome; `halt` ends it from outside once it watches. */
interface Attempt {
  halt: () => void;
}

export function createVoiceAttach(env: VoiceAttachEnv): VoiceAttach {
  const { win } = env;
  const doc = win.document;
  const timer: AttachTimer = env.timer ?? { set: (callback, ms) => win.setTimeout(callback, ms), clear: (handle) => win.clearTimeout(handle as number) };
  const counts = { dataTransfer: 0, cloneInto: 0, attached: 0, notAttached: 0, unknown: 0 };
  let open: Attempt | null = null;
  let disposed = false;

  const modalOpen = (): boolean => doc.body?.classList.contains(S.modalFlag) === true;
  const attachmentsIn = (attachments: Element): Element[] => [...attachments.querySelectorAll(ATTACHMENT)];

  const said = (receipt: AttachReceipt, path: FanslyHandoffPath | null, why: string | null): AttachReceipt => {
    if (receipt.state === 'attached') counts.attached += 1;
    else if (receipt.state === 'not-attached') counts.notAttached += 1;
    else if (receipt.state === 'unknown') counts.unknown += 1;
    const reason = receipt.state === 'refused' || receipt.state === 'not-attached' ? receipt.reason : why;
    env.onDiagnostic?.({ event: 'voice-attach', detail: { state: receipt.state, reason, path, ms: receipt.state === 'attached' ? receipt.ms : null } });
    return receipt;
  };
  const refused = (reason: AttachRefusal): AttachReceipt => said({ state: 'refused', reason }, null, null);

  /** The page as an attempt needs it now, or why not; `own` — the attempt asking, which is no other's `busy`. */
  const look = (intent: AttachIntent, own: Attempt | null): Target | AttachRefusal => {
    env.acting();
    const current = env.identity();
    const { expected } = intent;
    if (disposed || current === null || current.chat === null || !identityMatches(expected, current) || expected.composerInstanceId !== current.composerInstanceId) return 'identity';
    if (open !== null && open !== own) return 'busy';
    const conversation = env.anchors.current().conversation;
    const field = env.field();
    const composer = conversation?.composer ?? null;
    const attachments = conversation?.attachments ?? null;
    if (conversation === null || composer === null || attachments === null || field === null || conversation.textarea !== field || conversation.copyOnly || env.composer()?.hidden !== false) return 'anchor-missing';
    const inputs = composer.querySelectorAll<HTMLInputElement>(S.fileInput);
    const input = inputs.length === 1 ? inputs[0] : undefined;
    if (input === undefined || !input.isConnected) return 'anchor-missing';
    // Fansly's own modal is up — its upload of something else, a picture viewed: the person is busy there.
    return modalOpen() ? 'busy' : { identity: current, composer, attachments, input };
  };

  /** The MP3 as the page gets it: a name the fan may see. */
  const fileOf = (intent: AttachIntent): File => {
    const name = PLAIN_NAME.test(intent.file.name) ? intent.file.name : `voice-${intent.intentId.slice(0, 8)}.mp3`;
    return new (win as Window & typeof globalThis).File([intent.file.bytes], name, { type: 'audio/mpeg' });
  };

  /** Hands the file over once and watches the attachments and the modal until it knows (§7.10). */
  const watch = (attempt: Attempt, target: Target, file: File): Promise<AttachReceipt> =>
    new Promise<AttachReceipt>((resolve) => {
      const { attachments } = target;
      const before = new Set(attachmentsIn(attachments));
      let path: FanslyHandoffPath | null = null;
      let handedAt = 0;
      /** Fansly's modal was seen open since the handoff. */
      let opened = false;
      /** No modal open and nothing new: the wait after the close runs (`grace`). */
      let closed = false;
      let grace: unknown = null;
      const offs: Array<() => void> = [];
      const settle = (receipt: AttachReceipt, why: string | null): void => {
        if (open !== attempt) return;
        open = null;
        for (const off of offs.splice(0)) off();
        resolve(said(receipt, path, why));
      };
      const unknown = (why: string): void => settle({ state: 'unknown' }, why);
      const check = (): void => {
        if (path === null || open !== attempt) return;
        const current = env.identity();
        // Another document, creator, route or chat, the composer or its attachments gone: whatever lands is not seen.
        if (current === null || !identityMatches(target.identity, current) || !attachments.isConnected || env.anchors.current().conversation?.composer !== target.composer) return unknown('left');
        const fresh = attachmentsIn(attachments).filter((element) => !before.has(element));
        if (fresh.length > 1) return unknown('two');
        if (modalOpen()) {
          // A modal again after ours closed with nothing new: what comes of it is no answer to our file.
          if (opened && closed) return unknown('modal-again');
          opened = true;
          closed = false;
          if (grace !== null) timer.clear(grace);
          grace = null;
          return;
        }
        if (fresh.length === 1) return settle({ state: 'attached', ms: Math.max(0, Math.round(env.now() - handedAt)) }, null);
        if (closed) return;
        closed = true;
        grace = timer.set(() => {
          grace = null;
          check();
          // A modal open now (a late one of ours) is waited out; otherwise nothing came. Closed after it was open: the
          // person closed it. Never open: the page did not take the file.
          if (!closed) return;
          if (opened) settle({ state: 'not-attached', reason: 'dismissed' }, null);
          else unknown('not-taken');
        }, ATTACH_LIMITS.afterCloseMs);
      };

      // Everything that can settle the attempt is armed before the page sees the file.
      const Observer = (win as Window & typeof globalThis).MutationObserver;
      const onAttachments = new Observer(check);
      onAttachments.observe(attachments, { childList: true, subtree: true });
      const onModal = new Observer(check);
      if (doc.body !== null) onModal.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
      const cap = timer.set(() => unknown('cap'), ATTACH_LIMITS.capMs);
      const offEvents = env.subscribe((event) => {
        if (event.type === 'route' || event.type === 'composer' || event.type === 'accounts') check();
      });
      offs.push(
        () => onAttachments.disconnect(),
        () => onModal.disconnect(),
        () => timer.clear(cap),
        () => {
          if (grace !== null) timer.clear(grace);
        },
        offEvents,
      );
      attempt.halt = () => unknown('stopped');

      let handed: HandoffResult;
      try {
        handed = handFile(win, target.input, file, PAGE_INPUT);
      } catch {
        // HandoffIndeterminateError, or anything else once the input was touched: the page may have the file.
        return unknown('dispatch');
      }
      if (handed === 'unavailable') return settle({ state: 'refused', reason: 'anchor-missing' }, null);
      path = handed;
      handedAt = env.now();
      counts[handed === 'data-transfer' ? 'dataTransfer' : 'cloneInto'] += 1;
      // Fansly opens its modal within the `change` itself (main:56066, :55953): what the page shows now is the start.
      check();
    });

  return {
    async attach(intent) {
      const early = look(intent, null);
      if (typeof early === 'string') return refused(early);
      // Taken before the token's wait: a second click meanwhile is `busy`, never a second handoff.
      const attempt: Attempt = { halt: () => undefined };
      open = attempt;
      const spent = await env.redeem({ kind: 'insert', actionToken: intent.cause.actionToken, intentId: intent.intentId }).catch(() => false);
      // The token refused, or the page moved while it was spent: nothing reaches the page.
      const target = spent ? look(intent, attempt) : 'cause';
      if (typeof target === 'string') {
        if (open === attempt) open = null;
        return refused(target);
      }
      return watch(attempt, target, fileOf(intent));
    },
    stats: () => ({ ...counts }),
    dispose() {
      if (disposed) return;
      disposed = true;
      open?.halt();
      open = null;
    },
  };
}
