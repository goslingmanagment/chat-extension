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
  type DispatchTicket,
  type FreshnessCheckpoint,
  type HostAccount,
  type HostContractReport,
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
  type StartOp,
  type Target,
} from '../../src/index';

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

export const contractReport: HostContractReport = {
  build: 'index-0000test',
  adapterVersion: '1.0.0',
  checkedAt: T0,
  anchors: Object.fromEntries(ANCHOR_IDS.map((anchor) => [anchor, 'ok'])) as HostContractReport['anchors'],
  capabilities: Object.fromEntries(HOST_CAPABILITIES.map((capability) => [capability, { state: 'on' } satisfies CapabilityState])) as HostContractReport['capabilities'],
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
  ui: { theme: 'dark', locale: 'ru', hints: false, resultStyle: 'sheet' },
  sound: { ...DEFAULT_SETTINGS.sound, volume: 35, mutedAccounts: [IDS.otherAcc] },
  personas: { byPageId: { '11': { key: 'lora', definitionId: 'pdef_0123456789abcdef' } } },
  accounts: { labels: { [IDS.acc]: 'Main model' } },
  onboarding: { checklistDismissed: true, lastSeenVersion: '0.1.0', keysFooter: { shown: 5, dismissed: false } },
};
