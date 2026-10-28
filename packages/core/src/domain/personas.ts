// The persona a hub page is meant for (Telegram spec §5.5): the bootstrap page's `defaultPersonaKey`. A page the person
// assigned no persona to works with it; another one chosen is warned about («Для этой страницы задумана персона …»),
// never refused.

import { type BootstrapPage, type PersonaCatalogItem } from '@cg/contracts/hub';

/** The page's meant persona as the catalog has it, active; null — none meant, not in the catalog, or archived. */
export function defaultPersonaOf(page: Pick<BootstrapPage, 'defaultPersonaKey'> | null, catalog: readonly PersonaCatalogItem[]): PersonaCatalogItem | null {
  const key = page?.defaultPersonaKey;
  if (key === undefined) return null;
  return catalog.find((persona) => persona.key === key && persona.status === 'active') ?? null;
}
