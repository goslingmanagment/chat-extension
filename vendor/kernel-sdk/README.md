# @kernel/sdk (vendored)

GENERATED — do not edit. This is a self-contained compiled snapshot of the
kernel SDK (`packages/sdk` + its contracts runtime) produced by the core
repo's `scripts/vendor-sdk.mjs`. Regenerate from core to update:

```sh
# from the core repo root
node scripts/vendor-sdk.mjs <path-to-this-directory>
```

- Contract hash: `a122c4e09f2c62e0b739e8047ea6f7091aeaf796b3828a75a04c79f75a1231d9`
- Core commit: `220304ccbf3fd33af999da6c8a7b73f9f4cde16b`

The contract hash is exported at runtime as `KERNEL_CONTRACT_HASH`; drift CI
compares it against core@main. Distribution via git-tag installs (DP 10) is
meant to replace this vendoring — the consuming import surface
(`@kernel/sdk`) stays identical.
