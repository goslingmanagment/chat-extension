// Keys on a Telegram page (docs/specs/2026-10-27-telegram-site.md §4.5).
//
// Web A listens to `keydown` on `document` in the capture phase (src/components/middle/composer/MessageInput.tsx): a key
// whose target is not its field, an input, a textarea or a `contenteditable` SENDS the field on Enter or ⌘/Ctrl+Enter,
// and moves any other key into the field (focus first, then a copy of the key). A key in our closed shadow root reaches
// `document` with our host as its target — so Enter in a box of ours would send Telegram's field to the fan, and a
// letter would carry the focus into it, so that the next Enter sends (it has no `isComposing` check: IME too).
//
// So every key whose path starts in our root stops on `window`, in the capture phase, before `document` sees it:
// `stopPropagation` (never `stopImmediatePropagation`), so the shared dispatcher, registered after this listener on
// the same target and phase, still hears it; the browser's own default — the typing in our field — is never
// prevented here. Our UI then gets its copy inside our root: from the dispatcher when it hands the key over
// (`isolate`), else from the listener that stands after the dispatcher (a microtask after the start, when the tab's
// keys are up) — host-kit's copy, which cannot leave our root. A copy our UI prevented prevents the original.
// IME keys and plain letters too: the dispatcher's early exits for them come before its isolation.
//
// The probe of the dispatcher (whose focus, which window is open): Telegram's field is the main composer of the active
// slide; a Telegram modal (`#portals .Modal`) is a window of the site's own.

import { createKeyboardProbe as createProbe, type KeyboardProbe } from '@cg/host-kit/isolated/keyboard';
import type { ShadowRootRegistry } from '@cg/host-kit/isolated/shadow-registry';

import { TELEGRAM_SELECTORS } from './dom';

/** The keys a page listener could act on. */
const KEY_EVENTS = ['keydown', 'keypress', 'keyup'] as const;

/**
 * Telegram's message field for our keys: the main field of the open chat's active slide — and, while the attachment
 * window holds the message being written, its caption (spec §4.4: Reply is generated there and copied, never
 * inserted; the insert itself refuses that window).
 */
export function isTelegramComposer(active: Element): boolean {
  return (active.matches(TELEGRAM_SELECTORS.field) && active.closest(TELEGRAM_SELECTORS.listSlide) !== null) || active.matches(TELEGRAM_SELECTORS.attachmentField);
}

/** A modal window of Telegram's own is open (but the attachment window, the message being written): Esc and plain letters are its. */
export function telegramWindowOpen(doc: Document): boolean {
  const portals = doc.getElementById('portals');
  if (portals === null) return false;
  return [...portals.querySelectorAll('.Modal')].some((modal) => modal.querySelector(TELEGRAM_SELECTORS.attachmentField) === null);
}

/** Originals a copy was made of (by the dispatcher's isolation or by the late listener): one copy per key. */
const copied = new WeakSet<Event>();

/** The shared probe with Telegram's field and windows; a copy it makes for the dispatcher is remembered. */
export function createTelegramKeyboardProbe(doc: Document, registry: ShadowRootRegistry): KeyboardProbe {
  const probe = createProbe(doc, registry, isTelegramComposer, () => telegramWindowOpen(doc));
  return {
    ...probe,
    deliver(event) {
      copied.add(event);
      return probe.deliver(event);
    },
  };
}

export interface KeyIsolation {
  /** Keys from our roots stopped on `window`, by type (counts only). */
  stats(): { readonly held: number; readonly copied: number };
  dispose(): void;
}

/**
 * Holds every key whose path starts in our roots on `window` (capture), ahead of the shared dispatcher, and hands our
 * UI its copy after the dispatcher had its say. Call at document_start, before the tab's keys start.
 */
export function isolateOurKeys(win: Window, registry: ShadowRootRegistry): KeyIsolation {
  const doc = win.document;
  const probe = createProbe(doc, registry, isTelegramComposer, () => telegramWindowOpen(doc));
  let held = 0;
  let delivered = 0;
  let disposed = false;
  const fromOurs = (event: Event): boolean => event.isTrusted && registry.hostOf(event) !== null;
  const hold = (event: Event): void => {
    if (!fromOurs(event)) return;
    held += 1;
    event.stopPropagation();
  };
  /** After the dispatcher: a key it neither claimed nor handed over goes to our UI as a copy. */
  const handOver = (event: Event): void => {
    if (event.type !== 'keydown' || !fromOurs(event) || copied.has(event)) return;
    copied.add(event);
    delivered += 1;
    if (probe.deliver(event)) event.preventDefault();
  };
  for (const type of KEY_EVENTS) win.addEventListener(type, hold, true);
  // The tab's keys start in the same synchronous step as this host (composition/tab.ts): one microtask later their
  // dispatcher stands on `window` before this listener.
  queueMicrotask(() => {
    if (!disposed) win.addEventListener('keydown', handOver, true);
  });
  return {
    stats: () => ({ held, copied: delivered }),
    dispose() {
      disposed = true;
      for (const type of KEY_EVENTS) win.removeEventListener(type, hold, true);
      win.removeEventListener('keydown', handOver, true);
    },
  };
}
