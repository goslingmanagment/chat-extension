// Mounts the Fansly stand page next to the neighbour in happy-dom, over a
// fake Fansly the test started (R20 P6d): the neighbour boots FIRST — as its
// boot script stands first in the served page's `<head>` — with its page parts
// run inline instead of loaded by `<script src>` (e2e loads them for real),
// then the stand app starts. Every global the neighbour touched is put back on
// unmount: tests of one file share a window.

import { createStandApp, type StandApp } from '../../../fixture-fansly/src/app';
import { installControl } from '../../../fixture-fansly/src/control';
import type { LiveOptions } from '../../../fixture-fansly/src/live';
import { FANSLY_STAND_GLOBAL, type FanslyStandControl } from '../../../fixture-fansly/src/protocol';
import type { FakeFansly } from '../index';
import { bootNeighbor } from './index';
import type { Injector, Isolated } from './isolated';
import type { MapPatchState } from './map-patch';
import { runPart } from './parts';
import { FBUDDY_IDS, FBUDDY_KEYS, NEIGHBOR_GLOBAL, neighborConfig, type NeighborConfig, type NeighborControl } from './protocol';
import { MANAGED } from './ui';

type View = Window & typeof globalThis;
const win: View = window;

/** The globals as they were before any neighbour: put back after each test. */
const NATIVE = {
  XMLHttpRequest: win.XMLHttpRequest,
  WebSocket: win.WebSocket,
  fetch: Reflect.get(win, 'fetch'),
  xhr: Object.getOwnPropertyDescriptors(win.XMLHttpRequest.prototype),
  mapSet: Reflect.get(Map.prototype, 'set') as unknown,
  mapDelete: Reflect.get(Map.prototype, 'delete') as unknown,
};

/** The parts inline: the bridge's element stays (as FBuddy's does), the hook's and the guard's leave no trace. */
export const inlineInjector: Injector = (part, facts, { id, keep }) => {
  if (keep) {
    const marker = document.createElement('script');
    marker.id = id;
    marker.type = 'text/plain';
    if (part === 'bridge') marker.setAttribute('data-fbuddy-version', '2');
    document.documentElement.append(marker);
  }
  runPart(win, part, facts);
  return Promise.resolve();
};

export interface NeighborStand {
  readonly app: StandApp;
  readonly control: FanslyStandControl;
  readonly neighbor: NeighborControl;
  readonly isolated: Isolated | null;
  unmount(): void;
}

export interface MountOptions {
  /** Runs the hooks' injection for `timing=first-xhr` (the test calls `run` when it likes); default — at once. */
  readonly afterFirstXhr?: (run: () => void) => void;
  readonly live?: LiveOptions;
  /** Defaults to the page's: `null` — a page with no fake Fansly. */
  readonly apiOrigin?: string | null;
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Everything a neighbour may have left: the hooks, the constructors, the Map patch, its keys and its elements. */
export function restoreNatives(): void {
  for (const key of [FBUDDY_KEYS.hookInstance, FBUDDY_KEYS.guardInstance]) (Reflect.get(win, key) as { dispose?: () => void } | undefined)?.dispose?.();
  // The hooks may have put own methods on a prototype that inherited them: those go, the original ones come back.
  const proto = NATIVE.XMLHttpRequest.prototype;
  for (const name of Reflect.ownKeys(proto)) if (!(name in NATIVE.xhr)) Reflect.deleteProperty(proto, name);
  for (const [name, descriptor] of Object.entries(NATIVE.xhr)) Object.defineProperty(proto, name, descriptor);
  win.XMLHttpRequest = NATIVE.XMLHttpRequest;
  win.WebSocket = NATIVE.WebSocket;
  Reflect.set(win, 'fetch', NATIVE.fetch);
  Reflect.set(Map.prototype, 'set', NATIVE.mapSet);
  Reflect.set(Map.prototype, 'delete', NATIVE.mapDelete);
  const registry = (Reflect.get(win, FBUDDY_KEYS.goalsRefresh) as MapPatchState | undefined)?.registry;
  if (registry !== null && registry !== undefined) {
    Reflect.deleteProperty(registry, 'set');
    Reflect.deleteProperty(registry, 'delete');
  }
  for (const key of [...Object.values(FBUDDY_KEYS), NEIGHBOR_GLOBAL]) Reflect.deleteProperty(win, key);
  for (const id of Object.values(FBUDDY_IDS)) document.getElementById(id)?.remove();
  // Its owner marks on the nodes that outlive a test (`<body>`, `<html>`).
  for (const node of [document.documentElement, document.body]) for (const name of Object.values(MANAGED)) node.removeAttribute(name);
}

/** The stand page with the neighbour in `config`, over `fake`. */
export async function mountWithNeighbor(fake: FakeFansly, path: string, config: Partial<NeighborConfig>, options: MountOptions = {}): Promise<NeighborStand> {
  history.replaceState(null, '', path);
  document.body.replaceChildren();
  document.documentElement.className = '';
  const apiOrigin = options.apiOrigin === undefined ? fake.apiOrigin : options.apiOrigin;
  const booted = bootNeighbor(win, {
    config: neighborConfig({ pollMs: 0, ...config }),
    apiOrigin,
    inject: inlineInjector,
    afterFirstXhr: options.afterFirstXhr ?? ((run) => run()),
  });
  // The inline chain settles in microtasks: in `load` timing the hooks are in before the page's first request.
  await tick();
  const root = document.createElement('app-root');
  document.body.append(root);
  const app = createStandApp(root, { server: { apiOrigin: fake.apiOrigin, socketUrl: fake.socketUrl, token: fake.token }, live: options.live ?? { ackDelay: 0 } });
  const installed = installControl(app);
  await new Promise<void>((resolve) => app.start(resolve));
  installed.markReady();
  const control = Reflect.get(win, FANSLY_STAND_GLOBAL) as FanslyStandControl | undefined;
  if (control === undefined) throw new Error('no stand control');
  return {
    app,
    control,
    neighbor: booted.control,
    isolated: booted.isolated,
    unmount: () => {
      app.destroy();
      booted.isolated?.stop();
      restoreNatives();
    },
  };
}
