// The neighbour's page hooks (R20 P6d; S5 §2.3, §2.6, §6.2 A, C, D), over a
// scripted XHR whose methods live on its prototype like the native one's:
// the network hook patches the prototype read through whatever constructor
// stands (our Proxy first, in the field order), the guard swallows a matching
// `POST /message` with no XHR event at all, `dispose` restores only what is
// still on top, the July build hooks everything and never leaves, the MAIN
// script's `Map.prototype` patch ends at Angular's view registry. The last
// tests show what our tap must never do (architecture.md А11): instance
// copies of the methods bypass the guard.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installGeneric } from './generic';
import { GUARD_TOAST, contentOf, guardPattern, installGuard, matchWord } from './guard';
import { LVIEW_ID_SLOT, installMapPatch } from './map-patch';
import { installNetworkHook, isApiAddress, rewriteMediaUrl, type HookInstance } from './network-hook';
import { BRIDGE_EVENTS, FBUDDY_IDS, FBUDDY_KEYS, FBUDDY_XHR, type NetworkEventPayload } from './protocol';

const API = 'http://localhost:4100';
const PAGE = 'http://localhost:4000';

/** An XHR with its methods on the prototype, as the native one has them; `respond` plays the network. */
class ScriptedXhr extends EventTarget {
  static sent: ScriptedXhr[] = [];
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown = undefined;
  status = 0;
  responseText = '';
  responseType: XMLHttpRequestResponseType = '';
  nativeSends = 0;

  open(method: string, url: string | URL): void {
    this.method = method;
    this.url = String(url);
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  send(body?: unknown): void {
    this.body = body;
    this.nativeSends += 1;
    ScriptedXhr.sent.push(this);
    this.dispatchEvent(new Event('loadstart'));
  }

  respond(status: number, text: string): void {
    this.status = status;
    this.responseText = text;
    this.dispatchEvent(new Event('load'));
    this.dispatchEvent(new Event('loadend'));
  }
}

type View = Window & typeof globalThis;
const win: View = window;
const saved = { XMLHttpRequest: window.XMLHttpRequest, fetch: Reflect.get(window, 'fetch'), proto: { ...Object.getOwnPropertyDescriptors(ScriptedXhr.prototype) } };
/** A method as it stands on an object, unbound (what a hook keeps and what a test compares). */
const m = (object: object, name: string): unknown => Reflect.get(object, name);
const mapProto = { set: Reflect.get(Map.prototype, 'set') as unknown, delete: Reflect.get(Map.prototype, 'delete') as unknown };

let posted: NetworkEventPayload[] = [];
let toasts: unknown[] = [];
const post = (name: string, payload: unknown): void => {
  if (name === BRIDGE_EVENTS.network) posted.push(payload as NetworkEventPayload);
  else if (name === BRIDGE_EVENTS.toast) toasts.push(payload);
};
const hook = (legacy = false, instance = 1): HookInstance | null => installNetworkHook(win, { apiOrigin: API, legacy, instance, post });

/** What the fetch the hook replaces was called with. */
let fetched: Request[] = [];
const scriptedFetch = (input: RequestInfo | URL): Promise<Response> => {
  fetched.push(input as Request);
  return Promise.resolve(new Response('{"success":true,"response":{"ok":1}}', { status: 200 }));
};

/** Our tap's shape (А11): a constructor Proxy that returns the native instance and only listens. */
function ourProxy(): { readonly started: XMLHttpRequest[] } {
  const started: XMLHttpRequest[] = [];
  const Native = win.XMLHttpRequest;
  win.XMLHttpRequest = new Proxy(Native, {
    construct(target, args, newTarget) {
      const xhr = Reflect.construct(target, args, newTarget) as XMLHttpRequest;
      xhr.addEventListener('loadstart', () => started.push(xhr));
      return xhr;
    },
  });
  return { started };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

beforeEach(() => {
  posted = [];
  toasts = [];
  fetched = [];
  ScriptedXhr.sent = [];
  history.replaceState(null, '', '/messages/111');
  win.XMLHttpRequest = ScriptedXhr as unknown as typeof XMLHttpRequest;
  win.fetch = scriptedFetch;
});

afterEach(() => {
  for (const [name, descriptor] of Object.entries(saved.proto)) Object.defineProperty(ScriptedXhr.prototype, name, descriptor);
  Reflect.set(Map.prototype, 'set', mapProto.set);
  Reflect.set(Map.prototype, 'delete', mapProto.delete);
  win.XMLHttpRequest = saved.XMLHttpRequest;
  Reflect.set(win, 'fetch', saved.fetch);
  for (const key of Object.values(FBUDDY_KEYS)) Reflect.deleteProperty(win, key);
  document.getElementById(FBUDDY_IDS.wordsData)?.remove();
  document.body.replaceChildren();
});

function request(method: string, url: string, body: string | null = null, headers: Record<string, string> = {}): XMLHttpRequest & ScriptedXhr {
  const xhr = new win.XMLHttpRequest() as XMLHttpRequest & ScriptedXhr;
  xhr.open(method, url);
  for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
  xhr.send(body);
  return xhr;
}

describe('the neighbour: the network hook', () => {
  it('patches the prototype it reads through the constructor standing at injection (our Proxy) — never the constructor', () => {
    const ours = ourProxy();
    const constructor = win.XMLHttpRequest;
    hook();
    expect(win.XMLHttpRequest).toBe(constructor);
    expect(m(ScriptedXhr.prototype, 'open')).not.toBe(saved.proto['open']?.value);
    expect(Reflect.get(win, FBUDDY_KEYS.hook)).toBe(true);
    const xhr = request('GET', `${API}/api/v1/account/me?ngsw-bypass=true`, null, { 'fansly-client-id': 'c1', 'fansly-session-id': 's1', authorization: 't', 'fansly-client-check': 'k', 'fansly-client-ts': '1' });
    xhr.respond(200, '{"success":true}');
    // Both of us saw it: our instance listener (loadstart) and its prototype hooks.
    expect(ours.started).toEqual([xhr]);
    expect(Reflect.get(xhr, FBUDDY_XHR.requestInfo)).toMatchObject({ method: 'GET', url: `${API}/api/v1/account/me?ngsw-bypass=true` });
    expect(posted).toEqual([
      {
        instance: 1,
        kind: 'xhr',
        method: 'GET',
        url: `${API}/api/v1/account/me?ngsw-bypass=true`,
        status: 200,
        outcome: 'load',
        // The four client headers, never `authorization`.
        headers: { 'fansly-client-id': 'c1', 'fansly-session-id': 's1', 'fansly-client-check': 'k', 'fansly-client-ts': '1' },
        requestBody: null,
        responseText: '{"success":true}',
      },
    ]);
  });

  it('keeps out what is not a Fansly API address; keeps the body of POST /message only; no text for a non-text response', () => {
    hook();
    const page = request('GET', `${PAGE}/assets/index.js`);
    page.respond(200, 'code');
    expect(Reflect.get(page, FBUDDY_XHR.requestInfo)).toBeUndefined();
    request('POST', `${API}/api/v1/message?ngsw-bypass=true`, '{"content":"hi","groupId":"1"}').respond(200, '{"success":true}');
    request('POST', `${API}/api/v1/message/ack?ngsw-bypass=true`, '{"messageIds":["1"],"type":2}').respond(200, '{"success":true}');
    const json = new win.XMLHttpRequest() as XMLHttpRequest & ScriptedXhr;
    json.open('GET', `${API}/api/v1/message/unread`);
    json.responseType = 'json';
    json.send();
    json.respond(200, '{}');
    expect(posted.map((event) => [event.url.replace(API, ''), event.requestBody, event.responseText])).toEqual([
      ['/api/v1/message?ngsw-bypass=true', '{"content":"hi","groupId":"1"}', '{"success":true}'],
      ['/api/v1/message/ack?ngsw-bypass=true', null, '{"success":true}'],
      ['/api/v1/message/unread', null, null],
    ]);
  });

  it('adds its listeners at SEND time: an XHR that never reaches send is never reported', () => {
    hook();
    const opened = new win.XMLHttpRequest() as XMLHttpRequest & ScriptedXhr;
    opened.open('GET', `${API}/api/v1/account/me`);
    opened.respond(200, '{}');
    expect(posted).toEqual([]);
    opened.send();
    opened.respond(200, '{}');
    expect(posted).toHaveLength(1);
  });

  it('replaces fetch with a wrapper that always builds a new Request; an API answer is posted whole', async () => {
    hook();
    const response = await win.fetch(`${API}/api/v1/message?ngsw-bypass=true`, { method: 'POST', body: '{"content":"x"}', headers: { 'fansly-client-id': 'c2' } });
    expect(response.status).toBe(200);
    await win.fetch(`${PAGE}/__stand/fansly`, { method: 'POST', body: '{}' });
    await flush();
    expect(fetched.every((input) => input instanceof Request)).toBe(true);
    expect(fetched.map((input) => input.url)).toEqual([`${API}/api/v1/message?ngsw-bypass=true`, `${PAGE}/__stand/fansly`]);
    expect(posted).toEqual([
      expect.objectContaining({ kind: 'fetch', method: 'POST', status: 200, requestBody: '{"content":"x"}', responseText: '{"success":true,"response":{"ok":1}}', headers: { 'fansly-client-id': 'c2' } }),
    ]);
  });

  it('rewrites a media address of the cdn hosts with ngsw-bypass=true; the stand has none', () => {
    expect(rewriteMediaUrl('https://cdn3.fansly.com/a.jpg?x=1', PAGE)).toBe('https://cdn3.fansly.com/a.jpg?x=1&ngsw-bypass=true');
    expect(rewriteMediaUrl(`${API}/api/v1/account/me`, PAGE)).toBe(`${API}/api/v1/account/me`);
    expect(isApiAddress('/api/v1/x', PAGE, API)).toBe(false);
    expect(isApiAddress(`${API}/api/v1/x`, PAGE, API)).toBe(true);
    expect(isApiAddress(`${API}/api/v1/x`, PAGE, null)).toBe(false);
  });

  it('a re-injection disposes the instance before it: one report per request, from the new instance', () => {
    hook(false, 1);
    const second = hook(false, 2);
    request('GET', `${API}/api/v1/account/me`).respond(200, '{}');
    expect(posted.map((event) => event.instance)).toEqual([2]);
    expect(Reflect.get(win, FBUDDY_KEYS.hookInstance)).toBe(second);
  });

  it('dispose restores the natives when its methods are on top; under somebody else it stays as a pass-through', () => {
    const native = { open: m(ScriptedXhr.prototype, 'open'), send: m(ScriptedXhr.prototype, 'send') };
    hook()?.dispose();
    expect(m(ScriptedXhr.prototype, 'open')).toBe(native.open);
    expect(m(ScriptedXhr.prototype, 'send')).toBe(native.send);
    expect(m(win, 'fetch')).toBe(scriptedFetch);
    expect(Reflect.get(win, FBUDDY_KEYS.hook)).toBe(false);

    const first = hook(false, 3);
    // Somebody wraps `send` after it.
    const under = m(ScriptedXhr.prototype, 'send') as (this: ScriptedXhr, body?: unknown) => void;
    let outer = 0;
    const wrapped = function (this: ScriptedXhr, body?: unknown): void {
      outer += 1;
      under.call(this, body);
    };
    Reflect.set(ScriptedXhr.prototype, 'send', wrapped);
    first?.dispose();
    expect(m(ScriptedXhr.prototype, 'send')).toBe(wrapped);
    expect(m(ScriptedXhr.prototype, 'open')).toBe(native.open);
    const xhr = request('GET', `${API}/api/v1/account/me`);
    xhr.respond(200, '{}');
    expect(outer).toBe(1);
    expect(xhr.nativeSends).toBe(1);
    expect(posted).toEqual([]);
  });
});

describe('the neighbour: the July build (legacy)', () => {
  it('hooks every XHR and fetch with every body; a second injection is a no-op; it never leaves', async () => {
    const first = installNetworkHook(win, { apiOrigin: API, legacy: true, instance: 1, post });
    expect(installNetworkHook(win, { apiOrigin: API, legacy: true, instance: 2, post })).toBeNull();
    request('POST', `${PAGE}/__stand/whatever`, 'a body').respond(200, 'page text');
    await win.fetch(`${PAGE}/assets/x.json`);
    await flush();
    expect(posted.map((event) => [event.kind, event.url, event.requestBody, event.responseText, event.instance])).toEqual([
      ['xhr', `${PAGE}/__stand/whatever`, 'a body', 'page text', 1],
      ['fetch', `${PAGE}/assets/x.json`, null, '{"success":true,"response":{"ok":1}}', 1],
    ]);
    const patched = m(ScriptedXhr.prototype, 'open');
    first?.dispose();
    expect(m(ScriptedXhr.prototype, 'open')).toBe(patched);
    expect(Reflect.get(win, FBUDDY_KEYS.hook)).toBe(true);
  });
});

describe('the neighbour: the restricted-words guard (+guard)', () => {
  const words = (list: string[]): void => {
    const data = document.createElement('script');
    data.id = FBUDDY_IDS.wordsData;
    data.type = 'application/json';
    data.textContent = JSON.stringify(list);
    document.documentElement.append(data);
  };
  const field = (): HTMLTextAreaElement => {
    const textarea = document.createElement('textarea');
    textarea.className = 'message-input';
    document.body.append(textarea);
    return textarea;
  };

  it('checks POSTs by a PREFIX of …/api/v1/message, case-insensitive; whole words of the body’s content', () => {
    const pattern = guardPattern(API);
    expect(pattern.test(`${API}/api/v1/message?ngsw-bypass=true`)).toBe(true);
    expect(pattern.test(`${API}/api/v1/message/ack`)).toBe(true);
    expect(pattern.test(`${API}/api/v1/messages?ids=1`)).toBe(true);
    expect(pattern.test(`${API.toUpperCase()}/API/V1/MESSAGE`)).toBe(true);
    expect(pattern.test(`${API}/api/v1/group/1`)).toBe(false);
    expect(contentOf('{"content":"say Forbidden now","groupId":"1"}')).toBe('say Forbidden now');
    expect(contentOf('not json forbidden')).toBe('not json forbidden');
    expect(matchWord('say Forbidden now', ['forbidden'])).toBe('forbidden');
    expect(matchWord('forbiddenness', ['forbidden'])).toBeNull();
    expect(matchWord('a «forbidden»!', ['forbidden'])).toBe('forbidden');
  });

  it('SWALLOWS a matching send: no native send, no loadstart, no event at all; a toast; the text back in the field on the next frame', async () => {
    words(['forbidden']);
    const ours = ourProxy();
    hook();
    installGuard(win, { apiOrigin: API, post });
    const textarea = field();
    textarea.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    const events: string[] = [];
    const inputs: Event[] = [];
    textarea.addEventListener('input', (event) => inputs.push(event));
    textarea.addEventListener('change', (event) => inputs.push(event));
    const xhr = new win.XMLHttpRequest() as XMLHttpRequest & ScriptedXhr;
    for (const type of ['loadstart', 'load', 'error', 'abort', 'timeout', 'loadend']) xhr.addEventListener(type, () => events.push(type));
    xhr.open('POST', `${API}/api/v1/message?ngsw-bypass=true`);
    xhr.send(JSON.stringify({ content: 'this is Forbidden here', groupId: '111' }));
    expect(xhr.nativeSends).toBe(0);
    expect(events).toEqual([]);
    expect(ours.started).toEqual([]);
    expect(posted).toEqual([]);
    expect(toasts).toEqual([{ text: GUARD_TOAST }]);
    expect(textarea.value).toBe('');
    await frame();
    expect(textarea.value).toBe('this is Forbidden here');
    // Untrusted (happy-dom leaves `isTrusted` unset for script events; Firefox's e2e reads it false).
    expect(inputs.map((event) => [event.type, event.isTrusted === true, event.bubbles])).toEqual([
      ['input', false, true],
      ['change', false, true],
    ]);
    expect(document.activeElement).toBe(textarea);
    expect(Reflect.get(win, FBUDDY_KEYS.guardInstance)).toMatchObject({ swallowed: 1, restored: 1 });
  });

  it('lets a clean message, a GET and an address outside its prefix through', () => {
    words(['forbidden']);
    installGuard(win, { apiOrigin: API, post });
    expect(request('POST', `${API}/api/v1/message`, '{"content":"all good"}').nativeSends).toBe(1);
    expect(request('GET', `${API}/api/v1/message?groupId=1`).nativeSends).toBe(1);
    expect(request('POST', `${API}/api/v1/group`, '{"content":"forbidden"}').nativeSends).toBe(1);
    expect(toasts).toEqual([]);
  });

  it('without words (no organization data) it blocks nothing', () => {
    installGuard(win, { apiOrigin: API, post });
    expect(request('POST', `${API}/api/v1/message`, '{"content":"forbidden"}').nativeSends).toBe(1);
  });

  it('writes the text back into the FIRST composer when none was tracked', async () => {
    words(['forbidden']);
    installGuard(win, { apiOrigin: API, post });
    const first = field();
    const second = field();
    request('POST', `${API}/api/v1/message`, '{"content":"forbidden"}');
    await frame();
    expect([first.value, second.value]).toEqual(['forbidden', '']);
  });
});

describe('what our tap must never do (architecture.md А11)', () => {
  it('own copies of open/send on an instance, captured at install, bypass the guard: the send leaves', () => {
    document.body.replaceChildren();
    const data = document.createElement('script');
    data.id = FBUDDY_IDS.wordsData;
    data.textContent = '["forbidden"]';
    document.documentElement.append(data);
    // A tap that captured the natives and puts copies on every instance…
    const nativeOpen = m(ScriptedXhr.prototype, 'open') as ScriptedXhr['open'];
    const nativeSend = m(ScriptedXhr.prototype, 'send') as ScriptedXhr['send'];
    const Native = win.XMLHttpRequest;
    win.XMLHttpRequest = new Proxy(Native, {
      construct(target, args, newTarget) {
        const xhr = Reflect.construct(target, args, newTarget) as ScriptedXhr;
        Object.defineProperty(xhr, 'open', { value: (...rest: [string, string]) => nativeOpen.apply(xhr, rest) });
        Object.defineProperty(xhr, 'send', { value: (body?: unknown) => nativeSend.call(xhr, body) });
        return xhr;
      },
    });
    installGuard(win, { apiOrigin: API, post });
    // …makes FBuddy's guard blind: the message it must stop goes out.
    expect(request('POST', `${API}/api/v1/message`, '{"content":"forbidden"}').nativeSends).toBe(1);
    expect(toasts).toEqual([]);
  });
});

describe('the neighbour: the MAIN Map.prototype patch', () => {
  it('wraps Map.prototype until an LView-like entry, then restores it and keeps its own set/delete on that Map', () => {
    const nativeSet = m(Map.prototype, 'set');
    const state = installMapPatch(win);
    expect(m(Map.prototype, 'set')).not.toBe(nativeSet);
    const other = new Map<unknown, unknown>([['a', 1]]);
    other.set(5, [5]);
    expect(state.found).toBe(false);
    const registry = new Map<number, unknown[]>();
    const view: unknown[] = new Array<unknown>(LVIEW_ID_SLOT + 1).fill(null);
    view[LVIEW_ID_SLOT] = 7;
    registry.set(7, view);
    expect(state).toMatchObject({ found: true, restored: true });
    expect(state.registry).toBe(registry);
    expect(m(Map.prototype, 'set')).toBe(nativeSet);
    expect(Object.prototype.hasOwnProperty.call(registry, 'set')).toBe(true);
    const next: unknown[] = new Array<unknown>(LVIEW_ID_SLOT + 1).fill(null);
    next[LVIEW_ID_SLOT] = 8;
    registry.set(8, next);
    registry.delete(7);
    expect([...state.views.keys()]).toEqual([8]);
    expect([...registry.keys()]).toEqual([8]);
    expect(Reflect.get(win, FBUDDY_KEYS.goalsRefresh)).toBe(state);
  });
});

describe('the generic third party (not FBuddy)', () => {
  it('a constructor Proxy or a subclass over XMLHttpRequest and WebSocket: native instances, counted', () => {
    const NativeSocket = class extends EventTarget {
      constructor(readonly url: string) {
        super();
      }
    };
    const savedSocket = win.WebSocket;
    for (const kind of ['proxy', 'subclass'] as const) {
      win.XMLHttpRequest = ScriptedXhr as unknown as typeof XMLHttpRequest;
      win.WebSocket = NativeSocket as unknown as typeof WebSocket;
      const counts = installGeneric(win, kind);
      expect(win.XMLHttpRequest).not.toBe(ScriptedXhr);
      const xhr = new win.XMLHttpRequest();
      const socket = new win.WebSocket('ws://localhost:1');
      expect(xhr).toBeInstanceOf(ScriptedXhr);
      expect(socket).toBeInstanceOf(NativeSocket);
      expect(counts).toEqual({ xhr: 1, sockets: 1 });
      // FBuddy's hook, reading `.prototype` through it, lands on the native prototype (a Proxy) or in front of it (a subclass).
      const proto: unknown = win.XMLHttpRequest.prototype;
      expect(kind === 'proxy' ? proto === ScriptedXhr.prototype : Object.getPrototypeOf(proto) === ScriptedXhr.prototype).toBe(true);
    }
    win.WebSocket = savedSocket;
  });
});
