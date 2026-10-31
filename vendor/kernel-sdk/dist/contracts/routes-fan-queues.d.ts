export declare const fanQueueRouteSchemas: {
    readonly agentFanQueuePreview: {
        readonly auth: {
            readonly kind: "agentKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["agent"];
        readonly summary: string;
        readonly params: import("zod").ZodObject<{
            pageLabel: import("zod").ZodString;
        }, import("zod/v4/core").$strip>;
        readonly body: import("zod").ZodObject<{
            rule: import("zod").ZodOptional<import("zod").ZodObject<{
                audience: import("zod").ZodOptional<import("zod").ZodEnum<{
                    subscribers: "subscribers";
                    expired: "expired";
                    followers: "followers";
                    any: "any";
                }>>;
                fanWrote: import("zod").ZodOptional<import("zod").ZodEnum<{
                    never: "never";
                    ever: "ever";
                }>>;
                fanLastMessage: import("zod").ZodOptional<import("zod").ZodObject<{
                    olderThanDays: import("zod").ZodOptional<import("zod").ZodNumber>;
                    withinDays: import("zod").ZodOptional<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strict>>;
                pagePersonal: import("zod").ZodOptional<import("zod").ZodUnion<readonly [import("zod").ZodLiteral<"never">, import("zod").ZodObject<{
                    olderThanDays: import("zod").ZodOptional<import("zod").ZodNumber>;
                    withinDays: import("zod").ZodOptional<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strict>]>>;
                lifetimeSpend: import("zod").ZodOptional<import("zod").ZodObject<{
                    min: import("zod").ZodOptional<import("zod").ZodNumber>;
                    max: import("zod").ZodOptional<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strict>>;
                spend30d: import("zod").ZodOptional<import("zod").ZodObject<{
                    min: import("zod").ZodOptional<import("zod").ZodNumber>;
                    max: import("zod").ZodOptional<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strict>>;
                lastPurchase: import("zod").ZodOptional<import("zod").ZodObject<{
                    olderThanDays: import("zod").ZodOptional<import("zod").ZodNumber>;
                    withinDays: import("zod").ZodOptional<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strict>>;
                followed: import("zod").ZodOptional<import("zod").ZodObject<{
                    olderThanDays: import("zod").ZodOptional<import("zod").ZodNumber>;
                    withinDays: import("zod").ZodOptional<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strict>>;
                subscribed: import("zod").ZodOptional<import("zod").ZodObject<{
                    olderThanDays: import("zod").ZodOptional<import("zod").ZodNumber>;
                    withinDays: import("zod").ZodOptional<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strict>>;
                subscriptionEnds: import("zod").ZodOptional<import("zod").ZodObject<{
                    withinDays: import("zod").ZodNumber;
                }, import("zod/v4/core").$strict>>;
                autoRenew: import("zod").ZodOptional<import("zod").ZodBoolean>;
                seen: import("zod").ZodOptional<import("zod").ZodUnion<readonly [import("zod").ZodObject<{
                    withinDays: import("zod").ZodNumber;
                }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
                    notWithinDays: import("zod").ZodNumber;
                }, import("zod/v4/core").$strict>]>>;
                otherPagesSpend: import("zod").ZodOptional<import("zod").ZodObject<{
                    min: import("zod").ZodOptional<import("zod").ZodNumber>;
                    max: import("zod").ZodOptional<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strict>>;
                markers: import("zod").ZodOptional<import("zod").ZodObject<{
                    include: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
                    exclude: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
                }, import("zod/v4/core").$strict>>;
                order: import("zod").ZodOptional<import("zod").ZodEnum<{
                    spend: "spend";
                    seen: "seen";
                    followed_new: "followed_new";
                    followed_old: "followed_old";
                    fan_message: "fan_message";
                    random: "random";
                }>>;
                limit: import("zod").ZodOptional<import("zod").ZodNumber>;
            }, import("zod/v4/core").$strict>>;
            fans: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodObject<{
                ref: import("zod").ZodString;
                why: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strict>>>;
            dailyLimit: import("zod").ZodOptional<import("zod").ZodNumber>;
        }, import("zod/v4/core").$strict>;
        readonly response: {
            readonly 400: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 401: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 403: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 404: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 409: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 429: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 503: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 200: import("zod").ZodObject<{
                pageLabel: import("zod").ZodString;
                ruleText: import("zod").ZodArray<import("zod").ZodString>;
                count: import("zod").ZodNumber;
                excluded: import("zod").ZodObject<{
                    unreachable: import("zod").ZodNumber;
                    dismissed: import("zod").ZodNumber;
                    inOtherQueues: import("zod").ZodNumber;
                    markers: import("zod").ZodNumber;
                    notFound: import("zod").ZodNumber;
                    overLimit: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>;
                samples: import("zod").ZodArray<import("zod").ZodObject<{
                    fanRef: import("zod").ZodString;
                    username: import("zod").ZodNullable<import("zod").ZodString>;
                    displayName: import("zod").ZodNullable<import("zod").ZodString>;
                    why: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                historyIncomplete: import("zod").ZodNumber;
                daysAtLimit: import("zod").ZodNullable<import("zod").ZodNumber>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly agentFanQueueCreate: {
        readonly auth: {
            readonly kind: "agentKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["agent"];
        readonly summary: string;
        readonly params: import("zod").ZodObject<{
            pageLabel: import("zod").ZodString;
        }, import("zod/v4/core").$strip>;
        readonly body: import("zod").ZodObject<{
            name: import("zod").ZodString;
            goal: import("zod").ZodOptional<import("zod").ZodString>;
            kind: import("zod").ZodDefault<import("zod").ZodEnum<{
                campaign: "campaign";
                standing: "standing";
            }>>;
            rule: import("zod").ZodOptional<import("zod").ZodObject<{
                audience: import("zod").ZodOptional<import("zod").ZodEnum<{
                    subscribers: "subscribers";
                    expired: "expired";
                    followers: "followers";
                    any: "any";
                }>>;
                fanWrote: import("zod").ZodOptional<import("zod").ZodEnum<{
                    never: "never";
                    ever: "ever";
                }>>;
                fanLastMessage: import("zod").ZodOptional<import("zod").ZodObject<{
                    olderThanDays: import("zod").ZodOptional<import("zod").ZodNumber>;
                    withinDays: import("zod").ZodOptional<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strict>>;
                pagePersonal: import("zod").ZodOptional<import("zod").ZodUnion<readonly [import("zod").ZodLiteral<"never">, import("zod").ZodObject<{
                    olderThanDays: import("zod").ZodOptional<import("zod").ZodNumber>;
                    withinDays: import("zod").ZodOptional<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strict>]>>;
                lifetimeSpend: import("zod").ZodOptional<import("zod").ZodObject<{
                    min: import("zod").ZodOptional<import("zod").ZodNumber>;
                    max: import("zod").ZodOptional<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strict>>;
                spend30d: import("zod").ZodOptional<import("zod").ZodObject<{
                    min: import("zod").ZodOptional<import("zod").ZodNumber>;
                    max: import("zod").ZodOptional<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strict>>;
                lastPurchase: import("zod").ZodOptional<import("zod").ZodObject<{
                    olderThanDays: import("zod").ZodOptional<import("zod").ZodNumber>;
                    withinDays: import("zod").ZodOptional<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strict>>;
                followed: import("zod").ZodOptional<import("zod").ZodObject<{
                    olderThanDays: import("zod").ZodOptional<import("zod").ZodNumber>;
                    withinDays: import("zod").ZodOptional<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strict>>;
                subscribed: import("zod").ZodOptional<import("zod").ZodObject<{
                    olderThanDays: import("zod").ZodOptional<import("zod").ZodNumber>;
                    withinDays: import("zod").ZodOptional<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strict>>;
                subscriptionEnds: import("zod").ZodOptional<import("zod").ZodObject<{
                    withinDays: import("zod").ZodNumber;
                }, import("zod/v4/core").$strict>>;
                autoRenew: import("zod").ZodOptional<import("zod").ZodBoolean>;
                seen: import("zod").ZodOptional<import("zod").ZodUnion<readonly [import("zod").ZodObject<{
                    withinDays: import("zod").ZodNumber;
                }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
                    notWithinDays: import("zod").ZodNumber;
                }, import("zod/v4/core").$strict>]>>;
                otherPagesSpend: import("zod").ZodOptional<import("zod").ZodObject<{
                    min: import("zod").ZodOptional<import("zod").ZodNumber>;
                    max: import("zod").ZodOptional<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strict>>;
                markers: import("zod").ZodOptional<import("zod").ZodObject<{
                    include: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
                    exclude: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
                }, import("zod/v4/core").$strict>>;
                order: import("zod").ZodOptional<import("zod").ZodEnum<{
                    spend: "spend";
                    seen: "seen";
                    followed_new: "followed_new";
                    followed_old: "followed_old";
                    fan_message: "fan_message";
                    random: "random";
                }>>;
                limit: import("zod").ZodOptional<import("zod").ZodNumber>;
            }, import("zod/v4/core").$strict>>;
            fans: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodObject<{
                ref: import("zod").ZodString;
                why: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strict>>>;
            scenario: import("zod").ZodObject<{
                action: import("zod").ZodEnum<{
                    ping: "ping";
                    auto: "auto";
                    reply: "reply";
                    hi: "hi";
                    template: "template";
                    own: "own";
                }>;
                sendMode: import("zod").ZodDefault<import("zod").ZodEnum<{
                    one: "one";
                    batch: "batch";
                }>>;
                templates: import("zod").ZodOptional<import("zod").ZodEnum<{
                    a: "a";
                    b: "b";
                }>>;
                texts: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
                hint: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strict>;
            distribution: import("zod").ZodDefault<import("zod").ZodEnum<{
                people: "people";
                pool: "pool";
            }>>;
            people: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
            split: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodObject<{
                username: import("zod").ZodString;
                count: import("zod").ZodNumber;
            }, import("zod/v4/core").$strict>>>;
            perPerson: import("zod").ZodOptional<import("zod").ZodNumber>;
            dailyLimit: import("zod").ZodOptional<import("zod").ZodNumber>;
            endsAt: import("zod").ZodOptional<import("zod").ZodString>;
            requestedBy: import("zod").ZodString;
            idempotencyKey: import("zod").ZodString;
        }, import("zod/v4/core").$strict>;
        readonly response: {
            readonly 400: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 401: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 403: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 404: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 409: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 429: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 503: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 200: import("zod").ZodObject<{
                queueId: import("zod").ZodNumber;
                pageLabel: import("zod").ZodString;
                name: import("zod").ZodString;
                goal: import("zod").ZodNullable<import("zod").ZodString>;
                kind: import("zod").ZodString;
                status: import("zod").ZodString;
                rule: import("zod").ZodNullable<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>>;
                ruleText: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodString>>;
                scenario: import("zod").ZodObject<{
                    action: import("zod").ZodString;
                    sendMode: import("zod").ZodString;
                    templates: import("zod").ZodNullable<import("zod").ZodString>;
                    texts: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodString>>;
                    hint: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>;
                distribution: import("zod").ZodString;
                people: import("zod").ZodArray<import("zod").ZodString>;
                perPerson: import("zod").ZodNullable<import("zod").ZodNumber>;
                dailyLimit: import("zod").ZodNullable<import("zod").ZodNumber>;
                endsAt: import("zod").ZodNullable<import("zod").ZodString>;
                requestedBy: import("zod").ZodString;
                createdAt: import("zod").ZodString;
                pausedAt: import("zod").ZodNullable<import("zod").ZodString>;
                pausedBy: import("zod").ZodNullable<import("zod").ZodString>;
                finishedAt: import("zod").ZodNullable<import("zod").ZodString>;
                counts: import("zod").ZodObject<{
                    pending: import("zod").ZodNumber;
                    leased: import("zod").ZodNumber;
                    sent: import("zod").ZodNumber;
                    skipped: import("zod").ZodNumber;
                    dropped: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>;
                today: import("zod").ZodObject<{
                    sent: import("zod").ZodNumber;
                    byPerson: import("zod").ZodArray<import("zod").ZodObject<{
                        username: import("zod").ZodString;
                        sent: import("zod").ZodNumber;
                        skipped: import("zod").ZodNumber;
                    }, import("zod/v4/core").$strip>>;
                }, import("zod/v4/core").$strip>;
                daysLeft: import("zod").ZodNullable<import("zod").ZodNumber>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly agentFanQueueList: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "The fan queues of the key's pages with their progress today and what is left (needs write:fan_queues)";
        readonly querystring: import("zod").ZodObject<{
            pageLabel: import("zod").ZodOptional<import("zod").ZodString>;
            status: import("zod").ZodDefault<import("zod").ZodEnum<{
                all: "all";
                active: "active";
                paused: "paused";
                open: "open";
                done: "done";
            }>>;
        }, import("zod/v4/core").$strict>;
        readonly response: {
            readonly 400: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 401: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 403: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 404: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 409: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 429: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 503: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 200: import("zod").ZodObject<{
                queues: import("zod").ZodArray<import("zod").ZodObject<{
                    queueId: import("zod").ZodNumber;
                    pageLabel: import("zod").ZodString;
                    name: import("zod").ZodString;
                    goal: import("zod").ZodNullable<import("zod").ZodString>;
                    kind: import("zod").ZodString;
                    status: import("zod").ZodString;
                    rule: import("zod").ZodNullable<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>>;
                    ruleText: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodString>>;
                    scenario: import("zod").ZodObject<{
                        action: import("zod").ZodString;
                        sendMode: import("zod").ZodString;
                        templates: import("zod").ZodNullable<import("zod").ZodString>;
                        texts: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodString>>;
                        hint: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>;
                    distribution: import("zod").ZodString;
                    people: import("zod").ZodArray<import("zod").ZodString>;
                    perPerson: import("zod").ZodNullable<import("zod").ZodNumber>;
                    dailyLimit: import("zod").ZodNullable<import("zod").ZodNumber>;
                    endsAt: import("zod").ZodNullable<import("zod").ZodString>;
                    requestedBy: import("zod").ZodString;
                    createdAt: import("zod").ZodString;
                    pausedAt: import("zod").ZodNullable<import("zod").ZodString>;
                    pausedBy: import("zod").ZodNullable<import("zod").ZodString>;
                    finishedAt: import("zod").ZodNullable<import("zod").ZodString>;
                    counts: import("zod").ZodObject<{
                        pending: import("zod").ZodNumber;
                        leased: import("zod").ZodNumber;
                        sent: import("zod").ZodNumber;
                        skipped: import("zod").ZodNumber;
                        dropped: import("zod").ZodNumber;
                    }, import("zod/v4/core").$strip>;
                    today: import("zod").ZodObject<{
                        sent: import("zod").ZodNumber;
                        byPerson: import("zod").ZodArray<import("zod").ZodObject<{
                            username: import("zod").ZodString;
                            sent: import("zod").ZodNumber;
                            skipped: import("zod").ZodNumber;
                        }, import("zod/v4/core").$strip>>;
                    }, import("zod/v4/core").$strip>;
                    daysLeft: import("zod").ZodNullable<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strip>>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly agentFanQueueGet: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: string;
        readonly params: import("zod").ZodObject<{
            queueId: import("zod").ZodCoercedNumber<unknown>;
        }, import("zod/v4/core").$strip>;
        readonly querystring: import("zod").ZodObject<{
            from: import("zod").ZodOptional<import("zod").ZodString>;
            to: import("zod").ZodOptional<import("zod").ZodString>;
        }, import("zod/v4/core").$strict>;
        readonly response: {
            readonly 400: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 401: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 403: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 404: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 409: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 429: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 503: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 200: import("zod").ZodObject<{
                queueId: import("zod").ZodNumber;
                pageLabel: import("zod").ZodString;
                name: import("zod").ZodString;
                goal: import("zod").ZodNullable<import("zod").ZodString>;
                kind: import("zod").ZodString;
                status: import("zod").ZodString;
                rule: import("zod").ZodNullable<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>>;
                ruleText: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodString>>;
                scenario: import("zod").ZodObject<{
                    action: import("zod").ZodString;
                    sendMode: import("zod").ZodString;
                    templates: import("zod").ZodNullable<import("zod").ZodString>;
                    texts: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodString>>;
                    hint: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>;
                distribution: import("zod").ZodString;
                people: import("zod").ZodArray<import("zod").ZodString>;
                perPerson: import("zod").ZodNullable<import("zod").ZodNumber>;
                dailyLimit: import("zod").ZodNullable<import("zod").ZodNumber>;
                endsAt: import("zod").ZodNullable<import("zod").ZodString>;
                requestedBy: import("zod").ZodString;
                createdAt: import("zod").ZodString;
                pausedAt: import("zod").ZodNullable<import("zod").ZodString>;
                pausedBy: import("zod").ZodNullable<import("zod").ZodString>;
                finishedAt: import("zod").ZodNullable<import("zod").ZodString>;
                counts: import("zod").ZodObject<{
                    pending: import("zod").ZodNumber;
                    leased: import("zod").ZodNumber;
                    sent: import("zod").ZodNumber;
                    skipped: import("zod").ZodNumber;
                    dropped: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>;
                today: import("zod").ZodObject<{
                    sent: import("zod").ZodNumber;
                    byPerson: import("zod").ZodArray<import("zod").ZodObject<{
                        username: import("zod").ZodString;
                        sent: import("zod").ZodNumber;
                        skipped: import("zod").ZodNumber;
                    }, import("zod/v4/core").$strip>>;
                }, import("zod/v4/core").$strip>;
                daysLeft: import("zod").ZodNullable<import("zod").ZodNumber>;
                results: import("zod").ZodObject<{
                    byPerson: import("zod").ZodArray<import("zod").ZodObject<{
                        sent: import("zod").ZodNumber;
                        matured72h: import("zod").ZodNumber;
                        replied72h: import("zod").ZodNumber;
                        matured7d: import("zod").ZodNumber;
                        bought7d: import("zod").ZodNumber;
                        matured30d: import("zod").ZodNumber;
                        spent30dMills: import("zod").ZodNumber;
                        username: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    skipped: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodNumber>;
                    dropped: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodNumber>;
                    sent: import("zod").ZodNumber;
                    matured72h: import("zod").ZodNumber;
                    replied72h: import("zod").ZodNumber;
                    matured7d: import("zod").ZodNumber;
                    bought7d: import("zod").ZodNumber;
                    matured30d: import("zod").ZodNumber;
                    spent30dMills: import("zod").ZodNumber;
                    from: import("zod").ZodString;
                    to: import("zod").ZodString;
                }, import("zod/v4/core").$strip>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly agentFanQueueUpdate: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: string;
        readonly params: import("zod").ZodObject<{
            queueId: import("zod").ZodCoercedNumber<unknown>;
        }, import("zod/v4/core").$strip>;
        readonly body: import("zod").ZodObject<{
            requestedBy: import("zod").ZodString;
            status: import("zod").ZodOptional<import("zod").ZodEnum<{
                active: "active";
                paused: "paused";
                done: "done";
            }>>;
            name: import("zod").ZodOptional<import("zod").ZodString>;
            goal: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
            scenario: import("zod").ZodOptional<import("zod").ZodObject<{
                action: import("zod").ZodEnum<{
                    ping: "ping";
                    auto: "auto";
                    reply: "reply";
                    hi: "hi";
                    template: "template";
                    own: "own";
                }>;
                sendMode: import("zod").ZodDefault<import("zod").ZodEnum<{
                    one: "one";
                    batch: "batch";
                }>>;
                templates: import("zod").ZodOptional<import("zod").ZodEnum<{
                    a: "a";
                    b: "b";
                }>>;
                texts: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
                hint: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strict>>;
            perPerson: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodNumber>>;
            dailyLimit: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodNumber>>;
            endsAt: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
            addPeople: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
            removePeople: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
            move: import("zod").ZodOptional<import("zod").ZodObject<{
                from: import("zod").ZodString;
                to: import("zod").ZodNullable<import("zod").ZodString>;
                count: import("zod").ZodOptional<import("zod").ZodNumber>;
            }, import("zod/v4/core").$strict>>;
        }, import("zod/v4/core").$strict>;
        readonly response: {
            readonly 400: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 401: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 403: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 404: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 409: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 429: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 503: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 200: import("zod").ZodObject<{
                queueId: import("zod").ZodNumber;
                pageLabel: import("zod").ZodString;
                name: import("zod").ZodString;
                goal: import("zod").ZodNullable<import("zod").ZodString>;
                kind: import("zod").ZodString;
                status: import("zod").ZodString;
                rule: import("zod").ZodNullable<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>>;
                ruleText: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodString>>;
                scenario: import("zod").ZodObject<{
                    action: import("zod").ZodString;
                    sendMode: import("zod").ZodString;
                    templates: import("zod").ZodNullable<import("zod").ZodString>;
                    texts: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodString>>;
                    hint: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>;
                distribution: import("zod").ZodString;
                people: import("zod").ZodArray<import("zod").ZodString>;
                perPerson: import("zod").ZodNullable<import("zod").ZodNumber>;
                dailyLimit: import("zod").ZodNullable<import("zod").ZodNumber>;
                endsAt: import("zod").ZodNullable<import("zod").ZodString>;
                requestedBy: import("zod").ZodString;
                createdAt: import("zod").ZodString;
                pausedAt: import("zod").ZodNullable<import("zod").ZodString>;
                pausedBy: import("zod").ZodNullable<import("zod").ZodString>;
                finishedAt: import("zod").ZodNullable<import("zod").ZodString>;
                counts: import("zod").ZodObject<{
                    pending: import("zod").ZodNumber;
                    leased: import("zod").ZodNumber;
                    sent: import("zod").ZodNumber;
                    skipped: import("zod").ZodNumber;
                    dropped: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>;
                today: import("zod").ZodObject<{
                    sent: import("zod").ZodNumber;
                    byPerson: import("zod").ZodArray<import("zod").ZodObject<{
                        username: import("zod").ZodString;
                        sent: import("zod").ZodNumber;
                        skipped: import("zod").ZodNumber;
                    }, import("zod/v4/core").$strip>>;
                }, import("zod/v4/core").$strip>;
                daysLeft: import("zod").ZodNullable<import("zod").ZodNumber>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly agentFanQueueAppend: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: string;
        readonly params: import("zod").ZodObject<{
            queueId: import("zod").ZodCoercedNumber<unknown>;
        }, import("zod/v4/core").$strip>;
        readonly body: import("zod").ZodObject<{
            requestedBy: import("zod").ZodString;
            rule: import("zod").ZodOptional<import("zod").ZodObject<{
                audience: import("zod").ZodOptional<import("zod").ZodEnum<{
                    subscribers: "subscribers";
                    expired: "expired";
                    followers: "followers";
                    any: "any";
                }>>;
                fanWrote: import("zod").ZodOptional<import("zod").ZodEnum<{
                    never: "never";
                    ever: "ever";
                }>>;
                fanLastMessage: import("zod").ZodOptional<import("zod").ZodObject<{
                    olderThanDays: import("zod").ZodOptional<import("zod").ZodNumber>;
                    withinDays: import("zod").ZodOptional<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strict>>;
                pagePersonal: import("zod").ZodOptional<import("zod").ZodUnion<readonly [import("zod").ZodLiteral<"never">, import("zod").ZodObject<{
                    olderThanDays: import("zod").ZodOptional<import("zod").ZodNumber>;
                    withinDays: import("zod").ZodOptional<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strict>]>>;
                lifetimeSpend: import("zod").ZodOptional<import("zod").ZodObject<{
                    min: import("zod").ZodOptional<import("zod").ZodNumber>;
                    max: import("zod").ZodOptional<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strict>>;
                spend30d: import("zod").ZodOptional<import("zod").ZodObject<{
                    min: import("zod").ZodOptional<import("zod").ZodNumber>;
                    max: import("zod").ZodOptional<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strict>>;
                lastPurchase: import("zod").ZodOptional<import("zod").ZodObject<{
                    olderThanDays: import("zod").ZodOptional<import("zod").ZodNumber>;
                    withinDays: import("zod").ZodOptional<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strict>>;
                followed: import("zod").ZodOptional<import("zod").ZodObject<{
                    olderThanDays: import("zod").ZodOptional<import("zod").ZodNumber>;
                    withinDays: import("zod").ZodOptional<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strict>>;
                subscribed: import("zod").ZodOptional<import("zod").ZodObject<{
                    olderThanDays: import("zod").ZodOptional<import("zod").ZodNumber>;
                    withinDays: import("zod").ZodOptional<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strict>>;
                subscriptionEnds: import("zod").ZodOptional<import("zod").ZodObject<{
                    withinDays: import("zod").ZodNumber;
                }, import("zod/v4/core").$strict>>;
                autoRenew: import("zod").ZodOptional<import("zod").ZodBoolean>;
                seen: import("zod").ZodOptional<import("zod").ZodUnion<readonly [import("zod").ZodObject<{
                    withinDays: import("zod").ZodNumber;
                }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
                    notWithinDays: import("zod").ZodNumber;
                }, import("zod/v4/core").$strict>]>>;
                otherPagesSpend: import("zod").ZodOptional<import("zod").ZodObject<{
                    min: import("zod").ZodOptional<import("zod").ZodNumber>;
                    max: import("zod").ZodOptional<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strict>>;
                markers: import("zod").ZodOptional<import("zod").ZodObject<{
                    include: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
                    exclude: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
                }, import("zod/v4/core").$strict>>;
                order: import("zod").ZodOptional<import("zod").ZodEnum<{
                    spend: "spend";
                    seen: "seen";
                    followed_new: "followed_new";
                    followed_old: "followed_old";
                    fan_message: "fan_message";
                    random: "random";
                }>>;
                limit: import("zod").ZodOptional<import("zod").ZodNumber>;
            }, import("zod/v4/core").$strict>>;
            fans: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodObject<{
                ref: import("zod").ZodString;
                why: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strict>>>;
        }, import("zod/v4/core").$strict>;
        readonly response: {
            readonly 400: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 401: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 403: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 404: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 409: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 429: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 503: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 200: import("zod").ZodObject<{
                added: import("zod").ZodNumber;
                excluded: import("zod").ZodObject<{
                    unreachable: import("zod").ZodNumber;
                    dismissed: import("zod").ZodNumber;
                    inOtherQueues: import("zod").ZodNumber;
                    markers: import("zod").ZodNumber;
                    notFound: import("zod").ZodNumber;
                    overLimit: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>;
                queue: import("zod").ZodObject<{
                    queueId: import("zod").ZodNumber;
                    pageLabel: import("zod").ZodString;
                    name: import("zod").ZodString;
                    goal: import("zod").ZodNullable<import("zod").ZodString>;
                    kind: import("zod").ZodString;
                    status: import("zod").ZodString;
                    rule: import("zod").ZodNullable<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>>;
                    ruleText: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodString>>;
                    scenario: import("zod").ZodObject<{
                        action: import("zod").ZodString;
                        sendMode: import("zod").ZodString;
                        templates: import("zod").ZodNullable<import("zod").ZodString>;
                        texts: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodString>>;
                        hint: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>;
                    distribution: import("zod").ZodString;
                    people: import("zod").ZodArray<import("zod").ZodString>;
                    perPerson: import("zod").ZodNullable<import("zod").ZodNumber>;
                    dailyLimit: import("zod").ZodNullable<import("zod").ZodNumber>;
                    endsAt: import("zod").ZodNullable<import("zod").ZodString>;
                    requestedBy: import("zod").ZodString;
                    createdAt: import("zod").ZodString;
                    pausedAt: import("zod").ZodNullable<import("zod").ZodString>;
                    pausedBy: import("zod").ZodNullable<import("zod").ZodString>;
                    finishedAt: import("zod").ZodNullable<import("zod").ZodString>;
                    counts: import("zod").ZodObject<{
                        pending: import("zod").ZodNumber;
                        leased: import("zod").ZodNumber;
                        sent: import("zod").ZodNumber;
                        skipped: import("zod").ZodNumber;
                        dropped: import("zod").ZodNumber;
                    }, import("zod/v4/core").$strip>;
                    today: import("zod").ZodObject<{
                        sent: import("zod").ZodNumber;
                        byPerson: import("zod").ZodArray<import("zod").ZodObject<{
                            username: import("zod").ZodString;
                            sent: import("zod").ZodNumber;
                            skipped: import("zod").ZodNumber;
                        }, import("zod/v4/core").$strip>>;
                    }, import("zod/v4/core").$strip>;
                    daysLeft: import("zod").ZodNullable<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strip>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly clientFanQueues: {
        readonly auth: {
            readonly kind: "apiKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["client"];
        readonly summary: string;
        readonly description: string;
        readonly params: import("zod").ZodObject<{
            pageLabel: import("zod").ZodString;
        }, import("zod/v4/core").$strip>;
        readonly response: {
            readonly 400: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 401: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 403: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 404: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 409: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 200: import("zod").ZodObject<{
                pageLabel: import("zod").ZodString;
                queues: import("zod").ZodArray<import("zod").ZodObject<{
                    queueId: import("zod").ZodNumber;
                    name: import("zod").ZodString;
                    goal: import("zod").ZodNullable<import("zod").ZodString>;
                    kind: import("zod").ZodString;
                    status: import("zod").ZodString;
                    distribution: import("zod").ZodString;
                    mineOnly: import("zod").ZodBoolean;
                    scenario: import("zod").ZodObject<{
                        action: import("zod").ZodString;
                        sendMode: import("zod").ZodString;
                        templates: import("zod").ZodNullable<import("zod").ZodString>;
                        texts: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodString>>;
                        hint: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>;
                    ruleText: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodString>>;
                    requestedBy: import("zod").ZodString;
                    pausedAt: import("zod").ZodNullable<import("zod").ZodString>;
                    pausedBy: import("zod").ZodNullable<import("zod").ZodString>;
                    perPerson: import("zod").ZodNullable<import("zod").ZodNumber>;
                    dailyLimit: import("zod").ZodNullable<import("zod").ZodNumber>;
                    today: import("zod").ZodObject<{
                        mine: import("zod").ZodNumber;
                        page: import("zod").ZodNumber;
                    }, import("zod/v4/core").$strip>;
                    pending: import("zod").ZodNumber;
                    leasedToMe: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>>;
                answered: import("zod").ZodArray<import("zod").ZodObject<{
                    itemId: import("zod").ZodNumber;
                    queueId: import("zod").ZodNumber;
                    fanRef: import("zod").ZodString;
                    conversationRef: import("zod").ZodNullable<import("zod").ZodString>;
                    username: import("zod").ZodNullable<import("zod").ZodString>;
                    displayName: import("zod").ZodNullable<import("zod").ZodString>;
                    alias: import("zod").ZodNullable<import("zod").ZodString>;
                    sentAt: import("zod").ZodString;
                    act: import("zod").ZodNullable<import("zod").ZodString>;
                    templateId: import("zod").ZodNullable<import("zod").ZodString>;
                    answeredAt: import("zod").ZodString;
                    answerText: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>;
                templates: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodString;
                    group: import("zod").ZodString;
                    text: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                serverNow: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly clientFanQueueTake: {
        readonly auth: {
            readonly kind: "apiKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["client"];
        readonly summary: string;
        readonly description: string;
        readonly params: import("zod").ZodObject<{
            pageLabel: import("zod").ZodString;
            queueId: import("zod").ZodCoercedNumber<unknown>;
        }, import("zod/v4/core").$strip>;
        readonly body: import("zod").ZodObject<{
            count: import("zod").ZodDefault<import("zod").ZodNumber>;
            more: import("zod").ZodDefault<import("zod").ZodBoolean>;
        }, import("zod/v4/core").$strict>;
        readonly response: {
            readonly 400: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 401: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 403: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 404: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 409: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 200: import("zod").ZodObject<{
                queueId: import("zod").ZodNumber;
                items: import("zod").ZodArray<import("zod").ZodObject<{
                    fanRef: import("zod").ZodString;
                    conversationRef: import("zod").ZodNullable<import("zod").ZodString>;
                    username: import("zod").ZodNullable<import("zod").ZodString>;
                    displayName: import("zod").ZodNullable<import("zod").ZodString>;
                    alias: import("zod").ZodNullable<import("zod").ZodString>;
                    greetingName: import("zod").ZodNullable<import("zod").ZodString>;
                    lifetimeGrossMills: import("zod").ZodNumber;
                    last30dGrossMills: import("zod").ZodNumber;
                    seenAt: import("zod").ZodNullable<import("zod").ZodString>;
                    onlineSince: import("zod").ZodNullable<import("zod").ZodString>;
                    seenSource: import("zod").ZodNullable<import("zod").ZodString>;
                    reason: import("zod").ZodString;
                    reasonAt: import("zod").ZodNullable<import("zod").ZodString>;
                    act: import("zod").ZodString;
                    aside: import("zod").ZodNullable<import("zod").ZodString>;
                    asideAt: import("zod").ZodNullable<import("zod").ZodString>;
                    asideBy: import("zod").ZodNullable<import("zod").ZodString>;
                    messageCount: import("zod").ZodNumber;
                    lastFanMessageAt: import("zod").ZodNullable<import("zod").ZodString>;
                    lastPageMessageAt: import("zod").ZodNullable<import("zod").ZodString>;
                    subscription: import("zod").ZodObject<{
                        isSubscriber: import("zod").ZodBoolean;
                        startedAt: import("zod").ZodNullable<import("zod").ZodString>;
                        endsAt: import("zod").ZodNullable<import("zod").ZodString>;
                        autoRenew: import("zod").ZodNullable<import("zod").ZodBoolean>;
                    }, import("zod/v4/core").$strip>;
                    itemId: import("zod").ZodNumber;
                    queueId: import("zod").ZodNumber;
                    why: import("zod").ZodNullable<import("zod").ZodString>;
                    leaseUntil: import("zod").ZodString;
                    templateId: import("zod").ZodNullable<import("zod").ZodString>;
                    followedAt: import("zod").ZodNullable<import("zod").ZodString>;
                    massLast90d: import("zod").ZodObject<{
                        count: import("zod").ZodNumber;
                        lastAt: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>;
                }, import("zod/v4/core").$strip>>;
                stopped: import("zod").ZodNullable<import("zod").ZodString>;
                today: import("zod").ZodObject<{
                    mine: import("zod").ZodNumber;
                    page: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>;
                pending: import("zod").ZodNumber;
                dropped: import("zod").ZodNumber;
                serverNow: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly clientFanQueueItemDone: {
        readonly auth: {
            readonly kind: "apiKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["client"];
        readonly summary: "Report a fan of the caller's portion: sent (with what) or skipped (why); journaled first";
        readonly description: string;
        readonly params: import("zod").ZodObject<{
            pageLabel: import("zod").ZodString;
            itemId: import("zod").ZodCoercedNumber<unknown>;
        }, import("zod/v4/core").$strip>;
        readonly body: import("zod").ZodObject<{
            outcome: import("zod").ZodEnum<{
                skipped: "skipped";
                sent: "sent";
            }>;
            act: import("zod").ZodOptional<import("zod").ZodEnum<{
                ping: "ping";
                reply: "reply";
                hi: "hi";
                template: "template";
                own: "own";
            }>>;
            templateId: import("zod").ZodOptional<import("zod").ZodString>;
            skipReason: import("zod").ZodOptional<import("zod").ZodEnum<{
                not_fit: "not_fit";
                later: "later";
                talking: "talking";
                dismiss: "dismiss";
            }>>;
            uncertain: import("zod").ZodOptional<import("zod").ZodBoolean>;
        }, import("zod/v4/core").$strict>;
        readonly response: {
            readonly 400: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 401: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 403: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 404: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 409: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 200: import("zod").ZodObject<{
                itemId: import("zod").ZodNumber;
                state: import("zod").ZodString;
                today: import("zod").ZodObject<{
                    mine: import("zod").ZodNumber;
                    page: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>;
                serverNow: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly clientFanQueueRelease: {
        readonly auth: {
            readonly kind: "apiKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["client"];
        readonly summary: "Give the caller's untouched portion of a fan queue back (the window closed)";
        readonly params: import("zod").ZodObject<{
            pageLabel: import("zod").ZodString;
            queueId: import("zod").ZodCoercedNumber<unknown>;
        }, import("zod/v4/core").$strip>;
        readonly body: import("zod").ZodObject<{}, import("zod/v4/core").$strict>;
        readonly response: {
            readonly 400: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 401: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 403: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 404: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 409: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 200: import("zod").ZodObject<{
                released: import("zod").ZodNumber;
            }, import("zod/v4/core").$strip>;
        };
    };
};
