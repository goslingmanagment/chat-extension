// Who sent each message (decision X48; hub `clientSendAttributions`,
// capability `send-attribution-v1`). A person pressed the site's own Send, or
// «Отправить» of a preview, and the page's own response to exactly that send
// named the platform's message id: the background tells the hub this page,
// this message, this fan, when, with a price or media or neither. The person
// is the hub's — the user of the token — never a field of ours, so a fact is
// its sender's to deliver: it is kept with whoever was signed in when it was
// taken and goes only under their sign-in. No text of a message is ever here.
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
  type HubFailure,
  type SendAttributionsRequest,
  type SendAttributionsResult,
} from '@cg/contracts/hub';

import { REPORT_RETRY_DELAYS_MS, reportRetryable } from '../domain/send';
import { LOCAL_KEYS } from '../domain/storage';
import { NO_LOG, WriteQueue, type Clock, type KeyValueStore, type LogSink, type TimerHandle } from './ports';

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

interface Owed extends SendAttributionInput {
  readonly owner: string;
  /** When it was taken (local clock): its age. */
  readonly at: number;
  /** The hub found its time ahead of its clock once: sent again corrected, and final the next time. */
  readonly ahead?: true;
  /** A receipt's fact waits for its human send until then (local clock); absent — it goes with the next report. */
  readonly holdUntil?: number;
}

const keyOf = (owner: string, fact: Pick<SendAttributionInput, 'pageLabel' | 'platformMessageId'>): string => `${owner}|${fact.pageLabel}|${fact.platformMessageId}`;
const groupOf = (owed: Owed): string => `${owed.owner}|${owed.pageLabel}|${owed.source}`;

const isText = (value: unknown, max = 512): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;

function isOwed(value: unknown): value is Owed {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<Record<keyof Owed, unknown>>;
  return (
    isText(item.owner) &&
    isText(item.pageLabel, 128) &&
    isText(item.source, 64) &&
    isText(item.platformMessageId, 64) &&
    isText(item.fanRef, 64) &&
    isText(item.observedAt, 40) &&
    typeof item.priced === 'boolean' &&
    typeof item.withMedia === 'boolean' &&
    typeof item.at === 'number' &&
    Number.isFinite(item.at) &&
    (item.ahead === undefined || item.ahead === true) &&
    (item.holdUntil === undefined || (typeof item.holdUntil === 'number' && Number.isFinite(item.holdUntil))) &&
    (item.conversationRef === undefined || isText(item.conversationRef, 64)) &&
    (item.composedWith === undefined || (SEND_ATTRIBUTION_COMPOSED_WITH as readonly unknown[]).includes(item.composedWith)) &&
    (item.edited === undefined || typeof item.edited === 'boolean')
  );
}

/** The hub's answer of a failed call, or null — a refusal of the hub layer itself (no call was made). */
function failureOf(error: unknown): HubFailure | null {
  if (typeof error !== 'object' || error === null) return null;
  const failure = (error as { readonly name?: unknown; readonly failure?: unknown }).failure;
  return (error as { readonly name?: unknown }).name === 'HubCallError' && typeof failure === 'object' && failure !== null ? (failure as HubFailure) : null;
}

/** The hub's fact of a send: its fields only, an absent one left out (the hub's body is strict). */
function hubFactOf(input: Omit<SendAttributionInput, 'pageLabel' | 'source'>): SendAttributionsRequest['facts'][number] {
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
  /** What the hub has not answered yet, by `owner|page|message`, oldest first; journaled. */
  private readonly owed = new Map<string, Owed>();
  /** What the hub already answered while this event page lives: a late repeat asks nothing again. */
  private readonly answered = new Set<string>();
  /** Deliveries in flight, by `owner|page|source`. */
  private readonly running = new Map<string, Promise<void>>();
  private timer: TimerHandle | null = null;
  /** Wakes the report when the first held receipt's hold ends. */
  private holdTimer: { readonly handle: TimerHandle; readonly at: number } | null = null;
  /** The hub's clock less this browser's, as the last answer said; 0 — not known, or within SEND_ATTRIBUTION_SKEW_MS. */
  private skewMs = 0;
  private readonly writes = new WriteQueue();
  private readonly log: LogSink;

  constructor(private readonly deps: SendAttributionDeps) {
    this.log = deps.log ?? NO_LOG;
  }

  /** After the event page woke up: what the previous instance still owed goes under its sender's sign-in. */
  async restore(): Promise<number> {
    const store = this.deps.store;
    if (store === undefined) return 0;
    let raw: unknown;
    try {
      raw = await store.get(SEND_ATTRIBUTIONS_KEY);
    } catch {
      this.log.write({ level: 'warn', scope: 'bg.attribution', msg: 'owed send attributions unreadable, starting empty', code: 'CG-STORAGE-READ' });
      return 0;
    }
    const stored = typeof raw === 'object' && raw !== null && (raw as { v?: unknown }).v === 1 ? (raw as { owed?: unknown }).owed : undefined;
    if (!Array.isArray(stored)) return 0;
    const now = this.deps.clock.now();
    let dropped = 0;
    for (const item of stored.slice(-SEND_ATTRIBUTIONS_MAX)) {
      if (!isOwed(item) || now - item.at > SEND_ATTRIBUTION_KEEP_MS) dropped += 1;
      else if (!this.owed.has(keyOf(item.owner, item))) this.owed.set(keyOf(item.owner, item), item);
    }
    if (dropped > 0 || stored.length > SEND_ATTRIBUTIONS_MAX) this.save();
    if (this.owed.size > 0) this.log.write({ level: 'info', scope: 'bg.attribution', msg: 'owed send attributions restored', fields: { owed: this.owed.size, dropped } });
    this.resume();
    this.scheduleHold();
    return this.owed.size;
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
    const key = keyOf(owner, input);
    // The human send of a message its receipt already gave: how its text was written replaces the receipt's `unknown`
    // while the receipt is held — under the person signed in when the receipt was taken.
    const held = input.receipt === true ? undefined : [...this.owed.entries()].find(([, owed]) => owed.holdUntil !== undefined && owed.pageLabel === input.pageLabel && owed.platformMessageId === input.platformMessageId);
    if (held !== undefined) {
      const [heldKey, { holdUntil: _hold, ...owed }] = held;
      const { receipt: _receipt, ...told } = input;
      this.owed.set(heldKey, { ...owed, ...told, observedAt: owed.observedAt, owner: owed.owner, at: owed.at });
      this.save();
      this.schedule();
      return 'queued';
    }
    if (this.owed.has(key) || this.answered.has(key)) return 'known';
    const { receipt, ...fact } = input;
    const now = this.deps.clock.now();
    this.owed.set(key, { ...fact, owner, at: now, ...(receipt === true ? { holdUntil: now + SEND_ATTRIBUTION_RECEIPT_HOLD_MS } : {}) });
    while (this.owed.size > SEND_ATTRIBUTIONS_MAX) {
      const oldest = this.owed.keys().next().value;
      if (oldest === undefined || oldest === key) break;
      this.owed.delete(oldest);
      this.log.write({ level: 'warn', scope: 'bg.attribution', msg: 'owed send attribution given up: too many owed' });
    }
    this.save();
    if (receipt === true) this.scheduleHold();
    else this.schedule();
    return 'queued';
  }

  /**
   * The hub was heard again (a bootstrap arrived), the same person signed in, the event page woke: everything owed by
   * the person signed in now and not on its way goes now. The number of groups started.
   */
  resume(): number {
    if (this.timer !== null) {
      this.deps.clock.clearTimer(this.timer);
      this.timer = null;
    }
    const owner = this.deps.owner();
    if (owner === null) return 0;
    let started = 0;
    for (const group of new Set([...this.owed.values()].filter((owed) => owed.owner === owner).map(groupOf))) {
      if (this.running.has(group)) continue;
      this.start(group);
      started += 1;
    }
    return started;
  }

  /** Facts the hub has not answered (diagnostics, tests). */
  get pending(): number {
    return this.owed.size;
  }

  /** Resolves when every delivery started so far and every journal write settled (tests). */
  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.all([...this.running.values()]);
    await this.writes.idle();
  }

  private schedule(): void {
    if (this.timer !== null) return;
    this.timer = this.deps.clock.setTimer(SEND_ATTRIBUTION_BATCH_MS, () => {
      this.timer = null;
      this.resume();
    });
  }

  /** A wake-up for the first held receipt whose hold ends; it goes with the next report then. */
  private scheduleHold(): void {
    // A hold that ended already is no wake-up: such a fact goes with the next report like any other.
    const now = this.deps.clock.now();
    const holds = [...this.owed.values()].map((owed) => owed.holdUntil).filter((at): at is number => at !== undefined && at > now);
    if (holds.length === 0) return;
    const at = Math.min(...holds);
    if (this.holdTimer !== null && this.holdTimer.at <= at) return;
    if (this.holdTimer !== null) this.deps.clock.clearTimer(this.holdTimer.handle);
    const handle = this.deps.clock.setTimer(at - now, () => {
      this.holdTimer = null;
      this.resume();
      this.scheduleHold();
    });
    this.holdTimer = { handle, at };
  }

  private start(group: string): void {
    const run = this.deliver(group).finally(() => {
      this.running.delete(group);
    });
    this.running.set(group, run);
  }

  /** The facts of one person, page and client, a report at a time, while that person stays signed in. */
  private async deliver(group: string): Promise<void> {
    // The journal first: an event page unloaded before the hub answers leaves the facts to its successor.
    await this.writes.idle();
    for (;;) {
      const now = this.deps.clock.now();
      const batch = [...this.owed.values()].filter((owed) => groupOf(owed) === group && (owed.holdUntil === undefined || owed.holdUntil <= now)).slice(0, SEND_ATTRIBUTION_LIMITS.maxFacts);
      const first = batch[0];
      if (first === undefined) return;
      const request: SendAttributionsRequest = {
        pageLabel: first.pageLabel,
        source: first.source,
        facts: batch.map((owed) => hubFactOf({ ...owed, observedAt: this.corrected(owed.observedAt) })),
      };
      const outcome = await this.send(first.owner, request);
      if (outcome === 'owed') return;
      const hubNow = outcome.answer === null ? Number.NaN : Date.parse(outcome.answer.serverNow);
      batch.forEach((owed, index) => {
        const key = keyOf(owed.owner, owed);
        // Ahead of the hub's clock the first time: the skew is known now, and it goes once more, corrected.
        if (outcome.answer?.results[index]?.outcome === 'out_of_range' && owed.ahead !== true && Date.parse(request.facts[index]?.observedAt ?? '') > hubNow) {
          this.owed.set(key, { ...owed, ahead: true });
          return;
        }
        this.owed.delete(key);
        this.answered.add(key);
      });
      while (this.answered.size > SEND_ATTRIBUTIONS_MAX) this.answered.delete(this.answered.values().next().value ?? '');
      this.save();
    }
  }

  /** A time of this browser's clock as the hub's clock would say it (`toISOString`); as it is while no skew is known. */
  private corrected(observedAt: string): string {
    return this.skewMs === 0 ? observedAt : new Date(Date.parse(observedAt) + this.skewMs).toISOString();
  }

  /**
   * One report, retried while the hub may not have heard it: answered — final either way (`answer` null: refused),
   * `owed` — try later.
   */
  private async send(owner: string, request: SendAttributionsRequest): Promise<{ readonly answer: SendAttributionsResult | null } | 'owed'> {
    for (let i = 0; ; i += 1) {
      // Another person, or nobody: the facts are their sender's to report, and wait for their sign-in.
      if (this.deps.owner() !== owner) return 'owed';
      try {
        const answer = await this.deps.hub.sendAttributions(request);
        const skew = Date.parse(answer.serverNow) - this.deps.clock.now();
        if (Number.isFinite(skew)) this.skewMs = Math.abs(skew) > SEND_ATTRIBUTION_SKEW_MS ? skew : 0;
        const outcomes: Record<string, number> = {};
        for (const result of answer.results) {
          // An outcome this build does not know is final all the same; it is counted, never named.
          const name = (SEND_ATTRIBUTION_OUTCOMES as readonly string[]).includes(result.outcome) ? result.outcome : 'other';
          outcomes[name] = (outcomes[name] ?? 0) + 1;
        }
        const all = request.facts.length;
        const recorded = outcomes['recorded'] ?? 0;
        this.log.write({ level: recorded + (outcomes['duplicate'] ?? 0) === all ? 'info' : 'warn', scope: 'bg.attribution', msg: 'send attributions reported', fields: { facts: all, tries: i + 1, skewMs: this.skewMs, ...outcomes } });
        return { answer };
      } catch (error) {
        const failure = failureOf(error);
        // The sign-in ended under the call: nothing was refused.
        if (this.deps.owner() !== owner) return 'owed';
        // The hub layer refused before asking (no `send-attribution-v1` on this hub, the page not in this bootstrap):
        // nothing was said, the facts wait for a hub that takes them.
        if (failure === null) {
          this.log.write({ level: 'info', scope: 'bg.attribution', msg: 'send attributions held: the hub layer refused', fields: { facts: request.facts.length } });
          return 'owed';
        }
        // A token the hub did not take: the person signs in again and the facts go then.
        if (failure.kind === 'http' && failure.status === 401) return 'owed';
        if (!reportRetryable(failure)) {
          this.log.write({ level: 'warn', scope: 'bg.attribution', msg: 'send attributions refused by the hub, given up', fields: { facts: request.facts.length, status: failure.kind === 'http' ? failure.status : null } });
          return { answer: null };
        }
        const delay = REPORT_RETRY_DELAYS_MS[i];
        if (delay === undefined) return 'owed';
        await new Promise<void>((resolve) => this.deps.clock.setTimer(delay, resolve));
      }
    }
  }

  private save(): void {
    const store = this.deps.store;
    if (store === undefined) return;
    void this.writes
      .run(() => store.set(SEND_ATTRIBUTIONS_KEY, { v: 1, owed: [...this.owed.values()] }))
      .catch(() => this.log.write({ level: 'warn', scope: 'bg.attribution', msg: 'owed send attributions not saved', code: 'CG-STORAGE-WRITE' }));
  }
}
