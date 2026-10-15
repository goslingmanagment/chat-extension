// The isolated half of the R20 P7a harness, injected by a WebDriver BiDi
// preload script into a SANDBOX realm of the Fansly stand page (Firefox gives
// it Xray access to the page, as an isolated content script has): Fansly's own
// starter (`startFanslyTab`) — the shared client of host-kit over Fansly's
// schemas — connected to the MAIN world of the test build, and a consumer of
// MAIN's stream as the isolated world will be one from P7c on: it asks
// `fx.state`, acknowledges every batch (or none: a blocked consumer) and keeps
// what came. Every frame from MAIN passed the three stages of checks first; a
// frame that did not is in the client's counts.
//
// The spec drives it through `globalThis.__cgFanslyTap.call(method, argsJson)`.
// Nothing here talks to the network; the e2e network trap would catch it.

import type { FanslyBatch, FanslyHealth, FanslyState } from '@cg/contracts/bridge-messages-fansly';
import { startFanslyTab, type FanslyMainBridgeClient } from '@cg/host-fansly/isolated';
import * as validation from '@cg/host-fansly/isolated/validation';

/** How long the handshake waits: MAIN may come late (the late-install case). */
const HANDSHAKE_MS = 60_000;

const batches: FanslyBatch[] = [];
const gaps: unknown[] = [];
const faults: unknown[] = [];
let acking = true;
let client: FanslyMainBridgeClient | null = null;
let failure: string | null = null;
let states = 0;

const started = startFanslyTab({ win: window, validation: () => Promise.resolve(validation), handshakeTimeoutMs: HANDSHAKE_MS });
void started.bridge.then(
  (connected) => {
    if (connected === null) {
      failure = 'no MAIN';
      return;
    }
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

const need = (): FanslyMainBridgeClient => {
  if (client === null) throw new Error(`not connected to MAIN${failure === null ? '' : `: ${failure}`}`);
  return client;
};

const methods: Record<string, (...args: never[]) => unknown> = {
  ready: () => ({ connected: client !== null, started: states > 0, failure }),
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
  /** What the client dropped: frames refused at its first two stages, events and answers its schemas refused. */
  stats: () => need().stats(),
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
