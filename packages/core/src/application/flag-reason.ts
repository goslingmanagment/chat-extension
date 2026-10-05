// Why an owner switch is off on a page, in the words of a button's tooltip
// and of the toast of its key (docs/protocols/hub.md «Флаги: решает
// страница»; HK-026). The hub's reason picks the words: the master switch
// (`disabled` — one switch for the whole hub) is «ChatGoose выключен владельцем», a flag the owner
// left off is «функция выключена для страницы», a hub that does not serve
// the feature yet is not «выключена» at all. The ids stay the existing ones
// of `UNAVAILABLE_REASONS` (no new id for consumers to enumerate): only the
// text and the code differ. Keys and codes are written out here so that a
// chunk that needs one reason does not carry the whole catalog table.

import { type ReasonVM } from '@cg/contracts/vm';

import { type FlagState } from '../domain/ops/flags';

/** The owner's master switch is off (it is one for every page): every AI action carries this reason, and the dock says it once. */
export const PAGE_OFF_REASON: ReasonVM = { id: 'feature-disabled', code: 'CG-FEATURE-DISABLED', text: { key: 'dock.reason.pageOff' } };

const BY_REASON: Readonly<Record<string, ReasonVM>> = {
  disabled: PAGE_OFF_REASON,
  hub_not_ready: { id: 'feature-disabled', code: 'CG-HUB-CAPABILITY', text: { key: 'dock.reason.hubNotReady' } },
  platform_unsupported: { id: 'feature-disabled', code: 'CG-FEATURE-DISABLED', text: { key: 'dock.reason.platformUnsupported' } },
  client_outdated: { id: 'feature-disabled', code: 'CG-HUB-OUTDATED', text: { key: 'dock.reason.clientOutdated' } },
  binding_missing: { id: 'no-binding', code: 'CG-BINDING-MISSING', text: { key: 'dock.reason.noBinding' } },
  not_granted: { id: 'not-granted', code: 'CG-BINDING-NOT-GRANTED', text: { key: 'dock.reason.notGranted' } },
};

const FLAG_OFF: ReasonVM = { id: 'feature-disabled', code: 'CG-FEATURE-DISABLED', text: { key: 'dock.reason.featureDisabled' } };

/** The reason of a switch that is not usable; a reason this build does not know reads as «выключена для страницы». */
export function flagReasonVm(state: Pick<FlagState, 'reason'>): ReasonVM {
  const reason = state.reason;
  return (reason !== null && Object.prototype.hasOwnProperty.call(BY_REASON, reason) ? BY_REASON[reason] : undefined) ?? FLAG_OFF;
}
