// The cheatsheet and the settings reference as data (architecture.md §9.9
// «Хоткеи», §10.2 CheatsheetVM; ui-design §4.21, §10; HK-032, HK-034, ST-120,
// ST-121): groups and rows straight from the ActionCatalog, so a key printed
// here is the key the dispatcher takes. A combination the browser keeps is
// printed with its fallback or not at all, with the note «браузер оставляет
// это сочетание себе»; ⌘⇧H says «пока убран»; «Отправить» says it has no key.
// A row of a feature the site does not have (the feature manifest's `absent`,
// R20 §1.4) is not drawn — its key stays reserved, the dispatcher's business —
// and a group left without rows is not drawn either.

import { type I18nKey } from '@cg/contracts/errors';
import type { FeatureSlice } from '@cg/contracts/features/types';
import { DOCK_ACTION_IDS, type ActionCatalog, type CatalogActionId, type CheatsheetVM, type HotkeyLabel, type HotkeysBodyVM, type Msg } from '@cg/contracts/vm';

import { featurePresent } from '../features/admission';
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

/**
 * The feature of the manifest a row belongs to, where it is not the row's own id (an action of the dock, Spenders,
 * the palette and the fan panel are features by their own names). A row of no feature — the cheatsheet itself,
 * the settings, the keys of a result — is always there.
 */
const ROW_FEATURE: Readonly<Partial<Record<CatalogActionId, string>>> = {
  'chat-next': 'navigation',
  'chat-previous': 'navigation',
  'next-unread': 'navigation',
  'quick-jump': 'navigation',
  send: 'preview-send',
};
const FEATURE_ROWS: readonly CatalogActionId[] = [...DOCK_ACTION_IDS, 'spenders', 'palette', 'fan-panel'];

/** `features` — the site's slice of the manifest; without it (the settings page, which speaks for every site) every row is drawn. */
export function cheatsheetGroups(catalog: ActionCatalog, features?: FeatureSlice): readonly Group[] {
  const there = (id: CatalogActionId): boolean => {
    const feature = ROW_FEATURE[id] ?? (FEATURE_ROWS.includes(id) ? id : null);
    return features === undefined || feature === null || featurePresent(features, feature);
  };
  const rows = (...ids: CatalogActionId[]): RowVM[] => ids.filter(there).map((id) => row(catalog, id));
  const groups: Group[] = [
    {
      id: 'ai',
      title: msg('cheatsheet.group.ai'),
      rows: rows(...DOCK_ACTION_IDS, 'help'),
    },
    {
      id: 'windows',
      title: msg('cheatsheet.group.windows'),
      rows: rows('palette', 'spenders', 'cheatsheet', 'settings'),
    },
    { id: 'before', title: msg('cheatsheet.group.before'), rows: rows('tone', 'split') },
    {
      id: 'result',
      title: msg('cheatsheet.group.result'),
      rows: [...rows('cancel', 'part-step', 'insert-part', 'copy-part'), { label: msg('cheatsheet.row.collapse'), hotkey: ESC, note: null }],
    },
    {
      id: 'navigation',
      title: msg('cheatsheet.group.navigation'),
      rows: rows('chat-next', 'chat-previous', 'next-unread', 'quick-jump', 'fan-panel'),
    },
    {
      id: 'preview',
      title: msg('preview.label'),
      rows: [
        ...rows('reply', 'fix', 'hi', 'ping', 'open-and-insert'),
        // «Отправить» has no key by design: fan mail leaves only on a press of the button.
        ...(there('send') ? [{ label: msg(catalog.entry('send').label), hotkey: null, note: msg('cheatsheet.row.sendNote') }] : []),
      ],
    },
  ];
  return groups.filter((group) => group.rows.length > 0);
}

/**
 * `partial` — a combination is reserved or not yet measured on a real
 * browser (CheatsheetVM). The reason travels with the state: the gap is the
 * host's — the browser under ChatSpace does not, or may not, hand these
 * combinations to the page — and names no ChatSpace capability; the rows say
 * which combinations (their note and `HotkeyLabel.delivery`).
 */
export function cheatsheetView(catalog: ActionCatalog, features?: FeatureSlice): CheatsheetVM {
  const unsure = catalog.entries().some((entry) => {
    const hotkey = entry.hotkey;
    return hotkey !== null && (hotkey.delivery === 'reserved' || hotkey.delivery === 'unverified');
  });
  return {
    view: unsure ? { s: 'partial', gaps: [{ kind: 'host-degraded', capabilities: [] }] } : { s: 'ready' },
    platform: catalog.platform,
    groups: cheatsheetGroups(catalog, features),
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
