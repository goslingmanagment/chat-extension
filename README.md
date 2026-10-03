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
[docs/spike-m0.md](docs/spike-m0.md). Дальше — R01 (общие интерфейсы).

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
| `pnpm lint` | ESLint (граф пакетов, запрещённые глобалы) и dependency-cruiser (граф, циклы) |
| `pnpm test` | Vitest: юнит-тесты, тест манифеста (сам собирает обе сборки), проверка вендоринга |
| `pnpm build` | выпускная сборка: `wxt zip -b firefox --mv3` → `apps/extension/.output/firefox-mv3/`, XPI и архив исходников для AMO |
| `pnpm build:test` | тестовая сборка (`CG_TEST_HOSTS=1`) → `.output/firefox-mv3-test/` |
| `pnpm webext-lint` | `web-ext lint --self-hosted` по выпускной сборке |
| `pnpm size` | бюджеты размера из architecture.md §11 (gzip) |
| `pnpm gates` | статические инварианты: нет `onlymonster.ai` вне списка, нет `innerHTML`, `browser.*` только в `platform` и точках входа, нет слов token/key/API/bearer в текстах UI, очередь отправки только из порта отправки, выпускной манифест и бандл без тестовых адресов |
| `pnpm parity` | манифест паритета (пока заглушка: появится в R01) |
| `pnpm archive-check` | в XPI и архиве исходников нет кода/шрифтов/картинок OnlyMonster, реальных id и секретов |
| `pnpm e2e` | тестовая сборка + WebdriverIO 9 и geckodriver: Firefox без окна ставит её временным дополнением и гоняет спайк M0 на локальном стенде |
| `pnpm dev` | тестовая сборка + `web-ext run` в отдельном профиле `.dev-profile/`; при изменении кода пересобирает, Firefox перезагружает дополнение |

### Тестовая сборка

`CG_TEST_HOSTS=1` собирает **другое** дополнение: имя «ChatGoose для ChatSpace
(тест)», id `chat-extension-test@gosling.agency`, без адреса обновлений. Оно
дополнительно работает на `http://127.0.0.1/*` и `http://localhost/*` (стенд и
поддельный хаб) и пишет отладочный отчёт в `<html data-cg-spike>`. В выпускной
сборке ничего этого нет — это проверяют тест манифеста и `pnpm gates`.

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
