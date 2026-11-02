// A fan on other pages of the agency as a row or a mark takes it from the hub's `otherPages`: the hub's choice and order,
// a page with a name. Nothing left: no field at all, so no mark.

import { type OtherPage } from '@cg/contracts/hub';
import { type OtherPageVM } from '@cg/contracts/vm';

export function otherPagesOf(pages: readonly OtherPage[] | undefined): { readonly otherPages?: readonly OtherPageVM[] } {
  const shown = (pages ?? []).filter((page) => page.pageLabel.trim() !== '');
  if (shown.length === 0) return {};
  return { otherPages: shown.map((page) => ({ pageLabel: page.pageLabel.trim(), grossMills: page.grossMills, lastFanMessageAt: page.lastFanMessageAt, relation: page.relation })) };
}
