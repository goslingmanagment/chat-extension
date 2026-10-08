// Fault injection into MAIN (decision X22): every callback the page or the
// browser calls is made to fail, and the page must not notice — no `error`
// event, no unhandled rejection, ChatSpace's own call completes (the store is
// created, the action runs, the navigation ends, the editor's later
// listeners hear the transaction) — while the failure goes to the isolated
// side as a `fault` frame, counted by site at 1, 2, 4, 8….
//
// - The boot's own guards (its listeners, the frames and timers it lends, the
//   event channel) are driven with a scripted runtime.
// - The runtime runs on the real boot over the ChatSpace-shaped page
//   (testing/fake-page.ts). Its context's `guard` is wrapped so that an armed
//   site throws inside the callback before its body: a callback handed to the
//   page without the guard would let that throw out to the fake page, which
//   calls its listeners with no try/catch, as Pinia, the router and Tiptap do.
// - ChatSpace's own errors that pass the same places reach ChatSpace as they
//   are: the very same value, and no fault of ours is counted for them.
// The tap script's side is faults-tap.test.ts.

import { BridgeEventSchema } from '@cg/contracts/bridge-messages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeQueue } from '../testing/fake-live';
import { createFakePage, fakeStore, seedCache, type FakeComposer, type FakePage } from '../testing/fake-page';
import { installMainBridge, type MainBridgeHandle, type MainContext, type MainRuntime, type MainRuntimeFactory } from './bridge';
import { createMainRuntime } from './runtime';

const ACC = '1001';
const FAN = '2002';
const OTHER = '2003';

/** The test runner's process (Node): unhandled rejections are reported there; the package carries no Node types. */
const runner = (globalThis as unknown as { process: { on(event: 'unhandledRejection', listener: (reason: unknown) => void): void; off(event: 'unhandledRejection', listener: (reason: unknown) => void): void } }).process;

type Frame = Record<string, unknown> & { kind?: string; t?: string; payload?: Record<string, unknown> };

/** A window for the boot: the page's document and timers; `window.postMessage` with `source` and ports (happy-dom sets neither). */
function pageWindow() {
  const listeners = new Set<(event: unknown) => void>();
  const win = {
    document,
    performance,
    crypto,
    location: { origin: 'http://127.0.0.1:4100' },
    MutationObserver,
    setTimeout: (callback: () => void, ms?: number) => setTimeout(callback, ms),
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
    addEventListener: (type: string, listener: (event: unknown) => void, capture?: boolean) => (type === 'message' ? listeners.add(listener) : window.addEventListener(type, listener, capture)),
    removeEventListener: (type: string, listener: (event: unknown) => void, capture?: boolean) => (type === 'message' ? listeners.delete(listener) : window.removeEventListener(type, listener, capture)),
    postMessage: () => undefined,
  };
  const deliver = (data: unknown, ports: unknown[] = []): void => {
    for (const listener of [...listeners]) listener({ source: win, data, ports });
  };
  return { win: win as unknown as Window, deliver };
}

/** The port MAIN gets: what it posts is kept (structured-cloned, as a real port would); `broken` makes the next post fail. */
function fakePort() {
  const frames: Frame[] = [];
  const port = {
    broken: false,
    onmessage: null as ((event: { data: unknown }) => void) | null,
    postMessage(frame: unknown) {
      if (port.broken) throw new DOMException('the port is gone', 'InvalidStateError');
      frames.push(structuredClone(frame) as Frame);
    },
    close: () => undefined,
  };
  return { port, frames };
}

/** What the page would see of an escape: `error` events on the window, unhandled rejections. */
function watchPage() {
  const errors: unknown[] = [];
  const onError = (event: Event): void => void errors.push((event as ErrorEvent).error ?? event);
  const onRejection = (reason: unknown): void => void errors.push(reason);
  window.addEventListener('error', onError);
  runner.on('unhandledRejection', onRejection);
  return {
    errors,
    stop: () => {
      window.removeEventListener('error', onError);
      runner.off('unhandledRejection', onRejection);
    },
  };
}

const faultsOf = (frames: readonly Frame[]): Array<[unknown, unknown]> => frames.filter((frame) => frame.kind === 'evt' && frame.t === 'fault').map((frame) => [frame.payload?.['source'], frame.payload?.['count']]);
const settle = (ms = 5): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let page: ReturnType<typeof watchPage> | null = null;
const cleanups: Array<() => void> = [];
beforeEach(() => {
  page = watchPage();
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  const seen = page?.errors ?? [];
  page?.stop();
  page = null;
  // Whatever a test did, nothing of ours reached the page.
  expect(seen).toEqual([]);
});

/** The boot with a scripted runtime, connected to a fake port. */
function boot(runtime?: MainRuntimeFactory): { main: MainBridgeHandle; frames: Frame[]; port: ReturnType<typeof fakePort>['port']; deliver: (data: unknown, ports?: unknown[]) => void; context: () => MainContext } {
  const { win, deliver } = pageWindow();
  let context: MainContext | null = null;
  const main = installMainBridge(win, {
    runtime: (ctx) => {
      context = ctx;
      return runtime ? runtime(ctx) : { handle: () => null, dispose: () => undefined };
    },
  });
  cleanups.push(() => main.dispose());
  const { port, frames } = fakePort();
  deliver({ tag: 'connect', v: 1, nonce: 'n1' }, [port]);
  return { main, frames, port, deliver, context: () => context as unknown as MainContext };
}

const request = (id: number, t: string, payload: unknown = {}) => ({ data: { v: 1, kind: 'req', id, t, documentEpoch: null, seq: id, payload } });

describe('[X22] the boot’s own guards: a failure of ours stays in MAIN and goes out as a `fault`', () => {
  it('a timer, a frame and an event builder that throw: each is counted by site, nothing escapes', async () => {
    const { frames, context } = boot();
    const ctx = context();
    ctx.setTimer(() => {
      throw new Error('timer body');
    }, 0);
    ctx.frame(() => {
      throw new Error('frame body');
    });
    ctx.emit('route', () => {
      throw new Error('builder');
    });
    await settle(20);
    expect(faultsOf(frames)).toEqual(expect.arrayContaining([['timer', 1], ['frame', 1], ['emit', 1]]));
    // Every fault frame is what the isolated side accepts.
    for (const frame of frames.filter((item) => item.t === 'fault')) expect(BridgeEventSchema.safeParse(frame).success).toBe(true);
    // The channel still works: the next event of the type is built afresh.
    ctx.emit('route', () => ({ ok: true }));
    await settle(30);
    expect(frames.some((frame) => frame.t === 'route')).toBe(true);
  });

  it('a site that keeps failing reports at 1, 2, 4, 8… — never once per call', async () => {
    const { frames, context } = boot();
    for (let i = 0; i < 9; i += 1) context().guard('route', () => {
      throw new Error('again');
    })();
    await settle();
    expect(faultsOf(frames)).toEqual([['route', 1], ['route', 2], ['route', 4], ['route', 8]]);
  });

  it('a runtime that throws on a request: the answer is `internal`, the failure a `handle` fault', async () => {
    const { frames, port } = boot(() => ({
      handle: () => {
        throw new Error('runtime');
      },
      dispose: () => undefined,
    }));
    port.onmessage?.(request(1, 'listAccounts'));
    await settle();
    expect(frames.find((frame) => frame.kind === 'res')).toMatchObject({ id: 1, ok: false, err: 'internal' });
    expect(faultsOf(frames)).toEqual([['handle', 1]]);
  });

  it('an answer the port cannot carry is dropped and counted (`send`); a port that fails drops its frames, never throws', async () => {
    const { frames, port } = boot(() => ({ handle: () => ({ fn: () => 1 }), dispose: () => undefined }));
    port.onmessage?.(request(1, 'listAccounts'));
    await settle();
    // structuredClone refused the function: no answer went, the failure did.
    expect(frames.filter((frame) => frame.kind === 'res')).toEqual([]);
    expect(faultsOf(frames)).toEqual([['send', 1]]);
    port.broken = true;
    port.onmessage?.(request(2, 'listAccounts'));
    await settle();
    port.broken = false;
    // The report of the second failure (count 2) went to the same broken port and was dropped with it.
    port.onmessage?.(request(3, 'listAccounts'));
    await settle();
    expect(faultsOf(frames)).toEqual([['send', 1], ['send', 4]]);
  });

  it('a message the browser hands over broken: the port listener and the handshake listener keep it', async () => {
    const { frames, port } = boot();
    port.onmessage?.({
      get data(): unknown {
        throw new Error('broken event');
      },
    });
    await settle();
    expect(faultsOf(frames)).toEqual([['port', 1]]);
    // The handshake listener, before any port: a message whose data cannot be read.
    const { win, deliver } = pageWindow();
    const main = installMainBridge(win);
    cleanups.push(() => main.dispose());
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('hostile');
        },
      },
    );
    expect(() => deliver(hostile)).not.toThrow();
    // It still connects afterwards.
    const later = fakePort();
    deliver({ tag: 'connect', v: 1, nonce: 'n2' }, [later.port]);
    expect(main.isConnected()).toBe(true);
  });

  it('a runtime factory that throws leaves the boot without a runtime (not ready), never the page with an error', () => {
    const { win } = pageWindow();
    let main: MainBridgeHandle | null = null;
    expect(() => {
      main = installMainBridge(win, {
        runtime: () => {
          throw new Error('factory');
        },
      });
    }).not.toThrow();
    cleanups.push(() => (main)?.dispose());
    expect((main as MainBridgeHandle | null)?.attach(() => ({ handle: () => null, dispose: () => undefined }))).toBe(true);
  });
});

// ── The runtime over the ChatSpace-shaped page ─────────────────────────────

interface Live {
  readonly page: FakePage;
  readonly frames: Frame[];
  readonly composer: FakeComposer;
  readonly runtime: () => MainRuntime | null;
  /** The sites that throw before their body from now on. */
  readonly armed: Set<string>;
  faults(): Array<[unknown, unknown]>;
}

/** The real boot and runtime over the fake page; `guard` of the context throws at an armed site. `before` runs before the runtime starts. */
async function start(before?: (page: FakePage, win: Window) => void): Promise<Live> {
  const fake = createFakePage(document);
  seedCache(fake.cache);
  const composer = fake.addComposer(ACC, FAN);
  fake.addComposer(ACC, OTHER, { shown: false });
  const { win, deliver } = pageWindow();
  before?.(fake, win);
  const armed = new Set<string>();
  let runtime: MainRuntime | null = null;
  const inject = (context: MainContext): MainContext => ({
    win: context.win,
    get documentEpoch() {
      return context.documentEpoch;
    },
    now: context.now,
    setTimer: context.setTimer,
    frame: context.frame,
    emit: context.emit,
    post: context.post,
    fault: context.fault,
    guard: (site, fn) =>
      context.guard(site, (...args) => {
        if (armed.has(site)) throw new Error(`injected at ${site}`);
        return fn(...args);
      }),
  });
  const main = installMainBridge(win, { runtime: (context) => (runtime = createMainRuntime(inject(context))) });
  cleanups.push(() => main.dispose());
  const { port, frames } = fakePort();
  deliver({ tag: 'connect', v: 1, nonce: 'n1' }, [port]);
  // The app search, the route's settling frame and the first events.
  await settle(30);
  return { page: fake, frames, composer, runtime: () => runtime, armed, faults: () => faultsOf(frames) };
}

describe('[X22] the runtime’s callbacks: ChatSpace’s own work goes on when ours fails', () => {
  it('router.afterEach: the navigation ends, later afterEach guards run, `push` resolves', async () => {
    const h = await start();
    const theirs = vi.fn();
    h.page.router.afterEach(theirs);
    h.armed.add('route');
    expect(() => h.page.go(ACC, OTHER)).not.toThrow();
    await expect(h.page.router.push({ name: 'chat', params: { accountId: ACC, chatId: FAN } })).resolves.toBeUndefined();
    expect(theirs).toHaveBeenCalledTimes(2);
    expect(h.page.router.currentRoute.value.params['chatId']).toBe(FAN);
    await settle();
    expect(h.faults()).toEqual([['route', 1], ['route', 2]]);
  });

  it('the Pinia plugin: the store is created and ChatSpace’s later plugins still see it', async () => {
    const h = await start();
    const theirs = vi.fn();
    h.page.pinia.use(theirs);
    h.armed.add('plugin');
    const later = fakeStore('composerTranslator', { settings: {} });
    expect(() => h.page.addStore(later)).not.toThrow();
    expect(h.page.stores.get('composerTranslator')).toBe(later);
    expect(theirs).toHaveBeenCalledWith({ store: later });
    await settle();
    expect(h.faults()).toEqual([['plugin', 1]]);
  });

  it('the cache’s $onAction and its `after`: the action runs and returns, later subscribers and `after`s run', async () => {
    const h = await start();
    const before = vi.fn();
    const after = vi.fn();
    h.page.cache.store.$onAction(({ after: then }) => {
      before();
      then(after);
    });
    h.armed.add('cache');
    expect(() => h.page.cache.set(['fansMap', ACC], { [FAN]: { id: FAN, name: 'Renamed' } })).not.toThrow();
    h.armed.clear();
    h.armed.add('cacheAfter');
    expect(() => h.page.cache.set(['fansMap', ACC], { [FAN]: { id: FAN, name: 'Again' } })).not.toThrow();
    expect([before.mock.calls.length, after.mock.calls.length]).toEqual([2, 2]);
    expect((h.page.cache.store['getQueryData'] as (key: unknown[]) => unknown)(['fansMap', ACC])).toEqual({ [FAN]: { id: FAN, name: 'Again' } });
    await settle();
    expect(h.faults()).toEqual([['cache', 1], ['cacheAfter', 1]]);
  });

  it('the chat tabs’ $onAction and its `after`: the tab is activated', async () => {
    const h = await start();
    h.armed.add('tabs');
    expect(() => h.page.showOnly(ACC, OTHER)).not.toThrow();
    h.armed.clear();
    h.armed.add('composerSoon');
    expect(() => h.page.showOnly(ACC, FAN)).not.toThrow();
    expect(h.page.tabs[ACC]?.activeEntryId).toBe('tab-1');
    await settle();
    expect(h.faults()).toEqual([['tabs', 1], ['composerSoon', 1]]);
  });

  it('the send queue’s $onAction: a send and a sign-out reset still run; a failing live port does not stop the reset check', async () => {
    let failSent = false;
    const h = await start((fake, win) => {
      // A tap script whose live port fails inside the send action (hand-caught: `sent`).
      Object.defineProperty(win, Symbol.for('wsTap'), {
        configurable: true,
        value: {
          attach: () => ({
            handle: () => 'disabled',
            sent: () => {
              if (failSent) throw new Error('live port');
            },
            sync: () => undefined,
            anchor: () => 'ok',
          }),
        },
      });
      fake.cache.set(['mimicChats'], {});
    });
    const queue = fakeQueue({ fetch: () => new Promise<Response>(() => undefined) });
    h.page.addStore(queue.store);
    failSent = true;
    const entry = queue.send({ accountId: ACC, chatId: OTHER, platform: 'onlyfans', text: '<p>hi</p>', hasAttachments: false, platformMetadata: {} });
    expect(entry?.chatId).toBe(OTHER);
    h.armed.add('queue');
    expect(() => (queue.store['resetAll'] as () => void)()).not.toThrow();
    expect(queue.entries(ACC)).toEqual([]);
    await settle();
    expect(h.faults()).toEqual([['sent', 1], ['queue', 1]]);
  });

  it('the accounts store’s $subscribe (with a tap): ChatSpace’s state change completes', async () => {
    let sync = 0;
    const h = await start((_fake, win) => {
      Object.defineProperty(win, Symbol.for('wsTap'), {
        configurable: true,
        value: { attach: () => ({ handle: () => 'disabled', sent: () => undefined, sync: () => void (sync += 1), anchor: () => 'ok' }) },
      });
    });
    const accounts = fakeStore('accounts', { subscribedAccountIds: new Set([ACC]) });
    h.page.addStore(accounts);
    h.armed.add('accounts');
    expect(() => accounts.$changed()).not.toThrow();
    h.armed.clear();
    accounts.$changed();
    // Once when the store came, once for the change after the failing one.
    expect(sync).toBe(2);
    await settle();
    expect(h.faults()).toEqual([['accounts', 1]]);
  });

  it('the editor: its transaction reaches ChatSpace’s later listeners; its destroy too; typing’s `input` reaches the page', async () => {
    const h = await start();
    const editor = h.composer.editor;
    if (!editor) throw new Error('no editor');
    const theirs = vi.fn();
    editor.on('transaction', theirs);
    editor.on('destroy', theirs);
    h.armed.add('transaction');
    expect(() => editor.type('hello')).not.toThrow();
    h.armed.add('destroy');
    expect(() => editor.emit('destroy')).not.toThrow();
    expect(theirs).toHaveBeenCalledTimes(2);
    const typed = vi.fn();
    document.addEventListener('input', typed, true);
    cleanups.push(() => document.removeEventListener('input', typed, true));
    h.armed.add('input');
    h.composer.prose.dispatchEvent(new Event('input', { bubbles: true }));
    expect(typed).toHaveBeenCalledTimes(1);
    await settle();
    expect(h.faults()).toEqual([['transaction', 1], ['destroy', 1], ['input', 1]]);
  });

  it('the editor watch (a MutationObserver while TipTap loads): the page’s mutation goes on', async () => {
    const h = await start((fake) => {
      fake.composers.replaceChildren();
      fake.all.splice(0);
      for (const tab of Object.values(fake.tabs)) tab.entries.splice(0);
    });
    const late = h.page.addComposer(ACC, FAN, { editor: false });
    // The runtime reads the new composer (a tab change) and watches its frame for the editor.
    h.page.showOnly(ACC, FAN);
    await settle(30);
    h.armed.add('editorWatch');
    late.frame.append(document.createElement('div'));
    await settle();
    expect(late.frame.childElementCount).toBeGreaterThan(1);
    expect(h.faults()).toEqual([['editorWatch', 1]]);
  });

  it('DOMContentLoaded: the document goes on loading', async () => {
    Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'loading' });
    cleanups.push(() => Reflect.deleteProperty(document, 'readyState'));
    const h = await start();
    h.armed.add('ready');
    const theirs = vi.fn();
    document.addEventListener('DOMContentLoaded', theirs);
    cleanups.push(() => document.removeEventListener('DOMContentLoaded', theirs));
    document.dispatchEvent(new Event('DOMContentLoaded'));
    expect(theirs).toHaveBeenCalledTimes(1);
    await settle();
    expect(h.faults()).toEqual([['ready', 1]]);
  });
});

describe('[X22] ChatSpace’s own errors pass our callbacks unchanged, and are not ours to count', () => {
  it('an action that throws: the caller gets the very same error, the `onError`s run; no fault', async () => {
    const h = await start();
    const queue = fakeQueue({ fetch: () => new Promise<Response>(() => undefined) });
    h.page.addStore(queue.store);
    const onError = vi.fn();
    queue.store.$onAction(({ onError: failed }) => failed(onError));
    queue.throwNext();
    let caught: unknown = null;
    try {
      queue.send({ accountId: ACC, chatId: OTHER, platform: 'onlyfans', text: '<p>x</p>', hasAttachments: false, platformMetadata: {} });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('queue failed');
    expect(onError).toHaveBeenCalledTimes(1);
    await settle();
    expect(h.faults()).toEqual([]);
  });

  it('a guard of ChatSpace’s own after ours throws: the navigation fails with that very error', async () => {
    const h = await start();
    const theirs = new Error('their guard');
    h.page.router.afterEach(() => {
      throw theirs;
    });
    let caught: unknown = null;
    try {
      h.page.go(ACC, OTHER);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(theirs);
    await settle();
    expect(h.faults()).toEqual([]);
  });

  it('a listener of ChatSpace’s own on the editor throws: Tiptap’s emit fails with that very error', async () => {
    const h = await start();
    const editor = h.composer.editor;
    if (!editor) throw new Error('no editor');
    const theirs = new Error('their listener');
    editor.on('transaction', () => {
      throw theirs;
    });
    let caught: unknown = null;
    try {
      editor.type('hello');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(theirs);
    await settle();
    expect(h.faults()).toEqual([]);
  });
});
