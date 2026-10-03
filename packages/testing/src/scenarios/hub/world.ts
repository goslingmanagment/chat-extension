// The fake hub's synthetic world: one chatter, two OnlyFans pilot pages bound
// to two OnlyMonster accounts, one Fansly page, a few fans and messages, one
// clock. Synthetic ids only (tools/archive-check rejects real ones); every
// scenario of this folder is built from these values.

import { HUB_FEATURE_MAP, hostBindingKey, type FeatureId, type HubAiFeature } from '@cg/contracts';

/** Deterministic RFC 4122-shaped ids. */
export const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

export const NOW = '2026-10-03T10:00:00.000Z';
export const NOW_MS = Date.parse(NOW);
/** An instant `seconds` from NOW (negative = earlier), ISO with Z. */
export const at = (seconds: number): string => new Date(NOW_MS + seconds * 1000).toISOString();

export const WORLD = {
  hubOrigin: 'https://hub.example.test',
  user: { userId: 7, username: 'chatter1', role: 'chatter' },
  otherUser: { userId: 8, username: 'chatter2' },
  /** This client install (H-7 `instanceId`). */
  instanceId: uuid(0x900),
  otherInstanceId: uuid(0x901),
  pages: {
    one: { pageId: 11, pageLabel: 'model-one', title: 'Model One', platformAccountId: '3003', hostAccountId: '1001', bindingRevision: 2 },
    vip: { pageId: 12, pageLabel: 'model-one-vip', title: 'Model One VIP', platformAccountId: '3004', hostAccountId: '1002', bindingRevision: 1 },
    fansly: { pageId: 13, pageLabel: 'model-two-fansly', title: 'Model Two', platformAccountId: '7007', bindingRevision: 1 },
  },
  fan: '2002',
  otherFan: '2003',
  newFan: '2010',
  messages: { fanFirst: '4004', modelReply: '4005', fanLatest: '4006', fanDeleted: '4007', sentByUs: '4100', sentPart2: '4101' },
  persona: { key: 'default', definitionId: 'pdef_0123456789abcdef', otherDefinitionId: 'pdef_fedcba9876543210' },
  configRevision: 4,
} as const;

export const PAGE = WORLD.pages.one.pageLabel;
export const BINDING_KEY_ONE = hostBindingKey('chatspace', WORLD.pages.one.hostAccountId);
export const BINDING_KEY_VIP = hostBindingKey('chatspace', WORLD.pages.vip.hostAccountId);

export function hubFeatureOf(feature: FeatureId): HubAiFeature {
  return HUB_FEATURE_MAP[feature].hub;
}
