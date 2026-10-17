// Fixtures of Fansly's own operations (1.15.0, R20 P4b3; ops-fansly.ts): the
// starts of the voice script and of «Заполнить из чата», their results, the
// questionnaire's labels, and the hub bodies and requests the two become —
// valid and invalid. Synthetic Fansly ids (FANSLY_IDS): the conversation is
// the group, the fan named apart.

import { DIGEST, FANSLY_IDS, cause, fanslyTarget, target, uuid, opView } from './samples';

/** The shape of protocols.ts `Verdicts`, written here: the hub's fixtures take these, and protocols.ts imports the hub's. */
interface Verdicts {
  readonly valid: readonly unknown[];
  readonly invalid: readonly unknown[];
}

/** A questionnaire as the notes panel reads it off the template: labels only, in the note's order. */
export const NOTE_LABELS = ['Имя', 'Возраст', 'Локация', 'Медиа'] as const;
/** The SDK's own bounds, hit exactly: 30 labels of 60 characters. */
export const noteLabelsAtTheBound = (): string[] => Array.from({ length: 30 }, (_, i) => `Поле ${String(i).padStart(2, '0')} ${'я'.repeat(52)}`);

export const NOTE_FIELDS_FIXTURES: Verdicts = {
  valid: [
    [...NOTE_LABELS],
    ['Имя'],
    noteLabelsAtTheBound(),
    // Any sign but the five the `Label: value` line would break on.
    ['Хобби (что любит)', 'Город / страна', 'Ник в TG', 'Любимое 💛'],
  ],
  invalid: [
    [],
    [...noteLabelsAtTheBound(), 'Ещё'],
    ['я'.repeat(61)],
    // The hub compares labels case-insensitively: two of one are one field answered twice.
    ['Имя', 'имя'],
    // The line `Label: value` and the prompt's escaping.
    ['Имя: Анна'],
    ['Имя\nВозраст'],
    ['Имя\u2028'],
    ['<b>Имя</b>'],
    ['Tom & Jerry'],
    // Sent trimmed: the hub trims, so an edge space is ours to drop before the body leaves.
    [' Имя'],
    ['Имя '],
    [''],
    ['   '],
  ],
};

const draft = { text: 'привет, я соскучилась — как прошёл день?', revision: 4, digest: DIGEST } as const;

export const fanslyVoiceScriptStart = { feature: 'voice-script', target: fanslyTarget, cause, tone: 'flirty', draft, window: 100 } as const;
export const fanslyNotesFillStart = { feature: 'notes-fill', target: fanslyTarget, cause, fields: [...NOTE_LABELS], window: 3000 } as const;

export const FANSLY_START_OP_FIXTURES: Verdicts = {
  valid: [
    fanslyVoiceScriptStart,
    // «Спокойный»: no tone, the hub's `none`.
    { ...fanslyVoiceScriptStart, tone: null },
    { ...fanslyVoiceScriptStart, regenerateOf: uuid(0x501), force: true },
    fanslyNotesFillStart,
    { ...fanslyNotesFillStart, window: 5, regenerateOf: uuid(0x502) },
  ],
  invalid: [
    // A ChatSpace chat has no operation of Fansly's.
    { ...fanslyVoiceScriptStart, target },
    { ...fanslyNotesFillStart, target },
    // The script is spoken from a draft: none, or a blank one, is no start.
    { ...fanslyVoiceScriptStart, draft: undefined },
    { ...fanslyVoiceScriptStart, draft: { ...draft, text: '   ' } },
    { ...fanslyVoiceScriptStart, tone: 'calm' },
    // The notes fill sends labels and nothing of the note: no values, no labels it cannot send.
    { ...fanslyNotesFillStart, fields: [] },
    { ...fanslyNotesFillStart, fields: ['Имя: Анна'] },
    { ...fanslyNotesFillStart, values: ['Анна', '', '', ''] },
    { ...fanslyNotesFillStart, tone: null },
    { ...fanslyVoiceScriptStart, fields: [...NOTE_LABELS] },
    // The body's bounds of the window; a shared feature is no operation of this table.
    { ...fanslyNotesFillStart, window: 4 },
    { ...fanslyNotesFillStart, window: 5001 },
    { ...fanslyVoiceScriptStart, feature: 'reply' },
    { ...fanslyVoiceScriptStart, surface: 'dock' },
  ],
};

export const voiceScriptResult = { kind: 'voice-script', script: 'Привет, солнце… я весь день думала о тебе.' } as const;
export const noteFieldsResult = {
  kind: 'note-fields',
  fields: [
    { label: 'Имя', value: 'Анна' },
    { label: 'Возраст', value: '' },
    { label: 'Локация', value: 'Берлин' },
    { label: 'Медиа', value: 'купил 3 видео, любит фото в чулках' },
  ],
} as const;

/** 1.16.0 (R20 P11b2): the hub's merge mode — the fan's quotes under a value, the fields it named itself. */
export const noteFieldsMergeResult = {
  kind: 'note-fields',
  fields: [
    { label: 'Имя', value: 'Анна', quotes: ['I am Anna btw', 'call me Anna'] },
    { label: 'Возраст', value: '' },
    { label: 'Локация', value: 'Флорида (08.2026)', quotes: ['just moved to Florida'] },
    { label: 'Медиа', value: '', quotes: [] },
  ],
  proposed: [{ label: 'Питомцы', value: 'кот Барсик', quotes: ['my cat Barsik'] }],
} as const;

export const FANSLY_OP_RESULT_FIXTURES: Verdicts = {
  valid: [voiceScriptResult, noteFieldsResult, noteFieldsMergeResult, { ...noteFieldsResult, proposed: [] }, { kind: 'note-fields', fields: [{ label: 'Имя', value: '' }] }, { kind: 'voice-script', script: 'с'.repeat(5000) }],
  invalid: [
    // 1.16.0: three quotes a value, each one line and not empty; a proposed field has a value and is not an asked one.
    { kind: 'note-fields', fields: [{ label: 'Имя', value: 'Анна', quotes: ['a', 'b', 'c', 'd'] }] },
    { kind: 'note-fields', fields: [{ label: 'Имя', value: 'Анна', quotes: ['a\nb'] }] },
    { kind: 'note-fields', fields: [{ label: 'Имя', value: 'Анна', quotes: [''] }] },
    { kind: 'note-fields', fields: [{ label: 'Имя', value: 'Анна', quotes: ['я'.repeat(401)] }] },
    { ...noteFieldsMergeResult, proposed: [{ label: 'имя', value: 'Аня' }] },
    { ...noteFieldsMergeResult, proposed: [{ label: 'Питомцы', value: ' ' }] },
    { ...noteFieldsMergeResult, proposed: Array.from({ length: 6 }, (_, i) => ({ label: `Поле ${String(i)}`, value: 'x' })) },
    { kind: 'voice-script', script: '' },
    { kind: 'voice-script', script: '  \n ' },
    { kind: 'voice-script', script: 'с'.repeat(5001) },
    { ...voiceScriptResult, generationRef: uuid(0x503) },
    { kind: 'note-fields', fields: [] },
    { kind: 'note-fields', fields: [{ label: 'Имя', value: 'Анна' }, { label: 'ИМЯ', value: 'Аня' }] },
    // A value is one line of the note.
    { kind: 'note-fields', fields: [{ label: 'Медиа', value: 'видео\nфото' }] },
    { kind: 'note-fields', fields: [{ label: 'Медиа', value: 'в'.repeat(2001) }] },
    { kind: 'note-fields', fields: [{ label: 'Имя:', value: 'Анна' }] },
    { kind: 'parts', parts: ['x'], splitRequested: false },
  ],
};

/** The hub body of each, as its driver builds it from the starts above (no `clientContext`, the group and the fan apart). */
export const voiceScriptBody = {
  clientRequestId: uuid(0x510),
  pageLabel: 'model-two',
  platform: 'fansly',
  conversationRef: FANSLY_IDS.group,
  fanRef: FANSLY_IDS.fan,
  replyTone: 'flirty',
  draftText: draft.text,
  messageCount: 100,
} as const;
export const notesFillBody = {
  clientRequestId: uuid(0x511),
  pageLabel: 'model-two',
  platform: 'fansly',
  conversationRef: FANSLY_IDS.group,
  fanRef: FANSLY_IDS.fan,
  messageCount: 3000,
  noteFields: [...NOTE_LABELS],
} as const;

/** `HubStreamRequestSchema`: the two features of Fansly's operations, and what the hub's handler refuses of them. */
export const FANSLY_OP_REQUEST_FIXTURES: Verdicts = {
  valid: [
    { feature: 'voice-script', body: voiceScriptBody, capabilities: ['context-v1'] },
    { feature: 'voice-script', body: { ...voiceScriptBody, replyTone: undefined, isRegeneration: true }, capabilities: [] },
    { feature: 'fan-notes-fill', body: notesFillBody, capabilities: ['context-v1'] },
    { feature: 'fan-notes-fill', body: { ...notesFillBody, noteFields: noteLabelsAtTheBound() }, capabilities: ['debug-input-v1', 'context-v1'] },
    // 1.16.0 (R20 P11b2, X43): the hub's merge mode by its switch — one empty value per label.
    { feature: 'fan-notes-fill', body: { ...notesFillBody, noteValues: NOTE_LABELS.map(() => '') }, capabilities: ['context-v1'] },
    { feature: 'fan-notes-fill', body: { ...notesFillBody, noteFields: noteLabelsAtTheBound(), noteValues: noteLabelsAtTheBound().map(() => '') }, capabilities: ['context-v1'] },
  ],
  invalid: [
    // A Fansly page's, the fan named: the hub refuses the voice script elsewhere (`gate_voice_unsupported_platform`) and without the fan.
    { feature: 'voice-script', body: { ...voiceScriptBody, platform: 'onlyfans', conversationRef: FANSLY_IDS.fan }, capabilities: [] },
    { feature: 'voice-script', body: { ...voiceScriptBody, fanRef: undefined }, capabilities: [] },
    { feature: 'voice-script', body: { ...voiceScriptBody, fanRef: null }, capabilities: [] },
    { feature: 'fan-notes-fill', body: { ...notesFillBody, fanRef: undefined }, capabilities: [] },
    { feature: 'fan-notes-fill', body: { ...notesFillBody, platform: 'onlyfans', conversationRef: FANSLY_IDS.fan }, capabilities: [] },
    // The script needs its draft (`gate_draft_required`); the fill needs its labels (`fan-notes-fill requires noteFields`).
    { feature: 'voice-script', body: { ...voiceScriptBody, draftText: undefined }, capabilities: [] },
    { feature: 'voice-script', body: { ...voiceScriptBody, draftText: '   ' }, capabilities: [] },
    { feature: 'fan-notes-fill', body: { ...notesFillBody, noteFields: undefined }, capabilities: [] },
    // The labels are the fill's alone; values never travel; a fill speaks no tone and fills no draft.
    { feature: 'fast-reply', body: { ...voiceScriptBody, draftText: undefined, noteFields: [...NOTE_LABELS] }, capabilities: [] },
    { feature: 'fan-notes-fill', body: { ...notesFillBody, noteValues: ['Анна', '', '', ''] }, capabilities: [] },
    { feature: 'fan-notes-fill', body: { ...notesFillBody, noteValues: ['', ''] }, capabilities: [] },
    { feature: 'voice-script', body: { ...voiceScriptBody, noteValues: [''] }, capabilities: [] },
    { feature: 'fan-notes-fill', body: { ...notesFillBody, replyTone: 'flirty' }, capabilities: [] },
    { feature: 'fan-notes-fill', body: { ...notesFillBody, draftText: 'x' }, capabilities: [] },
    // Fresh page text is a draft feature's only (D-14): the voice script reads the hub's history.
    { feature: 'voice-script', body: { ...voiceScriptBody, liveTextContext: { capturedAt: '2026-10-03T10:00:00Z', items: [{ platformMessageId: '700000000000000101', direction: 'fan', occurredAt: '2026-10-03T10:00:00Z', text: 'hi' }] } }, capabilities: ['context-v1'] },
    { feature: 'voice-script', body: { ...voiceScriptBody, variantCount: 3 }, capabilities: [] },
  ],
};

// P12a: a kept site view uses the same lifecycle with a strict site result.
export const fanslyVoiceView = { ...opView, target: fanslyTarget, feature: 'voice-script', result: voiceScriptResult, generationRef: uuid(0x550), toneUsed: null } as const;
export const FANSLY_OP_VIEW_FIXTURES: Verdicts = {
  valid: [fanslyVoiceView, { ...fanslyVoiceView, feature: 'notes-fill', result: noteFieldsResult }, { ...fanslyVoiceView, state: 'streaming', result: undefined }],
  invalid: [opView, { ...fanslyVoiceView, target }, { ...fanslyVoiceView, result: noteFieldsResult }, { ...fanslyVoiceView, generationRef: undefined }, { ...fanslyVoiceView, result: undefined }, { ...fanslyVoiceView, clientContext: {} }],
};
