import { z } from "zod";
/**
 * Teams (products plan 2026-11-13 §4.2, package T): a team is a model. The team records (`team_roles`: «ведёт
 * команду», «ведёт кастомы», «видит команду») and a lead's notes on a shift review. Who may read and write is the
 * runtime's one place, services/teams.ts. Database only; no money anywhere.
 */
export declare const TEAM_ROLE_KINDS: readonly ["lead", "customs", "view"];
export type TeamRoleKindWire = (typeof TEAM_ROLE_KINDS)[number];
export declare const teamRolesResponseSchema: z.ZodObject<{
    models: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        slug: z.ZodString;
        name: z.ZodString;
        canGrant: z.ZodBoolean;
        canGrantLead: z.ZodBoolean;
        leadName: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    records: z.ZodArray<z.ZodObject<{
        personId: z.ZodNumber;
        personCode: z.ZodString;
        personName: z.ZodString;
        modelId: z.ZodNumber;
        kind: z.ZodEnum<{
            view: "view";
            customs: "customs";
            lead: "lead";
        }>;
        grantedByName: z.ZodNullable<z.ZodString>;
        grantedAt: z.ZodString;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export type TeamRolesResponse = z.infer<typeof teamRolesResponseSchema>;
export declare const teamRoleSetBodySchema: z.ZodObject<{
    personCode: z.ZodString;
    modelId: z.ZodNumber;
    kind: z.ZodEnum<{
        view: "view";
        customs: "customs";
        lead: "lead";
    }>;
    granted: z.ZodBoolean;
}, z.core.$strip>;
export type TeamRoleSetBody = z.infer<typeof teamRoleSetBodySchema>;
export declare const teamRoleSetResponseSchema: z.ZodObject<{
    changed: z.ZodBoolean;
    savedAt: z.ZodString;
}, z.core.$strip>;
export declare const reviewNotesQuerySchema: z.ZodObject<{
    userId: z.ZodCoercedNumber<unknown>;
    at: z.ZodISODateTime;
}, z.core.$strip>;
export declare const reviewNotesResponseSchema: z.ZodObject<{
    shiftId: z.ZodNullable<z.ZodNumber>;
    notes: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        chatKey: z.ZodNullable<z.ZodString>;
        authorName: z.ZodString;
        text: z.ZodString;
        createdAt: z.ZodString;
    }, z.core.$strip>>;
    canWrite: z.ZodBoolean;
    serverNow: z.ZodString;
}, z.core.$strip>;
export type ReviewNotesResponse = z.infer<typeof reviewNotesResponseSchema>;
export declare const reviewNoteAddBodySchema: z.ZodObject<{
    userId: z.ZodNumber;
    at: z.ZodISODateTime;
    chatKey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    text: z.ZodString;
}, z.core.$strip>;
export declare const reviewNoteAddResponseSchema: z.ZodObject<{
    id: z.ZodNumber;
    savedAt: z.ZodString;
}, z.core.$strip>;
export declare const teamRouteSchemas: {
    readonly teamRoles: {
        readonly auth: {
            readonly kind: "any-session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "The team records of the viewer's teams: who leads, who leads customs, who sees the team";
        readonly description: string;
        readonly response: {
            readonly 200: z.ZodObject<{
                models: z.ZodArray<z.ZodObject<{
                    id: z.ZodNumber;
                    slug: z.ZodString;
                    name: z.ZodString;
                    canGrant: z.ZodBoolean;
                    canGrantLead: z.ZodBoolean;
                    leadName: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
                records: z.ZodArray<z.ZodObject<{
                    personId: z.ZodNumber;
                    personCode: z.ZodString;
                    personName: z.ZodString;
                    modelId: z.ZodNumber;
                    kind: z.ZodEnum<{
                        view: "view";
                        customs: "customs";
                        lead: "lead";
                    }>;
                    grantedByName: z.ZodNullable<z.ZodString>;
                    grantedAt: z.ZodString;
                }, z.core.$strip>>;
                serverNow: z.ZodString;
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
        };
    };
    readonly teamRoleSet: {
        readonly auth: {
            readonly kind: "any-session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "Grant or take back «видит команду», «ведёт кастомы» (the model's lead, the owner) or «ведёт команду» (the owner)";
        readonly description: string;
        readonly body: z.ZodObject<{
            personCode: z.ZodString;
            modelId: z.ZodNumber;
            kind: z.ZodEnum<{
                view: "view";
                customs: "customs";
                lead: "lead";
            }>;
            granted: z.ZodBoolean;
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
            readonly 200: z.ZodObject<{
                changed: z.ZodBoolean;
                savedAt: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly reviewNotes: {
        readonly auth: {
            readonly kind: "any-session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "The notes on one shift review the viewer may read";
        readonly description: string;
        readonly querystring: z.ZodObject<{
            userId: z.ZodCoercedNumber<unknown>;
            at: z.ZodISODateTime;
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
            readonly 200: z.ZodObject<{
                shiftId: z.ZodNullable<z.ZodNumber>;
                notes: z.ZodArray<z.ZodObject<{
                    id: z.ZodNumber;
                    chatKey: z.ZodNullable<z.ZodString>;
                    authorName: z.ZodString;
                    text: z.ZodString;
                    createdAt: z.ZodString;
                }, z.core.$strip>>;
                canWrite: z.ZodBoolean;
                serverNow: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly reviewNoteAdd: {
        readonly auth: {
            readonly kind: "any-session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "A lead's (or the owner's) note to the chatter on a shift or one chat of it";
        readonly description: "The lead of a model of the shift, or the owner; a full session. Database only.";
        readonly body: z.ZodObject<{
            userId: z.ZodNumber;
            at: z.ZodISODateTime;
            chatKey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            text: z.ZodString;
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
            readonly 200: z.ZodObject<{
                id: z.ZodNumber;
                savedAt: z.ZodString;
            }, z.core.$strip>;
        };
    };
};
