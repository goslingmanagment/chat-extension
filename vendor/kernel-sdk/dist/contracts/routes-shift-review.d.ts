/**
 * Команда → «Разбор смены» (owner, 2026-11-06): one chatter's shift, opened up.
 * The pulse of the shift minute by minute, every chat it touched with the whole
 * transcript, and what is known of each of the chatter's messages: which AI text
 * it came from, how long the fan had waited, whether the same text went to other
 * fans. Facts only, no grades: the owner reads them.
 *
 * Owner session only: it carries the AI's own texts (prompt content).
 *
 * The shift is services/chatter-shifts.ts's; the author of a message is
 * `client_send_attributions`; a mass message is the one of `teamChatterNumbers`
 * (a Fansly mass message, one text with its price and files sent to
 * MASS_SEND_MIN_CHATS chats of a page or more in a clock hour, or a broadcast
 * with names: one file set at one price from one sender to MASS_SEND_MIN_CHATS
 * chats within an hour, whatever the texts, but for a message with
 * SHIFT_REVIEW_BROADCAST_OWN_WORDS words of its own). A wait runs from
 * the fan's first message after the page's last personal one to the next
 * personal one, any author's, as in the «Обучалка» shift audit.
 */
import { z } from "zod";
/** An AI text counts as the source of a message when this share of the message's words comes straight from it. */
export declare const SHIFT_REVIEW_AI_SHARE = 0.7;
/** An AI text is looked for this long before the message (the study of 2026-10-29). */
export declare const SHIFT_REVIEW_AI_LOOKBACK_MINUTES = 90;
/** Messages shown before the shift's start in each chat, for context. */
export declare const SHIFT_REVIEW_CONTEXT_MESSAGES = 8;
/** A PPV of the shift bought this long after it still shows with the shift (`laterSales`). */
export declare const SHIFT_REVIEW_LATER_SALES_DAYS = 14;
/**
 * A fan's message older than this before a reply — or, for a wait still open at the end, before the shift's start (the
 * window the review reads) — is not waited on (as `teamChatterNumbers`).
 */
export declare const SHIFT_REVIEW_WAIT_HORIZON_HOURS = 72;
/** The person's previous and next shift are looked for this far from the shift. */
export declare const SHIFT_REVIEW_NEIGHBOUR_DAYS = 14;
/**
 * A broadcast with names (owner, 2026-11-08): its message stays personal — a live answer — with this many words of its
 * own or more, words no other message of the broadcast within an hour of it has. A name is one.
 */
export declare const SHIFT_REVIEW_BROADCAST_OWN_WORDS = 4;
/**
 * A message deleted sooner than this after it was sent the other side most likely never saw (owner, 2026-11-08): a fan's
 * starts no wait, a page's answers none, and the chatter's is not counted. One deleted later counts as sent.
 */
export declare const SHIFT_REVIEW_DELETED_UNSEEN_SECONDS = 60;
/**
 * A colleague's shift that held a page for less than this of the shift (the seam of two shifts, one ending as the other
 * begins) did not keep the page then (owner, 2026-11-08): a page with fewer of the person's messages still shows all its
 * fans (`allFans`).
 */
export declare const SHIFT_REVIEW_SEAM_MINUTES = 10;
export declare const SHIFT_REVIEW_ORIGINS: readonly ["ai", "fix", "own"];
export declare const SHIFT_REVIEW_MARKS: readonly ["dash", "cyrillic", "leak"];
export declare const SHIFT_REVIEW_AUTHORS: readonly ["me", "other", "none", "auto"];
export declare const SHIFT_REVIEW_SALE_VERDICTS: readonly ["mine", "both", "theirs", "none"];
/** A sale's home by the one rule of whose a sale is (apps/runtime services/sale-rule.ts, `sale_homes`). */
export declare const SALE_HOME_KINDS: readonly ["shift", "visit", "pot", "waiting", "decide", "nobody", "before_rule", "unknown"];
export declare const SHIFT_REVIEW_SALE_ORIGINS: readonly ["own", "colleague_ppv", "no_author_ppv", "other_wrote", "nobody_wrote_48h", "post_tip", "campaign"];
export declare const teamShiftReviewQuerySchema: z.ZodObject<{
    userId: z.ZodCoercedNumber<unknown>;
    at: z.ZodISODateTime;
}, z.core.$strip>;
declare const shiftReviewMineSchema: z.ZodObject<{
    composedWith: z.ZodNullable<z.ZodString>;
    part: z.ZodOptional<z.ZodNumber>;
    edited: z.ZodNullable<z.ZodBoolean>;
    origin: z.ZodNullable<z.ZodEnum<{
        fix: "fix";
        ai: "ai";
        own: "own";
    }>>;
    aiShare: z.ZodNullable<z.ZodNumber>;
    aiFeature: z.ZodNullable<z.ZodString>;
    aiText: z.ZodNullable<z.ZodString>;
    draft: z.ZodNullable<z.ZodString>;
    fixExpanded: z.ZodOptional<z.ZodBoolean>;
    replySeconds: z.ZodNullable<z.ZodNumber>;
    repeats: z.ZodNumber;
    marks: z.ZodArray<z.ZodEnum<{
        dash: "dash";
        cyrillic: "cyrillic";
        leak: "leak";
    }>>;
}, z.core.$strip>;
declare const shiftReviewMessageSchema: z.ZodObject<{
    ref: z.ZodString;
    at: z.ZodString;
    side: z.ZodEnum<{
        page: "page";
        fan: "fan";
    }>;
    text: z.ZodString;
    priceMills: z.ZodNullable<z.ZodNumber>;
    bought: z.ZodNullable<z.ZodBoolean>;
    tipMills: z.ZodNullable<z.ZodNumber>;
    media: z.ZodNumber;
    inShift: z.ZodBoolean;
    by: z.ZodNullable<z.ZodEnum<{
        other: "other";
        auto: "auto";
        none: "none";
        me: "me";
    }>>;
    mass: z.ZodBoolean;
    unarchived: z.ZodOptional<z.ZodBoolean>;
    deletedAt: z.ZodOptional<z.ZodString>;
    byName: z.ZodNullable<z.ZodString>;
    mine: z.ZodNullable<z.ZodObject<{
        composedWith: z.ZodNullable<z.ZodString>;
        part: z.ZodOptional<z.ZodNumber>;
        edited: z.ZodNullable<z.ZodBoolean>;
        origin: z.ZodNullable<z.ZodEnum<{
            fix: "fix";
            ai: "ai";
            own: "own";
        }>>;
        aiShare: z.ZodNullable<z.ZodNumber>;
        aiFeature: z.ZodNullable<z.ZodString>;
        aiText: z.ZodNullable<z.ZodString>;
        draft: z.ZodNullable<z.ZodString>;
        fixExpanded: z.ZodOptional<z.ZodBoolean>;
        replySeconds: z.ZodNullable<z.ZodNumber>;
        repeats: z.ZodNumber;
        marks: z.ZodArray<z.ZodEnum<{
            dash: "dash";
            cyrillic: "cyrillic";
            leak: "leak";
        }>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
declare const shiftReviewChatSchema: z.ZodObject<{
    key: z.ZodString;
    pageLabel: z.ZodString;
    platform: z.ZodString;
    conversationRef: z.ZodString;
    fanRef: z.ZodNullable<z.ZodString>;
    fanUsername: z.ZodNullable<z.ZodString>;
    fanDisplayName: z.ZodNullable<z.ZodString>;
    fanLifetimeNetMills: z.ZodNullable<z.ZodNumber>;
    shiftNetMills: z.ZodNumber;
    earlierHidden: z.ZodNumber;
    fanLastBefore: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    followedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    ai: z.ZodOptional<z.ZodArray<z.ZodObject<{
        feature: z.ZodString;
        count: z.ZodNumber;
    }, z.core.$strip>>>;
    messages: z.ZodArray<z.ZodObject<{
        ref: z.ZodString;
        at: z.ZodString;
        side: z.ZodEnum<{
            page: "page";
            fan: "fan";
        }>;
        text: z.ZodString;
        priceMills: z.ZodNullable<z.ZodNumber>;
        bought: z.ZodNullable<z.ZodBoolean>;
        tipMills: z.ZodNullable<z.ZodNumber>;
        media: z.ZodNumber;
        inShift: z.ZodBoolean;
        by: z.ZodNullable<z.ZodEnum<{
            other: "other";
            auto: "auto";
            none: "none";
            me: "me";
        }>>;
        mass: z.ZodBoolean;
        unarchived: z.ZodOptional<z.ZodBoolean>;
        deletedAt: z.ZodOptional<z.ZodString>;
        byName: z.ZodNullable<z.ZodString>;
        mine: z.ZodNullable<z.ZodObject<{
            composedWith: z.ZodNullable<z.ZodString>;
            part: z.ZodOptional<z.ZodNumber>;
            edited: z.ZodNullable<z.ZodBoolean>;
            origin: z.ZodNullable<z.ZodEnum<{
                fix: "fix";
                ai: "ai";
                own: "own";
            }>>;
            aiShare: z.ZodNullable<z.ZodNumber>;
            aiFeature: z.ZodNullable<z.ZodString>;
            aiText: z.ZodNullable<z.ZodString>;
            draft: z.ZodNullable<z.ZodString>;
            fixExpanded: z.ZodOptional<z.ZodBoolean>;
            replySeconds: z.ZodNullable<z.ZodNumber>;
            repeats: z.ZodNumber;
            marks: z.ZodArray<z.ZodEnum<{
                dash: "dash";
                cyrillic: "cyrillic";
                leak: "leak";
            }>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** A new follower of a page of the shift within it: a Fansly follow, an OnlyFans fan's first subscription to the page. */
declare const shiftReviewFollowSchema: z.ZodObject<{
    pageLabel: z.ZodString;
    fanRef: z.ZodNullable<z.ZodString>;
    fanUsername: z.ZodNullable<z.ZodString>;
    chatKey: z.ZodNullable<z.ZodString>;
    at: z.ZodString;
    kind: z.ZodEnum<{
        subscription: "subscription";
        follow: "follow";
    }>;
}, z.core.$strip>;
declare const shiftReviewSaleSchema: z.ZodObject<{
    saleRef: z.ZodString;
    at: z.ZodString;
    pageLabel: z.ZodString;
    fanRef: z.ZodNullable<z.ZodString>;
    fanName: z.ZodNullable<z.ZodString>;
    chatKey: z.ZodNullable<z.ZodString>;
    kind: z.ZodEnum<{
        subscription: "subscription";
        tip: "tip";
        post: "post";
        ppv: "ppv";
    }>;
    netMills: z.ZodNumber;
    verdict: z.ZodEnum<{
        none: "none";
        mine: "mine";
        both: "both";
        theirs: "theirs";
    }>;
    holderName: z.ZodNullable<z.ZodString>;
    ppvSender: z.ZodNullable<z.ZodString>;
    ppvSentAt: z.ZodNullable<z.ZodString>;
    lastWriter: z.ZodNullable<z.ZodString>;
    writers: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        messages: z.ZodNumber;
    }, z.core.$strip>>;
    origin: z.ZodEnum<{
        own: "own";
        colleague_ppv: "colleague_ppv";
        no_author_ppv: "no_author_ppv";
        other_wrote: "other_wrote";
        nobody_wrote_48h: "nobody_wrote_48h";
        post_tip: "post_tip";
        campaign: "campaign";
    }>;
    home: z.ZodOptional<z.ZodObject<{
        kind: z.ZodEnum<{
            unknown: "unknown";
            shift: "shift";
            waiting: "waiting";
            visit: "visit";
            pot: "pot";
            decide: "decide";
            nobody: "nobody";
            before_rule: "before_rule";
        }>;
        text: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const teamShiftReviewResponseSchema: z.ZodObject<{
    shift: z.ZodObject<{
        userId: z.ZodNumber;
        username: z.ZodString;
        kind: z.ZodEnum<{
            shift: "shift";
            visit: "visit";
        }>;
        startedAt: z.ZodString;
        endedAt: z.ZodString;
        ongoing: z.ZodBoolean;
        workedMinutes: z.ZodNumber;
        pauses: z.ZodArray<z.ZodObject<{
            from: z.ZodString;
            to: z.ZodString;
        }, z.core.$strip>>;
        lastInputAt: z.ZodString;
        lastBeatAt: z.ZodString;
        pages: z.ZodArray<z.ZodObject<{
            pageLabel: z.ZodString;
            platform: z.ZodString;
            messages: z.ZodNumber;
            worked: z.ZodBoolean;
            allFans: z.ZodOptional<z.ZodBoolean>;
            sales: z.ZodOptional<z.ZodObject<{
                netMills: z.ZodNumber;
                byKind: z.ZodArray<z.ZodObject<{
                    kind: z.ZodEnum<{
                        subscription: "subscription";
                        tip: "tip";
                        post: "post";
                        ppv: "ppv";
                    }>;
                    count: z.ZodNumber;
                    netMills: z.ZodNumber;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        salesNetMills: z.ZodNumber;
    }, z.core.$strip>;
    previousAt: z.ZodNullable<z.ZodString>;
    nextAt: z.ZodNullable<z.ZodString>;
    activity: z.ZodArray<z.ZodObject<{
        at: z.ZodString;
        input: z.ZodBoolean;
    }, z.core.$strip>>;
    chats: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        pageLabel: z.ZodString;
        platform: z.ZodString;
        conversationRef: z.ZodString;
        fanRef: z.ZodNullable<z.ZodString>;
        fanUsername: z.ZodNullable<z.ZodString>;
        fanDisplayName: z.ZodNullable<z.ZodString>;
        fanLifetimeNetMills: z.ZodNullable<z.ZodNumber>;
        shiftNetMills: z.ZodNumber;
        earlierHidden: z.ZodNumber;
        fanLastBefore: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        followedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        ai: z.ZodOptional<z.ZodArray<z.ZodObject<{
            feature: z.ZodString;
            count: z.ZodNumber;
        }, z.core.$strip>>>;
        messages: z.ZodArray<z.ZodObject<{
            ref: z.ZodString;
            at: z.ZodString;
            side: z.ZodEnum<{
                page: "page";
                fan: "fan";
            }>;
            text: z.ZodString;
            priceMills: z.ZodNullable<z.ZodNumber>;
            bought: z.ZodNullable<z.ZodBoolean>;
            tipMills: z.ZodNullable<z.ZodNumber>;
            media: z.ZodNumber;
            inShift: z.ZodBoolean;
            by: z.ZodNullable<z.ZodEnum<{
                other: "other";
                auto: "auto";
                none: "none";
                me: "me";
            }>>;
            mass: z.ZodBoolean;
            unarchived: z.ZodOptional<z.ZodBoolean>;
            deletedAt: z.ZodOptional<z.ZodString>;
            byName: z.ZodNullable<z.ZodString>;
            mine: z.ZodNullable<z.ZodObject<{
                composedWith: z.ZodNullable<z.ZodString>;
                part: z.ZodOptional<z.ZodNumber>;
                edited: z.ZodNullable<z.ZodBoolean>;
                origin: z.ZodNullable<z.ZodEnum<{
                    fix: "fix";
                    ai: "ai";
                    own: "own";
                }>>;
                aiShare: z.ZodNullable<z.ZodNumber>;
                aiFeature: z.ZodNullable<z.ZodString>;
                aiText: z.ZodNullable<z.ZodString>;
                draft: z.ZodNullable<z.ZodString>;
                fixExpanded: z.ZodOptional<z.ZodBoolean>;
                replySeconds: z.ZodNullable<z.ZodNumber>;
                repeats: z.ZodNumber;
                marks: z.ZodArray<z.ZodEnum<{
                    dash: "dash";
                    cyrillic: "cyrillic";
                    leak: "leak";
                }>>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    sales: z.ZodArray<z.ZodObject<{
        saleRef: z.ZodString;
        at: z.ZodString;
        pageLabel: z.ZodString;
        fanRef: z.ZodNullable<z.ZodString>;
        fanName: z.ZodNullable<z.ZodString>;
        chatKey: z.ZodNullable<z.ZodString>;
        kind: z.ZodEnum<{
            subscription: "subscription";
            tip: "tip";
            post: "post";
            ppv: "ppv";
        }>;
        netMills: z.ZodNumber;
        verdict: z.ZodEnum<{
            none: "none";
            mine: "mine";
            both: "both";
            theirs: "theirs";
        }>;
        holderName: z.ZodNullable<z.ZodString>;
        ppvSender: z.ZodNullable<z.ZodString>;
        ppvSentAt: z.ZodNullable<z.ZodString>;
        lastWriter: z.ZodNullable<z.ZodString>;
        writers: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            messages: z.ZodNumber;
        }, z.core.$strip>>;
        origin: z.ZodEnum<{
            own: "own";
            colleague_ppv: "colleague_ppv";
            no_author_ppv: "no_author_ppv";
            other_wrote: "other_wrote";
            nobody_wrote_48h: "nobody_wrote_48h";
            post_tip: "post_tip";
            campaign: "campaign";
        }>;
        home: z.ZodOptional<z.ZodObject<{
            kind: z.ZodEnum<{
                unknown: "unknown";
                shift: "shift";
                waiting: "waiting";
                visit: "visit";
                pot: "pot";
                decide: "decide";
                nobody: "nobody";
                before_rule: "before_rule";
            }>;
            text: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    beforeSales: z.ZodArray<z.ZodObject<{
        saleRef: z.ZodString;
        at: z.ZodString;
        pageLabel: z.ZodString;
        fanRef: z.ZodNullable<z.ZodString>;
        fanName: z.ZodNullable<z.ZodString>;
        chatKey: z.ZodNullable<z.ZodString>;
        kind: z.ZodEnum<{
            subscription: "subscription";
            tip: "tip";
            post: "post";
            ppv: "ppv";
        }>;
        netMills: z.ZodNumber;
        verdict: z.ZodEnum<{
            none: "none";
            mine: "mine";
            both: "both";
            theirs: "theirs";
        }>;
        holderName: z.ZodNullable<z.ZodString>;
        ppvSender: z.ZodNullable<z.ZodString>;
        ppvSentAt: z.ZodNullable<z.ZodString>;
        lastWriter: z.ZodNullable<z.ZodString>;
        writers: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            messages: z.ZodNumber;
        }, z.core.$strip>>;
        origin: z.ZodEnum<{
            own: "own";
            colleague_ppv: "colleague_ppv";
            no_author_ppv: "no_author_ppv";
            other_wrote: "other_wrote";
            nobody_wrote_48h: "nobody_wrote_48h";
            post_tip: "post_tip";
            campaign: "campaign";
        }>;
        home: z.ZodOptional<z.ZodObject<{
            kind: z.ZodEnum<{
                unknown: "unknown";
                shift: "shift";
                waiting: "waiting";
                visit: "visit";
                pot: "pot";
                decide: "decide";
                nobody: "nobody";
                before_rule: "before_rule";
            }>;
            text: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    laterSales: z.ZodArray<z.ZodObject<{
        saleRef: z.ZodString;
        at: z.ZodString;
        pageLabel: z.ZodString;
        fanRef: z.ZodNullable<z.ZodString>;
        fanName: z.ZodNullable<z.ZodString>;
        chatKey: z.ZodNullable<z.ZodString>;
        kind: z.ZodEnum<{
            subscription: "subscription";
            tip: "tip";
            post: "post";
            ppv: "ppv";
        }>;
        netMills: z.ZodNumber;
        verdict: z.ZodEnum<{
            none: "none";
            mine: "mine";
            both: "both";
            theirs: "theirs";
        }>;
        holderName: z.ZodNullable<z.ZodString>;
        ppvSender: z.ZodNullable<z.ZodString>;
        ppvSentAt: z.ZodNullable<z.ZodString>;
        lastWriter: z.ZodNullable<z.ZodString>;
        writers: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            messages: z.ZodNumber;
        }, z.core.$strip>>;
        origin: z.ZodEnum<{
            own: "own";
            colleague_ppv: "colleague_ppv";
            no_author_ppv: "no_author_ppv";
            other_wrote: "other_wrote";
            nobody_wrote_48h: "nobody_wrote_48h";
            post_tip: "post_tip";
            campaign: "campaign";
        }>;
        home: z.ZodOptional<z.ZodObject<{
            kind: z.ZodEnum<{
                unknown: "unknown";
                shift: "shift";
                waiting: "waiting";
                visit: "visit";
                pot: "pot";
                decide: "decide";
                nobody: "nobody";
                before_rule: "before_rule";
            }>;
            text: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    withoutShiftSales: z.ZodOptional<z.ZodArray<z.ZodObject<{
        saleRef: z.ZodString;
        at: z.ZodString;
        pageLabel: z.ZodString;
        fanRef: z.ZodNullable<z.ZodString>;
        fanName: z.ZodNullable<z.ZodString>;
        chatKey: z.ZodNullable<z.ZodString>;
        kind: z.ZodEnum<{
            subscription: "subscription";
            tip: "tip";
            post: "post";
            ppv: "ppv";
        }>;
        netMills: z.ZodNumber;
        verdict: z.ZodEnum<{
            none: "none";
            mine: "mine";
            both: "both";
            theirs: "theirs";
        }>;
        holderName: z.ZodNullable<z.ZodString>;
        ppvSender: z.ZodNullable<z.ZodString>;
        ppvSentAt: z.ZodNullable<z.ZodString>;
        lastWriter: z.ZodNullable<z.ZodString>;
        writers: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            messages: z.ZodNumber;
        }, z.core.$strip>>;
        origin: z.ZodEnum<{
            own: "own";
            colleague_ppv: "colleague_ppv";
            no_author_ppv: "no_author_ppv";
            other_wrote: "other_wrote";
            nobody_wrote_48h: "nobody_wrote_48h";
            post_tip: "post_tip";
            campaign: "campaign";
        }>;
        home: z.ZodOptional<z.ZodObject<{
            kind: z.ZodEnum<{
                unknown: "unknown";
                shift: "shift";
                waiting: "waiting";
                visit: "visit";
                pot: "pot";
                decide: "decide";
                nobody: "nobody";
                before_rule: "before_rule";
            }>;
            text: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>>;
    waits: z.ZodArray<z.ZodObject<{
        chat: z.ZodString;
        since: z.ZodString;
        from: z.ZodString;
        to: z.ZodString;
        by: z.ZodNullable<z.ZodEnum<{
            other: "other";
            none: "none";
            me: "me";
        }>>;
        pending: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
    follows: z.ZodOptional<z.ZodArray<z.ZodObject<{
        pageLabel: z.ZodString;
        fanRef: z.ZodNullable<z.ZodString>;
        fanUsername: z.ZodNullable<z.ZodString>;
        chatKey: z.ZodNullable<z.ZodString>;
        at: z.ZodString;
        kind: z.ZodEnum<{
            subscription: "subscription";
            follow: "follow";
        }>;
    }, z.core.$strip>>>;
    aiUse: z.ZodOptional<z.ZodArray<z.ZodObject<{
        pageLabel: z.ZodString;
        feature: z.ZodString;
        count: z.ZodNumber;
    }, z.core.$strip>>>;
    unarchived: z.ZodNumber;
    deleted: z.ZodNumber;
    ruleFrom: z.ZodOptional<z.ZodString>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export type TeamShiftReviewQuery = z.infer<typeof teamShiftReviewQuerySchema>;
export type TeamShiftReviewResponse = z.infer<typeof teamShiftReviewResponseSchema>;
export type ShiftReviewChat = z.infer<typeof shiftReviewChatSchema>;
export type ShiftReviewMessage = z.infer<typeof shiftReviewMessageSchema>;
export type ShiftReviewMine = z.infer<typeof shiftReviewMineSchema>;
export type ShiftReviewSale = z.infer<typeof shiftReviewSaleSchema>;
export type ShiftReviewFollow = z.infer<typeof shiftReviewFollowSchema>;
export type ShiftReviewSaleOrigin = (typeof SHIFT_REVIEW_SALE_ORIGINS)[number];
export declare const shiftReviewRouteSchemas: {
    readonly teamShiftReview: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "One chatter's shift opened up: its pulse, every chat, and where each message's text came from";
        readonly description: string;
        readonly querystring: z.ZodObject<{
            userId: z.ZodCoercedNumber<unknown>;
            at: z.ZodISODateTime;
        }, z.core.$strip>;
        readonly response: {
            readonly 200: z.ZodObject<{
                shift: z.ZodObject<{
                    userId: z.ZodNumber;
                    username: z.ZodString;
                    kind: z.ZodEnum<{
                        shift: "shift";
                        visit: "visit";
                    }>;
                    startedAt: z.ZodString;
                    endedAt: z.ZodString;
                    ongoing: z.ZodBoolean;
                    workedMinutes: z.ZodNumber;
                    pauses: z.ZodArray<z.ZodObject<{
                        from: z.ZodString;
                        to: z.ZodString;
                    }, z.core.$strip>>;
                    lastInputAt: z.ZodString;
                    lastBeatAt: z.ZodString;
                    pages: z.ZodArray<z.ZodObject<{
                        pageLabel: z.ZodString;
                        platform: z.ZodString;
                        messages: z.ZodNumber;
                        worked: z.ZodBoolean;
                        allFans: z.ZodOptional<z.ZodBoolean>;
                        sales: z.ZodOptional<z.ZodObject<{
                            netMills: z.ZodNumber;
                            byKind: z.ZodArray<z.ZodObject<{
                                kind: z.ZodEnum<{
                                    subscription: "subscription";
                                    tip: "tip";
                                    post: "post";
                                    ppv: "ppv";
                                }>;
                                count: z.ZodNumber;
                                netMills: z.ZodNumber;
                            }, z.core.$strip>>;
                        }, z.core.$strip>>;
                    }, z.core.$strip>>;
                    salesNetMills: z.ZodNumber;
                }, z.core.$strip>;
                previousAt: z.ZodNullable<z.ZodString>;
                nextAt: z.ZodNullable<z.ZodString>;
                activity: z.ZodArray<z.ZodObject<{
                    at: z.ZodString;
                    input: z.ZodBoolean;
                }, z.core.$strip>>;
                chats: z.ZodArray<z.ZodObject<{
                    key: z.ZodString;
                    pageLabel: z.ZodString;
                    platform: z.ZodString;
                    conversationRef: z.ZodString;
                    fanRef: z.ZodNullable<z.ZodString>;
                    fanUsername: z.ZodNullable<z.ZodString>;
                    fanDisplayName: z.ZodNullable<z.ZodString>;
                    fanLifetimeNetMills: z.ZodNullable<z.ZodNumber>;
                    shiftNetMills: z.ZodNumber;
                    earlierHidden: z.ZodNumber;
                    fanLastBefore: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    followedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    ai: z.ZodOptional<z.ZodArray<z.ZodObject<{
                        feature: z.ZodString;
                        count: z.ZodNumber;
                    }, z.core.$strip>>>;
                    messages: z.ZodArray<z.ZodObject<{
                        ref: z.ZodString;
                        at: z.ZodString;
                        side: z.ZodEnum<{
                            page: "page";
                            fan: "fan";
                        }>;
                        text: z.ZodString;
                        priceMills: z.ZodNullable<z.ZodNumber>;
                        bought: z.ZodNullable<z.ZodBoolean>;
                        tipMills: z.ZodNullable<z.ZodNumber>;
                        media: z.ZodNumber;
                        inShift: z.ZodBoolean;
                        by: z.ZodNullable<z.ZodEnum<{
                            other: "other";
                            auto: "auto";
                            none: "none";
                            me: "me";
                        }>>;
                        mass: z.ZodBoolean;
                        unarchived: z.ZodOptional<z.ZodBoolean>;
                        deletedAt: z.ZodOptional<z.ZodString>;
                        byName: z.ZodNullable<z.ZodString>;
                        mine: z.ZodNullable<z.ZodObject<{
                            composedWith: z.ZodNullable<z.ZodString>;
                            part: z.ZodOptional<z.ZodNumber>;
                            edited: z.ZodNullable<z.ZodBoolean>;
                            origin: z.ZodNullable<z.ZodEnum<{
                                fix: "fix";
                                ai: "ai";
                                own: "own";
                            }>>;
                            aiShare: z.ZodNullable<z.ZodNumber>;
                            aiFeature: z.ZodNullable<z.ZodString>;
                            aiText: z.ZodNullable<z.ZodString>;
                            draft: z.ZodNullable<z.ZodString>;
                            fixExpanded: z.ZodOptional<z.ZodBoolean>;
                            replySeconds: z.ZodNullable<z.ZodNumber>;
                            repeats: z.ZodNumber;
                            marks: z.ZodArray<z.ZodEnum<{
                                dash: "dash";
                                cyrillic: "cyrillic";
                                leak: "leak";
                            }>>;
                        }, z.core.$strip>>;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                sales: z.ZodArray<z.ZodObject<{
                    saleRef: z.ZodString;
                    at: z.ZodString;
                    pageLabel: z.ZodString;
                    fanRef: z.ZodNullable<z.ZodString>;
                    fanName: z.ZodNullable<z.ZodString>;
                    chatKey: z.ZodNullable<z.ZodString>;
                    kind: z.ZodEnum<{
                        subscription: "subscription";
                        tip: "tip";
                        post: "post";
                        ppv: "ppv";
                    }>;
                    netMills: z.ZodNumber;
                    verdict: z.ZodEnum<{
                        none: "none";
                        mine: "mine";
                        both: "both";
                        theirs: "theirs";
                    }>;
                    holderName: z.ZodNullable<z.ZodString>;
                    ppvSender: z.ZodNullable<z.ZodString>;
                    ppvSentAt: z.ZodNullable<z.ZodString>;
                    lastWriter: z.ZodNullable<z.ZodString>;
                    writers: z.ZodArray<z.ZodObject<{
                        name: z.ZodString;
                        messages: z.ZodNumber;
                    }, z.core.$strip>>;
                    origin: z.ZodEnum<{
                        own: "own";
                        colleague_ppv: "colleague_ppv";
                        no_author_ppv: "no_author_ppv";
                        other_wrote: "other_wrote";
                        nobody_wrote_48h: "nobody_wrote_48h";
                        post_tip: "post_tip";
                        campaign: "campaign";
                    }>;
                    home: z.ZodOptional<z.ZodObject<{
                        kind: z.ZodEnum<{
                            unknown: "unknown";
                            shift: "shift";
                            waiting: "waiting";
                            visit: "visit";
                            pot: "pot";
                            decide: "decide";
                            nobody: "nobody";
                            before_rule: "before_rule";
                        }>;
                        text: z.ZodString;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                beforeSales: z.ZodArray<z.ZodObject<{
                    saleRef: z.ZodString;
                    at: z.ZodString;
                    pageLabel: z.ZodString;
                    fanRef: z.ZodNullable<z.ZodString>;
                    fanName: z.ZodNullable<z.ZodString>;
                    chatKey: z.ZodNullable<z.ZodString>;
                    kind: z.ZodEnum<{
                        subscription: "subscription";
                        tip: "tip";
                        post: "post";
                        ppv: "ppv";
                    }>;
                    netMills: z.ZodNumber;
                    verdict: z.ZodEnum<{
                        none: "none";
                        mine: "mine";
                        both: "both";
                        theirs: "theirs";
                    }>;
                    holderName: z.ZodNullable<z.ZodString>;
                    ppvSender: z.ZodNullable<z.ZodString>;
                    ppvSentAt: z.ZodNullable<z.ZodString>;
                    lastWriter: z.ZodNullable<z.ZodString>;
                    writers: z.ZodArray<z.ZodObject<{
                        name: z.ZodString;
                        messages: z.ZodNumber;
                    }, z.core.$strip>>;
                    origin: z.ZodEnum<{
                        own: "own";
                        colleague_ppv: "colleague_ppv";
                        no_author_ppv: "no_author_ppv";
                        other_wrote: "other_wrote";
                        nobody_wrote_48h: "nobody_wrote_48h";
                        post_tip: "post_tip";
                        campaign: "campaign";
                    }>;
                    home: z.ZodOptional<z.ZodObject<{
                        kind: z.ZodEnum<{
                            unknown: "unknown";
                            shift: "shift";
                            waiting: "waiting";
                            visit: "visit";
                            pot: "pot";
                            decide: "decide";
                            nobody: "nobody";
                            before_rule: "before_rule";
                        }>;
                        text: z.ZodString;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                laterSales: z.ZodArray<z.ZodObject<{
                    saleRef: z.ZodString;
                    at: z.ZodString;
                    pageLabel: z.ZodString;
                    fanRef: z.ZodNullable<z.ZodString>;
                    fanName: z.ZodNullable<z.ZodString>;
                    chatKey: z.ZodNullable<z.ZodString>;
                    kind: z.ZodEnum<{
                        subscription: "subscription";
                        tip: "tip";
                        post: "post";
                        ppv: "ppv";
                    }>;
                    netMills: z.ZodNumber;
                    verdict: z.ZodEnum<{
                        none: "none";
                        mine: "mine";
                        both: "both";
                        theirs: "theirs";
                    }>;
                    holderName: z.ZodNullable<z.ZodString>;
                    ppvSender: z.ZodNullable<z.ZodString>;
                    ppvSentAt: z.ZodNullable<z.ZodString>;
                    lastWriter: z.ZodNullable<z.ZodString>;
                    writers: z.ZodArray<z.ZodObject<{
                        name: z.ZodString;
                        messages: z.ZodNumber;
                    }, z.core.$strip>>;
                    origin: z.ZodEnum<{
                        own: "own";
                        colleague_ppv: "colleague_ppv";
                        no_author_ppv: "no_author_ppv";
                        other_wrote: "other_wrote";
                        nobody_wrote_48h: "nobody_wrote_48h";
                        post_tip: "post_tip";
                        campaign: "campaign";
                    }>;
                    home: z.ZodOptional<z.ZodObject<{
                        kind: z.ZodEnum<{
                            unknown: "unknown";
                            shift: "shift";
                            waiting: "waiting";
                            visit: "visit";
                            pot: "pot";
                            decide: "decide";
                            nobody: "nobody";
                            before_rule: "before_rule";
                        }>;
                        text: z.ZodString;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                withoutShiftSales: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    saleRef: z.ZodString;
                    at: z.ZodString;
                    pageLabel: z.ZodString;
                    fanRef: z.ZodNullable<z.ZodString>;
                    fanName: z.ZodNullable<z.ZodString>;
                    chatKey: z.ZodNullable<z.ZodString>;
                    kind: z.ZodEnum<{
                        subscription: "subscription";
                        tip: "tip";
                        post: "post";
                        ppv: "ppv";
                    }>;
                    netMills: z.ZodNumber;
                    verdict: z.ZodEnum<{
                        none: "none";
                        mine: "mine";
                        both: "both";
                        theirs: "theirs";
                    }>;
                    holderName: z.ZodNullable<z.ZodString>;
                    ppvSender: z.ZodNullable<z.ZodString>;
                    ppvSentAt: z.ZodNullable<z.ZodString>;
                    lastWriter: z.ZodNullable<z.ZodString>;
                    writers: z.ZodArray<z.ZodObject<{
                        name: z.ZodString;
                        messages: z.ZodNumber;
                    }, z.core.$strip>>;
                    origin: z.ZodEnum<{
                        own: "own";
                        colleague_ppv: "colleague_ppv";
                        no_author_ppv: "no_author_ppv";
                        other_wrote: "other_wrote";
                        nobody_wrote_48h: "nobody_wrote_48h";
                        post_tip: "post_tip";
                        campaign: "campaign";
                    }>;
                    home: z.ZodOptional<z.ZodObject<{
                        kind: z.ZodEnum<{
                            unknown: "unknown";
                            shift: "shift";
                            waiting: "waiting";
                            visit: "visit";
                            pot: "pot";
                            decide: "decide";
                            nobody: "nobody";
                            before_rule: "before_rule";
                        }>;
                        text: z.ZodString;
                    }, z.core.$strip>>;
                }, z.core.$strip>>>;
                waits: z.ZodArray<z.ZodObject<{
                    chat: z.ZodString;
                    since: z.ZodString;
                    from: z.ZodString;
                    to: z.ZodString;
                    by: z.ZodNullable<z.ZodEnum<{
                        other: "other";
                        none: "none";
                        me: "me";
                    }>>;
                    pending: z.ZodOptional<z.ZodBoolean>;
                }, z.core.$strip>>;
                follows: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    pageLabel: z.ZodString;
                    fanRef: z.ZodNullable<z.ZodString>;
                    fanUsername: z.ZodNullable<z.ZodString>;
                    chatKey: z.ZodNullable<z.ZodString>;
                    at: z.ZodString;
                    kind: z.ZodEnum<{
                        subscription: "subscription";
                        follow: "follow";
                    }>;
                }, z.core.$strip>>>;
                aiUse: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    pageLabel: z.ZodString;
                    feature: z.ZodString;
                    count: z.ZodNumber;
                }, z.core.$strip>>>;
                unarchived: z.ZodNumber;
                deleted: z.ZodNumber;
                ruleFrom: z.ZodOptional<z.ZodString>;
                serverNow: z.ZodString;
            }, z.core.$strip>;
            readonly 400: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 401: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 403: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 404: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    };
};
export {};
