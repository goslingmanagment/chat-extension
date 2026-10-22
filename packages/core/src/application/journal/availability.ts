// What our surfaces offer the person right now, as one flat map per surface (2026-10-21, «Скачать лог»): every
// button or function that can be on or off — and when it is off, why: the reason's id, its CG code and the sentence
// the person reads in its tooltip (`say`). The chatter's log keeps the CHANGES of these maps (watch.ts), so the file
// says «Hi — недоступен: …» once, when it went off, and once again when it came back.
//
// Pure: the view models in, the map out; the sentence is made by the caller's translator. A state that only passes
// (a generation of this chat runs, a part is on its way) is no decision: such an entry is left out, and the watcher
// keeps what it had before it.

import { type CgErrorView } from '@cg/contracts/errors';
import {
  DOCK_ACTION_IDS,
  type ActionButtonVM,
  type DockActionVM,
  type DockVM,
  type Msg,
  type NewcomersVM,
  type PartVM,
  type PreviewVM,
  type ReasonVM,
  type SpendersBoardVM,
  type VmView,
} from '@cg/contracts/vm';

/** One function's state: on, or off with why. */
export interface Availability {
  readonly on: boolean;
  /** Off: the reason's id (`hi-gate`, `feature-disabled`) or the state's word (`not-signed-in`, `dm-closed`). */
  readonly why: string | null;
  /** A CG code, or a site's own code of a list (`NewcomersFailureVM.code`). */
  readonly code: string | null;
  /** The sentence the person reads, in the tab's language. */
  readonly say: string | null;
}

export type AvailabilityMap = ReadonlyMap<string, Availability>;
/** The tab's translator of a catalog message. */
export type Say = (message: Msg) => string;

export const AVAILABLE: Availability = { on: true, why: null, code: null, say: null };

/**
 * Reasons that only pass, or that every message passes through: a generation of this chat runs, Tone and Split wait
 * for it, a part is on its way; Fix waits for a draft in the field (it comes and goes with every message typed and
 * sent). A click on such a button still says why (`pressed while off`).
 */
export const PASSING_REASONS: ReadonlySet<string> = new Set(['chat-busy', 'coach-busy', 'locked-during-generation', 'parts-sending', 'needs-draft']);

export function off(why: string, code: string | null, say: string | null): Availability {
  return { on: false, why, code, say };
}

function ofReason(reason: ReasonVM | null, say: Say): Availability | null {
  if (reason === null) return off('unknown', null, null);
  if (PASSING_REASONS.has(reason.id)) return null;
  return off(reason.id, reason.code, say(reason.text));
}

function ofError(why: string, error: CgErrorView | null | undefined): Availability {
  return off(why, error?.code ?? null, error?.title ?? null);
}

function ofButton(button: Pick<DockActionVM | ActionButtonVM, 'enabled' | 'reason'>, say: Say): Availability | null {
  return button.enabled ? AVAILABLE : ofReason(button.reason, say);
}

/** A view's own state: shown, or refused as a whole (no sign-in, no binding, the hub is down). */
function ofView(view: VmView): Availability | null {
  if (view.s === 'loading') return null;
  if (view.s === 'error' || view.s === 'forbidden' || view.s === 'offline') return ofError(view.s, view.error);
  return AVAILABLE;
}

export class Collect {
  readonly map = new Map<string, Availability>();
  set(key: string, value: Availability | null): void {
    if (value !== null) this.map.set(key, value);
  }
}

/** The first part that is held back, or null when every part may go. */
function firstBlocked(parts: readonly PartVM[], pick: (part: PartVM) => ReasonVM | null): ReasonVM | null {
  for (const part of parts) {
    const reason = pick(part);
    if (reason !== null) return reason;
  }
  return null;
}

function resultParts(vm: { readonly result: DockVM['result'] }): readonly PartVM[] {
  const result = vm.result;
  if (result === null) return [];
  return [...(result.parts ?? []), ...(result.variants ?? []).flatMap((variant) => variant.parts)];
}

/** The dock of the open chat: its status, the page's line, insert or copy, every chip, Tone and Split, the result's own buttons. */
export function dockAvailability(vm: DockVM, say: Say): AvailabilityMap | null {
  // No chat, or the chat is still loading: nothing is decided yet.
  if (!vm.visible || vm.status === 'loading-chat') return null;
  const out = new Collect();
  out.set('dock', vm.status === 'ready' ? AVAILABLE : ofError(vm.status, vm.statusError));
  out.set('page', vm.notice === undefined || vm.notice === null ? AVAILABLE : ofError('page-off', vm.notice));
  out.set('insert', vm.mode === 'insert' ? AVAILABLE : ofError('copy-only', vm.statusError));
  for (const id of DOCK_ACTION_IDS) out.set(id, ofButton(vm.actions[id], say));
  for (const chip of vm.chips ?? []) if (!(DOCK_ACTION_IDS as readonly string[]).includes(chip.id)) out.set(chip.id, ofButton(chip, say));
  out.set('tone', vm.options.toneReason === null ? AVAILABLE : ofReason(vm.options.toneReason, say));
  out.set('split', vm.options.splitReason === null ? AVAILABLE : ofReason(vm.options.splitReason, say));
  const result = vm.result;
  if (result !== null && result.state === 'done') {
    const parts = resultParts(vm);
    const blocked = firstBlocked(parts, (part) => part.insertBlocked);
    out.set('insert-part', blocked === null ? AVAILABLE : ofReason(blocked, say));
    if (result.fix !== undefined && result.fix !== null) out.set('fix-replace', result.fix.canReplace ? AVAILABLE : ofReason(result.fix.replaceReason ?? null, say));
    out.set('again', result.canRegenerate ? AVAILABLE : ofReason(result.regenerateReason ?? null, say));
  }
  return out.map;
}

/** «Отправить» of a part of a preview: on, a held warning, or off with its code; null — on its way (no decision). */
function ofSend(part: PartVM, say: Say): Availability | null {
  const send = part.send;
  if (send === undefined) return null;
  switch (send.s) {
    case 'available':
      return AVAILABLE;
    case 'unavailable':
      return off('unavailable', send.code, say(send.reason));
    case 'held-stale':
      return off('held-stale', 'CG-SEND-FRESHNESS', null);
    case 'unverified':
      return off('unverified', null, null);
    case 'rejected':
      return off('rejected', send.code, null);
    case 'uncertain':
      return off('uncertain', 'CG-SEND-UNCERTAIN', null);
    case 'queued':
    case 'sending':
    case 'accepted':
    case 'sent':
      return null;
  }
}

/** A preview (Spenders, «Новые», the palette's online fan): its view, its mini strip, the draft's and the parts' «Отправить», the lease. */
export function previewAvailability(vm: PreviewVM, say: Say): AvailabilityMap | null {
  if (vm.handle === null) return null;
  const out = new Collect();
  out.set('view', ofView(vm.view));
  for (const [id, action] of Object.entries(vm.bar.actions)) if (action !== undefined) out.set(id, ofButton(action, say));
  out.set('open-chat', ofButton(vm.openChat, say));
  if (vm.draft.send !== undefined) out.set('send-draft', ofButton(vm.draft.send, say));
  const parts = resultParts(vm);
  if (vm.result !== null && vm.result.state === 'done' && parts.length > 0) {
    // One entry for the result's «Отправить»: the first part that is not on says why the result cannot go now.
    let send: Availability | null = AVAILABLE;
    for (const part of parts) {
      const state = ofSend(part, say);
      if (state === null) {
        send = null;
        break;
      }
      if (!state.on) {
        send = state;
        break;
      }
    }
    out.set('send', send);
    const insert = parts.find((part) => part.openInsert?.s === 'unavailable')?.openInsert;
    out.set('open-insert', insert !== undefined && insert.s === 'unavailable' ? ofReason(insert.reason, say) : AVAILABLE);
  }
  const claim = vm.claim;
  if (claim !== null) {
    if (claim.s === 'none' || claim.s === 'mine') out.set('claim', AVAILABLE);
    else out.set('claim', ofError(claim.s, claim.error));
  }
  if (vm.media !== null) out.set('media', vm.media.blocked === null ? AVAILABLE : off('media', 'CG-SEND-MEDIA', say(vm.media.blocked)));
  return out.map;
}

/** Row states of «Новые» that let the person greet the fan. */
const ROW_OPEN: ReadonlySet<string> = new Set(['none', 'sending-other', 'replied', 'ready', 'pending', 'checking', 'unverified', 'reply']);

/** «Новые»: the list's own state, every row's (who can be greeted, who not and why), the selected card's buttons, the batch. */
export function newcomersAvailability(vm: NewcomersVM, say: Say): AvailabilityMap | null {
  const out = new Collect();
  out.set('view', ofView(vm.view));
  for (const row of vm.rows) {
    const state = row.check?.status ?? row.greeting.s;
    const refused = row.send?.refused ?? null;
    const batch = row.batch?.failure ?? null;
    if (refused !== null) out.set(`row:${row.handle}`, off('refused', refused.code, null));
    else if (batch !== null) out.set(`row:${row.handle}`, off('batch-failed', batch.code, batch.title === null ? null : say(batch.title)));
    else if (row.check?.dmClosed !== undefined && row.check.dmClosed !== null) out.set(`row:${row.handle}`, off(`dm-closed-${row.check.dmClosed}`, null, null));
    else out.set(`row:${row.handle}`, ROW_OPEN.has(state) ? AVAILABLE : off(state, null, null));
  }
  const pass = vm.pass;
  if (pass !== undefined) {
    out.set('pass', pass.failure === null ? AVAILABLE : off(pass.stage, pass.failure.code, null));
    const card = pass.card;
    const greeting = card?.greeting ?? null;
    if (card !== null && greeting !== null) {
      const key = (what: string): string => `card:${what}:${card.handle}`;
      out.set(key('generate'), greeting.canGenerate ? AVAILABLE : off(greeting.waiting ? 'waiting' : greeting.state.s, null, null));
      out.set(key('send'), greeting.canSend ? AVAILABLE : greeting.sendBlocked !== null ? off('blocked', greeting.sendBlocked.code, null) : greeting.text.length === 0 ? null : off(greeting.waiting ? 'waiting' : greeting.stale ? 'stale' : greeting.state.s, null, null));
      out.set(key('insert'), greeting.canInsert ? AVAILABLE : greeting.text.length === 0 ? null : off(greeting.waiting ? 'waiting' : greeting.state.s, null, null));
    }
  }
  if (vm.batch !== undefined) out.set('batch', vm.batch.reason === null ? AVAILABLE : off('batch', null, say(vm.batch.reason)));
  return out.map;
}

/** Spenders: the board's own state, the waiting list's fallback, the batch. */
export function spendersAvailability(vm: SpendersBoardVM, say: Say): AvailabilityMap | null {
  const out = new Collect();
  out.set('view', ofView(vm.view));
  if (vm.statistics === false) out.set('statistics', off('statistics-off', null, null));
  if (vm.waitingFallback !== undefined) out.set('waiting', vm.waitingFallback === null ? AVAILABLE : ofError('fallback', vm.waitingFallback.error));
  if (vm.batch !== undefined) out.set('batch', vm.batch.reason === null ? AVAILABLE : off('batch', null, say(vm.batch.reason)));
  return out.map;
}

/** One change of a surface's map: the key, what it was (null — not known before), what it is. */
export interface AvailabilityChange {
  readonly key: string;
  readonly before: Availability | null;
  readonly after: Availability;
}

export function sameAvailability(a: Availability, b: Availability): boolean {
  return a.on === b.on && a.why === b.why && a.code === b.code;
}

/**
 * The changes from `before` to `next`, and the map to keep: an entry `next` leaves out keeps its last state (it only
 * passes, or its surface does not show it now); a new entry that is on is no news, a new one that is off is.
 */
export function diffAvailability(before: AvailabilityMap, next: AvailabilityMap): { readonly changes: readonly AvailabilityChange[]; readonly kept: AvailabilityMap } {
  const kept = new Map(before);
  const changes: AvailabilityChange[] = [];
  for (const [key, after] of next) {
    const was = before.get(key) ?? null;
    kept.set(key, after);
    if (was === null ? !after.on : !sameAvailability(was, after)) changes.push({ key, before: was, after });
  }
  return { changes, kept };
}
