# fansly.com изнутри: факты для второго хоста (R20)

Справка для `docs/fansly/spec.md` и `docs/fansly/plan.md`: как устроен веб-клиент Fansly там, где в него
встраивается расширение. Только факты со ссылками; решения — в спецификации.

## 0. Откуда факты

- **Бандл.** Снимок 2026-10-12, собран Codex по заданию координатора арены: оболочка и все файлы из
  `ngsw.json` и карты чанков webpack, скачанные без cookies, не чаще раза в секунду; к API Fansly ни
  одного запроса. Лежит вне репозитория: `~/Documents/Codex/fansly-web-bundle-2026-10-12/` (`raw/` —
  оригиналы, их нельзя исполнять; `pretty/` — форматированные копии; `index/` — механический индекс;
  `live/` — обезличенный снимок DOM; `README.md` — как собрано). Чужой код в репозиторий не кладём.
- **Сборка:** `main.2e6b96097a4bb73b`, `runtime.f973459b9af62fd8`, `styles.64c4f4d153577daa`, `ngsw.json` от
  2026-09-30 13:20 UTC. Побайтово совпадает со снимком хаба 2026-10-08
  (`hub/artifacts/fansly-app-bundle-2026-10-08/`); прошлая сборка — 2026-08-20.
- **Ссылки** `main:N` — строка N файла `pretty/main.2e6b96097a4bb73b.js`; `styles:N` —
  `pretty/styles.64c4f4d153577daa.css`. Минифицированные имена (`Qd`, `qp`, `zU`…) меняются с каждой
  сборкой, строки — нет; для новой сборки ссылки надо пересчитать.
- **Живой DOM.** Открытый `/messages/:groupId` во вкладке владельца, только чтение: 3 626 элементов,
  тексты, id, имена и адреса вырезаны (`live/dom-skeleton.json`).
- **Живой замер** 2026-10-12 (`live-coordinator/measure-2026-10-12-firefox157.json`): Firefox 157, Mac,
  окно 1728×910, открытый чат у низа ленты, 60 с без действий. На странице работали старый ChatGoose и ещё
  одно стороннее расширение — числа сняты вместе с ними.
- **Заголовки оболочки:** один GET `https://fansly.com/messages` без cookies
  (`live-coordinator/shell-headers.txt`).

## 1. Приложение

| Факт | Основание |
|---|---|
| Angular 19.1.2 | `ng-version` в живом DOM и в коде |
| **Без zone.js** — `provideZonelessChangeDetection` | `main:104880` → `e.al` → `CT` = `"NgZoneless"` (`main:107656`, `:112899`); `polyfills` пустой; живой замер: `zone: false` |
| HTTP-клиент — **XHR**, без `withFetch` | `provideHttpClient(withInterceptorsFromDi())` (`main:104880`, `:107131`), бэкенд `xhrFactory` (`main:107553-107560`); живой замер: все API-запросы с загрузки — `xmlhttprequest` |
| Service worker `ngsw-worker.js`, `registerWhenStable:30000` | `main:104880`; живой замер: страница под его управлением, `activated` |
| У оболочки без входа нет заголовков CSP и Trusted Types, есть `x-frame-options: SAMEORIGIN`; в живом документе нет meta-CSP и политики Trusted Types | `shell-headers.txt` (один GET без cookies — заголовки документа с входом не проверены); живой замер: `cspMeta: 0`, `trustedTypes: false` |
| Сторонний код в мире страницы: AWS WAF `challenge.js`, телеметрия Fansly с отпечатком устройства, Intercom | `main:26155-26164`, `main:31747-32063`, `metrics.fansly.com`; в замере `AwsWafIntegration` не было, iframe Intercom — один |

Вывод: наши таймеры, промисы, наблюдатели и вставки узлов сами проходов отрисовки Angular не планируют;
планируют их обработчики, которые привязал Angular (`document:click` у `appXdDropdown` — `main:23977-23982`,
`window:keydown` у `app-button` — `main:3268-3271`), если до них всплывёт наше событие.

## 2. Маршруты

- `/messages` — `app-messages-route`: инбокс слева, справа пусто или разговор.
- `/messages/:groupId` — `app-messages-conversation-route` внутри того же `app-messages-route`.
  `groupId` — id разговора Fansly; хаб ключует разговоры Fansly по нему же (хаб `6ee3d627`:
  `apps/runtime/src/modules/ai/features/index.ts:321`, `sync/fansly/resources/dm-conversations.ts:368`).
- `/creator/vault` — медиатека (vault).
- Всего 136 записей маршрутов (`index/routes.md`).

## 3. Страница разговора

**Дерево** (живой DOM, `index/chat-structure.md`):

```text
div.content-wrapper
└─ app-messages-route
   ├─ div.messages-list-wrapper            инбокс, виртуальный список (main:73829)
   └─ div.messages-content-wrapper
      └─ app-messages-conversation-route
         ├─ div.message-content-header      шапка, в шаблоне маршрута
         │  └─ .message-content-header-contact .content-header-sub-row   («Регистрация» старого здесь)
         └─ app-group-message-container.message-content
            ├─ div.message-content-list     лента (xdScrollWatcher)
            ├─ (индикатор «печатает»)
            └─ app-group-message-input      composer: textarea.message-input, .send-button
```

- **Смена чата.** На `paramMap` компонент маршрута ставит `group = null` и сразу перерисовывается:
  контейнер вместе с composer уничтожается (`main:74562-74566`, шаблон `:74724`). Новый контейнер
  появляется, когда группа есть в кэше, иначе после ответа `GET /group/<id>/` (`main:74559-74561`,
  `:28951-28957`). Шапка не пересоздаётся, а переписывается на месте.
- **Composer.** Обычный `textarea` с `[(ngModel)]` (`main:55714-55742`); детектор изменений компонента
  отсоединён, перерисовка — вручную (`changeRef_.detach()`, `main:55805`). Черновик кэшируется по
  `groupId` и восстанавливается без событий ввода (`main:55931`, `:28636-28640`); очистка после
  отправки — тоже программная, без событий (вывод). Ввод обновляет модель, кэш и объявление «печатает»
  (`main:55943-55948`). Enter без Shift отправляет (`main:56025-56032`). Ширину composer меряет своим
  `ResizeObserver` (`main:55794-55800`). Условные ветки шаблона: поле, запись голоса, «no-dm-allowed»
  (`main:55759-55790`, `:56270-56272`).
- **Лента.** Колонка flex с `overflow-y: auto` (`main:59289`). Два правила низа:
  - при изменении размера ленты страница опускает её вниз, только если та не дальше 1 px от низа
    (`resizeScrollBlock_`, `main:59222-59233`);
  - ближе 350 px к низу (`xdScrollWatcher` без `bottomOffset` → `offset = 350`, `main:24549`, `:59275`)
    прокрутка снимает `scrollBlock` (`main:24544` → `:59219-59221`), и новое сообщение опускает ленту
    вниз (`main:59201-59207`, `:59234-59236`).
  - `scrollTop = 0` грузит старую историю (`main:59212-59218`).
- **Сообщения в DOM без id и времени** (`app-group-message`, класс `my-message`); цитаты рисуются теми же
  компонентами — по DOM нельзя ни посчитать сообщения, ни связать их с id (`live/dom-skeleton.json`).
- **Мини-чат** `app-messaging-overlay-group` — плавающее окно со своим composer (`main:59914`, `:60358`).
- **Модалки** — `div.modal-wrapper`, `position: fixed`, `z-index: 998` (`main:61745`).
- **Инбокс** виртуальный: в DOM только видимые строки (`main:73829`; `live/dom-skeleton.json`).

## 4. Сеть страницы

Все запросы к API страница делает сама через XHR. Те, что нужны расширению:

| Запрос | Когда | Что в ответе | Основание |
|---|---|---|---|
| `GET /api/v1/account/me` | при старте | `account.id` креатора (канонический) | `main:24685` |
| `GET /api/v1/messaging/groups` | инбокс | группы, `partnerAccountId`, `unreadCount`, `aggregationData.groups[].users`, `dmPermissionFlags` | хаб `packages/fansly/src/types.ts:162-180`; E155 |
| `GET /api/v1/group/<id>/` | при каждом заходе в чат | участники группы, правила ЛС | `main:74565` → `:28372-28379` |
| `GET /api/v1/message?groupId=…` | первый заход в чат за жизнь документа | страница истории (25) | `main:28989-28991` |
| `POST /api/v1/message` | отправка | `id`, `groupId` нового сообщения | `main:28422-28428` |
| `POST /api/v1/message/ack` | отметка прочтения — отдельный запрос; страница делает его сама при открытии чата (`markGroupAsRead`) | — | `main:28316-28323`, `:29138-29144` |

Живой замер с загрузки вкладки (138 с): `/messaging/groups` — 4 ответа, до 115 КБ; `/message` — 2, до
26 КБ; `/group/<id>/` — 2, до 1,6 КБ; `/account/me` — 1, 22 КБ. **За 60 с простоя — ни одного запроса к
API**, только одна телеметрия `metrics.fansly.com`. Формы ответов держит проводной слой хаба
(`hub/packages/fansly/src/wire/{contracts,types,specs,public}.ts`) и старое расширение
(`fansly-chat/src/shared/types.ts`).

## 5. Сокет

- Один сокет `wss://wsv3.fansly.com` (`main:37841`, `:27424`).
- Кадр — JSON внутри JSON: `{t, d}` (`main:27556-27567`). `t: 1` несёт токен сессии, `t: 2` — пинг раз в
  20–25 с, `t: 10000` — событие сервиса.
- MessageService (`serviceId 5`, `type 1`) — новое сообщение; FollowerService (`serviceId 3`, `type 2`) —
  новый подписчик (`fansly-chat/src/shared/fansly-ws-frame.ts:6-12`, `:143-151`). Обработчик страницы —
  `onMessagesEvent` (`main:29054-29069`).
- Новые сообщения открытого чата страница получает по этому сокету и из ответа своего `POST /message`;
  историю повторно не грузит (`main:29012`, `:29054`).

## 6. Стили и тема

- Инкапсуляция: 407 из 434 компонентов — `Emulated` (атрибуты `_ngcontent-*`), 27 — `None`
  (`index/angular-css.md`). Глобальные правила бьют по тегам и классам (`styles:584-602`, `:661`, `:1333`).
- Тема: тёмная по умолчанию, светлая — класс `bright-theme` на `<html>` (`styles:2`, `:257`). Шрифт —
  Roboto, 16 px на `html`. Переменные: `--blue-1`, `--font-1`, `--dark-blue-1`, `--modal-bg`, `--border-color`.
- У предка `.messages-wrapper` стоит `contain: size` (живой замер).

## 7. Живой замер (2026-10-12, Firefox 157)

| Что | Значение |
|---|---|
| Колонка чата | 622 px в ширину; инбокс — 498 px |
| Контейнер разговора | 786 px в высоту: лента 621, composer 99 (textarea 22 px, `max-height: 100px`); шапка — 56 px |
| Изменения за 60 с простоя | `childList` на `div.content-wrapper`, `div.messages-content-wrapper`, маршруте, контейнере, composer — 0; шапка с `subtree`+`characterData` — 0; лента — 0; composer с `subtree` — 6 одним пакетом; весь документ — 394 (пакет из 350 на 7,7 с и по 7 каждые 10 с; чей это код — не различить) |
| Замены узлов | ни один якорь не заменён |
| Сеть за 60 с | одна телеметрия, API — 0 |
| Не получено | слушатели событий (`getEventListeners` в Firefox нет), длинные задачи и сдвиги макета (Firefox их не отдаёт) |
| Старое расширение | все четыре метки на месте: `#chatgoose-root`, `#chatgoose-followers-launcher`, `style#chatgoose-bootstrap-style`, `style#chatgoose-style` |

## 8. Что стабильно между сборками

- Теги `app-*` и классы шаблонов — строки исходников; между сборками 2026-08-20 и 2026-09-30 не менялись.
- Пути и поля API; числа конверта сокета (`t`, `serviceId`, `type`).
- Меняются: минифицированные имена классов и биндингов, номера модулей webpack, хеши файлов.
- Сборки выходят редко: между 2026-08-20 и 2026-09-30 — одна новая; снимки 2026-10-08 и 2026-10-12
  совпали побайтово (`index/build-diff.json`).

## 9. Хаб и данные Fansly (прод, только чтение, 2026-10-12)

- Прод хаба — `6ee3d627` (переменная `GIT_SHA` контейнера api).
- Сокетный оверлей Fansly включён для всех страниц: `fanslyLiveOverlayReadPages = "all"` с 2026-10-01;
  `aiLiveTextContextMode = "serve"`. Код — `apps/runtime/src/modules/ai/context/index.ts` (`live_union`),
  `packages/shared/src/fansly-live-overlay-read.ts`.
- Задержка (`dm_live_messages`, сообщения фанов, `first_visible_at − created_at`) за сутки 2026-10-11 UTC по
  1 330 сообщениям: p50 1,61 с, p95 2,57 с, p99 3,01 с, максимум 3,5 с. Подтверждение по REST
  (`confirmed_at − created_at`) — p50 7,3 с. Запросы — §10.
- Шесть страниц Fansly; у всех `external_page_id` — 18-значный числовой id (проходит `NATIVE_ID_PATTERN`).
- Точность id. Хаб ключует сообщения переписки числом: `Number(ref)` (`context/index.ts:71`) и отбрасывает
  повторы (`prompts/transcript/normalize.ts:150-154`). Шаг округления `Number()` зависит от величины: для
  нынешних id Fansly (~9·10¹⁷, между 2⁵⁹ и 2⁶⁰) — 128, для 19-значных — до 2048; разные id могут совпасть
  (`Number('900000000000000001') === Number('900000000000000002')`; при округлении к чётному склеиться могут и id
  с разницей ровно 128: `Number('899999999999999936') === Number('900000000000000064')`). Проверка на проде
  (2026-10-12 02:59 UTC): в архиве 782 992 сообщения Fansly, все уникальны в своей паре (аккаунт, переписка);
  групп разных id с одним значением `double precision` в одной переписке — 0; в сокетном оверлее
  (`dm_live_messages`) 24 468 сообщений, таких групп — 0. Это не гарантия на будущее: HF-8 требует точных
  строковых id.
- Свежий текст для Fansly хаб отвергает (`context/live-text.ts:81-85`; `routes.ts:2330-2337`), а id
  больше 2^53 — как `unusable` (`live-text.ts:319-322`). `knownFanMessageIds` принимает на любой функции и
  отвечает по каждому id: `included`, `deleted`, `absent` (нет в окне: не дошло, старше окна или срезано
  бюджетом промпта), `unknown` (`routes.ts:2005-2043`; `context/context-frame.ts:137-165`).

## 10. Как получены числа хаба (прод `agency-de`, только чтение)

Все запросы — `psql` в базе `agency_hub_core` с `PGOPTIONS='-c default_transaction_read_only=on'`.

```sql
-- настройки оверлея и свежего текста (2026-10-12 02:31 UTC)
select key, value, updated_at from config_settings
 where key in ('fanslyLiveOverlayReadPages', 'aiLiveTextContextMode');
-- → aiLiveTextContextMode "serve" 2026-10-08 20:31:17 UTC; fanslyLiveOverlayReadPages "all" 2026-10-01 23:08:24 UTC

-- задержка оверлея за сутки 2026-10-11 UTC
select count(*),
       percentile_cont(0.5)  within group (order by extract(epoch from first_visible_at - created_at)),
       percentile_cont(0.95) within group (order by extract(epoch from first_visible_at - created_at)),
       percentile_cont(0.99) within group (order by extract(epoch from first_visible_at - created_at)),
       max(extract(epoch from first_visible_at - created_at)),
       percentile_cont(0.5)  within group (order by extract(epoch from confirmed_at - created_at))
  from dm_live_messages
 where is_sent_by_page = false and first_visible_at is not null
   and created_at >= '2026-10-11 00:00:00+00' and created_at < '2026-10-12 00:00:00+00';
-- → 1330 | 1.61 | 2.57 | 3.01 | 3.5 | 7.3

-- разные id одной переписки с одинаковым double (2026-10-12 02:59 UTC); double в Postgres и Number() в JS
-- округляют одинаково (IEEE 754, к ближайшему чётному)
select count(*), count(distinct (account_id, conversation_ref, message_ref))
  from message_archive where platform = 'fansly' and message_ref ~ '^[0-9]+$';
-- → 782992 | 782992
select count(*) from (
  select account_id, conversation_ref, message_ref::double precision
    from message_archive where platform = 'fansly' and message_ref ~ '^[0-9]+$'
   group by 1, 2, 3 having count(distinct message_ref) > 1) x;
-- → 0
select count(*) from (
  select page_id, platform_conversation_id, platform_message_id::double precision
    from dm_live_messages where platform_message_id ~ '^[0-9]+$'
   group by 1, 2, 3 having count(distinct platform_message_id) > 1) y;
-- → 0 (из 24468)

-- id страниц Fansly
select label, length(external_page_id), external_page_id ~ '^[1-9][0-9]{0,29}$' from pages where platform::text = 'fansly';
-- → 6 страниц, у всех 18 цифр, true
```
