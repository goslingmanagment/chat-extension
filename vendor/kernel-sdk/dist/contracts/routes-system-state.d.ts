export declare const systemStateRouteSchemas: {
    readonly systemState: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "Система → Состояние: Hub's own health, every routine of the server, the Mac and the PC, every copy";
        readonly description: string;
        readonly response: {
            readonly 200: import("zod").ZodObject<{
                server: import("zod").ZodObject<{
                    revision: import("zod").ZodNullable<import("zod").ZodString>;
                    processes: import("zod").ZodArray<import("zod").ZodObject<{
                        role: import("zod").ZodString;
                        state: import("zod").ZodEnum<{
                            active: "active";
                            missing: "missing";
                            stale: "stale";
                        }>;
                        lastSeenAt: import("zod").ZodNullable<import("zod").ZodString>;
                    }, import("zod/v4/core").$strip>>;
                    queue: import("zod").ZodObject<{
                        waiting: import("zod").ZodNumber;
                        oldestWaitingAgeMs: import("zod").ZodNullable<import("zod").ZodNumber>;
                        failedLastHour: import("zod").ZodNumber;
                    }, import("zod/v4/core").$strip>;
                    openIncidents: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>;
                reporters: import("zod").ZodArray<import("zod").ZodObject<{
                    reporter: import("zod").ZodString;
                    place: import("zod").ZodEnum<{
                        server: "server";
                        mac: "mac";
                        pc: "pc";
                    }>;
                    lastReportAt: import("zod").ZodString;
                    onlineSince: import("zod").ZodString;
                    version: import("zod").ZodNullable<import("zod").ZodString>;
                    uncheckedSince: import("zod").ZodNullable<import("zod").ZodString>;
                    uncheckedReason: import("zod").ZodNullable<import("zod").ZodString>;
                    fresh: import("zod").ZodBoolean;
                    hours: import("zod").ZodNullable<import("zod").ZodObject<{
                        from: import("zod").ZodNumber;
                        to: import("zod").ZodNumber;
                    }, import("zod/v4/core").$strip>>;
                    silentProblem: import("zod").ZodBoolean;
                }, import("zod/v4/core").$strip>>;
                routines: import("zod").ZodArray<import("zod").ZodObject<{
                    key: import("zod").ZodString;
                    reporter: import("zod").ZodString;
                    place: import("zod").ZodEnum<{
                        server: "server";
                        mac: "mac";
                        pc: "pc";
                    }>;
                    title: import("zod").ZodString;
                    periodSeconds: import("zod").ZodNumber;
                    lastRunAt: import("zod").ZodNullable<import("zod").ZodString>;
                    lastSuccessAt: import("zod").ZodNullable<import("zod").ZodString>;
                    lastResult: import("zod").ZodNullable<import("zod").ZodEnum<{
                        failed: "failed";
                        ok: "ok";
                        skipped: "skipped";
                        empty_input: "empty_input";
                    }>>;
                    detail: import("zod").ZodNullable<import("zod").ZodString>;
                    failedStreak: import("zod").ZodNumber;
                    emptySince: import("zod").ZodNullable<import("zod").ZodString>;
                    emptyThresholdSeconds: import("zod").ZodNullable<import("zod").ZodNumber>;
                    reportedAt: import("zod").ZodString;
                    reportedBy: import("zod").ZodNullable<import("zod").ZodString>;
                    state: import("zod").ZodEnum<{
                        pending: "pending";
                        ok: "ok";
                        skipped: "skipped";
                        unchecked: "unchecked";
                        empty: "empty";
                        silent: "silent";
                        failing: "failing";
                        empty_long: "empty_long";
                        failed_once: "failed_once";
                        outcome_unknown: "outcome_unknown";
                    }>;
                    level: import("zod").ZodEnum<{
                        healthy: "healthy";
                        problem: "problem";
                        unchecked: "unchecked";
                        attention: "attention";
                    }>;
                    silentAfter: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                copies: import("zod").ZodArray<import("zod").ZodObject<{
                    key: import("zod").ZodString;
                    reporter: import("zod").ZodString;
                    title: import("zod").ZodString;
                    source: import("zod").ZodString;
                    destination: import("zod").ZodString;
                    takenAt: import("zod").ZodNullable<import("zod").ZodString>;
                    bytes: import("zod").ZodNullable<import("zod").ZodNumber>;
                    kept: import("zod").ZodNullable<import("zod").ZodNumber>;
                    detail: import("zod").ZodNullable<import("zod").ZodString>;
                    reportedAt: import("zod").ZodString;
                    reportedBy: import("zod").ZodNullable<import("zod").ZodString>;
                    state: import("zod").ZodEnum<{
                        stale: "stale";
                        unchecked: "unchecked";
                        fresh: "fresh";
                    }>;
                    level: import("zod").ZodEnum<{
                        healthy: "healthy";
                        problem: "problem";
                        unchecked: "unchecked";
                        attention: "attention";
                    }>;
                }, import("zod/v4/core").$strip>>;
                limits: import("zod").ZodObject<{
                    copyStaleHours: import("zod").ZodNumber;
                    reporterSilentMinutes: import("zod").ZodNumber;
                }, import("zod/v4/core").$strip>;
                serverNow: import("zod").ZodString;
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
        };
    };
    readonly agentSystemRoutines: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: string;
        readonly description: string;
        readonly body: import("zod").ZodObject<{
            reporter: import("zod").ZodString;
            place: import("zod").ZodEnum<{
                server: "server";
                mac: "mac";
                pc: "pc";
            }>;
            readAt: import("zod").ZodISODateTime;
            version: import("zod").ZodOptional<import("zod").ZodString>;
            routines: import("zod").ZodArray<import("zod").ZodObject<{
                key: import("zod").ZodString;
                place: import("zod").ZodEnum<{
                    server: "server";
                    mac: "mac";
                    pc: "pc";
                }>;
                title: import("zod").ZodString;
                periodSeconds: import("zod").ZodNumber;
                lastRunAt: import("zod").ZodNullable<import("zod").ZodISODateTime>;
                lastSuccessAt: import("zod").ZodNullable<import("zod").ZodISODateTime>;
                lastResult: import("zod").ZodNullable<import("zod").ZodEnum<{
                    failed: "failed";
                    ok: "ok";
                    skipped: "skipped";
                    empty_input: "empty_input";
                }>>;
                detail: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
                failedRuns: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodNumber>>;
                emptySince: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodISODateTime>>;
                emptyThresholdSeconds: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodNumber>>;
                runCount: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodNumber>>;
            }, import("zod/v4/core").$strict>>;
        }, import("zod/v4/core").$strict>;
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
            readonly 409: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 429: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 200: import("zod").ZodObject<{
                reporter: import("zod").ZodString;
                accepted: import("zod").ZodNumber;
                retired: import("zod").ZodNumber;
                serverNow: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
        };
    };
    readonly agentSystemCopies: {
        readonly auth: {
            readonly kind: "agentKey";
        };
        readonly tags: readonly ["agent"];
        readonly summary: string;
        readonly body: import("zod").ZodObject<{
            reporter: import("zod").ZodString;
            place: import("zod").ZodEnum<{
                server: "server";
                mac: "mac";
                pc: "pc";
            }>;
            readAt: import("zod").ZodISODateTime;
            version: import("zod").ZodOptional<import("zod").ZodString>;
            copies: import("zod").ZodArray<import("zod").ZodObject<{
                key: import("zod").ZodString;
                title: import("zod").ZodString;
                source: import("zod").ZodString;
                destination: import("zod").ZodString;
                takenAt: import("zod").ZodNullable<import("zod").ZodISODateTime>;
                bytes: import("zod").ZodNullable<import("zod").ZodNumber>;
                kept: import("zod").ZodNullable<import("zod").ZodNumber>;
                detail: import("zod").ZodOptional<import("zod").ZodNullable<import("zod").ZodString>>;
            }, import("zod/v4/core").$strict>>;
        }, import("zod/v4/core").$strict>;
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
            readonly 409: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 429: import("zod").ZodObject<{
                error: import("zod").ZodString;
                message: import("zod").ZodString;
                statusCode: import("zod").ZodNumber;
                reason: import("zod").ZodOptional<import("zod").ZodString>;
                statusUrl: import("zod").ZodOptional<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>;
            readonly 200: import("zod").ZodObject<{
                reporter: import("zod").ZodString;
                accepted: import("zod").ZodNumber;
                retired: import("zod").ZodNumber;
                serverNow: import("zod").ZodString;
            }, import("zod/v4/core").$strip>;
        };
    };
};
