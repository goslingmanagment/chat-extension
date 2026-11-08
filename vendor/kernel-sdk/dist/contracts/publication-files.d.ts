import { z } from "zod";
/** An agent's upload (write:publication_drafts): the file is the page's model's; only its name is asked. */
export declare const agentPublicationFileUploadQuerySchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
/** Who names the file's model: its slug, its id, or a page (the page's model). Exactly one. */
export declare const publicationFileUploadQuerySchema: z.ZodObject<{
    modelSlug: z.ZodOptional<z.ZodString>;
    modelId: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    pageLabel: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const publicationFileUseSchema: z.ZodObject<{
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
}, z.core.$strip>;
export declare const publicationFileSchema: z.ZodObject<{
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
export type PublicationFileWire = z.infer<typeof publicationFileSchema>;
export declare const publicationFileUploadResponseSchema: z.ZodObject<{
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
/** Files in one lookup: a vault album's most. */
export declare const PUBLICATION_FILE_LOOKUP_MAX = 300;
/**
 * An agent asks before it uploads (write:publication_drafts): which of these
 * bytes the granted page's model holds already, so a file Hub has is named in
 * a draft without being sent again. Only the page's model's files answer.
 */
export declare const agentPublicationFileLookupBodySchema: z.ZodObject<{
    files: z.ZodArray<z.ZodObject<{
        sha256: z.ZodString;
        byteSize: z.ZodNumber;
    }, z.core.$strict>>;
    keep: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strict>;
/** A file Hub holds, as a draft names it: no uses, no uploader. */
export declare const publicationFileHeldSchema: z.ZodObject<{
    id: z.ZodNumber;
    sha256: z.ZodString;
    byteSize: z.ZodNumber;
    mimeType: z.ZodString;
    originalName: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export declare const agentPublicationFileLookupResponseSchema: z.ZodObject<{
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
export declare const publicationFileListQuerySchema: z.ZodObject<{
    modelSlug: z.ZodOptional<z.ZodString>;
    includeDeleted: z.ZodPipe<z.ZodDefault<z.ZodEnum<{
        true: "true";
        false: "false";
    }>>, z.ZodTransform<boolean, "true" | "false">>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export declare const publicationFileListResponseSchema: z.ZodObject<{
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
export declare const publicationFileIdParamsSchema: z.ZodObject<{
    fileId: z.ZodCoercedNumber<unknown>;
}, z.core.$strip>;
