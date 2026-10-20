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
});
