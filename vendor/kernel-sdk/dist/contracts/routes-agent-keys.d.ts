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
    "approve:publications": "approve:publications";
    "approve:vault_albums": "approve:vault_albums";
    "write:fan_queues": "write:fan_queues";
    "read:content": "read:content";
    "read:team": "read:team";
    "withdraw:publications": "withdraw:publications";
    "delete:posts": "delete:posts";
    "look:media": "look:media";
    "write:matters": "write:matters";
    "read:pay_terms": "read:pay_terms";
    "propose:people": "propose:people";
    "signin:contentops": "signin:contentops";
    "signin:taskindex": "signin:taskindex";
    "signin:monitor": "signin:monitor";
    "write:reports": "write:reports";
    "write:system_state": "write:system_state";
    "introspect:agent_keys": "introspect:agent_keys";
    "write:customs": "write:customs";
    "write:shift_reports": "write:shift_reports";
}>;
/** The sliding default; the hard ceiling lives with the repository. */
export declare const AGENT_KEY_DEFAULT_LIFETIME_DAYS = 90;
/**
 * A service's own capabilities: a server's key that signs people in or asks
 * who an agent's key is, and reads and writes nothing of the agency. A key of
 * these alone is the one key that may have no agent (ecosystem plan §3.3:
 * «сервисные ключи — не агентские»); every other key belongs to an agent.
 */
export declare const AGENT_KEY_SERVICE_CAPABILITIES: readonly ["signin:contentops", "signin:taskindex", "signin:monitor", "introspect:agent_keys"];
/** Whether a key of these capabilities is a service's own (it may then have no agent). */
export declare function isServiceKeyCapabilities(capabilities: readonly string[]): boolean;
/** The agent person a key belongs to (the people registry's `person_agent_keys`). */
export declare const agentKeyAgentSchema: z.ZodObject<{
    code: z.ZodString;
    displayName: z.ZodString;
    state: z.ZodEnum<{
        left: "left";
        invited: "invited";
        set_up: "set_up";
        working: "working";
    }>;
}, z.core.$strict>;
/** The key's newest call, as the plane's audit recorded it. */
export declare const agentKeyLastCallSchema: z.ZodObject<{
    at: z.ZodString;
    operation: z.ZodString;
}, z.core.$strict>;
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
        "approve:publications": "approve:publications";
        "approve:vault_albums": "approve:vault_albums";
        "write:fan_queues": "write:fan_queues";
        "read:content": "read:content";
        "read:team": "read:team";
        "withdraw:publications": "withdraw:publications";
        "delete:posts": "delete:posts";
        "look:media": "look:media";
        "write:matters": "write:matters";
        "read:pay_terms": "read:pay_terms";
        "propose:people": "propose:people";
        "signin:contentops": "signin:contentops";
        "signin:taskindex": "signin:taskindex";
        "signin:monitor": "signin:monitor";
        "write:reports": "write:reports";
        "write:system_state": "write:system_state";
        "introspect:agent_keys": "introspect:agent_keys";
        "write:customs": "write:customs";
        "write:shift_reports": "write:shift_reports";
    }>>;
    pageLabels: z.ZodArray<z.ZodString>;
    expiresAt: z.ZodString;
    createdAt: z.ZodString;
    revokedAt: z.ZodNullable<z.ZodString>;
    lastUsedAt: z.ZodNullable<z.ZodString>;
    isActive: z.ZodBoolean;
    agent: z.ZodNullable<z.ZodObject<{
        code: z.ZodString;
        displayName: z.ZodString;
        state: z.ZodEnum<{
            left: "left";
            invited: "invited";
            set_up: "set_up";
            working: "working";
        }>;
    }, z.core.$strict>>;
    lastCall: z.ZodNullable<z.ZodObject<{
        at: z.ZodString;
        operation: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const agentKeyCreateBodySchema: z.ZodObject<{
    name: z.ZodString;
    agentCode: z.ZodOptional<z.ZodString>;
    capabilities: z.ZodArray<z.ZodEnum<{
        "read:messages": "read:messages";
        "read:money": "read:money";
        "read:observations_envelope": "read:observations_envelope";
        "read:datasets": "read:datasets";
        "request:hydration": "request:hydration";
        "write:publication_drafts": "write:publication_drafts";
        "approve:publications": "approve:publications";
        "approve:vault_albums": "approve:vault_albums";
        "write:fan_queues": "write:fan_queues";
        "read:content": "read:content";
        "read:team": "read:team";
        "withdraw:publications": "withdraw:publications";
        "delete:posts": "delete:posts";
        "look:media": "look:media";
        "write:matters": "write:matters";
        "read:pay_terms": "read:pay_terms";
        "propose:people": "propose:people";
        "signin:contentops": "signin:contentops";
        "signin:taskindex": "signin:taskindex";
        "signin:monitor": "signin:monitor";
        "write:reports": "write:reports";
        "write:system_state": "write:system_state";
        "introspect:agent_keys": "introspect:agent_keys";
        "write:customs": "write:customs";
        "write:shift_reports": "write:shift_reports";
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
            "approve:publications": "approve:publications";
            "approve:vault_albums": "approve:vault_albums";
            "write:fan_queues": "write:fan_queues";
            "read:content": "read:content";
            "read:team": "read:team";
            "withdraw:publications": "withdraw:publications";
            "delete:posts": "delete:posts";
            "look:media": "look:media";
            "write:matters": "write:matters";
            "read:pay_terms": "read:pay_terms";
            "propose:people": "propose:people";
            "signin:contentops": "signin:contentops";
            "signin:taskindex": "signin:taskindex";
            "signin:monitor": "signin:monitor";
            "write:reports": "write:reports";
            "write:system_state": "write:system_state";
            "introspect:agent_keys": "introspect:agent_keys";
            "write:customs": "write:customs";
            "write:shift_reports": "write:shift_reports";
        }>>;
        pageLabels: z.ZodArray<z.ZodString>;
        expiresAt: z.ZodString;
        createdAt: z.ZodString;
        revokedAt: z.ZodNullable<z.ZodString>;
        lastUsedAt: z.ZodNullable<z.ZodString>;
        isActive: z.ZodBoolean;
        agent: z.ZodNullable<z.ZodObject<{
            code: z.ZodString;
            displayName: z.ZodString;
            state: z.ZodEnum<{
                left: "left";
                invited: "invited";
                set_up: "set_up";
                working: "working";
            }>;
        }, z.core.$strict>>;
        lastCall: z.ZodNullable<z.ZodObject<{
            at: z.ZodString;
            operation: z.ZodString;
        }, z.core.$strict>>;
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
        "approve:publications": "approve:publications";
        "approve:vault_albums": "approve:vault_albums";
        "write:fan_queues": "write:fan_queues";
        "read:content": "read:content";
        "read:team": "read:team";
        "withdraw:publications": "withdraw:publications";
        "delete:posts": "delete:posts";
        "look:media": "look:media";
        "write:matters": "write:matters";
        "read:pay_terms": "read:pay_terms";
        "propose:people": "propose:people";
        "signin:contentops": "signin:contentops";
        "signin:taskindex": "signin:taskindex";
        "signin:monitor": "signin:monitor";
        "write:reports": "write:reports";
        "write:system_state": "write:system_state";
        "introspect:agent_keys": "introspect:agent_keys";
        "write:customs": "write:customs";
        "write:shift_reports": "write:shift_reports";
    }>>;
}, z.core.$strict>;
export declare const agentKeyRevokeResponseSchema: z.ZodObject<{
    id: z.ZodNumber;
    revoked: z.ZodBoolean;
    revokedAt: z.ZodNullable<z.ZodString>;
}, z.core.$strict>;
/**
 * «Кто этот ключ» for another service (ecosystem plan §3.3, M1.2).
 *
 * THE EXCHANGE: an agent sends the service (ledger, ContentOps, TaskIndex) its
 * hub key as the bearer. The service computes `sha256(key)` (lowercase hex, the
 * digest Hub stores) and sends ONLY that, as the bearer of its OWN key holding
 * `introspect:agent_keys`. Hub never receives the agent's key from the service
 * and never returns a key, a digest, a prefix, a capability or a page: only the
 * agent's code and name, whether the key works, and when it stops.
 *
 * An answer holds AGENT_KEY_INTROSPECT_CACHE_SECONDS; when Hub cannot be reached
 * (a deploy, an outage) the service keeps its last ACTIVE answer for
 * AGENT_KEY_INTROSPECT_STALE_SECONDS after it was fetched and refuses after
 * that. An inactive answer is never extended.
 */
export declare const AGENT_KEY_INTROSPECT_CACHE_SECONDS = 60;
export declare const AGENT_KEY_INTROSPECT_STALE_SECONDS = 3600;
export declare const agentKeyIntrospectBodySchema: z.ZodObject<{
    keyDigest: z.ZodString;
}, z.core.$strict>;
export declare const agentKeyIntrospectResponseSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    cacheSeconds: z.ZodLiteral<60>;
    staleSeconds: z.ZodLiteral<3600>;
    active: z.ZodLiteral<true>;
    agent: z.ZodObject<{
        code: z.ZodString;
        displayName: z.ZodString;
    }, z.core.$strict>;
    expiresAt: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    cacheSeconds: z.ZodLiteral<60>;
    staleSeconds: z.ZodLiteral<3600>;
    active: z.ZodLiteral<false>;
}, z.core.$strict>], "active">;
export declare const agentKeyIntrospectRouteSchemas: {
    readonly agentKeyIntrospect: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "Another service asks who an agent's hub key is (needs introspect:agent_keys): the agent's code, active or not, expiry";
        readonly description: string;
        readonly body: z.ZodObject<{
            keyDigest: z.ZodString;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodDiscriminatedUnion<[z.ZodObject<{
                cacheSeconds: z.ZodLiteral<60>;
                staleSeconds: z.ZodLiteral<3600>;
                active: z.ZodLiteral<true>;
                agent: z.ZodObject<{
                    code: z.ZodString;
                    displayName: z.ZodString;
                }, z.core.$strict>;
                expiresAt: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                cacheSeconds: z.ZodLiteral<60>;
                staleSeconds: z.ZodLiteral<3600>;
                active: z.ZodLiteral<false>;
            }, z.core.$strict>], "active">;
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
export declare const agentKeyAdminRouteSchemas: {
    readonly agentKeyCreate: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["agent"];
        readonly summary: "Issue an agent read-plane key (returns the raw token exactly once)";
        readonly body: z.ZodObject<{
            name: z.ZodString;
            agentCode: z.ZodOptional<z.ZodString>;
            capabilities: z.ZodArray<z.ZodEnum<{
                "read:messages": "read:messages";
                "read:money": "read:money";
                "read:observations_envelope": "read:observations_envelope";
                "read:datasets": "read:datasets";
                "request:hydration": "request:hydration";
                "write:publication_drafts": "write:publication_drafts";
                "approve:publications": "approve:publications";
                "approve:vault_albums": "approve:vault_albums";
                "write:fan_queues": "write:fan_queues";
                "read:content": "read:content";
                "read:team": "read:team";
                "withdraw:publications": "withdraw:publications";
                "delete:posts": "delete:posts";
                "look:media": "look:media";
                "write:matters": "write:matters";
                "read:pay_terms": "read:pay_terms";
                "propose:people": "propose:people";
                "signin:contentops": "signin:contentops";
                "signin:taskindex": "signin:taskindex";
                "signin:monitor": "signin:monitor";
                "write:reports": "write:reports";
                "write:system_state": "write:system_state";
                "introspect:agent_keys": "introspect:agent_keys";
                "write:customs": "write:customs";
                "write:shift_reports": "write:shift_reports";
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
                        "approve:publications": "approve:publications";
                        "approve:vault_albums": "approve:vault_albums";
                        "write:fan_queues": "write:fan_queues";
                        "read:content": "read:content";
                        "read:team": "read:team";
                        "withdraw:publications": "withdraw:publications";
                        "delete:posts": "delete:posts";
                        "look:media": "look:media";
                        "write:matters": "write:matters";
                        "read:pay_terms": "read:pay_terms";
                        "propose:people": "propose:people";
                        "signin:contentops": "signin:contentops";
                        "signin:taskindex": "signin:taskindex";
                        "signin:monitor": "signin:monitor";
                        "write:reports": "write:reports";
                        "write:system_state": "write:system_state";
                        "introspect:agent_keys": "introspect:agent_keys";
                        "write:customs": "write:customs";
                        "write:shift_reports": "write:shift_reports";
                    }>>;
                    pageLabels: z.ZodArray<z.ZodString>;
                    expiresAt: z.ZodString;
                    createdAt: z.ZodString;
                    revokedAt: z.ZodNullable<z.ZodString>;
                    lastUsedAt: z.ZodNullable<z.ZodString>;
                    isActive: z.ZodBoolean;
                    agent: z.ZodNullable<z.ZodObject<{
                        code: z.ZodString;
                        displayName: z.ZodString;
                        state: z.ZodEnum<{
                            left: "left";
                            invited: "invited";
                            set_up: "set_up";
                            working: "working";
                        }>;
                    }, z.core.$strict>>;
                    lastCall: z.ZodNullable<z.ZodObject<{
                        at: z.ZodString;
                        operation: z.ZodString;
                    }, z.core.$strict>>;
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
                    "approve:publications": "approve:publications";
                    "approve:vault_albums": "approve:vault_albums";
                    "write:fan_queues": "write:fan_queues";
                    "read:content": "read:content";
                    "read:team": "read:team";
                    "withdraw:publications": "withdraw:publications";
                    "delete:posts": "delete:posts";
                    "look:media": "look:media";
                    "write:matters": "write:matters";
                    "read:pay_terms": "read:pay_terms";
                    "propose:people": "propose:people";
                    "signin:contentops": "signin:contentops";
                    "signin:taskindex": "signin:taskindex";
                    "signin:monitor": "signin:monitor";
                    "write:reports": "write:reports";
                    "write:system_state": "write:system_state";
                    "introspect:agent_keys": "introspect:agent_keys";
                    "write:customs": "write:customs";
                    "write:shift_reports": "write:shift_reports";
                }>>;
                pageLabels: z.ZodArray<z.ZodString>;
                expiresAt: z.ZodString;
                createdAt: z.ZodString;
                revokedAt: z.ZodNullable<z.ZodString>;
                lastUsedAt: z.ZodNullable<z.ZodString>;
                isActive: z.ZodBoolean;
                agent: z.ZodNullable<z.ZodObject<{
                    code: z.ZodString;
                    displayName: z.ZodString;
                    state: z.ZodEnum<{
                        left: "left";
                        invited: "invited";
                        set_up: "set_up";
                        working: "working";
                    }>;
                }, z.core.$strict>>;
                lastCall: z.ZodNullable<z.ZodObject<{
                    at: z.ZodString;
                    operation: z.ZodString;
                }, z.core.$strict>>;
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
                "approve:publications": "approve:publications";
                "approve:vault_albums": "approve:vault_albums";
                "write:fan_queues": "write:fan_queues";
                "read:content": "read:content";
                "read:team": "read:team";
                "withdraw:publications": "withdraw:publications";
                "delete:posts": "delete:posts";
                "look:media": "look:media";
                "write:matters": "write:matters";
                "read:pay_terms": "read:pay_terms";
                "propose:people": "propose:people";
                "signin:contentops": "signin:contentops";
                "signin:taskindex": "signin:taskindex";
                "signin:monitor": "signin:monitor";
                "write:reports": "write:reports";
                "write:system_state": "write:system_state";
                "introspect:agent_keys": "introspect:agent_keys";
                "write:customs": "write:customs";
                "write:shift_reports": "write:shift_reports";
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
                    "approve:publications": "approve:publications";
                    "approve:vault_albums": "approve:vault_albums";
                    "write:fan_queues": "write:fan_queues";
                    "read:content": "read:content";
                    "read:team": "read:team";
                    "withdraw:publications": "withdraw:publications";
                    "delete:posts": "delete:posts";
                    "look:media": "look:media";
                    "write:matters": "write:matters";
                    "read:pay_terms": "read:pay_terms";
                    "propose:people": "propose:people";
                    "signin:contentops": "signin:contentops";
                    "signin:taskindex": "signin:taskindex";
                    "signin:monitor": "signin:monitor";
                    "write:reports": "write:reports";
                    "write:system_state": "write:system_state";
                    "introspect:agent_keys": "introspect:agent_keys";
                    "write:customs": "write:customs";
                    "write:shift_reports": "write:shift_reports";
                }>>;
                pageLabels: z.ZodArray<z.ZodString>;
                expiresAt: z.ZodString;
                createdAt: z.ZodString;
                revokedAt: z.ZodNullable<z.ZodString>;
                lastUsedAt: z.ZodNullable<z.ZodString>;
                isActive: z.ZodBoolean;
                agent: z.ZodNullable<z.ZodObject<{
                    code: z.ZodString;
                    displayName: z.ZodString;
                    state: z.ZodEnum<{
                        left: "left";
                        invited: "invited";
                        set_up: "set_up";
                        working: "working";
                    }>;
                }, z.core.$strict>>;
                lastCall: z.ZodNullable<z.ZodObject<{
                    at: z.ZodString;
                    operation: z.ZodString;
                }, z.core.$strict>>;
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
export type AgentKeyAgent = z.infer<typeof agentKeyAgentSchema>;
export type AgentKeyIntrospectBody = z.infer<typeof agentKeyIntrospectBodySchema>;
export type AgentKeyIntrospectResponse = z.infer<typeof agentKeyIntrospectResponseSchema>;
