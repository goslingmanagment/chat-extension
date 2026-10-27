// The chatter's log as a person reads it (2026-10-21, «Скачать лог»): one line per record, by time, in Russian —
//
//   14:30:12 ChatSpace чат 74001001 · док · Hi — недоступно: это уже диалог, здесь нужен Reply (CG-GATE-HI)
//   14:30:15 ChatSpace чат 74001001 · нажато Hi (док, клик) → отказ: Hi недоступен (CG-GATE-HI)
//
// and the configuration snapshots as blocks. Every record of the file is a line here: the ones this file has no
// words for are said with their scope, message and machine fields as they are. The texts are the records' own —
// codes, states, ids and the sentences of our catalog the person was shown (`say`); nothing else is added.

import { HOST_TITLES } from '@cg/contracts/hosts';
import { type LogRecord } from '@cg/contracts/logs';

const SITES: Readonly<Record<string, string>> = HOST_TITLES;

const FEATURES: Readonly<Record<string, string>> = {
  reply: 'Reply', fix: 'Fix', hi: 'Hi', ping: 'Ping', review: 'Review', recap: 'Recap', 'recap-short': 'Recap коротко', coach: 'Coach', help: 'Help',
  spenders: 'Spenders', newcomers: '«Новые»', tone: 'Тон', split: 'Split', dock: 'док целиком', page: 'страница (владелец)', insert: 'вставка в поле',
  'insert-part': '«Вставить»', 'fix-replace': '«Заменить мой черновик»', again: '«Ещё раз»', view: 'окно', 'open-chat': '«Открыть чат»',
  'send-draft': '«Отправить» своего текста', send: '«Отправить»', 'open-insert': '«Открыть и вставить»', claim: 'бронь фана', media: 'медиа',
  row: 'строка', 'card:generate': 'карточка: «Сгенерировать»', 'card:send': 'карточка: «Отправить»', 'card:insert': 'карточка: «Открыть и вставить»',
  pass: 'проверка списка', batch: 'пакет', waiting: '«Ждут ответа»', statistics: 'статистика', button: 'кнопка', read: 'чтение', save: 'сохранение',
  fill: '«Дополнить из чата»', entry: 'вход', start: '«Старт»', run: 'загрузка', checkpoint: 'точка восстановления', notes: '«Заметки»', vault: 'загрузчик vault',
};

const SURFACES: Readonly<Record<string, string>> = {
  dock: 'док', preview: 'превью', 'preview:spenders': 'превью Spenders', 'preview:newcomers': 'превью «Новых»', 'preview:palette': 'превью «Онлайн»',
  spenders: 'Spenders', newcomers: '«Новые»', palette: 'палитра', 'quick-jump': 'быстрый переход', coach: 'Coach', 'fan-panel': 'панель фана',
  'result-expanded': '«Развернуть»', cheatsheet: 'шпаргалка клавиш', toasts: 'тост', page: 'страница сайта', popup: 'попап', options: 'настройки',
  notes: '«Заметки»', vault: 'загрузчик vault', launcher: 'кнопка сайта', none: '—',
};

const INPUTS: Readonly<Record<string, string>> = { click: 'клик', key: 'клавиша', command: 'из попапа', none: 'без клика' };

const ACTIONS: Readonly<Record<string, string>> = {
  Regenerate: '«Ещё раз»', CancelGeneration: '«Отменить»', HideResult: '«Скрыть»', ExpandResult: '«Развернуть»', SetTone: 'тон', SetSplit: 'Split', SetRecap: '«с Recap»', InsertPart: '«Вставить»',
  ReplaceMyDraft: '«Заменить мой черновик»', RestoreMyDraft: '«Вернуть мой текст»', AnswerConfirm: 'ответ на вопрос о черновике', OpenAndInsertPart: '«Открыть и вставить»',
  SendPart: '«Отправить»', EditPart: 'правка части', SendDraft: '«Отправить» своего текста', OpenChatToVerify: '«Открыть чат для проверки»', Copy: '«Копировать»',
  OpenPreview: 'превью фана', RefreshArchive: '«Обновить» архив', LoadOlder: 'более ранние сообщения', SetPreviewDraft: 'черновик превью',
  ShowRecap: 'показ Recap', RefreshRecap: '«Обновить» Recap', NewCoachDialog: '«Новый диалог» Coach', SetCoachDepth: '«Сколько читает» Coach', ShowAnalysis: 'показ анализа',
  SetSpendersPeriod: 'период Spenders', SetSpendersFilter: 'фильтр Spenders', SetSpendersSort: 'сортировка Spenders', ResetFilters: '«Сбросить фильтры»',
  Search: 'поиск', SetNewcomersTab: 'вкладка «Новых»', SetNewcomersFilter: 'фильтр «Новых»', SetNewcomersCheckFilter: 'фильтр проверки «Новых»',
  SetNewcomersPassRunning: 'пауза/продолжение проверки', CheckNewcomerNext: '«Проверить следующим»', ExcludeNewcomer: 'исключение из очереди',
  SendNewcomerGreeting: '«Отправить» приветствие', InsertNewcomerGreeting: '«Открыть и вставить» приветствие', GreetNewcomer: '«Hi» из напоминания', SetNewcomersWindow: 'окно «Новых»',
  LoadMore: '«Ещё»', SetBatchPick: 'отметка фанов', GenerateBatch: '«Сгенерировать для N»', StopBatch: '«Остановить» пакет', ClearBatch: '«Очистить» пакет',
  SetOutreach: 'настройка рассылки', SendOutreach: '«Отправить» рассылки', SetOutreachMedia: '«Для всей рассылки»', ClearOutreachMedia: '«Убрать» медиа рассылки',
  RenewClaim: 'продление брони', ReleaseClaim: 'снятие брони', DismissToast: 'закрытие тоста', Navigate: 'переход', OpenSettings: 'настройки',
  SetPreference: 'настройка', ChoosePersona: 'выбор персоны', SignIn: 'вход', SignOut: 'выход', RecheckStatus: '«Обновить статус»', ReloadView: '«Повторить»',
  ReloadTab: 'перезагрузка вкладки', ReloadSurface: 'перезагрузка панели', CopyReport: '«Скопировать отчёт»', ExportDiagnostics: '«Выгрузить диагностику»',
  DownloadLog: '«Скачать лог»', ClearLocalData: '«Очистить локальные данные»', ResetSendFuse: '«Сбросить предохранитель»', TestSound: 'проверка звука',
  RequestPermission: 'запрос разрешения', SaveJournal: 'сохранение журнала',
};

const OUTCOMES: Readonly<Record<string, string>> = { done: 'сделано', started: 'запущено', opened: 'открыто', noop: 'без изменений', queued: 'в очереди', failed: 'не получилось' };

const OP_STATES: Readonly<Record<string, string>> = { done: 'готово', failed: 'ошибка', canceled: 'отменено', interrupted: 'прервано' };

function word(map: Readonly<Record<string, string>>, value: unknown): string {
  return typeof value === 'string' ? (map[value] ?? value) : '?';
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : typeof value === 'number' ? String(value) : null;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local time of a record, `HH:MM:SS`; its local day, `YYYY-MM-DD`. */
export function localTime(ts: string): { readonly day: string; readonly time: string } {
  const at = new Date(Date.parse(ts));
  if (!Number.isFinite(at.getTime())) return { day: '????-??-??', time: '??:??:??' };
  return { day: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`, time: `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}` };
}

/** «ChatSpace чат 74001001», «Fansly», «фон». */
function where(record: LogRecord): string {
  const chat = record.ctx?.chatKey;
  const siteOf = chat?.split(':')[0] ?? record.ctx?.site ?? null;
  const site = siteOf === null ? (record.scope.startsWith('bg.') ? 'фон' : record.scope.startsWith('page.') ? 'страница расширения' : '') : (SITES[siteOf] ?? siteOf);
  const fan = chat?.split(':')[2];
  return fan === undefined ? site : `${site} чат ${fan}`;
}

function because(fields: Readonly<Record<string, unknown>>, code: string | undefined): string {
  const say = str(fields['say']);
  const why = str(fields['why']);
  const the = code ?? str(fields['code']);
  const tail = the === null ? '' : ` (${the})`;
  return `${say ?? why ?? 'причина не названа'}${tail}`;
}

/** « · фан 5001» — unless it is the chat the line already names. */
function fanTail(fields: Readonly<Record<string, unknown>>, record?: LogRecord): string {
  const fan = str(fields['fanId']);
  if (fan === null || record?.ctx?.chatKey?.endsWith(`:${fan}`) === true) return '';
  return ` · фан ${fan}`;
}

function actionName(fields: Readonly<Record<string, unknown>>): string {
  const type = str(fields['action']) ?? '?';
  if (type === 'Generate') return word(FEATURES, fields['feature']);
  if (type === 'Navigate') {
    const to = str(fields['toKind']);
    if (to === 'surface') return `${fields['open'] === false ? 'закрыть' : 'открыть'} ${word(SURFACES, fields['surface'])}`;
    if (to === 'chat') return 'открыть чат';
    if (to === 'chat-step') return fields['direction'] === 'previous' ? 'предыдущий чат' : 'следующий чат';
    if (to === 'next-unread') return 'следующий непрочитанный';
    if (to === 'chat-slot') return `чат №${str(fields['slot']) ?? '?'}`;
    if (to === 'account') return 'к вкладке аккаунта';
    return `переход: ${to ?? '?'}`;
  }
  if (type === 'SetPreference') return `настройка ${str(fields['prefKey']) ?? '?'} = ${str(fields['choice']) ?? String(fields['choice'])}`;
  const name = ACTIONS[type] ?? type;
  const part = typeof fields['part'] === 'number' ? ` часть ${String(fields['part'] + 1)}` : '';
  return `${name}${part}`;
}

function actionLine(record: LogRecord, fields: Readonly<Record<string, unknown>>): string {
  if (record.msg === 'pressed while off') return `нажато «${str(fields['control']) ?? '?'}» (${word(SURFACES, fields['via'])}, ${word(INPUTS, fields['input'])}) → отказ, кнопка недоступна: ${str(fields['say']) ?? 'причина не названа'}`;
  const head = record.msg === 'answered' ? `ответ на ${actionName(fields)}` : `нажато ${actionName(fields)}`;
  const how = record.msg === 'answered' ? '' : ` (${word(SURFACES, fields['via'])}, ${word(INPUTS, fields['input'])})`;
  const ms = typeof fields['ms'] === 'number' && fields['ms'] >= 1000 ? `, ${(fields['ms'] / 1000).toFixed(1)} с` : '';
  let result = '';
  if (fields['ok'] === true) result = ` → ${word(OUTCOMES, fields['outcome'])}${ms}`;
  else if (fields['ok'] === false) result = ` → отказ: ${because(fields, record.code)}${ms}`;
  return `${head}${how}${fanTail(fields, record)}${result}`;
}

function featureOf(fields: Readonly<Record<string, unknown>>): string {
  return word(FEATURES, fields['feature']);
}

function decisionLine(record: LogRecord, fields: Readonly<Record<string, unknown>>): string {
  const surface = word(SURFACES, fields['surface']);
  if (record.msg === 'unavailable') return `${surface} · ${featureOf(fields)}${fanTail(fields, record)} — недоступно: ${because(fields, record.code)}`;
  if (record.msg === 'available') return `${surface} · ${featureOf(fields)}${fanTail(fields, record)} — снова доступно`;
  const items = Array.isArray(fields['items']) ? (fields['items'] as readonly Readonly<Record<string, unknown>>[]) : [];
  const said = items.map((item) => `${featureOf(item)}${fanTail(item)}${item['on'] === true ? ' — снова доступно' : `: ${because(item, undefined)}`}`);
  if (record.msg === 'state') {
    const off = typeof fields['offCount'] === 'number' ? fields['offCount'] : items.length;
    // The dock's first look is at the chat the line already names.
    const fan = fanTail(fields, record);
    return off === 0 ? `${surface}${fan}: всё доступно` : `${surface}${fan}: недоступно ${String(off)} — ${said.join('; ')}${off > items.length ? '; …' : ''}`;
  }
  return `${surface}: изменилось ${str(fields['changedCount']) ?? String(items.length)} — ${said.join('; ')}`;
}

function list(value: unknown): string {
  return Array.isArray(value) && value.length > 0 ? value.map((item) => String(item)).join(', ') : '—';
}

/** A configuration snapshot as a block of lines. */
export function configBlock(fields: Readonly<Record<string, unknown>>): string[] {
  const yes = (value: unknown): string => (value === true ? 'да' : value === false ? 'нет' : 'неизвестно');
  const changed = Array.isArray(fields['changed']) && fields['changed'].length > 0 ? ` · изменилось: ${list(fields['changed'])}` : '';
  return [
    `конфигурация (${str(fields['trigger']) ?? '?'})${changed}`,
    `    версия ${str(fields['version']) ?? '?'} · сайт ${word(SITES, fields['site'])} · сборка сайта ${str(fields['siteBuild']) ?? '?'} · контракт ${str(fields['contract']) ?? '?'}` +
      (Array.isArray(fields['missing']) && fields['missing'].length > 0 ? ` (нет: ${list(fields['missing'])})` : '') +
      (Array.isArray(fields['degraded']) && fields['degraded'].length > 0 ? ` (частично: ${list(fields['degraded'])})` : ''),
    `    вход в хаб: ${yes(fields['signedIn'])}${str(fields['role']) === null ? '' : ` · роль ${str(fields['role']) ?? ''}`}${str(fields['userId']) === null ? '' : ` · пользователь ${str(fields['userId']) ?? ''}`}${str(fields['hubOrigin']) === null ? '' : ` · ${str(fields['hubOrigin']) ?? ''}`}`,
    `    аккаунт на сайте: ${str(fields['accountId']) ?? 'не определён'} (известно аккаунтов: ${str(fields['accountCount']) ?? '0'}) · страница хаба: ${str(fields['pageId']) === null ? `нет${str(fields['bindingCode']) === null ? '' : ` (${str(fields['bindingCode']) ?? ''})`}` : `${str(fields['pageId']) ?? ''} «${str(fields['pageName']) ?? '?'}»`}`,
    `    персона: ${str(fields['personaName']) === null ? 'нет' : `«${str(fields['personaName']) ?? ''}»`} (${str(fields['personaKey']) ?? '—'}, ${str(fields['personaStatus']) ?? '—'}) · все персоны: ${list(fields['personaNames'])}`,
    `    функции страницы: ${list(fields['features'])}`,
    `    выключено на странице: ${list(fields['disabled'])}`,
    `    флаги владельца для всех страниц («*»; решает строка страницы выше): ${list(fields['flags'])} · ревизия ${str(fields['configRevision']) ?? '?'} · минимальная версия ${str(fields['minVersion']) ?? '?'}`,
    `    возможности хаба: ${list(fields['capabilities'])}`,
    `    настройки: ${list(fields['settings'])} · debug ${yes(fields['debug'])}`,
  ];
}

function opLine(record: LogRecord, fields: Readonly<Record<string, unknown>>): string | null {
  if (record.msg === 'operation admitted') return `генерация ${featureOf(fields)} начата (${word(SURFACES, fields['surface'])})${fields['continues'] === true ? ', продолжение Coach' : ''}`;
  if (record.msg === 'operation ended') {
    const ms = typeof fields['ms'] === 'number' ? ` за ${(fields['ms'] / 1000).toFixed(1)} с` : '';
    const cause = str(fields['cancelReason']);
    return `генерация ${featureOf(fields)}: ${word(OP_STATES, fields['state'])}${ms}${cause === null ? '' : ` (${cause})`}${record.code === undefined ? '' : ` (${record.code})`}`;
  }
  if (record.msg === 'stream deadline passed') return `генерация: истёк срок ответа хаба${record.code === undefined ? '' : ` (${record.code})`}`;
  return null;
}

function insertLine(record: LogRecord, fields: Readonly<Record<string, unknown>>): string | null {
  const code = record.code === undefined ? '' : ` (${record.code})`;
  if (record.msg === 'insert intent') return `вставка в поле: попытка, часть ${typeof fields['part'] === 'number' ? String(fields['part'] + 1) : '?'}, ${str(fields['textLength']) ?? '?'} симв.`;
  if (record.msg === 'insert applied') return 'вставка в поле: вставлено';
  if (record.msg === 'insert rejected' || record.msg === 'insert prevented') return `вставка в поле: отказ${code}`;
  if (record.msg === 'insert uncertain') return `вставка в поле: не подтвердилась${code}`;
  return null;
}

function sendLine(record: LogRecord, fields: Readonly<Record<string, unknown>>): string | null {
  const code = record.code === undefined ? '' : ` (${record.code})`;
  if (record.msg === 'attempt moved') return `отправка из превью: ${str(fields['fromState']) ?? '?'} → ${str(fields['toState']) ?? '?'}${code}${fields['toState'] === 'uncertain' ? ' — не подтвердилась' : ''}`;
  if (record.msg === 'send held before dispatch') return `отправка из превью: удержана до очереди${code}`;
  if (record.msg === 'dispatch failed') return `отправка из превью: не ушла в очередь ChatSpace${code}`;
  if (record.msg === 'human send recorded') return 'отправка: ChatSpace подтвердил отправку части';
  return null;
}

function siteLine(record: LogRecord, fields: Readonly<Record<string, unknown>>): string | null {
  if (record.scope === 'tab.route' && record.msg === 'route changed') return `маршрут: ${str(fields['route']) ?? '?'}${str(fields['hostAccountId']) === null ? '' : ` · аккаунт ${str(fields['hostAccountId']) ?? ''}`}`;
  if (record.scope !== 'tab.site') return null;
  if (record.msg === 'socket coverage') return `сокет сайта по аккаунту ${str(fields['accountId']) ?? '?'}: ${fields['state'] === 'ok' ? 'слушаем' : `не слушаем (${str(fields['reason']) ?? '?'})`}`;
  if (record.msg === 'accounts') return `аккаунты на странице: ${str(fields['accountCount']) ?? '0'} (${list(fields['accountIds'])})`;
  if (record.msg === 'account on screen') return `аккаунт на экране: ${str(fields['accountId']) ?? 'не определён'}`;
  if (record.msg === 'chatter sent') return `чаттер отправил сообщение кнопкой сайта${fanTail(fields)}${fields['ours'] === true ? ' (часть ChatGoose)' : ''}`;
  if (record.msg === 'send fuse') return `предохранитель отправки из превью сработал (${str(fields['reason']) ?? '?'})`;
  if (record.msg === 'reload needed') return 'сайту нужна перезагрузка вкладки';
  if (record.msg === 'connection') return `связь вкладки с фоном: ${str(fields['state']) ?? '?'}`;
  return null;
}

function json(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

function toastLine(record: LogRecord, fields: Readonly<Record<string, unknown>>): string {
  const code = str(fields['toastCode']);
  const head = record.msg === 'kept by the dock' ? 'тост фона (сказан в доке)' : 'тост';
  return `${head}: «${str(fields['say']) ?? str(fields['scope']) ?? '?'}»${code === null ? '' : ` (${code})`}${fanTail(fields)}`;
}

function rawLine(record: LogRecord): string {
  const code = record.code === undefined ? '' : ` ${record.code}`;
  const fields = record.fields === undefined ? '' : ` ${json(record.fields)}`;
  return `[${record.scope}] ${record.msg}${code}${fields}`;
}

const LEVEL_MARK: Readonly<Record<string, string>> = { warn: '⚠ ', error: '✖ ', debug: '· ', info: '' };

/** One record as lines of the feed (a configuration is a block). */
export function feedLines(record: LogRecord): string[] {
  const { time } = localTime(record.ts);
  const fields = record.fields ?? {};
  const place = where(record);
  const prefix = `${time} ${LEVEL_MARK[record.level] ?? ''}${place === '' ? '' : `${place} · `}`;
  if (record.scope === 'ui.config') {
    const [head, ...rest] = configBlock(fields);
    return [`${prefix}${head ?? ''}`, ...rest];
  }
  const text =
    record.scope === 'ui.action'
      ? actionLine(record, fields)
      : record.scope === 'ui.decision'
        ? decisionLine(record, fields)
        : record.scope === 'ui.toast'
          ? toastLine(record, fields)
          : record.scope === 'bg.ops'
            ? opLine(record, fields)
            : record.scope === 'tab.insert'
              ? insertLine(record, fields)
              : record.scope === 'bg.send' || record.scope === 'fansly.send'
                ? sendLine(record, fields)
                : siteLine(record, fields);
  return [`${prefix}${text ?? rawLine(record)}`];
}

/** The whole feed, oldest first, with a line for each new day. */
export function feedText(records: readonly LogRecord[]): string[] {
  const out: string[] = [];
  let day = '';
  for (const record of records) {
    const at = localTime(record.ts).day;
    if (at !== day) {
      day = at;
      out.push('', `── ${day} ──`);
    }
    out.push(...feedLines(record));
  }
  return out;
}
