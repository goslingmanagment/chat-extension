// R20 P8b2: the verdict on a Fansly generation (docs/project-unite/spec.md §3.5, FS-TAIL-1, FS-TAIL-7, FS-TAIL-8) —
// ONE pure function of the spec's table, read against the matrix the hub and this client share (HF-8в: the hub's
// `tests/fixtures/ai-coverage-check-matrix.json`, copied byte for byte into the contracts' fixtures and pinned there by
// its sha256). Every case of the matrix, then every case under each condition of the table and under pairs of them:
// the first condition that holds decides, whatever else holds beside it. The mark over the result and the send gate
// are what the verdict says.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { LIVE_TEXT_STATUSES, narrowCoverageCheck, type CoverageWindowEntry, type OpView, type ServedContext } from '@cg/contracts';
import { opView, passProof, tabProof } from '@cg/contracts/fixtures';
import { createFanslyAi, fingerprintOf, freshForSend, freshnessVerdict, verdictMark, type FreshnessVerdict, type ProofFingerprint } from '@cg/core/application/hosts/fansly/ai';

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

/** The row of the table a change belongs to: 1 «не проверено», 2 a miss of the window; null — no condition of the table. */
type Row = 1 | 2 | null;
interface Change {
  readonly name: string;
  readonly row: Row;
  /** What of the hub's answer it writes: two changes of one slot replace each other — the later one is the hub's. */
  readonly slot?: 'live' | 'known';
  /** Only where the case's window has a fan message (the fan's known ids are ids of the window). */
  readonly needsFan?: boolean;
  apply(world: World, c: MatrixCase): World;
}
interface World {
  readonly fingerprint: ProofFingerprint | null;
  readonly served: ServedContext | null | undefined;
}
const fanOf = (c: MatrixCase): string | null => c.request.window.find((entry) => entry.dir === 'fan')?.id ?? null;
const withFingerprint = (world: World, patch: Partial<ProofFingerprint>): World => ({ ...world, fingerprint: world.fingerprint === null ? null : { ...world.fingerprint, ...patch } });
const withServed = (world: World, patch: Partial<ServedContext>): World => ({ ...world, served: world.served === null || world.served === undefined ? world.served : { ...world.served, ...patch } });
/** The fan's known id asked of the hub, and the hub's second answer about it. */
const known = (world: World, c: MatrixCase, answers: (id: string) => NonNullable<ServedContext['knownFanMessages']>): World => {
  const id = fanOf(c) ?? '';
  return withServed(withFingerprint(world, { knownFanMessageIds: [id] }), { knownFanMessages: answers(id) });
};
/** The draft's page text went with the start, and the hub did this with it. */
const text = (world: World, live: ServedContext['live']): World => withServed(withFingerprint(world, { text: true }), { live });
const OTHER_ID = '700000000000000999';

const CHANGES: readonly Change[] = [
  // Row 1: «свежесть не проверена».
  { name: 'no context_v1 frame', row: 1, apply: (world) => ({ ...world, served: undefined }) },
  { name: 'a null context (the hub sent none)', row: 1, apply: (world) => ({ ...world, served: null }) },
  { name: 'no snapshot', row: 1, apply: (world) => ({ ...world, fingerprint: null }) },
  { name: 'the observation unknown', row: 1, apply: (world) => withFingerprint(world, { completeness: 'unknown' }) },
  { name: 'a truncated snapshot', row: 1, apply: (world) => withFingerprint(world, { truncated: true }) },
  { name: 'a known id answered unknown', row: 1, slot: 'known', needsFan: true, apply: (world, c) => known(world, c, (id) => [{ id, state: 'unknown' }]) },
  { name: 'a known id answered with a state this build does not know', row: 1, slot: 'known', needsFan: true, apply: (world, c) => known(world, c, (id) => [{ id, state: null }]) },
  { name: 'a known id answered twice', row: 1, slot: 'known', needsFan: true, apply: (world, c) => known(world, c, (id) => [{ id, state: 'included' }, { id, state: 'included' }]) },
  { name: 'a known answer to an id not asked', row: 1, slot: 'known', needsFan: true, apply: (world, c) => known(world, c, (id) => [{ id, state: 'included' }, { id: OTHER_ID, state: 'included' }]) },
  // Row 2: «Ответ мог не учесть последние сообщения».
  { name: 'a known id the hub has not got', row: 2, slot: 'known', needsFan: true, apply: (world, c) => known(world, c, (id) => [{ id, state: 'absent' }]) },
  ...LIVE_TEXT_STATUSES.filter((status) => status !== 'served').map(
    (status): Change => ({ name: `the draft’s text ${status}`, row: 2, slot: 'live', apply: (world) => text(world, { status, accepted: 0, rejected: 0 }) }),
  ),
  { name: 'the draft’s text in a status this build does not know', row: 2, slot: 'live', apply: (world) => text(world, { status: null, accepted: 0, rejected: 0 }) },
  { name: 'the draft’s text served in part', row: 2, slot: 'live', apply: (world) => text(world, { status: 'served', accepted: 2, rejected: 1 }) },
  // No condition of the table: the verdict stays the case's own.
  { name: 'the draft’s text served whole', row: null, slot: 'live', apply: (world) => text(world, { status: 'served', accepted: 3, rejected: 0 }) },
  { name: 'a known id counted', row: null, slot: 'known', needsFan: true, apply: (world, c) => known(world, c, (id) => [{ id, state: 'included' }]) },
  { name: 'a known id the hub knows deleted', row: null, slot: 'known', needsFan: true, apply: (world, c) => known(world, c, (id) => [{ id, state: 'deleted' }]) },
  { name: 'a known id asked, no second answer from the hub', row: null, needsFan: true, apply: (world, c) => withFingerprint(world, { knownFanMessageIds: [fanOf(c) ?? ''] }) },
  { name: 'another reader served it', row: null, apply: (world) => withServed(world, { source: 'archive' }) },
];

/** Spec §3.5 read as its table: the first row that holds. */
function expected(c: MatrixCase, rows: readonly Row[]): FreshnessVerdict {
  if (rows.includes(1) || c.coverageVerdict === 'unverified') return 'unverified';
  if (rows.includes(2) || c.coverageVerdict === 'miss') return 'window-miss';
  return OF_CHECK[c.coverageVerdict];
}

const verdictOf = (world: World): FreshnessVerdict => freshnessVerdict(world.fingerprint, world.served);
const worldOf = (c: MatrixCase): World => ({ fingerprint: fingerprintOfCase(c), served: servedOfCase(c) });
const fits = (change: Change, c: MatrixCase): boolean => change.needsFan !== true || fanOf(c) !== null;
/** The rows that hold after two changes: of one slot, only the later one's. */
const rowsOf = (first: Change, second: Change): Row[] => (first.slot !== undefined && first.slot === second.slot ? [second.row] : [first.row, second.row]);

describe('[host:fansly] R20 P8b2: the verdict — one pure function of spec §3.5’s table, over the matrix shared with the hub (HF-8в)', () => {
  it('the matrix is the hub’s version 1, every verdict of the check in it', () => {
    expect(MATRIX.version).toBe(1);
    expect(new Set(CASES.map((c) => c.coverageVerdict))).toEqual(new Set(['fresh', 'miss', 'stale', 'unverified']));
  });

  for (const c of CASES) {
    it(`${c.name} → ${OF_CHECK[c.coverageVerdict]}`, () => {
      expect(verdictOf(worldOf(c))).toBe(OF_CHECK[c.coverageVerdict]);
    });
  }

  it('each condition of the table over every case of the matrix: the first row that holds decides; a change that is no condition changes nothing', () => {
    for (const c of CASES) {
      for (const change of CHANGES.filter((item) => fits(item, c))) {
        expect([c.name, change.name, verdictOf(change.apply(worldOf(c), c))]).toEqual([c.name, change.name, expected(c, [change.row])]);
      }
    }
  });

  it('the intersections: every pair of changes over every case, in both orders — row 1 before row 2 before a stale context', () => {
    let pairs = 0;
    for (const c of CASES) {
      const fitting = CHANGES.filter((item) => fits(item, c));
      for (const first of fitting) {
        for (const second of fitting) {
          if (first === second) continue;
          const world = second.apply(first.apply(worldOf(c), c), c);
          expect([c.name, first.name, second.name, verdictOf(world)]).toEqual([c.name, first.name, second.name, expected(c, rowsOf(first, second))]);
          pairs += 1;
        }
      }
    }
    expect(pairs).toBeGreaterThan(5000);
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
      // A stale context with the draft's text rejected in part: the miss of the text comes first.
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
      staleRejected: 'window-miss',
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
  it('the fingerprint keeps the ids and the flags of the proof, never a text; a pass carries no text', () => {
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
    expect(fingerprintOf({ ...tabProof, tail: [] } as typeof tabProof).text).toBe(false);
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

  it('the mark over a finished result is the verdict’s reason; a fresh verdict takes the background’s «фан написал новое»; nothing — no mark', () => {
    expect(verdictMark(done(answered({})), fresh)).toBeNull();
    expect(verdictMark(done(answered({ window: ['included', 'absent'] })), fresh)).toEqual({ reason: 'window-miss', at: null });
    expect(verdictMark(done(answered({ deleted: 'still_served' })), fresh)).toEqual({ reason: 'deleted-served', at: null });
    expect(verdictMark(done(null), fresh)).toEqual({ reason: 'unverified', at: null });
    // An operation this tab did not start: nothing of its proof is kept here — not verified.
    expect(verdictMark(done(answered({})), null)).toEqual({ reason: 'unverified', at: null });
    const wrote = { reason: 'fan-wrote', at: '2026-10-03T10:06:00Z' } as const;
    expect(verdictMark(done(answered({}), { stale: wrote }), fresh)).toEqual(wrote);
    // A verdict that is not fresh is the mark: the generation itself did not see the chat.
    expect(verdictMark(done(answered({ window: ['absent'] }), { stale: wrote }), fresh)).toEqual({ reason: 'window-miss', at: null });
    // A result still running, failed or canceled has no mark.
    for (const state of ['streaming', 'failed', 'canceled', 'interrupted'] as const) expect(verdictMark(done(null, { state }), null)).toBeNull();
  });

  it('[FS-TAIL-8] the policy’s verdict is that mark — the shared result only draws it', () => {
    const policy = createFanslyAi({ now: () => 0 });
    expect(policy.verdict(done(answered({ window: ['included', 'included', 'outside_window'] })), fresh)).toEqual({ reason: 'window-miss', at: null });
    expect(policy.verdict(done(answered({})), fresh)).toBeNull();
  });

  it('[FS-TAIL-8] a send of this generation’s unchanged result needs its own fresh verdict and no mark at all — anything else, only a new generation', () => {
    expect(freshForSend(done(answered({})), fresh)).toBe(true);
    expect(freshForSend(done(answered({ window: ['absent'] })), fresh)).toBe(false);
    expect(freshForSend(done(answered({ deleted: 'included' })), fresh)).toBe(false);
    expect(freshForSend(done(answered({})), null)).toBe(false);
    expect(freshForSend(done(answered({}), { stale: { reason: 'fan-wrote', at: null } }), fresh)).toBe(false);
    expect(freshForSend(done(answered({}), { state: 'streaming' }), fresh)).toBe(false);
    // Another proof's fingerprint is no proof of this generation: its answers are not about those ids.
    expect(freshForSend(done(answered({})), { ...fresh, window: [...fresh.window, { id: '700000000000000104', dir: 'fan' }] })).toBe(false);
  });
});
