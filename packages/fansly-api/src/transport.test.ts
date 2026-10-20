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
import { createRelayTransport, FanslyRouteUnavailable, type FanslyFetch, type FanslyWireRequest, type RelayFetchEvent, type RelayTransportPorts } from './transport';

const T0 = Date.UTC(2026, 9, 16, 9, 0, 0);
const CREATOR = '300000000000000001';
const OTHER = '300000000000000002';
const GROUP = '300000000000000777';
const RELAY_ID = '00000000-0000-4000-8000-000000000501';
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
});
