// Which combinations Firefox hands to the page (architecture.md §9.1 «Риск
// зарезервированных сочетаний»; docs/hotkeys-delivery.md is this table in
// words, with the reasons). Three kinds of knowledge:
//
// - the vendored scheme's combinations are intercepted by the Fansly
//   extension in production Firefox on both systems — `cancelable` where the
//   browser has an action of its own on them, `delivered` where it has none;
// - plain keys (J, K, `]`, `?`, Esc) always reach the page — `delivered`;
// - the rows this client adds on ⌘/Ctrl (⌘K, ⌘U, Ctrl+,), the Alt fallback of
//   ⌘U, the chat slots Alt+1–9 (X45: ⌘/Ctrl+1–9 are Firefox's tab keys
//   again, not ours) and «Новые» on ⌘⇧U / Ctrl+Alt+U (X55) are `unverified` until somebody presses them in a real Firefox
//   on winpc and the Mac: the headless e2e proves only that the page gets a
//   synthetic key, never that the browser or the OS gives up a real one;
// - ⌘, on macOS is Firefox's own «Settings…» item of the application menu
//   (§9.1 table): `reserved` until a hand check says otherwise. It has no
//   fallback — the popup, the dock and the palette open the settings.
//
// `reserved` is never printed as working; `unverified` is printed together
// with its fallback. A measured result goes into DELIVERY (and the doc) — the
// catalog also takes overrides, so a measurement needs no code elsewhere.

import { type HotkeyDelivery, type HotkeyPlatform } from '@cg/contracts/vm';

import { type DispatcherCommandId } from './keymap';

/** A printed combination: a dispatcher command, or the Alt fallback of one. */
export type DeliveryKey = DispatcherCommandId | 'next-unread:fallback';

export const DELIVERY_KEYS: readonly DeliveryKey[] = [
  'reply',
  'fix',
  'hi',
  'ping',
  'cancel',
  'help',
  'recap',
  'tone',
  'review',
  'split',
  'spenders',
  'coach',
  'newcomers',
  'palette',
  'cheatsheet',
  'settings',
  'close',
  'chat-next',
  'chat-previous',
  'fan-panel',
  'next-unread',
  'next-unread:fallback',
  'quick-jump',
  'notes',
  'apply-fix',
];

export const DELIVERY: Readonly<Record<HotkeyPlatform, Readonly<Record<DeliveryKey, HotkeyDelivery>>>> = {
  mac: {
    reply: 'cancelable',
    fix: 'cancelable',
    hi: 'cancelable',
    ping: 'cancelable',
    cancel: 'cancelable',
    help: 'cancelable',
    recap: 'cancelable',
    tone: 'cancelable',
    review: 'cancelable',
    split: 'delivered',
    spenders: 'delivered',
    coach: 'delivered',
    // ⌘⇧U (X55): nothing of Firefox's on it, by its key table; nobody has pressed it in a real Firefox yet.
    newcomers: 'unverified',
    palette: 'unverified',
    cheatsheet: 'delivered',
    settings: 'reserved',
    close: 'delivered',
    'chat-next': 'delivered',
    'chat-previous': 'delivered',
    'fan-panel': 'delivered',
    'next-unread': 'unverified',
    'next-unread:fallback': 'unverified',
    // Alt+1–9 (⌥1–9): nothing of Firefox's on macOS and Windows (X45); on Linux Alt+1–9 are its tabs (hotkeys-delivery.md).
    'quick-jump': 'unverified',
    // ⌘⇧K: nothing of Firefox's (its web console is ⌘⌥K); the Fansly extension has served it since 2.9.0.
    notes: 'delivered',
    // ⌘↵ (X58): Firefox acts on it only in its own address bar; in a page field it is the page's (ChatSpace and Fansly get it).
    'apply-fix': 'delivered',
  },
  win: {
    reply: 'cancelable',
    fix: 'cancelable',
    hi: 'cancelable',
    ping: 'cancelable',
    cancel: 'delivered',
    help: 'delivered',
    recap: 'delivered',
    tone: 'delivered',
    review: 'delivered',
    split: 'delivered',
    spenders: 'delivered',
    coach: 'delivered',
    // Ctrl+Alt+U (X55): nothing of Firefox's on it; not pressed by hand yet.
    newcomers: 'unverified',
    palette: 'unverified',
    cheatsheet: 'delivered',
    settings: 'unverified',
    close: 'delivered',
    'chat-next': 'delivered',
    'chat-previous': 'delivered',
    'fan-panel': 'delivered',
    'next-unread': 'unverified',
    'next-unread:fallback': 'unverified',
    // Alt+1–9 (⌥1–9): nothing of Firefox's on macOS and Windows (X45); on Linux Alt+1–9 are its tabs (hotkeys-delivery.md).
    'quick-jump': 'unverified',
    notes: 'delivered',
    // Ctrl+Enter (X58): Firefox's only in its address bar («www…com»); in a page field it is the page's.
    'apply-fix': 'delivered',
  },
};

export type DeliveryOverrides = Readonly<Partial<Record<DeliveryKey, HotkeyDelivery>>>;

export function deliveryOf(key: DeliveryKey, platform: HotkeyPlatform, overrides: DeliveryOverrides = {}): HotkeyDelivery {
  return overrides[key] ?? DELIVERY[platform][key];
}
