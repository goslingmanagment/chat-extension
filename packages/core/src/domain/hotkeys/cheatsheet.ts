// The cheatsheet and the settings reference as data (architecture.md §9.9
// «Хоткеи», §10.2 CheatsheetVM; ui-design §4.21, §10; HK-032, HK-034, ST-120,
// ST-121): groups and rows straight from the ActionCatalog, so a key printed
// here is the key the dispatcher takes. A combination the browser keeps is
// printed with its fallback or not at all, with the note «браузер оставляет
// это сочетание себе»; ⌘⇧H says «пока убран»; «Отправить» says it has no key.

import { type I18nKey } from '@cg/contracts/errors';
import { DOCK_ACTION_IDS, type ActionCatalog, type CatalogActionId, type CheatsheetVM, type HotkeyLabel, type HotkeysBodyVM, type Msg } from '@cg/contracts/vm';

import { isOutsideScheme } from './catalog';

type Group = CheatsheetVM['groups'][number];
type RowVM = Group['rows'][number];

const msg = (key: I18nKey): Msg => ({ key });

/** The printed form of a row's key: a reserved main combination gives way to its fallback, or to nothing. */
function rowKey(label: HotkeyLabel | null): { readonly hotkey: HotkeyLabel | null; readonly reserved: boolean } {
  if (label === null || label.delivery !== 'reserved') return { hotkey: label, reserved: false };
  if (label.fallback !== null && label.fallback.delivery !== 'reserved') return { hotkey: { ...label.fallback, fallback: null }, reserved: true };
  return { hotkey: null, reserved: true };
}

function row(catalog: ActionCatalog, id: CatalogActionId, label?: I18nKey): RowVM {
  const entry = catalog.entry(id);
  const { hotkey, reserved } = rowKey(entry.hotkey);
  const note: Msg | null = entry.status === 'removed' ? msg('dock.helpRemoved') : reserved ? msg('dock.reason.hotkeyReserved') : null;
  return { label: msg(label ?? entry.label), hotkey, note };
}

const ESC: HotkeyLabel = { display: 'Esc', aria: 'Escape', delivery: 'delivered', fallback: null };

export function cheatsheetGroups(catalog: ActionCatalog): readonly Group[] {
  return [
    {
      id: 'ai',
      title: msg('cheatsheet.group.ai'),
      rows: [...DOCK_ACTION_IDS.map((id) => row(catalog, id)), row(catalog, 'help')],
    },
    {
      id: 'windows',
      title: msg('cheatsheet.group.windows'),
      rows: [row(catalog, 'palette'), row(catalog, 'spenders'), row(catalog, 'cheatsheet'), row(catalog, 'settings')],
    },
    { id: 'before', title: msg('cheatsheet.group.before'), rows: [row(catalog, 'tone'), row(catalog, 'split')] },
    {
      id: 'result',
      title: msg('cheatsheet.group.result'),
      rows: [row(catalog, 'cancel'), row(catalog, 'part-step'), row(catalog, 'insert-part'), row(catalog, 'copy-part'), { label: msg('cheatsheet.row.collapse'), hotkey: ESC, note: null }],
    },
    {
      id: 'navigation',
      title: msg('cheatsheet.group.navigation'),
      rows: [row(catalog, 'chat-next'), row(catalog, 'chat-previous'), row(catalog, 'next-unread'), row(catalog, 'quick-jump'), row(catalog, 'fan-panel')],
    },
    {
      id: 'preview',
      title: msg('preview.label'),
      rows: [
        row(catalog, 'reply'),
        row(catalog, 'fix'),
        row(catalog, 'hi'),
        row(catalog, 'ping'),
        row(catalog, 'open-and-insert'),
        // «Отправить» has no key by design: fan mail leaves only on a press of the button.
        { label: msg(catalog.entry('send').label), hotkey: null, note: msg('cheatsheet.row.sendNote') },
      ],
    },
  ];
}

/** `partial` — a combination is reserved or not yet measured on a real browser. */
export function cheatsheetView(catalog: ActionCatalog): CheatsheetVM {
  const unsure = catalog.entries().some((entry) => {
    const hotkey = entry.hotkey;
    return hotkey !== null && (hotkey.delivery === 'reserved' || hotkey.delivery === 'unverified');
  });
  return {
    view: unsure ? { s: 'partial', gaps: [] } : { s: 'ready' },
    platform: catalog.platform,
    groups: cheatsheetGroups(catalog),
    note: msg('cheatsheet.note'),
  };
}

/** Rows of the «Хоткеи» settings section: the whole catalog, the keys outside the vendored scheme marked (ST-120, ST-121). */
export function hotkeyReferenceRows(catalog: ActionCatalog): HotkeysBodyVM['rows'] {
  return catalog
    .entries()
    .filter((entry) => entry.hotkey !== null || entry.id === 'send')
    .map((entry) => ({ id: entry.id, label: msg(entry.label), hotkey: entry.hotkey, outsideScheme: isOutsideScheme(entry.id) }));
}
