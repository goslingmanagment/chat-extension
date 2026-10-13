// A. FBuddy's MAIN content script (`fansly-goals-refresh.js:3027-3070`, S5
// §2.3, §6.2 A): at `document_start` it wraps `Map.prototype.set` and
// `.delete` until Angular registers its first view — an entry whose key is a
// number and whose value is an array holding that number at index 19 (an
// LView and its id) — then restores the prototype and gives that one Map its
// own `set`/`delete`, which keep FBuddy's copy of the registry. The stand app
// registers one such entry at boot (fixture-fansly/src/ng.ts `registerView`).

import { FBUDDY_KEYS } from './protocol';
import { original } from './util';

/** The LView slot that holds the view's id (Angular's `ID`). */
export const LVIEW_ID_SLOT = 19;

export interface MapPatchState {
  installed: boolean;
  /** Angular's registry was found. */
  found: boolean;
  /** `Map.prototype` is native again. */
  restored: boolean;
  /** FBuddy's copy of the registry. */
  readonly views: Map<number, unknown>;
  /** Angular's registry, once found: the one Map that carries FBuddy's own `set`/`delete`. */
  registry: Map<unknown, unknown> | null;
}

type MapSet = (this: Map<unknown, unknown>, key: unknown, value: unknown) => Map<unknown, unknown>;
type MapDelete = (this: Map<unknown, unknown>, key: unknown) => boolean;

const isView = (key: unknown, value: unknown): key is number => typeof key === 'number' && Array.isArray(value) && (value as unknown[])[LVIEW_ID_SLOT] === key;

/** `Map` is the realm's own built-in: the page's in the browser (the window only carries it there). */
export function installMapPatch(win: Window & typeof globalThis): MapPatchState {
  const proto = Map.prototype;
  const nativeSet = original<MapSet>(proto, 'set');
  const nativeDelete = original<MapDelete>(proto, 'delete');
  const views = new Map<number, unknown>();
  const state: MapPatchState = { installed: true, found: false, restored: false, views, registry: null };
  Reflect.set(win, FBUDDY_KEYS.goalsRefresh, state);

  function set(this: Map<unknown, unknown>, key: unknown, value: unknown): Map<unknown, unknown> {
    if (!state.found && this !== views && isView(key, value)) {
      state.found = true;
      // Back to native first: everything after this runs without the wrapper.
      Reflect.set(proto, 'set', nativeSet);
      Reflect.set(proto, 'delete', nativeDelete);
      state.restored = true;
      for (const [known, view] of this) nativeSet.call(views, known, view);
      nativeSet.call(views, key, value);
      state.registry = this;
      Object.defineProperty(this, 'set', {
        configurable: true,
        writable: true,
        value(this: Map<unknown, unknown>, id: unknown, view: unknown) {
          nativeSet.call(views, id, view);
          return nativeSet.call(this, id, view);
        },
      });
      Object.defineProperty(this, 'delete', {
        configurable: true,
        writable: true,
        value(this: Map<unknown, unknown>, id: unknown) {
          nativeDelete.call(views, id);
          return nativeDelete.call(this, id);
        },
      });
    }
    return nativeSet.call(this, key, value);
  }
  function remove(this: Map<unknown, unknown>, key: unknown): boolean {
    return nativeDelete.call(this, key);
  }
  Reflect.set(proto, 'set', set);
  Reflect.set(proto, 'delete', remove);
  return state;
}
