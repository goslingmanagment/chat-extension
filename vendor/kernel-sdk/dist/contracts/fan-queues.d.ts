import { z } from "zod";
/** Fans one queue holds at most, and one preview or append names at most. */
export declare const FAN_QUEUE_MAX_ITEMS = 20000;
/** Fans one portion holds at most. */
export declare const FAN_QUEUE_PORTION_MAX = 10;
/** How long a portion stays a person's without a touch. */
export declare const FAN_QUEUE_LEASE_MINUTES = 30;
export declare const FAN_QUEUE_KINDS: readonly ["campaign", "standing"];
export declare const FAN_QUEUE_STATUSES: readonly ["active", "paused", "done"];
export declare const FAN_QUEUE_DISTRIBUTIONS: readonly ["pool", "people"];
export declare const FAN_QUEUE_AUDIENCES: readonly ["followers", "subscribers", "expired", "any"];
export declare const FAN_QUEUE_ORDERS: readonly ["spend", "seen", "followed_new", "followed_old", "fan_message", "random"];
/** What a queue writes with: `auto` is «Онлайн»'s choice (Ping from 10 messages, else the guide's A, B to a fan who never wrote, Hi to a new subscriber). */
export declare const FAN_QUEUE_ACTIONS: readonly ["auto", "hi", "ping", "reply", "template", "own"];
/** `one`: a click per message; `batch`: «Отправить всем» over a portion, template queues only. */
export declare const FAN_QUEUE_SEND_MODES: readonly ["one", "batch"];
/** What a sent message was written with. */
export declare const FAN_QUEUE_SENT_ACTS: readonly ["reply", "hi", "ping", "template", "own"];
/** «Не подходит», «Позже» (back in 3 days), «Уже общаемся», «Не предлагать» (the team's mark, as in «Онлайн»). */
export declare const FAN_QUEUE_SKIP_REASONS: readonly ["not_fit", "later", "talking", "dismiss"];
/** Why an item left its queue without a send. Open on the wire. */
export declare const FAN_QUEUE_DROP_REASONS: readonly ["unreachable", "dismissed", "fan_wrote", "messaged", "bought", "no_longer_fits", "queue_done", "not_fit", "talking", "removed"];
/** Why a take handed out nothing more. Open on the wire. */
export declare const FAN_QUEUE_STOPS: readonly ["paused", "done", "portion_done", "limit_reached", "empty"];
export type FanQueueKind = (typeof FAN_QUEUE_KINDS)[number];
export type FanQueueStatus = (typeof FAN_QUEUE_STATUSES)[number];
export type FanQueueDistribution = (typeof FAN_QUEUE_DISTRIBUTIONS)[number];
export type FanQueueAction = (typeof FAN_QUEUE_ACTIONS)[number];
export type FanQueueSkipReason = (typeof FAN_QUEUE_SKIP_REASONS)[number];
export type FanQueueDropReason = (typeof FAN_QUEUE_DROP_REASONS)[number];
export type FanQueueStop = (typeof FAN_QUEUE_STOPS)[number];
/** `olderThanDays`: at least this many days ago (or never, where the field allows it); `withinDays`: at most. */
export declare const fanQueueDayRangeSchema: z.ZodObject<{
    olderThanDays: z.ZodOptional<z.ZodNumber>;
    withinDays: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
/** Dollars, gross (what the fan paid). */
export declare const fanQueueSpendRangeSchema: z.ZodObject<{
    min: z.ZodOptional<z.ZodNumber>;
    max: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
/** Every field optional; the fields AND together. Hub always leaves out a fan it cannot reach, one marked «Не предлагать», one already in an open queue of the page, and (unless `markers.exclude` says otherwise) the marks 💩 and «бомж». */
export declare const fanQueueRuleSchema: z.ZodObject<{
    audience: z.ZodOptional<z.ZodEnum<{
        subscribers: "subscribers";
        expired: "expired";
        followers: "followers";
        any: "any";
    }>>;
    fanWrote: z.ZodOptional<z.ZodEnum<{
        never: "never";
        ever: "ever";
    }>>;
    fanLastMessage: z.ZodOptional<z.ZodObject<{
        olderThanDays: z.ZodOptional<z.ZodNumber>;
        withinDays: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
    pagePersonal: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<"never">, z.ZodObject<{
        olderThanDays: z.ZodOptional<z.ZodNumber>;
        withinDays: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>]>>;
    lifetimeSpend: z.ZodOptional<z.ZodObject<{
        min: z.ZodOptional<z.ZodNumber>;
        max: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
    spend30d: z.ZodOptional<z.ZodObject<{
        min: z.ZodOptional<z.ZodNumber>;
        max: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
    lastPurchase: z.ZodOptional<z.ZodObject<{
        olderThanDays: z.ZodOptional<z.ZodNumber>;
        withinDays: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
    followed: z.ZodOptional<z.ZodObject<{
        olderThanDays: z.ZodOptional<z.ZodNumber>;
        withinDays: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
    subscribed: z.ZodOptional<z.ZodObject<{
        olderThanDays: z.ZodOptional<z.ZodNumber>;
        withinDays: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
    subscriptionEnds: z.ZodOptional<z.ZodObject<{
        withinDays: z.ZodNumber;
    }, z.core.$strict>>;
    autoRenew: z.ZodOptional<z.ZodBoolean>;
    seen: z.ZodOptional<z.ZodUnion<readonly [z.ZodObject<{
        withinDays: z.ZodNumber;
    }, z.core.$strict>, z.ZodObject<{
        notWithinDays: z.ZodNumber;
    }, z.core.$strict>]>>;
    otherPagesSpend: z.ZodOptional<z.ZodObject<{
        min: z.ZodOptional<z.ZodNumber>;
        max: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
    markers: z.ZodOptional<z.ZodObject<{
        include: z.ZodOptional<z.ZodArray<z.ZodString>>;
        exclude: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>>;
    order: z.ZodOptional<z.ZodEnum<{
        spend: "spend";
        seen: "seen";
        followed_new: "followed_new";
        followed_old: "followed_old";
        fan_message: "fan_message";
        random: "random";
    }>>;
    limit: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export type FanQueueRule = z.infer<typeof fanQueueRuleSchema>;
/** A list instead of a rule: a platform id or a username, and why the fan is in the queue. */
export declare const fanQueueFansSchema: z.ZodArray<z.ZodObject<{
    ref: z.ZodString;
    why: z.ZodOptional<z.ZodString>;
}, z.core.$strict>>;
export declare const fanQueueScenarioSchema: z.ZodObject<{
    action: z.ZodEnum<{
        ping: "ping";
        auto: "auto";
        reply: "reply";
        hi: "hi";
        template: "template";
        own: "own";
    }>;
    sendMode: z.ZodDefault<z.ZodEnum<{
        one: "one";
        batch: "batch";
    }>>;
    templates: z.ZodOptional<z.ZodEnum<{
        a: "a";
        b: "b";
    }>>;
    texts: z.ZodOptional<z.ZodArray<z.ZodString>>;
    hint: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export type FanQueueScenario = z.infer<typeof fanQueueScenarioSchema>;
/** The scenario as Hub answers it: open tokens. */
export declare const fanQueueScenarioWireSchema: z.ZodObject<{
    action: z.ZodString;
    sendMode: z.ZodString;
    templates: z.ZodNullable<z.ZodString>;
    texts: z.ZodNullable<z.ZodArray<z.ZodString>>;
    hint: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export declare const agentFanQueuePageParamsSchema: z.ZodObject<{
    pageLabel: z.ZodString;
}, z.core.$strip>;
export declare const agentFanQueueParamsSchema: z.ZodObject<{
    queueId: z.ZodCoercedNumber<unknown>;
}, z.core.$strip>;
export declare const agentFanQueuePreviewBodySchema: z.ZodObject<{
    rule: z.ZodOptional<z.ZodObject<{
        audience: z.ZodOptional<z.ZodEnum<{
            subscribers: "subscribers";
            expired: "expired";
            followers: "followers";
            any: "any";
        }>>;
        fanWrote: z.ZodOptional<z.ZodEnum<{
            never: "never";
            ever: "ever";
        }>>;
        fanLastMessage: z.ZodOptional<z.ZodObject<{
            olderThanDays: z.ZodOptional<z.ZodNumber>;
            withinDays: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        pagePersonal: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<"never">, z.ZodObject<{
            olderThanDays: z.ZodOptional<z.ZodNumber>;
            withinDays: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>]>>;
        lifetimeSpend: z.ZodOptional<z.ZodObject<{
            min: z.ZodOptional<z.ZodNumber>;
            max: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        spend30d: z.ZodOptional<z.ZodObject<{
            min: z.ZodOptional<z.ZodNumber>;
            max: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        lastPurchase: z.ZodOptional<z.ZodObject<{
            olderThanDays: z.ZodOptional<z.ZodNumber>;
            withinDays: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        followed: z.ZodOptional<z.ZodObject<{
            olderThanDays: z.ZodOptional<z.ZodNumber>;
            withinDays: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        subscribed: z.ZodOptional<z.ZodObject<{
            olderThanDays: z.ZodOptional<z.ZodNumber>;
            withinDays: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        subscriptionEnds: z.ZodOptional<z.ZodObject<{
            withinDays: z.ZodNumber;
        }, z.core.$strict>>;
        autoRenew: z.ZodOptional<z.ZodBoolean>;
        seen: z.ZodOptional<z.ZodUnion<readonly [z.ZodObject<{
            withinDays: z.ZodNumber;
        }, z.core.$strict>, z.ZodObject<{
            notWithinDays: z.ZodNumber;
        }, z.core.$strict>]>>;
        otherPagesSpend: z.ZodOptional<z.ZodObject<{
            min: z.ZodOptional<z.ZodNumber>;
            max: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        markers: z.ZodOptional<z.ZodObject<{
            include: z.ZodOptional<z.ZodArray<z.ZodString>>;
            exclude: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strict>>;
        order: z.ZodOptional<z.ZodEnum<{
            spend: "spend";
            seen: "seen";
            followed_new: "followed_new";
            followed_old: "followed_old";
            fan_message: "fan_message";
            random: "random";
        }>>;
        limit: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
    fans: z.ZodOptional<z.ZodArray<z.ZodObject<{
        ref: z.ZodString;
        why: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>>;
    dailyLimit: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export declare const fanQueueExcludedSchema: z.ZodObject<{
    unreachable: z.ZodNumber;
    dismissed: z.ZodNumber;
    inOtherQueues: z.ZodNumber;
    markers: z.ZodNumber;
    notFound: z.ZodNumber;
    overLimit: z.ZodNumber;
}, z.core.$strip>;
export declare const agentFanQueuePreviewResponseSchema: z.ZodObject<{
    pageLabel: z.ZodString;
    ruleText: z.ZodArray<z.ZodString>;
    count: z.ZodNumber;
    excluded: z.ZodObject<{
        unreachable: z.ZodNumber;
        dismissed: z.ZodNumber;
        inOtherQueues: z.ZodNumber;
        markers: z.ZodNumber;
        notFound: z.ZodNumber;
        overLimit: z.ZodNumber;
    }, z.core.$strip>;
    samples: z.ZodArray<z.ZodObject<{
        fanRef: z.ZodString;
        username: z.ZodNullable<z.ZodString>;
        displayName: z.ZodNullable<z.ZodString>;
        why: z.ZodString;
    }, z.core.$strip>>;
    historyIncomplete: z.ZodNumber;
    daysAtLimit: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
export declare const agentFanQueueCreateBodySchema: z.ZodObject<{
    name: z.ZodString;
    goal: z.ZodOptional<z.ZodString>;
    kind: z.ZodDefault<z.ZodEnum<{
        campaign: "campaign";
        standing: "standing";
    }>>;
    rule: z.ZodOptional<z.ZodObject<{
        audience: z.ZodOptional<z.ZodEnum<{
            subscribers: "subscribers";
            expired: "expired";
            followers: "followers";
            any: "any";
        }>>;
        fanWrote: z.ZodOptional<z.ZodEnum<{
            never: "never";
            ever: "ever";
        }>>;
        fanLastMessage: z.ZodOptional<z.ZodObject<{
            olderThanDays: z.ZodOptional<z.ZodNumber>;
            withinDays: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        pagePersonal: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<"never">, z.ZodObject<{
            olderThanDays: z.ZodOptional<z.ZodNumber>;
            withinDays: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>]>>;
        lifetimeSpend: z.ZodOptional<z.ZodObject<{
            min: z.ZodOptional<z.ZodNumber>;
            max: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        spend30d: z.ZodOptional<z.ZodObject<{
            min: z.ZodOptional<z.ZodNumber>;
            max: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        lastPurchase: z.ZodOptional<z.ZodObject<{
            olderThanDays: z.ZodOptional<z.ZodNumber>;
            withinDays: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        followed: z.ZodOptional<z.ZodObject<{
            olderThanDays: z.ZodOptional<z.ZodNumber>;
            withinDays: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        subscribed: z.ZodOptional<z.ZodObject<{
            olderThanDays: z.ZodOptional<z.ZodNumber>;
            withinDays: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        subscriptionEnds: z.ZodOptional<z.ZodObject<{
            withinDays: z.ZodNumber;
        }, z.core.$strict>>;
        autoRenew: z.ZodOptional<z.ZodBoolean>;
        seen: z.ZodOptional<z.ZodUnion<readonly [z.ZodObject<{
            withinDays: z.ZodNumber;
        }, z.core.$strict>, z.ZodObject<{
            notWithinDays: z.ZodNumber;
        }, z.core.$strict>]>>;
        otherPagesSpend: z.ZodOptional<z.ZodObject<{
            min: z.ZodOptional<z.ZodNumber>;
            max: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        markers: z.ZodOptional<z.ZodObject<{
            include: z.ZodOptional<z.ZodArray<z.ZodString>>;
            exclude: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strict>>;
        order: z.ZodOptional<z.ZodEnum<{
            spend: "spend";
            seen: "seen";
            followed_new: "followed_new";
            followed_old: "followed_old";
            fan_message: "fan_message";
            random: "random";
        }>>;
        limit: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
    fans: z.ZodOptional<z.ZodArray<z.ZodObject<{
        ref: z.ZodString;
        why: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>>;
    scenario: z.ZodObject<{
        action: z.ZodEnum<{
            ping: "ping";
            auto: "auto";
            reply: "reply";
            hi: "hi";
            template: "template";
            own: "own";
        }>;
        sendMode: z.ZodDefault<z.ZodEnum<{
            one: "one";
            batch: "batch";
        }>>;
        templates: z.ZodOptional<z.ZodEnum<{
            a: "a";
            b: "b";
        }>>;
        texts: z.ZodOptional<z.ZodArray<z.ZodString>>;
        hint: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
    distribution: z.ZodDefault<z.ZodEnum<{
        people: "people";
        pool: "pool";
    }>>;
    people: z.ZodOptional<z.ZodArray<z.ZodString>>;
    split: z.ZodOptional<z.ZodArray<z.ZodObject<{
        username: z.ZodString;
        count: z.ZodNumber;
    }, z.core.$strict>>>;
    perPerson: z.ZodOptional<z.ZodNumber>;
    dailyLimit: z.ZodOptional<z.ZodNumber>;
    endsAt: z.ZodOptional<z.ZodString>;
    requestedBy: z.ZodString;
    idempotencyKey: z.ZodString;
}, z.core.$strict>;
export declare const agentFanQueueUpdateBodySchema: z.ZodObject<{
    requestedBy: z.ZodString;
    status: z.ZodOptional<z.ZodEnum<{
        active: "active";
        paused: "paused";
        done: "done";
    }>>;
    name: z.ZodOptional<z.ZodString>;
    goal: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    scenario: z.ZodOptional<z.ZodObject<{
        action: z.ZodEnum<{
            ping: "ping";
            auto: "auto";
            reply: "reply";
            hi: "hi";
            template: "template";
            own: "own";
        }>;
        sendMode: z.ZodDefault<z.ZodEnum<{
            one: "one";
            batch: "batch";
        }>>;
        templates: z.ZodOptional<z.ZodEnum<{
            a: "a";
            b: "b";
        }>>;
        texts: z.ZodOptional<z.ZodArray<z.ZodString>>;
        hint: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    perPerson: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    dailyLimit: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    endsAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    addPeople: z.ZodOptional<z.ZodArray<z.ZodString>>;
    removePeople: z.ZodOptional<z.ZodArray<z.ZodString>>;
    move: z.ZodOptional<z.ZodObject<{
        from: z.ZodString;
        to: z.ZodNullable<z.ZodString>;
        count: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const agentFanQueueAppendBodySchema: z.ZodObject<{
    requestedBy: z.ZodString;
    rule: z.ZodOptional<z.ZodObject<{
        audience: z.ZodOptional<z.ZodEnum<{
            subscribers: "subscribers";
            expired: "expired";
            followers: "followers";
            any: "any";
        }>>;
        fanWrote: z.ZodOptional<z.ZodEnum<{
            never: "never";
            ever: "ever";
        }>>;
        fanLastMessage: z.ZodOptional<z.ZodObject<{
            olderThanDays: z.ZodOptional<z.ZodNumber>;
            withinDays: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        pagePersonal: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<"never">, z.ZodObject<{
            olderThanDays: z.ZodOptional<z.ZodNumber>;
            withinDays: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>]>>;
        lifetimeSpend: z.ZodOptional<z.ZodObject<{
            min: z.ZodOptional<z.ZodNumber>;
            max: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        spend30d: z.ZodOptional<z.ZodObject<{
            min: z.ZodOptional<z.ZodNumber>;
            max: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        lastPurchase: z.ZodOptional<z.ZodObject<{
            olderThanDays: z.ZodOptional<z.ZodNumber>;
            withinDays: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        followed: z.ZodOptional<z.ZodObject<{
            olderThanDays: z.ZodOptional<z.ZodNumber>;
            withinDays: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        subscribed: z.ZodOptional<z.ZodObject<{
            olderThanDays: z.ZodOptional<z.ZodNumber>;
            withinDays: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        subscriptionEnds: z.ZodOptional<z.ZodObject<{
            withinDays: z.ZodNumber;
        }, z.core.$strict>>;
        autoRenew: z.ZodOptional<z.ZodBoolean>;
        seen: z.ZodOptional<z.ZodUnion<readonly [z.ZodObject<{
            withinDays: z.ZodNumber;
        }, z.core.$strict>, z.ZodObject<{
            notWithinDays: z.ZodNumber;
        }, z.core.$strict>]>>;
        otherPagesSpend: z.ZodOptional<z.ZodObject<{
            min: z.ZodOptional<z.ZodNumber>;
            max: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        markers: z.ZodOptional<z.ZodObject<{
            include: z.ZodOptional<z.ZodArray<z.ZodString>>;
            exclude: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strict>>;
        order: z.ZodOptional<z.ZodEnum<{
            spend: "spend";
            seen: "seen";
            followed_new: "followed_new";
            followed_old: "followed_old";
            fan_message: "fan_message";
            random: "random";
        }>>;
        limit: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
    fans: z.ZodOptional<z.ZodArray<z.ZodObject<{
        ref: z.ZodString;
        why: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>>;
}, z.core.$strict>;
export declare const agentFanQueueListQuerySchema: z.ZodObject<{
    pageLabel: z.ZodOptional<z.ZodString>;
    status: z.ZodDefault<z.ZodEnum<{
        all: "all";
        active: "active";
        paused: "paused";
        open: "open";
        done: "done";
    }>>;
}, z.core.$strict>;
export declare const agentFanQueueGetQuerySchema: z.ZodObject<{
    from: z.ZodOptional<z.ZodString>;
    to: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const agentFanQueueSchema: z.ZodObject<{
    queueId: z.ZodNumber;
    pageLabel: z.ZodString;
    name: z.ZodString;
    goal: z.ZodNullable<z.ZodString>;
    kind: z.ZodString;
    status: z.ZodString;
    rule: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    ruleText: z.ZodNullable<z.ZodArray<z.ZodString>>;
    scenario: z.ZodObject<{
        action: z.ZodString;
        sendMode: z.ZodString;
        templates: z.ZodNullable<z.ZodString>;
        texts: z.ZodNullable<z.ZodArray<z.ZodString>>;
        hint: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
    distribution: z.ZodString;
    people: z.ZodArray<z.ZodString>;
    perPerson: z.ZodNullable<z.ZodNumber>;
    dailyLimit: z.ZodNullable<z.ZodNumber>;
    endsAt: z.ZodNullable<z.ZodString>;
    requestedBy: z.ZodString;
    createdAt: z.ZodString;
    pausedAt: z.ZodNullable<z.ZodString>;
    pausedBy: z.ZodNullable<z.ZodString>;
    finishedAt: z.ZodNullable<z.ZodString>;
    counts: z.ZodObject<{
        pending: z.ZodNumber;
        leased: z.ZodNumber;
        sent: z.ZodNumber;
        skipped: z.ZodNumber;
        dropped: z.ZodNumber;
    }, z.core.$strip>;
    today: z.ZodObject<{
        sent: z.ZodNumber;
        byPerson: z.ZodArray<z.ZodObject<{
            username: z.ZodString;
            sent: z.ZodNumber;
            skipped: z.ZodNumber;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    daysLeft: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
export declare const agentFanQueueResultsSchema: z.ZodObject<{
    byPerson: z.ZodArray<z.ZodObject<{
        sent: z.ZodNumber;
        matured72h: z.ZodNumber;
        replied72h: z.ZodNumber;
        matured7d: z.ZodNumber;
        bought7d: z.ZodNumber;
        matured30d: z.ZodNumber;
        spent30dMills: z.ZodNumber;
        username: z.ZodString;
    }, z.core.$strip>>;
    skipped: z.ZodRecord<z.ZodString, z.ZodNumber>;
    dropped: z.ZodRecord<z.ZodString, z.ZodNumber>;
    sent: z.ZodNumber;
    matured72h: z.ZodNumber;
    replied72h: z.ZodNumber;
    matured7d: z.ZodNumber;
    bought7d: z.ZodNumber;
    matured30d: z.ZodNumber;
    spent30dMills: z.ZodNumber;
    from: z.ZodString;
    to: z.ZodString;
}, z.core.$strip>;
export declare const agentFanQueueDetailSchema: z.ZodObject<{
    queueId: z.ZodNumber;
    pageLabel: z.ZodString;
    name: z.ZodString;
    goal: z.ZodNullable<z.ZodString>;
    kind: z.ZodString;
    status: z.ZodString;
    rule: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    ruleText: z.ZodNullable<z.ZodArray<z.ZodString>>;
    scenario: z.ZodObject<{
        action: z.ZodString;
        sendMode: z.ZodString;
        templates: z.ZodNullable<z.ZodString>;
        texts: z.ZodNullable<z.ZodArray<z.ZodString>>;
        hint: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
    distribution: z.ZodString;
    people: z.ZodArray<z.ZodString>;
    perPerson: z.ZodNullable<z.ZodNumber>;
    dailyLimit: z.ZodNullable<z.ZodNumber>;
    endsAt: z.ZodNullable<z.ZodString>;
    requestedBy: z.ZodString;
    createdAt: z.ZodString;
    pausedAt: z.ZodNullable<z.ZodString>;
    pausedBy: z.ZodNullable<z.ZodString>;
    finishedAt: z.ZodNullable<z.ZodString>;
    counts: z.ZodObject<{
        pending: z.ZodNumber;
        leased: z.ZodNumber;
        sent: z.ZodNumber;
        skipped: z.ZodNumber;
        dropped: z.ZodNumber;
    }, z.core.$strip>;
    today: z.ZodObject<{
        sent: z.ZodNumber;
        byPerson: z.ZodArray<z.ZodObject<{
            username: z.ZodString;
            sent: z.ZodNumber;
            skipped: z.ZodNumber;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    daysLeft: z.ZodNullable<z.ZodNumber>;
    results: z.ZodObject<{
        byPerson: z.ZodArray<z.ZodObject<{
            sent: z.ZodNumber;
            matured72h: z.ZodNumber;
            replied72h: z.ZodNumber;
            matured7d: z.ZodNumber;
            bought7d: z.ZodNumber;
            matured30d: z.ZodNumber;
            spent30dMills: z.ZodNumber;
            username: z.ZodString;
        }, z.core.$strip>>;
        skipped: z.ZodRecord<z.ZodString, z.ZodNumber>;
        dropped: z.ZodRecord<z.ZodString, z.ZodNumber>;
        sent: z.ZodNumber;
        matured72h: z.ZodNumber;
        replied72h: z.ZodNumber;
        matured7d: z.ZodNumber;
        bought7d: z.ZodNumber;
        matured30d: z.ZodNumber;
        spent30dMills: z.ZodNumber;
        from: z.ZodString;
        to: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const agentFanQueueListResponseSchema: z.ZodObject<{
    queues: z.ZodArray<z.ZodObject<{
        queueId: z.ZodNumber;
        pageLabel: z.ZodString;
        name: z.ZodString;
        goal: z.ZodNullable<z.ZodString>;
        kind: z.ZodString;
        status: z.ZodString;
        rule: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        ruleText: z.ZodNullable<z.ZodArray<z.ZodString>>;
        scenario: z.ZodObject<{
            action: z.ZodString;
            sendMode: z.ZodString;
            templates: z.ZodNullable<z.ZodString>;
            texts: z.ZodNullable<z.ZodArray<z.ZodString>>;
            hint: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
        distribution: z.ZodString;
        people: z.ZodArray<z.ZodString>;
        perPerson: z.ZodNullable<z.ZodNumber>;
        dailyLimit: z.ZodNullable<z.ZodNumber>;
        endsAt: z.ZodNullable<z.ZodString>;
        requestedBy: z.ZodString;
        createdAt: z.ZodString;
        pausedAt: z.ZodNullable<z.ZodString>;
        pausedBy: z.ZodNullable<z.ZodString>;
        finishedAt: z.ZodNullable<z.ZodString>;
        counts: z.ZodObject<{
            pending: z.ZodNumber;
            leased: z.ZodNumber;
            sent: z.ZodNumber;
            skipped: z.ZodNumber;
            dropped: z.ZodNumber;
        }, z.core.$strip>;
        today: z.ZodObject<{
            sent: z.ZodNumber;
            byPerson: z.ZodArray<z.ZodObject<{
                username: z.ZodString;
                sent: z.ZodNumber;
                skipped: z.ZodNumber;
            }, z.core.$strip>>;
        }, z.core.$strip>;
        daysLeft: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const agentFanQueueAppendResponseSchema: z.ZodObject<{
    added: z.ZodNumber;
    excluded: z.ZodObject<{
        unreachable: z.ZodNumber;
        dismissed: z.ZodNumber;
        inOtherQueues: z.ZodNumber;
        markers: z.ZodNumber;
        notFound: z.ZodNumber;
        overLimit: z.ZodNumber;
    }, z.core.$strip>;
    queue: z.ZodObject<{
        queueId: z.ZodNumber;
        pageLabel: z.ZodString;
        name: z.ZodString;
        goal: z.ZodNullable<z.ZodString>;
        kind: z.ZodString;
        status: z.ZodString;
        rule: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        ruleText: z.ZodNullable<z.ZodArray<z.ZodString>>;
        scenario: z.ZodObject<{
            action: z.ZodString;
            sendMode: z.ZodString;
            templates: z.ZodNullable<z.ZodString>;
            texts: z.ZodNullable<z.ZodArray<z.ZodString>>;
            hint: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
        distribution: z.ZodString;
        people: z.ZodArray<z.ZodString>;
        perPerson: z.ZodNullable<z.ZodNumber>;
        dailyLimit: z.ZodNullable<z.ZodNumber>;
        endsAt: z.ZodNullable<z.ZodString>;
        requestedBy: z.ZodString;
        createdAt: z.ZodString;
        pausedAt: z.ZodNullable<z.ZodString>;
        pausedBy: z.ZodNullable<z.ZodString>;
        finishedAt: z.ZodNullable<z.ZodString>;
        counts: z.ZodObject<{
            pending: z.ZodNumber;
            leased: z.ZodNumber;
            sent: z.ZodNumber;
            skipped: z.ZodNumber;
            dropped: z.ZodNumber;
        }, z.core.$strip>;
        today: z.ZodObject<{
            sent: z.ZodNumber;
            byPerson: z.ZodArray<z.ZodObject<{
                username: z.ZodString;
                sent: z.ZodNumber;
                skipped: z.ZodNumber;
            }, z.core.$strip>>;
        }, z.core.$strip>;
        daysLeft: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const clientFanQueueParamsSchema: z.ZodObject<{
    pageLabel: z.ZodString;
    queueId: z.ZodCoercedNumber<unknown>;
}, z.core.$strip>;
export declare const clientFanQueueItemParamsSchema: z.ZodObject<{
    pageLabel: z.ZodString;
    itemId: z.ZodCoercedNumber<unknown>;
}, z.core.$strip>;
export declare const clientFanQueueSummarySchema: z.ZodObject<{
    queueId: z.ZodNumber;
    name: z.ZodString;
    goal: z.ZodNullable<z.ZodString>;
    kind: z.ZodString;
    status: z.ZodString;
    distribution: z.ZodString;
    mineOnly: z.ZodBoolean;
    scenario: z.ZodObject<{
        action: z.ZodString;
        sendMode: z.ZodString;
        templates: z.ZodNullable<z.ZodString>;
        texts: z.ZodNullable<z.ZodArray<z.ZodString>>;
        hint: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
    ruleText: z.ZodNullable<z.ZodArray<z.ZodString>>;
    requestedBy: z.ZodString;
    pausedAt: z.ZodNullable<z.ZodString>;
    pausedBy: z.ZodNullable<z.ZodString>;
    perPerson: z.ZodNullable<z.ZodNumber>;
    dailyLimit: z.ZodNullable<z.ZodNumber>;
    today: z.ZodObject<{
        mine: z.ZodNumber;
        page: z.ZodNumber;
    }, z.core.$strip>;
    pending: z.ZodNumber;
    leasedToMe: z.ZodNumber;
}, z.core.$strip>;
/** A fan the caller wrote to from a queue within 72 hours who answered after: on top, with a Reply draft. */
export declare const clientFanQueueAnsweredSchema: z.ZodObject<{
    itemId: z.ZodNumber;
    queueId: z.ZodNumber;
    fanRef: z.ZodString;
    conversationRef: z.ZodNullable<z.ZodString>;
    username: z.ZodNullable<z.ZodString>;
    displayName: z.ZodNullable<z.ZodString>;
    alias: z.ZodNullable<z.ZodString>;
    sentAt: z.ZodString;
    act: z.ZodNullable<z.ZodString>;
    templateId: z.ZodNullable<z.ZodString>;
    answeredAt: z.ZodString;
    answerText: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export declare const clientFanQueuesResponseSchema: z.ZodObject<{
    pageLabel: z.ZodString;
    queues: z.ZodArray<z.ZodObject<{
        queueId: z.ZodNumber;
        name: z.ZodString;
        goal: z.ZodNullable<z.ZodString>;
        kind: z.ZodString;
        status: z.ZodString;
        distribution: z.ZodString;
        mineOnly: z.ZodBoolean;
        scenario: z.ZodObject<{
            action: z.ZodString;
            sendMode: z.ZodString;
            templates: z.ZodNullable<z.ZodString>;
            texts: z.ZodNullable<z.ZodArray<z.ZodString>>;
            hint: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
        ruleText: z.ZodNullable<z.ZodArray<z.ZodString>>;
        requestedBy: z.ZodString;
        pausedAt: z.ZodNullable<z.ZodString>;
        pausedBy: z.ZodNullable<z.ZodString>;
        perPerson: z.ZodNullable<z.ZodNumber>;
        dailyLimit: z.ZodNullable<z.ZodNumber>;
        today: z.ZodObject<{
            mine: z.ZodNumber;
            page: z.ZodNumber;
        }, z.core.$strip>;
        pending: z.ZodNumber;
        leasedToMe: z.ZodNumber;
    }, z.core.$strip>>;
    answered: z.ZodArray<z.ZodObject<{
        itemId: z.ZodNumber;
        queueId: z.ZodNumber;
        fanRef: z.ZodString;
        conversationRef: z.ZodNullable<z.ZodString>;
        username: z.ZodNullable<z.ZodString>;
        displayName: z.ZodNullable<z.ZodString>;
        alias: z.ZodNullable<z.ZodString>;
        sentAt: z.ZodString;
        act: z.ZodNullable<z.ZodString>;
        templateId: z.ZodNullable<z.ZodString>;
        answeredAt: z.ZodString;
        answerText: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    templates: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        group: z.ZodString;
        text: z.ZodString;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const clientFanQueueTakeBodySchema: z.ZodObject<{
    count: z.ZodDefault<z.ZodNumber>;
    more: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strict>;
export declare const clientFanQueueItemSchema: z.ZodObject<{
    fanRef: z.ZodString;
    conversationRef: z.ZodNullable<z.ZodString>;
    username: z.ZodNullable<z.ZodString>;
    displayName: z.ZodNullable<z.ZodString>;
    alias: z.ZodNullable<z.ZodString>;
    greetingName: z.ZodNullable<z.ZodString>;
    lifetimeGrossMills: z.ZodNumber;
    last30dGrossMills: z.ZodNumber;
    seenAt: z.ZodNullable<z.ZodString>;
    onlineSince: z.ZodNullable<z.ZodString>;
    seenSource: z.ZodNullable<z.ZodString>;
    reason: z.ZodString;
    reasonAt: z.ZodNullable<z.ZodString>;
    act: z.ZodString;
    aside: z.ZodNullable<z.ZodString>;
    asideAt: z.ZodNullable<z.ZodString>;
    asideBy: z.ZodNullable<z.ZodString>;
    messageCount: z.ZodNumber;
    lastFanMessageAt: z.ZodNullable<z.ZodString>;
    lastPageMessageAt: z.ZodNullable<z.ZodString>;
    subscription: z.ZodObject<{
        isSubscriber: z.ZodBoolean;
        startedAt: z.ZodNullable<z.ZodString>;
        endsAt: z.ZodNullable<z.ZodString>;
        autoRenew: z.ZodNullable<z.ZodBoolean>;
    }, z.core.$strip>;
    itemId: z.ZodNumber;
    queueId: z.ZodNumber;
    why: z.ZodNullable<z.ZodString>;
    leaseUntil: z.ZodString;
    templateId: z.ZodNullable<z.ZodString>;
    followedAt: z.ZodNullable<z.ZodString>;
    massLast90d: z.ZodObject<{
        count: z.ZodNumber;
        lastAt: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const clientFanQueueTakeResponseSchema: z.ZodObject<{
    queueId: z.ZodNumber;
    items: z.ZodArray<z.ZodObject<{
        fanRef: z.ZodString;
        conversationRef: z.ZodNullable<z.ZodString>;
        username: z.ZodNullable<z.ZodString>;
        displayName: z.ZodNullable<z.ZodString>;
        alias: z.ZodNullable<z.ZodString>;
        greetingName: z.ZodNullable<z.ZodString>;
        lifetimeGrossMills: z.ZodNumber;
        last30dGrossMills: z.ZodNumber;
        seenAt: z.ZodNullable<z.ZodString>;
        onlineSince: z.ZodNullable<z.ZodString>;
        seenSource: z.ZodNullable<z.ZodString>;
        reason: z.ZodString;
        reasonAt: z.ZodNullable<z.ZodString>;
        act: z.ZodString;
        aside: z.ZodNullable<z.ZodString>;
        asideAt: z.ZodNullable<z.ZodString>;
        asideBy: z.ZodNullable<z.ZodString>;
        messageCount: z.ZodNumber;
        lastFanMessageAt: z.ZodNullable<z.ZodString>;
        lastPageMessageAt: z.ZodNullable<z.ZodString>;
        subscription: z.ZodObject<{
            isSubscriber: z.ZodBoolean;
            startedAt: z.ZodNullable<z.ZodString>;
            endsAt: z.ZodNullable<z.ZodString>;
            autoRenew: z.ZodNullable<z.ZodBoolean>;
        }, z.core.$strip>;
        itemId: z.ZodNumber;
        queueId: z.ZodNumber;
        why: z.ZodNullable<z.ZodString>;
        leaseUntil: z.ZodString;
        templateId: z.ZodNullable<z.ZodString>;
        followedAt: z.ZodNullable<z.ZodString>;
        massLast90d: z.ZodObject<{
            count: z.ZodNumber;
            lastAt: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
    }, z.core.$strip>>;
    stopped: z.ZodNullable<z.ZodString>;
    today: z.ZodObject<{
        mine: z.ZodNumber;
        page: z.ZodNumber;
    }, z.core.$strip>;
    pending: z.ZodNumber;
    dropped: z.ZodNumber;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const clientFanQueueItemDoneBodySchema: z.ZodObject<{
    outcome: z.ZodEnum<{
        skipped: "skipped";
        sent: "sent";
    }>;
    act: z.ZodOptional<z.ZodEnum<{
        ping: "ping";
        reply: "reply";
        hi: "hi";
        template: "template";
        own: "own";
    }>>;
    templateId: z.ZodOptional<z.ZodString>;
    skipReason: z.ZodOptional<z.ZodEnum<{
        not_fit: "not_fit";
        later: "later";
        talking: "talking";
        dismiss: "dismiss";
    }>>;
    uncertain: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
export declare const clientFanQueueItemDoneResponseSchema: z.ZodObject<{
    itemId: z.ZodNumber;
    state: z.ZodString;
    today: z.ZodObject<{
        mine: z.ZodNumber;
        page: z.ZodNumber;
    }, z.core.$strip>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const clientFanQueueReleaseBodySchema: z.ZodObject<{}, z.core.$strict>;
export declare const clientFanQueueReleaseResponseSchema: z.ZodObject<{
    released: z.ZodNumber;
}, z.core.$strip>;
export type FanQueueExcluded = z.infer<typeof fanQueueExcludedSchema>;
export type AgentFanQueue = z.infer<typeof agentFanQueueSchema>;
export type AgentFanQueueDetail = z.infer<typeof agentFanQueueDetailSchema>;
export type AgentFanQueueResults = z.infer<typeof agentFanQueueResultsSchema>;
export type AgentFanQueuePreviewBody = z.infer<typeof agentFanQueuePreviewBodySchema>;
export type AgentFanQueuePreviewResponse = z.infer<typeof agentFanQueuePreviewResponseSchema>;
export type AgentFanQueueCreateBody = z.infer<typeof agentFanQueueCreateBodySchema>;
export type AgentFanQueueUpdateBody = z.infer<typeof agentFanQueueUpdateBodySchema>;
export type AgentFanQueueAppendBody = z.infer<typeof agentFanQueueAppendBodySchema>;
export type AgentFanQueueAppendResponse = z.infer<typeof agentFanQueueAppendResponseSchema>;
export type AgentFanQueueListQuery = z.infer<typeof agentFanQueueListQuerySchema>;
export type AgentFanQueueListResponse = z.infer<typeof agentFanQueueListResponseSchema>;
export type AgentFanQueueGetQuery = z.infer<typeof agentFanQueueGetQuerySchema>;
export type ClientFanQueueSummary = z.infer<typeof clientFanQueueSummarySchema>;
export type ClientFanQueueAnswered = z.infer<typeof clientFanQueueAnsweredSchema>;
export type ClientFanQueuesResponse = z.infer<typeof clientFanQueuesResponseSchema>;
export type ClientFanQueueTakeBody = z.infer<typeof clientFanQueueTakeBodySchema>;
export type ClientFanQueueItem = z.infer<typeof clientFanQueueItemSchema>;
export type ClientFanQueueTakeResponse = z.infer<typeof clientFanQueueTakeResponseSchema>;
export type ClientFanQueueItemDoneBody = z.infer<typeof clientFanQueueItemDoneBodySchema>;
export type ClientFanQueueItemDoneResponse = z.infer<typeof clientFanQueueItemDoneResponseSchema>;
export type ClientFanQueueReleaseResponse = z.infer<typeof clientFanQueueReleaseResponseSchema>;
