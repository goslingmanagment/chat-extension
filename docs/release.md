# Releasing the extension

A release is one command: no PR, no hand edits of `CHANGELOG.md`. What chatters read about a version
comes from the notes of changes (`changes/`, written in each PR — section 2).
The previous version of this document (runners, the tool's verification history, pilot
checklists) — `git show c081f47f:docs/release.md`.

## 1. How to release

Once your PR is merged and `main` CI is green on that commit (`pnpm check` and `pnpm e2e`),
in a clean checkout of `main`:

```sh
cd ~/code/1-platform/chat-extension && git switch main && git pull
pnpm release --dry-run     # checks, version, notes and the plan; changes nothing
pnpm release               # the version comes from the notes (section 2)
```

An agent runs the command itself. No local `pnpm check`, no perf run, no manual checklist:
all of that is `main` CI, and the command itself requires it green.

What `pnpm release` does, in order:

1. **Lock.** Puts the tag `release-lock` on origin (who, version, time). If the tag is already
   there, another release is under way: the command stops at once and names who and since when.
2. **Version.** The last `vX.Y.Z` tag raised by the notes since it: a `new` note — minor, else
   patch (section 2). `apps/extension/package.json` is not raised in git: the version lives in the tags.
3. **Checks** (read-only): `main` CI green on the commit (and on the last commit that changed
   more than documents), the tag is free, the vendored SDK comes from a commit on the hub's `main`,
   the prod hub accepts it (`compatibleClientSdks`), the feed serves a lower version. Any red — no release.
4. **What's new** — the notes added to `main` since the previous tag: the site's "Что нового" and
   "История версий" (with the screenshots), `CHANGELOG.md` in the build and the post. A version
   without notes says «Внутренние улучшения: для работы ничего не меняется.» Commit subjects never
   reach chatters; the GitHub release lists the notes and every commit. A `feat`/`fix` commit without
   a note is named in the output.
5. **Build.** The version, `CHANGELOG.md` and the `site/` pages are written into the tree only for
   the build, `pnpm build`, then the files are put back as git has them.
6. **AMO signing** (unlisted, `web-ext sign` with the sources archive). The signed XPI is checked
   against the build and stored in `.release/<version>/` with the release record.
7. **Server:** XPI and record → read back → the feed in one swap → the pages.
8. **Tag** `v<version>` on the release commit and a **GitHub release** with the notes.
9. The lock is released — on failure too.

The command does not announce to chatters (section 6).

## 2. Notes and versions

**Notes.** Every PR a chatter notices (`feat`, `fix`) adds `changes/<slug>.md`: a title in the
chatter's words, who it is for and why, `## Как это устроено` (the technical side) and 0–4
screenshots from `pnpm see`. The format, the tone and the commands — `changes/README.md`.
`pnpm check` (`pnpm gates`) fails a `feat`/`fix` PR without a note, unless its description says
`No chatter note: <why>`. `pnpm release notes` checks the notes, names the next version and writes
previews of the page and the post to `.cache/notes/`.

**Versions** — the rules for agents:

1. `pnpm release` with no argument. The tool picks the version: the last tag + minor when a note
   since it is `new`, else + patch. Nobody picks it by hand.
2. A major or any other version than that is the owner's call: `pnpm release major|X.Y.Z
   --confirm <version>` only on the owner's word. Finishing a version this checkout began
   (`pnpm release status` names it) needs no confirmation.
3. 1.x and 2.x are the old Fansly extension's numbers (`fansly-chat`, last 2.13.x): the tool refuses
   them. This extension goes from 0.5.x straight to **3.0.0** (below).
4. No version in a PR title, a commit or a note, and no edit of the version in
   `apps/extension/package.json`: `pnpm gates` fails a PR that does either. The tags hold the version.
5. A version is spent once it reached AMO: never reused, never skipped, its tag never moved or
   deleted. A release that stopped is the same `pnpm release` again.

**3.0.0 — the launch.** The one extension replaces the old Fansly one under the number 3.0. Its notes
are written ahead and held with `release: 3.0.0` (`changes/chatgoose-3.md` — the intro, then how to
switch, Spenders, the read mark, the settings, «Скачать лог»): the releases before it leave them out,
`pnpm release notes` previews them in `.cache/notes/3.0.0/`. Its landing is drafted in
`site/drafts/3.0.0/index.html` (not published: `site/drafts/` is no file of the site) and previewed
there too. On the owner's word: a PR that moves the landing over `site/index.html` (the index's
rewrites in `tools/release/site-copy.ts` go with it) and retakes the screenshots of the notes, then
`pnpm release 3.0.0 --confirm 3.0.0`, then the first announcement (section 6). The old extension gets
no more releases after it.

## 3. Keys

The command takes variables from the environment and, for what is missing, from files — the
first one that has a value: `~/.config/agency/secrets.env`, then
`~/code/1-platform/fansly-chat/.env.deploy`. Only names are printed.

| Variable | What it is |
|---|---|
| `WEB_EXT_API_KEY`, `WEB_EXT_API_SECRET` | AMO API keys (JWT issuer and secret); only `web-ext sign` gets them |
| `CG_RELEASE_SSH`, `CG_RELEASE_REMOTE_DIR` | the server and the site folder; default `root@152.53.191.242` and `/var/www/ext/chat-extension` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID` | the announcement bot and channel (`announce` only); the bot is an admin of the channel with the right to post media |
| `TELEGRAM_PREVIEW_CHAT_ID` | the owner's test chat or channel with the same bot (`announce --preview`); not set yet |
| `CG_RELEASE_HTTP_TIMEOUT_S` | how long to wait for one server answer when reading back (default 120) |

`op://fansly/Mozilla` in 1Password is the AMO website login, not the API keys (it gives 401 "Unknown JWT iss").

## 4. If a release stopped

- **Just run it again.** What is signed is not signed twice, what is published is not
  published again, a tag that did not reach origin is set again. The version stays the same
  until its tag exists.
- **A lock left by a dead process** — `pnpm release unlock` (only if that release is surely dead).
- **AMO signed later than `web-ext` waited.** Download the signed XPI from the developer hub,
  `pnpm release sign --import <file.xpi>`, then `pnpm release <version>`. Until such a version
  is finished, the command will not release another one.
- **Red `main` CI** is fixed by whoever releases: a PR with the fix, then the release.
- `pnpm release status` — what this checkout holds: tags, build, unfinished versions.

## 5. Rollback

Firefox never downgrades a version. From fast to slow:

1. **A flag in the hub** (per page or the master switch) — minutes, no release.
2. **The feed back at the previous version** — stops the spread; whoever already updated stays
   on the new one:
   ```sh
   pnpm release rollback --to <previous> --confirm <previous>
   ```
   Without `--confirm` the command only prints its plan. The next release updates the pages.
3. **A fix in a higher version** — a normal release (`git revert` + `pnpm release`).

## 6. Announcement — only on the owner's word, from 3.0.0

```sh
pnpm release announce --dry-run                # the post and the plan
pnpm release announce --preview --confirm <version>   # to the owner's test chat (TELEGRAM_PREVIEW_CHAT_ID)
pnpm release announce --confirm <version>      # the channel; once per version, again — --again
```

The channel hears of the one extension from **3.0.0** on: below it a real run refuses (the
`--preview` and `pnpm release notes` show the post of any version). The post is one Telegram rich
message (`sendRichMessage`, Rich HTML): the version and its date; each note under ✨ Новое /
🛠 Улучшено / 🐛 Исправлено with its title, the sites, who it is for and why, its screenshots
(served by the site, `changes/` next to the pages) and «Как это устроено» folded; at the end how the
update comes and a button to «Что нового» on the site. An "indeterminate" answer means the message
may have gone out: look at the channel first.

## 7. How an update reaches chatters

Firefox reads the feed `https://ext.gosling-agency.ru/chat-extension/firefox/updates.json`
about once a day and installs the new version itself; right away — `about:addons` → "Check for
Updates". Open tabs stay on the old code and ask for a reload. A version with a new permission
does not install silently — warn about it in the announcement. The oldest Firefox is 142.

On the server (`/var/www/ext/chat-extension/`): the site pages, `firefox/updates.json`,
`firefox/updates.previous.json`, `firefox/chatgoose-chatspace-<version>.xpi` and `.json`
(one file per version, never deleted — rollback needs them). The site is seen as
`https://chatgoose.gosling-agency.ru/chatspace/`.

## 8. CI

- PR: only `pnpm check` (`main`'s ruleset requires it); the PR merges itself when green. It is four parallel parts
  (`pnpm check: typecheck`, `lint`, `test`, `build`) with the gate `pnpm check` over them. A PR of prose nothing
  reads (`docs/**/*.md`, `AGENTS.md`, `CLAUDE.md`) is green in seconds.
- Push to `main`: `pnpm check` and the e2e smoke set in four parts (`e2e 1/4` … `4/4`, with `pnpm e2e` over them).
  This is the release gate. A change of only `docs/`, `site/`, `changes/` and `*.md` in the root does not run e2e.
- CI runs only on GitHub-hosted runners (the repository is public); no job may name a self-hosted label.
- `.github/workflows/perf.yml` — `pnpm perf` nightly and by hand on a GitHub-hosted runner; not part of a release.
- e2e locally, as in CI: `tools/ci/e2e-docker-local.sh` (needs Docker; one part —
  `CG_E2E_SHARD=2/2`). The Firefox image is pinned by digest in `tools/ci/e2e-image.sh`.
- Signed P3b test builds — `pnpm release test-builds`, `pnpm release sign
  --test-builds --confirm <version N>` (`docs/project-unite/spike.md`, the "P3b" run section).
