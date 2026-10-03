// The host fake's synthetic world: one OnlyMonster account bound to one
// OnlyFans creator, the open chat and a preview target that is NOT open
// (X8), their drafts, windows and checkpoint. Synthetic ids only
// (tools/archive-check rejects real ones); every host scenario starts here.

import {
  ANCHOR_IDS,
  HOST_CAPABILITIES,
  type CapabilityState,
  type ChatRef,
  type DraftSnapshot,
  type FreshnessCheckpoint,
  type HostAccount,
  type HostContractReport,
  type HostIdentity,
  type HostSnapshot,
  type HumanCause,
  type MountPoints,
} from '@cg/contracts';

import { type HostMemory } from './fake-host-port';

/** Deterministic RFC 4122-shaped ids. */
export const hostUuid = (n: number): string => `00000000-0000-4000-9000-${n.toString(16).padStart(12, '0')}`;

export const HOST_T0 = Date.parse('2026-10-03T10:00:00.000Z');
export const hostIso = (seconds: number): string => new Date(HOST_T0 + seconds * 1000).toISOString();

export const HOST_IDS = {
  acc: '1001',
  creator: '3003',
  /** The open chat. */
  fan: '2002',
  /** A preview target nobody opened (Spenders, «Новые»). */
  previewFan: '2003',
  messages: { fanBefore: '4004', fanEarlier: '4003', fanAfter: '4010', sent: '4100', humanSent: '4101' },
} as const;

export const DOCUMENT = 'doc-host-1';
export const ACTION_TOKEN = 'tok_hostfake_0123456789';
export const hostCause: HumanCause = { kind: 'click', actionToken: ACTION_TOKEN };

export const openChat: ChatRef = { host: 'chatspace', hostAccountId: HOST_IDS.acc, platformFanId: HOST_IDS.fan };
export const previewChat: ChatRef = { host: 'chatspace', hostAccountId: HOST_IDS.acc, platformFanId: HOST_IDS.previewFan };

export const hostAccount: HostAccount = {
  host: 'chatspace',
  hostAccountId: HOST_IDS.acc,
  platform: 'onlyfans',
  platformAccountId: HOST_IDS.creator,
  username: 'model_one',
  displayName: 'Model One',
};

/** Every anchor found, every capability on; `patch` turns some off. */
export function contractReport(patch: Partial<Record<(typeof HOST_CAPABILITIES)[number], CapabilityState>> = {}): HostContractReport {
  return {
    build: 'index-0000fake',
    adapterVersion: '1.0.0',
    checkedAt: HOST_T0,
    anchors: Object.fromEntries(ANCHOR_IDS.map((anchor) => [anchor, 'ok'])) as HostContractReport['anchors'],
    capabilities: { ...(Object.fromEntries(HOST_CAPABILITIES.map((c) => [c, { state: 'on' }])) as HostContractReport['capabilities']), ...patch },
  };
}

export const mounts: MountPoints = {
  dock: { kind: 'in-flow', composerInstanceId: 'composer-1', width: 720 },
  overlay: { ready: true, container: null },
};

export const identity: HostIdentity = {
  host: 'chatspace',
  documentEpoch: DOCUMENT,
  hostLoginEpoch: 'login-1',
  hostAccountId: HOST_IDS.acc,
  platformAccountId: HOST_IDS.creator,
  chat: openChat,
  routeEpoch: 5,
  composerInstanceId: 'composer-1',
};

export const startSnapshot: HostSnapshot = {
  kind: 'chatspace',
  identity,
  route: { epoch: 5, name: 'chat', account: hostAccount, chat: openChat },
  composer: { chat: openChat, instanceId: 'composer-1', ready: true, hidden: false, draft: { revision: 4, provenance: 'empty' } },
  accounts: [hostAccount],
  contract: contractReport(),
  mounts,
  theme: { scheme: 'light', tokens: { '--color-om-surface': '#ffffff' }, fixedWidth: false },
};

export const emptyDraft: DraftSnapshot = { identity, revision: 4, plainText: '', provenance: 'empty', digest: 'feedbeef00000004' };
export const humanDraft: DraftSnapshot = { identity, revision: 9, plainText: 'my own words', provenance: 'human-or-unknown', digest: 'feedbeef00000009' };

export const memory: HostMemory = {
  drafts: [emptyDraft],
  tails: [
    {
      chat: openChat,
      tail: { capturedAt: hostIso(0), messages: [{ platformMessageId: HOST_IDS.messages.fanBefore, direction: 'fan', sentAt: hostIso(-60), text: 'hey' }] },
    },
  ],
  chatWindows: [
    {
      chat: openChat,
      state: 'ready',
      loaded: 40,
      fanMessages: 22,
      modelMessages: 18,
      lastFanMessageId: HOST_IDS.messages.fanBefore,
      lastFanMessageAt: hostIso(-60),
      lastModelMessageAt: hostIso(-600),
      hasOlder: true,
    },
  ],
  fans: [
    {
      chat: openChat,
      username: 'fan_two',
      displayName: 'Fan Two',
      isBlocked: false,
      canReceiveMessages: true,
      isRestricted: null,
      isOnline: true,
      lastSeenAt: hostIso(-30),
      buyingPowerLabel: null,
      insights: null,
      bio: null,
      lists: null,
    },
  ],
  chatList: [
    { chat: openChat, position: 0, displayName: 'Fan Two', username: 'fan_two', unreadCount: 0, isOnline: true },
    { chat: previewChat, position: 1, displayName: 'Fan Three', username: 'fan_three', unreadCount: 2, isOnline: null },
  ],
};

/** The preview target's checkpoint at Generate: two fan messages seen before it, coverage ok. */
export const previewCheckpoint: FreshnessCheckpoint = {
  documentEpoch: DOCUMENT,
  socketEpoch: 1,
  subscriptionEpoch: 1,
  hostAccountId: HOST_IDS.acc,
  platformFanId: HOST_IDS.previewFan,
  fanSequence: 2,
  lastFanMessageId: HOST_IDS.messages.fanBefore,
  knownFanMessageIds: [HOST_IDS.messages.fanBefore, HOST_IDS.messages.fanEarlier],
  observedAt: HOST_T0,
  coverage: 'ok',
};
