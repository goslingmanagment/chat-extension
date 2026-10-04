# AGENTS.md — ChatGoose Extension (`chat-extension`)

Browser extension that adds ChatGoose AI (Reply with tones and Split, Fix, Hi,
Ping, Recap, Review, Help, Coach), the Spenders board, "New" subscribers,
hotkeys and sound on top of OnlyMonster ChatSpace (`chat.onlymonster.ai`,
OnlyFans) first and fansly.com second. Successor to the Electron desktop
(`~/code/1-platform/onlyfans-chat`) and the Fansly extension
(`~/code/1-platform/fansly-chat`); both stay live until this one passes its
pilot. Client of the Agency Hub (`~/code/1-platform/hub`): all AI and all
platform data go through the hub via the vendored `@kernel/sdk`.

**Status: the extension is built and wired; it has not run on the real
ChatSpace or the prod hub yet.** Waves 1 and 2 (R00–R02, R07–R18) are merged
and connected: the background, the ChatSpace tab (dock, overlays, boards,
hotkeys, sound) and the extension pages (popup, settings, sign-in, debug
pages) work together on the ChatSpace-like stand against the fake hub.
Contracts are frozen at 1.2.0 (`docs/protocols/README.md`); a change is
additive, in its own `contract-change:` commit with fixtures and a line in
`docs/contracts-changelog.md`. Still ahead: the hub PRs H-* in prod and the
SDK re-vendor, the owner's live checks (X9), CI and release (R19), Fansly
(R20). What works and what is left: `README.md` «Что уже работает»; decisions
taken without the owner: `docs/decisions.md` X12.

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
  gates, parity, archive check, dev runner.

The package graph is enforced by `pnpm lint` (ESLint + dependency-cruiser);
a boundary you need to cross is a design question, not a lint exception.

## Commands

- `pnpm install --frozen-lockfile` — Node 26, pnpm 10.33.1 (no corepack).
- `pnpm check` — typecheck, lint, test, build, webext-lint, size, gates,
  parity, archive-check. Green before every commit.
- `pnpm e2e` — both builds, the stand, the fake hub, headless Firefox
  (about 13 minutes). Green before Ready. No network beyond loopback.
- `pnpm vitest run <path>` and, from `packages/testing`,
  `npx wdio run e2e/wdio.conf.ts --spec e2e/specs/<name>.e2e.ts` — one test
  file or one spec (the spec needs `pnpm build && pnpm build:test` first).
- `CG_DEV_PROFILE=~/Documents/ChatGoose/firefox-dev-profile pnpm dev` — the
  test build in the owner's persistent Firefox dev profile, rebuilt on change
  (README «Живые проверки»). Only for X9 checks, only in the test chat.
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
- **Live tests** only on the owner's test chat (OnlyMonster account 36408 →
  chat 518588958).
- Secrets via `op` (1Password); none in the repo. Owner-facing docs in Russian.
- The owner's global rules apply (`~/.agents/AGENTS.md`): code changes in a
  separate worktree, Draft PRs, paid CI.
