// A fan's money on other pages of the agency as a row or a mark takes it from the hub's `otherPagesSpend`: the hub's
// order (the biggest first), a named page with a sum above zero. Nothing left: no field at all, so no mark.

import { type OtherPageSpend } from '@cg/contracts/hub';
import { type OtherPageSpendVM } from '@cg/contracts/vm';

export function otherPagesOf(spend: readonly OtherPageSpend[] | undefined): { readonly otherPages?: readonly OtherPageSpendVM[] } {
  const shown = (spend ?? []).filter((page) => page.grossMills > 0 && page.pageLabel.trim() !== '');
  return shown.length === 0 ? {} : { otherPages: shown.map((page) => ({ pageLabel: page.pageLabel.trim(), grossMills: page.grossMills })) };
}
