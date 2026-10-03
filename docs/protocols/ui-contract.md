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
| `result.ts`, `dock.ts` | `ResultVM`, `PartVM`, `PreviewSendView` (девять состояний), `DockVM` |
| `analysis.ts` | `RecapPickerVM`, `RecapViewVM`, `ReviewVM`, `CoachVM` |
| `spenders.ts`, `preview.ts`, `newcomers.ts` | доска и статистика, превью, «Новые» с бронью |
| `panels.ts`, `pages.ts` | панель фана, палитра, быстрый переход, шпаргалка, тосты; popup, настройки по разделам, эхо промпта, журналы |
| `app-client.ts`, `ports.ts` | `AppClient`, `ViewOf`, `ActionReceipt`; `MountPort`, `ToastPort`, `ClipboardPort`, `DialogPort`, метки отрисовки, `resultCap` |

Поддельный клиент и сценарии — `packages/testing/src/scenarios/app-client/`, подпуть
`@cg/testing/app-client`.

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

## Сценарии

Тест целостности проверяет: каждая тема §10.2 п. 7 покрыта, каждый вид достигает каждого
своего состояния, все девять состояний «Отправить», все статусы дока (оба кода
`host-degraded`), все состояния приветствия и брони, все действия внутри моделей проходят
`UiActionSchema`, у каждой ошибки есть тексты реестра, id только синтетические.
