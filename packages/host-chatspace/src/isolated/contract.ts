// The host contract check (architecture.md §6.2): the anchors MAIN reports
// (ContractWire) plus the DOM ones the isolated side checks, folded into a
// HostContractReport — one state per anchor and per capability, each
// capability with its reason and the CG code the person sees. Pure: the
// HostPort recomputes it when an input changes (start, a new store, the first
// chat, a failed mount, a new build fingerprint) — never on a timer.
//
// Part A of R09 implements no WS tap, send observation, receipt or X8: those
// capabilities are `off` with reason `not-yet`, and their anchors (`wsFrames`,
// `receiptProfile`) are reported `missing` — unchecked, not broken.

import type { AnchorId, CapabilityState, HostCapability, HostContractReport } from '@cg/contracts/host';

type AnchorState = 'ok' | 'missing' | 'shape';

/** The ContractWire payload (contracts ContractWireSchema). */
export interface ContractWireInput {
  readonly build: string | null;
  readonly missing: readonly string[];
  readonly shape: readonly string[];
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
/** Part B anchors: not checked yet. */
const PART_B_ANCHORS: readonly AnchorId[] = ['wsFrames', 'receiptProfile'];
const NOT_YET: CapabilityState = { state: 'off', reason: 'not-yet' };

export function buildContractReport(input: ContractInput): HostContractReport {
  const { wire, dom } = input;
  const anchor = (id: AnchorId): AnchorState => {
    if (id === 'composerFrame' || id === 'draftKey' || id === 'theme') return dom[id];
    if (PART_B_ANCHORS.includes(id) || wire === null) return 'missing';
    return wire.missing.includes(id) ? 'missing' : wire.shape.includes(id) ? 'shape' : 'ok';
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
    sendObserve: NOT_YET,
    incoming: NOT_YET,
    navigate: route,
    theme: anchors.theme === 'ok' ? on : degraded('theme'),
    previewSend: NOT_YET,
    receipt: NOT_YET,
  };
  return { build: wire?.build ?? null, adapterVersion: input.adapterVersion, checkedAt: input.checkedAt, anchors, capabilities };
}

/** The same report but for `checkedAt`: whether listeners must hear about it. */
export function sameReport(a: HostContractReport, b: HostContractReport): boolean {
  return JSON.stringify({ ...a, checkedAt: 0 }) === JSON.stringify({ ...b, checkedAt: 0 });
}
