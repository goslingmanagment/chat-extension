// Fansly's own «Copied …» list, as its attach menu shows it (Spenders' «Рассылка»): the page's MediaService keeps it in
// localStorage under `media_service_copied_media` — `{copiedAccountMediaIds, copiedAccountMediaBundleIds}` (the
// 2026-10-12 bundle, main:30961-31009; the key's prefix is its StorageHelper's, main:856-868). «Copy» on a post's bundle
// adds to the second list at once. Read only, never written.
//
// Fansly's own loader puts the bundles of a stored list into the MEDIA list after a reload (main:30978, the 2026-10-22
// build too; seen live 2026-10-24 on the test model): the menu then shows them as «Copied Media». Read as it is stored:
// the person sees each item as Fansly names it.

export const COPIED_MEDIA_KEY = 'media_service_copied_media';
/** Far above a real list: the menu itself shows every item. */
const ITEMS_MAX = 50;
const ID = /^[1-9][0-9]{0,23}$/;

export interface CopiedItem {
  /** 2 — «Copied Bundle», 1 — «Copied Media». */
  readonly contentType: 1 | 2;
  readonly contentId: string;
}

const ids = (value: unknown): string[] => (Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && ID.test(id)) : []);

/** The page's list now, bundles first, each in the menu's order; empty — nothing copied, or the storage unreadable. */
export function readCopiedMedia(win: Window): CopiedItem[] {
  let raw: string | null;
  try {
    raw = win.localStorage.getItem(COPIED_MEDIA_KEY);
  } catch {
    return [];
  }
  if (raw === null) return [];
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return [];
  }
  const record = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {};
  const bundles = ids(record['copiedAccountMediaBundleIds']).map((contentId): CopiedItem => ({ contentType: 2, contentId }));
  const media = ids(record['copiedAccountMediaIds']).map((contentId): CopiedItem => ({ contentType: 1, contentId }));
  const seen = new Set<string>();
  return [...bundles, ...media].filter((item) => !seen.has(`${item.contentType}:${item.contentId}`) && seen.add(`${item.contentType}:${item.contentId}`)).slice(0, ITEMS_MAX);
}
