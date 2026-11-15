/**
 * «Обучение» (products plan 2026-11-13 §2.3): the pages an agent publishes from /OS for the chat team (a chatter's job
 * description, the SOPs) through the agent-reports door (`hub report put … --section learn`), read in Workboard by every
 * role once the owner approved them. The owner sees every page of the section and approves or takes back each; anyone
 * else only the approved ones (another page is 404, the same as one that does not exist). Database only.
 */
import { z } from "zod";
export declare const learnPageMetaSchema: z.ZodObject<{
    slug: z.ZodString;
    title: z.ZodString;
    section: z.ZodEnum<{
        content: "content";
        system: "system";
        team: "team";
        traffic: "traffic";
        learn: "learn";
    }>;
    teamLeads: z.ZodBoolean;
    validHours: z.ZodNullable<z.ZodNumber>;
    version: z.ZodNumber;
    publishedAt: z.ZodString;
    publishedBy: z.ZodNullable<z.ZodObject<{
        agentKeyId: z.ZodNumber;
        name: z.ZodString;
    }, z.core.$strip>>;
    bytes: z.ZodNumber;
    staleAt: z.ZodNullable<z.ZodString>;
    stale: z.ZodBoolean;
    approved: z.ZodBoolean;
}, z.core.$strip>;
export type LearnPageMeta = z.infer<typeof learnPageMetaSchema>;
export declare const learnPagesResponseSchema: z.ZodObject<{
    pages: z.ZodArray<z.ZodObject<{
        slug: z.ZodString;
        title: z.ZodString;
        section: z.ZodEnum<{
            content: "content";
            system: "system";
            team: "team";
            traffic: "traffic";
            learn: "learn";
        }>;
        teamLeads: z.ZodBoolean;
        validHours: z.ZodNullable<z.ZodNumber>;
        version: z.ZodNumber;
        publishedAt: z.ZodString;
        publishedBy: z.ZodNullable<z.ZodObject<{
            agentKeyId: z.ZodNumber;
            name: z.ZodString;
        }, z.core.$strip>>;
        bytes: z.ZodNumber;
        staleAt: z.ZodNullable<z.ZodString>;
        stale: z.ZodBoolean;
        approved: z.ZodBoolean;
    }, z.core.$strip>>;
    canApprove: z.ZodBoolean;
    serverNow: z.ZodString;
}, z.core.$strip>;
export type LearnPagesResponse = z.infer<typeof learnPagesResponseSchema>;
export declare const learnPageParamsSchema: z.ZodObject<{
    slug: z.ZodString;
}, z.core.$strip>;
export declare const learnPageResponseSchema: z.ZodObject<{
    page: z.ZodObject<{
        slug: z.ZodString;
        title: z.ZodString;
        section: z.ZodEnum<{
            content: "content";
            system: "system";
            team: "team";
            traffic: "traffic";
            learn: "learn";
        }>;
        teamLeads: z.ZodBoolean;
        validHours: z.ZodNullable<z.ZodNumber>;
        version: z.ZodNumber;
        publishedAt: z.ZodString;
        publishedBy: z.ZodNullable<z.ZodObject<{
            agentKeyId: z.ZodNumber;
            name: z.ZodString;
        }, z.core.$strip>>;
        bytes: z.ZodNumber;
        staleAt: z.ZodNullable<z.ZodString>;
        stale: z.ZodBoolean;
        approved: z.ZodBoolean;
        body: z.ZodString;
    }, z.core.$strip>;
    canApprove: z.ZodBoolean;
    serverNow: z.ZodString;
}, z.core.$strip>;
export type LearnPageResponse = z.infer<typeof learnPageResponseSchema>;
export declare const learnPageApproveBodySchema: z.ZodObject<{
    approved: z.ZodBoolean;
}, z.core.$strict>;
export declare const learnPageApproveResponseSchema: z.ZodObject<{
    page: z.ZodObject<{
        slug: z.ZodString;
        title: z.ZodString;
        section: z.ZodEnum<{
            content: "content";
            system: "system";
            team: "team";
            traffic: "traffic";
            learn: "learn";
        }>;
        teamLeads: z.ZodBoolean;
        validHours: z.ZodNullable<z.ZodNumber>;
        version: z.ZodNumber;
        publishedAt: z.ZodString;
        publishedBy: z.ZodNullable<z.ZodObject<{
            agentKeyId: z.ZodNumber;
            name: z.ZodString;
        }, z.core.$strip>>;
        bytes: z.ZodNumber;
        staleAt: z.ZodNullable<z.ZodString>;
        stale: z.ZodBoolean;
        approved: z.ZodBoolean;
    }, z.core.$strip>;
    savedAt: z.ZodString;
}, z.core.$strip>;
export declare const learnRouteSchemas: {
    readonly learnPages: {
        readonly auth: {
            readonly kind: "any-session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "The pages of «Обучение»: every one for the owner, the approved ones for anyone else";
        readonly description: "Any session (the extension's narrow one too). Database only.";
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
                pages: z.ZodArray<z.ZodObject<{
                    slug: z.ZodString;
                    title: z.ZodString;
                    section: z.ZodEnum<{
                        content: "content";
                        system: "system";
                        team: "team";
                        traffic: "traffic";
                        learn: "learn";
                    }>;
                    teamLeads: z.ZodBoolean;
                    validHours: z.ZodNullable<z.ZodNumber>;
                    version: z.ZodNumber;
                    publishedAt: z.ZodString;
                    publishedBy: z.ZodNullable<z.ZodObject<{
                        agentKeyId: z.ZodNumber;
                        name: z.ZodString;
                    }, z.core.$strip>>;
                    bytes: z.ZodNumber;
                    staleAt: z.ZodNullable<z.ZodString>;
                    stale: z.ZodBoolean;
                    approved: z.ZodBoolean;
                }, z.core.$strip>>;
                canApprove: z.ZodBoolean;
                serverNow: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly learnPage: {
        readonly auth: {
            readonly kind: "any-session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "One page of «Обучение» with its text";
        readonly description: "Any session; a page the owner did not approve is the owner's alone (404 to anyone else).";
        readonly params: z.ZodObject<{
            slug: z.ZodString;
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
                page: z.ZodObject<{
                    slug: z.ZodString;
                    title: z.ZodString;
                    section: z.ZodEnum<{
                        content: "content";
                        system: "system";
                        team: "team";
                        traffic: "traffic";
                        learn: "learn";
                    }>;
                    teamLeads: z.ZodBoolean;
                    validHours: z.ZodNullable<z.ZodNumber>;
                    version: z.ZodNumber;
                    publishedAt: z.ZodString;
                    publishedBy: z.ZodNullable<z.ZodObject<{
                        agentKeyId: z.ZodNumber;
                        name: z.ZodString;
                    }, z.core.$strip>>;
                    bytes: z.ZodNumber;
                    staleAt: z.ZodNullable<z.ZodString>;
                    stale: z.ZodBoolean;
                    approved: z.ZodBoolean;
                    body: z.ZodString;
                }, z.core.$strip>;
                canApprove: z.ZodBoolean;
                serverNow: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly learnPageApprove: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "The owner approves a page of «Обучение» for the team, or takes the approval back";
        readonly description: "The owner's full session. An approval holds across the agent's republishing of the page.";
        readonly params: z.ZodObject<{
            slug: z.ZodString;
        }, z.core.$strip>;
        readonly body: z.ZodObject<{
            approved: z.ZodBoolean;
        }, z.core.$strict>;
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
                page: z.ZodObject<{
                    slug: z.ZodString;
                    title: z.ZodString;
                    section: z.ZodEnum<{
                        content: "content";
                        system: "system";
                        team: "team";
                        traffic: "traffic";
                        learn: "learn";
                    }>;
                    teamLeads: z.ZodBoolean;
                    validHours: z.ZodNullable<z.ZodNumber>;
                    version: z.ZodNumber;
                    publishedAt: z.ZodString;
                    publishedBy: z.ZodNullable<z.ZodObject<{
                        agentKeyId: z.ZodNumber;
                        name: z.ZodString;
                    }, z.core.$strip>>;
                    bytes: z.ZodNumber;
                    staleAt: z.ZodNullable<z.ZodString>;
                    stale: z.ZodBoolean;
                    approved: z.ZodBoolean;
                }, z.core.$strip>;
                savedAt: z.ZodString;
            }, z.core.$strip>;
        };
    };
};
