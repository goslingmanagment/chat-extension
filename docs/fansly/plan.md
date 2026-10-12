# R20: ChatGoose на fansly.com — план работ

Версия 3, 2026-10-12 (после второго ревью astra, детализирована до PR). Что строим — `docs/fansly/spec.md`
(требования `FS-*`); факты о странице — `docs/research/fansly-web.md`; решения владельца — X33 в
`docs/decisions.md`. Пути файлов — стартовые: исполнитель сверяет их с текущим `main`.

## 0. Правила

- **Один PR — одна небольшая задача.** Draft; перед Ready — `pnpm check` и `pnpm e2e` локально (e2e — в
  Docker, `tools/ci/e2e-docker-local.sh`); в Ready — один раз. Работа — в отдельном worktree.
- **Ничего не включается при слиянии.** Всё Fansly-специфичное — за флагами страницы в хабе
  (`chatExtensionFeatures`) и за «Включить Fansly» в расширении. Пока флаги выключены, выпуски ChatSpace идут
  как обычно и Fansly-кода у чаттеров ChatSpace не касаются.
- **ChatSpace не ломаем.** Каждый PR, который трогает общий код (`core`, `ui`, `contracts`, `hub`, `host-kit`),
  держит зелёными все e2e ChatSpace и его бюджеты размера; старые фикстуры контрактов проходят без изменений.
- **Хаб — отдельный репозиторий**, свои PR по правилам `docs/hub-pr-plan.md`: каждый PR при слиянии ничего не
  включает. Расширение живёт на поддельном хабе по **слитой** схеме хаба; SDK в расширение для выпуска —
  только из **выложенного** коммита.
- **Живой Fansly** — только на тестовой переписке владельца и только с его участием, в двух режимах:
  - **ранний smoke** (этап 3в): чтения, вставка в поле и передача файла в поле — **без отправки**;
  - **итоговый smoke** (этап 16): ручные действия владельца на тестовых объектах, включая отправку
    человеком, приветствие тестовому подписчику, войс, файл в тестовый альбом vault.
- **Бюджеты — с первого этапа.** Каждый этап, который добавляет код на страницу Fansly или в фон, проверяет
  свои бюджеты (§4 этого плана) против базы старого (этап 3г).
- **Тесты называют строки.** Тест, который закрывает строку паритета, несёт её id в названии
  (`it('[NF-019] …')`); гейт паритета (этап 1б) это проверяет.

## 1. Граф этапов

| # | Этап | Где | PR | Зависит от |
|---|---|---|---|---|
| 0 | Документы: спецификация, план, справка, X33 | chat-extension | этот | — |
| 1 | Матрица паритета Fansly и гейт обязательных проверок | chat-extension | P1a, P1b | 0 |
| 2 | Хаб: HF-8 (а–е), HF-2, HF-5, HF-6, HF-7, HF-3, HF-4; выкладка; SDK | hub, chat-extension | 11 в хабе + P2v | решения владельца 1–3 |
| 3а | Спайк на стенде и по коду | chat-extension | P3a | 0 |
| 3б | Подписанные тестовые сборки: права и обновление | chat-extension | P3b | 3а |
| 3в | Ранний smoke владельца | — | P3c (чек-лист и итоги) | 3а; решение 5 |
| 3г | База старого 2.8.1 | — | P3d (сценарий и итоги) | 0 |
| 4 | Контракты 1.15.0 | chat-extension | P4a, P4b, P4c | 4а: 3а, 3б; 4б: схемы HF-8в, HF-4а слиты в хабе; 4в: 4а |
| 5 | `host-kit` | chat-extension | P5 | 4а; решение 4 |
| 6 | Стенд и поддельный Fansly, поддельный хаб для Fansly | chat-extension | P6a, P6b, P6c | 4а, 4б |
| 7 | `host-fansly` | chat-extension | P7a…P7h | 5, 6, 4б; P7e — 3в; решение 8 |
| 8 | Ядро и UI на Fansly | chat-extension | P8a…P8e | 4б, 7 |
| 9 | `platform`, `fansly-api`, relay, опека, Spenders | chat-extension | P9a…P9e | 4в, 6; P9a — 3б |
| 10 | «Новые» Fansly | chat-extension | P10a…P10d | 8, 9; HF-3 |
| 11 | «Регистрация» | chat-extension | P11 | 7, 9 |
| 12 | Войсы | chat-extension | P12a, P12b, P12c | 8, 9; HF-4; P12c — 3в |
| 13 | Vault | chat-extension | P13a, P13b | 7; 3в |
| 14 | Звуки, настройки, popup, «Статус», отладка, «Включить Fansly», отзыв прав | chat-extension | P14a, P14b, P14c | 7, 9; 3б |
| 15 | Переход и обратный переход | chat-extension | P15 | 7, 14; решение 6 |
| 16 | Приёмка, пилот, последний выпуск старого | chat-extension, fansly-chat | P16a…P16d | 1–15; решение 7 |
| 17 | После пилота: навигация J/K, ⌘1–9, ⌘U, палитра | chat-extension | P17 | 16 |

Сразу и параллельно: 1, 2, 3а, 3г. Хаб (2) идёт рядом с этапами 3–7; расширение до выкладки хаба работает на
поддельном хабе.

## 2. PR по этапам

### Этап 1. Паритет

**P1a. Матрица паритета Fansly.**
- Файлы: `docs/fansly/parity-matrix.md` (новый), `docs/parity/parity-checklist.md` (строки FX-001 «Fansly через
  вкладку» — E149, FX-002 «Регистрация» — E152, FX-003 «Нельзя написать» — E155), `docs/parity/parity-manifest.json`
  (`pnpm parity`), `tools/parity/manifest.ts`, `tools/parity/derive.ts` (измерение `hosts`).
- Что: каждая строка, касающаяся Fansly (строки `Fansly`, `пилот + Fansly`, пилотные строки ChatSpace с функцией
  на Fansly, NF-001…039, AI-032…037, AI-110…115, AI-143…148, VA-001…006, SN-017…020, SP-036…041, FX-001…003) →
  требование `FS-*`, PR этого плана, тест или исключение владельца.
- Готово: матрица совпадает с манифестом; `pnpm parity` зелёный.

**P1b. Гейт обязательных проверок.**
- Файлы: `tools/parity/coverage.ts`, `tools/parity/index.ts`, тесты `tools/parity/*.test.ts`.
- Что: строка с хостом Fansly, чей PR отмечен сделанным, без теста с её id — ошибка `pnpm parity` (сейчас
  `parity:coverage` — только отчёт).
- Готово: тест гейта ловит строку без теста и пропускает исключение владельца.

### Этап 2. Хаб (репозиторий `hub`)

Каждый PR — по `docs/hub-pr-plan.md`: схема сначала, поведение за флагом, тесты на прод-коммите.

| PR | Что | Стартовые файлы хаба | Обязательные тесты |
|---|---|---|---|
| HF-8а | точные строковые id сообщений Fansly на всём пути: вход, транскрипт, дедупликация, восстановление ref, ответ о покрытии | `apps/runtime/src/modules/ai/context/{index,context-frame,live-text}.ts`, `prompts/transcript/normalize.ts` | разные id с одним `double` (`…001`/`…002`, `…936`/`…064`) живут раздельно до промпта и ответа о покрытии |
| HF-8б | `liveTextContext` для Fansly за флагом: принадлежность группе, удаления, слияние по строке | `context/live-text.ts`, `packages/contracts/src/routes.ts` | хвост Fansly принят, чужая группа и удалённое — отвергнуты с причиной |
| HF-8в | проверка покрытия окна: до 60 id обоих направлений, ответ по каждому; `live` — принятые, совпавшие, отвергнутые | `routes.ts`, `context-frame.ts` | ответ по каждому из 60 id; исходящие тоже проверяются |
| HF-8г | обслуживать не меньше окна проверки функции (Hi — 25) | `features/index.ts` | окно меньше проверки — отказ с причиной, а не тихое обрезание |
| HF-8д | уровень покрытия Fansly в кадре — из цепочки движка (`page_dm_threads.history_state`) | `services/client-coverage.ts`, `sync/thread-chain.ts` | доказанное начало → `complete`; без доказательства — `unknown` |
| HF-2 | Fansly в `CLIENT_FEATURE_REQUIREMENTS` — по флагу, когда путь готов | `services/client-features.ts` | страница Fansly получает флаги в bootstrap; без флага — `platform_unsupported` |
| HF-5 | Hi на Fansly: личные с классификацией автоматики, доказанное начало (цепочка Fansly), иначе отказ | `features/index.ts`, `prompts/feature-policies.ts` | допуск: доказанное начало, 40 автоматических, 0 личных; отказ: нет доказательства; отказ: 11 личных |
| HF-6 | полный Recap на Fansly до 3000 | `services/ai-transcript-depth.ts` | глубокое окно на Fansly с `context-v1` |
| HF-7 | сверка сформированного контекста AI без `clientContext` против старого по AI-143…148 | `features/index.ts` | для каждой строки — снимок контекста: PPV, медиа, траты, подписка, профиль, имя, автоматика, покрытие |
| HF-3 | общая опека приветствий: одно сохраняемое состояние попытки на (страница, фан) для `followerOutreachAttempt` и нового пути | `packages/db/src/repositories/{client-claim,follower-outreach}.ts`, `routes.ts:7075`, `client-token-scopes.ts` | старое → новое, новое → старое, старое `sent` видно новому, неопределённая попытка после перезапуска, два клиента — один POST |
| HF-4 | войсы целиком: `voice-script` с `groupId` ≠ `fanRef` и историей с сервера; `voiceNoteCreate/Status/Audio` в узком токене; доступность в bootstrap | `features/index.ts:423-434`, `routes.ts:6592-6640`, `client-token-scopes.ts` | скрипт → платная озвучка при разных id, без `clientContext` |

**P2v. Выкладка и SDK.** Выкладка согласованного серверного этапа (не каждого PR); в расширении —
`contract-change:` с перевендоренным SDK (`scripts/vendor-sdk.mjs` хаба), `packages/testing/src/fake-hub/*` по
новым правилам, строка в `docs/contracts-changelog.md`. Готово: e2e на поддельном хабе зелёные; живая проверка
на тестовой странице Fansly — `live.status = served`, `rejected = 0`, ответ по каждому id.

### Этап 3. Спайк, подписанные сборки, ранний smoke, база

**P3a. Спайк на стенде и по коду** — `docs/fansly/spike.md`, правки спецификации по ответам:
1. Navigation API в Firefox ≥ 142; пропускают ли сигналы FS-RTE-2 смену адреса без изменений DOM и A→B→A до
   вызова наблюдателей — решает FS-RTE-3 (хук `history`).
2. `scripting.registerContentScripts` для MAIN на `document_start` на fansly.com.
3. Proxy над XHR и WS не меняют ответы, статусы, тайминги и порядок обработчиков (стенд, фикстуры бандла).
4. События удаления и правки сообщений, форма пакетов сокета — по бандлу (`onMessagesEvent`, `main:29054-29069`).
5. Ленивый relay во вкладке контейнера с прокси (стенд прокси, как E149).

**P3b. Подписанные тестовые сборки** (unlisted, подпись — владелец): опциональный `webRequest` в Firefox MV3;
задерживает ли обновление сборка с хостами Fansly в манифесте; будит ли слушатель `webRequest` event page.
Итог — механизм FS-PERM-2 в `docs/fansly/spike.md`.

**P3c. Ранний smoke владельца** — чек-лист `docs/fansly/smoke-early.md` и итоги в нём:
- `execCommand('insertText')` из content script в настоящее поле Fansly: модель, кэш черновика, отмена, IME;
- передача файла в поле без отправки; что делает подтверждение войса у старого (якоря `waveform` нет);
- HF-1: `account.id` против `external_page_id` шести страниц.

**P3d. База старого 2.8.1** — `docs/fansly/baseline.md`: сценарий §11 архитектуры на Fansly (открыть, 20
переключений, набор, час простоя), Firefox Profiler, winpc и Mac, зафиксированные данные и настройки; итоги
утверждают бюджеты §4 этого плана.

### Этап 4. Контракты 1.15.0

Все — `contract-change:` с фикстурами, строкой в `docs/contracts-changelog.md` и правкой `docs/protocols/`.

**P4a. Маршрут, мост, порт Fansly, протокол вкладки.**
- Файлы: `packages/contracts/src/host.ts` (`RouteState.conversationRef?`, `NavigationIntent.target.conversationRef?`,
  блок якорей Fansly в отчёте), `packages/contracts/src/fansly.ts` (новый: `FanslyPagePort` — слот шапки, войс,
  vault, relay; формы `follow`, `group`, `window`, `sendReceipt`), `packages/contracts/src/tab-messages.ts`
  (`fansly.followers.*`, `fansly.voice.*`, `fansly.vault.*`, `fansly.relay.open/close`, происхождение
  `https://fansly.com`), `packages/contracts/src/settings.ts` (`fansly.viaTab`, тон подписчиков, миграция вперёд),
  реестр ошибок (`CG-FAN-*`, `CG-VOICE-*`, `CG-VAULT-*`, коды «Новых»).
- Готово: старые отчёты и фикстуры ChatSpace валидны; новые фикстуры Fansly валидны.

**P4b. Свежесть и запрос.**
- Файлы: `host.ts` (необязательный `HostPort.freshness?: FreshnessPort`, схема снимка: личность, эпохи, полнота,
  окно проверки с направлением, `knownFanMessageIds`, хвост, `truncated`), `ops.ts` (доказательство покрытия в
  `StartOp` на всех поверхностях, вместо ограничения `ops.ts:141-143` для Fansly), `hub/ai.ts` (поля окна проверки
  по схеме HF-8в; `voice-script` в `HUB_AI_FEATURES`), `core/src/domain/ops/identity.ts` (отпечаток
  доказательства в ключе запроса).
- Зависит от: слитых схем HF-8в и HF-4а в хабе.
- Готово: снимок и доказательство проходят схему; ключ меняется при смене окна, полноты или удаления.

**P4c. Отправка по HTTP и приветствие «Новых».**
- Файлы: `send.ts`, `send-rules.ts` (добавочная цепочка: запрос начат → квитанция с id → эхо; доказанный отказ;
  `uncertain`; запрос отправки приветствия: текст поля, его ревизия, `historyRevision`, вид допуска — свой,
  AI, исправленный AI, человеческое действие, опека).
- Готово: правила переходов как данные, тест таблицы переходов; X8 ChatSpace без изменений.

### Этап 5. `host-kit`

**P5. Вынос общего из `host-chatspace`.**
- Файлы: `packages/host-kit/src/main/{guard,check,protocol}.ts` (из `host-chatspace/src/main/`),
  `packages/host-kit/src/isolated/{bridge-client,shadow-registry,validate,validation,keep-bottom}.ts` (из
  `host-chatspace/src/isolated/`; порог keep-bottom — параметр хоста), `.dependency-cruiser.cjs`,
  `tools/gates/checks.ts` (`MAIN_WORLD_SOURCE` для `host-kit/src/main`).
- Готово: поведение ChatSpace не меняется; `chatspace-main.js` — прежний размер (9,87 из 10 КиБ); все e2e
  ChatSpace зелёные. В окно без выпусков ChatSpace; иначе — временная копия в `host-fansly` с тестом равенства.

### Этап 6. Стенд Fansly

**P6a. Страница стенда.**
- Файлы: `packages/testing/src/stand-fansly/` (новый: страница, наш CSS по структуре `live/dom-skeleton.json`),
  маршрутизация в `packages/testing/src/stand-server.ts`.
- Что: FS-ACC-1 — пересоздание контейнера и поля, переиспользуемая шапка, `textarea` с моделью, восстановление
  черновика без событий, Enter, правила низа 1 px и 350 px, `scrollTop = 0`, виртуальный инбокс, мини-чат,
  `markGroupAsRead` при открытии, `bright-theme`, метки старого расширения.

**P6b. Поддельный Fansly.**
- Файлы: `packages/testing/src/fake-fansly/{api,socket,data,proxy}.ts` (новый).
- Что: XHR-API (`/account/me`, `/messaging/groups`, `/group/<id>/`, `/message?groupId=` со свежим концом и
  `before`/`offset`, `/messages?ids=`, `/message/unread`, `POST /message`, `/message/ack`, пути «Новых»); сокет
  `{t, d}` с событиями всех чатов, удалениями, пакетами, разрывами и повреждёнными кадрами; прокси для relay.

**P6c. Поддельный хаб для Fansly и сетевая ловушка.**
- Файлы: `packages/testing/src/fake-hub/{data,ai,ai-rules,claims}.ts`, `packages/testing/e2e/support/network-trap.ts`.
- Что: страницы Fansly, флаги, правила HF-8 и HF-5, общая опека HF-3, `voice-script`; ловушка: адреса Fansly —
  только поддельные; к OnlyMonster — ноль; `POST /message/ack` от расширения — ноль.

### Этап 7. `host-fansly`

Пакет `packages/host-fansly/src/{main,isolated,testing}`; входы `apps/extension/src/entrypoints/fansly-main.ts` и
`fansly.ts` (регистрируются фоном, если механизм прав — опциональный); сборка — `apps/extension/build/{main-world-entry,isolated-entry,manifest}.ts`;
гейты MAIN — `tools/gates/checks.ts` (`MAIN_WORLD_BUNDLES`, `ISOLATED_BUNDLE`, `MAIN_WORLD_SOURCE` для
`host-fansly/src/main`).

| PR | Что | Файлы | Перенос из старого | Тесты (строки, требования) |
|---|---|---|---|---|
| P7a | MAIN: захват натива, Proxy над `WebSocket` и `XMLHttpRequest`, разбор кадров (две проекции, признак полноты), разбор ответов | `main/{index,ws-tap,xhr-tap,frame-parse,responses}.ts` | `src/content/page-socket-tap.ts`, `src/shared/fansly-ws-frame.ts` | SN-017…020; FS-WS-1…5; невидимость тапа; повреждённый и усечённый пакет → `unknown` |
| P7b | MAIN: наблюдение чатов, сертификат, пределы памяти, личность, снимок | `main/{observation,certificate,memory,identity,snapshot,bridge}.ts` | — | FS-TAIL-3…7; FS-IDN-1, 3; сертификат: старая страница, поздний ответ, перекрытие; 8 ч × 300 чатов |
| P7c | изолированный мир: старт, маршрут, личность, `HostPort`, `FreshnessPort`, контракт | `isolated/{start,route,identity,host-port,contract}.ts` | `src/content/route-watcher.ts` (без опроса) | FS-RTE-1…4; счётчик «адрес без сигнала» |
| P7d | монтирование дока, оверлеи, тема, деградация | `isolated/{mount,theme}.ts` | `src/content/conversation-mount-controller.ts` (без наблюдения всего разговора) | FS-PLC-1…7, FS-CTR-2; низ ленты 350 px |
| P7e | вставка, «Открыть и вставить» | `isolated/{insert,navigate}.ts` | `src/content/textarea.ts`, навигация SP-036 | UI-021, SP-036; FS-INS-1…4; 200 переключений; ввод между снимком и записью |
| P7f | наблюдение отправки человеком и `sent` | `isolated/send-observe.ts`, `main/receipt.ts` | — | FS-SEND-1, 2; два кандидата → не атрибутировано |
| P7g | распознавание старого и отступление | `main/legacy.ts`, `isolated/legacy.ts` | маркеры `src/content/bootstrap.ts`, `page-socket-tap.ts` | NEW-12; FS-CO-1 |
| P7h | проверка контракта против бандла | `tools/host-contract-check/{check,anchors-fansly}.ts` | — | `--host fansly` на снимке 2026-10-12 — все якоря на месте |

Готово этапа: e2e `suite-fansly-dock`, `suite-fansly-insert`, `suite-fansly-tail`, `suite-fansly-legacy` (§3);
бюджеты MAIN и раннего бандла (§4).

### Этап 8. Ядро и UI на Fansly

| PR | Что | Файлы | Тесты |
|---|---|---|---|
| P8a | путь `groupId` (FS-IDN-6) | `packages/hub/src/ai-request.ts:75`, `core/src/application/ai/workspace.ts:482`, `core/src/application/preview/controller.ts:1495-1496`, разрешение группы в `core/src/application/{newcomers,spenders}` | `suite-fansly-ids`: `groupId` ≠ id фана на доке, превью, Spenders, «Новых», тосте |
| P8b | свежесть: снимок вместо `readVisibleTail` + `checkpoint` на Fansly; `messageCount` ≥ окна проверки; поля HF-8в; вердикт §3.5 и пометка; учёт; без хвоста в записи результата | `workspace.ts`, `core/src/domain/ops/request.ts`, `ai-request.ts`, `core/src/application/ai/op-store.ts`, `core/src/services/scheduler.ts`, `packages/ui/src/dock/*` | FS-TAIL-1…10 целиком; кэш и вердикт; очистка копий (FS-PRIV-1) |
| P8c | AI-функции на Fansly: Hi (FS-AI-2, клиент не режет по общему счёту), Ping, Recap, Review, Coach | `core/src/domain/features/gates.ts`, `core/src/domain/ops/request.ts` | AI-032…037, ST-137; Hi с 40 автоматическими |
| P8d | тема Fansly | `docs/ui-design.md` (таблица токенов), `packages/ui/src/kit/base.ts`, `host-fansly/isolated/theme.ts` | обе темы на стенде; снимки |
| P8e | параллельные генерации на Fansly | — (ядро общее) | FS-OPS-1: три чата, четвёртая — отказ со списком, вставка только в свой чат |

### Этап 9. `platform`, `fansly-api`, relay, опека, Spenders

| PR | Что | Файлы | Перенос из старого | Тесты |
|---|---|---|---|---|
| P9a | захват сессии, права, регистрация скриптов | `packages/platform/src/{web-request,permissions,scripting}.ts` | `src/background/session-capture.ts`, `session-store.ts` | BG-007, EX-004, AU-031…033; FS-NET-2, FS-PERM-2 |
| P9b | REST-клиент по списку FS-NET-1, пейсер, ошибки | `packages/fansly-api/src/{client,allowlist,errors}.ts`, `packages/fansly-api/src/pacer/*` | `src/background/fansly-client.ts`, `src/background/fansly-pacer/*` | RB-023, NF-037; FS-NET-1, 3; `success: false` при 200 |
| P9c | relay | `apps/extension/src/entrypoints/fansly-relay/{index.html,main.ts}`, `packages/platform/src/rpc-relay.ts`, `packages/fansly-api/src/transport.ts` | `src/fansly-relay/index.ts`, `src/background/fansly-transport.ts` | FX-001; FS-NET-4; ленивый подъём; смена документа или аккаунта → отказ до опеки; запрос через прокси стенда |
| P9d | опека и отправка по HTTP | `packages/core/src/services/fansly-send.ts` (новый), `packages/hub/src/facade.ts` (опека) | `src/background/followers-service.ts:976-1078` | матрица сбоев FS-ACC-2: падение до и после POST, потерянный ответ, эхо раньше квитанции, позднее эхо после перезапуска, два клиента |
| P9e | Spenders на Fansly | `core/src/application/spenders`, `fansly-api` (имена, поиск в инбоксе) | `src/background/spenders-service.ts:773-799`, `runtime-api.ts:1297-1340` | SP-037…041; FS-SPD-1, 2 |

Гейты (`tools/gates/checks.ts`): `fetch` — только `packages/hub`, `packages/fansly-api` и вход кадра relay;
адреса `fansly-api` ⊂ `https://apiv3.fansly.com/api/v1/`; строки `/message/ack` в нашем коде нет; к
`onlymonster.ai` — ноль (как сейчас).

### Этап 10. «Новые» Fansly

| PR | Что | Файлы | Перенос из старого | Тесты |
|---|---|---|---|---|
| P10a | окно 1–720 ч, список, статусы, фильтр, поиск, страницы, карточка, превью до 750 сообщений | `core/src/application/newcomers`, `core/src/domain/newcomers`, `packages/ui/src/newcomers/*` | `src/content/followers/index.ts`, `src/shared/followers.ts` | NF-001…010, NF-025, NF-026 |
| P10b | автоочередь Б17, ручные действия, пауза, «Нельзя написать», журнал в IndexedDB | `core/src/services/fansly-newcomers.ts` (новый), `core/src/domain/newcomers/fansly-*.ts`, `packages/platform/src/idb.ts` | `src/background/followers-service.ts`, `src/shared/fansly-dm-permissions.ts` | NF-029…039, FX-003; FS-NEW-2, 4, 5; «Нельзя написать» до запроса |
| P10c | приветствие: доказательство прохода (FS-NEW-7), три допуска (FS-NEW-6), отправка с опекой | `core/src/application/newcomers`, `core/src/services/fansly-send.ts`, `packages/ui/src/newcomers/*` | `src/content/followers/index.ts:389-416` | NF-012…024; три допуска; хаб догнал — старый результат не уходит |
| P10d | матрица сбоев отправки в «Новых» | `packages/testing/e2e/specs/suite-fansly-newcomers.e2e.ts` | — | два клиента — один POST; история изменилась — отказ; обратный переход |

### Этапы 11–15

| PR | Что | Файлы | Перенос из старого | Тесты |
|---|---|---|---|---|
| P11 | «Регистрация»: слот шапки, дата из snowflake, одна попытка `GET /group/<id>`, дубль в панели фана | `host-fansly/isolated/header-slot.ts`, `core/src/domain/fansly/snowflake.ts`, `packages/ui/src/fanpanel/*` | `src/content/fan-registration.ts`, `src/shared/fansly-id-time.ts` | FX-002; FS-REG-1…4; возврат после перерисовки без смены чата |
| P12a | `voice-script` на клиенте: раздельные `groupId` и `fanRef`, без `clientContext` | `core/src/application/voice` (новый), `ai-request.ts` | — | AI-111; скрипт при разных id |
| P12b | панель войса, попытки, защита от двойной оплаты, «Скачать MP3» | `packages/ui/src/voice/*`, `core/src/domain/voice/attempts.ts` | `src/content/voice/{voice-panel,attempt-controller,voice-studio}.ts`, `src/shared/voice-attempt.ts`, `src/background/voice-service.ts` | AI-110, 112, 113, 115; ER-075…078 |
| P12c | прикрепление в поле этого чата и подтверждение | `host-fansly/isolated/voice-attach.ts` | `src/content/voice/attach-adapter.ts`, `src/content/native-file-handoff.ts` | AI-114; мини-чат не получает файла; неоднозначно → «неизвестно» |
| P13a | загрузчик vault | `host-fansly/isolated/vault/*` | `src/content/vault/{upload-runner,vault-dom,checkpoint-store}.ts` | VA-001…006, AU-036 |
| P13b | панель vault | `packages/ui/src/vault/*` | `src/content/vault/vault-panel.ts` | снимки обеих тем |
| P14a | звуки: сообщение и подписчик, дедупликация по платформе, тоны Fansly | `core/src/services/sound/*`, `core/src/domain/sound/*` | `src/background/message-sound-service.ts` | FS-SND-1, 2 |
| P14b | настройки, popup, «Статус», отладка для Fansly | `packages/ui/src/pages/*`, `core/src/application/pages/*` | `src/options/*` (разделы Fansly) | ST-077, ST-079, LG-026, DB-010, DB-015; FS-SET-1…3 |
| P14c | «Включить Fansly», отзыв прав и выключение посреди операций | `core/src/application/pages/*`, `packages/platform/src/permissions.ts` | — | FS-PERM-1…5 |
| P15 | экран перехода; обратный переход | `packages/ui/src/pages/*`, `core/src/application/pages/*` | — | FS-CO-2, FS-CO-5 |

### Этап 16. Приёмка и пилот

- **P16a.** Бюджеты и профиль: `packages/testing/e2e/perf/fansly-perf-probe.e2e.ts`, сценарий 10 вкладок Fansly с
  ChatSpace, долгий поток событий; сравнение с базой P3d в `docs/fansly/baseline.md`.
- **P16b.** Итоговый smoke владельца — чек-лист `docs/fansly/smoke-final.md` по FS-ACC-4.
- **P16c.** Пилот: флаги на пилотных страницах хаба (владелец), выключение старого на этих профилях.
- **P16d.** Последний выпуск старого с баннером «Переходите на новое» — PR в `fansly-chat`, после smoke и решения
  владельца о переходе.

### Этап 17. После пилота

- **P17.** Навигация J/K, ⌘1–9, ⌘U и палитра на Fansly — из данных, которые страница уже получила; инбокс
  виртуальный, расширение его не листает.

## 3. Каталог e2e для Fansly

| Спек | Что проверяет | Требования |
|---|---|---|
| `suite-fansly-dock.e2e.ts` | монтирование, смена чата, деградации, мини-чат, поздняя установка, низ ленты | FS-DOCK-*, FS-PLC-*, FS-CTR-* |
| `suite-fansly-insert.e2e.ts` | 200 переключений, ввод между снимком и записью, восстановленный черновик, Б2, «Открыть и вставить» | FS-INS-*, FS-RTE-* |
| `suite-fansly-tail.e2e.ts` | хвост за 0,5 с, 11 сообщений, A→B→A, разрыв, bfcache, вытеснение, пакеты, сертификат, `lastMessage`, окно Hi, кэш, очистка копий, долгий поток | FS-TAIL-*, FS-WS-*, FS-PRIV-1 |
| `suite-fansly-ids.e2e.ts` | `groupId` ≠ id фана на каждой поверхности | FS-IDN-6 |
| `suite-fansly-ops.e2e.ts` | параллельные генерации | FS-OPS-1 |
| `suite-fansly-send.e2e.ts` | `sent` по квитанции и эху; матрица сбоев HTTP-отправки | FS-SEND-*, FS-NEW-3 |
| `suite-fansly-newcomers.e2e.ts` | окно, Б17, «Нельзя написать», три допуска, два клиента | FS-NEW-* |
| `suite-fansly-relay.e2e.ts` | ленивый relay, маршрут до опеки, прокси, смена документа | FS-NET-4 |
| `suite-fansly-network.e2e.ts` | сетевая ловушка: список FS-NET-1, ноль `ack`, ноль OnlyMonster | FS-NET-1 |
| `suite-fansly-legacy.e2e.ts` | старое расширение, переход и обратный переход | FS-CO-* |
| `suite-fansly-registration.e2e.ts` | «Регистрация» | FS-REG-* |
| `suite-fansly-voice.e2e.ts` | скрипт, озвучка, прикрепление | FS-VOI-* |
| `suite-fansly-vault.e2e.ts` | загрузка, контрольные точки | FS-VLT-* |
| `suite-fansly-sound.e2e.ts` | звуки, дедупликация | FS-SND-* |
| `suite-fansly-perms.e2e.ts` | «Включить Fansly», отзыв посреди операций | FS-PERM-* |
| `perf/fansly-perf-probe.e2e.ts` | бюджеты, 10 вкладок, долгий поток | FS-PERF-* |

## 4. Бюджеты по этапам

Стартовые значения — §7 спецификации; утверждаются по базе P3d.

| Этап | Что меряем | Бюджет | Где |
|---|---|---|---|
| 7 | MAIN (`fansly-main.js`) | ≤ 10 КиБ gzip; ≤ 1 мс на `document_start` | `tools/size-budget`, `bundle-timing` |
| 7 | ранний изолированный (`fansly.js`) | ≤ 30 КиБ gzip; ≤ 3 мс | то же |
| 7 | разбор кадра сокета / ответа XHR | ≤ 0,1 мс в среднем / ≤ 2 мс на задачу | своя инструментовка |
| 7 | снимок генерации | ≤ 5 мс | своя метрика |
| 7 | память наблюдения MAIN | ≤ 4 МиБ (текст ≤ 2 МиБ) | долгий поток на стенде |
| 8 | `routeToDockMs`, `insertMs` | p95 ≤ 50 мс winpc / ≤ 30 мс Mac; p95 ≤ 100 мс | своя метрика |
| 8 | первый чанк дока | ≤ 45 КиБ gzip (общий с ChatSpace) | `tools/size-budget` |
| 9–14 | ленивые чанки («Новые», войсы, vault, «Регистрация») | ≤ 30 КиБ каждый; войсы при превышении — делить | `tools/size-budget` |
| 9 | фон | ≤ 30 МБ на профиль | `about:memory`, сценарий 10 вкладок |
| 16 | простой, ввод в поле Fansly, «лучше старого» | ни одного таймера > 1 Гц; p95 ввода ≤ база + 5 мс; сравнение с P3d | Firefox Profiler |

## 5. Риски

| Риск | Чем закрываем |
|---|---|
| Вставка в чужой чат (P1) | FS-INS-1, `suite-fansly-insert` |
| Тихая потеря хвоста | §3 спецификации, HF-8, `suite-fansly-tail`, учёт долей |
| Неверный `groupId` в запросе | FS-IDN-6, `suite-fansly-ids` |
| Двойное приветствие при переходе или откате | общая опека HF-3, `suite-fansly-newcomers`, `suite-fansly-legacy` |
| Новая сборка Fansly ломает якоря | контракт и деградация по одной функции, `host-contract-check --host fansly` |
| Fansly переходит на `withFetch` | якоря ответов покажут; запасной наблюдатель `fetch` |
| Обёртки MAIN заметны скриптам страницы | минимум обёрток; инцидентов не было; уход в фон — только решением о правах |
| Запрос через чужую сессию или прокси | relay привязан к вкладке и документу, прямого запасного пути нет |
| AI беднее старого | HF-5…HF-8, сверка сформированного контекста (HF-7) |
| Войсы не проходят хаб | HF-4 целиком, `suite-fansly-voice` |
| Память фона и MAIN | FS-TAIL-5, ленивые сервисы, журнал «Новых» в IndexedDB, 10 вкладок, долгий поток |
| Бюджеты без базы | P3d до разработки |
| Хаб не готов к пилоту | функции читаются «хаб пока не умеет», ничего не ломается |
| Объём растёт с выпусками старого | после 2.8.1 — после пилота (X33) |

## 6. Где нужен владелец

| Когда | Что |
|---|---|
| до этапа 2 | решения 1–3 из §12 спецификации |
| P3b | подпись тестовых сборок |
| P3c | тестовая переписка Fansly и ~30 минут на ранний smoke (решение 5) |
| P3d | прогон базы старого по чек-листу на winpc и Mac |
| до P5 | решение 4 (`host-kit`) |
| до этапа 7 | решение 8 (стороннее расширение `[FB]`) |
| до P15 | решение 6 (переход профиля) |
| этап 16 | итоговый smoke, пилотные страницы (решение 7), включение флагов, подпись выпусков нового и старого |
