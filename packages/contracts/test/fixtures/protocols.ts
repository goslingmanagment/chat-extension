// Fixtures for every message of the two runtime protocols: each tab/pages ↔
// background request (payload and response), each background event, each
// MAIN request (payload and answer) and each MAIN event.

import type { FromMainType, TabEventType, TabRequestType, ToMainType } from '../../src/index';
import {
  ACTION_TOKEN,
  DIGEST,
  FANSLY_IDS,
  IDS,
  ISO,
  T0,
  account,
  binding,
  chat,
  checkpoint,
  contractReport,
  siteContractReport,
  dispatchTicket,
  hostIdentity,
  deferredInsert,
  fanslyStartReply,
  fanslyTarget,
  insertIntent,
  insertWire,
  logRecord,
  opView,
  sendView,
  session,
  startReply,
  tabProof,
  uuid,
} from './samples';
import {
  chatWindow,
  composerState,
  contractWire,
  contractWireNotYet,
  diagnostics,
  fan,
  fanslyToast,
  humanDraft,
  incomingFact,
  mainSend,
  mediaFolder,
  mediaItem,
  messages,
  navItem,
  ourDraft,
  probe,
  promptSnapshot,
  quota,
  routeState,
  sendBegin,
  sendMedia,
  tabHealth,
  toast,
} from './schemas';
import { DEFAULT_SETTINGS } from '../../src/index';

/** 1.21.0 (X48): who sent a message, as the tab tells the background. */
const attributionFact = { chat, platformMessageId: IDS.msg2, observedAt: '2026-10-17T12:00:00.000Z', priced: false, media: false };
import { HUB_SAMPLES as H } from './hub';
import { VOICE_ALLOWANCE_FIXTURES, VOICE_SCRIPT_START_FIXTURES, fanslyVoiceSession, voiceAudio, voiceScriptStart, voiceSession } from './voice';
import { cause } from './samples';

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
/** 1.15.0 (R20 F6b): a Fansly fan and the group of the read, apart from each other. */
const fanslyPageGroup = { pageId: 13, fanRef: FANSLY_IDS.fan, conversationRef: FANSLY_IDS.group } as const;
const sendListItem = { opId: uuid(2), purpose: 'greeting', group: sendBegin.group, partIndex: 0, view: { attemptId: uuid(5), state: 'uncertain', code: 'CG-SEND-UNCERTAIN' }, updatedAt: T0 } as const;
/** 1.11.0: what trips the X8 fuse, and the fuse the background keeps (decision X25). */
const fuseFact = { attemptId: uuid(5), reason: 'text', where: 'echo', sentChars: 21, seenChars: 9 } as const;
const fuseState = { fuse: { trippedAt: T0, reason: 'text', where: 'echo', build: 'index-p8xPkCj8', attemptId: uuid(5) }, resetAt: null } as const;
/** A hub DTO answer: the sample and a broken copy of it. */
const dto = (valid: object, invalid: object) => ({ valid: [valid], invalid: [invalid, { any: 'shape' }] }) as const;

/** Chat Memory week 2: a fan's card as the hub answers it. */
const MEMORY_CARD = { pageLabel: 'model-two-fansly', fanRef: '920000000000000003', known: true, accounts: [{ platform: 'fansly', fanRef: '920000000000000003', username: 'kai_38', displayName: 'Kai', gone: false, linkedBy: null }], pages: [{ pageLabel: 'model-two-fansly', platform: 'fansly', modelName: 'Model Two', fanRef: '920000000000000003', granted: true, alias: '💵Kai/Canada/38', subscribed: true, subscribedSince: '2026-09-01T10:00:00.000Z', subscriptionEndsAt: null, spentMills: 120000, last30Mills: { tip: 20000 }, lastPurchaseAt: '2026-10-20T10:00:00.000Z' }], suggestions: [], facts: [{ id: 7, kind: 'about', text: 'Lives in Toronto, works nights', pageLabel: 'model-two-fansly', granted: true, conversationRef: '810000000000000001', messageRef: '930000000000000001', messageAt: '2026-10-20T10:00:00.000Z', source: 'ai', author: null, createdAt: '2026-10-20T10:20:00.000Z' }], serverNow: '2026-10-24T10:00:00.000Z' };

export const TAB_REQUEST_FIXTURES: { readonly [T in TabRequestType]: RequestFixtures } = {
  'tab.register': {
    req: { valid: [{ host: 'chatspace', lateInjection: true, contractsVersion: '1.0.0' }], invalid: [{ host: 'chatspace', lateInjection: true }] },
    res: { valid: [{ tabSessionId: uuid(4), contractsVersion: '1.0.0', testBuild: false }], invalid: [{ tabSessionId: 'tab-1', contractsVersion: '1.0.0', testBuild: false }] },
  },
  'tab.presence': {
    req: {
      valid: [
        { chat, routeEpoch: 5, visible: true, focused: true },
        { chat: null, routeEpoch: 0, visible: false, focused: false, accounts: [account] },
        // 1.8.0: the route's account, chat open or not; null — the route names none.
        { chat: null, routeEpoch: 2, visible: true, focused: true, accounts: [account], routeAccount: account },
        { chat, routeEpoch: 3, visible: true, focused: false, routeAccount: null },
        // 1.20.0 (X47): the open chat's fan as the tab names it; null — the tab knows no name.
        { chat, routeEpoch: 4, visible: true, focused: true, fanLabel: 'Hubert' },
        { chat, routeEpoch: 4, visible: true, focused: true, fanLabel: null },
      ],
      invalid: [
        { chat, visible: true, focused: true },
        { chat, routeEpoch: 4, visible: true, focused: true, fanLabel: 'x'.repeat(257) },
        { chat: null, routeEpoch: 0, visible: false, focused: false, accounts: [{ ...account, hostAccountId: 'acc' }] },
        { chat: null, routeEpoch: 2, visible: true, focused: true, routeAccount: { ...account, hostAccountId: 'acc' } },
        { chat: null, routeEpoch: 2, visible: true, focused: true, routeAccount: account.hostAccountId },
      ],
    },
    res: ack,
  },
  'quota.get': {
    req: { valid: [{ pageId: 11 }], invalid: [{ pageId: 0 }] },
    res: { valid: [{ quota }, { quota: null }], invalid: [{ quota: { ...quota, resetsAt: T0 } }] },
  },
  'accounts.seen': {
    req: empty,
    res: {
      valid: [{ accounts: [{ account, lastSeenAt: ISO, openTabs: 2 }] }, { accounts: [] }, { accounts: [{ account, lastSeenAt: ISO, openTabs: 2, routeTabs: 1 }] }],
      invalid: [{ accounts: [{ account, lastSeenAt: ISO }] }, { accounts: [{ account, lastSeenAt: ISO, openTabs: 2, routeTabs: -1 }] }],
    },
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
    // 1.15.0 (R20 P4b1): a Fansly start proves its freshness by its proof, never beside ChatSpace's tail.
    // 1.20.0 (X47): the fan's name as the starting surface knows it, display only.
    req: {
      valid: [startReply, fanslyStartReply, { ...startReply, fanLabel: 'Hubert' }],
      invalid: [{ ...startReply, surface: 'preview' }, { ...fanslyStartReply, fresh: startReply.fresh }, { ...startReply, fanLabel: null }, { ...startReply, fanLabel: 'x'.repeat(257) }],
    },
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
    // 1.11.0: the tab's ChatSpace build rides along (the fuse holds a build), or null when the tab knows none.
    req: { valid: [sendBegin, { ...sendBegin, hostBuild: 'index-p8xPkCj8' }, { ...sendBegin, hostBuild: null }], invalid: [{ ...sendBegin, attemptId: 'a1' }, { ...sendBegin, hostBuild: 7 }] },
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
  'send.fuse': {
    req: {
      valid: [
        { fact: fuseFact, build: 'index-p8xPkCj8' },
        { fact: { attemptId: uuid(5), reason: 'count', where: 'request' }, build: null },
      ],
      // Never a text, a reason or a place outside the vocabulary, or a fact without its attempt.
      invalid: [
        { fact: { ...fuseFact, text: 'Hi there' }, build: 'index-p8xPkCj8' },
        { fact: { ...fuseFact, reason: 'other' }, build: null },
        { fact: { ...fuseFact, where: 'dom' }, build: null },
        { fact: { reason: 'text', where: 'echo' }, build: null },
        { fact: fuseFact },
      ],
    },
    res: { valid: [fuseState, { fuse: null, resetAt: null }], invalid: [{ fuse: null }, { ...fuseState, fuse: { ...fuseState.fuse, reason: 'other' } }] },
  },
  'talk.read': {
    req: empty,
    res: {
      valid: [{ marks: [] }, { marks: [{ pageId: 3, fanRef: '700000000000000002', chatKeys: ['fansly-web:700000000000000001:700000000000000002'], names: ['Nikita'], lastSentAt: '2026-10-24T10:00:00.000Z' }] }],
      // A mark names at least one chatter, its page and fan, and its chats by key.
      invalid: [
        { marks: [{ pageId: 3, fanRef: '700000000000000002', chatKeys: [], names: [], lastSentAt: '2026-10-24T10:00:00.000Z' }] },
        { marks: [{ pageId: 3, fanRef: '700000000000000002', chatKeys: ['nikita'], names: ['Nikita'], lastSentAt: '2026-10-24T10:00:00.000Z' }] },
      ],
    },
  },
  'send.fuseState': {
    req: empty,
    res: { valid: [fuseState, { fuse: null, resetAt: T0 }], invalid: [{ fuse: { ...fuseState.fuse, trippedAt: -1 }, resetAt: null }] },
  },
  'send.fuseReset': {
    req: empty,
    res: { valid: [{ fuse: null, resetAt: T0 + 60_000 }], invalid: [{ fuse: null, resetAt: 'now' }] },
  },
  'recap.status': {
    req: {
      valid: [{ ...pageFan, personaDefinitionId: 'pdef_0123456789abcdef' }, { ...fanslyPageGroup, personaDefinitionId: 'pdef_0123456789abcdef' }],
      invalid: [pageFan, { ...fanslyPageGroup, conversationRef: '', personaDefinitionId: 'pdef_0123456789abcdef' }],
    },
    res: dto(H.recapStatus, { ...H.recapStatus, extra: 1 }),
  },
  'recap.read': {
    req: {
      valid: [{ ...pageFan, personaDefinitionId: 'pdef_0123456789abcdef' }, { ...fanslyPageGroup, personaDefinitionId: 'pdef_0123456789abcdef' }],
      invalid: [
        { ...pageFan, fanRef: 2002, personaDefinitionId: 'pdef_0123456789abcdef' },
        { ...fanslyPageGroup, conversationRef: Number(FANSLY_IDS.group), personaDefinitionId: 'pdef_0123456789abcdef' },
      ],
    },
    res: dto(H.sharedRecaps, { ...H.sharedRecaps, fullSavedToProfile: 'no' }),
  },
  'recap.save': {
    req: {
      valid: [
        { ...pageFan, generationRef: '00000000-0000-4000-8000-000000000200' },
        { ...pageFan, generationRef: '00000000-0000-4000-8000-000000000200', opId: '00000000-0000-4000-8000-000000000100' },
        { ...fanslyPageGroup, generationRef: '00000000-0000-4000-8000-000000000200', opId: '00000000-0000-4000-8000-000000000100' },
      ],
      invalid: [
        pageFan,
        { ...pageFan, generationRef: 'not-a-ref' },
        { ...pageFan, generationRef: '00000000-0000-4000-8000-000000000200', text: 'never the recap text' },
        { ...fanslyPageGroup, conversationRef: 'group', generationRef: '00000000-0000-4000-8000-000000000200' },
      ],
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
      valid: [{ ...pageFan, cursor: null, limit: 50 }, { ...pageFan, cursor: null, limit: 50, summaryWindow: 200 }, { ...fanslyPageGroup, cursor: 'c1', limit: 50 }],
      invalid: [{ ...pageFan, cursor: '', limit: 50 }, { ...pageFan, cursor: null, limit: 50, summaryWindow: 4 }, { ...fanslyPageGroup, conversationRef: '0', cursor: null, limit: 50 }],
    },
    res: dto(H.feedPage, { ...H.feedPage, items: [{ ...H.feedItem, deleted: null }] }),
  },
  'fan.card': {
    req: { valid: [{ ...pageFan, period: '30d' }], invalid: [pageFan, { ...pageFan, period: 'year' }, { ...fanslyPageGroup, period: '30d' }] },
    res: dto(H.spenderDetail, { ...H.spenderDetail, fan: null }),
  },
  'fan.dossier': {
    req: { valid: [pageFan], invalid: [{ pageId: 11 }, fanslyPageGroup] },
    res: { valid: [{ dossier: H.dossier }, { dossier: null }], invalid: [{}, { dossier: { ...H.dossier, fan: null } }] },
  },
  'fan.memory': {
    req: { valid: [pageFan], invalid: [{ pageId: 11 }] },
    res: { valid: [MEMORY_CARD], invalid: [{ ...MEMORY_CARD, facts: [{ id: 7 }] }, { ...MEMORY_CARD, known: 'yes' }] },
  },
  'fan.memory.link': {
    req: {
      valid: [{ ...pageFan, otherPlatform: 'fansly', otherFanRef: '920000000000000032', decision: 'same' }],
      // Only «same» or «different», and the other account named whole.
      invalid: [{ ...pageFan, otherPlatform: 'fansly', otherFanRef: '920000000000000032', decision: 'maybe' }, { ...pageFan, decision: 'same' }],
    },
    res: { valid: [{ decision: 'same', recorded: true, card: MEMORY_CARD }], invalid: [{ decision: 'same', recorded: true }] },
  },
  'fan.memory.fact': {
    req: {
      valid: [{ ...pageFan, factId: 7, action: 'delete' }, { ...pageFan, factId: 7, action: 'correct', text: 'Lives in Montreal' }],
      invalid: [{ ...pageFan, factId: 7, action: 'correct', text: '   ' }, { ...pageFan, factId: 7, action: 'correct', text: 'x'.repeat(501) }, { ...pageFan, factId: 0, action: 'delete' }],
    },
    res: { valid: [{ changed: true, card: MEMORY_CARD }, { changed: false, card: MEMORY_CARD }], invalid: [{ changed: true }] },
  },
  'newcomers.list': {
    req: { valid: [{ pageId: 11, windowHours: 48, cursor: null }], invalid: [{ pageId: 11, windowHours: 721, cursor: null }] },
    res: dto(H.audiencePage, { ...H.audiencePage, items: [{ ...H.audienceItem, fanRef: '0' }] }),
  },
  'newcomers.claim': {
    req: { valid: [{ ...pageFan, action: 'claim' }, { ...pageFan, action: 'renew' }], invalid: [{ ...pageFan, action: 'dispatch' }] },
    res: dto(H.claimState, { ...H.claimState, lease: { ...H.claimState.lease, state: 'mine' } }),
  },
  // 1.47.0: voice notes, both sites.
  'voice.read': {
    req: { valid: [{ pageId: 11, conversationRef: IDS.fan }, { pageId: 13, conversationRef: FANSLY_IDS.group }], invalid: [{ pageId: 11 }, { pageId: 0, conversationRef: IDS.fan }] },
    res: { valid: [{ session: voiceSession }, { session: fanslyVoiceSession }, { session: null }], invalid: [{ session: { ...voiceSession, takes: null } }, {}] },
  },
  // 1.49.0: the day's allowance; null — not known.
  'voice.allowance': {
    req: { valid: [{ pageId: 11 }, { pageId: 13 }], invalid: [{}, { pageId: 0 }, { pageId: 11, conversationRef: IDS.fan }] },
    res: { valid: [...VOICE_ALLOWANCE_FIXTURES.valid.map((allowance) => ({ allowance })), { allowance: null }], invalid: [...VOICE_ALLOWANCE_FIXTURES.invalid.map((allowance) => ({ allowance })), {}] },
  },
  'voice.script': {
    req: {
      valid: [...VOICE_SCRIPT_START_FIXTURES.valid.map((start) => ({ start, sessionId: null })), { start: voiceScriptStart, sessionId: uuid(0x700) }],
      invalid: [...VOICE_SCRIPT_START_FIXTURES.invalid.map((start) => ({ start, sessionId: null })), { start: voiceScriptStart }],
    },
    res: {
      valid: [{ ok: true, session: voiceSession }, { ok: false, error: { code: 'CG-OP-CHAT-BUSY' }, session: null }, { ok: false, error: { code: 'CG-VOICE-NOT-ALLOWED', httpStatus: 400 }, session: voiceSession }],
      invalid: [{ ok: true }, { ok: false, error: { code: 'CG-NOPE' }, session: null }],
    },
  },
  'voice.edit': {
    req: { valid: [{ sessionId: uuid(0x700), text: '[whispers] Hey you' }, { sessionId: uuid(0x700), text: '' }], invalid: [{ sessionId: uuid(0x700), text: 'я'.repeat(5001) }, { text: 'x' }] },
    res: { valid: [{ ok: true, session: voiceSession }, { ok: false, error: { code: 'CG-STORAGE-WRITE' }, session: voiceSession }], invalid: [{ ok: true, session: null }] },
  },
  'voice.take': {
    req: {
      valid: [{ sessionId: uuid(0x700), takeId: uuid(0x704), script: 'Hey you', cause }],
      invalid: [{ sessionId: uuid(0x700), takeId: 'take-1', script: 'Hey you', cause }, { sessionId: uuid(0x700), takeId: uuid(0x704), script: 'Hey you' }],
    },
    res: { valid: [{ ok: true, session: voiceSession }, { ok: false, error: { code: 'CG-VOICE-QUOTA', httpStatus: 429 }, session: voiceSession }], invalid: [{ ok: false, session: null }] },
  },
  'voice.check': {
    req: { valid: [{ sessionId: uuid(0x700), takeId: uuid(0x703), cause }], invalid: [{ sessionId: uuid(0x700), takeId: uuid(0x703) }] },
    res: { valid: [{ ok: true, session: voiceSession }], invalid: [{ ok: true, session: { ...voiceSession, revision: -1 } }] },
  },
  'voice.audio': {
    req: { valid: [{ sessionId: uuid(0x700), takeId: uuid(0x701) }], invalid: [{ sessionId: uuid(0x700) }] },
    res: {
      valid: [{ ok: true, audio: voiceAudio }, { ok: false, error: { code: 'CG-VOICE-CORRUPT' } }, { ok: false, error: { code: 'CG-VOICE-EXPIRED', httpStatus: 410 } }],
      invalid: [{ ok: true, audio: { ...voiceAudio, mime: 'audio/wav' } }, { ok: true, audio: { ...voiceAudio, base64: 'not base64!' } }, { ok: true, audio: { ...voiceAudio, bytes: 3 * 1024 * 1024 } }],
    },
  },
  'voice.attached': {
    req: { valid: [{ sessionId: uuid(0x700), takeId: uuid(0x701), state: 'attached' }, { sessionId: uuid(0x700), takeId: uuid(0x701), state: 'unknown' }], invalid: [{ sessionId: uuid(0x700), takeId: uuid(0x701), state: 'sent' }] },
    res: { valid: [{ ok: true, session: voiceSession }], invalid: [{ ok: 'yes', session: voiceSession }] },
  },
  'voice.discard': {
    req: { valid: [{ sessionId: uuid(0x700) }], invalid: [{}] },
    res: { valid: [{ discarded: true }, { discarded: false }], invalid: [{}] },
  },
  'site.access': {
    req: { valid: [{ host: 'fansly-web' }, { host: 'fansly-web', enabled: true }, { host: 'fansly-web', reload: true }], invalid: [{ host: 'other' }, { host: 'fansly-web', enabled: 'yes' }] },
    res: { valid: [{ host: 'fansly-web', enabled: true, granted: true, registered: true, waitingReload: 2 }, { host: 'fansly-web', enabled: true, granted: true, registered: true, waitingReload: 1, reloaded: 1 }], invalid: [{ host: 'fansly-web', enabled: true, granted: true, registered: true, waitingReload: -1 }, { host: 'fansly-web', enabled: true, granted: true, registered: true, waitingReload: 0, reloaded: -1 }] },
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
        // 1.11.0: the X8 fuse of the browser, tripped or never.
        { ...diagnostics, sendFuse: fuseState },
        { ...diagnostics, sendFuse: { fuse: null, resetAt: null } },
        // 1.15.0 (R20 F1): the sites' background modules.
        { ...diagnostics, hostModules: [{ host: 'chatspace', state: 'started' }] },
        { ...diagnostics, hostModules: [{ host: 'chatspace', state: 'failed' }, { host: 'fansly-web', state: 'idle' }] },
        // 1.15.0 (R20 F7): each tab names its site; a tab of another site carries that site's report.
        { ...diagnostics, tabs: [{ ...diagnostics.tabs[0], site: 'chatspace' }, { tabSessionId: uuid(5), site: 'fansly-web', host: siteContractReport, chatKey: null }] },
      ],
      invalid: [
        { ...diagnostics, sendFuse: { fuse: { ...fuseState.fuse, attemptId: 'a1' }, resetAt: null } },
        { ...diagnostics, hostModules: [{ host: 'chatspace', state: 'broken' }] },
        { ...diagnostics, hostModules: [{ host: 'onlyfans', state: 'started' }] },
        { ...diagnostics, tabs: [{ ...diagnostics.tabs[0], site: 'onlyfans' }] },
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
  // 1.20.0 (DB-022, X47): this browser's AI spend by feature; null while debug is off.
  'usage.local': {
    req: { valid: [{ days: 1 }, { days: 7 }], invalid: [{ days: 0 }, { days: 8 }, {}] },
    res: {
      valid: [
        { report: null },
        {
          report: {
            source: 'local-browser',
            fromDay: '2026-10-11',
            toDay: '2026-10-17',
            total: { runs: 3, inserts: 1, inputTokens: 6824, outputTokens: 286, cacheReadTokens: 6000, cacheWriteTokens: 0, costMicroUsd: 28_600, approximate: false, cacheShare: 0.47 },
            byFeature: [{ feature: 'reply', runs: 3, inserts: 1, inputTokens: 6824, outputTokens: 286, cacheReadTokens: 6000, cacheWriteTokens: 0, costMicroUsd: 28_600, approximate: false, cacheShare: 0.47 }],
          },
        },
      ],
      invalid: [
        { report: { source: 'hub', fromDay: '2026-10-17', toDay: '2026-10-17', total: {}, byFeature: [] } },
        { report: { source: 'local-browser', fromDay: 'today', toDay: '2026-10-17', total: { runs: 0, inserts: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costMicroUsd: 0, approximate: false, cacheShare: null }, byFeature: [] } },
        { report: { source: 'local-browser', fromDay: '2026-10-17', toDay: '2026-10-17', total: { runs: 0, inserts: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costMicroUsd: 0, approximate: false, cacheShare: 2 }, byFeature: [] } },
      ],
    },
  },
  // 1.20.0 (DB-027, X47): «Аккаунт → Дополнительно»; the key's display prefix, never the secret.
  'account.advanced': {
    req: { valid: [{}], invalid: [{ token: true }] },
    res: {
      valid: [
        { info: null },
        { info: { signIn: { key: 'agh_dev_Zx81kQ', issuedAt: ISO, expiresAt: null }, hosts: [{ host: 'chatspace', build: 'index-p8xPkCj8', contractOk: true }], app: '0.3.1 · Firefox 158 · macos' } },
        { info: { signIn: null, hosts: [], app: '0.3.1 · Firefox · other' } },
      ],
      invalid: [
        { info: { signIn: { key: 'agh', issuedAt: 'yesterday', expiresAt: null }, hosts: [], app: 'x' } },
        { info: { signIn: null, hosts: [{ host: 'onlyfans', build: null, contractOk: null }], app: 'x' } },
      ],
    },
  },
  // 1.20.0 (X47): the names the tabs already know, by chat.
  'fans.labels': {
    req: { valid: [{}], invalid: [{ chatKey: 'chatspace:1001:2002' }] },
    res: {
      valid: [{ fans: [] }, { fans: [{ chatKey: 'chatspace:1001:2002', label: 'Hubert' }] }],
      invalid: [{ fans: [{ chatKey: 'chatspace:1001:2002', label: 'x'.repeat(257) }] }, { fans: [{ chatKey: 'not a key', label: 'Hubert' }] }],
    },
  },
  'diagnostics.export': {
    req: { valid: [{ format: 'json' }, { format: 'txt' }, { format: 'txt', site: 'chatspace' }], invalid: [{ format: 'zip' }, { format: 'txt', site: 'onlyfans' }] },
    res: {
      valid: [{ fileName: 'chatgoose-diagnostics.json', mime: 'application/json', body: '{}' }],
      invalid: [{ fileName: 'x.json', mime: 'application/zip', body: '{}' }],
    },
  },
  'sound.event': {
    req: { valid: [{ fact: incomingFact }], invalid: [{ fact: { ...incomingFact, source: 'dom' } }] },
    res: { valid: [{ played: true }, { played: false, reason: 'chat-open' }], invalid: [{ reason: 'chat-open' }] },
  },
  'attribution.report': {
    req: {
      valid: [{ fact: attributionFact }, { fact: { ...attributionFact, priced: true, media: true } }],
      // Ids, a time and two marks: never a text, never a person (the hub reads the person from the token), always an id.
      invalid: [{ fact: { ...attributionFact, text: 'hey' } }, { fact: { ...attributionFact, userId: 7 } }, { fact: { ...attributionFact, platformMessageId: null } }, { fact: { ...attributionFact, observedAt: 'now' } }],
    },
    res: { valid: [{ queued: true }, { queued: false, reason: 'not_admitted' }], invalid: [{ queued: 'yes' }, { reason: 'not_admitted' }] },
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
  'debug.open': {
    // The opaque token of a prompt snapshot and nothing else: no address, no page name.
    req: { valid: [{ token: 'prompt-token-1' }], invalid: [{}, { token: '' }, { token: 'prompt-token-1', url: 'debug-prompt.html?t=prompt-token-1' }, { token: 'x'.repeat(129) }] },
    res: { valid: [{ opened: true }, { opened: false }], invalid: [{}, { opened: 'yes' }] },
  },
  'health.report': {
    req: { valid: [{ report: tabHealth }], invalid: [{ report: { ...tabHealth, windowFrom: -1 } }] },
    res: ack,
  },
  'token.issue': {
    req: {
      // 1.39.0 (X68): `deferred` — the Fix's own write, asked for when it is done; only ever `true`.
      valid: [{ kind: 'send', surface: 'preview' }, { kind: 'insert', surface: 'dock', deferred: true }],
      invalid: [{ kind: 'eval', surface: 'preview' }, { kind: 'insert', surface: 'dock', deferred: false }],
    },
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
  'talk.changed': {
    valid: [{ marks: [] }, { marks: [{ pageId: 3, fanRef: '74001002', chatKeys: ['chatspace:910101:74001002'], names: ['Nikita', 'Ivan'], lastSentAt: '2026-10-24T10:00:00.000Z' }] }],
    invalid: [
      { marks: [{ pageId: 3, fanRef: '74001002', chatKeys: ['chatspace:910101:74001002'], names: ['Nikita'], lastSentAt: 'now' }] },
      { marks: [{ pageId: 3, fanRef: '74001002', chatKeys: ['chatspace:910101:74001002'], names: ['Nikita'], lastSentAt: '2026-10-24T10:00:00.000Z', isMe: false }] },
    ],
  },
  'op.update': {
    valid: [{ opId: uuid(2), seq: 3, append: 'hey ', state: 'streaming', phase: { name: 'streaming', since: T0 }, firstChunkAt: T0 + 900 }],
    invalid: [{ opId: uuid(2), seq: 3, append: 'hey ', state: 'streaming' }],
  },
  'voice.changed': {
    valid: [{ chat, conversationRef: IDS.fan, session: voiceSession }, { chat, conversationRef: IDS.fan, session: null }],
    invalid: [{ chat, session: voiceSession }, { chat, conversationRef: IDS.fan, session: { ...voiceSession, sessionId: 'x' } }],
  },
  'op.done': {
    valid: [
      { view: opView },
      // 1.15.0 (R20 P4b1): the hub's answers to a window check, and the verdict's mark.
      {
        view: {
          ...opView,
          target: fanslyTarget,
          servedContext: {
            source: 'live_union',
            servedHead: null,
            live: { status: 'served', accepted: 2, rejected: 0 },
            coverageCheck: { window: tabProof.window.map((entry) => ({ id: entry.id, state: 'included' })), deleted: [{ id: tabProof.deletedIds[0], state: 'absent' }] },
          },
          stale: { reason: 'window-miss', at: null },
        },
      },
    ],
    invalid: [{ view: { ...opView, opId: 'x' } }, { view: { ...opView, stale: { reason: 'stale', at: null } } }],
  },
  'send.state': { valid: [{ view: sendView }], invalid: [{ view: { ...sendView, state: 'done' } }] },
  'send.fuse': { valid: [fuseState, { fuse: null, resetAt: T0 }], invalid: [{ fuse: { ...fuseState.fuse, build: 7 }, resetAt: null }, {}] },
  toast: { valid: [{ toast }, { toast: fanslyToast }], invalid: [{ toast: { ...toast, toastId: 'x' } }, { toast: { ...fanslyToast, conversationRef: '' } }] },
  'settings.changed': { valid: [settingsState], invalid: [{ ...settingsState, revision: 'r3' }] },
  'session.changed': {
    valid: [{ session, reason: 'sign-in' }, { session: null, reason: 'revoked' }],
    invalid: [{ session: null, reason: 'logout' }],
  },
  'bootstrap.changed': { valid: [{ configRevision: 9, issuedAt: ISO }], invalid: [{ configRevision: 9 }] },
  'catalog.changed': empty,
  // 1.20.0 (X47): a nudge only; the names come with `fans.labels`.
  'fans.changed': empty,
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
const openChatPaid = {
  platformMessageId: '9002',
  direction: 'model',
  sentAt: ISO,
  text: 'just for you',
  price: 25,
  isFree: false,
  isOpened: true,
  mediaCount: 2,
  tip: false,
  automatic: false,
} as const;
const openChatPage = {
  capturedAt: ISO,
  items: [{ ...openChatPaid, platformMessageId: '9003', direction: 'fan', text: 'wow', price: null, isFree: null, isOpened: null, mediaCount: 0 }, openChatPaid],
  hasMore: true,
  cursor: '9002',
} as const;
const draftWire = { composerInstanceId: 'composer1', revision: 4, plainText: 'my draft', provenance: 'human-or-unknown', digest: DIGEST } as const;
const attachWire = { intentId: uuid(11), expected: hostIdentity, file: { name: `${uuid(12)}.mp3`, type: 'audio/mpeg', bytes: new ArrayBuffer(16) } } as const;

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
    payload: {
      valid: [{ req: mainSend }, { req: { ...mainSend, media: sendMedia } }],
      invalid: [
        { req: { ...mainSend, binding } },
        // 1.30.0 (X53): a price below OnlyFans' $3, a free preview of a free message, a medium twice.
        { req: { ...mainSend, media: { ...sendMedia, priceCents: 299 } } },
        { req: { ...mainSend, media: { ...sendMedia, priceCents: 0 } } },
        { req: { ...mainSend, media: { ...sendMedia, items: [sendMedia.items[1], sendMedia.items[1]] } } },
      ],
    },
    data: { valid: [{ ok: true }, { ok: false, code: 'CG-SEND-MIMIC' }], invalid: [{ ok: 'yes' }] },
  },
  previewSendCommit: {
    payload: {
      valid: [{ req: mainSend }, { req: { ...mainSend, media: sendMedia } }],
      invalid: [{ req: { ...mainSend, ticket: 'ticket-1' } }, { req: { ...mainSend, media: { ...sendMedia, items: sendMedia.items.map((item) => ({ ...item, free: true })) } } }],
    },
    data: { valid: [{ state: 'nativeEnqueued', pendingId: uuid(7) }], invalid: [{ state: 'nativeAccepted', pendingId: uuid(7) }] },
  },
  flags: {
    payload: { valid: [{ wsTap: true, previewSend: false }, { wsTap: true, previewSend: false, attribution: true }], invalid: [{ wsTap: true }, { wsTap: true, previewSend: false, attribution: 'on' }] },
    data: { valid: [{ wsTap: true, previewSend: false }, { wsTap: true, previewSend: false, attribution: false }], invalid: [{ wsTap: 'on', previewSend: false }] },
  },
  // 1.22.0 (X54): the open chat's messages from the host's API; a failed request is an answer, not an error.
  openChatMessages: {
    payload: {
      valid: [{ ...accFan, limit: 50 }, { ...accFan, limit: 100, cursor: '9001' }],
      invalid: [{ ...accFan, limit: 0 }, { ...accFan, limit: 101 }, { ...accFan, limit: 50, cursor: 'oldest' }, { acc: IDS.acc, limit: 50 }],
    },
    data: {
      valid: [
        { ok: true, page: openChatPage },
        { ok: true, page: { capturedAt: ISO, items: [], hasMore: false, cursor: null } },
        { ok: false, failure: 'http', status: 429 },
        { ok: false, failure: 'session', status: null },
      ],
      invalid: [
        { ok: true, page: { ...openChatPage, items: [{ ...openChatPaid, price: 0 }] } },
        { ok: true, page: { ...openChatPage, items: [{ ...openChatPaid, direction: 'creator' }] } },
        { ok: true, page: { ...openChatPage, items: [{ ...openChatPaid, mediaCount: -1 }] } },
        { ok: false, failure: 'not-open', status: null },
        { ok: false, failure: 'http', status: 42 },
        { ok: true },
      ],
    },
  },
  // The open chat as the page has it loaded: a page or null, never a failure of a request.
  cachedChatMessages: {
    payload: {
      valid: [{ ...accFan, limit: 50 }, { ...accFan, limit: 1 }],
      invalid: [{ ...accFan, limit: 0 }, { ...accFan, limit: 101 }, { ...accFan, limit: 50, cursor: '9001' }, { acc: IDS.acc, limit: 50 }],
    },
    data: {
      valid: [openChatPage, { capturedAt: ISO, items: [], hasMore: null, cursor: null }, null],
      invalid: [{ ok: true, page: openChatPage }, { ...openChatPage, items: [{ ...openChatPaid, price: 0 }] }, { ok: false, failure: 'session', status: null }],
    },
  },
  // 1.30.0 (X53): the media picker's reads from the host's API; a failed request is an answer, not an error.
  media: {
    payload: {
      valid: [
        { of: 'folders', acc: IDS.acc, offset: 0 },
        { of: 'items', acc: IDS.acc, folder: 'all', offset: 40 },
        { of: 'items', acc: IDS.acc, folder: '880001', offset: 0 },
        { of: 'states', acc: IDS.acc, fan: IDS.fan, ids: ['660000155', '660000154'] },
        { of: 'tags', acc: IDS.acc, ids: ['660000155'] },
      ],
      invalid: [
        { of: 'folders', acc: IDS.acc, offset: -1 },
        { of: 'items', acc: IDS.acc, folder: 'favorites', offset: 0 },
        { of: 'states', acc: IDS.acc, ids: ['660000155'] },
        { of: 'tags', acc: IDS.acc, ids: [] },
        { of: 'tags', acc: IDS.acc, ids: ['123456789012345678'] },
        { of: 'history', acc: IDS.acc, fan: IDS.fan },
      ],
    },
    data: {
      valid: [
        { ok: true, value: { items: [mediaFolder], hasMore: true } },
        { ok: true, value: { items: [mediaItem], hasMore: false } },
        { ok: true, value: [{ id: '660000155', state: 'paid', priceCents: 1500 }] },
        { ok: true, value: { users: ['77'], guests: [] } },
        { ok: false, failure: 'account', status: null },
        { ok: false, failure: 'http', status: 400 },
      ],
      invalid: [
        { ok: true, value: { items: [{ ...mediaItem, thumb: 'http://cdn.example/x.jpg' }], hasMore: false } },
        { ok: true, value: [{ id: '660000155', state: 'unsent', priceCents: null }] },
        { ok: false, failure: 'not-open', status: null },
      ],
    },
  },
  // Whether the fan read the chat's newest message: the host's chat list searched by the fan's username.
  chatReadState: {
    payload: { valid: [{ ...accFan, username: 'dhruva9.2' }], invalid: [{ ...accFan, username: '' }, { ...accFan, username: 'x'.repeat(101) }, { acc: IDS.acc, username: 'dhruva9.2' }] },
    data: {
      valid: [
        { ok: true, last: { messageId: IDS.msg2, direction: 'model', sentAt: ISO, read: false, readAt: null } },
        { ok: true, last: { messageId: IDS.msg2, direction: 'fan', sentAt: null, read: null, readAt: null } },
        { ok: true, last: null },
        { ok: false, failure: 'http', status: 429 },
      ],
      invalid: [{ ok: true, last: { messageId: IDS.msg2, direction: 'creator', sentAt: ISO, read: true, readAt: null } }, { ok: false, failure: 'not-open', status: null }, { ok: true }],
    },
  },
  // 1.47.0: a file of ours dropped on the open chat's composer; MAIN answers what the composer showed of it.
  attachFile: {
    payload: {
      valid: [attachWire],
      invalid: [
        // MAIN gets no token; the page reads the name, which never names the extension.
        { ...attachWire, cause: { kind: 'click', actionToken: ACTION_TOKEN } },
        { ...attachWire, file: { ...attachWire.file, name: 'chatgoose-voice.mp3' } },
        { ...attachWire, file: { ...attachWire.file, type: 'audio/wav' } },
        // The bytes themselves, never an empty file or a copy of their shape.
        { ...attachWire, file: { ...attachWire.file, bytes: new ArrayBuffer(0) } },
        { ...attachWire, file: { ...attachWire.file, bytes: new Uint8Array(16) } },
      ],
    },
    data: {
      valid: [{ state: 'attached', ms: 2400 }, { state: 'refused', reason: 'permission' }, { state: 'not-attached', reason: 'site-refused' }, { state: 'unknown' }],
      // ChatSpace's upload has no window the person closes; a refusal is one of the vocabulary's.
      invalid: [{ state: 'not-attached', reason: 'dismissed' }, { state: 'refused', reason: 'gif' }, { state: 'attached' }, { state: 'unknown', reason: 'timeout' }],
    },
  },
};

export const BRIDGE_EVENT_FIXTURES: { readonly [T in FromMainType]: Verdicts } = {
  route: { valid: [{ route: routeState, hostLoginEpoch: 'login1' }], invalid: [{ route: { ...routeState, epoch: -1 }, hostLoginEpoch: null }] },
  accounts: empty,
  composer: { valid: [{ state: composerState }, { state: null }], invalid: [{ state: { ...composerState, ready: 'yes' } }] },
  chatCache: { valid: [accFan], invalid: [{ ...accFan, fan: 2002 }] },
  contract: { valid: [contractWire, contractWireNotYet], invalid: [{ ...contractWire, receiptModules: undefined }, { ...contractWire, notYet: ['nope'] }] },
  incoming: {
    valid: [{ ...accFan, msgId: IDS.msg1, fromFan: true, automatic: false, tip: true, sentAt: null, socketEpoch: 2, fanSequence: 9 }],
    invalid: [{ ...accFan, msgId: IDS.msg1, fromFan: true, automatic: false, tip: true, sentAt: null, socketEpoch: 2, fanSequence: 9, text: 'hi' }],
  },
  coverage: { valid: [{ acc: IDS.acc, state: 'unknown', reason: 'socket-closed' }], invalid: [{ acc: IDS.acc, state: 'ok' }] },
  humanSend: {
    valid: [
      { ...accFan, pendingId: uuid(7), platformMessageId: null, textDigest: DIGEST, draft: humanDraft },
      { ...accFan, pendingId: uuid(7), platformMessageId: IDS.msg2, textDigest: DIGEST, draft: ourDraft },
      // 1.21.0 (X48): a PPV the person sent themselves, its id from its own response.
      { ...accFan, pendingId: uuid(7), platformMessageId: IDS.msg2, textDigest: DIGEST, draft: humanDraft, cargo: { priced: true, media: true } },
    ],
    invalid: [
      { ...accFan, pendingId: uuid(7), platformMessageId: null, textDigest: DIGEST, draft: humanDraft, text: 'hey' },
      // Marks only: never the price.
      { ...accFan, pendingId: uuid(7), platformMessageId: IDS.msg2, textDigest: DIGEST, draft: humanDraft, cargo: { priced: 25, media: true } },
      // Without the draft recorded at the queue action, `sent` and `edited` would be guessed.
      { ...accFan, pendingId: uuid(7), platformMessageId: IDS.msg2, textDigest: DIGEST },
    ],
  },
  previewSendState: { valid: [{ view: sendView }], invalid: [{ view: { attemptId: uuid(5) } }] },
  previewSendFuse: {
    valid: [fuseFact, { attemptId: uuid(5), reason: 'target', where: 'echo' }, { attemptId: uuid(5), reason: 'count', where: 'queue' }],
    // Never a text; only the vocabulary's reasons and places; lengths are counts.
    invalid: [{ ...fuseFact, seen: 'Hi there' }, { ...fuseFact, reason: 'texts' }, { ...fuseFact, sentChars: -1 }, { reason: 'text', where: 'echo' }],
  },
  fault: {
    valid: [
      { source: 'route', count: 1 },
      { source: 'cacheAfter', count: 64 },
    ],
    // Not a machine token (it would reach the logs as is), no failure at all, an extra key.
    invalid: [{ source: 'route change', count: 1 }, { source: 'route', count: 0 }, { source: 'route', count: 2, stack: 'at x' }],
  },
};

/** Valid contract samples other packages can reuse. */
export const SAMPLE_CONTRACT_REPORT = contractReport;
