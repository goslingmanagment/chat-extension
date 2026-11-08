import { z } from "zod";
export declare const modelApplicationAnswerSchema: z.ZodObject<{
    section: z.ZodString;
    key: z.ZodString;
    label: z.ZodString;
    value: z.ZodString;
}, z.core.$strip>;
/** The agency Google Form's fields (`entry.<n>`), forwarded as they come. */
export declare const modelApplicationGoogleFieldsSchema: z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
/** The page's own id of one filling of the questionnaire (a UUID v4). */
export declare const modelApplicationSessionIdSchema: z.ZodString;
export declare const modelApplicationSubmitBodySchema: z.ZodObject<{
    form: z.ZodString;
    answers: z.ZodArray<z.ZodObject<{
        section: z.ZodString;
        key: z.ZodString;
        label: z.ZodString;
        value: z.ZodString;
    }, z.core.$strip>>;
    google: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>>;
    session: z.ZodOptional<z.ZodString>;
    website: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** Where a filling stands: sent debounced while the model types, and once on pagehide. */
export declare const modelApplicationProgressBodySchema: z.ZodObject<{
    session: z.ZodString;
    form: z.ZodString;
    filled: z.ZodNumber;
    total: z.ZodNumber;
    section: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    answers: z.ZodOptional<z.ZodArray<z.ZodObject<{
        section: z.ZodString;
        key: z.ZodString;
        label: z.ZodString;
        value: z.ZodString;
    }, z.core.$strip>>>;
    website: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const modelApplicationSubmitResponseSchema: z.ZodObject<{
    ok: z.ZodLiteral<true>;
    id: z.ZodNumber;
}, z.core.$strip>;
/** A filling being typed, left unsent for 30 minutes, or sent. */
export declare const modelApplicationStatusSchema: z.ZodEnum<{
    filling: "filling";
    abandoned: "abandoned";
    sent: "sent";
}>;
export declare const adminModelApplicationItemSchema: z.ZodObject<{
    ref: z.ZodString;
    name: z.ZodNullable<z.ZodString>;
    filled: z.ZodNumber;
    total: z.ZodNumber;
    section: z.ZodNullable<z.ZodString>;
    startedAt: z.ZodString;
    updatedAt: z.ZodString;
    status: z.ZodEnum<{
        filling: "filling";
        abandoned: "abandoned";
        sent: "sent";
    }>;
    applicationId: z.ZodNullable<z.ZodNumber>;
    googleStatus: z.ZodNullable<z.ZodEnum<{
        failed: "failed";
        recorded: "recorded";
        skipped: "skipped";
    }>>;
}, z.core.$strip>;
export declare const adminModelApplicationsResponseSchema: z.ZodObject<{
    serverNow: z.ZodString;
    items: z.ZodArray<z.ZodObject<{
        ref: z.ZodString;
        name: z.ZodNullable<z.ZodString>;
        filled: z.ZodNumber;
        total: z.ZodNumber;
        section: z.ZodNullable<z.ZodString>;
        startedAt: z.ZodString;
        updatedAt: z.ZodString;
        status: z.ZodEnum<{
            filling: "filling";
            abandoned: "abandoned";
            sent: "sent";
        }>;
        applicationId: z.ZodNullable<z.ZodNumber>;
        googleStatus: z.ZodNullable<z.ZodEnum<{
            failed: "failed";
            recorded: "recorded";
            skipped: "skipped";
        }>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const adminModelApplicationResponseSchema: z.ZodObject<{
    ref: z.ZodString;
    name: z.ZodNullable<z.ZodString>;
    filled: z.ZodNumber;
    total: z.ZodNumber;
    section: z.ZodNullable<z.ZodString>;
    startedAt: z.ZodString;
    updatedAt: z.ZodString;
    status: z.ZodEnum<{
        filling: "filling";
        abandoned: "abandoned";
        sent: "sent";
    }>;
    applicationId: z.ZodNullable<z.ZodNumber>;
    googleStatus: z.ZodNullable<z.ZodEnum<{
        failed: "failed";
        recorded: "recorded";
        skipped: "skipped";
    }>>;
    serverNow: z.ZodString;
    googleError: z.ZodNullable<z.ZodString>;
    answersFrom: z.ZodEnum<{
        none: "none";
        snapshot: "snapshot";
        submitted: "submitted";
    }>;
    answers: z.ZodArray<z.ZodObject<{
        section: z.ZodString;
        key: z.ZodString;
        label: z.ZodString;
        value: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const modelApplicationRouteSchemas: {
    readonly adminModelApplications: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "Model questionnaires: fillings and sent ones, newest activity first";
        readonly description: string;
        readonly response: {
            readonly 200: z.ZodObject<{
                serverNow: z.ZodString;
                items: z.ZodArray<z.ZodObject<{
                    ref: z.ZodString;
                    name: z.ZodNullable<z.ZodString>;
                    filled: z.ZodNumber;
                    total: z.ZodNumber;
                    section: z.ZodNullable<z.ZodString>;
                    startedAt: z.ZodString;
                    updatedAt: z.ZodString;
                    status: z.ZodEnum<{
                        filling: "filling";
                        abandoned: "abandoned";
                        sent: "sent";
                    }>;
                    applicationId: z.ZodNullable<z.ZodNumber>;
                    googleStatus: z.ZodNullable<z.ZodEnum<{
                        failed: "failed";
                        recorded: "recorded";
                        skipped: "skipped";
                    }>>;
                }, z.core.$strip>>;
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
    readonly adminModelApplication: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "One model questionnaire or filling with its answers";
        readonly description: string;
        readonly params: z.ZodObject<{
            ref: z.ZodString;
        }, z.core.$strip>;
        readonly response: {
            readonly 200: z.ZodObject<{
                ref: z.ZodString;
                name: z.ZodNullable<z.ZodString>;
                filled: z.ZodNumber;
                total: z.ZodNumber;
                section: z.ZodNullable<z.ZodString>;
                startedAt: z.ZodString;
                updatedAt: z.ZodString;
                status: z.ZodEnum<{
                    filling: "filling";
                    abandoned: "abandoned";
                    sent: "sent";
                }>;
                applicationId: z.ZodNullable<z.ZodNumber>;
                googleStatus: z.ZodNullable<z.ZodEnum<{
                    failed: "failed";
                    recorded: "recorded";
                    skipped: "skipped";
                }>>;
                serverNow: z.ZodString;
                googleError: z.ZodNullable<z.ZodString>;
                answersFrom: z.ZodEnum<{
                    none: "none";
                    snapshot: "snapshot";
                    submitted: "submitted";
                }>;
                answers: z.ZodArray<z.ZodObject<{
                    section: z.ZodString;
                    key: z.ZodString;
                    label: z.ZodString;
                    value: z.ZodString;
                }, z.core.$strip>>;
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
        };
    };
    readonly modelApplicationSubmit: {
        readonly auth: {
            readonly kind: "public";
        };
        readonly tags: readonly ["site"];
        readonly summary: "Submit a model questionnaire from the agency site";
        readonly description: string;
        readonly body: z.ZodObject<{
            form: z.ZodString;
            answers: z.ZodArray<z.ZodObject<{
                section: z.ZodString;
                key: z.ZodString;
                label: z.ZodString;
                value: z.ZodString;
            }, z.core.$strip>>;
            google: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>>;
            session: z.ZodOptional<z.ZodString>;
            website: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
        readonly response: {
            readonly 201: z.ZodObject<{
                ok: z.ZodLiteral<true>;
                id: z.ZodNumber;
            }, z.core.$strip>;
            readonly 400: z.ZodObject<{
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
            readonly 429: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    };
    readonly modelApplicationProgress: {
        readonly auth: {
            readonly kind: "public";
        };
        readonly tags: readonly ["site"];
        readonly summary: "Report how far a model has filled the questionnaire";
        readonly description: string;
        readonly body: z.ZodObject<{
            session: z.ZodString;
            form: z.ZodString;
            filled: z.ZodNumber;
            total: z.ZodNumber;
            section: z.ZodOptional<z.ZodString>;
            name: z.ZodOptional<z.ZodString>;
            answers: z.ZodOptional<z.ZodArray<z.ZodObject<{
                section: z.ZodString;
                key: z.ZodString;
                label: z.ZodString;
                value: z.ZodString;
            }, z.core.$strip>>>;
            website: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
        readonly response: {
            readonly 204: z.ZodNull;
            readonly 400: z.ZodObject<{
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
