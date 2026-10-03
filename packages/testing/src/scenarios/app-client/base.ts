// Building blocks of the AppClient scenarios: the scenario context (language,
// platform, clock, debug), messages, errors in both languages, the seven view
// states, buttons, hotkey labels, reasons and the synthetic fans. Every id is
// synthetic (tools/archive-check rejects real ones); numeric ids stay below
// five digits so the integrity test can tell.

import {
  UNAVAILABLE_REASONS,
  type ActionButtonVM,
  type CgCode,
  type CgErrorView,
  type HotkeyLabel,
  type HotkeyPlatform,
  type I18nParams,
  type Msg,
  type PartialGap,
  type ReasonVM,
  type SettingsRoute,
  type UiAction,
  type UiLanguage,
  type UnavailableReasonId,
  type VmView,
} from '@cg/contracts';

export interface ScenarioCtx {
  readonly lang: UiLanguage;
  readonly platform: HotkeyPlatform;
  /** The fake clock of the scenario, epoch ms. */
  readonly now: number;
  readonly debug: boolean;
}

/** 2026-10-03 09:20 Moscow, the mockup's «now». */
export const NOW = Date.UTC(2026, 9, 3, 6, 20, 0);
export const iso = (ms: number): string => new Date(ms).toISOString();
export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export const ctxOf = (patch: Partial<ScenarioCtx> = {}): ScenarioCtx => ({ lang: 'ru', platform: 'mac', now: NOW, debug: false, ...patch });

/** Deterministic RFC 4122-shaped ids. */
export const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

export const msg = (key: string, params?: I18nParams): Msg => (params === undefined ? { key } : { key, params });

/** Mills from whole dollars, for readable fixtures. */
export const usd = (dollars: number): number => dollars * 1000;

// ── errors ──

type Texts = { readonly ru: readonly [string, string]; readonly en: readonly [string, string] };

const ERROR_TEXTS: Partial<Record<CgCode, Texts>> = {
  'CG-AUTH-REQUIRED': { ru: ['Нужно войти', 'Войдите в ChatGoose через значок расширения.'], en: ['Sign in needed', 'Sign in to ChatGoose from the extension icon.'] },
  'CG-BINDING-MISSING': {
    ru: ['Аккаунт не привязан', 'OnlyMonster 1001 не привязан к странице в хабе. Напишите тимлиду.'],
    en: ['Account not linked', 'OnlyMonster 1001 is not linked to a hub page. Ask your team lead.'],
  },
  'CG-BINDING-NOT-GRANTED': {
    ru: ['Нет доступа к странице', 'Страница LoraVie VIP вам не выдана. Напишите тимлиду.'],
    en: ['No access to this page', 'LoraVie VIP is not assigned to you. Ask your team lead.'],
  },
  'CG-HUB-FORBIDDEN': { ru: ['Нет прав', 'У вашей роли нет доступа к этим данным.'], en: ['No rights', 'Your role cannot see this data.'] },
  'CG-PERSONA-UNASSIGNED': { ru: ['Нет персоны', 'Для LoraVie VIP не выбрана персона.'], en: ['No persona', 'No persona is chosen for LoraVie VIP.'] },
  'CG-HOST-CONTRACT': {
    ru: ['ChatSpace обновился', 'Часть функций выключена до проверки. Вставка работает через «Копировать».'],
    en: ['ChatSpace was updated', 'Some features are off until checked. Use Copy instead of Insert.'],
  },
  'CG-HOST-COMPOSER-MISSING': {
    ru: ['Поле ввода недоступно', 'ChatSpace не показал поле ввода, поэтому ответ можно только копировать.'],
    en: ['Message box unavailable', 'ChatSpace did not show its message box, so the reply can only be copied.'],
  },
  'CG-HUB-UNAVAILABLE': {
    ru: ['Хаб недоступен', 'Сервер ChatGoose не отвечает. ChatSpace работает как обычно; AI вернётся, когда хаб ответит.'],
    en: ['Hub unavailable', 'The ChatGoose server does not answer. ChatSpace works as usual; AI comes back when the hub answers.'],
  },
  'CG-GATE-FAN-BLOCKED': { ru: ['Фан заблокирован', 'Можно только копировать.'], en: ['Fan is blocked', 'Copy only.'] },
  'CG-RUNTIME-RELOADED': {
    ru: ['Расширение обновилось', 'Версия 0.4.2 → 0.4.3. Перезагрузите вкладку, черновик сохранится.'],
    en: ['The extension was updated', 'Version 0.4.2 → 0.4.3. Reload the tab; your draft stays.'],
  },
  'CG-QUOTA-DAILY': { ru: ['Дневная квота AI исчерпана', 'Квота обновится в 03:00 по Москве (00:00 UTC).'], en: ['Daily AI quota used up', 'The quota renews at 00:00 UTC.'] },
  'CG-OP-TAB-LIMIT': {
    ru: ['Уже идут три генерации', 'Очереди нет: четвёртая не запустится сама. Дождитесь, пока одна закончится, или отмените её, потом нажмите Reply ещё раз.'],
    en: ['Three generations already running', 'There is no queue: a fourth will not start by itself. Wait for one or cancel it, then press Reply again.'],
  },
  'CG-OP-CHAT-BUSY': { ru: ['Уже идёт генерация', 'В этом чате генерация идёт в другой вкладке.'], en: ['Already generating', 'This chat is generating in another tab.'] },
  'CG-OP-INTERRUPTED': { ru: ['Генерация прервалась', 'Браузер прервал работу. Нажмите «Ещё раз».'], en: ['Generation interrupted', 'The browser cut the work. Press Again.'] },
  'CG-PROVIDER-RATE-LIMIT': {
    ru: ['AI перегружен', 'Провайдер AI ограничил частоту запросов. Повторить можно через 24 с — вручную.'],
    en: ['AI is overloaded', 'The AI provider limited the request rate. You can retry by hand in 24 s.'],
  },
  'CG-PROVIDER-STREAM': { ru: ['Ответ AI оборвался', 'Попробуйте ещё раз.'], en: ['The AI answer broke off', 'Try again.'] },
  'CG-HUB-TIMEOUT': { ru: ['Хаб не ответил вовремя', 'Генерация остановлена по сроку. Повтор — только новым нажатием.'], en: ['The hub did not answer in time', 'The generation stopped on timeout. Retry only with a new click.'] },
  'CG-DATA-TIMEOUT': { ru: ['Доска не собралась за 120 с', 'Повторите чтение.'], en: ['The board did not build in 120 s', 'Retry the read.'] },
  'CG-DATA-UNAVAILABLE': { ru: ['Данные недоступны', 'Хаб не отдал данные. Повторите чтение.'], en: ['Data unavailable', 'The hub did not return the data. Retry.'] },
  'CG-DATA-PARTIAL': { ru: ['Данные неполные', 'Охват неполный: часть истории ещё не в архиве.'], en: ['Data incomplete', 'Coverage is partial: part of the history is not archived yet.'] },
  'CG-RECAP-NOT-FOUND': { ru: ['Сохранённого рекапа нет', 'Соберите Recap коротко или полностью.'], en: ['No saved Recap', 'Build a short or a full Recap.'] },
  'CG-RECAP-SAVE': { ru: ['Recap не сохранился в хаб', 'Сохранение повторится само.'], en: ['Recap not saved to the hub', 'Saving will be retried.'] },
  'CG-GATE-HISTORY': { ru: ['Мало переписки', 'Для Review нужно больше сообщений.'], en: ['Not enough history', 'Review needs more messages.'] },
  'CG-CLAIM-BUSY': {
    ru: ['Анна уже здоровается с Leo', 'Фана сейчас ведёт Анна. Бронь снимется, когда она перестанет с ним работать.'],
    en: ['Anna is already greeting Leo', 'Anna is working with this fan now. The hold ends when she stops working with him.'],
  },
  'CG-CLAIM-EXPIRED': { ru: ['Бронь истекла', 'Нажмите Hi ещё раз.'], en: ['The hold expired', 'Press Hi again.'] },
  'CG-CLAIM-ROW-CHANGED': { ru: ['Данные фана изменились', 'Проверьте черновик и нажмите Hi ещё раз.'], en: ['The fan data changed', 'Check the draft and press Hi again.'] },
  'CG-SEND-UNCERTAIN': {
    ru: ['Неизвестно, ушло ли сообщение', 'Повторно не отправляем. Если в чате сообщения нет, вставьте часть вручную.'],
    en: ['Unknown whether the message went out', 'We do not resend. If the chat has no such message, insert the part by hand.'],
  },
  'CG-SEND-REJECTED': { ru: ['Не отправлено', 'OnlyFans не принял сообщение. Текст не ушёл.'], en: ['Not sent', 'OnlyFans did not accept the message. Nothing went out.'] },
  'CG-RUNTIME-UNREACHABLE': { ru: ['Фон расширения не отвечает', 'Перезапустите браузер или переустановите расширение.'], en: ['The extension background does not answer', 'Restart the browser or reinstall the extension.'] },
  'CG-STORAGE-READ': { ru: ['Настройки не прочитались', 'Сохранённые настройки не тронуты. Повторите.'], en: ['Settings could not be read', 'Stored settings are untouched. Retry.'] },
  'CG-HUB-HOST-PERMISSION': { ru: ['Нет доступа к адресу хаба', 'Разрешите расширению адрес хаба.'], en: ['No access to the hub address', 'Allow the extension to reach the hub address.'] },
  'CG-NAV-FAILED': { ru: ['Не удалось открыть чат', 'Откройте чат вручную.'], en: ['Could not open the chat', 'Open the chat by hand.'] },
  'CG-INSERT-FAILED': { ru: ['Текст не вставился', 'Скопируйте часть и вставьте вручную.'], en: ['The text was not inserted', 'Copy the part and paste it by hand.'] },
  'CG-INSERT-CHAT-CHANGED': { ru: ['Чат сменился — текст не вставлен', 'Откройте нужный чат и нажмите «Вставить» ещё раз.'], en: ['The chat changed — nothing inserted', 'Open the right chat and press Insert again.'] },
  'CG-CLIPBOARD': { ru: ['Не удалось скопировать', 'Браузер не дал записать в буфер обмена.'], en: ['Could not copy', 'The browser did not allow writing to the clipboard.'] },
  'CG-FEATURE-DISABLED': { ru: ['Функция выключена', 'Включите режим отладки в настройках.'], en: ['Feature is off', 'Turn on debug mode in the settings.'] },
  'CG-UNKNOWN': { ru: ['Что-то пошло не так', 'Скопируйте код и отправьте тимлиду.'], en: ['Something went wrong', 'Copy the code and send it to your team lead.'] },
};

export interface ErrorExtras {
  readonly detail?: string;
  readonly retryAt?: number;
  readonly settings?: SettingsRoute;
}

/** A rendered error in the scenario's language, as the controller builds it from the registry. */
export function cgError(ctx: ScenarioCtx, code: CgCode, extras: ErrorExtras = {}): CgErrorView {
  const texts = ERROR_TEXTS[code];
  const [title, body] = texts === undefined ? [code, code] : texts[ctx.lang];
  return { code, title, body, ...extras };
}

// ── view states ──

export const views = {
  loading: (since: number | null = null, stage: Msg | null = null): VmView => ({ s: 'loading', since, stage }),
  ready: (): VmView => ({ s: 'ready' }),
  empty: (why: Msg): VmView => ({ s: 'empty', why }),
  partial: (...gaps: PartialGap[]): VmView => ({ s: 'partial', gaps }),
  error: (error: CgErrorView, retry: UiAction | null = null): VmView => ({ s: 'error', error, retry }),
  forbidden: (error: CgErrorView, remedy: UiAction | null = null): VmView => ({ s: 'forbidden', error, remedy }),
  offline: (error: CgErrorView, retry: UiAction | null = null, lastGoodAt: number | null = null): VmView => ({ s: 'offline', error, retry, lastGoodAt }),
};

// ── hotkeys, reasons, buttons ──

const key = (display: string, aria: string): HotkeyLabel => ({ display, aria, delivery: 'delivered', fallback: null });

const MAC = {
  reply: key('⌘E', 'Meta+E'),
  fix: key('⌘I', 'Meta+I'),
  hi: key('⌘G', 'Meta+G'),
  ping: key('⌘P', 'Meta+P'),
  review: key('⌘⇧B', 'Meta+Shift+B'),
  recap: key('⌘⇧S', 'Meta+Shift+S'),
  coach: key('⌘⇧C', 'Meta+Shift+C'),
  cancel: key('⌘.', 'Meta+.'),
  tone: key('⌘⇧O', 'Meta+Shift+O'),
  split: key('⌘⇧L', 'Meta+Shift+L'),
  palette: key('⌘K', 'Meta+K'),
  spenders: key('⌘⇧M', 'Meta+Shift+M'),
  cheatsheet: key('?', '?'),
  close: key('Esc', 'Escape'),
  insert: key('↵', 'Enter'),
  copy: key('⌘C', 'Meta+C'),
  nextUnread: { display: '⌘U', aria: 'Meta+U', delivery: 'unverified', fallback: { display: '⌥U', aria: 'Alt+U', delivery: 'delivered' } },
  help: key('⌘⇧H', 'Meta+Shift+H'),
} as const satisfies Record<string, HotkeyLabel>;

const WIN: Record<keyof typeof MAC, HotkeyLabel> = {
  reply: key('Ctrl+E', 'Control+E'),
  fix: key('Ctrl+I', 'Control+I'),
  hi: key('Ctrl+G', 'Control+G'),
  ping: key('Ctrl+P', 'Control+P'),
  review: key('Ctrl+Alt+B', 'Control+Alt+B'),
  recap: key('Ctrl+Alt+S', 'Control+Alt+S'),
  coach: key('Ctrl+Alt+C', 'Control+Alt+C'),
  cancel: key('Ctrl+.', 'Control+.'),
  tone: key('Ctrl+Alt+O', 'Control+Alt+O'),
  split: key('Ctrl+Alt+L', 'Control+Alt+L'),
  palette: key('Ctrl+K', 'Control+K'),
  spenders: key('Ctrl+Alt+M', 'Control+Alt+M'),
  cheatsheet: key('?', '?'),
  close: key('Esc', 'Escape'),
  insert: key('↵', 'Enter'),
  copy: key('Ctrl+C', 'Control+C'),
  nextUnread: { display: 'Ctrl+U', aria: 'Control+U', delivery: 'reserved', fallback: { display: 'Alt+U', aria: 'Alt+U', delivery: 'delivered' } },
  help: key('Ctrl+Alt+H', 'Control+Alt+H'),
};

export type HotkeyName = keyof typeof MAC;
export const hotkey = (ctx: ScenarioCtx, name: HotkeyName): HotkeyLabel => (ctx.platform === 'mac' ? MAC : WIN)[name];

export function reason(id: UnavailableReasonId, params?: I18nParams): ReasonVM {
  const entry = UNAVAILABLE_REASONS[id];
  return { id, code: entry.code, text: msg(entry.key, params) };
}

export function button(label: string | Msg, action: UiAction, patch: Partial<ActionButtonVM> = {}): ActionButtonVM {
  return { label: typeof label === 'string' ? msg(label) : label, action, enabled: true, reason: null, hotkey: null, ...patch };
}

// ── people and handles ──

export interface FanFixture {
  readonly key: string;
  readonly name: string;
  readonly username: string;
}

export const FANS = {
  hubert: { key: 'f2002', name: 'Hubert', username: 'hubert_pl' },
  theodore: { key: 'f2003', name: 'Theodore Whitfield', username: 'theo_w' },
  marco: { key: 'f2004', name: 'Marco Rinaldi', username: 'marco_r' },
  jake: { key: 'f2005', name: 'Jake Morrison', username: 'jakem' },
  tomasz: { key: 'f2006', name: 'Tomasz', username: 'tomasz_k' },
  leo: { key: 'f2007', name: 'Leo', username: 'leo_88' },
} as const satisfies Record<string, FanFixture>;

export const PERSONA = { label: 'Лора · VIP', pageName: 'LoraVie VIP' } as const;
export const HOST_ACCOUNT_ID = '1001';
export const CREATOR_ID = '3003';

export const handles = {
  dock: (fan: FanFixture): string => `dock:${fan.key}`,
  spenders: (fan: FanFixture): string => `spenders:${fan.key}`,
  newcomers: (fan: FanFixture): string => `newcomers:${fan.key}`,
  palette: (fan: FanFixture): string => `palette:${fan.key}`,
  part: (opId: string, variant: number | null, index: number): string => `part:${opId.slice(-4)}:${variant ?? 0}:${index}`,
  artifact: (kind: string, n: number): string => `${kind}:${n}`,
};

export const openChat = (fan: FanFixture): UiAction => ({ type: 'Navigate', to: { kind: 'chat', targetHandle: handles.dock(fan) } });
