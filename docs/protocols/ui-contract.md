# Контракт UI (`@cg/contracts/vm`) и поддельный `AppClient`

Пакет работ R01, часть 2a: `architecture.md` §10.1–§10.2 плюс итоговая спецификация
интерфейса `docs/ui-design.md` (направление B «полоса», X10), включая правки контрактов
её §9.3 и мелочи §12.

## Где что

| Модуль `packages/contracts/src/vm/` | Что внутри |
|---|---|
| `view.ts` | `VmView` — семь состояний (`loading`, `ready`, `empty`, `partial`, `error`, `forbidden`, `offline`) с причиной у каждого; `DataStamp` (время данных и охват), `ActionButtonVM`, `RunningOpVM` |
| `selectors.ts` | `ViewSelector`, ключ подписки `selectorKey`, непрозрачные хэндлы, поверхности монтирования |
| `actions.ts` | `UiAction` (строгие схемы zod/mini), `UserOptions` (разрешённый список), `PreferenceKey` с типом значения по пути в `SettingsV1`, `NavigationTarget` |
| `catalog.ts` | `ActionCatalog`, `HotkeyLabel` (подпись, `aria-keyshortcuts`, доставка, запасная клавиша), причины недоступности с ключом i18n и кодом CG |
| `i18n.ts` | порт `I18n`: `t`, `plural`, `formatMoneyMills`, `formatAge`, `formatTime`, `formatDuration`; `Msg` — ключ с параметрами |
| `theme.ts` | имена токенов `--cg-*` (ровно список ui-design §2.2), сигнал схемы, атрибут `data-cg-scheme` |
| `result.ts`, `dock.ts` | `ResultVM`, `PartVM`, `PreviewSendView` (девять состояний) и `previewSendStateOf` (попытка и preflight → состояние), `DockVM` |
| `analysis.ts` | `RecapPickerVM`, `RecapViewVM`, `ReviewVM`, `CoachVM` |
| `spenders.ts`, `preview.ts`, `newcomers.ts` | доска и статистика, превью, «Новые» с бронью |
| `panels.ts`, `pages.ts` | панель фана, палитра, быстрый переход, шпаргалка, тосты; popup, настройки по разделам, эхо промпта, журналы |
| `app-client.ts`, `ports.ts` | `AppClient`, `ViewOf`, `ActionReceipt`; `MountPort`, `ToastPort`, `ClipboardPort`, `DialogPort`, метки отрисовки, `resultCap` |

Поддельный клиент и сценарии — `packages/testing/src/scenarios/app-client/`, подпуть
`@cg/testing/app-client`. Поддельный `HostPort` для контроллеров —
`@cg/testing/host` (`packages/testing/src/scenarios/host/`).

## Решения

1. **Семь состояний у каждой модели.** `VM_STATE_SUPPORT` перечисляет, какие из них
   выдаёт контроллер вида. Все, кроме трёх, выдают все семь; быстрый переход и
   шпаргалка не зависят от хаба (нет `forbidden`/`offline`), тосты — только `ready`/`empty`.
2. **Свои слова — `Msg`, чужие данные — строки.** Деньги, возраст и время лежат в
   моделях сырыми (`MoneyMills`, ISO, мс) и форматируются только портом `I18n`.
3. **UI не собирает цель.** Он держит непрозрачные хэндлы и номера операции, варианта и
   части; `UiActionSchema` строгая, поддельный клиент отвергает лишний ключ (`persona`,
   `model`) ошибкой `ContractViolation`.
4. **Отправка — только кнопкой.** Действий «отправить всё» и «следующую сама» нет;
   «Отправить ещё раз» рисуется только по `rejected.canRetry`.
5. **Предел листа** считает `resultCap` по высоте ленты `H` из `MountPort` и зазору
   «на подложке» (ui-design §3.2); примеры спецификации — в тесте.
6. **Настройки v1:** добавлены `ui.resultStyle` (`bare` по умолчанию) и
   `onboarding.keysFooter`. Схема v1 ещё не выпущена, шаг миграции не нужен.
7. **Имя страницы для показа — `pageName`**, чтобы не путать с ключом хаба `pageLabel`.
8. **Бронь коллеги без отсчёта** (ui-design §12 п. 5); блоки Review — по AI-053 и формату
   хаба (§12 п. 6); тоны — набор паритета Casual, Flirt, Sell, Spice (id из `Tone`).
9. **Слова — общие с остальными частями** (интеграция R01): `Msg.key` — `I18nKey`
   из каталога, язык порта — `Locale`, тема и «Вид ответа» — типы `settings`, охват —
   `CoverageLevel` из `ops`; причина «Отправить» берёт текст из `SEND_REASON_KEYS`;
   статусы приветствия — `GREETING_STATUSES`. Поддельный клиент строит ошибки через
   настоящий реестр CG и каталог ru/en.
10. **Ревью R01.** Строку «Отправить» строит `previewSendStateOf` — одна таблица
    для контроллеров превью и «Новых». Хаб не называет держателя брони: у
    приветствия и брони есть «коллега» (`claim-other`, `other`) и «вы в другой
    вкладке» (`claim-elsewhere`, `elsewhere`, Hi выключен), имени нет — тексты без
    `{name}`. `FeedItemVM.at` и `.automatic` бывают `null` («неизвестно»). У панели
    фана названы источники: деньги и подписка — `fan.card`, «был N назад», био,
    списки и оценки ChatSpace — `HostFan`, риск ухода — статус удержания строки доски.
11. **Хосты монтирования ChatSpace (R09, `@cg/host-chatspace`).** Хост оверлея
    (`mounts.overlay('panel' | 'modal' | 'toast')`) — на весь экран
    (`position: fixed; inset: 0`) и **пропускает клики** (`pointer-events: none`),
    чтобы пустая часть слоя не закрывала ChatSpace. Панель, окно или тост внутри
    закрытого корня сами ставят себе `pointer-events: auto`, иначе клики проходят
    сквозь них. Док (`mounts.dock`) — в потоке над composer, кликается как есть.
    `HostPort.chatWindow(chat, max)` у ChatSpace считает по всему, что ChatSpace уже
    загрузил (не больше 200 сообщений): `max` не сужает окно.

12. **Recap и Review без операции (1.2.0, R14).** `ShowAnalysis { view, mode }`
    открывает вид в листе дока (`sheet`), разворачивает его в окно (`expanded`,
    UI-014) или скрывает (`hidden`). `HideResult` и `ExpandResult` называют
    операцию, а у сохранённого Recap её нет (`RecapViewVM.opId = null`). Кнопка
    Recap в полосе шлёт `ShowAnalysis { view: 'recap', mode: 'sheet' }` и ничего
    не генерирует: генерация — только кнопками выбора (`RecapPickerVM.build`) и
    «↻ Обновить».

## Сценарии

Тест целостности проверяет: каждая тема §10.2 п. 7 покрыта, каждый вид достигает каждого
своего состояния, все девять состояний «Отправить», все статусы дока (оба кода
`host-degraded`), все состояния приветствия и брони, все действия внутри моделей проходят
`UiActionSchema`, у каждой ошибки есть тексты реестра, id только синтетические.
