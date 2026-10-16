# R20: ChatGoose на fansly.com — план работ

Версия 8, 2026-10-13: после матрицы паритета (P1a, `parity-matrix.md` §4). Версия 7 — после арены-ревью (Opus 5.5 + astra,
max, два раунда; решение X36). Что строим — `spec.md`
(требования `FS-*`); как устроено — `architecture.md` (разделы `§N` ниже — оттуда); факты о странице — `fansly-web.md`;
решения владельца — X33, X34, X37 в `docs/decisions.md`, решения координатора — X35, X36. Пути файлов — стартовые: исполнитель
сверяет их с текущим `main`.

**Список PR зафиксирован матрицей паритета** (`parity-matrix.md`, P1a): у каждой строки, касающейся Fansly, — один
PR-владелец из таблиц ниже. Что матрица изменила в версии 8: аватар фана для Hi (FX-018) — поле в HF-5 и P4b4, URL из
ответов страницы в P7b, передача в P8c и P10c; P14b разделён на P14b1 и P14b2; новый спек `suite-fansly-ai` (P8c);
назначения тестов NF, VA, AU-033 и эталоны HF-7б…HF-7д поправлены; P1b принимает виды проверки матрицы; по решениям
координатора — счёт личных прохода «Новых» по последним 30 (HF-5, P10b1) и «Открыть в Fansly» в новой вкладке (P10a).
Новых рёбер графа нет. Новая строка или выпуск старого после 2.10.1 — строка матрицы и правка плана.

## 0. Правила

- **Один PR — одна небольшая задача.** Draft; перед Ready — `pnpm check` и **полный** `pnpm e2e` локально (e2e — в Docker,
  `tools/ci/e2e-docker-local.sh`); в Ready — один раз. Сюиты помечены сайтом — для быстрого локального цикла и учёта цены,
  но дымовой набор полный прогон перед Ready не заменяет. Работа — в отдельном worktree.
- **Ничего не включается при слиянии.** Всё Fansly-специфичное — за флагами страницы в хабе (`chatExtensionFeatures`) и за
  «Включить Fansly» в расширении. Пока флаги выключены, выпуски ChatSpace идут как обычно, и Fansly-кода у чаттеров
  ChatSpace нет: ни в их вкладках, ни в фоне (§1, §3).
- **ChatSpace не ломаем и не утяжеляем.** PR, который трогает общий код (`core`, `ui`, `contracts`, `hub`, `host-kit`,
  `composition`, `platform`), держит зелёными все e2e ChatSpace и в «готово» называет дельту по **каждой** строке реестра
  байтов (§4) и откуда взяты байты; пределы не растут. PR только одного сайта не меняет ни одного файла, который грузят
  вкладка и фон другого (гейт F9a). Файлы ChatSpace закреплены по размеру и sha256 в `tools/gates/chatspace-bytes.json`,
  `pnpm gates` сверяет с ними выпускную сборку: PR, который двигает эти байты, переписывает закрепы (`pnpm gates:bytes`) в
  своём диффе; PR только с файлами Fansly их не трогает и переписать не может (архитектура §1.8, «Как сравниваются
  байты»). Старые фикстуры контрактов проходят без изменений, кроме мест, названных в §12 архитектуры.
- **Хаб — отдельный репозиторий**, свои PR по правилам `docs/hub-pr-plan.md`. У каждого PR — **предикат нового
  поведения** (платформа, вид клиента, возможность, флаг), а не довод «трафика нет»; реальные формы запросов старого 2.10.1
  заморожены в регрессионных тестах до и после. Четыре разных события:

| Событие | Что значит | Что разрешает |
|---|---|---|
| **схема слита** | PR хаба со схемой в `main` хаба | контракт расширения (этап 4) и поддельный хаб (P6c*) по этой схеме |
| **SDK для тестов** | SDK перевендорен из **слитого** `main` хаба в ветку расширения | разработку и e2e на поддельном хабе; такую ветку нельзя выпускать |
| **хаб выложен** | серверный этап на проде | живые проверки — наблюдение пилота |
| **SDK для выпуска** | SDK из **выложенного** коммита | выпуск расширения (правило `AGENTS.md`) |

- **Чтение живого Fansly доступно через Chrome DevTools MCP** (X38): агент проверяет DOM, стили, консоль и сеть по
  [справочнику](../research/fansly.md). Это не проверка отправки/прикрепления и не замена Firefox-стенда.
  Повторных smoke у владельца нет (X34); способы старого проверяются на стенде, приёмка вживую — пилот с наблюдением (P16d).
- **FBuddy стоит у всех чаттеров** (X34): PR, который трогает тап, наблюдатель XHR, док, вставку, отправку или шапку,
  проверяет себя и рядом с «соседом» стенда (P6d), в режимах по умолчанию `off` и `after`. Включается адресом страницы
  стенда (`?stand-neighbor=after`, `after,guard`, `before,panel=mobile`…) или умолчанием стенда для всех следующих
  загрузок (`setFanslyNeighbor`), в e2e — `e2e/support/fansly-neighbor.ts`; эталон без нас —
  `fansly-stand-neighbor.e2e.ts`.
- **Тест закрывает строку паритета только на своём хосте и своём уровне.** Хост теста — по пути файла: Fansly — спеки
  `suite-fansly-*` и `fansly-*` (`perf/fansly-perf-probe`), `packages/host-fansly/**`, `packages/fansly-api/**`,
  `**/hosts/fansly/**`, `**/bg/fansly/**` и стенд Fansly (`packages/testing/fixture-fansly/**`,
  `packages/testing/src/fixture-fansly/**`, поддельный Fansly с соседом — `packages/testing/src/fake-fansly/**`);
  ChatSpace — `packages/host-chatspace/**`, `**/hosts/chatspace/**`,
  `**/bg/chatspace/**` и фикстура стенда ChatSpace; прочие спеки идут на стенде ChatSpace, прочие тесты — без хоста. В
  общем коде и у смешанных тестов — явная метка хоста в названии теста: `[host:fansly]`, `[host:chatspace]` или обе;
  метки собираются на файл. Поэтому в файле с меткой одного сайта каждый блок верхнего уровня, который называет строки,
  несёт метку, иначе `pnpm parity` отказывает (F9b): чужой блок без метки уехал бы со своими строками на этот сайт —
  так строка AI-142 ушла с ChatSpace на Fansly через блок Fansly в `sdk-alignment.test.ts`, теперь он в своём файле.
  Тест ChatSpace с тем же id строку Fansly не закрывает (`[NF-011]` в
  `suite-preview.e2e.ts:112` закрывает её только на ChatSpace); юнит-тест не закрывает строку, которой нужен браузерный
  сценарий. Это держит гейт `pnpm parity` (P1b, `parity-matrix.md` §1).
- **PR отмечает себя сделанным в своём же диффе:** добавляет `docs/project-unite/done/<PR id>` (например, `done/P7e`),
  пустой файл или одну строку пояснения. Id должен быть в таблицах §2, неизвестный id — ошибка. Старые `✓` в строках
  плана остаются действительными: гейты читают объединение обеих отметок, переносить старые отметки не нужно.
  С отметкой каждая строка матрицы этого PR должна быть закрыта на Fansly, иначе `pnpm parity` падает; PR хаба отмечает
  PR расширения, который вписывает его подтверждения в §10 `parity-matrix.md`.
- **e2e фичи принадлежит последнему PR её цепочки**, и этот PR стоит после P7a0 (сайт на стенде). PR в середине цепочки
  проверяет свою границу юнит- и интеграционными тестами.
- **Каждый PR называет разделы архитектуры**, которые он реализует; расхождение с архитектурой — правка архитектуры в том
  же PR или вопрос координатору.
- **Граф — только столбцы «Зависит от»** в таблицах этапов (у PR хаба — тоже). Группы §1.1 выведены из них скриптом
  (102 узла с версии 8, циклов нет); новое ребро — правка таблицы и пересчёт групп.

## 1. Граф этапов

| # | Этап | Где | PR | Зависит от |
|---|---|---|---|---|
| 0 | Документы | chat-extension | этот | — |
| 1 | Матрица паритета и гейт | chat-extension | P1a, P1b | 0 |
| 2 | Хаб | hub, chat-extension | HF-8а, HF-8д, HF-9, HF-8в, HF-8б, HF-5, HF-4а, HF-3, HF-6, HF-7д0, HF-7а…д, HF-4б, HF-10, HF-12, HF-2, HF-13; P2v | таблица этапа |
| 3 | Спайк, подписанные сборки, база старого | chat-extension | P3a, P3b, P3d | таблица этапа |
| F | Общее под два сайта | chat-extension | F1, F2, F2b, F3, F4, F5, F6a, F6b, F7, F8, F9a, F9b, F10 | таблица этапа |
| 4 | Контракты 1.15.0 | chat-extension | P4a1, P4a2, P4a3, P4b1–P4b4, P4c | таблица этапа |
| 5 | `host-kit` | chat-extension | P5 | таблица этапа |
| 6 | Стенд, поддельные Fansly и хаб, сосед | chat-extension | P6a, P6b, P6c1–P6c4, P6d | таблица этапа |
| 7 | `host-fansly` и подключение сайта | chat-extension | P7a0, P7a–P7i | таблица этапа; P7a0 — после всего этапа F, кроме F6b |
| 8 | Ядро и UI на Fansly | chat-extension | P8a, P8b1–3, P8c, P8d, P8e | таблица этапа |
| 9 | Права, `fansly-api`, relay, отправка, Spenders | chat-extension | P9a–P9e | таблица этапа |
| 10 | «Новые» | chat-extension | P10a, P10b1–3, P10c, P10d | таблица этапа |
| 11 | «Регистрация», «Заметки», «Заполнить из чата» | chat-extension | P11a, P11b, P11c | таблица этапов 11–14 |
| 12 | Войсы | chat-extension | P12a, P12b1–3, P12c | таблица этапов 11–14 |
| 13 | Vault | chat-extension | P13a, P13b | таблица этапов 11–14 |
| 14 | Звук, страницы, «Включить Fansly» | chat-extension | P14a, P14b1, P14b2, P14c | таблица этапов 11–14 |
| 15 | Переход и откат | — | снят (X34) | — |
| 16 | Приёмка, выпуск и пилот | chat-extension | P16a, P16b, P16g, P16c, P16d, P16f (P16e снят X34) | таблица этапа |
| 17 | После пилота: навигация на Fansly | chat-extension | P17 | 16 |

### 1.1 Порядок

Группы выведены из столбцов «Зависит от»; внутри группы стрелка — зависимость, точка с запятой — независимые цепочки.
Хаб идёт рядом: расширение до выкладки хаба живёт на поддельном хабе со «SDK для тестов».

| Группа | Расширение | Хаб |
|---|---|---|
| 0 | P1a; P3a; P4a1; F2; F8 | HF-8а; HF-8д; HF-9; HF-3; HF-6; HF-7д0; HF-12; HF-13 |
| 1 | P1b; P3b (выполнен 2026-10-16); F1; F2b; F3; P4a2; P4a3; P6a | HF-8в, HF-8б, HF-7а…д (← HF-8а; HF-7д ещё ← HF-7д0); HF-4а, HF-10 (← HF-9) |
| 2 | F4; F5; F6a; F7; F9a; F10; P6b; P6d; P4c | HF-5 (← HF-8в, HF-9); HF-4б (← HF-4а) |
| 3 | F6b; F9b; P5; P3d; P4b1 | HF-2 (← HF-3, HF-4б, HF-12) |
| 4 | P7a0; P4b2; P4b3; P4b4; P6c1 | выкладка, «SDK для выпуска» |
| 5 | P7a → P7b → P7c → P7d → (P7e → P7f; P7h; P8d; P13a → P13b) → P7i (← P7f); P9a (← P7a0) → P7g (← P7c); P6c2; P6c3; P6c4 | — |
| 6 | после P7i: P8a; P9b; P14a; P14b1; P14b2. Затем P8a → P8b1 → (P8b2 → P8b3 → P8e; P8c; P12a → P12b1 → P12b2 → P12b3 → P12c); P9b → (P9c → P9d; P9e; P10a → P10b1 → (P10b2; P10b3); P11a → P11b → P11c) | — |
| 7 | P10c (← P10b2, P9d, P8c, P7f) → P10d; P14c (← P10c, P12c, P13b) | — |
| 8 | P16a → (P16b; P16g) → P16c → P16d → P16f | — |

Критический путь: F2 → F3 → F4 → F9b → P7a0 → P7a → P7b → P7c → P7d → P7e → P7f → P7i → P8a → P8b1 → P12a → P12b1 →
P12b2 → P12b3 → P12c → P14c → P16a → P16b → P16c.

## 2. PR по этапам

### Этап 1. Паритет

| PR | Что | Файлы | Готово, когда | Зависит от |
|---|---|---|---|---|
| P1a ✓ | матрица: каждая строка, касающаяся Fansly (строки `Fansly`, `пилот + Fansly`, пилотные строки ChatSpace с функцией на Fansly, NF-001…039, AI-032…037, AI-110…115, AI-143…148, VA-001…006, SN-017…020, SP-036…041, новые FX-001…003 — E149, E152, E155; FX-004… — «Заметки» E157, E158; FX-00x — «Заполнить из чата» E159–E161) → требование `FS-*`, **один** PR-владелец, тест на стенде Fansly нужного уровня (юнит или браузер) или исключение владельца; `FS-*` без строки — тоже в матрице; у каждой строки — откуда поведение (старое, ChatSpace, новое) | `docs/project-unite/parity-matrix.md` (новый), `docs/parity/parity-checklist.md`, `docs/parity/parity-manifest.json` | у каждой строки один владелец; план переведён в версию 8, если матрица что-то изменила; SP-054 исключена из пилота явно (сейчас `пилот + Fansly` в `parity-map.md:359`) | 0 |
| P1b ✓ | гейт: пара «строка × хост × уровень»; хост теста — по пути файла (§0); владелец строки — PR (`R20/P7e`) из `parity-matrix.md`, а не только пакет `R00–R20` (`tools/parity/manifest.ts:15, 43`); строки `Fansly` больше не `n/a` (`derive.ts:74`); виды проверки — из матрицы (§1): `браузер`, `юнит`, `хаб` (тест с id строки в PR хаба — внешнее подтверждение), `общий` (тест без хоста закрывает строку на обоих сайтах), `отрицательная`, `после пилота`; строка PR, отмеченного сделанным, без теста на своём хосте — ошибка; к пилоту незакрытых строк Fansly быть не может | `tools/parity/{manifest,derive,coverage,coverage-report,index}.ts`, тесты `tools/parity/*.test.ts` | тест гейта: `[NF-011]` из `suite-preview` не закрывает строку Fansly; юнит-тест не закрывает строку браузерного уровня; исключение владельца проходит | P1a |

Назначения — в `parity-matrix.md` §7 (строки) и §8 (`FS-*`). Новые строки: FX-001 «Fansly через вкладку» — P9c; FX-002
«Регистрация» — P11a; FX-003 «Нельзя написать» — P10b2; FX-004…FX-013 «Заметки» — P11b; FX-014…FX-016 «Заполнить из
чата» — P11c; FX-017 сбой списка «Новых» ≠ пусто — P10a; FX-018 аватар фана для Hi — P8c.

### Этап 2. Хаб (репозиторий `hub`)

Каждый PR — по `docs/hub-pr-plan.md`: схема и обработчик в одном PR, `contracts:generate`, Draft → Ready один раз; тесты на
коммите прода (`a3449f77`). Порядок — архитектура §11.2 и §1.1 этого плана. Допуски Fansly — таблица архитектуры §11.1.

| PR | Что | Стартовые файлы хаба (`a3449f77`) | Обязательные тесты | Предикат нового поведения | Зависит от |
|---|---|---|---|---|---|
| HF-8а | точные строковые id на всём пути: ref строкой, сравнение числовых строк | `modules/ai/context/{index,context-frame,live-text,media-notes}.ts`, `prompts/transcript/{normalize,ofapi-message}.ts` | разные id с одним `double` (`…001`/`…002`, `…936`/`…064`) живут раздельно до промпта и ответа о покрытии; дайджесты OnlyFans не меняются | рефакторинг; байты промптов OnlyFans те же | — |
| HF-8д | уровень покрытия Fansly в кадре — из цепочки движка (`page_dm_threads.history_state`) | `services/client-coverage.ts`, `context/context-frame.ts:230-238` | `complete` → `complete`; иначе `unknown` | Fansly, `context-v1` | — |
| HF-9 | проверка пары `groupId ↔ fanRef` по `(platform_account_id, platform_conversation_id)` (`page_dm_threads … partner_platform_user_id = fanRef`); 409 `conversation_fan_mismatch`; неизвестная хабу новая пара — пометка кадра `pair: unverified` | `features/index.ts` (одна точка ветвления Fansly, `:347`), `context/chat-access.ts` | несовпадение → 409; новая пара → `unverified`; формы старого (`group/fan` с `clientContext`, `fan/fan`) — ответы без изменений; OnlyFans без изменений | Fansly, ядро без `clientContext` | — |
| HF-8в | проверка покрытия окна: поле тела `coverageCheck {window: [{id, dir}] ≤ 60, deletedIds ≤ 60}` и поле кадра с ответом по каждому id (`included`, `direction_mismatch`, `outside_window`, `deleted`, `absent`, `unknown`; для удалённых — `deleted`, `still_served`, `absent`); возможность `coverage-check-v1` и токен `x-kernel-ai-capabilities`; предел поиска 100 ref — поднять или два поиска | `routes.ts:2005-2056, 2317`, `context/context-frame.ts`, `packages/db/src/repositories/ai-live-context.ts:37-41` | ровно один ответ на каждый запрошенный id; удалённое вкладкой, но `included` у хаба — расхождение; общая матрица фикстур с клиентом (P8b2); поле в тесте предела тела | возможность `coverage-check-v1` | HF-8а |
| HF-8б | свежий текст для Fansly: убрать отказ (`live-text.ts:81-85`); ветка `dm_live_messages` в поиске свежего текста — удаления, чужие группы, отправитель, время; принадлежность группе; `live.matched` в кадре | `context/live-text.ts`, `packages/db/src/repositories/ai-live-context.ts:237-353` | хвост Fansly принят; удалённое, которое знает только сокет, — `deleted`; чужая группа — `context_conflict` | Fansly, флаг `freshText` | HF-8а |
| HF-5 | Hi на Fansly: `startProof` v1 (`source`, `groupId`, `startWitnessId`, `coveredCount`, `personalCount`, `automatedIds`) и `personalMessageCount` верхнего уровня; хаб проверяет id окна (`coverageCheck`), начало (нет противоречия со свидетелем начала и известной хабу актуальной историей; удалённая историческая строка противоречием не считается) и порог ≤ 10; отказ `gate_hi_greeting_limit` с причиной `history_unproven` / `too_many_personal`; у `source: 'pass-empty-page'` `personalCount` — личные среди последних 30 сообщений пройденной истории, как у старого (`followers-service.ts:880-883`; решение по матрице, P1a), у вкладки — по всей доказанной истории; поле `fanAvatarUrl` верхнего уровня для `hi-greeting` на Fansly (та же `fanslyAvatarUrlSchema`, хаб URL не скачивает; сейчас поле есть только в `clientContext`, `routes.ts:2373-2387`; FX-018, X37) — архитектура §11.2 дополняется в этом PR. Решение владельца — архитектура §15.1 п. 2 (X37) | `features/index.ts:195-267` (ветка Fansly), схема тела в `routes.ts` | допуск: доказанное начало, 0 личных, автоматика; три сценария архитектуры §5.8; отказ без доказательства; отказ при 11 личных; проход: 11 личных в начале длинной истории и ≤ 10 среди последних 30 — допуск; пустой чат; аватар без `clientContext` доходит до модели картинкой, как у старого; формы старого без изменений | возможность `hi-start-proof-v1`, ядро без `clientContext` | HF-8в, HF-9 |
| HF-4а | идентичность войса: `voice-script` с `conversationRef = groupId ≠ fanRef` и проверкой пары; `createVoiceNote` принимает необязательный `fanRef` и проверяет источник по паре; старый формат работает | `features/index.ts:452-487`, `services/voice-notes.ts:341-352, 412-426` | скрипт → настоящий `createVoiceNote` при разных id без `clientContext`; несовпадение пары → 409; запрос старого 2.10.1 без изменений (проверено на его форме); стирание фана удаляет войс группы | новое поле `fanRef` в создании озвучки | HF-9 |
| HF-3 | своё приветствие без генерации: группа-объединение `{generationRef,…}` или `{kind: 'manual', textFingerprint}` (хранится `generation_ref = 'manual:' + sha256`, без миграции); допуски — матрица `(платформа, purpose, действие)` архитектуры §11.1: на Fansly `claim`/`renew`/`dispatch` под `newcomers` **без** `previewSend`, `purpose` только `greeting`, чтение статуса разрешено, `registerNativeSend` разрешён, `preview-reply` → 409; завершение начатой попытки — при выключенном флаге; лимит приветствий по назначению (`greeting` ≥ 30 в минуту; у старого пик 29, p99 21) с объявлением в bootstrap; доказательство отказа HTTP (решение — по данным пилота, до тех пор `uncertain`); возможность `manual-greeting-v1` | `routes-client.ts:938-1015`, `services/client-claim.ts:52-69, 198-212`, `packages/db/src/repositories/client-claim-transition.ts:12-16, 311-349`, `services/client-limits.ts` | своё приветствие без единого AI-запроса через настоящую схему SDK; новые схемы и переходы, Fansly до HF-2 по-прежнему отказан проверкой платформы (`client-features.ts:146-157`); два клиента — один POST; неопределённая попытка после перезапуска; `preview-reply` на Fansly → 409; id Fansly 18–19 цифр; OnlyFans без изменений | Fansly, `manual-greeting-v1`; до HF-2 — `platform_unsupported` | — |
| HF-6 | глубина 5000 одной настройкой на обе платформы: значение `5000` в перечне `aiTranscriptDeepMaxRows` (сейчас `1500`, `3000`) и текст цены; Fansly в `mayReadDeepTranscript` (с `context-v1`); глубина `fan-notes-fill` — явным правилом, не меньше 3000, как у старого (сейчас глубоко читает только полный `fan-summary`, `ai-transcript-depth.ts:75`); паритет в день перехода — настройка на проде уже 3000 (X37; старое шлёт свою историю до 3000); путь `live_union` передаёт `maxRows`; тело `messageCount ≤ 5000`; выбор и текст в дашборде для обеих платформ. Условие X34: представительный контекст из 5000 сообщений вместе с системной частью и запасом на ответ помещается в окно фактической модели Recap (подсчёт токенов), цена названа по её тарифу | `services/ai-transcript-depth.ts`, `packages/db/src/repositories/ai-transcript-depth.ts`, `context/index.ts:175-196`, `routes.ts:2317`, `packages/shared/src/config-registry.ts:307` | 5000 при поднятой настройке; 1500 без неё; фактически прочитанное число в `context_v1`; старый Fansly-путь `clientContext` (до 3000 от клиента) без изменений; EXPLAIN чтения 5000; `limits.deepMax` в bootstrap | настройка (на проде 3000 с 2026-10-13 — переопределение, X37) и `context-v1` | — |
| HF-7д0 | данные для пометок автоматики: `type`, `correlationId` с признаком присутствия — в материальную голову архива (`canonicalize/sync-pull.ts:906-936` их не сохраняет) и до `ArchiveMessageRow` (`message-archive.ts:1455-1488`); миграция вперёд, если нужна; старые строки — «неизвестно» или ограниченный replay сохранённых наблюдений. Живой слой их уже хранит (`schema.ts:2051-2052`, `sync/live-messages.ts:349-371`) | `canonicalize/sync-pull.ts`, `packages/db/src/repositories/message-archive.ts`, миграция | карта «кто пишет → хранение → проекция → чтение → классификатор»; archive-only, live-only, смешанный | только данные | — |
| HF-7а | медиа в транскрипте Fansly: `media_metadata` архива (только Fansly), MIME → фото/видео/аудио, наборы | `packages/db/src/repositories/message-archive.ts:1472-1489`, `context/index.ts:96-110` | эталон AI-147; байты OnlyFans те же | Fansly, ядро без `clientContext` | HF-8а |
| HF-7б | профиль фана Fansly: имя по правилу старого (`username ‖ displayName`), сохранённое имя из `page_alias` (источник есть, не подключён, `features/index.ts:717-718`), username из `fans`, био — сохранять при гидрации; аватар — не из хаба (клиент берёт его из данных страницы, X37) | `features/index.ts:697-722, 921, 1091`, `sync/fansly/lib/fan-hydration.ts` | эталоны AI-034, AI-146, SP-040; замер на проде (только чтение): через сколько правка заметки 12002 доходит до `page_alias` — старое читало имя при каждой генерации (`parity-matrix.md` §6 п. 3) | Fansly, ядро без `clientContext` | HF-8а |
| HF-7в | PPV в транскрипте: «куплено» из `media_orders`; «не куплено» — только при завершённом обходе заказов, иначе «неизвестно» | загрузчики транскрипта Fansly | эталон AI-144 | Fansly, ядро без `clientContext` | HF-8а |
| HF-7г | траты и подписка без `clientContext`: сверка формата с эталоном старого, включая помесячные траты глубоких функций и метки `[Tip: $X]` в транскрипте; подписка ушедших подписчиков | `context/index.ts:334-373`, загрузчики денег | эталон AI-145 | Fansly, ядро без `clientContext` | HF-8а |
| HF-7д | пометки автоматики `[Automatic / mass message]` по карте HF-7д0 (архив и `live_union`); неизвестный признак — не автоматика, сообщения фана — личные; `transcriptCoverage` из цепочки для рекапов; эталон — через настоящий canonicalizer и чтение из БД | `features/index.ts`, `context/*` | эталоны AI-033, AI-037 (сегмент Ping и дни молчания хаб считает сам — `computePingSummary`, `features/index.ts:705-720`), AI-148 | Fansly, ядро без `clientContext` | HF-8а, HF-7д0 |
| HF-4б | войсы в узком токене (`voiceNoteCreate/Status/Audio`), флаг `voice`, возможность `voice-notes-v1`, доступность в bootstrap (флаг + состояние линии войсов), `voice-script` → флаг `voice` | `client-token-scopes.ts:26-60`, `client-ai-switch.ts:29-33`, `routes.ts:6620-6690`, `services/client-capabilities.ts` | узкий токен проходит три маршрута; страница без войсов — недоступно | флаг выключен | HF-4а |
| HF-10 | ключи чтений по разговору (архитектура §11.1): рекап и лента — `conversationRef` + `fanRef` (проверенная пара); сохранение досье из генерации проверяет принадлежность паре; возможность `conversation-recaps-v1` | `services/client-recaps.ts:99-112`, `services/client-profile-from-generation.ts:113-120, 140, 167`, `services/conversation-feed.ts:505`, `services/client-claim.ts:219-224` | рекап старого (`conversation_ref = groupId`) виден новому; досье Fansly с разными ссылками сохраняется; два чата и два фана с разными id | возможность `conversation-recaps-v1` | HF-9 |
| HF-12 | узкий токен: Reply, Fix, Hi, Ping на Fansly — под новым флагом `drafts`; `voice-script` → `voice`; `fan-notes-fill` → `notesFill`; OnlyFans без изменений (мастер-выключатель и версия); схема флага, серверная проверка и строки пилота — раздельно | `client-ai-switch.ts:29-66`, реестр флагов | Fansly без флага → 409 `flag_off`, с флагом — проходит, отзыв посреди попытки — завершение проходит; полный токен (старое, десктоп) без изменений; строки `lora-of`, `lora-vip-of` без изменений | Fansly, узкий токен | — |
| HF-2 | Fansly в `CLIENT_FEATURE_REQUIREMENTS` по платформам (`newcomers` на Fansly — без `audience-new-v1`, с `manual-greeting-v1`); флаги Fansly `drafts`, `voice`, `notes`, `notesFill`, `vault`, `registration`; строку `"*"` Fansly не наследует | `client-features.ts:36-59, 146-155` | страница Fansly без строки — `flag_off`, со строкой — доступна; полный сценарий опеки приветствия на Fansly — claim → dispatch → sent при `previewSend = false` — через штатный допуск; OnlyFans байт в байт | Fansly читает `flag_off`, пока владелец не поставит строки | HF-3, HF-4б, HF-12 |
| HF-13 | метрики Fansly в реестре `client_health` (только дополнение): `frameParseMs`, `xhrParseMs`, `snapshotMs`, `snapshotRoundTripMs` — единицы, границы корзин (различают 0,1 / 2 / 5 мс и превышения), размерность хоста | `packages/contracts/src/routes-client.ts:1840-1850, 1889-1915, 1923-1952` | новый histogram принят настоящим приёмом и сохранён; старый `client_health` валиден | новые имена; до пилота | — |

**P2v. SDK и выкладка** (chat-extension): «SDK для тестов» — после каждой схемы; «SDK для выпуска» — после выкладки
согласованного серверного этапа; `contract-change:` с перевендоренным SDK, поддельный хаб по новым правилам, строка в
`docs/contracts-changelog.md`; регистрация SDK расширения в реестре замороженных SDK хаба (`register-client-sdk.mjs`;
строки расширения там нет). Рост фона от SDK — строка реестра байтов (§4). Готово: e2e на поддельном хабе зелёные; в
пилоте — `live.status = served`, `rejected = 0`, ответ по каждому id. «SDK для выпуска» из `bd3eec06` (прод с
2026-10-14 00:55 UTC, контракт `9137410d…`) вендорен (журнал контрактов, 1.15.0, «P2v»). Регистрация не сделана: хаб
пускает строку `chat-extension` в реестр только вместе с её полосой в наборе совместимости
(`tests/helpers/client-sdk-compat.ts`: узкий токен, тела запросов расширения) — нужен отдельный PR хаба. HF-1 (личность страниц) проверен чтением прода — кода
нет. HF-11 (клавиша заметок) не нужен: на Fansly клиент схемы клавиш — `fansly` (P7i).

### Этап 3. Спайк, подписанные сборки, база старого

| PR | Что | Итог | Зависит от |
|---|---|---|---|
| P3a ✓ | спайк на стенде (архитектура §15.2 п. 1–7): (1) ленивые чанки фона — `import()` из классического event page или `background.type: "module"` с WXT; (2) регистрация изолированного скрипта рядом с MAIN, порядок, `persistAcrossSessions`, обновление, WAR Fansly без выданных прав, `executeScript` баннера в открытые вкладки; (3) предикат жеста на geckodriver: доверенные клик и Enter, «проглоченная» отправка, поздний XHR из таймера и `MessageChannel`, микрозадачи между слушателями, смена маршрута, два быстрых жеста, `ack` рядом с POST, отправка с медиа; порядок квитанции и эха; (4) прототип полного MAIN: размер gzip, стоимость разбора кадра и ответа 115 КБ, калибровка учёта памяти; (5) запросы скрипта другого расширения в `webRequest`, `onCompleted` для чужого 429; (6) `navigation.currententrychange` в изолированном мире; (7) ответы `POST /vault/albums/media`, `POST /group/<id>/` (по коду бандла) | `docs/project-unite/spike.md`; правки архитектуры | 0 |
| P3b | подписанные тестовые сборки: обновление N → N+1 с опциональными хостами и `webRequest` — без задержки и без выдачи; контрольная сборка с хостами в манифесте; «Включить Fansly» — один запрос из popup и настроек, `onAdded` при закрытом popup, `onRemoved` → снятие регистраций; цепочки пробуждения фона (архитектура §8.2): выдача → перезагрузка → захват, сон → запрос → пробуждение → захват, старт с правами, отзыв и повторная выдача; `browser.webRequest` после выдачи; баннер после обновления; разрыв «установка → регистрация» при настоящем обновлении; `persistAcrossSessions` после перезапуска браузера; `manifest_version` сборки FBuddy для Firefox у чаттеров (`spike.md`, «Что должен проверить P3b», п. 6–7 — в P16c). Ворота выпуска (P16c), а не каждого PR | **Выполнен 2026-10-16:** набор 0.2.4.4147831 из `main` aa6df43e, все четыре XPI подписаны на AMO; `tools/ci/e2e-docker-local-p3b.sh` на подписанных сборках — **14 прошли, 0 упавших, 0 пропущенных (20,4 с)**. Пункты 1–5 закрыты, включая исправленный в #111 баннер при выдаче со спящим фоном; п. 6–7 остаются проверками первого дня пилота P16c. Версии и соответствие названиям тестов — [spike.md](spike.md#подписанный-прогон-2026-10-16); отметка — `done/P3b` | P3a |
| P3d ✓ | база старого на стенде Fansly: тестовая сборка старого (2.10.x или выпуск на день перехода) с адресами стенда (подмена при сборке, без правок `fansly-chat`), сценарий §11 архитектуры ChatSpace (открыть, 20 переключений, набор, час простоя), звуки включены, заметки «Справа по кнопке» и «Всегда справа», сосед выключен и включён; Firefox Profiler и `about:memory` в том же headless Firefox, где мерится новое | `docs/project-unite/baseline.md`: таблица метрик §4 для старого; правило — новое не хуже базы и в бюджете, иначе PR не сливается; если норма +15 МБ вкладки недостижима, она меняется до этапа 7 | P6a, P6b, P6d; до P7a |

### Этап F. Общее под два сайта

Каждый PR держит e2e ChatSpace зелёными и называет дельту по реестру байтов (§4).

| PR | Что | Файлы | Готово, когда | Зависит от |
|---|---|---|---|---|
| F1 ✓ | фон: вторая сборка `bg/*`, загрузка `import(runtime.getURL(…))` из классического event page (P3a: модульный фон отвергнут — WXT сливает его со страницами; повторный старт чанка в том же реалме — по новому адресу, ошибка исполнения кэшируется); контракт `BackgroundHostModule` / `BackgroundKit` (архитектура §3.3); **измеримое освобождение ядра**: службы только ChatSpace (опека и журнал X8, «Новые» ChatSpace) — в `bg/chatspace.js`; регистрация ручных отправок и её журнал остаются в ядре (нужны обоим сайтам), чанкам — порт `nativeSends`; строки бюджета «ядро фона» и «`bg/<сайт>`», `archive-check` по файлам; гейт графа ядра | `apps/extension/bg/vite.config.ts` (новый), `apps/extension/src/composition/background.ts`, `tools/size-budget`, `tools/archive-check/rules.ts`, `.dependency-cruiser.cjs` | запас ядра до сигнального порога записан числом в реестр байтов (замер в PR), каждый P2v и P9a сверяется с ним; сигнальный порог 800 КиБ не поднят; проба на настоящем `BackgroundKit` (не пустой чанк): старт, ошибка импорта, повторный старт; восстановление журнала X8 после пробуждения; e2e ChatSpace зелёные | P3a(1) |
| F2 ✓ | реестр хостов `apps/extension/src/hosts/{index,chatspace}.ts` вместо `hosts.ts`; из него — манифест и его проверка, входы WXT, хосты RPC и звука, онбординг, гейты (`MAIN_WORLD_*`, `ISOLATED_BUNDLE`), строки бюджетов, `archive-check`, `host-contract-check --host`; рантайм-таблица без полей сборки; `TestHostConfig` | `apps/extension/src/hosts/*`, `build/manifest.ts`, `wxt.config.ts`, `composition/{background,pages}.ts`, `tools/{gates,size-budget,archive-check,host-contract-check}` | собранный манифест ChatSpace байт в байт прежний; гейты прежние; поля сборки не в бандлах | 0 |
| F2b ✓ | сборки ленивых чанков по сайтам: `lazy/chatspace/*` — сегодняшний план (`LAZY_LAYERS`, `lazy/vite.config.ts:97-135`) из реестра хостов, WAR по сайту; пустая сборка второго сайта в тестовой сборке; пробы контрактов (`tools/size-budget/contracts-probes.ts`) по сайтам | `apps/extension/lazy/*`, `apps/extension/src/hosts/*`, `tools/size-budget/*` | чанки ChatSpace байт в байт прежние (кроме пути); фиктивный вход второго сайта, его ошибка и схема не меняют ни байта ChatSpace; цена дублей в XPI записана | F2 |
| F3 ✓ | адаптер хоста: `composeTab(env, adapter)`; тип `HostAdapter` в `apps/extension/src/composition/tab/adapter.ts`; `tab/{runtime,keys,app,controllers,host-facts,action-gate,surfaces}.ts` — на общем `HostPort` и адаптере; адаптер ChatSpace (`start`, `keyProbe`, `routeOfLocation`, `configure` = `liveConfigOf`, план ленивых чанков); замер общей части раннего изолированного бандла — число бюджета `fansly.js` | `apps/extension/src/composition/tab*`, `apps/extension/src/entrypoints/chatspace.content.ts`, `packages/host-chatspace/src/isolated/starter.ts` (новый; адаптер собирается во входе — типу `HostAdapter` нужен `TabEnv` приложения) | `chatspace.js` в пределе (дельта и источник названы); e2e ChatSpace зелёные | F2 |
| F4 ✓ | манифест фич и допуск (архитектура §1.4): `contracts/src/features/{types,common,chatspace,fansly}.ts` — общее и по файлу на сайт, срез графом модулей; `core/src/domain/features/admission.ts` — `base` и требования действий (`generate`/`insert`/`send`), всё внутри — AND; `CLIENT_FLAG_REQUIREMENTS` оставляет только нужды транспорта клиента (`context-v1` у `freshText`), они переходят в `clientNeeds`; `FEATURE_FLAGS` уходит; строковые объединения `DockChipGroup`, `DockIconId`, `HotkeyActionId` в контрактах; док — `DockVM.chips` данными (`actions` остаётся), `Strip` по группам и приоритетам; справочник клавиш, popup и токены действий читают `admission`; полные записи `reply`, `newcomers`, `preview-send`, `voice`, `notes-fill` для обоих сайтов | `packages/contracts/src/features/*`, `packages/contracts/src/hub/routes.ts`, `packages/core/src/domain/{features/admission,ops/flags,ops/environment}.ts`, `packages/ui/src/dock/{Strip,styles}.tsx`, `contracts/src/vm/dock.ts`, тесты полноты в `ui/kit` и `core/src/domain/hotkeys` | вид дока ChatSpace прежний (снимки галереи); таблица флагов ChatSpace на нынешнем хабе до и после — та же; отрицательные фикстуры: выключенный `insertion` не закрывает генерацию, отправка из превью ChatSpace требует `previewSend` и `newcomers`; новая запись только в `features/fansly.ts` не меняет ни байта ChatSpace; первый чанк дока в пределе | F3 |
| F5 ✓ | профиль сайта: `HostUiProfile` (палитра `ValueSignal`, вариант, `sheet`, `phrases`), профиль ChatSpace (палитра — текущие `--color-om-*`, вариант `chatspace`, keep-bottom 100, клиент клавиш `extension`); `core/src/domain/hotkeys/resolver.ts:50` читает `profile.hotkeyClient`; `mountKitSurface` ставит палитру и `data-dock-variant` на хост; галерея с параметром `host`. Как построено (архитектура §1.3, §1.5): профиль — в половине приложения адаптера (`HostAppAdapter.ui`), клиент клавиш — в ранней (`HostAdapter.hotkeyClient`); палитра ChatSpace — его переменные по наследованию (в профиле её нет), keep-bottom и слои — параметры старта хоста (P5, P7d), не профиля | `contracts/src/vm/host-profile.ts`, `packages/ui/src/kit/{tokens,mount}.tsx`, `packages/testing/src/*/gallery` | снимки галереи ChatSpace прежние | F3 |
| F6a ✓ | сайт и разговор в общем коде, без смены смысла чтений: шесть литералов `host: 'chatspace'` → `binding.host`; `conversationRef` из маршрута — в `workspace.ts:482`, превью, тосте, `ChatNavigator.open`, `NavigationIntent.target`, `RequestIdentity`; мёртвый `hub/src/ai-request.ts` с `HubFacade.buildStreamRequest` удалён; MAIN ChatSpace принимает только `'chatspace'` | `core/src/application/{ai/workspace,preview/controller,newcomers/controller,spenders/controller,boards/navigate}.ts`, `core/src/services/scheduler.ts:1173`, `core/src/domain/ops/identity.ts`, `packages/hub/src/{facade,ai-request}.ts`, `host-chatspace/src/main/requests.ts` | юнит-тесты с `groupId ≠ fanId` для каждой поверхности; освобождённые байты фона и MAIN названы; e2e ChatSpace зелёные | P4a1, F3 |
| F6b ✓ | чтения по разговору по таблице архитектуры §11.1 (`contract-change:`): рекап и лента — `conversationRef` + `fanRef`, карточка, цель досье, бронь и опека — `fanRef`; новые поля — только при `conversation-recaps-v1` | `apps/extension/src/composition/background/hub-data.ts:55-57`, `packages/hub/src/facade.ts:664`, лента | два чата и два фана с разными id; без возможности — прежние запросы | F6a; схема HF-10 и «SDK для тестов» |
| F7 ✓ | телеметрия и отчёт контракта по сайтам (`contract-change:`): имена метрик HF-13 в `contracts/src/telemetry.ts`; `HealthWindow` на (хост, сборка), хост в id отчёта (`facade.ts:838`), «вкладка этого хоста открыта» вместо `chatSpaceOpen`; `HostContractReport` с разбором по `host` (нет `host` или `'chatspace'` → прежняя полная схема); `contractFactsOf` (`host-facts.ts:84-100`) и «Статус» читают ожидаемый набор якорей сайта | `core/src/domain/telemetry/health.ts`, `core/src/services/telemetry/health.ts`, `packages/hub/src/facade.ts`, `contracts/src/host.ts`, `apps/extension/src/composition/tab/host-facts.ts`, `core/src/application/pages/{view-status,view-popup}.ts`, `contracts/src/vm/pages.ts` | на двух тестовых адаптерах: два отчёта окна, хаб принимает оба; отрицательные фикстуры ChatSpace (без одного и без всех якорей) — отказ; прежний отчёт без `host` принят; согласие выключено — только локально | F3, P4a1; схема HF-13 |
| F8 ✓ | копии текста: `StartMemo.start` убран (читалось только `split`); «Ещё раз» и Fix берут `memo.split` и `memo.fixSource` | `core/src/application/ai/op-store.ts` | тест: после конца операции и при живой записи результата хвоста нет нигде во вкладке; освобождённые байты слоя `ai` названы | — |
| F9a ✓ | ранние гейты: литералы сайтов по AST и по смыслу (`core/src/**`, `ui/src/**`, `hub/src/**`) со списком долга архитектуры §1.9; граф пакетов (`host-kit`, `host-*`, `fansly-api`, relay, `bg/*`, ядро фона) с отрицательными фикстурами; байты по сайтам (архитектура §1.8): сравнение артефактов ChatSpace в каждом PR, файлы Fansly по принадлежности, в бандлах ChatSpace нет данных `fansly-web`; поля сборки не в рантайме | `tools/gates/{sites,change,pin-bytes}.ts`, `tools/gates/site-paths.cjs`, `tools/gates/chatspace-bytes.json`, `.dependency-cruiser.cjs`, `tests/lint-boundaries.test.ts` | гейты зелёные на `main`; каждый пункт долга назван со своим PR; отрицательная фикстура на каждый вид пути Fansly (`features/fansly.ts`, `*-fansly.ts`, `lazy/fansly/**`, `bg/fansly.ts`, пакеты) | F1, F2b, F3 |
| F9b ✓ | финальные гейты: список долга литералов пуст (`SITE_LITERAL_DEBT`, архитектура §1.9; смысл чтений по разговору — тесты F6b, не гейт); имена сайтов в общих текстах запрещены, ≈ 47 текстов — фразы профиля; полнота манифеста; пакеты текстов по сайтам | `tools/gates/sites.ts`, `apps/extension/lazy/entries/*`, `packages/core/src/domain/i18n/*` | гейты без исключений; каталог `ru` ChatSpace в пределе | F4, F5, F6a, F7, F9a |
| F10 ✓ | порты политики AI (`AiHostPolicy`): доказательство, предпроверка, поля запроса сайта, вердикт и его отпечаток; общий контроллер зовёт порты, общий `Result` получает готовую модель пометки; реализация ChatSpace — нынешнее поведение | `core/src/application/ai/*`, `contracts/src/ops.ts` (типы портов), `apps/extension/src/composition/tab/adapter.ts` | слой `ai` ChatSpace в пределе (байты из F8 названы); поведение ChatSpace прежнее | F3, F8 |

### Этап 4. Контракты 1.15.0

Все — `contract-change:` с фикстурами, строкой в `docs/contracts-changelog.md` и правкой `docs/protocols/`; старые фикстуры
ChatSpace проходят без изменений, кроме мест из архитектуры §12.

| PR | Что | Файлы | Зависит от |
|---|---|---|---|
| P4a1 ✓ | сайт и маршрут: `contracts/src/hosts.ts` (`HOST_PLATFORM`, `HOST_KINDS`), пара хост↔платформа в `TargetSchema` из таблицы; `RouteState.conversationRef?`, `conversationKind?`; `NavigationIntent.target.conversationRef?` | `contracts/src/{hosts,ids,host}.ts` | 0 |
| P4a2 ✓ | мост Fansly: `bridge-fansly.ts` (типы, неотбрасываемые, записи), `bridge-messages-fansly.ts` (схемы, `fx.batch`, `fx.gap`); `fansly.ts` — `FanslySnapshot`, `StartProofV1` (`startWitnessId` по источнику, `automatedIds` ≤ 120), `FanslyPagePort`, `FanslyAnchorId`, `FanslyCapability` | `contracts/src/{bridge-fansly,bridge-messages-fansly,fansly}.ts` | P3a |
| P4a3 ✓ | протокол вкладки и страницы: `TypeSchema` — до двух точек; `RequestSpec.hosts?` и `mayRequest` с хостом; вид отправителя `relay` и порт `cg-relay`; `tab-messages-fansly.ts` (`fansly.followers.*`, `fansly.voice.*`, `fansly.vault.*`, `fansly.notes.*`, `fansly.relay.*`); ключ `settings.ext` (архитектура §12) с приёмкой отката на настоящем владельце хранилища: новое → старое → смена темы → новое; `errors-fansly.ts` (`CG-FAN-*`, `CG-NOTE-*`, `CG-VOICE-*`, `CG-VAULT-*`, `CG-FNEW-*`, приложение А `docs/architecture.md`, оба каталога; номера списанных кодов старого — CG-API-02/03/04, CG-AUTH-01/02 — не переиспользуются, ER-083) | `contracts/src/{tab-protocol,tab-messages-fansly,settings,errors-fansly}.ts`, `core/src/services/settings-owner.ts`, `packages/platform/src/rpc-{common,background}.ts` | P3a, F2 |
| P4b1 ✓ | свежесть и запрос: `StartOp.proof?: CoverageProof` (снимок вкладки или доказательство прохода; хвост — внутри); `ServedContext.coverageCheck?`; причины `stale`; `RequestIdentity` + `conversationRef`, `proofDigest`; ветка `fansly-web` отчёта контракта с обязательным блоком; `HostPort.freshness?`, `HostPort.fansly?`; `ChatWindow.fanScript?`, `newestAt?`; возможность `coverage-check-v1` в `contracts/src/hub/wire.ts` | `contracts/src/{host,ops}.ts`, `contracts/src/hub/wire.ts`, `core/src/domain/ops/identity.ts` | P4a1, P4a2, F7; схема HF-8в |
| P4b2 ✓ | глубина: на проводе `window` и `messageCount` ≤ 5000 (недопустимые фикстуры — 5001), допуск по `limits.deepMax`, `windows.deep` в `settings.ext`; тест «3001 не уходит, пока `deepMax < 5000`» | `contracts/src/{limits,ops,settings,settings-ext}.ts`, `contracts/test/fixtures/{schemas,hub}.ts`, `core/src/domain/{features/plan,ops/request}.ts` | P4b1, P4a3; схема HF-6 |
| P4b3 ✓ | операции сайта и флаги: `voice-script`, `notes-fill` — операции среза Fansly (объединение типов, драйвер, схема результата); `HUB_AI_FEATURES` += `voice-script`, `fan-notes-fill`; флаги `drafts`, `voice`, `notes`, `notesFill`, `vault`, `registration` и возможности `voice-notes-v1`, `manual-greeting-v1` в `contracts/src/hub/wire.ts` и `contracts/src/hub/routes.ts` | `contracts/src/{features,ops}.ts`, `contracts/src/hub/{ai,wire,routes}.ts` | P4b1; схемы HF-4а, HF-4б, HF-12, HF-3, HF-2 |
| P4b4 ✓ | доказательство Hi: `StartProofV1`, `personalMessageCount` и `fanAvatarUrl` (FX-018) в теле под `hi-start-proof-v1`; новые поля в тесте предела тела; архитектура §11.2 и §12 дополнена в этом PR | `contracts/src/{ops,fansly,hi-start-proof}.ts`, `contracts/src/hub/{ai,wire}.ts` | P4b1; схема HF-5 |
| P4c ✓ | отправка по HTTP: `send-fansly.ts` — машина состояний (`ready … sent`, `refused`, `uncertain`), журнал `fansly.send.journal` (только id), запрос приветствия «Новых» (текст поля, его ревизия, `historyRevision`, вид допуска, действие человека, опека), ручная группа | `contracts/src/send-fansly.ts`, `contracts/src/hub/claim-body.ts` (типы тела хаба; `hub/newcomers.ts` не тронут — любая правка там сдвигает пробу реестра вкладки), `contracts/src/tab-messages-fansly.ts` (`fansly.followers.send`) | P4a3; схема HF-3 |

### Этап 5. `host-kit`

| PR | Что | Файлы | Готово, когда | Зависит от |
|---|---|---|---|---|
| P5 ✓ | **чистый перенос** общего из `host-chatspace` по архитектуре §1.1 и списку S1a §2.2: `main/{guard,check}`, общая часть `main/protocol` и `main/bridge` (загрузчик), `isolated/{shadow-registry,validation,keep-bottom}`, общая часть `isolated/wire`, `bridge-client` и `validate` с реестром по хосту, хосты и слои из `mount.ts`, проба клавиш из `keyboard.ts`, `sameReport`, `digest`/`normalize`. Протокол моста и склейка ChatSpace не меняются; пачки Fansly — в его эмиттере (P7a) | `packages/host-kit/src/{main,isolated,common}/*`, `eslint.config.ts`, `.dependency-cruiser.cjs`, `tests/lint-boundaries.test.ts`, корневой `tsconfig.json`, `main/protocol.test.ts`, `lazy/entries/bridge-validation.ts`, `tools/gates/checks.ts` (`MAIN_WORLD_SOURCE`) | `chatspace-main.js`, `chatspace-ws.js`, `chatspace.js` — в пределах, дельта названа; поведение ChatSpace прежнее; e2e ChatSpace зелёные | F3, P4a2, F9a |

Сразу (X34): без окна без выпусков и без временной копии.

### Этап 6. Стенд Fansly

| PR | Что | Файлы | Зависит от |
|---|---|---|---|
| P6a ✓ | страница стенда — наше Angular-подобное приложение по структуре живого DOM (архитектура §13, S2 Q5–Q9): маршрут с пересозданием контейнера, поля и блока контакта шапки при каждой смене чата; пересоздание поля (правила ЛС, запись голоса) и блока контакта (число участников) без смены адреса; галерея без смены адреса; `textarea` с моделью, кэш черновика через микрозадачу без событий, Enter по своему флагу Shift, отправка синхронно в обработчике, очистка микрозадачей; модалка загрузки и `app-account-media-create-template`; `body.modal-opened`; строка «печатает»; низ 1 px и 350 px, `scrollTop = 0`; виртуальный инбокс с `<a href="/messages/<id>">`; мини-чат со вторым полем; `bright-theme`; метки старого. Свой loopback-хост; `TestHostConfig` тестовой сборки с доказанной автоматической выдачей и отзывом прав | `packages/testing/fixture-fansly/*`, `fixture-fansly.vite.config.ts`, `packages/testing/src/stand-server.ts`, `apps/extension/src/hosts/fansly.ts` (тестовые адреса), `build/manifest.ts` | P4a1, F2 |
| P6b ✓ | поддельный Fansly: XHR-API (`ngsw-bypass`, `responseType: 'text'`, конверт, `/account/me`, `/messaging/groups` с `aggregationData`, `/group/<id>/`, `/message?groupId=` со свежим концом и `before`, `/messages?ids=`, `/message/unread`, `POST /message`, `/message/ack`, `/message/automated`, пути «Новых», заметки, vault, 429, `success:false`); сокет `{t, d}`: эпохи и пересоздание, `t:1`, пинг `"p"`, 5/1, 5/10 с каскадом `type 3`, 4/2, 5/22, 3/2, пакеты `t:10001`, повреждённые кадры; прокси для relay; журнал вызовов по происхождению — проверки «только FS-NET-1» и «ноль `/message/ack` от нас» на сервере | `packages/testing/src/fake-fansly/{api,socket,data,proxy,journal}.ts` | P4a2 |
| P6c1 ✓ | поддельный хаб для Fansly: страницы с 18-значными id, `groupId ≠ fanId`, флаги и требования по платформам (HF-2), правила HF-8 (окно, удалённые, ровно один ответ на id), HF-9 (пара); тела — по схеме вендоренного SDK | `packages/testing/src/fake-hub/{config,data,ai,ai-rules}.ts`, `scenarios/hub/world.ts` | P4b1; схемы HF-8в, HF-9, HF-2 |
| P6c2 ✓ | поддельный хаб: правила Hi (HF-5) — доказательство, порог, `history_unproven`; поведение без возможности; все случаи общей матрицы через SDK | `fake-hub/{ai-rules,ai,hub}.ts`, `fake-hub/hi-start-proof.test.ts` | P6c1, P4b4 |
| P6c3 ✓ | поддельный хаб: опека HF-3 — ручная группа, лимит, допуски Fansly без `previewSend`, `registerNativeSend`, `preview-reply` → 409 | `fake-hub/claims.ts` | P6c1, P4c |
| P6c4 | поддельный хаб: `voice-script` и `createVoiceNote` по HF-4а/б (пара, источник, флаг `voice`, возможность и линия), `fan-notes-fill`, глубина HF-6 (`limits.deepMax` 1500/3000/5000; окно сокращается до допуска, тело до 5000 принимается); `aiNameFan` метит по `conversationRef`. Флаг `drafts` (HF-12) уже в P6c1 | `fake-hub/{ai,ai-rules,voice,hub,command}.ts` | P6c1, P4b2, P4b3 |
| P6d ✓ | сосед (FBuddy) по S5 §6: режимы `off`, `after`, `before`, `reinject`, `legacy`, флаги `+guard`, `panel=desktop\|mobile\|off`, `generic`; хуки прототипа XHR и подмена `fetch`, постинг тел ответов в `window`, фильтр слов, узлы в шапке и поле, слой в `<body>`, стили `contain: size` и двухстрочное поле, запись заголовка раз в 10 с, клавиша перевода ⌘⇧L, заметка «FBuddy Notes», свои запросы с 429 | `packages/testing/src/fake-fansly/neighbor/*` | P6a |

### Этап 7. `host-fansly` и подключение сайта

Пакет `packages/host-fansly/src/{main,isolated,testing}`; входы `apps/extension/src/entrypoints/{fansly-main,fansly}.ts`;
запись `apps/extension/src/hosts/fansly.ts`; гейты MAIN — по реестру (F2).

| PR | Что | Файлы | Перенос из старого | Тесты PR | Зависит от |
|---|---|---|---|---|---|
| P7a0 ✓ | сайт на стенде: входы `fansly-main` и `fansly`, стартер изолированного мира и сборка адаптера во входе, запись реестра, ~~статическая регистрация только в тестовой сборке~~ — статической регистрации нет ни в одной сборке (Firefox выдал бы её адреса при установке, архитектура §4), на стенде скрипты регистрирует e2e тем же вызовом, что P9a, строки бюджета MAIN и раннего изолированного (число — по F3), сборка `lazy/fansly` | `apps/extension/src/entrypoints/{fansly-main,fansly}.ts`, `apps/extension/src/hosts/fansly.ts`, `packages/host-fansly/src/isolated/starter.ts`, `tools/size-budget` | — | e2e: оба скрипта стоят на стенде, ChatSpace байт в байт; сборка выпуска без статической регистрации | весь этап F, кроме F6b (F1, F2b, F3, F4, F5, F6a, F7, F8, F9b, F10); P5, P6a |
| P7a ✓ | MAIN: установка, захват натива (§5.1), Proxy `construct` над `WebSocket` и `XMLHttpRequest`, слушатели на экземплярах, разбор кадров (три уровня, `t:10001`, признак полноты, проекции), таблица ответов XHR, ограниченная очередь отложенного разбора; эмиттер `fx.batch` с кредитами (неподтверждённые пачки — в бюджете) и одним `fx.gap`; бюджет MAIN | `main/{index,ws-tap,xhr-tap,frame-parse,responses,emitter}.ts` | `src/content/page-socket-tap.ts`, `src/shared/fansly-ws-frame.ts` | SN-017…020, FS-WS-1…5; невидимость Proxy; рядом с соседом во всех режимах — у нас и у него те же кадры и ответы, фильтр слов соседа работает; заблокированный потребитель: удержанные пачки и память в пределе, одно `fx.gap`, без ложного `sent`; бюджет MAIN | P7a0, P6b, P6d, P3d |
| P7b | MAIN: наблюдение чатов (кольца компактной раскладкой — P3a: объект на запись 167 Б, потолок 300 × 120 так не влезает в 4 МиБ; LRU, единый учёт памяти), сертификаты и полнота (состояния архитектуры §5.6, эпоха сокета, `t:1`, перекрытие, порядок слияния), личность и группы (с URL аватара фана из ответов страницы — только строка URL, для Hi, FX-018; архитектура §5.7 дополняется в этом PR), снимок генерации с ограниченным сливом, `StartProofV1` вкладки, счёт личных | `main/{observation,certificate,memory,identity,snapshot,automation}.ts` | классификатор `src/shared/followers.ts:74-87` | FS-TAIL-3…7, FS-IDN-1, 3: запрос до `t:1` и старая страница не дают сертификата; первый сертификат при известных метаданных группы; восстановление после штатного перезапроса; перестановки ответа, `incoming`, удаления и каскада вокруг запроса дают одно и то же окно; удалённое граничное сообщение → `unknown`; ускоренный тест пределов памяти; снимок ≤ 5 мс при нескольких ответах по 115 КБ в очереди | P7a |
| P7c | изолированный мир: старт, адаптер Fansly, маршрут и поиск якорей (наблюдатель поиска → рабочие наблюдатели), `popstate`, `pageshow`, Navigation API при наличии; личность, `HostPort`, порт `freshness`; бюджет раннего бандла | `isolated/{start,adapter,route,anchors,identity,host-port,freshness}.ts` | — (опрос адреса старого не переносится) | FS-RTE-1…4, AU-033; счётчик «адрес без сигнала»; галерея; начальная привязка; бюджет раннего бандла | P7b, P4b1 |
| P7d | монтирование дока, оверлеи, тема и вариант дока, «только копировать», деградация; узкие наблюдатели поля и шапки | `isolated/{mount,theme,anchors}.ts` | `src/content/conversation-mount-controller.ts` (без наблюдения всего разговора) | FS-PLC-1…7, FS-CTR-2; низ 350 px; строка «печатает» поверх дока; узкая колонка (сосед `panel=desktop`); замена только поля, только блока контакта, всего контейнера — слушатели в одном экземпляре, записи в отцепленное поле нет; 200 смен чата — записи наблюдателей ограничены | P7c, F4, F5 |
| P7e | вставка и «Открыть и вставить»; запись вставки для связи с `fx.sent` | `isolated/{insert,navigate}.ts` | `src/content/textarea.ts`, навигация SP-036 | UI-021, SP-036, FS-INS-1…4: 200 переключений, ввод между снимком и записью, восстановленный черновик, IME-композиция, записи соседа до и после нашей | P7d |
| P7f | отправка человеком и `sent`: доверенный жест в MAIN, предикат `eventPhase` на `loadstart`, квитанция ровно `/api/v1/message`, эхо, `contentDigest`; связь с записью вставки | `main/send-gesture.ts`, `isolated/send-observe.ts` | — | FS-SEND-1, 2: юнит с микрозадачами между слушателями; e2e на geckodriver — клик и Enter; два кандидата → не атрибутировано; «проглоченная» соседом отправка — нет `sent`, следующая атрибутирована; отправка с медиа не атрибутирована; совпадение текста без жеста — нет `reportSent` | P7e |
| P7g | старое расширение и старая копия: распознавание и отступление, баннеры (`fansly-notice.js` из P9a), булевы FBuddy | `main/legacy.ts`, `isolated/legacy.ts` | маркеры `src/content/bootstrap.ts`, `page-socket-tap.ts` | NEW-12, FS-CO-1: старое до и после нашего MAIN; выключено без перезагрузки — баннер; после обновления — баннер, а не молча мёртвый док | P7c, P9a |
| P7h | проверка контракта против бандла: набор якорей Fansly, `contractFactsOf` по ожидаемому набору | `tools/host-contract-check/{check,anchors-fansly}.ts` | — | `--host fansly` на снимке 2026-10-12 — все якоря на месте; отчёт без блока или без якоря — не зелёный | P7d, P4b1 |
| P7i | подключение сайта для выпуска: регистрация входов через синхронизацию P9a, регистрация вкладки с хостом, профиль Fansly в общем resolver из F5 (клиент схемы `fansly`), ранний клавиатурный щуп Fansly (уступка при `body.modal-opened` и фокусе в `fb-*-ui`, Enter за страницей) | `apps/extension/src/hosts/fansly.ts`, `composition/tab/keys.ts` | — | FS-HK-1; Fansly, ChatSpace и обе вкладки сразу; модалка Fansly; окно соседа; ⌘⇧L — наш Split (X37) | P7c, P9a, P7f |

### Этап 8. Ядро и UI на Fansly

| PR | Что | Файлы | Тесты PR | Зависит от |
|---|---|---|---|---|
| P8a | `groupId` на каждой поверхности Fansly (FS-IDN-6): док, превью, тост, панель фана (рекап по `groupId`, досье по `fanRef`) | `core/src/application/{ai,preview,fanpanel}/*` (поверх F6a) | `suite-fansly-ids` (док, превью, тост, панель фана): `groupId ≠ id фана` | P7i, F6a |
| P8b1 | путь старта на Fansly через порты `AiHostPolicy`: снимок `freshness` вместо `readVisibleTail`, `StartOp.proof`, поля запроса (`coverageCheck` при возможности), `messageCount` ≥ окна проверки; код — в слое `ai-fansly` | `core/src/application/hosts/fansly/ai/*`, `apps/extension/lazy/fansly/ai-fansly.ts` | запрос несёт окно, известные id, удалённые, хвост; слой `ai` ChatSpace не меняется | P8a, P4b1, F10, P6c1 |
| P8b2 | вердикт — одна чистая функция таблицы §3.5 спецификации (приоритет условий, ровно один ответ на id, отдельная таблица удалённых, пустое окно только при полном доказательстве); пометка с «Ещё раз» (`StaleRow`); запрет отправки без свежего вердикта | `core/src/application/hosts/fansly/ai/verdict.ts`, `packages/ui/src/dock/Result.tsx` (готовая модель) | матрица фикстур, общая с HF-8в, включая пересечения условий | P8b1 |
| P8b3 | ключ запроса с отпечатком доказательства; повторно открытый результат — со своим вердиктом | `core/src/domain/ops/identity.ts`, `core/src/services/scheduler.ts` | `suite-fansly-tail` целиком (владелец спека) | P8b2 |
| P8c | AI-функции на Fansly: Hi со `StartProofV1` (клиент отказывает только при доказанных > 10 личных; без `hi-start-proof-v1` — «хаб пока не умеет») и аватаром фана из личности MAIN (`fanAvatarUrl`, FX-018), Ping (блок активного фана), Recap (глубина из `limits.deepMax`, до 5000), Review, Coach | `core/src/application/hosts/fansly/ai/*` (предпроверка через `AiHostPolicy`; общий `core/src/domain/features/gates.ts` не трогается) | `suite-fansly-ai` (новый, §3): AI-030…032, AI-035, AI-036, AI-050, AI-062, AI-070, AI-134, ER-034, FX-018, NEW-02; ST-137; три сценария архитектуры §5.8; Hi с 1 личным и 40 автоматическими при доказанном начале; хаб до HF-8в, между HF-8в и HF-5, после HF-5; клиентская часть AI-033, AI-034, AI-037 (эталоны — HF-7б, HF-7д) | P8b1, P4b2, P4b4, P6c2, P6c4, F6b |
| P8d | тема Fansly и вариант дока `fansly`: палитра из переменных страницы, лист варианта, обе темы | `packages/host-fansly/src/isolated/theme.ts`, `packages/ui/src/hosts/fansly/dock.css`, `docs/ui-design.md` (таблица соответствия) | снимки галереи `host=fansly` в обеих темах | P7d, F5 |
| P8e | параллельные генерации на Fansly | — (ядро общее) | `suite-fansly-ops`: три чата, четвёртая — отказ со списком, вставка только в свой чат | P8b3 |

### Этап 9. Права, `fansly-api`, relay, отправка, Spenders

| PR | Что | Файлы | Перенос из старого | Тесты PR | Зависит от |
|---|---|---|---|---|---|
| P9a ✓ | права и регистрация: «Включить Fansly» (один запрос по жесту, «включён» — в `settings.ext`), `onAdded`/`onRemoved`, синхронизация регистраций MAIN и ISOLATED на каждом старте фона (одним вызовом `[main, isolated]`, все изменения регистраций — по очереди, P3a); `fansly-notice.js` в открытые вкладки после install/update и выдачи, счёт «ждут перезагрузки»; слушатели `webRequest` (`onBeforeSendHeaders`, `onCompleted`) в ядре фона с двумя предикатами: шаблон сессии — только из запросов, похожих на запрос страницы, и только после их ответа 2xx (P3a: запрос соседа на MV3 от запроса страницы не отличить), статус 429 — от любого видимого запроса (страница, сосед, relay; с `tabId −1` и чужим `originUrl` — охлаждение на всех креаторов профиля); шаблон и факты 429 в памяти и `storage.session`; восстановление модуля по рукопожатию вкладки после первой выдачи | `packages/platform/src/{permissions,scripting,web-request}.ts`, `apps/extension/src/composition/background.ts` (ядро), `apps/extension/src/entrypoints/fansly-notice.ts` | `src/background/{session-capture,session-store}.ts` | BG-007, EX-004, AU-031, AU-032; FS-NET-2, FS-PERM-2, FS-IDN-4; шаблон переживает сон фона; отвергнутый запрос соседа из той же вкладки не переписывает шаблон; цепочки пробуждения на стенде | F1, F2, P4a3, P7a0, P6b, P6d |
| P9b | `fansly-api`: допуск FS-NET-1, конверт и ошибки, заголовки, `ngsw-bypass`; пейсер — правила E130–E135 данными, режим на вызов (архитектура §8.4), охлаждение от любого 429 (наш и `onCompleted`) с дедупликацией и восстановлением после пробуждения; чанк `bg/fansly` на `BackgroundHostModule`; гейты: `fetch` только в `hub`, `fansly-api` и входе relay; адреса ⊂ `https://apiv3.fansly.com/api/v1/`; строки `/message/ack` нет вне `packages/testing`; гейт очереди отправки не задевает `fansly-api` | `packages/fansly-api/src/{client,allowlist,errors,pacer/*}.ts`, `apps/extension/bg/fansly.ts`, `tools/gates/checks.ts` | `src/background/fansly-client.ts`, `src/background/fansly-pacer/*` | RB-023, NF-037; `success: false` при 200; чужой 429 закрывает наш следующий вызов и переживает пробуждение фона; `suite-fansly-network` | P9a, P7i, P3b |
| P9c | relay: ленивый кадр на пачку работы + 60 с, порт `cg-relay` и правила отправителя, маршрут до опеки | `apps/extension/src/entrypoints/fansly-relay/{index.html,main.ts}`, `packages/platform/src/rpc-relay.ts`, `packages/fansly-api/src/transport.ts` | `src/fansly-relay/index.ts`, `src/background/fansly-transport.ts` | FX-001, FS-NET-4: смена документа или аккаунта → отказ до опеки; запрос через прокси стенда | P9b, P4a3 |
| P9d | отправка приветствия по HTTP с опекой (архитектура §8.6): надёжная запись намерения, затем синхронная последняя сверка кортежа и срока билета и сразу `fetch`; кадр relay повторяет свою часть сверки перед своим `fetch`; таблица окон сбоя | `packages/core/src/services/hosts/fansly/send.ts`, `packages/hub/src/facade.ts` | `src/background/followers-service.ts:1012-1127` с проверками до них | NF-020…022, NF-035, RB-007; `suite-fansly-send`: задержанный ответ опеки; задержанная сама запись — смена истории или документа и истечение билета за эту паузу дают `refused` без POST; смена аккаунта, документа relay или истории в эту паузу; обрыв на каждой границе; потерянный ответ; эхо раньше квитанции; позднее эхо после перезапуска; два клиента; `200 {success:false}` → `uncertain` | P9c, P4c, P6c3 |
| P9e | Spenders на Fansly: `groupId` из строк Spenders хаба, кэша страницы, поиска в инбоксе или `POST /group`; имена из хаба; «Открыть и вставить» | `core/src/application/spenders/*`, `packages/fansly-api` | `src/background/spenders-service.ts:773-799`, `runtime-api.ts:1496-1539` | SP-037…041, FS-SPD-1, 2; `groupId ≠ id фана` для Spenders; SP-054 — отрицательная: в превью Spenders на Fansly «Отправить» нет; статистика Spenders (SP-044…049) для страниц Fansly — сверка чтением прода | P9b, P8a |

### Этап 10. «Новые» Fansly

| PR | Что | Файлы | Перенос из старого | Тесты PR | Зависит от |
|---|---|---|---|---|---|
| P10a | окно 1–720 ч, список, статусы, фильтр, поиск, страницы, карточка, превью до 750 сообщений, «Открыть в Fansly ↗» — чат в новой вкладке, окно «Новых» остаётся открытым, как у старого (NF-011), проверка запросов окна; общая `NewcomersVM` с источником Fansly через порт | `core/src/application/newcomers/*` (порт источника), `core/src/domain/hosts/fansly/newcomers/*`, `packages/ui/src/hosts/fansly/newcomers/*` | `src/content/followers/index.ts`, `src/shared/followers.ts` | NF-001…011, NF-025…027, FX-017 | P8a, P9b |
| P10b1 | проход Б17 в фоне, автоочередь, ручные действия, пауза, баннер охлаждения; изменения строк в окно по порту, без опроса; доказательство прохода: `coveredCount` — вся пройденная история, `personalCount` — личные среди последних 30 сообщений, как у старого (архитектура §5.8) | `core/src/services/hosts/fansly/newcomers.ts` | `src/background/followers-service.ts` (проход и очередь), `welcome-definitions.ts` | NF-030…033, NF-038, NF-039; FS-NEW-4 | P10a |
| P10b2 | «Нельзя написать» до запроса, «К обработке», исключение | `core/src/domain/hosts/fansly/newcomers/dm-permissions.ts` | `src/shared/fansly-dm-permissions.ts` | FX-003, FS-NEW-2 | P10b1 |
| P10b3 | журнал прохода в IndexedDB с ротацией | `core/src/services/hosts/fansly/newcomers.ts`, `packages/platform/src/idb.ts` (`openBoundedStore`) | журнал старого (`README.md:162-186`) | NF-029, FS-NEW-5; память фона | P10b1 |
| P10c | приветствие: доказательство прохода (FS-NEW-7, `StartProofV1` прохода), аватар фана из профиля, прочитанного проходом (`fanAvatarUrl`, FX-018), три допуска (FS-NEW-6), перепроверки перед опекой и после `POST /group`, отправка с опекой, «Открыть и вставить» с регистрацией ручной отправки (`registerNativeSend`), подсказка «AI ничего не отправляет автоматически» | `core/src/application/newcomers/*`, `core/src/services/hosts/fansly/send.ts`, `packages/ui/src/hosts/fansly/newcomers/*` | `src/content/followers/index.ts:389-416` | NF-012…019, NF-023, NF-024, NF-028, NF-034, NF-036; три допуска; хаб догнал — старый результат не уходит; ручная отправка карточки отмечает фана поприветствованным; `groupId ≠ id фана` в «Новых» | P10b2, P9d, P8c, P7f |
| P10d | `suite-fansly-newcomers` целиком | `packages/testing/e2e/specs/suite-fansly-newcomers.e2e.ts` | — | два клиента — один POST; история изменилась — отказ; своё приветствие без AI | P10c, P10b3 |

### Этапы 11–14

| PR | Что | Файлы | Перенос из старого | Тесты PR | Зависит от |
|---|---|---|---|---|---|
| P11a | «Регистрация»: контроллер слота шапки (идемпотентная вставка по наблюдателю маршрута и узкому наблюдателю шапки), дата из snowflake, одна попытка `GET /group/<id>`, дубль в панели фана | `host-fansly/isolated/header-slot.ts`, `core/src/domain/hosts/fansly/snowflake.ts`, `packages/ui/src/fanpanel/*` | `src/content/{fan-registration,header-row-slot}.ts`, `src/shared/fansly-id-time.ts` | FX-002, FS-REG-1…4; пересоздание блока контакта без смены адреса; рядом с соседом `panel=mobile` слот переживает его узлы | P7d, P9b |
| P11b | «Заметки»: кнопка со счётчиком в слоте после «Регистрации», ⌘⇧K (клиент схемы `fansly`), панель (три вида, имя для себя, заметки, «+ По шаблону», черновики по фану), заметка «FBuddy Notes» — чужая, только чтение | `packages/ui/src/hosts/fansly/notes/*`, `core/src/application/hosts/fansly/notes/*`, `packages/fansly-api/src/notes.ts` | `src/content/fan-notes/*`, `src/shared/fan-notes.ts`, заметки в `fansly-client.ts` | FX-004…FX-013, FS-NOTE-1…5, `suite-fansly-notes` | P11a |
| P11c | «✨ Заполнить из чата» — операция сайта `notes-fill` (`fan-notes-fill`) через общий допуск: только названия полей анкеты в хаб, глубина по HF-6, `conversationRef = groupId`, `fanRef`; «было → станет» | `core/src/application/hosts/fansly/notes/fill.ts`, `packages/ui/src/hosts/fansly/notes/*` | E159–E161 старого (`@ff30d00`) | FX-014…FX-016; в хаб не уходят значения полей; одновременно с Reply в том же чате — по общему допуску | P11b, P4b3, P6c4; SDK не старше `a3449f77` |
| P12a | `voice-script` — операция сайта через общий допуск: `groupId` и `fanRef` раздельно, без `clientContext` | `core/src/application/hosts/fansly/voice/*` | — | AI-111; скрипт при разных id; Reply, `voice-script` и `notes-fill` одновременно в одном и разных чатах, отмена, перезапуск фона | P8b1, P4b3, P6c4 |
| P12b1 | хранилище оплаченных попыток: опека в фоне, переживающая выгрузку event page, CAS по ревизии, RPC-подтверждения | `core/src/domain/hosts/fansly/voice/attempts.ts`, `core/src/services/hosts/fansly/voice-attempts.ts`, `packages/platform/src/storage.ts` | `src/background/voice-attempt-store.ts`, `src/content/voice/attempt-store.ts` | AI-113: потерянное подтверждение записи, перезапуск фона, конфликт версий; без двойной оплаты | P12a |
| P12b2 | поток войса: скрипт → варианты → оплата → статус → аудио (`fetchVoiceNoteAudio`); граница оплаты проверяет сохранённую попытку | `core/src/services/hosts/fansly/voice.ts` | `src/background/voice-service.ts` (в т. ч. `:995-1014`) | AI-112, AI-115, ER-075…078 | P12b1; HF-4б |
| P12b3 | панель войса, «Новый войс», «Скачать MP3» | `packages/ui/src/hosts/fansly/voice/*` | `src/content/voice/{voice-panel,attempt-controller,voice-studio}.ts` | AI-110; снимки обеих тем | P12b2 |
| P12c | прикрепление в поле этого чата: передача файла (два пути), модалка Fansly, подтверждение по `app-account-media-create-template` | `host-fansly/isolated/voice-attach.ts` | `src/content/voice/attach-adapter.ts`, `src/content/native-file-handoff.ts` | AI-114, `suite-fansly-voice` целиком; мини-чат не получает файла; модалка закрыта без вложения — «неизвестно» | P12b3, P7d |
| P13a | загрузчик vault: файл на `change`, подтверждение `fx.vaultAdded` (успешный `POST` ровно `/vault/albums/media`; тело ответа страница не читает — альбом из контрольной точки, P3a) и перезагрузка альбома, контрольные точки | `host-fansly/isolated/vault/*` | `src/content/vault/{upload-runner,vault-dom,checkpoint-store}.ts` | VA-004…006, AU-036 | P7d, P4a3 |
| P13b | панель vault; вход в неё на `/creator/vault` — одним кликом, как у старого; хранилище контрольных точек в фоне — обработчик `fansly.vault.{resume,checkpoint,clear}` в `bg/fansly` и связка с портом `VaultCheckpointStore` загрузчика P13a (решение координатора по ревью P13a) | `packages/ui/src/hosts/fansly/vault/*`, `apps/extension/bg/fansly.ts` | `src/content/vault/vault-panel.ts`, `src/content/vault/checkpoint-store.ts` | VA-001…003, `suite-fansly-vault` целиком; точка переживает перезагрузку вкладки и сон фона | P13a |
| P14a | звуки: факты пачкой, подписчики из сокета, фокус без права `tabs`, набор «своих», тоны Fansly | `core/src/services/sound/*`, `core/src/domain/sound/*` | `src/background/message-sound-service.ts` | FS-SND-1, 2, `suite-fansly-sound` | P7a, P7i |
| P14b1 | настройки: раздел сайта в `settings.ext` («Fansly через вкладку», звук подписчиков), шаги Fansly в «Как начать»; «Аккаунты» для моделей Fansly — список по регистрациям вкладок и сессиям, присутствие, подписи, персона по странице хаба, звук модели, «к вкладке» без права `tabs`, «Вкладки без атрибуции», сверка legacy ↔ canonical | `packages/ui/src/pages/*`, `core/src/application/pages/*` | `src/options/*` («Аккаунты», «Генерация → Служебное», «Вид»), `account-presence.ts`, `account-labels.ts` | ST-012, ST-067…079, AU-035; FS-SET-1 | P9a, P4a3, P7i |
| P14b2 | popup (строка на сайт, «N вкладок ждут перезагрузки»), «Статус» (строка на сайт, FBuddy, фильтр слов, «ждут перезагрузки», контракт по якорям, сборка `main.*`, режим запросов, пейсер и охлаждение, свежесть за сутки), отладка для Fansly | `packages/ui/src/pages/*`, `core/src/application/pages/*` | `src/popup/*`, `src/options/*` («Статус»), `src/debug-*` | PU-005, PU-008, ST-023, ST-025, ST-031, ST-032, LG-003, LG-016, LG-026, DB-009, DB-010, DB-015; FS-SET-2, FS-SET-3, FS-TAIL-9; смешанный профиль ChatSpace + Fansly: два отчёта окна, две строки «Статуса» | F7, P9a, P7i |
| P14c | «Включить Fansly», отзыв прав и выключение посреди отправки, платного войса, загрузки vault; баннер после обновления и перезагрузка вкладок из popup | `core/src/application/pages/*`, `packages/platform/src/permissions.ts` | — | FS-PERM-1…5, FS-IDN-4, `suite-fansly-perms` | P9a, P10c, P12c, P13b |

### Этап 16. Приёмка, выпуск и пилот

| PR | Что | Файлы | Зависит от |
|---|---|---|---|
| P16a | perf для Fansly: бюджеты §4 как гейт; профиль 10 вкладок Fansly с ChatSpace; 300+ чатов; несколько ответов по 115 КБ перед снимком; медленный потребитель моста; рост памяти после 100 переключений и 20 циклов оверлея; сосед выключен и включён; сравнение с базой P3d | `packages/testing/e2e/perf/fansly-perf-probe.e2e.ts`, `packages/testing/package.json`, `packages/testing/e2e/wdio.conf.ts` | 1–14 |
| P16b | долгий прогон: 8 ч событий 300+ чатов на стенде — задача агента с чек-листом, не CI | `docs/project-unite/long-run.md` | P16a |
| P16g | выпуск: имя и описание в манифесте («ChatGoose», «для ChatSpace и Fansly»), `BUILD.md` для Mozilla (опциональные адреса, `webRequest`), `CHANGELOG.md`, инструкция перехода (FS-CO-2), «О данных» при изменившемся поведении; сайт — через `pnpm release site` | `apps/extension/build/manifest.ts`, `BUILD.md`, `CHANGELOG.md`, `site/*` (генерируется) | P16a |
| P16c | пилот: все 6 страниц Fansly и все 11 чаттеров сразу (X37); флаги страниц (владелец); все чаттеры переводимых страниц в один день выключают старое, нажимают «Включить Fansly», ждут регистрации и перезагружают вкладки; согласие на телеметрию; инструкция: войсы и vault доделать в старом до перехода | `docs/project-unite/pilot.md` | все обязательные сюиты; P16b; P16g; P3b; «SDK для выпуска»; HF-13 выложен; HF-6 выложен (глубина 3000 уже стоит, X37) |
| P16d | наблюдение пилота вместо smoke: агент по чек-листу читает «Статус», `client_health` и журналы — хвосты и пометки, якоря, `sent`, приветствия, войсы, vault, ошибки, бюджеты против базы P3d; что видно только глазами — один вопрос владельцу | `docs/project-unite/pilot.md` | P16c |
| P16f | вкладка-хранитель присутствия и отчёты здоровья только при изменении (архитектура §10.3): после пилота; в пилотный артефакт — только с повторными смешанным профилем, perf, восстановлением и долгим прогоном на итоговой сборке | `apps/extension/src/composition/tab/runtime.ts` | P16a; P16d или повторная приёмка |

### Этап 17. После пилота

| PR | Что | Зависит от |
|---|---|---|
| P17 | навигация J/K, ⌘1–9, ⌘U и палитра на Fansly — из данных, которые страница уже получила; инбокс виртуальный, расширение его не листает | 16 |

## 3. Каталог e2e для Fansly

Каждый спек помечен сайтом (`fansly`); владелец стоит после P7a0.

| Спек | Владелец (последний PR цепочки) | Что проверяет | Требования |
|---|---|---|---|
| `suite-fansly-dock.e2e.ts` | P7d | монтирование, смена чата, пересоздание поля и шапки без смены адреса, галерея, деградации, мини-чат, поздняя установка, низ ленты, строка «печатает» | FS-DOCK-*, FS-PLC-*, FS-CTR-* |
| `suite-fansly-insert.e2e.ts` | P7e | 200 переключений, ввод между снимком и записью, восстановленный черновик, IME, Б2, «Открыть и вставить» | FS-INS-*, FS-RTE-* |
| `suite-fansly-send-observe.e2e.ts` | P7f | доверенные клик и Enter → `loadstart` во время доставки → квитанция → эхо; «проглоченная» отправка; медиа; два жеста | FS-SEND-1, 2 |
| `suite-fansly-host.e2e.ts` | P7i | Fansly, ChatSpace и обе вкладки; модалка Fansly; окно соседа; Enter за страницей | FS-HK-1 |
| `suite-fansly-neighbor.e2e.ts` | P7i (тап, док, вставка, отправка); P11a, P11b добавляют шапку | всё рядом с соседом во всех режимах; он видит те же кадры и ответы, его фильтр работает | FS-CO-4 |
| `suite-fansly-legacy.e2e.ts` | P7g | старое расширение на странице — новое отступает; баннер после обновления | FS-CO-1 |
| `suite-fansly-tail.e2e.ts` | P8b3 | хвост за 0,5 с, 11 сообщений, A→B→A, разрыв, `t:1`, bfcache, вытеснение, пакеты, сертификаты, порядок слияния, `lastMessage`, каскад удаления, удаление перед генерацией при отстающем хабе, окно Hi, кэш, копии, `fx.gap` | FS-TAIL-*, FS-WS-*, FS-PRIV-1 |
| `suite-fansly-ai.e2e.ts` | P8c | Hi: три сценария архитектуры §5.8, 40 автоматических при доказанном начале, аватар фана; Ping и блок активного фана; Recap до `limits.deepMax`; Review; Coach без текста страницы; отставание архива | FS-AI-1, FS-AI-2, FS-TAIL-10 |
| `suite-fansly-ids.e2e.ts` | P8a (док, превью, тост, панель фана); P9e — Spenders; P10c — «Новые» | `groupId ≠ id фана` | FS-IDN-6 |
| `suite-fansly-ops.e2e.ts` | P8e; P12a — операции сайта | параллельные генерации; Reply, `voice-script`, `notes-fill` вместе | FS-OPS-1 |
| `suite-fansly-send.e2e.ts` | P9d | матрица сбоев HTTP-отправки с опекой, последняя сверка | FS-SEND-*, FS-NEW-3 |
| `suite-fansly-relay.e2e.ts` | P9c | ленивый relay, маршрут до опеки, прокси, смена документа | FS-NET-4 |
| `suite-fansly-network.e2e.ts` | P9b | список FS-NET-1, ноль `ack`, ноль OnlyMonster — по журналу сервера; чужой 429 | FS-NET-1, FS-NET-3 |
| `suite-fansly-newcomers.e2e.ts` | P10d | окно, Б17, «Нельзя написать», три допуска, два клиента, ручная отправка карточки | FS-NEW-* |
| `suite-fansly-registration.e2e.ts` | P11a | «Регистрация» | FS-REG-* |
| `suite-fansly-notes.e2e.ts` | P11b, P11c | «Заметки»: виды, чтения, записи по действию, охлаждение, «FBuddy Notes»; «Заполнить из чата» | FS-NOTE-* |
| `suite-fansly-voice.e2e.ts` | P12c | скрипт, оплата, прикрепление через модалку | FS-VOI-* |
| `suite-fansly-vault.e2e.ts` | P13b | загрузка, контрольные точки | FS-VLT-* |
| `suite-fansly-sound.e2e.ts` | P14a | звуки, дедупликация, фокус | FS-SND-* |
| `suite-fansly-perms.e2e.ts` | P14c | «Включить Fansly», отзыв посреди операций, баннер после обновления, перезагрузка из popup | FS-PERM-*, FS-IDN-4 |
| `perf/fansly-perf-probe.e2e.ts` | P16a | бюджеты, 10 вкладок, рост памяти, сосед вкл/выкл | FS-PERF-* |

## 4. Бюджеты и реестр байтов

Стартовые значения — архитектура §3.1, §10.1; утверждены по базе P3d (`baseline.md`). Правило (решение владельца
2026-10-15): каждый предел ниже держится; вкладка — +≤ 15 МБ к базе, фон — ≤ 30 МБ, а не «не больше старого»; где это
чувствует чаттер — таймеры и пробуждения в простое, CPU, задержка ввода, — новое не хуже старого. Иначе PR не
сливается (или разбор с решением владельца). При превышении сначала меняется механизм, а не предел.

**Реестр байтов ChatSpace** — строки архитектуры §3.2 (MAIN, тап, ранний изолированный, слой `ai`, три пробы контрактов,
`tab-app`, первый чанк дока, каталог `ru`, `background.js` / ядро фона). Каждый PR с общим кодом пишет в «готово» дельту
по каждой строке и источник байтов. Известное заранее:

| PR | Строка | Тратит | Освобождает |
|---|---|---|---|
| F1 | фон | контракт модуля, загрузчик чанков, кит (в ядре) | службы только ChatSpace уходят в `bg/chatspace`: ядро 811 317 → 767 944 Б (−43 373), **запас ядра 51 256 Б**; `bg/chatspace.js` 91 633 Б (потолок 96 КиБ) |
| F3 | ранний изолированный (запас 566 Б по замеру `main`, не 704) | косвенность адаптера: +122 Б (запас 444 Б); `liveConfigOf` — в половине приложения (`tab-app`), не в раннем бандле | — |
| F4 | `tab-app`, первый чанк дока, `UiAction`, фон | срез манифеста (только `common` и `chatspace`), `admission`, чипы данными: `tab-app` +1 072 Б (запас 4 241), ядро фона +2 956 Б raw (запас 44 875); `UiAction` и остальные пробы — 0 | `FEATURE_FLAGS`; дубли `CLIENT_FLAG_REQUIREMENTS`: первый чанк дока −308 (запас 3 971), слой `ai` −50 (запас 883), `bg/chatspace.js` −1 031 raw, ранний изолированный −13 (запас 448) |
| F5 | первый чанк дока, `tab-app`, ранний изолированный | профиль на хосте (вариант, палитра, лист сайта): первый чанк дока +144 Б (запас 3 827); профиль ChatSpace в половине приложения: `tab-app` +76 (запас 4 010); клиент схемы клавиш из ранней половины: ранний изолированный +14 (запас 396); замер на `main` `9845f54` (после F7 и P5) и на ветке, одна за другой; MAIN, тап, фон, `bg/chatspace.js`, пробы контрактов, слои `ai` и `navigation`, каталоги — 0 | — |
| F6a | фон, MAIN, слои вкладки | `binding.host`, `conversationRef` (замер на `main` `6bba1c0`, после F4): фон +135 Б raw; gzip — слой `ai` +47 (запас 836), `navigation` +93, `tab-app` +27 (запас 4 214), проба реестра запросов +5, `tab-protocol` +5, `boards-preview` +66, `boards` +28 | мёртвый `hub/src/ai-request.ts`: фон −2 276 Б raw (итог −2 141, запас ядра 47 016 Б); второй вид хоста в `requests.ts`: MAIN −9 Б gzip (−26 raw) |
| F7 | фон, проба раннего контракта | окно на (хост, сборка), разбор отчёта по `host`, имена метрик HF-13 | — |
| F8 | слой `ai` | — | `StartMemo.start` |
| F10 | слой `ai`, `tab-app` | порты политики AI: вызовы портов в слое `ai`, политика ChatSpace `CHATSPACE_AI` — в `tab-app`; все пределы в силе (закрепы — `pnpm gates:bytes`, файлы — в PR) | правила Hi и Ping и `platform` гейта ушли из общего слоя `ai` в политику сайта |
| P5 | MAIN, тап, ранний изолированный | перенос в `host-kit` (замер на `main` `6a1c226`): MAIN +14 Б gzip (запас 66) и тап −2 (запас 39) — тот же код в другом порядке модулей; ранний изолированный +38 (запас 410) — два правила сайта в щупе клавиш, список несклеиваемых событий хоста у клиента моста, порядок модулей; остальные 60 из 63 файлов сборки — байт в байт | — |
| F9b | `tab-app`, каталоги, фон | замер на `main` `a4622c5` (после F6b) и на ветке, одна за другой: `tab-app` +107 Б gzip — фразы сайта в порту I18n, `switches` среза; после rebase на P4b1 (`c355aab`, только `pnpm gates:bytes`): ядро фона 785 677 → 786 446 Б, +769 raw (запас **32 754**), `tab-app` 26 790 (запас 3 930) — `switches`, таблица тонов сайтов, чтение `settings.ext` по схеме; MAIN, тап, ранний изолированный, первый чанк дока, слои `ai` и `navigation`, пробы контрактов, `bg/chatspace.js` и остальные чанки — 0 | каталог `ru` −15 Б gzip (запас 6 787), `en` −4: 71 имя сайта в каждом стало плейсхолдером |
| P2v | фон | рост SDK (замер на `main` `7d82f33`, после F7): SDK из `bd3eec06` — ядро 775 937 → 782 380 Б (+6 443 raw), **запас ядра 36 820 Б** (после F7 — 43 263); `bg/chatspace.js` и остальные файлы ChatSpace — 0 | — |
| F6b | фон, слой `ai`, проба реестра запросов, чанки досок и Coach | разговор в чтениях (замер на `main` `6732314`, после F5): фон +949 Б raw (схемы новых полей, проверка возможности, досье по `CHAT_IS_FAN`, проверка `target` ленты; **запас ядра 35 871 Б**); gzip — слой `ai` +74 (запас 711: ключ слота и запросы книги рекапов), проба реестра запросов +12 (запас 885), `tab-protocol` +20, `boards-preview` +63, `boards` +45 (панель фана), `ai-coach` +18; MAIN, тап, ранний изолированный, `tab-app`, первый чанк дока, каталог `ru`, `bg/chatspace.js` — 0 | — |
| P4b1 | `tab-protocol`, проба реестра запросов вкладки, фон, `ai`, `bridge-validation` | проверка окна в общих схемах (замер на `main` `a4622c5`, после F6b; сборка `main` и ветки одна за другой): слой `tab-protocol` +561 Б gzip (`StartOp.proof`, `ServedContext.coverageCheck`, причины `stale`; чанк +1 923 Б raw); проба реестра запросов +555 (28 342 / 28 672, **запас 330 Б**; из них ≈ 94 — тело и кадр `hub/ai.ts`, которых настоящий чанк не несёт); ядро фона +2 348 Б raw (запас ядра 33 523 Б); `bridge-validation` +32 (`COVERAGE_CHECK_LIMITS` в модуле пределов первого слоя); `ai` +61 (запас 650), `boards-preview` +23, `tab-health` +6, `ai-coach` +4 — новые хеши в именах импортируемых чанков (`ai` +1 Б raw); проба пределов +29; MAIN, тап, ранний изолированный, первый чанк дока, `bg/chatspace.js` — 0 | `tab-app` −24 (те же хеши) |
| P8b2 | первый чанк дока | готовая модель пометки в общем `Result`: слова по причине — +165 Б raw (41,36 КиБ из 45); слова причин проверки окна — в каталогах Fansly; каталоги, слой `ai`, `tab-app` и фон ChatSpace — 0 (новые хеши в именах чанков) | — |
| P8c | — | ничего: предпроверка Hi — в `ai-fansly`, общий `gates.ts` не меняется | — |

| Что меряем | Бюджет | Где и кем | Когда |
|---|---|---|---|
| MAIN (`fansly-main.js`) | ≤ 16 КиБ gzip; ≤ 1 мс на `document_start` | `tools/size-budget`, `bundle-timing` | P7a0 и далее каждый PR |
| ранний изолированный (`fansly.js`) | ≤ 30 КиБ gzip, из них общая часть 18 227 Б (замер F3, архитектура §3.1); ≤ 3 мс | `tools/size-budget` | P7a0 и далее |
| ChatSpace (реестр байтов) | пределы не растут | `tools/size-budget`, `archive-check`, гейт байтов по сайтам (`pnpm gates`: закрепы `tools/gates/chatspace-bytes.json`) | каждый PR этапа F, P5, P2v и любой общий |
| ядро фона, `bg/chatspace.js`, `bg/fansly.js` | ядро — сигнальный порог 800 КиБ, запас по замеру F1 — 51 256 Б (767 944 / 819 200); `bg/chatspace.js` ≤ 96 КиБ raw; чанк Fansly — ≤ 200 КиБ raw стартово | `tools/size-budget`, `archive-check` | F1 и далее |
| разбор кадра / ответа XHR | ≤ 0,1 мс в среднем / ≤ 2 мс на задачу | `frameParseMs`, `xhrParseMs` (HF-13) | P7a |
| отправок моста | ≤ 1 на вызов слушателя; печатание и квитанции — 0; очередь — предел, переполнение → `fx.gap` | счётчик | P7a |
| снимок генерации | шаг MAIN ≤ 5 мс; клик → готовый запрос — отдельно | `snapshotMs`, `snapshotRoundTripMs` (HF-13) | P7b, P8b1 |
| память наблюдения MAIN | ≤ 4 МиБ (тексты ≤ 2 МиБ), единый учёт | ускоренный тест (P7b), долгий прогон (P16b) | P7b, P16b |
| `routeToDockMs`, `insertMs` | p95 ≤ 50 мс winpc / ≤ 30 мс Mac; p95 ≤ 100 мс | perf-проба | P7d, P7e, P16a |
| первый чанк дока | ≤ 45 КиБ gzip в каждой сборке сайта | `tools/size-budget` | F4 и далее |
| ленивые чанки Fansly | ≤ 30 КиБ каждый; войсы при превышении — делить | `tools/size-budget` | P8b1, P10a, P11a, P11b, P12b3, P13b |
| фон | ≤ 30 МБ на профиль (бодрствует, пока Fansly активен) | `about:memory`, сценарий 10 вкладок | после P9d, P10b3, P12b2 и в P16a |
| вкладка | **+≤ 15 МБ** (FS-PERF-1): рост памяти процесса вкладки после GC, окно 10 минут, та же база, FBuddy включён; 25 МБ — аварийный порог пробы, не зелёный результат; рост ≤ 5 МБ за 100 переключений и 20 циклов оверлея | perf-проба | P16a |
| простой | наблюдение DOM и маршрута — без таймеров и опросов; keepalive 10 с, склейка присутствия, тайм-ауты relay учтены отдельно; p95 ввода ≤ база + 5 мс; сравнение с P3d; сосед вкл/выкл | Firefox Profiler на стенде | P16a |

## 5. Риски

| Риск | Чем закрываем |
|---|---|
| Вставка в чужой чат (P1) | FS-INS-1, якоря через маршрут, узкие наблюдатели поля, `suite-fansly-insert` |
| Тихая потеря хвоста | архитектура §5.6 (сертификаты, порядок слияния), исчерпывающий вердикт, HF-8, `suite-fansly-tail`, учёт долей по хосту |
| Неверный `groupId` в запросе | F6a, F6b, FS-IDN-6, HF-9 и HF-10 в хабе, `suite-fansly-ids` на каждой поверхности |
| ChatSpace утяжелится от общего рефакторинга | раздельные сборки по сайтам (F2b), срезы таблиц, реестр байтов, гейт байтов (F9a) |
| Фон упрётся в сигнальный порог | F1: измеримое освобождение ядра до первой службы Fansly; рост SDK — строка реестра |
| Hi на Fansly отказывает почти всем | доказательство от вкладки и прохода (архитектура А8, X37) |
| Атрибуция отправки теряется или ошибается | предикат «доставка жеста ещё идёт», проверка на geckodriver (P3a, P7f) |
| FBuddy «проглатывает» отправку | атрибуция только при `loadstart` во время доставки, `suite-fansly-send-observe` с `+guard` |
| Мы ломаем фильтр слов и журнал FBuddy | только `construct`-ловушки, без копий методов; e2e соседа проверяет его работу |
| 429 от запросов соседа | `onCompleted` в ядре фона, общее охлаждение на креатора (P9a, P9b) |
| Двойное приветствие в дни перехода | страницу переводят целиком (X34), пилот — все страницы Fansly сразу (X37); между чаттерами нового — опека хаба (HF-3), регистрация ручных отправок |
| Пилот отнимает инструменты на других страницах | все 6 страниц и 11 чаттеров переходят сразу (X37) |
| Потеря настроек Fansly при откате на старую сборку | отдельный ключ `settings.ext`, приёмка отката (P4a3) |
| Открытые вкладки после обновления молча без дока | баннер через `executeScript`, счёт в popup (P9a, P14c) |
| Войс не проходит хаб | HF-4а целиком до `createVoiceNote`, `suite-fansly-voice` |
| Двойная оплата войса | P12b1 (фоновая опека и CAS); при переходе войсы доделываются в старом |
| Новая сборка Fansly ломает якоря | контракт по ожидаемому набору, деградация по одной функции, `host-contract-check --host fansly` |
| Fansly переходит на `withFetch` | якоря ответов покажут; запасной наблюдатель `fetch` |
| Proxy заметны скриптам страницы | только `construct`, без правки прототипов; страница Fansly таких проверок не делает (S2 Q10) |
| Запрос через чужую сессию или прокси | relay привязан к вкладке и документу, прямого запасного пути нет; шаблон только из запросов страницы |
| AI беднее старого | HF-5…HF-7 по полям, HF-7д0 для данных автоматики, эталоны сформированного контекста; HF-10 для рекапов; аватар Hi (FX-018); свежесть сохранённого имени — замер в HF-7б |
| Глубина 5000 не влезает в окно модели или дорога | приёмка HF-6: подсчёт токенов и цена до подъёма потолка |
| Телеметрия смешивает хосты или теряет метрики | F7, HF-13 |
| Память фона и MAIN | архитектура §5.5, ленивый чанк фона, журнал «Новых» в IndexedDB, перемеры после тяжёлых служб |
| Бюджеты без базы | P3d до P7a, в двух условиях соседа |
| Хаб не готов к пилоту | функции читаются «хаб пока не умеет», ничего не ломается |
| Объём растёт с выпусками старого | паритет — на день перехода (X34): каждый выпуск старого до перехода — новые строки матрицы и PR (уже: 2.10.x «Заполнить из чата») |
| Нет живой проверки отправки/прикрепления до пилота | чтение DOM/сети через DevTools (X38); способы старого; стенд с соседом; пилот с наблюдением |
| Цена e2e на платном CI | метки сюит по сайту для локального цикла; Ready — один раз после полного локального прогона |

## 6. Где нужен владелец

P3b выполнен 2026-10-16: тестовые сборки подписаны, все 14 проверок прошли
([результат](spike.md#подписанный-прогон-2026-10-16)); пункты 6–7 остаются в пилоте P16c.

| Когда | Что |
|---|---|
| после HF-6 | 5000 вместо 3000 — после подсчёта токенов и цены (3000 поднято 2026-10-13, X37) |
| P16c | флаги на всех 6 страницах Fansly, выдать расширение всем 11 чаттерам, согласие на телеметрию |
| выпуски | подпись выпусков нового |
