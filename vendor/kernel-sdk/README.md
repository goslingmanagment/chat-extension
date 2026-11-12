# @kernel/sdk (vendored)

GENERATED — do not edit. This is a self-contained compiled snapshot of the
kernel SDK (`packages/sdk` + its contracts runtime) produced by the core
repo's `scripts/vendor-sdk.mjs`. Regenerate from core to update:

```sh
# from the core repo root
node scripts/vendor-sdk.mjs <path-to-this-directory>
```

- Contract hash: `96a1afd61fa0e15453a1a8c4e74e71425654485d24affe638f2d6dac5a72c323`
- Core commit: `b06b2e0a9c68378ac383f16e05ef37767bf2507b`

The contract hash is exported at runtime as `KERNEL_CONTRACT_HASH`; drift CI
compares it against core@main. Distribution via git-tag installs (DP 10) is
meant to replace this vendoring — the consuming import surface
(`@kernel/sdk`) stays identical.
