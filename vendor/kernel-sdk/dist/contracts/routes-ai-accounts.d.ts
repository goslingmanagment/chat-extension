/**
 * The Anthropic accounts Hub spends (ANTHROPIC_API_KEYS): each account's
 * state, what Hub spent through it, and the balance left by the owner's last
 * reading of the Anthropic console. Owner session only. Keys never appear:
 * only their last four characters.
 *
 * Money is micro-USD (1 000 000 = $1) — Hub's own price of every call it
 * made, not Anthropic's invoice. Anthropic has no API for an account's
 * remaining credit, so the balance is estimated: the owner's reading minus
 * Hub's spend through the account since.
 */
import { z } from "zod";
export declare const adminAiAccountSchema: z.ZodObject<{
    id: z.ZodNumber;
    label: z.ZodString;
    priority: z.ZodNumber;
    enabled: z.ZodBoolean;
    status: z.ZodEnum<{
        active: "active";
        exhausted: "exhausted";
        invalid: "invalid";
    }>;
    statusReason: z.ZodNullable<z.ZodString>;
    statusChangedAt: z.ZodNullable<z.ZodString>;
    configured: z.ZodBoolean;
    serving: z.ZodBoolean;
    keyHint: z.ZodNullable<z.ZodString>;
    lastUsedAt: z.ZodNullable<z.ZodString>;
    spent: z.ZodObject<{
        last24hMicroUsd: z.ZodNumber;
        last7dMicroUsd: z.ZodNumber;
        last30dMicroUsd: z.ZodNumber;
    }, z.core.$strip>;
    requests: z.ZodObject<{
        last24h: z.ZodNumber;
        last30d: z.ZodNumber;
    }, z.core.$strip>;
    balance: z.ZodNullable<z.ZodObject<{
        readMicroUsd: z.ZodNumber;
        readAt: z.ZodString;
        spentSinceMicroUsd: z.ZodNumber;
        estimatedMicroUsd: z.ZodNumber;
        daysLeft: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const adminAiAccountsResponseSchema: z.ZodObject<{
    generatedAt: z.ZodString;
    accounts: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        label: z.ZodString;
        priority: z.ZodNumber;
        enabled: z.ZodBoolean;
        status: z.ZodEnum<{
            active: "active";
            exhausted: "exhausted";
            invalid: "invalid";
        }>;
        statusReason: z.ZodNullable<z.ZodString>;
        statusChangedAt: z.ZodNullable<z.ZodString>;
        configured: z.ZodBoolean;
        serving: z.ZodBoolean;
        keyHint: z.ZodNullable<z.ZodString>;
        lastUsedAt: z.ZodNullable<z.ZodString>;
        spent: z.ZodObject<{
            last24hMicroUsd: z.ZodNumber;
            last7dMicroUsd: z.ZodNumber;
            last30dMicroUsd: z.ZodNumber;
        }, z.core.$strip>;
        requests: z.ZodObject<{
            last24h: z.ZodNumber;
            last30d: z.ZodNumber;
        }, z.core.$strip>;
        balance: z.ZodNullable<z.ZodObject<{
            readMicroUsd: z.ZodNumber;
            readAt: z.ZodString;
            spentSinceMicroUsd: z.ZodNumber;
            estimatedMicroUsd: z.ZodNumber;
            daysLeft: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    dailyBurnMicroUsd: z.ZodNumber;
    unattributed30dMicroUsd: z.ZodNumber;
}, z.core.$strip>;
export declare const adminAiAccountParamsSchema: z.ZodObject<{
    accountId: z.ZodCoercedNumber<unknown>;
}, z.core.$strip>;
export declare const adminAiAccountUpdateBodySchema: z.ZodObject<{
    enabled: z.ZodOptional<z.ZodBoolean>;
    move: z.ZodOptional<z.ZodEnum<{
        up: "up";
        down: "down";
    }>>;
    balanceMicroUsd: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
}, z.core.$strict>;
export type AdminAiAccount = z.infer<typeof adminAiAccountSchema>;
export type AdminAiAccountsResponse = z.infer<typeof adminAiAccountsResponseSchema>;
export type AdminAiAccountUpdateBody = z.infer<typeof adminAiAccountUpdateBodySchema>;
export declare const aiAccountRouteSchemas: {
    readonly adminAiAccountsList: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "List the Anthropic accounts Hub spends: state, spend and estimated balance";
        readonly response: {
            readonly 200: z.ZodObject<{
                generatedAt: z.ZodString;
                accounts: z.ZodArray<z.ZodObject<{
                    id: z.ZodNumber;
                    label: z.ZodString;
                    priority: z.ZodNumber;
                    enabled: z.ZodBoolean;
                    status: z.ZodEnum<{
                        active: "active";
                        exhausted: "exhausted";
                        invalid: "invalid";
                    }>;
                    statusReason: z.ZodNullable<z.ZodString>;
                    statusChangedAt: z.ZodNullable<z.ZodString>;
                    configured: z.ZodBoolean;
                    serving: z.ZodBoolean;
                    keyHint: z.ZodNullable<z.ZodString>;
                    lastUsedAt: z.ZodNullable<z.ZodString>;
                    spent: z.ZodObject<{
                        last24hMicroUsd: z.ZodNumber;
                        last7dMicroUsd: z.ZodNumber;
                        last30dMicroUsd: z.ZodNumber;
                    }, z.core.$strip>;
                    requests: z.ZodObject<{
                        last24h: z.ZodNumber;
                        last30d: z.ZodNumber;
                    }, z.core.$strip>;
                    balance: z.ZodNullable<z.ZodObject<{
                        readMicroUsd: z.ZodNumber;
                        readAt: z.ZodString;
                        spentSinceMicroUsd: z.ZodNumber;
                        estimatedMicroUsd: z.ZodNumber;
                        daysLeft: z.ZodNullable<z.ZodNumber>;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                dailyBurnMicroUsd: z.ZodNumber;
                unattributed30dMicroUsd: z.ZodNumber;
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
    readonly adminAiAccountUpdate: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "Change an Anthropic account's on/off, its place in the order or its noted balance";
        readonly params: z.ZodObject<{
            accountId: z.ZodCoercedNumber<unknown>;
        }, z.core.$strip>;
        readonly body: z.ZodObject<{
            enabled: z.ZodOptional<z.ZodBoolean>;
            move: z.ZodOptional<z.ZodEnum<{
                up: "up";
                down: "down";
            }>>;
            balanceMicroUsd: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodObject<{
                generatedAt: z.ZodString;
                accounts: z.ZodArray<z.ZodObject<{
                    id: z.ZodNumber;
                    label: z.ZodString;
                    priority: z.ZodNumber;
                    enabled: z.ZodBoolean;
                    status: z.ZodEnum<{
                        active: "active";
                        exhausted: "exhausted";
                        invalid: "invalid";
                    }>;
                    statusReason: z.ZodNullable<z.ZodString>;
                    statusChangedAt: z.ZodNullable<z.ZodString>;
                    configured: z.ZodBoolean;
                    serving: z.ZodBoolean;
                    keyHint: z.ZodNullable<z.ZodString>;
                    lastUsedAt: z.ZodNullable<z.ZodString>;
                    spent: z.ZodObject<{
                        last24hMicroUsd: z.ZodNumber;
                        last7dMicroUsd: z.ZodNumber;
                        last30dMicroUsd: z.ZodNumber;
                    }, z.core.$strip>;
                    requests: z.ZodObject<{
                        last24h: z.ZodNumber;
                        last30d: z.ZodNumber;
                    }, z.core.$strip>;
                    balance: z.ZodNullable<z.ZodObject<{
                        readMicroUsd: z.ZodNumber;
                        readAt: z.ZodString;
                        spentSinceMicroUsd: z.ZodNumber;
                        estimatedMicroUsd: z.ZodNumber;
                        daysLeft: z.ZodNullable<z.ZodNumber>;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                dailyBurnMicroUsd: z.ZodNumber;
                unattributed30dMicroUsd: z.ZodNumber;
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
            readonly 409: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    };
};
