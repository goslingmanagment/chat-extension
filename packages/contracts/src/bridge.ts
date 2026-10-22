// MAIN ↔ isolated bridge (architecture.md §5.3, D-08, §14): the light half —
// handshake constants, the frame guard, the message type lists, the generic
// envelopes and the probe. Everything the early isolated start needs, nothing
// that builds the per-type payload schemas (those live in bridge-messages.ts,
// which a bundle imports only when it handles that traffic).
//
// Handshake: MAIN posts {tag: 'main-ready', v} and listens for 'iso-hello';
// the isolated script posts 'iso-hello' and listens for 'main-ready';
// whoever is second, the isolated side creates a MessageChannel and sends
// port2 with {tag: 'connect', v, nonce}; MAIN accepts only the first valid
// 'connect' and drops its window listener. Everything after that rides the port.
// The page can see these messages and the tap's global: their names are
// neutral and never name the extension (decision X22).
//
// The port is a routing channel, not an identity: the page sees MAIN and can
// post anything. The isolated side therefore checks every frame from MAIN —
// first `checkBridgeFrame` (plain JSON within BRIDGE_LIMITS, no prototype
// keys), then the envelope, then the payload schema of its type. MAIN is a
// dependency-free bundle and cannot import this file: it validates requests by
// hand and repeats the literals it needs; its tests pin both copies to these
// values and run the contract fixtures through its validators.

import * as z from 'zod/mini';

import { type CgCode } from './errors';
import { BRIDGE_LIMITS } from './limits';
import { CountSchema, EpochTokenSchema } from './primitives';

export const BRIDGE_PROTOCOL_VERSION = 1;

/** The key of a handshake message that carries its tag (`{[BRIDGE_TAG_KEY]: tag, v}`). */
export const BRIDGE_TAG_KEY = 'tag';

/** `window.postMessage` tags of the handshake; everything after it rides a MessagePort. */
export const BRIDGE_TAGS = {
  mainReady: 'main-ready',
  isoHello: 'iso-hello',
  connect: 'connect',
} as const;

/** Non-enumerable global through which the WS tap hands its subscription to the bridge (§6.8); a neutral name (X22). */
export const WS_TAP_SYMBOL_KEY = 'wsTap';

// ── Frame guard ────────────────────────────────────────────────────────────

/** Why a frame from MAIN was dropped; each reason is a diagnostics counter (§5.3, §14). */
export const BRIDGE_REJECT_REASONS = [
  'not-json',
  'not-plain',
  'not-finite',
  'prototype-key',
  'too-deep',
  'too-many-keys',
  'array-too-long',
  'string-too-long',
  'too-large',
  'envelope',
  'unknown-type',
  'payload',
] as const;
export type BridgeRejectReason = (typeof BRIDGE_REJECT_REASONS)[number];

/** Keys that could reach a prototype when an object is copied or merged. */
export const PROTOTYPE_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];

export type BridgeFrameCheck = { readonly ok: true; readonly bytes: number } | { readonly ok: false; readonly reason: BridgeRejectReason };

export interface FrameLimits {
  readonly maxFrameBytes: number;
  readonly maxStringLength: number;
  readonly maxArrayLength: number;
  readonly maxObjectKeys: number;
  readonly maxDepth: number;
}

/** UTF-8 bytes of a string as JSON.stringify writes it, quotes included. */
function jsonStringBytes(text: string): number {
  let bytes = 2;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c === 0x22 || c === 0x5c || c === 0x08 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d) bytes += 2;
    else if (c < 0x20) bytes += 6;
    else if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else bytes += 6;
    } else if (c >= 0xdc00 && c <= 0xdfff) bytes += 6;
    else bytes += 3;
  }
  return bytes;
}

/**
 * Accepts only plain JSON data within the limits: plain objects (any realm's
 * Object.prototype or null prototype) and arrays without holes or extra keys,
 * strings, finite numbers, booleans and null — no undefined, functions,
 * symbols, bigints, Dates, Maps, class instances, and no `__proto__` /
 * `constructor` / `prototype` keys at any depth. `bytes` equals the UTF-8
 * length of JSON.stringify(value). Never throws; stops at the first breach.
 */
export function checkBridgeFrame(value: unknown, limits: FrameLimits = BRIDGE_LIMITS): BridgeFrameCheck {
  let bytes = 0;
  const fail = (reason: BridgeRejectReason): BridgeFrameCheck => ({ ok: false, reason });
  const stack: Array<{ readonly value: unknown; readonly depth: number }> = [{ value, depth: 0 }];
  try {
    while (stack.length > 0) {
      const item = stack.pop() as { readonly value: unknown; readonly depth: number };
      const current = item.value;
      if (current === null) bytes += 4;
      else if (typeof current === 'boolean') bytes += current ? 4 : 5;
      else if (typeof current === 'number') {
        if (!Number.isFinite(current)) return fail('not-finite');
        bytes += JSON.stringify(current).length;
      } else if (typeof current === 'string') {
        if (current.length > limits.maxStringLength) return fail('string-too-long');
        bytes += jsonStringBytes(current);
      } else if (typeof current === 'object') {
        if (item.depth >= limits.maxDepth) return fail('too-deep');
        if (Array.isArray(current)) {
          const array: readonly unknown[] = current;
          if (array.length > limits.maxArrayLength) return fail('array-too-long');
          if (Object.keys(array).length !== array.length) return fail('not-plain');
          bytes += 2 + Math.max(0, array.length - 1);
          for (let i = array.length - 1; i >= 0; i -= 1) stack.push({ value: array[i], depth: item.depth + 1 });
        } else {
          const proto: unknown = Object.getPrototypeOf(current);
          if (proto !== null && (Object.prototype.toString.call(current) !== '[object Object]' || Object.getPrototypeOf(proto) !== null)) {
            return fail('not-plain');
          }
          const record = current as Record<string, unknown>;
          const keys = Object.keys(record);
          if (keys.length > limits.maxObjectKeys) return fail('too-many-keys');
          if (Object.getOwnPropertySymbols(record).length > 0) return fail('not-plain');
          bytes += 2 + Math.max(0, keys.length - 1);
          for (const key of keys) {
            if (PROTOTYPE_KEYS.includes(key)) return fail('prototype-key');
            if (key.length > limits.maxStringLength) return fail('string-too-long');
            bytes += jsonStringBytes(key) + 1;
            stack.push({ value: record[key], depth: item.depth + 1 });
          }
        }
      } else return fail('not-json');
      if (bytes > limits.maxFrameBytes) return fail('too-large');
    }
  } catch {
    // A revoked proxy or a hostile getter from the page world: not JSON data.
    return fail('not-plain');
  }
  return { ok: true, bytes };
}

// ── Message types ──────────────────────────────────────────────────────────

/** Requests isolated → MAIN (§5.3 `ToMain`); payload and answer schemas: TO_MAIN in bridge-messages.ts. */
export const TO_MAIN_TYPES = [
  'probe',
  'snapshot',
  'readDraft',
  'readTail',
  'chatWindow',
  'fan',
  'listChats',
  'listAccounts',
  'insertGuarded',
  'focus',
  'navigate',
  'cancelInsert',
  'checkpoint',
  'previewSendPreflight',
  'previewSendCommit',
  'flags',
  'openChatMessages',
  'cachedChatMessages',
  'media',
  'chatReadState',
] as const;
export type ToMainType = (typeof TO_MAIN_TYPES)[number];

/**
 * The only writes (D-07): guarded insert, navigation, the X8 queue call. MAIN
 * deduplicates them by request id: a repeated id returns the first result and
 * does not execute again.
 */
export const BRIDGE_WRITE_REQUESTS = ['insertGuarded', 'navigate', 'previewSendCommit'] as const satisfies readonly ToMainType[];

/** Events MAIN → isolated (§5.3 `FromMain`), never with message text. */
export const FROM_MAIN_TYPES = ['route', 'accounts', 'composer', 'chatCache', 'contract', 'incoming', 'coverage', 'humanSend', 'previewSendState', 'previewSendFuse', 'fault'] as const;
export type FromMainType = (typeof FROM_MAIN_TYPES)[number];

/**
 * Freshness and receipt events are never dropped or coalesced; their counters are updated before any thinning. Nor is
 * a fault report (one per site and doubling, decision X22): coalesced, a site's report would hide another's. Nor the
 * X8 fuse (1.11.0, decision X25): one lost would leave the preview send on.
 */
export const BRIDGE_UNDROPPABLE_EVENTS = ['incoming', 'coverage', 'humanSend', 'previewSendState', 'previewSendFuse', 'fault'] as const satisfies readonly FromMainType[];

// ── Probe ──────────────────────────────────────────────────────────────────

/** Answer of MAIN to `probe`. */
export const MainProbeSchema = z.strictObject({
  v: z.literal(BRIDGE_PROTOCOL_VERSION),
  /** `document.readyState` when the MAIN script started: `loading` proves document_start. */
  readyStateAtStart: z.enum(['loading', 'interactive', 'complete']),
  /** Time the MAIN bridge spent installing itself, ms (budget ≤ 1 ms, §11). */
  installMs: z.number().check(z.gte(0), z.lte(10_000)),
  /** Whether the WS tap global was present when the probe ran. */
  wsTap: z.boolean(),
});
export type MainProbe = z.infer<typeof MainProbeSchema>;

// ── Envelopes ──────────────────────────────────────────────────────────────

/** Why MAIN refused a request. */
export const BRIDGE_ERRORS = ['unknown-request', 'bad-request', 'not-ready', 'identity-mismatch', 'stale-document', 'disabled', 'internal'] as const;
export const BridgeErrorSchema = z.enum(BRIDGE_ERRORS);
export type BridgeError = z.infer<typeof BridgeErrorSchema>;

/** Refusals MAIN gives before it executes anything: a write answered with one of these did not happen. */
export const BRIDGE_ERRORS_BEFORE_EXECUTION = [
  'unknown-request',
  'bad-request',
  'not-ready',
  'identity-mismatch',
  'stale-document',
  'disabled',
] as const satisfies readonly BridgeError[];

/**
 * A write (BRIDGE_WRITE_REQUESTS) that timed out, lost its answer or failed
 * with `internal` may have run: its outcome is fixed as below and never
 * retried — not even with the same request id (a request that never reached
 * MAIN would run late). An insert is then reconciled by reading the draft
 * only; a navigation's `thenInsert` counts as uncertain too. A refusal from
 * BRIDGE_ERRORS_BEFORE_EXECUTION is a plain «not done»: `rejected` insert,
 * `held` send (no queue call), `failed` navigation CG-NAV-FAILED.
 */
export const BRIDGE_WRITE_FAILURES = {
  insertGuarded: { state: 'uncertain', code: 'CG-INSERT-UNCERTAIN' },
  navigate: { state: 'failed', code: 'CG-NAV-TIMEOUT', insert: { state: 'uncertain', code: 'CG-INSERT-UNCERTAIN' } },
  previewSendCommit: { state: 'uncertain', code: 'CG-SEND-UNCERTAIN' },
} as const satisfies Record<(typeof BRIDGE_WRITE_REQUESTS)[number], { readonly state: string; readonly code: CgCode; readonly insert?: { readonly state: string; readonly code: CgCode } }>;

export const BridgeRequestIdSchema = z.int().check(z.gte(1));
const ToMainTypeSchema = z.enum(TO_MAIN_TYPES);

/**
 * An answer MAIN → isolated, first stage: the envelope with `data` still
 * unchecked. `t` echoes the request type and must equal the pending
 * request's; the second stage is that type's answer schema
 * (`parseBridgeData` in bridge-messages.ts).
 */
export const BridgeResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    v: z.literal(BRIDGE_PROTOCOL_VERSION),
    kind: z.literal('res'),
    id: BridgeRequestIdSchema,
    t: ToMainTypeSchema,
    documentEpoch: EpochTokenSchema,
    /** Grows per sender within a document. */
    seq: CountSchema,
    ok: z.literal(true),
    data: z.unknown(),
  }),
  z.strictObject({
    v: z.literal(BRIDGE_PROTOCOL_VERSION),
    kind: z.literal('res'),
    id: BridgeRequestIdSchema,
    t: ToMainTypeSchema,
    documentEpoch: EpochTokenSchema,
    seq: CountSchema,
    ok: z.literal(false),
    /** Transport-level refusal; business outcomes (insert, send) are answers with their own codes. */
    err: BridgeErrorSchema,
  }),
]);
export type BridgeResponse = z.infer<typeof BridgeResponseSchema>;

/** An event MAIN → isolated, first stage: a known type, payload unchecked (FROM_MAIN in bridge-messages.ts). */
export const BridgeEventEnvelopeSchema = z.strictObject({
  v: z.literal(BRIDGE_PROTOCOL_VERSION),
  kind: z.literal('evt'),
  t: z.enum(FROM_MAIN_TYPES),
  documentEpoch: EpochTokenSchema,
  seq: CountSchema,
  payload: z.unknown(),
});
export type BridgeEventEnvelope = z.infer<typeof BridgeEventEnvelopeSchema>;
