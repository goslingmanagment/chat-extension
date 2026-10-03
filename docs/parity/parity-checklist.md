# Чек-лист паритета: Fansly-расширение + десктоп → новое расширение

Дата: 2026-10-03. Для арены по архитектуре расширения `chat-extension`.

Что это. Полный список функций обоих нынешних клиентов, сверенный с их кодом, и
для каждой — куда она попадает в новом расширении. Планка владельца (X6, план §0):
интерфейс с нуля, но переносится всё, включая логи, отладку, настройки, popup и
тосты; убрать функцию можно только с его согласия.

Источники и версии:
- Fansly-расширение: `~/code/1-platform/fansly-chat`, HEAD `a534d72`, версия 2.7.1.
  Пути в колонке «Fansly» — от корня этого репозитория.
- Десктоп: `onlyfans-chat`, worktree `chatspace-integration`, HEAD `357b14e`
  (main + коммиты с документами), версия 0.1.64. Пути в колонке «Десктоп»
  сокращены: `r/` = `apps/desktop/src/renderer/src/`, `f/` =
  `apps/desktop/src/renderer/src/features/`, `m/` = `apps/desktop/src/main/`,
  `p/` = `apps/desktop/src/preload/`, `s/` = `packages/shared/src/`, `hk/` =
  `packages/chatgoose-hotkeys/dist/`, `docs/` = `docs/` десктопа.
- Отправная точка — инвентаризации `chat-extension/docs/research/onlymonster-chatspace/
  fansly-extension.md` и `desktop-app.md`; обе проверены по коду и дополнены
  (расхождения — в конце, раздел «Где инвентаризации ошибались»).
- Сверку делали три прохода (Fansly целиком; десктоп — функции чаттера; десктоп —
  операторские и служебные функции), сведение и итоговые цели — координатор.
  Строки, которые есть в обоих клиентах, сведены в одну с двумя ссылками.

Цели:
- `pilot-chatspace` — должно быть в пилоте поверх ChatSpace (OnlyFans);
- `fansly-phase` — нужно только на fansly.com (фаза 2, адаптер Fansly);
- `provided-by-chatspace` — ChatSpace уже делает это сам;
- `not-applicable` — в новом клиенте не нужно или невозможно (причина в строке);
- `needs-owner-decision` — нужен ответ владельца (вопросы собраны в конце).

Колонка «Почему» обязательна для всего, что не `pilot-chatspace`; у пилотных строк в
ней — уточнение, как функция выглядит на ChatSpace. Ссылки «план §N» —
`chat-extension/docs/hub-integration-plan.md`, X1–X7 — `chat-extension/docs/decisions.md`,
Dnn — журнал решений десктопа, Ennn — журнал Fansly-расширения.

---

## 1. AI-функции

### 1.1 Reply, тоны, Split

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| AI-001 | Reply | Ответ на переписку (`fast-reply`) с персоной и тоном | src/shared/features.ts:44-55 | f/ai/AiPillRow.tsx:237-258; s/features.ts:54-68 | pilot-chatspace | |
| AI-002 | Тоны | Casual / Flirt / Sell / Spice (десктоп: casual / flirty / upsell / spicy); none — только персона | src/content/button-bar.ts:70-80,222-232 | f/ai/dockLogic.ts:27-45; s/types.ts:21 | pilot-chatspace | |
| AI-003 | Сколько живёт выбранный тон | Fansly: тон разовый, сбрасывается после запроса и при закрытии; десктоп: держится до смены чата | src/content/index.ts:610-677,1706-1714 | f/ai/aiStore.ts:541-555 | needs-owner-decision | Клиенты ведут себя по-разному (вопрос В1) |
| AI-004 | Тон по умолчанию | Fansly: тона нет, пока не выбран; десктоп: `defaultReplyTone = casual`, в интерфейсе не настраивается | src/content/button-bar.ts:222-232 | s/constants.ts:151-152; m/settings/store.ts:306 | needs-owner-decision | Вместе с AI-003 (вопрос В1) |
| AI-005 | Выбор тона в меню Reply ▾ | Выбор тона сразу запускает генерацию в этом тоне | — | f/ai/AiPillRow.tsx:98-179; f/ai/TonePopover.tsx:1-25 | pilot-chatspace | Одна схема выбора тона на оба клиента |
| AI-006 | Тоны в панели результата | Повторный клик по активному тону снимает его | src/content/index.ts:1816-1824 | f/ai/AiDock.tsx:527-562 | pilot-chatspace | |
| AI-007 | Regenerate помнит тон | Без нового выбора повторяет тон оригинала; память сбрасывается при смене чата | src/content/index.ts:1510-1515,2126-2129 | — | pilot-chatspace | |
| AI-008 | Перебор тонов хоткеем | none → casual → flirty → upsell → spicy | src/content/index.ts:1146-1155 | r/app/KeymapProvider.tsx:371-376 | pilot-chatspace | |
| AI-009 | Опции заблокированы во время генерации | Тон и Split не меняются, пока идёт операция | src/content/index.ts:1804-1817 | — | pilot-chatspace | |
| AI-010 | Split | Ответ из 2–3 сообщений; флаг «залипает» и общий для Reply и Fix | src/content/button-bar.ts:120-128,179-189; src/content/index.ts:477-503 | f/ai/AiDock.tsx:564-588; f/ai/aiStore.ts:601-603 | pilot-chatspace | |
| AI-011 | Подписи частей Split | «Message 1 / Follow-up N», «Suggested first send», «отправлять по одной», предупреждение о единственной части | src/content/ui/view-helpers.ts:168-237 | — | pilot-chatspace | |

### 1.2 Fix (Improve)

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| AI-020 | Fix / Improve | Переписывает черновик (`improve-draft`, окно 25) | src/shared/features.ts:56-67; src/content/index.ts:447-466 | f/ai/AiPillRow.tsx:259-270; s/features.ts:69-83 | pilot-chatspace | Черновик читается из TipTap ChatSpace |
| AI-021 | Fix без черновика | Fansly: тост «Write a draft… then use Fix.»; десктоп: кнопка неактивна | src/content/index.ts:1445-1451 | f/ai/aiStore.ts:394-395 | pilot-chatspace | Текст перевести |
| AI-022 | Куда идёт результат Fix | Fansly: одна часть сама заменяет черновик; десктоп: результат дописывается под черновиком | src/content/index.ts:4054-4083 | f/ai/dockLogic.ts:100-102; f/ai/aiStore.ts:672-686 | needs-owner-decision | Клиенты расходятся (вопрос В2); при любой схеме сверять ревизию черновика (план §4) |
| AI-023 | Fix + Split | 2–3 части привязаны к исходному черновику; Regenerate переписывает тот же исходник | src/content/index.ts:1474-1478,4039-4052 | s/features.ts:79; f/ai/aiStore.ts:405-433,466-480 | pilot-chatspace | |
| AI-024 | Кэш Fix | Ключ — текст черновика и режим Split | src/content/index.ts:1392-1403 | — | pilot-chatspace | |
| AI-025 | Fix без стрима | Во время генерации только спиннер | src/content/index.ts:3798-3802 | — | pilot-chatspace | |

### 1.3 Hi и Ping

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| AI-030 | Hi | 3 варианта приветствия (`hi-greeting`, `variantCount: 3`), «Choose one greeting.» | src/background/operations.ts:2926; src/content/inline-panel/inline-panel-controller.ts:566-579 | m/ai/coordinator.ts:386-393; f/ai/AiPillRow.tsx:296-308 | pilot-chatspace | |
| AI-031 | Порог Hi | Не больше 10 «личных» сообщений; рассылки и welcome не считаются | src/background/operations.ts:2470-2481; src/shared/greeting-context.ts:77-79 | f/ai/dockLogic.ts:358-396; s/constants.ts:43 | pilot-chatspace | На OF гейт хаба; сообщения `isFromQueue` в свежий текст не идут (план §3.4, §3.7) |
| AI-032 | Hi: история в одну страницу | Вся история должна уместиться в страницу Fansly API (25) | src/shared/features.ts:229-230 | — | fansly-phase | Размер страницы Fansly |
| AI-033 | Распознавание welcome и рассылок | `/message/automated`, кэш 24 ч, метка в транскрипте | src/background/operations.ts:2400-2468; src/background/welcome-definitions.ts:43-136 | — | fansly-phase | На OF автоматику различает `isFromQueue` и хаб |
| AI-034 | Контекст Hi из профиля фана | Имя, username, custom-имя, био, аватар, `personalMessageCount` | src/shared/greeting-context.ts:84-101 | — | fansly-phase | На OF профиль подставляет хаб |
| AI-035 | Ping | Реактивация замолчавшего фана, окно 100, с био и custom-именем | src/shared/features.ts:105-119 | f/ai/AiPillRow.tsx:283-295 | pilot-chatspace | |
| AI-036 | Ping для активного фана | Fansly: фан писал текстом за 5 дней → `ping_blocked`, AI не вызывается; десктоп: ручной Ping не блокируется никогда (D29) | src/background/operations.ts:2483-2519 | f/ai/dockLogic.ts:351-356; docs/decisions.md D29 | needs-owner-decision | Клиенты расходятся (вопрос В4) |
| AI-037 | Сегмент Ping на клиенте | segment-a (≥3 текстовых сообщения фана) / segment-b / active и `fanSilenceDays` | src/shared/transcript.ts:820-860 | s/transcript/ping-segment.ts:1-60 | fansly-phase | На OF сегмент считает хаб |
| AI-038 | Показ сегмента Ping A/B | Чип сегмента — только в компактной панели превью Spenders/Online | — | f/ai/AiDock.tsx:241-252; f/ai/pingGate.ts:17-39 | needs-owner-decision | Зависит от судьбы превью (вопрос В12); хаб должен отдавать сегмент |
| AI-039 | Шаблоны реактивации | Живут на хабе, клиент передаёт только ссылки | — | m/hub/ai-feature-gateway.ts:172-197 | pilot-chatspace | |

### 1.4 Review

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| AI-050 | Review | Оценка переписки по глубокому окну (`chat-review`) | src/shared/features.ts:93-104 | f/ai/AiHeaderMenu.tsx:143-150; s/features.ts:114-128 | pilot-chatspace | Строится по архиву хаба (X4) |
| AI-051 | Минимум 30 сообщений | Review и полный Recap на короткой истории → `not_enough_history` | src/background/operations.ts:2405-2412 | s/constants.ts:41; s/features.ts:33 | pilot-chatspace | На OF гейт хаба `gate_min_messages` |
| AI-052 | Разбор XML ответа | rating 1–10, evaluation, recommendations; невалидный XML — сырой текст, не ошибка | src/shared/xml.ts:22-37 | s/output/xml.ts:26-53 | pilot-chatspace | |
| AI-053 | Показ Review | Бейдж N/10; блоки ВЕРДИКТ / ДЕНЬГИ / ПЕРСОНА / ОШИБКИ с «Как надо было»; вставить нельзя | src/content/overlay/overlay-controller.ts:3009-3086; src/content/overlay/analysis-blocks.ts:1-40 | f/ai/AiDock.tsx:329-353 | pilot-chatspace | |
| AI-054 | Copy и Refresh у Review | Копирует форматированный текст; Refresh в обход кэша | src/content/overlay/overlay-controller.ts:3118-3215 | f/ai/AiDock.tsx:157-166 | pilot-chatspace | |

### 1.5 Recap (досье фана)

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| AI-060 | Диалог выбора Recap | «Полный» (Enter) / «Короткий» / «Открыть последний» | src/content/index.ts:961-996; src/content/overlay/overlay-controller.ts:2939-2995 | — | pilot-chatspace | В десктопе только полный (Scan) |
| AI-061 | Статус рекапов из хаба | Метаданные `aiRecapStatus` по `definitionId`, «Проверяю сохранённые рекапы…» | src/content/index.ts:1005-1052; src/background/runtime-api.ts:1342-1430 | — | pilot-chatspace | |
| AI-062 | Полный Recap / Scan | Досье по глубокому окну и тратам (`fan-summary`) | src/shared/features.ts:81-92 | s/features.ts:99-113; f/ai/AiHeaderMenu.tsx:135-142 | pilot-chatspace | Глубина до 3000 на новом протоколе (план §3.6) |
| AI-063 | Короткий Recap | 300 сообщений, хранится только локально | src/shared/constants.ts:175-179; src/background/operations.ts:1991-2000 | — | pilot-chatspace | На OF ни разу не запускался в проде — приёмка на тестовом чате (план §7) |
| AI-064 | Генерация всегда новая | «Полный» и «Короткий» запускаются с `forceRegenerate` | src/content/index.ts:998-1001,1054-1086 | — | pilot-chatspace | |
| AI-065 | «Открыть последний» | Сохранённый рекап без генерации, иначе `no_saved_recap` | src/content/index.ts:1088-1144; src/background/operations.ts:2009-2026 | — | pilot-chatspace | |
| AI-066 | Локальный кэш рекапов, два слота | `summary:` и `summary-short:` по персоне и модели; полный и короткий не затирают друг друга; вытеснение по 10 | src/shared/constants.ts:24-29; src/shared/summary-cache.ts:209-262; src/content/overlay/completed-overlay-cache.ts:20-23 | s/summary/validity.ts:4-139; m/ai/coordinator.ts:880-900 | pilot-chatspace | |
| AI-067 | Полный рекап → досье хаба | Fansly: `upsertFanProfile` со статусом «Server sync · saving/saved/failed»; десктоп: `putFanProfile` | src/background/operations.ts:2047-2120; src/background/agency-hub-client.ts:378-397 | m/hub/summary-hooks.ts:1-5,245 | pilot-chatspace | Через `profile/from-generation`, текст не отправлять (план §3.5) |
| AI-068 | Досылка несохранённого рекапа | Готовый, но не сохранённый полный рекап досылается; кулдаун 3 мин | src/background/operations.ts:623-628,932-1103 | — | pilot-chatspace | Повтор `from-generation` при «ещё не готово» (план §3.5) |
| AI-069 | Показ рекапа | Markdown, «Cached/Generated N ago», покрытие, Copy, Refresh | src/content/overlay/overlay-controller.ts:3025-3045,3088-3093 | f/fan-panel/FanPanel.tsx:269-381 | pilot-chatspace | Место показа — наша поверхность; панель фана — вопрос В16 |
| AI-070 | «Scan отстаёт от чата» | Тихая подсказка, если после досье пришли новые сообщения | — | f/fan-panel/FanPanel.tsx:337,362-367; f/fan-panel/scanLogic.ts:13-23 | pilot-chatspace | |
| AI-071 | Указатель на готовое досье | «Scan сохранён / из кэша →», вкладка мигает | — | f/ai/AiDock.tsx:355-372; f/ai/aiStore.ts:606-611 | pilot-chatspace | |

### 1.6 Coach и Help

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| AI-080 | Coach: открытие | Оверлей-чат «спроси ИИ про фана», без генерации, фокус в поле вопроса | src/content/index.ts:2202-2268 | hk/scheme.js:29 (клавиша зарезервирована) | pilot-chatspace | В десктопе Coach нет |
| AI-081 | Пустое состояние Coach | «Контекст подтянется сам…», чип «Разбор ситуации», три группы готовых вопросов | src/content/overlay/overlay-controller.ts:344-371,2427-2475 | — | pilot-chatspace | |
| AI-082 | Поле вопроса | Enter отправляет, Shift+Enter — перенос, до 2000 символов | src/content/overlay/overlay-controller.ts:1430-1450 | — | pilot-chatspace | |
| AI-083 | Пузырь ожидания с фазами | «Читаю переписку… / Собираю контекст… / Жду ядро…» с секундомером | src/shared/coach-format.ts:23-56 | — | pilot-chatspace | На OF без фазы чтения переписки |
| AI-084 | Показ ответа Coach | Блоки «СИТУАЦИЯ: …» или Markdown | src/content/overlay/overlay-controller.ts:2143-2157 | — | pilot-chatspace | |
| AI-085 | Черновики внутри ответа | До 2 блоков ```draft (≤1500 символов) со «Вставить» и «Копировать» | src/shared/coach-draft.ts:14-18,62; src/content/overlay/overlay-controller.ts:2160-2181 | — | pilot-chatspace | |
| AI-086 | Подтверждение замены черновика | При непустом поле «Заменить черновик…», после вставки Coach сворачивается | src/content/overlay/overlay-controller.ts:2610-2645,2697-2704 | — | pilot-chatspace | |
| AI-087 | Блок кириллицы | Черновик на кириллице не вставляется, если фан не пишет кириллицей | src/content/overlay/overlay-controller.ts:2655-2667; src/background/operations.ts:3464 | — | pilot-chatspace | |
| AI-088 | История диалога в хаб | `coachHistory` до лимита (10, максимум 20), длинные ответы сжимаются | src/shared/coach-history.ts:19-60 | — | pilot-chatspace | |
| AI-089 | Сессии Coach | LRU 5 по аккаунту и чату, до 50 обменов; сброс при смене персоны или аккаунта | src/content/coach-session.ts:18,34,38,262-300 | — | pilot-chatspace | |
| AI-090 | «Новый диалог» | С подтверждением; во время ответа запрещён | src/content/overlay/overlay-controller.ts:1377-1408 | — | pilot-chatspace | |
| AI-091 | «Приложить мой ответ» | Черновик читается один раз перед отправкой вопроса, галочка сбрасывается | src/shared/coach-draft-gate.ts:4-14; src/content/index.ts:2484-2497 | — | pilot-chatspace | Черновик — только для этого хода; не «свежий текст» для Coach (X4) |
| AI-092 | Сбой, отмена, пустой ответ хода | «Остановлено вами» / «Не получилось…» и «Повторить»; пустой ответ не сохраняется | src/content/overlay/overlay-controller.ts:2310-2347; src/content/index.ts:2940-2955 | — | pilot-chatspace | |
| AI-093 | «Отправлено коучу…» | Сколько сообщений, окно или вся история, какие рекапы приложены | src/content/overlay/overlay-controller.ts:2260-2305 | — | pilot-chatspace | На OF цифры даёт хаб |
| AI-094 | Граница памяти и чипы | «выше не входит в память», чипы «Другой вариант / Сделай короче / А если откажет?» | src/content/overlay/overlay-controller.ts:373-377,2478-2509 | — | pilot-chatspace | |
| AI-095 | Рекап в шапке и меню «Рекап ▾» | «Рекап — полный: N ч · короткий: N мин»; рекап шагом в ленте; авто-рекап на сессию | src/content/overlay/overlay-controller.ts:381-412,1650-1830 | — | pilot-chatspace | |
| AI-096 | Авто-рекап перед первым вопросом | Если рекапа нет, он старше 24 ч или снят по другому окну; один раз на сессию | src/content/index.ts:208-284,2440-2462,2695-2900 | — | pilot-chatspace | |
| AI-097 | «Обновить переписку» в Coach | Сбрасывает клиентский кэш транскрипта | src/content/index.ts:2668-2687 | — | needs-owner-decision | На OF и в фазе Fansly историю даёт хаб — пункт пустой; убрать или сделать запросом свежего архива (вопрос В8) |
| AI-098 | Кэш транскрипта Coach | Инкрементальный, LRU 5 | src/background/coach-transcript-cache.ts:6-38,181-236 | — | not-applicable | История для AI — из хаба (X4) |
| AI-099 | Вопрос не теряется | При смене чата, разрыве или отказе вопрос возвращается в поле | src/content/index.ts:2292-2325,3046-3108 | — | pilot-chatspace | |
| AI-100 | Coach уступает другим фичам | Без активного хода закрывается при запуске другой фичи | src/content/index.ts:1641-1650 | — | pilot-chatspace | |
| AI-101 | Help | Fansly: пресет Coach `situation` («Разбор ситуации», вопрос живёт в ядре); десктоп: отдельная фича `help-me` — подсказка и два вставляемых варианта «вовлекающий» и «флирт» | src/content/index.ts:2271-2290,2518-2540 | f/ai/AiDock.tsx:374-391; s/features.ts:84-98 | needs-owner-decision | Одна функция с двумя разными ответами (вопрос В3) |
| AI-102 | Вызов Help | Кнопки нет (E80); хоткей ⌘⇧H / Ctrl+Alt+H или чип в Coach | src/content/button-bar.ts:31-32; src/content/index.ts:914-919 | r/app/KeymapProvider.tsx:351-354 | pilot-chatspace | |
| AI-103 | Старый help-me в Fansly | XML-оверлей, достижим только из кэша | src/shared/features.ts:68-80; src/content/index.ts:4180-4200 | — | not-applicable | Мёртв с E79/E80 |

### 1.7 Voice

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| AI-110 | Кнопка 🎙 и проба | Видна только при `voiceNotesCapable` от хаба, проба до 800 мс | src/content/button-bar.ts:208-214; src/background/voice-service.ts:616-628 | — | fansly-phase | OF — после пилота (X5) |
| AI-111 | Скрипт из черновика | `voice-script` по SSE; пресеты Тёплый / Игривый / Спокойный, редактор, ~600 символов | src/content/index.ts:1832-1853; src/content/voice/voice-panel.ts:72-74,622-720 | — | fansly-phase | OF — после пилота (X5) |
| AI-112 | Платная озвучка ElevenLabs | Оценка в символах, несколько вариантов, прослушивание, выбор | src/content/voice/voice-panel.ts:686-705,963-975; src/content/voice/attempt-controller.ts:439-460 | — | fansly-phase | OF — после пилота (X5) |
| AI-113 | Защита от двойной оплаты | Попытки в `storage.session` с CAS, без повтора создания после 30 с, TTL 6 ч | src/shared/constants.ts:254-267; src/content/voice/voice-panel.ts:1446-1505; src/background/voice-attempt-store.ts:1-60 | — | fansly-phase | OF — после пилота (X5) |
| AI-114 | Прикрепление MP3 | Через родной input Fansly, подтверждение по waveform за 20 с, «Скачать MP3», тост «Очистить черновик» | src/content/voice/attach-adapter.ts:5-133; src/content/native-file-handoff.ts:38-62; src/content/index.ts:1910-1940 | — | fansly-phase | OF — после пилота (X5); вложения у ChatSpace свои |
| AI-115 | Новый войс, студия, привязка к чату | Подтверждение при оплаченных вариантах; смена чата разбирает панель, попытка остаётся | src/content/voice/voice-panel.ts:890-962; src/content/voice/voice-studio.ts:52-84; src/content/index.ts:2131-2134 | — | fansly-phase | OF — после пилота (X5) |

### 1.8 Общие правила генераций

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| AI-120 | AI никогда не отправляет | Генерация только по клику или хоткею; отправляет человек кнопкой хоста | CLAUDE.md; src/content/textarea.ts:28-49 | f/ai/AiDock.tsx:1-5 | pilot-chatspace | X3 |
| AI-121 | Предусловия фич | Нет входа, персон, маппинга или связи → блок с причиной и кнопкой «Настройки» | src/content/index.ts:1424-1454 | f/ai/dockLogic.ts:298-319; f/ai/gateText.ts:11-24 | pilot-chatspace | |
| AI-122 | «Чат ещё грузится» | Кнопки неактивны, пока нет сообщений | — | f/ai/AiPillRow.tsx:219-221 | pilot-chatspace | На ChatSpace — пока кэш `chatMessages` открытого чата не загружен |
| AI-123 | Сколько генераций одновременно | Fansly: одна на вкладку (второй запуск → CG-FLOW-04); десктоп: одна на чат, до 3 в разных чатах, тосты «AI ready / failed · чат N» | src/content/index.ts:1636-1639; src/background/operations.ts:1612-1641 | f/ai/aiStore.ts:103,353-392; m/ai/coordinator.ts:1048-1060 | needs-owner-decision | Клиенты расходятся (вопрос В5) |
| AI-124 | Генерация при смене чата | Fansly: отменяется (`chat_changed`); десктоп: живёт в фоне, привязана к `operationId` | src/content/index.ts:2121-2192; src/background/operations.ts:836-861 | m/ai/coordinator.ts:1-5 | needs-owner-decision | Вместе с AI-123 (вопрос В5) |
| AI-125 | Защита от вставки в чужой чат | Перед каждой вставкой чат результата сверяется с текущим | src/content/inline-panel/inline-panel-controller.ts:1061-1066; src/content/overlay/overlay-controller.ts:663-668 | m/hub/ai-feature-gateway.ts:146-170 | pilot-chatspace | P1 из X5: сверять accountId OM, chatId, поколение маршрута, ревизию черновика (план §4) |
| AI-126 | Смена персоны или аккаунта | Отмена, подавление результата, сброс кэшей и сессий | src/content/index.ts:3299-3398 | — | pilot-chatspace | |
| AI-127 | Повторный клик во время генерации | Возвращает на экран скрытую панель | src/content/index.ts:1623-1634 | — | pilot-chatspace | |
| AI-128 | Кэш готового результата | Повторный клик в том же чате открывает прошлый результат без генерации | src/content/index.ts:1660-1674; src/content/overlay/completed-overlay-cache.ts:50-65 | — | pilot-chatspace | |
| AI-129 | Regenerate / Refresh | Новая генерация с `isRegeneration` | src/content/index.ts:1466-1481; src/background/operations.ts:2914 | f/ai/AiDock.tsx:157-166; f/ai/aiStore.ts:466-480 | pilot-chatspace | |
| AI-130 | Отмена | ⌘. / Ctrl+., кнопка Cancel, Esc в оверлее загрузки | src/content/index.ts:1157-1192; src/content/inline-panel/inline-panel-controller.ts:484-492 | f/ai/AiDock.tsx:121-128,148-156; f/ai/aiStore.ts:483-496 | pilot-chatspace | |
| AI-131 | Esc в inline-панели | Только прячет панель, генерация идёт дальше; в развёрнутом виде сворачивает | src/content/overlay/overlay-controller.ts:482-489,571-580; src/content/inline-panel/inline-panel-controller.ts:206-211 | — | pilot-chatspace | Esc ChatSpace закрывает вкладку чата — гасить (см. HK-029) |
| AI-132 | Пустой или обрезанный ответ | → `ai_output_unusable` | src/background/operations.ts:459-469,3260-3277 | m/ai/coordinator.ts:395,405,411 | pilot-chatspace | |
| AI-133 | Единственный автоповтор | При 502/503 до первого чанка — один повтор через 5 с, «Provider unavailable. Retrying…» | src/background/operations.ts:218,3159-3221 | — | pilot-chatspace | |
| AI-134 | Окна сообщений по фичам | Fansly: Reply 100, Fix 25, Ping 100, Hi 25, Review и полный Recap 3000, короткий 300 — настраиваются; десктоп: хранит окна, но не отправляет | src/shared/features.ts:216-232; src/shared/constants.ts:153-179 | s/constants.ts:24-37; m/settings/store.ts:108-113 | needs-owner-decision | На OF окно задаёт хаб (вопрос В6) |
| AI-135 | Очистка ответа | Убирает `<think>`, утечки промпта, «Reply:», обрамляющие кавычки | src/shared/reply-output.ts:5-31,70-75 | s/output/reply-output.ts:91-124 | pilot-chatspace | |
| AI-136 | Разбор частей и вариантов | Части по `[NEXT]`, варианты по `[VARIANT]` | src/shared/split.ts:10-26; src/shared/reply-output.ts:95-110 | s/output/split.ts:15-22 | pilot-chatspace | |
| AI-137 | Стрим | Пачки раз в 50 мс, отрисовка через rAF; рассуждения модели только в отладке | src/background/operations.ts:1238-1265,3142-3151; src/content/index.ts:1369-1383 | s/constants.ts:49; f/ai/StreamingDrafts.tsx:1-63 | pilot-chatspace | |
| AI-138 | Когда появляется панель | Reply, Hi, Ping — с первым чанком или стоимостью; Fix в процессе не показывается | src/content/index.ts:3537-3553,3783-3825 | — | pilot-chatspace | |
| AI-139 | Фазы генерации | «Loading messages… N/M», «Generating…», «Waiting for AI…», отсчёт до повтора | src/content/ui/view-helpers.ts:37-52 | f/ai/dockLogic.ts:390-407; f/ai/AiDock.tsx:109-114 | pilot-chatspace | На OF фазы без чтения страниц |
| AI-140 | Персона в запросе | `personaKey` + `expectedPersonaDefinitionId`; чужой meta-кадр или 409 → результат отброшен, каталог обновляется | src/background/kernel-feature-gateway.ts:279-281,345-394; src/background/persona-identity-fence.ts:1-54 | m/hub/ai-feature-gateway.ts:19-24,107-124,163-197 | pilot-chatspace | |
| AI-141 | Ничего до meta-кадра | debug, usage, done ждут meta | src/background/kernel-feature-gateway.ts:372-378 | — | pilot-chatspace | |
| AI-142 | Тело запроса к хабу | pageLabel, refs, персона, тон, режим, черновик, `isRegeneration`, поля Coach, `summaryMode`, `variantCount`, `messageCount`, `debugPromptEcho` | src/background/operations.ts:2897-2950 | m/hub/ai-feature-gateway.ts:163-197 | pilot-chatspace | На OF без `clientContext` (хаб его отвергает), со свежим текстом для черновиков (план §3.4) |
| AI-143 | Клиентский сбор истории (Fansly) | Страницы по 25 с паузой 300 мс, фан из `GET /group`, обрезка до 300 000 символов | src/background/fansly-client.ts:1268-1311; src/background/operations.ts:2289-2393 | — | fansly-phase | X4: история из хаба, свежий хвост со страницы; клиентское чтение может остаться изолированным модулем на время миграции (план §5) |
| AI-144 | Проверка покупки PPV (Fansly) | orderhistory: до 10 проверок, параллельно 3, кэш 5 мин | src/background/conversation-context-loader.ts:15-45 | — | fansly-phase | Fansly REST |
| AI-145 | Траты и подписка (Fansly) | Earnings по месяцам (до 12), подписка через messaging groups и `/subscribers` | src/background/operations.ts:2603-2780 | — | fansly-phase | Fansly REST |
| AI-146 | Профиль фана (Fansly) | Имя, username, custom-имя (заметка 12002), био из `/account` | src/background/operations.ts:396-409,2522-2585 | — | fansly-phase | Fansly REST |
| AI-147 | Медиа окна (Fansly) | Нумерованные id медиа для описателя хаба | src/background/operations.ts:2843-2853; src/shared/transcript.ts:712-742 | — | fansly-phase | Клиентский сбор контекста Fansly |
| AI-148 | Ссылки разговора и покрытие (Fansly) | `conversationRef` = id фана, у Coach и Recap groupId + `fanRef`; покрытие считает клиент | src/background/operations.ts:384-394,2871-2886 | — | fansly-phase | На OF `chatId` = id фана = `conversationRef`, покрытие даёт хаб |
| AI-149 | Compare / Multi | Fansly: кнопку убрал владелец, движок мёртв; десктоп: пункт меню выключен (P4-STRETCH) | src/content/index.ts:583-596,1718-1802; esbuild.config.mjs:10,48-70 | f/ai/AiHeaderMenu.tsx:151-158; m/ai/coordinator.ts:365-376 | not-applicable | Убран по просьбе владельца; в десктопе — выключенная заглушка |

## 2. Интерфейс AI у поля ввода

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| UI-001 | Панель у поля ввода | Сверху результат, ниже кнопки, ещё ниже баннер маппинга — в одном корне у композера | src/content/index.ts:724-727 | f/ai/AiPillRow.tsx:181-327; f/ai/AiDock.tsx:64-188; f/conversation/ConversationView.tsx:159-176 | pilot-chatspace | X7: крепится к полю ввода сверху (слот `browser-composer-translator`) |
| UI-002 | Состав и порядок кнопок | Fansly: Reply + капсула опций │ Fix │ Hi · Ping · Review │ Recap · Coach │ Voice; десктоп: Reply▾ · Improve · Help · Ping · Hi | src/content/button-bar.ts:245-266 | f/ai/AiPillRow.tsx:181-327; f/conversation/conversationFeatures.ts:28-35 | pilot-chatspace | Состав — объединение; вид — с нуля |
| UI-003 | Меню ✳ AI в шапке чата | Scan, Chat review, Compare | — | f/ai/AiHeaderMenu.tsx:67-162 | pilot-chatspace | Функции переезжают в нашу панель; шапка ChatSpace не наша |
| UI-004 | Подписи и ховер-подсказки | Подписи кнопок, русские подсказки через 1 с, между кнопками 250 мс, закрытие по Esc и прокрутке, выключатель | src/content/button-bar.ts:22-39,50-60; src/content/ui/hover-hint.ts:35,39,101,136,189 | — | pilot-chatspace | |
| UI-005 | Подсказки по состоянию | «Fix недоступен: нет текста», имя персоны в подсказке Reply, «рекап можно открыть сразу» | src/content/button-bar.ts:325-337 | f/ai/gateText.ts:11-24 | pilot-chatspace | |
| UI-006 | Бейджи хоткеев на кнопках | Клавиша в углу кнопки, `aria-keyshortcuts`, подпись под ОС | src/content/button-bar.ts:297-313,356-367; src/shared/hotkeys.ts:126-160 | r/lib/hotkeyScheme.ts:57-65; f/ai/AiPillRow.tsx:149,268-306 | pilot-chatspace | |
| UI-007 | Спиннер на кнопке | Кнопка активной фичи крутится, у Coach тоже | src/content/button-bar.ts:368-375,460-463 | — | pilot-chatspace | |
| UI-008 | Блокировка кнопок | Во время операции работает только своя кнопка; без связи, входа, персон или маппинга заблокировано всё | src/content/button-bar.ts:431-443 | f/ai/AiPillRow.tsx:209-221,317-325 | pilot-chatspace | |
| UI-009 | Видимость капсулы опций | Без связи или входа тоны и Split скрыты; без маппинга видны, но неактивны | src/content/button-bar.ts:478-483 | — | pilot-chatspace | |
| UI-010 | Точка «рекап готов» | Значок на Recap, если в кэше есть рекап | src/content/button-bar.ts:13-20,447-451 | — | pilot-chatspace | |
| UI-011 | Чип «Аккаунт не определён» | Когда не опознан аккаунт креатора | src/content/button-bar.ts:204-206,318-321 | — | pilot-chatspace | На ChatSpace: аккаунт OM не привязан к странице или сломан контракт хоста |
| UI-012 | Панель только в чате | Без открытого чата панель скрыта | src/content/button-bar.ts:410-411 | — | pilot-chatspace | |
| UI-013 | Баннер «нет персоны» | Fansly: «Войдите» / «нет персон» / выбор персоны и «Save Mapping» прямо из чата; десктоп: «персона не назначена / архивная / не найдена» и «Открыть настройки» | src/content/mapping-banner.ts:44-179 | f/conversation/ConversationPane.tsx:130-148; f/conversation/personaMappingNotice.ts:10-35 | pilot-chatspace | |
| UI-014 | Развернуть ↗ | Inline-результат разворачивается в оверлей и обратно | src/content/surface-planner.ts:110-125 | — | pilot-chatspace | |
| UI-015 | Приоритет поверхностей | Coach → загрузка → inline → диалог Recap → результат | src/content/surface-planner.ts:86-139 | — | pilot-chatspace | |
| UI-016 | Компенсация прокрутки | Рост панели не сдвигает ленту от низа | src/content/scroll-compensation.ts:1-30 | — | pilot-chatspace | Для виртуальной ленты ChatSpace — свой вариант, без вставок в её DOM |
| UI-017 | Оверлей поверх страницы | Блокирует прокрутку страницы, клик по фону закрывает | src/content/overlay/overlay-controller.ts:581,714-720 | — | pilot-chatspace | |
| UI-018 | Карточки частей | Клик по тексту вставляет; кнопки Insert и Copy | src/content/inline-panel/inline-panel-controller.ts:1003-1050 | f/ai/AiDock.tsx:410-480 | pilot-chatspace | |
| UI-019 | Вставка и фокус | Текст в поле, фокус в поле, курсор в конец | src/content/textarea.ts:8-22 | f/ai/aiStore.ts:645-704 | pilot-chatspace | Через `__omComposerBridge.setText/insertText` видимого composer |
| UI-020 | Вставка в непустой черновик | Fansly: Reply, Hi, Ping молча заменяют весь текст, Coach спрашивает; десктоп: всегда дописывает под черновиком | src/content/textarea.ts:34-37 | f/ai/dockLogic.ts:100-102 | needs-owner-decision | Вопрос В2 |
| UI-021 | Вставка в textarea Fansly | `execCommand insertText`, запасной путь через value и события, проверка | src/content/textarea.ts:28-49 | — | fansly-phase | DOM Fansly |
| UI-022 | Отклик кнопки после вставки | «Inserted ✓» 2 с, затем «Insert again» (десктоп: INSERTED / COPIED 1,4 с) | src/content/ui/view-helpers.ts:239-251 | f/ai/AiDock.tsx:423-439 | pilot-chatspace | |
| UI-023 | Enter — вставить следующую часть | Только Reply и Fix, только когда фокус не в поле | src/content/inline-panel/inline-panel-controller.ts:213-240; src/content/overlay/overlay-controller.ts:491-515 | — | pilot-chatspace | Enter в composer ChatSpace отправляет — правило «только вне поля» обязательно |
| UI-024 | Сквозной фон после вставки | Оверлей пропускает клики к чату, чтобы отправить | src/content/overlay/overlay-controller.ts:673-675,714-731 | — | pilot-chatspace | |
| UI-025 | Копирование в буфер | При отказе — ошибка в панели | src/content/textarea.ts:4-6 | f/ai/aiStore.ts:625-639 | pilot-chatspace | |
| UI-026 | Ошибка вставки в панели | `insertion_failed` / `chat_changed`, панель не закрывается | src/content/inline-panel/inline-panel-controller.ts:1080-1083 | — | pilot-chatspace | |
| UI-027 | Копирование вместо вставки | Если в чат писать нельзя — кнопки становятся «копировать» | — | f/ai/AiDock.tsx:94-98; f/ai/dockLogic.ts:113-127 | pilot-chatspace | Нужно и для заблокированного фана: в ChatSpace 0.172.0 у него composer скрыт |
| UI-028 | «Вставить все» ⌘0 | Все части одним черновиком через `[NEXT]` | — | f/ai/AiDock.tsx:170-185; f/ai/dockLogic.ts:87-97 | needs-owner-decision | В ChatSpace цепочек нет — уйдёт одно сообщение с буквальным `[NEXT]` (вопрос В9) |
| UI-029 | Автовставка единственного варианта | В превью вставляется сама, один раз на задачу | — | f/ai/AiDock.tsx:204-234; f/ai/dockLogic.ts:220-232 | needs-owner-decision | Зависит от превью (вопрос В12) |
| UI-030 | Стоимость генерации у результата | «$ · usage», токены; видна всем чаттерам в обоих клиентах | src/content/spend-format.ts:14-42; src/content/inline-panel/inline-panel-controller.ts:905-932 | f/ai/AiDock.tsx:116-122,296-298; f/ai/dockLogic.ts:421-423 | needs-owner-decision | §0 относит стоимость к режиму отладки (вопрос В7) |
| UI-031 | «Мало AI-квоты» | Предупреждение, когда осталось ≤25 запросов | — | f/ai/AiDock.tsx:140-144; f/ai/dockLogic.ts:273-280 | pilot-chatspace | |
| UI-032 | Сырой вывод | Если ответ не разобрался — текст без вставки | src/shared/xml.ts:22-37 | f/ai/AiDock.tsx:320-328 | pilot-chatspace | |
| UI-033 | Отправка только нативная | Расширение лишь вставляет; отправляет хост своей кнопкой или Enter | src/content/textarea.ts:28-49; src/shared/hotkeys.ts:199-212 | — | provided-by-chatspace | Отправку делает ChatSpace (`pendingMessages.enqueue`) |
| UI-034 | Плейсхолдер с подсказками | «Ответьте как {персона}… (⌘E · ⌘I · [NEXT] разбивает)» | — | f/conversation/ComposerBar.tsx:149-153 | not-applicable | Плейсхолдер принадлежит ChatSpace; подсказки — на наших кнопках |

## 3. Spenders (доска саппортеров)

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| SP-001 | Вход в доску | Fansly: плавающая кнопка «$» на любой странице; десктоп: кнопка в рейле; обоим — ⌘⇧M / Ctrl+Alt+M | src/content/spenders/board-launcher.ts:11-34; src/content/bootstrap.ts:261-264 | f/inbox/AccountRail.tsx:153-165 | pilot-chatspace | |
| SP-002 | Доска как модальное окно / страница | role=dialog, фон закрывает, прокрутка заблокирована, фокус удерживается и возвращается; «← в чат», Esc | src/content/spenders/spenders-board-controller.ts:183-237,367-396 | f/spenders/SpendersSurface.tsx:1-7,278-301 | pilot-chatspace | Своя Shadow DOM-поверхность вне `#app` |
| SP-003 | Ожидание состояния вкладки | Открытие из bootstrap ждёт первую проекцию состояния | src/content/index.ts:127-132,823-862 | — | pilot-chatspace | |
| SP-004 | Источник рейтинга | Fansly: `pageTopSpenders`, lifetime, limit 1000; десктоп: локальная БД и списки OF | src/background/spenders-service.ts:868-898 | m/spenders/service.ts:1-7 | pilot-chatspace | `/api/v2/spenders` хаба (план §3.8) |
| SP-005 | Откат на 500 | Если старый Core отказывает на 1000, повтор с 500 | src/background/agency-hub-client.ts:629-637 | — | not-applicable | Совместимость со старым Core |
| SP-006 | Траты за период | Fansly: «+$N за месяц» (`YYYY-MM`, UTC), при сбое «неизвестно»; десктоп: «За 30 д» `+$N` | src/background/spenders-service.ts:800-830,976-1013 | f/spenders/SpenderRowItem.tsx:32-34,75-77 | pilot-chatspace | `/api/v2/spenders` принимает месяц; «30 дней» десктопа — согласовать в дизайне |
| SP-007 | Тиры | Fansly: фиксированные пороги 🐳 600+ / ⭐ 350–600 / ✅ 150–350 / ③ 50–150 / ② 25–50 / ① 1–25; десктоп: полки из списков OF/OM, настраиваются; план §3.8: авто-листы хаба | src/shared/spenders.ts:20-57 | f/spenders/SpendersSurface.tsx:97-104; s/spenders/index.ts:61-128 | needs-owner-decision | Три разные схемы (вопрос В10) |
| SP-008 | Фаны вне тиров | Fansly: секция «Below $1»; десктоп: полка «Без тира», грузится по запросу | src/content/spenders/spenders-board-controller.ts:706-736 | f/spenders/SpendersSurface.tsx:135,232-248 | pilot-chatspace | |
| SP-009 | Чипы тиров | «Все» и каждый непустой тир со счётчиком | src/content/spenders/spenders-board-controller.ts:781-888 | f/spenders/SpendersSurface.tsx:302-312 | pilot-chatspace | |
| SP-010 | Вид «Все» | Первая полка 4 строки, остальные по 2, полки ≥50 свёрнуты, «ещё N · показать» | — | f/spenders/SpendersSurface.tsx:116-134,221-248; s/spenders/index.ts:150-175 | pilot-chatspace | |
| SP-011 | Заголовок полки | Название, диапазон, счётчик, совпадения | — | f/spenders/SpendersSurface.tsx:200-210 | pilot-chatspace | |
| SP-012 | Строка фана | Аватар или инициалы, имя (custom → display → username), @handle, траты за всё время | src/content/spenders/spenders-board-controller.ts:910-992 | f/spenders/SpenderRowItem.tsx:31,49-60 | pilot-chatspace | |
| SP-013 | Формат денег | Целые доллары, центы — если округление перешло бы границу тира; $1,284 / $45.50 / +$25.00 | src/shared/spenders.ts:139-170 | r/lib/money.ts:1-34 | pilot-chatspace | Суммы OF в долларах, mills не переносить |
| SP-014 | Бейдж NEW | Первая трата в этом месяце | src/shared/spenders.ts:172-185 | s/spenders/index.ts:227-231 | pilot-chatspace | |
| SP-015 | Удалённый аккаунт | Чип «deleted», траты остаются | src/content/spenders/spenders-board-controller.ts:66-74,936-946 | — | pilot-chatspace | Если хаб отдаёт признак удаления для OF |
| SP-016 | Последнее сообщение в строке | «Мы: / Фан:» и текст, либо «История не загружена» | — | f/spenders/SpenderRowItem.tsx:61-70 | pilot-chatspace | Превью из `/api/v2/spenders` (архив хаба, план §3.8) |
| SP-017 | «Мы писали / Фан писал» | Давность: сейчас / мин / ч / д, «—»; точная дата в подсказке | — | f/spenders/SpenderRowItem.tsx:78-83; f/spenders/contactAge.ts:20-29 | pilot-chatspace | `lastFanMessageAt` из хаба |
| SP-018 | Сортировка | Fansly: lifetime по убыванию; десктоп: по давности «Фан писал», неизвестные в конце | src/shared/spenders.ts:68-111 | f/spenders/SpendersSurface.tsx:288-293,353-378; f/spenders/contactAge.ts:11,33-45 | pilot-chatspace | Оба режима |
| SP-019 | Поиск | По custom-имени, display, username, ID; дебаунс 150 мс, IME; `/` — фокус, Esc — очистить | src/shared/spenders.ts:196-215; src/content/spenders/spenders-board-controller.ts:807-837 | f/spenders/SearchFilters.tsx:26-47; f/spenders/boardFilters.ts:24-36 | pilot-chatspace | |
| SP-020 | Фильтры | «Последнее сообщение» (все / мы / фан), «Доступная история» (есть / нет данных) | — | f/spenders/SearchFilters.tsx:48-76 | pilot-chatspace | |
| SP-021 | Охват и обрезка | «top N of M», «Найдено X из Y загруженных», «Сбросить фильтры», предупреждение об обрезке на 1000 | src/content/spenders/spenders-board-controller.ts:460-466,789-823 | f/spenders/SpendersSurface.tsx:260-265,338-341 | pilot-chatspace | |
| SP-022 | Свежесть данных | «N spenders · newest Hub observation … · fetched …» / «История проверена: …» | src/content/spenders/spenders-board-controller.ts:398-484 | f/spenders/refreshStatus.ts:5-18 | pilot-chatspace | |
| SP-023 | Состояния источника | flag_off, not_allowlisted, unsupported_platform, «waiting for first sync», «N failed sync attempts» | src/content/spenders/spenders-board-controller.ts:76-92,677-697 | — | pilot-chatspace | |
| SP-024 | Refresh (бесплатный) | Перечитать данные хаба в обход кэша | src/content/spenders/spenders-board-controller.ts:419-427 | — | pilot-chatspace | |
| SP-025 | Платное «↻ Обновить» тира | Перечитать переписки: 1 кредит на фана, не чаще 5 мин, бюджет, прогресс | — | f/spenders/RefreshControls.tsx:11-64; f/spenders/SpendersSurface.tsx:313-352 | not-applicable | Нельзя читать историю неоткрытых чатов (AGENTS.md); данные — из хаба (план §3.8) |
| SP-026 | Кэш доски 10 мин | В памяти и `storage.session`; пустые результаты не кэшируются | src/background/spenders-service.ts:198-301,543-575 | — | pilot-chatspace | |
| SP-027 | Общая сборка на вкладки | Одна на ключ; отменяется, когда ушёл последний ждущий | src/background/spenders-service.ts:174-190,670-770 | — | pilot-chatspace | |
| SP-028 | Прогресс и предварительный снимок | «Building the board…», рейтинг сразу, остальное дорисовывается без потери фокуса | src/content/spenders/spenders-board-controller.ts:486-534; src/background/spenders-service.ts:900-911 | — | pilot-chatspace | |
| SP-029 | Ошибка ≠ пусто | Карточка ошибки и «Повторить» (D30) | src/content/spenders/spenders-board-controller.ts:536-552 | f/spenders/QueryFeedback.tsx:1-14; f/spenders/SpendersSurface.tsx:255-259,381 | pilot-chatspace | |
| SP-030 | Пустые состояния | «Не настроено → Открыть настройки», «нет совпадений» | — | f/spenders/SpendersSurface.tsx:379-394 | pilot-chatspace | |
| SP-031 | Таймаут сборки 120 с | `timed_out`, пишется как FAIL в «Статусе» | src/background/runtime-api.ts:1440-1494 | — | pilot-chatspace | |
| SP-032 | Предусловия доски | Хост подключён, страница хаба найдена | src/background/runtime-api.ts:1441-1445 | — | pilot-chatspace | Креатор — из маршрута ChatSpace, страница — из bootstrap |
| SP-033 | Клавиатура доски | J/K и стрелки, Enter, `/`, Esc; десктоп также SPACE (превью), O (открыть), ← , S (статистика) | src/content/spenders/spenders-board-controller.ts:1107-1226 | r/app/KeymapProvider.tsx:188-270; f/spenders/SpendersSurface.tsx:158-177 | pilot-chatspace | Проверять по `code` (у Fansly J/K по `key` — в русской раскладке не работают) |
| SP-034 | Подвал доски | Подсказки J/K · SPACE · O и «Обе даты: X из Y» | — | f/spenders/SpendersSurface.tsx:415-424 | pilot-chatspace | |
| SP-035 | Открыть чат из доски | Клик или Enter открывает чат и закрывает доску | src/content/spenders/spenders-board-controller.ts:994-1036 | f/spenders/QuickLook.tsx:296-321; f/spenders/previewActions.ts:56-71 | pilot-chatspace | Через `$router.push` ChatSpace как действие человека; чат помечается прочитанным — это выбор человека |
| SP-036 | Навигация Angular | pushState + popstate, проверка через 2 с, иначе `location.assign` | src/content/index.ts:1192-1226 | — | fansly-phase | SPA Fansly |
| SP-037 | Карта фан → groupId | 150 последних диалогов, бюджет 12 с | src/background/spenders-service.ts:773-799 | — | fansly-phase | На OF chatId = id фана |
| SP-038 | Подбор имён | `/account?ids=` по 50, бюджет 12 с, стоп на 429 | src/background/spenders-service.ts:1048-1164 | — | fansly-phase | На OF имена из хаба или памяти ChatSpace |
| SP-039 | Кэш имён 6 ч | До 2000 на креатора | src/background/spenders-service.ts:303-408 | — | fansly-phase | Нужен только при своих запросах к Fansly |
| SP-040 | Custom-имя из заметки Fansly | Заметка 12002 с приоритетом | src/background/spenders-service.ts:138-144 | — | fansly-phase | Fansly-специфика |
| SP-041 | Поиск чата в инбоксе | Для строки без groupId, 15 с, чипы «find chat / locating / not found» | src/background/runtime-api.ts:1297-1340; src/background/fansly-client.ts:1033-1070 | — | fansly-phase | На OF не нужен: chatId = id фана |
| SP-042 | Сброс при смене аккаунта или хаба | Доска закрывается, кэши чистятся | src/content/spenders/spenders-board-controller.ts:194-201; src/background/spenders-service.ts:1166-1199 | — | pilot-chatspace | В ChatSpace несколько креаторов в одной вкладке |
| SP-043 | Язык доски | Почти весь UI английский | src/content/spenders/spenders-board-controller.ts:405-432 | — | pilot-chatspace | Язык по общему правилу (I18-001) |
| SP-044 | Статистика: выручка | 30 д, 7 д с изменением к прошлым 7, сегодня, число платящих, средний чек | — | f/spenders/StatsPanel.tsx:130-145,237-253 | needs-owner-decision | Только в десктопе; данные должен давать хаб (вопрос В11) |
| SP-045 | Статистика по полкам | Выручка и платящие, клик открывает тир | — | f/spenders/StatsPanel.tsx:147-164,257-286 | needs-owner-decision | Вопрос В11 |
| SP-046 | Давность сообщения фана | 8–21 д / >21 д и сумма трат молчащих >21 д | — | f/spenders/StatsPanel.tsx:166-184,288-310; s/spenders/index.ts:14-40 | needs-owner-decision | Вопрос В11 |
| SP-047 | Очередь «последним писал фан · не прочитано» | Клик открывает превью | — | f/spenders/StatsPanel.tsx:186-199,312-327 | needs-owner-decision | Вопрос В11 |
| SP-048 | «Новые · 30 дней» | Фаны с первой покупкой за месяц | — | f/spenders/StatsPanel.tsx:201-212,329-343 | needs-owner-decision | Вопрос В11 |
| SP-049 | Развернуть статистику (S) | «локальные данные · 0 кредитов» | — | f/spenders/StatsPanel.tsx:118-124,223-233 | needs-owner-decision | Вопрос В11 |
| SP-050 | Превью фана (SPACE) | Окно с короткой перепиской | — | f/spenders/QuickLook.tsx:223-283 | pilot-chatspace | Переписка — только из архива хаба (план §3.8) |
| SP-051 | Шапка превью | Траты за всё время, +30 д, подписка, онлайн / был | — | f/spenders/QuickLook.tsx:232-245,380-426 | pilot-chatspace | |
| SP-052 | «Мы писали / Фан писал» в превью | — | — | f/spenders/QuickLook.tsx:262-265 | pilot-chatspace | |
| SP-053 | Догрузка переписки в превью | Платное чтение хвоста при открытии, ↻, AI ждёт историю | — | f/spenders/QuickLook.tsx:118-147,166-218,247-259,322-371 | not-applicable | Чтение помечает чат прочитанным на OF; история — из хаба (план §3.8) |
| SP-054 | Отправка из превью | Поле ввода и ⌘↵, vault и PPV прямо из превью | — | f/conversation/ConversationView.tsx:160-176; f/conversation/conversationFeatures.ts:43 | needs-owner-decision | Расширение не отправляет, composer есть только у открытого чата ChatSpace (вопрос В12) |
| SP-055 | AI в превью | Ping / Reply / Hi / Improve в компактной панели, варианты Hi чипами | — | f/conversation/conversationFeatures.ts:41-48; f/spenders/previewActions.ts:79-122; f/ai/AiDock.tsx:264-293 | needs-owner-decision | Вставлять некуда, пока чат не открыт (вопрос В12) |
| SP-056 | Соседний фан в превью | ← → или J/K, Esc закрывает | — | f/spenders/QuickLook.tsx:284-287; r/app/KeymapProvider.tsx:152-154 | pilot-chatspace | |
| SP-057 | Цена платного обновления | 69/20000 $ за кредит, TTL 5 мин | — | s/spenders/index.ts:243-288 | not-applicable | Платных чтений нет |

## 4. «Новые» (новые подписчики)

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| NF-001 | Вход в «Новые» | Fansly: кнопка на любой странице, ленивая загрузка, повтор при ошибке; десктоп: кнопка в рейле и палитра | src/content/bootstrap.ts:95-115 | f/inbox/AccountRail.tsx:126-134; f/followers/FollowersSurface.tsx:135-147 | pilot-chatspace | Без «Новых» на OF паритета нет (план §3.7) |
| NF-002 | Окно «Новых» | Shadow DOM `<dialog>`, закрывается Esc, кликом вне и «×» | src/content/followers/index.ts:51-134 | r/app/KeymapProvider.tsx:155 | pilot-chatspace | |
| NF-003 | Период | Fansly: 1–720 ч, по умолчанию 48; десктоп: 24 / 48 / 72 / 168 ч | src/shared/followers.ts:3; src/content/followers/index.ts:66,89-94 | f/followers/FollowersSurface.tsx:150-163 | needs-owner-decision | `client/audience-new` даёт фиксированное окно (план §3.7; вопрос В13) |
| NF-004 | Скан при открытии | Открытие запускает скан, опрос состояния раз в 700 мс | src/content/followers/index.ts:120-164,212-222 | — | pilot-chatspace | На OF — опрос `client/audience-new` |
| NF-005 | Статусы | Проверяем, В очереди, Не писали, Ждёт ответа / Фан ответил, Уже писали, Не проверен / Не удалось проверить, Отправляем, Нужно проверить, Отправлено, Отправка недоступна | src/content/followers/index.ts:4-15 | f/followers/copy.ts:127-150; f/followers/FollowersSurface.tsx:426-456 | pilot-chatspace | «Отправлено» на OF — по эхо конкретного сообщения (план §3.7) |
| NF-006 | Вкладки, фильтр, поиск, страницы | «К обработке / Все», фильтр по статусам со счётчиками, поиск по имени или ID, страницы по 100 | src/content/followers/index.ts:84-103,224-237 | f/followers/FollowersSurface.tsx:19-20,279-308,358-385 | pilot-chatspace | |
| NF-007 | Строка списка | Аватар, имя, @username · N ч назад, статус | src/content/followers/index.ts:33-49,259-278 | — | pilot-chatspace | |
| NF-008 | Шапка и прогресс | @креатор, фазы скана, окно дат | src/content/followers/index.ts:233-248 | — | pilot-chatspace | |
| NF-009 | Карточка фана | Профиль, «подписался N назад», когда проверен, био, свёрнутое доказательство «Уже писали» | src/content/followers/index.ts:302-316 | f/followers/FollowerDetail.tsx:187-190 | pilot-chatspace | Сводка из `page_dm_threads` (план §3.7) |
| NF-010 | Превью переписки в «Новых» | Fansly: до 750 сообщений с меткой автоматики; десктоп: из уже загруженного | src/content/followers/index.ts:317-356; src/background/followers-service.ts:634-683 | f/followers/FollowerDetail.tsx:200,394-398 | needs-owner-decision | Историю неоткрытых чатов грузить нельзя; хватит ли сводки хаба (вопрос В14) |
| NF-011 | Открыть чат | «Открыть в Fansly ↗» | src/content/followers/index.ts:323-328 | — | pilot-chatspace | Маршрут ChatSpace |
| NF-012 | Черновик приветствия | До 5000 символов, хранится по креатору и фану, очищается после «Отправлено» | src/content/followers/index.ts:16,358-378,423-431 | f/followers/FollowerDetail.tsx:46,244-260 | pilot-chatspace | Затем вставка в composer открытого чата |
| NF-013 | «Сгенерировать» | Hi с `variantCount: 1`, результат в черновик | src/background/followers-service.ts:862-965 | f/followers/FollowerDetail.tsx:231-242; m/followers/generation.ts:48-53 | pilot-chatspace | Без `clientContext` |
| NF-014 | Предусловия генерации | Строка проверена, есть маппинг и страница, перепроверка перед запуском | src/background/followers-service.ts:867-908 | — | pilot-chatspace | |
| NF-015 | Отказ при >10 личных | «это диалог… используйте Reply», AI не вызывается | src/background/followers-service.ts:63-65,889-896 | — | pilot-chatspace | |
| NF-016 | Сверка персоны и хаба вокруг генерации | До и после генерации, иначе `chat_changed` | src/background/followers-service.ts:897-905,960 | — | pilot-chatspace | |
| NF-017 | Проверка вывода | Пусто, >5000 символов, `[VARIANT]` или `[NEXT]` → `ai_output_unusable` | src/background/followers-service.ts:961 | — | pilot-chatspace | |
| NF-018 | Черновик устарел | «Проверка изменилась — подтвердите черновик»; отказ, если история изменилась после просмотра | src/background/followers-service.ts:976-1001 | f/followers/FollowerDetail.tsx:278-290 | pilot-chatspace | |
| NF-019 | Отправка приветствия из окна | Fansly: `POST /message` по клику, одна попытка; десктоп: команда хаба с перепроверкой | src/background/followers-service.ts:1050-1057; src/background/fansly-client.ts:709-715 | f/followers/FollowerDetail.tsx:113,305-314 | not-applicable | На OF расширение не отправляет: бронь и вставка, отправляет человек (X3, план §3.7) |
| NF-020 | Прямая отправка в фазе Fansly | То же на fansly.com | src/background/followers-service.ts:1050-1057 | — | needs-owner-decision | Сохранить или перейти на схему OF (вопрос В15) |
| NF-021 | Бронь (claim) с арендой | Fansly: `followerOutreachAttempt(reserve)`, «Другой чаттер уже отправляет»; десктоп: защита между пользователями | src/background/followers-service.ts:1027-1036 | m/followers/service.ts:822-840 | pilot-chatspace | Отдельный протокол claim с арендой и продлением (план §3.7) |
| NF-022 | Неопределённая отправка | `uncertain`, повтор заблокирован навсегда | src/background/followers-service.ts:1073-1078 | m/followers/service.ts:945-950 | pilot-chatspace | |
| NF-023 | Блокировка строки | Одно действие на креатора и фана, иначе `another_operation` | src/background/followers-service.ts:106,593-599 | — | pilot-chatspace | |
| NF-024 | Тексты отказа | Называют фана и причину, строка остаётся | src/background/followers-service.ts:73-81 | — | pilot-chatspace | |
| NF-025 | «Результат неполный» | «Показана часть списка…» | src/background/followers-service.ts:291 | f/followers/FollowersSurface.tsx:253 | pilot-chatspace | coverage и unknown из хаба |
| NF-026 | Страж личности скана | Смена сессии, креатора или входа → `chat_changed`; закрытие окна отменяет скан | src/background/followers-service.ts:123-147 | — | pilot-chatspace | |
| NF-027 | Проверка запросов окна | zod, только верхний фрейм хоста | src/shared/followers-protocol.ts:1-23; src/background/followers-runtime.ts:26-31 | — | pilot-chatspace | |
| NF-028 | «AI ничего не отправляет автоматически» | Подсказка у кнопки | — | f/followers/copy.ts:61-62 | pilot-chatspace | |
| NF-029 | Журнал проверки (отладка) | Кнопка «Отладка ↗», страница журнала: запуски, фильтры, страницы, автообновление, «Копировать», «Сохранить .txt»; 8 запусков, 100 000 событий, без текста и секретов | src/content/followers/index.ts:83,99-101,140-143; src/debug-followers/index.ts:1-173; src/background/followers-trace.ts:1-113; src/background/followers-runtime.ts:10-50 | f/followers/FollowersTrace.tsx:1-225; m/followers/service.ts:189-215,951-990 | pilot-chatspace | На OF пишем вызовы хаба и claim |
| NF-030 | Список фоловеров Fansly | `followersnew` до 20×100, дата из snowflake | src/background/followers-service.ts:252-294 | — | fansly-phase | На OF `client/audience-new` |
| NF-031 | Инбокс-префикс, профили, заметки | Страницы инбокса, профили по 100, custom-имена | src/background/followers-service.ts:295-382,453-494 | — | fansly-phase | Fansly REST |
| NF-032 | Проверка строки | Журнал → `/group` → история до 30 страниц; сохранённые id чатов — зацепка | src/background/followers-service.ts:519-547,685-831 | — | fansly-phase | Fansly REST |
| NF-033 | Классификация автоматики | type 2, correlationId без ответа, совпадение с welcome | src/shared/followers.ts:66-86 | — | fansly-phase | На OF `isFromQueue` |
| NF-034 | Контекст приветствия и аватар | 30 сообщений плоско, траты пустые; перечитать `/account` | src/background/followers-service.ts:909-948 | — | fansly-phase | На OF контекст собирает хаб |
| NF-035 | Журнал попытки отправки | `sending/sent/aborted` в storage | src/background/followers-service.ts:1037-1072 | — | fansly-phase | На OF признак — по эхо |
| NF-036 | Перепроверки Fansly | Перед отправкой, после `POST /group` и после резерва | src/background/followers-service.ts:997-1035 | — | fansly-phase | На OF освежается сводка хаба |
| NF-037 | Cooldown, повторы, пейсер | `rate_limited` с ожиданием; повтор при 404 и сети через 3 с, стоп после 5 сбоев; пейсер 400 мс + 0–100 мс | src/background/followers-service.ts:82-87,385-428,585-591; src/background/fansly-pacer/policy.ts:14-39 | — | fansly-phase | Пейсер Fansly |
| NF-038 | Ручные действия очереди | «Проверить чат», «Проверить следующим», «Пауза», «Проверить оставшихся», баннер cooldown | src/content/followers/index.ts:166-257,364-366 | — | fansly-phase | Завязано на верификацию Fansly |
| NF-039 | Автоочередь верификации | После скана сама делает `POST /group` (может создать пустой чат) и читает историю | src/background/followers-service.ts:549-583,1082-1155 | — | needs-owner-decision | Записи и чтения без клика (вопрос В15) |
| NF-040 | Платная проверка десктопа | Согласие на чтения, «Проверить / Пауза / Продолжить», прогресс, границы, пауза по лимиту, «Загрузить раньше / Проверить снова» | — | f/followers/FollowersSurface.tsx:165-247,260-274; f/followers/FollowerDetail.tsx:167-176,204-212 | not-applicable | Своих чтений нет, список даёт хаб (план §3.7) |

## 5. Vault и медиа

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| VA-001 | Лаунчер загрузки | «↑ Загрузка» только на `/creator/vault` | src/content/vault/vault-launcher.ts:1-69; src/content/bootstrap.ts:329-341 | — | fansly-phase | Fansly DOM |
| VA-002 | Панель и набор файлов | Аккаунт, альбом, форма; папка или файлы, проверка форматов | src/content/vault/vault-panel.ts:344-367; src/shared/vault-upload.ts:17-180 | — | fansly-phase | Fansly DOM |
| VA-003 | Загрузка по одному | Родная форма Fansly, подтверждение 3 опросами, таймаут 45 мин | src/content/vault/upload-runner.ts:21-27,286-400 | — | fansly-phase | Родная форма Fansly |
| VA-004 | Неопределённый файл | Сам не перезаливается, чаттер отвечает «Есть / Нет» | src/content/vault/upload-runner.ts:186-197 | — | fansly-phase | Fansly DOM |
| VA-005 | Контрольная точка | На аккаунт и альбом, TTL 14 дн, продолжение и сброс | src/content/vault/checkpoint-store.ts:1-64 | — | fansly-phase | Fansly DOM |
| VA-006 | Остановки и ход | 13 причин (включая уход с маршрута), прогресс, отчёт | src/content/vault/upload-runner.ts:56-74,440; src/content/vault/vault-panel.ts:279-499 | — | fansly-phase | Fansly DOM |
| VA-007 | Vault на OnlyFans | Кнопка 📎, панель альбомов и поиска, выбор, бесплатное превью, цена PPV $3–200, подпись до покупки | src/content/vault/index.ts:1-4 | f/conversation/ComposerBar.tsx:156-171; f/vault/VaultPanel.tsx:96-100,200-318; f/vault/vaultLogic.ts:76-95 | provided-by-chatspace | Vault, цена и Lock text есть в ChatSpace; наш vault на OF — после пилота (X5) |
| VA-008 | Подтверждение цены PPV | Кнопка повторяет цену словами, обычная отправка заблокирована | — | f/vault/VaultPanel.tsx:270-370; f/conversation/ComposerBar.tsx:73-77,190-193 | needs-owner-decision | В ChatSpace такой защиты нет (вопрос В20) |
| VA-009 | Сброс выбора vault при смене чата | Чтобы медиа не ушли другому фану | — | f/conversation/ConversationPane.tsx:60-63 | provided-by-chatspace | Состояние composer у ChatSpace своё |
| VA-010 | Медиа в переписке | Плитки, просмотр, бюджет картинок, зашифрованный кэш | — | f/conversation/ThreadRows.tsx:119-124; f/media/MediaLightbox.tsx:1-12,240-331; m/media/cache.ts:1-11 | provided-by-chatspace | Медиа и DRM-видео показывает ChatSpace |
| VA-011 | Галерея чата | Сетка медиа с бейджами PPV | — | f/vault/GalleryTab.tsx:1-161 | provided-by-chatspace | Галерея ChatSpace |

## 6. Звук и уведомления

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| SN-001 | Звук входящего сообщения | Синтезированный сигнал на входящее от фана | src/background/message-sound-service.ts:1-300 | r/bridge/events.ts:206-235; r/lib/sound.ts:30-53 | pilot-chatspace | Источник — память ChatSpace (пассивный WS-тап / кэш), без своих запросов (X3) |
| SN-002 | Своё и исходящее не звучит | Своя сессия, известные модели и алиасы | src/shared/message-sound-decision.ts:51-69,122-124 | — | pilot-chatspace | На OF `is_from_fan === true` |
| SN-003 | Автоматика не звучит | type ≠ 1 или correlationId без ответа | src/shared/message-sound-decision.ts:125-139 | — | pilot-chatspace | Признак `isFromQueue` |
| SN-004 | Чаевые без звука | — | src/shared/message-sound-decision.ts:140 | s/notifications/index.ts:5-45 | pilot-chatspace | |
| SN-005 | Только свежие события | Fansly: старше 180 с — без звука; десктоп: только живые события ≤60 мин (D24/D38) | src/shared/message-sound-decision.ts:96-100,141 | s/notifications/index.ts:9-24; r/bridge/events.ts:195,212 | pilot-chatspace | |
| SN-006 | Модель заглушена | Mute по аккаунту, с алиасами; неизвестный аккаунт → `account-unknown` | src/shared/message-sound-decision.ts:142-149 | — | pilot-chatspace | Mute по аккаунту OM события |
| SN-007 | Вкладка закрыта | Без звука | src/background/message-sound-service.ts:241 | — | pilot-chatspace | |
| SN-008 | Чат открыт в фокусе | Без звука | src/background/message-sound-service.ts:242-248 | r/bridge/events.ts:206-235 | pilot-chatspace | Чат из маршрута ChatSpace (`accountId` + `chatId`) |
| SN-009 | Троттлинг 2 с | Проверка и запуск в одной синхронной секции | src/background/message-sound-service.ts:282-300 | s/sound/index.ts:34 | pilot-chatspace | |
| SN-010 | Дубли | id звучит один раз за 10 мин (до 2000), решения по очереди | src/background/message-sound-service.ts:1-74 | — | pilot-chatspace | |
| SN-011 | Повтор после пробуждения аудио | — | src/background/message-sound-service.ts:227-240 | — | pilot-chatspace | |
| SN-012 | Звук нового подписчика | Свой тон, троттлинг 10 с, не перебивает звук сообщения; не на свою подписку | src/shared/message-sound-decision.ts:160-179; src/background/message-sound-service.ts:253-280 | r/bridge/events.ts:188-198; r/lib/sound.ts:36-42; s/sound/index.ts:37 | pilot-chatspace | Событие — новые строки опроса `client/audience-new` (план §3.7–3.8); звук в составе пилота (X5) |
| SN-013 | 8 тонов | chime, drop, bell, arpeggio, knock, double, soft, blip | src/shared/sound-synth.ts:23-111 | s/sound/index.ts:11-21,72 | pilot-chatspace | |
| SN-014 | Воспроизведение в фоне | Один AudioContext, resume за 1,5 с | src/background/message-sound-player.ts:1-70 | — | pilot-chatspace | В Chrome — через offscreen document |
| SN-015 | Диагностика звука | Вкладки слушаются или нет, последнее входящее, счётчики исходов | src/background/message-sound-service.ts:156-178 | — | pilot-chatspace | |
| SN-016 | Протокол звука | События только из верхнего фрейма хоста, preview — со страниц расширения | src/background/message-sound-runtime.ts:20-94 | — | pilot-chatspace | |
| SN-017 | Перехват сокета Fansly | MAIN world, Proxy над WebSocket `wsv3.fansly.com` | src/content/page-socket-tap.ts:1-136 | — | fansly-phase | На OF входящие — из памяти ChatSpace |
| SN-018 | Relay и выключение перехвата | Перехват выключен, если выключены оба звука | src/content/sound-relay.ts:1-102 | — | fansly-phase | Механизм Fansly |
| SN-019 | Разбор кадров Fansly | Сообщение, фоллоу, признак чаевых | src/shared/fansly-ws-frame.ts:5-118 | — | fansly-phase | Формат кадров Fansly |
| SN-020 | Счётчики перехвата | «увидено, но не разобрано» | src/content/page-socket-tap.ts:29-30,63-109 | — | fansly-phase | На OF — проверка контракта хоста |
| SN-021 | Тост и OS-уведомление о входящем | Тост 6 с с переходом в чат; OS-уведомление, когда окно в фоне | — | r/bridge/events.ts:200-229; r/app/ToastHost.tsx:5-55; m/index.ts:1199-1218 | provided-by-chatspace | Уведомления и центр уведомлений ChatSpace |
| SN-022 | Тихий тост и OS-уведомление о покупке | «купил(а) PPV $N / чаевые $N», клик в чат (D39/D40) | — | r/bridge/purchaseToast.ts:31-45; r/bridge/events.ts:240-259; m/index.ts:1220-1262 | provided-by-chatspace | Уведомления о PPV и чаевых в ChatSpace |
| SN-023 | Бейдж на иконке приложения | Dock / панель задач | — | m/index.ts:1186-1198; m/platform/badge.ts:1-170 | not-applicable | Electron |
| SN-024 | «Превышен бюджет кредитов» | OS-уведомление | — | m/index.ts:715-726 | not-applicable | Своих кредитов OFAPI нет |
| SN-025 | Тосты ошибок действий в чате | «Не удалось обновить чат / отозвать» | — | f/conversation/ConversationHeader.tsx:68; f/conversation/ThreadRows.tsx:79-87 | provided-by-chatspace | Действия выполняет ChatSpace |

## 7. Хоткеи

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| HK-001 | Общая схема `@chatgoose/hotkeys` v1 | Текст — ⌘/Ctrl, панели — ⌘⇧/Ctrl+Alt; вендоринг с одинаковым sha | vendor/chatgoose-hotkeys/dist/scheme.js:1-30 | hk/scheme.js:1-30 | pilot-chatspace | Вендорится в три клиента |
| HK-002 | Reply ⌘E / Ctrl+E (У) | — | scheme.js:18 | hk/scheme.js:18; r/app/KeymapProvider.tsx:343-346 | pilot-chatspace | В ChatSpace это inline-code TipTap — перехватывать |
| HK-003 | Fix ⌘I / Ctrl+I (Ш) | — | scheme.js:19 | hk/scheme.js:19; r/app/KeymapProvider.tsx:347-350 | pilot-chatspace | Курсив TipTap — перехватывать |
| HK-004 | Hi ⌘G / Ctrl+G (П) | — | scheme.js:20 | hk/scheme.js:20 | pilot-chatspace | Браузерный find-next — `preventDefault` |
| HK-005 | Ping ⌘P / Ctrl+P (З) | — | scheme.js:21 | hk/scheme.js:21 | pilot-chatspace | Печать браузера — `preventDefault` |
| HK-006 | Отмена ⌘. / Ctrl+. (Ю) | Без защиты свежего нажатия | scheme.js:22 | hk/scheme.js:22 | pilot-chatspace | |
| HK-007 | Help ⌘⇧H / Ctrl+Alt+H (Р) | — | scheme.js:23 | hk/scheme.js:23 | pilot-chatspace | |
| HK-008 | Recap ⌘⇧S / Ctrl+Alt+S (Ы) | Всегда перехватывается (в Firefox иначе скриншот) | scheme.js:24; src/content/index.ts:945-950 | hk/scheme.js:24 | pilot-chatspace | Конфликты: ⌘⇧S — зачёркивание TipTap; Ctrl+Alt+S — автоперевод OM (capture на корне composer) |
| HK-009 | Тон ⌘⇧O / Ctrl+Alt+O (Щ) | — | scheme.js:25 | hk/scheme.js:25 | pilot-chatspace | |
| HK-010 | Review ⌘⇧B / Ctrl+Alt+B (И) | — | scheme.js:26 | hk/scheme.js:26 | pilot-chatspace | |
| HK-011 | Split ⌘⇧L / Ctrl+Alt+L (Д) | Переключатель с тостом | scheme.js:27 | hk/scheme.js:27; r/app/KeymapProvider.tsx:145-147 | pilot-chatspace | |
| HK-012 | Spenders ⌘⇧M / Ctrl+Alt+M (Ь) | Глобальный, открывает и закрывает | scheme.js:28; src/content/hotkey-input.ts:78-81 | hk/scheme.js:28 | pilot-chatspace | |
| HK-013 | Coach ⌘⇧C / Ctrl+Alt+C (С) | В десктопе зарезервирован | scheme.js:29 | hk/scheme.js:29 | pilot-chatspace | |
| HK-014 | Строгие модификаторы | Лишний модификатор — не наша комбинация | vendor/chatgoose-hotkeys/dist/engine.js:19-30 | — | pilot-chatspace | |
| HK-015 | Без Ctrl+Shift и Alt+Shift (Windows) | Ими переключают раскладку | scheme.js:4-9 | — | pilot-chatspace | |
| HK-016 | Запрещённые клавиши | Таблица кодов с причинами | scheme.js:47-80 | — | pilot-chatspace | Дополнить клавишами TipTap и OM |
| HK-017 | Физическая клавиша | `KeyboardEvent.code`, работает в русской раскладке | scheme.js:11-13 | hk/scheme.js:1-13 | pilot-chatspace | |
| HK-018 | Защита свежего нажатия | Reply, Fix, Hi, Ping — без промежуточных клавиш; защита после смены языка | engine.js:31-104 | hk/engine.js:31-81; r/lib/hotkeyScheme.ts:83-95 | pilot-chatspace | |
| HK-019 | Автоповтор | Движок отдаёт `repeat: true`, клиент поглощает | engine.js:101-102; src/content/hotkey-input.ts:41-50 | — | pilot-chatspace | |
| HK-020 | Игнор IME | `isComposing` | engine.js:110 | — | pilot-chatspace | |
| HK-021 | Mac-алиасы | ⌘⇧E/I/G = ⌘E/I/G; ⌘⇧X = Отмена; ⌘⇧D/⌘⇧F поглощаются | scheme.js:31-46 | hk/scheme.js:40-46 | pilot-chatspace | |
| HK-022 | Сброс движка | keyup capture, blur, скрытие вкладки | src/content/hotkey-input.ts:30-37 | — | pilot-chatspace | |
| HK-023 | Один движок на вкладку | `Symbol.for('chatgoose.hotkeys.engine')` | src/content/hotkey-input.ts:18-39 | — | pilot-chatspace | |
| HK-024 | Хоткей до загрузки модуля | Bootstrap перехватывает, грузит модуль, передаёт действие | src/content/bootstrap.ts:224-259,346-377 | — | pilot-chatspace | Слушатель на `window` в capture с `document_start`, раньше ChatSpace |
| HK-025 | Ожидание первого состояния | С проверкой поколения и чата | src/content/index.ts:822-861 | — | pilot-chatspace | |
| HK-026 | Политика preventDefault | В чате забираются все наши комбинации, даже недоступные; вне чата — только Spenders и `?` | src/content/index.ts:866-893 | r/app/KeymapProvider.tsx:105-114 | pilot-chatspace | Плюс `stopImmediatePropagation` (capture-слушатели ChatSpace не смотрят `defaultPrevented`) |
| HK-027 | Блок под справкой и доской | Всё, кроме шпаргалки, доски, отмены, — тост «Сначала закройте справку» | src/content/index.ts:541-544,895-912 | — | pilot-chatspace | |
| HK-028 | Из поля ввода | Комбинации работают в composer, `?` — только вне поля | src/content/hotkey-input.ts:55-75 | — | pilot-chatspace | |
| HK-029 | Esc закрывает по очереди | Fansly: оверлей, inline, шпаргалка, «Новые», vault; десктоп: медиа → палитра → шпаргалка → превью → «Новые» → AI → настройки → доска | src/content/overlay/overlay-controller.ts:480-492 | r/app/KeymapProvider.tsx:148-161 | pilot-chatspace | Esc ChatSpace закрывает вкладку чата — `data-dismissible-open` на хосте и `stopImmediatePropagation` |
| HK-030 | Enter в Coach | Enter — отправить вопрос, Shift+Enter — перенос | src/content/overlay/overlay-controller.ts:1445-1447 | — | pilot-chatspace | |
| HK-031 | Определение ОС | Linux получает схему Windows | src/shared/hotkeys.ts:118-124 | — | pilot-chatspace | |
| HK-032 | Справочник действий | `buildHotkeyEntries`, полные словари действий (новая клавиша ломает typecheck) | src/shared/hotkeys.ts:58-116,162-215 | r/lib/hotkeyScheme.ts:40-65 | pilot-chatspace | |
| HK-033 | Тест пина вендоринга | sha256 проверяется тестом | tests/chatgoose-hotkeys-vendor.test.ts:1-22 | packages/chatgoose-hotkeys/chatgoose-hotkeys.vendor.json | pilot-chatspace | |
| HK-034 | Шпаргалка `?` | Модал «Хоткеи ChatGoose» по группам, подписи под ОС, Esc и клик по фону | src/content/cheatsheet-controller.ts:1-135 | r/app/HotkeyCheatsheet.tsx:1-108; r/app/StatusBar.tsx:157-163 | pilot-chatspace | |
| HK-035 | Группа «Различается с приложением OF» | Сравнение двух старых клиентов в шпаргалке | src/shared/hotkeys.ts:199-212 | — | not-applicable | Новому клиенту нужен свой текст |
| HK-036 | Палитра ⌘K | Поиск по AI-действиям, переходам, чатам, аккаунтам | — | r/app/CommandPalette.tsx:56-130; r/app/keymapBindings.ts:79 | needs-owner-decision | У ChatSpace палитры нет (вопрос В17) |
| HK-037 | Навигация по чатам | J/K — следующий/предыдущий, ⌘U — непрочитанный, ⌘1…9 с номерами на строках, Enter — фокус в поле | — | r/app/keymapBindings.ts:66-83; r/app/KeymapProvider.tsx:283-332; f/inbox/NavNumberOverlay.tsx:1-52 | needs-owner-decision | Управление роутером и списком ChatSpace (вопрос В17) |
| HK-038 | ⌘↵ отправить | — | — | r/app/keymapBindings.ts:84 | provided-by-chatspace | В ChatSpace отправляет Enter; расширение не отправляет |
| HK-039 | `]` панель фана | — | — | r/app/keymapBindings.ts:86 | needs-owner-decision | Вопрос В16 |
| HK-040 | `[` скрыть список чатов | — | — | r/app/keymapBindings.ts:87 | not-applicable | Список чатов принадлежит ChatSpace |
| HK-041 | ⌘, — настройки | — | — | r/app/keymapBindings.ts:89 | pilot-chatspace | |
| HK-042 | Клавиши в превью | ⌘P/E/G/I/., Enter, ⌘↵ | — | r/app/KeymapProvider.tsx:221-258 | needs-owner-decision | Вопрос В12 |
| HK-043 | ⌘0 — вставить все части | — | — | r/app/keymapBindings.ts:90 | needs-owner-decision | Вопрос В9; в браузере ⌘0 — сброс масштаба |
| HK-044 | Меню приложения | ⌃⌘H, ⇧⌘R в разработке | — | m/index.ts:413-461 | not-applicable | Electron |

## 8. Popup (иконка расширения) и строка статуса десктопа

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| PU-001 | Фон не ответил | «Не удалось связаться с ChatGoose…», открыть настройки, ссылки | src/popup/index.ts:153-174,207-218 | — | pilot-chatspace | |
| PU-002 | Вход не выполнен | «Войдите…», кнопка ведёт на `#hub:CG-HUB-02`; сбой связи не считается выходом | src/popup/index.ts:193-205 | — | pilot-chatspace | |
| PU-003 | Версия | «v X.Y.Z» во всех состояниях | src/popup/index.ts:7,26-31 | f/settings/sections/UpdateSettings.tsx:60; f/settings/sections/HubSettings.tsx:290-297 | pilot-chatspace | |
| PU-004 | Заголовок | Имя персоны аккаунта, «Аккаунт без персоны» или «Не подключено» | src/background/runtime-api.ts:540-546 | — | pilot-chatspace | |
| PU-005 | Пилюля хоста | «Fansly подключён / не подключён» | src/popup/index.ts:240-246 | — | pilot-chatspace | На ChatSpace — «ChatSpace открыт / контракт хоста в порядке» |
| PU-006 | Пилюля проблемы с хабом | Только при проблеме с входом | src/popup/index.ts:247-251 | r/app/StatusBar.tsx:100-111 | pilot-chatspace | Десктоп: сегменты HUB AUTH / HUB CREDENTIAL |
| PU-007 | Строка «Аккаунт» | Имя или короткий id, клик копирует id | src/popup/index.ts:79-133,257 | — | pilot-chatspace | Аккаунт OM и креатор OF |
| PU-008 | Строка «Диалог» | Имя фана или id, копирование, «Нет активного чата» | src/popup/index.ts:258 | — | pilot-chatspace | `chatId` из маршрута |
| PU-009 | Квота AI | Остаток на сегодня из meta или 429; ≤20 янтарный, 0 — «обновится в 00:00 UTC» | src/popup/index.ts:261-285; src/background/quota-tracker.ts:91-154 | — | pilot-chatspace | Квота текущей страницы |
| PU-010 | «Открыть настройки» | Одна вкладка, раздел «Статус»; в десктопе — клик по строке статуса | src/popup/index.ts:176-191,292 | r/app/StatusBar.tsx:75 | pilot-chatspace | |
| PU-011 | Ссылки на релизы | «Что нового», «История версий» | src/popup/index.ts:135-151 | — | pilot-chatspace | |
| PU-012 | Тема popup | По `uiTheme` | src/popup/index.ts:297-301 | — | pilot-chatspace | |
| PU-013 | Живая перерисовка | При смене входа | src/popup/index.ts:302-306 | — | pilot-chatspace | |
| PU-014 | Сбор данных для popup | Вкладка, хост, маппинг, чат, квота | src/background/runtime-api.ts:428-559 | — | pilot-chatspace | |
| PU-015 | Скрытая проба voice | Ждёт пробу до 800 мс, ничего не показывает | src/background/runtime-api.ts:505-541 | — | not-applicable | Лишний запрос к хабу |
| PU-016 | «AI сегодня $» | Траты на AI за сегодня в строке статуса | — | r/app/StatusBar.tsx:124-129; p/contract.ts:232-233 | needs-owner-decision | Вопрос В7 |
| PU-017 | «? Хоткеи» | Открывает шпаргалку | — | r/app/StatusBar.tsx:157-163 | pilot-chatspace | В popup |
| PU-018 | Режим синхронизации | POLLING / HUB LIVE / SYNCING / FORCED…, подсказки, клик в «Активность» | — | r/app/StatusBar.tsx:27-99; r/app/statusBarTips.ts:39-77 | not-applicable | Синхронизации у расширения нет |
| PU-019 | Кредиты сегодня · баланс | — | — | r/app/StatusBar.tsx:112-123 | not-applicable | Своих кредитов OFAPI нет |
| PU-020 | Отправки · неподтверждённые | — | — | r/app/StatusBar.tsx:130-135 | not-applicable | Не отправляем |
| PU-021 | Последний пуш / список проверен | — | — | r/app/StatusBar.tsx:136-156 | not-applicable | Списков не читаем, поток хаба не нужен |
| PU-022 | Подсказки к статусам по-русски | — | — | r/app/statusBarTips.ts:1-78 | pilot-chatspace | Для статусов в popup и «Статусе» |

## 9. Настройки

### 9.1 Оболочка страницы настроек

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| ST-001 | Страница настроек | Fansly: `options.html` во вкладке; десктоп: отдельная страница, вход из рейла, ⌘, | src/options/copy.ts:23 | f/settings/SettingsSurface.tsx:70-202; f/inbox/AccountRail.tsx:166-176 | pilot-chatspace | |
| ST-002 | Разделы | Fansly: Статус, Аккаунт ChatGoose, Персоны, Аккаунты, Генерация, Хоткеи, Вид; десктоп: Хаб, Персоны, Поведение, Spenders, Активность, Данные, Обновления | src/shared/options-routes.ts:14-32; src/options/shell.ts:136-201 | f/settings/SettingsSurface.tsx:70-78 | pilot-chatspace | Объединение, без чисто десктопных разделов (см. ниже) |
| ST-003 | Хеш-маршруты | `#pane` и `#pane:CODE`, мусор → «Статус» | src/shared/options-routes.ts:39-73 | — | pilot-chatspace | |
| ST-004 | Микростатусы разделов | ✓ или «настройка», число персон, аккаунтов | src/options/index.ts:3289-3295,4220-4228 | — | pilot-chatspace | |
| ST-005 | Футер с версией | «vX», «Что нового» с меткой «нов.», «История версий» | src/options/shell.ts:75-129; src/options/index.ts:749-776 | — | pilot-chatspace | Метка должна вести на заметки текущей версии |
| ST-006 | Одна вкладка настроек | Повторно использует открытую | src/background/runtime-api.ts:892-956 | — | pilot-chatspace | |
| ST-007 | Код ошибки → раздел | `no_mapping` → Аккаунты, `no_personalities` → Персоны, `CG-HUB-*` → хаб, остальное → Статус | src/shared/options-routes.ts:86-105 | r/state/uiStore.ts:94 | pilot-chatspace | В десктопе ссылка есть у двух кодов и ведёт в настройки целиком |
| ST-008 | Плашка диплинка | «КОД · описание» вверху раздела | src/options/index.ts:4493-4497,4557-4577 | — | pilot-chatspace | |
| ST-009 | Подсветка цели | 2 с, когда цель отрисована, повторно при hashchange | src/options/index.ts:4502-4555 | — | pilot-chatspace | |
| ST-010 | Якоря по кодам | HUB-01 → адрес, HUB-02/03/17/18/19 → вход, HUB-04 → доступ к хосту, HUB-05 → страницы, FLOW-01 → персоны, FLOW-02 → аккаунты | src/options/index.ts:4478-4492 | — | pilot-chatspace | Коды — по итогу вопроса В26 |
| ST-011 | Экран входа вместо настроек | Без входа: форма, «Дополнительно», звук, версия | src/options/sign-in-gate.ts:6-99; src/options/index.ts:676-689 | r/app/AppShell.tsx:88-96 | pilot-chatspace | |
| ST-012 | Чеклист первого запуска | «Как начать», вход, хост и персона; скрывается навсегда | src/options/index.ts:784-890,2953-3053 | — | pilot-chatspace | Третий шаг на ChatSpace: аккаунт OM ↔ страница |
| ST-013 | Автосохранение | Дебаунс 350 мс, запись на change и blur, цепочка записей | src/options/index.ts:3880-4097 | f/settings/SettingsSurface.tsx:245-265 | pilot-chatspace | |
| ST-014 | Тост сохранения | «Сохранено ✓» или «не сохранены» с «Повторить» | src/options/index.ts:3794-3824 | f/settings/SettingsSurface.tsx:245-265 | pilot-chatspace | |
| ST-015 | Запись при закрытии | На pagehide несохранённое пишется синхронно | src/options/index.ts:4342-4371 | — | pilot-chatspace | |
| ST-016 | Барьер новой схемы | Хранилище новее сборки → контролы выключены | src/options/index.ts:633-659,4740-4762 | — | pilot-chatspace | |
| ST-017 | «Settings Unavailable» | Фон не подтвердил готовность хранилища | src/options/index.ts:592-613 | — | pilot-chatspace | |
| ST-018 | Синхронизация вкладок | Вход, персоны, маппинги из другой вкладки применяются сразу | src/options/index.ts:4783-4888 | — | pilot-chatspace | |

### 9.2 Раздел «Статус»

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| ST-020 | Заголовок готовности | «Готово к смене», «Нужно N действий», «Готовность неизвестна» | src/options/index.ts:3194-3296 | — | pilot-chatspace | |
| ST-021 | Шаг «подключить хаб» | — | src/options/index.ts:2882-2921 | — | pilot-chatspace | |
| ST-022 | Шаг «разрешить доступ к хабу» | — | src/options/index.ts:2922-2933 | — | pilot-chatspace | |
| ST-023 | Шаг «открыть хост под моделью» | — | src/options/index.ts:2934-2938 | — | pilot-chatspace | На ChatSpace: открыт ChatSpace, аккаунт привязан |
| ST-024 | Шаг «назначить персону» | — | src/options/index.ts:2939-2946 | — | pilot-chatspace | |
| ST-025 | Строка хоста | Сколько аккаунтов в работе, @handles, возраст | src/options/index.ts:3298-3349 | — | pilot-chatspace | Только из памяти ChatSpace, без запросов к OM |
| ST-026 | Строка «Hub» | Отвечает / деградирован / недоступен, задержка; десктоп: «Активность → Хаб / AI» | src/options/index.ts:3434-3458 | f/settings/sections/ActivitySettings.tsx:176-271 | pilot-chatspace | |
| ST-027 | Строка «Доступ» | Логин, роль, число страниц, «credential отклонён» и «Войти заново» | src/options/index.ts:3460-3487 | — | pilot-chatspace | |
| ST-028 | Строка «Квота AI» | Худшая страница первой, список по страницам | src/options/index.ts:3560-3606 | — | pilot-chatspace | |
| ST-029 | Строка «Активность» | Последняя генерация, ошибки хаба за сегодня | src/options/index.ts:3610-3643 | — | pilot-chatspace | |
| ST-030 | Строка «Spenders» | Итог последней сборки доски | src/options/index.ts:3645-3685; src/background/spenders-status-tracker.ts:1-122 | — | pilot-chatspace | |
| ST-031 | Строка «Звук» | «слушаем N из M», «перезагрузите N», «сигналов N» | src/options/message-sound.ts:259-283 | — | pilot-chatspace | |
| ST-032 | Строка «Контракт» | Видна в режиме отладки | src/options/index.ts:2688-2699,3489-3501 | — | pilot-chatspace | Добавить контракт хоста ChatSpace (версия, найденные якоря) |
| ST-033 | «Проверить всё» | Не чаще раза в 10 с | src/options/index.ts:144,3696-3724 | — | pilot-chatspace | |
| ST-034 | Штамп «обновлено HH:MM» | — | src/options/index.ts:2713-2716 | — | pilot-chatspace | |
| ST-035 | Карточка «Поддержка» | Версия, схема хранения | src/options/index.ts:2769-2792 | — | pilot-chatspace | |
| ST-036 | «Скопировать отчёт» | Без секретов: версия, схема, хаб, строки, ошибки, звук, шаги | src/options/index.ts:302-460,3726-3744 | — | pilot-chatspace | Вместе с выгрузкой диагностики (LG-020) |
| ST-037 | «Куда смотреть» | Переходы в разделы | src/options/index.ts:2796-2807 | — | pilot-chatspace | |
| ST-038 | Перепроверка при фокусе | Не чаще раза в 5 с | src/options/index.ts:140,5472-5501 | — | pilot-chatspace | |

### 9.3 Раздел «Аккаунт ChatGoose» (хаб)

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| ST-040 | Зоны раздела | Подключение, Диагностика, Аккаунт, Вход | src/options/index.ts:2641-2660 | f/settings/sections/HubSettings.tsx:128-370 | pilot-chatspace | |
| ST-041 | Адрес хаба | `https://gosling-agency.ru` по умолчанию, в «Дополнительно», нормализуется | src/shared/constants.ts:18,336; src/options/index.ts:2575-2589 | s/constants.ts:81; f/settings/sections/HubSettings.tsx:299-322; f/auth/SignInScreen.tsx:127-160 | pilot-chatspace | |
| ST-042 | Нельзя сменить адрес при активном входе | «Перед сменой адреса выйдите» | — | m/hub/device-token.ts:103-104; f/settings/sections/HubSettings.tsx:317-321 | pilot-chatspace | |
| ST-043 | Доступ к хосту хаба | 7 состояний, «Разрешить доступ» по клику, реакция на выдачу и отзыв без перезагрузки | src/options/index.ts:1813-2001,4105-4131 | — | pilot-chatspace | Нестандартный адрес хаба — optional host permission |
| ST-044 | Строка «Связь» | Состояние, код CG, «время · N мс» | src/options/index.ts:1637-1803 | — | pilot-chatspace | |
| ST-045 | «Проверить связь» | Fansly: через `pages()` 5 с, обновляет персоны; десктоп: `GET /auth/me` 10 с, имя, роль, число страниц | src/options/index.ts:2003-2013; src/background/runtime-api.ts:1075-1101 | m/hub/test-connection.ts:9-112; m/diagnostics/key-tests.ts:30-70; f/settings/sections/HubSettings.tsx:44-56,355-385 | pilot-chatspace | Через bootstrap |
| ST-046 | Форма входа | Логин и пароль, доступ к хосту запрашивается до входа, ошибки по-русски, пароль стирается | src/options/index.ts:2185-2310 | f/auth/SignInScreen.tsx:55-170 | pilot-chatspace | |
| ST-047 | «Это устройство» | Вход есть или нет, дата, последние символы токена | src/options/index.ts:2093-2163 | f/settings/sections/HubSettings.tsx:264-298 | pilot-chatspace | |
| ST-048 | «Войти заново» | Перевыпуск без выхода | src/options/index.ts:2047,2173-2177 | — | pilot-chatspace | |
| ST-049 | «Аккаунт» | Открывает `<хаб>/account` (устройства, пароль, свои AI-траты) | src/options/index.ts:2051-2058 | f/settings/sections/HubSettings.tsx:148-160 | pilot-chatspace | |
| ST-050 | «Нужна помощь со входом» | Открывает start.html | src/options/index.ts:2061-2066 | f/auth/links.ts:1-4; f/auth/SignInScreen.tsx:163-170 | pilot-chatspace | |
| ST-051 | «Выйти…» | Подтверждение, стирание и отзыв (5 с), 4 исхода, маппинги остаются | src/options/index.ts:2312-2397 | f/settings/sections/HubSettings.tsx:162-171 | pilot-chatspace | |
| ST-052 | «Вы вошли как» | Логин · роль; десктоп: карточка «Подключено как X» с меткой устройства | src/options/index.ts:2119-2126 | f/settings/sections/HubSettings.tsx:130-147 | pilot-chatspace | |
| ST-053 | Страницы | Число и чипы страниц | src/options/index.ts:3070-3083 | — | pilot-chatspace | Из bootstrap |
| ST-054 | Диагностика «Ядро» | Статус, задержка | src/options/index.ts:3100-3118 | — | pilot-chatspace | |
| ST-055 | «Контракт SDK» | Хеш и коммит, виден всегда | src/options/index.ts:2551,3129-3145 | — | pilot-chatspace | Совместимость по `compatibleClientSdks` (план §3.1) |
| ST-056 | «Ошибки ядра» | CG-HUB за сегодня, последняя, хвост 20 | src/options/index.ts:3150-3168 | — | pilot-chatspace | |
| ST-057 | «Fan Summary» | Последний пуш рекапа: время и аккаунт | src/options/index.ts:3171-3189 | — | pilot-chatspace | |
| ST-058 | Самопроверка при открытии | Доступ, связь, затем каталог персон | src/options/index.ts:5554-5573 | — | pilot-chatspace | |
| ST-059 | «Забыть локально» | Стереть вход без сети, с подтверждением | — | f/settings/sections/HubSettings.tsx:172-184,217-233; m/index.ts:2216-2255 | not-applicable | В модели Fansly выход всегда стирает локально |

### 9.4 Разделы «Персоны» и «Аккаунты»

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| ST-060 | Каталог персон | Только чтение: имя, built-in, «vN»; архивные без аккаунтов скрыты | src/options/index.ts:4215-4300 | f/settings/sections/PersonalitySettings.tsx:27-50 | pilot-chatspace | |
| ST-061 | Архивная персона с аккаунтами | Бейдж «выбери замену» | src/options/index.ts:4290-4295 | — | pilot-chatspace | |
| ST-062 | Аккаунты на персоне | «на ней · N», чипы | src/options/index.ts:4300-4316 | — | pilot-chatspace | |
| ST-063 | Пустые состояния каталога | Четыре честных варианта | src/options/personas.ts:92-104 | — | pilot-chatspace | |
| ST-064 | «Синхронизация» каталога | Дата изменения, источник; «Проверить связь и обновить» | src/options/index.ts:4152-4206,4208-4237 | — | pilot-chatspace | |
| ST-065 | «К аккаунтам →» | — | src/options/index.ts:4144-4147 | — | pilot-chatspace | |
| ST-066 | Экспорт старых локальных персон | JSON и копирование; экран восстановления при битом снимке | src/options/index.ts:520-590,4318-4334 | f/settings/sections/PersonalitySettings.tsx:51-70; m/personas/catalog.ts:3-11 | not-applicable | Легаси нет; выгрузить из старых клиентов до удаления |
| ST-067 | Список аккаунтов с группами | В работе / Видели раньше / Сессий не было / Неизвестно | src/options/index.ts:4927-4990; src/background/account-presence.ts:1-40 | — | pilot-chatspace | Аккаунты OM, несколько в одной вкладке |
| ST-068 | Счётчик и пустые состояния | «{live} из {total}» | src/options/index.ts:4950-4958 | — | pilot-chatspace | |
| ST-069 | Заголовок и копирование id | — | src/options/index.ts:5017-5035 | — | pilot-chatspace | |
| ST-070 | Локальная подпись ✎ | До 60 символов, только локально | src/options/index.ts:5040-5146; src/background/account-labels.ts:1-23 | — | pilot-chatspace | |
| ST-071 | Строка состояния аккаунта | «вкладка активна» / «была …» | src/options/index.ts:5154-5160 | — | pilot-chatspace | |
| ST-072 | «страница ядра: X» | По последней генерации | src/options/index.ts:5161-5165 | — | pilot-chatspace | По bootstrap |
| ST-073 | Персона для аккаунта | Выбор из каталога; архивные недоступны | src/options/index.ts:4666-4706,5195-5244 | f/settings/sections/PersonalitySettings.tsx:76-125; m/settings/store.ts:308 | pilot-chatspace | |
| ST-074 | Бейджи «AI отключён», «выбери замену», «не найдена» | — | src/options/index.ts:4638-4663 | f/settings/sections/PersonalitySettings.tsx:27-120 | pilot-chatspace | |
| ST-075 | Звук модели | Выключатель на аккаунт, глушит оба звука | src/options/index.ts:5254-5266 | — | pilot-chatspace | |
| ST-076 | «к вкладке» | Активирует вкладку с этим аккаунтом | src/options/index.ts:5268-5301; src/background/runtime-api.ts:822-841 | — | needs-owner-decision | В ChatSpace модели в одной вкладке (вопрос В22) |
| ST-077 | «Вкладки без атрибуции: N» | Вкладки Fansly без захваченной сессии | src/options/index.ts:5359-5366 | — | fansly-phase | Понятие есть только у Fansly |
| ST-078 | Подсказка «В работе» и сниженный режим | — | src/options/index.ts:4449-4453,4889-4964 | — | pilot-chatspace | |
| ST-079 | Сверка legacy ↔ canonical id | Через Fansly `/account/me` | src/background/runtime-api.ts:983-1039 | — | fansly-phase | Два id есть только у сессии Fansly |
| ST-080 | Порядок аккаунтов | Перетаскивание в рейле (`accountOrder`) | — | f/inbox/AccountRail.tsx:58-93; m/settings/store.ts:309 | not-applicable | Вкладками аккаунтов управляет ChatSpace |
| ST-081 | Ручная привязка аккаунта к странице | `accountPageLabels` | — | f/settings/sections/HubSettings.tsx:324-350; m/settings/store.ts:330 | not-applicable | Привязку задаёт хаб (план §3.2) |

### 9.5 Раздел «Генерация» и поведение

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| ST-090 | `quickMessageCount` | 5–200, по умолчанию 100; окно Reply, Help, Coach, voice | src/shared/constants.ts:153-155; src/options/index.ts:1153-1158 | s/constants.ts:24-26 | needs-owner-decision | Вопрос В6 |
| ST-091 | `pingMessageCount` | 5–200, по умолчанию 100 | src/shared/constants.ts:156-158 | s/constants.ts:27-29 | needs-owner-decision | Вопрос В6 |
| ST-092 | `improveMessageCount` | 5–200, по умолчанию 25 | src/shared/constants.ts:163-165 | s/constants.ts:30-32 | needs-owner-decision | Вопрос В6 |
| ST-093 | `deepMessageCount` | Fansly 100–3000, по умолчанию 3000; десктоп 1500 | src/shared/constants.ts:166-171; src/shared/migrations.ts:150-190 | s/constants.ts:33-35 | needs-owner-decision | Вопрос В6; 3000 — граница хаба (план §3.6) |
| ST-094 | Числовые поля | Степпер, колесо не меняет значение, чип «сохранено как N» | src/options/index.ts:1142-1152,1330-1433 | — | pilot-chatspace | |
| ST-095 | `coachHistoryLimit` | 1–20, по умолчанию 10 | src/shared/constants.ts:182-184 | — | pilot-chatspace | |
| ST-096 | `coachAutoRecap` | Выкл / Короткий / Полный, по умолчанию выкл; у «Полный» предупреждение о цене | src/shared/constants.ts:201-204,347; src/options/index.ts:1187-1275 | — | pilot-chatspace | |
| ST-097 | `debugMode` | По умолчанию выкл; логи, эхо, профайлер, журнал «Новых», отладка Coach, строка контракта | src/shared/constants.ts:342; src/options/index.ts:1277-1284 | f/settings/sections/BehaviorSettings.tsx:335-343; m/settings/store.ts:115,214 | pilot-chatspace | |
| ST-098 | `defaultReplyTone` | casual, в интерфейсе нет | — | m/settings/store.ts:306 | needs-owner-decision | Вопрос В1 |
| ST-099 | `promptCachingEnabled` | Переключатель (десктоп) / скрытая настройка (Fansly); никто не читает | src/shared/constants.ts:343 | f/settings/sections/BehaviorSettings.tsx:262-267 | not-applicable | Кэшем управляет хаб |
| ST-100 | Модели и reasoning по фичам | `featureModels`, `featureReasoning` — хранятся, не используются | — | s/constants.ts:107-126,155-156 | not-applicable | Модель выбирает хаб |
| ST-101 | Уведомления `notificationsEnabled` | Тосты и OS-уведомления о входящих и покупках | — | f/settings/sections/BehaviorSettings.tsx:244-249 | provided-by-chatspace | Уведомления ChatSpace |
| ST-102 | Авточтение и пометка прочитанным | `autoReadChats`, `markAsReadOnOpen` | — | f/settings/sections/BehaviorSettings.tsx:256-261; m/settings/store.ts:302,305 | not-applicable | Расширение никогда не читает и не помечает |
| ST-103 | Сверка непрочитанных (11 настроек) | `unreadReconcile.*`: триггеры, задержки, интервалы, число страниц | — | f/settings/sections/BehaviorSettings.tsx:344-436; m/settings/store.ts:318-328 | not-applicable | Своих чтений OFAPI нет |
| ST-104 | Скрытые переключатели синхронизации | `hubModeOverride`, `spendSweepRollbackToLegacy`, `hubSyncProtocol`, транспорты | — | f/settings/sections/BehaviorSettings.tsx:437-468; m/settings/store.ts:233-247,311-316 | not-applicable | Синхронизации нет |
| ST-105 | Бюджет кредитов на смену | `creditBudgetPerShift`, интерфейса нет | — | m/settings/store.ts:307; m/sync/budget-guard.ts:1-2 | not-applicable | Своих кредитов нет |
| ST-106 | Вид суммы фана в списке | `spendStyle`: цифра или чип | — | f/settings/sections/BehaviorSettings.tsx:308-334 | not-applicable | Строки списка принадлежат ChatSpace |
| ST-107 | Масштаб `uiScale` | 90–125 % | — | f/settings/sections/BehaviorSettings.tsx:284-294; m/index.ts:531-534 | not-applicable | Масштаб задаёт браузер |
| ST-108 | Списки OF/OM → полки Spenders | По аккаунту: добавить, убрать, порядок | — | f/settings/sections/SpendersSettings.tsx:36-160; m/settings/store.ts:332 | needs-owner-decision | Вопрос В10 |
| ST-109 | «Только спендеры», сортировка «Онлайн» | `onlineOnlySpenders`, `onlineSort` | — | f/online/OnlineSurface.tsx:150-167; m/settings/store.ts:334-335 | provided-by-chatspace | Fans Online ChatSpace |
| ST-110 | «Данные» | Размер кэша, папка, очистка с подтверждением | — | f/settings/sections/DangerZone.tsx:1-258 | not-applicable | Локальной БД нет |
| ST-111 | «Обновления» | Проверить, скачать, перезапустить | — | f/settings/sections/UpdateSettings.tsx:1-100 | not-applicable | Обновлениями расширения занимается браузер |
| ST-112 | «Активность»: синк, кредиты, аудит отправок | — | — | f/settings/sections/ActivitySettings.tsx:100-470 | not-applicable | Нет синхронизации, кредитов OFAPI и отправок |

### 9.6 Разделы «Хоткеи» и «Вид», служебные ключи

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| ST-120 | Справочник хоткеев | Только чтение, из вендорной схемы, 4 группы; метка платформы; подсказки | src/options/hotkeys-pane.ts:37-113; src/options/index.ts:1505-1524 | — | pilot-chatspace | |
| ST-121 | Строки вне схемы | Enter — следующая часть, `?` — шпаргалка, Esc — закрыть | src/shared/hotkeys.ts:196-198 | — | pilot-chatspace | |
| ST-122 | Тема `uiTheme` | Системная / Светлая / Тёмная; по умолчанию Fansly — system, десктоп — light | src/shared/constants.ts:344; src/options/index.ts:928-1007 | f/settings/sections/BehaviorSettings.tsx:296-306; m/settings/store.ts:341 | pilot-chatspace | Плюс вариант «как в ChatSpace» (класс `dark` на `<html>`) — решение дизайна |
| ST-123 | «система сейчас — …» | Следит за темой ОС | src/options/index.ts:1011-1015,1120-1132 | — | pilot-chatspace | |
| ST-124 | Превью «Панель в чате» | Превью тулбара в настройках | src/options/index.ts:1037-1077 | — | pilot-chatspace | |
| ST-125 | `showToolbarHints` | По умолчанию вкл | src/shared/constants.ts:345 | — | pilot-chatspace | |
| ST-126 | Звук сообщений вкл/выкл | Fansly `messageSoundEnabled`, десктоп `soundEnabled`; по умолчанию вкл | src/shared/constants.ts:348 | f/settings/sections/BehaviorSettings.tsx:250-255; m/settings/store.ts:296 | pilot-chatspace | |
| ST-127 | Тон сообщений | Fansly по умолчанию chime, десктоп blip | src/shared/message-sound.ts:15-17; src/options/message-sound.ts:21-30 | f/settings/sections/BehaviorSettings.tsx:181-188; s/sound/index.ts:23 | pilot-chatspace | Выбрать один дефолт |
| ST-128 | Звук подписчиков вкл/выкл | Fansly `followSoundEnabled`, десктоп `subscriberSoundEnabled`; вкл | src/shared/constants.ts:352 | f/settings/sections/BehaviorSettings.tsx:189-194; m/settings/store.ts:299 | pilot-chatspace | См. SN-012 |
| ST-129 | Тон подписчиков | Fansly double, десктоп arpeggio | src/shared/message-sound.ts:19 | f/settings/sections/BehaviorSettings.tsx:195-202; s/sound/index.ts:24 | pilot-chatspace | Выбрать один дефолт |
| ST-130 | Громкость | 5–100, шаг 5, по умолчанию 50, общая на оба звука | src/shared/message-sound.ts:20-26,61-65 | f/settings/sections/BehaviorSettings.tsx:203-219; s/sound/index.ts:27-30 | pilot-chatspace | |
| ST-131 | Кнопки проверки звука | «Звук не прозвучал: …» | src/options/message-sound.ts:161-221 | f/settings/sections/BehaviorSettings.tsx:157-164 | pilot-chatspace | |
| ST-132 | Ссылка «Выключить для моделей» | В «Аккаунты» | src/options/message-sound.ts:165-170 | — | pilot-chatspace | |
| ST-133 | Строка состояния звука | Опрос раз в 10 с | src/options/message-sound.ts:237-257 | — | pilot-chatspace | |
| ST-134 | Звук до входа | Выключатели звука на экране входа | src/options/sign-in-gate.ts:17,63 | — | pilot-chatspace | |
| ST-135 | Язык `uiLocale` | system / ru / en | — | f/settings/sections/BehaviorSettings.tsx:272-282; m/settings/store.ts:338 | pilot-chatspace | См. I18-001 |
| ST-136 | Служебные ключи хранилища | onboarding, lastSeenVersion, accountLabels, accountPresence, opsDaily, deviceTokenMeta, device token отдельным ключом | src/shared/constants.ts:35-63 | — | pilot-chatspace | |
| ST-137 | Окно Hi = 25 | Без настройки | src/shared/features.ts:121,229-230 | — | fansly-phase | Страница Fansly API |
| ST-138 | Удалённые настройки и мёртвые строки | v9, v11, v17; `rail.microQuota` и др. | src/shared/migrations.ts:72-95; src/options/copy.ts:50,163,364 | — | not-applicable | Удалены намеренно |

## 10. Вход, аккаунт, персоны

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| AU-001 | Вход логином и паролем | Device token через `POST /auth/device-tokens/password` | src/background/device-token.ts:85-123 | m/hub/device-token.ts:246-300; m/ipc/handlers.ts:747 | pilot-chatspace | D35; узкий токен расширения (план §3.3) |
| AU-002 | Ответ pending не сохраняется | Вход отклоняется | src/background/device-token.ts:109-117 | — | pilot-chatspace | |
| AU-003 | Вход в два шага с журналом | Резерв → активация, идемпотентно, переживает падение; отмена во время входа; баннер «Завершаем вход/выход»; повторы журнала | — | m/hub/device-token.ts:1-11,282-300,543-557; m/hub/credential-journal.ts:4-42; r/app/AppShell.tsx:98-114; m/index.ts:1705-1741 | not-applicable | План §4: модель Fansly (FIFO, active), без журналов |
| AU-004 | Таймаут входа 20 с | — | — | m/hub/device-token.ts:107-172 | pilot-chatspace | |
| AU-005 | Метка устройства | Fansly «Firefox · ОС», десктоп «Desktop · hostname» | src/background/hub-custody.ts:151-163 | m/index.ts:1800 | pilot-chatspace | Своя различимая метка |
| AU-006 | Атомарная запись входа | Один `storage.set` в очереди | src/background/runtime-api.ts:1109-1173 | — | pilot-chatspace | |
| AU-007 | Хранение токена | Fansly: `storage.local` открытым текстом; десктоп: шифрование ОС (safeStorage) | src/background/hub-custody.ts:47-58 | m/secrets/keychain.ts:1-21 | pilot-chatspace | В браузере шифрования ОС нет — риск снижает узкий токен (план §3.3) |
| AU-008 | Метаданные токена | prefix, issuedAt, expiresAt, issuedFrom, version | src/shared/constants.ts:48-52 | m/hub/credential-journal.ts:50-60 | pilot-chatspace | |
| AU-009 | Очередь переходов входа | Вход, выход, самовосстановление строго по одному | src/background/hub-custody.ts:1-36 | m/hub/auth-recovery.ts:47-48,63 | pilot-chatspace | |
| AU-010 | Самовосстановление | 401/403 с `token_revoked` / `token_expired` по тому же токену → стирание входа | src/background/hub-custody.ts:60-141 | m/hub/auth-recovery.ts:1-102; m/index.ts:1667-1703 | pilot-chatspace | |
| AU-011 | 401 без причины не разлогинивает | Показывается код | src/background/hub-custody.ts:9-12 | s/i18n/catalog.ts:217-224 | pilot-chatspace | |
| AU-012 | Хук `onAuthError` для стрима | — | src/background/agency-hub-client.ts:245-251 | — | pilot-chatspace | |
| AU-013 | Выход | Стирание, отзыв на хабе-издателе (5 с), повторное стирание | src/background/runtime-api.ts:1175-1295 | m/index.ts:2196-2215; m/hub/device-token.ts:558,979 | pilot-chatspace | |
| AU-014 | Ответ на старый токен не стирает новый вход | — | src/background/hub-custody.ts:106-141 | — | pilot-chatspace | |
| AU-015 | Баннер причины выхода | На экране входа — почему вход кончился | — | m/hub/auth-recovery.ts:85-95; f/auth/SignInScreen.tsx:60-67 | pilot-chatspace | |
| AU-016 | Привязка входа к адресу хаба | none / bound / unbound / mismatch / unreadable; «вход требует внимания» | — | m/hub/credential-journal.ts:44-48; m/settings/store.ts:526-575; m/runtime-activation.ts:31-45 | pilot-chatspace | Каждая операция привязана к hubOrigin и эпохе входа (план §4) |
| AU-017 | Повтор подключения после входа | 1, 5, 15 с, потом 60 с; ошибка с пояснением | — | m/index.ts:1743-1771; m/runtime-activation.ts:515-540 | pilot-chatspace | Повтор bootstrap |
| AU-018 | Интерфейс работает без хаба | UI открывается до подключения | — | m/runtime-activation.ts:8-61 | pilot-chatspace | |
| AU-019 | Нет технических слов в UI | Тест не пускает token, key, API, bearer в тексты | — | packages/shared/tests/copy-vocabulary.test.ts:3,24-27 | pilot-chatspace | |
| AU-020 | Легаси-ключи и карантин | Удаление ofapiKey, anthropicKey и др.; карантин ключей до 0.1.41; досоздание данных старых токенов; legacy-ключ чаттера Fansly | src/shared/constants.ts:41-47 | m/secrets/keychain.ts:53-63; m/index.ts:1626-1633,1782-1787 | not-applicable | В новом клиенте легаси нет |
| AU-021 | Хаб настроен = адрес + токен | — | src/background/agency-hub-client.ts:95-101 | — | pilot-chatspace | |
| AU-022 | Доступные страницы от хаба | Список аккаунтов = страницы, выданные хабом; кэш помечен владельцем | src/background/agency-hub-client.ts:323-333 | m/db/grant-owner.ts:1-25; f/inbox/ChatListPane.tsx:58-64 | pilot-chatspace | Из bootstrap с кэшем (план §3.2) |
| AU-023 | Привязка аккаунта к странице хаба | Fansly: pageLabel по точному username; десктоп: одно совпадение username → modelSlug → label, кэш 5 мин | src/background/agency-hub-client.ts:335-356,419-465; src/background/operations.ts:2850-2870 | s/hub/page-mapping.ts:1-40; m/hub/page-resolver.ts:9 | pilot-chatspace | Только по `platform_account_id`, без подбора по username (план §3.2) |
| AU-024 | Привязка сверяется всю генерацию | Сменилась — результат отбрасывается | — | m/hub/ai-feature-gateway.ts:146-170 | pilot-chatspace | |
| AU-025 | «Нет выданных страниц» / «страницы грузятся» | Объясняет, почему пусто | — | f/inbox/ChatListPane.tsx:52-64,133-138 | pilot-chatspace | |
| AU-026 | Каталог персон | Только метаданные; привязан к адресу хаба и токену | src/background/agency-hub-client.ts:662-694; src/background/persona-catalog.ts:51-174 | m/hub/index.ts:55,520; m/personas/catalog.ts:15-25 | pilot-chatspace | |
| AU-027 | Обновление каталога персон | Старт, раз в 5 мин, смена хаба или входа, «Проверить связь», `chat_changed` из-за персоны | src/background/persona-catalog.ts:13-45; src/background/index.ts:69-72,121-124,188-190,212 | m/hub/index.ts:55,520 | pilot-chatspace | Учесть `configRevision` bootstrap |
| AU-028 | Повторная проверка персоны | Перед поиском страницы, стримом и записью | src/background/persona-identity-fence.ts:1-54 | — | pilot-chatspace | |
| AU-029 | Ключей OFAPI на машине нет | Все чтения и записи OF — от имени хаба | — | m/ofapi/transport.ts:16-28; m/settings/store.ts:233-235 | pilot-chatspace | Строже: узкий токен без `/ofapi/*` (план §3.3) |
| AU-030 | Генерация только с живым хостом | CG-FAN-01/02 | src/background/operations.ts:1295-1299 | — | pilot-chatspace | На ChatSpace: приложение смонтировано, мост найден |
| AU-031 | Сессия хоста Fansly | id из authorization, SessionStore, 401/403 Fansly, опознание через `/account/me` | src/background/session-capture.ts:5-13; src/background/session-store.ts:14-196; src/background/runtime-api.ts:983-1035 | — | fansly-phase | Механизм Fansly; сессию ChatSpace не снимаем (X3) |
| AU-032 | Алиасы legacy ↔ canonical | — | src/shared/account-aliases.ts:1-72 | — | fansly-phase | Не смешивать `acct_…` и id OF |
| AU-033 | Чат из URL | `/messages/<id>` | src/shared/fansly-routes.ts:4-7 | — | fansly-phase | На ChatSpace — роутер (`/accounts/:accountId/chats/:chatId`) |
| AU-034 | Аккаунтов на вкладку | Fansly: один | src/background/session-store.ts:14-16,79-104 | — | pilot-chatspace | В ChatSpace несколько, привязка по маршруту |
| AU-035 | Известные аккаунты и присутствие | Регистрация при захвате, `lastSeenAt`, окно записи 30 с | src/background/storage-coordinator.ts:348-385; src/background/account-presence.ts:1-200 | — | pilot-chatspace | Источник — `["accounts"]` из памяти ChatSpace |
| AU-036 | Идентичность вкладки для vault | — | src/background/runtime-api.ts:611-640 | — | fansly-phase | Только для vault Fansly |
| AU-037 | Точка авторизации OF-аккаунта | «нужна повторная авторизация, напишите админу» | — | f/inbox/AccountRail.tsx:225,250-256 | provided-by-chatspace | Доступность сессии OF показывает ChatSpace |

## 11. Связь с хабом

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| HB-001 | «Сначала войдите» | Без входа проверка отвечает понятной причиной | — | m/diagnostics/key-tests.ts:37-43 | pilot-chatspace | |
| HB-002 | Проверка запускает самовосстановление | 401 с причиной из проверки — в общий механизм | — | m/diagnostics/key-tests.ts:59-66; m/hub/test-connection.ts:71-90 | pilot-chatspace | |
| HB-003 | Статус хаба | off / connecting / live / degraded / auth-failed / stopped | — | p/contract.ts:210-218; f/settings/sections/HubSettings.tsx:138-140,282-288 | pilot-chatspace | Смысл: доступность хаба и bootstrap |
| HB-004 | `x-client-version` | Версия клиента в каждом запросе | src/shared/client-version.ts:6-16 | s/hub/client.ts:421-426,538-540 | pilot-chatspace | Различимое имя клиента (план §3.2) |
| HB-005 | Пин контракта SDK | Хеш контракта в манифесте вендоринга и тест | — | packages/kernel-sdk/kernel-sdk.vendor.json:2-3; packages/shared/tests/kernel-sdk-vendor.test.ts:10 | pilot-chatspace | |
| HB-006 | Проверка ответов хаба | Схемы SDK; не та форма — сбой хаба, а не данные; health через safeParse | src/background/agency-hub-client.ts:232-234,750-766 | s/hub/client.ts:183-230 | pilot-chatspace | |
| HB-007 | Расхождение хеша контракта | Показывается, но не блокирует | src/background/agency-hub-client.ts:756-765 | — | pilot-chatspace | |
| HB-008 | Поправка на время сервера | Смещение часов по заголовку Date | — | s/hub/client.ts:542-553 | not-applicable | Нужна только старым частям десктопа |
| HB-009 | Поток событий хаба (SSE v2) | Курсор, переподключение, «отравленный кадр», догон денежных фактов, счётчики | — | m/sync/hub-sync.ts:1-140; m/sync/intents.ts:1-14; m/sync/money-facts.ts:1-14; p/contract.ts:219-231 | not-applicable | SSE хаба в расширении нет (план §3.8) |
| HB-010 | Работа без сети из кэша | Зашифрованный локальный кэш при недоступном хабе | — | m/runtime-activation.ts:8-17; m/index.ts:672-675 | not-applicable | Данные чата даёт ChatSpace |
| HB-011 | `client/bootstrap` и `client_health` | Привязки страниц, флаги, лимиты, minVersion; телеметрия здоровья клиента | — | — | pilot-chatspace | Нового в плане (§3.2), не паритет — для полноты |

## 12. Ошибки CG-* и тосты

Важно: **у двух клиентов одинаковые коды значат разное.** Например, CG-HUB-03 у Fansly —
«хаб отклонил вход», у десктопа — «дневная квота»; CG-HUB-09 — «квота» против «обрыв
стрима»; CG-HUB-20 — «много попыток входа» против «неверный логин». Хаб ведёт это
расхождение явно: `hub/docs/error-handling.md` §2, колонки «Firefox extension mapping» и
«Desktop mapping». Новому клиенту нужен один реестр (вопрос В26). Ниже строки сведены по
смыслу, у каждой — оба кода.

### 12.1 Механика

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| ER-001 | Реестр — единый источник | Ключ → код, текст, описание, `settingsLink` | src/shared/errors.ts:7-15,512-521 | s/errors/index.ts:241-258 | pilot-chatspace | |
| ER-002 | Расхождение кодов между клиентами | Одинаковые номера CG-HUB-* у Fansly и десктопа значат разное | src/shared/errors.ts:114-249 | s/errors/index.ts:155-218 | needs-owner-decision | Какой реестр берёт новый клиент; хабу — третья колонка в `error-handling.md` §2 (вопрос В26) |
| ER-003 | Списанные коды не переиспользуются | Fansly: 5 «надгробий»; десктоп: 14 закрытых кодов (D26) | src/shared/errors.ts:376-424,478-482 | s/errors/index.ts:9-30 | pilot-chatspace | Переносится правило, не коды |
| ER-004 | Поиск ключа по коду | `findErrorKeyByCode` | src/shared/errors.ts:494-510 | — | pilot-chatspace | |
| ER-005 | Карточка ошибки | «КОД: текст», описание, «HTTP 429 • detail», подсказка; старые ошибки перерисовываются по текущему реестру | src/shared/errors.ts:567-636; src/content/ui/view-helpers.ts:55-166 | f/ai/AiDock.tsx:489-524; s/errors/index.ts:379-416 | pilot-chatspace | |
| ER-006 | Срок повтора | Дедлайн фиксируется один раз, «Повторите вручную после …», отсчёт 250 мс | src/content/ui/view-helpers.ts:55-166 | s/errors/index.ts:324-332; f/ai/dockLogic.ts:248-271 | pilot-chatspace | Повтор только вручную |
| ER-007 | Пояснение ядра под заголовком | Текст ядра до 400 символов | — | s/errors/index.ts:363-372; f/ai/AiDock.tsx:501-503 | pilot-chatspace | |
| ER-008 | Тексты ошибок по-русски везде | Fansly по-русски почти везде; десктоп — только вход и проверка связи | src/options/copy.ts:1-20 | r/lib/i18n.ts:38-51; s/i18n/catalog.ts:28-136 | pilot-chatspace | На всех поверхностях, включая карточки AI |
| ER-009 | Тосты | info / success / warning / error, 4,5 с (десктоп 6 с), одинаковый текст заменяет тост; клик ведёт в чат | src/content/toast.ts:10-99 | r/app/ToastHost.tsx:5-57; r/state/uiStore.ts:134 | pilot-chatspace | |
| ER-010 | Тост ошибки | Код, описание, таймер, техническая строка | src/content/toast.ts:40-51 | — | pilot-chatspace | |
| ER-011 | Кнопка «Настройки» в тосте и карточке | Ведёт в нужный раздел по коду (`settingsLink`) | src/content/index.ts:757-806 | f/ai/AiDock.tsx:512-520 | pilot-chatspace | Требование §0; в десктопе только 2 кода и без раздела |
| ER-012 | Тост несинхронизированного рекапа | CG-HUB-08 на 6,5 с | src/content/index.ts:3526-3532 | — | pilot-chatspace | |
| ER-013 | Тосты вне реестра | «Сначала закройте справку», «Write a draft…», «Дождись ответа коуча» | src/content/index.ts:908,1446,2607,2683 | — | pilot-chatspace | |
| ER-014 | Тосты фоновых генераций | «AI ready / AI failed · чат N», «AI busy» (не больше 3) | — | f/ai/aiStore.ts:103,353-392 | needs-owner-decision | Вопрос В5 |
| ER-015 | Тост «Hub settings updating» | AI не запускается, пока меняется адрес хаба | — | f/ai/aiStore.ts:105-114,368-376 | pilot-chatspace | |
| ER-016 | Отказы ядра → коды | По машинному коду, для старых ядер — по тексту: min_messages, hi_limit, ping_active, draft_required, voice_disabled | src/background/kernel-feature-gateway.ts:201-234 | m/hub/ai-feature-gateway.ts:27-71 | pilot-chatspace | |
| ER-017 | Ошибки хаба и провайдера → коды | 429, 502/503, 401/403, 404 `unknown_ai_feature`, `provider_*` | src/background/kernel-feature-gateway.ts:150-199,236-312 | s/hub/client.ts:133-230 | pilot-chatspace | |
| ER-018 | Ошибки входа → коды | 401, 403, 404, 5xx, сеть | src/background/device-token.ts:124-160 | m/hub/device-token.ts:186-244 | pilot-chatspace | |
| ER-019 | Ошибки OFAPI → коды | Ответ шлюза → CG-OF / NET / APP | — | m/ofapi/errors.ts:135-232 | not-applicable | `/ofapi` для расширения закрыт (план §3.3) |
| ER-020 | Карточка сбоя интерфейса | Error boundary: «Перезагрузить», «Выгрузить диагностику» | — | r/app/ErrorBoundary.tsx:1-84; r/App.tsx:27 | pilot-chatspace | |
| ER-021 | Перехват ошибок страницы | `window.onerror` и `unhandledrejection` в лог | — | r/lib/clientLog.ts:36-61; r/main.tsx:17-19 | pilot-chatspace | |
| ER-022 | Лог каждого упавшего вызова фона | — | — | r/bridge/bridge.ts:17-37 | pilot-chatspace | Для сообщений content ↔ background |
| ER-023 | Перехват ошибок фона | `uncaughtException`, `unhandledRejection` в лог | — | m/index.ts:327,1286-1292 | pilot-chatspace | В background |
| ER-024 | Фатальные сбои процесса и окна | Выход после фатальной ошибки, диалог сбоя запуска, проверка загрузки окна 30 с | — | m/index.ts:324-335,2551-2566; m/window-load.ts:1-30; m/renderer-readiness.ts:1-51 | not-applicable | Электрон; аналог — проверка контракта хоста при старте (DB-036) |
| ER-025 | Ошибка ≠ пустые данные | Отдельный блок ошибки с повтором (D30) | — | f/spenders/QueryFeedback.tsx:1-14 | pilot-chatspace | |

### 12.2 Коды (по смыслу; F — код Fansly, D — код десктопа)

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| ER-030 | Нет персон | F CG-FLOW-01, кнопка → Персоны | src/shared/errors.ts:40-46 | — | pilot-chatspace | |
| ER-031 | Нет персоны у аккаунта | F CG-FLOW-02 (→ Аккаунты); D CG-FLOW-02 (→ настройки) | src/shared/errors.ts:47-53 | s/errors/index.ts:93-97 | pilot-chatspace | |
| ER-032 | Мало истории | F CG-FLOW-03; D CG-FLOW-03 (меньше 30) | src/shared/errors.ts:54-59 | s/errors/index.ts:98-101 | pilot-chatspace | |
| ER-033 | Уже идёт другая операция | F CG-FLOW-04; D CG-FLOW-04 | src/shared/errors.ts:60-65 | s/errors/index.ts:102-105 | pilot-chatspace | |
| ER-034 | Ping заблокирован | F CG-FLOW-05; D CG-FLOW-05 (ядро `gate_ping_active`) | src/shared/errors.ts:66-71 | s/errors/index.ts:106-109 | pilot-chatspace | Срабатывание зависит от вопроса В4 |
| ER-035 | Контекст изменился | F CG-FLOW-06 `chat_changed` | src/shared/errors.ts:72-77 | — | pilot-chatspace | |
| ER-036 | Расширение перезагрузилось | F CG-FLOW-07 | src/shared/errors.ts:78-83 | — | pilot-chatspace | |
| ER-037 | Ошибка Compare | F CG-FLOW-08; D заглушка CG-FLOW-P4 вне реестра | src/shared/errors.ts:84-89 | m/ai/coordinator.ts:365-376 | not-applicable | Compare убран |
| ER-038 | Много сообщений для Hi | F CG-FLOW-09; D CG-FLOW-09 (больше 10) | src/shared/errors.ts:322-327 | s/errors/index.ts:110-113 | pilot-chatspace | Убрать «одна страница» |
| ER-039 | Сеть | CG-NET-01 у обоих | src/shared/errors.ts:90-95 | s/errors/index.ts:85-88 | pilot-chatspace | |
| ER-040 | Таймаут | CG-NET-02 у обоих | src/shared/errors.ts:96-101 | s/errors/index.ts:89-92 | pilot-chatspace | |
| ER-041 | Лимит 429 без `quota_denied` | F CG-API-01 | src/shared/errors.ts:34-39 | — | pilot-chatspace | Убрать упоминание Fansly |
| ER-042 | Сервис недоступен 502/503 | F CG-API-05 | src/shared/errors.ts:102-107 | — | pilot-chatspace | |
| ER-043 | Ответ AI нельзя использовать | CG-API-06 у обоих | src/shared/errors.ts:108-113 | s/errors/index.ts:81-84 | pilot-chatspace | |
| ER-044 | Неизвестная ошибка, «нужен черновик» | CG-APP-01 у обоих | src/shared/errors.ts:343-348 | s/errors/index.ts:114-117,415 | pilot-chatspace | |
| ER-045 | Coach: фан не определён | F CG-APP-02 | src/shared/errors.ts:349-357 | — | pilot-chatspace | |
| ER-046 | Нет сохранённого рекапа | F CG-APP-03 | src/shared/errors.ts:358-366 | — | pilot-chatspace | |
| ER-047 | Настройки не прочитались | F CG-APP-04 | src/shared/errors.ts:367-374 | — | pilot-chatspace | |
| ER-048 | Хост не подключён | F CG-FAN-01 (сессия Fansly не захвачена) | src/shared/errors.ts:16-21 | — | fansly-phase | Код хоста Fansly; для ChatSpace — ER-049 |
| ER-049 | Новый код: ChatSpace не готов / контракт хоста сломан | Нет моста, сторов, маршрута или не та версия | — | — | pilot-chatspace | Нового кода нет ни у кого; нужен для деградации при релизах OM |
| ER-050 | Сессия Fansly истекла | F CG-FAN-02 | src/shared/errors.ts:22-27 | — | fansly-phase | Код хоста Fansly |
| ER-051 | Fansly вернул ошибку | F CG-FAN-03 | src/shared/errors.ts:28-33 | — | fansly-phase | Своих запросов к OM нет |
| ER-052 | Неверный адрес хаба | F CG-HUB-01 → поле адреса | src/shared/errors.ts:114-120 | — | pilot-chatspace | |
| ER-053 | Не вошли | F CG-HUB-02 → вход | src/shared/errors.ts:121-128 | — | pilot-chatspace | |
| ER-054 | Хаб отклонил вход (401 без причины) | F CG-HUB-03 → вход; D CG-HUB-01 → настройки | src/shared/errors.ts:129-138 | s/errors/index.ts:155-161 | pilot-chatspace | |
| ER-055 | Нет доступа к адресу хаба | F CG-HUB-04 → доступ к хосту | src/shared/errors.ts:139-145 | — | pilot-chatspace | |
| ER-056 | Страница не сопоставлена | F CG-HUB-05 → страницы | src/shared/errors.ts:146-152 | — | pilot-chatspace | На OF: аккаунт OM не привязан к странице (bootstrap) |
| ER-057 | Хаб не ответил | F CG-HUB-06 | src/shared/errors.ts:153-158 | — | pilot-chatspace | |
| ER-058 | Запрос к хабу не прошёл | F CG-HUB-07; D CG-HUB-02 | src/shared/errors.ts:159-164 | s/errors/index.ts:162-167 | pilot-chatspace | |
| ER-059 | Рекап не синхронизирован | F CG-HUB-08 | src/shared/errors.ts:165-170 | — | pilot-chatspace | |
| ER-060 | Дневная квота AI | F CG-HUB-09; D CG-HUB-03; сброс в полночь UTC | src/shared/errors.ts:171-178 | s/errors/index.ts:168-173 | pilot-chatspace | |
| ER-061 | Провайдер / прокси страницы недоступны | F CG-HUB-10; D CG-HUB-08 (прокси) и CG-HUB-10 (прочие `provider*`) | src/shared/errors.ts:179-186 | s/errors/index.ts:190-203 | pilot-chatspace | |
| ER-062 | Нужен более новый хаб для Coach | F CG-HUB-11 | src/shared/errors.ts:328-336 | — | pilot-chatspace | |
| ER-063 | Кончился баланс провайдера | F CG-HUB-12; D CG-HUB-04 | src/shared/errors.ts:187-192 | s/errors/index.ts:174-177 | pilot-chatspace | |
| ER-064 | Провайдер отклонил доступ хаба | F CG-HUB-13; D CG-HUB-05 | src/shared/errors.ts:193-198 | s/errors/index.ts:178-181 | pilot-chatspace | |
| ER-065 | Лимит провайдера (со сроком) | F CG-HUB-14; D CG-HUB-06 | src/shared/errors.ts:199-204 | s/errors/index.ts:182-185 | pilot-chatspace | |
| ER-066 | Провайдер временно недоступен | F CG-HUB-15; D CG-HUB-07 | src/shared/errors.ts:205-210 | s/errors/index.ts:186-189 | pilot-chatspace | |
| ER-067 | Обрыв стрима без `done` | F CG-HUB-16; D CG-HUB-09; текст не показывается | src/shared/errors.ts:211-216 | s/errors/index.ts:194-197 | pilot-chatspace | |
| ER-068 | Неверный логин или пароль | F CG-HUB-17; D CG-HUB-20 | src/shared/errors.ts:219-225 | s/errors/index.ts:207-210 | pilot-chatspace | |
| ER-069 | Нужно сменить пароль | F CG-HUB-18; D CG-HUB-23 | src/shared/errors.ts:226-232 | s/errors/index.ts:219-222 | pilot-chatspace | |
| ER-070 | Сессия устройства завершена | F CG-HUB-19 | src/shared/errors.ts:240-249 | — | pilot-chatspace | |
| ER-071 | Слишком много попыток входа | F CG-HUB-20 | src/shared/errors.ts:233-239 | — | pilot-chatspace | |
| ER-072 | ChatGoose недоступен при входе | D CG-HUB-21 (сеть, 5xx, 404 маршрута входа) | — | s/errors/index.ts:211-214 | pilot-chatspace | |
| ER-073 | Вход не завершился | D CG-HUB-22 | — | s/errors/index.ts:215-218; m/runtime-activation.ts:534-539 | pilot-chatspace | Для расширения: вход есть, bootstrap не поднялся |
| ER-074 | Текст не вставился | F CG-UI-01 | src/shared/errors.ts:337-342 | — | pilot-chatspace | «поле ChatSpace» вместо «Fansly» |
| ER-075 | Voice: выключен, не в allowlist, нет профиля | F CG-VOICE-01/02/03 | src/shared/errors.ts:250-267 | — | fansly-phase | OF — после пилота (X5) |
| ER-076 | Voice: скрипт или источник невалиден | F CG-VOICE-04/05 | src/shared/errors.ts:268-279 | — | fansly-phase | OF — после пилота (X5) |
| ER-077 | Voice: квота, idempotency, артефакт истёк | F CG-VOICE-06/07/08 | src/shared/errors.ts:280-297 | — | fansly-phase | OF — после пилота (X5) |
| ER-078 | Voice: получение выключено, провайдер, повреждённый артефакт, гейт | F CG-VOICE-09/10/11/12 | src/shared/errors.ts:298-321 | — | fansly-phase | OF — после пилота (X5) |
| ER-079 | OFAPI: доступ, авторизация OF, лимит, кредиты | D CG-OF-01/02/03/04 | — | s/errors/index.ts:119-134 | not-applicable | `/ofapi` закрыт; недоступность приходит причиной из bootstrap |
| ER-080 | OFAPI: запрещённые слова OF, неподтверждённая отправка | D CG-OF-05/06 | — | s/errors/index.ts:135-143 | not-applicable | Отправляет ChatSpace |
| ER-081 | OFAPI: медиа не готово, повтор с исходным ключом | D CG-OF-08/09 | — | s/errors/index.ts:144-154 | not-applicable | Отправки и загрузки — ChatSpace |
| ER-082 | Message Guard заблокировал / политика недоступна | D CG-GUARD-01/02 | — | s/errors/index.ts:223-230; m/message-guard/runtime.ts:55,61 | needs-owner-decision | Вопрос В19 |
| ER-083 | Списанные коды Fansly | CG-API-02/03/04, CG-AUTH-01/02 | src/shared/errors.ts:376-414 | — | not-applicable | Номера не переиспользовать |
| ER-084 | Закрытые коды десктопа | 14 кодов D26 | — | s/errors/index.ts:9-30 | not-applicable | Номера не переиспользовать |

## 13. Логи

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| LG-001 | Отладочный лог | `console.debug [ChatGoose]` при `debugMode` | src/shared/log.ts:61-72 | — | pilot-chatspace | |
| LG-002 | Предупреждения всегда | `logWarn`; предупреждения подсистем | src/shared/log.ts:74-83; src/background/index.ts:56-68,121-124,221-251 | — | pilot-chatspace | |
| LG-003 | Скрытие секретов | authorization, ключи, токены, шаблоны sk-, Bearer, «label=value»; список секретов обновляется при входе и выходе | src/shared/log.ts:3-59 | s/diagnostics/log.ts:36-80; m/index.ts:1304-1341,2210 | pilot-chatspace | |
| LG-004 | Постоянный лог с уровнями | debug / info / warn / error; в сборке от info | — | m/diagnostics/logger.ts:20-76; m/index.ts:1275-1279 | pilot-chatspace | Требование §0 «логирование всего»; у Fansly только консоль; хранить в IndexedDB / storage |
| LG-005 | Ротация | 2 МБ | — | m/diagnostics/logger.ts:72-76,92-115 | pilot-chatspace | |
| LG-006 | Кольцо в памяти | Последние 1000 записей | — | m/diagnostics/logger.ts:73,80; s/diagnostics/log.ts:251-278 | pilot-chatspace | |
| LG-007 | Формат записи | ISO-время, уровень, `[scope]`, CG-код, поля JSON | — | s/diagnostics/log.ts:235-246; m/diagnostics/logger.ts:144-159 | pilot-chatspace | |
| LG-008 | Ограничения размера записи | Глубина 8, массив 100, ключей 100, строка 20 000 | — | s/diagnostics/log.ts:82-167 | pilot-chatspace | |
| LG-009 | Поля ошибки | name, message, stack, code, detail, cause | — | s/diagnostics/log.ts:183-210 | pilot-chatspace | |
| LG-010 | Счётчики ошибок по кодам | Десктоп: по CG-коду; Fansly: дневные счётчики (ошибки CG-HUB, последняя генерация, пуш рекапа) | src/background/ops-daily.ts:1-213 | m/diagnostics/logger.ts:204-213 | pilot-chatspace | |
| LG-011 | Лог из интерфейса в фон | Сообщение до 4000 символов | — | r/lib/clientLog.ts:10-31; m/ipc/handlers.ts:823-826 | pilot-chatspace | |
| LG-012 | Лог не мешает работе | Фоном, по очереди, никогда не бросает | — | m/diagnostics/logger.ts:3-7,117-120 | pilot-chatspace | |
| LG-013 | Логи входа и выхода | — | — | m/index.ts:1373-1384,1685-1765 | pilot-chatspace | |
| LG-014 | Сбои телеметрии в лог | — | — | m/index.ts:974; m/hub/index.ts:450-457 | pilot-chatspace | |
| LG-015 | Логи AI | Например, не сохранилась связка acceptance | — | m/index.ts:1057,1075 | pilot-chatspace | |
| LG-016 | Запись о старте | Версия, платформа, сборка | — | m/index.ts:1280-1285 | pilot-chatspace | Плюс версия ChatSpace и результат проверки контракта |
| LG-017 | Журнал смены чата и вставок | Десктоп: `conversation.open/refresh`; в новом — смена маршрута, вставка, отказ вставки | — | m/ipc/handlers.ts:859-960 | pilot-chatspace | Нужен для разбора P1 «вставка в чужой чат» |
| LG-018 | Логи OFAPI, синка, медиа, обновлений, жизненного цикла | — | — | m/index.ts:391,410,614-670,809,873,935,1416-1419,1596,2546-2609 | not-applicable | Этих подсистем нет |
| LG-019 | Логи и аудит Message Guard | — | — | m/message-guard/runtime.ts:17-21,78; m/index.ts:2339-2344 | needs-owner-decision | Вопрос В19 |
| LG-020 | Выгрузка диагностики | Кнопки в «Данные», «Аккаунт → Дополнительно», карточке сбоя; Fansly — «Скопировать отчёт» | src/options/index.ts:302-460,3726-3744 | f/settings/sections/DangerZone.tsx:72-96; f/settings/sections/HubSettings.tsx:362-368; r/app/ErrorBoundary.tsx:43-49 | pilot-chatspace | |
| LG-021 | Состав пакета диагностики | Версии, локаль, настройки, статус хаба, ошибки по кодам, 100 записей кольца и 100 строк лога | — | m/diagnostics/report.ts:10-100; m/index.ts:2306-2431 | pilot-chatspace | Состав под расширение |
| LG-022 | Безопасность пакета | Хвост токена убран, весь пакет ещё раз вымарывается | — | m/diagnostics/report.ts:60-87 | pilot-chatspace | |
| LG-023 | Лог прошлой сессии в пакете | Вчерашний сбой попадает в выгрузку | — | m/diagnostics/logger.ts:50-56,191-203 | pilot-chatspace | |
| LG-024 | Аудит outbox и usage в пакете | — | — | m/index.ts:2330-2361; m/diagnostics/report.ts:40-47,88-98 | not-applicable | Нет outbox и usage-очереди |
| LG-025 | Сохранить файл диагностики | «Показать в папке», «Скопировать путь» | — | m/index.ts:2440; f/settings/sections/DangerZone.tsx:80-96 | pilot-chatspace | В форме скачивания файла |
| LG-026 | Снимок сессии Fansly для отладки | Проекция заголовков | src/shared/log.ts:89-104 | — | fansly-phase | Сессию ChatSpace не снимаем |
| LG-027 | Dev-трассировка рендера | `chatgoose:overlay-debug` | src/content/overlay/overlay-controller.ts:1305-1330 | — | pilot-chatspace | Флаг хранить у себя, не в localStorage страницы |

## 14. Отладка и диагностика

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| DB-001 | Режим отладки | Включает логи, эхо, профайлер, инспектор, отладку Coach, журнал «Новых» | src/background/operations.ts:1684-1686,2933 | f/settings/sections/BehaviorSettings.tsx:335-343 | pilot-chatspace | |
| DB-002 | Эхо промпта | Заголовок `x-kernel-ai-capabilities: debug-input-v1` | src/background/kernel-feature-gateway.ts:100-104,517 | m/ai/coordinator.ts:854-862; s/hub/client.ts:915-941 | pilot-chatspace | |
| DB-003 | Окно владельца | Хаб отдаёт эхо только в окне, открытом владельцем (E28 / D9); молчание — не ошибка | src/background/kernel-feature-gateway.ts:145-147 | m/hub/ai-feature-gateway.ts:176 | pilot-chatspace | |
| DB-004 | Хранение снимка | Только в памяти, 12 мин, не больше 10 | src/background/debug-prompt-store.ts:1-94 | — | pilot-chatspace | |
| DB-005 | Пределы снимка | 500 000 символов блоков, 100 000 манифеста, «обрезано» | — | m/ai/coordinator.ts:270-343; f/ai/dockLogic.ts:438-470 | pilot-chatspace | |
| DB-006 | Непрозрачный токен снимка | В страницу идут только `viewerToken` и счётчики | src/background/operations.ts:1834-1847,3046-3076 | — | pilot-chatspace | |
| DB-007 | Просмотр промпта | Страница «LLM Input» / оверлей: system и user, бейдж кэша, Copy, JSON манифеста, «Snapshot expired»; отдаётся только этой странице | src/debug-prompt/index.ts:15-146; src/background/runtime-api.ts:219-245,1037-1073 | f/ai/AiDock.tsx:591-847 | pilot-chatspace | |
| DB-008 | «Эхо выключено / из кэша» | Объяснение, почему промпта нет | src/background/debug-prompt-store.ts:1-94 | m/ai/coordinator.ts:652-667,696-707; f/ai/AiDock.tsx:895-905 | pilot-chatspace | |
| DB-009 | Карточка контекста ядра | Досье: версия, возраст, размер; транскрипт: источник, режим, счётчики, stale | src/shared/kernel-context.ts:1-40 | f/ai/dockLogic.ts:485-530; f/ai/AiDock.tsx:907-947 | pilot-chatspace | Плюс кадр `context_v1`: принят ли свежий текст (план §3.4) |
| DB-010 | Инспектор клиентской части | Транскрипт, траты, подписка от клиента | src/background/operations.ts:2961-2981 | — | fansly-phase | На OF `clientContext` нет |
| DB-011 | Профайлер этапов | Этапы со статусами и длительностями | src/background/operation-profiling.ts:9-225 | m/ai/profiler.ts:1-20; f/ai/AiDock.tsx:949-980 | pilot-chatspace | |
| DB-012 | Живой таймер этапов | Раз в 100 мс | src/content/overlay/overlay-controller.ts:1050-1100 | — | pilot-chatspace | |
| DB-013 | Профиль в результате | Свёрнутый блок «Отладка · время»; этапы при сбое — failed | src/content/overlay/overlay-controller.ts:2819-2821; src/background/operation-profiling.ts:202-223 | — | pilot-chatspace | |
| DB-014 | Рассуждения модели | `reasoning_delta` в профиль | src/background/operations.ts:3142-3151 | — | pilot-chatspace | |
| DB-015 | Этапы клиентского контекста | resolve-identity, load-messages, earnings, subscription-lookup и др. | src/background/operations.ts:1901-2837 | m/ai/profiler.ts:8-20 | fansly-phase | На OF вместо них — bootstrap и свежий хвост |
| DB-016 | Этапы хабовой части | summary-cache-check, prompt-build, llm-ttfb, llm-stream | src/background/operations.ts:2005,2843,2998,3038 | m/ai/coordinator.ts:864,881,924,993 | pilot-chatspace | |
| DB-017 | Строка usage | «model: N in / M out (cache w/r)» | src/shared/spend.ts:56-59 | — | pilot-chatspace | |
| DB-018 | Токены и стоимость | `costMicroUsd`, токены in / write / read / out; в лог | src/shared/spend.ts:34-54; src/background/operations.ts:3017-3022 | m/ai/coordinator.ts:729-780; s/hub/client.ts:402-412 | pilot-chatspace | Кому показывать — вопрос В7 |
| DB-019 | Отладка ходов Coach | Время, TTFB, токены, $, «Промпт ↗», журнал этапов; стадии для пузыря ожидания | src/content/overlay/overlay-controller.ts:2190-2260; src/background/operations.ts:1828-1863 | — | pilot-chatspace | |
| DB-020 | Отладка не видна в inline | Видна после разворота ↗ | src/content/inline-panel/inline-panel-controller.ts:362-400 | — | pilot-chatspace | |
| DB-021 | Карточка транскрипта | Число сообщений и превью — данных нет | — | f/ai/AiDock.tsx:843-893 | not-applicable | Мёртвый код |
| DB-022 | Журнал AI-трат по фичам | Запуски, вставки, токены, $, день и 7 дней, доля кэша | — | f/settings/sections/ActivitySettings.tsx:480-548; s/activity/ai-spend.ts:62-194 | needs-owner-decision | Вопрос В7 |
| DB-023 | Журнал кредитов OFAPI | По назначениям, баланс, темп | — | f/settings/sections/ActivitySettings.tsx:411-478; s/activity/credit-ledger.ts:40-85 | not-applicable | Своих чтений OFAPI нет |
| DB-024 | Кредиты хаба по страницам | REST и webhook, сегодня и 7 дней | — | f/settings/sections/ActivitySettings.tsx:378-410; p/contract.ts:270-288 | needs-owner-decision | Показывать ли чаттеру расход хаба (вопрос В24) |
| DB-025 | Аудит outbox | Двойные claim, дубли, неподтверждённые | — | m/send/audit.ts:1-25; f/settings/sections/ActivitySettings.tsx:273-376 | not-applicable | Расширение не отправляет |
| DB-026 | «Сообщения», режим синка, свежесть | Опрос, deep sweep, последнее событие | — | f/settings/sections/ActivitySettings.tsx:115-174; r/app/StatusBar.tsx:68-89,137-156 | provided-by-chatspace | Список и ленту обновляет ChatSpace |
| DB-027 | «Аккаунт → Дополнительно» | Вход (последние символы, выдан, истекает), «Поток», «Приложение» (версия · машина · ОС) | — | f/settings/sections/HubSettings.tsx:264-298; m/index.ts:1356-1358 | pilot-chatspace | «Поток» → версия ChatSpace и состояние контракта хоста |
| DB-028 | «Неизвестно» вместо догадок | Сбой чтения не выдаётся за факт | src/options/copy.ts:102-103,212-218 | — | pilot-chatspace | |
| DB-029 | Проверка сообщений между частями | Ручные guard-функции, zod у «Новых» | src/shared/protocol.ts:398-410,572-720 | — | pilot-chatspace | В новом клиенте zod везде |
| DB-030 | Инструменты разработки десктопа | Фикстуры OFAPI, хуки без UI, мок-мост, dev-переменные, smoke | — | m/ofapi/fixture-capture.ts:1-3; r/bridge/queries.ts:283-302; r/bridge/bridge.ts:40; m/index.ts:464-466,2447-2557 | not-applicable | Только для разработки Electron |
| DB-031 | Проверка контракта хоста | Новое: при старте и после релизов ChatSpace — есть ли мост, сторы, маршрут; видимый сигнал вместо бесконечных ретраев | src/content/conversation-mount-controller.ts:70-187 | — | pilot-chatspace | План §7; у Fansly — ретраи без сигнала (RB-008) |

## 15. Телеметрия в хаб

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| TL-001 | `ai_acceptance · shown` | На первом текстовом чанке | src/background/operations.ts:3089-3102 | m/ai/coordinator.ts:995-1007; m/hub/acceptance-reporter.ts:40 | pilot-chatspace | |
| TL-002 | `ai_acceptance · copied` | Часть ответа скопирована | src/content/inline-panel/inline-panel-controller.ts:1024-1026 | m/hub/acceptance-reporter.ts:407-423 | pilot-chatspace | |
| TL-003 | `ai_acceptance · inserted` | Вставка части | src/content/inline-panel/inline-panel-controller.ts:1070-1072; src/content/overlay/overlay-controller.ts:672-676 | m/hub/acceptance-reporter.ts:424-433 | pilot-chatspace | |
| TL-004 | `ai_acceptance · sent` (+ `edited`) | Вставленный текст отправлен; правил ли чаттер | — | m/hub/acceptance-reporter.ts:435-457; m/ipc/handlers.ts:1250 | pilot-chatspace | По эхо в памяти ChatSpace (`pendingMessages.enqueue` / WS) |
| TL-005 | События черновиков Coach | `inserted` / `copied` с `generationRef` своего обмена | src/content/overlay/overlay-controller.ts:2694-2696; src/background/operations.ts:718-743 | — | pilot-chatspace | |
| TL-006 | Пробелы телеметрии | Автозамена Fix не шлёт `inserted`, Copy в Review и Recap не шлёт `copied` | src/content/index.ts:4054-4072; src/content/overlay/overlay-controller.ts:3181-3200 | — | needs-owner-decision | Закрыть пробел — изменятся метрики принятия (вопрос В23) |
| TL-007 | Содержимое события | operationId, requestId (`generationRef`), feature, action, accountId, conversationId, observedAt, `clientEventId` | src/background/acceptance-reporter.ts:64-80,154 | m/hub/acceptance-reporter.ts:24-38,106-124 | pilot-chatspace | |
| TL-008 | Корреляция событий | До 50 в памяти | src/background/operations.ts:538-551,3106-3136 | — | pilot-chatspace | |
| TL-009 | Очередь телеметрии | Fansly: 300, счётчик потерь; десктоп: 500; пачки по 100, задержка 1 с, 5 попыток, 400 выбрасывает пачку | src/background/acceptance-reporter.ts:18-206 | m/hub/acceptance-reporter.ts:7-22,229-270 | pilot-chatspace | |
| TL-010 | Отправка на старте | `flushNow` | src/background/index.ts:243-251 | — | pilot-chatspace | |
| TL-011 | Статистика очереди | `stats()` есть, но не показывается | src/background/acceptance-reporter.ts:56-60,208-212 | — | pilot-chatspace | Показать в диагностике |
| TL-012 | Событие привязано к получателю | Адрес хаба + хеш токена | — | m/hub/acceptance-reporter.ts:55-66,125-131 | pilot-chatspace | |
| TL-013 | Квота: снимок и исчерпание | `aiQuotaByPage`, сброс 00:00 UTC; 429 помечает страницу | src/background/quota-tracker.ts:1-137; src/background/kernel-feature-gateway.ts:271-278 | m/hub/ai-feature-gateway.ts:228-230 | pilot-chatspace | |
| TL-014 | Старые usage-события | Дренаж без новых; `aiUsageBatch` без вызовов | src/background/agency-hub-client.ts:400-416,849-925 | s/hub/usage-reporter.ts:1-60; m/hub/index.ts:96-100,443-458 | not-applicable | Расход считает хаб |
| TL-015 | Жатва локальных данных в хаб | harvest.messages, fan_transactions, outbox, guard, usage, ai_spend, credit_log; разовая выгрузка истории | — | m/harvest/index.ts:1-59; f/settings/sections/DangerZone.tsx:105-190 | needs-owner-decision | Прогнать ли перед выводом десктопа (вопрос В25) |
| TL-016 | Отчёты о загрузке медиа | `ofapiMediaReports` | — | m/media/resolver.ts:485 | not-applicable | Медиа у ChatSpace |
| TL-017 | Чтения пополняют архив хаба | Побочный эффект чтений десктопа через шлюз | — | m/ofapi/transport.ts:7-14 | not-applicable | Покрытие архива без десктопа проверяет гейт вывода (план §5) |
| TL-018 | Команды хаба | send, like, mark-read, typing | — | m/send/engine.ts:632,776,860,1324; m/send/composer-actions.ts:178-187 | not-applicable | Записей в OnlyFans от расширения нет (X3) |

## 16. Надёжность и восстановление

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| RB-001 | Других автоповторов нет | Повторяет человек | src/background/kernel-feature-gateway.ts:153-199 | m/send/engine.ts:1-10 | pilot-chatspace | |
| RB-002 | Таймауты по фичам | Quick 60 с; deep: подготовка 180–360 с, первый байт 45 с, тишина 45 с, максимум 300 с; Coach: подготовка 60 с | src/shared/constants.ts:206-219; src/background/operation-timeouts.ts:1-33 | m/ai/timeouts.ts:1-60; s/constants.ts:9-13 | pilot-chatspace | Пересчитать без чтений хоста |
| RB-003 | Причина прерывания | Таймаут → NET-02, отмена → FLOW-06, иное → NET-01 | src/background/operation-utils.ts:29-46 | — | pilot-chatspace | |
| RB-004 | Нет `done` | Обрыв, текст не показывается | src/background/kernel-feature-gateway.ts:556-561 | s/hub/client.ts:984-986 | pilot-chatspace | |
| RB-005 | Ошибка ядра важнее | Перекрывает отмену и обрыв | src/background/kernel-feature-gateway.ts:538-545 | — | pilot-chatspace | |
| RB-006 | Офлайн | Отдельного режима нет, сеть → NET-01 | src/background/kernel-feature-gateway.ts:302-311 | — | pilot-chatspace | |
| RB-007 | Неопределённая отправка не повторяется | — | src/background/fansly-client.ts:634-635 | m/send/engine.ts:1-10,33-41 | pilot-chatspace | Для приветствий «Новых»; обычные отправки делает ChatSpace |
| RB-008 | Поломка DOM хоста | Повторы 50 мс 10 с, потом раз в 2 с бесконечно, без видимого сигнала | src/content/conversation-mount-controller.ts:70-187 | — | pilot-chatspace | С видимым сигналом и `client_health` (DB-031) |
| RB-009 | Проверка вставки | Нет поля или текст не совпал → CG-UI-01 | src/content/textarea.ts:28-49 | — | pilot-chatspace | Сверка через `.ProseMirror` того же composer |
| RB-010 | Переподключение порта content ↔ фон | 100/200/400 мс, `tab:init`; разрыв → тост FLOW-07, вопрос Coach возвращается; фон отменяет операцию вкладки | src/content/port-client.ts:1-91; src/content/index.ts:477-504; src/background/operations.ts:585-590 | — | pilot-chatspace | |
| RB-011 | Очереди записи в хранилище | StorageCoordinator и очереди сервисов | src/background/storage-coordinator.ts:905-926 | — | pilot-chatspace | |
| RB-012 | Миграции вперёд | Схема v19, версионная нормализация | src/shared/migrations.ts:85-105,322-383 | — | pilot-chatspace | |
| RB-013 | Coach при сбое настроек | APP-04, вопрос сохраняется | src/content/index.ts:2390 | — | pilot-chatspace | |
| RB-014 | URL вкладки = чат запроса | Иначе FLOW-06 | src/background/operations.ts:1266-1282 | — | pilot-chatspace | Маршрут ChatSpace |
| RB-015 | Номер маршрута | Смена во время проверок → FLOW-06 | src/background/operations.ts:1668-1683 | — | pilot-chatspace | Поколение маршрута (план §4) |
| RB-016 | `operationId` на каждом кадре | Чужие кадры игнорируются | src/background/operations.ts:3002-3088 | m/ai/coordinator.ts:1-5 | pilot-chatspace | |
| RB-017 | Отложенный рендер отменяется при смене | rAF | src/content/index.ts:1368-1382 | — | pilot-chatspace | |
| RB-018 | Владелец записи рекапа | Последний запуск владеет записью | src/background/operations.ts:1356-1410 | — | pilot-chatspace | |
| RB-019 | Фан в контексте вкладки | Смена чата сбрасывает фана | src/background/tab-context.ts:32-70 | — | pilot-chatspace | |
| RB-020 | Новое состояние побеждает | — | src/background/operations.ts:593-631 | — | pilot-chatspace | |
| RB-021 | Одна операция на чат | Повторный старт с тем же id игнорируется | — | m/ai/coordinator.ts:1048-1060 | pilot-chatspace | |
| RB-022 | Ничто не помечает чаты прочитанным | Фоновых чтений нет | — | m/settings/store.ts:297-305 | pilot-chatspace | Инвариант приёмки (план §6) |
| RB-023 | Повторы и параллелизм REST Fansly | GET 1/2/4 с, Retry-After ≤5 с, 30 с; `success:false` при 200 — ошибка; записи одной попыткой; пейсер; `mapWithConcurrency` | src/background/fansly-client.ts:415-697; src/background/fansly-pacer/*.ts; src/shared/concurrency.ts:1-24 | — | fansly-phase | Своих запросов к OM нет |
| RB-024 | Отправки десктопа (outbox) | Одна отправка на строку, проверка 30 с в течение 10 мин | — | m/send/engine.ts:1-41 | provided-by-chatspace | Очередь `pendingMessages` ChatSpace, без автоповтора |
| RB-025 | Опрос и сверка списка чатов | 20/60 с, deep sweep 5 страниц / 5 мин, сверка непрочитанных | — | m/sync/polling-sync.ts:42-90; f/settings/sections/BehaviorSettings.tsx:344-436 | provided-by-chatspace | Список ChatSpace живёт по WebSocket |
| RB-026 | Ограничитель частоты и кредиты OFAPI | 300/мин, всплеск 20; счётчик кредитов; бюджет на смену | — | m/ofapi/rate-limiter.ts:1-24; m/ofapi/credit-meter.ts:1-7; m/sync/budget-guard.ts:1-2 | not-applicable | Запросов к OFAPI нет |
| RB-027 | Локальное хранение | SQLCipher БД, медиа-кэш AES-256-GCM, шина изменений | — | m/db/database.ts:1-3; m/media/cache.ts:1-11; m/db/change-bus.ts:1-9 | not-applicable | Локальной БД нет |
| RB-028 | Жизненный цикл приложения | Один экземпляр, дренаж при выходе, проверка после пробуждения ОС | — | m/index.ts:2525-2531,2575-2613 | not-applicable | Electron |
| RB-029 | Message Guard | Политика, скан черновика, блок, аудит; принудительно выключен с 2026-06-24 | — | s/message-guard/defaults.ts:56-59; m/message-guard/runtime.ts:17-61 | needs-owner-decision | Вопрос В19 |

## 17. Фоновые действия

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| BG-001 | Нет автогенераций и автоотправок | Всё — по клику или хоткею | CLAUDE.md | f/ai/AiDock.tsx:1-5 | pilot-chatspace | |
| BG-002 | Пересборка состояния вкладки | На init, смене маршрута, захвате, настройках | src/background/operations.ts:593-930 | — | pilot-chatspace | По `router.afterEach` ChatSpace |
| BG-003 | Keepalive-порт | Держит event page живым | src/content/bootstrap-keepalive.ts:1-83 | — | pilot-chatspace | |
| BG-004 | Ремонт хранилища на старте | Барьер слушателя, нормализация | src/background/storage-coordinator.ts:172-300 | — | pilot-chatspace | |
| BG-005 | Рассылка изменений хранилища | `settings:changed`, `mapping:changed`; при смене хаба сброс доски и персон | src/background/storage-change-policy.ts:1-79 | — | pilot-chatspace | |
| BG-006 | Очистка при закрытии вкладки | Отмена операций, контекст | src/background/index.ts:195-198 | — | pilot-chatspace | |
| BG-007 | Захват сессии Fansly | `webRequest` на apiv3, «материальный» захват, `/account/me` раз в 30 с | src/background/session-capture.ts:15-125; src/background/operations.ts:202-211,765-835 | — | fansly-phase | На ChatSpace нельзя (X3) |
| BG-008 | Проба voice | `pages`, кэш 5 мин, только на маршруте чата | src/background/voice-service.ts:538-640 | — | fansly-phase | OF — после пилота |
| BG-009 | Опрос маршрута 500 мс | Два таймера на странице чата | src/content/route-watcher.ts:1-76; src/content/bootstrap.ts:330 | — | fansly-phase | На ChatSpace `router.afterEach`, без таймеров |

## 18. Обновления, релиз, страницы

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| UP-001 | Свой фид обновлений | `update_url` → ext.gosling-agency.ru/updates.json | manifest.json:91; scripts/deploy.sh:587-604 | — | pilot-chatspace | Свой gecko id и фид |
| UP-002 | Подпись AMO unlisted | `web-ext sign` | scripts/deploy.sh:561-571 | — | pilot-chatspace | |
| UP-003 | Предполётные проверки релиза | main, чистое дерево, HEAD = origin, тег свободен, нет даунгрейда | scripts/deploy.sh:200-295,526-534 | — | pilot-chatspace | |
| UP-004 | Гейт контракта ядра в релизе | sourceCommit SDK, contractHash прода, проверка persona-catalog; десктоп — гейты хеша и возможностей | scripts/deploy.sh:257-273,297-355 | apps/desktop/scripts/assert-release-sdk-vendor.mjs:1-30; apps/desktop/scripts/assert-kernel-capabilities.mjs:1-25 | pilot-chatspace | Совместимость по `compatibleClientSdks` (план §3.1) |
| UP-005 | Предпроверка и анонс в Telegram | `announce --check` до подписи; сбой анонса не валит релиз | scripts/deploy.sh:539-545,687-697 | — | pilot-chatspace | |
| UP-006 | Версия на страницах, выкладка и тег | install/changelog, атомарный `mv`, проверка фида, тег с sha256 XPI, `--pages-only` | scripts/deploy.sh:124-198,357-366,412-482,607-685; scripts/deploy-pages.sh:1-103 | — | pilot-chatspace | |
| UP-007 | Гейт «AI только через ядро» | grep-инварианты | scripts/check-ai-cutover.mjs:12-57 | — | pilot-chatspace | |
| UP-008 | Доступ к хабу после обновления | onInstalled только логирует, запрос при «Войти» | src/background/index.ts:221-241 | — | pilot-chatspace | |
| UP-009 | Перезагрузка старых вкладок | «Статус» просит перезагрузить вкладки, открытые до обновления | src/options/copy.ts:606 | — | pilot-chatspace | Особенно важно для MAIN-world моста на `document_start` |
| UP-010 | Минимальная версия Firefox | 142 | manifest.json:90 | — | pilot-chatspace | |
| UP-011 | «Как начать» | start.html: один логин для всех клиентов | start.html:106-213 | f/auth/links.ts:1-4 | pilot-chatspace | Переписать под новый клиент |
| UP-012 | Лендинг установки | install.html, `chatgoose-latest.xpi` | install.html:492-628 | — | pilot-chatspace | |
| UP-013 | Руководство | guide.html; из UI ссылки нет | guide.html:973-1615 | — | pilot-chatspace | Дать ссылку из UI |
| UP-014 | «Что нового» | whats-new-2.html | whats-new-2.html:326-414 | — | pilot-chatspace | Свой обзор |
| UP-015 | История версий | CHANGELOG.md и changelog.html | CHANGELOG.md:1-12 | — | pilot-chatspace | |
| UP-016 | Статус ленивой загрузки | «ChatGoose загружается…», «не загрузился. Повторить» | src/content/bootstrap.ts:47-88,248-258 | — | pilot-chatspace | |
| UP-017 | Автообновление десктопа | electron-updater, проверка 4 ч, «готово», mac-уведомление, раздел «Обновления», страница скачивания, только вперёд, публикация фида | — | m/platform/updater.ts:1-225; m/index.ts:337-411; apps/desktop/scripts/publish-feed.sh | not-applicable | Обновлениями расширения занимается браузер |
| UP-018 | «О программе» | Системный пункт меню macOS | — | m/index.ts:413-460 | not-applicable | Версия есть в popup и настройках |

## 19. Язык и тема

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| I18-001 | Языки RU / EN с переключением | Десктоп: system / ru / en, каталог с тестом паритета, переключение на лету; Fansly: только русский | src/options/index.html:2 | s/i18n/catalog.ts; s/i18n/index.ts:15-72; r/lib/i18n.ts | pilot-chatspace | Паритет с десктопом; язык ChatSpace на наш не влияет |
| I18-002 | Термины латиницей | Agency Hub, Spenders, Reply… | src/options/copy.ts:1-11 | — | pilot-chatspace | |
| I18-003 | Словари текстов | `COPY`, vault-copy, coach-copy | src/options/copy.ts:1-20 | s/i18n/catalog.ts | pilot-chatspace | |
| I18-004 | Непереведённые строки | Fansly: inline-панель, доска, оверлей; десктоп: Fast Reply, AI ready, INSERT, COPY, QUEUED…UNCONF и др. | src/content/inline-panel/inline-panel-controller.ts:488,569 | f/ai/dockLogic.ts:411-419; f/ai/aiStore.ts:353-392 | pilot-chatspace | Перевести всё |
| I18-005 | Тема system / light / dark | CSS-переменные, класс на корне, живое переключение, ранняя загрузка без вспышки, расшифровка «Системная» | src/shared/theme.ts:1-86 | r/lib/theme.ts:1-58; r/app/AppShell.tsx:76-86; s/theme.ts:11-19 | pilot-chatspace | В Shadow DOM — класс на хосте; можно следовать `.dark` ChatSpace |
| I18-006 | Тема на всех поверхностях | У Fansly «Новые» только светлые, debug-страницы по ОС | src/content/followers/followers.css:1-3; src/debug-prompt/styles.css:1-20 | — | pilot-chatspace | |
| I18-007 | Локальные шрифты | Hanken Grotesk, Source Serif 4, IBM Plex Mono | assets/fonts/README.md:1-20 | — | pilot-chatspace | |
| I18-008 | Плотность | Обычная / компактная | — | f/conversation/Thread.tsx:26-45 | not-applicable | Переписка принадлежит ChatSpace |

## 20. Поверхности десктопа, которые даёт ChatSpace

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| CS-001 | Рейл аккаунтов и бейджи | Аватары страниц, непрочитанные до 99 | — | f/inbox/AccountRail.tsx:96-117,181-258 | provided-by-chatspace | Вкладки аккаунтов ChatSpace |
| CS-002 | Кнопка «+» в рейле | «аккаунты подключает админ» | — | f/inbox/AccountRail.tsx:118-124 | not-applicable | Аккаунты подключаются в OnlyMonster |
| CS-003 | Вход в «Онлайн» со счётчиком | — | — | f/inbox/AccountRail.tsx:34-39,135-152 | provided-by-chatspace | Кнопка Fans Online |
| CS-004 | Заголовок окна | Логотип, поиск, чип аккаунта, «режим-компаньон» | — | r/app/Titlebar.tsx:14-39 | not-applicable | Окно Electron |
| CS-005 | Отдельные полноэкранные страницы | Settings, Spenders, Online, Followers заменяют рабочую область | — | r/app/AppShell.tsx:115-135; r/state/uiStore.ts:94-99 | pilot-chatspace | Наши поверхности — оверлеи поверх ChatSpace |
| CS-006 | Палитра: поиск чатов, смена аккаунта | — | — | r/app/CommandPalette.tsx:56-97 | provided-by-chatspace | Поиск и вкладки ChatSpace |
| CS-007 | Принудительное обновление | `cmd:sync.forceRefresh` | — | r/app/CommandPalette.tsx:115 | not-applicable | Нет синхронизации |
| CS-008 | Список чатов | Фильтры со счётчиками, виртуальный список, имя, превью, время, бейдж, онлайн, пустые состояния | — | f/inbox/ChatListPane.tsx:27-184; f/inbox/ChatRow.tsx:51-119 | provided-by-chatspace | Список ChatSpace |
| CS-009 | «Фан ждёт ответа» | Точка в строке | — | f/inbox/ChatRow.tsx:57-59 | provided-by-chatspace | «Fan replied. Waiting for you.» |
| CS-010 | Траты за всё время у имени | — | — | f/inbox/ChatRow.tsx:33-36,60-72 | provided-by-chatspace | Режим аватара Total Spend |
| CS-011 | Траты за 30 дней в строке | `+$N` зелёным | — | f/inbox/ChatRow.tsx:37-40,110-114 | needs-owner-decision | Встраивание в строку ChatSpace хрупко (вопрос В18) |
| CS-012 | Бейдж AI-задачи в строке | AI / OK / ! | — | f/inbox/ChatRow.tsx:32,91-109 | needs-owner-decision | Вопросы В5 и В18 |
| CS-013 | Сверка непрочитанных и баннер свежести | `GET /chats?filter=unread`, «Список от …» | — | f/inbox/ChatListPane.tsx:98-116; f/inbox/ListFreshnessBanner.tsx:15-49 | not-applicable | Список ChatSpace живой |
| CS-014 | Подсказки навигации внизу списка | J/K · ⌘U · ⌘1–9 | — | f/inbox/ChatListPane.tsx:177-184 | needs-owner-decision | Вопрос В17 |
| CS-015 | Открытие чата и автовыбор аккаунта | Загрузка хвоста переписки | — | f/conversation/ConversationPane.tsx:65-89; r/app/AppShell.tsx:49-65 | provided-by-chatspace | Чат открывает человек в ChatSpace |
| CS-016 | Шапка: фан, присутствие, траты, подписка | Аватар, онлайн / был, всего, чипы подписки, ↻, custom-имя | — | f/conversation/ConversationHeader.tsx:64-156; f/conversation/ConversationActions.tsx:117-176 | provided-by-chatspace | Шапка ChatSpace |
| CS-017 | «Фан уже N мес» | Длительность подписки | — | f/conversation/ConversationHeader.tsx:135-141 | needs-owner-decision | Вопрос В16 |
| CS-018 | Неподтверждённые действия в ••• | «Проверить статус» | — | f/conversation/ConversationActions.tsx:182-202 | not-applicable | Команд хаба нет |
| CS-019 | Переписка | Пузыри, медиа, PPV-чипы, чаевые, цитаты, удалённые, SEEN/SENT, даты, Reply, Like, Unsend до 24 ч, «печатает», прилипание к низу, подгрузка, состояния | — | f/conversation/ThreadRows.tsx:18-180; f/conversation/Thread.tsx:140-337; f/conversation/ConversationView.tsx:112-155 | provided-by-chatspace | Окно чата ChatSpace (Unsend — по праву `of_unsend_messages`) |
| CS-020 | Пометка прочитанным | При открытии и фокусе; по умолчанию выключена | — | f/conversation/ConversationPane.tsx:91-100; m/send/engine.ts:1339-1360 | not-applicable | Расширение никогда не помечает прочитанным |
| CS-021 | Строки исходящих в очереди | QUEUED / SENDING / FAILED / UNCONF, «Изменить / Повторить / Скрыть», подсветка запрещённых слов | — | f/conversation/OutboxRows.tsx:71-169; f/conversation/sendLogic.ts:112-182 | provided-by-chatspace | Очередь ChatSpace: Failed / Send timed out, Resend, Cancel; Message Guard OM |
| CS-022 | UNCONF «Проверить сейчас» | Неизвестный исход никогда не повторяется сам | — | f/conversation/OutboxRows.tsx:106-108; f/conversation/sendLogic.ts:166-172 | needs-owner-decision | В ChatSpace после «Send timed out» есть ручной Resend (вопрос В21) |
| CS-023 | «Восстановить с исходным ключом», возврат в черновик | — | — | f/conversation/OutboxRows.tsx:101-105; f/conversation/ComposerBar.tsx:56-65 | not-applicable | Своих отправок нет |
| CS-024 | Поле ввода | Черновик на чат (500 мс), отправка, защита от двойной, «печатает», блокировка с причиной, плашка цитаты | — | f/conversation/DraftTextarea.tsx:20-47; f/ai/aiStore.ts:498-575; f/conversation/ComposerBar.tsx:71-226; f/conversation/ComposerContext.tsx:36-54 | provided-by-chatspace | Composer ChatSpace; «печатает» ChatSpace шлёт и после вставки (X3) |
| CS-025 | Цепочки [NEXT] при отправке | Части отдельными сообщениями с паузой 2–5 с, до 10 частей, «Отменить» | — | f/conversation/sendLogic.ts:13-26; f/conversation/sendController.ts:32-44; f/conversation/ComposerBar.tsx:194-208 | needs-owner-decision | В ChatSpace цепочек нет, расширение не отправляет (вопрос В9) |
| CS-026 | Сводка старых rich-опций | Скрытый текст, GIF, теги, «Сбросить» | — | f/conversation/ComposerContext.tsx:9-35,55-67 | not-applicable | Наследие outbox десктопа |
| CS-027 | Message Guard в черновике | Подсветка, чипы, блок отправки (выключен) | — | f/conversation/ComposerBar.tsx:79-113,174-189; f/conversation/GuardHighlightOverlay.tsx:4-31 | needs-owner-decision | Вопрос В19 |
| CS-028 | Эмодзи, отложенная отправка, загрузка с диска | В десктопе нет | — | m/ofapi/transport.ts:23-28,58-60 | provided-by-chatspace | В ChatSpace есть |
| CS-029 | «Онлайн» | Плоский список, «только спендеры», сортировка, «Обновить» (кредит), счётчики, строки, пустые состояния | — | f/online/OnlineSurface.tsx:36-283; f/online/onlineModel.ts:16-26 | provided-by-chatspace | Fans Online ChatSpace |
| CS-030 | Превью и Ping из «Онлайн» | J/K / SPACE / O / ⌘P | — | f/online/OnlineSurface.tsx:226-235; f/spenders/boardStores.ts:13-23 | needs-owner-decision | Вопрос В12 |
| CS-031 | Панель фана `]` | Правая панель: Info и Scan | — | f/fan-panel/FanPanel.tsx:43-99 | needs-owner-decision | Своей правой панели у ChatSpace в браузере нет (Side Panel за флагом) (вопрос В16) |
| CS-032 | Info: кто это, «РИСК ОТТОКА» | Имя, @username, custom-имя, «был N назад»; автопродление выключено | — | f/fan-panel/FanPanel.tsx:166-180,199-203 | provided-by-chatspace | Шапка ChatSpace, бейдж «не продлевается» |
| CS-033 | Info: траты по видам | Всего / чаевые / сообщения·PPV / подписки | — | f/fan-panel/FanPanel.tsx:182-193 | needs-owner-decision | Insights ChatSpace у организации за флагом (вопрос В16) |
| CS-034 | Info: подписка подробно | Статус, цена, продление, автопродление, длительность | — | f/fan-panel/FanPanel.tsx:195-230 | needs-owner-decision | Вопрос В16 |
| CS-035 | Info: «О себе» (био) | — | — | f/fan-panel/FanPanel.tsx:232-237 | provided-by-chatspace | Новое в ChatSpace 0.172.0: диалог «Bio» (`FanBioDialog`, см. `chatspace-delta.md`) |
| CS-036 | Возраст данных панели | «Обновлено N назад», повтор | — | f/fan-panel/FanPanel.tsx:101-120,239-245 | not-applicable | Возраст кэша OFAPI |
| CS-037 | Пустые состояния панели фана | — | — | f/fan-panel/FanPanel.tsx:72-81,189-192 | needs-owner-decision | Вопрос В16 |
| CS-038 | «Выберите чат» | С подсказками J/K, ⌘U, ⌘K | — | f/conversation/ConversationPane.tsx:113-127 | not-applicable | Выбор чата — в ChatSpace |
| CS-039 | Окно Electron | Минимальная ширина 1100, один экземпляр | — | m/index.ts:498 | not-applicable | Electron |

## 21. Оболочка расширения

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| EX-001 | Firefox MV3, event page | `background.scripts` | manifest.json:2,21-25 | — | pilot-chatspace | Firefox первым (X1) |
| EX-002 | Gecko id и минимальная версия | `chatgoose@gosling.agency`, ≥142 | manifest.json:87-91 | — | pilot-chatspace | Свой id |
| EX-003 | Права | storage, unlimitedStorage, tabs | manifest.json:6-11 | — | pilot-chatspace | |
| EX-004 | `webRequest` и host permissions Fansly | Заголовки Fansly; fansly.com, apiv3 | manifest.json:9,12-16 | — | fansly-phase | Для ChatSpace не нужны: только match страницы, без API OM |
| EX-005 | Доступ к хабу | `https://gosling-agency.ru/*`, нестандартный — optional по жесту | manifest.json:15,17-20 | — | pilot-chatspace | |
| EX-006 | `data_collection_permissions` | — | manifest.json:92-100 | — | pilot-chatspace | |
| EX-007 | MAIN-world скрипт на `document_start` | Fansly: перехват сокета | manifest.json:26-36 | — | pilot-chatspace | На ChatSpace — тонкий мост: пассивный WS-тап, Pinia/router только на чтение, вставка через мост |
| EX-008 | Изолированный relay | Fansly: только `messageSound` | manifest.json:37-45 | — | pilot-chatspace | Двусторонний проверяемый канал с MAIN world |
| EX-009 | Bootstrap и ленивые бандлы | `import()`, повтор с `?retry` | src/content/bootstrap.ts:120-138,281-295 | — | pilot-chatspace | |
| EX-010 | `web_accessible_resources` | — | manifest.json:56-69 | — | pilot-chatspace | |
| EX-011 | Ноль работы вне маршрута | Контроллеры только по нужде | src/content/bootstrap.ts:181-222 | — | pilot-chatspace | |
| EX-012 | Стили и корни UI | Стиль сразу, остальное лениво; корни в body | src/content/bootstrap.ts:90,140-177; src/content/dom-anchor.ts:19-37 | — | pilot-chatspace | Shadow DOM вне `#app`, без глобального CSS |
| EX-013 | Якорь панели | Fansly: перед `app-group-message-input` | src/content/conversation-mount-controller.ts:70-81 | — | fansly-phase | На ChatSpace — слот `browser-composer-translator` (X7) |
| EX-014 | Разделение слоёв и DI | ESLint запрещает content → background, composition root | eslint.config.mjs:62-72; src/background/index.ts:36-193 | — | pilot-chatspace | |
| EX-015 | Каналы сообщений | Два порта, три слушателя `runtime.onMessage` | src/background/index.ts:79-193 | p/contract.ts | pilot-chatspace | Единая валидация zod |
| EX-016 | Сборка | esbuild, firefox128, IIFE и ESM | esbuild.config.mjs:12-172 | — | pilot-chatspace | План: WXT |
| EX-017 | Popup, options во вкладке, иконки | `action`, `options_ui`, 48/96/128 | manifest.json:70-86 | — | pilot-chatspace | |
| EX-018 | Firefox-специфика | `browser.*`, `wrappedJSObject` / `cloneInto` | src/content/native-file-handoff.ts | — | pilot-chatspace | Xray нужен только Voice и vault Fansly |

## 22. Прочие правила из `packages/shared` десктопа

| ID | Функция | Что делает | Fansly | Десктоп | Цель | Почему |
|---|---|---|---|---|---|---|
| RU-001 | Политики фич | Где показывается, тип результата, таймауты, Split и тон, нужен ли черновик | src/shared/features.ts:44-232 | s/features.ts:21-160 | pilot-chatspace | |
| RU-002 | `htmlToPlainText` | HTML OnlyFans → текст | — | s/transcript/html.ts:34 | pilot-chatspace | Для свежего текста (план §3.4) |
| RU-003 | Нормализация транскрипта, блоки трат и подписки | Десктоп их не вызывает | — | s/transcript/normalize.ts; s/transcript/format.ts; s/context/spending.ts; s/context/subscription.ts | not-applicable | Контекст собирает хаб |
| RU-004 | Цены PPV | В центах, $3–200 | — | s/composer.ts:64-79; m/send/engine.ts:52-54 | not-applicable | PPV делает ChatSpace |

---

## Итоги

### Сколько строк по целям

| Цель | Строк |
|---|---:|
| `pilot-chatspace` | 552 |
| `fansly-phase` | 65 |
| `provided-by-chatspace` | 30 |
| `not-applicable` | 78 |
| `needs-owner-decision` | 62 |
| **Всего** | **787** |

По разделам (pilot / fansly / chatspace / n/a / владелец):

| Раздел | Всего | pilot | fansly | chatspace | n/a | владелец |
|---|---:|---:|---:|---:|---:|---:|
| 1. AI-функции | 104 | 75 | 16 | 0 | 3 | 10 |
| 2. Интерфейс AI у поля ввода | 34 | 27 | 1 | 1 | 1 | 4 |
| 3. Spenders | 57 | 38 | 6 | 0 | 4 | 9 |
| 4. «Новые» | 40 | 25 | 9 | 0 | 2 | 4 |
| 5. Vault и медиа | 11 | 0 | 6 | 4 | 0 | 1 |
| 6. Звук и уведомления | 25 | 16 | 4 | 3 | 2 | 0 |
| 7. Хоткеи | 44 | 35 | 0 | 1 | 3 | 5 |
| 8. Popup и строка статуса | 22 | 16 | 0 | 0 | 5 | 1 |
| 9. Настройки | 121 | 93 | 3 | 2 | 16 | 7 |
| 10. Вход, аккаунт, персоны | 37 | 30 | 4 | 1 | 2 | 0 |
| 11. Связь с хабом | 11 | 8 | 0 | 0 | 3 | 0 |
| 12. Ошибки и тосты | 80 | 62 | 7 | 0 | 8 | 3 |
| 13. Логи | 27 | 23 | 1 | 0 | 2 | 1 |
| 14. Отладка и диагностика | 31 | 22 | 2 | 1 | 4 | 2 |
| 15. Телеметрия | 18 | 12 | 0 | 0 | 4 | 2 |
| 16. Надёжность | 29 | 22 | 1 | 2 | 3 | 1 |
| 17. Фоновые действия | 9 | 6 | 3 | 0 | 0 | 0 |
| 18. Обновления и страницы | 18 | 16 | 0 | 0 | 2 | 0 |
| 19. Язык и тема | 8 | 7 | 0 | 0 | 1 | 0 |
| 20. Поверхности десктопа, которые даёт ChatSpace | 39 | 1 | 0 | 15 | 11 | 12 |
| 21. Оболочка расширения | 18 | 16 | 2 | 0 | 0 | 0 |
| 22. Прочие правила | 4 | 2 | 0 | 0 | 2 | 0 |

Как читать: в сырых инвентаризациях было около 1 230 строк (Fansly 650, десктоп 327 +
256); пересекающиеся функции сведены в одну строку, повторяющиеся механики Fansly и
десктопа (например, однотипные настройки сверки непрочитанных) — в групповые строки.
Отдельной строкой оставлено всё, что чаттер видит или может переключить, и каждый код
ошибки.

### Что решил координатор (а не агенты-инвентаризаторы)

Там, где ответ уже есть в плане или журнале решений, вопрос владельцу не задаётся:
- **Compare** — `not-applicable` (AI-149, ER-037): владелец сам убрал его из Fansly.
- **Платные перечитывания** доски, превью и «Новых» десктопа — `not-applicable`
  (SP-025, SP-053, NF-040): правило «не грузить историю неоткрытых чатов» и план §3.7–3.8.
- **Отправка приветствия из окна «Новые» на OF** — `not-applicable` (NF-019): X3, план §3.7
  (бронь + вставка, отправляет человек). Для фазы Fansly — вопрос В15.
- **Звук нового подписчика** — `pilot-chatspace` (SN-012): звук входит в пилот (X5),
  событие — новые строки опроса `client/audience-new`.
- **Постоянный лог с выгрузкой** — `pilot-chatspace` (LG-004…LG-025): у Fansly только
  консоль, но §0 прямо требует «логирование всего».
- **Переключатель RU/EN** — `pilot-chatspace` (I18-001): в десктопе он есть, паритет.
- **Био фана** — `provided-by-chatspace` (CS-035): появилось в ChatSpace 0.172.0
  (`chatspace-delta.md`).
- **Тосты о покупках PPV и чаевых** — `provided-by-chatspace` (SN-022): ChatSpace уведомляет
  о них сам.
- **Хранение токена без шифрования ОС** — `pilot-chatspace` с пометкой риска (AU-007):
  в браузере иначе нельзя, узкий токен (план §3.3) снижает ущерб.

## Вопросы владельцу

Каждый вопрос закрывает несколько строк `needs-owner-decision`.

| # | Вопрос | Строки |
|---|---|---|
| В1 | Сколько живёт выбранный тон Reply: разово (Fansly) или до смены чата (десктоп)? Нужен ли тон по умолчанию (десктоп — casual)? | AI-003, AI-004, ST-098 |
| В2 | Что делать с непустым черновиком при вставке: заменять (Fansly — молча у Reply, Hi, Ping), дописывать (десктоп) или спрашивать (как Coach)? И как ведёт себя Fix из одной части: сам заменяет черновик или ждёт клика? | AI-022, UI-020 |
| В3 | Help — это пресет Coach «Разбор ситуации» (Fansly) или отдельная фича с подсказкой и двумя вставляемыми вариантами (десктоп)? | AI-101 |
| В4 | Блокировать ли Ping для фана, писавшего за 5 дней (Fansly блокирует; десктоп по D29 — никогда)? | AI-036 (от него зависит ER-034) |
| В5 | Сколько генераций одновременно и что с генерацией при смене чата: одна на вкладку и отмена (Fansly) или до трёх в разных чатах в фоне с тостом «AI готово · чат N» (десктоп)? | AI-123, AI-124, ER-014, CS-012 |
| В6 | Нужны ли настройки окон сообщений (Reply / Ping / Fix / глубокое), если на OF окно задаёт хаб? Передавать их хабу как `messageCount` или убрать из настроек? | AI-134, ST-090…ST-093 |
| В7 | Стоимость генерации, токены, «AI сегодня $» и журнал трат по фичам: показывать всем чаттерам (так сейчас в обоих клиентах) или только в режиме отладки (как в §0)? | UI-030, PU-016, DB-022 |
| В8 | Пункт «Обновить переписку» в Coach: убрать (клиентского кэша больше нет) или сделать запросом свежего архива у хаба? | AI-097 |
| В9 | Цепочки `[NEXT]`: в ChatSpace их нет. Убираем «Вставить все» (⌘0) и автоотправку частей, вставляем части по одной, как в Fansly? | UI-028, HK-043, CS-025 |
| В10 | Тиры Spenders: авто-листы хаба (план §3.8), фиксированные пороги Fansly ($600 / 350 / 150 / 50 / 25 / 1) или ручное сопоставление списков OF → полки (десктоп)? Должны ли тиры совпадать на OF и Fansly? | SP-007, ST-108 |
| В11 | Панель статистики Spenders десктопа (выручка, полки, давность, очередь «ждут ответа», новые спендеры): в пилоте, после пилота или не нужна? Данные для неё должен давать хаб. | SP-044…SP-049 |
| В12 | Превью чужого чата (Spenders, Online): только чтение и «Открыть чат», или нужны AI, Ping, автовставка и отправка (в ChatSpace это возможно только в открытом чате)? Показывать ли сегмент Ping? | AI-038, UI-029, SP-054, SP-055, HK-042, CS-030 |
| В13 | Период «Новых»: выбор (Fansly 1 ч – 30 дн, десктоп 24–168 ч) или фиксированное окно хаба? Какой максимум нужен? | NF-003 |
| В14 | Превью переписки в «Новых» на OF: хватит сводки хаба (последние сообщения фана и модели, счётчики) или нужна лента из архива хаба? | NF-010 |
| В15 | Фаза Fansly: сохранить прямую отправку приветствия из «Новых» и автоочередь верификации (она сама читает чаты и делает `POST /group`, может создавать пустые чаты) или перейти на схему OF? | NF-020, NF-039 |
| В16 | Своя панель фана (клавиша `]`): нужна ли поверх ChatSpace, и что в ней — траты по видам, подписка подробно, «фан уже N мес»? Side Panel ChatSpace у организации за флагом. | HK-039, CS-017, CS-031, CS-033, CS-034, CS-037 |
| В17 | Навигация по чатам с клавиатуры (J/K, ⌘U, ⌘1–9, Enter) и палитра ⌘K поверх ChatSpace — нужны? Переход идёт через роутер ChatSpace и открывает (а значит, помечает прочитанным) чат по действию человека. | HK-036, HK-037, CS-014 |
| В18 | Встраиваться ли в строку списка чатов ChatSpace (траты за 30 дней, бейдж AI-задачи)? Это хрупко: список виртуальный и меняется с релизами. | CS-011, CS-012 |
| В19 | Message Guard десктопа выключен вами с 2026-06-24, у OnlyMonster есть свой. Убираем наш вместе с кодами CG-GUARD-* и аудитом или переносим как проверку черновика перед вставкой? | ER-082, LG-019, RB-029, CS-027 |
| В20 | Нужна ли своя защита от ошибки в цене PPV (подтверждение цены словами), если PPV задают в окне ChatSpace? | VA-008 |
| В21 | Принимаем ли, что в ChatSpace после «Send timed out» есть ручной Resend, хотя наше правило — «неопределённую отправку не повторять»? (Отправка — их, мы её не трогаем.) | CS-022 |
| В22 | Кнопка «к вкладке» в списке аккаунтов: в ChatSpace все модели в одной вкладке. Переключать аккаунт через роутер ChatSpace или убрать? | ST-076 |
| В23 | Закрыть пробелы телеметрии Fansly (автозамена Fix → `inserted`, Copy в Review и Recap → `copied`)? Изменятся метрики принятия. | TL-006 |
| В24 | Показывать ли чаттеру расход кредитов хаба по его страницам, если сам клиент ничего не тратит? | DB-024 |
| В25 | Прогнать ли разовую выгрузку локальной истории десктопа в хаб (harvest) перед его выводом? В локальных базах могут быть сообщения и транзакции, которых в хабе нет. | TL-015 |
| В26 | Реестр кодов ошибок: у Fansly и десктопа одинаковые CG-HUB-номера значат разное. Новый клиент берёт ряд Fansly, ряд десктопа или новый ряд? Хабу нужна третья колонка в `docs/error-handling.md` §2. | ER-002 |

## Где инвентаризации ошибались (главное)

Полные списки — в отчётах проходов; здесь то, что влияет на дизайн.

**`fansly-extension.md`:**
- Стоимость и токены видны всем чаттерам, не только в режиме отладки (UI-030).
- Вставка заменяет весь текст поля без вопроса; Esc в inline-панели генерацию не
  отменяет; Enter вставляет следующую часть только у Reply и Fix.
- Логи — только в консоли, экспорта нет (LG-004).
- «Открыть последний» Recap смотрит только локальный кэш: рекап, сохранённый лишь в
  хабе, даёт `no_saved_recap`.
- Скан «Новых» стартует сам при открытии окна; вторая фаза с `POST /group` идёт без клика
  (NF-039).
- Доска Spenders почти вся на английском; J/K проверяются по `event.key` и не работают в
  русской раскладке.
- Контракт SDK на панели хаба виден всегда (не только в отладке); старых персон можно
  только экспортировать, восстановления нет.
- Пробелы в телеметрии `inserted` / `copied` (TL-006).
- На странице чата работают два таймера по 500 мс; восстановление UI при поломке DOM
  бесконечное и без видимого сигнала (RB-008).

**`desktop-app.md`:**
- В acceptance есть четвёртое действие `sent` с флагом `edited` (TL-004).
- Тостов с переходом в настройки по коду ошибки в десктопе нет: ссылка есть у двух кодов
  и открывает настройки целиком (ER-011).
- Карточки ошибок AI только на английском, русские тексты — на входе и в проверке связи
  (ER-008).
- Профилировщик знает 11 стадий, заполняет 4; карточка транскрипта мертва (DB-021).
- Модули `context/spending.ts`, `context/subscription.ts`, `transcript/normalize.ts`,
  `format.ts` десктоп не вызывает — советовать их к переиспользованию не стоит (RU-003).
- `hub/page-mapping.ts` (подбор по username) противоречит плану §3.2 (AU-023).
- Клик по OS-уведомлению о сообщении чат не открывает (открывают только уведомления о
  покупках и тосты).
- Превью Spenders при каждом открытии делает платное чтение хвоста (раз в 5 мин), хотя
  комментарий в коде говорит обратное (SP-053).
- Тон сбрасывается при смене чата; стоимость видна всегда; вставка дописывает даже у
  Improve; в превью единственный вариант вставляется сам.
- В настройках есть переключатели, которые ни на что не влияют (`promptCachingEnabled`,
  модели, reasoning, окна сообщений).

## Ограничения этого списка

- Строки сверены с кодом по ссылкам, но поведение в работе (живой запуск) не проверялось.
- Номера строк Fansly — на HEAD `a534d72`, десктопа — на HEAD `357b14e`; при изменениях
  кода съедут.
- В колонке «Fansly» у хоткеев `scheme.js` и `engine.js` — это
  `vendor/chatgoose-hotkeys/dist/`.
- Новые функции плана (`client/bootstrap`, `client_health`, проверка контракта хоста,
  новый код «ChatSpace не готов») включены для полноты (HB-011, DB-031, ER-049) — это не
  паритет, а условия работы нового клиента.
