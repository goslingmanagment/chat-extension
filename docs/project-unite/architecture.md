# R20: ChatGoose на fansly.com — архитектура

Версия 2 (набор документов v7), 2026-10-12, после арены-ревью (Opus 5.5 + astra, max, два раунда); ответы владельца —
2026-10-13 (X37). Как построить второй хост — fansly.com — правильно по устройству и быстро: пакеты и границы, интерфейсы, миры страницы, фон, потоки, бюджеты,
стенд, изменения хаба. **Что** строим — `spec.md` (требования `FS-*`); **в каком порядке** — `plan.md` (PR); **как** —
этот документ. Где спецификация и этот документ расходятся в устройстве, действует этот документ; в поведении для
чаттера — спецификация. Всё, что здесь не сказано, — как у ChatSpace (`docs/architecture.md`).

**Основание.** Семь исследований 2026-10-12: код расширения (S1a, S1b), бандл fansly.com `main.2e6b96097a4bb73b` (S2),
старое расширение 2.9.0 → 2.10.1 (S3), хаб на проде `a3449f77` (S4), FBuddy (S5), Firefox (S6). Затем арена-ревью
версии 1: два независимых отчёта, сверка и единый список правок; решающие утверждения координатор перепроверил по коду,
бандлу и проду (только чтение). Всё вне репозитория: исследования — `~/Documents/Codex/r20-detail-2026-10-12/research/`,
арена — `~/Documents/Codex/r20-detail-2026-10-12/arena/`. Ссылки `main:N` — строка `pretty/main.2e6b96097a4bb73b.js`
снимка `~/Documents/Codex/fansly-web-bundle-2026-10-12/`.

## 0. Главное

| # | Решение | Почему |
|---|---|---|
| А1 | Два сайта — одно расширение с **реестром хостов**, **адаптером хоста**, **манифестом фич** с допуском по действиям и **профилем сайта**. Общий код сайт не называет | вопрос владельца: фичи на одной или обеих платформах, разный вид панели. Сейчас ChatSpace прошит в шести местах ядра, а контракты закрыты под него (S1a §6, S1b §6) |
| А2 | **Бюджеты ChatSpace не двигаются.** Общий код меняется только с оплатой в том же PR (реестр байтов, §3.2); код только одного сайта не меняет ни одного файла, который грузит другой. Это держат раздельные сборки ленивых чанков по сайтам, срезы общих таблиц по сайту и гейт | запас ChatSpace (0.2.4): MAIN 71 Б, тап 37 Б, ранний изолированный 704 Б (после F3 — 444 Б, §3.2), слой `ai` 763 Б, реестр протокола вкладки 1 357 Б; фон — 7 500 Б до сигнального порога |
| А3 | Фон — ядро и ленивые чанки сайтов (`bg/chatspace`, `bg/fansly`) с контрактом `BackgroundHostModule`; ядро **измеримо освобождается** до первой службы Fansly | `background.js` — 811 700 Б при сигнальном пороге 819 200, ни одного `import()` (проверено) |
| А4 | MAIN Fansly только наблюдает сеть страницы: один скрипт ≤ 16 КиБ gzip, ≤ 1 мс. DOM, вставка, передача файлов — в изолированном мире | у Fansly нет моста вставки, поле — `textarea` с `ngModel`; `execCommand` расширения даёт честные `beforeinput`/`input` (S6 Q6) |
| А5 | Тексты сообщений не покидают MAIN, кроме снимка генерации по запросу. Через мост — метаданные; печатание (46 % кадров) и квитанции прочтения не идут. У всей удержанной памяти и очередей — общие пределы; переполнение даёт `unknown`, а не ложный результат | дорогое место — мост, а не разбор (S2 §1.4); FS-PRIV-1 |
| А6 | Маршрут без хука `history`: путь, три наблюдателя маршрута, два узких наблюдателя внутренних якорей, `popstate`/`pageshow`; Navigation API — дополнительный сигнал (Firefox ≥ 147) | смена чата пересоздаёт контейнер в той же задаче, что `pushState` (S2 Q4, Q6); поле и блок контакта Fansly пересоздаёт и без смены адреса (`main:56262-56275`, `main:74512`). FS-RTE-3 закрыт |
| А7 | Отправку человеком распознаёт MAIN: последнее **доверенное** событие жеста и проверка «его доставка ещё идёт» (`eventPhase !== NONE`) в нативном `loadstart` XHR → квитанция ровно `POST /api/v1/message` → эхо по id | между слушателями нативного события браузер исполняет микрозадачи, поэтому метка «до микрозадачи» гасла раньше `send()` страницы (проба в Gecko 155 и Chromium 153); FBuddy может «проглотить» отправку без единого события XHR (S5 §2.6) |
| А8 | Hi на Fansly: начало разговора доказывает и личные сообщения считает клиент — вкладка по ответам страницы или проход «Новых»; хаб проверяет id и порог. Решение владельца — §15.1 п. 2 (X37) | правило хаба «пустая страница» доказано у 0 из 593 новых чатов, правило старого «короткая страница» — у 562 (S4 HF-5) |
| А9 | Свои запросы к Fansly делает только фон, через пакет `fansly-api` и по списку. Сессия и статусы ответов страницы — из `webRequest` (`onBeforeSendHeaders`, `onCompleted`); шаблон и охлаждение переживают сон фона в `storage.session` | X4, FS-NET-1; фон засыпает через 30 с (S6 Q3); 429 вызывают и чужие запросы со страницы |
| А10 | Отправка приветствия — своя машина состояний HTTP и свой журнал, с последней сверкой и надёжной записью перед сетью; X8 ChatSpace не трогается. На хабе у Fansly свой допуск приветствия, без флага `previewSend` | контракт X8 построен на очереди ChatSpace и `generationRef` (S1a §2.1.5); хаб сейчас требует для приветствия `previewSend` (`client-claim.ts:52-66, 198-212`) |
| А11 | FBuddy стоит у всех чаттеров. Отсюда правила: только `construct`-ловушки, без копий методов на экземплярах, без постоянного слушателя `message` на `window`, идемпотентный слот шапки, тосты не справа снизу | иначе молча ломаются его фильтр слов и журнал, а его постинг тел ответов в `window` будил бы наши слушатели (S5 §3) |
| А12 | Права Fansly опциональные (`optional_host_permissions` + `optional_permissions: ["webRequest"]`). Скрипты регистрирует фон после выдачи и заново на каждом старте; уже открытым вкладкам — маленький изолированный баннер «перезагрузите вкладку» через `scripting.executeScript` | статические хосты дали бы права и точку внимания всем установкам (S6 Q2); регистрация не внедряется в открытые документы, а обновление её стирает (S6 Q1) — без баннера ≈ 10 вкладок молча гасли бы после каждого обновления |

## 1. Два сайта в одном расширении

### 1.1 Что общее и что своё

| Слой | Общее для сайтов | Своё у сайта |
|---|---|---|
| контракты | идентичности, `HostPort`, операции, AI, фасад хаба, модели видов, авторский манифест фич | реестр моста, протокол вкладки сайта, ветка отчёта контракта, ключ настроек сайта, коды ошибок, операции AI сайта |
| логика (`core`) | домен, службы, контроллеры; сайт берётся из привязки и профиля; порты политики AI | `core/src/{domain,services,application}/hosts/fansly/*` |
| интерфейс (`ui`) | kit, док, доски, страницы; вид меняет профиль | `ui/src/hosts/fansly/*`: заметки, войс, vault, «Регистрация», «Новые» Fansly |
| страница | `host-kit`: загрузчик MAIN, мост, `guard`, слои, keep-bottom, проба клавиш — перенос из ChatSpace байт в байт | `host-chatspace`, `host-fansly` |
| сеть | `hub` (только фон) | `fansly-api` (только фон, только Fansly) |
| сборка | корни композиции, общий исходник | своя сборка ленивых чанков со своим планом слоёв, свои входы, фоновый чанк, тексты, бюджеты |
| тесты | e2e-обвязка, поддельный хаб | стенд сайта, поддельный API и сокет сайта, сосед (FBuddy), `TestHostConfig` |

### 1.2 Реестр хостов

`apps/extension/src/hosts/{index,types,chatspace,fansly}.ts` — данные, читаются при сборке, заменили `hosts.ts` (F2):
```ts
interface HostDescriptor extends RuntimeHostRow {             // адреса — из строки рантайм-таблицы сайта
  kind: HostKind; platform: Platform;
  scripts: { main: ScriptSpec; isolated: ScriptSpec; notice?: ScriptSpec; extra?: readonly ScriptSpec[] };
  permissions: { origins: readonly string[]; optional: boolean; api?: readonly OptionalApi[] };
  lazy: { root: string; layers: readonly string[]; entries: readonly string[] };  // своя сборка ленивых чанков (§3.2), F2b
  background?: { chunk: string };                               // фоновый модуль сайта (§3.3), F1
  mainWorldSources: readonly string[];                          // папки кода мира страницы: гейт `guard`
  budgets: { scripts: readonly { entry: string; label: string; gzipBytes: number }[] };   // строки `pnpm size`, по порядку
  contractCheck: { module: string; bundlesRootEnv: string };   // модуль контракта; переменная с корнем копий бандлов
  archiveMarkers: { code: readonly RegExp[]; libraries: readonly RegExp[] };  // чужой код, который не уходит никогда
  test: TestHostConfig;                                         // подмены тестовой сборки (§13); пока `pageMatches` стенда
}
interface RuntimeHostRow { matches: readonly string[]; quietDomains: readonly string[] }  // [] — сайт не «тихий» (X4)
type ScriptSpec = { entry: string; file: string; world: 'MAIN' | 'ISOLATED'; registration: 'manifest' | 'dynamic' | 'execute' };
```
Из реестра выводятся: манифест и его проверка (`build/manifest.ts`), входы WXT, **сборки ленивых чанков по сайтам**, WAR по
сайту, хосты RPC фона и звука, регистрация скриптов, онбординг страниц, гейты (`MAIN_WORLD_*`, `ISOLATED_BUNDLES`), строки
бюджетов, `archive-check`, `host-contract-check --host`. Код одного сайта никогда не импортирует запись другого.

Рантайму достаётся отдельная лёгкая таблица — `apps/extension/src/hosts/runtime/{index,<сайт>}.ts`: адреса сайта (`matches`,
`quietDomains`), `isQuietHost`, loopback тестовой сборки; вид и платформа — из контрактов (`HostKind`, `Platform`, P4a1).
Входы сайта читают только свою строку (`runtime/<сайт>.ts`), фон и страницы — всю таблицу; запись реестра берёт адреса из
строки, а не наоборот. Поля сборки в бандлы не попадают: реестр не импортирует никто из того, что уходит в XPI, и сама
таблица его не читает (правило `host-registry-build-only` в `.dependency-cruiser.cjs`); тест манифеста ищет поля сборки в
собранных файлах. Разводка сайтов в корне композиции (хосты RPC, источники звука) пишется `satisfies PerHost<…>`: новая
строка таблицы не проходит typecheck, пока корень её не учёл; байты ChatSpace при этом не меняются (выведение карт в рантайме
стоило бы ≈ 240 Б фона).

### 1.3 Адаптер хоста

Вход сайта передаёт свой адаптер в общий корень композиции вкладки: `composeTab(env, adapter)`. `tab/runtime`, `keys`,
`app`, `controllers`, `host-facts`, `action-gate`, `surfaces` работают с общим `HostPort` и адаптером и не импортируют
пакет сайта (F3). Тип `HostAdapter` живёт в композиции приложения (`apps/extension/src/composition/tab/adapter.ts`): ему
нужен `TabEnv` приложения, а нижним пакетам импортировать приложение нельзя (`.dependency-cruiser.cjs`,
`nothing-imports-the-app`). Пакеты хостов отдают стартеры (`host-chatspace/src/isolated/starter.ts`), адаптер
собирается во входе сайта (`entrypoints/chatspace.content.ts`).

Адаптер — **две половины**, по тому, когда вкладке нужен их код (F3). Ранняя — в изолированном бандле сайта, с
`document_start`. Половина приложения — в чанке `tab-app` своей ленивой сборки, вместе с приложением: чего приложение не
зовёт до своей загрузки, в раннем бандле не лежит. Одно `liveConfigOf` ChatSpace тянет за собой правила флагов bootstrap —
≈ 2 КиБ gzip при запасе раннего бандла около 0,5 КиБ (§3.2).
```ts
// ранняя половина — изолированный бандл сайта
interface HostAdapter<P extends HostPort = HostPort> {
  readonly kind: HostKind;
  start(env: HostStartEnv): StartedHost<P>;                     // наши хосты мёртвого экземпляра прочь; монтирование и тема сразу, мост и HostPort за ними
  keyProbe(doc: Document, roots: ShadowRegistry): KeyOwnership;  // чьё поле в фокусе, открыто ли окно сайта
  keyPending(dock: Element): (waiting: boolean) => void;        // метка ждущей клавиши на хосте дока (HK-024)
  routeOfLocation(location: Pick<Location, 'pathname'>): RouteKey;  // ранний разбор адреса для клавиш
  readonly lazy: HostLazyPlan;                                  // { root }: где лежит своя ленивая сборка
}
interface HostStartEnv extends TabEnv { redeem; lazy(entry); navInsertTimeoutMs(); onDiagnostic(diagnostic) }
interface StartedHost<P> { staleHosts; mounts: HostMounts; theme: HostThemeSource; bridge: Promise<HostBridge | null>; host: Promise<P> }

// половина приложения — чанк tab-app сборки сайта
interface HostAppAdapter<P extends HostPort = HostPort, C = unknown> {
  liveConfigOf(bootstrap: Bootstrap | null, fuse: SendFuseState | null): C;  // у ChatSpace — часть B (тап, X8, пометка AI)
  configure(host: P, config: C): Promise<unknown>;                         // вкладка применяет только новое значение
}
```
- **Что впереди.** F4 добавляет в половину приложения срез манифеста фич (`features`, §1.4), F10 — порты политики AI
  (`ai`, §1.6, §9.1). Профиль сайта (§1.5, F5) раскладывается по тому же правилу: клиент схемы клавиш (`hotkeyClient`)
  читает ранний диспетчер — он в ранней половине; палитра, лист варианта и фразы — с приложением.
- **План ленивых чанков** — данные: каждый чанк — `<root>/<вход>.js` своей сборки. Хост с первым кадром MAIN грузит
  `bridge-validation`; ранний бандл с первым местом для дока, первой нашей клавишей или первой командой страницы —
  `tab-protocol` и `tab-app` (с половиной приложения); остальное приложение грузит по имени. Имена входов у сайтов
  общие, корень свой: у ChatSpace — `lazy`, сборка по сайтам (F2b) переносит его в `lazy/chatspace`.
- **Монтирование, реестр корней, тема** (`HostMounts`, `ShadowRegistry`, `HostThemeSource`) описаны в `adapter.ts`
  структурно: это общий механизм наших закрытых хостов (`host-kit`, P5), а не ChatSpace.
- **Типы.** Порт сайта виден как свой тип только в его половинах (`HostAdapter<ChatSpaceHostPort>` во входе,
  `HostAppAdapter<ChatSpaceHostPort, ChatSpaceLiveConfig>` в `composition/tab/hosts/chatspace/app.ts`); общий код
  держит `HostPort`.

Каждый бандл несёт ровно одну половину одного адаптера — выбор при сборке, поэтому код второго сайта в бандл не попадает.

### 1.4 Манифест фич и допуск

Манифест — данные в трёх файлах контрактов: `contracts/src/features/common.ts` (вид фичи, чип, клавиша — для фич
обоих сайтов, без сведений о сайте), `features/chatspace.ts` и `features/fansly.ts` (ветки своего сайта и фичи только
этого сайта). Корень композиции сайта импортирует `common` и **свой** файл: срез делает граф модулей при сборке.
Фильтр в рантайме оставил бы записи другого сайта в бандле — так сегодня `FEATURE_POLICIES` целиком лежит в
`background.js`. Инструменты (паритет, гейт полноты) читают все три файла; строки паритета живут в `tools/parity` по
ключу фичи.
```ts
// contracts/src/features/types.ts — контрактам доступен только zod (.dependency-cruiser.cjs:63)
interface FeatureCommon {
  kind: 'ai' | 'board' | 'panel' | 'host-action' | 'service';
  chip?: { group: DockChipGroup; priority: number; icon: DockIconId };  // строковые объединения в contracts/src/vm/dock.ts
  hotkey?: HotkeyActionId;                                               // строковое объединение в контрактах
}
interface Requirement {                           // всё внутри — AND
  flags: readonly ClientFeatureFlag[];            // флаги страницы из bootstrap
  hostCapabilities: readonly HostCapability[];    // возможности отчёта сайта
  clientNeeds?: readonly ClientHubCapability[];   // что нужно собственным вызовам клиента сверх решения хаба
}
interface FeatureOnHost {
  base: Requirement;                                                     // общее для всех действий
  actions: Partial<Record<'generate' | 'insert' | 'send', Requirement>>; // своё у действия, вдобавок к base
  surfaces: readonly MountSurfaceKind[];
  source?: 'hub' | 'host-pass' | 'page';
}
```
Иконки и группы чипов отображает `ui/kit` — его тест проверяет, что каждое значение объединения нарисовано; действия
клавиш проверяет тест `core/src/domain/hotkeys` против вендоренной схемы.

Чистая функция `core/src/domain/features/admission.ts`: `admission(id, action, {slice, page, hostReport, permissions,
settings})` →
- `{state: 'absent'}` — фичи нет в срезе сайта: не рисуется, клавиша зарезервирована;
- `{state: 'off', reason}` — не выполнено что-то из `base` или требования действия: флаг страницы
  (`pages[].features[flag]`), возможность сайта, `clientNeeds`, права, настройка;
- `{state: 'on'}`.

Правила:
- Решение хаба о странице клиент не повторяет: платформу и готовность хаба (`hub_not_ready`) хаб уже учёл в
  `pages[].features[flag]` по своей таблице `CLIENT_FEATURE_REQUIREMENTS`. Клиентская `CLIENT_FLAG_REQUIREMENTS`
  (`contracts/src/hub/routes.ts:94-111`, её читает `core/src/domain/ops/flags.ts:49-56`) сейчас эту таблицу дублирует
  и для `newcomers` требует `audience-new-v1` — на Fansly неверно. F4 оставляет только нужды транспорта самого клиента
  (сейчас одна: `context-v1` у `freshText`) и переносит их в `clientNeeds` срезов.
- Генерация, вставка и отправка допускаются раздельно. «Только копировать» (FS-DOCK-3) — состояние чата, его уже
  вычисляет `core/src/application/ai/workspace.ts:488-503`.
- `admission` читают все: док (чипы), доски, popup и «Статус», справочник клавиш, токены действий, фоновые службы.
  `FEATURE_FLAGS` (дубль `FEATURE_POLICIES.flag`) уходит.
- Вне манифеста и корней композиции нет второй таблицы платформенных условий (гейт §1.8). Отрицательные фикстуры F4:
  выключенный `insertion` не закрывает генерацию; отправка из превью ChatSpace требует и `previewSend`, и `newcomers`.

| Фича | ChatSpace | Fansly |
|---|---|---|
| `reply`, `fix`, `hi`, `ping` | `base` — без флагов (мастер-выключатель и версию проверяет хаб); `insert` — `insertion` | `base` — `drafts` (новый флаг, только Fansly, HF-12); `insert` — `insertion` |
| свежий текст для них | `freshText`, `clientNeeds: context-v1` | то же |
| `recap`, `review`, `coach` | `recap`, `review`, `coach` | те же |
| `spenders`, `fan-panel`, `sound` | `spenders`, `fanPanel`, `sound` | те же; `groupId` фана в Spenders — §8.11 |
| `newcomers` | `base` — `newcomers`, источник — хаб (`audience-new`); `send` — `newcomers` + `previewSend` | `base` — `newcomers`, источник — проход (Б17); `send` — `newcomers` (HF-3), без `previewSend` |
| `preview-send` | `previewSend`; возможности сайта `previewSend`, `receipt` | `absent` |
| `voice` | `absent` | `voice` (скрипт и озвучка) |
| `notes`, `notes-fill` | `absent` | `notes`; заполнение — `notesFill` |
| `registration`, `vault` | `absent` | `registration`, `vault` |
| `via-tab` | `absent` | настройка, без флага |
| `navigation`, `palette` | `navigation` | `absent` до P17 |

`wsTap` — только ChatSpace: он регистрирует отдельный тап `chatspace-ws.js`. У Fansly наблюдение сети — часть
единственного MAIN, его регистрируют «Fansly включён» и права (§4).

### 1.5 Профиль сайта для интерфейса

```ts
interface HostUiProfile {
  kind: HostKind;
  palette: ValueSignal<Record<`--color-om-${string}`, string>>;  // ValueSignal — contracts/src/vm/signal.ts
  dock: { variant: 'chatspace' | 'fansly'; keepBottomPx: number; minWidthPx: number };
  layers: { ceiling: number };                                   // под модалками сайта
  keys: HostKeyTable; hotkeyClient: 'extension' | 'fansly';
  sheet?: () => Promise<CSSStyleSheet>;                          // правила варианта дока и иконки чипов сайта
  phrases: HostPhrases;                                          // целые фразы с именем сайта (§3.4)
}
```
- **Цвета.** Kit по-прежнему читает `--color-om-*`. На Fansly адаптер переводит переменные страницы (`--blue-1`,
  `--dark-1…8`, `--font-1`, `--border-color` и др., S2 Q9) в эти тройки и ставит их на наш хост-элемент рядом с
  `data-scheme`. Первый чанк дока не меняется.
- **Вариант дока** — атрибут `data-dock-variant` на хосте. Правила ширины и иконки чипов варианта Fansly приходят листом
  стилей из сборки Fansly (`profile.sheet`), а не правилами в общем `ui/src/dock/styles.ts`.
- **Чипы — данными.** `DockVM.chips: ChipVM[]` (добавочно; `actions` для замороженных семи остаётся) строится из среза
  манифеста и `admission`. Чип 🎙 — запись в манифесте, а не ветка в `Strip`.
- **Слоты.** Поверхность `header-slot` есть только у Fansly; что в неё рисуется («Регистрация», «Заметки»), решает срез.
- **Где сайты могут различаться:** цвета, плотность, вариант раскладки, набор и порядок чипов, слоты, фразы. **Нельзя:**
  копировать компонент под сайт. Если вид расходится сильнее — отдельная поверхность сайта в `ui/src/hosts/<host>/`,
  зарегистрированная в его срезе.
- Галерея рисует каждую поверхность в профиле каждого сайта (`?host=fansly`); визуальную правку проверяют по снимкам
  обоих.

### 1.6 Свои реестры у сайта

| Что | ChatSpace (как есть) | Fansly (новое) |
|---|---|---|
| манифест фич | `contracts/src/features/chatspace.ts` | `contracts/src/features/fansly.ts` |
| ленивые чанки | своя сборка `lazy/chatspace/*` со своим планом слоёв (сегодняшняя цепочка `LAZY_LAYERS`) | своя сборка `lazy/fansly/*` со своим планом; общий исходник в XPI дублируется, вкладка сайта чужих файлов не грузит |
| мост MAIN ↔ изолированный мир | `bridge.ts`, `bridge-messages.ts` | `bridge-fansly.ts` (лёгкие списки), `bridge-messages-fansly.ts` (схемы), конверт пачки `fx.batch`; чанк `bridge-validation` своей сборки |
| протокол вкладки | `tab-messages.ts` | `tab-messages-fansly.ts`, `RequestSpec.hosts`; ядро фона проверяет отправителя, вкладку, хост, права, размер и базовый конверт, а тело разбирает чанк `bg/fansly` |
| отчёт контракта | полная схема `anchors` (16 якорей, как сейчас) | ветка `host: 'fansly-web'` с обязательным блоком `extensions['fansly-web']` (§12) |
| ошибки | реестр CG | `errors-fansly.ts`: `CG-FAN-*`, `CG-NOTE-*`, `CG-VOICE-*`, `CG-VAULT-*`, `CG-FNEW-*`; сливается с общим реестром только во вкладке Fansly, на страницах расширения и в `bg/fansly` |
| настройки | общий v1 (`settings`) | раздел сайта в версионированном ключе `settings.ext` (§12): старые сборки его не знают и не трогают |
| операции AI | общие `FeatureId` | `voice-script`, `notes-fill` — операции среза Fansly со своим драйвером и схемой результата, через общий допуск (§8.8) |
| политика AI | общий контроллер | порты `AiHostPolicy`: доказательство, предпроверка, поля запроса сайта, вердикт и его отпечаток; реализации — в слое `ai-fansly` |
| тексты | общий каталог | пакеты `i18n-ru-fansly`, `i18n-en-fansly` своей сборки |
| фоновые службы | `bg/chatspace` (после F1) | `bg/fansly` |
| телеметрия | окно `chatspace:<сборка>` | окно `fansly-web:<сборка>` |

### 1.7 Как добавить фичу (рецепты для агентов)

1. **Общая, на обоих сайтах.** Запись в `features/common.ts` и ветки в `features/chatspace.ts` и `features/fansly.ts` →
   логика в `core` без имени сайта →
   поверхность в `ui` → строки паритета и e2e на стенде каждого сайта. Если сайты дают разные данные — порт в контрактах и
   его реализация в каждом хосте. В PR — дельта по реестру байтов ChatSpace (§3.2).
2. **Только Fansly.** Запись в `features/fansly.ts` → домен и службы в `core/src/*/hosts/fansly/` → поверхность в
   `ui/src/hosts/fansly/` → свои сообщения в `tab-messages-fansly.ts` → тексты в пакете Fansly → e2e только на стенде
   Fansly. Файлы ChatSpace и набор файлов, которые грузят его вкладка и фон, не меняются — это проверяет гейт (§1.8).
3. **Только ChatSpace.** Зеркально (так уже устроена X8: `preview-send`).
4. **Панель на сайте выглядит иначе.** Профиль сайта: цвета, вариант дока, порядок чипов, слоты, лист стилей варианта.
   Компоненты не копируются; в PR — снимки галереи обоих сайтов.

### 1.8 Гейты, которые держат разнос

- **Байты по сайтам.** Сравнение артефактов ChatSpace (`content-scripts/chatspace*`, `chatspace-ws.js`,
  `lazy/chatspace/**`, ядро фона, `bg/chatspace.js` и набор файлов, которые грузит вкладка ChatSpace, транзитивно) с
  `main` идёт в **каждом** PR. Если дифф трогает только файлы Fansly, разница — ноль. Файлы Fansly — по принадлежности,
  а не по одной папке: `packages/host-fansly/**`, `packages/fansly-api/**`, `**/hosts/fansly/**`,
  `apps/extension/src/hosts/fansly.ts`, `apps/extension/src/hosts/runtime/fansly.ts`, `apps/extension/src/entrypoints/fansly*`,
  `apps/extension/lazy/fansly/**`,
  `apps/extension/bg/fansly.ts`, `packages/contracts/src/**/*fansly*.ts` (в том числе `features/fansly.ts`,
  `errors-fansly.ts`, `bridge-*-fansly.ts`, `tab-messages-fansly.ts`, `send-fansly.ts`, `fansly.ts`), пакеты текстов Fansly.
  Остальные PR называют дельту по реестру байтов (§3.2). В бандлах ChatSpace нет данных `fansly-web` (маркерные строки).
  У гейта — отрицательные фикстуры на каждый вид пути.
- **Литералы сайтов** — по AST и по смыслу: строковые литералы, равные значениям `HostKind` и `Platform`, и сравнения с
  ними запрещены в `core/src/**`, `ui/src/**`, `hub/src/**`, кроме `**/hosts/<host>/**`, `contracts/src/{ids,hosts}.ts`,
  манифеста фич и `admission.ts`. Законные `platform === 'mac'` (ОС), `host === null` и состояния UI гейт не трогает.
  Ранний гейт (F9a) стоит со списком долга §1.9, финальный (F9b) — без него.
- **Имена сайтов в общих текстах** («ChatSpace», «OnlyMonster», «OnlyFans», «Fansly») запрещены: только фразы профиля.
- **Полнота манифеста:** каждая `FeatureId`, операция сайта, поверхность, действие справочника, флаг хаба и ленивый вход
  упомянуты записью; у записи есть строки паритета и e2e на стенде каждого её сайта (связка с P1b).
- **Граф пакетов:** реализации хостов (`hosts/<host>/`, пакеты `host-*`, `fansly-api`) импортируются только корнями
  композиции и индексами реестров; общий код их не импортирует. Граф ядра фона не содержит `hosts/fansly`, `fansly-api`,
  `tab-messages-fansly` и схем Fansly. Разрешённый граф `host-kit`, `host-fansly`, `fansly-api`, relay и `bg/*` записан в
  `.dependency-cruiser.cjs`, у правил — отрицательные фикстуры.
- **Поля сборки** реестра хостов и строки паритета в рантайм-бандлы не попадают.

### 1.9 Что общий код перестаёт знать (долг ChatSpace, закрывается до кода Fansly)

| Место | Сейчас | Станет |
|---|---|---|
| `core/src/application/newcomers/controller.ts:205, 664`; `spenders/controller.ts:571`; `preview/controller.ts:809, 1495, 1770` | `host: 'chatspace'` | `binding.host` |
| `core/src/application/ai/workspace.ts:482`; `preview/controller.ts:1496` | `conversationRef = fanRef` | из маршрута или разрешения группы |
| тост фона, `ChatNavigator.open`, `NavigationIntent.target`, `RequestIdentity` | без `conversationRef` | с ним |
| чтения хаба по разговору (`apps/extension/src/composition/background/hub-data.ts:55-57`, `hub/src/facade.ts:664`, лента) | по `fanRef` | по таблице «маршрут → ключ» (§11.1, HF-10; F6b) |
| `core/src/domain/telemetry/health.ts:242`; `core/src/services/telemetry/health.ts:33, 193` | один хост `chatspace`, `chatSpaceOpen` | окно на (хост, сборка) |
| `core/src/application/pages/view-status.ts:139-151, 474, 489`; `contracts/src/vm/pages.ts:86-102`; `ui/src/pages/options/Status.tsx:45`; `Options.tsx:59` | строка «ChatSpace» обязательна | строка на каждый сайт с привязками |
| `core/src/application/pages/model.ts:181`; `client.ts:910` | перечисление двух видов хоста | `HOST_KINDS` |
| `core/src/domain/hotkeys/resolver.ts:50` | клиент схемы `'extension'` | `profile.hotkeyClient` (F5) |
| `ui/src/kit/tokens.ts:18-55` | палитра только из `<html>` ChatSpace | `profile.palette` |
| `ui/src/dock/Strip.tsx:47-60`; `dock/styles.ts:112-235`; `contracts/src/vm/dock.ts:15-16` | семь чипов и пороги под них | чипы данными, лист варианта |
| `hub/src/facade.ts:343` | «… · ChatSpace» в имени устройства | нейтрально |
| `hub/src/ai-request.ts` с `HubFacade.buildStreamRequest` | мёртвый сборщик (`conversationRef = fanRef`), вызывают только тесты, но он в `background.js`; рабочий — `core/src/domain/ops/request.ts:105` | удалить (освобождает байты фона) |
| `host-chatspace/src/main/requests.ts:9, 23` | MAIN ChatSpace принимает оба вида хоста | только `'chatspace'` (освобождает байты MAIN) |
| ≈ 47 текстов с именами сайтов на общих путях | захардкожены | фразы профиля |

Гейт F9b проверяет литералы, тексты и граф; смысл чтений по разговору (F6b) он не проверяет — его держат тесты F6b.

## 2. Карта

```
fansly.com (вкладка модели; права выданы «Включить Fansly»)
 ├─ MAIN: fansly-main.js — document_start, регистрирует фон; ≤ 16 КиБ gzip, ≤ 1 мс
 │    Proxy (только construct) над WebSocket и XMLHttpRequest; слушатели на экземплярах
 │    разбор кадров wsv3 и ответов API; наблюдение чатов, сертификаты, снимок генерации
 │    жест: доверенное событие → loadstart во время его доставки → квитанция → эхо
 │    не пишет в DOM, не шлёт запросов и кадров, не трогает прототипы
 │        ⇅ MessagePort host-kit (рукопожатие ChatSpace; пачки fx.batch Fansly)
 ├─ isolated: fansly.js — document_start; адаптер Fansly, HostPort, маршрут и якоря, монтирование, слот шапки,
 │    вставка (execCommand), передача файлов, тема, клавиши;
 │    лениво из lazy/fansly: дока, ai-fansly, панели Fansly (заметки, войс, vault), «Новые», тексты Fansly
 ├─ fansly-notice.js — только в уже открытых вкладках после обновления или выдачи прав (executeScript)
 ├─ iframe relay — только при «Fansly через вкладку», на время запросов + 60 с
 │        ⇅ runtime.Port 'cg-tab' / 'cg-relay'
background (event page)
   ядро: вход и хаб, bootstrap, операции AI, настройки, логи, телеметрия, звук, синхронизация прав и регистраций,
         слушатели webRequest (onBeforeSendHeaders, onCompleted), приём tab.register, проверка конвертов сайтов,
         регистрация ручных отправок (общая для сайтов)
   лениво bg/chatspace: службы только ChatSpace (опека и журнал X8, «Новые» ChatSpace)
   лениво bg/fansly: fansly-api, пейсер, транспорт и relay, «Новые» (Б17), отправка с опекой, войсы, заметки,
         «Регистрация», Spenders Fansly
   → хаб https://gosling-agency.ru;  → https://apiv3.fansly.com/api/v1/ только по списку FS-NET-1
```

Потоки — §9.

## 3. Сборка, бандлы, бюджеты

### 3.1 Бандлы Fansly

| Файл | Что | Бюджет |
|---|---|---|
| `content-scripts/fansly-main.js` (регистрируется) | MAIN целиком: загрузчик host-kit, два Proxy, разбор, наблюдение, снимок, жест | ≤ 16 КиБ gzip; ≤ 1 мс на `document_start` |
| `content-scripts/fansly.js` (регистрируется) | ранний изолированный: адаптер, клиент моста, маршрут, монтирование, клавиши | ≤ 30 КиБ gzip (30 720 Б), из них общая часть — 18 227 Б (замер F3, ниже); собственному коду Fansly остаётся 12 493 Б — столько же, сколько сейчас занимает свой код ChatSpace (≈ 12 050 Б); ≤ 3 мс |
| `fansly-notice.js` (по `executeScript`) | баннер «перезагрузите вкладку», уборка наших осиротевших хостов | ≤ 2 КиБ |
| `lazy/fansly/bridge-validation.js` | схемы моста Fansly | ≤ 30 КиБ |
| `lazy/fansly/tab-protocol.js` | схемы протокола вкладки Fansly | ≤ 30 КиБ |
| `lazy/fansly/ai-fansly.js` | свежесть, снимок, вердикт, доказательство Hi на стороне вкладки | ≤ 30 КиБ |
| `lazy/fansly/` слои `tab-app` и дока | общий исходник, своя нарезка | как у ChatSpace: ≤ 30 КиБ; первый чанк дока ≤ 45 КиБ |
| `lazy/fansly/{notes,newcomers,voice,vault}.js` | панели сайта | ≤ 30 КиБ каждый (войс при превышении делится) |
| `lazy/fansly/i18n-{ru,en}.js` | тексты Fansly | ≤ 30 КиБ |
| `bg/fansly.js` | службы Fansly в фоне | своя строка; стартово ≤ 200 КиБ raw, утверждается по базе P3d |

**Общая часть раннего изолированного бандла (замер F3).** Бандл любого сайта несёт её до своего первого байта: обёртку
входа WXT, `composeTab`, ранний диспетчер клавиш, рантайм вкладки (порт к фону, регистрация, присутствие, загрузчик
ленивых чанков), клиент порта `@cg/platform` и лёгкие контракты (конверты, `tab.register`, zod mini). Замер — сборка
выпуска (`pnpm build`, `main` + F3), в которой вход ChatSpace временно заменён входом с пустым адаптером (заглушки
`start`, `keyProbe`, `keyPending`, `routeOfLocation`, ≈ 0,1 КиБ): `chatspace.js` такой сборки — **18 227 Б gzip**
(17,80 КиБ). Полный `chatspace.js` той же сборки — 30 276 Б: свой код ChatSpace (мост, `HostPort`, монтирование,
keep-bottom, проба клавиш, отчёт контракта) — около 12 050 Б. Общая часть растёт только с оплатой в том же PR (реестр
байтов, §3.2): её рост съедает запас обоих сайтов.

16 КиБ для MAIN: у ChatSpace два MAIN-скрипта, 10 + 6 КиБ (X11, X25). У Fansly всё в одном: тап должен стоять до первого
XHR Angular, а второй MAIN-скрипт — лишняя точка, которую страница может перехватить (довод X11). Реалистичность
подтверждает прототип полного MAIN в спайке P3a, а не размер старого тапа (1,8 КиБ): у нового есть наблюдатель XHR,
сертификаты и снимок. Прототип вместе с загрузчиком и мостом host-kit — 8,8 КиБ gzip, установка на `document_start`
0,28 мс (`spike.md` п. 4): запас под доработку P7a есть.

### 3.2 ChatSpace не платит за Fansly

- **Раздельные сборки ленивых чанков** (F2). У каждого сайта своя сборка со своим планом слоёв из реестра хостов; общая
  цепочка `LAZY_LAYERS` (`apps/extension/lazy/entries/names.ts:49`) и распределение по первому слою
  (`lazy/vite.config.ts:97-135`) становятся планом ChatSpace. Входы Fansly в общей сборке сдвигали бы нарезку общих модулей
  и байты чанков ChatSpace; раздельные сборки этого не допускают. Цена — дубли общего исходника в XPI; её меряет F2.
- **Срезы общих таблиц** (§1.4, §1.6): записи Fansly не лежат в общих статических таблицах, которые попадают в бандлы
  ChatSpace (манифест фич, ошибки, схемы, тексты).
- **Реестр байтов** (`plan.md` §4): каждый PR с общим кодом называет дельту по каждой строке ChatSpace и откуда взяты байты.
  Строки и запас (сборка 0.2.4):

| Строка ChatSpace | Сейчас / предел | Запас |
|---|---|---|
| MAIN `chatspace-main.js` | 10 169 / 10 240 Б gzip | 71 Б |
| тап `chatspace-ws.js` | 6 107 / 6 144 | 37 Б |
| ранний изолированный `chatspace.js` | 30 276 / 30 720 (замер F3: `main` `d159743` — 30 154, F3 — +122) | 444 Б |
| слой `ai` | 29 957 / 30 720 | 763 Б |
| проба реестра запросов вкладки | 27 315 / 28 672 | 1 357 Б |
| проба раннего контракта (конверты, `tab.register`) | 10 812 / 12 288 | 1 476 Б |
| проба `UiAction` | 14 323 / 16 384 | 2 061 Б |
| слой `tab-app` | 25 443 / 30 720 | 5 277 Б |
| первый чанк дока | 42 417 / 46 080 | 3 663 Б |
| каталог `ru` | 23,35 / 30 КиБ | — (тексты Fansly в него не идут) |
| `background.js`, raw (сигнальный порог `archive-check`) | 811 700 / 819 200 | 7 500 Б |

  Известные источники байтов: мёртвый `hub/src/ai-request.ts` с `HubFacade.buildStreamRequest` (F6a), `StartMemo.start`
  (F8), `FEATURE_FLAGS` и дубли `CLIENT_FLAG_REQUIREMENTS` (F4), второй вид хоста в
  `host-chatspace/src/main/requests.ts:9, 23` (F6a). Общие изменения могут
  менять байты, но не превышать согласованные пределы.
- **Код только Fansly — в сборке Fansly.** Свежесть, снимок, вердикт, доказательство Hi — в слое `ai-fansly` через порты
  `AiHostPolicy`; общий контроллер AI зовёт порты, общий `Result` получает готовую модель пометки (F10). Доменную политику
  AI не кладём в DOM-адаптер ради удобства.

### 3.3 Фон: ядро, чанки сайтов и их контракт

- Вторая сборка Vite для фона: `bg/<name>.js` (ES-модуль), загрузка `import(runtime.getURL(…))` из **классического** event
  page. Спайк P3a (`spike.md` п. 1): Firefox такой `import()` принимает, сборка WXT 0.21.4 (IIFE) оставляет вызов как есть;
  холодная загрузка чанка 200 КБ — 8–23 мс. `background.type: "module"` отвергнут: WXT 0.21.4 собирает такой фон в одной
  ESM-группе со страницами расширения (общие чанки с popup и настройками, нарезка `splitPageChunks`), и ядро фона
  перестаёт быть одним файлом, независимым от страниц. Ошибка исполнения чанка кэшируется по адресу в реалме фона:
  повторный старт в том же реалме — только по новому адресу (`?attempt=N`), следующий старт фона грузит заново.
- **Ядро измеримо освобождается до Fansly (F1):** службы только ChatSpace (опека и журнал X8, «Новые» ChatSpace) уходят
  в `bg/chatspace.js`, мёртвые зависимости удаляются. Регистрация ручных отправок (`core/src/services/native-send.ts`, «a
  part of a preview or of a «Новые» card») и её журнал долгов остаются в ядре — она нужна обоим сайтам, а второй
  владелец журнала запрещён; чанкам она доступна портом `BackgroundKit.nativeSends`. F1 записывает запас ядра до
  сигнального порога **числом** в реестр байтов; каждый P2v и P9a сверяется с ним; исчерпан — следующая служба
  выносится в чанк. Порог 800 КиБ заранее не поднимается; поднять его можно только отдельным решением с обоснованием.
- **Контракт чанка сайта:**
```ts
interface BackgroundHostModule { start(kit: BackgroundKit): Promise<BackgroundHostHandle> }   // идемпотентно
interface BackgroundKit {        // порты ядра, только type-импорты контрактов
  hub: HubFacadePort; settings: SettingsPort; storage: StoragePort; clock: Clock; log: LogSink;
  telemetry: TelemetryPort; router: TabRouterPort; permissions: PermissionsPort; tabs: TabsPort;
  nativeSends: NativeSendPort;   // регистрация ручных отправок и её журнал — у ядра
}
interface BackgroundHostHandle {
  onTabMessage(msg: VerifiedTabMessage): Promise<unknown>;     // ядро уже проверило отправителя и конверт
  onWebRequest(fact: WebRequestFact): void;                    // факты слушателей ядра (§8.2)
  dispose(): Promise<void>;
}
```
  Чанк не создаёт вторых владельцев журнала, настроек, телеметрии и хаба. Ошибка импорта или старта — понятное состояние
  сайта в «Статусе», ядро продолжает работать; повторный старт после сбоя восстанавливает сохранённые состояния.
- **Что в ядре:** слушатели `webRequest` на верхнем уровне (иначе событие не разбудит фон, S6 Q3), синхронизация прав и
  регистраций, приём `tab.register`, проверка отправителя и конверта сообщений сайта. Слушатели кладут шаблон и факты
  ответов в память и `storage.session` и чанк Fansly не тянут.
- **Когда грузится чанк:** рукопожатие вкладки сайта (`runtime.onConnect`), выдача прав, старт фона при включённом сайте и
  незавершённых работах (журналы отправок, попытки войсов, загрузка vault, долги регистраций).
- Профиль только ChatSpace чанк Fansly не грузит и не разбирает никогда; профиль только Fansly не грузит `bg/chatspace`.

### 3.4 Тексты

Общие ключи берут **целые фразы** из профиля сайта (`phrases`): «в ChatSpace» и «на Fansly» — разные предлоги, одной
подстановки имени мало. Ключи только Fansly — пространство `fansly.*` в пакетах `i18n-*-fansly` его сборки. Страницы
расширения (popup, настройки) несут оба пакета. Каталог `ru` ChatSpace тексты Fansly не получает.

## 4. Права, регистрация скриптов, открытые вкладки

- **Манифест** (добавочно):
  - `optional_host_permissions`: `https://fansly.com/*`, `https://apiv3.fansly.com/*` (их уже покрывает `https://*/*`
    для адреса хаба; перечисляем явно, чтобы запрос был понятным);
  - `optional_permissions: ["webRequest"]`;
  - `web_accessible_resources` для `https://fansly.com/*` — сборка `lazy/fansly/*` и страница relay.
- **Никаких** `host_permissions` и статических `content_scripts` для Fansly. Обновление они не задержали бы, но выдали бы
  fansly.com каждой новой установке, поставили бы точку внимания на вкладках Fansly и внедрили бы тап чаттерам, которые
  ещё не перешли (S6 Q2).
- **«Включить Fansly»** — один синхронный `permissions.request({origins: [fansly, apiv3], permissions: ['webRequest']})`
  в обработчике клика popup или настроек. Включение доводит фон по `permissions.onAdded`: popup может закрыться раньше.
  «Fansly включён» — пользовательская настройка в `settings.ext`, отдельно от выдачи прав: оставшиеся права не включают
  выключенное.
- **Синхронизация** — на каждом старте фона (на верхнем уровне), на `onAdded`/`onRemoved` и на переключателе. Если оба адреса
  выданы и Fansly включён — зарегистрированы `fansly-main` (MAIN) и `fansly` (ISOLATED), оба `document_start`,
  `allFrames: false`, `persistAcrossSessions: true`; иначе сняты. Обновление расширения стирает регистрации (S6 Q1),
  синхронизация возвращает их в первую секунду (на стенде — через 0,1–0,5 с после переустановки, P3a). Регистрация —
  **одним вызовом `[fansly-main, fansly]`**: скрипты исполняются в порядке регистрации, оба — до первого скрипта страницы
  (P3a). Регистрация без выданных прав проходит, но в документы не попадает. `platform/scripting.ts` учится регистрировать
  изолированные скрипты и наборы скриптов сайта.
- **Открытые вкладки.** Регистрация не внедряется в уже открытые документы, а позднее внедрение MAIN неполноценно: сокет
  страницы к тому времени уже создан. Поэтому на старте фона с причиной install/update и на `onAdded` фон делает
  `tabs.query({url: 'https://fansly.com/*'})` (с правом на адрес права `tabs` не нужно) и `scripting.executeScript`
  маленького изолированного `fansly-notice.js`: баннер «перезагрузите вкладку» и уборка **наших** осиротевших хостов по
  `data-host` (чужие и неопознанные узлы не трогаем). В popup и «Статусе» — «N вкладок Fansly ждут перезагрузки» и кнопка
  `tabs.reload`. Старая MAIN-копия остаётся в такой вкладке до перезагрузки, без партнёра: старый изолированный скрипт
  после обновления мёртв, его узлы и атрибуты в DOM остаются (P3a). До выдачи прав `tabs.query({url})` вкладок Fansly
  не возвращает вовсе — считать «ждут перезагрузки» можно только после выдачи.
- **WAR Fansly** (`lazy/fansly/*`, relay) доступны страницам fansly.com и до выдачи прав (`fetch` — 200, `<script>`
  грузится): это поверхность отпечатка (UUID расширения случайный на установку), а не данные. `import()` изолированного
  мира требует записи в WAR: файл вне списка не грузится (P3a).
- **Переход чаттера** (FS-CO-2): выключить старое → «Включить Fansly» → дождаться выдачи прав и регистрации → перезагрузить
  все вкладки Fansly.
- **Отзыв прав.** Регистрации снимаются; уже внедрённые копии живут до перезагрузки, новые документы скриптов не получают
  (S6 Q2). Начатые операции доводятся или останавливаются по FS-PERM-5.

## 5. MAIN-мир Fansly (`packages/host-fansly/src/main`)

### 5.1 Установка

- Регистрируемый скрипт `document_start` выполняется до скриптов страницы (S6 Q1). Сокет страница создаёт только после
  ответа `GET /account/me` (≈ 0,7 с), XHR — с первых запросов Angular. Оба конструктора страница берёт из глобала в
  момент вызова (S2 Q1, Q2), поэтому Proxy видит все экземпляры.
- На старте захватываем только то, что вызываем сами: `Reflect.construct`, `EventTarget.prototype.addEventListener` (для
  своих слушателей), `JSON.parse`, `queueMicrotask`, `requestIdleCallback`, `MessageChannel`/`postMessage` для
  рукопожатия. **Не** захватываем и не вызываем методы, которые зовёт страница
  (`XMLHttpRequest.prototype.open/send/setRequestHeader`), и не трогаем `Map.prototype`: на старте его временно
  подменяет FBuddy (S5 §2.3).
- **Старое расширение:** `Symbol.for('chatgoose.socketTap')` на `window` → новое отступает целиком (FS-CO-1). Порядок
  скриптов разных расширений не определён, поэтому проверка — при установке и на `DOMContentLoaded`. Если старое
  выключили без перезагрузки, символ остаётся до перезагрузки: баннер говорит «выключите старое и перезагрузите
  вкладку» (S3 G7).
- Все колбэки страницы и браузера — через `guard` host-kit (X22), никакой консоли, имена, которые видит страница,
  нейтральны.

### 5.2 Тап сокета

- `window.WebSocket = new Proxy(Native, { construct })`; ловушка возвращает `Reflect.construct(target, args, newTarget)` —
  родной экземпляр. Других ловушек нет. Наблюдаем экземпляр, только если `new URL(args[0]).hostname ===
  'wsv3.fansly.com'` (адрес приходит как `wss://wsv3.fansly.com?v=3`).
- На экземпляр вешаем свои `open`, `message`, `close`, `error` захваченным `addEventListener`. Страница ставит
  `on*`-свойства позже, поэтому наш слушатель стоит первым и `stopImmediatePropagation` страницы его не скрывает (S6 Q5).
  Цена — наша работа идёт до обработчика страницы; отсюда бюджет кадра.
- **Эпоха сокета** — номер созданного экземпляра; **подтверждена** — на нём пришёл кадр `t:1`. Страница пересоздаёт сокет
  при обрыве и если он не открылся за 3 с (S2 Q1.1): каждый новый экземпляр — новая эпоха, все чаты `unknown` до
  сертификата.
- Заметность Proxy: `toString` без имени и `prototype.constructor !== WebSocket`. Это остаточная заметность, как у
  старого расширения, без инцидентов; `Function.prototype` не правим (S6 Q5). Страница Fansly таких проверок не делает
  (S2 Q10).

### 5.3 Разбор кадров

- Каждый текстовый кадр: пинг `"p"` — без разбора; иначе `JSON.parse` → `{t, d}`. Для `t:10000` `d` — строка →
  `{serviceId, event}`, `event` — строка → объект: три разбора (S2 Q1.3). `t:10001` — массив строк, рекурсия. У
  `t:0/1/2` `d` не разбираем (`t:1` несёт токен).
- **Признак полноты кадра:** превышен предел (размер > 1 МиБ, глубина пакета > 4, узлов > 256), кадр повреждён, у
  `t:10001` `d` не массив → наблюдение затронутых чатов (если чат не определить — всех) становится `unknown` (FS-WS-2).
  Тихих обрезаний нет.
- **Проекции одного разбора:**
  - наблюдение: `5/1` новое сообщение; `5/10` удаление, а для удалённого сообщения `type 3` ещё и каскад — удаляются
    во **всех** чатах сообщения, чей `correlationId` равен id удалённого (S2 Q1.4); квитанции прочтения `5/2` и `4/2`
    (на проде приходят как `4/2`); участники `4/6–4/8`;
  - звук: `5/1` не от модели; новый подписчик `3/2`;
  - эхо отправки: `5/1` от креатора — по `id`.
- Сообщения сокета принимаем без правила страницы «старше 180 с — выбросить»; у звука своё правило свежести.
- Печатание (`5/22`, 46 % кадров) и квитанции через мост не идут.
- Бюджет — ≤ 0,1 мс на кадр в среднем: три разбора кадра до 2 КиБ стоят единицы–десятки микросекунд; пик — 12 кадров в
  секунду (S2 Q1.8). Прототип P3a: 4,5 мкс на кадр в среднем на смеси самой нагруженной страницы (под нагрузкой машины —
  9 мкс), сообщение 1 КБ — 6 мкс, 5 КБ — 17 мкс. Печатание и квитанции разбираются полностью (1–4 мкс): пропуск третьего
  разбора по префиксу строки не нужен.

### 5.4 Наблюдатель XHR

- `window.XMLHttpRequest = new Proxy(Native, { construct })`, родной экземпляр; на экземпляр — `loadstart` (жест
  отправки, §5.9) и `loadend` (разбор). **Никаких** своих `open`/`send`/`setRequestHeader` на экземплярах и вызовов
  захваченных методов прототипа: иначе мы обходим прототипные хуки FBuddy и молча отключаем его фильтр слов и журнал
  (S5 §2.3). `video.js` забирает `window.XMLHttpRequest`, когда грузится его скрипт, — он получает наш Proxy, это
  безопасно.
- `loadend` срабатывает после всех `load`-слушателей (Angular и FBuddy), в той же задаче: страница уже обработала ответ.
  Классификация без хука `open` — по `responseURL` и форме ответа (S2 §3.2):

| Путь (`ngsw-bypass=true` игнорируется) | Значение |
|---|---|
| `/message` с `groupId`, без `before` | свежий конец истории — кандидат в сертификат |
| `/message` с `groupId` и `before` | старая страница |
| ровно `/api/v1/message` без `groupId` | квитанция `POST /message`: нужны `response.id`, `groupId`, `senderId === креатор` |
| `/messages?ids=` | сообщения по id |
| `/message/unread` | id и группы непрочитанных — метаданные |
| `/group/<id>/` или `/group/<id>` | группа, если `response.id === <id>`, `type` — число и `users` — массив: участники, правила ЛС, `lastMessage`. Тот же адрес у `POST` (добавить участников группового чата): из его ответа страница читает только `users[].userId` (`main:28340-28346`, `:28890-28904`), остальная форма по бандлу неизвестна — неполный ответ знание о группе не понижает (P3a) |
| `/messaging/groups` | группы, `lastMessageId`, `aggregationData` |
| `/account/me` | креатор |
| `/message/automated` | приветственные тексты — классификатор Hi (§5.8) |
| ровно `/vault/albums/media` (только `POST`) | подтверждение vault (§7.11): страница проверяет только `success`, тело ответа не читает (`main:30320-30326`, `:12818-12827`), его форма по бандлу неизвестна (P3a) |

- `JSON.parse(xhr.responseText)` — Angular ставит `responseType = 'text'`, готового объекта нет — только для путей
  таблицы, `status` 2xx и `success === true`. Ответ до 64 КиБ разбирается сразу на `loadend`. Больший (`/messaging/groups`
  до 115 КБ) копируется строкой в ограниченную очередь отложенного разбора (§5.5) и разбирается в `requestIdleCallback`;
  сам XHR не удерживаем. Ответ дороже предела разбора — не долгая блокировка, а явная потеря: затронутая область
  `unknown`. Калибровка P3a: ответ 115 КБ — `JSON.parse` 0,16 мс и с нашим обходом 0,18 мс (медианы; под нагрузкой машины
  0,9 и 1,7 мс); предел — 1 МиБ на ответ, очередь — до 8 ответов и 1 МиБ.
- Перед снимком генерации очередь сливается **с бюджетом**: не успели — снимок `unknown` с причиной `pending-parse`. Пока не
  разобран ответ групп, полнота затронутой области аккаунта — `unknown` (группы не угадываем).
- Бюджет: ≤ 2 мс на задачу; ответ вне таблицы — ≤ 0,01 мс (сравнение строк).

### 5.5 Наблюдение чатов и пределы памяти

- **Метаданные:** кольцо последних 120 записей на чат (id, направление, время, тип, `correlationId`, `inReplyTo`, медиа,
  удалён — с эпохой и номером наблюдения), не больше 300 чатов. **Тексты:** последние 60 сообщений для 20 недавно активных
  чатов. Вытеснение по давности активности; вытесненный чат — `unknown`.
- **Единый учёт памяти** всего, что удерживает наблюдение: записи колец (оценка с накладными расходами объектов, а не только
  длина строк), тексты, надгробия, очередь отложенного разбора, карта «фан → группа» (свой предел, чистится вместе с
  группами), исходящая очередь моста, копии снимка. Тексты ≤ 2 МиБ, всё ≤ 4 МиБ (FS-TAIL-5). Пределы числа записей —
  потолки, а не обещание, что все заполнятся одновременно; оценка консервативная и калибруется по `about:memory` в P7b и
  P16a. Превышение — вытеснение и `unknown`, а не рост.
- **Раскладка колец — компактная** (калибровка P3a, `spike.md` п. 4): объект на запись стоит в SpiderMonkey 167 Б, и
  потолок 300 × 120 = 36 000 записей занял бы 6 МБ — больше общего предела. Поэтому на чат — массив строк id, а время,
  тип, направление и флаги — в типизированных массивах: 33 Б на запись, потолок ≈ 1,2 МБ. Стартовые оценки учёта: 40 Б на
  запись, `64 + 2 × длина` на текст (150 знаков: латиница — 220 Б, кириллица — 364 Б по замеру).
- Порядок — по snowflake-id (сравнение длины, затем строки), а не по `createdAt` в секундах: сообщения одной секунды
  страница вставляет в обратном порядке (S2 Q1.5).
- Вложенный `inReplyToMessage` — не сообщение чата.
- Источники — всё, что приносит сообщения или их id (FS-TAIL-3), плюс `data[].lastMessageId` из `/messaging/groups` и
  `/message/unread`.

### 5.6 Полнота, сертификаты, порядок слияния

**Состояние чата:** `seenMetadata` (группа известна), `everCertified`, `lossSinceCertificate`, `observationFloor` (самое
старое сообщение непрерывного интервала), `completeness` (`complete` | `unknown`), `startProven` и основание счёта личных.

**Сертификат** — ответ страницы на `GET /message?groupId=…&limit=25` без `before`, запрос которого **начат после `t:1`
текущего сокета** (`loadstart` в эпохе) и закончен в той же эпохе, без потерь разбора между ними:
- **первый сертифицированный интервал** чата в документе — независимо от того, знала ли вкладка метаданные группы (при
  обычной загрузке `/messaging/groups` и `/group` приходят раньше истории, `main:28951-28994`); начинает непрерывное
  наблюдение с самого старого сообщения ответа;
- **восстановление** после потери (`lossSinceCertificate`) — только если ответ перекрывает наблюдение (содержит последнее
  неудалённое сообщение, известное до потери) или доходит до начала разговора (короче 25). Если граничное сообщение удалено
  и перекрытие не доказать — чат остаётся `unknown`.

`complete` → `unknown`: новая эпоха сокета, повреждённый кадр, вытеснение, источник сообщил о непросмотренном сообщении
(`lastMessage`/`lastMessageId` новее наблюдения), bfcache, переполнение очередей (`fx.gap`).

**Порядок слияния.** Каждое наблюдение получает монотонный номер в документе; XHR помнит номер на своём `loadstart`. Поздний
HTTP-ответ не отменяет более новое событие сокета (удаление, каскад), не воскрешает удалённый текст и не понижает известную
границу. Частичные источники (`lastMessageId`) только снижают полноту и никогда её не доказывают.

**Начало разговора доказано** (`startProven`), если сертификат-ответ короче 25 сообщений (правило старого, S4 HF-5).
Доказательство и счёт личных живут, пока живо их основание: непрерывное наблюдение с этого ответа без вытеснения записей
чата. 25-е сообщение само по себе его не сбрасывает.

Свежий конец открытого чата страница сама перезапрашивает после каждого `t:1` и после скрытия вкладки дольше 30 с
(S2 Q1.7) — это естественные точки восстановления. Запрос, начатый до `t:1` при загрузке страницы, сертификатом не
считается. A → B → A запросов не делает и полноту не теряет, если соблюдено всё выше.

### 5.7 Личность

- Креатор — `account.id` из ответа страницы на `GET /account/me`. HF-1 проверен: у всех шести страниц он равен
  `external_page_id` (S4).
- Группа: тип (1 — ЛС, 3 — рассылка) и участники. Фан — участник, отличный от креатора, при ровно двух участниках; иначе
  групповой чат — без AI и слота шапки (FS-IDN-3).
- Правила ЛС (`dmPermissionFlags`, `accountDmPermissionFlags`) — для «только копировать» (FS-DOCK-3).
- Изолированный мир узнаёт личность из события `fx.identity`, группу открытого чата — из `fx.chat`.

### 5.8 Снимок генерации и доказательство Hi

По запросу `fx.generationSnapshot {groupId, feature, window, withText}` MAIN после ограниченного слива очереди разбора за
один синхронный шаг отдаёт (`contracts/src/fansly.ts`, P4a2; `null` — MAIN не знает креатора, группу и фана чата):
```ts
interface FanslySnapshot {
  feature: FeatureId;                                            // для кого снимок: решает, можно ли хвост и доказательство
  identity: { creatorId: NativeId; groupId: NativeId; fanId: NativeId };
  epochs: { document: string; socket: number; route: number };   // route — эпоха маршрута последнего fx.focus
  completeness: 'complete' | 'unknown'; gap?: FanslyCoverageReason; // ровно при unknown: pending-parse, evicted, socket, gap, …
  window: Array<{ id: NativeId; dir: 'fan' | 'model' }>;          // до min(60, окно функции), по порядку snowflake; медиа тоже
  knownFanMessageIds: NativeId[];                                // до 10 последних сообщений фана окна
  deletedIds: NativeId[];                                        // удалённые в окне, которые видела вкладка; не в window
  startProof?: StartProofV1;                                     // только Hi, этого же groupId
  fanAvatarUrl?: string;                                         // только Hi: адрес аватара фана из ответов страницы (FX-018)
  tail?: LiveTextMessage[];                                      // только Reply, Fix, Hi, Ping; только с текстом; id — из window
  truncated: boolean;                                            // только при хвосте
}
interface StartProofV1 {
  v: 1; source: 'tab-short-page' | 'pass-empty-page'; groupId: NativeId;
  startWitnessId: NativeId | null;   // вкладка: самое старое сообщение короткого сертификата;
                                     // проход: самое раннее сообщение всей пройденной истории (из последней непустой
                                     // страницы перед подтверждённым концом); null — только если вся история пуста
  coveredCount: number;              // сообщений с начала, которые видела вкладка или проход
  personalCount: number;             // вкладка: по всей доказанной истории, а не по последним 25; проход: по последним 30
  automatedIds: NativeId[];          // ≤ 120 последних (ёмкость кольца); предел — в схеме и тесте предела тела
}
```
- Кадр ≤ 128 КиБ UTF-8; при переполнении первыми отбрасываются старые тексты, `truncated: true`.
- Аватар для Hi (FX-018, X37) — только строка адреса CDN Fansly по правилу хаба (`fanslyAvatarUrlSchema`); MAIN берёт
  её из ответов страницы (P7b), клиент адрес не загружает. Другого пути из MAIN в изолированный мир у неё нет.
- Сообщения только с медиа — в окне проверки, но не в текстовом хвосте: хаб требует непустой текст
  (`packages/contracts/src/routes.ts:2300-2301` хаба). Пустой хвост при полном наблюдении — законный снимок (своя схема, не
  `LiveTextTail` с `min(1)`).
- **Окно счёта у прохода** (решение координатора по матрице паритета, P1a): у `source: 'pass-empty-page'` `coveredCount` —
  вся пройденная история до пустой страницы, а `personalCount` — личные среди её последних 30 сообщений, как у старого
  (`fansly-chat/src/background/followers-service.ts:880-883, 938`); у вкладки счёт идёт по всей доказанной истории.
- **Счёт личных** (как у старого, NF-033): автоматические — сообщения модели с `type === 2`, или с `correlationId` без
  `inReplyTo`, или с текстом, равным приветственному тексту из ответа `/message/automated` после нормализации; сообщения
  фана — всегда личные. Неизвестный признак — не автоматика.
- **Правило клиента** (то же в §9.2 и FS-AI-2): клиент сам отказывает в Hi, только если доказано больше 10 личных. Иначе он
  шлёт запрос, а решает хаб: по `startProof` при объявленной возможности `hi-start-proof-v1`, без доказательства —
  `history_unproven`. Без `hi-start-proof-v1` Hi на Fansly показывает «хаб пока не умеет». Отсутствующее доказательство не
  подменяется нулевым счётом.
- **Сценарии приёмки:**
  - (а) первое открытие чата из 41 сообщения: свежий конец полный (25), доказательства нет → `history_unproven`;
  - (б) короткий сертификат, затем непрерывное наблюдение до 41 сообщения, счёт известен, личных ≤ 10 → допуск;
  - (в) проход «Новых» дошёл до начала при 41 сообщении → допуск.
  Дополнительных чтений истории в открытом чате правило не разрешает.

### 5.9 Отправка человеком

1. MAIN в фазе захвата на `window` хранит **последнее доверенное событие жеста**: `keydown` (`isTrusted`, Enter без Shift, не
   `isComposing`, не `Process`) или `click` по `.send-button`, если цель внутри `app-messages-conversation-route >
   app-group-message-container > app-group-message-input`. Слушатели пассивны: ничего не отменяют.
2. На `loadstart` XHR получает метку жеста, только если **доставка этого события ещё идёт** (`eventPhase !== Event.NONE`,
   ненулевой `currentTarget`) и совпадают документ, маршрут и группа. Микрозадачи между слушателями на это не влияют;
   отправка, начатая позже (таймер, асинхронная отправка с медиа), видит `NONE` и метки не получает. Таймер нужен только,
   чтобы отпустить ссылку на событие.
3. `loadend` помеченного XHR засчитывается, только если путь `responseURL` ровно `/api/v1/message` (не `/message/ack`,
   `/message/typing`, `/message/broadcast`). На жест — не больше одного кандидата; два — не атрибутируем.
4. Эхо — `5/1` с тем же `id` от креатора. Квитанция и эхо в любом порядке → `fx.sent {groupId, msgId, contentDigest}`;
   отпечаток `content` ответа считает MAIN, текст через мост не идёт.
5. Не было `loadstart` во время доставки — отправки не было: например, её «проглотил» фильтр слов FBuddy (S5 §2.6).
   Следующая отправка атрибутируется как обычно.
6. Отправка с медиа идёт асинхронно (шаблоны медиа) и не атрибутируется — это правило, а не ошибка.
7. Изолированный мир связывает `fx.sent` со вставкой нашего черновика по записи вставки (ревизия и отпечаток поля, снятые до
   очистки поля, §7.5) и проверочно — по `contentDigest` с той же нормализацией → `op.reportSent`. Совпадение текста без
   жеста `reportSent` не даёт.

Спайк P3a проверил правило на geckodriver доверенными кликом и Enter в 21 сценарии (`spike.md` п. 3): `loadstart` идёт
внутри `send()` страницы; отправка в микрозадаче — и после последнего слушателя — видит фазу 2 или 3; таймер и
`MessageChannel` видят `NONE`; квитанция и эхо сходятся в обоих порядках. «Один кандидат» проверяется, когда закончились
все XHR, помеченные жестом: их число окончательно к первому `loadend`. Реальный порядок квитанции и эха на Fansly стенд
не покажет — в `client_health` счётчик «эхо раньше / позже квитанции».

### 5.10 Чужие скрипты на странице

- **FBuddy** (S5): прототипные хуки XHR и подмена `fetch` ставятся после нашего скрипта; его сокеты живут в его
  изолированном мире, наш тап их не видит. Признаки для диагностики: `script#fbuddy-window-bridge-script`,
  `window.__FBUDDY_NETWORK_HOOK__`, `style#fb-fansly-style-fixes`, непустой `script#fbuddy-restricted-words-data`
  (фильтр слов активен). В «Статус» и `client_health` — только булевы.
- **video.js** забирает конструктор XHR — это наш Proxy, безопасно.
- Общий сигнал несовместимости тапа (чужой Proxy над конструктором поверх нашего, пропавшие события при живом сокете) —
  в отчёте контракта (`fx.contract`).

## 6. Мост MAIN ↔ изолированный мир (реестр Fansly)

Загрузчик и протокол моста переносятся в host-kit **байт в байт** (P5): `postMessage` только на время рукопожатия, затем
`MessagePort`; конверт `{v, kind, id, t, documentEpoch, seq, payload}`; склейка состояний ChatSpace
(`main/bridge.ts:176-198`) — без изменений; всё входящее проверяет изолированный мир. После соединения у нас **не остаётся
ни одного** слушателя `message` на `window`: FBuddy постит туда тело каждого ответа API (S5 §2.4).

**Fansly пакует сам.** Эмиттер `host-fansly` копит события одного вызова слушателя и шлёт их одной отправкой `post` в своём
конверте `fx.batch`. Состояния `fx.identity`, `fx.chat` (только последняя активная группа, с эпохой маршрута) и
`fx.contract` склеиваются по типу; поток событий идёт по порядку. **Поток ограничен кредитами:** изолированный мир
подтверждает каждую пачку после разбора (одно короткое сообщение `fx.ack`), а MAIN держит не больше 8 неподтверждённых
пачек и 256 КиБ в пути; ждущие события остаются в его очереди. Очередь и неподтверждённые пачки входят в общий учёт
памяти (§5.5); стартовые пределы калибруются в P7a. Исчерпан бюджет — MAIN перестаёт передавать данные и отправляет
одно уведомление `fx.gap` (все чаты `unknown`), изолированный мир перезапрашивает `fx.state`; потеря события не создаёт
ложного `sent`.

**Запросы в MAIN (`ToMainFansly`):**

| Тип | Данные | Ответ |
|---|---|---|
| `probe` | — | ответ загрузчика host-kit (`MainProbe`, как у ChatSpace: версия, `document_start`, время установки); `socketSeen`, `accountMeSeen` и легаси — в `fx.state` |
| `fx.state` | — | личность, сокет (эпоха, подтверждён ли), открытая группа, контракт, номер последней пачки (старт, перезапуск изолированного мира, после `fx.gap`; возобновляет поток) |
| `fx.focus` | `{groupId \| null, routeEpoch}` | `null` (MAIN шлёт `fx.chat` по этой группе с той же эпохой маршрута) |
| `fx.generationSnapshot` | `{groupId, feature, window, withText}` | `FanslySnapshot` или `null` |
| `fx.windowMeta` | `{groupId}` | сводка окна (для `chatWindow`) или `null` |
| `fx.ack` | `{n}` | `null`; подтверждает все пачки до `n` включительно — и принятые, и отвергнутые |

**События из MAIN (`FromMainFansly`, внутри `fx.batch`):**

| Тип | Данные | При перегрузке |
|---|---|---|
| `fx.identity` | креатор, `accountMeSeen`, легаси, FBuddy (булевы) | состояние: последнее побеждает |
| `fx.chat` | `{groupId, fanId \| null, kind, dmAllowed, routeEpoch, window: {loaded, newestId, newestAt, completeness, startProven, fanScript}}` | состояние активной группы |
| `fx.incoming` | `{groupId, fanId, msgId, fromFan, automated, tip, createdAt}` — каждое `5/1`, свои тоже | поток (свежесть, звук, эхо фоновых отправок) |
| `fx.follow` | `{eventId, accountId, followerId}` | поток |
| `fx.sent` | `{groupId, msgId, contentDigest}` | поток |
| `fx.coverage` | `{groupIds \| 'all', state, reason}` | поток |
| `fx.deleted` | `{groupId, ids}` (открытая группа) | поток |
| `fx.vaultAdded` | `{seq}` — номер наблюдения; `albumId`/`mediaIds` из ответа не взять (§7.11, P3a) | поток |
| `fx.contract` | сетевые якоря: `accountMe`, `socket`, `frames`, `xhr`; сигнал несовместимости тапа | состояние |
| `fx.gap` | причина: `overflow` \| `memory` | вне пачки: одно уведомление, вне кредитов |
| `fault` | место, счёт (X22) | вне пачки: его шлёт сам загрузчик |

- Бюджет — ≤ 1 отправки на вызов слушателя. «На задачу» не обещаем: между слушателями нативного события исполняются
  микрозадачи, сброс в микрозадаче может случиться не один раз.
- Схемы — в чанке `bridge-validation` сборки Fansly; схемы ChatSpace и их фикстуры не меняются. Имя `snapshot` занято
  запросом ChatSpace, поэтому у Fansly — `fx.state` и `fx.generationSnapshot`.
- **Контракт (P4a2):** `contracts/src/bridge-fansly.ts` (списки, кредиты, пределы кадров, конверты) и
  `bridge-messages-fansly.ts` (схемы); только подпути, корень `@cg/contracts` их не реэкспортирует. Пачка
  `{n, events: [{t, p}]}`: `n` растёт на единицу в документе и после `fx.gap` не сбрасывается; пачка ≤ 64 КиБ и ≤ 512
  событий, состояние — не больше одного раза; проверяется целиком — одно плохое событие теряет всю пачку, и
  изолированный мир поступает как после `fx.gap` (подтверждает, всё `unknown`, `fx.state`). Ответ на снимок ≤ 128 КиБ;
  остальные кадры — общие 256 КиБ (`fanslyFrameByteLimit`).

## 7. Изолированный мир Fansly (`packages/host-fansly/src/isolated`)

### 7.1 Старт

Синхронный старт без обёртки WXT (как X23): адаптер Fansly → клиент моста host-kit → поиск якорей и маршрут → проба клавиш.
Остальное — лениво из `lazy/fansly`, в порядке ChatSpace: валидация моста с первым кадром MAIN, протокол вкладки и
приложение — с первым полем или ждущей клавишей, панели — при открытии.

### 7.2 Маршрут

- Источник — `location.pathname` по `^/messages/(\d+)$`. Группа и чат разделены: `RouteState.conversationRef = groupId`,
  а `chat` (с `platformFanId`) появляется, когда фан известен из `fx.chat`.
- Сигналы: наблюдатели §7.3, `popstate`, `pageshow`/`pagehide`, на Firefox ≥ 147 — `navigation.currententrychange`. Каждая
  смена чата пересоздаёт контейнер в той же задаче, что `pushState` (S2 Q4, Q6), поэтому наблюдатель маршрута видит её
  всегда; Navigation API — ранний сигнал, а не основа. Хука `history` нет.
- Счётчик «адрес сменился без сигнала» сверяет путь на событиях нашего UI, `visibilitychange` и `focus` — в
  `client_health`.
- **Галерея** убирает шапку и контейнер без смены адреса: док и слот исчезают, это не ошибка.
- Эпохи маршрута, аккаунта и поля отбрасывают запоздавшие ответы (FS-RTE-4).

### 7.3 Якоря и монтирование

- **Якоря — только через маршрут.** Мини-чат, галерея, модалка новой рассылки и редакторы сообщений повторяют те же классы
  (S2 Q7), поэтому:
  - контейнер — `app-messages-conversation-route > app-group-message-container`;
  - поле — `… > app-group-message-input textarea.message-input`, отправка — `.send-button`;
  - файл — `.collapsable-actions > input[type=file]`;
  - «только копировать» — `> div.no-dm-allowed` или `div.message-composer.hidden`;
  - шапка — `> div.message-content-header .message-content-header-contact .content-header-sub-row`.
- **Наблюдатели — два жизненных цикла:**
  1. **Поиск.** На старте `div.content-wrapper` ещё нет: один `childList + subtree` на `body`, который отключается, как
     только якоря маршрута найдены, и включается снова, ограниченно, только если они пропали.
  2. **Работа.** `childList` без `subtree` на `div.content-wrapper`, `div.messages-content-wrapper`,
     `app-messages-conversation-route` (смена чата, галерея) и два узких — на `app-group-message-input` (его дети — ветки
     поля: поле, запись голоса, «no-dm-allowed», `main:56262-56275`, `main:55759-55790`) и на `.message-content-header >
     .flex-col > .flex-row` (тот, где `.back-button`): блок контакта стоит в нём под `ngIf` (`main:74512`, `main:74723`).
     Узкие переставляются при каждой смене маршрута.
  Перепривязка проверяет `isConnected` и эпоху поля и снимает старые слушатели. Поддеревья ленты и шапки целиком не
  наблюдаем: там узлы FBuddy и строка «печатает», которая появляется и исчезает при каждом наборе фана. В простое все
  наблюдатели молчат (S2 Q11); тема — атрибут `class` на `<html>`.
- **Док** — хост `div` без классов (X22) прямо перед `app-group-message-input` внутри контейнера, `flex: 0 0 auto`. При смене
  чата тот же хост с закрытым корнем переносится в новый контейнер: хост вставляется один раз и двигается, чтобы лишний
  раз не будить наблюдатель FBuddy. Нет контейнера при маршруте чата (новая сборка) — фиксированный оверлей над полем
  (FS-PLC-3).
- **Строка «печатает»** (`div.partner-is-typing`: нулевая высота, `z-index: 2`) рисуется поверх верхнего края дока, поэтому у
  хоста дока `position: relative; z-index: 3`.
- **Низ ленты:** keep-bottom host-kit с порогом 350 px (`xdScrollWatcher`); `scrollTop = 0` не пишем никогда.
- **Узкая колонка.** Боковая панель FBuddy (400 px и `flexGrow 3` у инбокса) сужает чат. Док деградирует по ширине
  (`profile.dock.minWidthPx`), а раскладка не зависит от высоты поля: CSS FBuddy делает поле двухстрочным.

### 7.4 Шапка: «Регистрация» и «Заметки»

- Один контроллер слота на обе кнопки. Блок контакта с `.content-header-sub-row` пересоздаётся при смене чата (S2 Q6) и
  при смене числа участников без смены адреса, поэтому слот вставляется заново по колбэку наблюдателя маршрута или узкого
  наблюдателя шапки — идемпотентно (только если нашего узла нет), после `.gallery-hot-icon`.
- Нет блока контакта (групповой чат, галерея) — нет слота. Якорь пропал в новой сборке — сломанный якорь в «Статусе», дата
  — в панели фана (FS-REG-4).
- FBuddy в окне ≤ 1200 px добавляет узел в конец `.message-content-header` при каждой смене чата, но не в
  `.content-header-sub-row` (S5 §2.5). Наш слот это не задевает, а идемпотентная вставка не даёт двум наблюдателям
  раскачивать друг друга.

### 7.5 Вставка

FS-INS-1 на этом механизме:
1. Проверки: адрес — тот же `groupId`; креатор и фан группы — цель черновика; поле — то самое (`composerInstanceId`, под
   маршрутом, не мини-чат), видимо и не отключено; нет IME-композиции (`compositionstart`/`compositionend` на поле: в
   композиции Angular модель не обновляет, S6 Q6).
2. `focus()`, выделение (замена — всё, добавление — конец), **все проверки заново**, отпечаток текущего текста.
3. `document.execCommand('insertText', false, text)` из изолированного мира. Firefox считает это вводом человека: шлёт
   `beforeinput` и `input`, правка попадает в отмену, `ngModel` обновляется (S6 Q6). Страница сообщит фану «печатает» — как
   при ручном наборе.
4. Сверка значения сразу и после задачи страницы. Запасная запись `value` + `input` — только если доказано, что первая
   поле не изменила. Частичный или неясный исход — `uncertain`, повтора нет (FS-INS-2).
5. Запись вставки (ревизия и отпечаток поля) хранится до отправки или смены поля — для связи с `fx.sent` (§5.9).

- Записи FBuddy (шаблоны, эмодзи, перевод, возврат текста фильтром слов) идут нативным сеттером и недоверенными `input`.
  В наш синхронный шаг они попасть не могут, но могут лечь между записью и сверкой — тогда `uncertain` без повтора.
- Новое поле получает кэш черновика страницы через микрозадачу, а высоту — через `setTimeout(0)`. Поэтому «два стабильных
  наблюдения» отложенной вставки охватывают хотя бы одну макрозадачу после появления контейнера.

### 7.6 «Открыть и вставить»

Клик по `a[href="/messages/<groupId>"]` в `.messages-list-wrapper`, если строка загружена и рядом с окном (список
виртуальный, подгружается по 20 групп). Иначе `history.pushState` + `PopStateEvent('popstate', {state: null})` — Angular
читает `state`, объект из нашего мира ему передавать нельзя — с проверкой через 2 с и полной загрузкой по ссылке, если чат
не открылся (SP-036). Дальше — отложенная вставка (§7.5). Если человек отправил карточку «Новых» своей кнопкой Fansly,
фон регистрирует ручную отправку в хабе (`registerNativeSend`, §8.6), как у ChatSpace.

### 7.7 HostPort Fansly

| Член | Реализация |
|---|---|
| `kind`, `platform` | `'fansly-web'`, `'fansly'` |
| `probe`/`onContract` | отчёт ветки `host: 'fansly-web'`: 16 общих возможностей (`previewSend`, `receipt`, `chatList` — off) + обязательный блок `extensions['fansly-web']` (§12) |
| `current`/`subscribe` | личность, маршрут (с `conversationRef`), поле, тема |
| `readDraft` | текст `textarea`; ревизия — счётчик наших наблюдений `input`; отпечаток — `digest` host-kit; `draftRead: on` (иначе у Fix нет замены) |
| `readVisibleTail` | `null`: на Fansly хвост — в снимке `freshness` |
| `chatWindow` | **синхронно** из кэша `fx.chat` (иначе док навсегда «загружается», S1b §2.1); `ChatWindow` добавочно получает `fanScript?` и `newestAt?` — для языкового фильтра и отставания архива без копии текста |
| `fan` | из `fx.chat` и ответов страницы (имя, правила ЛС), только украшение |
| `listCachedChats` | пусто до P17 |
| `insert`, `focusComposer` | §7.5 |
| `navigate` | §7.6 |
| `checkpoint` | `null` (X8 нет) |
| `mounts`/`theme` | §7.3, §7.8 |
| `previewSend` | `null` |
| `freshness` (новое, необязательное) | `snapshot(chat, opts)` → `FanslySnapshot` через мост |
| `fansly` (новое, необязательное) | `FanslyPagePort`: слот шапки, передача файла в поле, vault, relay |

### 7.8 Тема

Переменные страницы читаются через `getComputedStyle(document.documentElement)` лениво — при первом показе и при смене
класса `bright-theme`/`dark-theme` на `<html>` — и переводятся в тройки `--color-om-*` профиля. Синий `--blue-1` — только у
того, что уходит фану (FS-DOCK-1). Шрифт наследуется (Roboto).

### 7.9 Клавиши

- Тот же ранний диспетчер; клиент схемы — `'fansly'`: у вендоренной схемы 2 он обслуживает все строки `extension` и `notes`
  (S4 HF-11), хабу менять нечего.
- Поле сайта — `textarea.message-input` основного контейнера. Наши клавиши уступают, пока стоит `body.modal-opened`
  (модалка Fansly, проверка O(1)) или фокус внутри хоста `fb-*-ui` (окно FBuddy). Enter в поле — за Fansly.
- **⌘⇧L на Mac** — это и наш Split, и перевод FBuddy по умолчанию (`keydown` на поле, S5 §2.6); наш диспетчер ловит
  раньше. Решение владельца (§15.1 п. 3, X37): наш Split, а чаттеры с переводом FBuddy переназначают его.

### 7.10 Войс: прикрепление

- Файл передаётся в `input[type=file]` основного поля двумя путями старого — `DataTransfer` в изолированном мире, запасной
  через `wrappedJSObject` + `cloneInto`, с записью, какой сработал (S6 Q7), — и одним событием `change`.
- Fansly открывает свою модалку загрузки и **прикрепляет файл только после клика человека «Upload»** (S2 Q5). Подтверждение
  — новый `app-account-media-create-template.attachment` в `div.message-attachments` основного поля и закрытие модалки
  (`body.modal-opened` снят). Наблюдатель `childList` на `.message-attachments` живёт только пока попытка открыта: до
  закрытия модалки + 20 с.
- Неоднозначно (мини-чат, два вложения, модалка закрыта без вложения) — «неизвестно». Файл сам повторно не передаётся;
  «Прикрепить ещё раз» требует подтверждения.

### 7.11 Vault

`/creator/vault`, панель загрузки (сборка Fansly). Один файл на `change` в `app-media-upload-input input[type=file]`
открытого альбома. Подтверждение — успешный ответ на `POST /vault/albums/media` (событие `fx.vaultAdded` наблюдателя XHR) и
перезагрузка альбома. Тело этого ответа страница не читает, поэтому `fx.vaultAdded` несёт только порядковый номер
наблюдения, без `albumId` и `mediaIds` (P3a): альбом — тот, что открыт и записан в контрольной точке до передачи файла,
файл — тот, что передан последним; один файл на `change` даёт один `POST` после дебаунса страницы в 1 с
(`main:12828-12834`). Перезагрузку альбома страница делает запросом `GET /media/vaultnew?albumId=<id>…`
(`main:12696-12712`) — сверка адреса с альбомом контрольной точки. Контрольная точка на аккаунт и альбом пишется до
передачи файла. Список наблюдается только пока идёт загрузка (FS-VLT-2).

### 7.12 Контракт хоста и деградация

Якоря Fansly: `conversationRoute`, `container`, `composer`, `textarea`, `sendButton`, `fileInput`, `headerContact`,
`headerSubRow`, `attachments`, `noDmAllowed`, `modalFlag` (`body.modal-opened`), `themeClass`, `vaultUpload` и сетевые
`accountMe`, `socket`, `frames`, `xhr`. Факты контракта, лог, «Статус» и деградация функций читают **ожидаемый** набор
якорей выбранного сайта, а не присланные ключи: отсутствующий якорь — `missing`. Каждая возможность деградирует сама
(FS-CTR-2). `tools/host-contract-check --host fansly` проверяет якоря по свежей копии бандла.

## 8. Фон: службы Fansly

### 8.1 Состав

Ядро — §3.3. Чанк `bg/fansly` реализует `BackgroundHostModule`: всё из §8.2–8.12 поверх портов `BackgroundKit`. Логика — в
`core/src/{domain,services}/hosts/fansly/*`; `fetch` — только в `packages/fansly-api` (и `hub`). Порт `FanslyApiPort`
объявлен в контрактах, реализован `fansly-api`, связан в чанке.

### 8.2 Сессия и слушатели `webRequest`

- **Слушатели ядра**, без блокировки, фильтр `urls: ['https://apiv3.fansly.com/*']`, на верхнем уровне при каждом старте
  фона, если права выданы:
  - `onBeforeSendHeaders` (`['requestHeaders']`; `extraHeaders` в Firefox — ошибка схемы, S6 Q3) — шаблон заголовков;
  - `onCompleted` — только статус и `requestId`, без тела: факты 429 для пейсера (§8.4).
- **Два предиката** (уточнены спайком P3a, `spike.md` п. 5).
  - Шаблон заголовков обновляет запрос, похожий на запрос страницы: `tabId ≥ 0`, `frameId === 0`, `documentUrl` —
    `https://fansly.com/…`, не наш relay. «Не скрипт другого расширения» `webRequest` не различает: `fetch` и XHR
    контент-скрипта соседа на MV3 (и `content.fetch` на MV2) приходят с той же вкладкой, кадром 0, `originUrl`,
    `documentUrl` и `Origin` страницы — отличаются только значения заголовков. FBuddy шлёт свои запросы из той же вкладки
    с повторёнными, возможно устаревшими заголовками (S5 §3.9). Поэтому заголовки попадают в шаблон **только после ответа
    2xx на этот же запрос** (`onBeforeSendHeaders` и `onCompleted` по `requestId`): повтор, который сервер отверг, шаблон
    не портит, принятый сервером — законный шаблон сессии этой вкладки. `fetch` и XHR контент-скрипта MV2 приходят с
    `tabId −1`, без `originUrl`, `documentUrl` и `Origin` — шаблон не обновляют. Запросы фона другого расширения
    `webRequest` не показывает вовсе.
  - Статус 429 принимается от любого видимого запроса к API — страницы, соседа, нашего relay. С `tabId ≥ 0` — привязывается
    к креатору вкладки (§8.4). С `tabId −1`: свой запрос узнаётся по `originUrl` своей страницы
    (`moz-extension://<наш UUID>/…`), остальной — охлаждение на всех креаторов профиля, как у незарегистрированной
    вкладки.
- **Шаблон** — на аккаунт (legacy id из `authorization` → canonical из `/account/me`, алиасы AU-031…033):
  `authorization`, `fansly-client-id`, `fansly-session-id`, последний `fansly-client-check` по семейству маршрутов. Хранится
  в памяти и `storage.session` (переживает сон фона, теряется при перезапуске браузера и обновлении); в логи не попадает
  никогда.
- **Первая выдача прав.** На `onAdded` слушатели ставятся сразу — для немедленного захвата. Но разбудить фон после сна может
  только слушатель, поставленный синхронно на старте (правило Firefox о сохранении слушателей событий; стенд P3a на
  временном дополнении: слушатель из `onAdded` спящий фон не будит, слушатель с верхнего уровня следующего старта — будит и
  получает запрос). Поэтому после выдачи и перезагрузки вкладки модуль восстанавливается по рукопожатию вкладки
  (`runtime.onConnect`), а функции ждут готовности сессии. Без шаблона — `session-unavailable`: ни старых заголовков, ни прямого запасного пути. Цепочки «выдача →
  перезагрузка → захват», «сон → запрос → пробуждение → захват», «старт с правами», «отзыв и повторная выдача», «смена
  аккаунта» проверяют P3b и P9a.

### 8.3 `fansly-api`

- Только `https://apiv3.fansly.com/api/v1/` и только пути FS-NET-1 (таблица-допуск — гейт). К каждому URL —
  `ngsw-bypass=true`, заголовки шаблона, `credentials: 'omit'`, без `Origin`.
- Конверт `{success, response}`; `success: false` при 200 — ошибка; 401/403 — сессия истекла; 429 — в пейсер.
- Записи — одной попыткой, без повтора при неясном исходе.

### 8.4 Пейсер

Правила E130–E135 — данными, режим задаётся **на каждый вызов** (S3 G5):

| Вызов | Режим |
|---|---|
| проход «Новых»: `followersnew`, начало инбокса, `/account?ids=`, `GET /group`, история, `message/automated`; чтения заметок | разрешение очереди (FIFO, интервалы, медленная семья `/account*`) |
| `POST /group` | разрешение; во время охлаждения — отказ сразу |
| «Регистрация» `GET /group/<id>`, имена Spenders, поиск в инбоксе | только проверка охлаждения |
| `POST /message` (приветствие), записи заметок | без ожидания после опеки; во время охлаждения — отказ до опеки |

Охлаждение — общее на креатора, его вызывает **любой** 429: наш (`fansly-api`, relay) или со страницы модели — FBuddy
опрашивает `/message/unread` раз в 10 с из каждой вкладки (S5 §3.10). Чужой 429 — факт `onCompleted`; креатор — по
регистрации вкладки (`tabId`). Вкладка без регистрации (открыта до выдачи прав) — охлаждение на всех креаторов профиля:
лишняя пауза безопаснее лишнего запроса. Один ответ дедуплицируется между клиентом и слушателем. Охлаждение хранится в
памяти и `storage.session`; после пробуждения фона исходящий вызов ждёт загрузки этого состояния. Источник 429 считается в
`client_health` (наш / страница / неизвестный).

### 8.5 Транспорт и relay

- Два пути: прямой `fetch` из фона (запрос идёт без прокси контейнера) или «Fansly через вкладку» (E149): скрытый
  `moz-extension`-кадр в закрытом корне вкладки этой модели. Его запросы Firefox относит к вкладке, и прокси контейнера их
  берёт. Кадр `about:blank` нельзя: им управляет service worker Fansly, и запросы уходят без вкладки и без прокси (S6 Q11).
- Кадр поднимается лениво на пачку работы и живёт ещё 60 с. Маршрут выбирается до опеки хаба; кадр обязан подняться и
  ответить до неё. Смена документа, аккаунта или вкладки — отказ до опеки. Прямого запасного пути при включённом режиме нет.
- Порт `cg-relay`, свой вид отправителя: страница relay расширения, `frameId ≠ 0`, внутри зарегистрированной вкладки Fansly.
  Правило `frameId === 0` для `cg-tab` не ослабляется.

### 8.6 Отправка приветствия с опекой (HTTP)

Своя машина состояний и журнал `fansly.send.journal` (только id, без текста); X8 и `send.journal` не меняются.
```
ready → claimed (бронь фана, продление раз в 40 с) → routed (слот пейсера и кадр relay готовы)
      → dispatched (опека хаба HF-3: группа AI или ручная; билет до expiresAt) ⟶ надёжная запись намерения
      ⟶ последняя сверка (синхронно) → requestStarted (fetch начат) → receipted (ответ с id, groupId, senderId)
      → sent (эхо 5/1 с тем же id)
отказы: refused — доказанный отказ до отправки или 4xx, кроме 401; uncertain — всё остальное после надёжной записи
```
- Всё, что может ждать (пейсер, relay), идёт **до** `dispatch`. После ответа опеки порядок такой:
  1. **надёжная запись намерения** «отправка может начаться» (`await` записи в хранилище — единственная пауза);
  2. **последняя сверка — синхронно, по памяти:** кортеж (креатор, группа, фан, документ, транспорт, `historyRevision`,
     ревизия черновика) и остаток билета по его `expiresAt`;
  3. сразу `fetch` — без единого `await` между сверкой и передачей запроса. При «Fansly через вкладку» кадр relay
     повторяет свою часть сверки (документ, аккаунт, вкладка) синхронно у себя, прямо перед своим `fetch`.
  Сверка не прошла — `refused`: в этом же процессе доказано, что `fetch` не вызывался.
- **Окна сбоя:** до записи — ничего не ушло, опеку можно отпустить (`failed` с причиной); после записи — восстановление не
  знает, был ли `fetch`, поэтому `uncertain`: автоповтора нет, освобождать фана под новую отправку нельзя, пока отсутствие
  отправки не доказано; после квитанции до подтверждения хабу — повтор идемпотентного `sent` с сохранённым id. Завершение и
  сверка начатой попытки работают и после выключения флага (HF-3).
- Ручная группа: `{kind: 'manual', textFingerprint: sha256(точный текст)}`; неизменённый AI-текст идёт группой генерации
  (FS-NEW-6).
- `200 {success:false}` — `uncertain`, пока не доказано, какие коды значат «не доставлено» (S4 HF-3 #5); такие ответы
  копятся в `client_health` по коду.
- Эхо: сокет вкладки модели получает и сообщения, отправленные через API (S2 Q1.8), — фон ждёт `fx.incoming` с этим id от
  любой вкладки этого креатора. Нет вкладки — сверка по `GET /message?groupId` при следующем проходе.
- **Ручная отправка карточки** (§7.6): человек отправил текст карточки «Новых» своей кнопкой Fansly — атрибутированный
  `fx.sent` → `registerNativeSend` (`purpose: greeting`) из журнала долгов, как у ChatSpace (`core/src/services/native-send.ts`):
  фан считается поприветствованным для всех.

### 8.7 «Новые» (Б17)

- Источник — проход фона через `fansly-api` по правилам старого: `followersnew` ≤ 20 страниц, начало инбокса, профили
  пачками по 100, проверка строк, история до пустой страницы ≤ 30 страниц, `POST /group` одной попыткой (S3 §2.7). Не
  `audience-new` хаба.
- Модель вида общая с ChatSpace (`NewcomersVM` добавочно получает «Нельзя написать», состояние очереди, исключение);
  контроллер выбирает источник через порт.
- Окно получает **изменения строк** по порту вкладки, а не опрашивает снимок раз в 700 мс, как старое.
- Журнал прохода — IndexedDB (`openBoundedStore` из `platform/idb.ts`) с ротацией; в памяти — хвост.
- Черновики — общий механизм «Новых» (5000 символов, 24 ч, 100 на хранилище), запись с задержкой, а не на каждую клавишу.
- Доказательство для генерации и отправки даёт проход: id проверенной истории (оба направления, до 60 последних),
  `groupId`, `StartProofV1` с `source: 'pass-empty-page'`, `historyRevision` (FS-NEW-7).

### 8.8 Операции сайта и войсы

- `voice-script` и `notes-fill` — **операции среза Fansly** со своим драйвером, схемой и типом результата, через общий допуск
  планировщика: одна операция на чат и три на вкладку вместе с Reply и остальными, тайм-аут, отмена, учёт расхода,
  дедупликация, хранение результата. Закрытый `FeatureId` (`contracts/src/features.ts:7`) и драйверы планировщика по нему
  (`core/src/services/scheduler.ts:117`) расширяются объединением общих операций и операций сайта на уровне типов;
  рантайм-таблицы — срезы.
- Оплаченная озвучка — не операция генерации, а отдельная сохранённая попытка: `storage.session`, CAS по ревизии, тот же
  `clientRequestId` при восстановлении, без автоповторов (как у старого, S3 §2.6). Поток: `voice-script`
  (`conversationRef = groupId`, `fanRef`) → `voiceNoteCreate` (`conversationRef`, `fanRef`, HF-4а) → статус → аудио через
  `fetchVoiceNoteAudio` SDK.

### 8.9 Заметки и «Заполнить из чата»

- Чтения и записи — по FS-NOTE-*. Заметку FBuddy «FBuddy Notes» (12000, может нести `[FBUDDY_SYNC]`) показываем как чужую:
  только чтение с предупреждением, никогда не правим и не «чистим» (S5 §3.11).
- «✨ Заполнить из чата» (старое 2.10.x, E159–E161) — операция `notes-fill` (функция хаба `fan-notes-fill`). В хаб уходят
  только названия полей анкеты; глубина — по допуску HF-6 для этой функции, не меньше 3000, как у старого (§11.2);
  `conversationRef = groupId`, `fanRef`.
  Ответ сливается в пустые поля, заполненные показываются как «было → станет».

### 8.10 «Регистрация»

Дата — из snowflake id фана. Id фана — из `fx.chat`: страница сама запрашивает `/group/<id>/` при каждом заходе в чат.
Запрос фона `GET /group/<id>` — только если фан не известен, одна попытка, ничего во время охлаждения.

### 8.11 Spenders на Fansly

`groupId` фана — из строк Spenders хаба (`platformConversationId`, S4), из ответов страницы (кэш групп), иначе один поиск в
инбоксе по клику или `POST /group` (FS-SPD-2). Имена — из хаба; запрос к Fansly — только если хаб их не дал.

### 8.12 Звук

Факты `fx.incoming` и `fx.follow` идут пачкой в общий арбитр (дедупликация по платформе, аккаунту и id события). Правило
«чат открыт в окне в фокусе» — по фокусу и видимости, о которых сообщают вкладки, без права `tabs`. «Своё» — креатор
вкладки, его алиасы и все модели, чьи вкладки видел этот браузер (сохраняемый набор, S3 G19). Подписчики Fansly — из сокета
(`3/2`), а не из опроса хаба.

### 8.13 Телеметрия

Окно `HealthWindow` — на пару (хост, сборка); в id отчёта `client_health` входит хост (иначе хаб отбрасывает второй отчёт
окна как дубль). Метрики времени Fansly — новые имена в реестре хаба (HF-13, только дополнение; незнакомое имя хаб сейчас
отбрасывает, `routes-client.ts:1840-1850, 1889-1915`): `frameParseMs`, `xhrParseMs`, `snapshotMs` (шаг MAIN),
`snapshotRoundTripMs` (клик → готовый запрос); у клиента и хаба одинаковые границы корзин, различающие 0,1 / 2 / 5 мс и
превышения. Счётчики:
- доли FS-TAIL-9 с числителем и знаменателем;
- «адрес без сигнала»;
- источники 429;
- вставки `uncertain`, атрибутированные и потерянные отправки, `fx.gap`;
- булевы FBuddy и фильтра слов;
- какой путь передачи файла сработал.

Без согласия на телеметрию — только локально; у пилотных чаттеров согласие включено (§15.1 п. 6, X37).

## 9. Сквозные потоки

### 9.1 Reply со свежестью

1. Клик или клавиша → контроллер дока: `admission('reply', 'generate')` — on, токен действия.
2. Общий контроллер зовёт порт `adapter.ai.proof()` → `freshness.snapshot(chat, {feature: 'reply', window: 100, withText:
   true})` → MAIN: ограниченный слив и один синхронный шаг → `FanslySnapshot`.
3. `StartOp {…, target: {conversationRef: groupId, fanRef}, proof: {kind: 'tab-snapshot', …}}` → фон: допуск (одна
   операция на чат, три на вкладку) → запрос к хабу: `conversationRef`, `fanRef`, `liveTextContext` (хвост),
   `coverageCheck` (окно и удалённые) при возможности `coverage-check-v1`, `messageCount` 100.
4. Хаб отвечает кадром `context_v1` с ответом по каждому id окна → `adapter.ai.verdict()` — чистая функция таблицы §3.5
   спецификации → общий `Result` получает готовую модель пометки.
5. Ключ операции включает `conversationRef` и отпечаток доказательства; повторно открытый результат показывает свой вердикт.

### 9.2 Hi в чате

Снимок со `startProof` → клиент отказывает сам, только если доказано больше 10 личных; иначе запрос со `startProof` при
`hi-start-proof-v1` → хаб проверяет id окна (`coverageCheck`), начало (нет противоречия со свидетелем начала и известной
ему историей) и порог → три варианта. Без доказательства хаб отвечает `history_unproven` (сценарии — §5.8).

### 9.3 Вставка → отправка человеком → `sent`

Вставка (§7.5) пишет запись «наш черновик» (отпечаток, ревизия) → человек жмёт Enter или кнопку → MAIN: доверенный жест,
`loadstart` во время доставки, квитанция ровно `/api/v1/message`, эхо → `fx.sent` → изолированный мир сверяет запись
вставки и `contentDigest` → `op.reportSent` и `ai_acceptance` `sent`.

### 9.4 Приветствие из «Новых»

Проход → строка «можно писать» с доказательством → генерация по доказательству прохода или свой текст → клик «Отправить» →
фон: бронь → маршрут (пейсер, relay) → `dispatch` (AI или ручная группа, без `previewSend`) → последняя сверка → надёжная
запись → `POST /message` → квитанция → эхо из вкладки → `sent` в хаб.

### 9.5 Войс

`voice-script` (операция сайта) → варианты → оплата (`voiceNoteCreate`; попытка записана в `storage.session` до запроса) →
статус → MP3 → «Прикрепить» → файл в поле → модалка Fansly → человек «Upload» → вложение → подтверждение.

### 9.6 Обрыв сокета

Новая эпоха → все чаты `unknown` → `t:1` → страница перезапрашивает свежий конец открытого чата → ответ, начатый после `t:1`,
перекрывает наблюдение → `complete`. Остальные чаты восстанавливаются, когда их откроют: их свежий конец страница запросит
заново.

### 9.7 Обновление расширения и первая выдача прав

Регистрации стёрты → фон стартует → синхронизация возвращает их → `executeScript` баннера в открытые вкладки Fansly →
чаттер перезагружает вкладки (или кнопка в popup) → новые документы получают новые скрипты. Старая MAIN-копия до
перезагрузки живёт без партнёра; полнота её вкладки — `unknown`.

## 10. Производительность

### 10.1 Бюджеты и чем они держатся

| Что | Бюджет | Как держим | Где мерим |
|---|---|---|---|
| ChatSpace (все строки §3.2) | не растут | раздельные сборки, срезы, реестр байтов, гейт | size, `archive-check`, гейт байтов |
| MAIN Fansly | ≤ 16 КиБ gzip, ≤ 1 мс | один бандл без зависимостей, без zod; прототип в P3a | size, bundle-timing |
| ранний изолированный Fansly | ≤ 30 КиБ (число — по F3), ≤ 3 мс | адаптер и маршрут, остальное лениво | size, bundle-timing |
| кадр сокета | ≤ 0,1 мс в среднем | три `JSON.parse` кадра ≤ 2 КиБ; печатание и квитанции не идут в мост | `frameParseMs` (HF-13) |
| ответ XHR | ≤ 2 мс на задачу | разбор только путей таблицы; > 64 КиБ — в простое, с пределом | `xhrParseMs` (HF-13) |
| мост | ≤ 1 отправки на вызов слушателя; очередь — предел | `fx.batch`, склейка состояний, `fx.gap` | счётчик |
| снимок | шаг MAIN ≤ 5 мс; клик → готовый запрос — отдельная метрика | ограниченный слив очереди | `snapshotMs`, `snapshotRoundTripMs` (HF-13) |
| память MAIN | ≤ 4 МиБ, тексты ≤ 2 | единый учёт, пределы, калибровка | ускоренный тест, долгий прогон |
| `routeToDockMs` / `insertMs` | p95 ≤ 50 / 100 мс | хост дока переносится, а не создаётся; ленивые слои грузятся один раз | perf-проба |
| вкладка | **+≤ 15 МБ** (FS-PERF-1): рост памяти процесса вкладки после GC, окно 10 минут, та же база, FBuddy включён; 25 МБ — только аварийный порог пробы, а не зелёный результат | без копий текстов в изолированном мире | perf-проба |
| фон | ≤ 30 МБ на профиль (бодрствует, пока Fansly активен) | чанк Fansly только при Fansly; журналы в IndexedDB | `about:memory`, 10 вкладок |
| простой | наблюдение DOM и маршрута — без таймеров и опросов; общий keepalive вкладки 10 с, склейка присутствия и тайм-ауты relay учтены отдельно | молчащие наблюдатели, слушатели на экземплярах и поле | Firefox Profiler |

При превышении бюджета сначала меняется механизм, а не предел.

### 10.2 Наш код на открытом чате в простое

- MAIN: слушатели на экземплярах сокета и XHR срабатывают только на события страницы; захват `keydown`/`click` — дешёвая
  проверка цели.
- Изолированный мир: пять наблюдателей `childList` и наблюдатель класса `<html>` молчат; захват клавиш диспетчером;
  слушатели `input` и композиции — на привязанном поле, а не на документе.
- Таймеров подсистемы наблюдения нет; keepalive вкладки (10 с, `apps/extension/src/composition/tab/runtime.ts:42`) — общий
  с ChatSpace.
- Для сравнения — старое на открытом чате: ≈ 5,5 вызова таймеров в секунду (два опроса адреса по 500 мс, два «пробуждения»
  шапки по 2 с), три наблюдателя на всё дерево разговора, ≈ 14 слушателей документа и окна, сообщение в фон на каждый пинг
  сокета, чтение всего `storage.local` раз в 5 минут (S3 §2.18).

### 10.3 Фон и много вкладок

- Каждое событие `webRequest` сбрасывает таймер сна фона: пока Fansly активен, фон бодрствует, и бюджет 30 МБ считается для
  этого режима.
- Присутствие вкладок: сейчас каждая вкладка шлёт отметку раз в 10 с, при 10 вкладках Fansly это одна отметка в секунду.
  Общий keepalive от одной вкладки-хранителя (видимой или последней) и отчёты здоровья только при изменении — отдельный PR
  P16f после пилота (или до него — с повторным perf и длительным прогоном на итоговом артефакте). Индивидуальные обновления
  присутствия и переподключение каждой вкладки сохраняются.
- Факты звука идут пачкой, а не RPC на каждый факт.

### 10.4 С соседом

Каждый замер и бюджет — в двух условиях: сосед (FBuddy) выключен и включён; база старого — в тех же условиях (S5 §3.8).
Реальная страница чаттера всегда с FBuddy: его наблюдатель документа, пересканирование при фокусе, запись заголовка раз в
10 с, клонирование и разбор каждого ответа API.

## 11. Хаб

### 11.1 Допуски Fansly и ключи чтений

| Платформа | Функция или действие | Флаг страницы | Возможность |
|---|---|---|---|
| Fansly | Reply, Fix, Hi, Ping (генерация) | `drafts` (новый, только Fansly) | Hi: `hi-start-proof-v1` |
| OnlyFans | Reply, Fix, Hi, Ping | без изменений: мастер-выключатель и версия | — |
| Fansly | `voice-script`, `voiceNote*` | `voice` | `voice-notes-v1` |
| Fansly | `fan-notes-fill` | `notesFill` | — |
| Fansly | опека приветствия: `claim`, `renew` | `newcomers` (требования Fansly: `manual-greeting-v1`, без `audience-new-v1`) | `manual-greeting-v1` |
| Fansly | опека: `dispatch` | `newcomers`, **без** `previewSend`; `purpose` только `greeting` | `manual-greeting-v1` |
| Fansly | чтение статуса опеки | разрешено на Fansly (сейчас — только там, где есть отправка из превью) | — |
| Fansly | `release`, `sent`, `failed`, resolve | только право на страницу (как сейчас) | — |
| Fansly | `registerNativeSend` | право на страницу и платформа с опекой (HF-3 добавляет Fansly), `purpose: greeting` | — |
| Fansly | `preview-reply` | нет — 409 | — |
| Fansly | `notes`, `vault`, `registration` | одноимённые флаги | — |

Строку `"*"` Fansly не наследует. Клиент читает флаги страницы (`docs/protocols/hub.md`); новые имена флагов и возможностей
— в `contracts/src/hub/wire.ts` (`CLIENT_FEATURE_FLAG_NAMES`, `CLIENT_HUB_CAPABILITY_NAMES`, `AI_STREAM_CAPABILITIES`);
`CLIENT_FLAG_REQUIREMENTS` (`contracts/src/hub/routes.ts:94-111`) — только нужды транспорта клиента (§1.4).

**Ключи чтений по разговору** (F6b, HF-10):

| Маршрут | Ключ |
|---|---|
| рекап, лента архива, транскрипт | `conversationRef` + `fanRef` (проверенная пара) |
| карточка фана, деньги, цель досье, бронь и опека | `fanRef` |
| сохранение досье из генерации | `fanRef` + проверка, что генерация — этой пары (сейчас `generationIsOfFan` требует равенства ссылок, `client-profile-from-generation.ts:113-120`) |

### 11.2 PR хаба

Порядок — по графу схем, обработчиков, SDK и тестовых правил; независимые PR не ждут друг друга. Рекомендуемая очередь: HF-8а,
HF-8д, HF-9, HF-8в, HF-8б, HF-5, HF-4а, HF-3, HF-6, HF-7д0, HF-7а…д, HF-4б, HF-10, HF-12, HF-2, HF-13. У каждого PR вместо
«почему инертен» — **предикат нового поведения**: платформа, вид клиента (узкий токен, ядро без `clientContext`),
возможность, флаг. Реальные формы запросов старого 2.10.1 (обе формы ссылок: `group/fan` и `fan/fan`,
`OLD/src/background/operations.ts:375-395`) заморожены в регрессионных тестах: ответы и промпты до и после каждого PR
совпадают.

| PR | Что | Предикат нового поведения |
|---|---|---|
| HF-8а | точные строковые id на всём пути (≈ 8 мест `Number(ref)`) | рефакторинг; байты промптов OnlyFans не меняются, дайджесты закреплены |
| HF-8д | уровень покрытия Fansly из цепочки движка | Fansly, `context-v1` |
| HF-9 | проверка пары `groupId ↔ fanRef` по `(platform_account_id, platform_conversation_id)`; 409 `conversation_fan_mismatch`; новая пара — `pair: unverified` | Fansly, ядро без `clientContext` (старое с `clientContext` не трогает) |
| HF-8в | поле `coverageCheck` (≤ 60 id обоих направлений + удалённые) и ответ по каждому id; предел поиска поднять с 100 | возможность `coverage-check-v1` |
| HF-8б | свежий текст Fansly; ветка `dm_live_messages` в поиске свежего текста (удаления и чужие группы, которые знает только сокет) | Fansly, флаг `freshText` |
| HF-5 | Hi: `startProof` v1 и `personalMessageCount` верхнего уровня; проверка id окна, начала (противоречие со свидетелем начала и известной историей; удалённая историческая строка противоречием не считается) и порога; отказ `history_unproven` / `too_many_personal` | возможность `hi-start-proof-v1`, ядро без `clientContext` |
| HF-4а | личность войса: `conversationRef = groupId`, `fanRef`, проверка пары; старый формат работает (проверено на старой форме) | новое поле `fanRef` в создании озвучки |
| HF-3 | ручная группа (`manual:<sha256>` без миграции); допуски §11.1 — матрица `(платформа, purpose, действие)`; лимит приветствий по назначению (`greeting` ≥ 30 в минуту; у старого пик 29); доказательство отказа HTTP. Пока Fansly отказан проверкой платформы, HF-3 проверяет схемы и переходы; полный сценарий на Fansly — в HF-2 | Fansly, `manual-greeting-v1` |
| HF-6 | глубина 5000 одной настройкой на обе платформы: значение `5000` в перечне `aiTranscriptDeepMaxRows` (сейчас `1500`, `3000`; `config-registry.ts:307`), Fansly в `mayReadDeepTranscript`, путь `live_union` передаёт `maxRows`, тело `messageCount ≤ 5000`, глубина `fan-notes-fill` — явным правилом, не меньше 3000 (сейчас глубоко читает только полный `fan-summary`, `ai-transcript-depth.ts:75`); старый путь `clientContext` (старое шлёт свою историю до 3000) не меняется. Паритет в день перехода: настройка на проде поднята до 3000 (2026-10-13, X37), Fansly читает её после HF-6. X34: 5000 сообщений помещаются в окно модели Recap (подсчёт токенов на фикстуре из 5000 сообщений с системной частью и запасом на ответ) и цена названа | настройка (на проде 3000 с 2026-10-13 — переопределение, X37; до этого действовало 1500 по умолчанию) и `context-v1` |
| HF-7д0 | признаки автоматики в архиве: `type`, `correlationId` с признаком присутствия в материальной голове (`sync-pull.ts:906-936` их не сохраняет), протянуть до `ArchiveMessageRow` (`message-archive.ts:1455-1488`); миграция вперёд, если нужна; старые строки — «неизвестно» или ограниченный replay сохранённых наблюдений. Живой слой их уже хранит (`schema.ts:2051-2052`) | только данные |
| HF-7а…д | паритет контекста: подписи медиа из `media_metadata`, профиль (имя по правилу старого, сохранённое имя из `page_alias`, username, био при гидрации; аватар — не из хаба: клиент берёт его из данных страницы, §15.1 п. 4), PPV из `media_orders`, траты и подписка, пометки автоматики по карте происхождения (архив и `live_union`), `transcriptCoverage` из цепочки; эталон — через настоящий canonicalizer и чтение из БД | Fansly, ядро без `clientContext` |
| HF-4б | войсы в узком токене, флаг `voice`, возможность `voice-notes-v1`, доступность в bootstrap | флаг выключен |
| HF-10 | рекап и лента — `conversationRef` + `fanRef` (§11.1); сохранение досье из генерации проверяет принадлежность паре | возможность `conversation-recaps-v1` |
| HF-12 | узкий токен: Reply, Fix, Hi, Ping на Fansly — под флагом `drafts`; `voice-script` → `voice`; `fan-notes-fill` → `notesFill`; OnlyFans без изменений | Fansly, узкий токен |
| HF-2 | Fansly в требованиях по платформам; флаги Fansly (`drafts`, `voice`, `notes`, `notesFill`, `vault`, `registration`); полный сценарий опеки приветствия на Fansly (claim → dispatch → sent при `previewSend = false`) через штатный допуск | Fansly читает `flag_off`, пока владелец не поставит строки |
| HF-13 | метрики Fansly в реестре `client_health`: имена и границы корзин (только дополнение) | новые имена |

Затем: выкладка; «SDK для тестов» после каждой схемы; «SDK для выпуска» — из выложенного коммита; регистрация SDK
расширения в реестре замороженных SDK хаба (строки расширения там нет, S4); флаги владельца на страницах пилота. HF-1
(личность страниц) проверен, кода нет. HF-11 (клавиша заметок) не нужен: на Fansly клиент схемы — `fansly`.

Клиент шлёт новые поля только при объявленных возможностях (`coverage-check-v1`, `hi-start-proof-v1`, `manual-greeting-v1`,
`voice-notes-v1`, `conversation-recaps-v1`) и со своими токенами `x-kernel-ai-capabilities`: тело запроса строгое, и
старый хаб ответил бы 400. Без возможности зависимая функция показывает «хаб пока не умеет». Новые поля входят в тест
предела тела.

## 12. Контракты 1.15.0 (добавочно, `contract-change:`)

| Где | Что |
|---|---|
| `hosts.ts` (новый) | `HOST_PLATFORM`, `HOST_KINDS` — рантайм-таблица сайтов (вид → платформа), лёгкая, без zod; адреса и поля сборки — в реестре хостов приложения (§1.2, F2), не в контрактах |
| `ids.ts` | пара хост↔платформа — из `HOST_PLATFORM`, а не `chatspace ⇔ onlyfans` в refine |
| `features/{types,common,chatspace,fansly}.ts` (новые) | манифест фич (§1.4): общее и по файлу на сайт, требования по действиям; срез — графом модулей при сборке; `HotkeyActionId` — строковое объединение |
| `host.ts` | `RouteState.conversationRef?`, `conversationKind?: 'direct' \| 'group'` (проверка `conversationFits`: только маршрут чата, вид — с разговором, у группы `chat` = null, на OnlyFans разговор = фан); `NavigationIntent.target.conversationRef?` (только у цели-чата); `HostContractReport` — разбор по `host`: нет `host` или `'chatspace'` → прежняя полная схема `anchors`; `'fansly-web'` → обязательный блок `extensions['fansly-web']` с полным набором якорей и возможностей Fansly; `HostPort.freshness?`, `HostPort.fansly?`; `ChatWindow.fanScript?`, `newestAt?` |
| `fansly.ts` (новый, P4a2) | `FanslySnapshot` (с `fanAvatarUrl?` для Hi, FX-018), `StartProofV1`, `FanslyPagePort` (тип), `FanslyAnchorId`, `FanslyCapability`, пределы наблюдения, причины полноты, порядок id; только подпуть |
| `bridge-fansly.ts`, `bridge-messages-fansly.ts` (новые, P4a2) | реестр моста Fansly (§6), конверт `fx.batch`, `fx.ack`, `fx.gap`, кредиты и пределы кадров; только подпути: корень `@cg/contracts` модули сайта не реэкспортирует |
| `ops.ts` | `StartOp.proof?: CoverageProof` (снимок вкладки или доказательство прохода; хвост внутри); `checkpoint` не трогаем; `ServedContext.coverageCheck?`; новые причины `stale`; операции сайта — объединение на уровне типов |
| `send-fansly.ts` (новый) | машина состояний HTTP-отправки, журнал, запрос приветствия «Новых», ручная группа |
| `tab-protocol.ts` | `TypeSchema` — до двух точек; `RequestSpec.hosts?`; вид отправителя `relay`, порт `cg-relay` |
| `tab-messages-fansly.ts` (новый) | `fansly.followers.*`, `fansly.voice.*`, `fansly.vault.*`, `fansly.notes.*`, `fansly.relay.*` — разбираются в чанке `bg/fansly` |
| `settings.ts` | v1 **не меняется** (`deep` ≤ 3000, фикстура `deep: 3001` по-прежнему недопустима, `contracts/test/fixtures/schemas.ts:315`). Новый ключ `STORAGE_KEYS.settingsExt = 'settings.ext'` со своей версией — всё, чего v1 выразить не может: `{v: 1, hosts: {'fansly-web'?: {enabled, viaTab, notesView, sound: {messagesTone, subscribersTone}}}, windows: {deep?: 3001…5000}}`; глубина берётся `windows.deep` из него, если есть, иначе из v1, и не выше `limits.deepMax`. У каждого поля один владелец; импорт идемпотентный, значение по умолчанию не затирает сохранённое. Старые сборки ключ не знают и не трогают: их ремонт v1 выбрасывает неизвестные поля только внутри `settings` (`core/src/domain/settings/repair.ts`) |
| `limits.ts` | три предела: на проводе — `window` в `StartOp` и `messageCount` в теле хаба ≤ 5000 (недопустимые фикстуры — 5001 вместо нынешних 3001, `schemas.ts:648`, `hub.ts:594`); настройка — v1 ≤ 3000 и `windows.deep` ≤ 5000 в `settings.ext`; допуск — по `limits.deepMax` из bootstrap. Тест: 3001 не уходит, пока `deepMax < 5000` |
| `hub/ai.ts`, `hub/wire.ts`, `hub/routes.ts` | `HUB_AI_FEATURES` += `voice-script`, `fan-notes-fill`; новые флаги и возможности (§11); новые поля тела — под возможностями; в `CLIENT_FLAG_REQUIREMENTS` — только нужды транспорта клиента (§1.4) |
| `telemetry.ts` | окно на (хост, сборка), хост в id отчёта; метрики HF-13 |
| `errors-fansly.ts` (новый) + приложение А `docs/architecture.md` | `CG-FAN-*`, `CG-NOTE-*`, `CG-VOICE-*`, `CG-VAULT-*`, `CG-FNEW-*` |
| `vm/dock.ts` | `DockVM.chips`; строковые объединения `DockChipGroup`, `DockIconId` (их отображение и полноту держит `ui/kit`) |
| `vm/selectors.ts` | поверхность `header-slot`, панели Fansly |

Схемы ChatSpace и их фикстуры не меняются, кроме решённого выше: нынешние недопустимые фикстуры 3001 на проводе становятся
5001. Отрицательные фикстуры отчёта контракта: ChatSpace без одного и без всех якорей — отказ; Fansly без блока или без
обязательного якоря — не зелёный; прежний полный отчёт без `host` — принят. Приёмка отката настроек: новая сборка пишет →
старая читает и правит свои настройки (смена темы) → новая читает: настройки Fansly, глубина и регистрация скриптов
сохранились (на настоящем владельце хранилища, а не только разбором).

## 13. Тестовая инфраструктура

- **`TestHostConfig`** (в реестре хостов, только тестовая сборка): адреса страницы, API и сокета, фильтры `webRequest`,
  relay, поддельный хаб, манифест, автоматическая выдача и отзыв прав (механизм доказывает P6a). Сборка выпуска проверяет,
  что подмен и обходов loopback в ней нет.
- **Стенд Fansly** — `packages/testing/fixture-fansly/`: наше Angular-подобное приложение по структуре живого DOM, без кода
  Fansly, + `fixture-fansly.vite.config.ts` → `.cache/fixture-fansly`. У стенда **свой loopback-хост** (`localhost`; у
  ChatSpace — `127.0.0.1`): адрес, который подходит двум хостам, фон отвергает (S1b G-10). Стенд повторяет: пересоздание
  контейнера, поля и блока контакта при смене чата; пересоздание поля и блока контакта без смены адреса; галерею; модалку
  загрузки; `body.modal-opened`; строку «печатает».
- **Поддельный Fansly** — `src/fake-fansly/{api,socket,data,proxy,journal}.ts`. Его API — на loopback-адресе
  (`localhost`, `127.0.0.1`) или с TLS: CSP фона MV3 по умолчанию несёт `upgrade-insecure-requests`, и `fetch` фона на
  `http://` другого имени уходит на `https` и падает (P3a). Состав:
  - XHR-API: `ngsw-bypass`, `responseType: 'text'`, конверт, 429, `success: false`;
  - сокет `{t, d}`: эпохи, `t:1`, пинг `"p"`, события всех чатов (5/1, 5/10 с каскадом, 4/2, 5/22, 3/2), пакеты `t:10001`,
    повреждённые кадры;
  - журнал по происхождению вызова: «только список FS-NET-1» и «ни одного `/message/ack` от нас» проверяются **на
    сервере** — ловушка сети не видит запросов фона к loopback.
- **Сосед** — `src/fake-fansly/neighbor/`: эмуляция FBuddy по S5 §6. Режимы `off`, `after` (по умолчанию), `before`,
  `reinject`, `legacy`; флаги `+guard`, `panel=desktop|mobile|off`, `generic` (чужой Proxy над XHR и WebSocket — проверка
  устойчивости); 11 утверждений e2e; чужие запросы с 429.
- **Поддельный хаб** — страницы Fansly с 18-значными id (> 2^53), `groupId ≠ fanId`, флаги и требования по платформам
  (HF-2), правила по возможностям: HF-8, HF-9 (P6c1), HF-5 (P6c2), опека HF-3 (P6c3), HF-4а и операции сайта (P6c4);
  `aiNameFan` метит черновик по `conversationRef`; тела проверяются схемой вендоренного SDK (`fake-hub/ai-rules.ts`).
- **Проверка жеста** — на geckodriver (драйвер нашего e2e) с доверенными кликом и Enter; синтетический Enter из JS прячет
  проблему микрозадач.
- **База старого** (P3d) — тестовая сборка старого с адресами стенда (подмена при сборке), в том же headless Firefox, со
  звуками включёнными, с заметками в обоих видах, с соседом и без.
- **Perf** — `e2e/perf/fansly-perf-probe.e2e.ts`: 10 вкладок Fansly + ChatSpace, 100 переключений, 20 циклов оверлея,
  несколько ответов по 115 КБ перед снимком, медленный потребитель моста, 300+ чатов, сосед включён и выключен.
- **e2e и платный CI** — сюиты помечены сайтом для быстрого локального цикла и учёта цены; перед Ready — полный `pnpm e2e`
  (`AGENTS.md`), дымовой набор его не заменяет.

## 14. Приватность и безопасность

- Копии текста — по таблице FS-PRIV-1, плюс: `StartMemo.start` удаляется на обоих сайтах (держал весь `StartOp` с хвостом
  30 минут, а читается только `split`, S1b §2.1). Язык фана и отставание архива на Fansly считаются по метаданным (MAIN
  отдаёт `fanScript`), копии хвоста в изолированном мире нет.
- На диск — никаких текстов переписки: журналы отправок и прохода — только id; доказательство прохода — id; черновик
  приветствия — общий механизм «Новых» с жизнью 24 ч.
- Заголовки сессии — в памяти и `storage.session`; в логи и `client_health` не попадают (LG-026).
- Факты о FBuddy для владельца (S5 §2.8):
  - при организации FBuddy с журналом сообщений текст каждой исходящей ЛС уходит на `apiv2.fbuddy.net`;
  - FBuddy постит тела всех ответов API в `window` страницы;
  - пишет свою заметку фана.

  Наши фоновые приветствия идут мимо его фильтра слов и журнала.

## 15. Открытые вопросы

### 15.1 Решения владельца

Владелец ответил 2026-10-13 (X37); открытых вопросов по R20 у него нет.

| # | Вопрос | Решение |
|---|---|---|
| 1 | **Состав пилота**: старое расширение выключается на весь профиль Firefox, а 6 из 8 чаттеров `lora-1`/`ari-1` ведут ещё `lora-2`, `lora-3`, `lilly-1`, `lilly-2`; все 11 чаттеров Fansly связаны общими страницами (прод, проверено) | **все 6 страниц Fansly и все 11 чаттеров сразу**: пилот и есть переход по X34, инструменты нигде не пропадают, опека приветствий общая; запасной путь — чаттер снова включает старое. Отдельных профилей Firefox нет. Смешивать старое и новое на одной странице нельзя: X34 принимал риск двойных приветствий только при переводе страницы целиком |
| 2 | Hi на Fansly: кто доказывает начало разговора | вкладка по ответам страницы и проход «Новых»; хаб проверяет id и порог. Следствие: при **первом** открытии чата длиннее 24 сообщений Hi отказывает, как у старого; если вкладка видела переписку с начала — допускает; длинные — через «Новые». Правило хаба «пустая страница» отказывало бы почти всем новым чатам (0 из 593) |
| 3 | ⌘⇧L на Mac: наш Split или перевод FBuddy | наш Split; чаттеры с переводом FBuddy переназначают его |
| 4 | Аватар фана для Hi | из данных, которые страница уже загрузила (как у старого), только для Hi |
| 5 | Организация FBuddy (фильтр слов, журнал сообщений) | принято: наши фоновые приветствия идут мимо фильтра и журнала FBuddy |
| 6 | Согласие на телеметрию у пилотных чаттеров | включить на их профилях, иначе наблюдение пилота слепо |

**Глубина Recap — сделано.** По просьбе владельца агент поднял `aiTranscriptDeepMaxRows` на проде до 3000
(2026-10-13, аудитируемый CLI хаба `config set`, переопределение версии 1; до этого действовало 1500 по умолчанию). Старое
шлёт свою историю до 3000 сообщений (`fansly-chat/src/shared/constants.ts:176-178`); архивный путь хаба читает Fansly
глубоко после HF-6, а до тех пор настройка углубляет только полный Recap OnlyFans (вход модели до двух раз дороже —
предупреждение реестра). 5000 — после HF-6 и подсчёта токенов и цены. Откат — `config clear aiTranscriptDeepMaxRows`.

Решено без владельца (технически, X36): флаг черновиков `drafts` — только для Fansly, OnlyFans не меняется; имя расширения
в манифесте — «ChatGoose» с описанием «для ChatSpace и Fansly» (выпускной PR P16g; после обновления Firefox покажет новое
имя).

### 15.2 Спайк (P3a, P3b)

1. Ленивые чанки фона: `import()` из классического event page Firefox или `background.type: "module"` с WXT 0.21.4.
2. Регистрация изолированного скрипта рядом с MAIN: порядок, `persistAcrossSessions`, поведение после обновления; WAR Fansly
   при невыданных правах; `executeScript` баннера в открытые вкладки с правом на адрес.
3. Предикат жеста на geckodriver: доверенные клик и Enter, «проглоченная» отправка, поздний XHR из таймера и
   `MessageChannel`, микрозадачи между слушателями, смена маршрута, два быстрых жеста, `ack` рядом с POST, неоднозначные
   кандидаты, отправка с медиа; поля ответа `POST /message`; порядок квитанции и эха.
4. Прототип полного MAIN: размер gzip, установка; стоимость разбора кадра и ответа 115 КБ на ПК чаттеров; калибровка учёта
   памяти.
5. Как запросы скрипта другого расширения из той же вкладки выглядят в `webRequest` (`originUrl`, `documentUrl`, `tabId`);
   `onCompleted` для чужого 429.
6. Доставка `navigation.currententrychange` в изолированный мир.
7. Ответы `POST /vault/albums/media` и `POST /group/<id>/`.
8. Подписанные сборки (P3b): обновление без задержки, один запрос прав, появление `browser.webRequest` после выдачи,
   цепочки пробуждения фона §8.2. Если независимое пробуждение не даёт рабочего захвата сессии на целевом Firefox, §8.2
   возвращается на проектирование до P9b.

Пункты 1–7 закрыты спайком P3a 2026-10-13 — `spike.md`: результаты, числа и правки этого документа (§3.1, §3.3, §4,
§5.3–§5.5, §5.9, §6, §7.11, §8.2). Что P3b проверяет с их учётом — там же, в конце.

## 16. Где что строится

| Раздел | PR (`plan.md`) |
|---|---|
| §1 два сайта | F2–F10 |
| §3 сборка и фон | F1, F2, F3, P16a |
| §4 права и открытые вкладки | P9a, P14c |
| §5–§6 MAIN и мост | P4a2, P5, P7a0, P7a, P7b, P7f, P7g |
| §7 изолированный мир | P7c–P7e, P7h, P7i, P8d, P11a, P11b, P12c, P13a |
| §8 фон | F1, P9a–P9e, P10a–P10d, P11b, P11c, P12a–P12b2, P13b, P14a |
| §9 потоки | e2e каталога (`plan.md` §3) |
| §10 производительность | P3d, P16a, P16b, P16f, реестр байтов |
| §11 хаб | этап 2 |
| §12 контракты | F7, P4a1–P4c |
| §13 стенд | P6a–P6d, P7a0 |
