// G. FBuddy's composer actions (S5 §2.6, §6.2 G): every write — a template, an
// emoji, a translation, the guard's restore — is the native `value` setter
// plus untrusted `input` and `change`; no `execCommand`. Templates and emoji
// splice at the caret, then `setSelectionRange` and `focus()`. Translate
// replaces the WHOLE value after a round trip to FBuddy's server, if the
// address still shows the same group; its shortcut is a `keydown` listener ON
// THE FIELD — Mod+Shift+L by `code`, modifiers exact, Mod = Meta on macOS and
// Ctrl elsewhere — that calls `preventDefault()` and `stopPropagation()`. On
// macOS that is our Split (⌘⇧L, X37: ours wins, chatters rebind FBuddy's).
// Alt+T on the document focuses its toasts.

import type { NeighborMod } from './protocol';
import { routeGroup, writeField } from './util';

/** A template text the neighbour's template button inserts. */
export const TEMPLATE_TEXT = 'Hey babe 💕';
export const EMOJI_TEXT = '😘';

/** What its translate server answers on the stand: the text, marked. */
export const translated = (text: string): string => `[EN] ${text}`;

export function resolveMod(mod: NeighborMod, platform: string): 'meta' | 'ctrl' {
  if (mod !== 'auto') return mod;
  return /mac|iphone|ipad/i.test(platform) ? 'meta' : 'ctrl';
}

/** Mod+Shift+L, exactly: by `code`, no Alt, no other Mod. */
export function isTranslateKey(event: KeyboardEvent, mod: 'meta' | 'ctrl'): boolean {
  if (event.code !== 'KeyL' || !event.shiftKey || event.altKey) return false;
  return mod === 'meta' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/** Alt+T, exactly. */
export const isToasterKey = (event: KeyboardEvent): boolean => event.code === 'KeyT' && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;

/** Splices `text` at the field's caret (over its selection). */
export function insertAtCaret(field: HTMLTextAreaElement, text: string): void {
  const start = field.selectionStart;
  const end = field.selectionEnd;
  const value = field.value;
  writeField(field, `${value.slice(0, start)}${text}${value.slice(end)}`);
  const caret = start + text.length;
  field.setSelectionRange(caret, caret);
  field.focus();
}

export interface TranslatorOptions {
  readonly win: Window & typeof globalThis;
  readonly mod: 'meta' | 'ctrl';
  readonly delayMs: number;
}

/** The translate feature: the key on each field it saw, the button, the late whole-value write. */
export class Translator {
  /** Translations written. */
  written = 0;
  private readonly fields = new WeakSet<HTMLTextAreaElement>();

  constructor(private readonly options: TranslatorOptions) {}

  /** Puts the shortcut's listener on a field (once per field: a new composer gets its own). */
  attach(field: HTMLTextAreaElement): void {
    if (this.fields.has(field)) return;
    this.fields.add(field);
    field.addEventListener('keydown', (event) => {
      if (!isTranslateKey(event, this.options.mod)) return;
      event.preventDefault();
      event.stopPropagation();
      this.translate(field);
    });
  }

  translate(field: HTMLTextAreaElement): void {
    const { win, delayMs } = this.options;
    const group = routeGroup(win.location);
    const text = field.value;
    if (text.trim() === '') return;
    win.setTimeout(() => {
      if (!field.isConnected || routeGroup(win.location) !== group) return;
      writeField(field, translated(text));
      this.written += 1;
    }, delayMs);
  }
}
