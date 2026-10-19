// P9a: the real Firefox event page, optional grant and passive observations.
import { browser, expect } from '@wdio/globals';
import type { SiteAccessState } from '@cg/contracts/site-access';
import { backgroundState, setOptionalPermissionPrompts, suspendBackground } from '../support/background';
import { installTestBuild, pageRpc, waitForReport } from '../support/extension';
import { testBuildPage } from '../support/fake-hub';
import { callNeighbor, openWithNeighbor, setFanslyNeighbor } from '../support/fansly-neighbor';
import { FANSLY_STAND_PATTERN, registeredScripts } from '../support/fansly-site';
import { callFansly, fakeFansly, fanslyIds, fanslyStandUrl, waitForFanslyStandIdle, waitForFanslyStandReady } from '../support/fansly-stand';
import { useNetworkTrap } from '../support/network-trap';
import { grantOptional, revokeOptional } from '../support/permissions';
import { capturePage } from '../support/pages';

interface Stored {
  templates: Array<{ legacyId: string; headers: Record<string, string>; checks: Record<string, string> }>;
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
    const disable = browser.$('button=Выключить Fansly');
    await disable.waitForDisplayed();
    await browser.waitUntil(async () => (await disable.getAttribute('aria-busy')) !== 'true', { timeout: 10_000 });
    await capturePage('p9a-enable');
    await stand();
    await browser.waitUntil(() => browser.execute(() => document.querySelector('div[data-host="reload-notice"]') !== null), { timeout: 10_000 });
    await capturePage('p9a-notice');
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
    await browser.waitUntil(async () => !(await browser.$('button=Перезагрузить вкладку').isExisting()), { timeout: 10_000 });
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

  it('grant while the background sleeps notices an open tab; another wake preserves that notice', async () => {
    await pages();
    await revokeOptional({ origins: [FANSLY_STAND_PATTERN], permissions: ['webRequest'] });
    await browser.waitUntil(async () => !(await access()).registered, { timeout: 10_000 });
    await stand(); await browser.refresh(); await waitForFanslyStandReady(); await waitForFanslyStandIdle();
    expect(await browser.execute(() => document.querySelector('[data-host="reload-notice"]') !== null)).toBe(false);
    await pages(); expect(await suspendBackground()).toBe('stopped');
    // Firefox's grant is delivered with no live background realm, as when
    // Allow is clicked after the permission prompt outlives the event page.
    await grantOptional({ origins: [FANSLY_STAND_PATTERN], permissions: ['webRequest'] });
    await browser.waitUntil(async () => (await access()).registered, { timeout: 10_000 });
    expect((await access()).waitingReload).toBe(1);
    await stand();
    await browser.waitUntil(() => browser.execute(() => document.querySelector('[data-host="reload-notice"]') !== null), { timeout: 10_000 });
    await capturePage('p9a-grant-after-sleep');
    await browser.execute(() => document.querySelector('[data-host="reload-notice"]')?.setAttribute('data-grant-notice', 'true'));
    await pages(); expect(await suspendBackground()).toBe('stopped');
    expect((await access()).waitingReload).toBe(1);
    await stand();
    expect(await browser.execute(() => document.querySelectorAll('[data-host="reload-notice"][data-grant-notice]').length)).toBe(1);
    await browser.refresh(); await waitForFanslyStandReady();
    await waitForReport((report) => report.rpc?.registered === true, 'handshake after sleeping grant');
    await waitForFanslyStandIdle(); await pages();
    expect((await access()).waitingReload).toBe(0);
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
    const groupId = (await fanslyIds()).groups[0]!;
    await callFansly('forget', groupId);
    await pages(); expect((await captured()).templates[0]?.checks['group']).toBeUndefined();
    expect(await suspendBackground()).toBe('stopped');
    // A newly learned route family is a durable change; a timestamp/check
    // rotation on the already-known /message family must not force a write.
    await stand(); await callFansly('open', groupId); await waitForFanslyStandIdle();
    await browser.waitUntil(async () => (await backgroundState()) === 'running', { timeout: 10_000 });
    await pages();
    await browser.waitUntil(async () => (await captured()).templates[0]?.checks['group'] !== undefined, { timeout: 10_000 });
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
    // A 429 flush can also save newer page timestamps/checks accumulated in
    // memory. The rejected neighbour must leave the session identity intact.
    for (const template of (await captured()).templates) {
      const previous = before.templates.find((entry) => entry.legacyId === template.legacyId);
      expect(previous).toBeDefined();
      for (const name of ['authorization', 'fansly-client-id', 'fansly-session-id']) expect(template.headers[name]).toBe(previous?.headers[name]);
      expect(Object.values(template.checks).every((check) => check.startsWith('stand-check-'))).toBe(true);
    }
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
    // Update once more while the previous version's notice is still visible.
    // Its closed DOM survives unloading, but its click listener does not.
    await browser.execute(() => document.querySelector('[data-host="reload-notice"]')?.setAttribute('data-old-notice', 'true'));
    await installTestBuild();
    await browser.waitUntil(() => browser.execute(() => document.querySelector('[data-host="reload-notice"]') !== null && document.querySelector('[data-old-notice]') === null), { timeout: 15_000 });
    await capturePage('p9a-update-notice');
    // Firefox closes extension-page tabs when their add-on is replaced.
    await browser.newWindow(testBuildPage('popup.html')); pagesTab = await browser.getWindowHandle();
    expect(await access()).toMatchObject({ enabled: true, granted: true, registered: true, waitingReload: 1 });
    const reload = browser.$('button=Перезагрузить вкладку');
    await reload.waitForDisplayed();
    await browser.waitUntil(async () => (await reload.getAttribute('aria-busy')) !== 'true', { timeout: 10_000 });
    await reload.click();
    // The popup stays open: the handshake updates its counter without a refresh/focus event.
    await browser.waitUntil(async () => !(await browser.$('button=Перезагрузить вкладку').isExisting()), { timeout: 10_000 });
    await stand(); await waitForFanslyStandReady();
    await waitForReport((report) => report.rpc?.registered === true, 'handshake after update');
    await pages(); expect((await access()).waitingReload).toBe(0);
  });

  it('revocation removes both registrations and session material; a new grant recovers; an off switch stays off after a wake with retained rights', async () => {
    await revokeOptional({ origins: [FANSLY_STAND_PATTERN], permissions: ['webRequest'] });
    await browser.waitUntil(async () => !(await access()).registered, { timeout: 10_000 });
    expect((await registeredScripts()).filter((script) => script.id.startsWith('fansly'))).toEqual([]);
    expect((await captured()).templates).toEqual([]);
    await browser.$('button=Включить Fansly').waitForDisplayed();
    await grantOptional({ origins: [FANSLY_STAND_PATTERN], permissions: ['webRequest'] });
    await browser.waitUntil(async () => (await access()).registered, { timeout: 10_000 });
    const off = await pageRpc<SiteAccessState>('site.access', { host: 'fansly-web', enabled: false });
    expect(off.ok && off.payload.enabled).toBe(false);
    expect(await suspendBackground()).toBe('stopped');
    expect(await access()).toMatchObject({ enabled: false, granted: true, registered: false });
    expect((await registeredScripts()).filter((script) => script.id.startsWith('fansly'))).toEqual([]);
  });
});
