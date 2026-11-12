/**
 * Цепочка продажи (ecosystem plan 2026-11-12, package T): from one sale, where its money is — «Продажа → Чья → Смена →
 * Отчёт → Начисление → Выплата», each link with a state, words and the screen that opens it. One read for every place
 * a sale stands (the shift screen's line, the owner's dispute, the console's «Операции» and the fan's operations) and
 * for agents. Read only: nothing here changes the rule, a home, a report or the ledger, and no number is computed
 * anew — the home is `sale_homes`, the report Hub's handed-in version or the ledger's post of that day, the accrual and
 * the payout the ledger's day of that person.
 *
 * Who reads what: the owner everything, pay included; a chatter a sale of their own shifts, reports or claims on a
 * page they may open — the home, their own report, their accrual and payout as states, their own sums only with their
 * switch «видит свои деньги»; a team lead a sale of their pages — whose it is, the shift and the report, never another
 * person's accrual or payout, not even as a state; an agent key (read:team + read:money) a sale of its pages, no pay sums. Another sale is not found. A link whose source did not answer says «неизвестно»
 * and why, never a guess.
 */
import { z } from "zod";
/** A sale by Hub's id, or by its page and the platform's transaction id (the console's rows name it so). */
export declare const saleChainQuerySchema: z.ZodObject<{
    saleId: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    pageLabel: z.ZodOptional<z.ZodString>;
    transactionRef: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/**
 * A link's state, for its mark: `done` — in place (handed in, accrued, paid); `wait` — not yet (to hand in, to pay);
 * `open` — a dispute or a claim waits; `none` — not applicable (a pot's sale has no shift); `unknown` — its source did
 * not answer (the words say why): never read as «paid».
 */
export declare const SALE_CHAIN_STATES: readonly ["done", "wait", "open", "none", "unknown"];
export declare const saleChainLinkSchema: z.ZodObject<{
    state: z.ZodEnum<{
        unknown: "unknown";
        none: "none";
        open: "open";
        done: "done";
        wait: "wait";
    }>;
    words: z.ZodString;
    link: z.ZodNullable<z.ZodString>;
    amountMills: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
export declare const saleChainResponseSchema: z.ZodObject<{
    sale: z.ZodObject<{
        transactionId: z.ZodNumber;
        pageLabel: z.ZodString;
        platform: z.ZodString;
        kind: z.ZodString;
        occurredAt: z.ZodString;
        netMills: z.ZodNumber;
        fan: z.ZodObject<{
            fanRef: z.ZodNullable<z.ZodString>;
            name: z.ZodNullable<z.ZodString>;
            username: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
    }, z.core.$strip>;
    home: z.ZodObject<{
        state: z.ZodEnum<{
            unknown: "unknown";
            none: "none";
            open: "open";
            done: "done";
            wait: "wait";
        }>;
        words: z.ZodString;
        link: z.ZodNullable<z.ZodString>;
        amountMills: z.ZodNullable<z.ZodNumber>;
        kind: z.ZodNullable<z.ZodString>;
        reason: z.ZodNullable<z.ZodString>;
        above: z.ZodNullable<z.ZodString>;
        dispute: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
    people: z.ZodArray<z.ZodObject<{
        userId: z.ZodNumber;
        name: z.ZodString;
        shareMills: z.ZodNullable<z.ZodNumber>;
        reportDate: z.ZodString;
        shift: z.ZodObject<{
            state: z.ZodEnum<{
                unknown: "unknown";
                none: "none";
                open: "open";
                done: "done";
                wait: "wait";
            }>;
            words: z.ZodString;
            link: z.ZodNullable<z.ZodString>;
            amountMills: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        report: z.ZodObject<{
            state: z.ZodEnum<{
                unknown: "unknown";
                none: "none";
                open: "open";
                done: "done";
                wait: "wait";
            }>;
            words: z.ZodString;
            link: z.ZodNullable<z.ZodString>;
            amountMills: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        accrual: z.ZodObject<{
            state: z.ZodEnum<{
                unknown: "unknown";
                none: "none";
                open: "open";
                done: "done";
                wait: "wait";
            }>;
            words: z.ZodString;
            link: z.ZodNullable<z.ZodString>;
            amountMills: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        payout: z.ZodObject<{
            state: z.ZodEnum<{
                unknown: "unknown";
                none: "none";
                open: "open";
                done: "done";
                wait: "wait";
            }>;
            words: z.ZodString;
            link: z.ZodNullable<z.ZodString>;
            amountMills: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
    }, z.core.$strip>>;
    note: z.ZodNullable<z.ZodString>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const agentSaleChainQuerySchema: z.ZodObject<{
    saleRef: z.ZodOptional<z.ZodString>;
    pageLabel: z.ZodOptional<z.ZodString>;
    transactionRef: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type SaleChainQuery = z.infer<typeof saleChainQuerySchema>;
export type SaleChainLink = z.infer<typeof saleChainLinkSchema>;
export type SaleChainResponse = z.infer<typeof saleChainResponseSchema>;
export declare const saleChainRouteSchemas: {
    readonly saleChain: {
        readonly auth: {
            readonly kind: "any";
        };
        readonly tags: readonly ["client"];
        readonly summary: "From one sale, its chain of money: whose it is, the shift, the report, the accrual, the payout";
        readonly description: string;
        readonly querystring: z.ZodObject<{
            saleId: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
            pageLabel: z.ZodOptional<z.ZodString>;
            transactionRef: z.ZodOptional<z.ZodString>;
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
            readonly 200: z.ZodObject<{
                sale: z.ZodObject<{
                    transactionId: z.ZodNumber;
                    pageLabel: z.ZodString;
                    platform: z.ZodString;
                    kind: z.ZodString;
                    occurredAt: z.ZodString;
                    netMills: z.ZodNumber;
                    fan: z.ZodObject<{
                        fanRef: z.ZodNullable<z.ZodString>;
                        name: z.ZodNullable<z.ZodString>;
                        username: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>;
                }, z.core.$strip>;
                home: z.ZodObject<{
                    state: z.ZodEnum<{
                        unknown: "unknown";
                        none: "none";
                        open: "open";
                        done: "done";
                        wait: "wait";
                    }>;
                    words: z.ZodString;
                    link: z.ZodNullable<z.ZodString>;
                    amountMills: z.ZodNullable<z.ZodNumber>;
                    kind: z.ZodNullable<z.ZodString>;
                    reason: z.ZodNullable<z.ZodString>;
                    above: z.ZodNullable<z.ZodString>;
                    dispute: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>;
                people: z.ZodArray<z.ZodObject<{
                    userId: z.ZodNumber;
                    name: z.ZodString;
                    shareMills: z.ZodNullable<z.ZodNumber>;
                    reportDate: z.ZodString;
                    shift: z.ZodObject<{
                        state: z.ZodEnum<{
                            unknown: "unknown";
                            none: "none";
                            open: "open";
                            done: "done";
                            wait: "wait";
                        }>;
                        words: z.ZodString;
                        link: z.ZodNullable<z.ZodString>;
                        amountMills: z.ZodNullable<z.ZodNumber>;
                    }, z.core.$strip>;
                    report: z.ZodObject<{
                        state: z.ZodEnum<{
                            unknown: "unknown";
                            none: "none";
                            open: "open";
                            done: "done";
                            wait: "wait";
                        }>;
                        words: z.ZodString;
                        link: z.ZodNullable<z.ZodString>;
                        amountMills: z.ZodNullable<z.ZodNumber>;
                    }, z.core.$strip>;
                    accrual: z.ZodObject<{
                        state: z.ZodEnum<{
                            unknown: "unknown";
                            none: "none";
                            open: "open";
                            done: "done";
                            wait: "wait";
                        }>;
                        words: z.ZodString;
                        link: z.ZodNullable<z.ZodString>;
                        amountMills: z.ZodNullable<z.ZodNumber>;
                    }, z.core.$strip>;
                    payout: z.ZodObject<{
                        state: z.ZodEnum<{
                            unknown: "unknown";
                            none: "none";
                            open: "open";
                            done: "done";
                            wait: "wait";
                        }>;
                        words: z.ZodString;
                        link: z.ZodNullable<z.ZodString>;
                        amountMills: z.ZodNullable<z.ZodNumber>;
                    }, z.core.$strip>;
                }, z.core.$strip>>;
                note: z.ZodNullable<z.ZodString>;
                serverNow: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly agentSaleChain: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "A sale's chain of money for an agent: whose, the shift, the report, accrual and payout states, no pay sums (needs read:team and read:money)";
        readonly description: "A sale of the key's pages, else 404. No pay sum is served: the ledger is the agents' door for pay.";
        readonly querystring: z.ZodObject<{
            saleRef: z.ZodOptional<z.ZodString>;
            pageLabel: z.ZodOptional<z.ZodString>;
            transactionRef: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
        readonly response: {
            readonly 503: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
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
            readonly 200: z.ZodObject<{
                sale: z.ZodObject<{
                    transactionId: z.ZodNumber;
                    pageLabel: z.ZodString;
                    platform: z.ZodString;
                    kind: z.ZodString;
                    occurredAt: z.ZodString;
                    netMills: z.ZodNumber;
                    fan: z.ZodObject<{
                        fanRef: z.ZodNullable<z.ZodString>;
                        name: z.ZodNullable<z.ZodString>;
                        username: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>;
                }, z.core.$strip>;
                home: z.ZodObject<{
                    state: z.ZodEnum<{
                        unknown: "unknown";
                        none: "none";
                        open: "open";
                        done: "done";
                        wait: "wait";
                    }>;
                    words: z.ZodString;
                    link: z.ZodNullable<z.ZodString>;
                    amountMills: z.ZodNullable<z.ZodNumber>;
                    kind: z.ZodNullable<z.ZodString>;
                    reason: z.ZodNullable<z.ZodString>;
                    above: z.ZodNullable<z.ZodString>;
                    dispute: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>;
                people: z.ZodArray<z.ZodObject<{
                    userId: z.ZodNumber;
                    name: z.ZodString;
                    shareMills: z.ZodNullable<z.ZodNumber>;
                    reportDate: z.ZodString;
                    shift: z.ZodObject<{
                        state: z.ZodEnum<{
                            unknown: "unknown";
                            none: "none";
                            open: "open";
                            done: "done";
                            wait: "wait";
                        }>;
                        words: z.ZodString;
                        link: z.ZodNullable<z.ZodString>;
                        amountMills: z.ZodNullable<z.ZodNumber>;
                    }, z.core.$strip>;
                    report: z.ZodObject<{
                        state: z.ZodEnum<{
                            unknown: "unknown";
                            none: "none";
                            open: "open";
                            done: "done";
                            wait: "wait";
                        }>;
                        words: z.ZodString;
                        link: z.ZodNullable<z.ZodString>;
                        amountMills: z.ZodNullable<z.ZodNumber>;
                    }, z.core.$strip>;
                    accrual: z.ZodObject<{
                        state: z.ZodEnum<{
                            unknown: "unknown";
                            none: "none";
                            open: "open";
                            done: "done";
                            wait: "wait";
                        }>;
                        words: z.ZodString;
                        link: z.ZodNullable<z.ZodString>;
                        amountMills: z.ZodNullable<z.ZodNumber>;
                    }, z.core.$strip>;
                    payout: z.ZodObject<{
                        state: z.ZodEnum<{
                            unknown: "unknown";
                            none: "none";
                            open: "open";
                            done: "done";
                            wait: "wait";
                        }>;
                        words: z.ZodString;
                        link: z.ZodNullable<z.ZodString>;
                        amountMills: z.ZodNullable<z.ZodNumber>;
                    }, z.core.$strip>;
                }, z.core.$strip>>;
                note: z.ZodNullable<z.ZodString>;
                serverNow: z.ZodString;
            }, z.core.$strip>;
        };
    };
};
