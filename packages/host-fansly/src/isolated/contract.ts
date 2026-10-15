// Fansly's contract report (docs/project-unite/architecture.md §7.7, §7.12;
// FS-CTR-1, FS-CTR-2): the report of the site's own shape — the sixteen
// shared capabilities and the block `extensions['fansly-web']` with every
// anchor and every capability of Fansly's own. Pure: the port recomputes it
// when an input changes (the bridge, MAIN's network anchors, the creator, the
// observation, the DOM anchors), never on a timer.
//
// Each capability degrades on its own (FS-CTR-2). Without MAIN nothing of the
// page's memory is there: the identity, the chat's window and the freshness
// are off with CG-HOST-NOT-READY («хост не подключён», ER-048, AU-030). A
// MAIN that cannot observe chats yet (it answers `fx.focus` with `not-ready`)
// leaves the window, the freshness and the insert off the same way — the
// honest «not yet»: the insert needs the open chat as MAIN names it, and the
// field where the chain says (R20 P7e); «Открыть и вставить» needs the
// creator. What only later work packages bring is `off` with the same code
// and its own name as the reason: the send's observation (P7f), the facts of
// new messages (P14a), the header's slot (P7d, P11a), a file into the field
// (P12c), the vault (P13b), the relay (P9c). X8's preview send, its receipt and the cached chat list are no part
// of Fansly (§7.7): off by design.
//
// The anchor names and the capability names are repeated here as literals:
// the contracts' modules that list them build their schemas at load, which the
// early bundle does not pay for (§3.1); contract.test.ts pins them to
// `FANSLY_ANCHOR_IDS`, `FANSLY_CAPABILITIES` and `HOST_CAPABILITIES`.

import type { FanslyContractWire } from '@cg/contracts/bridge-messages-fansly';
import type { FanslyAnchorId, FanslyCapability } from '@cg/contracts/fansly';
import type { FanslyContractReport } from '@cg/contracts/fansly-host';
import type { CapabilityState, HostCapability } from '@cg/contracts/host';

import type { AnchorState, DomAnchorStates } from './anchors';

/** The Fansly adapter's version in its report. */
export const FANSLY_ADAPTER_VERSION = '0.1.0';

/** The network anchors MAIN reports (`fx.contract`). */
export const NETWORK_ANCHORS = ['accountMe', 'socket', 'frames', 'xhr'] as const;
type NetworkAnchor = (typeof NETWORK_ANCHORS)[number];

/** Whether MAIN can observe chats: unknown until it answered `fx.focus`; `off` — it said `not-ready` (a MAIN before P7b). */
export type Observation = 'unknown' | 'ready' | 'off';

export interface FanslyContractInput {
  /** MAIN answered the handshake. */
  readonly bridge: boolean;
  readonly blocked?: 'legacy' | 'update' | null;
  /** MAIN's network anchors; null — no `fx.state` taken yet. */
  readonly wire: FanslyContractWire | null;
  /** The creator of `/account/me` is known. */
  readonly creator: boolean;
  readonly observation: Observation;
  readonly dom: DomAnchorStates;
  /** Fansly's build (`main.<hash>`); null — not seen. */
  readonly build: string | null;
  readonly adapterVersion: string;
  readonly checkedAt: number;
}

const ON: CapabilityState = { state: 'on' };
const notReady = (reason: string): CapabilityState => ({ state: 'off', reason, code: 'CG-HOST-NOT-READY' });
const broken = (reason: string): CapabilityState => ({ state: 'contractBroken', reason, code: 'CG-HOST-CONTRACT' });
const off = (reason: string): CapabilityState => ({ state: 'off', reason });
const degraded = (reason: string): CapabilityState => ({ state: 'degraded', reason });
const gone = (state: AnchorState): boolean => state === 'missing' || state === 'shape';
const MISSING_FIELD: CapabilityState = { state: 'off', reason: 'textarea', code: 'CG-HOST-COMPOSER-MISSING' };

export function buildFanslyReport(input: FanslyContractInput): FanslyContractReport {
  const { dom } = input;
  const network = (id: NetworkAnchor): AnchorState => (input.wire !== null ? input.wire.anchors[id] : input.bridge ? 'notYet' : 'missing');
  const anchors: Record<FanslyAnchorId, AnchorState> = { ...dom, accountMe: network('accountMe'), socket: network('socket'), frames: network('frames'), xhr: network('xhr') };

  const main = input.bridge ? null : notReady('bridge');
  const identity = main ?? (anchors.accountMe === 'shape' ? broken('accountMe') : input.creator ? ON : notReady('accountMe'));
  // `focus` — MAIN has not answered the route's focus yet; `observation` — it said it cannot observe chats (before P7b).
  const observed = main ?? (input.observation === 'ready' ? ON : notReady(input.observation === 'off' ? 'observation' : 'focus'));
  // The field where the chain says: a field outside it is no field to write into (FS-PLC-3: copy only).
  const field = gone(dom.container) || gone(dom.composer) || gone(dom.textarea) ? MISSING_FIELD : null;
  const capabilities: Record<HostCapability, CapabilityState> = {
    identity,
    route: ON,
    accounts: identity,
    // No container where the chain says: the dock floats over the field (FS-PLC-3).
    dockMount: gone(dom.container) ? degraded('container') : ON,
    insert: main ?? field ?? observed,
    draftRead: gone(dom.textarea) ? MISSING_FIELD : ON,
    chatWindow: observed,
    // Fansly's fresh text is the generation snapshot's (`freshness`), never `readVisibleTail`.
    freshText: off('snapshot'),
    fan: observed,
    chatList: off('chatList'),
    sendObserve: notReady('sendObserve'),
    incoming: notReady('incoming'),
    navigate: identity,
    // The page's own theme is read with P8d: until then the light scheme.
    theme: degraded('theme'),
    previewSend: off('site'),
    receipt: off('site'),
  };
  const own: Record<FanslyCapability, CapabilityState> = {
    freshness: observed,
    follows: main ?? (anchors.frames === 'shape' ? broken('frames') : anchors.socket === 'ok' && anchors.frames === 'ok' ? ON : degraded('socket')),
    headerSlot: notReady('headerSlot'),
    fileAttach: notReady('fileAttach'),
    vault: notReady('vault'),
    relay: notReady('relay'),
  };
  if (input.blocked) {
    for (const key of Object.keys(capabilities) as HostCapability[]) capabilities[key] = notReady(input.blocked);
    for (const key of Object.keys(own) as FanslyCapability[]) own[key] = notReady(input.blocked);
  }
  return {
    host: 'fansly-web',
    build: input.build,
    adapterVersion: input.adapterVersion,
    checkedAt: input.checkedAt,
    capabilities,
    extensions: { 'fansly-web': { anchors, capabilities: own } },
  };
}

/** Fansly's build as its page declares it: the hashed name of its `main` bundle (FS-CTR-3); null — not there (yet). */
const BUILD = /\/(main\.[0-9a-f]{8,32})\.js(?:[?#]|$)/;

export function buildOf(doc: Document): string | null {
  for (const script of doc.scripts) {
    const match = BUILD.exec(script.src);
    if (match?.[1] !== undefined) return match[1];
  }
  return null;
}
