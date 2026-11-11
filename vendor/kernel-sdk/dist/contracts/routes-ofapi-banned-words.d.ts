import { z } from "zod";
export declare const ofapiBannedWordSchema: z.ZodObject<{
    word: z.ZodString;
    riskLevel: z.ZodString;
    category: z.ZodNullable<z.ZodString>;
    alternatives: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export declare const ofapiBannedDictionarySchema: z.ZodObject<{
    version: z.ZodString;
    observedAt: z.ZodString;
    complete: z.ZodBoolean;
    pages: z.ZodNumber;
    entries: z.ZodArray<z.ZodObject<{
        word: z.ZodString;
        riskLevel: z.ZodString;
        category: z.ZodNullable<z.ZodString>;
        alternatives: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const ofapiBannedWordRouteSchemas: {
    readonly ofapiBannedWordsAdminGet: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "Read retained dictionary evidence without a vendor call";
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
            readonly 503: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 200: z.ZodNullable<z.ZodObject<{
                version: z.ZodString;
                observedAt: z.ZodString;
                complete: z.ZodBoolean;
                pages: z.ZodNumber;
                entries: z.ZodArray<z.ZodObject<{
                    word: z.ZodString;
                    riskLevel: z.ZodString;
                    category: z.ZodNullable<z.ZodString>;
                    alternatives: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
        };
    };
    readonly ofapiBannedWordsRefresh: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "Explicit bounded dictionary refresh; no background collection";
        readonly body: z.ZodObject<{
            maxPages: z.ZodNumber;
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
            readonly 503: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            readonly 200: z.ZodObject<{
                version: z.ZodString;
                observedAt: z.ZodString;
                complete: z.ZodBoolean;
                pages: z.ZodNumber;
                entries: z.ZodArray<z.ZodObject<{
                    word: z.ZodString;
                    riskLevel: z.ZodString;
                    category: z.ZodNullable<z.ZodString>;
                    alternatives: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strip>;
        };
    };
};
