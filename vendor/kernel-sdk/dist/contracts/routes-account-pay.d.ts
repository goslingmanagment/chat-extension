/**
 * «Мои деньги» on «Мои смены» (ecosystem plan, package H1): what the agency ledger accrued to the caller in a window,
 * what it owes them now and when it last paid them, and each day's accrual with its state. Behind the person's switch
 * «видит свои деньги» (people registry right `sees_own_pay`): off — `enabled` false and nothing else, the screen as
 * before. Hub's server finds the caller's person through the registry (the session's user, never the query) and reads
 * the ledger's GET /v1/payouts/person for that person only. Sums, never terms: no rate, no fix per shift, no revenue a
 * day was priced from, nothing of anyone else. 503 — the switch is on and the ledger is not connected or did not answer.
 */
import { z } from "zod";
/** The widest window: the ledger's 62 days of one read, less the day before the window it also reads (for a night). */
export declare const ACCOUNT_PAY_MAX_DAYS = 61;
export declare const accountPayQuerySchema: z.ZodObject<{
    from: z.ZodString;
    to: z.ZodString;
}, z.core.$strip>;
export declare const accountPaySchema: z.ZodObject<{
    accruedMills: z.ZodNumber;
    paidMills: z.ZodNumber;
    balanceMills: z.ZodNumber;
    oldestUnpaidDate: z.ZodNullable<z.ZodString>;
    lastPayout: z.ZodNullable<z.ZodObject<{
        date: z.ZodString;
        amountMills: z.ZodNumber;
    }, z.core.$strip>>;
    days: z.ZodArray<z.ZodObject<{
        date: z.ZodString;
        amountMills: z.ZodNumber;
        state: z.ZodEnum<{
            none: "none";
            paid: "paid";
            to_pay: "to_pay";
        }>;
        paidMills: z.ZodNumber;
        unpaidMills: z.ZodNumber;
    }, z.core.$strip>>;
    reportsFrom: z.ZodNullable<z.ZodString>;
    stale: z.ZodBoolean;
    generatedAt: z.ZodString;
}, z.core.$strip>;
export declare const accountPayResponseSchema: z.ZodObject<{
    enabled: z.ZodBoolean;
    from: z.ZodString;
    to: z.ZodString;
    pay: z.ZodNullable<z.ZodObject<{
        accruedMills: z.ZodNumber;
        paidMills: z.ZodNumber;
        balanceMills: z.ZodNumber;
        oldestUnpaidDate: z.ZodNullable<z.ZodString>;
        lastPayout: z.ZodNullable<z.ZodObject<{
            date: z.ZodString;
            amountMills: z.ZodNumber;
        }, z.core.$strip>>;
        days: z.ZodArray<z.ZodObject<{
            date: z.ZodString;
            amountMills: z.ZodNumber;
            state: z.ZodEnum<{
                none: "none";
                paid: "paid";
                to_pay: "to_pay";
            }>;
            paidMills: z.ZodNumber;
            unpaidMills: z.ZodNumber;
        }, z.core.$strip>>;
        reportsFrom: z.ZodNullable<z.ZodString>;
        stale: z.ZodBoolean;
        generatedAt: z.ZodString;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export type AccountPayQuery = z.infer<typeof accountPayQuerySchema>;
export type AccountPay = z.infer<typeof accountPaySchema>;
export type AccountPayResponse = z.infer<typeof accountPayResponseSchema>;
export declare const accountPayRouteSchemas: {
    readonly accountPay: {
        readonly auth: {
            readonly kind: "any-session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "The caller's own pay from the agency ledger, behind the person's switch: accrued, to pay, paid, by day";
        readonly description: string;
        readonly querystring: z.ZodObject<{
            from: z.ZodString;
            to: z.ZodString;
        }, z.core.$strip>;
        readonly response: {
            readonly 200: z.ZodObject<{
                enabled: z.ZodBoolean;
                from: z.ZodString;
                to: z.ZodString;
                pay: z.ZodNullable<z.ZodObject<{
                    accruedMills: z.ZodNumber;
                    paidMills: z.ZodNumber;
                    balanceMills: z.ZodNumber;
                    oldestUnpaidDate: z.ZodNullable<z.ZodString>;
                    lastPayout: z.ZodNullable<z.ZodObject<{
                        date: z.ZodString;
                        amountMills: z.ZodNumber;
                    }, z.core.$strip>>;
                    days: z.ZodArray<z.ZodObject<{
                        date: z.ZodString;
                        amountMills: z.ZodNumber;
                        state: z.ZodEnum<{
                            none: "none";
                            paid: "paid";
                            to_pay: "to_pay";
                        }>;
                        paidMills: z.ZodNumber;
                        unpaidMills: z.ZodNumber;
                    }, z.core.$strip>>;
                    reportsFrom: z.ZodNullable<z.ZodString>;
                    stale: z.ZodBoolean;
                    generatedAt: z.ZodString;
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
