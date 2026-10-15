// Fansly's MAIN cannot import @cg/contracts: its copies of the bridge's
// literals are pinned here, and the contracts' request fixtures run through
// its hand-written checks (docs/protocols/README.md: MAIN checks every
// request by hand). The boot's own literals are pinned with the boot
// (@cg/host-kit, main/protocol.test.ts).

import {
  FANSLY_BRIDGE_LIMITS,
  FANSLY_BRIDGE_STATE_EVENTS,
  FANSLY_BRIDGE_UNDROPPABLE_EVENTS,
  FANSLY_GAP_REASONS,
  FANSLY_WIRE_EVENT_TYPES,
  TO_MAIN_FANSLY_TYPES,
} from '@cg/contracts/bridge-fansly';
import { FANSLY_TAP_STATES } from '@cg/contracts/bridge-messages-fansly';
import { FANSLY_COMPLETENESS, FANSLY_COVERAGE_REASONS, FANSLY_LIMITS } from '@cg/contracts/fansly';
import { ANCHOR_STATES } from '@cg/contracts/host';
import { NATIVE_ID_PATTERN } from '@cg/contracts/primitives';
import { PERF_METRICS } from '@cg/contracts/telemetry';
import { describe, expect, it } from 'vitest';

import * as protocol from './protocol';

describe('[EX-008] [host:fansly] Fansly’s MAIN literals', () => {
  it('match the bridge registry of @cg/contracts: credits, frames, events, requests', () => {
    expect([protocol.MAX_UNACKED, protocol.MAX_IN_FLIGHT_BYTES, protocol.MAX_BATCH_BYTES, protocol.MAX_BATCH_EVENTS]).toEqual([
      FANSLY_BRIDGE_LIMITS.maxUnackedBatches,
      FANSLY_BRIDGE_LIMITS.maxInFlightBytes,
      FANSLY_BRIDGE_LIMITS.maxBatchBytes,
      FANSLY_BRIDGE_LIMITS.maxBatchEvents,
    ]);
    expect([protocol.EVT_BATCH, protocol.EVT_GAP]).toEqual(FANSLY_WIRE_EVENT_TYPES.slice(0, 2));
    expect(FANSLY_BRIDGE_STATE_EVENTS).toEqual(expect.arrayContaining([protocol.EVT_IDENTITY, protocol.EVT_CONTRACT]));
    expect(FANSLY_BRIDGE_UNDROPPABLE_EVENTS).toEqual(expect.arrayContaining([protocol.EVT_INCOMING, protocol.EVT_FOLLOW, protocol.EVT_COVERAGE, protocol.EVT_VAULT]));
    // Every request but `probe` (the boot's) is MAIN's: answered now, or `not-ready` until the observation (P7b).
    expect(['probe', protocol.REQ_STATE, protocol.REQ_ACK, protocol.REQ_HEALTH, ...protocol.REQ_LATER].sort()).toEqual([...TO_MAIN_FANSLY_TYPES].sort());
    expect(FANSLY_GAP_REASONS).toContain(protocol.GAP_OVERFLOW);
  });

  it('match the observation’s words: coverage reasons, completeness, anchor and tap states', () => {
    for (const reason of [protocol.WHY_LATE, protocol.WHY_SOCKET, protocol.WHY_FRAME, protocol.WHY_PARSE_LIMIT]) expect(FANSLY_COVERAGE_REASONS).toContain(reason);
    expect(FANSLY_COMPLETENESS).toContain(protocol.UNKNOWN);
    for (const state of [protocol.ANCHOR_OK, protocol.ANCHOR_NOT_YET, protocol.ANCHOR_SHAPE]) expect(ANCHOR_STATES).toContain(state);
    expect([protocol.TAP_OK, protocol.TAP_WRAPPED, protocol.TAP_SILENT]).toEqual([...FANSLY_TAP_STATES]);
    // A coverage event names at most this many chats; MAIN says `all` beyond it.
    expect(FANSLY_LIMITS.maxChats).toBe(300);
    expect(NATIVE_ID_PATTERN.source).toContain(`{0,${protocol.ID_MAX_DIGITS - 1}}`);
  });

  it('time its parse over the bounds of the two HF-13 metrics', () => {
    expect([...protocol.PARSE_BOUNDS]).toEqual([...PERF_METRICS.frameParseMs.bounds]);
    expect([...protocol.PARSE_BOUNDS]).toEqual([...PERF_METRICS.xhrParseMs.bounds]);
  });

  it('keep MAIN’s own limits inside the bridge’s: the stream’s queue and flight together stay ≤ 512 KiB (§5.5: ≤ 4 MiB in all)', () => {
    expect(protocol.QUEUE_MAX_BYTES + protocol.MAX_IN_FLIGHT_BYTES).toBeLessThanOrEqual(512 * 1024);
    // A full queue still fits the batches that would carry it.
    expect(protocol.QUEUE_MAX_EVENTS).toBeLessThanOrEqual(protocol.MAX_BATCH_EVENTS * protocol.MAX_UNACKED);
    expect(protocol.RESPONSE_NOW_CHARS).toBeLessThan(protocol.RESPONSE_MAX_CHARS);
    expect(protocol.RESPONSE_MAX_CHARS).toBeLessThanOrEqual(protocol.DEFERRED_MAX_CHARS);
    expect(protocol.FRAME_MAX_CHARS).toBe(1024 * 1024);
    expect([protocol.FRAME_MAX_DEPTH, protocol.FRAME_MAX_NODES]).toEqual([4, 256]);
  });
});
