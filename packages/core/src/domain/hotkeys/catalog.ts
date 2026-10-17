// ActionCatalog (architecture.md §10.2 п. 6; HK-032, UI-006, ST-120, ST-121):
// the exact keys, labels and reasons of unavailability the UI prints. Built
// once per platform from the vendored scheme and the rows outside it; the UI
// never binds a global key and never prints a combination the browser keeps
// as working. Every id of CATALOG_ACTION_IDS has an entry here: a new id
// without a row breaks the typecheck.

import { type I18nKey } from '@cg/contracts/errors';
import { CATALOG_ACTION_IDS, UNAVAILABLE_REASONS, type ActionCatalog, type ActionCatalogEntry, type CatalogActionId, type HotkeyLabel, type HotkeyPlatform, type HotkeyScope, type Msg, type ReasonVM } from '@cg/contracts/vm';

import { deliveryOf, type DeliveryKey, type DeliveryOverrides } from './delivery';
import { EXTRA_KEYS, printExtraKey, printSchemeKey, type DispatcherCommandId, type ExtraKeyDef, type HotkeyAction, type KeyPrint } from './keymap';

/** A scheme action this client runs: the scheme also carries rows of other
 * clients (the Fansly extension's Notes), never a row of this catalog. */
type SchemeCommand = Extract<HotkeyAction, DispatcherCommandId>;

interface Row {
  readonly label: I18nKey;
  readonly tooltip: I18nKey | null;
  readonly scope: HotkeyScope;
  readonly status: 'active' | 'removed';
  /** The scheme action or the row outside the scheme that carries the key; a local key printed as is; null — no key. */
  readonly key: { readonly scheme: SchemeCommand } | { readonly extra: DispatcherCommandId } | { readonly local: Readonly<Record<HotkeyPlatform, KeyPrint>> } | null;
}

const scheme = (action: SchemeCommand): Row['key'] => ({ scheme: action });
const extra = (command: DispatcherCommandId): Row['key'] => ({ extra: command });
const local = (display: string, aria: string): Row['key'] => ({ local: { mac: { display, aria }, win: { display, aria } } });
/** «Копировать часть» is the system copy on the focused part. */
const COPY: Row['key'] = { local: { mac: { display: '⌘C', aria: 'Meta+C' }, win: { display: 'Ctrl+C', aria: 'Control+C' } } };

const ROWS: Readonly<Record<CatalogActionId, Row>> = {
  reply: { label: 'dock.action.reply', tooltip: null, scope: 'chat', status: 'active', key: scheme('reply') },
  fix: { label: 'dock.action.fix', tooltip: null, scope: 'chat', status: 'active', key: scheme('fix') },
  hi: { label: 'dock.action.hi', tooltip: null, scope: 'chat', status: 'active', key: scheme('hi') },
  ping: { label: 'dock.action.ping', tooltip: null, scope: 'chat', status: 'active', key: scheme('ping') },
  review: { label: 'dock.action.review', tooltip: null, scope: 'chat', status: 'active', key: scheme('review') },
  recap: { label: 'dock.action.recap', tooltip: null, scope: 'chat', status: 'active', key: scheme('recap') },
  coach: { label: 'dock.action.coach', tooltip: null, scope: 'chat', status: 'active', key: scheme('coach') },
  cancel: { label: 'cheatsheet.row.cancel', tooltip: null, scope: 'result', status: 'active', key: scheme('cancel') },
  /** ⌘⇧H: Help is removed (Б3); the key is swallowed in a chat with «пока убран». */
  help: { label: 'cheatsheet.row.help', tooltip: 'dock.helpRemoved', scope: 'chat', status: 'removed', key: scheme('help') },
  tone: { label: 'cheatsheet.row.tone', tooltip: null, scope: 'chat', status: 'active', key: scheme('tone') },
  split: { label: 'cheatsheet.row.split', tooltip: null, scope: 'chat', status: 'active', key: scheme('split') },
  spenders: { label: 'cheatsheet.row.spenders', tooltip: null, scope: 'global', status: 'active', key: scheme('spenders') },
  /** Decision X49: ⌘⇧U / Ctrl+Alt+U, a row outside the scheme on its panel modifiers. */
  newcomers: { label: 'newcomers.title', tooltip: null, scope: 'global', status: 'active', key: extra('newcomers') },
  palette: { label: 'cheatsheet.row.palette', tooltip: 'dock.paletteHint.tooltip', scope: 'global', status: 'active', key: extra('palette') },
  cheatsheet: { label: 'cheatsheet.row.self', tooltip: null, scope: 'global', status: 'active', key: extra('cheatsheet') },
  settings: { label: 'palette.item.settings', tooltip: null, scope: 'global', status: 'active', key: extra('settings') },
  close: { label: 'common.close', tooltip: null, scope: 'dialog', status: 'active', key: extra('close') },
  'part-step': { label: 'cheatsheet.row.nextPart', tooltip: null, scope: 'result', status: 'active', key: local('↑ ↓', 'ArrowUp ArrowDown') },
  'variant-step': { label: 'result.keys.variant', tooltip: null, scope: 'result', status: 'active', key: local('← →', 'ArrowLeft ArrowRight') },
  'insert-part': { label: 'cheatsheet.row.insert', tooltip: null, scope: 'result', status: 'active', key: local('↵', 'Enter') },
  'copy-part': { label: 'cheatsheet.row.copy', tooltip: null, scope: 'result', status: 'active', key: COPY },
  'open-and-insert': { label: 'send.openAndInsert', tooltip: 'send.openAndInsertTooltip', scope: 'preview', status: 'active', key: local('↵', 'Enter') },
  /** «Отправить» has no key by design (§6.7.4 п. 1): the entry only labels the button. */
  send: { label: 'send.button', tooltip: 'send.buttonTooltip', scope: 'preview', status: 'active', key: null },
  'chat-next': { label: 'cheatsheet.row.chatNext', tooltip: null, scope: 'list', status: 'active', key: extra('chat-next') },
  'chat-previous': { label: 'cheatsheet.row.chatPrevious', tooltip: null, scope: 'list', status: 'active', key: extra('chat-previous') },
  'fan-panel': { label: 'cheatsheet.row.fanPanel', tooltip: null, scope: 'chat', status: 'active', key: extra('fan-panel') },
  'next-unread': { label: 'cheatsheet.row.nextUnread', tooltip: null, scope: 'list', status: 'active', key: extra('next-unread') },
  'quick-jump': { label: 'cheatsheet.row.quickJump', tooltip: null, scope: 'list', status: 'active', key: extra('quick-jump') },
  search: { label: 'cheatsheet.row.search', tooltip: null, scope: 'list', status: 'active', key: local('/', '/') },
  // R20 P11b: Fansly's «Заметки» — a row of the `fansly` client of the scheme; only a site with the feature draws it.
  notes: { label: 'cheatsheet.row.notes', tooltip: null, scope: 'chat', status: 'active', key: scheme('notes') },
};

const extraDef = (command: DispatcherCommandId, fallback: boolean): ExtraKeyDef | undefined => EXTRA_KEYS.find((def) => def.command === command && def.fallback === fallback);

function labelOf(row: Row, platform: HotkeyPlatform, overrides: DeliveryOverrides): HotkeyLabel | null {
  const key = row.key;
  if (key === null) return null;
  // A local key of our own element: it never leaves our shadow root, so the browser's delivery is not in question.
  if ('local' in key) return { ...key.local[platform], delivery: 'delivered', fallback: null };
  if ('scheme' in key) {
    const print = printSchemeKey(key.scheme, platform);
    return { ...print, delivery: deliveryOf(key.scheme, platform, overrides), fallback: null };
  }
  const main = extraDef(key.extra, false);
  if (main === undefined) return null;
  const alternative = extraDef(key.extra, true);
  const fallback =
    alternative === undefined ? null : { ...printExtraKey(alternative, platform), delivery: deliveryOf(`${key.extra}:fallback` as DeliveryKey, platform, overrides) };
  return { ...printExtraKey(main, platform), delivery: deliveryOf(key.extra, platform, overrides), fallback };
}

export interface CatalogOptions {
  /** Measured delivery (docs/hotkeys-delivery.md) that differs from the built-in table. */
  readonly delivery?: DeliveryOverrides;
}

export function createActionCatalog(platform: HotkeyPlatform, options: CatalogOptions = {}): ActionCatalog {
  const overrides = options.delivery ?? {};
  const entries: readonly ActionCatalogEntry[] = CATALOG_ACTION_IDS.map((id) => {
    const row = ROWS[id];
    return { id, label: row.label, tooltip: row.tooltip, hotkey: labelOf(row, platform, overrides), scope: row.scope, status: row.status };
  });
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return {
    platform,
    entry(id) {
      const found = byId.get(id);
      if (found === undefined) throw new Error(`unknown catalog action: ${id}`);
      return found;
    },
    entries: () => entries,
    reason(id, params): ReasonVM {
      const entry = UNAVAILABLE_REASONS[id];
      const text: Msg = params === undefined ? { key: entry.key } : { key: entry.key, params };
      return { id, code: entry.code, text };
    },
  };
}

/** The key a button or a row prints: the main combination, or its fallback when the browser keeps the main one. */
export function printableHotkey(label: HotkeyLabel | null): Omit<HotkeyLabel, 'fallback'> | null {
  if (label === null) return null;
  if (label.delivery !== 'reserved') return label;
  return label.fallback !== null && label.fallback.delivery !== 'reserved' ? label.fallback : null;
}

/** Whether a catalog action is one the early dispatcher runs (the rest are local keys of our surfaces). */
export function isOutsideScheme(id: CatalogActionId): boolean {
  const key = ROWS[id].key;
  return key === null || !('scheme' in key);
}
