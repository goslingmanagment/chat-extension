// The isolated side's early copies of the bridge's own constants (wire.ts)
// are pinned to @cg/contracts/bridge, which the early start cannot import.

import { BRIDGE_ERRORS_BEFORE_EXECUTION, BRIDGE_PROTOCOL_VERSION, BRIDGE_TAG_KEY, BRIDGE_TAGS } from '@cg/contracts/bridge';
import { describe, expect, it } from 'vitest';

import * as wire from './wire';

describe('[EX-008] the isolated side’s early copies of the bridge constants', () => {
  it('match @cg/contracts (the early start cannot import its schema module)', () => {
    expect(wire.PROTOCOL_VERSION).toBe(BRIDGE_PROTOCOL_VERSION);
    expect(wire.TAGS).toEqual(BRIDGE_TAGS);
    expect(wire.TAG_KEY).toBe(BRIDGE_TAG_KEY);
    expect([...wire.ERRORS_BEFORE_EXECUTION]).toEqual([...BRIDGE_ERRORS_BEFORE_EXECUTION]);
  });
});
