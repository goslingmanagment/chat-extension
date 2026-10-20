import { CONTRACTS_VERSION, DEFAULT_SETTINGS } from '@cg/contracts';
import { TAB_EVENT_FIXTURES, TAB_REQUEST_FIXTURES } from '@cg/contracts/fixtures';
import { TAB_REQUEST_TYPES, TAB_REQUESTS, parseTabPayload } from '@cg/contracts/tab-messages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FANSLY_TAB_REQUEST_FIXTURES } from '@cg/contracts/fixtures';
import { fanslyEventTargets, isFanslyTabEventType, isFanslyTabRequestType, mayRequestFansly, parseFanslyTabPayload, FANSLY_TAB_TYPE_PREFIX } from '@cg/contracts/tab-messages-fansly';

import { createBackgroundRpc, type BackgroundRpc, type PageSiteRoute, type SiteRpc, type SiteSenderContext } from './rpc-background';
import { eventEnvelope, requestEnvelope, verifyPageSender, verifyRelaySender, verifyTabSender, urlMatchesPattern } from './rpc-common';
import { createPageRpcClient } from './rpc-page';
import { createTabRpcClient, type TabRpcClient } from './rpc-tab';
import { FANSLY_ORIGIN, TAB_HOSTS, TAB_ORIGIN, createFakeBrowser, flush, pageSender, tabSender, type FakeBrowser, type FakeContext } from './test-support/fake-browser';

const uuidOf = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const settingsState = { settings: DEFAULT_SETTINGS, revision: 3, readOnly: false };
const register = { host: 'chatspace', lateInjection: false, contractsVersion: CONTRACTS_VERSION } as const;

interface World {
  readonly fake: FakeBrowser;
  rpc: BackgroundRpc;
  readonly starts: number[];
  readonly handled: { type: string; sender: string }[];
  readonly rejects: string[];
}

/** A background whose top-level code wires every request type to its first valid fixture answer. */
function world(options: { ready?: () => Promise<unknown> } = {}): World {
  const fake = createFakeBrowser();
  let sessions = 0;
  const state: World = { fake, rpc: null as unknown as BackgroundRpc, starts: [], handled: [], rejects: [] };
  const start = (context: FakeContext): void => {
    state.starts.push(state.starts.length + 1);
    const rpc = createBackgroundRpc({
      api: context.api,
      tabHosts: TAB_HOSTS,
      ready: options.ready?.() ?? Promise.resolve(),
      contractsVersion: CONTRACTS_VERSION,
      testBuild: true,
      mintSessionId: () => uuidOf(100 + ++sessions),
      onReject: (reason, facts) => state.rejects.push(`${reason}:${facts.type ?? '-'}:${facts.sender}`),
    });
    for (const type of TAB_REQUEST_TYPES) {
      if (type === 'tab.register') continue;
      rpc.handle(type, (_payload, sender) => {
        state.handled.push({ type, sender: sender.kind });
        return { ok: true, payload: TAB_REQUEST_FIXTURES[type].res.valid[0] } as never;
      });
    }
    state.rpc = rpc;
  };
  fake.onWake(start);
  start(fake.startBackground());
  return state;
}

function tabClient(fake: FakeBrowser, sender = tabSender(fake)): { client: TabRpcClient; context: FakeContext } {
  const context = fake.context(sender);
  return { client: createTabRpcClient({ api: context.api, validate: parseTabPayload, register }), context };
}

describe('sender checks (§5.4, §14)', () => {
  const fake = createFakeBrowser();
  const id = fake.runtimeId;

  it('[NF-027] a tab must be this extension, the top frame of a tab, on a host origin', () => {
    expect(verifyTabSender(tabSender(fake), id, TAB_HOSTS)).toMatchObject({ ok: true, kind: 'tab', host: 'chatspace', tabId: 7 });
    expect(verifyTabSender(tabSender(fake, { url: `${FANSLY_ORIGIN}/messages`, origin: FANSLY_ORIGIN }), id, TAB_HOSTS)).toMatchObject({ ok: true, host: 'fansly-web' });
    // Patterns of two kinds matching one URL is a misconfiguration: refused, never guessed.
    expect(verifyTabSender(tabSender(fake), id, { chatspace: [`${TAB_ORIGIN}/*`], 'fansly-web': ['https://*.example.test/*'] })).toEqual({ ok: false, reason: 'origin' });
    expect(verifyTabSender(tabSender(fake, { id: 'other@example' }), id, TAB_HOSTS)).toEqual({ ok: false, reason: 'foreign-extension' });
    expect(verifyTabSender(tabSender(fake, { frameId: 3 }), id, TAB_HOSTS)).toEqual({ ok: false, reason: 'subframe' });
    expect(verifyTabSender({ ...tabSender(fake), tab: {} }, id, TAB_HOSTS)).toEqual({ ok: false, reason: 'subframe' });
    expect(verifyTabSender(tabSender(fake, { url: 'https://evil.example.test/chat', origin: 'https://evil.example.test' }), id, TAB_HOSTS)).toEqual({
      ok: false,
      reason: 'origin',
    });
    // The browser's own origin wins over a URL that looks right.
    expect(verifyTabSender(tabSender(fake, { origin: 'null' }), id, TAB_HOSTS)).toEqual({ ok: false, reason: 'origin' });
    expect(verifyTabSender(undefined, id, TAB_HOSTS)).toEqual({ ok: false, reason: 'foreign-extension' });
  });

  it('[NF-027] a page must be one of our listed pages at our own base', () => {
    expect(verifyPageSender(pageSender(fake, 'options'), id, fake.base)).toMatchObject({ ok: true, kind: 'page', page: 'options' });
    expect(verifyPageSender(pageSender(fake, 'popup', { url: `${fake.base}popup.html?x=1#y` }), id, fake.base)).toMatchObject({ ok: true, page: 'popup' });
    expect(verifyPageSender(pageSender(fake, 'options', { tab: { id: 4 }, frameId: 0 }), id, fake.base)).toMatchObject({ ok: true, tabId: 4 });
    expect(verifyPageSender(pageSender(fake, 'options', { tab: { id: 4 }, frameId: 2 }), id, fake.base)).toEqual({ ok: false, reason: 'subframe' });
    expect(verifyPageSender(pageSender(fake, 'evil'), id, fake.base)).toEqual({ ok: false, reason: 'not-a-page' });
    expect(verifyPageSender(pageSender(fake, 'popup', { url: 'moz-extension://another-uuid/popup.html' }), id, fake.base)).toEqual({ ok: false, reason: 'not-a-page' });
    expect(verifyPageSender(tabSender(fake), id, fake.base)).toEqual({ ok: false, reason: 'not-a-page' });
    expect(verifyPageSender(pageSender(fake, 'popup', { id: 'x' }), id, fake.base)).toEqual({ ok: false, reason: 'foreign-extension' });
  });

  it('[EX-005] match patterns compare scheme and host, any port', () => {
    expect(urlMatchesPattern(new URL(`${TAB_ORIGIN}/chat`), `${TAB_ORIGIN}/*`)).toBe(true);
    expect(urlMatchesPattern(new URL('http://127.0.0.1:5179/x'), 'http://127.0.0.1/*')).toBe(true);
    expect(urlMatchesPattern(new URL('https://127.0.0.1/x'), 'http://127.0.0.1/*')).toBe(false);
    expect(urlMatchesPattern(new URL('https://a.example.test/'), 'https://*.example.test/*')).toBe(true);
    expect(urlMatchesPattern(new URL('https://example.test.evil/'), 'https://*.example.test/*')).toBe(false);
    expect(urlMatchesPattern(new URL('https://x.test/a/b'), '*://x.test/a/*')).toBe(true);
    expect(urlMatchesPattern(new URL('https://x.test/b'), 'https://x.test/a')).toBe(false);
    expect(urlMatchesPattern(new URL('https://x.test/a'), 'https://x.test/a')).toBe(true);
    expect(urlMatchesPattern(new URL('https://x.test/a'), 'not a pattern')).toBe(false);
  });
});

describe('[EX-015] typed RPC over cg-tab, sendMessage and cg-page', () => {
  it('[NF-027] every request type: valid from its senders, refused from the others', async () => {
    const w = world();
    const { client } = tabClient(w.fake);
    const options = w.fake.context(pageSender(w.fake, 'options'));
    const popup = w.fake.context(pageSender(w.fake, 'popup'));
    const debugJournal = w.fake.context(pageSender(w.fake, 'debug-journal'));
    const pageClient = (context: FakeContext) => createPageRpcClient({ api: context.api, validate: parseTabPayload, requestTimeoutMs: 50 });
    const pages = { options: pageClient(options), popup: pageClient(popup), 'debug-journal': pageClient(debugJournal) };
    // All at once: a refused request is never answered, so each one waits out its 50 ms.
    const checks: Promise<void>[] = [];
    for (const type of TAB_REQUEST_TYPES) {
      if (type === 'tab.register') continue;
      const spec = TAB_REQUESTS[type] as { from: readonly string[]; pages?: readonly string[] };
      const payload = TAB_REQUEST_FIXTURES[type].req.valid[0] as never;
      checks.push(client.request(type, payload, { timeoutMs: 50 }).then((fromTab) => expect(fromTab.ok, `${type} from a tab`).toBe(spec.from.includes('tab'))));
      for (const [page, pc] of Object.entries(pages)) {
        const allowed = spec.from.includes('page') && (spec.pages === undefined || spec.pages.includes(page));
        checks.push(
          pc.request(type, payload).then((fromPage) => {
            expect(fromPage.ok, `${type} from ${page}`).toBe(allowed);
            if (!allowed) expect(fromPage).toMatchObject({ ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE' } });
          }),
        );
      }
    }
    await Promise.all(checks);
    expect(w.rejects.some((r) => r.startsWith('sender-kind:session.signIn:tab'))).toBe(true);
    expect(w.rejects.some((r) => r.startsWith('sender-kind:op.start:page'))).toBe(true);
  });

  /** A tab port driven by hand (no client-side checks): answers are collected raw. */
  async function rawTab(w: World, sender: Parameters<FakeBrowser['context']>[0]) {
    const context = w.fake.context(sender);
    const port = context.api.runtime.connect({ name: 'cg-tab' });
    const answers: Record<string, unknown>[] = [];
    port.onMessage.addListener((message) => answers.push(message as Record<string, unknown>));
    await flush(10);
    return { port, answers };
  }

  it('[NF-027] a request must carry the session minted for its own port', async () => {
    const w = world();
    const a = tabClient(w.fake);
    await a.client.request('settings.get', {});
    // A second tab registers on its own port (its own session) and then claims tab A's session.
    const b = await rawTab(w, tabSender(w.fake, { tab: { id: 8 } }));
    b.port.postMessage(requestEnvelope(1, 'tab.register', register));
    await flush(30);
    const own = (b.answers[0]?.['payload'] as { tabSessionId?: string } | undefined)?.tabSessionId;
    expect(own).toBe(uuidOf(102));
    b.answers.length = 0;
    b.port.postMessage(requestEnvelope(2, 'settings.get', {}, uuidOf(101)));
    await flush(30);
    expect(b.answers).toEqual([]);
    expect(w.rejects).toEqual(['session:settings.get:tab']);
    // With its own session it is answered.
    b.port.postMessage(requestEnvelope(3, 'settings.get', {}, own));
    await flush(30);
    expect(b.answers).toMatchObject([{ kind: 'res', id: 3, ok: true }]);
  });

  it('[NF-027] an unregistered port, a register with a session, garbage, unknown types and tab events get no answer', async () => {
    const w = world();
    await tabClient(w.fake).client.request('settings.get', {});
    const { port, answers } = await rawTab(w, tabSender(w.fake, { tab: { id: 8 } }));
    // Unregistered: no session at all, or another tab's.
    port.postMessage(requestEnvelope(1, 'settings.get', {}, uuidOf(101)));
    port.postMessage(requestEnvelope(2, 'settings.get', {}));
    // tab.register must not carry a session.
    port.postMessage(requestEnvelope(3, 'tab.register', register, uuidOf(101)));
    // Not an envelope; an unknown type; an event from the tab.
    port.postMessage({ hello: 1 });
    port.postMessage(requestEnvelope(4, 'nope.nope', {}));
    port.postMessage({ v: 1, kind: 'evt', type: 'toast', payload: {} });
    await flush(30);
    expect(answers).toEqual([]);
    expect(w.rejects.filter((r) => r.startsWith('session'))).toHaveLength(3);
    expect(w.rejects).toContain('envelope:-:tab');
    expect(w.rejects).toContain('unknown-type:nope.nope:tab');
    expect(w.rpc.counters().session).toBe(3);
  });

  it('[NF-027] a tab registers only as the host kind of its origin', async () => {
    const w = world();
    const registered: string[] = [];
    // A ChatSpace tab claiming to be Fansly: no answer, counted.
    const fake = await rawTab(w, tabSender(w.fake));
    fake.port.postMessage(requestEnvelope(1, 'tab.register', { ...register, host: 'fansly-web' }));
    await flush(30);
    expect(fake.answers).toEqual([]);
    expect(w.rejects).toEqual(['origin:tab.register:tab']);
    expect(w.rpc.tabs()).toEqual([]);
    // A Fansly tab registering as Fansly is fine.
    const fanslySender = tabSender(w.fake, { url: `${FANSLY_ORIGIN}/messages`, origin: FANSLY_ORIGIN, tab: { id: 12 } });
    const fansly = createTabRpcClient({ api: w.fake.context(fanslySender).api, validate: parseTabPayload, register: { ...register, host: 'fansly-web' } });
    expect((await fansly.request('settings.get', {})).ok).toBe(true);
    for (const tab of w.rpc.tabs()) registered.push(`${tab.tabId}:${tab.request.host}`);
    expect(registered).toEqual(['12:fansly-web']);
  });

  it('[NF-027] a content script cannot use sendMessage as a page; another origin cannot open the tab port', async () => {
    const w = world();
    const tab = w.fake.context(tabSender(w.fake));
    const answer = await tab.api.runtime.sendMessage(requestEnvelope(1, 'settings.get', {}));
    expect(answer).toBeUndefined();
    const evil = tabClient(w.fake, tabSender(w.fake, { url: 'https://evil.example.test/', origin: 'https://evil.example.test' }));
    expect(await evil.client.request('settings.get', {}, { timeoutMs: 50 })).toMatchObject({ ok: false });
    expect(w.rejects).toContain('not-a-page:-:unknown');
    expect(w.rejects).toContain('origin:-:tab');
  });

  it('events reach the receivers their spec allows, and one tab when targeted', async () => {
    const w = world();
    const a = tabClient(w.fake);
    const b = tabClient(w.fake, tabSender(w.fake, { tab: { id: 8 } }));
    await a.client.request('settings.get', {});
    await b.client.request('settings.get', {});
    const page = createPageRpcClient({ api: w.fake.context(pageSender(w.fake, 'options')).api, validate: parseTabPayload });
    const seen: string[] = [];
    a.client.onEvent('settings.changed', (state) => seen.push(`a:${state.revision}`));
    b.client.onEvent('settings.changed', (state) => seen.push(`b:${state.revision}`));
    a.client.onEvent('toast', () => seen.push('a:toast'));
    b.client.onEvent('toast', () => seen.push('b:toast'));
    page.onEvent('settings.changed', (state) => seen.push(`page:${state.revision}`));
    page.onEvent('toast', () => seen.push('page:toast'));
    await flush(10);
    expect(w.rpc.pagePorts()).toBe(1);
    // [ST-018] a confirmed change reaches every tab and page at once.
    expect(w.rpc.emit('settings.changed', { ...settingsState, revision: 4 })).toBe(3);
    await flush(10);
    expect(seen.sort()).toEqual(['a:4', 'b:4', 'page:4']);
    seen.length = 0;
    const toast = TAB_EVENT_FIXTURES.toast.valid[0] as never;
    expect(w.rpc.emit('toast', toast, { tabSessionId: b.client.tabSessionId() ?? '' })).toBe(1);
    await flush(10);
    expect(seen).toEqual(['b:toast']);
    // An invalid event is not sent at all.
    expect(w.rpc.emit('settings.changed', { ...settingsState, revision: -1 })).toBe(0);
  });
});

describe('[RB-010] the tab port reconnects 100/200/400 ms after the background goes away', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ends what was sent, wakes the event page again and registers a new session', async () => {
    let gate: (() => void) | null = null;
    const w = world();
    const { client } = tabClient(w.fake);
    await vi.waitFor(() => expect(client.state()).toBe('ready'));
    const first = client.tabSessionId();
    // A request the background is still working on when it unloads.
    w.rpc.handle('catalog.get', () => new Promise((resolve) => (gate = () => resolve({ ok: true, payload: TAB_REQUEST_FIXTURES['catalog.get'].res.valid[0] as never }))));
    const pending = client.request('catalog.get', {});
    await vi.advanceTimersByTimeAsync(0);
    const states: string[] = [];
    client.onState((state) => states.push(state));
    w.fake.unloadBackground();
    // Never resent: a write may have run.
    expect(await pending).toEqual({ ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE', detail: 'port lost' } });
    expect(client.state()).toBe('reconnecting');
    // Issued while reconnecting: waits for the new session.
    const later = client.request('settings.get', {});
    await vi.advanceTimersByTimeAsync(99);
    expect(w.starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(client.state()).toBe('ready'));
    expect(w.starts).toHaveLength(2);
    expect((await later).ok).toBe(true);
    expect(client.tabSessionId()).not.toBe(first);
    expect(states).toEqual(['reconnecting', 'ready']);
    (gate as (() => void) | null)?.();
  });

  it('a request that timed out while waiting for registration is never sent afterwards', async () => {
    let open!: () => void;
    const w = world({ ready: () => new Promise<void>((resolve) => (open = resolve)) });
    const { client } = tabClient(w.fake);
    const early = client.request('catalog.get', {}, { timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    expect(await early).toEqual({ ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE', detail: 'catalog.get timeout' } });
    open();
    await vi.waitFor(() => expect(client.state()).toBe('ready'));
    await vi.advanceTimersByTimeAsync(10);
    expect(w.handled).toEqual([]);
  });
});

// ── 1.15.0 (R20): a site's own registry, the host rules and the relay frame (fansly-web) ──

const RELAY_PAGES = { 'fansly-web': 'fansly-relay.html' } as const;
const fanslyRegister = { ...register, host: 'fansly-web' } as const;

function fanslySender(fake: FakeBrowser, overrides: Partial<Parameters<FakeBrowser['context']>[0]> = {}) {
  return tabSender(fake, { url: `${FANSLY_ORIGIN}/messages/700000000000000003`, origin: FANSLY_ORIGIN, tab: { id: 12 }, ...overrides });
}

function relaySender(fake: FakeBrowser, overrides: Partial<Parameters<FakeBrowser['context']>[0]> = {}) {
  return { id: fake.runtimeId, url: `${fake.base}fansly-relay.html`, frameId: 4, tab: { id: 12 }, ...overrides };
}

/** The Fansly registry as its background chunk plugs it; the handler answers each type's first valid fixture. */
function fanslySite(handled: { type: string; sender: SiteSenderContext }[], answer?: (type: string) => unknown): SiteRpc {
  return {
    host: 'fansly-web',
    prefix: FANSLY_TAB_TYPE_PREFIX,
    isRequestType: isFanslyTabRequestType,
    mayRequest: (type, sender, page, host) => isFanslyTabRequestType(type) && mayRequestFansly(type, sender, page, host),
    parse: parseFanslyTabPayload,
    eventTargets: (type) => (isFanslyTabEventType(type) ? fanslyEventTargets(type) : null),
    handle: (type, _payload, sender) => {
      handled.push({ type, sender });
      return { ok: true, payload: answer?.(type) ?? (FANSLY_TAB_REQUEST_FIXTURES as Record<string, { res: { valid: readonly unknown[] } }>)[type]?.res.valid[0] };
    },
  };
}

interface SiteWorld {
  readonly fake: FakeBrowser;
  readonly rpc: BackgroundRpc;
  readonly rejects: string[];
}

function siteWorld(pageSite?: PageSiteRoute): SiteWorld {
  const fake = createFakeBrowser();
  const rejects: string[] = [];
  let sessions = 0;
  const rpc = createBackgroundRpc({
    api: fake.startBackground().api,
    tabHosts: TAB_HOSTS,
    relayPages: RELAY_PAGES,
    siteWaitMs: 40,
    ...(pageSite === undefined ? {} : { pageSite }),
    ready: Promise.resolve(),
    contractsVersion: CONTRACTS_VERSION,
    testBuild: true,
    mintSessionId: () => uuidOf(200 + ++sessions),
    onReject: (reason, facts) => rejects.push(`${reason}:${facts.type ?? '-'}:${facts.sender}`),
  });
  rpc.handle('settings.get', () => ({ ok: true, payload: TAB_REQUEST_FIXTURES['settings.get'].res.valid[0] }) as never);
  rpc.handle('send.status', () => ({ ok: true, payload: TAB_REQUEST_FIXTURES['send.status'].res.valid[0] }) as never);
  return { fake, rpc, rejects };
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

/** A registered tab port of a site: its session. */
async function registeredTab(fake: FakeBrowser, sender: Parameters<FakeBrowser['context']>[0], request: typeof register | typeof fanslyRegister) {
  const tab = await rawPort(fake, sender, 'cg-tab');
  tab.port.postMessage(requestEnvelope(1, 'tab.register', request));
  await flush(30);
  const session = (tab.answers[0]?.['payload'] as { tabSessionId?: string } | undefined)?.tabSessionId ?? '';
  tab.answers.length = 0;
  return { ...tab, session };
}

const notesRead = FANSLY_TAB_REQUEST_FIXTURES['fansly.notes.read'].req.valid[0];
const relayHead = FANSLY_TAB_REQUEST_FIXTURES['fansly.relay.head'].req.valid[0];
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('[EX-015] [NF-027] a site’s own registry and the host rules (fansly-web, 1.15.0)', () => {
  it('a fansly.com tab is refused ChatSpace’s X8 and «Новые» requests; a ChatSpace tab and a page are not', async () => {
    const w = siteWorld();
    const fansly = createTabRpcClient({ api: w.fake.context(fanslySender(w.fake)).api, validate: parseTabPayload, register: fanslyRegister });
    expect((await fansly.request('settings.get', {})).ok).toBe(true);
    const status = TAB_REQUEST_FIXTURES['send.status'].req.valid[0] as never;
    expect((await fansly.request('send.status', status, { timeoutMs: 50 })).ok).toBe(false);
    expect(w.rejects).toContain('sender-kind:send.status:tab');
    const chatspace = createTabRpcClient({ api: w.fake.context(tabSender(w.fake)).api, validate: parseTabPayload, register });
    expect((await chatspace.request('send.status', status)).ok).toBe(true);
    const options = createPageRpcClient({ api: w.fake.context(pageSender(w.fake, 'options')).api, validate: parseTabPayload, requestTimeoutMs: 50 });
    expect((await options.request('send.status', status)).ok).toBe(true);
  });

  it('a ChatSpace tab never reaches the Fansly registry; neither does a page, nor a relay type from a tab', async () => {
    const w = siteWorld();
    const handled: { type: string; sender: SiteSenderContext }[] = [];
    w.rpc.site(fanslySite(handled));
    const chatspace = await registeredTab(w.fake, tabSender(w.fake), register);
    chatspace.port.postMessage(requestEnvelope(2, 'fansly.notes.read', notesRead, chatspace.session));
    const fansly = await registeredTab(w.fake, fanslySender(w.fake), fanslyRegister);
    fansly.port.postMessage(requestEnvelope(2, 'fansly.relay.head', relayHead, fansly.session));
    fansly.port.postMessage(requestEnvelope(3, 'fansly.nope.nope', {}, fansly.session));
    // A page sends by runtime.sendMessage; no site registry takes a page's request (none of its types is a page's).
    const options = createPageRpcClient({ api: w.fake.context(pageSender(w.fake, 'options')).api, validate: parseFanslyTabPayload, requestTimeoutMs: 50 });
    expect((await options.request('fansly.notes.read' as never, notesRead as never)).ok).toBe(false);
    await wait(60);
    await flush(30);
    expect(chatspace.answers).toEqual([]);
    expect(fansly.answers).toEqual([]);
    expect(handled).toEqual([]);
    expect(w.rejects.sort()).toEqual(['sender-kind:fansly.relay.head:tab', 'unknown-type:fansly.nope.nope:tab', 'unknown-type:fansly.notes.read:page', 'unknown-type:fansly.notes.read:tab'].sort());
  });
});

describe('[NF-027] the relay frame (`cg-relay`, fansly-web, 1.15.0)', () => {
  it('sender: this extension, a subframe of a tab, the relay page of exactly one site', () => {
    const fake = createFakeBrowser();
    const id = fake.runtimeId;
    expect(verifyRelaySender(relaySender(fake), id, fake.base, RELAY_PAGES)).toEqual({ ok: true, kind: 'relay', host: 'fansly-web', tabId: 12, frameId: 4, url: `${fake.base}fansly-relay.html` });
    expect(verifyRelaySender(relaySender(fake, { url: `${fake.base}fansly-relay.html?tab=12` }), id, fake.base, RELAY_PAGES)).toMatchObject({ ok: true, host: 'fansly-web' });
    expect(verifyRelaySender(relaySender(fake, { id: 'other@example' }), id, fake.base, RELAY_PAGES)).toEqual({ ok: false, reason: 'foreign-extension' });
    // The top frame is a tab's, never a relay's; a frame outside a tab; another page of ours; another base; no relay configured.
    const { tab: _tab, ...outsideTab } = relaySender(fake);
    for (const sender of [relaySender(fake, { frameId: 0 }), outsideTab, relaySender(fake, { url: `${fake.base}popup.html` }), relaySender(fake, { url: 'moz-extension://another-uuid/fansly-relay.html' }), relaySender(fake, { url: `${FANSLY_ORIGIN}/fansly-relay.html` })]) {
      expect(verifyRelaySender(sender, id, fake.base, RELAY_PAGES), JSON.stringify(sender)).toEqual({ ok: false, reason: 'not-a-relay' });
    }
    expect(verifyRelaySender(relaySender(fake), id, fake.base, {})).toEqual({ ok: false, reason: 'not-a-relay' });
    // Two sites naming one page: none of them.
    expect(verifyRelaySender(relaySender(fake), id, fake.base, { chatspace: 'fansly-relay.html', 'fansly-web': 'fansly-relay.html' })).toEqual({ ok: false, reason: 'not-a-relay' });
  });

  it('is accepted only inside a tab holding a registered session of its site, and speaks for that session only', async () => {
    const w = siteWorld();
    const handled: { type: string; sender: SiteSenderContext }[] = [];
    w.rpc.site(fanslySite(handled));
    // No registered Fansly tab 12 yet: refused, disconnected.
    const early = await rawPort(w.fake, relaySender(w.fake), 'cg-relay');
    expect(early.closed()).toBe(true);
    // A ChatSpace tab with the same id does not count either.
    await registeredTab(w.fake, tabSender(w.fake, { tab: { id: 12 } }), register);
    expect((await rawPort(w.fake, relaySender(w.fake), 'cg-relay')).closed()).toBe(true);
    expect(w.rejects).toEqual(['not-a-relay:-:relay', 'not-a-relay:-:relay']);
    w.rejects.length = 0;

    const tab = await registeredTab(w.fake, fanslySender(w.fake), fanslyRegister);
    const relay = await rawPort(w.fake, relaySender(w.fake), 'cg-relay');
    expect(relay.closed()).toBe(false);
    relay.port.postMessage(requestEnvelope(1, 'fansly.relay.head', relayHead));
    // A session of its own, a shared type, a tab type of the site: none of these.
    relay.port.postMessage(requestEnvelope(2, 'fansly.relay.head', relayHead, tab.session));
    relay.port.postMessage(requestEnvelope(3, 'settings.get', {}));
    relay.port.postMessage(requestEnvelope(4, 'fansly.notes.read', notesRead));
    await flush(40);
    expect(relay.answers).toEqual([{ v: 1, kind: 'res', id: 1, type: 'fansly.relay.head', ok: true, payload: { recorded: true } }]);
    expect(handled).toEqual([{ type: 'fansly.relay.head', sender: { kind: 'relay', host: 'fansly-web', tabSessionId: tab.session, tabId: 12, frameId: 4, url: `${w.fake.base}fansly-relay.html` } }]);
    expect(w.rejects).toEqual(['envelope:-:relay', 'sender-kind:settings.get:relay', 'sender-kind:fansly.notes.read:relay']);
  });

  it('gets the site’s relay events, its own tab’s only; goes when its tab’s document goes', async () => {
    const w = siteWorld();
    w.rpc.site(fanslySite([]));
    const tab = await registeredTab(w.fake, fanslySender(w.fake), fanslyRegister);
    const other = await registeredTab(w.fake, fanslySender(w.fake, { tab: { id: 13 } }), fanslyRegister);
    const relay = await rawPort(w.fake, relaySender(w.fake), 'cg-relay');
    const otherRelay = await rawPort(w.fake, relaySender(w.fake, { tab: { id: 13 } }), 'cg-relay');
    const fetch = { requestId: uuidOf(330), method: 'GET', url: 'https://apiv3.fansly.com/api/v1/account/me', headers: [], expect: { hostAccountId: '700000000000000001' } };
    expect(w.rpc.emitSite('fansly-web', 'fansly.relay.fetch', fetch, { tabSessionId: tab.session })).toBe(1);
    expect(w.rpc.emitSite('fansly-web', 'fansly.relay.fetch', { ...fetch, url: 'https://evil.example.test/' })).toBe(0);
    expect(w.rpc.emitSite('chatspace', 'fansly.relay.fetch', fetch)).toBe(0);
    await flush(20);
    expect(relay.answers).toEqual([eventEnvelope('fansly.relay.fetch', fetch)]);
    expect(otherRelay.answers).toEqual([]);
    // Not to the tabs: the event is the relay's.
    expect([...tab.answers, ...other.answers]).toEqual([]);
    tab.port.disconnect();
    await flush(20);
    expect(relay.closed()).toBe(true);
    expect(otherRelay.closed()).toBe(false);
    // The other tab's relay still gets its tab's events.
    expect(w.rpc.emitSite('fansly-web', 'fansly.relay.abort', { requestId: uuidOf(331) })).toBe(1);
  });
});
