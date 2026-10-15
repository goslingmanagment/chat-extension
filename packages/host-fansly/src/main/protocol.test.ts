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
import { FANSLY_FAN_SCRIPTS, FANSLY_TAP_STATES } from '@cg/contracts/bridge-messages-fansly';
import { FANSLY_AVATAR_URL_PATTERN, FANSLY_COMPLETENESS, FANSLY_COVERAGE_REASONS, FANSLY_LIMITS, FanslyAvatarUrlSchema, START_PROOF_SOURCES } from '@cg/contracts/fansly';
import { FEATURE_IDS, FRESH_TEXT_FEATURES } from '@cg/contracts/features';
import { FANSLY_BRIDGE_REQUEST_FIXTURES } from '@cg/contracts/fixtures';
import { ANCHOR_STATES, CONVERSATION_KINDS } from '@cg/contracts/host';
import { LIVE_TEXT_LIMITS } from '@cg/contracts/limits';
import { NATIVE_ID_PATTERN } from '@cg/contracts/primitives';
import { PERF_METRICS } from '@cg/contracts/telemetry';
import { describe, expect, it } from 'vitest';

import * as protocol from './protocol';
import { CYRILLIC, isFocus, isSnapshotRequest, isWindowRequest } from './snapshot';

describe('[EX-008] [host:fansly] Fansly’s MAIN literals', () => {
  it('match the bridge registry of @cg/contracts: credits, frames, events, requests', () => {
    expect([protocol.MAX_UNACKED, protocol.MAX_IN_FLIGHT_BYTES, protocol.MAX_BATCH_BYTES, protocol.MAX_BATCH_EVENTS]).toEqual([
      FANSLY_BRIDGE_LIMITS.maxUnackedBatches,
      FANSLY_BRIDGE_LIMITS.maxInFlightBytes,
      FANSLY_BRIDGE_LIMITS.maxBatchBytes,
      FANSLY_BRIDGE_LIMITS.maxBatchEvents,
    ]);
    expect([protocol.EVT_BATCH, protocol.EVT_GAP]).toEqual(FANSLY_WIRE_EVENT_TYPES.slice(0, 2));
    expect([...FANSLY_BRIDGE_STATE_EVENTS].sort()).toEqual([protocol.EVT_IDENTITY, protocol.EVT_CHAT, protocol.EVT_CONTRACT].sort());
    expect(FANSLY_BRIDGE_UNDROPPABLE_EVENTS).toEqual(expect.arrayContaining([protocol.EVT_INCOMING, protocol.EVT_FOLLOW, protocol.EVT_COVERAGE, protocol.EVT_DELETED, protocol.EVT_VAULT, protocol.EVT_VAULT_LOADED]));
    // Every request but `probe` (the boot's) is MAIN's own.
    expect(['probe', protocol.REQ_STATE, protocol.REQ_ACK, protocol.REQ_HEALTH, protocol.REQ_FOCUS, protocol.REQ_SNAPSHOT, protocol.REQ_WINDOW].sort()).toEqual([...TO_MAIN_FANSLY_TYPES].sort());
    expect([protocol.GAP_OVERFLOW, protocol.GAP_MEMORY]).toEqual([...FANSLY_GAP_REASONS]);
  });

  it('match the observation’s words: coverage reasons, completeness, anchor and tap states, kinds, scripts, features', () => {
    const reasons = [
      protocol.WHY_CERTIFICATE,
      protocol.WHY_NOT_CERTIFIED,
      protocol.WHY_LATE,
      protocol.WHY_SOCKET,
      protocol.WHY_FRAME,
      protocol.WHY_UNSEEN,
      protocol.WHY_NO_OVERLAP,
      protocol.WHY_EVICTED,
      protocol.WHY_PARSE_LIMIT,
      protocol.WHY_PENDING_PARSE,
      protocol.WHY_PARTICIPANTS,
      protocol.WHY_BFCACHE,
      protocol.WHY_GAP,
    ];
    expect(reasons).toEqual([...FANSLY_COVERAGE_REASONS]);
    expect([protocol.COMPLETE, protocol.UNKNOWN]).toEqual([...FANSLY_COMPLETENESS]);
    expect([protocol.KIND_DIRECT, protocol.KIND_GROUP]).toEqual([...CONVERSATION_KINDS]);
    expect([protocol.SCRIPT_CYRILLIC, protocol.SCRIPT_OTHER, protocol.UNKNOWN]).toEqual([...FANSLY_FAN_SCRIPTS]);
    expect([...protocol.FEATURES]).toEqual([...FEATURE_IDS]);
    expect([...protocol.TEXT_FEATURES]).toEqual([...FRESH_TEXT_FEATURES]);
    expect(FEATURE_IDS).toContain(protocol.FEATURE_HI);
    expect(START_PROOF_SOURCES[0]).toBe(protocol.PROOF_TAB);
    for (const state of [protocol.ANCHOR_OK, protocol.ANCHOR_NOT_YET, protocol.ANCHOR_SHAPE]) expect(ANCHOR_STATES).toContain(state);
    expect([protocol.TAP_OK, protocol.TAP_WRAPPED, protocol.TAP_SILENT]).toEqual([...FANSLY_TAP_STATES]);
    // A coverage event names at most this many chats; MAIN says `all` beyond it.
    expect(FANSLY_LIMITS.maxChats).toBe(300);
    expect(NATIVE_ID_PATTERN.source).toContain(`{0,${protocol.ID_MAX_DIGITS - 1}}`);
  });

  it('time its parse and its snapshot step over the bounds of the three HF-13 metrics', () => {
    expect([...protocol.PARSE_BOUNDS]).toEqual([...PERF_METRICS.frameParseMs.bounds]);
    expect([...protocol.PARSE_BOUNDS]).toEqual([...PERF_METRICS.xhrParseMs.bounds]);
    expect([...protocol.SNAPSHOT_BOUNDS]).toEqual([...PERF_METRICS.snapshotMs.bounds]);
  });

  it('match the observation’s limits: the ring, the chats, the check window, a page, the tail, the snapshot frame, the avatar', () => {
    expect([protocol.RING_RECORDS, protocol.MAX_CHATS, protocol.CHECK_WINDOW_MAX, protocol.KNOWN_FAN_MAX, protocol.HISTORY_PAGE, protocol.AUTOMATED_IDS_MAX]).toEqual([
      FANSLY_LIMITS.ringRecords,
      FANSLY_LIMITS.maxChats,
      FANSLY_LIMITS.checkWindowMax,
      FANSLY_LIMITS.knownFanMessagesMax,
      FANSLY_LIMITS.historyPage,
      FANSLY_LIMITS.automatedIdsMax,
    ]);
    // The tail is the check window at most: it never needs more texts than the hub takes.
    expect(protocol.CHECK_WINDOW_MAX).toBeLessThanOrEqual(FANSLY_LIMITS.tailMax);
    expect(protocol.TEXTS_PER_CHAT).toBeGreaterThanOrEqual(protocol.CHECK_WINDOW_MAX);
    expect(protocol.TAIL_TEXT_MAX_CHARS).toBe(LIVE_TEXT_LIMITS.maxChars);
    expect(protocol.SNAPSHOT_MAX_BYTES).toBe(FANSLY_BRIDGE_LIMITS.maxSnapshotBytes);
    expect(protocol.AVATAR_PATTERN.source).toBe(FANSLY_AVATAR_URL_PATTERN.source);
    expect(FanslyAvatarUrlSchema.safeParse(`https://cdn3.fansly.com/${'x'.repeat(protocol.AVATAR_MAX_CHARS - 24)}`).success).toBe(true);
    expect(FanslyAvatarUrlSchema.safeParse(`https://cdn3.fansly.com/${'x'.repeat(protocol.AVATAR_MAX_CHARS - 23)}`).success).toBe(false);
    // FS-TAIL-5: texts are part of the one account.
    expect([protocol.MEMORY_MAX_BYTES, protocol.TEXT_MAX_BYTES]).toEqual([4 * 1024 * 1024, 2 * 1024 * 1024]);
  });

  it('tell the fan’s Cyrillic as the core’s language gate does (`\\p{Script=Cyrillic}`), without a property escape', () => {
    const core = /\p{Script=Cyrillic}/u;
    // Every code point of Unicode 15 the two may judge: the same answer (newer Unicode versions only add to the script).
    for (let point = 0; point <= 0x1ffff; point += 1) {
      if (point >= 0xd800 && point <= 0xdfff) continue;
      const char = String.fromCodePoint(point);
      if (CYRILLIC.test(char) && !core.test(char)) throw new Error(`U+${point.toString(16)} is no Cyrillic`);
      if (core.test(char) && !CYRILLIC.test(char) && !(point >= 0x1c89 && point <= 0x1c8a)) throw new Error(`U+${point.toString(16)} is Cyrillic`);
    }
    for (const text of ['привет', 'Їжак ґанок є', 'Здраво', 'ӂ']) expect(CYRILLIC.test(text), text).toBe(true);
    for (const text of ['hello', 'Γειά', '😊', 'ﬀ']) expect(CYRILLIC.test(text), text).toBe(false);
  });

  it('[FS-TAIL-6] check the requests of the observation by hand, as the contracts’ fixtures have them', () => {
    const checks = { 'fx.focus': isFocus, 'fx.windowMeta': isWindowRequest, 'fx.generationSnapshot': isSnapshotRequest } as const;
    for (const [t, check] of Object.entries(checks)) {
      const fixtures = FANSLY_BRIDGE_REQUEST_FIXTURES[t as keyof typeof checks].payload;
      for (const payload of fixtures.valid) expect(check(payload), `${t} ${JSON.stringify(payload)}`).toBe(true);
      for (const payload of fixtures.invalid) expect(check(payload), `${t} ${JSON.stringify(payload)}`).toBe(false);
    }
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
