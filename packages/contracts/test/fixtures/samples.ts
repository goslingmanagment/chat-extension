// Valid sample values of the contracts, built from synthetic ids only (never a
// real account, chat or message id: tools/archive-check rejects those). Other
// packages' tests build on these through `@cg/contracts/fixtures`.

import {
  ANCHOR_IDS,
  DEFAULT_SETTINGS,
  HOST_CAPABILITIES,
  PERF_METRICS,
  type ActiveOpSummary,
  type CapabilityState,
  type ChatRef,
  type ClientHealthV1,
  type CoverageProof,
  type DispatchTicket,
  type FreshnessCheckpoint,
  type HostAccount,
  type ChatSpaceContractReport,
  type HostIdentity,
  type HubBinding,
  type HumanCause,
  type InsertIntent,
  type InsertWire,
  type LogRecord,
  type OpView,
  type PerfHistogram,
  type PerfMetric,
  type PreviewSendRequest,
  type SendAttemptView,
  type SendJournalEntry,
  type SessionIdentity,
  type SettingsV1,
  type SiteContractReport,
  type StartOp,
  type Target,
} from '../../src/index';
import { FANSLY_ANCHOR_IDS } from '../../src/fansly';

export const IDS = {
  acc: '1001',
  otherAcc: '1002',
  fan: '2002',
  otherFan: '2003',
  creator: '3003',
  msg1: '4004',
  msg2: '4005',
} as const;

/** Deterministic RFC 4122-shaped ids. */
export const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

export const T0 = 1_790_000_000_000;
export const ISO = '2026-10-03T10:00:00Z';
export const ISO_LATER = '2026-10-03T10:05:00.250+03:00';
export const HUB = 'https://hub.example.test';
export const DIGEST = 'deadbeefcafe0001';
export const ACTION_TOKEN = 'tok_0123456789abcdef';

export const chat: ChatRef = { host: 'chatspace', hostAccountId: IDS.acc, platformFanId: IDS.fan };
export const account: HostAccount = {
  host: 'chatspace',
  hostAccountId: IDS.acc,
  platform: 'onlyfans',
  platformAccountId: IDS.creator,
  username: 'model_one',
  displayName: 'Model One',
};
export const session: SessionIdentity = { hubOrigin: HUB, userId: 7, login: 'chatter1', role: 'chatter', epoch: 3 };
export const binding: HubBinding = {
  hubOrigin: HUB,
  principalId: 7,
  loginEpoch: 3,
  host: 'chatspace',
  hostAccountId: IDS.acc,
  platform: 'onlyfans',
  platformAccountId: IDS.creator,
  pageId: 11,
  pageLabel: 'model-one',
  bindingRevision: 2,
};
export const target: Target = { binding, chat, fanRef: IDS.fan, conversationRef: IDS.fan };

/**
 * Fansly (R20, 1.15.0): 18-digit synthetic ids; the creator is the host account, and the conversation is the group,
 * never the fan (FS-IDN-2, FS-IDN-6).
 */
export const FANSLY_IDS = {
  creator: '700000000000000001',
  fan: '700000000000000002',
  group: '700000000000000003',
  otherGroup: '700000000000000004',
} as const;
export const fanslyChat: ChatRef = { host: 'fansly-web', hostAccountId: FANSLY_IDS.creator, platformFanId: FANSLY_IDS.fan };
export const fanslyAccount: HostAccount = {
  host: 'fansly-web',
  hostAccountId: FANSLY_IDS.creator,
  platform: 'fansly',
  platformAccountId: FANSLY_IDS.creator,
  username: 'model_two',
  displayName: 'Model Two',
};
export const fanslyBinding: HubBinding = {
  ...binding,
  host: 'fansly-web',
  hostAccountId: FANSLY_IDS.creator,
  platform: 'fansly',
  platformAccountId: FANSLY_IDS.creator,
  pageId: 12,
  pageLabel: 'model-two',
};
export const fanslyTarget: Target = { binding: fanslyBinding, chat: fanslyChat, fanRef: FANSLY_IDS.fan, conversationRef: FANSLY_IDS.group };
export const hostIdentity: HostIdentity = {
  host: 'chatspace',
  documentEpoch: 'doc1',
  hostLoginEpoch: 'login1',
  hostAccountId: IDS.acc,
  platformAccountId: IDS.creator,
  chat,
  routeEpoch: 5,
  composerInstanceId: 'composer1',
};
export const cause: HumanCause = { kind: 'click', actionToken: ACTION_TOKEN };

/** An insert into the open chat as MAIN receives it (no token). */
export const insertWire: InsertWire = {
  intentId: uuid(1),
  operationId: uuid(2),
  part: { index: 0 },
  target: chat,
  expected: { kind: 'open', documentEpoch: 'doc1', routeEpoch: 5, composerInstanceId: 'composer1', draftRevision: 4, draftDigest: DIGEST },
  mode: 'replace',
  text: 'Hi there',
  confirmationId: null,
  createdAt: T0,
  expiresAt: T0 + 20_000,
};
/** The same insert on the isolated side, with the click's token. */
export const insertIntent: InsertIntent = { ...insertWire, cause };
/** «Открыть и вставить»: the target's draft is unknown before the navigation. */
export const deferredInsert: InsertWire = { ...insertWire, expected: { kind: 'deferred', documentEpoch: 'doc1' } };

export const checkpoint: FreshnessCheckpoint = {
  documentEpoch: 'doc1',
  socketEpoch: 1,
  subscriptionEpoch: 1,
  hostAccountId: IDS.acc,
  platformFanId: IDS.fan,
  fanSequence: 3,
  lastFanMessageId: IDS.msg1,
  knownFanMessageIds: [IDS.msg1],
  observedAt: T0,
  coverage: 'ok',
};

export const previewSendRequest: PreviewSendRequest = {
  attemptId: uuid(5),
  target,
  generationRef: uuid(6),
  part: { index: 0 },
  previewRevision: 1,
  plainText: 'hey you',
  isAiGenerated: true,
  checkpoint,
  cause,
};

export const dispatchTicket: DispatchTicket = { attemptId: uuid(5), ticket: 'ticket-1', expiresAt: T0 + 10_000 };

export const sendView: SendAttemptView = { attemptId: uuid(5), state: 'sentObserved', platformMessageId: IDS.msg2 };

export const journalEntry: SendJournalEntry = {
  attemptId: uuid(5),
  hubOrigin: HUB,
  pageId: 11,
  platform: 'onlyfans',
  fanRef: IDS.fan,
  hostAccountId: IDS.acc,
  purpose: 'preview-reply',
  opId: uuid(2),
  group: { generationRef: uuid(6), variant: 0, partCount: 2 },
  partIndex: 0,
  previewRevision: 1,
  documentEpoch: 'doc1',
  state: 'preparing',
  createdAt: T0,
  updatedAt: T0 + 5,
};

export const contractReport: ChatSpaceContractReport = {
  build: 'index-0000test',
  adapterVersion: '1.0.0',
  checkedAt: T0,
  anchors: Object.fromEntries(ANCHOR_IDS.map((anchor) => [anchor, 'ok'])) as ChatSpaceContractReport['anchors'],
  capabilities: Object.fromEntries(HOST_CAPABILITIES.map((capability) => [capability, { state: 'on' } satisfies CapabilityState])) as ChatSpaceContractReport['capabilities'],
};

/**
 * 1.15.0 (R20 F7): a report of a site other than ChatSpace — the shared capabilities and the site's own block, every
 * anchor of the Fansly set named (architecture §7.12).
 */
export const siteContractReport: SiteContractReport = {
  host: 'fansly-web',
  build: 'main.2e6b96097a4bb73b',
  adapterVersion: '1.0.0',
  checkedAt: T0,
  capabilities: { ...contractReport.capabilities, previewSend: { state: 'off' }, receipt: { state: 'off' }, chatList: { state: 'off' } },
  extensions: {
    'fansly-web': {
      anchors: Object.fromEntries(FANSLY_ANCHOR_IDS.map((anchor) => [anchor, 'ok'])),
      capabilities: { freshness: { state: 'on' }, follows: { state: 'on' }, headerSlot: { state: 'on' }, fileAttach: { state: 'on' }, vault: { state: 'off', reason: 'vaultUpload' }, relay: { state: 'off' } },
    },
  },
};

export const startReply: StartOp = {
  feature: 'reply',
  surface: 'dock',
  target,
  cause,
  tone: 'flirty',
  split: true,
  window: 100,
  fresh: {
    capturedAt: ISO,
    messages: [{ platformMessageId: IDS.msg1, direction: 'fan', sentAt: ISO, text: 'hey' }],
  },
};

/** R20 (1.15.0): message ids of a Fansly chat as the hub's coverage-check matrix writes them (its `hubCases`); one the tab saw deleted. */
export const COVERAGE_MSG = {
  m1: '700000000000000101',
  m2: '700000000000000102',
  m3: '700000000000000103',
  deleted: '700000000000000201',
} as const;

/**
 * A tab's snapshot proof of a Fansly reply (R20 §9.1): the check window of three, the fan's two newest first, one
 * message the tab saw deleted, the texts of the window — the media-only first one has none.
 */
export const tabProof: CoverageProof = {
  kind: 'tab-snapshot',
  conversationRef: FANSLY_IDS.group,
  completeness: 'complete',
  takenAt: ISO,
  window: [
    { id: COVERAGE_MSG.m1, dir: 'fan' },
    { id: COVERAGE_MSG.m2, dir: 'model' },
    { id: COVERAGE_MSG.m3, dir: 'fan' },
  ],
  knownFanMessageIds: [COVERAGE_MSG.m3, COVERAGE_MSG.m1],
  deletedIds: [COVERAGE_MSG.deleted],
  tail: [
    { platformMessageId: COVERAGE_MSG.m2, direction: 'model', sentAt: ISO, text: 'hi there' },
    { platformMessageId: COVERAGE_MSG.m3, direction: 'fan', sentAt: ISO, text: 'hey' },
  ],
  truncated: false,
};

/** The proof of the «Новые» pass (FS-NEW-7): the history it checked, no text. */
export const passProof: CoverageProof = {
  kind: 'pass',
  conversationRef: FANSLY_IDS.group,
  completeness: 'complete',
  takenAt: ISO,
  window: [{ id: COVERAGE_MSG.m1, dir: 'fan' }],
  knownFanMessageIds: [COVERAGE_MSG.m1],
  deletedIds: [],
};

/** Reply on Fansly: its freshness is the proof (no `fresh`, no checkpoint), its tail inside. */
export const fanslyStartReply: StartOp = { feature: 'reply', surface: 'dock', target: fanslyTarget, cause, tone: 'flirty', split: false, window: 100, proof: tabProof };

export const activeOp: ActiveOpSummary = {
  opId: uuid(2),
  feature: 'reply',
  surface: 'dock',
  chat,
  fanLabel: 'Fan Two',
  state: 'streaming',
  startedAt: T0,
  inThisTab: true,
};

export const opView: OpView = {
  opId: uuid(2),
  feature: 'reply',
  surface: 'dock',
  target,
  state: 'done',
  phase: { name: 'settled', since: T0 + 4000 },
  startedAt: T0,
  firstChunkAt: T0 + 1200,
  endedAt: T0 + 4000,
  text: 'hey [NEXT] how are you',
  result: { kind: 'parts', parts: ['hey', 'how are you'], splitRequested: true },
  generationRef: uuid(6),
  toneUsed: 'flirty',
  servedContext: { source: 'union', servedHead: { messageRef: IDS.msg1, at: ISO }, live: { status: 'served', accepted: 2, rejected: 0 } },
};

/** A histogram with its metric's fixed bounds and the given values. */
export function histogram(metric: PerfMetric, values: readonly number[]): PerfHistogram {
  const bounds = [...PERF_METRICS[metric].bounds];
  const counts = new Array<number>(bounds.length + 1).fill(0);
  for (const value of values) {
    const bucket = bounds.findIndex((bound) => value <= bound);
    const index = bucket === -1 ? bounds.length : bucket;
    counts[index] = (counts[index] ?? 0) + 1;
  }
  return {
    metric,
    unit: 'ms',
    schemaVersion: PERF_METRICS[metric].schemaVersion,
    bounds,
    counts,
    count: values.length,
    sum: values.reduce((a, b) => a + b, 0),
    max: values.length === 0 ? 0 : Math.max(...values),
  };
}

export const clientHealth: ClientHealthV1 = {
  kind: 'client_health',
  v: 1,
  window: { from: ISO, to: '2026-10-03T10:15:00Z' },
  client: { name: 'chat-extension', version: '0.1.0', browser: 'firefox', browserMajor: 157, os: 'macos' },
  host: { kind: 'chatspace', build: 'index-0000test', contractOk: false, missing: ['fansMap'] },
  disabled: ['previewSend'],
  perf: [histogram('insertMs', [12, 40, 90]), histogram('routeToDockMs', [3])],
  counters: { 'CG-SEND-UNCERTAIN': 1, 'p1.insert-misplaced': 0 },
  footprint: { kind: 'owned-estimate', cachesKB: 420, logsKB: 900 },
};

export const logRecord: LogRecord = {
  ts: ISO,
  seq: 12,
  level: 'info',
  scope: 'tab.dock',
  msg: 'insert applied',
  fields: { textLength: 42, ms: 18 },
  ctx: { opId: uuid(2), chatKey: 'chatspace:1001:2002', routeEpoch: 5 },
};

export const customSettings: SettingsV1 = {
  ...DEFAULT_SETTINGS,
  ui: { ...DEFAULT_SETTINGS.ui, theme: 'dark', locale: 'ru', hints: false, resultStyle: 'sheet', textSize: 'normal' },
  sound: { ...DEFAULT_SETTINGS.sound, volume: 35, mutedAccounts: [`chatspace:${IDS.otherAcc}`] },
  personas: { scope: { hubOrigin: HUB, userId: 7 }, byPageId: { '11': { key: 'lora', definitionId: 'pdef_0123456789abcdef' } } },
  accounts: { labels: { [`chatspace:${IDS.acc}`]: 'Main model' } },
  onboarding: { checklistDismissed: true, lastSeenVersion: '0.1.0', keysFooter: { shown: 5, dismissed: false } },
};
