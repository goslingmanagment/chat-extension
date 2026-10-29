# @kernel/sdk (vendored)

GENERATED — do not edit. This is a self-contained compiled snapshot of the
kernel SDK (`packages/sdk` + its contracts runtime) produced by the core
repo's `scripts/vendor-sdk.mjs`. Regenerate from core to update:

```sh
# from the core repo root
node scripts/vendor-sdk.mjs <path-to-this-directory>
```

- Contract hash: `3a64b6b39b479c75ca0ad6b263ffd20c7c6a7a5e8bee2b2a6ba3720ec39a4f4f`
- Core commit: `c863f1cc0c886b1244c8898557cee892168c725e`

The contract hash is exported at runtime as `KERNEL_CONTRACT_HASH`; drift CI
compares it against core@main. Distribution via git-tag installs (DP 10) is
meant to replace this vendoring — the consuming import surface
(`@kernel/sdk`) stays identical.
