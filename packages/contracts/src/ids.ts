// Identities (architecture.md §5.1). Three id namespaces never mix: the host's
// (OnlyMonster account), the platform's (OnlyFans creator, fan, message) and
// the hub's (pageId, userId). In ChatSpace the route's chatId IS the OnlyFans
// fan id IS the hub fanRef and conversationRef — Target pins that equality.
// On Fansly (R20, 1.15.0) the conversation is the group, not the fan:
// conversationRef = groupId, fanRef = the fan id.

import * as z from 'zod/mini';

import { FeatureIdSchema } from './features';
import { HOST_KINDS, HOST_PLATFORM, type HostKind } from './hosts';
import { PART_LIMITS } from './limits';
import {
  ActionTokenSchema,
  CountSchema,
  DigestSchema,
  EpochTokenSchema,
  HubIntIdSchema,
  HubOriginSchema,
  NATIVE_ID_PATTERN,
  NativeIdSchema,
  PersonaDefinitionIdSchema,
  PersonaKeySchema,
  UuidSchema,
  boundedText,
  displayText,
} from './primitives';

/** The host kinds live in hosts.ts (1.15.0); `@cg/contracts/ids` still exports them. */
export { HOST_KINDS, type HostKind };
export const HostKindSchema = z.enum(HOST_KINDS);

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
 * 1.15.0 (R20 F6b): whether a chat of the platform IS its fan — the chat id is the fan id (OnlyFans) — or has an id
 * of its own (Fansly: a group). The hub keeps the same fact in one table (`clientConversationsHaveOwnIds`, HF-10);
 * `Target` pins the OnlyFans equality. Where a chat is not its fan, the fan's id names no conversation: what is the
 * fan's (the dossier, docs/project-unite/architecture.md §11.1) is read by the fan.
 */
export const CHAT_IS_FAN: Readonly<Record<Platform, boolean>> = { onlyfans: true, fansly: false };

/** HOST_PLATFORM of hosts.ts, typed: every host serves a platform this client knows. */
const PLATFORM_OF_HOST: Readonly<Record<HostKind, Platform>> = HOST_PLATFORM;

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

/**
 * A host account bound to exactly one hub page (§8.3), and which host
 * account it was resolved for. `platformAccountId` is the PAGE's (bootstrap
 * `pages[].platformAccountId`), never copied from the host account: X8
 * condition 5 checks it against ChatSpace's loaded accounts, which is a real
 * check only because it comes from the hub. `binding.resolve` refuses with
 * CG-BINDING-MISSING when the page has none, and with CG-BINDING-AMBIGUOUS
 * when the host account's known platformAccountId differs from the page's —
 * an explicit `bindingsByHost` entry included.
 */
export const HubBindingSchema = z.strictObject({
  hubOrigin: HubOriginSchema,
  principalId: HubIntIdSchema,
  loginEpoch: CountSchema,
  host: HostKindSchema,
  hostAccountId: NativeIdSchema,
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
    /** Hub conversation ref; on OnlyFans equal to the fan id, on Fansly the group id. */
    conversationRef: NativeIdSchema,
  })
  .check(
    z.refine((t) => t.fanRef === t.chat.platformFanId, { message: 'fanRef must equal chat.platformFanId' }),
    z.refine((t) => t.binding.platform !== 'onlyfans' || t.conversationRef === t.fanRef, {
      message: 'on OnlyFans conversationRef must equal fanRef',
    }),
    // 1.15.0: the pair comes from HOST_PLATFORM (ChatSpace — OnlyFans, fansly.com — Fansly), not from a ChatSpace literal.
    z.refine((t) => PLATFORM_OF_HOST[t.chat.host] === t.binding.platform, {
      message: "a chat binds to its host's platform only",
    }),
    z.refine((t) => t.binding.host === t.chat.host && t.binding.hostAccountId === t.chat.hostAccountId, {
      message: "the binding was resolved for the chat's own host account",
    }),
  );
export type Target = z.infer<typeof TargetSchema>;

/** Immutable identity of one generation: switching the active chat never rebinds it. */
export const GenerationIdentitySchema = z.strictObject({
  target: TargetSchema,
  feature: FeatureIdSchema,
  personaKey: PersonaKeySchema,
  personaDefinitionId: PersonaDefinitionIdSchema,
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

/** One part of one result: `variant` for Hi (PART_LIMITS), `index` for Split parts. */
export const PartRefSchema = z.strictObject({
  variant: z.optional(z.int().check(z.gte(0), z.lte(PART_LIMITS.maxVariants - 1))),
  index: z.int().check(z.gte(0), z.lte(PART_LIMITS.maxParts - 1)),
});
export type PartRef = z.infer<typeof PartRefSchema>;
