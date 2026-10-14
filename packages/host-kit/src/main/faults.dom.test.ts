// Fault injection into the MAIN boot (decision X22): every callback of the
// boot's own that the page or the browser calls is made to fail, and the page
// must not notice — no `error` event, no unhandled rejection — while the
// failure goes to the isolated side as a `fault` frame, counted by site at
// 1, 2, 4, 8….
//
// The boot's own guards (its listeners, the frames and timers it lends, the
// event channel) are driven with a scripted runtime. A site's runtime on the
// real boot, with every callback it hands its page made to fail, is tested
// with the site (host-chatspace/src/main/faults.dom.test.ts).

import { BridgeEventSchema } from '@cg/contracts/bridge-messages';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installMainBridge, type MainBridgeHandle, type MainContext, type MainRuntimeFactory } from './bridge';

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
