// The pins of the vendored packages (tests/vendor-pins.json), as their manifests say them: `pnpm vendor:pin` writes
// them after a re-vendor, `pnpm gates` and the release gate check them. Never written by hand.

export interface SdkManifest {
  readonly contractHash?: unknown;
  readonly sourceCommit?: unknown;
}
export interface HotkeysManifest {
  readonly sha256?: unknown;
  readonly sourceCommit?: unknown;
}
export interface VendorPins {
  readonly kernelSdk: { readonly contractHash: unknown; readonly sourceCommit: unknown; readonly note: string };
  readonly chatgooseHotkeys: { readonly sha256: unknown; readonly sourceCommit: unknown; readonly note: string };
}

const short = (commit: unknown): string => (typeof commit === 'string' ? commit.slice(0, 12) : String(commit));

export function pinsOf(sdk: SdkManifest, hotkeys: HotkeysManifest): VendorPins {
  return {
    kernelSdk: {
      contractHash: sdk.contractHash,
      sourceCommit: sdk.sourceCommit,
      note: `Vendored from hub ${short(sdk.sourceCommit)} with the hub's scripts/vendor-sdk.mjs; written by pnpm vendor:pin. A release is vendored only from a hub commit on main that production runs.`,
    },
    chatgooseHotkeys: {
      sha256: hotkeys.sha256,
      sourceCommit: hotkeys.sourceCommit,
      note: `Vendored from hub ${short(hotkeys.sourceCommit)} with the hub's scripts/vendor-hotkeys.mjs; written by pnpm vendor:pin.`,
    },
  };
}
