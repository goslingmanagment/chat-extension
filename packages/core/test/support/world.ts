// Shared synthetic world of the R10 tests. It mirrors the fake hub's world
// (@cg/testing/hub WORLD) so ids, pages, persona and bootstrap agree with the
// hub scenarios; domain-ops.test.ts checks the mirror against the original.
// Support modules import only @cg/contracts: dependency-cruiser lets test
// files (*.test.ts), not helpers, reach the test harness. Synthetic ids only.

import {
  CLIENT_FEATURE_FLAG_NAMES,
  type Bootstrap,
  type ChatRef,
  type FreshnessCheckpoint,
  type HubBinding,
  type HumanCause,
  type SessionIdentity,
  type StartOp,
  type Target,
} from '@cg/contracts';

/** Deterministic RFC 4122-shaped ids (the fake hub's `uuid`). */
export const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

export const NOW_MS = Date.parse('2026-10-03T10:00:00.000Z');

/** The part of the fake hub's WORLD these tests use. */
export const WORLD = {
  hubOrigin: 'https://hub.example.test',
  user: { userId: 7, username: 'chatter1' },
  instanceId: uuid(0x900),
  pages: {
    one: { pageId: 11, pageLabel: 'model-one', platformAccountId: '3003', hostAccountId: '1001', bindingRevision: 2 },
  },
  fan: '2002',
  otherFan: '2003',
  newFan: '2010',
  messages: { fanFirst: '4004', modelReply: '4005', fanLatest: '4006', fanDeleted: '4007', sentByUs: '4100', sentPart2: '4101' },
  persona: { key: 'default', definitionId: 'pdef_0123456789abcdef', otherDefinitionId: 'pdef_fedcba9876543210' },
  configRevision: 4,
} as const;

export const session: SessionIdentity = { hubOrigin: WORLD.hubOrigin, userId: WORLD.user.userId, login: WORLD.user.username, role: 'chatter', epoch: 3 };

export const binding: HubBinding = {
  hubOrigin: WORLD.hubOrigin,
  principalId: WORLD.user.userId,
  loginEpoch: session.epoch,
  host: 'chatspace',
  hostAccountId: WORLD.pages.one.hostAccountId,
  platform: 'onlyfans',
  platformAccountId: WORLD.pages.one.platformAccountId,
  pageId: WORLD.pages.one.pageId,
  pageLabel: WORLD.pages.one.pageLabel,
  bindingRevision: WORLD.pages.one.bindingRevision,
};

export const chatOf = (fan: string): ChatRef => ({ host: 'chatspace', hostAccountId: WORLD.pages.one.hostAccountId, platformFanId: fan });
export const targetOf = (fan: string): Target => ({ binding, chat: chatOf(fan), fanRef: fan, conversationRef: fan });

export const target = targetOf(WORLD.fan);
export const otherTarget = targetOf(WORLD.otherFan);
export const persona = { key: WORLD.persona.key, definitionId: WORLD.persona.definitionId };

/** A bootstrap with X8 on: every flag and page feature, and one verified receipt profile. */
export function withX8(base: Bootstrap): Bootstrap {
  return {
    ...base,
    flags: Object.fromEntries(CLIENT_FEATURE_FLAG_NAMES.map((flag) => [flag, true])),
    pages: base.pages.map((page) =>
      page.platform === 'onlyfans' ? { ...page, features: Object.fromEntries(CLIENT_FEATURE_FLAG_NAMES.map((flag) => [flag, { available: true }])) } : page,
    ),
    limits: { ...base.limits, previewSendReceiptProfiles: [{ id: 'chatspace-0.172', adapterVersion: '1.0.0', modules: { notificationEntry: 'sha256-0001' } }] },
  };
}

export const tokenN = (n: number): string => `tok_${n.toString().padStart(16, '0')}`;
export const causeOf = (token: string): HumanCause => ({ kind: 'click', actionToken: token });

export function checkpointFor(fan: string, over: Partial<FreshnessCheckpoint> = {}): FreshnessCheckpoint {
  return {
    documentEpoch: 'doc-1',
    socketEpoch: 1,
    subscriptionEpoch: 1,
    hostAccountId: WORLD.pages.one.hostAccountId,
    platformFanId: fan,
    fanSequence: 2,
    lastFanMessageId: WORLD.messages.fanLatest,
    knownFanMessageIds: [WORLD.messages.fanLatest, WORLD.messages.fanFirst],
    observedAt: NOW_MS,
    coverage: 'ok',
    ...over,
  };
}

export function startOf(over: Partial<StartOp> & { token?: string } = {}): StartOp {
  const { token, ...rest } = over;
  return {
    feature: 'reply',
    surface: 'dock',
    target,
    cause: causeOf(token ?? tokenN(1)),
    tone: null,
    split: false,
    window: 100,
    ...rest,
  };
}
