// Payload checks of the requests the runtime serves (contracts TO_MAIN[t].payload),
// by hand (check.ts). Kept apart from the envelope check so the boot bundle
// carries none of them.

import { count, int, is, isDigest, isId, isToken, isUuid, orNull, shape, type Check, type Plain } from '@cg/host-kit/main/check';
import { type Checkpoint } from './live';
import { KNOWN_FAN_MESSAGES, MAX_PARTS, MAX_SNAPSHOT, MAX_STRING, MAX_VARIANTS, SEND_MAX_CHARS } from './protocol';

const isChat = shape({ host: is('chatspace'), hostAccountId: isId, platformFanId: isId });

/** HostIdentity (contracts HostIdentitySchema). */
export interface Identity {
  readonly documentEpoch: string;
  readonly hostLoginEpoch: string;
  readonly hostAccountId: string;
  readonly platformAccountId: string;
  readonly chat: { readonly hostAccountId: string; readonly platformFanId: string } | null;
  readonly routeEpoch: number;
  readonly composerInstanceId: string | null;
}

const isIdentity = shape({
  host: is('chatspace'),
  documentEpoch: isToken,
  hostLoginEpoch: isToken,
  hostAccountId: isId,
  platformAccountId: isId,
  chat: orNull(isChat),
  routeEpoch: count,
  composerInstanceId: orNull(isToken),
});

/** The insert as MAIN gets it (contracts InsertWireSchema). */
export interface InsertWire {
  readonly intentId: string;
  readonly target: { readonly hostAccountId: string; readonly platformFanId: string };
  readonly expected:
    | { readonly kind: 'open'; readonly documentEpoch: string; readonly routeEpoch: number; readonly composerInstanceId: string; readonly draftRevision: number; readonly draftDigest: string }
    | { readonly kind: 'deferred'; readonly documentEpoch: string };
  readonly mode: 'replace' | 'append';
  readonly text: string;
  readonly confirmationId: string | null;
  readonly createdAt: number;
  readonly expiresAt: number;
}

/** The navigation as MAIN gets it (contracts NavigationWireSchema). */
export interface NavigationWire {
  readonly intentId: string;
  readonly acc: string;
  readonly fan: string | null;
  readonly thenInsert?: InsertWire;
}

const isPart = shape({ index: int(0, MAX_PARTS - 1), 'variant?': int(0, MAX_VARIANTS - 1) });

const insertKeys = shape({
  intentId: isUuid,
  operationId: isUuid,
  part: isPart,
  target: isChat,
  expected: (value) =>
    shape({ kind: is('open'), documentEpoch: isToken, routeEpoch: count, composerInstanceId: isToken, draftRevision: count, draftDigest: isDigest })(value) ||
    shape({ kind: is('deferred'), documentEpoch: isToken })(value),
  mode: is('replace', 'append'),
  text: (value) => typeof value === 'string' && value.length > 0 && value.length <= MAX_STRING,
  confirmationId: orNull(isUuid),
  createdAt: count,
  expiresAt: count,
});

/** Both refinements of InsertWireSchema: expiry after creation; a deferred insert replaces and carries no consent. */
const isInsert: Check = (value) => {
  if (!insertKeys(value)) return false;
  const insert = value as InsertWire;
  return insert.expiresAt > insert.createdAt && (insert.expected.kind === 'open' || (insert.confirmationId === null && insert.mode === 'replace'));
};

/** The preview send as MAIN gets it (contracts MainSendRequestSchema): no hub binding, no ticket, no token. */
export interface SendRequest {
  readonly attemptId: string;
  readonly acc: string;
  readonly fan: string;
  readonly platformAccountId: string;
  readonly plainText: string;
  readonly isAiGenerated: boolean;
  readonly checkpoint: Checkpoint;
  /** The hub ticket's deadline on the local clock: later is `held`, never a late send (§6.7.11). */
  readonly expiresAt: number;
}

const sendKeys = shape({
  attemptId: isUuid,
  acc: isId,
  fan: isId,
  platformAccountId: isId,
  part: isPart,
  previewRevision: count,
  plainText: (value) => typeof value === 'string' && value.length > 0 && value.length <= SEND_MAX_CHARS,
  isAiGenerated: is(true, false),
  // contracts FreshnessCheckpointSchema; its refinements and the request's are below.
  checkpoint: shape({
    documentEpoch: isToken,
    socketEpoch: count,
    subscriptionEpoch: count,
    hostAccountId: isId,
    platformFanId: isId,
    fanSequence: count,
    lastFanMessageId: orNull(isId),
    knownFanMessageIds: (value) => Array.isArray(value) && value.length <= KNOWN_FAN_MESSAGES && value.every(isId) && new Set(value).size === value.length,
    observedAt: count,
    coverage: is('ok', 'unknown'),
  }),
  expiresAt: count,
});

/** The checkpoint is the target chat's and its newest known id is its last one. */
const isSend: Check = (value) => {
  if (!shape({ req: sendKeys })(value)) return false;
  const { acc, fan, checkpoint } = (value as { req: SendRequest }).req;
  return checkpoint.hostAccountId === acc && checkpoint.platformFanId === fan && (checkpoint.knownFanMessageIds[0] ?? null) === checkpoint.lastFanMessageId;
};

const accFan = { acc: isId, fan: isId };
const max = int(1, MAX_SNAPSHOT);
const empty = shape({});
const byExpected = shape({ expected: isIdentity });

/**
 * Payload check per request type (contracts TO_MAIN[t].payload); a type that
 * is not here is unknown to the runtime. `probe` is the boot's; the last four
 * (LIVE_REQUESTS) are answered by the tap script's live port, after the check.
 */
export const PAYLOAD: Record<string, Check> = {
  snapshot: empty,
  listAccounts: empty,
  readDraft: byExpected,
  focus: byExpected,
  readTail: shape({ expected: isIdentity, max }),
  chatWindow: shape({ ...accFan, max }),
  fan: shape(accFan),
  listChats: shape({ acc: isId, limit: int(1, 1000) }),
  insertGuarded: (value) => shape({ intent: isInsert })(value) && ((value as Plain)['intent'] as InsertWire).expected.kind === 'open',
  // thenInsert only with a chat target, to the same account and fan, deferred.
  navigate: (value) => {
    if (!shape({ intent: shape({ intentId: isUuid, acc: isId, fan: orNull(isId), 'thenInsert?': isInsert }) })(value)) return false;
    const { acc, fan, thenInsert: then } = (value as { intent: NavigationWire }).intent;
    return !then || (fan !== null && then.expected.kind === 'deferred' && then.target.hostAccountId === acc && then.target.platformFanId === fan);
  },
  cancelInsert: shape({ intentId: isUuid }),
  checkpoint: shape(accFan),
  previewSendPreflight: isSend,
  previewSendCommit: isSend,
  flags: shape({ wsTap: is(true, false), previewSend: is(true, false), 'attribution?': is(true, false) }),
};
