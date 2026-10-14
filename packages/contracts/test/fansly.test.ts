// The Fansly bridge and host contracts (R20, 1.15.0; docs/project-unite/architecture.md §5.5–§5.8, §6, §7.7, §7.12):
// every type has its fixtures and they get their verdicts; the batch, its credits and its byte limits; the gap; the
// snapshot and the start proof with their bounds; ids are snowflake strings and never numbers; and the site modules
// stay out of the root, so no ChatSpace bundle can reach them.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import * as F from '../src/bridge-fansly';
import * as M from '../src/bridge-messages-fansly';
import * as H from '../src/fansly';
import * as P from '../src/fansly-host';
import * as C from '../src/index';
import {
  FANSLY_BRIDGE_EVENT_FIXTURES,
  FANSLY_BRIDGE_REQUEST_FIXTURES,
  FANSLY_MSG,
  FANSLY_SNAPSHOT_FIXTURES,
  FANSLY_WIRE_EVENT_FIXTURES,
  START_PROOF_FIXTURES,
  fanslyChatWire,
  fanslyHiSnapshot,
  fanslyIdentityWire,
  fanslyReplySnapshot,
  fullFanslyBatch,
  siteContractReport,
  oversizeFanslyBatch,
  oversizeFanslySnapshot,
  type Verdicts,
} from './fixtures/index';

type Schema = { safeParse(value: unknown): { success: boolean } };

function expectVerdicts(label: string, schema: Schema, verdicts: Verdicts): void {
  expect(verdicts.valid.length * verdicts.invalid.length, `${label} needs valid and invalid fixtures`).toBeGreaterThan(0);
  verdicts.valid.forEach((value, index) => expect(schema.safeParse(value).success, `${label} valid[${index}]`).toBe(true));
  verdicts.invalid.forEach((value, index) => expect(schema.safeParse(value).success, `${label} invalid[${index}]`).toBe(false));
}

const responseFrame = (t: string, data: unknown) => ({ v: 1, kind: 'res', id: 3, t, documentEpoch: 'doc1', seq: 4, ok: true, data });
const eventFrame = (t: string, payload: unknown) => ({ v: 1, kind: 'evt', t, documentEpoch: 'doc1', seq: 5, payload });

/** Bytes as the isolated side counts them, and whether the frame fits the limit of its own type. */
function fits(frame: { kind: string; t: string }): { readonly guard: boolean; readonly typed: boolean } {
  const check = C.checkBridgeFrame(frame);
  return { guard: check.ok, typed: check.ok && check.bytes <= F.fanslyFrameByteLimit(frame.kind, frame.t) };
}

describe('Fansly bridge registry (§6)', () => {
  it('has fixtures for exactly the registered requests, batch events and wire events, in the lists’ order', () => {
    expect(Object.keys(M.TO_MAIN_FANSLY)).toEqual([...F.TO_MAIN_FANSLY_TYPES]);
    expect(Object.keys(M.FROM_MAIN_FANSLY)).toEqual([...F.FROM_MAIN_FANSLY_TYPES]);
    expect(Object.keys(M.FANSLY_WIRE_EVENTS)).toEqual([...F.FANSLY_WIRE_EVENT_TYPES]);
    expect(Object.keys(FANSLY_BRIDGE_REQUEST_FIXTURES).sort()).toEqual([...F.TO_MAIN_FANSLY_TYPES].sort());
    expect(Object.keys(FANSLY_BRIDGE_EVENT_FIXTURES).sort()).toEqual([...F.FROM_MAIN_FANSLY_TYPES].sort());
    expect(Object.keys(FANSLY_WIRE_EVENT_FIXTURES).sort()).toEqual([...F.FANSLY_WIRE_EVENT_TYPES].sort());
  });

  for (const t of F.TO_MAIN_FANSLY_TYPES) {
    it(`${t}: payload and answer schemas, the request frame, the answer through the guard and its byte limit`, () => {
      const fixtures = FANSLY_BRIDGE_REQUEST_FIXTURES[t];
      expectVerdicts(`${t} payload`, M.TO_MAIN_FANSLY[t].payload, fixtures.payload);
      expectVerdicts(`${t} data`, M.TO_MAIN_FANSLY[t].data, fixtures.data);
      for (const payload of fixtures.payload.valid) {
        expect(M.FanslyBridgeRequestSchema.safeParse({ v: 1, kind: 'req', id: 1, t, documentEpoch: null, seq: 0, payload }).success, t).toBe(true);
      }
      for (const data of fixtures.data.valid) {
        expect(M.parseFanslyBridgeData(t, data), t).toEqual({ ok: true, data });
        const frame = responseFrame(t, data);
        expect(F.FanslyBridgeResponseSchema.safeParse(frame).success, t).toBe(true);
        expect(M.FromMainFanslyFrameSchema.safeParse(frame).success, t).toBe(true);
        expect(fits(frame), t).toEqual({ guard: true, typed: true });
      }
      for (const data of fixtures.data.invalid) expect(M.parseFanslyBridgeData(t, data), t).toEqual({ ok: false });
    });
  }

  for (const t of F.FROM_MAIN_FANSLY_TYPES) {
    it(`${t}: event payload, and as the one event of a batch`, () => {
      const fixtures = FANSLY_BRIDGE_EVENT_FIXTURES[t];
      expectVerdicts(`${t} evt`, M.FROM_MAIN_FANSLY[t], fixtures);
      for (const p of fixtures.valid) {
        const frame = eventFrame('fx.batch', { n: 1, events: [{ t, p }] });
        expect(M.FanslyBridgeEventSchema.safeParse(frame).success, t).toBe(true);
        expect(fits(frame), t).toEqual({ guard: true, typed: true });
      }
      for (const p of fixtures.invalid) expect(M.parseFanslyWireEvent('fx.batch', { n: 1, events: [{ t, p }] }), t).toBeNull();
    });
  }

  for (const t of F.FANSLY_WIRE_EVENT_TYPES) {
    it(`${t}: wire event payload and envelope`, () => {
      const fixtures = FANSLY_WIRE_EVENT_FIXTURES[t];
      expectVerdicts(`${t} wire`, M.FANSLY_WIRE_EVENTS[t], fixtures);
      for (const payload of fixtures.valid) {
        const frame = eventFrame(t, payload);
        expect(F.FanslyBridgeEventEnvelopeSchema.safeParse(frame).success, t).toBe(true);
        expect(M.FanslyBridgeEventSchema.safeParse(frame).success, t).toBe(true);
        expect(M.parseFanslyWireEvent(t, payload), t).toEqual(payload);
        expect(fits(frame), t).toEqual({ guard: true, typed: true });
      }
      for (const payload of fixtures.invalid) expect(M.parseFanslyWireEvent(t, payload), t).toBeNull();
    });
  }

  it('MAIN on Fansly writes nothing: no request is a write, all have the ordinary timeout', () => {
    expect(F.FANSLY_BRIDGE_WRITE_REQUESTS).toEqual([]);
    for (const t of F.TO_MAIN_FANSLY_TYPES) expect(M.TO_MAIN_FANSLY[t], t).toMatchObject({ write: false, timeout: 'call' });
  });

  it('the states and the undroppable stream split the batch events; fx.gap and fault go outside batches', () => {
    expect([...F.FANSLY_BRIDGE_STATE_EVENTS, ...F.FANSLY_BRIDGE_UNDROPPABLE_EVENTS].sort()).toEqual([...F.FROM_MAIN_FANSLY_TYPES].sort());
    expect(F.FANSLY_BRIDGE_STATE_EVENTS.filter((t) => (F.FANSLY_BRIDGE_UNDROPPABLE_EVENTS as readonly string[]).includes(t))).toEqual([]);
    expect(F.FANSLY_WIRE_EVENT_TYPES.filter((t) => (F.FROM_MAIN_FANSLY_TYPES as readonly string[]).includes(t))).toEqual([]);
    // fx.state answers with all three states whole.
    expect(Object.keys(M.FanslyStateSchema.def.shape)).toEqual(expect.arrayContaining(['identity', 'chat', 'contract']));
  });

  it('MAIN events carry no message text; only the snapshot does, for a draft function', () => {
    const shapes: Array<[string, unknown]> = [...Object.entries(M.FROM_MAIN_FANSLY), ...Object.entries(M.FANSLY_WIRE_EVENTS)];
    for (const [t, schema] of shapes) {
      const shape = (schema as { def?: { shape?: Record<string, unknown> } }).def?.shape ?? {};
      for (const key of ['text', 'plainText', 'html', 'body', 'content', 'tail']) expect(Object.keys(shape), `${t}.${key}`).not.toContain(key);
    }
    expect(Object.keys(H.FanslySnapshotSchema.def.shape)).toContain('tail');
  });

  it('the shared transport: the same envelope version, transport errors and probe as ChatSpace; their types do not cross', () => {
    const err = { v: 1, kind: 'res', id: 2, t: 'fx.state', documentEpoch: 'doc1', seq: 1, ok: false, err: 'not-ready' };
    expect(F.FanslyBridgeResponseSchema.safeParse(err).success).toBe(true);
    expect(F.FanslyBridgeResponseSchema.safeParse({ ...err, err: 'stale-document' }).success).toBe(true);
    expect(F.FanslyBridgeResponseSchema.safeParse({ ...err, err: 'gone' }).success).toBe(false);
    expect(M.TO_MAIN_FANSLY.probe.data).toBe(C.MainProbeSchema);
    // A ChatSpace request or event never passes as a Fansly one, nor the other way round.
    expect(F.FanslyBridgeResponseSchema.safeParse({ ...err, t: 'snapshot' }).success).toBe(false);
    expect(F.FanslyBridgeEventEnvelopeSchema.safeParse(eventFrame('incoming', {})).success).toBe(false);
    expect(C.BridgeEventEnvelopeSchema.safeParse(eventFrame('fx.batch', { n: 1, events: [] })).success).toBe(false);
    expect(C.BridgeResponseSchema.safeParse({ ...err, t: 'fx.state' }).success).toBe(false);
  });

  it('a fault names its site by the same rule as on ChatSpace', () => {
    const fault = M.FANSLY_WIRE_EVENTS.fault;
    for (const source of ['frame', 'xhrLoadend', 'a'.repeat(32), 'a'.repeat(33), '1frame', 'xhr-loadend', '']) {
      expect(fault.safeParse({ source, count: 1 }).success, source).toBe(C.FAULT_SITE_PATTERN.test(source));
    }
  });
});

describe('fx.batch credits and limits (§6, FS-TAIL-5)', () => {
  it('holds the architecture’s numbers: 8 batches, 256 KiB in flight; a batch ≤ 64 KiB and 512 events; a snapshot ≤ 128 KiB', () => {
    expect(F.FANSLY_BRIDGE_LIMITS).toEqual({ maxUnackedBatches: 8, maxInFlightBytes: 256 * 1024, maxBatchBytes: 64 * 1024, maxBatchEvents: 512, maxSnapshotBytes: 128 * 1024 });
    // A batch always fits in flight on its own, and both Fansly limits are tighter than the bridge's frame.
    expect(F.FANSLY_BRIDGE_LIMITS.maxBatchBytes).toBeLessThanOrEqual(F.FANSLY_BRIDGE_LIMITS.maxInFlightBytes);
    expect(F.fanslyFrameByteLimit('evt', 'fx.batch')).toBe(64 * 1024);
    expect(F.fanslyFrameByteLimit('res', 'fx.generationSnapshot')).toBe(128 * 1024);
    for (const [kind, t] of [['evt', 'fx.gap'], ['evt', 'fault'], ['res', 'fx.state'], ['res', 'fx.batch'], ['evt', 'fx.generationSnapshot']] as const) {
      expect(F.fanslyFrameByteLimit(kind, t), `${kind} ${t}`).toBe(C.BRIDGE_LIMITS.maxFrameBytes);
    }
  });

  it('a batch at its event limit passes; one over it, or over its bytes, does not', () => {
    expect(fits(eventFrame('fx.batch', fullFanslyBatch()))).toEqual({ guard: true, typed: true });
    // 400 events of 20 groups: within the event limit and the bridge's 256 KiB, over the batch's 64 KiB.
    const big = oversizeFanslyBatch();
    expect(M.parseFanslyWireEvent('fx.batch', big)).not.toBeNull();
    expect(fits(eventFrame('fx.batch', big))).toEqual({ guard: true, typed: false });
  });

  it('a snapshot answer over 128 KiB is too large though the bridge would carry it', () => {
    const big = oversizeFanslySnapshot();
    expect(M.parseFanslyBridgeData('fx.generationSnapshot', big).ok).toBe(true);
    expect(fits(responseFrame('fx.generationSnapshot', big))).toEqual({ guard: true, typed: false });
    expect(fits(responseFrame('fx.generationSnapshot', fanslyReplySnapshot))).toEqual({ guard: true, typed: true });
  });

  it('ack is cumulative and names a batch; the gap carries only its reason', () => {
    expect(M.TO_MAIN_FANSLY['fx.ack'].payload.safeParse({ n: 8 }).success).toBe(true);
    expect(M.TO_MAIN_FANSLY['fx.ack'].payload.safeParse({ n: [1, 2] }).success).toBe(false);
    expect(F.FANSLY_GAP_REASONS).toEqual(['overflow', 'memory']);
    expect(Object.keys(M.FanslyGapSchema.def.shape)).toEqual(['reason']);
  });
});

describe('Fansly ids: snowflake strings, never numbers', () => {
  it('orders by length, then as strings: 19 digits after 18, 17 before', () => {
    expect(H.compareFanslyIds(FANSLY_MSG.m1, FANSLY_MSG.m2)).toBeLessThan(0);
    expect(H.compareFanslyIds(FANSLY_MSG.newer, FANSLY_MSG.m3)).toBeGreaterThan(0);
    expect(H.compareFanslyIds('99999999999999999', '100000000000000000')).toBeLessThan(0);
    expect(H.compareFanslyIds(FANSLY_MSG.m2, FANSLY_MSG.m2)).toBe(0);
    // As strings alone the 19-digit id would sort first.
    expect(FANSLY_MSG.newer < FANSLY_MSG.m1).toBe(true);
  });

  it('above 2^53 a number would merge neighbours, so every id field takes a string only', () => {
    expect(Number(FANSLY_MSG.m1)).toBe(Number(FANSLY_MSG.m2));
    const numeric = Number(FANSLY_MSG.m1);
    expect(M.FROM_MAIN_FANSLY['fx.sent'].safeParse({ groupId: '700000000000000003', msgId: numeric, contentDigest: 'deadbeef' }).success).toBe(false);
    expect(M.FROM_MAIN_FANSLY['fx.deleted'].safeParse({ groupId: '700000000000000003', ids: [numeric] }).success).toBe(false);
    expect(M.TO_MAIN_FANSLY['fx.windowMeta'].payload.safeParse({ groupId: numeric }).success).toBe(false);
    expect(H.FanslySnapshotSchema.safeParse({ ...fanslyReplySnapshot, knownFanMessageIds: [numeric] }).success).toBe(false);
    expect(M.FROM_MAIN_FANSLY['fx.chat'].safeParse({ ...fanslyChatWire, fanId: Number(fanslyChatWire.fanId) }).success).toBe(false);
    expect(M.FROM_MAIN_FANSLY['fx.identity'].safeParse({ ...fanslyIdentityWire, creatorId: Number(fanslyIdentityWire.creatorId) }).success).toBe(false);
  });
});

describe('StartProofV1 (§5.8, FS-AI-2)', () => {
  it('valid and invalid proofs, among them 121 automated ids', () => {
    expectVerdicts('StartProofV1', H.StartProofV1Schema, START_PROOF_FIXTURES);
  });

  it('holds at most the ring’s capacity of automated ids; the pass counts personal messages among its last 30', () => {
    expect(H.FANSLY_LIMITS.automatedIdsMax).toBe(H.FANSLY_LIMITS.ringRecords);
    expect(H.FANSLY_LIMITS.passPersonalWindow).toBe(30);
    expect(H.FANSLY_LIMITS.historyPage).toBe(25);
    expect(H.START_PROOF_SOURCES).toEqual(['tab-short-page', 'pass-empty-page']);
  });
});

describe('FanslySnapshot (§5.8, FS-TAIL-6)', () => {
  it('valid and invalid snapshots', () => {
    expectVerdicts('FanslySnapshot', H.FanslySnapshotSchema, FANSLY_SNAPSHOT_FIXTURES);
  });

  it('the check window is the hub’s live text window; the tail is in the hub’s live text form', () => {
    expect(H.FANSLY_LIMITS.checkWindowMax).toBe(C.LIVE_TEXT_LIMITS.maxItems);
    expect(H.FANSLY_LIMITS.tailMax).toBe(C.LIVE_TEXT_LIMITS.maxItems);
    expect(Object.keys(H.FanslyTailMessageSchema.def.shape)).toEqual(Object.keys(C.LiveTextMessageSchema.def.shape));
    const item = fanslyReplySnapshot.tail[0];
    for (const value of [item, { ...item, text: '' }, { ...item, text: 'x'.repeat(C.LIVE_TEXT_LIMITS.maxChars + 1) }, { ...item, sentAt: 'today' }, { ...item, direction: 'them' }]) {
      expect(H.FanslyTailMessageSchema.safeParse(value).success).toBe(C.LiveTextMessageSchema.safeParse(value).success);
    }
  });

  it('the avatar is a Fansly CDN address, as the hub takes it', () => {
    for (const [url, ok] of [
      [fanslyHiSnapshot.fanAvatarUrl, true],
      ['https://fansly.com/', false],
      ['http://cdn3.fansly.com/a.jpeg', false],
      ['https://cdn3.fansly.com.evil.example/a.jpeg', false],
      [`https://cdn3.fansly.com/${'a'.repeat(4096)}`, false],
    ] as const) {
      expect(H.FanslyAvatarUrlSchema.safeParse(url).success, url.slice(0, 60)).toBe(ok);
    }
  });
});

describe('Fansly anchors and capabilities (§7.12, FS-CTR-1)', () => {
  it('names the anchors of §7.12; MAIN reports the network ones, exactly the keys of fx.contract', () => {
    expect(H.FANSLY_ANCHOR_IDS).toHaveLength(17);
    expect(H.FANSLY_NETWORK_ANCHORS.every((anchor) => (H.FANSLY_ANCHOR_IDS as readonly string[]).includes(anchor))).toBe(true);
    expect(Object.keys(M.FanslyContractWireSchema.def.shape.anchors.def.shape)).toEqual([...H.FANSLY_NETWORK_ANCHORS]);
  });

  it('Fansly capabilities come on top of the shared ones, and its anchors are its own', () => {
    expect(H.FANSLY_CAPABILITIES.filter((c) => (C.HOST_CAPABILITIES as readonly string[]).includes(c))).toEqual([]);
    expect(H.FANSLY_ANCHOR_IDS.filter((a) => (C.ANCHOR_IDS as readonly string[]).includes(a))).toEqual([]);
  });
});

describe('Fansly’s side of the host contract (P4b1: §7.7, §7.12, FS-CTR-1)', () => {
  const block = siteContractReport.extensions['fansly-web'];
  if (block === undefined) throw new Error('the sample names its block');
  const report = { ...siteContractReport, extensions: { 'fansly-web': block } };
  const withoutAnchor = (anchor: string) => ({ ...report, extensions: { 'fansly-web': { ...block, anchors: Object.fromEntries(Object.entries(block.anchors).filter(([name]) => name !== anchor)) } } });

  it('the expected set is every Fansly anchor; what is off without a break is named, and is the site’s', () => {
    expect(P.FANSLY_CONTRACT.anchors).toEqual(H.FANSLY_ANCHOR_IDS);
    for (const anchor of P.FANSLY_CONTRACT.switchedAnchors) expect(P.FANSLY_CONTRACT.anchors).toContain(anchor);
    for (const capability of P.FANSLY_CONTRACT.switchedCapabilities) expect(C.HOST_CAPABILITIES).toContain(capability);
    // ChatSpace's set stays as F7 left it.
    expect(C.CHATSPACE_CONTRACT.anchors).toEqual(C.ANCHOR_IDS);
  });

  it('the strict branch takes a report naming every anchor and capability of Fansly; the shared schema takes it too', () => {
    expect(P.FanslyContractReportSchema.safeParse(report).success).toBe(true);
    expect(C.HostContractReportSchema.safeParse(report).success).toBe(true);
    expect(P.FanslyContractBlockSchema.safeParse(block).success).toBe(true);
    expect(P.FanslyContractReportSchema.safeParse({ ...report, extensions: { 'fansly-web': { ...block, anchors: { ...block.anchors, socket: 'notYet' } } } }).success).toBe(true);
  });

  it('a report without the block, without one anchor or capability, or with a name Fansly does not have, is no report of Fansly’s', () => {
    for (const anchor of H.FANSLY_ANCHOR_IDS) {
      expect(P.FanslyContractReportSchema.safeParse(withoutAnchor(anchor)).success, anchor).toBe(false);
      // The shared schema knows no site's anchors: its readers count the missing one as `missing` (FS-CTR-1).
      expect(C.HostContractReportSchema.safeParse(withoutAnchor(anchor)).success, anchor).toBe(true);
    }
    for (const capability of H.FANSLY_CAPABILITIES) {
      const capabilities = Object.fromEntries(Object.entries(block.capabilities).filter(([name]) => name !== capability));
      expect(P.FanslyContractBlockSchema.safeParse({ ...block, capabilities }).success, capability).toBe(false);
    }
    expect(P.FanslyContractReportSchema.safeParse({ ...report, extensions: {} }).success).toBe(false);
    expect(P.FanslyContractBlockSchema.safeParse({ ...block, anchors: { ...block.anchors, wsFrames: 'ok' } }).success).toBe(false);
    expect(P.FanslyContractBlockSchema.safeParse({ ...block, capabilities: { ...block.capabilities, previewSend: { state: 'off' } } }).success).toBe(false);
    expect(P.FanslyContractReportSchema.safeParse({ ...report, host: 'chatspace' }).success).toBe(false);
    expect(P.FanslyContractReportSchema.safeParse({ ...report, capabilities: { ...report.capabilities, receipt: undefined } }).success).toBe(false);
  });
});

describe('site modules stay out of the root (§1.8, §3.2)', () => {
  it('@cg/contracts does not re-export them; each is its own subpath', () => {
    const root = Object.keys(C);
    for (const name of [...Object.keys(F), ...Object.keys(M), ...Object.keys(H), ...Object.keys(P)]) expect(root, name).not.toContain(name);
    const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(index).not.toMatch(/from '\.\/[^']*fansly[^']*'/);
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { exports: Record<string, string> };
    expect(manifest.exports['./fansly']).toBe('./src/fansly.ts');
    expect(manifest.exports['./bridge-fansly']).toBe('./src/bridge-fansly.ts');
    expect(manifest.exports['./bridge-messages-fansly']).toBe('./src/bridge-messages-fansly.ts');
    expect(manifest.exports['./fansly-host']).toBe('./src/fansly-host.ts');
  });

  it('fansly.ts takes nothing of host.ts or ids.ts at run time, so they may import from it', () => {
    const source = readFileSync(new URL('../src/fansly.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/^import type \{ Unsubscribe \} from '\.\/host';$/m);
    expect(source).not.toMatch(/^import \{[^}]*\} from '\.\/(host|ids)';$/m);
  });
});
