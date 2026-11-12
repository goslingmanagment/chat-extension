/**
 * The chatters' pay as the agency ledger counts it (ledger release 2, H2):
 * what each person accrued and was paid in a window of Moscow days, and what
 * the agency owes them now. Hub keeps the facts, the ledger keeps the money
 * (owner, 2026-11-08): Hub's server reads the ledger's GET /v1/payouts with a
 * `payouts` key (LEDGER_PAYOUTS_KEY) on the owner's behalf and passes it on,
 * micro-dollars turned into mills. Owner session only: a person's pay is the
 * owner's. 503 — the ledger is not connected or did not answer.
 */
import { z } from "zod";
/** The ledger's widest window of one read (ledger MaxPayoutDays). */
export declare const TEAM_LEDGER_PAYOUTS_MAX_DAYS = 62;
export declare const teamLedgerPayoutsQuerySchema: z.ZodObject<{
    from: z.ZodString;
    to: z.ZodString;
}, z.core.$strip>;
export declare const teamLedgerPayoutPersonSchema: z.ZodObject<{
    slug: z.ZodString;
    name: z.ZodString;
    aliases: z.ZodArray<z.ZodString>;
    status: z.ZodString;
    hubUser: z.ZodNullable<z.ZodObject<{
        userId: z.ZodNumber;
        username: z.ZodString;
    }, z.core.$strip>>;
    days: z.ZodArray<z.ZodObject<{
        date: z.ZodString;
        model: z.ZodString;
        amountMills: z.ZodNumber;
        worked: z.ZodBoolean;
        source: z.ZodString;
    }, z.core.$strip>>;
    accruedMills: z.ZodNumber;
    paidMills: z.ZodNumber;
    balanceMills: z.ZodNumber;
    toPayMills: z.ZodNullable<z.ZodNumber>;
    oldestUnpaidDate: z.ZodNullable<z.ZodString>;
    unpaidDays: z.ZodArray<z.ZodObject<{
        date: z.ZodString;
        kind: z.ZodString;
        model: z.ZodNullable<z.ZodString>;
        unpaidMills: z.ZodNumber;
    }, z.core.$strip>>;
    unentered: z.ZodObject<{
        days: z.ZodNumber;
        shareMills: z.ZodNumber;
        unknown: z.ZodNumber;
    }, z.core.$strip>;
    pendingChanges: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        day: z.ZodString;
        model: z.ZodString;
        postedMills: z.ZodNumber;
        newMills: z.ZodNumber;
        reason: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const teamLedgerPayoutsResponseSchema: z.ZodObject<{
    from: z.ZodString;
    to: z.ZodString;
    accrualFrom: z.ZodString;
    factsFrom: z.ZodNullable<z.ZodString>;
    reportsFrom: z.ZodNullable<z.ZodString>;
    generatedAt: z.ZodString;
    people: z.ZodArray<z.ZodObject<{
        slug: z.ZodString;
        name: z.ZodString;
        aliases: z.ZodArray<z.ZodString>;
        status: z.ZodString;
        hubUser: z.ZodNullable<z.ZodObject<{
            userId: z.ZodNumber;
            username: z.ZodString;
        }, z.core.$strip>>;
        days: z.ZodArray<z.ZodObject<{
            date: z.ZodString;
            model: z.ZodString;
            amountMills: z.ZodNumber;
            worked: z.ZodBoolean;
            source: z.ZodString;
        }, z.core.$strip>>;
        accruedMills: z.ZodNumber;
        paidMills: z.ZodNumber;
        balanceMills: z.ZodNumber;
        toPayMills: z.ZodNullable<z.ZodNumber>;
        oldestUnpaidDate: z.ZodNullable<z.ZodString>;
        unpaidDays: z.ZodArray<z.ZodObject<{
            date: z.ZodString;
            kind: z.ZodString;
            model: z.ZodNullable<z.ZodString>;
            unpaidMills: z.ZodNumber;
        }, z.core.$strip>>;
        unentered: z.ZodObject<{
            days: z.ZodNumber;
            shareMills: z.ZodNumber;
            unknown: z.ZodNumber;
        }, z.core.$strip>;
        pendingChanges: z.ZodArray<z.ZodObject<{
            id: z.ZodNumber;
            day: z.ZodString;
            model: z.ZodString;
            postedMills: z.ZodNumber;
            newMills: z.ZodNumber;
            reason: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    checks: z.ZodObject<{
        stale: z.ZodBoolean;
        lastSheetsCollectAt: z.ZodNullable<z.ZodString>;
        lastRebuildAt: z.ZodNullable<z.ZodString>;
        debtsStale: z.ZodBoolean;
        sheetsStale: z.ZodBoolean;
    }, z.core.$strip>;
    serverNow: z.ZodString;
}, z.core.$strip>;
/** A day's state by the FIFO of payouts (the ledger's two): paid, still owed (in part or whole); none — accrued nothing. */
export declare const LEDGER_DAY_STATES: readonly ["paid", "to_pay", "none"];
export declare const ledgerDayStateEnum: z.ZodEnum<{
    none: "none";
    paid: "paid";
    to_pay: "to_pay";
}>;
export declare const teamLedgerPayoutPersonQuerySchema: z.ZodObject<{
    person: z.ZodString;
    from: z.ZodString;
    to: z.ZodString;
}, z.core.$strip>;
/**
 * One person's pay in a window as the ledger keeps it (GET /v1/payouts/person): each day accrued with its state by the
 * payouts, the manual postings on the debt with their memo (a bonus adds, a fine or an advance takes off), the
 * payouts, the last payout and the debt now. Owner session only; no rate, no fix, no revenue a day was priced from.
 */
export declare const teamLedgerPayoutPersonResponseSchema: z.ZodObject<{
    slug: z.ZodString;
    name: z.ZodString;
    from: z.ZodString;
    to: z.ZodString;
    accrualFrom: z.ZodString;
    factsFrom: z.ZodNullable<z.ZodString>;
    reportsFrom: z.ZodNullable<z.ZodString>;
    generatedAt: z.ZodString;
    accruedMills: z.ZodNumber;
    paidMills: z.ZodNumber;
    balanceMills: z.ZodNumber;
    oldestUnpaidDate: z.ZodNullable<z.ZodString>;
    lastPayout: z.ZodNullable<z.ZodObject<{
        date: z.ZodString;
        document: z.ZodNumber;
        amountMills: z.ZodNumber;
    }, z.core.$strip>>;
    days: z.ZodArray<z.ZodObject<{
        date: z.ZodString;
        model: z.ZodString;
        amountMills: z.ZodNumber;
        worked: z.ZodBoolean;
        source: z.ZodString;
        state: z.ZodEnum<{
            none: "none";
            paid: "paid";
            to_pay: "to_pay";
        }>;
        paidMills: z.ZodNumber;
        unpaidMills: z.ZodNumber;
        paidBy: z.ZodArray<z.ZodNumber>;
    }, z.core.$strip>>;
    adjustments: z.ZodArray<z.ZodObject<{
        date: z.ZodString;
        amountMills: z.ZodNumber;
        memo: z.ZodString;
        document: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
    payouts: z.ZodArray<z.ZodObject<{
        date: z.ZodString;
        document: z.ZodNumber;
        amountMills: z.ZodNumber;
    }, z.core.$strip>>;
    checks: z.ZodObject<{
        stale: z.ZodBoolean;
        lastRebuildAt: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const teamLedgerPayoutPrepareQuerySchema: z.ZodObject<{
    person: z.ZodString;
}, z.core.$strip>;
/** One person's payout brief (ledger L5 `payout prepare`): read-only, nothing is recorded or sent. */
export declare const teamLedgerPayoutPrepareResponseSchema: z.ZodObject<{
    slug: z.ZodString;
    name: z.ZodString;
    generatedAt: z.ZodString;
    amountMills: z.ZodNumber;
    nothing: z.ZodNullable<z.ZodString>;
    toPayMills: z.ZodNullable<z.ZodNumber>;
    period: z.ZodNullable<z.ZodObject<{
        from: z.ZodString;
        to: z.ZodString;
    }, z.core.$strip>>;
    lines: z.ZodArray<z.ZodObject<{
        kind: z.ZodString;
        model: z.ZodNullable<z.ZodString>;
        text: z.ZodString;
        shownMills: z.ZodNumber;
        from: z.ZodNullable<z.ZodString>;
        to: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    flags: z.ZodArray<z.ZodObject<{
        kind: z.ZodString;
        blocker: z.ZodBoolean;
        text: z.ZodString;
    }, z.core.$strip>>;
    blockers: z.ZodNumber;
    suggestion: z.ZodNullable<z.ZodObject<{
        transferMills: z.ZodNumber;
        aboveTableMills: z.ZodNumber;
        note: z.ZodString;
    }, z.core.$strip>>;
    message: z.ZodNullable<z.ZodString>;
    placeholder: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/**
 * Every chatter's shift reports of a window (Workboard «Выплаты → Отчёты», the owner's): the pay base the ledger
 * reads from the posts in «Отчётность» — posted and drafted page by page — each day with the agent's draft as the
 * chatter sees it, and the posts the ledger could not use in full. Read from the ledger's GET /v1/reports,
 * /v1/report-days and /v1/report-posts with Hub's payouts key. No post text reaches Hub.
 */
export declare const TEAM_LEDGER_REPORTS_MAX_DAYS = 62;
export declare const teamLedgerReportsQuerySchema: z.ZodObject<{
    from: z.ZodString;
    to: z.ZodString;
}, z.core.$strip>;
/** Whose a report or a post is. */
export declare const teamLedgerReportPersonSchema: z.ZodObject<{
    slug: z.ZodNullable<z.ZodString>;
    hubUser: z.ZodNullable<z.ZodObject<{
        userId: z.ZodNumber;
        username: z.ZodString;
    }, z.core.$strip>>;
    name: z.ZodString;
}, z.core.$strip>;
/** One page of a person's report day in the pay base. */
export declare const teamLedgerReportPageSchema: z.ZodObject<{
    pageLabel: z.ZodString;
    model: z.ZodString;
    postedMills: z.ZodNullable<z.ZodNumber>;
    draftMills: z.ZodNullable<z.ZodNumber>;
    diffMills: z.ZodNullable<z.ZodNumber>;
    state: z.ZodString;
    postedAt: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/** A post in «Отчётность» the ledger could not use in full (a flag on it). */
export declare const teamLedgerReportPostSchema: z.ZodObject<{
    id: z.ZodNumber;
    postedAt: z.ZodString;
    sender: z.ZodString;
    tag: z.ZodString;
    person: z.ZodObject<{
        slug: z.ZodNullable<z.ZodString>;
        hubUser: z.ZodNullable<z.ZodObject<{
            userId: z.ZodNumber;
            username: z.ZodString;
        }, z.core.$strip>>;
        name: z.ZodString;
    }, z.core.$strip>;
    model: z.ZodString;
    reportDate: z.ZodNullable<z.ZodString>;
    totalMills: z.ZodNumber;
    pagesMills: z.ZodNumber;
    flags: z.ZodArray<z.ZodString>;
    blocking: z.ZodBoolean;
    pages: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        pageLabel: z.ZodNullable<z.ZodString>;
        inShift: z.ZodBoolean;
        amountMills: z.ZodNumber;
    }, z.core.$strip>>;
    link: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/** One person's report day: the pay base by page, the draft, the posts of it the ledger could not use. */
export declare const teamLedgerReportDaySchema: z.ZodObject<{
    key: z.ZodString;
    person: z.ZodObject<{
        slug: z.ZodNullable<z.ZodString>;
        hubUser: z.ZodNullable<z.ZodObject<{
            userId: z.ZodNumber;
            username: z.ZodString;
        }, z.core.$strip>>;
        name: z.ZodString;
    }, z.core.$strip>;
    reportDate: z.ZodString;
    pages: z.ZodArray<z.ZodObject<{
        pageLabel: z.ZodString;
        model: z.ZodString;
        postedMills: z.ZodNullable<z.ZodNumber>;
        draftMills: z.ZodNullable<z.ZodNumber>;
        diffMills: z.ZodNullable<z.ZodNumber>;
        state: z.ZodString;
        postedAt: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    postedMills: z.ZodNullable<z.ZodNumber>;
    draftMills: z.ZodNullable<z.ZodNumber>;
    postedAt: z.ZodNullable<z.ZodString>;
    draft: z.ZodNullable<z.ZodObject<{
        id: z.ZodNumber;
        reportDate: z.ZodString;
        windowFrom: z.ZodString;
        windowTo: z.ZodString;
        cutAt: z.ZodString;
        version: z.ZodNumber;
        versions: z.ZodNumber;
        status: z.ZodString;
        totalMills: z.ZodNumber;
        savedAt: z.ZodString;
        pages: z.ZodArray<z.ZodObject<{
            pageLabel: z.ZodString;
            amountMills: z.ZodNumber;
        }, z.core.$strip>>;
        lines: z.ZodArray<z.ZodObject<{
            n: z.ZodNullable<z.ZodNumber>;
            pageLabel: z.ZodString;
            fanRef: z.ZodString;
            fanName: z.ZodString;
            kind: z.ZodString;
            occurredAt: z.ZodNullable<z.ZodString>;
            netMills: z.ZodNumber;
            counted: z.ZodBoolean;
            added: z.ZodBoolean;
            what: z.ZodString;
            flags: z.ZodArray<z.ZodString>;
            notes: z.ZodArray<z.ZodString>;
            ppvAuthor: z.ZodString;
            ppvSentAt: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    postIds: z.ZodArray<z.ZodNumber>;
}, z.core.$strip>;
export declare const teamLedgerReportsResponseSchema: z.ZodObject<{
    from: z.ZodString;
    to: z.ZodString;
    reports: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        person: z.ZodObject<{
            slug: z.ZodNullable<z.ZodString>;
            hubUser: z.ZodNullable<z.ZodObject<{
                userId: z.ZodNumber;
                username: z.ZodString;
            }, z.core.$strip>>;
            name: z.ZodString;
        }, z.core.$strip>;
        reportDate: z.ZodString;
        pages: z.ZodArray<z.ZodObject<{
            pageLabel: z.ZodString;
            model: z.ZodString;
            postedMills: z.ZodNullable<z.ZodNumber>;
            draftMills: z.ZodNullable<z.ZodNumber>;
            diffMills: z.ZodNullable<z.ZodNumber>;
            state: z.ZodString;
            postedAt: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        postedMills: z.ZodNullable<z.ZodNumber>;
        draftMills: z.ZodNullable<z.ZodNumber>;
        postedAt: z.ZodNullable<z.ZodString>;
        draft: z.ZodNullable<z.ZodObject<{
            id: z.ZodNumber;
            reportDate: z.ZodString;
            windowFrom: z.ZodString;
            windowTo: z.ZodString;
            cutAt: z.ZodString;
            version: z.ZodNumber;
            versions: z.ZodNumber;
            status: z.ZodString;
            totalMills: z.ZodNumber;
            savedAt: z.ZodString;
            pages: z.ZodArray<z.ZodObject<{
                pageLabel: z.ZodString;
                amountMills: z.ZodNumber;
            }, z.core.$strip>>;
            lines: z.ZodArray<z.ZodObject<{
                n: z.ZodNullable<z.ZodNumber>;
                pageLabel: z.ZodString;
                fanRef: z.ZodString;
                fanName: z.ZodString;
                kind: z.ZodString;
                occurredAt: z.ZodNullable<z.ZodString>;
                netMills: z.ZodNumber;
                counted: z.ZodBoolean;
                added: z.ZodBoolean;
                what: z.ZodString;
                flags: z.ZodArray<z.ZodString>;
                notes: z.ZodArray<z.ZodString>;
                ppvAuthor: z.ZodString;
                ppvSentAt: z.ZodString;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        postIds: z.ZodArray<z.ZodNumber>;
    }, z.core.$strip>>;
    posts: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        postedAt: z.ZodString;
        sender: z.ZodString;
        tag: z.ZodString;
        person: z.ZodObject<{
            slug: z.ZodNullable<z.ZodString>;
            hubUser: z.ZodNullable<z.ZodObject<{
                userId: z.ZodNumber;
                username: z.ZodString;
            }, z.core.$strip>>;
            name: z.ZodString;
        }, z.core.$strip>;
        model: z.ZodString;
        reportDate: z.ZodNullable<z.ZodString>;
        totalMills: z.ZodNumber;
        pagesMills: z.ZodNumber;
        flags: z.ZodArray<z.ZodString>;
        blocking: z.ZodBoolean;
        pages: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            pageLabel: z.ZodNullable<z.ZodString>;
            inShift: z.ZodBoolean;
            amountMills: z.ZodNumber;
        }, z.core.$strip>>;
        link: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    postsRead: z.ZodBoolean;
    serverNow: z.ZodString;
}, z.core.$strip>;
/**
 * The open questions «whose is this sale» (Workboard «Решения → Чья продажа», the owner's): when the team's chat agent
 * cannot tell whose a sale is (a custom two chatters worked on, a subscription one arranged and another closed), it asks
 * in the chat and the agency ledger keeps the question until the decision is recorded. Read from the ledger's
 * GET /v1/questions?open=1 with Hub's payouts key; Hub only reads — the owner answers the agent in the chat.
 */
export declare const teamLedgerQuestionSchema: z.ZodObject<{
    id: z.ZodNumber;
    pageLabel: z.ZodString;
    fanRef: z.ZodNullable<z.ZodString>;
    fanName: z.ZodNullable<z.ZodString>;
    transactionRef: z.ZodNullable<z.ZodString>;
    netMills: z.ZodNullable<z.ZodNumber>;
    occurredAt: z.ZodNullable<z.ZodString>;
    question: z.ZodString;
    who: z.ZodString;
    askedAt: z.ZodString;
    sourceLink: z.ZodNullable<z.ZodString>;
    note: z.ZodString;
}, z.core.$strip>;
export declare const teamLedgerQuestionsResponseSchema: z.ZodObject<{
    owner: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        pageLabel: z.ZodString;
        fanRef: z.ZodNullable<z.ZodString>;
        fanName: z.ZodNullable<z.ZodString>;
        transactionRef: z.ZodNullable<z.ZodString>;
        netMills: z.ZodNullable<z.ZodNumber>;
        occurredAt: z.ZodNullable<z.ZodString>;
        question: z.ZodString;
        who: z.ZodString;
        askedAt: z.ZodString;
        sourceLink: z.ZodNullable<z.ZodString>;
        note: z.ZodString;
    }, z.core.$strip>>;
    chatters: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        pageLabel: z.ZodString;
        fanRef: z.ZodNullable<z.ZodString>;
        fanName: z.ZodNullable<z.ZodString>;
        transactionRef: z.ZodNullable<z.ZodString>;
        netMills: z.ZodNullable<z.ZodNumber>;
        occurredAt: z.ZodNullable<z.ZodString>;
        question: z.ZodString;
        who: z.ZodString;
        askedAt: z.ZodString;
        sourceLink: z.ZodNullable<z.ZodString>;
        note: z.ZodString;
    }, z.core.$strip>>;
    questionsRead: z.ZodBoolean;
    serverNow: z.ZodString;
}, z.core.$strip>;
export type TeamLedgerPayoutsResponse = z.infer<typeof teamLedgerPayoutsResponseSchema>;
export type TeamLedgerPayoutPrepareResponse = z.infer<typeof teamLedgerPayoutPrepareResponseSchema>;
export type TeamLedgerPayoutPerson = z.infer<typeof teamLedgerPayoutPersonSchema>;
export type TeamLedgerPayoutPersonResponse = z.infer<typeof teamLedgerPayoutPersonResponseSchema>;
export type LedgerDayState = z.infer<typeof ledgerDayStateEnum>;
export type TeamLedgerReportsQuery = z.infer<typeof teamLedgerReportsQuerySchema>;
export type TeamLedgerReportsResponse = z.infer<typeof teamLedgerReportsResponseSchema>;
export type TeamLedgerReportDay = z.infer<typeof teamLedgerReportDaySchema>;
export type TeamLedgerReportPage = z.infer<typeof teamLedgerReportPageSchema>;
export type TeamLedgerReportPost = z.infer<typeof teamLedgerReportPostSchema>;
export type TeamLedgerReportPerson = z.infer<typeof teamLedgerReportPersonSchema>;
export type TeamLedgerQuestion = z.infer<typeof teamLedgerQuestionSchema>;
export type TeamLedgerQuestionsResponse = z.infer<typeof teamLedgerQuestionsResponseSchema>;
export declare const teamLedgerRouteSchemas: {
    readonly teamLedgerPayouts: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "The chatters' pay as the agency ledger counts it: accrued, paid, owed now";
        readonly description: string;
        readonly querystring: z.ZodObject<{
            from: z.ZodString;
            to: z.ZodString;
        }, z.core.$strip>;
        readonly response: {
            readonly 200: z.ZodObject<{
                from: z.ZodString;
                to: z.ZodString;
                accrualFrom: z.ZodString;
                factsFrom: z.ZodNullable<z.ZodString>;
                reportsFrom: z.ZodNullable<z.ZodString>;
                generatedAt: z.ZodString;
                people: z.ZodArray<z.ZodObject<{
                    slug: z.ZodString;
                    name: z.ZodString;
                    aliases: z.ZodArray<z.ZodString>;
                    status: z.ZodString;
                    hubUser: z.ZodNullable<z.ZodObject<{
                        userId: z.ZodNumber;
                        username: z.ZodString;
                    }, z.core.$strip>>;
                    days: z.ZodArray<z.ZodObject<{
                        date: z.ZodString;
                        model: z.ZodString;
                        amountMills: z.ZodNumber;
                        worked: z.ZodBoolean;
                        source: z.ZodString;
                    }, z.core.$strip>>;
                    accruedMills: z.ZodNumber;
                    paidMills: z.ZodNumber;
                    balanceMills: z.ZodNumber;
                    toPayMills: z.ZodNullable<z.ZodNumber>;
                    oldestUnpaidDate: z.ZodNullable<z.ZodString>;
                    unpaidDays: z.ZodArray<z.ZodObject<{
                        date: z.ZodString;
                        kind: z.ZodString;
                        model: z.ZodNullable<z.ZodString>;
                        unpaidMills: z.ZodNumber;
                    }, z.core.$strip>>;
                    unentered: z.ZodObject<{
                        days: z.ZodNumber;
                        shareMills: z.ZodNumber;
                        unknown: z.ZodNumber;
                    }, z.core.$strip>;
                    pendingChanges: z.ZodArray<z.ZodObject<{
                        id: z.ZodNumber;
                        day: z.ZodString;
                        model: z.ZodString;
                        postedMills: z.ZodNumber;
                        newMills: z.ZodNumber;
                        reason: z.ZodString;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                checks: z.ZodObject<{
                    stale: z.ZodBoolean;
                    lastSheetsCollectAt: z.ZodNullable<z.ZodString>;
                    lastRebuildAt: z.ZodNullable<z.ZodString>;
                    debtsStale: z.ZodBoolean;
                    sheetsStale: z.ZodBoolean;
                }, z.core.$strip>;
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
            readonly 503: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    };
    readonly teamLedgerPayoutPrepare: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "One person's payout brief from the agency ledger: the transfer, the lines, the blockers, the message";
        readonly description: string;
        readonly querystring: z.ZodObject<{
            person: z.ZodString;
        }, z.core.$strip>;
        readonly response: {
            readonly 200: z.ZodObject<{
                slug: z.ZodString;
                name: z.ZodString;
                generatedAt: z.ZodString;
                amountMills: z.ZodNumber;
                nothing: z.ZodNullable<z.ZodString>;
                toPayMills: z.ZodNullable<z.ZodNumber>;
                period: z.ZodNullable<z.ZodObject<{
                    from: z.ZodString;
                    to: z.ZodString;
                }, z.core.$strip>>;
                lines: z.ZodArray<z.ZodObject<{
                    kind: z.ZodString;
                    model: z.ZodNullable<z.ZodString>;
                    text: z.ZodString;
                    shownMills: z.ZodNumber;
                    from: z.ZodNullable<z.ZodString>;
                    to: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
                flags: z.ZodArray<z.ZodObject<{
                    kind: z.ZodString;
                    blocker: z.ZodBoolean;
                    text: z.ZodString;
                }, z.core.$strip>>;
                blockers: z.ZodNumber;
                suggestion: z.ZodNullable<z.ZodObject<{
                    transferMills: z.ZodNumber;
                    aboveTableMills: z.ZodNumber;
                    note: z.ZodString;
                }, z.core.$strip>>;
                message: z.ZodNullable<z.ZodString>;
                placeholder: z.ZodNullable<z.ZodString>;
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
            readonly 503: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    };
    readonly teamLedgerPayoutPerson: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "One person's pay in a window from the agency ledger: days with their state, adjustments with their memo, payouts";
        readonly description: string;
        readonly querystring: z.ZodObject<{
            person: z.ZodString;
            from: z.ZodString;
            to: z.ZodString;
        }, z.core.$strip>;
        readonly response: {
            readonly 200: z.ZodObject<{
                slug: z.ZodString;
                name: z.ZodString;
                from: z.ZodString;
                to: z.ZodString;
                accrualFrom: z.ZodString;
                factsFrom: z.ZodNullable<z.ZodString>;
                reportsFrom: z.ZodNullable<z.ZodString>;
                generatedAt: z.ZodString;
                accruedMills: z.ZodNumber;
                paidMills: z.ZodNumber;
                balanceMills: z.ZodNumber;
                oldestUnpaidDate: z.ZodNullable<z.ZodString>;
                lastPayout: z.ZodNullable<z.ZodObject<{
                    date: z.ZodString;
                    document: z.ZodNumber;
                    amountMills: z.ZodNumber;
                }, z.core.$strip>>;
                days: z.ZodArray<z.ZodObject<{
                    date: z.ZodString;
                    model: z.ZodString;
                    amountMills: z.ZodNumber;
                    worked: z.ZodBoolean;
                    source: z.ZodString;
                    state: z.ZodEnum<{
                        none: "none";
                        paid: "paid";
                        to_pay: "to_pay";
                    }>;
                    paidMills: z.ZodNumber;
                    unpaidMills: z.ZodNumber;
                    paidBy: z.ZodArray<z.ZodNumber>;
                }, z.core.$strip>>;
                adjustments: z.ZodArray<z.ZodObject<{
                    date: z.ZodString;
                    amountMills: z.ZodNumber;
                    memo: z.ZodString;
                    document: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strip>>;
                payouts: z.ZodArray<z.ZodObject<{
                    date: z.ZodString;
                    document: z.ZodNumber;
                    amountMills: z.ZodNumber;
                }, z.core.$strip>>;
                checks: z.ZodObject<{
                    stale: z.ZodBoolean;
                    lastRebuildAt: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>;
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
            readonly 503: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    };
    readonly teamLedgerReports: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "Every chatter's shift reports from the agency ledger: posted and drafted by page, the drafts, the posts it could not use";
        readonly description: string;
        readonly querystring: z.ZodObject<{
            from: z.ZodString;
            to: z.ZodString;
        }, z.core.$strip>;
        readonly response: {
            readonly 200: z.ZodObject<{
                from: z.ZodString;
                to: z.ZodString;
                reports: z.ZodArray<z.ZodObject<{
                    key: z.ZodString;
                    person: z.ZodObject<{
                        slug: z.ZodNullable<z.ZodString>;
                        hubUser: z.ZodNullable<z.ZodObject<{
                            userId: z.ZodNumber;
                            username: z.ZodString;
                        }, z.core.$strip>>;
                        name: z.ZodString;
                    }, z.core.$strip>;
                    reportDate: z.ZodString;
                    pages: z.ZodArray<z.ZodObject<{
                        pageLabel: z.ZodString;
                        model: z.ZodString;
                        postedMills: z.ZodNullable<z.ZodNumber>;
                        draftMills: z.ZodNullable<z.ZodNumber>;
                        diffMills: z.ZodNullable<z.ZodNumber>;
                        state: z.ZodString;
                        postedAt: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                    postedMills: z.ZodNullable<z.ZodNumber>;
                    draftMills: z.ZodNullable<z.ZodNumber>;
                    postedAt: z.ZodNullable<z.ZodString>;
                    draft: z.ZodNullable<z.ZodObject<{
                        id: z.ZodNumber;
                        reportDate: z.ZodString;
                        windowFrom: z.ZodString;
                        windowTo: z.ZodString;
                        cutAt: z.ZodString;
                        version: z.ZodNumber;
                        versions: z.ZodNumber;
                        status: z.ZodString;
                        totalMills: z.ZodNumber;
                        savedAt: z.ZodString;
                        pages: z.ZodArray<z.ZodObject<{
                            pageLabel: z.ZodString;
                            amountMills: z.ZodNumber;
                        }, z.core.$strip>>;
                        lines: z.ZodArray<z.ZodObject<{
                            n: z.ZodNullable<z.ZodNumber>;
                            pageLabel: z.ZodString;
                            fanRef: z.ZodString;
                            fanName: z.ZodString;
                            kind: z.ZodString;
                            occurredAt: z.ZodNullable<z.ZodString>;
                            netMills: z.ZodNumber;
                            counted: z.ZodBoolean;
                            added: z.ZodBoolean;
                            what: z.ZodString;
                            flags: z.ZodArray<z.ZodString>;
                            notes: z.ZodArray<z.ZodString>;
                            ppvAuthor: z.ZodString;
                            ppvSentAt: z.ZodString;
                        }, z.core.$strip>>;
                    }, z.core.$strip>>;
                    postIds: z.ZodArray<z.ZodNumber>;
                }, z.core.$strip>>;
                posts: z.ZodArray<z.ZodObject<{
                    id: z.ZodNumber;
                    postedAt: z.ZodString;
                    sender: z.ZodString;
                    tag: z.ZodString;
                    person: z.ZodObject<{
                        slug: z.ZodNullable<z.ZodString>;
                        hubUser: z.ZodNullable<z.ZodObject<{
                            userId: z.ZodNumber;
                            username: z.ZodString;
                        }, z.core.$strip>>;
                        name: z.ZodString;
                    }, z.core.$strip>;
                    model: z.ZodString;
                    reportDate: z.ZodNullable<z.ZodString>;
                    totalMills: z.ZodNumber;
                    pagesMills: z.ZodNumber;
                    flags: z.ZodArray<z.ZodString>;
                    blocking: z.ZodBoolean;
                    pages: z.ZodArray<z.ZodObject<{
                        name: z.ZodString;
                        pageLabel: z.ZodNullable<z.ZodString>;
                        inShift: z.ZodBoolean;
                        amountMills: z.ZodNumber;
                    }, z.core.$strip>>;
                    link: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
                postsRead: z.ZodBoolean;
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
            readonly 503: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    };
    readonly teamLedgerQuestions: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "The open questions «whose is this sale» from the agency ledger, split by whom they wait for";
        readonly description: string;
        readonly response: {
            readonly 200: z.ZodObject<{
                owner: z.ZodArray<z.ZodObject<{
                    id: z.ZodNumber;
                    pageLabel: z.ZodString;
                    fanRef: z.ZodNullable<z.ZodString>;
                    fanName: z.ZodNullable<z.ZodString>;
                    transactionRef: z.ZodNullable<z.ZodString>;
                    netMills: z.ZodNullable<z.ZodNumber>;
                    occurredAt: z.ZodNullable<z.ZodString>;
                    question: z.ZodString;
                    who: z.ZodString;
                    askedAt: z.ZodString;
                    sourceLink: z.ZodNullable<z.ZodString>;
                    note: z.ZodString;
                }, z.core.$strip>>;
                chatters: z.ZodArray<z.ZodObject<{
                    id: z.ZodNumber;
                    pageLabel: z.ZodString;
                    fanRef: z.ZodNullable<z.ZodString>;
                    fanName: z.ZodNullable<z.ZodString>;
                    transactionRef: z.ZodNullable<z.ZodString>;
                    netMills: z.ZodNullable<z.ZodNumber>;
                    occurredAt: z.ZodNullable<z.ZodString>;
                    question: z.ZodString;
                    who: z.ZodString;
                    askedAt: z.ZodString;
                    sourceLink: z.ZodNullable<z.ZodString>;
                    note: z.ZodString;
                }, z.core.$strip>>;
                questionsRead: z.ZodBoolean;
                serverNow: z.ZodString;
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
            readonly 503: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    };
};
