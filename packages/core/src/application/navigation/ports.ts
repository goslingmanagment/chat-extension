// Ports of the tab-side controllers of R17 (architecture.md §4, §10.2): the
// controllers depend only on these and on the contracts; the tab's
// composition root passes the real things — `@cg/platform`'s tab RPC client,
// R09's HostPort, the I18n port, a clock.

import { type CgErrorWire } from '@cg/contracts/errors';
import { CG_REGISTRY } from '@cg/contracts/errors/registry';
import { type CgCode, type CgErrorView } from '@cg/contracts/errors';
import { type TabEventPayload, type TabEventType, type TabRequestPayload, type TabRequestType, type TabResponsePayload } from '@cg/contracts/tab-messages';
import { type ActionReceipt, type I18n, type UiAction, type UiActionType, type ViewSelector } from '@cg/contracts/vm';

/**
 * A part of the tab's AppClient (`core/application/router.ts` asks every
 * controller in turn). `dispatch` answers null for an action that is not
 * this controller's.
 */
export interface SurfaceController {
  /** The view names this controller serves. */
  readonly kinds: readonly string[];
  getSnapshot(selector: ViewSelector): unknown;
  subscribe(selector: ViewSelector, listener: (view: unknown) => void): () => void;
  dispatch(action: UiAction): Promise<ActionReceipt> | null;
}

export type RpcAnswer<T> = { readonly ok: true; readonly payload: T } | { readonly ok: false; readonly error: CgErrorWire };

/** Requests these controllers make; `@cg/platform` TabRpcClient serves them all. */
export type NavRequestType = Extract<TabRequestType, 'token.issue' | 'op.list' | 'binding.resolve' | 'spenders.board' | 'spenders.queue' | 'newcomers.list'>;

export interface TabRpc {
  request<T extends NavRequestType>(type: T, payload: TabRequestPayload<T>): Promise<RpcAnswer<TabResponsePayload<T>>>;
  onEvent<T extends TabEventType>(type: T, listener: (payload: TabEventPayload<T>) => void): () => void;
}

export interface TabClock {
  now(): number;
  setTimer(ms: number, fn: () => void): unknown;
  clearTimer(handle: unknown): void;
}

export interface IdPort {
  uuid(): string;
}

/** A code as a card in the current language: the registry's title and explanation. */
export function codeView(code: CgCode, i18n: I18n): CgErrorView {
  const entry = CG_REGISTRY[code];
  return { code, title: i18n.t(entry.title), body: i18n.t(entry.body) };
}

/** A failed receipt with the registry's texts in the current language. */
export function failedReceipt(type: UiActionType, code: CgCode, i18n: I18n): ActionReceipt {
  return { ok: false, type, code, error: codeView(code, i18n) };
}

/** A tiny change notifier: views are rebuilt on demand, listeners only learn that something moved. */
export function createEmitter(): { emit(): void; on(listener: () => void): () => void; readonly version: number } {
  const listeners = new Set<() => void>();
  let version = 0;
  return {
    emit() {
      version += 1;
      for (const listener of [...listeners]) listener();
    },
    on(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get version() {
      return version;
    },
  };
}
