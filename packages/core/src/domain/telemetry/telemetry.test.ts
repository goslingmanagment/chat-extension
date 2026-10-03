import { ANCHOR_IDS, HOST_CAPABILITIES, type HostContractReport } from '@cg/contracts/host';
import { TELEMETRY_LIMITS } from '@cg/contracts/limits';
import { AcceptanceEventSchema, ClientHealthV1Schema, PERF_METRICS, PERF_METRIC_NAMES, PerfHistogramSchema, TabHealthReportSchema } from '@cg/contracts/telemetry';
import { describe, expect, it } from 'vitest';

import { AcceptanceTracker, HandlerSampler, HealthWindow, Histogram, bucketIndex, hostSignature, hostSummary, type GenerationLink } from './index';

const T0 = Date.UTC(2026, 9, 3, 12, 0, 0);
const OP = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const OP2 = '1a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const GEN = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
const ATTEMPT = '3c4d5e6f-7a8b-4c9d-8e0f-2a3b4c5d6e7f';
const CLIENT = { version: '0.1.0', browserMajor: 157, os: 'macos' } as const;

function tracker(capacity?: number) {
  let n = 0;
  return new AcceptanceTracker({
    now: () => T0,
    uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    ...(capacity === undefined ? {} : { capacity }),
  });
}

const link: GenerationLink = { opId: OP, generationRef: GEN, feature: 'reply', surface: 'dock', pageLabel: 'lora-of' };

describe('ai_acceptance events', () => {
  it('[TL-001] `shown` once per part, with the generation of the operation', () => {
    const t = tracker();
    t.link(link);
    const first = t.shown(OP, { part: 0 });
    expect(first.ok && first.event).toEqual({
      clientEventId: '00000000-0000-4000-8000-000000000001',
      kind: 'ai_acceptance',
      observedAt: '2026-10-03T12:00:00.000Z',
      pageLabel: 'lora-of',
      payload: { generationRef: GEN, lifecycle: 'shown', opId: OP, feature: 'reply', surface: 'dock', part: 0 },
    });
    expect(t.shown(OP, { part: 0 })).toEqual({ ok: false, reason: 'duplicate' });
    expect(t.shown(OP, { part: 1 }).ok).toBe(true);
  });

  it('[TL-002] `copied` for every successful copy, Review and Recap included', () => {
    const t = tracker();
    t.link(link);
    t.link({ ...link, opId: OP2, feature: 'review', surface: 'dock' });
    expect(t.copied(OP, { part: 1 }).ok).toBe(true);
    expect(t.copied(OP, { part: 1 }).ok).toBe(true);
    const review = t.copied(OP2);
    expect(review.ok && review.event.payload).toMatchObject({ lifecycle: 'copied', feature: 'review' });
  });

  it('[TL-003] `inserted` after an applied insert', () => {
    const t = tracker();
    t.link(link);
    const outcome = t.inserted(OP, { part: 2 });
    expect(outcome.ok && outcome.event.payload).toMatchObject({ lifecycle: 'inserted', part: 2 });
    expect(outcome.ok && AcceptanceEventSchema.safeParse(outcome.event).success).toBe(true);
  });

  it('[TL-004] `sent` only with proof by message id, once per message, with `edited`', () => {
    const t = tracker();
    t.link({ ...link, surface: 'preview' });
    const composer = t.sent(OP, { part: 0 }, { via: 'composer', platformMessageId: '123456789', edited: true });
    expect(composer.ok && composer.event.payload).toMatchObject({ lifecycle: 'sent', via: 'composer', platformMessageId: '123456789', edited: true });
    expect(t.sent(OP, { part: 0 }, { via: 'composer', platformMessageId: '123456789', edited: false })).toEqual({ ok: false, reason: 'duplicate' });
    const preview = t.sent(OP, { part: 1 }, { via: 'preview', platformMessageId: '123456790', attemptId: ATTEMPT });
    expect(preview.ok && preview.event.payload).toMatchObject({ via: 'preview', attemptId: ATTEMPT });
    expect(t.sent(OP, { part: 2 }, { via: 'composer', platformMessageId: '0123', edited: false })).toEqual({ ok: false, reason: 'invalid' });
  });

  it('[TL-005] Coach drafts carry the generation of their own exchange', () => {
    const t = tracker();
    t.link({ opId: OP, generationRef: GEN, feature: 'coach', surface: 'coach', pageLabel: 'lora-of' });
    t.link({ opId: OP2, generationRef: OP2, feature: 'coach', surface: 'coach', pageLabel: 'lora-of' });
    const first = t.inserted(OP, { variant: 1, part: 0 });
    const second = t.copied(OP2, { variant: 0, part: 1 });
    expect(first.ok && first.event.payload).toMatchObject({ generationRef: GEN, variant: 1, part: 0, feature: 'coach' });
    expect(second.ok && second.event.payload.generationRef).toBe(OP2);
  });

  it('[TL-006] Fix’s replacement reports `inserted`; Recap copy reports `copied`', () => {
    const t = tracker();
    t.link({ ...link, feature: 'fix' });
    t.link({ ...link, opId: OP2, feature: 'recap' });
    expect(t.inserted(OP, { part: 0 }).ok).toBe(true);
    expect(t.copied(OP2).ok).toBe(true);
  });

  it('[TL-007] the event carries ids and positions only, never text', () => {
    const t = tracker();
    t.link(link);
    const outcome = t.shown(OP, { variant: 2, part: 9 });
    if (!outcome.ok) throw new Error('not built');
    expect(Object.keys(outcome.event.payload).sort()).toEqual(['feature', 'generationRef', 'lifecycle', 'opId', 'part', 'surface', 'variant']);
    expect(t.shown(OP, { part: 10 })).toEqual({ ok: false, reason: 'invalid' });
    expect(t.shown(OP, { variant: 3 })).toEqual({ ok: false, reason: 'invalid' });
  });

  it('[TL-008] links the last 50 generations in memory; an older one is unlinked (LG-015)', () => {
    const t = tracker(3);
    const ids = ['a', 'b', 'c', 'd'].map((c) => `${c.repeat(8)}-0000-4000-8000-000000000000`);
    for (const id of ids) t.link({ ...link, opId: id });
    expect(t.size).toBe(3);
    expect(t.shown(ids[0] ?? '')).toEqual({ ok: false, reason: 'unlinked' });
    expect(t.linkOf(ids[3] ?? '')?.opId).toBe(ids[3]);
    t.link({ ...link, opId: ids[1] ?? '' });
    t.link({ ...link, opId: OP });
    expect(t.linkOf(ids[1] ?? '')).not.toBeNull();
    expect(t.linkOf(ids[2] ?? '')).toBeNull();
    t.forget(OP);
    expect(t.linkOf(OP)).toBeNull();
    t.clear();
    expect(t.size).toBe(0);
    expect(tracker().size).toBe(0);
    const broken = new AcceptanceTracker({ now: () => Number.NaN, uuid: () => OP });
    broken.link(link);
    expect(broken.shown(OP)).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('[NEW-03] client_health histograms', () => {
  it('[NEW-03] a value ≤ bound i lands in bucket i, above the last bound in the last bucket', () => {
    const bounds = [1, 2, 4];
    expect([0, 1, 1.5, 2, 3, 4, 4.01, 1e9].map((v) => bucketIndex(bounds, v))).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    const histogram = new Histogram('insertMs');
    for (const value of [0, 4, 4.5, 100, 100.1, 2000]) histogram.add(value);
    const wire = histogram.toWire();
    expect(wire.bounds).toEqual(PERF_METRICS.insertMs.bounds);
    expect(wire.counts).toEqual([2, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 1]);
    expect(wire).toMatchObject({ count: 6, sum: 2208.6, max: 2000, unit: 'ms', schemaVersion: 1 });
    expect(PerfHistogramSchema.safeParse(wire).success).toBe(true);
    expect(histogram.add(-1)).toBe(false);
    expect(histogram.add(Number.NaN)).toBe(false);
    expect(histogram.add(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('[NEW-03] merges are exact by bucket, count, sum and max; other bounds or versions are refused', () => {
    const a = new Histogram('ttfcMs');
    const b = new Histogram('ttfcMs');
    for (const v of [300, 900, 5000]) a.add(v);
    for (const v of [100, 61_000]) b.add(v);
    expect(a.merge(b.toWire())).toBe(true);
    const merged = a.toWire();
    const direct = new Histogram('ttfcMs');
    for (const v of [300, 900, 5000, 100, 61_000]) direct.add(v);
    expect(merged).toEqual(direct.toWire());
    const wire = b.toWire();
    expect(a.merge({ ...wire, schemaVersion: 2 })).toBe(false);
    expect(a.merge({ ...wire, bounds: [...wire.bounds.slice(0, -1), 99_999] })).toBe(false);
    expect(a.merge({ ...wire, bounds: wire.bounds.slice(1) })).toBe(false);
    expect(a.merge({ ...wire, metric: 'insertMs' })).toBe(false);
    expect(a.merge({ ...wire, count: wire.count + 1 })).toBe(false);
    expect(a.merge({ ...wire, counts: wire.counts.slice(1) })).toBe(false);
    expect(a.merge({ ...wire, counts: wire.counts.map((c, i) => (i === 0 ? -1 : c)) })).toBe(false);
    expect(a.merge({ ...wire, sum: -1 })).toBe(false);
    expect(a.toWire()).toEqual(merged);
  });

  it('[NEW-03] every metric keeps its fixed bounds and an empty histogram is valid', () => {
    for (const metric of PERF_METRIC_NAMES) {
      const wire = new Histogram(metric).toWire();
      expect(wire.counts).toHaveLength(PERF_METRICS[metric].bounds.length + 1);
      expect(PerfHistogramSchema.safeParse(wire).success).toBe(true);
    }
  });
});

function contract(overrides: Partial<{ anchors: Partial<Record<(typeof ANCHOR_IDS)[number], 'ok' | 'missing' | 'shape'>>; off: readonly (typeof HOST_CAPABILITIES)[number][] }> = {}): HostContractReport {
  return {
    build: 'index-DEVowLko',
    adapterVersion: '1.0.0',
    checkedAt: T0,
    anchors: Object.fromEntries(ANCHOR_IDS.map((id) => [id, overrides.anchors?.[id] ?? 'ok'])),
    capabilities: Object.fromEntries(HOST_CAPABILITIES.map((c) => [c, overrides.off?.includes(c) === true ? { state: 'contractBroken', code: 'CG-HOST-CONTRACT' } : { state: 'on' }])),
  } as HostContractReport;
}

describe('[NEW-03] the client_health window', () => {
  it('[NEW-03] builds a valid report with P1 and safety counters always present', () => {
    const window = new HealthWindow(T0);
    window.recordPerf('insertMs', 12);
    window.recordPerf('routeToDockMs', 8);
    window.countCode('CG-INSERT-MISPLACED');
    window.countCode('CG-HUB-UNAVAILABLE', 3);
    window.count('insert.prevented', 2);
    window.count('free text is not a code');
    window.setHost(contract({ anchors: { fansMap: 'missing', mimic: 'shape' }, off: ['freshText'] }));
    window.setDisabled(['flag:previewSend', 'bad flag name']);
    const report = window.build(T0 + TELEMETRY_LIMITS.healthWindowMs, CLIENT, { cachesKB: 120.4, logsKB: 900.6 });
    expect(ClientHealthV1Schema.safeParse(report).success).toBe(true);
    expect(report.window).toEqual({ from: '2026-10-03T12:00:00.000Z', to: '2026-10-03T12:15:00.000Z' });
    expect(report.counters).toMatchObject({
      'p1.insert-misplaced': 1,
      'p1.send-without-human': 0,
      'p1.read-without-human': 0,
      'insert.prevented': 2,
      'send.held': 0,
      'send.uncertain': 0,
      'CG-INSERT-MISPLACED': 1,
      'CG-HUB-UNAVAILABLE': 3,
      'health.bad-counter': 1,
    });
    expect(report.host).toEqual({ kind: 'chatspace', build: 'index-DEVowLko', contractOk: false, missing: ['fansMap', 'mimic:shape'] });
    expect(report.disabled).toEqual(['freshText:contractBroken', 'flag:previewSend']);
    expect(report.perf.map((h) => h.metric)).toEqual(['routeToDockMs', 'insertMs']);
    expect(report.footprint).toEqual({ kind: 'owned-estimate', cachesKB: 120, logsKB: 901 });
    expect(JSON.stringify(report)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('[NEW-03] merges tab deltas and refuses foreign bounds', () => {
    const tab = new HealthWindow(T0);
    tab.recordPerf('panelOpenMs', 40);
    tab.recordPerf('handlerMs', 0.3);
    tab.count('insert.prevented');
    const delta = tab.toTabReport(T0 + 60_000, contract(), { cachesKB: 300, domNodes: 1800 });
    expect(TabHealthReportSchema.safeParse(delta).success).toBe(true);
    const background = new HealthWindow(T0);
    background.recordPerf('panelOpenMs', 60);
    background.mergeTab(OP, delta);
    background.mergeTab(OP2, { ...delta, host: null, perf: [{ ...(delta.perf[0] ?? new Histogram('panelOpenMs').toWire()), schemaVersion: 9 }], footprint: { cachesKB: 50, domNodes: 10 } });
    const report = background.build(T0 + 900_000, CLIENT, { cachesKB: 10, logsKB: 0 });
    expect(report.perf.find((h) => h.metric === 'panelOpenMs')?.count).toBe(2);
    expect(report.counters).toMatchObject({ 'insert.prevented': 2, 'perf.rejected': 1, 'footprint.dom-nodes-max': 1800 });
    expect(report.footprint.cachesKB).toBe(360);
    expect(report.host.contractOk).toBe(true);
    expect(ClientHealthV1Schema.safeParse(report).success).toBe(true);
  });

  it('[NEW-03] bounds the cost of measuring and every list of the report', () => {
    const capped = new HealthWindow(T0, 5);
    for (let i = 0; i < 8; i += 1) capped.recordPerf('searchMs', i);
    capped.recordPerf('searchMs', -3);
    capped.recordPerf('boardOpenMs', -3);
    const cappedReport = capped.build(T0, CLIENT, { cachesKB: 0, logsKB: 0 });
    expect(cappedReport.perf.map((h) => [h.metric, h.count])).toEqual([['searchMs', 5]]);
    expect(cappedReport.counters).toMatchObject({ 'perf.capped': 4, 'perf.invalid': 1 });
    const window = new HealthWindow(T0, 5);
    window.recordPerf('searchMs', 1);
    for (let i = 0; i < 300; i += 1) window.count(`c.${i}`, i + 1);
    window.count('huge', 5e9);
    window.setDisabled(Array.from({ length: 100 }, (_, i) => `flag:f${i}`));
    const report = window.build(T0, { ...CLIENT, browserMajor: 0, version: '' }, { cachesKB: -5, logsKB: Number.NaN || 0 });
    expect(Object.keys(report.counters)).toHaveLength(TELEMETRY_LIMITS.healthMaxCounters);
    // The largest counters win the 200 places; the six P1 and safety counters are always there.
    expect(report.counters['c.299']).toBe(300);
    expect(report.counters['c.0']).toBeUndefined();
    expect(report.counters['p1.read-without-human']).toBe(0);
    expect(report.counters['huge']).toBe(TELEMETRY_LIMITS.healthMaxCounterValue);
    expect(report.disabled).toHaveLength(TELEMETRY_LIMITS.healthMaxListItems);
    expect(report.client).toMatchObject({ version: '0.0.0', browserMajor: 1 });
    expect(report.host).toMatchObject({ build: null, contractOk: false, missing: ['no-report'] });
    expect(ClientHealthV1Schema.safeParse(report).success).toBe(true);
    expect(new HealthWindow(T0).isEmpty()).toBe(true);
    expect(window.isEmpty()).toBe(false);
  });

  it('[NEW-03] the contract signature changes only when the contract result does', () => {
    const a = hostSignature(hostSummary(contract()));
    expect(hostSignature(hostSummary({ ...contract(), checkedAt: T0 + 5 }))).toBe(a);
    expect(hostSignature(hostSummary(contract({ anchors: { app: 'missing' } })))).not.toBe(a);
    expect(hostSignature(hostSummary({ ...contract(), build: 'index-NEW' }))).not.toBe(a);
    expect(hostSummary(null)).toEqual({ build: null, contractOk: false, missing: ['no-report'], degraded: [] });
  });

  it('[NEW-03] handlers are sampled 1 in 20', () => {
    const sampler = new HandlerSampler();
    const taken = Array.from({ length: 100 }, () => sampler.sample()).filter(Boolean).length;
    expect(taken).toBe(5);
    expect(new HandlerSampler(1).sample()).toBe(true);
  });
});
