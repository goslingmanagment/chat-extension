/**
 * What stands between a person's shifts and the report they are paid by, day by day (Workboard «Смены» and «Мои
 * смены»). A shift's money on the screens is the rule's («чья продажа»); people are paid by the day's report — the
 * breakdown the chat agent saved to the agency ledger and the post in «Отчётность». The two sums of a day differ on
 * most days for a reason that is nobody's to act on: a sale paid in a later report («долёт»). So the answer is not a
 * second sum but the named things somebody can act on, per person and report day, and nothing for a day that has none:
 *
 * - `unreported` — sales of the day's shifts no counted line of any of the person's reports pays;
 * - `byWordsMills` — what the day's report counts that is none of the person's sales by the rule;
 * - `postApartMills` — how far the post lies from the breakdown saved for it;
 * - `sumOnlyMills` — a day paid by a post written by hand (no breakdown to read): the report's sum, where it differs.
 *
 * Hub's server pairs the reports' lines with the sales (the lines name them by reference): no line, no reference and
 * nobody else's report reaches a browser. Read from the ledger with Hub's payouts key (GET only); nothing is written.
 */
import { z } from "zod";
/** The sales a note lists at most (`unreported.sales`); its `count` and `mills` are of all of them. */
export declare const SHIFT_REPORT_NOTE_SALES_MAX = 12;
/** The window of «Смены» and «Мои смены» (`teamShiftSales`, `accountChatterStats`): the same days, the same shifts. */
export declare const shiftReportNotesQuerySchema: z.ZodObject<{
    days: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    until: z.ZodOptional<z.ZodString>;
    pageLabel: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** A sale of a person's shift that none of their reports pays. Never the fan. */
export declare const shiftReportNoteSaleSchema: z.ZodObject<{
    saleId: z.ZodNumber;
    occurredAt: z.ZodString;
    pageLabel: z.ZodString;
    kind: z.ZodString;
    netMills: z.ZodNumber;
}, z.core.$strip>;
/** One person's report day with something to say. */
export declare const shiftReportNoteSchema: z.ZodObject<{
    userIds: z.ZodArray<z.ZodNumber>;
    reportDate: z.ZodString;
    unreported: z.ZodObject<{
        count: z.ZodNumber;
        mills: z.ZodNumber;
        sales: z.ZodArray<z.ZodObject<{
            saleId: z.ZodNumber;
            occurredAt: z.ZodString;
            pageLabel: z.ZodString;
            kind: z.ZodString;
            netMills: z.ZodNumber;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    byWordsMills: z.ZodNumber;
    postApartMills: z.ZodNumber;
    sumOnlyMills: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
export declare const shiftReportNotesResponseSchema: z.ZodObject<{
    from: z.ZodString;
    to: z.ZodString;
    ruleFrom: z.ZodNullable<z.ZodString>;
    notes: z.ZodArray<z.ZodObject<{
        userIds: z.ZodArray<z.ZodNumber>;
        reportDate: z.ZodString;
        unreported: z.ZodObject<{
            count: z.ZodNumber;
            mills: z.ZodNumber;
            sales: z.ZodArray<z.ZodObject<{
                saleId: z.ZodNumber;
                occurredAt: z.ZodString;
                pageLabel: z.ZodString;
                kind: z.ZodString;
                netMills: z.ZodNumber;
            }, z.core.$strip>>;
        }, z.core.$strip>;
        byWordsMills: z.ZodNumber;
        postApartMills: z.ZodNumber;
        sumOnlyMills: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export type ShiftReportNotesQuery = z.infer<typeof shiftReportNotesQuerySchema>;
export type ShiftReportNote = z.infer<typeof shiftReportNoteSchema>;
export type ShiftReportNoteSale = z.infer<typeof shiftReportNoteSaleSchema>;
export type ShiftReportNotesResponse = z.infer<typeof shiftReportNotesResponseSchema>;
export declare const shiftReportNoteRouteSchemas: {
    readonly shiftReportNotes: {
        readonly auth: {
            readonly kind: "any-session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "Per person and report day, what stands between the shifts' sales by the rule and the report: sales in no report, sums by word, a post changed by hand";
        readonly description: string;
        readonly querystring: z.ZodObject<{
            days: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
            until: z.ZodOptional<z.ZodString>;
            pageLabel: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
        readonly response: {
            readonly 200: z.ZodObject<{
                from: z.ZodString;
                to: z.ZodString;
                ruleFrom: z.ZodNullable<z.ZodString>;
                notes: z.ZodArray<z.ZodObject<{
                    userIds: z.ZodArray<z.ZodNumber>;
                    reportDate: z.ZodString;
                    unreported: z.ZodObject<{
                        count: z.ZodNumber;
                        mills: z.ZodNumber;
                        sales: z.ZodArray<z.ZodObject<{
                            saleId: z.ZodNumber;
                            occurredAt: z.ZodString;
                            pageLabel: z.ZodString;
                            kind: z.ZodString;
                            netMills: z.ZodNumber;
                        }, z.core.$strip>>;
                    }, z.core.$strip>;
                    byWordsMills: z.ZodNumber;
                    postApartMills: z.ZodNumber;
                    sumOnlyMills: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strip>>;
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
};
