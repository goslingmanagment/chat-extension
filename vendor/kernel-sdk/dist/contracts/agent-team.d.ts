import { z } from "zod";
/**
 * The team's sale facts for the agency ledger (ledger release 2,
 * docs/plans/2026-11-09-release-2.md in the ledger repo): every piece of the
 * team's work and every sale on the key's pages in a window, with the facts the
 * ledger's split rules read — who held the page, who sent the bought PPV, a tip
 * under a post or to a Campaign, who wrote to the fan last, the chatters' marks
 * and the owner's split. Facts only: whose a sale is, and what anyone is paid,
 * is the ledger's (owner, 2026-11-08). Needs `read:team` and `read:money`.
 */
/** The longest window of one read, days. */
export declare const AGENT_TEAM_SALES_MAX_DAYS = 31;
/** Work is read this far past the window's end (up to now): a PPV bought between its sender's shifts waits for the next. */
export declare const AGENT_TEAM_SALES_WORK_AFTER_DAYS = 7;
/** And this far before its start: a shift that began the evening before holds the window's first sales. */
export declare const AGENT_TEAM_SALES_WORK_BEFORE_DAYS = 1;
export declare const agentTeamSalesBodySchema: z.ZodObject<{
    from: z.ZodISODateTime;
    to: z.ZodISODateTime;
}, z.core.$strip>;
declare const agentTeamWorkSchema: z.ZodObject<{
    ref: z.ZodString;
    userId: z.ZodNumber;
    username: z.ZodString;
    role: z.ZodEnum<{
        owner: "owner";
        team_lead: "team_lead";
        chatter: "chatter";
    }>;
    kind: z.ZodEnum<{
        shift: "shift";
        visit: "visit";
    }>;
    startedAt: z.ZodString;
    endedAt: z.ZodString;
    ongoing: z.ZodBoolean;
    workedMinutes: z.ZodNumber;
    pages: z.ZodArray<z.ZodObject<{
        pageLabel: z.ZodString;
        messages: z.ZodNumber;
        salesFrom: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
declare const agentTeamSaleSchema: z.ZodObject<{
    transactionRef: z.ZodString;
    pageLabel: z.ZodString;
    platform: z.ZodString;
    fanRef: z.ZodNullable<z.ZodString>;
    kind: z.ZodEnum<{
        subscription: "subscription";
        tip: "tip";
        post: "post";
        ppv: "ppv";
    }>;
    netMills: z.ZodNumber;
    occurredAt: z.ZodString;
    holders: z.ZodArray<z.ZodString>;
    ppvSender: z.ZodNullable<z.ZodObject<{
        userId: z.ZodNumber;
        username: z.ZodString;
        role: z.ZodEnum<{
            owner: "owner";
            team_lead: "team_lead";
            chatter: "chatter";
        }>;
    }, z.core.$strip>>;
    ppvSentAt: z.ZodNullable<z.ZodString>;
    ppvWithoutAuthor: z.ZodBoolean;
    postTip: z.ZodBoolean;
    campaign: z.ZodBoolean;
    lastWriterUserId: z.ZodNullable<z.ZodNumber>;
    writers: z.ZodArray<z.ZodObject<{
        userId: z.ZodNumber;
        username: z.ZodString;
        messages: z.ZodNumber;
    }, z.core.$strip>>;
    marks: z.ZodArray<z.ZodObject<{
        userId: z.ZodNumber;
        mark: z.ZodEnum<{
            mine: "mine";
            share: "share";
            not_mine: "not_mine";
        }>;
        shareWithUserId: z.ZodNullable<z.ZodNumber>;
        amountMills: z.ZodNullable<z.ZodNumber>;
        confirmed: z.ZodBoolean;
    }, z.core.$strip>>;
    resolution: z.ZodNullable<z.ZodArray<z.ZodObject<{
        userId: z.ZodNumber;
        percent: z.ZodNumber;
    }, z.core.$strip>>>;
    decision: z.ZodDefault<z.ZodNullable<z.ZodObject<{
        kind: z.ZodEnum<{
            split: "split";
            pot: "pot";
            nobody: "nobody";
        }>;
        pot: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export declare const agentTeamSalesResponseSchema: z.ZodObject<{
    from: z.ZodString;
    to: z.ZodString;
    workFrom: z.ZodString;
    workTo: z.ZodString;
    pages: z.ZodArray<z.ZodString>;
    works: z.ZodArray<z.ZodObject<{
        ref: z.ZodString;
        userId: z.ZodNumber;
        username: z.ZodString;
        role: z.ZodEnum<{
            owner: "owner";
            team_lead: "team_lead";
            chatter: "chatter";
        }>;
        kind: z.ZodEnum<{
            shift: "shift";
            visit: "visit";
        }>;
        startedAt: z.ZodString;
        endedAt: z.ZodString;
        ongoing: z.ZodBoolean;
        workedMinutes: z.ZodNumber;
        pages: z.ZodArray<z.ZodObject<{
            pageLabel: z.ZodString;
            messages: z.ZodNumber;
            salesFrom: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    sales: z.ZodArray<z.ZodObject<{
        transactionRef: z.ZodString;
        pageLabel: z.ZodString;
        platform: z.ZodString;
        fanRef: z.ZodNullable<z.ZodString>;
        kind: z.ZodEnum<{
            subscription: "subscription";
            tip: "tip";
            post: "post";
            ppv: "ppv";
        }>;
        netMills: z.ZodNumber;
        occurredAt: z.ZodString;
        holders: z.ZodArray<z.ZodString>;
        ppvSender: z.ZodNullable<z.ZodObject<{
            userId: z.ZodNumber;
            username: z.ZodString;
            role: z.ZodEnum<{
                owner: "owner";
                team_lead: "team_lead";
                chatter: "chatter";
            }>;
        }, z.core.$strip>>;
        ppvSentAt: z.ZodNullable<z.ZodString>;
        ppvWithoutAuthor: z.ZodBoolean;
        postTip: z.ZodBoolean;
        campaign: z.ZodBoolean;
        lastWriterUserId: z.ZodNullable<z.ZodNumber>;
        writers: z.ZodArray<z.ZodObject<{
            userId: z.ZodNumber;
            username: z.ZodString;
            messages: z.ZodNumber;
        }, z.core.$strip>>;
        marks: z.ZodArray<z.ZodObject<{
            userId: z.ZodNumber;
            mark: z.ZodEnum<{
                mine: "mine";
                share: "share";
                not_mine: "not_mine";
            }>;
            shareWithUserId: z.ZodNullable<z.ZodNumber>;
            amountMills: z.ZodNullable<z.ZodNumber>;
            confirmed: z.ZodBoolean;
        }, z.core.$strip>>;
        resolution: z.ZodNullable<z.ZodArray<z.ZodObject<{
            userId: z.ZodNumber;
            percent: z.ZodNumber;
        }, z.core.$strip>>>;
        decision: z.ZodDefault<z.ZodNullable<z.ZodObject<{
            kind: z.ZodEnum<{
                split: "split";
                pot: "pot";
                nobody: "nobody";
            }>;
            pot: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>>;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export type AgentTeamSalesBody = z.infer<typeof agentTeamSalesBodySchema>;
export type AgentTeamSalesResponse = z.infer<typeof agentTeamSalesResponseSchema>;
export type AgentTeamWork = z.infer<typeof agentTeamWorkSchema>;
export type AgentTeamSale = z.infer<typeof agentTeamSaleSchema>;
export declare const agentTeamRouteSchemas: {
    readonly agentTeamSales: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: string;
        readonly body: z.ZodObject<{
            from: z.ZodISODateTime;
            to: z.ZodISODateTime;
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
                from: z.ZodString;
                to: z.ZodString;
                workFrom: z.ZodString;
                workTo: z.ZodString;
                pages: z.ZodArray<z.ZodString>;
                works: z.ZodArray<z.ZodObject<{
                    ref: z.ZodString;
                    userId: z.ZodNumber;
                    username: z.ZodString;
                    role: z.ZodEnum<{
                        owner: "owner";
                        team_lead: "team_lead";
                        chatter: "chatter";
                    }>;
                    kind: z.ZodEnum<{
                        shift: "shift";
                        visit: "visit";
                    }>;
                    startedAt: z.ZodString;
                    endedAt: z.ZodString;
                    ongoing: z.ZodBoolean;
                    workedMinutes: z.ZodNumber;
                    pages: z.ZodArray<z.ZodObject<{
                        pageLabel: z.ZodString;
                        messages: z.ZodNumber;
                        salesFrom: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                sales: z.ZodArray<z.ZodObject<{
                    transactionRef: z.ZodString;
                    pageLabel: z.ZodString;
                    platform: z.ZodString;
                    fanRef: z.ZodNullable<z.ZodString>;
                    kind: z.ZodEnum<{
                        subscription: "subscription";
                        tip: "tip";
                        post: "post";
                        ppv: "ppv";
                    }>;
                    netMills: z.ZodNumber;
                    occurredAt: z.ZodString;
                    holders: z.ZodArray<z.ZodString>;
                    ppvSender: z.ZodNullable<z.ZodObject<{
                        userId: z.ZodNumber;
                        username: z.ZodString;
                        role: z.ZodEnum<{
                            owner: "owner";
                            team_lead: "team_lead";
                            chatter: "chatter";
                        }>;
                    }, z.core.$strip>>;
                    ppvSentAt: z.ZodNullable<z.ZodString>;
                    ppvWithoutAuthor: z.ZodBoolean;
                    postTip: z.ZodBoolean;
                    campaign: z.ZodBoolean;
                    lastWriterUserId: z.ZodNullable<z.ZodNumber>;
                    writers: z.ZodArray<z.ZodObject<{
                        userId: z.ZodNumber;
                        username: z.ZodString;
                        messages: z.ZodNumber;
                    }, z.core.$strip>>;
                    marks: z.ZodArray<z.ZodObject<{
                        userId: z.ZodNumber;
                        mark: z.ZodEnum<{
                            mine: "mine";
                            share: "share";
                            not_mine: "not_mine";
                        }>;
                        shareWithUserId: z.ZodNullable<z.ZodNumber>;
                        amountMills: z.ZodNullable<z.ZodNumber>;
                        confirmed: z.ZodBoolean;
                    }, z.core.$strip>>;
                    resolution: z.ZodNullable<z.ZodArray<z.ZodObject<{
                        userId: z.ZodNumber;
                        percent: z.ZodNumber;
                    }, z.core.$strip>>>;
                    decision: z.ZodDefault<z.ZodNullable<z.ZodObject<{
                        kind: z.ZodEnum<{
                            split: "split";
                            pot: "pot";
                            nobody: "nobody";
                        }>;
                        pot: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>>;
                }, z.core.$strip>>;
                serverNow: z.ZodString;
            }, z.core.$strip>;
        };
    };
};
export {};
