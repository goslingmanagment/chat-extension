# Журнал изменений контрактов (`@cg/contracts`)

Контракты — общие интерфейсы всех миров расширения: что передаётся между MAIN,
вкладкой, страницами и фоном, что фон берёт у хаба, что UI получает от
контроллеров. Версия — `CONTRACTS_VERSION` в `packages/contracts/src/index.ts`.
Что внутри и почему так — [docs/protocols/README.md](protocols/README.md).

## Правило изменений (`architecture.md` §5, §16)

- **Заморожено до параллельной работы.** Имя или смысл чего-либо в контрактах
  меняется только через PR с меткой `contract-change`; его одобряют владельцы
  пакетов, которые этим пользуются.
- **Новое поле — минорная версия** (`1.0.0` → `1.1.0`): необязательное поле, новый
  тип сообщения, новый ключ i18n, новый код CG, новое значение открытого словаря.
- **Новый смысл — мажорная версия** (`1.x` → `2.0.0`) с периодом совместимости:
  старое и новое живут рядом, пока все потребители не перешли.
- **Каждое изменение — запись здесь** и новая версия в том же PR.
- **Порядок ломающего изменения:** сначала новая версия и фикстура в контрактах,
  затем производитель и потребители — одной согласованной очередью слияний.
- **`unknown` пересекает границу только до проверки схемой.**
- **У каждой новой схемы — верная и неверная фикстура;** у нового запроса, ответа
  и события — тоже. Без них падают тесты контрактов.
- **Код CG не меняет смысла после первого выпуска.** Убранный код остаётся в
  реестре с пометкой `retired`, его номер не занимают снова.
- **Ключи i18n — контракт, тексты — нет.** Тексты каталогов (`core/domain/i18n`)
  правятся без смены версии; новый или убранный ключ — смена версии.
- **Манифест паритета не правится руками:** `node tools/parity/generate.ts` после
  правки карты паритета или реестра исключений. Реестр CG в документах —
  `node tools/cg-registry/generate.ts`.

## 1.37.0 — 2026-10-19 (Spenders: список сверху, превью панелью под ним; решение X65)

Владелец выбрал раскладку A2 для Spenders: список сверху во всю ширину, превью — панелью под ним. Только новые ключи
i18n, схемы и view models без изменений; старые фикстуры проходят.

- **i18n:** `spenders.col.waits` («Ждёт»), `spenders.wait.ours` («мы {age}»), `spenders.previewSplit` («Высота
  превью» — граница списка и превью), `preview.previousFan`, `preview.nextFan` (соседние фаны в шапке панели),
  `preview.feed.lastOnly` («Архив пока пуст — ниже последнее сообщение из списка»).

## 1.36.0 — 2026-10-19 (Coach — окно старого расширения; решение X63)

Владелец вернул Coach к окну старого Fansly-расширения: по центру, с «Recap ▾», «Отменить», «Повторить» и
готовыми вопросами в три колонки. Модель Coach не менялась; добавлены только тексты. Всё добавочное.

- **`i18n/keys`:** `coach.draftOne` («Черновик» над единственным черновиком), `coach.attached` («с вашим
  ответом» под вопросом, к которому приложен черновик), `coach.attachHint` (подпись под «Приложить мой
  ответ»), `coach.canceled` («Остановлено вами» у хода, который человек отменил).
## 1.35.0 — 2026-10-19 (popup: сначала вывод и одно действие, как на «Статусе»; решение X61)

Владелец 2026-10-19 сравнил popup со старым расширением Fansly: в новом много сведений одного веса, а главного —
что не так и что нажать — не видно; при «Расширение обновилось» кнопки перезагрузки нет. Popup переделан: под
персоной — сцена-вывод, как на «Статусе», и у каждой проблемы её одно действие. Всё добавочное, старые фикстуры
проходят без изменений.

- **`vm/pages`:** `PopupVM.verdict` (`PopupVerdictVM`: `ready` / `attention` / `checking`, строка под «Готово к
  смене», `alerts`), `PopupAlertVM` (код, тон, заголовок, текст, одно действие `fix`, `busy` — действие идёт).
- **`vm/actions`:** цель `Navigate` `{ kind: 'site-home' }` — «Открыть ChatSpace» из popup: сайт сборки в новой
  вкладке по адресу манифеста.
- **i18n:** `popup.verdict.*`, `popup.alert.*` (с `popup.alert.reloadShort` — «Перезагрузить» в строке второй
  проблемы, `popup.alert.reloadTitleOne` / `…Many`), `popup.site.on` / `popup.site.off`; во множественном числе —
  `popup.site.reloadBody`.
- **`site.access`** (без изменений схемы): для сайта сборки (ChatSpace) фон принимает `reload: true` и
  перезагружает его вкладки, открытые до обновления (UP-009); включать и выключать можно только необязательный сайт.

## 1.34.0 — 2026-10-18 (окно «Новых» на Fansly как у старого расширения, отправка черновика пакета из строки, период помнится; решение X59)

Владелец 2026-10-18: окно «Новых» на Fansly — как старое «Новые фоловеры»; генерировать пачкой для всех, а
отправлять каждому удобным маленьким кликом; период запоминать, по умолчанию 12 часов. Всё добавочное, старые
фикстуры проходят без изменений.

- **`vm/newcomers`:** необязательные `avatarUrl` у `NewcomerRowVM` и `NewcomerCardVM`; `NewcomerRowVM.send`
  (`NewcomerRowSendVM`: можно ли отправить черновик пакета кликом в строке сейчас, почему последний клик отказан) —
  сама отправка прежняя, `SendNewcomerGreeting` с хэндлом строки: один клик — один фан.
- **`tab-messages-fansly`:** `FANSLY_TAB_LIMITS.windowHoursDefault` 48 → 12; `fansly.followers.scan` принимает
  `windowHours: null` — период, который помнит этот браузер (число — выбор человека, его фон и запомнит);
  `FanslyFollowerRowSchema.avatarUrl` — адрес картинки фана на Fansly (тот же, что берёт Hi, FX-018).
- **`newcomers-fansly`:** ключи окна: заголовок «Новые фоловеры», «За», «Проверить заново», выбор и строки пакета,
  «Отправить» строки и его подсказки.
## 1.33.0 — 2026-10-18 (⌘↵ / Ctrl+Enter кладёт Fix в поле, X58)

Владелец 2026-10-18: Fix без лишних нажатий — по ⌘↵ / Ctrl+Enter из поля ввода. Всё добавочное, старые фикстуры
проходят без изменений.

- **`vm/catalog`:** `CATALOG_ACTION_IDS` + `apply-fix` (подпись, клавиша и строка шпаргалки «Fix вместо черновика»).
- **i18n:** `cheatsheet.row.applyFix`, `dock.fixRunning` (параметр `hotkey`).

## 1.32.0 — 2026-10-17 (пакетная генерация в Spenders и «Новых»)

Владелец 2026-10-17: генерировать не по одному фану, а сразу для многих, потом смотреть, что получилось, построчно,
и отправлять. Пакет только генерирует: каждый результат ждёт на карточке своего фана, отправка — по клику на часть,
как всегда (X8, никакого «Отправить всё»). Всё добавочное, старые фикстуры проходят без изменений.

- **`vm/batch`:** `BATCH_LISTS`, `BATCH_LIMITS` (20 фанов, 3 генерации разом, один клик даёт до 40 токенов генерации
  на 15 минут), `BATCH_ROW_STATES`, `BatchRowVM`, `BatchVM`.
- **`vm/actions`:** `SetBatchPick` (отметить или снять одну строку или все видимые), `GenerateBatch`
  («Сгенерировать для N»), `StopBatch`, `ClearBatch`.
- **`vm/spenders`, `vm/newcomers`:** необязательные `batch` у строки (`SpenderRowVM`, `NewcomerRowVM`) и у списка
  (`SpendersBoardVM`, `NewcomersVM`).
- **i18n:** ключи `batch.*`.

## 1.31.0 — 2026-10-17 (свежий хвост открытого чата и для Recap, решение X52)

Владелец 2026-10-17: Recap строится и со свежими сообщениями открытого чата и остаётся общим и в досье. Хаб с
`live-text-recap-v1` принимает `liveTextContext` на `fan-summary` (полном и коротком) и не помечает такую генерацию.
Всё добавочное, старые фикстуры проходят без изменений. Следует за 1.30.0 (#180).

- **`features`:** `ANSWER_FRESH_TEXT_FEATURES` — плюс `recap` и `recap-short`; `freshTextSurface` — док для них.
- **`hub`:** `live-text-recap-v1` в `CLIENT_HUB_CAPABILITY_NAMES`; `LIVE_TEXT_HUB_NEEDS` — Recap обеих длин нужен этот
  токен; `HUB_FEATURE_ONLY_FIELDS.liveTextContext` — плюс `fan-summary`.

## 1.30.0 — 2026-10-17 (медиа из vault и PPV из превью; решение X53)

Всё добавочное; старые фикстуры проходят без изменений. Следует за 1.29.0 (#181, X52). Собиралась как 1.24.0 и перенумерована при перебазировании на
main.

- **`media` (новый модуль):** что читает панель медиа превью — `MediaFolder` (папка vault: id, имя, вид `messages` /
  `posts` / `custom` / `other`, счётчики), `MediaItem` (id, тип,
  длительность, `ready`, миниатюра только `https`, время), страницы `MediaFoldersPage` (до 10) и `MediaItemsPage`
  (до 40), `MediaFanState` (что фан уже получил: `paid`, `unpaid`, `free`, с ценой в центах), список
  `MEDIA_READ_FAILURES`; запрос моста `MediaRequest` (`folders`, `items`, `states`, `tags`) и ответ `MediaAnswer`;
  порт `MediaPort` и `MediaRead<T>` (никогда не бросает).
- **`send-media` (новый модуль):** что часть берёт с собой — `SendMedia` (медиа в порядке выбора: id, тип,
  длительность, миниатюра, `free`; `priceCents` 0 или 300…20000; отметки соавторов `MediaTags`) с правилами: медиа не
  повторяются, бесплатные превью только при цене, при цене хотя бы одно медиа за ней. `MEDIA_TYPES`, `MediaThumb`,
  `isMediaPriceCents`, а также `MediaFolderId` (`all` — «Все медиа», или id папки), который берут действия панели.
  Отдельно от `media`, чтобы реестр вкладки и чанки досок, проверяющие действия, не платили за схемы чтения панели.
- **`send`:** `PreviewSendRequest.media?` (`SendMedia`); `SendMarksSchema` (`priced`, `withMedia`) и
  `SendJournalEntry.marks?`.
- **`tab-messages`:** `SendBegin.marks?` — фон получает только отметки цены и медиа (кто отправил, X48), сами медиа —
  нет.
- **`bridge`, `bridge-messages`:** запрос в MAIN `media` (`MediaRequest` → `MediaAnswer`, класс тайм-аута `network`,
  `MEDIA_LIMITS.bridgeMs`); `MainSendRequest.media?`.
- **`host`:** необязательный `HostPort.media?: MediaPort` (у ChatSpace есть, у Fansly нет).
- **`limits`:** `MEDIA_LIMITS` — страницы 10 и 40, до 40 медиа в сообщении, до 100 id в запросе, цена 300…20000
  центов, миниатюра до 4096 символов, запрос 10 с, мост 12 с.
- **`vm`:** `PreviewVM.media: MediaPickerVM | null` (папки, сетка, выбор, цена, сводка, что уйдёт с частью, почему не
  уйдёт); действия `SetMediaOpen`, `ChooseMediaFolder`, `LoadMoreMedia`, `PickMedia`, `ToggleMediaFree`,
  `SetMediaPrice`, `ClearMedia`, `RetryMedia`; `SEND_REASON_KEYS['CG-SEND-MEDIA']`.
- **CG:** `CG-HOST-MEDIA` (vault не прочитан), `CG-HOST-SESSION` (у страницы нет входа для запроса), `CG-SEND-MEDIA`
  (выбранные медиа ещё не готовы к отправке).
- **i18n:** ключи `preview.media.*`, `send.buttonMedia`, `send.buttonMediaPaid`, `send.buttonMediaTooltip`,
  `send.reason.media`; множественные `preview.media.count`, `preview.media.previews`.

## 1.29.0 — 2026-10-17 (свежий хвост открытого чата для Review и Coach, решение X52)

Хаб принимает `liveTextContext` и на `chat-review`, и на `coach-chat`, если объявляет `live-text-review-coach-v1`;
Recap его по-прежнему не принимает. Всё добавочное, старые фикстуры проходят без изменений. Следует за 1.28.0 (#182).

- **`features`:** `ANSWER_FRESH_TEXT_FEATURES` (`review`, `coach`) и `freshTextSurface(feature)`: где старт может нести
  свежий текст — док для Reply, Fix, Hi, Ping и Review, своя панель для Coach, для Recap нигде. `FRESH_TEXT_FEATURES`
  и `isFreshTextFeature` по-прежнему значат D-14 черновиков: тексты снимка Fansly — только для них.
- **`ops`:** правило `StartOp.fresh` — по `freshTextSurface` (было: черновики в доке).
- **`hub`:** `live-text-review-coach-v1` в `CLIENT_HUB_CAPABILITY_NAMES`; `LIVE_TEXT_HUB_NEEDS` — что нужно хабу
  для свежего текста функции сверх флага страницы (Review и Coach — этот токен); `HUB_FEATURE_ONLY_FIELDS.
  liveTextContext` — плюс `chat-review` и `coach-chat`.

## 1.28.0 — 2026-10-17 (значения анкеты в «✨ Дополнить из чата»; решение владельца X43, п. 6)

Владелец, 2026-10-17: «4 да» — исключение 4 матрицы паритета снято, анкета уходит в хаб, как у старого 2.11.0 (E164).
Всё добавочное; старые фикстуры проходят, кроме тех, что проверяли запрет непустых значений. Следует за 1.27.0.

- **`hub/ai.ts`:** `NoteValuesSchema` принимает значения анкеты, а не только `''`: каждое — одна строка (без `\r`, `\n`,
  U+2028, U+2029), обрезанное, не длиннее 2000 (`NOTE_FILL_LIMITS.valueMaxChars`) — то, что читает `aiNoteValueSchema`
  вендоренного SDK; 1–30 значений, по одному на метку, как и раньше.
- **`ops-fansly`, `ops`:** у старта `notes-fill` — необязательное `values` (`NoteValuesSchema`, по одному на `fields`);
  без него тело несёт по пустому значению на метку, как в 1.16.0.
- **`notes-fansly`:** `NotesFillVM.unplaced?` — поля, названные хабом, которым не нашлось места (ни своей строки до
  30 полей, ни «Другое»); ключ текста `NotesCopy.fillUnplaced` («Не хватило места в анкете:»).

Без изменения контрактов в том же решении: тексты `fillHint` и `fillOffers` («Правки под полями»), слияние ответа
(`core/application/hosts/fansly/notes/fill.ts`), поддельный хаб (`=` для неизменного, переписывает заполненные).

Фикстуры: `test/fixtures/hub.ts` (`NoteValues`, тело `fan-notes-fill` со значениями и неверные — перенос строки,
пробел по краю, 2001 символ), `test/fixtures/ops-fansly.ts` (старт с `values` и неверные — не по одному на метку,
перенос, пробел, 2001; запрос хаба со значениями).
## 1.27.0 — 2026-10-17 (статус покупки PPV открытого чата в генерации; решение X54)

Всё добавочное; старые фикстуры проходят без изменений. Следует за 1.26.0 (X55): сначала этот PR нёс номер 1.27.0, его
обогнал слитый раньше 1.26.0.

- **`ops`:** `LivePpvStateSchema` — `capturedAt` и 1–100 платных сообщений модели `{platformMessageId, priceUsd,
  purchased}`, каждое id один раз, без текста. `StartOp.livePpv` — только у черновика в доке (Reply, Fix, Hi, Ping), как
  `fresh`. `AiProofAsk.livePpv` — старт может нести статус (свежий текст допущен и хаб объявил `live-ppv-v1`);
  `AiStartFields.livePpv` — поле сайта.
- **`hub`:** `AiFeatureStreamBody.livePpvContext` (тот же вид), только у `fast-reply`, `improve-draft`, `hi-greeting`,
  `ping` и только на OnlyFans; возможность хаба `live-ppv-v1`.
- **`limits`:** `LIVE_PPV_LIMITS` — `readMessages` 50, `waitMs` 1200, `maxItems` 100.
- **`hub`:** возможность `live-text-review-coach-v1` (хаб #659: Review и Coach берут свежий текст) — только названа, как в
  вендоренном SDK; клиент её пока не читает, это делает PR той функции.

## 1.26.0 — 2026-10-17 (UX старых клиентов: размер текста, первый запуск, слова; решение X55)

Владелец, 2026-10-17. Всё добавочное; старые фикстуры и сохранённые настройки проходят без изменений. Следует за 1.22.0.

- **`settings`:** `UI_TEXT_SIZES` (`normal`, `large`), необязательное `ui.textSize` («Размер текста»; без него —
  `normal`, ремонта не нужно; сборка до 1.26.0 его отбрасывает и показывает обычный текст), в `DEFAULT_SETTINGS.ui` —
  `normal`.
- **`vm`:** ключ `SetPreference` `ui.textSize` (одно из двух значений); `MountDeps.textSize?` — сигнал размера, который
  монтирование кладёт атрибутом `TEXT_SIZE_ATTRIBUTE` (`data-text-size`) на корень каждой поверхности (`.cg-root`)
  внутри закрытого shadow root — на хосте, который видит страница, его нет (X22); токены темы
  `--cg-text-ai`, `--cg-leading-ai` (текст AI с засечками и его строка) и `--cg-text-kbd` (кепка клавиши на чипе);
  `AppearanceBodyVM.textSize?`; `OptionsVM.checklist.steps[].more?: true` — шаг тимлида, свёрнутый под «Ещё»;
  `ShowRecap.panel?: true`, `RefreshRecap.panel?: true` — Recap попросила вкладка Recap панели фана: полный Recap
  показывает сама панель, окно «Развернуть ↗» над ней не открывается (из дока полный Recap открывается в окне).
- **Ключи i18n:** `settings.appearance.textSize`, `.textSizeHint`, `.textSizeLarge`, `.textSizeNote`,
  `settings.onboarding.more`, `stats.none` («трат нет» — известный ноль периода в статистике).

Без изменения контрактов в том же решении: клавиша «Новых» (⌘⇧U / Ctrl+Alt+U — строка `ui/core` вне вендоренной
схемы, каталожное действие `newcomers` было и раньше), окно «Развернуть ↗» для Review и полного Recap, тексты.

Фикстуры: `test/schemas.test.ts` (настройка и токены), `test/fixtures/vm.ts` (неверные `SetPreference` `ui.textSize`,
`ShowRecap` и `RefreshRecap` с `panel` не `true`).
## 1.22.0 — 2026-10-17 (своё чтение открытого чата из API OnlyMonster; решение X54)

Всё добавочное; старые фикстуры проходят без изменений. Следует за 1.21.0 (#169, кто отправил, X48).

- **`bridge`, `bridge-messages`:** запрос в MAIN `openChatMessages` `{acc, fan, limit 1…100, cursor?}` — сообщения
  открытого чата из API ChatSpace, новые первыми. MAIN делает запрос сам, сессией страницы, и отказывает с
  `identity-mismatch` до запроса, если маршрут сейчас не этот чат. Неудачный запрос — ответ `ok: false` с причиной, а не
  ошибка моста. Класс тайм-аута `network` (`OPEN_CHAT_LIMITS.bridgeMs`).
- **`host`:** схемы `OpenChatMessage` (id, направление, время, плоский текст, `price` в USD, `isFree`, `isOpened`,
  `mediaCount`, `tip`, `automatic`), `OpenChatPage`, `OpenChatAnswer`, список `OPEN_CHAT_FAILURES`
  (`endpoint`, `session`, `http`, `timeout`, `network`, `invalid`), `OPEN_CHAT_PRICE_MAX`; необязательный метод
  `HostPort.openChatMessages(chat, {limit, cursor?, maxAgeMs?})` → `OpenChatRead` (никогда не бросает; `not-open`,
  `unavailable` — причины самого порта).
- **`limits`:** `OPEN_CHAT_LIMITS` — `pageMax` 100, `requestMs` 10 с, `bridgeMs` 12 с, `cacheMs` 15 с.
## 1.21.0 — 2026-10-17 (кто отправил каждое сообщение, решение X48)

Хаб записывает, кто из чаттеров отправил каждое сообщение и PPV на OnlyFans (hub `clientSendAttributions`,
capability `send-attribution-v1`, таблица `client_send_attributions`). Человек жмёт Send в ChatSpace или «Отправить»
в превью, ответ страницы на этот самый запрос называет id сообщения — фон сообщает хабу: страница, сообщение, фан,
время, есть ли цена и медиа. Чаттера хаб берёт из токена входа; текста нет нигде. Всё добавочное, старые фикстуры
проходят без изменений.

- **Хаб.** Маршрут `clientSendAttributions` (`POST`, класс `page`, без флага владельца, `send-attribution-v1`, узкий
  токен), `HubFacade.sendAttributions`, `hub/attribution.ts`: тело `SendAttributionsRequestSchema` — точное зеркало
  строгого тела хаба (`pageLabel` в пути; `source`, 1–50 фактов: id, фан, время, `priced`, `withMedia`), ответ открытый:
  исход на каждый факт (`recorded`, `duplicate`, `conflict`, `out_of_range`), каждый окончательный. Capability в
  `CLIENT_HUB_CAPABILITY_NAMES`; `HOST_SEND_ATTRIBUTION_SOURCE` — каким именем сайт называет себя хабу
  (ChatSpace — `chatspace-extension`, Fansly — `null`, позже).
- **MAIN ChatSpace.** `flags.attribution` (необязательное, нет — выключено): пока хаб записывает отправителей, MAIN
  следит за квитанцией каждой отправки человека из composer, а не только черновика из нашей вставки. `humanSend.cargo`
  и `HumanSendFact.cargo` (`SendCargoSchema`): цена больше нуля и медиа — только два признака, никогда сама цена,
  медиа или текст. Без поля — не наблюдалось (старый MAIN).
- **Вкладка → фон.** `attribution.report` (`SendAttributionFactSchema`): чат, id сообщения из ответа его же запроса,
  время, два признака. Ответ — `queued` или причина, по которой это не наш отчёт (`site`, `unbound`, `not_admitted`,
  `signed_out`).
- **Реестр фич.** `send-attribution` — только ChatSpace: `wsTap` (квитанция связывается с эхо сокета),
  `sendObserve`, `clientNeeds: ['send-attribution-v1']`. У Fansly нет — отдельная задача.

Фикстуры: `test/fixtures/hub.ts`, `schemas.ts`, `protocols.ts`.
## 1.20.0 — 2026-10-17 (черновики до 7 дней, панель фана рядом с панелью ChatSpace, имена фанов и отладка на страницах; решение X47)

Одобрено владельцем 2026-10-17. Всё добавочное; старые фикстуры проходят без изменений. Следует за 1.18.0;
номер 1.19.0 оставлен за PR #166 (лаунчер Fansly, X46), который контрактов не меняет.

- **`limits`:** `STORAGE_LIMITS.previewDraftTtlMs` — 7 дней вместо 24 часов. Черновик приветствия и превью живёт до
  отправки или сброса, но не дольше 7 дней; пределы 100 черновиков и 1 МиБ прежние. Отметки удаления живут столько же.
- **`ops`:** `StartOp.fanLabel?` — имя фана, как его уже знает поверхность, начавшая операцию (шапка или память
  сайта, псевдоним страницы хаба в строке доски). Только для показа: в ключ запроса не входит, в хаб и в логи не
  уходит.
- **`tab-messages`:** `tab.presence.fanLabel?` (строка или null) — имя фана открытого чата для popup и «Идут сейчас».
  Новые запросы страниц: `fans.labels` (popup, настройки; имена, которые вкладки уже сообщили фону, до 64, только
  память фона), `usage.local` (настройки, журнал отладки; расходы AI этого браузера по функциям за 1–7 дней, null вне
  отладки, DB-022), `account.advanced` (настройки; «Аккаунт → Дополнительно» в отладке: отображаемый префикс ключа
  входа, когда выдан и когда истекает, сборка и контракт каждого сайта с открытой вкладкой, строка «Приложение»;
  null вне отладки, DB-027). Схемы `LocalSpendReportSchema`, `AccountAdvancedSchema` — в `diagnostics.ts`.
  Событие страницам `fans.changed` (без данных): имена, которые знает фон, изменились — popup и «Статус» читают
  `fans.labels` заново, имя появляется, как только фон его узнал.
- **`vm`:** `FanPanelVM.bioBlocks?` — профиль фана из хаба по разделам, как полный Recap; `FanPanelVM.besideHostPanel?:
  true` — у сайта своя панель фана рядом с чатом (ChatSpace 0.195): наша показывает только то, чего там нет.
  `AccountBodyVM.advanced?` (`AccountAdvancedVM`), `DiagnosticsBodyVM.aiSpend?` (`AiSpendVM`, `AiSpendRowVM`).
- **Ключи i18n:** `recap.section.*` (7 разделов профиля и полного Recap), `settings.account.advanced.*`,
  `settings.diagnostics.aiSpend*`.

Фикстуры: `test/fixtures/protocols.ts` (`tab.presence`, `op.start`, `usage.local`, `account.advanced`,
`fans.labels`, событие `fans.changed`), `test/fixtures/vm.ts` (`FAN_PANEL_BIO_SAMPLES`).

## 1.18.0 — 2026-10-17 (решение X45: тон в чате, «Повторить» у отказа запуска)

Своя минорная версия поверх 1.17.0. Всё добавочное; старые сохранённые настройки и старые модели видов проходят без
изменений.

- **`SettingsV1.generation.rememberTone?: boolean`** — «Помнить тон в чате» (AI-003). Включено — тон Reply держится в
  этом чате, пока человек его не сменит или не откроет другой чат (как в десктопе OnlyFans); выключено — разовый тон Б1.
  Поле необязательное: в хранилище до 1.18.0 его нет, и такие настройки читаются как «включено» без починки (в
  журнале нет «broken settings reset»). Сборка до 1.18.0 при своей записи его отбрасывает (её починка оставляет только
  известные поля) — выбор «выключено» тогда читается снова как «включено». `DEFAULT_SETTINGS.generation.rememberTone =
  true`. В `SettingsPatchSchema.generation` — то же необязательное поле. Версия схемы настроек
  (`SETTINGS_SCHEMA_VERSION`) не растёт.
- **Ключ `SetPreference` `generation.rememberTone`** — значение `boolean` (не `undefined`): переключатель на странице
  «Генерация».
- **`GenerationBodyVM.rememberTone?: boolean`** — значение переключателя для страницы; нет поля — включено.
- **Ключи текста** `settings.generation.rememberTone`, `settings.generation.rememberToneHint`.
- **`RefusalVM.actions?: readonly ActionButtonVM[]`** — кнопки карточки запуска, который не состоялся до генерации:
  «Повторить» того же запуска, где реестр CG разрешает повтор новым кликом (`retry` — `safe-read` или `new-click`,
  `recovery` — `retry` или `new-generation`): хаб или расширение не ответили, вышло время. Ничего не повторяется само.
  Нет поля или пусто — у карточки только «Скопировать код», как до 1.18.0.
- Фикстуры: `REFUSAL_VM_SAMPLES` (с кнопкой и с пустым списком; неверная — голое действие вместо кнопки),
  `UI_ACTION_SAMPLES` (неверные `SetPreference` `generation.rememberTone` со строкой и `null`); тест настроек
  `test/schemas.test.ts` (старое хранилище без поля читается, не `boolean` — нет).

## 1.17.0 — 2026-10-17 (фокус на следующую часть, решение X44)

Своя минорная версия поверх 1.16.0 («Заметки» Fansly). Всё добавочное и только типы: схем и фикстур протоколов не
прибавилось, старые модели видов проходят без изменений.

- `DockVM.focusPart?: { opId, part } | null` — часть показанного результата, которой док может передать фокус, чтобы
  Enter человека на ней вставил её (UI-023): готовый Reply, Ping или Hi из одного варианта, режим вставки, нет вопроса
  Б2, поле ввода открытого чата пусто; после вставки — только когда поле держало эту часть без правок и снова пусто
  (часть отправлена). Нет поля или `null` — фокус никуда не переводится. Само ничего не вставляется; нового `UiAction` нет.
- `FocusPlace` — где фокус страницы: `none` (ни один элемент), `page` (элемент сайта без ввода), `composer`, `field`,
  `ours`, `ours-field` — словарь раннего диспетчера клавиш и `none`.
- `FocusReturn.where?(): FocusPlace` — где фокус сейчас, по щупу клавиш сайта (поле ввода сайта знает только он).
  Нет метода (страницы расширения, тесты) — UI сам фокус не переводит.
- Фикстуры: `DOCK_FOCUS_PART_SAMPLES`, `FOCUS_PLACE_SAMPLES` (`test/fixtures/vm.ts`), верные и неверные.

## 1.16.0 — 2026-10-17 («Заметки» Fansly до старого 2.13.0, R20 P11b2; добавочное)

Первая версия после выпуска 0.3.0: 1.15.0 вышла в нём и своего состава больше не меняет (правило раздела 1.15.0).
Старые фикстуры проходят без изменений.

### P11b2 — «Заметки» как в старом 2.11–2.13

- `tab-messages-fansly.ts`: у `FanslyNote` — необязательное `createdAtMs` (когда заметку создали: `createdAt` Fansly в
  секундах → мс, целое > 0; `null` — Fansly его не дал). Правки Fansly не датирует (E171 старого). Фикстуры —
  `test/fixtures/protocols-fansly.ts` (`fansly.notes.read`).
- `hub/ai.ts`: в теле `fan-notes-fill` — необязательное `noteValues` (`NoteValuesSchema`): только пустые строки, по одной
  на метку `noteFields` (иначе отказ до хаба, как и хаб — 400). Его наличие включает режим дополнения хаба: слова фана
  `> «…»`, месяц у устаревающих фактов, поля `+ Label: value`, правило «один факт — одно поле»; значения заметки
  по-прежнему не уходят (FS-NOTE-5, решение X43). `HUB_FEATURE_ONLY_FIELDS.noteValues = ['fan-notes-fill']`. Фикстуры —
  `test/fixtures/hub.ts`, `test/fixtures/ops-fansly.ts` (`FANSLY_OP_REQUEST_FIXTURES`).
- `ops.ts`, `ops-fansly.ts`: у `NoteFieldValue` — необязательные `quotes` (до 3, по строке до 400 символов), у
  результата `note-fields` — необязательное `proposed` (поля, названные хабом: с непустым значением, не повторяют
  спрошенные метки, до 5); `FANSLY_OP_LIMITS.noteQuotesMax`, `.noteQuoteMaxChars`, `.noteProposedMax`. Фикстуры —
  `FANSLY_OP_RESULT_FIXTURES`.
- `notes-fansly.ts`: `NotesDateVM` и `NotesPanelVM.dates?` (дата свободной заметки), `NotesPanelVM.fill?` («✨ Дополнить из
  чата» на читаемой анкете); у поля анкеты — `ai?`, `quotes?`, `proposed?`; у редактора — `sourceCount?`, `sourcesOpen?`,
  `looseQuotes?` (`NotesQuoteVM`), `proposed?`; действия `fill-note`, `sources`, `suggestion-all`, `to-other`; слова в
  `NotesCopy`. Только типы.
## 1.15.0 — 2026-10-13 (второй сайт: fansly.com, R20, этап 4; добавочное, пока этап открыт)

### R20 P9e — Spenders на Fansly

Добавлены `fx.groupForFan` (только чтение пассивного кэша MAIN с проверкой креатора и участников),
`fansly.spenders.names` (≤ 100 отсутствующих в хабе имён) и `fansly.spenders.resolve` (поиск / одна попытка
получить группу по клику). Все ответы проверяются реестром Fansly; id — строки. `SpendersBoardVM.statistics?: false`
скрывает статистику там, где она вне пилота; отсутствие поля сохраняет прежний вид. Фикстуры обоих реестров дополнены.

Одна минорная версия на весь этап 4 `docs/project-unite/plan.md` («Контракты 1.15.0»), как у волн 1 и 2: каждый PR
этапа (P4a1, P4a2, P4a3, P4b1–P4b4, P4c) дописывает сюда свой раздел, версию не поднимает. Если до конца этапа выйдет
выпуск расширения, следующий PR этапа поднимает версию до 1.16.0: вышедшая версия не меняет состава. Что меняется и
почему — `docs/project-unite/architecture.md` §12. Старые фикстуры проходят без изменений.

### P9d — опека приветствия Fansly в фасаде

- X41: у записи `fansly.send.journal` добавлены необязательные `requestId` (UUID одного `fetch`, заголовок
  `x-cg-request-id`) и `browserResend: true` (наблюдался повторный/поздний ответ браузера с этим id). Без `requestId`
  отметка невалидна; старые записи проходят. Это диагностика, состояние и запрет повторной отправки не меняются.
  Положительные и отрицательные фикстуры — `test/fixtures/send-fansly.ts`.
- `HubFacade.claim(op: HubClaimOp, check?: HubRequestCheck)`: тело хаба после HF-3 (тело OnlyFans `ClaimOp` или тело
  приветствия Fansly с ручной группой) — тип, которым P4c назвал оба тела для фасада. Строгая проверка до отправки
  (HB-006) — по `check`, если сайт принёс свою схему (Fansly — `FanslyGreetingClaimOpSchema`, её нет ни в одном общем
  бандле), иначе по `ClaimOpSchema` реестра: ручная группа без схемы сайта не уходит. `HubRequestCheck` — новый тип
  (`safeParse`, схема zod подходит). Прежние вызовы проходят как были.
- `GREETING_DISPATCH_FLAGS` (`ids`): под какими переключателями страницы хаб допускает `dispatch` приветствия на
  платформе — OnlyFans `previewSend` и `newcomers` (отправка идёт очередью превью, X8), Fansly — только `newcomers`
  (наш HTTP-запрос «Новых»). Неизвестная платформа — оба. Фасад проверяет `dispatch` приветствия по платформе страницы.

### P9c — relay: кадр поднялся, вкладка его поднимает

- `fansly.relay.hello` (от relay, только сайт Fansly): кадр поднялся — его порт открыт, он служит аккаунту, на котором
  была вкладка, когда подняла кадр (смена аккаунта вкладки снимает кадр), под своим id (`relayId`). Шлёт при каждом
  подключении порта; маршрут через вкладку выбирается только после него (`docs/project-unite/architecture.md` §8.5).
- `fansly.relay.open` (событие вкладке): поднять кадр relay или держать поднятый ещё 60 с (FS-NET-4: лениво, на пачку
  работы и 60 с после). Пустое тело: вкладка поднимает кадр для своего аккаунта и ничего — без аккаунта.
- `fansly.relay.fetch.expect.relayId` — необязательный: кадр, с которым выбран маршрут; другой кадр той же сессии
  вкладки в запросе не участвует и не отвечает. Без поля — прежний смысл.
- Адрес `fetch` по-прежнему только `https://apiv3.fansly.com/api/v1/` (стенд тестовой сборки кадр подставляет сам,
  контракт не расширен). Старые фикстуры проходят; новые — `test/fixtures/protocols-fansly.ts`.
- Предел полного `fansly.relay.fetch.url` — 128 КиБ вместо 2048 символов: вмещает все разрешённые клиентом маршруты
  (до 7 query-значений по 2048 UTF-16 единиц, до 9 символов после кодирования каждой, плюс адрес, путь и ключи).
  Лимит клиента не меняется; обычная пачка из 100 профилей с 18-значными id проходит одним запросом.

### P8b3 — собственное доказательство сохранённого результата

- Необязательный `OpView.freshnessProof`: размер окна и `CoverageFingerprint` (id, стороны, полнота, флаги;
  без текстов). Сохраняется с операцией, чтобы после перезагрузки проверить её собственный ответ хаба.
- Необязательный `AiHostPolicy.watch(host, changed)` подключает проверку текущего окна по памяти страницы;
  старые политики остаются валидными. ChatSpace этот порт не реализует.
- Положительные и отрицательные фикстуры: `test/fixtures/schemas.ts`; старые `OpView` проходят без изменений.

### P8c, часть A — Hi на Fansly по доказательству начала

- **`ids`: `HI_BY_START_PROOF`** — платформы, где хаб решает Hi по доказательству начала клиента (`StartProofV1`), когда
  объявил `hi-start-proof-v1` (его `hiStartProofDecides`): Fansly. Там каждый Hi несёт этот токен — и без
  доказательства, чтобы хаб отказал `history_unproven`, а не считал свой архив; OnlyFans — без изменений. Только
  константа, схем нет.
- **Манифест Fansly:** генерация Hi требует `hi-start-proof-v1` (`clientNeeds`); без неё Hi — `hub_not_ready`
  («хаб пока не умеет»), как в `architecture.md` §11.1.
- Фикстур нет: схем нет. Тесты — `packages/contracts/test/features.test.ts`, `packages/core/test/hosts/fansly/hi-ping.test.ts`.

### P10c — «Новые» на Fansly: приветствие карточки

- Исправления P1: необязательный `generation: {opId, historyRevision}` в записи `fansly.followers.draft`; фон
  сохраняет собственный вердикт, id и текст генерации (`GreetingDraftGenerationSchema`, `ops`), возвращает их вместе
  с черновиком (`generation?`) и попыткой из журнала отправки (`attempt?`). Закрытие окна, перезагрузка и другая
  вкладка не превращают AI в свой текст и не снимают запрет после неопределённой отправки. Старые фикстуры валидны.
- `tab-messages-fansly`: запросы `fansly.followers.proof` (доказательство прохода для «Сгенерировать»: группа, ревизия
  истории, окно проверки покрытия, известные id фана, `StartProofV1` прохода, аватар из профиля — только id и адрес,
  FS-NEW-7, NF-034), `fansly.followers.draft` (черновик карточки: чтение без `text`, запись с ним; фон знает его ревизию
  для последней сверки, NF-012) и `fansly.followers.sent` (человек отправил текст карточки кнопкой Fansly после
  «Открыть и вставить» — фон регистрирует `registerNativeSend`, FS-NEW-3). Схема `FanslyGreetingProofSchema`.
- `send-fansly`: необязательный `opId` в `FanslyGreetingRequestSchema` — только при допуске `ai`: фон читает результат
  этой операции и её вердикт и отказывает, если текст не тот или вердикт не свежий (FS-TAIL-8).
- `vm/actions.ts`: `SendNewcomerGreeting {targetHandle}` и `InsertNewcomerGreeting {targetHandle}`; поле — прежний
  `SetPreviewDraft`, генерация — прежний `Generate` с ручкой карточки. Фикстуры — `test/fixtures/vm.ts`.
- `vm/newcomers.ts`, только типы: `NewcomerCardVM.greeting?` (`NewcomerGreetingVM`, `NewcomerGreetingStateVM`).
- `newcomers-fansly`: ключи `fansly.newcomers.greeting.*` и `fansly.newcomers.noAutoSend` (NF-028).
- Положительные и отрицательные фикстуры — `test/fixtures/protocols-fansly.ts`, `test/fixtures/send-fansly.ts`; версия
  остаётся 1.15.0.

### P10b2 — «Новые» на Fansly: «Нельзя написать» и «Исключить из очереди»

- `vm/actions.ts`: `ExcludeNewcomer {targetHandle, excluded}` — «Исключить из очереди» (`true`) и «Вернуть в очередь»
  (`false`) фана, которому Fansly не даёт написать (FS-NEW-2, FX-003), по ручке строки прохода. Запрос фона — прежний
  `fansly.followers.exclude`. Фикстура — `test/fixtures/vm.ts`.
- `vm/newcomers.ts`, только типы: `NewcomerCardVM.exclude?` (`exclude` | `restore` | null).
- `newcomers-fansly`: ключи `fansly.newcomers.exclude`, `fansly.newcomers.restore`, `fansly.newcomers.excludeTooltip`.
- Цена платного DM: необязательный `dmPriceMills` (`MoneyMills | null`, USD mills) в `FanslyFollowerRowSchema` и
  `NewcomerCardVM` — минимальная известная цена за сообщение среди вариантов платного DM; отсутствие / null —
  цена неизвестна. Ключ `fansly.newcomers.dmClosed.paidPrice` с параметром `price` добавляет её в прежнюю причину.
  Положительные и отрицательные фикстуры — `test/fixtures/protocols-fansly.ts`; версия остаётся 1.15.0.

### P10b1 — «Новые» на Fansly: очередь прохода и её кнопки

- `vm/actions.ts`: `SetNewcomersPassRunning {running}` — «Пауза» (`false`) и «Проверить оставшихся» (`true`) очереди
  прохода фона; `CheckNewcomerNext {targetHandle}` — «Проверить следующим» / «Проверить чат» по ручке строки прохода
  (NF-038). Запросы фона — прежние `fansly.followers.{pause,resume,prioritize}`. Фикстура — `test/fixtures/vm.ts`.
- `vm/newcomers.ts`, только типы: `NewcomersPassVM.run?` (`NewcomersPassRunVM`: можно ли «Пауза», «Проверить
  оставшихся» и сколько осталось, кнопка ждёт ответа) и `NewcomerCardVM.checkNext?` (`next` | `now` | null).
- `newcomers-fansly`: ключи `fansly.newcomers.run.pause`, `fansly.newcomers.run.resume`, `fansly.newcomers.checkNext`,
  `fansly.newcomers.checkNow`.

### P10a — «Новые» на Fansly: окно прохода

- Исправление P1: необязательный `fansly.followers.read.req.query` (`search`, `tab`, `filter`) применяется фоном ко
  всему проходу **до** `offset/limit`; `res.total` при таком запросе — число совпадений, `pass.counts.total` — весь
  проход. Ответ на запрос с `query` обязан содержать `counts`: вкладки после поиска по всему проходу, фильтры
  после поиска в выбранной вкладке, до выбора фильтра. Старый запрос без `query` и ответ без `counts` валидны;
  новый читатель отсутствие счётчиков считает сбоем, а не нулём. Семантика статусов — `core/domain/newcomers/pass.ts`
  (`inPassTab`, `passesCheckFilter`, `matchesPassSearch`), вердикт строки Fansly — `checkOf`. Обработчик прохода
  P10b1 должен обслуживать этот запрос; в P10a он проверен тестовым фоном. `NewcomersPassVM.passId?` даёт окну
  сбросить защиту `LoadMore` при смене прохода. Положительные и отрицательные фикстуры — `protocols-fansly.ts`.
- Реестр Fansly (`tab-messages-fansly`), добавочно: у строки `FanslyFollowerRowSchema` — необязательные `customName`
  (своё имя фана, заметка 12002), `bio`, `fanWrote` («Ждёт ответа»), `proof` (личное сообщение модели для «Уже
  писали», `FanslyPreviewMessageSchema` — теперь объявлена до строки) и `error` (почему `failed`, `CgAnyErrorWire`);
  у прохода `FanslyPassViewSchema.phase?` (`FANSLY_PASS_PHASES`: welcome, followers, profiles, checking); у ответа
  `fansly.followers.read` — `seq?`, последнее изменение `fansly.followers.changed`, которое снимок уже содержит;
  предел `FANSLY_TAB_LIMITS.bioMaxChars`. Старые строки и снимки без полей валидны. Фикстуры — `test/fixtures/
  protocols-fansly.ts`, верные и неверные.
- `vm/newcomers.ts`, только типы: `NewcomersVM.pass?` — список, который проверяет проход фона (`NewcomersPassVM`:
  стадия и фаза, «Проверено N из M», даты окна, пауза, фильтры по вердикту, отказ, карточка `NewcomerCardVM` с
  перепиской прохода `NewcomerHistoryVM` до предела и адресом «Открыть … ↗»); `NewcomerRowVM.check?`;
  `NEWCOMER_CHECKS`, `NEWCOMERS_PASS_STAGES`, `NEWCOMERS_PASS_PHASES`. Сайта не называют.
- `vm/actions.ts`: `NEWCOMER_CHECK_FILTERS` и действие `SetNewcomersCheckFilter` — фильтр списка прохода. Остальные
  действия окна — прежние (`SetNewcomersWindow`, `SetNewcomersTab`, `Search`, `LoadMore`, `ResetFilters`,
  `ReloadView`, `OpenPreview`/`LoadOlder`/`RefreshArchive` по ручке строки прохода). Фикстура — `test/fixtures/vm.ts`.
- `newcomers-fansly` (новый, только подпуть): ключи текстов окна `fansly.newcomers.*`; тексты — пакет Fansly
  (`core/src/domain/hosts/fansly/i18n/newcomers.ts`), приходят с чанком окна; общий каталог их не несёт.

### P8c, часть B — пометка над Recap, Review и Coach, глубина Recap выше 3000

- **`vm`: пометка над анализом.** Необязательные `RecapViewVM.stale`, `ReviewVM.stale`, `CoachTurnVM.stale`
  (`ResultMarkVM`) и `CoachTurnVM.again` (`ActionButtonVM`, «Ещё раз» помеченного ответа — тот же вопрос заново).
  Это вердикт проверки окна сайта (спецификация R20 §3.5, FS-TAIL-8) над Recap, Review и ответом Coach, которые эта
  вкладка сгенерировала; «Ещё раз» у Recap — `refresh`, у Review — `regenerate`. То, что фан написал после генерации, у
  них по-прежнему строка отставания архива (NEW-02), а не пометка: вердикт ChatSpace даёт только `fan-wrote`, и на
  ChatSpace над анализом пометок нет.
- **`ops`: `AiHostPolicy.windows?()`** — желание глубокого окна, которое хранит сайт (`settings.ext` `windows`, 3001…5000):
  его спрашивает только старт глубокого окна (Review, полный Recap, полный авто-Recap Coach); планировщик ограничивает
  его `limits.deepMax`, разовое окно приоритетнее. Нет порта, `null` или сбой — окно v1. Только типы.
- **`tab-messages-fansly`: `fansly.settings.windows`** (вкладка Fansly → фон): `windows` ключа `settings.ext` и больше
  ничего; остальное в ключе — по-прежнему только страницы настроек. Фикстуры — `test/fixtures/protocols-fansly.ts`.

### P8b2 — слова пометки проверки окна

- **`vm`: `ResultMarkKey`** — ключи слов пометки, которую вердикт проверки окна ставит над результатом (`ResultVM.stale`
  с причиной `unverified`, `window-miss`, `deleted-served`; спецификация R20 §3.5, FS-TAIL-8; ui-design §4.7):
  `result.stale.unverified | windowMiss | deletedServed`, у каждого `.title` (начало, жирным) и `.body` (продолжение).
  Только типы. Ключи — не общего каталога: их несёт каталог сайта, чей вердикт даёт эти причины (вкладка Fansly,
  `core/src/domain/hosts/fansly/i18n/marks.ts`), так что в бандлах ChatSpace этих слов нет. У `fan-wrote` и
  `archive-moved` — прежние общие «Фан написал новое» (`result.stale.title`, `.body`). Общий `Result` выбирает слова
  по причине пометки; на ChatSpace пометка по-прежнему только `fan-wrote`.
- Фикстур нет: схем нет. Тесты — `packages/contracts/test/ai-policy.test.ts` (ни один ключ не общий, общие ключи
  «фан написал новое» прежние), `packages/core/src/domain/hosts/fansly/i18n/i18n.test.ts` (каталоги Fansly — ровно эти
  ключи в обоих языках, в общих каталогах их нет).

### P12a — скрипт войса через общую опеку операций

- `SiteOpView` / `AnyOpView` — только типы; схема `FanslyOpViewSchema` остаётся в подпути Fansly, со своим типом результата и обязательной ссылкой источника у `done`. Общие `StartOpSchema` / `OpViewSchema` закрыты, как прежде.
- `fansly.ops.start/read/list/cancel` и `fansly.ops.done` — порт будущей панели: общий допуск, чтение результата и отмена. Схемы и фикстуры — в реестре сайта, его значения в общие бандлы не входят.
- Необязательное `Admission.siteActive` — безопасные имена и состояние занятых операций сайта рядом с общим `active`. `ActiveOpSummarySchema` остаётся закрытой; `SiteActiveOpSummarySchema` несёт только отображение, а исполняемые старты проверяет собственный реестр. Модель `RunningOpVM` принимает имя операции. Старые значения и формы проходят без изменений.

### P11c — «Заполнить из чата»

- `notes-fansly.ts`: у `NotesEditorVM` — `fill` (`NotesFillVM`: идёт, готово — какие поля Гусь вписал, сбой; `null` —
  выключено на странице или черновик не анкета); действия `fill` и `fill-stop`; слова заполнения в `NotesCopy`.
- `ops-fansly.ts`: `FANSLY_OP_LIMITS.notesFillDepthMin = 3000` — глубина заполнения по HF-6 (не меньше 3000, выше —
  `limits.deepMax`). Только типы и константа; старт `notes-fill` и его результат не меняются.

### P11b2 — анкета полями

- `notes-fansly.ts`: у `NotesPanelVM` — `forms` (анкеты среди заметок по `noteId`: поля с фактами и месяцем, строки
  без поля), у `NotesEditorVM` — `form`, `asText` («Текстом») и `suggestions` (правки Гуся под своим полем; до P11c
  пусто); новые действия `field`, `as-text`, `suggestion`; слова таблицы и правки в `NotesCopy`. Только типы, старое
  не меняется; запросы `fansly.notes.*` те же.

### P11b — «Заметки» фана

- Проверка версии перед записью: добавочное `fansly.notes.edit.current?` (исходные заголовок и текст редактора).
  Фон перечитывает заметку и отказывает с `CG-NOTE-WRITE`, `detail: changed`, если версия отличается или отсутствует;
  старые запросы разбираются, но не перезаписывают заметку без версии. Для имени сравнивается уже существующее
  `fansly.notes.name.current`; чтение и запись одного фана идут последовательно. `NotesCopy.problem.changed` —
  сообщение о конфликте через прежнюю поверхность ошибок. Фикстуры: `test/fixtures/protocols-fansly.ts`.
- `fansly.notes.*`: у каждого запроса — `pageId` (фон допускает по переключателю страницы `notes`, как «Регистрацию»);
  в `fansly.notes.read` фан может быть неизвестен (`fanRef: null` — фон один раз на чат читает группу), ответ называет
  `fanRef`; `fansly.notes.delete` несёт заметку целиком (заголовок и текст — удаление Fansly берёт заметку), `fansly.notes.name`
  — текущую заметку имени (`current`). Новые `fansly.notes.view` и `fansly.notes.setView` (вид панели из `settings.ext`) и
  событие `fansly.notes.viewChanged` — всем вкладкам Fansly. Запросы этой семьи до P11b никто не слал.
- `notes-fansly.ts` — модель, действия и клиент кнопки и панели; `CATALOG_ACTION_IDS` += `notes` (⌘⇧K / Ctrl+Alt+K —
  строка клиента `fansly`; на сайте без функции её нет), ключ `cheatsheet.row.notes`. Старые модели не меняются.

### P11a — регистрация фана

- Добавлен `fansly.registration.read`: страница хаба, аккаунт вкладки и группа; ответ — только id второго участника либо существующий код ошибки. Запрос только от вкладки Fansly, схемы и фикстуры в её отдельном реестре.
- `registration-fansly.ts` — модель, клиент и порт форматирования даты/календарного возраста шапки внутри вкладки; необязательный `FanPanelVM.registration` — локальная дата и подпись для общего UI. Старые модели не меняются.

### P14b2 — popup, статус и безопасная отладка

- Добавочные `diagnostics.get.siteAccess/requestModes/freshness`, `tabs[].page/networkSession` и `health.report.page`: доступ, режим запросов, булевы соседнего расширения, числовые счётчики, возраст сессии и только имена заголовков; ограниченный локальный суточный агрегат.
- Необязательный `tab.presence.conversationRef` и его проекция в диагностике сохраняют groupId отдельно от id фана.
- Редактор логов скрывает значения заголовков `*-client-id/ts/check` и `*-session-id`; безопасная проекция передаёт только их имена.
- Необязательный `HostPort.diagnostics()` соединяет наблюдения сайта с общим tab-health без импорта сайта.
- `GenerationDebug` в `OpDebugView` и `debug.prompt`: исходный снимок контекста генерации и ответы покрытия по id; только в режиме отладки. Необязательные модели строк popup, деталей статуса и снимка отладки; ключи i18n.
- Старые сообщения проходят без новых полей. Положительные и отрицательные фикстуры — `test/fixtures/diagnostics.ts`, тесты — `test/diagnostics.test.ts`.

### P14a — звуки сокета

- `fansly.sound.batch` в собственном реестре Fansly: 1–512 фактов сокета без текста, один запрос на пачку,
  только из вкладки Fansly. Схема пачки не входит в общий реестр; ChatSpace `sound.event` сохранён.
- В `tab.presence` — необязательный `conversationRef` для фокуса разговора без известного фана;
  в `fx.incoming` — необязательные `senderId` и `accountId` (креатор при захвате).
- Фикстуры — `test/fixtures/protocols-fansly.ts`, `test/fixtures/protocols.ts`; проверки — `test/sound.test.ts`.

### Review follow-ups — порядок id и допуск флагов ChatSpace

- `primitives.compareNativeIds` и `nativeIdsAscending` — один порядок канонических десятичных id без `Number`:
  длина, затем строка. `fansly.compareFanslyIds` сохраняется как реэкспорт; снимок Fansly и `StartProofV1`
  используют те же функции. Формы и ограничения провода не меняются; модуль сайта в общие схемы не импортируется.
- `features/chatspace.CHATSPACE_FEATURE_FLAGS` — явный список допустимых флагов; `ChatSpaceFeatureFlag` выводится
  из него. Новый флаг общего словаря требует явного допуска в ChatSpace. Общая фикстура тестов выводит дополнение
  списка; тест сверяет допуск с таблицей платформ fake hub. Архитектура R20 §1.4, §5.8, §12.
- Фикстуры порядка id проверяют переход длины, соседей выше 2^53, равные id и 30 цифр; прежние фикстуры
  снимка и Hi сохраняются. Внешних зависимостей не добавлено.

### P14b1 — Fansly на странице настроек

- Реестр Fansly (`tab-messages-fansly`): четыре запроса страницы настроек (`from: page`, `pages: ['options']`) —
  `fansly.settings.read` и `fansly.settings.write` (часть Fansly ключа `settings.ext`: «Fansly через вкладку», тоны,
  глубина выше 3000; `FanslySettingsPatchSchema` — патч ключа без `enabled` и `notesView`), `fansly.accounts.read`
  (`FanslyAccountsViewSchema`: живые сессии — legacy и canonical id, вкладки, время; открытые вкладки; без атрибуции)
  и `fansly.accounts.focus`. Фикстуры — `test/fixtures/protocols-fansly.ts`, верные и неверные; правило «страница
  в реестр сайта не ходит» стало «ходит только за этими четырьмя».
- `pages-fansly` (новый, только подпуть): вид и порт контроллера Fansly на странице (`FanslyPagesView`,
  `FanslyPagesControl`, `FanslyStep`, `FanslyPageFacts`) и ключи его текстов `fansly.pages.*` — каталоги Fansly
  (`core/src/domain/hosts/fansly/i18n/pages.ts`), общий каталог их не несёт.
- `vm/pages.ts`: `AccountsBodyVM.rows[].aliases?` — другие id аккаунта (legacy id сессии рядом с id креатора, ST-079);
  `AccountsBodyVM.phrases?` — сайты списка для пояснения и подсказки («OnlyMonster и Fansly», «ChatSpace или Fansly»),
  нет — фразы сайта страницы. Только типы; старые модели без полей валидны.
- Протокол платформы (не схемы контрактов): `SiteSenderContext` и `HostSiteSender` — вид `page`; опция
  `pageSite` фона ([site-access.md](protocols/site-access.md) «Страница настроек и модуль сайта»).

### P9a — права опционального сайта

- Общий запрос страниц `site.access` (только popup/options): чтение состояния опционального сайта,
  переключатель `enabled` и перезагрузка ожидающих вкладок. Ответ — хост, `enabled/granted/registered`
  и число ожидающих; после перезагрузки необязательный `reloaded` считает успешно перезагруженные вкладки.
  Старый ответ без этого поля валиден. Сессия и заголовки из фона не выходят.
- Схемы и порт поверхности — `site-access.ts`, фикстуры — `test/fixtures/protocols.ts`,
  [протокол](protocols/site-access.md). Чтение не регистрирует скрипты и не пишет хранилище.
- Ключи i18n `siteAccess.*` и `settings.status.site.*`: управление доступом и статус сайта с его
  собственными фразами. `FANSLY_STATUS_TEXTS` — из подпути `fansly-host`; ChatSpace сохраняет свои ключи.

### P4a1 — сайт и маршрут

- **Модуль `hosts`** (новый, подпуть `@cg/contracts/hosts`; лёгкий: без zod и без импортов): `HOST_KINDS` переехал
  сюда из `ids`, рядом — `HOST_PLATFORM` = `{chatspace: 'onlyfans', 'fansly-web': 'fansly'}`, платформа каждого сайта.
  `ids` по-прежнему экспортирует `HOST_KINDS` и `HostKind` (подпуть `@cg/contracts/ids` для потребителей не меняется),
  `HostKindSchema` строится из того же списка. Адреса, скрипты и поля сборки сюда не идут: они в реестре хостов
  приложения (`apps/extension/src/hosts`, F2), и бандл ChatSpace не несёт адресов Fansly.
- **`TargetSchema`:** пара хост↔платформа берётся из `HOST_PLATFORM` (чат хоста привязан только к странице его
  платформы), а не из литерала `chatspace ⇔ onlyfans`. На двух сайтах смысл тот же: те же пары принимаются, те же
  отклоняются (тест перебирает все пары). Сообщение отказа — «a chat binds to its host's platform only».
  На Fansly `conversationRef` — `groupId`, `fanRef` — id фана; правило «на OnlyFans `conversationRef` = `fanRef`» не
  тронуто.
- **`RouteStateSchema`** — два необязательных поля: `conversationRef` (разговор маршрута, как его называет адрес: на
  Fansly — `groupId` из `/messages/<groupId>`, известен раньше фана) и `conversationKind` (`ConversationKindSchema`:
  `direct` — модель и один фан, `group` — фанов больше). Проверка одна — `conversationFits`: разговор называет только
  маршрут чата; вид — только вместе с разговором; у группы нет «своего» фана (`chat` = null: ни дока, ни AI); на
  OnlyFans разговор — это фан (как в `Target`). Нет полей — разговор = фан, как у ChatSpace до 1.15.0; ChatSpace их не
  ставит.
- **`NavigationIntentSchema`:** `target.conversationRef?` — разговор фана, когда это не сам фан (на Fansly — `groupId`
  из маршрута или из разрешения группы этого фана, никогда из маршрута другого чата). Только у цели-чата: с
  `platformFanId: null` (открыть аккаунт) — отказ. Проводная форма моста `NavigationWire` (`acc`, `fan`) не меняется:
  MAIN ChatSpace поля не видит.
- **Байты.** `.check()` — вызов метода, и сборщик оставляет такую схему даже там, где её никто не разбирает: фон не
  разбирает ни маршрут, ни навигацию, но носил `NavigationIntentSchema` и понёс бы новую проверку маршрута. Обе схемы
  помечены `/* @__PURE__ */`, и rolldown выбрасывает их из фона. esbuild, которым меряют пробы контрактов, вызовы
  zod чистыми не считает (метку на цепочке с `z.refine` в аргументах — тоже) и оставляет в пробе каждую схему
  импортированного модуля: проба реестра запросов вкладки считает новые поля и проверки целиком. Поэтому проверка
  маршрута — одна функция, а не четыре `z.refine`. Дельты по строкам реестра байтов — в описании PR.
- Фикстуры: Fansly-образцы с 18-значными синтетическими id (`fanslyChat`, `fanslyAccount`, `fanslyBinding`,
  `fanslyTarget`, `fanslyRoute`, `FANSLY_IDS`); верные и неверные фикстуры `Target` (пара по таблице для Fansly),
  `RouteState` (группа без фана, вид без разговора, разговор не на маршруте чата, разговор ≠ фан на OnlyFans),
  `ConversationKind`, `NavigationIntent` (разговор у цели-аккаунта). Тесты: `packages/contracts/test/vocabulary.test.ts`
  («sites (1.15.0, R20)»), `packages/contracts/test/schemas.test.ts`.

### P4a2 — мост Fansly

Три новых модуля сайта: `bridge-fansly`, `bridge-messages-fansly`, `fansly` (`docs/project-unite/architecture.md`
§5.5–§5.8, §6, §7.7, §7.12). Только подпути `@cg/contracts/<модуль>`: корень `@cg/contracts` их **не** реэкспортирует
(тест держит), поэтому ни бандл ChatSpace, ни ядро фона их не несут (§1.8, §3.2). Файлы ChatSpace не тронуты, байты
ChatSpace не меняются.

- **`bridge-fansly`** (лёгкая половина, как `bridge` у ChatSpace): запросы в MAIN `TO_MAIN_FANSLY_TYPES` — `probe`,
  `fx.state`, `fx.focus`, `fx.generationSnapshot`, `fx.windowMeta`, `fx.ack`; события внутри пачки
  `FROM_MAIN_FANSLY_TYPES` — `fx.identity`, `fx.chat`, `fx.contract`, `fx.incoming`, `fx.follow`, `fx.sent`,
  `fx.coverage`, `fx.deleted`, `fx.vaultAdded`; события на порту `FANSLY_WIRE_EVENT_TYPES` — `fx.batch`, `fx.gap`,
  `fault`. Состояния (`FANSLY_BRIDGE_STATE_EVENTS`: личность, чат, контракт) склеиваются — в пачке не больше одного
  каждого; поток (`FANSLY_BRIDGE_UNDROPPABLE_EVENTS`: остальные шесть) идёт по порядку и по одному не теряется: при
  исчерпании бюджета уходит вся очередь сразу, и об этом говорит одно `fx.gap`. `FANSLY_BRIDGE_WRITE_REQUESTS` пуст:
  MAIN на Fansly ничего не пишет (§5, А4). Кредиты `FANSLY_BRIDGE_LIMITS`: ≤ 8 неподтверждённых пачек и ≤ 256 КиБ в
  пути; пачка ≤ 64 КиБ и ≤ 512 событий; ответ на снимок ≤ 128 КиБ. `fanslyFrameByteLimit(kind, t)` — предел байтов
  кадра по его типу: изолированный мир сравнивает с ним байты, которые насчитал `checkBridgeFrame`. Конверты
  `FanslyBridgeResponseSchema` и `FanslyBridgeEventEnvelopeSchema` — тот же конверт и те же транспортные ошибки, что у
  ChatSpace, со своими списками типов: запрос или событие ChatSpace не проходит как Fansly, и наоборот.
- **`bridge-messages-fansly`** (схемы, чанк `bridge-validation` сборки Fansly): `TO_MAIN_FANSLY` — схемы запросов и
  ответов (у `probe` — общий `MainProbe`: на него отвечает загрузчик host-kit; у `fx.focus` — эпоха маршрута
  изолированного мира, MAIN возвращает её в `fx.chat`; `fx.ack {n}` — накопительное подтверждение пачек до `n`
  включительно, принятых или отвергнутых), `FROM_MAIN_FANSLY` — схемы событий пачки, `FANSLY_WIRE_EVENTS` —
  `fx.batch {n, events: [{t, p}]}`, `fx.gap {reason: 'overflow' | 'memory'}` и `fault`; полные кадры
  `FanslyBridgeRequestSchema`, `FanslyBridgeEventSchema`, `FromMainFanslyFrameSchema`; разбор третьей ступени
  `parseFanslyBridgeData` (`{ok, data}`: `null` — законный ответ нескольких запросов) и `parseFanslyWireEvent`. Пачка
  проверяется целиком: одно плохое событие — пачка потеряна вся, как при `fx.gap`. Через мост — только метаданные;
  текст переходит один раз — хвостом снимка для функции черновика по клику человека.
- **`fansly`**: `FanslySnapshot` (ответ `fx.generationSnapshot`: функция, личность, эпохи, полнота и её причина,
  окно проверки ≤ 60, `knownFanMessageIds` ≤ 10, удалённые ≤ 120, хвост ≤ 60 в форме `LiveTextMessage`, `truncated`;
  проверки: все id проверки — из окна и в порядке snowflake, хвост — только у Reply, Fix, Hi, Ping, доказательство и
  аватар — только у Hi этого же чата, причина есть ровно при `unknown`); `StartProofV1` (`v`, `source:
  'tab-short-page' | 'pass-empty-page'`, `groupId`, `startWitnessId` — по источнику, `null` только при пустой
  истории, `coveredCount`, `personalCount` — у прохода среди последних 30, `automatedIds` ≤ 120 по возрастанию и не
  старше свидетеля); `FANSLY_ANCHOR_IDS` (17 якорей §7.12, из них сетевые `FANSLY_NETWORK_ANCHORS` сообщает MAIN);
  `FANSLY_CAPABILITIES` (`freshness`, `follows`, `headerSlot`, `fileAttach`, `vault`, `relay` — сверх общих
  `HOST_CAPABILITIES`); `FanslyPagePort` — только тип: слот шапки, файл в поле, файл в vault, кадр relay;
  `FANSLY_LIMITS`, `FANSLY_COVERAGE_REASONS`, `compareFanslyIds`; `FanslyAvatarUrlSchema` — правило хаба для
  `fanAvatarUrl` (FX-018).
- **Аватар Hi (FX-018).** Снимок для Hi несёт `fanAvatarUrl?` — строку адреса из ответов страницы (P7b): иначе URL
  нечем передать из MAIN в изолированный мир. Схема та же, что у хаба (`^https://[a-z0-9-]+\.fansly\.com/`, ≤ 4096),
  в тело хаба поле добавит P4b4. Архитектура §5.8 дополнена.
- **Id Fansly — строки, никогда не числа.** Snowflake от эпохи Fansly 2019-06-25: сейчас 18 цифр, с января 2027 —
  19, у созданного до апреля 2020 (старые аккаунты фанов) — 17 и меньше. Поэтому шаблон — общий `NATIVE_ID_PATTERN`, а
  не «ровно 18–19 цифр»: узкий шаблон отверг бы старых фанов. Порядок — `compareFanslyIds`: сначала длина, затем строка
  (19-значный новее 18-значного, хотя строкой меньше).
- Фикстуры (`packages/contracts/test/fixtures/fansly.ts`, в `@cg/contracts/fixtures`): верные и неверные на каждый
  запрос (данные и ответ), каждое событие пачки, каждое событие порта, снимок и доказательство; пределы:
  `automatedIds` 121, окно 61, известных сообщений фана 11, групп в `fx.coverage` 301, удалённых 121, 513 событий
  пачки, пачка больше 64 КиБ (`oversizeFanslyBatch`), ответ на снимок больше 128 КиБ (`oversizeFanslySnapshot`);
  id числом — отказ. Тесты: `packages/contracts/test/fansly.test.ts`.

### F1 — фоновые модули сайтов в диагностике

Не PR этапа 4, но в его открытую версию: службы одного сайта уходят из ядра фона в чанк сайта `bg/<сайт>.js`
(`docs/project-unite/architecture.md` §3.3), и «Статус» должен сказать, если чанк не запустился.

- **`DiagnosticsSnapshot.hostModules?`** — массив `{host, state}` (не больше 8): где стоит фоновый модуль каждого
  сайта. `HOST_MODULE_STATES` = `idle` (ещё не нужен: ни вкладки сайта, ни его незавершённых дел), `starting`,
  `started`, `failed` (службы сайта в фоне не запустились: его собственные запросы отвечают
  `CG-RUNTIME-UNREACHABLE`, ничего не отправляется). Нет поля — фон до 1.15.0.
- **Ключ i18n** `settings.status.warning.hostModule` — предупреждение «Статуса» «фоновые службы сайта не
  запустились — перезагрузите его вкладку» (без имени сайта: общие тексты имён сайтов не несут, F9b).
- Фикстуры `diagnostics.get`: верные — модуль запущен; один упал, другой не нужен; неверные — неизвестное
  состояние, не вид хоста в `host`.

### P4a3 — протокол вкладки Fansly, `settings.ext`, коды Fansly

- **Тип сообщения — до двух точек** (`TypeSchema` конверта, `tab-protocol`): `op.start` и `fansly.notes.read`; три и
  больше, пустое слово, заглавная первая буква — отказ, как прежде.
- **Правила отправителя — одна функция** `senderAllowed(spec, sender, page, host)` в `tab-protocol` (там же типы
  `TabRequestSpec`, `TabEventSpec`); `mayRequest(type, sender, page, host = null)` — по ней. `RequestSpec.hosts?` —
  запрос только из вкладки (или relay) этих сайтов; страниц не касается; вкладка неназванного сайта получает отказ.
  В общем реестре `hosts: ['chatspace']` у X8 и «Новых» хаба: `send.begin`, `send.status`, `send.list`,
  `send.report`, `send.fuse`, `send.fuseState`, `newcomers.list`, `newcomers.claim` — вкладка fansly.com их не шлёт
  (приветствие Fansly — своя HTTP-отправка фона, «Новые» — свой проход). Схемы этих запросов не менялись.
- **Отправитель `relay` и порт `cg-relay`** (`RELAY_PORT_NAME`): кадр relay «Fansly через вкладку» — страница
  расширения в подкадре вкладки сайта с зарегистрированной сессией; говорит за эту сессию. В общем реестре ему не
  разрешено ничего.
- **Модуль `tab-messages-fansly`** (новый, только подпуть): реестр сайта, разбирается в чанке `bg/fansly` —
  `fansly.followers.{scan,pause,resume,read,prioritize,exclude,history,close}` и событие `fansly.followers.changed`;
  `fansly.notes.{read,create,edit,delete,name}`; `fansly.voice.{create,status,audio,attempts}`;
  `fansly.vault.{checkpoint,resume,clear}`; `fansly.relay.{head,body,failure}` от relay и события
  `fansly.relay.{fetch,abort}` к нему (только `https://apiv3.fansly.com/api/v1/`, с ожиданием аккаунта для последней
  сверки кадра). У каждого запроса `hosts: ['fansly-web']`. Своя ошибка сайта — в теле ответа
  (`{ok: false, error: CgAnyErrorWire}`). Первая редакция: PR каждой семьи (P9c, P10*, P11b, P12b*, P13a)
  дописывает поля и типы добавочно.
- **Модуль `errors-fansly`** (новый, только подпуть) и приложение А «Коды Fansly»: 34 кода `CG-FAN-*`, `CG-NOTE-*`,
  `CG-VOICE-*`, `CG-VAULT-*`, `CG-FNEW-*`, реестр сайта (виды `fansly`, `note`, `voice`, `vault`, `newcomers`), ключи
  текстов и форма каталога Fansly; `CgAnyCode`, `CgAnyErrorWireSchema`; `HUB_FANSLY_ERROR_CODES` — `voice_*`,
  `gate_voice_*`, `idempotency_mismatch`, `artifact_expired` хаба → коды Fansly. Числовые коды старого не
  заимствуются; списанные им CG-API-02/03/04, CG-AUTH-01/02 не занимаются (ER-083). Тексты ru и en — каталоги Fansly
  `core/src/domain/hosts/fansly/i18n` (не каталоги ChatSpace); `docs/error-registry.md` — раздел «Коды Fansly».
  `CG_CODES` и общий реестр не менялись.
- **Карта ошибок хаба:** `conversation_fan_mismatch` (409, HF-9) → CG-CONTEXT-CHANGED, показать; общий код — путь
  AI и вид операции общие. `HUB_ERROR_STATUSES` — плюс эта строка.
- **Ключ `settings.ext`** (`STORAGE_KEYS.settingsExt`; схема — новый модуль `settings-ext`, только подпуть): своя
  версия `v: 1`; вид с умолчаниями `{v, hosts: {'fansly-web': {enabled, viaTab, notesView, sound: {messagesTone,
  subscribersTone}}}, windows: {deep: 3001…5000 | null}}`, патч (`windows.deep: null` — снять), ответ «сохранено с
  ревизией». В хранилище — только то, что выбрал человек; поля, которых патч не называет, и поля других сборок
  остаются как есть. Настройки v1 не менялись (`deep` ≤ 3000, фикстура `deep: 3001` недопустима по-прежнему).
  Владелец — `createSettingsExtOwner` в `core/src/services/settings-owner.ts` рядом с владельцем v1, который не
  менялся; подключают его к фону и RPC PR потребителей (P9a, P14b1, P4b2).
- **Лёгкие копии списка сайтов** в `tab-protocol` и `settings` заменены импортом `HOST_KINDS` из `hosts` (лёгкий
  модуль, байт ChatSpace не стоит).
- Фикстуры: `test/fixtures/protocols-fansly.ts` — верные и неверные на каждый запрос, ответ и событие реестра Fansly,
  на вид и патч `settings.ext`. Тесты: `packages/contracts/test/fansly-protocol.test.ts`,
  `packages/core/src/services/settings-owner.test.ts` (владелец `settings.ext` и приёмка отката новое → старое →
  смена темы → новое на настоящих владельцах), `packages/core/src/domain/settings/ext.test.ts`,
  `packages/core/src/domain/hosts/fansly/i18n/i18n.test.ts`, `packages/platform/src/rpc.test.ts` (relay, правила
  сайта, реестр сайта в фоне), `packages/core/src/domain/errors/hub-map.test.ts`.

### F4 — манифест фич и допуск по действиям

Не PR этапа 4, но в его открытую версию (`docs/project-unite/architecture.md` §1.4, §1.5, §11.1): что фича есть на
каждом сайте и что ей там нужно — данными, по файлу на сайт; чипы полосы — данными; в клиентской таблице флагов —
только нужда транспорта клиента.

- **Модули манифеста** (новые, только подпути — корень `@cg/contracts` их не реэкспортирует: его импортирует ранний
  изолированный бандл): `features/types` — `FeatureCommon` (`kind`, `chip?: {group, priority, icon}`, `hotkey?`),
  `Requirement` (`flags`, `hostCapabilities`, `clientNeeds?` — всё AND; параметры — словари, которые может назвать
  файл сайта), `FeatureOnHost` (`base`, `actions` по `ADMISSION_ACTIONS` = `generate`, `insert`, `send` — нет ключа,
  нет действия; `surfaces`, `source?` = `hub` | `host-pass` | `page`), `FeatureEntry`, `FeatureSlice`, словари
  `FEATURE_KINDS` и `HOTKEY_ACTION_IDS` (= `HotkeyAction` вендоренной схемы `@chatgoose/hotkeys`; контрактам доступен
  только zod, полноту держит тест `core/src/domain/hotkeys`); `features/common` — `FEATURES_COMMON`: семь действий
  полосы, `fresh-text`, `spenders`, `newcomers`, `fan-panel`, `sound`; `features/chatspace` — `CHATSPACE_FEATURES`
  (плюс `preview-send`, `navigation`, `palette`); `features/fansly` — `FANSLY_FEATURES` (плюс `voice`, `notes`,
  `notes-fill`, `registration`, `vault`, `via-tab`) и имена, которых в общих словарях ещё нет: `FANSLY_FLAGS_AHEAD`
  (`drafts`, `voice`, `notes`, `notesFill`, `vault`, `registration` — флаги HF-12 и HF-2; в `CLIENT_FEATURE_FLAG_NAMES`
  их переносит P4b3) и `FANSLY_SURFACES_AHEAD` (`header-slot`, `voice`, `notes`, `vault`). Схем нет: манифест —
  данные, границу как `unknown` не пересекает.
- **`CLIENT_FLAG_REQUIREMENTS`** (`hub/routes.ts`) — только нужда транспорта самого клиента: `{freshText:
  ['context-v1']}` (хаб отказывает `liveTextContext` без этого заголовка). Остальное было копией таблицы хаба
  `CLIENT_FEATURE_REQUIREMENTS`, которую хаб уже вложил в `pages[].features[flag]`; поле `serverChecked` ушло вместе с
  ней (его никто не читал). Смысл флага страницы не изменился: таблица флагов ChatSpace на нынешнем хабе та же —
  держит `packages/testing/src/fake-hub/flag-table.test.ts`.
- **`vm/dock.ts`:** `DOCK_CHIP_GROUPS` (`reply`, `draft`, `openers`, `analysis`, `windows` — в порядке полосы),
  `DOCK_ICON_IDS` (`gauge`, `dossier`, `bulb`, `bill`, `userPlus` — иконки kit), `ChipVM` (поля `DockActionVM` и `id`,
  `group`, `icon`, `label`, `hint`, `action: UiAction | null`) и необязательное `DockVM.chips` — чипы полосы в порядке
  групп и приоритетов. `actions` для замороженных семи остаётся. Модель без `chips` (производитель до 1.15.0) полоса
  рисует без чипов. Слоты групп и иконки держит `ui/kit` (`kit/chips.ts`, его тест — по каждому значению).
- Фикстуры: `test/fixtures/features.ts` — верные и неверные требование, файл сайта и чип (неверные отвергает
  компилятор: у манифеста нет схемы). Тесты: `packages/contracts/test/features.test.ts` (словари, по файлу на сайт,
  полные записи `reply`, `newcomers`, `preview-send`, `voice`, `notes-fill` для обоих сайтов),
  `packages/core/test/domain-admission.test.ts` и `domain-admission-fansly.test.ts` (допуск и отрицательные фикстуры:
  выключенный `insertion` не закрывает генерацию; приветствие из «Новых» ChatSpace требует `newcomers` и
  `previewSend`), `apps/extension/test/feature-slices.test.ts` (новая запись только в `features/fansly.ts` не меняет
  ни байта ChatSpace).

### F6a — разговор тоста фона

Не PR этапа 4, но в его открытую версию: общий код перестаёт подставлять фана вместо разговора
(`docs/project-unite/architecture.md` §1.9), и «Открыть чат» тоста должно открыть разговор операции, а не угадывать
его.

- **`BackgroundToast.conversationRef?`** — разговор чата тоста, когда это не сам фан: на Fansly — `groupId` цели
  операции. Только вместе с `chat`. Нет поля — разговор = фан: так у ChatSpace и у каждого тоста до 1.15.0; фон
  ChatSpace поле не ставит, тост ChatSpace байт в байт прежний.
- Фикстуры: верный тост Fansly (`fanslyToast`: `chat` Fansly, `conversationRef` = группа), неверные — разговор не
  id (строка с буквами, число, пустая строка); событие `toast` реестра вкладки — те же. Тесты:
  `packages/contracts/test/schemas.test.ts`, `packages/contracts/test/protocols.test.ts`.

### P4c — отправка приветствия Fansly по HTTP

Новый модуль сайта `send-fansly` (только подпуть `@cg/contracts/send-fansly`, корень его не реэкспортирует) —
`docs/project-unite/architecture.md` §8.6, А10; спецификация FS-NEW-3, FS-NEW-6, FS-NEW-7. X8 (`send`, `send-rules`,
`send.journal`) не менялся: у него очередь ChatSpace и части генерации, здесь — один наш `POST /message` с текстом, который
человек мог написать или исправить.

- **Машина состояний данными:** `ready → claimed → routed → dispatched → intentWritten → requestStarted → receipted →
  sent`, концы `refused` и `uncertain` (`FANSLY_SEND_STATES`, `FANSLY_SEND_TRANSITIONS`). У каждого конца — доказательство:
  `FANSLY_REFUSAL_PROOFS` (`before-dispatch`, `not-enqueued`, `native-rejected` — 4xx, кроме 401, `resolved-not-sent` —
  решение хаба), `FANSLY_SENT_PROOFS` (`echo`, `history` — с id своей квитанции, `resolved-sent`),
  `FANSLY_UNCERTAIN_CAUSES` (`restart`, `network`, `server`, `unauthorized`, `rejected-200` — `200 {success:false}`,
  `bad-receipt`, `relay`, `receipt-missing`); какое из них допускает каждое состояние — `*_FROM`. `isFanslySendStep`
  отвергает всё, чего архитектура не называет: в `ready` не ведёт ничто, из `sent` и `refused` — ничто, из `uncertain` —
  только поздние эхо или история с id своей квитанции либо решение хаба; до записи намерения `uncertain` невозможен, между
  записью и `fetch` — только `restart`; `fetch` без записи намерения (`dispatched → requestStarted`) — не шаг.
- **Вид попытки** `FanslySendViewSchema` и **запись журнала** `FanslySendJournalEntrySchema` — объединения по `state`:
  у `receipted` — id сообщения, у `sent` — доказательство и id (без id — только решение хаба), у `refused` —
  доказательство, код и статус только при `native-rejected` (4xx, кроме 401), у `uncertain` — `CG-SEND-UNCERTAIN`, причина
  и id квитанции только при `receipt-missing`. Журнал — ключ `FANSLY_SEND_JOURNAL_KEY = 'fansly.send.journal'` (свой,
  `STORAGE_KEYS` не менялся), `{v: 1, entries}`, только id, ревизии, отпечатки и состояния; строгий — текст и заголовки
  сессии в него не лягут. Первая запись — в `routed`, до `dispatch`; билет есть с `dispatched`; вид допуска согласован с
  группой. `FANSLY_SEND_RECOVERY` — что делает перезапуск: до намерения → `refused` (`not-enqueued`, CG-OP-INTERRUPTED),
  после → `uncertain` (`restart`). `FANSLY_CUSTODY_REPORTS` / `fanslyCustodyReport` — что конец должен опеке хаба
  (`failed: not_enqueued`, `failed: native_rejected` со статусом, `sent`; у `uncertain` — ничего), `reportPending` — пока
  хаб не ответил. `FANSLY_SEND_OPEN_STATES` держат фана (ключ `fanslySendLockKey`), `isFanslyRetryableEnd` — новый клик
  только после отказа, который клик может снять.
- **Запрос приветствия «Новых»** `FanslyGreetingRequestSchema` и запрос вкладки `fansly.followers.send` (реестр Fansly):
  `attemptId`, `passId`, креатор, фан, `groupId`, `text` (содержимое поля, обрезанное, 1–5000), `draftRevision` (в хаб —
  `textRevision`, ≤ 2³¹−1), `historyRevision` (просмотренная ревизия истории), `admission` (FS-NEW-6: `own`, `ai` с
  генерацией и вариантом, `ai-edited` с исходной генерацией) и `cause` — действие человека. Ответ — вид попытки или
  ошибка сайта в теле.
- **Ручная группа и тело брони Fansly (HF-3 хаба, b37075d8):** `ManualClaimGroupSchema` `{kind: 'manual',
  textFingerprint}` (sha256 точного текста, строчный hex), `FanslyAiGreetingGroupSchema` (группа генерации из одной
  части), `fanslyGreetingGroup` — группа по виду допуска (неизменённый AI — генерация, иначе ручная), `greetingGroupRef` —
  как группу называет ответ хаба (`manual:<отпечаток>`). `FanslyGreetingClaimBodySchema` / `…OpSchema` — тело хаба,
  суженное до приветствия Fansly: `purpose` только `greeting`, одна часть, `dispatch` всегда под бронью, отказ — 4xx, кроме
  401. Тест держит, что каждое такое тело принимает схема хаба HF-3 (переписана в тест до перевендоринга SDK: вендоренный
  6ee3d627 старше ручной группы).
- **Типы для общего кода** — новый модуль `hub/claim-body` (только типы, `export type *` в `hub`): `ManualClaimGroup`,
  `ClaimSendGroup`, `HubClaimBody`, `HubClaimOp` — тело хаба после HF-3, им фасад (P9d) сможет назвать тело Fansly.
  `ClaimBodySchema` и `hub/newcomers.ts` не менялись: тело OnlyFans — только группы AI, другого хаб там не допускает.
  Отдельный модуль потому, что любая правка `hub/newcomers.ts`, даже тип или комментарий, меняет имена идентификаторов
  в минифицированной пробе реестра запросов вкладки (замер: длина та же, gzip 27 521 → 27 518 Б).
- **Последняя сверка** (§8.6, шаг 2): `FanslySendTuple` (креатор, группа, фан, документ вкладки, транспорт, ревизии истории
  и черновика) и `fanslyFinalCheck` — синхронно, по памяти, с остатком билета; `FanslySendReceiptSchema` и
  `fanslyReceiptFits` — квитанция `POST /message` считается только для своей группы и своего креатора.
- `limits.greetingSendPerMinute` bootstrap хаба (30 в минуту) клиент не читает: темп держит хаб (429
  `preview_send_rate_limited`), как и `previewSendPerMinute` у X8; схема bootstrap не менялась.
- Байты ChatSpace: ни одна строка реестра не сдвинулась — пробы контрактов те же до байта, закрепы F9a не переписаны.
- Фикстуры: `test/fixtures/send-fansly.ts` (id Fansly в 17, 18 и 19 цифр; число вместо строки — отказ), запрос
  `fansly.followers.send` в `protocols-fansly.ts`. Тесты: `packages/contracts/test/send-fansly.test.ts`,
  `packages/contracts/test/fansly-protocol.test.ts`.

### F7 — телеметрия и отчёт контракта по сайтам

Не PR этапа 4, но в его открытую версию (`docs/project-unite/plan.md` F7; архитектура §1.9, §7.12, §8.13, §12): окно
`client_health` — на пару (сайт, сборка), отчёт контракта разбирается по сайту, «Статус» — строка на сайт. Старые
фикстуры проходят без изменений, кроме двух мест, названных ниже (`STATUS_ROW_IDS`, тип выборки якорей в тесте).

- **`HostContractReport` — разбор по `host`.** `ChatSpaceContractReportSchema` — прежняя полная схема: каждый якорь
  `ANCHOR_IDS` назван (без одного или без всех — отказ), `host` необязателен и только `'chatspace'`; отчёт без
  `host` — отчёт ChatSpace (любой адаптер до 1.15.0), адаптер ChatSpace его не ставит. `SiteContractReportSchema` —
  отчёт другого сайта (`SITE_REPORT_HOSTS` = все виды, кроме ChatSpace): сборка, все общие возможности
  `HOST_CAPABILITIES` и обязательный блок своего сайта `extensions[<сайт>]` — и только он
  (`SiteContractBlockSchema`: состояние каждого своего якоря, ≤ 32, и своих возможностей сверх общих, ≤ 16; имена —
  машинные лексемы); ни якорей ChatSpace, ни профиля квитанции X8. `HostContractReportSchema` — объединение двух.
  Какие якоря обязан назвать блок, знает сайт, а не схема: читатели берут **ожидаемый** набор — `HostContractShape`
  (`anchors`, `switchedAnchors`, `switchedCapabilities`), и якорь, которого отчёт не назвал, у них `missing`
  (FS-CTR-1). Набор ChatSpace — `CHATSPACE_CONTRACT` (все `ANCHOR_IDS`; часть B — тап и профиль квитанции X8 —
  переключает владелец). Помощники `contractHostOf` (нет `host` — ChatSpace) и `contractAnchorsOf` (якоря ChatSpace
  сверху, другого сайта — в его блоке). Набор Fansly и строгая ветка его блока — P4b1.
- **Метрики HF-13** в `PERF_METRICS`: `frameParseMs`, `xhrParseMs`, `snapshotMs`, `snapshotRoundTripMs` — имена и
  границы реестра хаба `CLIENT_HEALTH_PERF_METRICS` (hub #577, `f8aa7209a`), `schemaVersion` 1; у каждой граница на
  своём бюджете (0,1 мс кадр, 2 мс ответ, 5 мс шаг снимка). Всего 15 при пределе отчёта 16. Вендоренный SDK этих
  четырёх ещё не знает (до перевендоринга P2v): тест сверяет их с числами хаба, остальные одиннадцать — с SDK.
- **`DiagnosticsSnapshot.tabs[].site?`** — сайт вкладки, как она зарегистрировалась (`tab.register`). Нет поля — фон
  до 1.15.0: ChatSpace.
- **«Статус»: `STATUS_ROW_IDS` — `host` вместо `chatspace`**, по строке на сайт в работе; `StatusRowVM.host?` называет
  сайт строки. Слова строки — набор `HostStatusTexts` сайта (заголовок, «не открыт», «проверяется», «подключён»,
  «проверен частично» с пояснениями); у ChatSpace — `CHATSPACE_STATUS_TEXTS`, прежние ключи. Новых ключей i18n нет.
  Это не добавочная правка модели вида, а замена значения: модель вида — договор ядра и UI одной сборки, наружу не
  уходит; DOM строки прежний (`data-pg-row` строки сайта — вид сайта, у ChatSpace — `chatspace`).
- Фикстуры: верные — отчёт с `host: 'chatspace'`, отчёт сайта с полным блоком и с неполным (схема якорей сайта не
  знает — неполнота читается как `missing`), гистограммы четырёх метрик HF-13, окно `client_health` сайта
  `fansly-web`, отчёт вкладки с отчётом сайта, вкладки диагностики с сайтом; неверные — ChatSpace без одного якоря и
  без всех (с `host` и без), форма ChatSpace под чужим именем, блок сайта в отчёте ChatSpace, отчёт сайта без блока,
  с чужим блоком или двумя, без `host`, с якорями ChatSpace или профилем X8, блок с не-лексемой, с 33 якорями или 17
  возможностями, метрика с чужими границами, вид сайта — платформа. Тесты: `packages/contracts/test/schemas.test.ts`,
  `packages/contracts/test/vocabulary.test.ts` («the host contract report by site», «client_health histograms»).

### P2v — SDK из выложенного хаба `bd3eec06`

`@kernel/sdk` перевендорен скриптом хаба `scripts/vendor-sdk.mjs` из `main` хаба `bd3eec06` (#607) — коммита, который
стоит в проде с 2026-10-14 00:55 UTC (прод отдаёт контракт `9137410d…`); был `6ee3d627` (`03012453…`). Это «SDK для
выпуска» (`docs/project-unite/plan.md` §0): коммит слит и выложен. Схемы, типы, сообщения, коды CG и ключи i18n
`@cg/contracts` не менялись, версия та же. Хоткеи не перевендорены: их пакет с `0a96105d` не менялся.

- **Что принёс SDK (всё добавочно, всё для Fansly; PR хаба R20 HF-2…HF-13 и `fan-notes-fill`):** в теле AI —
  `coverageCheck`, `startProof`, `personalMessageCount`, `fanAvatarUrl`, `noteFields`, `noteValues`, `messageCount` до
  5000; в кадре `context_v1` — `coverageCheck`, `live.matched`, `pair`; `conversationRef` в чтении рекапов, сохранении
  досье из генерации и ленте (и в `target` ответа ленты); ручная группа `{kind: 'manual', textFingerprint}` в теле брони
  и `limits.greetingSendPerMinute`; имена флагов (`drafts`, `voice`, `notesFill`, `notes`, `vault`, `registration`),
  возможностей (`manual-greeting-v1`, `coverage-check-v1`, `conversation-recaps-v1`, `hi-start-proof-v1`,
  `voice-notes-v1`) и причина `lane_off`; четыре метрики HF-13 в `CLIENT_HEALTH_PERF_METRICS`; операции войсов в узком
  токене; `fan-notes-fill` в `aiUsageFeatures`.
- **ChatSpace не меняется.** Ни одна операция, схема или поле, которые расширение вызывает или читает на ChatSpace, не
  поменяли формы; типы собрались без правок. Свои списки имён (`CLIENT_FEATURE_FLAG_NAMES`,
  `CLIENT_HUB_CAPABILITY_NAMES`, `CLIENT_FEATURE_UNAVAILABLE_REASONS`, `AI_STREAM_CAPABILITIES`) прежние — их расширяют
  P4b1–P4b4; заголовок `x-kernel-ai-capabilities` строится из нашего `AI_STREAM_CAPABILITIES` (три имени), поэтому
  `coverage-check-v1` и `hi-start-proof-v1` ChatSpace не объявляет. Правила обработчика хаба для тел ChatSpace те же
  (`packages/testing/src/fake-hub/ai-rules.ts`): новые отказы касаются только полей и функций Fansly и придут с
  поддельным хабом Fansly (P6c1, P6c2, P6c4). Столбец OnlyFans таблицы требований хаба (`HUB_FEATURE_CAPABILITIES`)
  тот же.
- **Тесты по настоящему SDK вместо переписанных чисел.** Тело брони Fansly (P4c) сверяется с настоящей схемой хаба
  `clientFanClaim` в `packages/testing/src/scenarios/hub/sdk-alignment.test.ts`: копия схемы HF-3 из
  `send-fansly.test.ts` убрана. Метрики HF-13 (F7): набор `PERF_METRICS` равен `CLIENT_HEALTH_PERF_METRICS` SDK, имя в
  имя, с границами и версией; числа хаба из `vocabulary.test.ts` и приём `client_health` в
  `packages/hub/test/ingest-and-guards.test.ts` больше не повторяются руками. Поддельный хаб с настоящей схемой тела
  отказывает `messageCount` 5001 (граница хаба теперь 5000; наш контракт по-прежнему держит 3000 до P4b2).
- **Байты.** Растёт только фон: ядро `background.js` 775 937 → 782 380 Б (+6 443 raw — схемы новых полей в
  `routeSchemas` SDK, по которым он проверяет ответы); **запас ядра до сигнального порога 800 КиБ — 36 820 Б** (после
  F7 был 43 263). `bg/chatspace.js` и остальные 45 файлов ChatSpace — байт в байт прежние (закрепы
  `tools/gates/chatspace-bytes.json` переписаны `pnpm gates:bytes` только в строке `background.js`).
- **Реестр замороженных SDK хаба.** Строки расширения в `client-sdk-registry.ts` нет ни для прежнего SDK, ни для нового.
  Прежний хеш `03012453…` хаб держит в `compatibleClientSdks` только потому, что из того же `6ee3d627` вендорен SDK
  Fansly-расширения 2.8.1 и 2.9.0 (тот же `dist`, но zod 4.4.3, у нас 4.6.5 — другой бандл); новый `9137410d…` прод
  отдаёт как свой. Записать SDK расширения можно только вместе с полосой расширения в наборе совместимости хаба
  (`tests/helpers/client-sdk-compat.ts`: «chat-extension has no lane on purpose… Register its SDK only together with
  that lane») — это отдельный PR хаба.

### F5 — профиль сайта для интерфейса

Не PR этапа 4, но в его открытую версию (`docs/project-unite/architecture.md` §1.3, §1.5): панель на сайтах может
выглядеть немного по-разному (просьба владельца), поэтому общие поверхности берут палитру, вариант дока, его лист и
фразы из профиля сайта, а не из констант ChatSpace.

- **Модуль `vm/host-profile`** (новый, в `vm`): `HostUiProfile` — `palette?: ValueSignal<HostPalette>` (тройки
  `--color-om-*`, которые читают токены kit; нет поля — переменные страницы доходят до наших хостов наследованием, так
  у ChatSpace), `dock: {variant}`, `sheet?: HostSheet` (`{id, css}` — правила варианта, после листов поверхности),
  `phrases` — целые фразы с именем сайта на каждом языке (`HostPhrases`: `site`, `onSite`; их читают общие тексты с
  F9b). Словарь `DOCK_VARIANTS` (`chatspace`, `fansly`) и атрибут `DOCK_VARIANT_ATTRIBUTE` = `data-dock-variant`
  (нейтральное имя, X22: его видит страница). Схем нет: профиль — данные половины адаптера, границу как `unknown`
  не пересекает.
- **`MountDeps.profile?`** — профиль, с которым монтируется поверхность. Нет поля — страница расширения или тест:
  на хост ничего от сайта не ставится. Монтирование kit ставит `data-dock-variant` на хост рядом с `data-scheme`,
  принимает палитру правилом `:host` одного общего листа (`cg-host-palette`) и держит её живой, лист варианта — после
  листов поверхности; всё уходит с последней поверхностью корня.
- Клиент схемы клавиш (`extension` / `fansly`) — не в профиле: его читает ранний диспетчер, это поле ранней половины
  адаптера (`HostAdapter.hotkeyClient`, приложение, не контракты).
- Фикстуры: `test/fixtures/host-profile.ts` — ChatSpace, второй сайт с палитрой и листом, пустая палитра; неверные
  (отвергает компилятор) — чужие имена в палитре, вариант вне списка, нет варианта, фразы не на всех языках, имя без
  фразы, лист строкой, клиент клавиш в профиле. Тесты: `packages/contracts/test/host-profile.test.ts`,
  `packages/testing/src/kit/profile.test.tsx` (монтирование), `apps/extension/test/feature-slices.test.ts` (профиль
  второго сайта не меняет ни байта ChatSpace).

### F6b — чтения по разговору

Не PR этапа 4, но в его открытую версию: чтения хаба по разговору ключуются по таблице
`docs/project-unite/architecture.md` §11.1 (HF-10 хаба, выложен в `bd3eec06`, SDK — P2v). Рекап и лента — разговор и
фан; карточка, досье, бронь и опека — только фан.

- **Возможность `conversation-recaps-v1`** в `CLIENT_HUB_CAPABILITY_NAMES` (на проводе — открытая лексема, как
  остальные). Хаб с ней принимает `conversationRef` в трёх местах; без неё — 400 на незнакомый ключ, поэтому слой хаба
  шлёт поле только такому хабу, а без возможности чтение разговора, который не фан, отказывается у себя
  (`CG-HUB-CAPABILITY`, запроса нет).
- **Запросы к хабу:** `SharedRecapsQuery.conversationRef?`, `FeedQuery.conversationRef?`,
  `ProfileFromGenerationRequest.conversationRef?` — разговор, когда это не фан (на Fansly — `groupId`); повторяют схемы
  SDK (`clientConversationRefSchema` — тот же `^[1-9]\d{0,29}$`). Ответ ленты: `FeedPage.target.conversationRef?` —
  хаб повторяет разговор запроса, нет поля — запрос его не называл. `DossierQuery` прежний (только фан).
- **`CHAT_IS_FAN`** (`ids`): чат платформы — это её фан (OnlyFans: id чата = id фана) или у чата свой id (Fansly:
  группа); та же таблица у хаба — `clientConversationsHaveOwnIds`. Фасад читает по ней досье: где чат — фан, как
  прежде (`pageConversationProfile`), где нет — по фану (`pageFanProfile`): id фана там не называет разговора.
- **Протокол вкладки:** `recap.status`, `recap.read`, `recap.save`, `feed.read` — `conversationRef?`, разговор фана,
  когда это не сам фан. Нет поля — разговор = фан, как у ChatSpace до 1.15.0; ChatSpace его не ставит. `fan.card`,
  `fan.dossier` и `newcomers.claim` — только фан (поле им — отказ схемы).
- Фикстуры: верные — группа Fansly отдельно от фана в каждом из семи мест (`FANSLY_IDS`), неверные — разговор не id
  (пустая строка, число, буквы, `'0'`), разговор у карточки и досье. Тесты: `packages/contracts/test/schemas.test.ts`,
  `packages/contracts/test/protocols.test.ts`, `packages/contracts/test/vocabulary.test.ts` («R20 F6b»).

### P4b2 — глубина до 5000

- **Провод:** `AI_REQUEST_LIMITS.messageCountMax` = 5000, как у выложенного HF-6 (SDK P2v). Этот предел читают
  `StartOp.window`, `StartOp.coach.autoRecap.window`, `UserOptions.window` и `AiFeatureStreamBody.messageCount`.
  Недопустимые проводные фикстуры 3001 заменены на 5001, добавлены допустимые 3001 и 5000; границы проверены
  настоящей схемой тела SDK. Настройки v1 и их недопустимая фикстура `deep: 3001` не меняются.
- **Хранение:** существующие схема и владелец `settings.ext` (P4a3) хранят пожелание `windows.deep` 3001…5000;
  `null` убирает его и возвращает глубину v1. Верхняя граница схемы теперь берётся из предела провода.
- **Допуск:** `planStart.extendedWindows?` принимает окно из `settings.ext`; глубокие функции и полный авто-рекап
  Coach выбирают это пожелание, иначе v1. Разовый `options.window` имеет приоритет. Планировщик ограничивает окно
  по bootstrap, фон повторно ограничивает тело по своему актуальному `limits.deepMax`. Сохранённое пожелание не
  меняется при снижении лимита. Новых импортов схемы сайта в общий runtime нет: `SettingsExt` импортирован типом.
- **Проверки:** при `deepMax` 1500/3000 запросы с пожеланиями 3001/5000 доходят до фасада с 1500/3000, при 5000 —
  с исходным пожеланием; также при устаревшем bootstrap вкладки. Тесты используют настоящий планировщик и scheduler
  с обоими срезами сайта, включая ChatSpace при его текущем лимите 3000. Короткий Recap и быстрые окна прежние.
- Это граница контрактов и ядра: передача `settings.ext` из приложения Fansly и интерфейс выбора глубины —
  P8c/P14b1. Существующие вызовы без `extendedWindows` сохраняют прежние окна.

### P4b1 — свежесть и запрос

Проверка окна Fansly (спецификация §3, FS-TAIL-*, FS-NEW-7; архитектура §5.8, §7.7, §7.12, §9.1, §12; хаб HF-8в —
`731a4cb2`, выложен в `bd3eec06`, из которого вендорен SDK). Запрос ChatSpace не меняется: его старт доказательства не
несёт, поле `coverageCheck` и возможность `coverage-check-v1` он не шлёт, хотя хаб её объявляет (тест в
`sdk-alignment.test.ts` перебирает все запросы всех фич ChatSpace).

- **`StartOp.proof?: CoverageProof`** (`ops`) — чем генерация доказывает свежесть на сайте, чья вкладка сама наблюдает
  чаты. Общая форма без имени сайта, объединение по `kind`: `tab-snapshot` — снимок вкладки по клику (на Fansly его даёт
  `FanslySnapshot` MAIN, переводит политика AI сайта) с хвостом текста внутри (`tail`, только Reply, Fix, Hi, Ping —
  D-14) и `truncated`; `pass` — доказательство прохода «Новых» (Б17), без текста. У обоих — разговор цели
  (`conversationRef`: на Fansly `groupId`), полнота (`complete` | `unknown`), момент снимка (`takenAt`, он же
  `capturedAt` хвоста), окно проверки ≤ 60 (`CoverageWindowSchema`: id и сторона), известные id фана ≤ 10 (новые
  первыми, как берёт тело хаба) и удалённые ≤ 60 (`CoverageDeletedIdsSchema`). Проверка доказательства: каждый id
  один раз на оба списка (`coverageIdsOnce`, правило хаба), известные id — сообщения фана из окна, хвост — сообщения
  окна той же стороны, `truncated` — только у хвоста. Проверка старта (`proofFits`): доказательство — разговора цели, не
  рядом с `fresh` (хвост ChatSpace) и `checkpoint` (X8), текст — только у функции черновика, проход — только в
  «Новых». `checkpoint` не тронут.
- **`ServedContext.coverageCheck?`** — ответы хаба на проверку окна, каждый список в порядке хаба, состояние сужено своим
  списком (`COVERAGE_WINDOW_STATES`, `COVERAGE_DELETED_STATES`; незнакомое — `null`). Чтение ответа —
  **по таблице, общей с хабом**: `COVERAGE_CHECK_CLASSES` = `classes` матрицы хаба
  `tests/fixtures/ai-coverage-check-matrix.json`; копия матрицы байт в байт — фикстура
  `test/fixtures/ai-coverage-check-matrix.json` (sha256 закреплён тестом). `narrowCoverageCheck` — кадр → `ServedContext`
  (ответ, где назван не id, не отвечает ни на один наш id: проверка читается как неотвеченная), `coverageCheckVerdict` —
  часть вердикта, которую даёт сама проверка: `unverified` (нет ответа; id без ответа или с двумя; ответ на неспрошенный
  id; любое `unverified`) → `miss` → `stale` → `fresh`. Каждый случай матрицы (`hubCases` и `clientCases`) читается к её
  `coverageVerdict`; полный вердикт §3.5 (снимок, полнота, `live`) строит P8b2 вокруг этой части.
- **Причины `stale`** (`STALE_REASONS`, `StaleReason`; `ResultVM.stale` берёт тот же тип): к `fan-wrote` и
  `archive-moved` — `unverified` («свежесть не проверена»), `window-miss` («Ответ мог не учесть последние сообщения»),
  `deleted-served` (контекст устарел). Пометку над результатом рисует P8b2.
- **Тело и кадр хаба** (`hub/ai`): `AiFeatureStreamBody.coverageCheck?` (`CoverageCheckBodySchema`: окно и `deletedIds`,
  строго, повтор id — отказ, как у хаба); `HubStreamRequestSchema` пускает поле только с заголовками `coverage-check-v1`
  и `context-v1`; кадр `context_v1` несёт `coverageCheck` (открытые лексемы, ≤ 60 на список). Возможность
  `coverage-check-v1` — в `CLIENT_HUB_CAPABILITY_NAMES` и `AI_STREAM_CAPABILITIES` (порядок SDK). Пределы —
  `COVERAGE_CHECK_LIMITS` (`limits`, 60 и 60 — числа SDK).
- **`RequestIdentity.proofDigest?`** (`core/src/domain/ops/identity.ts`, `proofDigestOf`): отпечаток доказательства без
  `takenAt` — тот же снимок позже тот же запрос, другое окно, удаление, полнота или хвост — другой; текст хвоста в ключ не
  попадает, только в отпечаток. Без доказательства поля нет: ключ ChatSpace байт в байт прежний (записанный ключ `main`).
  `RequestIdentity.conversationRef` — с F6a.
- **`HostPort.freshness?`, `HostPort.fansly?`** (`host`): порт снимка `FreshnessPort<S>` —
  `snapshot(chat, {conversationRef, feature, window, withText})`, форма снимка — сайта; член `fansly` в общем модуле —
  `unknown`: общий модуль типов сайта не называет (граф считает и импорт типов). Типы даёт **новый модуль сайта
  `fansly-host`** (только подпуть): `FanslyHostPort` (`freshness` → `FanslySnapshot`, `fansly` → `FanslyPagePort`).
- **`ChatWindow.fanScript?`, `newestAt?`** — у типа, не у схемы: `ChatWindowSchema` — ответ MAIN ChatSpace, он прежний
  (байты `bridge-validation` закреплены); окно Fansly проверяет своя схема `fx.chat`. Слово `FanScript` теперь в `host`;
  `core` (`fanScriptOf`) и `FANSLY_FAN_SCRIPTS` берут его оттуда.
- **Ветка `fansly-web` отчёта контракта** (`fansly-host`): `FANSLY_CONTRACT` — ожидаемый набор (все 17 якорей; без
  поломки не `on` — якорь `vaultUpload` и общие `previewSend`, `receipt`, `chatList`, которых у Fansly нет) и строгая
  ветка блока `FanslyContractBlockSchema` / `FanslyContractReportSchema`: блок называет каждый якорь и каждую свою
  возможность. Общая схема `HostContractReportSchema` не менялась и принимает всё, что принимает строгая ветка.
- Фикстуры: окно, удалённые, доказательство (верные: снимок, без хвоста, усечённый, `unknown`, пустой чат, проход;
  неверные: повтор id, id не из окна, модель вместо фана, хвост чужой стороны, `truncated` без хвоста, текст у прохода,
  61 id), старт (Fansly с доказательством, Recap без текста, проход в «Новых», превью; неверные — с `fresh`, с
  `checkpoint`, чужая группа, текст у Recap, проход в доке), ответы проверки, тело (матрица `invalidRequests`), запрос
  (без одного из двух заголовков), кадр, `op.start` и `op.done` реестра вкладки, отчёт Fansly. Тесты:
  `packages/contracts/test/coverage-check.test.ts` (матрица хаба целиком), `fansly.test.ts`, `schemas.test.ts`,
  `protocols.test.ts`, `packages/core/test/domain-ops.test.ts`, `packages/testing/src/scenarios/hub/sdk-alignment.test.ts`
  (тело, лексемы, пределы и имена возможностей — против настоящего SDK).
- Байты (сборка выпуска `main` `a4622c5` и ветки одна за другой): `StartOp.proof`, `ServedContext.coverageCheck` и
  причины `stale` — в общих схемах, их несут слой `tab-protocol` (+561 Б gzip, чанк +1 923 Б raw), проба реестра
  запросов вкладки (+555: 28 342 из 28 672, запас 330 Б; ≈ 94 Б из них — тело и кадр `hub/ai.ts`, которые настоящий чанк
  не несёт) и ядро фона (+2 348 Б raw, запас 33 523 Б). `ai` +61, `boards-preview` +23, `tab-health` +6, `ai-coach` +4,
  `tab-app` −24 — новые хеши в именах импортируемых чанков (`ai` +1 Б raw); `bridge-validation` +32 (пределы). Модуль
  `fansly-host`, `coverageCheckVerdict` и таблица классов в бандлы ChatSpace не попадают (не используются,
  выбрасываются). Вид доказательства прохода — `pass`, не `host-pass`: это слово источника фичи в манифесте Fansly, и
  тест `feature-slices` держит его вне чанков ChatSpace. Закрепы `tools/gates/chatspace-bytes.json` переписаны: 22
  файла, все дельты — в описании PR.

### P4b4 — доказательство начала для Hi

Архитектура R20 §5.8, §11.2, §12; схема HF-5 из выложенного хаба `bd3eec065` (P2v).

- `StartOp`, поля политики сайта `AiStartFields` (F10) и `AiFeatureStreamBody` получают необязательные `startProof: StartProofV1`,
  `personalMessageCount` и `fanAvatarUrl` (FX-018). Только Hi на Fansly; доказательство относится к разговору
  цели/тела, отдельный счёт при доказательстве равен `personalCount`. Без доказательства нулевой счёт не создаётся;
  порог 10 и противоречия истории решает хаб, схема принимает и доказанные 11.
- `hi-start-proof-v1` — известная возможность bootstrap и заголовка AI. `HubStreamRequest` отказывает каждому
  новому полю без неё, на другой платформе или функции. `clientContext` по-прежнему не входит в тело этого клиента.
  ChatSpace не шлёт новые поля и capability — это проверено на запросах, построенных его драйверами.
- Аватар: та же схема, что у хаба в `clientContext.fanAvatarUrl` (`^https://[a-z0-9-]+\.fansly\.com/`, ≤ 4096).
  До провайдера идёт как изображение; хаб её никогда не скачивает. Правило URL не расширено.
- Схемы доказательства и аватара вынесены в `hi-start-proof.ts`: общие `ops.ts` и `hub/ai.ts` не могут импортировать
  весь модуль сайта. `fansly.ts` сохраняет API P4a2; пределы и правила не изменились. Корень эти схемы не экспортирует.
- `test/fixtures/ai-hi-start-proof-matrix.json` — копия HF-5 байт в байт, sha256
  `7ec4b90b91f696018de72193d8325662030e55e4a2661cabc90945f5203383b2` закреплён в тесте. 21 доказательство проверено
  нашей схемой и схемой SDK; 15 форм запроса — нашим контрактом. Правила серверного gate остаются за P6c2.
  Тест предела тела учитывает все поля клиентского тела, в том числе 120 автоматических id, счёт и аватар длиной
  4096; худший случай JSON — 6 байт на кодовую единицу, предел хаба — 12 МиБ.
- Проба реестра запросов вкладки использует предел 30 КиБ, поднятый в P4b3 для общих схем. P4b4 предел
  не поднимает; изменившиеся байты ChatSpace закреплены заново.

### F9b — фразы сайта вместо имён в общих текстах; переключатели в манифесте

Финальные гейты этапа F (`docs/project-unite/architecture.md` §1.5, §1.8, §3.4). Общие тексты больше не называют
сайт — их имена стали фразами профиля, и контрактам нужно сказать, какими.

- **`HostPhrases`** (`vm/host-profile`) — ещё две фразы: `siteAccount` (как зовут аккаунт сайта: «OnlyMonster 1001»,
  «аккаунт OnlyMonster»; у Fansly — «Fansly») и `sitePlatform` (платформа страниц сайта: «OnlyFans»; у Fansly —
  «Fansly»). Имена полей — плейсхолдеры общих текстов: `{site}`, `{onSite}`, `{siteAccount}`, `{sitePlatform}`; список —
  `HOST_PHRASE_NAMES`. Другой параметр текста таких имён не носит. Тексты каталогов `ru` и `en` (71 и 71) сказали
  «ChatSpace», «в ChatSpace», «OnlyMonster», «OnlyFans» словами — теперь говорят плейсхолдерами; ключи те же, состав
  ключей тот же, у текстов кодов CG по-прежнему нет параметров провода (фраза — не параметр). Порт I18n ставит фразы
  сайта, от имени которого говорит; с фразами ChatSpace каждый текст — слово в слово прежний.
- **`PageTagVM.platformName?`** (`vm/pages`) — платформа страницы хаба так, как её называют люди: фраза `sitePlatform`
  сайта, который её обслуживает. Нет поля — ни один сайт её не называет: печатается токен, как раньше любой незнакомый.
  `platform` по-прежнему токен хаба (`data-pg-platform`).
- **`FeatureOnHost.switches?`** (`features/types`) — переключатели владельца, которые меняют фичу на сайте, но не
  допускают её: Split у Reply (`splitAll`), статистика Spenders (`stats`), лента архива превью, панели фана и Coach
  (`preview`), тап WS у звука и отправки из превью (`wsTap`), пометка AI отправки из превью
  (`previewSendMarkAiGenerated`). `admission` их не читает; вместе с требованиями они называют каждый флаг хаба —
  полнота манифеста. Срез ChatSpace их получил; Fansly — с PR своих фич.
- Метка устройства при входе (`DeviceTokenIssueRequest.label`, свободный текст) — «Firefox · ОС · ChatGoose» вместо
  «… · ChatSpace»: расширение одно на оба сайта. Хаб метку не разбирает.

Фикстуры: `test/fixtures/host-profile.ts` (фразы на обоих языках со всеми четырьмя полями; без новых двух — отказ
компилятора), `test/fixtures/vm.ts` (`PAGE_TAG_SAMPLES`: тег с именем платформы; имя не набор языков). Тесты:
`host-profile.test.ts`, `vm.test.ts`, `features.test.ts` (переключатель — известный флаг, один раз, не требование той же
записи).

### F10 — порты политики AI

После ревью P8b1: `AiProofAsk.messageCount?: number` — итоговый счёт старта после `UserOptions.window`, настроек
и предела хаба; его считает тот же `windowFor`, что строит `StartOp`. Добавочное поле: старые вызывающие остаются
валидными, политика Fansly без счёта не строит доказательство. Фикстуры `test/fixtures/ai-policy.ts` покрывают старую
форму, числовой счёт и неверный строковый; `test/ai-policy.test.ts` проверяет необязательность поля. Wire-схемы не меняются.

Не PR этапа 4, но в его открытую версию (`docs/project-unite/architecture.md` §1.6 «Политика AI», §9.1): что в старте
генерации и в её результате решает сайт, общий контроллер AI спрашивает у политики сайта и сайта не называет. Только
типы: ни одна схема в бандлы не идёт.

- **`ops`: `AiHostPolicy<P, F>`** — пять портов: `preflight(feature, window, proof)` — причина сайта
  `AiGateReason`: причина словаря `UnavailableReasonId`, у которой есть код CG (старт отказывает с этим кодом); после
  общих правил; без доказательства — вид и первая проверка старта, с доказательством — до токена;
  `proof(host, ask)` — доказательство открытого чата из памяти страницы (`Promise` или `null` — собирать нечего); `fields(proof)` — поля старта от сайта; `fingerprint(proof)` — что вкладка хранит от доказательства при
  операции (никогда не текст); `verdict(view, fingerprint)` — готовая модель пометки. `P` и `F` общему контроллеру
  непрозрачны: он только возвращает их политике.
- **`ops`: `AiProofAsk`** (`feature`, `surface`, `identity` открытого чата, `fresh` — пределы свежего текста D-14 или
  `null`) и **`AiStartFields`** (`fresh?` — хвост ChatSpace; `proof?` — `CoverageProof` из P4b1, в который политика Fansly превращает свой снимок, P8b1). Общий план
  обрезает `fresh` по D-14, остальное кладёт в старт как есть, и его проверяет `StartOpSchema`: поле, которого схема не
  знает, — отказ старта, до фона оно не доходит.
- **`ops`: `ResultMarkVM`** — готовая модель пометки над частями результата (`reason` — `StaleReason` из P4b1, `at`);
  `ResultVM.stale` (`vm`) теперь этого типа, форма та же. Её даёт вердикт политики, общий `Result` только рисует; у
  ChatSpace это пометка фона «фан написал новое», пометки проверки окна (таблица §3.5 спецификации) рисует P8b2. Тип
  лежит в `ops`, рядом с `OpView.stale`: модели видов импортируют `ops`, обратный импорт замкнул бы круг (`no-circular`).
- Фикстуры: `test/fixtures/ai-policy.ts` — форма ChatSpace, второй сайт со своим доказательством и отпечатком, сайт без
  доказательства; неверные (отвергает компилятор) — причина вне словаря, причина без кода, доказательство без
  `Promise`, чужое поле старта, `fresh` строкой, пометка вне списка, политика без вердикта. Тесты: `packages/contracts/test/ai-policy.test.ts`,
  `packages/core/test/application-ai-policy.test.ts` (правила ChatSpace против замороженной копии `main`, порты через
  общий контроллер, политика второго сайта), `apps/extension/test/feature-slices.test.ts` (политика второго сайта не
  меняет ни байта ChatSpace).

### P4b3 — операции сайта и флаги

Операции среза Fansly и его флаги (`docs/project-unite/architecture.md` §1.4, §1.6, §8.8, §8.9, §11.1, §12; хаб HF-2,
HF-3, HF-4а, HF-4б, HF-12 и `fan-notes-fill` — все выложены в `bd3eec06`, из которого вендорен SDK). Запросы, флаги и
допуски ChatSpace не меняются: таблица флагов ChatSpace на нынешнем хабе та же (`flag-table.test.ts` держит свои
шестнадцать флагов, как до F4).

- **Флаги Fansly — в общем словаре.** `CLIENT_FEATURE_FLAG_NAMES` += `drafts`, `voice`, `notesFill`, `notes`, `vault`,
  `registration` (порядок SDK). Где флаг есть, решает хаб (HF-2): на странице OnlyFans эти шесть читаются
  `platform_unsupported`, строку `"*"` страница Fansly не наследует. `FANSLY_FLAGS_AHEAD` (F4) убран, файл манифеста Fansly
  называет флаги из общего словаря; файл ChatSpace их назвать не может — его флаги `ChatSpaceFeatureFlag`, общий
  словарь без этих шести (проверяет компилятор, фикстура F4 та же).
- **Возможности** `manual-greeting-v1` (ручная группа приветствия, HF-3) и `voice-notes-v1` (маршруты войсов для узкого
  токена, HF-4б) — в `CLIENT_HUB_CAPABILITY_NAMES`; это возможности bootstrap, не заголовка AI (`AI_STREAM_CAPABILITIES`
  прежний). `CLIENT_FLAG_REQUIREMENTS` прежний (`{freshText: ['context-v1']}`): что хаб требует их для `newcomers` и
  `voice` на Fansly, уже в функции страницы; маршрут войса назовёт `voice` и `voice-notes-v1` в `HUB_ROUTES`, когда его
  вызовет слой хаба, а ручная группа спросит `manual-greeting-v1` нуждой своего запроса.
- **Причина `lane_off`** — в `CLIENT_FEATURE_UNAVAILABLE_REASONS`. Её говорит только bootstrap, последней: линия хаба, на
  которой живёт функция (войсы: выключатель, синтез, список страниц, голосовой профиль), страницу сейчас не обслуживает.
  В `core/src/domain/ops/flags.ts` она стоит после `hub_not_ready` (`REASON_RANK`): «войсы этой страницы выключены на
  линии» сообщает больше, чем «хаб не готов» на другой. Отказ по ней пока читается «выключено»
  (`CG-FEATURE-DISABLED`, слово хаба — в технической строке); свои слова и 🎙 только при usable `voice` — PR панели войсов.
- **Главный выключатель читается снова** (`core/src/domain/ops/flags.ts`, `pageBlanketReason`). Хаб с HF-2 (прод
  `bd3eec06`) перечисляет на странице все флаги своего словаря и отвечает по флагу чужой платформы
  `platform_unsupported` раньше главного выключателя: на странице OnlyFans шесть флагов Fansly — не `disabled`, и
  клиент переставал видеть выключенный главный выключатель (`pageSwitchedOff`: строка «ChatGoose выключен владельцем»
  в доке, отказ старта до запроса, отказ слоя хаба до потока) — оставался 409 хаба после клика. Общий ответ страницы
  теперь читается только по функциям, которые есть на её платформе. Нашёл это поддельный хаб, который теперь
  отвечает как хаб после HF-2 (ниже).
- **Операции среза Fansly** (`SiteOpId` = `voice-script` | `notes-fill`, `OpFeature` = `FeatureId | SiteOpId` в
  `features`; `SiteStartOp`, `SiteOpResult`, `AnyStartOp`, `AnyOpResult` в `ops`) — объединение только типами: общие
  `FEATURE_IDS`, `HUB_FEATURE_MAP`, `StartOpSchema`, `OpViewSchema`, `OpResultSchema` прежние и операцию сайта не
  принимают, бандл ChatSpace её не несёт. Рантайм — **новый модуль сайта `ops-fansly`** (только подпуть): `FANSLY_OPS`;
  старт скрипта войса (`VoiceScriptStartSchema`: цель Fansly, действие человека, непустой черновик, тон пресета или
  `null`, окно, `regenerateOf?`, `force?`) и «Заполнить из чата» (`NotesFillStartSchema`: только метки анкеты —
  значения заметок вкладку не покидают, FS-NOTE-5, FX-015); результат (`voice-script` — непустой текст ≤ 5000, как
  берёт `fansly.voice.create`; `note-fields` — каждая спрошенная метка один раз со значением в одну строку ≤ 2000 или
  `''`); данные драйвера `FANSLY_OP_DRIVERS` — функция хаба (`voice-script`, `fan-notes-fill`), запись манифеста,
  чей `generate` допускает операцию (`voice`, `notes-fill`: флаги страницы `voice`, `notesFill`), тип результата и
  тайм-ауты §7 (скрипт — как черновик, заполнение — как полный Recap). Схемы модуля дают ровно типы `ops` (тест
  проверяет в обе стороны). Сборка запроса и разбор ответа — код драйвера (P12a, P11c), не данные.
- **Хаб, тело и запрос потока** (`hub/ai`): `HUB_AI_FEATURES` += `voice-script`, `fan-notes-fill`; `HUB_FEATURE_MAP`
  прежний (это карта общих фич). Тело — `noteFields` (`NoteFieldsSchema`, `NoteFieldLabelSchema`, пределы
  `NOTE_FILL_LIMITS` в `limits` — числа SDK): 1–30 меток, ≤ 60 символов, без перевода строки, `:`, `<`, `>`, `&`, без
  повтора без учёта регистра; уходят обрезанными (хаб обрезает сам, поэтому метка с пробелом по краю у нас — отказ);
  `noteValues` (режим слияния хаба) в теле нет. `HUB_FEATURE_ONLY_FIELDS`: `replyTone` и `draftText` — ещё и у
  `voice-script`, `noteFields` — только у `fan-notes-fill`; свежий текст — по-прежнему только у четырёх черновиков.
  `HubStreamRequestSchema` повторяет правила обработчика хаба для двух функций: только страница Fansly и с фаном
  (`fanRef`), у скрипта — непустой черновик (`gate_draft_required`), у заполнения — метки.
- **Поддельный хаб:** столбец OnlyFans его таблицы (`HUB_FEATURE_CAPABILITIES`) стал частичным, как у хаба после HF-2:
  флаг, которого в столбце нет, на странице OnlyFans не существует — `platform_unsupported` раньше главного
  выключателя (`existsOnOnlyFans`, `featureVerdict`, пресеты сценариев). Столбец Fansly, тела и правила обработчика для
  двух функций — P6c1 и P6c4; тесты потока поддельного хаба перебирают функции общих фич.
- Фикстуры (`test/fixtures/ops-fansly.ts`): метки анкеты (верные — до 30 меток по 60 символов, любые знаки кроме
  пяти; неверные — пусто, 31, 61 символ, повтор без учёта регистра, `:`, перевод строки, U+2028, `<`, `&`, пробел по
  краю, пустая и пробельная метка), старты (верные — скрипт с тоном и без, повтор, заполнение; неверные — цель
  ChatSpace, без черновика и с пустым, чужой тон, пустые и негодные метки, значения заметок, чужие поля, окно вне
  границ, общая фича, поле общего старта), результаты, тела и запросы (неверные — страница OnlyFans, без фана, без
  черновика и с пробельным, без меток, метки у Reply, `noteValues`, тон и черновик у заполнения, свежий текст и
  варианты у скрипта); `HubAiFeature`, `NoteFieldLabel`, `NoteFields`, `AiFeatureStreamBody`, `HubStreamRequest` в
  `HUB_SCHEMA_FIXTURES`. Тесты: `packages/contracts/test/ops-fansly.test.ts`, `features.test.ts`, `hub.test.ts`,
  `schemas.test.ts`, `packages/core/test/domain-admission-fansly.test.ts` (`lane_off`: допуск 🎙, ранг, отказ),
  `packages/hub/test/stream.test.ts` (эхо промпта операции сайта), `packages/testing/src/fake-hub/{flag-table,config,
  ai}.test.ts`, `packages/testing/src/scenarios/hub/scenarios.test.ts`, `sdk-alignment-fansly.test.ts` (словари флагов и
  причин равны SDK, функции хаба — его `aiUsageFeatures`, пределы меток — его, метки и тела двух функций — по его схеме
  тела).
- Байты: модуль `ops-fansly` и данные драйвера в бандлы ChatSpace не попадают. Растут общие схемы: словарь хаба
  (`voice-script`, `fan-notes-fill`), `noteFields` и правила зеркала запроса — в ядре фона (`background.js` +1 010 Б raw)
  и в чанке `tab-protocol` вкладки ChatSpace (+742 Б raw), `bridge-validation` +56 Б, `tab-app` +45 Б (прочтение
  главного выключателя); у остальных чанков ChatSpace сменились только хеши в именах импортов. Проба реестра запросов
  вкладки: предел поднят с 28 до 30 КиБ (30 720 Б), чтобы вместить расширенные общие схемы операций. Закрепы `tools/gates/chatspace-bytes.json` переписаны
  `pnpm gates:bytes`. Тест `feature-slices` считает метку Fansly целой строкой бандла, как гейт меток: функция хаба
  `fan-notes-fill` — слово общего словаря хаба, а не запись манифеста `notes-fill`.
- Слой хаба: эхо промпта режима отладки (`featureOfHub`, `PromptEchoStore`) знает две функции хаба операций сайта
  (`voice-script` → `voice-script`, `fan-notes-fill` → `notes-fill`); вид снимка (`PromptSnapshotView.feature`)
  называет только общие фичи, у операции сайта — `null`.

### P7a — счёт MAIN Fansly: `fx.health`

Не PR этапа 4, но в его открытую версию (`docs/project-unite/architecture.md` §5.3, §5.4, §6, §8.13). MAIN Fansly
считает кадры сокета и ответы страницы и меряет свой разбор (`frameParseMs`, `xhrParseMs` — HF-13), но провода, по
которому это выходит из MAIN, контракт не давал: ни `fx.state`, ни пачка счёта не несут. Добавлен седьмой запрос.

- **`fx.health`** (`TO_MAIN_FANSLY_TYPES`, `TO_MAIN_FANSLY`): тело пустое, ответ `FanslyHealthSchema` — что MAIN насчитал
  с начала документа, по запросу, без таймеров: `frames {seen, parsed, lost}` — текстовые кадры сокетов страницы,
  разобранные (известный `t`) и прочитанные не целиком (SN-020 «увидено, но не разобрано», FS-WS-2, FS-WS-5);
  `responses {seen, parsed, deferred, lost}` — ответы API на `loadend`; `stream {batches, unacked, queued, heldBytes,
  gaps}` — поток под кредитами (`unacked` ≤ `maxUnackedBatches`); `perf {frameParseMs, xhrParseMs}` —
  `FanslyPerfCountsSchema`: счёт по корзинам границ метрики из `PERF_METRICS` (на одну больше границ), всего, сумма,
  максимум; с именем и границами это `PerfHistogram` для `client_health`. Не запись, обычный тайм-аут.
- Фикстуры: `test/fixtures/fansly.ts` — `fanslyHealth` и пустой счёт на `document_start`; неверные — неподтверждённых
  больше кредитов, итог не равен сумме корзин, третья метрика, отрицательный счёт. Тесты: `packages/contracts/test/fansly.test.ts`
  (корзин на одну больше границ обеих метрик; с именем и границами — верный `PerfHistogram`).

### P7b — шаг снимка MAIN Fansly в `fx.health`

Не PR этапа 4, но в его открытую версию (`docs/project-unite/architecture.md` §5.8, §8.13; бюджет `plan.md` §4:
«снимок генерации — шаг MAIN ≤ 5 мс», метрика `snapshotMs`, владельцы P7b и P8b1). Шаг снимка — ограниченный слив
очереди отложенного разбора и сам снимок — может померить только MAIN, а провода для этого числа контракт не давал:
фикстура P7a нарочно отвергала третью метрику («снимок меряют в другом месте»), но другого места нет — изолированный
мир видит только круговой путь (`snapshotRoundTripMs`, P8b1).

- **`FanslyHealthSchema.perf.snapshotMs`** — `FanslyPerfCountsSchema` по 14 границам `PERF_METRICS.snapshotMs`
  (15 корзин), как две метрики разбора: счёт по корзинам, всего, сумма, максимум; с именем и границами — `PerfHistogram`
  для `client_health`. Поле обязательное: MAIN и изолированный мир выходят одной сборкой, ответ без него — ответ
  старого MAIN, которого в выпуске нет.
- Фикстуры (`test/fixtures/fansly.ts`): у `fanslyHealth` и пустого счёта на `document_start` — `snapshotMs`; неверные
  — без `snapshotMs` и с чужой метрикой (`snapshotRoundTripMs` — изолированного мира, не MAIN) вместо прежней «третьей
  метрики». Тест `packages/contracts/test/fansly.test.ts`: корзин на одну больше границ у всех трёх метрик, ключи
  `perf` — ровно три.
- Байты: модуль сайта, в бандлы ChatSpace не попадает.

### P13a — открытый альбом vault: `fx.vaultLoaded`

Не PR этапа 4, но в его открытую версию (`docs/project-unite/architecture.md` §5.4, §6, §7.11, §7.19). Контрольная
точка загрузки (`VaultCheckpointSchema`, P4a3) записана на аккаунт и **id** альбома, а подтверждение файла — это
`fx.vaultAdded` и перезагрузка альбома с этим id. Но id открытого альбома страница не показывает нигде: ни в адресе
(`/creator/vault` один на все альбомы), ни в DOM (выбор альбома — состояние компонента). Его называет только адрес
запроса, которым страница грузит альбом: `GET /media/vaultnew?albumId=<id>&…` — при выборе альбома и после каждого
успешного `POST /vault/albums/media` (`loadVault()`, бандл 2026-10-12 `main:12696-12712`, `:12818-12834`). Увидеть
адрес запроса страницы может только MAIN. Добавлено десятое событие пачки.

- **`fx.vaultLoaded {albumId | null, seq}`** (`FROM_MAIN_FANSLY_TYPES`, `FANSLY_BRIDGE_UNDROPPABLE_EVENTS` — поток,
  по порядку): ответ 2xx на `GET /media/vaultnew`; `albumId` — параметр `albumId=` его адреса, `null` — альбом-тип
  vault («Posts», «Messages»: `type=`, без id); тело ответа не читается. `seq` — номер наблюдения, как у
  `fx.vaultAdded`: перезагрузка после добавления имеет больший.
- Фикстуры (`test/fixtures/fansly.ts`): верные — альбом по id и альбом-тип; неверные — id числом, без `seq`, с
  `mediaIds` (ответ не читается), id не snowflake. Тесты — `packages/contracts/test/fansly.test.ts` (по списку типов).
- Байты: модуль сайта, в бандлы ChatSpace не попадает.

### P7f — отправки человека в `fx.health`

Не PR этапа 4, но в его открытую версию (`docs/project-unite/architecture.md` §5.9, §6, §8.13; спайк P3a, `spike.md` §3:
«в `client_health` добавить счётчик порядка „эхо раньше квитанции / позже“ — реальный порядок на Fansly стенд не
покажет»). Отправку человека MAIN атрибутирует сам (жест, квитанция ровно `POST /api/v1/message`, эхо `5/1` — `fx.sent`),
но провода для счёта этого пути контракт не давал: без него ни «Статус», ни `client_health` не скажут, почему `sent` нет,
и в каком порядке на настоящем Fansly приходят квитанция и эхо.

- **`FanslyHealthSchema.sends`** — `{gestures, receipts, ambiguous, media, sent, echoFirst, receiptFirst}`, все —
  `CountSchema`: доверенные жесты в основном поле; помеченные жестом ответы ровно `POST /api/v1/message` — квитанция
  креатора в чате жеста; жесты с двумя такими запросами и квитанции с медиа — не атрибутированы; сказанные `fx.sent` и из
  них — сколько раз эхо пришло раньше квитанции и сколько позже (`echoFirst + receiptFirst = sent`, проверка схемы). Только
  счёт: ни id, ни текста. Поле обязательное: MAIN и изолированный мир выходят одной сборкой.
- Фикстуры (`test/fixtures/fansly.ts`): у `fanslyHealth` — пять жестов (один проглочен фильтром слов соседа, один с
  медиа, три отправлены, эхо раньше — один раз), у пустого счёта на `document_start` — нули; неверные — без `sends`,
  сумма порядков не равна `sent`, отрицательный счёт, лишний счётчик. Тест `packages/contracts/test/fansly.test.ts`.
- **`fx.sent.gestureAt`** (после ревью P7f) — `timeStamp` события жеста, обязательное число ≥ 0. Оба мира читают его у
  одного и того же события, поэтому изолированный мир связывает отправку только с черновиком, прочитанным на этом самом
  жесте: связь по одному тексту приписывала поздно подтверждённую отправку одной операции черновику другой с тем же
  текстом. Фикстуры: верное событие и пачка — с `gestureAt`; неверные — без него, отрицательный, строкой.
- **`sends.ambiguous`** (повторная проверка P7f) — не только жест с двумя запросами `POST /message`, но и любая
  отправка, которую не отличить: имя жеста (`timeStamp`, его точность Firefox огрубляет) делит другой жест, или
  отправка доказана позже 120 с после жеста. Форма не меняется, только смысл счётчика.
- Байты: модуль сайта, в бандлы ChatSpace не попадает.

### P13b — панель vault: модель, действия и тексты

Не PR этапа 4, но в его открытую версию (`docs/project-unite/architecture.md` §7.21). Панель vault — поверхность только
Fansly (`FANSLY_SURFACES_AHEAD`): её модель и действия не входят в общий `AppClient` и `UiAction` (байты ChatSpace), а
приходят своим клиентом. Новый модуль сайта `@cg/contracts/vault-fansly` — только типы и списки, ни одной схемы: модель
и действия не пересекают границу миров (панель и её контроллер живут в одной вкладке), а контрольная точка в фоне —
прежняя `VaultCheckpointSchema` (P4a3).

- **`VaultPanelVM`** — вход и режим (`closed` / `open` / `minimized`), аккаунт, альбом, форма загрузки, порядок альбома,
  набор (`VaultSelectionVM`: файлы в порядке альбома с состоянием, проблемы и предупреждения плана), прошлый запуск
  (`VaultResumeVM`: `found` / `continue` / `other`), вопрос о неизвестном файле, ход (`VaultRunVM`: состояние, готово,
  остановка `VaultStopVM`, код `CG-VAULT-*`, отчёт), заметка о сбое шага с точкой (`VaultPanelNote`), доступность
  кнопок и почему Start недоступен (`VAULT_START_BLOCKS`). Списки `VAULT_ALBUM_ORDERS`, `VAULT_RUN_STATES`,
  `VAULT_ITEM_STATES`, `VAULT_STOP_KINDS` (их держат равными загрузчику P13a тесты host-fansly).
- **`VaultPanelAction<F>`** и **`VaultPanelClient<F>`** — `F` — файл человека, как его даёт страница (DOM `File`):
  контракты DOM-типов не несут.
- **Ключи текстов `fansly.vault.*`** (`FANSLY_VAULT_TEXT_KEYS`, `FANSLY_VAULT_PLURAL_KEYS`) — только в каталогах Fansly
  (`core/src/domain/hosts/fansly/i18n/vault.ts`), в общих каталогах их нет; приходят с чанком vault.
- Фикстур нет: схем нет. Тесты — `packages/contracts/test/fansly.test.ts` (модуль вне корня пакета, ключи свои и
  каждый один раз, у каждой остановки и каждой причины — свой текст).
- Байты: модуль сайта, только типы и списки текстов; в бандлы ChatSpace не попадает.
- **Ревью P13b — одна вкладка на альбом.** Ответы `fansly.vault.checkpoint` и `fansly.vault.clear` — `{recorded,
  held?}` (`held: true` только при `recorded: false`: альбом держит другая открытая вкладка, ничего не записано), ответ
  `fansly.vault.resume` — `{checkpoint, held?}`; правило шага `vaultCheckpointFollows(row, next)` — какую запись той же
  загрузки фон принимает поверх строки на диске (не назад, не файл поверх файла в пути). В модели панели — заметки
  `held` и `moved`, причина недоступного Start `held` и их тексты. Всё добавочно: старые ответы `{recorded}` и
  `{checkpoint}` читаются как прежде. Фикстуры: верные `{recorded: false, held: true}`, `{checkpoint, held: true}`;
  неверные `{recorded: true, held: true}`, `held: 'yes'`.

### P7i — как сайт видит отправку человеком: `human-send` в манифесте фич

Не PR этапа 4, но в его открытую версию (`docs/project-unite/architecture.md` §1.4, §7.22). Фон берёт ручную отправку
части за известную (`op.reportSent`: телеметрия `sent`, регистрация приветствия в хабе) только где сайт её видит. До
P7i правило было ChatSpace (`wsTap` страницы операции) в общем коде фона, и `sent` Fansly (P7f: жест, квитанция и эхо
в MAIN) отбрасывался бы всегда: у страницы Fansly `wsTap` нет. Правило сайта — запись манифеста, а не имя сайта.

- **`FEATURES_COMMON['human-send']`** (`features/common`) — `{kind: 'service'}`: часть, отправленная человеком, взята
  за известную. Ветки сайтов: ChatSpace — `base: {flags: ['wsTap'], hostCapabilities: ['sendObserve']}` (его сокет и
  `wsTap` страницы операции, как было); Fansly — `base: {flags: [], hostCapabilities: ['sendObserve']}` (MAIN видит
  отправку при включённом сайте, выключателя владельца нет); обе `actions: {}`, `surfaces: []`, `source: 'page'`.
  Фон спрашивает `admission(slice, 'human-send', null, onPage(bootstrap, page))` страницы операции — возможности
  сайта проверяет его вкладка; среза сайта нет (модуль Fansly не поднялся) — не видно.
- Строки паритета записи — `TL-004` (`tools/gates/manifest.ts`, `FEATURE_PARITY`).
- Тесты: `packages/contracts/test/features.test.ts` (обе ветки записи), `apps/extension/test/account-switch.test.ts`
  (`humanSendObservable` по срезам обоих сайтов: ChatSpace — по `wsTap` страницы операции, Fansly — без `wsTap`, но
  не без среза), `apps/extension/test/wiring-fansly.test.ts` (`op.reportSent` вкладки Fansly записан на странице без
  `wsTap`, вкладки ChatSpace — по-прежнему нет).
- Байты: срез ChatSpace получил запись — сдвинулись `background.js` и `tab-app` его ленивой сборки (`pnpm gates:bytes`).

### P8a — превью без разговора: причина `conversation-unknown`

Не PR этапа 4, но в его открытую версию (`docs/project-unite/architecture.md` §1.9, §7.23; `spec.md` FS-IDN-6). Превью
работает с разговором, который назвал его список (`PreviewTargetInfo.conversationRef`, F6a). Где чат — сам фан
(OnlyFans), разговор и без списка известен: это фан. Где у чата свой id (Fansly: группа), до P8a превью подставляло id
фана — запрос к хабу шёл с чужим `conversationRef`. Теперь в таком превью без разговора ничего разговорного не
спрашивается, и кнопки должны сказать почему — в словаре причин такой не было.

- **`UNAVAILABLE_REASONS['conversation-unknown']`** — ключ `dock.reason.conversationUnknown` («переписка с этим фаном
  ещё не найдена»), код `CG-DATA-NOT-READY` (отказ клика словами кода: «Данные ещё собираются»). Новый ключ i18n —
  тексты в `core/domain/i18n` (`ru`, `en`).
- Форм провода не меняет; тесты словаря причин (`packages/contracts/test/vm.test.ts`) обходят все причины.
- Байты: ключ и два текста — в общих каталогах обоих сайтов, причина — в общей таблице.

## 1.14.0 — 2026-10-11 (язык по умолчанию — русский; замечание владельца, решение X29)

Схемы, сообщения, коды CG и ключи i18n не менялись: новых полей и имён нет. Меняется одно
значение — умолчание настроек.

- `DEFAULT_SETTINGS.ui.locale`: `ru` вместо `system`. Чаттеры, руководство и сайт русские,
  а язык браузера о человеке ничего не говорит: на стандартном Firefox и в антидетект-профиле
  он английский, и свежая установка открывалась по-английски. `system` и `en` по-прежнему
  входят в `UI_LOCALES` и выбираются в «Вид и звук».
- Схема `SettingsV1` та же, версия схемы настроек (`SETTINGS_SCHEMA_VERSION`) не растёт,
  миграции нет. Первый запуск записывает умолчания в хранилище, поэтому у установок, сделанных
  до 1.14.0 (выпуски до 0.2.1), сохранено `system`, и оно остаётся: язык там меняется в настройках.
- Пока настройки не прочитаны, страницы и вкладка говорят на языке умолчания
  (`DEFAULT_SETTINGS.ui.locale`, во вкладке — `DEFAULT_LOCALE`: схемы настроек в её сборку не
  входят), а не на языке браузера.

Тесты: `packages/contracts/test/schemas.test.ts`, `packages/core/src/domain/settings/settings.test.ts`,
`packages/testing/src/pages/controller.test.ts`, `apps/extension/test/wiring-pages.test.ts`.

## 1.13.0 — 2026-10-11 (семейный вид: токены темы и подсказки кнопок, решение X28)

Старые потребители не ломаются: всё новое — новые имена токенов и новые ключи текстов.
Схемы, сообщения, коды CG и действия не менялись.

- **Токены темы** (`vm/theme.ts`, `THEME_TOKENS`) — десять новых имён:
  - `surface`: `--cg-raised` (наша карточка: панель, результат, меню, тост, подсказка),
    `--cg-chip` (приподнятый чип), `--cg-groove` (утопленная капсула опций),
    `--cg-draft`, `--cg-draft-hover` (тёплая заливка черновика AI);
  - `meaning`: `--cg-clay`, `--cg-clay-ink`, `--cg-clay-bg`, `--cg-clay-line` — терракота,
    акцент семьи ChatGoose: главное действие, то, что включено, фокус, состояние нашего
    результата;
  - `font`: `--cg-serif` — текст, который написал AI.
- **Смысл цветов** (комментарий группы `meaning`): синий хоста — только то, что уйдёт фану
  («Отправить», исходящий пузырь); фокус, акцентная точка и выбранная строка списка теперь
  терракотовые. Имена `--cg-accent`, `--cg-focus`, `--cg-focus-soft`, `--cg-sel` те же,
  значения задаёт `ui/kit` (значения — не контракт).
- **Токены без потребителя** остались в списке как короткие псевдонимы: `--cg-divider`,
  `--cg-bare-rule`, `--cg-bare-edge`, `--cg-bare-hover` (вид «без подложки» больше не
  печатает результат на ленте). Имя из замороженного списка не убираем.
- **Ключи i18n** — пятнадцать новых (`UI_TEXT_KEYS`), одно предложение под именем кнопки в
  её подсказке: `dock.hint.reply`, `.fix`, `.hi`, `.ping`, `.review`, `.recap`, `.coach`,
  `dock.hint.tone.casual`, `.flirty`, `.upsell`, `.spicy`, `dock.hint.toneOff`,
  `dock.hint.split`, `dock.hint.spenders`, `dock.hint.newcomers`. Оба каталога их несут.
- Ключи, которые панель больше не печатает, остаются в каталогах (ключ не убираем без
  мажорной версии): `dock.action.moreTooltip`, `dock.option.toneMenuTitle`,
  `dock.option.toneNone`, `dock.quota.lowShort`. `dock.option.toneTooltip` («Тон на один
  ответ  ⌘⇧O») переехал с кнопки «Тон» в подсказку каждого тона.
- Фикстуры: новых схем нет. Полноту каталогов проверяет `core/domain/i18n/i18n.test.ts`,
  значения и правила цветов — `ui/src/kit/tokens.test.ts`.

## 1.12.0 — 2026-10-10 (тоны звука по умолчанию; отзыв первого чаттера, решение X26)

Схемы, сообщения, коды CG и ключи i18n не менялись: новых полей и имён нет. Меняется одно
значение — умолчание настроек.

- `DEFAULT_SETTINGS.sound`: `messages.tone` — `blip` вместо `chime`, `subscribers.tone` —
  `arpeggio` вместо `double`. Это тоны десктопа OnlyFans; прежние были тонами
  Fansly-расширения, и чаттер, который работает в двух клиентах, не различал, какой звонит.
  Оба значения и раньше входили в `SOUND_TONE_IDS`: схема `SettingsV1` та же, версия схемы
  настроек (`SETTINGS_SCHEMA_VERSION`) не растёт, миграции нет.
- Кто это замечает. Новая установка звонит blip и arpeggio. Сохранённые настройки не
  трогаются: chime или double, записанные до 1.12.0, остаются выбором человека
  (`core/domain/sound` считает «нетронутым» только текущее умолчание). Таблица умолчаний по
  платформам (`PLATFORM_DEFAULT_TONES`, в `core`) переставлена так же: OnlyFans — blip и
  arpeggio, Fansly — chime и double.
- Фикстуры: `ToneId` уже проверяется на `chime`, `blip` и неверном `beep`; значения
  умолчаний проверяют тесты звука (`core/domain/sound/sound.test.ts`,
  `core/test/services-sound.test.ts`) и страницы настроек (`testing/src/pages`).

Остальные правки X26 (клик по строке части, Fix без вопроса Б2, кнопки тонов и окон в
полосе, удержание низа ленты, тост отказа палитры) контрактов не касаются: кнопки берут
готовые ключи (`dock.tone.*`, `dock.option.toneValue`, `dock.option.toneNone`,
`spenders.title`, `newcomers.title`), действия — те же `Generate`, `SetTone`, `Navigate`,
`InsertPart`, `ReplaceMyDraft`.

## 1.11.0 — 2026-10-09 (X8 на любой сборке ChatSpace и предохранитель, решение X25)

Старые потребители не ломаются: всё новое — необязательные поля, новые сообщения, новый код
CG, новое действие и новые ключи. Значение хаба не меняется по форме: профиль «любая сборка»
— обычный `ReceiptProfile` с `modules` = `{"*":"*"}`.

Владелец отменил правило X21 (2026-10-09): X8 допускается на любой сборке ChatSpace, пока
ничего не сломалось, а после каждой отправки с известным исходом квитанцию сверяет
предохранитель.

- **Профиль-метка «любая сборка»** (`send-rules.ts`, без схем — его читает ранний старт
  изолированного мира): `ANY_BUILD_MODULE` (`*`) и `isAnyBuildReceiptProfile(profile)` —
  профиль, у которого в `modules` ровно `{"*":"*"}`.
  Совпадает с любой сборкой, если версия адаптера та же и на странице загружены модули всех
  ролей пути отправки. Точные профили работают рядом, совпавший точный называется первым.
- **`RECEIPT_MATCH_KINDS`** (`send-rules.ts`): `exact`, `anyBuild`.
- **`HostContractReport.receiptMatch`** — необязательное `{ profile, kind }`: какой профиль
  пустил X8 на этой странице и как. Его показывают «Статус», выгрузка диагностики, журнал
  вкладки и `client_health`.
- **Предохранитель** (`send-rules.ts`, `send.ts`): причины `SEND_FUSE_REASONS` (`text`,
  `count`, `target`, `uncertain`), места `SEND_FUSE_EVIDENCE` (`request`, `response`,
  `echo`, `queue`, `outcomes`), порог `SEND_FUSE_UNCERTAIN_RUN` (3); схемы `SendFuseFact`
  (что увидел MAIN: попытка, причина, место, длины двух текстов — никогда сам текст),
  `SendFuse` (что хранит фон: когда, почему, на какой сборке, какая попытка; сборка `null` —
  любая: не была известна или предохранитель сработал на двух сборках подряд),
  `SendFuseState` (`fuse` и время последнего сброса `resetAt`); `sendFuseHolds(fuse, build)`
  в `send-rules.ts` — держит ли предохранитель вкладку этой сборки (неизвестную — держит).
- **Код `CG-SEND-FUSE`** (после `CG-SEND-RECEIPT`; прил. А, реестр, тексты ru/en): отправка из
  превью выключена предохранителем в этом браузере до новой сборки ChatSpace или сброса в
  «Статусе». Он же — новое условие в `PREVIEW_SEND_CONDITION_CODES` и причина
  `send.reason.fuse` в `SEND_REASON_KEYS`. Повтором клика не снимается, но в
  `SEND_HOLD_CODES_WITHOUT_RETRY` не входит: после сброса та же часть отправляется новым
  кликом.
- **Мост MAIN:** событие `previewSendFuse` (`SendFuseFact`), в `BRIDGE_UNDROPPABLE_EVENTS`
  (стоит перед `fault`, `fault` остаётся последним).
- **Порт хоста:** событие `HostEvent` `sendFuse`.
- **Протокол вкладки и страниц:** запросы `send.fuse` (вкладка сообщает о срабатывании:
  `fact` и сборка вкладки), `send.fuseState` (состояние предохранителя), `send.fuseReset`
  (только страница настроек: «Сбросить предохранитель»); событие `send.fuse`; необязательное
  поле `SendBegin.hostBuild` (сборка ChatSpace вкладки: фон держит отправку с
  `CG-SEND-FUSE`, пока предохранитель назван этой сборкой); необязательное поле
  `DiagnosticsSnapshot.sendFuse`.
- **Действие `ResetSendFuse`** — кнопка строки «Отправка из превью» в «Статусе».
- **Ключи:** `send.reason.fuse`; `settings.status.row.previewSendExact`,
  `…previewSendAnyBuild`, `…previewSendAnyBuildNote`, `…previewSendFused`,
  `…previewSendFusedNote`, `settings.status.fuse.reset`,
  `settings.status.fuse.reason.{text,count,target,uncertain}`,
  `settings.status.row.contractReceiptExact`, `…contractReceiptAnyBuild`,
  `settings.status.warning.sendFused`; тексты кода `cg.sendFuse.*` выводятся из кода.
- Фикстуры — верные и неверные для каждой новой схемы, запроса, ответа и события (нет текста
  в факте, нет неизвестных причин и мест, нет попытки без id).

## 1.10.0 — 2026-10-09 (стор, которого ChatSpace ещё не создал: «ещё нет», а не «не найдено»)

Старые потребители не ломаются: одно новое значение в словаре состояний якоря, одно
необязательное поле моста и три новых ключа. Кто сравнивает состояние якоря с `ok`, как
раньше, считает новое значение «не в порядке» — X8 при нём выключен.

Живая проверка на ChatSpace 0.202.0: после перезагрузки страницы, пока ни один чат не
открыт, «Статус» показывал «проверен частично — Не найдено: composerTranslator. Вставка
работает», а «Отправить» в превью — `CG-SEND-HOST` с общим «ChatSpace сейчас не принимает
отправку». ChatSpace создаёт стор переводчика поля ввода только при монтировании первого
поля ввода чата и держит его до перезагрузки (так в 0.195.0–0.202.0); «не создан ещё»
выглядел как сломанный контракт.

- **`ANCHOR_STATES`: новое значение `notYet`** — якоря ещё нет, и сейчас так и должно быть:
  ChatSpace создаёт его позже, с первым полем ввода чата в этом документе. Сейчас так
  бывает только у `composerTranslator`. Это не поломка контракта: «Статус», popup,
  `client_health` и выгрузка диагностики его поломкой не считают, но всё, что читает
  якорь, выключено, пока он не появится (X8 — `CG-SEND-HOST`). Если поле ввода в документе
  уже было, а стора нет — это по-прежнему `missing`.
- **`ContractWire`: новое необязательное поле `notYet`** (список `AnchorId`, до 32) — так
  MAIN говорит о таких якорях. Нет поля — MAIN до 1.10.0: всё, чего нет, в `missing`.
- **Ключ `send.reason.hostNotYet`** — текст `CG-SEND-HOST` у «Отправить», пока ChatSpace не
  создал то, что читает отправка из превью: «откройте любой чат, и она заработает…». Код
  тот же; константа `SEND_REASON_HOST_NOT_YET` в `vm` (в `SEND_REASON_KEYS` по одному
  тексту на код, этот — второй текст `CG-SEND-HOST`).
- **Ключи `settings.status.row.chatspaceNotYetNote`** (пояснение строки «ChatSpace» в
  «Статусе»: «Отправка из превью заработает, когда вы откроете любой чат.») и
  **`settings.status.row.contractNotYet`** (строка «Контракт ChatSpace» в режиме отладки).
- Фикстуры — верные (`ContractWire` с `notYet`, отчёт с якорем `notYet`) и неверные
  (неизвестный якорь в `notYet`, `notYet` не списком, неизвестное состояние якоря).

## 1.9.0 — 2026-10-09 (окно превью для «Онлайн» палитры; решение X24)

Старые потребители не ломаются: в открытом словаре одно новое значение.

- **`MOUNT_SURFACES`: новое значение `preview`** — своё окно превью фана, которого
  «Онлайн» палитры ⌘K показал онлайн (CS-030). Превью из Spenders и «Новых» остаётся частью
  своего окна и отдельно не монтируется. Значение нужно там же, где и остальные: имя
  поверхности в отчёте о сбое (`KitFailure.surface`) и в «Перезагрузить панель»
  (`ReloadSurface.surface`, `z.enum(MOUNT_SURFACES)`). Модель вида та же —
  `{ of: 'preview', from: 'palette' }`, она была с 1.0.
  Фикстуры — верные (`ReloadSurface` с `preview` и `palette`) и неверные (неизвестная
  поверхность, без поверхности).

## 1.8.0 — 2026-10-09 (аккаунт маршрута вкладки: «Статус» называет тот, на котором вкладка)

Старые потребители не ломаются: два новых необязательных поля, смысл старых тот же.

Живая проверка на ChatSpace 0.200.0: вкладка на `/accounts/36408/chats`, чат не открыт,
ChatSpace загрузил оба аккаунта человека (36408 и 36409). «Статус» назвал «Привязка
аккаунта: OnlyMonster 36409 → LoraVie FREE», и строки персоны, Spenders и отправки из
превью были о той же странице. Фон знал только загруженные аккаунты вкладки (`openTabs`
считал вкладку у каждого из них), а не тот, на котором её маршрут; страницы брали первый
аккаунт с `openTabs > 0` (AU-034: в ChatSpace несколько аккаунтов на вкладку, привязка по
маршруту).

- **`tab.presence`: новое поле `routeAccount`** (`HostAccount | null`, необязательное) —
  аккаунт, на котором стоит маршрут вкладки (`/accounts/<id>/…`), открыт чат или нет; `null` —
  маршрут аккаунта не называет. Вкладка шлёт его в каждом отчёте (`snapshot.route.account`);
  нет поля — вкладка до 1.8.0, её маршрут неизвестен. Один из загруженных `accounts`.
- **`accounts.seen`: у строки новое поле `routeTabs`** (число, необязательное) — сколько
  вкладок стоит на этом аккаунте сейчас. `openTabs` по-прежнему — сколько вкладок его
  загрузили. Нет поля — фон до 1.8.0 их не считал.
- Страницы (`currentAccountOf`): аккаунт открытого чата; иначе тот, на котором маршрут
  вкладки (`routeTabs > 0`); иначе, как раньше, первый загруженный во вкладке и последний
  виденный. «Аккаунты» ставят аккаунт маршрута первым, статус «В работе» — как раньше, у
  каждого загруженного.
- Фикстуры — верные (с `routeAccount` и `null`, с `routeTabs`) и неверные (`routeAccount` —
  строка и не тот id, `routeTabs` меньше нуля).

## 1.7.0 — 2026-10-09 (сбои MAIN и нейтральные имена на странице; решение X22)

Старые потребители не ломаются: одно новое событие, а три имени, которые видит страница,
сменили значение. Все, кто их читает, берут константу, а не строку; MAIN и
изолированный мир всегда приходят из одной сборки.

- **Новое событие MAIN → изолированный мир `fault`** (`FROM_MAIN_TYPES`, `FROM_MAIN.fault`,
  `BridgeEventSchema`): `{source, count}` — сбой нашего собственного кода в мире страницы,
  который поймал его `guard` (`host-chatspace/src/main/guard.ts`), и сколько раз это место
  сбоило в документе. MAIN шлёт его, когда счёт места доходит до 1, 2, 4, 8…;
  `source` — машинная лексема (`FAULT_SITE_PATTERN`), в логи идёт как есть. Событие в
  `BRIDGE_UNDROPPABLE_EVENTS`: склеенное по типу, сообщение одного места скрыло бы другое.
  Изолированная сторона пишет его в лог вкладки (`tab.host` `main-fault`, код `CG-UNKNOWN`).
  Фикстуры — верные и неверные (не лексема, ноль сбоев, лишний ключ).
- **Имена, которые видит страница, больше не называют расширение** (страница может
  отдать их своей телеметрии; в 0.195.0 у ChatSpace Sentry):
  - `WS_TAP_SYMBOL_KEY` — `'wsTap'` (было `'chatgoose.wsTap'`): глобал на `window`,
    через который тап отдаёт ручку мосту;
  - `SCHEME_ATTRIBUTE` — `'data-scheme'` (было `'data-cg-scheme'`): атрибут схемы на
    нашем хосте (и на `<html>` страниц расширения), по нему таблицы стилей берут тёмные
    значения;
  - новая константа `BRIDGE_TAG_KEY = 'tag'`: ключ тега в сообщениях рукопожатия
    (`{tag: 'main-ready', v}`; был литерал `cg`). Значения `BRIDGE_TAGS` те же.

  Атрибуты хостов (`data-host`, `data-mode`, `data-layer`, `data-pending`) живут в
  `host-chatspace`, не в контрактах; что внутри закрытых корней (`data-cg-*`, `.cg-*`),
  страница не видит и не меняется.

## 1.6.0 — 2026-10-08 (перевендоринг из `main` хаба `c8514c5c`; добавочное)

Старые потребители не ломаются: формы запросов и ответов те же, одна новая константа.
Одно ужесточение — граница хаба у двух чисел тела брони (ниже): оно отвергает только
то тело, на которое хаб и так отвечает 400.

- **`ClaimBodySchema`: `textRevision` и `flagRevision` — не больше
  `CLAIM_REVISION_MAX` (2 147 483 647).** Хаб хранит обе ревизии в 32-битных столбцах
  (`clientRevision` в `packages/contracts/src/routes-client.ts` хаба) и на большее число
  отвечает 400. Раньше схема пропускала любое неотрицательное целое, и такое тело ушло
  бы в сеть; теперь `dispatch` с ним не собирается (`CG-HUB-REQUEST` до сети). На деле
  ни одна из ревизий до этой границы не доходит. Фикстуры — граница в верных телах
  `ClaimBody`, на единицу больше — в неверных.
- **`HUB_ROUTES`: шесть маршрутов стали операциями SDK.** У `clientConversationFeed`,
  `clientSpenderStats`, `clientSpenderAwaitingReply`, `clientFanClaim`,
  `clientFanClaimStatus` и `clientAudienceNew` поле `since` — `sdk` (было `H-9c`,
  `H-8b`, `H-8c`, `H-7b`, `H-7b`, `H-7c`): они пришли с перевендорингом SDK из `main`
  хаба `c8514c5c` (PR хаба #477–#481). Хаб взял наши формы запросов и ответов как есть:
  поле в поле, те же методы и пути, тот же курсор (непрозрачная подписанная строка до
  2048 символов) и те же причины отказа (`cursor_invalid`, `cursor_window_mismatch`,
  `unknown_time_zone`, коды брони); поле говорит только, каким транспортом слой хаба
  их шлёт. RouteTransport (`packages/hub/src/route-transport.ts`) удалён: все маршруты
  контракта идут одним путём, через SDK. Значения `H-7b`, `H-7c`, `H-8b`, `H-8c`,
  `H-9c` в типе `since` остались. `HUB_FORBIDDEN_OPERATIONS` не менялся: новые операции
  кабинета `clientSendCustodyResolve` и `clientSendCustodyList` в нём уже были.

## 1.5.0 — 2026-10-05 (закрытие известных недоделок; добавочное)

Старые потребители не ломаются: одна причина недоступности, одно необязательное поле и
три новых ключа. Типы только добавились, но **два прежних значения стали значить другое**
— это сказано в пунктах ниже и собрано здесь:

- **статус дока `hub-down` теперь бывает по двум причинам**: хаб не ответил — или потерян
  порт вкладки при живом расширении. Различает их только код в `statusError`
  (`CG-RUNTIME-UNREACHABLE` — порт). Кто выбирает слова по одному статусу, скажет про
  потерянный порт «хаб недоступен»: причину надо брать у кнопки (`reason`,
  `toneReason`, `splitReason`), а где её нет — по коду статуса. Раннер клавиш так и
  делает (`statusReason` в `packages/core/src/application/hotkeys/runner.ts`);
- **текст ключа `settings.status.row.chatspacePartialNote` сменил смысл на обратный**:
  было «…Вставка работает через „Копировать“», стало «…Вставка работает». Прежняя фраза
  теперь у нового ключа `chatspaceCopyOnlyNote`. Ключ остался, поэтому версия
  минорная; кто показывал этот ключ как «только копировать», должен перейти на новый.

- **Потерянная связь с фоном — не обновление.** Новая причина недоступности
  **`runtime-unreachable`** в `UNAVAILABLE_REASONS` (код `CG-RUNTIME-UNREACHABLE`, ключ
  `dock.reason.runtimeUnreachable` — «нет связи с расширением, переподключаюсь»). Раньше
  док, у которого порт вкладки оборвался при живом расширении, называл причиной
  `reload-needed` («расширение обновилось, перезагрузите вкладку»). `reload-needed`
  остаётся только за настоящим обновлением (`CG-RUNTIME-RELOADED`). Статусы дока
  (`DOCK_STATUSES`) не менялись: потерянная связь — это `hub-down` с ошибкой
  `CG-RUNTIME-UNREACHABLE` (плашка с «Повторить»), а не `reload-needed`.
- **«Ждут ответа» без очереди хаба.** У доски Spenders — необязательное поле
  **`SpendersBoardVM.waitingFallback?: { error: CgErrorView; retry: UiAction } | null`**:
  фильтр «Ждут ответа» нажат, а очередь хаба не прочиталась — список построен локально,
  по уже загруженным строкам доски. Доска говорит это над списком: карточка ошибки с
  кодом и «Повторить» и строка `spenders.waitingLocal`. Поля нет или оно `null` — список
  тот, что называет фильтр. Фикстуры — `WAITING_FALLBACK_SAMPLES`.
- **«Статус»: частичная проверка ChatSpace и «только копировать» — разные строки.** Новый
  ключ `settings.status.row.chatspaceCopyOnlyNote` — пояснение для случая, когда вставка
  действительно не работает. Прежний `settings.status.row.chatspacePartialNote` остаётся
  для частичной проверки, при которой вставка работает (его текст правится без смены
  версии).

## 1.4.0 — 2026-10-05 (правки после двух рецензий ветки; добавочное)

Старые потребители не ломаются: одно необязательное поле и два новых ключа.

- **Строки-остатки таблицы тиров статистики Spenders.** Хаб присылает в `tiers` два
  тира без границ — с ключами `untiered` (фаны, которых не взял ни один тир) и
  `unattributed` (деньги окна, не отнесённые ни к одному фану). Клиент узнавал такой
  тир по отсутствию границ и давал обоим один id — в таблице получались две строки с
  одним ключом и одной подписью. Теперь у строки статистики есть необязательное поле
  **`SpendersStatsVM.shelves[].remainder?: 'untiered' | 'unattributed'`**
  (`STATS_REMAINDERS`, `StatsRemainder`): остаток узнаётся по ключу хаба, а не по
  пустым границам. Два новых ключа i18n — `stats.shelf.untiered` («Без тира») и
  `stats.shelf.unattributed` («Не распределено»). Строка без поля — обычный тир с
  границами, как раньше. Фикстуры — `STATS_REMAINDER_SAMPLES`.

Не изменения контракта, но в этом же выпуске: текст ключей `dock.status.pageOff` и
`dock.reason.pageOff` стал «ChatGoose выключен владельцем» — главный выключатель
хаба один на все страницы, а не свой у каждой (тексты правятся без смены версии).

## 1.3.0 — 2026-10-04 (первая живая проверка; добавочное)

Что показала первая проверка на настоящем ChatSpace 0.172.0 с прод-хабом. Старые
потребители не ломаются: новое поле и новые поля строк необязательные, новые
ключи только добавлены. Перечисления (`DOCK_STATUSES`, `UNAVAILABLE_REASONS`)
не менялись. Одно ужесточение — правило хаба для Coach в запросе потока (ниже):
оно отвергает только то тело, на которое хаб и так отвечает 400.

- **Причины выключенного флага — пять ключей i18n.** Хаб считает каждый флаг
  по странице и отдаёт причину (`pages[].features[flag].reason`); клиент
  печатал на всё одно: «функция выключена для страницы». Теперь у причин свои
  слова: `dock.reason.pageOff` («ChatGoose выключен владельцем»; до 1.4.0 текст был
  «…для этой страницы», хотя главный выключатель хаба общий для всех страниц —
  причина `disabled`), `dock.reason.hubNotReady`
  («хаб пока не умеет эту функцию», `hub_not_ready`),
  `dock.reason.platformUnsupported` (`platform_unsupported`),
  `dock.reason.clientOutdated` (`client_outdated`). Причина `flag_off`
  остаётся прежним `dock.reason.featureDisabled`, `binding_missing` и
  `not_granted` — прежними `dock.reason.noBinding` и `dock.reason.notGranted`.
  Новых id в `UNAVAILABLE_REASONS` нет: причина приходит с прежним id
  (`feature-disabled`) и своим текстом и кодом, как это уже сделано для
  `dock.reason.keyInField`. Правило чтения флагов —
  [protocols/hub.md](protocols/hub.md), «Флаги: решает страница».
- **`DockVM.notice?: CgErrorView | null`** и ключ `dock.status.pageOff`. Одна
  строка статуса у дока, который в остальном `ready`: владелец выключил
  ChatGoose главным выключателем хаба — он один на все страницы, и все функции
  страницы открытого чата отвечают `disabled`.
  Полоса остаётся, все кнопки AI приглушены с этой причиной, части можно только
  копировать — вместо карточки ошибки после клика, на который хаб ответил бы 409.
  Нового значения `DockStatus` нет: статус остаётся `ready`, у которого своего
  баннера нет; док со своим баннером (`statusError`) строку не несёт. Фикстуры —
  `DOCK_NOTICE_SAMPLES`.
- **`PageTagVM { platform, pageLabel }`** — чем отличить страницы с одним
  названием («Lora Vie» на OnlyFans дважды и на Fansly). Необязательные поля
  там, где страницы перечисляют или выбирают: `PersonasBodyVM.pages[].page`,
  `AccountsBodyVM.rows[].page` (`null` — страницы нет), `PopupVM.persona.page`
  (`set` и `no-persona`), а в `AccountBodyVM.pages[]`, где `platform` уже был, —
  `pageLabel`. `platform` — открытая лексема хаба, незнакомая печатается как
  есть; `pageLabel` — ключ страницы в хабе. Только для показа: ни привязка, ни
  поиск по ним не идут (AU-023). Фикстуры — `PAGE_TAG_SAMPLES`.
- **`HubStreamRequestSchema`: правило хаба для Coach.** Запрос `coach-chat` с
  `preset` не несёт `chatterQuestion`, а без `preset` вопрос обязателен. Это не
  новое требование к потребителям, а правило самого хаба: на тело с обоими
  полями он отвечает 400 («coach-chat preset forbids chatterQuestion») — первая
  живая проверка это и получила. Раньше схема такое тело пропускала, и запрос
  уходил; теперь он не собирается (`CG-HUB-REQUEST` до сети). Сборщик запроса
  с пресетом вопрос не шлёт: слова чипа остаются в диалоге. Фикстуры — два
  верных и три неверных запроса Coach в `HubStreamRequest`.
- **`HUB_ROUTES`: четыре маршрута стали операциями SDK.** У `clientBootstrap`,
  `clientConversationRecaps`, `clientFanProfileFromGeneration` и
  `clientAiUsageDaily` поле `since` — `sdk` (было `H-2a`, `H-13`, `H-5`,
  `H-15`): они пришли с перевендорингом SDK из хаба `e7e1037b`. Формы запросов
  и ответов не менялись; поле говорит только, каким транспортом слой хаба их
  шлёт. Значения `H-2a`, `H-5`, `H-13`, `H-15` в типе `since` остались.

## 1.2.0 — 2026-10-04 (волна 2: R11, R12, R14, R15, R16, R17; добавочное)

Одна минорная версия на всю волну 2: добавочные изменения (`contract-change`)
шести пакетов работ, сведённые интегратором в одну запись (в ветках пакетов
каждое стояло своей записью 1.2.0). Старые потребители не ломаются: новые поля
и методы необязательные, новые запросы, действие, значения и ключи только
добавлены. R09b (X8 и тап) контракты не менял.

### R11 — контроллеры AI

- **Запрос вкладки `recap.save`** (`tab-messages.ts`): `{pageId, fanRef,
  generationRef, opId?}` → `{state: 'saved' | 'not-ready' | 'rejected', savedAt}`.
  Одна идемпотентная запись ссылки `profile/from-generation` (H-5), без новой
  генерации. Нужен действию `RetryRecapSave` («Сохранить ещё раз» при
  CG-RECAP-SAVE) и досылке полного рекапа, открытого из хаба (AI-068): до него
  у вкладки не было способа попросить запись. `not-ready` — вкладка повторяет
  по графику §7 (5 с, 15 с, 60 с, дальше раз в 3 мин до 30 мин), пока открыта.
  Только из вкладки. Фон: `hub.profileFromGeneration` для страницы своей
  привязки, ошибки — обычным `CgErrorWire`.
- **Ключи i18n** (каталоги ru/en): `recap.checking` («Проверяю сохранённые
  Recap…», AI-061), `recap.build.short`, `recap.build.full` («Собрать
  коротко / полностью», ui-design §10); заголовки блоков ответа Coach
  `coach.block.situation | missed | move | risk` (AI-084: у `CoachTurnVM`
  заголовок блока — `Msg`, ключей не было); чипы под ответом
  `coach.chip.another | shorter | refusal` (AI-094).

После ревью R11 (версия та же, добавочное):

- **Ход Coach с авто-рекапом — один допуск** (§7 «один составной слот», AI-096).
  `StartOp.coach.autoRecap?: { length: 'short' | 'full', window }` — фон сначала
  собирает этот рекап для той же цели, потом спрашивает Coach: один `op.start`,
  один токен, слот чата занят от первого шага до последнего, очереди и второго
  токена нет. Допущенная операция — рекап; когда он кончился и вопрос идёт дальше,
  его итоговый вид называет шаг ответа: **`OpView.continuedBy?`** (id операции
  Coach, созданной фоном в тот же момент). Нет поля — продолжения нет (обычная
  операция, отмена, отказ, вкладка закрыта). До этого вкладка сама запускала
  второй шаг из события `op.done` со своим новым токеном: между шагами слот был
  свободен, и токен выдавался не на клик. Фикстуры: два верных и три неверных
  `StartOp`, верный и неверный `OpView`.
- **`CoachTurnVM.confirm?: ConfirmVM | null`** — вопрос Б2 («Заменить / Добавить в
  конец / Отмена») для части черновика Coach (AI-086). `ResultVM.confirm` есть только
  у листа дока, а ход Coach его не получает: UI было неоткуда взять `confirmationId`
  для `AnswerConfirm`. `confirm.part.variant` — номер черновика, как у `PartVM`.
  Поле и его описание совпадают с тем же добавлением R14. Фикстуры —
  `COACH_CONFIRM_SAMPLES` (тип без схемы: неверные значения отвергает компилятор).
- **`CoachVM.hints?: CoachHintGroupVM[]`** — готовые вопросы пустого диалога под
  тремя заголовками «Продать / Вернуть / Понять», по три (AI-081, как в
  Fansly-расширении). Клик кладёт вопрос в поле ввода, а не спрашивает — этим они
  отличаются от `chips`, поэтому отдельное поле: старый потребитель их просто не
  показывает. Двенадцать ключей i18n: `coach.group.sell | return | understand` и
  `coach.hint.sell.how | price | discount`, `coach.hint.return.revive | seen |
  afterPrice`, `coach.hint.understand.likes | person | topics` (тексты — в каталогах
  `ru` и `en`). Фикстуры — `COACH_HINT_GROUP_SAMPLES`.

### R12 — контроллеры Spenders, «Новых», панели фана

- **Центы у суммы на границе полки (SP-013).** Строка паритета требует: суммы —
  целые доллары, «центы — если округление перешло бы границу тира». Правило
  считает контроллер (он знает полку строки), печатает порт `I18n`, поэтому
  добавлены два необязательных поля: `MoneyFormat.cents` (печатать точную сумму:
  `$599.60`, `$0.40`) и `SpenderRowVM.lifetimeCents` (эту сумму «за всё время»
  печатать с центами). Без них сумма $599.60 на полке $350–600 печаталась бы как
  «$600». Порт без `cents` и строка без `lifetimeCents` ведут себя как раньше.
  Фикстуры — `MONEY_CENTS_SAMPLES`.
- **Три ключа i18n:** `spenders.keys.row` — подпись клавиш J/K в подвале доски
  (SP-034; остальные подписи подвала берутся из готовых ключей),
  `spenders.resetFilters` — подпись кнопки `SpendersBoardVM.reset` «Сбросить
  фильтры» (SP-021) и `newcomers.incomplete` — текст «Результат неполный» в
  «Новых» (NF-025: «Показана часть списка…»; прежде у `NewcomersVM.incomplete`
  не было своего текста). Тексты `ru` и `en` — в каталогах `core/domain/i18n`.
  Тот же ключ добавил R15, но как заголовок: что из этого вышло при сведении —
  в разделе «Сведение волны 2» ниже.

- **Запрос `send.list` (ревью R12; §6.7.8, §6.7.9).** `{pageId, fanRef}` →
  `{attempts: SendListItem[], truncated}`: попытки отправки этому фану, которые
  знает фон, — открытые, неопределённые (пока их не разрешили), завершённые и
  разрешённые хабом, пока фон их помнит; сначала те, что держат фана, потом
  новые, не больше `SEND_LIST_MAX` (100). `SendListItem` — `{opId, purpose,
  group, partIndex, view, updatedAt, resolved?}`: только id, состояния и время
  последней смены состояния, текста нет; `resolved: 'sent' | 'not-sent'` —
  попытку разрешили в хабе (H-7 `resolve`), фана она больше не держит. Зачем:
  состояние частей (`uncertain`, «отправлено», «в работе») жило только в памяти
  вкладки. После перезагрузки вкладки `op.list` возвращал результат без попыток,
  и часть с неизвестным исходом снова предлагала «Открыть и вставить» и «Ещё
  раз» — наоборот тому, что требует §6.7.8; о разрешении в хабе вкладка не
  узнавала вовсе (событие `send.state` несёт прежний вид попытки). `send.status`
  спрашивает по `attemptId`, которого у перезагруженной вкладки нет. Отвечает
  фон из своего журнала отправок (`SendCoordinator.attemptsOf`, ключ блокировки
  фана); обработчик подключает интегратор. Фикстуры — запрос, ответ и
  `SendListItem` (верные и неверные).

- **Два числа статистики Spenders (ревью R12; §8.7, SP-046).**
  `SpendersStatsVM.attention.awaitingUnknown?: CountStat` — из «ждут ответа» те,
  у кого прочтение неизвестно: §8.7 требует отдельную категорию «ждёт ответа;
  прочтение неизвестно». `SpendersStatsVM.attention.silentOver21.lifetime?:
  MoneyMills | null` — сумма трат молчащих больше 21 дня (строка паритета
  SP-046: «8–21 д / >21 д и сумма трат молчащих >21 д»; по §8.7 это не
  потерянная выручка и не прогноз). Хаб присылает оба числа
  (`queueSummary.unknown`, `silence.over21.lifetimeGrossMills`), модель вида их
  не несла, и контроллер молча их отбрасывал. Оба поля необязательные: модель
  без них рисуется как раньше; показывать ли их и как — решают владелец и
  `ui-design.md` (§4.15 их пока не называет). Фикстуры —
  `STATS_ATTENTION_SAMPLES`.

- **Неудачное продление брони (ревью R12; NF-021, §8.5).** У `ClaimVM` в
  состоянии `mine` — необязательное `renewError?: CgErrorView`: последнее
  продление не прошло (хаб не ответил). Бронь при этом ещё действует до
  `until`, продление повторяется, пока человек работает с фаном, а «Продлить
  бронь» пробует сразу. Раньше одна неудача молча останавливала продление, и
  карточке нечем было об этом сказать. Карточка без поля рисуется как раньше.
  Фикстуры — `CLAIM_RENEW_SAMPLES`.

- **Источник «Био» панели фана (ревью R12; CS-035, D-29).** Строка паритета
  CS-035 и D-29 говорят: био — из профиля хаба (`pageFanProfile`), память
  ChatSpace — только украшение. Комментарий `FanPanelVM` называл источником
  `HostFan`, а `fan.dossier` панель не читала вовсе. Теперь `bio` — тело
  профиля фана в хабе (`fan.dossier`; это сохранённое досье, Markdown, может
  быть длинным), а «О себе» из памяти ChatSpace показывается, только пока в
  хабе профиля нет. Чтобы UI отличал одно от другого, добавлено
  необязательное `FanPanelVM.bioSource?: 'hub' | 'host'`; панель без него
  рисуется как раньше. Форма `bio` не менялась. Фикстуры —
  `FAN_PANEL_BIO_SAMPLES`.

### R17 — ввод и звук (хоткеи, навигация, палитра, звук)

- **Ключи i18n палитры, шпаргалки и тостов клавиш** (`i18n/keys.ts`, тексты — в
  каталогах `core/domain/i18n`). Модели видов R01 уже называли группы палитры
  `accounts`, `navigation`, `online` (`PaletteGroupId`) и строки шпаргалки для J/K,
  `]`, ⌘U, ⌘1–9 (ui-design §10), но заголовков и подписей для них в каталоге не было:
  `palette.group.accounts`, `palette.group.navigation`, `palette.group.online`,
  `palette.empty` («ничего не найдено» — состояние `empty` палитры),
  `palette.foot.hostOnly` (подвал, когда данные хаба не участвовали в поиске: палитра
  обязана говорить, где искала, §6.9), `cheatsheet.group.navigation`,
  `cheatsheet.row.fanPanel`, `cheatsheet.row.quickJump`, `toast.splitOn`,
  `toast.splitOff` (HK-011: Split — переключатель с тостом), `toast.noUnread` (⌘U,
  когда непрочитанных в загруженном списке нет). Только новые ключи: схемы, типы и
  смысл существующих не менялись, фикстуры не нужны (ключ без текста в любом из двух
  каталогов не проходит проверку типов).
- **Ключ причины «курсор в поле»** — `dock.reason.keyInField` (правка по ревью R17).
  В открытом чате расширение забирает все свои сочетания, даже когда выполнить их
  нельзя, и говорит причину (HK-026). Для двух случаев слов не было: ⌘U и ⌘1–9, пока
  человек печатает (иначе Firefox открывает исходный код страницы или переключает
  вкладку), и AI-сочетание в постороннем поле сайта. Тост — обычное «{действие}
  недоступен: {причина}». Только ключ и два текста; нового id причины в
  `UNAVAILABLE_REASONS` нет, поэтому перечисления у потребителей не меняются.

### R14 — док и оверлеи (`ui/dock`, `ui/overlays`)

- **Действие `ShowAnalysis { view: 'recap' | 'review', mode: 'sheet' | 'expanded' |
  'hidden' }`** (`ANALYSIS_VIEWS`, `ANALYSIS_MODES`). Recap и Review следуют за
  открытым чатом и могут не иметь операции: сохранённый Recap приходит из хаба,
  `RecapViewVM.opId` у него `null`. `HideResult` и `ExpandResult` называют операцию
  и такой вид закрыть или развернуть не могут, хотя `RecapViewVM.expanded` и
  `ReviewVM.expanded` в моделях уже есть. Новое действие: `sheet` — показать в листе
  дока (кнопка Recap в полосе; если сохранённого нет — выбор «Собрать коротко /
  полностью», AI-060), `expanded` — «Развернуть ↗» в окно (UI-014), `hidden` —
  «Скрыть Esc» (вид сохраняется). Само ничего не генерирует. Фикстуры: верная и
  три неверных в `UiAction`.
- **Шесть ключей i18n** для мест, которых не было в макете (ui-design §10):
  `result.expand`, `result.collapse` («Развернуть ↗» и «Свернуть», UI-014),
  `review.example` («Как надо было», AI-053), `coach.attachDraft` («Приложить мой
  ответ», AI-091), `coach.sentToCoach` («Отправлено Coach…», AI-093),
  `coach.memoryBoundary` (граница памяти Coach, AI-094). Тексты — в каталогах
  `ru` и `en`.
- **Семь ключей i18n после ревью R14** (тексты — в каталогах `ru` и `en`):
  - живой регион (ui-design §6.2, §5.3): `result.announce.stage` («{action}:
    {stage}» — смена этапа), `result.announce.ready` («Ответ готов: {n} части», с
    множественным числом), `result.announce.retryIn` («Повторить можно через {n}
    секунды», с множественным числом — начало отсчёта до повтора) и
    `result.announce.canRetry` («Можно повторить» — его конец);
  - строка несохранённого Recap (ui-design §4.11, §5.5): `cg.recapSave.line` («не
    сохранено в хаб»), `cg.recapSave.action` («Сохранить ещё раз») и
    `cg.recapSave.actionTooltip` («Записать в хаб ещё раз; AI не запускается»). До
    этого строка брала заголовок реестра и «Повторить», что читалось как новая
    генерация.
- **`CoachTurnVM.confirm?` и `CoachTurnVM.debug?`** (необязательные). Вопрос Б2
  («в поле уже есть ваш текст») для части черновика Coach (AI-086):
  `DockVM.result.confirm` принадлежит операции дока и вопрос хода Coach нести не
  может, поэтому «Вставить» в непустое поле у Coach молча ничего не делала.
  `confirm.part` называет часть так же, как её `PartVM` (`variant` — черновик, когда
  их два). `debug` — подвал отладки хода (DB-019), та же `ResultDebugVM`, что у
  результата дока. Фикстуры — `COACH_TURN_VM_SAMPLES` (тип без схемы: неверные
  значения отвергает компилятор).
- **`RefusalVM.at?`** — момент отказанного запуска (эпоха, мс). Операции у отказа
  нет, поэтому «Скрыть» прячет его только в интерфейсе; новый отказ с тем же чатом,
  функцией и кодом (четвёртая генерация по хоткею) без этого поля неотличим от
  спрятанного и не показывался. Фикстуры — `REFUSAL_VM_SAMPLES`.
- **`CgErrorView.tone?: 'failure' | 'state'`** (`CG_ERROR_TONES`, `CgErrorTone`) —
  точка карточки ошибки (ui-design §4.8): красная или кольцо. Решает тот, кто
  собирает вид из реестра; интерфейс больше не обязан держать свой список кодов.
  Пока поле не заполнено, поверхность читает §4.8 сама (у дока — `errorToneOf`).
  Фикстуры: два верных и один неверный `CgErrorView`.
- **`I18n.formatTimeIn?(at, timeZone, style?)`** — время в названной зоне IANA,
  необязательный метод порта (как `formatMoneySpoken` в 1.1.0). Квота AI обновляется
  в 00:00 UTC, и подсказка нулевой квоты говорит «Обновится в 03:00 по Москве»
  (ui-design §4.1): это время печатается в `Europe/Moscow`, где бы ни сидел чаттер.
  До этого оно шло в зоне порта (местной), и чаттер вне Москвы читал неверное
  московское время. Неизвестная зона — `—`; порт без метода умеет только свою зону.
  Реализация — `core/domain/i18n`. Фикстуры — `ZONED_TIME_SAMPLES`.

### R15 — доски, превью, «Новые», панель фана, палитра

- **49 ключей i18n** (46 текстов и 3 с множественным числом) для того, что
  `ui-design.md` рисует или требует в §10, а в каталоге 1.1.0 названо не было.
  Три из них добавлены после проверки R15: `stats.regionLabel`,
  `newcomers.greetingDraft.placeholder`, `newcomers.greetingDraft.aria`.
  Тексты ru/en — в `core/domain/i18n`; фикстура — `BOARDS_I18N_KEYS`.
  - **Доска Spenders:** `spenders.col.lifetimeShort` («Всего» в колонке списка
    ≤ 620 px, §3.5); подпись полки по границам корзины хаба —
    `spenders.shelf.from` («$600+»), `spenders.shelf.range` («$350–600»),
    `spenders.shelf.none` («вне полок», SP-008); обрезка на 1000 строк —
    `spenders.truncated`, `spenders.truncatedNoTotal` (SP-021); подвал, когда
    общее число фанов неизвестно, — `spenders.footerNoTotal`.
  - **Статистика:** `stats.newPayersObserved` — «первая наблюдённая покупка»
    при неполном прошлом (SP-048); `stats.regionLabel` — имя области
    «Статистика Spenders» для экранного диктора (`ui-design.md` §6.1; на экране
    заголовок остаётся «Статистика»).
  - **Превью:** `preview.metaOurUnknown`; `preview.notOpenedAfterSendTooltip`
    (§4.16); лента архива — `preview.feed.label`, `.fanPrefix`, `.deleted`,
    `.automatic`, `.priced`, `.notBought`, `.older` (SP-053, NF-010); сегмент
    Ping — `preview.ping.segment`, `.segmentNoDays`, `.active`, `.unknown`
    (AI-038); `send.unavailableReason` — «Отправка недоступна: {reason}» в
    строке кода (§4.13).
  - **«Новые»:** `newcomers.claim.mine` (своя бронь с отсчётом; у брони
    коллеги отсчёта нет, §12 п. 5), `newcomers.incomplete` (NF-025),
    `newcomers.draft`, `newcomers.draftStale` (NF-012, NF-018),
    `newcomers.scanProgress` (NF-008), `newcomers.window.label` (NF-003);
    поле черновика приветствия в карточке — `newcomers.greetingDraft.placeholder`
    («Черновик приветствия. Остаётся здесь, в чат не уходит» — его модель
    карточки отдаёт в `PreviewVM.draft.placeholder` вместо текста про Fix) и
    `newcomers.greetingDraft.aria` (имя поля; NF-012, `ui-design.md` §10).
  - **Панель фана:** `fanPanel.subscribedLabel`, `.subscribedValue`,
    `.subscribedMonths`, `.subscribedSince` (строка «ключ — значение» вместо
    одной фразы `fanPanel.subscribed`, §4.18); значения риска ухода
    `fanPanel.churn.low|medium|high|unknown`; `fanPanel.byKind.posts`,
    `.other` (виды трат модели `FanPanelVM`); `fanPanel.subOnline`,
    `.lastSeen`, `.online`; `fanPanel.buyingPower` (оценка ChatSpace, §10);
    `fanPanel.recap.archivePartial`; подвал при неполном охвате —
    `fanPanel.footerCoverage`.
  - **Палитра и быстрый переход:** `palette.partial` (не все списки
    загружены), `quickJump.unread`.

### R16 — страницы расширения (popup, настройки, вход, отладка)

- **Ключи i18n страниц** (`UI_TEXT_KEYS`, блок «Extension pages»): тексты popup,
  экрана входа, оболочки настроек и восьми её разделов, чек-листа первого запуска,
  страниц промпта и журналов — `popup.*`, `signIn.*`, `settings.*`, `debugPage.*`.
  Тексты — в `core/domain/i18n` (ru и en).
- **Запрос `tab.command`** (страницы popup и options): клик на странице расширения,
  который исполняется во вкладке ChatSpace. `PageCommand` — `{ kind: 'surface',
  surface: 'spenders' | 'newcomers' | 'cheatsheet' }` (кнопки popup, PU-017) или
  `{ kind: 'account', host, hostAccountId }` («к вкладке» в «Аккаунтах», Б13,
  ST-076). Ответ — `delivered`. До 1.2.0 у страницы не было способа открыть окно
  внутри ChatSpace или перейти к аккаунту: `UiAction.Navigate` с такими целями
  некому было исполнить. Исполняет фон (R10) и вкладка (R11): вкладку выводят
  вперёд, команда приходит ей как действие человека.
- **Запрос `data.clear`** (только страница options): «Очистить локальные данные»
  (ST-110). Тело — `{ confirmed: true }` литералом, ответ — `cleared`. Исполняет
  фон: чистит кэши и журналы, вход и настройки не трогает.
- **`DiagnosticsSnapshot.footprint?`** — `{ cachesKB, logsKB }`: размер наших кэшей
  и журналов для раздела «Диагностика» (ST-110). Нет поля — страница показывает
  размер журнала из `logs.bytes`, про кэши пишет «неизвестно».
- **`DiagnosticsSnapshot.extension.updated?`** — `{ at, from, staleTabs }`: когда
  эта версия сменила прежнюю и какую (`runtime.onInstalled`, причина `update`), и
  сколько вкладок ChatSpace ещё работают на старых скриптах (`null` — не считали).
  Это строка «Статуса» «Обновилось сегодня в 09:02 с 0.4.2. Вкладки перезагружены.»
  (ui-design §4.24) и просьба перезагрузить вкладки (UP-009). Нет поля — в строке
  только версия.
- **`OptionsVM.footer?`** — `{ whatsNew, changelog, unseenNotes }`: подвал под
  списком разделов (ST-005) — «Что нового» и «История версий» действиями страницы
  (`null`, если сборка не знает адреса) и пометка «нов.», пока заметки этой версии
  не открывали. Фикстуры — `OPTIONS_FOOTER_SAMPLES`.
- **Ключи i18n после ревью страниц** (тот же блок `UI_TEXT_KEYS`): фильтры, страницы
  и автообновление журнала (`debugPage.journal.filterAll`, `.filterNone`, `.matched`,
  `.page`, `.prev`, `.next`, `.auto`; NF-029), подсказка «в настройках N, хаб возьмёт
  не больше M» (`settings.generation.deepOver`, ST-093) и подпись строки справочника
  с заглавной буквы (`settings.hotkeys.row.variant`, ST-120).
- **`AccountBodyVM.hub.hostPermission: 'unknown'`** — третье значение рядом с
  `granted` и `missing`: браузер ещё не ответил про доступ к адресу хаба на экране
  (или ответил про другой адрес). Раньше неизвестное показывалось как «разрешён»
  (ST-043). Потребитель — только страница настроек R16. Фикстуры —
  `ACCOUNT_HUB_SAMPLES`.
- **Карта паритета: владелец строк DB-012, DB-013, DB-019, DB-020 — R14** (было R16;
  порядок пакетов в строке `R14 · R16 · R18`, манифест перегенерирован). Живой таймер
  этапов, профиль в результате, отладка ходов Coach и «отладки нет в свёрнутом доке» —
  это подвал результата в доке (`ui-design.md` §4.12, §8.5), его рисует R14. На
  страницах расширения этих блоков нет; от R16 в этих строках — переключатель режима
  отладки и страница промпта, куда ведёт «Промпт». Цели и проверки строк не менялись.
  Предложение исполнителя R16 по замечанию ревью — нужно согласие координатора.

### Сведение волны 2 (интегратор)

- **Итог версии.** Запросов вкладки и страниц — 49 (было 45: `recap.save`,
  `send.list`, `tab.command`, `data.clear`), событий — 11, как было; действий
  `UiAction` — 58 (было 57: `ShowAnalysis`); ключей i18n — 1226 (было 869;
  добавлено 357: 352 текста и 5 с множественным числом — у R11 22, у R12 3, у
  R17 12, у R14 13, у R15 49, у R16 258, один добавлен при сведении, а
  `newcomers.incomplete` был и у R12, и у R15). Остальное — необязательные поля,
  значение `hostPermission: 'unknown'` и необязательный метод порта
  `I18n.formatTimeIn`. Все фикстуры веток сохранены.
- **`CoachTurnVM.confirm?`** добавили и R11, и R14 — одним и тем же объявлением;
  в контрактах это одно поле (рядом — `debug?` от R14).
- **Ключ `newcomers.incomplete.body`** (`contract-change` интегратора). R12 и R15
  добавили один ключ `newcomers.incomplete` с разным смыслом. У R15 это заголовок
  «Результат неполный»: окно «Новых» печатает его само, жирным, а следом — причину
  из `NewcomersVM.incomplete` (так поле и описано в контракте: «Результат
  неполный» и почему).
  У R12 это был весь текст вместе с заголовком, и контроллер клал в
  `NewcomersVM.incomplete` тот же ключ: на экране заголовок стоял бы дважды.
  Теперь `newcomers.incomplete` — только заголовок, а причина — новый ключ
  `newcomers.incomplete.body` («Показана часть списка. Хаб ещё не собрал всех,
  кто подписался за это время.»; строка паритета NF-025: «Результат неполный» /
  «Показана часть списка…»). Поле `NewcomersVM.incomplete` и его смысл не
  менялись. Фикстуры — `NEWCOMERS_INCOMPLETE_SAMPLES`.
- **Нумерация решений `protocols/ui-contract.md`.** И R17, и R14 записали своё
  решение под номером 12. У R17 номер остался (на него ссылается код), решения
  R14 — 13 и 14.
- **Карта паритета.** Перенос строк DB-012, DB-013, DB-019 и DB-020 на R14
  (предложение R16, см. выше) пришёл с веткой и оставлен: проверки с этими
  номерами у R14 есть (`packages/testing/src/dock/result.test.tsx`,
  `dock/analysis.test.tsx`, `overlays/coach.test.tsx`,
  `overlays/expanded.test.tsx`), `pnpm parity` проходит. Согласие координатора
  по-прежнему нужно.

### Подключение вкладки (интегратор)

- **Запрос `settings.open`** (`contract-change` интегратора; ST-006…ST-010).
  `{ route: SettingsRoute }` → `{ opened }`, только от вкладки ChatSpace.
  «Настройки» во вкладке — кнопка баннера дока («вход не выполнен», «нет
  персоны»), кнопка карточки ошибки или тоста, клавиша ⌘, — отправляют действие
  `OpenSettings` с маршрутом (раздел и код). Контент-скрипт страницу расширения
  открыть не может, запроса для этого в протоколе не было, и кнопка ничего не
  делала. Фон находит открытую вкладку настроек или открывает новую на
  `options.html#<раздел>:<CODE>`; `opened: false` — браузер отказал. Маршрут —
  только раздел настроек и код CG: адрес или произвольную строку вкладка
  передать не может. Запросов стало 50. Фикстуры — в `TAB_REQUEST_FIXTURES`.

### Подключение фона (интегратор)

- **Событие `tab.command`** (`contract-change` интегратора; PU-017, ST-076, Б13).
  `{ command: PageCommand }`, только вкладке ChatSpace. У запроса `tab.command`
  (R16) не было второй половины: фон мог вывести вкладку вперёд, но передать ей
  команду было нечем — событий с командой в протоколе не было. Теперь фон шлёт
  выбранной вкладке событие с той же командой, что пришла со страницы: открыть
  Spenders, «Новых» или шпаргалку клавиш, перейти к аккаунту. Событие уходит одной
  вкладке и только по запросу popup или страницы настроек. Вкладка исполняет его
  как переход по клику человека; вставку, отправку или генерацию такая команда
  начать не может — в ней нет ни чата, ни текста, ни токена действия. Событий
  стало 12. Фикстуры — в `TAB_EVENT_FIXTURES`.

### Подключение страниц (интегратор)

- **Запрос `debug.open`** (`contract-change` интегратора; DB-006, DB-007).
  `{ token }` → `{ opened }`, только от вкладки ChatSpace. В режиме отладки у
  результата в доке есть кнопка «Промпт»: она отправляет действие `Navigate` с
  непрозрачным токеном снимка промпта, а сам промпт показывает страница
  расширения `debug-prompt.html?t=<токен>`. Контент-скрипт страницу расширения
  открыть не может, запроса для этого в протоколе не было, и кнопка ничего не
  делала. Теперь фон открывает страницу промпта (или переводит уже открытую на
  новый токен). Во вкладку по-прежнему не попадает ничего, кроме токена: текст
  промпта читает только сама страница запросом `debug.prompt`. `opened: false`
  — отладка выключена или браузер отказал. Запросов стал 51. Фикстуры — в
  `TAB_REQUEST_FIXTURES`.

### Исправления после проверки сборки (интегратор)

- **Ключи `spenders.refresh`, `spenders.refreshTooltip`** (`contract-change`
  интегратора; SP-024 «Refresh (бесплатный)»). «Обновить» в подвале доски
  Spenders и развёрнутой статистики: перечитать данные хаба в обход кэша доски
  (10 минут). Контроллер это действие умел (`ReloadView` для `spenders.board` и
  `spenders.stats`), но кнопки не было — до неё добиралась только карточка
  ошибки, и у исправной доски «Ждут ответа», «Мы писали / Фан писал» и суммы
  могли быть на 10 минут старше хаба. Подсказка говорит, что это чтение, а не
  генерация: «Перечитать данные хаба. AI не запускается». Ключей i18n стало
  1228. Действие, модели видов и запросы не менялись.
- **Ключ `fanPanel.spentNone`** (`contract-change` интегратора; ui-design §1 п. 6
  «известный ноль не рисуется»). Панель фана печатала «Потратил всего $0» и
  «Сообщения $0» для фана, который ничего не потратил. Известный ноль суммы
  теперь не рисуется: строки видов с нулём пропадают, а под «Потратил всего»
  стоит слово «трат нет» — пустое место под подписью читалось бы как сбой, а
  «—» значит «неизвестно». Ключей i18n стало 1229. `FanPanelVM` не менялся.

## 1.1.0 — 2026-10-03 (волна 1: R08, R09, R13, R18; добавочное)

Одна минорная версия на всю волну 1: добавочные изменения (`contract-change`)
нескольких пакетов работ, сведённые интегратором в одну запись. Старые
потребители не ломаются: новые поля и методы необязательные, новые проверки,
запросы и ключи только добавлены.

### R08 — фасад хаба

- **`HubCheckError`** (`hub/facade.ts`) — второй вид отказа фасада: хаб не
  спрашивали или его ответ не читается как ошибка хаба, отказал сам слой хаба
  (`pending` при входе, полный токен вместо узкого, нет bootstrap, нет
  возможности, флаг выключен, страница не выдана, чужая персона в `meta`…).
  Поля: `check` (имя проверки), `code` (= `HUB_CLIENT_CHECK_CODES[check]`),
  `route`, `epoch`, необязательный `reason` (открытая лексема причины
  страницы). Отличается от `HubCallError` по `name`: `isHubCallError`,
  `isHubCheckError`.
- **`HubCallError.resolution?`** — готовое прочтение ошибки фасадом
  (`ResolveHubError` по фактам, которые есть только у него: страница в
  bootstrap, кадры уже пришли, повтор AI уже потрачен, действие брони, поиск
  фана). Без него потребитель не знает, что единственный повтор 503 уже
  сделан, и мог бы повторить второй раз.
- **Новые проверки** в `HUB_CLIENT_CHECK_CODES`: `notSignedIn`
  (CG-AUTH-REQUIRED), `hubOriginMismatch` (CG-AUTH-REQUIRED), `hubUrlInvalid`
  (CG-HUB-URL), `bootstrapMissing` (CG-HUB-OUTDATED), `authUnreadable`
  (CG-STORAGE-READ), `authWriteFailed` (CG-STORAGE-WRITE), `boardTimeout`
  (CG-DATA-TIMEOUT), `previewSendOff` (CG-SEND-OFF: `dispatch` при выключенном
  или недоступном на странице `previewSend` — так же, как хаб читает свой отказ
  `dispatch`); список имён `HUB_CLIENT_CHECKS`, тип `HubClientCheck` и
  схема `HubClientCheckSchema` (с фикстурами).

### R09 — адаптер ChatSpace

- **Отмена «Открыть и вставить» (§6.5).** `HostPort.navigate(intent, options?)`:
  необязательный `options.signal` (часть `AbortSignal`, `NavigateOptions`). R10
  прерывает его при выходе, смене персоны или привязки и при закрытии превью:
  отложенная вставка не пишется, если ещё не записана, вставка в квитанции —
  `CG-INSERT-CANCELED`; сам переход не отменяется. В мосте — новый запрос
  `cancelInsert {intentId}` → `{canceled}` (не запись, обычный срок 2 с; может прийти
  раньше своего `navigate`). Фикстуры: верная и неверная для запроса и ответа.
  Без этого MAIN дописывал вставку до её срока, хотя расширение её уже отменило.
  Добавление: старые реализации `HostPort` (`FakeHostPort`) остаются верными.

### R13 — `ui/kit`

- **`ToastVM.detail` и `ToastVM.retryAt`** — необязательные поля тоста ошибки:
  техническая строка «HTTP 429 • …» (не длиннее `CG_DETAIL_MAX_CHARS`) и срок
  повтора, зафиксированный один раз (эпоха, мс). Строка паритета ER-010 требует у
  тоста ошибки «код, описание, таймер, техническая строка», как у карточки ошибки
  (ER-005…ER-007); до 1.1.0 в модели тоста их не было. Контроллер тостов (R18)
  берёт их из `CgErrorView`; без них тост выглядит как раньше. Фикстуры —
  `TOAST_VM_SAMPLES` (тип без схемы: неверные значения отвергает компилятор).
- **Суммы словами для экранного диктора** (ui-design §6.2: «+$320» читается как
  «плюс 320 долларов»): необязательный метод порта `I18n.formatMoneySpoken` (у
  порта без него сумма читается как напечатана) и три ключа i18n —
  `common.money.plus`, `common.money.minus` и `common.money.dollars` (с
  множественным числом). Фикстуры — `SPOKEN_MONEY_SAMPLES`.

### R18 — ошибки, логи, отладка, телеметрия

- **`OpDebugView`: `model` и `hubStages`** (необязательные). Блок отладки
  результата (`ResultDebugVM`) показывает модель в строке «$» (DB-017) и этапы хаба
  «хаб: context · provider · stream» (DB-016), но вид операции, который фон
  отдаёт вкладке, их не нёс: `stages` — только метки клиента. Теперь фон кладёт
  имя модели из `meta` и длительности этапов хаба из манифеста промпта. Старые
  получатели поля просто не читают.

## 1.0.0 — 2026-10-03 (R01, тег `contracts-v1.0`)

Первая заморозка: пакет работ R01 (части 1, 2a, 2b, 2c и интеграция). Заморожено
всё, что `architecture.md` §16 перечисляет для R01:

1. **Идентичности (§5.1):** три пространства id, которые не смешиваются (хост,
   платформа, хаб), одна форма числовых id `^[1-9]\d{0,29}$`, `ChatRef`, `ChatKey`,
   `HubBinding`, `Target`, `GenerationIdentity`, `PartRef`; деньги — целые mills,
   `null` — «неизвестно».
2. **`HostPort` и `PreviewSendPort` (§5.2):** возможности и якоря ChatSpace,
   вставка и навигация с квитанциями, хвост переписки, X8 — точка свежести, билет,
   preflight и commit, состояния попытки и их переходы, журнал отправок.
3. **Мост MAIN ↔ изолированный мир (§5.3):** конверт, пределы кадра, 15 запросов в
   MAIN и 9 сообщений из MAIN, три ступени проверки.
4. **Протокол вкладки и страниц с фоном (§5.4):** 45 запросов и 11 событий,
   правила отправителей, ответы данными хаба.
5. **Операции и допуск (§5.5, §7):** состояния и переходы, фазы, допуск (1 на чат,
   3 на вкладку), результаты Reply/Fix/Hi/Ping/Review/Recap/Coach, охват,
   `ServedContext`, `OP_TIMEOUTS`.
6. **UI (§10.2):** `AppClient`, 18 моделей видов с семью состояниями, 57 действий
   `UiAction` (строгие схемы), `ActionCatalog` (29 команд, 34 причины
   недоступности), порты UI, токены темы.
7. **Фасад хаба (§5.8, §8):** `HubFacade`, DTO всех маршрутов H-*, 24 операции в
   `HUB_ROUTE_SCHEMAS`, таблица «флаг → возможности», карта ошибок хаба → CG,
   переходы опеки H-7.
8. **Реестр CG (прил. А):** 107 кодов в порядке приложения, вид, тяжесть,
   восстановление, повтор, класс телеметрии, раздел настроек.
9. **Настройки v1, телеметрия, ключи i18n, подделки:** схема настроек со
   значениями по умолчанию; события `ai_acceptance` и `client_health` с
   фиксированными границами; 866 ключей (632 текста, 20 с множественным числом,
   заголовок и пояснение каждого кода CG) для `ru` и `en`; сценарии поддельного
   хаба (21 поток, 12 HTTP), поддельного `AppClient` (48 сценариев, включая
   все состояния X8) и поддельного `HostPort` (17 сценариев, включая X8).

Вместе с заморозкой:

- **Манифест паритета** `docs/parity/parity-manifest.json`: 810 строк, у каждой
  владелец и проверка; 20 отрицательных проверок для строк «не нужно» и «убрано
  владельцем». `pnpm parity` теперь падает без манифеста.
- **Решения интеграции** (подробно — [protocols/README.md](protocols/README.md)):
  ключи i18n типизированы во всех частях; одно слово — один модуль-владелец;
  `ServedContext` по `context_v1` (`live_union` и блок `live`); `spenders.stats` —
  только окно 30 дней; `SEND_REASON_KEYS`; тоны латиницей и бронь коллеги без
  отсчёта по итоговому `ui-design.md`.

### Правки по ревью R01 (до тега, версия та же)

Тег `contracts-v1.0` ещё не стоит, поэтому правки вошли в 1.0.0, а не в 1.1.0.
Подробности и причины — [protocols/README.md](protocols/README.md), «Решения ревью».

- **Пределы как у хаба.** Вопрос Coach и вопрос в истории — до 2000 символов
  (AI-082, `chatterQuestion`), окно сообщений — от 5 (`messageCount`), ключ
  персоны — до 120, `definitionId` — 16–100, вход — логин до 100 и пароль до 1024.
  `op.list` со `scope: 'all'` — до 200 операций и признак `truncated`. Общие числа —
  в `limits.ts` (`AI_REQUEST_LIMITS`, `COACH_LIMITS`, `SIGN_IN_LIMITS`; туда же
  переехали `PART_LIMITS`, `LIVE_TEXT_LIMITS`, `OP_TIMEOUTS`).
- **X8 — строка «Отправить» без догадок.** Новый код `CG-SEND-HISTORY` (условие 7
  §6.7.4). `PREVIEW_SEND_CONDITION_CODES` — коды preflight и `held`; `notEnqueued` —
  только `CG-SEND-QUEUE`, `uncertain` — только `CG-SEND-UNCERTAIN`, просроченный
  билет — `held` с `CG-TIMEOUT`. `SEND_REASON_KEYS` покрывает все условия и отказы
  `dispatch` хаба. `previewSendStateOf` — одно сопоставление попытки и preflight
  со строкой. `isRetryableEnd`: удержание по свежести, части, контексту, чужой
  опеке и брони коллеги новым кликом не снимается. `SendAttemptView.httpStatus`
  (4xx кроме 401) вместо поля в `send.report`. `SEND_CUSTODY_REPORTS` — что фон
  сообщает опеке H-7; `localDeadline` — срок билета и брони по часам хаба.
  Правила X8 без zod — в новом лёгком модуле `send-rules`.
- **Инварианты отправки в схемах.** Часть принадлежит группе (вариант, без
  варианта — 0; номер меньше числа частей); точка свежести — от целевого чата и
  этого документа; одна `GenerationRefSchema` (UUID `meta.requestId`). Части в v1
  не редактируются: `textRevision` = 0.
- **Запись — по токену.** `InsertIntent` несёт `cause`; новый запрос
  `token.redeem` тратит токены `insert` и `navigate`, в MAIN уходит `InsertWire`
  без токена. `expected` у вставки — `open` (CAS) или `deferred` («Открыть и
  вставить»: только в пустой или наш черновик, иначе подтверждение). `thenInsert` —
  только к чату навигации и только отложенный. `BRIDGE_WRITE_FAILURES`: запись,
  которая могла выполниться, — неизвестный исход, без повторной отправки.
- **Отправка человеком** несёт черновик на момент очереди (`SentDraft`: ревизия,
  происхождение, наше намерение вставки, правка после него).
- **`HostPort.checkpoint` и `PreviewSendPort.preflight` асинхронные:** данные есть
  только в MAIN, мост асинхронный.
- **Свежесть — набор id.** Точка свежести несёт `knownFanMessageIds` (до 10, новые
  первыми), тело H-4b — `knownFanMessageIds`, кадр `context_v1` и `ServedContext` —
  `knownFanMessages[]`; удержание снимается, только когда включены все
  (`servedContextCovers`). Это меняет одиночное поле плана хаба §4.10.3.
- **Привязка знает свой аккаунт OM:** `HubBinding.host` и `.hostAccountId`,
  `Target` требует, чтобы они были аккаунтом чата; `platformAccountId` — значение
  страницы.
- **Данные для моделей видов:** `quota.get` и событие `quota.changed`; полки доски —
  `SpendersBoard.tiers` (корзины хаба); `fan.dossier`; `fan.card` с периодом;
  `feed.read` с `summaryWindow`; `journal.read`, `usage.get`, `accounts.seen` и
  хранилище `presence`; хэш SDK и совместимость в диагностике; счётчик «Новых» в
  popup. `settings.patch` больше не меняет адрес хаба и отладку — для них
  `settings.patchRestricted`, только со страницы настроек.
- **Модели видов:** `FeedItemVM.at` и `.automatic` могут быть `null`; бронь без имени
  держателя — `claim-other` и новый `claim-elsewhere` (вы в другой вкладке);
  источники панели фана названы (`HostFan.lastSeenAt`, `insights`, `bio`, `lists`;
  риск ухода — из статуса удержания хаба).
- **Логи и настройки:** правило вымарывания по имени и окончанию поля (+ `ticket`,
  `secret`, `apikey`), предел записи 8 КиБ и 4 КиБ от вкладки; заглушённые аккаунты
  и подписи — по ключу `хост:аккаунт`, выбор персон — со своим хабом и
  пользователем.
- **Подделки:** `@cg/testing/host` — `FakeHostPort` и 17 сценариев (вставка,
  навигация, все условия и пути X8, отправка человеком, деградация контракта);
  `@cg/testing/hub` — свой подпуть.
- **Размер:** `tab.register` — в лёгком `tab-protocol`; `pnpm size` меряет четыре
  среза контрактов (ранний старт 12 КиБ, пределы 2 КиБ, `UiAction` 16 КиБ, реестр
  протокола вкладки 28 КиБ).

Приёмка R01 по §16 ещё требует подписей владельцев пакетов R07–R18 — их собирают
на PR.
