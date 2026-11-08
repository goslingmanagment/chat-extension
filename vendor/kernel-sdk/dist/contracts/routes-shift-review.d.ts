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
 * (a Fansly mass message, or one text with its price and files sent to
 * MASS_SEND_MIN_CHATS chats of a page or more in a clock hour). A wait runs from
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
/** A fan's message older than this before a reply is not waited on (as `teamChatterNumbers`). */
export declare const SHIFT_REVIEW_WAIT_HORIZON_HOURS = 72;
/** The person's previous and next shift are looked for this far from the shift. */
export declare const SHIFT_REVIEW_NEIGHBOUR_DAYS = 14;
export declare const SHIFT_REVIEW_ORIGINS: readonly ["ai", "fix", "own"];
export declare const SHIFT_REVIEW_MARKS: readonly ["dash", "cyrillic", "leak"];
export declare const SHIFT_REVIEW_AUTHORS: readonly ["me", "other", "none", "auto"];
export declare const teamShiftReviewQuerySchema: z.ZodObject<{
    userId: z.ZodCoercedNumber<unknown>;
    at: z.ZodISODateTime;
}, z.core.$strip>;
declare const shiftReviewMineSchema: z.ZodObject<{
    composedWith: z.ZodNullable<z.ZodString>;
    edited: z.ZodNullable<z.ZodBoolean>;
    origin: z.ZodNullable<z.ZodEnum<{
        fix: "fix";
        own: "own";
        ai: "ai";
    }>>;
    aiShare: z.ZodNullable<z.ZodNumber>;
    aiFeature: z.ZodNullable<z.ZodString>;
    aiText: z.ZodNullable<z.ZodString>;
    draft: z.ZodNullable<z.ZodString>;
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
    byName: z.ZodNullable<z.ZodString>;
    mine: z.ZodNullable<z.ZodObject<{
        composedWith: z.ZodNullable<z.ZodString>;
        edited: z.ZodNullable<z.ZodBoolean>;
        origin: z.ZodNullable<z.ZodEnum<{
            fix: "fix";
            own: "own";
            ai: "ai";
        }>>;
        aiShare: z.ZodNullable<z.ZodNumber>;
        aiFeature: z.ZodNullable<z.ZodString>;
        aiText: z.ZodNullable<z.ZodString>;
        draft: z.ZodNullable<z.ZodString>;
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
        byName: z.ZodNullable<z.ZodString>;
        mine: z.ZodNullable<z.ZodObject<{
            composedWith: z.ZodNullable<z.ZodString>;
            edited: z.ZodNullable<z.ZodBoolean>;
            origin: z.ZodNullable<z.ZodEnum<{
                fix: "fix";
                own: "own";
                ai: "ai";
            }>>;
            aiShare: z.ZodNullable<z.ZodNumber>;
            aiFeature: z.ZodNullable<z.ZodString>;
            aiText: z.ZodNullable<z.ZodString>;
            draft: z.ZodNullable<z.ZodString>;
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
            byName: z.ZodNullable<z.ZodString>;
            mine: z.ZodNullable<z.ZodObject<{
                composedWith: z.ZodNullable<z.ZodString>;
                edited: z.ZodNullable<z.ZodBoolean>;
                origin: z.ZodNullable<z.ZodEnum<{
                    fix: "fix";
                    own: "own";
                    ai: "ai";
                }>>;
                aiShare: z.ZodNullable<z.ZodNumber>;
                aiFeature: z.ZodNullable<z.ZodString>;
                aiText: z.ZodNullable<z.ZodString>;
                draft: z.ZodNullable<z.ZodString>;
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
    }, z.core.$strip>>;
    unarchived: z.ZodNumber;
    deleted: z.ZodNumber;
    serverNow: z.ZodString;
}, z.core.$strip>;
export type TeamShiftReviewQuery = z.infer<typeof teamShiftReviewQuerySchema>;
export type TeamShiftReviewResponse = z.infer<typeof teamShiftReviewResponseSchema>;
export type ShiftReviewChat = z.infer<typeof shiftReviewChatSchema>;
export type ShiftReviewMessage = z.infer<typeof shiftReviewMessageSchema>;
export type ShiftReviewMine = z.infer<typeof shiftReviewMineSchema>;
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
                        byName: z.ZodNullable<z.ZodString>;
                        mine: z.ZodNullable<z.ZodObject<{
                            composedWith: z.ZodNullable<z.ZodString>;
                            edited: z.ZodNullable<z.ZodBoolean>;
                            origin: z.ZodNullable<z.ZodEnum<{
                                fix: "fix";
                                own: "own";
                                ai: "ai";
                            }>>;
                            aiShare: z.ZodNullable<z.ZodNumber>;
                            aiFeature: z.ZodNullable<z.ZodString>;
                            aiText: z.ZodNullable<z.ZodString>;
                            draft: z.ZodNullable<z.ZodString>;
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
                }, z.core.$strip>>;
                unarchived: z.ZodNumber;
                deleted: z.ZodNumber;
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
