/**
 * Hi's first messages (owner, 2026-10-25): a persona's own openers, which Hi
 * draws from on an empty chat, and how the fans each one went to answered.
 * Owner session only: the texts are prompt content.
 *
 * A text is never edited or deleted: the owner switches one off and adds
 * another, so the numbers stay with the words they counted.
 */
import { z } from "zod";
/** The hours of the day a text may go out in: [from, to) in `timeZone`
 *  (IANA), across midnight when from > to. */
export declare const adminAiPersonaOpenerHoursSchema: z.ZodObject<{
    from: z.ZodNumber;
    to: z.ZodNumber;
    timeZone: z.ZodString;
}, z.core.$strict>;
/** The greetings sent with one text, and how the fans answered. A greeting
 *  counts toward an answer once 72 hours passed, toward money once 14 days. */
export declare const adminAiPersonaOpenerOutcomeSchema: z.ZodObject<{
    sent: z.ZodNumber;
    edited: z.ZodNumber;
    matured: z.ZodNumber;
    replied: z.ZodNumber;
    talked: z.ZodNumber;
    maturedPaid: z.ZodNumber;
    paid: z.ZodNumber;
}, z.core.$strict>;
export declare const adminAiPersonaOpenerSchema: z.ZodObject<{
    id: z.ZodNumber;
    body: z.ZodString;
    audience: z.ZodEnum<{
        any: "any";
        bare: "bare";
    }>;
    hours: z.ZodNullable<z.ZodObject<{
        from: z.ZodNumber;
        to: z.ZodNumber;
        timeZone: z.ZodString;
    }, z.core.$strict>>;
    enabled: z.ZodBoolean;
    createdAt: z.ZodString;
    outcomes: z.ZodObject<{
        all: z.ZodObject<{
            sent: z.ZodNumber;
            edited: z.ZodNumber;
            matured: z.ZodNumber;
            replied: z.ZodNumber;
            talked: z.ZodNumber;
            maturedPaid: z.ZodNumber;
            paid: z.ZodNumber;
        }, z.core.$strict>;
        bare: z.ZodObject<{
            sent: z.ZodNumber;
            edited: z.ZodNumber;
            matured: z.ZodNumber;
            replied: z.ZodNumber;
            talked: z.ZodNumber;
            maturedPaid: z.ZodNumber;
            paid: z.ZodNumber;
        }, z.core.$strict>;
        named: z.ZodObject<{
            sent: z.ZodNumber;
            edited: z.ZodNumber;
            matured: z.ZodNumber;
            replied: z.ZodNumber;
            talked: z.ZodNumber;
            maturedPaid: z.ZodNumber;
            paid: z.ZodNumber;
        }, z.core.$strict>;
        other: z.ZodObject<{
            sent: z.ZodNumber;
            edited: z.ZodNumber;
            matured: z.ZodNumber;
            replied: z.ZodNumber;
            talked: z.ZodNumber;
            maturedPaid: z.ZodNumber;
            paid: z.ZodNumber;
        }, z.core.$strict>;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const adminAiPersonaOpenersResponseSchema: z.ZodObject<{
    personaKey: z.ZodString;
    openers: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        body: z.ZodString;
        audience: z.ZodEnum<{
            any: "any";
            bare: "bare";
        }>;
        hours: z.ZodNullable<z.ZodObject<{
            from: z.ZodNumber;
            to: z.ZodNumber;
            timeZone: z.ZodString;
        }, z.core.$strict>>;
        enabled: z.ZodBoolean;
        createdAt: z.ZodString;
        outcomes: z.ZodObject<{
            all: z.ZodObject<{
                sent: z.ZodNumber;
                edited: z.ZodNumber;
                matured: z.ZodNumber;
                replied: z.ZodNumber;
                talked: z.ZodNumber;
                maturedPaid: z.ZodNumber;
                paid: z.ZodNumber;
            }, z.core.$strict>;
            bare: z.ZodObject<{
                sent: z.ZodNumber;
                edited: z.ZodNumber;
                matured: z.ZodNumber;
                replied: z.ZodNumber;
                talked: z.ZodNumber;
                maturedPaid: z.ZodNumber;
                paid: z.ZodNumber;
            }, z.core.$strict>;
            named: z.ZodObject<{
                sent: z.ZodNumber;
                edited: z.ZodNumber;
                matured: z.ZodNumber;
                replied: z.ZodNumber;
                talked: z.ZodNumber;
                maturedPaid: z.ZodNumber;
                paid: z.ZodNumber;
            }, z.core.$strict>;
            other: z.ZodObject<{
                sent: z.ZodNumber;
                edited: z.ZodNumber;
                matured: z.ZodNumber;
                replied: z.ZodNumber;
                talked: z.ZodNumber;
                maturedPaid: z.ZodNumber;
                paid: z.ZodNumber;
            }, z.core.$strict>;
        }, z.core.$strict>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const adminAiPersonaOpenersParamsSchema: z.ZodObject<{
    key: z.ZodString;
}, z.core.$strip>;
export declare const adminAiPersonaOpenerParamsSchema: z.ZodObject<{
    key: z.ZodString;
    id: z.ZodCoercedNumber<unknown>;
}, z.core.$strip>;
export declare const adminAiPersonaOpenerCreateBodySchema: z.ZodObject<{
    body: z.ZodString;
    audience: z.ZodEnum<{
        any: "any";
        bare: "bare";
    }>;
    hours: z.ZodNullable<z.ZodObject<{
        from: z.ZodNumber;
        to: z.ZodNumber;
        timeZone: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const adminAiPersonaOpenerUpdateBodySchema: z.ZodObject<{
    enabled: z.ZodBoolean;
}, z.core.$strict>;
export type AdminAiPersonaOpener = z.infer<typeof adminAiPersonaOpenerSchema>;
export type AdminAiPersonaOpenerOutcome = z.infer<typeof adminAiPersonaOpenerOutcomeSchema>;
export type AdminAiPersonaOpenersResponse = z.infer<typeof adminAiPersonaOpenersResponseSchema>;
export type AdminAiPersonaOpenerCreateBody = z.infer<typeof adminAiPersonaOpenerCreateBodySchema>;
export type AdminAiPersonaOpenerUpdateBody = z.infer<typeof adminAiPersonaOpenerUpdateBodySchema>;
export declare const aiOpenerRouteSchemas: {
    readonly adminAiPersonaOpenersList: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "List a persona's Hi openers and how fans answered each one";
        readonly params: z.ZodObject<{
            key: z.ZodString;
        }, z.core.$strip>;
        readonly response: {
            readonly 200: z.ZodObject<{
                personaKey: z.ZodString;
                openers: z.ZodArray<z.ZodObject<{
                    id: z.ZodNumber;
                    body: z.ZodString;
                    audience: z.ZodEnum<{
                        any: "any";
                        bare: "bare";
                    }>;
                    hours: z.ZodNullable<z.ZodObject<{
                        from: z.ZodNumber;
                        to: z.ZodNumber;
                        timeZone: z.ZodString;
                    }, z.core.$strict>>;
                    enabled: z.ZodBoolean;
                    createdAt: z.ZodString;
                    outcomes: z.ZodObject<{
                        all: z.ZodObject<{
                            sent: z.ZodNumber;
                            edited: z.ZodNumber;
                            matured: z.ZodNumber;
                            replied: z.ZodNumber;
                            talked: z.ZodNumber;
                            maturedPaid: z.ZodNumber;
                            paid: z.ZodNumber;
                        }, z.core.$strict>;
                        bare: z.ZodObject<{
                            sent: z.ZodNumber;
                            edited: z.ZodNumber;
                            matured: z.ZodNumber;
                            replied: z.ZodNumber;
                            talked: z.ZodNumber;
                            maturedPaid: z.ZodNumber;
                            paid: z.ZodNumber;
                        }, z.core.$strict>;
                        named: z.ZodObject<{
                            sent: z.ZodNumber;
                            edited: z.ZodNumber;
                            matured: z.ZodNumber;
                            replied: z.ZodNumber;
                            talked: z.ZodNumber;
                            maturedPaid: z.ZodNumber;
                            paid: z.ZodNumber;
                        }, z.core.$strict>;
                        other: z.ZodObject<{
                            sent: z.ZodNumber;
                            edited: z.ZodNumber;
                            matured: z.ZodNumber;
                            replied: z.ZodNumber;
                            talked: z.ZodNumber;
                            maturedPaid: z.ZodNumber;
                            paid: z.ZodNumber;
                        }, z.core.$strict>;
                    }, z.core.$strict>;
                }, z.core.$strict>>;
            }, z.core.$strict>;
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
        };
    };
    readonly adminAiPersonaOpenerCreate: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "Add a Hi opener to a persona";
        readonly params: z.ZodObject<{
            key: z.ZodString;
        }, z.core.$strip>;
        readonly body: z.ZodObject<{
            body: z.ZodString;
            audience: z.ZodEnum<{
                any: "any";
                bare: "bare";
            }>;
            hours: z.ZodNullable<z.ZodObject<{
                from: z.ZodNumber;
                to: z.ZodNumber;
                timeZone: z.ZodString;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodObject<{
                personaKey: z.ZodString;
                openers: z.ZodArray<z.ZodObject<{
                    id: z.ZodNumber;
                    body: z.ZodString;
                    audience: z.ZodEnum<{
                        any: "any";
                        bare: "bare";
                    }>;
                    hours: z.ZodNullable<z.ZodObject<{
                        from: z.ZodNumber;
                        to: z.ZodNumber;
                        timeZone: z.ZodString;
                    }, z.core.$strict>>;
                    enabled: z.ZodBoolean;
                    createdAt: z.ZodString;
                    outcomes: z.ZodObject<{
                        all: z.ZodObject<{
                            sent: z.ZodNumber;
                            edited: z.ZodNumber;
                            matured: z.ZodNumber;
                            replied: z.ZodNumber;
                            talked: z.ZodNumber;
                            maturedPaid: z.ZodNumber;
                            paid: z.ZodNumber;
                        }, z.core.$strict>;
                        bare: z.ZodObject<{
                            sent: z.ZodNumber;
                            edited: z.ZodNumber;
                            matured: z.ZodNumber;
                            replied: z.ZodNumber;
                            talked: z.ZodNumber;
                            maturedPaid: z.ZodNumber;
                            paid: z.ZodNumber;
                        }, z.core.$strict>;
                        named: z.ZodObject<{
                            sent: z.ZodNumber;
                            edited: z.ZodNumber;
                            matured: z.ZodNumber;
                            replied: z.ZodNumber;
                            talked: z.ZodNumber;
                            maturedPaid: z.ZodNumber;
                            paid: z.ZodNumber;
                        }, z.core.$strict>;
                        other: z.ZodObject<{
                            sent: z.ZodNumber;
                            edited: z.ZodNumber;
                            matured: z.ZodNumber;
                            replied: z.ZodNumber;
                            talked: z.ZodNumber;
                            maturedPaid: z.ZodNumber;
                            paid: z.ZodNumber;
                        }, z.core.$strict>;
                    }, z.core.$strict>;
                }, z.core.$strict>>;
            }, z.core.$strict>;
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
        };
    };
    readonly adminAiPersonaOpenerUpdate: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "Switch a persona's Hi opener on or off";
        readonly params: z.ZodObject<{
            key: z.ZodString;
            id: z.ZodCoercedNumber<unknown>;
        }, z.core.$strip>;
        readonly body: z.ZodObject<{
            enabled: z.ZodBoolean;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodObject<{
                personaKey: z.ZodString;
                openers: z.ZodArray<z.ZodObject<{
                    id: z.ZodNumber;
                    body: z.ZodString;
                    audience: z.ZodEnum<{
                        any: "any";
                        bare: "bare";
                    }>;
                    hours: z.ZodNullable<z.ZodObject<{
                        from: z.ZodNumber;
                        to: z.ZodNumber;
                        timeZone: z.ZodString;
                    }, z.core.$strict>>;
                    enabled: z.ZodBoolean;
                    createdAt: z.ZodString;
                    outcomes: z.ZodObject<{
                        all: z.ZodObject<{
                            sent: z.ZodNumber;
                            edited: z.ZodNumber;
                            matured: z.ZodNumber;
                            replied: z.ZodNumber;
                            talked: z.ZodNumber;
                            maturedPaid: z.ZodNumber;
                            paid: z.ZodNumber;
                        }, z.core.$strict>;
                        bare: z.ZodObject<{
                            sent: z.ZodNumber;
                            edited: z.ZodNumber;
                            matured: z.ZodNumber;
                            replied: z.ZodNumber;
                            talked: z.ZodNumber;
                            maturedPaid: z.ZodNumber;
                            paid: z.ZodNumber;
                        }, z.core.$strict>;
                        named: z.ZodObject<{
                            sent: z.ZodNumber;
                            edited: z.ZodNumber;
                            matured: z.ZodNumber;
                            replied: z.ZodNumber;
                            talked: z.ZodNumber;
                            maturedPaid: z.ZodNumber;
                            paid: z.ZodNumber;
                        }, z.core.$strict>;
                        other: z.ZodObject<{
                            sent: z.ZodNumber;
                            edited: z.ZodNumber;
                            matured: z.ZodNumber;
                            replied: z.ZodNumber;
                            talked: z.ZodNumber;
                            maturedPaid: z.ZodNumber;
                            paid: z.ZodNumber;
                        }, z.core.$strict>;
                    }, z.core.$strict>;
                }, z.core.$strict>>;
            }, z.core.$strict>;
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
        };
    };
};
