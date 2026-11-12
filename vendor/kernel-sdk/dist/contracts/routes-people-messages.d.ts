export declare const peopleMessageRouteSchemas: {
    readonly peopleMessages: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "Система → Сообщения людям: every kind with its template, an example, whether it is on and what was held";
        readonly description: string;
        readonly response: {
            readonly 200: import("zod").ZodObject<{
                tokenSet: import("zod").ZodBoolean;
                sentence: import("zod").ZodString;
                kindsVersion: import("zod").ZodNullable<import("zod").ZodNumber>;
                chats: import("zod").ZodArray<import("zod").ZodObject<{
                    modelSlug: import("zod").ZodString;
                    modelName: import("zod").ZodString;
                    reports: import("zod").ZodBoolean;
                    customs: import("zod").ZodBoolean;
                }, import("zod/v4/core").$strip>>;
                kinds: import("zod").ZodArray<import("zod").ZodObject<{
                    kind: import("zod").ZodEnum<{
                        "shift.report.copy": "shift.report.copy";
                        "custom.card.to_model": "custom.card.to_model";
                        "shift.report.missing": "shift.report.missing";
                        "custom.shot.give": "custom.shot.give";
                        "claim.confirm": "claim.confirm";
                        "payout.text": "payout.text";
                        "newcomer.invite": "newcomer.invite";
                    }>;
                    title: import("zod").ZodString;
                    audience: import("zod").ZodEnum<{
                        group: "group";
                        person: "person";
                        press: "press";
                    }>;
                    toWhom: import("zod").ZodString;
                    when: import("zod").ZodString;
                    template: import("zod").ZodString;
                    example: import("zod").ZodNullable<import("zod").ZodObject<{
                        text: import("zod").ZodString;
                        about: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                    exampleMissing: import("zod").ZodNullable<import("zod").ZodString>;
                    on: import("zod").ZodBoolean;
                    onSince: import("zod").ZodNullable<import("zod").ZodString>;
                    lastSwitch: import("zod").ZodNullable<import("zod").ZodObject<{
                        at: import("zod").ZodString;
                        by: import("zod").ZodString;
                        on: import("zod").ZodBoolean;
                    }, import("zod/v4/core").$strip>>;
                    trigger: import("zod").ZodEnum<{
                        ready: "ready";
                        not_connected: "not_connected";
                    }>;
                    triggerNote: import("zod").ZodNullable<import("zod").ZodString>;
                    cap: import("zod").ZodNumber;
                    capWords: import("zod").ZodString;
                    quietWords: import("zod").ZodString;
                    needs: import("zod").ZodArray<import("zod").ZodString>;
                    onSentence: import("zod").ZodString;
                    blockedFor: import("zod").ZodArray<import("zod").ZodString>;
                    counts: import("zod").ZodObject<{
                        held: import("zod").ZodNumber;
                        sent: import("zod").ZodNumber;
                        failed: import("zod").ZodNumber;
                        unknown: import("zod").ZodNumber;
                    }, import("zod/v4/core").$strip>;
                    held: import("zod").ZodArray<import("zod").ZodObject<{
                        id: import("zod").ZodNumber;
                        at: import("zod").ZodString;
                        to: import("zod").ZodString;
                        about: import("zod").ZodString;
                        text: import("zod").ZodString;
                        state: import("zod").ZodEnum<{
                            unknown: "unknown";
                            failed: "failed";
                            sent: "sent";
                            sending: "sending";
                            held: "held";
                        }>;
                        reason: import("zod").ZodNullable<import("zod").ZodEnum<{
                            cap: "cap";
                            kind_off: "kind_off";
                            no_token: "no_token";
                            no_telegram: "no_telegram";
                            no_chat: "no_chat";
                            before_on: "before_on";
                        }>>;
                        words: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                }, import("zod/v4/core").$strip>>;
                serverNow: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
            readonly 401: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 403: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly peopleMessageSwitch: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "Turn one kind of messages to people on or off (the owner's word, audited)";
        readonly description: string;
        readonly params: import("zod").ZodObject<{
            kind: import("zod").ZodEnum<{
                "shift.report.copy": "shift.report.copy";
                "custom.card.to_model": "custom.card.to_model";
                "shift.report.missing": "shift.report.missing";
                "custom.shot.give": "custom.shot.give";
                "claim.confirm": "claim.confirm";
                "payout.text": "payout.text";
                "newcomer.invite": "newcomer.invite";
            }>;
        }, import("zod/v4/core").$strip>;
        readonly body: import("zod").ZodObject<{
            on: import("zod").ZodBoolean;
            expectedVersion: import("zod").ZodOptional<import("zod").ZodNumber>;
        }, import("zod/v4/core").$strip>;
        readonly response: {
            readonly 400: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 401: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 403: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 404: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 409: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 200: import("zod").ZodObject<{
                kind: import("zod").ZodEnum<{
                    "shift.report.copy": "shift.report.copy";
                    "custom.card.to_model": "custom.card.to_model";
                    "shift.report.missing": "shift.report.missing";
                    "custom.shot.give": "custom.shot.give";
                    "claim.confirm": "claim.confirm";
                    "payout.text": "payout.text";
                    "newcomer.invite": "newcomer.invite";
                }>;
                on: import("zod").ZodBoolean;
                onSince: import("zod").ZodNullable<import("zod").ZodString>;
                sentence: import("zod").ZodString;
                kindsVersion: import("zod").ZodNumber;
                audit: import("zod").ZodObject<{
                    at: import("zod").ZodString;
                    by: import("zod").ZodString;
                }, import("zod/v4/core").$strip>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly peopleMessageRecipient: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "Whether the owner's press would reach the person: the button's words, or the one line why it cannot";
        readonly description: string;
        readonly querystring: import("zod").ZodObject<{
            kind: import("zod").ZodEnum<{
                "payout.text": "payout.text";
                "newcomer.invite": "newcomer.invite";
            }>;
            person: import("zod").ZodOptional<import("zod").ZodString>;
            userId: import("zod").ZodOptional<import("zod").ZodCoercedNumber<unknown>>;
        }, import("zod/v4/core").$strip>;
        readonly response: {
            readonly 400: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 401: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 403: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 404: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 409: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 200: import("zod").ZodObject<{
                kind: import("zod").ZodEnum<{
                    "payout.text": "payout.text";
                    "newcomer.invite": "newcomer.invite";
                }>;
                shown: import("zod").ZodBoolean;
                sendable: import("zod").ZodBoolean;
                label: import("zod").ZodNullable<import("zod").ZodString>;
                why: import("zod").ZodNullable<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly peopleMessagePress: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "Send the payout text or the invitation to the person by Telegram (the owner's press)";
        readonly description: string;
        readonly body: import("zod").ZodObject<{
            kind: import("zod").ZodEnum<{
                "payout.text": "payout.text";
                "newcomer.invite": "newcomer.invite";
            }>;
            person: import("zod").ZodOptional<import("zod").ZodString>;
            userId: import("zod").ZodOptional<import("zod").ZodNumber>;
            text: import("zod").ZodString;
        }, import("zod/v4/core").$strip>;
        readonly response: {
            readonly 400: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 401: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 403: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 404: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 409: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 200: import("zod").ZodObject<{
                id: import("zod").ZodNullable<import("zod").ZodNumber>;
                state: import("zod").ZodUnion<readonly [import("zod").ZodEnum<{
                    unknown: "unknown";
                    failed: "failed";
                    sent: "sent";
                    sending: "sending";
                    held: "held";
                }>, import("zod").ZodLiteral<"duplicate">]>;
                reason: import("zod").ZodNullable<import("zod").ZodEnum<{
                    cap: "cap";
                    kind_off: "kind_off";
                    no_token: "no_token";
                    no_telegram: "no_telegram";
                    no_chat: "no_chat";
                    before_on: "before_on";
                }>>;
                words: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
        };
    };
};
