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
import { parseFanHandle } from '@cg/core/application/boards';
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
  /**
   * The chatter's log (2026-10-21): the action in the step of its click or key — what the gate still sees of it —
   * and where its answer goes (null — it threw).
   */
  readonly onPressed?: (action: UiAction) => (receipt: ActionReceipt | null) => void;
}

export function createTabClient(deps: TabClientDeps): AppClient {
  const { router } = deps;
  return {
    getSnapshot: (selector) => router.getSnapshot(selector),
    subscribe: (selector, listener) => router.subscribe(selector, listener),
    dispatch(action) {
      // Synchronously, while the click or the key is still in flight. A Fix may write its result when it is done (X68).
      deps.tokens.granted(action.type, action.type === 'Generate' && action.feature === 'fix', movesOnlinePass(action));
      const answered = deps.onPressed?.(action);
      deps.onAction?.(action);
      const waiting = deps.before(action);
      const answer = waiting === null ? router.dispatch(action) : waiting.then(() => router.dispatch(action), () => router.dispatch(action));
      if (answered !== undefined) void answer.then(answered, () => answered(null)).catch(() => undefined);
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
 *   A refusal of an attempt that did begin is the part's own row.
 * - «Открыть чат» of a fan of a board — the row's Enter, O, a double click, the preview's button — refused: the
 *   board's switch is off on the page, the chat was not found, the site's router said no. Before this the click
 *   waited and nothing happened (the old Fansly board said «not found» on the row; the row says it too now).
 *   A click that a newer one replaced, or a board whose identity changed under it (CG-CONTEXT-CHANGED), says nothing.
 * «Открыть и вставить» into a chat whose field holds the person's own text is not said here any more: the
 * question stands in that chat's dock (§6.5 п. 4), and the composition says a toast only when the dock could
 * not take it (`handoverToast`).
 */
export function boardReceiptToast(action: UiAction, receipt: ActionReceipt): { readonly code: CgCode; readonly scope: string; readonly title: I18nKey | null } | null {
  if ((action.type === 'SendPart' || action.type === 'SendDraft') && !receipt.ok) return { code: receipt.code, scope: 'board.send', title: null };
  if (action.type === 'Navigate' && action.to.kind === 'chat' && !receipt.ok && receipt.code !== 'CG-CONTEXT-CHANGED' && parseFanHandle(action.to.targetHandle) !== null) return { code: receipt.code, scope: 'board.open', title: null };
  return null;
}

/**
 * «Открыть и вставить» opened the chat and the dock of that chat was to go on with the result (§6.5). What is
 * left to say when it did not take it: a chat whose field holds the person's own text got nothing written and
 * has no question on screen — the person is told why, in the words of the question. A part that was inserted
 * needs no word: it is in the field.
 *
 * `inThatChat` — the chat the result was made for is the one on screen now. «В поле ввода уже есть ваш текст» is
 * about THAT chat's field: a person who has gone on to another chat meanwhile (the dock waits a few seconds for
 * the field before it gives up) is not told it there — it would read as a word about the chat in front of them.
 */
export function handoverToast(outcome: 'inserted' | 'needs-confirm', taken: boolean, inThatChat: boolean): { readonly code: CgCode; readonly scope: string; readonly title: I18nKey } | null {
  return outcome === 'needs-confirm' && !taken && inThatChat ? { code: 'CG-DRAFT-CHANGED', scope: 'board.insert', title: 'confirm.humanDraft' } : null;
}

/** Whether the chat on screen (the host's route) is this one. */
export function chatOnScreen(route: { readonly chat: { readonly hostAccountId: string; readonly platformFanId: string } | null }, chat: { readonly hostAccountId: string; readonly platformFanId: string }): boolean {
  return route.chat !== null && route.chat.hostAccountId === chat.hostAccountId && route.chat.platformFanId === chat.platformFanId;
}

/**
 * The palette is a launcher («↵ выполнить», ui-design §4.20): what a row ran closes it — a window opened from
 * it must not stand under it, a generation it started is watched in the dock. Its own typing, its own closing
 * and a row that was refused (the person reads why — paletteReceiptToast — and picks another) leave it open. While the palette is
 * open every dispatched action is one of its rows: our keys are not dispatched under a window of ours.
 */
/**
 * «Онлайн»: the actions that move its pass to a fan's card — the card's text and the next one's are written by this
 * click (action-gate.ts, the online grant). Its tab, «Зашли за», «Обновить» and the «Вернуть» buttons move nothing.
 */
export function movesOnlinePass(action: UiAction): boolean {
  if (action.type === 'SelectOnline' || action.type === 'SendOnline') return true;
  if (action.type === 'SkipOnline') return action.skip;
  if (action.type === 'DismissOnline') return action.dismiss;
  return action.type === 'SetOnline' && action.open === true;
}

export function closesPalette(action: UiAction, receipt: ActionReceipt): boolean {
  if (!receipt.ok || action.type === 'Search') return false;
  return !(action.type === 'Navigate' && action.to.kind === 'surface' && action.to.surface === 'palette');
}

/**
 * A row of the palette that was refused. The palette stays open (closesPalette) and has no place of its own to
 * say why (ui-design §4.20), so the reason is a toast with the refusal's code — what the same action gets from a
 * key (the hotkey runner). Before this a click on a fan's row on a page whose owner left `navigation` off did
 * nothing a person could see (X26). Not said here: a generation (its refusal is the dock's own card), «Онлайн»
 * (the composition says it where it opens the preview) and the palette's own typing.
 */
export function paletteReceiptToast(action: UiAction, receipt: ActionReceipt): { readonly code: CgCode; readonly scope: string; readonly title: I18nKey | null } | null {
  if (receipt.ok || action.type === 'Search' || action.type === 'Generate' || action.type === 'OpenPreview') return null;
  return { code: receipt.code, scope: 'palette.row', title: null };
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
export type ControllerRpc = Pick<TabRpcClient, 'request' | 'onEvent' | 'onState' | 'state' | 'tabSessionId' | 'reconnect'>;

/**
 * `observe` hears what a controller asks (the type and the payload it sent,
 * nothing of the answer): the tab's own measurements ride on it.
 */
export function controllerRpc(rpc: TabRpcClient, tokens: Pick<TabActionTokens, 'ask'>, observe?: (type: string, payload: unknown) => void): ControllerRpc {
  const issue = async (payload: { readonly kind: ActionKind; readonly surface: Parameters<TabActionTokens['ask']>[1]; readonly deferred?: true }): Promise<Answer<{ actionToken: string; expiresAt: number }>> => {
    const answer = await tokens.ask(payload.kind, payload.surface, payload.deferred === true);
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
    reconnect: () => rpc.reconnect(),
  };
}
