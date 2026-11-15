import { describe, expect, it } from 'vitest';

import { pinsOf } from '../vendor-pin/pins.ts';
import { vendorPinViolations } from './vendor.ts';

const SDK = { contractHash: 'a'.repeat(64), sourceCommit: 'b'.repeat(40) };
const HOTKEYS = { sha256: 'c'.repeat(64), sourceCommit: 'd'.repeat(40) };

describe('gate: the vendored packages are the pinned ones (the release gate reads the same pins)', () => {
  it('is clean when the pins say what the manifests say', () => {
    expect(vendorPinViolations({ sdk: SDK, hotkeys: HOTKEYS, pins: pinsOf(SDK, HOTKEYS) })).toEqual([]);
  });

  it('fails a re-vendored SDK whose pin was not brought along, and a hotkeys mismatch', () => {
    const pins = pinsOf(SDK, HOTKEYS);
    expect(vendorPinViolations({ sdk: { ...SDK, sourceCommit: 'e'.repeat(40) }, hotkeys: HOTKEYS, pins }).map((one) => one.message)).toEqual([expect.stringContaining('the SDK differs from tests/vendor-pins.json')]);
    expect(vendorPinViolations({ sdk: { ...SDK, contractHash: 'f'.repeat(64) }, hotkeys: HOTKEYS, pins })).toHaveLength(1);
    expect(vendorPinViolations({ sdk: SDK, hotkeys: { ...HOTKEYS, sha256: '0'.repeat(64) }, pins }).map((one) => one.message)).toEqual([expect.stringContaining('the hotkeys differ')]);
  });
});

describe('pnpm vendor:pin: the pins written from the vendored manifests', () => {
  it('pins the SDK and the hotkeys as their manifests say, with a note naming the commits', () => {
    const pins = pinsOf(SDK, HOTKEYS);
    expect(pins.kernelSdk).toMatchObject({ contractHash: SDK.contractHash, sourceCommit: SDK.sourceCommit });
    expect(pins.chatgooseHotkeys).toMatchObject({ sha256: HOTKEYS.sha256, sourceCommit: HOTKEYS.sourceCommit });
    expect(pins.kernelSdk.note).toContain(SDK.sourceCommit.slice(0, 12));
  });
});
