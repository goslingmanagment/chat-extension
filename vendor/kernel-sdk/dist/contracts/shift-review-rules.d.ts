import { type ShiftReviewMessage, type ShiftReviewMine, type TeamShiftReviewResponse } from "./routes-shift-review";
/**
 * The one definition of a shift's quality numbers: «Разбор смены» counts them
 * on its screen (apps/dashboard …/review/shiftReviewView.ts) and «Смены»
 * (`teamChatterNumbers`) on the server, both from the same facts — the
 * chatter's messages, the replies and their median, the fans left without an
 * answer at the end. Pure; over the facts `teamShiftReview` sends, or the same
 * facts the server builds for «Смены» (`ShiftReviewRuleData`).
 *
 * Whose a wait is (2026-11-07): a page can be worked by two people at once, or
 * handed over within a shift. A fan's wait is the reviewed chatter's when the
 * chatter answered it or wrote last before it began. It is a colleague's when
 * the colleague wrote last before it, within the shift or in the
 * SHIFT_REVIEW_REPLY_NORM_SECONDS before it, and was still writing on that page
 * when it ended; or when a colleague answered it who was writing on that page
 * as it began. «Writing on that page» counts the colleague's messages before
 * the shift too: a fan waiting from the last shift, answered by a colleague who
 * sat on the page as this one began, is not the chatter's. Anything else on the
 * chatter's watch is theirs.
 *
 * A deleted message (owner, 2026-11-08) counts as sent once the other side
 * could see it — deleted SHIFT_REVIEW_DELETED_UNSEEN_SECONDS after it was sent
 * or later (`shiftReviewSeen`). One deleted sooner is only shown: a fan's starts
 * no wait, the chatter's answers none and is not among the shift's messages.
 */
/**
 * The reply norm is a band, not a line: the owner put it at «5-10 минут»
 * (2026-11-07); the job description says «до 10 минут». Past the upper end a
 * wait counts as long.
 */
export declare const SHIFT_REVIEW_REPLY_NORM_SECONDS: number;
/** A fan quiet this long inside a wait, who then wrote again, came back. */
export declare const SHIFT_REVIEW_FAN_QUIET_SECONDS: number;
/** What the rules read of a message: `teamShiftReview`'s, or the same facts the server builds for «Смены». */
export type ShiftReviewRuleMessage = Pick<ShiftReviewMessage, "at" | "side" | "by" | "byName" | "mass" | "inShift" | "deletedAt" | "priceMills" | "bought"> & {
    mine: Pick<ShiftReviewMine, "replySeconds"> | null;
};
export interface ShiftReviewRuleChat {
    key: string;
    pageLabel: string;
    messages: readonly ShiftReviewRuleMessage[];
}
export interface ShiftReviewRuleData {
    shift: Pick<TeamShiftReviewResponse["shift"], "startedAt" | "endedAt">;
    chats: readonly ShiftReviewRuleChat[];
    waits: TeamShiftReviewResponse["waits"];
}
/** An AI text whose words match the sent text at least this much went out as it was («ИИ без правки»). */
export declare const SHIFT_REVIEW_AI_UNEDITED_MIN_SHARE = 0.98;
/** Where a chatter's message came from, as `teamShiftReview` says it: what «ИИ без правки» reads. */
export type ShiftReviewOriginFacts = Pick<ShiftReviewMine, "origin" | "composedWith" | "aiFeature" | "edited" | "aiShare">;
/** A greeting to a new follower by the Hi button: an AI text, but not a reply in a conversation. */
export declare function shiftReviewHi(mine: Pick<ShiftReviewMine, "composedWith" | "aiFeature">): boolean;
/** A text of the chatter's with words, Hi greetings left out: what «ИИ без правки» is a share of. */
export declare function shiftReviewTextMessage(mine: Pick<ShiftReviewMine, "origin" | "composedWith" | "aiFeature">): boolean;
/**
 * «ИИ без правки»: the AI's text went to the fan as it was. Not a Hi greeting,
 * not a Fix of a command («скажи…»), not changed after it was put in (the
 * extension saw no edit, and at least SHIFT_REVIEW_AI_UNEDITED_MIN_SHARE of the
 * sent words are the AI's). The review's mark of a message, the shift's share
 * on every screen and «Смены» are this one rule.
 */
export declare function shiftReviewAiUnedited(mine: ShiftReviewOriginFacts): boolean;
/** Of the chatter's personal messages (seen, not mass): the texts with words and, of them, the AI's sent as they were. */
export declare function shiftReviewAiCounts(mines: Iterable<ShiftReviewOriginFacts>): {
    textMessages: number;
    aiUnedited: number;
};
/** The other side could see the message: not deleted, or deleted SHIFT_REVIEW_DELETED_UNSEEN_SECONDS after it was sent or later. */
export declare function shiftReviewSeen(message: Pick<ShiftReviewMessage, "at" | "deletedAt">): boolean;
/** The chatter's message of the shift that the fan could see, a mass one too. */
export declare function shiftReviewMine(message: Pick<ShiftReviewRuleMessage, "at" | "deletedAt" | "mine">): boolean;
/** A fan's message the chatter could see. */
export declare function shiftReviewFansMessage(message: Pick<ShiftReviewRuleMessage, "at" | "side" | "deletedAt">): boolean;
export declare function shiftReviewMedian(values: readonly number[]): number | null;
export interface ShiftReviewWait {
    chat: string;
    /** When the fan began waiting, ms; `from` — the same, cut to the shift's start. */
    since: number;
    from: number;
    to: number;
    by: "me" | "other" | "none" | null;
    /** The colleague who ended it. */
    byName: string | null;
    /** The colleague whose wait it is: who wrote last before it, in the shift or just before it, and was still writing on the page at its end. */
    heldBy: string | null;
    /** The fan began waiting before the shift. */
    inherited: boolean;
    /** The fan wrote within the shift while waiting. */
    fanWrote: boolean;
    /**
     * The fan came back: their first message in the counted part of the wait (from the shift's start for a wait from
     * before it) that broke a silence of SHIFT_REVIEW_FAN_QUIET_SECONDS, when, and how long they had been quiet, seconds.
     */
    fanBack: {
        at: number;
        quietSeconds: number;
    } | null;
    /** How long, seconds: a wait from before the shift counts from its start (the approved definition). */
    seconds: number;
    /** The reviewed chatter's (see the file's head). */
    his: boolean;
}
/** The shift's waits, each with whose it is (see the file's head). */
export declare function shiftReviewWaits(data: ShiftReviewRuleData): ShiftReviewWait[];
/** A wait the chatter left without an answer at the end: the fan wrote in the shift, or began waiting in it. */
export declare function shiftReviewUnanswered(wait: ShiftReviewWait): boolean;
/** A fan waiting since before the shift who did not write in it, and got no answer in it. */
export declare function shiftReviewWaitingSilently(wait: ShiftReviewWait): boolean;
export interface ShiftReviewCounts {
    /** The chatter's personal messages of the shift the fans could see: «Сообщения». */
    messages: number;
    /** The chatter's mass messages of the shift. */
    massMessages: number;
    /** How long the fan had waited for each personal message that answered one, seconds: the replies. */
    replyDelays: number[];
    /** The chatter's fans who wrote in the shift (or began waiting in it) and got no answer before its end: «Без ответа к концу смены». */
    unanswered: number;
    /** Fans waiting since before the shift who did not write in it and got no answer in it. */
    waitingSilently: number;
    /** Of all the chatter's messages, the priced ones, the bought ones, and the prices of those, mills. */
    ppvSent: number;
    ppvBought: number;
    boughtPrices: number[];
}
/** The shift's numbers, as «Разбор смены» shows them and «Смены» counts them. */
export declare function shiftReviewCounts(data: Pick<ShiftReviewRuleData, "chats">, waits: readonly ShiftReviewWait[]): ShiftReviewCounts;
