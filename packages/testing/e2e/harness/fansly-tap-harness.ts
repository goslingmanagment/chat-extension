// The isolated half of the R20 P7a/P7c harness, injected by a WebDriver BiDi
// preload script into a SANDBOX realm of the Fansly stand page (Firefox gives
// it Xray access to the page, as an isolated content script has), connected
// to the MAIN world of the test build. Two consumers, chosen before the page
// loads (`globalThis.__cgFanslyTapConsumer`, support/fansly-tap.ts):
// - `raw` (P7a): the shared client of host-kit over Fansly's schemas
//   (`connectFanslyMain`) and a consumer of MAIN's stream the spec drives —
//   it asks `fx.state`, acknowledges every batch (or none: a blocked
//   consumer) and keeps what came;
// - `port` (P7c): Fansly's own start (`startFanslyTab`), exactly as the
//   extension's isolated script starts it — the route by signals, the
//   anchors' observers, Fansly's HostPort over the stream — and what the port
//   says: its route, identity, accounts, composer, header slot, report and
//   counts. Never a text.
// Every frame from MAIN passed the three stages of checks first; a frame that
// did not is in the client's counts.
//
// The spec drives it through `globalThis.__cgFanslyTap.call(method, argsJson)`.
// Nothing here talks to the network; the e2e network trap would catch it.

import type { FanslyBatch, FanslyHealth, FanslyState } from '@cg/contracts/bridge-messages-fansly';
import type { HostEvent } from '@cg/contracts/host';
import { connectFanslyMain, startFanslyTab, type FanslyMainBridgeClient, type FanslyPort, type StartedFanslyTab } from '@cg/host-fansly/isolated';
import * as validation from '@cg/host-fansly/isolated/validation';

/** How long the handshake waits: MAIN may come late (the late-install case). */
const HANDSHAKE_MS = 60_000;

const consumer = (globalThis as { readonly __cgFanslyTapConsumer?: unknown }).__cgFanslyTapConsumer === 'port' ? 'port' : 'raw';
const load = (): Promise<typeof validation> => Promise.resolve(validation);

const batches: FanslyBatch[] = [];
const gaps: unknown[] = [];
const faults: unknown[] = [];
let acking = true;
let client: FanslyMainBridgeClient | null = null;
let failure: string | null = null;
let states = 0;

// ── raw: P7a's consumer ──

if (consumer === 'raw') {
  connectFanslyMain(window, load, HANDSHAKE_MS).then(
    (connected) => {
      client = connected;
      connected.onEvent((event) => {
        if (event.t === 'fx.batch') {
          batches.push(event.payload);
          if (acking) connected.request('fx.ack', { n: event.payload.n }).catch((error: unknown) => (failure = `ack: ${String(error)}`));
        } else if (event.t === 'fx.gap') gaps.push(event.payload);
        else faults.push(event.payload);
      });
      // The stream starts with the isolated side's first `fx.state`.
      connected.request('fx.state', {}).then(
        () => (states += 1),
        (error: unknown) => (failure = `fx.state: ${String(error)}`),
      );
    },
    (error: unknown) => (failure = String(error)),
  );
}

// ── port: Fansly's own start (P7c) ──

let started: StartedFanslyTab | null = null;
let port: FanslyPort | null = null;
/** What the port said, in order: the event's type and, for a route, its epoch and group — no text, no fan. */
const said: Array<{ readonly type: HostEvent['type']; readonly epoch?: number; readonly group?: string | null }> = [];
const diagnostics: Array<{ readonly event: string }> = [];

if (consumer === 'port') {
  started = startFanslyTab({ win: window, validation: load, handshakeTimeoutMs: HANDSHAKE_MS, onDiagnostic: (diagnostic) => diagnostics.push({ event: diagnostic.event }) });
  void started.bridge.then((connected) => {
    client = connected;
    if (connected === null) failure = 'no MAIN';
  });
  started.host.then(
    (ready) => {
      port = ready;
      ready.subscribe((event) => said.push(event.type === 'route' ? { type: 'route', epoch: event.route.epoch, group: event.route.conversationRef ?? null } : { type: event.type }));
    },
    (error: unknown) => (failure = String(error)),
  );
}

const need = (): FanslyMainBridgeClient => {
  if (client === null) throw new Error(`not connected to MAIN${failure === null ? '' : `: ${failure}`}`);
  return client;
};
const needPort = (): FanslyPort => {
  if (port === null) throw new Error(`no host port${failure === null ? '' : `: ${failure}`}`);
  return port;
};

const methods: Record<string, (...args: never[]) => unknown> = {
  ready: () => ({ connected: client !== null, started: consumer === 'port' ? port !== null : states > 0, failure }),
  probe: () => need().probe(),
  state: (): Promise<FanslyState> => need().request('fx.state', {}).finally(() => (states += 1)),
  health: (): Promise<FanslyHealth> => need().request('fx.health', {}),
  /** The events of every batch so far, from the `from`-th on, each with its batch's number. */
  events: (from = 0) => batches.flatMap((batch) => batch.events.map((event) => ({ n: batch.n, t: event.t, p: event.p }))).slice(from),
  batches: () => batches.map((batch) => ({ n: batch.n, events: batch.events.length })),
  gaps: () => gaps,
  faults: () => faults,
  setAcking: (on: boolean) => {
    acking = on;
    return acking;
  },
  ack: (n: number) => need().request('fx.ack', { n }),
  /** The isolated side's route (P7b): MAIN answers with `fx.chat` of the group. */
  focus: (groupId: string | null, routeEpoch: number) => need().request('fx.focus', { groupId, routeEpoch }),
  windowMeta: (groupId: string) => need().request('fx.windowMeta', { groupId }),
  /** A generation snapshot as a click asks it (§5.8), with the round trip the isolated side sees. */
  snapshot: async (request: { groupId: string; feature: 'reply' | 'hi' | 'recap'; window: number; withText: boolean }) => {
    const started = performance.now();
    const snapshot = await need().request('fx.generationSnapshot', request);
    return { snapshot, roundTripMs: performance.now() - started };
  },
  /** What the client dropped: frames refused at its first two stages, events and answers its schemas refused. */
  stats: () => need().stats(),

  // ── the port (P7c) ──
  /** What the port says now: route, identity, accounts, the composer's shape, the header slot, the anchors found. */
  port: () => {
    const now = needPort().current();
    const anchors = started?.anchors.current();
    return {
      route: now.route,
      identity: now.identity,
      accounts: now.accounts,
      composer: now.composer === null ? null : { instanceId: now.composer.instanceId, ready: now.composer.ready, hidden: now.composer.hidden },
      slot: needPort().fansly.headerSlot(),
      anchors: {
        conversation: Boolean(anchors?.conversation),
        container: Boolean(anchors?.conversation?.container),
        textarea: Boolean(anchors?.conversation?.textarea),
        gallery: anchors?.conversation?.gallery === true,
      },
    };
  },
  /** Where Fansly's start put our dock host (P7d): its moves and removals, and the mount points the port says. */
  dock: () => ({ stats: started?.mounts.stats() ?? null, points: needPort().mounts() }),
  report: () => needPort().probe(),
  portHealth: () => needPort().health(),
  /** A verification without a signal, as an action of our UI makes one (FS-RTE-3); the route's counts after it. */
  verify: () => {
    started?.route.verify('ui');
    return started?.route.stats() ?? null;
  },
  said: (from = 0) => said.slice(from),
  /** The open chat's generation snapshot through the port, as a click asks it — its shape only, never a text. */
  portSnapshot: async (feature: 'reply' | 'recap', withText: boolean) => {
    const now = needPort().current().route;
    if (now.chat === null || now.conversationRef === undefined) return null;
    const snapshot = await needPort().freshness.snapshot(now.chat, { conversationRef: now.conversationRef, feature, window: 60, withText });
    return snapshot === null
      ? null
      : { feature: snapshot.feature, group: snapshot.identity.groupId, fan: snapshot.identity.fanId, completeness: snapshot.completeness, window: snapshot.window.length, tail: snapshot.tail?.length ?? null };
  },
  diagnostics: () => diagnostics,
};

Object.defineProperty(globalThis, '__cgFanslyTap', {
  value: {
    call: async (method: string, argsJson: string): Promise<string> => {
      const fn = methods[method];
      if (fn === undefined) throw new Error(`no harness method ${method}`);
      const result: unknown = await fn(...(JSON.parse(argsJson) as never[]));
      return JSON.stringify(result ?? null);
    },
  },
});
