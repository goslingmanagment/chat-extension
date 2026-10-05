// The X8 attempt journal `send.journal` (architecture.md §6.7.7 п. 3, §9.4,
// X8-07): a record per attempt in storage.local, written BEFORE `dispatch`
// and therefore before any command can reach MAIN — an unwritten record
// means no queue call. No text, ever. Uncertain records live until the hub
// resolves them, independent of the 30-minute result lifetime; ended ones
// stay as long as a result could still be sent from (group rules), then go.
// After a restart nothing is re-sent: an attempt that may have reached the
// queue waits for its report and becomes `uncertain` when none comes.

import { OP_LIMITS, SEND_LIMITS, BRIDGE_LIMITS } from '@cg/contracts/limits';
import { SendJournalEntrySchema, type SendJournalEntry, type SendAttemptView } from '@cg/contracts/send';
import { type SendAttemptState } from '@cg/contracts/send-rules';
import { type SendBegin } from '@cg/contracts/tab-messages';

/** Slack after a deadline before a silent attempt is called uncertain. */
export const REPORT_GRACE_MS = 5_000;

/**
 * `documentEpoch` of a record that no document of ours sent: the person
 * pressed ChatSpace's own Send on a part «Открыть и вставить» put into the
 * composer (§6.6), and the tab proved it by the receipt and the echo. Such a
 * record is born `sentObserved`, never had a ticket and owes the custody
 * nothing (the hub hears of it through `registerNativeSend`). A real document
 * epoch is random and never reads like this.
 */
export const NATIVE_SEND_DOCUMENT = 'native-send';

/** A record of a part the person sent from the composer (see NATIVE_SEND_DOCUMENT). */
export function isNativeSendEntry(entry: Pick<SendJournalEntry, 'documentEpoch'>): boolean {
  return entry.documentEpoch === NATIVE_SEND_DOCUMENT;
}

export function journalEntryOf(begin: SendBegin, now: number): SendJournalEntry {
  return {
    attemptId: begin.attemptId,
    hubOrigin: begin.target.binding.hubOrigin,
    pageId: begin.target.binding.pageId,
    platform: begin.target.binding.platform,
    fanRef: begin.target.fanRef,
    hostAccountId: begin.target.chat.hostAccountId,
    purpose: begin.purpose,
    opId: begin.opId,
    group: begin.group,
    partIndex: begin.part.index,
    previewRevision: begin.previewRevision,
    documentEpoch: begin.documentEpoch,
    state: 'preparing',
    createdAt: now,
    updatedAt: now,
  };
}

/** The entry after the attempt moved; `updatedAt` never goes back. */
export function journalWithView(entry: SendJournalEntry, view: SendAttemptView, now: number, pendingId?: string | null): SendJournalEntry {
  const next: SendJournalEntry = { ...entry, state: view.state, updatedAt: Math.max(entry.updatedAt, now) };
  const code = view.code;
  const out: { -readonly [K in keyof SendJournalEntry]: SendJournalEntry[K] } = { ...next };
  if (code === undefined) delete out.code;
  else out.code = code;
  if (view.platformMessageId !== undefined) out.platformMessageId = view.platformMessageId;
  if (pendingId !== undefined && pendingId !== null) out.pendingId = pendingId;
  return out;
}

/** Entries that fail their schema are dropped on read (and logged by the caller). */
export function parseJournal(raw: unknown): { readonly entries: SendJournalEntry[]; readonly dropped: number } {
  if (!Array.isArray(raw)) return { entries: [], dropped: raw === undefined || raw === null ? 0 : 1 };
  const entries: SendJournalEntry[] = [];
  let dropped = 0;
  const seen = new Set<string>();
  for (const item of raw) {
    const parsed = SendJournalEntrySchema.safeParse(item);
    if (!parsed.success || seen.has(parsed.data.attemptId)) dropped += 1;
    else {
      seen.add(parsed.data.attemptId);
      entries.push(parsed.data);
    }
  }
  return { entries, dropped };
}

const ENDED: readonly SendAttemptState[] = ['held', 'notEnqueued', 'rejected', 'sentObserved'];

/** When a silent attempt in this state stops waiting for its report (local clock). */
export function silenceDeadline(entry: Pick<SendJournalEntry, 'state' | 'updatedAt'>, ticketSec: number): number | null {
  switch (entry.state) {
    case 'preparing':
      // The ticket's lifetime, the bridge's answer time, then grace: a command after the ticket is held by MAIN.
      return entry.updatedAt + ticketSec * 1000 + BRIDGE_LIMITS.callTimeoutMs + REPORT_GRACE_MS;
    case 'nativeEnqueued':
    case 'nativeAccepted':
      // ChatSpace's own native timeout, then grace.
      return entry.updatedAt + SEND_LIMITS.nativeTimeoutMs + REPORT_GRACE_MS;
    case 'ready':
    case 'held':
    case 'notEnqueued':
    case 'sentObserved':
    case 'rejected':
    case 'uncertain':
      return null;
  }
}

export type RestoreAction =
  /** Keep the record as it is (uncertain: until resolved; ended: until it ages out). */
  | { readonly kind: 'keep' }
  /** May have reached the queue: wait for the tab's report until `until`, then uncertain. */
  | { readonly kind: 'await'; readonly until: number }
  | { readonly kind: 'uncertain' }
  | { readonly kind: 'drop' };

/** What a restarted background does with one record (§7 «Фон и выгрузка», §6.7.7 п. 6). */
export function restoreAction(entry: SendJournalEntry, now: number, ticketSec: number, keepEndedMs: number = OP_LIMITS.resultTtlMs): RestoreAction {
  if (entry.state === 'uncertain') return { kind: 'keep' };
  if (ENDED.includes(entry.state)) return now - entry.updatedAt >= keepEndedMs ? { kind: 'drop' } : { kind: 'keep' };
  if (entry.state === 'ready') return { kind: 'drop' };
  const until = silenceDeadline(entry, ticketSec);
  if (until === null) return { kind: 'keep' };
  return now >= until ? { kind: 'uncertain' } : { kind: 'await', until };
}

export function isEnded(state: SendAttemptState): boolean {
  return ENDED.includes(state);
}
