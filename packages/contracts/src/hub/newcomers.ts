// «Новые» and the hub's claim/custody (architecture.md §6.7.7, §8.5; hub H-7,
// hub-pr-plan.md §4.6 with critic items 1, 12, 14). Three separate things on
// one fan of one page:
// 1. greeting — the fact «first greeting confirmed» (forever);
// 2. lease — who works on the one greeting now (120 s, renewed every 40 s);
// 3. custody — one dispatched part of a preview send (never expires by itself;
//    `uncertain-held` is resolved only by an owner/team lead in the hub).
// States of these automata are closed enums (a new state = a new route
// version); vocabularies around them are open tokens.

import * as z from 'zod/mini';

import { CountSchema, IsoTimestampSchema, MoneyMillsSchema, NativeIdSchema, OpenTokenSchema, UuidSchema, boundedText } from '../primitives';
import { HubCursorSchema, PageLabelSchema } from './wire';

// ── Claim and custody ──────────────────────────────────────────────────────

export const CLAIM_ACTIONS = ['claim', 'renew', 'release', 'dispatch', 'sent', 'failed', 'registerNativeSend'] as const;
export type ClaimAction = (typeof CLAIM_ACTIONS)[number];
export const GREETING_STATES = ['none', 'confirmed'] as const;
export const LEASE_STATES = ['none', 'owned', 'held', 'expired', 'released'] as const;
export const LEASE_HOLDERS = ['you-elsewhere', 'someone-else'] as const;
export const CUSTODY_STATES = ['dispatching', 'sent', 'failed', 'uncertain-held', 'resolved-sent', 'resolved-not-sent'] as const;
export type CustodyState = (typeof CUSTODY_STATES)[number];
/** Custody states that block every new dispatch to the fan until resolved. */
export const CUSTODY_BLOCKING_STATES = ['dispatching', 'uncertain-held'] as const satisfies readonly CustodyState[];

/**
 * How one attempt's custody may move (H-7, frozen in R01). It starts as
 * `dispatching` (dispatch) or straight `sent` (registerNativeSend).
 * `uncertain-held` is `dispatching` whose ticket expired unreported; it never
 * frees itself and never becomes `failed`: only the late proof (`sent`) or an
 * owner/team-lead resolve ends it.
 */
export const CUSTODY_INITIAL_STATES = ['dispatching', 'sent'] as const satisfies readonly CustodyState[];
export const CUSTODY_TRANSITIONS = {
  dispatching: ['sent', 'failed', 'uncertain-held', 'resolved-sent', 'resolved-not-sent'],
  'uncertain-held': ['sent', 'resolved-sent', 'resolved-not-sent'],
  sent: [],
  failed: [],
  'resolved-sent': [],
  'resolved-not-sent': [],
} as const satisfies Record<CustodyState, readonly CustodyState[]>;

export function isCustodyTransition(from: CustodyState | null, to: CustodyState): boolean {
  if (from === null) return (CUSTODY_INITIAL_STATES as readonly CustodyState[]).includes(to);
  return from === to || (CUSTODY_TRANSITIONS[from] as readonly CustodyState[]).includes(to);
}
/** Where a confirmed greeting came from; `desktop-outbox` = the desktop's succeeded new-follower command (critic item 1). */
export const GREETING_SOURCES = ['preview-send', 'native-register', 'resolve', 'desktop-outbox'] as const;
export const CUSTODY_PURPOSES = ['greeting', 'preview-reply'] as const;
export const SEND_FAILURE_REASONS = ['not_enqueued', 'native_rejected'] as const;

/** One generation's parts form one group (§6.7.9); `partIndex < partCount`. */
export const ClaimGroupSchema = z.strictObject({
  generationRef: boundedText(100),
  variant: z.int().check(z.gte(0), z.lte(2)),
  partCount: z.int().check(z.gte(1), z.lte(10)),
});
export type ClaimGroup = z.infer<typeof ClaimGroupSchema>;

const PartIndexSchema = z.int().check(z.gte(0), z.lte(9));
const PurposeSchema = z.enum(CUSTODY_PURPOSES);
/** Lease actions carry the lease token and the client install id (`instanceId`, a UUID per install). */
const leaseAction = <A extends 'claim' | 'renew' | 'release'>(action: A) =>
  z.strictObject({ action: z.literal(action), leaseToken: UuidSchema, instanceId: UuidSchema });

/**
 * Body of `POST …/fans/:fanRef/claim`. `dispatch` is atomic on the hub (flag,
 * rights, rate, no foreign open custody, the lease for a greeting) and answers
 * the one-time ticket once; a repeat with the same attemptId only reads.
 * `failed` needs proof of non-acceptance: `native_rejected` only with a 4xx
 * other than 401 (§6.7.7: a 401 never releases custody, critic item 12).
 */
export const ClaimBodySchema = z
  .discriminatedUnion('action', [
    leaseAction('claim'),
    leaseAction('renew'),
    leaseAction('release'),
    z.strictObject({
      action: z.literal('dispatch'),
      attemptId: UuidSchema,
      instanceId: UuidSchema,
      purpose: PurposeSchema,
      group: ClaimGroupSchema,
      partIndex: PartIndexSchema,
      textRevision: CountSchema,
      /** Required for a greeting until it is confirmed. */
      leaseToken: z.optional(UuidSchema),
      /** = bootstrap configRevision the client acted on. */
      flagRevision: CountSchema,
    }),
    z.strictObject({
      action: z.literal('sent'),
      attemptId: UuidSchema,
      instanceId: UuidSchema,
      platformMessageId: NativeIdSchema,
      evidence: z.literal('receipt+echo'),
    }),
    z.strictObject({
      action: z.literal('failed'),
      attemptId: UuidSchema,
      instanceId: UuidSchema,
      reason: z.enum(SEND_FAILURE_REASONS),
      httpStatus: z.optional(z.int().check(z.gte(100), z.lte(599))),
    }),
    /** A proven native send from the composer after «Открыть и вставить»; needs no previewSend flag, releases nobody's custody. */
    z.strictObject({
      action: z.literal('registerNativeSend'),
      attemptId: UuidSchema,
      instanceId: UuidSchema,
      purpose: PurposeSchema,
      group: ClaimGroupSchema,
      partIndex: PartIndexSchema,
      platformMessageId: NativeIdSchema,
    }),
  ])
  .check(
    z.refine((b) => !('group' in b) || b.partIndex < b.group.partCount, { message: 'partIndex must be below partCount' }),
    z.refine(
      (b) =>
        b.action !== 'failed' ||
        (b.reason === 'native_rejected'
          ? b.httpStatus !== undefined && b.httpStatus >= 400 && b.httpStatus <= 499 && b.httpStatus !== 401
          : b.httpStatus === undefined),
      { message: 'native_rejected needs a 4xx other than 401; not_enqueued carries no status' },
    ),
  );
export type ClaimBody = z.infer<typeof ClaimBodySchema>;

/** One claim call: path `pageLabel` + `fanRef`, and the body. */
export const ClaimOpSchema = z.strictObject({ pageLabel: PageLabelSchema, fanRef: NativeIdSchema, body: ClaimBodySchema });
export type ClaimOp = z.infer<typeof ClaimOpSchema>;

/** Answer of POST (and, without a ticket, of GET) `…/claim`. */
export const ClaimStateSchema = z.object({
  greeting: z.object({
    state: z.enum(GREETING_STATES),
    at: z.nullable(IsoTimestampSchema),
    messageRef: z.nullable(z.string()),
    /** preview-send | native-register | resolve | desktop-outbox. */
    source: z.nullable(OpenTokenSchema),
  }),
  lease: z.object({
    state: z.enum(LEASE_STATES),
    leaseToken: z.nullable(z.string()),
    expiresAt: z.nullable(IsoTimestampSchema),
    /** The holder is never named. */
    heldBy: z.nullable(z.enum(LEASE_HOLDERS)),
  }),
  group: z.nullable(
    z.object({
      generationRef: z.string(),
      variant: CountSchema,
      partCount: z.int().check(z.gte(1)),
      sentParts: z.array(CountSchema),
      heldParts: z.array(CountSchema),
    }),
  ),
  custody: z.nullable(
    z.object({
      attemptId: UuidSchema,
      state: z.enum(CUSTODY_STATES),
      /** Only in the answer to the first `dispatch`. */
      ticket: z.nullable(z.string()),
      ticketExpiresAt: z.nullable(IsoTimestampSchema),
    }),
  ),
  serverNow: IsoTimestampSchema,
  /** = configRevision. */
  flagRevision: CountSchema,
});
export type ClaimState = z.infer<typeof ClaimStateSchema>;

// ── «Новые» (`audience-new-v1`) ────────────────────────────────────────────

export const AUDIENCE_LIMITS = {
  defaultWindowHours: 48,
  quickWindowsHours: [24, 48, 72, 168],
  maxWindowHours: 720,
  defaultLimit: 50,
  maxLimit: 100,
  /** Poll while the «Новые» window is open; slower, for the subscriber sound, while a working tab lives (§8.5). */
  pollOpenMs: 30_000,
  pollSoundMs: 60_000,
} as const;

/** `new` (with `trial`) or `returning`; `renewed` is reserved: OF sends no webhook on auto-renewal. */
export const AUDIENCE_KINDS = ['new', 'returning'] as const;
export const SUBSCRIBED_AT_SOURCES = ['subscribeAt', 'notification'] as const;

/** Path `pageLabel`; the window is fixed for the whole cursor pass (`cursor_window_mismatch` otherwise). */
export const AudienceNewQuerySchema = z.strictObject({
  pageLabel: PageLabelSchema,
  windowHours: z.int().check(z.gte(1), z.lte(AUDIENCE_LIMITS.maxWindowHours)),
  cursor: z.optional(HubCursorSchema),
  limit: z.optional(z.int().check(z.gte(1), z.lte(AUDIENCE_LIMITS.maxLimit))),
});
export type AudienceNewQuery = z.infer<typeof AudienceNewQuerySchema>;

export const ClaimSummarySchema = z.object({
  greeting: z.enum(GREETING_STATES),
  lease: z.enum(LEASE_STATES),
  heldBy: z.nullable(z.enum(LEASE_HOLDERS)),
  custody: z.nullable(z.enum(CUSTODY_STATES)),
});
export type ClaimSummary = z.infer<typeof ClaimSummarySchema>;

export const AudienceNewItemSchema = z.object({
  /** domain_events id: the stable key that keeps the subscriber sound from repeating. */
  eventRef: z.string(),
  fanRef: NativeIdSchema,
  username: z.nullable(z.string()),
  displayName: z.nullable(z.string()),
  /** new | returning. */
  kind: OpenTokenSchema,
  trial: z.boolean(),
  subscribedAt: IsoTimestampSchema,
  /** subscribeAt | notification. */
  subscribedAtSource: OpenTokenSchema,
  status: z.object({
    isSubscriber: z.nullable(z.boolean()),
    /** active | expired | unknown. */
    subscriptionStatus: OpenTokenSchema,
    endsAt: z.nullable(IsoTimestampSchema),
    asOf: z.nullable(IsoTimestampSchema),
    /** sweep | webhook | none. */
    source: OpenTokenSchema,
  }),
  thread: z.nullable(
    z.object({
      lastMessageAt: z.nullable(IsoTimestampSchema),
      lastFanMessageAt: z.nullable(IsoTimestampSchema),
      lastModelMessageAt: z.nullable(IsoTimestampSchema),
      storedMessageCount: CountSchema,
      coverage: OpenTokenSchema,
      backfillComplete: z.boolean(),
    }),
  ),
  claim: ClaimSummarySchema,
});
export type AudienceNewItem = z.infer<typeof AudienceNewItemSchema>;

export const AudienceNewPageSchema = z.object({
  pageLabel: z.string(),
  window: z.object({
    hours: z.int().check(z.gte(1)),
    from: IsoTimestampSchema,
    to: IsoTimestampSchema,
    snapshotAt: IsoTimestampSchema,
  }),
  serverNow: IsoTimestampSchema,
  coverage: z.object({
    /** complete | partial | unknown. */
    state: OpenTokenSchema,
    deliveryFrontier: z.nullable(IsoTimestampSchema),
    lastAudienceSweepAt: z.nullable(IsoTimestampSchema),
    reasons: z.array(OpenTokenSchema),
  }),
  /** Excluded or unclassified events (e.g. the top-fan award), counted, not listed. */
  unknownCount: CountSchema,
  welcomeTemplate: z.nullable(
    z.object({
      ref: z.string(),
      observedAt: IsoTimestampSchema,
      enabled: z.nullable(z.boolean()),
      hasText: z.boolean(),
      hasMedia: z.boolean(),
      priceMills: z.nullable(MoneyMillsSchema),
    }),
  ),
  items: z.array(AudienceNewItemSchema),
  nextCursor: z.nullable(HubCursorSchema),
});
export type AudienceNewPage = z.infer<typeof AudienceNewPageSchema>;
