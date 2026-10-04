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

import type { CgCode, CgErrorWire, I18nKey } from '@cg/contracts/errors';
import type { SendAttemptView } from '@cg/contracts/send';
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
  /** What the action came to, as its surface was told (the composition says aloud what no surface draws). */
  readonly onReceipt?: (action: UiAction, receipt: ActionReceipt) => void;
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
      const answer = waiting === null ? router.dispatch(action) : waiting.then(() => router.dispatch(action), () => router.dispatch(action));
      if (deps.onReceipt !== undefined) void answer.then((receipt) => deps.onReceipt?.(action, receipt)).catch(() => undefined);
      return answer;
    },
  };
}

/**
 * What a click on a part of a preview or of a «Новые» card came to when its surface has no place to say it —
 * as a toast, or null when the surface says it itself:
 * - «Отправить» refused before any attempt began (the fan is held by a send of another tab, the journal did
 *   not answer, the result belongs to another sign-in): the button only unlocks, so the reason is said here.
 *   A refusal of an attempt that did begin is the part's own row;
 * - «Открыть и вставить» into a chat whose field holds the person's own text: the chat is open, nothing was
 *   written over their words, and the board that could say so has closed. (The Б2 question of §6.5 п. 4 in
 *   that chat's dock is not built yet; the person is told why nothing was inserted.)
 */
export function boardReceiptToast(action: UiAction, receipt: ActionReceipt): { readonly code: CgCode; readonly scope: string; readonly title: I18nKey | null } | null {
  if (action.type === 'SendPart' && !receipt.ok) return { code: receipt.code, scope: 'board.send', title: null };
  if (action.type === 'OpenAndInsertPart' && receipt.ok && receipt.outcome === 'needs-confirm') return { code: 'CG-DRAFT-CHANGED', scope: 'board.insert', title: 'confirm.humanDraft' };
  return null;
}

/**
 * The palette is a launcher («↵ выполнить», ui-design §4.20): what a row ran closes it — a window opened from
 * it must not stand under it, a generation it started is watched in the dock. Its own typing, its own closing
 * and a row that was refused (the person reads why and picks another) leave it open. While the palette is
 * open every dispatched action is one of its rows: our keys are not dispatched under a window of ours.
 */
export function closesPalette(action: UiAction, receipt: ActionReceipt): boolean {
  if (!receipt.ok || action.type === 'Search') return false;
  return !(action.type === 'Navigate' && action.to.kind === 'surface' && action.to.surface === 'palette');
}

/** Holds that pass by themselves, so the part's row keeps nothing of them: the fan or the account is busy with another send. */
const PASSING_HOLDS: readonly CgCode[] = ['CG-SEND-BUSY'];

/**
 * An attempt that «Отправить» began and that was stopped before ChatSpace's queue for a reason the part's row
 * does not keep: the row is «Отправить» again the moment the other send is over (a fan busy with a send of
 * another tab, a queue busy for a moment). The code to say, or null — the row says it itself (a held-stale
 * part, a switch that is off, a refusal) or there is nothing to say.
 */
export function heldSilently(view: Pick<SendAttemptView, 'state' | 'code'> | null): CgCode | null {
  return view !== null && view.state === 'held' && view.code !== undefined && PASSING_HOLDS.includes(view.code) ? view.code : null;
}

type Answer<T> = { readonly ok: true; readonly payload: T } | { readonly ok: false; readonly error: CgErrorWire };

/** The background's client as the controllers see it. */
export type ControllerRpc = Pick<TabRpcClient, 'request' | 'onEvent' | 'onState' | 'state' | 'tabSessionId'>;

/**
 * `observe` hears what a controller asks (the type and the payload it sent,
 * nothing of the answer): the tab's own measurements ride on it.
 */
export function controllerRpc(rpc: TabRpcClient, tokens: Pick<TabActionTokens, 'ask'>, observe?: (type: string, payload: unknown) => void): ControllerRpc {
  const issue = async (payload: { readonly kind: ActionKind; readonly surface: Parameters<TabActionTokens['ask']>[1] }): Promise<Answer<{ actionToken: string; expiresAt: number }>> => {
    const answer = await tokens.ask(payload.kind, payload.surface);
    // No human action behind the request, or the background did not answer: nothing may be written. When the
    // background itself refused (the sign-in is gone, the owner's switch, an expired bootstrap), its reason is the answer.
    if (!answer.ok) return { ok: false, error: answer.error ?? { code: 'CG-UI-FAILED', detail: 'no action token' } };
    // The deadline is the background's to hold; the controllers never read it.
    return { ok: true, payload: { actionToken: answer.actionToken, expiresAt: 0 } };
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
