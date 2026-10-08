# AGENTS.md — ChatGoose Extension (`chat-extension`)

Browser extension that adds ChatGoose AI (Reply with tones and Split, Fix, Hi,
Ping, Recap, Review, Help, Coach), the Spenders board, "New" subscribers,
hotkeys and sound on top of OnlyMonster ChatSpace (`chat.onlymonster.ai`,
OnlyFans) first and fansly.com second. Successor to the Electron desktop
(`~/code/1-platform/onlyfans-chat`) and the Fansly extension
(`~/code/1-platform/fansly-chat`); both stay live until this one passes its
pilot. Client of the Agency Hub (`~/code/1-platform/hub`): all AI and all
platform data go through the hub via the vendored `@kernel/sdk`.

**Status: the extension is built and wired; its first live check on the real
ChatSpace (0.172.0) with the prod hub was on 2026-10-04** — what worked, what
it found and what is fixed: `docs/pilot-readiness.md` «Первая живая проверка».
Waves 1 and 2 (R00–R02, R07–R18) are merged
and connected: the background, the ChatSpace tab (dock, overlays, boards,
hotkeys, sound) and the extension pages (popup, settings, sign-in, debug
pages) work together on the ChatSpace-like stand against the fake hub.
Contracts are frozen at 1.6.0 (`docs/protocols/README.md`); a change is
additive, in its own `contract-change:` commit with fixtures and a line in
`docs/contracts-changelog.md`. The SDK is a development vendor from hub
`1e5f6ed9` (2026-10-05): the head of the hub branch
`client/synthetic-examples-in-comments` (hub PR #482, pending merge), which is
hub `main` `4a470029` plus synthetic examples in two contract comments. A
release is vendored only from a deployed hub commit. The prod hub may run an
older contract — the hub layer announces
only what the bootstrap declares. Still ahead: the hub PRs that are not merged
yet (feed, Spenders stats, claim, «Новые») and the next re-vendor, the owner's
next live checks (X9), the first real CI run and the first release (the R19 tooling is
built, nothing of it has run outward yet: `docs/release.md`), Fansly (R20). What works and what is left: `README.md` «Что уже работает»; decisions
taken without the owner: `docs/decisions.md` X12; what is proven end to end on
the stand, what waits for the hub and the owner's smoke checklist:
`docs/pilot-readiness.md`.

## Layout

pnpm monorepo, TypeScript strict, Firefox MV3 (WXT), Preact.

- `apps/extension` — entry points, the manifest, the three composition roots
  (`src/composition/{background,tab,pages}.ts`: wiring only) and the lazy
  chunks of the tab (`lazy/entries`).
- `packages/contracts` — types, zod schemas, the CG error registry, i18n
  keys, view models. No logic; imports only zod.
- `packages/core` — all logic, no DOM, no `browser.*`, no `fetch`:
  `domain` (pure), `services` (background), `application` (controllers of the
  tab and of the pages).
- `packages/platform` — the only package that touches `browser.*`.
- `packages/hub` — the hub facade over the vendored SDK; background only.
- `packages/host-chatspace` — the MAIN bridge (dependency-free) and the
  isolated adapter (`HostPort`).
- `packages/ui` — Preact surfaces; data only through `AppClient`.
- `packages/testing` — the stand, the fake hub, e2e. Never ships.
- `vendor/` — `@kernel/sdk`, `@chatgoose/hotkeys`. `tools/` — size budgets,
  gates, parity, archive check, dev runner, the release tool (`release`) and
  the CI e2e job (`ci`).
- `site/` — the release site (install, «Как начать», the guide, «Что нового»,
  the history, «О данных»). The version, the XPI link and the changelog parts
  in it are written by `pnpm release site`, never by hand.

The package graph is enforced by `pnpm lint` (ESLint + dependency-cruiser);
a boundary you need to cross is a design question, not a lint exception.

## Commands

- `pnpm install --frozen-lockfile` — Node 26, pnpm 10.33.1 (no corepack).
- `pnpm check` — typecheck, lint, test, build, webext-lint, size, gates,
  parity, archive-check. Green before every commit.
- `pnpm e2e` — both builds, the stand, the fake hub, headless Firefox
  (about 18 minutes). Green before Ready. No network beyond loopback.
- `pnpm vitest run <path>` and, from `packages/testing`,
  `npx wdio run e2e/wdio.conf.ts --spec e2e/specs/<name>.e2e.ts` — one test
  file or one spec (the spec needs `pnpm build && pnpm build:test` first).
- `CG_DEV_PROFILE=~/Documents/ChatGoose/firefox-dev-profile pnpm dev
  --debugger-port 6111` — the test build in the owner's persistent Firefox dev
  profile on its fixed debugger port, rebuilt on change (README «Живые
  проверки»). Only for X9 checks, only in the test chat. A plain `pnpm dev`
  uses `.dev-profile/` of the worktree on a port of its own; the launcher
  asks the Firefox behind a port which profile it runs before it installs,
  and refuses another one. On
  macOS it starts Firefox through LaunchServices (`open`) and installs the
  build over the debugger port. Do not start a WINDOWED Firefox — its binary
  or `web-ext run` — from an agent shell there: twice after such a launch the
  machine lost its Orca Computer Use accessibility permission system-wide.
  The cause is unproven (the permission later dropped with no direct launch
  at all, likely after an Orca restart), so this is caution, not a known
  mechanism. Headless Firefox driven by geckodriver (`pnpm e2e`, `pnpm perf`)
  is exempt.
- `pnpm release <command>` — cutting a release (`docs/release.md`). `status`,
  `version`, `note`, `site`, `build`, `preflight` are local. `preflight
  --online` also reads, and only reads: origin (`git fetch`, `git
  ls-remote`), the served feed, the production hub's health, and GitHub's API
  about the hub repository (`gh api repos/<hub>/compare/…`: is the vendored
  SDK's commit on the hub's main). `sign`, `publish`, `pages`, `tag`,
  `announce`, `rollback` leave the machine: without `--confirm <version>` they
  only print their plan and make no request at all. `--confirm` is the
  owner's word: an agent passes it only when the owner asked for that very
  step. A test of the tool never uses a real address: `tools/release/*.test.ts`
  run against loopback and a scripted world (`cli-world.ts`).
- `tools/ci/e2e-docker-local.sh` — the CI e2e job on this machine: the whole
  `pnpm e2e` inside the pinned Firefox image with no network (needs Docker).
- `pnpm parity:coverage` — rewrites `docs/parity/coverage.md`: which parity
  rows a test names. Name the row in the test title: `it('[ST-042] …')`.

## Where the truth is

- `docs/hub-integration-plan.md` — the plan: hub contract changes, the
  extension's hub layer, order of work, acceptance, owner decisions. §0 is the
  owner's bar for this client.
- `docs/architecture.md` — the implementation-ready architecture (arena Opus 5.5 + astra, 2026-10-03): stack, packages, frozen interfaces, ChatSpace host, X8, hub changes, work packages, the UI agent's contract. Binding, in Russian.
- `docs/ui-design.md` — the binding visuals; `docs/protocols/` — the frozen
  interfaces as built; `docs/pages.md`, `docs/hub-layer.md`,
  `docs/hotkeys-delivery.md`, `packages/*/README.md` — how each part is built.
- `docs/parity/` — the parity checklist, its map to modules and work
  packages, the machine manifest (810 rows, `pnpm parity`) and the coverage
  report (`coverage.md`).
- `docs/release.md` — the runbook: CI and the PC runners, how to cut a release,
  how an update reaches chatters, rollback, coexistence with the Fansly
  extension and the desktop, pilot evidence, what is not verified yet.
  `CHANGELOG.md` is the chatter-facing text of each version (the site and the
  announcement are made from it); `BUILD.md` is for Mozilla's reviewers.
- `docs/decisions.md` — decision log (quick-ref table + entries). The hub keeps
  no decision log; a cross-repo ruling is recorded here and in the sibling
  clients' logs, pointing at the hub doc or package that carries it.
- `docs/research/onlymonster-chatspace.md` and `docs/research/onlymonster-chatspace/`
  — ChatSpace research (API catalog, client internals, product features, live
  facts), plus inventories of the Fansly extension and the desktop: the source
  of the parity checklist. `codex/` is an independent second study.
- Hub docs: `docs/error-handling.md` (CG-* error taxonomy),
  `docs/identity-rights-matrix.md`, `docs/ai-gateway-contract.md`.

## Things that bite

- **AI lives only in the hub.** No vendor SDKs, keys or prompts here.
- **The extension never sends on its own.** A send happens only on an explicit
  human click: in an open chat the human presses ChatSpace's own Send (we only
  insert the draft through `__omComposerBridge`); from a preview (Spenders,
  "New") a click sends through ChatSpace's own send queue in the page (X8),
  never through a request of ours. Never auto-retry anything indeterminate.
- **Quiet mode toward OnlyMonster.** No network requests of our own to
  OnlyMonster: read page memory and passive events, insert through their bridge.
  The only write is the human-clicked preview send through their own queue (X8).
- **Opening a chat in ChatSpace marks it read on OnlyFans** (live-verified).
  Never load the history of a chat the human did not open; other fans' data
  come from the hub only.
- **Fresh page text goes to the hub only for draft features** (Reply, Fix, Hi,
  Ping), never for Recap/Review/Coach, and never into the hub archive, money or
  dossiers. Skip queued (`isFromQueue`) and unsent messages.
- **UI is designed from scratch** and docks to the top of ChatSpace's message
  input (the composer); see decision X7. Do not copy the old Fansly or desktop
  look.
- **Parity bar.** Every feature of the Fansly extension and the desktop carries
  over, including logging, the front-end debug mode, settings, popup and error
  toasts. Dropping one needs the owner's explicit OK. Execution must be
  measurably better: performance budgets come from a measured baseline.
- **ID namespaces:** OnlyMonster account id (host), OnlyFans numeric creator
  and fan ids (platform), hub `pageId`. Never mix; bind pages by
  `platform_account_id`, never by display name.
- **Vendored `@kernel/sdk` and `@chatgoose/hotkeys`:** never hand-edit;
  re-vendor with the hub's `scripts/vendor-sdk.mjs` / `vendor-hotkeys.mjs`.
- **An owner switch is the PAGE's own.** The hub evaluates every flag per page
  (`pages[].features[flag]`); the bootstrap's top-level `flags` carry the
  owner's `"*"` row alone and are all false in a pilot switched on page by
  page. The one exception is the hub's MASTER switch: it is global — off, every
  feature of every page reads `disabled`. Never gate on `bootstrap.flags`: use `packages/core/src/domain/ops/flags.ts`
  (`docs/protocols/hub.md` «Флаги: решает страница»). The fake hub's default
  preset is that pilot, so e2e fails on a client that reads the top-level flags.
- **A request the hub would refuse must fail in CI.** The hub's own rules for
  an AI body live partly in its handler, not in its schema; the fake hub
  repeats them (`fake-hub/ai-rules.ts`) and checks bodies by the vendored
  SDK's real schema in e2e. When a hub rule changes, change it there too.
- **Live tests** only on the owner's test chat (OnlyMonster account 36408 →
  chat 518588958). Never press ⌘1–9, J, K or ⌘U on the live ChatSpace tab:
  our navigation opens other fans' chats; `navigation` stays off on live
  pages while checking.
- Secrets via `op` (1Password); none in the repo. Owner-facing docs in Russian.
- The owner's global rules apply (`~/.agents/AGENTS.md`): code changes in a
  separate worktree, Draft PRs, paid CI.
