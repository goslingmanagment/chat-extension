// Fixtures of fansly.com's own tab protocol (1.15.0, R20 P4a3): each request
// (payload and response) and each event of `tab-messages-fansly.ts`, the
// `settings.ext` key and a Fansly failure on the wire. Synthetic 18-digit ids
// (FANSLY_IDS); the conversation is the group, never the fan.

import type { FanslyTabEventType, FanslyTabRequestType } from '../../src/tab-messages-fansly';
import type { RequestFixtures, Verdicts } from './protocols';
import { FANSLY_IDS, ISO, T0, uuid } from './samples';
import { FANSLY_GREETING_REQUEST_FIXTURES, FANSLY_SEND_VIEW_FIXTURES } from './send-fansly';

const F = FANSLY_IDS;
const ack = { valid: [{ recorded: true }, { recorded: false }], invalid: [{ recorded: 'yes' }, {}] } as const;
/** P13b review: another open tab holds the album — nothing kept; a held write that says it was kept is no answer. */
const vaultAck = { valid: [...ack.valid, { recorded: false, held: true }, { recorded: true, held: false }], invalid: [...ack.invalid, { recorded: true, held: true }, { recorded: false, held: 'yes' }] } as const;
const SHA = 'ab'.repeat(32);

/** A Fansly failure in a payload: a Fansly code and a shared one are both readable; an unknown code is not. */
const failure = { ok: false, error: { code: 'CG-FAN-RATE-LIMIT', retryAt: T0 + 60_000, httpStatus: 429 } } as const;
const sharedFailure = { ok: false, error: { code: 'CG-NETWORK' } } as const;
const unknownFailure = { ok: false, error: { code: 'CG-FAN-01' } } as const;

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

export const fanslyNote = { noteId: '700000000000000010', title: 'Анкета', text: 'Имя: Алекс\nЛокация: ', foreign: false } as const;
export const voiceNoteView = {
  voiceNoteId: 77,
  state: 'completed',
  scriptChars: 140,
  billed: true,
  audioSha256: SHA,
  audioBytesLen: 48_000,
  createdAt: ISO,
} as const;
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
const noteTarget = { hostAccountId: F.creator, fanRef: F.fan } as const;
const voiceRef = { attemptId: uuid(320), pageId: 12, voiceNoteId: 77 } as const;

export const FANSLY_TAB_REQUEST_FIXTURES: { readonly [T in FanslyTabRequestType]: RequestFixtures } = {
  'fansly.followers.scan': {
    req: { valid: [{ hostAccountId: F.creator, windowHours: 48 }, { hostAccountId: F.creator, windowHours: 720 }], invalid: [{ hostAccountId: F.creator, windowHours: 721 }, { hostAccountId: F.creator, windowHours: 0 }, { windowHours: 48 }] },
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
    req: { valid: [{ ...passRef, offset: 0, limit: 500 }], invalid: [{ ...passRef, offset: 0, limit: 501 }, { ...passRef, offset: -1, limit: 10 }] },
    res: {
      valid: [{ pass: fanslyPass, rows: [fanslyRow, { ...fanslyRow, fanRef: '700000000000000005', groupId: null, status: 'dm-closed', dmClosed: 'paid', historyRevision: null, checkedAt: null }], total: 2 }, { pass: null, rows: [], total: 0 }],
      // A row whose conversation is not an id, and one whose status is not in the list.
      invalid: [{ pass: fanslyPass, rows: [{ ...fanslyRow, groupId: 'group-1' }], total: 1 }, { pass: fanslyPass, rows: [{ ...fanslyRow, status: 'sent' }], total: 1 }],
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

  'fansly.notes.read': {
    req: { valid: [{ ...noteTarget, groupId: F.group }, { ...noteTarget, groupId: null, force: true }], invalid: [{ ...noteTarget }, { fanRef: F.fan, groupId: F.group }] },
    res: {
      valid: [
        { ok: true, notes: [fanslyNote, { ...fanslyNote, noteId: '700000000000000011', title: 'FBuddy Notes', foreign: true }], customName: { noteId: '700000000000000012', name: 'Алекс' }, readAt: ISO },
        { ok: true, notes: [], customName: null, readAt: ISO },
        { ok: false, error: { code: 'CG-NOTE-READ' } },
      ],
      invalid: [{ ok: true, notes: [{ ...fanslyNote, text: 'x'.repeat(50_001) }], customName: null, readAt: ISO }, { ok: true, notes: [], readAt: ISO }],
    },
  },
  'fansly.notes.create': {
    req: { valid: [{ ...noteTarget, title: 'Анкета', text: 'Имя: ' }, { ...noteTarget, title: '', text: 'x'.repeat(50_000) }], invalid: [{ ...noteTarget, title: 't'.repeat(1001), text: '' }, { ...noteTarget, title: '', text: 'x'.repeat(50_001) }] },
    res: { valid: [{ ok: true, note: fanslyNote }, { ok: false, error: { code: 'CG-NOTE-UNCERTAIN' } }], invalid: [{ ok: true, note: { ...fanslyNote, foreign: 'no' } }] },
  },
  'fansly.notes.edit': {
    req: { valid: [{ ...noteTarget, noteId: fanslyNote.noteId, title: 'Анкета', text: 'Имя: Алекс' }], invalid: [{ ...noteTarget, title: 'Анкета', text: 'Имя: Алекс' }] },
    res: { valid: [{ ok: true, note: fanslyNote }, { ok: false, error: { code: 'CG-NOTE-WRITE' } }], invalid: [{ ok: true, note: null }] },
  },
  'fansly.notes.delete': {
    req: { valid: [{ ...noteTarget, noteId: fanslyNote.noteId }], invalid: [{ ...noteTarget, noteId: 'note-1' }] },
    res: { valid: [{ ok: true }, { ok: false, error: { code: 'CG-FAN-EXPIRED' } }], invalid: [{ ok: true, deleted: 1 }] },
  },
  'fansly.notes.name': {
    req: { valid: [{ ...noteTarget, name: 'Алекс' }, { ...noteTarget, name: '' }], invalid: [{ ...noteTarget, name: 'n'.repeat(1001) }] },
    res: { valid: [{ ok: true, customName: { noteId: '700000000000000012', name: 'Алекс' } }, { ok: true, customName: null }], invalid: [{ ok: true }] },
  },

  'fansly.voice.create': {
    req: {
      valid: [{ attemptId: uuid(320), clientRequestId: uuid(321), pageId: 12, conversationRef: F.group, fanRef: F.fan, sourceGenerationRef: uuid(322), script: 'Hey [whispers] you' }],
      // An empty script; a group id that is not an id.
      invalid: [
        { attemptId: uuid(320), clientRequestId: uuid(321), pageId: 12, conversationRef: F.group, fanRef: F.fan, sourceGenerationRef: uuid(322), script: '' },
        { attemptId: uuid(320), clientRequestId: uuid(321), pageId: 12, conversationRef: 'group', fanRef: F.fan, sourceGenerationRef: uuid(322), script: 'Hey' },
      ],
    },
    res: { valid: [{ ok: true, view: { ...voiceNoteView, state: 'queued', billed: null, audioSha256: null, audioBytesLen: null } }, { ok: false, error: { code: 'CG-VOICE-QUOTA', httpStatus: 429 } }], invalid: [{ ok: true, view: { ...voiceNoteView, state: 'done' } }] },
  },
  'fansly.voice.status': {
    req: { valid: [voiceRef], invalid: [{ ...voiceRef, voiceNoteId: 0 }] },
    res: { valid: [{ ok: true, view: voiceNoteView }, { ok: true, view: { ...voiceNoteView, state: 'failed_definite', errorCode: 'provider_timeout' } }, { ok: false, error: { code: 'CG-VOICE-UNCERTAIN' } }], invalid: [{ ok: true, view: { ...voiceNoteView, audioSha256: 'abc' } }] },
  },
  'fansly.voice.audio': {
    req: { valid: [voiceRef], invalid: [{ attemptId: uuid(320), voiceNoteId: 77 }] },
    res: {
      valid: [{ ok: true, mime: 'audio/mpeg', base64: 'SUQz', sha256: SHA, bytes: 3 }, { ok: false, error: { code: 'CG-VOICE-EXPIRED', httpStatus: 410 } }],
      invalid: [{ ok: true, mime: 'audio/wav', base64: 'SUQz', sha256: SHA, bytes: 3 }, { ok: true, mime: 'audio/mpeg', base64: 'not base64!', sha256: SHA, bytes: 3 }],
    },
  },
  'fansly.voice.attempts': {
    req: { valid: [{ pageId: 12, conversationRef: F.group }], invalid: [{ pageId: 12 }] },
    res: {
      valid: [{ attempts: [{ attemptId: uuid(320), clientRequestId: uuid(321), pageId: 12, conversationRef: F.group, fanRef: F.fan, state: 'uncertain', view: null, updatedAt: T0 }] }, { attempts: [] }],
      invalid: [{ attempts: [{ attemptId: uuid(320), clientRequestId: uuid(321), pageId: 12, conversationRef: F.group, fanRef: F.fan, state: 'retrying', view: null, updatedAt: T0 }] }],
    },
  },

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
};

export const FANSLY_TAB_EVENT_FIXTURES: { readonly [T in FanslyTabEventType]: Verdicts } = {
  'fansly.followers.changed': {
    valid: [{ pass: fanslyPass, seq: 3, rows: [fanslyRow] }, { pass: { ...fanslyPass, state: 'cooldown', cooldownUntil: T0 + 30_000 }, seq: 4, rows: [] }],
    invalid: [{ pass: fanslyPass, seq: 3, rows: Array.from({ length: 101 }, () => fanslyRow) }, { pass: fanslyPass, rows: [] }],
  },
  'fansly.relay.fetch': {
    valid: [
      { requestId: uuid(330), method: 'GET', url: 'https://apiv3.fansly.com/api/v1/account/me?ngsw-bypass=true', headers: [['authorization', 'x']], expect: { hostAccountId: F.creator } },
      { requestId: uuid(331), method: 'POST', url: 'https://apiv3.fansly.com/api/v1/notes?ngsw-bypass=true', headers: [], body: '{}', expect: { hostAccountId: F.creator } },
    ],
    // Any other address, even of Fansly; a method we never use; no expectation for the frame's own check.
    invalid: [
      { requestId: uuid(330), method: 'GET', url: 'https://fansly.com/api/v1/account/me', headers: [], expect: { hostAccountId: F.creator } },
      { requestId: uuid(330), method: 'DELETE', url: 'https://apiv3.fansly.com/api/v1/notes', headers: [], expect: { hostAccountId: F.creator } },
      { requestId: uuid(330), method: 'GET', url: 'https://apiv3.fansly.com/api/v1/account/me', headers: [] },
    ],
  },
  'fansly.relay.abort': { valid: [{ requestId: uuid(330) }], invalid: [{ requestId: 'r1' }] },
};

/** `settings.ext` as this build reads it: the view, the patch, the state (contracts settings-ext.ts). */
export const SETTINGS_EXT_FIXTURES = {
  view: {
    valid: [
      { v: 1, hosts: { 'fansly-web': { enabled: true, viaTab: false, notesView: 'docked', sound: { messagesTone: 'chime', subscribersTone: 'double' } } }, windows: { deep: 4000 } },
      { v: 1, hosts: { 'fansly-web': { enabled: false, viaTab: true, notesView: 'drawer', sound: { messagesTone: 'blip', subscribersTone: 'arpeggio' } } }, windows: { deep: null } },
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
