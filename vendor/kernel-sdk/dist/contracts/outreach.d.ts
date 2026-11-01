import { z } from "zod";
/** The common text and one version at most (the window's own limit). */
export declare const OUTREACH_TEXT_MAX = 5000;
/** Fans one outreach holds at most. */
export declare const OUTREACH_FANS_MAX = 1000;
/** Fans one save changes at most. */
export declare const OUTREACH_SAVE_FANS_MAX = 50;
/** `settings` at most, as JSON. */
export declare const OUTREACH_SETTINGS_MAX_BYTES: number;
/** Outreaches the list answers at most, newest change first. */
export declare const OUTREACH_LIST_MAX = 50;
/** An outreach untouched this long is gone from the list and deleted. */
export declare const OUTREACH_KEEP_DAYS = 90;
/** A claim not reported within this reads `uncertain`. */
export declare const OUTREACH_SEND_TICKET_SECONDS = 120;
/** A send made before the outreach reached Hub (`record`) is taken this old at most. */
export declare const OUTREACH_RECORD_MAX_AGE_DAYS = 30;
/** «Писали за 3 дня»: how far back the touches reach. */
export declare const OUTREACH_TOUCH_HOURS = 72;
/** The fan wrote within this after the send. */
export declare const OUTREACH_REPLIED_HOURS = 72;
/** The fan paid within this after the send. */
export declare const OUTREACH_BOUGHT_DAYS = 7;
/** An uncertain send is looked for in the archive this long after its click. */
export declare const OUTREACH_EVIDENCE_MINUTES = 30;
/** The states of a fan's send. `sending` past its ticket answers as `uncertain`. */
export declare const OUTREACH_SEND_STATES: readonly ["sending", "sent", "uncertain", "failed"];
/** What a send action did. Open on the wire. */
export declare const OUTREACH_SEND_OUTCOMES: readonly ["ok", "taken", "busy", "not_yours"];
/** Where a touch of the last OUTREACH_TOUCH_HOURS came from. Open on the wire. */
export declare const OUTREACH_TOUCH_KINDS: readonly ["outreach", "queue", "online"];
/** Who settled an uncertain send. Open on the wire. */
export declare const OUTREACH_RESOLVED_BY: readonly ["archive"];
export type OutreachSendState = (typeof OUTREACH_SEND_STATES)[number];
export type OutreachSendOutcome = (typeof OUTREACH_SEND_OUTCOMES)[number];
export type OutreachTouchKind = (typeof OUTREACH_TOUCH_KINDS)[number];
export declare const clientOutreachParamsSchema: z.ZodObject<{
    pageLabel: z.ZodString;
    outreachId: z.ZodString;
}, z.core.$strip>;
/** A person of the page's team: their login as the dashboard shows it, and whether it is the caller. */
export declare const clientOutreachPersonSchema: z.ZodObject<{
    name: z.ZodString;
    isMe: z.ZodBoolean;
}, z.core.$strip>;
export declare const clientOutreachSendSchema: z.ZodObject<{
    state: z.ZodString;
    attemptId: z.ZodString;
    by: z.ZodObject<{
        name: z.ZodString;
        isMe: z.ZodBoolean;
    }, z.core.$strip>;
    clickedAt: z.ZodString;
    ticketUntil: z.ZodNullable<z.ZodString>;
    sentAt: z.ZodNullable<z.ZodString>;
    code: z.ZodNullable<z.ZodString>;
    text: z.ZodNullable<z.ZodString>;
    media: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    platformMessageId: z.ZodNullable<z.ZodString>;
    resolvedBy: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/** What came of a send: Hub's archive and money, read when asked. */
export declare const clientOutreachOutcomeSchema: z.ZodObject<{
    replied: z.ZodNullable<z.ZodObject<{
        at: z.ZodString;
        text: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    bought: z.ZodNullable<z.ZodObject<{
        mills: z.ZodNumber;
        at: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const clientOutreachFanSchema: z.ZodObject<{
    fanRef: z.ZodString;
    version: z.ZodNullable<z.ZodString>;
    basis: z.ZodNullable<z.ZodString>;
    versionAt: z.ZodNullable<z.ZodString>;
    edit: z.ZodNullable<z.ZodString>;
    editedBy: z.ZodNullable<z.ZodObject<{
        name: z.ZodString;
        isMe: z.ZodBoolean;
    }, z.core.$strip>>;
    editedAt: z.ZodNullable<z.ZodString>;
    send: z.ZodNullable<z.ZodObject<{
        state: z.ZodString;
        attemptId: z.ZodString;
        by: z.ZodObject<{
            name: z.ZodString;
            isMe: z.ZodBoolean;
        }, z.core.$strip>;
        clickedAt: z.ZodString;
        ticketUntil: z.ZodNullable<z.ZodString>;
        sentAt: z.ZodNullable<z.ZodString>;
        code: z.ZodNullable<z.ZodString>;
        text: z.ZodNullable<z.ZodString>;
        media: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        platformMessageId: z.ZodNullable<z.ZodString>;
        resolvedBy: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    outcome: z.ZodNullable<z.ZodObject<{
        replied: z.ZodNullable<z.ZodObject<{
            at: z.ZodString;
            text: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        bought: z.ZodNullable<z.ZodObject<{
            mills: z.ZodNumber;
            at: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const clientOutreachSchema: z.ZodObject<{
    outreachId: z.ZodString;
    author: z.ZodObject<{
        name: z.ZodString;
        isMe: z.ZodBoolean;
    }, z.core.$strip>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    updatedBy: z.ZodObject<{
        name: z.ZodString;
        isMe: z.ZodBoolean;
    }, z.core.$strip>;
    text: z.ZodString;
    withMedia: z.ZodBoolean;
    settings: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    order: z.ZodArray<z.ZodString>;
    fans: z.ZodArray<z.ZodObject<{
        fanRef: z.ZodString;
        version: z.ZodNullable<z.ZodString>;
        basis: z.ZodNullable<z.ZodString>;
        versionAt: z.ZodNullable<z.ZodString>;
        edit: z.ZodNullable<z.ZodString>;
        editedBy: z.ZodNullable<z.ZodObject<{
            name: z.ZodString;
            isMe: z.ZodBoolean;
        }, z.core.$strip>>;
        editedAt: z.ZodNullable<z.ZodString>;
        send: z.ZodNullable<z.ZodObject<{
            state: z.ZodString;
            attemptId: z.ZodString;
            by: z.ZodObject<{
                name: z.ZodString;
                isMe: z.ZodBoolean;
            }, z.core.$strip>;
            clickedAt: z.ZodString;
            ticketUntil: z.ZodNullable<z.ZodString>;
            sentAt: z.ZodNullable<z.ZodString>;
            code: z.ZodNullable<z.ZodString>;
            text: z.ZodNullable<z.ZodString>;
            media: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            platformMessageId: z.ZodNullable<z.ZodString>;
            resolvedBy: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        outcome: z.ZodNullable<z.ZodObject<{
            replied: z.ZodNullable<z.ZodObject<{
                at: z.ZodString;
                text: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
            bought: z.ZodNullable<z.ZodObject<{
                mills: z.ZodNumber;
                at: z.ZodString;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const clientOutreachSummarySchema: z.ZodObject<{
    outreachId: z.ZodString;
    author: z.ZodObject<{
        name: z.ZodString;
        isMe: z.ZodBoolean;
    }, z.core.$strip>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    updatedBy: z.ZodObject<{
        name: z.ZodString;
        isMe: z.ZodBoolean;
    }, z.core.$strip>;
    text: z.ZodString;
    withMedia: z.ZodBoolean;
    fans: z.ZodNumber;
    written: z.ZodNumber;
    sent: z.ZodNumber;
    uncertain: z.ZodNumber;
    sending: z.ZodNumber;
    failed: z.ZodNumber;
    replied: z.ZodNumber;
    bought: z.ZodNumber;
    boughtMills: z.ZodNumber;
    lastSentAt: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export declare const clientOutreachesResponseSchema: z.ZodObject<{
    pageLabel: z.ZodString;
    outreaches: z.ZodArray<z.ZodObject<{
        outreachId: z.ZodString;
        author: z.ZodObject<{
            name: z.ZodString;
            isMe: z.ZodBoolean;
        }, z.core.$strip>;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
        updatedBy: z.ZodObject<{
            name: z.ZodString;
            isMe: z.ZodBoolean;
        }, z.core.$strip>;
        text: z.ZodString;
        withMedia: z.ZodBoolean;
        fans: z.ZodNumber;
        written: z.ZodNumber;
        sent: z.ZodNumber;
        uncertain: z.ZodNumber;
        sending: z.ZodNumber;
        failed: z.ZodNumber;
        replied: z.ZodNumber;
        bought: z.ZodNumber;
        boughtMills: z.ZodNumber;
        lastSentAt: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
/** One fan's change in a save. An absent field is left as it is. */
export declare const clientOutreachFanChangeSchema: z.ZodObject<{
    fanRef: z.ZodString;
    version: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    basis: z.ZodOptional<z.ZodString>;
    generationRef: z.ZodOptional<z.ZodString>;
    edit: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>;
/**
 * Create the outreach (the first save of its id) or change it. Each field is
 * the latest word: the save that comes last wins it. A fan's version and words
 * stay as they are once the fan's send was claimed (`kept` in the answer).
 */
export declare const clientOutreachSaveBodySchema: z.ZodObject<{
    text: z.ZodOptional<z.ZodString>;
    withMedia: z.ZodOptional<z.ZodBoolean>;
    settings: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    order: z.ZodOptional<z.ZodArray<z.ZodString>>;
    fans: z.ZodOptional<z.ZodArray<z.ZodObject<{
        fanRef: z.ZodString;
        version: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        basis: z.ZodOptional<z.ZodString>;
        generationRef: z.ZodOptional<z.ZodString>;
        edit: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strict>>>;
    createdAt: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const clientOutreachSaveResponseSchema: z.ZodObject<{
    outreachId: z.ZodString;
    author: z.ZodObject<{
        name: z.ZodString;
        isMe: z.ZodBoolean;
    }, z.core.$strip>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    updatedBy: z.ZodObject<{
        name: z.ZodString;
        isMe: z.ZodBoolean;
    }, z.core.$strip>;
    text: z.ZodString;
    withMedia: z.ZodBoolean;
    settings: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    order: z.ZodArray<z.ZodString>;
    fans: z.ZodArray<z.ZodObject<{
        fanRef: z.ZodString;
        version: z.ZodNullable<z.ZodString>;
        basis: z.ZodNullable<z.ZodString>;
        versionAt: z.ZodNullable<z.ZodString>;
        edit: z.ZodNullable<z.ZodString>;
        editedBy: z.ZodNullable<z.ZodObject<{
            name: z.ZodString;
            isMe: z.ZodBoolean;
        }, z.core.$strip>>;
        editedAt: z.ZodNullable<z.ZodString>;
        send: z.ZodNullable<z.ZodObject<{
            state: z.ZodString;
            attemptId: z.ZodString;
            by: z.ZodObject<{
                name: z.ZodString;
                isMe: z.ZodBoolean;
            }, z.core.$strip>;
            clickedAt: z.ZodString;
            ticketUntil: z.ZodNullable<z.ZodString>;
            sentAt: z.ZodNullable<z.ZodString>;
            code: z.ZodNullable<z.ZodString>;
            text: z.ZodNullable<z.ZodString>;
            media: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            platformMessageId: z.ZodNullable<z.ZodString>;
            resolvedBy: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        outcome: z.ZodNullable<z.ZodObject<{
            replied: z.ZodNullable<z.ZodObject<{
                at: z.ZodString;
                text: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
            bought: z.ZodNullable<z.ZodObject<{
                mills: z.ZodNumber;
                at: z.ZodString;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
    kept: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export declare const clientOutreachSendBodySchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    action: z.ZodLiteral<"claim">;
    fanRef: z.ZodString;
    attemptId: z.ZodString;
    text: z.ZodString;
    media: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"sent">;
    fanRef: z.ZodString;
    attemptId: z.ZodString;
    platformMessageId: z.ZodOptional<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"failed">;
    fanRef: z.ZodString;
    attemptId: z.ZodString;
    code: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"uncertain">;
    fanRef: z.ZodString;
    attemptId: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"record">;
    fanRef: z.ZodString;
    attemptId: z.ZodString;
    state: z.ZodEnum<{
        sent: "sent";
        uncertain: "uncertain";
    }>;
    clickedAt: z.ZodString;
    sentAt: z.ZodOptional<z.ZodString>;
    text: z.ZodString;
    media: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    platformMessageId: z.ZodOptional<z.ZodString>;
}, z.core.$strict>], "action">;
export declare const clientOutreachSendResponseSchema: z.ZodObject<{
    outcome: z.ZodString;
    fan: z.ZodObject<{
        fanRef: z.ZodString;
        version: z.ZodNullable<z.ZodString>;
        basis: z.ZodNullable<z.ZodString>;
        versionAt: z.ZodNullable<z.ZodString>;
        edit: z.ZodNullable<z.ZodString>;
        editedBy: z.ZodNullable<z.ZodObject<{
            name: z.ZodString;
            isMe: z.ZodBoolean;
        }, z.core.$strip>>;
        editedAt: z.ZodNullable<z.ZodString>;
        send: z.ZodNullable<z.ZodObject<{
            state: z.ZodString;
            attemptId: z.ZodString;
            by: z.ZodObject<{
                name: z.ZodString;
                isMe: z.ZodBoolean;
            }, z.core.$strip>;
            clickedAt: z.ZodString;
            ticketUntil: z.ZodNullable<z.ZodString>;
            sentAt: z.ZodNullable<z.ZodString>;
            code: z.ZodNullable<z.ZodString>;
            text: z.ZodNullable<z.ZodString>;
            media: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            platformMessageId: z.ZodNullable<z.ZodString>;
            resolvedBy: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        outcome: z.ZodNullable<z.ZodObject<{
            replied: z.ZodNullable<z.ZodObject<{
                at: z.ZodString;
                text: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
            bought: z.ZodNullable<z.ZodObject<{
                mills: z.ZodNumber;
                at: z.ZodString;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    serverNow: z.ZodString;
}, z.core.$strip>;
/** A fan written to in the last OUTREACH_TOUCH_HOURS by an outreach, a fan queue or «Онлайн»: the latest touch. */
export declare const clientOutreachTouchSchema: z.ZodObject<{
    fanRef: z.ZodString;
    at: z.ZodString;
    kind: z.ZodString;
    by: z.ZodNullable<z.ZodObject<{
        name: z.ZodString;
        isMe: z.ZodBoolean;
    }, z.core.$strip>>;
    outreachId: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export declare const clientOutreachTouchesResponseSchema: z.ZodObject<{
    pageLabel: z.ZodString;
    hours: z.ZodNumber;
    fans: z.ZodArray<z.ZodObject<{
        fanRef: z.ZodString;
        at: z.ZodString;
        kind: z.ZodString;
        by: z.ZodNullable<z.ZodObject<{
            name: z.ZodString;
            isMe: z.ZodBoolean;
        }, z.core.$strip>>;
        outreachId: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export type ClientOutreachPerson = z.infer<typeof clientOutreachPersonSchema>;
export type ClientOutreachSend = z.infer<typeof clientOutreachSendSchema>;
export type ClientOutreachOutcome = z.infer<typeof clientOutreachOutcomeSchema>;
export type ClientOutreachFan = z.infer<typeof clientOutreachFanSchema>;
export type ClientOutreach = z.infer<typeof clientOutreachSchema>;
export type ClientOutreachSummary = z.infer<typeof clientOutreachSummarySchema>;
export type ClientOutreachesResponse = z.infer<typeof clientOutreachesResponseSchema>;
export type ClientOutreachFanChange = z.infer<typeof clientOutreachFanChangeSchema>;
export type ClientOutreachSaveBody = z.infer<typeof clientOutreachSaveBodySchema>;
export type ClientOutreachSaveResponse = z.infer<typeof clientOutreachSaveResponseSchema>;
export type ClientOutreachSendBody = z.infer<typeof clientOutreachSendBodySchema>;
export type ClientOutreachSendResponse = z.infer<typeof clientOutreachSendResponseSchema>;
export type ClientOutreachTouch = z.infer<typeof clientOutreachTouchSchema>;
export type ClientOutreachTouchesResponse = z.infer<typeof clientOutreachTouchesResponseSchema>;
