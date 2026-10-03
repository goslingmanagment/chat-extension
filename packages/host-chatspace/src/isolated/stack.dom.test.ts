// The whole adapter in one document (happy-dom): the MAIN boot with its
// runtime, the isolated bridge client, the mount manager, the theme reader
// and the HostPort, started the way a composition root starts them
// (startChatSpaceHost). happy-dom does not set MessageEvent.source or carry
// ports, so window messaging is shimmed; everything else is the real code.
// The real-browser run of the same stack is e2e/specs/host-adapter.e2e.ts.

import { HostContractReportSchema, MountPointsSchema } from '@cg/contracts/host';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installMainBridge, type MainBridgeHandle } from '../main/bridge';
import { createMainRuntime } from '../main/runtime';
import { createFakePage, seedCache, type FakePage } from '../testing/fake-page';
import { startChatSpaceHost, type StartedChatSpaceHost } from './start';

type Listener = (event: { source: unknown; data: unknown; ports: readonly unknown[] }) => void;

/** The page window as the adapter uses it, with its messaging shimmed: `source` is set, ports pass through. */
function shimWindow(): Window {
  const listeners = new Set<Listener>();
  const shim: Record<string, unknown> = {
    document,
    location: { origin: 'http://127.0.0.1:4100' },
    performance,
    crypto,
    MutationObserver,
    setTimeout: (callback: () => void, ms?: number) => setTimeout(callback, ms),
    clearTimeout: (handle: number) => clearTimeout(handle),
    requestAnimationFrame: (callback: (time: number) => void) => setTimeout(() => callback(performance.now()), 0),
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
    postMessage: (data: unknown, _origin: string, transfer: unknown[] = []) => {
      const event = { source: shim, data: structuredClone(data), ports: transfer };
      setTimeout(() => listeners.forEach((listener) => listener(event)), 0);
    },
  };
  return shim as unknown as Window;
}

let page: FakePage;
let main: MainBridgeHandle | null = null;
let started: StartedChatSpaceHost | null = null;

beforeEach(() => {
  page = createFakePage(document);
  seedCache(page.cache);
  page.addComposer('1001', '2002');
  page.addComposer('1001', '2003', { shown: false });
});

afterEach(async () => {
  (await started?.host)?.dispose();
  (await started?.bridge)?.close();
  main?.dispose();
  started = null;
  main = null;
});

const until = async (check: () => boolean, message: string): Promise<void> => {
  for (let i = 0; i < 200 && !check(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  if (!check()) throw new Error(message);
};

describe('[EX-008] [BG-002] the adapter end to end in one document', () => {
  it('[UI-001] [UI-019] comes up, docks in the active composer and inserts through MAIN', async () => {
    const win = shimWindow();
    main = installMainBridge(win, { runtime: createMainRuntime });
    const redeemed: string[] = [];
    started = startChatSpaceHost({ win, redeem: (request) => (redeemed.push(request.kind), Promise.resolve(true)), drafts: { getItem: () => null }, firstSearchMs: 50 });
    const host = await started.host;
    await until(() => Boolean(host.identity()?.composerInstanceId) && host.mounts().dock.kind === 'in-flow', 'identity and dock');
    expect(HostContractReportSchema.parse(host.probe()).capabilities.insert.state).toBe('on');
    expect(MountPointsSchema.parse(host.mounts()).dock.composerInstanceId).toBe(host.identity()?.composerInstanceId);
    const active = page.all.find((composer) => composer.fan === '2002');
    expect(active?.root.firstChild).toBe(started.mounts.dock.host);

    const identity = host.identity();
    if (!identity?.chat || !identity.composerInstanceId) throw new Error('no identity');
    const draft = await host.readDraft(identity);
    const now = Date.now();
    const receipt = await host.insert({
      intentId: '00000000-0000-4000-8000-0000000000a1',
      operationId: '00000000-0000-4000-8000-0000000000a2',
      part: { index: 0 },
      target: identity.chat,
      expected: { kind: 'open', documentEpoch: identity.documentEpoch, routeEpoch: identity.routeEpoch, composerInstanceId: identity.composerInstanceId, draftRevision: draft.revision, draftDigest: draft.digest },
      mode: 'replace',
      text: 'through the whole stack',
      confirmationId: null,
      createdAt: now,
      expiresAt: now + 5000,
      cause: { kind: 'click', actionToken: 'tok_stack_test_000001' },
    });
    expect(receipt).toMatchObject({ state: 'applied' });
    expect(active?.editor?.text).toBe('through the whole stack');
    expect(redeemed).toEqual(['insert']);
    expect(await host.focusComposer(host.identity() ?? identity)).toBe(true);

    // A chat switch reaches the dock through MAIN's events.
    page.showOnly('1001', '2003');
    page.go('1001', '2003');
    await until(() => host.identity()?.chat?.platformFanId === '2003' && Boolean(host.identity()?.composerInstanceId), 'switched');
    await until(() => page.all.find((composer) => composer.fan === '2003')?.root.firstChild === started?.mounts.dock.host, 'dock moved');
    expect((await started.bridge)?.stats().rejected).toEqual({});
  });

  it('[AU-030] [ER-048] without MAIN the port still answers: not ready, nothing written', async () => {
    const win = shimWindow();
    const diagnostics: Array<{ event: string }> = [];
    started = startChatSpaceHost({ win, redeem: () => Promise.resolve(true), handshakeTimeoutMs: 20, onDiagnostic: (d) => diagnostics.push(d) });
    const host = await started.host;
    expect(await started.bridge).toBeNull();
    expect(host.identity()).toBeNull();
    expect(host.probe().capabilities.identity).toMatchObject({ state: 'off', code: 'CG-HOST-NOT-READY' });
    expect(diagnostics).toContainEqual({ event: 'main-missing', code: 'CG-HOST-NOT-READY' });
    expect(host.theme().scheme).toBeDefined();
    expect(host.listCachedChats('1001', 5)).toEqual([]);
    expect(await host.focusComposer({} as never)).toBe(false);
  });
});
