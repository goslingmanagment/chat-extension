// The relay frame of «Fansly через вкладку» comes and goes (R20 P9c; docs/project-unite/architecture.md §8.5, §8.15;
// FS-NET-4, FX-001): the frame side of `cg-relay` (rpc-relay.ts) and what the background's RPC tells the site of it —
// its going (`relayGone`), the events to the tab (`fansly.relay.open`) and to its frames. The sender rules of the port
// itself: rpc.test.ts «the relay frame».

import { CONTRACTS_VERSION } from '@cg/contracts';
import { FANSLY_TAB_REQUEST_FIXTURES } from '@cg/contracts/fixtures';
import { fanslyEventTargets, isFanslyTabEventType, isFanslyTabRequestType, mayRequestFansly, parseFanslyTabPayload, FANSLY_TAB_TYPE_PREFIX } from '@cg/contracts/tab-messages-fansly';
import { describe, expect, it, vi } from 'vitest';

import { createBackgroundRpc, type BackgroundRpc, type SiteRpc, type SiteSenderContext } from './rpc-background';
import { eventEnvelope, requestEnvelope } from './rpc-common';
import { createRelayRpcClient } from './rpc-relay';
import { FANSLY_ORIGIN, TAB_HOSTS, createFakeBrowser, flush, tabSender, type FakeBrowser } from './test-support/fake-browser';

const uuidOf = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const fanslyRegister = { host: 'fansly-web', lateInjection: false, contractsVersion: CONTRACTS_VERSION } as const;
const relayHead = FANSLY_TAB_REQUEST_FIXTURES['fansly.relay.head'].req.valid[0];

function fanslySender(fake: FakeBrowser, overrides: Partial<Parameters<FakeBrowser['context']>[0]> = {}) {
  return tabSender(fake, { url: `${FANSLY_ORIGIN}/messages/700000000000000003`, origin: FANSLY_ORIGIN, tab: { id: 12 }, ...overrides });
}

function relaySender(fake: FakeBrowser, overrides: Partial<Parameters<FakeBrowser['context']>[0]> = {}) {
  return { id: fake.runtimeId, url: `${fake.base}fansly-relay.html`, frameId: 4, tab: { id: 12 }, ...overrides };
}

/** The Fansly registry as its background chunk plugs it; the handler answers each type's first valid fixture. */
function fanslySite(handled: { type: string; sender: SiteSenderContext }[]): SiteRpc {
  return {
    host: 'fansly-web',
    prefix: FANSLY_TAB_TYPE_PREFIX,
    isRequestType: isFanslyTabRequestType,
    mayRequest: (type, sender, page, host) => isFanslyTabRequestType(type) && mayRequestFansly(type, sender, page, host),
    parse: parseFanslyTabPayload,
    eventTargets: (type) => (isFanslyTabEventType(type) ? fanslyEventTargets(type) : null),
    handle: (type, _payload, sender) => {
      handled.push({ type, sender });
      return { ok: true, payload: (FANSLY_TAB_REQUEST_FIXTURES as Record<string, { res: { valid: readonly unknown[] } }>)[type]?.res.valid[0] };
    },
  };
}

function siteWorld(): { readonly fake: FakeBrowser; readonly rpc: BackgroundRpc } {
  const fake = createFakeBrowser();
  let sessions = 0;
  const rpc = createBackgroundRpc({
    api: fake.startBackground().api,
    tabHosts: TAB_HOSTS,
    relayPages: { 'fansly-web': 'fansly-relay.html' },
    siteWaitMs: 40,
    ready: Promise.resolve(),
    contractsVersion: CONTRACTS_VERSION,
    testBuild: true,
    mintSessionId: () => uuidOf(200 + ++sessions),
  });
  return { fake, rpc };
}

/** A port driven by hand: the raw answers it gets. */
async function rawPort(fake: FakeBrowser, sender: Parameters<FakeBrowser['context']>[0], name: string) {
  const port = fake.context(sender).api.runtime.connect({ name });
  const answers: Record<string, unknown>[] = [];
  let closed = false;
  port.onMessage.addListener((message) => answers.push(message as Record<string, unknown>));
  port.onDisconnect.addListener(() => {
    closed = true;
  });
  await flush(10);
  return { port, answers, closed: () => closed };
}

/** A registered tab port of Fansly: its session. */
async function registeredTab(fake: FakeBrowser, sender: Parameters<FakeBrowser['context']>[0]) {
  const tab = await rawPort(fake, sender, 'cg-tab');
  tab.port.postMessage(requestEnvelope(1, 'tab.register', fanslyRegister));
  await flush(30);
  const session = (tab.answers[0]?.['payload'] as { tabSessionId?: string } | undefined)?.tabSessionId ?? '';
  tab.answers.length = 0;
  return { ...tab, session };
}

describe('[FS-NET-4] [host:fansly] the relay frame comes and goes (R20 P9c)', () => {
  const RELAY_ID = uuidOf(340);
  const relayValidate = (kind: 'req' | 'res' | 'evt', type: string, payload: unknown) => parseFanslyTabPayload(kind, type, payload);

  it('the site hears once when a frame goes: the frame closed its port, or its tab’s document went (the core closed it)', async () => {
    const w = siteWorld();
    const gone: SiteSenderContext[] = [];
    w.rpc.site({ ...fanslySite([]), relayGone: (sender) => gone.push(sender) });
    const tab = await registeredTab(w.fake, fanslySender(w.fake));
    const first = await rawPort(w.fake, relaySender(w.fake), 'cg-relay');
    first.port.disconnect();
    await flush(20);
    expect(gone).toEqual([{ kind: 'relay', host: 'fansly-web', tabSessionId: tab.session, tabId: 12, frameId: 4, url: `${w.fake.base}fansly-relay.html` }]);
    const second = await rawPort(w.fake, relaySender(w.fake, { frameId: 6 }), 'cg-relay');
    tab.port.disconnect();
    await flush(20);
    expect(second.closed()).toBe(true);
    expect(gone.map((sender) => (sender.kind === 'relay' ? sender.frameId : null))).toEqual([4, 6]);
  });

  it('the tab gets `fansly.relay.open`, its frames do not; the frames get `fetch` and `abort`, the tab does not', async () => {
    const w = siteWorld();
    w.rpc.site(fanslySite([]));
    const tab = await registeredTab(w.fake, fanslySender(w.fake));
    const relay = await rawPort(w.fake, relaySender(w.fake), 'cg-relay');
    expect(w.rpc.emitSite('fansly-web', 'fansly.relay.open', {}, { tabSessionId: tab.session })).toBe(1);
    expect(w.rpc.emitSite('fansly-web', 'fansly.relay.open', { hostAccountId: '700000000000000001' }, { tabSessionId: tab.session })).toBe(0);
    await flush(20);
    expect(tab.answers).toEqual([eventEnvelope('fansly.relay.open', {})]);
    expect(relay.answers).toEqual([]);
  });

  it('[FX-001] the frame’s client: a port at once, its hello on every new port, its requests answered by the site, the events it is sent', async () => {
    const w = siteWorld();
    const handled: { type: string; sender: SiteSenderContext }[] = [];
    w.rpc.site(fanslySite(handled));
    const tab = await registeredTab(w.fake, fanslySender(w.fake));
    const frame = w.fake.context(relaySender(w.fake));
    const client = createRelayRpcClient({ api: frame.api, validate: relayValidate });
    const answers: unknown[] = [];
    client.onOpen(() => {
      void client.request('fansly.relay.hello', { hostAccountId: '700000000000000001', relayId: RELAY_ID }).then((answer) => answers.push(answer));
    });
    const fetches: unknown[] = [];
    client.onEvent('fansly.relay.fetch', (payload) => fetches.push(payload));
    await flush(40);
    expect(client.state()).toBe('open');
    expect(answers).toEqual([{ ok: true, payload: { recorded: true } }]);
    expect(handled.map((entry) => entry.type)).toEqual(['fansly.relay.hello']);
    const fetch = { requestId: uuidOf(330), method: 'GET', url: 'https://apiv3.fansly.com/api/v1/account/me', headers: [], expect: { hostAccountId: '700000000000000001', relayId: RELAY_ID } };
    expect(w.rpc.emitSite('fansly-web', 'fansly.relay.fetch', fetch, { tabSessionId: tab.session })).toBe(1);
    await flush(20);
    expect(fetches).toEqual([fetch]);
    client.close();
    await flush(20);
    expect(w.rpc.emitSite('fansly-web', 'fansly.relay.fetch', fetch, { tabSessionId: tab.session })).toBe(0);
  });

  it('[FX-001] a lost port: what was sent ends unanswered, never resent; a new port after 100 ms, the hello said again; the extension reloaded — nothing more', async () => {
    vi.useFakeTimers();
    try {
      // No site plugged yet: a request of the frame waits for it (siteWaitMs) — long enough to lose its port meanwhile.
      const w = siteWorld();
      const tab = await registeredTab(w.fake, fanslySender(w.fake));
      const frame = w.fake.context(relaySender(w.fake));
      const client = createRelayRpcClient({ api: frame.api, validate: relayValidate, reconnectDelaysMs: [100, 500] });
      let opens = 0;
      client.onOpen(() => {
        opens += 1;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect([client.state(), opens]).toEqual(['open', 1]);
      const pending = client.request('fansly.relay.head', relayHead);
      await vi.advanceTimersByTimeAsync(0);
      // The tab's document went: the core closes its frame's port.
      tab.port.disconnect();
      await vi.advanceTimersByTimeAsync(0);
      expect(await pending).toEqual({ ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE', detail: 'port lost' } });
      expect(client.state()).toBe('reconnecting');
      // The tab registered anew: the next port is taken, the frame says who it is there.
      await registeredTab(w.fake, fanslySender(w.fake));
      await vi.advanceTimersByTimeAsync(100);
      expect([client.state(), opens]).toEqual(['open', 2]);
      w.fake.reloadExtension();
      await vi.advanceTimersByTimeAsync(10);
      expect(client.state()).toBe('reloaded');
      await vi.advanceTimersByTimeAsync(10_000);
      expect(opens).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
