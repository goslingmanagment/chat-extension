export declare const WAITING_GROUP_IDS: readonly ["questions", "reports", "customs", "held", "publications", "content", "people", "ledger", "system", "other", "info"];
export type WaitingGroupId = (typeof WAITING_GROUP_IDS)[number];
export interface WaitingGroup {
    id: WaitingGroupId;
    title: string;
}
/** The groups in the list's order: the old sections of «Решения» first (their anchors still open them), what only informs last. */
export declare const WAITING_GROUPS: readonly WaitingGroup[];
/** The group of a matter's kind. */
export declare function waitingGroupOf(kind: string): WaitingGroupId;
/**
 * The tone of what waits, beside its group (the one place): `bad` — something is broken (an open failure, a critical
 * failure of the extension, a page that needs sign-in, a routine that failed or went silent, a stale copy or a silent
 * reporter, a red check of the ledger); `warn` — the outcome is not known (a publication's, a held send's; and a group
 * whose source did not answer: «не проверено»); `null` — it only waits.
 */
export declare const WAITING_TONES: readonly ["bad", "warn"];
export type WaitingTone = (typeof WAITING_TONES)[number];
/** The tone of a matter's kind. */
export declare function waitingToneOf(kind: string): WaitingTone | null;
/** The worst of tones: `bad` over `warn` over none. */
export declare function worstWaitingTone(tones: Iterable<WaitingTone | null>): WaitingTone | null;
/** The list filtered to one group: `/workboard/decisions#<group>`. */
export declare function waitingGroupLink(id: WaitingGroupId): string;
