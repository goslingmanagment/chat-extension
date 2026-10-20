// The host contract check (architecture.md §6.2): the anchors MAIN reports
// (ContractWire) plus the DOM ones the isolated side checks, folded into a
// HostContractReport — one state per anchor and per capability, each
// capability with its reason and the CG code the person sees. Pure: the
// HostPort recomputes it when an input changes (start, a new store, the first
// chat, a failed mount, a new build fingerprint, the flags, the loaded
// modules) — never on a timer.
//
// The live capabilities (§6.6–§6.8) need the tap script, which the
// background registers only while the `wsTap` flag is on:
// - `incoming` — facts of new messages: on while the current socket's frames
//   read well, degraded until then (sound falls back to the stores);
// - `sendObserve` — a human send with its receipt (§6.6);
// - `receipt` — a bootstrap profile matches the loaded send-path modules (§6.2);
// - `previewSend` — X8: its flag, every anchor a condition is read from, the
//   tap, and the receipt profile (the fuse of decision X25 holds nothing since
//   2026-10-21). The socket being armed is not part
//   of it: that is the preflight's answer (CG-SEND-FRESHNESS), the capability
//   does not flap with reconnects.
// The report names the profile that matched and how (`receiptMatch`: a
// reviewed build or the hub's «any build» sentinel), so «Статус», the logs and
// client_health can tell X8 runs on a build nobody reviewed.
// An anchor ChatSpace creates later (`notYet`: the composer translator store
// before the page's first chat composer) is no break of the contract, but X8
// stays off until it comes (CG-SEND-HOST, the anchor as the reason). A real
// break of another send anchor is named first: opening a chat would not lift it.

import type { AnchorId, CapabilityState, ChatSpaceContractReport, HostCapability } from '@cg/contracts/host';

import type { ReceiptMatch } from './receipt-profile';

type AnchorState = 'ok' | 'missing' | 'shape' | 'notYet';

/** The ContractWire payload (contracts ContractWireSchema). */
export interface ContractWireInput {
  readonly build: string | null;
  readonly missing: readonly string[];
  readonly shape: readonly string[];
  /** Not there yet, as expected before the first chat composer (1.10.0); absent — a MAIN before it. */
  readonly notYet?: readonly string[] | undefined;
}

export interface ContractInput {
  /** MAIN's view; null — no bridge or no runtime yet. */
  readonly wire: ContractWireInput | null;
  /** The DOM anchors checked on this side. */
  readonly dom: { readonly composerFrame: AnchorState; readonly draftKey: AnchorState; readonly theme: AnchorState };
  /** The route's account has its platformAccountId (the only key that binds a hub page). */
  readonly accountBound: boolean;
  readonly adapterVersion: string;
  readonly checkedAt: number;
  /** The live side; absent — no tap script, flags not known, no profile. */
  readonly live?: {
    /** The tap script is in the page and was not switched off. */
    readonly tap: boolean;
    /** Bootstrap flag `previewSend`, as the composition root configured it. */
    readonly previewSend: boolean;
    /** A bootstrap receipt profile matches the modules the page loaded. */
    readonly receipt: boolean;
    /** Which one, and how (reported while `receipt`). */
    readonly receiptMatch?: ReceiptMatch | null;
  };
}

/** contracts ANCHOR_IDS, in order. */
const ANCHORS: readonly AnchorId[] = [
  'app',
  'router',
  'accounts',
  'composerBridge',
  'composerFrame',
  'chatMessages',
  'fansMap',
  'pendingMessages',
  'draftKey',
  'wsFrames',
  'chatList',
  'composerTranslator',
  'mimic',
  'userPermissions',
  'receiptProfile',
  'theme',
];
/**
 * Anchors an X8 condition is read from (§6.2, §6.7.4): one that is not ok keeps the preview send off. Mimic and the
 * translator are not among them (2026-10-20 audit, row 14): MAIN refuses only when their data says they are on.
 */
const SEND_ANCHORS: readonly AnchorId[] = ['accounts', 'pendingMessages', 'userPermissions'];

export function buildContractReport(input: ContractInput): ChatSpaceContractReport {
  const { wire, dom } = input;
  const live = input.live ?? { tap: false, previewSend: false, receipt: false };
  const anchor = (id: AnchorId): AnchorState => {
    if (id === 'composerFrame' || id === 'draftKey' || id === 'theme') return dom[id];
    if (id === 'receiptProfile') return live.receipt ? 'ok' : 'missing';
    if (wire === null) return 'missing';
    return wire.missing.includes(id) ? 'missing' : wire.shape.includes(id) ? 'shape' : wire.notYet?.includes(id) === true ? 'notYet' : 'ok';
  };
  const anchors = Object.fromEntries(ANCHORS.map((id) => [id, anchor(id)])) as Record<AnchorId, AnchorState>;

  const on: CapabilityState = { state: 'on' };
  const notReady: CapabilityState = { state: 'off', reason: wire === null ? 'bridge' : 'app', code: 'CG-HOST-NOT-READY' };
  const broken = (reason: string): CapabilityState => ({ state: 'contractBroken', reason, code: 'CG-HOST-CONTRACT' });
  const off = (reason: string): CapabilityState => ({ state: 'off', reason });
  const degraded = (reason: string): CapabilityState => ({ state: 'degraded', reason });

  const appUp = wire !== null && anchors.app === 'ok';
  const route = !appUp ? notReady : anchors.router === 'ok' ? on : broken('router');
  const accounts = !appUp ? notReady : anchors.accounts === 'ok' ? on : anchors.accounts === 'shape' ? broken('accounts') : off('accounts');
  const identity = route.state !== 'on' ? route : accounts.state !== 'on' ? accounts : input.accountBound ? on : off('platformAccountId');
  const composer = (whenOk: CapabilityState): CapabilityState =>
    route.state !== 'on'
      ? route
      : anchors.composerBridge === 'missing'
        ? { state: 'off', reason: 'composerBridge', code: 'CG-HOST-COMPOSER-MISSING' }
        : anchors.composerBridge === 'shape'
          ? // The bridge works but the editor behind it is not observable: no CAS promise (§6.4).
            degraded('editor')
          : whenOk;
  const cached = (id: AnchorId): CapabilityState => (route.state !== 'on' ? route : anchors[id] === 'ok' ? on : off(id));
  const coded = (state: 'off' | 'degraded', reason: string, code: CapabilityState['code']): CapabilityState => ({ state, reason, ...(code ? { code } : {}) });
  const noTap = coded('off', 'wsTap', 'CG-SEND-FRESHNESS');
  // The send path is the tap script's (the receipt observer): without it nothing is sent from the preview at all.
  const noTapSend = coded('off', 'wsTap', 'CG-SEND-OFF');
  const incoming = route.state !== 'on' ? route : !live.tap ? noTap : anchors.wsFrames === 'ok' ? on : coded('degraded', 'wsFrames', 'CG-SEND-FRESHNESS');
  const sendObserve = route.state !== 'on' ? route : anchors.pendingMessages !== 'ok' ? coded('off', 'pendingMessages', 'CG-SEND-HOST') : !live.tap ? noTap : on;
  const receipt = live.receipt ? on : coded('off', 'receiptProfile', 'CG-SEND-RECEIPT');
  const brokenSendAnchor = SEND_ANCHORS.find((id) => anchors[id] === 'missing' || anchors[id] === 'shape') ?? SEND_ANCHORS.find((id) => anchors[id] === 'notYet');
  const previewSend =
    route.state !== 'on'
      ? route
      : !live.previewSend
        ? coded('off', 'flag', 'CG-SEND-OFF')
        : brokenSendAnchor
          ? coded('off', brokenSendAnchor, 'CG-SEND-HOST')
          : !live.tap
            ? noTapSend
            : receipt;

  const capabilities: Record<HostCapability, CapabilityState> = {
    identity,
    route,
    accounts,
    dockMount: route.state !== 'on' ? route : anchors.composerFrame === 'ok' ? on : degraded('composerFrame'),
    insert: composer(on),
    draftRead: composer(anchors.draftKey === 'ok' ? on : degraded('draftKey')),
    chatWindow: cached('chatMessages'),
    freshText: cached('chatMessages'),
    fan: cached('fansMap'),
    chatList: cached('chatList'),
    sendObserve,
    incoming,
    navigate: route,
    theme: anchors.theme === 'ok' ? on : degraded('theme'),
    previewSend,
    receipt,
  };
  const match = live.receipt ? live.receiptMatch : null;
  return {
    build: wire?.build ?? null,
    adapterVersion: input.adapterVersion,
    checkedAt: input.checkedAt,
    anchors,
    capabilities,
    ...(match ? { receiptMatch: { profile: match.profile, kind: match.kind } } : {}),
  };
}
