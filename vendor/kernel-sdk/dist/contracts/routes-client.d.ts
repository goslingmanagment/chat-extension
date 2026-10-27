/**
 * Routes of the chat extension (`chat-extension`), the hub's third client.
 *
 * WHY A SEPARATE MODULE: every route the new client gets lands here (group
 * `clientRouteSchemas`), so its PRs touch one new file instead of `routes.ts`,
 * which the Sync Engine changes almost daily. `routes.ts` spreads the group into
 * `routeSchemas`, behind its own name in `RouteSchemas` (TS7056, see there).
 *
 * Imports come only from `zod`, `./primitives.ts` and the vendored part of
 * `@agency_hub_core/shared`. Never from `./routes.ts`: it imports this module,
 * so the reverse import is a cycle.
 *
 * Shape law for every client route (chat-extension docs/hub-pr-plan.md §4.0):
 * - bodies and query strings are `.strict()`;
 * - response objects are NOT strict: an SDK frozen in a shipped client strips a
 *   key it does not know instead of failing the whole response, so a new field
 *   is always optional and never breaks an installed client;
 * - a vocabulary that grows (flags, capabilities, reasons, platforms, roles) is
 *   an open string on the wire. `z.enum`, `z.record(z.enum…)` and
 *   `z.array(z.enum…)` refuse an unknown member, so one new platform or flag
 *   would break the parse of the whole bootstrap in every installed client. The
 *   known members are the exported constants below; a client narrows to them
 *   itself and reads an unknown member as "off" / "unknown".
 */
import { z } from "zod";
/** Open token: the wire form of every growing vocabulary (reason, flag, capability, platform, role…). */
export declare const clientOpenToken: z.ZodString;
/**
 * The ONE shape of a platform numeric id a client sends: an OnlyFans fan id
 * (== chat id) or message id, a Fansly account or group id. No leading zero, at
 * most 30 digits. Every client field that carries such an id (fanRef,
 * conversationRef, the feed, fresh text, known message ids) uses this schema,
 * so the hub never holds two spellings of one id.
 */
export declare const CLIENT_NUMERIC_ID_PATTERN: RegExp;
export declare const clientNumericIdSchema: z.ZodString;
/**
 * The order of two such ids where the platform's ids are snowflakes (Fansly:
 * a message id grows with the moment it was sent): negative when `a` is the
 * older. The shorter id is the older, then the string order. Never by number:
 * a double merges neighbours past 2^53.
 */
export declare function compareClientNumericIds(a: string, b: string): number;
/** The platform's fan id: on OnlyFans the fan id (== chat_id), on Fansly the fan's account id. */
export declare const clientFanRefSchema: z.ZodString;
/**
 * R20 HF-10: the chat that a read by conversation names apart from its fan
 * (`conversation-recaps-v1`): on Fansly the group id; on OnlyFans the chat id
 * IS the fan id, so it equals `fanRef` or is left out. See "reads by
 * conversation" below.
 */
export declare const clientConversationRefSchema: z.ZodString;
export declare const clientPageParamsSchema: z.ZodObject<{
    pageLabel: z.ZodString;
}, z.core.$strip>;
export declare const clientPageFanParamsSchema: z.ZodObject<{
    pageLabel: z.ZodString;
    fanRef: z.ZodString;
}, z.core.$strip>;
export declare const clientCursorSchema: z.ZodString;
/**
 * The `reason` beside 400 `bad_request` on a client read that takes a cursor:
 * the cursor is not one this hub issued for this request (forged or cut,
 * issued for something else than the read binds its cursors to, or past the
 * read's lifetime). The answer never says which. Not retried as is: the client
 * reads the first page again. What each read binds a cursor to, and for how
 * long:
 * - the awaiting-reply queue (`clientSpenderAwaitingReply`): the page and the
 *   person; a cursor is good for an hour after the page that carried it.
 * - the archive feed (`clientConversationFeed`): the page, the fan, the person,
 *   the reader and the archive generation; a walk ends a day after its first
 *   page.
 */
export declare const CLIENT_CURSOR_REFUSAL_REASONS: readonly ["cursor_invalid"];
export type ClientCursorRefusalReason = (typeof CLIENT_CURSOR_REFUSAL_REASONS)[number];
/**
 * Known names: documentation and the client's narrowing. On the wire they are open strings.
 *
 * Where each flag exists is the hub's (chat-extension R20 HF-2): a page of a
 * platform without the flag reads `platform_unsupported`. `drafts`, `voice`,
 * `notesFill`, `notes`, `vault` and `registration` exist on Fansly only: the
 * narrow token's Reply, Fix, Hi and Ping, its voice script (`voice` also opens
 * the voice-note routes, `voice-notes-v1`) and its notes fill on a Fansly page
 * (R20 HF-12, HF-4б), and the extension's own notes, vault and «Регистрация».
 * On OnlyFans those generations need no flag of their own. `previewSend`,
 * `previewSendMarkAiGenerated`, `navigation`, `wsTap` and `stats` exist on
 * OnlyFans only; every other flag on both. A Fansly page is switched on by its
 * own row of the owner's switches alone, never by the `"*"` row, so the
 * top-level `flags` (the `"*"` row) say nothing about a Fansly page.
 */
export declare const CLIENT_FEATURE_FLAG_NAMES: readonly ["insertion", "freshText", "newcomers", "spenders", "stats", "preview", "previewSend", "previewSendMarkAiGenerated", "fanPanel", "navigation", "wsTap", "sound", "coach", "recap", "review", "splitAll", "drafts", "voice", "notesFill", "notes", "vault", "registration"];
export declare const CLIENT_HUB_CAPABILITY_NAMES: readonly ["context-v1", "live-text-v1", "split-all-v1", "shared-recaps-v1", "recap-profile-v1", "archive-feed-v1", "spenders-stats-v1", "awaiting-reply-v1", "audience-new-v1", "preview-send-custody-v1", "client-health-perf-v1", "ai-usage-v1", "manual-greeting-v1", "coverage-check-v1", "conversation-recaps-v1", "hi-start-proof-v1", "voice-notes-v1", "send-attribution-v1", "live-ppv-v1", "live-text-review-coach-v1", "live-text-recap-v1", "live-text-fansly-tools-v1", "live-ppv-fansly-v1", "live-images-v1", "draft-media-v1", "recap-off-v1", "outreach-fix-v1", "chatter-activity-v1", "in-conversation-v1", "fan-card-v1", "win-back-v1", "handoff-v1", "fan-customs-v1", "online-v1", "hi-fan-account-v1", "coach-depth-v1"];
/**
 * Append-only. `client_outdated` (the caller's `x-client-version` is below the
 * owner's minimum, or unreadable) is answered by the server-side check of
 * client routes and AI calls (H-2b/H-3), never by the bootstrap; it is listed
 * from the first vendored SDK on so a client never meets it as unknown.
 *
 * `lane_off` (R20 HF-4б) is the other way round: the bootstrap's alone. The
 * feature runs on a lane of the hub with switches of its own, and that lane
 * does not serve the page right now (for `voice`, the voice-notes lane: its
 * live switch, its synthesis provider, its page allowlist and the page's voice
 * profile). A call is answered by the lane's own admission and its own codes
 * (`voice_disabled`, `voice_not_allowlisted`, ...), never by this reason.
 */
export declare const CLIENT_FEATURE_UNAVAILABLE_REASONS: readonly ["disabled", "flag_off", "platform_unsupported", "binding_missing", "hub_not_ready", "not_granted", "client_outdated", "lane_off"];
/** The platforms and roles this hub knows today (`pages[].platform`, `identity.role`). */
export declare const CLIENT_KNOWN_PLATFORMS: readonly ["fansly", "onlyfans"];
export declare const CLIENT_KNOWN_ROLES: readonly ["owner", "team_lead", "chatter"];
/**
 * How much of one conversation's history the hub can vouch for: the `coverage`
 * of the AI `context_v1` frame (routes.ts) and of the client reads built on the
 * same stores. `complete`: a standing proof that the hub holds the chat's whole
 * history up to the proof's head, served by the archive. `partial`: the hub
 * knows its copy has a hole. `unknown`: nothing proves either.
 */
export declare const CLIENT_COVERAGE_LEVELS: readonly ["complete", "partial", "unknown"];
export type ClientFeatureFlagName = (typeof CLIENT_FEATURE_FLAG_NAMES)[number];
export type ClientHubCapabilityName = (typeof CLIENT_HUB_CAPABILITY_NAMES)[number];
export type ClientFeatureUnavailableReason = (typeof CLIENT_FEATURE_UNAVAILABLE_REASONS)[number];
export type ClientCoverageLevel = (typeof CLIENT_COVERAGE_LEVELS)[number];
export declare const clientFeatureAvailabilitySchema: z.ZodObject<{
    available: z.ZodBoolean;
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** An admitted send-path and receipt profile of the client (X8): adapter version
 *  plus module fingerprints. No code and no selectors. */
export declare const clientReceiptProfileSchema: z.ZodObject<{
    id: z.ZodString;
    adapterVersion: z.ZodString;
    modules: z.ZodRecord<z.ZodString, z.ZodString>;
}, z.core.$strip>;
export declare const clientBootstrapPageSchema: z.ZodObject<{
    pageId: z.ZodNumber;
    pageLabel: z.ZodString;
    title: z.ZodString;
    platform: z.ZodString;
    platformAccountId: z.ZodNullable<z.ZodString>;
    bindingRevision: z.ZodNumber;
    features: z.ZodRecord<z.ZodString, z.ZodObject<{
        available: z.ZodBoolean;
        reason: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const clientBootstrapLimitsSchema: z.ZodObject<{
    freshTextMaxItems: z.ZodNumber;
    freshTextMaxChars: z.ZodNumber;
    feedMax: z.ZodNumber;
    deepMax: z.ZodNumber;
    audienceWindowHours: z.ZodNumber;
    claimLeaseSec: z.ZodNumber;
    claimRenewSec: z.ZodNumber;
    claimActivityWindowSec: z.ZodNumber;
    previewSendPerMinute: z.ZodNumber;
    greetingSendPerMinute: z.ZodOptional<z.ZodNumber>;
    navInsertTimeoutSec: z.ZodNumber;
    dispatchTicketSec: z.ZodNumber;
    previewSendReceiptProfiles: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        adapterVersion: z.ZodString;
        modules: z.ZodRecord<z.ZodString, z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const clientBootstrapResponseSchema: z.ZodObject<{
    protocol: z.ZodNumber;
    issuedAt: z.ZodString;
    ttlSec: z.ZodNumber;
    configRevision: z.ZodNumber;
    minVersion: z.ZodString;
    identity: z.ZodObject<{
        userId: z.ZodNumber;
        username: z.ZodString;
        role: z.ZodString;
        tokenClient: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
    pages: z.ZodArray<z.ZodObject<{
        pageId: z.ZodNumber;
        pageLabel: z.ZodString;
        title: z.ZodString;
        platform: z.ZodString;
        platformAccountId: z.ZodNullable<z.ZodString>;
        bindingRevision: z.ZodNumber;
        features: z.ZodRecord<z.ZodString, z.ZodObject<{
            available: z.ZodBoolean;
            reason: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    bindingsByHost: z.ZodRecord<z.ZodString, z.ZodNumber>;
    flags: z.ZodRecord<z.ZodString, z.ZodBoolean>;
    limits: z.ZodObject<{
        freshTextMaxItems: z.ZodNumber;
        freshTextMaxChars: z.ZodNumber;
        feedMax: z.ZodNumber;
        deepMax: z.ZodNumber;
        audienceWindowHours: z.ZodNumber;
        claimLeaseSec: z.ZodNumber;
        claimRenewSec: z.ZodNumber;
        claimActivityWindowSec: z.ZodNumber;
        previewSendPerMinute: z.ZodNumber;
        greetingSendPerMinute: z.ZodOptional<z.ZodNumber>;
        navInsertTimeoutSec: z.ZodNumber;
        dispatchTicketSec: z.ZodNumber;
        previewSendReceiptProfiles: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            adapterVersion: z.ZodString;
            modules: z.ZodRecord<z.ZodString, z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    capabilities: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
/** Known values of `coverage.transcriptCoverage`. On the wire an open token. */
export declare const CLIENT_RECAP_TRANSCRIPT_COVERAGES: readonly ["full-history", "window"];
export type ClientRecapTranscriptCoverage = (typeof CLIENT_RECAP_TRANSCRIPT_COVERAGES)[number];
export declare const clientConversationRecapsQuerySchema: z.ZodObject<{
    personaDefinitionId: z.ZodOptional<z.ZodString>;
    conversationRef: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const clientRecapBodySchema: z.ZodObject<{
    generationRef: z.ZodString;
    generatedAt: z.ZodString;
    personaDefinitionId: z.ZodNullable<z.ZodString>;
    coverage: z.ZodObject<{
        transcriptCoverage: z.ZodNullable<z.ZodString>;
        requestedCount: z.ZodNullable<z.ZodNumber>;
        keptCount: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>;
    text: z.ZodString;
}, z.core.$strip>;
export declare const clientConversationRecapsResponseSchema: z.ZodObject<{
    full: z.ZodNullable<z.ZodObject<{
        generationRef: z.ZodString;
        generatedAt: z.ZodString;
        personaDefinitionId: z.ZodNullable<z.ZodString>;
        coverage: z.ZodObject<{
            transcriptCoverage: z.ZodNullable<z.ZodString>;
            requestedCount: z.ZodNullable<z.ZodNumber>;
            keptCount: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        text: z.ZodString;
    }, z.core.$strip>>;
    short: z.ZodNullable<z.ZodObject<{
        generationRef: z.ZodString;
        generatedAt: z.ZodString;
        personaDefinitionId: z.ZodNullable<z.ZodString>;
        coverage: z.ZodObject<{
            transcriptCoverage: z.ZodNullable<z.ZodString>;
            requestedCount: z.ZodNullable<z.ZodNumber>;
            keptCount: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        text: z.ZodString;
    }, z.core.$strip>>;
    fullSavedToProfile: z.ZodBoolean;
}, z.core.$strip>;
/**
 * The client's own request id as it travels: 8-4-4-4-12 hex, any case and any
 * version nibble. Wider than `z.string().uuid()` on purpose: the chat extension
 * froze this form for the ids it mints, and the value is only compared with the
 * request id of an AI request the caller already made. Spelled without a flag,
 * so the OpenAPI document states the same pattern.
 */
export declare const CLIENT_REQUEST_ID_PATTERN: RegExp;
/**
 * Known `reason` values of 409 `generation_not_eligible`: why a stored
 * generation of the caller will never become the dossier. On the wire an open
 * token; append-only.
 * - `not_full_summary`: not a `fan-summary`, or not its full mode;
 * - `not_completed`: the generation failed or was cancelled;
 * - `stop_reason_missing`: it recorded no stop reason, so nothing proves it ended;
 * - `output_exhausted`: its output ran into the limit (`max_tokens`, `length`);
 * - `empty`: it has no text;
 * - `context_scope`: its context held something only its caller saw;
 * - `too_long`: its text is longer than a dossier may be;
 * - `superseded`: the fan's dossier already holds a text that is not older.
 *   The one reason that says nothing against the generation: a client may show
 *   it as information rather than as a failed save.
 */
export declare const CLIENT_GENERATION_NOT_ELIGIBLE_REASONS: readonly ["not_full_summary", "not_completed", "stop_reason_missing", "output_exhausted", "empty", "context_scope", "too_long", "superseded"];
export type ClientGenerationNotEligibleReason = (typeof CLIENT_GENERATION_NOT_ELIGIBLE_REASONS)[number];
export declare const clientFanProfileFromGenerationBodySchema: z.ZodObject<{
    generationRef: z.ZodString;
    clientRequestId: z.ZodOptional<z.ZodString>;
    conversationRef: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const clientFanProfileFromGenerationResponseSchema: z.ZodObject<{
    outcome: z.ZodEnum<{
        created: "created";
        existing: "existing";
    }>;
    profile: z.ZodObject<{
        version: z.ZodNumber;
        createdAt: z.ZodString;
        sourceGeneratedAt: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>;
/** The most rows one page carries; the bootstrap announces it as `limits.feedMax`. */
export declare const CLIENT_FEED_MAX_LIMIT = 100;
export declare const CLIENT_FEED_DEFAULT_LIMIT = 50;
/** The first page's summary reads this many of the newest messages unless the query says otherwise: the Ping window. */
export declare const CLIENT_FEED_SUMMARY_WINDOW_DEFAULT = 100;
export declare const CLIENT_FEED_SUMMARY_WINDOW_MIN = 5;
/** The transcript readers' own cap. The deeper read (up to 5000) is the full Recap's and the notes fill's alone: a feed page never makes it. */
export declare const CLIENT_FEED_SUMMARY_WINDOW_MAX = 1500;
/** Known values of the feed's `source`. On the wire an open token. The AI
 *  context frame names the same readers (`AI_CONTEXT_SOURCES` in routes.ts). */
export declare const CLIENT_FEED_SOURCES: readonly ["archive", "union"];
/** Known values of `sender` (a row's and the head's). On the wire an open token. */
export declare const CLIENT_FEED_SENDERS: readonly ["fan", "model", "system", "unknown"];
/**
 * Known values of `summary.pingSegment`. On the wire an open token. This hub
 * answers the segment a Ping generation would be given for the same messages
 * (`active`, `segment-a`, `segment-b`); `unknown` is what a client reads any
 * other value as, and what it shows when `summary` is null.
 */
export declare const CLIENT_FEED_PING_SEGMENTS: readonly ["active", "segment-a", "segment-b", "unknown"];
export type ClientFeedSource = (typeof CLIENT_FEED_SOURCES)[number];
export type ClientFeedSender = (typeof CLIENT_FEED_SENDERS)[number];
export type ClientFeedPingSegment = (typeof CLIENT_FEED_PING_SEGMENTS)[number];
/** `depthMarks` names at most this many counts (`coach-depth-v1`). */
export declare const CLIENT_FEED_DEPTH_MARKS_MAX = 8;
/** The largest count `depthMarks` takes: the deepest AI transcript read. */
export declare const CLIENT_FEED_DEPTH_MARK_MAX = 5000;
export declare const clientConversationFeedQuerySchema: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    summaryWindow: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    conversationRef: z.ZodOptional<z.ZodString>;
    depthMarks: z.ZodOptional<z.ZodPipe<z.ZodString, z.ZodTransform<number[], string>>>;
}, z.core.$strict>;
export declare const clientFeedItemSchema: z.ZodObject<{
    messageId: z.ZodString;
    at: z.ZodNullable<z.ZodString>;
    sender: z.ZodString;
    text: z.ZodString;
    automatic: z.ZodNullable<z.ZodBoolean>;
    deleted: z.ZodBoolean;
    tipMills: z.ZodNullable<z.ZodNumber>;
    priceMills: z.ZodNullable<z.ZodNumber>;
    attachmentLabels: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
/** The newest message a generation would read from this reader: live, never a deleted one. */
export declare const clientFeedHeadSchema: z.ZodObject<{
    messageRef: z.ZodString;
    at: z.ZodNullable<z.ZodString>;
    sender: z.ZodString;
}, z.core.$strip>;
export declare const clientFeedSummarySchema: z.ZodObject<{
    pingSegment: z.ZodString;
    fanSilenceDays: z.ZodNullable<z.ZodNumber>;
    window: z.ZodObject<{
        requested: z.ZodNumber;
        served: z.ZodNumber;
    }, z.core.$strip>;
    coverage: z.ZodString;
    asOf: z.ZodString;
}, z.core.$strip>;
/**
 * `coach-depth-v1`: how deep the conversation's stored history goes, for the
 * chatter to choose how many messages Coach reads. The messages are the ones
 * an AI generation reads from the hub's stores, counted by its own reader
 * (`source`) and its filters: not deleted, with content and a time. Coach's
 * `messageCount: N` reads the N newest of them (the socket messages a Fansly
 * generation adds are the newest of a chat and not counted here).
 */
export declare const clientFeedDepthSchema: z.ZodObject<{
    storedCount: z.ZodNumber;
    oldestAt: z.ZodNullable<z.ZodString>;
    historyComplete: z.ZodBoolean;
    marks: z.ZodArray<z.ZodObject<{
        count: z.ZodNumber;
        at: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const clientConversationFeedResponseSchema: z.ZodObject<{
    target: z.ZodObject<{
        pageLabel: z.ZodString;
        fanRef: z.ZodString;
        conversationRef: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    source: z.ZodString;
    snapshotRevision: z.ZodString;
    asOf: z.ZodString;
    coverage: z.ZodString;
    head: z.ZodNullable<z.ZodObject<{
        messageRef: z.ZodString;
        at: z.ZodNullable<z.ZodString>;
        sender: z.ZodString;
    }, z.core.$strip>>;
    newestKnownAt: z.ZodNullable<z.ZodString>;
    nextOlderCursor: z.ZodNullable<z.ZodString>;
    items: z.ZodArray<z.ZodObject<{
        messageId: z.ZodString;
        at: z.ZodNullable<z.ZodString>;
        sender: z.ZodString;
        text: z.ZodString;
        automatic: z.ZodNullable<z.ZodBoolean>;
        deleted: z.ZodBoolean;
        tipMills: z.ZodNullable<z.ZodNumber>;
        priceMills: z.ZodNullable<z.ZodNumber>;
        attachmentLabels: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>;
    summary: z.ZodNullable<z.ZodObject<{
        pingSegment: z.ZodString;
        fanSilenceDays: z.ZodNullable<z.ZodNumber>;
        window: z.ZodObject<{
            requested: z.ZodNumber;
            served: z.ZodNumber;
        }, z.core.$strip>;
        coverage: z.ZodString;
        asOf: z.ZodString;
    }, z.core.$strip>>;
    depth: z.ZodOptional<z.ZodObject<{
        storedCount: z.ZodNumber;
        oldestAt: z.ZodNullable<z.ZodString>;
        historyComplete: z.ZodBoolean;
        marks: z.ZodArray<z.ZodObject<{
            count: z.ZodNumber;
            at: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** At most this many days in one answer. */
export declare const CLIENT_AI_USAGE_MAX_DAYS = 7;
/** `date` may lie this many days before today (today in `timeZone`), no further. */
export declare const CLIENT_AI_USAGE_MAX_AGE_DAYS = 8;
/** Known values of `days[].coverage`. On the wire an open token. */
export declare const CLIENT_AI_USAGE_COVERAGE: readonly ["complete", "partial"];
/** Known values of `days[].coverageReasons`: why a day's numbers may still change or are not exact. */
export declare const CLIENT_AI_USAGE_COVERAGE_REASONS: readonly ["day_open", "open_reservations", "approximate_cost"];
/** The `reason` beside this route's 400 `bad_request`. */
export declare const CLIENT_AI_USAGE_REFUSAL_REASONS: readonly ["unknown_time_zone", "date_in_future", "date_too_old"];
export type ClientAiUsageCoverage = (typeof CLIENT_AI_USAGE_COVERAGE)[number];
export type ClientAiUsageCoverageReason = (typeof CLIENT_AI_USAGE_COVERAGE_REASONS)[number];
export type ClientAiUsageRefusalReason = (typeof CLIENT_AI_USAGE_REFUSAL_REASONS)[number];
export declare const clientAiUsageQuerySchema: z.ZodObject<{
    date: z.ZodString;
    days: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    timeZone: z.ZodDefault<z.ZodString>;
}, z.core.$strict>;
export declare const clientAiUsageTotalsSchema: z.ZodObject<{
    requestCount: z.ZodNumber;
    costMicroUsd: z.ZodNumber;
    costApproximate: z.ZodBoolean;
    tokens: z.ZodObject<{
        input: z.ZodNumber;
        output: z.ZodNumber;
        cacheWrite: z.ZodNumber;
        cacheRead: z.ZodNumber;
    }, z.core.$strip>;
    completed: z.ZodNumber;
    failed: z.ZodNumber;
    cancelled: z.ZodNumber;
    quotaDenied: z.ZodNumber;
    openReservations: z.ZodNumber;
    regenerations: z.ZodNumber;
}, z.core.$strip>;
export declare const clientAiUsageDaySchema: z.ZodObject<{
    date: z.ZodString;
    from: z.ZodString;
    toExclusive: z.ZodString;
    coverage: z.ZodString;
    coverageReasons: z.ZodArray<z.ZodString>;
    totals: z.ZodObject<{
        requestCount: z.ZodNumber;
        costMicroUsd: z.ZodNumber;
        costApproximate: z.ZodBoolean;
        tokens: z.ZodObject<{
            input: z.ZodNumber;
            output: z.ZodNumber;
            cacheWrite: z.ZodNumber;
            cacheRead: z.ZodNumber;
        }, z.core.$strip>;
        completed: z.ZodNumber;
        failed: z.ZodNumber;
        cancelled: z.ZodNumber;
        quotaDenied: z.ZodNumber;
        openReservations: z.ZodNumber;
        regenerations: z.ZodNumber;
    }, z.core.$strip>;
    features: z.ZodArray<z.ZodObject<{
        requestCount: z.ZodNumber;
        costMicroUsd: z.ZodNumber;
        costApproximate: z.ZodBoolean;
        tokens: z.ZodObject<{
            input: z.ZodNumber;
            output: z.ZodNumber;
            cacheWrite: z.ZodNumber;
            cacheRead: z.ZodNumber;
        }, z.core.$strip>;
        completed: z.ZodNumber;
        failed: z.ZodNumber;
        cancelled: z.ZodNumber;
        quotaDenied: z.ZodNumber;
        openReservations: z.ZodNumber;
        regenerations: z.ZodNumber;
        feature: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const clientAiUsageResponseSchema: z.ZodObject<{
    scope: z.ZodObject<{
        pageLabel: z.ZodString;
        userId: z.ZodNumber;
    }, z.core.$strip>;
    timeZone: z.ZodString;
    asOf: z.ZodString;
    moneyUnit: z.ZodLiteral<"micro-USD">;
    days: z.ZodArray<z.ZodObject<{
        date: z.ZodString;
        from: z.ZodString;
        toExclusive: z.ZodString;
        coverage: z.ZodString;
        coverageReasons: z.ZodArray<z.ZodString>;
        totals: z.ZodObject<{
            requestCount: z.ZodNumber;
            costMicroUsd: z.ZodNumber;
            costApproximate: z.ZodBoolean;
            tokens: z.ZodObject<{
                input: z.ZodNumber;
                output: z.ZodNumber;
                cacheWrite: z.ZodNumber;
                cacheRead: z.ZodNumber;
            }, z.core.$strip>;
            completed: z.ZodNumber;
            failed: z.ZodNumber;
            cancelled: z.ZodNumber;
            quotaDenied: z.ZodNumber;
            openReservations: z.ZodNumber;
            regenerations: z.ZodNumber;
        }, z.core.$strip>;
        features: z.ZodArray<z.ZodObject<{
            requestCount: z.ZodNumber;
            costMicroUsd: z.ZodNumber;
            costApproximate: z.ZodBoolean;
            tokens: z.ZodObject<{
                input: z.ZodNumber;
                output: z.ZodNumber;
                cacheWrite: z.ZodNumber;
                cacheRead: z.ZodNumber;
            }, z.core.$strip>;
            completed: z.ZodNumber;
            failed: z.ZodNumber;
            cancelled: z.ZodNumber;
            quotaDenied: z.ZodNumber;
            openReservations: z.ZodNumber;
            regenerations: z.ZodNumber;
            feature: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    quota: z.ZodNullable<z.ZodObject<{
        dayBoundary: z.ZodLiteral<"UTC">;
        remainingRequestsToday: z.ZodNullable<z.ZodNumber>;
        remainingMicroUsdToday: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** v1 serves one window length; another one is a new value of `windowDays`. */
export declare const CLIENT_SPENDER_STATS_WINDOW_DAYS = 30;
/**
 * Known values of `coverage.reasons`: why the answer is not `complete`. On the
 * wire open tokens; a client reads one it does not know as "partial".
 * - `no_revenue_history`: the page has no transaction and no spender
 *   projection, so nothing is known (`coverage.state` is `unknown`);
 * - `projection_missing`: the spender projection was never built; tiers,
 *   silence and the queue read it;
 * - `projection_behind`: a transaction is newer than the projection, so tier
 *   membership may lag the window totals;
 * - `history_starts_in_window`: the page's oldest transaction is inside the
 *   window; earlier days may be missing, and a new payer's first purchase is
 *   only the first one observed (`newPayers.firstPurchaseKnown` is false);
 * - `messages_missing`: the page has payers and no message at all, so every
 *   payer's silence is `unknown`.
 */
export declare const CLIENT_SPENDER_STATS_COVERAGE_REASONS: readonly ["no_revenue_history", "projection_missing", "projection_behind", "history_starts_in_window", "messages_missing"];
/**
 * The two `tiers[].key` rows after the hub's spender buckets, both without
 * bounds: `untiered` is window spend by fans in no tier, `unattributed` is
 * window spend whose transaction names no fan. With them the tiers' window
 * gross sums to `totals.d30.grossMills`.
 */
export declare const CLIENT_SPENDER_STATS_REMAINDER_TIER_KEYS: readonly ["untiered", "unattributed"];
/** The `reason` beside this route's 400 `bad_request`. */
export declare const CLIENT_SPENDER_STATS_REFUSAL_REASONS: readonly ["unknown_time_zone"];
export type ClientSpenderStatsCoverageReason = (typeof CLIENT_SPENDER_STATS_COVERAGE_REASONS)[number];
export type ClientSpenderStatsRefusalReason = (typeof CLIENT_SPENDER_STATS_REFUSAL_REASONS)[number];
export declare const clientSpenderStatsQuerySchema: z.ZodObject<{
    windowDays: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    timeZone: z.ZodString;
}, z.core.$strict>;
/** Money of one calendar window. */
export declare const clientSpenderStatsMoneyWindowSchema: z.ZodObject<{
    grossMills: z.ZodNumber;
    purchasesGrossMills: z.ZodNumber;
    adjustmentsMills: z.ZodNumber;
    creatorNetMills: z.ZodNumber;
    purchaseCount: z.ZodNumber;
    payerCount: z.ZodNumber;
}, z.core.$strip>;
export declare const clientSpenderStatsDaySchema: z.ZodObject<{
    date: z.ZodString;
    grossMills: z.ZodNumber;
    purchasesGrossMills: z.ZodNumber;
    adjustmentsMills: z.ZodNumber;
    creatorNetMills: z.ZodNumber;
    purchaseCount: z.ZodNumber;
    byState: z.ZodRecord<z.ZodString, z.ZodNumber>;
}, z.core.$strip>;
export declare const clientSpenderStatsTierSchema: z.ZodObject<{
    key: z.ZodString;
    label: z.ZodString;
    minMills: z.ZodNullable<z.ZodNumber>;
    maxMills: z.ZodNullable<z.ZodNumber>;
    members: z.ZodNumber;
    windowPayers: z.ZodNumber;
    windowGrossMills: z.ZodNumber;
    windowNetMills: z.ZodNumber;
}, z.core.$strip>;
export declare const clientSpenderStatsResponseSchema: z.ZodObject<{
    pageLabel: z.ZodString;
    metricVersion: z.ZodNumber;
    moneyUnit: z.ZodLiteral<"USD-mills">;
    basis: z.ZodLiteral<"gross">;
    timeZone: z.ZodString;
    from: z.ZodString;
    to: z.ZodString;
    asOf: z.ZodString;
    projectionAsOf: z.ZodNullable<z.ZodString>;
    includedStates: z.ZodArray<z.ZodString>;
    coverage: z.ZodObject<{
        state: z.ZodString;
        reasons: z.ZodArray<z.ZodString>;
    }, z.core.$strip>;
    days: z.ZodArray<z.ZodObject<{
        date: z.ZodString;
        grossMills: z.ZodNumber;
        purchasesGrossMills: z.ZodNumber;
        adjustmentsMills: z.ZodNumber;
        creatorNetMills: z.ZodNumber;
        purchaseCount: z.ZodNumber;
        byState: z.ZodRecord<z.ZodString, z.ZodNumber>;
    }, z.core.$strip>>;
    totals: z.ZodObject<{
        today: z.ZodObject<{
            grossMills: z.ZodNumber;
            purchasesGrossMills: z.ZodNumber;
            adjustmentsMills: z.ZodNumber;
            creatorNetMills: z.ZodNumber;
            purchaseCount: z.ZodNumber;
            payerCount: z.ZodNumber;
        }, z.core.$strip>;
        d7: z.ZodObject<{
            grossMills: z.ZodNumber;
            purchasesGrossMills: z.ZodNumber;
            adjustmentsMills: z.ZodNumber;
            creatorNetMills: z.ZodNumber;
            purchaseCount: z.ZodNumber;
            payerCount: z.ZodNumber;
        }, z.core.$strip>;
        prev7: z.ZodObject<{
            grossMills: z.ZodNumber;
            purchasesGrossMills: z.ZodNumber;
            adjustmentsMills: z.ZodNumber;
            creatorNetMills: z.ZodNumber;
            purchaseCount: z.ZodNumber;
            payerCount: z.ZodNumber;
        }, z.core.$strip>;
        d30: z.ZodObject<{
            grossMills: z.ZodNumber;
            purchasesGrossMills: z.ZodNumber;
            adjustmentsMills: z.ZodNumber;
            creatorNetMills: z.ZodNumber;
            purchaseCount: z.ZodNumber;
            payerCount: z.ZodNumber;
        }, z.core.$strip>;
        d7DeltaPct: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>;
    avgCheckMills: z.ZodNullable<z.ZodNumber>;
    tiers: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        label: z.ZodString;
        minMills: z.ZodNullable<z.ZodNumber>;
        maxMills: z.ZodNullable<z.ZodNumber>;
        members: z.ZodNumber;
        windowPayers: z.ZodNumber;
        windowGrossMills: z.ZodNumber;
        windowNetMills: z.ZodNumber;
    }, z.core.$strip>>;
    silence: z.ZodObject<{
        d8to21: z.ZodObject<{
            fans: z.ZodNumber;
            lifetimeGrossMills: z.ZodNumber;
        }, z.core.$strip>;
        over21: z.ZodObject<{
            fans: z.ZodNumber;
            lifetimeGrossMills: z.ZodNumber;
        }, z.core.$strip>;
        unknown: z.ZodObject<{
            fans: z.ZodNumber;
            lifetimeGrossMills: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>;
    newPayers: z.ZodObject<{
        count: z.ZodNumber;
        firstPurchaseKnown: z.ZodBoolean;
    }, z.core.$strip>;
    queueSummary: z.ZodObject<{
        total: z.ZodNumber;
        unknown: z.ZodNumber;
    }, z.core.$strip>;
}, z.core.$strip>;
/** The most rows one page carries. */
export declare const CLIENT_SPENDER_AWAITING_REPLY_MAX_LIMIT = 100;
export declare const CLIENT_SPENDER_AWAITING_REPLY_DEFAULT_LIMIT = 50;
/**
 * Known values of `readState`. On the wire an open token; a client reads one
 * it does not know as `unknown`.
 * - `unread`: the chat has unread fan messages (`unreadCount` says how many);
 * - `read`: nothing is unread and the chat's newest message is the fan's;
 * - `unknown`: the fan wrote after the page's last message, but the hub cannot
 *   tell whether it was read. Its own category, never folded into the other
 *   two; `unreadCount` is null.
 */
export declare const CLIENT_SPENDER_AWAITING_REPLY_READ_STATES: readonly ["unread", "read", "unknown"];
export type ClientSpenderAwaitingReplyReadState = (typeof CLIENT_SPENDER_AWAITING_REPLY_READ_STATES)[number];
export declare const clientSpenderAwaitingReplyQuerySchema: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    everyone: z.ZodOptional<z.ZodPipe<z.ZodEnum<{
        true: "true";
        false: "false";
    }>, z.ZodTransform<boolean, "true" | "false">>>;
}, z.core.$strict>;
export declare const clientSpenderAwaitingReplyItemSchema: z.ZodObject<{
    fanRef: z.ZodString;
    conversationRef: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    alias: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    username: z.ZodNullable<z.ZodString>;
    displayName: z.ZodNullable<z.ZodString>;
    lifetimeGrossMills: z.ZodNumber;
    lastFanMessageAt: z.ZodString;
    lastModelMessageAt: z.ZodNullable<z.ZodString>;
    unreadCount: z.ZodNullable<z.ZodNumber>;
    readState: z.ZodString;
}, z.core.$strip>;
export declare const clientSpenderAwaitingReplyResponseSchema: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        fanRef: z.ZodString;
        conversationRef: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        alias: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        username: z.ZodNullable<z.ZodString>;
        displayName: z.ZodNullable<z.ZodString>;
        lifetimeGrossMills: z.ZodNumber;
        lastFanMessageAt: z.ZodString;
        lastModelMessageAt: z.ZodNullable<z.ZodString>;
        unreadCount: z.ZodNullable<z.ZodNumber>;
        readState: z.ZodString;
    }, z.core.$strip>>;
    total: z.ZodNumber;
    loaded: z.ZodNumber;
    unknown: z.ZodNumber;
    nextCursor: z.ZodNullable<z.ZodString>;
    asOf: z.ZodString;
}, z.core.$strip>;
/** The longest range one read may span, in days. */
export declare const ADMIN_CLIENT_HEALTH_MAX_RANGE_DAYS = 366;
export declare const adminClientHealthQuerySchema: z.ZodObject<{
    from: z.ZodString;
    to: z.ZodString;
    clientName: z.ZodOptional<z.ZodString>;
    metric: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
/**
 * One perf metric of one client group over the range, read off the buckets
 * merged across every report and hour of it (a percentile is never averaged
 * from parts). Milliseconds.
 *
 * A group with fewer than `minGroupSize` observations in the range asked for is
 * `suppressed`: it shows how many observations it has and no figure of them
 * (mean, max and both percentiles are null). The floor is on the range of one
 * read and no narrower: see the route's description.
 */
export declare const adminClientHealthPerfRowSchema: z.ZodObject<{
    clientName: z.ZodString;
    clientVersion: z.ZodString;
    hostKind: z.ZodString;
    hostBuild: z.ZodNullable<z.ZodString>;
    metric: z.ZodString;
    schemaVersion: z.ZodNumber;
    count: z.ZodNumber;
    mean: z.ZodNullable<z.ZodNumber>;
    max: z.ZodNullable<z.ZodNumber>;
    p50: z.ZodNullable<z.ZodNumber>;
    p95: z.ZodNullable<z.ZodNumber>;
    suppressed: z.ZodBoolean;
}, z.core.$strip>;
/**
 * The host-contract verdicts of one client version on one host build: counts of
 * reports, shown at any size (a build that breaks the contract shows from its
 * first report).
 */
export declare const adminClientHealthContractRowSchema: z.ZodObject<{
    clientVersion: z.ZodString;
    hostBuild: z.ZodNullable<z.ZodString>;
    reports: z.ZodNumber;
    failedReports: z.ZodNumber;
    missing: z.ZodArray<z.ZodObject<{
        anchor: z.ZodString;
        reports: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * The client's own footprint by client version: the 95th percentile, over
 * reports, of the size of its caches and logs (KB) and of the largest number of
 * its own DOM nodes in a report's window. Null under `minGroupSize` reports.
 */
export declare const adminClientHealthFootprintRowSchema: z.ZodObject<{
    clientVersion: z.ZodString;
    cachesKBp95: z.ZodNullable<z.ZodNumber>;
    logsKBp95: z.ZodNullable<z.ZodNumber>;
    domNodesP95: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
export declare const adminClientHealthResponseSchema: z.ZodObject<{
    range: z.ZodObject<{
        from: z.ZodString;
        to: z.ZodString;
        timeZone: z.ZodString;
    }, z.core.$strip>;
    minGroupSize: z.ZodNumber;
    perf: z.ZodArray<z.ZodObject<{
        clientName: z.ZodString;
        clientVersion: z.ZodString;
        hostKind: z.ZodString;
        hostBuild: z.ZodNullable<z.ZodString>;
        metric: z.ZodString;
        schemaVersion: z.ZodNumber;
        count: z.ZodNumber;
        mean: z.ZodNullable<z.ZodNumber>;
        max: z.ZodNullable<z.ZodNumber>;
        p50: z.ZodNullable<z.ZodNumber>;
        p95: z.ZodNullable<z.ZodNumber>;
        suppressed: z.ZodBoolean;
    }, z.core.$strip>>;
    contract: z.ZodArray<z.ZodObject<{
        clientVersion: z.ZodString;
        hostBuild: z.ZodNullable<z.ZodString>;
        reports: z.ZodNumber;
        failedReports: z.ZodNumber;
        missing: z.ZodArray<z.ZodObject<{
            anchor: z.ZodString;
            reports: z.ZodNumber;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    counters: z.ZodArray<z.ZodObject<{
        code: z.ZodString;
        total: z.ZodNumber;
    }, z.core.$strip>>;
    footprint: z.ZodArray<z.ZodObject<{
        clientVersion: z.ZodString;
        cachesKBp95: z.ZodNullable<z.ZodNumber>;
        logsKBp95: z.ZodNullable<z.ZodNumber>;
        domNodesP95: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
    asOf: z.ZodString;
}, z.core.$strip>;
export declare const CLIENT_CLAIM_ACTIONS: readonly ["claim", "renew", "release", "dispatch", "sent", "failed", "registerNativeSend"];
export declare const CLIENT_GREETING_STATES: readonly ["none", "confirmed"];
export declare const CLIENT_LEASE_STATES: readonly ["none", "owned", "held", "expired", "released"];
/** The holder of a lease is never named: only whether it is the caller elsewhere. */
export declare const CLIENT_LEASE_HOLDERS: readonly ["you-elsewhere", "someone-else"];
export declare const CLIENT_CUSTODY_STATES: readonly ["dispatching", "sent", "failed", "uncertain-held", "resolved-sent", "resolved-not-sent"];
/**
 * Known values of `greeting.source`; on the wire an open token. `desktop-outbox`:
 * the desktop's new-follower command that OnlyFans confirmed greeted the fan.
 */
export declare const CLIENT_GREETING_SOURCES: readonly ["preview-send", "native-register", "resolve", "desktop-outbox"];
export declare const CLIENT_SEND_PURPOSES: readonly ["greeting", "preview-reply"];
export declare const CLIENT_SEND_FAILURE_REASONS: readonly ["not_enqueued", "native_rejected"];
/** A group has at most this many variants (Hi) and parts. */
export declare const CLIENT_CLAIM_MAX_VARIANTS = 3;
export declare const CLIENT_CLAIM_MAX_PARTS = 10;
/**
 * How a manual group's `generationRef` reads in an answer: this prefix and the
 * group's `textFingerprint`. An AI group's `generationRef` never starts with it.
 */
export declare const CLIENT_MANUAL_GROUP_REF_PREFIX = "manual:";
/** A manual group's `textFingerprint`: the sha256 of the exact text, lower-case hex. */
export declare const CLIENT_TEXT_FINGERPRINT_PATTERN: RegExp;
export type ClientClaimAction = (typeof CLIENT_CLAIM_ACTIONS)[number];
export type ClientCustodyState = (typeof CLIENT_CUSTODY_STATES)[number];
export type ClientGreetingSource = (typeof CLIENT_GREETING_SOURCES)[number];
export type ClientSendPurpose = (typeof CLIENT_SEND_PURPOSES)[number];
/** The parts of one generation: one group. `variant` is the Hi variant, 0 elsewhere. */
export declare const clientClaimGroupSchema: z.ZodObject<{
    generationRef: z.ZodString;
    variant: z.ZodNumber;
    partCount: z.ZodNumber;
}, z.core.$strict>;
/**
 * A text with no AI generation behind it (`manual-greeting-v1`): one part,
 * named by the sha256 of its exact text. Which purposes take it is the
 * platform's admission.
 */
export declare const clientManualClaimGroupSchema: z.ZodObject<{
    kind: z.ZodLiteral<"manual">;
    textFingerprint: z.ZodString;
}, z.core.$strict>;
/** The group a send names: an AI generation's, or a manual one. */
export declare const clientClaimSendGroupSchema: z.ZodUnion<readonly [z.ZodObject<{
    generationRef: z.ZodString;
    variant: z.ZodNumber;
    partCount: z.ZodNumber;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"manual">;
    textFingerprint: z.ZodString;
}, z.core.$strict>]>;
export declare const clientFanClaimBodySchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    action: z.ZodLiteral<"claim">;
    leaseToken: z.ZodString;
    instanceId: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"renew">;
    leaseToken: z.ZodString;
    instanceId: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"release">;
    leaseToken: z.ZodString;
    instanceId: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"dispatch">;
    attemptId: z.ZodString;
    instanceId: z.ZodString;
    purpose: z.ZodEnum<{
        greeting: "greeting";
        "preview-reply": "preview-reply";
    }>;
    group: z.ZodUnion<readonly [z.ZodObject<{
        generationRef: z.ZodString;
        variant: z.ZodNumber;
        partCount: z.ZodNumber;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"manual">;
        textFingerprint: z.ZodString;
    }, z.core.$strict>]>;
    partIndex: z.ZodNumber;
    textRevision: z.ZodNumber;
    leaseToken: z.ZodOptional<z.ZodString>;
    flagRevision: z.ZodNumber;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"sent">;
    attemptId: z.ZodString;
    instanceId: z.ZodString;
    platformMessageId: z.ZodString;
    evidence: z.ZodLiteral<"receipt+echo">;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"failed">;
    attemptId: z.ZodString;
    instanceId: z.ZodString;
    reason: z.ZodEnum<{
        not_enqueued: "not_enqueued";
        native_rejected: "native_rejected";
    }>;
    httpStatus: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"registerNativeSend">;
    attemptId: z.ZodString;
    instanceId: z.ZodString;
    purpose: z.ZodEnum<{
        greeting: "greeting";
        "preview-reply": "preview-reply";
    }>;
    group: z.ZodUnion<readonly [z.ZodObject<{
        generationRef: z.ZodString;
        variant: z.ZodNumber;
        partCount: z.ZodNumber;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"manual">;
        textFingerprint: z.ZodString;
    }, z.core.$strict>]>;
    partIndex: z.ZodNumber;
    platformMessageId: z.ZodString;
}, z.core.$strict>], "action">;
/** The answer of the claim POST and, never with a ticket, of the status GET. */
export declare const clientFanClaimResponseSchema: z.ZodObject<{
    greeting: z.ZodObject<{
        state: z.ZodEnum<{
            none: "none";
            confirmed: "confirmed";
        }>;
        at: z.ZodNullable<z.ZodString>;
        messageRef: z.ZodNullable<z.ZodString>;
        source: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
    lease: z.ZodObject<{
        state: z.ZodEnum<{
            none: "none";
            expired: "expired";
            owned: "owned";
            held: "held";
            released: "released";
        }>;
        leaseToken: z.ZodNullable<z.ZodString>;
        expiresAt: z.ZodNullable<z.ZodString>;
        heldBy: z.ZodNullable<z.ZodEnum<{
            "you-elsewhere": "you-elsewhere";
            "someone-else": "someone-else";
        }>>;
    }, z.core.$strip>;
    group: z.ZodNullable<z.ZodObject<{
        generationRef: z.ZodString;
        variant: z.ZodNumber;
        partCount: z.ZodNumber;
        sentParts: z.ZodArray<z.ZodNumber>;
        heldParts: z.ZodArray<z.ZodNumber>;
    }, z.core.$strip>>;
    custody: z.ZodNullable<z.ZodObject<{
        attemptId: z.ZodString;
        state: z.ZodEnum<{
            failed: "failed";
            dispatching: "dispatching";
            sent: "sent";
            "uncertain-held": "uncertain-held";
            "resolved-sent": "resolved-sent";
            "resolved-not-sent": "resolved-not-sent";
        }>;
        ticket: z.ZodNullable<z.ZodString>;
        ticketExpiresAt: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
    flagRevision: z.ZodNumber;
}, z.core.$strip>;
/** 429 `preview_send_rate_limited`: the error body plus when the window frees a slot. */
export declare const clientPreviewSendRateLimitedResponseSchema: z.ZodObject<{
    error: z.ZodString;
    message: z.ZodString;
    statusCode: z.ZodNumber;
    reason: z.ZodOptional<z.ZodString>;
    statusUrl: z.ZodOptional<z.ZodString>;
    retryAfterMs: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const clientSendCustodyParamsSchema: z.ZodObject<{
    pageLabel: z.ZodString;
    attemptId: z.ZodString;
}, z.core.$strip>;
export declare const clientSendCustodyResolveBodySchema: z.ZodObject<{
    outcome: z.ZodEnum<{
        sent: "sent";
        not_sent: "not_sent";
    }>;
    platformMessageId: z.ZodOptional<z.ZodString>;
    note: z.ZodString;
}, z.core.$strict>;
export declare const clientSendCustodyItemSchema: z.ZodObject<{
    attemptId: z.ZodString;
    fanRef: z.ZodString;
    userId: z.ZodNumber;
    purpose: z.ZodString;
    state: z.ZodString;
    generationRef: z.ZodString;
    partIndex: z.ZodNumber;
    partCount: z.ZodNumber;
    createdAt: z.ZodString;
    ticketExpiresAt: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/**
 * `held`: sends past their ticket that nobody ended (`uncertain-held`), the
 * longest held first. A send still inside its ticket is in flight and is not
 * listed. `resolved`: sends the owner or a team lead ended by hand, the last
 * resolved first, each with who resolved it, when, how and why.
 */
export declare const CLIENT_SEND_CUSTODY_LIST_STATES: readonly ["held", "resolved"];
/** Known values of `resolution.outcome`; on the wire an open token. The resolve body's own. */
export declare const CLIENT_SEND_CUSTODY_RESOLVE_OUTCOMES: readonly ["sent", "not_sent"];
export type ClientSendCustodyListState = (typeof CLIENT_SEND_CUSTODY_LIST_STATES)[number];
export declare const clientSendCustodyListQuerySchema: z.ZodObject<{
    state: z.ZodDefault<z.ZodEnum<{
        held: "held";
        resolved: "resolved";
    }>>;
    pageLabel: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strict>;
export declare const clientSendCustodyListItemSchema: z.ZodObject<{
    attemptId: z.ZodString;
    fanRef: z.ZodString;
    userId: z.ZodNumber;
    purpose: z.ZodString;
    state: z.ZodString;
    generationRef: z.ZodString;
    partIndex: z.ZodNumber;
    partCount: z.ZodNumber;
    createdAt: z.ZodString;
    ticketExpiresAt: z.ZodNullable<z.ZodString>;
    pageLabel: z.ZodString;
    variant: z.ZodNumber;
    username: z.ZodString;
    instanceId: z.ZodString;
    updatedAt: z.ZodString;
    greeting: z.ZodObject<{
        state: z.ZodString;
        at: z.ZodNullable<z.ZodString>;
        source: z.ZodNullable<z.ZodString>;
        firstPartIsThisAttempt: z.ZodBoolean;
    }, z.core.$strip>;
    resolution: z.ZodNullable<z.ZodObject<{
        outcome: z.ZodString;
        at: z.ZodString;
        userId: z.ZodNumber;
        username: z.ZodString;
        note: z.ZodString;
        platformMessageId: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const clientSendCustodyListResponseSchema: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        attemptId: z.ZodString;
        fanRef: z.ZodString;
        userId: z.ZodNumber;
        purpose: z.ZodString;
        state: z.ZodString;
        generationRef: z.ZodString;
        partIndex: z.ZodNumber;
        partCount: z.ZodNumber;
        createdAt: z.ZodString;
        ticketExpiresAt: z.ZodNullable<z.ZodString>;
        pageLabel: z.ZodString;
        variant: z.ZodNumber;
        username: z.ZodString;
        instanceId: z.ZodString;
        updatedAt: z.ZodString;
        greeting: z.ZodObject<{
            state: z.ZodString;
            at: z.ZodNullable<z.ZodString>;
            source: z.ZodNullable<z.ZodString>;
            firstPartIsThisAttempt: z.ZodBoolean;
        }, z.core.$strip>;
        resolution: z.ZodNullable<z.ZodObject<{
            outcome: z.ZodString;
            at: z.ZodString;
            userId: z.ZodNumber;
            username: z.ZodString;
            note: z.ZodString;
            platformMessageId: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    limit: z.ZodNumber;
    offset: z.ZodNumber;
    total: z.ZodNumber;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const CLIENT_AUDIENCE_NEW_DEFAULT_WINDOW_HOURS = 48;
/** The widest window; the bootstrap announces it as `limits.audienceWindowHours`. */
export declare const CLIENT_AUDIENCE_NEW_MAX_WINDOW_HOURS = 720;
export declare const CLIENT_AUDIENCE_NEW_DEFAULT_LIMIT = 50;
export declare const CLIENT_AUDIENCE_NEW_MAX_LIMIT = 100;
/**
 * Known values of `kind`. On the wire an open token. `new`: a first
 * subscription (with `trial` when it is a free trial). `returning`: a fan who
 * was subscribed before and came back: OnlyFans says so, or it names the
 * subscription new (a free-trial link taken again reads as a new trial) while
 * the hub holds a subscription of the fan that started earlier. `trial` stays
 * as OnlyFans said it. There is no "renewed": OnlyFans sends no notification
 * when a subscription renews by itself.
 */
export declare const CLIENT_AUDIENCE_NEW_KINDS: readonly ["new", "returning"];
/**
 * Known values of `subscribedAtSource`. On the wire an open token.
 * `notification`: the time of the subscription notification, which OnlyFans
 * gives to the minute. `subscribeAt`: the subscription's own start as a
 * subscriber sweep read it from OnlyFans, used once it names the same
 * subscription as the notification.
 */
export declare const CLIENT_AUDIENCE_NEW_SUBSCRIBED_AT_SOURCES: readonly ["subscribeAt", "notification"];
/** Known values of `status.subscriptionStatus`. On the wire an open token. */
export declare const CLIENT_AUDIENCE_NEW_SUBSCRIPTION_STATUSES: readonly ["active", "expired", "unknown"];
/**
 * Known values of `status.source`: which collector the subscription's state
 * rests on. On the wire an open token. `sweep`: the newest subscriber sweep
 * saw the fan, or a sweep's end retired a subscription it no longer found.
 * `webhook`: a notification wrote the state and no sweep has confirmed it
 * since. `none`: the hub holds no subscription of the fan on the page.
 */
export declare const CLIENT_AUDIENCE_NEW_STATUS_SOURCES: readonly ["sweep", "webhook", "none"];
/**
 * Known values of `coverage.reasons`: why the list may be missing a
 * subscription or a row's `status` may be out of date. On the wire open
 * tokens; the list is append-only.
 * - `delivery_history_off`: the hub does not collect the provider's webhook
 *   delivery history, so nothing would tell it of a notification that never
 *   arrived (`unknown`);
 * - `delivery_history_pending`: the collection is on and has not finished a
 *   first window (`unknown`);
 * - `delivery_history_before_window`: the delivery history is checked only up
 *   to a moment before the window starts (`unknown`);
 * - `delivery_history_behind`: it is checked up to a moment inside the window
 *   that lies further back from the window's end than the collector normally
 *   lags (`partial`);
 * - `subscription_event_pending`: a subscription notification received since
 *   the window started is journaled and not turned into an event yet, so its
 *   row is not in the list (`partial`);
 * - `subscription_projection_pending`, `subscription_projection_failed`: a
 *   subscription notification received since the window started is not applied
 *   to the page's subscriber state yet, or could not be (`partial`);
 * - `audience_sweep_missing`: no subscriber sweep of the page has completed, so
 *   nothing but notifications vouches for any `status` (`partial`);
 * - `audience_sweep_unverified`: the last sweep ended without a result the hub
 *   trusts (`partial`).
 */
export declare const CLIENT_AUDIENCE_NEW_COVERAGE_REASONS: readonly ["delivery_history_off", "delivery_history_pending", "delivery_history_before_window", "delivery_history_behind", "subscription_event_pending", "subscription_projection_pending", "subscription_projection_failed", "audience_sweep_missing", "audience_sweep_unverified"];
/**
 * The `reason` beside this route's 400 `bad_request`. `cursor_invalid`: the
 * cursor is not one this hub issued for this request (forged or cut, issued
 * for another page or person, or older than an hour); the answer never says
 * which. `cursor_window_mismatch`: the cursor is the caller's own, of a walk
 * with another `windowHours`.
 */
export declare const CLIENT_AUDIENCE_NEW_REFUSAL_REASONS: readonly ["cursor_invalid", "cursor_window_mismatch"];
export type ClientAudienceNewKind = (typeof CLIENT_AUDIENCE_NEW_KINDS)[number];
export type ClientAudienceNewSubscribedAtSource = (typeof CLIENT_AUDIENCE_NEW_SUBSCRIBED_AT_SOURCES)[number];
export type ClientAudienceNewSubscriptionStatus = (typeof CLIENT_AUDIENCE_NEW_SUBSCRIPTION_STATUSES)[number];
export type ClientAudienceNewStatusSource = (typeof CLIENT_AUDIENCE_NEW_STATUS_SOURCES)[number];
export type ClientAudienceNewCoverageReason = (typeof CLIENT_AUDIENCE_NEW_COVERAGE_REASONS)[number];
export type ClientAudienceNewRefusalReason = (typeof CLIENT_AUDIENCE_NEW_REFUSAL_REASONS)[number];
export declare const clientAudienceNewQuerySchema: z.ZodObject<{
    windowHours: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    cursor: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strict>;
/**
 * The greeting, lease and custody of one fan as a list row carries them: the
 * states the claim status read (`clientFanClaimStatus`) answers for the same
 * fan and caller, without the tokens and ids. The read names no client
 * install, so the caller's own live lease reads `held` by `you-elsewhere`.
 */
export declare const clientClaimSummarySchema: z.ZodObject<{
    greeting: z.ZodEnum<{
        none: "none";
        confirmed: "confirmed";
    }>;
    lease: z.ZodEnum<{
        none: "none";
        expired: "expired";
        owned: "owned";
        held: "held";
        released: "released";
    }>;
    heldBy: z.ZodNullable<z.ZodEnum<{
        "you-elsewhere": "you-elsewhere";
        "someone-else": "someone-else";
    }>>;
    custody: z.ZodNullable<z.ZodEnum<{
        failed: "failed";
        dispatching: "dispatching";
        sent: "sent";
        "uncertain-held": "uncertain-held";
        "resolved-sent": "resolved-sent";
        "resolved-not-sent": "resolved-not-sent";
    }>>;
}, z.core.$strip>;
export declare const clientAudienceNewItemSchema: z.ZodObject<{
    eventRef: z.ZodString;
    fanRef: z.ZodString;
    username: z.ZodNullable<z.ZodString>;
    displayName: z.ZodNullable<z.ZodString>;
    kind: z.ZodString;
    trial: z.ZodBoolean;
    subscribedAt: z.ZodString;
    subscribedAtSource: z.ZodString;
    status: z.ZodObject<{
        isSubscriber: z.ZodNullable<z.ZodBoolean>;
        subscriptionStatus: z.ZodString;
        endsAt: z.ZodNullable<z.ZodString>;
        asOf: z.ZodNullable<z.ZodString>;
        source: z.ZodString;
    }, z.core.$strip>;
    thread: z.ZodNullable<z.ZodObject<{
        lastMessageAt: z.ZodNullable<z.ZodString>;
        lastFanMessageAt: z.ZodNullable<z.ZodString>;
        lastModelMessageAt: z.ZodNullable<z.ZodString>;
        storedMessageCount: z.ZodNumber;
        coverage: z.ZodString;
        backfillComplete: z.ZodBoolean;
    }, z.core.$strip>>;
    lastPersonalSendAt: z.ZodNullable<z.ZodString>;
    claim: z.ZodObject<{
        greeting: z.ZodEnum<{
            none: "none";
            confirmed: "confirmed";
        }>;
        lease: z.ZodEnum<{
            none: "none";
            expired: "expired";
            owned: "owned";
            held: "held";
            released: "released";
        }>;
        heldBy: z.ZodNullable<z.ZodEnum<{
            "you-elsewhere": "you-elsewhere";
            "someone-else": "someone-else";
        }>>;
        custody: z.ZodNullable<z.ZodEnum<{
            failed: "failed";
            dispatching: "dispatching";
            sent: "sent";
            "uncertain-held": "uncertain-held";
            "resolved-sent": "resolved-sent";
            "resolved-not-sent": "resolved-not-sent";
        }>>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const clientAudienceNewResponseSchema: z.ZodObject<{
    pageLabel: z.ZodString;
    window: z.ZodObject<{
        hours: z.ZodNumber;
        from: z.ZodString;
        to: z.ZodString;
        snapshotAt: z.ZodString;
    }, z.core.$strip>;
    serverNow: z.ZodString;
    coverage: z.ZodObject<{
        state: z.ZodString;
        deliveryFrontier: z.ZodNullable<z.ZodString>;
        lastAudienceSweepAt: z.ZodNullable<z.ZodString>;
        reasons: z.ZodArray<z.ZodString>;
    }, z.core.$strip>;
    unknownCount: z.ZodNumber;
    welcomeTemplate: z.ZodNullable<z.ZodObject<{
        ref: z.ZodString;
        observedAt: z.ZodString;
        enabled: z.ZodNullable<z.ZodBoolean>;
        hasText: z.ZodBoolean;
        hasMedia: z.ZodBoolean;
        priceMills: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
    items: z.ZodArray<z.ZodObject<{
        eventRef: z.ZodString;
        fanRef: z.ZodString;
        username: z.ZodNullable<z.ZodString>;
        displayName: z.ZodNullable<z.ZodString>;
        kind: z.ZodString;
        trial: z.ZodBoolean;
        subscribedAt: z.ZodString;
        subscribedAtSource: z.ZodString;
        status: z.ZodObject<{
            isSubscriber: z.ZodNullable<z.ZodBoolean>;
            subscriptionStatus: z.ZodString;
            endsAt: z.ZodNullable<z.ZodString>;
            asOf: z.ZodNullable<z.ZodString>;
            source: z.ZodString;
        }, z.core.$strip>;
        thread: z.ZodNullable<z.ZodObject<{
            lastMessageAt: z.ZodNullable<z.ZodString>;
            lastFanMessageAt: z.ZodNullable<z.ZodString>;
            lastModelMessageAt: z.ZodNullable<z.ZodString>;
            storedMessageCount: z.ZodNumber;
            coverage: z.ZodString;
            backfillComplete: z.ZodBoolean;
        }, z.core.$strip>>;
        lastPersonalSendAt: z.ZodNullable<z.ZodString>;
        claim: z.ZodObject<{
            greeting: z.ZodEnum<{
                none: "none";
                confirmed: "confirmed";
            }>;
            lease: z.ZodEnum<{
                none: "none";
                expired: "expired";
                owned: "owned";
                held: "held";
                released: "released";
            }>;
            heldBy: z.ZodNullable<z.ZodEnum<{
                "you-elsewhere": "you-elsewhere";
                "someone-else": "someone-else";
            }>>;
            custody: z.ZodNullable<z.ZodEnum<{
                failed: "failed";
                dispatching: "dispatching";
                sent: "sent";
                "uncertain-held": "uncertain-held";
                "resolved-sent": "resolved-sent";
                "resolved-not-sent": "resolved-not-sent";
            }>>;
        }, z.core.$strip>;
    }, z.core.$strip>>;
    nextCursor: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/**
 * The clients that observe a send, by the page they run on: the `source` of a
 * report. Open on the wire; a platform admits its own (the hub's
 * CLIENT_SEND_ATTRIBUTION_ADMISSIONS): OnlyFans `chatspace-extension`, the
 * extension on OnlyMonster ChatSpace; Fansly `fansly-extension`, the extension
 * on fansly.com. Another one is 409 `client_feature_disabled` /
 * `platform_unsupported`.
 */
export declare const CLIENT_SEND_ATTRIBUTION_SOURCES: readonly ["chatspace-extension", "fansly-extension"];
/**
 * How the text of a send was written (Chat Memory week 1): `hand` — typed, or
 * pasted by something other than our buttons; `reply`, `fix`, `hi`, `ping`,
 * `coach` — inserted by that AI button of the extension; `unknown` — the client
 * could not tell (a send it could not link to the draft). Open on the wire: a
 * value the hub does not know is stored as `unknown`.
 */
export declare const CLIENT_SEND_ATTRIBUTION_COMPOSED_WITH: readonly ["hand", "reply", "fix", "hi", "ping", "coach", "unknown"];
/**
 * What the hub did with one fact; every one is final, nothing is retried:
 * - `recorded`: the first report of this message; it is stored.
 * - `duplicate`: the message was already reported by the same person for the same fan: a repeat.
 * - `conflict`: the message was already reported by another person, or for another fan. The first
 *   report stands.
 * - `out_of_range`: `observedAt` is more than CLIENT_SEND_ATTRIBUTION_MAX_AHEAD_MS ahead of the hub's
 *   clock or more than CLIENT_SEND_ATTRIBUTION_MAX_AGE_DAYS old; nothing is stored.
 */
export declare const CLIENT_SEND_ATTRIBUTION_OUTCOMES: readonly ["recorded", "duplicate", "conflict", "out_of_range"];
/** Facts in one report. */
export declare const CLIENT_SEND_ATTRIBUTION_MAX_FACTS = 50;
/** How far ahead of the hub's clock an `observedAt` may be (a client clock that runs fast). */
export declare const CLIENT_SEND_ATTRIBUTION_MAX_AHEAD_MS: number;
/** How old an `observedAt` may be: a report owed longer than that is not taken. */
export declare const CLIENT_SEND_ATTRIBUTION_MAX_AGE_DAYS = 30;
/** RFC 3339 with a zone, as `Date.prototype.toISOString` writes it. */
export declare const CLIENT_SEND_ATTRIBUTION_TIMESTAMP_PATTERN: RegExp;
export type ClientSendAttributionSource = (typeof CLIENT_SEND_ATTRIBUTION_SOURCES)[number];
export type ClientSendAttributionComposedWith = (typeof CLIENT_SEND_ATTRIBUTION_COMPOSED_WITH)[number];
export type ClientSendAttributionOutcome = (typeof CLIENT_SEND_ATTRIBUTION_OUTCOMES)[number];
export declare const clientSendAttributionFactSchema: z.ZodObject<{
    platformMessageId: z.ZodString;
    fanRef: z.ZodString;
    conversationRef: z.ZodOptional<z.ZodString>;
    observedAt: z.ZodString;
    priced: z.ZodBoolean;
    withMedia: z.ZodBoolean;
    composedWith: z.ZodOptional<z.ZodString>;
    edited: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
export declare const clientSendAttributionsBodySchema: z.ZodObject<{
    source: z.ZodString;
    facts: z.ZodArray<z.ZodObject<{
        platformMessageId: z.ZodString;
        fanRef: z.ZodString;
        conversationRef: z.ZodOptional<z.ZodString>;
        observedAt: z.ZodString;
        priced: z.ZodBoolean;
        withMedia: z.ZodBoolean;
        composedWith: z.ZodOptional<z.ZodString>;
        edited: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const clientSendAttributionsResponseSchema: z.ZodObject<{
    pageLabel: z.ZodString;
    results: z.ZodArray<z.ZodObject<{
        platformMessageId: z.ZodString;
        outcome: z.ZodString;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
/** How often the extension beats while a tab of a granted page is open. */
export declare const CLIENT_ACTIVITY_BEAT_SECONDS = 60;
/** Pages one beat may name. */
export declare const CLIENT_ACTIVITY_MAX_PAGES = 20;
/** The longest idle a beat may report: older activity is not news. */
export declare const CLIENT_ACTIVITY_MAX_IDLE_MS: number;
/** An install silent this long is gone: its shift ended at its last beat. */
export declare const CLIENT_ACTIVITY_LOST_MINUTES = 3;
/** Idle minutes that still count as work; from this one on it is a pause. */
export declare const CHATTER_SHIFT_IDLE_PAUSE_MINUTES = 10;
/** Idle minutes that end a shift, the extension open or not. */
export declare const CHATTER_SHIFT_END_IDLE_MINUTES = 60;
/** The longest window `teamShifts` reads. */
export declare const CHATTER_SHIFTS_MAX_WINDOW_DAYS = 7;
export declare const clientActivityBodySchema: z.ZodObject<{
    instanceId: z.ZodString;
    pages: z.ZodArray<z.ZodObject<{
        pageLabel: z.ZodString;
        idleMs: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strict>>;
    closed: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
export declare const clientActivityResponseSchema: z.ZodObject<{
    recorded: z.ZodNumber;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const teamShiftsQuerySchema: z.ZodObject<{
    from: z.ZodOptional<z.ZodString>;
    to: z.ZodOptional<z.ZodString>;
    pageLabel: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const teamShiftSchema: z.ZodObject<{
    userId: z.ZodNumber;
    username: z.ZodString;
    startedAt: z.ZodString;
    endedAt: z.ZodString;
    ongoing: z.ZodBoolean;
    workedMinutes: z.ZodNumber;
    pauses: z.ZodArray<z.ZodObject<{
        from: z.ZodString;
        to: z.ZodString;
    }, z.core.$strip>>;
    pages: z.ZodArray<z.ZodObject<{
        pageLabel: z.ZodString;
        activeMinutes: z.ZodNumber;
    }, z.core.$strip>>;
    authoredMessages: z.ZodNumber;
}, z.core.$strip>;
export declare const teamShiftsResponseSchema: z.ZodObject<{
    from: z.ZodString;
    to: z.ZodString;
    shifts: z.ZodArray<z.ZodObject<{
        userId: z.ZodNumber;
        username: z.ZodString;
        startedAt: z.ZodString;
        endedAt: z.ZodString;
        ongoing: z.ZodBoolean;
        workedMinutes: z.ZodNumber;
        pauses: z.ZodArray<z.ZodObject<{
            from: z.ZodString;
            to: z.ZodString;
        }, z.core.$strip>>;
        pages: z.ZodArray<z.ZodObject<{
            pageLabel: z.ZodString;
            activeMinutes: z.ZodNumber;
        }, z.core.$strip>>;
        authoredMessages: z.ZodNumber;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
/** How long a message keeps its author «в разговоре» with the fan. */
export declare const IN_CONVERSATION_MINUTES = 15;
export declare const clientInConversationResponseSchema: z.ZodObject<{
    pageLabel: z.ZodString;
    fans: z.ZodArray<z.ZodObject<{
        fanRef: z.ZodString;
        conversationRef: z.ZodNullable<z.ZodString>;
        chatters: z.ZodArray<z.ZodObject<{
            userId: z.ZodNumber;
            name: z.ZodString;
            isMe: z.ZodBoolean;
            lastSentAt: z.ZodString;
            until: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
/** One text (with its price and files) sent to this many chats of a page within an hour is a mass message. */
export declare const MASS_SEND_MIN_CHATS = 5;
export declare const teamAuthorshipQuerySchema: z.ZodObject<{
    days: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export declare const teamAuthorshipResponseSchema: z.ZodObject<{
    from: z.ZodString;
    to: z.ZodString;
    pages: z.ZodArray<z.ZodObject<{
        pageLabel: z.ZodString;
        platform: z.ZodString;
        total: z.ZodObject<{
            personal: z.ZodNumber;
            authored: z.ZodNumber;
            inShift: z.ZodNumber;
            inShiftAuthored: z.ZodNumber;
        }, z.core.$strip>;
        days: z.ZodArray<z.ZodObject<{
            personal: z.ZodNumber;
            authored: z.ZodNumber;
            inShift: z.ZodNumber;
            inShiftAuthored: z.ZodNumber;
            day: z.ZodString;
        }, z.core.$strip>>;
        authors: z.ZodArray<z.ZodObject<{
            userId: z.ZodNumber;
            username: z.ZodString;
            messages: z.ZodNumber;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
/** The longest window of the coverage analytics, Moscow days. */
export declare const TEAM_COVERAGE_MAX_DAYS = 31;
export declare const teamCoverageQuerySchema: z.ZodObject<{
    days: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export declare const teamEmptyHoursResponseSchema: z.ZodObject<{
    from: z.ZodString;
    to: z.ZodString;
    pages: z.ZodArray<z.ZodObject<{
        pageLabel: z.ZodString;
        platform: z.ZodString;
        shiftsSince: z.ZodNullable<z.ZodString>;
        hoursWithFans: z.ZodNumber;
        emptyHours: z.ZodNumber;
        emptyByHour: z.ZodArray<z.ZodNumber>;
        fans: z.ZodNumber;
        payers: z.ZodNumber;
        waitedOverHour: z.ZodNumber;
        waitedNetMills: z.ZodNumber;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
/** The longest broadcast list of `teamGreetings`. */
export declare const TEAM_BROADCASTS_MAX = 100;
export declare const teamGreetingsResponseSchema: z.ZodObject<{
    from: z.ZodString;
    to: z.ZodString;
    pages: z.ZodArray<z.ZodObject<{
        pageLabel: z.ZodString;
        platform: z.ZodString;
        newSubscribers: z.ZodNumber;
        autoWelcomed: z.ZodNumber;
        greeted: z.ZodNumber;
        greetingMedianSeconds: z.ZodNullable<z.ZodNumber>;
        repliedWithinHour: z.ZodNumber;
        boughtGreeted: z.ZodNumber;
        boughtNotGreeted: z.ZodNumber;
        recent: z.ZodNumber;
        broadcasts: z.ZodObject<{
            deliveries: z.ZodNumber;
            replied: z.ZodNumber;
            bought: z.ZodNumber;
            sent: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>>;
    broadcasts: z.ZodArray<z.ZodObject<{
        deliveries: z.ZodNumber;
        replied: z.ZodNumber;
        bought: z.ZodNumber;
        pageLabel: z.ZodString;
        sentAt: z.ZodString;
        preview: z.ZodString;
        priceMills: z.ZodNullable<z.ZodNumber>;
        files: z.ZodNumber;
        massMessage: z.ZodBoolean;
        ppvBought: z.ZodNumber;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
/** «Same person» suggestions in one card. */
export declare const CLIENT_FAN_CARD_MAX_SUGGESTIONS = 5;
/** Why Hub suggests a pair; open on the wire. */
export declare const CLIENT_FAN_LINK_REASONS: readonly ["same_alias", "same_username", "replaced_account"];
export declare const CLIENT_FAN_LINK_DECISIONS: readonly ["same", "different"];
export declare const clientFanCardPageSchema: z.ZodObject<{
    pageLabel: z.ZodString;
    platform: z.ZodString;
    modelName: z.ZodNullable<z.ZodString>;
    fanRef: z.ZodString;
    granted: z.ZodBoolean;
    alias: z.ZodNullable<z.ZodString>;
    subscribed: z.ZodBoolean;
    subscribedSince: z.ZodNullable<z.ZodString>;
    subscriptionEndsAt: z.ZodNullable<z.ZodString>;
    spentMills: z.ZodNumber;
    last30Mills: z.ZodRecord<z.ZodString, z.ZodNumber>;
    lastPurchaseAt: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/** The kinds of a fact from the chat; open on the wire. */
export declare const CLIENT_FAN_FACT_KINDS: readonly ["about", "promise", "agreement"];
/** The longest fact a chatter may write. */
export declare const CLIENT_FAN_FACT_MAX_CHARS = 500;
/** The longest quote of a fact's message in the card; longer text is cut with «…». */
export declare const CLIENT_FAN_FACT_QUOTE_MAX_CHARS = 280;
/** The archived message a fact comes from, as the chatter checks it. */
export declare const clientFanFactQuoteSchema: z.ZodObject<{
    text: z.ZodString;
    from: z.ZodString;
    at: z.ZodString;
    media: z.ZodBoolean;
}, z.core.$strip>;
export declare const clientFanFactSchema: z.ZodObject<{
    id: z.ZodNumber;
    kind: z.ZodString;
    text: z.ZodString;
    pageLabel: z.ZodString;
    granted: z.ZodBoolean;
    conversationRef: z.ZodString;
    messageRef: z.ZodString;
    messageAt: z.ZodNullable<z.ZodString>;
    source: z.ZodString;
    author: z.ZodNullable<z.ZodString>;
    createdAt: z.ZodString;
    quote: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        text: z.ZodString;
        from: z.ZodString;
        at: z.ZodString;
        media: z.ZodBoolean;
    }, z.core.$strip>>>;
}, z.core.$strip>;
/** Chat Memory week 4: the states of a custom; open on the wire. */
export declare const CLIENT_FAN_CUSTOM_STATES: readonly ["ordered", "paid", "delivered", "cancelled"];
export declare const clientFanCustomSchema: z.ZodObject<{
    id: z.ZodNumber;
    pageLabel: z.ZodString;
    granted: z.ZodBoolean;
    description: z.ZodString;
    priceMills: z.ZodNullable<z.ZodNumber>;
    state: z.ZodString;
    paymentMills: z.ZodNullable<z.ZodNumber>;
    paidAt: z.ZodNullable<z.ZodString>;
    deliveredMessageRef: z.ZodNullable<z.ZodString>;
    deliveredAt: z.ZodNullable<z.ZodString>;
    createdBy: z.ZodString;
    createdAt: z.ZodString;
    deliveryCandidates: z.ZodArray<z.ZodObject<{
        messageRef: z.ZodString;
        at: z.ZodString;
        mediaCount: z.ZodNumber;
        priceMills: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const clientFanCardResponseSchema: z.ZodObject<{
    pageLabel: z.ZodString;
    fanRef: z.ZodString;
    known: z.ZodBoolean;
    accounts: z.ZodArray<z.ZodObject<{
        platform: z.ZodString;
        fanRef: z.ZodString;
        username: z.ZodNullable<z.ZodString>;
        displayName: z.ZodNullable<z.ZodString>;
        gone: z.ZodBoolean;
        linkedBy: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    pages: z.ZodArray<z.ZodObject<{
        pageLabel: z.ZodString;
        platform: z.ZodString;
        modelName: z.ZodNullable<z.ZodString>;
        fanRef: z.ZodString;
        granted: z.ZodBoolean;
        alias: z.ZodNullable<z.ZodString>;
        subscribed: z.ZodBoolean;
        subscribedSince: z.ZodNullable<z.ZodString>;
        subscriptionEndsAt: z.ZodNullable<z.ZodString>;
        spentMills: z.ZodNumber;
        last30Mills: z.ZodRecord<z.ZodString, z.ZodNumber>;
        lastPurchaseAt: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    suggestions: z.ZodArray<z.ZodObject<{
        platform: z.ZodString;
        fanRef: z.ZodString;
        username: z.ZodNullable<z.ZodString>;
        displayName: z.ZodNullable<z.ZodString>;
        gone: z.ZodBoolean;
        reason: z.ZodString;
        shared: z.ZodString;
        sharedOn: z.ZodNullable<z.ZodString>;
        pages: z.ZodArray<z.ZodObject<{
            pageLabel: z.ZodString;
            platform: z.ZodString;
            modelName: z.ZodNullable<z.ZodString>;
            fanRef: z.ZodString;
            granted: z.ZodBoolean;
            alias: z.ZodNullable<z.ZodString>;
            subscribed: z.ZodBoolean;
            subscribedSince: z.ZodNullable<z.ZodString>;
            subscriptionEndsAt: z.ZodNullable<z.ZodString>;
            spentMills: z.ZodNumber;
            last30Mills: z.ZodRecord<z.ZodString, z.ZodNumber>;
            lastPurchaseAt: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    facts: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        kind: z.ZodString;
        text: z.ZodString;
        pageLabel: z.ZodString;
        granted: z.ZodBoolean;
        conversationRef: z.ZodString;
        messageRef: z.ZodString;
        messageAt: z.ZodNullable<z.ZodString>;
        source: z.ZodString;
        author: z.ZodNullable<z.ZodString>;
        createdAt: z.ZodString;
        quote: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            text: z.ZodString;
            from: z.ZodString;
            at: z.ZodString;
            media: z.ZodBoolean;
        }, z.core.$strip>>>;
    }, z.core.$strip>>;
    customs: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        pageLabel: z.ZodString;
        granted: z.ZodBoolean;
        description: z.ZodString;
        priceMills: z.ZodNullable<z.ZodNumber>;
        state: z.ZodString;
        paymentMills: z.ZodNullable<z.ZodNumber>;
        paidAt: z.ZodNullable<z.ZodString>;
        deliveredMessageRef: z.ZodNullable<z.ZodString>;
        deliveredAt: z.ZodNullable<z.ZodString>;
        createdBy: z.ZodString;
        createdAt: z.ZodString;
        deliveryCandidates: z.ZodArray<z.ZodObject<{
            messageRef: z.ZodString;
            at: z.ZodString;
            mediaCount: z.ZodNumber;
            priceMills: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    customPayments: z.ZodArray<z.ZodObject<{
        paymentRef: z.ZodString;
        amountMills: z.ZodNumber;
        at: z.ZodString;
        note: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const clientFanFactChangeBodySchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    action: z.ZodLiteral<"delete">;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"correct">;
    text: z.ZodString;
}, z.core.$strict>], "action">;
export declare const clientFanFactChangeParamsSchema: z.ZodObject<{
    pageLabel: z.ZodString;
    fanRef: z.ZodString;
    factId: z.ZodCoercedNumber<unknown>;
}, z.core.$strip>;
export declare const clientFanCustomCreateBodySchema: z.ZodObject<{
    description: z.ZodString;
    priceMills: z.ZodOptional<z.ZodNumber>;
    paymentRef: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const clientFanCustomChangeBodySchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    action: z.ZodLiteral<"paid">;
    paymentRef: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"delivered">;
    messageRef: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"cancel">;
}, z.core.$strict>, z.ZodObject<{
    action: z.ZodLiteral<"edit">;
    description: z.ZodString;
    priceMills: z.ZodNullable<z.ZodNumber>;
}, z.core.$strict>], "action">;
export declare const clientFanCustomParamsSchema: z.ZodObject<{
    pageLabel: z.ZodString;
    fanRef: z.ZodString;
    customId: z.ZodCoercedNumber<unknown>;
}, z.core.$strip>;
export declare const clientFanFactChangeResponseSchema: z.ZodObject<{
    changed: z.ZodBoolean;
    card: z.ZodObject<{
        pageLabel: z.ZodString;
        fanRef: z.ZodString;
        known: z.ZodBoolean;
        accounts: z.ZodArray<z.ZodObject<{
            platform: z.ZodString;
            fanRef: z.ZodString;
            username: z.ZodNullable<z.ZodString>;
            displayName: z.ZodNullable<z.ZodString>;
            gone: z.ZodBoolean;
            linkedBy: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        pages: z.ZodArray<z.ZodObject<{
            pageLabel: z.ZodString;
            platform: z.ZodString;
            modelName: z.ZodNullable<z.ZodString>;
            fanRef: z.ZodString;
            granted: z.ZodBoolean;
            alias: z.ZodNullable<z.ZodString>;
            subscribed: z.ZodBoolean;
            subscribedSince: z.ZodNullable<z.ZodString>;
            subscriptionEndsAt: z.ZodNullable<z.ZodString>;
            spentMills: z.ZodNumber;
            last30Mills: z.ZodRecord<z.ZodString, z.ZodNumber>;
            lastPurchaseAt: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        suggestions: z.ZodArray<z.ZodObject<{
            platform: z.ZodString;
            fanRef: z.ZodString;
            username: z.ZodNullable<z.ZodString>;
            displayName: z.ZodNullable<z.ZodString>;
            gone: z.ZodBoolean;
            reason: z.ZodString;
            shared: z.ZodString;
            sharedOn: z.ZodNullable<z.ZodString>;
            pages: z.ZodArray<z.ZodObject<{
                pageLabel: z.ZodString;
                platform: z.ZodString;
                modelName: z.ZodNullable<z.ZodString>;
                fanRef: z.ZodString;
                granted: z.ZodBoolean;
                alias: z.ZodNullable<z.ZodString>;
                subscribed: z.ZodBoolean;
                subscribedSince: z.ZodNullable<z.ZodString>;
                subscriptionEndsAt: z.ZodNullable<z.ZodString>;
                spentMills: z.ZodNumber;
                last30Mills: z.ZodRecord<z.ZodString, z.ZodNumber>;
                lastPurchaseAt: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        facts: z.ZodArray<z.ZodObject<{
            id: z.ZodNumber;
            kind: z.ZodString;
            text: z.ZodString;
            pageLabel: z.ZodString;
            granted: z.ZodBoolean;
            conversationRef: z.ZodString;
            messageRef: z.ZodString;
            messageAt: z.ZodNullable<z.ZodString>;
            source: z.ZodString;
            author: z.ZodNullable<z.ZodString>;
            createdAt: z.ZodString;
            quote: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                text: z.ZodString;
                from: z.ZodString;
                at: z.ZodString;
                media: z.ZodBoolean;
            }, z.core.$strip>>>;
        }, z.core.$strip>>;
        customs: z.ZodArray<z.ZodObject<{
            id: z.ZodNumber;
            pageLabel: z.ZodString;
            granted: z.ZodBoolean;
            description: z.ZodString;
            priceMills: z.ZodNullable<z.ZodNumber>;
            state: z.ZodString;
            paymentMills: z.ZodNullable<z.ZodNumber>;
            paidAt: z.ZodNullable<z.ZodString>;
            deliveredMessageRef: z.ZodNullable<z.ZodString>;
            deliveredAt: z.ZodNullable<z.ZodString>;
            createdBy: z.ZodString;
            createdAt: z.ZodString;
            deliveryCandidates: z.ZodArray<z.ZodObject<{
                messageRef: z.ZodString;
                at: z.ZodString;
                mediaCount: z.ZodNumber;
                priceMills: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        customPayments: z.ZodArray<z.ZodObject<{
            paymentRef: z.ZodString;
            amountMills: z.ZodNumber;
            at: z.ZodString;
            note: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        serverNow: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const clientFanLinkDecideBodySchema: z.ZodObject<{
    otherPlatform: z.ZodString;
    otherFanRef: z.ZodString;
    decision: z.ZodEnum<{
        same: "same";
        different: "different";
    }>;
}, z.core.$strict>;
export declare const clientFanLinkDecideResponseSchema: z.ZodObject<{
    decision: z.ZodEnum<{
        same: "same";
        different: "different";
    }>;
    recorded: z.ZodBoolean;
    card: z.ZodObject<{
        pageLabel: z.ZodString;
        fanRef: z.ZodString;
        known: z.ZodBoolean;
        accounts: z.ZodArray<z.ZodObject<{
            platform: z.ZodString;
            fanRef: z.ZodString;
            username: z.ZodNullable<z.ZodString>;
            displayName: z.ZodNullable<z.ZodString>;
            gone: z.ZodBoolean;
            linkedBy: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        pages: z.ZodArray<z.ZodObject<{
            pageLabel: z.ZodString;
            platform: z.ZodString;
            modelName: z.ZodNullable<z.ZodString>;
            fanRef: z.ZodString;
            granted: z.ZodBoolean;
            alias: z.ZodNullable<z.ZodString>;
            subscribed: z.ZodBoolean;
            subscribedSince: z.ZodNullable<z.ZodString>;
            subscriptionEndsAt: z.ZodNullable<z.ZodString>;
            spentMills: z.ZodNumber;
            last30Mills: z.ZodRecord<z.ZodString, z.ZodNumber>;
            lastPurchaseAt: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        suggestions: z.ZodArray<z.ZodObject<{
            platform: z.ZodString;
            fanRef: z.ZodString;
            username: z.ZodNullable<z.ZodString>;
            displayName: z.ZodNullable<z.ZodString>;
            gone: z.ZodBoolean;
            reason: z.ZodString;
            shared: z.ZodString;
            sharedOn: z.ZodNullable<z.ZodString>;
            pages: z.ZodArray<z.ZodObject<{
                pageLabel: z.ZodString;
                platform: z.ZodString;
                modelName: z.ZodNullable<z.ZodString>;
                fanRef: z.ZodString;
                granted: z.ZodBoolean;
                alias: z.ZodNullable<z.ZodString>;
                subscribed: z.ZodBoolean;
                subscribedSince: z.ZodNullable<z.ZodString>;
                subscriptionEndsAt: z.ZodNullable<z.ZodString>;
                spentMills: z.ZodNumber;
                last30Mills: z.ZodRecord<z.ZodString, z.ZodNumber>;
                lastPurchaseAt: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        facts: z.ZodArray<z.ZodObject<{
            id: z.ZodNumber;
            kind: z.ZodString;
            text: z.ZodString;
            pageLabel: z.ZodString;
            granted: z.ZodBoolean;
            conversationRef: z.ZodString;
            messageRef: z.ZodString;
            messageAt: z.ZodNullable<z.ZodString>;
            source: z.ZodString;
            author: z.ZodNullable<z.ZodString>;
            createdAt: z.ZodString;
            quote: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                text: z.ZodString;
                from: z.ZodString;
                at: z.ZodString;
                media: z.ZodBoolean;
            }, z.core.$strip>>>;
        }, z.core.$strip>>;
        customs: z.ZodArray<z.ZodObject<{
            id: z.ZodNumber;
            pageLabel: z.ZodString;
            granted: z.ZodBoolean;
            description: z.ZodString;
            priceMills: z.ZodNullable<z.ZodNumber>;
            state: z.ZodString;
            paymentMills: z.ZodNullable<z.ZodNumber>;
            paidAt: z.ZodNullable<z.ZodString>;
            deliveredMessageRef: z.ZodNullable<z.ZodString>;
            deliveredAt: z.ZodNullable<z.ZodString>;
            createdBy: z.ZodString;
            createdAt: z.ZodString;
            deliveryCandidates: z.ZodArray<z.ZodObject<{
                messageRef: z.ZodString;
                at: z.ZodString;
                mediaCount: z.ZodNumber;
                priceMills: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        customPayments: z.ZodArray<z.ZodObject<{
            paymentRef: z.ZodString;
            amountMills: z.ZodNumber;
            at: z.ZodString;
            note: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        serverNow: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const CLIENT_WIN_BACK_REASONS: readonly ["expiring", "new_unattended", "silent"];
/** Fans one read lists: a few per shift, never crowding out the ones who wait. */
export declare const CLIENT_WIN_BACK_MAX_ITEMS = 10;
export declare const clientWinBackApproachSchema: z.ZodObject<{
    id: z.ZodNumber;
    label: z.ZodString;
}, z.core.$strip>;
export declare const clientWinBackResponseSchema: z.ZodObject<{
    pageLabel: z.ZodString;
    approaches: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        label: z.ZodString;
    }, z.core.$strip>>;
    items: z.ZodArray<z.ZodObject<{
        fanRef: z.ZodString;
        conversationRef: z.ZodNullable<z.ZodString>;
        username: z.ZodNullable<z.ZodString>;
        displayName: z.ZodNullable<z.ZodString>;
        alias: z.ZodNullable<z.ZodString>;
        lifetimeGrossMills: z.ZodNumber;
        reason: z.ZodString;
        reasonAt: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const clientWinBackAttemptBodySchema: z.ZodObject<{
    fanRef: z.ZodString;
    approachId: z.ZodNumber;
}, z.core.$strict>;
export declare const clientWinBackAttemptResponseSchema: z.ZodObject<{
    attemptId: z.ZodNumber;
    list: z.ZodObject<{
        pageLabel: z.ZodString;
        approaches: z.ZodArray<z.ZodObject<{
            id: z.ZodNumber;
            label: z.ZodString;
        }, z.core.$strip>>;
        items: z.ZodArray<z.ZodObject<{
            fanRef: z.ZodString;
            conversationRef: z.ZodNullable<z.ZodString>;
            username: z.ZodNullable<z.ZodString>;
            displayName: z.ZodNullable<z.ZodString>;
            alias: z.ZodNullable<z.ZodString>;
            lifetimeGrossMills: z.ZodNumber;
            reason: z.ZodString;
            reasonAt: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        serverNow: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const teamWinBackResultsQuerySchema: z.ZodObject<{
    days: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export declare const teamWinBackResultsResponseSchema: z.ZodObject<{
    from: z.ZodString;
    to: z.ZodString;
    rows: z.ZodArray<z.ZodObject<{
        approachId: z.ZodNumber;
        approach: z.ZodString;
        userId: z.ZodNumber;
        username: z.ZodString;
        attempts: z.ZodNumber;
        sent: z.ZodNumber;
        matured72h: z.ZodNumber;
        replied72h: z.ZodNumber;
        matured7d: z.ZodNumber;
        bought7d: z.ZodNumber;
        matured30d: z.ZodNumber;
        spent30dMills: z.ZodNumber;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const teamWinBackApproachesResponseSchema: z.ZodObject<{
    approaches: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        label: z.ZodString;
        sortOrder: z.ZodNumber;
        active: z.ZodBoolean;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const teamWinBackApproachSaveBodySchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodNumber>;
    label: z.ZodString;
    sortOrder: z.ZodDefault<z.ZodNumber>;
    active: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strict>;
/** Why to write now, the most urgent first. Open on the wire. */
export declare const CLIENT_ONLINE_REASONS: readonly ["waiting", "new_unattended", "expiring", "silent", "quiet", "never_wrote", "none"];
/** With what: Reply, Hi, Ping, or a text of the team's guide (A — talked before, B — never wrote). Open on the wire. */
export declare const CLIENT_ONLINE_ACTS: readonly ["reply", "hi", "ping", "template_a", "template_b", "none"];
/** Why a fan is not offered now, though a chatter may still write. Open on the wire. */
export declare const CLIENT_ONLINE_ASIDES: readonly ["in_conversation", "wrote_recently", "attempted_recently", "dismissed", "unreachable"];
export declare const CLIENT_ONLINE_ATTEMPT_ACTIONS: readonly ["sent", "dismissed", "restored"];
/** What a sent message was written with. */
export declare const CLIENT_ONLINE_SENT_ACTS: readonly ["reply", "hi", "ping", "template"];
export declare const CLIENT_ONLINE_DEFAULT_MINUTES = 30;
export declare const CLIENT_ONLINE_MAX_MINUTES = 180;
/** Fans one read lists at most: the newest activity first. */
export declare const CLIENT_ONLINE_MAX_ITEMS = 200;
/** Fansly fans one presence report names at most (a `followersnew` page is 100). */
export declare const CLIENT_ONLINE_PRESENCE_MAX = 200;
export declare const clientOnlineQuerySchema: z.ZodObject<{
    minutes: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strict>;
export declare const clientOnlineItemSchema: z.ZodObject<{
    fanRef: z.ZodString;
    conversationRef: z.ZodNullable<z.ZodString>;
    username: z.ZodNullable<z.ZodString>;
    displayName: z.ZodNullable<z.ZodString>;
    alias: z.ZodNullable<z.ZodString>;
    greetingName: z.ZodNullable<z.ZodString>;
    lifetimeGrossMills: z.ZodNumber;
    last30dGrossMills: z.ZodNumber;
    seenAt: z.ZodNullable<z.ZodString>;
    onlineSince: z.ZodNullable<z.ZodString>;
    seenSource: z.ZodNullable<z.ZodString>;
    reason: z.ZodString;
    reasonAt: z.ZodNullable<z.ZodString>;
    act: z.ZodString;
    aside: z.ZodNullable<z.ZodString>;
    asideAt: z.ZodNullable<z.ZodString>;
    asideBy: z.ZodNullable<z.ZodString>;
    messageCount: z.ZodNumber;
    lastFanMessageAt: z.ZodNullable<z.ZodString>;
    lastPageMessageAt: z.ZodNullable<z.ZodString>;
    subscription: z.ZodObject<{
        isSubscriber: z.ZodBoolean;
        startedAt: z.ZodNullable<z.ZodString>;
        endsAt: z.ZodNullable<z.ZodString>;
        autoRenew: z.ZodNullable<z.ZodBoolean>;
    }, z.core.$strip>;
}, z.core.$strip>;
/** A text of the team's reactivation guide, word for word; `love` is the place of the fan's name. */
export declare const clientOnlineTemplateSchema: z.ZodObject<{
    id: z.ZodString;
    group: z.ZodString;
    text: z.ZodString;
}, z.core.$strip>;
export declare const clientOnlineResponseSchema: z.ZodObject<{
    pageLabel: z.ZodString;
    minutes: z.ZodNumber;
    items: z.ZodArray<z.ZodObject<{
        fanRef: z.ZodString;
        conversationRef: z.ZodNullable<z.ZodString>;
        username: z.ZodNullable<z.ZodString>;
        displayName: z.ZodNullable<z.ZodString>;
        alias: z.ZodNullable<z.ZodString>;
        greetingName: z.ZodNullable<z.ZodString>;
        lifetimeGrossMills: z.ZodNumber;
        last30dGrossMills: z.ZodNumber;
        seenAt: z.ZodNullable<z.ZodString>;
        onlineSince: z.ZodNullable<z.ZodString>;
        seenSource: z.ZodNullable<z.ZodString>;
        reason: z.ZodString;
        reasonAt: z.ZodNullable<z.ZodString>;
        act: z.ZodString;
        aside: z.ZodNullable<z.ZodString>;
        asideAt: z.ZodNullable<z.ZodString>;
        asideBy: z.ZodNullable<z.ZodString>;
        messageCount: z.ZodNumber;
        lastFanMessageAt: z.ZodNullable<z.ZodString>;
        lastPageMessageAt: z.ZodNullable<z.ZodString>;
        subscription: z.ZodObject<{
            isSubscriber: z.ZodBoolean;
            startedAt: z.ZodNullable<z.ZodString>;
            endsAt: z.ZodNullable<z.ZodString>;
            autoRenew: z.ZodNullable<z.ZodBoolean>;
        }, z.core.$strip>;
    }, z.core.$strip>>;
    templates: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        group: z.ZodString;
        text: z.ZodString;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const clientOnlinePresenceBodySchema: z.ZodObject<{
    seen: z.ZodArray<z.ZodObject<{
        fanRef: z.ZodString;
        lastSeenAt: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const clientOnlinePresenceResponseSchema: z.ZodObject<{
    recorded: z.ZodNumber;
    skipped: z.ZodNumber;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const clientOnlineAttemptBodySchema: z.ZodObject<{
    fanRef: z.ZodString;
    action: z.ZodEnum<{
        sent: "sent";
        dismissed: "dismissed";
        restored: "restored";
    }>;
    act: z.ZodOptional<z.ZodEnum<{
        ping: "ping";
        reply: "reply";
        hi: "hi";
        template: "template";
    }>>;
    templateId: z.ZodOptional<z.ZodString>;
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const clientOnlineAttemptResponseSchema: z.ZodObject<{
    attemptId: z.ZodNumber;
}, z.core.$strip>;
export declare const CLIENT_HANDOFF_HOURS = 12;
export declare const clientHandoffResponseSchema: z.ZodObject<{
    pageLabel: z.ZodString;
    recent: z.ZodArray<z.ZodObject<{
        fanRef: z.ZodString;
        conversationRef: z.ZodNullable<z.ZodString>;
        username: z.ZodNullable<z.ZodString>;
        alias: z.ZodNullable<z.ZodString>;
        lastSentAt: z.ZodString;
        messages: z.ZodNumber;
        chatters: z.ZodArray<z.ZodString>;
        inConversation: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>;
    waiting: z.ZodObject<{
        total: z.ZodNumber;
        head: z.ZodArray<z.ZodObject<{
            fanRef: z.ZodString;
            conversationRef: z.ZodNullable<z.ZodString>;
            username: z.ZodNullable<z.ZodString>;
            alias: z.ZodNullable<z.ZodString>;
            lifetimeGrossMills: z.ZodNumber;
            lastFanMessageAt: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    customs: z.ZodArray<z.ZodObject<{
        fanRef: z.ZodString;
        conversationRef: z.ZodNullable<z.ZodString>;
        description: z.ZodString;
        state: z.ZodString;
        paidAt: z.ZodNullable<z.ZodString>;
        createdAt: z.ZodString;
    }, z.core.$strip>>;
    promises: z.ZodArray<z.ZodObject<{
        fanRef: z.ZodString;
        conversationRef: z.ZodString;
        text: z.ZodString;
        messageRef: z.ZodString;
        messageAt: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const teamCustomsResponseSchema: z.ZodObject<{
    customs: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        pageLabel: z.ZodString;
        fanRef: z.ZodString;
        description: z.ZodString;
        priceMills: z.ZodNullable<z.ZodNumber>;
        state: z.ZodString;
        paidAt: z.ZodNullable<z.ZodString>;
        createdBy: z.ZodString;
        createdAt: z.ZodString;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
/** Chat Memory week 4: a chatter's mark on a sale of the draft shift report. */
export declare const SHIFT_REPORT_MARKS: readonly ["mine", "share", "not_mine"];
/** How far back the cabinet's shift report reaches. */
export declare const SHIFT_REPORT_MAX_DAYS = 14;
/** The longest owner's window (disputes, export). */
export declare const SHIFT_REPORT_EXPORT_MAX_DAYS = 31;
export declare const shiftReportSaleSchema: z.ZodObject<{
    saleRef: z.ZodString;
    pageLabel: z.ZodString;
    platform: z.ZodString;
    kind: z.ZodString;
    fanRef: z.ZodNullable<z.ZodString>;
    fanName: z.ZodNullable<z.ZodString>;
    netMills: z.ZodNumber;
    occurredAt: z.ZodString;
    ppvSender: z.ZodNullable<z.ZodString>;
    ppvWithoutAuthor: z.ZodBoolean;
    writers: z.ZodArray<z.ZodObject<{
        username: z.ZodString;
        messages: z.ZodNumber;
    }, z.core.$strip>>;
    withoutAuthor: z.ZodNumber;
    confirmed: z.ZodBoolean;
    myMark: z.ZodNullable<z.ZodObject<{
        mark: z.ZodString;
        shareWithUserId: z.ZodNullable<z.ZodNumber>;
        shareWith: z.ZodNullable<z.ZodString>;
        amountMills: z.ZodNullable<z.ZodNumber>;
        note: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    otherMarks: z.ZodArray<z.ZodObject<{
        username: z.ZodString;
        mark: z.ZodString;
        shareWith: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const accountShiftReportQuerySchema: z.ZodObject<{
    days: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export declare const accountShiftReportResponseSchema: z.ZodObject<{
    shifts: z.ZodArray<z.ZodObject<{
        startedAt: z.ZodString;
        endedAt: z.ZodString;
        ongoing: z.ZodBoolean;
        pages: z.ZodArray<z.ZodString>;
        sales: z.ZodArray<z.ZodObject<{
            saleRef: z.ZodString;
            pageLabel: z.ZodString;
            platform: z.ZodString;
            kind: z.ZodString;
            fanRef: z.ZodNullable<z.ZodString>;
            fanName: z.ZodNullable<z.ZodString>;
            netMills: z.ZodNumber;
            occurredAt: z.ZodString;
            ppvSender: z.ZodNullable<z.ZodString>;
            ppvWithoutAuthor: z.ZodBoolean;
            writers: z.ZodArray<z.ZodObject<{
                username: z.ZodString;
                messages: z.ZodNumber;
            }, z.core.$strip>>;
            withoutAuthor: z.ZodNumber;
            confirmed: z.ZodBoolean;
            myMark: z.ZodNullable<z.ZodObject<{
                mark: z.ZodString;
                shareWithUserId: z.ZodNullable<z.ZodNumber>;
                shareWith: z.ZodNullable<z.ZodString>;
                amountMills: z.ZodNullable<z.ZodNumber>;
                note: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
            otherMarks: z.ZodArray<z.ZodObject<{
                username: z.ZodString;
                mark: z.ZodString;
                shareWith: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        creditedMills: z.ZodNumber;
        unmarked: z.ZodNumber;
        pending: z.ZodNumber;
        confirmedAt: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    sharedWithMe: z.ZodArray<z.ZodObject<{
        saleRef: z.ZodString;
        pageLabel: z.ZodString;
        platform: z.ZodString;
        kind: z.ZodString;
        fanRef: z.ZodNullable<z.ZodString>;
        fanName: z.ZodNullable<z.ZodString>;
        netMills: z.ZodNumber;
        occurredAt: z.ZodString;
        ppvSender: z.ZodNullable<z.ZodString>;
        ppvWithoutAuthor: z.ZodBoolean;
        writers: z.ZodArray<z.ZodObject<{
            username: z.ZodString;
            messages: z.ZodNumber;
        }, z.core.$strip>>;
        withoutAuthor: z.ZodNumber;
        confirmed: z.ZodBoolean;
        myMark: z.ZodNullable<z.ZodObject<{
            mark: z.ZodString;
            shareWithUserId: z.ZodNullable<z.ZodNumber>;
            shareWith: z.ZodNullable<z.ZodString>;
            amountMills: z.ZodNullable<z.ZodNumber>;
            note: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        otherMarks: z.ZodArray<z.ZodObject<{
            username: z.ZodString;
            mark: z.ZodString;
            shareWith: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    teammates: z.ZodArray<z.ZodObject<{
        userId: z.ZodNumber;
        username: z.ZodString;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const accountShiftReportMarkBodySchema: z.ZodObject<{
    saleRef: z.ZodString;
    mark: z.ZodEnum<{
        mine: "mine";
        share: "share";
        not_mine: "not_mine";
    }>;
    shareWithUserId: z.ZodOptional<z.ZodNumber>;
    amountMills: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>;
export declare const accountShiftReportConfirmBodySchema: z.ZodObject<{
    startedAt: z.ZodString;
}, z.core.$strict>;
export declare const accountShiftReportChangeResponseSchema: z.ZodObject<{
    changed: z.ZodBoolean;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const teamShiftDisputesQuerySchema: z.ZodObject<{
    days: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export declare const teamShiftDisputesResponseSchema: z.ZodObject<{
    disputes: z.ZodArray<z.ZodObject<{
        saleRef: z.ZodString;
        pageLabel: z.ZodString;
        platform: z.ZodString;
        fanRef: z.ZodNullable<z.ZodString>;
        occurredAt: z.ZodString;
        netMills: z.ZodNumber;
        reason: z.ZodString;
        marks: z.ZodArray<z.ZodObject<{
            userId: z.ZodNumber;
            username: z.ZodString;
            mark: z.ZodString;
            shareWithUserId: z.ZodNullable<z.ZodNumber>;
            shareWith: z.ZodNullable<z.ZodString>;
            amountMills: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>>;
        people: z.ZodArray<z.ZodObject<{
            userId: z.ZodNumber;
            username: z.ZodString;
        }, z.core.$strip>>;
        resolution: z.ZodNullable<z.ZodArray<z.ZodObject<{
            userId: z.ZodNumber;
            username: z.ZodString;
            percent: z.ZodNumber;
        }, z.core.$strip>>>;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const teamShiftResolveParamsSchema: z.ZodObject<{
    saleRef: z.ZodString;
}, z.core.$strip>;
export declare const teamShiftResolveBodySchema: z.ZodObject<{
    shares: z.ZodArray<z.ZodObject<{
        userId: z.ZodNumber;
        percent: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strict>;
export declare const teamShiftExportQuerySchema: z.ZodObject<{
    from: z.ZodString;
    to: z.ZodString;
}, z.core.$strip>;
export declare const teamShiftExportResponseSchema: z.ZodObject<{
    from: z.ZodString;
    to: z.ZodString;
    rows: z.ZodArray<z.ZodObject<{
        username: z.ZodString;
        pageLabel: z.ZodString;
        platform: z.ZodString;
        shiftDate: z.ZodString;
        creditedMills: z.ZodNumber;
    }, z.core.$strip>>;
    disputedOpen: z.ZodNumber;
    ownAmounts: z.ZodArray<z.ZodObject<{
        username: z.ZodString;
        pageLabel: z.ZodString;
        saleRef: z.ZodString;
        occurredAt: z.ZodString;
        netMills: z.ZodNumber;
        amountMills: z.ZodNumber;
    }, z.core.$strip>>;
    unconfirmed: z.ZodArray<z.ZodObject<{
        username: z.ZodString;
        startedAt: z.ZodString;
        endedAt: z.ZodString;
        ongoing: z.ZodBoolean;
    }, z.core.$strip>>;
    lateChanges: z.ZodArray<z.ZodObject<{
        username: z.ZodString;
        pageLabel: z.ZodString;
        saleRef: z.ZodString;
        occurredAt: z.ZodString;
        payDay: z.ZodString;
        creditedMills: z.ZodNumber;
        change: z.ZodEnum<{
            added: "added";
            removed: "removed";
        }>;
        at: z.ZodString;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
/** Chat Memory week 5: the longest window of the chatter numbers. */
export declare const CHATTER_NUMBERS_MAX_DAYS = 31;
/** The eight numbers of a shift or a week (week-5.md §1); only messages with the chatter as their author count. */
export declare const chatterNumbersSchema: z.ZodObject<{
    workedMinutes: z.ZodNumber;
    revenueMills: z.ZodNullable<z.ZodNumber>;
    revenuePerHourMills: z.ZodNullable<z.ZodNumber>;
    fansWritten: z.ZodNumber;
    fansPaid: z.ZodNumber;
    messages: z.ZodNumber;
    ppvSent: z.ZodNumber;
    ppvBought: z.ZodNumber;
    ppvAveragePriceMills: z.ZodNullable<z.ZodNumber>;
    ppvShare: z.ZodNullable<z.ZodNumber>;
    replies: z.ZodNumber;
    replyMedianSeconds: z.ZodNullable<z.ZodNumber>;
    repliesWithinHour: z.ZodNumber;
    waitingAtEnd: z.ZodNumber;
    composed: z.ZodObject<{
        hand: z.ZodNumber;
        reply: z.ZodNumber;
        fix: z.ZodNumber;
        other: z.ZodNumber;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const teamChatterNumbersQuerySchema: z.ZodObject<{
    from: z.ZodOptional<z.ZodString>;
    to: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const teamChatterNumbersResponseSchema: z.ZodObject<{
    from: z.ZodString;
    to: z.ZodString;
    chatters: z.ZodArray<z.ZodObject<{
        userId: z.ZodNumber;
        username: z.ZodString;
        week: z.ZodObject<{
            workedMinutes: z.ZodNumber;
            revenueMills: z.ZodNullable<z.ZodNumber>;
            revenuePerHourMills: z.ZodNullable<z.ZodNumber>;
            fansWritten: z.ZodNumber;
            fansPaid: z.ZodNumber;
            messages: z.ZodNumber;
            ppvSent: z.ZodNumber;
            ppvBought: z.ZodNumber;
            ppvAveragePriceMills: z.ZodNullable<z.ZodNumber>;
            ppvShare: z.ZodNullable<z.ZodNumber>;
            replies: z.ZodNumber;
            replyMedianSeconds: z.ZodNullable<z.ZodNumber>;
            repliesWithinHour: z.ZodNumber;
            waitingAtEnd: z.ZodNumber;
            composed: z.ZodObject<{
                hand: z.ZodNumber;
                reply: z.ZodNumber;
                fix: z.ZodNumber;
                other: z.ZodNumber;
            }, z.core.$strip>;
            shifts: z.ZodNumber;
            unconfirmedShifts: z.ZodNumber;
        }, z.core.$strip>;
        shifts: z.ZodArray<z.ZodObject<{
            startedAt: z.ZodString;
            endedAt: z.ZodString;
            ongoing: z.ZodBoolean;
            pages: z.ZodArray<z.ZodString>;
            confirmed: z.ZodBoolean;
            numbers: z.ZodObject<{
                workedMinutes: z.ZodNumber;
                revenueMills: z.ZodNullable<z.ZodNumber>;
                revenuePerHourMills: z.ZodNullable<z.ZodNumber>;
                fansWritten: z.ZodNumber;
                fansPaid: z.ZodNumber;
                messages: z.ZodNumber;
                ppvSent: z.ZodNumber;
                ppvBought: z.ZodNumber;
                ppvAveragePriceMills: z.ZodNullable<z.ZodNumber>;
                ppvShare: z.ZodNullable<z.ZodNumber>;
                replies: z.ZodNumber;
                replyMedianSeconds: z.ZodNullable<z.ZodNumber>;
                repliesWithinHour: z.ZodNumber;
                waitingAtEnd: z.ZodNumber;
                composed: z.ZodObject<{
                    hand: z.ZodNumber;
                    reply: z.ZodNumber;
                    fix: z.ZodNumber;
                    other: z.ZodNumber;
                }, z.core.$strip>;
            }, z.core.$strip>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
/** The longest window of the sales analytics, days. */
export declare const TEAM_SALES_MAX_DAYS = 31;
/** Price buckets of a PPV: up to and including `upToMills`; the last one has no upper bound. */
export declare const PPV_PRICE_BUCKETS: readonly [{
    readonly key: "upTo10";
    readonly upToMills: 10000;
}, {
    readonly key: "10to25";
    readonly upToMills: 25000;
}, {
    readonly key: "25to50";
    readonly upToMills: 50000;
}, {
    readonly key: "50to100";
    readonly upToMills: 100000;
}, {
    readonly key: "over100";
    readonly upToMills: null;
}];
export declare const teamSalesQuerySchema: z.ZodObject<{
    days: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export declare const teamSalesPpvResponseSchema: z.ZodObject<{
    from: z.ZodString;
    to: z.ZodString;
    pages: z.ZodArray<z.ZodObject<{
        pageLabel: z.ZodString;
        platform: z.ZodString;
        total: z.ZodObject<{
            sent: z.ZodNumber;
            bought: z.ZodNumber;
            netMills: z.ZodNumber;
        }, z.core.$strip>;
        byPrice: z.ZodArray<z.ZodObject<{
            sent: z.ZodNumber;
            bought: z.ZodNumber;
            netMills: z.ZodNumber;
            bucket: z.ZodString;
        }, z.core.$strip>>;
        firstPpv: z.ZodArray<z.ZodObject<{
            sent: z.ZodNumber;
            bought: z.ZodNumber;
            netMills: z.ZodNumber;
            bucket: z.ZodString;
        }, z.core.$strip>>;
        withoutAuthor: z.ZodNumber;
    }, z.core.$strip>>;
    chatters: z.ZodArray<z.ZodObject<{
        userId: z.ZodNumber;
        username: z.ZodString;
        total: z.ZodObject<{
            sent: z.ZodNumber;
            bought: z.ZodNumber;
            netMills: z.ZodNumber;
        }, z.core.$strip>;
        byPrice: z.ZodArray<z.ZodObject<{
            sent: z.ZodNumber;
            bought: z.ZodNumber;
            netMills: z.ZodNumber;
            bucket: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
/** Delay buckets of a reply: below `underSeconds`; the last one has no upper bound. */
export declare const REPLY_DELAY_BUCKETS: readonly [{
    readonly key: "under5m";
    readonly underSeconds: 300;
}, {
    readonly key: "5to15m";
    readonly underSeconds: 900;
}, {
    readonly key: "15to60m";
    readonly underSeconds: 3600;
}, {
    readonly key: "1to6h";
    readonly underSeconds: 21600;
}, {
    readonly key: "over6h";
    readonly underSeconds: null;
}];
export declare const teamSalesRepliesResponseSchema: z.ZodObject<{
    from: z.ZodString;
    to: z.ZodString;
    pages: z.ZodArray<z.ZodObject<{
        pageLabel: z.ZodString;
        platform: z.ZodString;
        total: z.ZodObject<{
            replies: z.ZodNumber;
            bought: z.ZodNumber;
        }, z.core.$strip>;
        byDelay: z.ZodArray<z.ZodObject<{
            replies: z.ZodNumber;
            bought: z.ZodNumber;
            bucket: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    chatters: z.ZodArray<z.ZodObject<{
        userId: z.ZodNumber;
        username: z.ZodString;
        total: z.ZodObject<{
            replies: z.ZodNumber;
            bought: z.ZodNumber;
        }, z.core.$strip>;
        byDelay: z.ZodArray<z.ZodObject<{
            replies: z.ZodNumber;
            bought: z.ZodNumber;
            bucket: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export declare const clientRouteSchemas: {
    readonly clientBootstrap: {
        readonly auth: {
            readonly kind: "apiKey";
        };
        readonly tags: readonly ["client"];
        readonly summary: "Chat-extension bootstrap: who the caller is, their pages, switches, limits and the hub's capabilities";
        readonly description: string;
        readonly response: {
            readonly 200: z.ZodObject<{
                protocol: z.ZodNumber;
                issuedAt: z.ZodString;
                ttlSec: z.ZodNumber;
                configRevision: z.ZodNumber;
                minVersion: z.ZodString;
                identity: z.ZodObject<{
                    userId: z.ZodNumber;
                    username: z.ZodString;
                    role: z.ZodString;
                    tokenClient: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>;
                pages: z.ZodArray<z.ZodObject<{
                    pageId: z.ZodNumber;
                    pageLabel: z.ZodString;
                    title: z.ZodString;
                    platform: z.ZodString;
                    platformAccountId: z.ZodNullable<z.ZodString>;
                    bindingRevision: z.ZodNumber;
                    features: z.ZodRecord<z.ZodString, z.ZodObject<{
                        available: z.ZodBoolean;
                        reason: z.ZodOptional<z.ZodString>;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                bindingsByHost: z.ZodRecord<z.ZodString, z.ZodNumber>;
                flags: z.ZodRecord<z.ZodString, z.ZodBoolean>;
                limits: z.ZodObject<{
                    freshTextMaxItems: z.ZodNumber;
                    freshTextMaxChars: z.ZodNumber;
                    feedMax: z.ZodNumber;
                    deepMax: z.ZodNumber;
                    audienceWindowHours: z.ZodNumber;
                    claimLeaseSec: z.ZodNumber;
                    claimRenewSec: z.ZodNumber;
                    claimActivityWindowSec: z.ZodNumber;
                    previewSendPerMinute: z.ZodNumber;
                    greetingSendPerMinute: z.ZodOptional<z.ZodNumber>;
                    navInsertTimeoutSec: z.ZodNumber;
                    dispatchTicketSec: z.ZodNumber;
                    previewSendReceiptProfiles: z.ZodArray<z.ZodObject<{
                        id: z.ZodString;
                        adapterVersion: z.ZodString;
                        modules: z.ZodRecord<z.ZodString, z.ZodString>;
                    }, z.core.$strip>>;
                }, z.core.$strip>;
                capabilities: z.ZodArray<z.ZodString>;
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
    readonly clientConversationRecaps: {
        readonly auth: {
            readonly kind: "apiKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["client"];
        readonly summary: "The shared full and short recap of one fan on one page, with their text";
        readonly description: string;
        readonly params: z.ZodObject<{
            pageLabel: z.ZodString;
            fanRef: z.ZodString;
        }, z.core.$strip>;
        readonly querystring: z.ZodObject<{
            personaDefinitionId: z.ZodOptional<z.ZodString>;
            conversationRef: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodObject<{
                full: z.ZodNullable<z.ZodObject<{
                    generationRef: z.ZodString;
                    generatedAt: z.ZodString;
                    personaDefinitionId: z.ZodNullable<z.ZodString>;
                    coverage: z.ZodObject<{
                        transcriptCoverage: z.ZodNullable<z.ZodString>;
                        requestedCount: z.ZodNullable<z.ZodNumber>;
                        keptCount: z.ZodNullable<z.ZodNumber>;
                    }, z.core.$strip>;
                    text: z.ZodString;
                }, z.core.$strip>>;
                short: z.ZodNullable<z.ZodObject<{
                    generationRef: z.ZodString;
                    generatedAt: z.ZodString;
                    personaDefinitionId: z.ZodNullable<z.ZodString>;
                    coverage: z.ZodObject<{
                        transcriptCoverage: z.ZodNullable<z.ZodString>;
                        requestedCount: z.ZodNullable<z.ZodNumber>;
                        keptCount: z.ZodNullable<z.ZodNumber>;
                    }, z.core.$strip>;
                    text: z.ZodString;
                }, z.core.$strip>>;
                fullSavedToProfile: z.ZodBoolean;
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
    readonly clientConversationFeed: {
        readonly auth: {
            readonly kind: "apiKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["client"];
        readonly summary: "One conversation's messages from the hub's own stores, newest first, with a Ping summary on the first page";
        readonly description: string;
        readonly params: z.ZodObject<{
            pageLabel: z.ZodString;
            fanRef: z.ZodString;
        }, z.core.$strip>;
        readonly querystring: z.ZodObject<{
            cursor: z.ZodOptional<z.ZodString>;
            limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
            summaryWindow: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
            conversationRef: z.ZodOptional<z.ZodString>;
            depthMarks: z.ZodOptional<z.ZodPipe<z.ZodString, z.ZodTransform<number[], string>>>;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodObject<{
                target: z.ZodObject<{
                    pageLabel: z.ZodString;
                    fanRef: z.ZodString;
                    conversationRef: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>;
                source: z.ZodString;
                snapshotRevision: z.ZodString;
                asOf: z.ZodString;
                coverage: z.ZodString;
                head: z.ZodNullable<z.ZodObject<{
                    messageRef: z.ZodString;
                    at: z.ZodNullable<z.ZodString>;
                    sender: z.ZodString;
                }, z.core.$strip>>;
                newestKnownAt: z.ZodNullable<z.ZodString>;
                nextOlderCursor: z.ZodNullable<z.ZodString>;
                items: z.ZodArray<z.ZodObject<{
                    messageId: z.ZodString;
                    at: z.ZodNullable<z.ZodString>;
                    sender: z.ZodString;
                    text: z.ZodString;
                    automatic: z.ZodNullable<z.ZodBoolean>;
                    deleted: z.ZodBoolean;
                    tipMills: z.ZodNullable<z.ZodNumber>;
                    priceMills: z.ZodNullable<z.ZodNumber>;
                    attachmentLabels: z.ZodArray<z.ZodString>;
                }, z.core.$strip>>;
                summary: z.ZodNullable<z.ZodObject<{
                    pingSegment: z.ZodString;
                    fanSilenceDays: z.ZodNullable<z.ZodNumber>;
                    window: z.ZodObject<{
                        requested: z.ZodNumber;
                        served: z.ZodNumber;
                    }, z.core.$strip>;
                    coverage: z.ZodString;
                    asOf: z.ZodString;
                }, z.core.$strip>>;
                depth: z.ZodOptional<z.ZodObject<{
                    storedCount: z.ZodNumber;
                    oldestAt: z.ZodNullable<z.ZodString>;
                    historyComplete: z.ZodBoolean;
                    marks: z.ZodArray<z.ZodObject<{
                        count: z.ZodNumber;
                        at: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
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
            readonly 409: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    };
    readonly clientFanProfileFromGeneration: {
        readonly auth: {
            readonly kind: "apiKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["client"];
        readonly summary: "Save a finished full recap as the fan's dossier, from the generation the hub stored";
        readonly description: string;
        readonly params: z.ZodObject<{
            pageLabel: z.ZodString;
            fanRef: z.ZodString;
        }, z.core.$strip>;
        readonly body: z.ZodObject<{
            generationRef: z.ZodString;
            clientRequestId: z.ZodOptional<z.ZodString>;
            conversationRef: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodObject<{
                outcome: z.ZodEnum<{
                    created: "created";
                    existing: "existing";
                }>;
                profile: z.ZodObject<{
                    version: z.ZodNumber;
                    createdAt: z.ZodString;
                    sourceGeneratedAt: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>;
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
    readonly clientAiUsageDaily: {
        readonly auth: {
            readonly kind: "apiKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["client"];
        readonly summary: "The caller's own AI spend on one page, by day";
        readonly description: string;
        readonly params: z.ZodObject<{
            pageLabel: z.ZodString;
        }, z.core.$strip>;
        readonly querystring: z.ZodObject<{
            date: z.ZodString;
            days: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
            timeZone: z.ZodDefault<z.ZodString>;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodObject<{
                scope: z.ZodObject<{
                    pageLabel: z.ZodString;
                    userId: z.ZodNumber;
                }, z.core.$strip>;
                timeZone: z.ZodString;
                asOf: z.ZodString;
                moneyUnit: z.ZodLiteral<"micro-USD">;
                days: z.ZodArray<z.ZodObject<{
                    date: z.ZodString;
                    from: z.ZodString;
                    toExclusive: z.ZodString;
                    coverage: z.ZodString;
                    coverageReasons: z.ZodArray<z.ZodString>;
                    totals: z.ZodObject<{
                        requestCount: z.ZodNumber;
                        costMicroUsd: z.ZodNumber;
                        costApproximate: z.ZodBoolean;
                        tokens: z.ZodObject<{
                            input: z.ZodNumber;
                            output: z.ZodNumber;
                            cacheWrite: z.ZodNumber;
                            cacheRead: z.ZodNumber;
                        }, z.core.$strip>;
                        completed: z.ZodNumber;
                        failed: z.ZodNumber;
                        cancelled: z.ZodNumber;
                        quotaDenied: z.ZodNumber;
                        openReservations: z.ZodNumber;
                        regenerations: z.ZodNumber;
                    }, z.core.$strip>;
                    features: z.ZodArray<z.ZodObject<{
                        requestCount: z.ZodNumber;
                        costMicroUsd: z.ZodNumber;
                        costApproximate: z.ZodBoolean;
                        tokens: z.ZodObject<{
                            input: z.ZodNumber;
                            output: z.ZodNumber;
                            cacheWrite: z.ZodNumber;
                            cacheRead: z.ZodNumber;
                        }, z.core.$strip>;
                        completed: z.ZodNumber;
                        failed: z.ZodNumber;
                        cancelled: z.ZodNumber;
                        quotaDenied: z.ZodNumber;
                        openReservations: z.ZodNumber;
                        regenerations: z.ZodNumber;
                        feature: z.ZodString;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                quota: z.ZodNullable<z.ZodObject<{
                    dayBoundary: z.ZodLiteral<"UTC">;
                    remainingRequestsToday: z.ZodNullable<z.ZodNumber>;
                    remainingMicroUsdToday: z.ZodNullable<z.ZodNumber>;
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
            readonly 409: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    };
    readonly clientSpenderStats: {
        readonly auth: {
            readonly kind: "apiKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["client"];
        readonly summary: "Spenders statistics of one page: 30 local days of money, tiers, silence, new payers, awaiting reply";
        readonly description: string;
        readonly params: z.ZodObject<{
            pageLabel: z.ZodString;
        }, z.core.$strip>;
        readonly querystring: z.ZodObject<{
            windowDays: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
            timeZone: z.ZodString;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodObject<{
                pageLabel: z.ZodString;
                metricVersion: z.ZodNumber;
                moneyUnit: z.ZodLiteral<"USD-mills">;
                basis: z.ZodLiteral<"gross">;
                timeZone: z.ZodString;
                from: z.ZodString;
                to: z.ZodString;
                asOf: z.ZodString;
                projectionAsOf: z.ZodNullable<z.ZodString>;
                includedStates: z.ZodArray<z.ZodString>;
                coverage: z.ZodObject<{
                    state: z.ZodString;
                    reasons: z.ZodArray<z.ZodString>;
                }, z.core.$strip>;
                days: z.ZodArray<z.ZodObject<{
                    date: z.ZodString;
                    grossMills: z.ZodNumber;
                    purchasesGrossMills: z.ZodNumber;
                    adjustmentsMills: z.ZodNumber;
                    creatorNetMills: z.ZodNumber;
                    purchaseCount: z.ZodNumber;
                    byState: z.ZodRecord<z.ZodString, z.ZodNumber>;
                }, z.core.$strip>>;
                totals: z.ZodObject<{
                    today: z.ZodObject<{
                        grossMills: z.ZodNumber;
                        purchasesGrossMills: z.ZodNumber;
                        adjustmentsMills: z.ZodNumber;
                        creatorNetMills: z.ZodNumber;
                        purchaseCount: z.ZodNumber;
                        payerCount: z.ZodNumber;
                    }, z.core.$strip>;
                    d7: z.ZodObject<{
                        grossMills: z.ZodNumber;
                        purchasesGrossMills: z.ZodNumber;
                        adjustmentsMills: z.ZodNumber;
                        creatorNetMills: z.ZodNumber;
                        purchaseCount: z.ZodNumber;
                        payerCount: z.ZodNumber;
                    }, z.core.$strip>;
                    prev7: z.ZodObject<{
                        grossMills: z.ZodNumber;
                        purchasesGrossMills: z.ZodNumber;
                        adjustmentsMills: z.ZodNumber;
                        creatorNetMills: z.ZodNumber;
                        purchaseCount: z.ZodNumber;
                        payerCount: z.ZodNumber;
                    }, z.core.$strip>;
                    d30: z.ZodObject<{
                        grossMills: z.ZodNumber;
                        purchasesGrossMills: z.ZodNumber;
                        adjustmentsMills: z.ZodNumber;
                        creatorNetMills: z.ZodNumber;
                        purchaseCount: z.ZodNumber;
                        payerCount: z.ZodNumber;
                    }, z.core.$strip>;
                    d7DeltaPct: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strip>;
                avgCheckMills: z.ZodNullable<z.ZodNumber>;
                tiers: z.ZodArray<z.ZodObject<{
                    key: z.ZodString;
                    label: z.ZodString;
                    minMills: z.ZodNullable<z.ZodNumber>;
                    maxMills: z.ZodNullable<z.ZodNumber>;
                    members: z.ZodNumber;
                    windowPayers: z.ZodNumber;
                    windowGrossMills: z.ZodNumber;
                    windowNetMills: z.ZodNumber;
                }, z.core.$strip>>;
                silence: z.ZodObject<{
                    d8to21: z.ZodObject<{
                        fans: z.ZodNumber;
                        lifetimeGrossMills: z.ZodNumber;
                    }, z.core.$strip>;
                    over21: z.ZodObject<{
                        fans: z.ZodNumber;
                        lifetimeGrossMills: z.ZodNumber;
                    }, z.core.$strip>;
                    unknown: z.ZodObject<{
                        fans: z.ZodNumber;
                        lifetimeGrossMills: z.ZodNumber;
                    }, z.core.$strip>;
                }, z.core.$strip>;
                newPayers: z.ZodObject<{
                    count: z.ZodNumber;
                    firstPurchaseKnown: z.ZodBoolean;
                }, z.core.$strip>;
                queueSummary: z.ZodObject<{
                    total: z.ZodNumber;
                    unknown: z.ZodNumber;
                }, z.core.$strip>;
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
    readonly clientSpenderAwaitingReply: {
        readonly auth: {
            readonly kind: "apiKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["client"];
        readonly summary: "The payers of one page whose fan waits for a reply, biggest spender first, a page at a time";
        readonly description: string;
        readonly params: z.ZodObject<{
            pageLabel: z.ZodString;
        }, z.core.$strip>;
        readonly querystring: z.ZodObject<{
            cursor: z.ZodOptional<z.ZodString>;
            limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
            everyone: z.ZodOptional<z.ZodPipe<z.ZodEnum<{
                true: "true";
                false: "false";
            }>, z.ZodTransform<boolean, "true" | "false">>>;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodObject<{
                items: z.ZodArray<z.ZodObject<{
                    fanRef: z.ZodString;
                    conversationRef: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    alias: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    username: z.ZodNullable<z.ZodString>;
                    displayName: z.ZodNullable<z.ZodString>;
                    lifetimeGrossMills: z.ZodNumber;
                    lastFanMessageAt: z.ZodString;
                    lastModelMessageAt: z.ZodNullable<z.ZodString>;
                    unreadCount: z.ZodNullable<z.ZodNumber>;
                    readState: z.ZodString;
                }, z.core.$strip>>;
                total: z.ZodNumber;
                loaded: z.ZodNumber;
                unknown: z.ZodNumber;
                nextCursor: z.ZodNullable<z.ZodString>;
                asOf: z.ZodString;
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
    readonly clientFanClaim: {
        readonly auth: {
            readonly kind: "apiKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["client"];
        readonly summary: "The greeting lease and the send custody of one fan: claim, renew, release, dispatch, sent, failed, registerNativeSend";
        readonly description: string;
        readonly params: z.ZodObject<{
            pageLabel: z.ZodString;
            fanRef: z.ZodString;
        }, z.core.$strip>;
        readonly body: z.ZodDiscriminatedUnion<[z.ZodObject<{
            action: z.ZodLiteral<"claim">;
            leaseToken: z.ZodString;
            instanceId: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            action: z.ZodLiteral<"renew">;
            leaseToken: z.ZodString;
            instanceId: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            action: z.ZodLiteral<"release">;
            leaseToken: z.ZodString;
            instanceId: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            action: z.ZodLiteral<"dispatch">;
            attemptId: z.ZodString;
            instanceId: z.ZodString;
            purpose: z.ZodEnum<{
                greeting: "greeting";
                "preview-reply": "preview-reply";
            }>;
            group: z.ZodUnion<readonly [z.ZodObject<{
                generationRef: z.ZodString;
                variant: z.ZodNumber;
                partCount: z.ZodNumber;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"manual">;
                textFingerprint: z.ZodString;
            }, z.core.$strict>]>;
            partIndex: z.ZodNumber;
            textRevision: z.ZodNumber;
            leaseToken: z.ZodOptional<z.ZodString>;
            flagRevision: z.ZodNumber;
        }, z.core.$strict>, z.ZodObject<{
            action: z.ZodLiteral<"sent">;
            attemptId: z.ZodString;
            instanceId: z.ZodString;
            platformMessageId: z.ZodString;
            evidence: z.ZodLiteral<"receipt+echo">;
        }, z.core.$strict>, z.ZodObject<{
            action: z.ZodLiteral<"failed">;
            attemptId: z.ZodString;
            instanceId: z.ZodString;
            reason: z.ZodEnum<{
                not_enqueued: "not_enqueued";
                native_rejected: "native_rejected";
            }>;
            httpStatus: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>, z.ZodObject<{
            action: z.ZodLiteral<"registerNativeSend">;
            attemptId: z.ZodString;
            instanceId: z.ZodString;
            purpose: z.ZodEnum<{
                greeting: "greeting";
                "preview-reply": "preview-reply";
            }>;
            group: z.ZodUnion<readonly [z.ZodObject<{
                generationRef: z.ZodString;
                variant: z.ZodNumber;
                partCount: z.ZodNumber;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"manual">;
                textFingerprint: z.ZodString;
            }, z.core.$strict>]>;
            partIndex: z.ZodNumber;
            platformMessageId: z.ZodString;
        }, z.core.$strict>], "action">;
        readonly response: {
            readonly 200: z.ZodObject<{
                greeting: z.ZodObject<{
                    state: z.ZodEnum<{
                        none: "none";
                        confirmed: "confirmed";
                    }>;
                    at: z.ZodNullable<z.ZodString>;
                    messageRef: z.ZodNullable<z.ZodString>;
                    source: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>;
                lease: z.ZodObject<{
                    state: z.ZodEnum<{
                        none: "none";
                        expired: "expired";
                        owned: "owned";
                        held: "held";
                        released: "released";
                    }>;
                    leaseToken: z.ZodNullable<z.ZodString>;
                    expiresAt: z.ZodNullable<z.ZodString>;
                    heldBy: z.ZodNullable<z.ZodEnum<{
                        "you-elsewhere": "you-elsewhere";
                        "someone-else": "someone-else";
                    }>>;
                }, z.core.$strip>;
                group: z.ZodNullable<z.ZodObject<{
                    generationRef: z.ZodString;
                    variant: z.ZodNumber;
                    partCount: z.ZodNumber;
                    sentParts: z.ZodArray<z.ZodNumber>;
                    heldParts: z.ZodArray<z.ZodNumber>;
                }, z.core.$strip>>;
                custody: z.ZodNullable<z.ZodObject<{
                    attemptId: z.ZodString;
                    state: z.ZodEnum<{
                        failed: "failed";
                        dispatching: "dispatching";
                        sent: "sent";
                        "uncertain-held": "uncertain-held";
                        "resolved-sent": "resolved-sent";
                        "resolved-not-sent": "resolved-not-sent";
                    }>;
                    ticket: z.ZodNullable<z.ZodString>;
                    ticketExpiresAt: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
                serverNow: z.ZodString;
                flagRevision: z.ZodNumber;
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
            readonly 429: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
                retryAfterMs: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>;
        };
    };
    readonly clientFanClaimStatus: {
        readonly auth: {
            readonly kind: "apiKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["client"];
        readonly summary: "The greeting, lease and custody state of one fan, read only";
        readonly description: string;
        readonly params: z.ZodObject<{
            pageLabel: z.ZodString;
            fanRef: z.ZodString;
        }, z.core.$strip>;
        readonly response: {
            readonly 200: z.ZodObject<{
                greeting: z.ZodObject<{
                    state: z.ZodEnum<{
                        none: "none";
                        confirmed: "confirmed";
                    }>;
                    at: z.ZodNullable<z.ZodString>;
                    messageRef: z.ZodNullable<z.ZodString>;
                    source: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>;
                lease: z.ZodObject<{
                    state: z.ZodEnum<{
                        none: "none";
                        expired: "expired";
                        owned: "owned";
                        held: "held";
                        released: "released";
                    }>;
                    leaseToken: z.ZodNullable<z.ZodString>;
                    expiresAt: z.ZodNullable<z.ZodString>;
                    heldBy: z.ZodNullable<z.ZodEnum<{
                        "you-elsewhere": "you-elsewhere";
                        "someone-else": "someone-else";
                    }>>;
                }, z.core.$strip>;
                group: z.ZodNullable<z.ZodObject<{
                    generationRef: z.ZodString;
                    variant: z.ZodNumber;
                    partCount: z.ZodNumber;
                    sentParts: z.ZodArray<z.ZodNumber>;
                    heldParts: z.ZodArray<z.ZodNumber>;
                }, z.core.$strip>>;
                custody: z.ZodNullable<z.ZodObject<{
                    attemptId: z.ZodString;
                    state: z.ZodEnum<{
                        failed: "failed";
                        dispatching: "dispatching";
                        sent: "sent";
                        "uncertain-held": "uncertain-held";
                        "resolved-sent": "resolved-sent";
                        "resolved-not-sent": "resolved-not-sent";
                    }>;
                    ticket: z.ZodNullable<z.ZodString>;
                    ticketExpiresAt: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
                serverNow: z.ZodString;
                flagRevision: z.ZodNumber;
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
    readonly clientSendAttributions: {
        readonly auth: {
            readonly kind: "apiKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["client"];
        readonly summary: "Report who sent outgoing messages: the caller sent these messages of the page from their browser";
        readonly description: string;
        readonly params: z.ZodObject<{
            pageLabel: z.ZodString;
        }, z.core.$strip>;
        readonly body: z.ZodObject<{
            source: z.ZodString;
            facts: z.ZodArray<z.ZodObject<{
                platformMessageId: z.ZodString;
                fanRef: z.ZodString;
                conversationRef: z.ZodOptional<z.ZodString>;
                observedAt: z.ZodString;
                priced: z.ZodBoolean;
                withMedia: z.ZodBoolean;
                composedWith: z.ZodOptional<z.ZodString>;
                edited: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodObject<{
                pageLabel: z.ZodString;
                results: z.ZodArray<z.ZodObject<{
                    platformMessageId: z.ZodString;
                    outcome: z.ZodString;
                }, z.core.$strip>>;
                serverNow: z.ZodString;
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
    readonly clientActivity: {
        readonly auth: {
            readonly kind: "apiKey";
        };
        readonly tags: readonly ["client"];
        readonly summary: "The chat extension's beat: the pages it has open and how long ago the person was active on them";
        readonly description: string;
        readonly body: z.ZodObject<{
            instanceId: z.ZodString;
            pages: z.ZodArray<z.ZodObject<{
                pageLabel: z.ZodString;
                idleMs: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strict>>;
            closed: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodObject<{
                recorded: z.ZodNumber;
                serverNow: z.ZodString;
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
    readonly teamShifts: {
        readonly auth: {
            readonly kind: "session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "The actual shifts of the team, from the chat extension's activity";
        readonly description: string;
        readonly querystring: z.ZodObject<{
            from: z.ZodOptional<z.ZodString>;
            to: z.ZodOptional<z.ZodString>;
            pageLabel: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
        readonly response: {
            readonly 200: z.ZodObject<{
                from: z.ZodString;
                to: z.ZodString;
                shifts: z.ZodArray<z.ZodObject<{
                    userId: z.ZodNumber;
                    username: z.ZodString;
                    startedAt: z.ZodString;
                    endedAt: z.ZodString;
                    ongoing: z.ZodBoolean;
                    workedMinutes: z.ZodNumber;
                    pauses: z.ZodArray<z.ZodObject<{
                        from: z.ZodString;
                        to: z.ZodString;
                    }, z.core.$strip>>;
                    pages: z.ZodArray<z.ZodObject<{
                        pageLabel: z.ZodString;
                        activeMinutes: z.ZodNumber;
                    }, z.core.$strip>>;
                    authoredMessages: z.ZodNumber;
                }, z.core.$strip>>;
                serverNow: z.ZodString;
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
    readonly clientInConversation: {
        readonly auth: {
            readonly kind: "apiKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["client"];
        readonly summary: "Who is talking to which fan of the page now: whoever wrote to him in the last 15 minutes";
        readonly description: string;
        readonly params: z.ZodObject<{
            pageLabel: z.ZodString;
        }, z.core.$strip>;
        readonly response: {
            readonly 200: z.ZodObject<{
                pageLabel: z.ZodString;
                fans: z.ZodArray<z.ZodObject<{
                    fanRef: z.ZodString;
                    conversationRef: z.ZodNullable<z.ZodString>;
                    chatters: z.ZodArray<z.ZodObject<{
                        userId: z.ZodNumber;
                        name: z.ZodString;
                        isMe: z.ZodBoolean;
                        lastSentAt: z.ZodString;
                        until: z.ZodString;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                serverNow: z.ZodString;
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
    readonly teamAuthorship: {
        readonly auth: {
            readonly kind: "session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "How many of each page's outgoing messages have an author, per day";
        readonly description: string;
        readonly querystring: z.ZodObject<{
            days: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
        }, z.core.$strip>;
        readonly response: {
            readonly 200: z.ZodObject<{
                from: z.ZodString;
                to: z.ZodString;
                pages: z.ZodArray<z.ZodObject<{
                    pageLabel: z.ZodString;
                    platform: z.ZodString;
                    total: z.ZodObject<{
                        personal: z.ZodNumber;
                        authored: z.ZodNumber;
                        inShift: z.ZodNumber;
                        inShiftAuthored: z.ZodNumber;
                    }, z.core.$strip>;
                    days: z.ZodArray<z.ZodObject<{
                        personal: z.ZodNumber;
                        authored: z.ZodNumber;
                        inShift: z.ZodNumber;
                        inShiftAuthored: z.ZodNumber;
                        day: z.ZodString;
                    }, z.core.$strip>>;
                    authors: z.ZodArray<z.ZodObject<{
                        userId: z.ZodNumber;
                        username: z.ZodString;
                        messages: z.ZodNumber;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                serverNow: z.ZodString;
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
    readonly teamEmptyHours: {
        readonly auth: {
            readonly kind: "session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "Empty hours of each page and who waited in them";
        readonly description: string;
        readonly querystring: z.ZodObject<{
            days: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
        }, z.core.$strip>;
        readonly response: {
            readonly 200: z.ZodObject<{
                from: z.ZodString;
                to: z.ZodString;
                pages: z.ZodArray<z.ZodObject<{
                    pageLabel: z.ZodString;
                    platform: z.ZodString;
                    shiftsSince: z.ZodNullable<z.ZodString>;
                    hoursWithFans: z.ZodNumber;
                    emptyHours: z.ZodNumber;
                    emptyByHour: z.ZodArray<z.ZodNumber>;
                    fans: z.ZodNumber;
                    payers: z.ZodNumber;
                    waitedOverHour: z.ZodNumber;
                    waitedNetMills: z.ZodNumber;
                }, z.core.$strip>>;
                serverNow: z.ZodString;
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
    readonly teamGreetings: {
        readonly auth: {
            readonly kind: "session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "Greetings of new subscribers and replies to broadcasts";
        readonly description: string;
        readonly querystring: z.ZodObject<{
            days: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
        }, z.core.$strip>;
        readonly response: {
            readonly 200: z.ZodObject<{
                from: z.ZodString;
                to: z.ZodString;
                pages: z.ZodArray<z.ZodObject<{
                    pageLabel: z.ZodString;
                    platform: z.ZodString;
                    newSubscribers: z.ZodNumber;
                    autoWelcomed: z.ZodNumber;
                    greeted: z.ZodNumber;
                    greetingMedianSeconds: z.ZodNullable<z.ZodNumber>;
                    repliedWithinHour: z.ZodNumber;
                    boughtGreeted: z.ZodNumber;
                    boughtNotGreeted: z.ZodNumber;
                    recent: z.ZodNumber;
                    broadcasts: z.ZodObject<{
                        deliveries: z.ZodNumber;
                        replied: z.ZodNumber;
                        bought: z.ZodNumber;
                        sent: z.ZodNumber;
                    }, z.core.$strip>;
                }, z.core.$strip>>;
                broadcasts: z.ZodArray<z.ZodObject<{
                    deliveries: z.ZodNumber;
                    replied: z.ZodNumber;
                    bought: z.ZodNumber;
                    pageLabel: z.ZodString;
                    sentAt: z.ZodString;
                    preview: z.ZodString;
                    priceMills: z.ZodNullable<z.ZodNumber>;
                    files: z.ZodNumber;
                    massMessage: z.ZodBoolean;
                    ppvBought: z.ZodNumber;
                }, z.core.$strip>>;
                serverNow: z.ZodString;
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
    readonly clientFanCard: {
        readonly auth: {
            readonly kind: "apiKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["client"];
        readonly summary: "The fan's card across pages: the person's accounts, the team's alias and the money on every page, and accounts that may be the same person";
        readonly description: string;
        readonly params: z.ZodObject<{
            pageLabel: z.ZodString;
            fanRef: z.ZodString;
        }, z.core.$strip>;
        readonly response: {
            readonly 200: z.ZodObject<{
                pageLabel: z.ZodString;
                fanRef: z.ZodString;
                known: z.ZodBoolean;
                accounts: z.ZodArray<z.ZodObject<{
                    platform: z.ZodString;
                    fanRef: z.ZodString;
                    username: z.ZodNullable<z.ZodString>;
                    displayName: z.ZodNullable<z.ZodString>;
                    gone: z.ZodBoolean;
                    linkedBy: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
                pages: z.ZodArray<z.ZodObject<{
                    pageLabel: z.ZodString;
                    platform: z.ZodString;
                    modelName: z.ZodNullable<z.ZodString>;
                    fanRef: z.ZodString;
                    granted: z.ZodBoolean;
                    alias: z.ZodNullable<z.ZodString>;
                    subscribed: z.ZodBoolean;
                    subscribedSince: z.ZodNullable<z.ZodString>;
                    subscriptionEndsAt: z.ZodNullable<z.ZodString>;
                    spentMills: z.ZodNumber;
                    last30Mills: z.ZodRecord<z.ZodString, z.ZodNumber>;
                    lastPurchaseAt: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
                suggestions: z.ZodArray<z.ZodObject<{
                    platform: z.ZodString;
                    fanRef: z.ZodString;
                    username: z.ZodNullable<z.ZodString>;
                    displayName: z.ZodNullable<z.ZodString>;
                    gone: z.ZodBoolean;
                    reason: z.ZodString;
                    shared: z.ZodString;
                    sharedOn: z.ZodNullable<z.ZodString>;
                    pages: z.ZodArray<z.ZodObject<{
                        pageLabel: z.ZodString;
                        platform: z.ZodString;
                        modelName: z.ZodNullable<z.ZodString>;
                        fanRef: z.ZodString;
                        granted: z.ZodBoolean;
                        alias: z.ZodNullable<z.ZodString>;
                        subscribed: z.ZodBoolean;
                        subscribedSince: z.ZodNullable<z.ZodString>;
                        subscriptionEndsAt: z.ZodNullable<z.ZodString>;
                        spentMills: z.ZodNumber;
                        last30Mills: z.ZodRecord<z.ZodString, z.ZodNumber>;
                        lastPurchaseAt: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                facts: z.ZodArray<z.ZodObject<{
                    id: z.ZodNumber;
                    kind: z.ZodString;
                    text: z.ZodString;
                    pageLabel: z.ZodString;
                    granted: z.ZodBoolean;
                    conversationRef: z.ZodString;
                    messageRef: z.ZodString;
                    messageAt: z.ZodNullable<z.ZodString>;
                    source: z.ZodString;
                    author: z.ZodNullable<z.ZodString>;
                    createdAt: z.ZodString;
                    quote: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                        text: z.ZodString;
                        from: z.ZodString;
                        at: z.ZodString;
                        media: z.ZodBoolean;
                    }, z.core.$strip>>>;
                }, z.core.$strip>>;
                customs: z.ZodArray<z.ZodObject<{
                    id: z.ZodNumber;
                    pageLabel: z.ZodString;
                    granted: z.ZodBoolean;
                    description: z.ZodString;
                    priceMills: z.ZodNullable<z.ZodNumber>;
                    state: z.ZodString;
                    paymentMills: z.ZodNullable<z.ZodNumber>;
                    paidAt: z.ZodNullable<z.ZodString>;
                    deliveredMessageRef: z.ZodNullable<z.ZodString>;
                    deliveredAt: z.ZodNullable<z.ZodString>;
                    createdBy: z.ZodString;
                    createdAt: z.ZodString;
                    deliveryCandidates: z.ZodArray<z.ZodObject<{
                        messageRef: z.ZodString;
                        at: z.ZodString;
                        mediaCount: z.ZodNumber;
                        priceMills: z.ZodNullable<z.ZodNumber>;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                customPayments: z.ZodArray<z.ZodObject<{
                    paymentRef: z.ZodString;
                    amountMills: z.ZodNumber;
                    at: z.ZodString;
                    note: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
                serverNow: z.ZodString;
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
    readonly clientFanLinkDecide: {
        readonly auth: {
            readonly kind: "apiKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["client"];
        readonly summary: "A chatter decides whether a suggested account is the same person as the fan";
        readonly description: string;
        readonly params: z.ZodObject<{
            pageLabel: z.ZodString;
            fanRef: z.ZodString;
        }, z.core.$strip>;
        readonly body: z.ZodObject<{
            otherPlatform: z.ZodString;
            otherFanRef: z.ZodString;
            decision: z.ZodEnum<{
                same: "same";
                different: "different";
            }>;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodObject<{
                decision: z.ZodEnum<{
                    same: "same";
                    different: "different";
                }>;
                recorded: z.ZodBoolean;
                card: z.ZodObject<{
                    pageLabel: z.ZodString;
                    fanRef: z.ZodString;
                    known: z.ZodBoolean;
                    accounts: z.ZodArray<z.ZodObject<{
                        platform: z.ZodString;
                        fanRef: z.ZodString;
                        username: z.ZodNullable<z.ZodString>;
                        displayName: z.ZodNullable<z.ZodString>;
                        gone: z.ZodBoolean;
                        linkedBy: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                    pages: z.ZodArray<z.ZodObject<{
                        pageLabel: z.ZodString;
                        platform: z.ZodString;
                        modelName: z.ZodNullable<z.ZodString>;
                        fanRef: z.ZodString;
                        granted: z.ZodBoolean;
                        alias: z.ZodNullable<z.ZodString>;
                        subscribed: z.ZodBoolean;
                        subscribedSince: z.ZodNullable<z.ZodString>;
                        subscriptionEndsAt: z.ZodNullable<z.ZodString>;
                        spentMills: z.ZodNumber;
                        last30Mills: z.ZodRecord<z.ZodString, z.ZodNumber>;
                        lastPurchaseAt: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                    suggestions: z.ZodArray<z.ZodObject<{
                        platform: z.ZodString;
                        fanRef: z.ZodString;
                        username: z.ZodNullable<z.ZodString>;
                        displayName: z.ZodNullable<z.ZodString>;
                        gone: z.ZodBoolean;
                        reason: z.ZodString;
                        shared: z.ZodString;
                        sharedOn: z.ZodNullable<z.ZodString>;
                        pages: z.ZodArray<z.ZodObject<{
                            pageLabel: z.ZodString;
                            platform: z.ZodString;
                            modelName: z.ZodNullable<z.ZodString>;
                            fanRef: z.ZodString;
                            granted: z.ZodBoolean;
                            alias: z.ZodNullable<z.ZodString>;
                            subscribed: z.ZodBoolean;
                            subscribedSince: z.ZodNullable<z.ZodString>;
                            subscriptionEndsAt: z.ZodNullable<z.ZodString>;
                            spentMills: z.ZodNumber;
                            last30Mills: z.ZodRecord<z.ZodString, z.ZodNumber>;
                            lastPurchaseAt: z.ZodNullable<z.ZodString>;
                        }, z.core.$strip>>;
                    }, z.core.$strip>>;
                    facts: z.ZodArray<z.ZodObject<{
                        id: z.ZodNumber;
                        kind: z.ZodString;
                        text: z.ZodString;
                        pageLabel: z.ZodString;
                        granted: z.ZodBoolean;
                        conversationRef: z.ZodString;
                        messageRef: z.ZodString;
                        messageAt: z.ZodNullable<z.ZodString>;
                        source: z.ZodString;
                        author: z.ZodNullable<z.ZodString>;
                        createdAt: z.ZodString;
                        quote: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                            text: z.ZodString;
                            from: z.ZodString;
                            at: z.ZodString;
                            media: z.ZodBoolean;
                        }, z.core.$strip>>>;
                    }, z.core.$strip>>;
                    customs: z.ZodArray<z.ZodObject<{
                        id: z.ZodNumber;
                        pageLabel: z.ZodString;
                        granted: z.ZodBoolean;
                        description: z.ZodString;
                        priceMills: z.ZodNullable<z.ZodNumber>;
                        state: z.ZodString;
                        paymentMills: z.ZodNullable<z.ZodNumber>;
                        paidAt: z.ZodNullable<z.ZodString>;
                        deliveredMessageRef: z.ZodNullable<z.ZodString>;
                        deliveredAt: z.ZodNullable<z.ZodString>;
                        createdBy: z.ZodString;
                        createdAt: z.ZodString;
                        deliveryCandidates: z.ZodArray<z.ZodObject<{
                            messageRef: z.ZodString;
                            at: z.ZodString;
                            mediaCount: z.ZodNumber;
                            priceMills: z.ZodNullable<z.ZodNumber>;
                        }, z.core.$strip>>;
                    }, z.core.$strip>>;
                    customPayments: z.ZodArray<z.ZodObject<{
                        paymentRef: z.ZodString;
                        amountMills: z.ZodNumber;
                        at: z.ZodString;
                        note: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                    serverNow: z.ZodString;
                }, z.core.$strip>;
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
    readonly clientFanFactChange: {
        readonly auth: {
            readonly kind: "apiKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["client"];
        readonly summary: "A chatter deletes or corrects a fact from the chat in one click";
        readonly description: string;
        readonly params: z.ZodObject<{
            pageLabel: z.ZodString;
            fanRef: z.ZodString;
            factId: z.ZodCoercedNumber<unknown>;
        }, z.core.$strip>;
        readonly body: z.ZodDiscriminatedUnion<[z.ZodObject<{
            action: z.ZodLiteral<"delete">;
        }, z.core.$strict>, z.ZodObject<{
            action: z.ZodLiteral<"correct">;
            text: z.ZodString;
        }, z.core.$strict>], "action">;
        readonly response: {
            readonly 200: z.ZodObject<{
                changed: z.ZodBoolean;
                card: z.ZodObject<{
                    pageLabel: z.ZodString;
                    fanRef: z.ZodString;
                    known: z.ZodBoolean;
                    accounts: z.ZodArray<z.ZodObject<{
                        platform: z.ZodString;
                        fanRef: z.ZodString;
                        username: z.ZodNullable<z.ZodString>;
                        displayName: z.ZodNullable<z.ZodString>;
                        gone: z.ZodBoolean;
                        linkedBy: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                    pages: z.ZodArray<z.ZodObject<{
                        pageLabel: z.ZodString;
                        platform: z.ZodString;
                        modelName: z.ZodNullable<z.ZodString>;
                        fanRef: z.ZodString;
                        granted: z.ZodBoolean;
                        alias: z.ZodNullable<z.ZodString>;
                        subscribed: z.ZodBoolean;
                        subscribedSince: z.ZodNullable<z.ZodString>;
                        subscriptionEndsAt: z.ZodNullable<z.ZodString>;
                        spentMills: z.ZodNumber;
                        last30Mills: z.ZodRecord<z.ZodString, z.ZodNumber>;
                        lastPurchaseAt: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                    suggestions: z.ZodArray<z.ZodObject<{
                        platform: z.ZodString;
                        fanRef: z.ZodString;
                        username: z.ZodNullable<z.ZodString>;
                        displayName: z.ZodNullable<z.ZodString>;
                        gone: z.ZodBoolean;
                        reason: z.ZodString;
                        shared: z.ZodString;
                        sharedOn: z.ZodNullable<z.ZodString>;
                        pages: z.ZodArray<z.ZodObject<{
                            pageLabel: z.ZodString;
                            platform: z.ZodString;
                            modelName: z.ZodNullable<z.ZodString>;
                            fanRef: z.ZodString;
                            granted: z.ZodBoolean;
                            alias: z.ZodNullable<z.ZodString>;
                            subscribed: z.ZodBoolean;
                            subscribedSince: z.ZodNullable<z.ZodString>;
                            subscriptionEndsAt: z.ZodNullable<z.ZodString>;
                            spentMills: z.ZodNumber;
                            last30Mills: z.ZodRecord<z.ZodString, z.ZodNumber>;
                            lastPurchaseAt: z.ZodNullable<z.ZodString>;
                        }, z.core.$strip>>;
                    }, z.core.$strip>>;
                    facts: z.ZodArray<z.ZodObject<{
                        id: z.ZodNumber;
                        kind: z.ZodString;
                        text: z.ZodString;
                        pageLabel: z.ZodString;
                        granted: z.ZodBoolean;
                        conversationRef: z.ZodString;
                        messageRef: z.ZodString;
                        messageAt: z.ZodNullable<z.ZodString>;
                        source: z.ZodString;
                        author: z.ZodNullable<z.ZodString>;
                        createdAt: z.ZodString;
                        quote: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                            text: z.ZodString;
                            from: z.ZodString;
                            at: z.ZodString;
                            media: z.ZodBoolean;
                        }, z.core.$strip>>>;
                    }, z.core.$strip>>;
                    customs: z.ZodArray<z.ZodObject<{
                        id: z.ZodNumber;
                        pageLabel: z.ZodString;
                        granted: z.ZodBoolean;
                        description: z.ZodString;
                        priceMills: z.ZodNullable<z.ZodNumber>;
                        state: z.ZodString;
                        paymentMills: z.ZodNullable<z.ZodNumber>;
                        paidAt: z.ZodNullable<z.ZodString>;
                        deliveredMessageRef: z.ZodNullable<z.ZodString>;
                        deliveredAt: z.ZodNullable<z.ZodString>;
                        createdBy: z.ZodString;
                        createdAt: z.ZodString;
                        deliveryCandidates: z.ZodArray<z.ZodObject<{
                            messageRef: z.ZodString;
                            at: z.ZodString;
                            mediaCount: z.ZodNumber;
                            priceMills: z.ZodNullable<z.ZodNumber>;
                        }, z.core.$strip>>;
                    }, z.core.$strip>>;
                    customPayments: z.ZodArray<z.ZodObject<{
                        paymentRef: z.ZodString;
                        amountMills: z.ZodNumber;
                        at: z.ZodString;
                        note: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                    serverNow: z.ZodString;
                }, z.core.$strip>;
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
    readonly clientWinBack: {
        readonly auth: {
            readonly kind: "apiKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["client"];
        readonly summary: "A few fans of the page to win back now, with the owner's approaches";
        readonly description: string;
        readonly params: z.ZodObject<{
            pageLabel: z.ZodString;
        }, z.core.$strip>;
        readonly response: {
            readonly 200: z.ZodObject<{
                pageLabel: z.ZodString;
                approaches: z.ZodArray<z.ZodObject<{
                    id: z.ZodNumber;
                    label: z.ZodString;
                }, z.core.$strip>>;
                items: z.ZodArray<z.ZodObject<{
                    fanRef: z.ZodString;
                    conversationRef: z.ZodNullable<z.ZodString>;
                    username: z.ZodNullable<z.ZodString>;
                    displayName: z.ZodNullable<z.ZodString>;
                    alias: z.ZodNullable<z.ZodString>;
                    lifetimeGrossMills: z.ZodNumber;
                    reason: z.ZodString;
                    reasonAt: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
                serverNow: z.ZodString;
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
    readonly clientWinBackAttempt: {
        readonly auth: {
            readonly kind: "apiKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["client"];
        readonly summary: "A chatter picks a win-back approach for a fan of the list";
        readonly description: string;
        readonly params: z.ZodObject<{
            pageLabel: z.ZodString;
        }, z.core.$strip>;
        readonly body: z.ZodObject<{
            fanRef: z.ZodString;
            approachId: z.ZodNumber;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodObject<{
                attemptId: z.ZodNumber;
                list: z.ZodObject<{
                    pageLabel: z.ZodString;
                    approaches: z.ZodArray<z.ZodObject<{
                        id: z.ZodNumber;
                        label: z.ZodString;
                    }, z.core.$strip>>;
                    items: z.ZodArray<z.ZodObject<{
                        fanRef: z.ZodString;
                        conversationRef: z.ZodNullable<z.ZodString>;
                        username: z.ZodNullable<z.ZodString>;
                        displayName: z.ZodNullable<z.ZodString>;
                        alias: z.ZodNullable<z.ZodString>;
                        lifetimeGrossMills: z.ZodNumber;
                        reason: z.ZodString;
                        reasonAt: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                    serverNow: z.ZodString;
                }, z.core.$strip>;
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
    readonly clientOnline: {
        readonly auth: {
            readonly kind: "apiKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["client"];
        readonly summary: "The page's fans seen online recently, why to write to each now, and with what";
        readonly description: string;
        readonly params: z.ZodObject<{
            pageLabel: z.ZodString;
        }, z.core.$strip>;
        readonly querystring: z.ZodObject<{
            minutes: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodObject<{
                pageLabel: z.ZodString;
                minutes: z.ZodNumber;
                items: z.ZodArray<z.ZodObject<{
                    fanRef: z.ZodString;
                    conversationRef: z.ZodNullable<z.ZodString>;
                    username: z.ZodNullable<z.ZodString>;
                    displayName: z.ZodNullable<z.ZodString>;
                    alias: z.ZodNullable<z.ZodString>;
                    greetingName: z.ZodNullable<z.ZodString>;
                    lifetimeGrossMills: z.ZodNumber;
                    last30dGrossMills: z.ZodNumber;
                    seenAt: z.ZodNullable<z.ZodString>;
                    onlineSince: z.ZodNullable<z.ZodString>;
                    seenSource: z.ZodNullable<z.ZodString>;
                    reason: z.ZodString;
                    reasonAt: z.ZodNullable<z.ZodString>;
                    act: z.ZodString;
                    aside: z.ZodNullable<z.ZodString>;
                    asideAt: z.ZodNullable<z.ZodString>;
                    asideBy: z.ZodNullable<z.ZodString>;
                    messageCount: z.ZodNumber;
                    lastFanMessageAt: z.ZodNullable<z.ZodString>;
                    lastPageMessageAt: z.ZodNullable<z.ZodString>;
                    subscription: z.ZodObject<{
                        isSubscriber: z.ZodBoolean;
                        startedAt: z.ZodNullable<z.ZodString>;
                        endsAt: z.ZodNullable<z.ZodString>;
                        autoRenew: z.ZodNullable<z.ZodBoolean>;
                    }, z.core.$strip>;
                }, z.core.$strip>>;
                templates: z.ZodArray<z.ZodObject<{
                    id: z.ZodString;
                    group: z.ZodString;
                    text: z.ZodString;
                }, z.core.$strip>>;
                serverNow: z.ZodString;
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
    readonly clientOnlinePresence: {
        readonly auth: {
            readonly kind: "apiKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["client"];
        readonly summary: "The Fansly fans a chatter's tab saw active, kept as their presence";
        readonly description: string;
        readonly params: z.ZodObject<{
            pageLabel: z.ZodString;
        }, z.core.$strip>;
        readonly body: z.ZodObject<{
            seen: z.ZodArray<z.ZodObject<{
                fanRef: z.ZodString;
                lastSeenAt: z.ZodString;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodObject<{
                recorded: z.ZodNumber;
                skipped: z.ZodNumber;
                serverNow: z.ZodString;
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
    readonly clientOnlineAttempt: {
        readonly auth: {
            readonly kind: "apiKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["client"];
        readonly summary: "What a chatter did with a fan in the «Онлайн» window";
        readonly description: string;
        readonly params: z.ZodObject<{
            pageLabel: z.ZodString;
        }, z.core.$strip>;
        readonly body: z.ZodObject<{
            fanRef: z.ZodString;
            action: z.ZodEnum<{
                sent: "sent";
                dismissed: "dismissed";
                restored: "restored";
            }>;
            act: z.ZodOptional<z.ZodEnum<{
                ping: "ping";
                reply: "reply";
                hi: "hi";
                template: "template";
            }>>;
            templateId: z.ZodOptional<z.ZodString>;
            reason: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodObject<{
                attemptId: z.ZodNumber;
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
    readonly teamWinBackResults: {
        readonly auth: {
            readonly kind: "session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "Win-back results by approach and chatter";
        readonly description: string;
        readonly querystring: z.ZodObject<{
            days: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
        }, z.core.$strip>;
        readonly response: {
            readonly 200: z.ZodObject<{
                from: z.ZodString;
                to: z.ZodString;
                rows: z.ZodArray<z.ZodObject<{
                    approachId: z.ZodNumber;
                    approach: z.ZodString;
                    userId: z.ZodNumber;
                    username: z.ZodString;
                    attempts: z.ZodNumber;
                    sent: z.ZodNumber;
                    matured72h: z.ZodNumber;
                    replied72h: z.ZodNumber;
                    matured7d: z.ZodNumber;
                    bought7d: z.ZodNumber;
                    matured30d: z.ZodNumber;
                    spent30dMills: z.ZodNumber;
                }, z.core.$strip>>;
                serverNow: z.ZodString;
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
    readonly teamWinBackApproaches: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "The owner's list of win-back approaches, retired ones included";
        readonly response: {
            readonly 200: z.ZodObject<{
                approaches: z.ZodArray<z.ZodObject<{
                    id: z.ZodNumber;
                    label: z.ZodString;
                    sortOrder: z.ZodNumber;
                    active: z.ZodBoolean;
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
    readonly teamWinBackApproachSave: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "The owner adds, renames, reorders or retires a win-back approach";
        readonly description: "A retired approach (`active: false`) leaves the chatters' list and keeps its results.";
        readonly body: z.ZodObject<{
            id: z.ZodOptional<z.ZodNumber>;
            label: z.ZodString;
            sortOrder: z.ZodDefault<z.ZodNumber>;
            active: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodObject<{
                approaches: z.ZodArray<z.ZodObject<{
                    id: z.ZodNumber;
                    label: z.ZodString;
                    sortOrder: z.ZodNumber;
                    active: z.ZodBoolean;
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
            readonly 409: z.ZodObject<{
                error: z.ZodString;
                message: z.ZodString;
                statusCode: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
                statusUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    };
    readonly clientHandoff: {
        readonly auth: {
            readonly kind: "apiKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["client"];
        readonly summary: "The shift handoff of a page: who is in a conversation, whom the team wrote to, who waits, open promises";
        readonly description: string;
        readonly params: z.ZodObject<{
            pageLabel: z.ZodString;
        }, z.core.$strip>;
        readonly response: {
            readonly 200: z.ZodObject<{
                pageLabel: z.ZodString;
                recent: z.ZodArray<z.ZodObject<{
                    fanRef: z.ZodString;
                    conversationRef: z.ZodNullable<z.ZodString>;
                    username: z.ZodNullable<z.ZodString>;
                    alias: z.ZodNullable<z.ZodString>;
                    lastSentAt: z.ZodString;
                    messages: z.ZodNumber;
                    chatters: z.ZodArray<z.ZodString>;
                    inConversation: z.ZodArray<z.ZodString>;
                }, z.core.$strip>>;
                waiting: z.ZodObject<{
                    total: z.ZodNumber;
                    head: z.ZodArray<z.ZodObject<{
                        fanRef: z.ZodString;
                        conversationRef: z.ZodNullable<z.ZodString>;
                        username: z.ZodNullable<z.ZodString>;
                        alias: z.ZodNullable<z.ZodString>;
                        lifetimeGrossMills: z.ZodNumber;
                        lastFanMessageAt: z.ZodString;
                    }, z.core.$strip>>;
                }, z.core.$strip>;
                customs: z.ZodArray<z.ZodObject<{
                    fanRef: z.ZodString;
                    conversationRef: z.ZodNullable<z.ZodString>;
                    description: z.ZodString;
                    state: z.ZodString;
                    paidAt: z.ZodNullable<z.ZodString>;
                    createdAt: z.ZodString;
                }, z.core.$strip>>;
                promises: z.ZodArray<z.ZodObject<{
                    fanRef: z.ZodString;
                    conversationRef: z.ZodString;
                    text: z.ZodString;
                    messageRef: z.ZodString;
                    messageAt: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
                serverNow: z.ZodString;
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
    readonly clientFanCustomCreate: {
        readonly auth: {
            readonly kind: "apiKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["client"];
        readonly summary: "A chatter writes a custom into the fan's record, paid by one of the suggested tips or not yet";
        readonly description: string;
        readonly params: z.ZodObject<{
            pageLabel: z.ZodString;
            fanRef: z.ZodString;
        }, z.core.$strip>;
        readonly body: z.ZodObject<{
            description: z.ZodString;
            priceMills: z.ZodOptional<z.ZodNumber>;
            paymentRef: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodObject<{
                changed: z.ZodBoolean;
                card: z.ZodObject<{
                    pageLabel: z.ZodString;
                    fanRef: z.ZodString;
                    known: z.ZodBoolean;
                    accounts: z.ZodArray<z.ZodObject<{
                        platform: z.ZodString;
                        fanRef: z.ZodString;
                        username: z.ZodNullable<z.ZodString>;
                        displayName: z.ZodNullable<z.ZodString>;
                        gone: z.ZodBoolean;
                        linkedBy: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                    pages: z.ZodArray<z.ZodObject<{
                        pageLabel: z.ZodString;
                        platform: z.ZodString;
                        modelName: z.ZodNullable<z.ZodString>;
                        fanRef: z.ZodString;
                        granted: z.ZodBoolean;
                        alias: z.ZodNullable<z.ZodString>;
                        subscribed: z.ZodBoolean;
                        subscribedSince: z.ZodNullable<z.ZodString>;
                        subscriptionEndsAt: z.ZodNullable<z.ZodString>;
                        spentMills: z.ZodNumber;
                        last30Mills: z.ZodRecord<z.ZodString, z.ZodNumber>;
                        lastPurchaseAt: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                    suggestions: z.ZodArray<z.ZodObject<{
                        platform: z.ZodString;
                        fanRef: z.ZodString;
                        username: z.ZodNullable<z.ZodString>;
                        displayName: z.ZodNullable<z.ZodString>;
                        gone: z.ZodBoolean;
                        reason: z.ZodString;
                        shared: z.ZodString;
                        sharedOn: z.ZodNullable<z.ZodString>;
                        pages: z.ZodArray<z.ZodObject<{
                            pageLabel: z.ZodString;
                            platform: z.ZodString;
                            modelName: z.ZodNullable<z.ZodString>;
                            fanRef: z.ZodString;
                            granted: z.ZodBoolean;
                            alias: z.ZodNullable<z.ZodString>;
                            subscribed: z.ZodBoolean;
                            subscribedSince: z.ZodNullable<z.ZodString>;
                            subscriptionEndsAt: z.ZodNullable<z.ZodString>;
                            spentMills: z.ZodNumber;
                            last30Mills: z.ZodRecord<z.ZodString, z.ZodNumber>;
                            lastPurchaseAt: z.ZodNullable<z.ZodString>;
                        }, z.core.$strip>>;
                    }, z.core.$strip>>;
                    facts: z.ZodArray<z.ZodObject<{
                        id: z.ZodNumber;
                        kind: z.ZodString;
                        text: z.ZodString;
                        pageLabel: z.ZodString;
                        granted: z.ZodBoolean;
                        conversationRef: z.ZodString;
                        messageRef: z.ZodString;
                        messageAt: z.ZodNullable<z.ZodString>;
                        source: z.ZodString;
                        author: z.ZodNullable<z.ZodString>;
                        createdAt: z.ZodString;
                        quote: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                            text: z.ZodString;
                            from: z.ZodString;
                            at: z.ZodString;
                            media: z.ZodBoolean;
                        }, z.core.$strip>>>;
                    }, z.core.$strip>>;
                    customs: z.ZodArray<z.ZodObject<{
                        id: z.ZodNumber;
                        pageLabel: z.ZodString;
                        granted: z.ZodBoolean;
                        description: z.ZodString;
                        priceMills: z.ZodNullable<z.ZodNumber>;
                        state: z.ZodString;
                        paymentMills: z.ZodNullable<z.ZodNumber>;
                        paidAt: z.ZodNullable<z.ZodString>;
                        deliveredMessageRef: z.ZodNullable<z.ZodString>;
                        deliveredAt: z.ZodNullable<z.ZodString>;
                        createdBy: z.ZodString;
                        createdAt: z.ZodString;
                        deliveryCandidates: z.ZodArray<z.ZodObject<{
                            messageRef: z.ZodString;
                            at: z.ZodString;
                            mediaCount: z.ZodNumber;
                            priceMills: z.ZodNullable<z.ZodNumber>;
                        }, z.core.$strip>>;
                    }, z.core.$strip>>;
                    customPayments: z.ZodArray<z.ZodObject<{
                        paymentRef: z.ZodString;
                        amountMills: z.ZodNumber;
                        at: z.ZodString;
                        note: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                    serverNow: z.ZodString;
                }, z.core.$strip>;
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
    readonly clientFanCustomChange: {
        readonly auth: {
            readonly kind: "apiKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["client"];
        readonly summary: "A chatter marks a custom paid, delivered, cancelled, or edits it";
        readonly description: string;
        readonly params: z.ZodObject<{
            pageLabel: z.ZodString;
            fanRef: z.ZodString;
            customId: z.ZodCoercedNumber<unknown>;
        }, z.core.$strip>;
        readonly body: z.ZodDiscriminatedUnion<[z.ZodObject<{
            action: z.ZodLiteral<"paid">;
            paymentRef: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            action: z.ZodLiteral<"delivered">;
            messageRef: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            action: z.ZodLiteral<"cancel">;
        }, z.core.$strict>, z.ZodObject<{
            action: z.ZodLiteral<"edit">;
            description: z.ZodString;
            priceMills: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strict>], "action">;
        readonly response: {
            readonly 200: z.ZodObject<{
                changed: z.ZodBoolean;
                card: z.ZodObject<{
                    pageLabel: z.ZodString;
                    fanRef: z.ZodString;
                    known: z.ZodBoolean;
                    accounts: z.ZodArray<z.ZodObject<{
                        platform: z.ZodString;
                        fanRef: z.ZodString;
                        username: z.ZodNullable<z.ZodString>;
                        displayName: z.ZodNullable<z.ZodString>;
                        gone: z.ZodBoolean;
                        linkedBy: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                    pages: z.ZodArray<z.ZodObject<{
                        pageLabel: z.ZodString;
                        platform: z.ZodString;
                        modelName: z.ZodNullable<z.ZodString>;
                        fanRef: z.ZodString;
                        granted: z.ZodBoolean;
                        alias: z.ZodNullable<z.ZodString>;
                        subscribed: z.ZodBoolean;
                        subscribedSince: z.ZodNullable<z.ZodString>;
                        subscriptionEndsAt: z.ZodNullable<z.ZodString>;
                        spentMills: z.ZodNumber;
                        last30Mills: z.ZodRecord<z.ZodString, z.ZodNumber>;
                        lastPurchaseAt: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                    suggestions: z.ZodArray<z.ZodObject<{
                        platform: z.ZodString;
                        fanRef: z.ZodString;
                        username: z.ZodNullable<z.ZodString>;
                        displayName: z.ZodNullable<z.ZodString>;
                        gone: z.ZodBoolean;
                        reason: z.ZodString;
                        shared: z.ZodString;
                        sharedOn: z.ZodNullable<z.ZodString>;
                        pages: z.ZodArray<z.ZodObject<{
                            pageLabel: z.ZodString;
                            platform: z.ZodString;
                            modelName: z.ZodNullable<z.ZodString>;
                            fanRef: z.ZodString;
                            granted: z.ZodBoolean;
                            alias: z.ZodNullable<z.ZodString>;
                            subscribed: z.ZodBoolean;
                            subscribedSince: z.ZodNullable<z.ZodString>;
                            subscriptionEndsAt: z.ZodNullable<z.ZodString>;
                            spentMills: z.ZodNumber;
                            last30Mills: z.ZodRecord<z.ZodString, z.ZodNumber>;
                            lastPurchaseAt: z.ZodNullable<z.ZodString>;
                        }, z.core.$strip>>;
                    }, z.core.$strip>>;
                    facts: z.ZodArray<z.ZodObject<{
                        id: z.ZodNumber;
                        kind: z.ZodString;
                        text: z.ZodString;
                        pageLabel: z.ZodString;
                        granted: z.ZodBoolean;
                        conversationRef: z.ZodString;
                        messageRef: z.ZodString;
                        messageAt: z.ZodNullable<z.ZodString>;
                        source: z.ZodString;
                        author: z.ZodNullable<z.ZodString>;
                        createdAt: z.ZodString;
                        quote: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                            text: z.ZodString;
                            from: z.ZodString;
                            at: z.ZodString;
                            media: z.ZodBoolean;
                        }, z.core.$strip>>>;
                    }, z.core.$strip>>;
                    customs: z.ZodArray<z.ZodObject<{
                        id: z.ZodNumber;
                        pageLabel: z.ZodString;
                        granted: z.ZodBoolean;
                        description: z.ZodString;
                        priceMills: z.ZodNullable<z.ZodNumber>;
                        state: z.ZodString;
                        paymentMills: z.ZodNullable<z.ZodNumber>;
                        paidAt: z.ZodNullable<z.ZodString>;
                        deliveredMessageRef: z.ZodNullable<z.ZodString>;
                        deliveredAt: z.ZodNullable<z.ZodString>;
                        createdBy: z.ZodString;
                        createdAt: z.ZodString;
                        deliveryCandidates: z.ZodArray<z.ZodObject<{
                            messageRef: z.ZodString;
                            at: z.ZodString;
                            mediaCount: z.ZodNumber;
                            priceMills: z.ZodNullable<z.ZodNumber>;
                        }, z.core.$strip>>;
                    }, z.core.$strip>>;
                    customPayments: z.ZodArray<z.ZodObject<{
                        paymentRef: z.ZodString;
                        amountMills: z.ZodNumber;
                        at: z.ZodString;
                        note: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                    serverNow: z.ZodString;
                }, z.core.$strip>;
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
    readonly teamCustoms: {
        readonly auth: {
            readonly kind: "session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "Open customs of the pages the viewer reaches";
        readonly description: string;
        readonly response: {
            readonly 200: z.ZodObject<{
                customs: z.ZodArray<z.ZodObject<{
                    id: z.ZodNumber;
                    pageLabel: z.ZodString;
                    fanRef: z.ZodString;
                    description: z.ZodString;
                    priceMills: z.ZodNullable<z.ZodNumber>;
                    state: z.ZodString;
                    paidAt: z.ZodNullable<z.ZodString>;
                    createdBy: z.ZodString;
                    createdAt: z.ZodString;
                }, z.core.$strip>>;
                serverNow: z.ZodString;
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
    readonly accountShiftReport: {
        readonly auth: {
            readonly kind: "any-session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "The caller's draft shift reports: their shifts, the sales on their pages and the facts of each";
        readonly description: string;
        readonly querystring: z.ZodObject<{
            days: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
        }, z.core.$strip>;
        readonly response: {
            readonly 200: z.ZodObject<{
                shifts: z.ZodArray<z.ZodObject<{
                    startedAt: z.ZodString;
                    endedAt: z.ZodString;
                    ongoing: z.ZodBoolean;
                    pages: z.ZodArray<z.ZodString>;
                    sales: z.ZodArray<z.ZodObject<{
                        saleRef: z.ZodString;
                        pageLabel: z.ZodString;
                        platform: z.ZodString;
                        kind: z.ZodString;
                        fanRef: z.ZodNullable<z.ZodString>;
                        fanName: z.ZodNullable<z.ZodString>;
                        netMills: z.ZodNumber;
                        occurredAt: z.ZodString;
                        ppvSender: z.ZodNullable<z.ZodString>;
                        ppvWithoutAuthor: z.ZodBoolean;
                        writers: z.ZodArray<z.ZodObject<{
                            username: z.ZodString;
                            messages: z.ZodNumber;
                        }, z.core.$strip>>;
                        withoutAuthor: z.ZodNumber;
                        confirmed: z.ZodBoolean;
                        myMark: z.ZodNullable<z.ZodObject<{
                            mark: z.ZodString;
                            shareWithUserId: z.ZodNullable<z.ZodNumber>;
                            shareWith: z.ZodNullable<z.ZodString>;
                            amountMills: z.ZodNullable<z.ZodNumber>;
                            note: z.ZodNullable<z.ZodString>;
                        }, z.core.$strip>>;
                        otherMarks: z.ZodArray<z.ZodObject<{
                            username: z.ZodString;
                            mark: z.ZodString;
                            shareWith: z.ZodNullable<z.ZodString>;
                        }, z.core.$strip>>;
                    }, z.core.$strip>>;
                    creditedMills: z.ZodNumber;
                    unmarked: z.ZodNumber;
                    pending: z.ZodNumber;
                    confirmedAt: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
                sharedWithMe: z.ZodArray<z.ZodObject<{
                    saleRef: z.ZodString;
                    pageLabel: z.ZodString;
                    platform: z.ZodString;
                    kind: z.ZodString;
                    fanRef: z.ZodNullable<z.ZodString>;
                    fanName: z.ZodNullable<z.ZodString>;
                    netMills: z.ZodNumber;
                    occurredAt: z.ZodString;
                    ppvSender: z.ZodNullable<z.ZodString>;
                    ppvWithoutAuthor: z.ZodBoolean;
                    writers: z.ZodArray<z.ZodObject<{
                        username: z.ZodString;
                        messages: z.ZodNumber;
                    }, z.core.$strip>>;
                    withoutAuthor: z.ZodNumber;
                    confirmed: z.ZodBoolean;
                    myMark: z.ZodNullable<z.ZodObject<{
                        mark: z.ZodString;
                        shareWithUserId: z.ZodNullable<z.ZodNumber>;
                        shareWith: z.ZodNullable<z.ZodString>;
                        amountMills: z.ZodNullable<z.ZodNumber>;
                        note: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                    otherMarks: z.ZodArray<z.ZodObject<{
                        username: z.ZodString;
                        mark: z.ZodString;
                        shareWith: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                teammates: z.ZodArray<z.ZodObject<{
                    userId: z.ZodNumber;
                    username: z.ZodString;
                }, z.core.$strip>>;
                serverNow: z.ZodString;
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
    readonly accountShiftReportMark: {
        readonly auth: {
            readonly kind: "any-session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "The caller marks a sale of their shift «моё», «делим с …» or «не моё», maybe with their own amount";
        readonly description: string;
        readonly body: z.ZodObject<{
            saleRef: z.ZodString;
            mark: z.ZodEnum<{
                mine: "mine";
                share: "share";
                not_mine: "not_mine";
            }>;
            shareWithUserId: z.ZodOptional<z.ZodNumber>;
            amountMills: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodObject<{
                changed: z.ZodBoolean;
                serverNow: z.ZodString;
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
    readonly accountShiftReportConfirm: {
        readonly auth: {
            readonly kind: "any-session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "The caller confirms the report of an ended shift: its lines go to the payout export as they stand";
        readonly description: string;
        readonly body: z.ZodObject<{
            startedAt: z.ZodString;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodObject<{
                changed: z.ZodBoolean;
                serverNow: z.ZodString;
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
    readonly teamShiftDisputes: {
        readonly auth: {
            readonly kind: "session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "Sales of the last days whose marks do not agree, with the owner's decision when made";
        readonly description: "The owner and team leads, for the pages they reach. Two «моё», or «делим с X» that X did not answer with «делим» back.";
        readonly querystring: z.ZodObject<{
            days: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
        }, z.core.$strip>;
        readonly response: {
            readonly 200: z.ZodObject<{
                disputes: z.ZodArray<z.ZodObject<{
                    saleRef: z.ZodString;
                    pageLabel: z.ZodString;
                    platform: z.ZodString;
                    fanRef: z.ZodNullable<z.ZodString>;
                    occurredAt: z.ZodString;
                    netMills: z.ZodNumber;
                    reason: z.ZodString;
                    marks: z.ZodArray<z.ZodObject<{
                        userId: z.ZodNumber;
                        username: z.ZodString;
                        mark: z.ZodString;
                        shareWithUserId: z.ZodNullable<z.ZodNumber>;
                        shareWith: z.ZodNullable<z.ZodString>;
                        amountMills: z.ZodNullable<z.ZodNumber>;
                    }, z.core.$strip>>;
                    people: z.ZodArray<z.ZodObject<{
                        userId: z.ZodNumber;
                        username: z.ZodString;
                    }, z.core.$strip>>;
                    resolution: z.ZodNullable<z.ZodArray<z.ZodObject<{
                        userId: z.ZodNumber;
                        username: z.ZodString;
                        percent: z.ZodNumber;
                    }, z.core.$strip>>>;
                }, z.core.$strip>>;
                serverNow: z.ZodString;
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
    readonly teamShiftResolve: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "The owner splits a disputed sale between chatters";
        readonly description: string;
        readonly params: z.ZodObject<{
            saleRef: z.ZodString;
        }, z.core.$strip>;
        readonly body: z.ZodObject<{
            shares: z.ZodArray<z.ZodObject<{
                userId: z.ZodNumber;
                percent: z.ZodNumber;
            }, z.core.$strip>>;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodObject<{
                changed: z.ZodBoolean;
                serverNow: z.ZodString;
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
    readonly teamShiftExport: {
        readonly auth: {
            readonly kind: "session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "The payout export: confirmed shift reports as chatter × page × day → net";
        readonly description: string;
        readonly querystring: z.ZodObject<{
            from: z.ZodString;
            to: z.ZodString;
        }, z.core.$strip>;
        readonly response: {
            readonly 200: z.ZodObject<{
                from: z.ZodString;
                to: z.ZodString;
                rows: z.ZodArray<z.ZodObject<{
                    username: z.ZodString;
                    pageLabel: z.ZodString;
                    platform: z.ZodString;
                    shiftDate: z.ZodString;
                    creditedMills: z.ZodNumber;
                }, z.core.$strip>>;
                disputedOpen: z.ZodNumber;
                ownAmounts: z.ZodArray<z.ZodObject<{
                    username: z.ZodString;
                    pageLabel: z.ZodString;
                    saleRef: z.ZodString;
                    occurredAt: z.ZodString;
                    netMills: z.ZodNumber;
                    amountMills: z.ZodNumber;
                }, z.core.$strip>>;
                unconfirmed: z.ZodArray<z.ZodObject<{
                    username: z.ZodString;
                    startedAt: z.ZodString;
                    endedAt: z.ZodString;
                    ongoing: z.ZodBoolean;
                }, z.core.$strip>>;
                lateChanges: z.ZodArray<z.ZodObject<{
                    username: z.ZodString;
                    pageLabel: z.ZodString;
                    saleRef: z.ZodString;
                    occurredAt: z.ZodString;
                    payDay: z.ZodString;
                    creditedMills: z.ZodNumber;
                    change: z.ZodEnum<{
                        added: "added";
                        removed: "removed";
                    }>;
                    at: z.ZodString;
                }, z.core.$strip>>;
                serverNow: z.ZodString;
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
    readonly teamChatterNumbers: {
        readonly auth: {
            readonly kind: "session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "The eight numbers of each chatter's shifts and week";
        readonly description: string;
        readonly querystring: z.ZodObject<{
            from: z.ZodOptional<z.ZodString>;
            to: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
        readonly response: {
            readonly 200: z.ZodObject<{
                from: z.ZodString;
                to: z.ZodString;
                chatters: z.ZodArray<z.ZodObject<{
                    userId: z.ZodNumber;
                    username: z.ZodString;
                    week: z.ZodObject<{
                        workedMinutes: z.ZodNumber;
                        revenueMills: z.ZodNullable<z.ZodNumber>;
                        revenuePerHourMills: z.ZodNullable<z.ZodNumber>;
                        fansWritten: z.ZodNumber;
                        fansPaid: z.ZodNumber;
                        messages: z.ZodNumber;
                        ppvSent: z.ZodNumber;
                        ppvBought: z.ZodNumber;
                        ppvAveragePriceMills: z.ZodNullable<z.ZodNumber>;
                        ppvShare: z.ZodNullable<z.ZodNumber>;
                        replies: z.ZodNumber;
                        replyMedianSeconds: z.ZodNullable<z.ZodNumber>;
                        repliesWithinHour: z.ZodNumber;
                        waitingAtEnd: z.ZodNumber;
                        composed: z.ZodObject<{
                            hand: z.ZodNumber;
                            reply: z.ZodNumber;
                            fix: z.ZodNumber;
                            other: z.ZodNumber;
                        }, z.core.$strip>;
                        shifts: z.ZodNumber;
                        unconfirmedShifts: z.ZodNumber;
                    }, z.core.$strip>;
                    shifts: z.ZodArray<z.ZodObject<{
                        startedAt: z.ZodString;
                        endedAt: z.ZodString;
                        ongoing: z.ZodBoolean;
                        pages: z.ZodArray<z.ZodString>;
                        confirmed: z.ZodBoolean;
                        numbers: z.ZodObject<{
                            workedMinutes: z.ZodNumber;
                            revenueMills: z.ZodNullable<z.ZodNumber>;
                            revenuePerHourMills: z.ZodNullable<z.ZodNumber>;
                            fansWritten: z.ZodNumber;
                            fansPaid: z.ZodNumber;
                            messages: z.ZodNumber;
                            ppvSent: z.ZodNumber;
                            ppvBought: z.ZodNumber;
                            ppvAveragePriceMills: z.ZodNullable<z.ZodNumber>;
                            ppvShare: z.ZodNullable<z.ZodNumber>;
                            replies: z.ZodNumber;
                            replyMedianSeconds: z.ZodNullable<z.ZodNumber>;
                            repliesWithinHour: z.ZodNumber;
                            waitingAtEnd: z.ZodNumber;
                            composed: z.ZodObject<{
                                hand: z.ZodNumber;
                                reply: z.ZodNumber;
                                fix: z.ZodNumber;
                                other: z.ZodNumber;
                            }, z.core.$strip>;
                        }, z.core.$strip>;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                serverNow: z.ZodString;
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
    readonly teamSalesPpv: {
        readonly auth: {
            readonly kind: "session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "PPV conversion by page, chatter and price";
        readonly description: string;
        readonly querystring: z.ZodObject<{
            days: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
        }, z.core.$strip>;
        readonly response: {
            readonly 200: z.ZodObject<{
                from: z.ZodString;
                to: z.ZodString;
                pages: z.ZodArray<z.ZodObject<{
                    pageLabel: z.ZodString;
                    platform: z.ZodString;
                    total: z.ZodObject<{
                        sent: z.ZodNumber;
                        bought: z.ZodNumber;
                        netMills: z.ZodNumber;
                    }, z.core.$strip>;
                    byPrice: z.ZodArray<z.ZodObject<{
                        sent: z.ZodNumber;
                        bought: z.ZodNumber;
                        netMills: z.ZodNumber;
                        bucket: z.ZodString;
                    }, z.core.$strip>>;
                    firstPpv: z.ZodArray<z.ZodObject<{
                        sent: z.ZodNumber;
                        bought: z.ZodNumber;
                        netMills: z.ZodNumber;
                        bucket: z.ZodString;
                    }, z.core.$strip>>;
                    withoutAuthor: z.ZodNumber;
                }, z.core.$strip>>;
                chatters: z.ZodArray<z.ZodObject<{
                    userId: z.ZodNumber;
                    username: z.ZodString;
                    total: z.ZodObject<{
                        sent: z.ZodNumber;
                        bought: z.ZodNumber;
                        netMills: z.ZodNumber;
                    }, z.core.$strip>;
                    byPrice: z.ZodArray<z.ZodObject<{
                        sent: z.ZodNumber;
                        bought: z.ZodNumber;
                        netMills: z.ZodNumber;
                        bucket: z.ZodString;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                serverNow: z.ZodString;
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
    readonly teamSalesReplies: {
        readonly auth: {
            readonly kind: "session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "How fast the page answered a fan, against whether the fan bought within 24 hours";
        readonly description: string;
        readonly querystring: z.ZodObject<{
            days: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
        }, z.core.$strip>;
        readonly response: {
            readonly 200: z.ZodObject<{
                from: z.ZodString;
                to: z.ZodString;
                pages: z.ZodArray<z.ZodObject<{
                    pageLabel: z.ZodString;
                    platform: z.ZodString;
                    total: z.ZodObject<{
                        replies: z.ZodNumber;
                        bought: z.ZodNumber;
                    }, z.core.$strip>;
                    byDelay: z.ZodArray<z.ZodObject<{
                        replies: z.ZodNumber;
                        bought: z.ZodNumber;
                        bucket: z.ZodString;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                chatters: z.ZodArray<z.ZodObject<{
                    userId: z.ZodNumber;
                    username: z.ZodString;
                    total: z.ZodObject<{
                        replies: z.ZodNumber;
                        bought: z.ZodNumber;
                    }, z.core.$strip>;
                    byDelay: z.ZodArray<z.ZodObject<{
                        replies: z.ZodNumber;
                        bought: z.ZodNumber;
                        bucket: z.ZodString;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                serverNow: z.ZodString;
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
    readonly clientAudienceNew: {
        readonly auth: {
            readonly kind: "apiKey";
            readonly scope: "page";
        };
        readonly tags: readonly ["client"];
        readonly summary: "Who subscribed to an OnlyFans page or came back, inside a window of hours, with each fan's greeting state";
        readonly description: string;
        readonly params: z.ZodObject<{
            pageLabel: z.ZodString;
        }, z.core.$strip>;
        readonly querystring: z.ZodObject<{
            windowHours: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
            cursor: z.ZodOptional<z.ZodString>;
            limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodObject<{
                pageLabel: z.ZodString;
                window: z.ZodObject<{
                    hours: z.ZodNumber;
                    from: z.ZodString;
                    to: z.ZodString;
                    snapshotAt: z.ZodString;
                }, z.core.$strip>;
                serverNow: z.ZodString;
                coverage: z.ZodObject<{
                    state: z.ZodString;
                    deliveryFrontier: z.ZodNullable<z.ZodString>;
                    lastAudienceSweepAt: z.ZodNullable<z.ZodString>;
                    reasons: z.ZodArray<z.ZodString>;
                }, z.core.$strip>;
                unknownCount: z.ZodNumber;
                welcomeTemplate: z.ZodNullable<z.ZodObject<{
                    ref: z.ZodString;
                    observedAt: z.ZodString;
                    enabled: z.ZodNullable<z.ZodBoolean>;
                    hasText: z.ZodBoolean;
                    hasMedia: z.ZodBoolean;
                    priceMills: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strip>>;
                items: z.ZodArray<z.ZodObject<{
                    eventRef: z.ZodString;
                    fanRef: z.ZodString;
                    username: z.ZodNullable<z.ZodString>;
                    displayName: z.ZodNullable<z.ZodString>;
                    kind: z.ZodString;
                    trial: z.ZodBoolean;
                    subscribedAt: z.ZodString;
                    subscribedAtSource: z.ZodString;
                    status: z.ZodObject<{
                        isSubscriber: z.ZodNullable<z.ZodBoolean>;
                        subscriptionStatus: z.ZodString;
                        endsAt: z.ZodNullable<z.ZodString>;
                        asOf: z.ZodNullable<z.ZodString>;
                        source: z.ZodString;
                    }, z.core.$strip>;
                    thread: z.ZodNullable<z.ZodObject<{
                        lastMessageAt: z.ZodNullable<z.ZodString>;
                        lastFanMessageAt: z.ZodNullable<z.ZodString>;
                        lastModelMessageAt: z.ZodNullable<z.ZodString>;
                        storedMessageCount: z.ZodNumber;
                        coverage: z.ZodString;
                        backfillComplete: z.ZodBoolean;
                    }, z.core.$strip>>;
                    lastPersonalSendAt: z.ZodNullable<z.ZodString>;
                    claim: z.ZodObject<{
                        greeting: z.ZodEnum<{
                            none: "none";
                            confirmed: "confirmed";
                        }>;
                        lease: z.ZodEnum<{
                            none: "none";
                            expired: "expired";
                            owned: "owned";
                            held: "held";
                            released: "released";
                        }>;
                        heldBy: z.ZodNullable<z.ZodEnum<{
                            "you-elsewhere": "you-elsewhere";
                            "someone-else": "someone-else";
                        }>>;
                        custody: z.ZodNullable<z.ZodEnum<{
                            failed: "failed";
                            dispatching: "dispatching";
                            sent: "sent";
                            "uncertain-held": "uncertain-held";
                            "resolved-sent": "resolved-sent";
                            "resolved-not-sent": "resolved-not-sent";
                        }>>;
                    }, z.core.$strip>;
                }, z.core.$strip>>;
                nextCursor: z.ZodNullable<z.ZodString>;
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
    readonly clientSendCustodyResolve: {
        readonly auth: {
            readonly kind: "session";
            readonly scope: "page";
        };
        readonly tags: readonly ["client"];
        readonly summary: "Resolve a held chat-extension send by hand: sent or not sent, with a note";
        readonly description: string;
        readonly params: z.ZodObject<{
            pageLabel: z.ZodString;
            attemptId: z.ZodString;
        }, z.core.$strip>;
        readonly body: z.ZodObject<{
            outcome: z.ZodEnum<{
                sent: "sent";
                not_sent: "not_sent";
            }>;
            platformMessageId: z.ZodOptional<z.ZodString>;
            note: z.ZodString;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodObject<{
                attemptId: z.ZodString;
                fanRef: z.ZodString;
                userId: z.ZodNumber;
                purpose: z.ZodString;
                state: z.ZodString;
                generationRef: z.ZodString;
                partIndex: z.ZodNumber;
                partCount: z.ZodNumber;
                createdAt: z.ZodString;
                ticketExpiresAt: z.ZodNullable<z.ZodString>;
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
    readonly clientSendCustodyList: {
        readonly auth: {
            readonly kind: "session";
        };
        readonly tags: readonly ["client"];
        readonly summary: "Held chat-extension sends of the pages the viewer reaches, and the ones resolved by hand";
        readonly description: string;
        readonly querystring: z.ZodObject<{
            state: z.ZodDefault<z.ZodEnum<{
                held: "held";
                resolved: "resolved";
            }>>;
            pageLabel: z.ZodOptional<z.ZodString>;
            limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
            offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodObject<{
                items: z.ZodArray<z.ZodObject<{
                    attemptId: z.ZodString;
                    fanRef: z.ZodString;
                    userId: z.ZodNumber;
                    purpose: z.ZodString;
                    state: z.ZodString;
                    generationRef: z.ZodString;
                    partIndex: z.ZodNumber;
                    partCount: z.ZodNumber;
                    createdAt: z.ZodString;
                    ticketExpiresAt: z.ZodNullable<z.ZodString>;
                    pageLabel: z.ZodString;
                    variant: z.ZodNumber;
                    username: z.ZodString;
                    instanceId: z.ZodString;
                    updatedAt: z.ZodString;
                    greeting: z.ZodObject<{
                        state: z.ZodString;
                        at: z.ZodNullable<z.ZodString>;
                        source: z.ZodNullable<z.ZodString>;
                        firstPartIsThisAttempt: z.ZodBoolean;
                    }, z.core.$strip>;
                    resolution: z.ZodNullable<z.ZodObject<{
                        outcome: z.ZodString;
                        at: z.ZodString;
                        userId: z.ZodNumber;
                        username: z.ZodString;
                        note: z.ZodString;
                        platformMessageId: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                limit: z.ZodNumber;
                offset: z.ZodNumber;
                total: z.ZodNumber;
                serverNow: z.ZodString;
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
    readonly adminClientHealth: {
        readonly auth: {
            readonly kind: "owner-session";
        };
        readonly tags: readonly ["admin"];
        readonly summary: "Owner view of the chat extension's health: speed, host contract, counters and footprint by client version";
        readonly description: string;
        readonly querystring: z.ZodObject<{
            from: z.ZodString;
            to: z.ZodString;
            clientName: z.ZodOptional<z.ZodString>;
            metric: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
        readonly response: {
            readonly 200: z.ZodObject<{
                range: z.ZodObject<{
                    from: z.ZodString;
                    to: z.ZodString;
                    timeZone: z.ZodString;
                }, z.core.$strip>;
                minGroupSize: z.ZodNumber;
                perf: z.ZodArray<z.ZodObject<{
                    clientName: z.ZodString;
                    clientVersion: z.ZodString;
                    hostKind: z.ZodString;
                    hostBuild: z.ZodNullable<z.ZodString>;
                    metric: z.ZodString;
                    schemaVersion: z.ZodNumber;
                    count: z.ZodNumber;
                    mean: z.ZodNullable<z.ZodNumber>;
                    max: z.ZodNullable<z.ZodNumber>;
                    p50: z.ZodNullable<z.ZodNumber>;
                    p95: z.ZodNullable<z.ZodNumber>;
                    suppressed: z.ZodBoolean;
                }, z.core.$strip>>;
                contract: z.ZodArray<z.ZodObject<{
                    clientVersion: z.ZodString;
                    hostBuild: z.ZodNullable<z.ZodString>;
                    reports: z.ZodNumber;
                    failedReports: z.ZodNumber;
                    missing: z.ZodArray<z.ZodObject<{
                        anchor: z.ZodString;
                        reports: z.ZodNumber;
                    }, z.core.$strip>>;
                }, z.core.$strip>>;
                counters: z.ZodArray<z.ZodObject<{
                    code: z.ZodString;
                    total: z.ZodNumber;
                }, z.core.$strip>>;
                footprint: z.ZodArray<z.ZodObject<{
                    clientVersion: z.ZodString;
                    cachesKBp95: z.ZodNullable<z.ZodNumber>;
                    logsKBp95: z.ZodNullable<z.ZodNumber>;
                    domNodesP95: z.ZodNullable<z.ZodNumber>;
                }, z.core.$strip>>;
                asOf: z.ZodString;
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
};
export type ClientFeatureAvailability = z.infer<typeof clientFeatureAvailabilitySchema>;
export type ClientReceiptProfile = z.infer<typeof clientReceiptProfileSchema>;
export type ClientBootstrapPage = z.infer<typeof clientBootstrapPageSchema>;
export type ClientBootstrapLimits = z.infer<typeof clientBootstrapLimitsSchema>;
export type ClientBootstrapResponse = z.infer<typeof clientBootstrapResponseSchema>;
export type ClientConversationRecapsQuery = z.infer<typeof clientConversationRecapsQuerySchema>;
export type ClientRecapBody = z.infer<typeof clientRecapBodySchema>;
export type ClientConversationRecapsResponse = z.infer<typeof clientConversationRecapsResponseSchema>;
export type ClientFanProfileFromGenerationBody = z.infer<typeof clientFanProfileFromGenerationBodySchema>;
export type ClientFanProfileFromGenerationResponse = z.infer<typeof clientFanProfileFromGenerationResponseSchema>;
export type ClientConversationFeedQuery = z.infer<typeof clientConversationFeedQuerySchema>;
export type ClientFeedItem = z.infer<typeof clientFeedItemSchema>;
export type ClientFeedHead = z.infer<typeof clientFeedHeadSchema>;
export type ClientFeedSummary = z.infer<typeof clientFeedSummarySchema>;
export type ClientFeedDepth = z.infer<typeof clientFeedDepthSchema>;
export type ClientConversationFeedResponse = z.infer<typeof clientConversationFeedResponseSchema>;
export type ClientAiUsageQuery = z.infer<typeof clientAiUsageQuerySchema>;
export type ClientAiUsageTotals = z.infer<typeof clientAiUsageTotalsSchema>;
export type ClientAiUsageDay = z.infer<typeof clientAiUsageDaySchema>;
export type ClientAiUsageResponse = z.infer<typeof clientAiUsageResponseSchema>;
export type ClientSpenderStatsQuery = z.infer<typeof clientSpenderStatsQuerySchema>;
export type ClientSpenderStatsMoneyWindow = z.infer<typeof clientSpenderStatsMoneyWindowSchema>;
export type ClientSpenderStatsResponse = z.infer<typeof clientSpenderStatsResponseSchema>;
export type ClientSpenderAwaitingReplyQuery = z.infer<typeof clientSpenderAwaitingReplyQuerySchema>;
export type ClientSpenderAwaitingReplyItem = z.infer<typeof clientSpenderAwaitingReplyItemSchema>;
export type ClientSpenderAwaitingReplyResponse = z.infer<typeof clientSpenderAwaitingReplyResponseSchema>;
export type ClientClaimGroup = z.infer<typeof clientClaimGroupSchema>;
export type ClientManualClaimGroup = z.infer<typeof clientManualClaimGroupSchema>;
export type ClientClaimSendGroup = z.infer<typeof clientClaimSendGroupSchema>;
export type ClientFanClaimBody = z.infer<typeof clientFanClaimBodySchema>;
export type ClientFanClaimResponse = z.infer<typeof clientFanClaimResponseSchema>;
export type ClientSendCustodyResolveBody = z.infer<typeof clientSendCustodyResolveBodySchema>;
export type ClientSendCustodyItem = z.infer<typeof clientSendCustodyItemSchema>;
export type ClientSendCustodyListQuery = z.infer<typeof clientSendCustodyListQuerySchema>;
export type ClientSendCustodyListItem = z.infer<typeof clientSendCustodyListItemSchema>;
export type ClientSendCustodyListResponse = z.infer<typeof clientSendCustodyListResponseSchema>;
export type ClientSendAttributionFact = z.infer<typeof clientSendAttributionFactSchema>;
export type ClientSendAttributionsBody = z.infer<typeof clientSendAttributionsBodySchema>;
export type ClientActivityBody = z.infer<typeof clientActivityBodySchema>;
export type ClientActivityResponse = z.infer<typeof clientActivityResponseSchema>;
export type TeamShiftsQuery = z.infer<typeof teamShiftsQuerySchema>;
export type TeamShift = z.infer<typeof teamShiftSchema>;
export type TeamShiftsResponse = z.infer<typeof teamShiftsResponseSchema>;
export type ClientInConversationResponse = z.infer<typeof clientInConversationResponseSchema>;
export type TeamAuthorshipQuery = z.infer<typeof teamAuthorshipQuerySchema>;
export type TeamAuthorshipResponse = z.infer<typeof teamAuthorshipResponseSchema>;
export type TeamCoverageQuery = z.infer<typeof teamCoverageQuerySchema>;
export type TeamEmptyHoursResponse = z.infer<typeof teamEmptyHoursResponseSchema>;
export type TeamGreetingsResponse = z.infer<typeof teamGreetingsResponseSchema>;
export type ChatterNumbers = z.infer<typeof chatterNumbersSchema>;
export type TeamChatterNumbersResponse = z.infer<typeof teamChatterNumbersResponseSchema>;
export type TeamSalesQuery = z.infer<typeof teamSalesQuerySchema>;
export type TeamSalesPpvResponse = z.infer<typeof teamSalesPpvResponseSchema>;
export type TeamSalesRepliesResponse = z.infer<typeof teamSalesRepliesResponseSchema>;
export type ShiftReportSale = z.infer<typeof shiftReportSaleSchema>;
export type AccountShiftReportResponse = z.infer<typeof accountShiftReportResponseSchema>;
export type AccountShiftReportMarkBody = z.infer<typeof accountShiftReportMarkBodySchema>;
export type AccountShiftReportChangeResponse = z.infer<typeof accountShiftReportChangeResponseSchema>;
export type TeamShiftDisputesResponse = z.infer<typeof teamShiftDisputesResponseSchema>;
export type TeamShiftResolveBody = z.infer<typeof teamShiftResolveBodySchema>;
export type TeamShiftExportResponse = z.infer<typeof teamShiftExportResponseSchema>;
export type ClientFanCustom = z.infer<typeof clientFanCustomSchema>;
export type ClientFanCustomCreateBody = z.infer<typeof clientFanCustomCreateBodySchema>;
export type ClientFanCustomChangeBody = z.infer<typeof clientFanCustomChangeBodySchema>;
export type TeamCustomsResponse = z.infer<typeof teamCustomsResponseSchema>;
export type ClientHandoffResponse = z.infer<typeof clientHandoffResponseSchema>;
export type ClientWinBackResponse = z.infer<typeof clientWinBackResponseSchema>;
export type ClientWinBackAttemptBody = z.infer<typeof clientWinBackAttemptBodySchema>;
export type ClientWinBackAttemptResponse = z.infer<typeof clientWinBackAttemptResponseSchema>;
export type ClientOnlineQuery = z.infer<typeof clientOnlineQuerySchema>;
export type ClientOnlineItem = z.infer<typeof clientOnlineItemSchema>;
export type ClientOnlineResponse = z.infer<typeof clientOnlineResponseSchema>;
export type ClientOnlinePresenceBody = z.infer<typeof clientOnlinePresenceBodySchema>;
export type ClientOnlinePresenceResponse = z.infer<typeof clientOnlinePresenceResponseSchema>;
export type ClientOnlineAttemptBody = z.infer<typeof clientOnlineAttemptBodySchema>;
export type ClientOnlineAttemptResponse = z.infer<typeof clientOnlineAttemptResponseSchema>;
export type TeamWinBackResultsQuery = z.infer<typeof teamWinBackResultsQuerySchema>;
export type TeamWinBackResultsResponse = z.infer<typeof teamWinBackResultsResponseSchema>;
export type TeamWinBackApproachesResponse = z.infer<typeof teamWinBackApproachesResponseSchema>;
export type TeamWinBackApproachSaveBody = z.infer<typeof teamWinBackApproachSaveBodySchema>;
export type ClientFanCardPage = z.infer<typeof clientFanCardPageSchema>;
export type ClientFanCardResponse = z.infer<typeof clientFanCardResponseSchema>;
export type ClientFanLinkDecideBody = z.infer<typeof clientFanLinkDecideBodySchema>;
export type ClientFanLinkDecideResponse = z.infer<typeof clientFanLinkDecideResponseSchema>;
export type ClientFanFact = z.infer<typeof clientFanFactSchema>;
export type ClientFanFactQuote = z.infer<typeof clientFanFactQuoteSchema>;
export type ClientFanFactChangeBody = z.infer<typeof clientFanFactChangeBodySchema>;
export type ClientFanFactChangeResponse = z.infer<typeof clientFanFactChangeResponseSchema>;
export type ClientSendAttributionsResponse = z.infer<typeof clientSendAttributionsResponseSchema>;
export type ClientAudienceNewQuery = z.infer<typeof clientAudienceNewQuerySchema>;
export type ClientClaimSummary = z.infer<typeof clientClaimSummarySchema>;
export type ClientAudienceNewItem = z.infer<typeof clientAudienceNewItemSchema>;
export type ClientAudienceNewResponse = z.infer<typeof clientAudienceNewResponseSchema>;
export type AdminClientHealthQuery = z.infer<typeof adminClientHealthQuerySchema>;
export type AdminClientHealthResponse = z.infer<typeof adminClientHealthResponseSchema>;
/** The `ingestObservations` event kind of a health report. */
export declare const CLIENT_HEALTH_INGEST_KIND = "client_health";
/**
 * A code, never free text (the client's HEALTH_CODE_PATTERN): error and P1
 * codes, contract anchors, switched-off features, metric names, the host kind.
 */
export declare const CLIENT_HEALTH_CODE_PATTERN: RegExp;
/**
 * The perf metrics and the fixed upper bounds (ms) of their buckets: the client
 * builds every histogram from these, and the hub checks a histogram against
 * them before it merges one. The first eleven are as the client froze them
 * (`PERF_METRICS`, contracts v1.0.0); the hub holds the Fansly ones below first,
 * and the client adopts the same names and bounds before it sends them.
 *
 * Buckets: a histogram with n bounds has n + 1 counts. counts[0] holds values
 * ≤ bounds[0]; counts[i] values in (bounds[i-1], bounds[i]]; counts[n] values
 * above bounds[n-1] (that bucket tops out at the histogram's `max`).
 *
 * A metric names no host: the intake keys every rollup row by the report's
 * host kind and build, so one metric measured on two host pages is two rows
 * and never one set of buckets.
 *
 * The bounds and meaning of one (metric, schemaVersion) never change: new
 * bounds or a new meaning are a new schemaVersion, and the registry is
 * append-only.
 */
export declare const CLIENT_HEALTH_PERF_METRICS: {
    /** Route change → dock updated. */
    readonly routeToDockMs: {
        readonly unit: "ms";
        readonly schemaVersion: 1;
        readonly bounds: readonly [1, 2, 4, 8, 16, 32, 50, 75, 100, 150, 250, 500, 1000];
    };
    /** Hotkey or click → visible response. */
    readonly panelOpenMs: {
        readonly unit: "ms";
        readonly schemaVersion: 1;
        readonly bounds: readonly [4, 8, 16, 32, 50, 75, 100, 150, 250, 500, 1000, 2500];
    };
    /** Click → request sent: the client's own overhead. */
    readonly requestOverheadMs: {
        readonly unit: "ms";
        readonly schemaVersion: 1;
        readonly bounds: readonly [1, 2, 4, 8, 16, 32, 50, 100, 250, 500];
    };
    /** Click → first chunk, end to end (provider latency included). */
    readonly ttfcMs: {
        readonly unit: "ms";
        readonly schemaVersion: 1;
        readonly bounds: readonly [250, 500, 1000, 1500, 2000, 3000, 4000, 6000, 8000, 12000, 20000, 30000, 60000];
    };
    /** First chunk → painted. */
    readonly firstChunkPaintMs: {
        readonly unit: "ms";
        readonly schemaVersion: 1;
        readonly bounds: readonly [4, 8, 16, 32, 50, 75, 100, 150, 250, 500];
    };
    /** Guarded insert with verification. */
    readonly insertMs: {
        readonly unit: "ms";
        readonly schemaVersion: 1;
        readonly bounds: readonly [4, 8, 16, 32, 50, 75, 100, 150, 250, 500, 1000];
    };
    /** Board open from cache. */
    readonly boardOpenMs: {
        readonly unit: "ms";
        readonly schemaVersion: 1;
        readonly bounds: readonly [8, 16, 32, 50, 75, 100, 150, 250, 500, 1000, 2500];
    };
    /** Search over up to 1000 rows. */
    readonly searchMs: {
        readonly unit: "ms";
        readonly schemaVersion: 1;
        readonly bounds: readonly [1, 2, 4, 8, 16, 32, 50, 100, 250, 500];
    };
    /** The client's synchronous handlers, sampled 1 in 20. */
    readonly handlerMs: {
        readonly unit: "ms";
        readonly schemaVersion: 1;
        readonly bounds: readonly [0.1, 0.5, 1, 2, 4, 8, 16, 50, 100];
    };
    /** Event Timing of the client's hotkeys and clicks → next paint. */
    readonly eventLatencyMs: {
        readonly unit: "ms";
        readonly schemaVersion: 1;
        readonly bounds: readonly [8, 16, 24, 32, 50, 75, 100, 150, 250, 500, 1000];
    };
    /** Input delay in the host's composer with the extension on. */
    readonly composerInputDelayMs: {
        readonly unit: "ms";
        readonly schemaVersion: 1;
        readonly bounds: readonly [1, 2, 4, 8, 16, 32, 50, 100, 250];
    };
    /** One socket frame of the host page parsed by the client's tap in the page. */
    readonly frameParseMs: {
        readonly unit: "ms";
        readonly schemaVersion: 1;
        readonly bounds: readonly [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 16, 50, 100];
    };
    /** One XHR response of the host page parsed by the client's observer: one task, deferred or not. */
    readonly xhrParseMs: {
        readonly unit: "ms";
        readonly schemaVersion: 1;
        readonly bounds: readonly [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 16, 50, 100];
    };
    /** The generation snapshot's one synchronous step in the page. */
    readonly snapshotMs: {
        readonly unit: "ms";
        readonly schemaVersion: 1;
        readonly bounds: readonly [0.1, 0.25, 0.5, 1, 2, 3, 4, 5, 8, 16, 32, 50, 100, 250];
    };
    /** Click → the generation request ready, the snapshot's round trip through the page included. */
    readonly snapshotRoundTripMs: {
        readonly unit: "ms";
        readonly schemaVersion: 1;
        readonly bounds: readonly [1, 2, 5, 8, 16, 32, 50, 75, 100, 150, 250, 500, 1000, 2500, 5000];
    };
};
export type ClientHealthPerfMetricName = keyof typeof CLIENT_HEALTH_PERF_METRICS;
/**
 * One perf metric over the report window. Percentiles are the hub's job: it
 * computes them from buckets merged across reports, never from the client's.
 */
export declare const clientHealthPerfHistogramSchema: z.ZodObject<{
    metric: z.ZodString;
    unit: z.ZodLiteral<"ms">;
    schemaVersion: z.ZodNumber;
    bounds: z.ZodArray<z.ZodNumber>;
    counts: z.ZodArray<z.ZodNumber>;
    count: z.ZodNumber;
    sum: z.ZodNumber;
    max: z.ZodNumber;
}, z.core.$strict>;
export declare const clientHealthReportV1Schema: z.ZodObject<{
    v: z.ZodLiteral<1>;
    window: z.ZodObject<{
        from: z.ZodString;
        to: z.ZodString;
    }, z.core.$strict>;
    client: z.ZodObject<{
        name: z.ZodLiteral<"chat-extension">;
        version: z.ZodString;
        browser: z.ZodLiteral<"firefox">;
        browserMajor: z.ZodNumber;
        os: z.ZodEnum<{
            other: "other";
            windows: "windows";
            macos: "macos";
            linux: "linux";
        }>;
    }, z.core.$strict>;
    host: z.ZodObject<{
        kind: z.ZodString;
        build: z.ZodNullable<z.ZodString>;
        contractOk: z.ZodBoolean;
        missing: z.ZodArray<z.ZodString>;
    }, z.core.$strict>;
    disabled: z.ZodArray<z.ZodString>;
    perf: z.ZodArray<z.ZodObject<{
        metric: z.ZodString;
        unit: z.ZodLiteral<"ms">;
        schemaVersion: z.ZodNumber;
        bounds: z.ZodArray<z.ZodNumber>;
        counts: z.ZodArray<z.ZodNumber>;
        count: z.ZodNumber;
        sum: z.ZodNumber;
        max: z.ZodNumber;
    }, z.core.$strict>>;
    counters: z.ZodRecord<z.ZodString, z.ZodNumber>;
    footprint: z.ZodObject<{
        kind: z.ZodLiteral<"owned-estimate">;
        cachesKB: z.ZodNumber;
        logsKB: z.ZodNumber;
    }, z.core.$strict>;
}, z.core.$strict>;
export type ClientHealthPerfHistogram = z.infer<typeof clientHealthPerfHistogramSchema>;
export type ClientHealthReportV1 = z.infer<typeof clientHealthReportV1Schema>;
