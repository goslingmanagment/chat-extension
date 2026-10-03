# AGENTS.md — ChatGoose Extension (`chat-extension`)

Browser extension that adds ChatGoose AI (Reply with tones and Split, Fix, Hi,
Ping, Recap, Review, Help, Coach), the Spenders board, "New" subscribers,
hotkeys and sound on top of OnlyMonster ChatSpace (`chat.onlymonster.ai`,
OnlyFans) first and fansly.com second. Successor to the Electron desktop
(`~/code/1-platform/onlyfans-chat`) and the Fansly extension
(`~/code/1-platform/fansly-chat`); both stay live until this one passes its
pilot. Client of the Agency Hub (`~/code/1-platform/hub`): all AI and all
platform data go through the hub via the vendored `@kernel/sdk`.

**Status: R00 scaffold and the M0 spike are done** (`docs/spike-m0.md`); R01
(frozen interfaces) is next. Read `docs/architecture.md` and
`docs/hub-integration-plan.md` first; developer commands are in `README.md`.
`pnpm check` must be green before a commit, `pnpm e2e` before Ready.

## Where the truth is

- `docs/hub-integration-plan.md` — the plan: hub contract changes, the
  extension's hub layer, order of work, acceptance, owner decisions. §0 is the
  owner's bar for this client.
- `docs/architecture.md` — the implementation-ready architecture (arena Opus 5.5 + astra, 2026-10-03): stack, packages, frozen interfaces, ChatSpace host, X8, hub changes, work packages, the UI agent's contract. `docs/parity/` — parity checklist (787 rows) and its map to modules/packages.
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
