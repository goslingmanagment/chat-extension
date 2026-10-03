import { CONTRACTS_VERSION, DEFAULT_SETTINGS } from '@cg/contracts';
import { TAB_EVENT_FIXTURES, TAB_REQUEST_FIXTURES } from '@cg/contracts/fixtures';
import { TAB_REQUEST_TYPES, TAB_REQUESTS, parseTabPayload } from '@cg/contracts/tab-messages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBackgroundRpc, type BackgroundRpc } from './rpc-background';
import { requestEnvelope, verifyPageSender, verifyTabSender, urlMatchesPattern } from './rpc-common';
import { createPageRpcClient } from './rpc-page';
import { createTabRpcClient, type TabRpcClient } from './rpc-tab';
import { TAB_MATCHES, TAB_ORIGIN, createFakeBrowser, flush, pageSender, tabSender, type FakeBrowser, type FakeContext } from './test-support/fake-browser';

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
      tabMatches: TAB_MATCHES,
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
    expect(verifyTabSender(tabSender(fake), id, TAB_MATCHES)).toMatchObject({ ok: true, kind: 'tab', tabId: 7 });
    expect(verifyTabSender(tabSender(fake, { id: 'other@example' }), id, TAB_MATCHES)).toEqual({ ok: false, reason: 'foreign-extension' });
    expect(verifyTabSender(tabSender(fake, { frameId: 3 }), id, TAB_MATCHES)).toEqual({ ok: false, reason: 'subframe' });
    expect(verifyTabSender({ ...tabSender(fake), tab: {} }, id, TAB_MATCHES)).toEqual({ ok: false, reason: 'subframe' });
    expect(verifyTabSender(tabSender(fake, { url: 'https://evil.example.test/chat', origin: 'https://evil.example.test' }), id, TAB_MATCHES)).toEqual({
      ok: false,
      reason: 'origin',
    });
    // The browser's own origin wins over a URL that looks right.
    expect(verifyTabSender(tabSender(fake, { origin: 'null' }), id, TAB_MATCHES)).toEqual({ ok: false, reason: 'origin' });
    expect(verifyTabSender(undefined, id, TAB_MATCHES)).toEqual({ ok: false, reason: 'foreign-extension' });
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
  it('registers the tab, then answers its requests with schema-checked payloads', async () => {
    const w = world();
    const { client } = tabClient(w.fake);
    const states: string[] = [];
    client.onState((state) => states.push(state));
    const result = await client.request('settings.get', {});
    expect(result).toEqual({ ok: true, payload: TAB_REQUEST_FIXTURES['settings.get'].res.valid[0] });
    expect(client.state()).toBe('ready');
    expect(client.tabSessionId()).toBe(uuidOf(101));
    expect(states).toEqual(['ready']);
    expect(w.rpc.tabs()).toEqual([expect.objectContaining({ tabSessionId: uuidOf(101), tabId: 7, request: register })]);
    expect(w.handled).toEqual([{ type: 'settings.get', sender: 'tab' }]);
  });

  it('[NF-027] every request type: valid from its senders, refused from the others', async () => {
    const w = world();
    const { client } = tabClient(w.fake);
    const options = w.fake.context(pageSender(w.fake, 'options'));
    const popup = w.fake.context(pageSender(w.fake, 'popup'));
    const debugJournal = w.fake.context(pageSender(w.fake, 'debug-journal'));
    const pageClient = (context: FakeContext) => createPageRpcClient({ api: context.api, validate: parseTabPayload, requestTimeoutMs: 50 });
    const pages = { options: pageClient(options), popup: pageClient(popup), 'debug-journal': pageClient(debugJournal) };
    for (const type of TAB_REQUEST_TYPES) {
      if (type === 'tab.register') continue;
      const spec = TAB_REQUESTS[type] as { from: readonly string[]; pages?: readonly string[] };
      const payload = TAB_REQUEST_FIXTURES[type].req.valid[0] as never;
      const fromTab = await client.request(type, payload, { timeoutMs: 50 });
      expect(fromTab.ok, `${type} from a tab`).toBe(spec.from.includes('tab'));
      for (const [page, pc] of Object.entries(pages)) {
        const allowed = spec.from.includes('page') && (spec.pages === undefined || spec.pages.includes(page));
        const fromPage = await pc.request(type, payload);
        expect(fromPage.ok, `${type} from ${page}`).toBe(allowed);
        if (!allowed) expect(fromPage).toMatchObject({ ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE' } });
      }
    }
    expect(w.rejects.some((r) => r.startsWith('sender-kind:session.signIn:tab'))).toBe(true);
    expect(w.rejects.some((r) => r.startsWith('sender-kind:op.start:page'))).toBe(true);
  });

  it('[SN-016] sound events only from a host tab top frame; the preview only from the options page', async () => {
    const w = world();
    const { client } = tabClient(w.fake);
    const fact = TAB_REQUEST_FIXTURES['sound.event'].req.valid[0] as never;
    expect((await client.request('sound.event', fact)).ok).toBe(true);
    const preview = TAB_REQUEST_FIXTURES['sound.preview'].req.valid[0] as never;
    expect((await client.request('sound.preview', preview, { timeoutMs: 50 })).ok).toBe(false);
    const options = createPageRpcClient({ api: w.fake.context(pageSender(w.fake, 'options')).api, validate: parseTabPayload, requestTimeoutMs: 50 });
    const popup = createPageRpcClient({ api: w.fake.context(pageSender(w.fake, 'popup')).api, validate: parseTabPayload, requestTimeoutMs: 50 });
    expect((await options.request('sound.preview', preview)).ok).toBe(true);
    expect((await popup.request('sound.preview', preview)).ok).toBe(false);
    // A subframe on the host cannot open the tab port at all.
    const sub = tabClient(w.fake, tabSender(w.fake, { frameId: 1, tab: { id: 9 } }));
    expect((await sub.client.request('sound.event', fact, { timeoutMs: 50 })).ok).toBe(false);
    expect(w.rejects).toContain('subframe:-:tab');
  });

  it('[NF-027] a request must carry the session minted for its own port', async () => {
    const w = world();
    const a = tabClient(w.fake);
    await a.client.request('settings.get', {});
    // A second tab claims tab A's session on its own port.
    const b = w.fake.context(tabSender(w.fake, { tab: { id: 8 } }));
    const port = b.api.runtime.connect({ name: 'cg-tab' });
    const answers: unknown[] = [];
    port.onMessage.addListener((message) => answers.push(message));
    port.postMessage(requestEnvelope(1, 'settings.get', {}, uuidOf(101)));
    // Unregistered: no session at all.
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

  it('answers an error, never a malformed payload: bad request, bad response, throwing handler, missing handler', async () => {
    const w = world();
    const { client } = tabClient(w.fake);
    await client.request('settings.get', {});
    w.rpc.handle('quota.get', () => ({ ok: true, payload: { quota: 'nope' } }) as never);
    w.rpc.handle('catalog.get', () => {
      throw new Error('boom');
    });
    w.rpc.handle('persona.set', () => ({ ok: false, error: { code: 'CG-PERSONA-NONE' } }));
    expect(await client.request('quota.get', { pageId: 11 })).toEqual({ ok: false, error: { code: 'CG-UNKNOWN', detail: 'invalid quota.get response' } });
    expect(await client.request('catalog.get', {})).toEqual({ ok: false, error: { code: 'CG-UNKNOWN', detail: 'catalog.get handler failed' } });
    expect(await client.request('persona.set', { pageId: 11, key: 'lora', definitionId: 'pdef_0123456789abcdef' })).toEqual({ ok: false, error: { code: 'CG-PERSONA-NONE' } });
    expect(await client.request('quota.get', { pageId: 0 })).toEqual({ ok: false, error: { code: 'CG-UNKNOWN', detail: 'invalid quota.get request' } });
    const bare = world();
    bare.rpc.dispose();
    const fresh = createBackgroundRpc({ api: bare.fake.startBackground().api, tabMatches: TAB_MATCHES, ready: Promise.resolve(), contractsVersion: CONTRACTS_VERSION, testBuild: false });
    const other = tabClient(bare.fake);
    expect(await other.client.request('settings.get', {})).toEqual({ ok: false, error: { code: 'CG-UNKNOWN', detail: 'no handler for settings.get' } });
    expect(fresh.counters().handler).toBe(1);
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

  it('[ST-018] a tab drops an event that fails its schema', async () => {
    const w = world();
    const { client, context } = tabClient(w.fake);
    await client.request('settings.get', {});
    const seen: unknown[] = [];
    client.onEvent('settings.changed', (state) => seen.push(state));
    const serverPort = [...(w.fake.background()?.ports ?? [])][0];
    serverPort?.postMessage({ v: 1, kind: 'evt', type: 'settings.changed', payload: { revision: 'x' } });
    serverPort?.postMessage({ v: 1, kind: 'evt', type: 'settings.changed', payload: settingsState });
    await flush(10);
    expect(seen).toEqual([settingsState]);
    expect(context.alive).toBe(true);
  });
});

describe('[BG-004] readiness barrier: listeners first, answers after the one ready promise', () => {
  it('registers listeners synchronously and holds every request until ready', async () => {
    let open!: () => void;
    const w = world({ ready: () => new Promise<void>((resolve) => (open = resolve)) });
    const background = w.fake.background();
    expect(background?.events.onConnect.size).toBe(1);
    expect(background?.events.onMessage.size).toBe(1);
    const { client } = tabClient(w.fake);
    const page = createPageRpcClient({ api: w.fake.context(pageSender(w.fake, 'popup')).api, validate: parseTabPayload });
    let tabAnswered = false;
    let pageAnswered = false;
    const tabResult = client.request('settings.get', {}).then((r) => ((tabAnswered = true), r));
    const pageResult = page.request('settings.get', {}).then((r) => ((pageAnswered = true), r));
    await flush(30);
    expect(tabAnswered || pageAnswered).toBe(false);
    expect(client.state()).toBe('connecting');
    open();
    expect((await tabResult).ok).toBe(true);
    expect((await pageResult).ok).toBe(true);
  });

  it('a barrier that failed answers CG-UNKNOWN instead of hanging', async () => {
    const w = world({ ready: () => Promise.reject(new Error('settings unreadable')) });
    const page = createPageRpcClient({ api: w.fake.context(pageSender(w.fake, 'popup')).api, validate: parseTabPayload });
    expect(await page.request('settings.get', {})).toEqual({ ok: false, error: { code: 'CG-UNKNOWN', detail: 'background not ready' } });
    const { client } = tabClient(w.fake);
    expect(await client.request('settings.get', {}, { timeoutMs: 100 })).toMatchObject({ ok: false });
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

  it('gives up after three failed attempts, and reconnects on a human action', async () => {
    const w = world();
    const { client } = tabClient(w.fake);
    await vi.waitFor(() => expect(client.state()).toBe('ready'));
    w.fake.onWake(() => undefined); // the event page starts but registers nothing
    w.fake.unloadBackground();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.state()).toBe('reconnecting');
    const waiting = client.request('settings.get', {});
    await vi.advanceTimersByTimeAsync(100 + 200 + 400 + 10);
    expect(client.state()).toBe('lost');
    expect(await waiting).toEqual({ ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE', detail: 'background unreachable' } });
    expect(await client.request('settings.get', {})).toEqual({ ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE', detail: 'lost' } });
    let starts = 0;
    w.fake.onWake((context) => {
      starts += 1;
      const rpc = createBackgroundRpc({ api: context.api, tabMatches: TAB_MATCHES, ready: Promise.resolve(), contractsVersion: CONTRACTS_VERSION, testBuild: true });
      rpc.handle('settings.get', () => ({ ok: true, payload: settingsState }));
    });
    // The broken event page goes away; the next connection wakes a working one.
    w.fake.unloadBackground();
    client.reconnect();
    await vi.waitFor(() => expect(client.state()).toBe('ready'));
    expect(starts).toBe(1);
    expect(await client.request('settings.get', {})).toEqual({ ok: true, payload: settingsState });
  });

  it('a register the background never answers counts as a failed attempt', async () => {
    const w = world({ ready: () => new Promise(() => undefined) });
    const context = w.fake.context(tabSender(w.fake));
    const client = createTabRpcClient({ api: context.api, validate: parseTabPayload, register, registerTimeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.state()).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(100 + 1000 + 200 + 1000 + 400 + 1000);
    expect(client.state()).toBe('lost');
  });

  it('an extension reloaded under the tab is CG-RUNTIME-RELOADED, with no reconnect', async () => {
    const w = world();
    const { client } = tabClient(w.fake);
    await vi.waitFor(() => expect(client.state()).toBe('ready'));
    w.rpc.handle('catalog.get', () => new Promise(() => undefined));
    const pending = client.request('catalog.get', {});
    await vi.advanceTimersByTimeAsync(0);
    w.fake.reloadExtension();
    expect(await pending).toEqual({ ok: false, error: { code: 'CG-RUNTIME-RELOADED', detail: 'extension reloaded' } });
    expect(client.state()).toBe('reloaded');
    expect(await client.request('settings.get', {})).toEqual({ ok: false, error: { code: 'CG-RUNTIME-RELOADED', detail: 'extension reloaded' } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(w.starts).toHaveLength(1);
  });

  it('times a request out and ignores its late answer; close ends everything', async () => {
    const w = world();
    const { client } = tabClient(w.fake);
    await vi.waitFor(() => expect(client.state()).toBe('ready'));
    let release!: () => void;
    w.rpc.handle('catalog.get', () => new Promise((resolve) => (release = () => resolve({ ok: true, payload: TAB_REQUEST_FIXTURES['catalog.get'].res.valid[0] as never }))));
    const slow = client.request('catalog.get', {}, { timeoutMs: 500 });
    await vi.advanceTimersByTimeAsync(500);
    expect(await slow).toEqual({ ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE', detail: 'catalog.get timeout' } });
    release();
    await vi.advanceTimersByTimeAsync(0);
    const hanging = client.request('catalog.get', {});
    await vi.advanceTimersByTimeAsync(0);
    client.close();
    expect(await hanging).toEqual({ ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE', detail: 'closed' } });
    expect(client.state()).toBe('closed');
    expect(await client.request('settings.get', {})).toMatchObject({ ok: false });
  });
});

describe('page client', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('times out, maps a missing background to CG-RUNTIME-UNREACHABLE and reopens its event port', async () => {
    const w = world();
    const context = w.fake.context(pageSender(w.fake, 'options'));
    const page = createPageRpcClient({ api: context.api, validate: parseTabPayload, requestTimeoutMs: 300 });
    w.rpc.handle('catalog.get', () => new Promise(() => undefined));
    const slow = page.request('catalog.get', {});
    await vi.advanceTimersByTimeAsync(300);
    expect(await slow).toEqual({ ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE', detail: 'catalog.get timeout' } });
    const states: string[] = [];
    page.onEventsState((state) => states.push(state));
    const revisions: number[] = [];
    page.onEvent('settings.changed', (state) => revisions.push(state.revision));
    await vi.advanceTimersByTimeAsync(1500);
    w.fake.unloadBackground();
    await vi.advanceTimersByTimeAsync(100);
    await vi.waitFor(() => expect(w.rpc.pagePorts()).toBe(1));
    w.rpc.emit('settings.changed', { ...settingsState, revision: 9 });
    await vi.advanceTimersByTimeAsync(0);
    expect(revisions).toEqual([9]);
    expect(states).toEqual(['open', 'reconnecting', 'open']);
    // No background at all: sendMessage rejects.
    w.fake.onWake(() => undefined);
    w.fake.unloadBackground();
    expect(await page.request('settings.get', {})).toEqual({ ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE', detail: 'settings.get not delivered' } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(states.at(-1)).toBe('lost');
    page.close();
    expect(await page.request('settings.get', {})).toEqual({ ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE', detail: 'closed' } });
  });

  it('refuses an answer that is not the reply to this request', async () => {
    const w = world();
    w.fake.background()?.events.onMessage.clear();
    w.fake.background()?.events.onMessage.addListener((raw) => {
      const request = raw as { id: number };
      return Promise.resolve({ v: 1, kind: 'res', id: request.id + 1, type: 'settings.get', ok: true, payload: settingsState });
    });
    const page = createPageRpcClient({ api: w.fake.context(pageSender(w.fake, 'popup')).api, validate: parseTabPayload });
    expect(await page.request('settings.get', {})).toEqual({ ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE', detail: 'settings.get unanswered' } });
  });
});
