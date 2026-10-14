// The window coverage check (1.15.0, R20 HF-8в; spec §3.5) against the matrix the hub and this client share. The
// fixture is the hub's `tests/fixtures/ai-coverage-check-matrix.json`, copied byte for byte: the hub proves every
// `hubCases` answer from its stores with it, and this client reads every answer — the hub's and the `clientCases` it
// never sends — to the same `coverageVerdict`, by the same `classes`. A change of the matrix is a change of the
// contract both sides read: copy it again and see what moved.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import * as C from '../src/index';
import { FANSLY_IDS, ISO, tabProof, uuid } from './fixtures/samples';

const MATRIX_FILE = new URL('./fixtures/ai-coverage-check-matrix.json', import.meta.url);
/**
 * sha256 of the hub's file at bd3eec06 — the deployed commit the SDK is vendored from (P2v). It came with HF-8в (hub
 * 731a4cb2, #589) and is the same on the hub's main at d0bad441 (2026-10-14).
 */
const HUB_MATRIX_SHA256 = '0ec4b0e6495cbbc1e56e6da3a0aacb721450cdb845afa6b282a4d7d983845ea2';

type Verdict = 'fresh' | 'miss' | 'stale' | 'unverified';
interface MatrixRequest {
  readonly window: readonly { readonly id: string; readonly dir: string }[];
  readonly deletedIds: readonly string[];
}
interface MatrixAnswer {
  readonly window: readonly { readonly id: string; readonly state: string }[];
  readonly deleted: readonly { readonly id: string; readonly state: string }[];
}
interface MatrixCase {
  readonly name: string;
  readonly request: MatrixRequest;
  readonly answer: MatrixAnswer | null;
  readonly coverageVerdict: Verdict;
}
interface Matrix {
  readonly version: number;
  readonly classes: { readonly window: Readonly<Record<string, string>>; readonly deleted: Readonly<Record<string, string>> };
  readonly hubCases: readonly MatrixCase[];
  readonly clientCases: readonly MatrixCase[];
  readonly invalidRequests: readonly { readonly name: string; readonly request: unknown }[];
}

const bytes = readFileSync(MATRIX_FILE);
const matrix = JSON.parse(bytes.toString('utf8')) as Matrix;
const cases = [...matrix.hubCases, ...matrix.clientCases];

/** What the background does with a frame's answer, then the check's verdict: the client's whole reading. */
const readAnswer = (c: MatrixCase): Verdict => C.coverageCheckVerdict(c.request, C.narrowCoverageCheck(c.answer ?? undefined));

describe('[host:fansly] the window coverage check reads as the hub’s shared matrix says (HF-8в, spec §3.5)', () => {
  it('the fixture is the hub’s file, byte for byte (version 1)', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(HUB_MATRIX_SHA256);
    expect(matrix.version).toBe(1);
    expect(matrix.hubCases.length).toBeGreaterThan(10);
    expect(matrix.clientCases.length).toBeGreaterThan(5);
  });

  it('the classes of each list are the matrix’s, state for state; the known states are their keys', () => {
    expect(C.COVERAGE_CHECK_CLASSES).toEqual(matrix.classes);
    expect([...C.COVERAGE_WINDOW_STATES].sort()).toEqual(Object.keys(matrix.classes.window).sort());
    expect([...C.COVERAGE_DELETED_STATES].sort()).toEqual(Object.keys(matrix.classes.deleted).sort());
  });

  for (const c of cases) {
    it(`${c.name} → ${c.coverageVerdict}`, () => {
      expect(readAnswer(c)).toBe(c.coverageVerdict);
    });
  }

  it('every verdict of the table is met, and every precedence the matrix names', () => {
    expect(new Set(cases.map((c) => c.coverageVerdict))).toEqual(new Set(['fresh', 'miss', 'stale', 'unverified']));
  });

  it('what the background hands the tab is a ServedContext the schema takes, whatever the hub answered', () => {
    for (const c of cases) {
      const coverageCheck = C.narrowCoverageCheck(c.answer ?? undefined);
      const served = { source: 'live_union', servedHead: null, live: { status: 'not_sent', accepted: 0, rejected: 0 }, ...(coverageCheck === undefined ? {} : { coverageCheck }) };
      expect(C.ServedContextSchema.safeParse(served).success, c.name).toBe(true);
    }
  });

  it('every answer of the matrix passes the frame’s schema and comes out of it whole', () => {
    for (const c of cases) {
      if (c.answer === null) continue;
      const frame = { type: 'context_v1', generationRef: uuid(6), source: 'live_union', servedHead: null, window: { requested: 100, served: 3 }, coverage: 'unknown', live: { status: 'not_sent', accepted: 0, rejected: 0 }, coverageCheck: c.answer };
      const parsed = C.ContextFrameSchema.safeParse(frame);
      expect(parsed.success, c.name).toBe(true);
      expect(parsed.data?.coverageCheck, c.name).toEqual(c.answer);
    }
  });

  it('the body takes every request of the matrix and refuses each one the hub refuses with 400', () => {
    for (const c of cases) expect(C.CoverageCheckBodySchema.safeParse(c.request).success, c.name).toBe(true);
    for (const invalid of matrix.invalidRequests) expect(C.CoverageCheckBodySchema.safeParse(invalid.request).success, invalid.name).toBe(false);
  });

  it('each request of the matrix is the window check of a proof: its lists go to the body as they are', () => {
    for (const c of cases) {
      const proof = { kind: 'host-pass', conversationRef: FANSLY_IDS.group, completeness: 'complete', takenAt: ISO, window: c.request.window, knownFanMessageIds: [], deletedIds: c.request.deletedIds };
      expect(C.CoverageProofSchema.safeParse(proof).success, c.name).toBe(true);
    }
  });
});

describe('[host:fansly] reading an answer: what the matrix leaves to the client', () => {
  const asked = { window: tabProof.window, deletedIds: tabProof.deletedIds };
  const included = (ids: readonly string[]) => ids.map((id) => ({ id, state: 'included' }));

  it('an answer that names something which is no id answers nothing asked: the whole check is unverified', () => {
    const answer = { window: [...included(asked.window.map((entry) => entry.id)), { id: 'msg-1', state: 'included' }], deleted: [] };
    expect(C.narrowCoverageCheck(answer)).toBeUndefined();
    expect(C.coverageCheckVerdict(asked, C.narrowCoverageCheck(answer))).toBe('unverified');
  });

  it('the answers are found by id, not by place: the hub keeps the order, the reading does not lean on it', () => {
    const answer = { window: included(asked.window.map((entry) => entry.id)).reverse(), deleted: [{ id: asked.deletedIds[0] as string, state: 'deleted' }] };
    expect(C.coverageCheckVerdict(asked, C.narrowCoverageCheck(answer))).toBe('fresh');
  });

  it('a request that named an id twice is no request the answer can prove', () => {
    const twice = { window: [...asked.window, asked.window[0] as C.CoverageWindowEntry], deletedIds: [] };
    expect(C.coverageCheckVerdict(twice, C.narrowCoverageCheck({ window: included(asked.window.map((entry) => entry.id)), deleted: [] }))).toBe('unverified');
  });

  it('no check asked and none answered is fresh as far as the check goes; none answered at all is unverified', () => {
    expect(C.coverageCheckVerdict({ window: [], deletedIds: [] }, C.narrowCoverageCheck({ window: [], deleted: [] }))).toBe('fresh');
    expect(C.coverageCheckVerdict({ window: [], deletedIds: [] }, undefined)).toBe('unverified');
  });
});
