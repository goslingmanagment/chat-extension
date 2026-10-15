// R20 P9b: the real background client against fake Fansly; never a live host.
import { browser, expect } from '@wdio/globals';
import type { FanslyApiCall } from '@cg/contracts/fansly-api';
import { waitForReport, readReport } from '../support/extension';
import { useFakeHub } from '../support/fake-hub';
import { startFanslyShift } from '../support/fansly-shift';
import { callNeighbor, setFanslyNeighbor } from '../support/fansly-neighbor';
import { callFansly, FANSLY_MAIN, fakeFansly, fanslyIds, waitForFanslyStandIdle } from '../support/fansly-stand';
import { MOD } from '../support/chat';
import { dockIs } from '../support/shift';
import { suspendBackground } from '../support/background';
import { useNetworkTrap } from '../support/network-trap';

interface ProbeResult { id: string; ok: boolean; code?: string; phase?: string; status?: { level: number; cooldownUntil: number } }
async function probe(call: FanslyApiCall): Promise<ProbeResult> {
  const origin = process.env['CG_FANSLY_API_ORIGIN']!;
  const id = crypto.randomUUID();
  await browser.execute(async (request) => {
    const api = (globalThis as unknown as { browser: { storage: { local: { set(value: unknown): Promise<void> } } } }).browser;
    await api.storage.local.set({ 'test.fansly-network.request': request });
  }, { id, call, origin });
  let result: ProbeResult | undefined;
  await browser.waitUntil(async () => {
    result = await browser.execute(async () => {
      const api = (globalThis as unknown as { browser: { storage: { local: { get(key: string): Promise<Record<string, ProbeResult | undefined>> } } } }).browser;
      return (await api.storage.local.get('test.fansly-network.result'))['test.fansly-network.result'];
    });
    return result?.id === id;
  }, { timeout: 15_000, timeoutMsg: 'the actual Fansly background client answers the stand driver' });
  return result!;
}
async function captured() {
  return browser.execute(async () => {
    const api = (globalThis as unknown as { browser: { storage: { session: { get(key: string): Promise<Record<string, unknown>> } } } }).browser;
    return (await api.storage.session.get('fansly.session'))['fansly.session'] as { tabs: [number, string][]; limits: { requestId: string; source: string }[] };
  });
}

describe('suite-fansly-network: FS-NET-1, FS-NET-3', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let standTab = ''; let pagesTab = ''; let call: FanslyApiCall;
  before(async () => {
    await fakeFansly().command({ op: 'reset' }); await setFanslyNeighbor({ mode: 'after', pollMs: 600_000 });
    const shift = await startFanslyShift(hub(), { path: '/messages', neighbor: { mode: 'after', pollMs: 600_000 } });
    standTab = shift.fanslyTab; pagesTab = shift.pagesTab;
    await waitForReport((report) => report.rpc?.registered === true, 'Fansly tab handshake'); await waitForFanslyStandIdle();
    const ids = await fanslyIds();
    await shift.toPages();
    await browser.waitUntil(async () => ((await captured())?.tabs.length ?? 0) > 0, { timeout: 10_000 });
    const [tabId, accountId] = (await captured()).tabs[0]!;
    call = { accountId, tabId, purpose: 'registration', mode: 'cooldown', method: 'GET', path: `/group/${ids.groups[0]!}` };
  });
  after(async () => { await setFanslyNeighbor(null); });

  it('[AI-120] [BG-001] startup and opening a chat do not generate or send; a human-requested AI draft sends nothing to Fansly', async () => {
    expect(await fakeFansly().calls('ours')).toEqual([]);
    await browser.switchToWindow(standTab); await callFansly('open', call.path.split('/').at(-1)!);
    await dockIs((dock) => dock.status === 'ready' && dock.actions['reply'] === true, 'ready Fansly AI dock', 20_000);
    await waitForFanslyStandIdle();
    expect((await readReport())?.dock?.result).toBeNull();
    const since = await fakeFansly().mark();
    await browser.$(FANSLY_MAIN.field).click(); await browser.keys([MOD, 'e']);
    await dockIs((dock) => dock.result?.feature === 'reply' && dock.result.state === 'done', 'the human-requested AI draft', 30_000);
    await waitForFanslyStandIdle();
    expect(await fakeFansly().calls('ours', since)).toEqual([]);
    expect((await fakeFansly().calls('page', since)).filter((entry) => entry.route === 'message.send')).toEqual([]);
    await browser.switchToWindow(pagesTab);
  });

  it('[RB-022] [RB-023] FS-NET-1 admitted request has bypass and no cookies; disallowed paths/methods produce no traffic or read mark', async () => {
    const since = await fakeFansly().mark();
    expect(await probe(call)).toMatchObject({ ok: true });
    for (const path of ['/message/ack', '/message/unread', '/subscribers', '/account/wallets/earnings/stats/accounts']) {
      expect(await probe({ ...call, path })).toMatchObject({ ok: false, code: 'CG-FAN-REQUEST', phase: 'before-dispatch' });
    }
    expect(await probe({ ...call, method: 'POST', body: {} })).toMatchObject({ ok: false, phase: 'before-dispatch' });
    const own = await fakeFansly().calls('ours', since);
    expect(own).toHaveLength(1); expect(own[0]).toMatchObject({ route: 'group.detail', method: 'GET', status: 200 });
    expect(own[0]!.path).toContain('ngsw-bypass=true'); expect(await fakeFansly().violations(since)).toEqual([]);
  });

  it('[RB-023] a refused envelope at HTTP 200 is an error, without another attempt', async () => {
    await fakeFansly().command({ op: 'api', rules: [{ route: 'group.detail', caller: 'ours', times: 1, outcome: { kind: 'refuse', code: 9000 } }] });
    const since = await fakeFansly().mark();
    expect(await probe(call)).toMatchObject({ ok: false, code: 'CG-FAN-REQUEST', phase: 'after-dispatch' });
    expect(await fakeFansly().calls('ours', since)).toHaveLength(1); expect(await fakeFansly().violations(since)).toEqual([]);
  });

  it('[NF-037] our 429 is counted once by fetch and onCompleted, survives wake and closes the next call', async () => {
    await fakeFansly().command({ op: 'api', rules: [{ route: 'group.detail', caller: 'ours', times: 1, outcome: { kind: 'status', status: 429 } }] });
    const since = await fakeFansly().mark();
    expect(await probe(call)).toMatchObject({ ok: false, code: 'CG-FAN-RATE-LIMIT', phase: 'after-dispatch', status: { level: 1 } });
    await browser.waitUntil(async () => (await captured()).limits.length > 0, { timeout: 10_000 });
    expect((await captured()).limits).toHaveLength(1);
    expect(await suspendBackground()).toBe('stopped');
    // The site's handshake restores its chunk; the storage probe is not a production wake-up route.
    await browser.switchToWindow(standTab); await browser.refresh();
    await waitForReport((report) => report.rpc?.registered === true, 'handshake after own cooling wake'); await waitForFanslyStandIdle();
    await browser.switchToWindow(pagesTab);
    expect(await probe(call)).toMatchObject({ ok: false, phase: 'before-dispatch', code: 'CG-FAN-RATE-LIMIT', status: { level: 1 } });
    expect(await fakeFansly().calls('ours', since)).toHaveLength(1);
  });

  it('[NF-037] a neighbour 429 lengthens cooling without any own request, and survives another wake', async () => {
    await fakeFansly().command({ op: 'api', rules: [{ route: 'message.unread', caller: 'neighbour', times: 1, outcome: { kind: 'status', status: 429 } }] });
    const since = await fakeFansly().mark();
    await browser.switchToWindow(standTab); expect((await callNeighbor('pollNow')).status).toBe(429);
    await browser.switchToWindow(pagesTab);
    await browser.waitUntil(async () => (await captured()).limits.some((fact) => fact.source === 'page'), { timeout: 10_000 });
    expect(await probe(call)).toMatchObject({ ok: false, code: 'CG-FAN-RATE-LIMIT', phase: 'before-dispatch', status: { level: 2 } });
    expect(await suspendBackground()).toBe('stopped');
    await browser.switchToWindow(standTab); await browser.refresh();
    await waitForReport((report) => report.rpc?.registered === true, 'handshake after foreign cooling wake'); await waitForFanslyStandIdle();
    await browser.switchToWindow(pagesTab);
    expect(await probe(call)).toMatchObject({ ok: false, code: 'CG-FAN-RATE-LIMIT', phase: 'before-dispatch', status: { level: 2 } });
    expect(await fakeFansly().calls('ours', since)).toEqual([]); expect(await fakeFansly().violations(since)).toEqual([]);
  });
});
