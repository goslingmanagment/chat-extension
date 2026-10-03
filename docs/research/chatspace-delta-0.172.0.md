# ChatSpace 0.167.0 → 0.172.0: что изменилось для расширения

Дата: 2026-10-02 (вечер). Источник: публичная статика `https://chat.onlymonster.ai/`,
скачанная анонимными GET; логина, API, WebSocket и живой сессии не было. Бандлы и
скрипты сравнения: `~/Documents/ChatGoose/Research/chatspace-bundles/` (см. README там;
код OnlyMonster, в репозитории не класть).

## 1. Итог в трёх строках

- **Текущая версия ChatSpace — 0.172.0** (`VITE_GIT_TAG: v0.172.0`,
  `composables-BUNn3xEu.js:62818`; в 0.167.0 — `composables-19O1xYoe.js:62726`). Исследование делалось на 0.167.0; между ними
  примерно сутки и пять релизов. `index.html` перевыложен 2026-10-02 в 15:54 GMT.
- **Ни одно допущение исследования не сломалось.** Мост `__omComposerBridge`, стор
  `ofComposerInsert`, все 32 Pinia-стора, ключи кэша, маршрут, 35 WS-событий, очередь
  отправки, поля сообщений, хоткеи TipTap и Esc, тема — на месте и работают так же
  (сверено по коду с нормализацией минифицированных имён, а не только по именам).
- Новое, что касается нас: **блокировка фана** (composer у заблокированного фана
  скрыт), **настройка «фиксированная ширина»** (рабочая область может быть уже окна и
  прижата влево/по центру/вправо), **из Side Panel убраны вкладки Recap, AI, Templates,
  Notes** (остались Insights и Sales), формат времени 12/24 ч, «биография» фана,
  баланс креатора в окне транзакций, новый флаг массовых рассылок.

0.167.0 удалось восстановить почти целиком: 6 файлов ещё отдаёт CDN, остальное нашлось
в локальном HTTP-кэше браузеров на этом Mac (OnlyMonster Browser, Chrome); sha256 всех
JS совпал со списком Codex (`codex/evidence.json`). Нет 6 ленивых чанков фото- и
видеоредактора. Номера строк в `0.167.0/pretty/` совпадают со ссылками исследования
(prettier, ширина 120).

## 2. Набор файлов

| | 0.167.0 | 0.172.0 |
|---|---|---|
| Файлов | 45 (36 JS + `notifications-sw.js` + `index.html` + 7 CSS); 6 JS не найдено | 51 (42 JS + `notifications-sw.js` + `index.html` + 7 CSS) |
| Объём | 5,17 МБ (без редакторов) | 5,70 МБ |
| Строк в `pretty/*.js` | 218 245 | 243 134 |
| Source maps | нет | нет (`sourceMappingURL` отсутствует) |

Не изменились байт в байт: `omWindowApi-DwjTAZsN.js` (Clerk + мост OM Browser),
`runtime-dom.esm-bundler-B8T0cb7A.js`, `vue.runtime.esm-bundler-CUgwNlmm.js`,
`chunk-BEqpzyXh.js`, `SignInView-BJcv8HBW.js`, `notifications-sw.js`, пять CSS
(`accounts`, `inbox`, `EmojiPicker`, `MainLayout`, `notificationEntry`). Остальные
чанки получили новые имена (меняются каждый билд).

Соответствие главных чанков (имена в таблице ниже):

| Роль | 0.167.0 | 0.172.0 |
|---|---|---|
| ядро, локали, WS, ky, Pinia | `composables-19O1xYoe.js` (2 131 110 Б) | `composables-BUNn3xEu.js` (2 138 772 Б) |
| composer, переводчик, шаблоны, чат | `messages-2XnThXD9.js` | `messages-DlBZ5e81.js` |
| список чатов, аккаунты, фаны | `accounts-gVgPsqTs.js` | `accounts-BWN_jVY3.js` |
| очередь отправки, уведомления | `notificationEntry-DgP70ptm.js` | `notificationEntry-DgqI6Vgc.js` |
| экран чата, Side Panel | `ChatView-DgLPXTcj.js` | `ChatView-DOQWEL72.js` |
| layout, глобальные хоткеи | `MainLayout-CFVPH3-K.js` | `MainLayout-DBvnSRX2.js` |
| тема, флаги, вид чата | `fanCardSettings-UahtlbOH.js` | `fanCardSettings-T4I247Gu.js` |
| OF-специфика | `onlyfans-3gv7h9YB.js` | `onlyfans-CaxZc4_R.js` |
| Mimic | `inbox-BVcu4p6i.js` | `inbox-SRJHz93Z.js` |
| точка входа, палитра | `index-UvX_bFdW.js` | `index-DEVowLko.js` |
| TipTap StarterKit | `dist-CTgaf6KW.js` | `dist-CnpqiTNP.js` |
| диагностика («Copy session log») | `composables-B_Bz2Xc6.js` | `composables-BSl13FHf.js` |

Все ссылки ниже — на `pretty/` своей версии.

## 3. Факты, на которых стоит дизайн расширения

Статусы: **без изменений** — код совпал после нормализации имён; **изменено** —
поведение или форма поменялись; **новое**; **удалено**; **не подтверждено** — по
статике не проверить.

| # | Факт | Статус | 0.172.0 | 0.167.0 | Примечание |
|---|---|---|---|---|---|
| 1 | Мост `[data-id="browser-composer-translator"].__omComposerBridge = {setText, insertText, focus, insertMessage}`; `setText` = `clear()` + `<p>текст с <br></p>` + `focus()`; `insertText` = вставка в курсор с `hardBreak` на `\n`; `insertMessage(raw)` → `ofComposerInsert.setInsertPayload` (замена всего черновика) | без изменений | `messages-DlBZ5e81.js:14624-14666` (хелперы 14624-14637, `Yx` 14638-14657, директива `vComposerBridge` 14658-14666) | `messages-2XnThXD9.js:14436-14463` | чтения текста в мосте по-прежнему нет; без редактора свойство удаляется |
| 2 | Где мост: пустой `div` в правой группе верхней полосы composer (`ComposerTopStrip`, ref `trailing`), перед слотами `timer`, `mimic` и кнопкой Templates; детей Vue не трогает (`children: null`, патчится только `data-native-translator`) | без изменений | `messages-DlBZ5e81.js:14941-15060`, узел 15008-15032 | `messages-2XnThXD9.js:14739-14860`, узел 14806-14830 | директива используется только здесь (одно место в бандле) |
| 3 | Composer рендерится на каждую посещённую вкладку чата, видим только активный (`v-show`) | **изменено** | `ChatView-DOQWEL72.js:8274`: `tabId === active && !notFound && !fan.isBlocked` | `ChatView-DgLPXTcj.js:7477` | у заблокированного фана composer скрыт; мост в скрытом composer остаётся, поэтому «видимый composer» (`offsetParent !== null`) по-прежнему правильный выбор |
| 4 | `ofComposerInsert`: `payloadsByChatKey`, `copiedMessage`, `setInsertPayload`, `clearInsertPayload`, `getInsertPayload` | без изменений | стор `messages-DlBZ5e81.js:14610-14622`; применение в composer `18709-18719` | `messages-2XnThXD9.js:14408-14421`; `18665-18676` | watch без `immediate`: payload до монтирования composer не применится — как и раньше |
| 5 | `ofComposerReply` (`setReplyTarget` и др.) | без изменений | `messages-DlBZ5e81.js:17428` | `messages-2XnThXD9.js:17226` | |
| 6 | Pinia: тот же набор из 32 сторов: `_pc_query`, `_pc_mutation`, `accounts`, `badgeCounters`, `campaignCreate`, `chatGallery`, `chatList`, `chatMessages`, `chatTabEntries`, `chatTimers`, `chats`, `collectionsDialog`, `composerTranslator`, `fanInfo`, `fanProfile`, `followUpQueueSync`, `followUpSettings`, `inboxes`, `listLabels`, `messageTemplates`, `messageTranslator`, `mimic`, `notificationList`, `notifications`, `ofComposerInsert`, `ofComposerReply`, `pendingMessages`, `pinnedChats`, `postPreview`, `sidePanel`, `tabEntries`, `templateEdit` | без изменений | `defineStore` = `composables-BUNn3xEu.js:461-475`; `chats` `accounts-BWN_jVY3.js:6219`, `chatList` `:6310`, `pendingMessages` `notificationEntry-DgqI6Vgc.js:1427`, `chatMessages` `messages-DlBZ5e81.js:21403`, `mimic` `inbox-SRJHz93Z.js:258`, `messageTranslator` `messages-DlBZ5e81.js:3196`, `composerTranslator` `:2858`, `sidePanel` `ChatView-DOQWEL72.js:3258` (полный список — `analysis/.../stores-0.172.0.json`) | `composables-19O1xYoe.js:461-475`; `chats` `accounts-gVgPsqTs.js:6219`, `chatList` `:6309`, `pendingMessages` `notificationEntry-DgP70ptm.js:1427`, `chatMessages` `messages-2XnThXD9.js:21228`, `mimic` `inbox-BVcu4p6i.js:258` | новых и удалённых сторов нет; `$onAction` у сторов есть (`composables-BUNn3xEu.js:412`) |
| 7 | `pendingMessages`: `enqueue` → очередь на аккаунт по одному → `POST …/chats/{fan}/messages`; отказ при Mimic или ≥50 в очереди; таймаут 30 с, без автоповтора; `confirmEchoedMessage` по plain-тексту; статусы `pending/sending/failed/confirmed` | без изменений | весь стор `notificationEntry-DgqI6Vgc.js:1340-1640` совпал с 0.167.0 после нормализации; `enqueue` 1543-1565; тело POST 1351-1366; статусы 1304 | `notificationEntry-DgP70ptm.js:1340-1640`, 1543-1565, 1304 | обёртка `enqueue` по-прежнему теряет `isAiGenerated` (`notificationEntry-DgqI6Vgc.js:1639-1654`) |
| 8 | Ключи кэша Pinia Colada: `["chatMessages", acc, fan]` (+ вариант `pinned`), `["fansMap", acc]`, `["fanInsights", acc]`, `["onlyfansBuyingPowers"]` (без acc), `["onlyfansLastPayments", acc]`, `["ofMessageSendersMap", acc]`, `["accounts"]`, `["chatList", …]`, `["chatCounts", acc]`, `["badgeCountersMap"]`, `["mimicChats"]`, `["mimicSettings"]`, `["ofUnsentMessages", acc, fan]`, `["fanInfo", …]`, `["fanMessageActivity", …]`, `["suggestionsToolbar", acc]`, `["aiSettings", …]` | без изменений + 1 новый | `chatMessages` `composables-BUNn3xEu.js:89542-89545`; `fansMap` `accounts-BWN_jVY3.js:7086-7087`; `onlyfansBuyingPowers` `:7194`; `onlyfansLastPayments` `:7244-7245`; `fanInsights` `:8535-8536`; `accounts` `:2048`; `chatList` `:6185`; `chatCounts` `:6199`; `badgeCountersMap` `:9045`; `ofMessageSendersMap` `onlyfans-CaxZc4_R.js:1423-1424`; `ofUnsentMessages` `:1652`; `mimicChats`/`mimicSettings` `inbox-SRJHz93Z.js:234`/`192`; `fanInfo` `ChatView-DOQWEL72.js:781`; `fanMessageActivity` `:1129`; `suggestionsToolbar` `messages-DlBZ5e81.js:18308`; `aiSettings` `:18243` | `composables-19O1xYoe.js:89338-89341`; `accounts-gVgPsqTs.js:7082`, `7190`, `7240`, `8369`, `2048`, `6185`, `6199`, `8879`; `onlyfans-3gv7h9YB.js:1423`, `1652`; `inbox-BVcu4p6i.js:234`, `192`; `ChatView-DgLPXTcj.js:803`, `1657`; `messages-2XnThXD9.js:18106`, `18041` | **новый** ключ `["fanBio", acc, fan]` (`ChatView-DOQWEL72.js:1642-1656`), запрашивается только при открытии диалога «Bio» |
| 9 | Аккаунты: `GET api/v0/accounts` → `{id, platformAccountId (= platform_account_id), platform, name, username, …}` | без изменений | маппер `accounts-BWN_jVY3.js:2033-2047` (совпал с 0.167.0 построчно) | `accounts-gVgPsqTs.js:2033-2047` | привязка «аккаунт OM → страница хаба» по `platform_account_id` остаётся возможной |
| 10 | Маршрут `chat` = `/accounts/:accountId/chats/:chatId?`, `accounts-overview` = `/`, `sign-in` | без изменений | `composables-BUNn3xEu.js:86086-86087` | `composables-19O1xYoe.js:85882-85883` | |
| 11 | Сообщение OF в кэше: `id, text (HTML), createdAt, platformSenderId, isOutgoing (= !is_from_fan), platform, platformMetadata{…, cancelSeconds, isFromQueue, queueId, isUnsent, isNew, isOpened, price, isTip…}` | без изменений | маппер метаданных `composables-BUNn3xEu.js:86781-86812`; REST-маппер `86860-86870`; WS-маппер `86872-86880` | `composables-19O1xYoe.js:86544-86573`, `86655-86676` | `changedAt` клиент не маппит ни в одной версии: в кэше его нет, только в сыром WS-кадре (видно было вживую 2026-10-02, сейчас не проверялось) |
| 12 | Фан (`fansMap`) и строка списка чатов | **изменено** (добавлены поля) | фан: `isBlocked`, `headerUrl` (`accounts-BWN_jVY3.js:7046-7080`); чат: `isMarkedAsUnread` (`accounts-BWN_jVY3.js:6299`, `6395-6405`) | `accounts-gVgPsqTs.js:7046-7076`, `6298` | `isMarkedAsUnread` пока нужен только Telegram (новая capability `flags_chat_as_unread`) |
| 13 | WebSocket `wss://onlymonster.ai/api/chat-space/ws`: действия `ping/auth/subscribe_account/unsubscribe_account`, 35 событий (`authenticated`, `account_new_message`, `account_message_deleted`, `account_fan_typing`, `account_messages_summary`, `account_notifications_summary`, PPV, типы, scheduled_*, шаблоны, Mimic, цветовые группы, list labels…) | без изменений | URL `composables-BUNn3xEu.js:85389`; `new WebSocket` `:86276`; действия `:86428`; события `:86429-86465`; менеджер, бэкофф, auth-хелпер `:86134-86629` совпали с 0.167.0 | `composables-19O1xYoe.js:85185`, `86072`, `86224`, `86225-86261`, `85930-86425` | |
| 14 | Стор `chatMessages`: WS-upsert в `["chatMessages", acc, chatId]`, для исходящих `confirmEchoedMessage` | без изменений | `messages-DlBZ5e81.js:21403-21515` (совпал), `confirmEchoedMessage` `:21424` | `messages-2XnThXD9.js:21228-21340`, `:21249` | |
| 15 | Открытие OnlyFans-чата: клиент только обнуляет `unread` в своём кэше (`chatList.markChatAsRead`), сетевой `GET …/messages?limit=1` — только для платформ с capability `marks_chat_read_on_open` (это лишь `telegram_v2`) | без изменений для OF | watch `ChatView-DOQWEL72.js:8011-8017`; `ze` (GET limit=1) `:8003-8009`; новый обработчик Refresh `:7996-8001` (локальная отметка тоже только при capability); таблица capability `composables-BUNn3xEu.js:62793-62816`; `markChatAsRead` `accounts-BWN_jVY3.js:6395-6405` | `ChatView-DgLPXTcj.js:7214-7227`; `composables-19O1xYoe.js:62702-62723`; `accounts-gVgPsqTs.js:6394-6404` | живой вывод 2026-10-02 остаётся в силе: прочтение на OF делает бэкенд OM при загрузке истории (`GET …/messages`), а не отдельный запрос клиента. Повторно не проверялось (без логина) |
| 16 | Явные запросы прочтения только по действию человека: «Mark all as read» (POST), «Mark as unread» (DELETE) | **изменено** (только путь) | POST `accounts-BWN_jVY3.js:6574`; DELETE теперь `api/v0/accounts/{acc}/platforms/{platform}/chats/{fan}/mark-as-read` `:6480` | `accounts-gVgPsqTs.js:6572`; DELETE `…/platforms/onlyfans/…` `:6478` | для OF путь тот же; нас не касается (мы не пишем) |
| 17 | TipTap: `Mod-b` жирный, `Mod-i` курсив, `Mod-e` inline-code, `Mod-Shift-s` зачёркивание, `Shift-Enter`/`Mod-Enter` → `hardBreak`; Enter без Shift → отправка | без изменений | `dist-CnpqiTNP.js:144`, `189`, `678`, `2529`, `521-522`; конфиг StarterKit и `handleKeyDown` `messages-DlBZ5e81.js:1611-1628` | `dist-CTgaf6KW.js` те же строки; `messages-2XnThXD9.js:1610-1627` | компонент `OfMessageComposer` совпал целиком (`messages-DlBZ5e81.js:18483`, было `18439`) |
| 18 | Alt+S (по `code`, при любых других модификаторах, значит и Ctrl+Alt+S) — автоперевод OM, capture на корне composer, `preventDefault` + `stopPropagation`; Alt+A проглатывается | без изменений | `messages-DlBZ5e81.js:18364-18373` (вынесено в composable, условие `isNativeTranslatorOwner`) | `messages-2XnThXD9.js:18278-18287` | конфликт с нашим Recap на Windows (Ctrl+Alt+S) остаётся |
| 19 | Esc закрывает вкладку чата (`lastResort`), если фокус не в `input/textarea` и не виден `[data-dismissible-open], [role=dialog\|listbox\|menu]`; contenteditable полем ввода не считается | без изменений | регистрация `MainLayout-DBvnSRX2.js:331-333`; диспетчер `composables-BUNn3xEu.js:89854-89880`; `data-dismissible-open` у панели шаблонов `messages-DlBZ5e81.js:11743` | `MainLayout-CFVPH3-K.js:331-333`; `composables-19O1xYoe.js:89649-89677`; `messages-2XnThXD9.js:11565` | |
| 20 | CSP документа — только `frame-ancestors 'none'`, плюс `X-Frame-Options: DENY`; SRI у скриптов нет | без изменений | заголовки ответа `GET /` 2026-10-02 20:34 UTC; `0.172.0/raw/index.html` без `integrity` | то же по исследованию | MAIN-world скрипты расширения ставятся, встроить ChatSpace в iframe нельзя |
| 21 | `isTrusted` не проверяется; детекта расширений нет (`chrome.runtime`, `chrome-extension`, `moz-extension`, `webdriver` — 0 вхождений); Sentry без DSN; сторонней аналитики и записи сессий нет | без изменений | поиск по всем `raw/*.js` 0.172.0 | то же для 0.167.0 | |
| 22 | `data-testid` | без изменений (+2) | 151 разное статическое значение (165 вхождений): добавились `fans-online-show-restricted`, `transactions-summary`; ни одно не удалено. Якоря на месте: `chats-panel`, `chat-list-item` + `data-chat-id` (`ChatView-DOQWEL72.js:6353`), `side-panel`, `conversation-header-*`, `chat-timer-trigger`, `follow-up-trigger`, `notification-entry-button`; `mimic-chats-entry-button`/`fans-online-entry-button` задаются пропом `entry-test-id` (`ChatView-DOQWEL72.js:3905`, `fansOnlineEntry-KoSLSuSr.js:10316`) | 149 значений, 163 вхождения | «≈225» в исследовании — подсчёт по живому DOM (повторы и динамические), статикой не сравнить |
| 23 | `data-id`: только `browser-composer-translator` и `browser-widgets-column` | без изменений | `messages-DlBZ5e81.js:15012`; `ChatView-DOQWEL72.js:8390` | `messages-2XnThXD9.js:14810`; `ChatView-DgLPXTcj.js:7593` | |
| 24 | Тема: `<html class="dark">` по умолчанию; vueuse `useColorMode` с ключом `chat-space:theme-mode`; палитра `--color-om-*` — RGB-триплеты, ставятся инлайном на `<html>` | без изменений + новые переменные | `fanCardSettings-T4I247Gu.js:1368-1372`; `index-DEVowLko.js:886-898`; 89 разных `--color-om-*` в обеих версиях | `fanCardSettings-UahtlbOH.js:1365-1371`; `index-UvX_bFdW.js:886-899` | **новые** переменные на `<html>`: `--app-content-max-width` (1600px или `none`) и `--app-content-align` (`fanCardSettings-T4I247Gu.js:1437`, `1623-1624`; применяются к контейнеру `MainLayout-DBvnSRX2.js:303`) |
| 25 | `window.OM_WINDOW` — мост OnlyMonster Browser; в обычном браузере отсутствует | без изменений | `omWindowApi-DwjTAZsN.js:1646` (файл байт в байт тот же); `isElectronHost` в диагностике `composables-BSl13FHf.js:425` | те же | живьём не проверялось |
| 26 | Service worker `notifications-sw.js`: только `notificationclick`, без push и fetch; канал `BroadcastChannel('chat-notifications')` | без изменений | sha256 файла тот же; регистрация `messages-DlBZ5e81.js:3779`; канал `:3778-3786` | `messages-2XnThXD9.js:3599` | |
| 27 | Флаги Unleash, которые читает клиент | **изменено** (+1) | 7 флагов `fanCardSettings-T4I247Gu.js:1314-1322`: добавлен `OF_MASS_MESSAGES` = `jedi.omg-1791.of-mass-messages` (гейт массовых рассылок, `messages-DlBZ5e81.js:11979`); `SIDE_PANEL` = `sith.cor-2363.side-panel` по-прежнему гейтит Side Panel (`ChatView-DOQWEL72.js:8517`) | 6 флагов `fanCardSettings-UahtlbOH.js:1312-1320`; `ChatView-DgLPXTcj.js:7718` | включён ли Side Panel у организации сейчас — **не подтверждено** (нужен ответ `/api/frontend`, это API) |
| 28 | Side Panel: вкладки `insights, sales, templates, notes, recap, ai`, виджеты spending/preferences/lists/profile/subscription | **изменено** | вкладки только `insights` и `sales` (`ChatView-DOQWEL72.js:3235-3238`); виджеты те же пять, но теперь по платформам (`components: {onlyfans: …}`, `:3239-3256`); стор `:3258-3300`; i18n `composables-BUNn3xEu.js:77881` | `ChatView-DgLPXTcj.js:2808-2822`; i18n `composables-19O1xYoe.js:77757` | **Recap, AI, Templates, Notes удалены** из кода целиком (слово `recap` в 0.172.0 больше не встречается); API регистрации своих вкладок по-прежнему нет |
| 29 | Локали интерфейса en/de/es/ru/uk | без изменений | `composables-BUNn3xEu.js:85123-85125` | `composables-19O1xYoe.js:84932-84934` | |
| 30 | AI Suggestions: `auto_generate_reply` клиент не читает | без изменений | 0 вхождений | 0 вхождений | |
| 31 | Ключи localStorage `chat-space:*` | без изменений + 2 новых | 36 ключей (`analysis/.../lskeys-0.172.0.txt`); новые `chat-space:time-format` (`composables-BUNn3xEu.js:85288`) и `chat-space:fans-online:show-restricted:`; черновик `chat-space:draft:` (`:89696`) | 34 ключа | |
| 32 | REST-пути в клиенте | изменено (+3) | 104 пути; новые: `POST/DELETE api/v0/accounts/{acc}/platforms/onlyfans/users/{fan}/block` (`accounts-BWN_jVY3.js:7433`, `7470`); `…/platforms/onlyfans/payouts/balance` и `…/earnings/chart` (`ChatView-DOQWEL72.js:4100-4113`); фаны `with_bio` (`:1647-1648`); DELETE mark-as-read обобщён на `{platform}` | 102 пути | всё это — по действию человека |

## 4. Что нового в 0.172.0 (продуктовые изменения ChatSpace)

| Что | Где | Касается нас? |
|---|---|---|
| Блокировка и разблокировка фана: диалог подтверждения, тосты, в чате заблокированного — «You blocked this fan» и кнопка Unblock вместо ленты, composer скрыт | `OfBlockFanConfirmDialog` `accounts-BWN_jVY3.js:7487`; API `:7433`, `:7470`; `MessagesList` `messages-DlBZ5e81.js:21017` (ветка `isFanBlocked`); `ChatView-DOQWEL72.js:8274` | да: панель расширения должна видеть «фан заблокирован» (`fansMap[fan].isBlocked`) и не предлагать вставку |
| «Фиксированная ширина» рабочей области (до 1600 px) и выравнивание влево/по центру/вправо | `fanCardSettings-T4I247Gu.js:1437-1457`, `1555-1556`, `1623-1624`; `MainLayout-DBvnSRX2.js:303` | да: на широком экране контент может не доходить до краёв окна; всё, что крепится вне composer, позиционировать от контейнера, а не от окна |
| Формат времени 12/24 ч | `chat-space:time-format`; `fanCardSettings-T4I247Gu.js:1456-1457` | нет, если время берём из кэша (ISO), а не из DOM |
| «Bio» фана (диалог, запрос `fans?with_bio`), обложка профиля `headerUrl` | `FanBioDialog` `ChatView-DOQWEL72.js:1867`; запрос `:1642-1656` | нет (только по клику человека) |
| В окне транзакций — сводка: текущий и ожидающий баланс креатора, чистый доход за этот и прошлый месяц (UTC) | `ChatView-DOQWEL72.js:4093-4125`, `transactions-summary` `:4139` | нет |
| Fans Online: «Show Restricted» | `fans-online-show-restricted`; ключ `chat-space:fans-online:show-restricted:` | нет |
| Side Panel перестроен под платформы, вкладки Recap/AI/Templates/Notes убраны | см. факт 28 | косвенно: прямого пересечения с нашими Recap/AI в их Side Panel сейчас нет |
| Флаг массовых рассылок OF | см. факт 27 | нет |
| Telegram (`telegram_v2`): новая capability `flags_chat_as_unread`, переделан composer Telegram | `composables-BUNn3xEu.js:62806-62813`; `TgV2MessageComposer` `ChatView-DOQWEL72.js:7495` | нет (ChatSpace для нас — только OF) |

Новых Pinia-сторов, новых WS-событий, новых слотов composer и новых AI-функций нет.
Fansly в коде ChatSpace по-прежнему не упоминается.

## 5. Что это значит для расширения

1. **Архитектура из исследования держится.** Всё, на что опирается план (мост для
   вставки, `ofComposerInsert`, чтение `["chatMessages", acc, fan]` и `fansMap` из кэша,
   `router` для открытого чата, пассивный WS-тап, `pendingMessages.$onAction('enqueue')`
   для факта отправки, `--color-om-*` и `.dark` для темы, capture-хоткеи), в 0.172.0 на
   месте без изменений.
2. **Темп релизов подтвердился: пять версий примерно за сутки.** Имена чанков и
   минифицированные переменные меняются каждый раз, строковые контракты — нет.
   Проверка контракта хоста при старте (стор `ofComposerInsert` есть, у видимого
   composer есть `__omComposerBridge` с четырьмя методами, ключ `chatMessages` читается,
   маршрут `chat`) и отключение функции с причиной вместо поломки — обязательны.
   Полезно держать в CI расширения скачивание свежих бандлов и автоматическую сверку
   этих строк (скрипты в `chatspace-bundles/scripts/`).
3. **Заблокированный фан — новое состояние, которое надо обработать.** Composer
   скрыт, мост в скрытом composer остаётся. Выбор «видимого composer текущего маршрута»
   это уже покрывает; панель должна показывать причину («фан заблокирован») и не
   предлагать Reply/Hi/Ping.
4. **«Фиксированная ширина» меняет геометрию.** Основная панель по X7 крепится к
   composer — не страдает. Всё остальное (оверлеи, Spenders, «Новые»), если оно
   стыкуется к краю рабочей области, должно брать координаты от контейнера ChatSpace
   (или от composer), а не от `window`. Тестировать в обоих режимах.
5. **Хоткеи:** конфликты те же — ⌘/Ctrl+E и ⌘/Ctrl+I (TipTap), ⌘⇧S (зачёркивание),
   Ctrl+Alt+S (автоперевод OM, только когда переводчик ChatSpace — «владелец»), Esc
   (закрыть вкладку чата). Лечение из исследования (capture на `window` с
   `document_start`, `preventDefault` + `stopImmediatePropagation`,
   `data-dismissible-open` на хосте оверлея) остаётся верным.
6. **Side Panel OnlyMonster сократился до Insights и Sales.** Свою вкладку туда
   по-прежнему не добавить (API нет). Для нас это лишь снижает риск, что OM в ближайших
   релизах покажет свой Recap/AI рядом с нашим, но решения строить на этом не стоит:
   код вкладок могли убрать временно.
7. **Ничего нового не тянет к собственным запросам к OnlyMonster.** Новые запросы
   (block, bio, balance) делает только ChatSpace по клику человека; тихий режим не
   меняется.

## 6. Не подтверждено (и почему)

- Живое поведение: WS-кадры 0.172.0 (в т.ч. `changedAt`, `isFromQueue` в сыром кадре),
  то, что бэкенд OM помечает чат прочитанным на OF при загрузке истории, отсутствие
  `OM_WINDOW` в обычном браузере, Esc в composer — проверялись вживую на 0.167.0;
  сейчас без логина повторить нельзя (граница задания). По коду клиента ничего из этого
  не поменялось.
- Состояние флагов Unleash у организации (включён ли Side Panel) — это ответ API.
- Шесть чанков фото- и видеоредактора 0.167.0 не восстановлены, поэтому их сравнение
  невозможно; размеры в 0.172.0 почти те же (200 772 против 200 766 Б, 17 059 против
  17 059 Б, 196 549 против 196 547 Б), так что `PhotoEditor*`/`VideoEditor*` в списке
  «новых компонентов» — артефакт неполного набора, а не новая функция.
- Точное число `data-testid` в живом DOM (исследование: ≈225) — статикой не считается.
- Поддерживает ли OnlyMonster Browser установку расширений — не перепроверялось
  (`omWindowApi` не изменился).
