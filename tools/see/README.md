# `pnpm see` — увидеть изменение своими глазами

Тестовая сборка (`CG_TEST_HOSTS=1`) ставится в headless Firefox на стенде —
синтетические ChatSpace и Fansly плюс фейковый хаб, сети нет, — сценарий
прокликивает наш UI, картинки и отчёты ложатся в
`.cache/see/<время>-<сценарий>/` (`.cache/see/latest` — последний прогон).
Это не тест и не CI: сценарии лежат вне `e2e/specs`, проверок в них нет,
сценарий падает, только если шаг нельзя сделать.

## Команды

| Команда | Что делает | Время |
|---|---|---|
| `pnpm see` | список сценариев | — |
| `pnpm see <сценарий\|файл> [--site fansly] [--gif] [--no-build]` | сборки, если исходники новее; сценарий; в конце — папка, пути PNG и `index.html` (контактный лист) | 6–10 с; +5 с тестовая сборка, +1.5 с стенд, если менялись |
| `pnpm see --new <имя>` | заготовка своего сценария в `packages/testing/e2e/see/scratch/` (не коммитится) | — |
| `pnpm see:session [chatspace\|fansly]` | держит смену открытой; порт свой у каждого worktree, печатается. Агент запускает в фоне. Сама гаснет после 30 мин простоя (`--idle <мин>`) | ~5 с до готовности |
| `pnpm see:do '<js>'` | шаг в сессии: async JS, в нём `s` (глаголы ниже) и `browser`; печатает результат и путь картинки после шага. Ещё: `--name x`, `--no-shot`, `--file f.js`, `-` (stdin), `--shot <имя>`, `--status`, `--stop` | 0.3–1.5 с |
| `pnpm see:gallery` | галереи UI (kit, dock, boards, pages) на vite с горячей перезагрузкой, печатает адреса; Ctrl+C гасит | < 1 с |

Живой вид сессии — `http://127.0.0.1:<порт>/live` (кадр каждые полсекунды):
его можно открыть владельцу в браузерной панели Claude desktop. `--gif`
собирает `see.gif` из кадров прогона (нужен `ffmpeg`).

Сценарии: `dock`, `reply`, `coach`, `recap`, `review`, `fix`, `hi`,
`spenders`, `newcomers`, `palette`, `fan-panel`, `pages` (popup и
настройки), `fansly-dock`. На Fansly (`--site fansly`) идут `dock`, `reply`,
`coach`, `recap`, `review`, `pages`.

## Свой сценарий

`pnpm see --new my-check` и поправить файл, или так:

```ts
import { scenario } from '../kit';

scenario('my-check', async (s) => {
  await s.ready();          // док открытого чата готов
  await s.press(/^Reply/);  // кнопка полосы дока по тексту
  await s.done();           // генерация закончилась
  await s.shot('reply');    // NN-reply.png
});
```

Глаголы (`packages/testing/e2e/see/kit.ts`, тип `See`): `shot`, `ready`,
`press(текст, где, селектор)`, `done`, `see(где, текст)`, `text`, `has`,
`keys`, `type`, `leaveField`, `openChat`, `toPages`/`toChat`/`page`, `rpc`,
`closeAll`, `dock`, `report`; `s.hub` — фейковый хаб, `s.stand` — стенд,
`s.h` — помощники e2e. Опции `scenario(…, { sites, viewport, settings,
previewSend, before, hubTexts })`. Наш UI в закрытых shadow root: снимки DOM
из Playwright или devtools его не видят — только эти помощники и
`s.dock()`.

## Что в папке прогона

PNG; `shots.json` (подписи); `report.json` — отчёт тестовой сборки (док,
тайминги, тосты); `diagnostics.json`; `journals.json` (если в журналах есть
записи); `hub-calls.json` — вызовы фейкового хаба; `violations.txt` — вызовы,
которых клиент делать не должен; `console.json`; `egress.json` — попытки
выйти в сеть; при падении `error.txt` и `99-failed.png`; `wdio.log`;
`index.html`.

## Ограничения

- Стенд синтетический: вёрстка, данные и тайминги — наша имитация ChatSpace и
  Fansly. Поломку от изменений на их стороне это не покажет.
- Тестовая сборка ≠ релизная: хосты стенда и отчёт `data-cg-spike` есть только
  в тестовой.
- Живой сайт не покрыт; защищённый живой режим (только тестовый чат, без
  отправки) — следующий шаг.
- Только headless Firefox: окно Firefox из шелла агента на macOS не
  запускать (AGENTS.md).
- Тексты AI — строки мокапа (`SEE_AI_TEXTS` в `kit.ts`); `hubTexts: true` —
  синтетические тексты фейкового хаба.
