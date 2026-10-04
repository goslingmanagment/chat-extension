// TEMPORARY (integration step M1, replaced by R17): an ActionCatalog without
// keys. The early hotkey dispatcher and the vendored scheme's labels are
// R17's; until they land, MountDeps still needs a catalog: every entry is
// labelled and none has a hotkey, so no surface prints a combination that
// nothing listens to. Reasons of unavailability are already the real ones
// (the frozen UNAVAILABLE_REASONS table).

import { type I18nKey } from '@cg/contracts/errors';
import {
  CATALOG_ACTION_IDS,
  UNAVAILABLE_REASONS,
  type ActionCatalog,
  type ActionCatalogEntry,
  type CatalogActionId,
  type HotkeyPlatform,
  type HotkeyScope,
} from '@cg/contracts/vm';

/** The seven AI actions carry their own label; the rest wait for R17's table. */
const LABELS: Readonly<Partial<Record<CatalogActionId, I18nKey>>> = {
  reply: 'dock.action.reply',
  fix: 'dock.action.fix',
  hi: 'dock.action.hi',
  ping: 'dock.action.ping',
  review: 'dock.action.review',
  recap: 'dock.action.recap',
  coach: 'dock.action.coach',
  cancel: 'common.cancelOp',
  tone: 'dock.option.tone',
  split: 'dock.option.split',
  settings: 'common.settings',
  close: 'common.close',
};

const GLOBAL: readonly CatalogActionId[] = ['spenders', 'palette', 'cheatsheet'];
const PREVIEW: readonly CatalogActionId[] = ['send', 'open-and-insert'];

export function createUnboundCatalog(platform: HotkeyPlatform): ActionCatalog {
  const scopeOf = (id: CatalogActionId): HotkeyScope => (GLOBAL.includes(id) ? 'global' : PREVIEW.includes(id) ? 'preview' : 'chat');
  const entries: readonly ActionCatalogEntry[] = CATALOG_ACTION_IDS.map((id) => ({
    id,
    label: LABELS[id] ?? 'dock.label',
    tooltip: null,
    hotkey: null,
    scope: scopeOf(id),
    status: id === 'help' ? 'removed' : 'active',
  }));
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return {
    platform,
    entry: (id) => byId.get(id) ?? { id, label: 'dock.label', tooltip: null, hotkey: null, scope: scopeOf(id), status: 'active' },
    entries: () => entries,
    reason(id, params) {
      const reason = UNAVAILABLE_REASONS[id];
      return { id, code: reason.code, text: params === undefined ? { key: reason.key } : { key: reason.key, params } };
    },
  };
}
