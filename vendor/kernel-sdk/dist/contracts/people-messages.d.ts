import { z } from "zod";
/**
 * Система → «Сообщения людям» (ecosystem plan 2026-11-12, package S): the
 * server's own sender of messages to people in Telegram, off twice — no bot
 * token, no kind on. The owner's screen shows each kind, its exact template, an
 * example from the newest real object, whether it is on, and the messages held
 * in the last 7 days word for word. A message's states: `held` (nothing left
 * the server), `sending` (the one attempt is under way), `sent`, `failed`,
 * `unknown` (the attempt did not say: never repeated by itself).
 */
export declare const peopleMessageKindSchema: z.ZodEnum<{
    "shift.report.copy": "shift.report.copy";
    "custom.card.to_model": "custom.card.to_model";
    "shift.report.missing": "shift.report.missing";
    "custom.shot.give": "custom.shot.give";
    "claim.confirm": "claim.confirm";
    "payout.text": "payout.text";
    "newcomer.invite": "newcomer.invite";
}>;
export declare const peopleMessageStateSchema: z.ZodEnum<{
    unknown: "unknown";
    failed: "failed";
    sent: "sent";
    sending: "sending";
    held: "held";
}>;
export type PeopleMessageState = z.infer<typeof peopleMessageStateSchema>;
/** Why a message was held: the kind off, no token, no recipient, the day's cap, an event before the kind was turned on. */
export declare const peopleMessageHeldReasonSchema: z.ZodEnum<{
    cap: "cap";
    kind_off: "kind_off";
    no_token: "no_token";
    no_telegram: "no_telegram";
    no_chat: "no_chat";
    before_on: "before_on";
}>;
export type PeopleMessageHeldReason = z.infer<typeof peopleMessageHeldReasonSchema>;
/** Who a kind writes to: a work chat's topic, a person, a person on the owner's press. */
export declare const peopleMessageAudienceSchema: z.ZodEnum<{
    group: "group";
    person: "person";
    press: "press";
}>;
export declare const peopleMessageRowSchema: z.ZodObject<{
    id: z.ZodNumber;
    at: z.ZodString;
    to: z.ZodString;
    about: z.ZodString;
    text: z.ZodString;
    state: z.ZodEnum<{
        unknown: "unknown";
        failed: "failed";
        sent: "sent";
        sending: "sending";
        held: "held";
    }>;
    reason: z.ZodNullable<z.ZodEnum<{
        cap: "cap";
        kind_off: "kind_off";
        no_token: "no_token";
        no_telegram: "no_telegram";
        no_chat: "no_chat";
        before_on: "before_on";
    }>>;
    words: z.ZodString;
}, z.core.$strip>;
export type PeopleMessageRow = z.infer<typeof peopleMessageRowSchema>;
export declare const peopleMessageKindViewSchema: z.ZodObject<{
    kind: z.ZodEnum<{
        "shift.report.copy": "shift.report.copy";
        "custom.card.to_model": "custom.card.to_model";
        "shift.report.missing": "shift.report.missing";
        "custom.shot.give": "custom.shot.give";
        "claim.confirm": "claim.confirm";
        "payout.text": "payout.text";
        "newcomer.invite": "newcomer.invite";
    }>;
    title: z.ZodString;
    audience: z.ZodEnum<{
        group: "group";
        person: "person";
        press: "press";
    }>;
    toWhom: z.ZodString;
    when: z.ZodString;
    template: z.ZodString;
    example: z.ZodNullable<z.ZodObject<{
        text: z.ZodString;
        about: z.ZodString;
    }, z.core.$strip>>;
    exampleMissing: z.ZodNullable<z.ZodString>;
    on: z.ZodBoolean;
    onSince: z.ZodNullable<z.ZodString>;
    lastSwitch: z.ZodNullable<z.ZodObject<{
        at: z.ZodString;
        by: z.ZodString;
        on: z.ZodBoolean;
    }, z.core.$strip>>;
    trigger: z.ZodEnum<{
        ready: "ready";
        not_connected: "not_connected";
    }>;
    triggerNote: z.ZodNullable<z.ZodString>;
    cap: z.ZodNumber;
    capWords: z.ZodString;
    quietWords: z.ZodString;
    needs: z.ZodArray<z.ZodString>;
    onSentence: z.ZodString;
    blockedFor: z.ZodArray<z.ZodString>;
    counts: z.ZodObject<{
        held: z.ZodNumber;
        sent: z.ZodNumber;
        failed: z.ZodNumber;
        unknown: z.ZodNumber;
    }, z.core.$strip>;
    held: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        at: z.ZodString;
        to: z.ZodString;
        about: z.ZodString;
        text: z.ZodString;
        state: z.ZodEnum<{
            unknown: "unknown";
            failed: "failed";
            sent: "sent";
            sending: "sending";
            held: "held";
        }>;
        reason: z.ZodNullable<z.ZodEnum<{
            cap: "cap";
            kind_off: "kind_off";
            no_token: "no_token";
            no_telegram: "no_telegram";
            no_chat: "no_chat";
            before_on: "before_on";
        }>>;
        words: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type PeopleMessageKindView = z.infer<typeof peopleMessageKindViewSchema>;
export declare const peopleMessagesResponseSchema: z.ZodObject<{
    tokenSet: z.ZodBoolean;
    sentence: z.ZodString;
    kindsVersion: z.ZodNullable<z.ZodNumber>;
    chats: z.ZodArray<z.ZodObject<{
        modelSlug: z.ZodString;
        modelName: z.ZodString;
        reports: z.ZodBoolean;
        customs: z.ZodBoolean;
    }, z.core.$strip>>;
    kinds: z.ZodArray<z.ZodObject<{
        kind: z.ZodEnum<{
            "shift.report.copy": "shift.report.copy";
            "custom.card.to_model": "custom.card.to_model";
            "shift.report.missing": "shift.report.missing";
            "custom.shot.give": "custom.shot.give";
            "claim.confirm": "claim.confirm";
            "payout.text": "payout.text";
            "newcomer.invite": "newcomer.invite";
        }>;
        title: z.ZodString;
        audience: z.ZodEnum<{
            group: "group";
            person: "person";
            press: "press";
        }>;
        toWhom: z.ZodString;
        when: z.ZodString;
        template: z.ZodString;
        example: z.ZodNullable<z.ZodObject<{
            text: z.ZodString;
            about: z.ZodString;
        }, z.core.$strip>>;
        exampleMissing: z.ZodNullable<z.ZodString>;
        on: z.ZodBoolean;
        onSince: z.ZodNullable<z.ZodString>;
        lastSwitch: z.ZodNullable<z.ZodObject<{
            at: z.ZodString;
            by: z.ZodString;
            on: z.ZodBoolean;
        }, z.core.$strip>>;
        trigger: z.ZodEnum<{
            ready: "ready";
            not_connected: "not_connected";
        }>;
        triggerNote: z.ZodNullable<z.ZodString>;
        cap: z.ZodNumber;
        capWords: z.ZodString;
        quietWords: z.ZodString;
        needs: z.ZodArray<z.ZodString>;
        onSentence: z.ZodString;
        blockedFor: z.ZodArray<z.ZodString>;
        counts: z.ZodObject<{
            held: z.ZodNumber;
            sent: z.ZodNumber;
            failed: z.ZodNumber;
            unknown: z.ZodNumber;
        }, z.core.$strip>;
        held: z.ZodArray<z.ZodObject<{
            id: z.ZodNumber;
            at: z.ZodString;
            to: z.ZodString;
            about: z.ZodString;
            text: z.ZodString;
            state: z.ZodEnum<{
                unknown: "unknown";
                failed: "failed";
                sent: "sent";
                sending: "sending";
                held: "held";
            }>;
            reason: z.ZodNullable<z.ZodEnum<{
                cap: "cap";
                kind_off: "kind_off";
                no_token: "no_token";
                no_telegram: "no_telegram";
                no_chat: "no_chat";
                before_on: "before_on";
            }>>;
            words: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export type PeopleMessagesResponse = z.infer<typeof peopleMessagesResponseSchema>;
export declare const peopleMessageKindParamsSchema: z.ZodObject<{
    kind: z.ZodEnum<{
        "shift.report.copy": "shift.report.copy";
        "custom.card.to_model": "custom.card.to_model";
        "shift.report.missing": "shift.report.missing";
        "custom.shot.give": "custom.shot.give";
        "claim.confirm": "claim.confirm";
        "payout.text": "payout.text";
        "newcomer.invite": "newcomer.invite";
    }>;
}, z.core.$strip>;
export declare const peopleMessageSwitchBodySchema: z.ZodObject<{
    on: z.ZodBoolean;
    expectedVersion: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type PeopleMessageSwitchBody = z.infer<typeof peopleMessageSwitchBodySchema>;
export declare const peopleMessageSwitchResponseSchema: z.ZodObject<{
    kind: z.ZodEnum<{
        "shift.report.copy": "shift.report.copy";
        "custom.card.to_model": "custom.card.to_model";
        "shift.report.missing": "shift.report.missing";
        "custom.shot.give": "custom.shot.give";
        "claim.confirm": "claim.confirm";
        "payout.text": "payout.text";
        "newcomer.invite": "newcomer.invite";
    }>;
    on: z.ZodBoolean;
    onSince: z.ZodNullable<z.ZodString>;
    sentence: z.ZodString;
    kindsVersion: z.ZodNumber;
    audit: z.ZodObject<{
        at: z.ZodString;
        by: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>;
export type PeopleMessageSwitchResponse = z.infer<typeof peopleMessageSwitchResponseSchema>;
/** The kinds the owner sends by a press: the payout text, the invitation. */
export declare const peopleMessagePressKindSchema: z.ZodEnum<{
    "payout.text": "payout.text";
    "newcomer.invite": "newcomer.invite";
}>;
export declare const peopleMessagePressBodySchema: z.ZodObject<{
    kind: z.ZodEnum<{
        "payout.text": "payout.text";
        "newcomer.invite": "newcomer.invite";
    }>;
    person: z.ZodOptional<z.ZodString>;
    userId: z.ZodOptional<z.ZodNumber>;
    text: z.ZodString;
}, z.core.$strip>;
export type PeopleMessagePressBody = z.infer<typeof peopleMessagePressBodySchema>;
/** Whom the press would reach: the button's place on Workboard asks before it shows anything. */
export declare const peopleMessageRecipientQuerySchema: z.ZodObject<{
    kind: z.ZodEnum<{
        "payout.text": "payout.text";
        "newcomer.invite": "newcomer.invite";
    }>;
    person: z.ZodOptional<z.ZodString>;
    userId: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export type PeopleMessageRecipientQuery = z.infer<typeof peopleMessageRecipientQuerySchema>;
export declare const peopleMessageRecipientResponseSchema: z.ZodObject<{
    kind: z.ZodEnum<{
        "payout.text": "payout.text";
        "newcomer.invite": "newcomer.invite";
    }>;
    shown: z.ZodBoolean;
    sendable: z.ZodBoolean;
    label: z.ZodNullable<z.ZodString>;
    why: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export type PeopleMessageRecipientResponse = z.infer<typeof peopleMessageRecipientResponseSchema>;
export declare const peopleMessagePressResponseSchema: z.ZodObject<{
    id: z.ZodNullable<z.ZodNumber>;
    state: z.ZodUnion<readonly [z.ZodEnum<{
        unknown: "unknown";
        failed: "failed";
        sent: "sent";
        sending: "sending";
        held: "held";
    }>, z.ZodLiteral<"duplicate">]>;
    reason: z.ZodNullable<z.ZodEnum<{
        cap: "cap";
        kind_off: "kind_off";
        no_token: "no_token";
        no_telegram: "no_telegram";
        no_chat: "no_chat";
        before_on: "before_on";
    }>>;
    words: z.ZodString;
}, z.core.$strip>;
export type PeopleMessagePressResponse = z.infer<typeof peopleMessagePressResponseSchema>;
