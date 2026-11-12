/**
 * Отчёт смены (ecosystem plan 2026-11-12, package F): the shift and its report
 * as one object in Hub, behind three doors that call one service — Workboard by
 * the person's session (the narrow one the extension opens included), the chat
 * extension by its device token, and an agent key «со слов» (Gengar's /smena,
 * `write:shift_reports`). One report per shift row (`shifts.id`); its draft is
 * computed from the shift and the one rule of whose a sale is, and the person's
 * edits (не моё, делим с…, моё, a note, the comment, «мимо площадки») are saved
 * as made. «Сдать смену» makes an immutable version; the newest version is the
 * report. Accrued and paid are the ledger's, which reads the versions through
 * `agentShiftReportsFeed`.
 *
 * Who reads what: the person their own (draft and versions); the owner every
 * report; a team lead and a colleague the reports of shifts on pages they may
 * open, cut to those pages, the submitted version only (a team lead also the
 * draft before it), never edits. Everything new is behind the person's switch
 * «сдаёт смену в системе» (people registry right `submits_shift`): off, nothing
 * writes and «Мои смены» is as before. Sales only: no rate, accrual or payout
 * reaches any session here.
 */
import { z } from "zod";
export declare const SHIFT_REPORT_STATEMENTS: readonly ["mine", "not_mine", "share"];
export declare const SHIFT_REPORT_DOORS: readonly ["extension", "workboard", "telegram"];
export declare const shiftReportStatementEnum: z.ZodEnum<{
    mine: "mine";
    share: "share";
    not_mine: "not_mine";
}>;
export declare const shiftReportDoorEnum: z.ZodEnum<{
    telegram: "telegram";
    extension: "extension";
    workboard: "workboard";
}>;
/** The longest note of a line, and the comment. */
export declare const SHIFT_REPORT_NOTE_MAX = 300;
export declare const SHIFT_REPORT_COMMENT_MAX = 2000;
/** The widest window of `shiftReportsList`, Moscow days. */
export declare const SHIFT_REPORTS_LIST_MAX_DAYS = 62;
export declare const shiftReportParamsSchema: z.ZodObject<{
    shiftId: z.ZodCoercedNumber<unknown>;
}, z.core.$strip>;
export declare const shiftReportLineParamsSchema: z.ZodObject<{
    shiftId: z.ZodCoercedNumber<unknown>;
    transactionId: z.ZodCoercedNumber<unknown>;
}, z.core.$strip>;
export declare const shiftReportOffPlatformParamsSchema: z.ZodObject<{
    shiftId: z.ZodCoercedNumber<unknown>;
    offPlatformId: z.ZodCoercedNumber<unknown>;
}, z.core.$strip>;
export declare const shiftReportShiftSchema: z.ZodObject<{
    id: z.ZodNumber;
    userId: z.ZodNumber;
    personName: z.ZodString;
    ongoing: z.ZodBoolean;
    startedAt: z.ZodString;
    endedAt: z.ZodString;
    workedMinutes: z.ZodNumber;
    reportDate: z.ZodString;
    pages: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export declare const shiftReportLineFactsSchema: z.ZodObject<{
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
}, z.core.$strip>;
export declare const shiftReportLineSchema: z.ZodObject<{
    transactionId: z.ZodNumber;
    group: z.ZodEnum<{
        mine: "mine";
        near: "near";
    }>;
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
    rule: z.ZodObject<{
        home: z.ZodString;
        reason: z.ZodString;
        words: z.ZodString;
        toUserId: z.ZodNullable<z.ZodNumber>;
        toName: z.ZodNullable<z.ZodString>;
        shareMills: z.ZodNumber;
    }, z.core.$strip>;
    statement: z.ZodNullable<z.ZodEnum<{
        mine: "mine";
        share: "share";
        not_mine: "not_mine";
    }>>;
    shareWithUserId: z.ZodNullable<z.ZodNumber>;
    shareWithName: z.ZodNullable<z.ZodString>;
    note: z.ZodNullable<z.ZodString>;
    amountMills: z.ZodNumber;
    added: z.ZodBoolean;
    disputed: z.ZodBoolean;
    alreadyIn: z.ZodNullable<z.ZodObject<{
        shiftId: z.ZodNumber;
        reportDate: z.ZodString;
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
}, z.core.$strip>;
export declare const shiftReportOffPlatformSchema: z.ZodObject<{
    id: z.ZodNumber;
    amountMills: z.ZodNumber;
    fromWhom: z.ZodString;
    whatFor: z.ZodString;
    state: z.ZodEnum<{
        pending: "pending";
        rejected: "rejected";
        confirmed: "confirmed";
    }>;
    pageLabel: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
/** A report as one reads it: the person's draft, or a submitted version. */
export declare const shiftReportBodySchema: z.ZodObject<{
    source: z.ZodEnum<{
        draft: "draft";
        version: "version";
    }>;
    version: z.ZodNullable<z.ZodNumber>;
    submittedAt: z.ZodNullable<z.ZodString>;
    door: z.ZodNullable<z.ZodEnum<{
        telegram: "telegram";
        extension: "extension";
        workboard: "workboard";
    }>>;
    lines: z.ZodArray<z.ZodObject<{
        transactionId: z.ZodNumber;
        group: z.ZodEnum<{
            mine: "mine";
            near: "near";
        }>;
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
        rule: z.ZodObject<{
            home: z.ZodString;
            reason: z.ZodString;
            words: z.ZodString;
            toUserId: z.ZodNullable<z.ZodNumber>;
            toName: z.ZodNullable<z.ZodString>;
            shareMills: z.ZodNumber;
        }, z.core.$strip>;
        statement: z.ZodNullable<z.ZodEnum<{
            mine: "mine";
            share: "share";
            not_mine: "not_mine";
        }>>;
        shareWithUserId: z.ZodNullable<z.ZodNumber>;
        shareWithName: z.ZodNullable<z.ZodString>;
        note: z.ZodNullable<z.ZodString>;
        amountMills: z.ZodNumber;
        added: z.ZodBoolean;
        disputed: z.ZodBoolean;
        alreadyIn: z.ZodNullable<z.ZodObject<{
            shiftId: z.ZodNumber;
            reportDate: z.ZodString;
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
    }, z.core.$strip>>;
    offPlatform: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        amountMills: z.ZodNumber;
        fromWhom: z.ZodString;
        whatFor: z.ZodString;
        state: z.ZodEnum<{
            pending: "pending";
            rejected: "rejected";
            confirmed: "confirmed";
        }>;
        pageLabel: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>;
    comment: z.ZodString;
    pages: z.ZodArray<z.ZodObject<{
        pageLabel: z.ZodString;
        platform: z.ZodString;
        amountMills: z.ZodNumber;
    }, z.core.$strip>>;
    totalMills: z.ZodNumber;
    cut: z.ZodBoolean;
    computedAt: z.ZodString;
}, z.core.$strip>;
export declare const shiftReportVersionSummarySchema: z.ZodObject<{
    version: z.ZodNumber;
    submittedAt: z.ZodString;
    door: z.ZodEnum<{
        telegram: "telegram";
        extension: "extension";
        workboard: "workboard";
    }>;
    by: z.ZodString;
    totalMills: z.ZodNumber;
    madeFor: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export declare const shiftReportResponseSchema: z.ZodObject<{
    shift: z.ZodObject<{
        id: z.ZodNumber;
        userId: z.ZodNumber;
        personName: z.ZodString;
        ongoing: z.ZodBoolean;
        startedAt: z.ZodString;
        endedAt: z.ZodString;
        workedMinutes: z.ZodNumber;
        reportDate: z.ZodString;
        pages: z.ZodArray<z.ZodString>;
    }, z.core.$strip>;
    access: z.ZodEnum<{
        read: "read";
        own: "own";
    }>;
    enabled: z.ZodBoolean;
    canEdit: z.ZodBoolean;
    state: z.ZodEnum<{
        submitted: "submitted";
        open: "open";
    }>;
    latest: z.ZodNullable<z.ZodObject<{
        version: z.ZodNumber;
        submittedAt: z.ZodString;
        door: z.ZodEnum<{
            telegram: "telegram";
            extension: "extension";
            workboard: "workboard";
        }>;
        by: z.ZodString;
        totalMills: z.ZodNumber;
        madeFor: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>;
    versions: z.ZodArray<z.ZodObject<{
        version: z.ZodNumber;
        submittedAt: z.ZodString;
        door: z.ZodEnum<{
            telegram: "telegram";
            extension: "extension";
            workboard: "workboard";
        }>;
        by: z.ZodString;
        totalMills: z.ZodNumber;
        madeFor: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>;
    view: z.ZodNullable<z.ZodObject<{
        source: z.ZodEnum<{
            draft: "draft";
            version: "version";
        }>;
        version: z.ZodNullable<z.ZodNumber>;
        submittedAt: z.ZodNullable<z.ZodString>;
        door: z.ZodNullable<z.ZodEnum<{
            telegram: "telegram";
            extension: "extension";
            workboard: "workboard";
        }>>;
        lines: z.ZodArray<z.ZodObject<{
            transactionId: z.ZodNumber;
            group: z.ZodEnum<{
                mine: "mine";
                near: "near";
            }>;
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
            rule: z.ZodObject<{
                home: z.ZodString;
                reason: z.ZodString;
                words: z.ZodString;
                toUserId: z.ZodNullable<z.ZodNumber>;
                toName: z.ZodNullable<z.ZodString>;
                shareMills: z.ZodNumber;
            }, z.core.$strip>;
            statement: z.ZodNullable<z.ZodEnum<{
                mine: "mine";
                share: "share";
                not_mine: "not_mine";
            }>>;
            shareWithUserId: z.ZodNullable<z.ZodNumber>;
            shareWithName: z.ZodNullable<z.ZodString>;
            note: z.ZodNullable<z.ZodString>;
            amountMills: z.ZodNumber;
            added: z.ZodBoolean;
            disputed: z.ZodBoolean;
            alreadyIn: z.ZodNullable<z.ZodObject<{
                shiftId: z.ZodNumber;
                reportDate: z.ZodString;
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
        }, z.core.$strip>>;
        offPlatform: z.ZodArray<z.ZodObject<{
            id: z.ZodNumber;
            amountMills: z.ZodNumber;
            fromWhom: z.ZodString;
            whatFor: z.ZodString;
            state: z.ZodEnum<{
                pending: "pending";
                rejected: "rejected";
                confirmed: "confirmed";
            }>;
            pageLabel: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        }, z.core.$strip>>;
        comment: z.ZodString;
        pages: z.ZodArray<z.ZodObject<{
            pageLabel: z.ZodString;
            platform: z.ZodString;
            amountMills: z.ZodNumber;
        }, z.core.$strip>>;
        totalMills: z.ZodNumber;
        cut: z.ZodBoolean;
        computedAt: z.ZodString;
    }, z.core.$strip>>;
    afterSubmission: z.ZodNullable<z.ZodObject<{
        count: z.ZodNumber;
        mills: z.ZodNumber;
    }, z.core.$strip>>;
    posts: z.ZodArray<z.ZodObject<{
        modelName: z.ZodString;
        text: z.ZodString;
    }, z.core.$strip>>;
    colleagues: z.ZodArray<z.ZodObject<{
        userId: z.ZodNumber;
        name: z.ZodString;
    }, z.core.$strip>>;
    claims: z.ZodDefault<z.ZodArray<z.ZodObject<{
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
    }, z.core.$strip>>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const shiftReportLineBodySchema: z.ZodObject<{
    statement: z.ZodNullable<z.ZodEnum<{
        mine: "mine";
        share: "share";
        not_mine: "not_mine";
    }>>;
    shareWithUserId: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export declare const shiftReportCommentBodySchema: z.ZodObject<{
    comment: z.ZodString;
}, z.core.$strip>;
export declare const shiftReportOffPlatformBodySchema: z.ZodObject<{
    amountMills: z.ZodNumber;
    fromWhom: z.ZodString;
    whatFor: z.ZodString;
}, z.core.$strip>;
export declare const shiftReportSavedResponseSchema: z.ZodObject<{
    savedAt: z.ZodString;
}, z.core.$strip>;
export declare const shiftReportOffPlatformResponseSchema: z.ZodObject<{
    line: z.ZodObject<{
        id: z.ZodNumber;
        amountMills: z.ZodNumber;
        fromWhom: z.ZodString;
        whatFor: z.ZodString;
        state: z.ZodEnum<{
            pending: "pending";
            rejected: "rejected";
            confirmed: "confirmed";
        }>;
        pageLabel: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>;
    savedAt: z.ZodString;
}, z.core.$strip>;
export declare const shiftReportsListQuerySchema: z.ZodObject<{
    from: z.ZodString;
    to: z.ZodString;
    userId: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export declare const shiftReportsListItemSchema: z.ZodObject<{
    shiftId: z.ZodNumber;
    startedAt: z.ZodString;
    endedAt: z.ZodString;
    ongoing: z.ZodBoolean;
    reportDate: z.ZodString;
    pages: z.ZodArray<z.ZodString>;
    state: z.ZodEnum<{
        submitted: "submitted";
        open: "open";
    }>;
    version: z.ZodNullable<z.ZodNumber>;
    submittedAt: z.ZodNullable<z.ZodString>;
    totalMills: z.ZodNullable<z.ZodNumber>;
    draftTotalMills: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
export declare const shiftReportsListResponseSchema: z.ZodObject<{
    enabled: z.ZodBoolean;
    enabledSince: z.ZodNullable<z.ZodString>;
    shifts: z.ZodArray<z.ZodObject<{
        shiftId: z.ZodNumber;
        startedAt: z.ZodString;
        endedAt: z.ZodString;
        ongoing: z.ZodBoolean;
        reportDate: z.ZodString;
        pages: z.ZodArray<z.ZodString>;
        state: z.ZodEnum<{
            submitted: "submitted";
            open: "open";
        }>;
        version: z.ZodNullable<z.ZodNumber>;
        submittedAt: z.ZodNullable<z.ZodString>;
        totalMills: z.ZodNullable<z.ZodNumber>;
        draftTotalMills: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
/** «Добавить → продажу»: a sale of the last 7 days the person may add to the report by hand. */
export declare const shiftReportClaimableSaleSchema: z.ZodObject<{
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
}, z.core.$strip>;
export declare const shiftReportClaimableResponseSchema: z.ZodObject<{
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
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const agentShiftReportQuerySchema: z.ZodObject<{
    telegramUserId: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    person: z.ZodOptional<z.ZodString>;
    shiftId: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export declare const agentShiftReportClaimableQuerySchema: z.ZodObject<{
    shiftId: z.ZodCoercedNumber<unknown>;
    telegramUserId: z.ZodCoercedNumber<unknown>;
}, z.core.$strip>;
export declare const agentShiftReportLineBodySchema: z.ZodObject<{
    statement: z.ZodNullable<z.ZodEnum<{
        mine: "mine";
        share: "share";
        not_mine: "not_mine";
    }>>;
    shareWithUserId: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    telegramUserId: z.ZodNumber;
    sourceRef: z.ZodOptional<z.ZodString>;
    shiftId: z.ZodNumber;
    transactionId: z.ZodNumber;
}, z.core.$strip>;
export declare const agentShiftReportCommentBodySchema: z.ZodObject<{
    comment: z.ZodString;
    telegramUserId: z.ZodNumber;
    sourceRef: z.ZodOptional<z.ZodString>;
    shiftId: z.ZodNumber;
}, z.core.$strip>;
export declare const agentShiftReportOffPlatformBodySchema: z.ZodObject<{
    amountMills: z.ZodNumber;
    fromWhom: z.ZodString;
    whatFor: z.ZodString;
    telegramUserId: z.ZodNumber;
    sourceRef: z.ZodOptional<z.ZodString>;
    shiftId: z.ZodNumber;
}, z.core.$strip>;
export declare const agentShiftReportSubmitBodySchema: z.ZodObject<{
    shiftId: z.ZodNumber;
    telegramUserId: z.ZodNumber;
    sourceRef: z.ZodString;
}, z.core.$strip>;
export declare const agentShiftReportsFeedQuerySchema: z.ZodObject<{
    since: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export declare const agentShiftReportsFeedItemSchema: z.ZodObject<{
    id: z.ZodNumber;
    seq: z.ZodNumber;
    person: z.ZodNullable<z.ZodString>;
    hubUserId: z.ZodNumber;
    shiftId: z.ZodNumber;
    reportDate: z.ZodString;
    version: z.ZodNumber;
    submittedAt: z.ZodString;
    door: z.ZodEnum<{
        telegram: "telegram";
        extension: "extension";
        workboard: "workboard";
    }>;
    telegramMessageRef: z.ZodNullable<z.ZodString>;
    totalMills: z.ZodNumber;
    pages: z.ZodArray<z.ZodObject<{
        pageLabel: z.ZodString;
        amountMills: z.ZodNumber;
    }, z.core.$strip>>;
    lines: z.ZodArray<z.ZodObject<{
        transactionId: z.ZodNumber;
        pageLabel: z.ZodString;
        group: z.ZodEnum<{
            mine: "mine";
            near: "near";
        }>;
        netMills: z.ZodNumber;
        ruleShareMills: z.ZodNumber;
        ruleHome: z.ZodString;
        ruleReason: z.ZodString;
        statement: z.ZodNullable<z.ZodEnum<{
            mine: "mine";
            share: "share";
            not_mine: "not_mine";
        }>>;
        shareWithUserId: z.ZodNullable<z.ZodNumber>;
        note: z.ZodNullable<z.ZodString>;
        amountMills: z.ZodNumber;
        added: z.ZodBoolean;
        disputed: z.ZodBoolean;
        settled: z.ZodDefault<z.ZodNullable<z.ZodEnum<{
            owner: "owner";
            agreed: "agreed";
        }>>>;
    }, z.core.$strip>>;
    offPlatform: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        amountMills: z.ZodNumber;
        fromWhom: z.ZodString;
        whatFor: z.ZodString;
        state: z.ZodEnum<{
            pending: "pending";
            rejected: "rejected";
            confirmed: "confirmed";
        }>;
        pageLabel: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>;
    comment: z.ZodString;
    dayPaid: z.ZodNullable<z.ZodBoolean>;
    ruleVersion: z.ZodString;
    madeFor: z.ZodDefault<z.ZodNullable<z.ZodObject<{
        kind: z.ZodEnum<{
            claim: "claim";
            off_platform: "off_platform";
        }>;
        claimId: z.ZodNullable<z.ZodNumber>;
        offPlatformId: z.ZodNullable<z.ZodNumber>;
        transactionId: z.ZodNullable<z.ZodNumber>;
        outcome: z.ZodString;
        byUserId: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export declare const agentShiftReportsFeedResponseSchema: z.ZodObject<{
    reports: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        seq: z.ZodNumber;
        person: z.ZodNullable<z.ZodString>;
        hubUserId: z.ZodNumber;
        shiftId: z.ZodNumber;
        reportDate: z.ZodString;
        version: z.ZodNumber;
        submittedAt: z.ZodString;
        door: z.ZodEnum<{
            telegram: "telegram";
            extension: "extension";
            workboard: "workboard";
        }>;
        telegramMessageRef: z.ZodNullable<z.ZodString>;
        totalMills: z.ZodNumber;
        pages: z.ZodArray<z.ZodObject<{
            pageLabel: z.ZodString;
            amountMills: z.ZodNumber;
        }, z.core.$strip>>;
        lines: z.ZodArray<z.ZodObject<{
            transactionId: z.ZodNumber;
            pageLabel: z.ZodString;
            group: z.ZodEnum<{
                mine: "mine";
                near: "near";
            }>;
            netMills: z.ZodNumber;
            ruleShareMills: z.ZodNumber;
            ruleHome: z.ZodString;
            ruleReason: z.ZodString;
            statement: z.ZodNullable<z.ZodEnum<{
                mine: "mine";
                share: "share";
                not_mine: "not_mine";
            }>>;
            shareWithUserId: z.ZodNullable<z.ZodNumber>;
            note: z.ZodNullable<z.ZodString>;
            amountMills: z.ZodNumber;
            added: z.ZodBoolean;
            disputed: z.ZodBoolean;
            settled: z.ZodDefault<z.ZodNullable<z.ZodEnum<{
                owner: "owner";
                agreed: "agreed";
            }>>>;
        }, z.core.$strip>>;
        offPlatform: z.ZodArray<z.ZodObject<{
            id: z.ZodNumber;
            amountMills: z.ZodNumber;
            fromWhom: z.ZodString;
            whatFor: z.ZodString;
            state: z.ZodEnum<{
                pending: "pending";
                rejected: "rejected";
                confirmed: "confirmed";
            }>;
            pageLabel: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        }, z.core.$strip>>;
        comment: z.ZodString;
        dayPaid: z.ZodNullable<z.ZodBoolean>;
        ruleVersion: z.ZodString;
        madeFor: z.ZodDefault<z.ZodNullable<z.ZodObject<{
            kind: z.ZodEnum<{
                claim: "claim";
                off_platform: "off_platform";
            }>;
            claimId: z.ZodNullable<z.ZodNumber>;
            offPlatformId: z.ZodNullable<z.ZodNumber>;
            transactionId: z.ZodNullable<z.ZodNumber>;
            outcome: z.ZodString;
            byUserId: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>>;
    }, z.core.$strip>>;
    next: z.ZodString;
    serverNow: z.ZodString;
}, z.core.$strip>;
export type ShiftReportStatement = z.infer<typeof shiftReportStatementEnum>;
export type ShiftReportDoor = z.infer<typeof shiftReportDoorEnum>;
export type ShiftReportLine = z.infer<typeof shiftReportLineSchema>;
export type ShiftReportLineFacts = z.infer<typeof shiftReportLineFactsSchema>;
export type ShiftReportBody = z.infer<typeof shiftReportBodySchema>;
export type ShiftReportResponse = z.infer<typeof shiftReportResponseSchema>;
export type ShiftReportLineBody = z.infer<typeof shiftReportLineBodySchema>;
export type ShiftReportOffPlatformBody = z.infer<typeof shiftReportOffPlatformBodySchema>;
export type ShiftReportsListResponse = z.infer<typeof shiftReportsListResponseSchema>;
export type ShiftReportClaimableResponse = z.infer<typeof shiftReportClaimableResponseSchema>;
export type ShiftReportsListItem = z.infer<typeof shiftReportsListItemSchema>;
export type AgentShiftReportsFeedResponse = z.infer<typeof agentShiftReportsFeedResponseSchema>;
export type AgentShiftReportsFeedItem = z.infer<typeof agentShiftReportsFeedItemSchema>;
export declare const shiftHandinRouteSchemas: {
    readonly shiftReport: {
        readonly auth: {
            readonly kind: "any";
        };
        readonly tags: readonly ["client"];
        readonly summary: "A shift and its report: the draft with every sale and why, the versions handed in, the post in «Отчётность»";
        readonly description: string;
        readonly params: z.ZodObject<{
            shiftId: z.ZodCoercedNumber<unknown>;
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
                shift: z.ZodObject<{
                    id: z.ZodNumber;
                    userId: z.ZodNumber;
                    personName: z.ZodString;
                    ongoing: z.ZodBoolean;
                    startedAt: z.ZodString;
                    endedAt: z.ZodString;
                    workedMinutes: z.ZodNumber;
                    reportDate: z.ZodString;
                    pages: z.ZodArray<z.ZodString>;
                }, z.core.$strip>;
                access: z.ZodEnum<{
                    read: "read";
                    own: "own";
                }>;
                enabled: z.ZodBoolean;
                canEdit: z.ZodBoolean;
                state: z.ZodEnum<{
                    submitted: "submitted";
                    open: "open";
                }>;
                latest: z.ZodNullable<z.ZodObject<{
                    version: z.ZodNumber;
                    submittedAt: z.ZodString;
                    door: z.ZodEnum<{
                        telegram: "telegram";
                        extension: "extension";
                        workboard: "workboard";
                    }>;
                    by: z.ZodString;
                    totalMills: z.ZodNumber;
                    madeFor: z.ZodDefault<z.ZodNullable<z.ZodString>>;
                }, z.core.$strip>>;
                versions: z.ZodArray<z.ZodObject<{
                    version: z.ZodNumber;
                    submittedAt: z.ZodString;
                    door: z.ZodEnum<{
                        telegram: "telegram";
                        extension: "extension";
                        workboard: "workboard";
                    }>;
                    by: z.ZodString;
                    totalMills: z.ZodNumber;
                    madeFor: z.ZodDefault<z.ZodNullable<z.ZodString>>;
                }, z.core.$strip>>;
                view: z.ZodNullable<z.ZodObject<{
                    source: z.ZodEnum<{
                        draft: "draft";
                        version: "version";
                    }>;
                    version: z.ZodNullable<z.ZodNumber>;
                    submittedAt: z.ZodNullable<z.ZodString>;
                    door: z.ZodNullable<z.ZodEnum<{
                        telegram: "telegram";
                        extension: "extension";
                        workboard: "workboard";
                    }>>;
                    lines: z.ZodArray<z.ZodObject<{
                        transactionId: z.ZodNumber;
                        group: z.ZodEnum<{
                            mine: "mine";
                            near: "near";
                        }>;
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
                        rule: z.ZodObject<{
                            home: z.ZodString;
                            reason: z.ZodString;
                            words: z.ZodString;
                            toUserId: z.ZodNullable<z.ZodNumber>;
                            toName: z.ZodNullable<z.ZodString>;
                            shareMills: z.ZodNumber;
                        }, z.core.$strip>;
                        statement: z.ZodNullable<z.ZodEnum<{
                            mine: "mine";
                            share: "share";
                            not_mine: "not_mine";
                        }>>;
                        shareWithUserId: z.ZodNullable<z.ZodNumber>;
                        shareWithName: z.ZodNullable<z.ZodString>;
                        note: z.ZodNullable<z.ZodString>;
                        amountMills: z.ZodNumber;
                        added: z.ZodBoolean;
                        disputed: z.ZodBoolean;
                        alreadyIn: z.ZodNullable<z.ZodObject<{
                            shiftId: z.ZodNumber;
                            reportDate: z.ZodString;
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
                    }, z.core.$strip>>;
                    offPlatform: z.ZodArray<z.ZodObject<{
                        id: z.ZodNumber;
                        amountMills: z.ZodNumber;
                        fromWhom: z.ZodString;
                        whatFor: z.ZodString;
                        state: z.ZodEnum<{
                            pending: "pending";
                            rejected: "rejected";
                            confirmed: "confirmed";
                        }>;
                        pageLabel: z.ZodDefault<z.ZodNullable<z.ZodString>>;
                    }, z.core.$strip>>;
                    comment: z.ZodString;
                    pages: z.ZodArray<z.ZodObject<{
                        pageLabel: z.ZodString;
                        platform: z.ZodString;
                        amountMills: z.ZodNumber;
                    }, z.core.$strip>>;
                    totalMills: z.ZodNumber;
                    cut: z.ZodBoolean;
                    computedAt: z.ZodString;
                }, z.core.$strip>>;
                afterSubmission: z.ZodNullable<z.ZodObject<{
                    count: z.ZodNumber;
                    mills: z.ZodNumber;
                }, z.core.$strip>>;
                posts: z.ZodArray<z.ZodObject<{
                    modelName: z.ZodString;
                    text: z.ZodString;
                }, z.core.$strip>>;
                colleagues: z.ZodArray<z.ZodObject<{
                    userId: z.ZodNumber;
                    name: z.ZodString;
                }, z.core.$strip>>;
                claims: z.ZodDefault<z.ZodArray<z.ZodObject<{
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
                }, z.core.$strip>>>;
                serverNow: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly shiftReportsList: {
        readonly auth: {
            readonly kind: "any";
        };
        readonly tags: readonly ["client"];
        readonly summary: "The shifts of a person in a window with their report's state: «Идёт», «Сдайте смену», «Сдан»";
        readonly description: "Any session (the narrow one the extension opens included) or the chat extension's device token: the person's own report to write; a reader's to read. Database only. Without userId the reader's own; with it someone else's shifts on pages the reader may open.";
        readonly querystring: z.ZodObject<{
            from: z.ZodString;
            to: z.ZodString;
            userId: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
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
                enabled: z.ZodBoolean;
                enabledSince: z.ZodNullable<z.ZodString>;
                shifts: z.ZodArray<z.ZodObject<{
                    shiftId: z.ZodNumber;
                    startedAt: z.ZodString;
                    endedAt: z.ZodString;
                    ongoing: z.ZodBoolean;
                    reportDate: z.ZodString;
                    pages: z.ZodArray<z.ZodString>;
                    state: z.ZodEnum<{
                        submitted: "submitted";
                        open: "open";
                    }>;
                    version: z.ZodNullable<z.ZodNumber>;
                    submittedAt: z.ZodNullable<z.ZodString>;
                    totalMills: z.ZodNullable<z.ZodNumber>;
                    draftTotalMills: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strip>>;
                serverNow: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly shiftReportClaimable: {
        readonly auth: {
            readonly kind: "any";
        };
        readonly tags: readonly ["client"];
        readonly summary: "«Добавить → продажу»: the sales of the last 7 days the person may add to their report by hand";
        readonly description: string;
        readonly params: z.ZodObject<{
            shiftId: z.ZodCoercedNumber<unknown>;
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
                serverNow: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly shiftReportLineSet: {
        readonly auth: {
            readonly kind: "any";
        };
        readonly tags: readonly ["client"];
        readonly summary: "What the person says of a sale of the draft: «не моё», «делим с…», «моё», a note; saved at once";
        readonly description: string;
        readonly params: z.ZodObject<{
            shiftId: z.ZodCoercedNumber<unknown>;
            transactionId: z.ZodCoercedNumber<unknown>;
        }, z.core.$strip>;
        readonly body: z.ZodObject<{
            statement: z.ZodNullable<z.ZodEnum<{
                mine: "mine";
                share: "share";
                not_mine: "not_mine";
            }>>;
            shareWithUserId: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
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
                savedAt: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly shiftReportCommentSet: {
        readonly auth: {
            readonly kind: "any";
        };
        readonly tags: readonly ["client"];
        readonly summary: "The draft's comment for the next shift and the owner; saved at once";
        readonly description: string;
        readonly params: z.ZodObject<{
            shiftId: z.ZodCoercedNumber<unknown>;
        }, z.core.$strip>;
        readonly body: z.ZodObject<{
            comment: z.ZodString;
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
                savedAt: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly shiftReportOffPlatformAdd: {
        readonly auth: {
            readonly kind: "any";
        };
        readonly tags: readonly ["client"];
        readonly summary: "«Мимо площадки»: money that came past the platform; waits for the owner, never in the sums before";
        readonly description: string;
        readonly params: z.ZodObject<{
            shiftId: z.ZodCoercedNumber<unknown>;
        }, z.core.$strip>;
        readonly body: z.ZodObject<{
            amountMills: z.ZodNumber;
            fromWhom: z.ZodString;
            whatFor: z.ZodString;
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
                line: z.ZodObject<{
                    id: z.ZodNumber;
                    amountMills: z.ZodNumber;
                    fromWhom: z.ZodString;
                    whatFor: z.ZodString;
                    state: z.ZodEnum<{
                        pending: "pending";
                        rejected: "rejected";
                        confirmed: "confirmed";
                    }>;
                    pageLabel: z.ZodDefault<z.ZodNullable<z.ZodString>>;
                }, z.core.$strip>;
                savedAt: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly shiftReportOffPlatformWithdraw: {
        readonly auth: {
            readonly kind: "any";
        };
        readonly tags: readonly ["client"];
        readonly summary: "Take back a «мимо площадки» line the owner has not decided yet";
        readonly description: string;
        readonly params: z.ZodObject<{
            shiftId: z.ZodCoercedNumber<unknown>;
            offPlatformId: z.ZodCoercedNumber<unknown>;
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
                savedAt: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly shiftReportSubmit: {
        readonly auth: {
            readonly kind: "any";
        };
        readonly tags: readonly ["client"];
        readonly summary: "«Сдать смену»: the draft as it is now becomes the report's next version";
        readonly description: string;
        readonly params: z.ZodObject<{
            shiftId: z.ZodCoercedNumber<unknown>;
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
                shift: z.ZodObject<{
                    id: z.ZodNumber;
                    userId: z.ZodNumber;
                    personName: z.ZodString;
                    ongoing: z.ZodBoolean;
                    startedAt: z.ZodString;
                    endedAt: z.ZodString;
                    workedMinutes: z.ZodNumber;
                    reportDate: z.ZodString;
                    pages: z.ZodArray<z.ZodString>;
                }, z.core.$strip>;
                access: z.ZodEnum<{
                    read: "read";
                    own: "own";
                }>;
                enabled: z.ZodBoolean;
                canEdit: z.ZodBoolean;
                state: z.ZodEnum<{
                    submitted: "submitted";
                    open: "open";
                }>;
                latest: z.ZodNullable<z.ZodObject<{
                    version: z.ZodNumber;
                    submittedAt: z.ZodString;
                    door: z.ZodEnum<{
                        telegram: "telegram";
                        extension: "extension";
                        workboard: "workboard";
                    }>;
                    by: z.ZodString;
                    totalMills: z.ZodNumber;
                    madeFor: z.ZodDefault<z.ZodNullable<z.ZodString>>;
                }, z.core.$strip>>;
                versions: z.ZodArray<z.ZodObject<{
                    version: z.ZodNumber;
                    submittedAt: z.ZodString;
                    door: z.ZodEnum<{
                        telegram: "telegram";
                        extension: "extension";
                        workboard: "workboard";
                    }>;
                    by: z.ZodString;
                    totalMills: z.ZodNumber;
                    madeFor: z.ZodDefault<z.ZodNullable<z.ZodString>>;
                }, z.core.$strip>>;
                view: z.ZodNullable<z.ZodObject<{
                    source: z.ZodEnum<{
                        draft: "draft";
                        version: "version";
                    }>;
                    version: z.ZodNullable<z.ZodNumber>;
                    submittedAt: z.ZodNullable<z.ZodString>;
                    door: z.ZodNullable<z.ZodEnum<{
                        telegram: "telegram";
                        extension: "extension";
                        workboard: "workboard";
                    }>>;
                    lines: z.ZodArray<z.ZodObject<{
                        transactionId: z.ZodNumber;
                        group: z.ZodEnum<{
                            mine: "mine";
                            near: "near";
                        }>;
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
                        rule: z.ZodObject<{
                            home: z.ZodString;
                            reason: z.ZodString;
                            words: z.ZodString;
                            toUserId: z.ZodNullable<z.ZodNumber>;
                            toName: z.ZodNullable<z.ZodString>;
                            shareMills: z.ZodNumber;
                        }, z.core.$strip>;
                        statement: z.ZodNullable<z.ZodEnum<{
                            mine: "mine";
                            share: "share";
                            not_mine: "not_mine";
                        }>>;
                        shareWithUserId: z.ZodNullable<z.ZodNumber>;
                        shareWithName: z.ZodNullable<z.ZodString>;
                        note: z.ZodNullable<z.ZodString>;
                        amountMills: z.ZodNumber;
                        added: z.ZodBoolean;
                        disputed: z.ZodBoolean;
                        alreadyIn: z.ZodNullable<z.ZodObject<{
                            shiftId: z.ZodNumber;
                            reportDate: z.ZodString;
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
                    }, z.core.$strip>>;
                    offPlatform: z.ZodArray<z.ZodObject<{
                        id: z.ZodNumber;
                        amountMills: z.ZodNumber;
                        fromWhom: z.ZodString;
                        whatFor: z.ZodString;
                        state: z.ZodEnum<{
                            pending: "pending";
                            rejected: "rejected";
                            confirmed: "confirmed";
                        }>;
                        pageLabel: z.ZodDefault<z.ZodNullable<z.ZodString>>;
                    }, z.core.$strip>>;
                    comment: z.ZodString;
                    pages: z.ZodArray<z.ZodObject<{
                        pageLabel: z.ZodString;
                        platform: z.ZodString;
                        amountMills: z.ZodNumber;
                    }, z.core.$strip>>;
                    totalMills: z.ZodNumber;
                    cut: z.ZodBoolean;
                    computedAt: z.ZodString;
                }, z.core.$strip>>;
                afterSubmission: z.ZodNullable<z.ZodObject<{
                    count: z.ZodNumber;
                    mills: z.ZodNumber;
                }, z.core.$strip>>;
                posts: z.ZodArray<z.ZodObject<{
                    modelName: z.ZodString;
                    text: z.ZodString;
                }, z.core.$strip>>;
                colleagues: z.ZodArray<z.ZodObject<{
                    userId: z.ZodNumber;
                    name: z.ZodString;
                }, z.core.$strip>>;
                claims: z.ZodDefault<z.ZodArray<z.ZodObject<{
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
                }, z.core.$strip>>>;
                serverNow: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly agentShiftReport: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "A person's shift report as the person sees it, for their words (needs write:shift_reports)";
        readonly description: string;
        readonly querystring: z.ZodObject<{
            telegramUserId: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
            person: z.ZodOptional<z.ZodString>;
            shiftId: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
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
                shift: z.ZodObject<{
                    id: z.ZodNumber;
                    userId: z.ZodNumber;
                    personName: z.ZodString;
                    ongoing: z.ZodBoolean;
                    startedAt: z.ZodString;
                    endedAt: z.ZodString;
                    workedMinutes: z.ZodNumber;
                    reportDate: z.ZodString;
                    pages: z.ZodArray<z.ZodString>;
                }, z.core.$strip>;
                access: z.ZodEnum<{
                    read: "read";
                    own: "own";
                }>;
                enabled: z.ZodBoolean;
                canEdit: z.ZodBoolean;
                state: z.ZodEnum<{
                    submitted: "submitted";
                    open: "open";
                }>;
                latest: z.ZodNullable<z.ZodObject<{
                    version: z.ZodNumber;
                    submittedAt: z.ZodString;
                    door: z.ZodEnum<{
                        telegram: "telegram";
                        extension: "extension";
                        workboard: "workboard";
                    }>;
                    by: z.ZodString;
                    totalMills: z.ZodNumber;
                    madeFor: z.ZodDefault<z.ZodNullable<z.ZodString>>;
                }, z.core.$strip>>;
                versions: z.ZodArray<z.ZodObject<{
                    version: z.ZodNumber;
                    submittedAt: z.ZodString;
                    door: z.ZodEnum<{
                        telegram: "telegram";
                        extension: "extension";
                        workboard: "workboard";
                    }>;
                    by: z.ZodString;
                    totalMills: z.ZodNumber;
                    madeFor: z.ZodDefault<z.ZodNullable<z.ZodString>>;
                }, z.core.$strip>>;
                view: z.ZodNullable<z.ZodObject<{
                    source: z.ZodEnum<{
                        draft: "draft";
                        version: "version";
                    }>;
                    version: z.ZodNullable<z.ZodNumber>;
                    submittedAt: z.ZodNullable<z.ZodString>;
                    door: z.ZodNullable<z.ZodEnum<{
                        telegram: "telegram";
                        extension: "extension";
                        workboard: "workboard";
                    }>>;
                    lines: z.ZodArray<z.ZodObject<{
                        transactionId: z.ZodNumber;
                        group: z.ZodEnum<{
                            mine: "mine";
                            near: "near";
                        }>;
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
                        rule: z.ZodObject<{
                            home: z.ZodString;
                            reason: z.ZodString;
                            words: z.ZodString;
                            toUserId: z.ZodNullable<z.ZodNumber>;
                            toName: z.ZodNullable<z.ZodString>;
                            shareMills: z.ZodNumber;
                        }, z.core.$strip>;
                        statement: z.ZodNullable<z.ZodEnum<{
                            mine: "mine";
                            share: "share";
                            not_mine: "not_mine";
                        }>>;
                        shareWithUserId: z.ZodNullable<z.ZodNumber>;
                        shareWithName: z.ZodNullable<z.ZodString>;
                        note: z.ZodNullable<z.ZodString>;
                        amountMills: z.ZodNumber;
                        added: z.ZodBoolean;
                        disputed: z.ZodBoolean;
                        alreadyIn: z.ZodNullable<z.ZodObject<{
                            shiftId: z.ZodNumber;
                            reportDate: z.ZodString;
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
                    }, z.core.$strip>>;
                    offPlatform: z.ZodArray<z.ZodObject<{
                        id: z.ZodNumber;
                        amountMills: z.ZodNumber;
                        fromWhom: z.ZodString;
                        whatFor: z.ZodString;
                        state: z.ZodEnum<{
                            pending: "pending";
                            rejected: "rejected";
                            confirmed: "confirmed";
                        }>;
                        pageLabel: z.ZodDefault<z.ZodNullable<z.ZodString>>;
                    }, z.core.$strip>>;
                    comment: z.ZodString;
                    pages: z.ZodArray<z.ZodObject<{
                        pageLabel: z.ZodString;
                        platform: z.ZodString;
                        amountMills: z.ZodNumber;
                    }, z.core.$strip>>;
                    totalMills: z.ZodNumber;
                    cut: z.ZodBoolean;
                    computedAt: z.ZodString;
                }, z.core.$strip>>;
                afterSubmission: z.ZodNullable<z.ZodObject<{
                    count: z.ZodNumber;
                    mills: z.ZodNumber;
                }, z.core.$strip>>;
                posts: z.ZodArray<z.ZodObject<{
                    modelName: z.ZodString;
                    text: z.ZodString;
                }, z.core.$strip>>;
                colleagues: z.ZodArray<z.ZodObject<{
                    userId: z.ZodNumber;
                    name: z.ZodString;
                }, z.core.$strip>>;
                claims: z.ZodDefault<z.ZodArray<z.ZodObject<{
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
                }, z.core.$strip>>>;
                serverNow: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly agentShiftReportClaimable: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "The sales a person may add to their report by hand, «со слов» (needs write:shift_reports)";
        readonly description: "The pages the person may open and the key's grant both; the sender's Telegram id must be the person's.";
        readonly querystring: z.ZodObject<{
            shiftId: z.ZodCoercedNumber<unknown>;
            telegramUserId: z.ZodCoercedNumber<unknown>;
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
                serverNow: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly agentShiftReportLineSet: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "Set what the person says of a sale, «со слов» (needs write:shift_reports)";
        readonly description: "The sender's Telegram id must be the person's: else 409 `sender_not_person`.";
        readonly body: z.ZodObject<{
            statement: z.ZodNullable<z.ZodEnum<{
                mine: "mine";
                share: "share";
                not_mine: "not_mine";
            }>>;
            shareWithUserId: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            telegramUserId: z.ZodNumber;
            sourceRef: z.ZodOptional<z.ZodString>;
            shiftId: z.ZodNumber;
            transactionId: z.ZodNumber;
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
                savedAt: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly agentShiftReportCommentSet: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "Set the draft's comment, «со слов» (needs write:shift_reports)";
        readonly body: z.ZodObject<{
            comment: z.ZodString;
            telegramUserId: z.ZodNumber;
            sourceRef: z.ZodOptional<z.ZodString>;
            shiftId: z.ZodNumber;
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
                savedAt: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly agentShiftReportOffPlatformAdd: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "Add «мимо площадки», «со слов» (needs write:shift_reports)";
        readonly body: z.ZodObject<{
            amountMills: z.ZodNumber;
            fromWhom: z.ZodString;
            whatFor: z.ZodString;
            telegramUserId: z.ZodNumber;
            sourceRef: z.ZodOptional<z.ZodString>;
            shiftId: z.ZodNumber;
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
                line: z.ZodObject<{
                    id: z.ZodNumber;
                    amountMills: z.ZodNumber;
                    fromWhom: z.ZodString;
                    whatFor: z.ZodString;
                    state: z.ZodEnum<{
                        pending: "pending";
                        rejected: "rejected";
                        confirmed: "confirmed";
                    }>;
                    pageLabel: z.ZodDefault<z.ZodNullable<z.ZodString>>;
                }, z.core.$strip>;
                savedAt: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly agentShiftReportSubmit: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "Hand the shift in «со слов»: never without the message and its sender, who must be the person (needs write:shift_reports)";
        readonly description: "The version records the door `telegram`, the message reference, the sender's Telegram id and the key.";
        readonly body: z.ZodObject<{
            shiftId: z.ZodNumber;
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
                shift: z.ZodObject<{
                    id: z.ZodNumber;
                    userId: z.ZodNumber;
                    personName: z.ZodString;
                    ongoing: z.ZodBoolean;
                    startedAt: z.ZodString;
                    endedAt: z.ZodString;
                    workedMinutes: z.ZodNumber;
                    reportDate: z.ZodString;
                    pages: z.ZodArray<z.ZodString>;
                }, z.core.$strip>;
                access: z.ZodEnum<{
                    read: "read";
                    own: "own";
                }>;
                enabled: z.ZodBoolean;
                canEdit: z.ZodBoolean;
                state: z.ZodEnum<{
                    submitted: "submitted";
                    open: "open";
                }>;
                latest: z.ZodNullable<z.ZodObject<{
                    version: z.ZodNumber;
                    submittedAt: z.ZodString;
                    door: z.ZodEnum<{
                        telegram: "telegram";
                        extension: "extension";
                        workboard: "workboard";
                    }>;
                    by: z.ZodString;
                    totalMills: z.ZodNumber;
                    madeFor: z.ZodDefault<z.ZodNullable<z.ZodString>>;
                }, z.core.$strip>>;
                versions: z.ZodArray<z.ZodObject<{
                    version: z.ZodNumber;
                    submittedAt: z.ZodString;
                    door: z.ZodEnum<{
                        telegram: "telegram";
                        extension: "extension";
                        workboard: "workboard";
                    }>;
                    by: z.ZodString;
                    totalMills: z.ZodNumber;
                    madeFor: z.ZodDefault<z.ZodNullable<z.ZodString>>;
                }, z.core.$strip>>;
                view: z.ZodNullable<z.ZodObject<{
                    source: z.ZodEnum<{
                        draft: "draft";
                        version: "version";
                    }>;
                    version: z.ZodNullable<z.ZodNumber>;
                    submittedAt: z.ZodNullable<z.ZodString>;
                    door: z.ZodNullable<z.ZodEnum<{
                        telegram: "telegram";
                        extension: "extension";
                        workboard: "workboard";
                    }>>;
                    lines: z.ZodArray<z.ZodObject<{
                        transactionId: z.ZodNumber;
                        group: z.ZodEnum<{
                            mine: "mine";
                            near: "near";
                        }>;
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
                        rule: z.ZodObject<{
                            home: z.ZodString;
                            reason: z.ZodString;
                            words: z.ZodString;
                            toUserId: z.ZodNullable<z.ZodNumber>;
                            toName: z.ZodNullable<z.ZodString>;
                            shareMills: z.ZodNumber;
                        }, z.core.$strip>;
                        statement: z.ZodNullable<z.ZodEnum<{
                            mine: "mine";
                            share: "share";
                            not_mine: "not_mine";
                        }>>;
                        shareWithUserId: z.ZodNullable<z.ZodNumber>;
                        shareWithName: z.ZodNullable<z.ZodString>;
                        note: z.ZodNullable<z.ZodString>;
                        amountMills: z.ZodNumber;
                        added: z.ZodBoolean;
                        disputed: z.ZodBoolean;
                        alreadyIn: z.ZodNullable<z.ZodObject<{
                            shiftId: z.ZodNumber;
                            reportDate: z.ZodString;
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
                    }, z.core.$strip>>;
                    offPlatform: z.ZodArray<z.ZodObject<{
                        id: z.ZodNumber;
                        amountMills: z.ZodNumber;
                        fromWhom: z.ZodString;
                        whatFor: z.ZodString;
                        state: z.ZodEnum<{
                            pending: "pending";
                            rejected: "rejected";
                            confirmed: "confirmed";
                        }>;
                        pageLabel: z.ZodDefault<z.ZodNullable<z.ZodString>>;
                    }, z.core.$strip>>;
                    comment: z.ZodString;
                    pages: z.ZodArray<z.ZodObject<{
                        pageLabel: z.ZodString;
                        platform: z.ZodString;
                        amountMills: z.ZodNumber;
                    }, z.core.$strip>>;
                    totalMills: z.ZodNumber;
                    cut: z.ZodBoolean;
                    computedAt: z.ZodString;
                }, z.core.$strip>>;
                afterSubmission: z.ZodNullable<z.ZodObject<{
                    count: z.ZodNumber;
                    mills: z.ZodNumber;
                }, z.core.$strip>>;
                posts: z.ZodArray<z.ZodObject<{
                    modelName: z.ZodString;
                    text: z.ZodString;
                }, z.core.$strip>>;
                colleagues: z.ZodArray<z.ZodObject<{
                    userId: z.ZodNumber;
                    name: z.ZodString;
                }, z.core.$strip>>;
                claims: z.ZodDefault<z.ZodArray<z.ZodObject<{
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
                }, z.core.$strip>>>;
                serverNow: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly agentShiftReportsFeed: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "Every version of every shift report handed in, after a cursor: the ledger's feed (needs read:team and read:money)";
        readonly description: string;
        readonly querystring: z.ZodObject<{
            since: z.ZodOptional<z.ZodString>;
            limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
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
                reports: z.ZodArray<z.ZodObject<{
                    id: z.ZodNumber;
                    seq: z.ZodNumber;
                    person: z.ZodNullable<z.ZodString>;
                    hubUserId: z.ZodNumber;
                    shiftId: z.ZodNumber;
                    reportDate: z.ZodString;
                    version: z.ZodNumber;
                    submittedAt: z.ZodString;
                    door: z.ZodEnum<{
                        telegram: "telegram";
                        extension: "extension";
                        workboard: "workboard";
                    }>;
                    telegramMessageRef: z.ZodNullable<z.ZodString>;
                    totalMills: z.ZodNumber;
                    pages: z.ZodArray<z.ZodObject<{
                        pageLabel: z.ZodString;
                        amountMills: z.ZodNumber;
                    }, z.core.$strip>>;
                    lines: z.ZodArray<z.ZodObject<{
                        transactionId: z.ZodNumber;
                        pageLabel: z.ZodString;
                        group: z.ZodEnum<{
                            mine: "mine";
                            near: "near";
                        }>;
                        netMills: z.ZodNumber;
                        ruleShareMills: z.ZodNumber;
                        ruleHome: z.ZodString;
                        ruleReason: z.ZodString;
                        statement: z.ZodNullable<z.ZodEnum<{
                            mine: "mine";
                            share: "share";
                            not_mine: "not_mine";
                        }>>;
                        shareWithUserId: z.ZodNullable<z.ZodNumber>;
                        note: z.ZodNullable<z.ZodString>;
                        amountMills: z.ZodNumber;
                        added: z.ZodBoolean;
                        disputed: z.ZodBoolean;
                        settled: z.ZodDefault<z.ZodNullable<z.ZodEnum<{
                            owner: "owner";
                            agreed: "agreed";
                        }>>>;
                    }, z.core.$strip>>;
                    offPlatform: z.ZodArray<z.ZodObject<{
                        id: z.ZodNumber;
                        amountMills: z.ZodNumber;
                        fromWhom: z.ZodString;
                        whatFor: z.ZodString;
                        state: z.ZodEnum<{
                            pending: "pending";
                            rejected: "rejected";
                            confirmed: "confirmed";
                        }>;
                        pageLabel: z.ZodDefault<z.ZodNullable<z.ZodString>>;
                    }, z.core.$strip>>;
                    comment: z.ZodString;
                    dayPaid: z.ZodNullable<z.ZodBoolean>;
                    ruleVersion: z.ZodString;
                    madeFor: z.ZodDefault<z.ZodNullable<z.ZodObject<{
                        kind: z.ZodEnum<{
                            claim: "claim";
                            off_platform: "off_platform";
                        }>;
                        claimId: z.ZodNullable<z.ZodNumber>;
                        offPlatformId: z.ZodNullable<z.ZodNumber>;
                        transactionId: z.ZodNullable<z.ZodNumber>;
                        outcome: z.ZodString;
                        byUserId: z.ZodNullable<z.ZodNumber>;
                    }, z.core.$strip>>>;
                }, z.core.$strip>>;
                next: z.ZodString;
                serverNow: z.ZodString;
            }, z.core.$strip>;
        };
    };
};
