// Fixtures of the Fansly greeting send (1.15.0, R20 P4c; send-fansly.ts): the
// «Новые» request, the groups and the hub's claim body of a Fansly greeting,
// the attempt's view and the `fansly.send.journal` record, Fansly's receipt.
// Synthetic Fansly ids: 18 digits (FANSLY_IDS), and the old accounts' 17 and
// the 19 of 2027 on; the conversation is the group, never the fan.

import type { Verdicts } from './protocols';
import { ACTION_TOKEN, FANSLY_IDS, HUB, T0, uuid } from './samples';

const F = FANSLY_IDS;
/** A fan of an account made before April 2020: 17 digits. */
export const FANSLY_OLD_FAN = '70000000000000005';
/** An id of 2027 on: 19 digits, the string order is not the time order. */
export const FANSLY_LONG_GROUP = '1000000000000000003';
export const FANSLY_MESSAGE_ID = '700000000000000050';

export const TEXT_FINGERPRINT = 'ab12'.repeat(16);
const GENERATION = uuid(401);
const cause = { kind: 'click', actionToken: ACTION_TOKEN } as const;

export const fanslyAiGroup = { generationRef: GENERATION, variant: 0, partCount: 1 } as const;
export const fanslyManualGroup = { kind: 'manual', textFingerprint: TEXT_FINGERPRINT } as const;

export const fanslyGreetingRequest = {
  attemptId: uuid(402),
  passId: uuid(301),
  hostAccountId: F.creator,
  fanRef: F.fan,
  groupId: F.group,
  text: 'Привет! Рада, что ты здесь 💛',
  draftRevision: 7,
  historyRevision: uuid(302),
  admission: { kind: 'own' },
  cause,
} as const;

export const FANSLY_GREETING_REQUEST_FIXTURES: Verdicts = {
  valid: [
    fanslyGreetingRequest,
    { ...fanslyGreetingRequest, admission: { kind: 'ai', generationRef: GENERATION, variant: 0 } },
    { ...fanslyGreetingRequest, admission: { kind: 'ai-edited', generationRef: GENERATION, variant: 2 }, cause: { kind: 'key', actionToken: ACTION_TOKEN } },
    { ...fanslyGreetingRequest, fanRef: FANSLY_OLD_FAN, groupId: FANSLY_LONG_GROUP },
    { ...fanslyGreetingRequest, text: 'x'.repeat(5000), draftRevision: 2_147_483_647 },
  ],
  invalid: [
    { ...fanslyGreetingRequest, fanRef: Number(F.fan) },
    { ...fanslyGreetingRequest, groupId: '0700000000000000003' },
    { ...fanslyGreetingRequest, text: ' Привет' },
    { ...fanslyGreetingRequest, text: 'Привет\n' },
    { ...fanslyGreetingRequest, text: '' },
    { ...fanslyGreetingRequest, text: '   ' },
    { ...fanslyGreetingRequest, text: 'x'.repeat(5001) },
    { ...fanslyGreetingRequest, draftRevision: 2_147_483_648 },
    { ...fanslyGreetingRequest, draftRevision: -1 },
    { ...fanslyGreetingRequest, historyRevision: 'r1' },
    { ...fanslyGreetingRequest, admission: { kind: 'ai' } },
    { ...fanslyGreetingRequest, admission: { kind: 'own', generationRef: GENERATION, variant: 0 } },
    { ...fanslyGreetingRequest, admission: { kind: 'ai', generationRef: GENERATION, variant: 3 } },
    { ...fanslyGreetingRequest, admission: { kind: 'template' } },
    { ...fanslyGreetingRequest, cause: undefined },
    { ...fanslyGreetingRequest, textFingerprint: TEXT_FINGERPRINT },
  ],
};

export const FANSLY_GREETING_GROUP_FIXTURES: Verdicts = {
  valid: [fanslyAiGroup, { ...fanslyAiGroup, variant: 2 }, fanslyManualGroup],
  invalid: [
    { ...fanslyAiGroup, partCount: 2 },
    { ...fanslyAiGroup, variant: 3 },
    { ...fanslyAiGroup, generationRef: `manual:${TEXT_FINGERPRINT}` },
    { kind: 'manual', textFingerprint: TEXT_FINGERPRINT.toUpperCase() },
    { kind: 'manual', textFingerprint: TEXT_FINGERPRINT.slice(1) },
    { ...fanslyManualGroup, text: 'Привет' },
    { ...fanslyManualGroup, generationRef: GENERATION },
    { ...fanslyManualGroup, partCount: 1 },
    { kind: 'ai', textFingerprint: TEXT_FINGERPRINT },
  ],
};

const lease = { leaseToken: uuid(403), instanceId: uuid(404) } as const;
const attempt = { attemptId: uuid(402), instanceId: uuid(404) } as const;
export const fanslyDispatch = {
  action: 'dispatch',
  ...attempt,
  purpose: 'greeting',
  group: fanslyManualGroup,
  partIndex: 0,
  textRevision: 7,
  leaseToken: uuid(403),
  flagRevision: 12,
} as const;

export const FANSLY_CLAIM_BODY_FIXTURES: Verdicts = {
  valid: [
    { action: 'claim', ...lease },
    { action: 'renew', ...lease },
    { action: 'release', ...lease },
    fanslyDispatch,
    { ...fanslyDispatch, group: fanslyAiGroup },
    { action: 'sent', ...attempt, platformMessageId: FANSLY_MESSAGE_ID, evidence: 'receipt+echo' },
    { action: 'failed', ...attempt, reason: 'not_enqueued' },
    { action: 'failed', ...attempt, reason: 'native_rejected', httpStatus: 403 },
    { action: 'failed', ...attempt, reason: 'native_rejected', httpStatus: 429 },
    { action: 'registerNativeSend', ...attempt, purpose: 'greeting', group: fanslyManualGroup, partIndex: 0, platformMessageId: FANSLY_MESSAGE_ID },
    { action: 'registerNativeSend', ...attempt, purpose: 'greeting', group: fanslyAiGroup, partIndex: 0, platformMessageId: '1000000000000000050' },
  ],
  invalid: [
    { ...fanslyDispatch, purpose: 'preview-reply' },
    { ...fanslyDispatch, partIndex: 1 },
    { ...fanslyDispatch, group: { ...fanslyAiGroup, partCount: 2 } },
    { ...fanslyDispatch, leaseToken: undefined },
    { ...fanslyDispatch, group: { ...fanslyManualGroup, text: 'Привет' } },
    { ...fanslyDispatch, text: 'Привет' },
    { ...fanslyDispatch, textRevision: 2_147_483_648 },
    { action: 'failed', ...attempt, reason: 'native_rejected', httpStatus: 401 },
    { action: 'failed', ...attempt, reason: 'native_rejected', httpStatus: 500 },
    { action: 'failed', ...attempt, reason: 'native_rejected' },
    { action: 'failed', ...attempt, reason: 'not_enqueued', httpStatus: 400 },
    { action: 'failed', ...attempt, reason: 'rejected_200' },
    { action: 'sent', ...attempt, platformMessageId: FANSLY_MESSAGE_ID, evidence: 'receipt' },
    { action: 'sent', ...attempt, platformMessageId: Number(FANSLY_MESSAGE_ID), evidence: 'receipt+echo' },
    { action: 'registerNativeSend', ...attempt, purpose: 'preview-reply', group: fanslyAiGroup, partIndex: 0, platformMessageId: FANSLY_MESSAGE_ID },
    { action: 'resolve', ...attempt },
  ],
};

export const FANSLY_CLAIM_OP_FIXTURES: Verdicts = {
  valid: [
    { pageLabel: 'fansly-model', fanRef: F.fan, body: fanslyDispatch },
    { pageLabel: 'fansly-model', fanRef: FANSLY_OLD_FAN, body: { action: 'claim', ...lease } },
  ],
  invalid: [
    { pageLabel: 'fansly-model', fanRef: Number(F.fan), body: fanslyDispatch },
    { pageLabel: '', fanRef: F.fan, body: fanslyDispatch },
    { pageLabel: 'fansly-model', fanRef: F.fan, body: { ...fanslyDispatch, purpose: 'preview-reply' } },
  ],
};

const view = { attemptId: uuid(402), fanRef: F.fan } as const;
export const FANSLY_SEND_VIEW_FIXTURES: Verdicts = {
  valid: [
    ...(['ready', 'claimed', 'routed', 'dispatched', 'intentWritten', 'requestStarted'] as const).map((state) => ({ ...view, state })),
    { ...view, state: 'receipted', platformMessageId: FANSLY_MESSAGE_ID },
    { ...view, state: 'sent', proof: 'echo', platformMessageId: FANSLY_MESSAGE_ID },
    { ...view, state: 'sent', proof: 'history', platformMessageId: FANSLY_MESSAGE_ID },
    { ...view, state: 'sent', proof: 'resolved-sent' },
    { ...view, state: 'refused', proof: 'before-dispatch', code: 'CG-CLAIM-BUSY' },
    { ...view, state: 'refused', proof: 'before-dispatch', code: 'CG-FAN-RATE-LIMIT' },
    { ...view, state: 'refused', proof: 'not-enqueued', code: 'CG-FNEW-HISTORY' },
    { ...view, state: 'refused', proof: 'native-rejected', code: 'CG-FAN-RATE-LIMIT', httpStatus: 429 },
    { ...view, state: 'refused', proof: 'native-rejected', code: 'CG-SEND-REJECTED', httpStatus: 400 },
    { ...view, state: 'refused', proof: 'resolved-not-sent' },
    { ...view, state: 'uncertain', code: 'CG-SEND-UNCERTAIN', cause: 'rejected-200' },
    { ...view, state: 'uncertain', code: 'CG-SEND-UNCERTAIN', cause: 'receipt-missing', receiptMessageId: FANSLY_MESSAGE_ID },
  ],
  invalid: [
    { ...view, state: 'receipted' },
    { ...view, state: 'ready', platformMessageId: FANSLY_MESSAGE_ID },
    { ...view, state: 'sent', proof: 'echo' },
    { ...view, state: 'sent', proof: 'receipt', platformMessageId: FANSLY_MESSAGE_ID },
    { ...view, state: 'refused', proof: 'native-rejected', code: 'CG-SEND-REJECTED', httpStatus: 401 },
    { ...view, state: 'refused', proof: 'native-rejected', code: 'CG-SEND-REJECTED', httpStatus: 503 },
    { ...view, state: 'refused', proof: 'native-rejected', code: 'CG-SEND-REJECTED' },
    { ...view, state: 'refused', proof: 'not-enqueued', code: 'CG-OP-INTERRUPTED', httpStatus: 400 },
    { ...view, state: 'refused', proof: 'not-enqueued' },
    { ...view, state: 'refused', proof: 'resolved-not-sent', code: 'CG-SEND-UNCERTAIN' },
    { ...view, state: 'refused', proof: 'before-dispatch', code: 'CG-FAN-01' },
    { ...view, state: 'uncertain', code: 'CG-SEND-REJECTED', cause: 'network' },
    { ...view, state: 'uncertain', code: 'CG-SEND-UNCERTAIN', cause: 'receipt-missing' },
    { ...view, state: 'uncertain', code: 'CG-SEND-UNCERTAIN', cause: 'network', receiptMessageId: FANSLY_MESSAGE_ID },
    { ...view, state: 'uncertain', code: 'CG-SEND-UNCERTAIN', cause: 'timeout' },
    { ...view, state: 'retrying' },
    { ...view, fanRef: Number(F.fan), state: 'ready' },
  ],
};

export const fanslyJournalEntry = {
  attemptId: uuid(402),
  hubOrigin: HUB,
  pageId: 12,
  hostAccountId: F.creator,
  fanRef: F.fan,
  groupId: F.group,
  admission: { kind: 'own' },
  group: fanslyManualGroup,
  draftRevision: 7,
  historyRevision: uuid(302),
  transport: 'direct',
  ticketExpiresAt: null,
  createdAt: T0,
  updatedAt: T0,
  state: 'routed',
} as const;
const ticketed = { ...fanslyJournalEntry, ticketExpiresAt: T0 + 9_000, updatedAt: T0 + 500 } as const;
const aiEntry = { admission: { kind: 'ai', generationRef: GENERATION, variant: 0 }, group: fanslyAiGroup } as const;

export const FANSLY_SEND_JOURNAL_FIXTURES: Verdicts = {
  valid: [
    fanslyJournalEntry,
    { ...ticketed, state: 'dispatched' },
    { ...ticketed, state: 'intentWritten', transport: 'tab' },
    { ...ticketed, state: 'requestStarted', ...aiEntry },
    { ...ticketed, state: 'receipted', platformMessageId: FANSLY_MESSAGE_ID },
    { ...ticketed, state: 'sent', proof: 'echo', platformMessageId: FANSLY_MESSAGE_ID, reportPending: true },
    { ...ticketed, state: 'sent', proof: 'resolved-sent', reportPending: false },
    { ...ticketed, state: 'refused', proof: 'native-rejected', code: 'CG-SEND-REJECTED', httpStatus: 400, reportPending: true },
    { ...fanslyJournalEntry, state: 'refused', proof: 'before-dispatch', code: 'CG-CLAIM-BUSY', reportPending: false },
    { ...fanslyJournalEntry, state: 'refused', proof: 'not-enqueued', code: 'CG-OP-INTERRUPTED', reportPending: true },
    { ...ticketed, state: 'uncertain', code: 'CG-SEND-UNCERTAIN', cause: 'restart' },
    { ...ticketed, state: 'uncertain', code: 'CG-SEND-UNCERTAIN', cause: 'rejected-200', admission: { kind: 'ai-edited', generationRef: GENERATION, variant: 1 } },
    { ...fanslyJournalEntry, fanRef: FANSLY_OLD_FAN, groupId: FANSLY_LONG_GROUP },
  ],
  invalid: [
    { ...fanslyJournalEntry, state: 'ready' },
    { ...fanslyJournalEntry, state: 'claimed' },
    { ...ticketed, state: 'routed' },
    { ...fanslyJournalEntry, state: 'intentWritten' },
    { ...fanslyJournalEntry, state: 'dispatched' },
    { ...fanslyJournalEntry, admission: { kind: 'ai', generationRef: GENERATION, variant: 0 } },
    { ...fanslyJournalEntry, group: fanslyAiGroup },
    { ...fanslyJournalEntry, ...aiEntry, admission: { kind: 'ai', generationRef: uuid(499), variant: 0 } },
    { ...fanslyJournalEntry, ...aiEntry, admission: { kind: 'ai', generationRef: GENERATION, variant: 1 } },
    { ...fanslyJournalEntry, text: 'Привет' },
    { ...fanslyJournalEntry, authorization: 'Bearer x' },
    { ...fanslyJournalEntry, updatedAt: T0 - 1 },
    { ...fanslyJournalEntry, state: 'refused', proof: 'before-dispatch', code: 'CG-CLAIM-BUSY', reportPending: true },
    { ...fanslyJournalEntry, state: 'refused', proof: 'before-dispatch', code: 'CG-CLAIM-BUSY' },
    { ...ticketed, state: 'uncertain', code: 'CG-SEND-UNCERTAIN', cause: 'restart', reportPending: false },
    { ...ticketed, state: 'sent', proof: 'echo', reportPending: true },
    { ...fanslyJournalEntry, transport: 'relay' },
    { ...fanslyJournalEntry, hubOrigin: 'hub.example.test' },
  ],
};

export const FANSLY_SEND_JOURNAL_VALUE_FIXTURES: Verdicts = {
  valid: [
    { v: 1, entries: [] },
    { v: 1, entries: [fanslyJournalEntry, { ...ticketed, attemptId: uuid(405), state: 'uncertain', code: 'CG-SEND-UNCERTAIN', cause: 'restart' }] },
  ],
  invalid: [{ v: 2, entries: [] }, { entries: [] }, { v: 1, entries: [{ ...fanslyJournalEntry, state: 'ready' }] }],
};

export const FANSLY_SEND_RECEIPT_FIXTURES: Verdicts = {
  valid: [
    { id: FANSLY_MESSAGE_ID, groupId: F.group, senderId: F.creator },
    { id: FANSLY_MESSAGE_ID, groupId: F.group, senderId: F.creator, content: 'Привет', type: 1, attachments: [], createdAt: 1_790_000_000 },
  ],
  invalid: [{ id: Number(FANSLY_MESSAGE_ID), groupId: F.group, senderId: F.creator }, { id: FANSLY_MESSAGE_ID, groupId: F.group }, {}],
};
