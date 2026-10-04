// The two doors of the tab's application (tab/client.ts): the AppClient the
// surfaces and the keys use, and the background's client as the controllers
// see it — with `token.issue` behind the gate.

import type { ActionReceipt, UiAction } from '@cg/contracts/vm';
import { createAppRouter } from '@cg/core/application';
import type { TabRpcClient } from '@cg/platform';
import { describe, expect, it } from 'vitest';

import type { TokenAnswer } from './action-gate';
import { adopt, controllerRpc, createTabClient, type LooseController } from './client';

const errorOf = (code: string) => ({ code, title: code, body: code }) as never;
const done = (type: UiAction['type']): ActionReceipt => ({ ok: true, type, outcome: 'done' });

function controller(kinds: readonly string[], takes: UiAction['type'], log: string[]): LooseController {
  return {
    kinds,
    getSnapshot: () => ({ of: kinds[0] }),
    subscribe: () => () => undefined,
    dispatch(action) {
      if (action.type !== takes) return null;
      log.push(`dispatch:${action.type}`);
      return Promise.resolve(done(action.type));
    },
  };
}

describe('the controllers of the packages as the router takes them', () => {
  it('a controller with the loose type of its package is plugged in as it is: its views are served, its actions taken', async () => {
    const log: string[] = [];
    const router = createAppRouter({ errorOf });
    router.register(adopt(controller(['dock'], 'ReloadTab', log)));
    expect(router.serves('dock')).toBe(true);
    expect(router.getSnapshot({ of: 'dock' })).toEqual({ of: 'dock' });
    expect(await router.dispatch({ type: 'ReloadTab' })).toEqual(done('ReloadTab'));
    expect(log).toEqual(['dispatch:ReloadTab']);
  });

  it('a view name the contracts do not know is a wiring error, said at the plug — never at a click', () => {
    expect(() => adopt(controller(['dock', 'dok'], 'ReloadTab', []))).toThrow(/unknown views: dok/);
  });

  it('the composition may answer for a controller: its own dispatch replaces the controller’s', async () => {
    const log: string[] = [];
    const router = createAppRouter({ errorOf });
    router.register(adopt(controller(['dock'], 'ReloadTab', log), (action) => (action.type === 'SignOut' ? Promise.resolve(done(action.type)) : null)));
    expect(await router.dispatch({ type: 'SignOut' })).toEqual(done('SignOut'));
    expect((await router.dispatch({ type: 'ReloadTab' })).ok).toBe(false);
    expect(log).toEqual([]);
  });
});

describe('the AppClient of the tab', () => {
  function client(before: (action: UiAction) => Promise<unknown> | null) {
    const log: string[] = [];
    const router = createAppRouter({ errorOf });
    router.register(adopt(controller(['dock'], 'InsertPart', log)));
    const made = createTabClient({ router, tokens: { granted: (action) => void log.push(`granted:${action}`) }, before, onAction: (action) => void log.push(`action:${action.type}`) });
    return { log, router, client: made };
  }
  const insert: UiAction = { type: 'InsertPart', operationId: '00000000-0000-4000-8000-000000000001', part: 0 };

  it('[BG-001] an action opens its grant in the very step it was dispatched in — before the router, before anything is awaited', async () => {
    const c = client(() => null);
    const receipt = c.client.dispatch(insert);
    // Synchronously: the click is still in flight here.
    expect(c.log).toEqual(['granted:InsertPart', 'action:InsertPart', 'dispatch:InsertPart']);
    expect(await receipt).toEqual(done('InsertPart'));
  });

  it('an action whose controllers are still loading waits for them; the grant was opened at the click all the same', async () => {
    let arrive: () => void = () => undefined;
    const loading = new Promise<void>((resolve) => {
      arrive = resolve;
    });
    const c = client(() => loading);
    const receipt = c.client.dispatch(insert);
    expect(c.log).toEqual(['granted:InsertPart', 'action:InsertPart']);
    arrive();
    expect(await receipt).toEqual(done('InsertPart'));
    expect(c.log).toEqual(['granted:InsertPart', 'action:InsertPart', 'dispatch:InsertPart']);
  });

  it('controllers that did not load do not turn a click into a rejected promise: the router answers', async () => {
    const c = client(() => Promise.reject(new Error('chunk')));
    expect(await c.client.dispatch(insert)).toEqual(done('InsertPart'));
    expect((await c.client.dispatch({ type: 'SignOut' })).ok).toBe(false);
  });

  it('views are the router’s', () => {
    const c = client(() => null);
    expect(c.client.getSnapshot({ of: 'dock' })).toEqual({ of: 'dock' });
    expect(() => c.client.getSnapshot({ of: 'coach' })).toThrow();
  });
});

describe('the background’s client of the controllers', () => {
  function rpc() {
    const sent: [string, unknown][] = [];
    const real = {
      request(type: string, payload: unknown) {
        sent.push([type, payload]);
        return Promise.resolve({ ok: true, payload: { recorded: true } });
      },
      onEvent: () => () => undefined,
      onState: () => () => undefined,
      state: () => 'ready',
      tabSessionId: () => 'tab-1',
    } as unknown as TabRpcClient;
    return { sent, real };
  }

  it('[BG-001] `token.issue` never reaches the background by itself: the gate decides, and a refusal is an answer with a code', async () => {
    const { sent, real } = rpc();
    const asked: string[] = [];
    let answer: TokenAnswer = { ok: false, error: null };
    const gated = controllerRpc(real, {
      ask(kind, surface) {
        asked.push(`${kind}:${surface}`);
        return Promise.resolve(answer);
      },
    });
    expect(await gated.request('token.issue', { kind: 'insert', surface: 'dock' })).toEqual({ ok: false, error: { code: 'CG-UI-FAILED', detail: 'no action token' } });
    answer = { ok: true, actionToken: 'tok_0123456789abcdef0123' };
    expect(await gated.request('token.issue', { kind: 'send', surface: 'preview' })).toMatchObject({ ok: true, payload: { actionToken: 'tok_0123456789abcdef0123' } });
    expect(asked).toEqual(['insert:dock', 'send:preview']);
    expect(sent).toEqual([]);
  });

  it('a refusal of the background itself reaches the controller with the background’s code: an expired bootstrap is not «Сбой интерфейса»', async () => {
    const { real } = rpc();
    const gated = controllerRpc(real, { ask: () => Promise.resolve({ ok: false, error: { code: 'CG-FEATURE-DISABLED', detail: 'bootstrap_expired' } }) });
    expect(await gated.request('token.issue', { kind: 'insert', surface: 'dock' })).toEqual({ ok: false, error: { code: 'CG-FEATURE-DISABLED', detail: 'bootstrap_expired' } });
  });

  it('every other request goes to the background as it is; `observe` hears its type and what was sent', async () => {
    const { sent, real } = rpc();
    const seen: string[] = [];
    const gated = controllerRpc(real, { ask: () => Promise.resolve({ ok: false, error: null }) }, (type) => void seen.push(type));
    expect(await gated.request('session.get', {})).toEqual({ ok: true, payload: { recorded: true } });
    await gated.request('token.issue', { kind: 'generate', surface: 'dock' });
    expect(sent).toEqual([['session.get', {}]]);
    expect(seen).toEqual(['session.get']);
    expect(gated.state()).toBe('ready');
    expect(gated.tabSessionId()).toBe('tab-1');
  });
});
