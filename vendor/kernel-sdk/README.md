# @kernel/sdk (vendored)

GENERATED — do not edit. This is a self-contained compiled snapshot of the
kernel SDK (`packages/sdk` + its contracts runtime) produced by the core
repo's `scripts/vendor-sdk.mjs`. Regenerate from core to update:

```sh
# from the core repo root
node scripts/vendor-sdk.mjs <path-to-this-directory>
```

- Contract hash: `9137410d6c88a628b538e61b912e209b79c087144e4ac8f21edbea7c6f587493`
- Core commit: `bd3eec0657bca31e418e377288214b920575211b`

The contract hash is exported at runtime as `KERNEL_CONTRACT_HASH`; drift CI
compares it against core@main (stage-20 §2). Distribution via git-tag installs
(DP 10) replaces this vendoring at the Stage 20 release step — the consuming
import surface (`@kernel/sdk`) stays identical.
