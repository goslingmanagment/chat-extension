# R20: ChatGoose на fansly.com — архитектура

Версия 1 (набор документов v6), 2026-10-12. Как построить второй хост — fansly.com — правильно по устройству и быстро:
пакеты и границы, интерфейсы, миры страницы, фон, потоки, бюджеты, стенд, изменения хаба. **Что** строим —
`spec.md` (требования `FS-*`); **в каком порядке** — `plan.md` (PR); **как** — этот документ. Где спецификация и этот
документ расходятся в устройстве, действует этот документ; в поведении для чаттера — спецификация. Всё, что здесь не
сказано, — как у ChatSpace (`docs/architecture.md`).

**Основание.** Семь исследований 2026-10-12: код расширения (S1a, S1b), бандл fansly.com `main.2e6b96097a4bb73b` (S2),
старое расширение 2.9.0 → 2.10.1 (S3), хаб на проде `a3449f77` (S4), FBuddy (S5), Firefox (S6). Отчёты — вне
репозитория, `~/Documents/Codex/r20-detail-2026-10-12/research/`. Решающие факты координатор перепроверил по коду и
сборке. Ссылки `main:N` — строка `pretty/main.2e6b96097a4bb73b.js` снимка `~/Documents/Codex/fansly-web-bundle-2026-10-12/`.

## 0. Главное

| # | Решение | Почему |
|---|---|---|
| А1 | Два сайта — одно расширение с **реестром хостов**, **адаптером хоста**, **реестром фич** и **профилем сайта**. Общий код сайт не называет | вопрос владельца: фичи на одной или обеих платформах, разный вид панели. Сейчас ChatSpace прошит в шести местах ядра, а контракты закрыты под него (S1a §6, S1b §6) |
| А2 | Сайт выбирается при сборке: у каждого свои скрипты, ленивые чанки, тексты и фоновые службы. Бюджеты ChatSpace не двигаются, общий рефакторинг не добавляет ChatSpace ни байта | запас ChatSpace (0.2.4): MAIN 71 Б, тап 37 Б, ранний изолированный 704 Б, слой `ai` ≈ 0,75 КиБ |
| А3 | Фон делится на ядро и ленивые чанки сайтов **до** первой службы Fansly | `background.js` — 811 700 Б при потолке 819 200, ни одного `import()` (проверено) |
| А4 | MAIN Fansly только наблюдает сеть страницы: один скрипт ≤ 16 КиБ gzip, ≤ 1 мс. DOM, вставка, передача файлов — в изолированном мире | у Fansly нет моста вставки, поле — `textarea` с `ngModel`; `execCommand` расширения даёт честные `beforeinput`/`input` (S6 Q6) |
| А5 | Тексты сообщений не покидают MAIN, кроме снимка генерации по запросу. Через мост — метаданные, со склейкой по ключу чата, пачкой на задачу. Печатание (46 % кадров) и квитанции прочтения через мост не идут | дорогое место — мост, а не разбор (S2 §1.4); FS-PRIV-1 |
| А6 | Маршрут без хука `history`: путь, три наблюдателя `childList`, `popstate`/`pageshow`; Navigation API — дополнительный сигнал, где он есть (Firefox ≥ 147) | каждая смена чата пересоздаёт контейнер в той же задаче, что `pushState` (S2 Q4, Q6). FS-RTE-3 закрыт |
| А7 | Отправку человеком распознаёт MAIN: жест (захват `keydown`/`click` на основном поле) → нативный `loadstart` XHR в той же задаче → квитанция → эхо по id | Fansly шлёт `POST /message` синхронно в обработчике (S2 Q5); FBuddy может «проглотить» отправку без единого события XHR (S5 §2.6) |
| А8 | Hi на Fansly: начало разговора доказывает и личные сообщения считает вкладка — по данным, которые страница уже получила; хаб проверяет id и порог. Решает владелец (§15) | правило хаба «пустая страница» доказано у 0 из 593 новых чатов, правило старого «короткая страница» — у 562 (S4 HF-5) |
| А9 | Свои запросы к Fansly делает только фон, через пакет `fansly-api` и по списку. Сессия — из `webRequest`, шаблон переживает сон фона в `storage.session` | X4, FS-NET-1; фон засыпает через 30 с (S6 Q3) |
| А10 | Отправка приветствия — своя машина состояний HTTP и свой журнал; X8 ChatSpace не трогается | контракт X8 построен на очереди ChatSpace и `generationRef` (S1a §2.1.5) |
| А11 | FBuddy стоит у всех чаттеров. Отсюда правила: только `construct`-ловушки, без копий методов на экземплярах, без постоянного слушателя `message` на `window`, идемпотентный слот шапки, тосты не справа снизу | иначе молча ломаются его фильтр слов и журнал, а его постинг тел ответов в `window` будил бы наши слушатели (S5 §3) |
| А12 | Права Fansly опциональные (`optional_host_permissions` + `optional_permissions: ["webRequest"]`). Скрипты регистрирует фон после выдачи и заново на каждом старте | обновление не задерживается ни в каком варианте, но статические хосты дали бы права и точку внимания всем установкам (S6 Q2) |

## 1. Два сайта в одном расширении

### 1.1 Что общее и что своё

| Слой | Общее для сайтов | Своё у сайта |
|---|---|---|
| контракты | идентичности, `HostPort`, операции, AI, фасад хаба, модели видов, реестр фич | реестр моста, протокол вкладки сайта, блок контракта, раздел настроек, коды ошибок |
| логика (`core`) | домен, службы, контроллеры; сайт берётся из привязки и профиля | `core/src/{domain,services,application}/hosts/fansly/*` |
| интерфейс (`ui`) | kit, док, доски, страницы; вид меняет профиль | `ui/src/hosts/fansly/*`: заметки, войс, vault, «Регистрация», «Новые» Fansly |
| страница | `host-kit`: загрузчик MAIN, мост, `guard`, слои, keep-bottom, проба клавиш | `host-chatspace`, `host-fansly` |
| сеть | `hub` (только фон) | `fansly-api` (только фон, только Fansly) |
| сборка | корни композиции, общие слои ленивых чанков | входы, слои и чанки сайта, фоновый чанк сайта, тексты сайта, бюджеты |
| тесты | e2e-обвязка, поддельный хаб | стенд сайта, поддельный API и сокет сайта, сосед (FBuddy) |

### 1.2 Реестр хостов

`apps/extension/src/hosts/{index,chatspace,fansly}.ts` — данные, читаются при сборке, заменяют `hosts.ts`:
```ts
interface HostDescriptor {
  kind: HostKind; platform: Platform;
  matches: readonly string[]; testMatches: readonly string[];   // у стенда Fansly свой loopback-хост (§13)
  quiet: boolean;                                               // ChatSpace: ни одного своего запроса к сайту
  scripts: { main: ScriptSpec; isolated: ScriptSpec; extra?: readonly ScriptSpec[] };
  permissions: { origins: readonly string[]; optional: boolean; api?: readonly OptionalApi[] };
  lazy: { validation: string; protocol?: string; layers: readonly string[]; i18n?: string };
  background?: { chunk: string };                               // ленивые службы сайта в фоне (§3.3)
  budgets: HostBudgets; contractCheck: { module: string; bundlesRoot: string };
  archiveMarkers: readonly string[];
}
type ScriptSpec = { entry: string; file: string; world: 'MAIN' | 'ISOLATED'; registration: 'manifest' | 'dynamic' };
```
Из реестра выводятся манифест и его проверка (`build/manifest.ts`), входы WXT, хосты RPC фона и звука, регистрация
скриптов, онбординг страниц, гейты (`MAIN_WORLD_*`, `ISOLATED_BUNDLE`), строки бюджетов, `archive-check` и
`host-contract-check --host`. Код одного сайта никогда не импортирует запись другого.

### 1.3 Адаптер хоста

Вход сайта передаёт свой адаптер в общий корень композиции вкладки: `composeTab(env, adapter)`. `tab/runtime`, `keys`,
`app`, `controllers` работают с общим `HostPort` и адаптером, а не с `ChatSpaceHostPort`:
```ts
interface HostAdapter {
  readonly kind: HostKind;
  readonly profile: HostUiProfile;                                 // §1.5
  start(env: TabEnv): StartedHost;                                 // мост, монтирование, тема, HostPort
  keyProbe(doc: Document, roots: ShadowRegistry): KeyOwnership;    // чьё поле в фокусе, открыта ли модалка сайта
  routeOfLocation(loc: Location): RouteKey;                        // ранний разбор адреса для клавиш
  configure(bootstrap: Bootstrap): void;                           // у ChatSpace — liveConfigOf (X8)
  readonly lazy: HostLazyPlan;                                     // какие чанки грузить и когда
}
```
Каждый бандл несёт ровно один адаптер: выбор при сборке, поэтому код второго сайта в бандл не попадает.

### 1.4 Реестр фич и доступность

`contracts/src/features/registry.ts` — одна таблица вместо десяти разрозненных (S1b §6.2):
```ts
interface FeatureSpec {
  kind: 'ai' | 'board' | 'panel' | 'host-action' | 'service';
  hosts: readonly HostKind[];                // где фича есть вообще
  ownerFlags: readonly ClientFeatureFlag[];  // флаги страницы в хабе
  hubCapabilities: readonly string[];        // возможности bootstrap
  hostCapabilities: readonly string[];       // возможности отчёта сайта
  surfaces: readonly MountSurfaceKind[];     // что монтирует
  chip?: { group: ChipGroup; priority: number; icon: IconId };
  hotkey?: HotkeyActionId; parityRows: readonly string[];
}
```
Чистая функция `core/src/domain/features/availability.ts`:
`availability(id, {host, bootstrap, pageId, hostReport, permissions, settings})` →
- `{state: 'absent'}` — на этом сайте фичи нет: не рисуется, клавиша зарезервирована;
- `{state: 'off', reason}` — есть, но выключена флагом, правами или контрактом;
- `{state: 'on'}`.

Её читают все: док (чипы), доски, popup и «Статус», справочник клавиш, токены действий, фоновые службы (стартовать или
нет). `FEATURE_FLAGS` — дубль `FEATURE_POLICIES.flag` — уходит.

Записи: `reply`, `fix`, `hi`, `ping`, `recap`, `review`, `coach`, `spenders`, `newcomers`, `fan-panel`, `sound` — оба
сайта; `preview-send` — только ChatSpace (флаги `previewSend`, возможности `previewSend`/`receipt`); `voice`, `notes`,
`notes-fill`, `registration`, `vault`, `via-tab` — только Fansly; `navigation`/`palette` — ChatSpace (Fansly после
пилота, P17).

### 1.5 Профиль сайта для интерфейса

```ts
interface HostUiProfile {
  kind: HostKind;
  palette: Signal<Record<`--color-om-${string}`, string>>;  // тройки цветов на нашем хост-элементе
  dock: { variant: 'chatspace' | 'fansly'; keepBottomPx: number; minWidthPx: number };
  layers: { ceiling: number };                               // под модалками сайта
  keys: HostKeyTable; hotkeyClient: 'extension' | 'fansly';
  text: { host: string; account: string; platform: string }; // параметры общих текстов
}
```
- **Цвета.** Kit по-прежнему читает `--color-om-*`. На Fansly адаптер переводит переменные страницы (`--blue-1`,
  `--dark-1…8`, `--font-1`, `--border-color` и др., S2 Q9) в эти тройки и ставит их на наш хост-элемент рядом с
  `data-scheme`. Первый чанк дока не меняется.
- **Вариант дока** — атрибут `data-dock-variant` на хосте. Ширинные правила чипов зависят от варианта и приоритета
  чипа, а не от фиксированного набора из семи.
- **Чипы — данными.** `DockVM.chips: ChipVM[]` (добавочно; `actions` для замороженных семи остаётся) строится из
  реестра фич и `availability`. Чип 🎙 — запись в реестре, а не ветка в `Strip`.
- **Слоты.** Поверхность `header-slot` есть только у Fansly; что в неё рисуется («Регистрация», «Заметки»), решает
  реестр.
- **Где сайты могут различаться:** цвета, плотность, вариант раскладки, набор и порядок чипов, слоты, параметры текстов.
  **Нельзя:** копировать компонент под сайт. Если вид расходится сильнее — отдельная поверхность сайта в
  `ui/src/hosts/<host>/`, зарегистрированная в реестре.
- Галерея рисует каждую поверхность в профиле каждого сайта (`?host=fansly`); визуальную правку проверяют по снимкам
  обоих.

### 1.6 Свои реестры у сайта

| Что | ChatSpace (как есть) | Fansly (новое) |
|---|---|---|
| мост MAIN ↔ изолированный мир | `bridge.ts`, `bridge-messages.ts` | `bridge-fansly.ts` (лёгкие списки), `bridge-messages-fansly.ts` (схемы), конверты из общей фабрики; ленивый чанк `bridge-validation-fansly` |
| протокол вкладки | `tab-messages.ts` | `tab-messages-fansly.ts`, `RequestSpec.hosts`; фон объединяет реестры, вкладка Fansly грузит свой чанк |
| отчёт контракта | `anchors` — 16 якорей ChatSpace | `extensions['fansly-web']` — свои якоря и возможности (§12) |
| настройки | общий v1 | необязательный раздел `hosts['fansly-web']` в том же v1 |
| ошибки | реестр CG | области `CG-FAN-*`, `CG-NOTE-*`, `CG-VOICE-*`, `CG-VAULT-*`, `CG-FNEW-*` |
| тексты | общий каталог | пакеты `i18n-ru-fansly`, `i18n-en-fansly`: грузятся только вкладкой и поверхностями Fansly |
| ленивые чанки | слои ChatSpace | слои Fansly после общих: `bridge-validation-fansly`, `tab-protocol-fansly`, `ai-fansly`, панели |
| фоновые службы | в ядре фона | ленивый чанк `bg/fansly` |
| телеметрия | окно `chatspace:<сборка>` | окно `fansly-web:<сборка>` |

### 1.7 Как добавить фичу (рецепты для агентов)

1. **Общая, на обоих сайтах.** Запись в реестре фич (`hosts: ['chatspace','fansly-web']`) → логика в `core` без имени
   сайта → поверхность в `ui` → строки паритета и e2e на стенде каждого сайта. Если сайты дают разные данные — порт в
   контрактах и его реализация в каждом хосте.
2. **Только Fansly.** Запись с `hosts: ['fansly-web']` → домен и службы в `core/src/*/hosts/fansly/` → поверхность в
   `ui/src/hosts/fansly/` → свои сообщения в `tab-messages-fansly.ts` → тексты в пакете Fansly → e2e только на стенде
   Fansly. Код ChatSpace, его чанки и бюджеты не меняются — это проверяет гейт (§1.8).
3. **Только ChatSpace.** Зеркально (так уже устроена X8: `preview-send`).
4. **Панель на сайте выглядит иначе.** Профиль сайта: цвета, вариант дока, порядок чипов, слоты. Компоненты не
   копируются; в PR — снимки галереи обоих сайтов.

### 1.8 Гейты, которые держат разнос

- `host-literals`: в `core/src/{application,services}`, `ui/src`, `hub/src` нет литералов
  `'chatspace' | 'fansly-web' | 'onlyfans' | 'fansly'` и сравнений `host ===`/`platform ===`. Исключения:
  `contracts/src/{ids,hosts,features/registry}.ts`, `core/src/domain/features/availability.ts`, папки `hosts/<host>/`.
- `i18n-host-names`: в общих текстах нет «ChatSpace», «OnlyMonster», «OnlyFans», «Fansly» — только параметры
  `{host}`, `{account}`, `{platform}` из профиля.
- **Полнота реестра:** каждая `FeatureId`, поверхность, действие справочника, флаг хаба и ленивый вход упомянуты записью
  реестра. У каждой записи есть строки паритета и e2e на стенде каждого её сайта (связка с гейтом паритета P1b).
- **Граф пакетов:** папки `hosts/<host>/`, пакеты `host-*` и `fansly-api` импортируют только корни композиции и
  индексы реестров; общий код их не импортирует.
- **Бюджеты по сайтам и неизменность общих слоёв:** тест сравнивает замыкание общих слоёв по путям пакетов. Правка только
  кода Fansly не меняет байты чанков ChatSpace.

### 1.9 Что общий код перестаёт знать (долг ChatSpace, закрывается до кода Fansly)

| Место | Сейчас | Станет |
|---|---|---|
| `core/src/application/newcomers/controller.ts:205, 664`; `spenders/controller.ts:571`; `preview/controller.ts:809, 1495, 1770` | `host: 'chatspace'` | `binding.host` |
| `core/src/application/ai/workspace.ts:482`; `preview/controller.ts:1496` | `conversationRef = fanRef` | из маршрута или разрешения группы |
| тост фона, `ChatNavigator.open`, `NavigationIntent.target`, `RequestIdentity` | без `conversationRef` | с ним |
| `apps/extension/src/composition/background/hub-data.ts:55-57`; `hub/src/facade.ts:664`; лента; бронь | чтения хаба по `fanRef` | по `conversationRef` там, где хаб ключует разговор (HF-10) |
| `core/src/domain/telemetry/health.ts:242`; `core/src/services/telemetry/health.ts:33, 193` | один хост `chatspace`, `chatSpaceOpen` | окно на (хост, сборка) |
| `core/src/application/pages/view-status.ts:139-151, 474, 489`; `contracts/src/vm/pages.ts:86-102` | строка «ChatSpace» обязательна | строка на каждый сайт с привязками |
| `core/src/domain/hotkeys/resolver.ts:50` | клиент схемы `'extension'` | `profile.hotkeyClient` |
| `ui/src/kit/tokens.ts:18-55` | палитра только из `<html>` ChatSpace | `profile.palette` |
| `ui/src/dock/Strip.tsx:47-60`; `dock/styles.ts:112-235`; `contracts/src/vm/dock.ts:15-16` | семь чипов и пороги под них | чипы данными |
| `hub/src/facade.ts:343` | «… · ChatSpace» в имени устройства | нейтрально |
| `hub/src/ai-request.ts` | мёртвый сборщик (`conversationRef = fanRef`), вызывают только тесты; рабочий — `core/src/domain/ops/request.ts:105` | удалить |
| `host-chatspace/src/main/requests.ts:9, 23` | MAIN ChatSpace принимает оба вида хоста | только `'chatspace'` |
| ≈ 47 текстов с именами сайтов на общих путях | захардкожены | параметры профиля |

## 2. Карта

```
fansly.com (вкладка модели; права выданы «Включить Fansly»)
 ├─ MAIN: fansly-main.js — document_start, регистрирует фон; ≤ 16 КиБ gzip, ≤ 1 мс
 │    Proxy (только construct) над WebSocket и XMLHttpRequest; слушатели на экземплярах
 │    разбор кадров wsv3 и ответов API; наблюдение чатов, сертификаты, снимок генерации
 │    жест отправки (захват keydown/click) → loadstart → квитанция → эхо
 │    не пишет в DOM, не шлёт запросов и кадров, не трогает прототипы
 │        ⇅ MessagePort host-kit (рукопожатие, реестр Fansly, пачки со склейкой по ключу)
 ├─ isolated: fansly.js — document_start; адаптер Fansly, HostPort, маршрут, монтирование, слот шапки,
 │    вставка (execCommand), передача файлов, тема, клавиши;
 │    лениво: слои дока, ai-fansly, панели Fansly (заметки, войс, vault), «Новые», тексты Fansly
 ├─ iframe relay — только при «Fansly через вкладку», на время запросов + 60 с
 │        ⇅ runtime.Port 'cg-tab' / 'cg-relay'
background (event page)
   ядро: вход и хаб, bootstrap, операции AI, настройки, логи, телеметрия, звук,
         синхронизация прав и регистрации скриптов, лёгкий слушатель webRequest
   лениво bg/fansly: fansly-api, пейсер, транспорт и relay, «Новые» (Б17), отправка с опекой,
         войсы, заметки, «Регистрация», Spenders Fansly
   → хаб https://gosling-agency.ru;  → https://apiv3.fansly.com/api/v1/ только по списку FS-NET-1
```

Потоки — §9.

## 3. Сборка, бандлы, бюджеты

### 3.1 Бандлы Fansly

| Файл | Что | Бюджет |
|---|---|---|
| `content-scripts/fansly-main.js` (регистрируется) | MAIN целиком: загрузчик host-kit, два Proxy, разбор, наблюдение, снимок, жест | ≤ 16 КиБ gzip; ≤ 1 мс на `document_start` |
| `content-scripts/fansly.js` (регистрируется) | ранний изолированный: адаптер, клиент моста, маршрут, монтирование, клавиши | ≤ 30 КиБ; ≤ 3 мс |
| `lazy/bridge-validation-fansly.js` | схемы моста Fansly | ≤ 30 КиБ |
| `lazy/tab-protocol-fansly.js` | схемы протокола вкладки Fansly | ≤ 30 КиБ |
| `lazy/ai-fansly.js` | свежесть, снимок, вердикт, доказательство Hi на стороне вкладки | ≤ 30 КиБ |
| `lazy/fansly-notes.js`, `fansly-newcomers.js`, `fansly-voice.js`, `fansly-vault.js` | панели сайта | ≤ 30 КиБ каждый (войс при превышении делится) |
| `lazy/i18n-{ru,en}-fansly.js` | тексты Fansly | ≤ 30 КиБ |
| `bg/fansly.js` | службы Fansly в фоне | своя строка; стартово ≤ 200 КиБ raw, утверждается по базе P3d |

16 КиБ для MAIN: у ChatSpace два MAIN-скрипта, 10 + 6 КиБ (X11, X25). У Fansly всё в одном: тап должен стоять до первого
XHR Angular, а второй MAIN-скрипт — лишняя точка, которую страница может перехватить (довод X11).

### 3.2 ChatSpace не платит за Fansly

- Бюджеты ChatSpace не двигаются. Запас (сборка 0.2.4): `chatspace-main.js` 10 169 из 10 240 Б gzip,
  `chatspace-ws.js` 6 107 из 6 144, `chatspace.js` 30 016 из 30 720, слой `ai` 29,25 из 30 КиБ, `background.js`
  811 700 из 819 200 Б raw (archive-check).
- PR, который трогает общий код (`host-kit`, адаптер, реестры), нейтрален по байтам для ChatSpace или освобождает байты в
  том же PR. Строки бюджета ChatSpace — в его «готово».
- Код только для Fansly не лежит в общих слоях. Свежесть Fansly, снимок, вердикт — в слое `ai-fansly`, а не в
  `core/src/application/ai`, который собирается в слой `ai` ChatSpace.

### 3.3 Фон: ядро и чанки сайтов (до первой службы Fansly)

- Вторая сборка Vite для фона (как `lazy/` для вкладок): `bg/<name>.js`, загрузка `import(runtime.getURL('bg/fansly.js'))`
  из event page. Если классический event page Firefox такой `import()` не принимает — `background.type: "module"`
  (спайк P3a).
- **Ядро фона** — то, что должно работать сразу при пробуждении: слушатель `webRequest.onBeforeSendHeaders` на верхнем
  уровне (иначе событие не разбудит фон, S6 Q3), синхронизация прав и скриптов, приём `tab.register`. Слушатель кладёт
  шаблон заголовков в память и `storage.session` и чанк Fansly не тянет.
- `HostServices` — `{ 'fansly-web': () => import('bg/fansly.js') }`. Чанк грузится при первой регистрации вкладки Fansly,
  при выдаче прав и при старте фона, если Fansly включён и есть незавершённые работы (журнал отправок, попытки войсов,
  загрузка vault).
- Профиль только ChatSpace чанк Fansly не грузит и не разбирает никогда.

### 3.4 Тексты

Общие ключи берут параметры из профиля; ключи только Fansly — пространство `fansly.*` в пакетах `i18n-*-fansly`.
Страницы расширения (popup, настройки) несут оба пакета. Каталог `ru` ChatSpace (23,35 из 30 КиБ) тексты Fansly не
получает.

## 4. Права и регистрация скриптов

- **Манифест** (добавочно):
  - `optional_host_permissions`: `https://fansly.com/*`, `https://apiv3.fansly.com/*` (их уже покрывает `https://*/*`
    для адреса хаба; перечисляем явно, чтобы запрос был понятным);
  - `optional_permissions: ["webRequest"]`;
  - `web_accessible_resources` для `https://fansly.com/*` — ленивые чанки Fansly и страница relay.
- **Никаких** `host_permissions` и статических `content_scripts` для Fansly. Обновление они не задержали бы, но выдали бы
  fansly.com каждой новой установке, поставили бы точку внимания на вкладках Fansly и внедрили бы тап чаттерам, которые
  ещё не перешли (S6 Q2).
- **«Включить Fansly»** — один синхронный `permissions.request({origins: [fansly, apiv3], permissions: ['webRequest']})`
  в обработчике клика popup или настроек; в запросе видны только два адреса. Включение доводит фон по
  `permissions.onAdded`: popup может закрыться раньше.
- **Синхронизация** — на каждом старте фона (на верхнем уровне), на `onAdded`/`onRemoved` и на переключателе. Если оба
  адреса выданы и Fansly включён — зарегистрированы `fansly-main` (MAIN) и `fansly` (ISOLATED), оба `document_start`,
  `allFrames: false`, `persistAcrossSessions: true`; иначе сняты. Обновление расширения стирает регистрации (S6 Q1);
  синхронизация возвращает их в первую секунду. Уже открытые вкладки их не получают — баннер «перезагрузите вкладку»
  (FS-IDN-4). `platform/scripting.ts` учится регистрировать изолированные скрипты и наборы скриптов сайта.
- **Отзыв прав.** Регистрации снимаются; уже внедрённые копии живут до перезагрузки, новые документы скриптов не получают
  (S6 Q2). Начатые операции доводятся или останавливаются по FS-PERM-5.
- **Своя старая копия MAIN после обновления** остаётся в открытых вкладках со своими Proxy. Маркер версии MAIN и версия
  протокола моста: новый изолированный мир старую копию не принимает, новая MAIN при найденной старой отступает; полнота
  `unknown`, баннер.

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
  секунду (S2 Q1.8).

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
| `/message` без `groupId` | квитанция `POST /message`: нужны `response.id`, `groupId`, `senderId === креатор` |
| `/messages?ids=` | сообщения по id |
| `/message/unread` | id и группы непрочитанных — метаданные |
| `/group/<id>/` или `/group/<id>` | группа, если `response.id === <id>`: участники, правила ЛС, `lastMessage` |
| `/messaging/groups` | группы, `lastMessageId`, `aggregationData` |
| `/account/me` | креатор |
| `/message/automated` | приветственные тексты — классификатор Hi (§5.8) |
| `/vault/albums/media` | подтверждение vault (§7.11) |

- `JSON.parse(xhr.responseText)` — Angular ставит `responseType = 'text'`, готового объекта нет — только для путей
  таблицы, `status` 2xx и `success === true`. Строку ответа не храним.
- `/messaging/groups` (до 115 КБ) разбираем в `requestIdleCallback` с тайм-аутом. Перед снимком генерации отложенные
  разборы доделываются синхронно; пока разбор висит, у затронутых групп полнота `unknown`.
- Бюджет: ≤ 2 мс на задачу; ответ вне таблицы — ≤ 0,01 мс (сравнение строк).

### 5.5 Наблюдение чатов

- **Метаданные:** кольцо последних 120 id на чат (id, направление, время, тип, `correlationId`, `inReplyTo`, медиа,
  удалён), не больше 300 чатов. **Тексты:** последние 60 сообщений для 20 недавно активных чатов, ≤ 2 МиБ. Всё
  наблюдение — ≤ 4 МиБ (FS-TAIL-5). Вытеснение по давности активности; вытесненный чат — `unknown`.
- Порядок — по snowflake-id (сравнение длины, затем строки), а не по `createdAt` в секундах: сообщения одной секунды
  страница вставляет в обратном порядке (S2 Q1.5).
- Вложенный `inReplyToMessage` — не сообщение чата.
- Память учитывается по длине строк и числу записей; пределы проверяет ускоренный тест (P7b).
- Источники — всё, что приносит сообщения или их id (FS-TAIL-3), плюс `data[].lastMessageId` из `/messaging/groups` и
  `/message/unread`.

### 5.6 Полнота и сертификаты

Чат: `unknown` → `complete` только по сертификату. `complete` → `unknown`: новая эпоха сокета, повреждённый кадр,
вытеснение, источник сообщил о непросмотренном сообщении (`lastMessage`/`lastMessageId` новее наблюдения), bfcache.

**Сертификат** — ответ страницы на `GET /message?groupId=…&limit=25` без `before`, запрос которого **начат после `t:1`
текущего сокета** (`loadstart` в эпохе) и закончен в той же эпохе, без потерь разбора между ними:
- первый в документе — начинает непрерывное наблюдение с самого старого сообщения ответа;
- восстановление — только если ответ перекрывает известное наблюдение (содержит последнее сообщение, известное до
  потери) или доходит до начала разговора (ответ короче 25).

Свежий конец открытого чата страница сама перезапрашивает после каждого `t:1` и после скрытия вкладки дольше 30 с
(S2 Q1.7) — это естественные точки восстановления. Запрос, начатый до `t:1` при загрузке страницы, сертификатом не
считается. A → B → A запросов не делает и полноту не теряет, если соблюдено всё выше.

**Начало разговора доказано** — сертификат-ответ короче 25 сообщений без `before` (правило старого, S4 HF-5): у чата
ставится `startProven`.

### 5.7 Личность

- Креатор — `account.id` из ответа страницы на `GET /account/me`. HF-1 проверен: у всех шести страниц он равен
  `external_page_id` (S4).
- Группа: тип (1 — ЛС, 3 — рассылка) и участники. Фан — участник, отличный от креатора, при ровно двух участниках; иначе
  групповой чат — без AI и слота шапки (FS-IDN-3).
- Правила ЛС (`dmPermissionFlags`, `accountDmPermissionFlags`) — для «только копировать» (FS-DOCK-3).
- Изолированный мир узнаёт личность из события `fx.identity`, группу открытого чата — из `fx.chat`.

### 5.8 Снимок генерации

По запросу `fx.generationSnapshot {groupId, feature, window, withText}` MAIN за один синхронный шаг отдаёт:
```ts
interface FanslySnapshot {
  identity: { creatorId: NativeId; groupId: NativeId; fanId: NativeId };
  epochs: { document: string; socket: number; route: number };
  completeness: 'complete' | 'unknown'; startProven: boolean;
  window: Array<{ id: NativeId; dir: 'fan' | 'model' }>;   // до min(60, окно функции)
  knownFanMessageIds: NativeId[];                         // до 10 последних сообщений фана окна
  deletedIds: NativeId[];                                 // удалённые в окне, которые видела вкладка
  personal?: { count: number; automatedIds: NativeId[] }; // только Hi
  tail?: LiveTextMessage[];                               // только Reply, Fix, Hi, Ping
  truncated: boolean;
}
```
- Перед шагом доделываются отложенные разборы XHR (§5.4).
- Кадр ≤ 128 КиБ UTF-8; при переполнении первыми отбрасываются старые тексты, `truncated: true`.
- Пустое окно при полном наблюдении — законный снимок (своя схема, не `LiveTextTail` с `min(1)`).
- **Счёт личных для Hi** (как у старого, NF-033): автоматические — сообщения модели с `type === 2`, или с `correlationId`
  без `inReplyTo`, или с текстом, равным приветственному тексту из ответа `/message/automated` после нормализации;
  сообщения фана — всегда личные. Hi на Fansly доступен при `startProven` и `count ≤ 10`; иначе клиент отказывает
  словами порога. Хаб проверяет id окна и порог (HF-5, решение владельца §15.1).

### 5.9 Отправка человеком

1. MAIN в фазе захвата на `window` слушает `keydown` (Enter без Shift, не `isComposing`, не `Process`) и `click` по
   `.send-button`, если цель внутри `app-messages-conversation-route > app-group-message-container >
   app-group-message-input`. Слушатели пассивны: ничего не отменяют.
2. Жест помечается до ближайшей микрозадачи. XHR, у которого за это время случился `loadstart` (он синхронен внутри
   `send()`), получает метку жеста.
3. `loadend` помеченного `POST /message` — квитанция `{id, groupId, senderId}`.
4. Эхо — `5/1` с тем же `id` от креатора. Квитанция и эхо в любом порядке → событие `fx.sent {groupId, msgId}`.
5. Не было `loadstart` до конца задачи — значит, отправки не было: например, её «проглотил» фильтр слов FBuddy
   (S5 §2.6). Метка гаснет, следующая отправка атрибутируется как обычно.
6. Отправка с медиа идёт асинхронно (шаблоны медиа) и не атрибутируется — это правило, а не ошибка.
7. Изолированный мир связывает `fx.sent` со вставкой нашего черновика по отпечатку текста на момент жеста (§7.5) →
   `op.reportSent`.

### 5.10 Чужие скрипты на странице

- **FBuddy** (S5): прототипные хуки XHR и подмена `fetch` ставятся после нашего скрипта; его сокеты живут в его
  изолированном мире, наш тап их не видит. Признаки для диагностики: `script#fbuddy-window-bridge-script`,
  `window.__FBUDDY_NETWORK_HOOK__`, `style#fb-fansly-style-fixes`, непустой `script#fbuddy-restricted-words-data`
  (фильтр слов активен). В «Статус» и `client_health` — только булевы.
- **video.js** забирает конструктор XHR — это наш Proxy, безопасно.

## 6. Мост MAIN ↔ изолированный мир (реестр Fansly)

Механизм — host-kit, как у ChatSpace: `postMessage` только на время рукопожатия, затем `MessagePort`; конверт
`{v, kind, id, t, documentEpoch, seq, payload}`; всё входящее проверяет изолированный мир. После соединения у нас **не
остаётся ни одного** слушателя `message` на `window`: FBuddy постит туда тело каждого ответа API (S5 §2.4).

**Запросы в MAIN (`ToMainFansly`):**

| Тип | Данные | Ответ |
|---|---|---|
| `probe` | — | версия, время установки, `socketSeen`, `accountMeSeen`, легаси |
| `fx.state` | — | личность, эпохи, открытая группа (старт и перезапуск изолированного мира) |
| `fx.focus` | `{groupId \| null}` | — (MAIN шлёт `fx.chat` по этой группе) |
| `fx.generationSnapshot` | `{groupId, feature, window, withText}` | `FanslySnapshot` |
| `fx.windowMeta` | `{groupId}` | сводка окна (для `chatWindow`) |

**События из MAIN (`FromMainFansly`):**

| Тип | Данные | При перегрузке |
|---|---|---|
| `fx.identity` | креатор, `accountMeSeen`, легаси, FBuddy (булевы) | состояние: последнее побеждает |
| `fx.chat` | `{groupId, fanId \| null, kind, dmAllowed, window: {loaded, newestId, newestAt, completeness, startProven, fanCyrillic}}` — только открытая группа | склейка по `groupId` |
| `fx.incoming` | `{groupId, fanId, msgId, fromFan, automated, tip, createdAt}` — каждое `5/1`, свои тоже | не отбрасывается (свежесть, звук, эхо фоновых отправок) |
| `fx.follow` | `{eventId, accountId, followerId}` | не отбрасывается |
| `fx.sent` | `{groupId, msgId, gestureAt}` | не отбрасывается |
| `fx.coverage` | `{groupIds \| 'all', state, reason}` | не отбрасывается |
| `fx.deleted` | `{groupId, ids}` (открытая группа) | не отбрасывается |
| `fx.vaultAdded` | `{albumId, mediaIds}` | не отбрасывается |
| `fx.contract` | сетевые якоря: `accountMe`, `socket`, `frames`, `xhr` | состояние |
| `fault` | место, счёт (X22) | — |

- Склейка — по **ключу** (тип + группа), а не по типу: сейчас в `main/bridge.ts:193` и `bridge-client.ts:156` события
  разных чатов одного типа затирают друг друга.
- Пачка — одна отправка на задачу (сброс в микрозадаче), порядок событий сохраняется.
- Схемы — в ленивом чанке `bridge-validation-fansly`; схемы ChatSpace и их фикстуры не меняются.
- Имя `snapshot` занято запросом ChatSpace, поэтому у Fansly — `fx.state` и `fx.generationSnapshot`.

## 7. Изолированный мир Fansly (`packages/host-fansly/src/isolated`)

### 7.1 Старт

Синхронный старт без обёртки WXT (как X23): адаптер Fansly → клиент моста host-kit → маршрут и наблюдатели → проба
клавиш. Остальное — лениво, в порядке ChatSpace: валидация моста с первым кадром MAIN, протокол вкладки и приложение —
с первым полем или ждущей клавишей, панели — при открытии.

### 7.2 Маршрут

- Источник — `location.pathname` по `^/messages/(\d+)$`. Группа и чат разделены: `RouteState.conversationRef = groupId`,
  а `chat` (с `platformFanId`) появляется, когда фан известен из `fx.chat`.
- Сигналы: три наблюдателя `childList` без `subtree` (§7.3), `popstate`, `pageshow`/`pagehide`, на Firefox ≥ 147 —
  `navigation.currententrychange`. Каждая смена чата пересоздаёт контейнер в той же задаче, что `pushState` (S2 Q4,
  Q6), поэтому наблюдатель маршрута видит её всегда; Navigation API — ранний сигнал, а не основа. Хука `history` нет.
- Счётчик «адрес сменился без сигнала» сверяет путь на событиях нашего UI, `visibilitychange` и `focus` — в
  `client_health`.
- **Галерея** убирает шапку и контейнер без смены адреса: док и слот исчезают, это не ошибка.
- Эпохи маршрута, аккаунта и поля отбрасывают запоздавшие ответы (FS-RTE-4).

### 7.3 Монтирование

- **Якоря — только через маршрут.** Мини-чат, галерея, модалка новой рассылки и редакторы сообщений повторяют те же
  классы (S2 Q7), поэтому:
  - контейнер — `app-messages-conversation-route > app-group-message-container`;
  - поле — `… > app-group-message-input textarea.message-input`, отправка — `.send-button`;
  - файл — `.collapsable-actions > input[type=file]`;
  - «только копировать» — `> div.no-dm-allowed` или `div.message-composer.hidden`;
  - шапка — `> div.message-content-header .message-content-header-contact .content-header-sub-row`.
- **Наблюдатели:** `childList` без `subtree` на `div.content-wrapper`, `div.messages-content-wrapper`,
  `app-messages-conversation-route` (в простое молчат, S2 Q11); тема — атрибут `class` на `<html>`. Поддеревья шапки и
  контейнера не наблюдаем: там узлы FBuddy и строка «печатает», которая появляется и исчезает при каждом наборе фана.
- **Док** — хост `div` без классов (X22) прямо перед `app-group-message-input` внутри контейнера, `flex: 0 0 auto`. При
  смене чата тот же хост с закрытым корнем переносится в новый контейнер: хост вставляется один раз и двигается, чтобы
  лишний раз не будить наблюдатель FBuddy. Нет контейнера при маршруте чата (новая сборка) — фиксированный оверлей над
  полем (FS-PLC-3).
- **Строка «печатает»** (`div.partner-is-typing`: нулевая высота, `z-index: 2`) рисуется поверх верхнего края дока, поэтому
  у хоста дока `position: relative; z-index: 3`.
- **Низ ленты:** keep-bottom host-kit с порогом 350 px (`xdScrollWatcher`); `scrollTop = 0` не пишем никогда.
- **Узкая колонка.** Боковая панель FBuddy (400 px и `flexGrow 3` у инбокса) сужает чат. Док деградирует по ширине
  (`profile.dock.minWidthPx`), а раскладка не зависит от высоты поля: CSS FBuddy делает поле двухстрочным.

### 7.4 Шапка: «Регистрация» и «Заметки»

- Один контроллер слота на обе кнопки. Блок контакта с `.content-header-sub-row` пересоздаётся при каждой смене чата
  (S2 Q6), поэтому слот вставляется заново в колбэке наблюдателя маршрута — идемпотентно (только если нашего узла нет),
  после `.gallery-hot-icon`.
- Нет блока контакта (групповой чат, галерея) — нет слота. Якорь пропал в новой сборке — сломанный якорь в «Статусе»,
  дата — в панели фана (FS-REG-4).
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
   `beforeinput` и `input`, правка попадает в отмену, `ngModel` обновляется (S6 Q6). Страница сообщит фану «печатает» —
   как при ручном наборе.
4. Сверка значения сразу и после задачи страницы. Запасная запись `value` + `input` — только если доказано, что первая
   поле не изменила. Частичный или неясный исход — `uncertain`, повтора нет (FS-INS-2).

- Записи FBuddy (шаблоны, эмодзи, перевод, возврат текста фильтром слов) идут нативным сеттером и недоверенными `input`.
  В наш синхронный шаг они попасть не могут, но могут лечь между записью и сверкой — тогда `uncertain` без повтора.
- Новое поле получает кэш черновика страницы через микрозадачу, а высоту — через `setTimeout(0)`. Поэтому «два стабильных
  наблюдения» отложенной вставки охватывают хотя бы одну макрозадачу после появления контейнера.

### 7.6 «Открыть и вставить»

Клик по `a[href="/messages/<groupId>"]` в `.messages-list-wrapper`, если строка загружена и рядом с окном (список
виртуальный, подгружается по 20 групп). Иначе `history.pushState` + `PopStateEvent('popstate', {state: null})` — Angular
читает `state`, объект из нашего мира ему передавать нельзя — с проверкой через 2 с и полной загрузкой по ссылке, если
чат не открылся (SP-036). Дальше — отложенная вставка (§7.5).

### 7.7 HostPort Fansly

| Член | Реализация |
|---|---|
| `kind`, `platform` | `'fansly-web'`, `'fansly'` |
| `probe`/`onContract` | общий отчёт (16 возможностей; `previewSend`, `receipt`, `chatList` — off) + блок `extensions['fansly-web']` (§12) |
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
класса `bright-theme`/`dark-theme` на `<html>` — и переводятся в тройки `--color-om-*` профиля. Синий `--blue-1` — только
у того, что уходит фану (FS-DOCK-1). Шрифт наследуется (Roboto).

### 7.9 Клавиши

- Тот же ранний диспетчер; клиент схемы — `'fansly'`: у вендоренной схемы 2 он обслуживает все строки `extension` и
  `notes` (S4 HF-11), хабу менять нечего.
- Поле сайта — `textarea.message-input` основного контейнера. Наши клавиши уступают, пока стоит `body.modal-opened`
  (модалка Fansly, проверка O(1)) или фокус внутри хоста `fb-*-ui` (окно FBuddy). Enter в поле — за Fansly.
- **⌘⇧L на Mac** — это и наш Split, и перевод FBuddy по умолчанию (`keydown` на поле, S5 §2.6); наш диспетчер ловит
  раньше. Решает владелец (§15.1); по умолчанию — наш Split, а чаттерам с переводом FBuddy — переназначить его.

### 7.10 Войс: прикрепление

- Файл передаётся в `input[type=file]` основного поля двумя путями старого — `DataTransfer` в изолированном мире,
  запасной через `wrappedJSObject` + `cloneInto`, с записью, какой сработал (S6 Q7), — и одним событием `change`.
- Fansly открывает свою модалку загрузки и **прикрепляет файл только после клика человека «Upload»** (S2 Q5).
  Подтверждение — новый `app-account-media-create-template.attachment` в `div.message-attachments` основного поля и
  закрытие модалки (`body.modal-opened` снят). Наблюдатель `childList` на `.message-attachments` живёт только пока
  попытка открыта: до закрытия модалки + 20 с.
- Неоднозначно (мини-чат, два вложения, модалка закрыта без вложения) — «неизвестно». Файл сам повторно не передаётся;
  «Прикрепить ещё раз» требует подтверждения.

### 7.11 Vault

`/creator/vault`, панель загрузки (ленивый чанк). Один файл на `change` в `app-media-upload-input input[type=file]`
открытого альбома. Подтверждение — ответ на `POST /vault/albums/media` (событие `fx.vaultAdded` наблюдателя XHR) и
перезагрузка альбома. Контрольная точка на аккаунт и альбом пишется до передачи файла. Список наблюдается только пока
идёт загрузка (FS-VLT-2).

### 7.12 Контракт хоста и деградация

Якоря Fansly: `conversationRoute`, `container`, `composer`, `textarea`, `sendButton`, `fileInput`, `headerContact`,
`headerSubRow`, `attachments`, `noDmAllowed`, `modalFlag` (`body.modal-opened`), `themeClass`, `vaultUpload` и сетевые
`accountMe`, `socket`, `frames`, `xhr`. Каждая возможность деградирует сама (FS-CTR-2). `tools/host-contract-check --host
fansly` проверяет якоря по свежей копии бандла.

## 8. Фон: службы Fansly

### 8.1 Состав

В ядре фона: слушатель `webRequest` (шаблон заголовков), синхронизация прав и скриптов, приём регистрации вкладки Fansly,
передача `fansly.*`-сообщений в чанк. В чанке `bg/fansly` — всё из §8.2–8.12. Логика — в
`core/src/{domain,services}/hosts/fansly/*` поверх портов; `fetch` — только в `packages/fansly-api` (и `hub`). Порт
`FanslyApiPort` объявлен в контрактах, реализован `fansly-api`, связан в корне композиции фона.

### 8.2 Сессия

- `webRequest.onBeforeSendHeaders` без блокировки, `['requestHeaders']`, `urls: ['https://apiv3.fansly.com/*']`, на
  верхнем уровне ядра фона. `extraHeaders` в Firefox — ошибка схемы (S6 Q3). Требует выданных обоих адресов.
- Берём только запросы страницы: `tabId ≥ 0`, документ — `https://fansly.com/…`, не наш relay и не скрипт другого
  расширения. FBuddy шлёт свои запросы из той же вкладки с повторёнными, возможно устаревшими заголовками (S5 §3.9); как
  они выглядят в `webRequest` — спайк P3b.
- Шаблон — на аккаунт (legacy id из `authorization` → canonical из `/account/me`, алиасы AU-031…033): `authorization`,
  `fansly-client-id`, `fansly-session-id`, последний `fansly-client-check` по семейству маршрутов. Хранится в памяти и
  `storage.session` (переживает сон фона, теряется при перезапуске браузера и обновлении); в логи не попадает никогда.

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

429 может вызвать не наш запрос: FBuddy опрашивает `/message/unread` раз в 10 с из каждой вкладки (S5 §3.10). Охлаждение
общее на креатора; источник 429 считается в `client_health`.

### 8.5 Транспорт и relay

- Два пути: прямой `fetch` из фона (запрос идёт без прокси контейнера) или «Fansly через вкладку» (E149): скрытый
  `moz-extension`-кадр в закрытом корне вкладки этой модели. Его запросы Firefox относит к вкладке, и прокси контейнера
  их берёт. Кадр `about:blank` нельзя: им управляет service worker Fansly, и запросы уходят без вкладки и без прокси
  (S6 Q11).
- Кадр поднимается лениво на пачку работы и живёт ещё 60 с. Маршрут выбирается до опеки хаба; кадр обязан подняться и
  ответить до неё. Смена документа, аккаунта или вкладки — отказ до опеки. Прямого запасного пути при включённом режиме
  нет.
- Порт `cg-relay`, свой вид отправителя: страница relay расширения, `frameId ≠ 0`, внутри зарегистрированной вкладки
  Fansly. Правило `frameId === 0` для `cg-tab` не ослабляется.

### 8.6 Отправка приветствия с опекой (HTTP)

Своя машина состояний и журнал `fansly.send.journal` (только id, без текста); X8 и `send.journal` не меняются.
```
ready → claimed (бронь фана, продление раз в 40 с) → routed (слот пейсера и кадр relay готовы)
      → dispatched (опека хаба HF-3: группа AI или ручная, билет 10 с) → requestStarted (fetch начат)
      → receipted (ответ с id, groupId, senderId) → sent (эхо 5/1 с тем же id)
отказы: refused — доказанный отказ до отправки или 4xx, кроме 401; uncertain — всё остальное после dispatched
```
- Билет хаба живёт 10 с, поэтому всё, что может ждать (пейсер, relay), идёт **до** `dispatch`, а `POST /message` — сразу
  после.
- Ручная группа: `{kind: 'manual', textFingerprint: sha256(точный текст)}`; неизменённый AI-текст идёт группой генерации
  (FS-NEW-6).
- `200 {success:false}` — `uncertain`, пока не доказано, какие коды значат «не доставлено» (S4 HF-3 #5); такие ответы
  копятся в `client_health` по коду.
- Эхо: сокет вкладки модели получает и сообщения, отправленные через API (S2 Q1.8), — фон ждёт `fx.incoming` с этим id
  от любой вкладки этого креатора. Нет вкладки — сверка по `GET /message?groupId` при следующем проходе.

### 8.7 «Новые» (Б17)

- Источник — проход фона через `fansly-api` по правилам старого: `followersnew` ≤ 20 страниц, начало инбокса, профили
  пачками по 100, проверка строк, история до пустой страницы ≤ 30 страниц, `POST /group` одной попыткой (S3 §2.7). Не
  `audience-new` хаба.
- Модель вида общая с ChatSpace (`NewcomersVM` добавочно получает «Нельзя написать», состояние очереди, исключение);
  контроллер выбирает источник через порт.
- Окно получает **изменения строк** по порту вкладки, а не опрашивает снимок раз в 700 мс, как старое.
- Журнал прохода — IndexedDB (`openBoundedStore` из `platform/idb.ts`) с ротацией; в памяти — хвост.
- Черновики — общий механизм «Новых» (5000 символов, 24 ч, 100 на хранилище), запись с задержкой, а не на каждую
  клавишу.
- Доказательство для генерации и отправки даёт проход: id проверенной истории (оба направления, до 60 последних),
  `groupId`, `startProven`, счёт личных, `historyRevision` (FS-NEW-7).

### 8.8 Войсы

Оплаченные попытки — в `storage.session`, с CAS по ревизии; при восстановлении — тот же `clientRequestId`, без
автоповторов (как у старого, S3 §2.6). Поток: `voice-script` (`conversationRef = groupId`, `fanRef`) → `voiceNoteCreate`
(`conversationRef`, `fanRef`, HF-4) → статус → аудио через `fetchVoiceNoteAudio` SDK.

### 8.9 Заметки и «Заполнить из чата»

- Чтения и записи — по FS-NOTE-*. Заметку FBuddy «FBuddy Notes» (12000, может нести `[FBUDDY_SYNC]`) показываем как
  чужую: только чтение с предупреждением, никогда не правим и не «чистим» (S5 §3.11).
- «✨ Заполнить из чата» (старое 2.10.x, E159–E161) — AI-функция хаба `fan-notes-fill`. В хаб уходят только названия
  полей анкеты; окно глубокое; `conversationRef = groupId`, `fanRef`. Ответ сливается в пустые поля, заполненные
  показываются как «было → станет».

### 8.10 «Регистрация»

Дата — из snowflake id фана. Id фана — из `fx.chat`: страница сама запрашивает `/group/<id>/` при каждом заходе в чат.
Запрос фона `GET /group/<id>` — только если фан не известен, одна попытка, ничего во время охлаждения.

### 8.11 Spenders на Fansly

`groupId` фана — из строк Spenders хаба (`platformConversationId`, S4), из ответов страницы (кэш групп), иначе один поиск
в инбоксе по клику или `POST /group` (FS-SPD-2). Имена — из хаба; запрос к Fansly — только если хаб их не дал.

### 8.12 Звук

Факты `fx.incoming` и `fx.follow` идут пачкой в общий арбитр (дедупликация по платформе, аккаунту и id события). Правило
«чат открыт в окне в фокусе» — по фокусу и видимости, о которых сообщают вкладки, без права `tabs`. «Своё» — креатор
вкладки, его алиасы и все модели, чьи вкладки видел этот браузер (сохраняемый набор, S3 G19). Подписчики Fansly — из
сокета (`3/2`), а не из опроса хаба.

### 8.13 Телеметрия

Окно `HealthWindow` — на пару (хост, сборка); в id отчёта `client_health` входит хост (иначе хаб отбрасывает второй отчёт
окна как дубль). Fansly считает:
- доли FS-TAIL-9 с числителем и знаменателем;
- время разбора кадра и ответа;
- «адрес без сигнала»;
- источники 429;
- вставки `uncertain`, атрибутированные и потерянные отправки;
- булевы FBuddy и фильтра слов;
- какой путь передачи файла сработал.

Без согласия на телеметрию — только локально; для пилота это учтено в §15.1.

## 9. Сквозные потоки

### 9.1 Reply со свежестью

1. Клик или клавиша → контроллер дока: `availability('reply')` — on, токен действия.
2. Изолированный мир: `freshness.snapshot(chat, {feature: 'reply', window: 100, withText: true})` → MAIN за один
   синхронный шаг → `FanslySnapshot`.
3. `StartOp {…, target: {conversationRef: groupId, fanRef}, proof: {kind: 'tab-snapshot', …}}` → фон: допуск (одна
   операция на чат, три на вкладку) → запрос к хабу: `conversationRef`, `fanRef`, `liveTextContext` (хвост),
   `coverageCheck` (окно и удалённые) при возможности `coverage-check-v1`, `messageCount` 100.
4. Хаб отвечает кадром `context_v1` с ответом по каждому id окна → вердикт по §3.5 спецификации → результат с пометкой
   или без.
5. Ключ операции включает `conversationRef` и отпечаток доказательства; повторно открытый результат показывает свой
   вердикт.

### 9.2 Hi в чате

Снимок с `personal` и `startProven` → клиент отказывает сам, если доказано больше 10 личных; иначе запрос с
`personalMessageCount` и `startProof` (id окна) → хаб проверяет id (все `included`) и порог → три варианта.

### 9.3 Вставка → отправка человеком → `sent`

Вставка (§7.5) пишет запись «наш черновик» (отпечаток, ревизия) → человек жмёт Enter → MAIN: жест → `loadstart` →
квитанция → эхо → `fx.sent` → изолированный мир сверяет отпечаток текста на момент жеста с записью → `op.reportSent` и
`ai_acceptance` `sent`.

### 9.4 Приветствие из «Новых»

Проход → строка «можно писать» с доказательством → генерация по доказательству прохода или свой текст → клик
«Отправить» → фон: бронь → маршрут (пейсер, relay) → `dispatch` (AI или ручная группа) → `POST /message` → квитанция →
эхо из вкладки → `sent` в хаб.

### 9.5 Войс

Скрипт (`voice-script`) → варианты → оплата (`voiceNoteCreate`; попытка записана в `storage.session` до запроса) → статус
→ MP3 → «Прикрепить» → файл в поле → модалка Fansly → человек «Upload» → вложение → подтверждение.

### 9.6 Обрыв сокета

Новая эпоха → все чаты `unknown` → `t:1` → страница перезапрашивает свежий конец открытого чата → ответ, начатый после
`t:1`, перекрывает наблюдение → `complete`. Остальные чаты восстанавливаются, когда их откроют: их свежий конец страница
запросит заново, отметка сброшена.

### 9.7 Обновление расширения

Регистрации стёрты → фон стартует → синхронизация возвращает их. В открытых вкладках жива старая MAIN-копия, новый
изолированный мир её версию не принимает → баннер «перезагрузите вкладку», полнота `unknown`. Новые документы получают
новые скрипты.

## 10. Производительность

### 10.1 Бюджеты и чем они держатся

| Что | Бюджет | Как держим | Где мерим |
|---|---|---|---|
| MAIN | ≤ 16 КиБ gzip, ≤ 1 мс | один бандл без зависимостей, без zod | size, bundle-timing |
| ранний изолированный | ≤ 30 КиБ, ≤ 3 мс | адаптер и маршрут, остальное лениво | size, bundle-timing |
| кадр сокета | ≤ 0,1 мс в среднем | три `JSON.parse` кадра ≤ 2 КиБ; ни одной отправки моста для печатания и квитанций | своя метрика в `client_health` |
| ответ XHR | ≤ 2 мс на задачу | разбор только путей таблицы на `loadend`; `/messaging/groups` — в простое | своя метрика |
| мост | ≤ 1 отправки на задачу | склейка по ключу, пачка на микрозадачу | счётчик |
| снимок генерации | ≤ 5 мс | один синхронный шаг, ≤ 128 КиБ | своя метрика |
| память MAIN | ≤ 4 МиБ, тексты ≤ 2 | кольца и LRU | ускоренный тест, долгий прогон |
| `routeToDockMs` / `insertMs` | p95 ≤ 50 / 100 мс | хост дока переносится, а не создаётся; ленивые слои грузятся один раз | perf-проба |
| вкладка | цель +15 МБ, гейт пробы 25 МБ (как у ChatSpace) | без копий текстов в изолированном мире | perf-проба |
| фон | ≤ 30 МБ на профиль | чанк Fansly только при Fansly; журналы в IndexedDB | `about:memory`, 10 вкладок |
| простой | ни одного своего таймера чаще 1 Гц, ни одного опроса | три молчащих наблюдателя, слушатели только на экземплярах и поле | Firefox Profiler |

### 10.2 Наш код на открытом чате в простое

- MAIN: слушатели на экземплярах сокета и XHR срабатывают только на события страницы; захват `keydown`/`click` — дешёвая
  проверка цели.
- Изолированный мир: три наблюдателя `childList` и наблюдатель класса `<html>` молчат; захват клавиш диспетчером;
  слушатели `input` и композиции — на привязанном поле, а не на документе.
- Таймеров нет.
- Для сравнения — старое на открытом чате: ≈ 5,5 вызова таймеров в секунду (два опроса адреса по 500 мс, два
  «пробуждения» шапки по 2 с), три наблюдателя на всё дерево разговора, ≈ 14 слушателей документа и окна, сообщение в фон
  на каждый пинг сокета, чтение всего `storage.local` раз в 5 минут (S3 §2.18).

### 10.3 Фон и много вкладок

- Каждое событие `webRequest` сбрасывает таймер сна фона: пока Fansly активен, фон бодрствует, и бюджет 30 МБ считается
  для этого режима.
- Присутствие вкладок: сейчас каждая вкладка шлёт отметку раз в 10 с, при 10 вкладках Fansly это одна отметка в секунду.
  Отдельным PR после замера P16a отметку шлёт одна вкладка-хранитель (видимая или последняя), а отчёты здоровья уходят
  только при изменении. Если байты раннего бандла ChatSpace этого не позволяют — только для вкладок Fansly.
- Факты звука идут пачкой, а не RPC на каждый факт.

### 10.4 С соседом

Каждый замер и бюджет — в двух условиях: сосед (FBuddy) выключен и включён; база старого — в тех же условиях (S5 §3.8).
Реальная страница чаттера всегда с FBuddy: его наблюдатель документа, пересканирование при фокусе, запись заголовка раз в
10 с, клонирование и разбор каждого ответа API.

## 11. Хаб

Порядок PR хаба; каждый при слиянии ничего не включает (S4 §5):

| # | PR | Что | Почему инертен |
|---|---|---|---|
| 1 | HF-8а | точные строковые id на всём пути (≈ 8 мест `Number(ref)`) | байты промптов OnlyFans не меняются, дайджесты закреплены |
| 2 | HF-8д | уровень покрытия Fansly из цепочки движка | читают только клиенты с `context-v1` на Fansly — их нет |
| 3 | HF-9 | проверка пары `groupId ↔ fanRef` по `page_dm_threads`; 409 `conversation_fan_mismatch`; новая пара — с пометкой `pair: unverified` | Fansly-путь ядра без трафика |
| 4 | HF-8в | новое поле запроса `coverageCheck` (≤ 60 id обоих направлений + удалённые) и поле кадра с ответом по каждому id; возможность `coverage-check-v1` | поле никто не шлёт |
| 5 | HF-8б | свежий текст для Fansly; ветка `dm_live_messages` в поиске свежего текста (удаления и чужие группы, которые знает только сокет) | `freshText` у Fansly `platform_unsupported` до #14 |
| 6 | HF-6 | глубина 5000 одной настройкой на обе платформы: константа, настройка, путь `live_union`, `messageCount ≤ 5000` в теле, Fansly в `mayReadDeepTranscript` | настройка стоит на 1500 |
| 7 | HF-7 | паритет контекста: подписи медиа из `media_metadata`, био при гидрации, сохранённое имя из `page_alias` (источник уже есть), PPV из `media_orders`, пометки автоматики, `transcriptCoverage` из цепочки; аватар — §15.1 | трафика нет |
| 8 | HF-5 | Hi на Fansly: доказательство начала и счёт личных от клиента (`startProof`, `personalMessageCount`), проверка id окна и порога; отказ с причиной `history_unproven` / `too_many_personal` | трафика нет |
| 9 | HF-4а | личность войса: `conversationRef = groupId`, `fanRef`, проверка пары; старый формат работает | добавочно |
| 10 | HF-4б | войсы в узком токене, флаг `voice`, возможность `voice-notes-v1`, доступность в bootstrap | флаг выключен |
| 11 | HF-3 | ручная группа (`manual:<sha256>` без миграции), правила опеки Fansly, лимит приветствий по назначению (≥ 30 в минуту; у старого пик 29), доказательство отказа HTTP, на Fansly — только `purpose: greeting` | `platform_unsupported` до #14 |
| 12 | HF-10 | общие рекапы, сохранение досье и лента — по `conversationRef` | под флагами |
| 13 | HF-12 | узкий токен: Reply, Fix, Hi, Ping, `voice-script`, `fan-notes-fill` — под флагами страницы (сейчас только мастер-выключатель) | — |
| 14 | HF-2 | Fansly в требованиях по платформам (`newcomers` на Fansly — без `audience-new-v1`); флаги Fansly `voice`, `notes`, `notesFill`, `vault`, `registration`; строку `"*"` Fansly не наследует | Fansly читает `flag_off`, пока владелец не поставит строки |

Затем: выкладка; «SDK для тестов» после каждой схемы; «SDK для выпуска» — из выложенного коммита; регистрация SDK
расширения в реестре замороженных SDK хаба (строки расширения там нет, S4); флаги владельца на `lora-1` и `ari-1`. HF-1
(личность страниц) проверен, кода нет. HF-11 (клавиша заметок) не нужен: на Fansly клиент схемы — `fansly`.

Клиент шлёт новые поля только при объявленных возможностях (`coverage-check-v1`, `manual-greeting-v1`, `voice-notes-v1`,
рекапы по `conversationRef`) и со своими токенами `x-kernel-ai-capabilities`: тело запроса строгое, и старый хаб ответил
бы 400.

## 12. Контракты 1.15.0 (добавочно, `contract-change:`)

| Где | Что |
|---|---|
| `hosts.ts` (новый) | `HOST_PLATFORM`, `HOST_TEXT_PARAMS` |
| `ids.ts` | пара хост↔платформа — из `HOST_PLATFORM`, а не `chatspace ⇔ onlyfans` в refine |
| `features/registry.ts` (новый) | `FeatureSpec`, `CLIENT_FEATURES` |
| `host.ts` | `RouteState.conversationRef?`, `conversationKind?: 'direct' \| 'group'`; `NavigationIntent.target.conversationRef?`; `HostContractReport.host?`, `anchors` → `z.partialRecord` (принимает все старые отчёты), `extensions?: {'fansly-web'?: {anchors, capabilities}}`; `HostPort.freshness?`, `HostPort.fansly?`; `ChatWindow.fanScript?`, `newestAt?` |
| `fansly.ts` (новый) | `FanslySnapshot`, `FanslyPagePort`, `FanslyAnchorId`, `FanslyCapability` |
| `bridge-fansly.ts`, `bridge-messages-fansly.ts` (новые) | реестр моста Fansly (§6), фабрика конвертов |
| `ops.ts` | `StartOp.proof?: CoverageProof` (снимок вкладки или доказательство прохода; хвост внутри); `checkpoint` не трогаем; `ServedContext.coverageCheck?`; новые причины `stale` |
| `send-fansly.ts` (новый) | машина состояний HTTP-отправки, журнал, запрос приветствия «Новых», ручная группа |
| `tab-protocol.ts` | `TypeSchema` — до двух точек; `RequestSpec.hosts?`; вид отправителя `relay`, порт `cg-relay` |
| `tab-messages-fansly.ts` (новый) | `fansly.followers.*`, `fansly.voice.*`, `fansly.vault.*`, `fansly.notes.*`, `fansly.relay.*` |
| `settings.ts` | необязательный `hosts?: {'fansly-web'?: {enabled, viaTab, notesView, sound: {messagesTone, subscribersTone}}}` в v1, без v2: откат не делает настройки «только для чтения» |
| `limits.ts`, `settings.ts` | `messageCountMax` и `windowDeep.max` — 5000, действуют только при `limits.deepMax ≥ 5000` из bootstrap |
| `hub/ai.ts` | `HUB_AI_FEATURES` += `voice-script`, `fan-notes-fill`; новые поля тела — под возможностями |
| `telemetry.ts` | окно на (хост, сборка), хост в id отчёта |
| `errors.ts` + приложение А архитектуры | `CG-FAN-*`, `CG-NOTE-*`, `CG-VOICE-*`, `CG-VAULT-*`, `CG-FNEW-*` |
| `vm/dock.ts` | `DockVM.chips` |
| `vm/selectors.ts` | поверхность `header-slot`, панели Fansly |

Схемы ChatSpace и их фикстуры не меняются, кроме двух мест с решением: `anchors` становится `partialRecord` (все старые
отчёты проходят), а фикстура `window: 3001` остаётся недопустимой, пока bootstrap не объявил 5000.

## 13. Тестовая инфраструктура

- **Стенд Fansly** — `packages/testing/fixture-fansly/`: наше Angular-подобное приложение по структуре живого DOM, без
  кода Fansly, + `fixture-fansly.vite.config.ts` → `.cache/fixture-fansly`. У стенда **свой loopback-хост** (`localhost`;
  у ChatSpace — `127.0.0.1`): адрес, который подходит двум хостам, фон отвергает (S1b G-10).
- **Поддельный Fansly** — `src/fake-fansly/{api,socket,data,proxy}.ts`:
  - XHR-API: `ngsw-bypass`, `responseType: 'text'`, конверт, 429, `success: false`;
  - сокет `{t, d}`: эпохи, `t:1`, пинг `"p"`, события всех чатов (5/1, 5/10 с каскадом, 4/2, 5/22, 3/2), пакеты `t:10001`,
    повреждённые кадры;
  - журнал по происхождению вызова: «только список FS-NET-1» и «ни одного `/message/ack` от нас» проверяются **на
    сервере** — ловушка сети не видит запросов фона к loopback.
- **Сосед** — `src/fake-fansly/neighbor/`: эмуляция FBuddy по S5 §6. Режимы `off`, `after` (по умолчанию), `before`,
  `reinject`, `legacy`; флаги `+guard`, `panel=desktop|mobile|off`, `generic` (чужой Proxy над XHR и WebSocket —
  проверка устойчивости); 11 утверждений e2e.
- **Поддельный хаб** — страницы Fansly с 18-значными id (> 2^53), `groupId ≠ fanId`, вердикты по платформам (HF-2), модели
  HF-3/4/5/8/9; `aiNameFan` метит черновик по `conversationRef`.
- **База старого** (P3d) — тестовая сборка старого с адресами стенда (подмена при сборке), в том же headless Firefox, со
  звуками включёнными, с заметками в обоих видах, с соседом и без.
- **Perf** — `e2e/perf/fansly-perf-probe.e2e.ts`: 10 вкладок Fansly + ChatSpace, 100 переключений, 20 циклов оверлея,
  сосед включён и выключен.

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

| # | Вопрос | Предложение |
|---|---|---|
| 1 | Hi на Fansly: кто доказывает начало разговора | вкладка по данным страницы (короткая свежая страница, как у старого) и проход «Новых»; хаб проверяет id и порог. Правило хаба «пустая страница» отказывает почти всем новым чатам (0 из 593) |
| 2 | ⌘⇧L на Mac: наш Split или перевод FBuddy | наш Split; чаттерам с переводом FBuddy — переназначить его |
| 3 | Аватар фана для Hi | из данных, которые страница уже загрузила (как у старого), только для Hi |
| 4 | Есть ли у агентства организация FBuddy (фильтр слов, журнал сообщений) | наши фоновые приветствия идут мимо фильтра и журнала FBuddy — принять или учесть |
| 5 | Согласие на телеметрию у пилотных чаттеров | включить на пилотных профилях, иначе наблюдение пилота слепо |

### 15.2 Спайк (P3a, P3b): что осталось после исследований

1. Динамический `import()` из классического event page Firefox или `background.type: "module"` с WXT 0.21.4 — для чанка
   `bg/fansly` (§3.3).
2. Регистрация изолированного скрипта рядом с MAIN: порядок, `persistAcrossSessions`, поведение после обновления; WAR
   Fansly при невыданных правах.
3. `loadstart` синхронен внутри `send()` в Firefox; порядок квитанции и эха; поля ответа `POST /message`.
4. Стоимость разбора кадра и ответа 115 КБ на ПК чаттеров; размер MAIN в gzip.
5. Как запросы FBuddy из той же вкладки выглядят в `webRequest` (`originUrl`, `documentUrl`).
6. Доставка `navigation.currententrychange` в изолированный мир.
7. Ответы `POST /vault/albums/media` и `POST /group/<id>/`.
8. Подписанные сборки (P3b): обновление без задержки, один запрос прав, пробуждение фона событием `webRequest`,
   появление `browser.webRequest` после выдачи.

## 16. Где что строится

| Раздел | PR (`plan.md`) |
|---|---|
| §1 два сайта | F1–F9 |
| §3 сборка и фон | F1, F2, P16a |
| §4 права | P9a, P14c |
| §5–§6 MAIN и мост | P4a2, P5, P7a, P7b, P7f, P7g |
| §7 изолированный мир | P7c–P7e, P7h, P7i, P8d, P11a, P11b, P12c, P13a |
| §8 фон | P9a–P9e, P10a–P10d, P11b, P12a–P12b2, P13b, P14a |
| §9 потоки | e2e каталога (`plan.md` §3) |
| §10 производительность | P3d, P16a, P16b, бюджеты каждого PR |
| §11 хаб | этап 2 |
| §12 контракты | P4a1–P4c |
| §13 стенд | P6a–P6d |
