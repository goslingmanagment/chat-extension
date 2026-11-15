export declare const WAITING_GROUP_IDS: readonly ["questions", "asks", "reports", "customs", "newcomers", "held", "publications", "content", "people", "ledger", "system", "other", "info"];
export type WaitingGroupId = (typeof WAITING_GROUP_IDS)[number];
/**
 * The product a matter is decided in (products plan §4.4): Hub (the owner's: people and access, the ledger's checks,
 * the system), Workboard (the chat team's: whose a sale is, shifts' reports, customs, held sends) or ContentOps
 * (publications and content). The owner's «Ждут вас» in Hub lists them all, grouped by product; Workboard's list is
 * its product's cut (a team lead's and a chatter's whole list: they have no Hub).
 */
export declare const WAITING_PRODUCT_IDS: readonly ["hub", "workboard", "contentops"];
export type WaitingProductId = (typeof WAITING_PRODUCT_IDS)[number];
export declare const WAITING_PRODUCTS: readonly {
    id: WaitingProductId;
    title: string;
}[];
export interface WaitingGroup {
    id: WaitingGroupId;
    title: string;
    /** Where its matters are decided. */
    product: WaitingProductId;
}
/** The groups in the list's order: the old sections of «Решения» first (their anchors still open them), what only informs last. */
export declare const WAITING_GROUPS: readonly WaitingGroup[];
/** The group of a matter's kind. */
export declare function waitingGroupOf(kind: string): WaitingGroupId;
export declare function waitsInContentops(kind: string): boolean;
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
/** The product a matter's kind is decided in: its group's. */
export declare function waitingProductOf(kind: string): WaitingProductId;
/** The owner's combined list in Hub (`/waiting`). */
export declare const HUB_WAITING_PATH = "/waiting";
/** Workboard's list (`/workboard/waiting`): a team lead's and a chatter's whole, the owner's Workboard part. */
export declare const WORKBOARD_WAITING_PATH = "/workboard/waiting";
/** The list filtered to one group: Workboard's `/workboard/waiting#<group>`, or the owner's in Hub (`/waiting#<group>`). */
export declare function waitingGroupLink(id: WaitingGroupId, list?: string): string;
/**
 * Since when a matter waits: since its reason began, as its own finding names it, else since it was opened — never
 * the moment a matter row was opened (or reopened) today while its cause is days old. Only a past moment no later than
 * the opening counts (a publication's moment is when it goes out, not when it waits). The age both apps show and the
 * list's «дольше ждёт» order are this.
 */
export declare function waitingSinceOf(matter: {
    kind: string;
    openedAt: string;
    evidence: Record<string, unknown>;
}, now?: number): string;
