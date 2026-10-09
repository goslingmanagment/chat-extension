# @kernel/sdk (vendored)

GENERATED — do not edit. This is a self-contained compiled snapshot of the
kernel SDK (`packages/sdk` + its contracts runtime) produced by the core
repo's `scripts/vendor-sdk.mjs`. Regenerate from core to update:

```sh
# from the core repo root
node scripts/vendor-sdk.mjs <path-to-this-directory>
```

- Contract hash: `ebdd94e3974ab53680e6568b5945e1e1c253f86ab617c334c78d0d1d1d7bcaa4`
- Core commit: `5c4e6dd7e56d1bd86ed202107e428cdf7ea0c043`

The contract hash is exported at runtime as `KERNEL_CONTRACT_HASH`; drift CI
compares it against core@main (stage-20 §2). Distribution via git-tag installs
(DP 10) replaces this vendoring at the Stage 20 release step — the consuming
import surface (`@kernel/sdk`) stays identical.
