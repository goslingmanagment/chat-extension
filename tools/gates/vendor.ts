// The vendored packages are the pinned ones (tests/vendor-pins.json, written by `pnpm vendor:pin`): the release gate
// refuses a release whose SDK or hotkeys differ from their pins, so `pnpm check` refuses the PR first — a merged PR can
// never leave main unreleasable for it.

import type { Violation } from './checks.ts';
import type { HotkeysManifest, SdkManifest } from '../vendor-pin/pins.ts';

export interface VendorPinObservation {
  readonly sdk: SdkManifest;
  readonly hotkeys: HotkeysManifest;
  readonly pins: { readonly kernelSdk?: { readonly contractHash?: unknown; readonly sourceCommit?: unknown }; readonly chatgooseHotkeys?: { readonly sha256?: unknown } };
}

const PATH = 'tests/vendor-pins.json';

export function vendorPinViolations(observed: VendorPinObservation): Violation[] {
  const out: Violation[] = [];
  if (observed.sdk.contractHash !== observed.pins.kernelSdk?.contractHash || observed.sdk.sourceCommit !== observed.pins.kernelSdk?.sourceCommit) {
    out.push({ gate: 'vendor-pins', path: PATH, line: 1, message: 'the SDK differs from tests/vendor-pins.json: run pnpm vendor:pin after a re-vendor' });
  }
  if (observed.hotkeys.sha256 !== observed.pins.chatgooseHotkeys?.sha256) {
    out.push({ gate: 'vendor-pins', path: PATH, line: 1, message: 'the hotkeys differ from tests/vendor-pins.json: run pnpm vendor:pin after a re-vendor' });
  }
  return out;
}
