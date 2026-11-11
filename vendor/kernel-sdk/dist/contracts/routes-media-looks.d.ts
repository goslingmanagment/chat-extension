export declare const mediaLookRouteSchemas: {
    readonly agentMediaLookCreate: {
        readonly auth: {
            readonly kind: "agentKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["agent"];
        readonly summary: string;
        readonly params: import("zod").ZodObject<{
            pageLabel: import("zod").ZodString;
        }, import("zod/v4/core").$strip>;
        readonly body: import("zod").ZodObject<{
            publicationId: import("zod").ZodOptional<import("zod").ZodNumber>;
            postRef: import("zod").ZodOptional<import("zod").ZodString>;
            mediaRef: import("zod").ZodOptional<import("zod").ZodString>;
            index: import("zod").ZodDefault<import("zod").ZodNumber>;
            cover: import("zod").ZodDefault<import("zod").ZodBoolean>;
            fresh: import("zod").ZodDefault<import("zod").ZodBoolean>;
            frames: import("zod").ZodDefault<import("zod").ZodEnum<{
                none: "none";
                inline: "inline";
            }>>;
        }, import("zod/v4/core").$strict>;
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
            readonly 429: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 503: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 200: import("zod").ZodObject<{
                lookId: import("zod").ZodNumber;
                status: import("zod").ZodEnum<{
                    ready: "ready";
                    failed: "failed";
                    queued: "queued";
                }>;
                failure: import("zod").ZodNullable<import("zod").ZodString>;
                target: import("zod").ZodObject<{
                    publicationId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    postRef: import("zod").ZodNullable<import("zod").ZodString>;
                    index: import("zod").ZodNullable<import("zod").ZodNumber>;
                    mediaRef: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>;
                source: import("zod").ZodEnum<{
                    schedule_read: "schedule_read";
                    post_read: "post_read";
                    vault_read: "vault_read";
                }>;
                requestsSent: import("zod").ZodNumber;
                media: import("zod").ZodObject<{
                    type: import("zod").ZodNullable<import("zod").ZodEnum<{
                        image: "image";
                        video: "video";
                    }>>;
                    durationMs: import("zod").ZodNullable<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strip>;
                coverage: import("zod").ZodNullable<import("zod").ZodEnum<{
                    per_second: "per_second";
                    sampled: "sampled";
                    cover_only: "cover_only";
                    whole_image: "whole_image";
                    first_frame: "first_frame";
                }>>;
                frameIntervalMs: import("zod").ZodNullable<import("zod").ZodNumber>;
                coverageNote: import("zod").ZodNullable<import("zod").ZodString>;
                frames: import("zod").ZodArray<import("zod").ZodObject<{
                    index: import("zod").ZodNumber;
                    atMs: import("zod").ZodNullable<import("zod").ZodNumber>;
                    width: import("zod").ZodNumber;
                    height: import("zod").ZodNumber;
                    jpegBase64: import("zod").ZodOptional<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>;
                cached: import("zod").ZodBoolean;
                budget: import("zod").ZodObject<{
                    usedToday: import("zod").ZodNumber;
                    limit: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly agentMediaLookGet: {
        readonly auth: {
            readonly kind: "agentKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["agent"];
        readonly summary: string;
        readonly params: import("zod").ZodObject<{
            pageLabel: import("zod").ZodString;
            lookId: import("zod").ZodCoercedNumber<unknown>;
        }, import("zod/v4/core").$strip>;
        readonly querystring: import("zod").ZodObject<{
            frames: import("zod").ZodDefault<import("zod").ZodEnum<{
                none: "none";
                inline: "inline";
            }>>;
        }, import("zod/v4/core").$strict>;
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
            readonly 429: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 503: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 200: import("zod").ZodObject<{
                lookId: import("zod").ZodNumber;
                status: import("zod").ZodEnum<{
                    ready: "ready";
                    failed: "failed";
                    queued: "queued";
                }>;
                failure: import("zod").ZodNullable<import("zod").ZodString>;
                target: import("zod").ZodObject<{
                    publicationId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    postRef: import("zod").ZodNullable<import("zod").ZodString>;
                    index: import("zod").ZodNullable<import("zod").ZodNumber>;
                    mediaRef: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>;
                source: import("zod").ZodEnum<{
                    schedule_read: "schedule_read";
                    post_read: "post_read";
                    vault_read: "vault_read";
                }>;
                requestsSent: import("zod").ZodNumber;
                media: import("zod").ZodObject<{
                    type: import("zod").ZodNullable<import("zod").ZodEnum<{
                        image: "image";
                        video: "video";
                    }>>;
                    durationMs: import("zod").ZodNullable<import("zod").ZodNumber>;
                }, import("zod/v4/core").$strip>;
                coverage: import("zod").ZodNullable<import("zod").ZodEnum<{
                    per_second: "per_second";
                    sampled: "sampled";
                    cover_only: "cover_only";
                    whole_image: "whole_image";
                    first_frame: "first_frame";
                }>>;
                frameIntervalMs: import("zod").ZodNullable<import("zod").ZodNumber>;
                coverageNote: import("zod").ZodNullable<import("zod").ZodString>;
                frames: import("zod").ZodArray<import("zod").ZodObject<{
                    index: import("zod").ZodNumber;
                    atMs: import("zod").ZodNullable<import("zod").ZodNumber>;
                    width: import("zod").ZodNumber;
                    height: import("zod").ZodNumber;
                    jpegBase64: import("zod").ZodOptional<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>;
                cached: import("zod").ZodBoolean;
                budget: import("zod").ZodObject<{
                    usedToday: import("zod").ZodNumber;
                    limit: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>;
            }, import("zod/v4/core").$strip>;
        };
    };
};
