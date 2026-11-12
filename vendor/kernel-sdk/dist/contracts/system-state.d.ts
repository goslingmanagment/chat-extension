/**
 * «Состояние» (ecosystem plan §3.6, §6, package P): every routine and every
 * copy of the system seen from the owner's place. A reporter (the Mac's, later
 * others) sends its whole list of routines and copies with an agent key
 * (`write:system_state`); Hub adds its own facts (its job schedules, the
 * ledger's health) itself. A routine is never «в порядке» merely because it
 * ran: `skipped` and `empty_input` are results of their own, and a place whose
 * reporter went silent is «не проверено», neither green nor red.
 */
import { z } from "zod";
/** Where a routine runs or a copy lies. */
export declare const SYSTEM_PLACES: readonly ["server", "mac", "pc"];
export type SystemPlace = (typeof SYSTEM_PLACES)[number];
/** What a routine's last run came to, as its reporter reads it. */
export declare const ROUTINE_RESULTS: readonly ["ok", "failed", "skipped", "empty_input"];
export type RoutineResult = (typeof ROUTINE_RESULTS)[number];
/**
 * A routine as Hub judges it now, the first that holds:
 * - `unchecked` — its reporter is silent: not verified, never red or green;
 * - `silent` — no run for twice its period and ten minutes;
 * - `failing` — two failed runs in a row or more;
 * - `empty_long` — empty input longer than the threshold its reporter gave;
 * - `failed_once` — the last run failed, the one before did not;
 * - `empty` — empty input, still within the threshold;
 * - `outcome_unknown` — it ran on time, its reporter cannot see how it ended;
 * - `pending` — known, not run yet, not overdue;
 * - `skipped` — it ran on time and had nothing to do;
 * - `ok` — it ran on time and did its work.
 */
export declare const ROUTINE_STATES: readonly ["unchecked", "silent", "failing", "empty_long", "failed_once", "empty", "outcome_unknown", "pending", "skipped", "ok"];
export type RoutineState = (typeof ROUTINE_STATES)[number];
/** How much a state asks of the owner: a problem has a matter; attention is worth a look; healthy folds away. */
export declare const SYSTEM_LEVELS: readonly ["problem", "attention", "unchecked", "healthy"];
export type SystemLevel = (typeof SYSTEM_LEVELS)[number];
/** A copy now: fresh, older than the limit (a matter), or its reporter is silent. */
export declare const COPY_STATES: readonly ["fresh", "stale", "unchecked"];
export type CopyState = (typeof COPY_STATES)[number];
/** A reporter's name: `mac`, `pc`. `hub` is Hub's own and no key's. */
export declare const systemReporterSchema: z.ZodString;
/** A routine's or a copy's key, stable for the thing: `mac.launchd.ledger-reports`. */
export declare const systemKeySchema: z.ZodString;
/** The longest period Hub watches: a routine of some days of a month (40 days). */
export declare const ROUTINE_PERIOD_MAX_SECONDS: number;
export declare const routineReportSchema: z.ZodObject<{
    key: z.ZodString;
    place: z.ZodEnum<{
        server: "server";
        mac: "mac";
        pc: "pc";
    }>;
    title: z.ZodString;
    periodSeconds: z.ZodNumber;
    lastRunAt: z.ZodNullable<z.ZodISODateTime>;
    lastSuccessAt: z.ZodNullable<z.ZodISODateTime>;
    lastResult: z.ZodNullable<z.ZodEnum<{
        failed: "failed";
        ok: "ok";
        skipped: "skipped";
        empty_input: "empty_input";
    }>>;
    detail: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    failedRuns: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    emptySince: z.ZodOptional<z.ZodNullable<z.ZodISODateTime>>;
    emptyThresholdSeconds: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    runCount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
}, z.core.$strict>;
export declare const agentSystemRoutinesBodySchema: z.ZodObject<{
    reporter: z.ZodString;
    place: z.ZodEnum<{
        server: "server";
        mac: "mac";
        pc: "pc";
    }>;
    readAt: z.ZodISODateTime;
    version: z.ZodOptional<z.ZodString>;
    routines: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        place: z.ZodEnum<{
            server: "server";
            mac: "mac";
            pc: "pc";
        }>;
        title: z.ZodString;
        periodSeconds: z.ZodNumber;
        lastRunAt: z.ZodNullable<z.ZodISODateTime>;
        lastSuccessAt: z.ZodNullable<z.ZodISODateTime>;
        lastResult: z.ZodNullable<z.ZodEnum<{
            failed: "failed";
            ok: "ok";
            skipped: "skipped";
            empty_input: "empty_input";
        }>>;
        detail: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        failedRuns: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        emptySince: z.ZodOptional<z.ZodNullable<z.ZodISODateTime>>;
        emptyThresholdSeconds: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        runCount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const copyReportSchema: z.ZodObject<{
    key: z.ZodString;
    title: z.ZodString;
    source: z.ZodString;
    destination: z.ZodString;
    takenAt: z.ZodNullable<z.ZodISODateTime>;
    bytes: z.ZodNullable<z.ZodNumber>;
    kept: z.ZodNullable<z.ZodNumber>;
    detail: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>;
export declare const agentSystemCopiesBodySchema: z.ZodObject<{
    reporter: z.ZodString;
    place: z.ZodEnum<{
        server: "server";
        mac: "mac";
        pc: "pc";
    }>;
    readAt: z.ZodISODateTime;
    version: z.ZodOptional<z.ZodString>;
    copies: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        title: z.ZodString;
        source: z.ZodString;
        destination: z.ZodString;
        takenAt: z.ZodNullable<z.ZodISODateTime>;
        bytes: z.ZodNullable<z.ZodNumber>;
        kept: z.ZodNullable<z.ZodNumber>;
        detail: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const agentSystemReportResponseSchema: z.ZodObject<{
    reporter: z.ZodString;
    accepted: z.ZodNumber;
    retired: z.ZodNumber;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const systemStateRoutineSchema: z.ZodObject<{
    key: z.ZodString;
    reporter: z.ZodString;
    place: z.ZodEnum<{
        server: "server";
        mac: "mac";
        pc: "pc";
    }>;
    title: z.ZodString;
    periodSeconds: z.ZodNumber;
    lastRunAt: z.ZodNullable<z.ZodString>;
    lastSuccessAt: z.ZodNullable<z.ZodString>;
    lastResult: z.ZodNullable<z.ZodEnum<{
        failed: "failed";
        ok: "ok";
        skipped: "skipped";
        empty_input: "empty_input";
    }>>;
    detail: z.ZodNullable<z.ZodString>;
    failedStreak: z.ZodNumber;
    emptySince: z.ZodNullable<z.ZodString>;
    emptyThresholdSeconds: z.ZodNullable<z.ZodNumber>;
    reportedAt: z.ZodString;
    reportedBy: z.ZodNullable<z.ZodString>;
    state: z.ZodEnum<{
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
    level: z.ZodEnum<{
        healthy: "healthy";
        problem: "problem";
        unchecked: "unchecked";
        attention: "attention";
    }>;
    silentAfter: z.ZodString;
}, z.core.$strip>;
export declare const systemStateCopySchema: z.ZodObject<{
    key: z.ZodString;
    reporter: z.ZodString;
    title: z.ZodString;
    source: z.ZodString;
    destination: z.ZodString;
    takenAt: z.ZodNullable<z.ZodString>;
    bytes: z.ZodNullable<z.ZodNumber>;
    kept: z.ZodNullable<z.ZodNumber>;
    detail: z.ZodNullable<z.ZodString>;
    reportedAt: z.ZodString;
    reportedBy: z.ZodNullable<z.ZodString>;
    state: z.ZodEnum<{
        stale: "stale";
        unchecked: "unchecked";
        fresh: "fresh";
    }>;
    level: z.ZodEnum<{
        healthy: "healthy";
        problem: "problem";
        unchecked: "unchecked";
        attention: "attention";
    }>;
}, z.core.$strip>;
export declare const systemStateReporterSchema: z.ZodObject<{
    reporter: z.ZodString;
    place: z.ZodEnum<{
        server: "server";
        mac: "mac";
        pc: "pc";
    }>;
    lastReportAt: z.ZodString;
    onlineSince: z.ZodString;
    version: z.ZodNullable<z.ZodString>;
    uncheckedSince: z.ZodNullable<z.ZodString>;
    uncheckedReason: z.ZodNullable<z.ZodString>;
    fresh: z.ZodBoolean;
    hours: z.ZodNullable<z.ZodObject<{
        from: z.ZodNumber;
        to: z.ZodNumber;
    }, z.core.$strip>>;
    silentProblem: z.ZodBoolean;
}, z.core.$strip>;
export declare const systemStateServerSchema: z.ZodObject<{
    revision: z.ZodNullable<z.ZodString>;
    processes: z.ZodArray<z.ZodObject<{
        role: z.ZodString;
        state: z.ZodEnum<{
            active: "active";
            missing: "missing";
            stale: "stale";
        }>;
        lastSeenAt: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    queue: z.ZodObject<{
        waiting: z.ZodNumber;
        oldestWaitingAgeMs: z.ZodNullable<z.ZodNumber>;
        failedLastHour: z.ZodNumber;
    }, z.core.$strip>;
    openIncidents: z.ZodNumber;
}, z.core.$strip>;
export declare const systemStateResponseSchema: z.ZodObject<{
    server: z.ZodObject<{
        revision: z.ZodNullable<z.ZodString>;
        processes: z.ZodArray<z.ZodObject<{
            role: z.ZodString;
            state: z.ZodEnum<{
                active: "active";
                missing: "missing";
                stale: "stale";
            }>;
            lastSeenAt: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        queue: z.ZodObject<{
            waiting: z.ZodNumber;
            oldestWaitingAgeMs: z.ZodNullable<z.ZodNumber>;
            failedLastHour: z.ZodNumber;
        }, z.core.$strip>;
        openIncidents: z.ZodNumber;
    }, z.core.$strip>;
    reporters: z.ZodArray<z.ZodObject<{
        reporter: z.ZodString;
        place: z.ZodEnum<{
            server: "server";
            mac: "mac";
            pc: "pc";
        }>;
        lastReportAt: z.ZodString;
        onlineSince: z.ZodString;
        version: z.ZodNullable<z.ZodString>;
        uncheckedSince: z.ZodNullable<z.ZodString>;
        uncheckedReason: z.ZodNullable<z.ZodString>;
        fresh: z.ZodBoolean;
        hours: z.ZodNullable<z.ZodObject<{
            from: z.ZodNumber;
            to: z.ZodNumber;
        }, z.core.$strip>>;
        silentProblem: z.ZodBoolean;
    }, z.core.$strip>>;
    routines: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        reporter: z.ZodString;
        place: z.ZodEnum<{
            server: "server";
            mac: "mac";
            pc: "pc";
        }>;
        title: z.ZodString;
        periodSeconds: z.ZodNumber;
        lastRunAt: z.ZodNullable<z.ZodString>;
        lastSuccessAt: z.ZodNullable<z.ZodString>;
        lastResult: z.ZodNullable<z.ZodEnum<{
            failed: "failed";
            ok: "ok";
            skipped: "skipped";
            empty_input: "empty_input";
        }>>;
        detail: z.ZodNullable<z.ZodString>;
        failedStreak: z.ZodNumber;
        emptySince: z.ZodNullable<z.ZodString>;
        emptyThresholdSeconds: z.ZodNullable<z.ZodNumber>;
        reportedAt: z.ZodString;
        reportedBy: z.ZodNullable<z.ZodString>;
        state: z.ZodEnum<{
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
        level: z.ZodEnum<{
            healthy: "healthy";
            problem: "problem";
            unchecked: "unchecked";
            attention: "attention";
        }>;
        silentAfter: z.ZodString;
    }, z.core.$strip>>;
    copies: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        reporter: z.ZodString;
        title: z.ZodString;
        source: z.ZodString;
        destination: z.ZodString;
        takenAt: z.ZodNullable<z.ZodString>;
        bytes: z.ZodNullable<z.ZodNumber>;
        kept: z.ZodNullable<z.ZodNumber>;
        detail: z.ZodNullable<z.ZodString>;
        reportedAt: z.ZodString;
        reportedBy: z.ZodNullable<z.ZodString>;
        state: z.ZodEnum<{
            stale: "stale";
            unchecked: "unchecked";
            fresh: "fresh";
        }>;
        level: z.ZodEnum<{
            healthy: "healthy";
            problem: "problem";
            unchecked: "unchecked";
            attention: "attention";
        }>;
    }, z.core.$strip>>;
    limits: z.ZodObject<{
        copyStaleHours: z.ZodNumber;
        reporterSilentMinutes: z.ZodNumber;
    }, z.core.$strip>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export type RoutineReport = z.infer<typeof routineReportSchema>;
export type AgentSystemRoutinesBody = z.infer<typeof agentSystemRoutinesBodySchema>;
export type CopyReport = z.infer<typeof copyReportSchema>;
export type AgentSystemCopiesBody = z.infer<typeof agentSystemCopiesBodySchema>;
export type AgentSystemReportResponse = z.infer<typeof agentSystemReportResponseSchema>;
export type SystemStateRoutine = z.infer<typeof systemStateRoutineSchema>;
export type SystemStateCopy = z.infer<typeof systemStateCopySchema>;
export type SystemStateReporter = z.infer<typeof systemStateReporterSchema>;
export type SystemStateServer = z.infer<typeof systemStateServerSchema>;
export type SystemStateResponse = z.infer<typeof systemStateResponseSchema>;
