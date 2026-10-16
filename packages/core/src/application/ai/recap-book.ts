// What the tab holds of recaps (architecture.md §7 «Recap: общий и досье»,
// §8.5; AI-061, AI-065…AI-068, AI-071, REC-01, UI-010). Recaps are shared
// artifacts of the hub (H-13): this book keeps their local copies (two
// slots per page, fan and persona), reads them (`recap.read`), knows the
// hub's status line (`recap.status`: metadata only, no AI spend), turns a
// recap generated in this tab into a copy, and follows the dossier save of
// a full recap (H-5): «сохранено в хаб» or CG-RECAP-SAVE, with the
// idempotent link write repeated by the §7 schedule while the tab is open.
// The strip (the «Recap готов» dot), the Recap sheet and the Coach header
// all read it, so it lives with the workspace, not with one controller.

import { type CgErrorWire } from '@cg/contracts/errors';
import { type RecapStatus } from '@cg/contracts/hub';
import { type ChatKey } from '@cg/contracts/ids';
import { UUID_PATTERN } from '@cg/contracts/primitives';
import { type RecapLength } from '@cg/contracts/vm';

import { RecapSlots, analysisMark, copiesOfShared, copyOfResult, saveAnswered, saveStarted, type RecapCopy, type RecapSaveState, type RecapSlotKey } from '../../domain/recap';
import { type OpRecord } from './op-store';
import { type AiPorts } from './ports';

/** The recap status of a chat is asked this long after the chat settled, and kept this long. */
export const RECAP_STATUS = { settleMs: 1_500, ttlMs: 10 * 60_000 } as const;
/** A read of the shared recaps is fresh for this long. */
export const SHARED_RECAPS_TTL_MS = 60_000;

/** The page, fan and persona a recap belongs to, with what the hub requests need. */
export interface RecapOwner {
  readonly key: RecapSlotKey;
  readonly chatKey: ChatKey;
}

export interface SharedRead {
  readonly state: 'loading' | 'ready' | 'error';
  readonly error: CgErrorWire | null;
  readonly at: number;
}

export interface RecapBookDeps {
  readonly ports: AiPorts;
  /** Something a view shows changed. */
  changed(): void;
  /** The chat that is open now (a status is not asked for a chat the person already left). */
  openChat(): ChatKey | null;
}

const idOf = (key: RecapSlotKey): string => [key.hubOrigin, key.pageId, key.fanRef, key.conversationRef, key.personaDefinitionId].join('\u0000');

/** What a request about the key names: the page, the fan and — R20 F6b, only when it is not the fan — the conversation. */
const asked = ({ pageId, fanRef, conversationRef }: RecapSlotKey): { readonly pageId: number; readonly fanRef: string; readonly conversationRef?: string } =>
  conversationRef === undefined ? { pageId, fanRef } : { pageId, fanRef, conversationRef };

export class RecapBook {
  readonly slots = new RecapSlots();
  private readonly reads = new Map<string, SharedRead>();
  /** `at` null — a read is on its way; `failed` — the last read failed (known as such until it expires or is retried). */
  private readonly statuses = new Map<string, { status: RecapStatus | null; at: number | null; failed: boolean }>();
  private readonly saves = new Map<string, RecapSaveState>();
  private readonly owners = new Map<string, RecapSlotKey>();
  private readonly timers = new Set<unknown>();
  private readonly saveTimers = new Map<string, unknown>();
  private readonly offToast: () => void;

  constructor(private readonly deps: RecapBookDeps) {
    // The background writes the dossier link of a full recap itself and says how it ended.
    this.offToast = deps.ports.rpc.onEvent('toast', ({ toast }) => {
      if (toast.scope !== 'recap.profile' || toast.opId === undefined) return;
      const copy = this.byOp(toast.opId);
      if (copy === null) return;
      if (toast.kind === 'success') this.markSaved(copy.id, new Date(deps.ports.clock.now()).toISOString());
      else this.setSave(copy.id, { s: 'failed', reason: 'error' });
    });
  }

  dispose(): void {
    this.offToast();
    const { clock } = this.deps.ports;
    for (const timer of [...this.timers, ...this.saveTimers.values()]) clock.clearTimer(timer);
    this.timers.clear();
    this.saveTimers.clear();
  }

  /** A sign-out drops everything; a new sign-in or persona reads again. */
  reset(everything: boolean): void {
    this.reads.clear();
    this.statuses.clear();
    if (!everything) return;
    this.slots.clear();
    this.saves.clear();
    this.owners.clear();
  }

  // ── copies ───────────────────────────────────────────────────────────────

  both(key: RecapSlotKey): { readonly short: RecapCopy | null; readonly full: RecapCopy | null } {
    return this.slots.both(key);
  }

  private remember(key: RecapSlotKey, copy: RecapCopy, keepStoredMark?: boolean): RecapCopy {
    const stored = this.slots.put(key, copy, keepStoredMark);
    this.owners.set(stored.id, key);
    // What the slots no longer hold (a newer recap took the slot, the oldest entries were evicted) keeps nothing here.
    for (const [id, owner] of this.owners) {
      if (this.slots.get(owner, 'full')?.id === id || this.slots.get(owner, 'short')?.id === id) continue;
      this.owners.delete(id);
      this.saves.delete(id);
      const timer = this.saveTimers.get(id);
      if (timer !== undefined) this.deps.ports.clock.clearTimer(timer);
      this.saveTimers.delete(id);
    }
    return stored;
  }

  private byOp(opId: string): RecapCopy | null {
    for (const key of this.owners.values()) {
      const { short, full } = this.slots.both(key);
      if (full?.opId === opId) return full;
      if (short?.opId === opId) return short;
    }
    return null;
  }

  /**
   * A recap finished in this tab: it is now the shared artifact, and the slot
   * holds its copy. A result whose persona this tab does not know (it was
   * adopted already finished — after a reload, or made before a persona
   * change) is never filed under the current persona: `recap.read` tells
   * what the hub holds for it.
   */
  generated(record: OpRecord, refreshOnly?: boolean): RecapCopy | null {
    const { view } = record;
    const { clock, ids, policy } = this.deps.ports;
    const { personaDefinitionId, fingerprint } = record.memo;
    if (personaDefinitionId === null) return null;
    // A completed asynchronous window check updates only an existing copy, preserving its handles and timestamps.
    const copy = refreshOnly ? this.byOp(view.opId) : copyOfResult(view, { newLocalId: () => ids.uuid(), now: clock.now() });
    if (!copy) return null;
    const { binding, fanRef, conversationRef } = view.target;
    const stored = this.remember({ hubOrigin: binding.hubOrigin, pageId: binding.pageId, fanRef, conversationRef: conversationRef === fanRef ? undefined : conversationRef, personaDefinitionId }, { ...copy, stale: analysisMark(policy.verdict(view, fingerprint)) }, false);
    // The background's saver is on it for the tab that owns the operation; its toast ends the wait.
    if (stored.length === 'full' && record.own && !this.saves.has(stored.id)) this.saves.set(stored.id, saveStarted(clock.now()));
    this.deps.changed();
    return stored;
  }

  // ── shared recaps (H-13) ─────────────────────────────────────────────────

  read(key: RecapSlotKey): SharedRead | null {
    return this.reads.get(idOf(key)) ?? null;
  }

  /** `recap.read`: the hub's two shared recaps become the two local copies. */
  loadShared(key: RecapSlotKey, force = false): void {
    const { clock, ids, rpc, policy } = this.deps.ports;
    const id = idOf(key);
    const known = this.reads.get(id);
    const now = clock.now();
    if (known !== undefined && (known.state === 'loading' || (!force && known.state === 'ready' && now - known.at < SHARED_RECAPS_TTL_MS))) return;
    this.reads.set(id, { state: 'loading', error: null, at: now });
    this.deps.changed();
    void rpc.request('recap.read', { ...asked(key), personaDefinitionId: key.personaDefinitionId }).then((answer) => {
      // The sign-in changed meanwhile: this answer belongs to nobody.
      if (this.reads.get(id)?.at !== now) return;
      if (!answer.ok) {
        this.reads.set(id, { state: 'error', error: answer.error, at: clock.now() });
        this.deps.changed();
        return;
      }
      const copies = copiesOfShared(answer.payload, { newLocalId: () => ids.uuid(), now: clock.now(), stale: policy.unverifiedAnalysisMark ?? null });
      for (const length of ['short', 'full'] as const) {
        const copy = copies[length];
        if (copy !== null) {
          const stored = this.remember(key, copy);
          // AI-068: a full recap the dossier does not hold yet is sent after — the link write only.
          if (length === 'full' && stored.savedToProfile === false && !this.saves.has(stored.id)) void this.save(key, stored);
          continue;
        }
        // A copy never outlives the shared artifact — except one this tab has just generated,
        // which the hub may not list yet.
        if (this.slots.get(key, length)?.source === 'hub') this.slots.drop(key, length);
      }
      this.reads.set(id, { state: 'ready', error: null, at: clock.now() });
      this.deps.changed();
    });
  }

  // ── the hub's status line (AI-061, UI-010) ───────────────────────────────

  /**
   * What the hub says about saved recaps of the open chat. Asked once the
   * chat stayed open for a moment — fast chat switching asks nothing — and
   * kept ten minutes. A failed read is kept as failed just as long: nothing
   * asks it again by itself; a new visit of the chat or an explicit action
   * (the Recap sheet, «Повторить») does (`retryFailedStatuses`). null — not
   * known (yet).
   */
  status(owner: RecapOwner): RecapStatus | null {
    const { clock } = this.deps.ports;
    const id = idOf(owner.key);
    const now = clock.now();
    const known = this.statuses.get(id);
    if (known !== undefined && (known.at === null || now - known.at < RECAP_STATUS.ttlMs)) return known.status;
    this.statuses.set(id, { status: known?.status ?? null, at: null, failed: false });
    const timer = clock.setTimer(RECAP_STATUS.settleMs, () => {
      this.timers.delete(timer);
      // Somebody read it meanwhile (a Coach turn deciding about its recap): that answer — or that failure — stands.
      if (this.statuses.get(id)?.at !== null) return;
      if (this.deps.openChat() !== owner.chatKey) {
        this.statuses.delete(id);
        return;
      }
      void this.readStatus(owner.key);
    });
    this.timers.add(timer);
    return known?.status ?? null;
  }

  /** Reads the status now (a Coach turn decides about its auto-recap). A failed read is remembered as failed. */
  async readStatus(key: RecapSlotKey): Promise<{ readonly ok: true; readonly status: RecapStatus } | { readonly ok: false }> {
    const { clock, rpc } = this.deps.ports;
    const id = idOf(key);
    const answer = await rpc.request('recap.status', { ...asked(key), personaDefinitionId: key.personaDefinitionId });
    this.statuses.set(id, answer.ok ? { status: answer.payload, at: clock.now(), failed: false } : { status: null, at: clock.now(), failed: true });
    this.deps.changed();
    return answer.ok ? { ok: true, status: answer.payload } : { ok: false };
  }

  /** A new visit of a chat, «Повторить», the Recap sheet: failed status reads may be asked again. */
  retryFailedStatuses(): void {
    for (const [id, known] of this.statuses) if (known.failed) this.statuses.delete(id);
  }

  /** UI-010: a recap of this chat can be opened at once. */
  hasAny(owner: RecapOwner, askHub: boolean): boolean {
    const { short, full } = this.slots.both(owner.key);
    if (short !== null || full !== null) return true;
    const status = askHub ? this.status(owner) : null;
    return status !== null && (status.full !== null || status.short !== null);
  }

  // ── the dossier save (H-5) ───────────────────────────────────────────────

  saveState(copy: RecapCopy): RecapSaveState {
    if (copy.length !== 'full') return { s: 'not-applicable' };
    const state = this.saves.get(copy.id);
    if (copy.savedToProfile === true) return { s: 'saved', at: state?.s === 'saved' ? state.at : null };
    // Nothing is known about the dossier of this copy (another tab generated it): the line is not shown.
    return state ?? { s: 'not-applicable' };
  }

  private setSave(id: string, state: RecapSaveState): void {
    this.saves.set(id, state);
    const timer = this.saveTimers.get(id);
    if (timer !== undefined) {
      this.deps.ports.clock.clearTimer(timer);
      this.saveTimers.delete(id);
    }
    this.deps.changed();
  }

  private markSaved(id: string, at: string | null): void {
    this.setSave(id, { s: 'saved', at });
    const key = this.owners.get(id);
    if (key !== undefined) this.slots.markSaved(key, id, true);
  }

  /**
   * One attempt of the idempotent link write (`recap.save`). `not-ready`
   * schedules the next attempt — 5 s, 15 s, 60 s, then every 3 minutes, at
   * most 30 minutes — for as long as the tab lives; a refusal or a
   * transport failure ends in CG-RECAP-SAVE and is not repeated by itself.
   */
  async save(key: RecapSlotKey, copy: RecapCopy, restart = false): Promise<RecapSaveState> {
    const { clock, rpc } = this.deps.ports;
    const id = copy.id;
    if (copy.length !== 'full') return { s: 'not-applicable' };
    if (!UUID_PATTERN.test(id)) {
      this.setSave(id, { s: 'failed', reason: 'rejected' });
      return { s: 'failed', reason: 'rejected' };
    }
    const current = restart ? undefined : this.saves.get(id);
    const state: RecapSaveState = current !== undefined && current.s === 'saving' ? { ...current, nextAt: null } : saveStarted(clock.now());
    this.setSave(id, state);
    const answer = await rpc.request('recap.save', { ...asked(key), generationRef: id, ...(copy.opId === null ? {} : { opId: copy.opId }) });
    const next = saveAnswered(state, answer.ok ? answer.payload.state : 'error', clock.now(), answer.ok ? answer.payload.savedAt : null);
    if (next.s === 'saved') this.markSaved(id, next.at);
    else this.setSave(id, next);
    if (next.s === 'saving' && next.nextAt !== null) {
      const timer = clock.setTimer(Math.max(0, next.nextAt - clock.now()), () => {
        this.saveTimers.delete(id);
        const latest = this.slots.get(key, 'full');
        // A newer recap took the slot: its own save is the one that matters now.
        if (latest !== null && latest.id === id) void this.save(key, latest);
      });
      this.saveTimers.set(id, timer);
    }
    return next;
  }

  /**
   * The port to the background came back: its own save schedule may be gone
   * with the event page. Every save still waiting for the background's word
   * is asked again from here — the write is idempotent, so a second one
   * changes nothing on the hub.
   */
  resume(): void {
    for (const [id, state] of this.saves) {
      if (state.s !== 'saving' || this.saveTimers.has(id)) continue;
      const key = this.owners.get(id);
      const copy = key === undefined ? null : this.slots.get(key, 'full');
      if (key === undefined || copy === null || copy.id !== id) continue;
      void this.save(key, copy, true);
    }
  }

  /** The copy of a length, for callers that only have the slot key. */
  get(key: RecapSlotKey, length: RecapLength): RecapCopy | null {
    return this.slots.get(key, length);
  }
}
