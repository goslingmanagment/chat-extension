import { z } from "zod";
export declare const agentReportRouteSchemas: {
    readonly agentReportPut: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: string;
        readonly description: string;
        readonly params: z.ZodObject<{
            slug: z.ZodString;
        }, z.core.$strip>;
        readonly body: z.ZodObject<{
            title: z.ZodString;
            section: z.ZodEnum<{
                content: "content";
                system: "system";
                team: "team";
                traffic: "traffic";
            }>;
            body: z.ZodString;
            teamLeads: z.ZodOptional<z.ZodBoolean>;
            validHours: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
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
            readonly 429: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 503: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 200: z.ZodObject<{
                report: z.ZodObject<{
                    slug: z.ZodString;
                    title: z.ZodString;
                    section: z.ZodEnum<{
                        content: "content";
                        system: "system";
                        team: "team";
                        traffic: "traffic";
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
                }, z.core.$strip>;
                changed: z.ZodBoolean;
            }, z.core.$strip>;
        };
    };
    readonly agentReportList: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: string;
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
            readonly 429: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 503: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 200: z.ZodObject<{
                reports: z.ZodArray<z.ZodObject<{
                    slug: z.ZodString;
                    title: z.ZodString;
                    section: z.ZodEnum<{
                        content: "content";
                        system: "system";
                        team: "team";
                        traffic: "traffic";
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
                }, z.core.$strip>>;
                serverNow: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly reportsList: {
        readonly auth: {
            readonly kind: "session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "The report pages agents published, without bodies: the owner's every one, a team lead's those opened to team leads";
        readonly description: "Database only. Newest first. `stale` says the page is older than the validity its agent gave it.";
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
                reports: z.ZodArray<z.ZodObject<{
                    slug: z.ZodString;
                    title: z.ZodString;
                    section: z.ZodEnum<{
                        content: "content";
                        system: "system";
                        team: "team";
                        traffic: "traffic";
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
                }, z.core.$strip>>;
                serverNow: z.ZodString;
            }, z.core.$strip>;
        };
    };
    readonly reportGet: {
        readonly auth: {
            readonly kind: "session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "One report page with its markdown body; a report a team lead may not read is 404, as one that does not exist";
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
                report: z.ZodObject<{
                    slug: z.ZodString;
                    title: z.ZodString;
                    section: z.ZodEnum<{
                        content: "content";
                        system: "system";
                        team: "team";
                        traffic: "traffic";
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
                    body: z.ZodString;
                }, z.core.$strip>;
                serverNow: z.ZodString;
            }, z.core.$strip>;
        };
    };
};
