import { BRIDGE_PROTOCOL_VERSION, BRIDGE_TAGS, WS_TAP_SYMBOL_KEY } from '@cg/contracts';
import { describe, expect, it } from 'vitest';

import { PROTOCOL_VERSION, TAG_CONNECT, TAG_ISO_HELLO, TAG_MAIN_READY, WS_TAP_KEY } from './protocol';

describe('MAIN bridge protocol literals', () => {
  it('match @cg/contracts (MAIN cannot import it)', () => {
    expect(PROTOCOL_VERSION).toBe(BRIDGE_PROTOCOL_VERSION);
    expect(TAG_MAIN_READY).toBe(BRIDGE_TAGS.mainReady);
    expect(TAG_ISO_HELLO).toBe(BRIDGE_TAGS.isoHello);
    expect(TAG_CONNECT).toBe(BRIDGE_TAGS.connect);
    expect(WS_TAP_KEY).toBe(WS_TAP_SYMBOL_KEY);
  });
});
