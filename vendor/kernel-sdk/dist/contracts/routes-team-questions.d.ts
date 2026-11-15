/**
 * Вопросы тому, кто решает (products plan 2026-11-13 §4.6): a chatter asks before doing what is the decider's to allow;
 * the decider of the page's model (`deciderOf`, services/teams.ts: the team's lead, the owner when there is none or when
 * the lead asks) answers «Можно» or «Нельзя» with a line; the answer comes back to the asker. ONE object, two doors:
 *
 * - Workboard «Ждут вас» → «Спросить» (these operations from a person's session);
 * - the extension's fan panel (a later package): the same two operations, `teamQuestionAsk` with the fan filled in
 *   (`fanRef`, `fanName`, `door: "extension"`) and `teamQuestions` for the panel's own questions — both open to the
 *   narrow session the extension opens; the answer reaches the extension's icon number as the asker's matter
 *   (`question.answered`, `clientMatters`).
 *
 * Answering is a decision: a full session only (never the extension's narrow one). Database only; no money of anyone.
 */
import { z } from "zod";
/**
 * The kinds, in the form's order: скидка больше 50 %, бесплатно платное, цена кастома, условия киту, подмена, опоздание;
 * and «График» (products package W): a lead's proposal of the standing schedule, always the owner's to answer.
 */
export declare const TEAM_QUESTION_KINDS: readonly ["discount_over_50", "free_paid", "custom_price", "whale_terms", "swap", "late", "schedule"];
export type TeamQuestionKind = (typeof TEAM_QUESTION_KINDS)[number];
/** The kinds' words, the same in every door. */
export declare const TEAM_QUESTION_KIND_WORDS: Readonly<Record<TeamQuestionKind, string>>;
/**
 * «Подмена» (products package W, 0422): the day, the pages, the hours of the slot, who covers (a person of the same team)
 * and who cannot come (the asker's person when absent; a lead may ask for a person of their team). Its «Можно» writes the
 * registry's one-day lines of that day: the covering person's on top of their own, the absent person's «off» there.
 */
export declare const teamQuestionSwapBodySchema: z.ZodObject<{
    date: z.ZodString;
    pageLabels: z.ZodArray<z.ZodString>;
    start: z.ZodString;
    end: z.ZodString;
    coverPersonCode: z.ZodString;
    absentPersonCode: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type TeamQuestionSwapBody = z.infer<typeof teamQuestionSwapBodySchema>;
export declare const teamQuestionSwapSchema: z.ZodObject<{
    date: z.ZodString;
    pages: z.ZodArray<z.ZodString>;
    start: z.ZodString;
    end: z.ZodString;
    absent: z.ZodObject<{
        code: z.ZodString;
        name: z.ZodString;
    }, z.core.$strip>;
    cover: z.ZodObject<{
        code: z.ZodString;
        name: z.ZodString;
    }, z.core.$strip>;
    approved: z.ZodBoolean;
    revoked: z.ZodBoolean;
    canRevoke: z.ZodBoolean;
}, z.core.$strip>;
export type TeamQuestionSwap = z.infer<typeof teamQuestionSwapSchema>;
/**
 * The matters of a question, the question service their one writer (an agent key opens or closes none): the decider's
 * «ждёт ответа» (`question.asked`) while it is open, the asker's answer (`question.answered`) until they have read it.
 */
export declare const TEAM_QUESTION_MATTER_KINDS: readonly ["question.asked", "question.answered", "question.cover"];
export declare function isTeamQuestionMatterKind(kind: string): boolean;
export declare const TEAM_QUESTION_STATES: readonly ["open", "answered", "withdrawn"];
export declare const TEAM_QUESTION_ANSWERS: readonly ["yes", "no"];
export declare const teamQuestionSchema: z.ZodObject<{
    id: z.ZodNumber;
    kind: z.ZodEnum<{
        late: "late";
        schedule: "schedule";
        discount_over_50: "discount_over_50";
        free_paid: "free_paid";
        custom_price: "custom_price";
        whale_terms: "whale_terms";
        swap: "swap";
    }>;
    text: z.ZodString;
    pageLabel: z.ZodString;
    fan: z.ZodNullable<z.ZodObject<{
        fanRef: z.ZodNullable<z.ZodString>;
        name: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    asker: z.ZodObject<{
        userId: z.ZodNumber;
        name: z.ZodString;
    }, z.core.$strip>;
    decider: z.ZodObject<{
        kind: z.ZodEnum<{
            owner: "owner";
            team_lead: "team_lead";
        }>;
        name: z.ZodString;
    }, z.core.$strip>;
    door: z.ZodEnum<{
        workboard: "workboard";
        extension: "extension";
    }>;
    askedAt: z.ZodString;
    state: z.ZodEnum<{
        withdrawn: "withdrawn";
        open: "open";
        answered: "answered";
    }>;
    answer: z.ZodNullable<z.ZodEnum<{
        yes: "yes";
        no: "no";
    }>>;
    answerText: z.ZodNullable<z.ZodString>;
    answeredBy: z.ZodNullable<z.ZodString>;
    answeredAt: z.ZodNullable<z.ZodString>;
    seen: z.ZodBoolean;
    canAnswer: z.ZodBoolean;
    mine: z.ZodBoolean;
    swap: z.ZodNullable<z.ZodObject<{
        date: z.ZodString;
        pages: z.ZodArray<z.ZodString>;
        start: z.ZodString;
        end: z.ZodString;
        absent: z.ZodObject<{
            code: z.ZodString;
            name: z.ZodString;
        }, z.core.$strip>;
        cover: z.ZodObject<{
            code: z.ZodString;
            name: z.ZodString;
        }, z.core.$strip>;
        approved: z.ZodBoolean;
        revoked: z.ZodBoolean;
        canRevoke: z.ZodBoolean;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type TeamQuestion = z.infer<typeof teamQuestionSchema>;
export declare const teamQuestionsQuerySchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export declare const teamQuestionsResponseSchema: z.ZodObject<{
    questions: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        kind: z.ZodEnum<{
            late: "late";
            schedule: "schedule";
            discount_over_50: "discount_over_50";
            free_paid: "free_paid";
            custom_price: "custom_price";
            whale_terms: "whale_terms";
            swap: "swap";
        }>;
        text: z.ZodString;
        pageLabel: z.ZodString;
        fan: z.ZodNullable<z.ZodObject<{
            fanRef: z.ZodNullable<z.ZodString>;
            name: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        asker: z.ZodObject<{
            userId: z.ZodNumber;
            name: z.ZodString;
        }, z.core.$strip>;
        decider: z.ZodObject<{
            kind: z.ZodEnum<{
                owner: "owner";
                team_lead: "team_lead";
            }>;
            name: z.ZodString;
        }, z.core.$strip>;
        door: z.ZodEnum<{
            workboard: "workboard";
            extension: "extension";
        }>;
        askedAt: z.ZodString;
        state: z.ZodEnum<{
            withdrawn: "withdrawn";
            open: "open";
            answered: "answered";
        }>;
        answer: z.ZodNullable<z.ZodEnum<{
            yes: "yes";
            no: "no";
        }>>;
        answerText: z.ZodNullable<z.ZodString>;
        answeredBy: z.ZodNullable<z.ZodString>;
        answeredAt: z.ZodNullable<z.ZodString>;
        seen: z.ZodBoolean;
        canAnswer: z.ZodBoolean;
        mine: z.ZodBoolean;
        swap: z.ZodNullable<z.ZodObject<{
            date: z.ZodString;
            pages: z.ZodArray<z.ZodString>;
            start: z.ZodString;
            end: z.ZodString;
            absent: z.ZodObject<{
                code: z.ZodString;
                name: z.ZodString;
            }, z.core.$strip>;
            cover: z.ZodObject<{
                code: z.ZodString;
                name: z.ZodString;
            }, z.core.$strip>;
            approved: z.ZodBoolean;
            revoked: z.ZodBoolean;
            canRevoke: z.ZodBoolean;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export type TeamQuestionsResponse = z.infer<typeof teamQuestionsResponseSchema>;
export declare const teamQuestionAskBodySchema: z.ZodObject<{
    pageLabel: z.ZodString;
    kind: z.ZodEnum<{
        late: "late";
        schedule: "schedule";
        discount_over_50: "discount_over_50";
        free_paid: "free_paid";
        custom_price: "custom_price";
        whale_terms: "whale_terms";
        swap: "swap";
    }>;
    text: z.ZodString;
    fanRef: z.ZodOptional<z.ZodString>;
    fanName: z.ZodOptional<z.ZodString>;
    door: z.ZodDefault<z.ZodEnum<{
        workboard: "workboard";
        extension: "extension";
    }>>;
    swap: z.ZodOptional<z.ZodObject<{
        date: z.ZodString;
        pageLabels: z.ZodArray<z.ZodString>;
        start: z.ZodString;
        end: z.ZodString;
        coverPersonCode: z.ZodString;
        absentPersonCode: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type TeamQuestionAskBody = z.infer<typeof teamQuestionAskBodySchema>;
export declare const teamQuestionAnswerBodySchema: z.ZodObject<{
    answer: z.ZodEnum<{
        yes: "yes";
        no: "no";
    }>;
    text: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type TeamQuestionAnswerBody = z.infer<typeof teamQuestionAnswerBodySchema>;
export declare const teamQuestionCloseBodySchema: z.ZodObject<{
    how: z.ZodEnum<{
        withdraw: "withdraw";
        seen: "seen";
    }>;
}, z.core.$strip>;
export type TeamQuestionCloseBody = z.infer<typeof teamQuestionCloseBodySchema>;
export declare const teamQuestionParamsSchema: z.ZodObject<{
    id: z.ZodCoercedNumber<unknown>;
}, z.core.$strip>;
export declare const teamQuestionWriteResponseSchema: z.ZodObject<{
    question: z.ZodObject<{
        id: z.ZodNumber;
        kind: z.ZodEnum<{
            late: "late";
            schedule: "schedule";
            discount_over_50: "discount_over_50";
            free_paid: "free_paid";
            custom_price: "custom_price";
            whale_terms: "whale_terms";
            swap: "swap";
        }>;
        text: z.ZodString;
        pageLabel: z.ZodString;
        fan: z.ZodNullable<z.ZodObject<{
            fanRef: z.ZodNullable<z.ZodString>;
            name: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        asker: z.ZodObject<{
            userId: z.ZodNumber;
            name: z.ZodString;
        }, z.core.$strip>;
        decider: z.ZodObject<{
            kind: z.ZodEnum<{
                owner: "owner";
                team_lead: "team_lead";
            }>;
            name: z.ZodString;
        }, z.core.$strip>;
        door: z.ZodEnum<{
            workboard: "workboard";
            extension: "extension";
        }>;
        askedAt: z.ZodString;
        state: z.ZodEnum<{
            withdrawn: "withdrawn";
            open: "open";
            answered: "answered";
        }>;
        answer: z.ZodNullable<z.ZodEnum<{
            yes: "yes";
            no: "no";
        }>>;
        answerText: z.ZodNullable<z.ZodString>;
        answeredBy: z.ZodNullable<z.ZodString>;
        answeredAt: z.ZodNullable<z.ZodString>;
        seen: z.ZodBoolean;
        canAnswer: z.ZodBoolean;
        mine: z.ZodBoolean;
        swap: z.ZodNullable<z.ZodObject<{
            date: z.ZodString;
            pages: z.ZodArray<z.ZodString>;
            start: z.ZodString;
            end: z.ZodString;
            absent: z.ZodObject<{
                code: z.ZodString;
                name: z.ZodString;
            }, z.core.$strip>;
            cover: z.ZodObject<{
                code: z.ZodString;
                name: z.ZodString;
            }, z.core.$strip>;
            approved: z.ZodBoolean;
            revoked: z.ZodBoolean;
            canRevoke: z.ZodBoolean;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    savedAt: z.ZodString;
}, z.core.$strip>;
export type TeamQuestionWriteResponse = z.infer<typeof teamQuestionWriteResponseSchema>;
/** «График»'s swaps of the days ahead (products package W): the approved ones whose lines stand, on the viewer's teams' pages. */
export declare const teamSwapsResponseSchema: z.ZodObject<{
    swaps: z.ZodArray<z.ZodObject<{
        date: z.ZodString;
        pages: z.ZodArray<z.ZodString>;
        start: z.ZodString;
        end: z.ZodString;
        absent: z.ZodObject<{
            code: z.ZodString;
            name: z.ZodString;
        }, z.core.$strip>;
        cover: z.ZodObject<{
            code: z.ZodString;
            name: z.ZodString;
        }, z.core.$strip>;
        approved: z.ZodBoolean;
        revoked: z.ZodBoolean;
        canRevoke: z.ZodBoolean;
        questionId: z.ZodNumber;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export type TeamSwapsResponse = z.infer<typeof teamSwapsResponseSchema>;
export declare const teamQuestionRouteSchemas: {
    readonly teamQuestions: {
        readonly auth: {
            readonly kind: "any-session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "The viewer's questions to whoever decides, and those waiting for their answer";
        readonly description: string;
        readonly querystring: z.ZodObject<{
            id: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
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
                questions: z.ZodArray<z.ZodObject<{
                    id: z.ZodNumber;
                    kind: z.ZodEnum<{
                        late: "late";
                        schedule: "schedule";
                        discount_over_50: "discount_over_50";
                        free_paid: "free_paid";
                        custom_price: "custom_price";
                        whale_terms: "whale_terms";
                        swap: "swap";
                    }>;
                    text: z.ZodString;
                    pageLabel: z.ZodString;
                    fan: z.ZodNullable<z.ZodObject<{
                        fanRef: z.ZodNullable<z.ZodString>;
                        name: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                    asker: z.ZodObject<{
                        userId: z.ZodNumber;
                        name: z.ZodString;
                    }, z.core.$strip>;
                    decider: z.ZodObject<{
                        kind: z.ZodEnum<{
                            owner: "owner";
                            team_lead: "team_lead";
                        }>;
                        name: z.ZodString;
                    }, z.core.$strip>;
                    door: z.ZodEnum<{
                        workboard: "workboard";
                        extension: "extension";
                    }>;
                    askedAt: z.ZodString;
                    state: z.ZodEnum<{
                        withdrawn: "withdrawn";
                        open: "open";
                        answered: "answered";
                    }>;
                    answer: z.ZodNullable<z.ZodEnum<{
                        yes: "yes";
                        no: "no";
                    }>>;
                    answerText: z.ZodNullable<z.ZodString>;
                    answeredBy: z.ZodNullable<z.ZodString>;
                    answeredAt: z.ZodNullable<z.ZodString>;
                    seen: z.ZodBoolean;
                    canAnswer: z.ZodBoolean;
                    mine: z.ZodBoolean;
                    swap: z.ZodNullable<z.ZodObject<{
                        date: z.ZodString;
                        pages: z.ZodArray<z.ZodString>;
                        start: z.ZodString;
                        end: z.ZodString;
                        absent: z.ZodObject<{
                            code: z.ZodString;
                            name: z.ZodString;
                        }, z.core.$strip>;
                        cover: z.ZodObject<{
                            code: z.ZodString;
                            name: z.ZodString;
                        }, z.core.$strip>;
                        approved: z.ZodBoolean;
                        revoked: z.ZodBoolean;
                        canRevoke: z.ZodBoolean;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                serverNow: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly teamQuestionAsk: {
        readonly auth: {
            readonly kind: "any";
        };
        readonly tags: readonly ["client"];
        readonly summary: "Ask whoever decides: a kind, the fan when there is one, one line";
        readonly description: string;
        readonly body: z.ZodObject<{
            pageLabel: z.ZodString;
            kind: z.ZodEnum<{
                late: "late";
                schedule: "schedule";
                discount_over_50: "discount_over_50";
                free_paid: "free_paid";
                custom_price: "custom_price";
                whale_terms: "whale_terms";
                swap: "swap";
            }>;
            text: z.ZodString;
            fanRef: z.ZodOptional<z.ZodString>;
            fanName: z.ZodOptional<z.ZodString>;
            door: z.ZodDefault<z.ZodEnum<{
                workboard: "workboard";
                extension: "extension";
            }>>;
            swap: z.ZodOptional<z.ZodObject<{
                date: z.ZodString;
                pageLabels: z.ZodArray<z.ZodString>;
                start: z.ZodString;
                end: z.ZodString;
                coverPersonCode: z.ZodString;
                absentPersonCode: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
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
                question: z.ZodObject<{
                    id: z.ZodNumber;
                    kind: z.ZodEnum<{
                        late: "late";
                        schedule: "schedule";
                        discount_over_50: "discount_over_50";
                        free_paid: "free_paid";
                        custom_price: "custom_price";
                        whale_terms: "whale_terms";
                        swap: "swap";
                    }>;
                    text: z.ZodString;
                    pageLabel: z.ZodString;
                    fan: z.ZodNullable<z.ZodObject<{
                        fanRef: z.ZodNullable<z.ZodString>;
                        name: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                    asker: z.ZodObject<{
                        userId: z.ZodNumber;
                        name: z.ZodString;
                    }, z.core.$strip>;
                    decider: z.ZodObject<{
                        kind: z.ZodEnum<{
                            owner: "owner";
                            team_lead: "team_lead";
                        }>;
                        name: z.ZodString;
                    }, z.core.$strip>;
                    door: z.ZodEnum<{
                        workboard: "workboard";
                        extension: "extension";
                    }>;
                    askedAt: z.ZodString;
                    state: z.ZodEnum<{
                        withdrawn: "withdrawn";
                        open: "open";
                        answered: "answered";
                    }>;
                    answer: z.ZodNullable<z.ZodEnum<{
                        yes: "yes";
                        no: "no";
                    }>>;
                    answerText: z.ZodNullable<z.ZodString>;
                    answeredBy: z.ZodNullable<z.ZodString>;
                    answeredAt: z.ZodNullable<z.ZodString>;
                    seen: z.ZodBoolean;
                    canAnswer: z.ZodBoolean;
                    mine: z.ZodBoolean;
                    swap: z.ZodNullable<z.ZodObject<{
                        date: z.ZodString;
                        pages: z.ZodArray<z.ZodString>;
                        start: z.ZodString;
                        end: z.ZodString;
                        absent: z.ZodObject<{
                            code: z.ZodString;
                            name: z.ZodString;
                        }, z.core.$strip>;
                        cover: z.ZodObject<{
                            code: z.ZodString;
                            name: z.ZodString;
                        }, z.core.$strip>;
                        approved: z.ZodBoolean;
                        revoked: z.ZodBoolean;
                        canRevoke: z.ZodBoolean;
                    }, z.core.$strip>>;
                }, z.core.$strip>;
                savedAt: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly teamQuestionAnswer: {
        readonly auth: {
            readonly kind: "any-session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "Answer a question «Можно» or «Нельзя», with a line";
        readonly description: string;
        readonly params: z.ZodObject<{
            id: z.ZodCoercedNumber<unknown>;
        }, z.core.$strip>;
        readonly body: z.ZodObject<{
            answer: z.ZodEnum<{
                yes: "yes";
                no: "no";
            }>;
            text: z.ZodOptional<z.ZodString>;
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
                question: z.ZodObject<{
                    id: z.ZodNumber;
                    kind: z.ZodEnum<{
                        late: "late";
                        schedule: "schedule";
                        discount_over_50: "discount_over_50";
                        free_paid: "free_paid";
                        custom_price: "custom_price";
                        whale_terms: "whale_terms";
                        swap: "swap";
                    }>;
                    text: z.ZodString;
                    pageLabel: z.ZodString;
                    fan: z.ZodNullable<z.ZodObject<{
                        fanRef: z.ZodNullable<z.ZodString>;
                        name: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                    asker: z.ZodObject<{
                        userId: z.ZodNumber;
                        name: z.ZodString;
                    }, z.core.$strip>;
                    decider: z.ZodObject<{
                        kind: z.ZodEnum<{
                            owner: "owner";
                            team_lead: "team_lead";
                        }>;
                        name: z.ZodString;
                    }, z.core.$strip>;
                    door: z.ZodEnum<{
                        workboard: "workboard";
                        extension: "extension";
                    }>;
                    askedAt: z.ZodString;
                    state: z.ZodEnum<{
                        withdrawn: "withdrawn";
                        open: "open";
                        answered: "answered";
                    }>;
                    answer: z.ZodNullable<z.ZodEnum<{
                        yes: "yes";
                        no: "no";
                    }>>;
                    answerText: z.ZodNullable<z.ZodString>;
                    answeredBy: z.ZodNullable<z.ZodString>;
                    answeredAt: z.ZodNullable<z.ZodString>;
                    seen: z.ZodBoolean;
                    canAnswer: z.ZodBoolean;
                    mine: z.ZodBoolean;
                    swap: z.ZodNullable<z.ZodObject<{
                        date: z.ZodString;
                        pages: z.ZodArray<z.ZodString>;
                        start: z.ZodString;
                        end: z.ZodString;
                        absent: z.ZodObject<{
                            code: z.ZodString;
                            name: z.ZodString;
                        }, z.core.$strip>;
                        cover: z.ZodObject<{
                            code: z.ZodString;
                            name: z.ZodString;
                        }, z.core.$strip>;
                        approved: z.ZodBoolean;
                        revoked: z.ZodBoolean;
                        canRevoke: z.ZodBoolean;
                    }, z.core.$strip>>;
                }, z.core.$strip>;
                savedAt: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly teamQuestionClose: {
        readonly auth: {
            readonly kind: "any-session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "The asker withdraws an open question, or marks the answer read";
        readonly description: "The asker only; the narrow session too. Closes the matter it opened.";
        readonly params: z.ZodObject<{
            id: z.ZodCoercedNumber<unknown>;
        }, z.core.$strip>;
        readonly body: z.ZodObject<{
            how: z.ZodEnum<{
                withdraw: "withdraw";
                seen: "seen";
            }>;
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
                question: z.ZodObject<{
                    id: z.ZodNumber;
                    kind: z.ZodEnum<{
                        late: "late";
                        schedule: "schedule";
                        discount_over_50: "discount_over_50";
                        free_paid: "free_paid";
                        custom_price: "custom_price";
                        whale_terms: "whale_terms";
                        swap: "swap";
                    }>;
                    text: z.ZodString;
                    pageLabel: z.ZodString;
                    fan: z.ZodNullable<z.ZodObject<{
                        fanRef: z.ZodNullable<z.ZodString>;
                        name: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                    asker: z.ZodObject<{
                        userId: z.ZodNumber;
                        name: z.ZodString;
                    }, z.core.$strip>;
                    decider: z.ZodObject<{
                        kind: z.ZodEnum<{
                            owner: "owner";
                            team_lead: "team_lead";
                        }>;
                        name: z.ZodString;
                    }, z.core.$strip>;
                    door: z.ZodEnum<{
                        workboard: "workboard";
                        extension: "extension";
                    }>;
                    askedAt: z.ZodString;
                    state: z.ZodEnum<{
                        withdrawn: "withdrawn";
                        open: "open";
                        answered: "answered";
                    }>;
                    answer: z.ZodNullable<z.ZodEnum<{
                        yes: "yes";
                        no: "no";
                    }>>;
                    answerText: z.ZodNullable<z.ZodString>;
                    answeredBy: z.ZodNullable<z.ZodString>;
                    answeredAt: z.ZodNullable<z.ZodString>;
                    seen: z.ZodBoolean;
                    canAnswer: z.ZodBoolean;
                    mine: z.ZodBoolean;
                    swap: z.ZodNullable<z.ZodObject<{
                        date: z.ZodString;
                        pages: z.ZodArray<z.ZodString>;
                        start: z.ZodString;
                        end: z.ZodString;
                        absent: z.ZodObject<{
                            code: z.ZodString;
                            name: z.ZodString;
                        }, z.core.$strip>;
                        cover: z.ZodObject<{
                            code: z.ZodString;
                            name: z.ZodString;
                        }, z.core.$strip>;
                        approved: z.ZodBoolean;
                        revoked: z.ZodBoolean;
                        canRevoke: z.ZodBoolean;
                    }, z.core.$strip>>;
                }, z.core.$strip>;
                savedAt: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly teamSwaps: {
        readonly auth: {
            readonly kind: "any-session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "«График»: the approved swaps of the next 14 days on the viewer's teams' pages";
        readonly description: string;
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
                swaps: z.ZodArray<z.ZodObject<{
                    date: z.ZodString;
                    pages: z.ZodArray<z.ZodString>;
                    start: z.ZodString;
                    end: z.ZodString;
                    absent: z.ZodObject<{
                        code: z.ZodString;
                        name: z.ZodString;
                    }, z.core.$strip>;
                    cover: z.ZodObject<{
                        code: z.ZodString;
                        name: z.ZodString;
                    }, z.core.$strip>;
                    approved: z.ZodBoolean;
                    revoked: z.ZodBoolean;
                    canRevoke: z.ZodBoolean;
                    questionId: z.ZodNumber;
                }, z.core.$strip>>;
                serverNow: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly teamSwapRevoke: {
        readonly auth: {
            readonly kind: "any-session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "Take an approved swap back before its day: its one-day lines are marked taken back, nothing is deleted";
        readonly description: "The swap's decider or the owner, a full session. The asker's answer matter says it.";
        readonly params: z.ZodObject<{
            id: z.ZodCoercedNumber<unknown>;
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
                question: z.ZodObject<{
                    id: z.ZodNumber;
                    kind: z.ZodEnum<{
                        late: "late";
                        schedule: "schedule";
                        discount_over_50: "discount_over_50";
                        free_paid: "free_paid";
                        custom_price: "custom_price";
                        whale_terms: "whale_terms";
                        swap: "swap";
                    }>;
                    text: z.ZodString;
                    pageLabel: z.ZodString;
                    fan: z.ZodNullable<z.ZodObject<{
                        fanRef: z.ZodNullable<z.ZodString>;
                        name: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                    asker: z.ZodObject<{
                        userId: z.ZodNumber;
                        name: z.ZodString;
                    }, z.core.$strip>;
                    decider: z.ZodObject<{
                        kind: z.ZodEnum<{
                            owner: "owner";
                            team_lead: "team_lead";
                        }>;
                        name: z.ZodString;
                    }, z.core.$strip>;
                    door: z.ZodEnum<{
                        workboard: "workboard";
                        extension: "extension";
                    }>;
                    askedAt: z.ZodString;
                    state: z.ZodEnum<{
                        withdrawn: "withdrawn";
                        open: "open";
                        answered: "answered";
                    }>;
                    answer: z.ZodNullable<z.ZodEnum<{
                        yes: "yes";
                        no: "no";
                    }>>;
                    answerText: z.ZodNullable<z.ZodString>;
                    answeredBy: z.ZodNullable<z.ZodString>;
                    answeredAt: z.ZodNullable<z.ZodString>;
                    seen: z.ZodBoolean;
                    canAnswer: z.ZodBoolean;
                    mine: z.ZodBoolean;
                    swap: z.ZodNullable<z.ZodObject<{
                        date: z.ZodString;
                        pages: z.ZodArray<z.ZodString>;
                        start: z.ZodString;
                        end: z.ZodString;
                        absent: z.ZodObject<{
                            code: z.ZodString;
                            name: z.ZodString;
                        }, z.core.$strip>;
                        cover: z.ZodObject<{
                            code: z.ZodString;
                            name: z.ZodString;
                        }, z.core.$strip>;
                        approved: z.ZodBoolean;
                        revoked: z.ZodBoolean;
                        canRevoke: z.ZodBoolean;
                    }, z.core.$strip>>;
                }, z.core.$strip>;
                savedAt: z.ZodString;
            }, z.core.$strip>;
        };
    };
};
