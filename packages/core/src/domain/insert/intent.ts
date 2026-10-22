// Insert intents (architecture.md §6.4, §6.5, D-10, AI-125): an insert is
// bound for ever to its operation's fan. Before anything goes to the host the
// isolated side checks that the sign-in epoch, the binding revision and the
// persona are the operation's, that the route shows exactly the target chat,
// and that the target's composer is ready, visible and the one the draft was
// read from. The intent carries what MAIN compares again in one synchronous
// step right before the write: document epoch, route epoch, composer
// instance, draft revision and document fingerprint (CAS). A deferred
// insert («Открыть и вставить») knows only the document; MAIN reads the new
// draft after the navigation, in the same step as the write.

import { type CgCode } from '@cg/contracts/errors';
import {
  InsertIntentSchema,
  InsertWireSchema,
  NavigationIntentSchema,
  type ComposerState,
  type InsertIntent,
  type InsertWire,
  type NavigationIntent,
  type RouteState,
} from '@cg/contracts/host';
import { chatKeyOf, type ChatRef, type DraftSnapshot, type HostIdentity, type HumanCause, type PartRef, type Target } from '@cg/contracts/ids';
import { BRIDGE_LIMITS } from '@cg/contracts/limits';

/** How long an open insert stays valid after it was built (one bridge round trip and some). */
export const OPEN_INSERT_TTL_MS = 10_000;

/** Whether `a` is exactly the chat `b` (host, account and fan). */
export const sameChat = (a: ChatRef | null, b: ChatRef): boolean => a !== null && chatKeyOf(a) === chatKeyOf(b);

/** What the operation was frozen with, and what the background and the host say now. */
export interface InsertGuardInput {
  readonly op: { readonly target: Target; readonly personaDefinitionId: string; readonly signInEpoch: number };
  readonly current: {
    readonly signInEpoch: number | null;
    readonly bindingRevision: number | null;
    readonly personaDefinitionId: string | null;
  };
  readonly host: { readonly route: RouteState; readonly composer: ComposerState | null; readonly identity: HostIdentity | null };
}

/** §6.4 п. 1 — null when the insert may be built, otherwise the code the person sees. */
export function insertGuard(input: InsertGuardInput): CgCode | null {
  const { op, current, host } = input;
  if (current.signInEpoch !== op.signInEpoch || current.bindingRevision !== op.target.binding.bindingRevision || current.personaDefinitionId !== op.personaDefinitionId) {
    return 'CG-CONTEXT-CHANGED';
  }
  const target = op.target.chat;
  if (host.route.name !== 'chat' || !sameChat(host.route.chat, target)) return 'CG-INSERT-CHAT-CHANGED';
  const identity = host.identity;
  if (identity === null || !sameChat(identity.chat, target) || identity.hostAccountId !== target.hostAccountId) return 'CG-INSERT-CHAT-CHANGED';
  if (identity.platformAccountId !== op.target.binding.platformAccountId) return 'CG-CONTEXT-CHANGED';
  const composer = host.composer;
  if (composer === null || !sameChat(composer.chat, target) || !composer.ready || composer.instanceId !== identity.composerInstanceId) return 'CG-HOST-COMPOSER-MISSING';
  if (composer.hidden) return 'CG-GATE-FAN-BLOCKED';
  return null;
}

export interface OpenInsertInput {
  readonly intentId: string;
  readonly operationId: string;
  readonly part: PartRef;
  readonly text: string;
  readonly mode: 'replace' | 'append';
  /** The operation's chat (`op.target.chat`): the insert is bound to it for ever, whatever the draft says. */
  readonly target: ChatRef;
  /** The draft read right before (its identity is the CAS); for a consented write, the confirmed one. */
  readonly draft: DraftSnapshot;
  readonly confirmationId: string | null;
  readonly cause: HumanCause;
  readonly now: number;
  readonly ttlMs?: number;
}

export type IntentResult<T> = { readonly ok: true; readonly intent: T } | { readonly ok: false; readonly code: CgCode };

/**
 * An `open` intent (the chat is open now): CAS on the draft's identity,
 * revision and fingerprint. A draft read from any chat but the operation's is
 * refused (CG-INSERT-CHAT-CHANGED): its CAS fields would all agree with that
 * other chat, so MAIN's compare could not catch it.
 */
export function buildOpenInsert(input: OpenInsertInput): IntentResult<InsertIntent> {
  const identity = input.draft.identity;
  if (!sameChat(identity.chat, input.target)) return { ok: false, code: 'CG-INSERT-CHAT-CHANGED' };
  if (identity.composerInstanceId === null) return { ok: false, code: 'CG-HOST-COMPOSER-MISSING' };
  // An empty text only replaces (Voice's «Убрать текст», 1.47.0): nothing else writes nothing.
  if ((input.text.length === 0 && input.mode !== 'replace') || input.text.length > BRIDGE_LIMITS.maxStringLength) return { ok: false, code: 'CG-INSERT-FAILED' };
  const intent: InsertIntent = {
    intentId: input.intentId,
    operationId: input.operationId,
    part: input.part,
    target: input.target,
    expected: {
      kind: 'open',
      documentEpoch: identity.documentEpoch,
      routeEpoch: identity.routeEpoch,
      composerInstanceId: identity.composerInstanceId,
      draftRevision: input.draft.revision,
      draftDigest: input.draft.digest,
    },
    mode: input.mode,
    text: input.text,
    confirmationId: input.confirmationId,
    createdAt: input.now,
    expiresAt: input.now + (input.ttlMs ?? OPEN_INSERT_TTL_MS),
    cause: input.cause,
  };
  return InsertIntentSchema.safeParse(intent).success ? { ok: true, intent } : { ok: false, code: 'CG-INSERT-FAILED' };
}

/**
 * Whether an open intent still describes the host as it is (A→B→A: a route
 * that went away and came back has a new epoch, so the old intent is dead).
 */
export function intentMatchesHost(intent: InsertIntent | InsertWire, identity: HostIdentity | null): boolean {
  if (identity === null || intent.expected.kind !== 'open') return false;
  return (
    identity.documentEpoch === intent.expected.documentEpoch &&
    identity.routeEpoch === intent.expected.routeEpoch &&
    identity.composerInstanceId === intent.expected.composerInstanceId &&
    sameChat(identity.chat, intent.target)
  );
}

export interface DeferredInsertInput {
  readonly intentId: string;
  readonly operationId: string;
  readonly part: PartRef;
  readonly target: ChatRef;
  readonly text: string;
  readonly documentEpoch: string;
  readonly now: number;
  /** `limits.navInsertTimeoutSec` × 1000 (default 20 s, §6.5). */
  readonly timeoutMs: number;
}

/** The `thenInsert` of «Открыть и вставить»: replace only an empty or our own draft, no consent (§6.5). */
export function buildDeferredInsert(input: DeferredInsertInput): IntentResult<InsertWire> {
  const wire: InsertWire = {
    intentId: input.intentId,
    operationId: input.operationId,
    part: input.part,
    target: input.target,
    expected: { kind: 'deferred', documentEpoch: input.documentEpoch },
    mode: 'replace',
    text: input.text,
    confirmationId: null,
    createdAt: input.now,
    expiresAt: input.now + input.timeoutMs,
  };
  return InsertWireSchema.safeParse(wire).success ? { ok: true, intent: wire } : { ok: false, code: 'CG-INSERT-FAILED' };
}

/**
 * «Открыть и вставить»: one human navigation to the exact chat with its deferred insert. `conversationRef` — the
 * conversation of the operation's target (on Fansly the group id); the navigation names it only when it is not the fan.
 */
export function buildOpenAndInsert(input: { readonly intentId: string; readonly cause: HumanCause; readonly insert: InsertWire; readonly conversationRef?: string }): IntentResult<NavigationIntent> {
  const { hostAccountId, platformFanId } = input.insert.target;
  const conversationRef = input.conversationRef;
  const intent: NavigationIntent = {
    intentId: input.intentId,
    cause: input.cause,
    target: { hostAccountId, platformFanId, ...(conversationRef === undefined || conversationRef === platformFanId ? {} : { conversationRef }) },
    thenInsert: input.insert,
  };
  return NavigationIntentSchema.safeParse(intent).success ? { ok: true, intent } : { ok: false, code: 'CG-NAV-FAILED' };
}
