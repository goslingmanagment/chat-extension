// The two doors of the tab's application (architecture.md §10.2, §14):
//
// - `createTabClient` — the AppClient every surface and the hotkey runner
//   get. It is the router, with one thing done first: the action a person's
//   click or key dispatched opens its grant at the gate, in that same
//   synchronous step (action-gate.ts). An action that needs controllers not
//   loaded yet waits for them — the grant keeps the click.
// - `controllerRpc` — the tab ↔ background client every controller gets. It
//   is the real client, except for `token.issue`: a controller never asks the
//   background for an action token by itself — the gate decides whether a
//   human action stands behind the request, and only then the background is
//   asked. So there is one way to a token in the whole tab.
// - `adopt` — a controller of a package as the router takes it. R11, R12 and
//   R17 each declare a structural controller type of their own, looser than
//   the router's; their shapes at run time are the router's.

import type { CgErrorWire } from '@cg/contracts/errors';
import { VIEW_NAMES, type ActionReceipt, type AppClient, type UiAction, type ViewName } from '@cg/contracts/vm';
import type { AppRouter, SurfaceController } from '@cg/core/application';
import type { TabRpcClient } from '@cg/platform';

import type { ActionKind, TabActionTokens } from './action-gate';

/** A controller as the packages declare it: view names as strings, snapshots untyped. */
export interface LooseController {
  readonly kinds: readonly string[];
  getSnapshot(selector: never): unknown;
  subscribe(selector: never, listener: never): () => void;
  dispatch(action: UiAction): Promise<ActionReceipt> | null;
}

/** The controller as the router's own type; a view name the contracts do not know is a wiring error, said at once. */
export function adopt(controller: LooseController, dispatch: (action: UiAction) => Promise<ActionReceipt> | null = (action) => controller.dispatch(action)): SurfaceController {
  const unknown = controller.kinds.filter((kind) => !(VIEW_NAMES as readonly string[]).includes(kind));
  if (unknown.length > 0) throw new Error(`a controller names unknown views: ${unknown.join(', ')}`);
  const typed = controller as unknown as SurfaceController;
  return {
    kinds: controller.kinds as readonly ViewName[],
    getSnapshot: (selector) => typed.getSnapshot(selector),
    subscribe: (selector, listener) => typed.subscribe(selector, listener),
    dispatch,
  };
}

export interface TabClientDeps {
  readonly router: AppRouter;
  readonly tokens: Pick<TabActionTokens, 'granted'>;
  /**
   * What must be loaded before the router is asked: null — nothing. The
   * controllers of a surface come with the action that opens it; until the
   * second stage of the start is in, every action waits for it.
   */
  readonly before: (action: UiAction) => Promise<unknown> | null;
  /** The action as the person sent it, for the metrics that start at a click (facts only: its type). */
  readonly onAction?: (action: UiAction) => void;
}

export function createTabClient(deps: TabClientDeps): AppClient {
  const { router } = deps;
  return {
    getSnapshot: (selector) => router.getSnapshot(selector),
    subscribe: (selector, listener) => router.subscribe(selector, listener),
    dispatch(action) {
      // Synchronously, while the click or the key is still in flight.
      deps.tokens.granted(action.type);
      deps.onAction?.(action);
      const waiting = deps.before(action);
      return waiting === null ? router.dispatch(action) : waiting.then(() => router.dispatch(action), () => router.dispatch(action));
    },
  };
}

type Answer<T> = { readonly ok: true; readonly payload: T } | { readonly ok: false; readonly error: CgErrorWire };

/** The background's client as the controllers see it. */
export type ControllerRpc = Pick<TabRpcClient, 'request' | 'onEvent' | 'onState' | 'state' | 'tabSessionId'>;

/**
 * `observe` hears what a controller asks (the type and the payload it sent,
 * nothing of the answer): the tab's own measurements ride on it.
 */
export function controllerRpc(rpc: TabRpcClient, tokens: Pick<TabActionTokens, 'issue'>, observe?: (type: string, payload: unknown) => void): ControllerRpc {
  const issue = async (payload: { readonly kind: ActionKind; readonly surface: Parameters<TabActionTokens['issue']>[1] }): Promise<Answer<{ actionToken: string; expiresAt: number }>> => {
    const actionToken = await tokens.issue(payload.kind, payload.surface);
    // No human action behind the request, or the background did not answer: nothing may be written.
    if (actionToken === null) return { ok: false, error: { code: 'CG-UI-FAILED', detail: 'no action token' } };
    // The deadline is the background's to hold; the controllers never read it.
    return { ok: true, payload: { actionToken, expiresAt: 0 } };
  };
  const request = ((type: string, payload: unknown, options?: { readonly timeoutMs?: number }) => {
    if (type === 'token.issue') return issue(payload as Parameters<typeof issue>[0]);
    observe?.(type, payload);
    return rpc.request(type as never, payload as never, options);
  }) as TabRpcClient['request'];
  return {
    request,
    onEvent: (type, listener) => rpc.onEvent(type, listener),
    onState: (listener) => rpc.onState(listener),
    state: () => rpc.state(),
    tabSessionId: () => rpc.tabSessionId(),
  };
}
