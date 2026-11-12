import { z } from "zod";
export declare const agentShiftReviewQuerySchema: z.ZodObject<{
    at: z.ZodISODateTime;
    userId: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    person: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** `shiftAuditNumbers` on the wire: by page and in total. */
export declare const shiftAuditReportSchema: z.ZodObject<{
    pages: z.ZodArray<z.ZodObject<{
        chats: z.ZodNumber;
        messages: z.ZodNumber;
        fanMessages: z.ZodNumber;
        massMessages: z.ZodNumber;
        unauthored: z.ZodNumber;
        others: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            messages: z.ZodNumber;
        }, z.core.$strip>>;
        ppvSent: z.ZodNumber;
        ppvBought: z.ZodNumber;
        replies: z.ZodNumber;
        replyMedianSeconds: z.ZodNullable<z.ZodNumber>;
        repliesOver15: z.ZodNumber;
        longestReplySeconds: z.ZodNullable<z.ZodNumber>;
        longestReplyChat: z.ZodNullable<z.ZodString>;
        waitingAtStart: z.ZodNumber;
        waitingAtStartWritten: z.ZodNumber;
        waitingAtEnd: z.ZodNumber;
        fanUnattended: z.ZodNumber;
        follows: z.ZodNumber;
        followsWritten: z.ZodNumber;
        followsWrittenSoon: z.ZodNumber;
        reactivations: z.ZodNumber;
        reactivationsAnswered: z.ZodNumber;
        salesNetMills: z.ZodNumber;
        tipsNetMills: z.ZodNumber;
        subscriptionsNetMills: z.ZodNumber;
        ppvPurchases: z.ZodNumber;
        ai: z.ZodRecord<z.ZodString, z.ZodNumber>;
        pageLabel: z.ZodString;
    }, z.core.$strip>>;
    total: z.ZodObject<{
        chats: z.ZodNumber;
        messages: z.ZodNumber;
        fanMessages: z.ZodNumber;
        massMessages: z.ZodNumber;
        unauthored: z.ZodNumber;
        others: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            messages: z.ZodNumber;
        }, z.core.$strip>>;
        ppvSent: z.ZodNumber;
        ppvBought: z.ZodNumber;
        replies: z.ZodNumber;
        replyMedianSeconds: z.ZodNullable<z.ZodNumber>;
        repliesOver15: z.ZodNumber;
        longestReplySeconds: z.ZodNullable<z.ZodNumber>;
        longestReplyChat: z.ZodNullable<z.ZodString>;
        waitingAtStart: z.ZodNumber;
        waitingAtStartWritten: z.ZodNumber;
        waitingAtEnd: z.ZodNumber;
        fanUnattended: z.ZodNumber;
        follows: z.ZodNumber;
        followsWritten: z.ZodNumber;
        followsWrittenSoon: z.ZodNumber;
        reactivations: z.ZodNumber;
        reactivationsAnswered: z.ZodNumber;
        salesNetMills: z.ZodNumber;
        tipsNetMills: z.ZodNumber;
        subscriptionsNetMills: z.ZodNumber;
        ppvPurchases: z.ZodNumber;
        ai: z.ZodRecord<z.ZodString, z.ZodNumber>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const agentShiftReviewResponseSchema: z.ZodObject<{
    review: z.ZodObject<{
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
    numbers: z.ZodObject<{
        pages: z.ZodArray<z.ZodObject<{
            chats: z.ZodNumber;
            messages: z.ZodNumber;
            fanMessages: z.ZodNumber;
            massMessages: z.ZodNumber;
            unauthored: z.ZodNumber;
            others: z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                messages: z.ZodNumber;
            }, z.core.$strip>>;
            ppvSent: z.ZodNumber;
            ppvBought: z.ZodNumber;
            replies: z.ZodNumber;
            replyMedianSeconds: z.ZodNullable<z.ZodNumber>;
            repliesOver15: z.ZodNumber;
            longestReplySeconds: z.ZodNullable<z.ZodNumber>;
            longestReplyChat: z.ZodNullable<z.ZodString>;
            waitingAtStart: z.ZodNumber;
            waitingAtStartWritten: z.ZodNumber;
            waitingAtEnd: z.ZodNumber;
            fanUnattended: z.ZodNumber;
            follows: z.ZodNumber;
            followsWritten: z.ZodNumber;
            followsWrittenSoon: z.ZodNumber;
            reactivations: z.ZodNumber;
            reactivationsAnswered: z.ZodNumber;
            salesNetMills: z.ZodNumber;
            tipsNetMills: z.ZodNumber;
            subscriptionsNetMills: z.ZodNumber;
            ppvPurchases: z.ZodNumber;
            ai: z.ZodRecord<z.ZodString, z.ZodNumber>;
            pageLabel: z.ZodString;
        }, z.core.$strip>>;
        total: z.ZodObject<{
            chats: z.ZodNumber;
            messages: z.ZodNumber;
            fanMessages: z.ZodNumber;
            massMessages: z.ZodNumber;
            unauthored: z.ZodNumber;
            others: z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                messages: z.ZodNumber;
            }, z.core.$strip>>;
            ppvSent: z.ZodNumber;
            ppvBought: z.ZodNumber;
            replies: z.ZodNumber;
            replyMedianSeconds: z.ZodNullable<z.ZodNumber>;
            repliesOver15: z.ZodNumber;
            longestReplySeconds: z.ZodNullable<z.ZodNumber>;
            longestReplyChat: z.ZodNullable<z.ZodString>;
            waitingAtStart: z.ZodNumber;
            waitingAtStartWritten: z.ZodNumber;
            waitingAtEnd: z.ZodNumber;
            fanUnattended: z.ZodNumber;
            follows: z.ZodNumber;
            followsWritten: z.ZodNumber;
            followsWrittenSoon: z.ZodNumber;
            reactivations: z.ZodNumber;
            reactivationsAnswered: z.ZodNumber;
            salesNetMills: z.ZodNumber;
            tipsNetMills: z.ZodNumber;
            subscriptionsNetMills: z.ZodNumber;
            ppvPurchases: z.ZodNumber;
            ai: z.ZodRecord<z.ZodString, z.ZodNumber>;
        }, z.core.$strip>;
    }, z.core.$strip>;
    texts: z.ZodBoolean;
    pagesLeftOut: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
/** At most this many of the fan's messages per watch in one answer. */
export declare const AGENT_FAN_WATCH_MESSAGES_MAX = 200;
export declare const agentFanWatchBodySchema: z.ZodObject<{
    watches: z.ZodArray<z.ZodObject<{
        pageLabel: z.ZodString;
        username: z.ZodString;
        since: z.ZodISODateTime;
        archivedAfter: z.ZodOptional<z.ZodISODateTime>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const agentFanWatchResponseSchema: z.ZodObject<{
    watches: z.ZodArray<z.ZodObject<{
        pageLabel: z.ZodString;
        username: z.ZodString;
        chats: z.ZodNumber;
        fanMessages: z.ZodArray<z.ZodObject<{
            ref: z.ZodString;
            at: z.ZodString;
            archivedAt: z.ZodString;
            text: z.ZodString;
            media: z.ZodBoolean;
            tipMills: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
        more: z.ZodBoolean;
        pageLastAt: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const agentSaleContextBodySchema: z.ZodObject<{
    sales: z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        saleRef: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        pageLabel: z.ZodString;
        transactionRef: z.ZodString;
    }, z.core.$strict>]>>;
}, z.core.$strict>;
export declare const agentSaleContextResponseSchema: z.ZodObject<{
    sales: z.ZodArray<z.ZodObject<{
        saleRef: z.ZodString;
        pageLabel: z.ZodString;
        transactionRef: z.ZodString;
        kind: z.ZodEnum<{
            subscription: "subscription";
            tip: "tip";
            post: "post";
            ppv: "ppv";
        }>;
        occurredAt: z.ZodString;
        grossMills: z.ZodNumber;
        netMills: z.ZodNumber;
        fanRef: z.ZodNullable<z.ZodString>;
        fanUsername: z.ZodNullable<z.ZodString>;
        ppv: z.ZodNullable<z.ZodObject<{
            sentAt: z.ZodNullable<z.ZodString>;
            sender: z.ZodNullable<z.ZodString>;
            text: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        postTip: z.ZodBoolean;
        campaign: z.ZodBoolean;
        writers48h: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            messages: z.ZodNumber;
        }, z.core.$strip>>;
        writers7d: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            messages: z.ZodNumber;
        }, z.core.$strip>>;
        lastWriter: z.ZodNullable<z.ZodObject<{
            name: z.ZodString;
            at: z.ZodString;
            within48h: z.ZodBoolean;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    notFound: z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        saleRef: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        pageLabel: z.ZodString;
        transactionRef: z.ZodString;
    }, z.core.$strict>]>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export type AgentShiftReviewQuery = z.infer<typeof agentShiftReviewQuerySchema>;
export type AgentShiftReviewResponse = z.infer<typeof agentShiftReviewResponseSchema>;
export type AgentFanWatchBody = z.infer<typeof agentFanWatchBodySchema>;
export type AgentFanWatchResponse = z.infer<typeof agentFanWatchResponseSchema>;
export type AgentSaleContextBody = z.infer<typeof agentSaleContextBodySchema>;
export type AgentSaleContextResponse = z.infer<typeof agentSaleContextResponseSchema>;
export declare const agentDoorRouteSchemas: {
    readonly agentShiftReview: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: string;
        readonly description: string;
        readonly querystring: z.ZodObject<{
            at: z.ZodISODateTime;
            userId: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
            person: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
        readonly response: {
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
            readonly 429: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 503: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 200: z.ZodObject<{
                review: z.ZodObject<{
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
                numbers: z.ZodObject<{
                    pages: z.ZodArray<z.ZodObject<{
                        chats: z.ZodNumber;
                        messages: z.ZodNumber;
                        fanMessages: z.ZodNumber;
                        massMessages: z.ZodNumber;
                        unauthored: z.ZodNumber;
                        others: z.ZodArray<z.ZodObject<{
                            name: z.ZodString;
                            messages: z.ZodNumber;
                        }, z.core.$strip>>;
                        ppvSent: z.ZodNumber;
                        ppvBought: z.ZodNumber;
                        replies: z.ZodNumber;
                        replyMedianSeconds: z.ZodNullable<z.ZodNumber>;
                        repliesOver15: z.ZodNumber;
                        longestReplySeconds: z.ZodNullable<z.ZodNumber>;
                        longestReplyChat: z.ZodNullable<z.ZodString>;
                        waitingAtStart: z.ZodNumber;
                        waitingAtStartWritten: z.ZodNumber;
                        waitingAtEnd: z.ZodNumber;
                        fanUnattended: z.ZodNumber;
                        follows: z.ZodNumber;
                        followsWritten: z.ZodNumber;
                        followsWrittenSoon: z.ZodNumber;
                        reactivations: z.ZodNumber;
                        reactivationsAnswered: z.ZodNumber;
                        salesNetMills: z.ZodNumber;
                        tipsNetMills: z.ZodNumber;
                        subscriptionsNetMills: z.ZodNumber;
                        ppvPurchases: z.ZodNumber;
                        ai: z.ZodRecord<z.ZodString, z.ZodNumber>;
                        pageLabel: z.ZodString;
                    }, z.core.$strip>>;
                    total: z.ZodObject<{
                        chats: z.ZodNumber;
                        messages: z.ZodNumber;
                        fanMessages: z.ZodNumber;
                        massMessages: z.ZodNumber;
                        unauthored: z.ZodNumber;
                        others: z.ZodArray<z.ZodObject<{
                            name: z.ZodString;
                            messages: z.ZodNumber;
                        }, z.core.$strip>>;
                        ppvSent: z.ZodNumber;
                        ppvBought: z.ZodNumber;
                        replies: z.ZodNumber;
                        replyMedianSeconds: z.ZodNullable<z.ZodNumber>;
                        repliesOver15: z.ZodNumber;
                        longestReplySeconds: z.ZodNullable<z.ZodNumber>;
                        longestReplyChat: z.ZodNullable<z.ZodString>;
                        waitingAtStart: z.ZodNumber;
                        waitingAtStartWritten: z.ZodNumber;
                        waitingAtEnd: z.ZodNumber;
                        fanUnattended: z.ZodNumber;
                        follows: z.ZodNumber;
                        followsWritten: z.ZodNumber;
                        followsWrittenSoon: z.ZodNumber;
                        reactivations: z.ZodNumber;
                        reactivationsAnswered: z.ZodNumber;
                        salesNetMills: z.ZodNumber;
                        tipsNetMills: z.ZodNumber;
                        subscriptionsNetMills: z.ZodNumber;
                        ppvPurchases: z.ZodNumber;
                        ai: z.ZodRecord<z.ZodString, z.ZodNumber>;
                    }, z.core.$strip>;
                }, z.core.$strip>;
                texts: z.ZodBoolean;
                pagesLeftOut: z.ZodArray<z.ZodString>;
            }, z.core.$strip>;
        };
    };
    readonly agentFanWatch: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: string;
        readonly body: z.ZodObject<{
            watches: z.ZodArray<z.ZodObject<{
                pageLabel: z.ZodString;
                username: z.ZodString;
                since: z.ZodISODateTime;
                archivedAfter: z.ZodOptional<z.ZodISODateTime>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        readonly response: {
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
            readonly 429: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 503: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 200: z.ZodObject<{
                watches: z.ZodArray<z.ZodObject<{
                    pageLabel: z.ZodString;
                    username: z.ZodString;
                    chats: z.ZodNumber;
                    fanMessages: z.ZodArray<z.ZodObject<{
                        ref: z.ZodString;
                        at: z.ZodString;
                        archivedAt: z.ZodString;
                        text: z.ZodString;
                        media: z.ZodBoolean;
                        tipMills: z.ZodNullable<z.ZodNumber>;
                    }, z.core.$strip>>;
                    more: z.ZodBoolean;
                    pageLastAt: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
                serverNow: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly agentSaleContext: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: string;
        readonly body: z.ZodObject<{
            sales: z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                saleRef: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                pageLabel: z.ZodString;
                transactionRef: z.ZodString;
            }, z.core.$strict>]>>;
        }, z.core.$strict>;
        readonly response: {
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
            readonly 429: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 503: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 200: z.ZodObject<{
                sales: z.ZodArray<z.ZodObject<{
                    saleRef: z.ZodString;
                    pageLabel: z.ZodString;
                    transactionRef: z.ZodString;
                    kind: z.ZodEnum<{
                        subscription: "subscription";
                        tip: "tip";
                        post: "post";
                        ppv: "ppv";
                    }>;
                    occurredAt: z.ZodString;
                    grossMills: z.ZodNumber;
                    netMills: z.ZodNumber;
                    fanRef: z.ZodNullable<z.ZodString>;
                    fanUsername: z.ZodNullable<z.ZodString>;
                    ppv: z.ZodNullable<z.ZodObject<{
                        sentAt: z.ZodNullable<z.ZodString>;
                        sender: z.ZodNullable<z.ZodString>;
                        text: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                    postTip: z.ZodBoolean;
                    campaign: z.ZodBoolean;
                    writers48h: z.ZodArray<z.ZodObject<{
                        name: z.ZodString;
                        messages: z.ZodNumber;
                    }, z.core.$strip>>;
                    writers7d: z.ZodArray<z.ZodObject<{
                        name: z.ZodString;
                        messages: z.ZodNumber;
                    }, z.core.$strip>>;
                    lastWriter: z.ZodNullable<z.ZodObject<{
                        name: z.ZodString;
                        at: z.ZodString;
                        within48h: z.ZodBoolean;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                notFound: z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                    saleRef: z.ZodString;
                }, z.core.$strict>, z.ZodObject<{
                    pageLabel: z.ZodString;
                    transactionRef: z.ZodString;
                }, z.core.$strict>]>>;
                serverNow: z.ZodString;
            }, z.core.$strip>;
        };
    };
};
