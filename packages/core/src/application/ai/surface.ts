// The frame of one controller (architecture.md §10.2 `AppClient`): a view is
// built from the workspace on demand, kept until the workspace changes, and
// handed out as the same object while it reads the same — so a subscriber is
// told only when something it shows really changed, and `getSnapshot` is
// stable between changes. «Reads the same» is decided by walking the two
// views, not by serialising them: a part a controller handed out again as
// the very same object (a finished Coach exchange) is equal at once, so a
// stream batch does not pay for the whole dialog (§11).

import { type CgErrorWire } from '@cg/contracts/errors';
import { type HumanCause } from '@cg/contracts/ids';
import { selectorKey, type ActionReceipt, type RunningOpVM, type UiAction, type UiActionOf, type UiActionType, type ViewSelector } from '@cg/contracts/vm';

import { type SurfaceController } from './ports';
import { errorVm } from './view-models';
import { type AiWorkspace } from './workspace';

export type CauseKind = HumanCause['kind'];

/** A controller that also takes the kind of the trusted event (a hotkey goes through `handle` with `key`). */
export interface AiController extends SurfaceController {
  handle(action: UiAction, cause: CauseKind): Promise<ActionReceipt> | null;
  dispose(): void;
}

/** The actions a controller takes, by type; an action without a handler — or a handler answering null — is not its own. */
export type ActionHandlers = { readonly [T in UiActionType]?: (action: UiActionOf<T>, cause: CauseKind) => Promise<ActionReceipt> | null };

export interface SurfaceSpec {
  readonly kinds: readonly string[];
  build(selector: ViewSelector): unknown;
  readonly handlers: ActionHandlers;
  dispose?(): void;
}

function route(handlers: ActionHandlers, action: UiAction, cause: CauseKind): Promise<ActionReceipt> | null {
  const handler = handlers[action.type] as ((action: UiAction, cause: CauseKind) => Promise<ActionReceipt> | null) | undefined;
  return handler === undefined ? null : handler(action, cause);
}

interface Cached {
  version: number;
  view: unknown;
}

const defined = (record: Record<string, unknown>): number => {
  let count = 0;
  for (const key in record) if (record[key] !== undefined) count += 1;
  return count;
};

/**
 * Whether two view models read the same. Views are plain data (strings,
 * numbers, booleans, null, arrays, records); a key holding `undefined`
 * counts as absent, as it does on the wire. The same object is equal
 * without a walk.
 */
export function sameView(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const aList = Array.isArray(a);
  if (aList !== Array.isArray(b)) return false;
  if (aList) {
    const other = b as readonly unknown[];
    if (a.length !== other.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!sameView(a[i], other[i])) return false;
    return true;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  if (defined(left) !== defined(right)) return false;
  for (const key in left) {
    const value = left[key];
    if (value !== undefined && !sameView(value, right[key])) return false;
  }
  return true;
}

export function createSurface(ws: AiWorkspace, spec: SurfaceSpec): AiController {
  const cache = new Map<string, Cached>();
  const subscriptions = new Map<string, { selector: ViewSelector; listeners: Set<(view: unknown) => void> }>();

  const read = (selector: ViewSelector): { readonly view: unknown; readonly changed: boolean } => {
    const key = selectorKey(selector);
    const cached = cache.get(key);
    if (cached !== undefined && cached.version === ws.version) return { view: cached.view, changed: false };
    const view = spec.build(selector);
    if (cached !== undefined && sameView(cached.view, view)) {
      cached.version = ws.version;
      return { view: cached.view, changed: false };
    }
    cache.set(key, { version: ws.version, view });
    return { view, changed: cached !== undefined };
  };

  const off = ws.subscribe(() => {
    for (const { selector, listeners } of subscriptions.values()) {
      if (listeners.size === 0) continue;
      const { view, changed } = read(selector);
      if (changed) for (const listener of [...listeners]) listener(view);
    }
  });

  return {
    kinds: spec.kinds,
    getSnapshot: (selector) => read(selector).view,
    subscribe(selector, listener) {
      const key = selectorKey(selector);
      // The first read is the baseline: only later changes are announced.
      read(selector);
      const entry = subscriptions.get(key) ?? { selector, listeners: new Set<(view: unknown) => void>() };
      subscriptions.set(key, entry);
      entry.listeners.add(listener);
      return () => {
        entry.listeners.delete(listener);
      };
    },
    dispatch: (action) => route(spec.handlers, action, 'click'),
    handle: (action, cause) => route(spec.handlers, action, cause),
    dispose() {
      off();
      subscriptions.clear();
      cache.clear();
      spec.dispose?.();
    },
  };
}

// ── receipts ────────────────────────────────────────────────────────────────

export const done = (type: UiActionType, outcome: Extract<ActionReceipt, { ok: true }>['outcome'] = 'done', extra: { readonly opId?: string; readonly revision?: number } = {}): ActionReceipt => ({
  ok: true,
  type,
  outcome,
  ...extra,
});

export function refused(ws: AiWorkspace, type: UiActionType, error: CgErrorWire, running?: readonly RunningOpVM[]): ActionReceipt {
  return { ok: false, type, code: error.code, error: errorVm(error, ws.ports.i18n), ...(running === undefined ? {} : { running }) };
}
