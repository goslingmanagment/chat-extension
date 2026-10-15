// R20 P9b: our own requests to Fansly, by the fake Fansly's journal (spec
// FS-NET-1, FS-NET-3; architecture.md §8.3, §8.4, §13). A request of the
// background to loopback is seen by neither the BiDi log nor the egress sink,
// so the server checks every call of ours as it arrives: only the list
// FS-NET-1, never `/message/ack`, `ngsw-bypass=true` on every address, no
// cookie. The network trap holds the rest: nothing to OnlyMonster, nothing
// anywhere else.
//
// The real Firefox event page with Fansly switched on, the stand's tab open in
// the inbox next to the neighbour (FBuddy's emulation). Until the services that
// ask Fansly arrive (P9c–P9e, P10*, P11*), a call is made by the test build's
// probe (apps/extension/bg/fansly/api-probe.ts): one call through the real
// client — FS-NET-1's admission, the session the core captured from the page,
// the pacer — and its outcome back.
// - By itself the extension asks Fansly nothing, its module running.
// - Each read FS-NET-1 names goes through, as the server sees it; a pair the
//   list does not name — `/message/ack` above all — never leaves.
// - `success: false` with HTTP 200 is an error, asked once.
// - A 429 the neighbour got (the core's `onCompleted`) closes our next call of
//   that creator before any request, a greeting's too — and still does after
//   the event page slept and woke; once the cooldown is over, calls go again.
// - Our own 429, seen by the client and by the listener, is one limit.

import { browser, expect } from '@wdio/globals';

import { suspendBackground } from '../support/background';
import { installTestBuild, pageRpc, readLocalStorage, waitForReport, writeLocalStorage } from '../support/extension';
import { QUIET_PAGE, testBuildPage } from '../support/fake-hub';
import { callNeighbor, openWithNeighbor, setFanslyNeighbor } from '../support/fansly-neighbor';
import { switchFanslyOnForTheStand } from '../support/fansly-site';
import { callFansly, fakeFansly, fanslyIds, waitForFanslyStandIdle } from '../support/fansly-stand';
import { useNetworkTrap } from '../support/network-trap';

/** The probe's storage.local keys (bg/fansly/api-probe.ts FANSLY_API_PROBE_KEYS). */
const PROBE = { origin: 'dev.fanslyApi.origin', call: 'dev.fanslyApi.call', result: 'dev.fanslyApi.result' } as const;

interface ProbeCall {
  readonly purpose: string;
  readonly route: string;
  readonly path?: Record<string, string>;
  readonly query?: Record<string, string>;
  readonly body?: unknown;
}

interface ProbeResult {
  readonly id: string;
  readonly ok: boolean;
  readonly status?: number;
  readonly kind?: string;
  readonly code?: string;
  readonly sent?: boolean;
  readonly httpStatus?: number | null;
  readonly retryAt?: number | null;
  readonly lane: { readonly cooldownUntil: number; readonly level: number; readonly gapLevel: number } | null;
}

interface Captured {
  readonly limits: ReadonlyArray<{ readonly accountId: string | null; readonly source: string; readonly requestId: string }>;
  readonly templates: ReadonlyArray<{ readonly legacyId: string }>;
}

/** The core's session record in storage.session (P9a): templates and 429 facts. */
async function captured(): Promise<Captured | undefined> {
  return browser.execute(async () => {
    const api = (globalThis as unknown as { browser: { storage: { session: { get(key: string): Promise<Record<string, unknown>> } } } }).browser;
    return (await api.storage.session.get('fansly.session'))['fansly.session'] as Captured | undefined;
  });
}

async function fanslyModuleState(): Promise<string | undefined> {
  const diagnostic = await pageRpc<{ hostModules: Array<{ host: string; state: string }> }>('diagnostics.get');
  return diagnostic.ok ? diagnostic.payload.hostModules.find((entry) => entry.host === 'fansly-web')?.state : undefined;
}

describe('Fansly network: FS-NET-1, FS-NET-3 — our own requests, by the server', () => {
  useNetworkTrap();
  let standTab = '';
  let pagesTab = '';
  let creator = '';
  let group = '';
  let fan = '';
  let since = 0;
  let seq = 0;
  const pages = (): Promise<void> => browser.switchToWindow(pagesTab);
  const stand = (): Promise<void> => browser.switchToWindow(standTab);

  /** One call through the background's client; its outcome. */
  async function probe(call: ProbeCall): Promise<ProbeResult> {
    await pages();
    seq += 1;
    const id = `p9b-${seq}-${Date.now()}`;
    await writeLocalStorage({ [PROBE.call]: { id, account: creator, ...call } });
    let result: ProbeResult | undefined;
    await browser.waitUntil(
      async () => {
        result = (await readLocalStorage([PROBE.result]))[PROBE.result] as ProbeResult | undefined;
        return result?.id === id;
      },
      { timeout: 20_000, interval: 100, timeoutMsg: `the background did not answer the probe ${call.purpose}/${call.route}` },
    );
    return result as ProbeResult;
  }

  /** Our calls since `mark`, as the server journaled them: `METHOD route status`. */
  async function ours(mark: number): Promise<string[]> {
    return (await fakeFansly().calls('ours', mark)).map((entry) => `${entry.method ?? '?'} ${entry.route ?? entry.path ?? '?'} ${entry.status ?? 0}`);
  }

  const registration = (): ProbeCall => ({ purpose: 'registration', route: 'group.detail', path: { group } });

  before(async () => {
    await fakeFansly().command({ op: 'reset' });
    await setFanslyNeighbor(null);
    since = await fakeFansly().mark();
    await installTestBuild();
    await browser.url(testBuildPage(QUIET_PAGE));
    await switchFanslyOnForTheStand();
    await browser.url(testBuildPage(QUIET_PAGE));
    pagesTab = await browser.getWindowHandle();
    await writeLocalStorage({ [PROBE.origin]: fakeFansly().apiOrigin });
    standTab = (await browser.createWindow('tab')).handle;
    await stand();
    // The neighbour polls only when asked (its own 10 s poll would be noise here).
    await openWithNeighbor('/messages', { mode: 'after', pollMs: 600_000 });
    await waitForReport((report) => report.rpc?.registered === true, 'the Fansly tab registered');
    await waitForFanslyStandIdle();
    const ids = await fanslyIds();
    creator = ids.creator;
    group = ids.groups[0] ?? '';
    fan = ids.fans[group] ?? '';
    await pages();
    await browser.waitUntil(async () => ((await captured())?.templates.length ?? 0) > 0, { timeout: 15_000, timeoutMsg: 'the core captured no session template from the page' });
    await browser.waitUntil(async () => (await fanslyModuleState()) === 'started', { timeout: 15_000, timeoutMsg: 'Fansly’s background module did not start' });
  });

  after(async () => {
    await setFanslyNeighbor(null);
  });

  it('[BG-001] [AI-120] by itself the extension asks Fansly nothing: its module runs, the page and the neighbour talk, no call of ours', async () => {
    await stand();
    const ids = await fanslyIds();
    await callFansly('open', ids.groups[1] ?? group);
    await waitForFanslyStandIdle();
    expect((await callNeighbor('pollNow')).status).toBe(200);
    await browser.pause(2000);
    expect(await ours(since)).toEqual([]);
    expect((await fakeFansly().calls('page', since)).length).toBeGreaterThan(0);
    await fakeFansly().assertOursClean(since, 'nothing by itself');
  });

  it('[FS-NET-1] [RB-022] [AI-120] every read FS-NET-1 names goes through with the session the page proved; a pair it does not name — /message/ack above all — never leaves', async () => {
    const mark = await fakeFansly().mark();
    const reads: ProbeCall[] = [
      { purpose: 'identity', route: 'account.me' },
      registration(),
      { purpose: 'spenders', route: 'messaging.groups', query: { search: 'a', limit: '20', offset: '0' } },
      { purpose: 'spenders', route: 'account.byIds', query: { ids: fan } },
      { purpose: 'newcomers', route: 'followers.new', path: { account: creator }, query: { before: '0', limit: '20' } },
      { purpose: 'newcomers', route: 'message.history', query: { groupId: group, limit: '25' } },
      { purpose: 'newcomers', route: 'message.automated' },
    ];
    for (const read of reads) expect(await probe(read)).toMatchObject({ ok: true, status: 200 });
    for (const refused of [
      { purpose: 'newcomers', route: 'message.ack', body: { messageIds: ['1'], type: 2 } },
      { purpose: 'registration', route: 'message.history', query: { groupId: group } },
      { purpose: 'greeting', route: 'group.detail', path: { group } },
    ]) {
      expect(await probe(refused)).toMatchObject({ ok: false, kind: 'not-admitted', code: 'CG-FAN-REQUEST', sent: false });
    }
    expect(await ours(mark)).toEqual([
      'GET account.me 200',
      'GET group.detail 200',
      'GET messaging.groups 200',
      'GET account.byIds 200',
      'GET followers.new 200',
      'GET message.history 200',
      'GET message.automated 200',
    ]);
    const entries = await fakeFansly().calls('ours', mark);
    for (const entry of entries) {
      expect(entry.path).toContain('ngsw-bypass=true');
      expect(entry.detail?.['headers']).toEqual(expect.arrayContaining(['authorization', 'fansly-client-id', 'fansly-client-ts', 'fansly-session-id']));
    }
    // Not a single mark of ours: the page's own read marks are the page's.
    expect((await fakeFansly().journal(since)).entries.filter((entry) => entry.caller === 'ours' && entry.route === 'message.ack')).toEqual([]);
    await fakeFansly().assertOursClean(since, 'FS-NET-1');
  });

  it('[FS-NET-3] `success: false` with HTTP 200 is an error — asked once, no cooldown', async () => {
    const mark = await fakeFansly().mark();
    await fakeFansly().command({ op: 'api', rules: [{ route: 'group.detail', caller: 'ours', times: 1, outcome: { kind: 'refuse', code: 1001 } }] });
    expect(await probe(registration())).toMatchObject({ ok: false, kind: 'refused', code: 'CG-FAN-REQUEST', httpStatus: 200, sent: true, lane: { level: 0 } });
    expect(await probe(registration())).toMatchObject({ ok: true });
    expect(await ours(mark)).toEqual(['GET group.detail 200', 'GET group.detail 200']);
  });

  let cooledUntil = 0;

  it('[FS-NET-3] [NF-037] the neighbour’s 429 closes our next call of that creator before any request — a greeting’s too — and still does after the event page slept', async () => {
    await pages();
    const factsBefore = (await captured())?.limits.length ?? 0;
    await fakeFansly().command({ op: 'api', rules: [{ route: 'message.unread', caller: 'neighbour', times: 1, outcome: { kind: 'status', status: 429, retryAfterS: 5 } }] });
    await stand();
    expect((await callNeighbor('pollNow')).status).toBe(429);
    await pages();
    await browser.waitUntil(async () => ((await captured())?.limits.length ?? 0) > factsBefore, { timeout: 10_000, timeoutMsg: 'the core recorded no fact of the neighbour’s 429' });
    expect((await captured())?.limits.at(-1)).toMatchObject({ accountId: creator, source: 'page' });

    const mark = await fakeFansly().mark();
    const refused = await probe(registration());
    expect(refused).toMatchObject({ ok: false, kind: 'cooling', code: 'CG-FAN-RATE-LIMIT', sent: false, lane: { level: 1 } });
    expect(refused.retryAt ?? 0).toBeGreaterThan(Date.now());
    cooledUntil = refused.retryAt ?? 0;
    // A greeting is refused before the hub's custody would be asked: nothing is sent.
    expect(await probe({ purpose: 'greeting', route: 'message.send', body: { type: 1, content: 'hi', groupId: group } })).toMatchObject({ ok: false, kind: 'cooling', sent: false });
    expect(await ours(mark)).toEqual([]);

    // The event page sleeps; the tab's handshake brings the module back; the cooldown is still there, applied once.
    expect(await suspendBackground()).toBe('stopped');
    await browser.waitUntil(async () => (await fanslyModuleState()) === 'started', { timeout: 15_000, timeoutMsg: 'Fansly’s module did not come back after the wake' });
    const again = await probe(registration());
    expect(again).toMatchObject({ ok: false, kind: 'cooling', sent: false, retryAt: cooledUntil, lane: { level: 1 } });
    expect(await ours(mark)).toEqual([]);
    await fakeFansly().assertOursClean(since, 'a foreign 429');
  });

  it('[FS-NET-3] [NF-037] once the cooldown is over our calls go again; our own 429 — seen by the client and by the listener — is one limit, not asked again', async () => {
    expect(cooledUntil).toBeGreaterThan(0);
    await browser.waitUntil(() => Promise.resolve(Date.now() > cooledUntil + 500), { timeout: 45_000, interval: 250, timeoutMsg: 'the cooldown did not end' });
    const mark = await fakeFansly().mark();
    expect(await probe(registration())).toMatchObject({ ok: true, status: 200 });

    await pages();
    const ownBefore = ((await captured())?.limits ?? []).filter((fact) => fact.source === 'own').length;
    await fakeFansly().command({ op: 'api', rules: [{ route: 'group.detail', caller: 'ours', times: 1, outcome: { kind: 'status', status: 429, retryAfterS: 1 } }] });
    const limited = await probe(registration());
    expect(limited).toMatchObject({ ok: false, kind: 'rate-limited', code: 'CG-FAN-RATE-LIMIT', httpStatus: 429, sent: true, lane: { level: 2 } });
    // The listener saw the same response (`onCompleted`, our own origin): one more fact, `own`.
    await browser.waitUntil(async () => ((await captured())?.limits ?? []).filter((fact) => fact.source === 'own').length > ownBefore, {
      timeout: 10_000,
      timeoutMsg: 'the core recorded no fact of our own 429',
    });
    const next = await probe(registration());
    expect(next).toMatchObject({ ok: false, kind: 'cooling', sent: false, retryAt: limited.retryAt, lane: { level: 2 } });
    expect(await ours(mark)).toEqual(['GET group.detail 200', 'GET group.detail 429']);
    await fakeFansly().assertOursClean(since, 'our own 429');
  });
});
