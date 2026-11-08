export declare const chatterStatsRouteSchemas: {
    readonly accountChatterStats: {
        readonly auth: {
            readonly kind: "any-session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "The caller's own statistics: the money of their shifts, how they write and sell, their records";
        readonly description: string;
        readonly querystring: import("zod").ZodObject<{
            days: import("zod").ZodDefault<import("zod").ZodCoercedNumber<unknown>>;
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
            readonly 200: import("zod").ZodObject<{
                user: import("zod").ZodObject<{
                    userId: import("zod").ZodNumber;
                    username: import("zod").ZodString;
                }, import("zod/v4/core").$strip>;
                days: import("zod").ZodNumber;
                from: import("zod").ZodString;
                to: import("zod").ZodString;
                activitySince: import("zod").ZodNullable<import("zod").ZodString>;
                totals: import("zod").ZodObject<{
                    shifts: import("zod").ZodNumber;
                    workedMinutes: import("zod").ZodNumber;
                    salesNetMills: import("zod").ZodNumber;
                    sales: import("zod").ZodNumber;
                    perHourMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                    overlapNetMills: import("zod").ZodNumber;
                    byKind: import("zod").ZodObject<{
                        ppv: import("zod").ZodNumber;
                        tip: import("zod").ZodNumber;
                        subscription: import("zod").ZodNumber;
                        post: import("zod").ZodNumber;
                    }, import("zod/v4/core").$strip>;
                    confirmedNetMills: import("zod").ZodNumber;
                    unconfirmedShifts: import("zod").ZodNumber;
                    messages: import("zod").ZodNumber;
                    fansWritten: import("zod").ZodNumber;
                    fansPaid: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>;
                previous: import("zod").ZodNullable<import("zod").ZodObject<{
                    shifts: import("zod").ZodNumber;
                    workedMinutes: import("zod").ZodNumber;
                    salesNetMills: import("zod").ZodNumber;
                    sales: import("zod").ZodNumber;
                    perHourMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strip>>;
                daily: import("zod").ZodArray<import("zod").ZodObject<{
                    date: import("zod").ZodString;
                    salesNetMills: import("zod").ZodNumber;
                    byKind: import("zod").ZodObject<{
                        ppv: import("zod").ZodNumber;
                        tip: import("zod").ZodNumber;
                        subscription: import("zod").ZodNumber;
                        post: import("zod").ZodNumber;
                    }, import("zod/v4/core").$strip>;
                    shifts: import("zod").ZodNumber;
                    workedMinutes: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>>;
                shifts: import("zod").ZodArray<import("zod").ZodObject<{
                    date: import("zod").ZodString;
                    startedAt: import("zod").ZodString;
                    endedAt: import("zod").ZodString;
                    ongoing: import("zod").ZodBoolean;
                    workedMinutes: import("zod").ZodNumber;
                    pauses: import("zod").ZodArray<import("zod").ZodObject<{
                        from: import("zod").ZodString;
                        to: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    pages: import("zod").ZodArray<import("zod").ZodString>;
                    salesNetMills: import("zod").ZodNumber;
                    overlapNetMills: import("zod").ZodNumber;
                    together: import("zod").ZodArray<import("zod").ZodString>;
                    messages: import("zod").ZodNumber;
                    ppvSent: import("zod").ZodNumber;
                    fansWritten: import("zod").ZodNumber;
                    fansPaid: import("zod").ZodNumber;
                    confirmedNetMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                    sales: import("zod").ZodArray<import("zod").ZodObject<{
                        at: import("zod").ZodString;
                        netMills: import("zod").ZodNumber;
                        kind: import("zod").ZodEnum<{
                            subscription: "subscription";
                            tip: "tip";
                            post: "post";
                            ppv: "ppv";
                        }>;
                        pageLabel: import("zod").ZodString;
                        fanName: import("zod").ZodNullable<import("zod").ZodString>;
                        overlap: import("zod").ZodBoolean;
                    }, import("zod/v4/core").$strip>>;
                }, import("zod/v4/core").$strip>>;
                visits: import("zod").ZodArray<import("zod").ZodObject<{
                    date: import("zod").ZodString;
                    startedAt: import("zod").ZodString;
                    endedAt: import("zod").ZodString;
                    workedMinutes: import("zod").ZodNumber;
                    messages: import("zod").ZodNumber;
                    salesNetMills: import("zod").ZodNumber;
                    sales: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>>;
                pages: import("zod").ZodArray<import("zod").ZodObject<{
                    pageLabel: import("zod").ZodString;
                    platform: import("zod").ZodString;
                    salesNetMills: import("zod").ZodNumber;
                    sales: import("zod").ZodNumber;
                    activeMinutes: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>>;
                ppv: import("zod").ZodObject<{
                    sent: import("zod").ZodNumber;
                    bought: import("zod").ZodNumber;
                    netMills: import("zod").ZodNumber;
                    byPrice: import("zod").ZodArray<import("zod").ZodObject<{
                        bucket: import("zod").ZodString;
                        sent: import("zod").ZodNumber;
                        bought: import("zod").ZodNumber;
                        netMills: import("zod").ZodNumber;
                        teamSent: import("zod").ZodNumber;
                        teamBought: import("zod").ZodNumber;
                    }, import("zod/v4/core").$strip>>;
                }, import("zod/v4/core").$strip>;
                replies: import("zod").ZodObject<{
                    to: import("zod").ZodString;
                    replies: import("zod").ZodNumber;
                    bought: import("zod").ZodNumber;
                    byDelay: import("zod").ZodArray<import("zod").ZodObject<{
                        bucket: import("zod").ZodString;
                        replies: import("zod").ZodNumber;
                        bought: import("zod").ZodNumber;
                        teamReplies: import("zod").ZodNumber;
                        teamBought: import("zod").ZodNumber;
                    }, import("zod/v4/core").$strip>>;
                }, import("zod/v4/core").$strip>;
                composed: import("zod").ZodObject<{
                    hand: import("zod").ZodNumber;
                    reply: import("zod").ZodNumber;
                    fix: import("zod").ZodNumber;
                    greet: import("zod").ZodNumber;
                    other: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>;
                topFans: import("zod").ZodArray<import("zod").ZodObject<{
                    fanName: import("zod").ZodNullable<import("zod").ZodString>;
                    pageLabel: import("zod").ZodString;
                    netMills: import("zod").ZodNumber;
                    sales: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>>;
                records: import("zod").ZodObject<{
                    bestShift: import("zod").ZodNullable<import("zod").ZodObject<{
                        startedAt: import("zod").ZodString;
                        salesNetMills: import("zod").ZodNumber;
                    }, import("zod/v4/core").$strip>>;
                    bestDay: import("zod").ZodNullable<import("zod").ZodObject<{
                        date: import("zod").ZodString;
                        salesNetMills: import("zod").ZodNumber;
                    }, import("zod/v4/core").$strip>>;
                    biggestSale: import("zod").ZodNullable<import("zod").ZodObject<{
                        at: import("zod").ZodString;
                        pageLabel: import("zod").ZodString;
                        kind: import("zod").ZodEnum<{
                            subscription: "subscription";
                            tip: "tip";
                            post: "post";
                            ppv: "ppv";
                        }>;
                        netMills: import("zod").ZodNumber;
                        fanName: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    streakDays: import("zod").ZodNumber;
                    longestStreakDays: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>;
                serverNow: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly teamChatterStats: {
        readonly auth: {
            readonly kind: "session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "A chatter's statistics, as their cabinet shows them, for the owner and team leads";
        readonly description: string;
        readonly querystring: import("zod").ZodObject<{
            days: import("zod").ZodDefault<import("zod").ZodCoercedNumber<unknown>>;
            userId: import("zod").ZodOptional<import("zod").ZodCoercedNumber<unknown>>;
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
            readonly 200: import("zod").ZodObject<{
                people: import("zod").ZodArray<import("zod").ZodObject<{
                    userId: import("zod").ZodNumber;
                    username: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                stats: import("zod").ZodNullable<import("zod").ZodObject<{
                    user: import("zod").ZodObject<{
                        userId: import("zod").ZodNumber;
                        username: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>;
                    days: import("zod").ZodNumber;
                    from: import("zod").ZodString;
                    to: import("zod").ZodString;
                    activitySince: import("zod").ZodNullable<import("zod").ZodString>;
                    totals: import("zod").ZodObject<{
                        shifts: import("zod").ZodNumber;
                        workedMinutes: import("zod").ZodNumber;
                        salesNetMills: import("zod").ZodNumber;
                        sales: import("zod").ZodNumber;
                        perHourMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                        overlapNetMills: import("zod").ZodNumber;
                        byKind: import("zod").ZodObject<{
                            ppv: import("zod").ZodNumber;
                            tip: import("zod").ZodNumber;
                            subscription: import("zod").ZodNumber;
                            post: import("zod").ZodNumber;
                        }, import("zod/v4/core").$strip>;
                        confirmedNetMills: import("zod").ZodNumber;
                        unconfirmedShifts: import("zod").ZodNumber;
                        messages: import("zod").ZodNumber;
                        fansWritten: import("zod").ZodNumber;
                        fansPaid: import("zod").ZodNumber;
                    }, import("zod/v4/core").$strip>;
                    previous: import("zod").ZodNullable<import("zod").ZodObject<{
                        shifts: import("zod").ZodNumber;
                        workedMinutes: import("zod").ZodNumber;
                        salesNetMills: import("zod").ZodNumber;
                        sales: import("zod").ZodNumber;
                        perHourMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                    }, import("zod/v4/core").$strip>>;
                    daily: import("zod").ZodArray<import("zod").ZodObject<{
                        date: import("zod").ZodString;
                        salesNetMills: import("zod").ZodNumber;
                        byKind: import("zod").ZodObject<{
                            ppv: import("zod").ZodNumber;
                            tip: import("zod").ZodNumber;
                            subscription: import("zod").ZodNumber;
                            post: import("zod").ZodNumber;
                        }, import("zod/v4/core").$strip>;
                        shifts: import("zod").ZodNumber;
                        workedMinutes: import("zod").ZodNumber;
                    }, import("zod/v4/core").$strip>>;
                    shifts: import("zod").ZodArray<import("zod").ZodObject<{
                        date: import("zod").ZodString;
                        startedAt: import("zod").ZodString;
                        endedAt: import("zod").ZodString;
                        ongoing: import("zod").ZodBoolean;
                        workedMinutes: import("zod").ZodNumber;
                        pauses: import("zod").ZodArray<import("zod").ZodObject<{
                            from: import("zod").ZodString;
                            to: import("zod").ZodString;
                        }, import("zod/v4/core").$strip>>;
                        pages: import("zod").ZodArray<import("zod").ZodString>;
                        salesNetMills: import("zod").ZodNumber;
                        overlapNetMills: import("zod").ZodNumber;
                        together: import("zod").ZodArray<import("zod").ZodString>;
                        messages: import("zod").ZodNumber;
                        ppvSent: import("zod").ZodNumber;
                        fansWritten: import("zod").ZodNumber;
                        fansPaid: import("zod").ZodNumber;
                        confirmedNetMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                        sales: import("zod").ZodArray<import("zod").ZodObject<{
                            at: import("zod").ZodString;
                            netMills: import("zod").ZodNumber;
                            kind: import("zod").ZodEnum<{
                                subscription: "subscription";
                                tip: "tip";
                                post: "post";
                                ppv: "ppv";
                            }>;
                            pageLabel: import("zod").ZodString;
                            fanName: import("zod").ZodNullable<import("zod").ZodString>;
                            overlap: import("zod").ZodBoolean;
                        }, import("zod/v4/core").$strip>>;
                    }, import("zod/v4/core").$strip>>;
                    visits: import("zod").ZodArray<import("zod").ZodObject<{
                        date: import("zod").ZodString;
                        startedAt: import("zod").ZodString;
                        endedAt: import("zod").ZodString;
                        workedMinutes: import("zod").ZodNumber;
                        messages: import("zod").ZodNumber;
                        salesNetMills: import("zod").ZodNumber;
                        sales: import("zod").ZodNumber;
                    }, import("zod/v4/core").$strip>>;
                    pages: import("zod").ZodArray<import("zod").ZodObject<{
                        pageLabel: import("zod").ZodString;
                        platform: import("zod").ZodString;
                        salesNetMills: import("zod").ZodNumber;
                        sales: import("zod").ZodNumber;
                        activeMinutes: import("zod").ZodNumber;
                    }, import("zod/v4/core").$strip>>;
                    ppv: import("zod").ZodObject<{
                        sent: import("zod").ZodNumber;
                        bought: import("zod").ZodNumber;
                        netMills: import("zod").ZodNumber;
                        byPrice: import("zod").ZodArray<import("zod").ZodObject<{
                            bucket: import("zod").ZodString;
                            sent: import("zod").ZodNumber;
                            bought: import("zod").ZodNumber;
                            netMills: import("zod").ZodNumber;
                            teamSent: import("zod").ZodNumber;
                            teamBought: import("zod").ZodNumber;
                        }, import("zod/v4/core").$strip>>;
                    }, import("zod/v4/core").$strip>;
                    replies: import("zod").ZodObject<{
                        to: import("zod").ZodString;
                        replies: import("zod").ZodNumber;
                        bought: import("zod").ZodNumber;
                        byDelay: import("zod").ZodArray<import("zod").ZodObject<{
                            bucket: import("zod").ZodString;
                            replies: import("zod").ZodNumber;
                            bought: import("zod").ZodNumber;
                            teamReplies: import("zod").ZodNumber;
                            teamBought: import("zod").ZodNumber;
                        }, import("zod/v4/core").$strip>>;
                    }, import("zod/v4/core").$strip>;
                    composed: import("zod").ZodObject<{
                        hand: import("zod").ZodNumber;
                        reply: import("zod").ZodNumber;
                        fix: import("zod").ZodNumber;
                        greet: import("zod").ZodNumber;
                        other: import("zod").ZodNumber;
                    }, import("zod/v4/core").$strip>;
                    topFans: import("zod").ZodArray<import("zod").ZodObject<{
                        fanName: import("zod").ZodNullable<import("zod").ZodString>;
                        pageLabel: import("zod").ZodString;
                        netMills: import("zod").ZodNumber;
                        sales: import("zod").ZodNumber;
                    }, import("zod/v4/core").$strip>>;
                    records: import("zod").ZodObject<{
                        bestShift: import("zod").ZodNullable<import("zod").ZodObject<{
                            startedAt: import("zod").ZodString;
                            salesNetMills: import("zod").ZodNumber;
                        }, import("zod/v4/core").$strip>>;
                        bestDay: import("zod").ZodNullable<import("zod").ZodObject<{
                            date: import("zod").ZodString;
                            salesNetMills: import("zod").ZodNumber;
                        }, import("zod/v4/core").$strip>>;
                        biggestSale: import("zod").ZodNullable<import("zod").ZodObject<{
                            at: import("zod").ZodString;
                            pageLabel: import("zod").ZodString;
                            kind: import("zod").ZodEnum<{
                                subscription: "subscription";
                                tip: "tip";
                                post: "post";
                                ppv: "ppv";
                            }>;
                            netMills: import("zod").ZodNumber;
                            fanName: import("zod").ZodNullable<import("zod").ZodString>;
                        }, import("zod/v4/core").$strip>>;
                        streakDays: import("zod").ZodNumber;
                        longestStreakDays: import("zod").ZodNumber;
                    }, import("zod/v4/core").$strip>;
                    serverNow: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                serverNow: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly teamShiftSales: {
        readonly auth: {
            readonly kind: "session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "The team's shifts of the window with their money: by day, by chatter, against the window before";
        readonly description: string;
        readonly querystring: import("zod").ZodObject<{
            days: import("zod").ZodDefault<import("zod").ZodCoercedNumber<unknown>>;
            until: import("zod").ZodOptional<import("zod").ZodString>;
            pageLabel: import("zod").ZodOptional<import("zod").ZodString>;
        }, import("zod/v4/core").$strip>;
        readonly response: {
            readonly 404: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
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
            readonly 200: import("zod").ZodObject<{
                from: import("zod").ZodString;
                to: import("zod").ZodString;
                knownSince: import("zod").ZodNullable<import("zod").ZodString>;
                team: import("zod").ZodObject<{
                    shifts: import("zod").ZodNumber;
                    workedMinutes: import("zod").ZodNumber;
                    salesNetMills: import("zod").ZodNumber;
                    sales: import("zod").ZodNumber;
                    perHourMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                    daily: import("zod").ZodArray<import("zod").ZodObject<{
                        date: import("zod").ZodString;
                        salesNetMills: import("zod").ZodNumber;
                        shifts: import("zod").ZodNumber;
                        workedMinutes: import("zod").ZodNumber;
                    }, import("zod/v4/core").$strip>>;
                }, import("zod/v4/core").$strip>;
                previous: import("zod").ZodNullable<import("zod").ZodObject<{
                    shifts: import("zod").ZodNumber;
                    workedMinutes: import("zod").ZodNumber;
                    salesNetMills: import("zod").ZodNumber;
                    sales: import("zod").ZodNumber;
                    perHourMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strip>>;
                chatters: import("zod").ZodArray<import("zod").ZodObject<{
                    shifts: import("zod").ZodNumber;
                    workedMinutes: import("zod").ZodNumber;
                    salesNetMills: import("zod").ZodNumber;
                    sales: import("zod").ZodNumber;
                    perHourMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                    userId: import("zod").ZodNumber;
                    username: import("zod").ZodString;
                    overlapNetMills: import("zod").ZodNumber;
                    previous: import("zod").ZodNullable<import("zod").ZodObject<{
                        shifts: import("zod").ZodNumber;
                        workedMinutes: import("zod").ZodNumber;
                        salesNetMills: import("zod").ZodNumber;
                        sales: import("zod").ZodNumber;
                        perHourMills: import("zod").ZodNullable<import("zod").ZodNumber>;
                    }, import("zod/v4/core").$strip>>;
                    daily: import("zod").ZodArray<import("zod").ZodObject<{
                        date: import("zod").ZodString;
                        salesNetMills: import("zod").ZodNumber;
                        shifts: import("zod").ZodNumber;
                        workedMinutes: import("zod").ZodNumber;
                    }, import("zod/v4/core").$strip>>;
                }, import("zod/v4/core").$strip>>;
                shifts: import("zod").ZodArray<import("zod").ZodObject<{
                    userId: import("zod").ZodNumber;
                    username: import("zod").ZodString;
                    startedAt: import("zod").ZodString;
                    endedAt: import("zod").ZodString;
                    ongoing: import("zod").ZodBoolean;
                    workedMinutes: import("zod").ZodNumber;
                    pauses: import("zod").ZodArray<import("zod").ZodObject<{
                        from: import("zod").ZodString;
                        to: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    lastInputAt: import("zod").ZodString;
                    lastBeatAt: import("zod").ZodString;
                    pages: import("zod").ZodArray<import("zod").ZodObject<{
                        pageLabel: import("zod").ZodString;
                        activeMinutes: import("zod").ZodNumber;
                        messages: import("zod").ZodNumber;
                    }, import("zod/v4/core").$strip>>;
                    authoredMessages: import("zod").ZodNumber;
                    date: import("zod").ZodString;
                    salesNetMills: import("zod").ZodNumber;
                    overlapNetMills: import("zod").ZodNumber;
                    sales: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>>;
                serverNow: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
        };
    };
};
