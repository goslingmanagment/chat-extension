# Releasing the extension

A release is one command: no PR, no release notes to write, no hand edits of `CHANGELOG.md`.
The previous version of this document (runners, the tool's verification history, pilot
checklists) — `git show c081f47f:docs/release.md`.

## 1. How to release

Once your PR is merged and `main` CI is green on that commit (`pnpm check` and `pnpm e2e`),
in a clean checkout of `main`:

```sh
cd ~/code/1-platform/chat-extension && git switch main && git pull
pnpm release --dry-run     # checks, version, notes and the plan; changes nothing
pnpm release               # patch; or pnpm release minor | major | X.Y.Z
```

An agent runs the command itself. No local `pnpm check`, no perf run, no manual checklist:
all of that is `main` CI, and the command itself requires it green.

What `pnpm release` does, in order:

1. **Lock.** Puts the tag `release-lock` on origin (who, version, time). If the tag is already
   there, another release is under way: the command stops at once and names who and since when.
2. **Version.** The last `vX.Y.Z` tag + patch (or what was asked). `apps/extension/package.json`
   is not raised in git: the release version lives in the tags.
3. **Checks** (read-only): `main` CI green on the commit (and on the last commit that changed
   more than documents), the tag is free, the vendored SDK comes from a commit on the hub's `main`,
   the prod hub accepts it (`compatibleClientSdks`), the feed serves a lower version. Any red — no release.
4. **What's new** — from the `main` commits since the previous tag: `CHANGELOG.md`, the site's
   "What's new", the history and the announcement get `feat`/`fix` and commits without a prefix
   (not `docs`, `test`, `ci`, `chore`, `refactor`…); the GitHub release gets every commit.
5. **Build.** The version, `CHANGELOG.md` and the `site/` pages are written into the tree only for
   the build, `pnpm build`, then the files are put back as git has them.
6. **AMO signing** (unlisted, `web-ext sign` with the sources archive). The signed XPI is checked
   against the build and stored in `.release/<version>/` with the release record.
7. **Server:** XPI and record → read back → the feed in one swap → the pages.
8. **Tag** `v<version>` on the release commit and a **GitHub release** with the notes.
9. The lock is released — on failure too.

The command does not announce to chatters (section 5).

## 2. Keys

The command takes variables from the environment and, for what is missing, from files — the
first one that has a value: `~/.config/agency/secrets.env`, then
`~/code/1-platform/fansly-chat/.env.deploy`. Only names are printed.

| Variable | What it is |
|---|---|
| `WEB_EXT_API_KEY`, `WEB_EXT_API_SECRET` | AMO API keys (JWT issuer and secret); only `web-ext sign` gets them |
| `CG_RELEASE_SSH`, `CG_RELEASE_REMOTE_DIR` | the server and the site folder; default `root@152.53.191.242` and `/var/www/ext/chat-extension` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID` | the announcement bot and channel (`announce` only) |
| `CG_RELEASE_HTTP_TIMEOUT_S` | how long to wait for one server answer when reading back (default 120) |

`op://fansly/Mozilla` in 1Password is the AMO website login, not the API keys (it gives 401 "Unknown JWT iss").

## 3. If a release stopped

- **Just run it again.** What is signed is not signed twice, what is published is not
  published again, a tag that did not reach origin is set again. The version stays the same
  until its tag exists.
- **A lock left by a dead process** — `pnpm release unlock` (only if that release is surely dead).
- **AMO signed later than `web-ext` waited.** Download the signed XPI from the developer hub,
  `pnpm release sign --import <file.xpi>`, then `pnpm release <version>`. Until such a version
  is finished, the command will not release another one.
- **Red `main` CI** is fixed by whoever releases: a PR with the fix, then the release.
- `pnpm release status` — what this checkout holds: tags, build, unfinished versions.

## 4. Rollback

Firefox never downgrades a version. From fast to slow:

1. **A flag in the hub** (per page or the master switch) — minutes, no release.
2. **The feed back at the previous version** — stops the spread; whoever already updated stays
   on the new one:
   ```sh
   pnpm release rollback --to <previous> --confirm <previous>
   ```
   Without `--confirm` the command only prints its plan. The next release updates the pages.
3. **A fix in a higher version** — a normal release (`git revert` + `pnpm release`).

## 5. Announcement — only on the owner's word

```sh
pnpm release announce --dry-run
pnpm release announce --confirm <version>      # once per version; again — --again
```

The post is the notes of the last release. An "indeterminate" answer means the message may have
gone out: look at the channel first.

## 6. How an update reaches chatters

Firefox reads the feed `https://ext.gosling-agency.ru/chat-extension/firefox/updates.json`
about once a day and installs the new version itself; right away — `about:addons` → "Check for
Updates". Open tabs stay on the old code and ask for a reload. A version with a new permission
does not install silently — warn about it in the announcement. The oldest Firefox is 142.

On the server (`/var/www/ext/chat-extension/`): the site pages, `firefox/updates.json`,
`firefox/updates.previous.json`, `firefox/chatgoose-chatspace-<version>.xpi` and `.json`
(one file per version, never deleted — rollback needs them). The site is seen as
`https://chatgoose.gosling-agency.ru/chatspace/`.

## 7. CI

- PR: only `pnpm check` (`main`'s ruleset requires it); the PR merges itself when green. It is four parallel parts
  (`pnpm check: typecheck`, `lint`, `test`, `build`) with the gate `pnpm check` over them. A PR of prose nothing
  reads (`docs/**/*.md`, `AGENTS.md`, `CLAUDE.md`) is green in seconds.
- Push to `main`: `pnpm check` and the e2e smoke set in four parts (`e2e 1/4` … `4/4`, with `pnpm e2e` over them).
  This is the release gate. A change of only `docs/`, `site/` and `*.md` in the root does not run e2e.
- CI runs only on GitHub-hosted runners (the repository is public); no job may name a self-hosted label.
- `.github/workflows/perf.yml` — `pnpm perf` nightly and by hand on a GitHub-hosted runner; not part of a release.
- e2e locally, as in CI: `tools/ci/e2e-docker-local.sh` (needs Docker; one part —
  `CG_E2E_SHARD=2/2`). The Firefox image is pinned by digest in `tools/ci/e2e-image.sh`.
- Signed P3b test builds — `pnpm release test-builds`, `pnpm release sign
  --test-builds --confirm <version N>` (`docs/project-unite/spike.md`, the "P3b" run section).
