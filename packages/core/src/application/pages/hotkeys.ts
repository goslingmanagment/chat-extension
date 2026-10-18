// The hotkey reference of the options page (architecture.md §9.1, §9.9;
// ST-120, ST-121): read-only, from the vendored @chatgoose/hotkeys scheme —
// the same table the early dispatcher works by — plus the keys outside the
// scheme (Enter, ?, Esc, J/K, ⌘U…). A combination the browser keeps for
// itself is never shown as working: R17's delivery table (ActionCatalog)
// decides when the composition root has one; until then the risky ones are
// marked «не проверено» with their fallback.

import { hotkeyAriaShortcut, hotkeyLabel, hotkeysForClient, type HotkeyAction } from '@chatgoose/hotkeys';

import { type I18nKey } from '@cg/contracts/errors';
import { CATALOG_ACTION_IDS, type ActionCatalog, type CatalogActionId, type HotkeyDelivery, type HotkeyLabel, type HotkeyPlatform, type HotkeysBodyVM } from '@cg/contracts/vm';

import { msg } from './model';

/** Actions of the vendored scheme this client has (the scheme's own ids are catalog ids). */
export const SCHEME_ACTIONS: readonly HotkeyAction[] = hotkeysForClient('extension').map((def) => def.action);

export function inScheme(id: CatalogActionId): id is CatalogActionId & HotkeyAction {
  return (SCHEME_ACTIONS as readonly string[]).includes(id);
}

const key = (display: string, aria: string, delivery: HotkeyDelivery = 'delivered', fallback: HotkeyLabel['fallback'] = null): HotkeyLabel => ({ display, aria, delivery, fallback });

/** The label of a scheme action for the platform: «⌘E» / «Ctrl+E», «⌘⇧S» / «Ctrl+Alt+S». */
export function schemeHotkey(action: HotkeyAction, platform: HotkeyPlatform): HotkeyLabel {
  return key(hotkeyLabel(action, platform), hotkeyAriaShortcut(action, platform));
}

/** Keys outside the vendored scheme (§9.1 table); null — the action has no key (send: by design). */
export function outsideSchemeHotkey(id: CatalogActionId, platform: HotkeyPlatform): HotkeyLabel | null {
  const mac = platform === 'mac';
  const mod = (letter: string, name: string = letter): HotkeyLabel => (mac ? key(`⌘${letter}`, `Meta+${name}`) : key(`Ctrl+${letter}`, `Control+${name}`));
  const alt = (letter: string): Omit<HotkeyLabel, 'fallback'> => ({ display: mac ? `⌥${letter}` : `Alt+${letter}`, aria: `Alt+${letter}`, delivery: 'delivered' });
  const table: Partial<Record<CatalogActionId, HotkeyLabel | null>> = {
    palette: mod('K'),
    cheatsheet: key('?', '?'),
    close: key('Esc', 'Escape'),
    'part-step': key('↑ ↓', 'ArrowUp ArrowDown'),
    'variant-step': key('← →', 'ArrowLeft ArrowRight'),
    'insert-part': key('↵', 'Enter'),
    'copy-part': mod('C'),
    'open-and-insert': mod('↵', 'Enter'),
    'apply-fix': mod('↵', 'Enter'),
    'chat-next': key('J', 'J'),
    'chat-previous': key('K', 'K'),
    'fan-panel': key(']', ']'),
    search: key('/', '/'),
    // Firefox has its own meaning for these; whether the page gets them is measured by R17 (§9.1).
    'next-unread': { ...mod('U'), delivery: 'unverified', fallback: alt('U') },
    'quick-jump': { ...mod('1–9', '1'), delivery: 'unverified', fallback: alt('1–9') },
    // ⌘, is Firefox's own menu on macOS: the buttons in the popup and the dock do the same.
    settings: mac ? key('⌘,', 'Meta+,', 'reserved') : null,
  };
  return table[id] ?? null;
}

/** Labels of the reference rows when no ActionCatalog is given: the cheatsheet's own words. */
const ROW_LABELS: Record<CatalogActionId, I18nKey> = {
  reply: 'dock.action.reply',
  fix: 'dock.action.fix',
  hi: 'dock.action.hi',
  ping: 'dock.action.ping',
  review: 'dock.action.review',
  recap: 'dock.action.recap',
  coach: 'dock.action.coach',
  cancel: 'cheatsheet.row.cancel',
  help: 'cheatsheet.row.help',
  tone: 'cheatsheet.row.tone',
  split: 'cheatsheet.row.split',
  spenders: 'cheatsheet.row.spenders',
  newcomers: 'palette.item.newcomers',
  palette: 'cheatsheet.row.palette',
  cheatsheet: 'palette.item.cheatsheet',
  settings: 'palette.item.settings',
  close: 'common.close',
  'part-step': 'cheatsheet.row.nextPart',
  'variant-step': 'settings.hotkeys.row.variant',
  'insert-part': 'cheatsheet.row.insert',
  'copy-part': 'cheatsheet.row.copy',
  'open-and-insert': 'send.openAndInsert',
  send: 'send.button',
  'chat-next': 'cheatsheet.row.chatNext',
  'chat-previous': 'cheatsheet.row.chatPrevious',
  'fan-panel': 'fanPanel.label',
  'next-unread': 'cheatsheet.row.nextUnread',
  'quick-jump': 'quickJump.title',
  search: 'cheatsheet.row.search',
  notes: 'cheatsheet.row.notes',
  'apply-fix': 'cheatsheet.row.applyFix',
};

/** The key a page prints for an action: the catalog's when there is one, else the scheme's. */
export function hotkeyOf(id: CatalogActionId, platform: HotkeyPlatform, catalog?: ActionCatalog): HotkeyLabel | null {
  if (catalog !== undefined) return catalog.entry(id).hotkey;
  return inScheme(id) ? schemeHotkey(id, platform) : outsideSchemeHotkey(id, platform);
}

/** Every command in catalog order; the scheme's rows first in the page is the UI's grouping (`outsideScheme`). */
export function hotkeyRows(platform: HotkeyPlatform, catalog?: ActionCatalog): HotkeysBodyVM['rows'] {
  return CATALOG_ACTION_IDS.map((id) => ({
    id,
    label: msg(catalog?.entry(id).label ?? ROW_LABELS[id]),
    hotkey: hotkeyOf(id, platform, catalog),
    outsideScheme: !inScheme(id),
  }));
}
