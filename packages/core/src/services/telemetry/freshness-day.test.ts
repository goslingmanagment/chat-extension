import { describe, expect, it } from 'vitest';
import { FreshnessDaySchema } from '@cg/contracts/diagnostics';
import type { CoverageProof, ServedContext } from '@cg/contracts/ops';
import { FreshnessDayStore, freshnessCounts } from './freshness-day';
const HOUR = 3_600_000;
const proof: CoverageProof = { kind: 'tab-snapshot', conversationRef: '90001', completeness: 'complete', takenAt: '2026-10-15T12:00:00Z', window: [{ id: '10001', dir: 'fan' }], knownFanMessageIds: ['10001'], deletedIds: [], truncated: false };
const served: ServedContext = { source: 'live_union', servedHead: null, live: { status: 'not_sent', accepted: 0, rejected: 0 }, coverageCheck: { window: [{ id: '10001', state: 'included' }], deleted: [] } };

describe('[host:fansly] [FS-TAIL-9] local freshness day', () => {
  it('counts every category with its generation denominator; no proof is unknown, not a zero', () => {
    expect(freshnessCounts(proof, served)).toEqual({ generations: 1, marked: 0, unknown: 0, rejectedTail: 0, truncated: 0, nonLiveUnion: 0 });
    expect(freshnessCounts(undefined, undefined)).toMatchObject({ generations: 1, marked: 1, unknown: 1, nonLiveUnion: 1 });
    expect(freshnessCounts({ ...proof, truncated: true, completeness: 'unknown' }, { ...served, source: 'archive', live: { status: 'rejected', accepted: 0, rejected: 1 } })).toEqual({ generations: 1, marked: 1, unknown: 1, rejectedTail: 1, truncated: 1, nonLiveUnion: 1 });
    expect(freshnessCounts({ ...proof, tail: [{ platformMessageId: '10001', direction: 'fan', sentAt: proof.takenAt, text: 'synthetic tail' }] }, { ...served, live: { status: 'served', accepted: 1, rejected: 1 } }).marked).toBe(1);
    expect(freshnessCounts(proof, { ...served, coverageCheck: { window: [{ id: '10001', state: 'absent' }], deleted: [] } }).marked).toBe(1);
  });
  it('works without consent, separates hosts/builds/functions, persists numbers only and expires old buckets', async () => {
    let now = 100 * HOUR;
    let saved: unknown;
    const store = { load: () => Promise.resolve(saved), save: (value: unknown) => { saved = JSON.parse(JSON.stringify(value)) as unknown; return Promise.resolve(); } };
    const day = new FreshnessDayStore(() => now, store); await day.start();
    const counts = freshnessCounts(proof, served);
    day.record('chatspace', 'index.test', 'reply', counts);
    day.record('fansly-web', 'main.a', 'reply', counts);
    day.record('fansly-web', 'main.b', 'reply', counts);
    day.record('fansly-web', 'main.b', 'hi', counts);
    await day.idle();
    expect(day.snapshot().rows).toHaveLength(4);
    expect(day.snapshot().persisted).toBe(true);
    expect(JSON.stringify(saved)).not.toContain('90001');
    const woke = new FreshnessDayStore(() => now, store); await woke.start();
    expect(woke.snapshot().rows).toEqual(day.snapshot().rows);
    now += 24 * HOUR + 1;
    expect(woke.snapshot().rows).toEqual([]);
  });
  it('bounds memory and distinguishes unavailable persistence', async () => {
    const day = new FreshnessDayStore(() => 100 * HOUR, { load: () => Promise.resolve(null), save: () => Promise.reject(new Error('storage')) });
    await day.start();
    for (let i = 0; i < 140; i++) day.record('fansly-web', `main.${i}`, 'reply', freshnessCounts(undefined, undefined));
    await day.idle();
    expect(day.snapshot().rows).toHaveLength(128);
    expect(day.snapshot()).toMatchObject({ dropped: 12, persisted: false });
    expect(FreshnessDaySchema.safeParse(day.snapshot()).success).toBe(true);
  });
});
