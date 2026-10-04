// The page side of the early hotkey dispatcher (architecture.md §9.1 «Кому
// принадлежит клавиша», D-18): one synchronous look at where the focus is
// and whether ChatSpace has a window of its own open, and the hand-over of a
// key to our own UI. The dispatcher itself is `@cg/core/application/hotkeys`
// (no DOM there); this object is its `ownership` port for ChatSpace, and
// `routeOfLocation` is its route until MAIN reports one.
//
// - Focus inside our UI is read from `activeElement` of our closed roots
//   through the registry; the event's composed path only says that it came
//   through one of our hosts (a closed root reveals nothing more).
// - A key ChatSpace would act on, pressed inside our UI, must not reach any
//   listener of ChatSpace — its global one runs on `window` right after ours.
//   The dispatcher stops the event there, so our own elements would not get
//   it either: `deliver` gives them a copy that cannot leave our shadow root
//   (`composed: false`) — a `keydown` event with the key's fields, which our
//   own handlers read the same way. Only trusted keys are ever copied.
// - A copy is a scripted event, so its `isTrusted` is false — and yet it is
//   the person's own key: made from a trusted keydown only, in the same
//   synchronous step, for the element that has the focus inside our closed
//   root. For «a write only on a trusted action» (§14) it counts as one; our
//   UI tells it by DELIVERED_KEY_MARK (ui-contract.md, decision 12).

import { EDITOR_SELECTOR, FRAME_SELECTOR } from './host-contract';
import type { ShadowRootRegistry } from './shadow-registry';

/** Where the focus is, as the key policy names it (`@cg/core/domain/hotkeys` FocusKind). */
export type KeyFocus = 'ours-field' | 'ours' | 'composer' | 'field' | 'page';

export interface KeyboardProbe {
  focus(event: Event): KeyFocus;
  /** A dialog, menu or list of ChatSpace itself is open and visible. */
  nativeModalOpen(): boolean;
  /** Dispatches a copy of the key on the focused element of our root; true — our UI called preventDefault on it. */
  deliver(event: Event): boolean;
  /** True for a copy `deliver` made: our UI may treat it as the person's own key. */
  isDelivered(event: Event): boolean;
}

/**
 * On every copy `deliver` makes and on nothing else: a read-only,
 * non-enumerable own property with the value `true`. `@cg/ui` cannot import
 * this package (§4), so the key is a registry symbol the UI names by itself:
 * `event[Symbol.for('cg.key.delivered')] === true`. A handler that issues a
 * write token for a key accepts `event.isTrusted || <the mark>`.
 *
 * The mark is a label, not a secret. What makes a copy the person's key is
 * that only this probe makes one, only from a trusted keydown, and that it
 * never leaves our closed root: the page can neither read the copy nor send
 * an event of its own to a listener inside the root.
 */
export const DELIVERED_KEY_MARK: unique symbol = Symbol.for('cg.key.delivered');

/**
 * What ChatSpace's own Esc rule treats as «something of ours is open»
 * (MainLayout `lastResort`, client-internals §5.1), minus the attribute we
 * set ourselves: PrimeVue renders these only while an overlay is open.
 */
export const NATIVE_OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]';

/** `/accounts/:accountId/chats/:chatId?` — ChatSpace's `chat` route (§6.1). */
export const CHAT_PATH_PATTERN = /^\/accounts\/([1-9]\d{0,29})\/chats(?:\/([1-9]\d{0,29}))?\/?$/;

/**
 * The route by the address alone, for the first moments of a document: MAIN
 * has not reported yet, but a key pressed in an open chat is already ours.
 * `epoch` is the path: a key kept for the lazy part runs only on the same one.
 */
export function routeOfLocation(location: Pick<Location, 'pathname'>): { readonly kind: 'chat' | 'account' | 'other'; readonly epoch: string } {
  const match = CHAT_PATH_PATTERN.exec(location.pathname);
  return { kind: match === null ? 'other' : match[2] === undefined ? 'account' : 'chat', epoch: location.pathname };
}

/** On the dock host while a key of ours waits for the lazy part or for the chat's first state (HK-024, HK-025). */
export const KEY_PENDING_ATTRIBUTE = 'data-cg-key-pending';

/**
 * The one sign of a waiting key that exists before anything of ours can
 * draw: the dock host is in the page from document_start, the toasts are
 * not. It is the `onWaiting` of `@cg/core/application/hotkeys`
 * `createEarlyNotices`. The attribute (with `aria-busy`) is what the dock's
 * own stylesheet, the stand and the tests read; this module draws nothing.
 */
export function createKeyPendingMark(host: Element): (waiting: boolean) => void {
  return (waiting) => {
    if (waiting) {
      host.setAttribute(KEY_PENDING_ATTRIBUTE, '');
      host.setAttribute('aria-busy', 'true');
    } else {
      host.removeAttribute(KEY_PENDING_ATTRIBUTE);
      host.removeAttribute('aria-busy');
    }
  };
}

const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit']);
const TEXT_ROLES = new Set(['textbox', 'searchbox', 'combobox']);

/** An element a person types into. */
export function isTypingTarget(element: Element): boolean {
  const tag = element.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has((element.getAttribute('type') ?? 'text').toLowerCase());
  if ((element as HTMLElement).isContentEditable === true) return true;
  // happy-dom and detached trees do not compute isContentEditable: the attribute is the fallback.
  const editable = element.closest('[contenteditable]')?.getAttribute('contenteditable');
  if (editable === '' || editable === 'true' || editable === 'plaintext-only') return true;
  return TEXT_ROLES.has(element.getAttribute('role') ?? '');
}

export function createKeyboardProbe(doc: Document, registry: ShadowRootRegistry): KeyboardProbe {
  const delivered = new WeakSet<Event>();
  return {
    focus(event) {
      const inner = registry.focusedInside(doc);
      if (inner !== null) return isTypingTarget(inner) ? 'ours-field' : 'ours';
      // Focus on the host itself, or a key that came through it while the root's focus is not readable.
      if (registry.hostOf(event) !== null) return 'ours';
      const active = doc.activeElement;
      if (active === null || active === doc.body || active === doc.documentElement) return 'page';
      if (!isTypingTarget(active)) return 'page';
      // ChatSpace's message field: the Tiptap surface, or anything editable inside the composer frame.
      return active.closest(EDITOR_SELECTOR) !== null || active.closest(FRAME_SELECTOR) !== null ? 'composer' : 'field';
    },
    nativeModalOpen() {
      for (const element of doc.querySelectorAll(NATIVE_OVERLAY_SELECTOR)) {
        if (typeof element.checkVisibility !== 'function' || element.checkVisibility()) return true;
      }
      return false;
    },
    deliver(event) {
      const target = registry.focusedInside(doc);
      const key = event as KeyboardEvent;
      if (target === null || !event.isTrusted || typeof key.code !== 'string') return false;
      const Constructor = doc.defaultView?.Event;
      if (Constructor === undefined) return false;
      // Never past our shadow root: ChatSpace's listeners cannot see the copy. It is a plain Event carrying the
      // key's fields, not a KeyboardEvent: Gecko makes every KeyboardEvent of type `keydown` composed whatever
      // its init says (measured in Firefox 157), and a composed copy would reach `window` again.
      const copy = new Constructor(event.type, { bubbles: true, cancelable: true, composed: false });
      const fields: Record<string, unknown> = {
        key: key.key,
        code: key.code,
        location: key.location,
        repeat: key.repeat,
        isComposing: key.isComposing,
        ctrlKey: key.ctrlKey,
        shiftKey: key.shiftKey,
        altKey: key.altKey,
        metaKey: key.metaKey,
        keyCode: key.keyCode,
        charCode: key.charCode,
        which: key.which,
        getModifierState: (name: string): boolean => key.getModifierState(name),
      };
      for (const [name, value] of Object.entries(fields)) Object.defineProperty(copy, name, { value, enumerable: true });
      Object.defineProperty(copy, DELIVERED_KEY_MARK, { value: true });
      delivered.add(copy);
      target.dispatchEvent(copy);
      return copy.defaultPrevented;
    },
    isDelivered: (event) => delivered.has(event),
  };
}
