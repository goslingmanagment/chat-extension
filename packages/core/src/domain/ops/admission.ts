// Admission of a new operation (architecture.md §7 «Конкуренция», А3, D-11):
// one operation per chat across the whole extension (any feature, any
// surface), at most three per tab, and no queue — a refusal names the
// running operations instead. A repeated click on the chat that is already
// running the same request reopens it (AI-127) — from the tab that owns it,
// or from any tab once its own tab went away (a reload mints a new session;
// §7: a repeated click on a running chat opens its state). The decision is pure; the
// scheduler is its single writer, so it is atomic.

import { type ChatKey } from '@cg/contracts/ids';
import { OP_LIMITS } from '@cg/contracts/limits';
import { type ActiveOpSummary, type AnyActiveOpSummary, type Admission } from '@cg/contracts/ops';

/** A running operation as admission sees it. */
export interface ActiveOpEntry {
  readonly opId: string;
  readonly chatKey: ChatKey;
  /** The tab that started it; null after that tab closed (the generation goes on, BG-006). */
  readonly ownerTab: string | null;
  /** The full request identity (cache key): equal keys are the same request. */
  readonly requestKey: string;
  readonly summary: Omit<AnyActiveOpSummary, 'inThisTab'>;
  readonly site?: boolean;
}

export interface AdmissionRequest {
  readonly tabSessionId: string;
  readonly chatKey: ChatKey;
  readonly requestKey: string;
}

export type AdmissionRefusal = Extract<Admission, { ok: false }>;

export type AdmissionDecision =
  | { readonly kind: 'admit' }
  /** The same chat is running the same request from this tab, or detached from a tab that went away: show it again (AI-127). */
  | { readonly kind: 'reopen'; readonly opId: string }
  | { readonly kind: 'refuse'; readonly refusal: AdmissionRefusal };

const summaryFor = (entry: ActiveOpEntry, tabSessionId: string): AnyActiveOpSummary => ({
  ...entry.summary,
  inThisTab: entry.ownerTab === tabSessionId,
});

/** The common list stays closed; a site's display metadata is additive and never executable. */
function refusal(code: AdmissionRefusal['code'], entries: readonly ActiveOpEntry[], tab: string): AdmissionRefusal {
  const active = entries.filter((entry) => entry.site !== true).map((entry) => summaryFor(entry, tab) as ActiveOpSummary);
  const siteActive = entries.filter((entry) => entry.site === true).map((entry) => summaryFor(entry, tab));
  return { ok: false, code, active, ...(siteActive.length === 0 ? {} : { siteActive }) };
}

/** Oldest first: the refusal list reads in the order the person started them. */
const byStart = (a: ActiveOpEntry, b: ActiveOpEntry): number => a.summary.startedAt - b.summary.startedAt;

export function decideAdmission(active: readonly ActiveOpEntry[], request: AdmissionRequest): AdmissionDecision {
  const sameChat = active.filter((entry) => entry.chatKey === request.chatKey).sort(byStart);
  const first = sameChat[0];
  if (first !== undefined) {
    if ((first.ownerTab === request.tabSessionId || first.ownerTab === null) && first.requestKey === request.requestKey) return { kind: 'reopen', opId: first.opId };
    return {
      kind: 'refuse',
      refusal: refusal('CG-OP-CHAT-BUSY', sameChat.slice(0, OP_LIMITS.perTab), request.tabSessionId),
    };
  }
  const inTab = active.filter((entry) => entry.ownerTab === request.tabSessionId).sort(byStart);
  if (inTab.length >= OP_LIMITS.perTab) {
    return {
      kind: 'refuse',
      refusal: refusal('CG-OP-TAB-LIMIT', inTab.slice(0, OP_LIMITS.perTab), request.tabSessionId),
    };
  }
  return { kind: 'admit' };
}
