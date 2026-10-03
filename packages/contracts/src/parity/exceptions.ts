// The parity exceptions registry (architecture.md §16 R01, parity-map.md):
// every checklist row whose outcome is «не нужно» or «убрано владельцем» is
// listed under exactly one exception, and each exception names the negative
// check R02 runs to prove the removed function did not come back. The parity
// manifest points those rows at the exception id (tools/parity).
//
// No imports: the parity gate runs under plain Node, which loads this file
// directly.

/** Row outcomes that need an exception instead of an implementation. */
export const PARITY_EXCEPTION_VERDICTS = ['не нужно', 'убрано владельцем'] as const;
export type ParityExceptionVerdict = (typeof PARITY_EXCEPTION_VERDICTS)[number];

/** How the negative check runs: a unit test, an e2e scenario on the stand, or a static gate. */
export type NegativeCheckKind = 'unit' | 'e2e' | 'gate';

export interface ParityException {
  /** Negative check id; manifest rows reference it. */
  readonly id: `NEG-${string}`;
  readonly verdict: ParityExceptionVerdict;
  /** Where the decision comes from (owner answers Б…, checklist reasons, plan sections). */
  readonly source: string;
  readonly reason: string;
  readonly check: { readonly kind: NegativeCheckKind; readonly proves: string };
  /** Checklist row ids this exception covers. */
  readonly rows: readonly string[];
}

export const PARITY_EXCEPTIONS: readonly ParityException[] = [
  // ── Removed by the owner ──
  {
    id: 'NEG-HELP',
    verdict: 'убрано владельцем',
    source: 'Б3',
    reason: 'Help убран: одна функция с двумя разными ответами в старых клиентах.',
    check: { kind: 'e2e', proves: 'Help нет: нет фичи help и кнопки; ⌘⇧H / Ctrl+Alt+H в чате гасится и показывает «Help пока убран».' },
    rows: ['AI-101', 'AI-102', 'HK-007'],
  },
  {
    id: 'NEG-INSERT-ALL',
    verdict: 'убрано владельцем',
    source: 'Б7',
    reason: 'Части вставляются и отправляются по одной; в ChatSpace цепочек нет, общий черновик ушёл бы одним сообщением с буквальным разделителем.',
    check: { kind: 'unit', proves: 'Нет действия «Вставить все», ⌘0 не назначен, цепочки отправки частей нет.' },
    rows: ['UI-028', 'HK-043', 'CS-025'],
  },
  {
    id: 'NEG-MESSAGE-GUARD',
    verdict: 'убрано владельцем',
    source: 'Б10',
    reason: 'Своего Message Guard нет; отказ Message Guard ChatSpace приходит как CG-SEND-GUARD.',
    check: { kind: 'unit', proves: 'В реестре нет кодов CG-GUARD-*, в настройках, логах и черновике нет своего Message Guard.' },
    rows: ['ER-082', 'LG-019', 'RB-029', 'CS-027'],
  },
  {
    id: 'NEG-PPV-PRICE-CONFIRM',
    verdict: 'убрано владельцем',
    source: 'Б11',
    reason: 'PPV и vault отправляет ChatSpace; своей кнопки подтверждения цены нет.',
    check: { kind: 'e2e', proves: 'Отправку PPV ChatSpace мы не перехватываем и не блокируем.' },
    rows: ['VA-008'],
  },
  {
    id: 'NEG-HUB-SPEND-FOR-CHATTER',
    verdict: 'убрано владельцем',
    source: 'Б15',
    reason: 'Расход хаба по страницам чаттеру не показываем; деньги AI — только в отладке.',
    check: { kind: 'unit', proves: 'Вне режима отладки нет ни одной суммы расхода хаба или AI.' },
    rows: ['DB-024'],
  },
  {
    id: 'NEG-LOCAL-HARVEST',
    verdict: 'убрано владельцем',
    source: 'Б16',
    reason: 'Жатвы локальных данных старых клиентов в хаб нет.',
    check: { kind: 'gate', proves: 'В фасаде хаба нет маршрутов выгрузки локальных данных (harvest).' },
    rows: ['TL-015'],
  },

  // ── Not needed in the new client ──
  {
    id: 'NEG-COMPARE',
    verdict: 'не нужно',
    source: 'чек-лист: убран по просьбе владельца',
    reason: 'Compare / Multi убраны ещё в старых клиентах.',
    check: { kind: 'unit', proves: 'Нет фичи compare/multi и её кода ошибки.' },
    rows: ['AI-149', 'ER-037'],
  },
  {
    id: 'NEG-HUB-OWNS-AI',
    verdict: 'не нужно',
    source: 'X4; Б1; чек-лист',
    reason: 'Модель, рассуждение, кэш промпта, сборка контекста и учёт расхода — у хаба; тона по умолчанию нет (Б1).',
    check: { kind: 'unit', proves: 'В схеме настроек нет тона по умолчанию, модели, reasoning и кэша промпта; клиент не собирает транскрипт и usage.' },
    rows: ['AI-098', 'ST-098', 'ST-099', 'ST-100', 'TL-014', 'RU-003'],
  },
  {
    id: 'NEG-OFAPI',
    verdict: 'не нужно',
    source: 'план §3.3, §3.7, §3.8; X3',
    reason: 'Своих чтений OnlyFans API нет: ни платных обновлений, ни кредитов, ни отчётов о медиа; данные — из хаба.',
    check: { kind: 'gate', proves: 'Ни одного обращения к OFAPI и маршрутам /ofapi хаба; нет кредитов, платных обновлений и кодов CG-OFAPI-*.' },
    rows: ['SP-025', 'SP-057', 'NF-040', 'SN-024', 'PU-019', 'ST-103', 'ST-105', 'ER-019', 'ER-079', 'DB-023', 'TL-016', 'TL-017', 'RB-026'],
  },
  {
    id: 'NEG-NO-OWN-SEND',
    verdict: 'не нужно',
    source: 'X3, X8',
    reason: 'Расширение само не отправляет: outbox, команд хаба и своих отправок нет; отправка из превью — клик человека через очередь ChatSpace.',
    check: { kind: 'e2e', proves: 'В сетевом журнале стенда нет наших отправок; outbox и команд хаба (send, like, mark-read, typing) нет.' },
    rows: ['PU-020', 'DB-025', 'CS-018', 'CS-023', 'ER-080', 'ER-081', 'TL-018'],
  },
  {
    id: 'NEG-NO-READ-MARK',
    verdict: 'не нужно',
    source: 'AGENTS.md; §6.7.12',
    reason: 'Расширение никогда не читает и не помечает чаты прочитанными.',
    check: { kind: 'e2e', proves: 'Просмотр превью и генерация оставляют чат непрочитанным; настройки авточтения нет.' },
    rows: ['ST-102', 'CS-020'],
  },
  {
    id: 'NEG-NO-SYNC',
    verdict: 'не нужно',
    source: 'план §3.8',
    reason: 'Синхронизации и потока событий хаба в расширении нет: список чатов живой у ChatSpace.',
    check: { kind: 'unit', proves: 'В настройках нет ключей синка, фасад хаба не открывает поток событий SSE v2, сверки списков нет.' },
    rows: ['PU-018', 'PU-021', 'ST-104', 'ST-112', 'HB-009', 'CS-007', 'CS-013'],
  },
  {
    id: 'NEG-NO-LOCAL-ARCHIVE',
    verdict: 'не нужно',
    source: 'чек-лист; §9.4',
    reason: 'Локальной базы переписки нет: данные чата даёт ChatSpace, архив — хаб.',
    check: { kind: 'unit', proves: 'Хранилища расширения — только ключи STORAGE_KEYS с пределами §9.4, без переписки.' },
    rows: ['HB-010', 'RB-027'],
  },
  {
    id: 'NEG-ELECTRON',
    verdict: 'не нужно',
    source: 'чек-лист: Electron',
    reason: 'Окно, процесс, меню, бейджи, масштаб и обновления десктопа — дело Electron; у расширения их даёт браузер.',
    check: { kind: 'unit', proves: 'Нет настроек масштаба и обновлений, нет меню приложения и бейджа; манифест без лишних прав.' },
    rows: ['SN-023', 'HK-044', 'ST-107', 'ST-111', 'ER-024', 'DB-030', 'RB-028', 'UP-017', 'UP-018', 'CS-004', 'CS-039'],
  },
  {
    id: 'NEG-CHATSPACE-UI',
    verdict: 'не нужно',
    source: 'чек-лист; Б9',
    reason: 'Список чатов, рейл аккаунтов, плейсхолдер поля и ленту ведёт ChatSpace; в его строки не встраиваемся.',
    check: { kind: 'e2e', proves: 'Наши точки монтирования — только док у поля ввода и свои окна; строки списка, рейл и плейсхолдер ChatSpace не меняются.' },
    rows: ['UI-034', 'HK-040', 'ST-080', 'ST-106', 'I18-008', 'CS-002', 'CS-011', 'RU-004'],
  },
  {
    id: 'NEG-LEGACY',
    verdict: 'не нужно',
    source: 'чек-лист: легаси старых клиентов',
    reason: 'Миграций, ключей, экранов и мёртвого кода старых клиентов в новом клиенте нет.',
    check: { kind: 'unit', proves: 'Хранилище начинается со схемы v1 и не читает данные старых клиентов; старого откатного кода нет.' },
    rows: ['AI-103', 'SP-005', 'HK-035', 'ST-066', 'ST-138', 'AU-020', 'DB-021', 'CS-026'],
  },
  {
    id: 'NEG-OLD-CODES',
    verdict: 'не нужно',
    source: 'приложение А; error-handling.md §3',
    reason: 'Старые номера кодов не переиспользуются; хаб больше не выдаёт password_change_required.',
    check: { kind: 'unit', proves: 'Все коды — CG-<ОБЛАСТЬ>-<ИМЯ> без номеров; кода смены пароля нет.' },
    rows: ['ER-069', 'ER-083', 'ER-084'],
  },
  {
    id: 'NEG-SIGNIN-MODEL',
    verdict: 'не нужно',
    source: 'план §4',
    reason: 'Вход по модели Fansly-расширения: без журнала резервации; выход всегда стирает вход локально.',
    check: { kind: 'unit', proves: 'Вход без двухшагового журнала; отдельного «Забыть локально» нет.' },
    rows: ['AU-003', 'ST-059'],
  },
  {
    id: 'NEG-MANUAL-BINDING',
    verdict: 'не нужно',
    source: 'план §3.2',
    reason: 'Привязку аккаунта к странице задаёт хаб.',
    check: { kind: 'unit', proves: 'Привязка — только по platform_account_id из bootstrap; ручной привязки в настройках нет.' },
    rows: ['ST-081'],
  },
  {
    id: 'NEG-EXTRA-HUB-READS',
    verdict: 'не нужно',
    source: 'чек-лист',
    reason: 'Скрытая проба voice — лишний запрос к хабу.',
    check: { kind: 'unit', proves: 'Popup делает только разрешённые чтения хаба, скрытой пробы нет.' },
    rows: ['PU-015'],
  },
];
