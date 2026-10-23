// The options page's autosave (architecture.md §9.4 «Страница настроек»;
// ST-013…ST-015): changes are merged into one patch and written one request
// at a time. A field the person types into waits 300 ms after the last
// change; a switch is written at once. «Сохранено ✓» exists only as the
// background's confirmation with its revision; a refusal or a lost answer is
// «не сохранено» with the patch kept for «Повторить» — nothing is resent by
// itself. On `pagehide` what still waits is sent at once, best effort: the
// browser does not promise an asynchronous write then.
//
// What rides along and what does not:
// - a patch that failed for a passing reason (the store did not answer, the
//   background was not reached) goes with the person's next change;
// - a patch the background refused for good (invalid, read-only, full) is
//   kept for «Повторить» only: a later, unrelated change is saved without it
//   and the refused one is dropped — it never blocks the saves after it;
// - the hub address goes alone (`writeAlone`): its own request, checked again
//   at the moment it is sent, and never kept after a refusal — so it can not
//   reach the background later inside another change (ST-042).

import { type CgErrorWire } from '@cg/contracts/errors';
import { type SettingsPatch, type SettingsState, type SettingsV1 } from '@cg/contracts/settings';

import { entryOf, normalizeCode } from '../../domain/errors';
import { applySettingsPatch, touchesRestricted } from '../../domain/settings';
import { type PageAnswer, type PageTimers } from './ports';

/** The pause after the last change of a typed field (§9.4). */
export const AUTOSAVE_DEBOUNCE_MS = 300;

export type WriteMode = 'now' | 'debounced';

export type WriteOutcome = { readonly ok: true; readonly revision: number } | { readonly ok: false; readonly error: CgErrorWire };

export type SaveStatus =
  | { readonly s: 'idle' }
  | { readonly s: 'saving' }
  | { readonly s: 'saved'; readonly revision: number }
  | { readonly s: 'failed'; readonly error: CgErrorWire };

type Fields = Readonly<Record<string, unknown>>;

/** Copies the fields `over` really carries on top of `base`; an absent or undefined field keeps the base's. */
function overlay<T extends Fields>(base: T | undefined, over: T | undefined): T | undefined {
  if (over === undefined) return base;
  const out: Record<string, unknown> = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(over)) if (value !== undefined) out[key] = value;
  return out as T;
}

function put<K extends keyof SettingsPatch>(target: { -readonly [P in keyof SettingsPatch]: SettingsPatch[P] }, key: K, value: SettingsPatch[K] | undefined): void {
  if (value !== undefined) target[key] = value;
}

/** `later` on top of `earlier`, field by field; maps merge by key (a `null` still removes), `mutedAccounts` is replaced whole. */
export function mergeSettingsPatch(earlier: SettingsPatch, later: SettingsPatch): SettingsPatch {
  const out: { -readonly [P in keyof SettingsPatch]: SettingsPatch[P] } = {};
  put(out, 'hub', overlay(earlier.hub, later.hub));
  put(out, 'ui', overlay(earlier.ui, later.ui));
  put(out, 'debug', overlay(earlier.debug, later.debug));
  put(out, 'onboarding', overlay(earlier.onboarding, later.onboarding));
  if (earlier.generation !== undefined || later.generation !== undefined) {
    const generation: { -readonly [P in keyof NonNullable<SettingsPatch['generation']>]: NonNullable<SettingsPatch['generation']>[P] } = {};
    const split = later.generation?.split ?? earlier.generation?.split;
    if (split !== undefined) generation.split = split;
    const rememberTone = later.generation?.rememberTone ?? earlier.generation?.rememberTone;
    if (rememberTone !== undefined) generation.rememberTone = rememberTone;
    const recap = later.generation?.recap ?? earlier.generation?.recap;
    if (recap !== undefined) generation.recap = recap;
    const recapBy = overlay(earlier.generation?.recapBy, later.generation?.recapBy);
    if (recapBy !== undefined) generation.recapBy = recapBy;
    const windows = overlay(earlier.generation?.windows, later.generation?.windows);
    if (windows !== undefined) generation.windows = windows;
    const coach = overlay(earlier.generation?.coach, later.generation?.coach);
    if (coach !== undefined) generation.coach = coach;
    out.generation = generation;
  }
  if (earlier.sound !== undefined || later.sound !== undefined) {
    const sound: { -readonly [P in keyof NonNullable<SettingsPatch['sound']>]: NonNullable<SettingsPatch['sound']>[P] } = {};
    const messages = overlay(earlier.sound?.messages, later.sound?.messages);
    if (messages !== undefined) sound.messages = messages;
    const subscribers = overlay(earlier.sound?.subscribers, later.sound?.subscribers);
    if (subscribers !== undefined) sound.subscribers = subscribers;
    const volume = later.sound?.volume ?? earlier.sound?.volume;
    if (volume !== undefined) sound.volume = volume;
    const muted = later.sound?.mutedAccounts ?? earlier.sound?.mutedAccounts;
    if (muted !== undefined) sound.mutedAccounts = muted;
    out.sound = sound;
  }
  if (earlier.personas !== undefined || later.personas !== undefined) {
    out.personas = { byPageId: { ...(earlier.personas?.byPageId ?? {}), ...(later.personas?.byPageId ?? {}) } };
  }
  if (earlier.accounts !== undefined || later.accounts !== undefined) {
    out.accounts = { labels: { ...(earlier.accounts?.labels ?? {}), ...(later.accounts?.labels ?? {}) } };
  }
  return out;
}

/** The confirmed settings with what is still being saved on top: what the page shows while a write runs. */
export function settingsWithPending(confirmed: SettingsV1, pending: SettingsPatch | null): SettingsV1 {
  if (pending === null) return confirmed;
  const outcome = applySettingsPatch(confirmed, pending, { restricted: true });
  return outcome.ok ? outcome.settings : confirmed;
}

export interface SettingsWriterDeps {
  /** `settings.patch`, or `settings.patchRestricted` when the patch names the hub address or debug. */
  readonly send: (patch: SettingsPatch, baseRevision: number | null, restricted: boolean) => Promise<PageAnswer<SettingsState>>;
  readonly timers: PageTimers;
  /** The background confirmed a write: the new state with its revision. */
  readonly onConfirmed: (state: SettingsState) => void;
  /** The save status or the pending patch changed. */
  readonly onChange: () => void;
}

type Waiter = (outcome: WriteOutcome) => void;

interface Failed {
  readonly patch: SettingsPatch;
  readonly error: CgErrorWire;
}

interface AloneJob {
  readonly patch: SettingsPatch;
  /** Asked when the request is about to be sent: an error refuses it there and then. */
  readonly admit: (() => CgErrorWire | null) | null;
  readonly resolve: Waiter;
}

/**
 * May a patch that failed with this error go along with the next change?
 * Only when the registry says a repeat can help (Appendix A «Повтор»: a click
 * or a read); a refusal that would come back the same («—», «никогда») stays
 * out of every later write.
 */
export function ridesAlong(error: CgErrorWire): boolean {
  const rule = entryOf(normalizeCode(error.code)).retry;
  return rule === 'new-click' || rule === 'safe-read' || rule === 'after-deadline';
}

export class SettingsWriter {
  private queued: SettingsPatch | null = null;
  private queuedWaiters: Waiter[] = [];
  private flying: SettingsPatch | null = null;
  private failed: Failed | null = null;
  private alone: AloneJob[] = [];
  private idle: (() => void)[] = [];
  private timer: unknown = null;
  private revision: number | null = null;
  private current: SaveStatus = { s: 'idle' };

  constructor(private readonly deps: SettingsWriterDeps) {}

  status(): SaveStatus {
    return this.current;
  }

  /** Everything not confirmed yet: the failed patch, the one in flight, the one waiting and the ones that go alone, in that order. */
  pending(): SettingsPatch | null {
    const parts = [this.failed?.patch ?? null, this.flying, this.queued, ...this.alone.map((job) => job.patch)].filter((part): part is SettingsPatch => part !== null);
    if (parts.length === 0) return null;
    return parts.reduce((merged, part) => mergeSettingsPatch(merged, part));
  }

  /** The revision of the last state the page has seen (a read, a confirmed write or `settings.changed`). */
  adoptRevision(revision: number): void {
    if (this.revision === null || revision > this.revision) this.revision = revision;
  }

  /**
   * Queues a change. `debounced` waits AUTOSAVE_DEBOUNCE_MS after the last
   * change, `now` goes as soon as the request in flight is answered. The
   * promise settles with the answer to the request that carried the change.
   */
  write(patch: SettingsPatch, mode: WriteMode): Promise<WriteOutcome> {
    // A patch that failed for a passing reason rides along: the person's newer choice goes on top of it.
    // One the background refused for good is dropped here — it was shown as «не сохранено» and is not sent again.
    const carried = this.failed !== null && ridesAlong(this.failed.error) ? this.failed.patch : null;
    this.failed = null;
    if (carried !== null) this.queued = mergeSettingsPatch(carried, this.queued ?? {});
    return this.add(patch, mode);
  }

  /**
   * A change that goes by itself (the hub address): its own request behind
   * the one in flight, never merged into another, `admit` asked when it is
   * sent, and nothing kept after a refusal — the person saves it again.
   */
  writeAlone(patch: SettingsPatch, admit: (() => CgErrorWire | null) | null = null): Promise<WriteOutcome> {
    const promise = new Promise<WriteOutcome>((resolve) => this.alone.push({ patch, admit, resolve }));
    this.deps.onChange();
    this.pump();
    return promise;
  }

  /** `pagehide`: what waits for its pause goes now, best effort. */
  flush(): void {
    if (this.timer === null) return;
    this.deps.timers.clear(this.timer);
    this.timer = null;
    this.pump();
  }

  /** Resolves once nothing is in flight and nothing waits (a pause still running counts as waiting: `flush` first). */
  settled(): Promise<void> {
    if (!this.busy()) return Promise.resolve();
    return new Promise<void>((resolve) => this.idle.push(resolve));
  }

  /** «Повторить» (ST-015): the patch that was not saved, once more — by this click only. */
  retry(): Promise<WriteOutcome> | null {
    if (this.failed === null) return null;
    const { patch } = this.failed;
    this.failed = null;
    this.queued = mergeSettingsPatch(patch, this.queued ?? {});
    return this.add({}, 'now');
  }

  dispose(): void {
    if (this.timer !== null) this.deps.timers.clear(this.timer);
    this.timer = null;
    for (const waiter of this.idle.splice(0)) waiter();
  }

  private busy(): boolean {
    return this.flying !== null || this.queued !== null || this.alone.length > 0;
  }

  private add(patch: SettingsPatch, mode: WriteMode): Promise<WriteOutcome> {
    this.queued = mergeSettingsPatch(this.queued ?? {}, patch);
    const promise = new Promise<WriteOutcome>((resolve) => this.queuedWaiters.push(resolve));
    this.setStatus({ s: 'saving' });
    if (this.timer !== null) this.deps.timers.clear(this.timer);
    this.timer = null;
    if (mode === 'now') this.pump();
    else {
      this.timer = this.deps.timers.set(() => {
        this.timer = null;
        this.pump();
      }, AUTOSAVE_DEBOUNCE_MS);
    }
    return promise;
  }

  private setStatus(next: SaveStatus): void {
    this.current = next;
    this.deps.onChange();
  }

  /** One request: the answer adopted when it confirms, a lost one named CG-RUNTIME-UNREACHABLE. */
  private send(patch: SettingsPatch, done: (outcome: WriteOutcome) => void): void {
    this.flying = patch;
    this.deps.send(patch, this.revision, touchesRestricted(patch)).then(
      (answer) => {
        if (!answer.ok) {
          done({ ok: false, error: answer.error });
          return;
        }
        this.adoptRevision(answer.payload.revision);
        this.deps.onConfirmed(answer.payload);
        done({ ok: true, revision: answer.payload.revision });
      },
      () => done({ ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE' } }),
    );
  }

  /** After an answer: the next request if one waits, and whoever waits for the writer to be done. */
  private next(): void {
    this.pump();
    if (!this.busy()) for (const waiter of this.idle.splice(0)) waiter();
  }

  private pump(): void {
    if (this.flying !== null) return;
    const job = this.alone.shift();
    if (job !== undefined) {
      const refusal = job.admit?.() ?? null;
      if (refusal !== null) {
        job.resolve({ ok: false, error: refusal });
        this.deps.onChange();
        this.next();
        return;
      }
      this.send(job.patch, (outcome) => {
        this.flying = null;
        // Nothing is kept for «Повторить» and nothing rides along: a refused address is saved again by the person.
        job.resolve(outcome);
        this.deps.onChange();
        this.next();
      });
      return;
    }
    // A typed change still waits for its pause.
    if (this.queued === null || this.timer !== null) return;
    const patch = this.queued;
    const waiters = this.queuedWaiters;
    this.queued = null;
    this.queuedWaiters = [];
    this.send(patch, (outcome) => {
      this.flying = null;
      if (!outcome.ok && this.queued !== null && ridesAlong(outcome.error)) {
        // A newer change waits behind the one that failed: it carries that patch along and answers for both.
        this.queued = mergeSettingsPatch(patch, this.queued);
        this.queuedWaiters = [...waiters, ...this.queuedWaiters];
      } else {
        // Kept for «Повторить» (ST-015) unless a newer change already waits: then a patch refused for good is dropped.
        if (!outcome.ok && this.queued === null) this.failed = { patch, error: outcome.error };
        for (const waiter of waiters) waiter(outcome);
      }
      if (this.queued === null) this.current = outcome.ok ? { s: 'saved', revision: outcome.revision } : { s: 'failed', error: outcome.error };
      this.deps.onChange();
      this.next();
    });
  }
}
