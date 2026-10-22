// Fixtures of the voice notes (1.46.0; voice.ts): the script's start on both
// sites, a session with its takes, the hub's view of a note, a checked MP3.
// Synthetic ids of samples.ts: on ChatSpace the chat is the fan, on Fansly the
// group named apart.

import { DIGEST, FANSLY_IDS, IDS, ISO, T0, cause, chat, fanslyTarget, opView, target, uuid } from './samples';

const SHA = 'ab'.repeat(32);
const draft = { text: 'miss you, want to hear my voice?', revision: 4, digest: DIGEST } as const;
const fresh = { capturedAt: '2026-10-03T10:00:00Z', messages: [{ platformMessageId: '700000000000000101', direction: 'fan', sentAt: '2026-10-03T10:00:00Z', text: 'hi' }] } as const;

export const voiceScriptStart = { feature: 'voice-script', target, cause, window: 100, tone: 'flirty', draft } as const;
export const fanslyVoiceStart = { ...voiceScriptStart, target: fanslyTarget } as const;

export const VOICE_SCRIPT_START_FIXTURES = {
  valid: [
    voiceScriptStart,
    fanslyVoiceStart,
    { ...voiceScriptStart, tone: null },
    { ...voiceScriptStart, fresh },
    { ...fanslyVoiceStart, regenerateOf: uuid(0x501), force: true },
  ],
  invalid: [
    // The script is spoken from a draft: none, or a blank one, is no start.
    { ...voiceScriptStart, draft: undefined },
    { ...voiceScriptStart, draft: { ...draft, text: '   ' } },
    // A preset is the hub's tone, never the studio's own word.
    { ...voiceScriptStart, tone: 'calm' },
    { ...voiceScriptStart, feature: 'reply' },
    { ...voiceScriptStart, surface: 'dock' },
    { ...voiceScriptStart, window: 4 },
    // On OnlyFans the chat is the fan.
    { ...voiceScriptStart, target: { ...target, conversationRef: '3003' } },
  ],
} as const;

export const voiceNoteView = { voiceNoteId: 77, state: 'completed', scriptChars: 36, billed: true, audioSha256: SHA, audioBytesLen: 48_000, createdAt: ISO } as const;

export const voiceTake = {
  takeId: uuid(0x701),
  createdAt: T0,
  script: '[warmly] Hey you, I missed you today.',
  sourceGenerationRef: uuid(0x702),
  state: 'ready',
  voiceNoteId: 77,
  audio: { sha256: SHA, bytes: 48_000 },
  billed: true,
  error: null,
  attached: null,
} as const;

export const voiceSession = {
  sessionId: uuid(0x700),
  pageId: 11,
  chat,
  conversationRef: IDS.fan,
  fanRef: IDS.fan,
  createdAt: T0,
  updatedAt: T0 + 1000,
  revision: 3,
  draft: draft.text,
  script: { tone: 'warm', generationRef: uuid(0x702), original: '[warmly] Hey you, I missed you today.', edited: null },
  writing: null,
  error: null,
  takes: [voiceTake, { ...voiceTake, takeId: uuid(0x703), state: 'working', audio: null, billed: null, voiceNoteId: 78 }],
} as const;

export const fanslyVoiceSession = {
  ...voiceSession,
  sessionId: uuid(0x710),
  pageId: 13,
  chat: fanslyTarget.chat,
  conversationRef: FANSLY_IDS.group,
  fanRef: FANSLY_IDS.fan,
  takes: [],
  script: null,
  writing: { opId: uuid(0x711), tone: 'calm', startedAt: T0 },
} as const;

export const VOICE_SESSION_FIXTURES = {
  valid: [voiceSession, fanslyVoiceSession, { ...voiceSession, takes: [{ ...voiceTake, state: 'uncertain', error: { code: 'CG-VOICE-UNCERTAIN' }, audio: null, voiceNoteId: null, billed: null }] }],
  invalid: [
    // A take's audio is checked against a sha256 and a length; a state is one of seven.
    { ...voiceSession, takes: [{ ...voiceTake, audio: { sha256: 'abc', bytes: 1 } }] },
    { ...voiceSession, takes: [{ ...voiceTake, state: 'done' }] },
    { ...voiceSession, takes: Array.from({ length: 13 }, (_, i) => ({ ...voiceTake, takeId: uuid(0x800 + i) })) },
    { ...voiceSession, draft: '' },
    { ...voiceSession, script: { ...voiceSession.script, tone: 'flirty' } },
  ],
} as const;

/** The voice script's kept view: the shared lifecycle with its own result. */
export const voiceOpView = { ...opView, feature: 'voice-script', result: { kind: 'voice-script', script: 'Hey you' }, generationRef: uuid(0x702), toneUsed: null } as const;
export const VOICE_OP_VIEW_FIXTURES = {
  valid: [voiceOpView, { ...voiceOpView, state: 'streaming', result: undefined, generationRef: undefined }, { ...voiceOpView, target: fanslyTarget }],
  invalid: [opView, { ...voiceOpView, generationRef: undefined }, { ...voiceOpView, result: { kind: 'note-fields', fields: [] } }, { ...voiceOpView, result: undefined }],
} as const;

export const voiceAudio = { mime: 'audio/mpeg', base64: 'SUQz', sha256: SHA, bytes: 3 } as const;
