// Admission of a new operation (architecture.md §7 «Конкуренция», А3, D-11):
// one operation per chat across the whole extension (any feature, any
// surface), at most three per tab, and no queue — a refusal names the
// running operations instead. A repeated click on the chat that is already
// running the same request reopens it (AI-127). The decision is pure; the
// scheduler is its single writer, so it is atomic.

import { type ChatKey } from '@cg/contracts/ids';
import { OP_LIMITS } from '@cg/contracts/limits';
import { type ActiveOpSummary, type Admission } from '@cg/contracts/ops';

/** A running operation as admission sees it. */
export interface ActiveOpEntry {
  readonly opId: string;
  readonly chatKey: ChatKey;
  /** The tab that started it; null after that tab closed (the generation goes on, BG-006). */
  readonly ownerTab: string | null;
  /** The full request identity (cache key): equal keys are the same request. */
  readonly requestKey: string;
  readonly summary: Omit<ActiveOpSummary, 'inThisTab'>;
}

export interface AdmissionRequest {
  readonly tabSessionId: string;
  readonly chatKey: ChatKey;
  readonly requestKey: string;
}

export type AdmissionRefusal = Extract<Admission, { ok: false }>;

export type AdmissionDecision =
  | { readonly kind: 'admit' }
  /** The same chat is running the same request from this tab: show it again (AI-127). */
  | { readonly kind: 'reopen'; readonly opId: string }
  | { readonly kind: 'refuse'; readonly refusal: AdmissionRefusal };

const summaryFor = (entry: ActiveOpEntry, tabSessionId: string): ActiveOpSummary => ({
  ...entry.summary,
  inThisTab: entry.ownerTab === tabSessionId,
});

/** Oldest first: the refusal list reads in the order the person started them. */
const byStart = (a: ActiveOpEntry, b: ActiveOpEntry): number => a.summary.startedAt - b.summary.startedAt;

export function decideAdmission(active: readonly ActiveOpEntry[], request: AdmissionRequest): AdmissionDecision {
  const sameChat = active.filter((entry) => entry.chatKey === request.chatKey).sort(byStart);
  const first = sameChat[0];
  if (first !== undefined) {
    if (first.ownerTab === request.tabSessionId && first.requestKey === request.requestKey) return { kind: 'reopen', opId: first.opId };
    return {
      kind: 'refuse',
      refusal: {
        ok: false,
        code: 'CG-OP-CHAT-BUSY',
        active: sameChat.slice(0, OP_LIMITS.perTab).map((entry) => summaryFor(entry, request.tabSessionId)),
      },
    };
  }
  const inTab = active.filter((entry) => entry.ownerTab === request.tabSessionId).sort(byStart);
  if (inTab.length >= OP_LIMITS.perTab) {
    return {
      kind: 'refuse',
      refusal: { ok: false, code: 'CG-OP-TAB-LIMIT', active: inTab.slice(0, OP_LIMITS.perTab).map((entry) => summaryFor(entry, request.tabSessionId)) },
    };
  }
  return { kind: 'admit' };
}
