/**
 * The chatter's own shift reports (Workboard «Мои смены», owner 2026-11-10): one
 * report per report date, as the agency ledger keeps it — the agent's draft (the
 * pages and their amounts, the sales counted and the ones held out, and why), the
 * chatter's post in «Отчётность», or both. The post is the report that counts:
 * a report's one number is what the chatter published. Hub's server reads the
 * ledger's GET /v1/reports and GET /v1/report-days for the caller only (the user
 * comes from the session, never the query) and passes them on, micro-dollars
 * turned into mills. Sales only: no rates, pay, payouts or debt reach a
 * chatter's session. 503 — the ledger is not connected or did not answer.
 */
import { z } from "zod";
/** The ledger's widest window of one read of reports. */
export declare const ACCOUNT_REPORTS_MAX_DAYS = 62;
/** The window without a query: the last 14 Moscow days, today included. */
export declare const ACCOUNT_REPORTS_DEFAULT_DAYS = 14;
export declare const accountReportsQuerySchema: z.ZodObject<{
    from: z.ZodOptional<z.ZodString>;
    to: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const accountReportLineSchema: z.ZodObject<{
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
}, z.core.$strip>;
/** The agent's draft of a shift report, as the ledger's GET /v1/reports keeps it (the owner's «Отчёты» carry it as `draft`). */
export declare const accountReportSchema: z.ZodObject<{
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
}, z.core.$strip>;
/** One page of a chatter's report: as posted, as drafted, and how they compare. */
export declare const accountShiftReportPageSchema: z.ZodObject<{
    pageLabel: z.ZodString;
    amountMills: z.ZodNumber;
    draftMills: z.ZodNullable<z.ZodNumber>;
    postedMills: z.ZodNullable<z.ZodNumber>;
    postState: z.ZodString;
}, z.core.$strip>;
/**
 * A chatter's report of one report date: the agent's draft, the chatter's post in «Отчётность», or both. The draft's
 * fields (id, window, version, the sales) are null or empty for a post written without the agent.
 */
export declare const accountShiftReportSchema: z.ZodObject<{
    reportDate: z.ZodString;
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
    source: z.ZodEnum<{
        post: "post";
        draft: "draft";
        both: "both";
    }>;
    id: z.ZodNullable<z.ZodNumber>;
    windowFrom: z.ZodNullable<z.ZodString>;
    windowTo: z.ZodNullable<z.ZodString>;
    cutAt: z.ZodNullable<z.ZodString>;
    version: z.ZodNullable<z.ZodNumber>;
    versions: z.ZodNullable<z.ZodNumber>;
    status: z.ZodString;
    totalMills: z.ZodNumber;
    draftTotalMills: z.ZodNullable<z.ZodNumber>;
    savedAt: z.ZodNullable<z.ZodString>;
    postedAt: z.ZodNullable<z.ZodString>;
    pages: z.ZodArray<z.ZodObject<{
        pageLabel: z.ZodString;
        amountMills: z.ZodNumber;
        draftMills: z.ZodNullable<z.ZodNumber>;
        postedMills: z.ZodNullable<z.ZodNumber>;
        postState: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const accountReportsResponseSchema: z.ZodObject<{
    from: z.ZodString;
    to: z.ZodString;
    reports: z.ZodArray<z.ZodObject<{
        reportDate: z.ZodString;
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
        source: z.ZodEnum<{
            post: "post";
            draft: "draft";
            both: "both";
        }>;
        id: z.ZodNullable<z.ZodNumber>;
        windowFrom: z.ZodNullable<z.ZodString>;
        windowTo: z.ZodNullable<z.ZodString>;
        cutAt: z.ZodNullable<z.ZodString>;
        version: z.ZodNullable<z.ZodNumber>;
        versions: z.ZodNullable<z.ZodNumber>;
        status: z.ZodString;
        totalMills: z.ZodNumber;
        draftTotalMills: z.ZodNullable<z.ZodNumber>;
        savedAt: z.ZodNullable<z.ZodString>;
        postedAt: z.ZodNullable<z.ZodString>;
        pages: z.ZodArray<z.ZodObject<{
            pageLabel: z.ZodString;
            amountMills: z.ZodNumber;
            draftMills: z.ZodNullable<z.ZodNumber>;
            postedMills: z.ZodNullable<z.ZodNumber>;
            postState: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    postsRead: z.ZodBoolean;
}, z.core.$strip>;
export type AccountReportsQuery = z.infer<typeof accountReportsQuerySchema>;
export type AccountReportsResponse = z.infer<typeof accountReportsResponseSchema>;
export type AccountReport = z.infer<typeof accountReportSchema>;
export type AccountShiftReport = z.infer<typeof accountShiftReportSchema>;
export type AccountShiftReportPage = z.infer<typeof accountShiftReportPageSchema>;
export type AccountReportLine = z.infer<typeof accountReportLineSchema>;
export declare const accountReportsRouteSchemas: {
    readonly accountReports: {
        readonly auth: {
            readonly kind: "any-session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "The caller's own shift reports from the agency ledger: drafted and posted pages, amounts, sales counted and held out";
        readonly description: string;
        readonly querystring: z.ZodObject<{
            from: z.ZodOptional<z.ZodString>;
            to: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
        readonly response: {
            readonly 200: z.ZodObject<{
                from: z.ZodString;
                to: z.ZodString;
                reports: z.ZodArray<z.ZodObject<{
                    reportDate: z.ZodString;
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
                    source: z.ZodEnum<{
                        post: "post";
                        draft: "draft";
                        both: "both";
                    }>;
                    id: z.ZodNullable<z.ZodNumber>;
                    windowFrom: z.ZodNullable<z.ZodString>;
                    windowTo: z.ZodNullable<z.ZodString>;
                    cutAt: z.ZodNullable<z.ZodString>;
                    version: z.ZodNullable<z.ZodNumber>;
                    versions: z.ZodNullable<z.ZodNumber>;
                    status: z.ZodString;
                    totalMills: z.ZodNumber;
                    draftTotalMills: z.ZodNullable<z.ZodNumber>;
                    savedAt: z.ZodNullable<z.ZodString>;
                    postedAt: z.ZodNullable<z.ZodString>;
                    pages: z.ZodArray<z.ZodObject<{
                        pageLabel: z.ZodString;
                        amountMills: z.ZodNumber;
                        draftMills: z.ZodNullable<z.ZodNumber>;
                        postedMills: z.ZodNullable<z.ZodNumber>;
                        postState: z.ZodString;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                postsRead: z.ZodBoolean;
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
};
