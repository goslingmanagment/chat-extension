// What the hub is owed: facts the background reports to the hub under the
// person signed in, journaled until the hub answers them. The engine of the
// who-sent (send-attribution.ts) and who-wrote-the-note (note-attribution.ts)
// reports; each says what its fact is and how the hub is asked.
//
// A report of what already happened, never a write of its own. Every answer
// of the hub is final (`recorded`, `duplicate`, `conflict`, `out_of_range`):
// a fact the hub answered is never said again, and a repeat of a lost answer
// reads `duplicate` there. So what the hub has not answered is OWED:
// journaled (storage.local, ids only) before the first call, delivered again
// by the next instance of the event page, after a sign-in of the same person,
// and whenever the hub is heard again (`resume`). A fact is its person's to
// deliver: it is kept with whoever was signed in when it was taken and goes
// only under their sign-in. Within one run a failure the hub may not repeat
// (the network, a 5xx, a 429) is retried on the custody report's schedule; a
// refusal of the hub layer itself (no capability on this hub — a rollback,
// the page not granted by this bootstrap) or a lost sign-in leaves the fact
// owed for the next such moment. Another answer of the hub (a 4xx) is final:
// those facts are given up and logged.
//
// Facts of one person, page and client go together, at most `maxFacts` a
// request, after `batchMs` of quiet: a burst is one request. A fact nobody
// could deliver for `keepMs` is given up (the hub takes 30 days at most), and
// beyond `max` the oldest go.
//
// The time is this browser's clock, and the hub takes nothing more than
// 5 minutes ahead of its own. Every answer carries the hub's clock: a skew of
// more than `skewMs` is learned from it and corrects every time sent after,
// and a fact the hub found ahead of its clock is sent once more, corrected —
// a computer whose clock runs fast must not lose every fact of its person.
//
// A fact may be held (`holdUntil`): taken and journaled at once, it goes only
// after its hold, or when its report releases it earlier.

import type { HubFailure } from '@cg/contracts/hub';

import { REPORT_RETRY_DELAYS_MS, reportRetryable } from '../domain/send';
import { NO_LOG, WriteQueue, type Clock, type KeyValueStore, type LogSink, type TimerHandle } from './ports';

/** What every owed fact carries: the page and client it is reported for, and when it happened (`toISOString`). */
export interface OwedFact {
  readonly pageLabel: string;
  readonly source: string;
  readonly observedAt: string;
}

export type Owed<F extends OwedFact> = F & {
  readonly owner: string;
  /** When it was taken (local clock): its age. */
  readonly at: number;
  /** The hub found its time ahead of its clock once: sent again corrected, and final the next time. */
  readonly ahead?: true;
  /** Waits until then (local clock) before it goes; absent — it goes with the next report. */
  readonly holdUntil?: number;
};

/** The hub's answer of one report: an outcome per fact, in the order of the request, and its clock. */
export interface OwedAnswer {
  readonly results: readonly { readonly outcome: string }[];
  readonly serverNow: string;
}

export interface OwedReportSpec<F extends OwedFact, H extends { readonly observedAt: string }> {
  /** storage.local key of the journal. */
  readonly storageKey: string;
  /** What a fact is called in the log (`send attribution`); the plural adds an `s`. */
  readonly noun: string;
  readonly scope: string;
  /** Facts kept at most; beyond it the oldest go. */
  readonly max: number;
  /** A fact nobody could deliver for this long is given up. */
  readonly keepMs: number;
  /** How long a new fact waits for the next ones before its report goes. */
  readonly batchMs: number;
  /** A difference from the hub's clock above this corrects the times sent; below it the browser's clock stands. */
  readonly skewMs: number;
  /** Facts in one request. */
  readonly maxFacts: number;
  /** The outcomes the hub names; another is counted as `other`. */
  readonly outcomes: readonly string[];
  /** The fact's own id within its page: one fact per person, page and id. */
  idOf(fact: F): string;
  /** A journal entry's own fields (beyond page, client, time, owner and age) as this build takes them. */
  isFact(item: Readonly<Record<string, unknown>>): boolean;
  /** The hub's fact: its fields only. */
  hubFactOf(fact: F): H;
  /** One report to the hub. */
  call(pageLabel: string, source: string, facts: H[]): Promise<OwedAnswer>;
}

export interface OwedReportDeps {
  readonly clock: Pick<Clock, 'setTimer' | 'clearTimer' | 'now'>;
  /** Who is signed in — `hubOrigin|userId`; null — nobody. */
  readonly owner: () => string | null;
  /** storage.local; omitted — memory only. */
  readonly store?: KeyValueStore;
  readonly log?: LogSink;
}

const isText = (value: unknown, max = 512): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;

/** The hub's answer of a failed call, or null — a refusal of the hub layer itself (no call was made). */
function failureOf(error: unknown): HubFailure | null {
  if (typeof error !== 'object' || error === null) return null;
  const failure = (error as { readonly name?: unknown; readonly failure?: unknown }).failure;
  return (error as { readonly name?: unknown }).name === 'HubCallError' && typeof failure === 'object' && failure !== null ? (failure as HubFailure) : null;
}

export class OwedReports<F extends OwedFact, H extends { readonly observedAt: string }> {
  /** What the hub has not answered yet, by `owner|page|id`, oldest first; journaled. */
  private readonly owed = new Map<string, Owed<F>>();
  /** What the hub already answered while this event page lives: a late repeat asks nothing again. */
  private readonly answered = new Set<string>();
  /** Deliveries in flight, by `owner|page|source`. */
  private readonly running = new Map<string, Promise<void>>();
  private timer: TimerHandle | null = null;
  /** Wakes the report when the first held fact's hold ends. */
  private holdTimer: { readonly handle: TimerHandle; readonly at: number } | null = null;
  /** The hub's clock less this browser's, as the last answer said; 0 — not known, or within `skewMs`. */
  private skewMs = 0;
  private readonly writes = new WriteQueue();
  private readonly log: LogSink;

  constructor(private readonly spec: OwedReportSpec<F, H>, private readonly deps: OwedReportDeps) {
    this.log = deps.log ?? NO_LOG;
  }

  private keyOf(owner: string, fact: F): string {
    return `${owner}|${fact.pageLabel}|${this.spec.idOf(fact)}`;
  }

  private groupOf(owed: Owed<F>): string {
    return `${owed.owner}|${owed.pageLabel}|${owed.source}`;
  }

  private isOwed(value: unknown): value is Owed<F> {
    if (typeof value !== 'object' || value === null) return false;
    const item = value as Readonly<Record<string, unknown>>;
    return (
      isText(item['owner']) &&
      isText(item['pageLabel'], 128) &&
      isText(item['source'], 64) &&
      isText(item['observedAt'], 40) &&
      typeof item['at'] === 'number' &&
      Number.isFinite(item['at']) &&
      (item['ahead'] === undefined || item['ahead'] === true) &&
      (item['holdUntil'] === undefined || (typeof item['holdUntil'] === 'number' && Number.isFinite(item['holdUntil']))) &&
      this.spec.isFact(item)
    );
  }

  /** After the event page woke up: what the previous instance still owed goes under its person's sign-in. */
  async restore(): Promise<number> {
    const { spec } = this;
    const store = this.deps.store;
    if (store === undefined) return 0;
    let raw: unknown;
    try {
      raw = await store.get(spec.storageKey);
    } catch {
      this.log.write({ level: 'warn', scope: spec.scope, msg: `owed ${spec.noun}s unreadable, starting empty`, code: 'CG-STORAGE-READ' });
      return 0;
    }
    const stored = typeof raw === 'object' && raw !== null && (raw as { v?: unknown }).v === 1 ? (raw as { owed?: unknown }).owed : undefined;
    if (!Array.isArray(stored)) return 0;
    const now = this.deps.clock.now();
    let dropped = 0;
    for (const item of stored.slice(-spec.max)) {
      if (!this.isOwed(item) || now - item.at > spec.keepMs) dropped += 1;
      else if (!this.owed.has(this.keyOf(item.owner, item))) this.owed.set(this.keyOf(item.owner, item), item);
    }
    if (dropped > 0 || stored.length > spec.max) this.save();
    if (this.owed.size > 0) this.log.write({ level: 'info', scope: spec.scope, msg: `owed ${spec.noun}s restored`, fields: { owed: this.owed.size, dropped } });
    this.resume();
    this.scheduleHold();
    return this.owed.size;
  }

  /** A fact of `owner`, checked by the caller: owed now, or `known` — the same id of the same page is owed or answered already. */
  take(owner: string, fact: F, holdMs?: number): 'queued' | 'known' {
    const key = this.keyOf(owner, fact);
    if (this.owed.has(key) || this.answered.has(key)) return 'known';
    const now = this.deps.clock.now();
    this.owed.set(key, { ...fact, owner, at: now, ...(holdMs === undefined ? {} : { holdUntil: now + holdMs }) });
    while (this.owed.size > this.spec.max) {
      const oldest = this.owed.keys().next().value;
      if (oldest === undefined || oldest === key) break;
      this.owed.delete(oldest);
      this.log.write({ level: 'warn', scope: this.spec.scope, msg: `owed ${this.spec.noun} given up: too many owed` });
    }
    this.save();
    if (holdMs === undefined) this.schedule();
    else this.scheduleHold();
    return 'queued';
  }

  /**
   * The first held fact `match` finds, whoever's it is, goes with the next report as `merge` makes it (its hold ended);
   * false — none is held.
   */
  release(match: (owed: Owed<F>) => boolean, merge: (owed: Owed<F>) => Owed<F>): boolean {
    const held = [...this.owed.entries()].find(([, owed]) => owed.holdUntil !== undefined && match(owed));
    if (held === undefined) return false;
    const [key, { holdUntil: _hold, ...owed }] = held;
    this.owed.set(key, merge(owed as Owed<F>));
    this.save();
    this.schedule();
    return true;
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
    for (const group of new Set([...this.owed.values()].filter((owed) => owed.owner === owner).map((owed) => this.groupOf(owed)))) {
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
    this.timer = this.deps.clock.setTimer(this.spec.batchMs, () => {
      this.timer = null;
      this.resume();
    });
  }

  /** A wake-up for the first held fact whose hold ends; it goes with the next report then. */
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
      const batch = [...this.owed.values()].filter((owed) => this.groupOf(owed) === group && (owed.holdUntil === undefined || owed.holdUntil <= now)).slice(0, this.spec.maxFacts);
      const first = batch[0];
      if (first === undefined) return;
      const facts = batch.map((owed) => this.spec.hubFactOf({ ...owed, observedAt: this.corrected(owed.observedAt) }));
      const outcome = await this.send(first, facts);
      if (outcome === 'owed') return;
      const hubNow = outcome.answer === null ? Number.NaN : Date.parse(outcome.answer.serverNow);
      batch.forEach((owed, index) => {
        const key = this.keyOf(owed.owner, owed);
        // Ahead of the hub's clock the first time: the skew is known now, and it goes once more, corrected.
        if (outcome.answer?.results[index]?.outcome === 'out_of_range' && owed.ahead !== true && Date.parse(facts[index]?.observedAt ?? '') > hubNow) {
          this.owed.set(key, { ...owed, ahead: true });
          return;
        }
        this.owed.delete(key);
        this.answered.add(key);
      });
      while (this.answered.size > this.spec.max) this.answered.delete(this.answered.values().next().value ?? '');
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
  private async send(first: Owed<F>, facts: H[]): Promise<{ readonly answer: OwedAnswer | null } | 'owed'> {
    const { spec } = this;
    const { owner } = first;
    for (let i = 0; ; i += 1) {
      // Another person, or nobody: the facts are their person's to report, and wait for their sign-in.
      if (this.deps.owner() !== owner) return 'owed';
      try {
        const answer = await spec.call(first.pageLabel, first.source, facts);
        const skew = Date.parse(answer.serverNow) - this.deps.clock.now();
        if (Number.isFinite(skew)) this.skewMs = Math.abs(skew) > spec.skewMs ? skew : 0;
        const outcomes: Record<string, number> = {};
        for (const result of answer.results) {
          // An outcome this build does not know is final all the same; it is counted, never named.
          const name = spec.outcomes.includes(result.outcome) ? result.outcome : 'other';
          outcomes[name] = (outcomes[name] ?? 0) + 1;
        }
        const all = facts.length;
        const recorded = outcomes['recorded'] ?? 0;
        this.log.write({ level: recorded + (outcomes['duplicate'] ?? 0) === all ? 'info' : 'warn', scope: spec.scope, msg: `${spec.noun}s reported`, fields: { facts: all, tries: i + 1, skewMs: this.skewMs, ...outcomes } });
        return { answer };
      } catch (error) {
        const failure = failureOf(error);
        // The sign-in ended under the call: nothing was refused.
        if (this.deps.owner() !== owner) return 'owed';
        // The hub layer refused before asking (no capability on this hub, the page not in this bootstrap): nothing was
        // said, the facts wait for a hub that takes them.
        if (failure === null) {
          this.log.write({ level: 'info', scope: spec.scope, msg: `${spec.noun}s held: the hub layer refused`, fields: { facts: facts.length } });
          return 'owed';
        }
        // A token the hub did not take: the person signs in again and the facts go then.
        if (failure.kind === 'http' && failure.status === 401) return 'owed';
        if (!reportRetryable(failure)) {
          this.log.write({ level: 'warn', scope: spec.scope, msg: `${spec.noun}s refused by the hub, given up`, fields: { facts: facts.length, status: failure.kind === 'http' ? failure.status : null } });
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
    const { storageKey, scope, noun } = this.spec;
    void this.writes
      .run(() => store.set(storageKey, { v: 1, owed: [...this.owed.values()] }))
      .catch(() => this.log.write({ level: 'warn', scope, msg: `owed ${noun}s not saved`, code: 'CG-STORAGE-WRITE' }));
  }
}
