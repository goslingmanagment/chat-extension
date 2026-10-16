// Where a ready request leaves (architecture.md §8.5, §8.6; FS-NET-4, FX-001): the event page's own `fetch` with
// «Fansly через вкладку» off, the relay frame of the model's tab with it on — chosen before the custody, the frame up
// and answering first, never the direct route instead; the route's part of the last check right before the request;
// a document, account or tab that changed after the route refuses before any request.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FANSLY_RELAY_TARGET } from '@cg/contracts/tab-messages-fansly';

import { FANSLY_API_BASE } from './allowlist';
import type { FanslyCall, FanslySessionTemplate } from './client';
import { FanslyApiError } from './errors';
import { createFanslyApi, type FanslyNetworkSession } from './index';
import { createRelayTransport, FanslyRouteRefused, FanslyRouteUnavailable, RELAY_TARGET, RELAY_WAIT_MS, type FanslyFetch, type FanslyWireRequest, type RelayFetchEvent, type RelayTransportPorts } from './transport';

const T0 = Date.UTC(2026, 9, 16, 9, 0, 0);
const CREATOR = '300000000000000001';
const OTHER = '300000000000000002';
const GROUP = '300000000000000777';
const RELAY_ID = '00000000-0000-4000-8000-000000000501';
const NEXT_RELAY_ID = '00000000-0000-4000-8000-000000000502';
const TAB = { tabSessionId: 'session-a', tabId: 11 } as const;
const FRAME = { tabSessionId: TAB.tabSessionId, frameId: 5 } as const;

const TEMPLATE: FanslySessionTemplate = {
  legacyId: CREATOR,
  canonicalId: null,
  headers: { authorization: 'token-1', 'fansly-client-id': 'client-1', 'fansly-session-id': 'session-1' },
  checks: { group: 'check-group', message: 'check-message' },
  connected: true,
  observedAt: T0,
};

interface Posted {
  readonly tabSessionId: string;
  readonly type: string;
  readonly payload: unknown;
}

/** The core's side as the transport sees it, and a person's switch. */
function corePorts() {
  const state = {
    viaTab: true as boolean | null,
    tabs: [TAB] as Array<{ tabSessionId: string; tabId: number }>,
    sessions: new Map<number, string>([[TAB.tabId, CREATOR]]),
    /** How many relay frames a post reaches (the core's emit count). */
    reach: 1,
    /** Whether the tab takes `open` at all. */
    tabListens: true,
  };
  const opened: string[] = [];
  const posted: Posted[] = [];
  const direct: string[] = [];
  let ids = 0;
  const ports: RelayTransportPorts = {
    viaTab: () => state.viaTab,
    tabs: () => state.tabs,
    sessionOfTab: (tabId) => state.sessions.get(tabId) ?? null,
    open: (tabSessionId) => {
      opened.push(tabSessionId);
      return state.tabListens;
    },
    post: (tabSessionId, type, payload) => {
      posted.push({ tabSessionId, type, payload });
      return state.reach;
    },
    fetch: (url) => {
      direct.push(url);
      return Promise.resolve({ status: 200, headers: { get: () => null }, text: () => Promise.resolve(JSON.stringify({ success: true, response: { id: '1' } })) });
    },
    randomUUID: () => `00000000-0000-4000-8000-${String((ids += 1)).padStart(12, '0')}`,
  };
  const fetches = (): RelayFetchEvent[] => posted.filter((entry) => entry.type === 'fansly.relay.fetch').map((entry) => entry.payload as RelayFetchEvent);
  return { state, ports, opened, posted, direct, fetches };
}

const wire = (overrides: Partial<FanslyWireRequest> = {}): FanslyWireRequest => ({
  url: `${FANSLY_API_BASE}group/${GROUP}/?ngsw-bypass=true`,
  path: `group/${GROUP}/?ngsw-bypass=true`,
  method: 'GET',
  headers: { authorization: 'token-1', 'x-cg-request-id': 'r-1' },
  signal: new AbortController().signal,
  ...overrides,
});

const hello = { hostAccountId: CREATOR, relayId: RELAY_ID } as const;

/** The client over the relay transport, as Fansly's module wires it (bg/fansly.ts). */
function clientWorld() {
  const core = corePorts();
  const hub = createRelayTransport(core.ports);
  let template: FanslySessionTemplate | null = { ...TEMPLATE };
  const session: FanslyNetworkSession = {
    ready: Promise.resolve(),
    idle: () => Promise.resolve(),
    forAccount: (id) => (template !== null && (template.legacyId === id || template.canonicalId === id) ? template : null),
    disconnect: () => Promise.resolve(),
    rateLimits: () => [],
  };
  const data = new Map<string, unknown>();
  const storage = {
    get: (keys: readonly string[]) => Promise.resolve({ ok: true as const, value: Object.fromEntries(keys.filter((key) => data.has(key)).map((key) => [key, data.get(key)])) }),
    set: (items: Readonly<Record<string, unknown>>) => {
      for (const [key, value] of Object.entries(items)) data.set(key, structuredClone(value));
      return Promise.resolve({ ok: true as const });
    },
  };
  const fetch: FanslyFetch = () => Promise.reject(new Error('the client never fetches by itself: the transport does'));
  const api = createFanslyApi({ session, storage, fetch, transport: hub, random: () => 0 });
  return {
    ...core,
    hub,
    api,
    setTemplate(next: FanslySessionTemplate | null) {
      template = next;
    },
  };
}

const registration: FanslyCall = { purpose: 'registration', route: 'group.detail', account: CREATOR, path: { group: GROUP } };
const greeting: FanslyCall = { purpose: 'greeting', route: 'message.send', account: CREATOR, body: { type: 1, content: 'hi', groupId: GROUP } };

async function settle<T>(work: Promise<T>, stepMs = 50, maxMs = 120_000): Promise<T> {
  let end: { value: T } | { error: unknown } | null = null;
  work.then(
    (value) => (end = { value }),
    (error: unknown) => (end = { error }),
  );
  for (let spent = 0; end === null && spent <= maxMs; spent += stepMs) await vi.advanceTimersByTimeAsync(stepMs);
  const done = end as { value: T } | { error: unknown } | null;
  if (done === null) throw new Error('did not settle');
  if ('error' in done) throw done.error;
  return done.value;
}

const failure = async (work: Promise<unknown>): Promise<unknown> =>
  settle(work).then(
    () => null,
    (caught: unknown) => caught,
  );

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('[host:fansly] the route of a request (R20 P9c, FS-NET-4)', () => {
  it('[FX-001] [FS-NET-4] off — the default — is the event page’s own request: no tab is asked, no frame is posted to', async () => {
    const core = corePorts();
    core.state.viaTab = false;
    const hub = createRelayTransport(core.ports);
    const route = await hub.route({ legacyId: CREATOR, canonicalId: null });
    expect(route.transport).toBe('direct');
    expect(route.holds()).toBe(true);
    await route.send(wire());
    expect(core.direct).toEqual([`${FANSLY_API_BASE}group/${GROUP}/?ngsw-bypass=true`]);
    expect([core.opened, core.posted]).toEqual([[], []]);
    // Switched on after the route was chosen: the direct route does not hold — no direct request with the switch on.
    core.state.viaTab = true;
    expect(route.holds()).toBe(false);
    await expect(route.send(wire())).rejects.toBeInstanceOf(FanslyRouteRefused);
    expect(core.direct).toHaveLength(1);
  });

  it('[FS-NET-4] settings not read yet: read once more; still unknown — no route at all, neither a guess of the tab nor the direct request', async () => {
    const core = corePorts();
    core.state.viaTab = null;
    let reads = 0;
    const hub = createRelayTransport({
      ...core.ports,
      settled: () => {
        reads += 1;
        return Promise.resolve();
      },
    });
    await expect(hub.route({ legacyId: CREATOR, canonicalId: null })).rejects.toMatchObject({ reason: 'settings' });
    expect([reads, core.opened, core.posted, core.direct]).toEqual([1, [], [], []]);
    // Read this time: the route the switch says.
    const late = createRelayTransport({
      ...core.ports,
      settled: () => {
        core.state.viaTab = false;
        return Promise.resolve();
      },
    });
    expect((await late.route({ legacyId: CREATOR, canonicalId: null })).transport).toBe('direct');
  });

  it('[FX-001] [FS-NET-4] on: the tab of the request’s session raises its frame; the route is ready once the frame said it is up, and the request goes to that frame alone', async () => {
    const core = corePorts();
    // A tab of another session beside it: never this request's.
    core.state.tabs = [{ tabSessionId: 'session-b', tabId: 12 }, TAB];
    core.state.sessions.set(12, OTHER);
    const hub = createRelayTransport(core.ports);
    let routed = false;
    const routing = hub.route({ legacyId: CREATOR, canonicalId: null }).then((route) => {
      routed = true;
      return route;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(core.opened).toEqual([TAB.tabSessionId]);
    expect(routed).toBe(false);
    expect(hub.hello(FRAME, hello)).toBe(true);
    const route = await routing;
    expect(route.transport).toBe(`tab:${TAB.tabSessionId}`);
    expect(route.holds()).toBe(true);
    const answer = route.send(wire({ method: 'POST', url: `${FANSLY_API_BASE}message?ngsw-bypass=true`, path: 'message?ngsw-bypass=true', body: '{"type":1}' }));
    // Posted in the same task, the lease renewed with it: nothing asynchronous between the last check and the request.
    expect(core.fetches()).toEqual([
      {
        requestId: expect.any(String) as string,
        method: 'POST',
        url: `${FANSLY_RELAY_TARGET}message?ngsw-bypass=true`,
        headers: [['authorization', 'token-1'], ['x-cg-request-id', 'r-1']],
        body: '{"type":1}',
        expect: { hostAccountId: CREATOR, relayId: RELAY_ID },
      },
    ]);
    expect(core.posted.map((entry) => entry.tabSessionId)).toEqual([TAB.tabSessionId]);
    expect(core.opened).toEqual([TAB.tabSessionId, TAB.tabSessionId]);
    const requestId = core.fetches()[0]?.requestId ?? '';
    expect(hub.head(FRAME, { requestId, status: 200, headers: [['content-type', 'application/json'], ['set-cookie', 'x']] })).toBe(true);
    const response = await answer;
    expect([response.status, response.headers.get('Content-Type'), response.headers.get('set-cookie')]).toEqual([200, 'application/json', null]);
    expect(hub.body(FRAME, { requestId, body: '{"success":true,"response":{}}' })).toBe(true);
    expect(await response.text()).toBe('{"success":true,"response":{}}');
    expect([hub.pending(), core.direct]).toEqual([0, []]);
    // The wire names Fansly's own address whatever base the client has (a test build's frame serves it from its stand).
    expect(RELAY_TARGET).toBe(FANSLY_RELAY_TARGET);
  });

  it('[FS-NET-4] a frame up already serves the next batch at once; its lease is renewed by the route', async () => {
    const core = corePorts();
    const hub = createRelayTransport(core.ports);
    hub.hello(FRAME, hello);
    const route = await hub.route({ legacyId: CREATOR, canonicalId: CREATOR });
    expect(route.transport).toBe(`tab:${TAB.tabSessionId}`);
    expect(core.opened).toEqual([TAB.tabSessionId]);
  });

  it('[FS-NET-4] no tab of the session, a tab that took no ask, or no frame in time: no route — and never the direct request instead', async () => {
    const core = corePorts();
    const hub = createRelayTransport(core.ports);
    core.state.sessions.set(TAB.tabId, OTHER);
    await expect(hub.route({ legacyId: CREATOR, canonicalId: null })).rejects.toMatchObject({ reason: 'no-tab' });
    core.state.sessions.set(TAB.tabId, CREATOR);
    core.state.tabListens = false;
    await expect(hub.route({ legacyId: CREATOR, canonicalId: null })).rejects.toMatchObject({ reason: 'no-tab' });
    core.state.tabListens = true;
    const late = hub.route({ legacyId: CREATOR, canonicalId: null });
    const error = failure(late);
    await vi.advanceTimersByTimeAsync(RELAY_WAIT_MS + 1);
    expect(await error).toMatchObject({ reason: 'no-frame' });
    expect([core.posted, core.direct]).toEqual([[], []]);
  });

  it('[FS-NET-4] a frame of another account than the session’s known one is no route', async () => {
    const core = corePorts();
    const hub = createRelayTransport(core.ports);
    hub.hello(FRAME, { hostAccountId: OTHER, relayId: RELAY_ID });
    await expect(hub.route({ legacyId: CREATOR, canonicalId: CREATOR })).rejects.toBeInstanceOf(FanslyRouteUnavailable);
    // The canonical id not known yet: the tab's binding to the session is the proof, the frame's account rides with each request.
    const route = await hub.route({ legacyId: CREATOR, canonicalId: null });
    route.send(wire()).catch(() => undefined);
    expect(core.fetches()[0]?.expect).toEqual({ hostAccountId: OTHER, relayId: RELAY_ID });
  });

  it('[FS-NET-4] the route holds while its frame, tab and session do: a document gone, a tab gone, another session, another frame — each refuses before any post', async () => {
    const core = corePorts();
    const hub = createRelayTransport(core.ports);
    hub.hello(FRAME, hello);
    const route = await hub.route({ legacyId: CREATOR, canonicalId: null });
    expect(route.holds()).toBe(true);
    // The tab's page moved to another session (the account changed).
    core.state.sessions.set(TAB.tabId, OTHER);
    expect(route.holds()).toBe(false);
    core.state.sessions.set(TAB.tabId, CREATOR);
    // The tab session went (another document).
    core.state.tabs = [];
    expect(route.holds()).toBe(false);
    core.state.tabs = [TAB];
    expect(route.holds()).toBe(true);
    // The tab took its frame down and raised another one (its account changed and came back): not the frame of the route.
    hub.gone(FRAME);
    hub.hello({ ...FRAME, frameId: 6 }, { ...hello, relayId: NEXT_RELAY_ID });
    expect(route.holds()).toBe(false);
    await expect(route.send(wire())).rejects.toBeInstanceOf(FanslyRouteRefused);
    expect(core.posted).toEqual([]);
  });

  it('[FS-NET-4] a post no frame took (gone a moment ago) is provably no request', async () => {
    const core = corePorts();
    const hub = createRelayTransport(core.ports);
    hub.hello(FRAME, hello);
    const route = await hub.route({ legacyId: CREATOR, canonicalId: null });
    core.state.reach = 0;
    await expect(route.send(wire())).rejects.toBeInstanceOf(FanslyRouteRefused);
    expect(hub.pending()).toBe(0);
  });

  it('[FS-NET-4] the frame’s own refusal is provably no request; a failure after its fetch, or a frame lost, is a dropped connection', async () => {
    const core = corePorts();
    const hub = createRelayTransport(core.ports);
    hub.hello(FRAME, hello);
    const route = await hub.route({ legacyId: CREATOR, canonicalId: null });
    const refused = route.send(wire());
    hub.failure(FRAME, { requestId: core.fetches()[0]?.requestId ?? '', reason: 'refused' });
    await expect(refused).rejects.toBeInstanceOf(FanslyRouteRefused);
    const network = route.send(wire());
    hub.failure(FRAME, { requestId: core.fetches()[1]?.requestId ?? '', reason: 'network' });
    await expect(network).rejects.toBeInstanceOf(TypeError);
    // Lost after the head: the body fails, the status stands.
    const headed = route.send(wire());
    hub.head(FRAME, { requestId: core.fetches()[2]?.requestId ?? '', status: 200, headers: [] });
    const response = await headed;
    const lost = route.send(wire());
    hub.gone(FRAME);
    await expect(response.text()).rejects.toBeInstanceOf(TypeError);
    await expect(lost).rejects.toBeInstanceOf(TypeError);
    expect(hub.pending()).toBe(0);
  });

  it('[FS-NET-4] replies are taken from the frame that was asked alone; a body before its head is kept; an abort reaches the frame', async () => {
    const core = corePorts();
    const hub = createRelayTransport(core.ports);
    hub.hello(FRAME, hello);
    const route = await hub.route({ legacyId: CREATOR, canonicalId: null });
    const answer = route.send(wire());
    const requestId = core.fetches()[0]?.requestId ?? '';
    const stranger = { ...FRAME, frameId: 9 };
    expect([hub.failure(stranger, { requestId, reason: 'refused' }), hub.head(stranger, { requestId, status: 500, headers: [] })]).toEqual([false, false]);
    expect(hub.body(FRAME, { requestId, body: 'early' })).toBe(true);
    hub.head(FRAME, { requestId, status: 201, headers: [] });
    const response = await answer;
    expect([response.status, await response.text()]).toEqual([201, 'early']);
    const controller = new AbortController();
    const aborted = route.send(wire({ signal: controller.signal }));
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
    expect(core.posted.at(-1)).toEqual({ tabSessionId: TAB.tabSessionId, type: 'fansly.relay.abort', payload: { requestId: core.fetches()[1]?.requestId } });
  });
});

describe('[host:fansly] the client through the tab (R20 P9c, FS-NET-4, FX-001)', () => {
  it('[FX-001] [FS-NET-4] prepare routes before the custody: the frame raised and up, the transport named; start sends through it and reads Fansly’s answer', async () => {
    const w = clientWorld();
    const preparing = w.api.client.prepare(registration);
    await vi.advanceTimersByTimeAsync(0);
    expect(w.opened).toEqual([TAB.tabSessionId]);
    w.hub.hello(FRAME, hello);
    const prepared = await settle(preparing);
    expect([prepared.transport, prepared.holds(), w.posted]).toEqual([`tab:${TAB.tabSessionId}`, true, []]);
    const started = prepared.start();
    const [sent] = w.fetches();
    expect(sent?.url).toBe(`${FANSLY_RELAY_TARGET}group/${GROUP}/?ngsw-bypass=true`);
    expect(Object.fromEntries(sent?.headers ?? [])).toMatchObject({ authorization: 'token-1', 'fansly-client-id': 'client-1', 'fansly-session-id': 'session-1', 'fansly-client-check': 'check-group' });
    w.hub.head(FRAME, { requestId: sent?.requestId ?? '', status: 200, headers: [['content-type', 'application/json']] });
    w.hub.body(FRAME, { requestId: sent?.requestId ?? '', body: JSON.stringify({ success: true, response: { id: GROUP } }) });
    expect(await settle(started)).toEqual({ response: { id: GROUP }, status: 200 });
  });

  it('[FS-NET-4] no frame in time: refused before the custody, provably unsent, the pacer’s turn given back — and no direct request', async () => {
    const w = clientWorld();
    const error = await failure(w.api.client.prepare(greeting));
    expect(error).toBeInstanceOf(FanslyApiError);
    expect(error).toMatchObject({ kind: 'tab', code: 'CG-FAN-TAB', sent: false });
    expect([w.posted, w.direct]).toEqual([[], []]);
    // The turn was given back: the next call is routed at once once a frame is up.
    w.hub.hello(FRAME, hello);
    expect((await settle(w.api.client.prepare(registration))).transport).toBe(`tab:${TAB.tabSessionId}`);
  });

  it('[FS-NET-4] a document change between the route and the send refuses before any request (the frame went with its document)', async () => {
    const w = clientWorld();
    w.hub.hello(FRAME, hello);
    const prepared = await settle(w.api.client.prepare(greeting));
    w.hub.gone(FRAME);
    w.state.tabs = [{ tabSessionId: 'session-a2', tabId: TAB.tabId }];
    expect(prepared.holds()).toBe(false);
    const error = await failure(prepared.start());
    expect(error).toMatchObject({ kind: 'tab', code: 'CG-FAN-TAB', sent: false });
    expect([w.posted, w.direct]).toEqual([[], []]);
  });

  it('[FS-NET-4] an account change between the route and the send refuses before any request: the tab’s page on another session', async () => {
    const w = clientWorld();
    w.hub.hello(FRAME, hello);
    const prepared = await settle(w.api.client.prepare(greeting));
    w.state.sessions.set(TAB.tabId, OTHER);
    const error = await failure(prepared.start());
    expect(error).toMatchObject({ kind: 'tab', sent: false });
    expect(w.posted).toEqual([]);
  });

  it('[FS-NET-4] the frame refused by its own check: provably unsent; a frame lost after the post: sent, its outcome unknown', async () => {
    const w = clientWorld();
    w.hub.hello(FRAME, hello);
    const refused = (await settle(w.api.client.prepare(greeting))).start();
    w.hub.failure(FRAME, { requestId: w.fetches()[0]?.requestId ?? '', reason: 'refused' });
    expect(await failure(refused)).toMatchObject({ kind: 'tab', sent: false });
    const lost = (await settle(w.api.client.prepare(greeting))).start();
    w.hub.gone(FRAME);
    expect(await failure(lost)).toMatchObject({ kind: 'network', sent: true });
  });

  it('[FS-NET-3] a 429 through the tab counts by its head alone, its body never read', async () => {
    const w = clientWorld();
    w.hub.hello(FRAME, hello);
    const started = (await settle(w.api.client.prepare(registration))).start();
    const at = Date.now();
    w.hub.head(FRAME, { requestId: w.fetches()[0]?.requestId ?? '', status: 429, headers: [['retry-after', '60']] });
    expect(await failure(started)).toMatchObject({ kind: 'rate-limited', httpStatus: 429, sent: true, retryAt: at + 60_000 });
  });
});
