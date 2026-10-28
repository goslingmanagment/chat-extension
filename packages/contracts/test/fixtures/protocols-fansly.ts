// Fixtures of fansly.com's own tab protocol (1.15.0, R20 P4a3): each request
// (payload and response) and each event of `tab-messages-fansly.ts`, the
// `settings.ext` key and a Fansly failure on the wire. Synthetic 18-digit ids
// (FANSLY_IDS); the conversation is the group, never the fan.

import { FANSLY_RELAY_TARGET, FANSLY_TAB_LIMITS, type FanslyTabEventType, type FanslyTabRequestType } from '../../src/tab-messages-fansly';
import type { RequestFixtures, Verdicts } from './protocols';
import { FANSLY_IDS, ISO, T0, cause, uuid } from './samples';
import { FANSLY_START_OP_FIXTURES, FANSLY_OP_VIEW_FIXTURES, fanslyNotesView } from './ops-fansly';
import { FANSLY_GREETING_REQUEST_FIXTURES, FANSLY_SEND_VIEW_FIXTURES } from './send-fansly';
import { FANSLY_MSG, passStartProof } from './fansly';

const F = FANSLY_IDS;
const ack = { valid: [{ recorded: true }, { recorded: false }], invalid: [{ recorded: 'yes' }, {}] } as const;
/** P13b review: another open tab holds the album — nothing kept; a held write that says it was kept is no answer. */
const vaultAck = { valid: [...ack.valid, { recorded: false, held: true }, { recorded: true, held: false }], invalid: [...ack.invalid, { recorded: true, held: true }, { recorded: false, held: 'yes' }] } as const;

/** A Fansly failure in a payload: a Fansly code and a shared one are both readable; an unknown code is not. */
const failure = { ok: false, error: { code: 'CG-FAN-RATE-LIMIT', retryAt: T0 + 60_000, httpStatus: 429 } } as const;
const sharedFailure = { ok: false, error: { code: 'CG-NETWORK' } } as const;
const unknownFailure = { ok: false, error: { code: 'CG-FAN-01' } } as const;
/** `settings.ext` as the settings page reads it (R20 P14b1). */
const extState = {
  ext: { v: 1, hosts: { 'fansly-web': { enabled: true, viaTab: false, notesView: 'drawer', sound: { messagesTone: 'chime', subscribersTone: 'double' } }, 'telegram-web': { enabled: false } }, windows: { deep: null } },
  revision: 2,
  readOnly: false,
} as const;

/** R20 P10c: the pass's proof of a checked fan's history, ids only. */
const greetingProof = {
  groupId: F.group,
  historyRevision: uuid(0x501),
  window: [{ id: FANSLY_MSG.m1, dir: 'model' }, { id: FANSLY_MSG.m2, dir: 'fan' }],
  knownFanMessageIds: [FANSLY_MSG.m2],
  startProof: passStartProof,
  fanAvatarUrl: 'https://cdn3.fansly.com/avatar/1.jpeg?Key-Pair-Id=K&Policy=P&Signature=S',
} as const;
const greetingSent = {
  passId: uuid(301),
  hostAccountId: F.creator,
  fanRef: F.fan,
  groupId: F.group,
  platformMessageId: '700000000000000050',
  text: 'Привет!',
  admission: { kind: 'own' },
} as const;
const greetingGeneration = { opId: uuid(0xc1), generationRef: uuid(0x601), text: 'Привет!', historyRevision: uuid(0x501), mark: 'unverified' } as const;

export const fanslyPass = {
  passId: uuid(301),
  hostAccountId: F.creator,
  windowHours: 48,
  state: 'queue',
  startedAt: ISO,
  counts: { total: 120, checked: 40, ready: 31, greeted: 5, dmClosed: 2, excluded: 1 },
  partial: false,
  cooldownUntil: null,
  error: null,
} as const;

export const fanslyRow = {
  fanRef: F.fan,
  groupId: F.group,
  username: 'fan_one',
  displayName: 'Fan One',
  followedAt: ISO,
  status: 'ready',
  dmClosed: null,
  historyRevision: uuid(302),
  checkedAt: ISO,
} as const;

/** P10a: what the «Новые» window shows of a row — the person's name for the fan, the about, «Ждёт ответа», the proof, the failure. */
export const fanslyRowShown = {
  ...fanslyRow,
  customName: 'Алекс',
  bio: 'NYC · gym',
  fanWrote: true,
  proof: { messageId: '700000000000000041', fromFan: false, at: ISO, text: 'hey ❤️', automated: false, attachments: 0 },
  error: null,
} as const;

export const fanslyNote = { noteId: '700000000000000010', title: 'Анкета', text: 'Имя: Алекс\nЛокация: ', foreign: false } as const;
export const vaultCheckpoint = {
  hostAccountId: F.creator,
  albumId: '700000000000000020',
  uploadId: uuid(310),
  files: [
    { name: 'a.jpg', size: 1000, lastModified: T0 },
    { name: 'b.jpg', size: 2000, lastModified: T0 },
  ],
  confirmed: 1,
  pending: { index: 1, passedAt: T0 + 1000 },
  updatedAt: T0 + 1000,
} as const;
const passRef = { passId: uuid(301) } as const;
const followersQuery = { search: '@fan_one', tab: 'todo', filter: 'ready' } as const;
const followersCounts = { tabs: { todo: 1, all: 2 }, filters: { any: 1, ready: 1, pending: 0, reply: 0, unchecked: 0, 'dm-closed': 0, contacted: 0 } } as const;
const noteTarget = { pageId: 12, hostAccountId: F.creator, fanRef: F.fan } as const;

export const FANSLY_TAB_REQUEST_FIXTURES: { readonly [T in FanslyTabRequestType]: RequestFixtures } = {
  'fansly.ops.start': {
    req: FANSLY_START_OP_FIXTURES,
    res: { valid: [{ ok: true, opId: uuid(0x550) }, { ok: false, code: 'CG-OP-CHAT-BUSY', active: [], siteActive: [{ opId: uuid(0x550), feature: 'notes-fill', surface: 'dock', chat: fanslyNotesView.target.chat, fanLabel: null, state: 'streaming', startedAt: T0, inThisTab: true }] }], invalid: [{ ok: true }, { ok: false, code: 'wrong', active: [] }] },
  },
  'fansly.ops.read': { req: { valid: [{ opId: uuid(0x550) }], invalid: [{ opId: 'x' }] }, res: { valid: [{ view: fanslyNotesView }, { view: null }], invalid: [{ view: {} }] } },
  'fansly.ops.list': { req: { valid: [{}], invalid: [{ chatKey: 'x' }] }, res: { valid: [{ ops: [fanslyNotesView], truncated: false }], invalid: [{ ops: [{}], truncated: false }] } },
  'fansly.ops.cancel': { req: { valid: [{ opId: uuid(0x550) }], invalid: [{}] }, res: { valid: [{ state: 'canceled' }, { state: null }], invalid: [{ state: 'queued' }] } },
  'fansly.spenders.names': {
    req: { valid: [{ hostAccountId: F.creator, fanRefs: [F.fan] }], invalid: [{ hostAccountId: F.creator, fanRefs: [] }, { hostAccountId: F.creator, fanRefs: [123] }] },
    res: { valid: [{ ok: true, names: [{ fanRef: F.fan, name: 'Alias', displayName: 'Fan', username: 'fan' }] }, failure], invalid: [{ ok: true, names: [{ fanRef: 123, name: 'Fan', username: null }] }, unknownFailure] },
  },
  'fansly.spenders.resolve': {
    req: { valid: [{ hostAccountId: F.creator, fanRef: F.fan, displayName: 'Fan', username: null }], invalid: [{ hostAccountId: F.creator, fanRef: 123, displayName: null, username: null }, { fanRef: F.fan }] },
    res: { valid: [{ ok: true, groupId: F.group }, { ok: true, groupId: null }, failure], invalid: [{ ok: true, groupId: Number(F.group) }, unknownFailure] },
  },
  'fansly.spenders.copied': {
    req: { valid: [{ hostAccountId: F.creator, ids: ['700000000000000011', '700000000000000012'] }], invalid: [{ hostAccountId: F.creator, ids: [] }, { hostAccountId: F.creator, ids: [11] }, { hostAccountId: F.creator, ids: Array.from({ length: FANSLY_TAB_LIMITS.copiedCheckMax + 1 }, () => '700000000000000011') }] },
    res: { valid: [{ ok: true, bundleIds: ['700000000000000011'] }, { ok: true, bundleIds: [] }, failure], invalid: [{ ok: true }, { ok: true, bundleIds: [11] }, unknownFailure] },
  },
  'fansly.spenders.outreach': {
    req: {
      valid: [
        { hostAccountId: F.creator, fanRef: F.fan, groupId: F.group, text: 'hey you 😳\n\nnew video is up', attachments: [{ contentType: 2, contentId: '700000000000000011' }, { contentType: 1, contentId: '700000000000000012' }], cause },
        { hostAccountId: F.creator, fanRef: F.fan, groupId: F.group, text: 'hey', attachments: [], cause },
      ],
      invalid: [
        { hostAccountId: F.creator, fanRef: F.fan, groupId: F.group, text: ' hey ', attachments: [], cause },
        { hostAccountId: F.creator, fanRef: F.fan, groupId: F.group, text: 'hey', attachments: [{ contentType: 3, contentId: '700000000000000011' }], cause },
        { hostAccountId: F.creator, fanRef: F.fan, groupId: F.group, text: 'hey', attachments: [{ contentType: 2, contentId: 11 }], cause },
        { hostAccountId: F.creator, fanRef: F.fan, groupId: F.group, text: 'hey', attachments: Array.from({ length: FANSLY_TAB_LIMITS.outreachAttachmentsMax + 1 }, () => ({ contentType: 2, contentId: '700000000000000011' })), cause },
        { hostAccountId: F.creator, fanRef: F.fan, groupId: F.group, text: 'hey', attachments: [] },
      ],
    },
    res: { valid: [{ ok: true, messageId: '700000000000000013' }, failure, { ok: false, error: { code: 'CG-SEND-UNCERTAIN' } }], invalid: [{ ok: true }, { ok: true, messageId: 1 }, unknownFailure] },
  },
  'fansly.ppv.read': {
    req: {
      valid: [{ hostAccountId: F.creator, fanRef: F.fan, groupId: F.group }, { hostAccountId: F.creator, fanRef: F.fan, groupId: F.group, ppv: false, photos: true }],
      invalid: [{ hostAccountId: F.creator, fanRef: F.fan }, { hostAccountId: F.creator, fanRef: 123, groupId: F.group }, { hostAccountId: F.creator, fanRef: F.fan, groupId: F.group, photos: 'yes' }],
    },
    res: {
      valid: [
        { ok: true, capturedAt: '2026-10-20T12:00:00.000Z', items: [] },
        { ok: true, capturedAt: '2026-10-20T12:00:00.000Z', items: [], photos: [{ platformMessageId: F.group, sentAt: '2026-10-20T11:59:00.000Z', mediaId: F.fan, url: 'https://cdn3.fansly.com/1/2.jpeg?ngsw-bypass=true&Policy=P&Key-Pair-Id=K&Signature=S' }] },
        { ok: true, capturedAt: '2026-10-20T12:00:00.000Z', items: [{ platformMessageId: F.group, contentKind: 'media', contentRef: F.fan, priceUsd: 20, purchased: false }, { platformMessageId: F.group, contentKind: 'bundle', contentRef: F.creator, purchased: true }] },
        failure,
      ],
      invalid: [
        { ok: true, items: [] },
        { ok: true, capturedAt: '2026-10-20T12:00:00.000Z', items: [{ platformMessageId: F.group, priceUsd: 20, purchased: true }] },
        // A photo off Fansly's CDN.
        { ok: true, capturedAt: '2026-10-20T12:00:00.000Z', items: [], photos: [{ platformMessageId: F.group, sentAt: '2026-10-20T11:59:00.000Z', mediaId: F.fan, url: 'https://evil.example/2.jpeg' }] },
        unknownFailure,
      ],
    },
  },
  'fansly.preview.readState': {
    req: { valid: [{ pageId: 12, hostAccountId: F.creator, fanRef: F.fan, groupId: F.group }], invalid: [{ pageId: 12, hostAccountId: F.creator, fanRef: F.fan }, { pageId: 12, hostAccountId: F.creator, fanRef: F.fan, groupId: 123 }] },
    res: {
      valid: [{ ok: true, last: { messageId: F.group, direction: 'model', sentAt: '2026-10-20T12:00:00.000Z', read: true, readAt: '2026-10-20T12:05:00.000Z' } }, { ok: true, last: null }, failure],
      invalid: [{ ok: true, last: { messageId: F.group, direction: 'model', sentAt: null, read: 'yes', readAt: null } }, { ok: true }, unknownFailure],
    },
  },
  'fansly.fans.badges': {
    req: {
      valid: [{ pageId: 12, hostAccountId: F.creator, fanRefs: [F.fan] }],
      invalid: [{ pageId: 12, hostAccountId: F.creator, fanRefs: [] }, { pageId: 12, hostAccountId: F.creator, fanRefs: ['x'] }, { pageId: 12, hostAccountId: F.creator }],
    },
    res: {
      valid: [
        { ok: true, fans: [{ fanRef: F.fan, recentSpender: true, tier: 'gold' }], fbuddy: 'on' },
        { ok: true, fans: [{ fanRef: F.fan, recentSpender: null, tier: null }], fbuddy: 'off' },
        failure,
        sharedFailure,
      ],
      invalid: [{ ok: true, fans: [{ fanRef: F.fan, recentSpender: true, tier: 'diamond' }], fbuddy: 'on' }, { ok: true, fans: [], fbuddy: 'maybe' }, { ok: true, fans: [] }, unknownFailure],
    },
  },
  'fansly.online.seen': {
    req: { valid: [{ pageId: 12, hostAccountId: F.creator }], invalid: [{ pageId: 12 }, { pageId: 12, hostAccountId: 123 }, { pageId: 12, hostAccountId: F.creator, lastSeenAfter: '0' }] },
    res: {
      valid: [{ ok: true, seen: 7, recorded: 6 }, { ok: true, seen: 0, recorded: 0 }, failure, sharedFailure],
      invalid: [{ ok: true, seen: 7 }, { ok: true, seen: -1, recorded: 0 }, { ok: true, seen: 7, recorded: 6, fans: [F.fan] }, unknownFailure],
    },
  },
  'fansly.marks.read': {
    req: {
      valid: [{ pageId: 12, hostAccountId: F.creator, fanRef: F.fan, username: 'stand_fan_1' }, { pageId: 12, hostAccountId: F.creator, fanRef: F.fan }],
      invalid: [{ pageId: 12, hostAccountId: F.creator }, { pageId: 12, hostAccountId: F.creator, fanRef: F.fan, username: '' }, { pageId: 12, hostAccountId: F.creator, fanRef: F.fan, pageLabel: 'p' }],
    },
    res: {
      valid: [
        {
          ok: true,
          marks: {
            lists: [{ here: true, name: 'Model Two', label: '💩 Бомж', since: '2026-10-20T12:00:00.000Z' }, { here: false, name: 'Model One', label: '💩 Бомж', since: null }],
            blocklist: [{ postedAt: '2026-10-20T12:00:00.000Z', text: 'https://fansly.com/stand_fan_1\nDNP + TM', author: 'agency', link: 'https://t.me/c/1716498488/1201', handle: 'stand_fan_1' }],
          },
        },
        { ok: true, marks: { lists: [], blocklist: [] } },
        failure,
        sharedFailure,
      ],
      invalid: [
        // A link off Telegram never reaches a tab.
        { ok: true, marks: { lists: [], blocklist: [{ postedAt: '2026-10-20T12:00:00.000Z', text: 'x', author: null, link: 'javascript:alert(1)', handle: 'x' }] } },
        { ok: true, marks: { lists: [{ here: true, name: 'Model Two', label: '💩 Бомж' }], blocklist: [] } },
        { ok: true, lists: [], blocklist: [] },
        unknownFailure,
      ],
    },
  },
  'fansly.registration.read': {
    req: { valid: [{ pageId: 12, hostAccountId: F.creator, groupId: F.group }], invalid: [{ pageId: 12, hostAccountId: F.creator }, { pageId: 12, hostAccountId: F.creator, groupId: 123 }] },
    res: { valid: [{ ok: true, fanId: F.fan }, failure, sharedFailure], invalid: [{ ok: true, fanId: 123 }, { ok: true, groupId: F.group }, unknownFailure] },
  },
  'fansly.followers.scan': {
    // 1.34.0 (X59): null — the period the browser remembers; a missing one is still no request.
    req: { valid: [{ hostAccountId: F.creator, windowHours: 48 }, { hostAccountId: F.creator, windowHours: 720 }, { hostAccountId: F.creator, windowHours: null }], invalid: [{ hostAccountId: F.creator, windowHours: 721 }, { hostAccountId: F.creator, windowHours: 0 }, { windowHours: 48 }, { hostAccountId: F.creator }] },
    res: { valid: [{ ok: true, pass: fanslyPass }, failure, sharedFailure], invalid: [{ ok: true, pass: { ...fanslyPass, state: 'running' } }, unknownFailure, { pass: fanslyPass }] },
  },
  'fansly.followers.pause': {
    req: { valid: [passRef], invalid: [{ passId: 'pass-1' }] },
    res: { valid: [{ pass: { ...fanslyPass, state: 'paused' } }, { pass: null }], invalid: [{ pass: { ...fanslyPass, cooldownUntil: -1 } }, {}] },
  },
  'fansly.followers.resume': {
    req: { valid: [passRef], invalid: [{ ...passRef, force: true }] },
    res: { valid: [{ ok: true, pass: fanslyPass }, { ok: false, error: { code: 'CG-FNEW-ACCOUNT' } }], invalid: [{ ok: true }, { ok: false, error: { code: 'CG-API-02' } }] },
  },
  'fansly.followers.read': {
    req: {
      valid: [{ ...passRef, offset: 0, limit: 500 }, { ...passRef, offset: 100, limit: 100, query: followersQuery }],
      invalid: [
        { ...passRef, offset: 0, limit: 501 }, { ...passRef, offset: -1, limit: 10 },
        ...[{ ...followersQuery, tab: 'other' }, { ...followersQuery, filter: 'other' }, { ...followersQuery, search: 'x'.repeat(201) }].map((query) => ({ ...passRef, offset: 0, limit: 100, query })),
      ],
    },
    res: {
      valid: [
        { pass: fanslyPass, rows: [fanslyRow, { ...fanslyRow, fanRef: '700000000000000005', groupId: null, status: 'dm-closed', dmClosed: 'paid', historyRevision: null, checkedAt: null }], total: 2 },
        { pass: null, rows: [], total: 0 },
        // P10b2: the paid-DM price is optional; null is unknown, never a guessed zero.
        ...[1700, null].map((dmPriceMills) => ({ pass: fanslyPass, rows: [{ ...fanslyRow, status: 'dm-closed', dmClosed: 'paid', dmPriceMills }], total: 1 })),
        { pass: fanslyPass, rows: [fanslyRow], total: 1, counts: followersCounts, seq: 7 },
        // P10a: the window's fields of a row, the fast part's phase, the change the snapshot holds.
        { pass: { ...fanslyPass, state: 'scanning', phase: 'profiles' }, rows: [fanslyRowShown, { ...fanslyRow, status: 'failed', historyRevision: null, error: { code: 'CG-FAN-REQUEST', httpStatus: 500 } }], total: 2, seq: 7 },
        // 1.34.0 (X59): the fan's picture — a Fansly address, or none.
        ...['https://cdn3.fansly.com/avatar/1.jpeg?Key-Pair-Id=K1&Policy=p&Signature=s', null].map((avatarUrl) => ({ pass: fanslyPass, rows: [{ ...fanslyRow, avatarUrl }], total: 1 })),
      ],
      // A row whose conversation is not an id, and one whose status is not in the list.
      invalid: [
        { pass: fanslyPass, rows: [{ ...fanslyRow, groupId: 'group-1' }], total: 1 },
        { pass: fanslyPass, rows: [{ ...fanslyRow, status: 'sent' }], total: 1 },
        ...[-1, 1.7, '1700'].map((dmPriceMills) => ({ pass: fanslyPass, rows: [{ ...fanslyRow, dmPriceMills }], total: 1 })),
        // P10a: a phase the pass does not have, a proof without its automation mark, a failure of no registry, a negative change.
        { pass: { ...fanslyPass, phase: 'notes' }, rows: [], total: 0 },
        { pass: fanslyPass, rows: [{ ...fanslyRowShown, proof: { messageId: '700000000000000041', fromFan: false, at: ISO, text: 'hey', attachments: 0 } }], total: 1 },
        { pass: fanslyPass, rows: [{ ...fanslyRow, error: { code: 'CG-FAN-01' } }], total: 1 },
        // 1.34.0: a picture of another site, or not https, is never shown.
        ...['https://evil.example/a.jpg', 'http://cdn3.fansly.com/a.jpg'].map((avatarUrl) => ({ pass: fanslyPass, rows: [{ ...fanslyRow, avatarUrl }], total: 1 })),
        { pass: fanslyPass, rows: [], total: 0, seq: -1 },
        { pass: fanslyPass, rows: [], total: 0, counts: { ...followersCounts, tabs: { todo: -1, all: 2 } } },
        { pass: fanslyPass, rows: [], total: 0, counts: { ...followersCounts, filters: { any: 0 } } },
      ],
    },
  },
  'fansly.followers.prioritize': { req: { valid: [{ ...passRef, fanRef: F.fan }], invalid: [{ ...passRef, fanRef: '0' }] }, res: ack },
  'fansly.followers.exclude': { req: { valid: [{ ...passRef, fanRef: F.fan, excluded: true }], invalid: [{ ...passRef, fanRef: F.fan }] }, res: ack },
  'fansly.followers.history': {
    req: { valid: [{ ...passRef, fanRef: F.fan, before: null, limit: 250 }, { ...passRef, fanRef: F.fan, before: '700000000000000030', limit: 50 }], invalid: [{ ...passRef, fanRef: F.fan, before: null, limit: 251 }] },
    res: {
      valid: [{ ok: true, messages: [{ messageId: '700000000000000031', fromFan: true, at: ISO, text: 'hi', automated: false, attachments: 0 }], more: true }, failure],
      invalid: [{ ok: true, messages: [{ messageId: '700000000000000031', fromFan: true, at: ISO, text: 'hi', attachments: 0 }], more: false }],
    },
  },
  'fansly.followers.close': { req: { valid: [passRef], invalid: [{}] }, res: ack },
  'fansly.followers.send': {
    req: FANSLY_GREETING_REQUEST_FIXTURES,
    res: {
      valid: [...FANSLY_SEND_VIEW_FIXTURES.valid.map((attempt) => ({ ok: true, attempt })), failure, sharedFailure],
      invalid: [...FANSLY_SEND_VIEW_FIXTURES.invalid.slice(0, 4).map((attempt) => ({ ok: true, attempt })), unknownFailure, { ok: true }],
    },
  },

  // R20 P10c: the pass's proof for «Сгенерировать», the card's draft, the person's own send of the card's text.
  'fansly.followers.proof': {
    req: { valid: [{ ...passRef, fanRef: F.fan }], invalid: [{ ...passRef }, { ...passRef, fanRef: F.fan, groupId: F.group }] },
    res: {
      valid: [{ ok: true, proof: greetingProof }, { ok: true, proof: { ...greetingProof, capturedAt: ISO, tail: [{ platformMessageId: FANSLY_MSG.m2, direction: 'fan', sentAt: ISO, text: 'hello' }] } }, { ok: true, proof: { ...greetingProof, fanAvatarUrl: null, knownFanMessageIds: [] } }, failure],
      invalid: [
        { ok: true, proof: { ...greetingProof, fanAvatarUrl: 'https://example.com/a.jpg' } },
        { ok: true, proof: { ...greetingProof, groupId: F.otherGroup } },
        { ok: true, proof: { ...greetingProof, knownFanMessageIds: [FANSLY_MSG.m1] } },
        { ok: true, proof: { ...greetingProof, startProof: { ...passStartProof, source: 'tab-short-page' } } },
        { ok: true, proof: { ...greetingProof, text: 'hi' } },
        { ok: true, proof: { ...greetingProof, tail: [{ platformMessageId: FANSLY_MSG.m2, direction: 'model', sentAt: ISO, text: 'wrong side' }] } },
      ],
    },
  },
  // 1.62.0: the card's Hi reads the fan's history again while it generates; the toast's Hi from a tab of another model.
  'fansly.followers.recheck': {
    req: { valid: [{ ...passRef, fanRef: F.fan }], invalid: [{ ...passRef }, { ...passRef, fanRef: 'fan' }] },
    res: { valid: [{ ok: true, historyRevision: uuid(0x501) }, { ok: false, error: { code: 'CG-SEND-PART' } }, failure], invalid: [{ ok: true }, { ok: true, historyRevision: 'rev' }] },
  },
  'fansly.greet.handover': {
    req: { valid: [{ pageId: 11, fanRef: F.fan, cause }], invalid: [{ pageId: 11, fanRef: F.fan }, { pageId: '11', fanRef: F.fan, cause }, { pageId: 11, fanRef: F.fan, cause: { kind: 'timer', actionToken: cause.actionToken } }] },
    res: { valid: [{ delivered: true }, { delivered: false }], invalid: [{ delivered: 'yes' }, {}] },
  },
  'fansly.followers.draft': {
    req: { valid: [{ ...passRef, fanRef: F.fan }, { ...passRef, fanRef: F.fan, text: '' }, { ...passRef, fanRef: F.fan, text: 'x'.repeat(5000) }, { ...passRef, fanRef: F.fan, text: 'Привет!', generation: { opId: greetingGeneration.opId, historyRevision: greetingGeneration.historyRevision } }], invalid: [{ ...passRef, fanRef: F.fan, text: 'x'.repeat(5001) }, { ...passRef, fanRef: F.fan, text: null }, { ...passRef, fanRef: F.fan, text: 'Привет!', generation: { opId: 'bad-id', historyRevision: uuid(0x501) } }] },
    res: {
      valid: [{ ok: true, draft: { text: 'Привет!', revision: 3, historyRevision: uuid(0x501) } }, { ok: true, draft: { text: '', revision: 0, historyRevision: null } }, { ok: true, draft: { text: 'Привет!', revision: 3, historyRevision: uuid(0x501), generation: greetingGeneration, attempt: { attemptId: uuid(0xa1), fanRef: F.fan, state: 'uncertain', code: 'CG-SEND-UNCERTAIN', cause: 'network' } } }, failure],
      invalid: [{ ok: true, draft: { text: 'Привет!', revision: -1, historyRevision: null } }, { ok: true, draft: { text: 'Привет!', revision: 1 } }, { ok: true, draft: { text: 'Привет!', revision: 3, historyRevision: uuid(0x501), generation: { ...greetingGeneration, mark: 'fresh' } } }],
    },
  },
  // 2026-10-22: the newest greeting attempt of each fan of the pass's creator, for the list's status.
  'fansly.followers.outcomes': {
    req: { valid: [passRef], invalid: [{}, { ...passRef, fanRef: F.fan }] },
    res: {
      valid: [{ ok: true, attempts: [] }, { ok: true, attempts: FANSLY_SEND_VIEW_FIXTURES.valid.slice(0, 2) }, failure],
      invalid: [{ ok: true }, { ok: true, attempts: [FANSLY_SEND_VIEW_FIXTURES.invalid[0]] }, unknownFailure],
    },
  },
  'fansly.followers.sent': {
    req: {
      valid: [greetingSent, { ...greetingSent, admission: { kind: 'ai', generationRef: uuid(0x601), variant: 0 } }],
      invalid: [{ ...greetingSent, text: ' Привет' }, { ...greetingSent, text: '' }, { ...greetingSent, platformMessageId: 'msg-1' }, { ...greetingSent, admission: { kind: 'ai' } }],
    },
    res: ack,
  },

  'fansly.notes.read': {
    // P11b: the fan unknown to MAIN (`fanRef: null`) — the background reads the group; a target without its page is refused.
    req: { valid: [{ ...noteTarget, groupId: F.group }, { ...noteTarget, groupId: null, force: true }, { ...noteTarget, fanRef: null, groupId: F.group }], invalid: [{ ...noteTarget }, { fanRef: F.fan, groupId: F.group }, { hostAccountId: F.creator, fanRef: F.fan, groupId: F.group }] },
    res: {
      valid: [
        { ok: true, fanRef: F.fan, notes: [fanslyNote, { ...fanslyNote, noteId: '700000000000000011', title: 'FBuddy Notes', foreign: true }], customName: { noteId: '700000000000000012', name: 'Алекс' }, readAt: ISO },
        { ok: true, fanRef: F.fan, notes: [], customName: null, readAt: ISO },
        // 1.16.0 (R20 P11b2, decision 171): when each note was created, ms; null — Fansly gave none.
        { ok: true, fanRef: F.fan, notes: [{ ...fanslyNote, createdAtMs: 1_790_790_855_000 }, { ...fanslyNote, noteId: '700000000000000011', createdAtMs: null }], customName: null, readAt: ISO },
        { ok: false, error: { code: 'CG-NOTE-READ' } },
      ],
      invalid: [
        { ok: true, fanRef: F.fan, notes: [{ ...fanslyNote, createdAtMs: 0 }], customName: null, readAt: ISO },
        { ok: true, fanRef: F.fan, notes: [{ ...fanslyNote, createdAtMs: 1.5 }], customName: null, readAt: ISO },
        { ok: true, fanRef: F.fan, notes: [{ ...fanslyNote, createdAtMs: '1790790855' }], customName: null, readAt: ISO },
        { ok: true, fanRef: F.fan, notes: [{ ...fanslyNote, text: 'x'.repeat(50_001) }], customName: null, readAt: ISO }, { ok: true, fanRef: F.fan, notes: [], readAt: ISO }, { ok: true, notes: [], customName: null, readAt: ISO }],
    },
  },
  'fansly.notes.create': {
    req: { valid: [{ ...noteTarget, title: 'Анкета', text: 'Имя: ' }, { ...noteTarget, title: '', text: 'x'.repeat(50_000) }], invalid: [{ ...noteTarget, title: 't'.repeat(1001), text: '' }, { ...noteTarget, title: '', text: 'x'.repeat(50_001) }] },
    res: { valid: [{ ok: true, note: fanslyNote }, { ok: false, error: { code: 'CG-NOTE-UNCERTAIN' } }], invalid: [{ ok: true, note: { ...fanslyNote, foreign: 'no' } }] },
  },
  'fansly.notes.edit': {
    req: {
      valid: [{ ...noteTarget, noteId: fanslyNote.noteId, title: 'Анкета', text: 'Имя: Алекс' }, { ...noteTarget, noteId: fanslyNote.noteId, title: 'Анкета', text: 'Имя: Алекс', current: { title: fanslyNote.title, text: fanslyNote.text } }],
      invalid: [{ ...noteTarget, title: 'Анкета', text: 'Имя: Алекс' }, { ...noteTarget, noteId: fanslyNote.noteId, title: '', text: '', current: { title: '' } }, { ...noteTarget, noteId: fanslyNote.noteId, title: '', text: '', current: { title: '', text: 'x'.repeat(50_001) } }],
    },
    res: { valid: [{ ok: true, note: fanslyNote }, { ok: false, error: { code: 'CG-NOTE-WRITE' } }], invalid: [{ ok: true, note: null }] },
  },
  'fansly.notes.delete': {
    req: { valid: [{ ...noteTarget, noteId: fanslyNote.noteId, title: fanslyNote.title, text: fanslyNote.text }], invalid: [{ ...noteTarget, noteId: 'note-1', title: '', text: '' }, { ...noteTarget, noteId: fanslyNote.noteId }] },
    res: { valid: [{ ok: true }, { ok: false, error: { code: 'CG-FAN-EXPIRED' } }], invalid: [{ ok: true, deleted: 1 }] },
  },
  'fansly.notes.name': {
    req: {
      valid: [{ ...noteTarget, name: 'Алекс', current: null }, { ...noteTarget, name: '', current: { noteId: '700000000000000012', name: 'Алекс' } }],
      invalid: [{ ...noteTarget, name: 'n'.repeat(1001), current: null }, { ...noteTarget, name: 'Алекс' }],
    },
    res: { valid: [{ ok: true, customName: { noteId: '700000000000000012', name: 'Алекс' } }, { ok: true, customName: null }], invalid: [{ ok: true }] },
  },
  'fansly.notes.view': { req: { valid: [{}], invalid: [{ view: 'docked' }] }, res: { valid: [{ view: 'docked' }, { view: 'drawer' }, { view: 'center' }], invalid: [{ view: 'left' }, {}] } },
  'fansly.notes.setView': { req: { valid: [{ view: 'center' }], invalid: [{ view: 'left' }, {}] }, res: { valid: [{ view: 'drawer' }], invalid: [{ view: null }] } },

  'fansly.vault.checkpoint': {
    req: {
      valid: [{ checkpoint: vaultCheckpoint }, { checkpoint: { ...vaultCheckpoint, confirmed: 2, pending: null } }],
      // More confirmed files than files; a pending file already confirmed; no files at all.
      invalid: [{ checkpoint: { ...vaultCheckpoint, confirmed: 3, pending: null } }, { checkpoint: { ...vaultCheckpoint, pending: { index: 0, passedAt: T0 } } }, { checkpoint: { ...vaultCheckpoint, files: [], confirmed: 0, pending: null } }],
    },
    res: vaultAck,
  },
  'fansly.sound.batch': {
    req: {
      valid: [{ host: 'fansly-web', hostAccountId: '1001', events: [{ kind: 'subscriber', id: '9001', accountId: '1001', followerId: '2002' }] }],
      invalid: [{ host: 'fansly-web', hostAccountId: '1001', events: [] }, { host: 'fansly-web', hostAccountId: '1001', events: [{ kind: 'subscriber', id: '9001', accountId: '1001', followerId: '2002', text: 'never' }] }],
    },
    res: { valid: [{ recorded: true }], invalid: [{ recorded: 'yes' }] },
  },
  'fansly.vault.resume': {
    req: { valid: [{ hostAccountId: F.creator, albumId: vaultCheckpoint.albumId }], invalid: [{ albumId: vaultCheckpoint.albumId }] },
    res: {
      valid: [{ checkpoint: vaultCheckpoint }, { checkpoint: null }, { checkpoint: vaultCheckpoint, held: true }],
      invalid: [{ checkpoint: { ...vaultCheckpoint, uploadId: 'up-1' } }, { checkpoint: null, held: 'yes' }],
    },
  },
  'fansly.vault.clear': {
    req: { valid: [{ hostAccountId: F.creator, albumId: vaultCheckpoint.albumId, uploadId: uuid(310) }], invalid: [{ hostAccountId: F.creator, albumId: vaultCheckpoint.albumId }] },
    res: vaultAck,
  },

  'fansly.relay.hello': {
    req: {
      valid: [{ hostAccountId: F.creator, relayId: uuid(340) }],
      // No id of its own; an account that is no id.
      invalid: [{ hostAccountId: F.creator }, { hostAccountId: 'creator', relayId: uuid(340) }],
    },
    res: ack,
  },
  'fansly.relay.head': {
    req: {
      valid: [{ requestId: uuid(330), status: 429, headers: [['retry-after', '30']] }, { requestId: uuid(330), status: 200, headers: [] }],
      // A status out of range; a header name that is not lower-case.
      invalid: [{ requestId: uuid(330), status: 99, headers: [] }, { requestId: uuid(330), status: 200, headers: [['Content-Type', 'application/json']] }],
    },
    res: ack,
  },
  'fansly.relay.body': {
    req: { valid: [{ requestId: uuid(330), body: '{"success":true,"response":[]}' }], invalid: [{ requestId: uuid(330) }] },
    res: ack,
  },
  'fansly.relay.failure': {
    req: { valid: [{ requestId: uuid(330), reason: 'refused' }, { requestId: uuid(330), reason: 'aborted' }], invalid: [{ requestId: uuid(330), reason: 'timeout' }] },
    res: ack,
  },

  // R20 P8c: a Fansly tab's deep start asks for the person's depth above 3000 alone.
  'fansly.settings.windows': { req: { valid: [{}], invalid: [{ deep: 4000 }] }, res: { valid: [{ deep: null }, { deep: 5000 }], invalid: [{ deep: 3000 }, { deep: 5001 }, {}] } },

  // R20 P14b1: the settings page.
  'fansly.settings.read': { req: { valid: [{}], invalid: [{ host: 'fansly-web' }] }, res: { valid: [extState], invalid: [{ ...extState, revision: -1 }, { ext: extState.ext, revision: 1 }] } },
  'fansly.settings.write': {
    req: {
      valid: [{ patch: { hosts: { 'fansly-web': { viaTab: true } } } }, { patch: { hosts: { 'fansly-web': { sound: { subscribersTone: 'bell' } } }, windows: { deep: 4000 } } }, { patch: { windows: { deep: null } } }],
      // «Fansly включён» goes through site.access; the view of «Заметки» is their panel's; a depth v1 holds.
      invalid: [{ patch: { hosts: { 'fansly-web': { enabled: true } } } }, { patch: { hosts: { 'fansly-web': { notesView: 'center' } } } }, { patch: { windows: { deep: 3000 } } }, {}],
    },
    res: { valid: [extState, { ...extState, readOnly: true }], invalid: [{ ...extState, ext: { ...extState.ext, windows: { deep: 3000 } } }] },
  },
  'fansly.accounts.read': {
    req: { valid: [{}], invalid: [{ tabs: true }] },
    res: {
      valid: [
        { sessions: [{ legacyId: F.creator, canonicalId: F.creator, tabs: 1, observedAt: T0 }, { legacyId: '700000000000000009', canonicalId: null, tabs: 0, observedAt: T0 - 60_000 }], openTabs: 2, unattributedTabs: 1 },
        { sessions: [], openTabs: null, unattributedTabs: null },
      ],
      // A session header never crosses; an id that is not a native id; more sessions than the background keeps.
      invalid: [
        { sessions: [{ legacyId: F.creator, canonicalId: null, tabs: 1, observedAt: T0, authorization: 'x' }], openTabs: 1, unattributedTabs: 0 },
        { sessions: [{ legacyId: '0', canonicalId: null, tabs: 1, observedAt: T0 }], openTabs: 1, unattributedTabs: 0 },
        { sessions: Array.from({ length: 129 }, () => ({ legacyId: F.creator, canonicalId: null, tabs: 0, observedAt: T0 })), openTabs: 0, unattributedTabs: 0 },
      ],
    },
  },
  'fansly.accounts.focus': { req: { valid: [{ hostAccountId: F.creator }], invalid: [{ hostAccountId: 'creator' }, {}] }, res: { valid: [{ focused: true }, { focused: false }], invalid: [{ focused: 'yes' }] } },
};

export const FANSLY_TAB_EVENT_FIXTURES: { readonly [T in FanslyTabEventType]: Verdicts } = {
  'fansly.ops.done': { valid: FANSLY_OP_VIEW_FIXTURES.valid.map((view) => ({ view })), invalid: FANSLY_OP_VIEW_FIXTURES.invalid.map((view) => ({ view })) },
  'fansly.notes.viewChanged': { valid: [{ view: 'docked' }], invalid: [{ view: 'left' }, { view: 'drawer', text: 'never' }] },
  'fansly.followers.changed': {
    valid: [{ pass: fanslyPass, seq: 3, rows: [fanslyRow] }, { pass: { ...fanslyPass, state: 'cooldown', cooldownUntil: T0 + 30_000 }, seq: 4, rows: [] }],
    invalid: [{ pass: fanslyPass, seq: 3, rows: Array.from({ length: 101 }, () => fanslyRow) }, { pass: fanslyPass, rows: [] }],
  },
  'fansly.relay.fetch': {
    valid: [
      { requestId: uuid(330), method: 'GET', url: 'https://apiv3.fansly.com/api/v1/account/me?ngsw-bypass=true', headers: [['authorization', 'x']], expect: { hostAccountId: F.creator } },
      { requestId: uuid(331), method: 'POST', url: 'https://apiv3.fansly.com/api/v1/notes?ngsw-bypass=true', headers: [], body: '{}', expect: { hostAccountId: F.creator } },
      { requestId: uuid(332), method: 'GET', url: 'https://apiv3.fansly.com/api/v1/group/1?ngsw-bypass=true', headers: [], expect: { hostAccountId: F.creator, relayId: uuid(340) } },
      { requestId: uuid(333), method: 'GET', url: FANSLY_RELAY_TARGET + 'x'.repeat(FANSLY_TAB_LIMITS.relayRequestUrlMaxChars - FANSLY_RELAY_TARGET.length), headers: [], expect: { hostAccountId: F.creator } },
    ],
    // Any other address, even of Fansly; a method we never use; no expectation for the frame's own check.
    invalid: [
      { requestId: uuid(330), method: 'GET', url: 'https://fansly.com/api/v1/account/me', headers: [], expect: { hostAccountId: F.creator } },
      { requestId: uuid(330), method: 'DELETE', url: 'https://apiv3.fansly.com/api/v1/notes', headers: [], expect: { hostAccountId: F.creator } },
      { requestId: uuid(330), method: 'GET', url: 'https://apiv3.fansly.com/api/v1/account/me', headers: [] },
      { requestId: uuid(330), method: 'GET', url: 'https://apiv3.fansly.com/api/v1/account/me', headers: [], expect: { hostAccountId: F.creator, relayId: 'frame-1' } },
      { requestId: uuid(333), method: 'GET', url: FANSLY_RELAY_TARGET + 'x'.repeat(FANSLY_TAB_LIMITS.relayRequestUrlMaxChars - FANSLY_RELAY_TARGET.length + 1), headers: [], expect: { hostAccountId: F.creator } },
    ],
  },
  'fansly.relay.abort': { valid: [{ requestId: uuid(330) }], invalid: [{ requestId: 'r1' }] },
  'fansly.relay.open': { valid: [{}], invalid: [{ hostAccountId: F.creator }, null] },
};

/** `settings.ext` as this build reads it: the view, the patch, the state (contracts settings-ext.ts). */
export const SETTINGS_EXT_FIXTURES = {
  view: {
    valid: [
      { v: 1, hosts: { 'fansly-web': { enabled: true, viaTab: false, notesView: 'docked', sound: { messagesTone: 'chime', subscribersTone: 'double' } }, 'telegram-web': { enabled: false } }, windows: { deep: 4000 } },
      { v: 1, hosts: { 'fansly-web': { enabled: false, viaTab: true, notesView: 'drawer', sound: { messagesTone: 'blip', subscribersTone: 'arpeggio' } }, 'telegram-web': { enabled: false } }, windows: { deep: null } },
    ],
    // A depth v1 holds (≤ 3000), one above the wire's 5000, a view of another version, an unknown notes view.
    invalid: [
      { v: 1, hosts: { 'fansly-web': { enabled: true, viaTab: false, notesView: 'docked', sound: { messagesTone: 'chime', subscribersTone: 'double' } } }, windows: { deep: 3000 } },
      { v: 1, hosts: { 'fansly-web': { enabled: true, viaTab: false, notesView: 'docked', sound: { messagesTone: 'chime', subscribersTone: 'double' } } }, windows: { deep: 5001 } },
      { v: 2, hosts: { 'fansly-web': { enabled: true, viaTab: false, notesView: 'docked', sound: { messagesTone: 'chime', subscribersTone: 'double' } } }, windows: { deep: null } },
      { v: 1, hosts: { 'fansly-web': { enabled: true, viaTab: false, notesView: 'left', sound: { messagesTone: 'chime', subscribersTone: 'double' } } }, windows: { deep: null } },
    ],
  },
  patch: {
    valid: [{}, { windows: { deep: 3001 } }, { hosts: { 'fansly-web': { enabled: true } } }, { hosts: { 'fansly-web': { sound: { subscribersTone: 'bell' } } }, windows: { deep: 5000 } }, { windows: { deep: null } }],
    invalid: [{ windows: { deep: 3000 } }, { windows: { deep: 5001 } }, { hosts: { chatspace: { enabled: true } } }, { windows: { deep: 3001.5 } }, { hosts: { 'fansly-web': { sound: { messagesTone: 'beep' } } } }, { v: 2 }],
  },
} as const satisfies Readonly<Record<string, Verdicts>>;
