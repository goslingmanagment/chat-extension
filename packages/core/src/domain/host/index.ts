// core/domain/host — how the rest of the extension reads the host contract
// report (architecture.md §6.2). An anchor is `ok`, `missing`, `shape` or
// `notYet` (contracts 1.10.0): ChatSpace has not created it yet, and that is
// expected now — its composer translator store comes with the page's first
// chat composer. A `notYet` anchor is no gap of the contract («Статус», the
// popup, client_health), but what reads it stays off until it comes.
//
// 1.15.0 (R20 F7): a report is of a site (`contractHostOf`), its anchors are
// where its site keeps them (`contractAnchorsOf`), and a reader that knows the
// site's expected set (`HostContractShape`: the tab's adapter, the extension
// pages' root) reads that set — an expected anchor the report does not name is
// `missing`, never «nothing to check» (FS-CTR-1).

import { contractAnchorsOf, type AnchorState, type CapabilityState, type ChatSpaceContractReport, type HostContractReport, type HostContractShape } from '@cg/contracts/host';

/** A gap of the contract: the anchor is gone or changed its shape (or reads as nothing known). `ok` and `notYet` are not. */
export function anchorGap(state: AnchorState | undefined): boolean {
  return state !== undefined && state !== 'ok' && state !== 'notYet';
}

/** Some anchor the report names is gone or changed: the dock says so beside its marks, whichever the site. */
export function contractBroken(report: HostContractReport): boolean {
  return Object.values(contractAnchorsOf(report)).some(anchorGap);
}

/**
 * The state of each anchor the site expects, in its order: an anchor the report does not name is `missing`. Without
 * the site's set (`null`) — the anchors the report names, as they are.
 */
export function expectedAnchors(report: HostContractReport, shape: Pick<HostContractShape, 'anchors'> | null): [string, AnchorState][] {
  const named = contractAnchorsOf(report);
  if (shape === null) return Object.entries(named);
  return shape.anchors.map((anchor) => [anchor, named[anchor] ?? 'missing']);
}

/** The anchors the site has not created yet, in the report's (or the expected set's) order. */
export function anchorsNotYet(report: HostContractReport, shape: Pick<HostContractShape, 'anchors'> | null = null): string[] {
  return expectedAnchors(report, shape)
    .filter(([, state]) => state === 'notYet')
    .map(([anchor]) => anchor);
}

/**
 * The preview send (X8) is off only because ChatSpace has not created yet what it reads: no chat composer has been
 * open in the page since it loaded. The host names that anchor as the reason of CG-SEND-HOST; the owner's switch,
 * a real break of another send anchor or the tap come first and say their own words. It lifts with the first chat
 * the person opens and stays lifted until the page reloads.
 */
export function previewSendWaitsForChat(report: HostContractReport): boolean {
  const capability = report.capabilities.previewSend;
  const anchor = capability.reason;
  if (capability.state !== 'off' || capability.code !== 'CG-SEND-HOST' || anchor === undefined) return false;
  return contractAnchorsOf(report)[anchor] === 'notYet';
}

/** A site's own capabilities beyond the shared ones (the block of its report); none for ChatSpace. */
export function siteCapabilitiesOf(report: HostContractReport): Readonly<Record<string, CapabilityState>> {
  return 'extensions' in report ? (report.extensions[report.host]?.capabilities ?? {}) : {};
}

/** Which receipt profile let X8 in on this tab, and how (contracts 1.11.0); null — none, an adapter that does not say, or a site without X8. */
export function receiptMatchOf(report: HostContractReport): NonNullable<ChatSpaceContractReport['receiptMatch']> | null {
  return ('receiptMatch' in report ? report.receiptMatch : undefined) ?? null;
}
