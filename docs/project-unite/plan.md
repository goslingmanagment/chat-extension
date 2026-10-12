# R20: ChatGoose на fansly.com — план работ

Версия 5, 2026-10-12 (после третьего ревью astra и ответов владельца X34; детализирован до PR). Что строим —
`docs/project-unite/spec.md` (требования `FS-*`); факты о странице — `docs/project-unite/fansly-web.md`; решения
владельца — X33, X34 в `docs/decisions.md`. Пути файлов — стартовые: исполнитель сверяет их с текущим `main`.

**Список PR предварительный.** Его фиксирует матрица паритета (P1a): если она найдёт строку без владельца или
PR, который надо разделить, план получает версию 6 до начала этапов 4–16.

## 0. Правила

- **Один PR — одна небольшая задача.** Draft; перед Ready — `pnpm check` и `pnpm e2e` локально (e2e — в
  Docker, `tools/ci/e2e-docker-local.sh`); в Ready — один раз. Работа — в отдельном worktree.
- **Ничего не включается при слиянии.** Всё Fansly-специфичное — за флагами страницы в хабе
  (`chatExtensionFeatures`) и за «Включить Fansly» в расширении. Пока флаги выключены, выпуски ChatSpace идут
  как обычно и Fansly-кода у чаттеров ChatSpace не касаются.
- **ChatSpace не ломаем.** Каждый PR, который трогает общий код (`core`, `ui`, `contracts`, `hub`, `host-kit`,
  `composition`), держит зелёными все e2e ChatSpace и его бюджеты размера; старые фикстуры контрактов проходят без
  изменений.
- **Хаб — отдельный репозиторий**, свои PR по правилам `docs/hub-pr-plan.md`: каждый PR при слиянии ничего не
  включает. Четыре разных события:

| Событие | Что значит | Что разрешает |
|---|---|---|
| **схема слита** | PR хаба со схемой в `main` хаба | контракт расширения (этап 4) и поддельный хаб (P6c) по этой схеме |
| **SDK для тестов** | SDK перевендорен из **слитого** `main` хаба в ветку расширения | разработку и e2e на поддельном хабе; такую ветку нельзя выпускать |
| **хаб выложен** | серверный этап на проде | живые проверки на тестовой странице |
| **SDK для выпуска** | SDK из **выложенного** коммита | выпуск расширения (правило `AGENTS.md`) |

- **Живого Fansly до пилота нет** (X34): агент на нём не работает, повторных smoke у владельца нет. Вставку,
  передачу файла и подтверждение войса новое повторяет за старым, которое делает это вживую, и проверяет на
  стенде. Живая проверка — пилот на `lora-1` и `ari-1` с наблюдением (P16d).
- **FBuddy стоит у всех чаттеров** (X34): каждый PR, который трогает тап, наблюдение XHR, док, вставку или шапку,
  проверяет себя и рядом с «соседом» стенда (FS-CO-4).
- **Тест закрывает строку только на своём хосте.** Тест, который закрывает строку паритета для Fansly, несёт её
  id в названии и выполняется на стенде Fansly (спеки `suite-fansly-*` или тег `[fansly]`). Тест ChatSpace с
  тем же id строку Fansly не закрывает (сейчас `[NF-011]` в `suite-preview.e2e.ts:112` открывает ChatSpace).
- **e2e фичи принадлежит последнему PR её цепочки**; PR в середине цепочки проверяет свою границу юнит- и
  интеграционными тестами на стенде.

## 1. Граф этапов

| # | Этап | Где | PR | Зависит от |
|---|---|---|---|---|
| 0 | Документы | chat-extension | этот | — |
| 1 | Матрица паритета и гейт | chat-extension | P1a, P1b | 0 |
| 2 | Хаб | hub, chat-extension | HF-8а…д, HF-2, HF-5, HF-6, HF-7а…д, HF-3, HF-4а, HF-4б, HF-11; P2v | — (решения владельца получены, X34) |
| 3 | Спайк, подписанные сборки, база старого на стенде | chat-extension | P3a, P3b, P3d | 0; P3d — P6a, P6b |
| 4 | Контракты 1.15.0 | chat-extension | P4a1, P4a2, P4a3, P4b, P4c | P3a, P3b; схемы хаба |
| 5 | `host-kit` | chat-extension | P5 | P4a2 |
| 6 | Стенд и поддельный Fansly | chat-extension | P6a, P6b, P6c | P4a1…3, P4b; схемы хаба |
| 7 | `host-fansly` и подключение хоста | chat-extension | P7a…P7i | 5, 6 |
| 8 | Ядро и UI на Fansly | chat-extension | P8a, P8b1…3, P8c…P8f | 7 |
| 9 | `platform`, `fansly-api`, relay, опека, Spenders | chat-extension | P9a…P9e | P4c, 6, P3b |
| 10 | «Новые» | chat-extension | P10a, P10b1…3, P10c, P10d | 8, 9; HF-3 |
| 11 | «Регистрация» и «Заметки» | chat-extension | P11a, P11b | 7, 9; HF-11 |
| 12 | Войсы | chat-extension | P12a, P12b1…3, P12c | 8, 9; HF-4а, HF-4б |
| 13 | Vault | chat-extension | P13a, P13b | 7 |
| 14 | Звуки, страницы, «Включить Fansly», отзыв прав | chat-extension | P14a…P14c | 7, 9, 12, 13; P3b |
| 15 | Переход и откат | — | снят (X34): чаттеры выключают старое сами | — |
| 16 | Приёмка и пилот | chat-extension | P16a…P16d | 1–14; «SDK для выпуска» |
| 17 | После пилота: навигация на Fansly | chat-extension | P17 | 16 |

Сразу и параллельно: 1, 2, P3a. P3d — как только стенд Fansly (P6a, P6b) поднимает старое. Хаб идёт рядом с этапами 3–7; расширение до выкладки хаба живёт на
поддельном хабе со «SDK для тестов».

## 2. PR по этапам

### Этап 1. Паритет

| PR | Что | Файлы | Готово, когда | Зависит от |
|---|---|---|---|---|
| P1a | матрица: каждая строка, касающаяся Fansly (строки `Fansly`, `пилот + Fansly`, пилотные строки ChatSpace с функцией на Fansly, NF-001…039, AI-032…037, AI-110…115, AI-143…148, VA-001…006, SN-017…020, SP-036…041, новые FX-001…003 — E149, E152, E155, и строки «Заметок» FX-004… — E157) → требование `FS-*`, **один** PR-владелец, тест на стенде Fansly или исключение владельца; FS-* без строки — тоже в матрице | `docs/project-unite/parity-matrix.md` (новый), `docs/parity/parity-checklist.md`, `docs/parity/parity-manifest.json`, `tools/parity/{manifest,derive}.ts` (измерение `hosts`) | у каждой строки один владелец; план переведён в версию 6, если матрица что-то изменила | 0 |
| P1b | гейт: пара «строка × хост»; тест засчитывается Fansly, только если он на стенде Fansly; строка PR, отмеченного сделанным, без теста — ошибка; к пилоту незакрытых строк Fansly быть не может | `tools/parity/{coverage,coverage-report,index}.ts`, тесты `tools/parity/*.test.ts` | тест гейта: `[NF-011]` из `suite-preview` не закрывает строку Fansly; исключение владельца проходит | P1a |

Строки «Заметок» (E157) добавляются в матрицу как FX-004…; их владелец — P11b.

Уже известные назначения (до P1a): NF-011 «Открыть в Fansly» и NF-027 проверка запросов окна — P10a; NF-028
подсказка «AI ничего не отправляет автоматически» — P10c; NF-037 cooldown, повторы, пейсер — P9b (один
владелец; баннер cooldown в окне — NF-038, P10b1); FS-HK-1 — P7i.

### Этап 2. Хаб (репозиторий `hub`)

Каждый PR — по `docs/hub-pr-plan.md`: схема сначала, поведение за флагом, тесты на прод-коммите.

| PR | Что | Стартовые файлы хаба | Обязательные тесты |
|---|---|---|---|
| HF-8а | точные строковые id сообщений Fansly на всём пути: вход, транскрипт, дедупликация, восстановление ref, ответ о покрытии | `apps/runtime/src/modules/ai/context/{index,context-frame,live-text}.ts`, `prompts/transcript/normalize.ts` | разные id с одним `double` (`…001`/`…002`, `…936`/`…064`) живут раздельно до промпта и ответа о покрытии |
| HF-8б | `liveTextContext` для Fansly за флагом: принадлежность группе, удаления, слияние по строке | `context/live-text.ts`, `packages/contracts/src/routes.ts` | хвост Fansly принят; чужая группа и удалённое — отвергнуты с причиной |
| HF-8в | проверка покрытия окна: до 60 id обоих направлений и id удалённых, которые видела вкладка; ответ по каждому; `live` — принятые, совпавшие, отвергнутые | `routes.ts`, `context-frame.ts` | ответ по каждому id; удалённое вкладкой, но `included` у хаба — расхождение видно в кадре |
| HF-8г | обслуживать не меньше окна проверки функции (Hi — 25) | `features/index.ts` | окно меньше проверки — отказ с причиной, а не тихое обрезание |
| HF-8д | уровень покрытия Fansly в кадре — из цепочки движка (`page_dm_threads.history_state`) | `services/client-coverage.ts`, `sync/thread-chain.ts` | доказанное начало → `complete`; без доказательства — `unknown` |
| HF-2 | Fansly в `CLIENT_FEATURE_REQUIREMENTS` — по флагу, когда путь готов | `services/client-features.ts` | страница Fansly получает флаги; без флага — `platform_unsupported` |
| HF-5 | Hi на Fansly: личные с классификацией автоматики, доказанное начало по цепочке Fansly, иначе отказ | `features/index.ts`, `prompts/feature-policies.ts` | допуск: доказанное начало, 40 автоматических, 0 личных; допуск: 1 личное и 40 автоматических; отказ без доказательства; отказ при 11 личных |
| HF-6 | полный Recap на Fansly — глубокий, как на OnlyFans; потолок 5000 — одной настройкой владельца для обеих платформ (X34) после проверки окна модели и цены | `services/ai-transcript-depth.ts`, `packages/db/src/repositories/ai-transcript-depth.ts` | глубокое окно на Fansly с `context-v1`; 5000 при поднятой настройке; без настройки — как сейчас |
| HF-7а | медиа в транскрипте Fansly (сейчас без метаданных, `context/index.ts:96-109`) | загрузчик транскрипта Fansly | эталон AI-147 |
| HF-7б | профиль фана для Hi и Ping: имя, username, аватар, био — с сервера (сейчас username и аватар из `clientContext`, `features/index.ts:892, 1061`) | `features/index.ts`, загрузчики профиля Fansly | эталон AI-034, AI-146 |
| HF-7в | сохранённое имя фана (сейчас `fanCustomName: undefined`, `features/index.ts:688-689`): найти источник на сервере или исключение владельца | `features/index.ts` | эталон SP-040 или утверждённое исключение |
| HF-7г | траты, подписка, PPV без `clientContext`: сверка с эталоном старого и правки | загрузчики денег | эталоны AI-144, AI-145 |
| HF-7д | автоматика и покрытие в контексте (`page_automated_messages`) | `features/index.ts` | эталоны AI-033, AI-148 |
| HF-3 | своё приветствие без генерации в опеке нового пути: добавочный вид `dispatch` — `manual` и отпечаток текста вместо `generationRef`. Общей опеки со старым `followerOutreachAttempt` нет (X34) | `services/client-claim.ts`, `routes-client.ts:938-976`, `packages/db/src/repositories/client-claim.ts` | своё приветствие с нулём AI-запросов через настоящую схему SDK; два клиента нового — один POST; неопределённая попытка после перезапуска |
| HF-4а | идентичность войса: `voice-script` с `conversationRef = groupId` и `fanRef`, история с сервера; проверка источника в `createVoiceNote` принимает такую генерацию; старый формат работает | `features/index.ts:423-434`, `services/voice-notes.ts:341-351` | скрипт → настоящий `createVoiceNote` при разных id без `clientContext`; старый клиент без изменений |
| HF-4б | войсы в узком токене (`voiceNoteCreate/Status/Audio`), доступность в bootstrap | `client-token-scopes.ts`, `routes.ts:6592-6640` | узкий токен проходит три маршрута; страница без войсов — недоступно |
| HF-11 | схема клавиш: действие `notes` (⌘⇧K / Ctrl+Alt+K) для этого расширения на хосте Fansly — сейчас оно только у клиента `fansly` и здесь зарезервировано (#61) | `packages/chatgoose-hotkeys` | ChatSpace: клавиша по-прежнему зарезервирована; Fansly: действие `notes`; десктоп и старое — без изменений |

**P2v. SDK и выкладка** (chat-extension): «SDK для тестов» — по мере слияния схем; «SDK для выпуска» — после
выкладки согласованного серверного этапа; `@chatgoose/hotkeys` — после HF-11; `contract-change:` с перевендоренным SDK, поддельный хаб по новым
правилам, строка в `docs/contracts-changelog.md`. Готово: e2e на поддельном хабе зелёные; живая проверка на
тестовой странице Fansly — `live.status = served`, `rejected = 0`, ответ по каждому id.

### Этап 3. Спайк, подписанные сборки, база старого

| PR | Что | Итог | Зависит от |
|---|---|---|---|
| P3a | спайк на стенде и по коду: (1) Navigation API в Firefox ≥ 142 и пропуски сигналов FS-RTE-2 — решает FS-RTE-3; (2) `scripting.registerContentScripts` для MAIN на `document_start`; (3) невидимость Proxy над XHR и WS; (4) события удаления и пакеты сокета по диспетчеру `handleServiceEvent` (`main:28662-28675`); (5) ленивый relay в контейнере с прокси; (6) как подтверждать прикреплённый войс в текущей сборке — по снимку бандла (FS-VOI-2); (7) как FBuddy оборачивает XHR и WS и что вставляет в шапку — по `~/code/1-platform/fbuddy-analysis`, модель «соседа» для P6a; (8) HF-1 — чтением прода: `external_page_id` шести страниц против `account.id` | `docs/project-unite/spike.md`; правки спецификации | 0 |
| P3b | подписанные тестовые сборки (подпись — владелец): опциональный `webRequest`; задерживает ли обновление сборка с хостами Fansly в манифесте; будит ли `webRequest` event page | механизм FS-PERM-2 в `docs/project-unite/spike.md` | P3a |
| P3c | снят (X34): раннего smoke нет — см. §0 «Живого Fansly до пилота нет» | — | — |
| P3d | база старого на стенде Fansly: тестовая сборка старого (2.9.0 или выпуск на день перехода), нацеленная на стенд (способ — в PR: подмена адресов при сборке без правок `fansly-chat` или флаг сборки там), сценарий §11 архитектуры (открыть, 20 переключений, набор, час простоя), Firefox Profiler в том же headless Firefox, где мерится новое; данные и настройки зафиксированы | `docs/project-unite/baseline.md`: таблица метрик §4 этого плана для старого; правило — новое не хуже базы и в бюджете, иначе PR не сливается | P6a, P6b; до P7a |

### Этап 4. Контракты 1.15.0

Все — `contract-change:` с фикстурами, строкой в `docs/contracts-changelog.md` и правкой `docs/protocols/`;
старые фикстуры ChatSpace проходят без изменений.

| PR | Что | Файлы | Зависит от |
|---|---|---|---|
| P4a1 | маршрут и цель: `RouteState.conversationRef?`, `NavigationIntent.target.conversationRef?` | `packages/contracts/src/host.ts` | P3a |
| P4a2 | мост Fansly: реестры `FROM_MAIN`/`TO_MAIN` для Fansly (`follow`, `group`, `window`, `sendReceipt`, `snapshot`) рядом с ChatSpace, валидатор выбирает реестр по хосту; порт `FanslyPagePort` (слот шапки, войс, vault, relay); блок якорей Fansly в отчёте | `packages/contracts/src/{bridge-messages,fansly}.ts`, `host.ts` | P3a |
| P4a3 | протокол вкладки и страницы: `fansly.followers.*`, `fansly.voice.*`, `fansly.vault.*`, `fansly.notes.*`, `fansly.relay.open/close`, происхождение `https://fansly.com`; настройки `fansly.viaTab`, тон подписчиков, `fansly.notesView` (миграция вперёд); ошибки `CG-FAN-*`, `CG-VOICE-*`, `CG-VAULT-*`, `CG-NOTE-*`, коды «Новых» | `tab-messages.ts`, `settings.ts`, реестр ошибок | P3a, P3b |
| P4b | свежесть и запрос: необязательный `HostPort.freshness?: FreshnessPort` и схема снимка (личность, эпохи, полнота, окно с направлением, `knownFanMessageIds` из окна, удалённые в окне, хвост, `truncated`); доказательство покрытия в `StartOp` на всех поверхностях; поля запроса к хабу; `voice-script` в `HUB_AI_FEATURES`; отпечаток доказательства в ключе запроса | `host.ts`, `ops.ts`, `hub/ai.ts`, `core/src/domain/ops/identity.ts` | P4a1, P4a2; схемы HF-8в, HF-4а слиты |
| P4c | отправка по HTTP: цепочка «запрос начат → квитанция с id → эхо», доказанный отказ, `uncertain`; запрос отправки приветствия «Новых» (текст поля, ревизии, вид допуска, человеческое действие, опека) | `send.ts`, `send-rules.ts` | P4a3; схема HF-3 слита |

### Этап 5. `host-kit`

| PR | Что | Файлы | Готово, когда | Зависит от |
|---|---|---|---|---|
| P5 | вынос общего из `host-chatspace`: загрузчик MAIN, `guard`, `check`, протокол, клиент моста, закрытые хосты, слои, реестр корней, валидатор моста с реестром по хосту, код keep-bottom (порог — параметр) | `packages/host-kit/src/{main,isolated}/*` (из `host-chatspace/src/main/{guard,check,protocol}.ts`, `isolated/{bridge-client,shadow-registry,validate,validation,keep-bottom}.ts`), `.dependency-cruiser.cjs`, `tools/gates/checks.ts` (`MAIN_WORLD_SOURCE`) | поведение ChatSpace прежнее, `chatspace-main.js` 9,87 из 10 КиБ, e2e ChatSpace зелёные | P4a2 |

Сразу (X34): без окна без выпусков и без временной копии; страховка — e2e и бюджеты ChatSpace в этом же PR.

### Этап 6. Стенд Fansly

| PR | Что | Файлы | Зависит от |
|---|---|---|---|
| P6a | страница стенда по FS-ACC-1 (наш код и CSS по структуре `live/dom-skeleton.json`): пересоздание контейнера и поля, переиспользуемая шапка, `textarea` с моделью, восстановление черновика без событий, Enter, низ 1 px и 350 px, `scrollTop = 0`, виртуальный инбокс, мини-чат, `markGroupAsRead`, перезапрос свежего конца после скрытия и подтверждения сессии, `bright-theme`, метки старого; «сосед» по FS-CO-4 — скрипт в мире страницы, который, как FBuddy, оборачивает `XMLHttpRequest` и `WebSocket` (режимы: до нас, после нас, выключен) и вставляет свои узлы в шапку и верхнюю панель (по P3a) | `packages/testing/src/stand-fansly/*` (новый, в т. ч. `neighbor.ts`), `packages/testing/src/stand-server.ts` | P4a1; P3a |
| P6b | поддельный Fansly: XHR-API (`/account/me`, `/messaging/groups`, `/group/<id>/`, `/message?groupId=` со свежим концом и `before`/`offset`, `/messages?ids=`, `/message/unread`, `POST /message`, `/message/ack`, пути «Новых»), сокет `{t, d}` с событиями всех чатов, удалениями (`type 10`), пакетами, разрывами, повреждёнными кадрами; прокси для relay | `packages/testing/src/fake-fansly/{api,socket,data,proxy}.ts` (новый) | P4a2 |
| P6c | поддельный хаб для Fansly: страницы, флаги, правила HF-8, HF-5, опека нового пути со своим приветствием (HF-3), `voice-script` и `createVoiceNote` по HF-4а; сетевая ловушка: адреса Fansly — только поддельные, к OnlyMonster — ноль, `POST /message/ack` от расширения — ноль | `packages/testing/src/fake-hub/{data,ai,ai-rules,claims}.ts`, `packages/testing/e2e/support/network-trap.ts` | P4b, P4c; схемы HF-3, HF-4а, HF-5, HF-8 слиты |

### Этап 7. `host-fansly` и подключение хоста

Пакет `packages/host-fansly/src/{main,isolated,testing}`; входы `apps/extension/src/entrypoints/{fansly-main,fansly}.ts`;
сборка — `apps/extension/build/{main-world-entry,isolated-entry,manifest}.ts`; гейты MAIN — `tools/gates/checks.ts`
(`MAIN_WORLD_BUNDLES`, `ISOLATED_BUNDLE`, `MAIN_WORLD_SOURCE` для `host-fansly/src/main`).

| PR | Что | Файлы | Перенос из старого | Тесты PR | Зависит от |
|---|---|---|---|---|---|
| P7a | MAIN: захват натива, Proxy над `WebSocket` и `XMLHttpRequest`, разбор кадров (две проекции, признак полноты), разбор ответов; Fansly-бандлы в гейте размера | `main/{index,ws-tap,xhr-tap,frame-parse,responses}.ts`, `tools/size-budget/budget.ts` | `src/content/page-socket-tap.ts`, `src/shared/fansly-ws-frame.ts` | SN-017…020, FS-WS-1…5 (юнит и стенд); невидимость тапа; рядом с «соседом» до и после нас — у нас и у него те же кадры и ответы; бюджет MAIN | P5, P6b, P3d |
| P7b | MAIN: наблюдение чатов, сертификаты (первый и восстановление), пределы памяти, личность, снимок | `main/{observation,certificate,memory,identity,snapshot,bridge}.ts` | — | FS-TAIL-3…7, FS-IDN-1, 3 на стенде: старая страница и поздний ответ не дают сертификата; первый сертификат длинного чата; восстановление после штатного перезапроса; ускоренный тест пределов памяти | P7a |
| P7c | изолированный мир: старт, маршрут, личность, `HostPort`, `FreshnessPort`, контракт; Fansly-бандл в гейте размера | `isolated/{start,route,identity,host-port,contract}.ts` | `src/content/route-watcher.ts` (без опроса) | FS-RTE-1…4; счётчик «адрес без сигнала»; бюджет раннего бандла | P7b |
| P7d | монтирование дока, оверлеи, тема, деградация | `isolated/{mount,theme}.ts` | `src/content/conversation-mount-controller.ts` (без наблюдения всего разговора) | FS-PLC-1…7, FS-CTR-2; низ 350 px; док рядом с «соседом» | P7c |
| P7e | вставка и «Открыть и вставить» | `isolated/{insert,navigate}.ts` | `src/content/textarea.ts`, навигация SP-036 | UI-021, SP-036, FS-INS-1…4: 200 переключений, ввод между снимком и записью, восстановленный черновик | P7d |
| P7f | наблюдение отправки человеком и `sent` | `isolated/send-observe.ts`, `main/receipt.ts` | — | FS-SEND-1, 2; два кандидата → не атрибутировано | P7e |
| P7g | распознавание старого и отступление | `main/legacy.ts`, `isolated/legacy.ts` | маркеры `src/content/bootstrap.ts`, `page-socket-tap.ts` | NEW-12, FS-CO-1 | P7c |
| P7h | проверка контракта против бандла | `tools/host-contract-check/{check,anchors-fansly}.ts` | — | `--host fansly` на снимке 2026-10-12 — все якоря на месте | P7d |
| P7i | подключение хоста: выбор хоста в `composeTab` (сейчас `startChatSpaceHost`, `composition/tab.ts:24,61`), регистрация вкладки (`tab/runtime.ts:147`), разрешённые хосты фона (`composition/background.ts:284`), `hosts.ts`, ранний клавиатурный щуп и разбор маршрута по хосту (`tab/keys.ts:31`) | `apps/extension/src/composition/{tab,background}.ts`, `composition/tab/{runtime,keys}.ts`, `apps/extension/src/hosts.ts` | — | FS-HK-1; Fansly, ChatSpace и обе вкладки сразу; модалка Fansly; Enter остаётся за страницей | P7c |

### Этап 8. Ядро и UI на Fansly

| PR | Что | Файлы | Тесты PR | Зависит от |
|---|---|---|---|---|
| P8a | путь `groupId` (FS-IDN-6) для дока, превью и тоста | `packages/hub/src/ai-request.ts:75`, `core/src/application/ai/workspace.ts:482`, `core/src/application/preview/controller.ts:1495-1496` | `suite-fansly-ids` (док, превью, тост): `groupId` ≠ id фана | P7i |
| P8b1 | снимок вместо `readVisibleTail` + `checkpoint` на Fansly; `messageCount` ≥ окна проверки; поля запроса HF-8в | `workspace.ts`, `core/src/domain/ops/request.ts`, `ai-request.ts` | запрос несёт окно, известные id из окна, удалённые, хвост | P8a |
| P8b2 | вердикт §3.5 и пометка с «Ещё раз»; запрет отправки без свежего вердикта | `core/src/application/ai/*`, `packages/ui/src/dock/*` | таблица §3.5 построчно | P8b1 |
| P8b3 | ключ запроса с отпечатком доказательства; повторно открытый результат — со своим вердиктом; без хвоста в записи результата | `core/src/domain/ops/identity.ts`, `core/src/services/scheduler.ts`, `core/src/application/ai/op-store.ts` | `suite-fansly-tail` целиком (владелец этого спека); очистка копий FS-PRIV-1 | P8b2 |
| P8c | AI-функции на Fansly: Hi (FS-AI-2, клиент не режет по общему счёту), Ping, Recap, Review, Coach | `core/src/domain/features/gates.ts`, `core/src/domain/ops/request.ts` | AI-032…037, ST-137; Hi с 1 личным и 40 автоматическими | P8b1 |
| P8d | тема Fansly | `docs/ui-design.md` (таблица токенов), `packages/ui/src/kit/base.ts`, `host-fansly/isolated/theme.ts` | обе темы, снимки | P7d |
| P8e | параллельные генерации на Fansly | — (ядро общее) | `suite-fansly-ops`: три чата, четвёртая — отказ со списком, вставка только в свой чат | P8b3 |
| P8f | учёт по хостам: `HealthWindow` по хосту и сборке, фоновые метрики со своей принадлежностью, суточный агрегат для «Статуса», доли FS-TAIL-9 с числителем и знаменателем | `core/src/domain/telemetry/health.ts:191-246`, `core/src/services/telemetry/health.ts` | смешанный профиль ChatSpace + Fansly, перезапуск фона, согласие выключено | P8b2 |

### Этап 9. `platform`, `fansly-api`, relay, опека, Spenders

| PR | Что | Файлы | Перенос из старого | Тесты PR | Зависит от |
|---|---|---|---|---|---|
| P9a | захват сессии, права, регистрация скриптов | `packages/platform/src/{web-request,permissions,scripting}.ts` | `src/background/{session-capture,session-store}.ts` | BG-007, EX-004, AU-031…033; FS-NET-2, FS-PERM-2 | P4a3; P3b |
| P9b | REST-клиент по списку FS-NET-1, пейсер, ошибки | `packages/fansly-api/src/{client,allowlist,errors}.ts`, `pacer/*` | `src/background/fansly-client.ts`, `src/background/fansly-pacer/*` | RB-023, NF-037; `success: false` при 200 | P9a |
| P9c | relay | `apps/extension/src/entrypoints/fansly-relay/{index.html,main.ts}`, `packages/platform/src/rpc-relay.ts`, `packages/fansly-api/src/transport.ts` | `src/fansly-relay/index.ts`, `src/background/fansly-transport.ts` | FX-001, FS-NET-4: ленивый подъём, смена документа или аккаунта → отказ до опеки, запрос через прокси стенда | P9b |
| P9d | опека и отправка по HTTP | `packages/core/src/services/fansly-send.ts` (новый), `packages/hub/src/facade.ts` | `src/background/followers-service.ts:1012-1127` с проверками до них | `suite-fansly-send`: падение до и после POST, потерянный ответ, эхо раньше квитанции, позднее эхо после перезапуска, два клиента | P9c; P4c; P6c |
| P9e | Spenders на Fansly: имена, поиск чата, «Открыть и вставить» | `core/src/application/spenders`, `fansly-api` | `src/background/spenders-service.ts:773-799`, `runtime-api.ts` (обработчик `resolveFanChat` с 1312) | SP-037…041, FS-SPD-1, 2; `groupId` ≠ id фана для Spenders | P9b; P8a |

Гейты (`tools/gates/checks.ts`, в P9b): `fetch` — только `packages/hub`, `packages/fansly-api` и вход кадра relay;
адреса `fansly-api` ⊂ `https://apiv3.fansly.com/api/v1/`; строки `/message/ack` в нашем коде нет; к
`onlymonster.ai` — ноль.

### Этап 10. «Новые» Fansly

| PR | Что | Файлы | Перенос из старого | Тесты PR | Зависит от |
|---|---|---|---|---|---|
| P10a | окно 1–720 ч, список, статусы, фильтр, поиск, страницы, карточка, превью до 750 сообщений, «Открыть в Fansly», проверка запросов окна | `core/src/application/newcomers`, `core/src/domain/newcomers`, `packages/ui/src/newcomers/*` | `src/content/followers/index.ts`, `src/shared/followers.ts` | NF-001…011, NF-025…027 | P8a, P9b |
| P10b1 | автоочередь Б17, ручные действия, пауза, баннер cooldown | `core/src/services/fansly-newcomers.ts` (новый), `core/src/domain/newcomers/fansly-*.ts` | `src/background/followers-service.ts` (проход и очередь) | NF-030…036, NF-038, NF-039; FS-NEW-4 | P10a |
| P10b2 | «Нельзя написать» до запроса, «К обработке» | `core/src/domain/newcomers/dm-permissions.ts` | `src/shared/fansly-dm-permissions.ts` | FX-003, FS-NEW-2 | P10b1 |
| P10b3 | журнал прохода в IndexedDB с ротацией | `core/src/services/fansly-newcomers.ts`, `packages/platform/src/idb.ts` | журнал старого (`README.md:162-186`) | NF-029, FS-NEW-5; память фона | P10b1 |
| P10c | приветствие: доказательство прохода (FS-NEW-7), три допуска (FS-NEW-6), отправка с опекой, подсказка «AI ничего не отправляет автоматически» | `core/src/application/newcomers`, `core/src/services/fansly-send.ts`, `packages/ui/src/newcomers/*` | `src/content/followers/index.ts:389-416` | NF-012…024, NF-028; три допуска; хаб догнал — старый результат не уходит; `groupId` ≠ id фана в «Новых» | P10b2; P9d |
| P10d | `suite-fansly-newcomers` целиком | `packages/testing/e2e/specs/suite-fansly-newcomers.e2e.ts` | — | два клиента — один POST; история изменилась — отказ; своё приветствие без AI | P10c, P10b3 |

### Этапы 11–14

| PR | Что | Файлы | Перенос из старого | Тесты PR | Зависит от |
|---|---|---|---|---|---|
| P11a | «Регистрация»: слот шапки, дата из snowflake, одна попытка `GET /group/<id>`, дубль в панели фана | `host-fansly/isolated/header-slot.ts`, `core/src/domain/fansly/snowflake.ts`, `packages/ui/src/fanpanel/*` | `src/content/fan-registration.ts`, `src/content/header-row-slot.ts`, `src/shared/fansly-id-time.ts` | FX-002, FS-REG-1…4; рядом с «соседом» | P7d, P9b |
| P11b | «Заметки»: кнопка со счётчиком в слоте шапки после «Регистрации», ⌘⇧K, панель (три вида, имя для себя, заметки, «+ По шаблону», черновики по фану), чтения и записи через `fansly-api` и пейсер | `packages/ui/src/notes/*`, `core/src/application/notes` (новые), `packages/fansly-api/src/notes.ts`, `host-fansly/isolated/header-slot.ts` | `src/content/fan-notes/*`, `src/shared/fan-notes.ts`, заметки в `src/background/fansly-client.ts` | FX-004…, FS-NOTE-1…5, `suite-fansly-notes` целиком; рядом с «соседом» | P11a; HF-11 |
| P12a | `voice-script` на клиенте: раздельные `groupId` и `fanRef`, без `clientContext` | `core/src/application/voice` (новый), `ai-request.ts` | — | AI-111; скрипт при разных id | P8b1; HF-4а |
| P12b1 | хранилище оплаченных попыток: фоновая опека, переживающая выгрузку event page, версионированное подтверждение записи (CAS), RPC-подтверждения; адаптер хранения в `platform` | `core/src/domain/voice/attempts.ts`, `core/src/services/voice-attempts.ts`, `packages/platform/src/storage.ts` | `src/background/voice-attempt-store.ts`, `src/content/voice/attempt-store.ts` | AI-113: потерянное подтверждение записи, перезапуск фона, конфликт версий | P12a |
| P12b2 | поток войса: скрипт → варианты → оплата → статус → аудио, граница оплаты проверяет сохранённую попытку | `core/src/services/voice.ts` | `src/background/voice-service.ts` (в т. ч. `:995-1014`) | AI-112, AI-115, ER-075…078 | P12b1; HF-4б |
| P12b3 | панель войса, «Новый войс», «Скачать MP3» | `packages/ui/src/voice/*` | `src/content/voice/{voice-panel,attempt-controller,voice-studio}.ts` | AI-110; снимки обеих тем | P12b2 |
| P12c | прикрепление в поле этого чата и подтверждение | `host-fansly/isolated/voice-attach.ts` | `src/content/voice/attach-adapter.ts`, `src/content/native-file-handoff.ts` | AI-114, `suite-fansly-voice` целиком; мини-чат не получает файла | P12b3 |
| P13a | загрузчик vault | `host-fansly/isolated/vault/*` | `src/content/vault/{upload-runner,vault-dom,checkpoint-store}.ts` | VA-001…006, AU-036 | P7d |
| P13b | панель vault | `packages/ui/src/vault/*` | `src/content/vault/vault-panel.ts` | `suite-fansly-vault` целиком | P13a |
| P14a | звуки: сообщение и подписчик, дедупликация по платформе, тоны Fansly | `core/src/services/sound/*`, `core/src/domain/sound/*` | `src/background/message-sound-service.ts` | FS-SND-1, 2, `suite-fansly-sound` | P7a, P7i |
| P14b | настройки, popup, «Статус», отладка для Fansly | `packages/ui/src/pages/*`, `core/src/application/pages/*` | `src/options/*` (разделы Fansly) | ST-077, ST-079, LG-026, DB-010, DB-015; FS-SET-1…3 | P8f, P9a |
| P14c | «Включить Fansly», отзыв прав и выключение посреди отправки, платного войса, загрузки vault | `core/src/application/pages/*`, `packages/platform/src/permissions.ts` | — | FS-PERM-1…5, `suite-fansly-perms` | P9a, P10c, P12c, P13b |
| P15 | снят (X34): экранов перехода и отката нет; распознавание старого и отступление — P7g | — | — | — | — |

### Этап 16. Приёмка и пилот

| PR | Что | Файлы | Зависит от |
|---|---|---|---|
| P16a | запуск perf для Fansly (сейчас `pnpm perf` берёт только `perf-probe.e2e.ts`, `packages/testing/package.json:51`); бюджеты §4 как гейт; профиль 10 вкладок Fansly с ChatSpace; рост памяти после 100 переключений и 20 циклов оверлея; ускоренный тест пределов наблюдения | `packages/testing/e2e/perf/fansly-perf-probe.e2e.ts`, `packages/testing/package.json`, `packages/testing/e2e/wdio.conf.ts` (отдельный конфиг или тайм-аут для perf) | 1–14 |
| P16b | долгий прогон: 8 ч событий 300+ чатов на стенде — задача агента с чек-листом, не CI | `docs/project-unite/long-run.md` | P16a |
| P16c | пилот: флаги на `lora-1` и `ari-1` (владелец); все чаттеры этих страниц в один день выключают старое и нажимают «Включить Fansly»; инструкция чаттерам: войсы и vault доделать в старом до перехода | `docs/project-unite/pilot.md` | P16a; «SDK для выпуска» |
| P16d | наблюдение пилота вместо smoke (FS-ACC-4): агент по чек-листу читает «Статус», `client_health` и журналы — хвосты и пометки, якоря, `sent`, приветствия, войсы, vault, ошибки, бюджеты против базы P3d; что видно только глазами — один вопрос владельцу | `docs/project-unite/pilot.md` | P16c |
| P16e | снят (X34): выпуска старого с баннером нет | — | — |

### Этап 17. После пилота

- **P17.** Навигация J/K, ⌘1–9, ⌘U и палитра на Fansly — из данных, которые страница уже получила; инбокс
  виртуальный, расширение его не листает.

## 3. Каталог e2e для Fansly

| Спек | Владелец (последний PR цепочки) | Что проверяет | Требования |
|---|---|---|---|
| `suite-fansly-dock.e2e.ts` | P7d | монтирование, смена чата, деградации, мини-чат, поздняя установка, низ ленты | FS-DOCK-*, FS-PLC-*, FS-CTR-* |
| `suite-fansly-insert.e2e.ts` | P7e | 200 переключений, ввод между снимком и записью, восстановленный черновик, Б2, «Открыть и вставить» | FS-INS-*, FS-RTE-* |
| `suite-fansly-host.e2e.ts` | P7i | Fansly, ChatSpace и обе вкладки; модалка Fansly; Enter за страницей | FS-HK-1 |
| `suite-fansly-tail.e2e.ts` | P8b3 | хвост за 0,5 с, 11 сообщений, A→B→A, разрыв, bfcache, вытеснение, пакеты, сертификаты, `lastMessage`, удаление перед генерацией при отстающем хабе, окно Hi, кэш, очистка копий | FS-TAIL-*, FS-WS-*, FS-PRIV-1 |
| `suite-fansly-ids.e2e.ts` | P8a (док, превью, тост); P9e — Spenders; P10c — «Новые» | `groupId` ≠ id фана | FS-IDN-6 |
| `suite-fansly-ops.e2e.ts` | P8e | параллельные генерации | FS-OPS-1 |
| `suite-fansly-send.e2e.ts` | P9d | `sent`, матрица сбоев HTTP-отправки | FS-SEND-*, FS-NEW-3 |
| `suite-fansly-relay.e2e.ts` | P9c | ленивый relay, маршрут до опеки, прокси, смена документа | FS-NET-4 |
| `suite-fansly-network.e2e.ts` | P9b | список FS-NET-1, ноль `ack`, ноль OnlyMonster | FS-NET-1 |
| `suite-fansly-newcomers.e2e.ts` | P10d | окно, Б17, «Нельзя написать», три допуска, два клиента | FS-NEW-* |
| `suite-fansly-registration.e2e.ts` | P11a | «Регистрация» | FS-REG-* |
| `suite-fansly-notes.e2e.ts` | P11b | «Заметки»: три вида, чтения по виду, записи по действию человека, cooldown, тексты не уходят в хаб и логи | FS-NOTE-* |
| `suite-fansly-voice.e2e.ts` | P12c | скрипт, оплата, прикрепление | FS-VOI-* |
| `suite-fansly-vault.e2e.ts` | P13b | загрузка, контрольные точки | FS-VLT-* |
| `suite-fansly-sound.e2e.ts` | P14a | звуки, дедупликация | FS-SND-* |
| `suite-fansly-perms.e2e.ts` | P14c | «Включить Fansly», отзыв посреди операций | FS-PERM-* |
| `suite-fansly-legacy.e2e.ts` | P7g | старое расширение на странице — новое отступает, popup просит выключить старое | FS-CO-1 |
| `suite-fansly-neighbor.e2e.ts` | P7i (тап, док, вставка); P11a, P11b добавляют шапку | всё рядом с «соседом» FBuddy: обёртки до и после нас, его узлы в шапке; он видит те же кадры и ответы | FS-CO-4 |
| `perf/fansly-perf-probe.e2e.ts` | P16a | бюджеты, 10 вкладок, рост памяти | FS-PERF-* |

## 4. Бюджеты

Стартовые значения — §7 спецификации; утверждаются по базе P3d. Правило: новое не хуже базы старого и в
бюджете, иначе PR не сливается (или разбор с решением владельца).

| Что меряем | Бюджет | Где и кем | Когда |
|---|---|---|---|
| MAIN (`fansly-main.js`) | ≤ 10 КиБ gzip; ≤ 1 мс на `document_start` | `tools/size-budget` (P7a добавляет бандл), `bundle-timing` | P7a и далее каждый PR |
| ранний изолированный (`fansly.js`) | ≤ 30 КиБ gzip; ≤ 3 мс | `tools/size-budget` (P7c) | P7c и далее |
| разбор кадра / ответа XHR | ≤ 0,1 мс в среднем / ≤ 2 мс на задачу | своя инструментовка в `client_health` | P7a |
| снимок генерации | ≤ 5 мс | своя метрика | P7b |
| память наблюдения MAIN | ≤ 4 МиБ (текст ≤ 2 МиБ) | ускоренный тест пределов (P7b), долгий прогон (P16b) | P7b, P16b |
| `routeToDockMs`, `insertMs` | p95 ≤ 50 мс winpc / ≤ 30 мс Mac; p95 ≤ 100 мс | своя метрика, perf-проба | P7d, P7e, P16a |
| первый чанк дока | ≤ 45 КиБ gzip (общий с ChatSpace) | `tools/size-budget` | P8b2 и далее |
| ленивые чанки («Новые», войсы, vault, «Регистрация», «Заметки») | ≤ 30 КиБ каждый; войсы при превышении — делить | `tools/size-budget` | P10a, P11a, P11b, P12b3, P13b |
| фон | ≤ 30 МБ на профиль | `about:memory`, сценарий 10 вкладок | после P9d, P10b3, P12b2 и в P16a |
| вкладка | +≤ 15 МБ; рост ≤ 5 МБ за 100 переключений и 20 циклов оверлея | perf-проба | P16a |
| простой, ввод в поле, «лучше старого» | ни одного таймера > 1 Гц; p95 ввода ≤ база + 5 мс; сравнение с P3d | Firefox Profiler на стенде | P16a |

## 5. Риски

| Риск | Чем закрываем |
|---|---|
| Вставка в чужой чат (P1) | FS-INS-1, `suite-fansly-insert` |
| Тихая потеря хвоста | §3 спецификации, HF-8, `suite-fansly-tail`, учёт долей по хосту |
| Неверный `groupId` в запросе | FS-IDN-6, `suite-fansly-ids` на каждой поверхности |
| Двойное приветствие в дни перехода | страницу переводят целиком (X34); между чаттерами нового — опека хаба (HF-3), `suite-fansly-newcomers` |
| Войс не проходит хаб | HF-4а целиком до `createVoiceNote`, `suite-fansly-voice` |
| Двойная оплата войса | P12b1 (фоновая опека и CAS); при переходе войсы доделываются в старом |
| Новая сборка Fansly ломает якоря | контракт и деградация по одной функции, `host-contract-check --host fansly` |
| Fansly переходит на `withFetch` | якоря ответов покажут; запасной наблюдатель `fetch` |
| Обёртки MAIN заметны скриптам страницы | минимум обёрток; инцидентов не было; уход в фон — только решением о правах |
| Запрос через чужую сессию или прокси | relay привязан к вкладке и документу, прямого запасного пути нет |
| AI беднее старого | HF-5…HF-8 по полям, эталоны сформированного контекста |
| Телеметрия смешивает хосты | P8f |
| Память фона и MAIN | FS-TAIL-5, ленивые сервисы, журнал «Новых» в IndexedDB, перемеры после тяжёлых сервисов |
| Бюджеты без базы | P3d до разработки |
| Хаб не готов к пилоту | функции читаются «хаб пока не умеет», ничего не ломается |
| Объём растёт с выпусками старого | паритет — на день перехода (X34): каждый выпуск старого до перехода — новые строки матрицы и PR |
| FBuddy ломает нас или мы его | «сосед» на стенде (FS-CO-4), `suite-fansly-neighbor`, якоря и деградация по одной функции |
| Нет живой проверки до пилота | способы старого, которые работают вживую; стенд; пилот на двух страницах с наблюдением (P16d) |

## 6. Где нужен владелец

Решения получены (X34). Дальше от владельца нужно только:

| Когда | Что |
|---|---|
| P3b | подпись тестовых сборок |
| P16c | флаги на `lora-1` и `ari-1`, выдать расширение чаттерам этих страниц |
| выпуски | подпись выпусков нового |
