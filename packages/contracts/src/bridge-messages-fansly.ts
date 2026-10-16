// Fansly MAIN ↔ isolated bridge (R20, docs/project-unite/architecture.md §6), the per-type half: payload and answer
// schemas of every request, payload schemas of every event inside a batch, `fx.batch` and `fx.gap`, and the full
// discriminated frames. The type lists, the credits and the envelopes are in bridge-fansly.ts. Loaded by the
// `bridge-validation` chunk of the Fansly build only.
//
// What crosses from MAIN is metadata (§0 А5): ids, sides, times, states, counts. A message text crosses once — the
// tail of a generation snapshot, for a draft function, on the person's click (FanslySnapshot). Typing and read
// receipts never cross. A batch is checked whole: one bad event and the batch is lost as a whole — the isolated side
// acknowledges it, marks every chat unknown and asks `fx.state`, as after `fx.gap`.

import * as z from 'zod/mini';

import { BRIDGE_PROTOCOL_VERSION, BridgeRequestIdSchema, MainProbeSchema } from './bridge';
import {
  FANSLY_BRIDGE_LIMITS,
  FANSLY_BRIDGE_STATE_EVENTS,
  FANSLY_GAP_REASONS,
  FanslyBridgeResponseSchema,
  type FanslyWireEventType,
  type FromMainFanslyType,
  type ToMainFanslyType,
} from './bridge-fansly';
import { FANSLY_COMPLETENESS, FANSLY_COVERAGE_REASONS, FANSLY_LIMITS, FanslySnapshotSchema } from './fansly';
import { FeatureIdSchema, isFreshTextFeature } from './features';
import { ANCHOR_STATES, ConversationKindSchema, type FanScript } from './host';
import { CountSchema, DigestSchema, EpochTokenSchema, IsoTimestampSchema, NativeIdSchema } from './primitives';

const EmptySchema = z.strictObject({});
const AnchorStateSchema = z.enum(ANCHOR_STATES);

/** A guarded site of MAIN as a machine token: the same rule as ChatSpace's FAULT_SITE_PATTERN (a test holds them equal). */
const FAULT_SITE = /^[A-Za-z][A-Za-z0-9]{0,31}$/;

// ── State payloads ─────────────────────────────────────────────────────────

/** The FBuddy markers MAIN sees (§5.10): booleans only, for «Статус» and client_health. */
export const FanslyNeighbourSchema = z.strictObject({
  /** `script#fbuddy-window-bridge-script`. */
  windowBridge: z.boolean(),
  /** `window.__FBUDDY_NETWORK_HOOK__`. */
  networkHook: z.boolean(),
  /** `style#fb-fansly-style-fixes`. */
  styleFixes: z.boolean(),
  /** A non-empty `script#fbuddy-restricted-words-data`: its word filter is on. */
  wordFilter: z.boolean(),
});
export type FanslyNeighbour = z.infer<typeof FanslyNeighbourSchema>;

/** `fx.identity` (§5.7): who the page is signed in as, by the page's own `GET /account/me` answer. */
export const FanslyIdentityWireSchema = z
  .strictObject({
    /** `account.id` of that answer: the creator, equal to the hub page's external id (HF-1); null before it. */
    creatorId: z.nullable(NativeIdSchema),
    accountMeSeen: z.boolean(),
    /** The old extension's tap is on the page: this MAIN stands down entirely (FS-CO-1). */
    legacy: z.boolean(),
    fbuddy: FanslyNeighbourSchema,
  })
  .check(z.refine((i) => i.creatorId === null || i.accountMeSeen, { message: 'a creator comes only from the /account/me answer' }));
export type FanslyIdentityWire = z.infer<typeof FanslyIdentityWireSchema>;

/**
 * What the fan's own lines among the texts MAIN holds say about the fan's script — the language gate's FanScript
 * (AI-087, core `fanScriptOf`; the word is host.ts's since P4b1, the window of `ChatWindow`): Cyrillic in any of them —
 * `cyrillic`; fan lines without — `other`; none — `unknown`.
 */
export const FANSLY_FAN_SCRIPTS = ['cyrillic', 'other', 'unknown'] as const satisfies readonly FanScript[];

/** What MAIN holds about a chat's recent messages (§5.5, §5.6), with no text: for `chatWindow`, the dock and Hi's precheck. */
export const FanslyChatWindowSchema = z.strictObject({
  /** Messages MAIN holds for the chat, at most its ring. */
  loaded: z.int().check(z.gte(0), z.lte(FANSLY_LIMITS.ringRecords)),
  newestId: z.nullable(NativeIdSchema),
  newestAt: z.nullable(IsoTimestampSchema),
  completeness: z.enum(FANSLY_COMPLETENESS),
  /** The start of the conversation is proven, and the observation since is unbroken (§5.6). */
  startProven: z.boolean(),
  fanScript: z.enum(FANSLY_FAN_SCRIPTS),
});
export type FanslyChatWindow = z.infer<typeof FanslyChatWindowSchema>;

/**
 * `fx.chat` (§5.7, §6): a group as MAIN knows it from the page's answers. A direct chat has its one fan; a group chat
 * (more members) has none — no AI and no header slot (FS-IDN-3); before the members are known both are null.
 */
export const FanslyChatWireSchema = z
  .strictObject({
    groupId: NativeIdSchema,
    fanId: z.nullable(NativeIdSchema),
    kind: z.nullable(ConversationKindSchema),
    /** The DM rules (`dmPermissionFlags`, `accountDmPermissionFlags`) let the model write: false — copy only (FS-DOCK-3); null — unknown. */
    dmAllowed: z.nullable(z.boolean()),
    /** The route epoch of the `fx.focus` this group was focused with; a lower one is stale (FS-RTE-4). */
    routeEpoch: CountSchema,
    window: FanslyChatWindowSchema,
  })
  .check(z.refine((c) => (c.kind === 'direct') === (c.fanId !== null), { message: 'a direct chat names its fan; a group chat or an unknown one does not' }));
export type FanslyChatWire = z.infer<typeof FanslyChatWireSchema>;

/**
 * Whether the network tap still sees what it should (§5.10): `wrapped` — another Proxy or wrapper stands over the
 * constructor on top of ours; `silent` — the events stopped while the socket lives.
 */
export const FANSLY_TAP_STATES = ['ok', 'wrapped', 'silent'] as const;

/** `fx.contract` (§7.12): the network anchors, MAIN's part of the contract report. */
export const FanslyContractWireSchema = z.strictObject({
  anchors: z.strictObject({ accountMe: AnchorStateSchema, socket: AnchorStateSchema, frames: AnchorStateSchema, xhr: AnchorStateSchema }),
  tap: z.enum(FANSLY_TAP_STATES),
});
export type FanslyContractWire = z.infer<typeof FanslyContractWireSchema>;

/** The answer of `fx.state`: everything to start from, or to start again from after `fx.gap`. */
export const FanslyStateSchema = z
  .strictObject({
    identity: FanslyIdentityWireSchema,
    /** The page's socket: its epoch (0 — none created yet) and whether `t:1` confirmed it. */
    socket: z.strictObject({ epoch: CountSchema, confirmed: z.boolean() }),
    /** The focused group as `fx.chat` gives it; null — no focus, or MAIN does not know the group yet. */
    chat: z.nullable(FanslyChatWireSchema),
    contract: FanslyContractWireSchema,
    /** The number of the last `fx.batch` sent in this document (0 — none); the stream goes on after it. */
    lastBatch: CountSchema,
  })
  .check(z.refine((s) => !s.socket.confirmed || s.socket.epoch > 0, { message: 'only a created socket is confirmed' }));
export type FanslyState = z.infer<typeof FanslyStateSchema>;

/**
 * One of MAIN's own time histograms (HF-13: `frameParseMs`, `xhrParseMs`), over the bounds of its metric in
 * `PERF_METRICS` (telemetry.ts): the counts per bucket (one more than the bounds), their total, sum and max — what a
 * `PerfHistogram` carries besides its name and bounds, which the reader adds (MAIN repeats the bounds as literals,
 * pinned by its tests).
 */
export const FanslyPerfCountsSchema = z
  .strictObject({
    counts: z.array(CountSchema).check(z.minLength(2), z.maxLength(33)),
    count: CountSchema,
    sum: z.number().check(z.gte(0)),
    max: z.number().check(z.gte(0)),
  })
  .check(z.refine((h) => h.counts.reduce((a, b) => a + b, 0) === h.count, { message: 'count must equal the sum of counts' }));
export type FanslyPerfCounts = z.infer<typeof FanslyPerfCountsSchema>;

/**
 * The answer of `fx.health` (R20 P7a; §5.3, §5.4, §5.8, §6, §8.13): what MAIN counted since the document began, read
 * on demand — never pushed, never on a timer. The tap's «seen, not parsed» (SN-020, FS-WS-5), the observer's answers,
 * the stream under its credits, and MAIN's own times for client_health: its parse (P7a) and its step of a generation
 * snapshot (P7b, `snapshotMs`: the bounded drain and the snapshot, ≤ 5 ms).
 */
export const FanslyHealthSchema = z.strictObject({
  /** Text frames of the page's sockets: seen; parsed — a frame the page reads (a known `t`); lost — not read whole (FS-WS-2). */
  frames: z.strictObject({ seen: CountSchema, parsed: CountSchema, lost: CountSchema }),
  /** The page's API answers at `loadend`: seen; parsed by the table, at once or deferred; deferred; lost to a limit. */
  responses: z.strictObject({ seen: CountSchema, parsed: CountSchema, deferred: CountSchema, lost: CountSchema }),
  /** The stream: batches sent, those not acknowledged yet, events waiting, the bytes MAIN holds for it, `fx.gap`s sent. */
  stream: z.strictObject({
    batches: CountSchema,
    unacked: z.int().check(z.gte(0), z.lte(FANSLY_BRIDGE_LIMITS.maxUnackedBatches)),
    queued: CountSchema,
    heldBytes: CountSchema,
    gaps: CountSchema,
  }),
  perf: z.strictObject({ frameParseMs: FanslyPerfCountsSchema, xhrParseMs: FanslyPerfCountsSchema, snapshotMs: FanslyPerfCountsSchema }),
  /**
   * The person's sends (R20 P7f; §5.9): trusted gestures in the main composer; marked answers of exactly
   * `POST /api/v1/message` that are the creator's receipt in the gesture's chat; sends not told apart (`ambiguous`: two
   * such requests in one gesture, a gesture name another gesture shares, a send proven too long after its gesture) and
   * receipts with media — neither attributed; `fx.sent` said, and of them how many had the socket's echo before the
   * receipt and after it: the real order on Fansly, which the stand cannot show (spike P3a §3).
   */
  sends: z
    .strictObject({
      gestures: CountSchema,
      receipts: CountSchema,
      ambiguous: CountSchema,
      media: CountSchema,
      sent: CountSchema,
      echoFirst: CountSchema,
      receiptFirst: CountSchema,
    })
    .check(z.refine((s) => s.echoFirst + s.receiptFirst === s.sent, { message: 'every send said had its echo before its receipt or after it' })),
});
export type FanslyHealth = z.infer<typeof FanslyHealthSchema>;

// ── Requests ───────────────────────────────────────────────────────────────

/** `fx.generationSnapshot` (§5.8): `window` is the function's messageCount; MAIN takes the last min(60, window). */
export const FanslySnapshotRequestSchema = z
  .strictObject({ groupId: NativeIdSchema, feature: FeatureIdSchema, window: z.int().check(z.gte(1)), withText: z.boolean() })
  .check(z.refine((r) => !r.withText || isFreshTextFeature(r.feature), { message: 'page text only for Reply, Fix, Hi and Ping (D-14)' }));

/**
 * Requests isolated → MAIN: payload and answer schema of each `t`. None is a write (FANSLY_BRIDGE_WRITE_REQUESTS);
 * every one has the ordinary call timeout.
 */
export const TO_MAIN_FANSLY = {
  /** Answered by the shared boot itself, as on ChatSpace (`wsTap` is false here: the tap is part of this MAIN). */
  probe: { payload: EmptySchema, data: MainProbeSchema, write: false, timeout: 'call' },
  /** At start, after a restart of the isolated world, and after `fx.gap` — which it also ends: the stream resumes. */
  'fx.state': { payload: EmptySchema, data: FanslyStateSchema, write: false, timeout: 'call' },
  /** The group of the open route, with the isolated side's route epoch; MAIN answers with `fx.chat` when it knows the group. */
  'fx.focus': { payload: z.strictObject({ groupId: z.nullable(NativeIdSchema), routeEpoch: CountSchema }), data: z.null(), write: false, timeout: 'call' },
  /** null — MAIN does not know the chat's creator, group and fan (never seen, a group chat): no snapshot (FS-TAIL-7). */
  'fx.generationSnapshot': { payload: FanslySnapshotRequestSchema, data: z.nullable(FanslySnapshotSchema), write: false, timeout: 'call' },
  /** Passive group cache only: never opens a conversation or requests the site (R20 P9e). */
  'fx.groupForFan': { payload: z.strictObject({ creatorId: NativeIdSchema, fanId: NativeIdSchema }), data: z.strictObject({ groupId: z.nullable(NativeIdSchema) }), write: false, timeout: 'call' },
  /** The window summary of any group MAIN observes; null — not observed. */
  'fx.windowMeta': { payload: z.strictObject({ groupId: NativeIdSchema }), data: z.nullable(FanslyChatWireSchema), write: false, timeout: 'call' },
  /**
   * The isolated side took every batch up to `n`, parsed or not (a rejected one is a gap of its own): MAIN frees their
   * credits. Cumulative, so a late ack cannot hold credits forever.
   */
  'fx.ack': { payload: z.strictObject({ n: BridgeRequestIdSchema }), data: z.null(), write: false, timeout: 'call' },
  /** MAIN's counts, parse and snapshot times since the document began (R20 P7a, P7b): for «Статус», client_health and the e2e. */
  'fx.health': { payload: EmptySchema, data: FanslyHealthSchema, write: false, timeout: 'call' },
} as const satisfies Record<ToMainFanslyType, { readonly payload: z.ZodMiniType; readonly data: z.ZodMiniType; readonly write: false; readonly timeout: 'call' }>;

export type ToMainFanslyPayload<T extends ToMainFanslyType> = z.infer<(typeof TO_MAIN_FANSLY)[T]['payload']>;
export type ToMainFanslyData<T extends ToMainFanslyType> = z.infer<(typeof TO_MAIN_FANSLY)[T]['data']>;
/** §6 `ToMainFansly`: a request type with its payload. */
export type ToMainFansly = { [T in ToMainFanslyType]: { readonly t: T; readonly payload: ToMainFanslyPayload<T> } }[ToMainFanslyType];

// ── Events inside a batch ──────────────────────────────────────────────────

/**
 * Events MAIN → isolated inside `fx.batch`, without any message text (§6). Ids are strings of the snowflake order;
 * times are ISO strings of the page's `createdAt`.
 */
export const FROM_MAIN_FANSLY = {
  'fx.identity': FanslyIdentityWireSchema,
  'fx.chat': FanslyChatWireSchema,
  'fx.contract': FanslyContractWireSchema,
  /**
   * Every new message `5/1` of any chat of the account, ours too (§5.3): freshness, sound and the echo of a send from
   * the background. `fanId` — the group's fan, null when not known or a group chat.
   */
  'fx.incoming': z.strictObject({
    groupId: NativeIdSchema,
    fanId: z.nullable(NativeIdSchema),
    msgId: NativeIdSchema,
    /** P14a: the actual author, also when the group has not been read. Older MAIN may omit it. */
    senderId: z.optional(NativeIdSchema),
    /** Creator at capture time: a queued fact must not move to the next login. */
    accountId: z.optional(z.nullable(NativeIdSchema)),
    fromFan: z.boolean(),
    automated: z.boolean(),
    tip: z.boolean(),
    createdAt: z.nullable(IsoTimestampSchema),
  }),
  /** A new subscriber `3/2` (FollowerService), for the sound (§8.12). */
  'fx.follow': z
    .strictObject({ eventId: NativeIdSchema, accountId: NativeIdSchema, followerId: NativeIdSchema })
    .check(z.refine((f) => f.accountId !== f.followerId, { message: 'an account does not follow itself' })),
  /**
   * A send by the person, attributed (§5.9): a trusted gesture, a receipt of exactly `POST /api/v1/message` and the
   * echo `5/1` with the same id. The digest of the sent `content` is MAIN's; the text does not cross. `gestureAt` (R20
   * P7f) names the gesture: the `timeStamp` of its event, which both worlds read from the same event — the isolated
   * side links the send only to the draft it read at that very gesture.
   */
  'fx.sent': z.strictObject({ groupId: NativeIdSchema, msgId: NativeIdSchema, contentDigest: DigestSchema, gestureAt: z.number().check(z.gte(0)) }),
  /** The completeness of chats changed (§5.6): `complete` only by a certificate of one chat; `all` only ever lowers it. */
  'fx.coverage': z
    .strictObject({
      groupIds: z.union([z.literal('all'), z.array(NativeIdSchema).check(z.minLength(1), z.maxLength(FANSLY_LIMITS.maxChats))]),
      state: z.enum(FANSLY_COMPLETENESS),
      reason: z.enum(FANSLY_COVERAGE_REASONS),
    })
    .check(
      z.refine((c) => (c.state === 'complete') === (c.reason === 'certificate') && (c.state === 'unknown' || c.groupIds !== 'all'), {
        message: 'complete only by a certificate of named chats; every other reason lowers',
      }),
    ),
  /** Messages of the focused group deleted (`5/10`, with the cascade of a deleted `type 3`), oldest first. */
  'fx.deleted': z.strictObject({ groupId: NativeIdSchema, ids: z.array(NativeIdSchema).check(z.minLength(1), z.maxLength(FANSLY_LIMITS.ringRecords)) }),
  /**
   * A successful `POST` of exactly `/vault/albums/media` (§7.11): only the observation's number — the page does not
   * read that answer's body, so neither album nor media ids come from it (P3a).
   */
  'fx.vaultAdded': z.strictObject({ seq: CountSchema }),
  /**
   * The page asked an album's media (`GET /media/vaultnew`, §7.11, R20 P13a): the album it shows — opened, or
   * reloaded after `POST /vault/albums/media` — by the `albumId=` of the request's address; null — a type album of
   * the vault (`type=`: «Posts», «Messages»), which has no id. A 2xx answer; its body is not read. `seq` — the
   * observation's number, as `fx.vaultAdded`'s: a reload after an addition has the greater one.
   */
  'fx.vaultLoaded': z.strictObject({ albumId: z.nullable(NativeIdSchema), seq: CountSchema }),
} as const satisfies Record<FromMainFanslyType, z.ZodMiniType>;

export type FromMainFanslyPayload<T extends FromMainFanslyType> = z.infer<(typeof FROM_MAIN_FANSLY)[T]>;
/** §6 `FromMainFansly`: an event type with its payload. */
export type FromMainFansly = { [T in FromMainFanslyType]: { readonly t: T; readonly p: FromMainFanslyPayload<T> } }[FromMainFanslyType];

const batchEvent = <T extends FromMainFanslyType>(t: T) => z.strictObject({ t: z.literal(t), p: FROM_MAIN_FANSLY[t] });

/** One event of a batch: its type `t` and payload `p` (short keys: a batch carries hundreds). */
export const FanslyBatchEventSchema = z.discriminatedUnion('t', [
  batchEvent('fx.identity'),
  batchEvent('fx.chat'),
  batchEvent('fx.contract'),
  batchEvent('fx.incoming'),
  batchEvent('fx.follow'),
  batchEvent('fx.sent'),
  batchEvent('fx.coverage'),
  batchEvent('fx.deleted'),
  batchEvent('fx.vaultAdded'),
  batchEvent('fx.vaultLoaded'),
]);

const STATES: readonly string[] = FANSLY_BRIDGE_STATE_EVENTS;

/** A state goes at most once per batch: the latest one won before the batch left. */
function statesOnce(events: ReadonlyArray<{ readonly t: string }>): boolean {
  const seen = new Set<string>();
  for (const { t } of events) {
    if (!STATES.includes(t)) continue;
    if (seen.has(t)) return false;
    seen.add(t);
  }
  return true;
}

// ── Wire events ────────────────────────────────────────────────────────────

/**
 * `fx.batch` (§6): the events of one listener call and whatever waited in the queue, in order, under the credits.
 * `n` grows by one per batch in a document and is not reset by `fx.gap`; the isolated side answers `fx.ack`.
 */
export const FanslyBatchSchema = z.strictObject({
  n: BridgeRequestIdSchema,
  events: z
    .array(FanslyBatchEventSchema)
    .check(z.minLength(1), z.maxLength(FANSLY_BRIDGE_LIMITS.maxBatchEvents), z.refine(statesOnce, { message: 'a state goes at most once per batch' })),
});
export type FanslyBatch = z.infer<typeof FanslyBatchSchema>;

/** `fx.gap` (§6, FS-TAIL-5): one notice that MAIN stopped; every chat is unknown until `fx.state`. */
export const FanslyGapSchema = z.strictObject({ reason: z.enum(FANSLY_GAP_REASONS) });
export type FanslyGap = z.infer<typeof FanslyGapSchema>;

/** Event frames on the port: payload schema of each wire type. */
export const FANSLY_WIRE_EVENTS = {
  'fx.batch': FanslyBatchSchema,
  'fx.gap': FanslyGapSchema,
  /** A failure of our own MAIN code a guard caught (decision X22): the site and how often, at 1, 2, 4, 8… */
  fault: z.strictObject({ source: z.string().check(z.regex(FAULT_SITE)), count: z.int().check(z.gte(1)) }),
} as const satisfies Record<FanslyWireEventType, z.ZodMiniType>;

export type FanslyWireEventPayload<T extends FanslyWireEventType> = z.infer<(typeof FANSLY_WIRE_EVENTS)[T]>;

// ── Frames ─────────────────────────────────────────────────────────────────

function requestFrame<T extends ToMainFanslyType>(t: T) {
  return z.strictObject({
    v: z.literal(BRIDGE_PROTOCOL_VERSION),
    kind: z.literal('req'),
    id: BridgeRequestIdSchema,
    t: z.literal(t),
    /** The document epoch the isolated side last saw; null before the first frame from MAIN. */
    documentEpoch: z.nullable(EpochTokenSchema),
    seq: CountSchema,
    payload: TO_MAIN_FANSLY[t].payload,
  });
}

/** A request isolated → MAIN. MAIN checks the same shape by hand. */
export const FanslyBridgeRequestSchema = z.discriminatedUnion('t', [
  requestFrame('probe'),
  requestFrame('fx.state'),
  requestFrame('fx.focus'),
  requestFrame('fx.generationSnapshot'),
  requestFrame('fx.groupForFan'),
  requestFrame('fx.windowMeta'),
  requestFrame('fx.ack'),
  requestFrame('fx.health'),
]);
export type FanslyBridgeRequest = z.infer<typeof FanslyBridgeRequestSchema>;

function eventFrame<T extends FanslyWireEventType>(t: T) {
  return z.strictObject({
    v: z.literal(BRIDGE_PROTOCOL_VERSION),
    kind: z.literal('evt'),
    t: z.literal(t),
    documentEpoch: EpochTokenSchema,
    seq: CountSchema,
    payload: FANSLY_WIRE_EVENTS[t],
  });
}

/** An event frame MAIN → isolated. */
export const FanslyBridgeEventSchema = z.discriminatedUnion('t', [eventFrame('fx.batch'), eventFrame('fx.gap'), eventFrame('fault')]);
export type FanslyBridgeEvent = z.infer<typeof FanslyBridgeEventSchema>;

/** Everything MAIN may send on the port, after `checkBridgeFrame` and the byte limit of its type (`fanslyFrameByteLimit`). */
export const FromMainFanslyFrameSchema = z.union([FanslyBridgeResponseSchema, FanslyBridgeEventSchema]);
export type FromMainFanslyFrame = z.infer<typeof FromMainFanslyFrameSchema>;

/**
 * Stage three of an answer: the answer schema of the request's own type. The result says whether it passed — `null`
 * is a valid answer of several requests (`fx.focus`, `fx.ack`, a snapshot MAIN cannot give), never a failure by itself.
 */
export function parseFanslyBridgeData<T extends ToMainFanslyType>(t: T, data: unknown): { readonly ok: true; readonly data: ToMainFanslyData<T> } | { readonly ok: false } {
  const parsed = TO_MAIN_FANSLY[t].data.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data as ToMainFanslyData<T> } : { ok: false };
}

/** Stage three of an event frame: the payload schema of its wire type; null — it did not pass (a batch: lost whole). */
export function parseFanslyWireEvent<T extends FanslyWireEventType>(t: T, payload: unknown): FanslyWireEventPayload<T> | null {
  const parsed = FANSLY_WIRE_EVENTS[t].safeParse(payload);
  return parsed.success ? (parsed.data as FanslyWireEventPayload<T>) : null;
}
