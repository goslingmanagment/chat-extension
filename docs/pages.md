# Страницы расширения (пакет работ R16)

Popup, страница настроек с восемью разделами и экраном входа, страница промпта и
страница журналов. Что они показывают и как выглядят — `architecture.md` §9.9,
§9.3–§9.6, §8.2 и `ui-design.md` §3.10, §4.23, §4.24, §10. Здесь — где что лежит, что
подключает интегратор и чего страницы ждут от фона.

Страница ничего не знает о хабе и о ChatSpace напрямую: всё идёт запросами к фону
(`TAB_REQUESTS`, отправитель `page`). Тексты переписки, черновики, промпты и секреты
страницы не логируют; промпт виден только на `debug-prompt.html` и только в режиме
отладки.

## Где что лежит

| Слой | Путь | Что там |
|---|---|---|
| контроллеры | `packages/core/src/application/pages` (`@cg/core/application/pages`) | `createPagesClient(env, ports)` — `AppClient` страницы: модели `PopupVM`, `OptionsVM`, `DebugPromptVM`, `JournalVM` и исполнение `UiAction` |
| вид | `packages/ui/src/pages` (`@cg/ui/pages`) | `mountPopup`, `mountOptions`, `mountDebugPrompt`, `mountDebugJournal`; стили `pg-*` поверх `ui/kit` |
| стенд | `packages/testing/src/pages` | сценарный фон `FakePageBackground`, мир `pagesWorld`, тесты контроллеров и вёрстки, галерея страниц |
| e2e | `packages/testing/e2e/specs/pages-gallery.e2e.ts` | страницы в headless Firefox, снимки в `.cache/e2e/pages-*.png` |

Внутри контроллеров:

- `client.ts` — сам клиент: чтения, подписки, исполнение действий, правила §8.2
  и §9.4.
- `settings-writer.ts` — автосохранение: поле ждёт 300 мс после последней правки,
  переключатель пишется сразу, в полёте один запрос; «Сохранено ✓» — только с
  ревизией из ответа фона; отказ — «Не сохранено» и «Повторить» (повтор только по
  клику); на `pagehide` несохранённое уходит сразу, без гарантии.
- `route.ts` — адреса `options.html#<раздел>` и `#<раздел>:<КОД>`; мусор открывает
  «Статус», код без раздела — раздел из реестра ошибок.
- `view-*.ts` — чистые функции «что известно → модель вида». Неизвестное — «неизвестно»,
  не ноль и не догадка.
- `hotkeys.ts` — справочник клавиш из вендоренной схемы `@chatgoose/hotkeys`.
- `ports.ts` — что страница берёт у браузера. Формы портов совпадают с адаптерами
  `@cg/platform`.

## Что подключает интегратор

`apps/extension/src/composition/pages.ts` пока рисует заглушку. Замена — собрать
порты и вызвать функцию монтирования. Рабочий образец той же сборки на сценарном
фоне — `packages/testing/src/pages/world.ts` и `gallery/main.tsx`.

```ts
const i18n = createI18n({ language, now: Date.now });           // @cg/core/domain/i18n
const systemScheme = mediaSchemeSignal(window);                 // @cg/ui/kit
const client = createPagesClient(
  { page, version, hotkeyPlatform, hostOrigin, links, systemLanguages: () => navigator.languages },
  { rpc, clock, timers, permissions, consent, window: pageWindow, pages, openLink, download, clipboard, systemScheme, language: i18n },
);
client.start();
mountOptions(root, { client, i18n, catalog, clipboard, theme: client.theme, systemScheme, hints: client.hints, location: client.location, helpUrl });
```

| Порт | Чем закрыть |
|---|---|
| `rpc` | `createPageRpcClient` из `@cg/platform`: `request(type, payload, { timeoutMs })` и `onEvent` |
| `permissions`, `consent` | `createHostPermissions`, `createConsent`. Запрос доступа и согласия — только внутри клика: контроллер вызывает их до первого `await` |
| `pages` | `createExtensionPages`: открытая вкладка настроек переиспользуется (ST-006) |
| `download` | `downloadFile` (Blob и `<a download>`, §9.2) |
| `clipboard` | `writeClipboardText` |
| `window` | `location.hash`, события `hashchange`, `focus` / `visibilitychange`, `pagehide`; у popup ещё `close` |
| `openLink` | новая вкладка, только `https://` |
| `env.hostOrigin` | адрес ChatSpace из `apps/extension/src/hosts.ts` |
| `env.links` | адреса «Что нового» и «История версий» на сайте выпуска (R19); `null` прячет ссылку |
| `catalog` | каталог действий R17: его подписи клавиш и отметки доставки важнее схемы |

Функции монтирования:

- `mountPopup(root, deps)` — `popup.html`, 360 px.
- `mountOptions(root, { ...deps, location: client.location, helpUrl })` —
  `options.html`; без входа любой адрес рисует экран входа.
- `mountDebugPrompt(root, { ...deps, token })` — `token` из `?t=…`; на странице и в
  логах его нет.
- `mountDebugJournal(root, { ...deps, journal: journalOfHash(location.hash) })`.

Каждая возвращает `Unmount`. `deps.report` получает сбои отрисовки и действий — класс
и код, без текста.

## Чего страницы ждут от фона

Добавочные изменения контрактов 1.2.0 (`docs/contracts-changelog.md`). Страницы
работают и без них, но хуже:

| Что | Кто исполняет | Без этого |
|---|---|---|
| запрос `tab.command` | фон (R10) выводит вкладку ChatSpace вперёд, вкладка (R11) открывает Spenders, «Новых», шпаргалку или переходит к аккаунту | кнопки popup и «К вкладке» отвечают ошибкой с кодом |
| запрос `data.clear` | фон чистит кэши и журналы, вход и настройки не трогает | «Очистить локальные данные» отвечает ошибкой |
| `diagnostics.get` → `footprint` | фон считает размер кэшей и журналов | размер журнала берётся из `logs.bytes`, кэши — «неизвестно» |
| `diagnostics.get` → `extension.updated` | фон запоминает `runtime.onInstalled` (`update`, прежняя версия) и считает вкладки на старых скриптах (UP-009) | строка «Расширение» показывает только версию |

## Что страница знает не всё

- **Имя фана.** Протокол не отдаёт страницам имён фанов: popup и строка «Идут
  сейчас» показывают «фан <номер>». Макет рисует имя — оно появится, когда фон
  начнёт отдавать подпись чата.
- **«Открыт диалог» в popup** — чат первой вкладки ChatSpace, у которой он есть:
  какая вкладка активна, страница не знает.
- **Дата входа устройства и последнее сохранение досье** — «неизвестно»: фон их
  страницам не отдаёт.
- **«AI сегодня $»** — только в режиме отладки и только из ответа хаба (`usage.get`);
  своего подсчёта в браузере нет.
- **Отзыв согласия на замеры** — в настройках Firefox: действия для отзыва в
  `UiAction` нет, страница показывает состояние и кнопку «Разрешить».

## Проверки

- `packages/core/src/application/pages/*.test.ts` — автосохранение, адреса, клавиши.
- `packages/testing/src/pages/controller.test.ts` — контроллеры на сценарном фоне;
  фон проверяет каждый запрос и ответ схемой протокола и правом страницы на него.
- `packages/testing/src/pages/pages.test.tsx` — что нарисовано и что уходит по клику.
- `pages-gallery.e2e.ts` — headless Firefox: обе темы, оба языка, 1440, 1280, 820 и
  320 px, масштаб 200 %; ничего не торчит вбок; адреса и колесо над числом в
  настоящем окне. Снимки `pages-popup-20a|20b-*`, `pages-options-21a|21b-*`
  сверяются глазами с `final-20a/20b/21a/21b`.

Тесты названы по строкам паритета: `[PU-001]`, `[ST-014]`, `[DB-007]`.
