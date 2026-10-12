# R20: ChatGoose на fansly.com — план работ

Версия 6, 2026-10-12: детализация по архитектуре (`docs/project-unite/architecture.md`) после семи исследований, до
ревью арены. Что строим — `spec.md` (требования `FS-*`); как устроено — `architecture.md` (разделы `§N` ниже — оттуда);
факты о странице — `fansly-web.md`; решения владельца — X33, X34 в `docs/decisions.md`. Пути файлов — стартовые:
исполнитель сверяет их с текущим `main`.

**Список PR предварительный.** Его фиксирует матрица паритета (P1a): если она найдёт строку без владельца или PR, который
надо разделить, план получает версию 7 до начала этапов 4–16.

## 0. Правила

- **Один PR — одна небольшая задача.** Draft; перед Ready — `pnpm check` и `pnpm e2e` локально (e2e — в Docker,
  `tools/ci/e2e-docker-local.sh`); в Ready — один раз. Работа — в отдельном worktree.
- **Ничего не включается при слиянии.** Всё Fansly-специфичное — за флагами страницы в хабе (`chatExtensionFeatures`) и за
  «Включить Fansly» в расширении. Пока флаги выключены, выпуски ChatSpace идут как обычно, и Fansly-кода у чаттеров
  ChatSpace нет: ни в их вкладках, ни в фоне (§1, §3).
- **ChatSpace не ломаем и не утяжеляем.** PR, который трогает общий код (`core`, `ui`, `contracts`, `hub`, `host-kit`,
  `composition`, `platform`), держит зелёными все e2e ChatSpace; его «готово» называет строки бюджета ChatSpace
  (`chatspace-main.js`, `chatspace-ws.js`, `chatspace.js`, слои, `background.js`) — они не растут (§3.2). Старые фикстуры
  контрактов проходят без изменений, кроме двух мест, названных в §12 архитектуры.
- **Хаб — отдельный репозиторий**, свои PR по правилам `docs/hub-pr-plan.md`: каждый PR при слиянии ничего не включает.
  Четыре разных события:

| Событие | Что значит | Что разрешает |
|---|---|---|
| **схема слита** | PR хаба со схемой в `main` хаба | контракт расширения (этап 4) и поддельный хаб (P6c) по этой схеме |
| **SDK для тестов** | SDK перевендорен из **слитого** `main` хаба в ветку расширения | разработку и e2e на поддельном хабе; такую ветку нельзя выпускать |
| **хаб выложен** | серверный этап на проде | живые проверки — наблюдение пилота |
| **SDK для выпуска** | SDK из **выложенного** коммита | выпуск расширения (правило `AGENTS.md`) |

- **Живого Fansly до пилота нет** (X34): агент на нём не работает, повторных smoke у владельца нет. Способы, которые
  старое расширение делает вживую, повторяются и проверяются на стенде; живая проверка — пилот на `lora-1` и `ari-1` с
  наблюдением (P16d).
- **FBuddy стоит у всех чаттеров** (X34): PR, который трогает тап, наблюдатель XHR, док, вставку, отправку или шапку,
  проверяет себя и рядом с «соседом» стенда (P6d), в режимах по умолчанию `off` и `after`.
- **Тест закрывает строку паритета только на своём хосте.** Хост теста определяется по пути файла (`suite-fansly-*`,
  `packages/host-fansly/**`): метки собираются на файл, а не на тест. Тест ChatSpace с тем же id строку Fansly не
  закрывает (сейчас `[NF-011]` в `suite-preview.e2e.ts:112` открывает ChatSpace).
- **e2e фичи принадлежит последнему PR её цепочки**; PR в середине цепочки проверяет свою границу юнит- и
  интеграционными тестами.
- **Каждый PR называет разделы архитектуры**, которые он реализует; расхождение с архитектурой — правка архитектуры в том
  же PR или вопрос координатору.

## 1. Граф этапов

| # | Этап | Где | PR | Зависит от |
|---|---|---|---|---|
| 0 | Документы | chat-extension | этот | — |
| 1 | Матрица паритета и гейт | chat-extension | P1a, P1b | 0 |
| 2 | Хаб | hub, chat-extension | HF-8а, HF-8д, HF-9, HF-8в, HF-8б, HF-6, HF-7а…д, HF-5, HF-4а, HF-4б, HF-3, HF-10, HF-12, HF-2; P2v | — |
| 3 | Спайк, подписанные сборки, база старого | chat-extension | P3a, P3b, P3d | 0; P3d — P6a, P6b, P6d |
| F | Общее под два сайта | chat-extension | F1–F9 | F1 — P3a(1); F6 — P4a1 |
| 4 | Контракты 1.15.0 | chat-extension | P4a1, P4a2, P4a3, P4b, P4c | P4a1 — 0; остальные — P3a; схемы хаба |
| 5 | `host-kit` | chat-extension | P5 | F3, P4a2 |
| 6 | Стенд, поддельные Fansly и хаб, сосед | chat-extension | P6a, P6b, P6c, P6d | P4a1, P4a2; схемы хаба |
| 7 | `host-fansly` и подключение сайта | chat-extension | P7a–P7i | 5, 6, F2, F3 |
| 8 | Ядро и UI на Fansly | chat-extension | P8a, P8b1–3, P8c, P8d, P8e | 7, F4–F7 |
| 9 | Права, `fansly-api`, relay, отправка, Spenders | chat-extension | P9a–P9e | F1, F2, P4a3, P4c, 6 |
| 10 | «Новые» | chat-extension | P10a, P10b1–3, P10c, P10d | 8, 9; HF-3, HF-5 |
| 11 | «Регистрация», «Заметки», «Заполнить из чата» | chat-extension | P11a, P11b, P11c | 7, 9 |
| 12 | Войсы | chat-extension | P12a, P12b1–3, P12c | 8, 9; HF-4а, HF-4б |
| 13 | Vault | chat-extension | P13a, P13b | 7, 9 |
| 14 | Звук, страницы, «Включить Fansly» | chat-extension | P14a, P14b, P14c | 7, 9, 12, 13 |
| 15 | Переход и откат | — | снят (X34) | — |
| 16 | Приёмка и пилот | chat-extension | P16a–P16e | 1–14; «SDK для выпуска» |
| 17 | После пилота: навигация на Fansly | chat-extension | P17 | 16 |

Сразу и параллельно: 1, 2, P3a, P4a1. Этап F — после P3a(1) и P4a1; хаб идёт рядом с этапами 3–7, расширение до выкладки
хаба живёт на поддельном хабе со «SDK для тестов».

## 2. PR по этапам

### Этап 1. Паритет

| PR | Что | Файлы | Готово, когда | Зависит от |
|---|---|---|---|---|
| P1a | матрица: каждая строка, касающаяся Fansly (строки `Fansly`, `пилот + Fansly`, пилотные строки ChatSpace с функцией на Fansly, NF-001…039, AI-032…037, AI-110…115, AI-143…148, VA-001…006, SN-017…020, SP-036…041, новые FX-001…003 — E149, E152, E155; FX-004… — «Заметки» E157, E158; FX-00x — «Заполнить из чата» E159–E161) → требование `FS-*`, **один** PR-владелец, тест на стенде Fansly или исключение владельца; `FS-*` без строки — тоже в матрице; у каждой строки — откуда поведение (старое, ChatSpace, новое) | `docs/project-unite/parity-matrix.md` (новый), `docs/parity/parity-checklist.md`, `docs/parity/parity-manifest.json` | у каждой строки один владелец; план переведён в версию 7, если матрица что-то изменила; SP-054 исключена из пилота явно (сейчас `пилот + Fansly` в `parity-map.md:359`) | 0 |
| P1b | гейт: пара «строка × хост»; хост теста — по пути файла; владелец строки — PR (`R20/P7e`), а не только пакет `R00–R20` (`tools/parity/manifest.ts:15, 43`); строки `Fansly` больше не `n/a` (`derive.ts:74`); строка PR, отмеченного сделанным, без теста на своём хосте — ошибка; к пилоту незакрытых строк Fansly быть не может | `tools/parity/{manifest,derive,coverage,coverage-report,index}.ts`, тесты `tools/parity/*.test.ts` | тест гейта: `[NF-011]` из `suite-preview` не закрывает строку Fansly; исключение владельца проходит | P1a |

Уже известные назначения: NF-011 «Открыть в Fansly» и NF-027 проверка запросов окна — P10a; NF-028 подсказка «AI ничего
не отправляет автоматически» — P10c; NF-037 охлаждение, повторы, пейсер — P9b (баннер охлаждения — NF-038, P10b1);
FS-HK-1 — P7i; «Заметки» — P11b; «Заполнить из чата» — P11c.

### Этап 2. Хаб (репозиторий `hub`)

Каждый PR — по `docs/hub-pr-plan.md`: схема и обработчик в одном PR, `contracts:generate`, Draft → Ready один раз;
тесты на коммите прода (`a3449f77`). Порядок — архитектура §11.

| PR | Что | Стартовые файлы хаба (`a3449f77`) | Обязательные тесты | Инертен, потому что |
|---|---|---|---|---|
| HF-8а | точные строковые id на всём пути: ref строкой, сравнение числовых строк | `modules/ai/context/{index,context-frame,live-text,media-notes}.ts`, `prompts/transcript/{normalize,ofapi-message}.ts` | разные id с одним `double` (`…001`/`…002`, `…936`/`…064`) живут раздельно до промпта и ответа о покрытии; дайджесты OnlyFans не меняются | байты промптов OnlyFans те же |
| HF-8д | уровень покрытия Fansly в кадре — из цепочки движка (`page_dm_threads.history_state`) | `services/client-coverage.ts`, `context/context-frame.ts:230-238` | `complete` → `complete`; иначе `unknown` | читают только клиенты с `context-v1` на Fansly |
| HF-9 | проверка пары `groupId ↔ fanRef` (`page_dm_threads … partner_platform_user_id = fanRef`) для запросов Fansly с обеими ссылками; 409 `conversation_fan_mismatch`; неизвестная хабу новая пара — с пометкой кадра `pair: unverified` | `features/index.ts` (одна точка ветвления Fansly, `:347`), `context/chat-access.ts` | несовпадение → 409; новая пара → `unverified`; OnlyFans без изменений | Fansly-путь ядра без трафика |
| HF-8в | проверка покрытия окна: новое поле тела `coverageCheck {window: [{id, dir}] ≤ 60, deletedIds ≤ 60}` и новое поле кадра с ответом по каждому id (`included`, `direction_mismatch`, `outside_window`, `deleted`, `absent`, `unknown`; для удалённых — `deleted`, `still_served`, `absent`); возможность `coverage-check-v1` и токен `x-kernel-ai-capabilities`; предел поиска 100 ref — поднять или два поиска | `routes.ts:2005-2056, 2317`, `context/context-frame.ts`, `packages/db/src/repositories/ai-live-context.ts:37-41` | ответ по каждому id; удалённое вкладкой, но `included` у хаба — расхождение в кадре; поле в тесте предела тела | поле никто не шлёт |
| HF-8б | свежий текст для Fansly: убрать отказ (`live-text.ts:81-85`); ветка `dm_live_messages` в поиске свежего текста — удаления, чужие группы, отправитель, время; принадлежность группе; `live.matched` в кадре | `context/live-text.ts`, `packages/db/src/repositories/ai-live-context.ts:237-353` | хвост Fansly принят; удалённое, которое знает только сокет, — `deleted`; чужая группа — `context_conflict` | `freshText` у Fansly `platform_unsupported` до HF-2 |
| HF-6 | глубина 5000 одной настройкой на обе платформы: `AI_TRANSCRIPT_DEEP_MAX_ROWS` 5000, настройка принимает «3000»/«5000», Fansly в `mayReadDeepTranscript` (с `context-v1`), путь `live_union` передаёт `maxRows`, тело `messageCount ≤ 5000`, выбор и текст в дашборде для обеих платформ | `services/ai-transcript-depth.ts`, `packages/db/src/repositories/ai-transcript-depth.ts`, `context/index.ts:175-196`, `routes.ts:2317`, `packages/shared/src/config-registry.ts:307` | 5000 при поднятой настройке; 1500 без неё; старый Fansly-путь `clientContext` без изменений; EXPLAIN чтения 5000 | настройка стоит на 1500 |
| HF-7а | медиа в транскрипте Fansly: `media_metadata` архива (только Fansly), MIME → фото/видео/аудио, наборы | `packages/db/src/repositories/message-archive.ts:1472-1489`, `context/index.ts:96-110` | эталон AI-147; байты OnlyFans те же | трафика нет |
| HF-7б | профиль фана Fansly: имя по правилу старого (`username ‖ displayName`), сохранённое имя из `page_alias` (источник есть, не подключён, `features/index.ts:717-718`), username из `fans`, био — сохранять при гидрации; аватар — решение владельца | `features/index.ts:697-722, 921, 1091`, `sync/fansly/lib/fan-hydration.ts` | эталоны AI-034, AI-146, SP-040 | трафика нет |
| HF-7в | PPV в транскрипте: «куплено» из `media_orders`; «не куплено» — только при завершённом обходе заказов, иначе «неизвестно» | загрузчики транскрипта Fansly | эталон AI-145 | трафика нет |
| HF-7г | траты и подписка без `clientContext`: сверка формата с эталоном старого; подписка ушедших подписчиков | `context/index.ts:334-373`, загрузчики денег | эталон AI-144 | трафика нет |
| HF-7д | пометки автоматики `[Automatic / mass message]` в транскрипте; `transcriptCoverage` из цепочки для рекапов | `features/index.ts`, `context/*` | эталоны AI-033, AI-148 | трафика нет |
| HF-5 | Hi на Fansly: клиент присылает `startProof` (id окна свежего конца) и `personalMessageCount`; хаб проверяет id окна (все `included`) и порог ≤ 10; отказ `gate_hi_greeting_limit` с причиной `history_unproven` / `too_many_personal`. Решение владельца — архитектура §15.1 п. 1 | `features/index.ts:195-267` (ветка Fansly) | допуск: доказанное начало, 0 личных, автоматика; отказ без доказательства; отказ при 11 личных; старый путь `clientContext` без изменений | трафика нет |
| HF-4а | идентичность войса: `voice-script` с `conversationRef = groupId ≠ fanRef` и проверкой пары; `createVoiceNote` принимает необязательный `fanRef` и проверяет источник по паре; старый формат работает | `features/index.ts:452-487`, `services/voice-notes.ts:341-352, 412-426` | скрипт → настоящий `createVoiceNote` при разных id без `clientContext`; несовпадение пары → 409; старый клиент без изменений; стирание фана удаляет войс группы | добавочно |
| HF-4б | войсы в узком токене (`voiceNoteCreate/Status/Audio`), флаг `voice`, возможность `voice-notes-v1`, доступность в bootstrap (флаг + состояние линии войсов), `voice-script` → флаг `voice` | `client-token-scopes.ts:26-60`, `client-ai-switch.ts:29-33`, `routes.ts:6620-6690`, `services/client-capabilities.ts` | узкий токен проходит три маршрута; страница без войсов — недоступно | флаг выключен |
| HF-3 | своё приветствие без генерации: группа-объединение `{generationRef,…}` или `{kind: 'manual', textFingerprint}` (хранится `generation_ref = 'manual:' + sha256`, без миграции); лимит приветствий по назначению (`greeting` ≥ 30 в минуту; у старого пик 29, p99 21) с объявлением в bootstrap; доказательство отказа HTTP (решение — по данным пилота, до тех пор `uncertain`); на Fansly — только `purpose: greeting`; возможность `manual-greeting-v1` | `routes-client.ts:938-1015`, `services/client-claim.ts`, `packages/db/src/repositories/client-claim-transition.ts:12-16, 311-349`, `services/client-limits.ts` | своё приветствие без единого AI-запроса через настоящую схему SDK; два клиента нового — один POST; неопределённая попытка после перезапуска; `preview-reply` на Fansly → 409; id Fansly 18–19 цифр; старый маршрут без изменений | `platform_unsupported` до HF-2 |
| HF-10 | общие рекапы, сохранение досье и лента — по `conversationRef` на Fansly | `services/client-recaps.ts:99-107`, `services/client-profile-from-generation.ts:113-120`, `services/conversation-feed.ts:505` | рекап старого (`conversation_ref = groupId`) виден новому | под флагами |
| HF-12 | узкий токен: Reply, Fix, Hi, Ping, `voice-script`, `fan-notes-fill` — под флагами страницы (сейчас только мастер-выключатель и версия) | `client-ai-switch.ts:29-66` | Reply на странице Fansly без флага — 409 `flag_off`; полный токен (старое, десктоп) без изменений; пилотные страницы OnlyFans без изменений | — |
| HF-2 | Fansly в `CLIENT_FEATURE_REQUIREMENTS` по платформам (`newcomers` на Fansly — без `audience-new-v1`, с `manual-greeting-v1`); флаги Fansly `voice`, `notes`, `notesFill`, `vault`, `registration`; строку `"*"` Fansly не наследует | `client-features.ts:36-59, 146-155` | страница Fansly без строки — `flag_off`, со строкой — доступна; OnlyFans байт в байт | Fansly читает `flag_off`, пока владелец не поставит строки |

**P2v. SDK и выкладка** (chat-extension): «SDK для тестов» — после каждой схемы; «SDK для выпуска» — после выкладки
согласованного серверного этапа; `contract-change:` с перевендоренным SDK, поддельный хаб по новым правилам, строка в
`docs/contracts-changelog.md`; регистрация SDK расширения в реестре замороженных SDK хаба (`register-client-sdk.mjs`;
строки расширения там нет). Готово: e2e на поддельном хабе зелёные; в пилоте — `live.status = served`, `rejected = 0`,
ответ по каждому id. HF-1 (личность страниц) проверен чтением прода — кода нет. HF-11 (клавиша заметок) не нужен: на
Fansly клиент схемы клавиш — `fansly` (P7i).

### Этап 3. Спайк, подписанные сборки, база старого

| PR | Что | Итог | Зависит от |
|---|---|---|---|
| P3a | спайк на стенде (архитектура §15.2 п. 1–7): (1) ленивые чанки фона — `import()` из классического event page или `background.type: "module"` с WXT; (2) регистрация изолированного скрипта рядом с MAIN, порядок, `persistAcrossSessions`, обновление, WAR Fansly без выданных прав; (3) `loadstart` синхронен внутри `send()`, порядок квитанции и эха; (4) стоимость разбора кадра и ответа 115 КБ, размер MAIN-прототипа; (5) запросы скрипта другого расширения в `webRequest`; (6) `navigation.currententrychange` в изолированном мире; (7) ответы `POST /vault/albums/media`, `POST /group/<id>/` (по коду бандла) | `docs/project-unite/spike.md`; правки архитектуры | 0 |
| P3b | подписанные тестовые сборки (подпись — владелец): обновление N → N+1 с опциональными хостами и `webRequest` — без задержки и без выдачи; контрольная сборка с хостами в манифесте; «Включить Fansly» — один запрос из popup и настроек, `onAdded` при закрытом popup, `onRemoved` → снятие регистраций; пробуждение фона событием `webRequest`; `browser.webRequest` после выдачи | механизм прав в `spike.md` | P3a |
| P3d | база старого на стенде Fansly: тестовая сборка старого (2.10.x или выпуск на день перехода) с адресами стенда (подмена при сборке, без правок `fansly-chat`), сценарий §11 архитектуры ChatSpace (открыть, 20 переключений, набор, час простоя), звуки включены, заметки «Справа по кнопке» и «Всегда справа», сосед выключен и включён; Firefox Profiler в том же headless Firefox, где мерится новое | `docs/project-unite/baseline.md`: таблица метрик §4 для старого; правило — новое не хуже базы и в бюджете, иначе PR не сливается | P6a, P6b, P6d; до P7a |

### Этап F. Общее под два сайта

Каждый PR — нейтрален по байтам для ChatSpace (или освобождает их в том же PR) и держит его e2e зелёными. Порядок:
F1, F2, F3 последовательно; F4–F9 — после F3, параллельно.

| PR | Что | Файлы | Готово, когда | Зависит от |
|---|---|---|---|---|
| F1 | ленивые чанки фона: вторая сборка `bg/*`, загрузка `import(runtime.getURL(…))` или модульный event page (по P3a), реестр `HostServices`, строка бюджета «ядро фона», `archive-check` по файлам | `apps/extension/bg/vite.config.ts` (новый), `apps/extension/src/composition/background.ts`, `tools/size-budget`, `tools/archive-check/rules.ts` | `background.js` не растёт; пустой чанк-проба грузится в Firefox; e2e ChatSpace зелёные | P3a(1) |
| F2 | реестр хостов `apps/extension/src/hosts/{index,chatspace}.ts` вместо `hosts.ts`; из него — манифест и его проверка, входы WXT, хосты RPC и звука, онбординг, гейты (`MAIN_WORLD_*`, `ISOLATED_BUNDLE`), строки бюджетов, `archive-check`, `host-contract-check --host` | `apps/extension/src/hosts/*`, `build/manifest.ts`, `wxt.config.ts`, `composition/{background,pages}.ts`, `tools/{gates,size-budget,archive-check,host-contract-check}` | собранный манифест ChatSpace байт в байт прежний; гейты прежние | 0 |
| F3 | адаптер хоста: `composeTab(env, adapter)`; `tab/{runtime,keys,app,controllers,host-facts,action-gate,surfaces}.ts` — на общем `HostPort` и адаптере; адаптер ChatSpace (`start`, `keyProbe`, `routeOfLocation`, `configure` = `liveConfigOf`, план ленивых чанков) | `apps/extension/src/composition/tab*`, `apps/extension/src/entrypoints/chatspace.content.ts`, `packages/host-chatspace/src/isolated/adapter.ts` (новый) | `chatspace.js` не растёт; e2e ChatSpace зелёные | F2 |
| F4 | реестр фич и `availability()`; `FEATURE_FLAGS` уходит; док — `DockVM.chips` данными (`actions` остаётся), `Strip` по группам и приоритетам, ширинные правила — от варианта дока и приоритета; справочник клавиш, popup и токены действий читают `availability` | `packages/contracts/src/features/registry.ts`, `packages/core/src/domain/features/availability.ts`, `core/src/domain/ops/environment.ts`, `packages/ui/src/dock/{Strip,styles}.tsx`, `contracts/src/vm/dock.ts` | вид дока ChatSpace прежний (снимки галереи); первый чанк дока ≤ 45 КиБ | F3 |
| F5 | профиль сайта: `HostUiProfile` в контрактах, профиль ChatSpace (палитра — текущие `--color-om-*`, вариант `chatspace`, keep-bottom 100, клиент клавиш `extension`); `mountKitSurface` ставит палитру и `data-dock-variant` на хост; галерея с параметром `host` | `contracts/src/vm/host-profile.ts`, `packages/ui/src/kit/{tokens,mount}.tsx`, `packages/testing/src/*/gallery` | снимки галереи ChatSpace прежние | F3 |
| F6 | сайт и разговор в общем коде: шесть литералов `host: 'chatspace'` → `binding.host`; `conversationRef` из маршрута — в `workspace.ts:482`, превью, тосте, `ChatNavigator.open`, `NavigationIntent.target`, `RequestIdentity`; чтения хаба по разговору (рекап, досье, лента, бронь) берут `conversationRef` (на OnlyFans он равен `fanRef`, поведение прежнее); мёртвый `hub/src/ai-request.ts` удалён; MAIN ChatSpace принимает только `'chatspace'` | `core/src/application/{ai/workspace,preview/controller,newcomers/controller,spenders/controller,boards/navigate}.ts`, `core/src/services/scheduler.ts:1173`, `core/src/domain/ops/identity.ts`, `apps/extension/src/composition/background/hub-data.ts`, `packages/hub/src/facade.ts`, `host-chatspace/src/main/requests.ts` | тесты с `groupId ≠ fanId` на юнит-уровне для каждой поверхности; e2e ChatSpace зелёные | P4a1, F3 |
| F7 | телеметрия по сайтам: `HealthWindow` на (хост, сборка), хост в id отчёта (`facade.ts:838`), «вкладка этого хоста открыта» вместо `chatSpaceOpen`, `HostContractReport.host`; «Статус» и popup — строка на каждый сайт с привязками | `core/src/domain/telemetry/health.ts`, `core/src/services/telemetry/health.ts`, `packages/hub/src/facade.ts`, `core/src/application/pages/{view-status,view-popup}.ts`, `contracts/src/vm/pages.ts` | смешанный профиль (стенды ChatSpace и Fansly): два отчёта окна, хаб принимает оба; согласие выключено — только локально | F3 |
| F8 | копии текста: `StartMemo.start` убран (читалось только `split`); «Ещё раз» и Fix берут `memo.split` и `memo.fixSource` | `core/src/application/ai/op-store.ts` | тест: после конца операции и при живой записи результата хвоста нет нигде во вкладке | — |
| F9 | гейты: `host-literals`, `i18n-host-names`, полнота реестра, неизменность общих слоёв (сравнение замыканий); пакеты текстов по сайтам (механизм; ≈ 47 текстов на общих путях получают параметры `{host}`, `{account}`, `{platform}`) | `tools/gates/checks.ts`, `apps/extension/lazy/entries/names.ts`, `packages/core/src/domain/i18n/*` | гейты зелёные на `main`; каталог `ru` ChatSpace не растёт | F4, F5 |

### Этап 4. Контракты 1.15.0

Все — `contract-change:` с фикстурами, строкой в `docs/contracts-changelog.md` и правкой `docs/protocols/`; старые
фикстуры ChatSpace проходят без изменений, кроме мест из архитектуры §12.

| PR | Что | Файлы | Зависит от |
|---|---|---|---|
| P4a1 | сайт и маршрут: `contracts/src/hosts.ts` (`HOST_PLATFORM`, `HOST_TEXT_PARAMS`), пара хост↔платформа в `TargetSchema` из таблицы; `RouteState.conversationRef?`, `conversationKind?`; `NavigationIntent.target.conversationRef?` | `contracts/src/{hosts,ids,host}.ts` | 0 |
| P4a2 | мост Fansly: `bridge-fansly.ts` (типы, неотбрасываемые, записи), `bridge-messages-fansly.ts` (схемы), фабрика конвертов; `fansly.ts` — `FanslySnapshot`, `FanslyPagePort`, `FanslyAnchorId`, `FanslyCapability` | `contracts/src/{bridge-fansly,bridge-messages-fansly,fansly}.ts`, лёгкая фабрика в `bridge.ts` | P3a |
| P4a3 | протокол вкладки и страницы: `TypeSchema` — до двух точек; `RequestSpec.hosts?` и `mayRequest` с хостом; вид отправителя `relay` и порт `cg-relay`; `tab-messages-fansly.ts` (`fansly.followers.*`, `fansly.voice.*`, `fansly.vault.*`, `fansly.notes.*`, `fansly.relay.*`); настройки — раздел `hosts['fansly-web']` в v1; ошибки `CG-FAN-*`, `CG-NOTE-*`, `CG-VOICE-*`, `CG-VAULT-*`, `CG-FNEW-*` (приложение А архитектуры, оба каталога) | `contracts/src/{tab-protocol,tab-messages-fansly,settings,errors}.ts`, `packages/platform/src/rpc-{common,background}.ts` | P3a, P3b |
| P4b | свежесть и запрос: `StartOp.proof?: CoverageProof` (снимок вкладки или доказательство прохода; хвост — внутри); `ServedContext.coverageCheck?`; причины `stale`; `RequestIdentity` + `conversationRef`, `proofDigest`; `HostContractReport.anchors` → `partialRecord` и `extensions['fansly-web']`; `HostPort.freshness?`, `HostPort.fansly?`; `ChatWindow.fanScript?`, `newestAt?`; `HUB_AI_FEATURES` + `voice-script`, `fan-notes-fill`; поля тела под возможностями; 5000 — при `limits.deepMax ≥ 5000` | `contracts/src/{host,ops,limits,settings}.ts`, `hub/ai.ts`, `core/src/domain/ops/identity.ts` | P4a1, P4a2; схемы HF-8в, HF-4а, HF-6 слиты |
| P4c | отправка по HTTP: `send-fansly.ts` — машина состояний (`ready … sent`, `refused`, `uncertain`), журнал `fansly.send.journal` (только id), запрос приветствия «Новых» (текст поля, его ревизия, `historyRevision`, вид допуска, действие человека, опека), ручная группа | `contracts/src/send-fansly.ts`, `hub/newcomers.ts` | P4a3; схема HF-3 слита |

### Этап 5. `host-kit`

| PR | Что | Файлы | Готово, когда | Зависит от |
|---|---|---|---|---|
| P5 | вынос общего из `host-chatspace` по архитектуре §1.1 и списку S1a §2.2: `main/{guard,check}`, общая часть `main/protocol` и `main/bridge` (загрузчик), `isolated/{shadow-registry,validation,keep-bottom}`, общая часть `isolated/wire`, `bridge-client` и `validate` с реестром по хосту, хосты и слои из `mount.ts`, проба клавиш из `keyboard.ts`, `sameReport`, `digest`/`normalize`; склейка событий моста по ключу | `packages/host-kit/src/{main,isolated,common}/*`, `eslint.config.ts`, `.dependency-cruiser.cjs`, `tests/lint-boundaries.test.ts`, корневой `tsconfig.json`, `main/protocol.test.ts`, `lazy/entries/bridge-validation.ts`, `tools/gates/checks.ts` (`MAIN_WORLD_SOURCE`) | `chatspace-main.js`, `chatspace-ws.js`, `chatspace.js` — не больше прежнего; поведение ChatSpace прежнее; e2e ChatSpace зелёные | F3, P4a2 |

Сразу (X34): без окна без выпусков и без временной копии.

### Этап 6. Стенд Fansly

| PR | Что | Файлы | Зависит от |
|---|---|---|---|
| P6a | страница стенда — наше Angular-подобное приложение по структуре живого DOM (архитектура §13, S2 Q5–Q9): маршрут с пересозданием контейнера, поля и блока контакта шапки при каждой смене чата; галерея без смены адреса; `textarea` с моделью, кэш черновика через микрозадачу без событий, Enter по своему флагу Shift, отправка синхронно в обработчике, очистка микрозадачей; модалка загрузки и `app-account-media-create-template`; `body.modal-opened`; строка «печатает»; низ 1 px и 350 px, `scrollTop = 0`; виртуальный инбокс с `<a href="/messages/<id>">`; мини-чат со вторым полем; `bright-theme`; метки старого. Свой loopback-хост; манифест тестовой сборки и проверки манифеста | `packages/testing/fixture-fansly/*`, `fixture-fansly.vite.config.ts`, `packages/testing/src/stand-server.ts`, `apps/extension/src/hosts/fansly.ts` (тестовые адреса), `build/manifest.ts` | P4a1 |
| P6b | поддельный Fansly: XHR-API (`ngsw-bypass`, `responseType: 'text'`, конверт, `/account/me`, `/messaging/groups` с `aggregationData`, `/group/<id>/`, `/message?groupId=` со свежим концом и `before`, `/messages?ids=`, `/message/unread`, `POST /message`, `/message/ack`, `/message/automated`, пути «Новых», заметки, vault, 429, `success:false`); сокет `{t, d}`: эпохи и пересоздание, `t:1`, пинг `"p"`, 5/1, 5/10 с каскадом `type 3`, 4/2, 5/22, 3/2, пакеты `t:10001`, повреждённые кадры; прокси для relay; журнал вызовов по происхождению — проверки «только FS-NET-1» и «ноль `/message/ack` от нас» на сервере | `packages/testing/src/fake-fansly/{api,socket,data,proxy,journal}.ts` | P4a2 |
| P6c | поддельный хаб для Fansly: страницы с 18-значными id, `groupId ≠ fanId`, вердикты по платформам (HF-2), правила HF-8 (окно, удалённые, по каждому id), HF-5 (доказательство и порог), HF-9 (пара), опека HF-3 с ручной группой и лимитом, `voice-script` и `createVoiceNote` по HF-4а; `aiNameFan` метит по `conversationRef` | `packages/testing/src/fake-hub/{config,data,ai,ai-rules,claims}.ts`, `scenarios/hub/world.ts` | P4b, P4c; схемы HF-3, HF-4а, HF-5, HF-8, HF-9 слиты |
| P6d | сосед (FBuddy) по S5 §6: режимы `off`, `after`, `before`, `reinject`, `legacy`, флаги `+guard`, `panel=desktop\|mobile\|off`, `generic`; хуки прототипа XHR и подмена `fetch`, постинг тел ответов в `window`, фильтр слов, узлы в шапке и поле, слой в `<body>`, стили `contain: size` и двухстрочное поле, запись заголовка раз в 10 с, клавиша перевода ⌘⇧L, заметка «FBuddy Notes» | `packages/testing/src/fake-fansly/neighbor/*` | P6a |

### Этап 7. `host-fansly` и подключение сайта

Пакет `packages/host-fansly/src/{main,isolated,testing}`; входы `apps/extension/src/entrypoints/{fansly-main,fansly}.ts`
(регистрируемые); запись `apps/extension/src/hosts/fansly.ts`; гейты MAIN — по реестру (F2).

| PR | Что | Файлы | Перенос из старого | Тесты PR | Зависит от |
|---|---|---|---|---|---|
| P7a | MAIN: установка, захват натива (§5.1), Proxy `construct` над `WebSocket` и `XMLHttpRequest`, слушатели на экземплярах, разбор кадров (три уровня, `t:10001`, признак полноты, проекции), таблица ответов XHR, отложенный разбор `/messaging/groups`; бюджет MAIN | `main/{index,ws-tap,xhr-tap,frame-parse,responses}.ts`, `tools/size-budget` | `src/content/page-socket-tap.ts`, `src/shared/fansly-ws-frame.ts` | SN-017…020, FS-WS-1…5; невидимость Proxy; рядом с соседом во всех режимах — у нас и у него те же кадры и ответы, фильтр слов соседа работает; бюджет MAIN | P5, P6b, P6d, P3d |
| P7b | MAIN: наблюдение чатов (кольца, LRU, память), сертификаты и полнота (эпоха сокета, `t:1`, перекрытие), личность и группы, снимок генерации, счёт личных для Hi | `main/{observation,certificate,memory,identity,snapshot,automation}.ts` | классификатор `src/shared/followers.ts:74-87` | FS-TAIL-3…7, FS-IDN-1, 3: запрос до `t:1` и старая страница не дают сертификата; первый сертификат длинного чата; восстановление после штатного перезапроса; каскад удаления `type 3`; ускоренный тест пределов памяти; снимок ≤ 5 мс | P7a |
| P7c | изолированный мир: старт, адаптер Fansly, маршрут (три наблюдателя, `popstate`, `pageshow`, Navigation API при наличии), личность, `HostPort`, порт `freshness`; бюджет раннего бандла | `isolated/{start,adapter,route,identity,host-port,freshness}.ts` | — (опрос адреса старого не переносится) | FS-RTE-1…4; счётчик «адрес без сигнала»; галерея; бюджет раннего бандла | P7b, F3 |
| P7d | монтирование дока, оверлеи, тема и вариант дока, «только копировать», деградация | `isolated/{mount,theme}.ts` | `src/content/conversation-mount-controller.ts` (без наблюдения всего разговора) | FS-PLC-1…7, FS-CTR-2; низ 350 px; строка «печатает» поверх дока; узкая колонка (сосед `panel=desktop`); 200 смен чата — записи наблюдателей ограничены | P7c |
| P7e | вставка и «Открыть и вставить» | `isolated/{insert,navigate}.ts` | `src/content/textarea.ts`, навигация SP-036 | UI-021, SP-036, FS-INS-1…4: 200 переключений, ввод между снимком и записью, восстановленный черновик, IME-композиция, записи соседа до и после нашей | P7d |
| P7f | отправка человеком и `sent`: жест в MAIN, `loadstart`, квитанция, эхо; связь с записью черновика | `main/send-gesture.ts`, `isolated/send-observe.ts` | — | FS-SEND-1, 2; два кандидата → не атрибутировано; отправка, «проглоченная» фильтром соседа, — нет `sent`, следующая атрибутирована; отправка с медиа не атрибутирована | P7e |
| P7g | старое расширение, своя старая копия, сосед: распознавание и отступление, баннеры, булевы FBuddy | `main/legacy.ts`, `isolated/legacy.ts` | маркеры `src/content/bootstrap.ts`, `page-socket-tap.ts` | NEW-12, FS-CO-1: старое до и после нашего MAIN; выключено без перезагрузки — баннер; старая копия после обновления — отступление | P7c |
| P7h | проверка контракта против бандла | `tools/host-contract-check/{check,anchors-fansly}.ts` | — | `--host fansly` на снимке 2026-10-12 — все якоря на месте | P7d |
| P7i | подключение сайта: регистрируемые входы, запись реестра, регистрация вкладки с хостом, ранний клавиатурный щуп Fansly (клиент схемы `fansly`, уступка при `body.modal-opened` и фокусе в `fb-*-ui`, Enter за страницей) | `apps/extension/src/entrypoints/{fansly-main,fansly}.ts`, `apps/extension/src/hosts/fansly.ts`, `composition/tab/keys.ts`, `core/src/domain/hotkeys/resolver.ts` | — | FS-HK-1; Fansly, ChatSpace и обе вкладки сразу; модалка Fansly; окно соседа; ⌘⇧L по решению владельца | P7c, P9a |

### Этап 8. Ядро и UI на Fansly

| PR | Что | Файлы | Тесты PR | Зависит от |
|---|---|---|---|---|
| P8a | `groupId` на каждой поверхности Fansly (FS-IDN-6): док, превью, тост | `core/src/application/{ai,preview}/*` (поверх F6) | `suite-fansly-ids` (док, превью, тост): `groupId ≠ id фана` | P7i, F6 |
| P8b1 | путь старта на Fansly: снимок `freshness` вместо `readVisibleTail`, `StartOp.proof`, поля запроса (`coverageCheck` при возможности), `messageCount` ≥ окна проверки; код — в слое `ai-fansly` | `core/src/application/hosts/fansly/ai/*`, `apps/extension/lazy/entries/ai-fansly.ts` | запрос несёт окно, известные id, удалённые, хвост; слой `ai` ChatSpace не меняется | P8a, P4b |
| P8b2 | вердикт §3.5 спецификации и пометка с «Ещё раз» (`StaleRow`); запрет отправки без свежего вердикта | `core/src/application/ai/*`, `packages/ui/src/dock/Result.tsx` | таблица §3.5 построчно | P8b1 |
| P8b3 | ключ запроса с отпечатком доказательства; повторно открытый результат — со своим вердиктом | `core/src/domain/ops/identity.ts`, `core/src/services/scheduler.ts` | `suite-fansly-tail` целиком (владелец спека) | P8b2 |
| P8c | AI-функции на Fansly: Hi с доказательством (клиент отказывает при доказанных > 10 личных, иначе решает хаб), Ping (блок активного фана), Recap (глубина из `limits.deepMax`, до 5000), Review, Coach | `core/src/domain/features/gates.ts`, `core/src/application/hosts/fansly/ai/*` | AI-032…037, ST-137; Hi с 1 личным и 40 автоматическими при доказанном начале; Hi без доказательства — отказ хаба словами порога | P8b1 |
| P8d | тема Fansly и вариант дока `fansly`: палитра из переменных страницы, обе темы | `packages/host-fansly/src/isolated/theme.ts`, `docs/ui-design.md` (таблица соответствия) | снимки галереи `host=fansly` в обеих темах | P7d, F5 |
| P8e | параллельные генерации на Fansly | — (ядро общее) | `suite-fansly-ops`: три чата, четвёртая — отказ со списком, вставка только в свой чат | P8b3 |

### Этап 9. Права, `fansly-api`, relay, отправка, Spenders

| PR | Что | Файлы | Перенос из старого | Тесты PR | Зависит от |
|---|---|---|---|---|---|
| P9a | права и регистрация: «Включить Fansly» (один запрос по жесту), `onAdded`/`onRemoved`, синхронизация регистраций MAIN и ISOLATED на каждом старте фона; слушатель `webRequest` в ядре фона, шаблон сессии в памяти и `storage.session`, фильтр запросов страницы | `packages/platform/src/{permissions,scripting,web-request}.ts`, `apps/extension/src/composition/background.ts` (ядро) | `src/background/{session-capture,session-store}.ts` | BG-007, EX-004, AU-031…033; FS-NET-2, FS-PERM-2; шаблон переживает сон фона; запрос соседа из той же вкладки не переписывает шаблон | F1, F2, P3b |
| P9b | `fansly-api`: допуск FS-NET-1, конверт и ошибки, заголовки, `ngsw-bypass`; пейсер — правила E130–E135 данными, режим на вызов (архитектура §8.4); чанк `bg/fansly`; гейты: `fetch` только в `hub`, `fansly-api` и входе relay; адреса ⊂ `https://apiv3.fansly.com/api/v1/`; строки `/message/ack` нет вне `packages/testing`; гейт очереди отправки не задевает `fansly-api` | `packages/fansly-api/src/{client,allowlist,errors,pacer/*}.ts`, `tools/gates/checks.ts` | `src/background/fansly-client.ts`, `src/background/fansly-pacer/*` | RB-023, NF-037; `success: false` при 200; 429 от чужого запроса — охлаждение общее, источник в счётчике | P9a |
| P9c | relay: ленивый кадр на пачку работы + 60 с, порт `cg-relay` и правила отправителя, маршрут до опеки | `apps/extension/src/entrypoints/fansly-relay/{index.html,main.ts}`, `packages/platform/src/rpc-relay.ts`, `packages/fansly-api/src/transport.ts` | `src/fansly-relay/index.ts`, `src/background/fansly-transport.ts` | FX-001, FS-NET-4: смена документа или аккаунта → отказ до опеки; запрос через прокси стенда | P9b, P4a3 |
| P9d | отправка приветствия по HTTP с опекой (архитектура §8.6) | `packages/core/src/services/hosts/fansly/send.ts`, `packages/hub/src/facade.ts` | `src/background/followers-service.ts:1012-1127` с проверками до них | `suite-fansly-send`: падение до и после POST, потерянный ответ, эхо раньше квитанции, позднее эхо после перезапуска, два клиента, `200 {success:false}` → `uncertain`, билет 10 с | P9c, P4c, P6c |
| P9e | Spenders на Fansly: `groupId` из строк Spenders хаба, кэша страницы, поиска в инбоксе или `POST /group`; имена из хаба; «Открыть и вставить» | `core/src/application/spenders/*`, `packages/fansly-api` | `src/background/spenders-service.ts:773-799`, `runtime-api.ts:1496-1539` | SP-037…041, FS-SPD-1, 2; `groupId ≠ id фана` для Spenders | P9b, P8a |

### Этап 10. «Новые» Fansly

| PR | Что | Файлы | Перенос из старого | Тесты PR | Зависит от |
|---|---|---|---|---|---|
| P10a | окно 1–720 ч, список, статусы, фильтр, поиск, страницы, карточка, превью до 750 сообщений, «Открыть в Fansly», проверка запросов окна; общая `NewcomersVM` с источником Fansly через порт | `core/src/application/newcomers/*` (порт источника), `core/src/domain/hosts/fansly/newcomers/*`, `packages/ui/src/hosts/fansly/newcomers/*` | `src/content/followers/index.ts`, `src/shared/followers.ts` | NF-001…011, NF-025…027 | P8a, P9b |
| P10b1 | проход Б17 в фоне, автоочередь, ручные действия, пауза, баннер охлаждения; изменения строк в окно по порту, без опроса | `core/src/services/hosts/fansly/newcomers.ts` | `src/background/followers-service.ts` (проход и очередь), `welcome-definitions.ts` | NF-030…036, NF-038, NF-039; FS-NEW-4 | P10a |
| P10b2 | «Нельзя написать» до запроса, «К обработке», исключение | `core/src/domain/hosts/fansly/newcomers/dm-permissions.ts` | `src/shared/fansly-dm-permissions.ts` | FX-003, FS-NEW-2 | P10b1 |
| P10b3 | журнал прохода в IndexedDB с ротацией | `core/src/services/hosts/fansly/newcomers.ts`, `packages/platform/src/idb.ts` (`openBoundedStore`) | журнал старого (`README.md:162-186`) | NF-029, FS-NEW-5; память фона | P10b1 |
| P10c | приветствие: доказательство прохода (FS-NEW-7), три допуска (FS-NEW-6), отправка с опекой, подсказка «AI ничего не отправляет автоматически» | `core/src/application/newcomers/*`, `core/src/services/hosts/fansly/send.ts`, `packages/ui/src/hosts/fansly/newcomers/*` | `src/content/followers/index.ts:389-416` | NF-012…024, NF-028; три допуска; хаб догнал — старый результат не уходит; `groupId ≠ id фана` в «Новых» | P10b2, P9d |
| P10d | `suite-fansly-newcomers` целиком | `packages/testing/e2e/specs/suite-fansly-newcomers.e2e.ts` | — | два клиента — один POST; история изменилась — отказ; своё приветствие без AI | P10c, P10b3 |

### Этапы 11–14

| PR | Что | Файлы | Перенос из старого | Тесты PR | Зависит от |
|---|---|---|---|---|---|
| P11a | «Регистрация»: контроллер слота шапки (вставка заново на каждую смену чата, идемпотентно), дата из snowflake, одна попытка `GET /group/<id>`, дубль в панели фана | `host-fansly/isolated/header-slot.ts`, `core/src/domain/hosts/fansly/snowflake.ts`, `packages/ui/src/fanpanel/*` | `src/content/{fan-registration,header-row-slot}.ts`, `src/shared/fansly-id-time.ts` | FX-002, FS-REG-1…4; рядом с соседом `panel=mobile` слот переживает его узлы | P7d, P9b |
| P11b | «Заметки»: кнопка со счётчиком в слоте после «Регистрации», ⌘⇧K (клиент схемы `fansly`), панель (три вида, имя для себя, заметки, «+ По шаблону», черновики по фану), заметка «FBuddy Notes» — чужая, только чтение | `packages/ui/src/hosts/fansly/notes/*`, `core/src/application/hosts/fansly/notes/*`, `packages/fansly-api/src/notes.ts` | `src/content/fan-notes/*`, `src/shared/fan-notes.ts`, заметки в `fansly-client.ts` | FX-004…, FS-NOTE-1…5, `suite-fansly-notes` | P11a |
| P11c | «✨ Заполнить из чата» (`fan-notes-fill`): только названия полей анкеты в хаб, глубокое окно, `conversationRef = groupId`, `fanRef`; «было → станет» | `core/src/application/hosts/fansly/notes/fill.ts`, `packages/ui/src/hosts/fansly/notes/*` | E159–E161 старого (`@ff30d00`) | строки «Заполнить из чата» (P1a); в хаб не уходят значения полей | P11b; HF-6, HF-7б, HF-12 |
| P12a | `voice-script` на клиенте: `groupId` и `fanRef` раздельно, без `clientContext` | `core/src/application/hosts/fansly/voice/*` | — | AI-111; скрипт при разных id | P8b1; HF-4а |
| P12b1 | хранилище оплаченных попыток: опека в фоне, переживающая выгрузку event page, CAS по ревизии, RPC-подтверждения | `core/src/domain/hosts/fansly/voice/attempts.ts`, `core/src/services/hosts/fansly/voice-attempts.ts`, `packages/platform/src/storage.ts` | `src/background/voice-attempt-store.ts`, `src/content/voice/attempt-store.ts` | AI-113: потерянное подтверждение записи, перезапуск фона, конфликт версий | P12a |
| P12b2 | поток войса: скрипт → варианты → оплата → статус → аудио (`fetchVoiceNoteAudio`); граница оплаты проверяет сохранённую попытку | `core/src/services/hosts/fansly/voice.ts` | `src/background/voice-service.ts` (в т. ч. `:995-1014`) | AI-112, AI-115, ER-075…078 | P12b1; HF-4б |
| P12b3 | панель войса, «Новый войс», «Скачать MP3» | `packages/ui/src/hosts/fansly/voice/*` | `src/content/voice/{voice-panel,attempt-controller,voice-studio}.ts` | AI-110; снимки обеих тем | P12b2 |
| P12c | прикрепление в поле этого чата: передача файла (два пути), модалка Fansly, подтверждение по `app-account-media-create-template` | `host-fansly/isolated/voice-attach.ts` | `src/content/voice/attach-adapter.ts`, `src/content/native-file-handoff.ts` | AI-114, `suite-fansly-voice` целиком; мини-чат не получает файла; модалка закрыта без вложения — «неизвестно» | P12b3 |
| P13a | загрузчик vault: файл на `change`, подтверждение `fx.vaultAdded` и перезагрузка альбома, контрольные точки | `host-fansly/isolated/vault/*` | `src/content/vault/{upload-runner,vault-dom,checkpoint-store}.ts` | VA-001…006, AU-036 | P7d |
| P13b | панель vault | `packages/ui/src/hosts/fansly/vault/*` | `src/content/vault/vault-panel.ts` | `suite-fansly-vault` целиком | P13a |
| P14a | звуки: факты пачкой, подписчики из сокета, фокус без права `tabs`, набор «своих», тоны Fansly | `core/src/services/sound/*`, `core/src/domain/sound/*` | `src/background/message-sound-service.ts` | FS-SND-1, 2, `suite-fansly-sound` | P7a, P7i |
| P14b | настройки (раздел сайта), popup, «Статус» (строка на сайт, FBuddy, фильтр слов), отладка для Fansly | `packages/ui/src/pages/*`, `core/src/application/pages/*` | `src/options/*` (разделы Fansly) | ST-077, ST-079, LG-026, DB-010, DB-015; FS-SET-1…3 | F7, P9a |
| P14c | «Включить Fansly», отзыв прав и выключение посреди отправки, платного войса, загрузки vault | `core/src/application/pages/*`, `packages/platform/src/permissions.ts` | — | FS-PERM-1…5, `suite-fansly-perms` | P9a, P10c, P12c, P13b |

### Этап 16. Приёмка и пилот

| PR | Что | Файлы | Зависит от |
|---|---|---|---|
| P16a | perf для Fansly: бюджеты §4 как гейт; профиль 10 вкладок Fansly с ChatSpace; рост памяти после 100 переключений и 20 циклов оверлея; сосед выключен и включён; сравнение с базой P3d | `packages/testing/e2e/perf/fansly-perf-probe.e2e.ts`, `packages/testing/package.json`, `packages/testing/e2e/wdio.conf.ts` | 1–14 |
| P16b | долгий прогон: 8 ч событий 300+ чатов на стенде — задача агента с чек-листом, не CI | `docs/project-unite/long-run.md` | P16a |
| P16c | пилот: флаги на `lora-1` и `ari-1` (владелец); все чаттеры этих страниц в один день выключают старое и нажимают «Включить Fansly»; согласие на телеметрию на пилотных профилях; инструкция: войсы и vault доделать в старом до перехода | `docs/project-unite/pilot.md` | P16a; «SDK для выпуска» |
| P16d | наблюдение пилота вместо smoke: агент по чек-листу читает «Статус», `client_health` и журналы — хвосты и пометки, якоря, `sent`, приветствия, войсы, vault, ошибки, бюджеты против базы P3d; что видно только глазами — один вопрос владельцу | `docs/project-unite/pilot.md` | P16c |
| P16e | вкладка-хранитель присутствия и отчёты здоровья только при изменении — по замеру P16a (архитектура §10.3) | `apps/extension/src/composition/tab/runtime.ts` | P16a |

### Этап 17. После пилота

- **P17.** Навигация J/K, ⌘1–9, ⌘U и палитра на Fansly — из данных, которые страница уже получила; инбокс виртуальный,
  расширение его не листает.

## 3. Каталог e2e для Fansly

| Спек | Владелец (последний PR цепочки) | Что проверяет | Требования |
|---|---|---|---|
| `suite-fansly-dock.e2e.ts` | P7d | монтирование, смена чата, галерея, деградации, мини-чат, поздняя установка, низ ленты, строка «печатает» | FS-DOCK-*, FS-PLC-*, FS-CTR-* |
| `suite-fansly-insert.e2e.ts` | P7e | 200 переключений, ввод между снимком и записью, восстановленный черновик, IME, Б2, «Открыть и вставить» | FS-INS-*, FS-RTE-* |
| `suite-fansly-send-observe.e2e.ts` | P7f | жест → `loadstart` → квитанция → эхо; «проглоченная» отправка; медиа | FS-SEND-1, 2 |
| `suite-fansly-host.e2e.ts` | P7i | Fansly, ChatSpace и обе вкладки; модалка Fansly; окно соседа; Enter за страницей | FS-HK-1 |
| `suite-fansly-neighbor.e2e.ts` | P7i (тап, док, вставка, отправка); P11a, P11b добавляют шапку | всё рядом с соседом во всех режимах; он видит те же кадры и ответы, его фильтр работает | FS-CO-4 |
| `suite-fansly-legacy.e2e.ts` | P7g | старое расширение на странице — новое отступает; своя старая копия после обновления | FS-CO-1 |
| `suite-fansly-tail.e2e.ts` | P8b3 | хвост за 0,5 с, 11 сообщений, A→B→A, разрыв, `t:1`, bfcache, вытеснение, пакеты, сертификаты, `lastMessage`, каскад удаления, удаление перед генерацией при отстающем хабе, окно Hi, кэш, копии | FS-TAIL-*, FS-WS-*, FS-PRIV-1 |
| `suite-fansly-ids.e2e.ts` | P8a (док, превью, тост); P9e — Spenders; P10c — «Новые» | `groupId ≠ id фана` | FS-IDN-6 |
| `suite-fansly-ops.e2e.ts` | P8e | параллельные генерации | FS-OPS-1 |
| `suite-fansly-send.e2e.ts` | P9d | матрица сбоев HTTP-отправки с опекой | FS-SEND-*, FS-NEW-3 |
| `suite-fansly-relay.e2e.ts` | P9c | ленивый relay, маршрут до опеки, прокси, смена документа | FS-NET-4 |
| `suite-fansly-network.e2e.ts` | P9b | список FS-NET-1, ноль `ack`, ноль OnlyMonster — по журналу сервера | FS-NET-1 |
| `suite-fansly-newcomers.e2e.ts` | P10d | окно, Б17, «Нельзя написать», три допуска, два клиента | FS-NEW-* |
| `suite-fansly-registration.e2e.ts` | P11a | «Регистрация» | FS-REG-* |
| `suite-fansly-notes.e2e.ts` | P11b, P11c | «Заметки»: виды, чтения, записи по действию, охлаждение, «FBuddy Notes»; «Заполнить из чата» | FS-NOTE-* |
| `suite-fansly-voice.e2e.ts` | P12c | скрипт, оплата, прикрепление через модалку | FS-VOI-* |
| `suite-fansly-vault.e2e.ts` | P13b | загрузка, контрольные точки | FS-VLT-* |
| `suite-fansly-sound.e2e.ts` | P14a | звуки, дедупликация, фокус | FS-SND-* |
| `suite-fansly-perms.e2e.ts` | P14c | «Включить Fansly», отзыв посреди операций | FS-PERM-* |
| `perf/fansly-perf-probe.e2e.ts` | P16a | бюджеты, 10 вкладок, рост памяти, сосед вкл/выкл | FS-PERF-* |

## 4. Бюджеты

Стартовые значения — архитектура §3.1, §10.1; утверждаются по базе P3d. Правило: новое не хуже базы старого и в бюджете,
иначе PR не сливается (или разбор с решением владельца). Бюджеты ChatSpace не меняются.

| Что меряем | Бюджет | Где и кем | Когда |
|---|---|---|---|
| MAIN (`fansly-main.js`) | ≤ 16 КиБ gzip; ≤ 1 мс на `document_start` | `tools/size-budget`, `bundle-timing` | P7a и далее каждый PR |
| ранний изолированный (`fansly.js`) | ≤ 30 КиБ gzip; ≤ 3 мс | `tools/size-budget` | P7c и далее |
| ChatSpace (`chatspace-main.js`, `chatspace-ws.js`, `chatspace.js`, слои, `background.js`) | не растут | `tools/size-budget`, `archive-check` | каждый PR этапа F и P5 |
| ядро фона и `bg/fansly.js` | ядро не растёт от Fansly; чанк — ≤ 200 КиБ raw стартово | `tools/size-budget`, `archive-check` | F1 и далее |
| разбор кадра / ответа XHR | ≤ 0,1 мс в среднем / ≤ 2 мс на задачу | своя метрика в `client_health` | P7a |
| отправок моста | ≤ 1 на задачу; печатание и квитанции — 0 | счётчик | P7a |
| снимок генерации | ≤ 5 мс | своя метрика | P7b |
| память наблюдения MAIN | ≤ 4 МиБ (тексты ≤ 2 МиБ) | ускоренный тест (P7b), долгий прогон (P16b) | P7b, P16b |
| `routeToDockMs`, `insertMs` | p95 ≤ 50 мс winpc / ≤ 30 мс Mac; p95 ≤ 100 мс | perf-проба | P7d, P7e, P16a |
| первый чанк дока | ≤ 45 КиБ gzip (общий) | `tools/size-budget` | F4 и далее |
| ленивые чанки Fansly | ≤ 30 КиБ каждый; войсы при превышении — делить | `tools/size-budget` | P8b1, P10a, P11a, P11b, P12b3, P13b |
| фон | ≤ 30 МБ на профиль (бодрствует, пока Fansly активен) | `about:memory`, сценарий 10 вкладок | после P9d, P10b3, P12b2 и в P16a |
| вкладка | цель +15 МБ, гейт пробы 25 МБ; рост ≤ 5 МБ за 100 переключений и 20 циклов оверлея | perf-проба | P16a |
| простой | ни одного своего таймера > 1 Гц; p95 ввода ≤ база + 5 мс; сравнение с P3d; сосед вкл/выкл | Firefox Profiler на стенде | P16a |

## 5. Риски

| Риск | Чем закрываем |
|---|---|
| Вставка в чужой чат (P1) | FS-INS-1, якоря через маршрут, `suite-fansly-insert` |
| Тихая потеря хвоста | архитектура §5.6, HF-8, `suite-fansly-tail`, учёт долей по хосту |
| Неверный `groupId` в запросе | F6, FS-IDN-6, HF-9 в хабе, `suite-fansly-ids` на каждой поверхности |
| ChatSpace утяжелится от общего рефакторинга | бюджеты ChatSpace в «готово» каждого PR этапа F и P5; гейт неизменности общих слоёв |
| Фон упрётся в потолок 800 КиБ | F1 до первой службы Fansly; чанк `bg/fansly` |
| Hi на Fansly отказывает почти всем | доказательство от вкладки и прохода (архитектура А8), решение владельца |
| FBuddy «проглатывает» отправку | атрибуция по `loadstart`, `suite-fansly-send-observe` с `+guard` |
| Мы ломаем фильтр слов и журнал FBuddy | только `construct`-ловушки, без копий методов; e2e соседа проверяет его работу |
| Двойное приветствие в дни перехода | страницу переводят целиком (X34); между чаттерами нового — опека хаба (HF-3), `suite-fansly-newcomers` |
| Войс не проходит хаб | HF-4а целиком до `createVoiceNote`, `suite-fansly-voice` |
| Двойная оплата войса | P12b1 (фоновая опека и CAS); при переходе войсы доделываются в старом |
| Новая сборка Fansly ломает якоря | контракт и деградация по одной функции, `host-contract-check --host fansly` |
| Fansly переходит на `withFetch` | якоря ответов покажут; запасной наблюдатель `fetch` |
| Proxy заметны скриптам страницы | только `construct`, без правки прототипов; страница Fansly таких проверок не делает (S2 Q10) |
| Запрос через чужую сессию или прокси | relay привязан к вкладке и документу, прямого запасного пути нет; шаблон только из запросов страницы |
| AI беднее старого | HF-5…HF-7 по полям, эталоны сформированного контекста; HF-10 для рекапов |
| Телеметрия смешивает хосты | F7 |
| Память фона и MAIN | архитектура §5.5, ленивый чанк фона, журнал «Новых» в IndexedDB, перемеры после тяжёлых служб |
| Бюджеты без базы | P3d до P7a, в двух условиях соседа |
| Хаб не готов к пилоту | функции читаются «хаб пока не умеет», ничего не ломается |
| Объём растёт с выпусками старого | паритет — на день перехода (X34): каждый выпуск старого до перехода — новые строки матрицы и PR (уже: 2.10.x «Заполнить из чата») |
| Нет живой проверки до пилота | способы старого, которые работают вживую; стенд с соседом; пилот на двух страницах с наблюдением |

## 6. Где нужен владелец

| Когда | Что |
|---|---|
| до HF-5 и P8c | решения архитектуры §15.1: доказательство Hi, ⌘⇧L, аватар для Hi, организация FBuddy, согласие на телеметрию в пилоте |
| P3b | подпись тестовых сборок |
| P16c | флаги на `lora-1` и `ari-1`, выдать расширение чаттерам этих страниц |
| выпуски | подпись выпусков нового |
