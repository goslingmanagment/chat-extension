import type { TeamShiftReviewResponse } from "./routes-shift-review";
/**
 * The «Обучалка» shift audit's numbers (`shift_audit.py collect`, /OS), counted
 * from «Разбор смены» — the one computation the owner's screen and the agents'
 * door (`agentShiftReview`) both read — instead of a second reading of the
 * database in Python. Pure.
 *
 * Each number keeps the audit's meaning; where Hub's own rule differs (whose a
 * message is, what a wait is), Hub's holds and the difference is the audit's
 * to adopt: a page message is the chatter's by its author (`by: "me"`) on every
 * page, a message deleted before the fan could see it counts for nothing, and
 * a mass message is the one of «Смены». A page's own facts — its new
 * followers and its money within the shift — count on the pages the shift
 * worked (`shift.pages[].worked`: its sales are the shift's), as the audit
 * counts them on the chatter's own pages; a page only looked at brings in
 * none.
 */
/** A reply this slow counts in `repliesOver15` (the audit's WAIT_MIN). */
export declare const SHIFT_AUDIT_SLOW_REPLY_SECONDS: number;
/** A new follower written to within this counts in `followsWrittenSoon` (the audit's «w30»). */
export declare const SHIFT_AUDIT_FOLLOW_SOON_SECONDS: number;
/** A personal message within this before the follow counts as written after it (the audit's 60 s). */
export declare const SHIFT_AUDIT_FOLLOW_SLACK_SECONDS = 60;
/** A fan quiet this long (no message, no follow) whom the chatter wrote to first was reactivated (the audit's 72 h). */
export declare const SHIFT_AUDIT_SILENT_HOURS = 72;
export interface ShiftAuditNumbers {
    /** Chats the chatter sent a personal message in (the audit's `chats`). */
    chats: number;
    /** The chatter's personal messages the fans could see (`out`). */
    messages: number;
    /** Fans' messages within the shift in the review's chats (`fan`). */
    fanMessages: number;
    /** The chatter's mass messages (Hub's rule: «Смены»). */
    massMessages: number;
    /** Personal page messages in the shift with no author (`unauthored`). */
    unauthored: number;
    /** Personal page messages of colleagues in the shift, by name, most first (`others`). */
    others: Array<{
        name: string;
        messages: number;
    }>;
    /** The chatter's priced messages, and of them bought (`ppv_sent`; Hub's `ppvBought` is the chatter's, not the page's). */
    ppvSent: number;
    ppvBought: number;
    /** Personal messages that answered a waiting fan, the median wait, how many waited over 15 minutes, the longest (`replies`, `median`, `over15`, `longest`). */
    replies: number;
    replyMedianSeconds: number | null;
    repliesOver15: number;
    longestReplySeconds: number | null;
    /** The chat of the longest reply (`longest_fan`). */
    longestReplyChat: string | null;
    /** Chats whose fan waited at the shift's start, and of them the ones the chatter wrote in (`wait_start`, `ans_start`). */
    waitingAtStart: number;
    waitingAtStartWritten: number;
    /** Chats whose fan was still waiting at the shift's end (`wait_end`). */
    waitingAtEnd: number;
    /** Fans' messages within the shift in chats the chatter sent nothing personal in (`fan_unattended`). */
    fanUnattended: number;
    /** New followers within the shift, of them written to personally by the chatter, and within 30 minutes (`follows`, `wrote`, `w30`). */
    follows: number;
    followsWritten: number;
    followsWrittenSoon: number;
    /** Fans quiet 72 hours whom the chatter wrote to first, and of them who answered within the shift (`react`, `react_ans`). */
    reactivations: number;
    reactivationsAnswered: number;
    /** Every sale on the page(s) within the shift, net, whoever's (`sales`), and of it tips, subscriptions and PPV purchases (`tips`, `subs_money`, the page's PPV count). */
    salesNetMills: number;
    tipsNetMills: number;
    subscriptionsNetMills: number;
    ppvPurchases: number;
    /** The chatter's AI events by feature (`ai`). */
    ai: Record<string, number>;
}
export interface ShiftAuditReport {
    /** By page, in the order of `shift.pages`. */
    pages: Array<{
        pageLabel: string;
    } & ShiftAuditNumbers>;
    total: ShiftAuditNumbers;
}
type Review = Pick<TeamShiftReviewResponse, "shift" | "chats" | "waits" | "follows" | "aiUse">;
/** The shift audit's numbers of one shift, by page and in total. Pure. */
export declare function shiftAuditNumbers(review: Review): ShiftAuditReport;
export {};
