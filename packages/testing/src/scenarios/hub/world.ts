// The fake hub's synthetic world: one chatter, two OnlyFans pilot pages bound
// to two OnlyMonster accounts, one Fansly page, a few fans and messages, one
// clock. Synthetic ids only (tools/archive-check rejects real ones); every
// scenario of this folder is built from these values.
//
// R20 P6c1: the Fansly page is the Fansly stand's creator, and its chats are
// the stand's (fixture-fansly/src/data.ts; fansly.test.ts holds them equal),
// so a stand tab and the hub name the same chats. Fansly ids are snowflakes
// kept as strings: 18 digits today and above 2^53 (`Number()` merges
// neighbours), 17 or fewer for an account made before April 2020; and a chat
// is a group with an id of its own, never its fan's (FS-ACC-1).

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
    fansly: { pageId: 13, pageLabel: 'model-two-fansly', title: 'Model Two', platformAccountId: '700000000000000017', bindingRevision: 1 },
  },
  /** R20 P6c1: the Fansly page's chats as the hub's capture knows them (`page_dm_threads`: a group and its fan). */
  fansly: {
    /** The stand's first two chats (its groups 1 and 2 and their fans). */
    chats: {
      a: { group: '810000000000000001', fan: '920000000000000003' },
      b: { group: '810000000000000014', fan: '920000000000000032' },
    },
    /** A fan of an old account (17 digits, made before April 2020) in a chat of today (18 digits); not a chat of the stand. */
    old: { group: '811000000000000031', fan: '92000000000000031' },
    /** An old account's creator: 17 digits (a test links the Fansly page to it with `pageAccount`). */
    oldCreator: '70000000000000023',
    /** One double apart from `chats.a.fan`: another fan, whom `Number()` cannot tell from that one (HF-8а). */
    twinFan: '920000000000000004',
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
