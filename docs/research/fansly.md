# Fansly: входная точка для разработки обоих расширений

Для `chat-extension` и `fansly-chat`. Проверено 2026-10-13 по Москве.
Здесь — способ смотреть настоящий сайт, карта собранных материалов и особенности чата,
которые влияют на интеграцию. Требования R20 остаются в
[Project Unite](../project-unite/README.md), подробные факты о сайте — в
[fansly-web.md](../project-unite/fansly-web.md). Этот документ — общий указатель;
в `fansly-chat` находится [карта его исходников](https://github.com/goslingmanagment/fansly-chat/blob/main/docs/fansly-development.md).

## 1. Браузер: Chrome DevTools MCP по умолчанию

Для Fansly агент сам выбирает **`chrome-devtools` / `mcp__chrome-devtools__*`**.
Claude in Chrome для этой работы не используется: у него есть ограничение на сайты
для взрослых ([официальные ограничения](https://code.claude.com/docs/en/chrome)).
Техническое исследование страницы через DevTools проверено отдельно: Claude Code
2.1.296 с Opus 5.5 прочитал DOM, консоль и сеть, открыл `/messages` в своей вкладке,
получил статический JS с HTTP 200 и закрыл свою вкладку. Отказов инструмента/модели
в этих двух проверках не было. Это результат проверки, а не гарантия любого будущего действия.

На Mac владельца MCP добавлен в **user scope**, поэтому доступен из обоих репозиториев
и их worktree. Проверенная конфигурация: `chrome-devtools-mcp@1.10.1`, Chrome 154,
`--autoConnect`, `--no-usage-statistics`, `--no-performance-crux`,
`--redact-network-headers`. Команда — `/Users/dmitriy/.local/bin/npx`.

Проверка конфигурации:

```sh
claude mcp get chrome-devtools
```

Если записи ещё нет, добавить **один раз** (существующую не дублировать и не затирать):

```sh
claude mcp add --scope user chrome-devtools -- npx --yes chrome-devtools-mcp@1.10.1 \
  --autoConnect --no-usage-statistics --no-performance-crux --redact-network-headers
```

На машине владельца при проблеме с PATH использовать абсолютный путь `npx` выше.
На другой машине путь и доступную версию Chrome проверить заново.
Сверка аргументов и обновление версии — по
[README ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp),
а не заменой закреплённой версии на `latest` без проверки.

Порядок обычной работы:

1. В новой сессии Claude проверить `/mcp`, вызвать `list_pages`, найти нужную вкладку
   `https://fansly.com/messages/...` по текущему списку. Не сохранять `pageId` между сессиями.
   В актуальном MCP передавать её `pageId`; если версия требует выбора страницы, сначала
   `select_page` по её схеме. При нескольких подходящих вкладках уточнить цель по задаче.
2. Для DOM/стилей выполнить узкий `evaluate_script`, для ошибок — `list_console_messages`,
   для сети — `list_network_requests` и только нужный `get_network_request`.
   Для обычного осмотра оставить открытый диалог, черновик, фокус и прокрутку как есть.
   Полный снимок доступности, `innerText`, `innerHTML` или HAR могут содержать переписку:
   в репозиторий они не нужны. Готовый обезличенный пробник — в §3.
3. Сетевой журнал начинает наблюдение после подключения. Пустой список у давно открытой
   страницы не доказывает отсутствия запросов. Если задача требует загрузку страницы,
   можно открыть собственную `/messages`, не выбирать фана и закрыть только свою вкладку;
   не перезагружать рабочий чат ради получения журнала. Если наблюдаешь 401/403, challenge
   или logout, зафиксировать состояние и остановить сетевую проверку, не повторять запросы.
4. `Connected` в `claude mcp get` подтверждает запуск MCP, но ещё не доступ к браузеру.
   Доказательство подключения — успешный `list_pages` и чтение целевой страницы.
   Если сессия Claude началась до установки MCP, начать новую сессию / переподключить
   сервер через `/mcp`. Если Chrome просит разрешение, владелец сам включает
   `chrome://inspect/#remote-debugging` → **Allow remote debugging** и подтверждает
   нативный запрос **Allow**. На этой машине он уже включил отладку 2026-10-13.
   Не обходить отказ инструмента другим транспортом; при недоступном браузере работать
   с локальным бандлом и назвать точную ошибку, а не объявлять весь Fansly недоступным.

Само расширение на настоящем fansly.com агент видит без чужого браузера: `pnpm see … --live`
(тестовая сборка в Firefox без окна, тестовая модель агентства, подставной хаб; ничего не блокируется,
записи страницы в Fansly пишутся в `writes.json`; отправка, публикация и деньги — только с «да» владельца) — [tools/see/README.md](../../tools/see/README.md#live-fanslycom---live).

Чтение уже открытой страницы для разработки разрешено запросом владельца (X38 / E162).
Отправка сообщения, изменение заметки/аккаунта, загрузка файла, ввод в composer — действия
с живой сессией, которые должны входить в задачу владельца. Даже переход в другой чат
может вызвать `POST /message/ack`, а ввод — событие «печатает». Подключение MCP само по
себе эти действия не разрешает. Проверка страницы в Chrome также не доказывает работу
Firefox MV3, isolated/MAIN bridge, выдачи прав или сборки расширения: для них остаются
свои локальные проверки, стенд и пилот. X38 уточняет старое ограничение X34 только для
чтения сайта; отменённые повторные smoke владельца не возвращаются.

## 2. Бандл и все собранные материалы

Большие снимки и чужой код лежат **вне Git**. Пути ниже — локальные на Mac владельца;
они открываются с диска, а не через GitHub. На другой машине сначала найти/перенести
нужный снимок и сверить манифест/хеши. Отсутствие локальной папки не означает отсутствия
исследования. Не копировать в Git бандл, сырой HAR, авторизацию или данные фанов.

| Материал | Где и зачем |
|---|---|
| **Основной бандл сайта, 2026-10-12** | [README снимка](/Users/dmitriy/Documents/Codex/fansly-web-bundle-2026-10-12/README.md), корень `/Users/dmitriy/Documents/Codex/fansly-web-bundle-2026-10-12/`. Начинать здесь: `raw/`, `pretty/`, `index/`, `live/`, `manifest.json`, `SHA256SUMS`, скрипты сбора |
| **Свежий снимок одной командой** | `pnpm fansly:bundle`: текущий код сайта по `ngsw.json` (каждый файл сверен с его SHA-1), разложенный для чтения, в `~/Documents/Codex/fansly-web-bundle-<дата>/`. `index/endpoints.json` — все вызовы API в коде, `CHANGES.md` — что изменилось с прошлого снимка (вызовы API, файлы). `diff/` шумный: имена переменных меняются в каждой сборке, главный сигнал — вызовы API. Ничего не пишет, если код сайта не менялся |
| Подробное исследование чата S2 | [s2-fansly-page.md](/Users/dmitriy/Documents/Codex/r20-detail-2026-10-12/research/s2-fansly-page.md): Angular, lifecycle, API, сокет, CSS, вложения; первичные ссылки на строки бандла |
| Остальные исследования R20 | `/Users/dmitriy/Documents/Codex/r20-detail-2026-10-12/research/`: `s1a-extension-contracts-host.md`, `s1b-extension-core-ui-testing.md`, `s3-old-extension.md`, `s4-hub.md`, `s5-fbuddy.md`, `s6-firefox.md`. Контракты нового клиента, старый клиент, хаб, соседнее расширение и Firefox |
| Сведённая справка сайта | [fansly-web.md](../project-unite/fansly-web.md) — проверенные факты S2, сеть, сокет, встраивание, замеры; [спецификация](../project-unite/spec.md), [архитектура](../project-unite/architecture.md), [план R20](../project-unite/plan.md) — требования и порядок реализации |
| Выкладка поста, живой захват 2026-10-24 | [2026-10-24-fansly-post-flow.md](/Users/dmitriy/code/8-docs/2026-10-24-fansly-post-flow.md): загрузка медиа (`mediav2` → S3 → `complete` → опрос), `POST /account/media` с правами доступа, тело `POST /post`, отложенный пост и его отмена |
| Технический снимок открытого Chrome, 2026-10-13 | [JSON](fansly/chat-dom-2026-10-13.json) и [пробник](fansly/chat-dom-probe.js.txt); метод и границы в §3 |
| Предыдущий бандл, 2026-10-08 | [README хаба](/Users/dmitriy/code/1-platform/hub/artifacts/fansly-app-bundle-2026-10-08/README.md). `raw/` и `analysis/*.pretty.js`; полезен для сравнения сборок. Нумерация строк этого форматирования отличается от `pretty/` снимка 12 октября |
| API, контракты и примеры хаба | [fansly_api_spec.md](/Users/dmitriy/code/1-platform/hub/reference/fansly_api_spec.md), [types.ts](/Users/dmitriy/code/1-platform/hub/packages/fansly/src/types.ts), [response-contracts.ts](/Users/dmitriy/code/1-platform/hub/packages/fansly/src/response-contracts.ts), `hub/tests/fixtures/fansly/messaging_groups*.json`. Проверять текущий код, а не предполагать полное покрытие API по старому справочнику |
| DM и WebSocket хаба | [fansly-ws-protocol-check.md](/Users/dmitriy/code/1-platform/hub/docs/runbooks/fansly-ws-protocol-check.md), [fansly-ws-continuity.md](/Users/dmitriy/code/1-platform/hub/docs/runbooks/fansly-ws-continuity.md), [fansly-dm-head-catchup.md](/Users/dmitriy/code/1-platform/hub/docs/runbooks/fansly-dm-head-catchup.md), [fansly-dm-reply-repair.md](/Users/dmitriy/code/1-platform/hub/docs/runbooks/fansly-dm-reply-repair.md): различать архив/догонялку и живые данные вкладки |
| Старый Fansly-клиент | [Карта для разработки](https://github.com/goslingmanagment/fansly-chat/blob/main/docs/fansly-development.md), локально `/Users/dmitriy/code/1-platform/fansly-chat/`; код работающих способов вставки, звука, заметок, войса, vault и relay |
| FBuddy: совместимость и исследование | [FBUDDY_OVERVIEW.md](/Users/dmitriy/code/1-platform/fbuddy-analysis/docs/FBUDDY_OVERVIEW.md), [FBUDDY_API_AND_DATA_SURFACE.md](/Users/dmitriy/code/1-platform/fbuddy-analysis/docs/FBUDDY_API_AND_DATA_SURFACE.md), [FBUDDY_FANSLY_API_ENDPOINTS.md](/Users/dmitriy/code/1-platform/fbuddy-analysis/docs/FBUDDY_FANSLY_API_ENDPOINTS.md), [layout/README.md](/Users/dmitriy/code/1-platform/fbuddy-analysis/layout/README.md); `docs/FBUDDY_CLEAN_ROOM_IMPLEMENTATION_SPEC.md` — собственная реализация по наблюдаемым контрактам, чужой код не переносить |
| FYP, медиа, загрузки и статистика | [fansly-fyp/docs/README.md](/Users/dmitriy/code/3-traffic/fansly-fyp/docs/README.md), [fansly-stats-ui.md](/Users/dmitriy/code/3-traffic/fansly-fyp/product/fansly-stats-ui.md), [FBuddy FYP_MEDIA_STATS_ENDPOINTS.md](/Users/dmitriy/code/1-platform/fbuddy-analysis/docs/FBUDDY_FYP_MEDIA_STATS_ENDPOINTS.md). Для задач вне DM начинать с этих указателей |
| Сырые материалы исследования статистики, 2026-10-08 | `/Users/dmitriy/Documents/Codex/fansly-new-stats-2026-10-08/`: `bundles/`, `network/`, `screenshots/`. Приватные исходные данные: не коммитить и не открывать весь сетевой архив без нужды |
| Исследование квот и транспорта | [research-fansly-quota-live-test.md](/Users/dmitriy/code/8-docs/2026-10-01-hub-sync-engine/impl/research-fansly-quota-live-test.md). Исторические измерения, не гарантия лимита провайдера и не разрешение нагрузочных повторов |

### Дополнительно в `~/code/8-docs` и архиве

Общая раскладка проектов — [INDEX.md](/Users/dmitriy/code/INDEX.md), правила общих
документов — [8-docs/README.md](/Users/dmitriy/code/8-docs/README.md). Там размещён
[указатель на этот справочник](/Users/dmitriy/code/8-docs/2026-10-13-fansly-development.md).
Сами документы остаются в своих папках; этот справочник хранится в Git `chat-extension`,
`fansly-chat` ссылается на него. Он доступен и без локального `8-docs`.

| Материал | Где и статус |
|---|---|
| Дополнительный разбор HTTP-поверхности бандла | [fansly-bundle-notes.md](/Users/dmitriy/code/8-docs/2026-10-10-hub-project-browser/stage1/fansly-bundle-notes.md), рядом `fansly-bundle-reads.txt` / `fansly-bundle-writes.txt`. Хосты и статически найденные GET/записи, включая read receipts и typing; не доказательство, что все эти маршруты вызывались |
| Новая статистика создателя: карта 13 маршрутов и полей | [Снимок, слитый в hub #494](https://github.com/goslingmanagment/hub/tree/65dcecfff3d94694e51843440936795accb41bb7/reference/fansly-creator-stats). В текущем локальном checkout хаба 2026-10-13 этого каталога нет, поэтому ссылка закреплена на merge commit. Проверять актуальный код отдельно |
| Сбор новой статистики в хаб | [plan.md](/Users/dmitriy/code/8-docs/2026-10-09-hub-fansly-stats-collection/plan.md). План от 9 октября; его упоминания состояния прода — исторические |
| План измерения квот новой статистики | [plan.md](/Users/dmitriy/code/8-docs/2026-10-09-fansly-stats-quota/plan.md). План сам по себе не результат измерения; HTTP 200 в сохранённых ответах не доказывает лимит |
| Выводы о FYP из бандла и данных | [findings.md](/Users/dmitriy/code/8-docs/2026-10-09-fansly-algorithm-hints/findings.md), рядом `reports/{feed,signals,creator,texts}.md`. Исследование 9 октября, выводы/наблюдения отделены от неизвестной серверной формулы |
| Пейсинг и API FBuddy | [research-fbuddy-bundle-pacing.md](/Users/dmitriy/code/8-docs/2026-10-01-hub-sync-engine/impl/research-fbuddy-bundle-pacing.md), [research-fbuddy-endpoint-rates.md](/Users/dmitriy/code/8-docs/2026-10-01-hub-sync-engine/impl/research-fbuddy-endpoint-rates.md). Дополнение к S5, не разрешение воспроизводить нагрузку |
| Старая карта API/сокета и FBuddy | [openapi.yaml](/Users/dmitriy/code/9-archive/fansly_api_reverse/openapi.yaml), [websocket_asyncapi.yaml](/Users/dmitriy/code/9-archive/fansly_api_reverse/websocket_asyncapi.yaml), [docs/README.md](/Users/dmitriy/code/9-archive/fansly_api_reverse/docs/README.md). Архив: полезен для поиска названий/истории, актуальность маршрутов и схем требует проверки |

### Состав основного бандла

По его манифесту: 32 исходных файла (около 19,4 МБ), 28 форматированных
(около 22,4 МБ), 24 индексных файла; найдены 434 Angular-компонента и 136 маршрутов.
Скачаны файлы оболочки/манифеста и чанки, а не сервер Fansly или база данных.
2026-10-13 локально перепроверены все 98 записей `SHA256SUMS`, расхождений нет.
`pretty/` — отформатированный скомпилированный JS; исходные TypeScript и имена до
минификации не восстановлены. Доступных source maps сборщик не получил — подробности
в `index/source-maps.json`. `raw/` читать как данные, не исполнять.

Для задачи про чат не читать огромный `main` целиком. Внутри корня снимка:

| Начать с | Что даёт |
|---|---|
| `index/chat-structure.md`, `index/chat-components.json` | компоненты разговора и поля, позиции в форматированном JS |
| `index/selectors.json`, `index/angular-css.md`, `index/styles.json` | якоря, компонентные стили, темы |
| `index/routes.md`, `index/routes.json` | маршруты и дерево экранов |
| `index/websocket.md`, `index/websocket-sites.json`, `index/websocket-proto.json` | сокет и его потребители |
| `index/event-definitions.json`, `index/event-handlers.json` | определения и обработчики событий |
| `index/workers.md`, `index/source-maps.json`, `index/build-diff.json` | workers, результат поиска карт исходников, сравнение сборок |
| `index/verification.json`, `index/parser-validation.json` | что и как проверял сборщик индекса |
| `live/dom-skeleton.json` | обезличенная структура первого живого чата |
| `live-coordinator/README.md`, `live-coordinator/measure-2026-10-12-firefox157.json` | отдельный 60-секундный замер Firefox 157 со старым ChatGoose и FBuddy |

`live/idle-60s.json` имеет статус `not_collected`: это **не** 60-секундный замер.
Рабочий замер — только в `live-coordinator/`. Не смешивать эти два артефакта.
Для поиска использовать `rg` по нужным индексам, затем небольшой диапазон строк
`pretty/main.2e6b96097a4bb73b.js`, на который указывает индекс/S2.

## 3. Что видно в открытом чате сейчас

[Снимок 2026-10-13](fansly/chat-dom-2026-10-13.json) снят через Chrome DevTools MCP
с уже открытого `/messages/:id`, без переходов, кликов, ввода, прокрутки и перезагрузки.
Пробник сохраняет только перечисленные технические поля: типы узлов, числа, размеры,
состояния CSS, версию Angular и имена JS/CSS сборки. Текст сообщений, содержимое поля,
имена, реальные id, cookies, storage, медиа и тела API не считываются.

Chrome 154, Angular 19.1.2, светлая тема, viewport 1728×936, DPR 2.
Объявленные в DOM `main.2e6b96097a4bb73b.js`, `runtime.f973459b9af62fd8.js`,
`styles.64c4f4d153577daa.css`, `polyfills.dfb9993ca3a1ba5d.js`,
`scripts.32f933722bcf11de.js` совпадают **по именам** со снимком 12 октября;
байты в этой проверке не сравнивались.

| Якорь | Назначение | Размер в этом состоянии |
|---|---|---|
| `app-messages-route` | весь экран сообщений | 1120×868 |
| `.messages-list-wrapper` | список диалогов | 498×868 |
| `app-messages-conversation-route` | основной разговор, область поиска его якорей | 622×868 |
| `.message-content-header` | внешняя шапка | 622×56 |
| `.message-content-header-contact .content-header-sub-row` | строка контакта, рядом с которой монтируются функции | 148×14 |
| `app-group-message-container` | лента вместе с полем | 622×812 |
| `.message-content-list` | прокручиваемая лента (`overflow-y: auto`) | 622×743 |
| `app-group-message-input` | composer | 622×69 |
| `textarea.message-input` | редактируемое поле | 285×22 |
| `.send-button` | кнопка отправки, только наблюдение | 44×44 |

Это один viewport и одно состояние, не нормативные размеры. Пробник считает селекторы
по всему документу как инвентаризацию; **рабочие локаторы расширения ограничивать основным
разговором**. Число `app-group-message` включает потенциальные вложенные цитаты и не
подтверждает полноту истории. `hasOwnVisibleBox` — только собственный прямоугольник и CSS
узла; он не проверяет скрытого предка, перекрытие или возможность кликнуть. По наличию
`.modal-wrapper` нельзя заключать, что пользователь видит открытую модалку.

Маркеры старого ChatGoose (`#chatgoose-root`, `#chatgoose-followers-launcher` и два
`style#chatgoose-*`) здесь не найдены. Это наблюдение об этой Chrome-вкладке, а не
диагноз Firefox-установки и не доказательство отсутствия других расширений.

Повторение: передать содержимое [chat-dom-probe.js.txt](fansly/chat-dom-probe.js.txt)
как `function` в `evaluate_script` для выбранной уже открытой вкладки. Пробник отказывает
на другом origin/маршруте и маскирует маршрут константой `/messages/:id`.
Сохранять новый результат отдельным датированным JSON; старый не перезаписывать.
Перед коммитом проверить состав полей и ограничения, даже если сбор автоматический.

## 4. Что особенно важно при работе с чатами

Следующие факты — из [исследования бандла и предыдущих замеров](../project-unite/fansly-web.md),
а не результаты интерактивного теста сегодняшней Chrome-вкладки.

- **Lifecycle.** `app-messages-conversation-route` переиспользуется. При смене группы
  Fansly пересоздаёт контейнер, composer и контактную часть шапки; галерея может убрать
  шапку/контейнер без смены URL. Одного `route-watcher` и однажды найденного textarea
  недостаточно: освобождать старые ссылки, повторно находить якоря, сверять текущий чат
  перед вставкой. Не полагаться на сгенерированные Angular-классы/атрибуты.
- **Модель поля.** Angular `ngModel` — источник отправки; присвоение `.value` само по себе
  недостаточно. Восстановление сохранённого черновика может обойти `input`-событие;
  `execCommand`/ввод могут обновить черновик и отправить typing. Enter может отправить
  сообщение. Проверка DOM не должна превращаться в пробную отправку или ввод.
- **Несколько полей.** Мини-чаты, галерея, модалка нового сообщения и редакторы имеют
  похожие якоря. Искать composer/шапку внутри основного `app-messages-conversation-route`,
  учитывать исчезновение и несколько кандидатов. `document.querySelector('textarea')`
  не является надёжным локатором интеграции.
- **Полнота истории.** Инбокс виртуализирован, лента содержит цитаты с вложенными
  `app-group-message`. DOM-число не равно числу сообщений/контактов. У расширения должны
  быть явные источник, покрытие, пробелы и сверка свежего хвоста; идентификатор группы
  и идентификатор фана различать и хранить строками. Правило X4/R20 — свежие данные
  страницы плюс архив хаба, без молчаливой потери хвостов.
- **HTTP.** Этот Angular-клиент использует XHR, JSON приходит текстом; запросы содержат
  `ngsw-bypass`. Наблюдение только за `fetch` пропустит их. Свежий хвост не обязательно
  перечитывается каждым фокусом: см. условия в `fansly-web.md`. Открытие чата может
  отметить сообщения прочитанными через `/message/ack`.
- **WebSocket.** `wss://wsv3.fansly.com?v=3`; вложенные JSON-конверты `{t,d}`. Для сервисных
  событий важны `t=10000` и возможный batch `10001`; message `5/1`, delete `5/10`,
  read receipt `4/2`, typing `5/22`. Полную схему и трактовку брать из S2/индекса и кода,
  не из этой краткой памятки. Кадр `t=1` содержит session token — не сохранять сырые кадры.
- **Вложения и войс.** Передача файла в input открывает модалку; это ещё не прикрепление.
  Подтверждение после действия человека — `app-account-media-create-template` в
  `.message-attachments` основного поля и закрытая модалка. Старый селектор waveform
  отсутствует в исследованной сборке: не переносить его как проверенный способ.
- **FBuddy.** Он влияет на XHR, ввод и CSS (`#fb-fansly-style-fixes`, в том числе
  `contain: size`). Разделять Fansly, наше расширение и соседа при разборе размеров,
  мутаций и производительности. Подробности — S5 и FS-CO-*; стенд с соседом обязателен
  для затрагивающих его изменений (сосед стенда — `packages/testing/src/fake-fansly/neighbor/`,
  P6d). Chrome-снимок не подтверждает наличие FBuddy.

## 5. Как поддерживать справочник

Для задачи сначала выбрать из §2 первичный материал и прочитать текущий код клиента.
При расхождении не исправлять поведение по старому снимку вслепую: проверить нужный
узел/запрос живой страницы через MCP и записать, что доказано, а что остаётся гипотезой.

Новый снимок сопровождается датой, браузером, viewport, именами файлов сборки, методом
и ограничениями. Если изменились файлы сборки, обновить отдельную папку бандла с
манифестом и хешами, затем соответствующие ссылки на строки и индекс. Совпадение имён
не заменяет сравнение хешей. Локальное исследование привязывать к версии клиента/commit;
исторический замер не выдавать за результат нынешнего кода.

Новая сборка Fansly (новый хеш `main.*` в `client_health`, FS-CTR-3) — повод сохранить её копию отдельной папкой,
имя которой кончается датой, с `pretty/` внутри, и прогнать проверку контракта:
`CG_FANSLY_BUNDLES=/Users/dmitriy/Documents/Codex node tools/host-contract-check/index.ts --host fansly` — она берёт
самую новую такую копию и называет якорь, строку и место, которых в ней нет (`architecture.md` §7.16). Снимок
2026-10-12 проходит её целиком.

Новые общие материалы добавлять сюда, клиентские способы — в карту `fansly-chat`,
изменения требований — в R20 и журнал решений. Длинный бандл, схему API и конфигурацию
MCP не дублировать в двух `AGENTS`/`CLAUDE` файлах: там остаются обязательный выбор
инструмента и ссылка на этот справочник.
