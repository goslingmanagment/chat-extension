// Which combinations Firefox hands to the page (architecture.md §9.1 «Риск
// зарезервированных сочетаний»; docs/hotkeys-delivery.md is this table in
// words, with the reasons). Three kinds of knowledge:
//
// - the vendored scheme's combinations are intercepted by the Fansly
//   extension in production Firefox on both systems — `cancelable` where the
//   browser has an action of its own on them, `delivered` where it has none;
// - plain keys (J, K, `]`, `?`, Esc) always reach the page — `delivered`;
// - the rows this client adds on ⌘/Ctrl (⌘K, ⌘U, ⌘1–9, ⌘,) and their Alt
//   fallbacks are `unverified` until somebody presses them in a real Firefox
//   on winpc and the Mac: the headless e2e proves only that the page gets a
//   synthetic key, never that the browser or the OS gives up a real one.
//
// `reserved` is never printed as working; `unverified` is printed together
// with its fallback. A measured result goes into DELIVERY (and the doc) — the
// catalog also takes overrides, so a measurement needs no code elsewhere.

import { type HotkeyDelivery, type HotkeyPlatform } from '@cg/contracts/vm';

import { type DispatcherCommandId } from './keymap';

/** A printed combination: a dispatcher command, or the Alt fallback of one. */
export type DeliveryKey = DispatcherCommandId | 'next-unread:fallback' | 'quick-jump:fallback';

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
  'quick-jump:fallback',
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
    coach: 'cancelable',
    palette: 'unverified',
    cheatsheet: 'delivered',
    settings: 'unverified',
    close: 'delivered',
    'chat-next': 'delivered',
    'chat-previous': 'delivered',
    'fan-panel': 'delivered',
    'next-unread': 'unverified',
    'next-unread:fallback': 'unverified',
    'quick-jump': 'unverified',
    'quick-jump:fallback': 'unverified',
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
    palette: 'unverified',
    cheatsheet: 'delivered',
    settings: 'unverified',
    close: 'delivered',
    'chat-next': 'delivered',
    'chat-previous': 'delivered',
    'fan-panel': 'delivered',
    'next-unread': 'unverified',
    'next-unread:fallback': 'unverified',
    'quick-jump': 'unverified',
    'quick-jump:fallback': 'unverified',
  },
};

export type DeliveryOverrides = Readonly<Partial<Record<DeliveryKey, HotkeyDelivery>>>;

export function deliveryOf(key: DeliveryKey, platform: HotkeyPlatform, overrides: DeliveryOverrides = {}): HotkeyDelivery {
  return overrides[key] ?? DELIVERY[platform][key];
}

/** A combination the cheatsheet may print as working: the browser hands it over, or nobody has shown it does not. */
export function isUsable(delivery: HotkeyDelivery): boolean {
  return delivery !== 'reserved';
}
