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
| `pnpm see <scenario\|file> [--site fansly] [--gif] [--no-build]` | rebuilds only what is stale; runs the scenario; prints the folder, the PNG paths and `index.html` (a contact sheet) | 6–10 s; +5 s test build, +1.5 s stand when changed |
| `pnpm see --new <name>` | a scenario of your own in `packages/testing/e2e/see/scratch/` (not committed) | — |
| `pnpm see:session [chatspace\|fansly]` | holds a shift open; the port is the worktree's own and is printed. An agent runs it in the background. Stops after 30 min idle (`--idle <min>`) | ~5 s to ready |
| `pnpm see:do '<js>'` | one step in the session: async JS with `s` (the verbs below) and `browser`; prints the result and the path of a picture taken after the step. Also: `--name x`, `--no-shot`, `--file f.js`, `-` (stdin), `--shot <name>`, `--status`, `--stop` | 0.3–1.5 s |
| `pnpm see:gallery` | the UI galleries (kit, dock, boards, pages) on vite with hot reload, prints their URLs; Ctrl+C stops | < 1 s |

The session's live view is `http://127.0.0.1:<port>/live` (a frame every half
second): open it for the owner in the Claude desktop browser pane. `--gif`
makes `see.gif` from the run's frames (needs `ffmpeg`).

Scenarios: `dock`, `reply`, `reply-wait` (the sheet at the click while the start still reads the open chat), `coach`, `coach-recap` (what a
Recap is used by: the Recap picker's words, Coach «Recap нет» and an answer «без Recap», «Собрать Recap» from Coach,
the next answer «с Recap», «Учитывать Recap» unticked and an answer «без Recap — выключен», a Reply «Recap выключен» under the
bar's unticked «с Recap», ticked again and a Reply «с Recap», the Recap's «его учитывают Reply, Ping и Coach»), `recap`, `review`, `fix`, `hi`,
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

## Limits

- The stand is synthetic: layout, data and timings are our imitation of
  ChatSpace and Fansly. A break caused by a change on their side does not
  show here.
- The test build is not the release build: the stand's hosts and the
  `data-cg-spike` report exist only in the test build.
- The live site is not covered; a guarded live mode (the owner's test chat
  only, no sending) is a later step.
- Headless Firefox only: an agent never starts a windowed Firefox from its
  shell on macOS (AGENTS.md).
- The AI texts are the mockup's lines (`SEE_AI_TEXTS` in `kit.ts`);
  `hubTexts: true` uses the fake hub's synthetic texts.
