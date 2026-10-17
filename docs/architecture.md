# ChatGoose для ChatSpace: архитектура расширения (сводный документ)

Дата: 2026-10-03. Статус: итоговый план работ. Кода пока нет.

Документ сведён из двух планов (A — Opus, B — astra), их сверки в раунде 3 и
обязательных решений координатора и владельца (раунд 4). Где решения берут сторону B,
текст следует B. Строки чек-листа паритета разнесены в [parity/parity-map.md](parity/parity-map.md) (исходный чек-лист — [parity/parity-checklist.md](parity/parity-checklist.md)).

Ссылки `файл:строка` ведут:
- на бандлы ChatSpace 0.172.0 (`~/Documents/ChatGoose/Research/chatspace-bundles/0.172.0/pretty/`);
- на хаб ревизии `56e64a7f` (`git show 56e64a7f:<путь>`);
- на клиенты `fansly-chat` `a534d7249cc5` и десктоп `357b14ecebb2`;
- на документы репозитория `chat-extension` (`8b055e956586`).

Сокращения файлов бандлов: `messages` = `messages-DlBZ5e81.js`, `composables` =
`composables-BUNn3xEu.js`, `notificationEntry` = `notificationEntry-DgqI6Vgc.js`,
`accounts` = `accounts-BWN_jVY3.js`, `ChatView` = `ChatView-DOQWEL72.js`, `inbox` =
`inbox-SRJHz93Z.js`, `onlyfans` = `onlyfans-CaxZc4_R.js`.

В ChatSpace 0.195.0 модуля `messages` нет: его содержимое (поле ввода и его Send, мост
`__omComposerBridge`, переводчик, обработчик эха открытого чата) — во втором модуле
`onlyfans`, `onlyfans-SstGvKHV.js` (§6.2, разбор 2026-10-09). Ссылки `messages:NNNN` —
строки 0.172.0; где известны строки 0.195.0, в §6.7 они даны рядом.

## 0. Цель, задача и почему так

### 0.1 Цель

Одно расширение Firefox даёт чаттерам агентства наши AI-инструменты прямо в веб-чате
OnlyMonster ChatSpace (OnlyFans), а во второй фазе — на fansly.com. После пилота оно
заменяет два нынешних клиента: десктоп `onlyfans-chat` и расширение `fansly-chat`.

Планка владельца (X6): интерфейс делается с нуля, но переносится каждая функция обоих
клиентов — включая логи, режим отладки, настройки, popup и тосты ошибок. Код,
архитектура и скорость должны стать лучше. Убрать функцию можно только с согласия
владельца.

### 0.2 Задача и её трудности

1. **ChatSpace — чужое приложение.** Публичного API для расширений у него нет. Его
   выпускают часто (бывало пять сборок за сутки), внутренние имена меняются без
   предупреждения. Нам нужно встроиться так, чтобы поломку было видно сразу, а не
   ломался весь чат.
2. **Тихий режим (X3).** Правила OnlyMonster (п. 2.1(d)) запрещают реверс-инжиниринг.
   Поэтому мы не делаем к OnlyMonster ни одного своего сетевого запроса. Мы только
   читаем то, что страница уже держит в памяти, и вставляем черновик через их же
   мост поля ввода. С 2026-10-17 (X54) владелец разрешил свои чтения: одно есть —
   сообщения открытого чата из API OnlyMonster (`openChatMessages`), только того
   чата, который человек открыл сам.
3. **Одна запись по клику (X8).** Из превью чужого чата человек может отправить
   сообщение кликом — через собственную очередь отправки ChatSpace, как их кнопка
   Send. Это единственная запись, кроме вставки текста и перехода по клику. Риск по
   правилам владелец принял.
4. **Нельзя ошибиться чатом.** Ответ, сгенерированный для одного фана, никогда не
   должен попасть в поле ввода или в отправку другого. Чаттер переключает чаты быстро,
   генерация идёт секунды, у разных чатов есть свои черновики.
5. **Хаб уже спланирован.** Граница с хабом согласована (`docs/hub-integration-plan.md`).
   Её не пересматриваем, только добавляем то, что прямо следует из ответов владельца.
6. **Строить будут несколько агентов параллельно.** Интерфейсы между частями нужно
   заморозить до начала работы, иначе части разъедутся.
7. **UI строит отдельный агент** (X7): с нуля, панель над полем ввода. Ему нужен
   точный контракт: что он получает и чего ему делать нельзя.

### 0.3 Почему именно так — коротко

1. **Три мира с разными правами.**
   - Мост в коде страницы (MAIN world) читает память ChatSpace и делает ровно три
     записи: вставка, переход по клику, отправка из превью по клику.
   - Изолированный скрипт ведёт интерфейс и хоткеи.
   - Фон работает с хабом, ведёт операции, логи, звук и настройки.

   Так секреты и сеть никогда не оказываются в чужой странице.
2. **Панель стоит в потоке над рамкой поля ввода.** Внутрь их узкой полосы она
   физически не помещается: полоса высотой 40 px обрезается. Над рамкой лента
   ChatSpace сама держит прокрутку внизу, своей компенсации не нужно (§6.3).
3. **Каждая генерация навсегда привязана к своему фану.** Вход, страница, персона,
   фан, номер маршрута, ревизия черновика сверяются перед каждой записью — в одном
   синхронном шаге внутри страницы, без пауз, в которые человек успел бы что-то
   поменять (§6.4).
4. **Хаб — источник фактов.** Деньги, подписка, архив переписки, досье, правила AI —
   всё из хаба. Расширение ничего из этого не вычисляет по странице. Свежий текст
   страницы допускается только в четырёх фичах открытого чата (план хаба §3.4).
5. **Вместо канарейки — проверка контракта и мягкая деградация.** Робота в живом
   ChatSpace нет (А2). На старте мост проверяет каждый якорь. Сломалось — выключается
   ровно та функция, которая от него зависит, человек видит причину, владельцу
   уходит сигнал в `client_health`.
6. **Сначала общие интерфейсы, потом параллельная работа.** Пакет R01 замораживает
   типы и схемы. Каждый исполнитель работает в своём пакете по этим интерфейсам и
   против поддельных реализаций.
7. **Ничего не повторяется вслепую.** Платная генерация после неизвестного исхода не
   перезапускается. Отправка, исход которой неизвестен, не повторяется никогда.
   Вставка после потерянного ответа не повторяется.

### 0.4 Словарь

| Термин | Что значит здесь |
|---|---|
| ChatSpace | веб-чат OnlyMonster `https://chat.onlymonster.ai`, наш хост |
| хост | сайт, поверх которого работает расширение: ChatSpace, позже fansly.com |
| MAIN world | скрипт расширения, работающий в том же JavaScript-мире, что и код страницы. Видит их объекты, но страница видит и его |
| изолированный мир | скрипт расширения рядом со страницей: видит DOM, но не их переменные. Страница его не видит |
| фон (event page) | невидимая страница расширения. Firefox может выгружать её в простое, поэтому всё важное она хранит на диске |
| Shadow DOM | своё поддерево DOM с отдельными стилями. Стили ChatSpace к нам не протекают, наши — к ним |
| composer | поле ввода сообщения ChatSpace; мост — их объект `__omComposerBridge` с методами `setText`/`insertText`/`focus` |
| Pinia, сторы | хранилища состояния во Vue-приложении ChatSpace; `pendingMessages` — их очередь отправки |
| Colada, кэш | кэш запросов ChatSpace (`_pc_query`): переписка открытых чатов, списки, фаны |
| SSE | поток ответа хаба по частям (кадры `meta`, `content_delta`, `done` и др.) |
| bootstrap | ответ хаба при входе: кто вы, какие страницы выданы, флаги и пределы |
| флаг | выключатель функции на сервере, без нового выпуска расширения |
| CAS | «сравни и запиши»: запись идёт, только если значение всё ещё то, которое мы проверили |
| ревизия черновика | счётчик изменений поля ввода; растёт на каждый ввод человека |
| эпоха | номер «поколения» (маршрута, документа, входа). Сменился — старые намерения недействительны |
| бронь (lease) | временное право одного чаттера работать с фаном в «Новых»; продлевается явно |
| опека (custody) | бессрочная отметка хаба «отправка этому фану начата»; снимается только доказанным исходом |
| квитанция (receipt) | id сообщения, который вернул сервер на нативную отправку |
| эхо | событие WebSocket ChatSpace о новом сообщении, в том числе нашем исходящем |
| тап WebSocket | пассивный наблюдатель входящих кадров уже открытого сокета страницы |
| CG-код | наш код ошибки для поддержки, формат `CG-<ОБЛАСТЬ>-<ИМЯ>` |
| парность (паритет) | перенос функции старых клиентов; таблица — `parity-map.md` |
| P1 | инцидент высшей важности пилота: вставка в чужой чат, отправка без человека, чтение чата без человека |

## 1. Решения

| # | Решение | Почему | Доказательства |
|---|---|---|---|
| D-01 | Только Firefox, MV3, фон — event page (`background.scripts`), минимум Firefox 142; код переносимый: `browser.*` — только в пакете `platform` | А1, А5; service worker в Firefox нет | MDN BCD; `fansly-chat/manifest.json:21-25, 87-91` |
| D-02 | Сборка WXT 0.21.4 с явным `--mv3`, Vite 8.3; ленивые ESM-чанки content script — своей второй сборкой Vite | WXT по умолчанию собирает Firefox в MV2 и не умеет ESM content scripts | документация WXT «Targeting browsers», «ES Modules» |
| D-03 | Node 26 (станет LTS в конце октября 2026; у владельца 26.7.0), откат на Node 24 LTS, если инструмент падает в спайке M0; `packageManager: pnpm@10.33.1`; TypeScript 6.0.3 | решение владельца «свежее»; TS 7.0.2 уже вышел, но `typescript-eslint` 8.71 принимает только `>=4.8.4 <6.1.0` | npm 03.10.2026; локально `node -v` = 26.7.0 |
| D-04 | pnpm workspace: `apps/extension` + приватные пакеты `contracts`, `core`, `platform`, `hub`, `host-chatspace`, `ui`, `testing` (`host-fansly` — фаза 2); наружу — только `exports`; граф держат dependency-cruiser и ESLint | границы видны и проверяемы, параллельные исполнители не лезут в чужое | §3, §4 |
| D-05 | UI — Preact 11.0.x + `@preact/signals`, без `preact/compat`; гейт в спайке M0; откат на 10.29.8 — одна зависимость | решение владельца «свежее»; экосистема 11-ю версию принимает | npm: `@preact/signals` 2.11.3 peer `>=10.25.0 \|\| >=11.0.0-0` |
| D-06 | zod 4 на границах фона, `zod/mini` в content scripts, мост MAIN без зависимостей (проверки руками) | размер первого чанка; MAIN — чужая территория | §6.1 |
| D-07 | Мост MAIN пишет ровно в трёх местах: вставка через `__omComposerBridge`, `router.push` по клику, `pendingMessages.enqueue` по клику в превью (X8). Плюс два пассивных наблюдателя: тап WebSocket и наблюдатель квитанции (для отправки X8 и для отправки человеком из composer, §6.6) | X3 и X8 | `messages:14638-14657`; `composables:86086-86087`; `notificationEntry:1543-1564` |
| D-08 | Канал MAIN ↔ изолированный — `MessageChannel` с рукопожатием, версией и пределами; всё из MAIN проверяется схемой | MAIN недоверенный: страница видит его и может подделать сообщения | §5.3, §14 |
| D-09 | Панель (док) — в потоке, первым ребёнком корня рамки composer (`div.relative`); слот моста — якорь; оверлеи — свой хост вне `#app` | слот в полосе `h-10` внутри рамки с `overflow-hidden`; лента держит низ сама, только когда стоит точно у низа, — рядом с низом его держит док (X26, §6.3) | `messages:5693, 5695, 5753-5755, 14928-14966, 15008-15032, 19905-19913`; `ChatView:7860, 8253, 8274` |
| D-10 | Привязка: неизменяемая идентичность генерации + эпохи маршрута/документа/монтирования + CAS ревизии черновика в одном шаге MAIN + чтение результата после записи | P1 «вставка в чужой чат» | §6.4 |
| D-11 | Операции живут в фоне: одна на чат во всём расширении, до трёх на вкладку, без очереди; закрытие вкладки отвязывает поверхность, но генерацию не отменяет | А3 | §7 |
| D-12 | Хранение: `storage.session` — результаты и журнал операций; `storage.local` — настройки, вход (отдельный ключ), очередь телеметрии, журнал отправок, черновики превью и приветствий (до отправки или сброса, не дольше 7 дней, X47); IndexedDB — логи; у всех хранилищ пределы. `unlimitedStorage` не нужен | А5; event page выгружается | §9.4 |
| D-13 | Хаб — только из фона, через вендоренный SDK, узкий токен; новые маршруты — сначала контракт в хабе, расширение до этого живёт на поддельном хабе | план хаба §4–§5 | §8 |
| D-14 | Свежий текст страницы — только Reply/Fix/Hi/Ping открытого чата, только подтверждённые сообщения с числовым id; превью, Coach, Recap, Review — только архив хаба | план хаба §3.4, X4 | `composables:86781-86812, 86860-86880` |
| D-15 | Split — маркеры `[NEXT]`/`[VARIANT]` за возможностью `split-all-v1`, без нового кадра SSE; Recap и Review Split не применяют | Б7; старые клиенты не меняются | `templates.ts:18, 203, 448`; `prompts/output/split.ts:20-25`; `routes.ts:1884-1935` |
| D-16 | Входящие: сначала сторы; для чатов вне памяти — тап WebSocket (`Proxy` над конструктором) за флагом `wsTap` | сторы видят не все чаты | `messages:21420-21422`; `accounts:6337-6366, 9450-9485`; `composables:86366-86425` |
| D-17 | Факт отправки (`sent`) — только по id из квитанции нативной отправки и эху с тем же id; `edited` — по ревизии, а не по похожести текста | ложный `sent` хуже его отсутствия | §6.6 |
| D-18 | Хоткеи — один ранний диспетчер в изолированном мире на `document_start` (capture на `window`), фокус внутри нашего UI — через реестр наших закрытых ShadowRoot (`activeElement`), внешний `composedPath()` — только чтобы узнать наш хост; на развёрнутых наших окнах — `data-dismissible-open` | конфликты с ⌘E/I, Alt+S, Esc ChatSpace | `messages:18364-18372`; `MainLayout-DBvnSRX2.js:331-333` |
| D-19 | Тема — класс `dark` на `<html>` и переменные `--color-om-*` хоста; пользователь может выбрать свою | X7 | `index-DEVowLko.js:886-898` |
| D-20 | Новый реестр ошибок: формат `CG-<ОБЛАСТЬ>-<ИМЯ>`, объединение обоих планов, `CG-SEND-*` для X8; удалённые коды остаются записями | А9 | прил. А |
| D-21 | Логи — структурные записи с уровнями, вымаранием секретов, IndexedDB с ротацией, выгрузкой; тексты переписки и промпты не пишутся никогда | X6 | §9.2 |
| D-22 | Телеметрия: `ai_acceptance` и `client_health` с гистограммами замеров; обе — только при согласии на технические данные Firefox | А6; правила Mozilla | §9.6 |
| D-23 | Настройки — версионный объект, миграции только вперёд, «только чтение» при более новой схеме; «Сохранено» — только по подтверждению фона | X6; события `pagehide` асинхронные записи не гарантируют | §9.4 |
| D-24 | Тесты: Vitest; независимый стенд-хост (наш код и наш CSS) в git и CI; поддельный хаб; WebdriverIO 9 + geckodriver; локальная сверка контракта с копией бандлов (вне CI); проверка архива выпуска на чужой код; внешний вид — владелец на настоящем ChatSpace | А2; бандлы — чужой код | §12 |
| D-25 | CI на ПК владельца через `ci-pool`; PR в Draft; перед Ready — локальные проверки; Ready один раз | правила владельца | `~/.agents/AGENTS.md` |
| D-26 | Выпуск: `web-ext sign --channel unlisted`, свой фид, предполётные проверки, гейт совместимости SDK | А4; план хаба §3.1 | `fansly-chat/scripts/deploy.sh` |
| D-27 | Превью (Spenders, «Новые») — лента архива хаба; генерация по контексту хаба; «Открыть и вставить» по клику; отправка из превью по клику (X8) | А7, Б8, X8 | §6.5, §6.7 |
| D-28 | Spenders — `/api/v2/spenders` и корзины хаба; статистика — серверный `spenders/stats` | А8; клиент не видит всю страницу | `primitives.ts:80-83`; `routes.ts:1234-1238` |
| D-29 | Панель фана — `spenderDetail` (только целевая страница) + `pageConversationProfile`/`pageFanProfile`; `fansMap` ChatSpace — только украшение. Рядом с панелью фана ChatSpace 0.195 наша показывает только то, чего там нет: деньги по видам из хаба, риск ухода, профиль из хаба по разделам, Recap (X47) | А8; поля подписки уже есть | `routes.ts:1284-1309, 6638-6672, 6736-6740` |
| D-30 | Навигация и палитра — `router.push` ChatSpace по действию человека; порядок — из уже загруженных списков | А8, Б13 | `accounts:6185, 8645` |
| D-31 | Рекапы общие для всех допущенных чаттеров; локальные слоты — только копии; приватных рекапов на чаттера нет никогда | решение владельца | `ai-restricted.ts:89-141`; `ai/index.ts:138-172` |
| D-32 | Gecko id `chat-extension@gosling.agency`, фид `https://ext.gosling-agency.ru/chat-extension/firefox/updates.json`; старое Fansly-расширение (`chatgoose@gosling.agency`) стоит рядом | А4 | `fansly-chat/manifest.json:89-91` |

## 2. Как это работает

```
chat.onlymonster.ai (вкладка ChatSpace)
 ├─ MAIN world: chatspace-main.js — document_start, ≤ 10 КиБ (X11), без зависимостей
 │    читает:   #app.__vue_app__ → $router, $pinia._s (сторы), _pc_query (кэш), мост composer
 │    слушает:  router.afterEach, $onAction/$subscribe сторов, кадры WebSocket (тап)
 │    пишет:    1) вставка через __omComposerBridge (CAS ревизии)
 │              2) router.push — только по клику человека
 │              3) pendingMessages.enqueue — только по клику в превью (X8)
 │        ⇅ MessagePort (рукопожатие, версия, пределы; всё проверяется на стороне isolated)
 ├─ MAIN world: chatspace-ws.js — регистрируется фоном динамически при флаге wsTap
 │    Proxy над конструктором WebSocket: пассивный слушатель кадров сокета страницы
 ├─ isolated: chatspace.js — document_start
 │    диспетчер хоткеев, клиент моста, HostPort, монтирование дока и оверлеев,
 │    контроллеры поверхностей, UI (Preact в закрытом Shadow DOM);
 │    лениво (ESM): Coach, Recap, Review, Spenders, «Новые», панель фана, палитра, отладка
 │        ⇅ runtime.Port 'cg-tab' (схемы zod, проверка sender.id / frameId / origin)
 background (event page): вход и токен, bootstrap, операции AI (SSE), журнал отправок X8,
   Spenders, статистика, лента, «Новые» и бронь, рекапы, телеметрия, логи (IndexedDB),
   звук, настройки и миграции
   → только хаб https://gosling-agency.ru; к *.onlymonster.ai — ни одного своего запроса
 popup / options / debug-страницы ⇄ background (runtime.sendMessage, схемы zod)
```

**Reply в открытом чате.**
1. Хоткей или кнопка в доке. Диспетчер перехватывает клавишу раньше ChatSpace.
2. Контроллер дока собирает `StartOp`: цель, привязка, тон, Split и, если включено,
   свежий хвост переписки.
3. Фон проверяет вход, персону и лимиты (один на чат, три на вкладку) и открывает
   поток хаба.
4. Кадры текста пачками по 50 мс идут во вкладку, UI рисует их.
5. Клик по части — намерение вставки (`InsertIntent`). MAIN в одном шаге сверяет
   маршрут, видимый composer и ревизию черновика, вставляет, читает результат.
6. Телеметрия `inserted`. Отправляет человек. Квитанция и эхо с тем же id дают `sent`.

**Превью чужого чата и «Открыть и вставить».**
1. Человек открывает превью фана в Spenders или «Новых». Лента — из архива хаба,
   к ChatSpace запросов нет, чат остаётся непрочитанным.
2. Генерация по клику — по контексту хаба.
3. «Открыть и вставить»: ChatSpace открывает чат своим роутером. Это действие
   человека: чат становится прочитанным, владелец это принял (А7).
4. Вставка — только когда смонтирован composer именно этого чата, со сроком и отменой.

**Отправка из превью (X8).**
1. Клик «Отправить» по выбранной части.
2. Фон берёт у хаба опеку `dispatch` — флаг проверяется на сервере атомарно.
3. MAIN в одном синхронном шаге проверяет все условия и свежесть и вызывает
   `pendingMessages.enqueue`.
4. Наблюдатель квитанции берёт id из ответа их же запроса. Эхо с тем же id даёт
   «отправлено».
5. Неизвестный исход не повторяется никогда.

**Входящее сообщение.**
1. Тап видит кадр `account_new_message`, считает его в счётчике по фану (для свежести
   X8) и пересылает метаданные без текста.
2. Фон решает, звучать ли.

## 3. Репозиторий и инструменты

```
chat-extension/
  package.json · pnpm-workspace.yaml · .nvmrc (26) · tsconfig.base.json
  eslint.config.ts · .dependency-cruiser.cjs
  apps/extension/                 WXT: точки входа, манифест, корни композиции
    wxt.config.ts                 browser 'firefox', manifestVersion 3, хук манифеста
    src/entrypoints/
      background.ts               → composition/background
      chatspace-main.content.ts   world MAIN, document_start, https://chat.onlymonster.ai/*
      chatspace.content.ts        isolated, document_start, тот же адрес
      chatspace-ws.ts             тап WebSocket, регистрируется фоном динамически
      popup/ · options/ · debug-prompt/ · debug-journal/
    src/composition/              background.ts · tab.ts · pages.ts — только сборка зависимостей
    lazy/vite.config.ts           вторая сборка: ленивые ESM-чанки content script, своя у каждого сайта (lazy/<сайт>/)
  packages/
    contracts/                    типы, схемы, реестр CG, ключи i18n, модели видов UI; без логики
    core/                         логика без DOM, browser.*, fetch, Preact и SDK
      src/domain/                 операции, фичи, разбор ответа, текст, Coach, Recap, Spenders,
                                  «Новые», панель фана, навигация, политика хоткеев и звука,
                                  ошибки, i18n, схема настроек и миграции, телеметрия, логи, отладка,
                                  машина состояний отправки X8
      src/services/               службы фона поверх портов: планировщик операций, координатор
                                  отправки, очередь телеметрии, приёмник логов, владелец настроек,
                                  звуковой арбитр, присутствие вкладок
      src/application/            контроллеры вкладки и страниц: док, Coach, Recap, Review,
                                  Spenders, превью, «Новые», панель фана, навигация, тосты,
                                  popup, настройки, отладка
    platform/                     единственное место с browser.* и IndexedDB
    hub/                          фасад хаба поверх вендоренного SDK (только фон)
    host-chatspace/
      src/main/                   мост MAIN (без зависимостей), тап WS, порт отправки, наблюдатель квитанции
      src/isolated/               клиент моста, HostPort, проверка контракта, монтирование,
                                  вставка, навигация
    ui/                           поверхности Preact: kit, dock, overlays, spenders, newcomers,
                                  fanpanel, palette, pages
    testing/                      стенд-хост, поддельный хаб, обвязка e2e, формы данных
    host-fansly/                  фаза 2
  vendor/kernel-sdk · vendor/chatgoose-hotkeys   генерируются скриптами хаба, руками не правим
  tools/release · tools/host-contract-check · tools/size-budget · tools/perf · tools/archive-check
  site/                           установка, «Как начать», «Что нового», история, руководство
  docs/                           architecture.md, host-contract.md, error-registry.md, contracts-changelog.md
```

**Версии** (npm на 03.10.2026; точные версии закрепляет первый lockfile после спайка M0):

| Инструмент | Версия | Примечание |
|---|---|---|
| Node | 26 (у владельца 26.7.0) | откат — Node 24 LTS, если что-то падает в спайке |
| pnpm | 10.33.1 через `packageManager` | как во всей семье (`hub`, `fansly-chat`, `ci-runners`) |
| corepack | не используем | Node 26 поставляется без corepack (на Mac владельца `corepack` нет). pnpm 10.33.1 ставится явно: в CI — `pnpm/action-setup` или `npm i -g pnpm@10.33.1` (R19); pnpm 10+ сам переключается на версию из `packageManager` |
| TypeScript | 6.0.3 | новейшая, которую принимает линтер: `typescript-eslint` 8.71.0 требует `<6.1.0`. TS 7.0.2 — когда линтер его поддержит |
| WXT | 0.21.4 | `wxt build -b firefox --mv3` |
| Vite | 8.3.2 | |
| Preact | 11.0.0 | откат — 10.29.8 |
| `@preact/signals` | 2.11.3 | |
| zod | 4.6.5 | |
| Vitest | 5.0.3 | + happy-dom 20.14.5, fake-indexeddb 6.2.5 |
| ESLint | 10.12.0 | + typescript-eslint 8.71.0 |
| dependency-cruiser | 18.5.0 | |
| web-ext | 10.7.0 | lint и подпись |
| WebdriverIO | 9.32.0 (`@wdio/cli` 9.32.0) | сам скачивает geckodriver; `installAddOn(xpi, true)` ставит временное дополнение |

**Спайк M0 проверяет до основной работы:**
1. Node 26 тянет все инструменты: сборку WXT, Vitest, ESLint, dependency-cruiser,
   `web-ext lint` и пробную подпись, WebdriverIO с geckodriver. Что-то падает —
   откат на Node 24 и запись причины.
2. Preact 11 в закрытом Shadow DOM на стенде:
   - док и список на 1000 строк;
   - фокус и IME;
   - бюджеты §11.

   Не прошло — Preact 10.29.8. Код UI пишется на общем подмножестве 10 и 11:
   функциональные компоненты и хуки; без `preact/compat`, `defaultProps`, legacy
   context и классов.
3. Ленивый ESM-чанк content script грузится в Firefox MV3, CSP не мешает, старая
   вкладка после обновления расширения ведёт себя предсказуемо.
4. MAIN-скрипт на `document_start` и динамическая регистрация MAIN-скрипта через
   `scripting.registerContentScripts`.

**`tsconfig.base.json`:** `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`.

**`pnpm check`** (локально перед Ready и в CI):
1. `typecheck` — `tsc -b`.
2. `lint` — ESLint и dependency-cruiser: граф пакетов §4, запрещённые глобалы.
3. `test` — Vitest.
4. `build` — WXT и ленивые чанки.
5. `webext-lint` — `web-ext lint --self-hosted`.
6. `size` — бюджеты §11.
7. `gates` — инварианты:
   - нет обращений к `onlymonster.ai` в нашем коде;
   - нет `innerHTML` с данными;
   - нет `browser.` вне `platform`;
   - нет ключей и слов token/key/API/bearer в текстах UI (AU-019);
   - мост MAIN ссылается на `enqueue` только из порта отправки.
8. `parity` — машинный манифест паритета: у каждой строки есть владелец и проверка.
9. `archive-check` — в собранном XPI и архиве исходников для подписи нет кода, CSS,
   шрифтов и картинок OnlyMonster и нет реальных сообщений.

E2e — отдельная команда `pnpm e2e` (в CI — отдельная джоба).

**Манифест.**
- **gecko:** id `chat-extension@gosling.agency`, `strict_min_version: "142.0"`,
  `update_url: https://ext.gosling-agency.ru/chat-extension/firefox/updates.json`.
- **`data_collection_permissions`:**
  - `required`: `authenticationInfo`, `personallyIdentifyingInfo`,
    `personalCommunications`, `financialAndPaymentInfo`, `websiteContent` (как у Fansly,
    `fansly-chat/manifest.json:92-100`);
  - `optional`: `technicalAndInteraction` — под `ai_acceptance` и `client_health`. По
    правилам Firefox этот тип может быть только необязательным.
- **`permissions`:** `storage`, `alarms`, `scripting` (выключатель тапа WS).
  - `tabs` не нужен: вкладки известны по портам, `tabs.update(id, {active})` работает без
    этого права.
  - `unlimitedStorage` не нужен: у всех хранилищ пределы (§9.4).
  - `downloads` не нужен: выгрузка — через Blob со страницы расширения.
- **`host_permissions`:** `https://chat.onlymonster.ai/*` и `https://gosling-agency.ru/*`.
  - Онбординг проверяет `permissions.contains` и просит недостающее.
  - Нестандартный адрес хаба — `optional_host_permissions` `https://*/*`, запрос по
    жесту при сохранении адреса.
- **`content_scripts`:** два скрипта на `https://chat.onlymonster.ai/*`, `all_frames: false`.
  Третий — тап WS — фон регистрирует динамически (§6.8).
- **`web_accessible_resources`:** только ленивые чанки и их CSS, тот же адрес. С R20 F2b у каждого сайта своя
  сборка (`lazy/chatspace/…`) и своя запись — для страниц этого сайта.
- **Страницы:** `action` → popup, `options_ui` с `open_in_tab`. CSP по умолчанию, без
  `eval` и удалённого кода.

## 4. Пакеты и границы

| Пакет | Отвечает за | Может импортировать | Пакет работ |
|---|---|---|---|
| `contracts` | идентичности, HostPort и порт отправки, протоколы мостов, модель операций, модели видов и действия UI, настройки, реестр CG, телеметрия, логи, фасад хаба | только `zod` | R01 |
| `core/domain` | чистые модели и правила | `contracts`, вендоренный движок хоткеев | R10–R12, R17, R18 |
| `core/services` | службы фона поверх портов (`HubFacade`, хранилища, аудио, часы) | `contracts`, `core/domain` | R10, R17, R18 |
| `core/application` | контроллеры: состояние поверхностей → модели видов; зависят только от портов | `contracts`, `core/domain` | R11, R12, R16, R17 |
| `platform` | `storage`, `messaging` (типизированный RPC поверх портов), `alarms`, `permissions`, `idb`, `audio`, `clipboard`, `scripting`, `env`, `download` (Blob) | `contracts` | R07 |
| `hub` | клиент SDK, опека входа, bootstrap, каталог, поток AI, рекапы, Spenders, статистика, лента, «Новые» и бронь, телеметрия | `contracts`, `core`, `platform`, `vendor/kernel-sdk` | R08 |
| `host-chatspace/main` | мост MAIN, тап WS, порт отправки, наблюдатель квитанции | ничего (самодостаточен) | R09 |
| `host-chatspace/isolated` | клиент моста, HostPort, проверка контракта, монтирование, вставка, навигация | `contracts`, `core/domain/text` | R09 |
| `ui` | поверхности Preact; `ui/kit` — основа | `contracts`, `ui/kit` | R13–R16 |
| `testing` | стенд-хост, поддельный хаб, e2e, формы данных | всё | R02 |
| `apps/extension` | точки входа, манифест, корни композиции | всё, но только для сборки зависимостей | R00 |

**Правила:**
- `core` не импортирует DOM, `browser.*`, `fetch`, Preact и SDK.
- `ui` не импортирует `host-*`, `platform`, `hub`. Данные — только через `AppClient`
  (§10.2).
- `host-chatspace` не получает токен хаба и не ходит в сеть.
- `hub` используется только в фоне.
- Мост MAIN собирается отдельным самодостаточным бандлом.
- Наружу пакет отдаёт только поле `exports`, глубокие импорты запрещены. Проверка
  циклов обязательна.
- Нарушение — красный `lint`: `no-restricted-imports`, правила dependency-cruiser,
  `no-restricted-globals` (`browser`, `chrome`, `fetch`, `XMLHttpRequest`, `WebSocket`,
  `localStorage`) в `core` и `ui`.
- Корневые конфиги, точки входа и корни композиции правит один владелец (R00).
- Пакеты не публикуются и не версионируются по отдельности. Исходники собирает WXT/Vite.

## 5. Общие интерфейсы (замораживает R01 до параллельной работы)

Ниже — обязательная часть. Полные схемы zod и фикстуры (по одной верной и одной
неверной на каждый тип) пишет R01. Поменять имя или смысл можно только через PR с
меткой `contract-change`, его одобряют владельцы пакетов-потребителей.
- Новое поле — минорная версия `contracts`.
- Новый смысл — мажорная версия с периодом совместимости.
- Журнал изменений — `docs/contracts-changelog.md`.
- Тип `unknown` пересекает границу только до проверки схемой.

### 5.1 Идентичности

```ts
export type HostKind = 'chatspace' | 'fansly-web';
export type Platform = 'onlyfans' | 'fansly';
/** Числовые id платформы и хоста — всегда строки; Number() к ним не применяем. */
export type NativeId = string;
/** ChatSpace: id аккаунта OM + id фана OF. В ChatSpace chatId маршрута = id фана OF = fanRef хаба. */
export interface ChatRef { readonly host: HostKind; readonly hostAccountId: NativeId; readonly platformFanId: NativeId }
export type ChatKey = `${HostKind}:${string}:${string}`;
export interface HostAccount { host: HostKind; hostAccountId: NativeId; platform: Platform;
  platformAccountId: NativeId | null;          // единственный ключ привязки к странице хаба
  username: string | null; displayName: string | null }   // только для показа
export interface SessionIdentity { hubOrigin: string; userId: number; login: string;
  role: 'owner' | 'team_lead' | 'chatter'; epoch: number /* растёт на каждый вход и выход */ }
export interface HubBinding { hubOrigin: string; principalId: number; loginEpoch: number; platform: Platform;
  platformAccountId: NativeId; pageId: number; pageLabel: string; bindingRevision: number }
export interface Target { binding: HubBinding; chat: ChatRef; fanRef: NativeId; conversationRef: NativeId }
/** Неизменяемая идентичность генерации: смена активного чата её не перепривязывает. */
export interface GenerationIdentity { target: Target; feature: FeatureId; personaKey: string;
  personaDefinitionId: string; operationId: string; clientRequestId: string; tabSessionId: string;
  requestDigest: string }   // хеш всех параметров запроса: окно, тон, Split, черновик Fix, голова архива
export interface HostIdentity { host: HostKind; documentEpoch: string; hostLoginEpoch: string;
  hostAccountId: NativeId; platformAccountId: NativeId; chat: ChatRef | null;
  routeEpoch: number; composerInstanceId: string | null }
export interface DraftSnapshot { identity: HostIdentity; revision: number; plainText: string;
  provenance: 'empty' | 'our-insert' | 'human-or-unknown';
  digest: string /* отпечаток полного документа Tiptap, а не только текста; только локально */ }
/** Разрешение на запись: одноразовый токен, который фон выдал по доверенному событию нашего UI. */
export interface HumanCause { kind: 'click' | 'key'; actionToken: string }
```

`tabSessionId` выдаёт фон при регистрации документа вкладки. Он сверяет его с
`sender.tab.id`, `frameId === 0` и id документа. Вкладка не может назначить себе чужой.

### 5.2 Порт хоста

```ts
export interface HostPort {
  readonly kind: HostKind; readonly platform: Platform;
  probe(): HostContractReport;                 onContract(cb: (r: HostContractReport) => void): Unsubscribe;
  current(): HostSnapshot;                     subscribe(cb: (e: HostEvent) => void): Unsubscribe;
  // только память страницы; сети нет никогда
  readDraft(expected: HostIdentity): Promise<DraftSnapshot>;
  readVisibleTail(expected: HostIdentity, max: number): Promise<LiveTextTail | null>;   // свежий текст, D-14
  chatWindow(chat: ChatRef, max: number): ChatWindow | null;   // предпроверки открытого чата
  fan(chat: ChatRef): HostFan | null;                          // только украшение, если уже в памяти
  listCachedChats(hostAccountId: NativeId, limit: number): readonly NavigationItem[];   // ничего не грузит
  listCachedAccounts(): readonly HostAccount[];
  insert(intent: InsertIntent): Promise<InsertReceipt>;
  focusComposer(expected: HostIdentity): Promise<boolean>;
  navigate(intent: NavigationIntent): Promise<NavigationReceipt>;    // только по действию человека
  checkpoint(chat: ChatRef): FreshnessCheckpoint;                    // снимок счётчиков свежести, §6.7
  mounts(): MountPoints;                       onMounts(cb: (m: MountPoints) => void): Unsubscribe;
  theme(): HostTheme;                          onTheme(cb: (t: HostTheme) => void): Unsubscribe;
  readonly previewSend: PreviewSendPort | null;   // X8; null, если возможность выключена
  dispose(): void;
}
// В порте нет и не будет: fetchHistory(), markRead(), setStore(), общего send(), произвольного execute().

export type HostCapability = 'identity' | 'route' | 'accounts' | 'dockMount' | 'insert' | 'draftRead'
  | 'chatWindow' | 'freshText' | 'fan' | 'chatList' | 'sendObserve' | 'incoming' | 'navigate'
  | 'theme' | 'previewSend' | 'receipt';
export interface CapabilityState { state: 'on' | 'degraded' | 'off' | 'contractBroken'; reason?: string }
export interface HostContractReport { build: string | null /* 'index-DEVowLko' */; adapterVersion: string;
  checkedAt: number; anchors: Record<AnchorId, 'ok' | 'missing' | 'shape' | 'notYet' /* 1.10.0 */>;
  capabilities: Record<HostCapability, CapabilityState> }
export interface RouteState { epoch: number; name: 'chat' | 'accounts-overview' | 'other';
  account: HostAccount | null; chat: ChatRef | null }
export interface ComposerState { chat: ChatRef; instanceId: string; ready: boolean;
  hidden: boolean /* фан заблокирован */; draft: { revision: number; provenance: DraftSnapshot['provenance'] } }

export interface PartRef { variant?: number; index: number }
/** Намерение вставки. MAIN проверяет всё это в одном синхронном шаге прямо перед записью. */
export interface InsertIntent {
  intentId: string; operationId: string; part: PartRef; target: ChatRef;
  expected: { documentEpoch: string; routeEpoch: number | null /* null — отложенная вставка */;
    composerInstanceId: string | null; draftRevision: number; draftDigest: string };
  mode: 'replace' | 'append'; text: string;       // простой текст; мост ChatSpace сам экранирует
  confirmationId: string | null;                  // одноразовое согласие на эту ревизию (Б2)
  createdAt: number; expiresAt: number;
}
export type InsertReceipt =
  | { state: 'applied'; draftRevision: number; draftDigest: string; ms: number }
  | { state: 'rejected'; code: CgCode; needs?: 'confirm-human-draft' | 'confirm-changed-draft' }
  | { state: 'uncertain'; code: CgCode };          // повторно не вставляем; только чтение для сверки
export interface NavigationIntent { intentId: string; cause: HumanCause;
  target: { hostAccountId: NativeId; platformFanId: NativeId | null };
  thenInsert?: InsertIntent }                       // «Открыть и вставить»
export interface LiveTextTail { messages: Array<{ platformMessageId: NativeId /* ^\d+$ */;
  direction: 'fan' | 'model'; sentAt: string; text: string /* plain */ }> }

/** X8, §6.7 */
export interface FreshnessCheckpoint { documentEpoch: string; socketEpoch: number; subscriptionEpoch: number;
  hostAccountId: NativeId; platformFanId: NativeId; fanSequence: number;
  lastFanMessageId: NativeId | null; observedAt: number; coverage: 'ok' | 'unknown' }
export interface PreviewSendPort {
  preflight(req: PreviewSendRequest): PreviewSendPreflight;      // без побочных эффектов; причина для кнопки
  commit(req: PreviewSendRequest, ticket: DispatchTicket): Promise<PreviewSendCommit>;   // ровно один enqueue
  onState(attemptId: string, cb: (v: SendAttemptView) => void): Unsubscribe;
}
export interface PreviewSendRequest { attemptId: string; target: Target; generationRef: string; part: PartRef;
  previewRevision: number; plainText: string; isAiGenerated: boolean;
  checkpoint: FreshnessCheckpoint; cause: HumanCause }
export interface DispatchTicket { attemptId: string; ticket: string /* одноразовый, от хаба */; expiresAt: number }
export type SendAttemptState = 'ready' | 'preparing' | 'held' | 'notEnqueued' | 'nativeEnqueued'
  | 'nativeAccepted' | 'sentObserved' | 'rejected' | 'uncertain';
export interface SendAttemptView { attemptId: string; state: SendAttemptState; code?: CgCode;
  platformMessageId?: NativeId; detail?: { guardTopics?: string[]; upstream?: string } }
```

### 5.3 Мост MAIN ↔ изолированный мир

**Рукопожатие.**
1. MAIN на старте шлёт `window.postMessage({tag: 'main-ready', v})` и слушает `iso-hello`.
2. Изолированный скрипт шлёт `iso-hello` и слушает `main-ready`.
3. Кто бы ни пришёл вторым, изолированный создаёт `MessageChannel` и передаёт `port2`
   с `{tag: 'connect', v, nonce}`.
4. MAIN принимает только первый корректный `connect` и снимает слушатель `window`.
   Нативные функции (`postMessage`, `JSON`, `Reflect` и др.) он запоминает при загрузке.

Порт — канал маршрутизации, а не удостоверение. Страница видит MAIN и может слать ему
что угодно, поэтому изолированный мир проверяет всё, что приходит из MAIN.

**Конверт:** `{v: 1, kind: 'req' | 'res' | 'evt', id, t, documentEpoch, seq, payload}`.
`seq` растёт в пределах документа. Повтор запроса с тем же `id` на запись распознаётся
и не исполняется второй раз.

**Пределы:**
- кадр ≤ 256 КиБ, строка ≤ 20 000 символов, снимок ≤ 200 сообщений;
- события для UI — не чаще 50 в секунду, лишние склеиваются;
- события свежести и квитанций не отбрасываются никогда. Их счётчики MAIN обновляет
  до любого прореживания. Если что-то потерялось, покрытие становится `unknown`;
- неизвестный `t`, лишние поля, небезопасные id — отказ и счётчик;
- `null` в ответе, который схема допускает (`fan`, `chatWindow`, `readTail`: «у ChatSpace
  этого пока нет»), — ответ, а не сломанный кадр: его хранят, как любой другой;
- обычный вызов ждёт ответа 2 с, навигация с вставкой — до `limits.navInsertTimeoutSec`
  (по умолчанию 20 с).

**Чтения памяти страницы** (`chatWindow`, `fan`, списки) `HostPort` держит в кэше. Ответ —
и `null`, и неудача — стоит, пока состояние MAIN могло не измениться: синхронный геттер
второй раз MAIN не спрашивает, спрашивает событие (`route`, `chatCache`, смена
контракта). Серия одинаковых неудач одного чтения пишется в лог один раз — и ещё на 10-й,
100-й… раз с числом повторов (`repeats`), — а её конец одной записью `read-recovered`.
Чтение названо полем `requestKind` (имя запроса моста, не текст).

```ts
type ToMain =
  | { t: 'probe' } | { t: 'snapshot' }
  | { t: 'readDraft'; expected: HostIdentity } | { t: 'readTail'; expected: HostIdentity; max: number }
  | { t: 'chatWindow'; acc: NativeId; fan: NativeId; max: number } | { t: 'fan'; acc: NativeId; fan: NativeId }
  | { t: 'listChats'; acc: NativeId; limit: number } | { t: 'listAccounts' }
  | { t: 'insertGuarded'; intent: InsertIntent }
  | { t: 'focus'; expected: HostIdentity }
  | { t: 'navigate'; intent: NavigationIntent }
  | { t: 'checkpoint'; acc: NativeId; fan: NativeId }
  | { t: 'previewSendPreflight'; req: PreviewSendRequest }
  | { t: 'previewSendCommit'; req: PreviewSendRequest; ticket: DispatchTicket }
  | { t: 'flags'; wsTap: boolean; previewSend: boolean };
type FromMain =
  | { t: 'res'; id: number; ok: true; data: unknown } | { t: 'res'; id: number; ok: false; err: string }
  | { t: 'route'; route: RouteWire } | { t: 'accounts' } | { t: 'composer'; state: ComposerWire }
  | { t: 'chatCache'; acc: NativeId; fan: NativeId }            // кэш открытого чата изменился
  | { t: 'contract'; missing: string[] }
  | { t: 'incoming'; acc: NativeId; fan: NativeId; msgId: NativeId; fromFan: boolean; automatic: boolean;
      tip: boolean; sentAt: string | null; socketEpoch: number; fanSequence: number }   // без текста
  | { t: 'coverage'; acc: NativeId; state: 'ok' | 'unknown'; reason: string }
  | { t: 'humanSend'; acc: NativeId; fan: NativeId; pendingId: string;
      platformMessageId: NativeId | null; textDigest: string }   // отправка человеком из поля ввода
  | { t: 'previewSendState'; view: SendAttemptView }
  | { t: 'fault'; source: string; count: number };   // сбой нашего кода, пойманный guard (X22)
```

Текст входящих сообщений из MAIN не уходит: для звука и свежести хватает id,
направления, аккаунта, чата и времени.

**Правила MAIN-мира (решение X22).** MAIN исполняется в мире страницы. Всё, что наш код
там делает, страница видит своими средствами, а с ChatSpace 0.195.0 — и своей телеметрией:
в странице работает Sentry (публичный SDK 10.45.0 через `@sentry/vue`). Он ставит
глобальные обработчики `error` и `unhandledrejection`, оборачивает таймеры и
`addEventListener`, пишет «хлебные крошки» — строки консоли, клики, `fetch`, переходы — и
отправляет их с каждой своей ошибкой. Фильтров по адресу (`denyUrls`), `beforeSend`, Replay
и трассировки нет. Отсюда правила:
1. **Ни одно исключение нашего кода не уходит в страницу.** Каждый колбэк, который
   вызывает страница или браузер, идёт через `guard(site, fn)` (`main/guard.ts`):
   `afterEach` роутера, плагин Pinia, `$onAction` и `$subscribe` сторов с их `after` и
   `onError`, слушатели Tiptap, `input`, `message` и `close` сокета, `DOMContentLoaded`,
   MutationObserver, таймеры и кадры. Загрузчик (`bridge.ts`) защищает по построению то, что
   одалживает рантайму: `setTimer`, `frame`, сборщик события `emit`, отправку в порт.
   Обещание нашего кода всегда с последним `catch` или `then` с обработчиком отказа,
   который сам не бросает.
   - Сбой не пробрасывается и не пишется в консоль. Он считается по месту и уходит
     изолированной стороне событием `fault`, когда счёт места доходит до 1, 2, 4, 8…
     Скрипт тапа отдаёт свои сбои в тот же счёт через живой порт; до подключения порта
     они только отбрасываются.
   - Изолированная сторона пишет запись `tab.host` `main-fault` с кодом `CG-UNKNOWN` и
     полями `source`, `count`, когда счёт места хотя бы удвоился. Мест в документе — не
     больше 64: страница может подделать событие, но не завалить лог.
   - **Чужие ошибки проходят как есть.** Под guard только наш код. Прежний `fetch` за
     наблюдателем квитанции и конструктор `WebSocket` за тапом вызываются вне guard: что
     они бросают или чем отклоняются, доходит до ChatSpace тем же значением, нашим сбоем
     не считается.
   - Зачем: такое исключение попало бы в Sentry ChatSpace новой группой ошибок. А где
     ChatSpace зовёт нас внутри своей работы — создание стора, действие, сброс при выходе,
     переход роутера, транзакция редактора, — оно бы эту работу и сорвало.
2. **Никакой консоли и `debugger`** — ни в исходниках MAIN (ESLint `no-console`), ни в
   собранных бандлах MAIN (гейт `main-world-bundle`). Строка консоли стала бы крошкой и
   ушла бы с ближайшей ошибкой ChatSpace.
3. **Без обёртки входа WXT.** WXT оборачивает `main()` точки входа в `try`, который пишет
   в свой логгер и пробрасывает ошибку в страницу. Скрипты MAIN собираются без неё
   (`apps/extension/build/main-world-entry.ts`), а каждая точка входа сама держит свой сбой
   установки. Гейт `main-world-bundle` падает, если обёртка вернётся. Заодно это −170 Б
   gzip на каждый бандл MAIN.
4. **Имена, которые видит страница, нейтральны** и не называют расширение:
   - хосты — `div` без id, class, aria-label, title, name, type, alt и `data-sentry-*`;
     их атрибуты — `data-host` (`dock`/`overlay`), `data-mode`, `data-layer`,
     `data-pending`, `data-scheme`, свой `data-dismissible-open` у ChatSpace, `aria-busy`
     и `style` (закреплено тестом `mount.dom.test.ts` и e2e `sentry-gate`);
   - глобал тапа — `Symbol.for('wsTap')`, ключ рукопожатия — `tag`.
   Внутри закрытых корней (`data-cg-*`, `.cg-*`) всё по-прежнему: страница их не видит.
5. **Гейты.** `pnpm gates` (`main-world-guard`) проверяет, что колбэк для страницы или
   браузера в `host-chatspace/src/main` — вызов `guard(…)` или `const`, связанный с ним.
   ESLint запрещает там `void` вместо обработки обещания (`no-floating-promises` с
   `ignoreVoid: false`). Юнит-тесты внедряют сбой в каждый такой колбэк
   (`main/faults.dom.test.ts`, `main/faults-tap.test.ts`). E2e `sentry-gate` поднимает на
   стенде тот же Sentry, что у ChatSpace, с коллектором на loopback.

**Что Sentry ChatSpace видит и что мы принимаем.**
- Клик в нашем интерфейсе — крошка `ui.click`, у которой цель — наш хост, голый `div`.
  Для дока это путь вида `div.relative > div`, для оверлея — `html > div`. Все клики в
  закрытом корне — клики по одному и тому же хосту, и Sentry склеивает повторы за
  секунду. Нажатия клавиш в наших полях крошек не дают: хост не текстовое поле.
- Последовательности крошек выдают нас тому, кто их читает: `ui.click: div` → переход —
  это «Открыть чат»; `ui.click: div` → `POST` сообщения в неоткрытый чат без ввода в поле
  ChatSpace — это X8. Они уходят, только если ChatSpace пошлёт свою ошибку, пока они в
  буфере из 100 крошек.
- Каждое событие несёт адрес страницы, то есть аккаунт и чат, а также `Referer` и
  `User-Agent`.
- **Firefox (проверено на стенде, e2e `sentry-gate`).** Кадры стека скриптов MAIN
  расширения страница видит как `<anonymous code>:строка:колонка`, без
  `moz-extension://<uuid>/…`. Вне guard ошибка такого скрипта доходит до `onerror` страницы
  целиком, а не как `Script error.`: сообщение, `filename: "<anonymous code>"`, объект
  ошибки. Разборщик стека Sentry такие кадры отбрасывает: в событии остаются только кадры
  страницы вокруг, но само событие с нашим текстом уходит. Нативная ошибка через наш
  `Proxy` (`new WebSocket('ftp://…')`) несёт в стеке кадр `construct@<anonymous code>`;
  в событии Sentry его тоже нет.
- Скрывать расширение от Sentry мы не пытаемся: не трогаем его настройки, не фильтруем
  его события и не глушим клики. Мы только не бросаем в страницу ничего своего. За тем,
  не появились ли в новой сборке ChatSpace Replay, трассировка, новые интеграции и опции
  или поиск расширений, следит `tools/host-contract-check` (сигналы телеметрии, §12 п. 3).

### 5.4 Протокол вкладки и страниц с фоном

Вкладка держит один `runtime.Port` `cg-tab` на всё время жизни. Конверт —
`{v: 1, kind: 'req' | 'res' | 'evt', id?, type, payload}`, у каждого `type` своя схема zod.

**Фон проверяет отправителя:**
- `sender.id === runtime.id`, `sender.frameId === 0`;
- для вкладок — `origin === 'https://chat.onlymonster.ai'` и зарегистрированный
  `tabSessionId`;
- для страниц — `moz-extension://<свой uuid>/` из списка разрешённых страниц.

**Запросы:**
- **вход и bootstrap:** `session.get`, `session.signIn`, `session.signOut`, `bootstrap.get`,
  `binding.resolve(account)`, `catalog.get`, `persona.set(pageId, key)`;
- **операции:** `op.start(StartOp)` → `Admission`, `op.cancel(opId)`, `op.list(filter)`,
  `op.reportInsert`, `op.reportCopy`, `op.reportSent`;
- **отправка из превью:** `send.begin(attempt)` → разрешение хаба или отказ,
  `send.status(attemptId)`, `send.report(view)`, `send.list(pageId, fanRef)` — попытки
  этому фану, которые знает фон (после перезагрузки вкладки, §6.7.8);
- **рекапы:** `recap.status(target)`, `recap.read(target)`;
- **данные хаба:** `spenders.board`, `spenders.stats`, `spenders.queue`, `feed.read`,
  `fan.card`, `newcomers.list`, `newcomers.claim`;
- **служебное:** `settings.get`, `settings.patch` → подтверждение с ревизией,
  `log.write(records)`, `diagnostics.get`, `diagnostics.export`, `sound.event`,
  `sound.preview`, `debug.prompt(token)`, `health.report(tabHealth)`, `token.issue(kind)`
  (одноразовые `actionToken`).

**События от фона:** `op.update` (пачки текста по 50 мс), `op.done`, `send.state`, `toast`,
`settings.changed`, `session.changed`, `bootstrap.changed`, `catalog.changed`,
`newcomers.changed`, `flags.changed`.

### 5.5 Операции

```ts
export type FeatureId = 'reply' | 'fix' | 'hi' | 'ping' | 'review' | 'recap' | 'recap-short' | 'coach';
export type Surface = 'dock' | 'preview' | 'newcomers' | 'coach' | 'overlay';
export type OpState = 'admitted' | 'requesting' | 'streaming' | 'done' | 'failed' | 'canceled' | 'interrupted';
export interface StartOp {
  feature: FeatureId; surface: Surface; target: Target; cause: HumanCause;
  tone: Tone | null;              // X45: держится в чате до смены чата («Помнить тон в чате»), выкл. — разовый (Б1); Regenerate передаёт тон оригинала
  split: boolean;                 // Б7: снимок настройки на момент запуска
  window: number;                 // Б5: messageCount
  draft?: { text: string; revision: number; digest: string };   // Fix, «приложить мой ответ» в Coach
  variantCount?: 1 | 3;           // Hi в доке — 3, «Новые» — 1
  coach?: { question?: string; preset?: 'situation'; history: CoachTurn[]; attachDraft?: string };
  fresh?: LiveTextTail;           // только reply | fix | hi | ping на surface 'dock' при флаге freshText
  checkpoint?: FreshnessCheckpoint;   // превью: снимок свежести на клике Generate (X8)
  regenerateOf?: string; force?: boolean;
}
export type Admission =
  | { ok: true; opId: string }
  | { ok: false; code: 'CG-OP-CHAT-BUSY' | 'CG-OP-TAB-LIMIT'; active: ActiveOpSummary[] };   // список для отказа
export interface OpView { opId: string; feature: FeatureId; surface: Surface; target: Target; state: OpState;
  phase: Phase; startedAt: number; firstChunkAt?: number; endedAt?: number;
  text?: string;                  // накопленный поток
  result?: OpResult; error?: CgErrorView; generationRef?: string;
  servedContext?: { source: 'archive' | 'union' | 'live-overlay';            // из context_v1: снимок,
    servedHead: { messageRef: NativeId; at: string } | null;                  // который реально
    knownFanMessage?: { id: NativeId; state: 'included' | 'absent' | 'deleted' | 'unknown' } } | null;   // обслужил генерацию
  stale?: { reason: 'fan-wrote' | 'archive-moved'; at: string | null };
  debug?: OpDebugView }           // только при debug.enabled
export type OpResult =
  | { kind: 'parts'; parts: string[]; splitRequested: boolean }       // Reply, Fix, Ping
  | { kind: 'variants'; variants: string[][] }                       // Hi: варианты, в каждом части
  | { kind: 'review'; doc: ReviewDoc | null; raw: string }
  | { kind: 'recap'; markdown: string; coverage: Coverage | null; shared: { generationRef: string } }
  | { kind: 'coach'; answer: CoachAnswer };                          // текст + черновики, каждый — части
```

### 5.6 Настройки (ключ `settings`, схема v1)

```ts
export interface SettingsV1 {
  schemaVersion: 1;
  hub: { baseUrl: string };                              // по умолчанию https://gosling-agency.ru
  ui: { theme: 'host' | 'system' | 'light' | 'dark'; locale: 'system' | 'ru' | 'en'; hints: boolean };
  generation: { split: boolean;
    windows: { quick: number; ping: number; improve: number; deep: number };   // 100/100/25/3000, Б5
    coach: { historyLimit: number /* 1–20, по умолчанию 10 */; autoRecap: 'off' | 'short' | 'full' } };
  sound: { messages: { on: boolean; tone: ToneId }; subscribers: { on: boolean; tone: ToneId };
    volume: number /* 5–100 */; mutedAccounts: NativeId[] };
  personas: { byPageId: Record<string, { key: string; definitionId: string }> };
  accounts: { labels: Record<NativeId, string> };        // локальные подписи до 60 символов
  debug: { enabled: boolean; renderTrace: boolean };
  onboarding: { checklistDismissed: boolean; lastSeenVersion: string | null };
}
```

**Отдельные ключи `storage.local`:**
- вход: `auth.token`, `auth.meta`;
- кэши: `cache.bootstrap`, `cache.catalog`;
- работа: `presence`, `telemetry.queue`, `send.journal` (журнал попыток X8, без текста),
  `newcomers.drafts`;
- вне замороженного списка `STORAGE_KEYS` (ключи одного фона, `LOCAL_KEYS` в
  `core/domain/storage`): `send.native` (ручные отправки, которые хаб ещё не принял,
  только id) и `log.counters` (счётчики ошибок за сегодня и за предыдущий день, §9.2).

Логи лежат в IndexedDB `cg-logs`. Журнал операций и результаты лежат в `storage.session`.

### 5.7 Ошибки, телеметрия, логи

```ts
export interface CgEntry { code: CgCode; kind: string; severity: 'info' | 'warn' | 'error';
  title: I18nKey; body: I18nKey;
  recovery: 'none' | 'retry' | 'new-generation' | 'wait-until' | 'sign-in' | 'open-settings'
    | 'reload-tab' | 'update-extension' | 'open-chat' | 'contact-owner';
  retry: 'safe-read' | 'new-click' | 'after-deadline' | 'never';   // что вообще можно повторить
  telemetry: 'count' | 'count+sample' | 'p1';
  settings?: SettingsRoute; retired?: { at: string; reason: string } }
export interface CgErrorView { code: CgCode; title: string; body: string;
  detail?: string /* «HTTP 429 • …», до 400 символов */; retryAt?: number; settings?: SettingsRoute }
export interface AcceptanceEvent { clientEventId: string; kind: 'ai_acceptance'; observedAt: string; pageLabel: string;
  payload: { generationRef: string; lifecycle: 'shown' | 'copied' | 'inserted' | 'sent'; edited?: boolean;
    opId: string; feature: FeatureId; surface: Surface; part?: number; variant?: number;
    via?: 'composer' | 'preview'; attemptId?: string; platformMessageId?: NativeId } }
export interface ClientHealthV1 { kind: 'client_health'; v: 1; window: { from: string; to: string };
  client: { name: 'chat-extension'; version: string; browser: 'firefox'; browserMajor: number;
    os: 'windows' | 'macos' | 'linux' | 'other' };
  host: { kind: HostKind; build: string | null; contractOk: boolean; missing: string[] };
  disabled: string[];                                   // выключено флагами или контрактом
  perf: PerfHistogram[];                                // гистограммы, процентили считает сервер
  counters: Record<string, number>;                     // ошибки по коду, предотвращённые вставки, P1
  footprint: { kind: 'owned-estimate'; cachesKB: number; logsKB: number } }   // не heap
export interface PerfHistogram { metric: PerfMetric; unit: 'ms'; schemaVersion: 1;
  bounds: number[]; counts: number[]; count: number; sum: number; max: number }
export type PerfMetric = 'panelOpenMs' | 'insertMs' | 'ttfcMs' | 'firstChunkPaintMs' | 'routeToDockMs'
  | 'handlerMs' | 'boardOpenMs' | 'searchMs' | 'eventLatencyMs';
export interface LogRecord { ts: string; seq: number; level: 'debug' | 'info' | 'warn' | 'error';
  scope: string; msg: string; code?: CgCode; fields?: Record<string, unknown>;
  ctx?: { tabSessionId?: string; opId?: string; attemptId?: string; chatKey?: ChatKey; routeEpoch?: number; session?: number } }
```

### 5.8 Фасад хаба (только фон)

```ts
export interface HubFacade {
  signIn(login: string, password: string): Promise<SessionIdentity>; signOut(): Promise<SignOutOutcome>;
  session(): SessionIdentity | null; health(): Promise<HubHealth /* contractHash, compatibleClientSdks */>;
  bootstrap(opts?: { force?: boolean; ifRevision?: number }): Promise<Bootstrap>;   // H-2
  catalog(): Promise<PersonaCatalog>;
  stream(op: HubStreamRequest, sink: (f: HubFrame) => void, signal: AbortSignal): Promise<void>;
  recapStatus(q: RecapStatusQuery): Promise<RecapStatus>;
  recaps(pageLabel: string, fanRef: NativeId, personaDefinitionId: string): Promise<SharedRecaps>;   // H-13
  dossier(pageLabel: string, fanRef: NativeId): Promise<Dossier | null>;
  profileFromGeneration(generationRef: string): Promise<'saved' | 'not-ready' | 'rejected'>;      // H-5
  spenders(q: SpendersQuery): Promise<SpendersPage>; spenderDetail(q: SpenderDetailQuery): Promise<SpenderDetail>;
  spenderBatch(q: SpenderBatchQuery): Promise<SpenderBatch>; autoLists(pageLabel: string): Promise<AutoLists>;
  spendersStats(q: StatsQuery): Promise<SpendersStats>;              // H-8
  awaitingReply(q: QueueQuery): Promise<QueuePage>;                  // H-8
  feed(q: FeedQuery): Promise<FeedPage>;                             // H-9
  audienceNew(pageLabel: string, cursor: string | null): Promise<AudienceNewPage>;   // H-7
  claim(op: ClaimOp): Promise<ClaimState>;   // H-7: бронь claim|renew|release; опека части dispatch|sent|failed|resolve; registerNativeSend
  claimStatus(pageLabel: string, fanRef: NativeId): Promise<ClaimState>;
  ingest(events: readonly (AcceptanceEvent | ClientHealthV1)[]): Promise<IngestResult>;
  aiUsage?(q: { pageLabel: string; date: string }): Promise<AiUsageDay>;   // H-16, только отладка
}
```

Модели видов и `AppClient` для UI — §10.2.

## 6. Хост ChatSpace

### 6.1 Что читает мост и как

| Объект | Как достаём | Зачем |
|---|---|---|
| приложение | `document.querySelector('#app')?.__vue_app__` (`runtime-dom.esm-bundler-B8T0cb7A.js:2993`). После `DOMContentLoaded` ищем раз в 100 мс до 15 с, потом раз в 2 с до 60 с. Не нашли — `CG-HOST-NOT-READY`, бесконечных повторов нет | вход во всё |
| роутер | `globalProperties.$router`: `currentRoute.value.{name, params.accountId, params.chatId}`, `afterEach`, `push`. Маршрут `chat` = `/accounts/:accountId/chats/:chatId?` (`composables:86086-86087`) | какой чат открыт, эпоха маршрута, переход |
| сторы | `globalProperties.$pinia._s.get(id)`. Стор, которого ещё нет, не создаём. О сторах, созданных позже, узнаём плагином `pinia.use()` (`composables:269`). API наблюдения — `$onAction` и `$subscribe` (`:412`, `:415`) | — |
| аккаунты | запрос `["accounts"]` (маппер `accounts:2033-2047`); стор `accounts`: `subscribedAccountIds`, `openAccountIds`, `findAccount` (`:9440-9512`); `tabEntries` (`:8989`), `chatTabEntries` (`:8645`) | привязка к странице, подписка WS на аккаунт |
| кэш | `_pc_query` (`composables:542`): `getQueryData` (`:697`), действия `setQueryData` (`:676`), `invalidateQueries` (`:603`), `$onAction` (Colada сама так делает, `:844`). Ключи: `["chatMessages",acc,fan]`, `["fansMap",acc]` (`accounts:7086-7087`), `["chatList",acc,…]` (`:6185`), `["mimicSettings"]`, `["mimicChats"]` (`inbox:192, 234`), `["userPermissions"]` (`composables:86182`), `["onlyfansBuyingPowers"]`, `["onlyfansLastPayments",acc]`, `["fanInsights",acc]` | окно открытого чата, свежий текст, фан, порядок списка, условия X8 |
| очередь отправки | стор `pendingMessages` (`notificationEntry:1427-1627`): действия `enqueue`, `cancel`, `resend`, `confirmEchoedMessage`, `resetForAccount`, `resetAll`; состояние `messagesByAccountId`, `processingByAccountId` | наблюдение отправки человеком (§6.6), X8 (§6.7) |
| мост composer | `[data-id="browser-composer-translator"].__omComposerBridge.{setText, insertText, focus}` (`messages:14638-14657`, узел `:15008-15032`). `insertMessage` не используем: он заменяет черновик вместе с вложениями | вставка |
| черновик | `localStorage['chat-space:draft:of:{acc}:{fan}']` — TipTap JSON, его пишет наблюдатель Vue (`composables:89696-89720`). Читает изолированная сторона (тот же origin), запасной путь — редактор в MAIN | Fix, Б2, сверка вставки |
| переводчик | стор `composerTranslator` (`messages:2858-2869`), ключ `chat-space:composer-translator:accounts:<userId>` (`:2848`); автоперевод = `enabled && autoTranslate` (`:3083`) | условие X8 |
| WebSocket | тап, §6.8 | звук, свежесть X8, эхо |
| тема | класс `dark`/`light` на `<html>`, `--color-om-*` (`index-DEVowLko.js:886-898`), `--app-content-max-width/align` (`fanCardSettings-T4I247Gu.js:1437, 1623-1624`) | токены UI |
| сборка | `script[type=module][src^="/assets/index-"]` → `index-DEVowLko` | отпечаток для диагностики и для X8 |

Всё — только чтение. Мост не вызывает фабрики сторов и composables, `ensure*`,
`refresh*`, `fetch`, `invalidate*`: любой из них может породить запрос.

### 6.2 Проверка контракта и деградация

| Якорь | Проверка | Если сломан | Код |
|---|---|---|---|
| `#app.__vue_app__` | есть за 60 с | AI и док выключены; popup и «Статус» работают | `CG-HOST-NOT-READY` |
| роутер (`currentRoute`, `afterEach`, `push`, имя `chat`) | типы и имя маршрута | дока нет; доски открываются, «Открыть чат» недоступно | `CG-HOST-CONTRACT` |
| `["accounts"]` с `platformAccountId` | схема | привязки нет — AI выключен | `CG-HOST-CONTRACT` |
| мост у видимого composer + `.ProseMirror` | при каждом монтировании | только «Копировать» | `CG-HOST-COMPOSER-MISSING` |
| `div.relative > .composer-frame` | при монтировании | док — фиксированный оверлей над прямоугольником composer, ленту не сдвигает | деградация |
| форма `["chatMessages",acc,fan]` | выборочная схема | нет свежего текста, предпроверок и «чат грузится» | деградация |
| `["fansMap",acc]` | схема | имена и панель — только из хаба | деградация |
| `pendingMessages` (действия, форма записи) | действия и ключи `id, accountId, chatId, platform, status, error, createdAt, payload` | нет наблюдения отправки, `sent` неизвестен; X8 выключен | `CG-SEND-HOST` |
| ключ черновика | после первого ввода | чтение и сверка — через редактор | деградация |
| кадры WS `account_new_message` | первые кадры текущего сокета | звук — по сторам; свежесть X8 неизвестна | `CG-SEND-FRESHNESS` |
| `["chatList",acc,…]` | схема | J/K, ⌘U, ⌘1–9 выключены | деградация |
| `composerTranslator`, `mimicSettings/mimicChats`, `userPermissions` | форма; `composerTranslator` до первого поля ввода чата в документе — «ещё нет» (`notYet`, ниже) | X8 выключен (не можем проверить условия) | `CG-SEND-HOST` |
| путь отправки и квитанции X8 (§6.7.6) | отпечатки существенных модулей и проверки формы совпадают с одним из проверенных профилей `limits.previewSendReceiptProfiles`, или там стоит профиль-метка «любая сборка» и модули всех ролей загружены (решение X25) | X8 выключен, «Открыть и вставить» работает | `CG-SEND-RECEIPT` |
| предохранитель X8 (решение X25) | после отправки с известным исходом текст, число сообщений и чат квитанции те, что мы отправили; три неизвестных исхода подряд — нет | X8 выключен в браузере до новой сборки ChatSpace или сброса в «Статусе», «Открыть и вставить» работает | `CG-SEND-FUSE` |
| тема | вычисленные стили | своя тема | деградация |

**Когда проверяем:** на старте, когда появился нужный стор, при первом переходе в чат,
при сбое монтирования, при смене отпечатка сборки или существенных модулей. Таймеров нет.

**Якорь, которого ещё нет** (`notYet`, контракты 1.10.0). ChatSpace создаёт стор
`composerTranslator` в `setup` поля ввода чата и держит его до перезагрузки страницы
(0.195.0–0.202.0). Пока в документе не было ни одного поля ввода (слот
`[data-id="browser-composer-translator"]`), MAIN называет отсутствующий стор `notYet`, а
не `missing`; первое поле ввода — и стор без него уже `missing`, до перезагрузки. `notYet` —
не поломка контракта: «Статус», popup, журнал вкладки и `client_health` её поломкой не
считают. Но X8 при нём выключен (`CG-SEND-HOST`, причина — сам якорь), и у «Отправить»
текст «откройте любой чат…»; настоящая поломка другого якоря отправки называется
раньше. Сами стор не создаём (§6.1).

**Состояния возможности** (`HostCapability`): `on`, `degraded`, `off`, `contractBroken`,
у каждого — код причины. Отпечаток сборки — сигнал для диагностики, а не единственная
проверка: незнакомая сборка с тем же проверенным контрактом работает.

**Исключение — X8.** Отправка из превью включается только при **профиле пути отправки и
квитанции** — `limits.previewSendReceiptProfiles` в bootstrap. Владелец выбрал 2026-10-09
рекомендуемое значение §19 п. 6 (решение X21) и в тот же день его отменил: X8 допускается
на любой сборке ChatSpace по профилю-метке хаба, а после отправки его сторожит
предохранитель (решение X25, ниже). Точные профили и всё, что сказано о них ниже, работают
по-прежнему, рядом с меткой.
- Профиль связывает версию нашего адаптера с точными отпечатками существенных
  загруженных модулей:
  - очередь и её последовательность;
  - создание Ky и захват `fetch`, обработчик 401;
  - формат квитанции и входящее эхо;
  - нужные проверки условий.

  К ним добавляются проверки формы во время работы.
- Отпечатки — хешированные адреса уже загруженных модулей из метаданных DOM и ресурсов
  страницы. Мост ничего не скачивает с OnlyMonster. Нужна вся текущая связка, а не один
  знакомый модуль. Несколько несовместимых кандидатов, недоступная связь с текущим
  стором или пропавший компонент — `unknown`, X8 выключен.
- Общий `index-*.js` в ключ не входит, он — поле диагностики. Сменилась только общая
  сборка, а существенные модули и форма прежние, — X8 работает без новой проверки.
- Сменился существенный модуль — X8 выключен, пока не просмотрен разбор
  `tools/host-contract-check` по локальной копии (ниже). Неясное изменение, а также
  изменение захвата `fetch`, повтора после 401, тела, очереди или эха закрывает профиль
  до проверки.
- Базовый профиль один раз проверяется ручным smoke до пилота: даже 0.172.0 пока
  разобрана только статически.
- В bootstrap — только данные о допущенных профилях, без исполняемого кода и удалённых
  селекторов. Проверки флага, прав и свежести и атомарный `dispatch` остаются
  обязательными. Несовпадение посреди уже начатой отправки — `uncertain`: следующие X8
  закрыты, опека не снимается.
- Совпадения имён действий мало: `pendingMessages.enqueue.toString()` показывает лишь
  обёртку Pinia (`composables:383-407`), а не тело отправки
  (`notificationEntry:1471-1497`, `composables:63235`, `:86168-86175`).
- Пробная отправка пользователя для «самообучения» не допускается: к моменту проверки её
  последствие уже могло произойти.

**Любая сборка и предохранитель (решение X25, 2026-10-09).** За 2026-10-09 вышли 0.200.0,
0.201.0 и 0.202.0, в каждой сменились отпечатки всех пяти ролей при том же пути отправки, и
X8 стоял выключенным до ручного разбора. Владелец решил «просто забить, пока не сломается».
- **Профиль-метка.** Профиль, у которого `modules` ровно `{"*":"*"}`, совпадает с любой
  сборкой для версии адаптера, которую он называет, — пока на странице загружены модули
  всех ролей (`MainLayout` загружен). Значение хаба:
  `[{"id":"any-build","adapterVersion":"0.3.0","modules":{"*":"*"}}]`; `id` — любой текст.
  Метка другой версии адаптера не пускает никого; расширения до X25 её не знают. Точный
  профиль, если совпал, называется первым. Отчёт контракта несёт `receiptMatch`
  (`exact` или `anyBuild` и id профиля); «Статус», журнал вкладки, выгрузка диагностики и
  `client_health` (`receipt:any-build`) говорят, что сборка не проверена.
- **Предохранитель.** После каждой отправки X8 с известным исходом MAIN сверяет то, что
  наблюдатель квитанции уже видит (`main/receipt.ts`, `main/send-port.ts`, `main/shown.ts`):
  - `text` — тело запроса, который отправил ChatSpace, сообщение в ответе сервера или
    исходящее эхо id квитанции показывают другой текст, чем наша часть. Сравнение — как
    ChatSpace показывает текст: без тегов, с раскодированными сущностями (один или два
    раза), без пробелов и переносов, в NFC; безвредное переписывание не срабатывает;
  - `count` — второй POST через наблюдатель, второй элемент очереди от одного вызова или
    второе исходящее сообщение с нашим текстом в этом чате от вызова очереди до 10 с после
    квитанции (новая отправка в этом чате обрывает окно);
  - `target` — POST через наблюдатель, элемент очереди или эхо id квитанции другого чата
    или аккаунта;
  - `uncertain` — три отправки подряд с неизвестным исходом (фон; восстановленные после
    перезапуска не считаются).

  Сработав, он выключает X8: во вкладке сразу (`previewSend` — `off`, причина `fuse`,
  `CG-SEND-FUSE`), во всех вкладках через фон (`storage.local` `send.fuse`, событие
  `send.fuse`; фон держит `send.begin` вкладки той же сборки). Держит, пока сборка
  (входной модуль `index-*`) та же; сработал на двух сборках подряд — любую. Сбрасывает
  человек: «Сбросить предохранитель» в «Статусе». Предохранитель ничего не отправляет и не
  повторяет, исход попытки не меняет. В журналах — причина, место и длины текстов, сам текст
  никогда.
- **Остаётся.** Контракт хоста во время работы, наблюдатель квитанции (запрос обязан взять
  наш `fetch`), все условия §6.7.4, тап, флаг и опека хаба на каждом `dispatch`.
- **Остаточный риск.** Первая отправка на сломанной сборке уходит: предохранитель
  срабатывает после неё. Он не видит лишних полей тела, заголовков и пометки
  `is_ai_generated`. Сборка с перегруппированным путём отправки проходит метку (растяжка
  `host-contract-check` — только при ручном разборе). Ложное срабатывание — если платформа
  переписывает текст по-своему; сбрасывает человек.
- **Как вернуться к X21.** Поставить в хаб точные профили вместо метки.

**Роли существенных модулей.** Существенный модуль узнаётся по имени до хеша — роли
(`RECEIPT_MODULE_ROLES` в `packages/host-chatspace/src/isolated/host-contract.ts`). У
роли может быть несколько модулей; её отпечаток — их хеши по алфавиту через `+`. Профиль
обязан назвать все роли адаптера, страница — загрузить все их модули. Роли адаптера 0.3.0,
по раскладке ChatSpace 0.195.0:
- `notificationEntry` — стор очереди `pendingMessages` и её последовательность, тело
  запроса и его единственный POST, быстрый ответ из уведомления;
- `composables` (два модуля) — HTTP-клиент Ky (здесь захватывается `fetch`), обработчик
  401, шина сокета и нормализатор кадров, кэш запросов `_pc_query`, права роли;
- `onlyfans` (два модуля) — маленький грузится сразу со страницей (помощники OnlyFans,
  которые импортируют очередь и клиент); второй грузится с главным макетом (`MainLayout`):
  поле ввода и его Send, мост `__omComposerBridge`, стор переводчика `composerTranslator`,
  обработчик эха открытого чата;
- `accounts` — стор аккаунтов и подписки сокета, эхо в списке чатов, карта фанов,
  обработчик ошибок API;
- `inbox` — настройки и чаты Mimic.

`MainLayout` — компонент маршрута `/`, родитель и обзора аккаунтов, и чата, поэтому
отпечаток один и тот же с открытым чатом и без него. До загрузки `MainLayout` (и на
странице без входа) очереди и второго `onlyfans` ещё нет — совпадения нет, X8 выключен.
Входной модуль `index-*` ролью не бывает.

**Перегруппировка модулей — только с выпуском адаптера.** Роли — имена файлов, которые
даёт сборщик ChatSpace, а не их содержимое. В 0.195.0 сборщик перегруппировал модули:
`messages-*.js` пропал, его содержимое ушло во второй `onlyfans-*.js`. Путь отправки при
этом не изменился (разбор 0.172.0 → 0.195.0 от 2026-10-09: очередь, тело, захват `fetch`,
401, эхо и наши условия те же, кроме имён после минификации). Но адаптер 0.2.0 с ролью
`messages` не мог совпасть ни с каким профилем: такой роли на странице нет. Значением в
хабе это не лечится — список ролей в коде расширения. Поэтому перегруппировка модулей пути
отправки требует выпуска с новым списком ролей и новой версией адаптера
(`ADAPTER_VERSION`); для 0.172.0 → 0.195.0 это адаптер 0.3.0 (`messages` → `onlyfans`).
Профиль называет версию адаптера, поэтому вместе с выпуском в хаб вносят профиль новой
версии; старые профили с ним не совпадают.
- Профиль адаптера 0.3.0 годится только для сборок с раскладкой 0.195.0. Перегруппировку
  `tools/host-contract-check` ловит двумя способами и в обоих кончается кодом выхода 1:
  пропало имя роли (`MISSING role modules`) или якорь пути отправки нашёлся вне модулей
  ролей (`SEND PATH …`, «растяжка»).
- Якоря пути отправки — `SEND_PATH_ANCHORS` в `host-contract.ts`: мост поля ввода, стор
  переводчика, стор очереди и его состояние, код отказа Message Guard, строки HTTP-клиента
  Ky (захват `fetch`, хуки с токеном и обработчиком 401), ключ кэша и подтверждение эха
  открытого чата, путь сокета. Каждое их место в копии должно быть модулем роли; якорь,
  которого нет нигде, — тоже провал. Во входном модуле `index-*` ни одного из них нет ни в
  0.172.0, ни в 0.195.0, поэтому и там они — сигнал. Действие очереди проверяется иначе:
  оно должно стоять в модуле стора очереди, потому что его вызывают и из других мест (в
  0.172.0 — поле ввода Telegram в `ChatView`), а у HTTP-библиотеки есть свой метод с тем же
  именем.
- Без растяжки копия 0.172.0 под адаптером 0.3.0 прошла бы как «все роли на месте»:
  маленький `onlyfans-*` есть, а поле ввода, мост, переводчик и эхо — в `messages-*`, вне
  профиля. Теперь инструмент на ней падает и называет эти места; на 0.195.0 проходит.

**Слой Sentry над `fetch` (0.195.0) — принят по разбору.** Входной модуль 0.195.0
запускает Sentry (`index-p8xPkCj8.js:4495-4502`). Его интеграция Breadcrumbs заменяет
`window.fetch` обёрткой (`index-p8xPkCj8.js:3171-3207`, `composables-DKWzNPeA.js:63308-63319`).
Ky по-прежнему берёт тот `fetch`, что стоит в `globalThis` в момент создания запроса, — во
время нашего вызова это наш наблюдатель квитанции (§6.7.6). Наблюдатель передаёт вызов
дальше, и теперь «дальше» — обёртка Sentry, а не `fetch` браузера.
- Обёртка прочитана: она зовёт исходный `fetch` с теми же аргументами и тем же `this`,
  отдаёт тот же `Response`, читает только заголовки запроса (не тело), не повторяет и не
  меняет запрос; при сетевой ошибке лишь дописывает хост к тексту ошибки. Квитанция
  поэтому работает как прежде.
- Обёртка живёт в `index-*`, а он в профиль не входит по замыслу (см. выше). Значит, её
  смена X8 не выключит. Этот слой принят как проверенный (решение X21).
- Sentry видит нашу отправку X8 как любую нативную: в «хлебных крошках» — метод, адрес и
  статус POST. Необработанная ошибка нашего кода в MAIN тоже ушла бы в телеметрию
  OnlyMonster; в консоль MAIN-код не пишет, обработчик тапа ловит свои ошибки сам
  (`main/ws-tap.ts`).
- **Пересматриваем**, если в новой сборке обёртка начнёт менять запросы к API
  OnlyMonster (заголовки трассировки `sentry-trace`/`baggage`, повтор, чтение или подмена
  тела или ответа), если Sentry начнёт записывать действия сторов (его плагин Pinia сейчас
  не подключён) или если живой smoke X8 покажет другое поведение. Обёртку `fetch` во
  входном модуле читают при каждом разборе новой сборки.

**Частичная поломка:**
- сломан хвост переписки → AI по архиву;
- сломана вставка → только «Копировать»;
- нет роутера → нет «Открыть и вставить», человек открывает чат сам;
- нет идентичности → нет AI и вставки;
- сломан звук → тихий режим со статусом.

**Любая деградация:**
- видна в «Статусе» и в popup;
- один устойчивый тост на изменение, а не сотня ошибок;
- уходит в `client_health` не чаще раза в 60 с;
- может быть дополнена флагом bootstrap: владелец выключает функцию на сервере.

Ручная кнопка «Проверить» проверяет только память и DOM, ChatSpace не трогает.

**Сверка с новой сборкой.** Локальный инструмент `tools/host-contract-check` сверяет
строки якорей `packages/host-chatspace/src/host-contract.ts` с копией бандлов
`~/Documents/ChatGoose/Research/chatspace-bundles/<версия>/`.
- Он печатает «есть/нет», номера строк, новый отпечаток профиля квитанции и ограниченный
  разбор изменений в зависимостях пути отправки — но не код. Сверки строк `enqueue` и
  названий полей для профиля мало.
- Изменившийся хеш большого общего чанка может оказаться ложным срабатыванием. Тогда
  смотрят этот разбор, а не всё приложение.
- Ключ кэша `onlyfansBuyingPowers` с 0.200.0 собран шаблоном по платформе
  (`` `${платформа}BuyingPowers` `` в фабрике, которую модуль зовёт с `onlyfans`); такой
  шаблон засчитывается только целиком, остальные строки — только литералом
  (`packages/host-chatspace/README.md`).
- Запускается руками, в CI не входит (А2).

### 6.3 Где живёт интерфейс

**Док — в потоке, первым ребёнком корня рамки composer.**
- Корень рамки — `div.relative` (`messages:5693`). Ищем его как
  `slot.closest('.composer-frame').parentElement`.
- Внутрь слота нельзя:
  - слот — пустой `inline-flex` в полосе `h-10` (`:14928-14932`, `:15008-15032`);
  - ширину правой группы ChatSpace меряет, чтобы ужать ряд эмодзи (`:14963-14966`);
  - `.composer-frame` обрезает лишнее (`overflow-hidden`, `:5695`), полоса лежит внутри
    неё (`:5753-5755`).
- Над рамкой можно:
  - блок composer (`div.shrink-0`, `ChatView:7860`) растёт на высоту дока;
  - окно ленты уменьшается;
  - `MessagesList` по `useResizeObserver` сам держит низ (был внизу — `scrollToBottom`),
    иначе сохраняет якорь (`messages:19905-19913`). «Был внизу» у него — последняя
    замеченная прокрутка этого чата кончилась не дальше 1 px от низа; иначе он удерживает
    сообщение у ВЕРХА ленты, и последние сообщения уходят под наш результат (отзыв первого
    чаттера, решение X26). Поэтому низ держит и док (UI-016,
    `host-kit/isolated/keep-bottom.ts`, до R20 P5 — в `host-chatspace`): пока лента не дальше 100 px от низа — мера
    самого ChatSpace для «у последних сообщений», — при росте дока она ставится в низ в том
    же кадре, после ответа ChatSpace на тот же resize; выше ничего не трогаем. В DOM ленты
    ничего не вставляется, читается только геометрия прокрутки, пишется только `scrollTop`
    её блока. Ленту док находит от себя: ближайший блок с прокруткой, который кончается
    прямо над доком. e2e проверяет низ, «чуть выше низа», середину истории, resize и смену
    маршрута.
- Слот остаётся якорем поиска активного composer, внутрь ничего не кладём.

**Активный composer.**
- Composer есть на каждую посещённую вкладку чата: `v-show`, ключ
  `${tabId}:${accountId}:${chatId}` (`ChatView:8253, 8274`).
- Активный — подключённый, видимый по всей цепочке, с ненулевой геометрией, ровно
  один. Иначе не монтируемся и пишем в лог.
- У каждого найденного composer — свой `composerInstanceId`. Узел заменился — новый id.
- При смене чата хост переносится в новый активный composer. Перенос узла сохраняет
  shadow root и дерево Preact.
- Vue пересоздал корень рамки — хост пропал вместе с ним. Вставляем заново по событию
  маршрута или по `MutationObserver` на контейнере composer-ов (`childList`, без
  `subtree`). Глобальный наблюдатель — только на короткое время первого поиска.
- MAIN узнаёт о composer по событиям хранилищ и маршрута, а не по DOM: перерисовку того
  же composer без них (с паузой или одним шагом) видит только док. Простояв 100 мс над
  другими узлами, чем те, над которыми он встал для composer, названного MAIN, и не
  получив от MAIN ничего нового, док просит MAIN посмотреть ещё раз (запрос `snapshot`).
  MAIN находит новый composer, привязывает его к чату по обычному правилу, даёт новый id
  и сообщает о нём событием `composer`. Ответ на этот запрос вкладка не применяет:
  состояние MAIN приходит к ней одним путём, событиями, — MAIN не повторяет событие,
  равное прошлому, и об ответах ничего не знает. Смена чата выглядит так же (ChatSpace
  показывает composer другого чата раньше, чем приходит сообщение MAIN), но о ней MAIN
  сообщает сам, и ожидание кончается без вопроса. Проверки вставки (§6.4) от этого не
  меняются: MAIN по-прежнему пишет только в composer с id из `expected`.

**Фан заблокирован** (composer скрыт по `!fan.isBlocked`, `ChatView:8274`): хост встаёт в
конец контейнера узкой строкой в режиме «только копировать» (`CG-GATE-FAN-BLOCKED`).

**Оверлеи.**
- Свой хост `<div data-host="overlay" data-layer="…">` в `document.documentElement`, вне
  `#app`, закрытый shadow root, `position: fixed`. Имена атрибутов нейтральные (§5.3,
  «Правила MAIN-мира»).
- Слои: 900 — панели (панель фана), 950 — модальные окна (Spenders, «Новые», Coach,
  Recap, Review, палитра, шпаргалка), 960 — тосты. Диалоги ChatSpace (PrimeVue, от 1000)
  остаются над нами. Тосты выше панелей по слою, но не по месту: пока открыта боковая
  панель, столбик тостов стоит левее неё (ui-design §3.9).
- В режиме «фиксированная ширина» боковые поверхности выравниваются по контейнеру
  `MainLayout` (`MainLayout-DBvnSRX2.js:303`) — одна подписка `ResizeObserver`.
- Пока наше окно развёрнуто, на его хосте стоит `data-dismissible-open`. Тогда Esc
  ChatSpace не закрывает вкладку чата (`MainLayout-DBvnSRX2.js:331-333`).

**Стили.** Только constructable stylesheets (`adoptedStyleSheets`), общие для хостов.
Глобального CSS нет. На хосте — `contain: layout style`.

Изоляция событий держится на раннем диспетчере (§9.1), а не на `stopPropagation`
хоста: capture ChatSpace на `window` может сработать раньше всплытия.

### 6.4 Вставка и привязка к чату

1. **Проверки на изолированной стороне:**
   - эпоха входа, ревизия привязки и персона не изменились;
   - чат маршрута равен цели (строковое сравнение `acc` и `fan`), маршрут стоит хотя бы
     один кадр;
   - composer цели готов, видим и единственен.
2. **Правило черновика (Б2):**
   - пусто или там наш неизменённый текст → «Вставить» (замена);
   - текст набран человеком или происхождение неизвестно → нужно согласие на эту
     ревизию. Согласие одноразовое и привязано к ревизии. С решения X45 (владелец,
     2026-10-17) **согласие — сам клик** «Вставить» (Reply, Hi, Ping, часть Split-Fix):
     замена сразу, как в старом расширении Fansly, одноразовый `confirmationId` едет с
     записью, CAS — по ревизии, прочитанной при клике; вернуть текст — Ctrl/⌘+Z в поле
     (запись — шаг истории редактора хоста). Диалог «Заменить / Добавить в конец /
     Отмена» остаётся без наблюдаемого редактора (ниже), у черновика Coach, при
     изменившемся между чтением и записью черновике (отказ MAIN), у «Вернуть мой текст»
     после правки человека и у «Открыть и вставить» доски (§6.5).
3. **MAIN, в одном синхронном шаге без `await`:**
   - сверить эпоху документа, эпоху маршрута, `composerInstanceId`, ревизию и отпечаток
     черновика с `expected`;
   - проверить, что согласие действительно и не использовано;
   - записать: замена — `setText(text)`. Добавление — курсор в конец
     (`editor.commands.focus('end')`; это не контракт, проверка отмечает его наличие),
     затем `insertText('\n' + text)`. Нет редактора — `setText(черновик + '\n' + text)`,
     форматирование черновика теряется, диалог Б2 об этом предупреждает.

   Между проверкой и записью человек ничего не успевает поменять: пауз нет.
4. **Сверка** после микрозадачи и одного кадра:
   - прочитать ключ черновика цели (или текст редактора) и сравнить нормализованно:
     замена — равенство, добавление — окончание;
   - итог `applied`, `rejected` или `uncertain`. Чужие черновики не просматриваем.
   - Человек мог изменить поле раньше этой сверки (Send ChatSpace очищает его в том же
     кадре, набор продолжается). При наблюдаемом редакторе запись — это его транзакции
     внутри нашего вызова: то, что вызов оставил, читается в том же синхронном шаге, и
     если после него документ сдвинула не наша транзакция, сверяется оставленное, а не
     поле сейчас. Иначе отправленный черновик выглядел бы «ничего не записано», и
     отправку нашего текста нельзя было бы приписать (§6.6).
   - «Вставлено не туда» (`CG-INSERT-MISPLACED`, счётчик P1) — только при точном
     свидетельстве: связанный узел или идентичность в момент записи не совпали с целью.
     Иначе неясный исход — `CG-INSERT-UNCERTAIN`: повторной вставки нет, тост
     «Проверьте поле ввода».
5. **Итог:** телеметрия `inserted`, черновик помечается «наш» (отпечаток), фокус в поле,
   курсор в конце.

**Ревизия черновика** берётся из потока изменений документа самого редактора, а не из
событий DOM.
- MAIN пассивно подписан на `transaction` и `update` объекта Tiptap этого composer.
  - Объект доступен как `view.dom.editor` (`dist-BLhMBCvR.js:12162-12163`).
  - События испускает `dispatchTransaction` (`:12177-12201`).
  - Подписка привязана к `composerInstanceId` и снимается вместе с ним.
  - Редактор загружается позже composer. Пока его нет, MAIN ждёт его коротким (15 с)
    узким наблюдателем: на корне рамки, а если корня рамки в этой сборке нет — на тех
    же нескольких узлах над слотом, где ищется редактор (не выше узла, в котором есть
    слот другого composer; на `body` — никогда, §6.10). Редактор появился — состояние
    composer читается заново, даже когда ручки `view.dom.editor` у него нет (это случай
    «нет проверенного наблюдения редактора» ниже).
- Так видны и программные замены:
  - восстановление черновика через `setContent` (`messages:1651-1653`);
  - команды форматирования, вставки и очистки (`:1670-1689`);
  - перевод через `clear/insertContent` (`:18358-18360`).
- Наши транзакции — те, что пришли синхронно внутри нашего вызова моста; они
  помечаются нашим контекстом. Любая другая — `human-or-unknown`, ревизия растёт.
- `beforeinput`/`input` в активной `.composer-frame` остаются только сигналами
  происхождения (набор, вставка из буфера). Слушатель один, на `document` в capture; на
  узлы ChatSpace слушатели не вешаем.
- Сравнивается отпечаток полного документа, а не простого текста: правка форматирования
  и A→B→A не прячутся. Перед записью MAIN синхронно перечитывает документ.
- **Нет проверенного наблюдения редактора** — нет обещания полного CAS: возможность
  `draftRead` деградирует.
  - «Заменить мой черновик» и «Вернуть мой текст» недоступны.
  - Вставка в непустое поле — только с подтверждением.

**Fix (Б2, AI-022; с решения X26 — без вопроса).**
- Результат ждёт явного клика: Fix сам поле не меняет.
- «Заменить мой черновик» — согласие на замену того, что лежит в поле в момент клика:
  черновика, по которому сделан Fix, или того, что человек из него сделал с тех пор.
  Замена — один CAS по ревизии, прочитанной при клике; вопроса Б2 нет (до X26 изменившийся
  за время генерации черновик спрашивал «Заменить / Добавить / Отмена»). Поле опустело —
  текст Fix просто встаёт в него.
- Split-Fix отвечает обычными частями. «Вставить» части — то же согласие: одноразовый
  `confirmationId` едет с записью, вопроса нет — поверх черновика, по которому сделан Fix, и
  (с решения X45, общее правило Б2) поверх другого текста человека.
- 30 с доступна кнопка «Вернуть мой текст» (у Fix одной частью). Это тоже намерение
  вставки с ожидаемой ревизией — той, что получилась после Fix; возвращается текст,
  который заменили (над пустым полем — тот, по которому делали Fix). Человек дописал после
  Fix — подтверждение, а не молчаливый возврат. Кроме того, запись идёт через мост
  ChatSpace и остаётся в истории его редактора: Ctrl+Z в поле возвращает прежний текст.
- Fix из локального поля превью сам по себе поле ChatSpace не трогает.

**Enter** действует только на сфокусированной нашей карточке или кнопке вне поля
ввода, с остановкой события. В composer Enter остаётся за ChatSpace.

### 6.5 «Открыть и вставить» из превью (А7)

1. Клик создаёт одноразовое `NavigationIntent` с `thenInsert` на одну выбранную часть.
   Срок — `limits.navInsertTimeoutSec` (по умолчанию 20 с, уточняется замером на winpc).
2. `router.push` к точным аккаунту и чату. Доска закрывается (SP-035). ChatSpace
   открывает чат и помечает его прочитанным — это действие человека, владелец его принял.
3. Ждём:
   - маршрут, props, мост и рабочий редактор;
   - два стабильных наблюдения идентичности;
   - новую эпоху маршрута.

   Затем читаем новый черновик.
4. Человеческий черновик → подтверждение и новая проверка. Дальше — протокол §6.4.

**Отмена:** новый переход человека, другое намерение вставки, закрытие превью до
перехода, выход или смена персоны, истечение срока, неоднозначный composer. Тост
«Вставка отменена» (`CG-INSERT-CANCELED`). Сама генерация сохраняется.

**Срок истёк** → «Чат не готов. Откройте его и вставьте результат» (`CG-NAV-TIMEOUT`).
Новая попытка — только новым кликом. Скрытых нажатий Send нет. В «Новых» нужна ещё
действующая бронь. После вставки док показывает остальные части той же операции.

### 6.6 Отправка человеком и факт `sent`

Отправляет человек — кнопкой Send ChatSpace. Связь с нашей вставкой строится по id, а не
по похожести текста.

1. MAIN подписан на `pendingMessages.$onAction`. Pinia вызывает подписчиков **до** тела
   действия (`composables:383-405`). Поэтому в обработчике `enqueue`, ещё до нативной
   отправки:
   - фиксируется происхождение черновика — цепочка ревизий от нашей вставки (§6.4);
   - если очередь аккаунта свободна, на этот синхронный стек ставится тот же узкий
     захват `fetch`, что и у X8 (§6.7.6): запрос Ky создаётся синхронно
     (`composables:63153-63160, 63223-63235`).

   В `after`/`onError` глобал возвращается (если он ещё наш), а возвращённый `entry.id`
   (локальный UUID ChatSpace) связывается с попыткой. Сам нативный Send расширение не
   вызывает.
2. Отправка «наша», если черновик в момент Send происходит от нашей вставки. Это
   видно по цепочке ревизий того же composer.
   - После вставки ревизия не менялась — `edited: false`.
   - Человек правил — `edited: true`.

   Отпечаток текста — только проверка целостности.
3. **Квитанция** — id сервера из перехваченного ответа именно этой попытки, по правилам
   §6.7.6 (401 — не исход). Время записи и новый элемент кэша ключом не служат:
   - `createdAt` записи — локальное `now()` (`notificationEntry:1552`), а не уникальный ключ;
   - при раннем эхе нативный `p(e, id)` элемент не добавляет (`:1406-1413, 1457-1469`);
   - эхо пишет тот же кэш независимо (`messages:21415-21427`).
4. **Эхо.** Исходящее `account_new_message` с тем же id → `sentObserved` → телеметрия
   `sent` (`via: 'composer'`). После «Открыть и вставить» в «Новых» та же пара даёт
   регистрацию отправки в H-7.
5. **Атрибуция неизвестна** → `sent` и «поприветствован» не создаются — ни по времени, ни по
   тексту. Так бывает, если:
   - отправка ждала в занятой очереди (нативный запрос создан позже, вне захвата);
   - путь захвата недоступен;
   - тайм-аут, отказ, сбой.

   Это явное ограничение M2 и его приёмки, а не готовая телеметрия.

Нативный Resend и Cancel принадлежат ChatSpace (Б12): мы их не вызываем и не прячем.

### 6.7 X8: отправка из превью через очередь ChatSpace

Решение владельца X8 (`docs/decisions.md:83-95`). В превью чужого чата (Spenders,
«Новые») человек генерирует ответ и отправляет его кликом, не открывая чат. Отправка
идёт только через собственную очередь ChatSpace в коде страницы — то же, что делает их
кнопка Send. Своих запросов к OnlyMonster нет. Переписку чужого чата вживую не грузим.
Неизвестный исход не повторяется. Флаг в bootstrap выключает отправку сразу.
«Открыть и вставить» остаётся вторым действием.

Ниже — вывод по исходникам 0.172.0, а не по выполненной отправке. Свойства, которые
проверяются только вживую, перечислены в §6.7.13. Ссылки `messages:NNNN` — строки 0.172.0.
В 0.195.0 этого модуля нет; где известны строки 0.195.0, они даны рядом
(`onlyfans-SstGvKHV.js`): области взяты из разбора 0.172.0 → 0.195.0 от 2026-10-09, строки
внутри — тем же сдвигом, сверены по форме кода. Путь отправки в 0.195.0 тот же (§6.2).

#### 6.7.1 Что именно вызывает мост

Единственная новая бизнес-команда моста — `previewSendCommit`. Она вызывает ровно
одно действие уже существующего стора `pendingMessages` — `enqueue`. Мы не
импортируем их модуль, не создаём стор фабрикой, не нажимаем скрытую кнопку Send, не
монтируем скрытый composer.

```ts
// Наш код в MAIN: единственная запись в стор ChatSpace
const entry = pendingMessages.enqueue({
  accountId: target.chat.hostAccountId,   // id аккаунта OM, строка
  chatId: target.chat.platformFanId,      // id фана OF, строка
  platform: 'onlyfans',
  text: html,                             // '<p>' + esc(part).replaceAll('\n', '<br>') + '</p>'
  hasAttachments: false,
  isAiGenerated,                          // правило ниже
  isCopied: false,                        // буфер обмена не участвовал
  platformMetadata: {},                   // только обычный бесплатный текст
  composerContent: { html, media: null, gif: null, taggedCreators: [] },
});
// entry === null → очередь отказала (Mimic или 50 записей в чате) → notEnqueued
```

**Откуда это взято:**
- **Стор и действие:** `notificationEntry:1427-1627`; синхронный `enqueue`, возвращающий
  запись или `null`, — `:1543-1564`.
- **Прецедент:** быстрый ответ ChatSpace из уведомления сам шлёт в неоткрытый чат
  `enqueue({accountId, chatId, platform, text, platformMetadata: {}})`
  (`notificationEntry:21910-21941`, вызов `:22235`).
- **`chatId` — это id фана OF:** очередь передаёт `fanId: e.chatId` (`:1481`); стор чатов
  строит один ключ из `platform_fan_id` и из `chatId` (`accounts:6241`, `:6256`).
- **`platformMetadata: {}`** — для простого текста. `xE` добавляет поля только при gif,
  отметках, медиа, цене или ответе на сообщение (`messages:18444-18460`). В X8 всего этого
  нет; чужие вложения и цель ответа не подхватываются.
- **`composerContent`** включает их собственную кнопку «вернуть в поле ввода» у неудачной
  отправки (`messages:20855-20861`, `:21146-21150`). После отказа Message Guard человек
  правит текст в ChatSpace.

**HTML** строим так же, как их мост `setText`:
- На входе простой текст. Порядок такой:
  - сначала экранируется `&`, затем `<` и `>`;
  - затем ставятся наши переводы строк (`<br>`) и внешний `<p>`.
- Цепочка в бандле:
  - `messages:119` импортирует `Lr as qe`;
  - `composables:91324` экспортирует `wF as Lr`;
  - `wF` экранирует только `& < >` (`composables:63515`);
  - `Kx/qx` добавляют `<br>` и `<p>` (`messages:14624-14630`; 0.195.0 —
    `onlyfans-SstGvKHV.js:16156-16162`).
- Никаких атрибутов из ответа модели и повторного разбора его как доверенного HTML.
- Поле ввода при Send отдаёт `getHTML()` (`messages:18466`). Это сериализация редактора, а
  не обещание побайтно вернуть строку `qx` (`messages:14645, 1697-1699`; 0.195.0 —
  `onlyfans-SstGvKHV.js:16177`).

Поэтому обещаем одинаковый **отображаемый** текст и переносы на путях «Открыть и вставить»
+ Send и X8, а не одинаковые байты HTML. Кавычки не экранируем: `&quot;` и `&#39;` в
текстовом узле значат те же символы и смысла не меняют, нужды в них нет. `\r\n` → `\n`.
Markdown и сырой HTML модели не допускаются. Пустое, незавершённое или аналитическое
содержимое не отправляется. Лимит черновика превью — 5000 символов на все части.

**Флаги `isAiGenerated` и `isCopied` — решение и почему.**
- `isAiGenerated` считаем по правилу самого ChatSpace для его AI-подсказок
  (`messages:18139-18184`):
  - переносы и края нормализуются;
  - непустое точное равенство проверяется раньше похожести (важно для коротких строк);
  - иначе — мера Dice по биграммам в нижнем регистре не меньше 0,85 (`messages:2623-2640`).

  Сравниваем с **исходной выбранной AI-частью**, сохранённой до правки, а не с уже
  отредактированным текстом. Мелкая правка — `true`, переписанный по сути текст — `false`.
- Dice служит только этой пометке. Для `sent`, `edited`, свежести и снятия опеки он не
  используется — там идентичности, ревизии и квитанция.
- **Почему так.** Это их собственная пометка «текст из AI». Действие стора передаёт её на
  сервер (`notificationEntry:1560 → 1493 → 1358`). Честная пометка с их же смыслом
  надёжнее, чем выдавать AI-текст за ручной. Интерфейс ChatSpace поле обратно не читает:
  все шесть мест в бандле — запись. Как пометка влияет на серверную аналитику OM, по
  локальному бандлу неизвестно. Ни авторства, ни доставки она не доказывает.
- **Последствие.** «Открыть и вставить» + Send даёт `false`: их обёртка поля ввода поле
  теряет (`notificationEntry:1639-1654`). Обещать равенство сетевых флагов двух путей
  нельзя. Мы это не чиним и не обходим. Владелец может выключить пометку флагом
  `previewSendMarkAiGenerated` без выпуска.
- `isCopied: false` — их признак значит «текст вставлен из буфера обмена»
  (`messages:18149-18186`). Буфер в X8 не участвует.

`previous_message` мы не передаём. Очередь сама берёт последнее сообщение из уже
имеющегося кэша чата или ставит `null` (`notificationEntry:1376-1383, 1480-1483`). Хабовую
ленту в кэш ChatSpace не пишем.

#### 6.7.2 Что уходит на сервер

Тело собирает их `gi` (`notificationEntry:1351-1366`) и отправляет их HTTP-клиент с их
сессией: `POST api/v0/accounts/{accountId}/chats/{chatId}/messages`.

| Поле | Значение |
|---|---|
| `text` | наш HTML |
| `is_copied` | `false` |
| `is_ai_generated` | по правилу §6.7.1 |
| `internal_template_id` | `null` |
| `reply_time` | `null` (у `gi` всегда) |
| `previous_message` | `null` у неоткрытого чата; `{id, created_at, is_fan_message}`, если кэш чата есть |
| `platformMetadata` | `{}` |

В нашем коде нет ни POST, ни токена OM, ни заголовков авторизации.

#### 6.7.3 Без открытого чата и что меняется в ChatSpace

| Ситуация | Что происходит |
|---|---|
| composer цели никогда не монтировался | `enqueue` использует только аккаунт, чат и текст; от DOM, маршрута и вкладки не зависит (`notificationEntry:1543-1564`) |
| очередь аккаунта свободна | `g(accountId)` сразу запускает отправку, статус SENDING ставится до первого `await` (`:1472`, `:1528-1541`). Возврат `enqueue` — не успех |
| очередь аккаунта занята | очередь последовательная по аккаунту. В первой версии X8 отказывает до `enqueue`: «Дождитесь текущей отправки» (`CG-SEND-BUSY`). Старый текст в чужую очередь не ставим |
| вкладки чатов | вкладка не открывается, маршрут не меняется. Счётчик `newMessagesByChatId` растёт только от сообщений фана (`accounts:8660-8667`) |
| список ожидающих | запись лежит в `messagesByAccountId`. Видна в ленте этого чата, когда человек его откроет (`notificationEntry:1631-1637`) |
| черновики | ни текущий, ни сохранённый черновик цели не очищаются: очистку делает верхний уровень поля ввода после своего `enqueue` (`messages:18690-18696`; 0.195.0 — `onlyfans-SstGvKHV.js:20248-20254`), а его мы не вызываем |
| ошибка | нативная кнопка «в поле ввода» восстанавливает нашу часть; Resend и Cancel — действия человека в ChatSpace (Б12) |
| успех, кэш чата есть | ChatSpace добавляет сообщение с id сервера в кэш (`:1457-1470`) |
| успех, кэша нет | ChatSpace вызывает `invalidateQueries` по точному ключу. Записи нет или она неактивна — запроса истории нет (`composables:603-614`, `:569`). Если активна или грузится — запрос был бы, поэтому такая цель — отказ до `enqueue` (§6.7.4, п. 7) |
| список чатов | после эха строка поднимается наверх, `unreadMessagesCount: 0` (`accounts:6295-6307`). Чата нет в загруженных страницах — ChatSpace перечитывает список. Это чтение списка, не истории |
| typing | не шлётся: «печатает…» идёт только от ввода в редакторе (`messages:18378-18397`) |

#### 6.7.4 Условия отправки

Очередь не делает проверок кнопки Send, поэтому их делаем мы. Контроллер проверяет —
чтобы объяснить причину на кнопке. MAIN проверяет ещё раз прямо перед `enqueue`, в
одном синхронном шаге. Все чтения — без побочных эффектов: никаких `ensureFans`,
`refreshPermissions`, `getToken`, загрузки истории.

| # | Условие | Источник и решение | Код |
|---|---|---|---|
| 1 | Человек и часть | доверенный клик нашего UI или активация кнопки с клавиатуры; генерация завершена (`done`); выбраны вариант и часть; актуальная ревизия черновика превью; одноразовая попытка. Enter в composer, таймер, тост и `done` не отправляют | `CG-SEND-PART` |
| 2 | Идентичность | адрес хаба, пользователь и эпоха входа, `pageId` и ревизия привязки, `personaDefinitionId`, аккаунт OM, `platformAccountId`, фан, эпоха документа моста совпадают с замороженной операцией | `CG-CONTEXT-CHANGED` |
| 3 | Флаг | `dispatch` хаба с атомарной проверкой актуального флага (§6.7.11) и локальная защёлка в MAIN | `CG-SEND-OFF` |
| 4 | Профиль квитанции | отпечатки существенных модулей и проверки формы совпадают с проверенным профилем из `limits.previewSendReceiptProfiles` или там профиль-метка «любая сборка» (§6.2, решение X25); предохранитель X8 этого браузера не держит сборку вкладки | `CG-SEND-RECEIPT`, `CG-SEND-FUSE` |
| 5 | Сессия OM и аккаунт | аккаунт есть в загруженном `accounts` с тем же `platformAccountId`; права загружены | `CG-SEND-PERMISSION` |
| 6 | Не текущий чат | цель — не чат открытого маршрута: для него есть поле ввода и док | `CG-SEND-ACTIVE-CHAT` |
| 7 | Нет загрузки истории цели | точный запрос `["chatMessages",acc,fan]` либо отсутствует, либо без активных или грузящихся наблюдателей; иначе отказ, «Открыть и вставить» | `CG-SEND-HISTORY` |
| 8 | Права роли | в `["userPermissions"]` нет `of_block_message_sending` (`composables:85412, 86182, 86604`; их проверка — `ChatView:4845-4858, 7700-7711`). Владельца мы не распознаём, поэтому строже | `CG-SEND-PERMISSION` |
| 9 | Фан | известные запреты страницы важнее данных хаба: фан есть в `fansMap` этого аккаунта и `isBlocked`, `canReceiveMessages === false` или (по консервативной проверке) `isRestricted` — отказ (`accounts:7047-7062, 8306, 8470-8475`; `ChatView:8274`). Отсутствие записи в `fansMap` само по себе нативную отправку не запрещает: их проверка пропускает отсутствующую запись (`accounts:8469-8474`), быстрый ответ шлёт без карточки фана (`notificationEntry:21931-21937`). Наше ограничение: нужна подтверждённая хабом **текущая активная подписка этой страницы** — целевой элемент `pages[]` в `spenderDetail` (не любой элемент и не общий статус фана) или явное текущее `isSubscriber/subscriptionStatus` со временем данных в H-7. Строка «Новых» сама по себе не подписка. Истёкшие или неизвестные сведения — отказ. `ensureFans`, история и любые запросы OM ради пробела запрещены | `CG-SEND-FAN` |
| 10 | Mimic | если Mimic поддержан для платформы (`ChatView:4851-4853`): данные `mimicSettings`/`mimicChats` загружены и для чата не `enabled` (`inbox:192, 234-254, 637`). Нет данных — не «выключено», а отказ. Mimic мы не останавливаем | `CG-SEND-MIMIC` |
| 11 | Переводчик | `composerTranslator` аккаунта: `enabled && autoTranslate` (`messages:2848-2869, 3083`; 0.195.0 — `onlyfans-SstGvKHV.js:3404-3425, 3639`) или статус неясен — отказ: прямая очередь обошла бы перевод. Переводчик не выключаем, сами не переводим | `CG-SEND-TRANSLATOR` |
| 12 | Смена | в 0.172.0 рабочей смены на клиенте нет (`shift` в бандле — клавиша); доступ решает сервер. Если организация требует смену, а подтвердить её пассивно нельзя, — возможность выключена флагом страницы. Отказ сервера — `rejected` | `CG-SEND-PERMISSION` |
| 13 | Очередь аккаунта свободна | `processingByAccountId[acc]` ложно, записей PENDING/SENDING нет; записей чата меньше 50 (`notificationEntry:1426, 1544`) | `CG-SEND-BUSY`, `CG-SEND-QUEUE` |
| 14 | Свежесть и охват | целевой аккаунт подписан ChatSpace на сокете страницы и взведён (§6.7.5, §6.8 п. 9); счётчики с точки свежести не изменились | `CG-SEND-STALE`, `CG-SEND-FRESHNESS` |
| 15 | «Новые» | действующая бронь, `dispatch` подтверждён (§8.6, H-7) | `CG-CLAIM-BUSY`, `CG-CLAIM-EXPIRED` |
| 16 | Message Guard | своей проверки нет (Б10). Серверный отказ `MESSAGE_GUARD_VIOLATION` → FAILED `blocked` с темами (`notificationEntry:1513`; разбор `:1305-1339`). Показываем его; эту же неизменённую часть повторно не отправляем | `CG-SEND-GUARD` |

**Цена условия 9.** Допуск по подписке — ограничение нашего продукта, а не сертификат
нативного `canReceiveMessages`. Отсутствия блокировки на стороне платформы он не
доказывает. Исход по-прежнему решает точная квитанция:
- при известном окончательном отказе — `rejected`;
- при недоказанном исходе — `uncertain` с сохранением опеки.

Правило согласовано с B (раунд 5).

#### 6.7.5 Свежесть: «фан написал что-то новое»

**Источник** — сырые кадры `account_new_message` (тап, §6.8): `account.account_id`,
`message.chatId`, `message.id`, `message.is_from_fan`, `message.sentAt`, `platformMetadata`
(структура видна в `accounts:6356-6368`, `messages:21415-21428` — в 0.195.0
`onlyfans-SstGvKHV.js:23276-23289`, нормализатор
`composables:86872-86880`). Не счётчики непрочитанного, не DOM, не вебхуки хаба.

**Счётчики в MAIN.**
- Каждое впервые увиденное сообщение фана увеличивает счётчик `(аккаунт, фан)`.
- Дубликаты отсекаются по `(аккаунт, фан, id)`.
- Пока операция ссылается на счётчик, он не вытесняется.
- Ведутся эпохи: сокета (новый сокет — новая эпоха) и подписки аккаунта.

**Контрольная точка** ставится синхронно в MAIN на клике Generate — до брони и до
запроса в хаб:
`{documentEpoch, socketEpoch, subscriptionEpoch, accountId, fanId, fanSequence,
lastFanMessageId, observedAt, coverage}`.
- Операция хранит её неизменной.
- «Сгенерировать заново» ставит новую точку; правка старого результата — нет.

**Готовность.** Аккаунт взведён, только если:
- тап стоит;
- сокет открыт и прошёл `authenticated`;
- аккаунт подписан ChatSpace;
- на этой эпохе сокета пришёл хотя бы один кадр этого аккаунта.

`subscribedAccountIds` ChatSpace ставит до отправки подписки (`accounts:9481-9482`), поэтому
одного членства мало. Нет доказательства — «Не удалось проверить свежесть»
(`CG-SEND-FRESHNESS`), а не «нового нет».

**Неизвестно** (`coverage: unknown`): непонятные направление или id, потеря кадров,
переполнение, переподключение, снятие подписки, сон и пробуждение с разрывом наблюдения.

**Новое сообщение фана** после точки — в том числе медиа или пустой текст — удерживает
отправку: «Фан написал что-то новое. Обновите ответ» (`CG-SEND-STALE`).
- Повторный клик удержание не снимает.
- Действия:
  - новая генерация, когда архив хаба получит это сообщение (превью показывает
    отставание архива; хаб опрашиваем раз в 5 с до 2 мин);
  - «Открыть и вставить».
- Живой текст фана не попадает ни в ленту превью, ни в контекст AI, ни в рекап, ни в архив.

**Дополнительно — обслуженный контекст (H-4).** Это защита от сообщения фана, которое
страница уже видела **до** Generate, но которое ещё не попало в контекст модели. Счётчики
после Generate действуют как раньше.
1. Кадр `context_v1` относится к конкретному `generationRef` и неизменному снимку
   генерации. Он сообщает фактически выбранный `source` и `servedHead` — голову после
   нормализации и ограничения окна. Голова обычного архива — только отдельная диагностика:
   модель может получить union, пока архив отстаёт (`context/index.ts:185-240`).
2. Запрос из превью передаёт **только id** известных сообщений фана из точки свежести —
   `knownFanMessageIds`, до 10, новые первыми (контракт R01). Это проверка наличия, а
   не `liveTextContext` и не импорт текста. Хаб проверяет область страницы и фана и
   отвечает для каждого id `included | absent | deleted | unknown`
   (`knownFanMessages[]`) — по контексту, который реально обслужил генерацию.
3. Ответы:
   - `included` снимает именно этот известный разрыв; удержание снимается, только когда
     включены все названные id;
   - `absent` и `unknown` удерживают X8;
   - `deleted` клиент не воскрешает и не считает «модель видела». Выход — новая генерация
     или проверка человеком.

   Нет известного id — доказательство полной истории не выдумывается, действует обычная
   ограниченная гарантия наблюдения.
4. Более поздний `head` ленты старый ответ свежим не делает. Обновление архива позволяет
   **заново сгенерировать** ответ; голова и точка старой генерации неизменны. Сообщение после
   Generate удерживает отправку по счётчику, даже если потом оказалось в хабе.
5. Кадра нет, он устарел или его смысл не поддержан — X8 закрыт, а архивный AI и «Открыть и
   вставить» работают. Новый кадр выдаётся только по согласованной возможности; старые SDK
   его не получают.

Один id доказывает наличие этого id, а не всех промежуточных сообщений. Если известных
неподтверждённых id несколько — проверяется ограниченный набор, а не максимальный id. id
остаются строками, их величина не считается порядком доставки.

**Перед `enqueue`** MAIN в том же шаге сравнивает точку с текущими счётчиками и эпохами.
Ждать в занятой очереди аккаунта запрещено: фан мог бы написать между кликом и поздней
отправкой. Новое сообщение после первой отправленной части Split удерживает остальные.

**Точная граница обещания.** Это гарантия по событиям, доставленным странице до
передачи сообщения нативной очереди. Она не может доказать, что сервер не получил
сообщение фана, которое ещё в пути к браузеру.
- После `enqueue` нативный HTTP-клиент ещё асинхронно получает токен
  (`composables:86160-86165`). Атомарной серверной проверки «отправь, только если фан
  ничего не писал» у этого вызова нет.
- После перехода в SENDING мы не отменяем запрос, будто он точно не ушёл. Новое событие
  показываем, но повтора оно не создаёт.

Тесты проверяют событие между кликом, `dispatch` хаба и `enqueue`.

#### 6.7.6 Квитанция и эхо: связь по id, а не по тексту

`enqueue` возвращает локальный UUID, а не результат отправки. Подтвердить нашу
отправку по их стору нельзя:
- `confirmEchoedMessage` сравнивает простой текст и id сообщения не знает
  (`notificationEntry:1574-1587`);
- без кэша обработчик эха выходит раньше подтверждения (`messages:21420-21422`; 0.195.0 —
  `onlyfans-SstGvKHV.js:23281-23283`);
- запись исчезает и при успехе, и при отмене, сбросе, выходе, удалении аккаунта, позднем
  текстовом эхе.

Поэтому нужен узкий наблюдатель ответа нативного запроса — без своей сети:
1. Он включается только на время нашего синхронного вызова `enqueue` при свободной
   очереди аккаунта. MAIN подставляет на этот стек функцию-наблюдатель вместо
   `globalThis.fetch`, с нашим `attemptId` в замыкании. В `finally` сразу после возврата
   `enqueue` прежнее значение возвращается — если глобал всё ещё наш.
2. Почему это работает:
   - их цепочка `m → gi → K().post` создаёт запрос Ky синхронно, до первого `await`;
   - конструктор Ky в этот момент берёт `n.fetch ?? globalThis.fetch.bind(globalThis)`
     (`composables:63235`);
   - дальше запрос идёт асинхронно, а захваченная функция уже связана с нашей попыткой;
   - клиент ChatSpace свой `fetch` не задаёт (`composables:86155-86178`).
3. Наблюдатель пропускает **все** вызовы в прежнюю функцию без изменений: метод, адрес,
   тело, заголовки, `signal`, возвращаемый Promise и Response.
   - Сам `fetch` не зовёт, не задерживает его, не повторяет, ответ не подменяет.
   - Для точного POST `api/v0/accounts/{acc}/chats/{chat}/messages` держит ограниченную
     копию Request до чтения тела и копию Response; сверяет аккаунт, чат и текст.
   - Заголовки, cookies и токены не читает. Ошибка разбора копии влияет только на нашу
     уверенность.
4. Итог перехваченного ответа: `{attemptId, pendingId, accountId, fanId, httpStatus,
   platformMessageId?}`.
   - Успешный ответ с непустым id даёт `nativeAccepted`.
   - **401 — не исход.** Наш перехватчик видит первый 401 раньше нативного обработчика:
     - Ky сначала получает ответ, выполняет `afterResponse` и только потом решает,
       бросать ли ошибку (`composables:63160-63181`);
     - при 401 ChatSpace берёт новый токен и вызывает запрос заново
       (`composables:86134-86142`, вызов `:86168-86175`);
     - очередь ждёт всю цепочку (`notificationEntry:1484-1519`);
     - повторный запрос создаётся уже вне нашего захвата.

     Поэтому после 401 опека остаётся, `failed` в хаб не шлём, новой попытки не даём.
     Если квитанции завершившейся цепочки нет — `uncertain`.
   - `rejected` — только доказанный окончательный отказ:
     - перехваченный ответ 4xx, кроме 401, после которого нативная цепочка закончилась без
       продолжения (запись FAILED) — например, распознанный Message Guard
       (`MESSAGE_GUARD_VIOLATION`);
     - после 401 — только Message Guard, распознанный в конце цепочки (запись FAILED
       `blocked`, `notificationEntry:1513`): запрос с 401 сервер не принял, а повтор отклонён
       окончательно.
   - 5xx, сеть, нативный тайм-аут 30 с (`notificationEntry:1425, 1507-1510`), лишний или
     неоднозначный перехваченный вызов — `uncertain`. Повторной отправки нет никогда.
5. Сетевого повтора POST у нативного клиента нет (`retry: {limit: 2}` по умолчанию без
   POST, `composables:86155-86158`). Единственное продолжение — повтор после 401 (выше).
6. После `nativeAccepted(id)` ждём эхо `account_new_message` с **тем же id**, аккаунтом и
   фаном, исходящее.
   - Эхо может прийти раньше ответа HTTP: держим короткий буфер по id, потом склеиваем.
   - Текст — только проверка целостности уже связанной попытки, никогда не ключ.
   - id — строка, в число не приводим.
7. В UI: `nativeAccepted` — «Принято ChatSpace, ждём подтверждения», `sentObserved` —
   «Отправлено». Только `sentObserved` создаёт телеметрию `sent` (`via: 'preview'`) и
   «поприветствован» в «Новых», с `generationRef`, частью, `attemptId` и id сообщения.

Этот перехват — второй пассивный наблюдатель MAIN, не второе действие записи. Если
текущие модули не совпали с проверенным профилем квитанции (§6.2) или форма пути не
совпала — X8 выключен (`CG-SEND-RECEIPT`). Архивный AI и «Открыть и вставить» работают.

Своё наблюдение за стором дополняет квитанцию, но не заменяет её:
- PENDING и SENDING — для показа состояния;
- `cancel`, `resetForAccount`, `resetAll` после `enqueue` — `uncertain`;
- `enqueue` вернул `null` — `notEnqueued`, бронь остаётся годной.

#### 6.7.7 Опека, блокировки и состояния

```text
ready
  → preparing       доверенный клик; локальная блокировка фана; dispatch хаба
  → held            свежесть, условия или бронь не прошли — ДО нативной очереди
  → notEnqueued     enqueue вернул null при сохранённой границе вызова
  → nativeEnqueued  получен pendingId, отправка уже начата
  → nativeAccepted  точный id из ответа
  → sentObserved    эхо с тем же id

после возможного enqueue: тайм-аут / перезагрузка / потеря ответа / 401 без квитанции завершённой цепочки /
  сбой наблюдателя / неоднозначность → uncertain
доказанный окончательный нативный отказ (4xx, кроме 401; например Message Guard) → rejected
uncertain → sentObserved только когда поздно пришла вторая половина уже связанной пары
  (квитанция и эхо с тем же id); в ready — никогда
```

**Блокировки:**
1. UI выключает «Отправить» на первом клике.
2. Фон пропускает попытки по одной на `(hubOrigin, pageId, platform, fanRef)` — для
   Spenders, «Новых», всех вкладок и окон этого экземпляра. Набор `generationRef + вариант +
   часть + ревизия превью` не может дать две попытки при двойном клике.
3. До команды в MAIN фон пишет запись в журнал `send.journal` (`storage.local`): id
   попытки, цель, генерация и часть, документ, состояние, время, без текста.
   - Запись не сохранилась — `enqueue` не делаем.
   - Журнал неопределённости не зависит от 30-минутного срока текстов результата.
4. **Опека хаба** — для любой отправки из превью: и Spenders, и «Новые»
   (H-7, `dispatch`).
   - Хаб атомарно проверяет права, флаг, идентичность, отсутствие чужой неразрешённой
     отправки этому фану, а для «Новых» — бронь.
   - Отвечает одноразовым разрешением, переход в `dispatching` хранится бессрочно.
   - Повтор `dispatch` с тем же `attemptId` только читает состояние и не выдаёт нового
     разрешения после того, как команда могла уйти в MAIN.
5. MAIN хранит карту использованных попыток. Дубликат команды возвращает прежний
   статус и `enqueue` не вызывает. Фон не повторяет команду отправки после тайм-аута
   транспорта.
6. **Сбой между `dispatch` и `enqueue`.** Опеку снимаем только при положительном знании,
   что MAIN `enqueue` не вызывал: тот же живой документ явно отказал или вернул `null`.
   Отсутствие записи после перезагрузки — не доказательство. Лучше ложно удержать, чем
   отправить приветствие дважды.
7. После входа в нативную очередь мы не вызываем `resend`, `cancel`, `resetForAccount`,
   `resetAll`, `confirmEchoedMessage`. Отменил ли сервер отправку, доказать нельзя.

#### 6.7.8 Неизвестный исход

`CG-SEND-UNCERTAIN`: «Неизвестно, ушло ли сообщение. Повторно не отправляем».
- В превью нет «Отправить ещё раз», нет «Открыть и вставить эту часть», нет перехода к
  следующему фану с новым приветствием.
- Есть «Открыть чат для проверки» (переход по клику) и статус попытки.
- Опеку не снимают ни смена `attemptId`, ни повторный вход, ни закрытие окна, ни срок
  брони.

**Как разрешается:**
- поздно пришла вторая половина уже связанной пары → `sentObserved`. Одна квитанция даёт
  только `nativeAccepted`; `sentObserved` требует квитанцию **и** исходящее эхо того же
  аккаунта, фана и id;
- иначе — ручная операция поддержки (владелец или тимлид) в хабе с записью в аудит
  (H-7, действие `resolve`). Автоматического правила «в архиве нет — значит не ушло» нет.

Наша гарантия «без повтора» относится к ChatGoose. Ручной Resend человека в ChatSpace и
отправка из другого клиента — вне её. Мы их видим и показываем, но не считаем
разрешением продолжать. Десктоп на пилотных страницах не приветствует (операционное
правило).

#### 6.7.9 Части Split

- Один клик — одна часть.
- Части одной генерации — одна **группа**: `generationRef`, выбранный вариант, порядок
  частей. У каждой части своя попытка (группа, номер части, ревизия текста), своя опека и
  квитанция. Точка свежести у группы общая.
- После первой подтверждённой части «Новые» считают фана поприветствованным. Тот же
  владелец может явно отправить остальные части этой группы. Другая генерация и повтор уже
  подтверждённой части не проходят. Карточка показывает частичный прогресс и не предлагает
  второе приветствие.
- Следующая часть — новый клик, новая проверка свежести, своя опека.
- Частичный успех не откатывается. Один `uncertain` удерживает группу и фана.
- Нет «Отправить всё», отправки по таймеру и автоследующей части после эха.

#### 6.7.10 Атрибуция «Sent by»

- Отправка идёт в нативной сессии: заголовок `Authorization` ставит клиент ChatSpace из
  своего получателя токена (`composables:86160-86165`). Мы токен не копируем и id
  чаттера не подставляем.
- `is_ai_generated` — происхождение текста, `is_copied` — действие с буфером. Ни одно не
  означает автора.
- «Sent by» ChatSpace читает из журнала сервера `logs/messages/senders` → `user_id`,
  `origin` (`onlyfans:1407-1423`) и превращает `user_id` в имя (`onlyfans:1595-1610`).
  Особые `origin` — `auto`, `pmm`, `copilot`, `scheduled_messages` (`:1402-1407`); наша
  отправка их не получает. Имя видно только при праве `of_view_message_sender` (`:1520`).
- `ensureSenders`/`ensureUsers` мы не вызываем: они делают запросы. Если имени в памяти
  нет, пишем «отправлено через текущую сессию ChatSpace».

**Вывод по графу вызовов:** атрибуция будет нативной — очередь и кнопка Send идут через
один клиент сессии. Доказательство — только будущий ручной smoke: два разных
пользователя OM, по одной разрешённой отправке, проверка подписи после открытия чата
человеком. Пользователь хаба может отличаться от пользователя OM; один не подменяет
другого.

#### 6.7.11 Выключатель

- **Флаг** `flags.previewSend` — по странице, по умолчанию выключен. Выключен и тогда,
  когда сборка или условия не поддержаны.
- **Каждый клик** делает `dispatch` в хаб с атомарной проверкой актуального флага,
  независимо от кеша UI. Это маленький запрос к хабу, не к OnlyMonster.
- **Разрешение** — короткое, одноразовое, связано с попыткой и идентичностью. Пачки
  разрешений заранее нет. Задержка перед `enqueue` больше допустимого окна — `held`, а не
  поздняя отправка.
- **Флаг выключили:** живые контроллеры и MAIN сразу перестают делать новые отправки и
  отменяют ещё не переданные намерения. Готовые результаты сохраняются, «Открыть и
  вставить» работает.
- **Что значит «мгновенно»:** с момента выключения на сервере новые допуски не
  проходят. Уже начатая нативная отправка не отзывается — её исход отслеживается до
  конца. После перезапуска браузера сохранённого разрешения на отправку нет.

#### 6.7.12 Непрочитанное и критерий P1

На исходящее событие ChatSpace сам ставит `unreadMessagesCount: 0` и снимает
`isMarkedAsUnread` (`accounts:6295-6300`). Значит, после отправки из превью чат выглядит
прочитанным в их списке — даже без загрузки истории.
- Просмотр превью и генерация **без отправки** должны оставить чат непрочитанным.
  Иначе — P1.
- Отправка (X8 или руками) снимает непрочитанное штатно. Это ожидаемо и не P1.
- Непрочитанное мы обратно не восстанавливаем.

Серверная отметка прочтения на платформе этим кодом не доказана — проверяется отдельно,
в разрешённом тесте.

#### 6.7.13 Приёмка до включения флага на пилотных страницах

| Проверка | Ожидаем |
|---|---|
| холодная цель: нет composer, вкладки, кэша | ровно один `enqueue`; вкладка не открылась; ни одного запроса истории и отметки прочтения; текущий и сохранённый черновики целы |
| неактивный кэш / активный запрос истории | в первом случае — обновление кэша без загрузки; во втором — отказ до `enqueue` |
| непрочитанное | просмотр и генерация не меняют прочтение; после исходящего эха — штатное обнуление (`accounts:6295`) |
| HTML и флаги | одинаковый **отображаемый** текст и переносы (не побайтовое равенство HTML); случаи: `&`, буквальная строка `&lt;`, угловые скобки, обе кавычки, CRLF, пустые строки; без вложений, цены и цели ответа; `is_ai_generated` по правилу §6.7.1 против исходной AI-части, `is_copied=false`; `previous` считает сама очередь |
| очередь занята, Mimic, фан заблокирован, приём запрещён, нет прав, условия неизвестны | ноль `enqueue`, понятная причина; без обновлений ChatSpace, остановки Mimic, смены прав |
| автоперевод, смена, истёкшая сессия OM | условия не обходятся; своей авторизации и перевода нет |
| сообщение фана после Generate, в том числе в паузе перед `enqueue` | `CG-SEND-STALE`, ноль `enqueue`; правка текста удержание не снимает |
| обслуженный контекст: union свежее archive; дырка перед более поздним сообщением модели; известный id фана отсутствует или удалён; новое сообщение между точкой и `enqueue`; обновление ленты после завершения старой генерации | `absent`, `deleted`, `unknown` удерживают; `included` снимает только этот разрыв; более новая голова ленты старый ответ свежим не делает |
| тап поставлен позже сокета, разрыв, снятие подписки, переполнение, смена прав | `CG-SEND-FRESHNESS` или удержание; нет «свежо» по отсутствию событий |
| 20 быстрых кликов, две поверхности, вкладки, браузера | одна попытка; опека хаба и локальная блокировка не расходятся; второго `enqueue` нет |
| эхо раньше ответа; два одинаковых текста разных отправок | склейка только по id квитанции; чужое эхо не даёт `sent` и «поприветствован» |
| тайм-аут после реального POST, исчезновение записи, перезагрузка на каждой границе | устойчивый `uncertain`; повтор из CLI, RPC или UI не отправляет; позднее точное эхо может завершить |
| Message Guard, 401, 403, 5xx | Guard — явный `rejected`; «первый POST → 401 → нативный повтор → 200»: первый 401 ни на миг не освобождает фана, без связанной квитанции итог — `uncertain`; 403 — `rejected`; 5xx и тайм-аут — `uncertain`, не отказ |
| три части одного приветствия | один клик на часть; первая подтверждённая часть отмечает «поприветствован», остальные части той же группы отправляет тот же владелец; второе приветствие (другая генерация) запрещено; новая реплика фана блокирует остаток; подтверждённая часть второй раз не уходит |
| X8 выключен → «Открыть и вставить» → ручной Send | точное подтверждение по квитанции и эху; регистрация в H-7 без `previewSend`; права отправить что-то ещё не появляется |
| флаг выключен между готовностью UI и кликом | `dispatch` отклонён, ноль `enqueue`; выключение после начатой отправки не называется отменой |
| ручной Resend, cancel, выход в ChatSpace | автоповтора нет; исчезновение записи не считается успехом; нативные кнопки на месте |
| «Sent by» двух пользователей | в будущем разрешённом smoke — совпадает с сессией OM |
| изоляция трафика | наш транспорт — только хаб; нативная отправка вызвана ровно нашим действием; наблюдатель не создаёт, не меняет и не повторяет запросов и не читает заголовки авторизации |

Инструментальные тесты идут на нашем стенде. Живой smoke, проверка сети, атрибуции и
смены — работа будущего этапа по правилам владельца. До этих гейтов X8 спроектирован,
но не доказан как готовая возможность. На ChatSpace 0.195.0 smoke проверяет путь вместе
со слоем Sentry над `fetch` (§6.2): наблюдатель квитанции отдаёт вызов его обёртке, и на
сервер должен уйти тот же запрос.

#### 6.7.14 Медиа из vault с частью (X53)

Решение X53. Часть ответа может взять с собой медиа из vault, выбранные в панели «Медиа» превью: тот же один вызов
`enqueue`, что и в §6.7.1, только `hasAttachments: true`, `platformMetadata` и `composerContent.media` собраны, как их
собирает composer ChatSpace (`zk`, `Rk`):

| Поле | Значение |
|---|---|
| `platformMetadata.mediaFiles` | id медиа числами в порядке выбора; аудио — `{id, thumbId: 0}` |
| `platformMetadata.price` | цена в долларах, только если больше нуля ($3–$200) |
| `platformMetadata.previews` | id бесплатных превью, только при цене; при цене хотя бы одно медиа за ней |
| `platformMetadata.rfTag` / `rfGuest` | отметки соавторов из release forms медиа (строки), если есть |
| `composerContent.media` | `{medias: [{id, type, duration, isFree, imageUrl}], price, lockedText: false}` — для их «вернуть в поле ввода» |

Условия §6.7.4 те же; добавлено своё: выбранные медиа с неверной ценой, «всё бесплатно при цене» или с непрочитанными
отметками держат «Отправить» (`CG-SEND-MEDIA`). Квитанция §6.7.6 сверяет текст запроса, как и прежде; ответ она
разбирает до 1 МиБ — в нём могут быть подписанные адреса медиа. Что читает панель
(папки, медиа, статусы для фана, release forms) — свои запросы MAIN к API ChatSpace (`media`, X54, X53): ни один не
история чата.

### 6.8 Тап WebSocket

**Зачем.** Шина событий WebSocket ChatSpace закрыта внутри их модуля
(`composables:86366-86425`, карта `n3`, `listen`). Транспорт ставит `onmessage` свойством
(`:86276-86283`). Слушатели — обычные замыкания, не действия Pinia, `$onAction` их не видит.

Сторы дают сигнал о конкретном чате только в трёх случаях. Чат из превью обычно не
подходит ни под один:
- есть кэш сообщений чата (без него обработчик сразу выходит, `messages:21420-21422`);
- чат есть в загруженном списке или в сторе чатов (`accounts:6337-6344, 6352-6366`);
- чат открыт вкладкой (`:8660-8667`).

Поэтому: где хватает сторов — сторы. Для звука в остальных чатах и для свежести X8
нужен пассивный тап. Своего WebSocket мы не открываем.

**Правила тапа:**
1. Обёртка только над конструктором: `new Proxy(WebSocket, {construct})` с
   `Reflect.construct`.
   - Экземпляр, `instanceof`, статика и прототип остаются родными. На статику
     `WebSocket.CONNECTING`/`OPEN` их код опирается: `:86299`, `:86319`, `:86345`.
   - Прототип, `addEventListener` и сеттер `onmessage` не трогаем.
2. Слушатель `message` вешается только на сокет с адресом `l2.onlyMonsterWSUrl`
   (`composables:85389, 85404`). Остальные сокеты не трогаем.
3. Мы никогда не вызываем `send`, `connect`, `subscribe_account`, `reconnect`. Кадры не
   меняем, `stopPropagation` не вызываем. Исключения слушателя гасятся внутри. Время на
   кадр ограничено и меряется.
4. До `JSON.parse` — дешёвый фильтр по подстроке события (`account_new_message`,
   `authenticated`). Пока тап включён, нужные кадры разбираются всегда: счётчики свежести
   обновляются до любого прореживания. Пересылку в изолированный мир можно склеивать,
   счётчики — нельзя.
5. В MAIN ведутся счётчики по аккаунту и фану. Переполнение, ошибка схемы, потеря
   пересылки → охват `unknown`, а не «ничего нового». Текст сообщения тап не
   пересылает: только id, направление, аккаунт, чат и время.
6. **Аккаунт взведён:** на текущем сокете было `authenticated`, аккаунт в
   `subscribedAccountIds`, и на этой эпохе сокета пришёл хотя бы один кадр этого аккаунта.
   Закрытие сокета — разрыв, эпоха растёт, отсчёт заново.
7. ChatSpace создаёт новый сокет на каждом переподключении (`:86274-86283`). Поэтому
   поздняя установка тапа исправляется сама при следующем переподключении. До него — `unknown`.
8. Вкладка, открытая до установки или обновления расширения, тапа не имеет: отсутствие
   событий — не «всё хорошо». Нужна перезагрузка вкладки человеком (баннер в доке).
9. Если целевой аккаунт не подписан на сокете страницы, X8 для него выключен. Скрытых
   вкладок мы не открываем и `subscribe_account` не шлём. Другой фан в уже подписанном
   аккаунте открытия своего чата не требует.
10. Фон регистрирует тап динамически:
    `scripting.registerContentScripts({world: 'MAIN', runAt: 'document_start',
    persistAcrossSessions: true})` — только при флаге `wsTap`.
    - Флаг выключили — регистрация снимается для будущих документов, текущий экземпляр
      получает команду «выключись».
    - `world` у зарегистрированных скриптов в Firefox есть с версии 128.
11. При очистке глобал восстанавливается, только если он всё ещё наш. Чужую, более
    позднюю обёртку не сносим.
12. Кадров нет при живом сокете — деградация: звук по сторам, свежесть X8 `unknown`,
    отправка из превью выключена, «Открыть и вставить» остаётся.

Тап и основной мост живут в одном MAIN-мире. Тап отдаёт подписку мосту через
неперечисляемое свойство `Symbol.for('wsTap')` (имя нейтральное, решение X22).

Страница может подписаться на него или подделать кадр — MAIN недоверенный. Чем это
кончится:
- подделанное «фан написал» только удерживает отправку;
- лишний звук безвреден;
- разрешить запись, допуск хаба или генерацию кадр не может: их даёт только фон по
  доверенному клику.

После обновления расширения открытые вкладки работают на старых скриптах. Новая версия
показывает в доке баннер «ChatGoose обновился — перезагрузите вкладку» (UP-009,
`CG-RUNTIME-RELOADED`).

Если будущая версия ChatSpace даст проверенный открытый наблюдатель событий с тем же
охватом и эпохой соединения, тап заменяется им внутри `HostPort`.

### 6.9 Навигация и список чатов

- `openChat` = `router.push({name: 'chat', params: {accountId, chatId}})` — то же, что
  клик по строке списка (строки — `router-link` с `data-chat-id`, `ChatView:6353`). Без
  `HumanCause` от фона метод не вызывается.
- `openAccount` = `router.push({name: 'chat', params: {accountId}})` (Б13).
- `listCachedChats(acc)` — активная запись `["chatList", acc, <фильтр>]`, то есть тот
  список, что видит человек. Порядок строк и `unreadMessagesCount` дают J/K, ⌘U, ⌘1–9 и
  подписи в палитре. Ради поиска `loadNextPage` не вызываем.
- Палитра ищет по уже загруженным чатам и аккаунтам и по данным хаба (Spenders, «Новые»),
  явно показывая, где искала.
- «Онлайн» (CS-030): фаны, которых ChatSpace уже показал онлайн (`isFanOnline` стора
  чатов), открываются в наше превью по явному действию. Своего опроса онлайна нет.
- Навигация и смена аккаунта — только как результат действия человека. Суммы и AI-метки в
  строки ChatSpace не встраиваем (Б9).

### 6.10 Чего мост не делает никогда

- своих запросов к `*.onlymonster.ai`, кроме чтения открытого чата (X54, `openChatMessages`), загрузки истории неоткрытых чатов;
- записей в сторы, кэш и ключи `chat-space:*` — кроме трёх записей §6.1;
- вызовов `resend`, `cancel`, `confirmEchoedMessage`, `resetForAccount`, `resetAll`;
- создания сторов и composables, вызовов `ensure*`, `refresh*`, `fetch`, `invalidate*`;
- `setInsertPayload` и `insertMessage`, синтетического paste (иначе `is_copied`);
- открытия скрытых вкладок, `subscribe_account`, восстановления непрочитанного;
- наблюдения за `body` с `subtree` и опроса DOM таймером;
- подделки `focus`/`blur`/`visibilitychange` и `OM_WINDOW`;
- записи прямо в `.ProseMirror` и в виртуальные списки;
- глобального CSS.

## 7. Жизненный цикл операций

**Состояния:** `admitted → requesting → streaming → done | failed | canceled | interrupted`.
- Решение о допуске атомарно — у единственного писателя в фоне.
- Допуск и идентичность записываются в журнал **до** запроса в хаб.
- Пользовательской очереди нет.

**Конкуренция (А3):**
- одна операция на чат во всём расширении — любая фича и поверхность: док, превью,
  «Новые», ход Coach, Recap, Review;
- до трёх на вкладку. Четвёртая — отказ `CG-OP-TAB-LIMIT` и список трёх активных: фан,
  фича, сколько идёт, кнопки «Перейти» и «Отменить». Тот же список — в палитре. Очереди и
  отложенного запуска нет;
- тот же чат в другой вкладке — `CG-OP-CHAT-BUSY` «идёт в другой вкладке»;
- повторный клик по уже работающему чату открывает его состояние;
- ход Coach с авто-рекапом — один составной слот;
- отправка из превью — не AI-операция и в лимит не входит.

**Жизнь в фоне:**
- смена чата операцию не отменяет;
- результаты хранятся в `storage.session` 30 минут;
- готово, а вкладка в другом чате — тост «AI готово · {фан}» с переходом в чат по клику;
- ошибка — тост «AI: не получилось · {фан}»;
- работающие операции видны в палитре.

**Отмена — только явно:** кнопка, ⌘. / Ctrl+., Esc в окне загрузки с подписью «Отменить».
Сама — только при смене персоны страницы, входа или адреса хаба.
- Закрытие вкладки-владельца отвязывает поверхность, но генерацию не отменяет. Поток может
  завершиться и сохранить результат; вставок без вкладки нет.
- Если среда оборвала работу (сбой, перезагрузка, выгрузка фона посреди потока), операция
  становится `interrupted`. Новый POST сам не делается.

**Ограда.** Операция несёт эпоху входа, `pageId` + `bindingRevision`,
`personaDefinitionId`, `ChatKey`. Кадр `meta` с чужой персоной:
- результат отбрасывается;
- каталог обновляется;
- тост `CG-PERSONA-CHANGED` (AI-140, AI-141).

При вставке всё сверяется заново (§6.4).

**Тайм-ауты** (стартовые; уточняются лабораторными замерами):

| Фича | до `meta` | первый чанк после `meta` | тишина | максимум |
|---|---|---|---|---|
| reply, fix, hi, ping | 30 с | 30 с | 30 с | 60 с |
| recap-short | 60 с | 45 с | 45 с | 120 с |
| review, recap | 180 с | 45 с | 45 с | 300 с |
| coach | 60 с | 45 с | 45 с | 180 с |

**Повтор.**
- Один прозрачный повтор — только структурированного `service_unavailable` (503) до
  первого кадра вывода, через 5 с (канон хаба). На экране — «Сервис недоступен, повтор
  через 5 с…» и «Отменить».
- Больше ничего само не повторяется: ни 502, ни EOF, ни тайм-аут, ни отправка.
- Кадр `error` терминален. Обрыв без `done` — `CG-STREAM-TRUNCATED`.
- Повтор не может породить два принятых платных запроса: у попытки своя корреляция.

**Кэш результата (AI-128).**
- Ключ — полная идентичность запроса: адрес хаба, пользователь и эпоха входа, страница и
  ревизия привязки, фан, определение персоны, фича, режим рекапа, окно, тон, Split,
  отпечаток черновика Fix, голова архива.
- Повторный клик с теми же параметрами открывает прежний результат с отметкой времени.
  Другие параметры — новая генерация.
- Новое сообщение фана — метка «устарело». В доке вставить всё равно можно, отправка из
  превью удерживается (§6.7.5).
- Кэш никогда не переходит между пользователями. Regenerate и Refresh его обходят.

**Разбор и Split (D-15):**
- Hi: `[VARIANT]` → варианты, внутри `[NEXT]` → части;
- Reply, Fix, Ping и черновики Coach: `[NEXT]` → части;
- очистка ответа (AI-135);
- Split заказан, а пришла одна часть — «Получилась одна часть», без автоматической
  новой оплаты (AI-011);
- поток показывает предварительный текст, но действия с результатом доступны только
  после `done` и разбора всего ответа.

**Свежий текст (D-14).** Берётся при старте: `readVisibleTail(N)`, N — предел из
bootstrap. Только при флаге `freshText` и возможности хаба `context-v1`. Кадр `context_v1`
в отладке показывает, сколько сообщений принято и отклонено.

**Превью и «Новые».** Тот же движок, поверхность `preview` или `newcomers`, без свежего
текста. Контрольная точка свежести ставится на клике Generate. Вставка — только
отложенная (§6.5), отправка — X8 (§6.7).

**Recap: общий и досье.**
- На `done` полного `fan-summary` — `profileFromGeneration(generationRef)` (H-5).
- Ответ `not-ready` → повтор через 5 с, 15 с, 60 с, дальше раз в 3 мин до 30 мин, пока
  вкладка открыта. Это идемпотентная серверная запись ссылки, не повтор генерации.
- Итог — «Сохранено в хаб» или `CG-RECAP-SAVE`.
- Полный и короткий рекапы — общие для всех допущенных чаттеров этой страницы, фана и
  персоны (H-13). «Открыть последний» работает у любого из них. Локальные слоты — только
  копии с id и ревизией общего артефакта.

**Фон и выгрузка.**
- Обработчики событий регистрируются синхронно, потом поднимаются хранилища. Все запросы
  ждут одного обещания готовности.
- Пока ChatSpace открыт, вкладка держит фон. Открытый порт сам его не держит: Firefox
  выгружает event page через 30 с без событий, доставленных фону (исключение — только
  порты native messaging); сообщения фона во вкладку и его собственные запросы таймер не
  сбрасывают. Поэтому зарегистрированная вкладка раз в 10 с повторяет по порту свой отчёт
  присутствия (BG-003). Без открытой вкладки ChatSpace фон выгружается через 30 с простоя.
- Перед выгрузкой — `runtime.onSuspend`: фон пишет запись о выгрузке и отдаёт Firefox
  обещание записи журнала; Firefox выгружает страницу, только когда она закончена (не
  дольше 5 с, `extensions.webextensions.runtime.timeout`). Начатая там и не отданная
  запись обрывалась выгрузкой, если хранилище было медленнее.
- Событие, доставленное фону во время `onSuspend` (в том числе `storage.onChanged` его
  же недавней записи), отменяет выгрузку: `runtime.onSuspendCanceled`, фон работает
  дальше, следующую попытку делает таймер простоя.
- После выгрузки новый экземпляр восстанавливает настройки, вход, результаты, брони,
  журнал отправок и очередь телеметрии.
- Оборванный поток не восстанавливается: операция `interrupted`, честная причина,
  повторного POST нет.

## 8. Слой хаба

### 8.1 Что расширение вызывает (только из фона, через вендоренный SDK)

| Операция | Зачем | Сейчас |
|---|---|---|
| `authIssueDeviceTokenWithPassword`, `authRevokeCurrentDeviceToken` | вход и выход (модель Fansly) | есть |
| `health` (+ `compatibleClientSdks`), `me` | связь, совместимость | есть / H-1 |
| `client/bootstrap` | кто вы, страницы, привязки, флаги, пределы, `minVersion` | H-2 |
| `aiPersonaCatalog` | каталог персон без текста промптов | есть |
| `streamAiFeature` | все генерации | есть (+ H-4, H-10) |
| `aiRecapStatus`, `pageConversationProfile`, `pageFanProfile`, `profile/from-generation`, общие рекапы | рекапы и досье | есть / H-5, H-13 |
| `spenders` v2, `spenderDetail`, `spenderBatch`, `pageSpenderAutoLists` | доска, панель фана, корзины | есть (`auth: any`, `routes.ts:6611, 6723, 6736, 6764`) |
| `spenders/stats`, `spenders/awaiting-reply` | статистика Spenders, очередь «ждут ответа» | H-8 |
| лента архива | превью Spenders и «Новых», «Обновить переписку», свежесть архива | H-9 |
| `client/audience-new`, бронь и опека | «Новые», отправка из превью | H-7 |
| `ingestObservations` | `ai_acceptance`, `client_health` | есть (`routes.ts:5679`) / H-11, H-14 |
| `client/ai-usage` | расходы AI за день в отладке | H-15 |

Никогда: `/ofapi/*`, поток событий хаба, полный текст персон, сырой шлюз,
`followerOutreachAttempt` (маршрут Fansly), `pageTopSpenders`.

### 8.2 Вход и опека токена

- Все переходы входа идут строго по одному через FIFO (AU-009).
- Токен, адрес хаба и пользователь записываются атомарно в `auth.token`. Метаданные —
  префикс, `issuedAt`, `expiresAt`, метка `Firefox · ОС · ChatGoose` (до R20 F9b — «… · ChatSpace»: расширение работает на двух сайтах, метка называет его, а не сайт), версия. Пароль живёт
  только во время запроса.
- Вход стирается только при 401 с `token_revoked`/`token_expired` по тому же токену
  (сверка отпечатка и эпохи). Тогда показываем причину (`CG-AUTH-REVOKED`,
  `CG-AUTH-EXPIRED`).
- 401 без причины — `CG-AUTH-REJECTED`, вход не стирается. 403 вход не стирает.
- Ответ на старый токен не трогает новый вход (AU-014).
- Выход: стереть → отозвать (5 с) → стереть ещё раз (AU-013). Тайм-аут входа — 20 с.
  Ответ `pending` не сохраняется (`CG-LOGIN-PENDING`).
- Адрес хаба меняется только без входа (ST-042).
- Любая смена входа увеличивает эпоху и отменяет операции.
- Назначение персоны хранит ссылку, а не тело промпта.

### 8.3 Bootstrap (форма H-2)

```ts
interface Bootstrap {
  protocol: 1; issuedAt: string; ttlSec: number /* 300 */; configRevision: number;
  minVersion: string;                                   // ниже — CG-HUB-OUTDATED, AI выключен
  identity: { userId: number; login: string; role: 'owner' | 'team_lead' | 'chatter' };
  pages: Array<{ pageId: number; pageLabel: string; title: string; platform: Platform;
    platformAccountId: string; bindingRevision: number;
    features: Partial<Record<FeatureFlag, { available: boolean; reason?: string }>> }>;
  bindingsByHost?: Record<string /* hostAccountId */, number /* pageId */>;   // явная привязка владельца
  flags: Record<FeatureFlag, boolean>;                  // аварийные выключатели
  limits: {
    freshTextMax: number; feedMax: number /* 100 */; deepMax: number /* 3000 */;
    audienceWindowHours: number; claimLeaseSec: number /* 120 */; claimRenewSec: number /* 40 */;
    claimActivityWindowSec: number /* 120 */; previewSendPerMinute: number /* 6 */;
    navInsertTimeoutSec: number /* 20 */; dispatchTicketSec: number /* 10 */;
    previewSendReceiptProfiles: ReceiptProfile[];       // допущенные профили пути отправки и квитанции:
                                                        // версия адаптера + отпечатки модулей; без кода и селекторов
  };
  capabilities: string[];   // 'context-v1', 'split-all-v1', 'archive-feed-v1', 'spenders-stats-v1',
                            // 'audience-new-v1', 'shared-recaps-v1', 'preview-send-custody-v1', 'client-health-perf-v1'
}
type FeatureFlag = 'insertion' | 'freshText' | 'newcomers' | 'spenders' | 'stats' | 'preview'
  | 'previewSend' | 'previewSendMarkAiGenerated' | 'fanPanel' | 'navigation' | 'wsTap' | 'sound'
  | 'coach' | 'recap' | 'review' | 'splitAll';
```

**Привязка:**
- `HostAccount.platformAccountId` → ровно одна страница с тем же `platformAccountId`;
- явная `bindingsByHost` важнее;
- страницы нет — `CG-BINDING-MISSING`, две — `CG-BINDING-AMBIGUOUS`;
- подбора по имени нет (AU-023).

**Кэш bootstrap** живёт `ttlSec`. Обновляется на старте, по сроку, при входе, по фокусу
(не чаще раза в 60 с) и по «Проверить связь». Фон стартует заново после каждой выгрузки
по простою (§7), поэтому на старте сохранённый bootstrap этого входа, пока он свежий, не
перечитывается, а обновляется по своему сроку; каталог персон — так же (5 минут). Фокус
не перечитывает bootstrap, прочитанный меньше 60 с назад, в том числе прошлым
экземпляром фона. При сбое — паузы 5/15/60 с. Истёкший
bootstrap запрещает новые чувствительные действия, но готовые результаты не стирает.
Исключение — генерация (решение X13, п. 12): пока в кэше есть bootstrap, истёкший не
больше двух своих сроков (2 × `ttlSec`) назад, она идёт по нему сразу, а обновление идёт
рядом. Если такого нет, генерация ждёт обновления, но не дольше собственного срока, и
пишет об ожидании в журнал. Навигация, `dispatch` отправки из превью и остальные
записи по-прежнему требуют свежего bootstrap. Вставка готового результата — тоже, кроме
молчащего хаба (решение X45): обновление не удалось из-за сети, тайм-аута или 5xx — тогда
вставку допускает кэшированный bootstrap этого входа, если выключатель вставки в нём
включён (`docs/hub-layer.md`).
Клиентское отключение функции — не защита API: сервер проверяет каждый метод сам.

### 8.4 Поток AI

Тело запроса — `aiFeatureStreamBodySchema` (`routes.ts:2103-2196`).

| Наша фича | Фича хаба | Особые поля |
|---|---|---|
| reply | `fast-reply` | `replyTone`, `replyMode` |
| fix | `improve-draft` | `draftText`, `replyMode` |
| hi | `hi-greeting` | `variantCount` 3 (в «Новых» — 1), `replyMode` (H-10) |
| ping | `ping` | `replyMode` (H-10) |
| review | `chat-review` | — |
| recap | `fan-summary` | `summaryMode: 'short'` для короткого |
| coach | `coach-chat` | `chatterQuestion`, `coachHistory`, `preset`, `draftText` (приложенный ответ), `replyMode` (H-10) |

**Общие поля:**
- `clientRequestId = opId`, `pageLabel`, `platform: 'onlyfans'`;
- `conversationRef = fanRef = platformFanId`;
- `personaKey` + `expectedPersonaDefinitionId`;
- `messageCount` — из окон настроек, глубокое не больше `limits.deepMax`;
- `isRegeneration`;
- `liveTextContext` (H-4).

**Заголовки:**
- `x-client-version: chat-extension/<версия>`;
- `x-kernel-ai-capabilities`: `debug-input-v1` (режим отладки), `context-v1`,
  `split-all-v1`. Заголовок принимает список через запятую (`ai/index.ts:333-335`,
  `prompt-debug-echo.ts:1-20`). SDK сейчас умеет только первую возможность
  (`sdk-runtime.ts:542-560`) — это H-4.

**Кадры** проверяются строгими схемами SDK (`routes.ts:1884-1935`):
- `meta` — сверка персоны, квота страницы;
- `content_delta`;
- `reasoning_delta` — только в отладке;
- `usage` — в лог всегда, на экран только в отладке;
- `debug_input_v1` — снимок промпта в память фона;
- `context_v1`, `error`, `done`.

Неизвестный кадр — ошибка. 429 `quota_denied` — `CG-QUOTA-DAILY` до 00:00 UTC.

### 8.5 Рекапы, Spenders, статистика, лента, «Новые»

**Рекапы.**
- «Открыть последний» читает общий рекап хаба (H-13), полный — также досье
  `pageConversationProfile`. Так закрывается ошибка Fansly «рекап только в хабе →
  `no_saved_recap`».
- Локальные два слота (вытеснение по 10) — копии общего артефакта с его id и ревизией.

**Spenders.**
- Доска: `/api/v2/spenders?scope=page&pageLabel=…&period=lifetime|30d|mtd|7d|today&limit=200&offset=…`.
  - До 1000 строк, 5 страниц по 2 параллельно, общий бюджет 120 с.
  - Рейтинг показывается раньше статистики.
- Кэш:
  - 10 мин в памяти и `storage.session`, общий для вкладок (SP-026, SP-027);
  - пустой ответ на 10 мин не закрепляется;
  - одинаковые чтения склеиваются по области, параметрам и эпохе входа.
- Тиры — корзины `pageSpenderAutoLists` хаба (`routes.ts:80-87`). Деньги — в mills и
  форматируются по правилам Fansly (SP-013).
- Статистика — H-8. Клиент не восстанавливает итоги страницы по видимым строкам, только
  показывает присланные значения.

**Лента** — H-9.
- Сегмент Ping (AI-038) и дни молчания фана считает хаб в сводке ленты. Функция и правила
  окна — те же, что у генерации (`ping-segment.ts:9-12, 22-55`; `features/index.ts:588-609`).
  Двух дат последних сообщений для этого мало: важно число текстовых сообщений фана.
- Для чипа конкретной генерации берём её метаданные.
- Неполные сведения — «неизвестно».
- По первой странице ленты клиент ничего не считает: первые 100 строк — не вся история.

**«Новые»** — H-7.
- Окно по умолчанию 48 ч; быстрые 24/48/72/168 ч и число 1–720 ч в пределах
  `limits.audienceWindowHours`. Окно фиксировано на весь проход по курсору.
- Опрос: раз в 30 с, пока окно открыто; раз в 60 с ради звука подписчика, пока есть живая
  рабочая вкладка; с разбросом и паузами офлайн. Не раз в 700 мс, как у Fansly (NF-004).
- Первый снимок и переподключение — без звука по старым подпискам. Новые события
  отсекаются по стабильному id события.
- Бронь берётся на «Сгенерировать», продлевается явно, снимается явно.
- «Поприветствован» — только по связанной паре квитанции и эха с одним id: для X8
  (`sentObserved`) и для отправки человеком из composer после «Открыть и вставить» (§6.6,
  регистрация в H-7).

### 8.6 Полный список изменений хаба

Каждое изменение — отдельный небольшой PR за флагом:
- сначала в хабе фиксируется контракт (схемы), расширение сразу живёт на поддельном хабе
  по этим схемам;
- порядок согласуется с потоком Sync Engine;
- у пакетов хаба R03–R06 один интегратор общих маршрутов, auth и проводки
  `features/index.ts`.

| H | Что | Маршрут и форма | Приёмка | Пакет · этап |
|---|---|---|---|---|
| H-0 | фикс доступа к персонам (#383) | без новых маршрутов | токен чаттера получает 403 на полные персоны и сырой шлюз; PR слит и выложен | R03 · сейчас |
| H-1 | набор совместимости | верхнеуровневое `health.compatibleClientSdks: string[]` (существующий закрытый `capabilities` не трогаем) | замороженные SDK старого Fansly, десктопа и нашего кандидата проходят health/me/pages/personas, AI SSE, схемы ошибок; кандидат зарегистрирован **до** выкладки хаба | R03 · до первого XPI |
| H-2 | `GET /api/v1/client/bootstrap` | форма §8.3 | старые клиенты не затронуты; привязка по `platformAccountId`; флаги и пределы приходят | R03 · M1 |
| H-3 | узкий токен расширения | при выдаче `client: 'chat-extension'`; область — **разрешённый список** операций §8.1 (не запрещающий) | 403 на `/ofapi/*`, поток событий, персоны, сырой шлюз; старые device-токены работают | R03 · пилот |
| H-4 | свежий текст и `context_v1` | `liveTextContext` только для Reply/Fix/Hi/Ping (остальным 400); слияние по platform message id; конфликт — 400 `context_conflict`; `contextScope = principal-draft`, никогда в архиве, наблюдениях, досье и общих рекапах. Кадр `context_v1` при возможности `context-v1` — снимок, который **фактически обслужил** эту генерацию: `{generationRef, source: 'archive' \| 'union' \| 'live-overlay', servedHead: {messageRef, occurredAt, isFromFan} \| null, window: {requested, served}, coverage, knownFanMessages?: {id, state: 'included' \| 'absent' \| 'deleted' \| 'unknown'}[], live: {accepted, rejected}, fanLanguageEvidence?: 'latin' \| 'cyrillic' \| 'mixed' \| 'unknown', archiveHead?}`. Голова обычного архива `archiveHead` — только диагностика. Запрос может передать `knownFanMessageIds` (до 10): только id из точки свежести, с проверкой области страницы и фана для каждого. Кадр — **для всех фич** нашего токена; старые SDK его не получают. Сейчас в контракте `context_v1` нет (`routes.ts:1883-1934`); источники и головы различает `context/index.ts:185-240`. В SDK `capabilities?: string[]` | план хаба §6; равенство голов с лентой — только на одном снимке и при одинаковой семантике id и выбранного reader; union свежее archive; дырка перед более поздним сообщением модели; id отсутствует или удалён | R03 · M2 |
| H-5 | Recap → досье | `profile/from-generation {generationRef}`: текст берётся из сохранённой генерации | идемпотентно; только полный `fan-summary` без `contextScope` того же пользователя, страницы и фана | R03 · M3 |
| H-6 | глубина 3000 | пределы архива и union 1500 → 3000; `messageCount` до 3000 уже принимается (`routes.ts:2115`) | полный Recap с 3000; покрытие видно | R03 · M3 |
| H-7 | «Новые» на OF, бронь и опека отправки | `GET /api/v1/client/pages/:pageLabel/audience-new?windowHours&cursor` (фиксированное окно, виды new/renewed/returning, `subscribedAt`, текущее `isSubscriber/subscriptionStatus` со временем данных, покрытие, сводка переписки, состояние брони). `POST /api/v1/client/pages/:pageLabel/fans/:fanRef/claim` разводит три вещи: (1) факт «первое приветствие подтверждено» — `greeting: {state: 'none' \| 'confirmed', at, messageRef}`; (2) бронь работы над одним приветствием — `claim \| renew \| release`, `leaseToken`; аренда 120 с, продление раз в 40 с, пока человек работает с фаном, общего потолка нет; (3) опеку одной отправляемой части — `dispatch \| sent \| failed \| resolve` с `attemptId`, `purpose: 'greeting' \| 'preview-reply'`, группой `{generationRef, variant, partCount}`, `partIndex`, `textRevision`. Ответ — `{greeting, lease, group: {generationRef, variant, sentParts, heldParts}, custody: {attemptId, state: 'dispatching' \| 'sent' \| 'failed' \| 'uncertain-held', ticket?}, serverNow, flagRevision}`; `GET` того же пути — статус. Правила: `dispatch` атомарно проверяет флаг `previewSend`, права, идентичность, отсутствие чужой неразрешённой опеки и (для приветствия) бронь → `dispatching` без срока + одноразовый билет. Подтверждение первой части отмечает фана поприветствованным и оставляет тому же владельцу право явно отправить остальные части группы. Другая генерация и повтор подтверждённой части не проходят; `uncertain` удерживает группу и фана. Повтор с тем же `attemptId` — только чтение. `failed` — только с доказательством непринятия. Действие `registerNativeSend {generationRef, variant, partIndex, platformMessageId}` регистрирует доказанную нативную отправку из composer: не требует `previewSend=true`, не даёт права отправить что-либо ещё; запоздалый отчёт не снимает чужую опеку. `resolve` — только владелец или тимлид, с записью в аудит. Поля и переходы замораживаются в R01. Отдельно от маршрута Fansly `followerOutreachAttempt` (`routes.ts:6818-6833`), его wire не меняем. Старая модель одной отправки (`follower-outreach.ts:4-45`: `reserved → dispatching → sent`, без группы и части) этих случаев не покрывает | два клиента, две вкладки, истечение аренды, гонка, сбой после `dispatch`; три части одного приветствия; запрет второго приветствия; «X8 выключен → «Открыть и вставить» → ручной Send → точное подтверждение»; неопределённость не освобождается сама; флаг выключен → `dispatch` отклонён | R05 · M4 (опека Spenders), M5 |
| H-8 | статистика Spenders | `GET /api/v1/client/pages/:pageLabel/spenders/stats?windowDays=30&timeZone=<IANA>` (`spenders-stats-v1`) → `{scope, metricVersion, timeZone, from, to, asOf, coverage, moneyUnit: 'USD-mills', basis: 'gross', days[], totals: {today, d7, prev7, d30}, payers, transactions, avgCheck, tiers[], silence: {d8to21, over21, unknown}, newPayers, queueSummary}`. Плюс `GET …/spenders/awaiting-reply?cursor&limit` с `total/loaded/unknown`. Кэш 60 с. Определения — §8.7 | цифры сходятся с `pageRevenueDaily` той же страницы (`routes.ts:6925`) и итогами `/api/v2/spenders` за ту же область, окно и `asOf`; страница с >1000 плательщиками; неизвестная история; смена порядка во время пагинации | R04 · M4 |
| H-9 | лента архива | `GET /api/v1/client/pages/:pageLabel/conversations/:fanRef/feed?cursor&limit` (`archive-feed-v1`), `limit` 1–100, по умолчанию 50. Курсор непрозрачный, подписан и привязан к странице, фану и снимку; порядок `(occurredAt, platformMessageId)`. Ответ `{target, snapshotRevision, asOf, coverage: 'complete' \| 'partial' \| 'unknown', head: {messageRef, at, sender} \| null, newestKnownAt, nextOlderCursor, items: [{messageId, at, sender: 'fan' \| 'model' \| 'system' \| 'unknown', text, automatic, deleted, tipMills, priceMills, attachmentLabels}], summary: {pingSegment: 'active' \| 'segment-a' \| 'segment-b' \| 'unknown', fanSilenceDays: number \| null, window, coverage, asOf}}`. Сводку считает хаб той же функцией и с теми же правилами окна, что у генерации (`ping-segment.ts:9-12, 22-55`; `features/index.ts:588-609`). Только БД и проекции архива; никакого OFAPI, refresh, backfill | тест с ловушкой исходящих запросов; пустой и частичный архив; одинаковые последние даты, но 1 и 3 текстовых сообщения фана дают разные A/B; тестовый чат остаётся непрочитанным; `pageConversationPreview/Messages` остаются только для сессии (`routes.ts:6790-6817`) | R04 · M4 |
| H-10 | Split во всех фичах с текстом фану | возможность `split-all-v1`: только при ней `supportsReplyMode` для `ping`, `hi-greeting`, `coach-chat` (части в блоках черновика); шаблоны; серверная проверка структуры. Recap и Review без изменений | старые клиенты не меняются, даже присылая `replyMode` (`fansly-chat/src/background/operations.ts:2912`); матрица «фича × Split вкл/выкл × старый/новый клиент»; Hi 1 и 3 варианта; маркер на границе чанков | R06 · M2 (Ping, Hi), M3 (Coach) |
| H-11 | `client_health` с замерами | вид `client_health` в `INGEST_KIND_ALLOWLIST` (`services/ingest-observations.ts:26-33`); версионный `performance`: гистограммы с границами, `count/sum/max`; процентили считает сервер; идентификаторы отбрасываются до долгой агрегации, в отчётах — группы от 20 наблюдений; витрина владельцу | ни текста, ни id фанов; p50/p95 по версиям видны | R04 · M6 |
| H-12 | канон и вендоринг | колонка «chat-extension» в `docs/error-handling.md` §2/§3 (прил. А); третий клиент в `vendor-sdk.mjs`/`vendor-hotkeys.mjs` и README хоткеев; producer `chat-extension@<версия>` вместо `desktop@` (`ingest-observations.ts:56-60`) | колонка полная; хеши вендоринга совпадают | R03 · M1 |
| H-13 | общие рекапы | `GET /api/v1/client/pages/:pageLabel/conversations/:fanRef/recaps?personaDefinitionId=` (`shared-recaps-v1`) → `{full: RecapBody \| null, short: RecapBody \| null}`, у каждого `generationRef`, `generatedAt`, покрытие, `personaDefinitionId`, текст. Тот же выбор, что `getFreshestUsableRecaps` (`ai-restricted.ts:89-141`, фильтра по пользователю нет), плюс исключение строк с `contextScope`. Сейчас `aiRecapStatus` отдаёт только метаданные (`ai/index.ts:138-172`) | два чаттера видят один рекап; приватный живой текст в выбор не попадает | R04 · M3 |
| H-14 | поля `sent` в acceptance | `ai_acceptance` `sent`: `via`, `attemptId`, `platformMessageId`. Конверт ingest уже принимает открытый `payload` (`z.record(z.string(), z.unknown())`, `routes.ts:1762-1769`), его хранит `ingest-observations.ts:198-205` — новой версии ingest не нужно. Если поля нужны в нормализованной витрине или ответе хаба, меняются проекция (`projections/ai-acceptance.ts:62-95` читает известные поля терпимо и новые детали не сохраняет) и read DTO; само расширение payload витриной не считается. Идемпотентность по `clientEventId` | регрессионный набор старых клиентов проходит | R04 · M2 |
| H-15 | расходы AI для отладки | `GET /api/v1/client/ai-usage?date=YYYY-MM-DD&pageLabel=` — только свой пользователь и выданная страница, один день, `timeZone/asOf/coverage`, суммы по фичам в microUsd, токены, счётчики | видно только в отладке; без этого маршрута журнал подписан «только этот браузер» | R04 · M6 |

### 8.7 Определения статистики Spenders (H-8, по B)

- **Выручка** — gross по проекции выручки хаба, с состояниями posted/pending/unknown и
  правилами возвратов. Чистая сумма креатора — отдельное поле. Своего ledger нет.
  Указываются включённые состояния и покрытие, чтобы итог сходился со Spenders за ту же
  область и окно.
- **«30 дней»** — 30 календарных дат, включая сегодня до `asOf`, в переданной IANA-зоне.
  7 дней и прошлые 7 — непересекающиеся календарные окна. Сегодня — неполный день.
  Изменение к прошлым 7 = `(сейчас − было)/было`; при было = 0 — `null`.
  Месячная метрика Fansly (`YYYY-MM`, UTC) — отдельная подпись, не «30 д».
- **Платящие** — разные фаны с положительной покупкой в окне. Число покупок отдельно.
  Средний чек = gross / число покупок. Округление — только для показа. Деньги — в
  `MoneyMills`, без дробной арифметики.
- **Полки** — непересекающееся распределение той же области, с остатком «Без тира».
  Сумма полок равна итогу при полном покрытии. Пороги и порядок — у хаба. Список и
  статистика берут один снимок.
- **Молчание** — 8–21 полных суток и больше 21 от последнего текстового сообщения фана,
  отдельно «неизвестно». Сумма трат молчащих — не потерянная выручка и не прогноз.
- **Ждут ответа** — последнее личное сообщение фана позже нашего. Непрочитанность
  неизвестна — отдельная категория «ждёт ответа; прочтение неизвестно». Сортировка по
  тратам и возрасту, курсор по стабильному ключу, отдельные `total/loaded/unknown`.
- **Новые плательщики** — известная первая покупка за 30 дней. При неполном прошлом —
  «первая наблюдённая», с пометкой.

## 9. Сквозные службы

### 9.1 Хоткеи

**Движок.** Канонический `@chatgoose/hotkeys` вендорится с точной версией и тестом
соответствия (HB-005, HK-033), клиент `extension`. Физический `event.code` (работает в
русской раскладке), строгие модификаторы, защита свежего нажатия, без автоповтора и во
время IME, сброс при потере фокуса окна (HK-018…HK-020).

**Один ранний диспетчер на вкладку** — в изолированном мире, на `document_start`,
`keydown`/`keyup` в capture на `window`.
- Он срабатывает раньше слушателей ChatSpace: их глобальный ставится при монтировании
  MainLayout, слушатели composer висят на потомках.
- До загрузки ленивого чанка нажатие ставится в очередь, показывается загрузка или
  причина (HK-024).
- Второго движка в панелях нет (HK-023).

**Приоритет:**
1. родное модальное окно и IME;
2. наш верхний диалог;
3. палитра, доска, превью;
4. действия дока;
5. навигация по чатам.

**Кому принадлежит клавиша.**
- Ранний диспетчер держит реестр «наш хост → его закрытый ShadowRoot»; ссылку на корень
  даёт монтирование (§10.2). Фокус внутри нашего UI он разрешает синхронно через
  `activeElement` нашего корня и состояние поверхности.
- Внешний `composedPath()` закрытый корень не раскрывает (MDN `Event.composedPath()`). Он
  нужен только чтобы понять, что событие пришло из нашего хоста.
- J/K, `]`, `?` и стрелки не работают, пока человек набирает текст в нашем поле или в
  composer.
- Перехват остаётся ранним: переносить его после нативного capture нельзя.
- AI-хоткеи работают в подходящем родном composer, но не в произвольном поле сайта.
- Наше действие: синхронно `preventDefault` + `stopImmediatePropagation` до родного
  capture. Чужое действие не трогаем.
- Фокус в нашем UI — клавиши, которые ChatSpace обработал бы сам, останавливаются;
  обычный набор текста проходит.
- Пока открыт наш диалог, на его хосте стоит `data-dismissible-open`.
- Отрицательные e2e доказывают, что родное действие не случилось. Отдельно проверяются J/K,
  стрелки, `]`, `?`, Enter и IME в полях поиска и черновика внутри закрытого корня.

| Комбинация (mac / win) | Действие | Где | Пересечение и решение |
|---|---|---|---|
| ⌘E / Ctrl+E | Reply | в чате | inline-code TipTap → наш capture раньше |
| ⌘I / Ctrl+I | Fix | в чате | курсив TipTap → то же |
| ⌘G / Ctrl+G, ⌘P / Ctrl+P | Hi, Ping | в чате | поиск и печать браузера → `preventDefault` |
| ⌘. / Ctrl+. | отмена | где есть наша операция | — |
| ⌘⇧H / Ctrl+Alt+H | Help убран (Б3) | в чате гасим, подсказка «пока убран» | — |
| ⌘⇧S / Ctrl+Alt+S | Recap | в чате | зачёркивание TipTap; Alt+S — переводчик OM в capture на composer (`messages:18364-18372`) → наш слушатель на `window` раньше |
| ⌘⇧O/B/L/C / Ctrl+Alt+O/B/L/C | тон, Review, Split, Coach | в чате | свободны |
| ⌘⇧M / Ctrl+Alt+M | Spenders | весь ChatSpace | — |
| `?` | шпаргалка | вне полей ввода | — |
| Esc | закрыть наше верхнее окно | когда наше открыто | Esc ChatSpace закрывает вкладку чата (`MainLayout-DBvnSRX2.js:331-333`) → `data-dismissible-open` + перехват |
| Enter | следующая часть | фокус на нашей карточке | в composer Enter отправляет → только вне composer (UI-023) |
| J / K, `]` | чаты, панель фана | вне полей и composer; не с фокусом в доке (решение X44: там клавиша изолируется и ничего не делает) | — |
| ⌘U / Ctrl+U | следующий непрочитанный | вне composer | Ctrl+U в Firefox — исходный код; проверка доставки, запасной Alt+U |
| ⌥1–9 / Alt+1–9 | N-й чат списка; удержание ⌥ / Alt 400 мс — «быстрый переход» | вне composer | с решения X45 (владелец, 2026-10-17) ⌘/Ctrl+1–9 отданы Firefox (его вкладки) и нигде не наши; на Linux Alt+1–9 — вкладки Firefox; проверка доставки |
| ⌘K / Ctrl+K | палитра | весь ChatSpace | поиск Firefox → `preventDefault` |
| ⌘, | настройки | — | на macOS это меню Firefox; есть кнопки в popup и доке |

В превью: ⌘P/E/G/I — генерация, ⌘. — отмена, Enter и ⌘↵ — «Открыть и вставить».
**Отправка из превью — только кнопкой** «Отправить»: клик или активация
сфокусированной кнопки с клавиатуры. Хоткея отправки нет.

**Политика:**
- в чате забираем все наши комбинации, даже недоступные, — с тостом причины (HK-026);
- вне чата — только глобальные;
- под шпаргалкой и доской — только шпаргалка, доска и отмена (HK-027).

**Риск зарезервированных сочетаний.** API `commands` не позволяет переопределять занятые
сочетания Firefox, а перехват в документе нужно проверить на деле.
- R17 на winpc и Mac составляет таблицу «доставлено / отменяемо / зарезервировано».
- Зарезервированные сочетания не показываем как работающие. Те же действия всегда есть
  в палитре и кнопках.
- Если обязательное сочетание браузер не отдаёт, перед закрытием HK-036/037 нужно узкое
  решение владельца по запасному сочетанию.

### 9.2 Логи

- **Запись** — `LogRecord` (§5.7). Уровни: `debug` — только в режиме отладки,
  `info`/`warn`/`error` — всегда.
- **Вымарывание** (LG-003) — общее до консоли, диска и выгрузки:
  - запрещённые поля: `authorization`, `bearer`, `token`, `password`, `cookie`, `session`;
  - образцы `sk-…`, «метка=значение»;
  - хвост текущего токена; список секретов обновляется при входе и выходе;
  - разрешённый список полей полезной нагрузки.
- **Пределы записи** (LG-008): глубина 8, массив и ключи по 100, строка 20 000; итоговая
  запись ≤ 8 КиБ; из UI в фон ≤ 4 КиБ (LG-011). Ошибка — `name/message/stack/code/detail/cause`.
- **Тексты не пишем никогда:** ни переписку, ни черновики, ни промпты, ни ответы модели,
  ни URL с параметрами — только длины и отпечатки.
- **Как пишется:**
  - кольцо на 1000 записей в каждом контексте;
  - фон пишет в IndexedDB `cg-logs`: текущая и две прошлые сессии, до 20 000 записей,
    10 МиБ и 7 дней — что наступит раньше (LG-004…LG-006, LG-023);
  - логгер никогда не бросает исключений и не тормозит работу (LG-012); переполнение и
    потери видны в диагностике.
- **Счётчики** по CG-коду за день (LG-010). День — календарный день браузера: счётчики
  сегодняшнего и предыдущего дня (коды и числа, ничего больше; до 16 КиБ) лежат в
  `storage.local` под ключом `log.counters` и переживают выгрузку фона, обновление и
  переустановку расширения, перезапуск браузера. Пишутся через 2 с после изменения и
  никогда — в `runtime.onSuspend`: запись в хранилище возвращается фону событием
  `storage.onChanged`, а событие отменяет выгрузку. «С запуска» — счёт текущего экземпляра
  фона, нигде не хранится. «Очистить локальные данные» их обнуляет, выход — нет (как
  журнал).
- **Журнал проверок «Новых»** — до 8 запусков, до 100 000 событий метаданных и 10 МиБ;
  обрезка помечается.
- **Обязательные события:**
  - старт: версии расширения, Firefox, ОС, отпечаток ChatSpace, итог контракта (LG-016);
  - вход и выход (LG-013);
  - маршрут, вставки и их отказы, попытки X8 по состояниям — журнал разбора P1 (LG-017);
  - сбои телеметрии и AI (LG-014, LG-015);
  - жизненный цикл и обновления расширения.
- **Выгрузка** (LG-020…LG-025):
  - «Скопировать отчёт» — короткий текст без секретов;
  - «Выгрузить диагностику» — JSON и короткий TXT, до 2 МиБ: версии и флаги без секретов,
    выбранные настройки, статус хаба и контракта, счётчики, 500 последних записей и хвост
    прошлой сессии, метаданные очередей телеметрии (без содержимого), диагностика звука,
    снимок операций и попыток X8 без текста.

  Пакет вымарывается ещё раз целиком (LG-022). Скачивается со страницы настроек через
  Blob, право `downloads` не нужно.
- **Ошибки** страниц расширения и вкладки (`onerror`, `unhandledrejection`, ошибки RPC)
  пишутся в лог (ER-021…ER-023). Ошибки чужих скриптов сайта как свои не собираем.

### 9.3 Режим отладки

Переключатель `debug.enabled` (ST-097) включает:
- консольные `debug`-логи;
- запрос эха промпта (`debug-input-v1`). Хаб отдаёт его только в окне, открытом
  владельцем (DB-003);
- профайлер этапов (DB-011, DB-016):
  - клиент: клик → запрос → `meta` → первый чанк → `done` → разбор → отрисовка → вставка;
  - хаб: этапы из манифеста;
- живой таймер раз в 100 мс в развёрнутом виде (DB-012);
- строку usage: токены in/out/cache и стоимость `costMicroUsd` (Б4, DB-017, DB-018, UI-030);
- рассуждения модели, если провайдер их прислал (DB-014);
- карточку контекста: `context_v1`, голова архива, досье, покрытие (DB-009);
- журналы: операции, вызовы хаба, проверка «Новых» с «Копировать» и «Сохранить .txt»
  (NF-029);
- детали контракта хоста (DB-031, ST-032);
- траты по фичам за день и 7 дней (DB-022) и «AI сегодня $» в popup (PU-016).
  - Источник — H-15, а пока его нет — локальный журнал по кадрам `usage` с подписью
    «только этот браузер».
  - Сумма локального кэша не выдаётся за полные дневные расходы;
- трассировку рендера `debug.renderTrace` — хранится у нас, а не в `localStorage` страницы
  (LG-027).

**Снимок промпта:**
- живёт только в памяти фона: 12 мин, не больше 10 штук (DB-004);
- блоки до 500 000 символов, манифест до 100 000, с пометкой «обрезано» (DB-005);
- во вкладку уходит только непрозрачный токен и счётчики (DB-006);
- текст открывает страница расширения `debug-prompt.html?t=…` (DB-007). Она не
  web-accessible, токен не попадает в DOM и адрес сайта;
- «Копировать промпт» — явное действие внутри неё;
- «эхо выключено» и «из кэша» объясняются (DB-008).

Выключение отладки или выход очищают всё. Выгрузка фона может потерять снимок — тогда
честное «истёк».

В свёрнутом доке отладочных блоков нет — они видны после разворота (DB-020). Деньги AI
и токены вне отладки не показываются нигде; кредиты хаба не показываются никому.

### 9.4 Настройки и хранение

- **Владелец настроек — фон.**
  - Записи идут по одной, одним `storage.local.set`.
  - Изменения расходятся через `storage.onChanged` и событие `settings.changed`; вкладки и
    страницы применяют их сразу (ST-018, BG-005).
- **Миграции** — нумерованные, только вперёд, на старте фона до первого ответа.
  - Хранилище новее сборки → «только чтение» с баннером (ST-016, `CG-STORAGE-VERSION`).
  - Битая необязательная настройка → значение по умолчанию и запись в лог.
  - Вход и идентичность никогда не «угадываются».
  - Сбой чтения не стирает настройки.
- **Страница настроек.**
  - Автосохранение: дебаунс 300 мс, переключатели — сразу.
  - «Сохранено ✓» — только по подтверждению фона с ревизией; иначе «не сохранено» и
    «Повторить» (ST-013…ST-015).
  - `pagehide` — запись «по возможности»: асинхронную запись браузер в этот момент не
    гарантирует.
- **Окна сообщений (Б5)** — степпер, колесо мыши значение не меняет, чип «сохранено как
  N» (ST-090…ST-094). Глубокое окно больше `deepMax` обрезается с подсказкой.

**Пределы хранилищ:**

| Хранилище | Предел |
|---|---|
| результаты | 24 на вкладку, до 4 МиБ на всё расширение (`storage.session`) |
| Coach | 5 сессий по 50 обменов, до 2 МиБ |
| превью архива | 10 лент по 100 сообщений, до 2 МиБ |
| списки | до 1000 видимых записей с пометкой «обрезано», остальное — курсором сервера |
| черновики превью и приветствий | до 100 штук и 1 МиБ; до отправки или сброса, не дольше 7 дней (решение X47, было 24 ч) |
| журнал X8 `send.journal` | без текста; неопределённые записи живут до разрешения |
| логи | §9.2 |

Свежий хвост переписки на диск не пишется. При выходе всё, что связано с
пользователем, очищается. При смене персоны — затронутые результаты и Coach.

### 9.5 Ошибки и тосты

**Реестр** — прил. А.
- У операции одна итоговая ошибка.
- У ошибки списка — свой блок с «Повторить»; она не показывается пустым списком (ER-025,
  SP-029).

**Карточка ошибки** (ER-005…ER-007):
- «КОД: заголовок» и пояснение;
- техническая строка «HTTP 429 • …» до 400 символов;
- срок повтора фиксируется один раз, отсчёт раз в 250 мс, повтор только руками.

**Тосты** (ER-009…ER-015):
- виды `info`/`success`/`warning`/`error`; живут 4,5 с, ошибки — 6,5 с;
- одинаковые по коду и области заменяют друг друга, на экране до трёх;
- у фоновых тостов «AI готово · {фан}» есть переход в чат;
- у ошибки — «Настройки» с переходом в нужный раздел по коду
  (`options.html#<раздел>:<CODE>`), там плашка и подсветка (ST-007…ST-010);
- «Скопировать код» и безопасный отчёт;
- `aria-live="polite"`.

Удержание и недоступность кнопки — не тост: код объясняет, почему кнопка неактивна.

**Сбой интерфейса** (ER-020). Каждая поверхность — в своём error boundary: «Сбой
интерфейса (`CG-UI-FAILED`)», «Перезагрузить панель», «Выгрузить диагностику». Сломанная
статистика не ломает док.

### 9.6 Телеметрия

**`ai_acceptance`:**
- `shown` — результат действительно виден, а не просто пришёл в фоне;
- `copied` — после успешной записи в буфер, в том числе Review, Recap, черновики Coach,
  превью (Б14, TL-006);
- `inserted` — после `applied`;
- `sent` — только по §6.6 (`via: 'composer'`) и §6.7.6 (`via: 'preview'`): квитанция и эхо
  с тем же id;
- `edited` — по ревизии и происхождению черновика;
- в каждом событии `generationRef` из `meta.requestId` (TL-007, TL-008) и стабильный
  `clientEventId`. Текста нет.

**Очередь** (TL-009…TL-012):
- `storage.local`, до 500 событий; старые вытесняются со счётчиком потерь;
- пачки до 100, дебаунс 1 с, отправка на старте;
- 5 попыток с паузами 1/2/4/8/16 с;
- ответ 400 выбрасывает пачку с записью в лог и счётчиком;
- 401/403 — пауза до восстановления входа;
- событие привязано к адресу хаба и эпохе токена; события старой привязки после выхода
  выбрасываются.

**`client_health`** (H-2, H-11):
- версии, отпечаток ChatSpace, итог контракта, выключенные функции, счётчики по кодам,
  счётчики P1;
- `perf` — гистограммы с фиксированными границами и `count/sum/max` по версии метрики.
  Процентили считает сервер: средний p95 из частей посчитать нельзя;
- память — только `owned-estimate` (размеры наших кэшей и число узлов DOM). Heap в Firefox
  переносимо недоступен, настоящая память меряется в лаборатории;
- окно агрегации 15 мин; отправка раз в 15 мин, пока открыт ChatSpace, и при смене
  контракта (не чаще раза в 60 с);
- обработчики измеряются выборочно, 1 из 20; редкие события задержки — все;
- нагрузка самих замеров меряется и ограничивается;
- ни текста, ни id фанов, чатов и операций в `perf` нет.

**Согласие.** `ai_acceptance` и `client_health` уходят только при согласии на
`technicalAndInteraction` (проверка `permissions.getAll().data_collection`).
- Отзыв согласия сразу останавливает отправку и удаляет ждущую очередь этого класса.
  Локальная диагностика остаётся.
- Без согласия в «Статусе» и чек-листе первого запуска видно «замеры выключены» и кнопка
  `permissions.request`.
- Аутентифицированный приём технически видит пользователя и IP, поэтому данные не
  называем «анонимными на входе». Хаб отбрасывает идентификаторы до долгой агрегации
  (H-11).
- Серверные записи генераций и расходов хаб ведёт сам, по основному запросу.

### 9.7 Язык

- Каталоги `ru` (по умолчанию) и `en` в `core/domain/i18n`, ключи типизированы.
- Тест паритета ключей, тест запрещённых слов (AU-019), множественное число —
  `Intl.PluralRules`.
- Настройка `ui.locale`: `system` / `ru` / `en`, переключение на лету (I18-001). По
  умолчанию `ru` (решение X29): язык браузера свежую установку не определяет. Язык
  ChatSpace на наш не влияет.
- Термины латиницей: Reply, Fix, Spenders и т. п. (I18-002).
- Переводится всё, включая карточки AI и доску (I18-004, SP-043).

### 9.8 Звук

**Где играет:** в фоне, через `AudioContext` event page (как в Fansly).
- 8 тонов (таблицы параметров, SN-013), громкость, возобновление до 1,5 с (SN-011, SN-014).
- Уже учтённое событие повторно не играет.
- У OnlyFans и Fansly разные тона по умолчанию; явный выбор пользователя важнее.

**Политика** — чистая функция. На входе:
- `IncomingFact` из тапа и сторов;
- присутствие вкладок;
- заглушённые аккаунты;
- новые подписчики из опроса `client/audience-new` (SN-012).

**Без звука, если** (SN-002…SN-009):
- сообщение не от фана, из очереди или автоматическое;
- это чаевые;
- событие старше 180 с или время неизвестно;
- первый снимок или переподключение;
- аккаунт неизвестен или заглушён;
- этот чат открыт в видимой вкладке с фокусом;
- троттлинг: сообщения раз в 2 с, подписчики раз в 10 с; звук подписчика не перебивает
  звук сообщения.

Дубли по `(платформа, аккаунт, id события)` отсекаются глобально: 10 мин, до 2000
(SN-010). Состояние хранится в сессии, арбитр — один на всё расширение. Свежесть X8 —
отдельный потребитель тех же фактов со своими правилами (§6.7.5).

**Без входа в хаб** звук сообщений может работать по живой идентичности ChatSpace, если
есть право на хост и звук включён. Звук подписчиков требует хаба. Пуша после закрытия всех
вкладок ChatSpace нет.

**Диагностика** (SN-015, ST-031, ST-133): сколько вкладок слушает, последнее входящее,
счётчики исходов, кнопка проверки звука.

### 9.9 Popup и страница настроек

**Popup** (PU-001…PU-022).
- Состояния: фон не отвечает — `CG-RUNTIME-UNREACHABLE` (понятная карточка, без
  бесконечного спиннера); не вошли — `CG-AUTH-REQUIRED` → «Аккаунт».
- Строки:
  - персона страницы, «Аккаунт без персоны» или «Не подключено»;
  - пилюля хоста: «ChatSpace открыт · контракт в порядке / частично»;
  - пилюля проблемы с хабом;
  - «Аккаунт»: аккаунт OM и креатор OF, клик копирует id;
  - «Диалог»: фан;
  - квота AI — число запросов: до 20 — янтарный, 0 — «обновится в 00:00 UTC»;
  - «AI сегодня $» — только в отладке.
- Кнопки и ссылки: «Открыть настройки» (одна вкладка, раздел «Статус»), «? Хоткеи»,
  «Что нового», «История версий», версия.
- «Обновить статус» — разрешённые чтения хаба и локальная проверка, без запросов к
  ChatSpace.
- Тема popup — из настроек. Перерисовка при смене входа (PU-013).

**Настройки** (ST-001…ST-136). Хеш-маршруты, одна вкладка настроек, переходы из ошибок
с подсветкой.

| Раздел | Что внутри |
|---|---|
| Статус | готовность «Готово к смене / Нужно N действий»; шаги: хаб, доступ, ChatSpace и привязка, персона, согласие на замеры; строки хоста, хаба, доступа, квоты, активности, Spenders, звука, контракта, X8; «Проверить всё» не чаще раза в 10 с; поддержка; «Скопировать отчёт»; перепроверка при фокусе раз в 5 с |
| Аккаунт ChatGoose | адрес в «Дополнительно», доступ к хосту хаба, связь, вход и выход, «Это устройство», «Войти заново», страницы, контракт SDK и совместимость, ошибки хаба за сегодня, последнее сохранение досье |
| Персоны | каталог только для чтения, архивные с «выберите замену», какие страницы на какой персоне, синхронизация |
| Аккаунты | аккаунты OM, которые видел этот браузер: в работе / видели / нет сессий; локальные подписи; страница хаба; персона страницы; звук модели; «к вкладке» — роутер по клику (Б13) |
| Генерация | окна сообщений, Split по умолчанию, «Помнить тон в чате» (X45), Coach: история и авто-рекап, режим отладки |
| Хоткеи | справочник из вендоренной схемы, строки вне схемы, подпись платформы, таблица доставки |
| Вид и звук | тема `host`/`system`/`light`/`dark`, «система сейчас — …», язык, подсказки, превью панели, звуки |
| Диагностика | «Выгрузить диагностику», размер наших кэшей и логов, «Очистить локальные данные» с подтверждением, журналы (в отладке) |

Экран входа заменяет настройки, пока входа нет (ST-011). Чек-лист первого запуска можно
скрыть навсегда (ST-012).

**Онбординг:**
1. Установить.
2. Дать права на хосты.
3. Войти в хаб.
4. Проверить назначение персоны.
5. Открыть ChatSpace.
6. Проверить привязку и возможности.
7. Решить про согласие на технические данные.
8. Проверить звук и хоткеи.

Токен, персоны и базы старых клиентов не переносим. Новый gecko id не видит хранилище
старого расширения.

## 10. UI: архитектура и контракт UI-агента

### 10.1 Архитектура

| Поверхность | Хост | Лениво? |
|---|---|---|
| док: тулбар, опции, результаты, баннеры | док-хост над composer | нет, всегда в первом чанке |
| развёрнутый результат, Coach, Recap, Review, шпаргалка | оверлей | да |
| Spenders: доска, статистика, превью | оверлей | да |
| «Новые»: список, карточка, превью | оверлей | да |
| панель фана | оверлей, правый край контейнера ChatSpace | да |
| палитра и «быстрый переход» | оверлей | да |
| тосты | оверлей | нет |
| popup, настройки, отладка | страницы расширения | — |

**Принципы:**
- **Логики в UI нет.** Компоненты получают модели видов и действия через `AppClient`.
  Нет `browser.*`, `fetch`, `postMessage`, доступа к DOM ChatSpace, таймеров в простое
  чаще раза в секунду (`lint`, §4).
- **Поток текста.** Пачки по 50 мс меняют один текстовый узел, отрисовка — в
  `requestAnimationFrame`. Сигналы `@preact/signals` живут только внутри `ui/` и через
  `AppClient` не проходят. Markdown разбирается один раз, по готовому результату, а не на
  каждом кусочке (AI-137).
- **Списки длиннее 50 строк — виртуальные:** доска до 1000, «Новые», палитра; в DOM не
  больше 150 строк. Поиск — дебаунс 150 мс, корректно с IME (SP-019).
- **Тяжёлые экраны** — ленивые; активен один оверлей.
- **Фокус и доступность:**
  - модальные окна держат фокус и возвращают его туда, где он был;
  - `role="dialog"`, `aria-keyshortcuts`, подписи хоткеев под ОС (UI-006);
  - уважается `prefers-reduced-motion`.
- **Тема.** Токены `--cg-*` вычисляются из `--color-om-*` и класса `dark` хоста. По
  умолчанию — `host`, ещё есть `system`/`light`/`dark` (ST-122, I18-005). Шрифт — шрифт
  хоста; своих веб-шрифтов без нужды не грузим.
- **Удалённые картинки** с OM и CDN не вставляем: аватары — инициалы или локальные
  значки; вложения в превью — только подписи, без загрузки медиа.
- **Геометрия дока:**
  - ширина — ширина рамки composer, свёрнутый тулбар ≤ 40 px;
  - результат растёт вверх (на деле сдвигает ленту, §6.3) до `min(45vh, 360px)`, дальше —
    внутренняя прокрутка;
  - анимации ≤ 150 мс;
  - в режиме «только копировать» вместо «Вставить» — «Копировать».

**Почему Preact.**
- Маленький рантайм — бюджет первого чанка §11.
- Обработчики висят на элементах, а не на `document`: события нашего Shadow DOM не
  смешиваются с делегированием ChatSpace. Исключение (`ui/kit`, R13) — пассивные
  слушатели только на время открытого слоя: нажатие вне открытого меню (`pointerdown`
  в фазе захвата на документе, читает лишь `composedPath`) и прокрутка или resize
  окна под открытой подсказкой. Они ничего не отменяют и снимаются при закрытии;
  снаружи нашего хоста иначе нажатие не увидеть.
- Сигналы стримят текст без перерисовки дерева.
- JSX и типы пропсов знакомы любому агенту.

Спайк M0 — §3. Контракт UI от выбора библиотеки не зависит.

### 10.2 Контракт UI-агента

UI-агент строит интерфейс с нуля (X6, X7) поверх ровно этого и ничего больше.

**Получает:**
1. `packages/contracts/vm/*` — типы моделей видов, действий `UiAction`, причин
   недоступности, ошибок, тостов, состояния хоста, тем, локали и денег.
   - Модель вида различает loading/ready/empty/partial/error/forbidden/offline.
   - `null` значит «неизвестно», а не 0.
2. `AppClient` — единственный вход к данным:
   ```ts
   interface AppClient {
     getSnapshot<S extends ViewSelector>(selector: S): Readonly<ViewOf<S>>;
     subscribe<S extends ViewSelector>(selector: S, listener: (v: Readonly<ViewOf<S>>) => void): () => void;
     dispatch(action: UiAction): Promise<ActionReceipt>;
   }
   ```
   В `ui/kit` есть хук `useView(selector)` — он переводит `AppClient` в сигналы.
3. `I18n`: `t(key, params)`, `plural`, `formatMoneyMills`, `formatAge`, `formatTime`;
   каталог ключей. Все строки — через ключи.
4. Токены темы `--cg-*` (список имён зафиксирован) и сигнал схемы `dark`/`light`.
5. `MountPort`: `mountSurface(kind, root: ShadowRoot, deps) => Unmount` — контейнеры
   дока и оверлеев, доступные ширина и высота, тема, токен возврата фокуса, освобождение.
   Встраивание в DOM ChatSpace делает `host-chatspace`, а не UI.
6. `ActionCatalog` — точные клавиши, подписи и причины недоступности. `ToastPort`,
   `ClipboardPort`, `DialogPort`. Хуки замеров «видно/отрисовано» (UI сам телеметрию не
   шлёт).
7. Поддельный `AppClient` со сценариями — исполнимый договор:
   - нет входа, прав, персоны, привязки; контракт хоста частично сломан;
   - заблокированный фан; пустой и частичный архив; ошибка статистики;
   - три параллельные генерации и отказ четвёртой; поздний результат;
   - конфликт с человеческим черновиком; поток; тайм-аут;
   - бронь занята, истекла, неизвестный исход; короткий и полный Recap;
   - варианты и части; все состояния X8;
   - отладка вкл/выкл; RU/EN и темы.
8. Стенд `packages/testing/fixture-chatspace` с галереей состояний каждой поверхности
   (наш код и наш CSS), бюджеты §11, правила доступности, id строк паритета на каждую
   поверхность.

**Действия UI:**

```ts
type UiAction =
  | { type: 'Generate'; targetHandle: string; feature: FeatureId; options: UserOptions }
  | { type: 'CancelGeneration'; operationId: string }
  | { type: 'InsertPart'; operationId: string; variant?: number; part: number }
  | { type: 'ReplaceMyDraft'; operationId: string; part: number }        // Fix: клик = согласие
  | { type: 'RestoreMyDraft'; operationId: string }                      // 30 с после Fix, CAS
  | { type: 'AnswerConfirm'; confirmationId: string; choice: 'replace' | 'append' | 'cancel' }
  | { type: 'OpenAndInsertPart'; operationId: string; variant?: number; part: number }
  | { type: 'SendPart'; operationId: string; variant?: number; part: number }   // X8, только кнопка
  | { type: 'OpenChatToVerify'; attemptId: string }
  | { type: 'Copy'; artifactHandle: string }
  | { type: 'OpenPreview'; targetHandle: string } | { type: 'RefreshArchive'; targetHandle: string }
  | { type: 'Navigate'; to: NavigationTarget } | { type: 'OpenSettings'; route: SettingsRoute }
  | { type: 'SetPreference'; key: PreferenceKey; value: unknown };
```

`UserOptions` — разрешённый список: тон, Split, окно, режим рекапа, число вариантов,
вопрос, «приложить мой ответ». Сырой персоны, модели и адреса провайдера там нет. Цель и
политику подставляет контроллер. UI получает непрозрачный `targetHandle` и id операции и
части, а не право собрать произвольную цель. `Copy` пишет `copied` только после успешной
записи в буфер. Для `InsertPart` и `SendPart` контроллер ещё раз проверяет
принадлежность результата, варианта, части и разрешение.

**Ключевые модели видов** (сжато; полные — в R01):

```ts
interface DockVM {
  visible: boolean; mode: 'insert' | 'copy-only';
  status: 'ready' | 'loading-chat' | 'not-signed-in' | 'no-binding' | 'no-persona' | 'host-degraded'
    | 'hub-down' | 'blocked-fan' | 'reload-needed';
  statusError?: CgErrorView;
  persona: { name: string } | null; quota: { remaining: number | null; low: boolean } | null;
  options: { tone: Tone | null; split: boolean; locked: boolean };   // AI-009
  actions: Record<'reply' | 'fix' | 'hi' | 'ping' | 'review' | 'recap' | 'coach',
    { enabled: boolean; busy: boolean; reason?: I18nKey; hotkey?: HotkeyLabel; badge?: 'recap-ready' }>;
  result: ResultVM | null; runningElsewhere: ActiveOpSummary[]; hints: boolean; debug: DebugVM | null;
}
interface ResultVM { opId: string; feature: FeatureId; state: OpState; phase?: PhaseVM;
  parts?: PartVM[]; variants?: { index: number; parts: PartVM[] }[]; error?: CgErrorView;
  stale: boolean; toneUsed: Tone | null; canRegenerate: boolean; costLine?: string /* только debug */;
  confirm?: { confirmationId: string; kind: 'human-draft' | 'draft-changed'; part: number };
  fix?: { canReplace: boolean; restoreUntil: number | null } }
interface PartVM { index: number; label: I18nKey; text: string;
  insert: 'idle' | 'pending' | 'done' | 'failed'; copy: 'idle' | 'done' | 'failed';
  send?: PreviewSendView }                       // только в превью и «Новых»
type PreviewSendView =
  | { s: 'available' } | { s: 'unavailable'; code: CgCode }
  | { s: 'held-stale'; at: string | null } | { s: 'queued' } | { s: 'sending' }
  | { s: 'accepted' } | { s: 'sent'; at: string } | { s: 'rejected'; code: CgCode; detail?: string }
  | { s: 'uncertain'; since: string };
```

Остальные модели, у каждой свои действия:
- **`CoachVM`** — сессия, ходы, фазы ожидания, черновики `PartVM[]`, чипы, рекап в шапке,
  «Новый диалог», «Обновить переписку» с индикатором свежести архива.
- **`RecapPickerVM`, `RecapViewVM`** — общие слоты, возраст, покрытие, «сохранено в хаб»,
  Copy, Refresh, «архив отстаёт от чата». Split неактивен с подсказкой «это не сообщение
  фану».
- **`ReviewVM`** — оценка N/10, блоки, Copy, Refresh. Split неактивен так же.
- **`SpendersBoardVM`:**
  - полки и чипы;
  - строки: имя, @handle, траты за всё время и за период, NEW, «удалён», «Мы/Фан писал»,
    превью;
  - поиск, фильтры, сортировка;
  - охват, свежесть, состояния источника.
- **`SpendersStatsVM`** — серии по дням, 7 дней против прошлых 7, сегодня, платящие,
  средний чек, полки, радар молчания, очередь «ждут ответа», новые плательщики; у каждого
  числа — охват и `asOf`.
- **`PreviewVM`** — шапка, лента архива с покрытием и отставанием, сегмент Ping, локальное
  поле черновика (Fix, до 5000), AI-кнопки, `ResultVM`, «Отправить» (X8), «Открыть и
  вставить», соседние фаны.
- **`NewcomersVM`** — вкладки, фильтры со счётчиками, поиск, строки со статусом и бронью,
  карточка, лента, черновик, «Сгенерировать», «Отправить», «Открыть и вставить», частичный
  прогресс частей, «Результат неполный».
- **`FanPanelVM`:**
  - кто это, «был», траты по видам, подписка («фан уже N мес», автопродление, риск оттока);
  - buying power и оценки ChatSpace, если уже в памяти;
  - био, вкладка рекапа, возраст и покрытие данных;
  - пустое состояние «Выберите чат».
- **`PaletteVM`** — действия, переходы, чаты из списков ChatSpace, аккаунты, работающие
  операции.
- **`QuickJumpVM`, `CheatsheetVM`, `ToastsVM`**.
- **Страницы:** `PopupVM`, `OptionsVM` (по разделам), `DebugPromptVM`, `JournalVM`.

**UI-агенту запрещено:**
- придумывать доступ к данным. Нужно поле, которого нет в модели, — PR в `contracts` с
  меткой `contract-change`, данные добавляет владелец контроллера;
- `browser.*`, сеть, `localStorage`, `postMessage`, `document.querySelector` вне своего
  shadow root;
- глобальный CSS и `innerHTML` с данными (Markdown — через наш безопасный AST);
- строки мимо i18n и таймеры в простое;
- свои хоткеи на `window` — только локальные клавиши внутри своих элементов, глобальное —
  через диспетчер;
- отправку и вставку без клика; хоткей отправки; «Отправить всё»; автоследующую часть;
- деньги AI, токены и коды wire в тексте вне отладки.

**Приёмка UI:**
- снимки состояний на стенде: обе темы, оба языка, масштаб 100/125/150/200 %, колонка
  320 px, длинные русские строки;
- e2e-сценарии §12;
- бюджеты §11;
- ручная проверка владельцем на настоящем ChatSpace (его правило: визуальные изменения —
  по фактическому отображению).

## 11. Производительность

**Базовая линия:**
- Чистый ChatSpace в Firefox на winpc (Windows 11) и Mac владельца по сценарию:
  открыть, 20 переключений чатов, набор, шаблоны, час в простое.
- Запись — Firefox Profiler. Прогон делает владелец руками по чек-листу
  `tools/perf/README.md` (А2: робота в живом ChatSpace нет).
- Тот же сценарий на одинаковых синтетических данных — для обоих старых клиентов.
- Автоматическая регрессия нашего кода — тот же сценарий на стенде в CI.

**Стартовые бюджеты** — цели, а не результаты замеров. Утверждаются после базовой линии.
В CI — на стенде, в поле — по `client_health`.

| Метрика | Бюджет | Как мерим |
|---|---|---|
| мост MAIN | ≤ 10 КиБ gzip — загрузчик и рантайм одним скриптом (решение X11, `docs/decisions.md`; стартовая цель была 5 КиБ под один загрузчик); работа на `document_start` ≤ 1 мс | `tools/size-budget`; e2e на собранном расширении (метки начала и конца бандла); `performance.now()` в отладке |
| ранний бутстрап изолированного мира (диспетчер, клиент моста, монтирование) | ≤ 32 КиБ gzip (30 до X44); ≤ 3 мс на winpc | то же |
| первый чанк дока (с Preact) | ≤ 45 КиБ gzip; ленивые чанки — по 30 КиБ каждый, превышение — разбор | `tools/size-budget` в `pnpm check` |
| маршрут → док обновлён (`routeToDockMs`) | p95 ≤ 50 мс winpc, ≤ 30 мс Mac | своя метрика |
| хоткей или клик → видимый отклик (`panelOpenMs`) | p95 ≤ 50 мс; рабочие кнопки уже загруженной панели ≤ 100 мс; холодно ≤ 250 мс | своя метрика + Event Timing |
| клик → запрос ушёл (накладные клиента) | p95 ≤ 30 мс | профайлер операции |
| отрисовка пачки потока | ≤ 4 мс на пачку 50 мс; первый чанк → отрисован ≤ 50 мс | профиль, `firstChunkPaintMs` |
| вставка с проверкой (`insertMs`) | p95 ≤ 100 мс | своя метрика |
| открытие доски из кэша (`boardOpenMs`) | p95 ≤ 150 мс; поиск по 1000 строк ≤ 50 мс; в DOM ≤ 150 строк | своя метрика |
| наши обработчики (`handlerMs`) | синхронный обработчик клавиши или кэша ≤ 2 мс; ни одного > 16 мс в обычной нагрузке и > 50 мс за часовую сессию; кадр WS ≤ 0,1 мс в среднем | своя инструментовка (Long Tasks в Firefox нет) |
| задержка ввода в composer с расширением | p95 не хуже базовой линии + 5 мс | Event Timing (Firefox 89+) |
| память | вкладка +≤ 15 МБ, фон ≤ 30 МБ; наши данные ≤ 12 МиБ без снимков отладки; рост ≤ 5 МБ за 100 переключений и 20 циклов оверлея после GC | `about:memory` в лаборатории; в поле — только оценки кэшей |
| простой | ни одного таймера чаще 1 Гц, ни одного опроса DOM, почти ноль CPU за 60 с | профиль часа простоя |
| свои запросы к `*.onlymonster.ai` | 0 за сессию | сетевой журнал (стенд, smoke) |

**Синхронный старт изолированного скрипта** (решение X23, `docs/decisions.md`): без
контекста и обёртки входа WXT; ни API расширения, ни `style` элементов в нём не трогаем —
первое касание каждого в песочнице content script'а стоит ~0,3 мс, и оба ждут, пока
понадобятся (порт, размещённый док, чтение темы). e2e `spike-m0` печатает замеры в лог.

**«Быстрее старых клиентов»** сравниваем двумя способами:
- клиентские накладные против профайлеров стадий старых клиентов на тех же машинах;
- конец в конец — время до первого чанка по журналу генераций хаба: серверная часть
  одинакова, задержку провайдера в заслуги UI не записываем.

Цель — сократить p95 своих горячих действий на 20 % там, где базовая линия старых
клиентов хуже бюджета. Регрессия больше 10 % требует объяснения и исправления. Задним
числом пороги не двигаем.

## 12. Тесты и гейты

1. **Юнит и модельные тесты** (Vitest, happy-dom) — всё в `core`:
   - реестр операций и лимиты А3, ограда идентичности, CAS вставки;
   - машина состояний X8 и правило свежести;
   - разбор `[VARIANT]`/`[NEXT]`, XML Review, черновиков Coach;
   - модели Spenders, статистики, «Новых», панели фана, навигации;
   - политика звука и хоткеев, реестр CG и сопоставления;
   - миграции настроек (фикстуры каждой версии, будущая схема);
   - вымарывание логов, гистограммы `client_health`, каталоги i18n;
   - свойства на последовательностях: A→B→A, задержанные кадры, монотонность ревизий,
     повторные id запросов.

   Покрытие строк `core` ≥ 90 %.
2. **Контракт хаба:**
   - типы вендоренного SDK; ответы и кадры через схемы SDK; тест закрепления хеша
     вендоринга (HB-005, HK-033);
   - поддельный хаб `packages/testing/fake-hub`: маршруты §8.1 и все H-* с первого дня, по
     схемам из PR хаба; сценарии SSE: кадры, обрывы, `error`, 409 персоны, 429, 503 до
     первого чанка;
   - в самом хабе (R03–R06) — интеграция в Docker: старые SDK и новый; права, чужой фан,
     истёкший токен; совместимость bootstrap; нет OFAPI с узким токеном; приватный хвост не
     попадает в архив и досье; граница 3000; курсоры, пробелы и удаления ленты; деньги,
     зоны времени, пустые и неизвестные значения статистики; гонка брони и опеки; Split во
     всех фичах; приём согласия и здоровья; поддельный провайдер; ловушка исходящих запросов.
3. **Контракт хоста:**
   - формы данных ChatSpace написаны руками по мапперам бандлов, номера строк — только в
     метаданных фикстур: Message, Fan, Chat, Account, страницы `chatList`, кадр WS, запись
     `pendingMessages`;
   - независимый стенд `packages/testing/fixture-chatspace` (Vue 3 + Pinia + vue-router +
     TipTap; наш код, наш CSS, синтетические фаны). Он воспроизводит только наблюдаемые
     контракты:
     - `#app.__vue_app__`, маршрут `chat`, сторы с теми же id и действиями:
       `pendingMessages` с машиной состояний (тайм-аут 30 с, отказ Guard, Mimic, лимит 50,
       сброс), `composerTranslator`, `accounts` с `subscribedAccountIds`;
     - `_pc_query` с `getQueryData`, `setQueryData`, `invalidateQueries` и `$onAction`;
     - DOM composer (`div.relative > .composer-frame.overflow-hidden > полоса > слот` с
       `__omComposerBridge`), несколько composer с `v-show`, заблокированный фан;
     - запись черновика в `chat-space:draft:of:*`; Esc `lastResort`, Alt+S в capture;
     - локальный WS с `authenticated` и `account_new_message`, переподключениями и
       подпиской аккаунтов;
     - поддельная нативная отправка: HTTP-клиент, который берёт `fetch` при создании
       запроса, и эндпоинт на loopback. Стенд помечает источник каждого вызова;
     - `--color-om-*`, `.dark`, режим фиксированной ширины;
   - `tools/host-contract-check` — только локально, читает копию бандлов, в CI не входит.
     Кроме якорей он считает сигналы телеметрии (решение X22): Replay, трассировку, новые
     интеграции и опции Sentry, адреса расширений, наши имена, пробы закрытых корней и
     символов `window`, проверки «native code». Сравнивает с базой 0.195.0 (или с копией
     из `--against`). Изменился счёт — предупреждение и код выхода 2.
4. **E2e** (WebdriverIO 9 + geckodriver, текущий Firefox без окна, расширение как временное
   дополнение через `installAddOn`). Тестовый манифест добавляет только стенд и поддельный
   хаб на loopback; в выпускном артефакте их нет. Сценарии:
   - док появляется и переезжает при смене чата, лента держит низ (у низа — сама, в
     нескольких строках от него — стараниями дока);
   - 200 быстрых переключений, пока завершаются генерации, — ноль вставок не туда;
   - три параллельные генерации, четвёртая получает отказ со списком;
   - превью → «Открыть и вставить»: успех, срок, отмена, человеческий черновик (Б2);
   - Fix: явная замена, «Вернуть мой текст» с CAS, черновик изменился; перевод, восстановление
     черновика, форматирование и A→B→A меняют ревизию (транзакции Tiptap);
   - отправка из composer: раннее эхо, две записи с одинаковым `createdAt`, отправка из
     занятой очереди — атрибуция неизвестна, `sent` нет;
   - хоткеи: курсив и inline-code не включаются, переводчик не переключается, Esc закрывает
     наше окно, а не вкладку чата (отрицательные проверки); J/K, стрелки, `]`, `?`, Enter и
     IME в полях внутри закрытого корня;
   - деградация: удалённый стор → функция выключена с кодом, «Статус» показывает якорь;
   - перезапуск расширения → `CG-RUNTIME-RELOADED`, операции `interrupted`;
   - звук: решения по кадрам WS;
   - «Новые»: бронь двумя экземплярами — побеждает один;
   - матрица X8 §6.7.13;
   - сетевой журнал BiDi: ни одного запроса нашего кода, кроме поддельного хаба;
   - `sentry-gate`: Sentry стенда, настроенный как у ChatSpace 0.195.0, после дока, вставки,
     палитры, превью с X8, «Открыть чат» и сбоя, внедрённого в MAIN, не получает ничего
     нашего (§5.3, «Правила MAIN-мира»).
5. **Жизненный цикл:**
   - выгрузка и возврат фона; разрыв и восстановление портов;
   - сбой до HTTP, во время потока, между вставкой и ответом, после `done` до сохранения,
     между `dispatch` и `enqueue`;
   - выход во время старого 401; перезапуск браузера;
   - обновление v1→v2 и будущая схема.

   Готовое восстанавливается, оборванное не повторяется.
6. **Визуальная и клавиатурная проверка** на отрисованном стенде:
   - размеры, масштаб, темы, языки, порядок Tab, IME и русская раскладка, возврат фокуса;
   - composer не перекрыт; нет горизонтального переполнения; панель не обрезана полосой;
     лента не прыгает.

   UI-агент сдаёт снимки и трассы, а не только код.
7. **Проверка архива выпуска** (`tools/archive-check`): в XPI и архиве исходников для
   подписи нет кода, CSS, шрифтов и картинок OnlyMonster, реальных сообщений, токенов,
   HTML прода. Одного `.gitignore` мало.
8. **Ручной smoke владельца** на тестовом чате (OM 36408 → чат 518588958), перед каждым
   выпуском (~15 мин) и перед включением X8:
   - док, Reply и вставка; отправляет только человек;
   - непрочитанное не снимается от просмотра и генерации, снимается только отправкой;
   - Spenders, превью, «Открыть и вставить»; «Новые» и бронь;
   - чек-лист X8 (§6.7.13); звук; Coach, Recap, Review;
   - внешний вид на настоящем ChatSpace.

   Результат — галочки в заметке выпуска.
9. **Производительность** — §11: стенд в CI плюс ручные профили на winpc и Mac.

**Гейт безопасности:**
- В сетевом и методном журнале стенда — ноль своих вызовов OM. Единственные нативные
  вызовы — следствия навигации, ввода и клика X8 человека.
- Статическая проверка кода одна отсутствие побочных эффектов не доказывает.
- Без тестов точной цели, ревизии и идентичности вставка не выпускается.

## 13. CI, выпуск, раздача, сосуществование

**CI.**
- `.github/workflows/ci.yml` на PR и push в `main`.
- `runs-on`: при `vars.CI_POOL == 'pc'` и первой попытке — `["self-hosted", "ci-pc"]`,
  иначе `ubuntu-24.04`, как у остальных репозиториев.
- Джобы: `check` (§3) и `e2e` — Firefox и geckodriver в rootless Docker на раннере, образ
  закреплён по digest.
- **Node 26 на раннерах.** Сейчас self-hosted ставит pnpm через corepack из Node 22
  (`hub/.github/workflows/ci.yml:156-159`), а Node 26 поставляется без corepack. Поэтому
  джоба ставит Node 26 через `actions/setup-node` и pnpm 10.33.1 явно — `pnpm/action-setup`
  (версия из `packageManager`) или `npm i -g pnpm@10.33.1`. Это часть R19.
- R19 добавляет репозиторий в `ci-runners`: список, здоровье, наблюдение, метки, квоты,
  изоляция, кэш. Запасной путь через GitHub сохраняется. Джоба ждёт раннер дольше 10 мин —
  `ci-pool status`.
- На раннерах нет учётных данных прода, профилей браузера с OnlyMonster и cookie OM. Сеть
  стенда — только loopback.
- PR открываются в Draft. Перед Ready — локальные `pnpm check` и `pnpm e2e`. Ready — один
  раз, одна небольшая задача — один PR. Зелёный CI без причины не перезапускаем.

**Выпуск** (`tools/release`, по образцу `fansly-chat/scripts/deploy.sh`, UP-001…UP-016):
1. Предполётные проверки:
   - `main`, чистое дерево, HEAD = `origin/main`, тег свободен;
   - версия выше той, что отдаёт фид; `pnpm check` зелёный;
   - гейт совместимости: полный хеш вендоренного SDK ∈ `compatibleClientSdks` прода (H-1;
     до H-1 выпуска нет);
   - sha хоткеев совпадает; `web-ext lint` чистый; бюджеты размера; `archive-check`;
   - #383 действительно в проде; bootstrap, возможности и флаги соответствуют сборке;
     привязки пилотных страниц сверены;
   - smoke владельца и проверки R02 пройдены; changelog, руководство и privacy готовы.
2. `announce --check`.
3. `web-ext sign --channel unlisted`. Ключи AMO — через `op read`, в репозитории и логах их
   нет. В подпись идут исходники и инструкция воспроизводимой сборки.
4. Подписанный XPI неизменяем. Записываются sha256, коммит исходников и хеш SDK.
5. XPI выкладывается по адресу с версией; проверяются доступность и подпись. Потом
   атомарно заменяется `updates.json` (`tmp` + `mv`) на
   `ext.gosling-agency.ru/chat-extension/firefox/`.
6. Проверка: фид = манифест = `package.json`. Тег `vX.Y.Z` с sha256 XPI.
7. Анонс — отдельный шаг по явной команде владельца (UP-005); его сбой выпуск не валит.

Страницы `site/` лежат рядом с фидом: установка, «Как начать», «Что нового», история,
руководство (ссылка из UI, UP-013). `--pages-only` — только страницы.

**Обновления.** Firefox ставит их сам по `update_url`. Вкладки, открытые до обновления,
просят перезагрузку (UP-009, `CG-RUNTIME-RELOADED`).

**Сосуществование (А4):**
- Пилотный манифест матчит только `chat.onlymonster.ai`, старое Fansly-расширение — только
  `fansly.com`. У них разные id, хранилища, фиды и имена в DOM.
- Десктоп продолжает работать, но пилотные страницы закреплены за расширением. Первые
  приветствия на них делает одна система: десктоп на пилотных страницах не приветствует.
- Локальную историю десктопа в хаб не переносим (Б16), старые базы не удаляем.
- **Вывод десктопа** решает владелец, когда выполнено всё:
  - 2 чаттера × 10 рабочих дней;
  - не меньше 95 % генераций OF за последние 5 дней — из нового клиента;
  - ноль P1;
  - пройдены пилотные строки паритета.
- **P1 «прочитано без человека»** — только когда чат стал прочитанным от просмотра или
  генерации. Явный переход по клику (А7) и отправка (X8 или руками) снимают
  непрочитанное штатно и под P1 не попадают.
- Имя в Firefox на время сосуществования — «ChatGoose для ChatSpace», после фазы 2 —
  «ChatGoose».

**Откат:**
- Флаги bootstrap выключают функции по отдельности: `insertion`, `freshText`, `newcomers`,
  `stats`, `sound`, `previewSend`, `wsTap` и другие. Сломанная локальная проверка контракта
  тоже закрывает возможность.
  - `freshText` выключен — AI по архиву.
  - `insertion` выключен — «Копировать».
  - Идентичность сломана — чувствительные действия закрыты.
- Выход или смена токена — только при инциденте со входом, не при поломке вёрстки.
- Откат кода — подписанная более высокая версия с совместимой схемой настроек. Откат
  версии браузером не гарантирован.
- Фид старое расширение не трогает. Новые поля хаба — добавочные, их откат не ломает
  старые SDK. Исправления безопасности вместе с UI не откатываются.

## 14. Безопасность

- **Страница недоверенная.**
  - MAIN не держит секретов и не ходит в сеть.
  - Всё, что приходит из MAIN, проходит строгие схемы `zod/mini` с пределами (§5.3).
    Лишние и неизвестные кадры отбрасываются со счётчиком. Протокол отвергает ключи
    прототипа и объекты не из простого JSON.
  - Изолированный мир не передаёт в MAIN ни токенов, ни данных хаба. В MAIN уходят только
    текст для вставки или отправки (он и так уходит в редактор или очередь ChatSpace) и
    одноразовые id попыток.
- **Запись — только по доверенному действию.**
  - Вставка, переход и отправка X8 требуют одноразового `actionToken`. Его фон выдаёт на
    доверенное событие (`isTrusted`) из нашего закрытого shadow root.
  - MAIN не может сам запустить ни допуск хаба, ни генерацию, ни выдачу разрешений.
  - Жест должен принадлежать видимой, работающей поверхности (защита от clickjacking).
    Shadow DOM не граница секретности.
- **Фон доверяет только своим отправителям** (§5.4) и проверяет каждое сообщение схемой.
  Вкладка может запросить данные только для страниц своей привязки; фон перепроверяет её
  сам.
- **Токен хаба** лежит в `storage.local` отдельным ключом и доступен только фону. Узкая
  область (H-3) ограничивает ущерб от кражи: нет OFAPI, отправок, событий и персон.
  Шифрования ОС в браузере нет — риск принят (AU-007).
- **Снимок промпта** — в памяти фона и только для страницы расширения по непрозрачному
  токену.
- **UI.** Закрытые shadow root, никакого `innerHTML` с данными. Markdown — в наш AST без
  сырого HTML. Ссылки только https и с `rel="noopener"`. Заголовки и детали ошибок с
  сервера — только `textContent`. Буфер обмена — только по жесту.
- **X8.** Наблюдатель квитанции не читает заголовки авторизации и cookies, пропускает
  запросы без изменений и возвращает глобал, только если он наш. Тап пассивен.
- **Мир страницы.** Наш код в MAIN не бросает в страницу исключений и не пишет в консоль;
  всё, что видит страница, названо нейтрально (§5.3, «Правила MAIN-мира», решение X22).
- **Код.** Удалённого кода нет: из bootstrap приходят только флаги и пределы. Строки
  контракта хоста — в коде. CSP страниц MV3 по умолчанию, без `eval`.
- **Зависимости** — минимум; lockfile; `pnpm audit` в CI (предупреждения).
- **Чего не обещаем:** защиты от полностью скомпрометированного браузера или от ложных
  данных самого хоста. Последствия ограничивают права на сервере и правило «только
  черновик и клик человека».

## 15. Фаза Fansly (R20)

> **Уточнено 2026-10-12 (X33):** требования R20 — `docs/project-unite/spec.md`, работы — `docs/project-unite/plan.md`,
> факты о странице — `docs/project-unite/fansly-web.md`; где они расходятся с этим разделом, действуют они.
> Главное: Fansly ходит в API через XHR, поэтому `response.clone()` ниже к нему не подходит; хук
> `history` — открытый вопрос спайка (FS-RTE-3); хвосты не теряются (FS-TAIL-*).

Тот же `HostPort`, `kind: 'fansly-web'`.
- **Маршрут** — MAIN-хук `history.pushState`/`replaceState` и `popstate` вместо опроса раз в
  500 мс (BG-009).
- **Якорь** — перед `app-group-message-input` (EX-013).
- **Вставка** — `execCommand('insertText')` в textarea со сверкой (UI-021).
- **Звук** — тап `wsv3` (SN-017…SN-020).
- **История для AI** — из архива хаба (решение владельца 4).
- **Свежий хвост** — из того, что страница уже получила: пассивное чтение ответов её
  собственных `fetch`/XHR на `/api/v1/message?groupId=` через `response.clone()` в MAIN;
  DOM — запасной путь. Только для четырёх фич черновика.
- **Свои запросы к Fansly** — только там, где без них нельзя:
  - отправка из превью по клику (Б17) — реализация `PreviewSendPort` для Fansly с
    существующей опекой хаба `followerOutreachAttempt` (`routes.ts:6818-6833`) и pacer;
  - имена для доски.

  Переносятся `fansly-pacer`, опека отправки, сессия через `webRequest`. Права `webRequest`
  и `apiv3.fansly.com` появляются только вместе с `host-fansly`.
- **Голос и vault** (AI-110…AI-115, VA-001…VA-006) — отдельные модули со своими
  идемпотентностью и подтверждением.
- Старые сборщики истории, заработков и PPV-заказов для AI не переносятся (X4).
- **Б17 — сохраняем (предварительно).** Автоматическая проверка «Новых» (открывает чаты,
  делает `POST /group`, читает историю без клика, NF-039) остаётся в R20 за флагом, как
  сейчас. Рекомендацию обоих планов её убрать сняли. Позже владелец может решить иначе;
  до этого исполнитель её не удаляет.
- **Сосуществование.**
  - Адаптер включается флагом bootstrap.
  - Если на странице есть маркеры старого расширения (`#chatgoose-root`,
    `style#chatgoose-style`), адаптер не монтируется, popup просит выключить старое.
  - Новый хост включается только после выключения старого расширения в том же профиле.
  - Старое получает последний выпуск с баннером «Переходите на новое».
  - После отдельного пилота паритета на Fansly старое снимается; новый id и фид не меняются.

## 16. Пакеты работ и волны

**Правила:**
- Пакет — область владения файлами и контрактами, а не один большой PR и не отдельный
  постоянный агент.
- Один интегратор владеет R01 и разрешает межпакетные изменения. Каждый исполнитель
  работает в своём worktree, серией небольших Draft PR.
- Пакет, влияющий на API, публикует фикстуры контракта раньше потребителей.
- Корни композиции и экспорт пакетов — R00 и R01.
  - R11 и R12 отдают фабрики, не правя планировщик R10.
  - R14–R16 не меняют контроллеры. R16 использует открытые атомы R13.
- В хабе:
  - R03 владеет проводкой `features/index.ts` и допуском auth;
  - R06 — политиками, builder и схемой вывода через отдельный помощник;
  - общая проводка идёт последовательным интеграционным PR;
  - R04 не правит middleware auth из R03, а добавляет маршруты за уже замороженной охраной
    области.
- Ломающее изменение: сначала новая версия и фикстура в R01, затем производитель и
  потребители — одной согласованной очередью слияний.

| Пакет | Владеет | Отдаёт | Зависит от | Приёмка |
|---|---|---|---|---|
| R00 Каркас | `apps/extension`, корневые конфиги, `tools/size-budget` | собирающееся пустое расширение; `pnpm check`; спайк M0 (Node 26, Preact 11, ленивые чанки, MAIN, динамическая регистрация); вендоринг SDK и хоткеев; корни композиции | — | XPI ставится временным дополнением в текущий Firefox; итоговый манифест MV3 проверен тестом; нарушение границы валит `lint`; бюджеты сборки; итоги гейтов спайка записаны |
| R01 Контракты | `packages/contracts`, `docs/protocols`, манифест паритета | интерфейсы §5 (заморозка ниже); реестр CG; ключи i18n; модели видов; схемы с фикстурами | R00 | тесты схем на верных и неверных фикстурах; нет неоднозначных идентичностей, денег и исходов; у каждой строки паритета есть владелец; подписи владельцев R07–R18; тег `contracts-v1.0` |
| R02 Стенд и независимая проверка | `packages/testing`, `tools/host-contract-check`, `tools/archive-check`, `tools/perf` | стенд-хост, поддельный хаб, обвязка WebdriverIO, визуальные и perf-сценарии | R00 рано, R01 для полного набора | синтетические данные; запрет внешней сети; тесты сбоев, гонок и ложного успеха; приёмка каждой вертикали |
| R03 Хаб: доступ и основа AI | хаб: auth, bootstrap, совместимость, контекст, досье, канон | H-0, H-1, H-2, H-3, H-4, H-5, H-6, H-12 | R01 (DTO); H-0 — сразу | старые SDK проходят; кандидат зарегистрирован; права и запрещённые маршруты; приватный хвост не попадает в общие результаты; флаги сначала выключены |
| R04 Хаб: чтения и замеры | хаб: модели чтения | H-8, H-9, H-11, H-13, H-14, H-15 | R01; охрана области R03 | нет исходящих к vendor; стабильная пагинация; сходимость сумм; гистограммы; два чаттера видят один рекап |
| R05 Хаб: «Новые» и опека | хаб: audience, бронь, опека | H-7 | R01, R03 | два клиента и две вкладки; истечение аренды; идемпотентный статус; сбой после `dispatch`; неопределённость сама не освобождается; флаг проверяется атомарно |
| R06 Хаб: Split | хаб: политики и шаблоны AI | H-10 | R01, R03 | старые клиенты без изменений; матрица всех фич; черновики Coach; аналитика не меняется |
| R07 Платформа и хранилище | `packages/platform`, хранилище настроек и миграции, RPC, журнал отправок | порты Firefox, долговечные хранилища, барьер готовности | R01 | выгрузка и перезапуск фона; запись по одной; будущая схема; потеря подтверждения; права и согласие |
| R08 Фасад хаба | `packages/hub` | `HubFacade`, вход, bootstrap, SSE, мапперы, правила повторов | R01, R07; R03–R06 сначала через подделки | эпоха входа и правило старого 401; запрещённые маршруты; область; правило `service_unavailable`; у фасада нет отправки к vendor |
| R09 Адаптер ChatSpace | `packages/host-chatspace` | проверка контракта, монтирование, защищённая вставка и навигация, тап WS, наблюдение отправки и квитанции, порт отправки | R01, R02 | скрытые и несмонтированные цели; ноль своих запросов и загрузок истории; все условия X8; точная квитанция по id; очистка |
| R10 Операции и координатор отправки | `core/domain/ops`, `core/domain/insert`, `core/domain/send`, `core/services` | планировщик, машины состояний вставки и отправки, сборка фона | R01, R07; R08/R09 через подделки | 1 на чат, 3 на вкладку; CAS; никаких повторов после неизвестного исхода; блокировки фана и аккаунта; события связаны по id |
| R11 Контроллеры AI | `core/domain/{features, output, coach, recap}`, `core/application/{dock, coach, recap, review}` | Reply, Fix, Hi, Ping, Review, Recap, Coach; разбор частей; общий рекап | R10, R06, R08 | каждая AI-строка паритета; применимы только завершённые части; аналитика не отправляется; рекапы общие |
| R12 Контроллеры Spenders, «Новых», панели фана | `core/domain/{spenders, newcomers, fanpanel}`, `core/application/{spenders, preview, newcomers, fanpanel}` | доска, статистика, превью, бронь, команды отправки и «Открыть и вставить», панель | R04, R05, R10 | полные метрики; лента архива; честное «неизвестно»; первая часть приветствия и продолжение |
| R13 UI-кит | `packages/ui/kit` | токены, тема, фокус, Markdown, виртуальный список, адаптер сигналов, форматтеры i18n | R01 | RU/EN, доступность, размеры и рендер; никакого SDK, browser и хоста |
| R14 UI: док и аналитика | `ui/dock`, `ui/overlays` | док, результаты и Б2, Coach, Recap, Review, шпаргалка | R13; модели R01 | визуальная проверка; вставка по одной части; защищённый возврат текста |
| R15 UI: доски, превью, панели | `ui/spenders`, `ui/newcomers`, `ui/fanpanel`, `ui/palette` | Spenders и статистика, превью, «Новые», панель фана, палитра | R13; модели R01 | все состояния X8; нет «Отправить всё» и хоткея отправки; удержание и неопределённость без скрытого повтора |
| R16 Страницы расширения | `ui/pages`, `core/application/pages` | popup, настройки, онбординг, страницы отладки, словари | R07, R08, R13, R18 | «Сохранено» по подтверждению; статус; переходы по кодам; деньги AI только в отладке |
| R17 Ввод и звук | `core/domain/{hotkeys, sound}`, `core/application/navigation`, `core/services/sound` | ранний диспетчер, навигация, палитра и быстрый переход, звук | R01, R09, R13 | столкновения с ChatSpace; IME; таблица доставки сочетаний; звук без дублей; свои правила свежести |
| R18 Ошибки, логи, отладка, телеметрия | `core/domain/{errors, logging, telemetry, debug}`, `core/services/{logs, telemetry, diagnostics}` | реестр, логгер и выгрузка, профайлер, acceptance, `client_health` | R01, R07, R08 | нет текстов и секретов; `sent` только по доказательству; корректные гистограммы; согласие |
| R19 CI, выпуск, сосуществование | `.github/workflows`, `tools/release`, `site/`, онбординг в `ci-runners` | CI на ПК (Node 26 и явная установка pnpm 10.33.1), подпись и фид, страницы, раннбук, откат, свидетельства пилота | R00 для CI; R01–R18 для пилота | локальные проверки → Draft → Ready один раз; гейт совместимости с продом; smoke владельца |
| R20 Fansly, фаза 2 | `packages/host-fansly` | адаптер, сессия и pacer, отправка из превью, автопроверка «Новых» (Б17), голос и vault | принятый пилот ChatSpace, замороженный HostPort | общее ядро без переписывания; Б17 сохранён; своя опека отправки и тесты неопределённости |

**Откуда пакеты:**
- План A:
  - WP-00 → R00, R19; WP-01 → R01; WP-02 → R07; WP-03, WP-21 → R02; WP-04 → R10, R11;
  - WP-05 → R07, R13 (i18n), R18; WP-06 → R11, R12, R17; WP-07 → R17; WP-08 → R08; WP-09 → R09;
  - WP-10, WP-11 → R10–R12, R16 и корни композиции R00; WP-12 → R13; WP-13, WP-14 → R14;
  - WP-15–WP-17 → R15, R17; WP-18 → R16; WP-19 → R03–R06; WP-20 → R19; WP-22 → R20.
- План B: S0 → R00; S1 → R01; Q0 → R02; H0 → R03, R05; H1 → R04; H2 → R06; C0 → R07;
  C1 → R08; C2 → R09; C3 → R10; C4 → R11; C5 → R12; C6 → R13–R15; C7 → R17; C8 → R18;
  C9 → R16; R0 → R19; F0 → R20.

**R01 замораживает до волны 1** (тег `contracts-v1.0`):
1. Идентичности (§5.1).
2. `HostPort` и `PreviewSendPort` (§5.2).
3. Протокол моста MAIN ↔ изолированный, с намерениями, точкой свежести и квитанцией (§5.3).
4. Протокол вкладки и страниц с фоном (§5.4).
5. Модель операций и допуска (§5.5).
6. `AppClient`, модели видов и `UiAction` (§10.2).
7. `HubFacade` и DTO всех H-* (§5.8, §8).
8. Реестр CG и сопоставления с каноном хаба (прил. А).
9. Схема настроек v1, события телеметрии, каркас ключей i18n и сценарии подделок
   (`HostPort`, хаб, `AppClient`, включая X8).

**Волны.** Пик — до 8 одновременных агентов, включая интегратора. Перед каждой волной
владельцу объявляется, сколько агентов и на что.

| Волна | Пакеты | Одновременно |
|---|---|---|
| 0 | R00, затем R01 (заморозка); каркас R02. Фикс безопасности H-0 в хабе — отдельно и сразу | 1–2 |
| 1 | R07, R08, R09, R10, R13, R18 на подделках; R03 в хабе; интегратор с R02 | 8 |
| 2a | R11, R12, R14, R15; R04, R05, R06 в хабе; интегратор с R02 | 8 |
| 2b | R16, R17, R19 и доводка интеграции — на освободившиеся слоты | до 8 |
| после пилота | R20 | по объявлению |

**Критический путь:** R01 → R03 (H-2, H-3, H-4) и R09, R10 → R05 (H-7) и R04 (H-8, H-9) →
M4 и M5. X8 входит в объём пилота, но включается флагом только после своих гейтов.
Флаг — аварийный выключатель, а не способ объявить незаконченное готовым.

## 17. Этапы и приёмка

| Этап | Что входит | Приёмка |
|---|---|---|
| M0 фундамент | R00 со спайком, R01, каркас R02, CI на ПК | пустое расширение ставится в текущий Firefox; CI зелёный на `ci-pc`; `contracts-v1.0`; стенд запускается; итоги спайка (Node 26, Preact 11) записаны |
| M1 сквозной каркас | вход, bootstrap и привязка; мост, проверка контракта, монтирование дока (тулбар со статусом); диспетчер хоткеев; логи, ошибки, тосты, настройки и миграции; popup и настройки (Статус, Аккаунт, Персоны, Аккаунты, Хоткеи, Вид и звук); баннер обновления; базовый `client_health` | e2e на стенде: док идёт за сменой чата; заблокированный фан; деградация по якорям с кодами; хоткеи не вызывают родных действий; «Сохранено» по подтверждению; правила входа и старого 401 |
| M2 док и тексты | Reply (тоны, Split), Fix, Hi, Ping; протокол вставки и Б2; А3 и тосты; acceptance `shown/copied/inserted/sent` по цепочке квитанции; отладка (эхо, профайлер, usage); свежий текст (H-4); Split у Hi и Ping (H-10) | e2e: 200 переключений — 0 вставок не туда; 3 операции и отказ четвёртой со списком. Вручную: вставка на тестовом чате; `sent` и `edited` видны в хабе; отправляет только человек. Отправка из занятой очереди и недоступный путь захвата — атрибуция неизвестна, `sent` не создаётся |
| M3 глубокие функции | Recap (полный, короткий, «Открыть последний», общий H-13, досье H-5, глубина H-6), Review, Coach (сессии, черновики со Split, авто-рекап, «Обновить переписку») | Coach и короткий Recap на OF прогнаны на тестовом чате; досье сохраняется по ссылке на генерацию; второй чаттер открывает тот же рекап; индикатор отставания архива верен |
| M4 Spenders | доска v2 и корзины, статистика (H-8), превью с лентой (H-9), AI в превью и «Открыть и вставить», клавиатура; X8 в Spenders за флагом (опека H-7) | бюджет доски на 1000 строк; статистика сходится с `pageRevenueDaily` и v2; непрочитанный тестовый чат остаётся таким после работы в превью другого фана; вставка в нужный чат; срок и отмена работают; матрица X8 §6.7.13 на стенде; флаг X8 выключен до smoke владельца |
| M5 «Новые» | `client/audience-new` (H-7), статусы, бронь, лента, Hi (`variantCount: 1`, Split), отложенная вставка, «поприветствован» по эху с id, звук подписчика; X8 в «Новых» за флагом | продление подписки не считается новой подпиской; два экземпляра не держат одну бронь; «поприветствован» — только после эха с id; неизвестный исход не повторяется |
| M6 остальное | звук входящих (тап и выключатель), панель фана, J/K, ⌘U, ⌘1–9, «быстрый переход», палитра, смена аккаунта, полевые замеры (H-11), расходы AI в отладке (H-15), остаток настроек и диагностики | e2e решений звука; навигация только по действию человека; p50/p95 `client_health` видны в хабе у согласившихся |
| M7 выпуск и пилот | скрипт выпуска, подпись, фид, страницы; сверка строк паритета; бюджеты на winpc и Mac против базовой линии; smoke владельца; включение X8 на пилотных страницах после его гейтов | подписанный XPI обновляется из фида; чек-лист паритета закрыт; старт пилота: два чаттера десктопа на `lora-of` и `lora-vip-of`, десктоп остаётся установленным; дальше — критерии §13 |

M2–M6 — не строгая очередь, а точки сборки. После M1 вертикали собираются параллельно,
насколько позволяют пакеты хаба.

## 18. Риски

| Риск | Что делаем |
|---|---|
| Выпуск ChatSpace ломает мост, док или вставку (бывало 5 сборок за сутки, канарейки нет — А2) | проверка контракта и деградация (§6.2); `client_health` с отпечатком сборки; флаги bootstrap; быстрый патч (подпись unlisted — минуты); ручная сверка `host-contract-check` |
| X8 выключается, когда меняется существенный модуль пути отправки и квитанции | допуск по проверенному профилю (`limits.previewSendReceiptProfiles`, §6.2): смена только общей сборки X8 не выключает; при смене существенного модуля — разбор `host-contract-check` по локальной копии и новый профиль на сервере без выпуска; если сборщик ChatSpace перегруппировал модули по файлам (0.172.0 → 0.195.0: `messages` → `onlyfans`), нужен ещё выпуск адаптера с новым списком ролей (§6.2); «Открыть и вставить» работает всё это время. Если ChatSpace меняет эти модули в каждом выпуске, ручная проверка будет нужна каждый раз. Владелец выбрал это правило 2026-10-09 (§19 п. 6, X21) |
| Наблюдатель квитанции не проверен в настоящем Firefox (синхронный захват, `fetch.bind`, `signal`, копия тела, очистка) | тесты на стенде с Ky-подобным клиентом; будущий разрешённый smoke; при несовпадении — `CG-SEND-RECEIPT`, отказ без отправки |
| После подписки тихий аккаунт может долго не прислать кадр — X8 для него `unknown` | замер на smoke; при необходимости признать кадр `account_messages_summary` достаточным |
| Нативные «Sent by» и смены не доказаны | smoke с двумя пользователями OM; флаг страницы для организаций со сменами |
| Побочные загрузки истории при отправке без смонтированной цели | условие «нет активного запроса истории»; smoke считает запросы истории — 0 |
| Вставка не в тот чат (P1) | проверки в одном шаге MAIN (§6.4); стресс-e2e; счётчик P1 |
| Vue пересоздаёт DOM и выбрасывает док | перевставка по маршруту и `MutationObserver` контейнера; MAIN перечитывает composer по просьбе вкладки; запасной фиксированный оверлей |
| Тап WS ломает realtime ChatSpace | пассивный слушатель; `Proxy` сохраняет статику; отдельный скрипт с выключателем через `scripting`; глобал возвращаем, только если он наш |
| Фон выгружается посреди операции | Firefox выгружает event page через 30 с без событий, открытый порт её не держит; пока ChatSpace открыт, вкладка раз в 10 с шлёт по порту отчёт присутствия (§7, BG-003), e2e `lifecycle` проверяет это на настоящем Firefox; без вкладки ChatSpace операция может оборваться — тогда `interrupted` без автоповторов; журнал в `storage.session` |
| Firefox не отдаёт ⌘1–9, Ctrl+U, ⌘, | таблица доставки в R17; запасные сочетания; кнопки и палитра; узкое решение владельца |
| Работы в хабе стало больше (H-7…H-15), и она пересекается с Sync Engine | сначала контракт, поддельный хаб, флаги; один интегратор; очерёдность с Sync Engine |
| Расхождение между агентами | заморозка R01; `contract-change` с ревью потребителей; границы в `lint`; e2e на каждом этапе |
| UI-агент придумывает доступ к данным | §10.2: только `AppClient`; `lint`; ревью; стенд |
| Медленнее десктопа | бюджеты в CI; полевые p95; лаборатория |
| В Firefox нет API для части замеров (Long Tasks, heap) | своя инструментовка, Event Timing, `about:memory` в лаборатории |
| Правила OnlyMonster п. 2.1(d) | тихий режим; ноль своих запросов; проверка сети в smoke; риск X8 владелец принял |
| О поломке узнаём от чаттеров | видимый сигнал в доке и popup; витрина `client_health`; быстрый патч |
| Неверная привязка OM → страница | только `platformAccountId`; явная привязка владельца; сверка до пилота |
| Чаттер не дал согласие на технические данные — нет его замеров и acceptance | шаг в чек-листе первого запуска; инструкция владельца; лабораторные замеры остаются |
| Node 26 не тянет какой-то инструмент | спайк M0; откат на Node 24 |
| Свежий Preact 11 с ошибками | гейт спайка; откат на 10.29.8 одной зависимостью |
| Node 26 поставляется без corepack | CI ставит pnpm 10.33.1 явно (`pnpm/action-setup` или `npm i -g`), R19; так же — в инструкции разработчика |
| X8 отправит фану, которого нет в памяти страницы, а платформа его блокирует (§6.7.4, п. 9) | допуск только по текущей активной подписке этой страницы из хаба; при известном окончательном отказе — `rejected`; при недоказанном исходе — `uncertain` с сохранением опеки |
| Пометка `isAiGenerated` влияет на аналитику OM | флаг `previewSendMarkAiGenerated` выключает её |
| PR #383 ещё Draft | выкладка и отрицательные проверки в проде до пилота |
| Неполное покрытие данных | покрытие показываем; отсутствие ≠ отрицательный факт; ошибка ≠ ноль |

## 19. Решения владельца

**Записанные решения** (действуют, перечислены по требованию раунда 4):
1. Приватных рекапов на чаттера нет никогда. Рекапы общие (H-13), локальные слоты —
   копии. Живой текст в рекапы не попадает. Есть отрицательные тесты.
2. Help убран (Б3): кнопки нет, ⌘⇧H / Ctrl+Alt+H в чате гасим с подсказкой.
3. Б17 — автоматическую проверку «Новых» на Fansly сохраняем (предварительно), фаза 2,
   за флагом.
4. Стоимость и токены — только в режиме отладки (Б4). Кредиты хаба не показываем никому
   (Б15).
5. Поверхности десктопа — в пилоте (А8): статистика Spenders, панель фана `]`,
   клавиатурная навигация J/K/⌘U/⌘1–9, палитра ⌘K.
6. Канарейки и робота в живом ChatSpace нет (А2). Внешний вид проверяет владелец.
7. X8: отправка из превью по клику через очередь ChatSpace; риск по правилам принят.
8. Свежий инструментарий: Node 26 и Preact 11 с запасными вариантами.

Остальные ответы (А1–А9, Б1–Б16) учтены в решениях §1 и строках `parity-map.md`.

**Оставшиеся решения.** План везде идёт по умолчанию; сменить каждое — дело одного модуля.
1. **В10 / ST-108 — полки Spenders.**
   - По умолчанию — корзины хаба на обеих платформах: 600+ / 350–600 / 150–350 / 50–150 /
     25–50 / 1–25 (`routes.ts:80-87`).
   - Свои полки десктопа из списков OF при этом пропадают — нужно ваше согласие (планка
     паритета). Если полки нужны, хабу придётся синхронизировать списки OF — это отдельная
     работа вне плана.
2. **В13 — окно «Новых».** По умолчанию 48 ч, быстрые 24/48/72/168 ч и число до 720 ч в
   пределах лимита хаба. Окно длиннее — лимит в H-7.
3. **В4 — Ping активному фану на OF.** По умолчанию не блокируем (решение хаба #295),
   сегмент — подсказкой. Если блокировать, как в Fansly, — правило в `core/domain/features/ping`.
4. **Пометка `isAiGenerated` в X8.** Правило ChatSpace: Dice ≥ 0,85 против исходной выбранной
   AI-части (§6.7.1); согласовано с B. Можно выключить флагом.
5. **Фан, которого нет в памяти страницы (X8, §6.7.4, п. 9).** Согласовано с B: запреты
   страницы важнее; без записи в памяти — только при подтверждённой хабом текущей активной
   подписке этой страницы. Строже — только факты страницы: тогда X8 в «Новых» почти
   недоступен.
6. **Допуск X8 после выпусков ChatSpace.** Решено владельцем 2026-10-09: рекомендуемое
   значение (решение X21); в тот же день заменено на «Мягче» с предохранителем (решение X25):
   профиль-метка хаба пускает любую сборку, предохранитель после каждой отправки выключает
   X8 в браузере, если текст, число сообщений или чат квитанции не те или три исхода подряд
   неизвестны. Вернуться к рекомендуемому — поставить в хаб точные профили вместо метки.
   - **Рекомендуемое значение** — проверенный профиль пути отправки и квитанции
     (`limits.previewSendReceiptProfiles`, §6.2):
     - смена только общей сборки X8 не выключает;
     - смена существенного модуля выключает X8 до просмотра разбора `host-contract-check`;
     - базовый профиль один раз проверяется ручным smoke до пилота.
   - **Последствие для сопровождения.** Работа появляется, когда меняется значимый путь, а
     не на каждую сборку. Но если ChatSpace меняет эти модули в каждом выпуске, ручная
     проверка будет нужна каждый раз. До неё X8 выключен, «Открыть и вставить» работает.
   - **Строже** — ручной smoke на каждую сборку.
   - **Мягче** — допускать неизвестные профили и принять риск неопределённых исходов. Не
     рекомендовали; выбрано владельцем 2026-10-09 вместе с предохранителем (решение X25).
7. **Имя в Firefox:** «ChatGoose для ChatSpace» на время сосуществования, потом «ChatGoose».
8. **Видимость статистики Spenders:** каждому, кому выдана страница (как в десктопе).
9. **Б17 окончательно** — после пилота Fansly.

## Приложение А. Единый реестр CG

**Правила:**
- Формат — `CG-<ОБЛАСТЬ>-<ИМЯ>`. Код понятен без справочника и не пересекается с
  числовыми `CG-HUB-NNN` и `CG-FLOW-NN` старых клиентов.
- После первого выпуска код и его смысл неизменны. Удалённый код остаётся записью с
  `retired` (дата и причина).
- Поля записи — §5.7: вид, серьёзность, заголовок и текст (ru, en), способ восстановления,
  правило повтора, класс телеметрии, раздел настроек.
- Документация реестра и колонка нового клиента в каноне хаба генерируются из него.
- Текст ошибки провайдера клиент не разбирает.

**Колонка «Повтор»:**
- `чтение` — безопасный повтор чтения;
- `клик` — новое действие человека;
- `срок` — ждать срока, потом руками;
- `никогда` — не повторять никогда;
- `—` — повторять нечего.

Колонка «A / B» — откуда код. Слева номер из плана A. Справа имя из плана B; в скобках —
номер B из раунда 3, если он отличается.

| Код | Смысл | Повтор | A / B |
|---|---|---|---|
| CG-LOGIN-CREDENTIALS | неверный логин или пароль | клик | SIGN-02 / LOGIN-CREDENTIALS |
| CG-LOGIN-RATE-LIMIT | много попыток входа | срок | SIGN-03 / LOGIN-RATE-LIMIT |
| CG-LOGIN-UNAVAILABLE | хаб недоступен при входе | клик | SIGN-06 / LOGIN-UNAVAILABLE |
| CG-LOGIN-TIMEOUT | вход не ответил за 20 с | клик | SIGN-08 / LOGIN-TIMEOUT |
| CG-LOGIN-PENDING | вход ждёт подтверждения | — | SIGN-09 / — |
| CG-LOGIN-INCOMPLETE | вошли, но bootstrap не получен | чтение | SIGN-07 / — |
| CG-AUTH-REQUIRED | нужно войти | — | SIGN-01 / AUTH-REQUIRED |
| CG-AUTH-REVOKED | токен отозван (по текущему токену и эпохе) | — | SIGN-04 / AUTH-REVOKED |
| CG-AUTH-EXPIRED | токен истёк (по текущему токену и эпохе) | — | SIGN-04 / AUTH-EXPIRED |
| CG-AUTH-REJECTED | 401 без причины, вход не стирается | клик | SIGN-05 / AUTH-REJECTED |
| CG-HUB-URL | неверный адрес хаба | — | LINK-01 / HUB-URL |
| CG-HUB-HOST-PERMISSION | нет права браузера на адрес хаба | — | LINK-02 / HUB-PERMISSION |
| CG-HUB-UNAVAILABLE | 5xx, `service_unavailable` (у AI — после одного повтора до первого кадра), `internal_error` | чтение | LINK-03 / — |
| CG-HUB-OUTDATED | версия расширения не поддерживается | — | LINK-04 / — |
| CG-HUB-REQUEST | 400, неожиданный 404/409, ответ не по схеме | — | LINK-05 / HUB-REQUEST |
| CG-HUB-FORBIDDEN | 403 | — | LINK-06 / — |
| CG-HUB-RATE-LIMIT | 429 `rate_limit_exceeded` | срок | LINK-07 / HUB-RATE-LIMIT |
| CG-HUB-TIMEOUT | тайм-аут запроса к хабу | чтение | NET-02 / HUB-TIMEOUT |
| CG-HUB-CAPABILITY | хаб не умеет функцию (`unknown_ai_feature`, нет возможности) | — | PAGE-09 / HUB-CAPABILITY |
| CG-HUB-UNKNOWN | неизвестный непровайдерский код хаба; в диагностике отдельно от обычной ошибки запроса | — | LINK-05 / HUB-UNKNOWN (LINK-08) |
| CG-BINDING-MISSING | аккаунт OM не привязан к странице | — | PAGE-01 / BINDING-MISSING |
| CG-BINDING-AMBIGUOUS | привязка неоднозначна | — | PAGE-02 / — |
| CG-BINDING-NOT-GRANTED | страница не выдана по правам и bootstrap; не любой 404 | — | PAGE-03 / — |
| CG-PERSONA-NONE | каталог персон пуст | — | PAGE-04 / PERSONA-NONE |
| CG-PERSONA-UNASSIGNED | для страницы не выбрана персона | — | PAGE-05 / PERSONA-UNASSIGNED |
| CG-PERSONA-UNAVAILABLE | персона в архиве или не найдена — выберите замену | — | PAGE-06 / — |
| CG-PERSONA-CHANGED | персона изменилась во время генерации | клик | PAGE-07 / PERSONA-CHANGED |
| CG-FEATURE-DISABLED | функция выключена для страницы | — | PAGE-08 / — |
| CG-CONTEXT-CHANGED | идентичность или данные цели изменились | клик | — / CONTEXT-CHANGED |
| CG-CONTEXT-CONFLICT | свежий текст не принят хабом (`context_conflict`) | клик | GEN-11 / CONTEXT-CONFLICT |
| CG-QUOTA-DAILY | дневная квота AI исчерпана (`quota_denied`), обновится в 00:00 UTC | срок | GEN-01 / QUOTA-DAILY |
| CG-GATE-DRAFT | сначала напишите черновик | — | GATE-01 / GATE-DRAFT |
| CG-GATE-HISTORY | мало истории | — | GATE-02 / GATE-HISTORY |
| CG-GATE-HI | это уже диалог — нужен Reply | — | GATE-03 / GATE-HI |
| CG-GATE-PING | фан активен — Ping заблокирован (только Fansly) | — | GATE-04 / GATE-PING |
| CG-GATE-LANGUAGE | черновик кириллицей, а фан пишет не кириллицей (AI-087) | — | GATE-10 / — |
| CG-GATE-FAN-BLOCKED | фан заблокирован — только копирование | — | GATE-11 / — |
| CG-GATE-FAN-UNKNOWN | не удалось определить фана | — | GATE-12 / FAN-UNKNOWN |
| CG-GATE-CHAT-LOADING | чат ещё загружается | — | GATE-07 / — |
| CG-GATE-OVERLAY | сначала закройте справку или доску | — | GATE-13 / — |
| CG-OP-CHAT-BUSY | в чате уже идёт генерация (в том числе в другой вкладке) | — | GATE-05 / OP-CHAT-BUSY |
| CG-OP-TAB-LIMIT | уже идут три генерации — список активных | — | GATE-06 / OP-TAB-LIMIT |
| CG-OP-COACH-BUSY | дождитесь ответа коуча | — | GATE-09 / — |
| CG-OP-INTERRUPTED | операцию прервала среда (сбой, выгрузка, перезапуск) | клик | HOST-04 / OP-INTERRUPTED (SYS-08) |
| CG-PROVIDER-BILLING | `provider_billing` | никогда | GEN-02 / PROVIDER-BILLING |
| CG-PROVIDER-AUTH | `provider_auth` | никогда | GEN-03 / PROVIDER-AUTH |
| CG-PROVIDER-RATE-LIMIT | `provider_rate_limited`, срок из `retryAfterMs` | срок | GEN-04 / PROVIDER-RATE-LIMIT |
| CG-PROVIDER-UNAVAILABLE | `provider_unavailable` | клик | GEN-05 / PROVIDER-UNAVAILABLE |
| CG-PROVIDER-PROXY | `provider_proxy_unreachable` | никогда | GEN-07 / PROVIDER-PROXY |
| CG-PROVIDER-STREAM | `provider_stream_failed` | клик | GEN-06 / PROVIDER-STREAM |
| CG-PROVIDER-USAGE-MISSING | `provider_usage_missing`: нет полного успешного конца, действия с результатом закрыты | клик | GEN-06 / PROVIDER-USAGE-MISSING (GEN-12) |
| CG-PROVIDER-INCOMPLETE | `provider_stream_incomplete`: частичный результат не вставлять и не отправлять | клик | GEN-06 / PROVIDER-INCOMPLETE (GEN-13) |
| CG-PROVIDER-UNKNOWN | неизвестный `provider*`; текст ошибки не разбираем | клик | GEN-06 / PROVIDER-UNKNOWN (GEN-14) |
| CG-PROVIDER-EMPTY | `provider_output_empty`, в том числе когда после проверки Split пригодного не осталось | клик | GEN-08 / PROVIDER-EMPTY |
| CG-OUTPUT-UNUSABLE | ответ не прошёл разбор на клиенте | клик | GEN-08 / OUTPUT-UNUSABLE |
| CG-OUTPUT-COACH-LIMIT | `coach_output_too_long` — сузьте вопрос | клик | GEN-10 / COACH-OUTPUT-LIMIT |
| CG-STREAM-TRUNCATED | поток оборвался без `done` | клик | GEN-09 / STREAM-TRUNCATED |
| CG-RECAP-NOT-FOUND | сохранённого рекапа нет | — | GATE-08 / RECAP-NOT-FOUND |
| CG-RECAP-SAVE | сохранение общего рекапа не подтверждено; повторяется только идемпотентная запись ссылки, не AI | чтение | DATA-05 / RECAP-SAVE |
| CG-DATA-UNAVAILABLE | доска или статистика недоступна | чтение | DATA-01 / — |
| CG-DATA-NOT-READY | хаб ещё не собрал данные | чтение | DATA-02 / — |
| CG-DATA-PARTIAL | данные неполные (покрытие) | — | DATA-03 / — |
| CG-DATA-TIMEOUT | сборка не уложилась в 120 с | чтение | DATA-04 / — |
| CG-HOST-NOT-READY | хост ещё не загрузился (оба адаптера) | — | HOST-01 / HOST-NOT-READY |
| CG-HOST-CONTRACT | хост обновился — часть функций выключена | — | HOST-02 / HOST-CONTRACT |
| CG-HOST-COMPOSER-MISSING | поле ввода недоступно — только копирование | — | HOST-03 / — |
| CG-HOST-MEDIA | vault не прочитан из API хоста (X53) | чтение | — / — |
| CG-HOST-SESSION | у страницы хоста нет входа для запроса к её API (X53) | — | — / — |
| CG-RUNTIME-RELOADED | расширение обновилось — перезагрузите вкладку | — | HOST-04 / RUNTIME-RELOADED |
| CG-INSERT-CHAT-CHANGED | чат сменился — текст не вставлен | клик | HOST-05 / — |
| CG-INSERT-FAILED | текст не вставился | клик | HOST-06 / INSERT-FAILED |
| CG-INSERT-UNCERTAIN | исход вставки не подтверждён; повторно не вставляем, «проверьте поле» | никогда | — / INSERT-UNCERTAIN (HOST-07) |
| CG-INSERT-MISPLACED | точное свидетельство вставки не в тот чат (P1) | никогда | HOST-07 / — |
| CG-INSERT-CANCELED | отложенная вставка отменена | — | HOST-09 / — |
| CG-DRAFT-CHANGED | черновик изменился — подтвердите | — | HOST-08 / DRAFT-CHANGED |
| CG-NAV-FAILED | не удалось открыть чат | клик | HOST-10 / NAV-TARGET |
| CG-NAV-TIMEOUT | точный composer цели не появился в срок после перехода | клик | — / NAV-TIMEOUT (HOST-12) |
| CG-CLIPBOARD | не удалось скопировать | клик | HOST-11 / CLIPBOARD |
| CG-CLAIM-BUSY | этого фана уже ведёт другой чаттер | — | NEW-01 / CLAIM-BUSY |
| CG-CLAIM-EXPIRED | бронь истекла | клик | NEW-02 / CLAIM-EXPIRED |
| CG-CLAIM-ROW-CHANGED | данные фана изменились — подтвердите черновик | — | NEW-04 / — |
| CG-CLAIM-ROW-BUSY | по фану уже идёт действие | — | NEW-05 / — |
| CG-SEND-OFF | отправка из превью выключена флагом или для страницы | — | — / SEND-01 |
| CG-SEND-HOST | очередь ChatSpace или её контракт недоступны; ничего не передано | — | — / SEND-02 |
| CG-SEND-RECEIPT | загруженные модули ChatSpace не совпали ни с одним проверенным профилем пути отправки и квитанции | — | — / SEND-12 |
| CG-SEND-FUSE | предохранитель выключил отправку из превью в этом браузере: после отправки текст, число сообщений или чат квитанции не те, или исход раз за разом неизвестен (решение X25); до новой сборки ChatSpace или сброса в «Статусе» | — | — / — |
| CG-SEND-ACTIVE-CHAT | цель — открытый чат: вставьте в поле ввода | — | — / — |
| CG-SEND-HISTORY | у чата цели есть активная или грузящаяся загрузка истории: отправка вызвала бы чтение чата; «Открыть и вставить» | — | — / — |
| CG-SEND-PERMISSION | нет подтверждённого права отправлять, доступ к аккаунту утрачен или нужна смена | — | — / SEND-03 |
| CG-SEND-FAN | фан заблокирован, не принимает сообщения или о нём нет нужных фактов | — | — / — |
| CG-SEND-MIMIC | чат ведёт Mimic; расширение Mimic не останавливает | — | — / SEND-13 |
| CG-SEND-TRANSLATOR | у аккаунта автоперевод: прямая очередь обошла бы его | — | — / SEND-04 |
| CG-SEND-STALE | фан написал что-то новое — отправка удержана | клик | — / SEND-05 |
| CG-SEND-FRESHNESS | наблюдение неполное или оборвалось — свежесть не проверить | — | — / SEND-06 |
| CG-SEND-BUSY | отправка этому фану уже идёт или очередь аккаунта занята | — | — / SEND-07 |
| CG-SEND-QUEUE | очередь ChatSpace отказала (`null`: Mimic или 50 записей) | клик | — / — |
| CG-SEND-PART | часть непригодна или устарела, ревизия черновика превью сменилась | — | — / SEND-11 |
| CG-SEND-GUARD | Message Guard ChatSpace не пропустил текст (отказ ChatSpace, не наш Guard) | — | — / SEND-09 |
| CG-SEND-REJECTED | точный нативный отказ до принятия сообщения; автоповтора нет | — | — / SEND-10 |
| CG-SEND-UNCERTAIN | неизвестно, ушло ли сообщение — повтор запрещён (Spenders и «Новые») | никогда | NEW-03 / SEND-08 |
| CG-SEND-MEDIA | выбранные медиа ещё не готовы к отправке: цена, отметки соавторов (X53) | — | — / — |
| CG-NETWORK | нет связи | чтение | NET-01 / NETWORK |
| CG-TIMEOUT | время ожидания истекло (не хаб) | чтение | NET-02 / TIMEOUT |
| CG-STORAGE-READ | настройки или данные не прочитались | чтение | SYS-02 / STORAGE-READ |
| CG-STORAGE-WRITE | запись не удалась | клик | — / STORAGE-WRITE (SYS-06) |
| CG-STORAGE-VERSION | схема новее клиента — только чтение | — | SYS-02 / STORAGE-VERSION (SYS-07) |
| CG-STORAGE-FULL | хранилище переполнено | — | SYS-03 / — |
| CG-AUDIO-BLOCKED | браузер не дал воспроизвести звук | клик | — / AUDIO-BLOCKED (SYS-09) |
| CG-UI-FAILED | сбой поверхности (error boundary) | клик | SYS-04 / UI-FAILED |
| CG-RUNTIME-UNREACHABLE | фон расширения не отвечает | клик | SYS-05 / — |
| CG-UNKNOWN | всё прочее | — | SYS-01 / — |

**Чего в реестре нет:**
- Своего Message Guard нет (Б10), `CG-GUARD-*` не возвращается.
- `CG-OFAPI-*` нет.
- `password_change_required` хаб больше не выдаёт (Decision 370, `error-handling.md` §3),
  поэтому кода для ER-069 нет.

**Коды Fansly** (1.15.0, R20 P4a3; `docs/project-unite/architecture.md` §1.6, §12). Реестр сайта —
`packages/contracts/src/errors-fansly.ts`, тексты (ru, en) — каталоги Fansly
`packages/core/src/domain/hosts/fansly/i18n/`. Правила те же, что у общего реестра; поля записи — те же, вид — свой
(`fansly`, `note`, `voice`, `vault`, `newcomers`). Общий реестр этих кодов не содержит, бандлы ChatSpace их не несут:
реестр сайта сливается с общим только во вкладке Fansly, на страницах расширения и в `bg/fansly`. По проводу код Fansly
идёт только в теле сообщения Fansly (`CgAnyErrorWire`); конверт, операции, отправки и тосты несут общие коды. Числовые
коды старого Fansly-расширения не заимствуются — их смысл назван в колонке «Старое»; списанные им номера
CG-API-02/03/04 и CG-AUTH-01/02 не занимаются никогда (ER-083). Сеть, тайм-аут и смена аккаунта или документа — общие
CG-NETWORK, CG-TIMEOUT и CG-CONTEXT-CHANGED; занятый или уже поприветствованный фан и неясная отправка приветствия —
общие CG-CLAIM-BUSY и CG-SEND-UNCERTAIN.

| Код | Смысл | Повтор | Старое |
|---|---|---|---|
| CG-FAN-OFF | Fansly не включён в расширении или браузер забрал права на fansly.com | — | — |
| CG-FAN-SESSION | нет сессии Fansly этой модели: её вкладка не открыта или ещё не обращалась к Fansly | клик | CG-FAN-01 |
| CG-FAN-EXPIRED | сессия Fansly истекла: Fansly ответил 401 или 403 | клик | CG-FAN-02 |
| CG-FAN-REQUEST | Fansly отказал: `success: false` при 200, иной 4xx или 5xx | клик | CG-FAN-03 |
| CG-FAN-RATE-LIMIT | Fansly просит паузу (429): общее охлаждение креатора, срок — от пейсера | срок | CG-API-01 |
| CG-FAN-TAB | «Fansly через вкладку» включён, а кадр во вкладке модели не поднялся или не ответил до опеки | клик | CG-FAN-04 |
| CG-FAN-GROUP | чат с фаном на Fansly не найден: ни в хабе, ни в ответах страницы, ни поиском в инбоксе | клик | — |
| CG-NOTE-READ | заметки фана не прочитались (одна попытка; «Обновить» читает снова) | чтение | — |
| CG-NOTE-WRITE | Fansly не сохранил заметку — доказанный отказ, ничего не записано | клик | — |
| CG-NOTE-UNCERTAIN | неизвестно, сохранилась ли заметка: снова — только после перечитывания | чтение | — |
| CG-NOTE-TOO-LONG | текст длиннее предела (заголовок и имя — 1000, текст — 50 000 символов); не обрезается | — | — |
| CG-VOICE-OFF | голосовые заметки выключены на хабе (`voice_disabled`) | — | CG-VOICE-01 |
| CG-VOICE-NOT-ALLOWED | страница не подключена к войсам (`voice_not_allowlisted`, `gate_voice_disabled`) | — | CG-VOICE-02, CG-VOICE-12 |
| CG-VOICE-NO-PROFILE | для страницы не настроен голос (`voice_no_profile`, `gate_voice_no_profile`) | — | CG-VOICE-03 |
| CG-VOICE-SCRIPT | скрипт не прошёл проверку хаба: длина или голосовые теги (`voice_script_invalid`) | клик | CG-VOICE-04 |
| CG-VOICE-SOURCE | источник скрипта больше не подходит (`voice_source_invalid`) | клик | CG-VOICE-05 |
| CG-VOICE-QUOTA | дневной лимит символов войсов страницы исчерпан (`voice_quota_denied`) | — | CG-VOICE-06 |
| CG-VOICE-ATTEMPT | этот запрос войса уже связан с другим скриптом (`idempotency_mismatch`) | клик | CG-VOICE-07 |
| CG-VOICE-EXPIRED | аудио войса больше не хранится (`artifact_expired`) | клик | CG-VOICE-08 |
| CG-VOICE-RETRIEVAL-OFF | получение войсов выключено на хабе (`voice_retrieval_disabled`) | — | CG-VOICE-09 |
| CG-VOICE-PROVIDER | сервис озвучки недоступен, оплата не начата (`voice_provider_unavailable`, `gate_voice_provider_unavailable`) | клик | CG-VOICE-10 |
| CG-VOICE-CORRUPT | аудиофайл войса повреждён: не сошлась контрольная сумма (`voice_artifact_corrupt`) | клик | CG-VOICE-11 |
| CG-VOICE-UNCERTAIN | исход оплаченной озвучки неизвестен: новая не создаётся, попытка проверяется тем же запросом | никогда | — |
| CG-VOICE-ATTACH | файл войса не передан в поле этого чата | клик | — |
| CG-VOICE-ATTACH-UNKNOWN | неизвестно, прикрепился ли файл: сам он повторно не передаётся | клик | — |
| CG-VAULT-NO-ALBUM | нет открытого альбома или формы загрузки Fansly | — | — |
| CG-VAULT-UPLOAD | Fansly не принял файл — доказанный отказ | клик | — |
| CG-VAULT-UNCERTAIN | неизвестно, загрузился ли файл: без ответа чаттера не перезаливается | клик | — |
| CG-VAULT-STOPPED | загрузка остановлена на контрольной точке: сменились альбом, аккаунт или вкладка, отозваны права | клик | — |
| CG-FNEW-PARTIAL | проверка «Новых» прошла не до конца — результат неполный (NF-025) | клик | — |
| CG-FNEW-ACCOUNT | аккаунт вкладки сменился во время прохода — проход остановлен (NF-026) | клик | — |
| CG-FNEW-DM-CLOSED | фану нельзя написать: платная ЛС или его ограничения (FS-NEW-2) | — | — |
| CG-FNEW-HISTORY | история фана изменилась после проверки — подтвердите черновик (NF-018) | клик | — |
| CG-FNEW-UNVERIFIED | история фана не проверена полностью — свой текст не отправить (FS-NEW-6) | клик | — |

**Хаб → коды Fansly** (`HUB_FANSLY_ERROR_CODES`): ответы хаба на вызовы `bg/fansly` (войс: создание, статус, аудио) и
на поток `voice-script` читаются сначала по этой таблице, потом по общим правилам (которые `voice_*` не читают).
`gate_voice_unsupported_platform` и `gate_voice_identity_required` — наши ошибки, остаются CG-HUB-REQUEST по статусу 400.

| Код хаба | Статус | Код Fansly |
|---|---|---|
| `voice_disabled` | 403 | CG-VOICE-OFF |
| `voice_not_allowlisted` | 403 | CG-VOICE-NOT-ALLOWED |
| `gate_voice_disabled` | 400 | CG-VOICE-NOT-ALLOWED |
| `voice_no_profile` | 409 | CG-VOICE-NO-PROFILE |
| `gate_voice_no_profile` | 400 | CG-VOICE-NO-PROFILE |
| `voice_script_invalid` | 400 | CG-VOICE-SCRIPT |
| `voice_source_invalid` | 400 | CG-VOICE-SOURCE |
| `voice_quota_denied` | 429 | CG-VOICE-QUOTA |
| `idempotency_mismatch` | 409 | CG-VOICE-ATTEMPT |
| `artifact_expired` | 410 | CG-VOICE-EXPIRED |
| `voice_retrieval_disabled` | 403 | CG-VOICE-RETRIEVAL-OFF |
| `voice_provider_unavailable` | 503 | CG-VOICE-PROVIDER |
| `gate_voice_provider_unavailable` | 400 | CG-VOICE-PROVIDER |
| `voice_artifact_corrupt` | 500 | CG-VOICE-CORRUPT |

**Колонка «chat-extension» в `hub/docs/error-handling.md`.**

§2 SSE:
- `provider_billing` → CG-PROVIDER-BILLING;
- `provider_auth` → CG-PROVIDER-AUTH;
- `provider_rate_limited` → CG-PROVIDER-RATE-LIMIT;
- `provider_unavailable` → CG-PROVIDER-UNAVAILABLE;
- `provider_proxy_unreachable` → CG-PROVIDER-PROXY;
- `provider_stream_failed` → CG-PROVIDER-STREAM;
- `provider_usage_missing` → CG-PROVIDER-USAGE-MISSING;
- `provider_stream_incomplete` → CG-PROVIDER-INCOMPLETE;
- `provider_output_empty` → CG-PROVIDER-EMPTY;
- `coach_output_too_long` → CG-OUTPUT-COACH-LIMIT;
- неизвестный `provider*` → CG-PROVIDER-UNKNOWN;
- прочий неизвестный код → CG-HUB-UNKNOWN;
- обрыв без `done` (не код хаба) → CG-STREAM-TRUNCATED.

§3 HTTP:
- `unauthorized` с `reason` → CG-AUTH-REVOKED или CG-AUTH-EXPIRED, с учётом эпохи входа;
- `unauthorized` без `reason` → CG-AUTH-REJECTED, на маршруте входа — CG-LOGIN-CREDENTIALS;
- `forbidden` → CG-HUB-FORBIDDEN;
- `not_found` → по маршруту: CG-BINDING-NOT-GRANTED для страниц, иначе CG-HUB-REQUEST;
- `unknown_ai_feature` → CG-HUB-CAPABILITY;
- `conflict` → CG-CLAIM-BUSY только на маршруте брони, иначе CG-HUB-REQUEST;
- `persona_definition_changed` → CG-PERSONA-CHANGED;
- `rate_limit_exceeded` → CG-HUB-RATE-LIMIT, на входе — CG-LOGIN-RATE-LIMIT;
- `service_unavailable` → CG-HUB-UNAVAILABLE. У AI один повтор через 5 с — только
  структурированный ответ до первого кадра; никогда для отправки;
- `quota_denied` → CG-QUOTA-DAILY;
- `gate_draft_required`, `gate_min_messages`, `gate_hi_greeting_limit`, `gate_ping_active` →
  CG-GATE-DRAFT, CG-GATE-HISTORY, CG-GATE-HI, CG-GATE-PING;
- `context_conflict` → CG-CONTEXT-CONFLICT;
- `conversation_fan_mismatch` → CG-CONTEXT-CHANGED (R20 HF-9: группа и фан запроса Fansly — не пара по захвату
  страницы; повтора как есть нет, вкладка заново определяет фана чата);
- `internal_error` → CG-HUB-UNAVAILABLE;
- `voice_*` и `gate_voice_*` → коды Fansly (таблица «Хаб → коды Fansly» выше); общие правила их не читают.

**Старые коды → новые** (для поддержки при переходе). Таблица из приложения Г плана A
пересобирается по этому реестру: код из столбца A заменяется кодом из первого столбца.
Где один код A делится на несколько (SIGN-04, LINK-05, GEN-06, GEN-08, NET-02, SYS-02),
новый выбирается по исходу.
