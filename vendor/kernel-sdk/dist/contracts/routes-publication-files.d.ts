import { z } from "zod";
export declare const publicationFileRouteSchemas: {
    readonly adminPublicationFileUpload: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: string;
        readonly querystring: z.ZodObject<{
            modelSlug: z.ZodOptional<z.ZodString>;
            modelId: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
            pageLabel: z.ZodOptional<z.ZodString>;
            name: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
        readonly response: {
            readonly 409: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 413: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 415: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 507: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
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
                file: z.ZodObject<{
                    id: z.ZodNumber;
                    modelId: z.ZodNumber;
                    modelSlug: z.ZodString;
                    sha256: z.ZodString;
                    byteSize: z.ZodNullable<z.ZodNumber>;
                    mimeType: z.ZodNullable<z.ZodString>;
                    originalName: z.ZodNullable<z.ZodString>;
                    createdByUserId: z.ZodNullable<z.ZodNumber>;
                    createdAt: z.ZodString;
                    storedAt: z.ZodString;
                    stored: z.ZodBoolean;
                    bytesDeletedAt: z.ZodNullable<z.ZodString>;
                    retainUntil: z.ZodNullable<z.ZodString>;
                    uses: z.ZodArray<z.ZodObject<{
                        publicationId: z.ZodNumber;
                        pageLabel: z.ZodString;
                        status: z.ZodEnum<{
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
                        publishAt: z.ZodString;
                        statusChangedAt: z.ZodString;
                    }, z.core.$strip>>;
                }, z.core.$strip>;
                created: z.ZodBoolean;
            }, z.core.$strip>;
        };
    };
    readonly agentPublicationFileUpload: {
        readonly auth: {
            readonly kind: "agentKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["agent"];
        readonly summary: string;
        readonly params: z.ZodObject<{
            pageLabel: z.ZodString;
        }, z.core.$strip>;
        readonly querystring: z.ZodObject<{
            name: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
        readonly response: {
            readonly 409: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 413: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 415: z.ZodObject<{
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
            readonly 507: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
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
                file: z.ZodObject<{
                    id: z.ZodNumber;
                    modelId: z.ZodNumber;
                    modelSlug: z.ZodString;
                    sha256: z.ZodString;
                    byteSize: z.ZodNullable<z.ZodNumber>;
                    mimeType: z.ZodNullable<z.ZodString>;
                    originalName: z.ZodNullable<z.ZodString>;
                    createdByUserId: z.ZodNullable<z.ZodNumber>;
                    createdAt: z.ZodString;
                    storedAt: z.ZodString;
                    stored: z.ZodBoolean;
                    bytesDeletedAt: z.ZodNullable<z.ZodString>;
                    retainUntil: z.ZodNullable<z.ZodString>;
                    uses: z.ZodArray<z.ZodObject<{
                        publicationId: z.ZodNumber;
                        pageLabel: z.ZodString;
                        status: z.ZodEnum<{
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
                        publishAt: z.ZodString;
                        statusChangedAt: z.ZodString;
                    }, z.core.$strip>>;
                }, z.core.$strip>;
                created: z.ZodBoolean;
            }, z.core.$strip>;
        };
    };
    readonly agentPublicationFileLookup: {
        readonly auth: {
            readonly kind: "agentKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["agent"];
        readonly summary: string;
        readonly params: z.ZodObject<{
            pageLabel: z.ZodString;
        }, z.core.$strip>;
        readonly body: z.ZodObject<{
            files: z.ZodArray<z.ZodObject<{
                sha256: z.ZodString;
                byteSize: z.ZodNumber;
            }, z.core.$strict>>;
            keep: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strict>;
        readonly response: {
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
                files: z.ZodArray<z.ZodObject<{
                    sha256: z.ZodString;
                    byteSize: z.ZodNumber;
                    file: z.ZodNullable<z.ZodObject<{
                        id: z.ZodNumber;
                        sha256: z.ZodString;
                        byteSize: z.ZodNumber;
                        mimeType: z.ZodString;
                        originalName: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
            }, z.core.$strip>;
        };
    };
    readonly adminPublicationFileList: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "Uploaded files of publications (metadata only), newest first, with who uses them and when Hub deletes the bytes";
        readonly querystring: z.ZodObject<{
            modelSlug: z.ZodOptional<z.ZodString>;
            includeDeleted: z.ZodPipe<z.ZodDefault<z.ZodEnum<{
                true: "true";
                false: "false";
            }>>, z.ZodTransform<boolean, "true" | "false">>;
            limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
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
                files: z.ZodArray<z.ZodObject<{
                    id: z.ZodNumber;
                    modelId: z.ZodNumber;
                    modelSlug: z.ZodString;
                    sha256: z.ZodString;
                    byteSize: z.ZodNullable<z.ZodNumber>;
                    mimeType: z.ZodNullable<z.ZodString>;
                    originalName: z.ZodNullable<z.ZodString>;
                    createdByUserId: z.ZodNullable<z.ZodNumber>;
                    createdAt: z.ZodString;
                    storedAt: z.ZodString;
                    stored: z.ZodBoolean;
                    bytesDeletedAt: z.ZodNullable<z.ZodString>;
                    retainUntil: z.ZodNullable<z.ZodString>;
                    uses: z.ZodArray<z.ZodObject<{
                        publicationId: z.ZodNumber;
                        pageLabel: z.ZodString;
                        status: z.ZodEnum<{
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
                        publishAt: z.ZodString;
                        statusChangedAt: z.ZodString;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                storedTotalBytes: z.ZodNumber;
                fileMaxBytes: z.ZodNumber;
                totalMaxBytes: z.ZodNumber;
            }, z.core.$strip>;
        };
    };
    readonly adminPublicationFileGet: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "One uploaded file of publications (metadata only), with its uses and retention";
        readonly params: z.ZodObject<{
            fileId: z.ZodCoercedNumber<unknown>;
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
                modelId: z.ZodNumber;
                modelSlug: z.ZodString;
                sha256: z.ZodString;
                byteSize: z.ZodNullable<z.ZodNumber>;
                mimeType: z.ZodNullable<z.ZodString>;
                originalName: z.ZodNullable<z.ZodString>;
                createdByUserId: z.ZodNullable<z.ZodNumber>;
                createdAt: z.ZodString;
                storedAt: z.ZodString;
                stored: z.ZodBoolean;
                bytesDeletedAt: z.ZodNullable<z.ZodString>;
                retainUntil: z.ZodNullable<z.ZodString>;
                uses: z.ZodArray<z.ZodObject<{
                    publicationId: z.ZodNumber;
                    pageLabel: z.ZodString;
                    status: z.ZodEnum<{
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
                    publishAt: z.ZodString;
                    statusChangedAt: z.ZodString;
                }, z.core.$strip>>;
            }, z.core.$strip>;
        };
    };
    readonly publicVaultUploadFile: {
        readonly auth: {
            readonly kind: "public";
        };
        readonly tags: readonly ["ofapi"];
        readonly summary: string;
        readonly params: z.ZodObject<{
            token: z.ZodString;
        }, z.core.$strip>;
        readonly response: {
            readonly 200: z.ZodString;
            readonly 206: z.ZodString;
            readonly 404: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 416: z.ZodString;
            readonly 429: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    };
};
