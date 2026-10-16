// The Fansly greeting send (1.15.0, R20 P4c; host: fansly-web;
// docs/project-unite/architecture.md §8.6): the request of «Новые», the
// manual group and the custody body against the hub's HF-3 shapes, the
// attempt's state machine, the journal `fansly.send.journal`, the restart and
// what each end owes the hub, the final check.

import { readFileSync } from 'node:fs';

import { describe, expect, expectTypeOf, it } from 'vitest';
import type * as z from 'zod/mini';

import * as C from '../src/index';
import * as S from '../src/send-fansly';
import {
  FANSLY_CLAIM_BODY_FIXTURES,
  FANSLY_CLAIM_OP_FIXTURES,
  FANSLY_GREETING_GROUP_FIXTURES,
  FANSLY_GREETING_REQUEST_FIXTURES,
  FANSLY_IDS,
  FANSLY_MESSAGE_ID,
  FANSLY_SEND_JOURNAL_FIXTURES,
  FANSLY_SEND_JOURNAL_VALUE_FIXTURES,
  FANSLY_SEND_RECEIPT_FIXTURES,
  FANSLY_SEND_VIEW_FIXTURES,
  TEXT_FINGERPRINT,
  fanslyAiGroup,
  fanslyDispatch,
  fanslyJournalEntry,
  fanslyManualGroup,
  uuid,
  type Verdicts,
} from './fixtures/index';

function expectVerdicts(label: string, schema: { safeParse(value: unknown): { success: boolean } }, verdicts: Verdicts): void {
  expect(verdicts.valid.length * verdicts.invalid.length, label).toBeGreaterThan(0);
  verdicts.valid.forEach((value, index) => expect(schema.safeParse(value).success, `${label} valid[${index}]`).toBe(true));
  verdicts.invalid.forEach((value, index) => expect(schema.safeParse(value).success, `${label} invalid[${index}]`).toBe(false));
}

describe('[host:fansly] the «Новые» greeting request (FS-NEW-3, FS-NEW-6)', () => {
  it('carries the field text, its revision, the reviewed history revision, the admission and the human action', () => {
    expectVerdicts('FanslyGreetingRequest', S.FanslyGreetingRequestSchema, FANSLY_GREETING_REQUEST_FIXTURES);
    expect(Object.keys(S.FanslyGreetingRequestSchema.def.shape).sort()).toEqual(
      ['admission', 'attemptId', 'cause', 'draftRevision', 'fanRef', 'groupId', 'historyRevision', 'hostAccountId', 'passId', 'text'].sort(),
    );
  });

  it('takes Fansly ids as strings of 17, 18 and 19 digits, never as numbers', () => {
    for (const fanRef of ['70000000000000005', FANSLY_IDS.fan, '1000000000000000002']) {
      expect(S.FanslyGreetingRequestSchema.safeParse({ ...FANSLY_GREETING_REQUEST_FIXTURES.valid[0] as object, fanRef }).success, fanRef).toBe(true);
    }
    expect(S.FanslyGreetingRequestSchema.safeParse({ ...FANSLY_GREETING_REQUEST_FIXTURES.valid[0] as object, fanRef: Number(FANSLY_IDS.fan) }).success).toBe(false);
  });

  it('the admission decides the group: an unchanged AI text goes as its generation, every other text as a manual group', () => {
    const ai = { kind: 'ai', generationRef: uuid(401), variant: 1 } as const;
    expect(S.fanslyGreetingGroup(ai, TEXT_FINGERPRINT)).toEqual({ generationRef: uuid(401), variant: 1, partCount: 1 });
    expect(S.fanslyGreetingGroup({ kind: 'own' }, TEXT_FINGERPRINT)).toEqual(fanslyManualGroup);
    expect(S.fanslyGreetingGroup({ ...ai, kind: 'ai-edited' }, TEXT_FINGERPRINT)).toEqual(fanslyManualGroup);
    for (const admission of [ai, { kind: 'own' } as const, { ...ai, kind: 'ai-edited' } as const]) {
      expect(S.admissionFitsGroup(admission, S.fanslyGreetingGroup(admission, TEXT_FINGERPRINT))).toBe(true);
    }
    expect(S.admissionFitsGroup({ kind: 'own' }, fanslyAiGroup)).toBe(false);
    expect(S.admissionFitsGroup(ai, fanslyManualGroup)).toBe(false);
    expect(S.admissionFitsGroup({ ...ai, variant: 0 }, { ...fanslyAiGroup, generationRef: uuid(401), variant: 1 })).toBe(false);
  });
});

describe('[host:fansly] the manual group and the custody body (hub HF-3)', () => {
  it('groups: one-part AI or the fingerprint of the exact text, and the ref the hub answers for each', () => {
    expectVerdicts('FanslyGreetingGroup', S.FanslyGreetingGroupSchema, FANSLY_GREETING_GROUP_FIXTURES);
    expect(S.greetingGroupRef(fanslyManualGroup)).toBe(`manual:${TEXT_FINGERPRINT}`);
    expect(S.greetingGroupRef(fanslyAiGroup)).toBe(fanslyAiGroup.generationRef);
    expect(`manual:${TEXT_FINGERPRINT}`.length).toBeLessThanOrEqual(100);
  });

  it('the Fansly body: greeting only, one part, dispatch under the lease, a refusal proven by a 4xx other than 401', () => {
    expectVerdicts('FanslyGreetingClaimBody', S.FanslyGreetingClaimBodySchema, FANSLY_CLAIM_BODY_FIXTURES);
    expectVerdicts('FanslyGreetingClaimOp', S.FanslyGreetingClaimOpSchema, FANSLY_CLAIM_OP_FIXTURES);
  });

  it('what the hub refuses (HF-3) it refuses too; the hub\'s real schema checks both ways in sdk-alignment.test.ts', () => {
    // A reply's manual group, two parts of a manual group, a text beside the fingerprint, a 401 as proof, a mixed group.
    // The vendored SDK's `clientFanClaim` body (hub bd3eec06, past HF-3) is checked against the same bodies and every
    // valid fixture in `packages/testing/src/scenarios/hub/sdk-alignment.test.ts`: this package does not import the SDK.
    const hubRefuses = [
      { ...fanslyDispatch, purpose: 'preview-reply' },
      { ...fanslyDispatch, partIndex: 1 },
      { ...fanslyDispatch, group: { ...fanslyManualGroup, text: 'Привет' } },
      { action: 'failed', attemptId: uuid(402), instanceId: uuid(404), reason: 'native_rejected', httpStatus: 401 },
      { ...fanslyDispatch, group: { ...fanslyManualGroup, generationRef: uuid(401) } },
    ];
    for (const body of hubRefuses) expect(S.FanslyGreetingClaimBodySchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
  });

  it('the OnlyFans body is unchanged: AI groups only, the manual one is refused there', () => {
    const aiDispatch = { ...fanslyDispatch, group: { ...fanslyAiGroup } };
    expect(C.ClaimBodySchema.safeParse(aiDispatch).success).toBe(true);
    expect(C.ClaimBodySchema.safeParse(fanslyDispatch).success).toBe(false);
  });

  it('the types: both bodies are of the hub’s wider body, which the shared code names', () => {
    expectTypeOf<S.FanslyGreetingClaimBody>().toExtend<C.HubClaimBody>();
    expectTypeOf<C.ClaimBody>().toExtend<C.HubClaimBody>();
    expectTypeOf<S.FanslyGreetingClaimOp>().toExtend<C.HubClaimOp>();
    expectTypeOf<S.FanslyGreetingGroup>().toExtend<C.ClaimSendGroup>();
    expectTypeOf<z.infer<typeof S.ManualClaimGroupSchema>>().toEqualTypeOf<{ kind: 'manual'; textFingerprint: string }>();
  });
});

const view = { attemptId: uuid(402), fanRef: FANSLY_IDS.fan } as const;
type Outcome = S.FanslySendOutcome;
const at = (state: Exclude<S.FanslySendState, 'receipted' | 'sent' | 'refused' | 'uncertain'>): Outcome => ({ state });
const receipted = (id: string = FANSLY_MESSAGE_ID): Outcome => ({ state: 'receipted', platformMessageId: id });
const sent = (proof: S.FanslySentProof, id?: string): Outcome => (id === undefined ? { state: 'sent', proof } : { state: 'sent', proof, platformMessageId: id });
const refused = (proof: S.FanslyRefusalProof, httpStatus?: number): Outcome =>
  proof === 'resolved-not-sent' ? { state: 'refused', proof } : { state: 'refused', proof, code: 'CG-SEND-REJECTED', ...(httpStatus === undefined ? {} : { httpStatus }) };
const uncertain = (cause: S.FanslyUncertainCause, receiptMessageId?: string): Outcome => ({
  state: 'uncertain',
  code: 'CG-SEND-UNCERTAIN',
  cause,
  ...(receiptMessageId === undefined ? {} : { receiptMessageId }),
});

describe('[host:fansly] the attempt’s state machine (architecture §8.6)', () => {
  it('views and journal records hold each end together', () => {
    expectVerdicts('FanslySendView', S.FanslySendViewSchema, FANSLY_SEND_VIEW_FIXTURES);
    expectVerdicts('FanslySendJournalEntry', S.FanslySendJournalEntrySchema, FANSLY_SEND_JOURNAL_FIXTURES);
    expectVerdicts('FanslySendJournal', S.FanslySendJournalSchema, FANSLY_SEND_JOURNAL_VALUE_FIXTURES);
    expectVerdicts('FanslySendReceipt', S.FanslySendReceiptSchema, FANSLY_SEND_RECEIPT_FIXTURES);
  });

  it('the happy path: ready → claimed → routed → dispatched → intentWritten → requestStarted → receipted → sent', () => {
    const path: Outcome[] = [at('ready'), at('claimed'), at('routed'), at('dispatched'), at('intentWritten'), at('requestStarted'), receipted(), sent('echo', FANSLY_MESSAGE_ID)];
    for (let i = 1; i < path.length; i += 1) expect(S.isFanslySendStep(path[i - 1] as Outcome, path[i] as Outcome), `${path[i - 1]?.state} → ${path[i]?.state}`).toBe(true);
    for (const outcome of path) expect(S.FanslySendViewSchema.safeParse({ ...view, ...outcome }).success, outcome.state).toBe(true);
  });

  it('nothing ever leads to ready, and every edge the table lacks is refused', () => {
    for (const from of S.FANSLY_SEND_STATES) expect(S.FANSLY_SEND_TRANSITIONS[from] as readonly string[], from).not.toContain('ready');
    const samples: Record<S.FanslySendState, Outcome> = {
      ready: at('ready'),
      claimed: at('claimed'),
      routed: at('routed'),
      dispatched: at('dispatched'),
      intentWritten: at('intentWritten'),
      requestStarted: at('requestStarted'),
      receipted: receipted(),
      sent: sent('resolved-sent'),
      refused: refused('resolved-not-sent'),
      uncertain: uncertain('receipt-missing', FANSLY_MESSAGE_ID),
    };
    for (const from of S.FANSLY_SEND_STATES) {
      for (const to of S.FANSLY_SEND_STATES) {
        if (from === to || (S.FANSLY_SEND_TRANSITIONS[from] as readonly string[]).includes(to)) continue;
        expect(S.isFanslySendStep(samples[from], samples[to]), `${from} → ${to}`).toBe(false);
      }
    }
  });

  it('sent and refused end it; the same state is no step unless nothing changed', () => {
    expect(S.FANSLY_SEND_TRANSITIONS.sent).toEqual([]);
    expect(S.FANSLY_SEND_TRANSITIONS.refused).toEqual([]);
    expect(S.isFanslySendStep(sent('echo', FANSLY_MESSAGE_ID), sent('echo', FANSLY_MESSAGE_ID))).toBe(true);
    expect(S.isFanslySendStep(sent('echo', FANSLY_MESSAGE_ID), sent('echo', '700000000000000051'))).toBe(false);
    expect(S.isFanslySendStep(uncertain('network'), uncertain('server'))).toBe(false);
    expect(S.isFanslySendStep(refused('not-enqueued'), refused('resolved-not-sent'))).toBe(false);
  });

  it('uncertain leaves only by a proof: the late echo or history of its own receipt, or the hub’s resolve', () => {
    expect(S.isFanslySendStep(uncertain('network'), sent('echo', FANSLY_MESSAGE_ID))).toBe(false);
    expect(S.isFanslySendStep(uncertain('rejected-200'), sent('history', FANSLY_MESSAGE_ID))).toBe(false);
    expect(S.isFanslySendStep(uncertain('receipt-missing', FANSLY_MESSAGE_ID), sent('echo', FANSLY_MESSAGE_ID))).toBe(true);
    expect(S.isFanslySendStep(uncertain('receipt-missing', FANSLY_MESSAGE_ID), sent('history', '700000000000000051'))).toBe(false);
    expect(S.isFanslySendStep(uncertain('restart'), sent('resolved-sent'))).toBe(true);
    expect(S.isFanslySendStep(uncertain('restart'), refused('resolved-not-sent'))).toBe(true);
    for (const proof of ['before-dispatch', 'not-enqueued', 'native-rejected'] as const) {
      expect(S.isFanslySendStep(uncertain('restart'), refused(proof, 400)), proof).toBe(false);
    }
    expect(S.isFanslySendStep(uncertain('restart'), at('ready'))).toBe(false);
    expect(S.isFanslySendStep(uncertain('restart'), at('requestStarted'))).toBe(false);
  });

  it('a send is proven only by the receipt’s own id; a receipt goes uncertain only when the history misses it', () => {
    expect(S.isFanslySendStep(receipted(), sent('echo', '700000000000000051'))).toBe(false);
    expect(S.isFanslySendStep(receipted(), sent('resolved-sent'))).toBe(false);
    expect(S.isFanslySendStep(receipted(), uncertain('receipt-missing', FANSLY_MESSAGE_ID))).toBe(true);
    expect(S.isFanslySendStep(receipted(), uncertain('receipt-missing', '700000000000000051'))).toBe(false);
    expect(S.isFanslySendStep(receipted(), uncertain('restart'))).toBe(false);
    expect(S.isFanslySendStep(at('requestStarted'), uncertain('receipt-missing', FANSLY_MESSAGE_ID))).toBe(false);
  });

  it('before the intent nothing can be uncertain; between the intent and fetch only a restart can', () => {
    for (const state of ['ready', 'claimed', 'routed', 'dispatched'] as const) expect(S.isFanslySendStep(at(state), uncertain('restart')), state).toBe(false);
    expect(S.isFanslySendStep(at('intentWritten'), uncertain('restart'))).toBe(true);
    expect(S.isFanslySendStep(at('intentWritten'), uncertain('network'))).toBe(false);
    for (const cause of ['restart', 'network', 'server', 'unauthorized', 'rejected-200', 'bad-receipt', 'relay'] as const) {
      expect(S.isFanslySendStep(at('requestStarted'), uncertain(cause)), cause).toBe(true);
    }
    // The write is the only pause: no fetch without it.
    expect(S.isFanslySendStep(at('dispatched'), at('requestStarted'))).toBe(false);
    expect(S.isFanslySendStep(at('routed'), at('intentWritten'))).toBe(false);
  });

  it('refusals: each by the proof its state admits', () => {
    expect(S.isFanslySendStep(at('ready'), refused('before-dispatch'))).toBe(true);
    expect(S.isFanslySendStep(at('routed'), refused('not-enqueued'))).toBe(true);
    expect(S.isFanslySendStep(at('dispatched'), refused('before-dispatch'))).toBe(false);
    expect(S.isFanslySendStep(at('intentWritten'), refused('not-enqueued'))).toBe(true);
    expect(S.isFanslySendStep(at('intentWritten'), refused('native-rejected', 400))).toBe(false);
    expect(S.isFanslySendStep(at('requestStarted'), refused('native-rejected', 429))).toBe(true);
    expect(S.isFanslySendStep(at('requestStarted'), refused('before-dispatch'))).toBe(false);
    expect(S.isFanslySendStep(receipted(), refused('native-rejected', 400))).toBe(false);
  });

  it('a 200 {success: false} is uncertain and owes the hub nothing: the custody stays held there (HF-3)', () => {
    const outcome = uncertain('rejected-200');
    expect(S.isFanslySendStep(at('requestStarted'), outcome)).toBe(true);
    expect(S.fanslyCustodyReport(outcome)).toBeNull();
    expect(S.isFanslyRetryableEnd(outcome)).toBe(false);
  });
});

describe('[host:fansly] the journal, a restart and the custody', () => {
  it('holds ids only: no text, no session header, strict', () => {
    const keys = new Set<string>();
    for (const option of S.FanslySendJournalEntrySchema.def.options) for (const key of Object.keys(option.def.shape)) keys.add(key);
    expect([...keys].sort()).toEqual(
      [
        'admission',
        'attemptId',
        'browserResend',
        'cause',
        'code',
        'createdAt',
        'draftRevision',
        'fanRef',
        'group',
        'groupId',
        'historyRevision',
        'hostAccountId',
        'httpStatus',
        'hubOrigin',
        'pageId',
        'platformMessageId',
        'proof',
        'receiptMessageId',
        'reportPending',
        'requestId',
        'state',
        'ticketExpiresAt',
        'transport',
        'updatedAt',
      ].sort(),
    );
    expect(S.FANSLY_SEND_JOURNAL_KEY).toBe('fansly.send.journal');
    expect(Object.values(C.STORAGE_KEYS)).not.toContain(S.FANSLY_SEND_JOURNAL_KEY);
  });

  it('a restart: before the intent → refused, not enqueued; after it → uncertain; a receipt and an end stay', () => {
    for (const state of S.FANSLY_SEND_JOURNAL_STATES) {
      const next = S.FANSLY_SEND_RECOVERY[state];
      if (next === null) {
        expect(['receipted', 'sent', 'refused', 'uncertain'], state).toContain(state);
        continue;
      }
      expect(S.isFanslySendStep(at(state as 'routed'), next), state).toBe(true);
      expect(next.state === 'refused' ? next.proof : next.cause, state).toBe(state === 'routed' || state === 'dispatched' ? 'not-enqueued' : 'restart');
      expect(S.FanslySendViewSchema.safeParse({ ...view, ...next }).success, state).toBe(true);
    }
    expect(S.FANSLY_SEND_JOURNAL_STATES).not.toContain('ready');
    expect(S.FANSLY_SEND_JOURNAL_STATES).not.toContain('claimed');
  });

  it('what each end owes the hub’s custody', () => {
    expect(S.fanslyCustodyReport(refused('not-enqueued'))).toBe('failed-not-enqueued');
    expect(S.fanslyCustodyReport(refused('native-rejected', 403))).toBe('failed-native-rejected');
    expect(S.fanslyCustodyReport(refused('before-dispatch'))).toBeNull();
    expect(S.fanslyCustodyReport(refused('resolved-not-sent'))).toBeNull();
    expect(S.fanslyCustodyReport(sent('echo', FANSLY_MESSAGE_ID))).toBe('sent');
    expect(S.fanslyCustodyReport(sent('history', FANSLY_MESSAGE_ID))).toBe('sent');
    expect(S.fanslyCustodyReport(sent('resolved-sent'))).toBeNull();
    for (const state of ['ready', 'claimed', 'routed', 'dispatched', 'intentWritten', 'requestStarted'] as const) expect(S.fanslyCustodyReport(at(state))).toBeNull();
    expect(S.fanslyCustodyReport(receipted())).toBeNull();
  });

  it('open attempts hold the fan; only a refusal a new click can lift lets one start again', () => {
    for (const state of ['ready', 'sent', 'refused'] as const) expect(S.isFanslySendOpen(state), state).toBe(false);
    for (const state of ['claimed', 'routed', 'dispatched', 'intentWritten', 'requestStarted', 'receipted', 'uncertain'] as const) expect(S.isFanslySendOpen(state), state).toBe(true);
    expect(S.isFanslyRetryableEnd({ state: 'refused', proof: 'not-enqueued', code: 'CG-FNEW-HISTORY' })).toBe(true);
    expect(S.isFanslyRetryableEnd({ state: 'refused', proof: 'native-rejected', code: 'CG-FAN-RATE-LIMIT', httpStatus: 429 })).toBe(true);
    expect(S.isFanslyRetryableEnd(refused('resolved-not-sent'))).toBe(true);
    for (const code of S.FANSLY_SEND_CODES_WITHOUT_RETRY) expect(S.isFanslyRetryableEnd({ state: 'refused', proof: 'before-dispatch', code }), code).toBe(false);
    expect(S.isFanslyRetryableEnd(sent('echo', FANSLY_MESSAGE_ID))).toBe(false);
    expect(S.isFanslyRetryableEnd(uncertain('restart'))).toBe(false);
    expect(S.fanslySendLockKey(fanslyJournalEntry)).toBe(`https://hub.example.test|12|fansly|${FANSLY_IDS.fan}`);
  });

  it('every code the attempt may carry is a known one', () => {
    for (const code of S.FANSLY_SEND_CODES_WITHOUT_RETRY) expect(C.isCgCode(code) || code.startsWith('CG-FNEW-'), code).toBe(true);
    for (const next of Object.values(S.FANSLY_SEND_RECOVERY)) if (next !== null) expect(C.isCgCode(next.code), next.code).toBe(true);
  });
});

describe('[host:fansly] the final check (§8.6, step 2) and the receipt', () => {
  const taken: S.FanslySendTuple = {
    hostAccountId: FANSLY_IDS.creator,
    groupId: FANSLY_IDS.group,
    fanRef: FANSLY_IDS.fan,
    tabSessionId: uuid(501),
    transport: `tab:${uuid(501)}`,
    historyRevision: uuid(302),
    draftRevision: 7,
  };

  it('passes only when nothing moved and the ticket still runs', () => {
    expect(S.fanslyFinalCheck(taken, { ...taken }, 2000, 1999)).toEqual({ ok: true });
    expect(S.fanslyFinalCheck(taken, { ...taken }, 2000, 2000)).toEqual({ ok: false, field: 'ticket' });
  });

  it('names the first field that moved — every field of the tuple counts', () => {
    const moved: { readonly [K in keyof S.FanslySendTuple]: S.FanslySendTuple[K] } = {
      hostAccountId: '700000000000000009',
      groupId: FANSLY_IDS.otherGroup,
      fanRef: '700000000000000008',
      tabSessionId: uuid(502),
      transport: 'direct',
      historyRevision: uuid(303),
      draftRevision: 8,
    };
    expect([...S.FANSLY_SEND_TUPLE_FIELDS].sort()).toEqual(Object.keys(taken).sort());
    for (const field of S.FANSLY_SEND_TUPLE_FIELDS) expect(S.fanslyFinalCheck(taken, { ...taken, [field]: moved[field] }, 2000, 0), field).toEqual({ ok: false, field });
  });

  it('a receipt counts only for this group and this creator', () => {
    const receipt = { id: FANSLY_MESSAGE_ID, groupId: FANSLY_IDS.group, senderId: FANSLY_IDS.creator };
    expect(S.fanslyReceiptFits(receipt, taken)).toBe(true);
    expect(S.fanslyReceiptFits({ ...receipt, groupId: FANSLY_IDS.otherGroup }, taken)).toBe(false);
    expect(S.fanslyReceiptFits({ ...receipt, senderId: FANSLY_IDS.fan }, taken)).toBe(false);
  });
});

describe('[host:fansly] send-fansly stays Fansly’s own module (§1.8, §3.2)', () => {
  it('is a subpath only: the root re-exports none of it', () => {
    const root = Object.keys(C);
    for (const name of Object.keys(S)) expect(root, name).not.toContain(name);
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { exports: Record<string, string> };
    expect(manifest.exports['./send-fansly']).toBe('./src/send-fansly.ts');
  });

  it('the hub’s wider body is types only, apart from newcomers.ts: no value reaches a shared bundle', () => {
    const source = readFileSync(new URL('../src/hub/claim-body.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/^import type \{[^}]*\} from '\.\/newcomers';$/m);
    expect(source).not.toMatch(/^export (const|function|let|class|enum)\b/m);
    expect(source).not.toMatch(/send-fansly'/);
    const index = readFileSync(new URL('../src/hub/index.ts', import.meta.url), 'utf8');
    expect(index).toMatch(/^export type \* from '\.\/claim-body';$/m);
  });
});
