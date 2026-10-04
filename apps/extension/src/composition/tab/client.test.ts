// The two doors of the tab's application (tab/client.ts): the AppClient the
// surfaces and the keys use, and the background's client as the controllers
// see it — with `token.issue` behind the gate.

import type { ActionReceipt, UiAction } from '@cg/contracts/vm';
import { createAppRouter } from '@cg/core/application';
import type { TabRpcClient } from '@cg/platform';
import { describe, expect, it } from 'vitest';

import type { TokenAnswer } from './action-gate';
import { adopt, boardReceiptToast, closesPalette, controllerRpc, createTabClient, heldSilently, type LooseController } from './client';

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

describe('what a click on a board’s part came to, when the board has no place to say it', () => {
  const refused = (type: UiAction['type'], code: string): ActionReceipt => ({ ok: false, type, code, error: errorOf(code) }) as ActionReceipt;
  const send: UiAction = { type: 'SendPart', operationId: '00000000-0000-4000-8000-000000000001', part: 0 };
  const insert: UiAction = { type: 'OpenAndInsertPart', operationId: '00000000-0000-4000-8000-000000000001', part: 0 };

  it('[X8-03] «Отправить» refused before any attempt began is said with its own code; an attempt that began is the part’s own row', () => {
    expect(boardReceiptToast(send, refused('SendPart', 'CG-SEND-BUSY'))).toEqual({ code: 'CG-SEND-BUSY', scope: 'board.send', title: null });
    expect(boardReceiptToast(send, { ok: true, type: 'SendPart', outcome: 'started' })).toBeNull();
  });

  it('[NEW-01] «Открыть и вставить» into a chat that holds the person’s own text says «В поле ввода уже есть ваш текст»; an insert that was made, canceled or timed out is not said twice', () => {
    expect(boardReceiptToast(insert, { ok: true, type: 'OpenAndInsertPart', outcome: 'needs-confirm' })).toEqual({ code: 'CG-DRAFT-CHANGED', scope: 'board.insert', title: 'confirm.humanDraft' });
    expect(boardReceiptToast(insert, { ok: true, type: 'OpenAndInsertPart', outcome: 'opened' })).toBeNull();
    // The preview's controller says these itself as it closes (its notifier): «Вставка отменена», «Чат открывается слишком долго».
    expect(boardReceiptToast(insert, refused('OpenAndInsertPart', 'CG-INSERT-CANCELED'))).toBeNull();
    expect(boardReceiptToast(insert, refused('OpenAndInsertPart', 'CG-NAV-TIMEOUT'))).toBeNull();
  });

  it('[X8-03] an attempt held before ChatSpace’s queue for a passing reason is said — its row goes back to «Отправить»; what the row keeps is not', () => {
    const view = (state: string, code?: string) => ({ attemptId: '00000000-0000-4000-8000-000000000002', state, ...(code === undefined ? {} : { code }) }) as never;
    // The fan is busy with a send of another tab: the button comes back, the reason would be lost.
    expect(heldSilently(view('held', 'CG-SEND-BUSY'))).toBe('CG-SEND-BUSY');
    // The row itself says these: a fan who wrote («Удержано…»), the owner's switch and the page's lasting conditions, a refusal.
    for (const code of ['CG-SEND-STALE', 'CG-SEND-OFF', 'CG-SEND-FAN', 'CG-SEND-MIMIC', 'CG-SEND-FRESHNESS', 'CG-HUB-RATE-LIMIT', 'CG-TIMEOUT']) expect([code, heldSilently(view('held', code))]).toEqual([code, null]);
    // An attempt that went on, or one nobody knows, has nothing to say here.
    for (const state of ['preparing', 'nativeEnqueued', 'nativeAccepted', 'sentObserved', 'uncertain', 'rejected']) expect(heldSilently(view(state))).toBeNull();
    expect(heldSilently(view('held'))).toBeNull();
    expect(heldSilently(null)).toBeNull();
  });

  it('the dock’s own actions are the dock’s to show', () => {
    expect(boardReceiptToast({ type: 'InsertPart', operationId: send.operationId, part: 0 }, refused('InsertPart', 'CG-INSERT-FAILED'))).toBeNull();
    expect(boardReceiptToast({ type: 'InsertPart', operationId: send.operationId, part: 0 }, { ok: true, type: 'InsertPart', outcome: 'needs-confirm' })).toBeNull();
  });

  it('the client hands every receipt over once the router answered, and the surface still gets its own', async () => {
    const seen: string[] = [];
    const router = createAppRouter({ errorOf });
    router.register(adopt(controller(['dock'], 'InsertPart', [])));
    const made = createTabClient({ router, tokens: { granted: () => undefined }, before: () => null, onReceipt: (action, receipt) => void seen.push(`${action.type}:${receipt.ok ? receipt.outcome : receipt.code}`) });
    expect(await made.dispatch({ type: 'InsertPart', operationId: send.operationId, part: 0 })).toMatchObject({ ok: true, outcome: 'done' });
    expect((await made.dispatch(send)).ok).toBe(false);
    await Promise.resolve();
    expect(seen).toEqual(['InsertPart:done', 'SendPart:CG-UI-FAILED']);
  });
});

describe('the palette is a launcher', () => {
  const ok = (type: UiAction['type']): ActionReceipt => ({ ok: true, type, outcome: 'done' });
  const open = (surface: string, isOpen = true): UiAction => ({ type: 'Navigate', to: { kind: 'surface', surface, open: isOpen } }) as UiAction;

  it('[HK-036] a row that ran closes it: a window it opened, a generation it started, a switch it flipped', () => {
    expect(closesPalette(open('newcomers'), ok('Navigate'))).toBe(true);
    expect(closesPalette(open('cheatsheet'), ok('Navigate'))).toBe(true);
    expect(closesPalette({ type: 'Generate', targetHandle: 'dock:chatspace:1:2', feature: 'reply', options: {} }, { ok: true, type: 'Generate', outcome: 'started' })).toBe(true);
    expect(closesPalette({ type: 'OpenSettings', route: { section: 'status' } }, ok('OpenSettings'))).toBe(true);
  });

  it('typing in it, closing it and a row that was refused leave it as it is', () => {
    expect(closesPalette({ type: 'Search', list: 'palette', query: 'нов' }, ok('Search'))).toBe(false);
    expect(closesPalette(open('palette', false), ok('Navigate'))).toBe(false);
    expect(closesPalette(open('palette'), ok('Navigate'))).toBe(false);
    expect(closesPalette(open('spenders'), { ok: false, type: 'Navigate', code: 'CG-FEATURE-DISABLED', error: errorOf('CG-FEATURE-DISABLED') })).toBe(false);
  });
});
