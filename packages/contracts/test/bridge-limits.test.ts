// Property-style tests of the bridge limits (§5.3 «Пределы», §14): random
// frames from a seeded generator, so a failure is reproducible by its seed.

import { describe, expect, it } from 'vitest';

import * as C from '../src/index';
import { IDS, ISO, uuid } from './fixtures/index';

/** mulberry32: small seeded PRNG. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = ['a', 'Z', '7', ' ', '"', '\\', '\n', '\t', '\u0001', '\u001f', 'é', 'Ж', '€', ' ', '😀', '\ud800', '\udc00', '/', '<'];

function randomString(next: () => number, maxLength: number): string {
  const length = Math.floor(next() * maxLength);
  let text = '';
  for (let i = 0; i < length; i += 1) text += ALPHABET[Math.floor(next() * ALPHABET.length)];
  return text;
}

function randomValue(next: () => number, depth: number): unknown {
  const roll = next();
  if (depth >= 5 || roll < 0.35) {
    const leaf = Math.floor(next() * 6);
    if (leaf === 0) return null;
    if (leaf === 1) return next() < 0.5;
    if (leaf === 2) return Math.floor(next() * 2e9) - 1e9;
    if (leaf === 3) return (next() - 0.5) * 1e6;
    return randomString(next, 40);
  }
  if (roll < 0.65) return Array.from({ length: Math.floor(next() * 6) }, () => randomValue(next, depth + 1));
  const record: Record<string, unknown> = {};
  const keys = Math.floor(next() * 6);
  for (let i = 0; i < keys; i += 1) record[randomString(next, 12) || `k${i}`] = randomValue(next, depth + 1);
  return record;
}

const utf8Bytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

/** Pads `prefix` with ASCII so the frame's JSON is exactly `bytes` long. */
function frameOfSize(bytes: number): unknown {
  const base = { v: 1, kind: 'evt', t: 'accounts', documentEpoch: 'doc1', seq: 0, payload: {}, pad: [] as string[] };
  const overhead = utf8Bytes(base);
  const chunks: string[] = [];
  let remaining = bytes - overhead;
  // Each chunk adds its length + 2 quotes (+ 1 comma after the first).
  while (remaining > 0) {
    const comma = chunks.length === 0 ? 0 : 1;
    const size = Math.min(C.BRIDGE_LIMITS.maxStringLength, remaining - 2 - comma);
    if (size < 0) break;
    chunks.push('x'.repeat(size));
    remaining -= size + 2 + comma;
  }
  return { ...base, pad: chunks };
}

describe('checkBridgeFrame: plain JSON within the limits', () => {
  it('counts exactly the UTF-8 bytes of JSON.stringify for random frames', () => {
    for (let seed = 1; seed <= 400; seed += 1) {
      const value = randomValue(rng(seed), 0);
      const check = C.checkBridgeFrame(value);
      expect(check.ok, `seed ${seed}`).toBe(true);
      if (check.ok) expect(check.bytes, `seed ${seed}`).toBe(utf8Bytes(value));
    }
  });

  it('frame ≤ 256 KiB: accepted at the limit, rejected one byte over', () => {
    const limit = C.BRIDGE_LIMITS.maxFrameBytes;
    for (const size of [limit - 1000, limit - 1, limit]) {
      const frame = frameOfSize(size);
      expect(utf8Bytes(frame)).toBe(size);
      expect(C.checkBridgeFrame(frame)).toEqual({ ok: true, bytes: size });
    }
    for (const size of [limit + 1, limit + 2, limit + 5000]) {
      const frame = frameOfSize(size);
      expect(utf8Bytes(frame)).toBe(size);
      expect(C.checkBridgeFrame(frame)).toEqual({ ok: false, reason: 'too-large' });
    }
  });

  it('frame size verdict matches the real byte count for random sizes around the limit', () => {
    const next = rng(77);
    const limit = C.BRIDGE_LIMITS.maxFrameBytes;
    for (let i = 0; i < 60; i += 1) {
      const size = limit - 3000 + Math.floor(next() * 6000);
      const frame = frameOfSize(size);
      expect(C.checkBridgeFrame(frame).ok, `size ${size}`).toBe(utf8Bytes(frame) <= limit);
    }
  });

  it('string ≤ 20 000 characters, for values and for keys', () => {
    const max = C.BRIDGE_LIMITS.maxStringLength;
    const next = rng(5);
    for (let i = 0; i < 40; i += 1) {
      const length = max - 20 + Math.floor(next() * 40);
      const text = 'ж'.repeat(length);
      expect(C.checkBridgeFrame({ text }).ok, `value ${length}`).toBe(length <= max);
      expect(C.checkBridgeFrame({ [text]: 1 }).ok, `key ${length}`).toBe(length <= max);
    }
  });

  it('prototype keys are rejected at any depth', () => {
    const next = rng(9);
    for (const key of C.PROTOTYPE_KEYS) {
      for (let i = 0; i < 30; i += 1) {
        const depth = Math.floor(next() * 6);
        let json = `{${JSON.stringify(key)}:{"x":1}}`;
        for (let d = 0; d < depth; d += 1) json = next() < 0.5 ? `{"n${d}":${json}}` : `[${json}]`;
        const value: unknown = JSON.parse(json);
        expect(C.checkBridgeFrame(value), `${key} at depth ${depth}`).toEqual({ ok: false, reason: 'prototype-key' });
      }
    }
  });

  it('rejects values that are not plain JSON', () => {
    class Box {
      readonly x = 1;
    }
    const sparse: unknown[] = [];
    sparse[2] = 1;
    const extra = Object.assign([1, 2], { more: true });
    const cases: Array<[unknown, C.BridgeRejectReason]> = [
      [undefined, 'not-json'],
      [{ a: undefined }, 'not-json'],
      [() => 1, 'not-json'],
      [Symbol('s'), 'not-json'],
      [10n, 'not-json'],
      [Number.NaN, 'not-finite'],
      [{ n: Number.POSITIVE_INFINITY }, 'not-finite'],
      [new Date(0), 'not-plain'],
      [new Map(), 'not-plain'],
      [new Set([1]), 'not-plain'],
      [new Box(), 'not-plain'],
      [sparse, 'not-plain'],
      [extra, 'not-plain'],
      [{ [Symbol('k')]: 1 }, 'not-plain'],
      [new Uint8Array(4), 'not-plain'],
    ];
    for (const [value, reason] of cases) expect(C.checkBridgeFrame(value), String(reason)).toEqual({ ok: false, reason });
    expect(C.checkBridgeFrame(Object.create(null)).ok).toBe(true);
  });

  it('depth, array length and key count are bounded', () => {
    let deep: unknown = 1;
    for (let d = 0; d < C.BRIDGE_LIMITS.maxDepth; d += 1) deep = [deep];
    expect(C.checkBridgeFrame(deep).ok).toBe(true);
    expect(C.checkBridgeFrame([deep])).toEqual({ ok: false, reason: 'too-deep' });
    expect(C.checkBridgeFrame(new Array(C.BRIDGE_LIMITS.maxArrayLength).fill(0)).ok).toBe(true);
    expect(C.checkBridgeFrame(new Array(C.BRIDGE_LIMITS.maxArrayLength + 1).fill(0))).toEqual({ ok: false, reason: 'array-too-long' });
    const keys = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, i]));
    expect(C.checkBridgeFrame(keys(C.BRIDGE_LIMITS.maxObjectKeys)).ok).toBe(true);
    expect(C.checkBridgeFrame(keys(C.BRIDGE_LIMITS.maxObjectKeys + 1))).toEqual({ ok: false, reason: 'too-many-keys' });
  });
});

describe('bridge schemas at the limits', () => {
  const message = (i: number) => ({ platformMessageId: String(5000 + i), direction: i % 2 ? 'fan' : 'model', sentAt: ISO, text: `m${i}` });

  it('snapshot ≤ 200 messages: a tail answer from MAIN is accepted iff 1 ≤ n ≤ 200', () => {
    const next = rng(21);
    const sizes = [0, 1, 199, 200, 201, 260, ...Array.from({ length: 30 }, () => Math.floor(next() * 260))];
    for (const n of sizes) {
      const data = { capturedAt: ISO, messages: Array.from({ length: n }, (_, i) => message(i)) };
      expect(C.parseBridgeData('readTail', data) !== null, `n = ${n}`).toBe(n >= 1 && n <= C.BRIDGE_LIMITS.maxSnapshotMessages);
      expect(C.checkBridgeFrame({ v: 1, kind: 'res', id: 1, t: 'readTail', documentEpoch: 'doc1', seq: 0, ok: true, data }).ok).toBe(true);
    }
  });

  it('the hub-bound fresh text stays within the hub limit of 60', () => {
    expect(C.LiveTextTailSchema.safeParse({ capturedAt: ISO, messages: Array.from({ length: 60 }, (_, i) => message(i)) }).success).toBe(true);
    expect(C.LiveTextTailSchema.safeParse({ capturedAt: ISO, messages: Array.from({ length: 61 }, (_, i) => message(i)) }).success).toBe(false);
  });

  it('unknown request and event types are rejected', () => {
    const next = rng(33);
    const known = new Set<string>([...C.TO_MAIN_TYPES, ...C.FROM_MAIN_TYPES]);
    for (let i = 0; i < 200; i += 1) {
      const t = randomString(next, 14) || 'x';
      if (known.has(t)) continue;
      expect(C.BridgeRequestSchema.safeParse({ v: 1, kind: 'req', id: 1, t, documentEpoch: null, seq: 0, payload: {} }).success, t).toBe(false);
      expect(C.BridgeEventSchema.safeParse({ v: 1, kind: 'evt', t, documentEpoch: 'doc1', seq: 0, payload: {} }).success, t).toBe(false);
      expect(C.BridgeResponseSchema.safeParse({ v: 1, kind: 'res', id: 1, t, documentEpoch: 'doc1', seq: 0, ok: true, data: {} }).success, t).toBe(false);
    }
    for (const t of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(C.BridgeRequestSchema.safeParse({ v: 1, kind: 'req', id: 1, t, documentEpoch: null, seq: 0, payload: {} }).success, t).toBe(false);
    }
  });

  it('extra fields and unsafe ids are rejected', () => {
    const base = { v: 1, kind: 'evt', t: 'chatCache', documentEpoch: 'doc1', seq: 0 } as const;
    expect(C.BridgeEventSchema.safeParse({ ...base, payload: { acc: IDS.acc, fan: IDS.fan } }).success).toBe(true);
    expect(C.BridgeEventSchema.safeParse({ ...base, payload: { acc: IDS.acc, fan: IDS.fan, extra: 1 } }).success).toBe(false);
    expect(C.BridgeEventSchema.safeParse({ ...base, extra: 1, payload: { acc: IDS.acc, fan: IDS.fan } }).success).toBe(false);
    for (const unsafe of ['0', '-1', '1e9', '9007199254740993.0', 'abc', '1'.repeat(31), ' 2002']) {
      expect(C.BridgeEventSchema.safeParse({ ...base, payload: { acc: IDS.acc, fan: unsafe } }).success, unsafe).toBe(false);
    }
    expect(C.BridgeRequestSchema.safeParse({ v: 1, kind: 'req', id: 1, t: 'previewSendCommit', documentEpoch: 'doc1', seq: 0, payload: { req: { attemptId: uuid(5) } } }).success).toBe(false);
  });
});
