# @kernel/sdk (vendored)

GENERATED — do not edit. This is a self-contained compiled snapshot of the
kernel SDK (`packages/sdk` + its contracts runtime) produced by the core
repo's `scripts/vendor-sdk.mjs`. Regenerate from core to update:

```sh
# from the core repo root
node scripts/vendor-sdk.mjs <path-to-this-directory>
```

- Contract hash: `0da81ea50d42f52968ea37da4b8350eeb9358562d21b28b38743ca94e9be1893`
- Core commit: `4abdbbb4c53507615a4e6f4d2b77ee670b37f486`

The contract hash is exported at runtime as `KERNEL_CONTRACT_HASH`; drift CI
compares it against core@main. Distribution via git-tag installs (DP 10) is
meant to replace this vendoring — the consuming import surface
(`@kernel/sdk`) stays identical.
