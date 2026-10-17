import type { PageDiagnostics } from './diagnostics';
// The host port (architecture.md §5.2, §6): everything the extension may know
// about and do to the host page. Page memory, with one read of the network
// since 1.22.0 (X51): the messages of the chat the person has open, from the
// host's own API (`openChatMessages`) — never another chat's, whose history
// load would mark it read. The port never has, and never will have,
// fetchHistory() of any chat, markRead(), setStore(), a general send() or an
// arbitrary execute(). Writes: guarded insert, navigation on a human action,
// and the X8 preview send (PreviewSendPort).

import * as z from 'zod/mini';

import { CgCodeSchema } from './errors';
import { type FeatureId } from './features';
import { HOST_PLATFORM } from './hosts';
import {
  ChatRefSchema,
  DraftProvenanceSchema,
  HostAccountSchema,
  HostKindSchema,
  HumanCauseSchema,
  PartRefSchema,
  type ChatRef,
  type DraftSnapshot,
  type HostAccount,
  type HostIdentity,
  type HostKind,
  type Platform,
} from './ids';
import { BRIDGE_LIMITS, LIVE_TEXT_LIMITS, OPEN_CHAT_LIMITS, STORAGE_LIMITS } from './limits';
import {
  CountSchema,
  DigestSchema,
  DurationMsSchema,
  EpochMsSchema,
  EpochTokenSchema,
  IsoTimestampSchema,
  NativeIdSchema,
  UuidSchema,
  boundedText,
  displayText,
  type IsoTimestamp,
  type NativeId,
} from './primitives';
import { type FreshnessCheckpoint, type PreviewSendPort, type SendFuseFact } from './send';
import { RECEIPT_MATCH_KINDS } from './send-rules';

export type Unsubscribe = () => void;

/** What the port can do; each one degrades on its own (§6.2). */
export const HOST_CAPABILITIES = [
  'identity',
  'route',
  'accounts',
  'dockMount',
  'insert',
  'draftRead',
  'chatWindow',
  'freshText',
  'fan',
  'chatList',
  'sendObserve',
  'incoming',
  'navigate',
  'theme',
  'previewSend',
  'receipt',
] as const;
export const HostCapabilitySchema = z.enum(HOST_CAPABILITIES);
export type HostCapability = z.infer<typeof HostCapabilitySchema>;

export const CAPABILITY_STATES = ['on', 'degraded', 'off', 'contractBroken'] as const;
export const CapabilityStateSchema = z.strictObject({
  state: z.enum(CAPABILITY_STATES),
  /** Short machine reason (anchor id, flag name). */
  reason: z.optional(boundedText(64)),
  /** The code the person sees when the capability is not `on`. */
  code: z.optional(CgCodeSchema),
});
export type CapabilityState = z.infer<typeof CapabilityStateSchema>;

/** Anchors of the host contract check (§6.2 table), one id per row. */
export const ANCHOR_IDS = [
  'app',
  'router',
  'accounts',
  'composerBridge',
  'composerFrame',
  'chatMessages',
  'fansMap',
  'pendingMessages',
  'draftKey',
  'wsFrames',
  'chatList',
  'composerTranslator',
  'mimic',
  'userPermissions',
  'receiptProfile',
  'theme',
] as const;
export const AnchorIdSchema = z.enum(ANCHOR_IDS);
export type AnchorId = z.infer<typeof AnchorIdSchema>;

/**
 * `missing` — not there; `shape` — there, not as expected. `notYet` (1.10.0) — not there yet, and that is
 * expected now: ChatSpace creates it later, with the first chat composer of the page (its composer translator
 * store), and keeps it until the page reloads. What needs it stays off until then; it is no break of the contract.
 */
export const ANCHOR_STATES = ['ok', 'missing', 'shape', 'notYet'] as const;
export type AnchorState = (typeof ANCHOR_STATES)[number];

/**
 * ChatSpace's report: the full schema it has had since 1.0.0 — every anchor of ANCHOR_IDS named, one missing key
 * and the report is refused. `host` (1.15.0, R20 F7) is absent in every report of an adapter before 1.15.0, and
 * ChatSpace's adapter need not name it: a report without `host` is ChatSpace's.
 */
export const ChatSpaceContractReportSchema = /* @__PURE__ */ z.strictObject({
  host: z.optional(z.literal('chatspace')),
  /** Fingerprint of the host build (the hashed name of its entry module): a diagnostic signal, not the check itself. */
  build: z.nullable(displayText(80)),
  adapterVersion: boundedText(32),
  checkedAt: EpochMsSchema,
  anchors: z.record(AnchorIdSchema, z.enum(ANCHOR_STATES)),
  capabilities: z.record(HostCapabilitySchema, CapabilityStateSchema),
  /**
   * 1.11.0 (decision X25): the receipt profile of the bootstrap that let X8 in on this page, and how — `exact` (a
   * reviewed build) or `anyBuild` (the hub's «any build» sentinel: no review). Absent — none matched, or the
   * preview send is not switched on (an adapter before 1.11.0 never says).
   */
  receiptMatch: z.optional(z.strictObject({ profile: boundedText(64), kind: z.enum(RECEIPT_MATCH_KINDS) })),
});
export type ChatSpaceContractReport = z.infer<typeof ChatSpaceContractReportSchema>;

/** The sites whose report is not ChatSpace's shape: their anchors and own capabilities are in a block of their own. */
export const SITE_REPORT_HOSTS = ['fansly-web'] as const satisfies readonly Exclude<HostKind, 'chatspace'>[];

/** A name of a site's own anchor or capability (its contract module lists them, R20 §7.12): a short machine token. */
const SiteContractNameSchema = /* @__PURE__ */ z.string().check(z.regex(/^[A-Za-z][A-Za-z0-9]{0,63}$/));
/** A block names a bounded number of anchors (32) and of capabilities (16). */
const atMost = (max: number) => z.refine<Readonly<Record<string, unknown>>>((named) => Object.keys(named).length <= max, { message: 'too many names' });

/**
 * 1.15.0 (R20 F7): a site's own block of its report (`extensions[<site>]`) — the state of each of its anchors and of
 * each capability it has beyond HOST_CAPABILITIES. Which anchors the block must name is the site's (its expected
 * set, `HostContractShape`): whoever reads the report reads that set, and an anchor the block does not name is
 * `missing` there — never «nothing to check» (FS-CTR-1).
 */
export const SiteContractBlockSchema = /* @__PURE__ */ z.strictObject({
  anchors: z.record(SiteContractNameSchema, z.enum(ANCHOR_STATES)).check(atMost(32)),
  capabilities: z.record(SiteContractNameSchema, CapabilityStateSchema).check(atMost(16)),
});
export type SiteContractBlock = z.infer<typeof SiteContractBlockSchema>;

/**
 * 1.15.0 (R20 F7): the report of a site other than ChatSpace — the build, the shared capabilities, every one named,
 * and its own block `extensions[<its host>]`, required; no ChatSpace anchors and no X8 receipt profile.
 */
export const SiteContractReportSchema = /* @__PURE__ */ z
  .strictObject({
    host: z.enum(SITE_REPORT_HOSTS),
    build: z.nullable(displayText(80)),
    adapterVersion: boundedText(32),
    checkedAt: EpochMsSchema,
    capabilities: z.record(HostCapabilitySchema, CapabilityStateSchema),
    extensions: z.partialRecord(HostKindSchema, SiteContractBlockSchema),
  })
  .check(
    z.refine((report) => report.extensions[report.host] !== undefined && Object.keys(report.extensions).length === 1, {
      message: "a site's report carries its own block, and no other",
    }),
  );
export type SiteContractReport = z.infer<typeof SiteContractReportSchema>;

/**
 * The host contract report (§6.2), parsed by `host` (1.15.0, R20 F7): no `host` or `'chatspace'` — ChatSpace's full
 * schema, as before; another site — its own shape with its block.
 */
export const HostContractReportSchema = /* @__PURE__ */ z.union([ChatSpaceContractReportSchema, SiteContractReportSchema]);
export type HostContractReport = z.infer<typeof HostContractReportSchema>;

/** The site a report is of: a report that names none is ChatSpace's (every adapter before 1.15.0). */
export function contractHostOf(report: HostContractReport): HostKind {
  return report.host ?? 'chatspace';
}

/** The anchors a report names, whichever its site: ChatSpace's at the top, another site's in its own block. */
export function contractAnchorsOf(report: HostContractReport): Readonly<Record<string, AnchorState>> {
  return 'anchors' in report ? report.anchors : (report.extensions[report.host]?.anchors ?? {});
}

/**
 * What a site's report must name (1.15.0, R20 F7; architecture §7.12, FS-CTR-1): the contract facts of the tab's
 * log, «Статус» and the popup read this set, never the keys a report happens to carry — an expected anchor the
 * report does not name is `missing`. The site's adapter and the extension pages' composition root hand it over.
 */
export interface HostContractShape {
  /** Every anchor of the site. */
  readonly anchors: readonly string[];
  /** Anchors of a part the owner switches on separately: `missing` while its switch is off is the normal state of a shift, not a break. */
  readonly switchedAnchors: readonly string[];
  /** The capabilities of those parts: not `on` while switched off is no degraded contract. */
  readonly switchedCapabilities: readonly HostCapability[];
}

/**
 * ChatSpace's: every anchor of ANCHOR_IDS. Part B of its adapter (§6.2, §6.7, §6.8) — the WebSocket tap (`wsFrames`)
 * and X8's receipt profile — is the owner's switch: without it the adapter reports both anchors `missing` (nothing of
 * that part is in the page) and the capabilities of the tap and X8 off.
 */
export const CHATSPACE_CONTRACT: HostContractShape = {
  anchors: ANCHOR_IDS,
  switchedAnchors: ['wsFrames', 'receiptProfile'],
  switchedCapabilities: ['previewSend', 'incoming', 'receipt', 'sendObserve'],
};

export const ROUTE_NAMES = ['chat', 'accounts-overview', 'other'] as const;

/** 1.15.0 (R20): `direct` — the creator and one fan; `group` — more than one fan: no fan of its own, no dock, no AI. */
export const CONVERSATION_KINDS = ['direct', 'group'] as const;
export const ConversationKindSchema = z.enum(CONVERSATION_KINDS);
export type ConversationKind = z.infer<typeof ConversationKindSchema>;

/**
 * 1.15.0 (R20): the conversation of a route fits the route — only a chat route names one; its kind comes only with
 * it; a group has no fan of its own (`chat` is null: no dock, no AI on one of its fans); on OnlyFans the conversation
 * is the fan, as in Target. One check, not four: the contract probes count every check of this module in full (R20
 * byte registry).
 */
export function conversationFits(route: {
  readonly name: (typeof ROUTE_NAMES)[number];
  readonly chat: ChatRef | null;
  readonly conversationRef?: string | undefined;
  readonly conversationKind?: ConversationKind | undefined;
}): boolean {
  const { chat, conversationRef: ref } = route;
  return ref === undefined
    ? route.conversationKind === undefined
    : route.name === 'chat' && (route.conversationKind !== 'group' || chat === null) && (chat === null || HOST_PLATFORM[chat.host] !== 'onlyfans' || ref === chat.platformFanId);
}

/**
 * The route of the host page. The `@__PURE__` mark (1.15.0): `.check()` is a method call, which a bundler keeps
 * even where nothing parses the schema; the mark lets a bundle that never reads a route (the background) drop it
 * (R20 byte registry).
 */
export const RouteStateSchema = /* @__PURE__ */ z
  .strictObject({
    epoch: CountSchema,
    name: z.enum(ROUTE_NAMES),
    account: z.nullable(HostAccountSchema),
    chat: z.nullable(ChatRefSchema),
    /**
     * 1.15.0 (R20): the host's conversation of a chat route, as the address names it — on Fansly the group id of
     * `/messages/<groupId>`, known before the fan is (`chat` comes once the page names the fan). Absent — the
     * conversation is the chat's fan (ChatSpace: conversationRef = fanRef, as in Target).
     */
    conversationRef: z.optional(NativeIdSchema),
    /** 1.15.0 (R20): direct or group, once the host knows the participants; absent — not known yet. */
    conversationKind: z.optional(ConversationKindSchema),
  })
  .check(z.refine(conversationFits, { message: 'the conversation does not fit the route' }));
export type RouteState = z.infer<typeof RouteStateSchema>;

export const ComposerStateSchema = z.strictObject({
  chat: ChatRefSchema,
  instanceId: EpochTokenSchema,
  ready: z.boolean(),
  /** The fan is blocked: ChatSpace hides the composer; we show a copy-only row. */
  hidden: z.boolean(),
  draft: z.strictObject({ revision: CountSchema, provenance: DraftProvenanceSchema }),
});
export type ComposerState = z.infer<typeof ComposerStateSchema>;

/**
 * What MAIN compares in the one synchronous step right before the write
 * (§6.4). `open`: the chat is open now, so the expected route, composer and
 * draft (revision and digest of the whole document) are known — a CAS.
 * `deferred` («Открыть и вставить», §6.5): the target's draft is unknown
 * before the navigation, so MAIN reads it after the route settled (new route
 * epoch, two stable identity observations, a working editor), in the same
 * step as the write, and writes only into an empty draft or our own
 * unchanged insert; any other draft is `rejected` with
 * `confirm-human-draft`, and the person's choice comes back as an `open`
 * intent on the revision that was read.
 */
export const InsertExpectationSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('open'),
    documentEpoch: EpochTokenSchema,
    routeEpoch: CountSchema,
    composerInstanceId: EpochTokenSchema,
    draftRevision: CountSchema,
    draftDigest: DigestSchema,
  }),
  z.strictObject({ kind: z.literal('deferred'), documentEpoch: EpochTokenSchema }),
]);
export type InsertExpectation = z.infer<typeof InsertExpectationSchema>;

const insertShape = {
  intentId: UuidSchema,
  operationId: UuidSchema,
  part: PartRefSchema,
  target: ChatRefSchema,
  expected: InsertExpectationSchema,
  mode: z.enum(['replace', 'append']),
  /** Plain text; ChatSpace's bridge escapes it. */
  text: boundedText(BRIDGE_LIMITS.maxStringLength),
  /** One-time consent for this draft revision (Б2); never on a deferred insert (no draft was seen). */
  confirmationId: z.nullable(UuidSchema),
  createdAt: EpochMsSchema,
  expiresAt: EpochMsSchema,
};
type InsertShape = { readonly expected: InsertExpectation; readonly mode: 'replace' | 'append'; readonly confirmationId: string | null; readonly createdAt: number; readonly expiresAt: number };
const insertTimesHold = (i: InsertShape): boolean => i.expiresAt > i.createdAt;
const deferredHolds = (i: InsertShape): boolean => i.expected.kind === 'open' || (i.confirmationId === null && i.mode === 'replace');
const INSERT_TIMES = { message: 'expiresAt must be after createdAt' } as const;
const INSERT_DEFERRED = { message: 'a deferred insert replaces an empty or our own draft and carries no consent' } as const;

/**
 * The insert as MAIN receives it: no action token (§14). Also the
 * `thenInsert` of a navigation, which the navigation's own cause covers.
 */
export const InsertWireSchema = z.strictObject(insertShape).check(z.refine(insertTimesHold, INSERT_TIMES), z.refine(deferredHolds, INSERT_DEFERRED));
export type InsertWire = z.infer<typeof InsertWireSchema>;

/**
 * Insert intent of the isolated side (HostPort.insert): the wire form plus
 * the one-time action token of the click or key that asked for it (§14).
 * HostPort.insert redeems the token (`token.redeem`, kind `insert`) before
 * the bridge call and strips it; a refused token is `rejected`
 * CG-INSERT-FAILED with nothing sent to MAIN. Only `open` intents go
 * through insert(); a deferred one rides a navigation.
 */
export const InsertIntentSchema = z
  .strictObject({ ...insertShape, cause: HumanCauseSchema })
  .check(z.refine(insertTimesHold, INSERT_TIMES), z.refine(deferredHolds, INSERT_DEFERRED));
export type InsertIntent = z.infer<typeof InsertIntentSchema>;

export const InsertReceiptSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('applied'),
    draftRevision: CountSchema,
    draftDigest: DigestSchema,
    ms: DurationMsSchema,
  }),
  z.strictObject({
    state: z.literal('rejected'),
    code: CgCodeSchema,
    needs: z.optional(z.enum(['confirm-human-draft', 'confirm-changed-draft'])),
  }),
  /** Not inserted again; only read for reconciliation. */
  z.strictObject({ state: z.literal('uncertain'), code: CgCodeSchema }),
]);
export type InsertReceipt = z.infer<typeof InsertReceiptSchema>;

/** A navigation target and the insert that follows it: same account and fan, deferred, only into a chat. */
export function thenInsertFits(insert: InsertWire | undefined, hostAccountId: string, platformFanId: string | null): boolean {
  if (insert === undefined) return true;
  return (
    platformFanId !== null &&
    insert.expected.kind === 'deferred' &&
    insert.target.hostAccountId === hostAccountId &&
    insert.target.platformFanId === platformFanId
  );
}

const THEN_INSERT_FITS = {
  message: 'thenInsert goes only with a chat target, to the same account and fan, as a deferred insert',
} as const;

/**
 * «Открыть и вставить» and plain navigation; only on a human action (§6.5,
 * §6.9). HostPort.navigate redeems `cause` (`token.redeem`, kind `navigate`)
 * before the bridge call; a refused token is `failed` CG-NAV-FAILED. MAIN
 * compares the settled route's chat with `target` in the same synchronous
 * step as the deferred insert. Marked pure as RouteStateSchema is (1.15.0):
 * the background never parses a navigation.
 */
export const NavigationIntentSchema = /* @__PURE__ */ z
  .strictObject({
    intentId: UuidSchema,
    cause: HumanCauseSchema,
    target: z.strictObject({
      hostAccountId: NativeIdSchema,
      /** null — open the account (Б13). */
      platformFanId: z.nullable(NativeIdSchema),
      /**
       * 1.15.0 (R20): the conversation of that fan when it is not the fan — on Fansly the group id, from the route or
       * the fan's group resolution, never from the route of another chat. Absent — the conversation is the fan.
       */
      conversationRef: z.optional(NativeIdSchema),
    }),
    /** Covered by this navigation's cause; the wire form, deferred. */
    thenInsert: z.optional(InsertWireSchema),
  })
  .check(
    z.refine((n) => thenInsertFits(n.thenInsert, n.target.hostAccountId, n.target.platformFanId), THEN_INSERT_FITS),
    z.refine((n) => n.target.conversationRef === undefined || n.target.platformFanId !== null, {
      message: 'conversationRef needs a chat target, not an account',
    }),
  );
export type NavigationIntent = z.infer<typeof NavigationIntentSchema>;

export const NavigationReceiptSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('navigated'),
    routeEpoch: CountSchema,
    /** The outcome of `thenInsert`; null when there was none. */
    insert: z.nullable(InsertReceiptSchema),
  }),
  /**
   * CG-NAV-FAILED, CG-NAV-TIMEOUT, CG-INSERT-CANCELED… `insert` — the
   * thenInsert's outcome when one was asked for: `uncertain` after a bridge
   * timeout (it may have run), null when there was none.
   */
  z.strictObject({ state: z.literal('failed'), code: CgCodeSchema, insert: z.nullable(InsertReceiptSchema) }),
]);
export type NavigationReceipt = z.infer<typeof NavigationReceiptSchema>;

export const LiveTextMessageSchema = z.strictObject({
  platformMessageId: NativeIdSchema,
  direction: z.enum(['fan', 'model']),
  sentAt: IsoTimestampSchema,
  text: boundedText(LIVE_TEXT_LIMITS.maxChars),
});

/**
 * Fresh text of the open chat (D-14) as it goes to the hub: only confirmed
 * messages with a numeric id, never queued or unsent ones, text-only
 * (media-only messages are left out), at most the hub's 60 items. Only for
 * Reply/Fix/Hi/Ping; never written to disk.
 */
export const LiveTextTailSchema = z.strictObject({
  capturedAt: IsoTimestampSchema,
  messages: z.array(LiveTextMessageSchema).check(z.minLength(1), z.maxLength(LIVE_TEXT_LIMITS.maxItems)),
});
export type LiveTextTail = z.infer<typeof LiveTextTailSchema>;

/**
 * The same tail as one bridge snapshot from MAIN: up to the snapshot limit of
 * 200 messages (§5.3); the isolated side trims it to the bootstrap limit
 * before it becomes a LiveTextTail.
 */
export const TailSnapshotSchema = z.strictObject({
  capturedAt: IsoTimestampSchema,
  messages: z.array(LiveTextMessageSchema).check(z.minLength(1), z.maxLength(BRIDGE_LIMITS.maxSnapshotMessages)),
});
export type TailSnapshot = z.infer<typeof TailSnapshotSchema>;

/** 1.22.0 (X51): above any price OnlyFans allows on a message; a bigger number is not a price. */
export const OPEN_CHAT_PRICE_MAX = 10_000;

/**
 * 1.22.0 (X51): one message of the open chat as the host's API returns it (OnlyMonster's `GET
 * …/chats/{fan}/messages`), cut to what our features read. The API passes OnlyFans' own message almost raw, so the
 * money fields mean what OnlyFans means: `price` — the listed price of a paid message, USD (null — free or not given);
 * `isOpened` — the fan opened the model's message, and on a paid one that is the purchase (null — not given);
 * `isFree` — OnlyFans' own flag. `automatic` — sent from OnlyFans' queue (a mass or scheduled message), not typed in
 * the chat. `text` — the plain text, empty for media alone.
 */
export const OpenChatMessageSchema = z.strictObject({
  platformMessageId: NativeIdSchema,
  direction: z.enum(['fan', 'model']),
  sentAt: IsoTimestampSchema,
  text: displayText(LIVE_TEXT_LIMITS.maxChars),
  price: z.nullable(z.number().check(z.gt(0), z.lte(OPEN_CHAT_PRICE_MAX))),
  isFree: z.nullable(z.boolean()),
  isOpened: z.nullable(z.boolean()),
  mediaCount: CountSchema,
  tip: z.boolean(),
  automatic: z.boolean(),
});
export type OpenChatMessage = z.infer<typeof OpenChatMessageSchema>;

/** 1.22.0 (X51): one page of the open chat's messages, newest first, as the API pages them. */
export const OpenChatPageSchema = z.strictObject({
  capturedAt: IsoTimestampSchema,
  items: z.array(OpenChatMessageSchema).check(z.maxLength(OPEN_CHAT_LIMITS.pageMax)),
  /** The API says older messages exist; null — it did not say. */
  hasMore: z.nullable(z.boolean()),
  /** The oldest id of the page: the next page's `cursor`; null — an empty page. */
  cursor: z.nullable(NativeIdSchema),
});
export type OpenChatPage = z.infer<typeof OpenChatPageSchema>;

/**
 * 1.22.0 (X51): why a read of the open chat brought no page. From MAIN: `endpoint` — the page has made no request to
 * its API yet, so its address is unknown (nothing was requested); `session` — no session token on the page (signed
 * out, or the page's session provider changed), `http` — the API answered with an error status, `timeout`, `network` —
 * no answer at all, `invalid` — an answer of another shape. From the port: `not-open` — the chat is not the open one
 * (nothing was requested), `unavailable` — no bridge, or no answer from MAIN.
 */
export const OPEN_CHAT_FAILURES = ['endpoint', 'session', 'http', 'timeout', 'network', 'invalid'] as const;
export type OpenChatFailure = (typeof OPEN_CHAT_FAILURES)[number] | 'not-open' | 'unavailable';

/** 1.22.0 (X51): MAIN's answer to `openChatMessages`; `status` — the HTTP status of an `http` failure, else null. */
export const OpenChatAnswerSchema = z.union([
  z.strictObject({ ok: z.literal(true), page: OpenChatPageSchema }),
  z.strictObject({ ok: z.literal(false), failure: z.enum(OPEN_CHAT_FAILURES), status: z.nullable(z.int().check(z.gte(100), z.lte(599))) }),
]);
export type OpenChatAnswer = z.infer<typeof OpenChatAnswerSchema>;

/** 1.22.0 (X51): HostPort.openChatMessages options. */
export interface OpenChatReadOptions {
  /** Messages to read, newest first: 1…OPEN_CHAT_LIMITS.pageMax. */
  readonly limit: number;
  /** The page before this id (OpenChatPage.cursor); absent — the newest page. Pages with a cursor are never cached. */
  readonly cursor?: NativeId;
  /** A cached newest page of the open chat younger than this answers without a request (default OPEN_CHAT_LIMITS.cacheMs; 0 — always ask). */
  readonly maxAgeMs?: number;
}

/** 1.22.0 (X51): what HostPort.openChatMessages resolves with; it never rejects. `cached` — no request was made for it. */
export type OpenChatRead =
  | { readonly ok: true; readonly page: OpenChatPage; readonly cached: boolean }
  | { readonly ok: false; readonly reason: OpenChatFailure; readonly status: number | null };

/**
 * 1.15.0 (R20 §7.7): what the fan's own lines among the texts a host holds say about the fan's script — the language
 * gate's word (AI-087): Cyrillic in any of them — `cyrillic`; fan lines without — `other`; none — `unknown`.
 */
export type FanScript = 'cyrillic' | 'other' | 'unknown';

/**
 * Prechecks of the open chat from the host cache (Hi/Ping gates, «чат грузится»); no text. The schema is ChatSpace
 * MAIN's answer to `chatWindow` and stays as it was (its bytes are pinned): the two fields of 1.15.0 are the type's
 * alone (`ChatWindow` below).
 */
export const ChatWindowSchema = z.strictObject({
  chat: ChatRefSchema,
  state: z.enum(['loading', 'ready']),
  /** Messages loaded in the host cache, capped at the snapshot limit. */
  loaded: z.int().check(z.gte(0), z.lte(BRIDGE_LIMITS.maxSnapshotMessages)),
  fanMessages: CountSchema,
  modelMessages: CountSchema,
  lastFanMessageId: z.nullable(NativeIdSchema),
  lastFanMessageAt: z.nullable(IsoTimestampSchema),
  lastModelMessageAt: z.nullable(IsoTimestampSchema),
  /** The host says older history exists beyond what is loaded; null = unknown. */
  hasOlder: z.nullable(z.boolean()),
});
/**
 * 1.15.0 (R20 §7.7): a host that keeps the chat's window itself (Fansly: MAIN's `fx.chat`, checked by its own schema
 * there) adds `fanScript` — the language gate without a copy of the text in the tab — and `newestAt`, the newest
 * message it holds (null — none), for the lag of the hub's archive. ChatSpace's port never sets them.
 */
export type ChatWindow = z.infer<typeof ChatWindowSchema> & { readonly fanScript?: FanScript; readonly newestAt?: IsoTimestamp | null };

/** A fan as the host already holds it in memory: decoration only, facts come from the hub (D-29). */
export const HostFanSchema = z.strictObject({
  chat: ChatRefSchema,
  username: z.nullable(displayText(128)),
  displayName: z.nullable(displayText(256)),
  isBlocked: z.nullable(z.boolean()),
  canReceiveMessages: z.nullable(z.boolean()),
  isRestricted: z.nullable(z.boolean()),
  isOnline: z.nullable(z.boolean()),
  /** «был 6 мин назад»: the fan's last activity as ChatSpace holds it. */
  lastSeenAt: z.nullable(IsoTimestampSchema),
  /** ChatSpace's own buying-power label, if loaded. */
  buyingPowerLabel: z.nullable(displayText(64)),
  /** ChatSpace's fan insights (`["fanInsights",acc]`) as label/value pairs, if loaded (В16). */
  insights: z.nullable(z.array(z.strictObject({ label: displayText(64), value: displayText(64) })).check(z.maxLength(16))),
  /** The fan's «О себе» as ChatSpace shows it (CS-035), if loaded. */
  bio: z.nullable(displayText(2000)),
  /** The OnlyFans lists the fan is in, if ChatSpace holds them. */
  lists: z.nullable(z.array(displayText(64)).check(z.maxLength(50))),
});
export type HostFan = z.infer<typeof HostFanSchema>;

/** A row of the chat list the person sees (`["chatList", acc, …]`); nothing is loaded for it. */
export const NavigationItemSchema = z.strictObject({
  chat: ChatRefSchema,
  /** 0-based row in the visible list order. */
  position: CountSchema,
  displayName: z.nullable(displayText(256)),
  username: z.nullable(displayText(128)),
  unreadCount: z.nullable(CountSchema),
  isOnline: z.nullable(z.boolean()),
});
export type NavigationItem = z.infer<typeof NavigationItemSchema>;

export const HostThemeSchema = z.strictObject({
  scheme: z.enum(['light', 'dark']),
  /** `--color-om-*` values as computed, by property name. */
  tokens: z.record(z.string().check(z.regex(/^--[a-z0-9-]{1,62}$/)), displayText(64)).check(
    z.refine((r) => Object.keys(r).length <= 64, { message: 'too many theme tokens' }),
  ),
  /** ChatSpace's fixed-width layout is on. */
  fixedWidth: z.boolean(),
});
export type HostTheme = z.infer<typeof HostThemeSchema>;

const RectSchema = z.strictObject({
  left: z.number(),
  top: z.number(),
  width: z.number().check(z.gte(0)),
  height: z.number().check(z.gte(0)),
});

/**
 * Where our UI can live right now (§6.3). Describes, never hands over DOM
 * nodes: the shadow roots go to the UI through the mount port.
 */
export const MountPointsSchema = z.strictObject({
  dock: z.strictObject({
    /**
     * in-flow — first child of the composer frame root; fixed-overlay — the
     * frame structure changed, dock floats over the composer rect;
     * copy-only-row — the fan is blocked; none — no active composer.
     */
    kind: z.enum(['in-flow', 'fixed-overlay', 'copy-only-row', 'none']),
    composerInstanceId: z.nullable(EpochTokenSchema),
    width: z.nullable(z.number().check(z.gte(0))),
  }),
  overlay: z.strictObject({
    ready: z.boolean(),
    /** Side surfaces align to ChatSpace's fixed-width container when it is on. */
    container: z.nullable(RectSchema),
  }),
});
export type MountPoints = z.infer<typeof MountPointsSchema>;

/**
 * A fact about an incoming message, without text (§5.3, §9.8): enough for
 * sound and X8 freshness. Produced by the WS tap or the stores.
 */
export const IncomingFactSchema = z.strictObject({
  host: HostKindSchema,
  hostAccountId: NativeIdSchema,
  platformFanId: NativeIdSchema,
  platformMessageId: NativeIdSchema,
  fromFan: z.boolean(),
  /** Queued/automatic messages (`isFromQueue`) never sound. */
  automatic: z.boolean(),
  tip: z.boolean(),
  sentAt: z.nullable(IsoTimestampSchema),
  socketEpoch: CountSchema,
  fanSequence: CountSchema,
  source: z.enum(['ws-tap', 'store']),
});
export type IncomingFact = z.infer<typeof IncomingFactSchema>;

/**
 * The composer's draft as MAIN recorded it inside the queue action's
 * handler, before the native send (§6.6 п. 1–2): whether the text descends
 * from our insert (the revision chain of this composer, never the text) and
 * whether it changed after it (`edited`, D-17).
 */
export const SentDraftSchema = z
  .strictObject({
    revision: CountSchema,
    provenance: DraftProvenanceSchema,
    /** The insert intent the draft descends from; null — not ours, or not known. */
    insertIntentId: z.nullable(UuidSchema),
    /** Changed after that insert; null when there is no insert or the editor was not observed (no `sent`). */
    editedSinceInsert: z.nullable(z.boolean()),
  })
  .check(
    z.refine((d) => d.insertIntentId !== null || d.editedSinceInsert === null, { message: 'edited is known only for a draft from our insert' }),
    z.refine((d) => d.provenance !== 'our-insert' || (d.insertIntentId !== null && d.editedSinceInsert === false), {
      message: 'an unchanged insert of ours names its intent and is not edited',
    }),
  );
export type SentDraft = z.infer<typeof SentDraftSchema>;

/**
 * 1.21.0 (decision X48): what a send carried besides its text, as the queue action of the page named it — a price (a
 * PPV) and media. Marks only: never the price, the media or the text.
 */
export const SendCargoSchema = z.strictObject({ priced: z.boolean(), media: z.boolean() });
export type SendCargo = z.infer<typeof SendCargoSchema>;

/**
 * A human pressed ChatSpace's Send in the composer (§6.6); the link to our
 * insert is by id, never by text. MAIN emits it once per send, when the
 * native chain settled (the intercepted response of exactly this send, a
 * refusal or the native timeout), with the draft recorded at the queue
 * action; the outgoing echo with the same id may come before it (the
 * isolated side keeps a short buffer). `platformMessageId: null` or a draft
 * without `insertIntentId` — not a send of a part of ours: no `sent`, no
 * greeting. 1.21.0 (X48): with the hub's `send-attribution-v1` MAIN follows the
 * receipt of every such send, a draft of the person's own too, so the message
 * id of a draft that is not ours may be known: it says who sent the message
 * (SendAttributionFact), never that a part of ours was sent.
 */
export const HumanSendFactSchema = z.strictObject({
  chat: ChatRefSchema,
  pendingId: boundedText(128),
  /** From the intercepted response of exactly this send; null when it is not known. */
  platformMessageId: z.nullable(NativeIdSchema),
  /** Integrity check of an already linked send only. */
  textDigest: DigestSchema,
  draft: SentDraftSchema,
  /** 1.21.0 (X48): absent — not observed (an older MAIN). */
  cargo: z.optional(SendCargoSchema),
});
export type HumanSendFact = z.infer<typeof HumanSendFactSchema>;

/**
 * 1.21.0 (decision X48): who sent a message — the tab's word to the background (`attribution.report`) after a
 * human send whose message id the page's own response named. The person is whoever is signed in when the
 * background takes it; the hub reads them from the token. Ids, a time and two marks; never a text.
 */
export const SendAttributionFactSchema = z.strictObject({
  chat: ChatRefSchema,
  platformMessageId: NativeIdSchema,
  /** When the tab heard of the send. */
  observedAt: IsoTimestampSchema,
  priced: z.boolean(),
  media: z.boolean(),
});
export type SendAttributionFact = z.infer<typeof SendAttributionFactSchema>;

export const CoverageEventSchema = z.strictObject({
  hostAccountId: NativeIdSchema,
  state: z.enum(['ok', 'unknown']),
  reason: boundedText(64),
});
export type CoverageEvent = z.infer<typeof CoverageEventSchema>;

/** A host account this browser has seen in a ChatSpace tab, and when (§9.9 «Аккаунты, которые видел этот браузер»). */
export const SeenHostAccountSchema = z.strictObject({ account: HostAccountSchema, lastSeenAt: IsoTimestampSchema });
export type SeenHostAccount = z.infer<typeof SeenHostAccountSchema>;

/** `presence` in storage.local (STORAGE_KEYS.presence): the background writes it from tabs' `tab.presence` reports, newest first. */
export const PresenceStoreSchema = z.strictObject({
  v: z.literal(1),
  accounts: z.array(SeenHostAccountSchema).check(z.maxLength(STORAGE_LIMITS.seenAccountsMax)),
});
export type PresenceStore = z.infer<typeof PresenceStoreSchema>;

/** Everything `current()` returns in one read. */
export interface HostSnapshot {
  readonly kind: HostKind;
  readonly identity: HostIdentity | null;
  readonly route: RouteState;
  readonly composer: ComposerState | null;
  readonly accounts: readonly HostAccount[];
  readonly contract: HostContractReport;
  readonly mounts: MountPoints;
  readonly theme: HostTheme;
}

export type HostEvent =
  | { readonly type: 'route'; readonly route: RouteState }
  | { readonly type: 'composer'; readonly composer: ComposerState | null }
  | { readonly type: 'accounts'; readonly accounts: readonly HostAccount[] }
  | { readonly type: 'chatCache'; readonly chat: ChatRef }
  | { readonly type: 'incoming'; readonly fact: IncomingFact }
  | { readonly type: 'coverage'; readonly coverage: CoverageEvent }
  | { readonly type: 'humanSend'; readonly fact: HumanSendFact }
  /**
   * 1.11.0 (decision X25): MAIN saw, after an X8 send, what trips the fuse. The port has already turned X8 off in
   * this document; the tab tells the background, which keeps the fuse for the browser.
   */
  | { readonly type: 'sendFuse'; readonly fuse: SendFuseFact }
  | { readonly type: 'reloadNeeded' };

/** §5.2. Lives in the isolated world; MAIN is reached only through the bridge. */
/** Options of HostPort.navigate (contracts carry no DOM types: the part of AbortSignal it uses). */
export interface NavigateOptions {
  /** Aborted → a pending `thenInsert` is canceled (§6.5). */
  readonly signal?: {
    readonly aborted: boolean;
    addEventListener(type: 'abort', listener: () => void, options?: { readonly once?: boolean }): void;
    removeEventListener(type: 'abort', listener: () => void): void;
  };
}

/** 1.15.0 (R20 §7.7, §9.1): what a host's freshness port is asked on the Generate click. */
export interface FreshnessRequest {
  /** The conversation of the chat (on Fansly the group, FS-IDN-6): the target's — never the open route's for another chat. */
  readonly conversationRef: NativeId;
  readonly feature: FeatureId;
  /** The function's messageCount: the check window is the chat's last min(60, window) messages (FS-TAIL-1). */
  readonly window: number;
  /** The tail's texts too: a draft function only (D-14). */
  readonly withText: boolean;
}

/**
 * 1.15.0 (R20 §5.8, §7.7): the generation snapshot of a host whose own tab observes its chats, taken in one step on
 * the Generate click, so the tail and the window check come from one instant (FS-TAIL-6). The snapshot is the site's
 * own form (Fansly: `FanslySnapshot`, `@cg/contracts/fansly`); the site's AI policy turns it into the start's shared
 * `CoverageProof` (ops.ts). null — no snapshot: the bridge did not answer, the capability is off, or the host does not
 * know the chat; the result is then marked «свежесть не проверена» (FS-TAIL-7).
 */
export interface FreshnessPort<S = unknown> {
  snapshot(chat: ChatRef, request: FreshnessRequest): Promise<S | null>;
}

export interface HostPort {
  /** Local observations only; no network. Optional for hosts without extra diagnostics. */
  diagnostics?(): Promise<PageDiagnostics>;
  readonly kind: HostKind;
  readonly platform: Platform;
  probe(): HostContractReport;
  onContract(cb: (report: HostContractReport) => void): Unsubscribe;
  current(): HostSnapshot;
  subscribe(cb: (event: HostEvent) => void): Unsubscribe;
  /** Page memory only; never the network. */
  readDraft(expected: HostIdentity): Promise<DraftSnapshot>;
  /** Fresh text, D-14; null when the capability is off. */
  readVisibleTail(expected: HostIdentity, max: number): Promise<LiveTextTail | null>;
  /**
   * 1.22.0 (X51): the open chat's messages from the host's own API, with what page memory does not hold or holds stale
   * (a purchase updates no loaded message). Only the chat the person has open: for any other `not-open`, and nothing is
   * requested. One request serves the callers that ask at the same time; the newest page is kept `maxAgeMs`, and a
   * message of that chat coming in or the person leaving the chat drops it. Absent on a host without such an API.
   */
  openChatMessages?(chat: ChatRef, options: OpenChatReadOptions): Promise<OpenChatRead>;
  /** Prechecks of the open chat. */
  chatWindow(chat: ChatRef, max: number): ChatWindow | null;
  /** Decoration only, when already in memory. */
  fan(chat: ChatRef): HostFan | null;
  /** Loads nothing. */
  listCachedChats(hostAccountId: string, limit: number): readonly NavigationItem[];
  listCachedAccounts(): readonly HostAccount[];
  /** An `open` intent; its cause is redeemed first (§14). */
  insert(intent: InsertIntent): Promise<InsertReceipt>;
  focusComposer(expected: HostIdentity): Promise<boolean>;
  /**
   * Only on a human action; its cause is redeemed first (§14). Aborting
   * `options.signal` cancels a pending `thenInsert` (§6.5: sign-out, persona
   * or binding change, the preview closed): it is not written unless it
   * already was, and the receipt's insert is CG-INSERT-CANCELED. The
   * navigation itself is not undone.
   */
  navigate(intent: NavigationIntent, options?: NavigateOptions): Promise<NavigationReceipt>;
  /**
   * Snapshot of the freshness counters (§6.7.5), asked on the Generate click:
   * MAIN takes it in one synchronous step of its handler (only MAIN holds the
   * counters and the subscription epoch). A fan message that lands between
   * the click and that step counts as seen before Generate and is covered by the
   * served-context check (H-4b, §6.7.5). null — no checkpoint (bridge
   * or capability down): the result can be inserted, never sent.
   */
  checkpoint(chat: ChatRef): Promise<FreshnessCheckpoint | null>;
  mounts(): MountPoints;
  onMounts(cb: (mounts: MountPoints) => void): Unsubscribe;
  theme(): HostTheme;
  onTheme(cb: (theme: HostTheme) => void): Unsubscribe;
  /** X8; null when the capability is off. */
  readonly previewSend: PreviewSendPort | null;
  /**
   * 1.15.0 (R20 §7.7): the generation snapshot (FS-TAIL-6), only on a host whose tab observes its chats itself
   * (Fansly); absent on ChatSpace, whose fresh text is `readVisibleTail` and whose freshness is `checkpoint`.
   */
  readonly freshness?: FreshnessPort;
  /**
   * 1.15.0 (R20 §7.7): what only fansly.com has — the header slot, a file into the composer or the vault, the relay
   * frame (`FanslyPagePort`). A shared module names no site's type (§1.8): the member is typed by Fansly's own port,
   * `FanslyHostPort` (`@cg/contracts/fansly-host`), and shared code never reads it. Absent on every other host.
   */
  readonly fansly?: unknown;
  dispose(): void;
}
