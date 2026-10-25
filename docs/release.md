# Releasing the extension

A release is one command: no PR, no hand edits of `CHANGELOG.md`. What chatters read about a version
comes from the notes of changes (`changes/`, written in each PR — section 2): the site, and from 3.0.0 the
post in their Telegram channel, which the command makes as its last step (section 6).
The previous version of this document (runners, the tool's verification history, pilot
checklists) — `git show c081f47f:docs/release.md`.

## 1. How to release

Once your PR is merged and `main` CI is green on that commit (`pnpm check` and `pnpm e2e`),
in a clean checkout of `main`:

```sh
cd ~/code/1-platform/chat-extension && git switch main && git pull
pnpm release --dry-run     # checks, version, notes, the post and the plan; changes nothing
pnpm release               # the version comes from the notes (section 2); --no-announce: no post this time
```

An agent runs the command itself. No local `pnpm check`, no perf run, no manual checklist:
all of that is `main` CI, and the command itself requires it green.

What `pnpm release` does, in order:

1. **Lock.** Puts the tag `release-lock` on origin (who, version, time). If the tag is already
   there, another release is under way: the command stops at once and names who and since when.
2. **Version.** The last `vX.Y.Z` tag raised by the notes since it: a `new` note — minor, else
   patch (section 2). A site that declares a later first version — the 3.0 launch — makes that version
   the next one, on the owner's word only (section 2). `apps/extension/package.json` is not raised in git:
   the version lives in the tags.
3. **Checks** (read-only): `main` CI green on the commit (and on the last commit that changed
   more than documents), the tag is free, the vendored SDK comes from a commit on the hub's `main`,
   the prod hub accepts it (`compatibleClientSdks`), the feed serves a lower version, the pages render
   (`site`), the post can go out (`post`: the Telegram keys are set and Telegram takes it — section 6).
   Any red — no release.
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
9. **The post** — from 3.0.0, the version's notes go to the chatters' channel as one Telegram post with
   the screenshots: once per version, only when the version has a note (section 6). A failed or
   indeterminate post never fails or undoes the release: the command says which and how to post by hand.
10. The lock is released — on failure too.

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
are written ahead and held with `release: 3.0.0` (`changes/chatgoose-3.md` — the intro, then a tour of
what the extension does and how to leave the old clients): the releases before it leave them out,
`pnpm release notes` previews them — every page of the site and the post — in `.cache/notes/3.0.0/`.
The pages of `site/` are the only source of their text: the release fills only its slots (`data-cg`
version, Firefox and install link, the `cg:begin` parts).

The launch is gated by the site itself. A page declares the first version it belongs to in its head,
exactly so and once: `<meta name="cg-first-version" content="3.0.0">`; the highest any page declares is
the site's first version. A release below it is refused (it would publish those pages early), and while
it is above the version the notes give it is the next release, on the owner's word only:
`pnpm release`, its `--dry-run` and `pnpm release notes` stop with one line — «site/ is the 3.0.0 launch
(cg-first-version in index.html): the next release is 3.0.0 — pnpm release 3.0.0 --confirm 3.0.0, on the
owner's word». So the PR that moves the 3.0 pages into `site/` declares it in `site/index.html`, and from
its merge no routine release can publish them as 0.10.x. On the owner's word: `pnpm release 3.0.0
--confirm 3.0.0` — it publishes the site and posts the first announcement (section 6). Any later version
passes; the declaration may stay. The old extension gets no more releases after it.

## 3. Keys

The command takes variables from the environment and, for what is missing, from files — the
first one that has a value: `~/.config/agency/secrets.env`, then
`~/code/1-platform/fansly-chat/.env.deploy`. Only names are printed.

| Variable | What it is |
|---|---|
| `WEB_EXT_API_KEY`, `WEB_EXT_API_SECRET` | AMO API keys (JWT issuer and secret); only `web-ext sign` gets them |
| `CG_RELEASE_SSH`, `CG_RELEASE_REMOTE_DIR` | the server and the site folder; default `root@152.53.191.242` and `/var/www/ext/chat-extension` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID` | the post's bot and the chatters' channel (`pnpm release` from 3.0.0, `announce`); the bot is an admin of the channel with the right to post media |
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

## 6. The post in the chatters' channel — after every release from 3.0.0

From 3.0.0 on, `pnpm release` posts the notes of the version to the chatters' Telegram channel
(`TELEGRAM_CHANNEL_ID`) as its last step, after the tag and the GitHub release: once per version (the record
`.release/<version>/announced.json` — a second run never posts again), and only when the version has a note
(a version of internal changes posts nothing). Below 3.0.0 nothing goes to the channel. The `post` check
before the build makes sure it can go out; `pnpm release --no-announce` releases without it this time.

The post is one rich message (`sendRichMessage`, Rich HTML): «ChatGoose <version>» and its date; the
intro, when the version has one; from four notes on a line of contents linking to each; then ✨ Новое /
🛠 Улучшено / 🐛 Исправлено — each note with its title, its sites («OnlyFans и Fansly», «OnlyFans», «Fansly»),
who it is for and why, each screenshot full width with its caption and «Как это устроено» folded; at the end
how the update comes and the buttons «Что нового на сайте» and «Установить» (the public site, section 7).
The screenshots go up with the request itself (multipart/form-data, `tg://photo?id=…` in the HTML): the
post depends on nothing being published, and a preview can go out before a release. A post of improvements
and fixes alone goes without a notification; something new or the intro rings. Telegram's limits are checked
before any request: 32 768 characters, 500 blocks, 50 screenshots, a photo up to 10 MB with width + height at
most 10 000 and sides at most 1:20.

Whatever becomes of the post, the release stands; the command says which and what to do:

- `post: NOT posted — …` — nothing reached the channel: fix the cause, then `pnpm release announce --confirm <version>`;
- `post: UNKNOWN whether it reached the channel — …` — the send is indeterminate and never repeated by itself:
  look at the channel first, and only if the post is not there — `pnpm release announce --confirm <version> --again`.

By hand:

```sh
pnpm release announce --dry-run                    # the post of the last release and the plan
pnpm release announce --check                      # it can go out: the limits, the screenshots
pnpm release announce --confirm <version>          # the channel; once per version, again — --again
pnpm release announce [<version>] --preview --confirm <version>   # the owner's test chat (TELEGRAM_PREVIEW_CHAT_ID), before a release too
```

`pnpm release notes` writes the post's preview (`.cache/notes/telegram.html`, the held versions in
`.cache/notes/<version>/`) and says whether it can go out.

## 7. How an update reaches chatters

Firefox reads the feed `https://ext.gosling-agency.ru/chat-extension/firefox/updates.json`
about once a day and installs the new version itself; right away — `about:addons` → "Check for
Updates". Open tabs stay on the old code and ask for a reload. A version with a new permission
does not install silently — say so in its note: the note is the post. The oldest Firefox is 142.

On the server (`/var/www/ext/chat-extension/`): the site pages and `404.html`, the notes' screenshots in
`changes/`, `firefox/updates.json`, `firefox/updates.previous.json`, `firefox/chatgoose-<version>.xpi` and
`.json` (one file per version, never deleted — rollback needs them). The versions signed before the rename
(2026-10-25; 0.10.5 and lower) keep `firefox/chatgoose-chatspace-<version>.xpi` and `.json` for good: a release
record names its XPI, the feed and `rollback` take the name from there and never make it from the version.

The site for chatters is `https://chatgoose.gosling-agency.ru/`: nginx serves the same folder at the root of
that host, `404.html` (versionless, `<base href="/">`) is its error page. The feed, the XPIs and the
extension's own links stay under `https://ext.gosling-agency.ru/chat-extension/`, whose pages redirect
there; the post's buttons point at the public address (`PUBLIC_SITE`, `tools/release/config.ts`).

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
