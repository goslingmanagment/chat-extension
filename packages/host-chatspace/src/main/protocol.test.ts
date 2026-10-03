import { BRIDGE_ERRORS, BRIDGE_PROTOCOL_VERSION, BRIDGE_TAGS, BridgeResponseSchema, WS_TAP_SYMBOL_KEY } from '@cg/contracts';
import { describe, expect, it } from 'vitest';

import { ERR_UNKNOWN_REQUEST, KIND_REQ, KIND_RES, PROTOCOL_VERSION, TAG_CONNECT, TAG_ISO_HELLO, TAG_MAIN_READY, WS_TAP_KEY } from './protocol';

describe('MAIN bridge protocol literals', () => {
  it('match @cg/contracts (MAIN cannot import it)', () => {
    expect(PROTOCOL_VERSION).toBe(BRIDGE_PROTOCOL_VERSION);
    expect(TAG_MAIN_READY).toBe(BRIDGE_TAGS.mainReady);
    expect(TAG_ISO_HELLO).toBe(BRIDGE_TAGS.isoHello);
    expect(TAG_CONNECT).toBe(BRIDGE_TAGS.connect);
    expect(WS_TAP_KEY).toBe(WS_TAP_SYMBOL_KEY);
    expect(BRIDGE_ERRORS).toContain(ERR_UNKNOWN_REQUEST);
  });

  it('builds response envelopes the contract accepts', () => {
    const base = { v: PROTOCOL_VERSION, id: 1, t: 'probe', documentEpoch: 'abc', seq: 0 };
    expect(BridgeResponseSchema.safeParse({ ...base, kind: KIND_RES, ok: true, data: {} }).success).toBe(true);
    expect(BridgeResponseSchema.safeParse({ ...base, kind: KIND_RES, ok: false, err: ERR_UNKNOWN_REQUEST }).success).toBe(true);
    expect(BridgeResponseSchema.safeParse({ ...base, kind: KIND_REQ, ok: true, data: {} }).success).toBe(false);
  });
});
