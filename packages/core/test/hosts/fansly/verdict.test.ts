// R20 P8b2: the verdict on a Fansly generation (docs/project-unite/spec.md §3.5, FS-TAIL-1, FS-TAIL-7, FS-TAIL-8) —
// ONE pure function of the spec's table, read against the matrix the hub and this client share (HF-8в: the hub's
// `tests/fixtures/ai-coverage-check-matrix.json`, copied byte for byte into the contracts' fixtures and pinned there by
// its sha256). Every case of the matrix, then every case under each condition of the table and under pairs of them:
// the first condition that holds decides, whatever else holds beside it. The mark over the result and the send gate
// are what the verdict says.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { narrowCoverageCheck, type CoverageWindowEntry, type OpView, type ServedContext } from '@cg/contracts';
import { opView, passProof, tabProof } from '@cg/contracts/fixtures';
import { createFanslyAi, fingerprintOf, freshForSend, freshnessVerdict, type FreshnessVerdict, type ProofFingerprint } from '@cg/core/application/hosts/fansly/ai';

type CoverageVerdict = 'fresh' | 'miss' | 'stale' | 'unverified';
interface MatrixCase {
  readonly name: string;
  readonly request: { readonly window: readonly CoverageWindowEntry[]; readonly deletedIds: readonly string[] };
  readonly answer: { readonly window: readonly { readonly id: string; readonly state: string }[]; readonly deleted: readonly { readonly id: string; readonly state: string }[] } | null;
  readonly coverageVerdict: CoverageVerdict;
}
const MATRIX = JSON.parse(readFileSync(new URL('../../../../contracts/test/fixtures/ai-coverage-check-matrix.json', import.meta.url), 'utf8')) as {
  readonly version: number;
  readonly hubCases: readonly MatrixCase[];
  readonly clientCases: readonly MatrixCase[];
};
const CASES = [...MATRIX.hubCases, ...MATRIX.clientCases];

/** The window check's own part of the verdict, as the table names the mark of each. */
const OF_CHECK: Readonly<Record<CoverageVerdict, FreshnessVerdict>> = { fresh: 'fresh', miss: 'window-miss', stale: 'deleted-served', unverified: 'unverified' };

/** What the tab kept of a proof whose window check is the case's request: complete, not truncated, no text. */
const fingerprintOfCase = (c: MatrixCase, patch: Partial<ProofFingerprint> = {}): ProofFingerprint => ({
  completeness: 'complete',
  truncated: false,
  window: c.request.window,
  knownFanMessageIds: [],
  deletedIds: c.request.deletedIds,
  text: false,
  ...patch,
});
/** The hub's `context_v1` with the case's answer, as the background narrows it; the page's text not sent. */
const servedOfCase = (c: MatrixCase, patch: Partial<ServedContext> = {}): ServedContext => {
  const coverageCheck = narrowCoverageCheck(c.answer ?? undefined);
  return { source: 'live_union', servedHead: null, live: { status: 'not_sent', accepted: 0, rejected: 0 }, ...(coverageCheck === undefined ? {} : { coverageCheck }), ...patch };
};

// ── the conditions of the table, each a change of a case's world ────────────

interface World {
  readonly fingerprint: ProofFingerprint | null;
  readonly served: ServedContext | null | undefined;
}

const verdictOf = (world: World): FreshnessVerdict => freshnessVerdict(world.fingerprint, world.served);
const worldOf = (c: MatrixCase): World => ({ fingerprint: fingerprintOfCase(c), served: servedOfCase(c) });

describe('[host:fansly] R20 P8b2: the verdict — one pure function of spec §3.5’s table, over the matrix shared with the hub (HF-8в)', () => {
  it('the matrix is the hub’s version 1, every verdict of the check in it', () => {
    expect(MATRIX.version).toBe(1);
    expect(new Set(CASES.map((c) => c.coverageVerdict))).toEqual(new Set(['fresh', 'miss', 'stale', 'unverified']));
  });

  // The mark is for the chat's latest messages only (2026-10-20): a miss OLDER than the newest message the model read
  // is no mark. Of the matrix, one case is such a gap; every other miss in it is of the newest message.
  const OLDER_GAP = new Set(['a message the hub holds for the chat, older than the served window']);
  for (const c of CASES) {
    const expected = OLDER_GAP.has(c.name) ? 'fresh' : OF_CHECK[c.coverageVerdict];
    it(`${c.name} → ${expected}`, () => {
      expect(verdictOf(worldOf(c))).toBe(expected);
    });
  }

  it('a miss counts only when it is newer than the newest message the model read, or the model read none', () => {
    const ids = ['700000000000000101', '700000000000000102', '700000000000000103'];
    const window = ids.map((id) => ({ id, dir: 'fan' as const }));
    const verdict = (states: readonly string[], deleted: readonly { id: string; state: string }[] = []): FreshnessVerdict => {
      const c: MatrixCase = {
        name: 'local',
        request: { window, deletedIds: deleted.map((item) => item.id) },
        answer: { window: ids.map((id, index) => ({ id, state: states[index] ?? 'included' })), deleted },
        coverageVerdict: 'fresh',
      };
      return verdictOf(worldOf(c));
    };
    expect({
      oldestCut: verdict(['outside_window', 'included', 'included']),
      middleAbsent: verdict(['included', 'absent', 'included']),
      newestAbsent: verdict(['included', 'included', 'absent']),
      noneRead: verdict(['absent', 'outside_window', 'deleted']),
      newestDeleted: verdict(['included', 'included', 'deleted']),
      gapAndStale: verdict(['absent', 'included', 'included'], [{ id: '700000000000000201', state: 'still_served' }]),
    }).toEqual({
      oldestCut: 'fresh',
      middleAbsent: 'fresh',
      newestAbsent: 'window-miss',
      noneRead: 'window-miss',
      newestDeleted: 'fresh',
      gapAndStale: 'deleted-served',
    });
  });

  it('named intersections, spelled out', () => {
    const byName = (start: string): MatrixCase => {
      const found = CASES.find((c) => c.name.startsWith(start));
      if (found === undefined) throw new Error(start);
      return found;
    };
    const fresh = byName('every message of the tab');
    const miss = byName('a message the hub has not seen');
    const stale = byName('deleted on the tab but still in the served window');
    const both = byName('a miss and a stale context together');
    const empty = byName('an empty chat');
    const unanswered = byName('no coverageCheck in the frame');
    const served = { live: { status: 'served', accepted: 2, rejected: 0 } } as const;
    const verdict = (c: MatrixCase, fingerprint: Partial<ProofFingerprint> = {}, context: Partial<ServedContext> = {}): FreshnessVerdict =>
      freshnessVerdict(fingerprintOfCase(c, fingerprint), servedOfCase(c, context));
    expect({
      // A miss of the window, under a truncated snapshot: not verified at all.
      missTruncated: verdict(miss, { truncated: true, text: true }, served),
      // A stale context with the draft's text rejected in part: every message of the window was read, the context is stale.
      staleRejected: verdict(stale, { text: true }, { live: { status: 'served', accepted: 1, rejected: 1 } }),
      // A stale context, the draft's text served whole: the context is stale.
      staleServed: verdict(stale, { text: true }, served),
      // A miss and a stale context together: the miss.
      missAndStale: verdict(both),
      // Under an unknown observation even a fresh check is not verified.
      freshUnknown: verdict(fresh, { completeness: 'unknown' }),
      // The fan's known id absent while the window counts it: a miss.
      knownAbsent: verdict(fresh, { knownFanMessageIds: ['700000000000000103'] }, { knownFanMessages: [{ id: '700000000000000103', state: 'absent' }] }),
      // No conversation at all: fresh only under a complete observation, and only with the check answered.
      emptyComplete: verdict(empty),
      emptyUnknown: verdict(empty, { completeness: 'unknown' }),
      emptyUnanswered: freshnessVerdict(fingerprintOfCase(empty), servedOfCase(unanswered)),
      // Every condition at once: row 1.
      everything: verdict(both, { truncated: true, text: true, completeness: 'unknown' }, { live: { status: 'rejected', accepted: 0, rejected: 3 } }),
    }).toEqual({
      missTruncated: 'unverified',
      staleRejected: 'deleted-served',
      staleServed: 'deleted-served',
      missAndStale: 'window-miss',
      freshUnknown: 'unverified',
      knownAbsent: 'window-miss',
      emptyComplete: 'fresh',
      emptyUnknown: 'unverified',
      emptyUnanswered: 'unverified',
      everything: 'unverified',
    });
  });
});

describe('[host:fansly] R20 P8b2: the fingerprint, the mark over the result and the send gate', () => {
  it('the fingerprint keeps the ids and the flags of the proof, never a text; a pass without a tail has no text', () => {
    const kept = fingerprintOf(tabProof);
    expect(kept).toEqual({
      completeness: 'complete',
      truncated: false,
      window: tabProof.window,
      knownFanMessageIds: tabProof.knownFanMessageIds,
      deletedIds: tabProof.deletedIds,
      text: true,
    });
    const texts = tabProof.kind === 'tab-snapshot' ? (tabProof.tail ?? []).map((message) => message.text) : [];
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) expect(JSON.stringify(kept)).not.toContain(text);
    expect(fingerprintOf({ ...tabProof, tail: [] }).text).toBe(false);
    expect(fingerprintOf(passProof)).toMatchObject({ truncated: false, text: false, window: passProof.window });
    // The policy keeps it with the operation (`AiHostPolicy.fingerprint`); no proof — nothing.
    const policy = createFanslyAi({ now: () => 0 });
    expect(policy.fingerprint(null)).toBeNull();
  });

  const fresh = fingerprintOf(tabProof);
  const answered = (states: { readonly window?: readonly string[]; readonly deleted?: string }): ServedContext => ({
    source: 'live_union',
    servedHead: null,
    live: { status: 'served', accepted: 2, rejected: 0 },
    coverageCheck: {
      window: tabProof.window.map((entry, index) => ({ id: entry.id, state: (states.window?.[index] ?? 'included') as 'included' })),
      deleted: tabProof.deletedIds.map((id) => ({ id, state: (states.deleted ?? 'deleted') as 'deleted' })),
    },
  });
  const done = (servedContext: ServedContext | null, patch: Partial<OpView> = {}): OpView => ({ ...opView, servedContext, ...patch });

  it('[FS-TAIL-8] a send of this generation’s unchanged result needs its own fresh verdict and no mark at all — anything else, only a new generation', () => {
    expect(freshForSend(done(answered({})), fresh)).toBe(true);
    // The newest message unread holds the send; an older gap of the window does not (the latest were read).
    const newestAbsent = tabProof.window.map((_, index, all) => (index === all.length - 1 ? 'absent' : 'included'));
    expect(freshForSend(done(answered({ window: newestAbsent })), fresh)).toBe(false);
    expect(tabProof.window.length).toBeGreaterThan(1);
    expect(freshForSend(done(answered({ window: ['absent'] })), fresh)).toBe(true);
    expect(freshForSend(done(answered({ deleted: 'included' })), fresh)).toBe(false);
    expect(freshForSend(done(answered({})), null)).toBe(false);
    expect(freshForSend(done(answered({}), { stale: { reason: 'fan-wrote', at: null } }), fresh)).toBe(false);
    expect(freshForSend(done(answered({}), { state: 'streaming' }), fresh)).toBe(false);
    // Another proof's fingerprint is no proof of this generation: its answers are not about those ids.
    expect(freshForSend(done(answered({})), { ...fresh, window: [...fresh.window, { id: '700000000000000104', dir: 'fan' }] })).toBe(false);
  });
});
