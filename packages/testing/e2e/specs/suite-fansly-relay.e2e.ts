// R20 P9c: «Fansly через вкладку» on the stand (spec FS-NET-4, FX-001; architecture.md §8.5, §8.6, §13). The model's
// tab sits behind its container's proxy — the stand's proxy, chosen for the tab as Multi-Account Containers does
// (support/fansly-proxy.ts) — and the server journals what came through it `via: 'proxy'`. Our calls are made by the
// test build's probe (apps/extension/bg/fansly/api-probe.ts) through the module's own transport.
// - Off (the default): our call is the event page's own — direct, past the tab's proxy; no frame in the tab.
// - On: lazily, for the work, the tab raises a hidden frame of ours (no iframe the page can see); the call is the
//   frame's, and it comes through the tab's proxy as ours (no Origin of the page), clean by FS-NET-1.
// - The route is chosen before the custody: a call prepared through the tab and held, then the tab's document
//   changes — the call is refused before it leaves: nothing reaches the server.
// - With the switch on and no Fansly page in the session's tab, nothing goes direct instead.
// - A 429 through the tab cools the creator down, counted as ours, for the tab's creator.

import { browser, expect } from '@wdio/globals';

import { readLocalStorage, waitForReport, writeLocalStorage, pageRpc } from '../support/extension';
import { useFakeHub } from '../support/fake-hub';
import { startFanslyShift } from '../support/fansly-shift';
import { callFansly, fakeFansly, fanslyIds, fanslyStandOrigin, waitForFanslyStandIdle, waitForFanslyStandReady } from '../support/fansly-stand';
import { fanslyProxyHost, routeTabThroughProxy, stopRoutingTabThroughProxy, tabProxyCounts } from '../support/fansly-proxy';
import { openWithNeighbor } from '../support/fansly-neighbor';
import { useNetworkTrap } from '../support/network-trap';

/** The probe's storage.local keys (bg/fansly/api-probe.ts FANSLY_API_PROBE_KEYS). */
const PROBE = { origin: 'dev.fanslyApi.origin', call: 'dev.fanslyApi.call', result: 'dev.fanslyApi.result', go: 'dev.fanslyApi.go' } as const;
/** settings.ext (contracts STORAGE_KEYS.settingsExt). */
const SETTINGS_EXT = 'settings.ext';

interface ProbeCall {
  readonly purpose: string;
  readonly route: string;
  readonly path?: Record<string, string>;
  readonly query?: Record<string, string>;
  readonly body?: unknown;
  readonly hold?: true;
}

interface ProbeResult {
  readonly id: string;
  readonly ok?: boolean;
  readonly prepared?: boolean;
  readonly transport?: string;
  readonly status?: number;
  readonly kind?: string;
  readonly code?: string;
  readonly sent?: boolean;
  readonly stage?: string;
  readonly frames?: number;
}

interface Captured {
  readonly limits: ReadonlyArray<{ readonly accountId: string | null; readonly source: string; readonly requestId: string; readonly clientRequestId?: string }>;
}

/** The core's session record in storage.session (P9a): its 429 facts. */
async function captured(): Promise<Captured | undefined> {
  return browser.execute(async () => {
    const api = (globalThis as unknown as { browser: { storage: { session: { get(key: string): Promise<Record<string, unknown>> } } } }).browser;
    return (await api.storage.session.get('fansly.session'))['fansly.session'] as Captured | undefined;
  });
}

describe('Fansly through the tab: FS-NET-4, FX-001 — the relay frame, the tab’s proxy, the route before the custody', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let standTab = '';
  let pagesTab = '';
  let creator = '';
  let group = '';
  let seq = 0;
  const pages = (): Promise<void> => browser.switchToWindow(pagesTab);
  const stand = (): Promise<void> => browser.switchToWindow(standTab);

  async function result(id: string, timeout = 20_000): Promise<ProbeResult> {
    let found: ProbeResult | undefined;
    await browser.waitUntil(
      async () => {
        found = (await readLocalStorage([PROBE.result]))[PROBE.result] as ProbeResult | undefined;
        return found?.id === id;
      },
      { timeout, interval: 100, timeoutMsg: `the background did not answer the probe ${id}` },
    );
    return found as ProbeResult;
  }

  /** One call through the background's client and its transport; its outcome. */
  async function probe(call: ProbeCall): Promise<ProbeResult> {
    await pages();
    seq += 1;
    const id = `p9c-${seq}-${Date.now()}`;
    await writeLocalStorage({ [PROBE.call]: { id, account: creator, ...call } });
    return result(id);
  }

  /** Our calls since `mark`, as the server journaled them: `METHOD route status via`. */
  async function ours(mark: number): Promise<string[]> {
    return (await fakeFansly().calls('ours', mark)).map((entry) => `${entry.method ?? '?'} ${entry.route ?? entry.path ?? '?'} ${entry.status ?? 0} ${entry.via}`);
  }

  /** «Fansly через вкладку» as the person would switch it (the settings page's section is P14b1's): settings.ext. */
  async function viaTab(on: boolean): Promise<void> {
    await pages();
    const stored = ((await readLocalStorage([SETTINGS_EXT]))[SETTINGS_EXT] ?? { v: 1, hosts: {} }) as { hosts?: Record<string, Record<string, unknown>> } & Record<string, unknown>;
    const fansly = { ...(stored.hosts?.['fansly-web'] ?? {}), viaTab: on };
    await writeLocalStorage({ [SETTINGS_EXT]: { ...stored, hosts: { ...(stored.hosts ?? {}), 'fansly-web': fansly } } });
    // The settings owner reconciles the write from storage; «Статус» says the request mode it holds (P14b2).
    const mode = on ? 'relay' : 'background';
    await browser.waitUntil(
      async () => {
        const diagnostic = await pageRpc<{ requestModes?: Array<{ host: string; mode: string }> }>('diagnostics.get');
        return diagnostic.ok && diagnostic.payload.requestModes?.some((entry) => entry.host === 'fansly-web' && entry.mode === mode) === true;
      },
      { timeout: 10_000, timeoutMsg: `the background did not take «Fansly через вкладку» ${mode}` },
    );
  }

  /** Our hosts in the stand's <html>: the relay's is the hidden one; and the iframes the page itself can see. */
  async function relayHosts(): Promise<{ readonly hidden: number; readonly iframes: number }> {
    await stand();
    return browser.execute(() => ({
      hidden: [...document.documentElement.children].filter((node) => node.getAttribute('data-host') === 'overlay' && (node.getAttribute('style') ?? '').includes('visibility: hidden')).length,
      iframes: document.querySelectorAll('iframe').length,
    }));
  }

  const registration = (): ProbeCall => ({ purpose: 'registration', route: 'group.detail', path: { group } });

  before(async () => {
    await fakeFansly().command({ op: 'reset' });
    const shift = await startFanslyShift(hub(), { path: '/messages', neighbor: { mode: 'off' } });
    pagesTab = shift.pagesTab;
    standTab = shift.fanslyTab;
    await pages();
    await writeLocalStorage({ [PROBE.origin]: fakeFansly().apiOrigin });
    // The tab behind its container's proxy from now on; its page loads anew under it.
    await routeTabThroughProxy({ standOrigin: fanslyStandOrigin(), apiHost: new URL(fakeFansly().apiOrigin).host, proxy: fanslyProxyHost() });
    await stand();
    await browser.refresh();
    await waitForFanslyStandReady();
    await waitForReport((report) => report.rpc?.registered === true, 'the Fansly tab registered');
    await waitForFanslyStandIdle();
    const ids = await fanslyIds();
    creator = ids.creator;
    group = ids.groups[0] ?? '';
    await pages();
    await browser.waitUntil(
      async () => {
        const diagnostic = await pageRpc<{ hostModules: Array<{ host: string; state: string }> }>('diagnostics.get');
        return diagnostic.ok && diagnostic.payload.hostModules.some((entry) => entry.host === 'fansly-web' && entry.state === 'started');
      },
      { timeout: 15_000, timeoutMsg: 'Fansly’s background module did not start' },
    );
    // The core holds the page's session: a call of ours can carry it.
    await browser.waitUntil(async () => (await probe(registration())).ok === true, { timeout: 20_000, interval: 500, timeoutMsg: 'no call of ours went through (no captured session?)' });
  });

  after(async () => {
    await stopRoutingTabThroughProxy();
  });

  it('[FS-NET-4] the stand: the tab’s own requests come through its proxy, the event page’s past it', async () => {
    const mark = await fakeFansly().mark();
    await stand();
    await callFansly('open', group);
    await waitForFanslyStandIdle();
    const page = await fakeFansly().calls('page', mark);
    expect(page.length).toBeGreaterThan(0);
    expect(page.every((entry) => entry.via === 'proxy')).toBe(true);
    expect((await tabProxyCounts())?.proxied ?? 0).toBeGreaterThan(0);
  });

  it('[FX-001] [FS-NET-4] off — the default: our call is the event page’s own, direct, past the tab’s proxy; no frame in the tab', async () => {
    const mark = await fakeFansly().mark();
    expect(await probe(registration())).toMatchObject({ ok: true, status: 200, frames: 0 });
    expect(await ours(mark)).toEqual(['GET group.detail 200 direct']);
    expect(await relayHosts()).toEqual({ hidden: 0, iframes: 0 });
  });

  it('[FX-001] [FS-NET-4] on: lazily, for the work, the tab raises a hidden frame of ours; the call is the frame’s and comes through the tab’s proxy, as ours — none direct', async () => {
    await viaTab(true);
    expect(await relayHosts()).toEqual({ hidden: 0, iframes: 0 });
    const mark = await fakeFansly().mark();
    expect(await probe(registration())).toMatchObject({ ok: true, status: 200, frames: 1 });
    expect(await probe({ purpose: 'identity', route: 'account.me' })).toMatchObject({ ok: true, status: 200, frames: 1 });
    expect(await ours(mark)).toEqual(['GET group.detail 200 proxy', 'GET account.me 200 proxy']);
    const entries = await fakeFansly().calls('ours', mark);
    for (const entry of entries) {
      expect(entry.path).toContain('ngsw-bypass=true');
      expect(entry.detail?.['headers']).toEqual(expect.arrayContaining(['authorization', 'fansly-client-id', 'fansly-client-ts', 'fansly-session-id']));
    }
    await fakeFansly().assertOursClean(mark, 'through the tab');
    // One hidden host in <html>; the page sees no iframe and no address of ours.
    expect(await relayHosts()).toEqual({ hidden: 1, iframes: 0 });
  });

  it('[FS-NET-4] the route is chosen before the custody: prepared through the tab and held, then the tab’s document changes — refused before the request, nothing reaches the server', async () => {
    await pages();
    seq += 1;
    const id = `p9c-hold-${seq}`;
    await writeLocalStorage({ [PROBE.call]: { id, account: creator, purpose: 'greeting', route: 'message.send', body: { type: 1, content: 'hi', groupId: group }, hold: true } });
    const prepared = await result(id);
    expect(prepared).toMatchObject({ prepared: true, frames: 1 });
    expect(prepared.transport).toMatch(/^tab:/);
    const mark = await fakeFansly().mark();
    // Another document of the tab: the frame goes with the old one.
    await stand();
    await browser.refresh();
    await waitForFanslyStandReady();
    await waitForReport((report) => report.rpc?.registered === true, 'the Fansly tab registered again');
    await pages();
    await writeLocalStorage({ [PROBE.go]: { id } });
    await browser.waitUntil(async () => ((await readLocalStorage([PROBE.result]))[PROBE.result] as ProbeResult | undefined)?.prepared !== true, { timeout: 15_000, timeoutMsg: 'the held call did not end' });
    expect(await result(id)).toMatchObject({ ok: false, kind: 'tab', code: 'CG-FAN-TAB', sent: false });
    expect(await ours(mark)).toEqual([]);
    expect((await fakeFansly().calls('ours', mark)).filter((entry) => entry.route === 'message.send')).toEqual([]);
    // The new document serves the next batch with a frame of its own.
    await stand();
    await waitForFanslyStandIdle();
    expect(await probe(registration())).toMatchObject({ ok: true, status: 200, frames: 1 });
  });

  it('[FS-NET-4] with the switch on and no Fansly page left in the session’s tab, nothing goes direct instead', async () => {
    // The tab leaves Fansly: no registered tab holds the session any more, though the session itself is still known
    // (a closed tab would take it along, and the call would end at `session` before any route).
    await stand();
    await browser.url('about:blank');
    await pages();
    const mark = await fakeFansly().mark();
    expect(await probe(registration())).toMatchObject({ ok: false, kind: 'tab', code: 'CG-FAN-TAB', sent: false });
    expect(await ours(mark)).toEqual([]);
  });

  it('[FS-NET-3] [FS-NET-4] a 429 through the tab cools the creator down: counted as ours, for the tab’s creator — the next call waits, nothing leaves', async () => {
    // Back on Fansly: a new document, its own frame for the next batch.
    await stand();
    await openWithNeighbor('/messages', { mode: 'off' });
    await waitForReport((report) => report.rpc?.registered === true, 'the Fansly tab registered again');
    await waitForFanslyStandIdle();
    await pages();
    const factsBefore = ((await captured())?.limits ?? []).filter((fact) => fact.source === 'own').length;
    const mark = await fakeFansly().mark();
    await fakeFansly().command({ op: 'api', rules: [{ route: 'group.detail', caller: 'ours', times: 1, outcome: { kind: 'status', status: 429, retryAfterS: 1 } }] });
    expect(await probe(registration())).toMatchObject({ ok: false, kind: 'rate-limited', code: 'CG-FAN-RATE-LIMIT', httpStatus: 429, sent: true, frames: 1 });
    // The core saw the frame's response (`onCompleted`, our own origin, the tab's id): one fact, ours, the tab's creator.
    await browser.waitUntil(async () => ((await captured())?.limits ?? []).filter((fact) => fact.source === 'own').length > factsBefore, { timeout: 10_000, timeoutMsg: 'the core recorded no fact of our 429 through the tab' });
    expect((await captured())?.limits.at(-1)).toMatchObject({ source: 'own', accountId: creator });
    expect(await probe(registration())).toMatchObject({ ok: false, kind: 'cooling', sent: false });
    expect(await ours(mark)).toEqual(['GET group.detail 429 proxy']);
  });
});
