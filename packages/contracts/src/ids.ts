// Identities (architecture.md §5.1). Three id namespaces never mix: the host's
// (OnlyMonster account), the platform's (OnlyFans creator, fan, message) and
// the hub's (pageId, userId). In ChatSpace the route's chatId IS the OnlyFans
// fan id IS the hub fanRef and conversationRef — Target pins that equality.

import * as z from 'zod/mini';

import { FeatureIdSchema } from './features';
import {
  ActionTokenSchema,
  CountSchema,
  DigestSchema,
  EpochTokenSchema,
  HubIntIdSchema,
  HubOriginSchema,
  NATIVE_ID_PATTERN,
  NativeIdSchema,
  UuidSchema,
  boundedText,
  displayText,
} from './primitives';

export const HOST_KINDS = ['chatspace', 'fansly-web'] as const;
export const HostKindSchema = z.enum(HOST_KINDS);
export type HostKind = z.infer<typeof HostKindSchema>;

/**
 * Platforms this client knows. On the hub wire a platform is an open token
 * (critic item 14): a page with an unknown platform is skipped with
 * `narrowPlatform`, it never breaks the parse of a whole bootstrap.
 */
export const KNOWN_PLATFORMS = ['onlyfans', 'fansly'] as const;
export const PlatformSchema = z.enum(KNOWN_PLATFORMS);
export type Platform = z.infer<typeof PlatformSchema>;

export function narrowPlatform(token: string): Platform | null {
  return (KNOWN_PLATFORMS as readonly string[]).includes(token) ? (token as Platform) : null;
}

/**
 * Hub roles. The hub sends an open token; anything outside the known list is
 * narrowed to `unknown` and treated with the least privilege (as a chatter).
 */
export const KNOWN_ROLES = ['owner', 'team_lead', 'chatter'] as const;
export const ROLES = [...KNOWN_ROLES, 'unknown'] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

export function narrowRole(token: string): Role {
  return (KNOWN_ROLES as readonly string[]).includes(token) ? (token as Role) : 'unknown';
}

/** A chat on a host. ChatSpace: OnlyMonster account id + OnlyFans fan id. */
export const ChatRefSchema = z.strictObject({
  host: HostKindSchema,
  hostAccountId: NativeIdSchema,
  platformFanId: NativeIdSchema,
});
export type ChatRef = z.infer<typeof ChatRefSchema>;

/** `${host}:${hostAccountId}:${platformFanId}` — the one string key of a chat across the extension. */
export type ChatKey = `${HostKind}:${string}:${string}`;
const NATIVE = NATIVE_ID_PATTERN.source.slice(1, -1);
export const CHAT_KEY_PATTERN = new RegExp(`^(?:${HOST_KINDS.join('|')}):${NATIVE}:${NATIVE}$`);
export const ChatKeySchema = z.custom<ChatKey>((value) => typeof value === 'string' && CHAT_KEY_PATTERN.test(value));

export function chatKeyOf(chat: ChatRef): ChatKey {
  return `${chat.host}:${chat.hostAccountId}:${chat.platformFanId}`;
}

/** A host account as the host shows it. `platformAccountId` is the ONLY key that binds it to a hub page. */
export const HostAccountSchema = z.strictObject({
  host: HostKindSchema,
  hostAccountId: NativeIdSchema,
  platform: PlatformSchema,
  /** OnlyFans creator id; null while the host has not loaded it. */
  platformAccountId: z.nullable(NativeIdSchema),
  /** Display only; never used for binding (AU-023). */
  username: z.nullable(displayText(128)),
  displayName: z.nullable(displayText(256)),
});
export type HostAccount = z.infer<typeof HostAccountSchema>;

/** Who is signed in to the hub. `epoch` grows on every sign-in and sign-out. */
export const SessionIdentitySchema = z.strictObject({
  hubOrigin: HubOriginSchema,
  userId: HubIntIdSchema,
  login: boundedText(128),
  role: RoleSchema,
  epoch: CountSchema,
});
export type SessionIdentity = z.infer<typeof SessionIdentitySchema>;

/** A host account bound to exactly one hub page (by platformAccountId, §8.3). */
export const HubBindingSchema = z.strictObject({
  hubOrigin: HubOriginSchema,
  principalId: HubIntIdSchema,
  loginEpoch: CountSchema,
  platform: PlatformSchema,
  platformAccountId: NativeIdSchema,
  pageId: HubIntIdSchema,
  pageLabel: boundedText(120),
  bindingRevision: CountSchema,
});
export type HubBinding = z.infer<typeof HubBindingSchema>;

/** The fan a feature works on, frozen for an operation. */
export const TargetSchema = z
  .strictObject({
    binding: HubBindingSchema,
    chat: ChatRefSchema,
    /** Hub fan ref = the platform fan id. */
    fanRef: NativeIdSchema,
    /** Hub conversation ref; on OnlyFans equal to the fan id. */
    conversationRef: NativeIdSchema,
  })
  .check(
    z.refine((t) => t.fanRef === t.chat.platformFanId, { message: 'fanRef must equal chat.platformFanId' }),
    z.refine((t) => t.binding.platform !== 'onlyfans' || t.conversationRef === t.fanRef, {
      message: 'on OnlyFans conversationRef must equal fanRef',
    }),
    z.refine((t) => (t.chat.host === 'chatspace') === (t.binding.platform === 'onlyfans'), {
      message: 'ChatSpace chats bind to OnlyFans pages only',
    }),
  );
export type Target = z.infer<typeof TargetSchema>;

/** Immutable identity of one generation: switching the active chat never rebinds it. */
export const GenerationIdentitySchema = z.strictObject({
  target: TargetSchema,
  feature: FeatureIdSchema,
  personaKey: boundedText(64),
  personaDefinitionId: boundedText(128),
  operationId: UuidSchema,
  /** Equals operationId (hub `clientRequestId = opId`, §8.4). */
  clientRequestId: UuidSchema,
  tabSessionId: UuidSchema,
  /** Hash of every request parameter: window, tone, Split, Fix draft, archive head. */
  requestDigest: DigestSchema,
});
export type GenerationIdentity = z.infer<typeof GenerationIdentitySchema>;

/** What the host page looked like when something was read or is about to be written. */
export const HostIdentitySchema = z.strictObject({
  host: HostKindSchema,
  /** Minted by MAIN once per document; changes on reload. */
  documentEpoch: EpochTokenSchema,
  /** Changes when the host session (OnlyMonster login) changes. */
  hostLoginEpoch: EpochTokenSchema,
  hostAccountId: NativeIdSchema,
  platformAccountId: NativeIdSchema,
  chat: z.nullable(ChatRefSchema),
  /** Grows on every route change of this document. */
  routeEpoch: CountSchema,
  /** One per mounted composer node; a replaced node gets a new id. */
  composerInstanceId: z.nullable(EpochTokenSchema),
});
export type HostIdentity = z.infer<typeof HostIdentitySchema>;

export const DRAFT_PROVENANCES = ['empty', 'our-insert', 'human-or-unknown'] as const;
export const DraftProvenanceSchema = z.enum(DRAFT_PROVENANCES);
export type DraftProvenance = z.infer<typeof DraftProvenanceSchema>;

export const DraftSnapshotSchema = z.strictObject({
  identity: HostIdentitySchema,
  /** Grows on every editor transaction that is not ours (§6.4). */
  revision: CountSchema,
  plainText: displayText(20_000),
  provenance: DraftProvenanceSchema,
  /** Fingerprint of the whole editor document, not only its text; local only. */
  digest: DigestSchema,
});
export type DraftSnapshot = z.infer<typeof DraftSnapshotSchema>;

/** Permission to write: a one-time token the background issued for a trusted event of our UI (§14). */
export const HumanCauseSchema = z.strictObject({
  kind: z.enum(['click', 'key']),
  actionToken: ActionTokenSchema,
});
export type HumanCause = z.infer<typeof HumanCauseSchema>;

/**
 * One part of one result: `variant` for Hi (up to 3 variants), `index` for
 * Split parts (up to 10). Same bounds as the hub's claim group (H-7).
 */
export const PART_LIMITS = { maxVariants: 3, maxParts: 10 } as const;
export const PartRefSchema = z.strictObject({
  variant: z.optional(z.int().check(z.gte(0), z.lte(PART_LIMITS.maxVariants - 1))),
  index: z.int().check(z.gte(0), z.lte(PART_LIMITS.maxParts - 1)),
});
export type PartRef = z.infer<typeof PartRefSchema>;
