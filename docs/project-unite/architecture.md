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
  lazy: HostLazyBuild;                                          // своя сборка ленивых чанков (§3.2), F2b
  background?: { chunk: string };                               // фоновый модуль сайта (§3.3), F1
  mainWorldSources: readonly string[];                          // папки кода мира страницы: гейт `guard`
  budgets: {                                                    // строки `pnpm size`, по порядку
    scripts: readonly { entry: string; label: string; gzipBytes: number }[];
    contracts: readonly { label: string; entry: string; gzipBytes: number }[];  // пробы контрактов сайта (F2b)
  };
  contractCheck: { module: string; bundlesRootEnv: string };   // модуль контракта; переменная с корнем копий бандлов
  archiveMarkers: { code: readonly RegExp[]; libraries: readonly RegExp[] };  // чужой код, который не уходит никогда
  test: TestHostConfig;                                         // подмены тестовой сборки (§13); пока `pageMatches` стенда
}
interface HostLazyBuild {
  root: string;                                   // папка в XPI: `<root>/<вход>.js`, общие чанки — `<root>/chunks/`
  entries: Readonly<Record<string, string>>;      // имя входа → исходник (от `apps/extension/lazy`), в порядке входов сборки
  layers: readonly string[];                      // слои по порядку бюджетов, первый — док; [] — режет сам сборщик
  beforeTheDock: readonly string[];               // слои до дока: общее с ними у дока — чанк `kernel`
}
interface RuntimeHostRow { matches: readonly string[]; quietDomains: readonly string[] }  // [] — сайт не «тихий» (X4)
type ScriptSpec = { entry: string; file: string; world: 'MAIN' | 'ISOLATED'; registration: 'manifest' | 'dynamic' | 'execute' };
```
Из реестра выводятся: манифест и его проверка (`build/manifest.ts`), входы WXT, **сборки ленивых чанков по сайтам**, WAR по
сайту, хосты RPC фона и звука, регистрация скриптов, онбординг страниц, гейты (`MAIN_WORLD_*`, `ISOLATED_BUNDLES`), строки
бюджетов, `archive-check`, `host-contract-check --host`. Код одного сайта никогда не импортирует запись другого.
Сборки ленивых чанков (как построено в F2b): `lazySitesOf(test)` даёт сборки сайтов реестра по порядку, `buildLazyChunks`
собирает их одну за другой, каждую в свою папку, `finalizeManifest` пишет по записи WAR на сборку — для страниц её сайта.
До P7a0 у тестовой сборки с одним сайтом была ещё пустая вторая (`SECOND_LAZY_BUILD`, `lazy/second-site/empty.js`) —
чтобы путь «две сборки рядом» работал в e2e; с записью Fansly (P7a0) её место заняла сборка `lazy/fansly` в обоих видах
сборки, а заглушка удалена.

**Сделано P7a0 (запись Fansly).** `hosts/fansly.ts`: оба скрипта — `fansly-main.js` (MAIN) и `fansly.js` (ISOLATED) —
`registration: 'dynamic'` в выпуске **и в тестовой сборке**; сборка `lazy/fansly` (пока один вход — `bridge-validation`,
слоёв нет); права — опциональные `https://fansly.com/*`, `https://apiv3.fansly.com/*` и `webRequest`; стенд —
`FANSLY_TEST` (`localhost`); строки бюджета 16 и 30 КиБ (§3.1); маркеры архива (папка копии бандла, атрибут
`_ngcontent-…` Angular, пакеты `@angular/*`); модуль проверки контракта — P7h. Строка рантайма —
`hosts/runtime/fansly.ts` (адреса, `FANSLY_LAZY_ROOT`); в P7a0 в таблицу `RUNTIME_HOSTS` она **ещё не входила** (P9a подключает её для рукопожатия, см. §4): таблицу целиком
читают ядро фона и страницы, её строка Fansly двигает их байты и включает разводку `PerHost` (хосты RPC вкладок, модули
фона, срезы фич, страницы, платформы bootstrap старого хаба) — это P7i и P9a вместе с регистрацией вкладки и
скриптов.

Рантайму достаётся отдельная лёгкая таблица — `apps/extension/src/hosts/runtime/{index,<сайт>}.ts`: адреса сайта (`matches`,
`quietDomains`), `isQuietHost`, loopback тестовой сборки; вид и платформа — из контрактов (`HostKind`, `Platform`, P4a1).
Корень ленивой сборки сайта (`CHATSPACE_LAZY_ROOT` в `runtime/chatspace.ts`) — константа рядом со строкой, не поле таблицы:
он нужен только вкладке сайта (вход отдаёт его адаптеру, `HostAdapter.lazy.root`, §1.3), фону и страницам — нет.
Входы сайта читают только свою строку (`runtime/<сайт>.ts`), фон и страницы — всю таблицу; запись реестра берёт адреса из
строки, а не наоборот. Поля сборки в бандлы не попадают: реестр не импортирует никто из того, что уходит в XPI, и сама
таблица его не читает (правило `host-registry-build-only` в `.dependency-cruiser.cjs`); тест манифеста и гейт `build-data`
(`pnpm gates`, §1.8) ищут поля сборки в собранных файлах. Разводка сайтов в корне композиции (хосты RPC, источники звука) пишется `satisfies PerHost<…>`: новая
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
  readonly hotkeyClient: HotkeyClient;                          // клиент схемы клавиш: 'extension' | 'fansly' (§1.5, F5)
  readonly lazy: HostLazyPlan;                                  // { root }: где лежит своя ленивая сборка
}
interface HostStartEnv extends TabEnv { redeem; lazy(entry); navInsertTimeoutMs(); onDiagnostic(diagnostic) }
interface StartedHost<P> { staleHosts; mounts: HostMounts; theme: HostThemeSource; bridge: Promise<HostBridge | null>; host: Promise<P> }

// половина приложения — чанк tab-app сборки сайта
interface HostAppAdapter<P extends HostPort = HostPort, C = unknown> {
  liveConfigOf(bootstrap: Bootstrap | null, fuse: SendFuseState | null): C;  // у ChatSpace — часть B (тап, X8, пометка AI)
  configure(host: P, config: C): Promise<unknown>;                         // вкладка применяет только новое значение
  readonly features: FeatureSlice;                                         // срез манифеста фич сайта (§1.4, F4)
  readonly contract: HostContractShape;                                    // ожидаемый набор якорей сайта (§7.12, F7)
  ui(theme: HostThemeSource): HostUiProfile;                               // профиль сайта для интерфейса (§1.5, F5)
  ai(lazy: <T>(entry: LazyEntryName) => Promise<T>): AiHostPolicy | Promise<AiHostPolicy>;  // политика AI сайта (§1.6, F10)
}
```
- **Половина приложения.** Срез манифеста фич — `HostAppAdapter.features` (§1.4, сделано в F4); порты политики AI —
  `HostAppAdapter.ai` (§1.6, §9.1, сделано в F10). Профиль сайта (§1.5) разложен по тому же правилу (сделано в F5):
  клиент схемы клавиш (`HostAdapter.hotkeyClient`) читает ранний диспетчер — он в ранней половине; палитра, вариант и
  лист дока, фразы — с приложением (`HostAppAdapter.ui`).
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
Фильтр в рантайме оставил бы записи другого сайта в бандле — так до F4 `FEATURE_POLICIES` целиком лежал в
`background.js`. Инструменты (паритет, гейт полноты) читают все три файла; строки паритета живут в `tools/parity` по
ключу фичи.
```ts
// contracts/src/features/types.ts — контрактам доступен только zod (.dependency-cruiser.cjs:63)
interface FeatureCommon {
  kind: 'ai' | 'board' | 'panel' | 'host-action' | 'service';
  chip?: { group: DockChipGroup; priority: number; icon: DockIconId | null };  // объединения в contracts/src/vm/dock.ts; null — слово на любой ширине
  hotkey?: HotkeyActionId;                                                      // строковое объединение в контрактах
}
interface Requirement<F = ClientFeatureFlag, C = HostCapability> {  // всё внутри — AND
  flags: readonly F[];                            // флаги страницы из bootstrap
  hostCapabilities: readonly C[];                 // возможности отчёта сайта
  clientNeeds?: readonly ClientHubCapability[];   // что нужно собственным вызовам клиента сверх решения хаба
}
interface FeatureOnHost<F, C, S = MountSurfaceKind> {
  base: Requirement<F, C>;                                                     // общее для всех действий
  actions: Partial<Record<'generate' | 'insert' | 'send', Requirement<F, C>>>; // своё у действия, вдобавок к base; нет ключа — у фичи на сайте нет такого действия
  surfaces: readonly S[];
  source?: 'hub' | 'host-pass' | 'page';
}
```
Иконки и группы чипов отображает `ui/kit` (`kit/chips.ts`) — его тест проверяет, что у каждой группы есть слот, а
каждая иконка нарисована; действия клавиш проверяет тест `core/src/domain/hotkeys` против вендоренной схемы.

**Как построено в F4.** Файлы манифеста — только подпути (`@cg/contracts/features/{types,common,chatspace,fansly}`):
корень `@cg/contracts` импортирует ранний изолированный бандл, и всякий модуль, который корень реэкспортирует, стоил бы
ему байтов. Файл сайта может называть флаги, возможности и поверхности, которых в общих словарях ещё нет (параметры
`Requirement`): у Fansly это `FanslyCapability` и `FANSLY_SURFACES_AHEAD` (`header-slot` и панели); свои флаги Fansly
(`drafts`, `voice`, `notesFill`, `notes`, `vault`, `registration`) F4 называл впереди словаря (`FANSLY_FLAGS_AHEAD`), P4b3
перенёс их в `CLIENT_FEATURE_FLAG_NAMES`. Называет их только файл Fansly: флаги файла ChatSpace — `ChatSpaceFeatureFlag`,
общий словарь без этих шести (их нет на странице OnlyFans, HF-2), так что компилятор не пустит их туда;
флаг, которого страница не перечисляет, читается `flag_off`. Срез сайта собирает корень его композиции:
`apps/extension/src/composition/features/chatspace.ts` (`featureSlice(FEATURES_COMMON, CHATSPACE_FEATURES)`), фон и
страницы берут срезы по сайту из `composition/features/index.ts` (`satisfies PerHost<FeatureSlice>`), вкладка — из
половины приложения своего адаптера (`HostAppAdapter.features`, §1.3). Срез Fansly ядро фона импортировать не может:
`features/fansly.ts` — файл Fansly, и граф ядра его не содержит (§1.8, правило `background-core-graph`). Ядру его
отдаст чанк `bg/fansly` при старте — порт кита рядом с прочими портами Fansly (§3.3; решает P9a); до того
`featuresOf('fansly-web')` в фоне — `null`, и фон ничего Fansly не допускает. Тест сборки
`apps/extension/test/feature-slices.test.ts` дописывает в `features/fansly.ts` новую запись и собирает ленивые чанки
ChatSpace: ни байта разницы, и сборка этот файл не загружает.

Чистая функция `core/src/domain/features/admission.ts`: `admission(slice, id, action, facts)`, где `action` —
`generate` / `insert` / `send` или `null` (сама фича: `base`), `facts` — как читает спрашивающий: `flag(name)` (флаг
страницы; у шлюза токенов в фоне — свежий bootstrap слоя хаба), `serves(capability)` (что объявил bootstrap — для
`clientNeeds`), `host?(capability)` (отчёт сайта; во вкладке есть, в фоне нет — возможности сайта проверяет вкладка).
`onPage(bootstrap, page, host?)` даёт факты одной страницы. Ответ:
- `{state: 'absent'}` — фичи нет в срезе сайта (или у неё нет такого действия): не рисуется, клавиша зарезервирована;
- `{state: 'off', reason}` — не выполнено что-то из `base` или требования действия, первое по порядку: флаг страницы
  (причина хаба: `flag_off`, `disabled`, `hub_not_ready`…), `clientNeeds` (`hub_not_ready`), возможность сайта
  (`host_degraded` → CG-HOST-CONTRACT);
- `{state: 'on'}`.
Права и настройки сайта (`via-tab`, «Включить Fansly») добавляют в факты PR Fansly, которые их вводят (P9a, P14b1).
`admissionState` читает ответ как флаг (`FlagState`), чтобы слова и коды отказа были прежние (`flagReasonVm`,
`flagRefusal`); `absent` — как `platform_unsupported`.

Правила:
- Решение хаба о странице клиент не повторяет: платформу и готовность хаба (`hub_not_ready`) хаб уже учёл в
  `pages[].features[flag]` по своей таблице `CLIENT_FEATURE_REQUIREMENTS`. До F4 клиентская `CLIENT_FLAG_REQUIREMENTS`
  эту таблицу дублировала (и для `newcomers` требовала `audience-new-v1` — на Fansly неверно). С F4 в ней только нужда
  транспорта самого клиента — `{freshText: ['context-v1']}`, она же `clientNeeds` у `fresh-text` в обоих срезах;
  `pageFlagState` (`core/src/domain/ops/flags.ts`) читает одну функцию страницы. Таблица хаба повторена только в
  поддельном хабе (`HUB_FEATURE_REQUIREMENTS` в `packages/testing/src/scenarios/hub/http.ts`, по `bd3eec06`):
  P6c1 добавил столбец Fansly HF-2; `HUB_FEATURE_CAPABILITIES` выводится из столбца OnlyFans, того же, что в `6ee3d627`.
  Что таблица флагов ChatSpace на нынешнем хабе та же, держит `packages/testing/src/fake-hub/flag-table.test.ts`:
  прежнее правило, замороженное по `main`, против нового на каждом пресете поддельного хаба и на каждом отставании хаба.
- Генерация, вставка и отправка допускаются раздельно. «Только копировать» (FS-DOCK-3) — состояние чата, его
  вычисляет `core/src/application/ai/workspace.ts` (`readSituation`) — по допуску `insert` у `reply`.
- `admission` читают: док (действия, чипы, «только копировать»), старт генерации во вкладке и в планировщике фона
  (`startPrecondition`, свежий текст), справочник клавиш (строки фич, которых у сайта нет, не рисуются), popup (счёт
  «Новых» — только где они из хаба), токен `insert` (`background/token-gate.ts`: допуск вставки хоть одной фичи
  сайта). `FEATURE_FLAGS` и `FEATURE_POLICIES.flag` удалены. Доски, «Статус» и фоновые службы читают флаги своей
  страницы, как прежде: им допуск понадобится с первой фичей Fansly, которая там отличается (P9*, P10*).
- Вне манифеста и корней композиции нет второй таблицы платформенных условий (гейт §1.8). Отрицательные фикстуры F4:
  выключенный `insertion` не закрывает генерацию; отправка из превью ChatSpace требует и `previewSend`, и `newcomers`.

| Фича | ChatSpace | Fansly |
|---|---|---|
| `reply`, `fix`, `hi`, `ping` | `base` — без флагов (мастер-выключатель и версию проверяет хаб); `insert` — `insertion` | `base` — `drafts` (новый флаг, только Fansly, HF-12); `insert` — `insertion` |
| свежий текст для них | `freshText`, `clientNeeds: context-v1` | то же |
| `recap`, `review`, `coach` | `recap`, `review`, `coach` | те же |
| `spenders`, `fan-panel`, `sound` | `spenders`, `fanPanel`, `sound` | те же; `groupId` фана в Spenders — §8.11 |
| `newcomers` | `base` — `newcomers`, источник — хаб (`audience-new`); `send` — вдобавок `previewSend` и возможности сайта `previewSend`, `receipt` | `base` — `newcomers`, источник — проход (Б17); `send` — `newcomers` (HF-3), без `previewSend` |
| `preview-send` | `previewSend`; возможности сайта `previewSend`, `receipt` (`newcomers` не нужен: его просит только приветствие) | `absent` |
| `voice` | `absent` | `voice` (скрипт и озвучка) |
| `notes`, `notes-fill` | `absent` | `notes`; заполнение — `notesFill` |
| `registration`, `vault` | `absent` | `registration`, `vault` |
| `via-tab` | `absent` | настройка, без флага |
| `navigation`, `palette` | `navigation`; окно палитры — без флага, её переходы в чаты — `navigation` | `absent` до P17 |

`wsTap` — только ChatSpace: он регистрирует отдельный тап `chatspace-ws.js`. У Fansly наблюдение сети — часть
единственного MAIN, его регистрируют «Fansly включён» и права (§4).

### 1.5 Профиль сайта для интерфейса

Как построено в F5 (`contracts/src/vm/host-profile.ts`, 1.15.0):
```ts
interface HostUiProfile {                                         // в MountDeps.profile каждой поверхности вкладки
  palette?: ValueSignal<HostPalette>;   // HostPalette = Record<`--color-om-${string}`, string>; нет — палитра страницы по наследованию
  dock: { variant: DockVariant };       // 'chatspace' | 'fansly' → data-dock-variant на хосте
  sheet?: HostSheet;                    // { id, css }: правила варианта дока и иконки чипов сайта
  phrases: Record<Locale, HostPhrases>; // целые фразы с именем сайта (§3.4): { site, onSite, siteAccount, sitePlatform }
}
// клиент схемы клавиш — в ранней половине адаптера: HostAdapter.hotkeyClient ('extension' | 'fansly', §1.3)
```
- **Половины.** Профиль отдаёт половина приложения адаптера (`HostAppAdapter.ui(theme)` — один раз, при старте
  приложения; `theme` — тема сайта, как её показывает страница, для палитры, которая следует за страницей). Клиент схемы
  клавиш читает ранний диспетчер (`createKeyResolver(platform, client)`, `core/src/domain/hotkeys/resolver.ts`), поэтому
  он — поле ранней половины `HostAdapter.hotkeyClient`, а не профиля. Профиль ChatSpace —
  `host-chatspace/src/isolated/profile.ts` (`CHATSPACE_UI`, подпуть `@cg/host-chatspace/isolated/profile`): его
  импортируют только половина приложения ChatSpace (чанк `tab-app`) и галереи стенда.
- **Цвета.** Kit по-прежнему читает `--color-om-*`. У ChatSpace палитры в профиле нет: его тройки стоят на `<html>` и
  доходят до наших хостов наследованием. Сайт, у страницы которого таких переменных нет, отдаёт их в `palette`; на Fansly
  адаптер переводит переменные страницы (`--blue-1`, `--dark-1…8`, `--font-1`, `--border-color` и др., S2 Q9) в эти
  тройки (P8d). Монтирование kit (`ui/kit/mount.tsx`) ставит их на наш хост правилом `:host { … }` одного общего листа
  (`paletteSource`, id `cg-host-palette`, `ui/kit/tokens.ts`): страница не видит инлайн-стиля, все наши корни документа
  делят один лист, и новое значение сигнала переписывает его во всех сразу.
- **Вариант дока** — атрибут `data-dock-variant` на хосте рядом с `data-scheme` (имя нейтральное, X22; его держат
  `mount.dom.test.ts` и `sentry-gate.e2e.ts`). Правила ширины и иконки чипов варианта Fansly приходят листом стилей
  из сборки Fansly (`profile.sheet`, после листов поверхности), а не правилами в общем `ui/src/dock/styles.ts`. Лист —
  данные, а не `() => Promise<CSSStyleSheet>`: половина приложения сайта и так ленивая, а лист, пришедший после первого
  кадра, перерисовал бы док (скачок ширины).
- **Что не в профиле.** Порог низа ленты (keep-bottom: у ChatSpace 100 px, `NEAR_BOTTOM_PX`; у Fansly 350 px) и слои
  под модалками сайта — параметры старта хоста в ранней половине: keep-bottom и слои перенёс в `host-kit` P5
  (`host-kit/src/isolated/{keep-bottom,hosts}.ts`, порог там пока константа), параметром старта сайта его делает P7d
  вместе с порогом Fansly. Общий интерфейс их не читает. Таблица клавиш сайта (уступка модалкам, Enter) — ранний щуп
  `keyProbe` (P7i). Ширины — лист варианта.
- **Фразы (F9b).** Общие тексты сайт не называют: вместо «ChatSpace», «в ChatSpace», «OnlyMonster», «OnlyFans» в каталогах
  стоят `{site}`, `{onSite}`, `{siteAccount}`, `{sitePlatform}` — имена полей `HostPhrases` (`HOST_PHRASE_NAMES`). Их
  заполняет порт I18n из фраз сайта, от имени которого он говорит, на своём языке: во вкладке — `profile.phrases`
  (`createLiveI18n(…, { phrases })` в `tab/app.ts`; профиль читается один раз, до порта); на страницах расширения —
  фразы сайта сборки (`PageEnv.phrases`, у переводчика контроллера тоже), а платформа страницы хаба называется фразой
  того сайта, который её обслуживает (`PageEnv.platformPhrases` → `PageTagVM.platformName`, «OnlyFans · lora-vip»).
  Порт без фраз (тест поверхности без сайта) оставляет плейсхолдер видимым. Фразы — в пакете текстов сайта
  `core/src/domain/hosts/<сайт>/i18n` (ChatSpace — `CHATSPACE_PHRASES`, их берёт его профиль; Fansly — `FANSLY_PHRASES`,
  его профиль возьмёт их в P8d); страницы несут оба пакета. Слово в слово: каждый из 2 654 текстов каталогов (ru и
  en, формы множественного числа тоже) с фразами ChatSpace равен тексту `main` до F9b; поменялись 142 шаблона.
- **Чипы — данными.** `DockVM.chips: ChipVM[]` (добавочно; `actions` для замороженных семи остаётся) строится из среза
  манифеста и `admission`. Чип 🎙 — запись в манифесте, а не ветка в `Strip`.
- **Слоты.** Поверхность `header-slot` есть только у Fansly; что в неё рисуется («Регистрация», «Заметки»), решает срез.
- **Где сайты могут различаться:** цвета, плотность, вариант раскладки, набор и порядок чипов, слоты, фразы. **Нельзя:**
  копировать компонент под сайт. Если вид расходится сильнее — отдельная поверхность сайта в `ui/src/hosts/<host>/`,
  зарегистрированная в его срезе.
- Галерея рисует каждую поверхность в профиле каждого сайта: параметр `?host=` у галерей kit, дока и досок
  (`packages/testing/src/kit/profiles.ts`); по умолчанию — профиль ChatSpace, как его монтирует вкладка; `?host=test` —
  тестовый второй сайт (своя палитра и лист варианта), профиль Fansly с его видом добавляет P8d (`?host=fansly`).
  Визуальную правку проверяют по снимкам обоих.

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
| политика AI | `CHATSPACE_AI` (`core/src/application/hosts/chatspace/ai.ts`, в чанке `tab-app`; F10) | порты `AiHostPolicy`: доказательство, предпроверка, поля запроса сайта, вердикт и его отпечаток; реализации — в слое `ai-fansly` |
| тексты | общий каталог | пакеты `i18n-ru-fansly`, `i18n-en-fansly` своей сборки |
| фоновые службы | `bg/chatspace` (после F1) | `bg/fansly` |
| телеметрия | окно `chatspace:<сборка>` | окно `fansly-web:<сборка>` |

**Политика AI (как построено в F10).** Что в старте генерации и в её результате решает сайт, общий контроллер AI
(`core/src/application/ai`) спрашивает у политики сайта и сайта не называет. Типы — в `contracts/src/ops.ts`
(`AiHostPolicy<P, F>`, `AiProofAsk`, `AiStartFields`), готовая модель пометки — `ResultMarkVM` (там же, рядом с `OpView.stale`: модели видов импортируют `ops`, не наоборот);
политику отдаёт половина приложения адаптера (`HostAppAdapter.ai(lazy)`, §1.3), её зовут один раз при старте
приложения вместе с чанками дока — сайт, у которого политика лежит в своём ленивом чанке (Fansly: `ai-fansly`), грузит
его здесь. Пять портов:
- **предпроверка** `preflight(feature, window, proof)` — причина сайта, по которой функция не стартует. Общие правила
  (чат грузится, Fix без черновика, мало истории для Review и полного Recap, `core/src/domain/features/gates.ts`)
  идут первыми, потом — правило сайта. Без доказательства её спрашивают вид дока и первая проверка старта; ещё раз — с
  доказательством старта, до токена: так сайт, которому для отказа нужно доказательство (Hi на Fansly, FS-AI-2), отказывает,
  ничего не потратив;
- **доказательство** `proof(host, ask)` — что старт собирает в открытом чате после предпроверки, только из памяти
  страницы; `ask.fresh` — сколько свежего текста можно взять (D-14), `null` — нельзя. Ответ `null` — собирать нечего,
  ничего не ждём; отказ или ошибка — доказательства нет, старт идёт без него;
- **поля запроса** `fields(proof)` — поля `StartOp` от сайта: `fresh` общий план обрезает по D-14, остальное кладёт в
  старт как есть, и его проверяет схема `StartOp` (неизвестное поле — отказ CG-UI-FAILED, до фона не доходит); у Fansly
  это `proof` — `CoverageProof` из P4b1, в который его политика превращает снимок (P8b1): в общий слой ничего дописывать
  не надо;
- **отпечаток** `fingerprint(proof)` — что вкладка хранит от доказательства при операции, пока жив результат
  (`StartMemo.fingerprint`), для вердикта; никогда не текст (F8). Ключ запроса фона с отпечатком доказательства —
  P8b3 (`RequestIdentity.proofDigest` от P4b1), не этот порт;
- **вердикт** `verdict(view, fingerprint)` — готовая модель пометки общего результата (`ResultVM.stale`); общий `Result`
  её только рисует.

ChatSpace (`CHATSPACE_AI`) — ровно прежнее поведение контроллера: доказательство — видимый хвост
(`readVisibleTail`), и только когда старт может нести свежий текст; поля — `{fresh: хвост}`; предпроверка — Hi не
предлагается при окне больше десяти сообщений (AI-031), Ping не блокируется (AI-036); отпечатка нет; вердикт — пометка
фона «фан написал новое». Политика ChatSpace лежит в его `tab-app`: в общем слое `ai` остались только вызовы портов.
Fansly — снимок `freshness`, `StartProofV1` и вердикт таблицы §3.5 спецификации в `ai-fansly` (P8b1–P8c); правило Ping
для активного фана (до F10 — ветка `platform === 'fansly'` в общем `pingGate`, ни разу не вызванная с сегментом) — его
предпроверка (P8c).

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

Ранние гейты построены в F9a. Граф — `.dependency-cruiser.cjs` (`pnpm lint`); литералы, байты, маркерные строки и поля
сборки — `tools/gates/sites.ts` (`pnpm gates`); чей файл чей — одна таблица `tools/gates/site-paths.cjs`, её читают и
граф, и гейты. У каждого правила — отрицательные фикстуры (`tests/lint-boundaries.test.ts`, `tools/gates/sites.test.ts`).

- **Чей файл.** Файл сайта — файл, **названный сайтом**: путь, в котором имя сайта стоит целым словом имени папки или
  файла. Это и есть «по принадлежности, а не по одной папке»: у Fansly — `packages/host-fansly/**`,
  `packages/fansly-api/**`, `**/hosts/fansly/**`, `apps/extension/src/hosts/fansly.ts`,
  `apps/extension/src/entrypoints/fansly*`, `apps/extension/lazy/fansly/**`, `apps/extension/bg/fansly.ts`,
  `packages/contracts/src/**/*fansly*.ts` (в том числе `features/fansly.ts`, `errors-fansly.ts`, `bridge-*-fansly.ts`,
  `tab-messages-fansly.ts`, `send-fansly.ts`, `fansly.ts`), пакеты текстов Fansly — и всё, что позже назовут так же.
  Имени не верят на слово: правила графа `chatspace-graph-without-fansly` и `background-core-graph` падают, если бандл
  ChatSpace или ядро фона достигают такого файла. Одно исключение: строка рантайм-таблицы
  `apps/extension/src/hosts/runtime/<сайт>.ts` файлом сайта **не считается** — таблицу целиком читают ядро фона и
  страницы расширения (§1.2), её правка двигает байты, которые грузят оба сайта, это общий код.
- **Байты по сайтам.** Сравнение файлов ChatSpace с `main` идёт в **каждом** PR — как именно, ниже («Как сравниваются
  байты»). Файлы ChatSpace: его скрипты из реестра хостов (`content-scripts/chatspace-main.js`,
  `content-scripts/chatspace.js`, `chatspace-ws.js`), вся его ленивая сборка `lazy/chatspace/**`, его чанк фона
  `bg/chatspace.js` и ядро фона `background.js` — всё, что грузят вкладка ChatSpace и её фон. Если дифф трогает только
  файлы Fansly, разница — ноль; остальные PR называют дельту по реестру байтов (§3.2).
- **В бандлах ChatSpace нет данных `fansly-web`.** Маркерные строки выводятся при запуске гейта из исходников: имена,
  которые несут только файлы Fansly, — типы моста (`fx.batch`), запросы вкладки (`fansly.voice.*`), коды `CG-FAN-*`,
  ключи текстов, адрес API. Маркер — имя из реестра (имя через точку, код CG, абсолютный адрес), а не слово и не
  токен веб-платформы; то, что называет и общий код или вендоренный пакет (вид хоста, платформа, адрес из схемы хаба),
  маркером не становится — бандл ChatSpace несёт это по праву. Ни одного маркера — ошибка: гейт, который ничего не
  ищет, не проходит.
- **Литералы сайтов** — по AST и по смыслу. Общий код (`core/src/**`, `ui/src/**`, `hub/src/**`) не называет сайт:
  нет строки, равной значению `HostKind` или `Platform`, сравнения с ней, таблицы с таким ключом и чтения такого
  ключа. Значение считается, где бы оно ни стояло, — в сравнении, `case`, литеральном типе, ключе без кавычек, — и
  считается только значение: `platform === 'mac'` (ОС), `host === null`, комментарий, более длинный текст, ключ текста
  и имя переменной гейт не трогает. Свой код сайта (`**/hosts/<host>/**`, пакет `host-*`, любой файл, названный сайтом)
  может называть свой сайт, но не чужой. С F9b общий код — это и `host-kit/src/**`: общая механика страницы тоже не
  знает сайта. Не проверяются: `admission.ts`, контракты (`ids.ts`, `hosts.ts`, манифест фич), `platform`, корни
  композиции, реестр хостов, тесты. Ранний гейт (F9a) стоял со списком долга §1.9; финальный (F9b) убрал из него всё,
  чем не владеет PR в работе, — остаётся только запись PR, который ещё не слит, и уходит вместе с ним (на F9b — одна
  запись F10). Запись списка — файл, значение и число вхождений, а не строка: строки едут от любой правки файла, число
  меняется только когда литерал появился или ушёл. Гейт падает на литерале вне списка, на записи, которую код уже
  перерос (число надо снизить или запись убрать), и на записи PR, отмеченного в плане сделанным, — список может только
  сокращаться.
- **Имена сайтов в общих текстах** («ChatSpace», «OnlyMonster», «OnlyFans», «Fansly») запрещены (F9b, гейт `site-name`
  в `pnpm gates`): ни строка, ни кусок шаблона, ни текст JSX общего кода не называет сайт — только его фразы (§1.5).
  Имена берутся из фраз пакетов текстов сайтов (`SITE_NAMES`), целым словом, по AST: комментарий, ключ текста
  (`popup.needsChatSpace`) и идентификатор не в счёт. Свой код сайта не называет чужой.
- **Полнота манифеста** (F9b; `tools/gates/manifest.ts`, проверяет `tools/gates/manifest.test.ts` в `pnpm test`: модули
  манифеста — контракты с импортами без расширения, их читает Vitest, а не голый Node): каждая `FeatureId` (и операция
  сайта, когда у сайтов появится свой словарь — P4b3), каждый флаг хаба (и флаги Fansly «впереди» словаря), каждая
  поверхность, каждое действие справочника (`CATALOG_ACTION_IDS`, карта строк к фичам — `ROW_FEATURE` шпаргалки) и
  каждый ленивый вход сборки сайта упомянуты записью — ключом, требованием или переключателем (`switches`, 1.15.0),
  поверхностями, — либо названы собственными приложения (страницы расширения, тосты, шпаргалка, базовые чанки) в
  списках гейта поимённо. У каждой записи каждого сайта есть строки паритета (`FEATURE_PARITY`), запланированные на его
  хосте; как только владелец одной из них на этом хосте сделан (рабочие пакеты ChatSpace; PR R20 с `✓`), её называет
  e2e на стенде этого сайта. Закрытие строк поштучно — по-прежнему P1b (`pnpm parity`).
- **Граф пакетов** (`.dependency-cruiser.cjs`):
  - код Fansly импортирует только код Fansly, индекс реестра хостов и корень композиции страниц расширения — страницы
    несут оба сайта (`fansly-code-only-from-fansly`); из того, из чего собраны бандлы ChatSpace, файл Fansly не
    достижим (`chatspace-graph-without-fansly`), из ядра фона — тоже, вместе с чанками сайтов и опекой ChatSpace
    (`background-core-graph`);
  - реализацию ChatSpace (пакет `host-chatspace`, папки `hosts/chatspace/`) импортирует только свой код: входы
    ChatSpace, его половины адаптера и два ленивых входа, которые их несут (`chatspace-code-only-from-chatspace`);
  - `host-kit`: то, что несёт MAIN (`main`, `common`), ничего не импортирует; `isolated` — контракты,
    `core/domain/text`, zod; пакет не знает ни одного сайта (`host-kit-*`). `host-chatspace` и `host-fansly`: MAIN —
    свой код и MAIN-часть `host-kit`; изолированный — `host-kit`, контракты, `core/domain/text`, zod
    (`host-main-self-contained`, `host-isolated`, `host-fansly-*`); вход MAIN Fansly — только `host-fansly/main`,
    помощники WXT и своя строка рантайм-таблицы (`fansly-main-entry-self-contained`);
  - `fansly-api`: контракты, `core/domain`, zod — без хаба, SDK и `platform` (`fansly-api-graph`); импортирует его
    только чанк `bg/fansly` (`fansly-api-only-in-its-chunk`);
  - кадр relay — контракты и порт `platform`, без ядра, интерфейса и `fansly-api` (`relay-entry-graph`);
  - чанки `bg/*` — контракты, `core` (домен и службы), `fansly-api` (его берёт только `bg/fansly`), zod, типы кита;
    хаб, SDK и `platform` — только через кит (`background-chunk-boundaries`, `background-chunk-through-the-kit`);
    чанк одного сайта не импортирует чанк другого (`background-chunks-apart`).
  Пакеты, которых ещё нет (`host-kit` — P5, `host-fansly` — P7a0, `fansly-api` — P9b, relay — P9c), получили граф
  заранее: PR, который приносит пакет, меняет правило в том же диффе, если ему нужно иное, и объясняет зачем.
  `host-fansly` (P7a0) лёг в граф как написан; добавлены правила ESLint пакета (MAIN — как у ChatSpace, изолированный —
  без пакета ChatSpace и `fansly-api`), входа MAIN Fansly и ленивых входов `lazy/fansly/`, а `hub-unreachable-outside-
  background` считает корнями и `lazy/fansly/`.
- **Поля сборки** реестра хостов и строки паритета в рантайм-бандлы не попадают: граф — `host-registry-build-only`,
  собранные файлы — гейт `build-data` (метки бюджетов, исходники ленивых входов, модуль и переменная проверки
  контракта, папки MAIN, маркеры архива; номера отрицательных проверок реестра исключений).

**Как сравниваются байты ChatSpace (решение F9a).** Сравнение с `main` в каждом PR — без второй сборки:

- В репозитории лежат **закрепы** `tools/gates/chatspace-bytes.json`: размер и sha256 каждого файла ChatSpace в
  выпускной сборке, по строке на файл (сейчас 47 файлов). `pnpm gates` — шаг `pnpm check` после `pnpm build` — считает
  то же по только что собранному и падает на любом расхождении, называя файл и сколько байт ушло или пришло. На `main`
  закрепы равны сборке `main` (иначе `main` красный), поэтому сверка с ними и есть сравнение с `main`.
- PR, который двигает байты ChatSpace, **переписывает закрепы сам**: `pnpm gates:bytes`. Дифф файла в PR — список
  сдвинувшихся файлов с размерами до и после; дельту по строкам реестра байтов (gzip, `pnpm size`) PR по-прежнему
  называет в «готово» (§3.2).
- PR только с файлами Fansly закрепы не трогает — «разница ноль» доказана той же сверкой. Переписать их он не может:
  гейт `site-bytes-diff` читает дифф PR (в CI — против первого родителя merge-коммита, `fetch-depth: 2` у джобы
  `check`; локально — от точки ответвления от `origin/main`, вместе с незакоммиченным) и падает, если закрепы изменены,
  среди остального есть файлы Fansly и нет ни одного общего. Документы, тесты и инструменты в счёт не идут (из них
  ничего не собирается). Правка одних закрепов разрешена — так чинят закрепы, отставшие от `main`.
- **Почему не сборка базы и головы в CI.** Ей нужны второй checkout, вторая установка и вторая сборка в каждом
  `pnpm check` — на раннерах на ПК владельца и на Mac, где тяжёлые прогоны идут по одному; в PR она не оставляет
  следа: сдвиг байт виден только в логе. Закрепам нужна воспроизводимая сборка — она такая: выпускная сборка на macOS
  (arm64, Node 26.7) и в Linux-контейнерах `node:26-bookworm-slim` arm64 и amd64 (Node 26.10, как у раннеров CI; другой
  путь checkout, без `.git`) совпала байт в байт по всем 63 файлам, `pnpm gates` там зелёный (замер F9a). Цена сверки —
  sha256 двух мегабайт.
- **Цена решения.** Два PR, которые оба двигают один файл ChatSpace (обычно `background.js`), конфликтуют в строке
  закрепов: второй после слияния первого делает rebase, сборку и `pnpm gates:bytes` заново — в этот же момент устарели
  и его числа по реестру байтов. Обновление зависимостей или сборщика, которое меняет вывод, тоже переписывает закрепы.
- Не закреплены `manifest.json`, чанки страниц расширения и иконки: их грузят оба сайта, страницы несут оба.

### 1.9 Что общий код перестаёт знать (долг ChatSpace, закрывается до кода Fansly)

| Место | Сейчас | Станет | Кто закрывает |
|---|---|---|---|
| `core/src/application/newcomers/controller.ts:205, 664`; `spenders/controller.ts:571`; `preview/controller.ts:809, 1495, 1770` | `host: 'chatspace'` | `binding.host` | F6a · гейт |
| `core/src/application/ai/workspace.ts:482`; `preview/controller.ts:1496` | `conversationRef = fanRef` | из маршрута или разрешения группы | F6a |
| тост фона, `ChatNavigator.open`, `NavigationIntent.target`, `RequestIdentity` | без `conversationRef` | с ним | F6a |
| чтения хаба по разговору (`apps/extension/src/composition/background/hub-data.ts:55-57`, `hub/src/facade.ts:664`, лента) | по `fanRef` | по таблице «маршрут → ключ» (§11.1, HF-10; F6b) | F6b |
| `core/src/domain/telemetry/health.ts:242`; `core/src/services/telemetry/health.ts:33, 193` | один хост `chatspace`, `chatSpaceOpen` | окно на (хост, сборка) | F7 · гейт (литерал `health.ts:242`) |
| `core/src/application/pages/view-status.ts:139-151, 474, 489`; `contracts/src/vm/pages.ts:86-102`; `ui/src/pages/options/Status.tsx:45`; `Options.tsx:59` | строка «ChatSpace» обязательна | строка на каждый сайт с привязками | F7 · гейт |
| `core/src/application/pages/model.ts:181`; `client.ts:910` | перечисление двух видов хоста | `HOST_KINDS` | F6a · гейт |
| `core/src/domain/hotkeys/resolver.ts:50` | клиент схемы `'extension'` | клиент сайта из ранней половины адаптера (сделано в F5: `HostAdapter.hotkeyClient` → `createKeyResolver(platform, client)`) | F5 ✓ |
| `ui/src/kit/tokens.ts:18-55` | палитра только из `<html>` ChatSpace | `profile.palette` (сделано в F5: правило `:host` общего листа; у ChatSpace — наследование, как было) | F5 ✓ |
| `ui/src/dock/Strip.tsx:47-60`; `dock/styles.ts:112-235`; `contracts/src/vm/dock.ts:15-16` | семь чипов и пороги под них | чипы данными (сделано в F4: `DockVM.chips`, `Strip` по группам и порядку данных, слоты групп — `ui/kit/chips.ts`); лист варианта (сделано в F5: `profile.sheet` и `data-dock-variant`) | F4 ✓, F5 ✓ |
| `hub/src/facade.ts:343` | «… · ChatSpace» в имени устройства | нейтрально (сделано в F9b: «Firefox · ОС · ChatGoose») | F9b ✓ |
| `hub/src/ai-request.ts` с `HubFacade.buildStreamRequest` | мёртвый сборщик (`conversationRef = fanRef`), вызывают только тесты, но он в `background.js`; рабочий — `core/src/domain/ops/request.ts:105` | удалить (освобождает байты фона) | F6a |
| `host-chatspace/src/main/requests.ts:9, 23` | MAIN ChatSpace принимает оба вида хоста | только `'chatspace'` (освобождает байты MAIN) | F6a · гейт |
| ≈ 47 текстов с именами сайтов на общих путях | захардкожены | фразы профиля (сделано в F9b: 71 текст каталога `ru` и 71 — `en`, §1.5; ещё имена платформ и метка устройства) | F9b ✓ |
| `core/src/domain/sound/policy.ts:72` (нашёл гейт F9a) | своя копия таблицы «хост → платформа» | `HOST_PLATFORM` контрактов | F6a · гейт |
| `core/src/domain/features/gates.ts:47` (нашёл гейт F9a) | `platform === 'fansly'` в `pingGate` | порт предпроверки `AiHostPolicy` (сделано в F10: правила Hi и Ping — предпроверка сайта; у ChatSpace — `CHATSPACE_AI`, запись долга снята) | F10 ✓ |
| `core/src/application/pages/view-status.ts:62` (`PLATFORM_NAMES`); `ui/src/pages/shared.tsx:267` (`PLATFORM_WORDS`) (нашёл гейт F9a) | имена платформ таблицей по ключу платформы | фразы профиля (сделано в F9b: `sitePlatform` фраз сайта, который обслуживает платформу, — `PageEnv.platformPhrases`, `PageTagVM.platformName`) | F9b ✓ |
| `core/src/domain/sound/tones.ts:107-108` (`PLATFORM_DEFAULT_TONES`) (нашёл гейт F9a) | тоны по умолчанию таблицей по платформе | умолчание сайта (сделано в F9b: `resolveTone(…, siteDefault)`, пару сайта даёт таблица корня композиции фона `SITE_TONES` — у ChatSpace своей нет, у Fansly — умолчание его раздела `settings.ext`) | F9b ✓ |
| `core/src/domain/settings/ext.ts:31` (нашёл гейт F9a; появилось с P4a3) | раздел Fansly ключа `settings.ext` читается по имени `'fansly-web'` | по разделам, которые называет схема ключа (сделано в F9b: чтение и запись обходят `SettingsExtSchema`) | F9b ✓ |
| `hub/src/bootstrap-rules.ts:173` (нашёл гейт F9a) | `platform !== 'onlyfans'` в bootstrap, собранном для старого хаба | решение хаба по странице (сделано в F9b: платформы сайтов сборки даёт корень композиции, `compatPlatforms`; чужая — `platform_unsupported`, как сказал бы хаб) | F9b ✓ |

«Гейт» в последнем столбце — запись списка долга `SITE_LITERAL_DEBT` в `tools/gates/sites.ts` (файл, значение, число
вхождений, PR): PR-владелец убирает литерал и запись в одном диффе; с отметкой `✓` в плане при живой записи `pnpm gates`
падает. Шесть строк «нашёл гейт F9a» в версии 7 не значились; те, у которых в плане нет владельца раньше, были записаны
на F9b — и F9b убрал все пять своих. На F9b в списке одна запись — `gates.ts` за F10, он ещё в работе: уходит с ним.
Строки без «гейт» литералом сайта не являются: их держат строка плана своего PR и его тесты.

**Сделано F6a.** Сайт общий код берёт из привязки (`binding.host`). Разговор дока — из маршрута
(`RouteState.conversationRef`, нет поля — фан); превью — из списка, который разрешил фана
(`PreviewTargetInfo.conversationRef?`: шов для разрешения группы на Fansly, FS-SPD-2, P8a, P10*; читается в момент клика,
никогда не из маршрута открытого чата); тоста, «Открыть и вставить», «Открыть чат для проверки» и бегущей операции в
палитре — из цели операции. В `NavigationIntent.target`, тосте (`BackgroundToast.conversationRef?`, 1.15.0), ручке чата
(`nav.chat.<аккаунт>.<фан>.<разговор>`) и ключе запроса разговор стоит, только когда это не фан: на ChatSpace всё байт
в байт прежнее (значения, записанные на `main` до F6a, — `packages/core/test/support/chatspace-recorded.ts`). Помощник
`conversationOf` (`core/src/domain/ops/conversation.ts`) — только фоновый; код вкладки пишет ту же проверку на месте:
модуль, общий двум ленивым слоям, план слоёв кладёт в первый слой, который до него дотягивается, — общий помощник
перетянул слой `navigation` в `ai` целиком.

**Сделано F6b.** Чтения хаба ключуются по таблице §11.1. Рекапы (статус, чтение, сохранение досье — вкладкой и
сохранителем фона) и лента (голова Coach, страницы превью, покрытие в панели фана) называют разговор рядом с фаном
(`conversationRef?` в `recap.status`, `recap.read`, `recap.save`, `feed.read`, в запросах хаба рекапов, ленты и
сохранения досье), только когда это не фан; разговор вкладка берёт там же, где F6a: док и Coach — из цели (маршрута),
превью — из списка (проход ленты держит разговор своей первой страницы), панель фана — из маршрута открытого чата.
Слой хаба шлёт поле только хабу с `conversation-recaps-v1` (иначе отказ у себя, `CG-HUB-CAPABILITY`, и запроса нет),
а страницу ленты другого разговора считает нарушением контракта. Карточка, досье, бронь и опека — фан: досье читается
по `CHAT_IS_FAN` платформы страницы (контракты `ids`; у хаба — `clientConversationsHaveOwnIds`) — где чат и есть фан,
как прежде (`pageConversationProfile`), иначе по фану (`pageFanProfile`): id фана на Fansly не называет разговора.
На ChatSpace запросы к хабу байт в байт прежние — с возможностью и без неё (`apps/extension/test/support/
chatspace-recorded-reads.ts`, вкладка — `packages/core/test/support/chatspace-recorded.ts`). Поддельный хаб повторяет
правила HF-10: незнакомое поле у хаба без возможности — 400, на OnlyFans разговор ≠ фан — 409
`conversation_fan_mismatch`, на Fansly без разговора — 400; рекапы, лента и её курсор — по разговору.

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
| `fansly-main.js` (регистрируется) | MAIN целиком: загрузчик host-kit, два Proxy, разбор, наблюдение, снимок, жест | ≤ 16 КиБ gzip; ≤ 1 мс на `document_start` |
| `fansly.js` (регистрируется) | ранний изолированный: адаптер, клиент моста, маршрут, монтирование, клавиши | ≤ 30 КиБ gzip (30 720 Б), из них общая часть — 18 227 Б (замер F3, ниже); собственному коду Fansly остаётся 12 493 Б — столько же, сколько сейчас занимает свой код ChatSpace (≈ 12 050 Б); ≤ 3 мс |
| `fansly-notice.js` (по `executeScript`) | баннер «перезагрузите вкладку», уборка наших осиротевших хостов | ≤ 2 КиБ |
| `lazy/fansly/bridge-validation.js` | схемы моста Fansly | ≤ 30 КиБ |
| `lazy/fansly/tab-protocol.js` | схемы протокола вкладки Fansly | ≤ 30 КиБ |
| `lazy/fansly/ai-fansly.js` | свежесть, снимок, вердикт, доказательство Hi на стороне вкладки | ≤ 30 КиБ |
| `lazy/fansly/` слои `tab-app` и дока | общий исходник, своя нарезка | как у ChatSpace: ≤ 30 КиБ; первый чанк дока ≤ 45 КиБ |
| `lazy/fansly/{notes,newcomers,voice,vault}.js` | панели сайта | ≤ 30 КиБ каждый (войс при превышении делится) |
| `lazy/fansly/i18n-{ru,en}.js` | тексты Fansly | ≤ 30 КиБ |
| `bg/fansly.js` | службы Fansly в фоне | своя строка; стартово ≤ 200 КиБ raw, утверждается по базе P3d |

Оба скрипта — «unlisted script» WXT в корне XPI (`src/entrypoints/{fansly-main,fansly}.ts`, как `chatspace-ws.js`), а не
`content-scripts/*`: вход `*.content.ts` WXT вписал бы в манифест, а с `registration: 'runtime'` — вписал бы его адреса в
`host_permissions` (P7a0). Обёртку WXT у обоих снимают те же плагины, что у ChatSpace (`build/main-world-entry.ts`,
`build/isolated-entry.ts` — с P7a0 и для «unlisted» изолированного).

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

- **Раздельные сборки ленивых чанков** (F2b). У каждого сайта своя сборка со своим планом слоёв из реестра хостов; общая
  цепочка `LAZY_LAYERS` (`apps/extension/lazy/entries/names.ts:49`) и распределение по первому слою
  (`layerPlan` в `lazy/vite.config.ts`) стали планом ChatSpace, его чанки — `lazy/chatspace/**`, байт в байт прежние.
  Входы Fansly в общей сборке сдвигали бы нарезку общих модулей и байты чанков ChatSpace (тест
  `apps/extension/test/lazy-sites.test.ts` это показывает: фиктивный вход второго сайта со своей ошибкой и схемой рядом с
  ChatSpace не меняет ни байта, внутри его сборки — меняет); раздельные сборки этого не допускают. Цена — дубли общего
  исходника в XPI, замер F2b на 0.2.4: вся сборка ChatSpace — 42 файла, 929 189 Б, в XPI (deflate -9) 288 583 Б; вторая
  сборка общих входов (без только-ChatSpace `bridge-validation`, `navigation`, `palette`, `preview`, `newcomers`) — 32
  файла, 858 771 Б, в XPI 262 791 Б ≈ 257 КиБ, +31 % к XPI 852 577 Б. Это только размер установки и скачивания: вкладка
  грузит файлы своей сборки, память и время вкладки дубли не трогают. Свои чанки Fansly (схемы, `ai-fansly`, панели,
  тексты) — сверх этого, это не дубли.
- **Срезы общих таблиц** (§1.4, §1.6): записи Fansly не лежат в общих статических таблицах, которые попадают в бандлы
  ChatSpace (манифест фич, ошибки, схемы, тексты).
- **Реестр байтов** (`plan.md` §4): каждый PR с общим кодом называет дельту по каждой строке ChatSpace и откуда взяты байты.
  Строки и запас (сборка 0.2.4):

| Строка ChatSpace | Сейчас / предел | Запас |
|---|---|---|
| MAIN `chatspace-main.js` | 10 174 / 10 240 Б gzip (перед F6a — 10 169; F6a — −9: только `'chatspace'`; P5 — +14: тот же код в другом порядке модулей — литералы протокола в двух модулях, `host-kit` и ChatSpace) | 66 Б |
| тап `chatspace-ws.js` | 6 105 / 6 144 (P5 — −2: две строки протокола в другом порядке) | 39 Б |
| ранний изолированный `chatspace.js` | 30 324 / 30 720 (замер F3: `main` `d159743` — 30 154, F3 — +122; перед F4 — 30 285, F4 — −13: те же модули в другом порядке; F7 — 0; P5 — +38: два правила сайта в щупе клавиш `host-kit` — замыканиями, список несклеиваемых событий — параметром клиента моста, порядок модулей; F5 — +14: клиент схемы клавиш из ранней половины адаптера) | 396 Б |
| слой `ai` | 29 935 / 30 720 (перед F4 — 29 887; F4 — −50: таблица флагов и `FEATURE_FLAGS` ушли, чипы — в `tab-app`; F6a — +47: разговор дока из маршрута, «Открыть и вставить»; F7 — +51, замер F5 на `main` `9845f54`; F5 — 0) | 785 Б |
| проба реестра запросов вкладки | 27 775 / 28 672 (F1: +39 Б — `hostModules` диагностики; перед F6a — 27 521, F6a — +5: `BackgroundToast.conversationRef`; F7 — +249, замер F5 на `main` `9845f54`; F5 — 0) | 897 Б |
| проба раннего контракта (конверты, `tab.register`) | 10 816 / 12 288 (замер F5 на `main` `9845f54` и на ветке — тот же) | 1 472 Б |
| проба `UiAction` | 14 319 / 16 384 (замер F5 на `main` `9845f54` и на ветке — тот же) | 2 065 Б |
| слой `tab-app` | 26 790 / 30 720 (перед F4 — 25 407; F4 — +1 072: срез манифеста ChatSpace, `admission`, чипы данными; F6a — +27: разговор тоста через порт ручки чата; F7 — +128: ожидаемый набор якорей сайта, замер F5 на `main` `9845f54` — 26 634; F5 — +76: профиль ChatSpace в половине приложения; F6b — 0; F9b — +107, замер на `main` `a4622c5`: фразы сайта в порту I18n, переключатели `switches` среза манифеста; на ветке после P4b1 — 26 790) | 3 930 Б |
| первый чанк дока | 42 253 / 46 080 (F4 — −308: таблицы чипов ушли из `Strip`; F5 — +144: профиль на хосте — вариант, палитра, лист сайта) | 3 827 Б |
| каталог `ru` | 23 933 Б / 30 КиБ (F1: +40 Б gzip — предупреждение «Статуса»; F6b — 0; F9b — −15, замер на `main` `a4622c5`: 71 имя сайта стало плейсхолдером фразы; `en` — −4) | 6 787 Б (тексты Fansly в него не идут) |
| **ядро фона** `background.js`, raw (сигнальный порог `archive-check`) | 786 446 / 819 200 (F1; до F1 — 811 317; перед F4 — 771 369; F4 — +2 956: срезы манифеста, `admission`, токен `insert` по допуску; F6a — −2 141: мёртвый сборщик −2 276, разговор тоста и ключа запроса +135; F7 — +3 753, замер F5 на `main` `9845f54`; P2v — +6 443: SDK из `bd3eec06` (план §4); F5 — 0; F6b — +949 (план §4); P4b1 — +2 348 (по закрепам); F9b — +769, `pnpm gates:bytes` на `main` `c355aab`: переключатели `switches` среза манифеста, таблица тонов сайтов `SITE_TONES`, чтение `settings.ext` по схеме) | **32 754 Б** |
| чанк фона `bg/chatspace.js`, raw (F1; потолок — реестр хостов) | 90 691 / 98 304 (перед F4 — 91 722; F4 — −1 031: таблица `CLIENT_FLAG_REQUIREMENTS` ушла) | 7 613 Б |

  Известные источники байтов: мёртвый `hub/src/ai-request.ts` с `HubFacade.buildStreamRequest` (F6a, освобождён:
  −2 276 Б фона raw — 2 057 сборщик и 219 метод фасада), `StartMemo.start` (F8), `FEATURE_FLAGS` и дубли
  `CLIENT_FLAG_REQUIREMENTS` (F4, освобождены), второй вид хоста в `host-chatspace/src/main/requests.ts:9, 23` (F6a,
  освобождён: −26 Б raw, −9 Б gzip MAIN). Общие изменения могут менять байты, но не превышать согласованные пределы.
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
  в `bg/chatspace.js`, мёртвые зависимости удаляются. Замер F1: ядро 811 317 → 767 944 Б (−43 373), **запас ядра —
  51 256 Б** (строка `pnpm size` «background core» печатает его при каждой сборке); `bg/chatspace.js` — 91 633 Б (zod и
  схемы, которые разбирает X8, едут в чанке своей копией). Регистрация ручных отправок (`core/src/services/native-send.ts`, «a
  part of a preview or of a «Новые» card») и её журнал долгов остаются в ядре — она нужна обоим сайтам, а второй
  владелец журнала запрещён; чанкам она доступна портом `BackgroundKit.nativeSends`. F1 записывает запас ядра до
  сигнального порога **числом** в реестр байтов; каждый P2v и P9a сверяется с ним; исчерпан — следующая служба
  выносится в чанк. Порог 800 КиБ заранее не поднимается; поднять его можно только отдельным решением с обоснованием.
- **Контракт чанка сайта** (как построен в F1: `apps/extension/src/composition/background/host-module.ts`, только типы;
  чанк — default-экспорт `apps/extension/bg/<сайт>.ts`):
```ts
interface BackgroundHostModule { host: HostKind; start(kit: BackgroundKit): Promise<BackgroundHostHandle> }  // идемпотентно
interface BackgroundKit {        // порты ядра; чанк импортирует только их типы
  hub: HubPort;                  // фасад (claim, claimStatus), call = forCore, resolve, errorWire, session, bootstrap, page
  storage: StoragePort;          // local / session в двух диалектах служб ядра
  clock: Clock; ids: IdSource; log: LogPort;
  telemetry: TelemetryPort;      // report (ai_acceptance), countCode (client_health)
  router: TabRouterPort;         // события вкладкам, список сессий
  ops: OpsPort;                  // forSend, view, environment — операции планировщика ядра
  tokens: Pick<ActionTokens, 'redeem'>;
  install: InstallPort;          // instanceId, owner
  nativeSends: NativeSendPort;   // регистрация ручных отправок и её журнал — у ядра
  networkSession?: NetworkSession; // P9a: единственный владелец шаблонов, алиасов и фактов 429; ready — барьер восстановления
}
interface BackgroundHostHandle {
  onTabMessage(msg: VerifiedTabMessage): Promise<HostAnswer>;  // ядро уже проверило отправителя, сессию и тело
  onEvent(event: HostModuleEvent): Promise<void>;              // bootstrap, смена человека, «Очистить», ручная отправка
  facts(): HostModuleFacts;                                    // диагностика: счёт и журнал без текста
  dispose(): Promise<void>;
}
```
  Порты, которые нужны только Fansly, добавляются вместе с его службами, добавочно: `permissions`, `tabs` (вкладки
  браузера, relay), `settings` (раздел сайта). P9a добавил `networkSession` вместо передачи сырых событий через
  `onWebRequest`: слушатель сохраняет факт без загрузки чанка, а тот читает восстановленное состояние через порт
  (§8.2). Запросы своего сайта ядро передаёт модулю по таблице корня композиции (`HOST_REQUESTS`, у
  ChatSpace — `send.*` и `newcomers.claim`). Чанк не создаёт вторых владельцев журнала, настроек, телеметрии и хаба:
  граф держит `.dependency-cruiser.cjs` (`background-chunk-boundaries`, `background-chunk-through-the-kit`), а сборка
  чанка проверяет, что в файл не попал ни один модуль ядра (`build/background-bundles.ts`). Ошибка импорта или
  старта — состояние сайта `failed` в диагностике (`hostModules`) и предупреждение «Статуса», запросы сайта отвечают
  `CG-RUNTIME-UNREACHABLE`, ядро продолжает работать; следующая попытка — со следующим поводом, не раньше чем через
  10 с и не больше 5 раз за реалм, каждая по новому адресу; следующий старт фона пробует заново и восстанавливает
  сохранённые состояния.
- **Что в ядре:** слушатели `webRequest` на верхнем уровне (иначе событие не разбудит фон, S6 Q3), синхронизация прав и
  регистраций, приём `tab.register`, проверка отправителя и конверта сообщений сайта. Слушатели кладут шаблон и факты
  ответов в память и `storage.session` и чанк Fansly не тянут.
- **Когда грузится чанк:** рукопожатие вкладки сайта (`runtime.onConnect`), выдача прав, старт фона при включённом сайте и
  незавершённых работах (журналы отправок, попытки войсов, загрузка vault, долги регистраций). Незавершённые работы —
  ключи хранилища, которые корень композиции называет для сайта (`HOST_MODULE_SPECS`; у ChatSpace — журнал X8,
  предохранитель и аренды приветствий): есть хоть один — модуль стартует шагом барьера готовности, как до F1 стартовали
  эти службы. Ещё — первый запрос сайта (страница «Статус» спрашивает предохранитель).
- Профиль только ChatSpace чанк Fansly не грузит и не разбирает никогда; профиль только Fansly не грузит `bg/chatspace`.

### 3.4 Тексты

Общие ключи берут **целые фразы** из профиля сайта (`phrases`): «в ChatSpace» и «на Fansly» — разные предлоги, одной
подстановки имени мало. Как устроено с F9b — §1.5 «Фразы»: общие каталоги сайта не называют (гейт `site-name`), порт
I18n ставит фразы сайта на место `{site}`, `{onSite}`, `{siteAccount}`, `{sitePlatform}`.

**Пакеты текстов по сайтам.** У каждого сайта свой пакет `core/src/domain/hosts/<сайт>/i18n`: его фразы и его
собственные тексты. ChatSpace — `CHATSPACE_PHRASES` (его профиль берёт их, граф: `host-chatspace/isolated` →
`core/domain/hosts/chatspace/i18n`); Fansly — `FANSLY_PHRASES` и тексты кодов `CG-FAN-*`… (`FANSLY_CG_CATALOGS`, P4a3);
ключи только Fansly — пространство `fansly.*` там же, ленивые чанки `i18n-*-fansly` его сборки. Страницы расширения
(popup, настройки) несут оба пакета (корень композиции страниц может импортировать код обоих сайтов, граф
`chatspace-code-only-from-chatspace` и `fansly-code-only-from-fansly`). Каталог `ru` ChatSpace тексты Fansly не
получает: ленивые `i18n-ru`/`i18n-en` его сборки — общий каталог, фразы приходят с профилем во вкладку.

## 4. Права, регистрация скриптов, открытые вкладки

**Сделано P9a.** Строка `fansly-web` входит в `RUNTIME_HOSTS` уже здесь: рукопожатие после первой выдачи прав
должно восстановить `bg/fansly.js`. Это перенос минимального подключения из P7i; его адаптер, UI и допуск фич
остаются в P7i (`HOST_FEATURES` для Fansly пока `null`). В core — службы `site-access` и `network-session`,
параметры сайта задаёт корень композиции; слушатели platform устанавливаются до первого await, доставленные при
пробуждении события ждут восстановления настроек и сессии. Одна очередь platform сериализует также регистрации
ChatSpace. `BackgroundKit.networkSession` даёт чанку единственного владельца шаблонов, алиасов и фактов 429;
пейсер и длительность паузы — P9b, повторной копии состояния он не создаёт. По 429 сохраняются requestId, время,
источник и креатор либо весь профиль. Заголовки и ожидающие 2xx — только в `storage.session`, без логов и RPC.

В popup/options добавлена минимальная поверхность включения и счёт перезагрузок; `site.access` доступен только
этим страницам. `permissions.request` вызывается в исходном стеке клика, до RPC. Фон доводит `onAdded` самостоятельно;
оставшиеся права на старте не меняют выключенную настройку. Полная раскладка страниц и остановка выполняющихся
операций при отзыве остаются P14b/P14c. Браузерные цепочки — `suite-fansly-background.e2e.ts`.


- **Манифест** (добавочно):
  - `optional_host_permissions`: `https://fansly.com/*`, `https://apiv3.fansly.com/*` (их уже покрывает `https://*/*`
    для адреса хаба; перечисляем явно, чтобы запрос был понятным);
  - `optional_permissions: ["webRequest"]`;
  - `web_accessible_resources` для `https://fansly.com/*` — сборка `lazy/fansly/*` и страница relay.
- **Никаких** `host_permissions` и статических `content_scripts` для Fansly. Обновление они не задержали бы, но выдали бы
  fansly.com каждой новой установке, поставили бы точку внимания на вкладках Fansly и внедрили бы тап чаттерам, которые
  ещё не перешли (S6 Q2). **И в тестовой сборке тоже** (P7a0; план писал «статическая регистрация только в тестовой
  сборке»): Firefox при установке MV3-дополнения выдаёт все адреса манифеста, `content_scripts[].matches` в том числе
  (`Extension.getManifestOrigins()` при `extensions.originControls.grantByDefault = true`, умолчание Firefox 127+), так
  что статический скрипт выдал бы стенд и fansly.com при установке — против P6a (стенд опционален, `manifest.test.ts`
  это держит). До P9a скрипты на стенде регистрирует сам e2e тем же одним вызовом `[fansly-main, fansly]` со страницы
  расширения (`packages/testing/e2e/support/fansly-site.ts`), права стенда выдаёт как человек (`grantOptional`);
  с P9a это делает фон.
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

### 5.11 Сделано в P7a

Код — `packages/host-fansly/src/main/{index,protocol,ws-tap,xhr-tap,frame-parse,responses,emitter}.ts`. Наблюдение
чатов, сертификаты, личность групп и снимок — P7b, эхо и квитанция своей отправки — P7f, старое расширение и булевы FBuddy —
P7g: эти проекции разбираются, но ещё никуда не идут. Что сделано иначе или уточнено против §5.1–§5.4 и §6:

- **Адреса — от входа.** Хост сокета и origin API (`FANSLY_NETWORK` в строке рантайма Fansly) передаёт вход
  `fansly-main.ts`; тестовая сборка под `__CG_TEST_HOSTS__` добавляет `localhost` стенда (`FANSLY_STAND_NETWORK`: API на
  своём порту — origin совпадает и с портом после себя), выпускная его не несёт (гейт `release-bundle`).
- **Захват:** `Reflect.construct`, `EventTarget.prototype.addEventListener`, `JSON.parse`/`stringify`,
  `requestIdleCallback`, `setTimeout`, `URL`. `queueMicrotask` и `MessageChannel` не нужны: порт держит загрузчик.
- **Сокет:** слушателя `open` нет — его ничего не ждёт; слушаем `message`, `close`, `error`. Кадры прежнего экземпляра
  читаются (сообщение не теряется), но подтверждает (`t:1`) и обрывает (`close`/`error`) только новейший.
- **Разбор** (`readFrame`): `known` — кадр, который читает страница (пинг или известный `t`), `whole`, `touched` — чаты
  неполного кадра (`null` — все), проекции, счёт печатания. Неизвестный `t` — не потеря; повреждённая подписка `3/2` —
  тоже (чата не называет). «Кадры видны, ни один не разобран» (FS-WS-5): ≥ 3 кадров новейшего сокета без единого
  `known` → все чаты `unknown` (`socket`) один раз и якорь `frames: shape`.
- **Что MAIN шлёт с P7a:** `fx.incoming` на каждое `5/1` (`fanId: null` до групп P7b; `fromFan: false`, пока
  `/account/me` не назвал креатора; `automated` — `type 2` или `correlationId` без `inReplyTo`, правило приветственных
  текстов — P7b), `fx.follow`, `fx.identity` (креатор; `legacy` и FBuddy — `false` до P7g), `fx.contract` (якоря
  `notYet` → `ok`, `frames: shape`; `tap: wrapped` — глобал заменён поверх нашего Proxy, `silent` — подтверждённый
  сокет без кадров 75 с; считается при отправке, без таймера), `fx.vaultAdded {seq}` (номер наблюдения `loadstart`
  запроса), `fx.coverage … unknown` с причинами `socket` (новый сокет, его конец, ни одного разобранного кадра),
  `frame` (затронутые чаты или все), `late-install` (`readyState` при установке не `loading`), `parse-limit` (чат из
  адреса ответа или все).
- **Таблица ответов:** вид `other` — ответ API вне таблицы: считается (`responses.seen`), не разбирается. Метод без
  хука `open` не виден: `/message` без `groupId` и `/vault/albums/media` принимаются как ответы `POST` — других запросов
  на эти адреса страница не делает. Очередь отложенного разбора — ≤ 8 ответов и ≤ 1 Mi знаков, `requestIdleCallback`
  с тайм-аутом 1 с и запасом 2 мс, без него — таймер (ответ за ход).
- **Поток:** начинается с первого `fx.state` — изолированный мир спрашивает его, когда слушает; до него события ждут в
  очереди под тем же пределом. Ответ `fx.state` несёт состояния целиком, а продолжение потока уходит следующим ходом
  (разовый таймер), поэтому пачка не обгоняет ответ с номером `lastBatch`. Одна пачка на вызов слушателя: устаревший
  `fx.ack` ничего не освобождает, но его вызов может отправить ждущую пачку. `fx.state` кредитов не освобождает — их
  освобождают подтверждения. Пределы откалиброваны: очередь ≤ 256 КиБ и ≤ 2048 событий, в пути ≤ 256 КиБ — поток
  держит ≤ 512 КиБ из 4 МиБ (§5.5); переполнение — очередь сброшена, одно `fx.gap {overflow}`; `fx.gap {memory}` —
  для общего учёта памяти P7b (`emitter.gap`).
- **`fx.health`** — новый запрос (`contract-change:`, `contracts-changelog.md` «P7a»): счёт кадров и ответов, поток,
  гистограммы `frameParseMs` и `xhrParseMs` по границам HF-13 — по запросу, без таймеров; «Статус» и `client_health`
  его прочтут с P7c.
- `fx.focus`, `fx.generationSnapshot`, `fx.windowMeta` до P7b отвечают `not-ready`.
- **Бюджет:** `fansly-main.js` — 5,92 КиБ gzip из 16 (строка бюджета не менялась); синхронный старт ≤ 1 мс меряет
  `suite-fansly-site`; разбор кадра — микросекунды (юнит), в Firefox — `frameParseMs` в `suite-fansly-tap`.
- Гейт `main-world-guard` знает `listenOn(target, type, callback)` — слушатель на экземпляре страницы через захваченный
  `addEventListener`; ESLint разрешает `.WebSocket` только в `ws-tap.ts`, `.XMLHttpRequest` — только в `xhr-tap.ts`.
- **Проверки:** юнит — `packages/host-fansly/src/main/*.test.ts` (Proxy на подделках с формой натива, разбор, таблица,
  эмиттер с проверкой каждого кадра схемами Fansly, весь MAIN через клиент host-kit); e2e — `suite-fansly-tap` на
  стенде: `fansly-main.js` тестовой сборки — preload-скриптом WebDriver BiDi в мир страницы (как `document_start`),
  потребитель — стартер Fansly в песочнице BiDi; соседи `off`, `after` (и с хуком после первого ответа), `reinject`,
  `legacy`, `+guard`, `before` (поздняя установка), сторонние Proxy и подкласс над конструкторами.

## 6. Мост MAIN ↔ изолированный мир (реестр Fansly)

Загрузчик и протокол моста переносятся в host-kit **байт в байт** (P5): `postMessage` только на время рукопожатия, затем
`MessagePort`; конверт `{v, kind, id, t, documentEpoch, seq, payload}`; склейка состояний ChatSpace
(`main/bridge.ts:176-198`) — без изменений; всё входящее проверяет изолированный мир. После соединения у нас **не остаётся
ни одного** слушателя `message` на `window`: FBuddy постит туда тело каждого ответа API (S5 §2.4).

Перенос сделан в P5 (`packages/host-kit`): загрузчик (`main/bridge.ts`), `guard`, ручные проверки, литералы самого моста
(`main/protocol.ts`), клиент моста, наши закрытые хосты и слои, реестр корней, keep-bottom, щуп клавиш и `sameReport`.
Загрузчик не параметризован: список записей (`WRITE_REQUESTS`), состояния без повтора (`STATE_EVENTS`) и ключ тапа в
`probe` — значения реестра ChatSpace, как были; передача их снаружи стоила бы байтов MAIN ChatSpace (запас 66 Б после P5). Fansly
это не задевает: его запросы этих имён не носят, он ничего не пишет, состояния склеивает сам и шлёт пачки через `post`,
а `probe` у него отвечает `wsTap: false`. Клиент моста — общий и обобщённый по реестру: типы запросов и событий, модуль
схем и список несклеиваемых событий даёт хост (ChatSpace: `host-chatspace/src/isolated/{bridge-client,validate,wire}.ts`).

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
| `fx.health` | — | `FanslyHealth` (P7a): счёт кадров (`seen`, `parsed`, `lost`) и ответов страницы, поток (пачки, неподтверждённые, очередь, удержанные байты, `fx.gap`), время разбора MAIN по корзинам `frameParseMs`, `xhrParseMs` — для «Статуса», `client_health` и e2e; по запросу, без таймеров |

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
     поля: `div.no-dm-allowed` при невыполненных правилах ЛС, когда `div.message-composer` скрыт классом `hidden`, и сам
     `div.message-composer`; запись голоса меняет кнопку внутри `.actions`, поле не пересоздаёт, `main:56271`,
     `main:55759-55790`, `fansly-web.md` §3) и на `.message-content-header >
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

Как построено в P4b1. Общий модуль не называет типов сайта (граф `fansly-code-only-from-fansly` считает и импорт типов):
в `host.ts` — порт `FreshnessPort<S>` (`snapshot(chat, {conversationRef, feature, window, withText})`, `S` — форма
сайта) и члены `HostPort.freshness?: FreshnessPort`, `HostPort.fansly?: unknown`; типизирует их порт сайта
`FanslyHostPort` (модуль `fansly-host`: `freshness` даёт `FanslySnapshot`, `fansly` — `FanslyPagePort`), его и несёт
адаптер Fansly (`HostAdapter<FanslyHostPort>`). Поля `fanScript?` и `newestAt?` — у типа `ChatWindow`, а не у схемы:
схема — ответ MAIN ChatSpace, её байты закреплены, а окно Fansly проверяет своя схема `fx.chat`.

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

Как построено в F7. Ожидаемый набор — `HostContractShape` (`anchors`, `switchedAnchors`, `switchedCapabilities`;
`contracts/src/host.ts`). Его дают те, кому можно знать сайт: половина приложения адаптера (`HostAppAdapter.contract`,
факты лога вкладки и слово контракта для e2e) и корень композиции страниц расширения (`PageEnv.sites`, «Статус» и
popup; ему импорт модулей Fansly разрешён). Общая схема отчёта (`SiteContractReportSchema`) имён якорей сайта не знает:
она требует блок своего сайта и машинные имена, а полноту держит читатель по набору. Ядро фона набора Fansly не
знает (граф `background-core-graph`) и читает отчёт так, как его приняла схема: в `client_health` попадают якоря,
которые отчёт назвал. Набор Fansly и строгая ветка блока — P4b1, модуль сайта `fansly-host`: `FANSLY_CONTRACT` (все 17
якорей; без поломки не `on` — `vaultUpload`: vault — выключатель владельца и своя страница; общие `previewSend`,
`receipt`, `chatList`, которых у Fansly нет, §7.7) и `FanslyContractBlockSchema` / `FanslyContractReportSchema` — блок с
каждым якорем и каждой своей возможностью; их читают производитель отчёта и проверка контракта (P7c, P7h), общая схема
принимает всё, что принимает строгая ветка. Строка «Статуса» Fansly со своими словами — P14b2.

### 7.13 Сделано в P7c

Код — `packages/host-fansly/src/isolated/{start,route,anchors,identity,generation,stream,contract,host-port,freshness}.ts`;
`starter.ts` (P7a0) зовёт `start.ts`. Что сделано иначе или уточнено против §7.1–§7.7 и §7.12:

- **`adapter.ts` из списка плана не нужен.** Тип адаптера живёт в приложении (F3, §1.3): раннюю половину собирает вход
  `entrypoints/fansly.ts` из `startFanslyTab`, `createKeyboardProbe`, `routeOfLocation` пакета. Половина приложения
  (`FANSLY_APP`, `tab-protocol` и `tab-app` сборки Fansly) приходит с первой нашей поверхностью на странице Fansly — доком
  P7d: пока у дока нет места (`mounts` P7a0 — `none`), приложение на Fansly не стартует, и грузить ему нечего.
- **Маршрут** (`route.ts`): правило FS-RTE-1 строже — `^/messages/([1-9]\d{0,29})$` (id без ведущего нуля, как
  `NATIVE_ID_PATTERN`). Сигналы: колбэки наблюдателей якорей, `popstate`, `pageshow` (из bfcache — новая эпоха и на том
  же адресе), `currententrychange` Navigation API, если она есть; `pagehide` адреса не меняет, его не слушаем. Сверка
  без сигнала — `visibilitychange`, `focus` и каждое действие нашего UI через порт (`readDraft`, `focusComposer`,
  `freshness.snapshot`): найденная там смена — счётчик `unsignalled` и событие лога `route-unsignalled` (вид маршрута
  и счёт, без адреса). Порт отдаёт счётчик в `health()`; в `client_health` он пойдёт вместе с приложением Fansly.
- **Поколение** (`generation.ts`) — один жетон на жизнь страницы, маршрут и креатора; он же эпоха маршрута порта
  (`RouteState.epoch`, `HostIdentity.routeEpoch`, `fx.focus`). Растёт со сменой адреса, с возвратом из bfcache (эпоха
  документа MAIN при нём та же — новая жизнь страницы своя) и со сменой креатора (первый креатор страницы — привязка, не
  смена). Каждый асинхронный ответ берётся только в поколении, в котором его спросили, и отбрасывается целиком, если
  поколение сдвинулось: `fx.state` (поток его сразу спрашивает снова; кредиты, которые он называет, освобождаются),
  снимок `freshness`. `fx.chat` отвечает на фокус, назвавший само поколение (`routeEpoch`), чтение и запись называют его
  в своей личности. Поле принадлежит разговору и креатору, под которыми его увидели впервые.
- **Якоря** (`anchors.ts`): наблюдатель поиска стоит на `document` (на `document_start` `body` ещё нет) и ищет только то,
  что ждёт адрес: обёртки страницы, а в чате — маршрут разговора. Эпизод поиска ограничен 30 с (`SEARCH_MS`), после —
  якорь `missing`; новый эпизод — при смене адреса или колбэке рабочих наблюдателей. Рабочие — один `MutationObserver` на
  `div.content-wrapper`, `div.messages-content-wrapper` и маршруте разговора, цели переставляются при каждом разборе.
  Галерея узнаётся по `app-group-media-offers` под маршрутом. Якоря контракта из DOM судятся только там, где страница
  обязана их показать, иначе остаются, какими были (`notYet` до первого суда): `noDmAllowed` и `modalFlag` — `ok` после
  первого появления; поле под маршрутом мимо цепочки контейнера — `container: missing` (FS-PLC-3); прямой чат без
  блока контакта — `headerContact: missing` (FS-REG-4); `vaultUpload` — только на странице vault.
- **Поток** (`stream.ts`): первый `fx.state` подтверждает и номер `lastBatch`; каждая пачка подтверждается (`fx.ack`)
  после разбора. Потеря — `fx.gap`, пачка, отвергнутая схемой (она приходит своим номером `{n, events: []}`:
  `validate.ts`, иначе её кредит не освободить), пропущенный номер — окно чата сразу `unknown`, доказанное начало снято,
  и снова `fx.state`. Таймеров нет: пока состояние «должно» (не взято ни одно, или после последнего взятого была
  потеря или неудачный запрос — MAIN после `fx.gap` молчит, пока его не спросят), его спрашивают на сигнале страницы и
  действии нашего UI — после паузы, которая удваивается с каждой неудачей подряд (250 мс … 4 с), а не на каждое действие. Ответ `fx.state` заменяет то, что держит порт: чат, которого MAIN больше не называет,
  уходит, а сменившееся окно того же чата сказано событием `chatCache`.
- **Личность** (`identity.ts`): креатор — из `fx.identity`; аккаунт вкладки один: `hostAccountId = platformAccountId =
  creatorId`; эпоха входа и поколение растут при каждой смене креатора, а чат и окно прежнего креатора уходят сразу:
  группа маршрута фокусируется снова под новой эпохой, и чат называет только ответ на этот фокус. Чат — из `fx.chat` той же группы и той же эпохи маршрута,
  что и последний `fx.focus`; `fx.focus` уходит после первого `fx.state` и при каждой смене маршрута. Пока MAIN фана
  группы не назвал, чат неизвестен («чат ещё грузится», AI-122). Наблюдает ли MAIN чаты — его собственное слово, ответ на
  `fx.focus`: MAIN без наблюдения (P7a до P7b) отвечает `not-ready` — `chatWindow`, `fan` и `freshness` `off` с
  CG-HOST-NOT-READY и причиной `observation`; пока ответа нет — причина `focus`.
- **`chatWindow`** из `fx.chat`: `loaded`, `hasOlder` (`false` только при `startProven` и полном наблюдении), `newestAt`,
  `fanScript`; счёта по сторонам в сводке Fansly нет — 0, правила Fansly его не читают. **Поле** (`composer`): `textarea`
  под маршрутом, принадлежащая разговору и креатору, под которыми её увидели впервые: Fansly меняет адрес раньше узлов
  (назад и вперёд — `popstate`, перерисовка задачей позже), и поле прежнего чата, ещё стоящее на странице, полем нового
  не становится. Токен экземпляра — изолированного мира (`f<n>`), ревизия — счёт событий `input`; `hidden` — ветка `no-dm-allowed` /
  `message-composer.hidden` или `dmAllowed: false`. `readDraft` и `focusComposer` сверяют документ, вход, маршрут, чат и
  экземпляр поля (как MAIN ChatSpace).
- **Отчёт** (`contract.ts`): чего ещё нет, — `off` с CG-HOST-NOT-READY и своим именем причины: `insert`, `navigate`
  (P7e), `sendObserve` (P7f), `incoming` (P14a), `headerSlot` (P7d, P11a), `fileAttach` (P12c), `vault` (P13b), `relay`
  (P9c); `theme` — `degraded` до P8d; `freshText` — `off` (`snapshot`: свежий текст Fansly — снимок); сборка — имя
  `main.<hash>.js` из DOM. Имена якорей и возможностей повторены литералами (модули контрактов строят схемы при загрузке),
  их сверяет `contract.test.ts`.
- **`FanslyPagePort.headerSlot`** говорится по якорям (`group`, `gallery`, `anchor-missing`, `no-chat`, `ready`);
  монтирование в слот — P7d и P11a. Передача файла, vault и relay до своих PR отказывают, ничего не трогая.
- **Факты потока** (`fx.incoming`, `fx.follow`, `fx.coverage`, `fx.deleted`, `fx.sent`, `fx.vaultAdded`)
  подтверждаются вместе с пачкой и ждут своих PR (P8b1, P14a, P7f, P13b).
- **Бюджет:** `fansly.js` — 26,66 КиБ gzip из 30 (27 310 Б: сверх общей части F3 — ≈ 9,1 КиБ своего кода Fansly из
  12,2); строка бюджета не менялась. Байты ChatSpace — те же (`pnpm gates`): изменён только код Fansly.
- **Проверки:** юнит — `route`, `anchors`, `host-port` (сценарный MAIN, события — через схемы Fansly, фикстуры
  контрактов; и поверх настоящего MAIN), `contract`; e2e — `suite-fansly-tap`, блок P7c (потребитель `port` харнесса —
  старт Fansly, как его запускает расширение) рядом с соседом `off` и `after`: смена чата, галерея, назад (A → B → A),
  тишина наблюдателей, подтверждённый поток. Тест поверх настоящего MAIN и блок e2e читают, наблюдает ли MAIN чаты
  (ответ на `fx.focus`), и проверяют своё в обоих случаях: до P7b — честное «пока нет», с P7b — фан каждого чата своей
  эпохи, поле, слот шапки и снимок цели через порт (проверено на ветке P7b). Тестовая страница DOM —
  `src/testing/fake-dom.ts`.

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
- **Запись наблюдений (P9a после ревью).** Порядок привязки хранится отдельно на каждую вкладку:
  запрос другой вкладки обновляет общий шаблон, но не блокирует смену аккаунта первой.
  `storage.session` получает только изменённые подтверждённые шаблоны, привязки/алиасы,
  регистрацию вкладок и факты 429; пачка изменений объединяется в одну запись. Время
  наблюдения, `fansly-client-ts` и смена значения check внутри уже известного семейства
  сами по себе записи не вызывают: последние образцы обновляются в памяти и попадают в
  следующий снимок при значимом изменении. Новое семейство check, смена `authorization`,
  `fansly-client-id` или `fansly-session-id`, восстановление соединения вызывают запись;
  смена этих стабильных заголовков также сбрасывает старые checks. Незавершённые запросы
  живут только в памяти: после выгрузки фона ответ без захваченных в этом реалме заголовков
  не создаёт шаблон; следующий успешный запрос восстанавливает захват. Подтверждённый
  шаблон и охлаждение по-прежнему переживают сон фона.
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
  P9b перед каждой отправкой (после ожидания пейсера §8.4, также для relay) заново ставит
  `fansly-client-ts = String(Date.now())`, а `fansly-client-check` берёт из `checks` нужного
  семейства, не из общего образца `headers`. Check — принятый сервером образец, его алгоритм
  не воспроизводится; после сна доступен последний сохранённый образец. Сохранённые
  per-request заголовки нельзя повторять вслепую.
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

Своя машина состояний и журнал `fansly.send.journal` (только id, без текста); X8 и `send.journal` не меняются. Контракт —
`contracts/src/send-fansly.ts` (P4c): состояния и переходы данными (`FANSLY_SEND_TRANSITIONS`), доказательства каждого
конца, `isFanslySendStep`, запись журнала, восстановление, отчёты опеке, последняя сверка.
```
ready → claimed (бронь фана, продление раз в 40 с) → routed (слот пейсера и кадр relay готовы; первая запись журнала)
      → dispatched (опека хаба HF-3: группа AI или ручная; билет до expiresAt)
      → intentWritten (надёжная запись намерения) ⟶ последняя сверка (синхронно)
      → requestStarted (fetch начат) → receipted (ответ с id, groupId, senderId) → sent (эхо 5/1 или история с тем же id)
отказы: refused — доказанный отказ: до dispatch, без запроса (сверка, запись, билет, потерянный ответ опеки, перезапуск
        до намерения, отказ relay) или 4xx, кроме 401; uncertain — всё остальное после надёжной записи
uncertain → sent: только поздние эхо или история с id своей квитанции либо решение хаба (resolve); → refused: только
        решение хаба «не отправлено». В ready не ведёт ничто: новый клик — новая попытка
```
- Всё, что может ждать (пейсер, relay), идёт **до** `dispatch`. После ответа опеки порядок такой:
  1. **надёжная запись намерения** «отправка может начаться» (`await` записи в хранилище — единственная пауза);
  2. **последняя сверка — синхронно, по памяти:** кортеж (креатор, группа, фан, документ, транспорт, `historyRevision`,
     ревизия черновика) и остаток билета по его `expiresAt`;
  3. сразу `fetch` — без единого `await` между сверкой и передачей запроса. При «Fansly через вкладку» кадр relay
     повторяет свою часть сверки (документ, аккаунт, вкладка) синхронно у себя, прямо перед своим `fetch`.
  Сверка не прошла — `refused`: в этом же процессе доказано, что `fetch` не вызывался.
- **Окна сбоя:** до записи намерения — ничего не ушло, опеку можно отпустить (`failed: not_enqueued`); чтобы это было
  можно и после перезапуска, запись журнала появляется уже в `routed`, до `dispatch` (иначе опека, чей ответ не дошёл или
  чей процесс умер, ждала бы решения хаба в `uncertain-held`). После записи намерения восстановление не знает, был ли
  `fetch`, поэтому `uncertain`: автоповтора нет, освобождать фана под новую отправку нельзя, пока отсутствие отправки не
  доказано; после квитанции до подтверждения хабу — повтор идемпотентного `sent` с сохранённым id (`reportPending`).
  Таблица перезапуска — `FANSLY_SEND_RECOVERY`: `routed`, `dispatched` → `refused` (`not-enqueued`, CG-OP-INTERRUPTED);
  `intentWritten`, `requestStarted` → `uncertain` (`restart`); квитанция и концы остаются. Отчёт `failed` после конца
  билета хаб отвергает (`uncertain-held` не становится `failed`) — фан там держится до решения хаба, хотя клиент знает,
  что не отправлено. Завершение и сверка начатой попытки работают и после выключения флага (HF-3).
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
окна как дубль). Как построено в F7: фон держит период и в нём окно на пару; сайт вкладки — из её регистрации, сборка — из
её отчёта контракта; отчёт без сборки (первый отчёт каждой вкладки, мост ещё не поднят) — не контракт известной сборки:
его числа идут в окно сборки, на которой вкладки сайта, а сам он стоит за сайт, только пока ни одной сборки сайта не
известно. Что считает фоновый чанк сайта, идёт в окно сайта (кит модуля — на сайт). Отчёт уходит, пока открыта вкладка
сайта; id — из вида, версии, сайта, сборки и окна. Метрики времени Fansly — новые имена в реестре хаба (HF-13, только дополнение; незнакомое имя хаб сейчас
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
2. Общий контроллер зовёт порт `policy.proof(host, ask)` политики сайта (`HostAppAdapter.ai`, §1.6) →
   `freshness.snapshot(chat, {feature: 'reply', window: 100, withText: true})` → MAIN: ограниченный слив и один
   синхронный шаг → `FanslySnapshot`; затем `policy.preflight(…, snapshot)` до токена.
3. `StartOp {…, target: {conversationRef: groupId, fanRef}, proof: {kind: 'tab-snapshot', …}}` (поля — `policy.fields`)
   → фон: допуск (одна операция на чат, три на вкладку) → запрос к хабу: `conversationRef`, `fanRef`,
   `liveTextContext` (хвост), `coverageCheck` (окно и удалённые) при возможности `coverage-check-v1`, `messageCount` 100.
4. Хаб отвечает кадром `context_v1` с ответом по каждому id окна → `policy.verdict(view, fingerprint)` — чистая функция
   таблицы §3.5 спецификации над тем, что вкладка сохранила от снимка (`policy.fingerprint`) → общий `Result` получает
   готовую модель пометки (`ResultMarkVM`).
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
фон: бронь → маршрут (пейсер, relay) → запись журнала → `dispatch` (AI или ручная группа, без `previewSend`) → надёжная
запись намерения → последняя сверка (синхронно) → `POST /message` → квитанция → эхо из вкладки → `sent` в хаб (§8.6).

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
`CLIENT_FLAG_REQUIREMENTS` (`contracts/src/hub/routes.ts`) — только нужды транспорта клиента (§1.4; с F4 — `{freshText: ['context-v1']}`).

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
| HF-5 | Hi: `startProof` v1, `personalMessageCount` и `fanAvatarUrl` верхнего уровня (FX-018; та же `fanslyAvatarUrlSchema`, что у `clientContext.fanAvatarUrl`; до провайдера идёт как изображение, хаб её никогда не скачивает); проверка id окна, начала (противоречие со свидетелем начала и известной историей; удалённая историческая строка противоречием не считается) и порога; отказ `history_unproven` / `too_many_personal` | `hi-greeting`, Fansly, возможность `hi-start-proof-v1`, ядро без `clientContext` |
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
| `hi-start-proof.ts` (новый, P4b4) | общие проводные схемы `StartProofV1Schema`, аватара и пределы доказательства, вынесенные из `fansly.ts`: `ops.ts` и `hub/ai.ts` не импортируют модуль сайта. `fansly.ts` сохраняет прежние экспорты через этот модуль; корень их не реэкспортирует |
| `fansly-host.ts` (новый, P4b1) | `FanslyHostPort` — `HostPort` с типами членов сайта; `FANSLY_CONTRACT` (ожидаемый набор отчёта); строгая ветка блока `FanslyContractBlockSchema`, `FanslyContractReportSchema`; только подпуть (§7.7, §7.12) |
| `bridge-fansly.ts`, `bridge-messages-fansly.ts` (новые, P4a2) | реестр моста Fansly (§6), конверт `fx.batch`, `fx.ack`, `fx.gap`, кредиты и пределы кадров; только подпути: корень `@cg/contracts` модули сайта не реэкспортирует |
| `ops.ts` | `StartOp.startProof?: StartProofV1`, `personalMessageCount?`, `fanAvatarUrl?` и те же поля в `AiStartFields` политики сайта (P4b4): только Hi на Fansly; `groupId` равен разговору цели, счёт при доказательстве равен `personalCount`; отсутствие доказательства не подменяется нулём. `StartOp.proof?: CoverageProof` (снимок вкладки или доказательство прохода; хвост внутри); `checkpoint` не трогаем; `ServedContext.coverageCheck?`; новые причины `stale`; операции сайта — объединение на уровне типов. P4b1: доказательство — общая форма без имени сайта (`tab-snapshot` / `pass`; разговор цели, полнота, окно ≤ 60, известные id фана, удалённые ≤ 60, хвост, `truncated`), рядом с `fresh` и `checkpoint` не ходит; ответы читаются по таблице, общей с хабом (`COVERAGE_CHECK_CLASSES`, фикстура — копия матрицы хаба байт в байт), `narrowCoverageCheck`, `coverageCheckVerdict`; причины `unverified`, `window-miss`, `deleted-served`; ключ запроса — с `proofDigest` (`core/src/domain/ops/identity.ts`); P4b3: операции сайта — объединение типов `SiteStartOp`, `SiteOpResult` (`AnyStartOp`, `AnyOpResult`) рядом с `SiteOpId`, `OpFeature` в `features.ts`, без значений: общие схемы (`StartOpSchema`, `OpViewSchema`) остаются закрытыми |
| `send-fansly.ts` (новый, P4c) | машина состояний HTTP-отправки (§8.6) данными и `isFanslySendStep`; журнал `fansly.send.journal` (только id; свой ключ рядом с `send.journal`), перезапуск и отчёты опеке; запрос приветствия «Новых» (`fansly.followers.send`: текст поля, его ревизия, `historyRevision`, вид допуска, действие человека) и вид попытки; ручная группа и тело брони Fansly — подмножество тела хаба HF-3; последняя сверка `fanslyFinalCheck`, квитанция `POST /message`; только подпуть |
| `hub/claim-body.ts` (новый, P4c) | только типы: тело брони хаба после HF-3 (`HubClaimBody`, `HubClaimOp`, `ManualClaimGroup`) — общему коду (фасаду) есть чем его назвать. Отдельно от `hub/newcomers.ts`: любая правка там, даже тип или комментарий, переименовывает идентификаторы в минифицированной пробе реестра запросов вкладки, и её gzip сдвигается на байты |
| `tab-protocol.ts` | `TypeSchema` — до двух точек; `RequestSpec.hosts?` и `senderAllowed` (правила `from`, `pages`, `hosts` для любого реестра); вид отправителя `relay`, порт `cg-relay`. В общем реестре `hosts: ['chatspace']` — у X8 и «Новых» хаба (P4a3) |
| `tab-messages-fansly.ts` (новый) | `fansly.followers.*`, `fansly.voice.*`, `fansly.vault.*`, `fansly.notes.*`, `fansly.relay.*` — разбираются в чанке `bg/fansly`; ядро фона проверяет отправителя, сессию, сайт и конверт и отдаёт тело подключённому реестру сайта (`BackgroundRpc.site`, `platform/rpc-background.ts`). Своя ошибка сайта — в теле ответа (`CgAnyErrorWire`), в конверте — только общие коды |
| `settings.ts`, `settings-ext.ts` (новый, P4a3) | v1 **не меняется** (`deep` ≤ 3000, фикстура `deep: 3001` по-прежнему недопустима, `contracts/test/fixtures/schemas.ts:315`). Новый ключ `STORAGE_KEYS.settingsExt = 'settings.ext'` со своей версией — всё, чего v1 выразить не может: `{v: 1, hosts: {'fansly-web'?: {enabled, viaTab, notesView, sound: {messagesTone, subscribersTone}}}, windows: {deep?: 3001…5000}}`. Схема ключа — в отдельном модуле `settings-ext.ts` (только подпуть; P4a3): в `settings.ts` она легла бы в пробу реестра запросов вкладки и в бандлы ChatSpace. Хранится только выбранное человеком, запись меняет лишь названные патчем поля. Глубина берётся `windows.deep` из него, если есть, иначе из v1, и не выше `limits.deepMax`. У каждого поля один владелец; импорт идемпотентный, значение по умолчанию не затирает сохранённое. Старые сборки ключ не знают и не трогают: их ремонт v1 выбрасывает неизвестные поля только внутри `settings` (`core/src/domain/settings/repair.ts`) |
| `limits.ts` | три предела: на проводе — `window` в `StartOp` и `messageCount` в теле хаба ≤ 5000 (недопустимые фикстуры — 5001 вместо нынешних 3001, `schemas.ts:648`, `hub.ts:594`); настройка — v1 ≤ 3000 и `windows.deep` ≤ 5000 в `settings.ext`; допуск — по `limits.deepMax` из bootstrap. Тест: 3001 не уходит, пока `deepMax < 5000` (значения HF-6 — 1500/3000/5000). P4b2: `planStart.extendedWindows?` принимает окно из `settings.ext`, разовый `options.window` приоритетнее; ограничение в планировщике и повторно в фоне. Передача из приложения Fansly — P8c, интерфейс — P14b1 |
| `hub/ai.ts`, `hub/wire.ts`, `hub/routes.ts` | `HUB_AI_FEATURES` += `voice-script`, `fan-notes-fill`; новые флаги и возможности (§11); новые поля тела — под возможностями; в `CLIENT_FLAG_REQUIREMENTS` — только нужды транспорта клиента (§1.4). P4b3: флаги Fansly — в `CLIENT_FEATURE_FLAG_NAMES`, `manual-greeting-v1` и `voice-notes-v1` — в `CLIENT_HUB_CAPABILITY_NAMES` (не в заголовке AI), причина `lane_off` (последняя в порядке хаба); тело — `noteFields` (только метки анкеты, без `noteValues`); зеркало запроса повторяет правила обработчика хаба для двух функций (страница Fansly и фан, черновик у скрипта, метки у заполнения) |
| `ops-fansly.ts` (новый, P4b3) | операции среза Fansly: `FANSLY_OPS`, схемы старта (`VoiceScriptStartSchema`, `NotesFillStartSchema`) и результата (`voice-script` — текст скрипта, `note-fields` — метки и значения), данные драйвера `FANSLY_OP_DRIVERS` (функция хаба, запись манифеста, тип результата, тайм-ауты); дают ровно типы общего `ops.ts`; только подпуть |
| `hub/ai.ts`, `hub/wire.ts` (P4b4, HF-5) | тело `hi-greeting`: `startProof?: StartProofV1`, `personalMessageCount?` и `fanAvatarUrl?`; только Fansly, без `clientContext`, под `hi-start-proof-v1` (bootstrap и заголовок). `groupId` = `conversationRef`, необязательный счёт = `personalCount`; аватар — `^https://[a-z0-9-]+\.fansly\.com/`, ≤ 4096, как у старого `clientContext.fanAvatarUrl`, до провайдера идёт как изображение, хаб её никогда не скачивает (FX-018). Поля учтены в тесте предела тела. Матрица HF-5 скопирована байт в байт, sha256 закреплён; все доказательства сверяются с SDK. ChatSpace полей и заголовка не шлёт |
| `telemetry.ts` | окно на (хост, сборка), хост в id отчёта; метрики HF-13 |
| `errors-fansly.ts` (новый) + приложение А `docs/architecture.md` | `CG-FAN-*`, `CG-NOTE-*`, `CG-VOICE-*`, `CG-VAULT-*`, `CG-FNEW-*` (34, P4a3), тексты — каталоги Fansly `core/src/domain/hosts/fansly/i18n`; ответы хаба о войсах → коды Fansly. `conversation_fan_mismatch` (HF-9) — общий CG-CONTEXT-CHANGED в `hub/error-map.ts`: путь AI и вид операции общие, код Fansly по ним не прошёл бы |
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
  что подмен и обходов loopback в ней нет. **Сделано в P6a:** у каждого стенда своё loopback-имя (`CHATSPACE_STAND_MATCHES`
  — `127.0.0.1`, `FANSLY_STAND_MATCHES` — `localhost`, `hosts/runtime/index.ts`); стенд опционального сайта и в тестовой
  сборке опционален — до записи Fansly (P7a0) тестовая сборка несла его права отдельно (`FANSLY_STAND_PERMISSIONS`,
  `pendingStandsOf`); с P7a0 их несёт запись Fansly: `optional_host_permissions` — адреса Fansly и `http://localhost/*`,
  `optional_permissions: ["webRequest"]`, при установке не выдано ничего. Скрипты Fansly на стенде — §4 (их регистрирует
  e2e до P9a); первый спек с расширением на стенде — `suite-fansly-site.e2e.ts` (P7a0: оба скрипта на `document_start`,
  рукопожатие host-kit через схемы `lazy/fansly`, рядом с соседом в `off` и `after`, WAR по сайту, тайминги §3.1). Выдача и отзыв без человека — `packages/testing/e2e/support/permissions.ts`: хранилище прав
  Firefox (`ExtensionPermissions` через chrome-контекст WebDriver, как переключатель менеджера дополнений; `onAdded`/
  `onRemoved` приходят) и путь человека — `permissions.request` в доверенном клике с отвеченным вопросом
  (`extensions.webextOptionalPermissionPrompts`), `permissions.remove` со страницы (`fansly-stand-permissions.e2e.ts`).
- **Стенд Fansly** — `packages/testing/fixture-fansly/`: наше Angular-подобное приложение по структуре живого DOM, без кода
  Fansly, + `fixture-fansly.vite.config.ts` → `.cache/fixture-fansly`. У стенда **свой loopback-хост** (`localhost`; у
  ChatSpace — `127.0.0.1`): адрес, который подходит двум хостам, фон отвергает (S1b G-10); сервер стенда отвечает только под
  этим именем (421). Стенд повторяет: пересоздание контейнера, поля и блока контакта при смене чата; блок контакта по числу
  участников и ветки поля (правила ЛС, запись голоса) без смены адреса, плюс пересоздание поля по команде; галерею; модалку
  загрузки и `app-account-media-create-template`; `body.modal-opened`; строку «печатает»; правила низа 1 и 350 px и
  `scrollTop = 0`; виртуальный инбокс; мини-чат; тему; метки старого. Список с источником каждого поведения — шапка
  `fixture-fansly/src/main.ts`; управление тестами — `window.__fanslyStand` (`src/protocol.ts`). Свои запросы стенд делает
  через интерфейс `backend.ts`: без сервера (DOM-тесты) отвечает сама из своего мира, со стендом — настоящими XHR и
  сокетом к поддельному Fansly (P6b, `http.ts`, `xhr-backend.ts`, `socket.ts`, `live.ts`).
- **Поддельный Fansly** — `src/fake-fansly/{api,socket,data,proxy,journal}.ts`. Его API — на loopback-адресе
  (`localhost`, `127.0.0.1`) или с TLS: CSP фона MV3 по умолчанию несёт `upgrade-insecure-requests`, и `fetch` фона на
  `http://` другого имени уходит на `https` и падает (P3a). Состав:
  - XHR-API: `ngsw-bypass`, `responseType: 'text'`, конверт, 429, `success: false`;
  - сокет `{t, d}`: эпохи, `t:1`, пинг `"p"`, события всех чатов (5/1, 5/10 с каскадом, 4/2, 5/22, 3/2), пакеты `t:10001`,
    повреждённые кадры;
  - журнал по происхождению вызова: «только список FS-NET-1» и «ни одного `/message/ack` от нас» проверяются **на
    сервере** — ловушка сети не видит запросов фона к loopback.

  **Сделано в P6b.** Три origin на одном loopback-имени `localhost`, как три хоста сайта: страница стенда, API
  (`http://localhost:<порт>/api/v1/…`) и сокет (`ws://localhost:<порт>?v=3`); адреса и синтетический токен сессии
  сервер стенда пишет в `<meta>` отдаваемой страницы (`fixture-fansly/src/server-protocol.ts`). Мир сервера — тот же
  синтетический мир страницы (те же id; id сообщения — snowflake своего времени), плюс подписчики, заметки,
  автоматические тексты и альбомы (`data.ts`). Формы ответов и кадров с источником каждой — `fixture-fansly/src/wire.ts`.
  Происхождение вызова сервер видит так: страница — по `Origin` страницы стенда; **наш** — без `Origin` (так спрашивает
  страница расширения с правом на хост: фон и кадр relay), соседу P6d выдаётся свой токен (`session.issue`), управление —
  по своему заголовку. Нарушения нашего вызова: путь вне FS-NET-1, `POST /message/ack`, адрес без `ngsw-bypass=true`,
  cookie (`credentials` не `omit`), свой сокет. Прокси (`proxy.ts`) — HTTP-прокси на `127.0.0.1`, который пересылает
  только на имена поддельного Fansly (и страницу стенда) через отдельную «дверь за прокси»: вызов через него журнал
  помечает `via: 'proxy'`; как Firefox направляет в него одну вкладку (копия решения Multi-Account Containers) — дело
  `suite-fansly-relay` (P9c). Управление тестов — команды `FakeFanslyCommand` (сообщение, рассылка, удаление,
  квитанция, печатание, подписчик, участники, сырые кадры и пакеты, закрытие и «зависание» сокета, исходы API: 429 с
  `Retry-After`, `success: false`, задержка, обрыв, не-JSON — вместо запроса или после его эффекта), в процессе и по
  HTTP (`fake-fansly/client.ts`; в e2e — `fakeFansly()` в `e2e/support/fansly-stand.ts`). Сокет подтверждает сессию
  через 100 мс после запроса страницы: при загрузке первый свежий конец открытого чата начинается до `t:1`, второй —
  после, как на сайте (S2 Q1.7).
- **Сосед** — `src/fake-fansly/neighbor/`: эмуляция FBuddy по S5 §6. Режимы `off`, `after` (по умолчанию), `before`,
  `reinject`, `legacy`; флаги `+guard`, `panel=desktop|mobile|off`, `generic` (чужой Proxy над XHR и WebSocket — проверка
  устойчивости); 11 утверждений e2e; чужие запросы с 429.

  **Сделано в P6d.** Сосед — один классический скрипт `neighbor.js` (сборка `fansly-neighbor.vite.config.ts` →
  `.cache/fansly-neighbor`, входит в `build:stand`). Сервер стенда ставит его первым в `<head>` страницы, если тест
  попросил: `?stand-neighbor=<режим>[,флаги]` в адресе или умолчание стенда (`POST /__stand/neighbor` с заголовком
  управления; в e2e — `setFanslyNeighbor`, `openWithNeighbor`, `callNeighbor` из `e2e/support/fansly-neighbor.ts`). Этот
  загрузочный скрипт играет MAIN-скрипт FBuddy (`Map.prototype` до реестра видов Angular — стенд регистрирует корневой
  вид, `ng.ts registerView`) и его изолированный мир; части для страницы — мост (`script#fbuddy-window-bridge-script`
  остаётся), хук сети и фильтр слов — он вставляет `<script src>` того же файла, как FBuddy. Время хуков: `load` — сразу,
  двумя загрузками (гонка с первым запросом страницы, как в поле), `first-xhr` — после первого ответа API страницы,
  `before` — в первый момент страницы (позднюю установку нашего MAIN делает обвязка P7a). Свои запросы сосед делает
  нетронутым `fetch` с токеном, выданным ему (`session.issue`): журнал поддельного Fansly пишет их `neighbour`, 429
  можно назначить только ему (`{route, caller: 'neighbour', outcome}`); для `webRequest` они неотличимы от страницы, как
  у настоящего соседа MV3 (P3a). Управление тестов — `window.__fanslyNeighbor` (`neighbor/protocol.ts`): состояние, журнал
  ответов, которые видел хук (без тел — свёртка), свои запросы, тосты, `reinject`, `pollNow`, `writeNote`. Без нашего
  расширения на странице `fansly-stand-neighbor.e2e.ts` фиксирует эталон: в `after` запросы и результаты страницы те же,
  что в `off`, а хук видел каждый запрос страницы. Сравнение журналов — только между моментами покоя страницы:
  `window.__fanslyStand.idle()` (сокет подтверждён, ни одного запроса в пути, чтение непрочитанных окончено, ни одна
  отметка не ждёт и не уходит; в e2e — `waitForFanslyStandIdle`). Страница шлёт отметки позже и пачками по 25 через
  200 мс — на старте одних отметок доставки 60, три вызова, — поэтому окно журнала, отрезанное паузой, каждый раз
  режет эту серию в другом месте. Отметки сравниваются по тому, ЧТО отмечено: журнал поддельного Fansly хранит у
  `message.ack` вид отметки и id сообщений (`detail.ackType`, `detail.messageIds`), число вызовов — не поведение. Не воспроизведено: сокеты FBuddy (wsv3 с авточтением, чат стримов —
  в его изолированном мире, нашему тапу их не видно), запросы к fbuddy.net (слова организации — из настроек соседа,
  журнал сообщений только считается), значок кошелька (на стенде нет `app-wallet-balance`), меню инбокса (по умолчанию
  выключено), выбор панели по ширине окна (её задаёт флаг `panel`), опрос баланса раз в 60 с.
- **Поддельный хаб** — страницы Fansly с 18-значными id (> 2^53), `groupId ≠ fanId`, флаги и требования по платформам
  (HF-2), правила по возможностям: HF-8, HF-9 (P6c1), HF-5 (P6c2), опека HF-3 (P6c3), HF-4а и операции сайта (P6c4);
  `aiNameFan` метит черновик по `conversationRef`; тела проверяются схемой вендоренного SDK (`fake-hub/ai-rules.ts`).

  **Сделано в P6c1** (по хабу `bd3eec06`). Страница Fansly поддельного хаба — создатель стенда Fansly, её чаты — чаты
  стенда (`WORLD.fansly` в `scenarios/hub/world.ts`; тест держит их равными `fixture-fansly/src/data.ts`): id — строки
  из 18 цифр больше 2^53, группа никогда не равна фану; старый аккаунт (17 цифр) — страница, перепривязанная командой
  `pageAccount`. Таблица хаба «что нужно флагу на платформе» — `HUB_FEATURE_REQUIREMENTS` (`scenarios/hub/http.ts`,
  копия `client-features.ts`); это единственный источник требований: `HUB_FEATURE_CAPABILITIES` и `existsOnOnlyFans`
  выводятся из его столбца OnlyFans. После P4b3/P4b4 имена всех флагов и возможностей берутся из контрактов
  (`CLIENT_FEATURE_FLAG_NAMES`, `CLIENT_HUB_CAPABILITY_NAMES`); отдельные словари fake hub удалены, сверка с SDK
  сохранена. Каждая страница перечисляет
  все флаги (`listedFlagsOn` удалён). После HF-15 (хаб PR #617, выложенный `29708c44d010`, 2026-10-15) главный
  выключатель проверяется **перед** платформой: при master off каждая фича каждой страницы — `disabled`.
  Тот же порядок у маршрутов страницы, AI узкого токена и допуска новой отправки; повтор принятой отправки
  остаётся перед выключателями, регистрация доказанной нативной отправки не зависит от них. `pageBlanketReason`
  уже читает новый ответ и сохраняет совместимость с прежним порядком (P4b3). Страница Fansly включается только своей строкой
  (`fanslyPageFlags`): строка `"*"` до неё не
  доходит, без строки каждый её флаг — `flag_off`, как на проде; флаги, которых у Fansly нет, — `platform_unsupported`.
  `voice` идёт по полосе войсов: `lane_off` на страницах из `voiceLaneOff`. Привязка хоста OnlyMonster страницу Fansly не
  связывает. Маршруты: чтения Fansly ждут её строку, список «Новых» хаба и статистика на Fansly —
  `platform_unsupported`. Переключатель AI узкого токена — по платформе тела: на Fansly Reply, Fix, Hi, Ping — за `drafts`,
  Help — `platform_unsupported`; тело с чужой платформой — 404; Coach и короткий Recap на Fansly без `fanRef` — 400. Пара
  HF-9: захват страницы (`thread`; по умолчанию три чата мира) решает и для генерации, и для чтений по разговору: группа
  другого фана — 409 `conversation_fan_mismatch` до любых затрат, незахваченная — `pair: unverified` в кадре. Транскрипт
  генерации Fansly — архив группы, а не фана. Проверка окна HF-8в: `resolveCoverageCheck` — построчный перенос функции
  хаба; разговор задаётся целиком (`archiveConversation`: прочитанное окно, `held` рядом с ним, `deleted`,
  `lookupFails`); тест прогоняет все `hubCases` общей матрицы через SDK (ответ и вердикт клиента) и все
  `invalidRequests` (400); хаб без `coverage-check-v1` отвечает на поле 400. Опека Fansly (HF-3) — P6c3 ниже, правила Hi
  (HF-5) — P6c2, войсы, заметки и глубина — P6c4 ниже.

  **Сделано в P6c2** (HF-5, хаб `bd3eec065`, #600; §11.2, FS-AI-2). `ai-rules.ts` повторяет проверки полей
  `startProof`, `personalMessageCount`, `fanAvatarUrl` с причинами `start_proof_not_allowed`, `capability_required`,
  `start_proof_mismatch`. На Fansly Hi с заголовком `hi-start-proof-v1` решает доказательство: без него —
  `gate_hi_greeting_limit / history_unproven` до чтения контекста; противоречие с окном запроса или живой историей
  хаба — та же причина; затем > 10 личных — `too_many_personal`. Архив вне окна (`held` и сообщения за `messageCount`)
  тоже проверяется, удалённые и чужие разговоры/страницы не мешают. Ошибка чтения (`lookupFails`) — 500 до затрат.
  В fake проверка всех живых ref архива эквивалентна проверке самого старого ref у хаба. Без заголовка остаётся
  прежний порог по сообщениям; хаб без возможности отвергает новые поля и игнорирует будущий токен заголовка.
  Аватар попадает в `images` debug-кадра, доказательство — в `contextManifest.hiStartProof` только счётчиками;
  URL не скачивается. `hi-start-proof.test.ts` прогоняет через SDK все 57 случаев матрицы P4b4
  (`proofs`, `shapeCases`, `gateCases`), включая три сценария §5.8. Клиентский сценарий Hi на Fansly — P8c,
  в текущем P7a0 ещё нет этой поверхности. Контракты и закрепы ChatSpace не меняются; порядок HF-15 не переносится.

  **Сделано в P6c3.** Опека HF-3 (#582) с допусками после HF-2 (#606), по выложенному `bd3eec065`:
  таблица в `fake-hub/claims.ts` допускает на Fansly только приветствие (AI или ручное), `dispatch` — под
  `newcomers`, без `previewSend`. Статус доступен без флагов функций; `registerNativeSend` — без выключателей,
  `release`/`sent`/`failed` завершаются и после выключения. `preview-reply` на Fansly — 409, ручная группа на
  OnlyFans — 409. Ручная группа из P4c хранится и возвращается как `manual:<sha256>`, вариант 0, одна часть;
  проверка `routing.ts` расширяет только поддельный сервер, общая схема ChatSpace не меняется. HTTP-обвязка
  по-прежнему проверяет тела настоящей схемой SDK. Лимит Fansly — 30 приветствий в минуту на человека, отдельно
  от шести отправок OnlyFans (приветствия и ответы вместе); повторы и нативные регистрации не занимают место.
  Bootstrap объявляет `greetingSendPerMinute`, клиент это поле не потребляет (P4c). `fansly-claims.test.ts`
  проверяет через SDK ручной и AI-пути, гонки, повтор только на той же странице и для того же фана,
  позднее доказательство, отказ без доказательства HTTP,
  лимиты, точные id и матрицу допусков. Прежние тесты ChatSpace сохранены; устаревший тест общего запрета
  Fansly заменён этой матрицей. Порядок платформы и мастер-выключателя оставлен выложенным, HF-15 не перенесён.
  UI приветствий Fansly ещё не подключён (P9d/P10c); браузерная проверка этой границы пока — существующие
  сценарии опеки ChatSpace.

  **Сделано в P6c4** (тот же выложенный `bd3eec065`, хаб #592, #603, #583; FS-VOI-1/3, FS-NOTE-6, FS-AI-1).
  `voice-script` требует черновик и фана, проверяет пару группы и фана до расхода квоты. `voiceNoteCreate` проверяет
  завершённый и не усечённый скрипт того же пользователя, страницы, группы и фана, затем заново пару: захват мог
  измениться после генерации. Без `fanRef` сохраняется старое правило fan/fan без повторной проверки пары. Повтор с тем
  же `clientRequestId` и каноническим запросом возвращает ту же попытку; `fanRef` не входит в замороженный хеш хаба.
  Три маршрута войсов проверяют флаг `voice`, возможность `voice-notes-v1`, доступ и версию узкого токена, включая
  повторы; полный токен проходит без клиентского флага. `voiceLaneOff` моделирует выключатель расходов линии: bootstrap
  показывает `lane_off`, новый скрипт/рендер отказывает своим кодом, уже принятый рендер остаётся читаемым и повторяемым.
  Войс синтетический: создание отвечает `202 queued`, статус остаётся `queued`, аудио ещё не готово (`404`); провайдера,
  бюджета озвучки и синтеза здесь нет. Маршруты пока только в тестовом хабе (`voice.ts`), перед клиентской службой P12b2;
  требуют внедрённых `routeSchemas` SDK, проверяют ими вход и ответ. Общие контракты/фасад не расширялись.
  `fan-notes-fill` требует названия полей и фана, повторяет изоляцию полей обработчика, проверяет `notesFill`, пару и
  наличие истории; ответ — синтетические строки `Label: value`. Значения заметок клиент по-прежнему не отправляет.
  Глубина задаётся существующей командой `config`, например `patch: { limits: { deepMax: 5000 } }`: допустимы только
  1500/3000/5000. Хаб **не отказывает** запросу выше настройки: схема принимает `messageCount ≤ 5000`, читатель сокращает
  окно. С `context-v1` полный Recap читает до `deepMax` на обеих платформах, notes fill — до `max(3000, deepMax)`;
  остальные функции/клиент без `context-v1` — до 1500, короткий Recap — до 300. Меньшее окно клиента сохраняется.
  `context_v1`, проверка покрытия и сохранённая глубина рекапа отражают реально прочитанное окно. Маркер `aiNameFan`
  ставится по `conversationRef` у каждой части/варианта черновика, в том числе войса: две группы одного фана различимы.
  Проверки проходят через SDK; Fansly-поверхностей операций пока нет (P8c/P11c/P12 впереди). После выкладки HF-15
  fake hub повторяет его порядок: master перед `platform_unsupported` (см. P6c1 выше).
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
