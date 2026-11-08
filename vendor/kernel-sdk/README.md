# @kernel/sdk (vendored)

GENERATED — do not edit. This is a self-contained compiled snapshot of the
kernel SDK (`packages/sdk` + its contracts runtime) produced by the core
repo's `scripts/vendor-sdk.mjs`. Regenerate from core to update:

```sh
# from the core repo root
node scripts/vendor-sdk.mjs <path-to-this-directory>
```

- Contract hash: `ca6729ff8a4a86ae5dfc3f730174fa2da88cda0fd24b3ad47a674531830c0c8a`
- Core commit: `ba3616d8a3eb8e86d7f8b6c3a5052d9512a3eab2`

The contract hash is exported at runtime as `KERNEL_CONTRACT_HASH`; drift CI
compares it against core@main. Distribution via git-tag installs (DP 10) is
meant to replace this vendoring — the consuming import surface
(`@kernel/sdk`) stays identical.
