// The keys of ChatGoose in ChatSpace (architecture.md §9.1 table; HK-001…
// HK-021, HK-031, HK-036…HK-042). Two sources, one table:
//
// - the vendored `@chatgoose/hotkeys` scheme (client `extension`): Reply, Fix,
//   Hi, Ping, Cancel on ⌘/Ctrl, the panels on ⌘⇧/Ctrl+Alt. Its engine owns the
//   matching of those (strict modifiers, the fresh-press guard, mac aliases);
// - the rows outside the scheme, which only this client has: the palette,
//   chat navigation, the fan panel, the cheatsheet, settings, Esc.
//
// Everything is matched by `KeyboardEvent.code`, the physical key, so the
// keys work on the Russian layout without switching it (HK-017). `?` is the
// one exception by nature: it is a character, so it is taken both from its
// physical US place (Shift+Slash) and by `key` (Shift+7 on ЙЦУКЕН).

import { HOTKEYS, detectHotkeyPlatform, hotkeyAriaShortcut, hotkeyLabel, type HotkeyAction, type HotkeyClient, type HotkeyDef, type HotkeyKeyEvent, type HotkeyPlatform } from '@chatgoose/hotkeys';

export type { HotkeyAction, HotkeyClient, HotkeyDef, HotkeyKeyEvent, HotkeyPlatform };

/** HK-031: Apple platforms get the ⌘ scheme, everything else (Windows, Linux) the Ctrl one. */
export function hotkeyPlatformOf(platform: string | null | undefined): HotkeyPlatform {
  return detectHotkeyPlatform(platform);
}

/** What the early dispatcher itself runs; the rest of the catalog is local to our surfaces. */
export const DISPATCHER_COMMAND_IDS = [
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
  'quick-jump',
  // R20 P11b: «Заметки» on Fansly — the `fansly` client's row; a client that does not serve it keeps the letter reserved.
  'notes',
] as const;
export type DispatcherCommandId = (typeof DISPATCHER_COMMAND_IDS)[number];

/** A key outside the vendored scheme. `primary` is ⌘ on macOS and Ctrl elsewhere. */
export interface ExtraKeyDef {
  readonly command: Exclude<DispatcherCommandId, HotkeyAction>;
  /** Physical keys; several for the nine chat slots. */
  readonly codes: readonly string[];
  readonly mods: 'primary' | 'alt' | 'none' | 'shift';
  /** The same command on a combination the browser surely hands over (Alt+U for ⌘U). */
  readonly fallback: boolean;
  /** What the cheatsheet prints for the key itself: «K», «1–9», «]». */
  readonly keycap: string;
  /** `aria-keyshortcuts` name of the key. */
  readonly ariaKey: string;
}

const DIGITS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'] as const;

/**
 * HK-016, extended: the letters these rows take stay out of the vendored
 * scheme for good (`FORBIDDEN_CODES.text` names K and U as navigation), and
 * none of them is a TipTap mark of ChatSpace's composer (B, I, E, Shift+S).
 */
export const EXTRA_KEYS: readonly ExtraKeyDef[] = [
  { command: 'palette', codes: ['KeyK'], mods: 'primary', fallback: false, keycap: 'K', ariaKey: 'K' },
  { command: 'next-unread', codes: ['KeyU'], mods: 'primary', fallback: false, keycap: 'U', ariaKey: 'U' },
  { command: 'next-unread', codes: ['KeyU'], mods: 'alt', fallback: true, keycap: 'U', ariaKey: 'U' },
  // Decision X45: ⌘/Ctrl+1–9 are Firefox's again (its tabs); the chat slots are Alt+1–9 alone, the main key now.
  { command: 'quick-jump', codes: DIGITS, mods: 'alt', fallback: false, keycap: '1–9', ariaKey: '1' },
  { command: 'settings', codes: ['Comma'], mods: 'primary', fallback: false, keycap: ',', ariaKey: ',' },
  { command: 'chat-next', codes: ['KeyJ'], mods: 'none', fallback: false, keycap: 'J', ariaKey: 'J' },
  { command: 'chat-previous', codes: ['KeyK'], mods: 'none', fallback: false, keycap: 'K', ariaKey: 'K' },
  { command: 'fan-panel', codes: ['BracketRight'], mods: 'none', fallback: false, keycap: ']', ariaKey: ']' },
  { command: 'cheatsheet', codes: ['Slash'], mods: 'shift', fallback: false, keycap: '?', ariaKey: '?' },
  { command: 'close', codes: ['Escape'], mods: 'none', fallback: false, keycap: 'Esc', ariaKey: 'Escape' },
];

/**
 * ChatSpace's own keys (0.172.0: TipTap marks and Enter in the composer, the
 * translator on the composer root, the layout's global listener — research
 * `client-internals.md` §5). HK-016 for this host: a key here is either one
 * we take on purpose, before ChatSpace sees it (`ours`), one we take only
 * while something of ours is open (`shared`), or never ours (`theirs`). A new
 * row of ours must not land on a `theirs` key; hotkeys.test.ts holds that.
 */
export const CHATSPACE_KEYS: readonly {
  readonly what: string;
  readonly code: string;
  /** `mod` — ⌘ on macOS, Ctrl elsewhere (TipTap's Mod). */
  readonly mods: readonly ('mod' | 'ctrl' | 'alt' | 'shift')[];
  readonly status: 'ours' | 'shared' | 'theirs';
}[] = [
  { what: 'TipTap inline code', code: 'KeyE', mods: ['mod'], status: 'ours' },
  { what: 'TipTap italic', code: 'KeyI', mods: ['mod'], status: 'ours' },
  { what: 'TipTap strikethrough (Recap of the mac scheme)', code: 'KeyS', mods: ['mod', 'shift'], status: 'ours' },
  { what: 'TipTap bold', code: 'KeyB', mods: ['mod'], status: 'theirs' },
  { what: 'send', code: 'Enter', mods: [], status: 'theirs' },
  { what: 'hard break', code: 'Enter', mods: ['shift'], status: 'theirs' },
  { what: 'hard break', code: 'Enter', mods: ['mod'], status: 'theirs' },
  { what: 'translator on / off', code: 'KeyS', mods: ['alt'], status: 'theirs' },
  { what: 'translator, second key', code: 'KeyA', mods: ['alt'], status: 'theirs' },
  { what: 'next chat tab', code: 'Tab', mods: ['ctrl'], status: 'theirs' },
  { what: 'previous chat tab', code: 'Tab', mods: ['ctrl', 'shift'], status: 'theirs' },
  { what: 'templates', code: 'Slash', mods: [], status: 'theirs' },
  { what: 'templates, focus', code: 'Tab', mods: [], status: 'theirs' },
  { what: 'close the chat tab', code: 'Escape', mods: [], status: 'shared' },
];

export interface ExtraKeyMatch {
  readonly def: ExtraKeyDef;
  /** 1–9 for a chat slot. */
  readonly slot: number | null;
}

/**
 * HK-014: strict modifiers — an extra modifier is somebody else's
 * combination. Ctrl+Shift and Alt+Shift never carry a key of ours (HK-015:
 * they switch the input language on the team's Windows machines).
 */
export function matchExtraKey(event: HotkeyKeyEvent, platform: HotkeyPlatform): ExtraKeyMatch | null {
  const mac = platform === 'mac';
  const primary = mac ? event.metaKey : event.ctrlKey;
  const otherPrimary = mac ? event.ctrlKey : event.metaKey;
  if (otherPrimary) return null;
  for (const def of EXTRA_KEYS) {
    const at = def.codes.indexOf(event.code);
    if (at === -1) continue;
    const fits =
      def.mods === 'primary'
        ? primary && !event.altKey && !event.shiftKey
        : def.mods === 'alt'
          ? event.altKey && !primary && !event.shiftKey
          : def.mods === 'shift'
            ? event.shiftKey && !primary && !event.altKey
            : !primary && !event.altKey && !event.shiftKey;
    if (fits) return { def, slot: def.codes.length > 1 ? at + 1 : null };
  }
  // «?» typed where the layout has it (Shift+7 on ЙЦУКЕН): the same key to a person.
  if (event.key === '?' && !primary && !event.altKey) {
    const def = EXTRA_KEYS.find((item) => item.command === 'cheatsheet');
    if (def !== undefined) return { def, slot: null };
  }
  return null;
}

/** Keys that never start anything by themselves. */
const MODIFIER_KEYS = new Set(['Meta', 'OS', 'Control', 'Shift', 'Alt', 'AltGraph', 'CapsLock', 'Fn', 'NumLock', 'ScrollLock', 'Hyper', 'Super', 'Symbol', 'SymbolLock']);

export function isModifierKey(event: Pick<HotkeyKeyEvent, 'key'>): boolean {
  return MODIFIER_KEYS.has(event.key);
}

/**
 * The modifier of the chat slots itself — Alt (⌥ on macOS), never AltGr: its lone hold opens the quick jump, whose
 * digits are Alt+1–9 (decision X45; until then ⌘/Ctrl, now Firefox's tab keys again).
 */
export function isJumpModifierKey(event: Pick<HotkeyKeyEvent, 'key' | 'code'>): boolean {
  return event.key === 'Alt' || event.code === 'AltLeft' || event.code === 'AltRight';
}

/**
 * A key ChatSpace's own global listener would look at (`lte`: Ctrl, Alt or
 * Meta held, or a named key — Escape, Enter, Tab, the arrows); plain typing
 * is not one (client-internals §5.1).
 */
export function isComboLike(event: Pick<HotkeyKeyEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>): boolean {
  return event.ctrlKey || event.altKey || event.metaKey || event.key.length > 1;
}

// ── printed forms ──────────────────────────────────────────────────────────

export interface KeyPrint {
  readonly display: string;
  readonly aria: string;
}

const PRIMARY = { mac: { display: '⌘', aria: 'Meta' }, win: { display: 'Ctrl+', aria: 'Control' } } as const;
const ALT = { mac: { display: '⌥', aria: 'Alt' }, win: { display: 'Alt+', aria: 'Alt' } } as const;

export function printExtraKey(def: ExtraKeyDef, platform: HotkeyPlatform): KeyPrint {
  if (def.mods === 'primary') return { display: `${PRIMARY[platform].display}${def.keycap}`, aria: `${PRIMARY[platform].aria}+${def.ariaKey}` };
  if (def.mods === 'alt') return { display: `${ALT[platform].display}${def.keycap}`, aria: `${ALT[platform].aria}+${def.ariaKey}` };
  return { display: def.keycap, aria: def.ariaKey };
}

export function printSchemeKey(action: HotkeyAction, platform: HotkeyPlatform): KeyPrint {
  return { display: hotkeyLabel(action, platform), aria: hotkeyAriaShortcut(action, platform) };
}

/** The scheme rows this client has (`clients` includes `extension`). */
export function schemeActions(): readonly HotkeyDef[] {
  return HOTKEYS.filter((def) => def.clients.includes('extension'));
}
