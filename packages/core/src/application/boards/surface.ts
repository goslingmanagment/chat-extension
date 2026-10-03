// A surface controller as the tab's AppClient router plugs it in
// (architecture.md §10.2): the views it owns, snapshots, subscriptions and
// the actions it takes. `dispatch` answers null for an action that is not
// this controller's, so the router can offer it to the next one.

import { type ActionReceipt, type ReceiptOutcome, type UiAction, type UiActionType, type ViewMap, type ViewName, type ViewSelector } from '@cg/contracts/vm';
import { type CgErrorView } from '@cg/contracts/errors';

export type SelectorOf<N extends ViewName> = Extract<ViewSelector, { readonly of: N }>;

export interface SurfaceController<N extends ViewName = ViewName> {
  /** The view names this controller answers. */
  readonly kinds: readonly N[];
  getSnapshot(selector: SelectorOf<N>): ViewMap[N];
  subscribe(selector: SelectorOf<N>, listener: (view: ViewMap[N]) => void): () => void;
  /** null — not this controller's action. */
  dispatch(action: UiAction): Promise<ActionReceipt> | null;
  /** Drops timers and subscriptions. */
  dispose(): void;
}

/** A value built on demand and rebuilt after `invalidate()`; listeners get the new value. */
export class ViewCell<T> {
  private value: T | undefined;
  private built = false;
  private readonly listeners = new Set<(value: T) => void>();

  constructor(private readonly build: () => T) {}

  get(): T {
    if (!this.built) {
      this.value = this.build();
      this.built = true;
    }
    return this.value as T;
  }

  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The state behind the view changed. */
  invalidate(): void {
    this.built = false;
    this.value = undefined;
    if (this.listeners.size === 0) return;
    const value = this.get();
    for (const listener of [...this.listeners]) listener(value);
  }

  clear(): void {
    this.listeners.clear();
    this.built = false;
    this.value = undefined;
  }
}

export function done(type: UiActionType, outcome: ReceiptOutcome = 'done', extra: { readonly opId?: string; readonly attemptId?: string } = {}): ActionReceipt {
  return { ok: true, type, outcome, ...extra };
}

export function refused(type: UiActionType, error: CgErrorView): ActionReceipt {
  return { ok: false, type, code: error.code, error };
}
