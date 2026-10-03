// What a tab may change through `settings.patch` (architecture.md §14 «Вкладка
// может запросить данные только для страниц своей привязки; фон перепроверяет
// её сам»). The persona of a page is reachable two ways — `persona.set` and
// the `personas` section of a settings patch — and both go through the same
// page check: a tab touches only the pages its own ChatSpace accounts are
// bound to. An extension page (the options page) is not limited here.

import { type CgCode } from '@cg/contracts/errors';
import { type SettingsPatch } from '@cg/contracts/settings';
import { type RpcSenderContext } from '@cg/platform';

import { type PageLookup } from './hub-data';

/** The code a tab's patch is refused with, or null when it may go on to the settings owner. */
export function personaPatchRefusal(patch: SettingsPatch, sender: RpcSenderContext, pageOf: (pageId: number, sender: RpcSenderContext) => PageLookup): CgCode | null {
  if (sender.kind !== 'tab' || patch.personas === undefined) return null;
  // Setting and removing alike: every page the patch names must be one of the tab's own.
  for (const key of Object.keys(patch.personas.byPageId)) {
    const page = pageOf(Number(key), sender);
    if (!page.ok) return page.code;
  }
  return null;
}
