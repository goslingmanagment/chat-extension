// Fixtures for every message of the two runtime protocols: each tab/pages ↔
// background request (payload and response), each background event, each
// MAIN request (payload and answer) and each MAIN event.

import type { FromMainType, TabEventType, TabRequestType, ToMainType } from '../../src/index';
import {
  ACTION_TOKEN,
  DIGEST,
  IDS,
  ISO,
  T0,
  account,
  binding,
  chat,
  checkpoint,
  contractReport,
  dispatchTicket,
  hostIdentity,
  deferredInsert,
  insertIntent,
  insertWire,
  logRecord,
  opView,
  sendView,
  session,
  startReply,
  uuid,
} from './samples';
import {
  chatWindow,
  composerState,
  contractWire,
  diagnostics,
  fan,
  humanDraft,
  incomingFact,
  mainSend,
  messages,
  navItem,
  ourDraft,
  probe,
  promptSnapshot,
  quota,
  routeState,
  sendBegin,
  tabHealth,
  toast,
} from './schemas';
import { DEFAULT_SETTINGS } from '../../src/index';
import { HUB_SAMPLES as H } from './hub';

export interface Verdicts {
  readonly valid: readonly unknown[];
  readonly invalid: readonly unknown[];
}

export interface RequestFixtures {
  readonly req: Verdicts;
  readonly res: Verdicts;
}

const settingsState = { settings: DEFAULT_SETTINGS, revision: 3, readOnly: false } as const;
const ack = { valid: [{ recorded: true }], invalid: [{ recorded: 'yes' }] } as const;
const empty = { valid: [{}], invalid: [{ extra: 1 }] } as const;
const pageFan = { pageId: 11, fanRef: IDS.fan } as const;
const sendListItem = { opId: uuid(2), purpose: 'greeting', group: sendBegin.group, partIndex: 0, view: { attemptId: uuid(5), state: 'uncertain', code: 'CG-SEND-UNCERTAIN' }, updatedAt: T0 } as const;
/** A hub DTO answer: the sample and a broken copy of it. */
const dto = (valid: object, invalid: object) => ({ valid: [valid], invalid: [invalid, { any: 'shape' }] }) as const;

export const TAB_REQUEST_FIXTURES: { readonly [T in TabRequestType]: RequestFixtures } = {
  'tab.register': {
    req: { valid: [{ host: 'chatspace', lateInjection: true, contractsVersion: '1.0.0' }], invalid: [{ host: 'chatspace', lateInjection: true }] },
    res: { valid: [{ tabSessionId: uuid(4), contractsVersion: '1.0.0', testBuild: false }], invalid: [{ tabSessionId: 'tab-1', contractsVersion: '1.0.0', testBuild: false }] },
  },
  'tab.presence': {
    req: {
      valid: [{ chat, routeEpoch: 5, visible: true, focused: true }, { chat: null, routeEpoch: 0, visible: false, focused: false, accounts: [account] }],
      invalid: [{ chat, visible: true, focused: true }, { chat: null, routeEpoch: 0, visible: false, focused: false, accounts: [{ ...account, hostAccountId: 'acc' }] }],
    },
    res: ack,
  },
  'quota.get': {
    req: { valid: [{ pageId: 11 }], invalid: [{ pageId: 0 }] },
    res: { valid: [{ quota }, { quota: null }], invalid: [{ quota: { ...quota, resetsAt: T0 } }] },
  },
  'accounts.seen': {
    req: empty,
    res: { valid: [{ accounts: [{ account, lastSeenAt: ISO, openTabs: 2 }] }, { accounts: [] }], invalid: [{ accounts: [{ account, lastSeenAt: ISO }] }] },
  },
  'session.get': {
    req: empty,
    res: { valid: [{ session }, { session: null }], invalid: [{ session: { ...session, login: '' } }] },
  },
  'session.signIn': {
    req: {
      valid: [{ login: 'chatter1', password: 'synthetic-pass' }, { login: 'c'.repeat(100), password: 'p'.repeat(1024) }],
      // The hub's device-token route takes a username of up to 100 and a password of up to 1024.
      invalid: [{ login: 'chatter1', password: '' }, { login: 'c'.repeat(101), password: 'synthetic-pass' }, { login: 'chatter1', password: 'p'.repeat(1025) }],
    },
    res: { valid: [{ session }], invalid: [{ session: null }] },
  },
  'session.signOut': {
    req: empty,
    res: { valid: [{ serverRevoked: true }, { serverRevoked: null }], invalid: [{}] },
  },
  'bootstrap.get': {
    req: { valid: [{}, { force: true }], invalid: [{ force: 'yes' }] },
    res: dto(H.bootstrap, { ...H.bootstrap, flags: { insertion: 'on' } }),
  },
  'binding.resolve': {
    req: { valid: [{ account }], invalid: [{ account: { ...account, platform: 'myspace' } }] },
    res: { valid: [{ binding }], invalid: [{ binding: { ...binding, pageId: 0 } }] },
  },
  'catalog.get': {
    req: { valid: [{}], invalid: [{ force: 1 }] },
    res: dto({ personas: [H.persona] }, { personas: [{ ...H.persona, definitionId: 'short' }] }),
  },
  'persona.set': {
    req: {
      valid: [{ pageId: 11, key: 'lora', definitionId: 'pdef_0123456789abcdef' }, { pageId: 11, key: 'k'.repeat(120), definitionId: 'pdef_0123456789abcdef' }],
      invalid: [{ pageId: 11, key: 'lora' }, { pageId: 11, key: 'k'.repeat(121), definitionId: 'pdef_0123456789abcdef' }, { pageId: 11, key: 'lora', definitionId: 'def-1' }],
    },
    res: { valid: [{ revision: 4 }], invalid: [{ revision: -1 }] },
  },
  'op.start': {
    req: { valid: [startReply], invalid: [{ ...startReply, surface: 'preview' }] },
    res: { valid: [{ ok: true, opId: uuid(2) }], invalid: [{ ok: false, code: 'CG-OP-CHAT-BUSY' }] },
  },
  'op.cancel': {
    req: { valid: [{ opId: uuid(2) }], invalid: [{ opId: 'op-1' }] },
    res: { valid: [{ state: 'canceled' }], invalid: [{ state: 'stopped' }] },
  },
  'op.list': {
    req: { valid: [{ scope: 'all' }, { scope: 'tab', chatKey: 'chatspace:1001:2002' }], invalid: [{ scope: 'window' }] },
    res: {
      valid: [{ ops: [opView], truncated: false }, { ops: [], truncated: false }, { ops: Array.from({ length: 200 }, () => opView), truncated: true }],
      invalid: [{ ops: [opView] }, { ops: Array.from({ length: 201 }, () => opView), truncated: true }],
    },
  },
  'op.reportShown': {
    req: { valid: [{ opId: uuid(2) }, { opId: uuid(2), part: { index: 1 } }], invalid: [{ opId: uuid(2), part: { index: 12 } }] },
    res: ack,
  },
  'op.reportCopy': {
    req: { valid: [{ opId: uuid(2), part: { index: 0 } }], invalid: [{ part: { index: 0 } }] },
    res: ack,
  },
  'op.reportInsert': {
    req: {
      valid: [{ opId: uuid(2), part: { index: 0 }, receipt: { state: 'applied', draftRevision: 5, draftDigest: DIGEST, ms: 22 } }],
      invalid: [{ opId: uuid(2), part: { index: 0 }, receipt: { state: 'done' } }],
    },
    res: ack,
  },
  'op.reportSent': {
    req: {
      valid: [{ opId: uuid(2), part: { index: 0 }, pendingId: uuid(7), platformMessageId: IDS.msg2, edited: false }],
      invalid: [{ opId: uuid(2), part: { index: 0 }, pendingId: uuid(7), platformMessageId: null, edited: false }],
    },
    res: ack,
  },
  'send.begin': {
    req: { valid: [sendBegin], invalid: [{ ...sendBegin, attemptId: 'a1' }] },
    res: {
      valid: [{ ok: true, ticket: dispatchTicket }, { ok: false, view: { attemptId: uuid(5), state: 'held', code: 'CG-SEND-OFF' } }],
      invalid: [{ ok: true }, { ok: false, code: 'CG-SEND-OFF' }],
    },
  },
  'send.status': {
    req: { valid: [{ attemptId: uuid(5) }], invalid: [{}] },
    res: { valid: [{ view: sendView }, { view: null }], invalid: [{ view: { attemptId: uuid(5), state: 'lost' } }] },
  },
  'send.list': {
    req: { valid: [pageFan], invalid: [{ pageId: 11 }] },
    res: {
      valid: [
        { attempts: [], truncated: false },
        { attempts: [sendListItem, { ...sendListItem, resolved: 'not-sent' }], truncated: false },
      ],
      invalid: [
        { attempts: [] },
        { attempts: [{ ...sendListItem, partIndex: sendBegin.group.partCount }], truncated: false },
        { attempts: [{ ...sendListItem, text: 'Hi there' }], truncated: false },
        { attempts: Array.from({ length: 101 }, () => sendListItem), truncated: true },
      ],
    },
  },
  'send.report': {
    req: {
      valid: [
        { view: { attemptId: uuid(5), state: 'nativeEnqueued' }, pendingId: uuid(7) },
        { view: { attemptId: uuid(5), state: 'rejected', code: 'CG-SEND-GUARD', httpStatus: 422 } },
      ],
      invalid: [
        { view: { attemptId: uuid(5), state: 'rejected', code: 'CG-SEND-GUARD' }, httpStatus: 422 },
        { view: { attemptId: uuid(5), state: 'nativeEnqueued', httpStatus: 422 } },
      ],
    },
    res: ack,
  },
  'recap.status': {
    req: { valid: [{ ...pageFan, personaDefinitionId: 'pdef_0123456789abcdef' }], invalid: [pageFan] },
    res: dto(H.recapStatus, { ...H.recapStatus, extra: 1 }),
  },
  'recap.read': {
    req: { valid: [{ ...pageFan, personaDefinitionId: 'pdef_0123456789abcdef' }], invalid: [{ ...pageFan, fanRef: 2002, personaDefinitionId: 'pdef_0123456789abcdef' }] },
    res: dto(H.sharedRecaps, { ...H.sharedRecaps, fullSavedToProfile: 'no' }),
  },
  'recap.save': {
    req: {
      valid: [
        { ...pageFan, generationRef: '00000000-0000-4000-8000-000000000200' },
        { ...pageFan, generationRef: '00000000-0000-4000-8000-000000000200', opId: '00000000-0000-4000-8000-000000000100' },
      ],
      invalid: [pageFan, { ...pageFan, generationRef: 'not-a-ref' }, { ...pageFan, generationRef: '00000000-0000-4000-8000-000000000200', text: 'never the recap text' }],
    },
    res: {
      valid: [{ state: 'saved', savedAt: '2026-10-03T10:00:00.000Z' }, { state: 'not-ready', savedAt: null }, { state: 'rejected', savedAt: null }],
      invalid: [{ state: 'saved' }, { state: 'pending', savedAt: null }],
    },
  },
  'spenders.board': {
    req: { valid: [{ pageId: 11, period: '30d' }, { pageId: 11, period: 'lifetime', force: true }], invalid: [{ pageId: 11, period: 'year' }] },
    res: dto(H.spendersBoard, { ...H.spendersBoard, complete: undefined }),
  },
  'spenders.stats': {
    req: { valid: [{ pageId: 11, windowDays: 30, timeZone: 'Europe/Moscow' }], invalid: [{ pageId: 11, windowDays: 0, timeZone: 'Europe/Moscow' }, { pageId: 11, windowDays: 90, timeZone: 'Europe/Moscow' }] },
    res: dto(H.stats, { ...H.stats, moneyUnit: 'USD' }),
  },
  'spenders.queue': {
    req: { valid: [{ pageId: 11, cursor: null, limit: 50 }, { pageId: 11, cursor: 'c1', limit: 100 }], invalid: [{ pageId: 11, cursor: null, limit: 101 }] },
    res: dto(H.queuePage, { ...H.queuePage, nextCursor: '' }),
  },
  'feed.read': {
    req: {
      valid: [{ ...pageFan, cursor: null, limit: 50 }, { ...pageFan, cursor: null, limit: 50, summaryWindow: 200 }],
      invalid: [{ ...pageFan, cursor: '', limit: 50 }, { ...pageFan, cursor: null, limit: 50, summaryWindow: 4 }],
    },
    res: dto(H.feedPage, { ...H.feedPage, items: [{ ...H.feedItem, deleted: null }] }),
  },
  'fan.card': {
    req: { valid: [{ ...pageFan, period: '30d' }], invalid: [pageFan, { ...pageFan, period: 'year' }] },
    res: dto(H.spenderDetail, { ...H.spenderDetail, fan: null }),
  },
  'fan.dossier': {
    req: { valid: [pageFan], invalid: [{ pageId: 11 }] },
    res: { valid: [{ dossier: H.dossier }, { dossier: null }], invalid: [{}, { dossier: { ...H.dossier, fan: null } }] },
  },
  'newcomers.list': {
    req: { valid: [{ pageId: 11, windowHours: 48, cursor: null }], invalid: [{ pageId: 11, windowHours: 721, cursor: null }] },
    res: dto(H.audiencePage, { ...H.audiencePage, items: [{ ...H.audienceItem, fanRef: '0' }] }),
  },
  'newcomers.claim': {
    req: { valid: [{ ...pageFan, action: 'claim' }, { ...pageFan, action: 'renew' }], invalid: [{ ...pageFan, action: 'dispatch' }] },
    res: dto(H.claimState, { ...H.claimState, lease: { ...H.claimState.lease, state: 'mine' } }),
  },
  'settings.get': {
    req: empty,
    res: { valid: [settingsState], invalid: [{ ...settingsState, readOnly: 'no' }] },
  },
  'settings.open': {
    req: {
      valid: [{ route: { section: 'account', code: 'CG-AUTH-REQUIRED' } }, { route: { section: 'status' } }],
      // A route is a section of the settings and a CG code — never an address or a free string.
      invalid: [{}, { route: { section: 'billing' } }, { route: { section: 'status', code: 'CG-NOT-A-CODE' } }, { route: { section: 'status' }, url: 'options.html#status' }],
    },
    res: { valid: [{ opened: true }, { opened: false }], invalid: [{}, { opened: 'yes' }] },
  },
  'settings.patch': {
    req: {
      valid: [{ patch: { ui: { locale: 'en' } }, baseRevision: 3 }, { patch: {}, baseRevision: null }],
      // A tab cannot move the hub address or switch debug on (§14): those go through settings.patchRestricted.
      invalid: [{ patch: { ui: { locale: 'de' } }, baseRevision: 3 }, { patch: { hub: { baseUrl: 'https://evil.example.test' } }, baseRevision: 3 }, { patch: { debug: { enabled: true } }, baseRevision: 3 }],
    },
    res: { valid: [settingsState], invalid: [{ settings: DEFAULT_SETTINGS }] },
  },
  'settings.patchRestricted': {
    req: {
      valid: [{ patch: { hub: { baseUrl: 'https://hub.example.test' } }, baseRevision: 3 }, { patch: { debug: { enabled: true }, ui: { hints: false } }, baseRevision: null }],
      invalid: [{ patch: { hub: { baseUrl: 'ftp://hub.example.test' } }, baseRevision: 3 }],
    },
    res: { valid: [settingsState], invalid: [{ settings: DEFAULT_SETTINGS }] },
  },
  'log.write': {
    req: { valid: [{ records: [logRecord] }], invalid: [{ records: [] }, { records: Array.from({ length: 51 }, () => logRecord) }] },
    res: { valid: [{ accepted: 1, dropped: 0 }], invalid: [{ accepted: 1 }] },
  },
  'diagnostics.get': {
    req: empty,
    res: {
      valid: [
        diagnostics,
        { ...diagnostics, footprint: { cachesKB: 412, logsKB: 1280 } },
        { ...diagnostics, extension: { ...diagnostics.extension, updated: { at: '2026-10-03T06:02:00Z', from: '0.4.2', staleTabs: null } } },
        { ...diagnostics, extension: { ...diagnostics.extension, updated: { at: '2026-10-03T06:02:00Z', from: '0.4.2', staleTabs: 2 } } },
      ],
      invalid: [
        { ...diagnostics, extension: { version: '', contractsVersion: '1', testBuild: false } },
        { ...diagnostics, footprint: { cachesKB: -1, logsKB: 0 } },
        { ...diagnostics, extension: { ...diagnostics.extension, updated: { at: '2026-10-03T06:02:00Z', from: '0.4.2' } } },
        { ...diagnostics, extension: { ...diagnostics.extension, updated: { at: 'today', from: '0.4.2', staleTabs: 0 } } },
      ],
    },
  },
  'journal.read': {
    req: { valid: [{ journal: 'send-attempts', limit: 200 }], invalid: [{ journal: 'prompts', limit: 200 }, { journal: 'operations', limit: 501 }] },
    res: {
      valid: [{ records: [logRecord], truncated: false, runs: null }, { records: [], truncated: true, runs: [{ runId: uuid(30), startedAt: ISO, events: 120 }] }],
      invalid: [{ records: [logRecord], truncated: false }, { records: [{ ...logRecord, level: 'trace' }], truncated: false, runs: null }],
    },
  },
  'usage.get': {
    req: { valid: [{ pageId: 11, date: '2026-10-03' }, { pageId: 11, date: '2026-10-03', days: 7 }], invalid: [{ pageId: 11, date: '2026-10-03', days: 8 }, { pageId: 11, date: '2026-02-30' }] },
    res: { valid: [{ report: H.usageReport }, { report: null }], invalid: [{ report: { ...H.usageReport, moneyUnit: 'USD-mills' } }] },
  },
  'diagnostics.export': {
    req: { valid: [{ format: 'json' }, { format: 'txt' }], invalid: [{ format: 'zip' }] },
    res: {
      valid: [{ fileName: 'chatgoose-diagnostics.json', mime: 'application/json', body: '{}' }],
      invalid: [{ fileName: 'x.json', mime: 'application/zip', body: '{}' }],
    },
  },
  'sound.event': {
    req: { valid: [{ fact: incomingFact }], invalid: [{ fact: { ...incomingFact, source: 'dom' } }] },
    res: { valid: [{ played: true }, { played: false, reason: 'chat-open' }], invalid: [{ reason: 'chat-open' }] },
  },
  'data.clear': {
    req: { valid: [{ confirmed: true }], invalid: [{ confirmed: false }, {}] },
    res: { valid: [{ cleared: true }, { cleared: false }], invalid: [{ cleared: 'yes' }] },
  },
  'tab.command': {
    req: {
      valid: [{ command: { kind: 'surface', surface: 'spenders' } }, { command: { kind: 'account', host: 'chatspace', hostAccountId: IDS.acc } }],
      // A page names a surface or an account, never a chat to open or a text to send.
      invalid: [{ command: { kind: 'surface', surface: 'coach' } }, { command: { kind: 'account', host: 'chatspace', hostAccountId: 'acc' } }, { command: { kind: 'chat', fan: IDS.fan } }],
    },
    res: { valid: [{ delivered: true }, { delivered: false }], invalid: [{ delivered: 1 }] },
  },
  'sound.preview': {
    req: { valid: [{ tone: 'bell', volume: 50 }], invalid: [{ tone: 'bell', volume: 52 }] },
    res: { valid: [{ played: true }, { played: false, code: 'CG-AUDIO-BLOCKED' }], invalid: [{ played: false, code: 'CG-NOPE' }] },
  },
  'debug.prompt': {
    req: { valid: [{ token: 'prompt-token-1' }], invalid: [{ token: '' }] },
    res: { valid: [promptSnapshot], invalid: [{ ...promptSnapshot, blocks: [{ name: 'system', text: 'x' }] }] },
  },
  'health.report': {
    req: { valid: [{ report: tabHealth }], invalid: [{ report: { ...tabHealth, windowFrom: -1 } }] },
    res: ack,
  },
  'token.issue': {
    req: { valid: [{ kind: 'send', surface: 'preview' }], invalid: [{ kind: 'eval', surface: 'preview' }] },
    res: { valid: [{ actionToken: ACTION_TOKEN, expiresAt: T0 + 5000 }], invalid: [{ actionToken: 'short', expiresAt: T0 }] },
  },
  'token.redeem': {
    req: {
      valid: [{ kind: 'insert', surface: 'dock', actionToken: ACTION_TOKEN, intentId: uuid(1) }, { kind: 'navigate', surface: 'preview', actionToken: ACTION_TOKEN, intentId: uuid(9) }],
      // `generate` and `send` tokens are spent by op.start and send.begin, never redeemed here.
      invalid: [{ kind: 'send', surface: 'preview', actionToken: ACTION_TOKEN, intentId: uuid(1) }, { kind: 'insert', surface: 'dock', actionToken: ACTION_TOKEN }],
    },
    res: { valid: [{ redeemed: true }, { redeemed: false }], invalid: [{ redeemed: 'yes' }] },
  },
};

export const TAB_EVENT_FIXTURES: { readonly [T in TabEventType]: Verdicts } = {
  'op.update': {
    valid: [{ opId: uuid(2), seq: 3, append: 'hey ', state: 'streaming', phase: { name: 'streaming', since: T0 }, firstChunkAt: T0 + 900 }],
    invalid: [{ opId: uuid(2), seq: 3, append: 'hey ', state: 'streaming' }],
  },
  'op.done': { valid: [{ view: opView }], invalid: [{ view: { ...opView, opId: 'x' } }] },
  'send.state': { valid: [{ view: sendView }], invalid: [{ view: { ...sendView, state: 'done' } }] },
  toast: { valid: [{ toast }], invalid: [{ toast: { ...toast, toastId: 'x' } }] },
  'settings.changed': { valid: [settingsState], invalid: [{ ...settingsState, revision: 'r3' }] },
  'session.changed': {
    valid: [{ session, reason: 'sign-in' }, { session: null, reason: 'revoked' }],
    invalid: [{ session: null, reason: 'logout' }],
  },
  'bootstrap.changed': { valid: [{ configRevision: 9, issuedAt: ISO }], invalid: [{ configRevision: 9 }] },
  'catalog.changed': empty,
  'newcomers.changed': { valid: [{ pageId: 11 }], invalid: [{ pageId: '11' }] },
  'quota.changed': { valid: [{ quota }], invalid: [{ quota: { ...quota, observedAt: null } }, {}] },
  'flags.changed': {
    valid: [{ flags: { previewSend: false, someFutureFlag: true }, configRevision: 9 }],
    invalid: [{ flags: { previewSend: 'off' }, configRevision: 9 }],
  },
  'tab.command': {
    valid: [{ command: { kind: 'surface', surface: 'newcomers' } }, { command: { kind: 'account', host: 'chatspace', hostAccountId: IDS.acc } }],
    // The same closed set as the request: a window of ours or an account — never a chat, a text or an action token.
    invalid: [{ command: { kind: 'surface', surface: 'coach' } }, { command: { kind: 'chat', fan: IDS.fan } }, { command: { kind: 'surface', surface: 'spenders' }, actionToken: 'x'.repeat(32) }, {}],
  },
};

export interface BridgeRequestFixtures {
  readonly payload: Verdicts;
  readonly data: Verdicts;
}

const accFan = { acc: IDS.acc, fan: IDS.fan } as const;
const draftWire = { composerInstanceId: 'composer1', revision: 4, plainText: 'my draft', provenance: 'human-or-unknown', digest: DIGEST } as const;

export const BRIDGE_REQUEST_FIXTURES: { readonly [T in ToMainType]: BridgeRequestFixtures } = {
  probe: { payload: empty, data: { valid: [probe], invalid: [{ ...probe, v: 2 }] } },
  snapshot: {
    payload: empty,
    data: {
      valid: [{ route: routeState, hostLoginEpoch: null, composer: null, accounts: [], contract: contractWire }],
      invalid: [{ route: routeState, hostLoginEpoch: null, composer: null, accounts: [], contract: { ...contractWire, missing: ['nope'] } }],
    },
  },
  readDraft: { payload: { valid: [{ expected: hostIdentity }], invalid: [{}] }, data: { valid: [draftWire], invalid: [{ ...draftWire, digest: 'XYZ' }] } },
  readTail: {
    payload: { valid: [{ expected: hostIdentity, max: 60 }, { expected: hostIdentity, max: 200 }], invalid: [{ expected: hostIdentity, max: 201 }] },
    data: { valid: [{ capturedAt: ISO, messages: messages(3) }, null], invalid: [{ capturedAt: ISO, messages: messages(201) }] },
  },
  chatWindow: { payload: { valid: [{ ...accFan, max: 200 }], invalid: [{ ...accFan, max: 0 }] }, data: { valid: [chatWindow, null], invalid: [{ ...chatWindow, state: 'gone' }] } },
  fan: { payload: { valid: [accFan], invalid: [{ acc: IDS.acc }] }, data: { valid: [fan, null], invalid: [{ ...fan, chat: null }] } },
  listChats: {
    payload: { valid: [{ acc: IDS.acc, limit: 50 }], invalid: [{ acc: IDS.acc, limit: 1001 }] },
    data: { valid: [[navItem], []], invalid: [[{ ...navItem, unreadCount: -1 }]] },
  },
  listAccounts: { payload: empty, data: { valid: [[account]], invalid: [[{ ...account, hostAccountId: 'acc' }]] } },
  insertGuarded: {
    payload: {
      valid: [{ intent: insertWire }],
      invalid: [{ intent: { ...insertWire, mode: 'overwrite' } }, { intent: insertIntent }, { intent: deferredInsert }],
    },
    data: { valid: [{ state: 'applied', draftRevision: 5, draftDigest: DIGEST, ms: 8 }], invalid: [{ state: 'applied', draftRevision: 5 }] },
  },
  focus: { payload: { valid: [{ expected: hostIdentity }], invalid: [{ expected: null }] }, data: { valid: [{ focused: true }], invalid: [true] } },
  navigate: {
    payload: {
      valid: [{ intent: { intentId: uuid(9), acc: IDS.acc, fan: IDS.fan } }, { intent: { intentId: uuid(9), acc: IDS.acc, fan: IDS.fan, thenInsert: deferredInsert } }],
      invalid: [
        { intent: { intentId: uuid(9), acc: IDS.acc, fan: IDS.fan, cause: { kind: 'click', actionToken: ACTION_TOKEN } } },
        { intent: { intentId: uuid(9), acc: IDS.acc, fan: IDS.fan, thenInsert: insertWire } },
      ],
    },
    data: { valid: [{ state: 'navigated', routeEpoch: 6, insert: null }, { state: 'failed', code: 'CG-NAV-TIMEOUT', insert: null }], invalid: [{ state: 'navigated' }] },
  },
  cancelInsert: {
    payload: { valid: [{ intentId: uuid(9) }], invalid: [{ intentId: 'intent-9' }, { intentId: uuid(9), reason: 'sign-out' }] },
    data: { valid: [{ canceled: true }, { canceled: false }], invalid: [{ canceled: 'yes' }] },
  },
  checkpoint: { payload: { valid: [accFan], invalid: [{ ...accFan, fan: '0' }] }, data: { valid: [checkpoint], invalid: [{ ...checkpoint, coverage: 'maybe' }] } },
  previewSendPreflight: {
    payload: { valid: [{ req: mainSend }], invalid: [{ req: { ...mainSend, binding } }] },
    data: { valid: [{ ok: true }, { ok: false, code: 'CG-SEND-MIMIC' }], invalid: [{ ok: 'yes' }] },
  },
  previewSendCommit: {
    payload: { valid: [{ req: mainSend }], invalid: [{ req: { ...mainSend, ticket: 'ticket-1' } }] },
    data: { valid: [{ state: 'nativeEnqueued', pendingId: uuid(7) }], invalid: [{ state: 'nativeAccepted', pendingId: uuid(7) }] },
  },
  flags: {
    payload: { valid: [{ wsTap: true, previewSend: false }], invalid: [{ wsTap: true }] },
    data: { valid: [{ wsTap: true, previewSend: false }], invalid: [{ wsTap: 'on', previewSend: false }] },
  },
};

export const BRIDGE_EVENT_FIXTURES: { readonly [T in FromMainType]: Verdicts } = {
  route: { valid: [{ route: routeState, hostLoginEpoch: 'login1' }], invalid: [{ route: { ...routeState, epoch: -1 }, hostLoginEpoch: null }] },
  accounts: empty,
  composer: { valid: [{ state: composerState }, { state: null }], invalid: [{ state: { ...composerState, ready: 'yes' } }] },
  chatCache: { valid: [accFan], invalid: [{ ...accFan, fan: 2002 }] },
  contract: { valid: [contractWire], invalid: [{ ...contractWire, receiptModules: undefined }] },
  incoming: {
    valid: [{ ...accFan, msgId: IDS.msg1, fromFan: true, automatic: false, tip: true, sentAt: null, socketEpoch: 2, fanSequence: 9 }],
    invalid: [{ ...accFan, msgId: IDS.msg1, fromFan: true, automatic: false, tip: true, sentAt: null, socketEpoch: 2, fanSequence: 9, text: 'hi' }],
  },
  coverage: { valid: [{ acc: IDS.acc, state: 'unknown', reason: 'socket-closed' }], invalid: [{ acc: IDS.acc, state: 'ok' }] },
  humanSend: {
    valid: [
      { ...accFan, pendingId: uuid(7), platformMessageId: null, textDigest: DIGEST, draft: humanDraft },
      { ...accFan, pendingId: uuid(7), platformMessageId: IDS.msg2, textDigest: DIGEST, draft: ourDraft },
    ],
    invalid: [
      { ...accFan, pendingId: uuid(7), platformMessageId: null, textDigest: DIGEST, draft: humanDraft, text: 'hey' },
      // Without the draft recorded at the queue action, `sent` and `edited` would be guessed.
      { ...accFan, pendingId: uuid(7), platformMessageId: IDS.msg2, textDigest: DIGEST },
    ],
  },
  previewSendState: { valid: [{ view: sendView }], invalid: [{ view: { attemptId: uuid(5) } }] },
};

/** Valid contract samples other packages can reuse. */
export const SAMPLE_CONTRACT_REPORT = contractReport;
