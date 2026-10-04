// The dossier save of a full recap (architecture.md §7 «Recap: общий и
// досье», H-5, RB-018). On `done` of a full `fan-summary` the background asks
// `profileFromGeneration(generationRef)`: an idempotent server-side link
// write, never a new generation. `not-ready` repeats after 5 s, 15 s, 60 s,
// then every 3 minutes up to 30 minutes, while the owning tab is open. The
// end is «Сохранено в хаб» or CG-RECAP-SAVE. A transport failure is not
// repeated by itself. The latest recap of a chat owns the save: a newer one
// replaces the pending schedule of an older one.

import { HUB_FACADE_TIMING, type HubFacade } from '@cg/contracts/hub';
import { chatKeyOf, type ChatKey } from '@cg/contracts/ids';
import { type OpView } from '@cg/contracts/ops';
import { type BackgroundToast } from '@cg/contracts/tab-messages';

import { NO_LOG, type Clock, type IdSource, type LogSink, type TabEventSink, type TimerHandle } from './ports';

export interface ProfileSaverDeps {
  readonly clock: Clock;
  readonly ids: Pick<IdSource, 'uuid'>;
  readonly hub: Pick<HubFacade, 'profileFromGeneration'>;
  readonly events: TabEventSink;
  /** Whether the tab is still open (the schedule runs only while it is). */
  readonly tabOpen: (tabSessionId: string) => boolean;
  readonly log?: LogSink;
}

interface Pending {
  readonly opId: string;
  readonly tab: string;
  readonly startedAt: number;
  attempt: number;
  timer: TimerHandle | null;
}

export type SaveOutcome = 'saved' | 'failed' | 'gave-up' | 'tab-closed' | 'replaced';

/** Outcomes kept for outcome() (newest); older ones are dropped. */
export const SAVE_OUTCOMES_KEPT = 64;

/** The delay before attempt `n` (n ≥ 1 is the first repeat). */
export function profileSaveDelay(n: number): number {
  const fixed = HUB_FACADE_TIMING.profileSaveDelaysMs;
  return fixed[n - 1] ?? HUB_FACADE_TIMING.profileSaveThenEveryMs;
}

export class RecapProfileSaver {
  private readonly pending = new Map<ChatKey, Pending>();
  private readonly log: LogSink;
  private readonly outcomes = new Map<string, SaveOutcome>();

  constructor(private readonly deps: ProfileSaverDeps) {
    this.log = deps.log ?? NO_LOG;
  }

  /** A full recap finished; `tab` owns it (null — its tab closed: nothing is scheduled). */
  save(view: OpView, tab: string | null): void {
    if (view.feature !== 'recap' || view.state !== 'done' || view.generationRef === undefined || tab === null) return;
    const chat = chatKeyOf(view.target.chat);
    const older = this.pending.get(chat);
    if (older !== undefined) this.stop(chat, older, 'replaced');
    const entry: Pending = { opId: view.opId, tab, startedAt: this.deps.clock.now(), attempt: 0, timer: null };
    this.pending.set(chat, entry);
    void this.tryOnce(view, chat, entry);
  }

  outcome(opId: string): SaveOutcome | null {
    return this.outcomes.get(opId) ?? null;
  }

  get scheduled(): number {
    return this.pending.size;
  }

  private async tryOnce(view: OpView, chat: ChatKey, entry: Pending): Promise<void> {
    if (this.pending.get(chat) !== entry) return;
    if (!this.deps.tabOpen(entry.tab)) return this.stop(chat, entry, 'tab-closed');
    entry.attempt += 1;
    const ref = view.generationRef;
    if (ref === undefined) return this.stop(chat, entry, 'failed');
    let state: 'saved' | 'not-ready' | 'rejected' | 'error';
    try {
      const answer = await this.deps.hub.profileFromGeneration({
        pageLabel: view.target.binding.pageLabel,
        fanRef: view.target.fanRef,
        generationRef: ref,
        clientRequestId: view.opId,
      });
      state = answer.state;
    } catch {
      state = 'error';
    }
    if (this.pending.get(chat) !== entry) return;
    if (state === 'saved') {
      this.toast(entry, view, 'success');
      return this.stop(chat, entry, 'saved');
    }
    if (state !== 'not-ready') {
      this.toast(entry, view, 'error');
      return this.stop(chat, entry, 'failed');
    }
    const delay = profileSaveDelay(entry.attempt);
    if (this.deps.clock.now() + delay - entry.startedAt > HUB_FACADE_TIMING.profileSaveGiveUpMs) {
      this.toast(entry, view, 'error');
      return this.stop(chat, entry, 'gave-up');
    }
    entry.timer = this.deps.clock.setTimer(delay, () => {
      entry.timer = null;
      void this.tryOnce(view, chat, entry);
    });
  }

  private stop(chat: ChatKey, entry: Pending, outcome: SaveOutcome): void {
    if (entry.timer !== null) this.deps.clock.clearTimer(entry.timer);
    entry.timer = null;
    if (this.pending.get(chat) === entry) this.pending.delete(chat);
    this.outcomes.delete(entry.opId);
    this.outcomes.set(entry.opId, outcome);
    for (const opId of this.outcomes.keys()) {
      if (this.outcomes.size <= SAVE_OUTCOMES_KEPT) break;
      this.outcomes.delete(opId);
    }
    this.log.write({ level: outcome === 'saved' ? 'info' : 'warn', scope: 'bg.recap', msg: 'dossier save ended', fields: { outcome, attempts: entry.attempt }, ctx: { opId: entry.opId } });
  }

  private toast(entry: Pending, view: OpView, kind: 'success' | 'error'): void {
    const toast: BackgroundToast = {
      toastId: this.deps.ids.uuid(),
      kind,
      scope: 'recap.profile',
      opId: entry.opId,
      feature: 'recap',
      chat: view.target.chat,
      fanLabel: null,
      ...(kind === 'error' ? { code: 'CG-RECAP-SAVE' as const, error: { code: 'CG-RECAP-SAVE' as const } } : {}),
    };
    this.deps.events.emit(entry.tab, 'toast', { toast });
  }
}
