// Fake ports for the stand and UI tests: an I18n that prints keys with their
// parameters but formats money, ages, times and durations for real (one money
// notation, ui-design §1 п. 6), and recording toast, clipboard, dialog,
// signal, focus and render-mark ports.

import {
  type ActionCatalog,
  type ActionCatalogEntry,
  type CatalogActionId,
  type ClipboardPort,
  type ClipboardResult,
  type ColorScheme,
  type ConfirmDialogRequest,
  type DialogPort,
  type DurationStyle,
  type FocusPlace,
  type FocusReturn,
  type I18n,
  type I18nKey,
  type I18nParam,
  type I18nParams,
  type MoneyFormat,
  type MountDeps,
  type RenderMarks,
  type SurfaceGeometry,
  type TimeStyle,
  type ToastPort,
  type ToastRequest,
  type Locale,
  type UiPaintMetric,
  type ValueSignal,
  CATALOG_ACTION_IDS,
} from '@cg/contracts';

import { hotkey, reason, type HotkeyName, type ScenarioCtx } from './base';
import { type FakeAppClient } from './fake-app-client';

const MINUS = '−';

/** `$12,480`, `+$320`, `−$45`; a known zero blank unless asked; null `—`. Whole dollars, rounded half away from zero. */
export function formatMoneyMills(mills: number | null, format: MoneyFormat = {}): string {
  if (mills === null) return '—';
  if (mills === 0 && format.zero !== 'show') return '';
  const dollars = Math.round(Math.abs(mills) / 1000);
  const digits = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (mills < 0) return `${MINUS}$${digits}`;
  return `${format.sign === 'plus' ? '+' : ''}$${digits}`;
}

const AGE_UNITS: Record<Locale, { now: string; min: string; h: string; d: string }> = {
  ru: { now: 'сейчас', min: 'мин', h: 'ч', d: 'д' },
  en: { now: 'now', min: 'min', h: 'h', d: 'd' },
};

const toMs = (at: number | string): number => (typeof at === 'number' ? at : Date.parse(at));

export function formatAge(language: Locale, from: number | string, now: number): string {
  const units = AGE_UNITS[language];
  const minutes = Math.floor(Math.max(0, now - toMs(from)) / 60_000);
  if (minutes < 1) return units.now;
  if (minutes < 60) return `${minutes} ${units.min}`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} ${units.h}`;
  return `${Math.floor(minutes / (24 * 60))} ${units.d}`;
}

export function formatDuration(ms: number, style: DurationStyle): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (style === 'seconds') return `${total}`;
  if (style === 'm:ss') return `${Math.floor(total / 60)}:${pad(total % 60)}`;
  return `${Math.floor(total / 3600)}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

/** UTC formatting keeps fixtures deterministic across machines; `formatTimeIn` names its zone. */
export function formatTime(language: Locale, at: number | string, style: TimeStyle = 'time', timeZone = 'UTC'): string {
  const locale = language === 'ru' ? 'ru-RU' : 'en-GB';
  const date = new Date(toMs(at));
  const time = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone });
  const day = date.toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone });
  if (style === 'time') return time;
  if (style === 'datetime') return `${day}, ${time}`;
  return day;
}

export interface FakeI18n extends I18n {
  setLanguage(language: Locale): void;
}

export function createFakeI18n(initial: Locale, clock: () => number): FakeI18n {
  let language = initial;
  const listeners = new Set<(language: Locale) => void>();
  const param = (value: I18nParam): string => {
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if ('money' in value) return formatMoneyMills(value.money, value.sign === undefined ? {} : { sign: value.sign });
    if ('age' in value) return formatAge(language, value.age, clock());
    if ('time' in value) return formatTime(language, value.time, value.style);
    return formatDuration(value.duration, value.style ?? 'm:ss');
  };
  const t = (key: string, params?: I18nParams): string => {
    if (params === undefined) return `${language}:${key}`;
    const rendered = Object.entries(params).map(([name, value]) => `${name}=${param(value)}`);
    return `${language}:${key}(${rendered.join(', ')})`;
  };
  return {
    get language() {
      return language;
    },
    t,
    plural: (key, count, params) => t(`${key}#${new Intl.PluralRules(language).select(count)}`, { n: count, ...params }),
    text: (m) => t(m.key, m.params),
    formatMoneyMills,
    formatMoneySpoken: (mills, format) => `${language}:spoken(${formatMoneyMills(mills, format ?? {})})`,
    formatAge: (from, now) => formatAge(language, from, now ?? clock()),
    formatTime: (at, style) => formatTime(language, at, style),
    formatTimeIn: (at, timeZone, style) => formatTime(language, at, style, timeZone),
    formatDuration,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setLanguage(next) {
      language = next;
      for (const listener of listeners) listener(next);
    },
  };
}

export class FakeSignal<T> implements ValueSignal<T> {
  private readonly listeners = new Set<(value: T) => void>();
  constructor(private current: T) {}
  get value(): T {
    return this.current;
  }
  set(next: T): void {
    this.current = next;
    for (const listener of this.listeners) listener(next);
  }
  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export class FakeToasts implements ToastPort {
  readonly shown: { id: string; toast: ToastRequest }[] = [];
  show(toast: ToastRequest): string {
    const id = `local-${this.shown.length + 1}`;
    this.shown.push({ id, toast });
    return id;
  }
  dismiss(id: string): void {
    const index = this.shown.findIndex((t) => t.id === id);
    if (index >= 0) this.shown.splice(index, 1);
  }
}

export class FakeClipboard implements ClipboardPort {
  readonly written: string[] = [];
  constructor(public fail = false) {}
  writeText(text: string): Promise<ClipboardResult> {
    if (this.fail) return Promise.resolve({ ok: false, code: 'CG-CLIPBOARD' });
    this.written.push(text);
    return Promise.resolve({ ok: true });
  }
}

export class FakeDialogs implements DialogPort {
  readonly asked: ConfirmDialogRequest[] = [];
  constructor(public answer: 'confirm' | 'cancel' = 'confirm') {}
  confirm(request: ConfirmDialogRequest): Promise<'confirm' | 'cancel'> {
    this.asked.push(request);
    return Promise.resolve(this.answer);
  }
}

export class FakeMarks implements RenderMarks {
  readonly shown: string[] = [];
  readonly paints: { metric: UiPaintMetric; mark: string }[] = [];
  resultShown(opId: string): void {
    this.shown.push(opId);
  }
  painted(metric: UiPaintMetric, mark: string): void {
    this.paints.push({ metric, mark });
  }
}

const CATALOG_KEYS: Partial<Record<CatalogActionId, HotkeyName>> = {
  reply: 'reply',
  fix: 'fix',
  hi: 'hi',
  ping: 'ping',
  review: 'review',
  recap: 'recap',
  coach: 'coach',
  cancel: 'cancel',
  help: 'help',
  tone: 'tone',
  split: 'split',
  spenders: 'spenders',
  palette: 'palette',
  cheatsheet: 'cheatsheet',
  close: 'close',
  'insert-part': 'insert',
  'copy-part': 'copy',
  'next-unread': 'nextUnread',
  'apply-fix': 'applyFix',
};

/** Labels as the palette and the cheatsheet print them; a tooltip only where the catalog has one. */
const CATALOG_LABELS: Record<CatalogActionId, { readonly label: I18nKey; readonly tooltip: I18nKey | null }> = {
  reply: { label: 'dock.action.reply', tooltip: null },
  fix: { label: 'dock.action.fix', tooltip: null },
  hi: { label: 'dock.action.hi', tooltip: null },
  ping: { label: 'dock.action.ping', tooltip: null },
  review: { label: 'dock.action.review', tooltip: 'review.againTooltip' },
  recap: { label: 'dock.action.recap', tooltip: 'recap.refreshTooltip' },
  coach: { label: 'dock.action.coach', tooltip: null },
  cancel: { label: 'cheatsheet.row.cancel', tooltip: null },
  help: { label: 'cheatsheet.row.help', tooltip: 'dock.helpRemoved' },
  tone: { label: 'cheatsheet.row.tone', tooltip: 'dock.option.toneMenuTitle' },
  split: { label: 'cheatsheet.row.split', tooltip: null },
  spenders: { label: 'cheatsheet.row.spenders', tooltip: null },
  newcomers: { label: 'palette.item.newcomers', tooltip: null },
  palette: { label: 'cheatsheet.row.palette', tooltip: 'dock.paletteHint.tooltip' },
  cheatsheet: { label: 'palette.item.cheatsheet', tooltip: null },
  settings: { label: 'palette.item.settings', tooltip: null },
  close: { label: 'common.close', tooltip: null },
  'part-step': { label: 'cheatsheet.row.nextPart', tooltip: null },
  'variant-step': { label: 'result.keys.variant', tooltip: null },
  'insert-part': { label: 'cheatsheet.row.insert', tooltip: 'part.insertTooltip' },
  'copy-part': { label: 'cheatsheet.row.copy', tooltip: null },
  'open-and-insert': { label: 'send.openAndInsert', tooltip: 'send.openAndInsertTooltip' },
  send: { label: 'send.button', tooltip: 'send.buttonTooltip' },
  'chat-next': { label: 'cheatsheet.row.chatNext', tooltip: null },
  'chat-previous': { label: 'cheatsheet.row.chatPrevious', tooltip: null },
  'fan-panel': { label: 'fanPanel.label', tooltip: null },
  'next-unread': { label: 'cheatsheet.row.nextUnread', tooltip: null },
  'quick-jump': { label: 'quickJump.title', tooltip: null },
  search: { label: 'cheatsheet.row.search', tooltip: null },
  notes: { label: 'cheatsheet.row.notes', tooltip: null },
  'apply-fix': { label: 'cheatsheet.row.applyFix', tooltip: null },
};

export function createFakeCatalog(ctx: ScenarioCtx): ActionCatalog {
  const entries = CATALOG_ACTION_IDS.map((id): ActionCatalogEntry => {
    const name = CATALOG_KEYS[id];
    return {
      id,
      ...CATALOG_LABELS[id],
      hotkey: name === undefined ? null : hotkey(ctx, name),
      scope: id === 'spenders' || id === 'palette' || id === 'cheatsheet' ? 'global' : id === 'send' || id === 'open-and-insert' ? 'preview' : 'chat',
      status: id === 'help' ? 'removed' : 'active',
    };
  });
  return {
    platform: ctx.platform,
    entry: (id) => entries.find((e) => e.id === id) ?? (entries[0] as ActionCatalogEntry),
    entries: () => entries,
    reason,
  };
}

/** The host side's focus port: `restore` always succeeds; `where` answers what the test put in `place` (1.16.0). */
export class FakeFocus implements FocusReturn {
  readonly token = 'focus-1';
  /** Where the page's focus is, as the host side would say: the composer unless a test says otherwise. */
  place: FocusPlace = 'composer';
  restore(): boolean {
    return true;
  }
  where(): FocusPlace {
    return this.place;
  }
}

export interface FakeMountDeps extends MountDeps {
  readonly focus: FakeFocus;
  readonly i18n: FakeI18n;
  readonly toasts: FakeToasts;
  readonly clipboard: FakeClipboard;
  readonly dialogs: FakeDialogs;
  readonly scheme: FakeSignal<ColorScheme>;
  readonly geometry: FakeSignal<SurfaceGeometry>;
  readonly marks: FakeMarks;
}

/** Everything `mountSurface` needs, around a FakeAppClient. */
export function createFakeMountDeps(client: FakeAppClient, ctx: ScenarioCtx): FakeMountDeps {
  const focus = new FakeFocus();
  return {
    client,
    i18n: createFakeI18n(client.scenario.language, () => client.now()),
    catalog: createFakeCatalog(ctx),
    toasts: new FakeToasts(),
    clipboard: new FakeClipboard(),
    dialogs: new FakeDialogs(),
    scheme: new FakeSignal<ColorScheme>(client.scenario.scheme),
    geometry: new FakeSignal<SurfaceGeometry>({ width: 853, feedHeight: 574, viewportHeight: 900, container: null }),
    focus,
    marks: new FakeMarks(),
  };
}
