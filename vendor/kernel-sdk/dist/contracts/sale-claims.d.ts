/**
 * Заявки и договорённости (ecosystem plan 2026-11-12, package G): a claim — a
 * statement of a handed-in report that touches another person — as a person
 * and the owner read it, and the kinds of the matters it opens. The routes are
 * routes-sale-claims.ts; the shift report carries the claims of its lines.
 */
import { z } from "zod";
/**
 * The kinds of package G's own matters, the server their one writer: the other side's «X считает своей …» (`sale.claim`),
 * the owner's dispute of a sale (`sale.dispute`), the owner's weekly line of sales nobody claimed (`sale.nobody_week`),
 * a report's «мимо площадки» waiting for the owner (`off_platform.pending`), the decisions carried over from the ledger
 * that wait to be tied to a sale (`sale.decisions.unlinked`). Kept apart from MATTER_SERVER_KINDS (as the shift report's):
 * «Состояние» closes every open matter of those that its own pass did not find. An agent key may open none of them.
 */
export declare const SALE_CLAIM_MATTER_KINDS: readonly ["sale.claim", "sale.dispute", "sale.nobody_week", "off_platform.pending", "sale.decisions.unlinked"];
export declare function isSaleClaimMatterKind(kind: string): boolean;
export declare const SALE_CLAIM_STATES: readonly ["asked", "agreed", "owner", "decided", "withdrawn"];
export declare const SALE_CLAIM_ANSWERS: readonly ["agree", "disagree"];
export declare const SALE_DISPUTE_OUTCOMES: readonly ["first", "second", "half", "nobody"];
/** «Закрыть без решения»: only a question carried over from the ledger whose people Hub could not tell. */
export declare const SALE_DISPUTE_OUTCOMES_WITH_DISMISS: readonly ["first", "second", "half", "nobody", "dismiss"];
export declare const saleClaimStateEnum: z.ZodEnum<{
    owner: "owner";
    withdrawn: "withdrawn";
    decided: "decided";
    asked: "asked";
    agreed: "agreed";
}>;
export declare const saleClaimAnswerEnum: z.ZodEnum<{
    agree: "agree";
    disagree: "disagree";
}>;
/** One claim as a person reads it on their shift report, or the owner in a dispute. */
export declare const saleClaimSchema: z.ZodObject<{
    id: z.ZodNumber;
    kind: z.ZodEnum<{
        imported: "imported";
        claim: "claim";
        question: "question";
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
        question: "question";
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
            said: "said";
        }>;
        note: z.ZodNullable<z.ZodString>;
        decidedAt: z.ZodString;
    }, z.core.$strip>>;
    answerBy: z.ZodNullable<z.ZodString>;
    question: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/** On the shift screen: the claims of the report's lines — incoming (someone claims what is yours) and outgoing (yours). */
export declare const shiftReportClaimSchema: z.ZodObject<{
    id: z.ZodNumber;
    kind: z.ZodEnum<{
        imported: "imported";
        claim: "claim";
        question: "question";
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
        question: "question";
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
            said: "said";
        }>;
        note: z.ZodNullable<z.ZodString>;
        decidedAt: z.ZodString;
    }, z.core.$strip>>;
    answerBy: z.ZodNullable<z.ZodString>;
    question: z.ZodNullable<z.ZodString>;
    direction: z.ZodEnum<{
        other: "other";
        incoming: "incoming";
        outgoing: "outgoing";
    }>;
    canAnswer: z.ZodBoolean;
    sale: z.ZodNullable<z.ZodObject<{
        kind: z.ZodString;
        occurredAt: z.ZodString;
        netMills: z.ZodNumber;
        fan: z.ZodObject<{
            fanRef: z.ZodNullable<z.ZodString>;
            name: z.ZodNullable<z.ZodString>;
            username: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type SaleClaim = z.infer<typeof saleClaimSchema>;
export type ShiftReportClaim = z.infer<typeof shiftReportClaimSchema>;
