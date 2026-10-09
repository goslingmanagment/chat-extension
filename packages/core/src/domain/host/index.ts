// core/domain/host — how the rest of the extension reads the host contract
// report (architecture.md §6.2). An anchor is `ok`, `missing`, `shape` or
// `notYet` (contracts 1.10.0): ChatSpace has not created it yet, and that is
// expected now — its composer translator store comes with the page's first
// chat composer. A `notYet` anchor is no gap of the contract («Статус», the
// popup, client_health), but what reads it stays off until it comes.

import { type HostContractReport } from '@cg/contracts/host';

type AnchorState = HostContractReport['anchors'][keyof HostContractReport['anchors']];

/** A gap of the contract: the anchor is gone or changed its shape (or reads as nothing known). `ok` and `notYet` are not. */
export function anchorGap(state: AnchorState | undefined): boolean {
  return state !== undefined && state !== 'ok' && state !== 'notYet';
}

/** The anchors ChatSpace has not created yet, in the report's order. */
export function anchorsNotYet(report: HostContractReport): string[] {
  return Object.entries(report.anchors)
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
  return (report.anchors as Readonly<Record<string, AnchorState | undefined>>)[anchor] === 'notYet';
}

/**
 * The X8 fuse (decision X25) keeps the preview send off in this tab: its host says CG-SEND-FUSE — the browser's fuse
 * holds this build, or MAIN tripped it in this document.
 */
export function previewSendFused(report: HostContractReport): boolean {
  return report.capabilities.previewSend.code === 'CG-SEND-FUSE';
}

/** Which receipt profile let X8 in on this tab, and how (contracts 1.11.0); null — none, or an adapter that does not say. */
export function receiptMatchOf(report: HostContractReport): NonNullable<HostContractReport['receiptMatch']> | null {
  return report.receiptMatch ?? null;
}
