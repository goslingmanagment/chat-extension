// MAIN cannot import anything: the boot's copies of the contracts' literals
// are pinned here (the early copies of the isolated side: isolated/
// wire.test.ts). A host's own copies — its requests and events, its limits,
// its host contract — are pinned in its own package, where the contracts'
// fixtures also run through its hand-written request checks
// (host-chatspace/src/main/protocol.test.ts).

import {
  BRIDGE_ERRORS,
  BRIDGE_ERRORS_BEFORE_EXECUTION,
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_TAG_KEY,
  BRIDGE_TAGS,
  BRIDGE_WRITE_REQUESTS,
  BridgeResponseSchema,
  FROM_MAIN_TYPES,
  WS_TAP_SYMBOL_KEY,
} from '@cg/contracts/bridge';
import { BRIDGE_LIMITS } from '@cg/contracts/limits';
import { describe, expect, it } from 'vitest';

import { isRequestEnvelope } from './bridge';
import * as protocol from './protocol';

describe('[EX-008] the MAIN boot’s literals', () => {
  it('match @cg/contracts (MAIN cannot import it)', () => {
    expect(protocol.PROTOCOL_VERSION).toBe(BRIDGE_PROTOCOL_VERSION);
    expect(protocol.TAG_KEY).toBe(BRIDGE_TAG_KEY);
    expect(protocol.EVT_FAULT).toBe(FROM_MAIN_TYPES.at(-1));
    expect(protocol.TAG_MAIN_READY).toBe(BRIDGE_TAGS.mainReady);
    expect(protocol.TAG_ISO_HELLO).toBe(BRIDGE_TAGS.isoHello);
    expect(protocol.TAG_CONNECT).toBe(BRIDGE_TAGS.connect);
    expect(protocol.WS_TAP_KEY).toBe(WS_TAP_SYMBOL_KEY);
    const errors = [protocol.ERR_UNKNOWN_REQUEST, protocol.ERR_BAD_REQUEST, protocol.ERR_NOT_READY, protocol.ERR_IDENTITY, protocol.ERR_STALE_DOCUMENT, protocol.ERR_DISABLED, protocol.ERR_INTERNAL];
    expect([...errors].sort()).toEqual([...BRIDGE_ERRORS].sort());
    expect(protocol.WRITE_REQUESTS).toEqual([...BRIDGE_WRITE_REQUESTS]);
    // The state events the boot does not repeat are events of the registry it was written for.
    for (const t of protocol.STATE_EVENTS) expect(FROM_MAIN_TYPES).toContain(t);
    // Without a host's live part the answer is a refusal before execution.
    expect(BRIDGE_ERRORS_BEFORE_EXECUTION).toContain(protocol.ERR_DISABLED);
    expect(protocol.UI_EVENT_GAP_MS).toBe(1000 / BRIDGE_LIMITS.uiEventsPerSecond);
  });

  it('builds response envelopes the contract accepts', () => {
    const base = { v: protocol.PROTOCOL_VERSION, id: 1, t: 'probe', documentEpoch: 'abc', seq: 0 };
    expect(BridgeResponseSchema.safeParse({ ...base, kind: protocol.KIND_RES, ok: true, data: {} }).success).toBe(true);
    expect(BridgeResponseSchema.safeParse({ ...base, kind: protocol.KIND_RES, ok: false, err: protocol.ERR_UNKNOWN_REQUEST }).success).toBe(true);
    expect(BridgeResponseSchema.safeParse({ ...base, kind: protocol.KIND_REQ, ok: true, data: {} }).success).toBe(false);
  });

  it('the envelope check takes the contract’s request frames and nothing else', () => {
    const frame = { v: 1, kind: 'req', id: 1, t: 'probe', documentEpoch: null, seq: 0, payload: {} };
    expect(isRequestEnvelope(frame)).toBe(true);
    expect(isRequestEnvelope({ ...frame, documentEpoch: 'doc' })).toBe(true);
    expect(isRequestEnvelope({ ...frame, extra: 1 })).toBe(false);
    expect(isRequestEnvelope({ ...frame, id: 0 })).toBe(false);
    expect(isRequestEnvelope({ ...frame, kind: 'res' })).toBe(false);
    expect(isRequestEnvelope({ ...frame, documentEpoch: 'bad epoch' })).toBe(false);
    expect(isRequestEnvelope(null)).toBe(false);
  });
});
