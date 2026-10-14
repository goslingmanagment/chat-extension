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
Contracts are frozen at 1.15.0 (`docs/protocols/README.md`); a change is
additive, in its own `contract-change:` commit with fixtures and a line in
`docs/contracts-changelog.md`. The SDK's source commit and contract hash live
in `vendor/kernel-sdk/kernel-sdk.vendor.json`; all hub calls go through that
SDK (the temporary RouteTransport is gone). A release uses a merged, deployed
hub commit; `pnpm release preflight --online` checks production compatibility
for that release. Dated checks are recorded in `docs/releases/`.
What a page gets is the owner's per-page switch (`chatExtensionFeatures`,
`docs/pilot-readiness.md` §2–§3). The hub layer still calls a
route only when the bootstrap declares its capability, so on an older hub
those features read `hub_not_ready` and the rest works. Still ahead: sending
from the preview (X8, the owner's call), the owner's next live checks (X9)
and Fansly (R20). Releases and their verification are recorded in Git tags
and `docs/releases/`; the checkout version is `apps/extension/package.json`.
The procedure is `docs/release.md`; the served feed is checked at release time.
What works and what is left: `README.md` «Что уже работает»; decisions
taken without the owner: `docs/decisions.md` X12; what is proven end to end on
the stand, what waits for the hub and the owner's smoke checklist:
`docs/pilot-readiness.md`.

## Fansly browser and research

For Fansly development, use **Chrome DevTools MCP** (`chrome-devtools`,
`mcp__chrome-devtools__*`) automatically; do not choose Claude in Chrome for
this site or wait for the owner to remind you. Start with `list_pages` and
inspect the intended already-open Fansly tab. Read-only DOM, styles, console
and network inspection is allowed; do not reload or switch conversations for
a simple inspection. Opening another conversation can mark messages read;
typing can send typing events. Sending, uploads and account changes need the
owner's task to authorize them.

Read [the Fansly development guide](docs/research/fansly.md) before changing
Fansly integration. It indexes the downloaded bundle, chat DOM/lifecycle,
API/WebSocket research, existing client code, FBuddy and the latest sanitized
live evidence. If MCP is missing or disconnected, follow its connection
section and state the exact blocker; continue with the local bundle. Never
route around a tool denial through another browser/transport. Chrome page
inspection does not verify our Firefox MV3 extension. This read-only workflow
updates the old R20 live-site restriction (X38); stand tests and pilot gates
remain required.

## Layout

pnpm monorepo, TypeScript strict, Firefox MV3 (WXT), Preact.

- `apps/extension` — entry points, the manifest, the three composition roots
  (`src/composition/{background,tab,pages}.ts`: wiring only), the lazy
  chunks of the tab (`lazy/entries`), the sites' background chunks (`bg/`:
  what only one site needs in the background, loaded by the core —
  `docs/project-unite/architecture.md` §3.3) and the host registry (`src/hosts`: one
  entry per site, build data for the manifest, the WXT entries, the gates and
  the tools; code that ships reads only its runtime table, `src/hosts/runtime`).
- `packages/contracts` — types, zod schemas, the CG error registry, i18n
  keys, view models. No logic; imports only zod.
- `packages/core` — all logic, no DOM, no `browser.*`, no `fetch`:
  `domain` (pure), `services` (background), `application` (controllers of the
  tab and of the pages).
- `packages/platform` — the only package that touches `browser.*`.
- `packages/hub` — the hub facade over the vendored SDK; background only.
- `packages/host-kit` — the host-neutral page machinery both sites share: the
  MAIN loader and bridge protocol (dependency-free), `guard`, the isolated
  bridge client, closed hosts and layers, keep-bottom, the key probe; it
  names no site.
- `packages/host-chatspace` — ChatSpace's MAIN runtime and WS tap, and its
  isolated adapter (`HostPort`) over `host-kit`.
- `packages/ui` — Preact surfaces; data only through `AppClient`.
- `packages/testing` — the stand, the fake hub, e2e. Never ships.
- `vendor/` — `@kernel/sdk`, `@chatgoose/hotkeys`. `tools/` — size budgets,
  gates, parity, archive check, dev runner, the release tool (`release`),
  the CI e2e job (`ci`) and the brand sync (`brand`: the agency's typefaces and
  goose drawings for the extension pages, generated from agency-site; X32).
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
  One volume is one run at a time (a start replaces the working tree in it):
  while a running container has the volume mounted, the script refuses to
  start and names that container. Wait, or give the run a volume of its own:
  `CG_E2E_VOLUME=<own name>` (the default is `cg-e2e-local`).
- `pnpm parity:coverage` — rewrites `docs/parity/coverage.md`: which parity
  rows a test names. Name the row in the test title: `it('[ST-042] …')`.
  On Fansly a test closes a row only on its host (its path, or `[host:fansly]`
  in a title of shared code) and at its level; `pnpm parity` fails on an open
  row of an R20 PR marked `✓` in `docs/project-unite/plan.md` — mark your own
  PR there (`docs/project-unite/parity-matrix.md` §1).
- `pnpm gates:bytes` — rewrites `tools/gates/chatspace-bytes.json`, the size
  and sha256 of every file a ChatSpace tab and its background load (after
  `pnpm build`). Only for a change of shared code that means to move those
  bytes; see «ChatSpace's bytes are pinned» below.

## Where the truth is

- `docs/hub-integration-plan.md` — the plan: hub contract changes, the
  extension's hub layer, order of work, acceptance, owner decisions. §0 is the
  owner's bar for this client.
- `docs/architecture.md` — the implementation-ready architecture (arena Opus 5.5 + astra, 2026-10-03): stack, packages, frozen interfaces, ChatSpace host, X8, hub changes, work packages, the UI agent's contract. Binding, in Russian.
- `docs/ui-design.md` — the binding visuals; `docs/protocols/` — the frozen
  interfaces as built; `docs/pages.md`, `docs/hub-layer.md`,
  `docs/hotkeys-delivery.md`, `packages/*/README.md` — how each part is built.
- `docs/parity/` — the parity checklist, its map to modules and work
  packages, the machine manifest (828 rows, `pnpm parity`) and the coverage
  report (`coverage.md`).
- `docs/release.md` — the runbook: CI and the PC runners, how to cut a release,
  how an update reaches chatters, rollback, coexistence with the Fansly
  extension and the desktop, pilot evidence, what is not verified yet.
  `CHANGELOG.md` is the chatter-facing text of each version (the site and the
  announcement are made from it); `BUILD.md` is for Mozilla's reviewers.
- `docs/project-unite/` — Project Unite, the clients joined into this extension;
  first R20, the Fansly host: `README.md` (status, history, open owner
  questions), `spec.md` (binding requirements `FS-*`; it overrides
  `docs/architecture.md` §15), `architecture.md` (how R20 is built — two
  sites in one extension: host registry, host adapter, feature manifest with
  per-site admission, host UI profile, per-site lazy builds, the byte registry
  and the gates that keep shared code host-free; binding for implementation),
  `plan.md` (stages and PRs, the PR graph in groups), `fansly-web.md` (facts
  about fansly.com with references); the owner's rulings — decisions X33,
  X34 (fast cutover, FBuddy on every chatter's page) and X37 (after the arena
  review: the pilot is all six Fansly pages at once, Recap depth 3000 on the
  hub); the architecture's own decisions — X35, revised by its arena review
  in X36.
- `docs/backlog.md` — what is still to do or to check and is in no work
  package yet; first of all, the functional parity with the Fansly extension
  (where the data come from, how fresh, how many steps), not just the rows.
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
- **UI speaks the family language** (decision X28, which revises X7): raised
  chips, the sunken capsule of Reply's options, draft cards, the terracotta
  accent, serif AI text — as in the Fansly extension — in a layout of its own:
  one card docked to the top of ChatSpace's message input (the composer). The
  host's blue is only for what reaches the fan («Отправить»). The extension
  pages (popup, settings, sign-in, debug) wear the agency identity instead
  (decision X32): paper, ink, Literata and Golos Text, the gosling logo — its
  palette lives in the pages' sheet only. `docs/ui-design.md` is binding.
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
- **ChatSpace's bytes are pinned, and shared code names no site**
  (`docs/project-unite/architecture.md` §1.8). `pnpm gates` compares the
  release build with `tools/gates/chatspace-bytes.json`: that is the comparison
  with `main`, in every PR. A change of shared code that moves them runs
  `pnpm gates:bytes`, commits the file and names the byte-registry deltas in
  the PR; after another such PR merges — rebase, build, run it again. A change
  of Fansly's own files alone (any path named by Fansly) never rewrites the
  pins and the gate refuses it: find the import that leaked. In `core`, `ui`
  and `hub` a string, comparison or table key equal to a `HostKind` or
  `Platform` value fails the gate outside its debt list
  (`tools/gates/sites.ts`); the PR that removes one shrinks the list.
- **A request the hub would refuse must fail in CI.** The hub's own rules for
  an AI body live partly in its handler, not in its schema; the fake hub
  repeats them (`fake-hub/ai-rules.ts`) and checks bodies by the vendored
  SDK's real schema in e2e. When a hub rule changes, change it there too.
- **Live tests** only on the owner's test chat (OnlyMonster account 36408 →
  chat 518588958). Never press ⌘1–9, J, K or ⌘U on the live ChatSpace tab:
  our navigation opens other fans' chats; `navigation` stays off on live
  pages while checking. **Fansly read-only inspection uses Chrome DevTools
  MCP** (X38, guide above). The owner runs no repeated smoke checks (X34);
  the Firefox host is proven on the stand and then by watching the pilot.
- Secrets via `op` (1Password); none in the repo. Owner-facing docs in Russian.
- The owner's global rules apply (`~/.agents/AGENTS.md`): code changes in a
  separate worktree, Draft PRs, paid CI.
