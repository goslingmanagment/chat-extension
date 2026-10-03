// core/domain — pure models and rules (architecture.md §4). No DOM, no
// browser.*, no fetch, no Preact, no SDK: the package compiles against the ES
// lib only, so a DOM global here is a type error, and lint bans the rest.
//
// R10–R12, R17, R18 fill this in. R00 leaves the operation limits (§7, А3) and
// the vendored hotkey scheme wiring as the first real exports.

import { HOTKEY_SCHEME_VERSION } from '@chatgoose/hotkeys';

export * from './text';

/** Operation limits (D-11): one per chat across the extension, up to three per tab, no queue. */
export const OP_LIMITS = { perChat: 1, perTab: 3 } as const;

/** Hotkey scheme shared with the Fansly extension and the desktop (vendored `@chatgoose/hotkeys`). */
export const hotkeySchemeVersion: number = HOTKEY_SCHEME_VERSION;

export * from './errors/hub-map';
