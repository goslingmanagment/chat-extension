// Fixtures of the Fansly bridge and host (R20, 1.15.0): every MAIN request (payload and answer), every event inside a
// batch, every wire event, the generation snapshot and the start proof — valid and invalid. Synthetic snowflake ids:
// 18 digits as today, and 19 digits as from about January 2027, which sort after them. Fansly's MAIN runs its
// hand-written checks over these, as ChatSpace's does over BRIDGE_REQUEST_FIXTURES.

import { FANSLY_BRIDGE_LIMITS, type FanslyWireEventType, type FromMainFanslyType, type ToMainFanslyType } from '../../src/bridge-fansly';
import { FANSLY_LIMITS } from '../../src/fansly';
import { type BridgeRequestFixtures, type Verdicts } from './protocols';
import { DIGEST, FANSLY_IDS, ISO } from './samples';
import { probe } from './schemas';

/** Message ids of one chat, oldest first; `newer` has 19 digits and is the newest of all. */
export const FANSLY_MSG = {
  m1: '700000000000000101',
  m2: '700000000000000102',
  m3: '700000000000000103',
  deleted: '700000000000000104',
  newer: '1000000000000000105',
} as const;

const { creator, fan, group, otherGroup } = FANSLY_IDS;
const { m1, m2, m3, deleted, newer } = FANSLY_MSG;
const empty = { valid: [{}], invalid: [{ extra: 1 }] } as const;

/** A fan id made before April 2020: 17 digits, still a Fansly id (the pattern is NATIVE_ID_PATTERN, not «18 digits»). */
export const FANSLY_OLD_ACCOUNT_ID = '99999999999999999';

// ── Start proofs ───────────────────────────────────────────────────────────

/** The tab's proof: a short certificate from m1, four messages since, two of them personal, one automated. */
export const tabStartProof = { v: 1, source: 'tab-short-page', groupId: group, startWitnessId: m1, coveredCount: 4, personalCount: 2, automatedIds: [m2] } as const;
/** The pass's proof over a 41-message history: personal counted among the last 30 only. */
export const passStartProof = { v: 1, source: 'pass-empty-page', groupId: group, startWitnessId: m1, coveredCount: 41, personalCount: 10, automatedIds: [m2, newer] } as const;
/** An empty history: no witness, nothing covered. */
export const emptyStartProof = { v: 1, source: 'pass-empty-page', groupId: group, startWitnessId: null, coveredCount: 0, personalCount: 0, automatedIds: [] } as const;

/** `n` automated ids after the witness, ascending: 18-digit synthetic ids above m3. */
export const fanslyAutomatedIds = (n: number): string[] => Array.from({ length: n }, (_, i) => `7000000000001${String(i).padStart(5, '0')}`);

export const START_PROOF_FIXTURES: Verdicts = {
  valid: [
    tabStartProof,
    passStartProof,
    emptyStartProof,
    { ...emptyStartProof, source: 'tab-short-page' },
    // The ring's capacity, exactly.
    { ...tabStartProof, coveredCount: 130, personalCount: 10, automatedIds: fanslyAutomatedIds(FANSLY_LIMITS.automatedIdsMax) },
    // The first message may itself be the automated welcome.
    { ...tabStartProof, automatedIds: [m1, m2] },
    // 41 messages seen from the start by the tab: 1 personal, 40 automated, the newest one of 19 digits.
    { ...tabStartProof, coveredCount: 41, personalCount: 1, automatedIds: [...fanslyAutomatedIds(39), newer] },
  ],
  invalid: [
    // Over the ring: 121 automated ids, though 200 messages were covered.
    { ...tabStartProof, coveredCount: 200, personalCount: 0, automatedIds: fanslyAutomatedIds(FANSLY_LIMITS.automatedIdsMax + 1) },
    // A witness without a history, a history without a witness.
    { ...tabStartProof, startWitnessId: null },
    { ...emptyStartProof, startWitnessId: m1 },
    // An automated message older than the first one.
    { ...tabStartProof, startWitnessId: m2, automatedIds: [m1] },
    // Counts beyond the history.
    { ...tabStartProof, personalCount: 5 },
    { ...tabStartProof, personalCount: 3, automatedIds: [m2, m3] },
    // The pass counts among its last 30 only.
    { ...passStartProof, personalCount: 31 },
    // Ids out of order or repeated.
    { ...tabStartProof, automatedIds: [m3, m2] },
    { ...tabStartProof, automatedIds: [m2, m2] },
    // Ids are strings, never numbers.
    { ...tabStartProof, groupId: Number(group) },
    { ...tabStartProof, automatedIds: [Number(m2)] },
    { ...tabStartProof, v: 2 },
    { ...tabStartProof, source: 'hub-history' },
    // Never a text.
    { ...tabStartProof, firstText: 'hi' },
  ],
};

// ── Snapshots ──────────────────────────────────────────────────────────────

const window = [
  { id: m1, dir: 'fan' },
  { id: m2, dir: 'model' },
  { id: m3, dir: 'fan' },
  { id: newer, dir: 'model' },
] as const;
const identity = { creatorId: creator, groupId: group, fanId: fan } as const;
const epochs = { document: 'doc1', socket: 2, route: 5 } as const;
const tail = [
  { platformMessageId: m1, direction: 'fan', sentAt: ISO, text: 'hey there' },
  { platformMessageId: m3, direction: 'fan', sentAt: ISO, text: 'Привет' },
  { platformMessageId: newer, direction: 'model', sentAt: ISO, text: 'hi!' },
] as const;

/** Reply: the window, the fan's known messages, one deletion the tab saw, and the texts. */
export const fanslyReplySnapshot = {
  feature: 'reply',
  identity,
  epochs,
  completeness: 'complete',
  window,
  knownFanMessageIds: [m1, m3],
  deletedIds: [deleted],
  tail,
  truncated: false,
} as const;
/** Hi: the start proof and the fan's avatar; an empty tail is lawful (a chat without a text). */
export const fanslyHiSnapshot = {
  ...fanslyReplySnapshot,
  feature: 'hi',
  startProof: tabStartProof,
  fanAvatarUrl: 'https://cdn3.fansly.com/700000000000000002/avatar.jpeg',
  tail: [],
} as const;
/** Recap: metadata only; the observation unknown, and why. */
export const fanslyRecapSnapshot = {
  feature: 'recap',
  identity,
  epochs,
  completeness: 'unknown',
  gap: 'pending-parse',
  window,
  knownFanMessageIds: [m1, m3],
  deletedIds: [],
  truncated: false,
} as const;

/** A copy without the keys: fixtures stay plain JSON, never a key set to `undefined`. */
const without = (value: object, ...keys: readonly string[]): Record<string, unknown> => {
  const copy: Record<string, unknown> = { ...value };
  for (const key of keys) delete copy[key];
  return copy;
};

export const FANSLY_SNAPSHOT_FIXTURES: Verdicts = {
  valid: [
    fanslyReplySnapshot,
    fanslyHiSnapshot,
    fanslyRecapSnapshot,
    ...['review', 'coach', 'recap', 'recap-short', 'voice-script', 'notes-fill'].map((feature) => ({ ...fanslyReplySnapshot, feature })),
    // A draft function with no texts held: no tail at all.
    without(fanslyReplySnapshot, 'tail'),
    // Old texts dropped to stay within the frame.
    { ...fanslyReplySnapshot, tail: tail.slice(1), truncated: true },
    // An empty window is a lawful snapshot (whether it is fresh is the verdict's call).
    { ...without(fanslyRecapSnapshot, 'gap'), completeness: 'complete', window: [], knownFanMessageIds: [] },
    // A fan made before April 2020 has a 17-digit id.
    { ...fanslyRecapSnapshot, identity: { ...identity, fanId: FANSLY_OLD_ACCOUNT_ID } },
  ],
  invalid: [
    // The start proof and the avatar only for Hi.
    { ...fanslyReplySnapshot, startProof: tabStartProof },
    { ...fanslyReplySnapshot, fanAvatarUrl: fanslyHiSnapshot.fanAvatarUrl },
    { ...fanslyHiSnapshot, startProof: { ...tabStartProof, groupId: otherGroup } },
    { ...fanslyHiSnapshot, fanAvatarUrl: 'https://evil.example/avatar.jpeg' },
    // Every id of the check from the window, in snowflake order.
    { ...fanslyReplySnapshot, knownFanMessageIds: [m1, m2] },
    { ...fanslyReplySnapshot, knownFanMessageIds: [deleted] },
    { ...fanslyReplySnapshot, window: [window[3], window[0], window[1], window[2]], tail: [] },
    { ...fanslyReplySnapshot, window: [window[0], window[0]], knownFanMessageIds: [m1], tail: [] },
    { ...fanslyReplySnapshot, deletedIds: [m3] },
    { ...fanslyReplySnapshot, tail: [{ ...tail[0], platformMessageId: deleted }] },
    { ...fanslyReplySnapshot, tail: [{ ...tail[0], direction: 'model' }] },
    { ...fanslyReplySnapshot, tail: [tail[1], tail[0]] },
    { ...fanslyReplySnapshot, tail: [{ ...tail[0], text: '' }] },
    // A gap exactly when unknown, and never «certificate»; only a tail is truncated.
    { ...fanslyReplySnapshot, gap: 'socket' },
    without(fanslyRecapSnapshot, 'gap'),
    { ...fanslyRecapSnapshot, gap: 'certificate' },
    { ...fanslyRecapSnapshot, truncated: true },
    // The creator is never the fan; ids are strings.
    { ...fanslyReplySnapshot, identity: { ...identity, fanId: creator } },
    { ...fanslyReplySnapshot, identity: { ...identity, groupId: Number(group) } },
    // Bounds: the check window, the fan's known messages.
    { ...fanslyRecapSnapshot, window: Array.from({ length: FANSLY_LIMITS.checkWindowMax + 1 }, (_, i) => ({ id: `7000000000002${String(i).padStart(5, '0')}`, dir: 'model' })), knownFanMessageIds: [] },
    {
      ...fanslyRecapSnapshot,
      window: Array.from({ length: 11 }, (_, i) => ({ id: `7000000000003${String(i).padStart(5, '0')}`, dir: 'fan' })),
      knownFanMessageIds: Array.from({ length: 11 }, (_, i) => `7000000000003${String(i).padStart(5, '0')}`),
    },
  ],
};

/**
 * A snapshot answer the schema takes but the frame limit does not: 60 messages of 2500 characters — within the
 * bridge's 256 KiB, over the snapshot's 128 KiB.
 */
export function oversizeFanslySnapshot(): unknown {
  const ids = Array.from({ length: FANSLY_LIMITS.checkWindowMax }, (_, i) => `7000000000004${String(i).padStart(5, '0')}`);
  return {
    ...fanslyReplySnapshot,
    window: ids.map((id) => ({ id, dir: 'fan' })),
    knownFanMessageIds: ids.slice(-FANSLY_LIMITS.knownFanMessagesMax),
    deletedIds: [],
    tail: ids.map((id) => ({ platformMessageId: id, direction: 'fan', sentAt: ISO, text: 'x'.repeat(2500) })),
  };
}

// ── Bridge payloads ────────────────────────────────────────────────────────

const neighbour = { windowBridge: true, networkHook: true, styleFixes: false, wordFilter: false } as const;
export const fanslyIdentityWire = { creatorId: creator, accountMeSeen: true, legacy: false, fbuddy: neighbour } as const;
const chatWindow = { loaded: 4, newestId: newer, newestAt: ISO, completeness: 'complete', startProven: true, fanScript: 'cyrillic' } as const;
export const fanslyChatWire = { groupId: group, fanId: fan, kind: 'direct', dmAllowed: true, routeEpoch: 5, window: chatWindow } as const;
export const fanslyContractWire = { anchors: { accountMe: 'ok', socket: 'ok', frames: 'ok', xhr: 'ok' }, tap: 'ok' } as const;
export const fanslyState = { identity: fanslyIdentityWire, socket: { epoch: 2, confirmed: true }, chat: fanslyChatWire, contract: fanslyContractWire, lastBatch: 17 } as const;
const incoming = { groupId: group, fanId: fan, msgId: newer, fromFan: true, automated: false, tip: false, createdAt: ISO } as const;
/** No time measured yet: 14 buckets for the 13 bounds of `frameParseMs` and `xhrParseMs`. */
const noTimes = { counts: Array.from({ length: 14 }, () => 0), count: 0, sum: 0, max: 0 } as const;
/** No snapshot taken yet: 15 buckets for the 14 bounds of `snapshotMs`. */
const noSnapshots = { counts: Array.from({ length: 15 }, () => 0), count: 0, sum: 0, max: 0 } as const;
/** After a while on a page: 120 frames, two of them too large to read, a deferred inbox answer, three batches in flight. */
export const fanslyHealth = {
  frames: { seen: 120, parsed: 118, lost: 2 },
  responses: { seen: 14, parsed: 9, deferred: 1, lost: 0 },
  stream: { batches: 31, unacked: 3, queued: 0, heldBytes: 2210, gaps: 0 },
  perf: {
    frameParseMs: { counts: [80, 30, 6, 2, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0], count: 120, sum: 3.6, max: 6.2 },
    xhrParseMs: { counts: [0, 0, 1, 3, 3, 1, 1, 0, 0, 0, 0, 0, 0, 0], count: 9, sum: 1.9, max: 0.8 },
    snapshotMs: { counts: [1, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], count: 4, sum: 0.7, max: 0.4 },
  },
  // Five gestures: one swallowed by the neighbour's word filter, one with media, three sent — the echo first once.
  sends: { gestures: 5, receipts: 4, ambiguous: 0, media: 1, sent: 3, echoFirst: 1, receiptFirst: 2 },
} as const;
/** No gesture yet. */
const noSends = { gestures: 0, receipts: 0, ambiguous: 0, media: 0, sent: 0, echoFirst: 0, receiptFirst: 0 } as const;

export const FANSLY_BRIDGE_REQUEST_FIXTURES: { readonly [T in ToMainFanslyType]: BridgeRequestFixtures } = {
  probe: { payload: empty, data: { valid: [probe], invalid: [{ ...probe, v: 2 }] } },
  'fx.state': {
    payload: empty,
    data: {
      valid: [
        fanslyState,
        // Before `/account/me` and before the socket: nothing known, nothing focused, nothing sent yet.
        {
          identity: { ...fanslyIdentityWire, creatorId: null, accountMeSeen: false },
          socket: { epoch: 0, confirmed: false },
          chat: null,
          contract: { anchors: { accountMe: 'notYet', socket: 'notYet', frames: 'notYet', xhr: 'ok' }, tap: 'ok' },
          lastBatch: 0,
        },
      ],
      invalid: [
        { ...fanslyState, socket: { epoch: 0, confirmed: true } },
        { ...fanslyState, identity: { ...fanslyIdentityWire, accountMeSeen: false } },
        { ...fanslyState, lastBatch: -1 },
      ],
    },
  },
  'fx.focus': {
    payload: { valid: [{ groupId: group, routeEpoch: 5 }, { groupId: null, routeEpoch: 6 }], invalid: [{ groupId: group }, { groupId: Number(group), routeEpoch: 5 }, { groupId: '0', routeEpoch: 5 }] },
    data: { valid: [null], invalid: [{}, true] },
  },
  'fx.generationSnapshot': {
    payload: {
      valid: [
        { groupId: group, feature: 'reply', window: 60, withText: true },
        { groupId: group, feature: 'hi', window: 25, withText: true },
        { groupId: group, feature: 'recap', window: 3000, withText: false },
        ...['review', 'coach', 'recap', 'recap-short', 'voice-script', 'notes-fill'].map((feature) => ({ groupId: group, feature, window: 60, withText: true })),
      ],
      // A window of at least one message, a known operation.
      invalid: [
        { groupId: group, feature: 'reply', window: 0, withText: true },
        { groupId: group, feature: 'voice', window: 60, withText: false },
      ],
    },
    data: { valid: [fanslyReplySnapshot, fanslyHiSnapshot, fanslyRecapSnapshot, { ...fanslyRecapSnapshot, tail: [] }, null], invalid: [{ completeness: 'unknown', gap: 'not-certified' }] },
  },
  'fx.groupForFan': { payload: { valid: [{ creatorId: FANSLY_IDS.creator, fanId: FANSLY_IDS.fan }], invalid: [{ creatorId: FANSLY_IDS.creator, fanId: 123 }, { fanId: FANSLY_IDS.fan }] }, data: { valid: [{ groupId: group }, { groupId: null }], invalid: [{ groupId: 123 }, {}] } },
  'fx.windowMeta': {
    payload: { valid: [{ groupId: group }], invalid: [{ groupId: Number(group) }, {}] },
    data: {
      valid: [fanslyChatWire, null],
      invalid: [{ ...fanslyChatWire, kind: 'group' }, { ...fanslyChatWire, window: { ...chatWindow, loaded: FANSLY_LIMITS.ringRecords + 1 } }],
    },
  },
  'fx.ack': {
    payload: { valid: [{ n: 1 }, { n: 9 }], invalid: [{ n: 0 }, { n: '1' }, { n: 1, bytes: 300 }] },
    data: { valid: [null], invalid: [{ freed: 1 }] },
  },
  'fx.health': {
    payload: empty,
    data: {
      valid: [
        fanslyHealth,
        // At document_start: nothing seen, nothing sent.
        {
          frames: { seen: 0, parsed: 0, lost: 0 },
          responses: { seen: 0, parsed: 0, deferred: 0, lost: 0 },
          stream: { batches: 0, unacked: 0, queued: 0, heldBytes: 0, gaps: 0 },
          perf: { frameParseMs: noTimes, xhrParseMs: noTimes, snapshotMs: noSnapshots },
          sends: noSends,
        },
      ],
      invalid: [
        // More unacknowledged batches than the credits allow.
        { ...fanslyHealth, stream: { ...fanslyHealth.stream, unacked: FANSLY_BRIDGE_LIMITS.maxUnackedBatches + 1 } },
        // A total that is not the sum of its buckets.
        { ...fanslyHealth, perf: { ...fanslyHealth.perf, xhrParseMs: { ...fanslyHealth.perf.xhrParseMs, count: 10 } } },
        // MAIN's own three times, no other: the round trip of a snapshot is the isolated side's (snapshotRoundTripMs).
        { ...fanslyHealth, perf: { ...fanslyHealth.perf, snapshotRoundTripMs: noTimes } },
        { ...fanslyHealth, perf: { frameParseMs: noTimes, xhrParseMs: noTimes } },
        { ...fanslyHealth, frames: { seen: 3, parsed: -1, lost: 0 } },
        // P7f: the sends are counted always; every send said had its echo before or after its receipt.
        (({ sends: _sends, ...rest }) => rest)(fanslyHealth),
        { ...fanslyHealth, sends: { ...fanslyHealth.sends, sent: 4 } },
        { ...fanslyHealth, sends: { ...fanslyHealth.sends, ambiguous: -1 } },
        { ...fanslyHealth, sends: { ...fanslyHealth.sends, unmarked: 1 } },
      ],
    },
  },
};

export const FANSLY_BRIDGE_EVENT_FIXTURES: { readonly [T in FromMainFanslyType]: Verdicts } = {
  'fx.identity': {
    valid: [fanslyIdentityWire, { ...fanslyIdentityWire, creatorId: null, accountMeSeen: false, legacy: true }],
    invalid: [{ ...fanslyIdentityWire, accountMeSeen: false }, { ...fanslyIdentityWire, fbuddy: { ...neighbour, panel: true } }, { ...fanslyIdentityWire, creatorId: Number(creator) }],
  },
  'fx.chat': {
    valid: [
      fanslyChatWire,
      // A group chat: no fan of its own, no AI.
      { ...fanslyChatWire, fanId: null, kind: 'group', dmAllowed: null, window: { ...chatWindow, startProven: false, fanScript: 'unknown' } },
      // Members not known yet.
      { ...fanslyChatWire, fanId: null, kind: null, window: { ...chatWindow, loaded: 0, newestId: null, newestAt: null, completeness: 'unknown' } },
    ],
    invalid: [{ ...fanslyChatWire, fanId: null }, { ...fanslyChatWire, kind: 'group' }, { ...fanslyChatWire, window: { ...chatWindow, fanScript: 'latin' } }],
  },
  'fx.contract': {
    valid: [fanslyContractWire, { anchors: { accountMe: 'ok', socket: 'ok', frames: 'shape', xhr: 'ok' }, tap: 'wrapped' }],
    // Every network anchor named, none of the DOM's (they are the isolated side's).
    invalid: [{ ...fanslyContractWire, anchors: { accountMe: 'ok', socket: 'ok', frames: 'ok' } }, { ...fanslyContractWire, anchors: { ...fanslyContractWire.anchors, textarea: 'ok' } }, { ...fanslyContractWire, tap: 'broken' }],
  },
  'fx.incoming': {
    valid: [incoming, { ...incoming, fanId: null, fromFan: false, automated: true, createdAt: null }],
    invalid: [{ ...incoming, text: 'hi' }, { ...incoming, msgId: Number(newer) }, { ...incoming, createdAt: 1_790_000_000 }],
  },
  'fx.follow': {
    valid: [{ eventId: '700000000000000201', accountId: creator, followerId: fan }, { eventId: '1000000000000000202', accountId: creator, followerId: FANSLY_OLD_ACCOUNT_ID }],
    invalid: [{ eventId: '700000000000000201', accountId: creator, followerId: creator }, { eventId: Number('700000000000000201'), accountId: creator, followerId: fan }],
  },
  'fx.sent': {
    valid: [{ groupId: group, msgId: newer, contentDigest: DIGEST, gestureAt: 15123.456 }],
    invalid: [
      { groupId: group, msgId: newer, contentDigest: DIGEST, gestureAt: 15123.456, content: 'hey' },
      { groupId: group, msgId: newer, contentDigest: 'XYZ', gestureAt: 15123.456 },
      // P7f: a send names its gesture — without it the isolated side could link it only by its text.
      { groupId: group, msgId: newer, contentDigest: DIGEST },
      { groupId: group, msgId: newer, contentDigest: DIGEST, gestureAt: -1 },
      { groupId: group, msgId: newer, contentDigest: DIGEST, gestureAt: '15123.456' },
    ],
  },
  'fx.pageSent': {
    valid: [
      { groupId: group, msgId: newer, fanId: '700000000000000002', accountId: '700000000000000001', media: false },
      { groupId: group, msgId: newer, fanId: '700000000000000002', accountId: '700000000000000001', media: true },
    ],
    invalid: [
      // Never a text, and the creator at the answer always.
      { groupId: group, msgId: newer, fanId: '700000000000000002', accountId: '700000000000000001', media: false, content: 'hey' },
      { groupId: group, msgId: newer, fanId: '700000000000000002', media: false },
      { groupId: group, msgId: newer, fanId: null, accountId: '700000000000000001', media: false },
    ],
  },
  'fx.lastWord': {
    valid: [{ groupId: group, word: 'fan' }, { groupId: otherGroup, word: 'model' }, { groupId: group, word: null }],
    invalid: [
      // Whose word only: never a text, never a third side.
      { groupId: group, word: 'fan', content: 'hey' },
      { groupId: group, word: 'creator' },
      { groupId: group },
      { groupId: Number(group), word: 'fan' },
    ],
  },
  'fx.coverage': {
    valid: [
      { groupIds: 'all', state: 'unknown', reason: 'socket' },
      { groupIds: [group, otherGroup], state: 'unknown', reason: 'unseen' },
      { groupIds: [group], state: 'complete', reason: 'certificate' },
    ],
    invalid: [
      { groupIds: 'all', state: 'complete', reason: 'certificate' },
      { groupIds: [group], state: 'unknown', reason: 'certificate' },
      { groupIds: [group], state: 'complete', reason: 'socket' },
      { groupIds: [], state: 'unknown', reason: 'socket' },
      { groupIds: [group], state: 'unknown', reason: 'typing' },
      { groupIds: Array.from({ length: FANSLY_LIMITS.maxChats + 1 }, (_, i) => `7000000000005${String(i).padStart(5, '0')}`), state: 'unknown', reason: 'gap' },
    ],
  },
  'fx.deleted': {
    valid: [{ groupId: group, ids: [deleted] }, { groupId: group, ids: [m2, deleted, newer] }],
    invalid: [{ groupId: group, ids: [] }, { groupId: group, ids: Array.from({ length: FANSLY_LIMITS.ringRecords + 1 }, (_, i) => `7000000000006${String(i).padStart(5, '0')}`) }],
  },
  'fx.vaultAdded': {
    valid: [{ seq: 7 }],
    // The page does not read that answer: no album, no media ids (P3a).
    invalid: [{ seq: 7, albumId: '700000000000000301' }, { seq: -1 }],
  },
  'fx.vaultLoaded': {
    // An album by its id; a type album of the vault («Posts», «Messages») has none.
    valid: [
      { albumId: '700000000000000301', seq: 8 },
      { albumId: null, seq: 9 },
    ],
    // The album id is a snowflake string; the answer's media are not read.
    invalid: [{ albumId: Number('700000000000000301'), seq: 8 }, { albumId: '700000000000000301' }, { albumId: '700000000000000301', seq: 8, mediaIds: ['700000000000000302'] }, { albumId: 'album', seq: 8 }],
  },
};

const batchOf = (n: number, events: readonly unknown[]): unknown => ({ n, events });
const incomingEvent = { t: 'fx.incoming', p: incoming } as const;
/** A batch at its event limit, every event the smallest kind. */
export const fullFanslyBatch = (): unknown => batchOf(3, Array.from({ length: FANSLY_BRIDGE_LIMITS.maxBatchEvents }, (_, i) => ({ t: 'fx.vaultAdded', p: { seq: i } })));

export const FANSLY_WIRE_EVENT_FIXTURES: { readonly [T in FanslyWireEventType]: Verdicts } = {
  'fx.batch': {
    valid: [
      batchOf(1, [{ t: 'fx.identity', p: fanslyIdentityWire }, { t: 'fx.chat', p: fanslyChatWire }, incomingEvent, { t: 'fx.sent', p: { groupId: group, msgId: newer, contentDigest: DIGEST, gestureAt: 15123.456 } }]),
      batchOf(2, [incomingEvent, incomingEvent]),
      fullFanslyBatch(),
    ],
    invalid: [
      batchOf(0, [incomingEvent]),
      batchOf(1, []),
      // Over the event limit.
      batchOf(4, Array.from({ length: FANSLY_BRIDGE_LIMITS.maxBatchEvents + 1 }, (_, i) => ({ t: 'fx.vaultAdded', p: { seq: i } }))),
      // A state goes once per batch: the latest one won before it left.
      batchOf(1, [{ t: 'fx.chat', p: fanslyChatWire }, { t: 'fx.chat', p: { ...fanslyChatWire, routeEpoch: 6 } }]),
      // One bad event and the batch is lost whole.
      batchOf(1, [incomingEvent, { t: 'fx.incoming', p: { ...incoming, text: 'hi' } }]),
      // Typing never crosses; the payload key is `p`.
      batchOf(1, [{ t: 'fx.typing', p: { groupId: group } }]),
      batchOf(1, [{ t: 'fx.incoming', payload: incoming }]),
    ],
  },
  'fx.gap': { valid: [{ reason: 'overflow' }, { reason: 'memory' }], invalid: [{ reason: 'typing' }, {}, { reason: 'overflow', lost: 12 }] },
  fault: {
    valid: [{ source: 'frame', count: 1 }, { source: 'xhrLoadend', count: 8 }],
    invalid: [{ source: 'xhr loadend', count: 1 }, { source: 'frame', count: 0 }, { source: 'frame', count: 2, stack: 'at x' }],
  },
};

/**
 * A batch the schema takes but the frame limit does not: 400 coverage events of 20 groups each — within the bridge's
 * 256 KiB and the event limit, over the batch's 64 KiB.
 */
export function oversizeFanslyBatch(): unknown {
  const groups = Array.from({ length: 20 }, (_, i) => `7000000000007${String(i).padStart(5, '0')}`);
  return batchOf(5, Array.from({ length: 400 }, () => ({ t: 'fx.coverage', p: { groupIds: groups, state: 'unknown', reason: 'evicted' } })));
}
