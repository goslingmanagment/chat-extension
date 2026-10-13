// D. FBuddy's restricted-words guard (`injections/fbuddy-restricted-words-
// guard.js`, S5 §2.6, §6.2 D), a page script injected after FBuddy's init,
// only for a creator whose FBuddy user is in an organization (`+guard`):
// - a second layer of `open`/`send` on the XHR prototype; `open` flags POSTs
//   whose address matches a PREFIX regex of `…/api/v1/message` — so
//   `/message/ack`, `/message/broadcast`, `/messages…` match too;
// - `send` reads the words from `script#fbuddy-restricted-words-data`, takes
//   `JSON.parse(body).content` (or the raw body) and matches whole words; on a
//   match it RETURNS WITHOUT CALLING the native `send`: no request leaves, the
//   XHR fires no `loadstart`, `load`, `error`, `abort` or `timeout` and stays
//   OPENED for good; it posts a toast and, on the next frame, writes the text
//   back into the tracked (or first) `textarea.message-input` with the native
//   setter, untrusted `input` and `change`, then `focus()`;
// - document `focusin`, `pointerdown`, `input` listeners (bubbling) track the
//   last composer.
// No `keydown`, no `beforeinput`, nothing on `.send-button`. The real regex
// names `https://apiv3.fansly.com`; here it is the fake Fansly's API origin.

import { BRIDGE_EVENTS, FBUDDY_IDS, FBUDDY_KEYS, FBUDDY_XHR } from './protocol';
import { original, writeField } from './util';

export interface GuardOptions {
  readonly apiOrigin: string;
  /** Where its toast goes (the page bridge). */
  readonly post: (name: string, payload: unknown) => void;
}

export interface GuardInstance {
  readonly swallowed: number;
  readonly restored: number;
  readonly disposed: boolean;
  dispose(): void;
}

type Checked = XMLHttpRequest & { [FBUDDY_XHR.shouldCheck]?: boolean };
type XhrOpen = (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) => void;
type XhrSend = (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) => void;

export const GUARD_TOAST = 'Message blocked by restricted words';

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** The guard's address test: a prefix, case-insensitive, not anchored (S5 §2.6 `:6`, `:273-294`). */
export const guardPattern = (apiOrigin: string): RegExp => new RegExp(`${escape(apiOrigin)}\\/api\\/v1\\/message`, 'i');

/** The words the organization restricts, as FBuddy's isolated side wrote them; [] — none (or unreadable). */
export function readWords(doc: Document): string[] {
  const text = doc.getElementById(FBUDDY_IDS.wordsData)?.textContent ?? '';
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.filter((word): word is string => typeof word === 'string' && word.trim() !== '') : [];
  } catch {
    return [];
  }
}

/** What a message body says: its `content`, or the raw body. */
export function contentOf(body: unknown): string {
  if (typeof body !== 'string') return '';
  try {
    const parsed: unknown = JSON.parse(body);
    const content = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>)['content'] : undefined;
    return typeof content === 'string' ? content : body;
  } catch {
    return body;
  }
}

/** The first restricted word the text holds as a whole word, case-insensitive; null — none. */
export function matchWord(text: string, words: readonly string[]): string | null {
  return words.find((word) => new RegExp(`(^|[^\\p{L}\\p{N}_])${escape(word)}($|[^\\p{L}\\p{N}_])`, 'iu').test(text)) ?? null;
}

export function installGuard(win: Window & typeof globalThis, options: GuardOptions): GuardInstance {
  (Reflect.get(win, FBUDDY_KEYS.guardInstance) as GuardInstance | undefined)?.dispose();
  Reflect.set(win, FBUDDY_KEYS.guard, true);
  const doc = win.document;
  const pattern = guardPattern(options.apiOrigin);
  const proto = win.XMLHttpRequest.prototype;
  const originalOpen = original<XhrOpen>(proto, 'open');
  const originalSend = original<XhrSend>(proto, 'send');
  let disposed = false;
  let swallowed = 0;
  let restored = 0;
  let tracked: HTMLTextAreaElement | null = null;

  const track = (event: Event): void => {
    const target = event.target;
    if (target instanceof win.HTMLTextAreaElement && target.matches('textarea.message-input')) tracked = target;
  };
  for (const type of ['focusin', 'pointerdown', 'input']) doc.addEventListener(type, track);

  const restore = (text: string): void => {
    const field = tracked?.isConnected === true ? tracked : doc.querySelector<HTMLTextAreaElement>('textarea.message-input');
    if (field === null) return;
    writeField(field, text);
    field.setSelectionRange(text.length, text.length);
    field.focus();
    restored += 1;
  };

  function open(this: Checked, method: string, url: string | URL, ...rest: unknown[]): void {
    if (!disposed) this[FBUDDY_XHR.shouldCheck] = /^post$/i.test(String(method)) && pattern.test(String(url));
    return originalOpen.call(this, method, url, ...rest);
  }

  function send(this: Checked, body?: Document | XMLHttpRequestBodyInit | null): void {
    if (!disposed && this[FBUDDY_XHR.shouldCheck] === true) {
      const content = contentOf(body);
      if (matchWord(content, readWords(doc)) !== null) {
        swallowed += 1;
        options.post(BRIDGE_EVENTS.toast, { text: GUARD_TOAST });
        win.requestAnimationFrame(() => restore(content));
        return;
      }
    }
    return originalSend.call(this, body);
  }

  Reflect.set(proto, 'open', open);
  Reflect.set(proto, 'send', send);
  const instance: GuardInstance = {
    get swallowed() {
      return swallowed;
    },
    get restored() {
      return restored;
    },
    get disposed() {
      return disposed;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const type of ['focusin', 'pointerdown', 'input']) doc.removeEventListener(type, track);
      if (Reflect.get(proto, 'open') === open) Reflect.set(proto, 'open', originalOpen);
      if (Reflect.get(proto, 'send') === send) Reflect.set(proto, 'send', originalSend);
      if (Reflect.get(win, FBUDDY_KEYS.guardInstance) === instance) {
        Reflect.set(win, FBUDDY_KEYS.guardInstance, undefined);
        Reflect.set(win, FBUDDY_KEYS.guard, false);
      }
    },
  };
  Reflect.set(win, FBUDDY_KEYS.guardInstance, instance);
  return instance;
}
