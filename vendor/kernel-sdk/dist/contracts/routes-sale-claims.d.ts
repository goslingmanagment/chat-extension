/**
 * Заявки и договорённости (ecosystem plan 2026-11-12, package G): what people
 * say about a sale reaches the other side and, when they do not agree, the
 * owner. A statement of a handed-in report that touches another person — «моё»
 * on a sale the rule or another person's report gives to them, «делим с …» —
 * is a claim: the other side answers «Согласен» or «Не согласен» on their own
 * shift report (a matter takes them to the line); agreement settles it, the
 * homes follow; «Не согласен» or 24 hours of silence make ONE matter for the
 * owner with both statements and the facts, and his answer — to the first, to
 * the second, in halves, to nobody — is a decision the rule takes before
 * itself. A sale two reports count for more than its net is a dispute by
 * itself. The owner also confirms or rejects «мимо площадки», and sees once a
 * week the sales nobody claimed.
 *
 * Who sees what: a person their own claims, both sides of each; a chatter only
 * claims of sales on pages they may open, and only the sales' amounts, never
 * anyone's pay; the owner every claim and decision. An agent key reads them for
 * a person or a sale on its granted pages, and records an answer «со слов»
 * with the message and the sender checked against the person.
 */
import { z } from "zod";
export declare const saleClaimAnswerParamsSchema: z.ZodObject<{
    claimId: z.ZodCoercedNumber<unknown>;
}, z.core.$strip>;
export declare const saleClaimAnswerBodySchema: z.ZodObject<{
    answer: z.ZodEnum<{
        agree: "agree";
        disagree: "disagree";
    }>;
    note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export declare const saleClaimAnswerResponseSchema: z.ZodObject<{
    claim: z.ZodObject<{
        id: z.ZodNumber;
        kind: z.ZodEnum<{
            imported: "imported";
            claim: "claim";
            double: "double";
        }>;
        transactionId: z.ZodNullable<z.ZodNumber>;
        pageLabel: z.ZodNullable<z.ZodString>;
        claimant: z.ZodNullable<z.ZodObject<{
            userId: z.ZodNumber;
            name: z.ZodString;
        }, z.core.$strip>>;
        statement: z.ZodNullable<z.ZodEnum<{
            mine: "mine";
            share: "share";
        }>>;
        note: z.ZodNullable<z.ZodString>;
        claimedAt: z.ZodString;
        side: z.ZodNullable<z.ZodObject<{
            userId: z.ZodNumber;
            name: z.ZodString;
        }, z.core.$strip>>;
        sideShiftId: z.ZodNullable<z.ZodNumber>;
        state: z.ZodEnum<{
            owner: "owner";
            withdrawn: "withdrawn";
            decided: "decided";
            asked: "asked";
            agreed: "agreed";
        }>;
        answer: z.ZodNullable<z.ZodEnum<{
            agree: "agree";
            disagree: "disagree";
        }>>;
        answerNote: z.ZodNullable<z.ZodString>;
        answeredAt: z.ZodNullable<z.ZodString>;
        escalatedWhy: z.ZodNullable<z.ZodEnum<{
            imported: "imported";
            silence: "silence";
            disagree: "disagree";
            double: "double";
            no_side: "no_side";
        }>>;
        decision: z.ZodNullable<z.ZodObject<{
            outcome: z.ZodEnum<{
                second: "second";
                imported: "imported";
                nobody: "nobody";
                first: "first";
                half: "half";
            }>;
            note: z.ZodNullable<z.ZodString>;
            decidedAt: z.ZodString;
        }, z.core.$strip>>;
        answerBy: z.ZodNullable<z.ZodString>;
        question: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
    savedAt: z.ZodString;
}, z.core.$strip>;
export declare const saleDisputeParamsSchema: z.ZodObject<{
    transactionId: z.ZodCoercedNumber<unknown>;
}, z.core.$strip>;
/** One person of a dispute: what they said, what their report counts, what each answer gives them. */
export declare const saleDisputePartySchema: z.ZodObject<{
    userId: z.ZodNumber;
    name: z.ZodString;
    role: z.ZodEnum<{
        second: "second";
        first: "first";
    }>;
    says: z.ZodArray<z.ZodString>;
    countedMills: z.ZodNullable<z.ZodNumber>;
    shiftId: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
export declare const saleDisputeResponseSchema: z.ZodObject<{
    sale: z.ZodNullable<z.ZodObject<{
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
    }, z.core.$strip>>;
    home: z.ZodNullable<z.ZodObject<{
        kind: z.ZodString;
        reason: z.ZodString;
        words: z.ZodString;
        shares: z.ZodArray<z.ZodObject<{
            userId: z.ZodNumber;
            name: z.ZodString;
            mills: z.ZodNumber;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    parties: z.ZodArray<z.ZodObject<{
        userId: z.ZodNumber;
        name: z.ZodString;
        role: z.ZodEnum<{
            second: "second";
            first: "first";
        }>;
        says: z.ZodArray<z.ZodString>;
        countedMills: z.ZodNullable<z.ZodNumber>;
        shiftId: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
    claims: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        kind: z.ZodEnum<{
            imported: "imported";
            claim: "claim";
            double: "double";
        }>;
        transactionId: z.ZodNullable<z.ZodNumber>;
        pageLabel: z.ZodNullable<z.ZodString>;
        claimant: z.ZodNullable<z.ZodObject<{
            userId: z.ZodNumber;
            name: z.ZodString;
        }, z.core.$strip>>;
        statement: z.ZodNullable<z.ZodEnum<{
            mine: "mine";
            share: "share";
        }>>;
        note: z.ZodNullable<z.ZodString>;
        claimedAt: z.ZodString;
        side: z.ZodNullable<z.ZodObject<{
            userId: z.ZodNumber;
            name: z.ZodString;
        }, z.core.$strip>>;
        sideShiftId: z.ZodNullable<z.ZodNumber>;
        state: z.ZodEnum<{
            owner: "owner";
            withdrawn: "withdrawn";
            decided: "decided";
            asked: "asked";
            agreed: "agreed";
        }>;
        answer: z.ZodNullable<z.ZodEnum<{
            agree: "agree";
            disagree: "disagree";
        }>>;
        answerNote: z.ZodNullable<z.ZodString>;
        answeredAt: z.ZodNullable<z.ZodString>;
        escalatedWhy: z.ZodNullable<z.ZodEnum<{
            imported: "imported";
            silence: "silence";
            disagree: "disagree";
            double: "double";
            no_side: "no_side";
        }>>;
        decision: z.ZodNullable<z.ZodObject<{
            outcome: z.ZodEnum<{
                second: "second";
                imported: "imported";
                nobody: "nobody";
                first: "first";
                half: "half";
            }>;
            note: z.ZodNullable<z.ZodString>;
            decidedAt: z.ZodString;
        }, z.core.$strip>>;
        answerBy: z.ZodNullable<z.ZodString>;
        question: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    facts: z.ZodNullable<z.ZodObject<{
        ppv: z.ZodNullable<z.ZodObject<{
            senderUserId: z.ZodNullable<z.ZodNumber>;
            senderName: z.ZodNullable<z.ZodString>;
            sentAt: z.ZodNullable<z.ZodString>;
            withoutAuthor: z.ZodBoolean;
        }, z.core.$strip>>;
        lastWriter: z.ZodNullable<z.ZodObject<{
            at: z.ZodString;
            within48h: z.ZodBoolean;
            userId: z.ZodNumber;
            name: z.ZodString;
        }, z.core.$strip>>;
        writers: z.ZodArray<z.ZodObject<{
            messages: z.ZodNumber;
            userId: z.ZodNumber;
            name: z.ZodString;
        }, z.core.$strip>>;
        holders: z.ZodNullable<z.ZodArray<z.ZodObject<{
            slotRunning: z.ZodNullable<z.ZodBoolean>;
            userId: z.ZodNumber;
            name: z.ZodString;
        }, z.core.$strip>>>;
        ownSlotRunning: z.ZodNullable<z.ZodBoolean>;
        otherReports: z.ZodArray<z.ZodObject<{
            shiftId: z.ZodNumber;
            reportDate: z.ZodString;
            userId: z.ZodNumber;
            name: z.ZodString;
        }, z.core.$strip>>;
        pot: z.ZodNullable<z.ZodString>;
        renewalOf: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    outcomes: z.ZodArray<z.ZodObject<{
        outcome: z.ZodEnum<{
            second: "second";
            nobody: "nobody";
            dismiss: "dismiss";
            first: "first";
            half: "half";
        }>;
        label: z.ZodString;
        gives: z.ZodArray<z.ZodObject<{
            userId: z.ZodNumber;
            mills: z.ZodNumber;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    decision: z.ZodNullable<z.ZodObject<{
        outcome: z.ZodString;
        note: z.ZodNullable<z.ZodString>;
        decidedAt: z.ZodString;
        by: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const saleDisputeDecideBodySchema: z.ZodObject<{
    transactionId: z.ZodOptional<z.ZodNumber>;
    claimId: z.ZodOptional<z.ZodNumber>;
    outcome: z.ZodEnum<{
        second: "second";
        nobody: "nobody";
        dismiss: "dismiss";
        first: "first";
        half: "half";
    }>;
    note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export declare const saleDisputeDecideResponseSchema: z.ZodObject<{
    decided: z.ZodBoolean;
    versions: z.ZodArray<z.ZodObject<{
        shiftId: z.ZodNumber;
        version: z.ZodNumber;
    }, z.core.$strip>>;
    savedAt: z.ZodString;
}, z.core.$strip>;
/** A question carried over from the ledger and tied to no sale: the claim's id instead. */
export declare const saleDisputeByClaimParamsSchema: z.ZodObject<{
    claimId: z.ZodCoercedNumber<unknown>;
}, z.core.$strip>;
export declare const offPlatformDecideParamsSchema: z.ZodObject<{
    offPlatformId: z.ZodCoercedNumber<unknown>;
}, z.core.$strip>;
export declare const offPlatformDecideBodySchema: z.ZodObject<{
    decision: z.ZodEnum<{
        reject: "reject";
        confirm: "confirm";
    }>;
    pageLabel: z.ZodOptional<z.ZodString>;
    note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export declare const offPlatformDecideResponseSchema: z.ZodObject<{
    state: z.ZodEnum<{
        rejected: "rejected";
        confirmed: "confirmed";
    }>;
    version: z.ZodNullable<z.ZodNumber>;
    savedAt: z.ZodString;
}, z.core.$strip>;
export declare const offPlatformPendingQuerySchema: z.ZodObject<{
    shiftId: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export declare const offPlatformPendingResponseSchema: z.ZodObject<{
    reports: z.ZodArray<z.ZodObject<{
        shiftId: z.ZodNumber;
        person: z.ZodObject<{
            userId: z.ZodNumber;
            name: z.ZodString;
        }, z.core.$strip>;
        reportDate: z.ZodString;
        pages: z.ZodArray<z.ZodString>;
        totalMills: z.ZodNumber;
        lines: z.ZodArray<z.ZodObject<{
            id: z.ZodNumber;
            amountMills: z.ZodNumber;
            fromWhom: z.ZodString;
            whatFor: z.ZodString;
            addedAt: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const saleNobodyQuerySchema: z.ZodObject<{
    week: z.ZodString;
}, z.core.$strip>;
export declare const saleNobodyResponseSchema: z.ZodObject<{
    from: z.ZodString;
    to: z.ZodString;
    days: z.ZodArray<z.ZodString>;
    sales: z.ZodArray<z.ZodObject<{
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
        home: z.ZodString;
        words: z.ZodString;
    }, z.core.$strip>>;
    totalMills: z.ZodNumber;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const saleNobodyKeepBodySchema: z.ZodObject<{
    week: z.ZodString;
    transactionIds: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
}, z.core.$strip>;
export declare const saleNobodyKeepResponseSchema: z.ZodObject<{
    kept: z.ZodNumber;
    savedAt: z.ZodString;
}, z.core.$strip>;
export declare const saleDecisionsUnlinkedResponseSchema: z.ZodObject<{
    decisions: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        ledgerDecisionId: z.ZodNullable<z.ZodNumber>;
        pageLabel: z.ZodNullable<z.ZodString>;
        words: z.ZodString;
        saidBy: z.ZodNullable<z.ZodString>;
        shares: z.ZodArray<z.ZodObject<{
            userId: z.ZodNumber;
            name: z.ZodString;
            percent: z.ZodNumber;
        }, z.core.$strip>>;
        kind: z.ZodEnum<{
            split: "split";
            pot: "pot";
            nobody: "nobody";
        }>;
        candidates: z.ZodArray<z.ZodObject<{
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
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const saleDecisionLinkParamsSchema: z.ZodObject<{
    decisionId: z.ZodCoercedNumber<unknown>;
}, z.core.$strip>;
export declare const saleDecisionLinkBodySchema: z.ZodObject<{
    transactionId: z.ZodNumber;
}, z.core.$strip>;
export declare const saleDecisionLinkResponseSchema: z.ZodObject<{
    linked: z.ZodBoolean;
    savedAt: z.ZodString;
}, z.core.$strip>;
export declare const agentSaleClaimsQuerySchema: z.ZodObject<{
    person: z.ZodOptional<z.ZodString>;
    telegramUserId: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    transactionId: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    scope: z.ZodDefault<z.ZodEnum<{
        all: "all";
        open: "open";
    }>>;
}, z.core.$strip>;
export declare const agentSaleClaimsResponseSchema: z.ZodObject<{
    decisions: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        transactionId: z.ZodNullable<z.ZodNumber>;
        pageLabel: z.ZodNullable<z.ZodString>;
        kind: z.ZodEnum<{
            split: "split";
            pot: "pot";
            nobody: "nobody";
        }>;
        shares: z.ZodArray<z.ZodObject<{
            person: z.ZodNullable<z.ZodString>;
            name: z.ZodString;
            percent: z.ZodNumber;
        }, z.core.$strip>>;
        pot: z.ZodNullable<z.ZodString>;
        outcome: z.ZodString;
        note: z.ZodNullable<z.ZodString>;
        saidBy: z.ZodNullable<z.ZodString>;
        decidedAt: z.ZodString;
        active: z.ZodBoolean;
        needsLink: z.ZodBoolean;
        words: z.ZodString;
    }, z.core.$strip>>;
    claims: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        kind: z.ZodEnum<{
            imported: "imported";
            claim: "claim";
            double: "double";
        }>;
        transactionId: z.ZodNullable<z.ZodNumber>;
        pageLabel: z.ZodNullable<z.ZodString>;
        claimant: z.ZodNullable<z.ZodObject<{
            userId: z.ZodNumber;
            name: z.ZodString;
        }, z.core.$strip>>;
        statement: z.ZodNullable<z.ZodEnum<{
            mine: "mine";
            share: "share";
        }>>;
        note: z.ZodNullable<z.ZodString>;
        claimedAt: z.ZodString;
        side: z.ZodNullable<z.ZodObject<{
            userId: z.ZodNumber;
            name: z.ZodString;
        }, z.core.$strip>>;
        sideShiftId: z.ZodNullable<z.ZodNumber>;
        state: z.ZodEnum<{
            owner: "owner";
            withdrawn: "withdrawn";
            decided: "decided";
            asked: "asked";
            agreed: "agreed";
        }>;
        answer: z.ZodNullable<z.ZodEnum<{
            agree: "agree";
            disagree: "disagree";
        }>>;
        answerNote: z.ZodNullable<z.ZodString>;
        answeredAt: z.ZodNullable<z.ZodString>;
        escalatedWhy: z.ZodNullable<z.ZodEnum<{
            imported: "imported";
            silence: "silence";
            disagree: "disagree";
            double: "double";
            no_side: "no_side";
        }>>;
        decision: z.ZodNullable<z.ZodObject<{
            outcome: z.ZodEnum<{
                second: "second";
                imported: "imported";
                nobody: "nobody";
                first: "first";
                half: "half";
            }>;
            note: z.ZodNullable<z.ZodString>;
            decidedAt: z.ZodString;
        }, z.core.$strip>>;
        answerBy: z.ZodNullable<z.ZodString>;
        question: z.ZodNullable<z.ZodString>;
        netMills: z.ZodNullable<z.ZodNumber>;
        occurredAt: z.ZodNullable<z.ZodString>;
        words: z.ZodString;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const agentSaleClaimAnswerBodySchema: z.ZodObject<{
    answer: z.ZodEnum<{
        agree: "agree";
        disagree: "disagree";
    }>;
    note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    claimId: z.ZodNumber;
    telegramUserId: z.ZodNumber;
    sourceRef: z.ZodString;
}, z.core.$strip>;
export type SaleDisputeResponse = z.infer<typeof saleDisputeResponseSchema>;
export type SaleDisputeOutcome = z.infer<typeof saleDisputeDecideBodySchema>["outcome"];
export type OffPlatformPendingResponse = z.infer<typeof offPlatformPendingResponseSchema>;
export type SaleNobodyResponse = z.infer<typeof saleNobodyResponseSchema>;
export type SaleDecisionsUnlinkedResponse = z.infer<typeof saleDecisionsUnlinkedResponseSchema>;
export type AgentSaleClaimsResponse = z.infer<typeof agentSaleClaimsResponseSchema>;
export declare const saleClaimRouteSchemas: {
    readonly saleClaimAnswer: {
        readonly auth: {
            readonly kind: "any";
        };
        readonly tags: readonly ["client"];
        readonly summary: "The other side answers a claim on their sale: «Согласен» settles it, «Не согласен» (with a line of why) takes it to the owner";
        readonly description: string;
        readonly params: z.ZodObject<{
            claimId: z.ZodCoercedNumber<unknown>;
        }, z.core.$strip>;
        readonly body: z.ZodObject<{
            answer: z.ZodEnum<{
                agree: "agree";
                disagree: "disagree";
            }>;
            note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
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
            readonly 200: z.ZodObject<{
                claim: z.ZodObject<{
                    id: z.ZodNumber;
                    kind: z.ZodEnum<{
                        imported: "imported";
                        claim: "claim";
                        double: "double";
                    }>;
                    transactionId: z.ZodNullable<z.ZodNumber>;
                    pageLabel: z.ZodNullable<z.ZodString>;
                    claimant: z.ZodNullable<z.ZodObject<{
                        userId: z.ZodNumber;
                        name: z.ZodString;
                    }, z.core.$strip>>;
                    statement: z.ZodNullable<z.ZodEnum<{
                        mine: "mine";
                        share: "share";
                    }>>;
                    note: z.ZodNullable<z.ZodString>;
                    claimedAt: z.ZodString;
                    side: z.ZodNullable<z.ZodObject<{
                        userId: z.ZodNumber;
                        name: z.ZodString;
                    }, z.core.$strip>>;
                    sideShiftId: z.ZodNullable<z.ZodNumber>;
                    state: z.ZodEnum<{
                        owner: "owner";
                        withdrawn: "withdrawn";
                        decided: "decided";
                        asked: "asked";
                        agreed: "agreed";
                    }>;
                    answer: z.ZodNullable<z.ZodEnum<{
                        agree: "agree";
                        disagree: "disagree";
                    }>>;
                    answerNote: z.ZodNullable<z.ZodString>;
                    answeredAt: z.ZodNullable<z.ZodString>;
                    escalatedWhy: z.ZodNullable<z.ZodEnum<{
                        imported: "imported";
                        silence: "silence";
                        disagree: "disagree";
                        double: "double";
                        no_side: "no_side";
                    }>>;
                    decision: z.ZodNullable<z.ZodObject<{
                        outcome: z.ZodEnum<{
                            second: "second";
                            imported: "imported";
                            nobody: "nobody";
                            first: "first";
                            half: "half";
                        }>;
                        note: z.ZodNullable<z.ZodString>;
                        decidedAt: z.ZodString;
                    }, z.core.$strip>>;
                    answerBy: z.ZodNullable<z.ZodString>;
                    question: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>;
                savedAt: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly saleDispute: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "The owner's dispute of a sale: both statements, the facts, and what each of the four answers gives";
        readonly description: "Owner only. Database only.";
        readonly params: z.ZodObject<{
            transactionId: z.ZodCoercedNumber<unknown>;
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
            readonly 200: z.ZodObject<{
                sale: z.ZodNullable<z.ZodObject<{
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
                }, z.core.$strip>>;
                home: z.ZodNullable<z.ZodObject<{
                    kind: z.ZodString;
                    reason: z.ZodString;
                    words: z.ZodString;
                    shares: z.ZodArray<z.ZodObject<{
                        userId: z.ZodNumber;
                        name: z.ZodString;
                        mills: z.ZodNumber;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                parties: z.ZodArray<z.ZodObject<{
                    userId: z.ZodNumber;
                    name: z.ZodString;
                    role: z.ZodEnum<{
                        second: "second";
                        first: "first";
                    }>;
                    says: z.ZodArray<z.ZodString>;
                    countedMills: z.ZodNullable<z.ZodNumber>;
                    shiftId: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strip>>;
                claims: z.ZodArray<z.ZodObject<{
                    id: z.ZodNumber;
                    kind: z.ZodEnum<{
                        imported: "imported";
                        claim: "claim";
                        double: "double";
                    }>;
                    transactionId: z.ZodNullable<z.ZodNumber>;
                    pageLabel: z.ZodNullable<z.ZodString>;
                    claimant: z.ZodNullable<z.ZodObject<{
                        userId: z.ZodNumber;
                        name: z.ZodString;
                    }, z.core.$strip>>;
                    statement: z.ZodNullable<z.ZodEnum<{
                        mine: "mine";
                        share: "share";
                    }>>;
                    note: z.ZodNullable<z.ZodString>;
                    claimedAt: z.ZodString;
                    side: z.ZodNullable<z.ZodObject<{
                        userId: z.ZodNumber;
                        name: z.ZodString;
                    }, z.core.$strip>>;
                    sideShiftId: z.ZodNullable<z.ZodNumber>;
                    state: z.ZodEnum<{
                        owner: "owner";
                        withdrawn: "withdrawn";
                        decided: "decided";
                        asked: "asked";
                        agreed: "agreed";
                    }>;
                    answer: z.ZodNullable<z.ZodEnum<{
                        agree: "agree";
                        disagree: "disagree";
                    }>>;
                    answerNote: z.ZodNullable<z.ZodString>;
                    answeredAt: z.ZodNullable<z.ZodString>;
                    escalatedWhy: z.ZodNullable<z.ZodEnum<{
                        imported: "imported";
                        silence: "silence";
                        disagree: "disagree";
                        double: "double";
                        no_side: "no_side";
                    }>>;
                    decision: z.ZodNullable<z.ZodObject<{
                        outcome: z.ZodEnum<{
                            second: "second";
                            imported: "imported";
                            nobody: "nobody";
                            first: "first";
                            half: "half";
                        }>;
                        note: z.ZodNullable<z.ZodString>;
                        decidedAt: z.ZodString;
                    }, z.core.$strip>>;
                    answerBy: z.ZodNullable<z.ZodString>;
                    question: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
                facts: z.ZodNullable<z.ZodObject<{
                    ppv: z.ZodNullable<z.ZodObject<{
                        senderUserId: z.ZodNullable<z.ZodNumber>;
                        senderName: z.ZodNullable<z.ZodString>;
                        sentAt: z.ZodNullable<z.ZodString>;
                        withoutAuthor: z.ZodBoolean;
                    }, z.core.$strip>>;
                    lastWriter: z.ZodNullable<z.ZodObject<{
                        at: z.ZodString;
                        within48h: z.ZodBoolean;
                        userId: z.ZodNumber;
                        name: z.ZodString;
                    }, z.core.$strip>>;
                    writers: z.ZodArray<z.ZodObject<{
                        messages: z.ZodNumber;
                        userId: z.ZodNumber;
                        name: z.ZodString;
                    }, z.core.$strip>>;
                    holders: z.ZodNullable<z.ZodArray<z.ZodObject<{
                        slotRunning: z.ZodNullable<z.ZodBoolean>;
                        userId: z.ZodNumber;
                        name: z.ZodString;
                    }, z.core.$strip>>>;
                    ownSlotRunning: z.ZodNullable<z.ZodBoolean>;
                    otherReports: z.ZodArray<z.ZodObject<{
                        shiftId: z.ZodNumber;
                        reportDate: z.ZodString;
                        userId: z.ZodNumber;
                        name: z.ZodString;
                    }, z.core.$strip>>;
                    pot: z.ZodNullable<z.ZodString>;
                    renewalOf: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
                outcomes: z.ZodArray<z.ZodObject<{
                    outcome: z.ZodEnum<{
                        second: "second";
                        nobody: "nobody";
                        dismiss: "dismiss";
                        first: "first";
                        half: "half";
                    }>;
                    label: z.ZodString;
                    gives: z.ZodArray<z.ZodObject<{
                        userId: z.ZodNumber;
                        mills: z.ZodNumber;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                decision: z.ZodNullable<z.ZodObject<{
                    outcome: z.ZodString;
                    note: z.ZodNullable<z.ZodString>;
                    decidedAt: z.ZodString;
                    by: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
                serverNow: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly saleDisputeOfClaim: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "The owner's dispute of a question carried over from the ledger that names no sale";
        readonly description: "Owner only. Database only.";
        readonly params: z.ZodObject<{
            claimId: z.ZodCoercedNumber<unknown>;
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
            readonly 200: z.ZodObject<{
                sale: z.ZodNullable<z.ZodObject<{
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
                }, z.core.$strip>>;
                home: z.ZodNullable<z.ZodObject<{
                    kind: z.ZodString;
                    reason: z.ZodString;
                    words: z.ZodString;
                    shares: z.ZodArray<z.ZodObject<{
                        userId: z.ZodNumber;
                        name: z.ZodString;
                        mills: z.ZodNumber;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                parties: z.ZodArray<z.ZodObject<{
                    userId: z.ZodNumber;
                    name: z.ZodString;
                    role: z.ZodEnum<{
                        second: "second";
                        first: "first";
                    }>;
                    says: z.ZodArray<z.ZodString>;
                    countedMills: z.ZodNullable<z.ZodNumber>;
                    shiftId: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strip>>;
                claims: z.ZodArray<z.ZodObject<{
                    id: z.ZodNumber;
                    kind: z.ZodEnum<{
                        imported: "imported";
                        claim: "claim";
                        double: "double";
                    }>;
                    transactionId: z.ZodNullable<z.ZodNumber>;
                    pageLabel: z.ZodNullable<z.ZodString>;
                    claimant: z.ZodNullable<z.ZodObject<{
                        userId: z.ZodNumber;
                        name: z.ZodString;
                    }, z.core.$strip>>;
                    statement: z.ZodNullable<z.ZodEnum<{
                        mine: "mine";
                        share: "share";
                    }>>;
                    note: z.ZodNullable<z.ZodString>;
                    claimedAt: z.ZodString;
                    side: z.ZodNullable<z.ZodObject<{
                        userId: z.ZodNumber;
                        name: z.ZodString;
                    }, z.core.$strip>>;
                    sideShiftId: z.ZodNullable<z.ZodNumber>;
                    state: z.ZodEnum<{
                        owner: "owner";
                        withdrawn: "withdrawn";
                        decided: "decided";
                        asked: "asked";
                        agreed: "agreed";
                    }>;
                    answer: z.ZodNullable<z.ZodEnum<{
                        agree: "agree";
                        disagree: "disagree";
                    }>>;
                    answerNote: z.ZodNullable<z.ZodString>;
                    answeredAt: z.ZodNullable<z.ZodString>;
                    escalatedWhy: z.ZodNullable<z.ZodEnum<{
                        imported: "imported";
                        silence: "silence";
                        disagree: "disagree";
                        double: "double";
                        no_side: "no_side";
                    }>>;
                    decision: z.ZodNullable<z.ZodObject<{
                        outcome: z.ZodEnum<{
                            second: "second";
                            imported: "imported";
                            nobody: "nobody";
                            first: "first";
                            half: "half";
                        }>;
                        note: z.ZodNullable<z.ZodString>;
                        decidedAt: z.ZodString;
                    }, z.core.$strip>>;
                    answerBy: z.ZodNullable<z.ZodString>;
                    question: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
                facts: z.ZodNullable<z.ZodObject<{
                    ppv: z.ZodNullable<z.ZodObject<{
                        senderUserId: z.ZodNullable<z.ZodNumber>;
                        senderName: z.ZodNullable<z.ZodString>;
                        sentAt: z.ZodNullable<z.ZodString>;
                        withoutAuthor: z.ZodBoolean;
                    }, z.core.$strip>>;
                    lastWriter: z.ZodNullable<z.ZodObject<{
                        at: z.ZodString;
                        within48h: z.ZodBoolean;
                        userId: z.ZodNumber;
                        name: z.ZodString;
                    }, z.core.$strip>>;
                    writers: z.ZodArray<z.ZodObject<{
                        messages: z.ZodNumber;
                        userId: z.ZodNumber;
                        name: z.ZodString;
                    }, z.core.$strip>>;
                    holders: z.ZodNullable<z.ZodArray<z.ZodObject<{
                        slotRunning: z.ZodNullable<z.ZodBoolean>;
                        userId: z.ZodNumber;
                        name: z.ZodString;
                    }, z.core.$strip>>>;
                    ownSlotRunning: z.ZodNullable<z.ZodBoolean>;
                    otherReports: z.ZodArray<z.ZodObject<{
                        shiftId: z.ZodNumber;
                        reportDate: z.ZodString;
                        userId: z.ZodNumber;
                        name: z.ZodString;
                    }, z.core.$strip>>;
                    pot: z.ZodNullable<z.ZodString>;
                    renewalOf: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
                outcomes: z.ZodArray<z.ZodObject<{
                    outcome: z.ZodEnum<{
                        second: "second";
                        nobody: "nobody";
                        dismiss: "dismiss";
                        first: "first";
                        half: "half";
                    }>;
                    label: z.ZodString;
                    gives: z.ZodArray<z.ZodObject<{
                        userId: z.ZodNumber;
                        mills: z.ZodNumber;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                decision: z.ZodNullable<z.ZodObject<{
                    outcome: z.ZodString;
                    note: z.ZodNullable<z.ZodString>;
                    decidedAt: z.ZodString;
                    by: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
                serverNow: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly saleDisputeDecide: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "The owner decides a dispute: to the first, to the second, in halves, to nobody; who, when and why are kept";
        readonly description: string;
        readonly body: z.ZodObject<{
            transactionId: z.ZodOptional<z.ZodNumber>;
            claimId: z.ZodOptional<z.ZodNumber>;
            outcome: z.ZodEnum<{
                second: "second";
                nobody: "nobody";
                dismiss: "dismiss";
                first: "first";
                half: "half";
            }>;
            note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
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
            readonly 200: z.ZodObject<{
                decided: z.ZodBoolean;
                versions: z.ZodArray<z.ZodObject<{
                    shiftId: z.ZodNumber;
                    version: z.ZodNumber;
                }, z.core.$strip>>;
                savedAt: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly offPlatformPending: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "«Мимо площадки» waiting for the owner, by report";
        readonly description: "Owner only. Database only.";
        readonly querystring: z.ZodObject<{
            shiftId: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
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
            readonly 200: z.ZodObject<{
                reports: z.ZodArray<z.ZodObject<{
                    shiftId: z.ZodNumber;
                    person: z.ZodObject<{
                        userId: z.ZodNumber;
                        name: z.ZodString;
                    }, z.core.$strip>;
                    reportDate: z.ZodString;
                    pages: z.ZodArray<z.ZodString>;
                    totalMills: z.ZodNumber;
                    lines: z.ZodArray<z.ZodObject<{
                        id: z.ZodNumber;
                        amountMills: z.ZodNumber;
                        fromWhom: z.ZodString;
                        whatFor: z.ZodString;
                        addedAt: z.ZodString;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                serverNow: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly offPlatformDecide: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "The owner confirms or rejects a «мимо площадки» line: a confirmed amount counts on a page of the report";
        readonly description: string;
        readonly params: z.ZodObject<{
            offPlatformId: z.ZodCoercedNumber<unknown>;
        }, z.core.$strip>;
        readonly body: z.ZodObject<{
            decision: z.ZodEnum<{
                reject: "reject";
                confirm: "confirm";
            }>;
            pageLabel: z.ZodOptional<z.ZodString>;
            note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
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
            readonly 200: z.ZodObject<{
                state: z.ZodEnum<{
                    rejected: "rejected";
                    confirmed: "confirmed";
                }>;
                version: z.ZodNullable<z.ZodNumber>;
                savedAt: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly saleNobody: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "The week's sales nobody claimed, of the days all of whose shifts are handed in";
        readonly description: "Owner only. Database only.";
        readonly querystring: z.ZodObject<{
            week: z.ZodString;
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
            readonly 200: z.ZodObject<{
                from: z.ZodString;
                to: z.ZodString;
                days: z.ZodArray<z.ZodString>;
                sales: z.ZodArray<z.ZodObject<{
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
                    home: z.ZodString;
                    words: z.ZodString;
                }, z.core.$strip>>;
                totalMills: z.ZodNumber;
                serverNow: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly saleNobodyKeep: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "The owner leaves the week's unclaimed sales nobody's («никому»)";
        readonly description: "Owner only. Each is the owner's decision «никому». Database only.";
        readonly body: z.ZodObject<{
            week: z.ZodString;
            transactionIds: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
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
            readonly 200: z.ZodObject<{
                kept: z.ZodNumber;
                savedAt: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly saleDecisionsUnlinked: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "Decisions carried over from the ledger that its text did not tie to a sale, each with the sales it may be";
        readonly description: "Owner only. Database only.";
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
            readonly 200: z.ZodObject<{
                decisions: z.ZodArray<z.ZodObject<{
                    id: z.ZodNumber;
                    ledgerDecisionId: z.ZodNullable<z.ZodNumber>;
                    pageLabel: z.ZodNullable<z.ZodString>;
                    words: z.ZodString;
                    saidBy: z.ZodNullable<z.ZodString>;
                    shares: z.ZodArray<z.ZodObject<{
                        userId: z.ZodNumber;
                        name: z.ZodString;
                        percent: z.ZodNumber;
                    }, z.core.$strip>>;
                    kind: z.ZodEnum<{
                        split: "split";
                        pot: "pot";
                        nobody: "nobody";
                    }>;
                    candidates: z.ZodArray<z.ZodObject<{
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
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                serverNow: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly saleDecisionLink: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "Tie a decision carried over from the ledger to its sale («привязать»)";
        readonly description: "Owner only. Database only.";
        readonly params: z.ZodObject<{
            decisionId: z.ZodCoercedNumber<unknown>;
        }, z.core.$strip>;
        readonly body: z.ZodObject<{
            transactionId: z.ZodNumber;
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
            readonly 200: z.ZodObject<{
                linked: z.ZodBoolean;
                savedAt: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly agentSaleClaims: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "Decisions and claims of a person or a sale, on the key's pages (needs write:shift_reports or read:team)";
        readonly description: "Database only. What Gengar's memory of «чья продажа» held, from Hub: one line of words with each.";
        readonly querystring: z.ZodObject<{
            person: z.ZodOptional<z.ZodString>;
            telegramUserId: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
            transactionId: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
            scope: z.ZodDefault<z.ZodEnum<{
                all: "all";
                open: "open";
            }>>;
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
            readonly 409: z.ZodObject<{
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
                    kind: z.ZodEnum<{
                        split: "split";
                        pot: "pot";
                        nobody: "nobody";
                    }>;
                    shares: z.ZodArray<z.ZodObject<{
                        person: z.ZodNullable<z.ZodString>;
                        name: z.ZodString;
                        percent: z.ZodNumber;
                    }, z.core.$strip>>;
                    pot: z.ZodNullable<z.ZodString>;
                    outcome: z.ZodString;
                    note: z.ZodNullable<z.ZodString>;
                    saidBy: z.ZodNullable<z.ZodString>;
                    decidedAt: z.ZodString;
                    active: z.ZodBoolean;
                    needsLink: z.ZodBoolean;
                    words: z.ZodString;
                }, z.core.$strip>>;
                claims: z.ZodArray<z.ZodObject<{
                    id: z.ZodNumber;
                    kind: z.ZodEnum<{
                        imported: "imported";
                        claim: "claim";
                        double: "double";
                    }>;
                    transactionId: z.ZodNullable<z.ZodNumber>;
                    pageLabel: z.ZodNullable<z.ZodString>;
                    claimant: z.ZodNullable<z.ZodObject<{
                        userId: z.ZodNumber;
                        name: z.ZodString;
                    }, z.core.$strip>>;
                    statement: z.ZodNullable<z.ZodEnum<{
                        mine: "mine";
                        share: "share";
                    }>>;
                    note: z.ZodNullable<z.ZodString>;
                    claimedAt: z.ZodString;
                    side: z.ZodNullable<z.ZodObject<{
                        userId: z.ZodNumber;
                        name: z.ZodString;
                    }, z.core.$strip>>;
                    sideShiftId: z.ZodNullable<z.ZodNumber>;
                    state: z.ZodEnum<{
                        owner: "owner";
                        withdrawn: "withdrawn";
                        decided: "decided";
                        asked: "asked";
                        agreed: "agreed";
                    }>;
                    answer: z.ZodNullable<z.ZodEnum<{
                        agree: "agree";
                        disagree: "disagree";
                    }>>;
                    answerNote: z.ZodNullable<z.ZodString>;
                    answeredAt: z.ZodNullable<z.ZodString>;
                    escalatedWhy: z.ZodNullable<z.ZodEnum<{
                        imported: "imported";
                        silence: "silence";
                        disagree: "disagree";
                        double: "double";
                        no_side: "no_side";
                    }>>;
                    decision: z.ZodNullable<z.ZodObject<{
                        outcome: z.ZodEnum<{
                            second: "second";
                            imported: "imported";
                            nobody: "nobody";
                            first: "first";
                            half: "half";
                        }>;
                        note: z.ZodNullable<z.ZodString>;
                        decidedAt: z.ZodString;
                    }, z.core.$strip>>;
                    answerBy: z.ZodNullable<z.ZodString>;
                    question: z.ZodNullable<z.ZodString>;
                    netMills: z.ZodNullable<z.ZodNumber>;
                    occurredAt: z.ZodNullable<z.ZodString>;
                    words: z.ZodString;
                }, z.core.$strip>>;
                serverNow: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly agentSaleClaimAnswer: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "Record the other side's answer to a claim «со слов» (needs write:shift_reports)";
        readonly description: "The sender's Telegram id must be the other side's: else 409 `sender_not_person`; the message is required.";
        readonly body: z.ZodObject<{
            answer: z.ZodEnum<{
                agree: "agree";
                disagree: "disagree";
            }>;
            note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            claimId: z.ZodNumber;
            telegramUserId: z.ZodNumber;
            sourceRef: z.ZodString;
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
            readonly 409: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 200: z.ZodObject<{
                claim: z.ZodObject<{
                    id: z.ZodNumber;
                    kind: z.ZodEnum<{
                        imported: "imported";
                        claim: "claim";
                        double: "double";
                    }>;
                    transactionId: z.ZodNullable<z.ZodNumber>;
                    pageLabel: z.ZodNullable<z.ZodString>;
                    claimant: z.ZodNullable<z.ZodObject<{
                        userId: z.ZodNumber;
                        name: z.ZodString;
                    }, z.core.$strip>>;
                    statement: z.ZodNullable<z.ZodEnum<{
                        mine: "mine";
                        share: "share";
                    }>>;
                    note: z.ZodNullable<z.ZodString>;
                    claimedAt: z.ZodString;
                    side: z.ZodNullable<z.ZodObject<{
                        userId: z.ZodNumber;
                        name: z.ZodString;
                    }, z.core.$strip>>;
                    sideShiftId: z.ZodNullable<z.ZodNumber>;
                    state: z.ZodEnum<{
                        owner: "owner";
                        withdrawn: "withdrawn";
                        decided: "decided";
                        asked: "asked";
                        agreed: "agreed";
                    }>;
                    answer: z.ZodNullable<z.ZodEnum<{
                        agree: "agree";
                        disagree: "disagree";
                    }>>;
                    answerNote: z.ZodNullable<z.ZodString>;
                    answeredAt: z.ZodNullable<z.ZodString>;
                    escalatedWhy: z.ZodNullable<z.ZodEnum<{
                        imported: "imported";
                        silence: "silence";
                        disagree: "disagree";
                        double: "double";
                        no_side: "no_side";
                    }>>;
                    decision: z.ZodNullable<z.ZodObject<{
                        outcome: z.ZodEnum<{
                            second: "second";
                            imported: "imported";
                            nobody: "nobody";
                            first: "first";
                            half: "half";
                        }>;
                        note: z.ZodNullable<z.ZodString>;
                        decidedAt: z.ZodString;
                    }, z.core.$strip>>;
                    answerBy: z.ZodNullable<z.ZodString>;
                    question: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>;
                savedAt: z.ZodString;
            }, z.core.$strip>;
        };
    };
};
