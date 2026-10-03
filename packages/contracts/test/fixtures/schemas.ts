// One valid and one invalid fixture (at least) for every exported schema of
// @cg/contracts. test/schemas.test.ts checks that each exported `*Schema` is
// listed here and that the verdicts hold.

import type * as z from 'zod/mini';

import * as C from '../../src/index';
import { HUB_SCHEMA_FIXTURES } from './hub';
import {
  ACTION_TOKEN,
  DIGEST,
  HUB,
  IDS,
  ISO,
  ISO_LATER,
  T0,
  account,
  activeOp,
  binding,
  cause,
  chat,
  checkpoint,
  clientHealth,
  contractReport,
  customSettings,
  dispatchTicket,
  histogram,
  hostIdentity,
  deferredInsert,
  insertIntent,
  insertWire,
  journalEntry,
  logRecord,
  opView,
  previewSendRequest,
  sendView,
  session,
  startReply,
  target,
  uuid,
} from './samples';
import { VM_SCHEMA_FIXTURES } from './vm';

export interface SchemaFixture {
  readonly name: string;
  readonly schema: z.ZodMiniType;
  readonly valid: readonly unknown[];
  readonly invalid: readonly unknown[];
}

const fixture = (name: string, schema: z.ZodMiniType, valid: readonly unknown[], invalid: readonly unknown[]): SchemaFixture => ({
  name,
  schema,
  valid,
  invalid,
});

const repeat = (text: string, times: number): string => text.repeat(times);

export const message = { platformMessageId: IDS.msg1, direction: 'fan', sentAt: ISO, text: 'hey' } as const;
export const messages = (n: number) => Array.from({ length: n }, (_, i) => ({ ...message, platformMessageId: String(4000 + i + 1) }));
export const composerState = { chat, instanceId: 'composer1', ready: true, hidden: false, draft: { revision: 4, provenance: 'empty' } } as const;
export const routeState = { epoch: 5, name: 'chat', account, chat } as const;
export const fan = {
  chat,
  username: 'fan_two',
  displayName: 'Fan Two',
  isBlocked: false,
  canReceiveMessages: true,
  isRestricted: null,
  isOnline: true,
  lastSeenAt: ISO,
  buyingPowerLabel: null,
  insights: [{ label: 'Spend tier', value: 'High' }],
  bio: null,
  lists: ['VIP'],
} as const;
export const navItem = { chat, position: 0, displayName: 'Fan Two', username: 'fan_two', unreadCount: 2, isOnline: null } as const;
export const chatWindow = {
  chat,
  state: 'ready',
  loaded: 40,
  fanMessages: 22,
  modelMessages: 18,
  lastFanMessageId: IDS.msg1,
  lastFanMessageAt: ISO,
  lastModelMessageAt: ISO_LATER,
  hasOlder: true,
} as const;
export const reviewItem = { body: 'Missed the upsell.', fix: 'Want to see more?', fixWhere: 'after "[Photo]"', afterFix: null } as const;
export const reviewDoc = {
  rating: 7,
  lead: '',
  sections: [{ kind: 'verdict', body: 'Solid.', items: [] }, { kind: 'mistakes', body: '', items: [reviewItem] }],
  recommendations: { lead: 'Next time:', items: [reviewItem] },
} as const;
export const coachAnswer = {
  prose: 'Situation: warm. Next move: ask.',
  blocks: [{ kind: 'situation', body: 'warm' }],
  drafts: [{ index: 0, parts: ['hey', 'missed you'] }],
} as const;
export const coverage = { level: 'partial', requested: 3000, served: 1200, asOf: ISO } as const;
export const debugView = {
  stages: [{ name: 'meta', at: T0 + 300 }],
  usage: { inputTokens: 1200, outputTokens: 80, cacheReadTokens: null, cacheWriteTokens: null, costMicroUsd: 2150 },
  reasoning: null,
  promptToken: 'prompt-token-1',
  context: { source: 'union', coverage: 'window', windowRequested: 100, windowServed: 100, liveAccepted: 3, liveRejected: 0 },
} as const;
export const incomingFact = {
  host: 'chatspace',
  hostAccountId: IDS.acc,
  platformFanId: IDS.fan,
  platformMessageId: IDS.msg1,
  fromFan: true,
  automatic: false,
  tip: false,
  sentAt: ISO,
  socketEpoch: 1,
  fanSequence: 4,
  source: 'ws-tap',
} as const;
export const contractWire = { build: 'index-0000test', missing: ['fansMap'], shape: [], receiptModules: { queue: 'mod-queue-0000' } } as const;
/** The draft at Send: our unchanged insert, and a draft nobody can attribute. */
export const ourDraft = { revision: 5, provenance: 'our-insert', insertIntentId: uuid(1), editedSinceInsert: false } as const;
export const humanDraft = { revision: 7, provenance: 'human-or-unknown', insertIntentId: null, editedSinceInsert: null } as const;
export const mainSend = {
  attemptId: uuid(5),
  acc: IDS.acc,
  fan: IDS.fan,
  platformAccountId: IDS.creator,
  part: { index: 0 },
  previewRevision: 1,
  plainText: 'hey you',
  isAiGenerated: true,
  checkpoint,
  expiresAt: T0 + 10_000,
} as const;
const bridgeRes = { v: 1, kind: 'res', id: 1, t: 'probe', documentEpoch: 'doc1', seq: 0 } as const;
export const probe = { v: 1, readyStateAtStart: 'loading', installMs: 0.05, wsTap: false } as const;
export const toast = {
  toastId: uuid(20),
  kind: 'success',
  scope: 'op-done',
  opId: uuid(2),
  feature: 'reply',
  chat,
  fanLabel: 'Fan Two',
} as const;
export const diagnostics = {
  generatedAt: ISO,
  extension: { version: '0.1.0', contractsVersion: '1.0.0', testBuild: false },
  browser: { name: 'firefox', major: 157 },
  os: 'windows',
  session: { signedIn: true, hubOrigin: HUB, role: 'chatter' },
  hub: {
    reachable: true,
    lastCheckedAt: ISO,
    lastError: null,
    flags: { previewSend: false, wsTap: true },
    sdk: { vendoredHash: 'a'.repeat(64), hubHash: 'b'.repeat(64), compatible: true },
  },
  tabs: [{ tabSessionId: uuid(4), host: contractReport, chatKey: 'chatspace:1001:2002' }],
  counters: { 'CG-HUB-TIMEOUT': 2 },
  logs: { records: 1200, bytes: 300_000, dropped: 0 },
  telemetry: { consent: true, queued: 3, dropped: 0 },
  sound: { listeningTabs: 1, lastIncomingAt: ISO, outcomes: { played: 4, 'chat-open': 2 } },
  ops: { active: 1 },
  sends: { open: 0, uncertain: 0 },
} as const;
export const quota = { pageId: 11, remainingRequestsToday: 12, remainingMicroUsdToday: 1_500_000, resetsAt: '2026-10-04T00:00:00Z', observedAt: ISO } as const;
export const promptSnapshot = {
  state: 'ok',
  fromCache: false,
  capturedAt: ISO,
  feature: 'reply',
  manifest: 'blocks: system, persona, transcript',
  blocks: [{ name: 'system', text: 'synthetic prompt text', truncated: false }],
} as const;
export const sendBegin = {
  attemptId: uuid(5),
  opId: uuid(2),
  target,
  purpose: 'greeting',
  group: { generationRef: uuid(6), variant: 0, partCount: 2 },
  part: { variant: 0, index: 0 },
  previewRevision: 1,
  textRevision: 0,
  checkpoint,
  documentEpoch: 'doc1',
  cause,
  leaseToken: uuid(9),
} as const;
export const tabHealth = {
  windowFrom: T0,
  windowTo: T0 + 900_000,
  host: contractReport,
  perf: [histogram('panelOpenMs', [20, 30])],
  counters: { 'insert.prevented': 1 },
  footprint: { cachesKB: 120, domNodes: 340 },
} as const;

export const SCHEMA_FIXTURES: readonly SchemaFixture[] = [
  // ── primitives ──
  fixture('NativeId', C.NativeIdSchema, ['1', IDS.fan, repeat('9', 30)], ['0', '01', repeat('1', 31), 2002, '-1', '1.5', '']),
  fixture('HubIntId', C.HubIntIdSchema, [1, 11], [0, -1, 1.5, '11']),
  fixture('OpenToken', C.OpenTokenSchema, ['flag_off', 'x', 'any text the hub grows'], ['', repeat('x', 65), 5]),
  fixture('Uuid', C.UuidSchema, [uuid(1), 'A0000000-0000-4000-8000-00000000000F'], ['not-a-uuid', `${uuid(1)}0`]),
  fixture('Ref', C.RefSchema, ['gen-1', uuid(3)], ['', ' bad', repeat('a', 129)]),
  fixture('EpochToken', C.EpochTokenSchema, ['doc1', 'a_b-c'], ['', 'has space', repeat('a', 65)]),
  fixture('Digest', C.DigestSchema, [DIGEST], ['DEADBEEFCAFE', 'abc', repeat('a', 65)]),
  fixture('ActionToken', C.ActionTokenSchema, [ACTION_TOKEN], ['short', 'has space 0123456789']),
  fixture('Count', C.CountSchema, [0, 5], [-1, 1.5, '1']),
  fixture('EpochMs', C.EpochMsSchema, [T0], [-1, 1.5]),
  fixture('DurationMs', C.DurationMsSchema, [0, 12.5], [-1, 86_400_001]),
  fixture('IsoTimestamp', C.IsoTimestampSchema, [ISO, ISO_LATER], ['2026-10-03', '2026-10-03 10:00:00Z', 'x', T0]),
  fixture('MoneyMills', C.MoneyMillsSchema, [0, 1250, -500], [1.5, '1250', Number.MAX_SAFE_INTEGER + 2]),
  fixture('MicroUsd', C.MicroUsdSchema, [0, 1234], [-1, 0.5]),
  fixture('HubOrigin', C.HubOriginSchema, ['https://gosling-agency.ru', `${HUB}:8443`], [`${HUB}/path`, 'ftp://hub.example.test', 'gosling-agency.ru']),
  fixture('TimeZone', C.TimeZoneSchema, ['Europe/Moscow', 'UTC', 'America/Argentina/Buenos_Aires'], ['Europe/', '../etc', '']),

  // ── features ──
  fixture('FeatureId', C.FeatureIdSchema, ['reply', 'recap-short'], ['help', 'Reply']),
  fixture('Surface', C.SurfaceSchema, ['dock', 'newcomers'], ['popup']),
  fixture('Tone', C.ToneSchema, ['flirty'], ['none', 'flirt']),

  // ── identities ──
  fixture('HostKind', C.HostKindSchema, ['chatspace', 'fansly-web'], ['fansly']),
  fixture('Platform', C.PlatformSchema, ['onlyfans', 'fansly'], ['OnlyFans', 'patreon']),
  fixture('Role', C.RoleSchema, ['team_lead', 'unknown'], ['admin']),
  fixture('ChatRef', C.ChatRefSchema, [chat], [{ ...chat, platformFanId: 2002 }, { ...chat, extra: 1 }, { host: 'chatspace', hostAccountId: IDS.acc }]),
  fixture('ChatKey', C.ChatKeySchema, ['chatspace:1001:2002', 'fansly-web:1:2'], ['chatspace:1001', 'fansly:1:2', 'chatspace:01:2', 7]),
  fixture(
    'HostAccount',
    C.HostAccountSchema,
    [account, { ...account, platformAccountId: null, username: null, displayName: null }],
    [{ ...account, platform: 'fansly-web' }, { ...account, username: repeat('x', 129) }],
  ),
  fixture('SessionIdentity', C.SessionIdentitySchema, [session], [{ ...session, userId: 0 }, { ...session, role: 'admin' }]),
  fixture(
    'HubBinding',
    C.HubBindingSchema,
    [binding],
    [{ ...binding, platformAccountId: null }, { ...binding, pageLabel: '' }, { ...binding, hostAccountId: undefined }, { ...binding, host: 'onlymonster' }],
  ),
  fixture(
    'Target',
    C.TargetSchema,
    [target],
    [
      { ...target, fanRef: IDS.otherFan },
      { ...target, conversationRef: IDS.otherFan },
      { ...target, binding: { ...binding, platform: 'fansly' } },
      // A binding resolved for another host account would send page Y's reply from account X.
      { ...target, binding: { ...binding, hostAccountId: '1099' } },
      { ...target, binding: { ...binding, host: 'fansly-web' } },
    ],
  ),
  fixture(
    'GenerationIdentity',
    C.GenerationIdentitySchema,
    [{ target, feature: 'reply', personaKey: 'lora', personaDefinitionId: 'pdef_0123456789abcdef', operationId: uuid(2), clientRequestId: uuid(2), tabSessionId: uuid(4), requestDigest: DIGEST }],
    [{ target, feature: 'help', personaKey: 'lora', personaDefinitionId: 'pdef_0123456789abcdef', operationId: uuid(2), clientRequestId: uuid(2), tabSessionId: uuid(4), requestDigest: DIGEST }],
  ),
  fixture('HostIdentity', C.HostIdentitySchema, [hostIdentity, { ...hostIdentity, chat: null, composerInstanceId: null }], [{ ...hostIdentity, routeEpoch: -1 }]),
  fixture('DraftProvenance', C.DraftProvenanceSchema, ['our-insert'], ['ours']),
  fixture(
    'DraftSnapshot',
    C.DraftSnapshotSchema,
    [{ identity: hostIdentity, revision: 4, plainText: 'my draft', provenance: 'human-or-unknown', digest: DIGEST }],
    [{ identity: hostIdentity, revision: 4, plainText: repeat('x', 20_001), provenance: 'empty', digest: DIGEST }],
  ),
  fixture('HumanCause', C.HumanCauseSchema, [cause, { kind: 'key', actionToken: ACTION_TOKEN }], [{ kind: 'timer', actionToken: ACTION_TOKEN }, { kind: 'click', actionToken: 'short' }]),
  fixture('PartRef', C.PartRefSchema, [{ index: 0 }, { variant: 2, index: 9 }], [{ index: 10 }, { variant: 3, index: 0 }, { index: -1 }]),

  // ── errors ──
  fixture('CgCode', C.CgCodeSchema, ['CG-SEND-UNCERTAIN', 'CG-NETWORK'], ['CG-HUB-401', 'CG-GUARD-BLOCKED']),
  fixture('SettingsRoute', C.SettingsRouteSchema, [{ section: 'account' }, { section: 'account', code: 'CG-AUTH-REQUIRED' }], [{ section: 'billing' }]),
  fixture(
    'CgErrorWire',
    C.CgErrorWireSchema,
    [{ code: 'CG-HUB-RATE-LIMIT', detail: 'HTTP 429 • rate_limit_exceeded', retryAt: T0, httpStatus: 429 }, { code: 'CG-UNKNOWN' }],
    [{ code: 'CG-HUB-RATE-LIMIT', detail: repeat('x', 401) }, { code: 'CG-NOPE' }, { code: 'CG-HUB-REQUEST', httpStatus: 99 }],
  ),
  fixture('CgErrorView', C.CgErrorViewSchema, [{ code: 'CG-NETWORK', title: 'Нет связи', body: 'Проверьте подключение.' }], [{ code: 'CG-NETWORK', title: 'Нет связи' }]),

  // ── settings ──
  fixture('SettingsSection', C.SettingsSectionSchema, ['status', 'diagnostics'], ['advanced']),
  fixture('ToneId', C.ToneIdSchema, ['chime', 'blip'], ['beep']),
  fixture('PersonaAssignment', C.PersonaAssignmentSchema, [{ key: 'lora', definitionId: 'pdef_0123456789abcdef' }], [{ key: '', definitionId: 'pdef_0123456789abcdef' }]),
  fixture(
    'SettingsV1',
    C.SettingsV1Schema,
    [C.DEFAULT_SETTINGS, customSettings],
    [
      { ...C.DEFAULT_SETTINGS, schemaVersion: 2 },
      { ...C.DEFAULT_SETTINGS, sound: { ...C.DEFAULT_SETTINGS.sound, volume: 7 } },
      { ...C.DEFAULT_SETTINGS, generation: { ...C.DEFAULT_SETTINGS.generation, windows: { quick: 100, ping: 100, improve: 25, deep: 3001 } } },
      { ...C.DEFAULT_SETTINGS, accounts: { labels: { [IDS.acc]: repeat('x', 61) } } },
      { ...C.DEFAULT_SETTINGS, personas: { byPageId: { '0': { key: 'lora', definitionId: 'pdef_0123456789abcdef' } } } },
      { ...C.DEFAULT_SETTINGS, extra: true },
    ],
  ),
  fixture(
    'SettingsPatch',
    C.SettingsPatchSchema,
    [{}, { ui: { theme: 'dark' } }, { personas: { byPageId: { '11': null } } }, { generation: { windows: { deep: 1500 } } }],
    [{ ui: { theme: 'neon' } }, { extra: 1 }, { sound: { volume: 101 } }],
  ),
  fixture('SettingsState', C.SettingsStateSchema, [{ settings: C.DEFAULT_SETTINGS, revision: 0, readOnly: false }], [{ settings: C.DEFAULT_SETTINGS, revision: -1, readOnly: false }]),

  // ── send (X8) ──
  fixture(
    'FreshnessCheckpoint',
    C.FreshnessCheckpointSchema,
    [checkpoint, { ...checkpoint, lastFanMessageId: null, knownFanMessageIds: [], coverage: 'unknown' }, { ...checkpoint, knownFanMessageIds: [IDS.msg1, IDS.msg2] }],
    [
      { ...checkpoint, coverage: 'partial' },
      { ...checkpoint, fanSequence: -1 },
      // The newest known id is lastFanMessageId; the set is bounded and has no repeats.
      { ...checkpoint, knownFanMessageIds: [IDS.msg2, IDS.msg1] },
      { ...checkpoint, lastFanMessageId: null },
      { ...checkpoint, knownFanMessageIds: [IDS.msg1, IDS.msg1] },
      { ...checkpoint, knownFanMessageIds: [IDS.msg1, ...Array.from({ length: 10 }, (_, i) => String(5000 + i))] },
    ],
  ),
  fixture(
    'PreviewSendRequest',
    C.PreviewSendRequestSchema,
    [previewSendRequest],
    [
      { ...previewSendRequest, plainText: '' },
      { ...previewSendRequest, plainText: repeat('x', 5001) },
      // A checkpoint of another fan would compare the wrong counters.
      { ...previewSendRequest, checkpoint: { ...checkpoint, platformFanId: '2099' } },
      { ...previewSendRequest, generationRef: 'gen-1' },
    ],
  ),
  fixture('DispatchTicket', C.DispatchTicketSchema, [dispatchTicket], [{ ...dispatchTicket, ticket: '' }]),
  fixture('PreviewSendConditionCode', C.PreviewSendConditionCodeSchema, ['CG-SEND-HISTORY', 'CG-CONTEXT-CHANGED', 'CG-CLAIM-BUSY'], ['CG-SEND-QUEUE', 'CG-NETWORK']),
  fixture(
    'PreviewSendPreflight',
    C.PreviewSendPreflightSchema,
    [{ ok: true }, { ok: false, code: 'CG-SEND-BUSY' }, { ok: false, code: 'CG-SEND-HISTORY' }],
    [{ ok: false }, { ok: true, code: 'CG-SEND-BUSY' }, { ok: false, code: 'CG-SEND-UNCERTAIN' }],
  ),
  fixture('PendingId', C.PendingIdSchema, [uuid(7)], ['']),
  fixture(
    'PreviewSendCommit',
    C.PreviewSendCommitSchema,
    [
      { state: 'nativeEnqueued', pendingId: uuid(7) },
      { state: 'notEnqueued', code: 'CG-SEND-QUEUE' },
      { state: 'held', code: 'CG-SEND-STALE' },
      { state: 'held', code: 'CG-TIMEOUT' },
      { state: 'uncertain', code: 'CG-SEND-UNCERTAIN' },
    ],
    [
      { state: 'sentObserved' },
      { state: 'nativeEnqueued' },
      { state: 'held', code: 'CG-NETWORK' },
      { state: 'notEnqueued', code: 'CG-SEND-MIMIC' },
      { state: 'uncertain', code: 'CG-SEND-REJECTED' },
    ],
  ),
  fixture('SendAttemptState', C.SendAttemptStateSchema, ['uncertain', 'nativeAccepted'], ['sent']),
  fixture(
    'SendAttemptView',
    C.SendAttemptViewSchema,
    [
      sendView,
      { attemptId: uuid(5), state: 'rejected', code: 'CG-SEND-GUARD', httpStatus: 422, detail: { guardTopics: ['contact-info'], upstream: 'MESSAGE_GUARD_VIOLATION' } },
      { attemptId: uuid(5), state: 'rejected', code: 'CG-SEND-GUARD' },
      { attemptId: uuid(5), state: 'rejected', code: 'CG-SEND-REJECTED', httpStatus: 403 },
    ],
    [
      { ...sendView, platformMessageId: 4005 },
      { ...sendView, state: 'sent' },
      // 401 is never an outcome; a status belongs to a proven refusal only.
      { attemptId: uuid(5), state: 'rejected', code: 'CG-SEND-REJECTED', httpStatus: 401 },
      { attemptId: uuid(5), state: 'rejected', code: 'CG-SEND-REJECTED' },
      { attemptId: uuid(5), state: 'uncertain', code: 'CG-SEND-UNCERTAIN', httpStatus: 500 },
    ],
  ),
  fixture('SendPurpose', C.SendPurposeSchema, ['greeting'], ['reply']),
  fixture(
    'SendGroup',
    C.SendGroupSchema,
    [{ generationRef: uuid(6), variant: 0, partCount: 3 }],
    [
      { generationRef: uuid(6), variant: 0, partCount: 0 },
      { generationRef: uuid(6), variant: 3, partCount: 1 },
      { generationRef: 'gen-1', variant: 0, partCount: 1 },
    ],
  ),
  fixture(
    'SendJournalEntry',
    C.SendJournalEntrySchema,
    [journalEntry, { ...journalEntry, state: 'uncertain', code: 'CG-SEND-UNCERTAIN', pendingId: uuid(7) }],
    [{ ...journalEntry, text: 'hey' }, { ...journalEntry, partIndex: 2 }],
  ),

  // ── host ──
  fixture('HostCapability', C.HostCapabilitySchema, ['previewSend'], ['send']),
  fixture('CapabilityState', C.CapabilityStateSchema, [{ state: 'on' }, { state: 'degraded', reason: 'composerFrame', code: 'CG-HOST-CONTRACT' }], [{ state: 'broken' }]),
  fixture('AnchorId', C.AnchorIdSchema, ['pendingMessages'], ['pinia']),
  fixture('HostContractReport', C.HostContractReportSchema, [contractReport], [{ ...contractReport, anchors: { app: 'ok' } }]),
  fixture('RouteState', C.RouteStateSchema, [routeState, { epoch: 0, name: 'other', account: null, chat: null }], [{ epoch: 5, name: 'inbox', account: null, chat: null }]),
  fixture('ComposerState', C.ComposerStateSchema, [composerState], [{ ...composerState, draft: { revision: 4, provenance: 'x' } }]),
  fixture(
    'InsertExpectation',
    C.InsertExpectationSchema,
    [insertWire.expected, deferredInsert.expected],
    // A deferred insert cannot expect a draft it has not seen; an open one must.
    [{ kind: 'deferred', documentEpoch: 'doc1', draftRevision: 4, draftDigest: DIGEST }, { kind: 'open', documentEpoch: 'doc1', routeEpoch: null, composerInstanceId: null, draftRevision: 4, draftDigest: DIGEST }],
  ),
  fixture(
    'InsertWire',
    C.InsertWireSchema,
    [insertWire, deferredInsert, { ...insertWire, mode: 'append', confirmationId: uuid(8) }],
    [
      insertIntent,
      { ...insertWire, expiresAt: T0 },
      { ...insertWire, text: '' },
      // No consent before the target's draft was seen, and no append to a draft nobody read.
      { ...deferredInsert, confirmationId: uuid(8) },
      { ...deferredInsert, mode: 'append' },
    ],
  ),
  fixture(
    'InsertIntent',
    C.InsertIntentSchema,
    [insertIntent, { ...insertIntent, mode: 'append', confirmationId: uuid(8) }],
    [
      // §14: no write without the one-time token of a human click or key.
      insertWire,
      { ...insertIntent, expiresAt: T0 },
      { ...insertIntent, text: '' },
      { ...insertIntent, expected: deferredInsert.expected, confirmationId: uuid(8) },
    ],
  ),
  fixture(
    'InsertReceipt',
    C.InsertReceiptSchema,
    [
      { state: 'applied', draftRevision: 5, draftDigest: DIGEST, ms: 12.5 },
      { state: 'rejected', code: 'CG-DRAFT-CHANGED', needs: 'confirm-changed-draft' },
      { state: 'uncertain', code: 'CG-INSERT-UNCERTAIN' },
    ],
    [{ state: 'applied' }, { state: 'failed', code: 'CG-INSERT-FAILED' }],
  ),
  fixture(
    'NavigationIntent',
    C.NavigationIntentSchema,
    [
      { intentId: uuid(9), cause, target: { hostAccountId: IDS.acc, platformFanId: IDS.fan }, thenInsert: deferredInsert },
      { intentId: uuid(9), cause, target: { hostAccountId: IDS.acc, platformFanId: null } },
    ],
    [
      { intentId: uuid(9), target: { hostAccountId: IDS.acc, platformFanId: IDS.fan } },
      // thenInsert: deferred, into the navigation's own chat, never with an account-only target.
      { intentId: uuid(9), cause, target: { hostAccountId: IDS.acc, platformFanId: IDS.fan }, thenInsert: insertWire },
      { intentId: uuid(9), cause, target: { hostAccountId: IDS.acc, platformFanId: '2099' }, thenInsert: deferredInsert },
      { intentId: uuid(9), cause, target: { hostAccountId: IDS.acc, platformFanId: null }, thenInsert: deferredInsert },
      { intentId: uuid(9), cause, target: { hostAccountId: IDS.acc, platformFanId: IDS.fan }, thenInsert: { ...deferredInsert, cause } },
    ],
  ),
  fixture(
    'NavigationReceipt',
    C.NavigationReceiptSchema,
    [
      { state: 'navigated', routeEpoch: 6, insert: null },
      { state: 'navigated', routeEpoch: 6, insert: { state: 'rejected', code: 'CG-DRAFT-CHANGED', needs: 'confirm-human-draft' } },
      { state: 'failed', code: 'CG-NAV-TIMEOUT', insert: { state: 'uncertain', code: 'CG-INSERT-UNCERTAIN' } },
      { state: 'failed', code: 'CG-NAV-FAILED', insert: null },
    ],
    [{ state: 'navigated', routeEpoch: 6 }, { state: 'failed', code: 'CG-NAV-TIMEOUT' }],
  ),
  fixture('LiveTextMessage', C.LiveTextMessageSchema, [message], [{ ...message, text: '' }, { ...message, direction: 'system' }]),
  fixture(
    'LiveTextTail',
    C.LiveTextTailSchema,
    [{ capturedAt: ISO, messages: messages(1) }, { capturedAt: ISO, messages: messages(60) }],
    [{ capturedAt: ISO, messages: [] }, { capturedAt: ISO, messages: messages(61) }],
  ),
  fixture('TailSnapshot', C.TailSnapshotSchema, [{ capturedAt: ISO, messages: messages(200) }], [{ capturedAt: ISO, messages: messages(201) }]),
  fixture('ChatWindow', C.ChatWindowSchema, [chatWindow, { ...chatWindow, state: 'loading', loaded: 0, lastFanMessageId: null, hasOlder: null }], [{ ...chatWindow, loaded: 201 }]),
  fixture(
    'HostFan',
    C.HostFanSchema,
    [fan, { ...fan, lastSeenAt: null, insights: null, bio: 'Hi, I like cats', lists: null }],
    [{ ...fan, isOnline: undefined }, { ...fan, insights: Array.from({ length: 17 }, () => ({ label: 'x', value: 'y' })) }, { ...fan, lastSeenAt: undefined }],
  ),
  fixture('NavigationItem', C.NavigationItemSchema, [navItem], [{ ...navItem, position: -1 }]),
  fixture(
    'HostTheme',
    C.HostThemeSchema,
    [{ scheme: 'dark', tokens: { '--color-om-bg': '#101010' }, fixedWidth: false }],
    [{ scheme: 'dark', tokens: { color: 'red' }, fixedWidth: false }],
  ),
  fixture(
    'MountPoints',
    C.MountPointsSchema,
    [
      { dock: { kind: 'in-flow', composerInstanceId: 'composer1', width: 640 }, overlay: { ready: true, container: null } },
      { dock: { kind: 'none', composerInstanceId: null, width: null }, overlay: { ready: false, container: { left: 0, top: 0, width: 1200, height: 800 } } },
    ],
    [{ dock: { kind: 'inline', composerInstanceId: null, width: null }, overlay: { ready: true, container: null } }],
  ),
  fixture('IncomingFact', C.IncomingFactSchema, [incomingFact], [{ ...incomingFact, platformMessageId: 4004 }, { ...incomingFact, text: 'hey' }]),
  fixture(
    'SentDraft',
    C.SentDraftSchema,
    [ourDraft, { ...ourDraft, provenance: 'human-or-unknown', revision: 6, editedSinceInsert: true }, humanDraft, { ...humanDraft, provenance: 'empty' }],
    [
      // An unchanged insert of ours names its intent; `edited` exists only for a draft from our insert.
      { ...ourDraft, insertIntentId: null, editedSinceInsert: null },
      { ...ourDraft, editedSinceInsert: true },
      { ...humanDraft, editedSinceInsert: false },
      { ...ourDraft, provenance: 'typed' },
    ],
  ),
  fixture(
    'HumanSendFact',
    C.HumanSendFactSchema,
    [
      { chat, pendingId: uuid(7), platformMessageId: IDS.msg2, textDigest: DIGEST, draft: ourDraft },
      { chat, pendingId: uuid(7), platformMessageId: null, textDigest: DIGEST, draft: humanDraft },
    ],
    [{ chat, pendingId: uuid(7), platformMessageId: IDS.msg2, textDigest: DIGEST }, { chat, pendingId: uuid(7), platformMessageId: IDS.msg2, draft: ourDraft }],
  ),
  fixture('CoverageEvent', C.CoverageEventSchema, [{ hostAccountId: IDS.acc, state: 'unknown', reason: 'reconnect' }], [{ hostAccountId: IDS.acc, state: 'partial', reason: 'x' }]),

  // ── operations ──
  fixture('OpState', C.OpStateSchema, ['interrupted'], ['queued']),
  fixture('Phase', C.PhaseSchema, [{ name: 'awaiting-meta', since: T0 }, { name: 'retry-wait', since: T0, retryAt: T0 + 5000 }], [{ name: 'waiting', since: T0 }]),
  fixture(
    'CoachTurn',
    C.CoachTurnSchema,
    [{ question: 'What next?', answer: 'Ask about her day.' }, { question: repeat('q', 2000), answer: 'x' }],
    // The hub's coachHistory[].question stops at 2000 characters (AI-082).
    [{ question: '', answer: 'x' }, { question: repeat('q', 2001), answer: 'x' }],
  ),
  fixture('OpDraft', C.OpDraftSchema, [{ text: 'my draft', revision: 4, digest: DIGEST }], [{ text: '', revision: 4, digest: DIGEST }]),
  fixture(
    'StartOp',
    C.StartOpSchema,
    [
      startReply,
      { feature: 'fix', surface: 'dock', target, cause, tone: null, split: false, window: 25, draft: { text: 'my draft', revision: 4, digest: DIGEST } },
      { feature: 'hi', surface: 'newcomers', target, cause, tone: null, split: true, window: 25, variantCount: 1, checkpoint },
      {
        feature: 'coach',
        surface: 'coach',
        target,
        cause,
        tone: null,
        split: false,
        window: 100,
        coach: { question: 'What next?', history: [{ question: 'Hi?', answer: 'Hello.' }], attachDraft: 'my draft' },
      },
    ],
    [
      { ...startReply, surface: 'preview' },
      { ...startReply, fresh: undefined, coach: { history: [] } },
      { feature: 'fix', surface: 'dock', target, cause, tone: null, split: false, window: 25 },
      { ...startReply, fresh: undefined, variantCount: 3 },
      { ...startReply, window: 0 },
      // The hub body's messageCount starts at 5; a valid StartOp must be a valid hub request.
      { ...startReply, window: 4 },
      { ...startReply, window: 3001 },
      { feature: 'coach', surface: 'coach', target, cause, tone: null, split: false, window: 100, coach: { question: repeat('q', 2001), history: [] } },
      { ...startReply, fresh: undefined, checkpoint },
      { feature: 'hi', surface: 'newcomers', target, cause, tone: null, split: true, window: 25, variantCount: 1, checkpoint: { ...checkpoint, platformFanId: '2099' } },
      { feature: 'ping', surface: 'dock', target, cause, tone: 'casual', split: false, window: 100 },
    ],
  ),
  fixture('ActiveOpSummary', C.ActiveOpSummarySchema, [activeOp], [{ ...activeOp, fanLabel: undefined }]),
  fixture(
    'Admission',
    C.AdmissionSchema,
    [
      { ok: true, opId: uuid(2) },
      { ok: false, code: 'CG-OP-TAB-LIMIT', active: [activeOp, activeOp, activeOp] },
    ],
    [
      { ok: false, code: 'CG-OP-TAB-LIMIT', active: [activeOp, activeOp, activeOp, activeOp] },
      { ok: false, code: 'CG-NETWORK', active: [] },
    ],
  ),
  fixture('Coverage', C.CoverageSchema, [coverage, { level: 'unknown', requested: null, served: null, asOf: null }], [{ ...coverage, level: 'window' }]),
  fixture('ReviewItem', C.ReviewItemSchema, [reviewItem], [{ body: 'x' }]),
  fixture('ReviewDoc', C.ReviewDocSchema, [reviewDoc, { ...reviewDoc, rating: null, recommendations: null }], [{ ...reviewDoc, rating: 11 }]),
  fixture('CoachAnswer', C.CoachAnswerSchema, [coachAnswer, { prose: 'Just prose.', blocks: null, drafts: [] }], [{ ...coachAnswer, drafts: [...coachAnswer.drafts, { index: 1, parts: ['a'] }, { index: 1, parts: ['b'] }] }]),
  fixture(
    'OpResult',
    C.OpResultSchema,
    [
      { kind: 'parts', parts: ['hey'], splitRequested: true },
      { kind: 'variants', variants: [['hi'], ['hello', 'there'], ['hey']] },
      { kind: 'review', doc: reviewDoc, raw: '<rating>7</rating>' },
      { kind: 'recap', markdown: '**Recap**', coverage, shared: { generationRef: uuid(6) } },
      { kind: 'coach', answer: coachAnswer },
    ],
    [
      { kind: 'parts', parts: [], splitRequested: false },
      { kind: 'variants', variants: [['a'], ['b'], ['c'], ['d']] },
    ],
  ),
  fixture(
    'ServedContext',
    C.ServedContextSchema,
    [
      { source: 'archive', servedHead: null, live: { status: 'not_sent', accepted: 0, rejected: 0 } },
      {
        source: 'union',
        servedHead: { messageRef: IDS.msg1, at: ISO },
        knownFanMessages: [
          { id: IDS.msg1, state: 'included' },
          { id: IDS.msg2, state: null },
        ],
        live: { status: 'served', accepted: 3, rejected: 1 },
      },
      { source: null, servedHead: null, live: { status: null, accepted: 0, rejected: 0 } },
    ],
    [
      { source: 'live-overlay', servedHead: null, live: { status: 'served', accepted: 0, rejected: 0 } },
      { source: 'archive', servedHead: null },
      { source: 'archive', servedHead: null, live: { status: 'served', accepted: -1, rejected: 0 } },
    ],
  ),
  fixture('OpDebugView', C.OpDebugViewSchema, [debugView], [{ ...debugView, usage: { ...debugView.usage, costMicroUsd: -1 } }]),
  fixture('OpView', C.OpViewSchema, [opView, { ...opView, state: 'failed', result: undefined, error: { code: 'CG-STREAM-TRUNCATED' } }], [{ ...opView, state: 'queued' }]),

  // ── telemetry ──
  fixture(
    'AcceptanceEvent',
    C.AcceptanceEventSchema,
    [
      { clientEventId: uuid(10), kind: 'ai_acceptance', observedAt: ISO, pageLabel: 'model-one', payload: { generationRef: uuid(6), lifecycle: 'shown', opId: uuid(2), feature: 'reply', surface: 'dock' } },
      {
        clientEventId: uuid(11),
        kind: 'ai_acceptance',
        observedAt: ISO,
        pageLabel: 'model-one',
        payload: { generationRef: uuid(6), lifecycle: 'sent', edited: false, opId: uuid(2), feature: 'reply', surface: 'dock', part: 0, via: 'composer', platformMessageId: IDS.msg2 },
      },
      {
        clientEventId: uuid(12),
        kind: 'ai_acceptance',
        observedAt: ISO,
        pageLabel: 'model-one',
        payload: { generationRef: uuid(6), lifecycle: 'sent', opId: uuid(2), feature: 'hi', surface: 'newcomers', part: 0, variant: 1, via: 'preview', attemptId: uuid(5), platformMessageId: IDS.msg2 },
      },
    ],
    [
      { clientEventId: uuid(13), kind: 'ai_acceptance', observedAt: ISO, pageLabel: 'model-one', payload: { generationRef: uuid(6), lifecycle: 'sent', opId: uuid(2), feature: 'reply', surface: 'dock' } },
      {
        clientEventId: uuid(14),
        kind: 'ai_acceptance',
        observedAt: ISO,
        pageLabel: 'model-one',
        payload: { generationRef: uuid(6), lifecycle: 'sent', opId: uuid(2), feature: 'hi', surface: 'newcomers', via: 'preview', platformMessageId: IDS.msg2 },
      },
      { clientEventId: uuid(15), kind: 'ai_acceptance', observedAt: ISO, pageLabel: 'model-one', payload: { generationRef: uuid(6), lifecycle: 'shown', opId: uuid(2), feature: 'reply', surface: 'dock', via: 'composer' } },
      { clientEventId: uuid(16), kind: 'ai_acceptance', observedAt: ISO, pageLabel: 'model-one', payload: { generationRef: uuid(6), lifecycle: 'inserted', edited: true, opId: uuid(2), feature: 'reply', surface: 'dock' } },
    ],
  ),
  fixture('HealthCode', C.HealthCodeSchema, ['CG-SEND-UNCERTAIN', 'p1.insert-misplaced'], ['has space', '']),
  fixture('PerfMetric', C.PerfMetricSchema, ['insertMs', 'composerInputDelayMs'], ['memoryMb']),
  fixture(
    'PerfHistogram',
    C.PerfHistogramSchema,
    [histogram('insertMs', [5, 120, 4000]), histogram('handlerMs', [])],
    [
      { ...histogram('insertMs', [5]), bounds: [1, 2, 3] },
      { ...histogram('insertMs', [5]), counts: [1] },
      { ...histogram('insertMs', [5]), count: 2 },
      { ...histogram('insertMs', []), sum: 3 },
      { ...histogram('insertMs', [5]), schemaVersion: 2 },
    ],
  ),
  fixture(
    'ClientHealthV1',
    C.ClientHealthV1Schema,
    [clientHealth],
    [
      { ...clientHealth, perf: [histogram('insertMs', [1]), histogram('insertMs', [2])] },
      { ...clientHealth, counters: { 'has space': 1 } },
      { ...clientHealth, footprint: { kind: 'heap', cachesKB: 1, logsKB: 1 } },
    ],
  ),
  fixture('TabHealthReport', C.TabHealthReportSchema, [tabHealth, { ...tabHealth, host: null, perf: [] }], [{ ...tabHealth, footprint: { cachesKB: 1 } }]),

  // ── logs ──
  fixture('LogLevel', C.LogLevelSchema, ['warn'], ['trace']),
  fixture('LogFields', C.LogFieldsSchema, [{ textLength: 5 }], [Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`k${i}`, i]))]),
  fixture('LogRecord', C.LogRecordSchema, [logRecord, { ts: ISO, seq: 0, level: 'error', scope: 'bg', msg: 'hub down', code: 'CG-HUB-UNAVAILABLE' }], [{ ...logRecord, scope: 'Bad Scope' }, { ...logRecord, msg: '' }]),

  // ── bridge ──
  fixture('MainProbe', C.MainProbeSchema, [probe], [{ ...probe, evil: true }, { ...probe, readyStateAtStart: 'unloaded' }]),
  fixture('ContractWire', C.ContractWireSchema, [contractWire], [{ ...contractWire, missing: ['pinia'] }]),
  fixture(
    'MainSnapshot',
    C.MainSnapshotSchema,
    [{ route: routeState, hostLoginEpoch: 'login1', composer: composerState, accounts: [account], contract: contractWire }],
    [{ route: routeState, hostLoginEpoch: 'login1', composer: composerState, accounts: [account] }],
  ),
  fixture(
    'DraftWire',
    C.DraftWireSchema,
    [{ composerInstanceId: 'composer1', revision: 4, plainText: '', provenance: 'empty', digest: DIGEST }],
    [{ composerInstanceId: 'composer1', revision: 4, plainText: '', provenance: 'empty' }],
  ),
  fixture(
    'NavigationWire',
    C.NavigationWireSchema,
    [{ intentId: uuid(9), acc: IDS.acc, fan: IDS.fan, thenInsert: deferredInsert }, { intentId: uuid(9), acc: IDS.acc, fan: null }],
    [
      { intentId: uuid(9), acc: IDS.acc, fan: IDS.fan, cause },
      { intentId: uuid(9), acc: IDS.acc, fan: IDS.fan, thenInsert: insertIntent },
      { intentId: uuid(9), acc: IDS.acc, fan: IDS.fan, thenInsert: insertWire },
      { intentId: uuid(9), acc: IDS.acc, fan: null, thenInsert: deferredInsert },
      { intentId: uuid(9), acc: IDS.acc, fan: '2099', thenInsert: deferredInsert },
    ],
  ),
  fixture(
    'MainSendRequest',
    C.MainSendRequestSchema,
    [mainSend],
    [{ ...mainSend, plainText: repeat('x', 5001) }, { ...mainSend, target }, { ...mainSend, fan: '2099' }, { ...mainSend, acc: '1099' }],
  ),
  fixture('BridgeError', C.BridgeErrorSchema, ['identity-mismatch'], ['oops']),
  fixture(
    'BridgeRequest',
    C.BridgeRequestSchema,
    [
      { v: 1, kind: 'req', id: 1, t: 'probe', documentEpoch: null, seq: 0, payload: {} },
      { v: 1, kind: 'req', id: 2, t: 'insertGuarded', documentEpoch: 'doc1', seq: 1, payload: { intent: insertWire } },
    ],
    [
      { v: 1, kind: 'req', id: 1, t: 'eval', documentEpoch: null, seq: 0, payload: {} },
      { v: 1, kind: 'req', id: 1, t: 'probe', documentEpoch: null, seq: 0, payload: {}, extra: 1 },
      { v: 1, kind: 'req', id: 2, t: 'insertGuarded', documentEpoch: 'doc1', seq: 1, payload: { intent: { ...insertWire, text: '' } } },
      // MAIN gets no tokens (§14).
      { v: 1, kind: 'req', id: 2, t: 'insertGuarded', documentEpoch: 'doc1', seq: 1, payload: { intent: insertIntent } },
      { v: 1, kind: 'req', id: 0, t: 'probe', documentEpoch: null, seq: 0, payload: {} },
    ],
  ),
  fixture('BridgeRequestId', C.BridgeRequestIdSchema, [1, 2 ** 31], [0, -1, 1.5, '1']),
  fixture(
    'BridgeEventEnvelope',
    C.BridgeEventEnvelopeSchema,
    [{ v: 1, kind: 'evt', t: 'route', documentEpoch: 'doc1', seq: 0, payload: { anything: 'checked later' } }],
    [
      { v: 1, kind: 'evt', t: 'text', documentEpoch: 'doc1', seq: 0, payload: {} },
      { v: 1, kind: 'evt', t: 'route', documentEpoch: null, seq: 0, payload: {} },
    ],
  ),
  fixture(
    'BridgeResponse',
    C.BridgeResponseSchema,
    [
      { ...bridgeRes, ok: true, data: probe },
      { ...bridgeRes, ok: false, err: 'unknown-request' },
    ],
    [
      { v: 1, kind: 'res', id: 1, ok: true, data: probe },
      { ...bridgeRes, t: 'eval', ok: true, data: {} },
      { ...bridgeRes, ok: false, err: 'boom' },
    ],
  ),
  fixture(
    'BridgeEvent',
    C.BridgeEventSchema,
    [
      {
        v: 1,
        kind: 'evt',
        t: 'incoming',
        documentEpoch: 'doc1',
        seq: 3,
        payload: { acc: IDS.acc, fan: IDS.fan, msgId: IDS.msg1, fromFan: true, automatic: false, tip: false, sentAt: ISO, socketEpoch: 1, fanSequence: 4 },
      },
      { v: 1, kind: 'evt', t: 'accounts', documentEpoch: 'doc1', seq: 4, payload: {} },
    ],
    [
      { v: 1, kind: 'evt', t: 'text', documentEpoch: 'doc1', seq: 3, payload: {} },
      {
        v: 1,
        kind: 'evt',
        t: 'incoming',
        documentEpoch: 'doc1',
        seq: 3,
        payload: { acc: IDS.acc, fan: IDS.fan, msgId: IDS.msg1, fromFan: true, automatic: false, tip: false, sentAt: ISO, socketEpoch: 1, fanSequence: 4, text: 'hey' },
      },
    ],
  ),
  fixture(
    'FromMainFrame',
    C.FromMainFrameSchema,
    [
      { ...bridgeRes, ok: true, data: probe },
      { v: 1, kind: 'evt', t: 'chatCache', documentEpoch: 'doc1', seq: 9, payload: { acc: IDS.acc, fan: IDS.fan } },
    ],
    [{ v: 1, kind: 'req', id: 1, t: 'probe', documentEpoch: null, seq: 0, payload: {} }],
  ),

  // ── tab protocol ──
  fixture('SpendersPeriod', C.SpendersPeriodSchema, ['mtd', 'lifetime'], ['year']),
  fixture('BackgroundToast', C.BackgroundToastSchema, [toast, { toastId: uuid(21), kind: 'error', scope: 'hub', error: { code: 'CG-HUB-TIMEOUT' }, fanLabel: null }], [{ ...toast, kind: 'fatal' }]),
  fixture(
    'DiagnosticsSnapshot',
    C.DiagnosticsSnapshotSchema,
    [diagnostics, { ...diagnostics, hub: { ...diagnostics.hub, sdk: { vendoredHash: 'a'.repeat(64), hubHash: null, compatible: null } } }],
    [{ ...diagnostics, os: 'beos' }, { ...diagnostics, hub: { ...diagnostics.hub, sdk: { vendoredHash: 'x', hubHash: null, compatible: null } } }],
  ),
  fixture('AiQuotaSnapshot', C.AiQuotaSnapshotSchema, [quota, { ...quota, remainingRequestsToday: null, remainingMicroUsdToday: null }], [{ ...quota, remainingRequestsToday: -1 }, { ...quota, pageId: 0 }]),
  fixture('SeenHostAccount', C.SeenHostAccountSchema, [{ account, lastSeenAt: ISO }], [{ account, lastSeenAt: T0 }]),
  fixture(
    'PresenceStore',
    C.PresenceStoreSchema,
    [{ v: 1, accounts: [{ account, lastSeenAt: ISO }] }, { v: 1, accounts: [] }],
    [{ v: 2, accounts: [] }, { v: 1, accounts: Array.from({ length: 501 }, () => ({ account, lastSeenAt: ISO })) }],
  ),
  fixture('PromptSnapshotView', C.PromptSnapshotViewSchema, [promptSnapshot, { ...promptSnapshot, state: 'expired', capturedAt: null, manifest: null, blocks: [] }], [{ ...promptSnapshot, state: 'gone' }]),
  fixture(
    'SendBegin',
    C.SendBeginSchema,
    [sendBegin, { ...sendBegin, part: { index: 1 } }, { ...sendBegin, group: { ...sendBegin.group, variant: 2 }, part: { variant: 2, index: 0 } }],
    [
      { ...sendBegin, cause: undefined },
      { ...sendBegin, part: { index: 10 } },
      // The part must belong to the group: same variant (absent = 0), index below partCount.
      { ...sendBegin, part: { variant: 1, index: 0 } },
      { ...sendBegin, group: { ...sendBegin.group, variant: 1 }, part: { index: 0 } },
      { ...sendBegin, part: { variant: 0, index: 2 } },
      // The checkpoint is the target chat's and this document's.
      { ...sendBegin, checkpoint: { ...checkpoint, hostAccountId: '1099' } },
      { ...sendBegin, documentEpoch: 'doc2' },
    ],
  ),
  fixture(
    'TabRegisterRequest',
    C.TabRegisterRequestSchema,
    [{ host: 'chatspace', lateInjection: false, contractsVersion: '1.0.0' }, { host: 'fansly-web', lateInjection: true, contractsVersion: '1.1.0' }],
    [{ host: 'chatspace', lateInjection: false }, { host: 'onlyfans-web', lateInjection: false, contractsVersion: '1.0.0' }],
  ),
  fixture(
    'TabRegisterResponse',
    C.TabRegisterResponseSchema,
    [{ tabSessionId: uuid(4), contractsVersion: '1.0.0', testBuild: false }],
    [{ tabSessionId: 'tab-1', contractsVersion: '1.0.0', testBuild: false }, { tabSessionId: uuid(4), contractsVersion: '', testBuild: false }],
  ),
  fixture(
    'TabEnvelope',
    C.TabEnvelopeSchema,
    [
      { v: 1, kind: 'req', id: 1, type: 'tab.register', payload: { host: 'chatspace', lateInjection: false, contractsVersion: '1.0.0' } },
      { v: 1, kind: 'req', id: 2, type: 'op.cancel', tabSessionId: uuid(4), payload: { opId: uuid(2) } },
      { v: 1, kind: 'res', id: 2, type: 'op.cancel', ok: true, payload: { state: 'canceled' } },
      { v: 1, kind: 'res', id: 3, type: 'binding.resolve', ok: false, error: { code: 'CG-BINDING-MISSING' } },
      { v: 1, kind: 'evt', type: 'op.done', payload: {} },
    ],
    [
      { v: 1, kind: 'res', id: 3, type: 'binding.resolve', ok: false },
      { v: 1, kind: 'err', id: 3, type: 'binding.resolve', error: { code: 'CG-BINDING-MISSING' } },
      { v: 2, kind: 'evt', type: 'op.done', payload: {} },
      { v: 1, kind: 'req', type: 'op.cancel', payload: {} },
    ],
  ),

  // ── scaffold liveness ──
  fixture('TabHello', C.TabHelloSchema, [{ t: 'hello', v: 1 }], [{ t: 'hello', v: 2 }]),
  fixture('BackgroundStatus', C.BackgroundStatusSchema, [{ t: 'status', v: 1, wsTapRegistered: false, testBuild: false }], [{ t: 'status', v: 1, wsTapRegistered: false }]),

  // ── UI contract (vm) ──
  ...VM_SCHEMA_FIXTURES,

  // ── hub facade DTOs (part 2b) ──
  ...HUB_SCHEMA_FIXTURES,
];

