// P9a: the real Firefox event page, optional grant and passive observations.
import { mkdirSync } from 'node:fs';
import { browser, expect } from '@wdio/globals';
import type { SiteAccessState } from '@cg/contracts/site-access';
import { backgroundState, setOptionalPermissionPrompts, suspendBackground } from '../support/background';
import { installTestBuild, pageRpc, waitForReport } from '../support/extension';
import { testBuildPage } from '../support/fake-hub';
import { callNeighbor, openWithNeighbor, setFanslyNeighbor } from '../support/fansly-neighbor';
import { FANSLY_STAND_PATTERN, registeredScripts } from '../support/fansly-site';
import { callFansly, fakeFansly, fanslyStandUrl, waitForFanslyStandIdle, waitForFanslyStandReady } from '../support/fansly-stand';
import { useNetworkTrap } from '../support/network-trap';
import { grantOptional, revokeOptional } from '../support/permissions';

interface Stored {
  templates: Array<{ legacyId: string; headers: Record<string, string>; observedAt: number }>;
  limits: Array<{ accountId: string | null; source: string; requestId: string }>;
}
async function captured(): Promise<Stored> {
  return browser.execute(async () => {
    const api = (globalThis as unknown as { browser: { storage: { session: { get(key: string): Promise<Record<string, unknown>> } } } }).browser;
    return (await api.storage.session.get('fansly.session'))['fansly.session'] as Stored;
  });
}
async function access(): Promise<SiteAccessState> {
  const answer = await pageRpc<SiteAccessState>('site.access', { host: 'fansly-web' });
  if (!answer.ok) throw new Error(answer.error.code);
  return answer.payload;
}

describe('Fansly background: FS-PERM-2, FS-IDN-4, FS-NET-2 wake-up chains', () => {
  useNetworkTrap();
  let standTab = '';
  let pagesTab = '';
  const pages = () => browser.switchToWindow(pagesTab);
  const stand = () => browser.switchToWindow(standTab);
  before(async () => {
    await fakeFansly().command({ op: 'reset' });
    await setFanslyNeighbor(null);
    await installTestBuild();
    await browser.url(fanslyStandUrl('/messages'));
    await waitForFanslyStandReady(); standTab = await browser.getWindowHandle();
    await browser.newWindow(testBuildPage('popup.html')); pagesTab = await browser.getWindowHandle();
    await setOptionalPermissionPrompts(false);
    mkdirSync('test-results', { recursive: true });
  });
  after(async () => { await setOptionalPermissionPrompts(null); await setFanslyNeighbor(null); });

  it('[EX-004] a real click asks for the bundle once; the background registers MAIN then ISOLATED and notices the already-open tab', async () => {
    expect(await access()).toMatchObject({ enabled: false, granted: false, registered: false, waitingReload: 0 });
    expect((await registeredScripts()).filter((script) => script.id.startsWith('fansly'))).toEqual([]);
    const enable = browser.$('button=Включить Fansly');
    await enable.waitForDisplayed();
    await browser.waitUntil(async () => (await enable.getAttribute('aria-busy')) !== 'true', { timeout: 10_000 });
    await enable.click();
    await browser.waitUntil(async () => (await access()).registered, { timeout: 15_000 });
    expect((await registeredScripts()).filter((script) => script.id.startsWith('fansly')).map((script) => [script.id, script.world, script.runAt])).toEqual([
      ['fansly-main', 'MAIN', 'document_start'], ['fansly', 'ISOLATED', 'document_start'],
    ]);
    expect((await access()).waitingReload).toBe(1);
    await browser.saveScreenshot('test-results/p9a-enable.png');
    await stand();
    await browser.waitUntil(() => browser.execute(() => document.querySelector('div[data-host="reload-notice"]') !== null), { timeout: 10_000 });
    await browser.saveScreenshot('test-results/p9a-notice.png');
  });

  it('[BG-007] [AU-031] first grant → sleep → tab reload/handshake → module restored and page headers captured after 2xx', async () => {
    await pages(); expect(await suspendBackground()).toBe('stopped');
    await stand(); await browser.refresh(); await waitForFanslyStandReady();
    await waitForReport((report) => report.rpc?.registered === true, 'Fansly handshake after first grant');
    await waitForFanslyStandIdle();
    expect(await backgroundState()).toBe('running');
    await pages();
    await browser.waitUntil(async () => ((await captured())?.templates.length ?? 0) > 0, { timeout: 10_000 });
    expect((await access()).waitingReload).toBe(0);
    const diagnostic = await pageRpc<{ hostModules: Array<{ host: string; state: string }> }>('diagnostics.get');
    expect(diagnostic.ok && diagnostic.payload.hostModules.find((entry) => entry.host === 'fansly-web')?.state).toBe('started');
    expect(diagnostic.ok && diagnostic.payload.hostModules.find((entry) => entry.host === 'chatspace')?.state).toBe('idle');
    const before = await captured();
    expect(before.templates[0]?.headers['authorization']).toBeTruthy();
    expect(await suspendBackground()).toBe('stopped');
    // A page RPC wakes a new realm: storage.session is the session source.
    await access();
    expect((await captured()).templates).toEqual(before.templates);
  });

  it('sleep → a page API request alone wakes the top-level listener and captures; it does not import the site chunk', async () => {
    await pages();
    // Model a document without an isolated script, so a reconnect cannot be the wake-up cause.
    await browser.execute(async () => {
      const api = (globalThis as unknown as { browser: { scripting: { unregisterContentScripts(filter: { ids: string[] }): Promise<void> } } }).browser;
      await api.scripting.unregisterContentScripts({ ids: ['fansly-main', 'fansly'] });
    });
    await stand(); await browser.refresh(); await waitForFanslyStandReady(); await waitForFanslyStandIdle();
    expect(await browser.execute(() => document.documentElement.hasAttribute('data-cg-spike'))).toBe(false);
    await pages(); const before = await captured();
    expect(await suspendBackground()).toBe('stopped');
    await stand(); await callFansly('cameBack', 31_000); await waitForFanslyStandIdle();
    await browser.waitUntil(async () => (await backgroundState()) === 'running', { timeout: 10_000 });
    await pages();
    await browser.waitUntil(async () => ((await captured()).templates[0]?.observedAt ?? 0) > (before.templates[0]?.observedAt ?? 0), { timeout: 10_000 });
    const diagnostic = await pageRpc<{ hostModules: Array<{ host: string; state: string }> }>('diagnostics.get');
    expect(diagnostic.ok && diagnostic.payload.hostModules.find((entry) => entry.host === 'fansly-web')?.state).toBe('idle');
    expect((await registeredScripts()).some((script) => script.id === 'fansly')).toBe(true);
  });

  it('a rejected neighbour replay leaves the template intact; its 429 is persisted and survives another sleep', async () => {
    await stand(); await openWithNeighbor('/messages', { mode: 'after', pollMs: 600_000 });
    await waitForReport((report) => report.rpc?.registered === true, 'registered neighbour tab');
    await waitForFanslyStandIdle();
    await pages(); const before = await captured();
    await fakeFansly().command({ op: 'api', rules: [{ route: 'message.unread', caller: 'neighbour', times: 1, outcome: { kind: 'status', status: 429, retryAfterS: 5 } }] });
    await stand(); expect((await callNeighbor('pollNow')).status).toBe(429);
    await pages();
    await browser.waitUntil(async () => (await captured()).limits.length > 0, { timeout: 10_000 });
    expect((await captured()).templates).toEqual(before.templates);
    const facts = (await captured()).limits;
    expect(facts.at(-1)?.accountId).toBe(before.templates[0]?.legacyId);
    expect(await suspendBackground()).toBe('stopped'); await access();
    expect((await captured()).limits).toEqual(facts);
  });

  it('FS-IDN-4 an update restores registrations and injects the notice into the old document, cleaning only our orphan hosts', async () => {
    await stand();
    await browser.execute(() => {
      const stale = document.createElement('div'); stale.setAttribute('data-host', 'dock'); document.body.append(stale);
      const foreign = document.createElement('div'); foreign.setAttribute('data-host', 'foreign'); foreign.textContent = 'neighbour'; document.body.append(foreign);
    });
    await installTestBuild();
    await browser.waitUntil(() => browser.execute(() => document.querySelector('div[data-host="reload-notice"]') !== null), { timeout: 15_000 });
    expect(await browser.execute(() => ({ stale: document.querySelectorAll('div[data-host="dock"]').length, foreign: document.querySelector('div[data-host="foreign"]')?.textContent }))).toEqual({ stale: 0, foreign: 'neighbour' });
    await browser.saveScreenshot('test-results/p9a-update-notice.png');
    await pages(); await browser.url(testBuildPage('popup.html'));
    expect(await access()).toMatchObject({ enabled: true, granted: true, registered: true, waitingReload: 1 });
    await stand(); await browser.refresh(); await waitForFanslyStandReady();
    await waitForReport((report) => report.rpc?.registered === true, 'handshake after update');
    await pages(); expect((await access()).waitingReload).toBe(0);
  });

  it('revocation removes both registrations and session material; a new grant recovers; an off switch stays off after a wake with retained rights', async () => {
    await revokeOptional({ origins: [FANSLY_STAND_PATTERN], permissions: ['webRequest'] });
    await browser.waitUntil(async () => !(await access()).registered, { timeout: 10_000 });
    expect((await registeredScripts()).filter((script) => script.id.startsWith('fansly'))).toEqual([]);
    expect((await captured()).templates).toEqual([]);
    await grantOptional({ origins: [FANSLY_STAND_PATTERN], permissions: ['webRequest'] });
    await browser.waitUntil(async () => (await access()).registered, { timeout: 10_000 });
    const off = await pageRpc<SiteAccessState>('site.access', { host: 'fansly-web', enabled: false });
    expect(off.ok && off.payload.enabled).toBe(false);
    expect(await suspendBackground()).toBe('stopped');
    expect(await access()).toMatchObject({ enabled: false, granted: true, registered: false });
    expect((await registeredScripts()).filter((script) => script.id.startsWith('fansly'))).toEqual([]);
  });
});
