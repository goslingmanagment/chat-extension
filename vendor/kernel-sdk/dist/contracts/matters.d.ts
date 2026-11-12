/**
 * Дела (ecosystem plan §2, §6, package D): everything that waits for a person,
 * one matter per reason key, owned by a person or a role. Hub's server mirrors
 * today's sources of «Ждут вас» and «Решения» into matters (the kinds below);
 * an agent key opens and closes its own kinds by key; a person reads what is
 * theirs. A source that did not answer is «не проверено» for its kind, never a
 * zero.
 */
import { z } from "zod";
/** Dotted words: `send.held`, `shift.report.missing`. */
export declare const MATTER_KIND_PATTERN: RegExp;
export declare const matterKindSchema: z.ZodString;
/** `<kind>:<ref>`, stable for the reason: the same finding has the same key. */
export declare const matterKeySchema: z.ZodString;
/** The kind a key names: what comes before its first colon. */
export declare function matterKindOfKey(key: string): string;
/**
 * The kinds Hub's server keeps from today's sources, each the one writer of its
 * kind: an agent key opens or closes none of them.
 */
export declare const MATTER_MIRROR_KINDS: readonly ["publication.draft", "publication.unknown", "ledger.sale_question", "ledger.report_post", "ledger.paid_day_changed", "custom.paid_not_delivered", "send.held", "page.login_needed", "incident.open", "extension.critical", "history.request"];
export type MatterMirrorKind = (typeof MATTER_MIRROR_KINDS)[number];
export declare function isMatterMirrorKind(kind: string): kind is MatterMirrorKind;
/**
 * The kinds Hub's server opens by its own rules (not mirrored from a list),
 * each the one writer of its kind: an agent key opens or closes none of them.
 */
export declare const MATTER_SERVER_KINDS: readonly ["routine.silent", "routine.failed", "routine.empty", "copy.stale", "reporter.silent"];
export type MatterServerKind = (typeof MATTER_SERVER_KINDS)[number];
export declare function isMatterServerKind(kind: string): kind is MatterServerKind;
/**
 * Отчёт смены (package F): the kinds of the shift report's own check, the server their one writer — a shift not
 * handed in two hours after it closed (the person's), the owner's one line of them a day later, a report handed in
 * after the ledger paid its day (the owner's). Kept apart from MATTER_SERVER_KINDS: «Состояние» closes every open
 * matter of those that its own pass did not find.
 */
export declare const SHIFT_REPORT_MATTER_KINDS: readonly ["shift.report.missing", "shift.reports.missing", "shift.report.after_paid"];
export declare function isShiftReportMatterKind(kind: string): boolean;
/**
 * A newcomer's way to the first shift («Начало», package J), the kinds of its
 * own pass (people-start-tick.ts) — apart from MATTER_SERVER_KINDS on purpose:
 * «Состояние» closes every open matter of that list its own pass did not find.
 * Hub's server is the one writer: an agent key opens or closes none of them.
 */
export declare const MATTER_PERSON_START_KINDS: readonly ["person.no_pages", "person.onboarding_stuck"];
export type MatterPersonStartKind = (typeof MATTER_PERSON_START_KINDS)[number];
export declare function isMatterPersonStartKind(kind: string): kind is MatterPersonStartKind;
export declare const MATTER_STATES: readonly ["open", "closed"];
export declare const MATTER_CLOSED_HOWS: readonly ["resolved", "withdrawn", "cause_gone"];
export declare const MATTER_SOURCE_NAMES: readonly ["server", "agent", "ledger", "contentops", "person"];
export declare const MATTER_OWNER_ROLE_NAMES: readonly ["owner", "team_lead", "chatter"];
/**
 * «Ждут вас»'s rows, in the screen's order (apps/dashboard/src/api/waiting.ts); after them the matters no old row
 * counts (package K): ContentOps' (`contentops.*`), people and access, the ledger's checks, and every other kind.
 */
export declare const WAITING_ROW_IDS: readonly ["drafts", "unknown", "questions", "reports", "customs", "held", "login", "failures", "extension", "history", "content", "people", "ledger", "other"];
export type WaitingRowId = (typeof WAITING_ROW_IDS)[number];
/** «Решения»'s queues, in the screen's order (apps/workboard/src/shared/decisions.ts). */
export declare const DECISION_QUEUE_IDS: readonly ["questions", "reports", "customs", "held"];
export declare const matterOwnerSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"user">;
    userId: z.ZodNumber;
    username: z.ZodString;
    displayName: z.ZodNullable<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"role">;
    role: z.ZodEnum<{
        owner: "owner";
        team_lead: "team_lead";
        chatter: "chatter";
    }>;
}, z.core.$strip>], "kind">;
export declare const matterSchema: z.ZodObject<{
    id: z.ZodNumber;
    key: z.ZodString;
    kind: z.ZodString;
    source: z.ZodEnum<{
        agent: "agent";
        person: "person";
        ledger: "ledger";
        server: "server";
        contentops: "contentops";
    }>;
    state: z.ZodEnum<{
        open: "open";
        closed: "closed";
    }>;
    closedHow: z.ZodNullable<z.ZodEnum<{
        withdrawn: "withdrawn";
        resolved: "resolved";
        cause_gone: "cause_gone";
    }>>;
    title: z.ZodString;
    object: z.ZodNullable<z.ZodObject<{
        type: z.ZodString;
        id: z.ZodString;
    }, z.core.$strip>>;
    pageLabels: z.ZodArray<z.ZodString>;
    owner: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"user">;
        userId: z.ZodNumber;
        username: z.ZodString;
        displayName: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"role">;
        role: z.ZodEnum<{
            owner: "owner";
            team_lead: "team_lead";
            chatter: "chatter";
        }>;
    }, z.core.$strip>], "kind">;
    watcherUserIds: z.ZodArray<z.ZodNumber>;
    mine: z.ZodBoolean;
    money: z.ZodBoolean;
    evidence: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    link: z.ZodNullable<z.ZodString>;
    openedAt: z.ZodString;
    lastSeenAt: z.ZodString;
    closedAt: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/** Whether Hub knows the kind now: its source answered lately (`yes`), did not (`no` — «не проверено»), or nothing mirrors it. */
export declare const matterKindCheckedSchema: z.ZodEnum<{
    yes: "yes";
    no: "no";
    not_mirrored: "not_mirrored";
}>;
export declare const mattersListQuerySchema: z.ZodObject<{
    state: z.ZodDefault<z.ZodEnum<{
        open: "open";
        closed: "closed";
    }>>;
    kind: z.ZodOptional<z.ZodString>;
    pageLabel: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strict>;
export declare const mattersListResponseSchema: z.ZodObject<{
    matters: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        key: z.ZodString;
        kind: z.ZodString;
        source: z.ZodEnum<{
            agent: "agent";
            person: "person";
            ledger: "ledger";
            server: "server";
            contentops: "contentops";
        }>;
        state: z.ZodEnum<{
            open: "open";
            closed: "closed";
        }>;
        closedHow: z.ZodNullable<z.ZodEnum<{
            withdrawn: "withdrawn";
            resolved: "resolved";
            cause_gone: "cause_gone";
        }>>;
        title: z.ZodString;
        object: z.ZodNullable<z.ZodObject<{
            type: z.ZodString;
            id: z.ZodString;
        }, z.core.$strip>>;
        pageLabels: z.ZodArray<z.ZodString>;
        owner: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"user">;
            userId: z.ZodNumber;
            username: z.ZodString;
            displayName: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"role">;
            role: z.ZodEnum<{
                owner: "owner";
                team_lead: "team_lead";
                chatter: "chatter";
            }>;
        }, z.core.$strip>], "kind">;
        watcherUserIds: z.ZodArray<z.ZodNumber>;
        mine: z.ZodBoolean;
        money: z.ZodBoolean;
        evidence: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        link: z.ZodNullable<z.ZodString>;
        openedAt: z.ZodString;
        lastSeenAt: z.ZodString;
        closedAt: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    kinds: z.ZodArray<z.ZodObject<{
        kind: z.ZodString;
        open: z.ZodNumber;
        checked: z.ZodEnum<{
            yes: "yes";
            no: "no";
            not_mirrored: "not_mirrored";
        }>;
        checkedAt: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const mattersWaitingQuerySchema: z.ZodObject<{
    pageLabel: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const mattersWaitingRowSchema: z.ZodObject<{
    id: z.ZodEnum<{
        other: "other";
        unknown: "unknown";
        reports: "reports";
        customs: "customs";
        login: "login";
        drafts: "drafts";
        content: "content";
        held: "held";
        history: "history";
        ledger: "ledger";
        people: "people";
        extension: "extension";
        questions: "questions";
        failures: "failures";
    }>;
    label: z.ZodString;
    count: z.ZodNullable<z.ZodNumber>;
    capped: z.ZodBoolean;
    pageLabel: z.ZodNullable<z.ZodString>;
    to: z.ZodString;
    matterIds: z.ZodArray<z.ZodNumber>;
}, z.core.$strip>;
export declare const mattersWaitingResponseSchema: z.ZodObject<{
    active: z.ZodBoolean;
    rows: z.ZodArray<z.ZodObject<{
        id: z.ZodEnum<{
            other: "other";
            unknown: "unknown";
            reports: "reports";
            customs: "customs";
            login: "login";
            drafts: "drafts";
            content: "content";
            held: "held";
            history: "history";
            ledger: "ledger";
            people: "people";
            extension: "extension";
            questions: "questions";
            failures: "failures";
        }>;
        label: z.ZodString;
        count: z.ZodNullable<z.ZodNumber>;
        capped: z.ZodBoolean;
        pageLabel: z.ZodNullable<z.ZodString>;
        to: z.ZodString;
        matterIds: z.ZodArray<z.ZodNumber>;
    }, z.core.$strip>>;
    groups: z.ZodArray<z.ZodObject<{
        id: z.ZodEnum<{
            other: "other";
            info: "info";
            reports: "reports";
            customs: "customs";
            content: "content";
            system: "system";
            publications: "publications";
            held: "held";
            ledger: "ledger";
            people: "people";
            questions: "questions";
        }>;
        title: z.ZodString;
        count: z.ZodNumber;
        checked: z.ZodBoolean;
        tone: z.ZodNullable<z.ZodEnum<{
            warn: "warn";
            bad: "bad";
        }>>;
        to: z.ZodString;
    }, z.core.$strip>>;
    total: z.ZodNumber;
    failed: z.ZodArray<z.ZodEnum<{
        other: "other";
        unknown: "unknown";
        reports: "reports";
        customs: "customs";
        login: "login";
        drafts: "drafts";
        content: "content";
        held: "held";
        history: "history";
        ledger: "ledger";
        people: "people";
        extension: "extension";
        questions: "questions";
        failures: "failures";
    }>>;
    decisions: z.ZodObject<{
        questions: z.ZodNullable<z.ZodNumber>;
        reports: z.ZodNullable<z.ZodNumber>;
        reportParts: z.ZodNullable<z.ZodObject<{
            posts: z.ZodNumber;
            changes: z.ZodNumber;
        }, z.core.$strip>>;
        customs: z.ZodNullable<z.ZodNumber>;
        held: z.ZodNullable<z.ZodNumber>;
        total: z.ZodNumber;
        elsewhere: z.ZodNumber;
        failed: z.ZodArray<z.ZodEnum<{
            reports: "reports";
            customs: "customs";
            held: "held";
            questions: "questions";
        }>>;
    }, z.core.$strip>;
    serverNow: z.ZodString;
}, z.core.$strip>;
/** The extension's narrow read: how many matters wait for the person, and the newest of them, without evidence. */
export declare const clientMattersResponseSchema: z.ZodObject<{
    count: z.ZodNumber;
    matters: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        kind: z.ZodString;
        title: z.ZodString;
        link: z.ZodNullable<z.ZodString>;
        pageLabels: z.ZodArray<z.ZodString>;
        openedAt: z.ZodString;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
/** At most this much evidence an agent may attach (the column's own limit is 8 KB). */
export declare const MATTER_EVIDENCE_MAX_BYTES = 4096;
export declare const agentMatterOpenBodySchema: z.ZodObject<{
    key: z.ZodString;
    kind: z.ZodString;
    title: z.ZodString;
    owner: z.ZodUnion<readonly [z.ZodObject<{
        user: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        role: z.ZodEnum<{
            owner: "owner";
            team_lead: "team_lead";
            chatter: "chatter";
        }>;
    }, z.core.$strict>]>;
    watchers: z.ZodOptional<z.ZodArray<z.ZodString>>;
    object: z.ZodOptional<z.ZodObject<{
        type: z.ZodString;
        id: z.ZodString;
    }, z.core.$strict>>;
    pageLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
    evidence: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    money: z.ZodOptional<z.ZodBoolean>;
    link: z.ZodOptional<z.ZodString>;
    onBehalfOf: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const agentMatterCloseBodySchema: z.ZodObject<{
    key: z.ZodString;
    how: z.ZodEnum<{
        withdrawn: "withdrawn";
        resolved: "resolved";
        cause_gone: "cause_gone";
    }>;
    note: z.ZodOptional<z.ZodString>;
    onBehalfOf: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const agentMatterCommentBodySchema: z.ZodObject<{
    key: z.ZodString;
    text: z.ZodString;
    onBehalfOf: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const agentMatterStateSchema: z.ZodObject<{
    id: z.ZodNumber;
    key: z.ZodString;
    kind: z.ZodString;
    state: z.ZodEnum<{
        open: "open";
        closed: "closed";
    }>;
    closedHow: z.ZodNullable<z.ZodEnum<{
        withdrawn: "withdrawn";
        resolved: "resolved";
        cause_gone: "cause_gone";
    }>>;
}, z.core.$strip>;
export declare const agentMatterResponseSchema: z.ZodObject<{
    matter: z.ZodObject<{
        id: z.ZodNumber;
        key: z.ZodString;
        kind: z.ZodString;
        state: z.ZodEnum<{
            open: "open";
            closed: "closed";
        }>;
        closedHow: z.ZodNullable<z.ZodEnum<{
            withdrawn: "withdrawn";
            resolved: "resolved";
            cause_gone: "cause_gone";
        }>>;
    }, z.core.$strip>;
    transition: z.ZodEnum<{
        updated: "updated";
        closed: "closed";
        unchanged: "unchanged";
        opened: "opened";
        reopened: "reopened";
    }>;
}, z.core.$strip>;
export declare const agentMatterCommentResponseSchema: z.ZodObject<{
    matter: z.ZodObject<{
        id: z.ZodNumber;
        key: z.ZodString;
        kind: z.ZodString;
        state: z.ZodEnum<{
            open: "open";
            closed: "closed";
        }>;
        closedHow: z.ZodNullable<z.ZodEnum<{
            withdrawn: "withdrawn";
            resolved: "resolved";
            cause_gone: "cause_gone";
        }>>;
    }, z.core.$strip>;
    eventId: z.ZodNumber;
}, z.core.$strip>;
export type Matter = z.infer<typeof matterSchema>;
export type MattersListQuery = z.infer<typeof mattersListQuerySchema>;
export type MattersListResponse = z.infer<typeof mattersListResponseSchema>;
export type MattersWaitingQuery = z.infer<typeof mattersWaitingQuerySchema>;
export type MattersWaitingRow = z.infer<typeof mattersWaitingRowSchema>;
export type MattersWaitingResponse = z.infer<typeof mattersWaitingResponseSchema>;
export type ClientMattersResponse = z.infer<typeof clientMattersResponseSchema>;
export type AgentMatterOpenBody = z.infer<typeof agentMatterOpenBodySchema>;
export type AgentMatterCloseBody = z.infer<typeof agentMatterCloseBodySchema>;
export type AgentMatterCommentBody = z.infer<typeof agentMatterCommentBodySchema>;
export type AgentMatterResponse = z.infer<typeof agentMatterResponseSchema>;
export type AgentMatterCommentResponse = z.infer<typeof agentMatterCommentResponseSchema>;
