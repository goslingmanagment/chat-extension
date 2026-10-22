// Fansly's contract report (docs/project-unite/architecture.md §7.7, §7.12;
// FS-CTR-1, FS-CTR-2): the report of the site's own shape — the seventeen
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
// creator. The person's send (R20 P7f) needs all of it: MAIN's creator for
// the receipt, its socket's frames for the echo, the field for the gesture's
// reading, the chat MAIN named. A file into the field (R20 P12c, the voice
// note's MP3) needs the field's chain, its own file input and its
// attachments, where Fansly shows the file after the person's «Upload», and
// the chat MAIN named; a broken one of the two anchors is a broken contract.
// The relay (P9c) is on with the tab's account, in a build that has its page. The vault (P13b) is on with MAIN's observer of the
// page's requests: its facts confirm every file. X8's preview send, its receipt and the cached chat list are no part
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
  /** R20 P9c: this build has the relay page of «Fansly через вкладку»; absent — no relay. */
  readonly relay?: boolean;
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
  // The send (§5.9): MAIN's receipt names the creator, its echo comes by the socket's frames; read at the field's gesture.
  const sendObserve = main ?? field ?? (anchors.frames === 'shape' ? broken('frames') : identity.state !== 'on' ? identity : observed);
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
    sendObserve,
    incoming: main ?? (identity.state !== 'on' ? identity : anchors.frames === 'shape' ? broken('frames') : anchors.socket === 'ok' && anchors.frames === 'ok' ? ON : degraded('socket')),
    navigate: identity,
    // The scheme and the palette are the page's own (P8d): once Fansly's theme controller has put its class on <html>.
    theme: dom.themeClass === 'ok' ? ON : degraded('themeClass'),
    previewSend: off('site'),
    receipt: off('site'),
    // 1.47.0: the voice note's MP3 through the field's own input and Fansly's upload modal (§7.10, P12c).
    fileAttach: main ?? field ?? (gone(dom.fileInput) ? broken('fileInput') : gone(dom.attachments) ? broken('attachments') : observed),
  };
  const own: Record<FanslyCapability, CapabilityState> = {
    freshness: observed,
    follows: main ?? (anchors.frames === 'shape' ? broken('frames') : anchors.socket === 'ok' && anchors.frames === 'ok' ? ON : degraded('socket')),
    headerSlot: main ?? (gone(dom.headerContact) ? broken('headerContact') : gone(dom.headerSubRow) ? broken('headerSubRow') : ON),
    // A file into the open vault album (P13b): the page's own input, confirmed by MAIN's facts of its requests (§7.11).
    vault: main ?? (anchors.xhr === 'shape' ? broken('xhr') : anchors.xhr === 'ok' ? ON : notReady('xhr')),
    // «Fansly через вкладку» (P9c): a frame for the account the tab is on — none without one.
    relay: input.relay === true ? identity : notReady('relay'),
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
