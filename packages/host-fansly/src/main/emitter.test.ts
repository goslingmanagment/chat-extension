// `fx.batch` with credits and the one `fx.gap` (docs/project-unite/
// architecture.md §6): every frame the emitter posts, wrapped as the boot
// wraps it, passes the isolated side's checks — the bridge's guard, the byte
// limit of its type and Fansly's schemas — and a consumer that stops taking
// batches holds MAIN within its limits.

import { checkBridgeFrame } from '@cg/contracts/bridge';
import { fanslyFrameByteLimit, FANSLY_BRIDGE_LIMITS } from '@cg/contracts/bridge-fansly';
import { FanslyBridgeEventSchema } from '@cg/contracts/bridge-messages-fansly';
import { describe, expect, it } from 'vitest';

import { createEmitter } from './emitter';
import { QUEUE_MAX_BYTES, QUEUE_MAX_EVENTS } from './protocol';

type Plain = Record<string, unknown>;

const GROUP = '700000000000000010';
const incoming = (i: number): Plain => ({
  groupId: GROUP,
  fanId: null,
  msgId: `7000000000003${String(i).padStart(5, '0')}`,
  fromFan: true,
  automated: false,
  tip: false,
  createdAt: '2026-10-15T10:00:00.000Z',
});
const identity: Plain = { creatorId: '700000000000000001', accountMeSeen: true, legacy: false, fbuddy: { windowBridge: false, networkHook: false, styleFixes: false, wordFilter: false } };
const contract = (frames: string): Plain => ({ anchors: { accountMe: 'ok', socket: 'ok', frames, xhr: 'ok' }, tap: 'ok' });

/** An emitter whose posts are wrapped as the boot wraps them and checked as the isolated side checks them. */
function harness() {
  const posted: Array<{ t: string; payload: Plain; bytes: number }> = [];
  let seq = 0;
  const emitter = createEmitter((t, payload) => {
    const frame = { v: 1, kind: 'evt', t, payload, documentEpoch: 'a1b2c3d4e5f6a1b2c3d4e5f6', seq: seq++ };
    const check = checkBridgeFrame(frame);
    if (!check.ok) throw new Error(`the bridge's guard refused ${t}: ${check.reason}`);
    if (check.bytes > fanslyFrameByteLimit('evt', t)) throw new Error(`${t} over its limit: ${check.bytes}`);
    if (!FanslyBridgeEventSchema.safeParse(frame).success) throw new Error(`${t} failed Fansly's schema: ${JSON.stringify(payload).slice(0, 300)}`);
    posted.push({ t, payload, bytes: check.bytes });
  }, JSON.stringify);
  const batches = () => posted.filter((p) => p.t === 'fx.batch').map((p) => p.payload as { n: number; events: Array<{ t: string; p: Plain }> });
  return { emitter, posted, batches };
}

describe('[EX-008] [host:fansly] the fx.batch emitter: credits, states, one gap', () => {
  it('waits for the first fx.state; then one batch per listener call, states first and once, the stream in order', () => {
    const { emitter, posted, batches } = harness();
    emitter.event('fx.incoming', incoming(1));
    emitter.flush();
    expect(posted).toEqual([]);
    expect(emitter.start()).toBe(0);
    emitter.state('fx.contract', contract('notYet'));
    emitter.state('fx.identity', identity);
    emitter.state('fx.contract', contract('ok'));
    emitter.event('fx.incoming', incoming(2));
    emitter.flush();
    emitter.flush();
    expect(batches()).toEqual([
      {
        n: 1,
        events: [
          { t: 'fx.contract', p: contract('ok') },
          { t: 'fx.identity', p: identity },
          { t: 'fx.incoming', p: incoming(1) },
          { t: 'fx.incoming', p: incoming(2) },
        ],
      },
    ]);
    expect(emitter.stats()).toMatchObject({ batches: 1, unacked: 1, queued: 0, gaps: 0 });
  });

  it('a blocked consumer: 8 batches in flight, the queue to its limit, then ONE fx.gap and nothing more until fx.state; n goes on', () => {
    const { emitter, posted, batches } = harness();
    emitter.start();
    let i = 0;
    // One event a listener call, as the page's frames come.
    for (; i < 8; i += 1) {
      emitter.event('fx.incoming', incoming(i));
      emitter.flush();
    }
    expect(batches().map((b) => b.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (; i < 8 + QUEUE_MAX_EVENTS + 10; i += 1) {
      emitter.event('fx.incoming', incoming(i));
      emitter.flush();
      expect(emitter.held()).toBeLessThanOrEqual(QUEUE_MAX_BYTES + FANSLY_BRIDGE_LIMITS.maxInFlightBytes);
    }
    expect(batches()).toHaveLength(8);
    expect(posted.filter((p) => p.t === 'fx.gap')).toEqual([{ t: 'fx.gap', payload: { reason: 'overflow' }, bytes: expect.any(Number) as unknown }]);
    // After the gap MAIN holds only what is in flight; the stream is silent, acks or not.
    expect(emitter.stats()).toMatchObject({ unacked: 8, queued: 0, gaps: 1 });
    emitter.ack(8);
    emitter.event('fx.incoming', incoming(i++));
    emitter.flush();
    expect(batches()).toHaveLength(8);
    expect(emitter.held()).toBe(0);
    // fx.state: the stream starts again after the batch it names; the numbers go on.
    expect(emitter.start()).toBe(8);
    emitter.event('fx.incoming', incoming(i));
    emitter.flush();
    expect(batches().at(-1)?.n).toBe(9);
    expect(posted.filter((p) => p.t === 'fx.gap')).toHaveLength(1);
  });

  it('an ack frees every batch up to its number, and the queue goes out in batches of ≤ 512 events and ≤ 64 KiB', () => {
    const { emitter, batches, posted } = harness();
    emitter.start();
    for (let i = 0; i < 8; i += 1) {
      emitter.event('fx.incoming', incoming(i));
      emitter.flush();
    }
    // ≈ 210 KB waiting: under the queue's limit.
    for (let i = 8; i < 8 + 1200; i += 1) emitter.event('fx.incoming', incoming(i));
    emitter.flush();
    expect(batches()).toHaveLength(8);
    emitter.ack(3);
    // Three credits free, one listener call: one batch.
    expect(emitter.stats().unacked).toBe(6);
    // A stale ack frees nothing; its call is a listener call like any other: one more batch, up to the credits.
    emitter.ack(3);
    emitter.ack(1);
    emitter.ack(2);
    expect(emitter.stats().unacked).toBe(8);
    expect(batches().at(-1)?.n).toBe(11);
    while (emitter.stats().queued > 0) emitter.ack(batches().at(-1)?.n ?? 0);
    const sizes = batches().map((b) => b.events.length);
    for (const size of sizes) expect(size).toBeLessThanOrEqual(FANSLY_BRIDGE_LIMITS.maxBatchEvents);
    for (const frame of posted) expect(frame.bytes).toBeLessThanOrEqual(FANSLY_BRIDGE_LIMITS.maxBatchBytes);
    // Full batches of the queue are cut by their bytes: close to 64 KiB, never over it.
    expect(Math.max(...posted.map((frame) => frame.bytes))).toBeGreaterThan(FANSLY_BRIDGE_LIMITS.maxBatchBytes - 1024);
    // Every event went, in order, exactly once.
    const ids = batches().flatMap((b) => b.events.map((e) => e.p['msgId']));
    expect(ids).toEqual(Array.from({ length: 1208 }, (_, i) => incoming(i)['msgId']));
    expect(emitter.held()).toBeGreaterThan(0);
    emitter.ack(99);
    expect(emitter.held()).toBe(0);
  });

  it('keeps the bytes in flight within 256 KiB: large events wait for an ack instead of overrunning the credits', () => {
    const { emitter, posted } = harness();
    emitter.start();
    const groupIds = Array.from({ length: 300 }, (_, i) => `7000000000004${String(i).padStart(5, '0')}`);
    // ≈ 6.6 KB each: coverage of 300 chats.
    for (let round = 0; round < 60; round += 1) {
      for (let i = 0; i < 9; i += 1) emitter.event('fx.coverage', { groupIds, state: 'unknown', reason: 'frame' });
      emitter.flush();
      const inFlight = emitter.stats();
      expect(inFlight.unacked).toBeLessThanOrEqual(FANSLY_BRIDGE_LIMITS.maxUnackedBatches);
      expect(emitter.held() - 0).toBeLessThanOrEqual(QUEUE_MAX_BYTES + FANSLY_BRIDGE_LIMITS.maxInFlightBytes);
      if (posted.some((p) => p.t === 'fx.gap')) break;
    }
    const inFlightBytes = posted.filter((p) => p.t === 'fx.batch').reduce((sum, p) => sum + p.bytes, 0);
    expect(inFlightBytes).toBeLessThanOrEqual(FANSLY_BRIDGE_LIMITS.maxInFlightBytes);
    expect(posted.filter((p) => p.t === 'fx.gap')).toHaveLength(1);
  });

  it('drops states and events during a gap: the answer of fx.state carries the states whole', () => {
    const { emitter, batches } = harness();
    emitter.gap('memory');
    emitter.state('fx.identity', identity);
    emitter.event('fx.incoming', incoming(1));
    emitter.start();
    emitter.flush();
    expect(batches()).toEqual([]);
    emitter.state('fx.identity', identity);
    emitter.start();
    emitter.flush();
    expect(batches()).toEqual([]);
    expect(emitter.stats()).toMatchObject({ gaps: 1, batches: 0 });
  });
});
