/**
 * The Anthropic accounts Hub spends (ANTHROPIC_API_KEYS): each account's
 * state, what Hub spent through it, and the balance left by the owner's last
 * reading of the Anthropic console. Owner session only. Keys never appear:
 * only their last four characters.
 *
 * Money is micro-USD (1 000 000 = $1) — Hub's own price of every call it
 * made; Anthropic's own bill is the reconciliation below. Anthropic has no API for an account's
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
        runsOutAt: z.ZodNullable<z.ZodString>;
        low: z.ZodBoolean;
        provider: z.ZodNullable<z.ZodObject<{
            spentSinceMicroUsd: z.ZodNumber;
            estimatedMicroUsd: z.ZodNumber;
            daysLeft: z.ZodNullable<z.ZodNumber>;
            runsOutAt: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
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
            runsOutAt: z.ZodNullable<z.ZodString>;
            low: z.ZodBoolean;
            provider: z.ZodNullable<z.ZodObject<{
                spentSinceMicroUsd: z.ZodNumber;
                estimatedMicroUsd: z.ZodNumber;
                daysLeft: z.ZodNullable<z.ZodNumber>;
                runsOutAt: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    dailyBurnMicroUsd: z.ZodNumber;
    unattributed30dMicroUsd: z.ZodNumber;
    balanceWarnDays: z.ZodNumber;
}, z.core.$strip>;
/**
 * Hub's ledger against Anthropic's bill, per account and UTC day. Anthropic's
 * figures come from the Admin API reports of the organization each account's
 * key lives in (ANTHROPIC_ADMIN_KEYS), read hourly for the last 8 days. The
 * cost report cannot tell API keys apart: when several keys spent in one
 * organization that day, its bill is split by each key's tokens priced with
 * Hub's catalog, model by model (`split`).
 */
export declare const adminAiReconciliationQuerySchema: z.ZodObject<{
    days: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export declare const adminAiReconciliationRowSchema: z.ZodObject<{
    day: z.ZodString;
    accountId: z.ZodNumber;
    label: z.ZodString;
    status: z.ZodEnum<{
        ok: "ok";
        mismatch: "mismatch";
        open: "open";
        no_admin_key: "no_admin_key";
        not_synced: "not_synced";
    }>;
    hubMicroUsd: z.ZodNumber;
    hubRequests: z.ZodNumber;
    providerMicroUsd: z.ZodNullable<z.ZodNumber>;
    diffMicroUsd: z.ZodNullable<z.ZodNumber>;
    diffPct: z.ZodNullable<z.ZodNumber>;
    split: z.ZodBoolean;
    models: z.ZodArray<z.ZodObject<{
        model: z.ZodString;
        hub: z.ZodNullable<z.ZodObject<{
            inputTokens: z.ZodNumber;
            cacheReadTokens: z.ZodNumber;
            cacheWriteTokens: z.ZodNumber;
            cacheWrite5mTokens: z.ZodNullable<z.ZodNumber>;
            cacheWrite1hTokens: z.ZodNullable<z.ZodNumber>;
            outputTokens: z.ZodNumber;
            requests: z.ZodNumber;
            costMicroUsd: z.ZodNumber;
        }, z.core.$strip>>;
        provider: z.ZodNullable<z.ZodObject<{
            inputTokens: z.ZodNumber;
            cacheReadTokens: z.ZodNumber;
            cacheWriteTokens: z.ZodNumber;
            cacheWrite5mTokens: z.ZodNullable<z.ZodNumber>;
            cacheWrite1hTokens: z.ZodNullable<z.ZodNumber>;
            outputTokens: z.ZodNumber;
            webSearchRequests: z.ZodNumber;
            costMicroUsd: z.ZodNumber;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const adminAiReconciliationResponseSchema: z.ZodObject<{
    generatedAt: z.ZodString;
    configured: z.ZodBoolean;
    days: z.ZodNumber;
    syncs: z.ZodArray<z.ZodObject<{
        labels: z.ZodArray<z.ZodString>;
        orgId: z.ZodNullable<z.ZodString>;
        orgName: z.ZodNullable<z.ZodString>;
        lastAttemptAt: z.ZodNullable<z.ZodString>;
        lastSuccessAt: z.ZodNullable<z.ZodString>;
        lastError: z.ZodNullable<z.ZodString>;
        lastErrorAt: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    rows: z.ZodArray<z.ZodObject<{
        day: z.ZodString;
        accountId: z.ZodNumber;
        label: z.ZodString;
        status: z.ZodEnum<{
            ok: "ok";
            mismatch: "mismatch";
            open: "open";
            no_admin_key: "no_admin_key";
            not_synced: "not_synced";
        }>;
        hubMicroUsd: z.ZodNumber;
        hubRequests: z.ZodNumber;
        providerMicroUsd: z.ZodNullable<z.ZodNumber>;
        diffMicroUsd: z.ZodNullable<z.ZodNumber>;
        diffPct: z.ZodNullable<z.ZodNumber>;
        split: z.ZodBoolean;
        models: z.ZodArray<z.ZodObject<{
            model: z.ZodString;
            hub: z.ZodNullable<z.ZodObject<{
                inputTokens: z.ZodNumber;
                cacheReadTokens: z.ZodNumber;
                cacheWriteTokens: z.ZodNumber;
                cacheWrite5mTokens: z.ZodNullable<z.ZodNumber>;
                cacheWrite1hTokens: z.ZodNullable<z.ZodNumber>;
                outputTokens: z.ZodNumber;
                requests: z.ZodNumber;
                costMicroUsd: z.ZodNumber;
            }, z.core.$strip>>;
            provider: z.ZodNullable<z.ZodObject<{
                inputTokens: z.ZodNumber;
                cacheReadTokens: z.ZodNumber;
                cacheWriteTokens: z.ZodNumber;
                cacheWrite5mTokens: z.ZodNullable<z.ZodNumber>;
                cacheWrite1hTokens: z.ZodNullable<z.ZodNumber>;
                outputTokens: z.ZodNumber;
                webSearchRequests: z.ZodNumber;
                costMicroUsd: z.ZodNumber;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    otherKeys: z.ZodArray<z.ZodObject<{
        day: z.ZodString;
        orgId: z.ZodString;
        orgName: z.ZodNullable<z.ZodString>;
        kind: z.ZodEnum<{
            key: "key";
            console: "console";
            unsplit: "unsplit";
        }>;
        apiKeyId: z.ZodNullable<z.ZodString>;
        keyName: z.ZodNullable<z.ZodString>;
        keyHint: z.ZodNullable<z.ZodString>;
        providerMicroUsd: z.ZodNumber;
        open: z.ZodBoolean;
    }, z.core.$strip>>;
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
/**
 * The ElevenLabs account behind voice notes, as Hub's account check last saw
 * it (every 30 min while voice notes are on). Read from Hub's own record —
 * opening this never asks ElevenLabs. Characters are ElevenLabs credits of
 * the current billing period.
 */
export declare const adminVoiceAccountResponseSchema: z.ZodObject<{
    generatedAt: z.ZodString;
    configured: z.ZodBoolean;
    enabled: z.ZodBoolean;
    check: z.ZodNullable<z.ZodObject<{
        state: z.ZodEnum<{
            healthy: "healthy";
            characters_low: "characters_low";
            characters_out: "characters_out";
            subscription_inactive: "subscription_inactive";
            key_rejected: "key_rejected";
            unreadable: "unreadable";
            check_failed: "check_failed";
        }>;
        checkedAt: z.ZodString;
        httpStatus: z.ZodNullable<z.ZodNumber>;
        readAt: z.ZodNullable<z.ZodString>;
        tier: z.ZodNullable<z.ZodString>;
        subscriptionStatus: z.ZodNullable<z.ZodString>;
        charactersUsed: z.ZodNullable<z.ZodNumber>;
        charactersLimit: z.ZodNullable<z.ZodNumber>;
        nextResetAt: z.ZodNullable<z.ZodString>;
        lowThresholdChars: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type AdminAiAccount = z.infer<typeof adminAiAccountSchema>;
export type AdminAiAccountsResponse = z.infer<typeof adminAiAccountsResponseSchema>;
export type AdminAiAccountUpdateBody = z.infer<typeof adminAiAccountUpdateBodySchema>;
export type AdminVoiceAccountResponse = z.infer<typeof adminVoiceAccountResponseSchema>;
export type AdminAiReconciliationQuery = z.infer<typeof adminAiReconciliationQuerySchema>;
export type AdminAiReconciliationRow = z.infer<typeof adminAiReconciliationRowSchema>;
export type AdminAiReconciliationResponse = z.infer<typeof adminAiReconciliationResponseSchema>;
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
                        runsOutAt: z.ZodNullable<z.ZodString>;
                        low: z.ZodBoolean;
                        provider: z.ZodNullable<z.ZodObject<{
                            spentSinceMicroUsd: z.ZodNumber;
                            estimatedMicroUsd: z.ZodNumber;
                            daysLeft: z.ZodNullable<z.ZodNumber>;
                            runsOutAt: z.ZodNullable<z.ZodString>;
                        }, z.core.$strip>>;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                dailyBurnMicroUsd: z.ZodNumber;
                unattributed30dMicroUsd: z.ZodNumber;
                balanceWarnDays: z.ZodNumber;
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
                        runsOutAt: z.ZodNullable<z.ZodString>;
                        low: z.ZodBoolean;
                        provider: z.ZodNullable<z.ZodObject<{
                            spentSinceMicroUsd: z.ZodNumber;
                            estimatedMicroUsd: z.ZodNumber;
                            daysLeft: z.ZodNullable<z.ZodNumber>;
                            runsOutAt: z.ZodNullable<z.ZodString>;
                        }, z.core.$strip>>;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                dailyBurnMicroUsd: z.ZodNumber;
                unattributed30dMicroUsd: z.ZodNumber;
                balanceWarnDays: z.ZodNumber;
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
    readonly adminAiReconciliation: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "Hub's Anthropic ledger against Anthropic's bill, per account and UTC day";
        readonly querystring: z.ZodObject<{
            days: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
        }, z.core.$strip>;
        readonly response: {
            readonly 200: z.ZodObject<{
                generatedAt: z.ZodString;
                configured: z.ZodBoolean;
                days: z.ZodNumber;
                syncs: z.ZodArray<z.ZodObject<{
                    labels: z.ZodArray<z.ZodString>;
                    orgId: z.ZodNullable<z.ZodString>;
                    orgName: z.ZodNullable<z.ZodString>;
                    lastAttemptAt: z.ZodNullable<z.ZodString>;
                    lastSuccessAt: z.ZodNullable<z.ZodString>;
                    lastError: z.ZodNullable<z.ZodString>;
                    lastErrorAt: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
                rows: z.ZodArray<z.ZodObject<{
                    day: z.ZodString;
                    accountId: z.ZodNumber;
                    label: z.ZodString;
                    status: z.ZodEnum<{
                        ok: "ok";
                        mismatch: "mismatch";
                        open: "open";
                        no_admin_key: "no_admin_key";
                        not_synced: "not_synced";
                    }>;
                    hubMicroUsd: z.ZodNumber;
                    hubRequests: z.ZodNumber;
                    providerMicroUsd: z.ZodNullable<z.ZodNumber>;
                    diffMicroUsd: z.ZodNullable<z.ZodNumber>;
                    diffPct: z.ZodNullable<z.ZodNumber>;
                    split: z.ZodBoolean;
                    models: z.ZodArray<z.ZodObject<{
                        model: z.ZodString;
                        hub: z.ZodNullable<z.ZodObject<{
                            inputTokens: z.ZodNumber;
                            cacheReadTokens: z.ZodNumber;
                            cacheWriteTokens: z.ZodNumber;
                            cacheWrite5mTokens: z.ZodNullable<z.ZodNumber>;
                            cacheWrite1hTokens: z.ZodNullable<z.ZodNumber>;
                            outputTokens: z.ZodNumber;
                            requests: z.ZodNumber;
                            costMicroUsd: z.ZodNumber;
                        }, z.core.$strip>>;
                        provider: z.ZodNullable<z.ZodObject<{
                            inputTokens: z.ZodNumber;
                            cacheReadTokens: z.ZodNumber;
                            cacheWriteTokens: z.ZodNumber;
                            cacheWrite5mTokens: z.ZodNullable<z.ZodNumber>;
                            cacheWrite1hTokens: z.ZodNullable<z.ZodNumber>;
                            outputTokens: z.ZodNumber;
                            webSearchRequests: z.ZodNumber;
                            costMicroUsd: z.ZodNumber;
                        }, z.core.$strip>>;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                otherKeys: z.ZodArray<z.ZodObject<{
                    day: z.ZodString;
                    orgId: z.ZodString;
                    orgName: z.ZodNullable<z.ZodString>;
                    kind: z.ZodEnum<{
                        key: "key";
                        console: "console";
                        unsplit: "unsplit";
                    }>;
                    apiKeyId: z.ZodNullable<z.ZodString>;
                    keyName: z.ZodNullable<z.ZodString>;
                    keyHint: z.ZodNullable<z.ZodString>;
                    providerMicroUsd: z.ZodNumber;
                    open: z.ZodBoolean;
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
        };
    };
    readonly adminVoiceAccount: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "The ElevenLabs account behind voice notes: Hub's last check and reading";
        readonly response: {
            readonly 200: z.ZodObject<{
                generatedAt: z.ZodString;
                configured: z.ZodBoolean;
                enabled: z.ZodBoolean;
                check: z.ZodNullable<z.ZodObject<{
                    state: z.ZodEnum<{
                        healthy: "healthy";
                        characters_low: "characters_low";
                        characters_out: "characters_out";
                        subscription_inactive: "subscription_inactive";
                        key_rejected: "key_rejected";
                        unreadable: "unreadable";
                        check_failed: "check_failed";
                    }>;
                    checkedAt: z.ZodString;
                    httpStatus: z.ZodNullable<z.ZodNumber>;
                    readAt: z.ZodNullable<z.ZodString>;
                    tier: z.ZodNullable<z.ZodString>;
                    subscriptionStatus: z.ZodNullable<z.ZodString>;
                    charactersUsed: z.ZodNullable<z.ZodNumber>;
                    charactersLimit: z.ZodNullable<z.ZodNumber>;
                    nextResetAt: z.ZodNullable<z.ZodString>;
                    lowThresholdChars: z.ZodNullable<z.ZodNumber>;
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
};
