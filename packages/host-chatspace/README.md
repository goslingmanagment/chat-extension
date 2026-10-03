# `@cg/host-chatspace` — адаптер ChatSpace (R09, часть A)

Адаптер к OnlyMonster ChatSpace: всё, что расширение знает о странице и делает с ней
(architecture.md §6.1–§6.5, §6.9, §6.10). Своих запросов к OnlyMonster нет: только память
страницы, DOM и мост ChatSpace для вставки.

## Что внутри

**`main/` — мир страницы (MAIN), без зависимостей.**

- `installMainBridge(win, { runtime?, exposeRuntimeHook? })` — «загрузчик» на
  `document_start`: запоминает нативные функции, рукопожатие, проверка конверта, повтор
  записи по id не исполняется, события не чаще 50 в секунду на тип. Сам отвечает на `probe`,
  остальное отдаёт «рантайму». 1,7 КиБ gzip, установка 0,02 мс.
- `createMainRuntime` — «рантайм»: поиск `#app.__vue_app__` (100 мс до 15 с, потом 2 с до 60 с,
  потом `CG-HOST-NOT-READY`), маршрут и эпохи, сторы через `pinia.use()` (свои не создаёт),
  кэш Colada и `$onAction`, аккаунты, окно и хвост чата (только подтверждённые сообщения с
  числовым id), фан, список чатов, активный composer, ревизия черновика из транзакций
  Tiptap, CAS-вставка в одном синхронном шаге, сверка после микрозадачи и кадра, фокус,
  `router.push` по действию человека и отложенная вставка «Открыть и вставить».
- Запросы X8 и свежести (`checkpoint`, `previewSend*`) пока отвечают `disabled` до
  исполнения — типизированное «ещё нет» для части B; `send-port.ts` и `ws-tap.ts` — её место.

**`isolated/` — изолированный мир.**

- `startChatSpaceHost({ win, redeem, drafts, … })` — одна точка запуска для корня композиции:
  менеджер монтирования и тема синхронно, мост и `HostPort` — после рукопожатия.
- `createChatSpaceHostPort` — `HostPort` из контрактов: состояние из снимка и событий MAIN,
  синхронные чтения из кэша, вставка и переход тратят `actionToken` до моста и не передают
  его в MAIN, `BRIDGE_WRITE_FAILURES` для записи, которая могла выполниться, сверка
  применённой вставки по ключу черновика цели. `checkpoint()` = `null`, `previewSend` =
  `null` до части B.
- `connectMainBridge` — клиент моста: синхронно только рукопожатие, схемы грузятся лениво
  (`validate.ts`) при первом кадре; три ступени проверки, счётчики отброшенного, тайм-ауты.
- `createMountManager` — док первым ребёнком корня рамки активного composer, строка
  «только копировать» у заблокированного фана, фиксированный оверлей без рамки, слои
  оверлеев 900/950/960, `data-dismissible-open`, реестр закрытых корней для хоткеев.
- `buildContractReport`, `createThemeReader`, `readStoredDraft`, `host-contract.ts` (все
  строки ChatSpace в одном месте; копия MAIN закреплена тестом).

## Как подключить (интегратору)

```ts
// MAIN, document_start:
installMainBridge(window, { runtime: createMainRuntime });
// изолированный мир, document_start (после removeStaleHosts):
const started = startChatSpaceHost({
  win: window,
  redeem: (r) => /* token.redeem через порт вкладки, surface по месту вызова */,
  drafts: { getItem: (key) => window.localStorage.getItem(key) },
  navInsertTimeoutMs: bootstrap.limits.navInsertTimeoutSec * 1000,
});
// UI: started.mounts.dock.root, started.mounts.overlay('modal').root …
// хоткеи: started.mounts.registry; HostPort: await started.host
```

**Решение для интегратора — размер MAIN.** Загрузчик укладывается в бюджет §11 (≤ 5 КиБ),
рантайм — ещё ~7 КиБ gzip; вместе ~8,5 КиБ. Сейчас точка входа ставит только загрузчик,
поэтому `pnpm size` зелёный, но без рантайма хост «не готов». Варианты: (1) второй
MAIN-скрипт на `document_end` с `attachMainRuntime(createMainRuntime)` (загрузчик — с
`exposeRuntimeHook: true`) и отдельной строкой бюджета; (2) всё в одном бандле на
`document_start` и новый бюджет MAIN по решению владельца. Работа на `document_start` в обоих
случаях ≤ 1 мс.

## Проверка

- Юнит-тесты (`*.test.ts`, `*.dom.test.ts`): 107, покрытие строк 96,5 %.
- e2e на стенде R02 без расширения: `packages/testing/e2e/specs/host-adapter.e2e.ts` —
  MAIN в мир страницы и изолированная часть в песочницу WebDriver BiDi через preload-скрипты
  (до скриптов страницы, как `document_start`). Итоги — `.cache/e2e/host-adapter.json`.
