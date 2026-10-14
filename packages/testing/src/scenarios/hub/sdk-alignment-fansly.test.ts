// The Fansly blocks of the SDK alignment (R20 F9b moved them here, tests
// unchanged): a host mark puts the whole file on its site
// (tools/parity/hosts.ts), and the ChatSpace rows of sdk-alignment.test.ts must
// stay on ChatSpace.
//
// - The window coverage check (contracts 1.15.0, P4b1; hub HF-8в): our body
//   field and the answer we read against the hub's real schema, over the
//   matrix the hub and this client share (a verbatim copy in the contracts'
//   fixtures).
// - The Fansly greeting's claim body (contracts 1.15.0, P4c) against the
//   hub's real one since HF-3 (`routeSchemas.clientFanClaim.body`): until the
//   SDK was vendored past HF-3 (R20 P2v) the contract test restated that
//   schema by hand.

import { readFileSync } from 'node:fs';

import {
  AI_STREAM_CAPABILITIES,
  CLIENT_HUB_CAPABILITY_NAMES,
  COVERAGE_CHECK_LIMITS,
  COVERAGE_DELETED_STATES,
  COVERAGE_WINDOW_STATES,
  CoverageCheckBodySchema,
  HubStreamRequestSchema,
} from '@cg/contracts';
import { FANSLY_CLAIM_BODY_FIXTURES, TEXT_FINGERPRINT, fanslyDispatch, fanslyManualGroup } from '@cg/contracts/fixtures';
import { FanslyGreetingClaimBodySchema, greetingGroupRef } from '@cg/contracts/send-fansly';
import {
  AI_COVERAGE_CHECK_DELETED_MAX,
  AI_COVERAGE_CHECK_DELETED_STATES,
  AI_COVERAGE_CHECK_WINDOW_MAX,
  AI_COVERAGE_CHECK_WINDOW_STATES,
  AI_STREAM_CAPABILITIES as SDK_AI_STREAM_CAPABILITIES,
  CLIENT_HUB_CAPABILITY_NAMES as SDK_CLIENT_HUB_CAPABILITY_NAMES,
  CLIENT_MANUAL_GROUP_REF_PREFIX,
  CLIENT_TEXT_FINGERPRINT_PATTERN,
  routeSchemas,
} from '@kernel/sdk';
import { describe, expect, it } from 'vitest';

import { WORLD, uuid } from './world';

interface LooseSchema {
  safeParse(value: unknown): { success: boolean; error?: unknown };
}
const sdkRoutes = routeSchemas as unknown as Readonly<Record<string, { readonly body?: LooseSchema }>>;

describe('[host:fansly] the window coverage check (contracts 1.15.0, P4b1) against the hub\'s real one (HF-8в)', () => {
  const realBody = sdkRoutes['aiFeatureStream']?.body;
  if (realBody === undefined) throw new Error('aiFeatureStream body');
  interface MatrixCase {
    readonly name: string;
    readonly request: unknown;
  }
  const matrix = JSON.parse(readFileSync(new URL('../../../../contracts/test/fixtures/ai-coverage-check-matrix.json', import.meta.url), 'utf8')) as {
    readonly hubCases: readonly MatrixCase[];
    readonly clientCases: readonly MatrixCase[];
    readonly invalidRequests: readonly MatrixCase[];
  };
  const body = (coverageCheck: unknown) => ({
    clientRequestId: uuid(0x4b1),
    pageLabel: WORLD.pages.fansly.pageLabel,
    platform: 'fansly',
    conversationRef: '7203',
    fanRef: '7102',
    messageCount: 100,
    coverageCheck,
  });

  it('our limits and words are the SDK\'s: 60 ids a list, its states, its capability names in its order', () => {
    expect(COVERAGE_CHECK_LIMITS).toEqual({ windowMax: AI_COVERAGE_CHECK_WINDOW_MAX, deletedMax: AI_COVERAGE_CHECK_DELETED_MAX });
    expect([...COVERAGE_WINDOW_STATES].sort()).toEqual([...AI_COVERAGE_CHECK_WINDOW_STATES].sort());
    // The deleted list reads one state more than the hub sends there: `included` — the matrix reads it as a stale context.
    expect(COVERAGE_DELETED_STATES.filter((state) => !(AI_COVERAGE_CHECK_DELETED_STATES as readonly string[]).includes(state))).toEqual(['included']);
    for (const state of AI_COVERAGE_CHECK_DELETED_STATES) expect(COVERAGE_DELETED_STATES).toContain(state);
    expect(SDK_AI_STREAM_CAPABILITIES.filter((capability) => (AI_STREAM_CAPABILITIES as readonly string[]).includes(capability))).toEqual([...AI_STREAM_CAPABILITIES]);
    for (const capability of CLIENT_HUB_CAPABILITY_NAMES) expect(SDK_CLIENT_HUB_CAPABILITY_NAMES).toContain(capability);
  });

  it('every request of the matrix both take, and each one the hub refuses ours refuses too', () => {
    for (const c of [...matrix.hubCases, ...matrix.clientCases]) {
      expect([c.name, realBody.safeParse(body(c.request)).success, CoverageCheckBodySchema.safeParse(c.request).success]).toEqual([c.name, true, true]);
    }
    expect(matrix.invalidRequests.length).toBeGreaterThan(5);
    for (const c of matrix.invalidRequests) {
      expect([c.name, realBody.safeParse(body(c.request)).success, CoverageCheckBodySchema.safeParse(c.request).success]).toEqual([c.name, false, false]);
    }
  });

  it('a request with the check passes our mirror only with both headers, and the hub\'s body', () => {
    const [first] = matrix.hubCases;
    const request = { feature: 'fast-reply', body: body(first?.request), capabilities: ['context-v1', 'coverage-check-v1'] };
    expect(HubStreamRequestSchema.safeParse(request).success).toBe(true);
    expect(realBody.safeParse(request.body).success).toBe(true);
    expect(HubStreamRequestSchema.safeParse({ ...request, capabilities: ['context-v1'] }).success).toBe(false);
  });
});

describe('[host:fansly] the Fansly greeting claim body (contracts 1.15.0, P4c) against the hub\'s real one (HF-3)', () => {
  const body = sdkRoutes['clientFanClaim']?.body;
  if (body === undefined) throw new Error('claim body');

  it('every body our schema lets out the hub takes; what the hub refuses, ours refuses too', () => {
    for (const value of FANSLY_CLAIM_BODY_FIXTURES.valid) expect(body.safeParse(value).success, JSON.stringify(value)).toBe(true);
    // A reply's manual group, two parts of a manual group, a text beside the fingerprint, a 401 as proof, a mixed group.
    const hubRefuses = [
      { ...fanslyDispatch, purpose: 'preview-reply' },
      { ...fanslyDispatch, partIndex: 1 },
      { ...fanslyDispatch, group: { ...fanslyManualGroup, text: 'Привет' } },
      { action: 'failed', attemptId: uuid(402), instanceId: uuid(404), reason: 'native_rejected', httpStatus: 401 },
      { ...fanslyDispatch, group: { ...fanslyManualGroup, generationRef: uuid(401) } },
    ];
    for (const value of hubRefuses) {
      expect(body.safeParse(value).success, JSON.stringify(value)).toBe(false);
      expect(FanslyGreetingClaimBodySchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
    }
  });

  it('the manual group reads as the hub answers it: its prefix and the fingerprint\'s form', () => {
    expect(greetingGroupRef(fanslyManualGroup)).toBe(`${CLIENT_MANUAL_GROUP_REF_PREFIX}${TEXT_FINGERPRINT}`);
    expect(CLIENT_TEXT_FINGERPRINT_PATTERN.test(TEXT_FINGERPRINT)).toBe(true);
  });
});
