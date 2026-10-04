# `@cg/ui` — док и оверлеи (R14)

Интерфейс над полем ввода ChatSpace и его оверлеи (architecture.md §10.1, ui-design.md
§3–§7, §10–§12). Всё рисуется только из моделей видов (`useView`) и просит о чём-либо
только действиями `UiAction` (`useDispatch`). Ни одного запроса, `browser.*`, обращения к
DOM ChatSpace и таймера в покое здесь нет. Кит (`./kit`, R13) — общие компоненты и
монтирование в закрытый shadow root.

## Что внутри

**`@cg/ui/dock` — первый чанк дока.**

- `dockSurface`, `createDockSurface({ parts })`, `mountDockSurface(root, deps, options)` —
  поверхность `dock` для `MountPort`.
- `DockView` — полоса (`Strip`) и лист над ней (`Sheet`): результат (`ResultContent`: поток
  с этапами и таймером, части `Parts`, варианты Hi `Variants`, Fix `FixBody`, вопрос Б2,
  «Фан написал новое», карточка ошибки, подвал клавиш), отказ четвёртой генерации,
  карточка «расширение обновилось», баннер статуса последней строкой.
- Порядок листа: «расширение обновилось» → отказ → Recap / Review → результат (UI-015).
- Что прячется на какой ширине — только CSS (контейнерные запросы, `styles.ts`), разметка
  одна на всех ширинах. Предел высоты листа — `--cg-cap` из геометрии `MountPort`.
- Поток: `useSteadyView` держит модель неизменной, пока меняется только `streamText`;
  `StreamText` пишет порцию в один текстовый узел в кадре (AI-137).

**`@cg/ui/dock/analysis`, `@cg/ui/dock/debug` — ленивые части дока.** Recap (выбор
длины, сохранённые, сборка, факты, «не сохранено в хаб») и Review (оценка N/10, блоки
AI-053, «Как надо было»); подвал отладки (строка стоимости, «Промпт», профиль этапов,
живой таймер DB-012). Док грузит их при первом показе через `DockParts`
(`DEFAULT_PARTS` — динамический `import()`; загрузчики можно подменить).

**`@cg/ui/overlays` — оверлеи.**

- Тосты (не ленивые): `toastsSurface`, `mountToasts`, `createToastHost({ now })` — своя
  очередь интерфейса за `ToastPort` (4,5 с, ошибка 6,5 с, не больше трёх, замена по
  `code + scope`, пауза под курсором); поверхность рисует её вместе с тостами контроллера.
- Ленивые: `@cg/ui/overlays/coach` (боковая панель 320 px, слой 900),
  `@cg/ui/overlays/cheatsheet` (шпаргалка «?»), `@cg/ui/overlays/result-expanded`
  («Развернуть ↗»: Recap, Review или результат в окне). `lazyOverlays[kind]()` отдаёт то
  же через динамический импорт. Оверлей виден, пока смонтирован: корень композиции
  монтирует его, когда контроллер открыл поверхность, и снимает, когда закрыл.
- Корень оверлея — `position: fixed; inset: 0`, свой слой, клики пропускает; ловят их
  только дети (UI-024). У окон — затемнение и ловушка фокуса из кита (UI-017).

## Как подключить (корень композиции)

1. Ленивая точка входа дока экспортирует `mountDockSurface` (и `mountToasts`) из
   `@cg/ui/dock` и `@cg/ui/overlays` вместо заглушки спайка `mountDock` из `@cg/ui`
   (`src/spike/`, оставлена до переключения).
2. Док: `mountDockSurface(root, deps)` в закрытый корень хоста дока. `deps` — `MountDeps`
   из контрактов; геометрия (`width`, `feedHeight`, `viewportHeight`) нужна для предела
   высоты и подсказок.
3. Тосты: `mountToasts(root, deps, { host })` в хост оверлеев; тот же `host` отдать
   интерфейсу как `ToastPort`, если контроллер своих тостов не ведёт.
4. Coach, шпаргалка, «Развернуть ↗»: при открытии поверхности — `lazyOverlays[kind]()` и
   `mountKitSurface(kind, root, deps, surface)`; при закрытии — `unmount()`.
   «Развернуть ↗» монтируется, пока `recap.view.expanded`, `review.expanded` или
   `dock.result.expanded`.
5. Шрифт: хост оверлеев — ребёнок `<html>`, вне `#app`; шрифт ChatSpace должен дойти до
   него (в галерее он стоит на `html`).
6. Размер: `tools/size-budget` считает статическое замыкание `lazy/dock.js`. Ленивые части
   — отдельные чанки; чтобы у каждой была своя строка бюджета, им нужны свои точки входа
   (`@cg/ui/dock/analysis`, `…/debug`, `@cg/ui/overlays/*`) или учёт динамических чанков.

## Что отправляет интерфейс

| Элемент | Действие |
|---|---|
| Reply, Fix, Hi, Ping, Review | `Generate { targetHandle, feature, options: {} }` |
| Recap в полосе | `ShowAnalysis { view: 'recap', mode: 'sheet' }` — сам не генерирует (AI-060) |
| Coach в полосе | `Navigate { surface: 'coach', open }` |
| Тон | `Generate reply { tone }`, если Reply доступен; иначе `SetTone`; «Без тона» — `SetTone null` |
| Split | `SetPreference generation.split` |
| «Вставить», Enter на части | `InsertPart { operationId, variant?, part }` |
| Б2 | `AnswerConfirm { confirmationId, choice }` |
| «Копировать» | `Copy { artifactHandle }` |
| Fix | `ReplaceMyDraft`, `RestoreMyDraft` |
| «Ещё раз», «Отменить», «Скрыть» | `Regenerate`, `CancelGeneration`, `HideResult` |
| Recap | `ShowRecap`, `RefreshRecap`, `RetryRecapSave`, сборка — `Generate recap / recap-short` |
| Скрыть / развернуть Recap и Review | `ShowAnalysis { view, mode: 'hidden' \| 'expanded' \| 'sheet' }` |
| «Развернуть» результата | `ExpandResult { operationId, expanded }` |
| Coach | `Generate coach { question, preset?, attachMyDraft? }`, `NewCoachDialog`, `RefreshArchive` |
| Подвал клавиш «Скрыть» | `SetPreference onboarding.keysFooter.dismissed` |
| Тосты | `DismissToast`, `HoldToast` и действие кнопки тоста |

Текст переписки, черновики и ответы модели в журнал не пишутся: границы ошибок кита
сообщают только поверхность, код и имя класса ошибки.

## Размер

`packages/testing/src/dock/size.test.ts` собирает тот же граф, что будет у ленивой точки
входа: первый чанк (док, тосты, кит, Preact) — 42,5 из 45 КиБ gzip; ленивые части сверх
него — Recap и Review 6,2, Coach 6,8, отладка 1,5, шпаргалка 1,3, «Развернуть ↗» 1,0 КиБ.
В первом чанке нет zod, реестра кодов, Markdown, полей ввода и диалогов: их CSS лежит в
общем листе кита, а код — в ленивых чанках (`kit/**/**.css.ts`).

## Стенд и тесты

- Галерея: `pnpm --filter @cg/testing gallery` →
  `http://127.0.0.1:5179/dock-gallery/` — каждое состояние макета (1–10, 12, 16–19) и
  состояния §10 без картинки (`x-…`). Параметры: `?state=3a` или `?group=results`,
  `&w=853|693|489|360`, `&theme=light|dark`, `&lang=ru|en`, `&style=bare|sheet`,
  `&feed=574&vh=900`. Состояния — `packages/testing/src/dock/gallery/states.ts`.
- e2e `dock-gallery-*.e2e.ts` — четыре файла, у каждого своя сессия браузера (потерянная
  под нагрузкой сессия стоит одной части, а не всей галереи):
  `-states-light`, `-states-dark` — каждое состояние дока на двух языках, при
  100/125/150/200 %, на ширинах 853/693/489/360 и в колонке 320 px; `-widths` — что прячется
  на какой ширине, прогон 900 → 320 px шагом 1 px, оба «Вида ответа», предел высоты,
  порядок Tab настоящей клавишей; `-overlays` — оверлеи при 1440×900 и 1280×800 и карточка
  сбоя оверлея, по которой можно кликнуть. Общие помощники — `e2e/support/dock-gallery.ts`.
  Снимки — `.cache/e2e/dock-*.png`, `overlay-*.png`; их сравнивают глазами с
  `final-<состояние>-*.png` макета.
- Юнит-тесты названы по строкам паритета: `packages/testing/src/dock/`,
  `packages/testing/src/overlays/`.
