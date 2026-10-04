// The AppClient of a tab or an extension page as a router (architecture.md
// §10.2 п. 2): the UI's one door to data is a table «view name → surface
// controller». Each controller serves the view models of its own surface and
// takes the actions that are its own; controllers of other packages (the
// dock, Coach, Spenders, «Новые», the pages…) plug in as they are loaded —
// a lazy chunk registers its controller before its surface is mounted.
//
// Rules:
// - one controller per view name: a second one for the same name is a wiring
//   error and throws at registration, never at a click;
// - a snapshot of a view nobody serves is a wiring error too (a surface was
//   mounted before its controller): it throws, the surface's error boundary
//   shows CG-UI-FAILED;
// - a subscription may come before its controller: it waits, and hears the
//   first snapshot when the controller arrives (and again after a controller
//   was replaced);
// - an action goes to the controllers in registration order, the first one
//   that takes it (a non-null answer) owns it; nobody takes it, or the owner
//   throws — the receipt is a refusal, never a rejected promise: a click
//   handler in the UI never has to catch.

import { type CgCode, type CgErrorView } from '@cg/contracts/errors';
import { selectorKey, type ActionReceipt, type AppClient, type UiAction, type ViewName, type ViewOf, type ViewSelector } from '@cg/contracts/vm';

export interface SurfaceController {
  /** The view names (`ViewSelector.of`) this controller serves. */
  readonly kinds: readonly ViewName[];
  getSnapshot<S extends ViewSelector>(selector: S): Readonly<ViewOf<S>>;
  subscribe<S extends ViewSelector>(selector: S, listener: (view: Readonly<ViewOf<S>>) => void): () => void;
  /** null — not this controller's action. */
  dispatch(action: UiAction): Promise<ActionReceipt> | null;
}

/** A surface asked for a view no controller serves: it was mounted before its controller. */
export class UnservedViewError extends Error {
  override readonly name = 'UnservedViewError';
  constructor(readonly view: ViewName) {
    super(`no controller serves the view «${view}»`);
  }
}

export type RouterFailure =
  /** A controller threw while answering; `view` or `action` names what was asked. */
  | { readonly kind: 'snapshot' | 'subscribe' | 'listener'; readonly view: ViewName }
  | { readonly kind: 'dispatch' | 'unhandled'; readonly action: UiAction['type'] };

export interface AppRouterOptions {
  /** The error card of a refusal the router makes itself (CG-UI-FAILED), in the current language. */
  readonly errorOf: (code: CgCode) => CgErrorView;
  /** Facts only (which view, which action type): the composition root logs them. */
  readonly onFailure?: (failure: RouterFailure) => void;
}

export interface AppRouter extends AppClient {
  /** Plugs a controller in; returns the unplug. Throws when one of its views is already served. */
  register(controller: SurfaceController): () => void;
  serves(view: ViewName): boolean;
  /** Served view names, in registration order. */
  views(): readonly ViewName[];
  /** Unplugs every controller and drops every subscription. */
  dispose(): void;
}

interface Subscription {
  readonly selector: ViewSelector;
  readonly listener: (view: unknown) => void;
  /** The controller's own unsubscribe while one serves the view. */
  detach: (() => void) | null;
  active: boolean;
}

export function createAppRouter(options: AppRouterOptions): AppRouter {
  const byView = new Map<ViewName, SurfaceController>();
  const controllers: SurfaceController[] = [];
  const subscriptions = new Set<Subscription>();
  let disposed = false;

  const report = (failure: RouterFailure): void => {
    try {
      options.onFailure?.(failure);
    } catch {
      // Reporting a failure never becomes one.
    }
  };

  const refusal = (action: UiAction): ActionReceipt => ({ ok: false, type: action.type, code: 'CG-UI-FAILED', error: options.errorOf('CG-UI-FAILED') });

  /** Hands a view to a listener; a listener's own bug is its surface's, not the router's. */
  const deliver = (subscription: Subscription, view: unknown): void => {
    if (!subscription.active) return;
    try {
      subscription.listener(view);
    } catch {
      report({ kind: 'listener', view: subscription.selector.of });
    }
  };

  const attach = (subscription: Subscription, controller: SurfaceController, announce: boolean): void => {
    if (!subscription.active || subscription.detach !== null) return;
    const view = subscription.selector.of;
    try {
      subscription.detach = controller.subscribe(subscription.selector, (next) => deliver(subscription, next));
    } catch {
      report({ kind: 'subscribe', view });
      return;
    }
    if (!announce) return;
    // The subscriber could not read a snapshot while nobody served the view: this is its first one.
    try {
      deliver(subscription, controller.getSnapshot(subscription.selector));
    } catch {
      report({ kind: 'snapshot', view });
    }
  };

  const detach = (subscription: Subscription): void => {
    const off = subscription.detach;
    subscription.detach = null;
    try {
      off?.();
    } catch {
      // A controller that is going away anyway.
    }
  };

  return {
    getSnapshot<S extends ViewSelector>(selector: S): Readonly<ViewOf<S>> {
      const controller = byView.get(selector.of);
      if (controller === undefined) throw new UnservedViewError(selector.of);
      return controller.getSnapshot(selector);
    },

    subscribe<S extends ViewSelector>(selector: S, listener: (view: Readonly<ViewOf<S>>) => void): () => void {
      const subscription: Subscription = { selector, listener: listener as (view: unknown) => void, detach: null, active: !disposed };
      if (disposed) return () => undefined;
      subscriptions.add(subscription);
      const controller = byView.get(selector.of);
      if (controller !== undefined) attach(subscription, controller, false);
      return () => {
        if (!subscription.active) return;
        subscription.active = false;
        subscriptions.delete(subscription);
        detach(subscription);
      };
    },

    async dispatch(action: UiAction): Promise<ActionReceipt> {
      for (const controller of [...controllers]) {
        let taken: Promise<ActionReceipt> | null;
        try {
          taken = controller.dispatch(action);
        } catch {
          report({ kind: 'dispatch', action: action.type });
          return refusal(action);
        }
        if (taken === null) continue;
        try {
          return await taken;
        } catch {
          report({ kind: 'dispatch', action: action.type });
          return refusal(action);
        }
      }
      report({ kind: 'unhandled', action: action.type });
      return refusal(action);
    },

    register(controller: SurfaceController): () => void {
      if (disposed) return () => undefined;
      const taken = controller.kinds.filter((view) => byView.has(view));
      if (taken.length > 0) throw new Error(`views already served: ${taken.join(', ')}`);
      if (new Set(controller.kinds).size !== controller.kinds.length) throw new Error('a controller names a view twice');
      controllers.push(controller);
      for (const view of controller.kinds) byView.set(view, controller);
      for (const subscription of [...subscriptions]) {
        if (controller.kinds.includes(subscription.selector.of)) attach(subscription, controller, true);
      }
      let plugged = true;
      return () => {
        if (!plugged) return;
        plugged = false;
        const index = controllers.indexOf(controller);
        if (index >= 0) controllers.splice(index, 1);
        for (const view of controller.kinds) if (byView.get(view) === controller) byView.delete(view);
        // Its subscribers wait for the next controller of the view.
        for (const subscription of subscriptions) if (controller.kinds.includes(subscription.selector.of)) detach(subscription);
      };
    },

    serves: (view) => byView.has(view),
    views: () => [...byView.keys()],

    dispose(): void {
      disposed = true;
      for (const subscription of subscriptions) {
        subscription.active = false;
        detach(subscription);
      }
      subscriptions.clear();
      controllers.length = 0;
      byView.clear();
    },
  };
}

/** One listener set per selector: what most controllers need to serve `subscribe`. */
export class ViewListeners {
  private readonly bySelector = new Map<string, Set<(view: unknown) => void>>();

  add<S extends ViewSelector>(selector: S, listener: (view: Readonly<ViewOf<S>>) => void): () => void {
    const key = selectorKey(selector);
    let set = this.bySelector.get(key);
    if (set === undefined) {
      set = new Set();
      this.bySelector.set(key, set);
    }
    const wrapped = listener as (view: unknown) => void;
    set.add(wrapped);
    return () => {
      set.delete(wrapped);
      if (set.size === 0 && this.bySelector.get(key) === set) this.bySelector.delete(key);
    };
  }

  /** Tells every listener of the selector; one listener's failure does not stop the rest. */
  notify<S extends ViewSelector>(selector: S, view: Readonly<ViewOf<S>>): void {
    for (const listener of [...(this.bySelector.get(selectorKey(selector)) ?? [])]) {
      try {
        listener(view);
      } catch {
        // The router reports listener failures; a controller only keeps going.
      }
    }
  }

  has(selector: ViewSelector): boolean {
    return (this.bySelector.get(selectorKey(selector))?.size ?? 0) > 0;
  }

  clear(): void {
    this.bySelector.clear();
  }
}
