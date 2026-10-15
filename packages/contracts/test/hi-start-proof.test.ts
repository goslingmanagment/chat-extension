// HF-5's shared matrix, copied verbatim. P6c2 owns the gate/handler's verdicts; these tests own the wire schema.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, expectTypeOf, it } from 'vitest';

import { FanslyAvatarUrlSchema, StartProofV1Schema } from '../src/fansly';
import * as C from '../src/index';
import { START_PROOF_FIXTURES, emptyStartProof, passStartProof, tabStartProof } from './fixtures/fansly';
import { cause, fanslyTarget, target, uuid } from './fixtures/samples';

const bytes = readFileSync(new URL('./fixtures/ai-hi-start-proof-matrix.json', import.meta.url));
// Hub HF-5 (#600): unchanged between deployed bd3eec065 (the vendored SDK) and origin/main be3e7926, 2026-10-15.
const HUB_MATRIX_SHA256 = '7ec4b90b91f696018de72193d8325662030e55e4a2661cabc90945f5203383b2';
interface ShapeCase {
  readonly name: string;
  readonly feature: string;
  readonly platform: string;
  readonly clientContext: boolean;
  readonly capabilities: readonly string[];
  readonly conversationRef: string;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly refusal: string | null;
}
const matrix = JSON.parse(bytes.toString('utf8')) as {
  readonly version: number;
  readonly proofs: { readonly valid: readonly { readonly name: string; readonly proof: unknown }[]; readonly invalid: readonly { readonly name: string; readonly proof: unknown }[] };
  readonly shapeCases: readonly ShapeCase[];
};
const body = { clientRequestId: uuid(44), pageLabel: 'test-page', platform: 'fansly', conversationRef: tabStartProof.groupId };
const start = { feature: 'hi', surface: 'dock', target: fanslyTarget, cause, tone: null, split: false, window: 100 };
const fields = { startProof: tabStartProof, personalMessageCount: tabStartProof.personalCount, fanAvatarUrl: 'https://cdn3.fansly.com/avatar.jpg' };

describe('[host:fansly] Hi start proof (1.15.0, P4b4; architecture §5.8, §11.2, §12)', () => {
  it('the matrix is the hub file byte for byte; its 21 proofs are the page fixtures of P4a2', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(HUB_MATRIX_SHA256);
    expect(matrix.version).toBe(1);
    expect(matrix.proofs.valid.map((c) => c.proof)).toEqual(START_PROOF_FIXTURES.valid);
    expect(matrix.proofs.invalid.map((c) => c.proof)).toEqual(START_PROOF_FIXTURES.invalid);
  });

  for (const [verdict, cases] of Object.entries(matrix.proofs)) {
    for (const c of cases) it(`${verdict}: ${c.name}`, () => {
      const accepted = verdict === 'valid';
      expect(StartProofV1Schema.safeParse(c.proof).success).toBe(accepted);
      expect(C.AiFeatureStreamBodySchema.safeParse({ ...body, startProof: c.proof }).success).toBe(accepted);
      expect(C.StartOpSchema.safeParse({ ...start, startProof: c.proof }).success).toBe(accepted);
    });
  }

  for (const c of matrix.shapeCases) it(`request shape: ${c.name}`, () => {
    const request = { feature: c.feature, capabilities: c.capabilities, body: {
      ...body, platform: c.platform, conversationRef: c.conversationRef, ...c.fields,
      // This client never sends clientContext; even the old client's valid context is an extra field here.
      ...(c.clientContext ? { clientContext: { transcript: 'hi' } } : {}),
    } };
    expect(C.HubStreamRequestSchema.safeParse(request).success).toBe(c.refusal === null);
  });

  it('each of the three fields independently requires Fansly Hi and its capability; op and body keep all fields', () => {
    expect(C.StartOpSchema.parse({ ...start, ...fields })).toMatchObject(fields);
    expect(C.AiFeatureStreamBodySchema.parse({ ...body, ...fields })).toMatchObject(fields);
    for (const [key, value] of Object.entries(fields)) {
      const one = { [key]: value };
      expect(C.StartOpSchema.safeParse({ ...start, ...one, feature: 'ping' }).success).toBe(false);
      expect(C.StartOpSchema.safeParse({ ...start, ...one, target }).success).toBe(false);
      for (const capabilities of [[], ['context-v1']]) {
        expect(C.HubStreamRequestSchema.safeParse({ feature: 'hi-greeting', body: { ...body, ...one }, capabilities }).success).toBe(false);
      }
      expect(C.HubStreamRequestSchema.safeParse({ feature: 'hi-greeting', body: { ...body, ...one, platform: 'onlyfans' }, capabilities: ['hi-start-proof-v1'] }).success).toBe(false);
    }
  });

  it('the site policy can hand all three Hi fields to the shared start (F10)', () => {
    expectTypeOf<C.AiStartFields['startProof']>().toEqualTypeOf<C.StartOp['startProof']>();
    expectTypeOf<C.AiStartFields['personalMessageCount']>().toEqualTypeOf<C.StartOp['personalMessageCount']>();
    expectTypeOf<C.AiStartFields['fanAvatarUrl']>().toEqualTypeOf<C.StartOp['fanAvatarUrl']>();
    const policyFields: C.AiStartFields = { ...fields, startProof: StartProofV1Schema.parse(fields.startProof) };
    expect(C.StartOpSchema.parse({ ...start, ...policyFields })).toMatchObject(fields);
  });

  it('the op rejects a different chat or count; a missing proof stays missing and 11 personal is a gate decision', () => {
    expect(C.StartOpSchema.safeParse({ ...start, ...fields, personalMessageCount: 3 }).success).toBe(false);
    expect(C.StartOpSchema.safeParse({ ...start, startProof: { ...tabStartProof, groupId: '9' } }).success).toBe(false);
    expect(C.StartOpSchema.parse(start).startProof).toBeUndefined();
    expect(C.StartOpSchema.parse({ ...start, personalMessageCount: 0 }).startProof).toBeUndefined();
    for (const proof of [emptyStartProof, passStartProof, { ...tabStartProof, coveredCount: 41, personalCount: 11 }]) {
      expect(C.StartOpSchema.safeParse({ ...start, startProof: proof }).success).toBe(true);
      expect(C.HubStreamRequestSchema.safeParse({ feature: 'hi-greeting', body: { ...body, startProof: proof }, capabilities: ['hi-start-proof-v1'] }).success).toBe(true);
    }
  });

  it('the avatar has the hub’s exact address rule (FX-018), and the count is a non-negative integer', () => {
    const prefix = 'https://cdn-3.fansly.com/';
    const maxAvatar = prefix + 'a'.repeat(4096 - prefix.length);
    for (const [fanAvatarUrl, accepted] of [
      [fields.fanAvatarUrl, true], [maxAvatar, true], [maxAvatar + 'a', false],
      ['http://cdn3.fansly.com/a', false], ['https://fansly.com/a', false],
      ['https://CDN3.fansly.com/a', false], ['https://cdn3.fansly.com.evil.test/a', false],
    ] as const) {
      expect(FanslyAvatarUrlSchema.safeParse(fanAvatarUrl).success).toBe(accepted);
      expect(C.AiFeatureStreamBodySchema.safeParse({ ...body, fanAvatarUrl }).success).toBe(accepted);
    }
    for (const personalMessageCount of [-1, 0.5, '0', null]) {
      expect(C.AiFeatureStreamBodySchema.safeParse({ ...body, personalMessageCount }).success).toBe(false);
      expect(C.StartOpSchema.safeParse({ ...start, personalMessageCount }).success).toBe(false);
    }
  });
});
