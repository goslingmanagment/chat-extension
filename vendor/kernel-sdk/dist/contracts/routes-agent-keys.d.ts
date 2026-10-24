/**
 * Agent Read Plane — owner administration of the KEYS themselves.
 *
 * WHY THIS IS NOT IN `routes-agent.ts`: that module is the read plane, and its
 * pins say so — eleven operations, exactly one of them owner-session, an envelope
 * on every 200. Issuing a key is none of those things: it is the owner minting a
 * machine principal, it has no `capture`/`conclusion` to carry, and folding it in
 * would have meant loosening the very pins that make the read plane checkable.
 *
 * WHY IT IS STILL UNDER `/api/v1/agent/`: the plane's `Cache-Control: no-store`
 * hook keys on that prefix, and a response that carries a freshly minted bearer
 * token is the LAST one that may sit in an intermediary. The routes are therefore
 * also registered by the agent-read registrar, after the hook exists.
 *
 * THE ONE RULE THAT SHAPES EVERY SCHEMA HERE: **the raw token is returned once
 * and the digest is never returned at all.** `agentKeyItemSchema` is what a
 * listing may say about a key; there is no code path that widens it.
 *
 * Two validations are DELIBERATELY not restated here:
 *  - the closed capability matrix is derived from `AGENT_CAPABILITIES`, so an
 *    unknown capability is a 400 from the schema and the table CHECK is the
 *    backstop, not a second copy of the rule;
 *  - the 365-day lifetime ceiling is NOT a `.max()` on `expiresInDays`. It lives
 *    in `insertAgentKey` and in the table CHECK; an over-long request travels all
 *    the way there and comes back as that ONE enforcement point's 400. A ceiling
 *    written twice is a ceiling that drifts.
 */
import { z } from "zod";
/** Derived, never hand-listed: the enum IS the closed matrix (spec §8). */
export declare const agentKeyCapabilityEnum: z.ZodEnum<{
    "read:messages": "read:messages";
    "read:money": "read:money";
    "read:observations_envelope": "read:observations_envelope";
    "read:datasets": "read:datasets";
    "request:hydration": "request:hydration";
    "write:publication_drafts": "write:publication_drafts";
}>;
/** The sliding default; the hard ceiling lives with the repository. */
export declare const AGENT_KEY_DEFAULT_LIFETIME_DAYS = 90;
/**
 * Everything a listing may say about a key. `keyDigest` is absent BY DESIGN:
 * `keyPrefix` identifies a key to a human, the digest would let a leaked listing
 * be checked against a guessed token offline.
 */
export declare const agentKeyItemSchema: z.ZodObject<{
    id: z.ZodNumber;
    name: z.ZodString;
    keyPrefix: z.ZodString;
    capabilities: z.ZodArray<z.ZodEnum<{
        "read:messages": "read:messages";
        "read:money": "read:money";
        "read:observations_envelope": "read:observations_envelope";
        "read:datasets": "read:datasets";
        "request:hydration": "request:hydration";
        "write:publication_drafts": "write:publication_drafts";
    }>>;
    pageLabels: z.ZodArray<z.ZodString>;
    expiresAt: z.ZodString;
    createdAt: z.ZodString;
    revokedAt: z.ZodNullable<z.ZodString>;
    lastUsedAt: z.ZodNullable<z.ZodString>;
    isActive: z.ZodBoolean;
}, z.core.$strict>;
export declare const agentKeyCreateBodySchema: z.ZodObject<{
    name: z.ZodString;
    capabilities: z.ZodArray<z.ZodEnum<{
        "read:messages": "read:messages";
        "read:money": "read:money";
        "read:observations_envelope": "read:observations_envelope";
        "read:datasets": "read:datasets";
        "request:hydration": "request:hydration";
        "write:publication_drafts": "write:publication_drafts";
    }>>;
    pageLabels: z.ZodArray<z.ZodString>;
    expiresInDays: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>;
export declare const agentKeyCreateResponseSchema: z.ZodObject<{
    token: z.ZodString;
    key: z.ZodObject<{
        id: z.ZodNumber;
        name: z.ZodString;
        keyPrefix: z.ZodString;
        capabilities: z.ZodArray<z.ZodEnum<{
            "read:messages": "read:messages";
            "read:money": "read:money";
            "read:observations_envelope": "read:observations_envelope";
            "read:datasets": "read:datasets";
            "request:hydration": "request:hydration";
            "write:publication_drafts": "write:publication_drafts";
        }>>;
        pageLabels: z.ZodArray<z.ZodString>;
        expiresAt: z.ZodString;
        createdAt: z.ZodString;
        revokedAt: z.ZodNullable<z.ZodString>;
        lastUsedAt: z.ZodNullable<z.ZodString>;
        isActive: z.ZodBoolean;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const agentKeyParamsSchema: z.ZodObject<{
    id: z.ZodCoercedNumber<unknown>;
}, z.core.$strict>;
/**
 * The WHOLE new capability set of a live key, not a diff: what the owner sees
 * ticked is what the key holds afterwards. Empty is allowed (a key that keeps
 * its pages but may read nothing); a repeated name is a 400 rather than folded,
 * like an unknown one. The page grant is not part of this body: pages are still
 * widened only by issuing a new key.
 */
export declare const agentKeyUpdateBodySchema: z.ZodObject<{
    capabilities: z.ZodArray<z.ZodEnum<{
        "read:messages": "read:messages";
        "read:money": "read:money";
        "read:observations_envelope": "read:observations_envelope";
        "read:datasets": "read:datasets";
        "request:hydration": "request:hydration";
        "write:publication_drafts": "write:publication_drafts";
    }>>;
}, z.core.$strict>;
export declare const agentKeyRevokeResponseSchema: z.ZodObject<{
    id: z.ZodNumber;
    revoked: z.ZodBoolean;
    revokedAt: z.ZodNullable<z.ZodString>;
}, z.core.$strict>;
export declare const agentKeyAdminRouteSchemas: {
    readonly agentKeyCreate: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "Issue an agent read-plane key (returns the raw token exactly once)";
        readonly body: z.ZodObject<{
            name: z.ZodString;
            capabilities: z.ZodArray<z.ZodEnum<{
                "read:messages": "read:messages";
                "read:money": "read:money";
                "read:observations_envelope": "read:observations_envelope";
                "read:datasets": "read:datasets";
                "request:hydration": "request:hydration";
                "write:publication_drafts": "write:publication_drafts";
            }>>;
            pageLabels: z.ZodArray<z.ZodString>;
            expiresInDays: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodObject<{
                token: z.ZodString;
                key: z.ZodObject<{
                    id: z.ZodNumber;
                    name: z.ZodString;
                    keyPrefix: z.ZodString;
                    capabilities: z.ZodArray<z.ZodEnum<{
                        "read:messages": "read:messages";
                        "read:money": "read:money";
                        "read:observations_envelope": "read:observations_envelope";
                        "read:datasets": "read:datasets";
                        "request:hydration": "request:hydration";
                        "write:publication_drafts": "write:publication_drafts";
                    }>>;
                    pageLabels: z.ZodArray<z.ZodString>;
                    expiresAt: z.ZodString;
                    createdAt: z.ZodString;
                    revokedAt: z.ZodNullable<z.ZodString>;
                    lastUsedAt: z.ZodNullable<z.ZodString>;
                    isActive: z.ZodBoolean;
                }, z.core.$strict>;
            }, z.core.$strict>;
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
    readonly agentKeyList: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "List agent read-plane keys (digests are never returned)";
        readonly response: {
            readonly 200: z.ZodArray<z.ZodObject<{
                id: z.ZodNumber;
                name: z.ZodString;
                keyPrefix: z.ZodString;
                capabilities: z.ZodArray<z.ZodEnum<{
                    "read:messages": "read:messages";
                    "read:money": "read:money";
                    "read:observations_envelope": "read:observations_envelope";
                    "read:datasets": "read:datasets";
                    "request:hydration": "request:hydration";
                    "write:publication_drafts": "write:publication_drafts";
                }>>;
                pageLabels: z.ZodArray<z.ZodString>;
                expiresAt: z.ZodString;
                createdAt: z.ZodString;
                revokedAt: z.ZodNullable<z.ZodString>;
                lastUsedAt: z.ZodNullable<z.ZodString>;
                isActive: z.ZodBoolean;
            }, z.core.$strict>>;
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
    readonly agentKeyUpdate: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "Replace a live agent key's capabilities (takes effect on its next request; audited)";
        readonly params: z.ZodObject<{
            id: z.ZodCoercedNumber<unknown>;
        }, z.core.$strict>;
        readonly body: z.ZodObject<{
            capabilities: z.ZodArray<z.ZodEnum<{
                "read:messages": "read:messages";
                "read:money": "read:money";
                "read:observations_envelope": "read:observations_envelope";
                "read:datasets": "read:datasets";
                "request:hydration": "request:hydration";
                "write:publication_drafts": "write:publication_drafts";
            }>>;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodObject<{
                id: z.ZodNumber;
                name: z.ZodString;
                keyPrefix: z.ZodString;
                capabilities: z.ZodArray<z.ZodEnum<{
                    "read:messages": "read:messages";
                    "read:money": "read:money";
                    "read:observations_envelope": "read:observations_envelope";
                    "read:datasets": "read:datasets";
                    "request:hydration": "request:hydration";
                    "write:publication_drafts": "write:publication_drafts";
                }>>;
                pageLabels: z.ZodArray<z.ZodString>;
                expiresAt: z.ZodString;
                createdAt: z.ZodString;
                revokedAt: z.ZodNullable<z.ZodString>;
                lastUsedAt: z.ZodNullable<z.ZodString>;
                isActive: z.ZodBoolean;
            }, z.core.$strict>;
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
    readonly agentKeyRevoke: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "Revoke an agent read-plane key (idempotent)";
        readonly params: z.ZodObject<{
            id: z.ZodCoercedNumber<unknown>;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodObject<{
                id: z.ZodNumber;
                revoked: z.ZodBoolean;
                revokedAt: z.ZodNullable<z.ZodString>;
            }, z.core.$strict>;
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
};
export type AgentKeyItem = z.infer<typeof agentKeyItemSchema>;
export type AgentKeyCreateBody = z.infer<typeof agentKeyCreateBodySchema>;
export type AgentKeyCreateResponse = z.infer<typeof agentKeyCreateResponseSchema>;
export type AgentKeyUpdateBody = z.infer<typeof agentKeyUpdateBodySchema>;
export type AgentKeyRevokeResponse = z.infer<typeof agentKeyRevokeResponseSchema>;
