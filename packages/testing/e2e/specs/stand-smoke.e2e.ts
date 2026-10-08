// R02 smoke (architecture.md §12 п. 3–4): the test build on the
// ChatSpace-like fixture, nobody signed in. Proves the harness, not the
// features: the content scripts attach to the stand, the dock's mount point
// is the single active composer and moves with the route, the network trap
// catches an outside request of a page (BiDi log and egress sink) and of the
// background (egress sink only), and the stand renders for visual checks.
// The signed-in path (the fake hub, the WS tap by its flag) is
// integration-m1.e2e.ts.

import { existsSync } from 'node:fs';

import { browser, expect } from '@wdio/globals';

import { EGRESS_PROBE_HOST, EGRESS_PROBE_KEY } from '../support/constants';
import { installTestBuild, waitForReport, writeLocalStorage } from '../support/extension';
import { testBuildPage } from '../support/fake-hub';
import { useNetworkTrap } from '../support/network-trap';
import { callStand, chatPath, composerRoots, dockPlacement, foreignCalls, openStand, STAND_IDS, standServer, waitForChatReady, waitForStandReady } from '../support/stand';
import { saveStandSnapshots, SNAPSHOT_VIEWPORTS } from '../support/visual';

const { a: accountA } = STAND_IDS.accounts;
const { a1, a2 } = STAND_IDS.fans;

describe('stand smoke — the test build on the ChatSpace-like fixture', () => {
  const { trap } = useNetworkTrap();
  let journalStart = 0;

  /** Takes egress attempts until the probe `host` shows up; returns the distinct hosts taken (the browser may retry a probe). */
  const takeEgressUntil = async (host: string): Promise<string[]> => {
    trap().expectProbeHost(host);
    const hosts: string[] = [];
    await browser.waitUntil(
      async () => {
        hosts.push(...(await trap().takeEgress()).map((attempt) => attempt.host ?? attempt.line));
        return hosts.includes(host);
      },
      { timeout: 5000, interval: 100, timeoutMsg: `the egress sink saw no request to ${host}` },
    );
    return [...new Set(hosts)];
  };

  before(async () => {
    await standServer.reset();
    journalStart = await standServer.mark();
    await installTestBuild();
    await openStand(chatPath(accountA, a1));
    await waitForStandReady();
    await waitForChatReady(accountA, a1);
  });

  after(async () => {
    // §12 «Гейт безопасности»: nothing but the page's own client and the harness talked to the stand.
    const entries = (await standServer.journal(journalStart)).entries;
    expect(foreignCalls(entries)).toEqual([]);
  });

  it('the fixture exposes the host contract the bridge reads (§6.1, §6.3)', async () => {
    const contract = await browser.execute((openFan: string) => {
      type Store = Record<string, unknown> & { $onAction?: unknown };
      const app = document.querySelector<HTMLElement & { __vue_app__?: { config: { globalProperties: Record<string, unknown> } } }>('#app')?.__vue_app__;
      const props = app?.config.globalProperties ?? {};
      const router = props['$router'] as { currentRoute: { value: { name: unknown; params: Record<string, unknown> } }; afterEach?: unknown; push?: unknown } | undefined;
      const pinia = props['$pinia'] as { _s: Map<string, Store>; use?: unknown } | undefined;
      const store = (id: string): Store | undefined => pinia?._s.get(id);
      const cache = store('_pc_query') as (Store & { getQueryData: (key: unknown[]) => unknown }) | undefined;
      const accounts = cache?.getQueryData(['accounts']) as Array<{ id: number; platformAccountId: string }> | undefined;
      const slot = [...document.querySelectorAll<HTMLElement>('[data-id="browser-composer-translator"]')].find((node) => node.offsetParent !== null) as
        | (HTMLElement & { __omComposerBridge?: Record<string, unknown> })
        | undefined;
      const prose = slot?.closest('.composer-frame')?.querySelector<HTMLElement & { editor?: { on?: unknown } }>('.ProseMirror');
      const pending = store('pendingMessages');
      return {
        route: { name: router?.currentRoute.value.name, params: router?.currentRoute.value.params, afterEach: typeof router?.afterEach, push: typeof router?.push },
        piniaUse: typeof pinia?.use,
        pendingActions: ['enqueue', 'cancel', 'resend', 'confirmEchoedMessage', 'resetForAccount', 'resetAll'].filter((name) => typeof pending?.[name] === 'function'),
        pendingState: [typeof pending?.['messagesByAccountId'], typeof pending?.['processingByAccountId'], typeof pending?.$onAction],
        stores: ['accounts', 'chats', 'chatList', 'chatMessages', 'chatTabEntries', 'tabEntries', 'composerTranslator'].filter((id) => store(id) !== undefined),
        cacheActions: ['getQueryData', 'setQueryData', 'invalidateQueries', 'getEntries'].filter((name) => typeof cache?.[name] === 'function'),
        account: accounts?.[0],
        historyCached: Array.isArray((cache?.getQueryData(['chatMessages', String(accounts?.[0]?.id), openFan]) as { pages?: unknown } | undefined)?.pages),
        bridge: Object.keys(slot?.__omComposerBridge ?? {}).sort(),
        frameRoot: slot?.closest('.composer-frame.overflow-hidden')?.parentElement?.classList.contains('relative') ?? false,
        strip: slot?.closest('.h-10') !== null,
        editorHandle: typeof prose?.editor?.on,
        theme: { dark: document.documentElement.classList.contains('dark'), neutral0: document.documentElement.style.getPropertyValue('--color-om-neutral-0') },
      };
    }, a1);
    expect(contract.route).toEqual({ name: 'chat', params: { accountId: accountA, chatId: a1 }, afterEach: 'function', push: 'function' });
    expect(contract.piniaUse).toBe('function');
    expect(contract.pendingActions).toHaveLength(6);
    expect(contract.pendingState).toEqual(['object', 'object', 'function']);
    expect(contract.stores).toHaveLength(7);
    expect(contract.cacheActions).toHaveLength(4);
    expect(contract.account).toMatchObject({ id: Number(accountA), platformAccountId: STAND_IDS.platformAccounts.a });
    expect(contract.historyCached).toBe(true);
    expect(contract.bridge).toEqual(['focus', 'insertMessage', 'insertText', 'setText']);
    expect(contract.frameRoot).toBe(true);
    expect(contract.strip).toBe(true);
    expect(contract.editorHandle).toBe('function');
    expect(contract.theme.dark).toBe(true);
    expect(contract.theme.neutral0).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
  });

  it('the test build attaches: MAIN bridge at document_start, the tab registers, the dock mounts in the active composer; no WS tap without a sign-in', async () => {
    const report = await waitForReport((r) => (r.main !== undefined && r.dock !== undefined) || r.appError !== undefined || r.runtimeError !== undefined || r.mainError !== undefined, 'MAIN probe and dock');
    expect(report.mainError).toBeUndefined();
    expect(report.appError).toBeUndefined();
    expect(report.runtimeError).toBeUndefined();
    expect(report.main?.readyStateAtStart).toBe('loading');
    // Registered once: the background did not start again under the tab.
    expect(report.rpc).toEqual({ state: 'ready', registered: true, registrations: 1 });
    // The tap is registered only by the bootstrap flag of a sign-in (§6.8 п. 10).
    expect(report.main?.wsTap).toBe(false);
    expect(await browser.execute(() => Object.prototype.hasOwnProperty.call(window, Symbol.for('wsTap')))).toBe(false);
    const sockets = (await standServer.state()).sockets;
    expect(sockets.some((socket) => socket.label === 'native' && socket.authenticated && socket.accounts.includes(accountA))).toBe(true);

    const roots = await composerRoots();
    expect(roots.active).toHaveLength(1);
    const dock = await dockPlacement();
    expect(dock).toEqual({ hosts: 1, parentKey: roots.active[0], firstChild: true, visible: true });
    // The stand is a whole ChatSpace for the adapter; nobody is signed in to the hub.
    const shown = await waitForReport((r) => r.dock?.status === 'not-signed-in', 'the dock status without a sign-in');
    expect(shown.dock).toMatchObject({ kind: 'in-flow', styleMode: 'adopted', contract: 'ok', banner: 'CG-AUTH-REQUIRED' });
  });

  it('several composers (v-show) resolve to exactly one active one; the mount point moves with the route', async () => {
    const first = await composerRoots();
    expect(first.active).toHaveLength(1);
    const firstKey = first.active[0] ?? '';
    expect(firstKey.endsWith(`:${accountA}:${a1}`)).toBe(true);

    await callStand('openChat', accountA, a2, { newTab: true });
    await browser.waitUntil(async () => (await composerRoots()).all.length === 2 && (await callStand('route')).chatId === a2, { timeout: 5000, timeoutMsg: 'second composer' });
    const second = await composerRoots();
    expect(second.active).toHaveLength(1);
    const secondKey = second.active[0] ?? '';
    expect(secondKey.endsWith(`:${accountA}:${a2}`)).toBe(true);
    expect(secondKey).not.toBe(firstKey);
    // The trap the adapter must not fall into: the first slot in DOM order is the hidden composer's.
    expect(second.firstSlotOwner).toBe(firstKey);

    await callStand('openChat', accountA, a1);
    await browser.waitUntil(async () => (await composerRoots()).active[0] === firstKey, { timeout: 5000, timeoutMsg: 'back to the first chat tab' });
    const back = await composerRoots();
    expect(back.all).toHaveLength(2);
    expect(back.active).toEqual([firstKey]);
  });

  // R09's mount manager, wired into the extension's tab (host-adapter.e2e.ts proves the adapter alone).
  it('R09: the dock follows the active composer when the route changes', async () => {
    await callStand('openChat', accountA, a2, { newTab: true });
    await browser.waitUntil(async () => (await composerRoots()).active[0]?.endsWith(`:${a2}`) === true, { timeout: 5000 });
    await browser.waitUntil(async () => (await dockPlacement()).parentKey === (await composerRoots()).active[0], { timeout: 5000, timeoutMsg: 'the dock did not move to the active composer' });
    const roots = await composerRoots();
    expect(await dockPlacement()).toEqual({ hosts: 1, parentKey: roots.active[0], firstChild: true, visible: true });
    await callStand('openChat', accountA, a1);
    await browser.waitUntil(async () => (await composerRoots()).active[0]?.endsWith(`:${a1}`) === true, { timeout: 5000 });
    await browser.waitUntil(async () => (await dockPlacement()).parentKey === (await composerRoots()).active[0], { timeout: 5000, timeoutMsg: 'the dock did not come back' });
    expect(await dockPlacement()).toEqual({ hosts: 1, parentKey: (await composerRoots()).active[0], firstChild: true, visible: true });
  });

  it('the trap catches a deliberate outside request of the page: in the BiDi log and in the egress sink', async () => {
    await browser.execute(() => {
      void fetch('https://cg-trap.invalid/probe').catch(() => undefined);
    });
    let violations: Awaited<ReturnType<ReturnType<typeof trap>['takeViolations']>> = [];
    await browser.waitUntil(
      async () => {
        violations = [...violations, ...(await trap().takeViolations())];
        return violations.length > 0;
      },
      { timeout: 5000, timeoutMsg: 'the trap saw no outside request' },
    );
    expect(violations.map((request) => request.url)).toEqual(['https://cg-trap.invalid/probe']);
    expect(await takeEgressUntil('cg-trap.invalid')).toEqual(['cg-trap.invalid']);
  });

  it('visual snapshots: light and dark at 1440×900 and 1280×800 into .cache/e2e/', async () => {
    const snapshots = await saveStandSnapshots('stand-chat');
    expect(snapshots).toHaveLength(SNAPSHOT_VIEWPORTS.length * 2);
    for (const snapshot of snapshots) {
      expect(existsSync(snapshot.path)).toBe(true);
      expect(snapshot.measured).toEqual(snapshot.viewport);
    }
    expect((await composerRoots()).active).toHaveLength(1);
  });

  // Last: it leaves the stand for our own extension page.
  it('a request of the extension background shows in the egress sink (the BiDi log does not see background pages)', async () => {
    // The journal page, which asks the background for no status; the probe is asked for through storage.local,
    // which only our own pages can write.
    await browser.url(testBuildPage());
    await writeLocalStorage({ [EGRESS_PROBE_KEY]: Date.now() });
    expect(await takeEgressUntil(EGRESS_PROBE_HOST)).toEqual([EGRESS_PROBE_HOST]);
    // Whatever the BiDi log saw of it (today nothing) is the probe and nothing else.
    expect((await trap().takeViolations()).filter((request) => new URL(request.url).hostname !== EGRESS_PROBE_HOST)).toEqual([]);
  });
});
