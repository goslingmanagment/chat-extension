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
import { loadValidation } from './validation';

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
    started = startChatSpaceHost({ win, validation: loadValidation, redeem: (request) => (redeemed.push(request.kind), Promise.resolve(true)), drafts: { getItem: () => null }, firstSearchMs: 50 });
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

  it('[RB-008] [UI-019] ChatSpace renders the open chat’s composer again — after a pause, in one step: the first insert once the dock is back goes into the new field', async () => {
    const win = shimWindow();
    main = installMainBridge(win, { runtime: createMainRuntime });
    started = startChatSpaceHost({ win, validation: loadValidation, redeem: () => Promise.resolve(true), drafts: { getItem: () => null }, firstSearchMs: 50 });
    const host = await started.host;
    const dock = started.mounts.dock.host;
    await until(() => Boolean(host.identity()?.composerInstanceId) && host.mounts().dock.kind === 'in-flow', 'identity and dock');
    /** The person’s one «Вставить»: the draft read with the identity the port has now, then the guarded write. */
    const insertOnce = async (text: string, n: number) => {
      const identity = host.identity();
      if (!identity?.chat || !identity.composerInstanceId) throw new Error('no identity');
      const draft = await host.readDraft(identity);
      const now = Date.now();
      return host.insert({
        intentId: `00000000-0000-4000-8000-0000000000b${n}`,
        operationId: '00000000-0000-4000-8000-0000000000a2',
        part: { index: 0 },
        target: identity.chat,
        expected: { kind: 'open', documentEpoch: identity.documentEpoch, routeEpoch: identity.routeEpoch, composerInstanceId: identity.composerInstanceId, draftRevision: draft.revision, draftDigest: draft.digest },
        mode: 'replace',
        text,
        confirmationId: null,
        createdAt: now,
        expiresAt: now + 5000,
        cause: { kind: 'click', actionToken: `tok_stack_renew_00000${n}` },
      });
    };
    const first = page.all.find((composer) => composer.fan === '2002');
    if (!first) throw new Error('no composer');
    const before = host.identity()?.composerInstanceId;
    const routeEpoch = host.identity()?.routeEpoch;
    // MAIN's events of the start are out (it coalesces them, UI_EVENT_GAP_MS): none of them is read during the pause.
    await new Promise((resolve) => setTimeout(resolve, 50));

    // With a pause: the field is gone for a moment and comes back from new nodes; no store or cache action, no route.
    first.tab.remove();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = page.renderAgain(first);
    await until(() => second.root.firstChild === dock, 'the dock is back over the new field');
    // MAIN was asked to look again: the identity names the new field before any click.
    await until(() => host.identity()?.composerInstanceId !== before, 'the identity names the new field');
    expect(host.identity()?.routeEpoch).toBe(routeEpoch);
    expect(await insertOnce('after a pause', 1)).toMatchObject({ state: 'applied' });
    expect(second.editor?.text).toBe('after a pause');
    expect(first.calls).toEqual([]);

    // In one step: the old nodes are swapped for new ones in one render, the page is never without the field.
    const middle = host.identity()?.composerInstanceId;
    const third = page.renderAgain(second);
    await until(() => third.root.firstChild === dock, 'the dock is over the field swapped in one step');
    await until(() => host.identity()?.composerInstanceId !== middle, 'the identity names the field swapped in one step');
    expect(await insertOnce('in one step', 2)).toMatchObject({ state: 'applied' });
    expect(third.editor?.text).toBe('in one step');
    expect(second.calls).toEqual(['setText']);
    // The other chat’s field (a hidden tab) was never touched.
    expect(page.all.find((composer) => composer.fan === '2003')?.calls).toEqual([]);
    expect((await started.bridge)?.stats().rejected).toEqual({});
  });

  it('[RB-014] [RB-015] a chat switch is no re-render: the page shows the other chat’s field first — MAIN is asked nothing, and a chat left again before MAIN said anything keeps its composer', async () => {
    // CI on PR #16 (suite-switches, suite-dock under load): the dock went over the other chat's field on the page's
    // own change, that was taken for a re-render, MAIN's snapshot from the middle of the switch said «no composer yet»
    // and was taken as the composer. Back on the first chat MAIN had no event to send — it never repeats an equal
    // one —, and the dock stayed without its field: «copy only», no «Вставить».
    const win = shimWindow();
    const asked: string[] = [];
    main = installMainBridge(win, {
      runtime: (context) => {
        const runtime = createMainRuntime(context);
        return { handle: (t, payload) => (asked.push(t), runtime.handle(t, payload)), dispose: () => runtime.dispose() };
      },
    });
    started = startChatSpaceHost({ win, validation: loadValidation, redeem: () => Promise.resolve(true), drafts: { getItem: () => null }, firstSearchMs: 50 });
    const host = await started.host;
    const dock = started.mounts.dock.host;
    await until(() => Boolean(host.identity()?.composerInstanceId) && host.mounts().dock.kind === 'in-flow', 'identity and dock');
    const first = page.all.find((composer) => composer.fan === '2002');
    if (!first) throw new Error('no composer');
    const before = host.identity()?.composerInstanceId;
    // MAIN's events of the start are out (UI_EVENT_GAP_MS).
    await new Promise((resolve) => setTimeout(resolve, 50));
    const snapshots = (): number => asked.filter((t) => t === 'snapshot').length;
    const start = snapshots();

    // Another chat in a new ChatSpace tab: its field is rendered and shown at once; no store has told MAIN yet.
    page.show(first, false);
    const other = page.addComposer('1001', '2004');
    await until(() => other.root.firstChild === dock, 'the dock is over what the page shows');
    // …and the person is back on the first chat before MAIN looked: to MAIN nothing ever changed.
    await new Promise((resolve) => setTimeout(resolve, 10));
    page.showOnly('1001', '2002');
    await until(() => first.root.firstChild === dock, 'the dock is back over the first chat’s field');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(host.identity()).toMatchObject({ chat: { platformFanId: '2002' }, composerInstanceId: before });
    expect(host.current().composer).toMatchObject({ instanceId: before, ready: true });
    expect(host.mounts().dock).toMatchObject({ kind: 'in-flow', composerInstanceId: before });
    expect(snapshots()).toBe(start);

    // The ordinary switch: the field first, MAIN's report a moment later — its own events, no question.
    page.showOnly('1001', '2004');
    await new Promise((resolve) => setTimeout(resolve, 10));
    page.go('1001', '2004');
    await until(() => host.identity()?.chat?.platformFanId === '2004' && Boolean(host.identity()?.composerInstanceId), 'MAIN told of the other chat');
    await until(() => other.root.firstChild === dock, 'the dock is over the other chat’s field');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(host.identity()?.composerInstanceId).not.toBe(before);
    expect(snapshots()).toBe(start);
    expect((await started.bridge)?.stats().rejected).toEqual({});
  });

  it('[LG-008] the boot of the fourth live check: ChatSpace holds no such fan yet — MAIN says so once per change of its state, nothing is logged as a failure', async () => {
    // The export of 2026-10-08: on a reload of the tab, 30 «read-failed {request: [text len=3], failure: invalid-answer}»
    // in 1.85 s. MAIN answered `fan` with null — the open chat's fan was not in ChatSpace's map yet —, the bridge
    // client took that valid null for a broken answer, nothing was kept, and every look at the chat asked again.
    const win = shimWindow();
    const asked: string[] = [];
    main = installMainBridge(win, {
      runtime: (context) => {
        const runtime = createMainRuntime(context);
        return { handle: (t, payload) => (asked.push(t), runtime.handle(t, payload)), dispose: () => runtime.dispose() };
      },
    });
    // The open chat's fan is not in ChatSpace's map yet (its fans load after the chat).
    const map = page.cache.store['getQueryData'] as (key: readonly unknown[]) => Record<string, unknown> | undefined;
    const fans = { ...(map(['fansMap', '1001']) ?? {}) };
    delete fans['2002'];
    page.cache.silent(['fansMap', '1001'], fans);
    const diagnostics: Array<{ event: string; detail?: Readonly<Record<string, unknown>> }> = [];
    started = startChatSpaceHost({ win, validation: loadValidation, redeem: () => Promise.resolve(true), drafts: { getItem: () => null }, firstSearchMs: 50, onDiagnostic: (d) => diagnostics.push(d) });
    const host = await started.host;
    await until(() => host.identity()?.chat?.platformFanId === '2002', 'the chat is open');
    const chat = host.identity()?.chat;
    if (!chat) throw new Error('no chat');
    const fanReads = (): number => asked.filter((t) => t === 'fan').length;
    // The tab's views look at the chat on every change of anything (30 looks in the export), and the page's
    // history and chat list fill in meanwhile: what MAIN is asked follows the page's state, not the looks.
    const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));
    const look = async (times: number): Promise<void> => {
      for (let i = 0; i < times; i += 1) {
        expect(host.fan(chat)).toBeNull();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    };
    await settle();
    const start = fanReads();
    await look(15);
    await settle();
    expect(fanReads() - start).toBe(0);
    // A change of ChatSpace's state for the open chat: its history grows (a cache action MAIN hears) — asked again, once.
    const history = map(['chatMessages', '1001', '2002']);
    page.cache.set(['chatMessages', '1001', '2002'], history);
    await settle();
    await look(15);
    await settle();
    expect(fanReads() - start).toBe(1);
    // The fan comes into ChatSpace's map: the next change brings it.
    page.cache.set(['fansMap', '1001'], { ...fans, '2002': { id: '2002', name: 'Fan Two', customName: null, username: 'fan_two', isBlocked: false, canReceiveMessages: true, isRestricted: false, lastSeen: null } });
    await until(() => host.fan(chat)?.displayName === 'Fan Two', 'the fan arrived');
    expect(fanReads() - start).toBe(2);
    // A null is an answer: no record of a failed read, nothing counted as a broken answer.
    expect(diagnostics.filter((d) => d.event === 'read-failed')).toEqual([]);
    expect((await started.bridge)?.stats().invalidAnswers).toBe(0);
  });

  it('[AU-030] [ER-048] without MAIN the port still answers: not ready, nothing written', async () => {
    const win = shimWindow();
    const diagnostics: Array<{ event: string }> = [];
    started = startChatSpaceHost({ win, validation: loadValidation, redeem: () => Promise.resolve(true), handshakeTimeoutMs: 20, onDiagnostic: (d) => diagnostics.push(d) });
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
