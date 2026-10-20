# AGENTS.md — ChatGoose для ChatSpace (`chat-extension`)

Расширение Firefox (MV3): AI ChatGoose (Reply, Fix, Hi, Ping, Recap, Review, Help, Coach), Spenders,
«Новые», хоткеи и звук поверх ChatSpace (`chat.onlymonster.ai`, OnlyFans) и fansly.com.
Клиент Agency Hub (`~/code/1-platform/hub`): весь AI и данные платформ — только через хаб и вендоренный `@kernel/sdk`.

## Устройство

pnpm-монорепо, TypeScript strict, WXT, Preact.

- `apps/extension` — точки входа, манифест, корни композиции `src/composition/{background,tab,pages}.ts`, реестр сайтов `src/hosts`.
- `packages/contracts` — типы, zod-схемы, реестр ошибок CG, ключи i18n; без логики.
- `packages/core` — вся логика, без DOM, `browser.*` и `fetch`. `packages/platform` — единственный, кто трогает `browser.*`.
- `packages/hub` — фасад хаба над SDK (только фон). `packages/ui` — Preact-поверхности, данные только через `AppClient`.
- `packages/host-kit`, `host-chatspace`, `host-fansly`, `fansly-api` — машинерия страниц сайтов и их адаптеры.
- `packages/testing` — стенд, поддельный хаб, e2e; не шипится.
- `vendor/` — `@kernel/sdk`, `@chatgoose/hotkeys`: руками не править, перевендорить скриптами хаба (`scripts/vendor-*.mjs`).
- `tools/` — гейты, проверка архивов, `dev`, выпуск (`release`), e2e в CI (`ci`). `site/` — сайт расширения.

Граф пакетов держит `pnpm lint` (ESLint + dependency-cruiser): пересечь границу — вопрос дизайна, не исключение линта.
`docs/` — справка, не правила. Решения и что изменилось — в описании PR; обязательных записей в документы нет.

## Запуск и проверка

- `pnpm install --frozen-lockfile` — Node 26, pnpm 10.33.1.
- `pnpm dev` — тестовая сборка в своём профиле Firefox, пересборка на лету. Профиль владельца:
  `CG_DEV_PROFILE=~/Documents/ChatGoose/firefox-dev-profile pnpm dev --debugger-port 6111`.
- Увидеть изменение: `pnpm see <сценарий>` — см. tools/see/README.md.
- Локально — только `pnpm typecheck`, линт и `pnpm vitest run <пути>` затронутого.
- `pnpm check` (типы, линт, тесты, сборка, webext-lint, гейты, архивы) гоняет CI на PR; целиком локально не запускать.
- `pnpm e2e` — headless Firefox на стенде с поддельным хабом (~18 мин); CI гоняет его на каждом push в `main`, не на PR.
  Одна спека: из `packages/testing` `npx wdio run e2e/wdio.conf.ts --spec e2e/specs/<имя>.e2e.ts` (после `pnpm build && pnpm build:test`).
- PR — сразу готовым, `gh pr merge --auto --squash`; сливается по зелёному `pnpm check`.

## Выпуск

Свой PR слит, CI `main` на этом коммите зелёный — в чистом `main` (`git pull`): `pnpm release --dry-run`, затем
`pnpm release` (patch; `minor`, `major` или `X.Y.Z`). Одна команда: замок, проверки, сборка, подпись AMO, фид и
страницы, тег, GitHub release с заметками из коммитов. Без PR, без заметок и правок `CHANGELOG.md`. Остановился —
запустить ещё раз. Откат: `pnpm release rollback --to <версия> --confirm <версия>`. Анонс чаттерам
(`pnpm release announce`) — только по слову владельца. Подробно — `docs/release.md`.

## Опасно

- **Живой сайт — только тестовый чат владельца** (OnlyMonster 36408 → чат 518588958). Реальным фанам ничего не отправлять.
  Открытие чата в ChatSpace и наше чтение его истории помечают чат прочитанным в OnlyFans: чужие чаты не открывать,
  на живой вкладке не нажимать Alt+1–9, J, K, ⌘U (наша навигация открывает чужие чаты).
- **Расширение само не отправляет.** Только по клику человека: в открытом чате — вставка через `__omComposerBridge`
  и Send ChatSpace, из превью — через очередь отправки ChatSpace (X8). Неопределённое не повторять автоматически.
  В OnlyMonster — только чтения (страница своей сессией, `host-chatspace/src/main/om-api.ts`), своих записей нет.
- **Fansly** — Chrome DevTools MCP, только чтение: открытие разговора помечает прочитанным, ввод шлёт typing.
- **Прод хаба** (`agency-de`) — только чтение. AI, ключи и промпты живут только в хабе.
- **Анонсы чаттерам** (Telegram) — решение владельца, никогда не автоматически.

## Что экономит время

- ESLint с типами не влезает в 4 ГБ: `NODE_OPTIONS=--max-old-space-size=8192`.
- В основном чекауте лежат чужие вложенные worktree (`.claude/worktrees/*`): `eslint .` из корня линтит и их
  (тысячи ошибок). Линтить свои пути; работать в своём worktree, выпускать из чистого `main`.
- Наш UI — в закрытых shadow root: WebDriver и DevTools внутрь не видят. Тестовая сборка на стенде пишет отчёт
  в `<html data-cg-spike>`; в e2e — `packages/testing/e2e/support/ours.ts`.
- Только Firefox: Chrome годится для изучения fansly.com, но наше расширение не проверяет.
- На macOS агент не запускает Firefox с окном напрямую (бинарник, `web-ext run`): `pnpm dev` открывает его через `open`.
- Флаги решает страница: читать через `packages/core/src/domain/ops/flags.ts`, не `bootstrap.flags`.
- Поменялось правило хаба для тела AI-запроса — повторить его в `packages/testing/src/fake-hub/ai-rules.ts`.
- ID не смешивать: id аккаунта OnlyMonster, числовые id OnlyFans, `pageId` хаба; страницы — по `platform_account_id`.
- Секреты — через `op` и файлы окружения, в репо ничего. Тексты для владельца и чаттеров — по-русски.
