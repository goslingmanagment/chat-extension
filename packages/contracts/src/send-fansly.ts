// The greeting send of fansly.com's «Новые» over HTTP (1.15.0; R20
// docs/project-unite/architecture.md §8.6, А10, §9.4; spec FS-NEW-3, FS-NEW-6,
// FS-NEW-7). One human click on «Отправить» → the background takes the hub's
// custody (HF-3) and makes ONE `POST /message` of its own; nothing else ever
// sends, nothing is ever repeated by itself. ChatSpace's X8 (send.ts,
// send-rules.ts, `send.journal`) is not touched: X8 is built on ChatSpace's own
// queue and a generation's parts, this is a request of ours with a text the
// person may have written or edited.
//
// What is here:
// - the attempt's state machine as data (`FANSLY_SEND_TRANSITIONS`), the
//   proofs each end needs, and `isFanslySendStep`, which refuses every step
//   the architecture does not name — above all any way out of `uncertain` but
//   a proof, and any way back to `ready` at all;
// - the journal `fansly.send.journal` (ids only, never a text), what a restart
//   makes of each of its records, what each end owes the hub's custody;
// - the «Новые» greeting request (the field's text, its revision, the history
//   revision the person reviewed, the admission kind, the human action) and the
//   view of an attempt the window gets back;
// - the manual group (HF-3) and the Fansly greeting's claim body: the hub's
//   `clientFanClaim` body narrowed to what a Fansly greeting may say;
// - the synchronous final check before `fetch`.
//
// The order of a send (§8.6). Everything that may wait — the lease, the pacer,
// the relay frame — comes before `dispatch`. The journal record is written
// before `dispatch` (`routed`), so a crash before the intent can still tell the
// hub «not sent». After the custody's answer: (1) the durable write of the
// intent «the send may start» (`intentWritten`, awaited — the only pause);
// (2) the final check, synchronous, from memory: the tuple and the ticket's
// rest (`fanslyFinalCheck`); (3) `fetch` at once, no `await` between the check
// and the request (`requestStarted`). Through «Fansly через вкладку» the relay
// frame repeats its own part of the check (its tab and account,
// `fansly.relay.fetch.expect`) synchronously right before its own `fetch`.
//
// How an HTTP outcome reads:
// - 2xx `{success: true, response: {id, groupId, senderId}}` naming this group
//   and this creator → `receipted` (FanslySendReceiptSchema); the echo 5/1 with
//   the same id from any tab of the creator, or the next pass's history read
//   with that id, → `sent`;
// - 2xx `{success: false}` → `uncertain` (`rejected-200`): nothing yet proves
//   which of its codes mean «not delivered» (hub HF-3: it stays
//   `uncertain-held` there too); such answers are counted in `client_health`
//   by code;
// - another 2xx (no body, another group or sender) → `uncertain` (`bad-receipt`);
// - 401 → `uncertain` (`unauthorized`): a 401 says nothing about the send;
// - another 4xx → `refused` (`native-rejected`, the status kept): Fansly
//   refused the request; a 429 also starts the pacer's cooldown;
// - 5xx, another status → `uncertain` (`server`); a thrown or timed-out fetch →
//   `uncertain` (`network`); a relay frame lost after its fetch could start →
//   `uncertain` (`relay`); the relay's own `refused` (its check failed, no
//   fetch) → `refused` (`not-enqueued`).
//
// Where it lives. Fansly's own module (only the subpath
// `@cg/contracts/send-fansly`, never the package root): the `bg/fansly` chunk,
// a Fansly tab and the extension pages read it; no ChatSpace bundle and not
// the background core reach it (architecture §1.8, §3.2). The shared code that
// must name the hub's wider claim body (the hub facade) has its types in
// hub/claim-body.ts (`HubClaimBody`), types only.

import * as z from 'zod/mini';

import { CgAnyCodeSchema } from './errors-fansly';
import type { ManualClaimGroup } from './hub/claim-body';
import { CLAIM_REVISION_MAX, SEND_FAILURE_REASONS, type ClaimGroup } from './hub/newcomers';
import { PageLabelSchema } from './hub/wire';
import { HumanCauseSchema } from './ids';
import { PART_LIMITS } from './limits';
import { EpochMsSchema, GenerationRefSchema, HubIntIdSchema, HubOriginSchema, NativeIdSchema, UuidSchema } from './primitives';
import { isNativeRefusalStatus } from './send-rules';

export const FANSLY_SEND_LIMITS = {
  /** The «Новые» draft field and so one greeting (FS-NEW-6, NF-012): 5000 characters, as the old 2.10.1. */
  greetingMaxChars: 5000,
  /** Ended records the journal keeps for diagnostics; open ones are never counted or dropped (as X8 `send.journal`). */
  journalEndedKept: 200,
  journalEndedTtlMs: 24 * 60 * 60 * 1000,
} as const;

/** `storage.local` key of the attempt journal: its own key, beside X8's `send.journal` (STORAGE_KEYS), which it never shares. */
export const FANSLY_SEND_JOURNAL_KEY = 'fansly.send.journal';
export const FANSLY_SEND_JOURNAL_VERSION = 1;

/** The hub's revision columns are 32-bit (CLAIM_REVISION_MAX): the draft revision goes to it as `textRevision`. */
const RevisionSchema = z.int().check(z.gte(0), z.lte(CLAIM_REVISION_MAX));
const VariantSchema = z.int().check(z.gte(0), z.lte(PART_LIMITS.maxVariants - 1));
const HttpStatusSchema = z.int().check(z.gte(100), z.lte(599));

// ── The manual group (hub HF-3, `manual-greeting-v1`) ─────────────────────

/**
 * A manual group's `textFingerprint`: the sha256 of the exact text the POST carries as `content` (the field's
 * content, trimmed: the request's `text`), over its UTF-8 bytes, lower-case hex — the hub's
 * `CLIENT_TEXT_FINGERPRINT_PATTERN`. The hub never sees the text.
 */
export const TEXT_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
export const TextFingerprintSchema = z.string().check(z.regex(TEXT_FINGERPRINT_PATTERN));

/** How the hub answers a manual group (`ClaimState.group.generationRef`): this prefix and the fingerprint; no AI ref starts so (it is a UUID). */
export const MANUAL_GROUP_REF_PREFIX = 'manual:';

/** A greeting with no AI generation behind it: one part, named by the fingerprint of its text (HF-3). */
export const ManualClaimGroupSchema = z.strictObject({ kind: z.literal('manual'), textFingerprint: TextFingerprintSchema });

/** An unchanged AI result: the generation's group, one part — a greeting of «Новые» is one message (one POST). */
export const FanslyAiGreetingGroupSchema = z.strictObject({ generationRef: GenerationRefSchema, variant: VariantSchema, partCount: z.literal(1) });

/** The group a Fansly greeting names in the custody: the generation's (unchanged AI text) or a manual one (FS-NEW-6). */
export const FanslyGreetingGroupSchema = z.union([FanslyAiGreetingGroupSchema, ManualClaimGroupSchema]);
export type FanslyGreetingGroup = z.infer<typeof FanslyGreetingGroupSchema>;

/** The group's ref as the hub answers it (`ClaimState.group.generationRef`). */
export function greetingGroupRef(group: ClaimGroup | ManualClaimGroup): string {
  return 'kind' in group ? `${MANUAL_GROUP_REF_PREFIX}${group.textFingerprint}` : group.generationRef;
}

// ── The «Новые» greeting request ──────────────────────────────────────────

/**
 * The three admissions of FS-NEW-6, by what is in the field at the click:
 * - `own` — the person's own text, no generation: the pass checked the fan's history in full and the history
 *   revision the person reviewed is still the pass's at the send (`historyRevision`); a manual group;
 * - `ai` — the AI result unchanged: a fresh verdict of THIS generation (FS-TAIL-8) and the same history revision;
 *   the generation's group, marked «AI»; the background compares the text with the result and refuses a difference;
 * - `ai-edited` — an AI result the person changed: admitted as `own`, a manual group, no «AI» mark; the source
 *   generation is named for the acceptance count only.
 */
export const FANSLY_GREETING_ADMISSIONS = ['own', 'ai', 'ai-edited'] as const;
export type FanslyGreetingAdmissionKind = (typeof FANSLY_GREETING_ADMISSIONS)[number];

const AiSource = { generationRef: GenerationRefSchema, variant: VariantSchema };
export const FanslyGreetingAdmissionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('own') }),
  z.strictObject({ kind: z.literal('ai'), ...AiSource }),
  z.strictObject({ kind: z.literal('ai-edited'), ...AiSource }),
]);
export type FanslyGreetingAdmission = z.infer<typeof FanslyGreetingAdmissionSchema>;

/** The group of a greeting by its admission: an unchanged AI text goes as its generation's group, any other as a manual one. */
export function fanslyGreetingGroup(admission: FanslyGreetingAdmission, textFingerprint: string): FanslyGreetingGroup {
  return admission.kind === 'ai'
    ? { generationRef: admission.generationRef, variant: admission.variant, partCount: 1 }
    : { kind: 'manual', textFingerprint };
}

/** The admission and the group agree: `ai` ⇔ that generation's group, `own` and `ai-edited` ⇔ a manual group. */
export function admissionFitsGroup(admission: FanslyGreetingAdmission, group: FanslyGreetingGroup): boolean {
  if ('kind' in group) return admission.kind !== 'ai';
  return admission.kind === 'ai' && admission.generationRef === group.generationRef && admission.variant === group.variant;
}

/**
 * «Отправить» on a «Новые» card (FS-NEW-3, FS-NEW-6; request `fansly.followers.send`): what the person sends and
 * what they saw when they clicked. The background re-derives everything else (the page and its hub, the session,
 * the route) and takes this as the tuple of the final check. `text` is the field's content as it goes out:
 * trimmed by the window, never empty, never longer than the field.
 */
export const FanslyGreetingRequestSchema = z.strictObject({
  /** Minted by the window per click: one click, one attempt, one custody. */
  attemptId: UuidSchema,
  /** The pass whose row it is; a closed or another account's pass refuses it (NF-026). */
  passId: UuidSchema,
  /** The creator (Fansly `account.id`): the tab's account at the click. */
  hostAccountId: NativeIdSchema,
  fanRef: NativeIdSchema,
  /** The conversation the pass resolved (`groupId`), never the fan's id (FS-IDN-6). */
  groupId: NativeIdSchema,
  text: z.string().check(
    z.minLength(1),
    z.maxLength(FANSLY_SEND_LIMITS.greetingMaxChars),
    z.refine((text) => text.trim() === text, { message: 'the text goes out trimmed' }),
  ),
  /** The draft field's revision at the click (FS-NEW-6); a newer one voids the attempt. The hub's `textRevision`. */
  draftRevision: RevisionSchema,
  /** The history revision the person reviewed (the row's, FS-NEW-7); another at the send → CG-FNEW-HISTORY, no POST. */
  historyRevision: UuidSchema,
  admission: FanslyGreetingAdmissionSchema,
  /** The trusted click or key that asked for it: no send without one. */
  cause: HumanCauseSchema,
});
export type FanslyGreetingRequest = z.infer<typeof FanslyGreetingRequestSchema>;

// ── The attempt's state machine ───────────────────────────────────────────

/**
 * - `ready` — nothing taken yet; the click starts the attempt.
 * - `claimed` — the hub's lease on the fan is ours (renewed every `claimRenewSec` while the attempt lives).
 * - `routed` — the pacer's slot and, through the tab, the relay frame are ready: nothing waits after this.
 *   The journal record is written here, before `dispatch`.
 * - `dispatched` — the hub's custody (HF-3): a one-time ticket until `expiresAt`.
 * - `intentWritten` — the durable write «the send may start» is done; the final check and `fetch` follow in the same
 *   synchronous step.
 * - `requestStarted` — `fetch` (or the relay's request) is under way.
 * - `receipted` — Fansly answered with the message's id, this group and this creator.
 * - `sent` — the echo or the history shows that id (or the hub's resolve says sent).
 * - `refused` — proven not sent (FANSLY_REFUSAL_PROOFS): a new click may start a new attempt.
 * - `uncertain` — it may have gone out: never repeated, the fan stays held until a proof.
 */
export const FANSLY_SEND_STATES = ['ready', 'claimed', 'routed', 'dispatched', 'intentWritten', 'requestStarted', 'receipted', 'sent', 'refused', 'uncertain'] as const;
export type FanslySendState = (typeof FANSLY_SEND_STATES)[number];

/**
 * Every step the architecture names (§8.6). No state leads to `ready`: an attempt never starts over, a new click is a
 * new attempt. `sent` and `refused` end it. `uncertain` ends only by a proof: the late echo or history of a receipt it
 * kept, or the hub's resolve (owner or team lead) — never by itself, a timer or a restart. `routed` and `dispatched`
 * never reach `uncertain`: before the intent's write nothing can have been sent.
 */
export const FANSLY_SEND_TRANSITIONS = {
  ready: ['claimed', 'refused'],
  claimed: ['routed', 'refused'],
  routed: ['dispatched', 'refused'],
  dispatched: ['intentWritten', 'refused'],
  intentWritten: ['requestStarted', 'refused', 'uncertain'],
  requestStarted: ['receipted', 'refused', 'uncertain'],
  receipted: ['sent', 'uncertain'],
  sent: [],
  refused: [],
  uncertain: ['sent', 'refused'],
} as const satisfies Record<FanslySendState, readonly FanslySendState[]>;

/**
 * How a refusal is proven:
 * - `before-dispatch` — no custody was asked or the hub refused it (the lease, the pacer's cooldown, the route, the
 *   hub's answer): nothing was dispatched;
 * - `not-enqueued` — the custody may exist, but no request was made: the final check failed in this very process
 *   after the intent's write, the write itself failed, the ticket ran out before it, the dispatch's answer was lost
 *   (no ticket, no request), a restart found no intent, or the relay refused by its own check;
 * - `native-rejected` — Fansly answered a 4xx other than 401;
 * - `resolved-not-sent` — the hub's resolve of an `uncertain` attempt: the owner or a team lead checked.
 */
export const FANSLY_REFUSAL_PROOFS = ['before-dispatch', 'not-enqueued', 'native-rejected', 'resolved-not-sent'] as const;
export type FanslyRefusalProof = (typeof FANSLY_REFUSAL_PROOFS)[number];

/** How a send is proven: the echo 5/1 or the history read with the receipt's id; or the hub's resolve. */
export const FANSLY_SENT_PROOFS = ['echo', 'history', 'resolved-sent'] as const;
export type FanslySentProof = (typeof FANSLY_SENT_PROOFS)[number];

/**
 * Why an attempt is uncertain: `restart` — the journal holds the intent and nothing more (the browser or the
 * background went away); `network` — the fetch threw or timed out; `server` — 5xx or a status neither 2xx nor 4xx;
 * `unauthorized` — 401; `rejected-200` — 2xx with `success: false`; `bad-receipt` — 2xx without a receipt of this
 * group and creator; `relay` — the relay frame was lost after its fetch could start; `receipt-missing` — a complete
 * history read does not show the receipted id.
 */
export const FANSLY_UNCERTAIN_CAUSES = ['restart', 'network', 'server', 'unauthorized', 'rejected-200', 'bad-receipt', 'relay', 'receipt-missing'] as const;
export type FanslyUncertainCause = (typeof FANSLY_UNCERTAIN_CAUSES)[number];

/** Which proof may end an attempt as `refused` from each state. */
export const FANSLY_REFUSAL_PROOFS_FROM = {
  ready: ['before-dispatch'],
  claimed: ['before-dispatch'],
  routed: ['before-dispatch', 'not-enqueued'],
  dispatched: ['not-enqueued'],
  intentWritten: ['not-enqueued'],
  requestStarted: ['not-enqueued', 'native-rejected'],
  receipted: [],
  sent: [],
  refused: [],
  uncertain: ['resolved-not-sent'],
} as const satisfies Record<FanslySendState, readonly FanslyRefusalProof[]>;

/** Which proof may make an attempt `sent` from each state; `echo` and `history` only with the id of its own receipt. */
export const FANSLY_SENT_PROOFS_FROM = {
  ready: [],
  claimed: [],
  routed: [],
  dispatched: [],
  intentWritten: [],
  requestStarted: [],
  receipted: ['echo', 'history'],
  sent: [],
  refused: [],
  uncertain: ['echo', 'history', 'resolved-sent'],
} as const satisfies Record<FanslySendState, readonly FanslySentProof[]>;

/** Which cause may make an attempt `uncertain` from each state: between the intent and `fetch` only a restart can. */
export const FANSLY_UNCERTAIN_CAUSES_FROM = {
  ready: [],
  claimed: [],
  routed: [],
  dispatched: [],
  intentWritten: ['restart'],
  requestStarted: ['restart', 'network', 'server', 'unauthorized', 'rejected-200', 'bad-receipt', 'relay'],
  receipted: ['receipt-missing'],
  sent: [],
  refused: [],
  uncertain: [],
} as const satisfies Record<FanslySendState, readonly FanslyUncertainCause[]>;

/** States in which an attempt holds its fan: no new attempt for the same lock key, and the journal never drops them. */
export const FANSLY_SEND_OPEN_STATES = ['claimed', 'routed', 'dispatched', 'intentWritten', 'requestStarted', 'receipted', 'uncertain'] as const satisfies readonly FanslySendState[];

export function isFanslySendOpen(state: FanslySendState): boolean {
  return (FANSLY_SEND_OPEN_STATES as readonly FanslySendState[]).includes(state);
}

/**
 * A refusal no new click of the same card can lift: a colleague's lease or a confirmed greeting, a fan who cannot be
 * written to, an unresolved send to the fan (the hub's `custody_held`), Fansly's refusal of this text.
 */
export const FANSLY_SEND_CODES_WITHOUT_RETRY = ['CG-CLAIM-BUSY', 'CG-FNEW-DM-CLOSED', 'CG-SEND-UNCERTAIN', 'CG-SEND-REJECTED'] as const;

/**
 * What an end owes the hub's custody (HF-3 `clientFanClaim`), by its proof: `not-enqueued` → `failed: not_enqueued`
 * (the hub ignores it for a custody it never opened, and refuses it once the ticket ran out — then the fan stays held
 * there until a resolve); `native-rejected` → `failed: native_rejected` with the status; `echo` and `history` →
 * `sent` with the id (evidence `receipt+echo`), repeated with the same attemptId until the hub answers. Nothing for
 * `before-dispatch` (no custody), the hub's own resolves, and `uncertain`: the hub's custody turns `uncertain-held`
 * when the ticket runs out, as Fansly's `200 {success: false}` does on the hub too.
 */
export const FANSLY_CUSTODY_REPORTS = {
  'before-dispatch': null,
  'not-enqueued': 'failed-not-enqueued',
  'native-rejected': 'failed-native-rejected',
  'resolved-not-sent': null,
  echo: 'sent',
  history: 'sent',
  'resolved-sent': null,
} as const satisfies Record<FanslyRefusalProof | FanslySentProof, 'sent' | 'failed-not-enqueued' | 'failed-native-rejected' | null>;

export function fanslyCustodyReport(outcome: FanslySendOutcome): 'sent' | 'failed-not-enqueued' | 'failed-native-rejected' | null {
  return outcome.state === 'sent' || outcome.state === 'refused' ? FANSLY_CUSTODY_REPORTS[outcome.proof] : null;
}

// ── The attempt as the window sees it, and as the journal keeps it ────────

/** Fields by state (the same in the view and the journal record); the checks below hold them together. */
const Plain = <S extends FanslySendState>(state: S) => ({ state: z.literal(state) });
const Receipted = { state: z.literal('receipted'), platformMessageId: NativeIdSchema };
const Sent = { state: z.literal('sent'), proof: z.enum(FANSLY_SENT_PROOFS), platformMessageId: z.optional(NativeIdSchema) };
const Refused = {
  state: z.literal('refused'),
  proof: z.enum(FANSLY_REFUSAL_PROOFS),
  /** Why, as the person reads it; none after the hub's resolve. */
  code: z.optional(CgAnyCodeSchema),
  /** Only with `native-rejected`: the 4xx (not 401) the hub's `failed: native_rejected` reports. */
  httpStatus: z.optional(HttpStatusSchema),
};
const Uncertain = {
  state: z.literal('uncertain'),
  code: z.literal('CG-SEND-UNCERTAIN'),
  cause: z.enum(FANSLY_UNCERTAIN_CAUSES),
  /** Only with `receipt-missing`: the receipt's id, which a late echo or history may still show. */
  receiptMessageId: z.optional(NativeIdSchema),
};

/** What every attempt shape carries besides its identity. */
export type FanslySendOutcome =
  | { readonly state: Exclude<FanslySendState, 'receipted' | 'sent' | 'refused' | 'uncertain'> }
  | { readonly state: 'receipted'; readonly platformMessageId: string }
  | { readonly state: 'sent'; readonly proof: FanslySentProof; readonly platformMessageId?: string | undefined }
  | {
      readonly state: 'refused';
      readonly proof: FanslyRefusalProof;
      readonly code?: string | undefined;
      readonly httpStatus?: number | undefined;
    }
  | { readonly state: 'uncertain'; readonly code: 'CG-SEND-UNCERTAIN'; readonly cause: FanslyUncertainCause; readonly receiptMessageId?: string | undefined };

/** The rules no field type can say alone. */
const OUTCOME_CHECKS = [
  z.refine<FanslySendOutcome>((o) => o.state !== 'sent' || o.proof === 'resolved-sent' || o.platformMessageId !== undefined, {
    message: 'a send proven by the echo or the history names its message id',
  }),
  z.refine<FanslySendOutcome>(
    (o) =>
      o.state !== 'refused' || (o.proof === 'native-rejected' ? o.httpStatus !== undefined && isNativeRefusalStatus(o.httpStatus) : o.httpStatus === undefined),
    { message: 'a status proves a refusal only with native-rejected, and only a 4xx other than 401' },
  ),
  z.refine<FanslySendOutcome>((o) => o.state !== 'refused' || (o.proof === 'resolved-not-sent') === (o.code === undefined), {
    message: 'a refusal says why, except the hub resolve',
  }),
  z.refine<FanslySendOutcome>((o) => o.state !== 'uncertain' || (o.cause === 'receipt-missing') === (o.receiptMessageId !== undefined), {
    message: 'only a missing receipt keeps its id',
  }),
] as const;

const ViewBase = { attemptId: UuidSchema, fanRef: NativeIdSchema };

/** The attempt as the «Новые» window gets it (`fansly.followers.send`): its state and how it ended. */
export const FanslySendViewSchema = /* @__PURE__ */ z
  .discriminatedUnion('state', [
    z.strictObject({ ...ViewBase, ...Plain('ready') }),
    z.strictObject({ ...ViewBase, ...Plain('claimed') }),
    z.strictObject({ ...ViewBase, ...Plain('routed') }),
    z.strictObject({ ...ViewBase, ...Plain('dispatched') }),
    z.strictObject({ ...ViewBase, ...Plain('intentWritten') }),
    z.strictObject({ ...ViewBase, ...Plain('requestStarted') }),
    z.strictObject({ ...ViewBase, ...Receipted }),
    z.strictObject({ ...ViewBase, ...Sent }),
    z.strictObject({ ...ViewBase, ...Refused }),
    z.strictObject({ ...ViewBase, ...Uncertain }),
  ])
  .check(...OUTCOME_CHECKS);
export type FanslySendView = z.infer<typeof FanslySendViewSchema>;

/** The journal holds an attempt from `routed` on: before it nothing needs telling after a restart (the lease runs out by itself). */
export const FANSLY_SEND_JOURNAL_STATES = ['routed', 'dispatched', 'intentWritten', 'requestStarted', 'receipted', 'sent', 'refused', 'uncertain'] as const satisfies readonly FanslySendState[];
export type FanslySendJournalState = (typeof FANSLY_SEND_JOURNAL_STATES)[number];

/** How the POST goes (§8.5): straight from the background, or through the relay frame of the model's tab. */
export const FANSLY_SEND_TRANSPORTS = ['direct', 'tab'] as const;

const JournalBase = {
  attemptId: UuidSchema,
  /** The lock key's parts: one open attempt per (hubOrigin, pageId, fanRef). */
  hubOrigin: HubOriginSchema,
  pageId: HubIntIdSchema,
  hostAccountId: NativeIdSchema,
  fanRef: NativeIdSchema,
  groupId: NativeIdSchema,
  admission: FanslyGreetingAdmissionSchema,
  group: FanslyGreetingGroupSchema,
  draftRevision: RevisionSchema,
  historyRevision: UuidSchema,
  transport: z.enum(FANSLY_SEND_TRANSPORTS),
  /** The ticket's deadline on the local clock (`localDeadline`); null before the custody answered. */
  ticketExpiresAt: z.nullable(EpochMsSchema),
  createdAt: EpochMsSchema,
  updatedAt: EpochMsSchema,
};
/** States that hold the ticket: the custody answered, the attempt has not ended. */
const TICKET_STATES: readonly FanslySendState[] = ['dispatched', 'intentWritten', 'requestStarted'];
/** An end that owes the hub's custody a report (FANSLY_CUSTODY_REPORTS) keeps it pending until the hub answers it. */
const Report = { reportPending: z.boolean() };

/**
 * One record of `fansly.send.journal` (storage.local): ids, revisions, fingerprints and states only — never a text,
 * never a session header. Written first at `routed` (before `dispatch`), then at `intentWritten` (awaited: the
 * durable intent), at `receipted` (the id the echo must repeat) and at the end. A record in an open state is never
 * dropped; ended ones go by FANSLY_SEND_LIMITS.
 */
export const FanslySendJournalEntrySchema = /* @__PURE__ */ z
  .discriminatedUnion('state', [
    z.strictObject({ ...JournalBase, ...Plain('routed') }),
    z.strictObject({ ...JournalBase, ...Plain('dispatched') }),
    z.strictObject({ ...JournalBase, ...Plain('intentWritten') }),
    z.strictObject({ ...JournalBase, ...Plain('requestStarted') }),
    z.strictObject({ ...JournalBase, ...Receipted }),
    z.strictObject({ ...JournalBase, ...Sent, ...Report }),
    z.strictObject({ ...JournalBase, ...Refused, ...Report }),
    z.strictObject({ ...JournalBase, ...Uncertain }),
  ])
  .check(
    ...OUTCOME_CHECKS,
    z.refine((e) => e.updatedAt >= e.createdAt, { message: 'updatedAt never goes before createdAt' }),
    z.refine((e) => admissionFitsGroup(e.admission, e.group), { message: 'an unchanged AI text goes as its generation, any other text as a manual group' }),
    z.refine((e) => (e.state === 'routed' ? e.ticketExpiresAt === null : !TICKET_STATES.includes(e.state) || e.ticketExpiresAt !== null), {
      message: 'the ticket comes with the custody: none at routed, kept from dispatched on',
    }),
    z.refine((e) => !(e.state === 'sent' || e.state === 'refused') || !e.reportPending || FANSLY_CUSTODY_REPORTS[e.proof] !== null, {
      message: 'only an end that owes the custody a report keeps one pending',
    }),
  );
export type FanslySendJournalEntry = z.infer<typeof FanslySendJournalEntrySchema>;


/** The value under FANSLY_SEND_JOURNAL_KEY, oldest record first. */
export const FanslySendJournalSchema = z.strictObject({ v: z.literal(FANSLY_SEND_JOURNAL_VERSION), entries: z.array(FanslySendJournalEntrySchema) });
export type FanslySendJournal = z.infer<typeof FanslySendJournalSchema>;

export type FanslySendLockKey = `${string}|${number}|fansly|${string}`;

/** One open attempt at a time per fan of a page of a hub (the hub's custody holds it across clients). */
export function fanslySendLockKey(entry: Pick<FanslySendJournalEntry, 'hubOrigin' | 'pageId' | 'fanRef'>): FanslySendLockKey {
  return `${entry.hubOrigin}|${entry.pageId}|fansly|${entry.fanRef}`;
}

// ── Steps, restarts and the custody ───────────────────────────────────────

const OUTCOME_FIELDS = ['state', 'proof', 'code', 'httpStatus', 'cause', 'platformMessageId', 'receiptMessageId'] as const;

function sameOutcome(a: FanslySendOutcome, b: FanslySendOutcome): boolean {
  const left = a as Readonly<Record<string, unknown>>;
  const right = b as Readonly<Record<string, unknown>>;
  return OUTCOME_FIELDS.every((field) => left[field] === right[field]);
}

/**
 * Whether `next` may follow `prev` (both valid by their schema): an edge of FANSLY_SEND_TRANSITIONS with a proof or
 * cause that edge admits, and a send proven by the echo or the history only with the id of this attempt's own
 * receipt. The same state is no step: it is allowed only unchanged. Nothing reaches `ready`; nothing leaves `sent` or
 * `refused`; `uncertain` leaves only by a proof.
 */
export function isFanslySendStep(prev: FanslySendOutcome, next: FanslySendOutcome): boolean {
  if (prev.state === next.state) return sameOutcome(prev, next);
  if (!(FANSLY_SEND_TRANSITIONS[prev.state] as readonly FanslySendState[]).includes(next.state)) return false;
  switch (next.state) {
    case 'refused':
      return (FANSLY_REFUSAL_PROOFS_FROM[prev.state] as readonly FanslyRefusalProof[]).includes(next.proof);
    case 'sent': {
      if (!(FANSLY_SENT_PROOFS_FROM[prev.state] as readonly FanslySentProof[]).includes(next.proof)) return false;
      if (next.proof === 'resolved-sent') return true;
      const receipt = prev.state === 'receipted' ? prev.platformMessageId : prev.state === 'uncertain' ? prev.receiptMessageId : undefined;
      return receipt !== undefined && receipt === next.platformMessageId;
    }
    case 'uncertain':
      if (!(FANSLY_UNCERTAIN_CAUSES_FROM[prev.state] as readonly FanslyUncertainCause[]).includes(next.cause)) return false;
      return next.cause !== 'receipt-missing' || (prev.state === 'receipted' && next.receiptMessageId === prev.platformMessageId);
    case 'ready':
    case 'claimed':
    case 'routed':
    case 'dispatched':
    case 'intentWritten':
    case 'requestStarted':
    case 'receipted':
      return true;
  }
}

/**
 * What a restart makes of a record the dead process left (§8.6 «Окна сбоя»): before the intent nothing went out
 * (`not-enqueued`, the custody is told so); after it nobody knows whether `fetch` ran (`uncertain`, never repeated);
 * a receipt waits for its echo or the next pass's history; an end stays. Every entry is a step of
 * FANSLY_SEND_TRANSITIONS; none leads back to a send.
 */
export const FANSLY_SEND_RECOVERY = {
  routed: { state: 'refused', proof: 'not-enqueued', code: 'CG-OP-INTERRUPTED' },
  dispatched: { state: 'refused', proof: 'not-enqueued', code: 'CG-OP-INTERRUPTED' },
  intentWritten: { state: 'uncertain', code: 'CG-SEND-UNCERTAIN', cause: 'restart' },
  requestStarted: { state: 'uncertain', code: 'CG-SEND-UNCERTAIN', cause: 'restart' },
  receipted: null,
  sent: null,
  refused: null,
  uncertain: null,
} as const satisfies Record<FanslySendJournalState, FanslySendOutcome | null>;

/** Whether a new click may start a new attempt for the card after this one: only a refusal, and not one of the codes no click lifts. */
export function isFanslyRetryableEnd(outcome: FanslySendOutcome): boolean {
  if (outcome.state !== 'refused') return false;
  return outcome.code === undefined || !(FANSLY_SEND_CODES_WITHOUT_RETRY as readonly string[]).includes(outcome.code);
}

// ── The final check (§8.6, step 2) ────────────────────────────────────────

/**
 * What the click saw and the send must still see: the creator, the conversation, the fan, the tab document the
 * person acted in (its tab session), the route (`direct`, or `tab:<tabSessionId>` of the relay frame), the history and
 * draft revisions. Taken at the click, compared from memory right before `fetch`.
 */
export interface FanslySendTuple {
  readonly hostAccountId: string;
  readonly groupId: string;
  readonly fanRef: string;
  readonly tabSessionId: string;
  readonly transport: 'direct' | `tab:${string}`;
  readonly historyRevision: string;
  readonly draftRevision: number;
}
export const FANSLY_SEND_TUPLE_FIELDS = ['hostAccountId', 'groupId', 'fanRef', 'tabSessionId', 'transport', 'historyRevision', 'draftRevision'] as const satisfies readonly (keyof FanslySendTuple)[];

/**
 * Step 2 of §8.6, synchronous and by memory: the tuple of the click against the tuple now, and the ticket's rest
 * (its local deadline against `nowMs`). Any difference, or a ticket at its end, refuses the attempt with
 * `not-enqueued` — in this very process `fetch` was provably not called. `ok` → `fetch` at once, no `await` between.
 */
export function fanslyFinalCheck(
  taken: FanslySendTuple,
  current: FanslySendTuple,
  ticketExpiresAt: number,
  nowMs: number,
): { readonly ok: true } | { readonly ok: false; readonly field: keyof FanslySendTuple | 'ticket' } {
  for (const field of FANSLY_SEND_TUPLE_FIELDS) if (taken[field] !== current[field]) return { ok: false, field };
  return nowMs < ticketExpiresAt ? { ok: true } : { ok: false, field: 'ticket' };
}

/**
 * The receipt of `POST /message` (`response` of `{success: true, response}`): the new message's id, its group and
 * its sender, as strings. A receipt counts only when the group is the attempt's and the sender its creator
 * (`fanslyReceiptFits`); otherwise the outcome is `uncertain` (`bad-receipt`). Fansly sends more fields; they are
 * not read.
 */
export const FanslySendReceiptSchema = z.object({ id: NativeIdSchema, groupId: NativeIdSchema, senderId: NativeIdSchema });
export type FanslySendReceipt = z.infer<typeof FanslySendReceiptSchema>;

export function fanslyReceiptFits(receipt: FanslySendReceipt, tuple: Pick<FanslySendTuple, 'groupId' | 'hostAccountId'>): boolean {
  return receipt.groupId === tuple.groupId && receipt.senderId === tuple.hostAccountId;
}

// ── The custody of a Fansly greeting (hub HF-3) ───────────────────────────

const LeaseAction = <A extends 'claim' | 'renew' | 'release'>(action: A) => z.strictObject({ action: z.literal(action), leaseToken: UuidSchema, instanceId: UuidSchema });

/**
 * Body of the hub's `clientFanClaim` for a Fansly greeting: the hub's body (HF-3, `clientFanClaimBodySchema`)
 * narrowed to what Fansly admits and our send does — purpose `greeting` only (a `preview-reply` is 409 on Fansly),
 * one part (`partIndex` 0), an AI group of one part or a manual one, and `dispatch` always under the caller's lease
 * (a greeting not yet confirmed needs it; a confirmed one is not sent again). `dispatch` needs the page's
 * `newcomers` and not `previewSend` (the hub's admission by platform); `release`, `sent`, `failed` need only the page
 * grant, so an attempt that started ends even after the flag went off. Every body this lets out the hub takes
 * (`FanslyGreetingClaimBody` extends `HubClaimBody`); the OnlyFans body stays `ClaimBodySchema`.
 */
export const FanslyGreetingClaimBodySchema = /* @__PURE__ */ z
  .discriminatedUnion('action', [
    LeaseAction('claim'),
    LeaseAction('renew'),
    LeaseAction('release'),
    z.strictObject({
      action: z.literal('dispatch'),
      attemptId: UuidSchema,
      instanceId: UuidSchema,
      purpose: z.literal('greeting'),
      group: FanslyGreetingGroupSchema,
      partIndex: z.literal(0),
      /** The draft field's revision (`draftRevision`). */
      textRevision: RevisionSchema,
      leaseToken: UuidSchema,
      /** = the bootstrap `configRevision` the client acted on. */
      flagRevision: RevisionSchema,
    }),
    z.strictObject({ action: z.literal('sent'), attemptId: UuidSchema, instanceId: UuidSchema, platformMessageId: NativeIdSchema, evidence: z.literal('receipt+echo') }),
    z.strictObject({
      action: z.literal('failed'),
      attemptId: UuidSchema,
      instanceId: UuidSchema,
      reason: z.enum(SEND_FAILURE_REASONS),
      httpStatus: z.optional(HttpStatusSchema),
    }),
    /** The person sent the card's text with Fansly's own button after «Открыть и вставить» (FS-NEW-3): the fan is greeted for everyone. */
    z.strictObject({
      action: z.literal('registerNativeSend'),
      attemptId: UuidSchema,
      instanceId: UuidSchema,
      purpose: z.literal('greeting'),
      group: FanslyGreetingGroupSchema,
      partIndex: z.literal(0),
      platformMessageId: NativeIdSchema,
    }),
  ])
  .check(
    z.refine(
      (b) =>
        b.action !== 'failed' ||
        (b.reason === 'native_rejected' ? b.httpStatus !== undefined && isNativeRefusalStatus(b.httpStatus) : b.httpStatus === undefined),
      { message: 'native_rejected needs a 4xx other than 401; not_enqueued carries no status' },
    ),
  );
export type FanslyGreetingClaimBody = z.infer<typeof FanslyGreetingClaimBodySchema>;

/** One claim call of a Fansly greeting: path `pageLabel` + `fanRef` (the fan's account id), and the body. */
export const FanslyGreetingClaimOpSchema = z.strictObject({ pageLabel: PageLabelSchema, fanRef: NativeIdSchema, body: FanslyGreetingClaimBodySchema });
export type FanslyGreetingClaimOp = z.infer<typeof FanslyGreetingClaimOpSchema>;
