export declare const publicationFileRouteSchemas: {
    readonly adminPublicationFileUpload: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: string;
        readonly querystring: import("zod").ZodObject<{
            modelSlug: import("zod").ZodOptional<import("zod").ZodString>;
            modelId: import("zod").ZodOptional<import("zod").ZodCoercedNumber<unknown>>;
            pageLabel: import("zod").ZodOptional<import("zod").ZodString>;
            name: import("zod").ZodOptional<import("zod").ZodString>;
        }, import("zod/v4/core").$strip>;
        readonly response: {
            readonly 409: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 413: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 415: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 507: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
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
            readonly 200: import("zod").ZodObject<{
                file: import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    modelId: import("zod").ZodNumber;
                    modelSlug: import("zod").ZodString;
                    sha256: import("zod").ZodString;
                    byteSize: import("zod").ZodNullable<import("zod").ZodNumber>;
                    mimeType: import("zod").ZodNullable<import("zod").ZodString>;
                    originalName: import("zod").ZodNullable<import("zod").ZodString>;
                    createdByUserId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    createdAt: import("zod").ZodString;
                    storedAt: import("zod").ZodString;
                    stored: import("zod").ZodBoolean;
                    bytesDeletedAt: import("zod").ZodNullable<import("zod").ZodString>;
                    retainUntil: import("zod").ZodNullable<import("zod").ZodString>;
                    uses: import("zod").ZodArray<import("zod").ZodObject<{
                        publicationId: import("zod").ZodNumber;
                        pageLabel: import("zod").ZodString;
                        status: import("zod").ZodEnum<{
                            unknown: "unknown";
                            cancelled: "cancelled";
                            scheduled: "scheduled";
                            draft: "draft";
                            approved: "approved";
                            submitting: "submitting";
                            processing: "processing";
                            published: "published";
                            not_published: "not_published";
                            rejected: "rejected";
                            missed: "missed";
                            withdrawn: "withdrawn";
                        }>;
                        publishAt: import("zod").ZodString;
                        statusChangedAt: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                }, import("zod/v4/core").$strip>;
                created: import("zod").ZodBoolean;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly adminPublicationFileList: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "Uploaded files of publications (metadata only), newest first, with who uses them and when Hub deletes the bytes";
        readonly querystring: import("zod").ZodObject<{
            modelSlug: import("zod").ZodOptional<import("zod").ZodString>;
            includeDeleted: import("zod").ZodPipe<import("zod").ZodDefault<import("zod").ZodEnum<{
                true: "true";
                false: "false";
            }>>, import("zod").ZodTransform<boolean, "true" | "false">>;
            limit: import("zod").ZodDefault<import("zod").ZodCoercedNumber<unknown>>;
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
            readonly 200: import("zod").ZodObject<{
                files: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodNumber;
                    modelId: import("zod").ZodNumber;
                    modelSlug: import("zod").ZodString;
                    sha256: import("zod").ZodString;
                    byteSize: import("zod").ZodNullable<import("zod").ZodNumber>;
                    mimeType: import("zod").ZodNullable<import("zod").ZodString>;
                    originalName: import("zod").ZodNullable<import("zod").ZodString>;
                    createdByUserId: import("zod").ZodNullable<import("zod").ZodNumber>;
                    createdAt: import("zod").ZodString;
                    storedAt: import("zod").ZodString;
                    stored: import("zod").ZodBoolean;
                    bytesDeletedAt: import("zod").ZodNullable<import("zod").ZodString>;
                    retainUntil: import("zod").ZodNullable<import("zod").ZodString>;
                    uses: import("zod").ZodArray<import("zod").ZodObject<{
                        publicationId: import("zod").ZodNumber;
                        pageLabel: import("zod").ZodString;
                        status: import("zod").ZodEnum<{
                            unknown: "unknown";
                            cancelled: "cancelled";
                            scheduled: "scheduled";
                            draft: "draft";
                            approved: "approved";
                            submitting: "submitting";
                            processing: "processing";
                            published: "published";
                            not_published: "not_published";
                            rejected: "rejected";
                            missed: "missed";
                            withdrawn: "withdrawn";
                        }>;
                        publishAt: import("zod").ZodString;
                        statusChangedAt: import("zod").ZodString;
                    }, import("zod/v4/core").$strip>>;
                }, import("zod/v4/core").$strip>>;
                storedTotalBytes: import("zod").ZodNumber;
                fileMaxBytes: import("zod").ZodNumber;
                totalMaxBytes: import("zod").ZodNumber;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly adminPublicationFileGet: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "One uploaded file of publications (metadata only), with its uses and retention";
        readonly params: import("zod").ZodObject<{
            fileId: import("zod").ZodCoercedNumber<unknown>;
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
            readonly 200: import("zod").ZodObject<{
                id: import("zod").ZodNumber;
                modelId: import("zod").ZodNumber;
                modelSlug: import("zod").ZodString;
                sha256: import("zod").ZodString;
                byteSize: import("zod").ZodNullable<import("zod").ZodNumber>;
                mimeType: import("zod").ZodNullable<import("zod").ZodString>;
                originalName: import("zod").ZodNullable<import("zod").ZodString>;
                createdByUserId: import("zod").ZodNullable<import("zod").ZodNumber>;
                createdAt: import("zod").ZodString;
                storedAt: import("zod").ZodString;
                stored: import("zod").ZodBoolean;
                bytesDeletedAt: import("zod").ZodNullable<import("zod").ZodString>;
                retainUntil: import("zod").ZodNullable<import("zod").ZodString>;
                uses: import("zod").ZodArray<import("zod").ZodObject<{
                    publicationId: import("zod").ZodNumber;
                    pageLabel: import("zod").ZodString;
                    status: import("zod").ZodEnum<{
                        unknown: "unknown";
                        cancelled: "cancelled";
                        scheduled: "scheduled";
                        draft: "draft";
                        approved: "approved";
                        submitting: "submitting";
                        processing: "processing";
                        published: "published";
                        not_published: "not_published";
                        rejected: "rejected";
                        missed: "missed";
                        withdrawn: "withdrawn";
                    }>;
                    publishAt: import("zod").ZodString;
                    statusChangedAt: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
            }, import("zod/v4/core").$strip>;
        };
    };
};
