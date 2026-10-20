# AGENTS.md — ChatGoose for ChatSpace (`chat-extension`)

Firefox extension (MV3): ChatGoose AI (Reply, Fix, Hi, Ping, Recap, Review, Help, Coach), Spenders,
"New" subscribers, hotkeys and sound on top of ChatSpace (`chat.onlymonster.ai`, OnlyFans) and fansly.com.
A client of the Agency Hub (`~/code/1-platform/hub`): all AI and all platform data go only through the hub and the vendored `@kernel/sdk`.

## Layout

pnpm monorepo, TypeScript strict, WXT, Preact.

- `apps/extension` — entry points, the manifest, the composition roots `src/composition/{background,tab,pages}.ts`, the site registry `src/hosts`.
- `packages/contracts` — types, zod schemas, the CG error registry, i18n keys; no logic.
- `packages/core` — all logic, no DOM, `browser.*` or `fetch`. `packages/platform` — the only package that touches `browser.*`.
- `packages/hub` — the hub facade over the SDK (background only). `packages/ui` — Preact surfaces, data only through `AppClient`.
- `packages/host-kit`, `host-chatspace`, `host-fansly`, `fansly-api` — the page machinery of the sites and their adapters.
- `packages/testing` — the stand, the fake hub, e2e; never ships.
- `vendor/` — `@kernel/sdk`, `@chatgoose/hotkeys`: never edit by hand, re-vendor with the hub's scripts (`scripts/vendor-*.mjs`).
- `tools/` — gates, archive check, `dev`, the release (`release`), e2e in CI (`ci`). `site/` — the extension's site.

`pnpm lint` (ESLint + dependency-cruiser) holds the package graph: crossing a boundary is a design question, not a lint exception.
`docs/` is reference, not rules. Decisions and what changed go in the PR description; no doc records are required.

## Run and check

- `pnpm install --frozen-lockfile` — Node 26, pnpm 10.33.1.
- `pnpm dev` — the test build in its own Firefox profile, rebuilt on change. The owner's profile:
  `CG_DEV_PROFILE=~/Documents/ChatGoose/firefox-dev-profile pnpm dev --debugger-port 6111`.
- See a change: `pnpm see <scenario>` — tools/see/README.md.
- Locally only `pnpm typecheck`, lint and `pnpm vitest run <paths>` of what you touched.
- `pnpm check` (types, lint, tests, build, webext-lint, gates, archives) runs in CI on a PR; never run it whole locally.
- `pnpm e2e` — a smoke set of the core flows (13 specs) in headless Firefox on the stand with the fake hub (~4 min); CI runs it on every push to `main`, not on a PR. A spec file that fails is run once more and reported as flaky (`cg-e2e-retry:`).
  One spec: from `packages/testing` `npx wdio run e2e/wdio.conf.ts --spec e2e/specs/<name>.e2e.ts` (after `pnpm build && pnpm build:test`).
- A PR is opened ready, `gh pr merge --auto --squash`; it merges on a green `pnpm check`.

## Release

Your PR is merged and `main` CI is green on that commit — in a clean `main` (`git pull`): `pnpm release --dry-run`, then
`pnpm release` (patch; `minor`, `major` or `X.Y.Z`). One command: lock, checks, build, AMO signing, feed and pages,
tag, GitHub release with notes from the commits. No PR, no notes, no `CHANGELOG.md` edits. If it stopped — run it
again. Rollback: `pnpm release rollback --to <version> --confirm <version>`. The announcement to chatters
(`pnpm release announce`) — only on the owner's word. Details — `docs/release.md`.

## Dangerous

- **Live site — only the owner's test chat** (OnlyMonster 36408 → chat 518588958). Never send anything to real fans.
  Opening a chat in ChatSpace and our own read of its history mark the chat read on OnlyFans: never open other chats,
  never press Alt+1–9, J, K, ⌘U on the live tab (our navigation opens other fans' chats).
- **The extension never sends on its own.** Only on a human click: in an open chat — insertion through `__omComposerBridge`
  and ChatSpace's own Send; from a preview — through ChatSpace's own send queue (X8). Never auto-retry anything indeterminate.
  Toward OnlyMonster — reads only (the page's own session, `host-chatspace/src/main/om-api.ts`), no writes of our own.
- **Fansly** — Chrome DevTools MCP, read-only: opening a conversation marks it read, typing sends typing events.
- **The hub's prod** (`agency-de`) — read-only. AI, keys and prompts live only in the hub.
- **Announcements to chatters** (Telegram) — the owner's call, never automatic.

## What the chatter gets

- The UX reference is the old clients (`~/code/1-platform/fansly-chat`, `~/code/1-platform/onlyfans-chat`): when in doubt,
  do what they did. Fansly stays on the old extension until the switch conditions in
  `~/code/8-docs/2026-10-20-chat-extension-one-or-two/README.md` are met.
- A new block for the chatter (a disabled button, a refusal, a forced wait or confirmation) only with the owner's «да».
  By default it is a warning the chatter can pass. The red lines above stay blocks.
- One UI for both sites: a site gets its own adapter, never its own copy of a shared component or window.

## What saves time

- Type-aware ESLint does not fit into 4 GB: `NODE_OPTIONS=--max-old-space-size=8192`.
- The main checkout holds other sessions' nested worktrees (`.claude/worktrees/*`): `eslint .` from the root lints them
  too (thousands of errors). Lint your own paths; work in your own worktree, release from a clean `main`.
- Our UI lives in closed shadow roots: WebDriver and DevTools cannot see inside. On the stand the test build writes
  a report into `<html data-cg-spike>`; in e2e — `packages/testing/e2e/support/ours.ts`.
- Firefox only: Chrome is fine for studying fansly.com, but it does not check our extension.
- On macOS an agent never starts a windowed Firefox directly (the binary, `web-ext run`): `pnpm dev` opens it through `open`.
- Flags are the page's: read them through `packages/core/src/domain/ops/flags.ts`, never `bootstrap.flags`.
- A hub rule for an AI request body changed — repeat it in `packages/testing/src/fake-hub/ai-rules.ts`.
- Never mix IDs: the OnlyMonster account id, OnlyFans numeric ids, the hub's `pageId`; bind pages by `platform_account_id`.
- Secrets through `op` and env files, nothing in the repo. Everything on GitHub (commits, PRs, docs, comments) is in
  English; chatter-facing texts (UI, site, announcements) are in Russian.
