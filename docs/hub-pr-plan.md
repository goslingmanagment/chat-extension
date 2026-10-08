# План хаба для нового расширения (chat-extension): H-0…H-15

База: hub `origin/main` **90b642e9**. Прод отдаёт тот же контракт `1378e7ee…`. После этого в `main` влит Sync-PR #406, и на 2026-10-03 `main` = **1e7277ea**. Номера строк ниже даны по 90b642e9; исполнитель сверяет их с текущим `main`.

Что прочитано на проде (только чтение, 2026-10-03):

| Что | Значение |
|---|---|
| `aiTranscriptFreshUnionMode` | `serve` |
| `chatMuseAiPromptDebugEchoEnabled` | `true` |
| `config_audit_log` | max id = 139 |
| живые device-токены | десктоп 0.1.64 ×2, Fansly-расширение 2.7.1 ×6, ещё 3 токена без версии не использовались с июля |
| SDK у обоих живых клиентов | один и тот же, хеш `b95b765c…` |

---

## 1. Короткий итог

**Объём.**
- До пилота в хабе нужно **33 небольших PR**. Ещё **4 PR** — по желанию.
- Отдельно нужны 3 маленькие правки гейтов выпуска в клиентских репозиториях (H-1d/e/f). Это не PR в хаб.

**Порядок — 7 пачек**, они совпадают с этапами расширения:

| Пачка | Этап | PR |
|---|---|---|
| A | основа, сейчас | H-0 (#383), H-1a, H-12a, H-4a, H-1b, H-1c |
| B | M1: вход, bootstrap, узкий токен | H-2a, H-2b, H-3, H-11a, H-12b |
| C | M2: AI-док и свежий текст | H-4b, H-13, H-4c, H-10a, H-14a |
| D | M3: глубокие функции | H-5, H-6, H-10b |
| E | M4: Spenders, лента, опека отправки | H-9a, H-9b, H-9c, H-8a, H-8b, H-8c, H-7a, H-7b |
| F | M5: «Новые» | H-7c, H-7d, H-7e |
| G | M6: остальное | H-15, H-11b, H-11c |

**Главное правило: каждый PR при слиянии ничего не включает.**
- Флаги по умолчанию выключены.
- Новые SSE-кадры уходят только клиенту, который объявил нужную возможность в заголовке.
- Новые маршруты, пока флаг выключен, отвечают `409 client_feature_disabled`.

Причина: прод выкатывается из `main` вручную, но выкладки Sync Engine идут почти каждый день. Любой слитый PR уедет в прод со следующей выкладкой, даже без нашей (см. вопрос 1 в §6).

**Критический путь пилота:**
H-0 → H-1a → H-1b → H-2a → H-2b → H-3 → (живой вход в Firefox) → H-7a → H-7b → H-7c → H-7d, плюс H-7e до включения X8.
Второй по длине путь — AI: H-4a → H-4b → H-13 → H-4c (свежий текст).

**Потоки, которые можно вести параллельно.** Все маршрутные PR идут после H-2a. Один интегратор по очереди сливает правки общих мест: `routes-client.ts`, закреплённый список маршрутов с областью страницы, реестр конфига, номера миграций.

| Поток | PR |
|---|---|
| Доступ | H-2a → H-2b → H-3 (→ H-3b) |
| AI | H-4a → H-4b → H-13 → H-4c → H-10a → H-5 → H-6 → H-10b |
| «Новые» и опека | H-7a (можно сразу после пачки A) → H-7b → H-7c → H-7d → H-7e |
| Чтения | H-9a → H-9b → H-9c; H-8a → H-8b → H-8c; H-15 |
| Телеметрия | H-11a → H-11b → H-11c; H-14a |

**Самые рискованные по пересечению с Sync Engine:** H-4c, H-6, H-2b, H-11b, H-1c. Это файлы `features/index.ts`, `context/index.ts`, реестр конфига, `deploy-production.sh`, миграции. Каждый такой PR небольшой, ребейз делаем прямо перед Ready.

---

## 2. Таблица PR

Обозначения: **хеш** — меняется ли хеш контракта. «gen» — файлы, которые пересобирает `pnpm contracts:generate`. Размер — строки, написанные руками, вместе с тестами.

| № | H | PR (заголовок) | Что меняет | Главные файлы | Флаги | Тесты | Зависит от | Размер | Риск с Sync |
|---|---|---|---|---|---|---|---|---|---|
| 1 | H-0 | #383 `fix(ai): persona prompts and the raw prompt lane are owner-session only; owner console edits personas, audited` | полный текст персон, их запись и сырой шлюз — только owner-session; правка персон из кабинета с аудитом; хеш | готовый PR: `modules/ai/index.ts`, `persona-admin.ts`, `routes.ts` (auth), `AiPersonasTab.tsx` | нет: ужесточение действует сразу после выкладки | уже в PR: 9 integration-файлов | — | готов (+1255/−590), ребейз S | низкий: конфликт только в 2 файлах gen |
| 2 | H-1a | `test(compat): frozen client SDKs run against every hub candidate` | реестр замороженных SDK, фикстура `b95b765c`, набор совместимости; хеш не меняется | `scripts/register-client-sdk.mjs`, `services/client-sdk-registry.ts`, `tests/fixtures/client-sdks/`, `tests/client-sdk-compat.integration.test.ts` | нет | integration + unit реестра | лучше после H-0 | M ~450 + ~1 МБ фикстур | нет |
| 3 | H-12a | `fix(ingest): journal chat-extension clients as chat-extension@<version>` | producer для заголовка `chat-extension/…` | `services/ingest-observations.ts:56-60` | нет | unit-таблица | — | S ~45 | нет |
| 4 | H-4a | `feat(sdk): streamAiFeature advertises a capability list` | опция `capabilities` в SDK, сервер разбирает набор; поведение то же; хеш не меняется | `sdk-runtime.ts:542-560`, `prompt-debug-echo.ts`, `ai/index.ts:325-338`, `generate-sdk.ts`, `generate.ts:83` | нет | `sdk-runtime.test`, тест разбора | H-1a | S ~120 | низкий |
| 5 | H-1b | `feat(health): compatibleClientSdks lists the client SDKs this hub serves` | необязательный ключ в health, режим запуска `print-compatible-client-sdks`; хеш | `routes.ts:376-387`, `services/health.ts`, `startup.ts` | нет | unit + набор H-1a | H-1a | S ~80 + gen | средний: рядом `syncHealth*` |
| 6 | H-1c | `ci(deploy): refuse a candidate that drops a registered client SDK` | выкладка останавливается, если кандидат теряет зарегистрированный SDK | `scripts/deploy-production.sh` (рядом с 1771-1830/1952), `tests/compose-config.test.ts` | ключ владельца `--drop-client-sdk <hash>` | тест-закрепление | H-1b | S ~60 | высокий по файлу: сливать в тихое окно |
| 7 | H-2a | `feat(client): GET /api/v1/client/bootstrap, every feature off` | новый модуль контракта `routes-client.ts`, модуль `modules/client`, bootstrap; хеш | `routes-client.ts` (новый), `routes.ts` (2 строки), `server.ts` (1 строка), `services/client-{bootstrap,features,capabilities,limits}.ts`, `db/repositories/client-bootstrap.ts`, `vendor-sdk.mjs` | значения в коде: всё выключено | unit формы + `client-bootstrap.integration` | H-0 | M ~300 + gen | средний (gen) |
| 8 | H-2b | `feat(client): owner-audited chat-extension switches feed bootstrap` | 5 ключей конфига, `configRevision`, привязки, проверка функций, ошибка `client_feature_disabled` | `config-registry.ts` (блок в конце), `config.ts`, `configCopyRu.ts`, `services/client-features.ts`, `errors.ts`, `docs/error-handling.md` | `chatExtension*`, все выключены | unit проверки + integration аудита | H-2a | S/M ~250 | высокий (реестр конфига) |
| 9 | H-3 | `feat(auth): narrow chat-extension device token with an always-on route allowlist` | неизменяемый профиль токена, разрешённый список маршрутов, сужение ingest, AI-выключатель для профиля, метка генерации; хеш | миграция `02NN`, `schema.ts` (deviceTokens), `repositories/auth.ts`, `services/auth.ts`, `server.ts` onRequest, `contracts/client-token-scopes.ts`, `identity/index.ts`, ingest | нет: узкий токен клиент запрашивает сам | unit списка + `device-token-client-profile.integration` | H-2b | M ~550 + gen | средний (номер миграции) |
| 10 | H-11a | `feat(contracts): client_health v1 report schema and perf bounds` | схема отчёта и реестр границ гистограмм; хеш не меняется | `routes-client.ts`, `generate-sdk.ts` | нет | unit | H-2a | S ~250 | нет |
| 11 | H-12b | `docs(errors): chat-extension column in the error canon; third hotkeys client` | колонка канона ошибок, README хоткеев, комментарии скриптов вендоринга | `docs/error-handling.md` §1/§2/§5, `packages/chatgoose-hotkeys/README.md`, `vendor-hotkeys.mjs` (комментарии) | нет | — | заморозка реестра CG в R01 | S | средний (горячий документ) |
| 12 | H-4b | `feat(ai): context_v1 frame for clients that advertise context-v1` | кадр `context_v1`, поле `knownFanMessageId`, общий помощник покрытия; хеш | `routes.ts:1883-1934` и тело, `ai-gateway.ts`, `ai/index.ts`, `features/index.ts` (2–3 места), `repositories/ai-live-context.ts`, `services/client-coverage.ts` | заголовок `context-v1` | `ai-feature-service.integration`, набор H-1a | H-4a, H-3 | M ~450 + gen | средний |
| 13 | H-13 | `feat(client): shared recaps read; contextScope rows never selected` | чтение общих рекапов; исключение `contextScope` из выбора рекапов и досье; хеш | `ai-restricted.ts:89-142`, `fan-profiles.ts:101-144`, `routes-client.ts`, `modules/client/recaps.ts` | `recap` | `ai-recap-selection.integration` | H-3 | M ~350 + gen | низкий |
| 14 | H-4c | `feat(ai): fresh text of the open OnlyFans chat as principal-draft context` | `liveTextContext`: слияние, `context_conflict`, `contextScope`, блок `live` в кадре; хеш | тело в `routes.ts`, `features/index.ts`, `context/live-text.ts` (новый), конфиг | `freshText` + `aiLiveTextContextMode` (off) | unit слияния + матрица integration | H-4b, H-13 | L ~650 + gen | высокий |
| 15 | H-10a | `feat(ai): split-all-v1 for Ping and Hi` | Split у Ping и Hi по возможности `split-all-v1` | `builder.ts`, `templates.ts`/`.md`, `features/index.ts:791`, `prompt-manifest.json` | `splitAll` | эталонные промпты, матрица | H-4a, H-2b | M ~350 | низкий |
| 16 | H-14a | `test(ingest): chat-extension acceptance payloads project like the old clients'` | только тест | `tests/client-acceptance.integration.test.ts` | нет | integration | H-12a | S ~80 | нет |
| 17 | H-5 | `feat(client): save a full Recap to the fan profile from its stored generation` | досье из сохранённой генерации; хеш | `routes-client.ts`, `modules/client/profile-from-generation.ts`, `services/fan-profiles.ts`, `ai-restricted.ts` | `recap` | integration | H-13 | M ~350 + gen | низкий |
| 18 | H-6 | `feat(ai): full Recap reads up to 3000 messages for context-v1 clients` | параметр `maxRows` в читателях; включается только для нового протокола | `message-archive.ts:1543-1569`, `ai-transcript-union.ts:44-55,175-205`, `context/index.ts` (параметр), `features/index.ts` | `aiTranscriptDeepMaxRows` = 1500 | integration + EXPLAIN | H-4b | S/M ~250 | высокий |
| 19 | H-10b | `feat(ai): split-all-v1 for Coach drafts` | части внутри блоков черновика Coach | шаблон coach, `builder.ts` | `splitAll` | эталонные промпты | H-10a | S/M ~200 | низкий |
| 20 | H-9a | `refactor(ai): one Ping-summary helper for generation and readers` | вынос `computePingSummary` без изменения поведения | `features/index.ts:586-609`, `context/ping-summary.ts` | нет | unit эквивалентности | — | S ~100 | средний |
| 21 | H-9b | `feat(db): keyset feed reader over the archive and the AI union` | постраничный читатель, удалённые как строки, границы снимка; хеш не меняется | `repositories/conversation-feed.ts`, `ai-transcript-union.ts` (экспорт CTE) | нет | integration + снимок SQL | — | M ~550 | средний |
| 22 | H-9c | `feat(client): archive feed for one conversation, DB only` | маршрут ленты, подписанный курсор, покрытие, сводка Ping; хеш | `routes-client.ts`, `modules/client/feed.ts`, `services/conversation-feed.ts`, `services/signed-cursor.ts` | `preview` | integration с ловушкой исходящих запросов | H-9a, H-9b, H-3 | M ~750 + gen | низкий |
| 23 | H-8a | `feat(spenders): stats definitions and awaiting-reply query` | определения окон и SQL; хеш не меняется | `packages/shared/src/spender-stats.ts`, `repositories/spender-stats.ts` | нет | unit окон + integration | — | M ~500 | низкий |
| 24 | H-8b | `feat(client): spenders stats for one page` | маршрут статистики, кэш 60 с; хеш | `routes-client.ts`, `services/spender-stats.ts`, `modules/client` | `stats` | integration сверки | H-8a, H-3 | M ~550 + gen | низкий |
| 25 | H-8c | `feat(client): awaiting-reply queue with a signed cursor` | очередь «ждут ответа»; хеш | то же | `stats` | integration пагинации | H-8b; ядро курсора — из H-9c или вводится здесь | S/M ~300 + gen | низкий |
| 26 | H-7a | `feat(db): client lease, greeting and send-custody tables` | 3 таблицы и репозиторий; маршрутов нет; хеш не меняется | миграция `02NN`, `repositories/client-claim.ts` (сырой SQL), `erasure/index.ts` | нет | integration репозитория + тесты стирания | — | S/M ~600 | средний |
| 27 | H-7b | `feat(client): claim, renew, release and send custody behind switches` | бронь, опека, `registerNativeSend`, resolve (сессия); хеш | `routes-client.ts`, `modules/client/claim.ts`, `services/client-claim.ts` | `newcomers`, `previewSend` | `client-claim.integration` | H-7a, H-3 | M ~700 + gen | средний |
| 28 | H-7c | `feat(client): audience-new read model for OnlyFans` | модель чтения «Новые»; хеш | `repositories/client-audience-new.ts`, сервис, маршрут | `newcomers` | `client-audience-new.integration` | H-7b | M ~700 + gen | низкий |
| 29 | H-7d | `feat(ofapi): daily welcome-message snapshot as a collection category` | категория сбора `account_settings` | `ofapi-read-catalog.ts`, `ofapi-collection-registry.ts`, `ofapi-collection-runner.ts` | политика сбора OFAPI (выкл.) | unit каталога | — (поле в H-7c) | S ~150 | низкий (поток OFAPI) |
| 30 | H-7e | `feat(dashboard): held client sends and their audited resolve` | список зависших отправок и разбор в кабинете; хеш | `routes-client.ts` (сессия), страница кабинета | нет | integration + модель вида | H-7b | S/M ~350 + gen | низкий |
| 31 | H-15 | `feat(client): own AI spend for one page and day` | свои расходы AI за 1–7 дней; хеш | `repositories/ai-usage.ts`, `services/ai-usage.ts`, `modules/client/ai-usage.ts` | мастер-выключатель | `client-ai-usage.integration` | H-3 | S/M ~320 + gen | низкий |
| 32 | H-11b | `feat(ingest): client_health rollups without identifiers, behind a switch` | приём `client_health` в почасовые агрегаты без id | миграция, `repositories/client-health.ts`, `ingest-observations.ts`, конфиг | `chatExtensionHealthIngestEnabled` | integration | H-11a, H-3 | M ~600 | высокий |
| 33 | H-11c | `feat(dashboard): owner client-health view` | витрина владельцу; хеш | `routes-client.ts` (owner-session), кабинет | нет | integration + модель вида | H-11b | M ~500 + gen | низкий |
| 34* | H-3b | `feat(auth): show the token client in the cabinet; stop key for extension sign-in` | видимость профиля, ключ остановки входа | `routes.ts` (элементы списка устройств), кабинет | `chatExtensionTokenIssuanceEnabled` | integration | H-3 | S ~80 | средний |
| 35* | H-14b | `feat(ai): send provenance columns on acceptance events` | только по просьбе владельца | миграция, проекция | нет | integration | H-14a | S/M ~200 | высокий |
| 36* | H-7f | `fix(ofapi): a top-fan award is not a subscription` | только с согласия владельца | `canonicalize/ofapi-webhook.ts`, `ofapi-subscription-projection.ts` | нет | integration | — | S | низкий |
| 37* | — | `chore(dev): seed a keyless local hub for client smoke tests` | владелец, чаттер, 2 OF-страницы без OFAPI | `scripts/dev-seed-client.ts` | нет | — | — | S | нет |

`*` — по желанию.

**Вне хаба** (в своих репозиториях, со следующим выпуском каждого клиента):
- **H-1d** — `onlyfans-chat`: `apps/desktop/scripts/assert-release-sdk-vendor.mjs:50-64`, проверка «хеш ∈ `compatibleClientSdks`».
- **H-1e** — `fansly-chat`: `scripts/deploy.sh:315-333`, то же.
- **H-1f** — `chat-extension`: `tools/release` с первого XPI.

---

## 3. Брифы исполнителям

### 3.0 Общие правила для всех PR

1. **Отдельный worktree хаба на каждый PR** от свежего `origin/main`, ветка `client/<slug>` (по образцу `sync/…`). Основной checkout `~/code/1-platform/hub` — только для чтения.
2. **Маршруты.**
   - Новые клиентские маршруты объявляются только в `packages/contracts/src/routes-client.ts` (группа `clientRouteSchemas`).
   - Обработчики — только в `apps/runtime/src/modules/client/*`.
   - `routes.ts` трогаем только в H-0, H-1b, H-3, H-4b, H-4c: там меняются существующие схемы.
3. **Схема и обработчик — в одном PR.** Иначе `generate-sdk.ts:41-46` падает на несовпадении реестра и таблицы маршрутов.
4. **Сгенерированные файлы.**
   - После изменения контракта: `pnpm contracts:generate`, в коммит идут `reference/agency-hub.openapi.json`, `packages/contracts/src/contract-hash.ts`, `packages/sdk/src/{operations,meta,index}.ts`, `docs/generated/authorization-policy.md`.
   - Конфликты в этих файлах руками не решаются: после каждого ребейза — заново `pnpm contracts:generate`.
5. **Формы контракта — по §4.0:**
   - тела запросов и query строгие (`.strict()`);
   - объекты ответа нестрогие;
   - растущие словари — открытые строки.
6. **Каждый новый клиентский маршрут:**
   - `auth: { kind: "apiKey", scope: "page" }` с `:pageLabel` в пути. Исключения: bootstrap — без страницы; маршруты кабинета — `session` / `owner-session`;
   - в обработчике `requireHumanPrincipal` и `requireClientFeature(app, principal, page, flag)` (вводит H-2b);
   - ключ добавляется в `CLIENT_TOKEN_PROFILES["chat-extension"].operations` (после H-3);
   - ключ добавляется в закреплённый список маршрутов с областью страницы в `tests/contracts-auth-declarations.test.ts:46+`;
   - токен возможности добавляется в `SERVED_CLIENT_CAPABILITIES`.
7. **Проверка платформы** (`platform ===`) — только внутри `evaluateClientFeature`. Новых веток в обработчиках нет, иначе растёт бюджет в `scripts/platform-branch-budget.json` (164).
8. **Тесты.**
   - unit — `tests/<name>.test.ts`;
   - БД и API — `tests/client-*.integration.test.ts`, строго в верхнем уровне `tests/`. Тогда файл сам попадает в шарды sync-critical. Вложенная папка не попадёт ни в один уровень, и `deploy-ci-policy.test.ts:1578` упадёт;
   - в `api.integration.test.ts` не добавлять: без метки `[sync-critical]` это запускается только ночью.
9. **Доказательство для старых клиентов в каждом PR:** набор H-1a зелёный, плюс указанные регрессионные файлы.
10. **Миграции:**
    - только вперёд;
    - номер берётся при последнем ребейзе перед Ready (Sync Engine занимает номера почти каждый день; `migrate-runner.ts:34-46, 61-66`);
    - запись в `ROLLBACK_COMPATIBLE_MIGRATIONS` (`deploy-production.sh:397+`) с обоснованием;
    - новые таблицы без внешнего ключа на `pages` — либо регистрировать их в стирании.
11. **Новые ключи конфига:**
    - одним блоком в конце `config-registry.ts`;
    - поле и разбор в `config.ts`;
    - подпись в `apps/dashboard/src/pages/settings/configCopyRu.ts` (закреплено тестом);
    - закомментированная строка в `.env*.example`.
12. **Документы — в том же PR:**
    - строки `docs/error-handling.md` §3 для новых кодов;
    - `docs/identity-rights-matrix.md` для новых прав;
    - `docs/ai-gateway-contract.md` для AI.
    - Хаб журнал решений не ведёт; ссылки на решения — на `chat-extension/docs/decisions.md` или `architecture.md §19`.
13. **Тело PR:** Problem / Change / Unchanged for old clients / Tests (`pnpm check` с числом тестов и список integration-файлов) / Contract hash: changed|unchanged / Migration: none|02NN / Flags / Inert at merge: yes. В конце — строка Claude Code.
14. **Процесс:** Draft → локально `pnpm check` и свои integration-файлы → ребейз и `contracts:generate` → Ready один раз → слияние squash только после «да» владельца (вопрос 1 в §6).

---

### PR 1 — H-0: доводка #383

- **Что.**
  - Ребейз ветки `fix/ai-persona-routes-owner-only` на `origin/main` в отдельном worktree (ветка чужая, см. вопрос 2 в §6).
  - Конфликтуют только `packages/contracts/src/contract-hash.ts` и `packages/sdk/src/meta.ts`. Взять любую сторону, затем `pnpm contracts:generate`.
  - Проверить, что после автослияния в `routes.ts` остались четыре изменения auth: `aiPersonasList`, `aiPersonaUpsert`, `aiPersonaArchive`, `aiGatewayStream` → owner-session.
- **Проверки.**
  - `pnpm check`.
  - `npx vitest run --no-file-parallelism` на 9 файлах из описания PR: rights-matrix, ai-persona-admin, auth-policy, ai-gateway, ai-restricted-class, ai-feature-service, ai-media-notes, sdk, fan-alias-concurrency.
  - Обновить в описании числа хешей (сейчас там 38176d8e→8e547c28).
  - Заново посмотреть журнал nginx за последнее окно: аутентифицированных вызовов этих 4 маршрутов быть не должно.
- **Совместимость.**
  - Десктоп 0.1.64 и Fansly 2.7.1 эти маршруты не зовут: у десктопа есть только обёртка `streamAiGateway`, и её вызывают лишь тесты.
  - Важно: закрываются **все** device-токены, включая токены тимлида и владельца.
- **Готово, когда:**
  - на проде device-токен получает 403 на `GET /api/v1/ai/personas` и `POST /api/v1/ai/gateway/stream`;
  - `GET /api/v1/ai/persona-catalog` отвечает 200;
  - владелец правит персону в кабинете.

### PR 2 — H-1a: набор совместимости и реестр замороженных SDK

**Цель:** доказать в CI, что каждый кандидат хаба обслуживает SDK уже выпущенных клиентов. Контракт не меняется.

1. **`apps/runtime/src/services/client-sdk-registry.ts`.** Реестр живёт на стороне хаба и в клиенты не вендорится. Форма строки:
   ```ts
   export interface ClientSdkRegistryRow {
     contractHash: string;   // 64 hex
     sourceCommit: string;   // 40 hex, без «-dirty»
     status: "released" | "candidate";
     clients: ReadonlyArray<{ name: "onlyfans-chat" | "fansly-chat" | "chat-extension"; versions: readonly string[] }>;
     operations: readonly string[]; // ключи операций сверх общего ядра
     fixture: string;              // "tests/fixtures/client-sdks/<hash12>"
   }
   export const CLIENT_SDK_REGISTRY: readonly ClientSdkRegistryRow[] = [ /* между маркерами, сортировка по hash */ ];
   ```
2. **`scripts/register-client-sdk.mjs <client-vendor-dir> --client <name> --version <v>[,<v>] [--candidate]`.**
   - Читает `kernel-sdk.vendor.json`. При `-dirty` отказывает.
   - Собирает через esbuild (уже есть в devDependencies) `<vendor-dir>/dist/index.js` в один ESM-файл `tests/fixtures/client-sdks/<hash12>/sdk.mjs`: target es2022, zod внутри.
   - Сборку запускать на файле в репозитории клиента, чтобы zod взялся из `node_modules` клиента.
   - Копирует манифест рядом.
   - Детерминированно переписывает массив между маркерами в реестре.
   - Одна строка на хеш.
3. **Первая строка реестра.**
   - `b95b765c…`, sourceCommit `e033e3ec…`.
   - Клиенты: `onlyfans-chat` 0.1.64 и `fansly-chat` 2.6.0–2.7.1. Вендоренные `dist` у них побайтно одинаковы.
   - Источник: `~/code/1-platform/onlyfans-chat/packages/kernel-sdk`.
   - Старые хеши (`abf87a65`, `21a767b8`, `2620650e`) не регистрируем: по проду живы только 0.1.64 и 2.7.1.
4. **`tests/client-sdk-compat.integration.test.ts`.**
   - Подготовка — по образцу `tests/sdk.integration.test.ts` и `ai-feature-service.integration.test.ts`:
     - `startIntegrationTestDatabase`, `createTestAppContext`;
     - `buildApiServer` на случайном порту;
     - владелец и чаттер с `issueChatterDeviceToken`;
     - одна OF-страница и одна Fansly-страница, персона;
     - `appContext.aiGatewayProvider = capturingProvider(...)`.
   - Для каждой строки реестра: `await import(fixture/sdk.mjs)` → `createClient({ baseUrl, auth: { mode: "bearer" }, headers: { "x-client-version": … } })`.
   - **Общее ядро проверок:**
     - `health`: типизированный вызов, плюс сырой `fetch` и `safeParse` схемой `routeSchemas.health.response[200]` этого SDK, как делает Fansly;
     - 503 «degraded»;
     - `me`, `pages`, `aiPersonaCatalog`, `aiRecapStatus`;
     - `spenders` с областью страницы;
     - `ingestObservations` с `ai_acceptance`;
     - `streamAiFeature` для `fast-reply`, `ping`, `fan-summary`, каждый с `debugPromptEcho` и без, при включённом и выключенном `chatMuseAiPromptDebugEchoEnabled`. Кадры meta → content_delta → usage → done разбираются;
     - ошибки: 401 `token_revoked`/`token_expired` доходят до `KernelApiError.body.reason`; 429 `quota_denied` → категория `rate_limit`; 409 `persona_definition_changed`.
   - Затем операции из `row.operations`.
   - **Утверждение:** ни одной `KernelApiError` с категорией `contract` (`undeclared_status`, `response_validation_failed`, `frame_validation_failed`).
   - Персоны полным текстом и сырой шлюз в списки не входят. После #383 на них ожидаем 403.
5. **`tests/client-sdk-registry.test.ts` (unit):**
   - каждой строке реестра соответствует ровно одна фикстура и наоборот;
   - `KERNEL_CONTRACT_HASH` внутри бандла = хеш строки = хеш манифеста;
   - `sourceCommit` — 40 hex.
6. `tests/ci/shard-weights.json` — вес после первого прогона (без веса берётся медиана).

**Доказательство:** зелёный набор на текущем `main`. Затем каждый PR, меняющий кадры или формы, прогоняется против этих бандлов. Хеш не меняется.

### PR 3 — H-12a: producer для нового клиента

- В `ingestProducerForClientVersion` (`ingest-observations.ts:56-60`) правило: заголовок `^chat-extension/(.+)$` → `chat-extension@$1`. Остальное без изменений:
  - голая версия → `desktop@…`;
  - `harvest-` → `desktop-harvest@…`;
  - `chatgoose-extension/2.7.1` → `desktop@chatgoose-extension/2.7.1` (Fansly не трогаем).
- Не менять:
  - пространство видов `desktop.<kind>`: на него опираются `canonicalize/client-capture.ts:32-49`, `observation-kinds.ts:342`, `projections/ai-acceptance.ts:23`;
  - строку журнала «Desktop client version observed» (`client-versions.ts`): по ней ищет проверка парка.
- Тест `tests/ingest-producer.test.ts`: таблица из четырёх стилей заголовка. Для `chat-extension@…` `isHarvestProducer` ложно.

### PR 4 — H-4a: список возможностей в SDK

1. **`sdk-runtime.ts`:**
   - `export const AI_STREAM_CAPABILITIES = ["debug-input-v1", "context-v1", "split-all-v1"] as const; export type AiStreamCapability = …`;
   - `streamAiFeature` получает `capabilities?: readonly AiStreamCapability[]`;
   - заголовок = объединение `capabilities` и (`debugPromptEcho` ? `debug-input-v1`), без повторов, в порядке константы, через `", "`; без значений заголовка нет;
   - старые вызовы дают ровно `debug-input-v1`.
2. **`generate-sdk.ts`:** в список реэкспорта индекса добавить `AI_STREAM_CAPABILITIES`, `type AiStreamCapability`. **`generate.ts:83`:** `sdkVersion` `0.3.0` → `0.4.0` (меняются `meta.ts` и `package.json`, хеш — нет).
3. **`prompt-debug-echo.ts`:**
   - `parseAiStreamCapabilities(header): ReadonlySet<AiStreamCapability>`: потолок 256 символов, разбиение по запятой, `trim`, только известные значения, с учётом регистра;
   - массив в заголовке → пустое множество;
   - `hasDebugInputCapability` становится обёрткой над ней.
4. **`ai/index.ts:325-338`:** разобрать один раз и передать множество в опции `prepareAiFeatureStream` как `capabilities`; `debugPromptEcho` выводить из него.
5. **Заголовок в схеме маршрута не объявлять.** Иначе Fastify начнёт отвечать 400 на длинный заголовок вместо того, чтобы его игнорировать.

Тесты: `tests/sdk-runtime.test.ts` (~190-200) — случаи заголовка; разбор — неизвестные значения, длина больше 256, массив. Поведение для старых клиентов то же, набор H-1a зелёный.

### PR 5 — H-1b: `health.compatibleClientSdks`

- **`routes.ts:376-387`:** добавить `compatibleClientSdks: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(64).optional()`. Строку 380 (`capabilities`) **не трогать**: это закрытый литерал, и его проверяют Fansly и `deploy-production.sh:1776-1787`.
- **`services/health.ts:208-260`:** в обоих телах (200 и 503) — `compatibleClientSdks: listCompatibleClientSdks()`. Это свой `KERNEL_CONTRACT_HASH` первым, затем хеши реестра, без повторов.
- **`startup.ts:58`:** режим `print-compatible-client-sdks`, вывод `{"own":"<hash>","registered":["…"]}`.
- **Тесты:**
  - unit на список;
  - тело нового health разбирается схемой health из бандла `b95b765c` (zod срезает лишний ключ);
  - `api.integration.test.ts:7009-7060` использует `toMatchObject` и остаётся зелёным.
- **Хеш меняется** → `contracts:generate`.

### PR 6 — H-1c: защита выкладки

- В `deploy-production.sh` новая функция `verify_candidate_client_sdks` рядом с `verify_candidate_lifecycle_capability` (1771-1830), вызов рядом с :1952.
  - Запускает `startup.js print-compatible-client-sdks` в работающем образе и в кандидате.
  - Требует, чтобы `registered(running) ⊆ registered(candidate)`, кроме хешей из повторяемого ключа `--drop-client-sdk <hash>`.
  - Если в работающем образе такого режима ещё нет — пропуск с сообщением.
- Закрепляющий тест — как у проверки возможностей (`tests/compose-config.test.ts` ~639).
- Сливать маленьким PR в тихое окно: файл менялся 36 раз за 3 недели.

### PR 7 — H-2a: bootstrap, всё выключено

1. **`packages/contracts/src/routes-client.ts`** — каркас и bootstrap по §4.1–4.2.
   - Импорт только из `zod`, `./primitives.ts` и `@agency_hub_core/shared` (`userRoles` из `types.ts` — он есть в вендоринге).
   - **Никогда не импортировать из `./routes.ts`**: будет цикл.
2. **`routes.ts`:**
   - импорт `clientRouteSchemas`;
   - `& typeof clientRouteSchemas` в `RouteSchemas` (8273-8277) — именованная группа, чтобы не упереться в TS7056;
   - `...clientRouteSchemas` в `routeSchemas`.
3. **`contracts/src/index.ts`:** `export * from "./routes-client.ts"`. **`scripts/vendor-sdk.mjs`:** `"routes-client.ts"` в список подготовки (`tests/vendor-sdk-staging.test.ts` выводит требование из barrel).
4. **Рантайм:**
   - `modules/client/index.ts` с `registerClientRoutes(server, ctx)`; одна строка в `api/server.ts` рядом с `registerSyncEngineRoutes` (:627);
   - `services/client-limits.ts` — константы §4.2 (`deepMax` = 1500 до H-6);
   - `services/client-capabilities.ts` — `SERVED_CLIENT_CAPABILITIES: string[] = []`;
   - `services/client-features.ts` — чистая функция `evaluateClientFeature({ settings, page, flag, served })` → `{ available, reason? }` и таблица требований (§4.12). В H-2a `settings` = значения в коде: мастер выключен, поэтому везде `{available:false, reason:"disabled"}`, все флаги false;
   - `services/client-bootstrap.ts` — сборка ответа.
5. **`packages/db/src/repositories/client-bootstrap.ts`:** `listClientBootstrapPages(db, pageIds | null)`.
   - Поля: `id, label, platform, display_name`, имя модели, `pages.platformAccountId` (это `external_page_id`), `ofapi_binding_generation`.
   - Только `status = 'active'`, без надгробий. Экспорт в `packages/db/src/index.ts`.
   - Ловушка имён: в Sync Engine `platformAccountId` значит `pages.id`. Здесь брать только поле таблицы `pages`.
6. **Ответ:**
   - `identity.tokenClient = null` (до H-3);
   - `bindingsByHost = {}`, `configRevision = 0`, `minVersion = "0.0.0"`, `ttlSec = 300`;
   - `title = display_name ?? имя модели`;
   - `bindingRevision = ofapi_binding_generation` для OF и 1 для Fansly;
   - страницы Fansly показываются с `features.*.reason = "platform_unsupported"`.
7. `docs/identity-rights-matrix.md` — строка «client bootstrap».

**Тесты.**
- unit `tests/client-bootstrap-contract.test.ts`: схема принимает неизвестные ключи флагов, функций и возможностей; без `protocol`/`identity` — отказ.
- integration `tests/client-bootstrap.integration.test.ts`:
  - чаттер видит только свои активные страницы, `platformAccountId` = `external_page_id`;
  - владелец видит все; надгробие не видно;
  - cookie-сессия → 403; без токена → 401.

**Совместимость:** старые клиенты маршрут не зовут; набор H-1a зелёный. Хеш меняется.

### PR 8 — H-2b: выключатели владельца

1. **Ключи конфига** (блок в конце, subsystem `Core`, `EDITABLE`, `runtimeApply: "live"`):

   | Ключ | Тип | По умолчанию | Смысл |
   |---|---|---|---|
   | `chatExtensionEnabled` | boolean | `false` | мастер-выключатель |
   | `chatExtensionFeatures` | string JSON | `"{}"` | `{"*": {flag: bool}, "<pageLabel>": {…}}`; строка страницы важнее `"*"`; неизвестные флаги игнорируются |
   | `chatExtensionMinVersion` | string | `"0.0.0"` | semver |
   | `chatExtensionHostBindings` | string JSON | `"{}"` | `{"onlymonster:36408": "lora-vip-of"}` |
   | `chatExtensionPreviewSendReceiptProfiles` | string JSON | `"[]"` | массив `clientReceiptProfileSchema` |

2. **Проверка при записи** (`validateConfigOverride` в `packages/shared`): битый JSON и неверный semver **отвергаются**, а не подрезаются. При чтении — тоже защита: битое значение → всё выключено и запись в журнал ошибок.
3. **`requireClientFeature(app, principal, page, flag)`:**
   - бросает новый `ClientFeatureDisabledError` (409, `error: "client_feature_disabled"`, `reason` — причина из проверки);
   - строка в `docs/error-handling.md` §3: «409, если снять запрет может только владелец; не повторять автоматически».
4. **`configRevision`** = `coalesce(max(config_audit_log.id), 0)` по `CLIENT_BOOTSTRAP_CONFIG_KEYS`. В список сразу внести будущие ключи: `aiLiveTextContextMode`, `aiTranscriptDeepMaxRows`, `chatExtensionHealthIngestEnabled`. Версия `config_settings.version` не годится: после очистки ключа она начинается заново.
5. **`bindingsByHost`:** метка → `pageId`. Отбросить страницы, которых нет, которые не активны или не выданы вызывающему (не раскрываем существование чужих страниц).
6. Эффективный конфиг читать через `loadEffectiveConfig` на запрос. Допустимо запомнить его на 5 с.

**Тесты.**
- unit `tests/client-features.test.ts`: мастер, `"*"` против строки страницы, битый JSON, Fansly → `platform_unsupported`, null-id → `binding_missing`, ещё не выпущенная возможность → `hub_not_ready`.
- integration: PATCH конфига владельцем → `configRevision` растёт, флаги меняются, есть строка аудита; ключ на невыданную страницу отброшен.

Контракт не меняется: все поля ввёл H-2a.

### PR 9 — H-3: узкий токен расширения

**Один PR.** Если сохранить профиль токена без его применения, клиент будет считать токен узким, хотя он полный.

1. **Миграция `02NN_device_token_client_profile.sql`:**
   ```sql
   alter table device_tokens add column client_profile text
     check (client_profile is null or client_profile in ('chat-extension'));
   create or replace function device_tokens_client_profile_immutable() returns trigger language plpgsql as $$
   begin
     if old.client_profile is distinct from new.client_profile then
       raise exception 'device_tokens.client_profile is immutable';
     end if;
     return new;
   end $$;
   create trigger device_tokens_client_profile_immutable before update of client_profile on device_tokens
     for each row execute function device_tokens_client_profile_immutable();
   ```
   Без заполнения старых строк: старые токены остаются `NULL`, то есть полные. Запись в `ROLLBACK_COMPATIBLE_MIGRATIONS`.
2. **`schema.ts:2603-2634`:** `clientProfile: text("client_profile")`. **`repositories/auth.ts:219-229`:** `createDeviceToken` принимает `clientProfile`.
3. **`packages/contracts/src/client-token-scopes.ts` (новый, §4.10.4):** `CLIENT_TOKEN_PROFILES`. Добавить в barrel, в список вендоринга и в реэкспорт SDK.
4. **Выдача токена** (`routes.ts:298-311` и `identity/index.ts:393-420`):
   - тело получает необязательное `client`;
   - ответ ветки `active` эхом возвращает `client` (`null` для обычной выдачи);
   - `issueDeviceTokenWithPassword` сохраняет профиль и пишет его в метаданные аудита `device_token.issued`.
5. **Принципал:** `HumanAuthPrincipal.clientProfile?: "chat-extension"`. `authenticateDeviceToken` (`services/auth.ts:1414-1462`) копирует его из строки.
6. **Охрана в `server.ts`** (хук onRequest, сразу после вердикта, 358-419):
   - если вид не `public` / `hmac` / `pending-device-token`, принципал человеческий, у него есть `clientProfile`, а `entry.key` нет в `operations` профиля — бросать `ForbiddenError("This route is not available to this client")`;
   - **всегда**, независимо от `AUTH_POLICY_ENFORCEMENT`;
   - без `reason` (`ForbiddenError` его и не несёт).
7. **Ingest для узкого токена** (`modules/ingest/index.ts:59-95`, `ingest-observations.ts`):
   - виды только из `ingestKinds` профиля (сейчас `ai_acceptance`); иное → 400 на всю пачку;
   - producer = `chat-extension@<версия из заголовка, иначе "unknown">`: определяется профилем, а не заголовком;
   - путь harvest закрыт; `setDeviceTokenHarvestCapabilityForUserId` отказывает узкому токену.
8. **AI-выключатель для узкого токена** (обработчик `aiFeatureStream`, до `prepare`): мастер выключен → `client_feature_disabled`. `coach-chat` / `fan-summary` / `chat-review` проверяют флаги `coach` / `recap` / `review` страницы. Старые токены не затронуты.
9. **Метка генерации:** в `params` записи `ai_generation_content` (`ai-gateway.ts:550-563`) добавить `clientProfile: "chat-extension"` для узкого токена. Это даёт метрику вывода десктопа (≥ 95 % OF-генераций из расширения) без новой колонки.
10. **Bootstrap:** `identity.tokenClient = principal.clientProfile ?? null`.
11. **Документы:** `docs/identity-rights-matrix.md` — колонка «chat-extension device token». Честная граница: человек с паролем всё равно может выпустить полный токен. `contracts/authorization-policy.ts` — колонка в сгенерированном документе.

**Тесты.**
- unit `tests/client-token-scopes.test.ts`:
  - каждый ключ списка есть в `routeSchemas`;
  - нет видов `owner-session`, `session`, `any-session`, `agentKey`, `pending-device-token`, `monitoring`;
  - нет путей `/api/v1/ofapi` и `/api/v1/events`;
  - нет `aiPersonasList`, `aiGatewayStream`, `aiPersonaUpsert`, `aiPersonaArchive`, `followerOutreachAttempt`, `pageTopSpenders`.
- integration `tests/device-token-client-profile.integration.test.ts`:
  - выдача с `client` сохраняет и возвращает эхо; обычная выдача — `NULL`;
  - сырой SQL UPDATE профиля падает;
  - **полный обход `server.routePolicyTable`** узким и старым токеном в обоих режимах (`log`/`enforce`): у узкого 403 без `reason` вне списка; у старого всё как раньше;
  - список работает и уважает область страницы;
  - отозванный токен → 401 `token_revoked`;
  - `send_audit` → 400; producer `chat-extension@x`.
- В `rights-matrix.integration.test.ts` — колонка узкого токена.

**Правило для клиента:** хаб без H-3 молча выбросит поле `client` и выдаст полный токен. Поэтому расширение требует эхо `client === "chat-extension"` и `identity.tokenClient`. Иначе — отзывает токен и показывает `CG-HUB-OUTDATED`.

### PR 10 — H-11a: схема отчёта `client_health`

- В `routes-client.ts`: `clientHealthReportV1Schema`, `CLIENT_HEALTH_PERF_METRICS` (§4.8). Имена метрик и границы окончательно замораживает R01; предложение ниже.
- Реэкспорт в списке `generate-sdk.ts`.
- Помощник процентилей — в `apps/runtime`: контракты его не используют, вендорить не нужно.
- Маршрута нет, хеш не меняется. Unit-тесты формы: свободный текст в `missing` отвергается; длины `counts` и `bounds` расходятся; `count ≠ Σcounts`; больше 200 счётчиков.

### PR 11 — H-12b: канон ошибок и вендоринг хоткеев

1. **`docs/error-handling.md`:**
   - §2 — колонка «chat-extension mapping» с кодами CG из прил. А;
   - пункты про неизвестный код и EOF: `provider*` → провайдерский запасной код; прочее → `CG-HUB-UNKNOWN`; EOF без `done` → код обрыва;
   - §1 — строка «chat-extension AI generation»: один прозрачный повтор `service_unavailable` до первого чанка;
   - §5 — «every client (fansly-chat, onlyfans-chat, chat-extension)»;
   - §3 колонок клиентов не имеет — туда не добавляем.
2. **`packages/chatgoose-hotkeys/README.md` и комментарии `scripts/vendor-hotkeys.mjs`:** третий адресат, текст «ALL clients».
   - **`packages/chatgoose-hotkeys/src/*` не трогать**: изменится sha манифеста `953c6236…`, и обоим старым клиентам придётся перевендоривать.
   - Новый клиент вендорит хоткеи из чистого checkout `a667c62b` — тот же sha и `sourceCommit`, что у обоих клиентов. Клиент хоткеев `'extension'`.
3. Документ не исключён из отпечатка CI → полный прогон. Отдельно от кода.

### PR 12 — H-4b: кадр `context_v1`

1. **`routes.ts`:**
   - `aiFeatureContextFrameSchema` (§4.10.3) добавить **только** в `aiFeatureStreamFrameSchema` (1931-1934); у сырого шлюза союз не меняется;
   - в `aiFeatureStreamBodySchema` — `knownFanMessageId` (необязательное);
   - тип `AiFeatureContextFrame` реэкспортировать в SDK.
2. **Выдача кадра** только при `capabilities.has("context-v1")`:
   - сразу после `meta` (и `debug_input_v1`), до первого `content_delta`;
   - перенос как у debug-кадра: `PreparedAiGatewayStream.contextFrame` (`ai-gateway.ts:84-102, 244-262, 431-441, 585`), запись в `pipeAiGatewaySse` (`ai/index.ts:379-383`).
3. **Содержимое** — из уже посчитанного `contextManifest`:
   - `source` = читатель, который реально обслужил генерацию: `archive` | `union` | `live_union`;
   - `servedHead`, `archiveHead`, `window {requested, served}`;
   - `live = {status: "not_sent", accepted: 0, rejected: 0}` (до H-4c);
   - `fanLanguageEvidence` — грубая эвристика письма по последним 20 текстовым сообщениям фана в обслуженном окне.
4. **`services/client-coverage.ts`** — общий для H-4b и H-9c: `complete` | `partial` | `unknown` по `ofapi_message_coverage` (`getOfapiMessageCoverageServingState`, `repositories/ofapi-message-coverage.ts:567-600`). Не по `page_dm_threads.history_state`: это цепочка Fansly-движка.
5. **`knownFanMessageId`:**
   - новый `packages/db/src/repositories/ai-live-context.ts`, один индексный поиск в `message_archive` (`account_id, platform, message_ref`), `dm_message_archive` (`platform, ofapi_account_id, platform_message_id`) и `page_dm_messages.deleted_at`;
   - состояние `included` (есть в окне) | `absent` | `deleted` | `unknown`;
   - разрешено на всех фичах; искать только после проверки доступа к странице (`features/index.ts:368-375`).
6. `SERVED_CLIENT_CAPABILITIES += "context-v1"`; `docs/ai-gateway-contract.md:77-90` — кадр и согласование.
7. В v1 кадр только на полосе kernel-context (OF). Полоса Fansly `clientContext` — в R20.

**Тесты** (`ai-feature-service.integration.test.ts`):
- без заголовка поток побайтно как сейчас;
- с заголовком кадр есть и стоит на месте;
- голова union свежее головы архива;
- `knownFanMessage` во всех 4 состояниях;
- дырка перед более поздним сообщением модели.

Набор H-1a: замороженные SDK этого кадра не получают. Хеш меняется (поле тела).

### PR 13 — H-13: общие рекапы

1. **`ai-restricted.ts:89-142`:**
   - вынести предикат «пригодный рекап» `usableFanSummaryPredicate(mode)` (он же нужен H-5);
   - добавить `params ->> 'contextScope' is null`;
   - тот же предикат в `fan-profiles.ts:101-144` (`getLatestPromptEligibleFanProfile`).
2. **Маршрут `clientConversationRecaps`** (§4.3), `modules/client/recaps.ts` (не в `modules/ai/index.ts`):
   - `requireClientFeature(recap)`;
   - `conversationRefs = [fanRef]` (на OF `chat_id === fan.id`);
   - `personaDefinitionId` необязателен, как у `aiRecapStatus`;
   - `fullSavedToProfile` — совпадает ли тело последнего досье с полным рекапом.
3. **Права.** Это расширяет класс ограниченных записей: сейчас они только для владельца (`ai-restricted.ts:7-9`). Строго ограничить: только `fan-summary`, только пригодные строки, без `contextScope`, только страница с доступом, без блоков промпта. Записать в `identity-rights-matrix.md` со ссылкой на решение «рекапы общие» (`architecture.md §19 п. 1`, вопрос 8 в §6).
4. `SERVED_CLIENT_CAPABILITIES += "shared-recaps-v1"`; `docs/ai-gateway-contract.md` 225-233.

**Тесты:**
- два чаттера одной страницы видят один рекап;
- фильтр персоны;
- строка `fan-summary` с `params.contextScope` исключена из статуса, вложения в Coach, нового маршрута и досье;
- короткий новее полного;
- непригодные строки пропущены;
- чужая страница → 403/404;
- `aiRecapStatus` на прежних данных побайтно тот же.

Поведение для старых клиентов не меняется: строк `fan-summary` с `contextScope` не бывает (H-4c запрещает свежий текст для `fan-summary`).

### PR 14 — H-4c: свежий текст открытого OF-чата

1. **Тело:** `liveTextContext` (§4.10.3). Порядок проверок до загрузки контекста, после проверки страницы (~:338):

   | Случай | Ответ |
   |---|---|
   | фича не из {`fast-reply`, `improve-draft`, `hi-greeting`, `ping`} | 400 `bad_request`, reason `live_text_not_allowed` |
   | страница не OF | 400, `live_text_not_allowed` |
   | вместе с `clientContext` | 400, `live_text_not_allowed` |
   | нет `context-v1` в заголовке | 400, `capability_required` |

2. **Выключено = игнорировать, а не отказывать.** Если `aiLiveTextContextMode = off` или флаг страницы `freshText` выключен:
   - свежий текст не используется;
   - `context_v1.live.status = "disabled"`.

   Причина: bootstrap может быть старым до 300 с, и выключатель не должен ронять генерации.
3. **Режимы `aiLiveTextContextMode`** (новый ключ, off|shadow|serve, переходы как у `aiTranscriptFreshUnionMode`):
   - `shadow` — слить и записать в манифест, а обслужить архив; без `contextScope`;
   - `serve` — обслужить слияние.
4. **Слияние** — новый `apps/runtime/src/modules/ai/context/live-text.ts`, после возврата `loadTranscriptContext`. Тело `loadTranscriptContext` не трогать: это зона Sync Engine.
   - строки архива первыми; тот же id → побеждает архив (разница HTML и `text_plain` — не конфликт; первый побеждает в `normalize.ts:146-166`);
   - другое направление или id из чужого чата/страницы → 400 `context_conflict` (новый `AppError`);
   - надгробие архива не воскрешается: строка в `rejected`, не конфликт;
   - сортировка по (`occurredAt`, id), `slice(-limit)`, `formatTranscript`;
   - гейт Hi считается по слитому числу: так он может только ужесточиться;
   - анализ Ping — по слитому окну.
5. **`featureParams` для всех фич:**
   - `contextScope: "principal-draft"` пишется только в `serve`, если принят хотя бы один элемент;
   - в манифест — `source: "client-supplied"`, `accepted`, `rejected`, видел ли архив голову.
6. Кадр получает реальный блок `live`. `SERVED_CLIENT_CAPABILITIES += "live-text-v1"`. Строка `context_conflict` в §3 канона ошибок.

**Тесты:**
- unit `tests/ai-live-text-merge.test.ts`: побеждает архив; HTML против простого текста; конфликт направления; чужой разговор; надгробие; потолок окна; порядок;
- integration:
  - матрица «фича × свежий текст» → 400, кроме четырёх;
  - Fansly → 400; `clientContext` вместе со свежим текстом → 400;
  - `contextScope` только в `serve`;
  - **после генерации со свежим текстом нет новых строк** в `message_archive`, `dm_message_archive`, `observations`, `fan_profiles`;
  - строки с `contextScope` не выбираются H-13 и досье.

**Перед `serve` на пилотных страницах:** живая сверка на тестовом чате, что id сообщений ChatSpace = `message_archive.message_ref`. Без совпадения — только `shadow`.

### PR 15 — H-10a: Split для Ping и Hi

- Гейт: возможность `split-all-v1` в заголовке **И** флаг страницы `splitAll` **И** фича ∈ {`ping`, `hi-greeting`}. По наличию `replyMode` не включать: Fansly уже шлёт `preferSplit` на всех фичах (`fansly-chat/src/background/operations.ts:2912`).
- **Две таблицы политик:** `FEATURE_POLICIES` (`feature-policies.ts:127-295`) и `PROMPT_POLICIES` (`builder.ts:183-193`). Возможность передаётся в `buildPrompt` входом (`splitAll`); `features/index.ts:791-792` передаёт `replyMode` при policy **или** гейте.
- **Шаблоны:**
  - новый слот — в конец строки существующего блока Task (`templates.ts:499-507` и `templates/ping.md`), чтобы пустой слот давал побайтно прежний промпт;
  - Hi — через `GREETING_TASKS` (`builder.ts:448-455`): варианты split для 1 и 3 вариантов;
  - статический префикс с кэшем на 1 ч не меняется (`builder.ts:157-165, 934-943`).
- `prompt-manifest.json` — новые `coreSha256` и заметка со ссылкой на решение.
- Проверка структуры на финальном тексте (`output/split.ts`, `reply-output.ts`) пишется в `params.outputStructure`. Только запись: изменить уже отправленный поток нельзя.

Тесты: эталонные промпты всех фич без `splitAll` побайтно те же; Hi 1 и 3 варианта; `[NEXT]` на границе чанков; `ai-feature-parity`, `ai-prompt-manifest`, `templates-sync`.

### PR 16 — H-14a: тест acceptance

- Отдельный файл, не `ai-restricted-class` (его переписывает #383).
- Полезная нагрузка нового клиента: `{generationRef, lifecycle:"sent", via:"preview", attemptId, platformMessageId, part, variant, opId, feature, surface, edited:true}`. Ожидаем:
  - 200 и запись в журнале как есть;
  - проекция пишет строки `sent` и `edited`;
  - повтор того же `clientEventId` → `duplicates=1`, новых строк нет.
- Замороженные полезные нагрузки Fansly и десктопа проецируются как раньше.
- Три части Split с разным `observedAt` → три строки `sent`.

### PR 17 — H-5: досье из генерации

- **Маршрут `clientFanProfileFromGeneration`** (§4.3), `modules/client/profile-from-generation.ts`.
- **Проверки:**
  - генерация того же пользователя, страницы и фана (`fanRef ?? conversationRef`), иначе **404**;
  - `feature = fan-summary`, `summaryMode = full`, `outcome = completed`;
  - `stopReason` есть и не `max_tokens`/`length`;
  - текст не пустой; `contextScope` нет;
  - иначе 409 `generation_not_eligible` с `reason`.
- **«Ещё не готово».** Запись генерации появляется после кадра `done` (`ai/index.ts:401-409, 441-447`). Пока её нет:
  - есть резерв usage с `gatewayOutcome` null или итог usage уже есть → 409 `generation_not_ready`;
  - может остаться навсегда, если вставка упала (`ai/index.ts:441-452` только пишет в журнал). Клиент ограничивает повторы.
- **Идемпотентность:** тело уже есть среди версий досье этого фана → `existing`. Это поиск по равенству тела плюс дедупликация `appendFanProfile`. `sourceGeneratedAt = generation.createdAt`.
- **`fanProfileSourceEnum` оставить `["chatmuse"]`:** старые SDK строго проверяют ответы GET профиля.
- `SERVED_CLIENT_CAPABILITIES += "recap-profile-v1"`. Старый `PUT` остаётся.

Тесты: создано → повтор `existing`; повтор после промежуточной версии; короткий, `chat-review`, сбой, исчерпан, пустой, `contextScope` → отказ; чужой → 404; в полёте → `not_ready`; досье пригодно для промпта `fast-reply`.

### PR 18 — H-6: глубина 3000

- Необязательный `maxRows` в `listArchiveConversationMessagesForAi` (`message-archive.ts:1543-1569`) и в union (`ai-transcript-union.ts:44-55, 175-205`). Потолок — новая `AI_TRANSCRIPT_DEEP_MAX_ROWS = 3000`, по умолчанию 1500.
- Протянуть параметр через `context/index.ts`, только в двух OF-читателях. Полоса Fansly live union остаётся на 1500.
- **Гейт:** `fan-summary` и `summaryMode ≠ short`, OF, `context-v1` в заголовке, `aiTranscriptDeepMaxRows = 3000` (новый ключ 1500|3000). `chat-review` остаётся на 1500. `limits.deepMax` в bootstrap = значение ключа.
- **До флипа флага** в описание PR: `EXPLAIN (ANALYZE, BUFFERS)` в read-only транзакции на проде для крупнейших OF-чатов (у 7 больше 1500 сообщений) и p95 обоих читателей на 1500 и 3000. Индекс — только если план плохой, и отдельной миграцией.
- Проверка стоимости: полный рекап на 3000 сообщений Opus укладывается в потолок $5 на запрос (`ai-gateway.ts:45`) и в дневной потолок фичи.

Тесты: фикстура на 3000 строк; старый клиент с `messageCount=3000` получает ≤ 1500; Fansly `clientContext` на 3000 без изменений; надгробия и дедупликация до потолка.

### PR 19 — H-10b: Split у черновиков Coach

- `coach-chat` в гейт H-10a. Слот в конец строки Task шаблона `COACH_CHAT_TEMPLATE` (`templates.ts:620-631`, `templates/coach-chat.md`).
- `[NEXT]` — внутри каждого блока ```` ```draft ````; блоков не больше двух. Манифест и эталонные промпты.

### PR 20 — H-9a: общий помощник сводки Ping

- Вынести `features/index.ts:586-609` (`analyzePingSegment` + ограничение `fanSilenceDays`, один и тот же момент времени) в `apps/runtime/src/modules/ai/context/ping-summary.ts`: `computePingSummary(messages, nowMs)`.
- Генерация вызывает помощник; байты и поведение те же.
- Unit на эквивалентность: граница ровно 5 дней; 1 и 3 текстовых сообщения фана при одинаковых датах → `segment-b`/`segment-a`; только метки и только чаевые не считаются; `system`/`unknown` считается фаном, как в генерации.
- Предупредить сессию Sync Engine: та же функция недавно менялась в #352.

### PR 21 — H-9b: постраничный читатель

- `packages/db/src/repositories/conversation-feed.ts`: страница по ключу `(event_time desc nulls last, numeric_ref, ref) < cursor` над архивом и над union.
- CTE union экспортировать из `ai-transcript-union.ts:53-174` без изменения AI-запроса. Тест-снимок текста SQL AI-запроса.
- Надгробия — строками `deleted = true`; заглушки `content_pending` не показываются.
- Границы снимка: `source_account_seq <= snapshotSeq` и `dm_message_archive.id <= snapshotDmId`.

### PR 22 — H-9c: маршрут ленты

- **Маршрут `clientConversationFeed`** (§4.4): только БД. Без OFAPI, read gateway, refresh/backfill/capture и `history_requests`.
- **Источник** — тот же переключатель, что у генерации: `aiTranscriptFreshUnionMode`, на проде `serve` → `union`. `source` в ответе.
- **Курсор** `services/signed-cursor.ts`:
  - ядро HMAC вынести из `agent-read/cursors.ts`; провод агента не менять;
  - домен `agency-hub:client-feed-cursor:v1`; ключи из `config.encryptionKeysByVersion`;
  - связан со страницей, фаном, `userId`, `archive_generation`, `high_seq`, max id `dm_message_archive` и ключом позиции;
  - подделка, чужой курсор или смена поколения → 400 `bad_request`, reason `cursor_invalid`.
- **Сводка** только на первой странице (без курсора): `computePingSummary` по `loadTranscriptContext` с окном `summaryWindow ?? 100` и тем же режимом union (`liveOverlay: "off"`).
- **`newestKnownAt`** = max(голова, `page_dm_threads.last_message_at`). `automatic: null` — такого сигнала в архиве нет.
- **Покрытие** — `services/client-coverage.ts`.
- `SERVED_CLIENT_CAPABILITIES += "archive-feed-v1"`.

**Тесты:**
- **ловушка исходящих:** `vi.stubGlobal("fetch")` и undici `MockAgent.disableNetConnect`;
  - ноль вызовов;
  - нет новых строк в `ofapi_request_attempts`, `ofapi_capture_jobs`, `ofapi_interactive_requests`, `ofapi_commands`, `history_requests`;
  - `page_dm_threads.unread_count` не изменился;
- пустой, частичный и полный архив;
- обход 3000+ сообщений по 100 без дыр и дублей, пока приходят новые сообщения и удаление;
- `off` и `serve` дают голову и сводку из одного источника;
- на одном снимке голова = `servedHead` из `context_v1`.

### PR 23–25 — H-8a/b/c: статистика Spenders и «ждут ответа»

**H-8a.** Чистые функции окон в `packages/shared/src/spender-stats.ts` и SQL в `repositories/spender-stats.ts`.
- **Окна** — даты в переданной IANA-зоне; агрегировать из сырых `transactions` по индексу `transactions_account_active_occurred_idx`: все свёртки датированы в UTC.
- **Gross** уже включает отрицательные возвраты и чарджбэки и все состояния pending/posted/unknown. Поэтому `avgCheck` считается по `purchasesGross`.
- **Тиры** — членство по сумме за всё время (`spender-buckets.ts:14-51`, нижняя граница 10 mills) плюс остатки `untiered` и `unattributed`, так что Σ тиров = итог.
- **Молчание** — по каждому плательщику за всё время, последнее **текстовое** сообщение фана: `message_archive`, `is_sent_by_me=false`, не удалено, не `content_pending`, текст не пустой. Это сознательное отличие от десктопа.
- **Новые плательщики** — `min(fan_spend_daily.business_date)` в окне, плюс `firstPurchaseKnown`.

**H-8b.** Маршрут `clientSpenderStats` (§4.5).
- Кэш 60 с на процесс по ключу (`pageId`, окно, зона, водяной знак проекции), одновременные запросы склеиваются, потолок ~500 записей. Доступ проверяется до кэша.
- Флаг `stats`, возможность `spenders-stats-v1`.
- **Сверка:** при `timeZone=UTC` `totals.d30.gross` = `/api/v2/spenders?period=30d` `diagnostics.totalGrossAmountMills`; Σ тиров = итог; Σ `days.creatorNet` = `pageRevenueDaily` в режиме `custom`, а не `30d` (на OF это 31 дата).

**H-8c.** Маршрут `clientSpenderAwaitingReply` (§4.5).
- Условие: `last_fan_message_at > last_model_message_at`.
- Сортировка (`lifetimeGross desc`, `lastFanMessageAt asc`, `fanId`), подписанный курсор.
- Флаг `stats`, возможность `awaiting-reply-v1`.
- Тест: 1200 плательщиков, обход стабилен, пока меняются переписки.

Перф-гейт: EXPLAIN на запросе молчания (LATERAL). Частичный индекс — только по данным и отдельной миграцией.

### PR 26 — H-7a: таблицы брони и опеки

- **Миграция** (номер при слиянии) — три таблицы из §4.6.4, только добавление строк. Репозиторий `repositories/client-claim.ts` на сыром SQL, по образцу `follower-outreach.ts`: таблица `follower_outreach_attempts` тоже живёт без `schema.ts`, и так меньше конфликтов с Sync.
  - Транзакция под `pg_advisory_xact_lock(hashtextextended('client-fan:'||page||':'||fan, 0))`.
  - Чистая функция переходов `decideClaimTransition(...)` отдельно, для unit-тестов.
  - Ленивое истечение аренды: каждая `claim` переводит истёкшие `active` в `expired`.
  - Опека не истекает никогда.
- **Стирание** (иначе падают тесты-храповики):
  - `fan_ref` трёх таблиц — в `FAN_REF_ERASURE_COLUMNS` (`erasure/index.ts:830`);
  - удаление по фану рядом с ~976-981;
  - удаление по странице рядом с ~1570.
- Тесты: integration репозитория — гонки, повторы, части; `erasure-fan-ref-columns` и `erasure-page-owned-tables`.

### PR 27 — H-7b: маршруты брони и опеки

- **Маршруты** `clientFanClaim` (POST), `clientFanClaimStatus` (GET) и `clientSendCustodyResolve` (сессия owner/team_lead) по §4.6.
- **Флаги:** `newcomers` для `claim`/`renew`/`dispatch(greeting)`, `previewSend` для любого `dispatch`. Статус и `registerNativeSend` работают при выключенном `previewSend`.
- **Атомарная проверка флага.** В транзакции `dispatch` строки `config_settings` ключей `chatExtensionEnabled` и `chatExtensionFeatures` берутся `FOR SHARE`. Изменение владельцем (`FOR UPDATE`/`DELETE`) встаёт в очередь за отправкой. Пока строки нет, действует значение по умолчанию, то есть «выключено». `flagRevision` = `configRevision`.
- **Порядок проверок `dispatch`:**
  1. повтор того же `attemptId` с тем же хешем тела → только чтение без билета; другое тело → `attempt_conflict`;
  2. флаг;
  3. темп: не больше 6 за 60 с на пользователя → 429 `preview_send_rate_limited`;
  4. нет открытой опеки фана → иначе `custody_held`;
  5. для приветствия нет удерживаемой команды десктопа: `ofapi_commands.outreach_purpose = 'new-follower'` в неразрешённом состоянии для `page_id` и `conversation_id = fanRef` → иначе `custody_held`;
  6. для приветствия:
     - если приветствие уже подтверждено — та же генерация и вариант того же владельца, иначе `greeting_done` / `generation_mismatch`;
     - если нет — живая бронь этого (`user`, `instance`, `leaseToken`), иначе `claim_busy` / `claim_expired`;
  7. часть ещё не отправлена → иначе `part_already_sent`;
  8. вставка `dispatching` и одноразовый билет: хаб хранит только sha256, срок 10 с. Билет — маркер для MAIN-мира клиента; хаб его потом не проверяет.
- **Остальные действия:**
  - `sent` — только свой `dispatching`; первая часть приветствия → `client_greetings`;
  - `failed` — только с кодом доказательства непринятия;
  - `registerNativeSend` — идемпотентно по (`page`, `platform_message_id`), чужую опеку не снимает;
  - `resolve` — `insertAuditEvent` `client.send_custody_resolved`.
- **Производное состояние:** `dispatching` с истёкшим билетом показывается как `uncertain-held` и никогда не освобождается само.
- **Держатель брони раскрывается только как** `you-elsewhere` / `someone-else`.
- `instanceId` — UUID установки клиента.
- `SERVED_CLIENT_CAPABILITIES += "preview-send-custody-v1"`.
- Коды — в §3 канона ошибок. `followerOutreachAttempt` и его провод не меняются (OpenAPI-фрагмент побайтно тот же — тест).

**Тесты** — `client-claim.integration`:
- два клиента и две вкладки берут бронь одновременно (`Promise.all`) → владелец ровно один;
- истечение аренды и старое продление → `claim_expired`;
- приветствие без брони → 409; флаг выключен → отказ;
- гонка флага и `dispatch`;
- повтор и конфликт попытки;
- сбой после `dispatch` → `uncertain-held`, остальные видят `custody_held`, истечение брони его не снимает;
- 3 части одного приветствия;
- `registerNativeSend` при выключенном флаге;
- `resolve`: чаттер → 403, тимлид → 200 и строка аудита;
- удерживаемая команда десктопа блокирует.

Регрессии: `follower-outreach`, `ofapi-command-outbox`, `ai-feature-service`.

### PR 28 — H-7c: модель чтения «Новые»

- **Строки** — канонические `domain_events` `subscription.started` и `subscription.renewed` по окну.
- **Классификация `subType`:**

  | subType | Результат |
  |---|---|
  | `new_subscriber` | `new` |
  | `new_subscriber_trial` | `new` + `trial: true` |
  | `returning_subscriber` | `returning` |
  | `customer_award_for_model_top` и неизвестные | исключаются, считаются в `unknownCount` |

  Вида `renewed` нет: OF не шлёт вебхук на автопродление.
- **`subscribedAt`** — `occurred_at` уведомления, `subscribedAtSource: "notification"`. Если обход подписчиков уже подтвердил дату — `subscribeAt`. Устаревший `page_subscriptions.source_created_at` у вернувшихся не использовать.
- **Статус** — `page_subscriptions` и `page_fans` с `asOf`. **Сводка переписки** — `page_dm_threads` по `message_coverage_status`, `message_backfill_complete`, `stored_message_count`; не по полям цепочки Fansly. **Бронь** — из таблиц H-7a.
- **Курсор** HMAC (`services/signed-cursor.ts`):
  - связан с `pageId`, `from`/`to`, `snapshotAt` (фильтр `domain_events.created_at <= snapshotAt`) и ключом позиции (`occurred_at desc`, `id desc`);
  - смена `windowHours` → 400 `cursor_window_mismatch`.
- **Покрытие:** `getWebhookDeliveryHistoryCoverage` (`repositories/ofapi-webhook-recovery.ts:106-116`), ожидающие или упавшие проекции подписок, `lastAudienceSweepAt` из контрольной точки обхода подписчиков.
- `SERVED_CLIENT_CAPABILITIES += "audience-new-v1"`. Новые индексы не нужны: запрос ~2,5 мс на окне 720 ч.

Тесты: окно неподвижно между страницами, пока приходит новое событие; вернувшийся фан; частичное и неизвестное покрытие; Fansly → `client_feature_disabled` (`platform_unsupported`); без доступа → 403; приветственный шаблон есть или `null`.

### PR 29 — H-7d: снимок приветственного шаблона

- `read("welcome_message", "settings/welcome-message", "account_settings", "object", "none", {}, { defaultCollect: true, granularity: "snapshot" })` в `OFAPI_READ_CATALOG`.
- Категория `account_settings` в `OFAPI_COLLECTION_CATEGORIES`, подпись реестра, `OFAPI_SCHEDULED_READ_COLLECTION_CATEGORIES`, `READ_CATEGORIES` раннера.
- H-7c читает последний снимок через `readOfapiStoredSnapshots`.
- **Не через действие владельца `welcome_message_read`:** у него общекластерная блокировка 9003011, и фоновое чтение роняло бы 409 действия самого владельца.
- **Включение** — существующая аудируемая политика сбора OFAPI на каждую пилотную страницу: `scheduled`, 1440 мин, 1 кредит в день. Это флип владельца.

### PR 30 — H-7e: зависшие отправки в кабинете

- `GET /api/v1/pages/:pageLabel/client-send-custody?state=held` и кнопка разбора, вызывающая `clientSendCustodyResolve`. Оба — `{kind:"session", scope:"page"}`, то есть owner и team_lead.
- Страница кабинета: список удерживаемых, кнопки «отправлено» / «не отправлено» с обязательной заметкой.
- Нужен **до** включения X8 (вопрос 4 в §6).

### PR 31 — H-15: свои расходы AI

- Маршрут `clientAiUsageDaily` (§4.7).
- Запрос в `repositories/ai-usage.ts`: `listUserPageDailyUsage(db, { userId, pageId, from, toExclusive })` по образцу `listUserUsageReport` (760-948), индекс `ai_usage_events_user_completed_idx`.
- Всегда фильтр `user_id = principal.user.id`: владелец тоже видит только свои расходы.
- **Покрытие `partial`**, если: день не кончился; есть открытые резервы; есть `costApproximate`.
- Блок `quota` (граница дня UTC) — из `evaluateAiGatewayQuota`. Зона по умолчанию `Europe/Moscow`, как в кабинете.
- Регистрация в `modules/client` (не в `modules/ai/index.ts`). Возможность `ai-usage-v1`.

### PR 32 — H-11b: приём `client_health` без идентификаторов (вариант B′)

- **В `ingestClientObservations`** вид `client_health` уходит в отдельную ветку той же транзакции и **в `observations` не пишется**:
  - проверка по `clientHealthReportV1Schema` и по реестру границ;
  - слияние в почасовые агрегаты по часу **приёма сервером**, ключ без пользователя;
  - дедупликация по `client_health_receipts(client_event_id)`.
- **Неверный отчёт** выбрасывается поштучно с записью в журнал; 400 на всю пачку не бывает. Ответ `{accepted, duplicates}` не меняется.
- **Флаг** `chatExtensionHealthIngestEnabled` (false): событие принимается, считается принятым и не хранится. Bootstrap объявляет `client-health-perf-v1` только при включённом флаге.
- **Узкий токен:** `client_health` в `ingestKinds`.
- **Таблицы:**
  - `client_health_receipts`, `client_health_perf_hourly` (`counts bigint[]` поэлементным сложением, `count`, `sum`, `max`), `client_health_contract_hourly`, `client_health_missing_hourly`, `client_health_counters_hourly`;
  - необязательная `client_health_latest` (`user_id` FK на `users` ON DELETE CASCADE) — по ответу на вопрос 3 в §6;
  - без FK на `pages`, без плановых удалений; запись в `ROLLBACK_COMPATIBLE_MIGRATIONS`.

Тесты: смешанная пачка (`ai_acceptance` + `client_health`) — acceptance по-прежнему в журнале, `client_health` в журнал не пишется; слияние; повтор не считается дважды; неверный отчёт не роняет пачку; флаг выключен → ничего не хранится.

### PR 33 — H-11c: витрина владельцу

- Маршрут `adminClientHealth` (`owner-session`, §4.8). Процентили считаются при чтении из слитых корзин с интерполяцией внутри корзины; для последней корзины — `max`. Группы меньше 20 → `p50/p95 = null`, `suppressed = true`.
- Кабинет: маршрут `dev/client-health` (`App.tsx:81-85`), ссылка в разделе Dev (`Sidebar.tsx:14-22`), хук `api/dev.ts`, страница `ClientHealthPage.tsx`.

### Необязательные

- **H-3b:** `clientProfile` в `ownDeviceItemSchema` и списке устройств владельца; ключ `chatExtensionTokenIssuanceEnabled` (`true`; `false` → выдача с `client` отвечает 403).
- **H-14b:** колонки происхождения отправки в `ai_acceptance_events` — только по просьбе владельца.
- **H-7f:** награда «топ-фан» перестаёт считаться подпиской — только с «да» владельца (вопрос 5).
- **`chore(dev)`:** сид локального хаба без ключей. Создать владельца и чаттера (`pnpm cli user add`), модель, две OF-страницы прямым `createOnlyFansPage` (`pnpm cli page add` требует OFAPI), назначить страницы.

---

## 4. Контракт: точные zod-формы

### 4.0 Правила формы (для всех клиентских маршрутов)

- **Тела и query** — `.strict()`.
- **Объекты ответа** — обычный `z.object` без `.strict()`: старый SDK срежет новый ключ. Новые поля — только необязательные.
- **Растущие словари** — открытая строка `openToken`: причины, флаги, возможности, источники, покрытие, виды. Известные значения клиент берёт из экспортированных констант; неизвестное значение означает «выключено» или «неизвестно».
- **Закрытые `z.enum`** — только состояния автоматов брони и опеки и итоги операций. Новое значение там = новая версия маршрута.
- **Деньги:** платформенные — целые mills (`mills`), AI — целые micro-USD. Время — ISO-строка (`isoTimestamp`).
- **Каждый 2xx объявлен**, иначе SDK бросит `undeclared_status`. Ошибки объявлены везде, где возможны.
- **Импорт** только из `zod`, `./primitives.ts` и вендоренной части `@agency_hub_core/shared` (`types.ts`, `time.ts` и т. д.); не из `./routes.ts`.
- **Как клиент получает типы:**
  - `KernelOperationResponse<"clientBootstrap">`, `KernelOperationRequest<…>` и `routeSchemas.<key>.response[200]` из вендоренного `@kernel/sdk`;
  - отдельные схемы (кадр, отчёт здоровья, константы) — через список реэкспорта `generate-sdk.ts`;
  - до слияния PR клиент держит в фикстурах R01 копию форм из этого раздела, а после перевендоринга тест сверяет копию с SDK.
  - Поддельный хаб собирается на этих же схемах.

### 4.1 Каркас `packages/contracts/src/routes-client.ts` (H-2a)

```ts
import { userRoles } from "@agency_hub_core/shared";
import { z } from "zod";

import { businessDate, errorResponseSchema, intId, isoTimestamp, mills, platformEnum } from "./primitives.ts";

/** Открытая лексема: растущие словари (reason, flag, capability, source, coverage…). */
export const clientOpenToken = z.string().min(1).max(64);
/** Числовой id фана OnlyFans (== chat_id). */
export const clientFanRefSchema = z.string().regex(/^[1-9]\d{0,29}$/);
const pageLabelSchema = z.string().min(1).max(120);
export const clientPageParamsSchema = z.object({ pageLabel: pageLabelSchema });
export const clientPageFanParamsSchema = z.object({ pageLabel: pageLabelSchema, fanRef: clientFanRefSchema });
export const clientCursorSchema = z.string().min(1).max(2048);
const uuid = z.string().uuid();
const count = z.number().int().nonnegative();

/** Известные имена: документация и клиентское сужение. На проводе — открытые строки. */
export const CLIENT_FEATURE_FLAG_NAMES = [
  "insertion", "freshText", "newcomers", "spenders", "stats", "preview", "previewSend",
  "previewSendMarkAiGenerated", "fanPanel", "navigation", "wsTap", "sound",
  "coach", "recap", "review", "splitAll",
] as const;
export const CLIENT_HUB_CAPABILITY_NAMES = [
  "context-v1", "live-text-v1", "split-all-v1", "shared-recaps-v1", "recap-profile-v1",
  "archive-feed-v1", "spenders-stats-v1", "awaiting-reply-v1", "audience-new-v1",
  "preview-send-custody-v1", "client-health-perf-v1", "ai-usage-v1",
] as const;
export const CLIENT_FEATURE_UNAVAILABLE_REASONS = [
  "disabled", "flag_off", "platform_unsupported", "binding_missing", "hub_not_ready", "not_granted",
] as const;
```

### 4.2 Bootstrap (H-2a)

```ts
export const clientFeatureAvailabilitySchema = z.object({
  available: z.boolean(),
  reason: clientOpenToken.optional(),
});

export const clientReceiptProfileSchema = z.object({
  id: z.string().min(1).max(64),
  adapterVersion: z.string().min(1).max(64),
  modules: z.record(z.string().min(1).max(64), z.string().min(1).max(128)), // роль модуля → отпечаток
});

export const clientBootstrapPageSchema = z.object({
  pageId: intId,
  pageLabel: z.string(),
  title: z.string(),
  platform: platformEnum,
  platformAccountId: z.string().nullable(),      // pages.external_page_id; у Fansly бывает null
  bindingRevision: z.number().int().nonnegative(),
  features: z.record(clientOpenToken, clientFeatureAvailabilitySchema),
});

export const clientBootstrapLimitsSchema = z.object({
  freshTextMaxItems: count,          // 60
  freshTextMaxChars: count,          // 5000 на элемент
  feedMax: z.number().int().positive(),            // 100
  deepMax: z.number().int().positive(),            // 1500 → 3000 по aiTranscriptDeepMaxRows
  audienceWindowHours: z.number().int().positive(),// 720
  claimLeaseSec: z.number().int().positive(),      // 120
  claimRenewSec: z.number().int().positive(),      // 40
  claimActivityWindowSec: z.number().int().positive(), // 120
  previewSendPerMinute: count,                     // 6
  navInsertTimeoutSec: z.number().int().positive(),// 20
  dispatchTicketSec: z.number().int().positive(),  // 10
  previewSendReceiptProfiles: z.array(clientReceiptProfileSchema).max(32), // [] = X8 выключен
});

export const clientBootstrapResponseSchema = z.object({
  protocol: z.number().int().positive(),   // сейчас 1; клиент сверяет сам → CG-HUB-OUTDATED
  issuedAt: isoTimestamp,
  ttlSec: z.number().int().positive(),     // 300
  configRevision: count,
  minVersion: z.string().min(1).max(32),
  identity: z.object({
    userId: intId,
    username: z.string(),
    role: z.enum(userRoles),
    tokenClient: clientOpenToken.nullable(), // "chat-extension" у узкого токена (H-3); null = полный
  }),
  pages: z.array(clientBootstrapPageSchema),
  bindingsByHost: z.record(z.string().min(1).max(128), intId), // "onlymonster:36408" → pageId
  flags: z.record(clientOpenToken, z.boolean()),
  limits: clientBootstrapLimitsSchema,
  capabilities: z.array(clientOpenToken).max(64),
});
```

### 4.3 Рекапы (H-13) и досье из генерации (H-5)

```ts
export const clientConversationRecapsQuerySchema = z.object({
  personaDefinitionId: z.string().min(16).max(100).optional(),
}).strict();

export const clientRecapBodySchema = z.object({
  generationRef: z.string().min(1).max(100),
  generatedAt: isoTimestamp,
  personaDefinitionId: z.string().nullable(),
  coverage: z.object({
    transcriptCoverage: clientOpenToken.nullable(),  // full-history | window
    requestedCount: z.number().int().nullable(),
    keptCount: z.number().int().nullable(),
  }),
  text: z.string(),
});

export const clientConversationRecapsResponseSchema = z.object({
  full: clientRecapBodySchema.nullable(),
  short: clientRecapBodySchema.nullable(),
  fullSavedToProfile: z.boolean(),
});

export const clientFanProfileFromGenerationBodySchema = z.object({
  generationRef: z.string().min(1).max(100),       // = meta.requestId
  clientRequestId: uuid.optional(),                // различает «в полёте» и «неизвестно»
}).strict();

export const clientFanProfileFromGenerationResponseSchema = z.object({
  outcome: z.enum(["created", "existing"]),
  profile: z.object({
    version: z.number().int().positive(),
    createdAt: isoTimestamp,
    sourceGeneratedAt: isoTimestamp.nullable(),
  }),
});
```

### 4.4 Лента архива (H-9c)

Строки идут от новых к старым. Сводка — только на первой странице.

```ts
export const clientConversationFeedQuerySchema = z.object({
  cursor: clientCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  summaryWindow: z.coerce.number().int().min(5).max(3000).optional(), // по умолчанию окно Ping (100)
}).strict();

export const clientFeedItemSchema = z.object({
  messageId: z.string(),
  at: isoTimestamp.nullable(),
  sender: clientOpenToken,                 // fan | model | system | unknown
  text: z.string(),
  automatic: z.boolean().nullable(),       // в архиве сигнала нет → null
  deleted: z.boolean(),
  tipMills: mills.nullable(),
  priceMills: mills.nullable(),
  attachmentLabels: z.array(z.string().max(80)).max(50),
});

export const clientConversationFeedResponseSchema = z.object({
  target: z.object({ pageLabel: z.string(), fanRef: z.string() }),
  source: clientOpenToken,                 // archive | union
  snapshotRevision: z.string(),
  asOf: isoTimestamp,
  coverage: clientOpenToken,               // complete | partial | unknown
  head: z.object({ messageRef: z.string(), at: isoTimestamp.nullable(), sender: clientOpenToken }).nullable(),
  newestKnownAt: isoTimestamp.nullable(),
  nextOlderCursor: clientCursorSchema.nullable(),
  items: z.array(clientFeedItemSchema),
  summary: z.object({
    pingSegment: clientOpenToken,          // active | segment-a | segment-b | unknown
    fanSilenceDays: count.nullable(),
    window: z.object({ requested: count, served: count }),
    coverage: clientOpenToken,
    asOf: isoTimestamp,
  }).nullable(),
});
```

### 4.5 Spenders (H-8b/c)

```ts
export const clientSpenderStatsQuerySchema = z.object({
  windowDays: z.coerce.number().int().min(30).max(30).default(30), // v1: только 30
  timeZone: z.string().min(1).max(64),                             // IANA, проверка через Intl
}).strict();

const clientMoneyWindowSchema = z.object({
  grossMills: mills, purchasesGrossMills: mills, adjustmentsMills: mills, creatorNetMills: mills,
  purchaseCount: count, payerCount: count,
});

export const clientSpenderStatsResponseSchema = z.object({
  pageLabel: z.string(),
  metricVersion: z.number().int().positive(),
  moneyUnit: z.literal("USD-mills"),
  basis: z.literal("gross"),
  timeZone: z.string(),
  from: z.string(), to: z.string(),        // местные даты YYYY-MM-DD
  asOf: isoTimestamp,
  projectionAsOf: isoTimestamp.nullable(),
  includedStates: z.array(clientOpenToken),
  coverage: z.object({ state: clientOpenToken, reasons: z.array(clientOpenToken) }),
  days: z.array(z.object({
    date: z.string(), grossMills: mills, purchasesGrossMills: mills, adjustmentsMills: mills,
    creatorNetMills: mills, purchaseCount: count, byState: z.record(clientOpenToken, mills),
  })),
  totals: z.object({
    today: clientMoneyWindowSchema, d7: clientMoneyWindowSchema,
    prev7: clientMoneyWindowSchema, d30: clientMoneyWindowSchema,
    d7DeltaPct: z.number().nullable(),     // null при prev7 = 0
  }),
  avgCheckMills: mills.nullable(),
  tiers: z.array(z.object({
    key: clientOpenToken, label: z.string(), minMills: mills.nullable(), maxMills: mills.nullable(),
    members: count, windowPayers: count, windowGrossMills: mills,
  })),
  silence: z.object({
    d8to21: z.object({ fans: count, lifetimeGrossMills: mills }),
    over21: z.object({ fans: count, lifetimeGrossMills: mills }),
    unknown: z.object({ fans: count, lifetimeGrossMills: mills }),
  }),
  newPayers: z.object({ count, firstPurchaseKnown: z.boolean() }),
  queueSummary: z.object({ total: count, unknown: count }),
});

export const clientSpenderAwaitingReplyQuerySchema = z.object({
  cursor: clientCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

export const clientSpenderAwaitingReplyResponseSchema = z.object({
  items: z.array(z.object({
    fanRef: z.string(), username: z.string().nullable(), displayName: z.string().nullable(),
    lifetimeGrossMills: mills, lastFanMessageAt: isoTimestamp, lastModelMessageAt: isoTimestamp.nullable(),
    unreadCount: count.nullable(), readState: clientOpenToken, // unread | read | unknown
  })),
  total: count, loaded: count, unknown: count,
  nextCursor: clientCursorSchema.nullable(),
  asOf: isoTimestamp,
});
```

### 4.6 «Новые», бронь, опека (H-7b/c/e)

**4.6.1 Бронь и опека.**

```ts
export const clientClaimGroupSchema = z.object({
  generationRef: z.string().min(1).max(100),
  variant: z.number().int().min(0).max(2),
  partCount: z.number().int().min(1).max(10),
}).strict();
const partIndex = z.number().int().min(0).max(9);         // < partCount — проверка на сервере, 400
const purpose = z.enum(["greeting", "preview-reply"]);
const ofMessageId = z.string().regex(/^[0-9]{1,30}$/);

export const clientFanClaimBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim"), leaseToken: uuid, instanceId: uuid }).strict(),
  z.object({ action: z.literal("renew"), leaseToken: uuid, instanceId: uuid }).strict(),
  z.object({ action: z.literal("release"), leaseToken: uuid, instanceId: uuid }).strict(),
  z.object({
    action: z.literal("dispatch"), attemptId: uuid, instanceId: uuid, purpose,
    group: clientClaimGroupSchema, partIndex, textRevision: count,
    leaseToken: uuid.optional(),                           // обязателен для приветствия до подтверждения
    flagRevision: count,
  }).strict(),
  z.object({ action: z.literal("sent"), attemptId: uuid, platformMessageId: ofMessageId,
    evidence: z.literal("receipt+echo") }).strict(),
  z.object({ action: z.literal("failed"), attemptId: uuid,
    reason: z.enum(["not_enqueued", "native_rejected"]),
    httpStatus: z.number().int().min(100).max(599).optional() }).strict(),
  z.object({ action: z.literal("registerNativeSend"), attemptId: uuid, instanceId: uuid, purpose,
    group: clientClaimGroupSchema, partIndex, platformMessageId: ofMessageId }).strict(),
]);

export const clientFanClaimResponseSchema = z.object({
  greeting: z.object({
    state: z.enum(["none", "confirmed"]),
    at: isoTimestamp.nullable(), messageRef: z.string().nullable(),
    source: clientOpenToken.nullable(),                    // preview-send | native-register | resolve
  }),
  lease: z.object({
    state: z.enum(["none", "owned", "held", "expired", "released"]),
    leaseToken: z.string().nullable(), expiresAt: isoTimestamp.nullable(),
    heldBy: z.enum(["you-elsewhere", "someone-else"]).nullable(),
  }),
  group: z.object({
    generationRef: z.string(), variant: count, partCount: z.number().int().positive(),
    sentParts: z.array(count), heldParts: z.array(count),
  }).nullable(),
  custody: z.object({
    attemptId: z.string(),
    state: z.enum(["dispatching", "sent", "failed", "uncertain-held", "resolved-sent", "resolved-not-sent"]),
    ticket: z.string().nullable(),                         // только в ответе на первый dispatch
    ticketExpiresAt: isoTimestamp.nullable(),
  }).nullable(),
  serverNow: isoTimestamp,
  flagRevision: count,                                     // = configRevision
});
```

Если `z.discriminatedUnion` в теле плохо ложится в OpenAPI, запасной вариант — один строгий объект с `action: z.enum([...])`, необязательными полями и `superRefine`. Прецедент тела-союза есть: `verifyCredentialsBodySchema`.

**4.6.2 «Новые».**

```ts
export const clientAudienceNewQuerySchema = z.object({
  windowHours: z.coerce.number().int().min(1).max(720).default(48),
  cursor: clientCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

export const clientClaimSummarySchema = z.object({
  greeting: z.enum(["none", "confirmed"]),
  lease: z.enum(["none", "owned", "held", "expired", "released"]),
  heldBy: z.enum(["you-elsewhere", "someone-else"]).nullable(),
  custody: z.enum(["dispatching", "sent", "failed", "uncertain-held", "resolved-sent", "resolved-not-sent"]).nullable(),
});

export const clientAudienceNewItemSchema = z.object({
  eventRef: z.string(),                    // domain_events.id — стабильный ключ для звука
  fanRef: z.string(),
  username: z.string().nullable(), displayName: z.string().nullable(),
  kind: clientOpenToken,                   // new | returning ("renewed" зарезервирован)
  trial: z.boolean(),
  subscribedAt: isoTimestamp,
  subscribedAtSource: clientOpenToken,     // subscribeAt | notification
  status: z.object({
    isSubscriber: z.boolean().nullable(),
    subscriptionStatus: clientOpenToken,   // active | expired | unknown
    endsAt: isoTimestamp.nullable(), asOf: isoTimestamp.nullable(),
    source: clientOpenToken,               // sweep | webhook | none
  }),
  thread: z.object({
    lastMessageAt: isoTimestamp.nullable(), lastFanMessageAt: isoTimestamp.nullable(),
    lastModelMessageAt: isoTimestamp.nullable(), storedMessageCount: count,
    coverage: clientOpenToken, backfillComplete: z.boolean(),
  }).nullable(),
  claim: clientClaimSummarySchema,
});

export const clientAudienceNewResponseSchema = z.object({
  pageLabel: z.string(),
  window: z.object({ hours: z.number().int().positive(), from: isoTimestamp, to: isoTimestamp, snapshotAt: isoTimestamp }),
  serverNow: isoTimestamp,
  coverage: z.object({
    state: clientOpenToken,                // complete | partial | unknown
    deliveryFrontier: isoTimestamp.nullable(),
    lastAudienceSweepAt: isoTimestamp.nullable(),
    reasons: z.array(clientOpenToken),
  }),
  unknownCount: count,
  welcomeTemplate: z.object({
    ref: z.string(), observedAt: isoTimestamp, enabled: z.boolean().nullable(),
    hasText: z.boolean(), hasMedia: z.boolean(), priceMills: mills.nullable(),
  }).nullable(),
  items: z.array(clientAudienceNewItemSchema),
  nextCursor: clientCursorSchema.nullable(),
});
```

**4.6.3 Разбор в кабинете (H-7b маршрут разбора, H-7e список).**

```ts
export const clientSendCustodyParamsSchema = z.object({ pageLabel: pageLabelSchema, attemptId: uuid });
export const clientSendCustodyResolveBodySchema = z.object({
  outcome: z.enum(["sent", "not_sent"]),
  platformMessageId: ofMessageId.optional(),
  note: z.string().trim().min(1).max(500),
}).strict();
export const clientSendCustodyItemSchema = z.object({
  attemptId: z.string(), fanRef: z.string(), userId: intId, purpose: clientOpenToken,
  state: clientOpenToken, generationRef: z.string(), partIndex: count, partCount: z.number().int().positive(),
  createdAt: isoTimestamp, ticketExpiresAt: isoTimestamp.nullable(),
});
export const clientSendCustodyListQuerySchema = z.object({ state: z.enum(["held", "all"]).default("held") }).strict();
export const clientSendCustodyListResponseSchema = z.object({ items: z.array(clientSendCustodyItemSchema) });
```

**4.6.4 Таблицы H-7a** (сырой SQL; номер миграции — при слиянии).

```sql
create table client_fan_leases (
  lease_id uuid primary key, page_id bigint not null references pages(id),
  fan_ref text not null check (fan_ref ~ '^[1-9][0-9]{0,29}$'),
  user_id bigint not null references users(id), instance_id uuid not null,
  state text not null check (state in ('active','released','expired')),
  expires_at timestamptz not null, renew_count int not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create unique index client_fan_leases_active on client_fan_leases(page_id, fan_ref) where state = 'active';

create table client_greetings (
  page_id bigint not null references pages(id), fan_ref text not null,
  owner_user_id bigint references users(id), generation_ref text, variant smallint,
  part_count smallint check (part_count between 1 and 10),
  confirmed_at timestamptz not null, first_message_ref text, first_attempt_id uuid,
  source text not null check (source in ('preview-send','native-register','resolve')),
  primary key (page_id, fan_ref));

create table client_send_custody (
  attempt_id uuid primary key, page_id bigint not null references pages(id),
  fan_ref text not null check (fan_ref ~ '^[1-9][0-9]{0,29}$'),
  user_id bigint not null references users(id), instance_id uuid not null,
  purpose text not null check (purpose in ('greeting','preview-reply')),
  origin text not null check (origin in ('preview-send','native-register')),
  generation_ref text not null, variant smallint not null, part_count smallint not null,
  part_index smallint not null, text_revision int not null, request_hash bytea not null,
  lease_id uuid references client_fan_leases(lease_id), flag_revision int,
  state text not null check (state in ('dispatching','sent','failed','resolved_sent','resolved_not_sent')),
  ticket_hash bytea, ticket_expires_at timestamptz,
  platform_message_id text check (platform_message_id ~ '^[0-9]{1,30}$'),
  failure_reason text check (failure_reason in ('not_enqueued','native_rejected')),
  failure_http_status smallint, resolved_by_user_id bigint references users(id),
  resolved_at timestamptz, resolution_note text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (part_index >= 0 and part_index < part_count),
  check (origin = 'native-register' or ticket_hash is not null));
create unique index client_send_custody_one_open on client_send_custody(page_id, fan_ref) where state = 'dispatching';
create unique index client_send_custody_part_once on client_send_custody(page_id, fan_ref, generation_ref, variant, part_index)
  where state in ('dispatching','sent','resolved_sent');
create unique index client_send_custody_message on client_send_custody(page_id, platform_message_id) where platform_message_id is not null;
create index client_send_custody_rate on client_send_custody(user_id, created_at) where origin = 'preview-send';
```

`page_id` ссылается на `pages`. Поэтому три таблицы обязательно регистрируются в стирании: по фану и по странице.

### 4.7 Расходы AI (H-15)

```ts
export const clientAiUsageQuerySchema = z.object({
  date: businessDate,                                   // последний день диапазона
  days: z.coerce.number().int().min(1).max(7).default(1),
  timeZone: z.string().min(1).max(64).default("Europe/Moscow"),
}).strict();

const clientAiUsageTotalsSchema = z.object({
  requestCount: count, costMicroUsd: count, costApproximate: z.boolean(),
  tokens: z.object({ input: count, output: count, cacheWrite: count, cacheRead: count }),
  completed: count, failed: count, cancelled: count, quotaDenied: count,
  openReservations: count, regenerations: count,
});

export const clientAiUsageResponseSchema = z.object({
  scope: z.object({ pageLabel: z.string(), userId: intId }),
  timeZone: z.string(),
  asOf: isoTimestamp,
  moneyUnit: z.literal("micro-USD"),
  days: z.array(z.object({
    date: z.string(), from: isoTimestamp, toExclusive: isoTimestamp,
    coverage: clientOpenToken,                         // complete | partial
    coverageReasons: z.array(clientOpenToken),         // day_open | open_reservations | approximate_cost
    totals: clientAiUsageTotalsSchema,
    features: z.array(clientAiUsageTotalsSchema.extend({ feature: clientOpenToken })),
  })),
  quota: z.object({
    dayBoundary: z.literal("UTC"),
    remainingRequestsToday: count.nullable(),
    remainingMicroUsdToday: count.nullable(),
  }).nullable(),
});
```

Отказ (400): дата из будущего или старше 8 дней.

### 4.8 `client_health` (H-11a) и витрина (H-11c)

Имена метрик и границы — предложение; замораживает их R01.

```ts
const healthCode = z.string().regex(/^[A-Za-z0-9._:-]{1,80}$/);  // без свободного текста

export const CLIENT_HEALTH_PERF_METRICS = {
  routeToDockMs:      { unit: "ms", schemaVersion: 1, bounds: [1, 2, 4, 8, 16, 32, 50, 75, 100, 150, 250, 500, 1000] },
  panelOpenMs:        { unit: "ms", schemaVersion: 1, bounds: [4, 8, 16, 32, 50, 75, 100, 150, 250, 500, 1000, 2500] },
  requestOverheadMs:  { unit: "ms", schemaVersion: 1, bounds: [1, 2, 4, 8, 16, 32, 50, 100, 250, 500] },
  firstChunkPaintMs:  { unit: "ms", schemaVersion: 1, bounds: [4, 8, 16, 32, 50, 75, 100, 150, 250, 500] },
  insertMs:           { unit: "ms", schemaVersion: 1, bounds: [4, 8, 16, 32, 50, 75, 100, 150, 250, 500, 1000] },
  boardOpenMs:        { unit: "ms", schemaVersion: 1, bounds: [8, 16, 32, 50, 75, 100, 150, 250, 500, 1000, 2500] },
  handlerMs:          { unit: "ms", schemaVersion: 1, bounds: [0.1, 0.5, 1, 2, 4, 8, 16, 50, 100] },
  composerInputDelayMs:{ unit: "ms", schemaVersion: 1, bounds: [1, 2, 4, 8, 16, 32, 50, 100, 250] },
} as const;

export const clientHealthPerfHistogramSchema = z.object({
  metric: clientOpenToken, unit: z.literal("ms"), schemaVersion: z.number().int().positive(),
  bounds: z.array(z.number().nonnegative()).min(1).max(32),
  counts: z.array(count).min(2).max(33),
  count, sum: z.number().nonnegative(), max: z.number().nonnegative(),
}).strict().superRefine((h, ctx) => {
  if (h.counts.length !== h.bounds.length + 1) ctx.addIssue({ code: "custom", message: "counts = bounds + 1" });
  if (h.counts.reduce((a, b) => a + b, 0) !== h.count) ctx.addIssue({ code: "custom", message: "count = Σcounts" });
  for (let i = 1; i < h.bounds.length; i += 1) if (!(h.bounds[i]! > h.bounds[i - 1]!)) ctx.addIssue({ code: "custom", message: "bounds increasing" });
});

export const clientHealthReportV1Schema = z.object({
  v: z.literal(1),
  window: z.object({ from: isoTimestamp, to: isoTimestamp }).strict(),
  client: z.object({
    name: z.literal("chat-extension"), version: z.string().min(1).max(32),
    browser: z.literal("firefox"), browserMajor: z.number().int().positive(),
    os: z.enum(["windows", "macos", "linux", "other"]),
  }).strict(),
  host: z.object({
    kind: clientOpenToken, build: z.string().max(80).nullable(),
    contractOk: z.boolean(), missing: z.array(healthCode).max(64),
  }).strict(),
  disabled: z.array(healthCode).max(64),
  perf: z.array(clientHealthPerfHistogramSchema).max(16),
  counters: z.record(healthCode, z.number().int().min(0).max(1_000_000))
    .refine((r) => Object.keys(r).length <= 200),
  footprint: z.object({ kind: z.literal("owned-estimate"), cachesKB: count, logsKB: count }).strict(),
}).strict();

// H-11c: GET /api/v1/admin/client-health?from&to&clientName&metric  (owner-session)
export const adminClientHealthQuerySchema = z.object({
  from: businessDate, to: businessDate,
  clientName: clientOpenToken.optional(), metric: clientOpenToken.optional(),
}).strict();
export const adminClientHealthResponseSchema = z.object({
  range: z.object({ from: z.string(), to: z.string(), timeZone: z.string() }),
  minGroupSize: z.number().int().positive(),            // 20
  perf: z.array(z.object({
    clientName: z.string(), clientVersion: z.string(), hostKind: z.string(), hostBuild: z.string().nullable(),
    metric: z.string(), schemaVersion: z.number().int(), count, mean: z.number().nullable(),
    max: z.number().nullable(), p50: z.number().nullable(), p95: z.number().nullable(), suppressed: z.boolean(),
  })),
  contract: z.array(z.object({
    clientVersion: z.string(), hostBuild: z.string().nullable(), reports: count, failedReports: count,
    missing: z.array(z.object({ anchor: z.string(), reports: count })),
  })),
  counters: z.array(z.object({ code: z.string(), total: count })),
  footprint: z.array(z.object({ clientVersion: z.string(), cachesKBp95: z.number().nullable(), logsKBp95: z.number().nullable() })),
  latest: z.array(z.object({
    userId: intId, username: z.string(), clientVersion: z.string(), hostBuild: z.string().nullable(),
    contractOk: z.boolean(), missing: z.array(z.string()), disabled: z.array(z.string()), reportedAt: isoTimestamp,
  })).optional(),                                         // по ответу на вопрос 3
  asOf: isoTimestamp,
});
```

Отчёт `client_health` отправляется только при возможности `client-health-perf-v1` в bootstrap и отдельной пачкой.

### 4.9 Записи `clientRouteSchemas`

Ответы ошибок: стандарт — `400, 401, 403, 404` с `errorResponseSchema`; где указано — ещё 409/429.

| Ключ | Метод и путь | auth | 200 | Ещё | PR |
|---|---|---|---|---|---|
| `clientBootstrap` | GET `/api/v1/client/bootstrap` | `{kind:"apiKey"}` | `clientBootstrapResponseSchema` | 401, 403 | H-2a |
| `clientConversationRecaps` | GET `/api/v1/client/pages/:pageLabel/conversations/:fanRef/recaps` | `{kind:"apiKey", scope:"page"}` | recaps | 409 | H-13 |
| `clientFanProfileFromGeneration` | POST `/api/v1/client/pages/:pageLabel/fans/:fanRef/profile/from-generation` | apiKey + page | from-generation | 409 | H-5 |
| `clientConversationFeed` | GET `/api/v1/client/pages/:pageLabel/conversations/:fanRef/feed` | apiKey + page | feed | 409 | H-9c |
| `clientSpenderStats` | GET `/api/v1/client/pages/:pageLabel/spenders/stats` | apiKey + page | stats | 409 | H-8b |
| `clientSpenderAwaitingReply` | GET `/api/v1/client/pages/:pageLabel/spenders/awaiting-reply` | apiKey + page | awaiting | 409 | H-8c |
| `clientFanClaim` | POST `/api/v1/client/pages/:pageLabel/fans/:fanRef/claim` | apiKey + page | claim | 409, 429 | H-7b |
| `clientFanClaimStatus` | GET тот же путь | apiKey + page | claim (без билета) | 409 | H-7b |
| `clientSendCustodyResolve` | POST `/api/v1/pages/:pageLabel/client-send-custody/:attemptId/resolve` | `{kind:"session", scope:"page"}` | `clientSendCustodyItemSchema` | 409 | H-7b |
| `clientSendCustodyList` | GET `/api/v1/pages/:pageLabel/client-send-custody` | `{kind:"session", scope:"page"}` | list | — | H-7e |
| `clientAudienceNew` | GET `/api/v1/client/pages/:pageLabel/audience-new` | apiKey + page | audience-new | 409 | H-7c |
| `clientAiUsageDaily` | GET `/api/v1/client/pages/:pageLabel/ai-usage` | apiKey + page | ai-usage | 409 | H-15 |
| `adminClientHealth` | GET `/api/v1/admin/client-health` | `{kind:"owner-session"}` | admin view | — | H-11c |

`tags: ["client"]` (`["admin"]` у `adminClientHealth`). Все page-scoped ключи добавляются в закреплённый список `tests/contracts-auth-declarations.test.ts`.

### 4.10 Изменения существующих контрактов

**4.10.1 Health (H-1b), `routes.ts:376-387`.**
```ts
compatibleClientSdks: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(64).optional(),
// capabilities: z.array(z.literal("desktop-lifecycle-v2"))  — НЕ ТРОГАТЬ
```

**4.10.2 Выдача токена (H-3), `routes.ts:298-311`.**
```ts
export const authIssueDeviceTokenWithPasswordBodySchema = z.object({
  username: …, password: …, label: …, mode: deviceTokenIssueModeEnum,
  client: z.enum(["chat-extension"]).optional(),
}).superRefine((v, ctx) => {
  if (v.client !== undefined && v.mode !== "active") ctx.addIssue({ code: "custom", path: ["client"], message: "client requires mode active" });
});
export const authIssueDeviceTokenWithPasswordResponseSchema = z.discriminatedUnion("mode", [
  issuedDeviceTokenResponseSchema.extend({ mode: z.literal("active"), client: z.string().min(1).max(64).nullable().optional() }),
  reservedDeviceTokenResponseSchema.extend({ mode: z.literal("pending") }),
]);
```
Тело сейчас нестрогое: старый хаб молча выбросит `client`. Отсюда правило эха для клиента (PR 9).

**4.10.3 AI (H-4b/H-4c), `routes.ts`.**
```ts
export const AI_LIVE_TEXT_MAX_ITEMS = 60;
export const AI_LIVE_TEXT_MAX_CHARS = 5_000;
const aiOfMessageIdSchema = z.string().regex(/^[1-9]\d{0,29}$/);

export const aiLiveTextContextSchema = z.object({           // H-4c
  capturedAt: isoTimestamp,
  items: z.array(z.object({
    platformMessageId: aiOfMessageIdSchema,                 // только подтверждённые, не isFromQueue
    direction: z.enum(["fan", "model"]),
    occurredAt: isoTimestamp,
    text: z.string().min(1).max(AI_LIVE_TEXT_MAX_CHARS),    // сообщения только с медиа не передаются
  }).strict()).min(1).max(AI_LIVE_TEXT_MAX_ITEMS),
}).strict();

// в aiFeatureStreamBodySchema (2103-2192):
knownFanMessageId: aiOfMessageIdSchema.optional(),          // H-4b
liveTextContext: aiLiveTextContextSchema.optional(),        // H-4c

const aiContextHeadSchema = z.object({ messageRef: z.string(), occurredAt: isoTimestamp.nullable(), isFromFan: z.boolean() });
export const aiFeatureContextFrameSchema = z.object({       // H-4b; нестрогий — будущие ключи безопасны
  type: z.literal("context_v1"),
  generationRef: z.string().uuid(),                         // = meta.requestId
  source: z.string().min(1).max(64),                        // archive | union | live_union
  servedHead: aiContextHeadSchema.nullable(),
  archiveHead: aiContextHeadSchema.nullable().optional(),   // диагностика
  window: z.object({ requested: z.number().int().nonnegative(), served: z.number().int().nonnegative() }),
  coverage: z.string().min(1).max(64),                      // complete | partial | unknown
  knownFanMessage: z.object({ id: z.string(), state: z.string().min(1).max(64) }).optional(), // included|absent|deleted|unknown
  live: z.object({
    status: z.string().min(1).max(64),                      // not_sent | disabled | shadow | served | rejected
    accepted: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
  }),
  fanLanguageEvidence: z.string().min(1).max(64).optional(),// latin | cyrillic | mixed | unknown
});
export const aiFeatureStreamFrameSchema = z.union([
  aiGatewayStreamFrameSchema, aiFeatureDebugInputFrameSchema, aiFeatureContextFrameSchema,
]);
export type AiFeatureContextFrame = z.infer<typeof aiFeatureContextFrameSchema>;
```
`aiFeatureContextFrameSchema` объявляется в `routes.ts`, а не в `routes-client.ts`, потому что `aiFeatureStreamFrameSchema` живёт там же. Хеш меняют только поля тела; кадр в OpenAPI не попадает.

**4.10.4 SDK и профиль токена.**
```ts
// sdk-runtime.ts (H-4a)
export const AI_STREAM_CAPABILITIES = ["debug-input-v1", "context-v1", "split-all-v1"] as const;
export type AiStreamCapability = (typeof AI_STREAM_CAPABILITIES)[number];
// streamAiFeature(options, { feature, body, onFrame, debugPromptEcho?, capabilities?: readonly AiStreamCapability[], signal? })

// packages/contracts/src/client-token-scopes.ts (H-3)
import type { KernelOperationKey } from "./sdk-runtime.ts";
export const CLIENT_TOKEN_PROFILES = {
  "chat-extension": {
    operations: [
      "authRevokeCurrentDeviceToken", "me", "clientBootstrap",
      "aiPersonaCatalog", "aiFeatureStream", "aiRecapStatus",
      "pageConversationProfile", "pageFanProfile",
      "spenders", "spenderDetail", "spenderBatch", "pageSpenderAutoLists",
      "ingestObservations",
      // + каждый следующий клиентский PR: clientConversationRecaps, clientFanProfileFromGeneration,
      //   clientConversationFeed, clientSpenderStats, clientSpenderAwaitingReply, clientFanClaim,
      //   clientFanClaimStatus, clientAudienceNew, clientAiUsageDaily
    ] as const satisfies readonly KernelOperationKey[],
    ingestKinds: ["ai_acceptance"] as const,  // + "client_health" в H-11b
  },
} as const;
export type ClientTokenProfile = keyof typeof CLIENT_TOKEN_PROFILES;
```
Публичные `health` и `authIssueDeviceTokenWithPassword` проходят без принципала и в список не входят.
Не входят никогда: `/ofapi/*`, `events*` (5 ключей), `aiPersonasList/Upsert/Archive`, `aiGatewayStream`, `followerOutreachAttempt`, `pageTopSpenders`, сессионные маршруты, `clientSendCustodyResolve/List`.
`pageSpenderAutoListDetail` пока не входит; добавим, если он понадобится интерфейсу тиров.

### 4.11 Новые коды ошибок

| Код | HTTP | Где | Смысл | Код CG (предложение для H-12b) |
|---|---|---|---|---|
| `client_feature_disabled` + `reason` | 409 | все клиентские маршруты, AI узкого токена | функция выключена владельцем или недоступна (`disabled`, `flag_off`, `platform_unsupported`, `binding_missing`, `hub_not_ready`) | CG-FEATURE-DISABLED; `binding_missing` → CG-BINDING-MISSING |
| `context_conflict` | 400 | AI, свежий текст | другое направление или id из чужого чата | CG-CONTEXT-CONFLICT |
| `bad_request` + `live_text_not_allowed` / `capability_required` | 400 | AI | свежий текст на неподходящей фиче или странице; нет `context-v1` | CG-HUB-REQUEST |
| `bad_request` + `cursor_invalid` / `cursor_window_mismatch` | 400 | лента, ждут ответа, «Новые» | курсор подделан, чужой или устарел | повтор с первой страницы, без тоста |
| `generation_not_ready` | 409 | H-5 | запись генерации ещё не появилась | повтор 3× (1/2/4 с), затем CG-HUB-UNAVAILABLE |
| `generation_not_eligible` + `reason` | 409 | H-5 | не полный, исчерпан, пустой, `contextScope` | CG-HUB-REQUEST |
| `claim_busy` | 409 | H-7b | бронь у другого экземпляра или человека | CG-CLAIM-BUSY |
| `claim_expired` | 409 | H-7b | аренда истекла | CG-CLAIM-EXPIRED |
| `custody_held` | 409 | H-7b | у фана неразрешённая отправка (в том числе десктопа) | CG-SEND-UNCERTAIN |
| `greeting_done` | 409 | H-7b | фан уже поприветствован | CG-CLAIM-BUSY (подкод) |
| `part_already_sent` | 409 | H-7b | часть уже отправлена | — (только чтение) |
| `generation_mismatch` | 409 | H-7b | другая генерация или вариант | CG-CONTEXT-CHANGED |
| `attempt_conflict` | 409 | H-7b | тот же `attemptId` с другим телом | CG-HUB-REQUEST |
| `custody_not_owned` | 409 | H-7b | `sent`/`failed` по чужой попытке | CG-HUB-REQUEST |
| `preview_send_rate_limited` | 429 | H-7b | больше 6 в минуту | CG-HUB-RATE-LIMIT |

Все коды записываются в `docs/error-handling.md` §3 в PR, который их вводит. Колонку CG окончательно заполняет H-12b.

### 4.12 Флаги, возможности и проверка на сервере

| Флаг (`chatExtensionFeatures`) | Нужная возможность | Платформы в пилоте | Сервер проверяет |
|---|---|---|---|
| `insertion`, `navigation`, `wsTap`, `sound`, `fanPanel`, `previewSendMarkAiGenerated` | — | onlyfans | только клиент: серверного действия нет |
| `spenders` | — | onlyfans | только клиент: существующие чтения `/api/v2/spenders` не меняем |
| `freshText` | `live-text-v1` | onlyfans | H-4c: игнор свежего текста и `live.status="disabled"` |
| `splitAll` | `split-all-v1` | onlyfans | H-10: без флага Split не включается |
| `recap` | `shared-recaps-v1`, `recap-profile-v1` | onlyfans | H-13, H-5, AI `fan-summary` (узкий токен) |
| `review`, `coach` | — | onlyfans | AI `chat-review` / `coach-chat` (узкий токен) |
| `preview` | `archive-feed-v1` | onlyfans | H-9c |
| `stats` | `spenders-stats-v1`, `awaiting-reply-v1` | onlyfans | H-8b, H-8c |
| `newcomers` | `audience-new-v1`, `preview-send-custody-v1` | onlyfans | H-7c, H-7b (бронь и приветствие) |
| `previewSend` | `preview-send-custody-v1` | onlyfans | H-7b `dispatch`, атомарно |

Мастер `chatExtensionEnabled=false` выключает всё. Bootstrap и при нём отвечает 200 со всеми функциями `disabled`.

Возможности, которые идут только в заголовке AI: `debug-input-v1`, `context-v1`, `split-all-v1`. Остальные объявляются только в bootstrap.

---

## 5. Поправки к architecture.md (и hub-integration-plan.md) по коду 90b642e9

1. **Факты устарели.**
   - Прод уже не `85392728` с хешем `14e160e3`: прод — `44b05ad5`, хеш `1378e7ee…`; `main` = `1e7277ea`.
   - Номера строк:
     - `routes.ts:373-384` → `376-387` (литерал на :380);
     - `aiFeatureStreamBodySchema` `2103-2196` → `2103-2192`;
     - кадры `1884-1935` → `1883-1934` (debug-кадр на :1831);
     - согласование возможностей (план §2) `1906-1912` → `1928-1934`;
     - `authorization-policy.md:186-190` → `192-196`, строка `/api/v2/spenders` → `296`;
     - гейт десктопа `assert-release-sdk-vendor.mjs:50-64` (вызов из `windows-build.yml:60/137/321`), Fansly `deploy.sh:300-333`;
     - corepack в CI хаба: setup-node `ci.yml:153-157`, pnpm `166-179`.
2. **§8.1.** `streamAiFeature` — имя помощника SDK, ключ маршрута — `aiFeatureStream`. «Поток событий» — это 5 ключей: `eventsStream`, `eventsSnapshot`, `eventsV2Stream`/`Snapshot`/`Facts`. Порядок `routes.ts:6611,6723,6736,6764` = `pageSpenderAutoLists`, `spenders`, `spenderDetail`, `spenderBatch`; три последних — `any` без области страницы, её навязывает обработчик.
3. **§8.3, форма bootstrap.**
   - `flags`, `features` и `capabilities` на проводе — открытые строки. В zod 4.3.6 `z.record(z.enum)`, `partialRecord` и `z.array(z.enum)` отвергают незнакомые ключи — та же ловушка, что `health.capabilities`.
   - `platformAccountId: string | null`.
   - `protocol` — число, проверяет клиент.
   - `identity.username` вместо `login`, плюс `identity.tokenClient`.
   - Ключи `bindingsByHost` — `onlymonster:<accountId>`.
   - `freshTextMax` разделён на `freshTextMaxItems` и `freshTextMaxChars`.
   - Список возможностей длиннее: добавлены `live-text-v1`, `recap-profile-v1`, `awaiting-reply-v1`, `ai-usage-v1`.
   - Хаб проверяет флаги только на новых маршрутах и AI. Флаг `spenders` и чисто клиентские флаги сервер не проверяет.
4. **§8.4.**
   - В SDK нужна опция `capabilities`: это H-4a, без смены хеша.
   - Значение `source: 'live-overlay'` занято в хабе: это Fansly socket-оверлей, `live_union`. В кадре `source` — читатель хаба (`archive` | `union` | `live_union`), а клиентский текст описывает отдельный блок `live`.
   - `liveTextContext` требует заголовок `context-v1`. При выключенном флаге текст игнорируется с `live.status = "disabled"`, а не отказом 400.
   - `contextScope` — ключ JSONB `params`, миграция не нужна. Но `featureParams` сейчас пишется только для `fan-summary` (`features/index.ts:924-944`), его нужно обобщить.
5. **§8.5.**
   - Пороги тиров лежат в `packages/shared/src/spender-buckets.ts:14-51` (`routes.ts:80-87` — только перечисление).
   - `ping-segment.ts`: константы `:8-12`, `analyzePingSegment` `:27-57`.
   - Лента обязана идти тем же переключателем `aiTranscriptFreshUnionMode`, что генерация. На проде `serve` → источник `union`.
6. **§8.6, H-0.** #383 закрывает **все** device-токены, включая токены тимлида и владельца. Старые `PUT`/`DELETE` отвечают сессии владельца 409. Статус — Draft и конфликтует.
7. **H-1.**
   - `compatibleClientSdks` делаем необязательным.
   - Реестр — на стороне хаба, плюс защита выкладки.
   - Регистрировать сейчас нужно один хеш `b95b765c`: по проду в парке только десктоп 0.1.64 и Fansly 2.7.1.
   - Порядок для клиента: регистрация SDK отдельным PR → набор зелёный → выкладка хаба → выпуск клиента.
8. **H-3.**
   - Список разрешённых — по ключам маршрутов. В токене хранится **имя** профиля, а не список операций: иначе каждый новый маршрут требовал бы перевыпуска токенов.
   - 403 без `reason` уже обеспечивает `ForbiddenError`.
   - Хаб без H-3 выдаст полный токен — эхо обязательно.
   - Охрана работает всегда, а не только в режиме `enforce`.
9. **H-5.** Запись генерации всегда появляется **после** `done` (`ai/index.ts:401-409` → `441-447`). «Не готово» может остаться навсегда — повторы ограничены. `generationRef` = `meta.requestId`.
10. **H-6.** Потолки 1500 живут в репозиториях (`message-archive.ts:1544/1557`, `ai-transcript-union.ts:45/54`). Глубина 3000 — только для полного Recap; `chat-review` остаётся на 1500. `requestedCount` в `params` сейчас пишет необрезанное значение; честное число — `keptCount`.
11. **H-7.**
    - В вебхуках нет `subscribeAt` (0 из 310 за 30 дней) → дата уведомления и `subscribedAtSource`.
    - Вида `renewed` нет: OF не шлёт вебхук на автопродление, `subscriptions.renewed` — это вернувшиеся. Виды — `new`/`returning` плюс `trial`.
    - `customer_award_for_model_top` нужно исключать.
    - Шаблон приветствия — через каталог сбора OFAPI, а не через действие `welcome_message_read` (общая блокировка действий владельца).
    - `resolve` — отдельный сессионный маршрут.
    - Состояния опеки дополнены `resolved-sent` / `resolved-not-sent`.
    - Путь — `packages/db/src/repositories/follower-outreach.ts:4-47`.
    - Опека десктопа не видит опеку расширения. Проверка односторонняя, плюс операционное правило «на пилотных страницах десктоп не приветствует».
12. **H-8.**
    - Сходимость с `pageRevenueDaily` — только в режиме `custom` + чистая сумма + UTC: эта ручка сессионная, отдаёт net, а `30d` на OF = 31 дата.
    - `avgCheck` — по `purchasesGross`.
    - Молчание «только текст» сознательно отличается от десктопа, где считались любые сообщения.
    - `pageConversationPreview` отдаёт чаевые в **центах**, не в mills.
13. **H-9.** Покрытие OF — `ofapi_message_coverage`, а не `page_dm_threads.history_state`. `automatic` — nullable. Удалённые показываются с флагом. `pageConversationPreview/Messages` остаются только для сессии.
14. **H-10.** Таблиц политик две (`feature-policies.ts` и `builder.ts:183-193`). Правки шаблонов закреплены в `prompt-manifest.json`. Проверка структуры — только запись.
15. **H-11 и §9.6.** «Вид в `INGEST_KIND_ALLOWLIST`» и «идентификаторы отбрасываются до агрегации» несовместимы: журнал `observations` хранит полезную нагрузку и пользователя вечно и уносит её в lake. Предлагаем B′ (вопрос 3). Следствие для M1: базовый `client_health` клиент копит у себя и не шлёт, пока bootstrap не объявит `client-health-perf-v1`.
16. **H-12.**
    - В §3 канона колонок клиентов нет; меняются §1/§2/§5.
    - Скрипты вендоринга ни к какому клиенту не привязаны — правятся только комментарии и README.
    - Fansly уже пишется как `desktop@chatgoose-extension/<v>`.
    - Вид остаётся `desktop.<kind>` для всех клиентов.
17. **H-13.** Маршрут открывает чаттерам текст рекапов: это расширение правила «ограниченные записи — только владельцу» (`ai-restricted.ts:7-9`). Опирается на §19 п. 1 и записывается в матрицу прав.
18. **H-14.** Идемпотентность — по паре (пользователь, `clientEventId`). Проекция дедуплицирует отдельно по (`generation_ref`, `lifecycle`, `occurred_at`). `edited` учитывается только на `sent`. Путь — `projections/ai-acceptance.ts:60-99`.
19. **H-15.** `pageLabel` должен быть в пути (`/client/pages/:pageLabel/ai-usage`): область страницы по query не работает (`server.ts:343`). У хаба две границы дня: квота — UTC, отчёты — Москва. Нужен параметр `days` 1–7 (DB-022).
20. **§13 и выкладка.**
    - Слияние в `main` образ не публикует: образ собирается на сервере при ручной выкладке.
    - Но выкладки Sync Engine идут часто, и любое слитое изменение уезжает с ближайшей.
    - Отсюда правило «каждый PR инертен при слиянии».
21. **Тестовый чат.** Фан 518588958 в аккаунте OM 36408 — это собственная страница агентства `lora-of` (id 8) в роли фана. Код хаба особо обрабатывает ссылки, равные собственному внешнему id страницы (`ofapi-ppv-ref-repair.ts:133-146`). Привязка никогда не должна сопоставлять фана со страницей.
22. **Привязка OM.** Со стороны хаба сверено: страница 8 `lora-of` → 518588958 (loravie), страница 9 `lora-vip-of` → 514788334 (loravievip); `metadata.onlyfansUserId` совпадает. Осталось один раз посмотреть `platform_account_id` аккаунтов OM 36408/36409 в кэше `["accounts"]` в dev-профиле Firefox. Ожидание: 36408 → 514788334, 36409 → 518588958.

---

## 6. Открытые вопросы владельцу

1. **Слияние = выкладка.** Sync Engine выкатывает `main` часто, и любой слитый наш PR уедет в прод с их ближайшей выкладкой. Варианты:
   - **(а) рекомендуем:** ваше «да» перед слиянием каждой пачки (A…G) — по сути это и есть «да» на выкладку;
   - (б) инертные PR (флаги выключены) сливаем сами, а ваше «да» нужно только на наши выкладки и на включение флагов.
2. **#383 (H-0).** Ветка чужой сессии. Доводим её мы (ребейз, Ready, после вашего «да» — слияние и выкладка, затем вы проверяете правку персон в кабинете) или ждём ту сессию?
3. **Замеры `client_health` (H-11).**
   - **Где хранить:** B′ — только почасовые агрегаты без пользователей, сырые отчёты не хранятся, удаления по расписанию не нужны (**рекомендуем**); A — сырые отчёты навсегда в журнале; B — сырые 14 дней с удалением по расписанию, что противоречит правилу хаба «не удалять собранное».
   - **Показывать ли в витрине «у кого какая версия или сломан контракт» по именам чаттеров** (как отчёт по токенам устройств)? Или только обезличенные группы от 20 наблюдений?
4. **Разбор зависших отправок X8 (H-7e).** Нужна ли страница в кабинете для тимлида до включения X8 (**рекомендуем**)? Или для пилота хватит разбора только владельцем? Без отправки из превью зависших не бывает.
5. **Награда «топ-фан» считается подпиской (H-7f).** Сейчас хаб показывает таких фанов действующими подписчиками в десктопе и кабинете. «Новые» их исключат и без этого. Чинить ли сам хаб? Изменится то, что видят старые клиенты.
6. **ST-108 (уже ждёт вашего ответа).** Полки Spenders = корзины хаба. Если нужны списки OF как у десктопа — это отдельная работа вне плана.
7. **X8 после выпусков ChatSpace (§19 п. 6).** Хабу всё равно, какой вариант вы выберете: он хранит список проверенных профилей. Спросим, когда дойдём до X8, как вы просили.
8. **Подтвердите: «рекапы общие» (§19 п. 1) включает текст рекапа.** Другой чаттер той же страницы видит полный текст рекапа коллеги. Это ослабляет нынешнее правило «ограниченные записи — только владельцу». Рекомендуем «да».
9. **Можно не решать сейчас:** переписать подпись записей Fansly с `desktop@chatgoose-extension/…` на `chatgoose-extension@…`? Это меняет происхождение данных уже работающего клиента. Рекомендуем не трогать.

---

## 7. Процесс

**Где и как работаем.**
- Каждый PR — в своём worktree хаба (`git -C ~/code/1-platform/hub worktree add …`) на ветке `client/<slug>`. Основной checkout хаба не трогаем.
- После слияния удаляем чистые worktree и ветки — локально и на origin.
- Перед массовым запуском агентов объявляем масштаб.
- Хаб: Node 22 и pnpm 10.33.1 через corepack, как в CI хаба. Node 26 нужен только расширению.
- Замороженные бандлы SDK — обычный ES2022, они работают на Node 22.

**Локальные проверки до Ready.**
- `pnpm check`: проверка строгости, eslint, unit (~6 300), сборка кабинета. На Mac — несколько минут.
- Integration только с Docker (Testcontainers, postgres:16, шаблонная БД на файл): `npx vitest run --no-file-parallelism tests/<свои>.integration.test.ts tests/client-sdk-compat.integration.test.ts` плюс регрессии из брифа.
- Весь `pnpm test:sync-critical` на Mac идёт 15–25 мин — только перед большими PR.
- `ALLOW_MISSING_TEST_PREREQUISITES=1` пропускает тесты БД только локально.
- После изменения контракта — `pnpm contracts:generate` и проверка `git status`: CI падает на устаревших файлах (`ci.yml:202-222`).

**CI хаба.**
- Пул `CI_POOL=pc`, 6 шардов.
- **Draft:** только отпечаток и красный Quality Gate — ожидаемо.
- **Ready:** полный прогон ~4 мин (статика ~155 с, integration 6 шардов).
- Ready один раз; зелёный CI без причины не перезапускаем; `[skip ci]` нельзя никогда.
- Метка `ci:full` нужна, только если пул переведён на GitHub.
- После squash-слияния push в `main` берёт готовое доказательство по отпечатку дерева.
- Правки `docs/error-handling.md` запускают полный CI. Планы в `docs/plans/…` — нет.
- Обязательная проверка — только Quality Gate. Ветка может отставать от `main`, но текстовых конфликтов быть не должно.
- Если джоба ждёт раннер дольше 10 минут — `ci-pool status`, сообщить владельцу.

**Как не мешать Sync Engine.**
1. Новый код — в новых файлах (`routes-client.ts`, `modules/client/*`, `services/client-*`, `context/live-text.ts`, `repositories/client-*`). В `routes.ts` и `server.ts` — по 1–2 строки.
2. Сгенерированные файлы при ребейзе только пересобираем.
3. Номер миграции — при последнем ребейзе. Таблицы — на сыром SQL, где это позволяет прецедент, чтобы не трогать `schema.ts`.
4. Ключи конфига — одним блоком в конце реестра.
5. `features/index.ts`, `context/index.ts`, `ai-transcript-union.ts`, `message-archive.ts` — минимальные правки, по одному PR. Перед слиянием предупредить сессию Sync (через владельца): #352 и #399 недавно меняли эти места.
6. Не опираться на поля цепочки Fansly в `page_dm_threads` (`history_state`, `chain_*`, `head_confirmed_*`) и не называть ничего «live overlay».
7. Ребейз прямо перед Ready, слияние сразу после зелёного.
8. Не выкатывать посреди их шагов развёртывания (step 3b): сверяться с открытыми Sync-PR (#407–#411).
9. Один интегратор по очереди сливает общие места: `routes-client.ts`, закреплённый список маршрутов с областью страницы, `CLIENT_TOKEN_PROFILES`, реестр конфига, номера миграций.

**Что нужно для выкладки.**
1. «Да» владельца на пачку.
2. Чистый checkout, совпадающий с актуальным `origin/main`. Проверить вручную: защита от устаревшего checkout (#255) ещё не слита.
3. `scripts/deploy-production.sh root@45.8.230.111 --verify-url https://gosling-agency.ru`. Миграции идут при старте. Автоматический откат — только если схема не менялась. Миграции из пачки должны быть в `ROLLBACK_COMPATIBLE_MIGRATIONS`.
4. После выкладки проверить:
   - `/api/v1/health`: новый `contractHash`, `compatibleClientSdks` содержит `b95b765c…`, `capabilities` не изменились;
   - тестовым токеном — bootstrap (всё выключено);
   - для H-0 — 403 на персоны и сырой шлюз, а владелец правит персону в кабинете.
5. Флаги включает владелец в кабинете — каждое включение попадает в аудит. Для каждого флага — своё «да».
   - Сначала `chatExtensionEnabled` и `chatExtensionFeatures` только для `lora-of` и `lora-vip-of`.
   - `aiLiveTextContextMode`: `shadow` → `serve` после сверки id на тестовом чате. *(Сделано 2026-10-08: в `shadow` прислано 2, совпало 2, конфликтов 0; затем `serve` — решение X20.)*
   - `aiTranscriptDeepMaxRows` — после EXPLAIN.
   - Сбор приветственного шаблона — политикой сбора OFAPI.
   - `previewSend` — только после гейтов X8 и вашего решения по п. 7.
6. Вендоринг в chat-extension: `node scripts/vendor-sdk.mjs <каталог SDK в chat-extension>` из **чистого** checkout выложенного коммита. Для разработки допустим слитый `main`, для выпуска — только выложенный. Хоткеи: `node scripts/vendor-hotkeys.mjs <каталог>` из `a667c62b`.
7. Перед каждым выпуском расширения: PR регистрации его SDK (`test(compat): register chat-extension SDK <hash12>`) → набор зелёный → выкладка хаба с этим реестром → выпуск XPI. Гейт `tools/release`: хеш ∈ `compatibleClientSdks` прода **и** строка есть в реестре на `origin/main`.

**Живые проверки (X9).**
- Только Firefox dev-профиль через `orca computer`; только тестовый чат: OM 36408 → чат 518588958.
- Нужны после пачки B: вход узким токеном, bootstrap, сверка привязки по кэшу `["accounts"]`.
- После пачки C: свежий текст, проверка id.
- Чужие чаты не открываем, новые вкладки ChatSpace без нужды не открываем.

**Журнал решений.** Хаб журнал решений не ведёт. Межрепозиторные решения из этого плана записываются в `chat-extension/docs/decisions.md`, а при касании старых клиентов — и в их журналы, со ссылкой на PR хаба.