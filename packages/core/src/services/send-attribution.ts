// Who sent each message (decision X48; hub `clientSendAttributions`,
// capability `send-attribution-v1`). A person pressed the site's own Send, or
// «Отправить» of a preview, and the page's own response to exactly that send
// named the platform's message id: the background tells the hub this page,
// this message, this fan, when, with a price or media or neither. The person
// is the hub's — the user of the token — never a field of ours, so a fact is
// its sender's to deliver: it is kept with whoever was signed in when it was
// taken and goes only under their sign-in. No text of a message is ever here.
//
// The owed journal, its batching, retries, sign-in binding and clock skew
// are the engine's (owed-report.ts), shared with who wrote each note.
//
// A report of what already happened, never a send. Every answer of the hub
// is final (`recorded`, `duplicate`, `conflict`, `out_of_range`): a fact the
// hub answered is never said again, and a repeat of a lost answer reads
// `duplicate` there. So what the hub has not answered is OWED: journaled
// (storage.local, ids only) before the first call, delivered again by the
// next instance of the event page, after a sign-in of the same person, and
// whenever the hub is heard again (`resume`). Within one run a failure the
// hub may not repeat (the network, a 5xx, a 429) is retried on the custody
// report's schedule; a refusal of the hub layer itself (no capability on this
// hub — a rollback, the page not granted by this bootstrap) or a lost sign-in
// leaves the fact owed for the next such moment. Another answer of the hub
// (a 4xx) is final: those facts are given up and logged.
//
// Facts of one person, page and client go together, at most
// SEND_ATTRIBUTION_LIMITS.maxFacts a request, after SEND_ATTRIBUTION_BATCH_MS
// of quiet: a burst of sends is one request. A fact nobody could deliver for
// SEND_ATTRIBUTION_KEEP_MS is given up (the hub takes 30 days at most), and
// beyond SEND_ATTRIBUTIONS_MAX the oldest go. A fact the hub's own schema
// would refuse is never taken: one such fact would hold its whole group.
//
// The time is this browser's clock, and the hub takes nothing more than
// 5 minutes ahead of its own. Every answer carries the hub's clock: a skew of
// more than a minute is learned from it and corrects every time sent after,
// and a fact the hub found ahead of its clock is sent once more, corrected —
// a computer whose clock runs fast must not lose every send of its person.
//
// Chat Memory week 1: a fact also carries its chat's own id where the site has
// one (Fansly's group — the hub refuses a Fansly fact without it, so such a
// fact is never taken) and how its text was written (`composedWith`,
// `edited`).
//
// A send seen only by its receipt (Fansly's `pageSent`: media, PPV, any send
// of the page) is taken at once — journaled, under the person signed in at
// that moment — and held SEND_ATTRIBUTION_RECEIPT_HOLD_MS before it goes: the
// same message's human send may still come (the gesture waits up to a minute
// for its echo) and tell how its text was written, which replaces the
// receipt's `unknown` while it is held. A tab closed, or another person
// signed in, under the hold changes nothing of whose send it was.

import {
  SEND_ATTRIBUTION_CHAT_SOURCES,
  SEND_ATTRIBUTION_COMPOSED_WITH,
  SEND_ATTRIBUTION_LIMITS,
  SEND_ATTRIBUTION_OUTCOMES,
  SendAttributionHubFactSchema,
  type SendAttributionComposedWith,
  type HubFacade,
  type SendAttributionsRequest,
} from '@cg/contracts/hub';

import { LOCAL_KEYS } from '../domain/storage';
import { OwedReports, type OwedReportSpec } from './owed-report';
import { NO_LOG, type Clock, type KeyValueStore, type LogSink } from './ports';

/** storage.local: who-sent facts the hub has not answered yet (ids only, never a text). */
export const SEND_ATTRIBUTIONS_KEY = LOCAL_KEYS.sendAttributions;
/** Facts kept at most; beyond it the oldest go. */
export const SEND_ATTRIBUTIONS_MAX = 1000;
/** A fact nobody could deliver for this long is given up. */
export const SEND_ATTRIBUTION_KEEP_MS = 14 * 24 * 60 * 60_000;
/** How long a new fact waits for the next ones before its report goes. */
export const SEND_ATTRIBUTION_BATCH_MS = 3_000;
/** A difference from the hub's clock above this corrects the times sent; below it the browser's clock stands. */
export const SEND_ATTRIBUTION_SKEW_MS = 60_000;
/** How long a send seen only by its receipt waits for its human send before it goes as written in a way not known. */
export const SEND_ATTRIBUTION_RECEIPT_HOLD_MS = 60_000;

/** One send, as the background takes it: the page and client it is reported for, and the hub's own fact. */
export interface SendAttributionInput {
  readonly pageLabel: string;
  /** The client that observed it (hub `source`): a site's word, never the core's (contracts HOST_SEND_ATTRIBUTION_SOURCE). */
  readonly source: string;
  readonly platformMessageId: string;
  /** The fan the message went to (OnlyFans: the fan id, which is the chat id). */
  readonly fanRef: string;
  /** When the client heard of the send (`toISOString`). */
  readonly observedAt: string;
  readonly priced: boolean;
  readonly withMedia: boolean;
  /** The chat's own id where the site has one (Fansly's group); required by the sources that name their chat. */
  readonly conversationRef?: string;
  readonly composedWith?: SendAttributionComposedWith;
  readonly edited?: boolean;
  /** Seen only by its receipt: held for its human send (SEND_ATTRIBUTION_RECEIPT_HOLD_MS). */
  readonly receipt?: true;
}

export type SendAttributionOutcome =
  /** Owed now: it goes to the hub under the person signed in. */
  | 'queued'
  /** The same message of the same page is owed or answered already: nothing new. */
  | 'known'
  /** Not a fact the hub's schema takes (an id, a time): never owed. */
  | 'invalid'
  /** Nobody is signed in: there is nobody whose send it could be. */
  | 'signed-out';

export interface SendAttributionDeps {
  readonly clock: Pick<Clock, 'setTimer' | 'clearTimer' | 'now'>;
  readonly hub: Pick<HubFacade, 'sendAttributions'>;
  /** Who is signed in — `hubOrigin|userId`; null — nobody. */
  readonly owner: () => string | null;
  /** storage.local; omitted — memory only. */
  readonly store?: KeyValueStore;
  readonly log?: LogSink;
}

type SendFact = Omit<SendAttributionInput, 'receipt'>;
type HubFact = SendAttributionsRequest['facts'][number];

const isText = (value: unknown, max = 512): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;

/** The hub's fact of a send: its fields only, an absent one left out (the hub's body is strict). */
function hubFactOf(input: Omit<SendAttributionInput, 'pageLabel' | 'source'>): HubFact {
  const { platformMessageId, fanRef, observedAt, priced, withMedia, conversationRef, composedWith, edited } = input;
  return {
    platformMessageId,
    fanRef,
    observedAt,
    priced,
    withMedia,
    ...(conversationRef === undefined ? {} : { conversationRef }),
    ...(composedWith === undefined ? {} : { composedWith }),
    ...(edited === undefined ? {} : { edited }),
  };
}

export class SendAttributionReporter {
  private readonly reports: OwedReports<SendFact, HubFact>;
  private readonly log: LogSink;

  constructor(private readonly deps: SendAttributionDeps) {
    this.log = deps.log ?? NO_LOG;
    const spec: OwedReportSpec<SendFact, HubFact> = {
      storageKey: SEND_ATTRIBUTIONS_KEY,
      noun: 'send attribution',
      scope: 'bg.attribution',
      max: SEND_ATTRIBUTIONS_MAX,
      keepMs: SEND_ATTRIBUTION_KEEP_MS,
      batchMs: SEND_ATTRIBUTION_BATCH_MS,
      skewMs: SEND_ATTRIBUTION_SKEW_MS,
      maxFacts: SEND_ATTRIBUTION_LIMITS.maxFacts,
      outcomes: SEND_ATTRIBUTION_OUTCOMES,
      idOf: (fact) => fact.platformMessageId,
      isFact: (item) =>
        isText(item['platformMessageId'], 64) &&
        isText(item['fanRef'], 64) &&
        typeof item['priced'] === 'boolean' &&
        typeof item['withMedia'] === 'boolean' &&
        (item['conversationRef'] === undefined || isText(item['conversationRef'], 64)) &&
        (item['composedWith'] === undefined || (SEND_ATTRIBUTION_COMPOSED_WITH as readonly unknown[]).includes(item['composedWith'])) &&
        (item['edited'] === undefined || typeof item['edited'] === 'boolean'),
      hubFactOf,
      call: (pageLabel, source, facts) => deps.hub.sendAttributions({ pageLabel, source, facts }),
    };
    this.reports = new OwedReports(spec, { clock: deps.clock, owner: deps.owner, ...(deps.store === undefined ? {} : { store: deps.store }), log: this.log });
  }

  /** After the event page woke up: what the previous instance still owed goes under its sender's sign-in. */
  restore(): Promise<number> {
    return this.reports.restore();
  }

  /** One send of the person signed in now; the report goes after a short quiet, with the sends around it. */
  report(input: SendAttributionInput): SendAttributionOutcome {
    const owner = this.deps.owner();
    if (owner === null) return 'signed-out';
    if (!SendAttributionHubFactSchema.safeParse(hubFactOf(input)).success) {
      this.log.write({ level: 'warn', scope: 'bg.attribution', msg: 'send attribution not taken: not a fact the hub takes' });
      return 'invalid';
    }
    if (input.conversationRef === undefined && (SEND_ATTRIBUTION_CHAT_SOURCES as readonly string[]).includes(input.source)) {
      this.log.write({ level: 'warn', scope: 'bg.attribution', msg: 'send attribution not taken: its chat is not known', fields: { source: input.source } });
      return 'invalid';
    }
    const { receipt, ...fact } = input;
    // The human send of a message its receipt already gave: how its text was written replaces the receipt's `unknown`
    // while the receipt is held — under the person signed in when the receipt was taken.
    if (
      receipt !== true &&
      this.reports.release(
        (owed) => owed.pageLabel === input.pageLabel && owed.platformMessageId === input.platformMessageId,
        (owed) => ({ ...owed, ...fact, observedAt: owed.observedAt, owner: owed.owner, at: owed.at }),
      )
    )
      return 'queued';
    return this.reports.take(owner, fact, receipt === true ? SEND_ATTRIBUTION_RECEIPT_HOLD_MS : undefined);
  }

  /**
   * The hub was heard again (a bootstrap arrived), the same person signed in, the event page woke: everything owed by
   * the person signed in now and not on its way goes now. The number of groups started.
   */
  resume(): number {
    return this.reports.resume();
  }

  /** Facts the hub has not answered (diagnostics, tests). */
  get pending(): number {
    return this.reports.pending;
  }

  /** Resolves when every delivery started so far and every journal write settled (tests). */
  idle(): Promise<void> {
    return this.reports.idle();
  }
}
