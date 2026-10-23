# `pnpm see` — see a change with your own eyes

The test build (`CG_TEST_HOSTS=1`) is installed in a headless Firefox on the
stand — synthetic ChatSpace and Fansly plus the fake hub, no network — a
scenario presses through our UI, and the pictures and reports land in
`.cache/see/<time>-<scenario>/` (`.cache/see/latest` is the last run).
This is not a test and not CI: the scenarios live outside `e2e/specs`, they
assert nothing, and a scenario fails only when a step cannot be done.

## Commands

| Command | What it does | Time |
|---|---|---|
| `pnpm see` | lists the scenarios | — |
| `pnpm see <scenario\|file> [--site fansly \| --live [--chat <n>]] [--gif] [--no-build]` | rebuilds only what is stale; runs the scenario; prints the folder, the PNG paths and `index.html` (a contact sheet) | 6–10 s; +5 s test build, +1.5 s stand when changed |
| `pnpm see --new <name>` | a scenario of your own in `packages/testing/e2e/see/scratch/` (not committed) | — |
| `pnpm see:session [chatspace\|fansly] [--live [--chat <n>]]` | holds a shift open; the port is the worktree's own and is printed. An agent runs it in the background. Stops after 30 min idle (`--idle <min>`) | ~5 s to ready |
| `pnpm see:session --bare [--chat <n>]` | fansly.com alone, signed in as the test model, no extension: a browser to study Fansly in — click anything, read the page, every request and socket frame with its body in `s.net` (below) | ~10 s to ready |
| `pnpm see:do '<js>'` | one step in the session: async JS with `s` (the verbs below) and `browser`; prints the result and the path of a picture taken after the step. Also: `--name x`, `--no-shot`, `--file f.js`, `-` (stdin), `--shot <name>`, `--status`, `--stop` | 0.3–1.5 s |
| `pnpm see:gallery` | the UI galleries (kit, dock, boards, pages) on vite with hot reload, prints their URLs; Ctrl+C stops | < 1 s |

The session's live view is `http://127.0.0.1:<port>/live` (a frame every half
second): open it for the owner in the Claude desktop browser pane. `--gif`
makes `see.gif` from the run's frames (needs `ffmpeg`).

Scenarios: `dock`, `reply`, `reply-wait` (the sheet at the click while the start still reads the open chat), `coach`, `coach-recap` (what a
Recap is used by: the Recap picker's words, Coach «Recap нет» and an answer «без Recap», «Собрать Recap» from Coach,
the next answer «с Recap», «Учитывать Recap» unticked and an answer «без Recap — выключен», a Reply whose head still shows
«с Recap» ticked, the head's tick pressed and the Reply made again without it, the Recap's «в этом чате его учитывают только
Fix и Ping»), `recap`,
`review` (Coach's «Review» chip: the Review as a turn of the dialog, then a question about it), `fix`, `hi`,
`spenders`, `spenders-seen` (whether the fan read our newest message: «не
прочитано», then «прочитано» by the header and under its bubble), `spenders-seen-race` (the fan writes while the check
loads the history: the card says it instead of a mark), `newcomers`, `palette`, `fan-panel`, `pages` (popup and
settings), `fansly-dock`, `dock-widths` (the bar on narrower composers, Fansly
first), `log-download` (Hi on in a long chat, Ping off in a short one by its
gate, pressed, then «Скачать лог» in the popup; the files land in
the run's `downloads/`). On Fansly (`--site fansly`): `dock`, `reply`, `coach`, `coach-recap`, `recap`,
`review`, `pages`, `fansly-hi` (Hi after a cold load), `fansly-notes` («Заметки»: a long note, an edit after
someone else's change), `fansly-switch` (the switch from the old extension: «Включить Fansly» in the popup, the
no-direct-connection hint, the old extension's notice, its personas carried over), `fansly-ppv` (Reply's
PPV state in `hub-calls.json`), `fansly-seen` (a Spenders preview: «не прочитано», then «прочитано в …»),
`fansly-newcomers` («Новые фоловеры»: a fresh follower checked by the pass, the card, «Сгенерировать» — the same
window and card as ChatSpace's `newcomers`).

## A scenario of your own

`pnpm see --new my-check` and edit the file, or:

```ts
import { scenario } from '../kit';

scenario('my-check', async (s) => {
  await s.ready();          // the open chat's dock is ready
  await s.press(/^Reply/);  // a button of the dock's strip, by its text
  await s.done();           // the generation ended
  await s.shot('reply');    // NN-reply.png
});
```

The verbs (`packages/testing/e2e/see/kit.ts`, type `See`): `shot`, `ready`,
`press(text, where, selector)`, `done`, `see(where, text)`, `text`, `has`,
`keys`, `type`, `leaveField`, `openChat`, `toPages`/`toChat`/`page`, `rpc`,
`closeAll`, `dock`, `report`; `s.hub` is the fake hub, `s.stand` the stand,
`s.h` the e2e helpers. Options: `scenario(…, { sites, viewport, settings,
previewSend, before, hubTexts })`. Our UI lives in closed shadow roots:
Playwright or devtools DOM snapshots cannot see it — use these helpers and
`s.dock()`. The extension's UI speaks Russian, so labels are matched in
Russian (`/^Собрать полностью/`).

## What a run folder holds

PNGs; `shots.json` (captions); `report.json` — the test build's own report
(dock, timings, toasts); `diagnostics.json`; `journals.json` (when the debug
journals hold records); `hub-calls.json` — the fake hub's calls;
`violations.txt` — calls the client must never make; `console.json`;
`egress.json` — attempts to reach the network; on a failure `error.txt` and
`99-failed.png`; `wdio.log`; `index.html`.

## Live: fansly.com (`--live`)

`pnpm see <scenario> --live [--chat <n>]` and `pnpm see:session fansly --live [--chat <n>]`
run the same verbs on the real fansly.com: the test build in a headless Firefox
signed in as the agency's test model, against the fake hub (no money, no
production hub). A scenario takes ~15 s.

- **The model's sign-in** stays in a durable profile, one per worktree,
  `~/.cache/chatgoose/fansly-live/<worktree folder>` (`CG_SEE_LIVE_PROFILE`
  names another): two agents in two worktrees do not lock each other out. A signed-out run signs in with `FANSLY_TEST_MODEL_EMAIL` /
  `FANSLY_TEST_MODEL_PASSWORD`: `set -a; . ~/.config/agency/secrets.env; set +a`
  first.
- **Its chats are real fans, and nothing is blocked.** What a fan would see — a
  message sent, a post or a story published, anything with money — only after
  the owner's «да» in the chat (AGENTS.md). Opening chats, reading, uploading to
  the vault, notes, a scheduled post taken off again: free.
- **Every write of the browser's pages to Fansly** is listed as it leaves in
  `writes.json` and the `write …` lines (a read mark, «печатает», a send, a
  post, an upload, the site's telemetry). Service workers are off in that
  profile: BiDi does not see Fansly's own worker, which carries any request a
  page makes without `ngsw-bypass`. The extension's event page is out of
  WebDriver's sight too (notes, `group.create`). X8's send needs the fake hub's
  `previewSend`, which `--live` never switches on.
- **The page's own traffic, with bodies**: every XMLHttpRequest and fetch of
  the page with its request and response bodies, and its sockets' frames (in
  and out), in `s.net` during a session and `net.json` after it. Taken by a
  preload script in the page, so it survives navigations; no headers, and
  `token` / `password` fields are blanked before anything is recorded. The
  bodies are real data of the model and her fans: `.cache/` only, never into
  the repo or a PR. Example: `pnpm see:do 'return s.net.filter((r) =>
  r.url.includes("/api/v1/post"))'`.
- **`--bare`** is the same session without the extension and the fake hub:
  for studying Fansly itself (what the site sends when a person does X, which
  code runs — the scripts are `document.scripts`, the snapshot of the bundle is
  in `docs/research/fansly.md` §2). `s.press`, `s.dock` and the other verbs of
  our UI have nothing to act on there.
- **No report on the real site** (`composition/tab/probe.ts`): `s.ready()` waits
  for Reply on the dock, `s.done()` for the dock to stand still 1.5 s,
  `s.dock()` and `s.report()` are null, captions have no dock line. Read the
  pictures and `s.text(…)`.
- `--chat` opens `fansly.com/messages/<n>`, without it the list of chats. A
  chat's number never goes into the repo (`pnpm archive-check`).
- The fake hub has no archive of a live chat: Reply says «Ответ мог не учесть
  последние сообщения чата», the texts are the mockup's.

## Limits

- The stand is synthetic: layout, data and timings are our imitation of
  ChatSpace and Fansly. A break caused by a change on their side does not
  show here.
- The test build is not the release build: the stand's hosts and the
  `data-cg-spike` report exist only in the test build.
- The live site: Fansly only, with `--live` (below). ChatSpace's live checks
  stay X9's (`pnpm dev`).
- Headless Firefox only: an agent never starts a windowed Firefox from its
  shell on macOS (AGENTS.md).
- The AI texts are the mockup's lines (`SEE_AI_TEXTS` in `kit.ts`);
  `hubTexts: true` uses the fake hub's synthetic texts.
