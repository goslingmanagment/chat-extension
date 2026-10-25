// Building blocks of the AppClient scenarios: the scenario context (language,
// platform, clock, debug), messages, errors in both languages, the seven view
// states, buttons, hotkey labels, reasons and the synthetic fans. Every id is
// synthetic (tools/archive-check rejects real ones); numeric ids stay below
// five digits so the integrity test can tell.

import {
  UNAVAILABLE_REASONS,
  cgEntry,
  type ActionButtonVM,
  type CgCode,
  type CgErrorView,
  type HotkeyLabel,
  type HotkeyPlatform,
  type I18nKey,
  type I18nParams,
  type Msg,
  type PartialGap,
  type ReasonVM,
  type SettingsRoute,
  type UiAction,
  type Locale,
  type UnavailableReasonId,
  type VmView,
} from '@cg/contracts';
import { CHATSPACE_PHRASES } from '@cg/core/domain/hosts/chatspace/i18n';
import { CATALOGS, createLiveI18n, createTranslator, translatorOf, type CatalogSource, type SitePhrases, type Translator } from '@cg/core/domain/i18n';

export interface ScenarioCtx {
  readonly lang: Locale;
  readonly platform: HotkeyPlatform;
  /** The fake clock of the scenario, epoch ms. */
  readonly now: number;
  readonly debug: boolean;
  /** The site the texts a scenario writes out name (the galleries' `?host=`, R20 P8d); absent — ChatSpace's. */
  readonly phrases?: SitePhrases;
  /** That site's own catalog entries over the shared catalog (Fansly's codes and its own wording, R20 P8d); absent — none. */
  readonly texts?: SiteTexts;
}

/** A site's own catalog entries laid over the shared catalog, per language — what its tab's catalog chunk adds. */
export type SiteTexts = { readonly [L in Locale]: Readonly<Record<string, string>> };

const siteCatalogsMemo = new WeakMap<SiteTexts, CatalogSource>();

/** The shared catalogs with a site's own entries laid over them, as its tab's catalog chunks are. */
export function siteCatalogs(texts: SiteTexts): CatalogSource {
  let source = siteCatalogsMemo.get(texts);
  if (source === undefined) {
    const merged = { ru: { ...CATALOGS.ru, ...texts.ru }, en: { ...CATALOGS.en, ...texts.en } } as const;
    source = (language) => merged[language];
    siteCatalogsMemo.set(texts, source);
  }
  return source;
}

/** The translator of the scenario's language, speaking for its site (ChatSpace unless the scenario names another). */
export function scenarioTranslator(ctx: ScenarioCtx): Translator {
  const phrases = ctx.phrases ?? CHATSPACE_PHRASES;
  return ctx.texts === undefined ? createTranslator(ctx.lang, phrases) : translatorOf(createLiveI18n(siteCatalogs(ctx.texts), { language: ctx.lang, phrases }));
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

export const msg = (key: I18nKey, params?: I18nParams): Msg => (params === undefined ? { key } : { key, params });

/** Mills from whole dollars, for readable fixtures. */
export const usd = (dollars: number): number => dollars * 1000;

// ── errors ──

export interface ErrorExtras {
  readonly detail?: string;
  readonly retryAt?: number;
  readonly settings?: SettingsRoute;
}

/** A rendered error in the scenario's language, as the controller builds it: the registry's keys through the real catalog. */
export function cgError(ctx: ScenarioCtx, code: CgCode, extras: ErrorExtras = {}): CgErrorView {
  const entry = cgEntry(code);
  const t = scenarioTranslator(ctx);
  return { code, title: t.text(entry.title), body: t.text(entry.body), ...extras };
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
  newcomers: key('⌘⇧U', 'Meta+Shift+U'),
  cheatsheet: key('?', '?'),
  close: key('Esc', 'Escape'),
  insert: key('↵', 'Enter'),
  copy: key('⌘C', 'Meta+C'),
  nextUnread: { display: '⌘U', aria: 'Meta+U', delivery: 'unverified', fallback: { display: '⌥U', aria: 'Alt+U', delivery: 'delivered' } },
  help: key('⌘⇧H', 'Meta+Shift+H'),
  applyFix: key('⌘↵', 'Meta+Enter'),
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
  newcomers: key('Ctrl+Alt+U', 'Control+Alt+U'),
  cheatsheet: key('?', '?'),
  close: key('Esc', 'Escape'),
  insert: key('↵', 'Enter'),
  copy: key('Ctrl+C', 'Control+C'),
  nextUnread: { display: 'Ctrl+U', aria: 'Control+U', delivery: 'reserved', fallback: { display: 'Alt+U', aria: 'Alt+U', delivery: 'delivered' } },
  help: key('Ctrl+Alt+H', 'Control+Alt+H'),
  applyFix: key('Ctrl+↵', 'Control+Enter'),
};

export type HotkeyName = keyof typeof MAC;
export const hotkey = (ctx: ScenarioCtx, name: HotkeyName): HotkeyLabel => (ctx.platform === 'mac' ? MAC : WIN)[name];
/** Whether the scenarios print a key of this name (a scheme action of another client has none here). */
export const isHotkeyName = (name: string): name is HotkeyName => Object.prototype.hasOwnProperty.call(MAC, name);

export function reason(id: UnavailableReasonId, params?: I18nParams): ReasonVM {
  const entry = UNAVAILABLE_REASONS[id];
  return { id, code: entry.code, text: msg(entry.key, params) };
}

export function button(label: I18nKey | Msg, action: UiAction, patch: Partial<ActionButtonVM> = {}): ActionButtonVM {
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
  outreach: (fan: FanFixture): string => `outreach:${fan.key}`,
  part: (opId: string, variant: number | null, index: number): string => `part:${opId.slice(-4)}:${variant ?? 0}:${index}`,
  artifact: (kind: string, n: number): string => `${kind}:${n}`,
};

export const openChat = (fan: FanFixture): UiAction => ({ type: 'Navigate', to: { kind: 'chat', targetHandle: handles.dock(fan) } });
