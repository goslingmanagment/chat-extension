// The host port (architecture.md §5.2, §6): everything the extension may know
// about and do to the host page. Page memory only — never the network. The
// port never has, and never will have, fetchHistory(), markRead(), setStore(),
// a general send() or an arbitrary execute(). Writes: guarded insert,
// navigation on a human action, and the X8 preview send (PreviewSendPort).

import * as z from 'zod/mini';

import { CgCodeSchema } from './errors';
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
import { BRIDGE_LIMITS } from './limits';
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
} from './primitives';
import { type FreshnessCheckpoint, type PreviewSendPort } from './send';

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

export const ANCHOR_STATES = ['ok', 'missing', 'shape'] as const;

export const HostContractReportSchema = z.strictObject({
  /** Fingerprint of the host build (the hashed name of its entry module): a diagnostic signal, not the check itself. */
  build: z.nullable(displayText(80)),
  adapterVersion: boundedText(32),
  checkedAt: EpochMsSchema,
  anchors: z.record(AnchorIdSchema, z.enum(ANCHOR_STATES)),
  capabilities: z.record(HostCapabilitySchema, CapabilityStateSchema),
});
export type HostContractReport = z.infer<typeof HostContractReportSchema>;

export const ROUTE_NAMES = ['chat', 'accounts-overview', 'other'] as const;
export const RouteStateSchema = z.strictObject({
  epoch: CountSchema,
  name: z.enum(ROUTE_NAMES),
  account: z.nullable(HostAccountSchema),
  chat: z.nullable(ChatRefSchema),
});
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

/** Insert intent. MAIN checks all of it in one synchronous step right before the write (§6.4). */
export const InsertIntentSchema = z
  .strictObject({
    intentId: UuidSchema,
    operationId: UuidSchema,
    part: PartRefSchema,
    target: ChatRefSchema,
    expected: z.strictObject({
      documentEpoch: EpochTokenSchema,
      /** null — a deferred insert after «Открыть и вставить» (§6.5). */
      routeEpoch: z.nullable(CountSchema),
      composerInstanceId: z.nullable(EpochTokenSchema),
      draftRevision: CountSchema,
      draftDigest: DigestSchema,
    }),
    mode: z.enum(['replace', 'append']),
    /** Plain text; ChatSpace's bridge escapes it. */
    text: boundedText(BRIDGE_LIMITS.maxStringLength),
    /** One-time consent for this draft revision (Б2). */
    confirmationId: z.nullable(UuidSchema),
    createdAt: EpochMsSchema,
    expiresAt: EpochMsSchema,
  })
  .check(z.refine((i) => i.expiresAt > i.createdAt, { message: 'expiresAt must be after createdAt' }));
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

/** «Открыть и вставить» and plain navigation; only on a human action (§6.5, §6.9). */
export const NavigationIntentSchema = z.strictObject({
  intentId: UuidSchema,
  cause: HumanCauseSchema,
  target: z.strictObject({
    hostAccountId: NativeIdSchema,
    /** null — open the account (Б13). */
    platformFanId: z.nullable(NativeIdSchema),
  }),
  thenInsert: z.optional(InsertIntentSchema),
});
export type NavigationIntent = z.infer<typeof NavigationIntentSchema>;

export const NavigationReceiptSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('navigated'),
    routeEpoch: CountSchema,
    /** The outcome of `thenInsert`; null when there was none. */
    insert: z.nullable(InsertReceiptSchema),
  }),
  /** CG-NAV-FAILED, CG-NAV-TIMEOUT, CG-INSERT-CANCELED… */
  z.strictObject({ state: z.literal('failed'), code: CgCodeSchema }),
]);
export type NavigationReceipt = z.infer<typeof NavigationReceiptSchema>;

/** Hub limits for fresh text (H-4c `AI_LIVE_TEXT_MAX_ITEMS` / `_MAX_CHARS`). */
export const LIVE_TEXT_LIMITS = { maxItems: 60, maxChars: 5000 } as const;

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

/** Prechecks of the open chat from the host cache (Hi/Ping gates, «чат грузится»); no text. */
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
export type ChatWindow = z.infer<typeof ChatWindowSchema>;

/** A fan as the host already holds it in memory: decoration only, facts come from the hub (D-29). */
export const HostFanSchema = z.strictObject({
  chat: ChatRefSchema,
  username: z.nullable(displayText(128)),
  displayName: z.nullable(displayText(256)),
  isBlocked: z.nullable(z.boolean()),
  canReceiveMessages: z.nullable(z.boolean()),
  isRestricted: z.nullable(z.boolean()),
  isOnline: z.nullable(z.boolean()),
  /** ChatSpace's own buying-power label, if loaded. */
  buyingPowerLabel: z.nullable(displayText(64)),
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

/** A human pressed ChatSpace's Send in the composer (§6.6); the link to our insert is by id, never by text. */
export const HumanSendFactSchema = z.strictObject({
  chat: ChatRefSchema,
  pendingId: boundedText(128),
  /** From the intercepted response of exactly this attempt; null when attribution is unknown. */
  platformMessageId: z.nullable(NativeIdSchema),
  /** Integrity check of an already linked attempt only. */
  textDigest: DigestSchema,
});
export type HumanSendFact = z.infer<typeof HumanSendFactSchema>;

export const CoverageEventSchema = z.strictObject({
  hostAccountId: NativeIdSchema,
  state: z.enum(['ok', 'unknown']),
  reason: boundedText(64),
});
export type CoverageEvent = z.infer<typeof CoverageEventSchema>;

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
  | { readonly type: 'reloadNeeded' };

/** §5.2. Lives in the isolated world; MAIN is reached only through the bridge. */
export interface HostPort {
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
  /** Prechecks of the open chat. */
  chatWindow(chat: ChatRef, max: number): ChatWindow | null;
  /** Decoration only, when already in memory. */
  fan(chat: ChatRef): HostFan | null;
  /** Loads nothing. */
  listCachedChats(hostAccountId: string, limit: number): readonly NavigationItem[];
  listCachedAccounts(): readonly HostAccount[];
  insert(intent: InsertIntent): Promise<InsertReceipt>;
  focusComposer(expected: HostIdentity): Promise<boolean>;
  /** Only on a human action. */
  navigate(intent: NavigationIntent): Promise<NavigationReceipt>;
  /** Snapshot of the freshness counters (§6.7.5). */
  checkpoint(chat: ChatRef): FreshnessCheckpoint;
  mounts(): MountPoints;
  onMounts(cb: (mounts: MountPoints) => void): Unsubscribe;
  theme(): HostTheme;
  onTheme(cb: (theme: HostTheme) => void): Unsubscribe;
  /** X8; null when the capability is off. */
  readonly previewSend: PreviewSendPort | null;
  dispose(): void;
}
