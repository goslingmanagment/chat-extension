# chat-extension

Браузерное расширение ChatGoose для чаттеров: AI-ответы, правка черновика,
приветствия, пинги, рекапы, разбор чата, коучинг, доска Spenders, «Новые»,
хоткеи и звук — поверх веб-чата OnlyMonster ChatSpace (`chat.onlymonster.ai`,
OnlyFans), потом и на fansly.com.

После пилота заменяет оба нынешних клиента: десктоп для OnlyFans
(`onlyfans-chat`, Electron) и Fansly-расширение (`fansly-chat`). Пока пилот
не пройден, оба работают как раньше. Весь AI и все данные платформ идут через
Agency Hub (`hub`).

**Статус:** каркас готов (пакет работ R00) и спайк M0 пройден — итоги в
[docs/spike-m0.md](docs/spike-m0.md). Общие интерфейсы заморожены (R01,
`@cg/contracts` версии 1.0.0): что внутри — [docs/protocols/README.md](docs/protocols/README.md),
правила изменений — [docs/contracts-changelog.md](docs/contracts-changelog.md).
Дальше — волна 1.

## С чего начать

- [docs/hub-integration-plan.md](docs/hub-integration-plan.md) — план: что
  меняем в хабе, как расширение с ним работает, порядок, приёмка, решения
  владельца. §0 — требования владельца к новому клиенту.
- [docs/research/onlymonster-chatspace.md](docs/research/onlymonster-chatspace.md)
  — исследование ChatSpace: устройство, API, точки встраивания, плюсы и минусы
  против десктопа; рядом подробные отчёты и инвентаризации Fansly-расширения и
  десктопа (из них собирается чек-лист паритета).
- [docs/architecture.md](docs/architecture.md) — архитектура расширения:
  стек, пакеты, интерфейсы, работа с ChatSpace и хабом, пакеты работ для
  агентов, контракт UI-агента. Рядом [docs/parity/](docs/parity/) — чек-лист
  паритета (787 пунктов) и карта: куда уходит каждый пункт.
- [docs/decisions.md](docs/decisions.md) — журнал решений.
- [AGENTS.md](AGENTS.md) — правила для агентов.

## Для разработчика

### Что нужно

- **Node 26** (`.nvmrc`; на Mac владельца 26.7.0). Если какой-то инструмент
  перестанет работать на 26, запасной вариант — Node 24 LTS: в `package.json`
  поменять `engines.node` на `>=24`, в `.nvmrc` — `24`; спайк M0 показал, что
  сейчас это не нужно.
- **pnpm 10.33.1**, поставленный явно: `npm i -g pnpm@10.33.1` (corepack не
  используем — в Node 26 его нет). Версию закрепляет `packageManager`.
- **Firefox 142+** (проверено на 157). Для e2e нужен доступ в интернет один раз:
  WebdriverIO сам скачивает geckodriver. Путь к Firefox можно задать
  переменной `FIREFOX_BIN`.

```sh
pnpm install --frozen-lockfile
```

### Команды

| Команда | Что делает |
|---|---|
| `pnpm check` | всё, что должно быть зелёным перед коммитом, по порядку и до первой ошибки: `typecheck` → `lint` → `test` → `build` → `webext-lint` → `size` → `gates` → `parity` → `archive-check` |
| `pnpm typecheck` | `tsc -b` по всем пакетам (project references) |
| `pnpm lint` | ESLint (граф пакетов, запрещённые глобалы) и dependency-cruiser (граф, циклы, достижимость: `hub` и SDK не достижимы ни из одной точки входа, кроме фона) |
| `pnpm test` | Vitest: юнит-тесты, тест манифеста (сам собирает обе сборки), проверка вендоринга |
| `pnpm build` | выпускная сборка: `wxt zip -b firefox --mv3` (из корня репозитория) → `apps/extension/.output/firefox-mv3/`, XPI и архив исходников для AMO; архивы прошлых версий удаляет |
| `pnpm build:test` | тестовая сборка (`CG_TEST_HOSTS=1`) → `.output/firefox-mv3-test/` |
| `pnpm webext-lint` | `web-ext lint --self-hosted` по выпускной сборке |
| `pnpm size` | бюджеты размера из architecture.md §11 (gzip) |
| `pnpm gates` | статические инварианты: нет `onlymonster.ai` вне списка (строки, шаблоны, регулярки), нет `innerHTML`, `browser.*` только в `platform`, нет слов token/key/API/bearer в текстах UI, очередь отправки только из порта отправки, выпускной манифест и бандл без тестовых адресов, код SDK только в `background.js` (маркеры — имя класса ошибки, заголовки `x-kernel-*`, пути API хаба, хеш контракта — берутся из `vendor/kernel-sdk` при запуске), мост MAIN и тап без API расширения и zod |
| `pnpm parity` | манифест паритета `docs/parity/parity-manifest.json`: у каждой строки владелец и проверка, у строк «не нужно» / «убрано владельцем» — отрицательная проверка из реестра исключений; манифест должен совпадать с выводом из карты (`node tools/parity/generate.ts`). Контракты заморожены (версия `1.0.0`), поэтому без манифеста — ошибка |
| `pnpm archive-check` | архивы последней сборки (по версии в её манифесте): XPI совпадает с папкой сборки байт в байт; в XPI и архиве исходников нет кода/шрифтов/картинок OnlyMonster, реальных id (сверка по sha256) и секретов |
| `pnpm e2e` | обе сборки + WebdriverIO 9 и geckodriver: Firefox без окна ставит выпускной XPI (id, popup, ответ фона) и тестовую сборку (спайк M0 на локальном стенде) временными дополнениями |
| `pnpm sign:dry-run` | настоящий `web-ext sign --channel unlisted` против локального макета AMO на 127.0.0.1 (без ключей, ничего не подписывает) — проверка, что подпись работает на этой Node |
| `pnpm dev` | тестовая сборка + `web-ext run` в отдельном профиле `.dev-profile/`; при изменении кода пересобирает, Firefox перезагружает дополнение |

### Тестовая сборка

`CG_TEST_HOSTS=1` собирает **другое** дополнение: имя «ChatGoose для ChatSpace
(тест)», id `chat-extension-test@gosling.agency`, без адреса обновлений. Оно
дополнительно работает на `http://127.0.0.1/*` и `http://localhost/*` (стенд и
поддельный хаб), пишет отладочный отчёт в `<html data-cg-spike>` и ставит
метки времени в начало и конец изолированного скрипта (замер раннего старта).
В выпускной сборке ничего этого нет — это проверяют тест манифеста и
`pnpm gates`.

### Живые проверки (X9)

Только Firefox, только профиль `.dev-profile/` из `pnpm dev`, только тестовый
чат владельца (какой — в решении X9, `docs/decisions.md`). Чужие чаты не
открывать: открытие помечает чат прочитанным в OnlyFans. Номера реальных чатов
в код и в README не пишем — `pnpm archive-check` их ловит.

### Вендоринг

`vendor/kernel-sdk` и `vendor/chatgoose-hotkeys` руками не правим: их
генерируют скрипты хаба `scripts/vendor-sdk.mjs` и `scripts/vendor-hotkeys.mjs`
из того коммита хаба, что работает в проде. После перевендоринга обновить
`tests/vendor-pins.json` тем же коммитом.
