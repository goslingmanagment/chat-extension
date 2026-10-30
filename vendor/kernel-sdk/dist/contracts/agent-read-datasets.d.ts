/**
 * Agent Read Plane — the dataset vocabulary.
 *
 * WHY THIS FILE EXISTS: the dataset name in `POST /agent/pages/:pageLabel/
 * datasets/:dataset/query` is the one open-looking segment of the whole plane, and
 * the registry is the ONLY bridge from that name to code. A string never becomes a
 * table or column name at runtime: the name resolves here, and a field outside the
 * dataset's allowlist is a static 400 BEFORE any SQL. Declaring the vocabulary once
 * (here) and deriving the enums, the catalog response and the filter allowlists from
 * it is the same anti-drift law the claim/plane registry states in its own header.
 *
 * SCOPE: names, field maps, scalar kinds, deterministic sort keys. The SQL mapping
 * (dataset -> table, field -> expression) lands in slice A together with the
 * operation, WITH a mandatory two-way test: every available dataset's declared
 * fields are exactly covered by the runtime mapping, and vice versa. `platforms`
 * and `captureState` — the two remaining catalog-response columns — are runtime
 * facts about a deployment rather than vocabulary, and join in the same slice.
 *
 * Source: the contract appendix §17 dataset catalog (names, fields, default sorts,
 * stable keys and the money-bearing set are copied from it verbatim; the scalar
 * kinds are the appendix's own closed union). Architecture reference:
 * `investigations/agent-read-api-design-2026-07-31.md` §10.
 */
import { type AgentCapability } from "./agent-read-capabilities";
/**
 * The closed scalar union a dataset row may carry. There is no nested structure
 * and no free JSON: `components.schemas` is empty in the generated OpenAPI (every
 * schema inlines), so a recursive JSON value expands forever. A dataset that needs
 * structure needs a real operation instead.
 */
export declare const AGENT_DATASET_FIELD_KINDS: readonly ["string", "int", "mills", "bool", "timestamp", "date", "string_array"];
export type AgentDatasetFieldKind = (typeof AGENT_DATASET_FIELD_KINDS)[number];
/**
 * The closed filter-operator vocabulary. The route schema and the kind-aware
 * validator below both derive from this value so an operator cannot be accepted
 * on the wire but forgotten by the semantic boundary (or vice versa).
 */
export declare const AGENT_DATASET_FILTER_OPS: readonly ["eq", "neq", "lt", "lte", "gt", "gte", "in", "is_null", "is_not_null"];
export type AgentDatasetFilterOperator = (typeof AGENT_DATASET_FILTER_OPS)[number];
/** Shared by the window contract and timestamp filter validation. */
export declare const AGENT_RFC3339_TIMESTAMP_PATTERN: RegExp;
export type AgentDatasetSort = {
    readonly field: string;
    readonly dir: "asc" | "desc";
    /** NULLS LAST on a nullable sort column, so a row with no value never leads. */
    readonly nullsLast: boolean;
};
export type AgentDatasetDefinition = {
    /**
     * Money-bearing datasets additionally require the `read:money` capability.
     *
     * A dataset carrying ANY field of kind `mills` is money-bearing by definition
     * — pinned by test, because the appendix declared one such dataset otherwise
     * and that quietly put a fan's lifetime spend behind a read:datasets-only key.
     */
    readonly moneyBearing: boolean;
    /**
     * Datasets carrying operator- or fan-written FREE TEXT additionally require
     * `read:messages`.
     *
     * `fan_notes` selects the note body verbatim, which is the same disclosure
     * class as a transcript — and the person operation puts exactly that material
     * behind `read:messages`. Without this flag a `read:datasets`-only key read the
     * notes through the dataset route instead, so the capability was a door with a
     * window next to it. Declared here rather than as a list at the handler, and
     * pinned by test against the field map, so a future dataset that adds a text
     * body cannot inherit the narrower requirement.
     */
    readonly verbatimText: boolean;
    /**
     * Datasets whose ROWS DISCLOSE A PURCHASE additionally require
     * `read:messages` — the endpoints-cover scope-pairing rule.
     *
     * The rule exists because a purchase is a fact about a CONVERSATION as much
     * as about money: a row saying "this fan bought offer 3 of message X" tells a
     * `read:money`-only key who was talking to whom and what they bought, which
     * is exactly the disclosure `read:messages` guards. A buyer identity or a
     * per-message sale count discloses a purchase on its own — there is no
     * threshold below which it does not.
     *
     * Declared rather than inferred: unlike `verbatimText`, no field NAME or
     * scalar KIND can tell `salesCount` on a message offer (a purchase) from
     * `salesCount` on a catalogue item (an inventory statistic). The flag is
     * REQUIRED on every dataset so the question has to be answered rather than
     * defaulted, and a test pins the derivation.
     */
    readonly disclosesPurchase: boolean;
    /**
     * The page's OWN published material or its statistics: no row names a fan,
     * a conversation, a purchase or an amount, and any free text is the page's
     * own (its post copy, file and album names). A key holding `read:content`
     * reads such a dataset with that capability alone, in place of
     * `agentDatasetRequiredCapabilities` (owner 2026-10-29: ContentOps reads
     * posts, files and vault without the conversations). Absent means no: a
     * dataset that grows a fan, money or a conversation must drop the flag, and
     * a test pins it against the other flags.
     */
    readonly ownContent?: true;
    /** Wire field -> scalar kind. This map IS the filter/sort allowlist. */
    readonly fields: Readonly<Record<string, AgentDatasetFieldKind>>;
    readonly defaultSort: AgentDatasetSort;
    /**
     * Physical row identifier(s) completing the keyset cursor `{sortValue,
     * stableKey}`. These are NOT wire fields and are never returned or filtered on;
     * they exist so pagination is total-ordered even when the sort column ties.
     * Resolved to real columns by the slice-A mapping.
     */
    readonly stableKey: readonly string[];
};
/**
 * Datasets addressable TODAY. The path enum is built from exactly these keys, so a
 * planned dataset is caught by Zod at the boundary as a static 400 — visible in the
 * catalog, not addressable in the query.
 */
export declare const AGENT_DATASETS: {
    readonly ofapi_financial_snapshots: {
        readonly moneyBearing: true;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly source: "string";
            readonly operation: "string";
            readonly metricPath: "string";
            readonly unit: "string";
            readonly rawValue: "string";
            readonly valueMills: "mills";
            readonly windowFrom: "timestamp";
            readonly windowTo: "timestamp";
            readonly granularity: "string";
            readonly observedAt: "timestamp";
            readonly coverageState: "string";
            readonly coverageReason: "string";
            readonly observationRef: "string";
        };
        readonly defaultSort: {
            readonly field: "observedAt";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["metricKey"];
    };
    readonly ofapi_payout_requests: {
        readonly moneyBearing: true;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly payoutRef: "string";
            readonly amountMills: "mills";
            readonly currency: "string";
            readonly state: "string";
            readonly rejectReason: "string";
            readonly requestedAt: "timestamp";
            readonly lastObservedAt: "timestamp";
            readonly observationRef: "string";
        };
        readonly defaultSort: {
            readonly field: "requestedAt";
            readonly dir: "desc";
            readonly nullsLast: true;
        };
        readonly stableKey: readonly ["payoutRequestKey"];
    };
    readonly campaign_snapshots: {
        readonly moneyBearing: true;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly linkKind: "string";
            readonly linkRef: "string";
            readonly name: "string";
            readonly observedAt: "timestamp";
            /** The Europe/Moscow day of `observedAt` (the business day). */
            readonly businessDate: "date";
            readonly windowAt: "timestamp";
            readonly runRef: "string";
            readonly runStatus: "string";
            /** The first non-empty run under a new OFAPI account; null on rows an
             *  image that did not record the flag wrote (everything before 0255). */
            readonly bindingChanged: "bool";
            readonly clicks: "int";
            /** Trial links only; null on tracking links. */
            readonly claims: "int";
            readonly subscribers: "int";
            /** Null while the vendor has not computed it — never a fake zero. */
            readonly spenders: "int";
            /** Creator NET after the OnlyFans fee, refunds and chargebacks; null =
             *  unknown. Never take the fee off again. */
            readonly vendorRevenueNetMills: "mills";
            /** Already excluded from `vendorRevenueNetMills`; informational. */
            readonly vendorChargebacksMills: "mills";
            readonly vendorRevenueCalculatedAt: "timestamp";
            readonly isFinished: "bool";
            readonly linkEndsAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "observedAt";
            readonly dir: "asc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["runId", "platformLinkId"];
    };
    readonly campaign_runs: {
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly linkKind: "string";
            readonly windowAt: "timestamp";
            readonly observedAt: "timestamp";
            readonly businessDate: "date";
            readonly runRef: "string";
            readonly status: "string";
            /** Caveats of a `partial`, what stopped a `truncated`, the (redacted)
             *  error of a `failed`, why a `skipped` was not attempted. */
            readonly reason: "string";
            readonly attempt: "int";
            readonly apiPages: "int";
            readonly rawItems: "int";
            readonly writtenRows: "int";
            readonly bindingChanged: "bool";
            readonly usableResult: "bool";
        };
        readonly defaultSort: {
            readonly field: "observedAt";
            readonly dir: "asc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["runId"];
    };
    readonly campaign_bindings: {
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly linkKind: "string";
            readonly linkRef: "string";
            readonly channelKey: "string";
            readonly channelTitle: "string";
            readonly contractorKey: "string";
            readonly contractorTitle: "string";
            /** This stretch: [validFrom, validTo), validTo null = still in force. */
            readonly validFrom: "timestamp";
            readonly validTo: "timestamp";
            /** How the link → channel binding's start is known: `confirmed` or
             *  `assumed_link_created` (the link's creation date stands in). */
            readonly validFromBasis: "string";
            readonly bindingValidFrom: "timestamp";
            readonly bindingValidTo: "timestamp";
            readonly contractorValidFrom: "timestamp";
            readonly contractorValidTo: "timestamp";
            readonly contractorValidFromBasis: "string";
        };
        readonly defaultSort: {
            readonly field: "validFrom";
            readonly dir: "asc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["bindingId", "stretchFrom"];
    };
    readonly campaigns: {
        readonly moneyBearing: true;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly linkKind: "string";
            readonly linkRef: "string";
            readonly name: "string";
            readonly url: "string";
            readonly linkCreatedAt: "timestamp";
            readonly linkEndsAt: "timestamp";
            readonly isFinished: "bool";
            /** Vendor subscribeDays of a trial link; null on tracking links. */
            readonly trialDays: "int";
            readonly tags: "string_array";
            /** The channel and contractor bound now; null = none. */
            readonly channelKey: "string";
            readonly contractorKey: "string";
            readonly lastObservedAt: "timestamp";
            readonly clicks: "int";
            /** Claims on a trial link, subscribers on a tracking link (`fansMetric`). */
            readonly fans: "int";
            readonly fansMetric: "string";
            readonly subscribers: "int";
            readonly spenders: "int";
            /** OFAPI: creator NET after the OnlyFans fee, refunds and chargebacks;
             *  null = unknown. Never take the fee off again. */
            readonly vendorRevenueNetMills: "mills";
            readonly vendorRevenueCalculatedAt: "timestamp";
            /** Hub: posted transactions since `hubMoneyFloorAt`, net after the fee;
             *  null when the link has no finished fan walk (no floor). */
            readonly hubRevenueNetMills: "mills";
            /** Hub: pending transactions since the floor — never in the figure. */
            readonly hubPendingMills: "mills";
            readonly hubMoneyFloorAt: "timestamp";
            readonly attributionRule: "string";
            /** `creator_net_after_platform_fee` for both money figures. */
            readonly revenueBasis: "string";
        };
        readonly defaultSort: {
            readonly field: "lastObservedAt";
            readonly dir: "desc";
            readonly nullsLast: true;
        };
        readonly stableKey: readonly ["pageId", "linkKind", "linkRef"];
    };
    readonly campaign_money_daily: {
        readonly moneyBearing: true;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly businessDate: "date";
            /** 00:00 Moscow of the day, as a UTC instant (the window's column). */
            readonly dayStartAt: "timestamp";
            readonly linkKind: "string";
            readonly linkRef: "string";
            readonly hubRevenueNetMills: "mills";
            readonly hubPendingMills: "mills";
            /** Posted transactions with a share of this link that day. */
            readonly transactionCount: "int";
            readonly fanCount: "int";
            readonly attributionRule: "string";
            readonly floorAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "dayStartAt";
            readonly dir: "asc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["pageId", "linkKind", "linkRef", "businessDate"];
    };
    readonly fan_memberships: {
        readonly moneyBearing: true;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly platformUserId: "string";
            readonly username: "string";
            readonly displayName: "string";
            readonly membershipState: "string";
            readonly firstSeenAt: "timestamp";
            readonly lastSeenAt: "timestamp";
            readonly lifetimeSpendMills: "mills";
            readonly accountLookupMissAt: "timestamp";
            readonly accountCheckedAt: "timestamp";
            readonly accountContactability: "string";
        };
        readonly defaultSort: {
            readonly field: "lastSeenAt";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["fanId"];
    };
    readonly dm_threads: {
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly platformUserId: "string";
            readonly conversationRef: "string";
            readonly lastMessageAt: "timestamp";
            readonly messageCount: "int";
            readonly unreadCount: "int";
            readonly coverageStatus: "string";
        };
        readonly defaultSort: {
            readonly field: "lastMessageAt";
            readonly dir: "desc";
            readonly nullsLast: true;
        };
        readonly stableKey: readonly ["threadId"];
    };
    readonly subscriptions: {
        readonly moneyBearing: true;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly platformUserId: "string";
            readonly subscriptionRef: "string";
            readonly subscriptionState: "string";
            readonly startedAt: "timestamp";
            readonly expiresAt: "timestamp";
            readonly priceMills: "mills";
            readonly currency: "string";
        };
        readonly defaultSort: {
            readonly field: "startedAt";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["subscriptionId"];
    };
    readonly subscription_events: {
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly occurredAt: "timestamp";
            readonly fanId: "string";
            readonly phase: "string";
            readonly subType: "string";
        };
        readonly defaultSort: {
            readonly field: "occurredAt";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["domainEventId"];
    };
    readonly transactions: {
        readonly moneyBearing: true;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly platformUserId: "string";
            readonly transactionRef: "string";
            readonly transactionType: "string";
            readonly transactionState: "string";
            readonly occurredAt: "timestamp";
            readonly grossMills: "mills";
            readonly netMills: "mills";
            readonly feeMills: "mills";
            readonly currency: "string";
            /** Backward-compatible legacy name. The provider value is a generic
             * correlation key and is not guaranteed to identify a message. */
            readonly relatedMessageRef: "string";
            readonly correlationRef: "string";
        };
        readonly defaultSort: {
            readonly field: "occurredAt";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["transactionId"];
    };
    readonly tip_transactions: {
        readonly moneyBearing: true;
        readonly verbatimText: true;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly platformUserId: "string";
            readonly transactionRef: "string";
            readonly transactionType: "string";
            readonly transactionState: "string";
            readonly occurredAt: "timestamp";
            readonly grossMills: "mills";
            readonly netMills: "mills";
            readonly feeMills: "mills";
            readonly currency: "string";
            readonly correlationRef: "string";
            readonly contextState: "string";
            readonly capturedConversationRef: "string";
            readonly tipMessageText: "string";
        };
        readonly defaultSort: {
            readonly field: "occurredAt";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["transactionId"];
    };
    readonly fan_spend_daily: {
        readonly moneyBearing: true;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly platformUserId: "string";
            readonly businessDate: "date";
            readonly grossMills: "mills";
            readonly netMills: "mills";
            readonly transactionCount: "int";
            readonly currency: "string";
        };
        readonly defaultSort: {
            readonly field: "businessDate";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["fanId", "canonicalType", "transactionState"];
    };
    readonly follows: {
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly platformUserId: "string";
            readonly followed: "bool";
            readonly followedAt: "timestamp";
            readonly unfollowedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "followedAt";
            readonly dir: "desc";
            readonly nullsLast: true;
        };
        readonly stableKey: readonly ["followId"];
    };
    readonly followers_daily: {
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            /** The UTC day the follows fell on (the rollup buckets `followed_at`
             *  by UTC date) — not a Europe/Moscow business day. */
            readonly businessDate: "date";
            /** The page's total follower count Hub knew for that day; null = not
             *  known (only today's value comes from the live sync). */
            readonly followersCount: "int";
            /** Follow relationships whose `followed_at` falls on that day, counted
             *  over what Hub stores (a later unfollow still counts). Derived: the
             *  rollup is rebuilt from `page_follows`, so a past day can still move.
             *  A day with no row has no stored follow. */
            readonly newFollowers: "int";
        };
        readonly defaultSort: {
            readonly field: "businessDate";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["pageId"];
    };
    readonly fan_aliases: {
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly platformUserId: "string";
            readonly aliasKind: "string";
            readonly aliasValue: "string";
            readonly firstSeenAt: "timestamp";
            readonly lastSeenAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "lastSeenAt";
            readonly dir: "desc";
            readonly nullsLast: true;
        };
        readonly stableKey: readonly ["aliasId"];
    };
    readonly fan_notes: {
        readonly moneyBearing: false;
        readonly verbatimText: true;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly platformUserId: "string";
            readonly noteRef: "string";
            readonly noteText: "string";
            readonly createdAt: "timestamp";
            readonly updatedAt: "timestamp";
            readonly createdBy: "string";
            readonly lastEditedBy: "string";
        };
        readonly defaultSort: {
            readonly field: "createdAt";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["noteId"];
    };
    readonly note_attributions: {
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly platformUserId: "string";
            readonly noteRef: "string";
            readonly platformNoteRef: "string";
            readonly noteKind: "string";
            readonly action: "string";
            readonly origin: "string";
            readonly fields: "string_array";
            readonly authorLogin: "string";
            readonly occurredAt: "timestamp";
            readonly recordedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "occurredAt";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["eventId"];
    };
    readonly posts: {
        readonly ownContent: true;
        readonly moneyBearing: false;
        readonly verbatimText: true;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly postRef: "string";
            readonly postText: "string";
            readonly publishedAt: "timestamp";
            readonly firstObservedAt: "timestamp";
            readonly lastObservedAt: "timestamp";
            readonly rowUpdatedAt: "timestamp";
            readonly attachmentCount: "int";
            readonly fypFlags: "int";
            readonly inReplyToRef: "string";
            readonly wallRefs: "string_array";
        };
        readonly defaultSort: {
            readonly field: "publishedAt";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["postId"];
    };
    readonly raw_media: {
        readonly ownContent: true;
        readonly moneyBearing: false;
        readonly verbatimText: true;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly mediaRef: "string";
            readonly ownerAccountRef: "string";
            readonly filename: "string";
            readonly mimeType: "string";
            readonly mediaType: "int";
            readonly providerType: "string";
            readonly durationMs: "int";
            readonly width: "int";
            readonly height: "int";
            readonly originalWidth: "int";
            readonly originalHeight: "int";
            readonly frameRateMilli: "int";
            readonly createdAtPlatform: "timestamp";
            readonly updatedAtPlatform: "timestamp";
            readonly firstOrigin: "string";
            readonly sourceKind: "string";
            readonly firstObservedAt: "timestamp";
            readonly lastObservedAt: "timestamp";
            readonly rowUpdatedAt: "timestamp";
            /** Bytes of the largest served rendition (OnlyFans `files.full.size`); null when not served. */
            readonly byteSize: "int";
        };
        readonly defaultSort: {
            readonly field: "firstObservedAt";
            readonly dir: "asc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["mediaRef"];
    };
    readonly post_attachments: {
        readonly ownContent: true;
        readonly moneyBearing: false;
        readonly verbatimText: true;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly postRef: "string";
            readonly publishedAt: "timestamp";
            readonly attachmentIndex: "int";
            readonly pos: "int";
            readonly contentType: "int";
            readonly contentRef: "string";
            readonly role: "string";
            readonly memberIndex: "int";
            readonly bundleRef: "string";
            readonly mediaOfferRef: "string";
            readonly previewRef: "string";
            readonly mediaRef: "string";
            readonly linkState: "string";
            readonly filename: "string";
            readonly mimeType: "string";
            readonly durationMs: "int";
            readonly originalWidth: "int";
            readonly originalHeight: "int";
            readonly lastObservedAt: "timestamp";
            readonly rowUpdatedAt: "timestamp";
            readonly postObservationRef: "int";
            readonly offerObservationRef: "int";
            readonly bundleObservationRef: "int";
            readonly fileObservationRef: "int";
        };
        readonly defaultSort: {
            readonly field: "publishedAt";
            readonly dir: "asc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["postAttachmentKey"];
    };
    readonly post_monetization: {
        readonly moneyBearing: true;
        readonly verbatimText: true;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly postRef: "string";
            readonly publishedAt: "timestamp";
            readonly lastObservedAt: "timestamp";
            readonly postTargetTipAmountMills: "mills";
            readonly attachmentTipAmountMills: "mills";
            readonly postTipTotalMills: "mills";
            readonly tipGoalLinked: "bool";
            readonly tipGoalRef: "string";
            readonly tipGoalLabelText: "string";
            readonly tipGoalTargetMills: "mills";
            readonly tipGoalCurrentMills: "mills";
            readonly tipGoalAmountsHidden: "bool";
        };
        readonly defaultSort: {
            readonly field: "publishedAt";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["postId"];
    };
    readonly post_tips: {
        readonly moneyBearing: true;
        readonly verbatimText: true;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly postTipPostRef: "string";
            readonly postTipRef: "string";
            readonly tipSenderPlatformUserId: "string";
            readonly postTipOccurredAt: "timestamp";
            readonly postTipAmountMills: "mills";
            readonly receiverTransactionRef: "string";
            readonly postTipGoalRef: "string";
            readonly postTipMessageText: "string";
        };
        readonly defaultSort: {
            readonly field: "postTipOccurredAt";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["postTipId"];
    };
    readonly tip_goals: {
        readonly moneyBearing: true;
        readonly verbatimText: true;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly tipGoalRef: "string";
            readonly tipGoalLabelText: "string";
            readonly tipGoalTargetMills: "mills";
            readonly tipGoalCurrentMills: "mills";
            readonly tipGoalAmountsHidden: "bool";
            readonly lastObservedAt: "timestamp";
            readonly linkedPostCount: "int";
        };
        readonly defaultSort: {
            readonly field: "lastObservedAt";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["tipGoalRef"];
    };
    readonly traffic_daily: {
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly subjectKind: "string";
            readonly subjectRef: "string";
            readonly periodMs: "int";
            readonly bucketStart: "timestamp";
            /** RAW platform code as text (A22-2). Key on THIS. */
            readonly sourceCode: "string";
            /** This build's reading of the code; `unknown:<code>` when it has none. */
            readonly sourceLabel: "string";
            readonly mappingVersion: "int";
            /** `type - (type % 10)` for a profile row; null for the 0/1 media codes,
             *  which are not a family/member structure at all. */
            readonly family: "string";
            /** Member 1 is the creator widget's visit count; anything else is the
             *  dwell-bearing series, whose own view counts differ. */
            readonly measure: "string";
            readonly views: "int";
            readonly previewViews: "int";
            readonly uniqueViewers: "int";
            readonly previewUniqueViewers: "int";
            readonly interactionTimeMs: "int";
            readonly previewInteractionTimeMs: "int";
        };
        readonly defaultSort: {
            readonly field: "bucketStart";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["bucketKey"];
    };
    readonly media_stats: {
        readonly moneyBearing: true;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly mediaOfferRef: "string";
            readonly mediaType: "int";
            readonly mimeType: "string";
            readonly durationMs: "int";
            readonly periodMs: "int";
            readonly bucketStart: "timestamp";
            readonly sourceCode: "string";
            readonly sourceLabel: "string";
            readonly mappingVersion: "int";
            readonly views: "int";
            readonly previewViews: "int";
            readonly uniqueViewers: "int";
            readonly previewUniqueViewers: "int";
            readonly interactionTimeMs: "int";
            readonly previewInteractionTimeMs: "int";
            readonly priceMills: "mills";
            readonly salesCount: "int";
            readonly salesNetMills: "mills";
            /** DERIVED from net at read time (net / 0.8, A12). The name carries the
             *  warning because a wire field cannot carry a footnote. */
            readonly salesGrossMillsDerived: "mills";
        };
        readonly defaultSort: {
            readonly field: "bucketStart";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["mediaBucketKey"];
    };
    readonly top_media: {
        readonly ownContent: true;
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly plane: "string";
            readonly rank: "int";
            readonly mediaOfferRef: "string";
            readonly bundleRef: "string";
            readonly periodMs: "int";
            readonly requestedStart: "timestamp";
            readonly requestedEnd: "timestamp";
            readonly views: "int";
            readonly previewViews: "int";
            readonly interactionTimeMs: "int";
            readonly previewInteractionTimeMs: "int";
            readonly observedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "requestedEnd";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["topMediaKey"];
    };
    readonly top_tags: {
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly plane: "string";
            readonly rank: "int";
            readonly tagRef: "string";
            /** NULL when the response's own `tags[]` join missed — never fabricated
             *  from the id, and never read as "the tag has no name". */
            readonly tagName: "string";
            readonly periodMs: "int";
            readonly requestedStart: "timestamp";
            readonly requestedEnd: "timestamp";
            readonly views: "int";
            readonly previewViews: "int";
            readonly interactionTimeMs: "int";
            readonly previewInteractionTimeMs: "int";
            readonly observedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "requestedEnd";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["topTagKey"];
    };
    readonly revenue_mix: {
        readonly moneyBearing: true;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly businessDate: "date";
            /** RAW. ONE visible label maps to TWO live codes, legacy and current
             *  (A22-2), and this ledger reaches back to 2025-03-06 — well into legacy
             *  territory. Group by `typeCode` for the truth, by `typeLabel` for the
             *  grouping the platform's own chart shows. */
            readonly typeCode: "int";
            readonly typeLabel: "string";
            readonly typeEra: "string";
            readonly mappingVersion: "int";
            /** Stored separately, NEVER derived across bases. */
            readonly grossMills: "mills";
            readonly netMills: "mills";
            readonly lastObservedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "businessDate";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["revenueMixKey"];
    };
    readonly message_media_sales: {
        readonly moneyBearing: true;
        readonly verbatimText: false;
        readonly disclosesPurchase: true;
        readonly fields: {
            readonly platform: "string";
            readonly messageRef: "string";
            readonly conversationRef: "string";
            readonly offerOrdinal: "int";
            readonly mediaOfferRef: "string";
            readonly bundleRef: "string";
            readonly offerType: "int";
            readonly mimeType: "string";
            readonly durationMs: "int";
            readonly priceMills: "mills";
            /** The archive joins THIS for purchase state (A17-4 variant B); it is not
             *  a column on the message row. `unknown` is a real value, not a null. */
            readonly purchaseState: "string";
            readonly orderRef: "string";
            readonly salesCount: "int";
            readonly salesNetMills: "mills";
            readonly fanPlatformUserId: "string";
            readonly messageCreatedAt: "timestamp";
            readonly lastObservedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "messageCreatedAt";
            readonly dir: "desc";
            readonly nullsLast: true;
        };
        readonly stableKey: readonly ["messageOfferKey"];
    };
    readonly comments: {
        readonly moneyBearing: true;
        readonly verbatimText: true;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly commentRef: "string";
            readonly parentPostRef: "string";
            readonly rootPostRef: "string";
            readonly authorRef: "string";
            readonly authorUsername: "string";
            /** `''` is a REPLY, not a missing one: a fan who replied with only an
             *  attachment still replied, and one of the four live captured replies
             *  had empty content. */
            readonly commentText: "string";
            readonly likeCount: "int";
            /** TWO BASES, never summed. */
            readonly tipTotalMills: "mills";
            readonly attachmentTipMills: "mills";
            readonly attachmentCount: "int";
            readonly occurredAt: "timestamp";
            readonly changedAt: "timestamp";
            readonly discoveredVia: "string";
            /** The walk route has no established pagination, so a suspiciously full
             *  page marks its rows. A true here means per-post completeness is
             *  UNKNOWN for that post — never that the comment is suspect. */
            readonly possiblyTruncated: "bool";
            /** A later FULL walk stopped naming this comment. Never a delete (DP 7). */
            readonly missingSince: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "occurredAt";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["commentKey"];
    };
    readonly likes: {
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly subjectKind: "string";
            readonly subjectRef: "string";
            readonly likerPlatformUserId: "string";
            /** `active` | `undone`. An undo sets the state; it never deletes. */
            readonly state: "string";
            readonly occurredAt: "timestamp";
            readonly discoveredVia: "string";
        };
        readonly defaultSort: {
            readonly field: "occurredAt";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["likeKey"];
    };
    readonly vault_media: {
        readonly ownContent: true;
        readonly moneyBearing: false;
        readonly verbatimText: true;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            /** `creator` | `user`. The user vault is the account's OWN Likes and
             *  Purchases and holds OTHER creators' media, so merging the two would
             *  make purchases indistinguishable from inventory. */
            readonly vaultKind: "string";
            readonly albumRef: "string";
            readonly albumTitle: "string";
            readonly lastFullWalkAt: "timestamp";
            readonly fullWalkRef: "string";
            readonly fullWalkObservedCount: "int";
            readonly customFilename: "string";
            readonly filename: "string";
            readonly mimeType: "string";
            readonly durationMs: "int";
            readonly originalWidth: "int";
            readonly originalHeight: "int";
            /** Served dimensions and bytes of the file (OnlyFans `files.full`). */
            readonly width: "int";
            readonly height: "int";
            readonly byteSize: "int";
            /** The platform's own type name (`photo`, `video`, …); OnlyFans has no numeric `mediaType`. */
            readonly providerType: "string";
            /** Raw file identity. This is the membership key on the live creator
             *  vault and remains distinct from an optional offer id. */
            readonly mediaRef: "string";
            readonly mediaOfferRef: "string";
            /** The membership row's OWN id — the vault walk's cursor, and NOT the
             *  same value as `mediaOfferRef`. */
            readonly memberRef: "string";
            readonly mediaType: "int";
            readonly bundleRef: "string";
            readonly createdAtPlatform: "timestamp";
            readonly missingSince: "timestamp";
            readonly firstObservedAt: "timestamp";
            readonly lastObservedAt: "timestamp";
            readonly rowUpdatedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "firstObservedAt";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["vaultMemberKey"];
    };
    readonly notifications: {
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: true;
        readonly fields: {
            readonly platform: "string";
            readonly notificationRef: "string";
            /** RAW. The shipped spec was wrong on EIGHT of sixteen codes, including
             *  both purchase events (A22-1) — which is why storage keys on this and
             *  the label below carries its own confidence. */
            readonly typeCode: "int";
            readonly typeLabel: "string";
            /** `confirmed` requires two independent live examples agreeing with a
             *  second source; everything client-derived is `inferred`. */
            readonly typeConfidence: "string";
            readonly mappingVersion: "int";
            readonly correlationRef: "string";
            readonly correlationGroupRef: "string";
            readonly occurredAt: "timestamp";
            readonly acknowledgedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "occurredAt";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["notificationKey"];
    };
    readonly subscription_tiers: {
        readonly moneyBearing: true;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly tierRef: "string";
            readonly tierName: "string";
            readonly tierPos: "int";
            /** The tier HEAD's `price`. A base, never what a subscriber pays. */
            readonly basePriceMills: "mills";
            readonly maxSubscribers: "int";
            readonly planRef: "string";
            readonly planStatus: "int";
            /** Reads `plans[].billingCycle` — verified live; `duration` exists one
             *  level down, on `promos[]`, and is a different thing. */
            readonly durationDays: "int";
            /** THE PRICE TRUTH. */
            readonly priceMills: "mills";
            readonly promoCount: "int";
            readonly missingSince: "timestamp";
            readonly lastObservedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "lastObservedAt";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["tierPlanKey"];
    };
    readonly payouts: {
        readonly moneyBearing: true;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly payoutRef: "string";
            /** MILLS with no scaling: the wire unit IS the kernel unit here. */
            readonly amountMills: "mills";
            /** RAW. 8 is the ONLY code ever observed and is never treated as "the
             *  success code" — `statusConfidence` is how a reader learns that. */
            readonly statusCode: "int";
            readonly statusLabel: "string";
            readonly statusConfidence: "string";
            readonly methodRef: "string";
            readonly methodProviderId: "int";
            readonly methodProviderLabel: "string";
            /** OURS, never the provider's. */
            readonly methodMaskedLabel: "string";
            readonly requestedAt: "timestamp";
            readonly updatedAtPlatform: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "requestedAt";
            readonly dir: "desc";
            readonly nullsLast: true;
        };
        readonly stableKey: readonly ["payoutKey"];
    };
    readonly capture_coverage: {
        readonly ownContent: true;
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly plane: "string";
            readonly scopeRef: "string";
            readonly status: "string";
            readonly acquisitionMode: "string";
            readonly proof: "string";
            readonly oldestCapturedAt: "timestamp";
            readonly newestCapturedAt: "timestamp";
            readonly expectedCount: "int";
            readonly observedUniqueCount: "int";
            readonly reasonCode: "string";
            readonly nextProbeAt: "timestamp";
            readonly updatedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "updatedAt";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["coverageKey"];
    };
    readonly sync_streams: {
        readonly ownContent: true;
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly stream: "string";
            readonly syncStatus: "string";
            readonly cursorAt: "timestamp";
            readonly succeededAt: "timestamp";
            readonly failedAt: "timestamp";
            readonly consecutiveFailures: "int";
        };
        readonly defaultSort: {
            readonly field: "stream";
            readonly dir: "asc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["pageId", "stream"];
    };
    readonly creator_stats_views: {
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly granularity: "string";
            readonly bucketStart: "timestamp";
            readonly source: "int";
            readonly sourceLabel: "string";
            readonly views: "int";
            readonly impressions: "int";
            readonly uniqueViewers: "int";
            readonly videoViews: "int";
            readonly completedViews: "int";
            readonly watchMs: "int";
            /** The sum of each view's watched share in hundredths of a percent:
             *  divided by `videoViews` and by 100 it is the average percent. */
            readonly watchPctSum: "string";
            readonly replays: "int";
            readonly imageViews: "int";
            readonly imageImpressions: "int";
            readonly uniqueImageViewers: "int";
            readonly imageWatchMs: "int";
            readonly capturedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "bucketStart";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["creatorStatsViewsKey"];
    };
    readonly creator_stats_profile: {
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly granularity: "string";
            readonly bucketStart: "timestamp";
            readonly source: "int";
            readonly sourceLabel: "string";
            readonly profileVisits: "int";
            readonly uniqueVisitors: "int";
            readonly profileWatchMs: "int";
            readonly capturedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "bucketStart";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["creatorStatsProfileKey"];
    };
    readonly creator_stats_follows: {
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly granularity: "string";
            readonly bucketStart: "timestamp";
            readonly follows: "int";
            readonly unfollows: "int";
            readonly capturedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "bucketStart";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["creatorStatsFollowsKey"];
    };
    readonly creator_stats_subscriptions: {
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly granularity: "string";
            readonly bucketStart: "timestamp";
            readonly tierId: "string";
            readonly tierName: "string";
            readonly subscriptionsNew: "int";
            readonly subscriptionsRenewed: "int";
            readonly subscriptionsExpired: "int";
            readonly subscriptionsCancelled: "int";
            readonly subscriptionsMovedIn: "int";
            readonly subscriptionsMovedOut: "int";
            readonly capturedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "bucketStart";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["creatorStatsSubscriptionsKey"];
    };
    /** Fansly's own revenue per hour, UTC day or month and product type (the
     *  2026-10 statistics). Not the ledger: `transactions` is what Hub recorded
     *  arriving. Refunds per bucket as Fansly counts them. */
    readonly creator_stats_revenue: {
        readonly moneyBearing: true;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly granularity: "string";
            readonly bucketStart: "timestamp";
            readonly productType: "int";
            readonly productLabel: "string";
            readonly transactions: "int";
            readonly grossMills: "mills";
            readonly netMills: "mills";
            readonly refunds: "int";
            readonly refundedGrossMills: "mills";
            readonly refundedNetMills: "mills";
            readonly capturedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "bucketStart";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["creatorStatsRevenueKey"];
    };
    /** Follower and subscriber count at each UTC day; a tier's row carries its
     *  `tierId` and only `subscriberCount`, the account's row no tier. */
    readonly creator_stats_levels: {
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly day: "date";
            readonly tierId: "string";
            readonly tierName: "string";
            readonly followerCount: "int";
            readonly subscriberCount: "int";
            readonly capturedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "day";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["creatorStatsLevelsKey"];
    };
    /** The page's own Fansly profile (0337, `/account/me`): one row per distinct
     *  content it showed — name, bio, location, social links (`providerId:handle`;
     *  1 X, 4 Instagram, 5 TikTok, 8 Bluesky, 9 Fleshlight), the badges Fansly
     *  awarded (leaderboard «Top 500 …»), pinned posts, walls. `current` marks the
     *  version seen last; the window applies to `lastSeenAt`. */
    readonly page_profile: {
        readonly ownContent: true;
        readonly moneyBearing: false;
        readonly verbatimText: true;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly firstSeenAt: "timestamp";
            readonly lastSeenAt: "timestamp";
            readonly current: "bool";
            readonly username: "string";
            readonly displayName: "string";
            readonly aboutText: "string";
            readonly location: "string";
            readonly socials: "string_array";
            readonly badgeTitles: "string_array";
            readonly badgeAwardedAt: "string_array";
            readonly pinnedPostRefs: "string_array";
            readonly walls: "string_array";
            readonly avatarMediaRef: "string";
            readonly bannerMediaRef: "string";
        };
        readonly defaultSort: {
            readonly field: "lastSeenAt";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["pageProfileVersionKey"];
    };
    /** The counters under the profile a UTC day, from the day's last `/account/me`
     *  (0337, since 2026-07): followers, subscribers, likes, the timeline's media
     *  counts, stories, the stream's status (2 live) and the earnings balance. */
    readonly page_profile_daily: {
        readonly moneyBearing: true;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly day: "date";
            readonly followers: "int";
            readonly subscribers: "int";
            readonly postLikes: "int";
            readonly mediaLikes: "int";
            readonly images: "int";
            readonly videos: "int";
            readonly bundles: "int";
            readonly bundleImages: "int";
            readonly bundleVideos: "int";
            readonly stories: "int";
            readonly hasActiveStories: "bool";
            readonly streamStatus: "int";
            readonly earningsBalanceMills: "mills";
            readonly capturedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "day";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["pageProfileDailyKey"];
    };
    /** Fansly mass messages as the stats lists show them (`list`: live,
     *  scheduled, deleted; collected daily since 2026-08): delivery, reads,
     *  tips, the offers' price range and their sales. */
    readonly mass_messages: {
        readonly moneyBearing: true;
        readonly verbatimText: true;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly broadcastRef: "string";
            readonly list: "string";
            readonly createdAt: "timestamp";
            readonly scheduledFor: "timestamp";
            readonly deletedAt: "timestamp";
            readonly messageText: "string";
            readonly sent: "int";
            readonly delivered: "int";
            readonly read: "int";
            readonly tipsMills: "mills";
            readonly offeredMedia: "int";
            readonly offeredBundles: "int";
            readonly minPriceMills: "mills";
            readonly maxPriceMills: "mills";
            readonly salesCount: "int";
            readonly salesNetMills: "mills";
            readonly salesPendingMills: "mills";
            readonly lastObservedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "createdAt";
            readonly dir: "desc";
            readonly nullsLast: true;
        };
        readonly stableKey: readonly ["massMessageKey"];
    };
    /** Fansly tracking links (`linkKind` tracking; `linkType` 1 = Fansly's own
     *  FYP / Suggestions / Search, 1000 = the creator's) and gift links
     *  (`gift_code`), one row per link
     *  and UTC day it was read: the counters are cumulative, so a period's
     *  growth is the difference of two days. */
    readonly promo_links: {
        readonly moneyBearing: true;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly linkKind: "string";
            readonly linkRef: "string";
            readonly day: "date";
            readonly label: "string";
            readonly linkType: "int";
            readonly status: "int";
            readonly createdAt: "timestamp";
            readonly clicks: "int";
            readonly claims: "int";
            readonly follows: "int";
            readonly subscriptions: "int";
            readonly grossMills: "mills";
            readonly netMills: "mills";
            readonly uses: "int";
            readonly maxUses: "int";
            readonly priceMills: "mills";
            readonly originalPriceMills: "mills";
            readonly startsAt: "timestamp";
            readonly endsAt: "timestamp";
            readonly missingSince: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "day";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["promoLinkKey"];
    };
    /** Promotions of the subscription plans (a discounted price for a while),
     *  one row per promotion, with its tier and plan. */
    readonly tier_promos: {
        readonly moneyBearing: true;
        readonly verbatimText: true;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly tierRef: "string";
            readonly tierName: "string";
            readonly planRef: "string";
            readonly planDurationDays: "int";
            readonly planPriceMills: "mills";
            readonly promoRef: "string";
            readonly priceMills: "mills";
            readonly durationDays: "int";
            readonly status: "int";
            readonly maxUses: "int";
            readonly newSubscribersOnly: "bool";
            readonly startsAt: "timestamp";
            readonly endsAt: "timestamp";
            readonly descriptionText: "string";
            readonly lastObservedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "lastObservedAt";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["tierPromoKey"];
    };
    /** The page's polls, one row per option with its votes. */
    readonly polls: {
        readonly moneyBearing: false;
        readonly verbatimText: true;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly pollRef: "string";
            readonly pollTitleText: "string";
            readonly pollDescriptionText: "string";
            readonly status: "int";
            readonly createdAt: "timestamp";
            readonly optionPos: "int";
            readonly optionText: "string";
            readonly votes: "int";
            readonly lastObservedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "createdAt";
            readonly dir: "desc";
            readonly nullsLast: true;
        };
        readonly stableKey: readonly ["pollOptionKey"];
    };
    /** Fansly's own month totals with the creator's place among creators:
     *  `topPercent` «Top X%» (decimal text, smaller is better). Year 0 month 0 is
     *  Fansly's rolling last 30 days (`windowStart`..`windowEnd`). */
    readonly revenue_months: {
        readonly moneyBearing: true;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly year: "int";
            readonly month: "int";
            readonly windowStart: "timestamp";
            readonly windowEnd: "timestamp";
            readonly grossMills: "mills";
            readonly netMills: "mills";
            readonly topPercent: "string";
            readonly maxTopPercent: "string";
            readonly lastObservedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "year";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["revenueMonthKey"];
    };
    /** The page's automated messages: trigger (3 new follower, 15 new subscriber,
     *  15002 new gift-link subscriber, 15010 renew, 15012 gift-link renew, 7001
     *  new tip, 0 off), the tier it names, delay, cooldown and the text. */
    readonly automated_messages: {
        readonly moneyBearing: false;
        readonly verbatimText: true;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly automationRef: "string";
            readonly triggerType: "int";
            readonly tierName: "string";
            readonly delaySeconds: "int";
            readonly cooldownSeconds: "int";
            readonly messageText: "string";
            readonly attachmentCount: "int";
            readonly missingSince: "timestamp";
            readonly lastObservedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "lastObservedAt";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["automationKey"];
    };
    /** The page's Fansly settings and standing (0338, read daily): one row per
     *  setting (`route`) and distinct answer, with one line in Russian; `current`
     *  marks the answer seen last. The pending balance is `pending_balance`. */
    readonly page_settings: {
        readonly moneyBearing: false;
        readonly verbatimText: true;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly route: "string";
            readonly summaryText: "string";
            readonly firstSeenAt: "timestamp";
            readonly lastSeenAt: "timestamp";
            readonly current: "bool";
        };
        readonly defaultSort: {
            readonly field: "lastSeenAt";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["pageSettingsVersionKey"];
    };
    /** The page's balance in Fansly's hold (`/account/wallets/earnings`
     *  `pendingBalance`, read daily since 0338): one row per distinct value. */
    readonly pending_balance: {
        readonly moneyBearing: true;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly pendingMills: "mills";
            readonly firstSeenAt: "timestamp";
            readonly lastSeenAt: "timestamp";
            readonly current: "bool";
        };
        readonly defaultSort: {
            readonly field: "lastSeenAt";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["pendingBalanceKey"];
    };
    /** One tracking link's days (0339): clicks, claims, follows and
     *  subscriptions a UTC day, and its revenue that day over every transaction
     *  type (gross and net as Fansly serves them). Read from each link's creation;
     *  inside the read history a missing day is a zero. */
    readonly tracking_link_daily: {
        readonly moneyBearing: true;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly day: "date";
            readonly linkRef: "string";
            readonly label: "string";
            readonly clicks: "int";
            readonly claims: "int";
            readonly follows: "int";
            readonly subscriptions: "int";
            readonly grossMills: "mills";
            readonly netMills: "mills";
        };
        readonly defaultSort: {
            readonly field: "day";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["trackingLinkDayKey"];
    };
    /** The page's geo-blocks as its current answer names them (0338). */
    readonly geo_blocks: {
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly countryCode: "string";
            readonly country: "string";
            readonly stateCode: "string";
            readonly state: "string";
            readonly city: "string";
            readonly seenAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "seenAt";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["geoBlockKey"];
    };
    /** The tags discovery (For You, Suggestions, search) keeps for the page and
     *  its content, as the current answer names them (0338). */
    readonly discovery_tags: {
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly tag: "string";
            readonly contentRef: "string";
            readonly contentType: "int";
            readonly seenAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "seenAt";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["discoveryTagKey"];
    };
    /** Comments and post likes a UTC day (`source` -1) and media likes per surface. */
    readonly creator_stats_engagement: {
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly day: "date";
            readonly metric: "string";
            readonly source: "int";
            readonly value: "int";
            readonly capturedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "day";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["creatorStatsEngagementKey"];
    };
    /** Every `{ value, previous }` of one summary window as served (uniques and
     *  paying fans are not additive over days). Money metrics (`*Mills`) are in
     *  `valueMills` / `previousMills`, everything else in `value` / `previous`
     *  as decimal text; a flag is 1 or 0. */
    readonly creator_stats_windows: {
        readonly moneyBearing: true;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly afterDay: "date";
            readonly beforeDay: "date";
            readonly scope: "string";
            readonly ref: "string";
            readonly metric: "string";
            readonly value: "string";
            readonly previous: "string";
            readonly valueMills: "mills";
            readonly previousMills: "mills";
            readonly capturedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "beforeDay";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["creatorStatsWindowKey"];
    };
    /** Views and profile visits per viewer country, surface and window. A
     *  side the country is not among is null (zero, unless the answer was cut at
     *  its 200-row limit: coverage `reasonCode` `rows_at_limit`). `country` is
     *  the upper-case ISO code; '' is Fansly's "Unknown". */
    readonly creator_stats_geo: {
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly afterDay: "date";
            readonly beforeDay: "date";
            readonly windowDays: "int";
            readonly source: "int";
            readonly sourceLabel: "string";
            readonly country: "string";
            readonly views: "int";
            readonly imageViews: "int";
            readonly videoViews: "int";
            readonly watchMs: "int";
            /** The per-view watched share summed, in hundredths of a percent. */
            readonly watchPctSum: "string";
            /** As Fansly computed them: 0–100, and ms. */
            readonly avgWatchPercent: "string";
            readonly avgWatchMs: "string";
            readonly profileVisits: "int";
            readonly capturedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "beforeDay";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["creatorStatsGeoKey"];
    };
    /** A tag's totals over one window and surface. `kind` 1 = the tags viewers
     *  browsed by, 2 = the tags of posts. `liftPoints` (percentage points over
     *  the page's other viewers) is served only for windows up to 120 days
     *  (`liftAvailable`), and null inside one when there is no one to compare. */
    readonly creator_stats_tags: {
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly afterDay: "date";
            readonly beforeDay: "date";
            readonly windowDays: "int";
            readonly source: "int";
            readonly sourceLabel: "string";
            readonly kind: "int";
            readonly tagId: "string";
            readonly tag: "string";
            readonly views: "int";
            readonly imageViews: "int";
            readonly videoViews: "int";
            readonly watchMs: "int";
            readonly imageWatchMs: "int";
            readonly completedViews: "int";
            readonly watchPctSum: "string";
            readonly liftPoints: "string";
            readonly liftVideoViews: "int";
            readonly liftAvailable: "bool";
            readonly capturedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "beforeDay";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["creatorStatsTagsKey"];
    };
    /** A tag's views per UTC day and surface; no row inside a covered window is a zero. */
    readonly creator_stats_tag_series: {
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly day: "date";
            readonly source: "int";
            readonly sourceLabel: "string";
            readonly kind: "int";
            readonly tagId: "string";
            readonly tag: "string";
            readonly views: "int";
            readonly imageViews: "int";
            readonly capturedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "day";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["creatorStatsTagSeriesKey"];
    };
    /** The creator's own video averages per length bucket over the last 30
     *  settled days, per surface and day it was read (not a platform
     *  percentile). `maxMs` 0 is the open last bucket. */
    readonly creator_stats_benchmarks: {
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly afterDay: "date";
            readonly beforeDay: "date";
            readonly windowDays: "int";
            readonly source: "int";
            readonly sourceLabel: "string";
            readonly lengthBucket: "int";
            readonly minMs: "int";
            readonly maxMs: "int";
            readonly mediaCount: "int";
            readonly views: "int";
            readonly videoViews: "int";
            readonly watchMs: "int";
            readonly completedViews: "int";
            readonly watchPctSum: "string";
            readonly avgWatchPercent: "string";
            /** 0–1. */
            readonly completionRate: "string";
            readonly avgWatchMs: "string";
            readonly capturedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "beforeDay";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["creatorStatsBenchmarksKey"];
    };
    /** The number of different videos a surface put in front of someone over
     *  `hours` hours whose last hour starts at `endHour` (one hour per row from
     *  the hourly poll), and over the equally long span before. Distinct counts:
     *  hours do not add up to a day. */
    readonly creator_stats_media_shown: {
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly endHour: "timestamp";
            readonly hours: "int";
            readonly source: "int";
            readonly sourceLabel: "string";
            readonly mediaShown: "int";
            readonly previousMediaShown: "int";
            readonly capturedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "endHour";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["creatorStatsMediaShownKey"];
    };
    /** Views per UTC weekday (0 = Sunday) and UTC hour over the last 90
     *  settled days, per surface and day it was read; shift to a time zone at
     *  read time. */
    readonly creator_stats_active_hours: {
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly afterDay: "date";
            readonly beforeDay: "date";
            readonly windowDays: "int";
            readonly source: "int";
            readonly sourceLabel: "string";
            readonly weekday: "int";
            readonly hour: "int";
            readonly views: "int";
            readonly imageViews: "int";
            readonly capturedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "beforeDay";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["creatorStatsActiveHoursKey"];
    };
    /** Views and watch time of one media of an offer per surface and UTC day.
     *  `uniqueViewers` is per day: summing it over days double-counts. */
    readonly creator_stats_media_daily: {
        readonly ownContent: true;
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly mediaOfferId: "string";
            readonly mediaId: "string";
            readonly mediaType: "int";
            readonly source: "int";
            readonly sourceLabel: "string";
            readonly day: "date";
            readonly views: "int";
            readonly impressions: "int";
            readonly uniqueViewers: "int";
            readonly videoViews: "int";
            readonly completedViews: "int";
            readonly watchMs: "int";
            readonly watchPctSum: "string";
            readonly replays: "int";
            readonly durationMs: "int";
            readonly capturedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "day";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["creatorStatsMediaDailyKey"];
    };
    /** The same per hour (Fansly keeps about two days of a media's hours). */
    readonly creator_stats_media_hourly: {
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly mediaOfferId: "string";
            readonly mediaId: "string";
            readonly mediaType: "int";
            readonly source: "int";
            readonly sourceLabel: "string";
            readonly hourStart: "timestamp";
            readonly views: "int";
            readonly impressions: "int";
            readonly videoViews: "int";
            readonly completedViews: "int";
            readonly watchMs: "int";
            readonly watchPctSum: "string";
            readonly replays: "int";
            readonly capturedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "hourStart";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["creatorStatsMediaHourlyKey"];
    };
    /** A media's all-time figures on one surface as Fansly served them on
     *  `capturedDay` (they move: one row per day read). `retention` is the
     *  retention curve, each point `"<percent of the video>:<share still
     *  watching, 0–1>"`; empty for an image. */
    readonly creator_stats_media_totals: {
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly mediaOfferId: "string";
            readonly mediaId: "string";
            readonly mediaType: "int";
            readonly source: "int";
            readonly sourceLabel: "string";
            readonly capturedDay: "date";
            readonly views: "int";
            readonly impressions: "int";
            readonly videoViews: "int";
            readonly completedViews: "int";
            readonly watchMs: "int";
            readonly watchPctSum: "string";
            readonly replays: "int";
            readonly durationMs: "int";
            readonly retention: "string_array";
            readonly retentionSampleSize: "int";
            readonly capturedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "capturedDay";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["creatorStatsMediaTotalsKey"];
    };
    /** The views a viewer tag (`tagKind` 1; 2 = a tag of the post) brought a
     *  media over one read window (`afterDay` … `beforeDay`, both included). */
    readonly creator_stats_media_tags: {
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly mediaOfferId: "string";
            readonly mediaId: "string";
            readonly mediaType: "int";
            readonly source: "int";
            readonly sourceLabel: "string";
            readonly tagId: "string";
            readonly tag: "string";
            readonly tagKind: "int";
            readonly afterDay: "date";
            readonly beforeDay: "date";
            readonly views: "int";
            readonly videoViews: "int";
            readonly completedViews: "int";
            readonly watchMs: "int";
            readonly watchPctSum: "string";
            readonly capturedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "beforeDay";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["creatorStatsMediaTagKey"];
    };
    /** A tag's views of an offer a UTC day, per surface. */
    readonly creator_stats_media_tag_series: {
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly mediaOfferId: "string";
            readonly source: "int";
            readonly sourceLabel: "string";
            readonly tagId: "string";
            readonly tag: "string";
            readonly tagKind: "int";
            readonly day: "date";
            readonly views: "int";
            readonly capturedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "day";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["creatorStatsMediaTagSeriesKey"];
    };
    /** An offer's likes and unlikes per surface and UTC day. */
    readonly creator_stats_media_likes: {
        readonly ownContent: true;
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly mediaOfferId: "string";
            readonly source: "int";
            readonly sourceLabel: "string";
            readonly day: "date";
            readonly likes: "int";
            readonly unlikes: "int";
            readonly capturedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "day";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["creatorStatsMediaLikesKey"];
    };
    /** Fansly's top offers by `orderBy` of one surface and window, as its
     *  newest answer ranked them (`mediaType` 0 = images and videos together;
     *  `itemMediaType` is the row's own). The figures are the window's. */
    readonly creator_stats_media_top: {
        readonly moneyBearing: false;
        readonly verbatimText: false;
        readonly disclosesPurchase: false;
        readonly fields: {
            readonly platform: "string";
            readonly source: "int";
            readonly sourceLabel: "string";
            readonly mediaType: "int";
            readonly orderBy: "string";
            readonly afterDay: "date";
            readonly beforeDay: "date";
            readonly rank: "int";
            readonly mediaOfferId: "string";
            readonly mediaId: "string";
            readonly bestMediaId: "string";
            readonly offerLikes: "int";
            readonly offerUnlikes: "int";
            readonly itemMediaType: "int";
            readonly views: "int";
            readonly impressions: "int";
            readonly uniqueViewers: "int";
            readonly videoViews: "int";
            readonly completedViews: "int";
            readonly watchMs: "int";
            readonly watchPctSum: "string";
            readonly replays: "int";
            readonly durationMs: "int";
            readonly capturedAt: "timestamp";
        };
        readonly defaultSort: {
            readonly field: "beforeDay";
            readonly dir: "desc";
            readonly nullsLast: false;
        };
        readonly stableKey: readonly ["creatorStatsMediaTopKey"];
    };
};
export type AgentDataset = keyof typeof AGENT_DATASETS;
/**
 * Datasets the catalog must NAME rather than hide. The plane's whole premise is
 * that an absent answer is distinguishable from an absent capability, so a hole in
 * the data is declared, not omitted.
 *
 * `fan_earnings` stays planned and untouched: `fan_earnings_stats` exists in the
 * database (migration 0061) but not in the Drizzle schema and is read only by raw
 * SQL. The endpoints-cover initiative deliberately did not adopt it.
 *
 * WHAT LEFT THIS LIST, AND WHERE IT WENT (WP-S1):
 *   `vault_media`, `notifications`, `subscription_tiers`, `comments`, `likes`,
 *   `payouts` — PROMOTED to available above, each over the projection its
 *   capture package landed. Reusing the reserved key rather than minting a new
 *   name is deliberate: a caller that read the catalog a year ago and wrote
 *   `--dataset comments` now gets data instead of a 400.
 *
 *   `purchase_history` — SUPERSEDED by `message_media_sales`. It was never a
 *   dataset: it is a SYNC STREAM name whose canonicalization produces
 *   `message.ppv_unlocked` and which has no serving table at all. The question
 *   it stood for — what was offered and what was bought in DMs — is answered by
 *   `message_media_offers`, which `message_media_sales` serves under the
 *   `read:messages` + `read:money` pairing rule. Keeping the stale key beside
 *   its real answer would have advertised a second, better `purchase_history`
 *   that is never coming.
 */
export declare const AGENT_PLANNED_DATASETS: {
    readonly fan_earnings: {};
    readonly stories: {};
    readonly fan_lists: {};
    readonly livestreams: {};
    readonly chargebacks: {};
    readonly blocks: {};
};
export type AgentPlannedDataset = keyof typeof AGENT_PLANNED_DATASETS;
/** Derived. Anything that needs "which datasets are addressable" reads THIS. */
export declare const AGENT_DATASET_NAMES: readonly AgentDataset[];
/** Derived. The catalog lists these with `availability: "planned"`. */
export declare const AGENT_PLANNED_DATASET_NAMES: readonly AgentPlannedDataset[];
export declare function agentDatasetDefinition(dataset: string): AgentDatasetDefinition | undefined;
export type AgentDatasetFilterIssue = {
    readonly code: "unknown_field";
} | {
    readonly code: "operator_not_supported" | "value_type_mismatch";
    readonly kind: AgentDatasetFieldKind;
};
/**
 * Validates a dataset filter after the path/body schemas but before SQL mapping.
 * The issue contains no caller value, so a 400 can be logged or returned without
 * echoing potentially sensitive filter material.
 */
export declare function agentDatasetFilterIssue(dataset: string, input: {
    readonly field: string;
    readonly op: AgentDatasetFilterOperator;
    readonly value?: unknown;
}): AgentDatasetFilterIssue | null;
/**
 * The capabilities a key must hold to query this dataset: `read:datasets` always,
 * plus `read:money` for a money-bearing one and `read:messages` for one that
 * serves free text. Derived from the declaration, so a dataset that gains a money
 * field or a text body cannot keep the narrower requirement.
 */
export declare function agentDatasetRequiredCapabilities(dataset: AgentDataset): readonly AgentCapability[];
/** The datasets a `read:content` key reads (see `ownContent`). */
export declare const AGENT_OWN_CONTENT_DATASETS: ("notifications" | "posts" | "likes" | "transactions" | "fan_spend_daily" | "fan_notes" | "capture_coverage" | "ofapi_financial_snapshots" | "ofapi_payout_requests" | "campaign_snapshots" | "campaign_runs" | "campaign_bindings" | "campaigns" | "campaign_money_daily" | "fan_memberships" | "dm_threads" | "subscriptions" | "subscription_events" | "tip_transactions" | "follows" | "followers_daily" | "fan_aliases" | "note_attributions" | "raw_media" | "post_attachments" | "post_monetization" | "post_tips" | "tip_goals" | "traffic_daily" | "media_stats" | "top_media" | "top_tags" | "revenue_mix" | "message_media_sales" | "comments" | "vault_media" | "subscription_tiers" | "payouts" | "sync_streams" | "creator_stats_views" | "creator_stats_profile" | "creator_stats_follows" | "creator_stats_subscriptions" | "creator_stats_revenue" | "creator_stats_levels" | "page_profile" | "page_profile_daily" | "mass_messages" | "promo_links" | "tier_promos" | "polls" | "revenue_months" | "automated_messages" | "page_settings" | "pending_balance" | "tracking_link_daily" | "geo_blocks" | "discovery_tags" | "creator_stats_engagement" | "creator_stats_windows" | "creator_stats_geo" | "creator_stats_tags" | "creator_stats_tag_series" | "creator_stats_benchmarks" | "creator_stats_media_shown" | "creator_stats_active_hours" | "creator_stats_media_daily" | "creator_stats_media_hourly" | "creator_stats_media_totals" | "creator_stats_media_tags" | "creator_stats_media_tag_series" | "creator_stats_media_likes" | "creator_stats_media_top")[];
/**
 * What THIS key needs to query the dataset: `read:content` alone for an
 * `ownContent` dataset when the key holds it, otherwise the declared
 * requirement. A key without `read:content` is answered exactly as before.
 */
export declare function agentDatasetCapabilitiesFor(dataset: AgentDataset, granted: ReadonlySet<string>): readonly AgentCapability[];
/**
 * Free-form content includes `*Text` fields and user-written file/album names.
 *
 * A convention rather than a per-field flag because the scalar KIND cannot tell
 * `noteText` from `username` — both are `string` — and the thing that must not
 * drift is "does this dataset hand over prose", which the field name already says.
 */
export declare function agentDatasetFieldIsVerbatimText(field: string): boolean;
/** Every declared field of a dataset is filterable — the map IS the allowlist. */
export declare function agentDatasetFieldFilterable(): boolean;
/**
 * Sortable = the kind admits a deterministic order (numbers, money, instants,
 * dates), OR the field is this dataset's default sort. Free text and booleans are
 * deliberately excluded: sorting a page of transcripts by note text buys nothing
 * and costs an unindexable ORDER BY.
 */
export declare function agentDatasetFieldSortable(dataset: AgentDataset, field: string): boolean;
export type AgentDatasetFieldView = {
    readonly field: string;
    readonly kind: AgentDatasetFieldKind;
    readonly filterable: boolean;
    readonly sortable: boolean;
};
/** The catalog view of a dataset's fields, in declaration order. */
export declare function agentDatasetFields(dataset: AgentDataset): readonly AgentDatasetFieldView[];
