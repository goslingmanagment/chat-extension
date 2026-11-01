export declare const outreachRouteSchemas: {
    readonly clientOutreaches: {
        readonly auth: {
            readonly kind: "apiKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["client"];
        readonly summary: string;
        readonly description: string;
        readonly params: import("zod").ZodObject<{
            pageLabel: import("zod").ZodString;
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
                pageLabel: import("zod").ZodString;
                outreaches: import("zod").ZodArray<import("zod").ZodObject<{
                    outreachId: import("zod").ZodString;
                    author: import("zod").ZodObject<{
                        name: import("zod").ZodString;
                        isMe: import("zod").ZodBoolean;
                    }, import("zod/v4/core").$strip>;
                    createdAt: import("zod").ZodString;
                    updatedAt: import("zod").ZodString;
                    updatedBy: import("zod").ZodObject<{
                        name: import("zod").ZodString;
                        isMe: import("zod").ZodBoolean;
                    }, import("zod/v4/core").$strip>;
                    text: import("zod").ZodString;
                    withMedia: import("zod").ZodBoolean;
                    fans: import("zod").ZodNumber;
                    written: import("zod").ZodNumber;
                    sent: import("zod").ZodNumber;
                    uncertain: import("zod").ZodNumber;
                    sending: import("zod").ZodNumber;
                    failed: import("zod").ZodNumber;
                    replied: import("zod").ZodNumber;
                    bought: import("zod").ZodNumber;
                    boughtMills: import("zod").ZodNumber;
                    lastSentAt: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>;
                serverNow: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly clientOutreach: {
        readonly auth: {
            readonly kind: "apiKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["client"];
        readonly summary: string;
        readonly description: string;
        readonly params: import("zod").ZodObject<{
            pageLabel: import("zod").ZodString;
            outreachId: import("zod").ZodString;
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
                outreachId: import("zod").ZodString;
                author: import("zod").ZodObject<{
                    name: import("zod").ZodString;
                    isMe: import("zod").ZodBoolean;
                }, import("zod/v4/core").$strip>;
                createdAt: import("zod").ZodString;
                updatedAt: import("zod").ZodString;
                updatedBy: import("zod").ZodObject<{
                    name: import("zod").ZodString;
                    isMe: import("zod").ZodBoolean;
                }, import("zod/v4/core").$strip>;
                text: import("zod").ZodString;
                withMedia: import("zod").ZodBoolean;
                settings: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>;
                order: import("zod").ZodArray<import("zod").ZodString>;
                fans: import("zod").ZodArray<import("zod").ZodObject<{
                    fanRef: import("zod").ZodString;
                    version: import("zod").ZodNullable<import("zod").ZodString>;
                    basis: import("zod").ZodNullable<import("zod").ZodString>;
                    versionAt: import("zod").ZodNullable<import("zod").ZodString>;
                    edit: import("zod").ZodNullable<import("zod").ZodString>;
                    editedBy: import("zod").ZodNullable<import("zod").ZodObject<{
                        name: import("zod").ZodString;
                        isMe: import("zod").ZodBoolean;
                    }, import("zod/v4/core").$strip>>;
                    editedAt: import("zod").ZodNullable<import("zod").ZodString>;
                    send: import("zod").ZodNullable<import("zod").ZodObject<{
                        state: import("zod").ZodString;
                        attemptId: import("zod").ZodString;
                        by: import("zod").ZodObject<{
                            name: import("zod").ZodString;
                            isMe: import("zod").ZodBoolean;
                        }, import("zod/v4/core").$strip>;
                        clickedAt: import("zod").ZodString;
                        ticketUntil: import("zod").ZodNullable<import("zod").ZodString>;
                        sentAt: import("zod").ZodNullable<import("zod").ZodString>;
                        code: import("zod").ZodNullable<import("zod").ZodString>;
                        text: import("zod").ZodNullable<import("zod").ZodString>;
                        media: import("zod").ZodNullable<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>>;
                        platformMessageId: import("zod").ZodNullable<import("zod").ZodString>;
                        resolvedBy: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    outcome: import("zod").ZodNullable<import("zod").ZodObject<{
                        replied: import("zod").ZodNullable<import("zod").ZodObject<{
                            at: import("zod").ZodString;
                            text: import("zod").ZodNullable<import("zod").ZodString>;
                        }, import("zod/v4/core").$strip>>;
                        bought: import("zod").ZodNullable<import("zod").ZodObject<{
                            mills: import("zod").ZodNumber;
                            at: import("zod").ZodString;
                        }, import("zod/v4/core").$strip>>;
                    }, import("zod/v4/core").$strip>>;
                }, import("zod/v4/core").$strip>>;
                serverNow: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly clientOutreachSave: {
        readonly auth: {
            readonly kind: "apiKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["client"];
        readonly summary: string;
        readonly description: string;
        readonly params: import("zod").ZodObject<{
            pageLabel: import("zod").ZodString;
            outreachId: import("zod").ZodString;
        }, import("zod/v4/core").$strip>;
        readonly body: import("zod").ZodObject<{
            text: import("zod").ZodOptional<import("zod").ZodString>;
            withMedia: import("zod").ZodOptional<import("zod").ZodBoolean>;
            settings: import("zod").ZodOptional<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>>;
            order: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString>>;
            fans: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodObject<{
                fanRef: import("zod").ZodString;
                version: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
                basis: import("zod").ZodOptional<import("zod").ZodString>;
                generationRef: import("zod").ZodOptional<import("zod").ZodString>;
                edit: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
            }, import("zod/v4/core").$strict>>>;
            createdAt: import("zod").ZodOptional<import("zod").ZodString>;
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
            readonly 200: import("zod").ZodObject<{
                outreachId: import("zod").ZodString;
                author: import("zod").ZodObject<{
                    name: import("zod").ZodString;
                    isMe: import("zod").ZodBoolean;
                }, import("zod/v4/core").$strip>;
                createdAt: import("zod").ZodString;
                updatedAt: import("zod").ZodString;
                updatedBy: import("zod").ZodObject<{
                    name: import("zod").ZodString;
                    isMe: import("zod").ZodBoolean;
                }, import("zod/v4/core").$strip>;
                text: import("zod").ZodString;
                withMedia: import("zod").ZodBoolean;
                settings: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>;
                order: import("zod").ZodArray<import("zod").ZodString>;
                fans: import("zod").ZodArray<import("zod").ZodObject<{
                    fanRef: import("zod").ZodString;
                    version: import("zod").ZodNullable<import("zod").ZodString>;
                    basis: import("zod").ZodNullable<import("zod").ZodString>;
                    versionAt: import("zod").ZodNullable<import("zod").ZodString>;
                    edit: import("zod").ZodNullable<import("zod").ZodString>;
                    editedBy: import("zod").ZodNullable<import("zod").ZodObject<{
                        name: import("zod").ZodString;
                        isMe: import("zod").ZodBoolean;
                    }, import("zod/v4/core").$strip>>;
                    editedAt: import("zod").ZodNullable<import("zod").ZodString>;
                    send: import("zod").ZodNullable<import("zod").ZodObject<{
                        state: import("zod").ZodString;
                        attemptId: import("zod").ZodString;
                        by: import("zod").ZodObject<{
                            name: import("zod").ZodString;
                            isMe: import("zod").ZodBoolean;
                        }, import("zod/v4/core").$strip>;
                        clickedAt: import("zod").ZodString;
                        ticketUntil: import("zod").ZodNullable<import("zod").ZodString>;
                        sentAt: import("zod").ZodNullable<import("zod").ZodString>;
                        code: import("zod").ZodNullable<import("zod").ZodString>;
                        text: import("zod").ZodNullable<import("zod").ZodString>;
                        media: import("zod").ZodNullable<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>>;
                        platformMessageId: import("zod").ZodNullable<import("zod").ZodString>;
                        resolvedBy: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    outcome: import("zod").ZodNullable<import("zod").ZodObject<{
                        replied: import("zod").ZodNullable<import("zod").ZodObject<{
                            at: import("zod").ZodString;
                            text: import("zod").ZodNullable<import("zod").ZodString>;
                        }, import("zod/v4/core").$strip>>;
                        bought: import("zod").ZodNullable<import("zod").ZodObject<{
                            mills: import("zod").ZodNumber;
                            at: import("zod").ZodString;
                        }, import("zod/v4/core").$strip>>;
                    }, import("zod/v4/core").$strip>>;
                }, import("zod/v4/core").$strip>>;
                serverNow: import("zod").ZodString;
                kept: import("zod").ZodArray<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly clientOutreachSend: {
        readonly auth: {
            readonly kind: "apiKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["client"];
        readonly summary: string;
        readonly description: string;
        readonly params: import("zod").ZodObject<{
            pageLabel: import("zod").ZodString;
            outreachId: import("zod").ZodString;
        }, import("zod/v4/core").$strip>;
        readonly body: import("zod").ZodDiscriminatedUnion<[import("zod").ZodObject<{
            action: import("zod").ZodLiteral<"claim">;
            fanRef: import("zod").ZodString;
            attemptId: import("zod").ZodString;
            text: import("zod").ZodString;
            media: import("zod").ZodNullable<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>>;
        }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
            action: import("zod").ZodLiteral<"sent">;
            fanRef: import("zod").ZodString;
            attemptId: import("zod").ZodString;
            platformMessageId: import("zod").ZodOptional<import("zod").ZodString>;
        }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
            action: import("zod").ZodLiteral<"failed">;
            fanRef: import("zod").ZodString;
            attemptId: import("zod").ZodString;
            code: import("zod").ZodString;
        }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
            action: import("zod").ZodLiteral<"uncertain">;
            fanRef: import("zod").ZodString;
            attemptId: import("zod").ZodString;
        }, import("zod/v4/core").$strict>, import("zod").ZodObject<{
            action: import("zod").ZodLiteral<"record">;
            fanRef: import("zod").ZodString;
            attemptId: import("zod").ZodString;
            state: import("zod").ZodEnum<{
                sent: "sent";
                uncertain: "uncertain";
            }>;
            clickedAt: import("zod").ZodString;
            sentAt: import("zod").ZodOptional<import("zod").ZodString>;
            text: import("zod").ZodString;
            media: import("zod").ZodNullable<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>>;
            platformMessageId: import("zod").ZodOptional<import("zod").ZodString>;
        }, import("zod/v4/core").$strict>], "action">;
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
                outcome: import("zod").ZodString;
                fan: import("zod").ZodObject<{
                    fanRef: import("zod").ZodString;
                    version: import("zod").ZodNullable<import("zod").ZodString>;
                    basis: import("zod").ZodNullable<import("zod").ZodString>;
                    versionAt: import("zod").ZodNullable<import("zod").ZodString>;
                    edit: import("zod").ZodNullable<import("zod").ZodString>;
                    editedBy: import("zod").ZodNullable<import("zod").ZodObject<{
                        name: import("zod").ZodString;
                        isMe: import("zod").ZodBoolean;
                    }, import("zod/v4/core").$strip>>;
                    editedAt: import("zod").ZodNullable<import("zod").ZodString>;
                    send: import("zod").ZodNullable<import("zod").ZodObject<{
                        state: import("zod").ZodString;
                        attemptId: import("zod").ZodString;
                        by: import("zod").ZodObject<{
                            name: import("zod").ZodString;
                            isMe: import("zod").ZodBoolean;
                        }, import("zod/v4/core").$strip>;
                        clickedAt: import("zod").ZodString;
                        ticketUntil: import("zod").ZodNullable<import("zod").ZodString>;
                        sentAt: import("zod").ZodNullable<import("zod").ZodString>;
                        code: import("zod").ZodNullable<import("zod").ZodString>;
                        text: import("zod").ZodNullable<import("zod").ZodString>;
                        media: import("zod").ZodNullable<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>>;
                        platformMessageId: import("zod").ZodNullable<import("zod").ZodString>;
                        resolvedBy: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    outcome: import("zod").ZodNullable<import("zod").ZodObject<{
                        replied: import("zod").ZodNullable<import("zod").ZodObject<{
                            at: import("zod").ZodString;
                            text: import("zod").ZodNullable<import("zod").ZodString>;
                        }, import("zod/v4/core").$strip>>;
                        bought: import("zod").ZodNullable<import("zod").ZodObject<{
                            mills: import("zod").ZodNumber;
                            at: import("zod").ZodString;
                        }, import("zod/v4/core").$strip>>;
                    }, import("zod/v4/core").$strip>>;
                }, import("zod/v4/core").$strip>;
                serverNow: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly clientOutreachTouches: {
        readonly auth: {
            readonly kind: "apiKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["client"];
        readonly summary: string;
        readonly params: import("zod").ZodObject<{
            pageLabel: import("zod").ZodString;
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
                pageLabel: import("zod").ZodString;
                hours: import("zod").ZodNumber;
                fans: import("zod").ZodArray<import("zod").ZodObject<{
                    fanRef: import("zod").ZodString;
                    at: import("zod").ZodString;
                    kind: import("zod").ZodString;
                    by: import("zod").ZodNullable<import("zod").ZodObject<{
                        name: import("zod").ZodString;
                        isMe: import("zod").ZodBoolean;
                    }, import("zod/v4/core").$strip>>;
                    outreachId: import("zod").ZodNullable<import("zod").ZodString>;
                }, import("zod/v4/core").$strip>>;
                serverNow: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
        };
    };
};
