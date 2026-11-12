/**
 * «Чья продажа»: one home and one writer (review R2b-3). What the team's chat agent records «со слов» — a decision about a
 * sale (the owner's ruling or the chatters' agreement) and a question about one — is written in Hub through these doors,
 * no longer in the ledger: Hub's `sale_owner_decisions` and `sale_claims` (kind question), the same rows the owner's
 * dispute and the imported records use. A decision on a sale Hub knows behaves exactly like the owner's decision of a
 * dispute: the home computed again, every handed-in report holding the sale given a new version with what it gives,
 * the open claims and questions of the sale decided with it, their matters closed. Each write needs write:shift_reports
 * and names the message and its sender; reads take write:shift_reports or read:team. The lists render as the agent's
 * memory file has them (`format=md`), the shape `ledger decision list --md` and `ledger question list --md` gave.
 */
import { z } from "zod";
/** The ledger's words of a decision's kind: whole to one, shares, a pot, money outside the platform, nobody's. */
export declare const SALE_DECISION_KINDS: readonly ["owner", "split", "pot", "off_platform", "exclude"];
export declare const agentSaleDecisionBodySchema: z.ZodObject<{
    telegramUserId: z.ZodNumber;
    sourceRef: z.ZodString;
    kind: z.ZodEnum<{
        owner: "owner";
        split: "split";
        pot: "pot";
        exclude: "exclude";
        off_platform: "off_platform";
    }>;
    shares: z.ZodDefault<z.ZodArray<z.ZodObject<{
        person: z.ZodString;
        percent: z.ZodNumber;
    }, z.core.$strip>>>;
    pot: z.ZodOptional<z.ZodString>;
    saidBy: z.ZodString;
    saidAt: z.ZodString;
    note: z.ZodOptional<z.ZodString>;
    supersedes: z.ZodOptional<z.ZodNumber>;
    answers: z.ZodOptional<z.ZodNumber>;
    transactionId: z.ZodOptional<z.ZodNumber>;
    pageLabel: z.ZodOptional<z.ZodString>;
    transactionRef: z.ZodOptional<z.ZodString>;
    fanRef: z.ZodOptional<z.ZodString>;
    occurredAt: z.ZodOptional<z.ZodString>;
    netMills: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const agentSaleDecisionCancelBodySchema: z.ZodObject<{
    telegramUserId: z.ZodNumber;
    sourceRef: z.ZodString;
    decisionId: z.ZodNumber;
    note: z.ZodString;
}, z.core.$strip>;
export declare const agentSaleDecisionAppliedBodySchema: z.ZodObject<{
    decisionId: z.ZodNumber;
    person: z.ZodString;
    reportDate: z.ZodString;
}, z.core.$strip>;
export declare const agentSaleDecisionsQuerySchema: z.ZodObject<{
    open: z.ZodPipe<z.ZodDefault<z.ZodEnum<{
        true: "true";
        false: "false";
    }>>, z.ZodTransform<boolean, "true" | "false">>;
    since: z.ZodOptional<z.ZodString>;
    format: z.ZodDefault<z.ZodEnum<{
        json: "json";
        md: "md";
    }>>;
}, z.core.$strip>;
export declare const agentSaleDecisionSchema: z.ZodObject<{
    id: z.ZodNumber;
    transactionId: z.ZodNullable<z.ZodNumber>;
    pageLabel: z.ZodNullable<z.ZodString>;
    fan: z.ZodObject<{
        fanRef: z.ZodNullable<z.ZodString>;
        name: z.ZodNullable<z.ZodString>;
        username: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
    netMills: z.ZodNullable<z.ZodNumber>;
    occurredAt: z.ZodNullable<z.ZodString>;
    kind: z.ZodEnum<{
        owner: "owner";
        split: "split";
        pot: "pot";
        exclude: "exclude";
        off_platform: "off_platform";
    }>;
    shares: z.ZodArray<z.ZodObject<{
        person: z.ZodNullable<z.ZodString>;
        name: z.ZodString;
        percent: z.ZodNumber;
    }, z.core.$strip>>;
    pot: z.ZodNullable<z.ZodString>;
    saidBy: z.ZodNullable<z.ZodString>;
    saidAt: z.ZodNullable<z.ZodString>;
    sourceLink: z.ZodNullable<z.ZodString>;
    note: z.ZodNullable<z.ZodString>;
    source: z.ZodEnum<{
        agent: "agent";
        ledger: "ledger";
        dispute: "dispute";
    }>;
    status: z.ZodEnum<{
        cancelled: "cancelled";
        applied: "applied";
        open: "open";
        superseded: "superseded";
        held: "held";
    }>;
    statusWords: z.ZodString;
    supersededBy: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
export declare const agentSaleDecisionsResponseSchema: z.ZodObject<{
    decisions: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        transactionId: z.ZodNullable<z.ZodNumber>;
        pageLabel: z.ZodNullable<z.ZodString>;
        fan: z.ZodObject<{
            fanRef: z.ZodNullable<z.ZodString>;
            name: z.ZodNullable<z.ZodString>;
            username: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
        netMills: z.ZodNullable<z.ZodNumber>;
        occurredAt: z.ZodNullable<z.ZodString>;
        kind: z.ZodEnum<{
            owner: "owner";
            split: "split";
            pot: "pot";
            exclude: "exclude";
            off_platform: "off_platform";
        }>;
        shares: z.ZodArray<z.ZodObject<{
            person: z.ZodNullable<z.ZodString>;
            name: z.ZodString;
            percent: z.ZodNumber;
        }, z.core.$strip>>;
        pot: z.ZodNullable<z.ZodString>;
        saidBy: z.ZodNullable<z.ZodString>;
        saidAt: z.ZodNullable<z.ZodString>;
        sourceLink: z.ZodNullable<z.ZodString>;
        note: z.ZodNullable<z.ZodString>;
        source: z.ZodEnum<{
            agent: "agent";
            ledger: "ledger";
            dispute: "dispute";
        }>;
        status: z.ZodEnum<{
            cancelled: "cancelled";
            applied: "applied";
            open: "open";
            superseded: "superseded";
            held: "held";
        }>;
        statusWords: z.ZodString;
        supersededBy: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
    markdown: z.ZodNullable<z.ZodString>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const agentSaleDecisionWriteResponseSchema: z.ZodObject<{
    decision: z.ZodObject<{
        id: z.ZodNumber;
        transactionId: z.ZodNullable<z.ZodNumber>;
        pageLabel: z.ZodNullable<z.ZodString>;
        fan: z.ZodObject<{
            fanRef: z.ZodNullable<z.ZodString>;
            name: z.ZodNullable<z.ZodString>;
            username: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
        netMills: z.ZodNullable<z.ZodNumber>;
        occurredAt: z.ZodNullable<z.ZodString>;
        kind: z.ZodEnum<{
            owner: "owner";
            split: "split";
            pot: "pot";
            exclude: "exclude";
            off_platform: "off_platform";
        }>;
        shares: z.ZodArray<z.ZodObject<{
            person: z.ZodNullable<z.ZodString>;
            name: z.ZodString;
            percent: z.ZodNumber;
        }, z.core.$strip>>;
        pot: z.ZodNullable<z.ZodString>;
        saidBy: z.ZodNullable<z.ZodString>;
        saidAt: z.ZodNullable<z.ZodString>;
        sourceLink: z.ZodNullable<z.ZodString>;
        note: z.ZodNullable<z.ZodString>;
        source: z.ZodEnum<{
            agent: "agent";
            ledger: "ledger";
            dispute: "dispute";
        }>;
        status: z.ZodEnum<{
            cancelled: "cancelled";
            applied: "applied";
            open: "open";
            superseded: "superseded";
            held: "held";
        }>;
        statusWords: z.ZodString;
        supersededBy: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>;
    versions: z.ZodArray<z.ZodObject<{
        shiftId: z.ZodNumber;
        version: z.ZodNumber;
    }, z.core.$strip>>;
    savedAt: z.ZodString;
}, z.core.$strip>;
export declare const agentSaleQuestionBodySchema: z.ZodObject<{
    telegramUserId: z.ZodNumber;
    sourceRef: z.ZodString;
    askedOf: z.ZodEnum<{
        owner: "owner";
        chatters: "chatters";
    }>;
    who: z.ZodOptional<z.ZodString>;
    people: z.ZodDefault<z.ZodArray<z.ZodString>>;
    question: z.ZodString;
    note: z.ZodOptional<z.ZodString>;
    askedAt: z.ZodString;
    transactionId: z.ZodOptional<z.ZodNumber>;
    pageLabel: z.ZodOptional<z.ZodString>;
    transactionRef: z.ZodOptional<z.ZodString>;
    fanRef: z.ZodOptional<z.ZodString>;
    occurredAt: z.ZodOptional<z.ZodString>;
    netMills: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const agentSaleQuestionAnswerBodySchema: z.ZodObject<{
    telegramUserId: z.ZodNumber;
    sourceRef: z.ZodString;
    questionId: z.ZodNumber;
    answer: z.ZodString;
}, z.core.$strip>;
export declare const agentSaleQuestionCloseBodySchema: z.ZodObject<{
    telegramUserId: z.ZodNumber;
    sourceRef: z.ZodString;
    questionId: z.ZodNumber;
    note: z.ZodString;
}, z.core.$strip>;
export declare const agentSaleQuestionsQuerySchema: z.ZodObject<{
    open: z.ZodPipe<z.ZodDefault<z.ZodEnum<{
        true: "true";
        false: "false";
    }>>, z.ZodTransform<boolean, "true" | "false">>;
    format: z.ZodDefault<z.ZodEnum<{
        json: "json";
        md: "md";
    }>>;
}, z.core.$strip>;
export declare const agentSaleQuestionSchema: z.ZodObject<{
    id: z.ZodNumber;
    transactionId: z.ZodNullable<z.ZodNumber>;
    pageLabel: z.ZodNullable<z.ZodString>;
    fan: z.ZodObject<{
        fanRef: z.ZodNullable<z.ZodString>;
        name: z.ZodNullable<z.ZodString>;
        username: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
    netMills: z.ZodNullable<z.ZodNumber>;
    askedOf: z.ZodEnum<{
        owner: "owner";
        chatters: "chatters";
    }>;
    who: z.ZodNullable<z.ZodString>;
    question: z.ZodString;
    askedAt: z.ZodString;
    sourceLink: z.ZodNullable<z.ZodString>;
    status: z.ZodEnum<{
        open: "open";
        closed: "closed";
        answered: "answered";
        decided: "decided";
    }>;
    decisionId: z.ZodNullable<z.ZodNumber>;
    answer: z.ZodNullable<z.ZodString>;
    ledgerQuestionId: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
export declare const agentSaleQuestionsResponseSchema: z.ZodObject<{
    questions: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        transactionId: z.ZodNullable<z.ZodNumber>;
        pageLabel: z.ZodNullable<z.ZodString>;
        fan: z.ZodObject<{
            fanRef: z.ZodNullable<z.ZodString>;
            name: z.ZodNullable<z.ZodString>;
            username: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
        netMills: z.ZodNullable<z.ZodNumber>;
        askedOf: z.ZodEnum<{
            owner: "owner";
            chatters: "chatters";
        }>;
        who: z.ZodNullable<z.ZodString>;
        question: z.ZodString;
        askedAt: z.ZodString;
        sourceLink: z.ZodNullable<z.ZodString>;
        status: z.ZodEnum<{
            open: "open";
            closed: "closed";
            answered: "answered";
            decided: "decided";
        }>;
        decisionId: z.ZodNullable<z.ZodNumber>;
        answer: z.ZodNullable<z.ZodString>;
        ledgerQuestionId: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
    markdown: z.ZodNullable<z.ZodString>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const agentSaleQuestionWriteResponseSchema: z.ZodObject<{
    question: z.ZodObject<{
        id: z.ZodNumber;
        transactionId: z.ZodNullable<z.ZodNumber>;
        pageLabel: z.ZodNullable<z.ZodString>;
        fan: z.ZodObject<{
            fanRef: z.ZodNullable<z.ZodString>;
            name: z.ZodNullable<z.ZodString>;
            username: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
        netMills: z.ZodNullable<z.ZodNumber>;
        askedOf: z.ZodEnum<{
            owner: "owner";
            chatters: "chatters";
        }>;
        who: z.ZodNullable<z.ZodString>;
        question: z.ZodString;
        askedAt: z.ZodString;
        sourceLink: z.ZodNullable<z.ZodString>;
        status: z.ZodEnum<{
            open: "open";
            closed: "closed";
            answered: "answered";
            decided: "decided";
        }>;
        decisionId: z.ZodNullable<z.ZodNumber>;
        answer: z.ZodNullable<z.ZodString>;
        ledgerQuestionId: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>;
    savedAt: z.ZodString;
}, z.core.$strip>;
export declare const agentSaleDecisionsFeedQuerySchema: z.ZodObject<{
    since: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
/** A decision as the feed carries it: as it is now, no fan's name. */
export declare const agentSaleDecisionFeedDecisionSchema: z.ZodObject<{
    id: z.ZodNumber;
    transactionId: z.ZodNullable<z.ZodNumber>;
    pageLabel: z.ZodNullable<z.ZodString>;
    kind: z.ZodEnum<{
        owner: "owner";
        split: "split";
        pot: "pot";
        exclude: "exclude";
        off_platform: "off_platform";
    }>;
    shares: z.ZodArray<z.ZodObject<{
        person: z.ZodNullable<z.ZodString>;
        userId: z.ZodNumber;
        percent: z.ZodNumber;
    }, z.core.$strip>>;
    pot: z.ZodNullable<z.ZodString>;
    outcome: z.ZodString;
    ruleHome: z.ZodNullable<z.ZodString>;
    state: z.ZodEnum<{
        cancelled: "cancelled";
        active: "active";
        superseded: "superseded";
    }>;
    source: z.ZodEnum<{
        agent: "agent";
        ledger: "ledger";
        dispute: "dispute";
    }>;
    saidBy: z.ZodNullable<z.ZodString>;
    saidAt: z.ZodNullable<z.ZodString>;
    decidedAt: z.ZodString;
    note: z.ZodNullable<z.ZodString>;
    applied: z.ZodNullable<z.ZodObject<{
        person: z.ZodNullable<z.ZodString>;
        reportDate: z.ZodString;
    }, z.core.$strip>>;
    ledgerDecisionId: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
export declare const agentSaleDecisionsFeedResponseSchema: z.ZodObject<{
    changes: z.ZodArray<z.ZodObject<{
        seq: z.ZodNumber;
        change: z.ZodEnum<{
            cancelled: "cancelled";
            applied: "applied";
            changed: "changed";
            superseded: "superseded";
            linked: "linked";
            made: "made";
        }>;
        at: z.ZodString;
        decision: z.ZodObject<{
            id: z.ZodNumber;
            transactionId: z.ZodNullable<z.ZodNumber>;
            pageLabel: z.ZodNullable<z.ZodString>;
            kind: z.ZodEnum<{
                owner: "owner";
                split: "split";
                pot: "pot";
                exclude: "exclude";
                off_platform: "off_platform";
            }>;
            shares: z.ZodArray<z.ZodObject<{
                person: z.ZodNullable<z.ZodString>;
                userId: z.ZodNumber;
                percent: z.ZodNumber;
            }, z.core.$strip>>;
            pot: z.ZodNullable<z.ZodString>;
            outcome: z.ZodString;
            ruleHome: z.ZodNullable<z.ZodString>;
            state: z.ZodEnum<{
                cancelled: "cancelled";
                active: "active";
                superseded: "superseded";
            }>;
            source: z.ZodEnum<{
                agent: "agent";
                ledger: "ledger";
                dispute: "dispute";
            }>;
            saidBy: z.ZodNullable<z.ZodString>;
            saidAt: z.ZodNullable<z.ZodString>;
            decidedAt: z.ZodString;
            note: z.ZodNullable<z.ZodString>;
            applied: z.ZodNullable<z.ZodObject<{
                person: z.ZodNullable<z.ZodString>;
                reportDate: z.ZodString;
            }, z.core.$strip>>;
            ledgerDecisionId: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
    }, z.core.$strip>>;
    held: z.ZodDefault<z.ZodArray<z.ZodObject<{
        seq: z.ZodNumber;
        decisionId: z.ZodNumber;
        pageLabel: z.ZodNullable<z.ZodString>;
        reason: z.ZodEnum<{
            page_outside_key: "page_outside_key";
        }>;
    }, z.core.$strip>>>;
    next: z.ZodString;
    serverNow: z.ZodString;
}, z.core.$strip>;
export type AgentSaleDecision = z.infer<typeof agentSaleDecisionSchema>;
export type AgentSaleDecisionsFeedResponse = z.infer<typeof agentSaleDecisionsFeedResponseSchema>;
export type AgentSaleQuestion = z.infer<typeof agentSaleQuestionSchema>;
export declare const saleDecisionRouteSchemas: {
    readonly agentSaleDecisionAdd: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "Record a decision about a sale «со слов»: the owner's ruling or the chatters' agreement (needs write:shift_reports)";
        readonly description: string;
        readonly body: z.ZodObject<{
            telegramUserId: z.ZodNumber;
            sourceRef: z.ZodString;
            kind: z.ZodEnum<{
                owner: "owner";
                split: "split";
                pot: "pot";
                exclude: "exclude";
                off_platform: "off_platform";
            }>;
            shares: z.ZodDefault<z.ZodArray<z.ZodObject<{
                person: z.ZodString;
                percent: z.ZodNumber;
            }, z.core.$strip>>>;
            pot: z.ZodOptional<z.ZodString>;
            saidBy: z.ZodString;
            saidAt: z.ZodString;
            note: z.ZodOptional<z.ZodString>;
            supersedes: z.ZodOptional<z.ZodNumber>;
            answers: z.ZodOptional<z.ZodNumber>;
            transactionId: z.ZodOptional<z.ZodNumber>;
            pageLabel: z.ZodOptional<z.ZodString>;
            transactionRef: z.ZodOptional<z.ZodString>;
            fanRef: z.ZodOptional<z.ZodString>;
            occurredAt: z.ZodOptional<z.ZodString>;
            netMills: z.ZodOptional<z.ZodNumber>;
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
            readonly 409: z.ZodObject<{
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
                decision: z.ZodObject<{
                    id: z.ZodNumber;
                    transactionId: z.ZodNullable<z.ZodNumber>;
                    pageLabel: z.ZodNullable<z.ZodString>;
                    fan: z.ZodObject<{
                        fanRef: z.ZodNullable<z.ZodString>;
                        name: z.ZodNullable<z.ZodString>;
                        username: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>;
                    netMills: z.ZodNullable<z.ZodNumber>;
                    occurredAt: z.ZodNullable<z.ZodString>;
                    kind: z.ZodEnum<{
                        owner: "owner";
                        split: "split";
                        pot: "pot";
                        exclude: "exclude";
                        off_platform: "off_platform";
                    }>;
                    shares: z.ZodArray<z.ZodObject<{
                        person: z.ZodNullable<z.ZodString>;
                        name: z.ZodString;
                        percent: z.ZodNumber;
                    }, z.core.$strip>>;
                    pot: z.ZodNullable<z.ZodString>;
                    saidBy: z.ZodNullable<z.ZodString>;
                    saidAt: z.ZodNullable<z.ZodString>;
                    sourceLink: z.ZodNullable<z.ZodString>;
                    note: z.ZodNullable<z.ZodString>;
                    source: z.ZodEnum<{
                        agent: "agent";
                        ledger: "ledger";
                        dispute: "dispute";
                    }>;
                    status: z.ZodEnum<{
                        cancelled: "cancelled";
                        applied: "applied";
                        open: "open";
                        superseded: "superseded";
                        held: "held";
                    }>;
                    statusWords: z.ZodString;
                    supersededBy: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strip>;
                versions: z.ZodArray<z.ZodObject<{
                    shiftId: z.ZodNumber;
                    version: z.ZodNumber;
                }, z.core.$strip>>;
                savedAt: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly agentSaleDecisionCancel: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "Cancel a decision «со слов», with why (needs write:shift_reports)";
        readonly description: string;
        readonly body: z.ZodObject<{
            telegramUserId: z.ZodNumber;
            sourceRef: z.ZodString;
            decisionId: z.ZodNumber;
            note: z.ZodString;
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
            readonly 409: z.ZodObject<{
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
                decision: z.ZodObject<{
                    id: z.ZodNumber;
                    transactionId: z.ZodNullable<z.ZodNumber>;
                    pageLabel: z.ZodNullable<z.ZodString>;
                    fan: z.ZodObject<{
                        fanRef: z.ZodNullable<z.ZodString>;
                        name: z.ZodNullable<z.ZodString>;
                        username: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>;
                    netMills: z.ZodNullable<z.ZodNumber>;
                    occurredAt: z.ZodNullable<z.ZodString>;
                    kind: z.ZodEnum<{
                        owner: "owner";
                        split: "split";
                        pot: "pot";
                        exclude: "exclude";
                        off_platform: "off_platform";
                    }>;
                    shares: z.ZodArray<z.ZodObject<{
                        person: z.ZodNullable<z.ZodString>;
                        name: z.ZodString;
                        percent: z.ZodNumber;
                    }, z.core.$strip>>;
                    pot: z.ZodNullable<z.ZodString>;
                    saidBy: z.ZodNullable<z.ZodString>;
                    saidAt: z.ZodNullable<z.ZodString>;
                    sourceLink: z.ZodNullable<z.ZodString>;
                    note: z.ZodNullable<z.ZodString>;
                    source: z.ZodEnum<{
                        agent: "agent";
                        ledger: "ledger";
                        dispute: "dispute";
                    }>;
                    status: z.ZodEnum<{
                        cancelled: "cancelled";
                        applied: "applied";
                        open: "open";
                        superseded: "superseded";
                        held: "held";
                    }>;
                    statusWords: z.ZodString;
                    supersededBy: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strip>;
                versions: z.ZodArray<z.ZodObject<{
                    shiftId: z.ZodNumber;
                    version: z.ZodNumber;
                }, z.core.$strip>>;
                savedAt: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly agentSaleDecisionApplied: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "Mark a decision taken into a person's post of a date (needs write:shift_reports)";
        readonly description: "Database only. For a person whose report is a post in «Отчётность»: the decision is not taken in twice.";
        readonly body: z.ZodObject<{
            decisionId: z.ZodNumber;
            person: z.ZodString;
            reportDate: z.ZodString;
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
            readonly 409: z.ZodObject<{
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
                decision: z.ZodObject<{
                    id: z.ZodNumber;
                    transactionId: z.ZodNullable<z.ZodNumber>;
                    pageLabel: z.ZodNullable<z.ZodString>;
                    fan: z.ZodObject<{
                        fanRef: z.ZodNullable<z.ZodString>;
                        name: z.ZodNullable<z.ZodString>;
                        username: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>;
                    netMills: z.ZodNullable<z.ZodNumber>;
                    occurredAt: z.ZodNullable<z.ZodString>;
                    kind: z.ZodEnum<{
                        owner: "owner";
                        split: "split";
                        pot: "pot";
                        exclude: "exclude";
                        off_platform: "off_platform";
                    }>;
                    shares: z.ZodArray<z.ZodObject<{
                        person: z.ZodNullable<z.ZodString>;
                        name: z.ZodString;
                        percent: z.ZodNumber;
                    }, z.core.$strip>>;
                    pot: z.ZodNullable<z.ZodString>;
                    saidBy: z.ZodNullable<z.ZodString>;
                    saidAt: z.ZodNullable<z.ZodString>;
                    sourceLink: z.ZodNullable<z.ZodString>;
                    note: z.ZodNullable<z.ZodString>;
                    source: z.ZodEnum<{
                        agent: "agent";
                        ledger: "ledger";
                        dispute: "dispute";
                    }>;
                    status: z.ZodEnum<{
                        cancelled: "cancelled";
                        applied: "applied";
                        open: "open";
                        superseded: "superseded";
                        held: "held";
                    }>;
                    statusWords: z.ZodString;
                    supersededBy: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strip>;
                versions: z.ZodArray<z.ZodObject<{
                    shiftId: z.ZodNumber;
                    version: z.ZodNumber;
                }, z.core.$strip>>;
                savedAt: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly agentSaleDecisions: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "The decisions about sales on the key's pages, as a list or as the memory file has them (needs write:shift_reports or read:team)";
        readonly description: "Database only. Every source: the owner's disputes, the ones carried over from the ledger, the ones recorded «со слов».";
        readonly querystring: z.ZodObject<{
            open: z.ZodPipe<z.ZodDefault<z.ZodEnum<{
                true: "true";
                false: "false";
            }>>, z.ZodTransform<boolean, "true" | "false">>;
            since: z.ZodOptional<z.ZodString>;
            format: z.ZodDefault<z.ZodEnum<{
                json: "json";
                md: "md";
            }>>;
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
            readonly 409: z.ZodObject<{
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
                decisions: z.ZodArray<z.ZodObject<{
                    id: z.ZodNumber;
                    transactionId: z.ZodNullable<z.ZodNumber>;
                    pageLabel: z.ZodNullable<z.ZodString>;
                    fan: z.ZodObject<{
                        fanRef: z.ZodNullable<z.ZodString>;
                        name: z.ZodNullable<z.ZodString>;
                        username: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>;
                    netMills: z.ZodNullable<z.ZodNumber>;
                    occurredAt: z.ZodNullable<z.ZodString>;
                    kind: z.ZodEnum<{
                        owner: "owner";
                        split: "split";
                        pot: "pot";
                        exclude: "exclude";
                        off_platform: "off_platform";
                    }>;
                    shares: z.ZodArray<z.ZodObject<{
                        person: z.ZodNullable<z.ZodString>;
                        name: z.ZodString;
                        percent: z.ZodNumber;
                    }, z.core.$strip>>;
                    pot: z.ZodNullable<z.ZodString>;
                    saidBy: z.ZodNullable<z.ZodString>;
                    saidAt: z.ZodNullable<z.ZodString>;
                    sourceLink: z.ZodNullable<z.ZodString>;
                    note: z.ZodNullable<z.ZodString>;
                    source: z.ZodEnum<{
                        agent: "agent";
                        ledger: "ledger";
                        dispute: "dispute";
                    }>;
                    status: z.ZodEnum<{
                        cancelled: "cancelled";
                        applied: "applied";
                        open: "open";
                        superseded: "superseded";
                        held: "held";
                    }>;
                    statusWords: z.ZodString;
                    supersededBy: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strip>>;
                markdown: z.ZodNullable<z.ZodString>;
                serverNow: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly agentSaleDecisionsFeed: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "Every change of a decision about whose a sale is, after a cursor: what the ledger follows (needs read:money)";
        readonly description: string;
        readonly querystring: z.ZodObject<{
            since: z.ZodOptional<z.ZodString>;
            limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
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
            readonly 409: z.ZodObject<{
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
                changes: z.ZodArray<z.ZodObject<{
                    seq: z.ZodNumber;
                    change: z.ZodEnum<{
                        cancelled: "cancelled";
                        applied: "applied";
                        changed: "changed";
                        superseded: "superseded";
                        linked: "linked";
                        made: "made";
                    }>;
                    at: z.ZodString;
                    decision: z.ZodObject<{
                        id: z.ZodNumber;
                        transactionId: z.ZodNullable<z.ZodNumber>;
                        pageLabel: z.ZodNullable<z.ZodString>;
                        kind: z.ZodEnum<{
                            owner: "owner";
                            split: "split";
                            pot: "pot";
                            exclude: "exclude";
                            off_platform: "off_platform";
                        }>;
                        shares: z.ZodArray<z.ZodObject<{
                            person: z.ZodNullable<z.ZodString>;
                            userId: z.ZodNumber;
                            percent: z.ZodNumber;
                        }, z.core.$strip>>;
                        pot: z.ZodNullable<z.ZodString>;
                        outcome: z.ZodString;
                        ruleHome: z.ZodNullable<z.ZodString>;
                        state: z.ZodEnum<{
                            cancelled: "cancelled";
                            active: "active";
                            superseded: "superseded";
                        }>;
                        source: z.ZodEnum<{
                            agent: "agent";
                            ledger: "ledger";
                            dispute: "dispute";
                        }>;
                        saidBy: z.ZodNullable<z.ZodString>;
                        saidAt: z.ZodNullable<z.ZodString>;
                        decidedAt: z.ZodString;
                        note: z.ZodNullable<z.ZodString>;
                        applied: z.ZodNullable<z.ZodObject<{
                            person: z.ZodNullable<z.ZodString>;
                            reportDate: z.ZodString;
                        }, z.core.$strip>>;
                        ledgerDecisionId: z.ZodNullable<z.ZodNumber>;
                    }, z.core.$strip>;
                }, z.core.$strip>>;
                held: z.ZodDefault<z.ZodArray<z.ZodObject<{
                    seq: z.ZodNumber;
                    decisionId: z.ZodNumber;
                    pageLabel: z.ZodNullable<z.ZodString>;
                    reason: z.ZodEnum<{
                        page_outside_key: "page_outside_key";
                    }>;
                }, z.core.$strip>>>;
                next: z.ZodString;
                serverNow: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly agentSaleQuestionAsk: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "Ask a question about whose a sale is: of the owner or of the chatters (needs write:shift_reports)";
        readonly description: string;
        readonly body: z.ZodObject<{
            telegramUserId: z.ZodNumber;
            sourceRef: z.ZodString;
            askedOf: z.ZodEnum<{
                owner: "owner";
                chatters: "chatters";
            }>;
            who: z.ZodOptional<z.ZodString>;
            people: z.ZodDefault<z.ZodArray<z.ZodString>>;
            question: z.ZodString;
            note: z.ZodOptional<z.ZodString>;
            askedAt: z.ZodString;
            transactionId: z.ZodOptional<z.ZodNumber>;
            pageLabel: z.ZodOptional<z.ZodString>;
            transactionRef: z.ZodOptional<z.ZodString>;
            fanRef: z.ZodOptional<z.ZodString>;
            occurredAt: z.ZodOptional<z.ZodString>;
            netMills: z.ZodOptional<z.ZodNumber>;
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
            readonly 409: z.ZodObject<{
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
                question: z.ZodObject<{
                    id: z.ZodNumber;
                    transactionId: z.ZodNullable<z.ZodNumber>;
                    pageLabel: z.ZodNullable<z.ZodString>;
                    fan: z.ZodObject<{
                        fanRef: z.ZodNullable<z.ZodString>;
                        name: z.ZodNullable<z.ZodString>;
                        username: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>;
                    netMills: z.ZodNullable<z.ZodNumber>;
                    askedOf: z.ZodEnum<{
                        owner: "owner";
                        chatters: "chatters";
                    }>;
                    who: z.ZodNullable<z.ZodString>;
                    question: z.ZodString;
                    askedAt: z.ZodString;
                    sourceLink: z.ZodNullable<z.ZodString>;
                    status: z.ZodEnum<{
                        open: "open";
                        closed: "closed";
                        answered: "answered";
                        decided: "decided";
                    }>;
                    decisionId: z.ZodNullable<z.ZodNumber>;
                    answer: z.ZodNullable<z.ZodString>;
                    ledgerQuestionId: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strip>;
                savedAt: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly agentSaleQuestionAnswer: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "Close a question with an answer in words, when there is no decision to record (needs write:shift_reports)";
        readonly description: "Database only. An answer that decides the sale is a decision: `agentSaleDecisionAdd` with `answers`.";
        readonly body: z.ZodObject<{
            telegramUserId: z.ZodNumber;
            sourceRef: z.ZodString;
            questionId: z.ZodNumber;
            answer: z.ZodString;
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
            readonly 409: z.ZodObject<{
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
                question: z.ZodObject<{
                    id: z.ZodNumber;
                    transactionId: z.ZodNullable<z.ZodNumber>;
                    pageLabel: z.ZodNullable<z.ZodString>;
                    fan: z.ZodObject<{
                        fanRef: z.ZodNullable<z.ZodString>;
                        name: z.ZodNullable<z.ZodString>;
                        username: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>;
                    netMills: z.ZodNullable<z.ZodNumber>;
                    askedOf: z.ZodEnum<{
                        owner: "owner";
                        chatters: "chatters";
                    }>;
                    who: z.ZodNullable<z.ZodString>;
                    question: z.ZodString;
                    askedAt: z.ZodString;
                    sourceLink: z.ZodNullable<z.ZodString>;
                    status: z.ZodEnum<{
                        open: "open";
                        closed: "closed";
                        answered: "answered";
                        decided: "decided";
                    }>;
                    decisionId: z.ZodNullable<z.ZodNumber>;
                    answer: z.ZodNullable<z.ZodString>;
                    ledgerQuestionId: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strip>;
                savedAt: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly agentSaleQuestionClose: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "Close a question without an answer, with why (needs write:shift_reports)";
        readonly description: "Database only.";
        readonly body: z.ZodObject<{
            telegramUserId: z.ZodNumber;
            sourceRef: z.ZodString;
            questionId: z.ZodNumber;
            note: z.ZodString;
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
            readonly 409: z.ZodObject<{
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
                question: z.ZodObject<{
                    id: z.ZodNumber;
                    transactionId: z.ZodNullable<z.ZodNumber>;
                    pageLabel: z.ZodNullable<z.ZodString>;
                    fan: z.ZodObject<{
                        fanRef: z.ZodNullable<z.ZodString>;
                        name: z.ZodNullable<z.ZodString>;
                        username: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>;
                    netMills: z.ZodNullable<z.ZodNumber>;
                    askedOf: z.ZodEnum<{
                        owner: "owner";
                        chatters: "chatters";
                    }>;
                    who: z.ZodNullable<z.ZodString>;
                    question: z.ZodString;
                    askedAt: z.ZodString;
                    sourceLink: z.ZodNullable<z.ZodString>;
                    status: z.ZodEnum<{
                        open: "open";
                        closed: "closed";
                        answered: "answered";
                        decided: "decided";
                    }>;
                    decisionId: z.ZodNullable<z.ZodNumber>;
                    answer: z.ZodNullable<z.ZodString>;
                    ledgerQuestionId: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strip>;
                savedAt: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly agentSaleQuestions: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "The questions about sales on the key's pages, as a list or as the memory file has them (needs write:shift_reports or read:team)";
        readonly description: "Database only. The ones carried over from the ledger and the ones asked here.";
        readonly querystring: z.ZodObject<{
            open: z.ZodPipe<z.ZodDefault<z.ZodEnum<{
                true: "true";
                false: "false";
            }>>, z.ZodTransform<boolean, "true" | "false">>;
            format: z.ZodDefault<z.ZodEnum<{
                json: "json";
                md: "md";
            }>>;
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
            readonly 409: z.ZodObject<{
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
                questions: z.ZodArray<z.ZodObject<{
                    id: z.ZodNumber;
                    transactionId: z.ZodNullable<z.ZodNumber>;
                    pageLabel: z.ZodNullable<z.ZodString>;
                    fan: z.ZodObject<{
                        fanRef: z.ZodNullable<z.ZodString>;
                        name: z.ZodNullable<z.ZodString>;
                        username: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>;
                    netMills: z.ZodNullable<z.ZodNumber>;
                    askedOf: z.ZodEnum<{
                        owner: "owner";
                        chatters: "chatters";
                    }>;
                    who: z.ZodNullable<z.ZodString>;
                    question: z.ZodString;
                    askedAt: z.ZodString;
                    sourceLink: z.ZodNullable<z.ZodString>;
                    status: z.ZodEnum<{
                        open: "open";
                        closed: "closed";
                        answered: "answered";
                        decided: "decided";
                    }>;
                    decisionId: z.ZodNullable<z.ZodNumber>;
                    answer: z.ZodNullable<z.ZodString>;
                    ledgerQuestionId: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strip>>;
                markdown: z.ZodNullable<z.ZodString>;
                serverNow: z.ZodString;
            }, z.core.$strip>;
        };
    };
};
