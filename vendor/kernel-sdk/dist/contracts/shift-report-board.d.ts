/**
 * The «Отчёт» board (products plan 2026-11-13, package R): what `shiftReport` answers in `board` so the screen draws a
 * whole shift — a column per page, rows as the sites' own lists, the phase — without a second request per row. The
 * approved prototype is `8-docs/2026-11-13-products/report-panel-mockups/columns.html`; its words are taken verbatim.
 *
 * Phases: draft («Черновик») → «Сдать смену» records a CANDIDATE, checking («Проверка»: Hub and Gengar check it, 10
 * minutes at most) → confirm («Подтвердите»: the person signs the candidate again, Gengar's proposals that are not
 * declined applied) → counted («Учтён»: a version exists, the ledger sees it) → fixing («Правка»: the counted version
 * stands until a new one is confirmed). Only the person confirms; no agent door has a confirm.
 *
 * Everything is behind the person's right `submits_shift` (off for everyone in production).
 */
import { z } from "zod";
export declare const SHIFT_REPORT_PHASES: readonly ["draft", "checking", "confirm", "counted", "fixing"];
export declare const shiftReportPhaseEnum: z.ZodEnum<{
    draft: "draft";
    checking: "checking";
    confirm: "confirm";
    counted: "counted";
    fixing: "fixing";
}>;
export type ShiftReportPhase = z.infer<typeof shiftReportPhaseEnum>;
/** The chip of each phase, as the prototype writes it. */
export declare const SHIFT_REPORT_PHASE_CHIPS: Record<ShiftReportPhase, string>;
/**
 * The person's words on a sale of the board (the marks): the ledger's three (`mine`, `not_mine`, `share`) and two of
 * one's own sale — `give` (to a colleague: settled at once in their favour) and `pot` (no longer mine; the owner
 * decides whether it joins a pot). A version's line in the ledger's feed keeps the three words: `give` and `pot` read
 * there as `not_mine` (the line counts nothing for the person), the feed's format does not change.
 */
export declare const SHIFT_REPORT_WORDS: readonly ["mine", "not_mine", "share", "give", "pot"];
export declare const shiftReportWordEnum: z.ZodEnum<{
    mine: "mine";
    not_mine: "not_mine";
    share: "share";
    give: "give";
    pot: "pot";
}>;
export type ShiftReportWord = z.infer<typeof shiftReportWordEnum>;
/** How long the check may hold the person: after this the server's timer moves `checking` to `confirm`. */
export declare const SHIFT_REPORT_CHECK_MINUTES = 10;
/** A question to a colleague unanswered this long settles for the one who asked (a pot question never does). */
export declare const SHIFT_REPORT_ASK_SILENCE_HOURS = 24;
/** A row of the person's own from this sum without a comment is pointed at («Без комментария: N продаж от $30»). */
export declare const SHIFT_REPORT_BARE_NOTE_FROM_MILLS = 30000;
/** The quick words of a sale's comment; each one appends to the text. */
export declare const SHIFT_REPORT_QUICK_WORDS: readonly ["торг", "кастом", "голосовое", "допродажа"];
/** A sighting still not in Hub this long after it was seen goes to the decider. */
export declare const SALE_SIGHTING_UNMATCHED_HOURS = 48;
/**
 * A person's name in the cases the board's texts need: «Спросить Олега», «Пополам с Олегом», «Вопрос ушёл Олегу». A
 * plain rule for Russian first names (a name in Latin letters, or one the rule does not know, stays as it is).
 */
export declare const personNameFormsSchema: z.ZodObject<{
    nom: z.ZodString;
    gen: z.ZodString;
    acc: z.ZodString;
    ins: z.ZodString;
    dat: z.ZodString;
}, z.core.$strip>;
export type PersonNameForms = z.infer<typeof personNameFormsSchema>;
export declare function personNameForms(name: string): PersonNameForms;
/**
 * Whose a sale is, as the board says it: `me` — the shift's person («моя»); `share` — half with `userId`
 * («пополам с Севой»); `user` — a colleague's («Олега»); `pot` («общак»); `nobody` («ничья»); `waiting` — a PPV that
 * waits for its sender's shift; `decide` — the owner decides by the rule (the shift's boundary, nobody wrote).
 */
export declare const shiftReportOwnerSchema: z.ZodObject<{
    kind: z.ZodEnum<{
        me: "me";
        share: "share";
        pot: "pot";
        user: "user";
        nobody: "nobody";
        waiting: "waiting";
        decide: "decide";
    }>;
    userId: z.ZodNullable<z.ZodNumber>;
    name: z.ZodNullable<z.ZodString>;
    words: z.ZodString;
}, z.core.$strip>;
export type ShiftReportOwner = z.infer<typeof shiftReportOwnerSchema>;
/** A question asked from the draft («Почему продажа ваша?» → «Спросить Олега» / «Спросить владельца»). */
export declare const shiftReportAskSchema: z.ZodObject<{
    claimId: z.ZodNumber;
    to: z.ZodEnum<{
        owner: "owner";
        colleague: "colleague";
    }>;
    toUser: z.ZodNullable<z.ZodObject<{
        userId: z.ZodNumber;
        name: z.ZodString;
        forms: z.ZodObject<{
            nom: z.ZodString;
            gen: z.ZodString;
            acc: z.ZodString;
            ins: z.ZodString;
            dat: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>>;
    want: z.ZodObject<{
        kind: z.ZodEnum<{
            me: "me";
            share: "share";
            pot: "pot";
            user: "user";
            nobody: "nobody";
            waiting: "waiting";
            decide: "decide";
        }>;
        userId: z.ZodNullable<z.ZodNumber>;
        name: z.ZodNullable<z.ZodString>;
        words: z.ZodString;
    }, z.core.$strip>;
    note: z.ZodString;
    state: z.ZodEnum<{
        withdrawn: "withdrawn";
        asked: "asked";
        agreed: "agreed";
        disputed: "disputed";
        silence: "silence";
        decided: "decided";
    }>;
    answerNote: z.ZodNullable<z.ZodString>;
    answerBy: z.ZodNullable<z.ZodString>;
    decision: z.ZodNullable<z.ZodString>;
    oldWay: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
/** Someone claims a sale of the person: the amber strip under the row, answered «Согласен» / «Не согласен». */
export declare const shiftReportIncomingSchema: z.ZodObject<{
    claimId: z.ZodNumber;
    from: z.ZodObject<{
        userId: z.ZodNumber;
        name: z.ZodString;
        forms: z.ZodObject<{
            nom: z.ZodString;
            gen: z.ZodString;
            acc: z.ZodString;
            ins: z.ZodString;
            dat: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>;
    statement: z.ZodEnum<{
        mine: "mine";
        share: "share";
    }>;
    note: z.ZodNullable<z.ZodString>;
    state: z.ZodEnum<{
        asked: "asked";
        disputed: "disputed";
        settled: "settled";
    }>;
    canAnswer: z.ZodBoolean;
    answer: z.ZodNullable<z.ZodEnum<{
        agree: "agree";
        disagree: "disagree";
    }>>;
    answerBy: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/** Gengar's proposal for a sale of the candidate: a card under the row. */
export declare const shiftReportProposalSchema: z.ZodObject<{
    id: z.ZodNumber;
    kind: z.ZodEnum<{
        note: "note";
        owner_change: "owner_change";
    }>;
    from: z.ZodNullable<z.ZodObject<{
        kind: z.ZodEnum<{
            me: "me";
            share: "share";
            pot: "pot";
            user: "user";
            nobody: "nobody";
            waiting: "waiting";
            decide: "decide";
        }>;
        userId: z.ZodNullable<z.ZodNumber>;
        name: z.ZodNullable<z.ZodString>;
        words: z.ZodString;
    }, z.core.$strip>>;
    to: z.ZodNullable<z.ZodObject<{
        kind: z.ZodEnum<{
            me: "me";
            share: "share";
            pot: "pot";
            user: "user";
            nobody: "nobody";
            waiting: "waiting";
            decide: "decide";
        }>;
        userId: z.ZodNullable<z.ZodNumber>;
        name: z.ZodNullable<z.ZodString>;
        words: z.ZodString;
    }, z.core.$strip>>;
    note: z.ZodNullable<z.ZodString>;
    deltaMills: z.ZodNumber;
    why: z.ZodString;
    state: z.ZodEnum<{
        accepted: "accepted";
        proposed: "proposed";
        declined: "declined";
        late: "late";
    }>;
    afterCounted: z.ZodBoolean;
    by: z.ZodString;
}, z.core.$strip>;
/** «Нет в Hub»: a sale the site showed that Hub does not hold. */
export declare const shiftReportSightingSchema: z.ZodObject<{
    id: z.ZodNumber;
    seenAt: z.ZodString;
    added: z.ZodBoolean;
}, z.core.$strip>;
export declare const shiftReportRowNoteSchema: z.ZodObject<{
    text: z.ZodString;
    by: z.ZodEnum<{
        other: "other";
        agent: "agent";
        person: "person";
    }>;
    byName: z.ZodString;
}, z.core.$strip>;
/**
 * One item of a row's «чья» menu, as the server decides it: on someone else's sale only «Моя» and «Пополам с <держатель>»;
 * on one's own «Моя», «Пополам с <каждый коллега>», «<коллега>» (отдать), «Общак», «Ничья».
 */
export declare const shiftReportChoiceSchema: z.ZodObject<{
    owner: z.ZodObject<{
        kind: z.ZodEnum<{
            me: "me";
            share: "share";
            pot: "pot";
            user: "user";
            nobody: "nobody";
            waiting: "waiting";
            decide: "decide";
        }>;
        userId: z.ZodNullable<z.ZodNumber>;
        name: z.ZodNullable<z.ZodString>;
        words: z.ZodString;
    }, z.core.$strip>;
    asks: z.ZodNullable<z.ZodObject<{
        to: z.ZodEnum<{
            colleague: "colleague";
            decider: "decider";
        }>;
        user: z.ZodNullable<z.ZodObject<{
            userId: z.ZodNumber;
            name: z.ZodString;
            forms: z.ZodObject<{
                nom: z.ZodString;
                gen: z.ZodString;
                acc: z.ZodString;
                ins: z.ZodString;
                dat: z.ZodString;
            }, z.core.$strip>;
        }, z.core.$strip>>;
        words: z.ZodString;
    }, z.core.$strip>>;
    hint: z.ZodString;
    current: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
/** One row of a column: two lines, never more; the question, the claim, the card and the comment go under it. */
export declare const shiftReportRowSchema: z.ZodObject<{
    key: z.ZodString;
    transactionId: z.ZodNullable<z.ZodNumber>;
    pageLabel: z.ZodString;
    platform: z.ZodEnum<{
        fansly: "fansly";
        onlyfans: "onlyfans";
    }>;
    platformRef: z.ZodNullable<z.ZodString>;
    refLabel: z.ZodNullable<z.ZodString>;
    kind: z.ZodString;
    siteWords: z.ZodString;
    fan: z.ZodObject<{
        fanRef: z.ZodNullable<z.ZodString>;
        name: z.ZodNullable<z.ZodString>;
        username: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
    occurredAt: z.ZodString;
    netMills: z.ZodNumber;
    grossMills: z.ZodNullable<z.ZodNumber>;
    rule: z.ZodObject<{
        owner: z.ZodObject<{
            kind: z.ZodEnum<{
                me: "me";
                share: "share";
                pot: "pot";
                user: "user";
                nobody: "nobody";
                waiting: "waiting";
                decide: "decide";
            }>;
            userId: z.ZodNullable<z.ZodNumber>;
            name: z.ZodNullable<z.ZodString>;
            words: z.ZodString;
        }, z.core.$strip>;
        reason: z.ZodString;
        words: z.ZodString;
    }, z.core.$strip>;
    owner: z.ZodObject<{
        kind: z.ZodEnum<{
            me: "me";
            share: "share";
            pot: "pot";
            user: "user";
            nobody: "nobody";
            waiting: "waiting";
            decide: "decide";
        }>;
        userId: z.ZodNullable<z.ZodNumber>;
        name: z.ZodNullable<z.ZodString>;
        words: z.ZodString;
    }, z.core.$strip>;
    statement: z.ZodNullable<z.ZodEnum<{
        mine: "mine";
        not_mine: "not_mine";
        share: "share";
        give: "give";
        pot: "pot";
    }>>;
    reasonWords: z.ZodString;
    ticked: z.ZodBoolean;
    amountMills: z.ZodNumber;
    before: z.ZodNullable<z.ZodObject<{
        user: z.ZodNullable<z.ZodObject<{
            userId: z.ZodNumber;
            name: z.ZodString;
            forms: z.ZodObject<{
                nom: z.ZodString;
                gen: z.ZodString;
                acc: z.ZodString;
                ins: z.ZodString;
                dat: z.ZodString;
            }, z.core.$strip>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    late: z.ZodBoolean;
    ask: z.ZodNullable<z.ZodObject<{
        claimId: z.ZodNumber;
        to: z.ZodEnum<{
            owner: "owner";
            colleague: "colleague";
        }>;
        toUser: z.ZodNullable<z.ZodObject<{
            userId: z.ZodNumber;
            name: z.ZodString;
            forms: z.ZodObject<{
                nom: z.ZodString;
                gen: z.ZodString;
                acc: z.ZodString;
                ins: z.ZodString;
                dat: z.ZodString;
            }, z.core.$strip>;
        }, z.core.$strip>>;
        want: z.ZodObject<{
            kind: z.ZodEnum<{
                me: "me";
                share: "share";
                pot: "pot";
                user: "user";
                nobody: "nobody";
                waiting: "waiting";
                decide: "decide";
            }>;
            userId: z.ZodNullable<z.ZodNumber>;
            name: z.ZodNullable<z.ZodString>;
            words: z.ZodString;
        }, z.core.$strip>;
        note: z.ZodString;
        state: z.ZodEnum<{
            withdrawn: "withdrawn";
            asked: "asked";
            agreed: "agreed";
            disputed: "disputed";
            silence: "silence";
            decided: "decided";
        }>;
        answerNote: z.ZodNullable<z.ZodString>;
        answerBy: z.ZodNullable<z.ZodString>;
        decision: z.ZodNullable<z.ZodString>;
        oldWay: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
    incoming: z.ZodNullable<z.ZodObject<{
        claimId: z.ZodNumber;
        from: z.ZodObject<{
            userId: z.ZodNumber;
            name: z.ZodString;
            forms: z.ZodObject<{
                nom: z.ZodString;
                gen: z.ZodString;
                acc: z.ZodString;
                ins: z.ZodString;
                dat: z.ZodString;
            }, z.core.$strip>;
        }, z.core.$strip>;
        statement: z.ZodEnum<{
            mine: "mine";
            share: "share";
        }>;
        note: z.ZodNullable<z.ZodString>;
        state: z.ZodEnum<{
            asked: "asked";
            disputed: "disputed";
            settled: "settled";
        }>;
        canAnswer: z.ZodBoolean;
        answer: z.ZodNullable<z.ZodEnum<{
            agree: "agree";
            disagree: "disagree";
        }>>;
        answerBy: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    proposal: z.ZodNullable<z.ZodObject<{
        id: z.ZodNumber;
        kind: z.ZodEnum<{
            note: "note";
            owner_change: "owner_change";
        }>;
        from: z.ZodNullable<z.ZodObject<{
            kind: z.ZodEnum<{
                me: "me";
                share: "share";
                pot: "pot";
                user: "user";
                nobody: "nobody";
                waiting: "waiting";
                decide: "decide";
            }>;
            userId: z.ZodNullable<z.ZodNumber>;
            name: z.ZodNullable<z.ZodString>;
            words: z.ZodString;
        }, z.core.$strip>>;
        to: z.ZodNullable<z.ZodObject<{
            kind: z.ZodEnum<{
                me: "me";
                share: "share";
                pot: "pot";
                user: "user";
                nobody: "nobody";
                waiting: "waiting";
                decide: "decide";
            }>;
            userId: z.ZodNullable<z.ZodNumber>;
            name: z.ZodNullable<z.ZodString>;
            words: z.ZodString;
        }, z.core.$strip>>;
        note: z.ZodNullable<z.ZodString>;
        deltaMills: z.ZodNumber;
        why: z.ZodString;
        state: z.ZodEnum<{
            accepted: "accepted";
            proposed: "proposed";
            declined: "declined";
            late: "late";
        }>;
        afterCounted: z.ZodBoolean;
        by: z.ZodString;
    }, z.core.$strip>>;
    note: z.ZodNullable<z.ZodObject<{
        text: z.ZodString;
        by: z.ZodEnum<{
            other: "other";
            agent: "agent";
            person: "person";
        }>;
        byName: z.ZodString;
    }, z.core.$strip>>;
    sighting: z.ZodNullable<z.ZodObject<{
        id: z.ZodNumber;
        seenAt: z.ZodString;
        added: z.ZodBoolean;
    }, z.core.$strip>>;
    editable: z.ZodBoolean;
    canNote: z.ZodBoolean;
    attention: z.ZodBoolean;
    choices: z.ZodOptional<z.ZodArray<z.ZodObject<{
        owner: z.ZodObject<{
            kind: z.ZodEnum<{
                me: "me";
                share: "share";
                pot: "pot";
                user: "user";
                nobody: "nobody";
                waiting: "waiting";
                decide: "decide";
            }>;
            userId: z.ZodNullable<z.ZodNumber>;
            name: z.ZodNullable<z.ZodString>;
            words: z.ZodString;
        }, z.core.$strip>;
        asks: z.ZodNullable<z.ZodObject<{
            to: z.ZodEnum<{
                colleague: "colleague";
                decider: "decider";
            }>;
            user: z.ZodNullable<z.ZodObject<{
                userId: z.ZodNumber;
                name: z.ZodString;
                forms: z.ZodObject<{
                    nom: z.ZodString;
                    gen: z.ZodString;
                    acc: z.ZodString;
                    ins: z.ZodString;
                    dat: z.ZodString;
                }, z.core.$strip>;
            }, z.core.$strip>>;
            words: z.ZodString;
        }, z.core.$strip>>;
        hint: z.ZodString;
        current: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>>;
    foundByHub: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type ShiftReportRow = z.infer<typeof shiftReportRowSchema>;
export declare const shiftReportColumnSchema: z.ZodObject<{
    pageLabel: z.ZodString;
    platform: z.ZodEnum<{
        fansly: "fansly";
        onlyfans: "onlyfans";
    }>;
    pageHandle: z.ZodNullable<z.ZodString>;
    modelName: z.ZodNullable<z.ZodString>;
    rows: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        transactionId: z.ZodNullable<z.ZodNumber>;
        pageLabel: z.ZodString;
        platform: z.ZodEnum<{
            fansly: "fansly";
            onlyfans: "onlyfans";
        }>;
        platformRef: z.ZodNullable<z.ZodString>;
        refLabel: z.ZodNullable<z.ZodString>;
        kind: z.ZodString;
        siteWords: z.ZodString;
        fan: z.ZodObject<{
            fanRef: z.ZodNullable<z.ZodString>;
            name: z.ZodNullable<z.ZodString>;
            username: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
        occurredAt: z.ZodString;
        netMills: z.ZodNumber;
        grossMills: z.ZodNullable<z.ZodNumber>;
        rule: z.ZodObject<{
            owner: z.ZodObject<{
                kind: z.ZodEnum<{
                    me: "me";
                    share: "share";
                    pot: "pot";
                    user: "user";
                    nobody: "nobody";
                    waiting: "waiting";
                    decide: "decide";
                }>;
                userId: z.ZodNullable<z.ZodNumber>;
                name: z.ZodNullable<z.ZodString>;
                words: z.ZodString;
            }, z.core.$strip>;
            reason: z.ZodString;
            words: z.ZodString;
        }, z.core.$strip>;
        owner: z.ZodObject<{
            kind: z.ZodEnum<{
                me: "me";
                share: "share";
                pot: "pot";
                user: "user";
                nobody: "nobody";
                waiting: "waiting";
                decide: "decide";
            }>;
            userId: z.ZodNullable<z.ZodNumber>;
            name: z.ZodNullable<z.ZodString>;
            words: z.ZodString;
        }, z.core.$strip>;
        statement: z.ZodNullable<z.ZodEnum<{
            mine: "mine";
            not_mine: "not_mine";
            share: "share";
            give: "give";
            pot: "pot";
        }>>;
        reasonWords: z.ZodString;
        ticked: z.ZodBoolean;
        amountMills: z.ZodNumber;
        before: z.ZodNullable<z.ZodObject<{
            user: z.ZodNullable<z.ZodObject<{
                userId: z.ZodNumber;
                name: z.ZodString;
                forms: z.ZodObject<{
                    nom: z.ZodString;
                    gen: z.ZodString;
                    acc: z.ZodString;
                    ins: z.ZodString;
                    dat: z.ZodString;
                }, z.core.$strip>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        late: z.ZodBoolean;
        ask: z.ZodNullable<z.ZodObject<{
            claimId: z.ZodNumber;
            to: z.ZodEnum<{
                owner: "owner";
                colleague: "colleague";
            }>;
            toUser: z.ZodNullable<z.ZodObject<{
                userId: z.ZodNumber;
                name: z.ZodString;
                forms: z.ZodObject<{
                    nom: z.ZodString;
                    gen: z.ZodString;
                    acc: z.ZodString;
                    ins: z.ZodString;
                    dat: z.ZodString;
                }, z.core.$strip>;
            }, z.core.$strip>>;
            want: z.ZodObject<{
                kind: z.ZodEnum<{
                    me: "me";
                    share: "share";
                    pot: "pot";
                    user: "user";
                    nobody: "nobody";
                    waiting: "waiting";
                    decide: "decide";
                }>;
                userId: z.ZodNullable<z.ZodNumber>;
                name: z.ZodNullable<z.ZodString>;
                words: z.ZodString;
            }, z.core.$strip>;
            note: z.ZodString;
            state: z.ZodEnum<{
                withdrawn: "withdrawn";
                asked: "asked";
                agreed: "agreed";
                disputed: "disputed";
                silence: "silence";
                decided: "decided";
            }>;
            answerNote: z.ZodNullable<z.ZodString>;
            answerBy: z.ZodNullable<z.ZodString>;
            decision: z.ZodNullable<z.ZodString>;
            oldWay: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>>;
        incoming: z.ZodNullable<z.ZodObject<{
            claimId: z.ZodNumber;
            from: z.ZodObject<{
                userId: z.ZodNumber;
                name: z.ZodString;
                forms: z.ZodObject<{
                    nom: z.ZodString;
                    gen: z.ZodString;
                    acc: z.ZodString;
                    ins: z.ZodString;
                    dat: z.ZodString;
                }, z.core.$strip>;
            }, z.core.$strip>;
            statement: z.ZodEnum<{
                mine: "mine";
                share: "share";
            }>;
            note: z.ZodNullable<z.ZodString>;
            state: z.ZodEnum<{
                asked: "asked";
                disputed: "disputed";
                settled: "settled";
            }>;
            canAnswer: z.ZodBoolean;
            answer: z.ZodNullable<z.ZodEnum<{
                agree: "agree";
                disagree: "disagree";
            }>>;
            answerBy: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        proposal: z.ZodNullable<z.ZodObject<{
            id: z.ZodNumber;
            kind: z.ZodEnum<{
                note: "note";
                owner_change: "owner_change";
            }>;
            from: z.ZodNullable<z.ZodObject<{
                kind: z.ZodEnum<{
                    me: "me";
                    share: "share";
                    pot: "pot";
                    user: "user";
                    nobody: "nobody";
                    waiting: "waiting";
                    decide: "decide";
                }>;
                userId: z.ZodNullable<z.ZodNumber>;
                name: z.ZodNullable<z.ZodString>;
                words: z.ZodString;
            }, z.core.$strip>>;
            to: z.ZodNullable<z.ZodObject<{
                kind: z.ZodEnum<{
                    me: "me";
                    share: "share";
                    pot: "pot";
                    user: "user";
                    nobody: "nobody";
                    waiting: "waiting";
                    decide: "decide";
                }>;
                userId: z.ZodNullable<z.ZodNumber>;
                name: z.ZodNullable<z.ZodString>;
                words: z.ZodString;
            }, z.core.$strip>>;
            note: z.ZodNullable<z.ZodString>;
            deltaMills: z.ZodNumber;
            why: z.ZodString;
            state: z.ZodEnum<{
                accepted: "accepted";
                proposed: "proposed";
                declined: "declined";
                late: "late";
            }>;
            afterCounted: z.ZodBoolean;
            by: z.ZodString;
        }, z.core.$strip>>;
        note: z.ZodNullable<z.ZodObject<{
            text: z.ZodString;
            by: z.ZodEnum<{
                other: "other";
                agent: "agent";
                person: "person";
            }>;
            byName: z.ZodString;
        }, z.core.$strip>>;
        sighting: z.ZodNullable<z.ZodObject<{
            id: z.ZodNumber;
            seenAt: z.ZodString;
            added: z.ZodBoolean;
        }, z.core.$strip>>;
        editable: z.ZodBoolean;
        canNote: z.ZodBoolean;
        attention: z.ZodBoolean;
        choices: z.ZodOptional<z.ZodArray<z.ZodObject<{
            owner: z.ZodObject<{
                kind: z.ZodEnum<{
                    me: "me";
                    share: "share";
                    pot: "pot";
                    user: "user";
                    nobody: "nobody";
                    waiting: "waiting";
                    decide: "decide";
                }>;
                userId: z.ZodNullable<z.ZodNumber>;
                name: z.ZodNullable<z.ZodString>;
                words: z.ZodString;
            }, z.core.$strip>;
            asks: z.ZodNullable<z.ZodObject<{
                to: z.ZodEnum<{
                    colleague: "colleague";
                    decider: "decider";
                }>;
                user: z.ZodNullable<z.ZodObject<{
                    userId: z.ZodNumber;
                    name: z.ZodString;
                    forms: z.ZodObject<{
                        nom: z.ZodString;
                        gen: z.ZodString;
                        acc: z.ZodString;
                        ins: z.ZodString;
                        dat: z.ZodString;
                    }, z.core.$strip>;
                }, z.core.$strip>>;
                words: z.ZodString;
            }, z.core.$strip>>;
            hint: z.ZodString;
            current: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>>>;
        foundByHub: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
    before: z.ZodObject<{
        count: z.ZodNumber;
        until: z.ZodString;
        people: z.ZodArray<z.ZodObject<{
            userId: z.ZodNumber;
            name: z.ZodString;
            forms: z.ZodObject<{
                nom: z.ZodString;
                gen: z.ZodString;
                acc: z.ZodString;
                ins: z.ZodString;
                dat: z.ZodString;
            }, z.core.$strip>;
        }, z.core.$strip>>;
        rows: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            transactionId: z.ZodNullable<z.ZodNumber>;
            pageLabel: z.ZodString;
            platform: z.ZodEnum<{
                fansly: "fansly";
                onlyfans: "onlyfans";
            }>;
            platformRef: z.ZodNullable<z.ZodString>;
            refLabel: z.ZodNullable<z.ZodString>;
            kind: z.ZodString;
            siteWords: z.ZodString;
            fan: z.ZodObject<{
                fanRef: z.ZodNullable<z.ZodString>;
                name: z.ZodNullable<z.ZodString>;
                username: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>;
            occurredAt: z.ZodString;
            netMills: z.ZodNumber;
            grossMills: z.ZodNullable<z.ZodNumber>;
            rule: z.ZodObject<{
                owner: z.ZodObject<{
                    kind: z.ZodEnum<{
                        me: "me";
                        share: "share";
                        pot: "pot";
                        user: "user";
                        nobody: "nobody";
                        waiting: "waiting";
                        decide: "decide";
                    }>;
                    userId: z.ZodNullable<z.ZodNumber>;
                    name: z.ZodNullable<z.ZodString>;
                    words: z.ZodString;
                }, z.core.$strip>;
                reason: z.ZodString;
                words: z.ZodString;
            }, z.core.$strip>;
            owner: z.ZodObject<{
                kind: z.ZodEnum<{
                    me: "me";
                    share: "share";
                    pot: "pot";
                    user: "user";
                    nobody: "nobody";
                    waiting: "waiting";
                    decide: "decide";
                }>;
                userId: z.ZodNullable<z.ZodNumber>;
                name: z.ZodNullable<z.ZodString>;
                words: z.ZodString;
            }, z.core.$strip>;
            statement: z.ZodNullable<z.ZodEnum<{
                mine: "mine";
                not_mine: "not_mine";
                share: "share";
                give: "give";
                pot: "pot";
            }>>;
            reasonWords: z.ZodString;
            ticked: z.ZodBoolean;
            amountMills: z.ZodNumber;
            before: z.ZodNullable<z.ZodObject<{
                user: z.ZodNullable<z.ZodObject<{
                    userId: z.ZodNumber;
                    name: z.ZodString;
                    forms: z.ZodObject<{
                        nom: z.ZodString;
                        gen: z.ZodString;
                        acc: z.ZodString;
                        ins: z.ZodString;
                        dat: z.ZodString;
                    }, z.core.$strip>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            late: z.ZodBoolean;
            ask: z.ZodNullable<z.ZodObject<{
                claimId: z.ZodNumber;
                to: z.ZodEnum<{
                    owner: "owner";
                    colleague: "colleague";
                }>;
                toUser: z.ZodNullable<z.ZodObject<{
                    userId: z.ZodNumber;
                    name: z.ZodString;
                    forms: z.ZodObject<{
                        nom: z.ZodString;
                        gen: z.ZodString;
                        acc: z.ZodString;
                        ins: z.ZodString;
                        dat: z.ZodString;
                    }, z.core.$strip>;
                }, z.core.$strip>>;
                want: z.ZodObject<{
                    kind: z.ZodEnum<{
                        me: "me";
                        share: "share";
                        pot: "pot";
                        user: "user";
                        nobody: "nobody";
                        waiting: "waiting";
                        decide: "decide";
                    }>;
                    userId: z.ZodNullable<z.ZodNumber>;
                    name: z.ZodNullable<z.ZodString>;
                    words: z.ZodString;
                }, z.core.$strip>;
                note: z.ZodString;
                state: z.ZodEnum<{
                    withdrawn: "withdrawn";
                    asked: "asked";
                    agreed: "agreed";
                    disputed: "disputed";
                    silence: "silence";
                    decided: "decided";
                }>;
                answerNote: z.ZodNullable<z.ZodString>;
                answerBy: z.ZodNullable<z.ZodString>;
                decision: z.ZodNullable<z.ZodString>;
                oldWay: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strip>>;
            incoming: z.ZodNullable<z.ZodObject<{
                claimId: z.ZodNumber;
                from: z.ZodObject<{
                    userId: z.ZodNumber;
                    name: z.ZodString;
                    forms: z.ZodObject<{
                        nom: z.ZodString;
                        gen: z.ZodString;
                        acc: z.ZodString;
                        ins: z.ZodString;
                        dat: z.ZodString;
                    }, z.core.$strip>;
                }, z.core.$strip>;
                statement: z.ZodEnum<{
                    mine: "mine";
                    share: "share";
                }>;
                note: z.ZodNullable<z.ZodString>;
                state: z.ZodEnum<{
                    asked: "asked";
                    disputed: "disputed";
                    settled: "settled";
                }>;
                canAnswer: z.ZodBoolean;
                answer: z.ZodNullable<z.ZodEnum<{
                    agree: "agree";
                    disagree: "disagree";
                }>>;
                answerBy: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
            proposal: z.ZodNullable<z.ZodObject<{
                id: z.ZodNumber;
                kind: z.ZodEnum<{
                    note: "note";
                    owner_change: "owner_change";
                }>;
                from: z.ZodNullable<z.ZodObject<{
                    kind: z.ZodEnum<{
                        me: "me";
                        share: "share";
                        pot: "pot";
                        user: "user";
                        nobody: "nobody";
                        waiting: "waiting";
                        decide: "decide";
                    }>;
                    userId: z.ZodNullable<z.ZodNumber>;
                    name: z.ZodNullable<z.ZodString>;
                    words: z.ZodString;
                }, z.core.$strip>>;
                to: z.ZodNullable<z.ZodObject<{
                    kind: z.ZodEnum<{
                        me: "me";
                        share: "share";
                        pot: "pot";
                        user: "user";
                        nobody: "nobody";
                        waiting: "waiting";
                        decide: "decide";
                    }>;
                    userId: z.ZodNullable<z.ZodNumber>;
                    name: z.ZodNullable<z.ZodString>;
                    words: z.ZodString;
                }, z.core.$strip>>;
                note: z.ZodNullable<z.ZodString>;
                deltaMills: z.ZodNumber;
                why: z.ZodString;
                state: z.ZodEnum<{
                    accepted: "accepted";
                    proposed: "proposed";
                    declined: "declined";
                    late: "late";
                }>;
                afterCounted: z.ZodBoolean;
                by: z.ZodString;
            }, z.core.$strip>>;
            note: z.ZodNullable<z.ZodObject<{
                text: z.ZodString;
                by: z.ZodEnum<{
                    other: "other";
                    agent: "agent";
                    person: "person";
                }>;
                byName: z.ZodString;
            }, z.core.$strip>>;
            sighting: z.ZodNullable<z.ZodObject<{
                id: z.ZodNumber;
                seenAt: z.ZodString;
                added: z.ZodBoolean;
            }, z.core.$strip>>;
            editable: z.ZodBoolean;
            canNote: z.ZodBoolean;
            attention: z.ZodBoolean;
            choices: z.ZodOptional<z.ZodArray<z.ZodObject<{
                owner: z.ZodObject<{
                    kind: z.ZodEnum<{
                        me: "me";
                        share: "share";
                        pot: "pot";
                        user: "user";
                        nobody: "nobody";
                        waiting: "waiting";
                        decide: "decide";
                    }>;
                    userId: z.ZodNullable<z.ZodNumber>;
                    name: z.ZodNullable<z.ZodString>;
                    words: z.ZodString;
                }, z.core.$strip>;
                asks: z.ZodNullable<z.ZodObject<{
                    to: z.ZodEnum<{
                        colleague: "colleague";
                        decider: "decider";
                    }>;
                    user: z.ZodNullable<z.ZodObject<{
                        userId: z.ZodNumber;
                        name: z.ZodString;
                        forms: z.ZodObject<{
                            nom: z.ZodString;
                            gen: z.ZodString;
                            acc: z.ZodString;
                            ins: z.ZodString;
                            dat: z.ZodString;
                        }, z.core.$strip>;
                    }, z.core.$strip>>;
                    words: z.ZodString;
                }, z.core.$strip>>;
                hint: z.ZodString;
                current: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strip>>>;
            foundByHub: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    marked: z.ZodNumber;
    of: z.ZodNumber;
    sumMills: z.ZodNumber;
    attention: z.ZodBoolean;
}, z.core.$strip>;
/** Hub's own check of one page after the hand-in. */
export declare const shiftReportHubPageCheckSchema: z.ZodObject<{
    pageLabel: z.ZodString;
    state: z.ZodEnum<{
        running: "running";
        unchecked: "unchecked";
        found: "found";
        statement: "statement";
        matched: "matched";
    }>;
    foundCount: z.ZodNumber;
    foundMills: z.ZodNumber;
    at: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export declare const shiftReportCandidateSchema: z.ZodObject<{
    id: z.ZodNumber;
    number: z.ZodNumber;
    madeAt: z.ZodString;
    by: z.ZodString;
    door: z.ZodEnum<{
        telegram: "telegram";
        workboard: "workboard";
        extension: "extension";
    }>;
    cutoffAt: z.ZodString;
    count: z.ZodNumber;
    totalMills: z.ZodNumber;
    hub: z.ZodObject<{
        state: z.ZodEnum<{
            running: "running";
            unchecked: "unchecked";
            found: "found";
            statement: "statement";
            matched: "matched";
        }>;
        pages: z.ZodArray<z.ZodObject<{
            pageLabel: z.ZodString;
            state: z.ZodEnum<{
                running: "running";
                unchecked: "unchecked";
                found: "found";
                statement: "statement";
                matched: "matched";
            }>;
            foundCount: z.ZodNumber;
            foundMills: z.ZodNumber;
            at: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        foundCount: z.ZodNumber;
        foundMills: z.ZodNumber;
    }, z.core.$strip>;
    gengar: z.ZodObject<{
        state: z.ZodEnum<{
            found: "found";
            idle: "idle";
            reading: "reading";
            clean: "clean";
            silent: "silent";
        }>;
        since: z.ZodString;
        answeredAt: z.ZodNullable<z.ZodString>;
        proposals: z.ZodNumber;
        notes: z.ZodNumber;
    }, z.core.$strip>;
    superseded: z.ZodBoolean;
}, z.core.$strip>;
export declare const shiftReportBoardSchema: z.ZodObject<{
    phase: z.ZodEnum<{
        draft: "draft";
        checking: "checking";
        confirm: "confirm";
        counted: "counted";
        fixing: "fixing";
    }>;
    chip: z.ZodString;
    offShift: z.ZodArray<z.ZodObject<{
        pageLabel: z.ZodString;
        platform: z.ZodEnum<{
            fansly: "fansly";
            onlyfans: "onlyfans";
        }>;
    }, z.core.$strip>>;
    columns: z.ZodArray<z.ZodObject<{
        pageLabel: z.ZodString;
        platform: z.ZodEnum<{
            fansly: "fansly";
            onlyfans: "onlyfans";
        }>;
        pageHandle: z.ZodNullable<z.ZodString>;
        modelName: z.ZodNullable<z.ZodString>;
        rows: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            transactionId: z.ZodNullable<z.ZodNumber>;
            pageLabel: z.ZodString;
            platform: z.ZodEnum<{
                fansly: "fansly";
                onlyfans: "onlyfans";
            }>;
            platformRef: z.ZodNullable<z.ZodString>;
            refLabel: z.ZodNullable<z.ZodString>;
            kind: z.ZodString;
            siteWords: z.ZodString;
            fan: z.ZodObject<{
                fanRef: z.ZodNullable<z.ZodString>;
                name: z.ZodNullable<z.ZodString>;
                username: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>;
            occurredAt: z.ZodString;
            netMills: z.ZodNumber;
            grossMills: z.ZodNullable<z.ZodNumber>;
            rule: z.ZodObject<{
                owner: z.ZodObject<{
                    kind: z.ZodEnum<{
                        me: "me";
                        share: "share";
                        pot: "pot";
                        user: "user";
                        nobody: "nobody";
                        waiting: "waiting";
                        decide: "decide";
                    }>;
                    userId: z.ZodNullable<z.ZodNumber>;
                    name: z.ZodNullable<z.ZodString>;
                    words: z.ZodString;
                }, z.core.$strip>;
                reason: z.ZodString;
                words: z.ZodString;
            }, z.core.$strip>;
            owner: z.ZodObject<{
                kind: z.ZodEnum<{
                    me: "me";
                    share: "share";
                    pot: "pot";
                    user: "user";
                    nobody: "nobody";
                    waiting: "waiting";
                    decide: "decide";
                }>;
                userId: z.ZodNullable<z.ZodNumber>;
                name: z.ZodNullable<z.ZodString>;
                words: z.ZodString;
            }, z.core.$strip>;
            statement: z.ZodNullable<z.ZodEnum<{
                mine: "mine";
                not_mine: "not_mine";
                share: "share";
                give: "give";
                pot: "pot";
            }>>;
            reasonWords: z.ZodString;
            ticked: z.ZodBoolean;
            amountMills: z.ZodNumber;
            before: z.ZodNullable<z.ZodObject<{
                user: z.ZodNullable<z.ZodObject<{
                    userId: z.ZodNumber;
                    name: z.ZodString;
                    forms: z.ZodObject<{
                        nom: z.ZodString;
                        gen: z.ZodString;
                        acc: z.ZodString;
                        ins: z.ZodString;
                        dat: z.ZodString;
                    }, z.core.$strip>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            late: z.ZodBoolean;
            ask: z.ZodNullable<z.ZodObject<{
                claimId: z.ZodNumber;
                to: z.ZodEnum<{
                    owner: "owner";
                    colleague: "colleague";
                }>;
                toUser: z.ZodNullable<z.ZodObject<{
                    userId: z.ZodNumber;
                    name: z.ZodString;
                    forms: z.ZodObject<{
                        nom: z.ZodString;
                        gen: z.ZodString;
                        acc: z.ZodString;
                        ins: z.ZodString;
                        dat: z.ZodString;
                    }, z.core.$strip>;
                }, z.core.$strip>>;
                want: z.ZodObject<{
                    kind: z.ZodEnum<{
                        me: "me";
                        share: "share";
                        pot: "pot";
                        user: "user";
                        nobody: "nobody";
                        waiting: "waiting";
                        decide: "decide";
                    }>;
                    userId: z.ZodNullable<z.ZodNumber>;
                    name: z.ZodNullable<z.ZodString>;
                    words: z.ZodString;
                }, z.core.$strip>;
                note: z.ZodString;
                state: z.ZodEnum<{
                    withdrawn: "withdrawn";
                    asked: "asked";
                    agreed: "agreed";
                    disputed: "disputed";
                    silence: "silence";
                    decided: "decided";
                }>;
                answerNote: z.ZodNullable<z.ZodString>;
                answerBy: z.ZodNullable<z.ZodString>;
                decision: z.ZodNullable<z.ZodString>;
                oldWay: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strip>>;
            incoming: z.ZodNullable<z.ZodObject<{
                claimId: z.ZodNumber;
                from: z.ZodObject<{
                    userId: z.ZodNumber;
                    name: z.ZodString;
                    forms: z.ZodObject<{
                        nom: z.ZodString;
                        gen: z.ZodString;
                        acc: z.ZodString;
                        ins: z.ZodString;
                        dat: z.ZodString;
                    }, z.core.$strip>;
                }, z.core.$strip>;
                statement: z.ZodEnum<{
                    mine: "mine";
                    share: "share";
                }>;
                note: z.ZodNullable<z.ZodString>;
                state: z.ZodEnum<{
                    asked: "asked";
                    disputed: "disputed";
                    settled: "settled";
                }>;
                canAnswer: z.ZodBoolean;
                answer: z.ZodNullable<z.ZodEnum<{
                    agree: "agree";
                    disagree: "disagree";
                }>>;
                answerBy: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
            proposal: z.ZodNullable<z.ZodObject<{
                id: z.ZodNumber;
                kind: z.ZodEnum<{
                    note: "note";
                    owner_change: "owner_change";
                }>;
                from: z.ZodNullable<z.ZodObject<{
                    kind: z.ZodEnum<{
                        me: "me";
                        share: "share";
                        pot: "pot";
                        user: "user";
                        nobody: "nobody";
                        waiting: "waiting";
                        decide: "decide";
                    }>;
                    userId: z.ZodNullable<z.ZodNumber>;
                    name: z.ZodNullable<z.ZodString>;
                    words: z.ZodString;
                }, z.core.$strip>>;
                to: z.ZodNullable<z.ZodObject<{
                    kind: z.ZodEnum<{
                        me: "me";
                        share: "share";
                        pot: "pot";
                        user: "user";
                        nobody: "nobody";
                        waiting: "waiting";
                        decide: "decide";
                    }>;
                    userId: z.ZodNullable<z.ZodNumber>;
                    name: z.ZodNullable<z.ZodString>;
                    words: z.ZodString;
                }, z.core.$strip>>;
                note: z.ZodNullable<z.ZodString>;
                deltaMills: z.ZodNumber;
                why: z.ZodString;
                state: z.ZodEnum<{
                    accepted: "accepted";
                    proposed: "proposed";
                    declined: "declined";
                    late: "late";
                }>;
                afterCounted: z.ZodBoolean;
                by: z.ZodString;
            }, z.core.$strip>>;
            note: z.ZodNullable<z.ZodObject<{
                text: z.ZodString;
                by: z.ZodEnum<{
                    other: "other";
                    agent: "agent";
                    person: "person";
                }>;
                byName: z.ZodString;
            }, z.core.$strip>>;
            sighting: z.ZodNullable<z.ZodObject<{
                id: z.ZodNumber;
                seenAt: z.ZodString;
                added: z.ZodBoolean;
            }, z.core.$strip>>;
            editable: z.ZodBoolean;
            canNote: z.ZodBoolean;
            attention: z.ZodBoolean;
            choices: z.ZodOptional<z.ZodArray<z.ZodObject<{
                owner: z.ZodObject<{
                    kind: z.ZodEnum<{
                        me: "me";
                        share: "share";
                        pot: "pot";
                        user: "user";
                        nobody: "nobody";
                        waiting: "waiting";
                        decide: "decide";
                    }>;
                    userId: z.ZodNullable<z.ZodNumber>;
                    name: z.ZodNullable<z.ZodString>;
                    words: z.ZodString;
                }, z.core.$strip>;
                asks: z.ZodNullable<z.ZodObject<{
                    to: z.ZodEnum<{
                        colleague: "colleague";
                        decider: "decider";
                    }>;
                    user: z.ZodNullable<z.ZodObject<{
                        userId: z.ZodNumber;
                        name: z.ZodString;
                        forms: z.ZodObject<{
                            nom: z.ZodString;
                            gen: z.ZodString;
                            acc: z.ZodString;
                            ins: z.ZodString;
                            dat: z.ZodString;
                        }, z.core.$strip>;
                    }, z.core.$strip>>;
                    words: z.ZodString;
                }, z.core.$strip>>;
                hint: z.ZodString;
                current: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strip>>>;
            foundByHub: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>>;
        before: z.ZodObject<{
            count: z.ZodNumber;
            until: z.ZodString;
            people: z.ZodArray<z.ZodObject<{
                userId: z.ZodNumber;
                name: z.ZodString;
                forms: z.ZodObject<{
                    nom: z.ZodString;
                    gen: z.ZodString;
                    acc: z.ZodString;
                    ins: z.ZodString;
                    dat: z.ZodString;
                }, z.core.$strip>;
            }, z.core.$strip>>;
            rows: z.ZodArray<z.ZodObject<{
                key: z.ZodString;
                transactionId: z.ZodNullable<z.ZodNumber>;
                pageLabel: z.ZodString;
                platform: z.ZodEnum<{
                    fansly: "fansly";
                    onlyfans: "onlyfans";
                }>;
                platformRef: z.ZodNullable<z.ZodString>;
                refLabel: z.ZodNullable<z.ZodString>;
                kind: z.ZodString;
                siteWords: z.ZodString;
                fan: z.ZodObject<{
                    fanRef: z.ZodNullable<z.ZodString>;
                    name: z.ZodNullable<z.ZodString>;
                    username: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>;
                occurredAt: z.ZodString;
                netMills: z.ZodNumber;
                grossMills: z.ZodNullable<z.ZodNumber>;
                rule: z.ZodObject<{
                    owner: z.ZodObject<{
                        kind: z.ZodEnum<{
                            me: "me";
                            share: "share";
                            pot: "pot";
                            user: "user";
                            nobody: "nobody";
                            waiting: "waiting";
                            decide: "decide";
                        }>;
                        userId: z.ZodNullable<z.ZodNumber>;
                        name: z.ZodNullable<z.ZodString>;
                        words: z.ZodString;
                    }, z.core.$strip>;
                    reason: z.ZodString;
                    words: z.ZodString;
                }, z.core.$strip>;
                owner: z.ZodObject<{
                    kind: z.ZodEnum<{
                        me: "me";
                        share: "share";
                        pot: "pot";
                        user: "user";
                        nobody: "nobody";
                        waiting: "waiting";
                        decide: "decide";
                    }>;
                    userId: z.ZodNullable<z.ZodNumber>;
                    name: z.ZodNullable<z.ZodString>;
                    words: z.ZodString;
                }, z.core.$strip>;
                statement: z.ZodNullable<z.ZodEnum<{
                    mine: "mine";
                    not_mine: "not_mine";
                    share: "share";
                    give: "give";
                    pot: "pot";
                }>>;
                reasonWords: z.ZodString;
                ticked: z.ZodBoolean;
                amountMills: z.ZodNumber;
                before: z.ZodNullable<z.ZodObject<{
                    user: z.ZodNullable<z.ZodObject<{
                        userId: z.ZodNumber;
                        name: z.ZodString;
                        forms: z.ZodObject<{
                            nom: z.ZodString;
                            gen: z.ZodString;
                            acc: z.ZodString;
                            ins: z.ZodString;
                            dat: z.ZodString;
                        }, z.core.$strip>;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                late: z.ZodBoolean;
                ask: z.ZodNullable<z.ZodObject<{
                    claimId: z.ZodNumber;
                    to: z.ZodEnum<{
                        owner: "owner";
                        colleague: "colleague";
                    }>;
                    toUser: z.ZodNullable<z.ZodObject<{
                        userId: z.ZodNumber;
                        name: z.ZodString;
                        forms: z.ZodObject<{
                            nom: z.ZodString;
                            gen: z.ZodString;
                            acc: z.ZodString;
                            ins: z.ZodString;
                            dat: z.ZodString;
                        }, z.core.$strip>;
                    }, z.core.$strip>>;
                    want: z.ZodObject<{
                        kind: z.ZodEnum<{
                            me: "me";
                            share: "share";
                            pot: "pot";
                            user: "user";
                            nobody: "nobody";
                            waiting: "waiting";
                            decide: "decide";
                        }>;
                        userId: z.ZodNullable<z.ZodNumber>;
                        name: z.ZodNullable<z.ZodString>;
                        words: z.ZodString;
                    }, z.core.$strip>;
                    note: z.ZodString;
                    state: z.ZodEnum<{
                        withdrawn: "withdrawn";
                        asked: "asked";
                        agreed: "agreed";
                        disputed: "disputed";
                        silence: "silence";
                        decided: "decided";
                    }>;
                    answerNote: z.ZodNullable<z.ZodString>;
                    answerBy: z.ZodNullable<z.ZodString>;
                    decision: z.ZodNullable<z.ZodString>;
                    oldWay: z.ZodOptional<z.ZodBoolean>;
                }, z.core.$strip>>;
                incoming: z.ZodNullable<z.ZodObject<{
                    claimId: z.ZodNumber;
                    from: z.ZodObject<{
                        userId: z.ZodNumber;
                        name: z.ZodString;
                        forms: z.ZodObject<{
                            nom: z.ZodString;
                            gen: z.ZodString;
                            acc: z.ZodString;
                            ins: z.ZodString;
                            dat: z.ZodString;
                        }, z.core.$strip>;
                    }, z.core.$strip>;
                    statement: z.ZodEnum<{
                        mine: "mine";
                        share: "share";
                    }>;
                    note: z.ZodNullable<z.ZodString>;
                    state: z.ZodEnum<{
                        asked: "asked";
                        disputed: "disputed";
                        settled: "settled";
                    }>;
                    canAnswer: z.ZodBoolean;
                    answer: z.ZodNullable<z.ZodEnum<{
                        agree: "agree";
                        disagree: "disagree";
                    }>>;
                    answerBy: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
                proposal: z.ZodNullable<z.ZodObject<{
                    id: z.ZodNumber;
                    kind: z.ZodEnum<{
                        note: "note";
                        owner_change: "owner_change";
                    }>;
                    from: z.ZodNullable<z.ZodObject<{
                        kind: z.ZodEnum<{
                            me: "me";
                            share: "share";
                            pot: "pot";
                            user: "user";
                            nobody: "nobody";
                            waiting: "waiting";
                            decide: "decide";
                        }>;
                        userId: z.ZodNullable<z.ZodNumber>;
                        name: z.ZodNullable<z.ZodString>;
                        words: z.ZodString;
                    }, z.core.$strip>>;
                    to: z.ZodNullable<z.ZodObject<{
                        kind: z.ZodEnum<{
                            me: "me";
                            share: "share";
                            pot: "pot";
                            user: "user";
                            nobody: "nobody";
                            waiting: "waiting";
                            decide: "decide";
                        }>;
                        userId: z.ZodNullable<z.ZodNumber>;
                        name: z.ZodNullable<z.ZodString>;
                        words: z.ZodString;
                    }, z.core.$strip>>;
                    note: z.ZodNullable<z.ZodString>;
                    deltaMills: z.ZodNumber;
                    why: z.ZodString;
                    state: z.ZodEnum<{
                        accepted: "accepted";
                        proposed: "proposed";
                        declined: "declined";
                        late: "late";
                    }>;
                    afterCounted: z.ZodBoolean;
                    by: z.ZodString;
                }, z.core.$strip>>;
                note: z.ZodNullable<z.ZodObject<{
                    text: z.ZodString;
                    by: z.ZodEnum<{
                        other: "other";
                        agent: "agent";
                        person: "person";
                    }>;
                    byName: z.ZodString;
                }, z.core.$strip>>;
                sighting: z.ZodNullable<z.ZodObject<{
                    id: z.ZodNumber;
                    seenAt: z.ZodString;
                    added: z.ZodBoolean;
                }, z.core.$strip>>;
                editable: z.ZodBoolean;
                canNote: z.ZodBoolean;
                attention: z.ZodBoolean;
                choices: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    owner: z.ZodObject<{
                        kind: z.ZodEnum<{
                            me: "me";
                            share: "share";
                            pot: "pot";
                            user: "user";
                            nobody: "nobody";
                            waiting: "waiting";
                            decide: "decide";
                        }>;
                        userId: z.ZodNullable<z.ZodNumber>;
                        name: z.ZodNullable<z.ZodString>;
                        words: z.ZodString;
                    }, z.core.$strip>;
                    asks: z.ZodNullable<z.ZodObject<{
                        to: z.ZodEnum<{
                            colleague: "colleague";
                            decider: "decider";
                        }>;
                        user: z.ZodNullable<z.ZodObject<{
                            userId: z.ZodNumber;
                            name: z.ZodString;
                            forms: z.ZodObject<{
                                nom: z.ZodString;
                                gen: z.ZodString;
                                acc: z.ZodString;
                                ins: z.ZodString;
                                dat: z.ZodString;
                            }, z.core.$strip>;
                        }, z.core.$strip>>;
                        words: z.ZodString;
                    }, z.core.$strip>>;
                    hint: z.ZodString;
                    current: z.ZodOptional<z.ZodBoolean>;
                }, z.core.$strip>>>;
                foundByHub: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strip>>;
        }, z.core.$strip>;
        marked: z.ZodNumber;
        of: z.ZodNumber;
        sumMills: z.ZodNumber;
        attention: z.ZodBoolean;
    }, z.core.$strip>>;
    candidate: z.ZodNullable<z.ZodObject<{
        id: z.ZodNumber;
        number: z.ZodNumber;
        madeAt: z.ZodString;
        by: z.ZodString;
        door: z.ZodEnum<{
            telegram: "telegram";
            workboard: "workboard";
            extension: "extension";
        }>;
        cutoffAt: z.ZodString;
        count: z.ZodNumber;
        totalMills: z.ZodNumber;
        hub: z.ZodObject<{
            state: z.ZodEnum<{
                running: "running";
                unchecked: "unchecked";
                found: "found";
                statement: "statement";
                matched: "matched";
            }>;
            pages: z.ZodArray<z.ZodObject<{
                pageLabel: z.ZodString;
                state: z.ZodEnum<{
                    running: "running";
                    unchecked: "unchecked";
                    found: "found";
                    statement: "statement";
                    matched: "matched";
                }>;
                foundCount: z.ZodNumber;
                foundMills: z.ZodNumber;
                at: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
            foundCount: z.ZodNumber;
            foundMills: z.ZodNumber;
        }, z.core.$strip>;
        gengar: z.ZodObject<{
            state: z.ZodEnum<{
                found: "found";
                idle: "idle";
                reading: "reading";
                clean: "clean";
                silent: "silent";
            }>;
            since: z.ZodString;
            answeredAt: z.ZodNullable<z.ZodString>;
            proposals: z.ZodNumber;
            notes: z.ZodNumber;
        }, z.core.$strip>;
        superseded: z.ZodBoolean;
    }, z.core.$strip>>;
    totals: z.ZodObject<{
        count: z.ZodNumber;
        nowMills: z.ZodNumber;
        wasMills: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>;
    waiting: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        transactionId: z.ZodNullable<z.ZodNumber>;
        pageLabel: z.ZodString;
        fanName: z.ZodNullable<z.ZodString>;
        netMills: z.ZodNumber;
        why: z.ZodEnum<{
            late: "late";
            ask: "ask";
            incoming: "incoming";
            sighting: "sighting";
        }>;
    }, z.core.$strip>>;
    colleagues: z.ZodArray<z.ZodObject<{
        userId: z.ZodNumber;
        name: z.ZodString;
        forms: z.ZodObject<{
            nom: z.ZodString;
            gen: z.ZodString;
            acc: z.ZodString;
            ins: z.ZodString;
            dat: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>>;
    decider: z.ZodObject<{
        kind: z.ZodEnum<{
            owner: "owner";
            team_lead: "team_lead";
        }>;
        user: z.ZodNullable<z.ZodObject<{
            userId: z.ZodNumber;
            name: z.ZodString;
            forms: z.ZodObject<{
                nom: z.ZodString;
                gen: z.ZodString;
                acc: z.ZodString;
                ins: z.ZodString;
                dat: z.ZodString;
            }, z.core.$strip>;
        }, z.core.$strip>>;
        words: z.ZodString;
    }, z.core.$strip>;
    canConfirm: z.ZodBoolean;
    needsMe: z.ZodBoolean;
    handedInAt: z.ZodNullable<z.ZodString>;
    countedAt: z.ZodNullable<z.ZodString>;
    preview: z.ZodOptional<z.ZodBoolean>;
    previous: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        user: z.ZodObject<{
            userId: z.ZodNumber;
            name: z.ZodString;
            forms: z.ZodObject<{
                nom: z.ZodString;
                gen: z.ZodString;
                acc: z.ZodString;
                ins: z.ZodString;
                dat: z.ZodString;
            }, z.core.$strip>;
        }, z.core.$strip>;
        comment: z.ZodString;
        at: z.ZodString;
    }, z.core.$strip>>>;
    post: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        copiedAt: z.ZodNullable<z.ZodString>;
        seen: z.ZodNullable<z.ZodBoolean>;
        changedSinceCopy: z.ZodBoolean;
        late: z.ZodBoolean;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type ShiftReportBoard = z.infer<typeof shiftReportBoardSchema>;
/** The pulse's `report` field (`clientActivity`): the fifth button and its dot. Null — a person without the board. */
export declare const shiftReportPulseSchema: z.ZodObject<{
    shiftId: z.ZodNumber;
    phase: z.ZodEnum<{
        draft: "draft";
        checking: "checking";
        confirm: "confirm";
        counted: "counted";
        fixing: "fixing";
    }>;
    needsMe: z.ZodBoolean;
}, z.core.$strip>;
