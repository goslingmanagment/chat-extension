/**
 * `GET /api/v1/ops/live` — what Hub is doing right now, in one read-only
 * request for an operator screen (the server monitor): the requests sync has
 * just sent, what each page waits on, whether Hub's processes are alive, the
 * job queue and the open incidents.
 *
 * WHAT THE SCHEMA ENCODES: nothing here identifies a fan. An attempt carries
 * its page, registry key, wire operation and outcome — never its request
 * parameters, its work subject, a chat or fan id, a response body or an error
 * message; a hold carries its scope and kind, never its key. Every object is
 * strict, so a field added to the handler by mistake fails the response
 * instead of leaving with it.
 */
import { z } from "zod";
/** The cursor an answer hands out: opaque, at most 200 characters. */
export declare const opsLiveCursorSchema: z.ZodString;
export declare const opsLiveQuerySchema: z.ZodObject<{
    cursor: z.ZodCatch<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;
export declare const opsLiveProcessSchema: z.ZodObject<{
    role: z.ZodString;
    state: z.ZodEnum<{
        active: "active";
        missing: "missing";
        stale: "stale";
    }>;
    startedAt: z.ZodNullable<z.ZodString>;
    lastSeenAt: z.ZodNullable<z.ZodString>;
}, z.core.$strict>;
export declare const opsLiveHoldSchema: z.ZodObject<{
    scope: z.ZodString;
    kind: z.ZodString;
    until: z.ZodNullable<z.ZodString>;
}, z.core.$strict>;
export declare const opsLivePageSchema: z.ZodObject<{
    label: z.ZodString;
    platform: z.ZodEnum<{
        fansly: "fansly";
        onlyfans: "onlyfans";
        telegram: "telegram";
    }>;
    engine: z.ZodBoolean;
    pausedAll: z.ZodBoolean;
    pausedRequests: z.ZodBoolean;
    pausedResources: z.ZodArray<z.ZodString>;
    holds: z.ZodArray<z.ZodObject<{
        scope: z.ZodString;
        kind: z.ZodString;
        until: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>>;
    openWork: z.ZodNumber;
    dueNow: z.ZodNumber;
    nextDueAt: z.ZodNullable<z.ZodString>;
    waiting: z.ZodArray<z.ZodObject<{
        reason: z.ZodEnum<{
            running: "running";
            paused: "paused";
            quarantined: "quarantined";
            not_due: "not_due";
            pacer: "pacer";
            class_share: "class_share";
            page_hold: "page_hold";
            route_budget: "route_budget";
            route_hold: "route_hold";
            resource_hold: "resource_hold";
            subject_breaker: "subject_breaker";
            blocked_by_vendor: "blocked_by_vendor";
            dependency: "dependency";
            ownership_unconfirmed: "ownership_unconfirmed";
        }>;
        count: z.ZodNumber;
    }, z.core.$strict>>;
    lastSentAt: z.ZodNullable<z.ZodString>;
}, z.core.$strict>;
/** A sent request's class: the engine's work classes, and `site` — the page's
 *  own site requests and login operations (Project Browser), which serve no work. */
export declare const opsLiveAttemptClassEnum: z.ZodEnum<{
    requests: "requests";
    planned: "planned";
    urgent: "urgent";
    site: "site";
}>;
export declare const opsLiveAttemptSchema: z.ZodObject<{
    id: z.ZodString;
    page: z.ZodString;
    resource: z.ZodString;
    operation: z.ZodString;
    class: z.ZodNullable<z.ZodEnum<{
        requests: "requests";
        planned: "planned";
        urgent: "urgent";
        site: "site";
    }>>;
    sentAt: z.ZodString;
    completedAt: z.ZodNullable<z.ZodString>;
    failed: z.ZodBoolean;
    httpStatus: z.ZodNullable<z.ZodNumber>;
    durationMs: z.ZodNullable<z.ZodNumber>;
    responseBytes: z.ZodNullable<z.ZodNumber>;
}, z.core.$strict>;
export declare const opsLiveQueueSchema: z.ZodObject<{
    waiting: z.ZodNumber;
    active: z.ZodNullable<z.ZodNumber>;
    failedLastHour: z.ZodNumber;
    deadLetters: z.ZodNumber;
    oldestWaitingAgeMs: z.ZodNullable<z.ZodNumber>;
}, z.core.$strict>;
export declare const opsLiveIncidentSchema: z.ZodObject<{
    id: z.ZodString;
    kind: z.ZodString;
    stream: z.ZodNullable<z.ZodString>;
    openedAt: z.ZodString;
    summary: z.ZodString;
}, z.core.$strict>;
export declare const opsLiveResponseSchema: z.ZodObject<{
    generatedAt: z.ZodString;
    revision: z.ZodNullable<z.ZodString>;
    processes: z.ZodArray<z.ZodObject<{
        role: z.ZodString;
        state: z.ZodEnum<{
            active: "active";
            missing: "missing";
            stale: "stale";
        }>;
        startedAt: z.ZodNullable<z.ZodString>;
        lastSeenAt: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>>;
    pages: z.ZodArray<z.ZodObject<{
        label: z.ZodString;
        platform: z.ZodEnum<{
            fansly: "fansly";
            onlyfans: "onlyfans";
            telegram: "telegram";
        }>;
        engine: z.ZodBoolean;
        pausedAll: z.ZodBoolean;
        pausedRequests: z.ZodBoolean;
        pausedResources: z.ZodArray<z.ZodString>;
        holds: z.ZodArray<z.ZodObject<{
            scope: z.ZodString;
            kind: z.ZodString;
            until: z.ZodNullable<z.ZodString>;
        }, z.core.$strict>>;
        openWork: z.ZodNumber;
        dueNow: z.ZodNumber;
        nextDueAt: z.ZodNullable<z.ZodString>;
        waiting: z.ZodArray<z.ZodObject<{
            reason: z.ZodEnum<{
                running: "running";
                paused: "paused";
                quarantined: "quarantined";
                not_due: "not_due";
                pacer: "pacer";
                class_share: "class_share";
                page_hold: "page_hold";
                route_budget: "route_budget";
                route_hold: "route_hold";
                resource_hold: "resource_hold";
                subject_breaker: "subject_breaker";
                blocked_by_vendor: "blocked_by_vendor";
                dependency: "dependency";
                ownership_unconfirmed: "ownership_unconfirmed";
            }>;
            count: z.ZodNumber;
        }, z.core.$strict>>;
        lastSentAt: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>>;
    attempts: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        page: z.ZodString;
        resource: z.ZodString;
        operation: z.ZodString;
        class: z.ZodNullable<z.ZodEnum<{
            requests: "requests";
            planned: "planned";
            urgent: "urgent";
            site: "site";
        }>>;
        sentAt: z.ZodString;
        completedAt: z.ZodNullable<z.ZodString>;
        failed: z.ZodBoolean;
        httpStatus: z.ZodNullable<z.ZodNumber>;
        durationMs: z.ZodNullable<z.ZodNumber>;
        responseBytes: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strict>>;
    queue: z.ZodObject<{
        waiting: z.ZodNumber;
        active: z.ZodNullable<z.ZodNumber>;
        failedLastHour: z.ZodNumber;
        deadLetters: z.ZodNumber;
        oldestWaitingAgeMs: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strict>;
    incidents: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        kind: z.ZodString;
        stream: z.ZodNullable<z.ZodString>;
        openedAt: z.ZodString;
        summary: z.ZodString;
    }, z.core.$strict>>;
    nextCursor: z.ZodString;
}, z.core.$strict>;
export type OpsLiveResponse = z.infer<typeof opsLiveResponseSchema>;
export type OpsLivePage = z.infer<typeof opsLivePageSchema>;
export type OpsLiveAttempt = z.infer<typeof opsLiveAttemptSchema>;
export declare const opsLiveRouteSchemas: {
    readonly opsLive: {
        readonly auth: {
            readonly kind: "monitoring";
            readonly roles: readonly ["owner"];
        };
        readonly tags: readonly ["system"];
        readonly summary: string;
        readonly querystring: z.ZodObject<{
            cursor: z.ZodCatch<z.ZodOptional<z.ZodString>>;
        }, z.core.$strip>;
        readonly response: {
            readonly 200: z.ZodObject<{
                generatedAt: z.ZodString;
                revision: z.ZodNullable<z.ZodString>;
                processes: z.ZodArray<z.ZodObject<{
                    role: z.ZodString;
                    state: z.ZodEnum<{
                        active: "active";
                        missing: "missing";
                        stale: "stale";
                    }>;
                    startedAt: z.ZodNullable<z.ZodString>;
                    lastSeenAt: z.ZodNullable<z.ZodString>;
                }, z.core.$strict>>;
                pages: z.ZodArray<z.ZodObject<{
                    label: z.ZodString;
                    platform: z.ZodEnum<{
                        fansly: "fansly";
                        onlyfans: "onlyfans";
                        telegram: "telegram";
                    }>;
                    engine: z.ZodBoolean;
                    pausedAll: z.ZodBoolean;
                    pausedRequests: z.ZodBoolean;
                    pausedResources: z.ZodArray<z.ZodString>;
                    holds: z.ZodArray<z.ZodObject<{
                        scope: z.ZodString;
                        kind: z.ZodString;
                        until: z.ZodNullable<z.ZodString>;
                    }, z.core.$strict>>;
                    openWork: z.ZodNumber;
                    dueNow: z.ZodNumber;
                    nextDueAt: z.ZodNullable<z.ZodString>;
                    waiting: z.ZodArray<z.ZodObject<{
                        reason: z.ZodEnum<{
                            running: "running";
                            paused: "paused";
                            quarantined: "quarantined";
                            not_due: "not_due";
                            pacer: "pacer";
                            class_share: "class_share";
                            page_hold: "page_hold";
                            route_budget: "route_budget";
                            route_hold: "route_hold";
                            resource_hold: "resource_hold";
                            subject_breaker: "subject_breaker";
                            blocked_by_vendor: "blocked_by_vendor";
                            dependency: "dependency";
                            ownership_unconfirmed: "ownership_unconfirmed";
                        }>;
                        count: z.ZodNumber;
                    }, z.core.$strict>>;
                    lastSentAt: z.ZodNullable<z.ZodString>;
                }, z.core.$strict>>;
                attempts: z.ZodArray<z.ZodObject<{
                    id: z.ZodString;
                    page: z.ZodString;
                    resource: z.ZodString;
                    operation: z.ZodString;
                    class: z.ZodNullable<z.ZodEnum<{
                        requests: "requests";
                        planned: "planned";
                        urgent: "urgent";
                        site: "site";
                    }>>;
                    sentAt: z.ZodString;
                    completedAt: z.ZodNullable<z.ZodString>;
                    failed: z.ZodBoolean;
                    httpStatus: z.ZodNullable<z.ZodNumber>;
                    durationMs: z.ZodNullable<z.ZodNumber>;
                    responseBytes: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strict>>;
                queue: z.ZodObject<{
                    waiting: z.ZodNumber;
                    active: z.ZodNullable<z.ZodNumber>;
                    failedLastHour: z.ZodNumber;
                    deadLetters: z.ZodNumber;
                    oldestWaitingAgeMs: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strict>;
                incidents: z.ZodArray<z.ZodObject<{
                    id: z.ZodString;
                    kind: z.ZodString;
                    stream: z.ZodNullable<z.ZodString>;
                    openedAt: z.ZodString;
                    summary: z.ZodString;
                }, z.core.$strict>>;
                nextCursor: z.ZodString;
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
        };
    };
};
