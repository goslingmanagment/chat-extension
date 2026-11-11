import { SHIFT_REVIEW_DELETED_UNSEEN_SECONDS } from "./routes-shift-review";
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
export const SHIFT_REVIEW_REPLY_NORM_SECONDS = 10 * 60;
/** A fan quiet this long inside a wait, who then wrote again, came back. */
export const SHIFT_REVIEW_FAN_QUIET_SECONDS = 15 * 60;
/** An AI text whose words match the sent text at least this much went out as it was («ИИ без правки»). */
export const SHIFT_REVIEW_AI_UNEDITED_MIN_SHARE = 0.98;
/** A greeting to a new follower by the Hi button: an AI text, but not a reply in a conversation. */
export function shiftReviewHi(mine) {
    return mine.composedWith === "hi" || mine.aiFeature === "hi-greeting";
}
/** A text of the chatter's with words, Hi greetings left out: what «ИИ без правки» is a share of. */
export function shiftReviewTextMessage(mine) {
    return mine.origin !== null && !(mine.origin === "ai" && shiftReviewHi(mine));
}
/**
 * «ИИ без правки»: the AI's text went to the fan as it was. Not a Hi greeting,
 * not a Fix of a command («скажи…»), not changed after it was put in (the
 * extension saw no edit, and at least SHIFT_REVIEW_AI_UNEDITED_MIN_SHARE of the
 * sent words are the AI's). The review's mark of a message, the shift's share
 * on every screen and «Смены» are this one rule.
 */
export function shiftReviewAiUnedited(mine) {
    return mine.origin === "ai" && !shiftReviewHi(mine) && mine.aiFeature !== "improve-draft"
        && mine.edited !== true && (mine.aiShare ?? 1) >= SHIFT_REVIEW_AI_UNEDITED_MIN_SHARE;
}
/** Of the chatter's personal messages (seen, not mass): the texts with words and, of them, the AI's sent as they were. */
export function shiftReviewAiCounts(mines) {
    let textMessages = 0;
    let aiUnedited = 0;
    for (const mine of mines) {
        if (shiftReviewTextMessage(mine))
            textMessages += 1;
        if (shiftReviewAiUnedited(mine))
            aiUnedited += 1;
    }
    return { textMessages, aiUnedited };
}
/** The other side could see the message: not deleted, or deleted SHIFT_REVIEW_DELETED_UNSEEN_SECONDS after it was sent or later. */
export function shiftReviewSeen(message) {
    return message.deletedAt === undefined || Date.parse(message.deletedAt) - Date.parse(message.at) >= SHIFT_REVIEW_DELETED_UNSEEN_SECONDS * 1000;
}
/** The chatter's message of the shift that the fan could see, a mass one too. */
export function shiftReviewMine(message) {
    return message.mine !== null && shiftReviewSeen(message);
}
/** A page message that answers a fan: not a mass message, not an automated one, not deleted before the fan saw it. */
function answersFan(message) {
    return message.side === "page" && !message.mass && message.by !== "auto" && shiftReviewSeen(message);
}
/** A fan's message the chatter could see. */
export function shiftReviewFansMessage(message) {
    return message.side === "fan" && shiftReviewSeen(message);
}
export function shiftReviewMedian(values) {
    if (values.length === 0)
        return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
/** The shift's waits, each with whose it is (see the file's head). */
export function shiftReviewWaits(data) {
    const start = Date.parse(data.shift.startedAt);
    const norm = SHIFT_REVIEW_REPLY_NORM_SECONDS * 1000;
    const chats = new Map(data.chats.map((chat) => [chat.key, chat]));
    // When each colleague wrote on each page: within the shift, and in the messages shown before it.
    const colleagueAt = new Map();
    for (const chat of data.chats) {
        for (const message of chat.messages) {
            if (message.by !== "other" || message.mass)
                continue;
            const key = `${chat.pageLabel}|${message.byName ?? ""}`;
            colleagueAt.set(key, [...(colleagueAt.get(key) ?? []), Date.parse(message.at)]);
        }
    }
    const writingOn = (page, name, at) => (colleagueAt.get(`${page}|${name ?? ""}`) ?? [])
        .some((one) => one <= at && one >= at - norm);
    return data.waits.map((wait) => {
        const since = Date.parse(wait.since);
        const from = Date.parse(wait.from);
        const to = Date.parse(wait.to);
        const chat = chats.get(wait.chat);
        const page = chat?.pageLabel ?? "";
        const timed = (chat?.messages ?? []).map((message) => ({ message, at: Date.parse(message.at) }));
        const before = timed.filter((one) => answersFan(one.message) && one.at < since).at(-1);
        const heldByMe = before?.message.by === "me";
        const holder = before && before.at >= start - norm && before.message.by === "other" ? before.message.byName : undefined;
        const heldBy = holder !== undefined && (wait.by === "other" || writingOn(page, holder, to)) ? holder ?? "коллега" : null;
        const answer = wait.by === "other" ? timed.find((one) => one.at === to && one.message.by === "other") : undefined;
        const answeredOnTheirWatch = answer !== undefined && writingOn(page, answer.message.byName, from);
        const fanAts = timed.filter((one) => shiftReviewFansMessage(one.message) && one.at >= since && one.at <= to).map((one) => one.at);
        return {
            chat: wait.chat,
            since,
            from,
            to,
            by: wait.by,
            byName: answer?.message.byName ?? null,
            heldBy,
            inherited: since < start,
            fanWrote: timed.some((one) => shiftReviewFansMessage(one.message) && one.message.inShift && one.at >= since && one.at <= to),
            fanBack: fanBackOf(fanAts, Math.max(since, start)),
            seconds: (to - Math.max(since, start)) / 1000,
            his: wait.by === "me" || heldByMe || (heldBy === null && !answeredOnTheirWatch),
        };
    });
}
/**
 * The fan's first message from `counted` on that broke a silence of
 * SHIFT_REVIEW_FAN_QUIET_SECONDS. The first, not the longest silence's or the
 * last: a fan who came back, got nothing and wrote again an hour later waited
 * that hour, and the line must not say otherwise.
 */
function fanBackOf(fanAts, counted) {
    const index = fanAts.findIndex((one, at) => at > 0 && one >= counted && one - fanAts[at - 1] >= SHIFT_REVIEW_FAN_QUIET_SECONDS * 1000);
    return index < 0 ? null : { at: fanAts[index], quietSeconds: (fanAts[index] - fanAts[index - 1]) / 1000 };
}
/** A wait the chatter left without an answer at the end: the fan wrote in the shift, or began waiting in it. */
export function shiftReviewUnanswered(wait) {
    return wait.his && wait.by === null && (!wait.inherited || wait.fanWrote);
}
/** A fan waiting since before the shift who did not write in it, and got no answer in it. */
export function shiftReviewWaitingSilently(wait) {
    return wait.his && wait.by === null && wait.inherited && !wait.fanWrote;
}
/** The shift's numbers, as «Разбор смены» shows them and «Смены» counts them. */
export function shiftReviewCounts(data, waits) {
    const mine = data.chats.flatMap((chat) => chat.messages.filter(shiftReviewMine));
    const personal = mine.filter((message) => !message.mass);
    const bought = mine.filter((message) => message.bought === true);
    return {
        messages: personal.length,
        massMessages: mine.length - personal.length,
        replyDelays: personal.flatMap((message) => (message.mine.replySeconds === null ? [] : [message.mine.replySeconds])),
        unanswered: waits.filter(shiftReviewUnanswered).length,
        waitingSilently: waits.filter(shiftReviewWaitingSilently).length,
        ppvSent: mine.filter((message) => message.priceMills !== null).length,
        ppvBought: bought.length,
        boughtPrices: bought.flatMap((message) => (message.priceMills === null ? [] : [message.priceMills])),
    };
}
