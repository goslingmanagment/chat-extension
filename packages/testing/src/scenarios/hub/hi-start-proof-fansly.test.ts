// P4b4: contracts versus the deployed hub SDK, without a request to a live service.
import { readFileSync } from 'node:fs';

import { AI_REQUEST_LIMITS, AI_STREAM_CAPABILITIES, CLIENT_HUB_CAPABILITY_NAMES, COACH_LIMITS, COVERAGE_CHECK_LIMITS, LIVE_TEXT_LIMITS, NOTE_FILL_LIMITS, SEND_LIMITS, AiFeatureStreamBodySchema } from '@cg/contracts';
import { FANSLY_LIMITS, FanslyAvatarUrlSchema, START_PROOF_SOURCES, StartProofV1Schema } from '@cg/contracts/fansly';
import { ISO, uuid } from '@cg/contracts/fixtures';
import { AI_START_PROOF_AUTOMATED_IDS_MAX, AI_START_PROOF_PASS_PERSONAL_WINDOW, AI_START_PROOF_SOURCES, AI_STREAM_CAPABILITIES as SDK_AI_STREAM_CAPABILITIES, CLIENT_HUB_CAPABILITY_NAMES as SDK_CLIENT_HUB_CAPABILITY_NAMES, routeSchemas } from '@kernel/sdk';
import { describe, expect, it } from 'vitest';

const realBody = routeSchemas.aiFeatureStream.body;
const matrix = JSON.parse(readFileSync(new URL('../../../../contracts/test/fixtures/ai-hi-start-proof-matrix.json', import.meta.url), 'utf8')) as {
  readonly proofs: { readonly valid: readonly { readonly name: string; readonly proof: unknown }[]; readonly invalid: readonly { readonly name: string; readonly proof: unknown }[] };
  readonly shapeCases: readonly { readonly name: string; readonly fields: { readonly startProof?: unknown } }[];
  readonly gateCases: readonly { readonly name: string; readonly proof: unknown }[];
};
const body = { clientRequestId: uuid(44), pageLabel: 'test-page', platform: 'fansly', conversationRef: '700000000000000003' };

describe('[host:fansly] Hi wire values agree with the deployed HF-5 SDK (P4b4)', () => {
  it('the sources, limits and capability agree with the SDK', () => {
    expect(START_PROOF_SOURCES).toEqual(AI_START_PROOF_SOURCES);
    expect(FANSLY_LIMITS.automatedIdsMax).toBe(AI_START_PROOF_AUTOMATED_IDS_MAX);
    expect(FANSLY_LIMITS.passPersonalWindow).toBe(AI_START_PROOF_PASS_PERSONAL_WINDOW);
    for (const names of [AI_STREAM_CAPABILITIES, CLIENT_HUB_CAPABILITY_NAMES, SDK_AI_STREAM_CAPABILITIES, SDK_CLIENT_HUB_CAPABILITY_NAMES]) expect(names).toContain('hi-start-proof-v1');
  });

  for (const [verdict, cases] of Object.entries(matrix.proofs)) {
    for (const c of cases) it(`${verdict}: ${c.name}`, () => {
      const accepted = verdict === 'valid';
      expect(StartProofV1Schema.safeParse(c.proof).success).toBe(accepted);
      expect(realBody.shape.startProof.unwrap().safeParse(c.proof).success).toBe(accepted);
      expect(AiFeatureStreamBodySchema.safeParse({ ...body, startProof: c.proof }).success).toBe(accepted);
      expect(realBody.safeParse({ ...body, startProof: c.proof }).success).toBe(accepted);
    });
  }

  it('the proofs carried by every request-shape and gate case also agree with the SDK', () => {
    const cases = [
      ...matrix.shapeCases.filter((c) => c.fields.startProof !== undefined).map((c) => ({ name: c.name, proof: c.fields.startProof })),
      ...matrix.gateCases.filter((c) => c.proof !== null),
    ];
    for (const c of cases) {
      expect(StartProofV1Schema.safeParse(c.proof).success, c.name).toBe(realBody.shape.startProof.unwrap().safeParse(c.proof).success);
    }
  });

  it('[FX-018] the avatar at the top level is the old clientContext avatar schema, including its exact prefix and 4096 limit', () => {
    const prefix = 'https://cdn-3.fansly.com/';
    const max = prefix + 'a'.repeat(4096 - prefix.length);
    for (const value of [prefix, max, max + 'a', 'http://cdn3.fansly.com/a', 'https://fansly.com/a', 'https://cdn3.fansly.com.evil.test/a', 'https://CDN3.fansly.com/a', 'https://cdn3.fansly.com:443/a', null, 123]) {
      const accepted = FanslyAvatarUrlSchema.safeParse(value).success;
      expect(realBody.shape.fanAvatarUrl.safeParse(value).success).toBe(accepted);
      expect(realBody.shape.clientContext.unwrap().shape.fanAvatarUrl.safeParse(value).success).toBe(accepted);
    }
  });

  it('the count is optional, non-negative and integral, with no old clientContext cap of 5000', () => {
    for (const personalMessageCount of [undefined, 0, 10, 11, 5001, Number.MAX_SAFE_INTEGER, -1, 0.5, null, '0']) {
      const request = { ...body, personalMessageCount };
      expect(AiFeatureStreamBodySchema.safeParse(request).success).toBe(realBody.safeParse(request).success);
    }
  });

  it('the client body at its field caps fits the hub byte limit, counting all Hi fields and six-byte JSON escapes', () => {
    // The feature and lane are checked after the body limit. Count every field together, including ones no feature
    // sends together. This client never sends clientContext; the hub's larger worst case remains its own test.
    const text = (n: number) => '\u0000'.repeat(n);
    const id = (n: number) => `1${String(n).padStart(29, '0')}`;
    const avatarPrefix = 'https://a.fansly.com/';
    const request = {
      clientRequestId: uuid(44), pageLabel: text(120), platform: 'fansly', conversationRef: id(0), fanRef: id(1),
      personaKey: text(120), expectedPersonaDefinitionId: text(100),
      replyTone: 'casual', replyMode: 'preferSplit', messageCount: AI_REQUEST_LIMITS.messageCountMax,
      draftText: text(AI_REQUEST_LIMITS.draftMaxChars), isRegeneration: false,
      chatterQuestion: text(COACH_LIMITS.questionMaxChars),
      coachHistory: Array.from({ length: COACH_LIMITS.historyMaxTurns }, () => ({ question: text(COACH_LIMITS.questionMaxChars), answer: text(COACH_LIMITS.answerMaxChars) })),
      preset: 'situation', summaryMode: 'short', variantCount: 3,
      noteFields: Array.from({ length: NOTE_FILL_LIMITS.fieldsMax }, (_, i) => text(NOTE_FILL_LIMITS.labelMaxChars - 2) + String(i).padStart(2, '0')),
      knownFanMessageIds: Array.from({ length: SEND_LIMITS.knownFanMessagesMax }, (_, i) => id(i)),
      liveTextContext: { capturedAt: ISO, items: Array.from({ length: LIVE_TEXT_LIMITS.maxItems }, (_, i) => ({ platformMessageId: id(i), direction: 'model', occurredAt: ISO, text: text(LIVE_TEXT_LIMITS.maxChars) })) },
      coverageCheck: {
        window: Array.from({ length: COVERAGE_CHECK_LIMITS.windowMax }, (_, i) => ({ id: id(i), dir: 'model' })),
        deletedIds: Array.from({ length: COVERAGE_CHECK_LIMITS.deletedMax }, (_, i) => id(i + COVERAGE_CHECK_LIMITS.windowMax)),
      },
      startProof: {
        v: 1, source: 'tab-short-page', groupId: id(0), startWitnessId: id(0), coveredCount: Number.MAX_SAFE_INTEGER,
        personalCount: Number.MAX_SAFE_INTEGER - FANSLY_LIMITS.automatedIdsMax,
        automatedIds: Array.from({ length: FANSLY_LIMITS.automatedIdsMax }, (_, i) => id(i)),
      },
      personalMessageCount: Number.MAX_SAFE_INTEGER - FANSLY_LIMITS.automatedIdsMax,
      fanAvatarUrl: avatarPrefix + text(4096 - avatarPrefix.length),
    };
    expect(Object.keys(request).sort()).toEqual(Object.keys(AiFeatureStreamBodySchema.shape).sort());
    expect(AiFeatureStreamBodySchema.safeParse(request).success).toBe(true);
    expect(realBody.safeParse(request).success).toBe(true);
    // The limit is not exported by the public SDK. Pin its definition in the vendored artifact before comparing.
    const sdk = readFileSync(new URL('../../../../../vendor/kernel-sdk/dist/contracts/routes.js', import.meta.url), 'utf8');
    expect(sdk).toContain('export const AI_FEATURE_STREAM_BODY_LIMIT_BYTES = 12 * 1024 * 1024;');
    const bytes = Buffer.byteLength(JSON.stringify(request), 'utf8');
    expect(bytes).toBeGreaterThan(9_000_000);
    expect(bytes).toBeLessThan(12 * 1024 * 1024);
    const hiBytes = Buffer.byteLength(JSON.stringify({ startProof: request.startProof, personalMessageCount: request.personalMessageCount, fanAvatarUrl: request.fanAvatarUrl }), 'utf8');
    expect(hiBytes).toBeGreaterThan(28_000);
  });
});
