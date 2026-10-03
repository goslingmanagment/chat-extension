// The keys as pure data and rules (architecture.md §9.1): the table over the
// vendored scheme, the one resolver, the ownership policy, the catalog, the
// delivery table and the cheatsheet. Test titles carry the parity rows.

import { CATALOG_ACTION_IDS, DOCK_ACTION_IDS, UI_ACTION_TYPES, type HotkeyDelivery } from '@cg/contracts';
import { FORBIDDEN_CODES, HOTKEYS, HOTKEY_SCHEME_VERSION, hotkeysForClient } from '@chatgoose/hotkeys';
import { describe, expect, it } from 'vitest';

import { EN, RU } from '../i18n';
import {
  COVERING_OVERLAYS,
  DELIVERY,
  DELIVERY_KEYS,
  DISPATCHER_COMMAND_IDS,
  EXTRA_KEYS,
  PREVIEW_COMMANDS,
  cheatsheetGroups,
  cheatsheetView,
  createActionCatalog,
  createKeyResolver,
  decideKey,
  decideUnmatched,
  hotkeyPlatformOf,
  hotkeyReferenceRows,
  isComboLike,
  isOutsideScheme,
  matchExtraKey,
  printableHotkey,
  type FocusKind,
  type HotkeyKeyEvent,
  type HotkeyPlatform,
  type KeyContext,
  type KeyDecision,
  type KeyVerdict,
  type OverlayKind,
} from './index';

type Mods = Partial<Pick<HotkeyKeyEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'repeat' | 'isComposing'>> & { key?: string; keyCode?: number };

/** A key event by its physical key; `key` defaults to the Latin keycap. */
const ev = (code: string, mods: Mods = {}): HotkeyKeyEvent & { keyCode?: number } => ({
  code,
  key: mods.key ?? (code.startsWith('Key') ? code.slice(3).toLowerCase() : code.startsWith('Digit') ? code.slice(5) : code),
  metaKey: mods.metaKey ?? false,
  ctrlKey: mods.ctrlKey ?? false,
  altKey: mods.altKey ?? false,
  shiftKey: mods.shiftKey ?? false,
  repeat: mods.repeat ?? false,
  isComposing: mods.isComposing ?? false,
  ...(mods.keyCode === undefined ? {} : { keyCode: mods.keyCode }),
});

const META = ev('MetaLeft', { key: 'Meta', metaKey: true });
const CTRL = ev('ControlLeft', { key: 'Control', ctrlKey: true });

/** Presses the primary modifier freshly, then the key under it: what a person does. */
function press(platform: HotkeyPlatform, code: string, mods: Mods = {}): KeyVerdict | null {
  const resolver = createKeyResolver(platform);
  resolver.keydown(platform === 'mac' ? META : CTRL);
  return resolver.keydown(ev(code, platform === 'mac' ? { metaKey: true, ...mods } : { ctrlKey: true, ...mods }));
}

const command = (verdict: KeyVerdict | null): string | null => (verdict !== null && verdict.kind === 'command' ? verdict.command : null);

describe('the vendored scheme through the tab resolver', () => {
  it('[HK-001] one scheme, version 1: text keys on ⌘/Ctrl, panels on ⌘⇧/Ctrl+Alt, and this client has all twelve', () => {
    expect(HOTKEY_SCHEME_VERSION).toBe(1);
    expect(hotkeysForClient('extension').map((def) => def.action)).toEqual(['reply', 'fix', 'hi', 'ping', 'cancel', 'help', 'recap', 'tone', 'review', 'split', 'spenders', 'coach']);
    for (const def of HOTKEYS) {
      const mac = press('mac', def.code, def.level === 'panel' ? { shiftKey: true } : {});
      const win = press('win', def.code, def.level === 'panel' ? { altKey: true } : {});
      expect([def.action, command(mac), command(win)]).toEqual([def.action, def.action, def.action]);
    }
  });

  it.each([
    ['[HK-002] Reply ⌘E / Ctrl+E (У)', 'reply', 'KeyE', 'у', false],
    ['[HK-003] Fix ⌘I / Ctrl+I (Ш)', 'fix', 'KeyI', 'ш', false],
    ['[HK-004] Hi ⌘G / Ctrl+G (П)', 'hi', 'KeyG', 'п', false],
    ['[HK-005] Ping ⌘P / Ctrl+P (З)', 'ping', 'KeyP', 'з', false],
    ['[HK-006] Cancel ⌘. / Ctrl+. (Ю)', 'cancel', 'Period', 'ю', false],
    ['[HK-008] Recap ⌘⇧S / Ctrl+Alt+S (Ы)', 'recap', 'KeyS', 'ы', true],
    ['[HK-009] Tone ⌘⇧O / Ctrl+Alt+O (Щ)', 'tone', 'KeyO', 'щ', true],
    ['[HK-010] Review ⌘⇧B / Ctrl+Alt+B (И)', 'review', 'KeyB', 'и', true],
    ['[HK-011] Split ⌘⇧L / Ctrl+Alt+L (Д)', 'split', 'KeyL', 'д', true],
    ['[HK-012] Spenders ⌘⇧M / Ctrl+Alt+M (Ь)', 'spenders', 'KeyM', 'ь', true],
    ['[HK-013] Coach ⌘⇧C / Ctrl+Alt+C (С)', 'coach', 'KeyC', 'с', true],
  ] as const)('%s — the same command on the Latin and on the Russian layout', (_title, action, code, ruKey, panel) => {
    for (const key of [undefined, ruKey]) {
      const mods = key === undefined ? {} : { key };
      expect(command(press('mac', code, panel ? { shiftKey: true, ...mods } : mods))).toBe(action);
      expect(command(press('win', code, panel ? { altKey: true, ...mods } : mods))).toBe(action);
    }
  });

  it('[HK-006] Cancel has no fresh-press guard: ⌘E, then . under the same ⌘ still cancels the run it started', () => {
    const resolver = createKeyResolver('mac');
    resolver.keydown(META);
    expect(command(resolver.keydown(ev('KeyE', { metaKey: true })))).toBe('reply');
    expect(command(resolver.keydown(ev('Period', { metaKey: true })))).toBe('cancel');
  });

  it('[HK-014] strict modifiers: an extra modifier makes it somebody else\'s combination', () => {
    expect(press('mac', 'KeyE', { altKey: true })).toBeNull();
    expect(press('mac', 'KeyE', { ctrlKey: true })).toBeNull();
    expect(press('win', 'KeyE', { metaKey: true })).toBeNull();
    expect(press('win', 'KeyS', { altKey: true, metaKey: true })).toBeNull();
    // The rows outside the scheme are just as strict.
    expect(press('mac', 'KeyK', { altKey: true })).toBeNull();
    expect(press('win', 'KeyU', { shiftKey: true })).toBeNull();
    expect(createKeyResolver('win').keydown(ev('KeyJ', { shiftKey: true }))).toBeNull();
  });

  it('[HK-015] Ctrl+Shift and Alt+Shift carry nothing on Windows: they switch the input language', () => {
    for (const def of HOTKEYS) expect(press('win', def.code, { shiftKey: true })).toBeNull();
    for (const def of EXTRA_KEYS) {
      for (const code of def.codes) {
        expect(press('win', code, { shiftKey: true })).toBeNull();
        expect(createKeyResolver('win').keydown(ev(code, { altKey: true, shiftKey: true }))).toBeNull();
      }
    }
  });

  it('[HK-016] no key of ours sits on a forbidden code; K and U stay navigation, TipTap\'s marks are intercepted on purpose only', () => {
    for (const def of HOTKEYS) expect(Object.keys(FORBIDDEN_CODES[def.level])).not.toContain(def.code);
    // The rows on ⌘/Ctrl outside the scheme take only letters the scheme reserved for navigation, digits and the comma.
    const primaryExtras = EXTRA_KEYS.filter((def) => def.mods === 'primary').flatMap((def) => def.codes);
    expect(primaryExtras.filter((code) => code.startsWith('Key'))).toEqual(['KeyK', 'KeyU']);
    expect(FORBIDDEN_CODES.text['KeyK']).toMatch(/navigation/);
    expect(FORBIDDEN_CODES.text['KeyU']).toMatch(/navigation/);
    // …and never collide with a text-level key of the scheme.
    const textCodes = HOTKEYS.filter((def) => def.level === 'text').map((def) => def.code);
    for (const code of primaryExtras) expect(textCodes).not.toContain(code);
    // ChatSpace's composer marks: bold (B) is nobody's on ⌘/Ctrl alone; italic (I), inline code (E) and
    // strikethrough (⇧S) are Fix, Reply and Recap — taken before TipTap sees them (§9.1 table).
    expect(press('mac', 'KeyB')).toBeNull();
    expect(press('win', 'KeyB')).toBeNull();
  });

  it('[HK-017] the physical key decides: ⌘+«у» on ЙЦУКЕН is Reply, a Latin «e» on another physical key is not', () => {
    expect(command(press('mac', 'KeyE', { key: 'у' }))).toBe('reply');
    expect(command(press('win', 'KeyK', { key: 'л' }))).toBe('palette');
    expect(command(createKeyResolver('win').keydown(ev('KeyJ', { key: 'о' })))).toBe('chat-next');
    // Dvorak-like: the letter «e» typed from the physical D key is not Reply.
    expect(press('mac', 'KeyD', { key: 'e' })).toBeNull();
  });

  it('[HK-018] fresh press: a text key fires only as the first key under a freshly pressed ⌘/Ctrl', () => {
    // Windows: Ctrl+Shift (language switch) → Shift up → still holding Ctrl → E.
    const win = createKeyResolver('win');
    win.keydown(CTRL);
    win.keydown(ev('ShiftLeft', { key: 'Shift', ctrlKey: true, shiftKey: true }));
    win.keyup(ev('ShiftLeft', { key: 'Shift', ctrlKey: true }));
    expect(win.keydown(ev('KeyE', { ctrlKey: true }))).toEqual({ kind: 'swallow', reason: 'rollover' });
    // macOS: ⌘G, then E under the same ⌘ needs ⌘ pressed again.
    const mac = createKeyResolver('mac');
    mac.keydown(META);
    expect(command(mac.keydown(ev('KeyG', { metaKey: true })))).toBe('hi');
    expect(mac.keydown(ev('KeyE', { metaKey: true }))).toEqual({ kind: 'swallow', reason: 'rollover' });
    mac.keyup(ev('MetaLeft', { key: 'Meta' }));
    mac.keydown(META);
    expect(command(mac.keydown(ev('KeyE', { metaKey: true })))).toBe('reply');
    // A modifier already held when the page got the focus is an unknown state: nothing fires.
    expect(createKeyResolver('mac').keydown(ev('KeyE', { metaKey: true }))).toEqual({ kind: 'swallow', reason: 'rollover' });
    // Panel keys are not guarded.
    expect(command(createKeyResolver('mac').keydown(ev('KeyS', { metaKey: true, shiftKey: true })))).toBe('recap');
  });

  it('[HK-019] auto-repeat is reported as a repeat, for the scheme and for the rows outside it', () => {
    const resolver = createKeyResolver('mac');
    resolver.keydown(META);
    expect(resolver.keydown(ev('KeyE', { metaKey: true }))).toMatchObject({ command: 'reply', repeat: false });
    expect(resolver.keydown(ev('KeyE', { metaKey: true, repeat: true }))).toMatchObject({ command: 'reply', repeat: true });
    expect(resolver.keydown(ev('KeyJ', { repeat: true }))).toMatchObject({ command: 'chat-next', repeat: true });
  });

  it('[HK-020] nothing fires during an IME composition, by isComposing or by keyCode 229', () => {
    expect(press('mac', 'KeyE', { isComposing: true })).toBeNull();
    expect(createKeyResolver('win').keydown(ev('KeyJ', { isComposing: true }))).toBeNull();
    expect(createKeyResolver('win').keydown(ev('KeyJ', { keyCode: 229 }))).toBeNull();
    expect(createKeyResolver('win').keydown(ev('Escape', { key: 'Process' }))).toBeNull();
  });

  it('[HK-021] mac aliases: ⌘⇧E/I/G are Reply/Fix/Hi, ⌘⇧X is Cancel, the retired ⌘⇧D and ⌘⇧F are swallowed', () => {
    expect(command(press('mac', 'KeyE', { shiftKey: true }))).toBe('reply');
    expect(command(press('mac', 'KeyI', { shiftKey: true }))).toBe('fix');
    expect(command(press('mac', 'KeyG', { shiftKey: true }))).toBe('hi');
    expect(command(press('mac', 'KeyX', { shiftKey: true }))).toBe('cancel');
    expect(press('mac', 'KeyD', { shiftKey: true })).toEqual({ kind: 'swallow', reason: 'legacy' });
    expect(press('mac', 'KeyF', { shiftKey: true })).toEqual({ kind: 'swallow', reason: 'legacy' });
    // Windows has no such habits.
    expect(press('win', 'KeyD', { shiftKey: true })).toBeNull();
  });

  it('[HK-022] reset (window blur, a hidden tab) forgets a held modifier', () => {
    const resolver = createKeyResolver('mac');
    resolver.keydown(META);
    expect(resolver.primaryHeldAlone()).toBe(true);
    resolver.reset();
    expect(resolver.primaryHeldAlone()).toBe(false);
    // The keyup was lost while the window was away: E under the still-held ⌘ is not a fresh press.
    expect(resolver.keydown(ev('KeyE', { metaKey: true }))).toEqual({ kind: 'swallow', reason: 'rollover' });
  });

  it('[HK-031] Apple platforms get the ⌘ scheme, Windows and Linux the Ctrl one', () => {
    expect(hotkeyPlatformOf('MacIntel')).toBe('mac');
    expect(hotkeyPlatformOf('macOS')).toBe('mac');
    expect(hotkeyPlatformOf('Win32')).toBe('win');
    expect(hotkeyPlatformOf('Linux x86_64')).toBe('win');
    expect(hotkeyPlatformOf(null)).toBe('win');
  });
});

describe('rows outside the scheme', () => {
  it('[HK-036] ⌘K / Ctrl+K is the palette', () => {
    expect(press('mac', 'KeyK')).toMatchObject({ kind: 'command', command: 'palette', scheme: false, plain: false });
    expect(command(press('win', 'KeyK'))).toBe('palette');
  });

  it('[HK-037] J / K, ⌘U with Alt+U, ⌘1–9 with Alt+1–9', () => {
    const resolver = createKeyResolver('win');
    expect(resolver.keydown(ev('KeyJ'))).toMatchObject({ command: 'chat-next', plain: true });
    expect(resolver.keydown(ev('KeyK'))).toMatchObject({ command: 'chat-previous', plain: true });
    expect(press('win', 'KeyU')).toMatchObject({ command: 'next-unread', fallback: false, plain: false });
    expect(createKeyResolver('win').keydown(ev('KeyU', { altKey: true }))).toMatchObject({ command: 'next-unread', fallback: true });
    for (let n = 1; n <= 9; n += 1) {
      expect(press('mac', `Digit${n}`)).toMatchObject({ command: 'quick-jump', slot: n, fallback: false });
      expect(createKeyResolver('mac').keydown(ev(`Digit${n}`, { altKey: true }))).toMatchObject({ command: 'quick-jump', slot: n, fallback: true });
    }
    expect(press('mac', 'Digit0')).toBeNull();
  });

  it('[HK-039] ] is the fan panel, [ is nobody\'s (NEG-CHATSPACE-UI: ChatSpace owns its chat list)', () => {
    expect(createKeyResolver('mac').keydown(ev('BracketRight', { key: ']' }))).toMatchObject({ command: 'fan-panel', plain: true });
    expect(createKeyResolver('mac').keydown(ev('BracketLeft', { key: '[' }))).toBeNull();
  });

  it('[HK-041] ⌘, / Ctrl+, opens the settings', () => {
    expect(command(press('mac', 'Comma', { key: ',' }))).toBe('settings');
    expect(command(press('win', 'Comma', { key: 'б' }))).toBe('settings');
  });

  it('[HK-034] ? is the cheatsheet from its physical place and from where a layout types it; Esc closes', () => {
    expect(matchExtraKey(ev('Slash', { shiftKey: true, key: '?' }), 'win')?.def.command).toBe('cheatsheet');
    // ЙЦУКЕН: Shift+Slash types «,», the character «?» is on Shift+7 — both are the person's «?».
    expect(matchExtraKey(ev('Slash', { shiftKey: true, key: ',' }), 'win')?.def.command).toBe('cheatsheet');
    expect(matchExtraKey(ev('Digit7', { shiftKey: true, key: '?' }), 'win')?.def.command).toBe('cheatsheet');
    expect(matchExtraKey(ev('Slash', { key: '/' }), 'win')).toBeNull();
    expect(matchExtraKey(ev('Escape'), 'mac')?.def.command).toBe('close');
    expect(matchExtraKey(ev('Escape', { shiftKey: true }), 'mac')).toBeNull();
  });

  it('[NEW-07] the resolver knows when ⌘/Ctrl is held alone', () => {
    const resolver = createKeyResolver('win');
    expect(resolver.primaryHeldAlone()).toBe(false);
    resolver.keydown(CTRL);
    expect(resolver.primaryHeldAlone()).toBe(true);
    resolver.keydown(ev('Digit3', { ctrlKey: true }));
    expect(resolver.primaryHeldAlone()).toBe(false);
    resolver.keyup(ev('ControlLeft', { key: 'Control' }));
    resolver.keydown(ev('ControlLeft', { key: 'Control', ctrlKey: true, shiftKey: true }));
    expect(resolver.primaryHeldAlone()).toBe(false);
  });

  it('a key ChatSpace\'s global listener would look at: a modifier held or a named key; plain typing is not one', () => {
    expect(isComboLike(ev('Escape'))).toBe(true);
    expect(isComboLike(ev('Enter'))).toBe(true);
    expect(isComboLike(ev('KeyC', { ctrlKey: true }))).toBe(true);
    expect(isComboLike(ev('KeyJ'))).toBe(false);
    expect(isComboLike(ev('Space', { key: ' ' }))).toBe(false);
  });
});

// ── policy ──

const ctx = (patch: Partial<KeyContext> = {}): KeyContext => ({ composing: false, nativeModal: false, focus: 'page', route: 'chat', overlays: [], dockSheet: false, combo: true, ...patch });
const cmd = (commandId: (typeof DISPATCHER_COMMAND_IDS)[number], patch: Partial<Extract<KeyVerdict, { kind: 'command' }>> = {}): KeyVerdict => ({
  kind: 'command',
  command: commandId,
  slot: null,
  repeat: false,
  scheme: !EXTRA_KEYS.some((def) => def.command === commandId),
  plain: EXTRA_KEYS.some((def) => def.command === commandId && (def.mods === 'none' || def.mods === 'shift')),
  fallback: false,
  ...patch,
});
const ran = (decision: KeyDecision): string | null => (decision.act === 'claim' && decision.run !== null ? `${decision.run.id}@${decision.run.target}` : null);
const AI = ['reply', 'fix', 'hi', 'ping', 'recap', 'review', 'coach', 'tone', 'split'] as const;
const FOCUSES: readonly FocusKind[] = ['ours-field', 'ours', 'composer', 'field', 'page'];

describe('whose key is it', () => {
  it('[HK-026] in a chat every combination of ours is claimed and runs in the dock; outside a chat only the global ones', () => {
    for (const id of AI) {
      expect(ran(decideKey(cmd(id), ctx()))).toBe(`${id}@dock`);
      // Outside a chat the browser keeps its own shortcut on the same keys.
      expect(decideKey(cmd(id), ctx({ route: 'other' }))).toEqual({ act: 'pass' });
      expect(decideKey(cmd(id), ctx({ route: 'account' }))).toEqual({ act: 'pass' });
    }
    for (const id of ['spenders', 'palette', 'settings', 'cheatsheet'] as const) {
      expect(ran(decideKey(cmd(id), ctx({ route: 'other' })))).toBe(`${id}@global`);
      expect(ran(decideKey(cmd(id), ctx()))).toBe(`${id}@global`);
    }
    // A swallowed habit or a roll-over is ours in a chat (no find, print or page info), nobody's outside it.
    expect(decideKey({ kind: 'swallow', reason: 'rollover' }, ctx())).toEqual({ act: 'claim', run: null, refusal: null, command: null });
    expect(decideKey({ kind: 'swallow', reason: 'legacy' }, ctx({ route: 'other' }))).toEqual({ act: 'pass' });
  });

  it('[HK-026] ⌘⇧H is claimed in a chat and answers «пока убран»; it never runs (NEG-HELP)', () => {
    expect(decideKey(cmd('help'), ctx())).toEqual({ act: 'claim', run: null, refusal: 'help-removed', command: 'help' });
    expect(decideKey(cmd('help'), ctx({ route: 'other' }))).toEqual({ act: 'pass' });
    for (const focus of FOCUSES) expect(ran(decideKey(cmd('help'), ctx({ focus })))).toBeNull();
  });

  it('[HK-019] an auto-repeated key stays ours and runs nothing again', () => {
    expect(decideKey(cmd('reply', { repeat: true }), ctx())).toEqual({ act: 'claim', run: null, refusal: null, command: 'reply' });
    expect(decideKey(cmd('help', { repeat: true }), ctx())).toEqual({ act: 'claim', run: null, refusal: null, command: 'help' });
    expect(decideKey(cmd('chat-next', { repeat: true }), ctx())).toEqual({ act: 'claim', run: null, refusal: null, command: 'chat-next' });
  });

  it('[HK-027] under the cheatsheet, a board, the palette or a dialog of ours only the cheatsheet, the board and Cancel work', () => {
    for (const overlay of COVERING_OVERLAYS) {
      const under = ctx({ overlays: [overlay] });
      for (const id of AI) expect(decideKey(cmd(id), under)).toEqual({ act: 'claim', run: null, refusal: 'overlay-open', command: id });
      expect(ran(decideKey(cmd('cheatsheet'), under))).toBe('cheatsheet@global');
      expect(ran(decideKey(cmd('spenders'), under))).toBe('spenders@global');
      expect(ran(decideKey(cmd('cancel'), under))).toBe('cancel@dock');
      expect(decideKey(cmd('next-unread'), under)).toMatchObject({ act: 'claim', run: null, refusal: 'overlay-open' });
      if (overlay !== 'palette') expect(decideKey(cmd('palette'), under)).toMatchObject({ act: 'claim', run: null, refusal: 'overlay-open' });
    }
    // Its own key still toggles the palette shut.
    expect(ran(decideKey(cmd('palette'), ctx({ overlays: ['palette'] })))).toBe('palette@global');
    // A board on a page without an open chat is still our context: the key is ours, with the reason.
    expect(decideKey(cmd('reply'), ctx({ route: 'other', overlays: ['spenders'] }))).toMatchObject({ act: 'claim', refusal: 'overlay-open' });
  });

  it('[HK-027] a side panel covers nothing: the dock\'s keys and chat navigation work next to it', () => {
    for (const overlay of ['fan-panel', 'coach'] as const) {
      const next = ctx({ overlays: [overlay] });
      expect(ran(decideKey(cmd('reply'), next))).toBe('reply@dock');
      expect(ran(decideKey(cmd('chat-next'), next))).toBe('chat-next@global');
      expect(ran(decideKey(cmd('fan-panel'), next))).toBe('fan-panel@dock');
      expect(ran(decideKey(cmd('next-unread'), next))).toBe('next-unread@global');
    }
  });

  it('[HK-028] combinations work from ChatSpace\'s message field; J, K, ], ? only outside any field', () => {
    for (const id of AI) expect(ran(decideKey(cmd(id), ctx({ focus: 'composer' })))).toBe(`${id}@dock`);
    for (const id of AI) expect(ran(decideKey(cmd(id), ctx({ focus: 'ours-field' })))).toBe(`${id}@dock`);
    for (const id of ['chat-next', 'chat-previous', 'fan-panel', 'cheatsheet'] as const) {
      for (const focus of ['composer', 'field', 'ours-field'] as const) expect(decideKey(cmd(id), ctx({ focus, combo: false }))).toEqual({ act: 'pass' });
      expect(ran(decideKey(cmd(id), ctx({ focus: 'page' })))).not.toBeNull();
      expect(ran(decideKey(cmd(id), ctx({ focus: 'ours' })))).not.toBeNull();
    }
    // An arbitrary field of the site is not ChatSpace's composer: the AI key is ours there, and runs nothing.
    expect(decideKey(cmd('reply'), ctx({ focus: 'field' }))).toEqual({ act: 'claim', run: null, refusal: null, command: 'reply' });
  });

  it('[HK-037] chat navigation needs the chat list on screen and no field under the cursor; the browser keeps ⌘U and ⌘1–9 while a person types', () => {
    for (const id of ['chat-next', 'chat-previous'] as const) {
      expect(ran(decideKey(cmd(id), ctx({ route: 'account' })))).toBe(`${id}@global`);
      expect(decideKey(cmd(id), ctx({ route: 'other' }))).toEqual({ act: 'pass' });
    }
    for (const verdict of [cmd('next-unread'), cmd('next-unread', { fallback: true }), cmd('quick-jump', { slot: 4 }), cmd('quick-jump', { slot: 4, fallback: true })]) {
      expect(ran(decideKey(verdict, ctx()))).not.toBeNull();
      expect(ran(decideKey(verdict, ctx({ route: 'account' })))).not.toBeNull();
      expect(decideKey(verdict, ctx({ route: 'other' }))).toEqual({ act: 'pass' });
      // «вне composer»: in the message field and in any field of the site the key is not ours at all.
      expect(decideKey(verdict, ctx({ focus: 'composer' }))).toEqual({ act: 'pass' });
      expect(decideKey(verdict, ctx({ focus: 'field' }))).toEqual({ act: 'pass' });
      // In a field of our own it is kept from ChatSpace and left to that field.
      expect(decideKey(verdict, ctx({ focus: 'ours-field' }))).toEqual({ act: 'isolate', otherwise: null });
    }
    expect(decideKey(cmd('quick-jump', { slot: 7 }), ctx())).toMatchObject({ run: { id: 'quick-jump', slot: 7, target: 'global' } });
  });

  it('[HK-039] ] toggles the fan panel only in an open chat', () => {
    expect(ran(decideKey(cmd('fan-panel'), ctx()))).toBe('fan-panel@dock');
    expect(decideKey(cmd('fan-panel'), ctx({ route: 'account' }))).toEqual({ act: 'pass' });
  });

  it('[HK-029] Esc closes the top of ours and is nobody\'s when nothing of ours is open', () => {
    // Nothing of ours open: ChatSpace's own Esc (it closes the chat tab) is not touched.
    expect(decideKey(cmd('close'), ctx())).toEqual({ act: 'pass' });
    expect(decideKey(cmd('close'), ctx({ focus: 'composer' }))).toEqual({ act: 'pass' });
    // Ours is open, the focus is in ChatSpace: the key is ours and closes the top.
    expect(ran(decideKey(cmd('close'), ctx({ overlays: ['spenders', 'preview'], focus: 'composer' })))).toBe('close@global');
    expect(ran(decideKey(cmd('close'), ctx({ dockSheet: true, focus: 'composer' })))).toBe('close@global');
    // The focus is inside our UI: its own Esc first (a menu, a search), the window only if nothing took it.
    expect(decideKey(cmd('close'), ctx({ overlays: ['palette'], focus: 'ours-field' }))).toEqual({ act: 'isolate', otherwise: { id: 'close', slot: null, target: 'global' } });
    expect(decideKey(cmd('close'), ctx({ focus: 'ours' }))).toEqual({ act: 'isolate', otherwise: null });
  });

  it('[HK-029] a native modal window and IME come first: their Esc and their letters are not touched', () => {
    const modal = ctx({ nativeModal: true, overlays: ['spenders'] });
    expect(decideKey(cmd('close'), modal)).toEqual({ act: 'pass' });
    for (const id of ['chat-next', 'chat-previous', 'fan-panel', 'cheatsheet', 'next-unread', 'palette'] as const) expect(decideKey(cmd(id), ctx({ nativeModal: true }))).toEqual({ act: 'pass' });
    // Our own combinations stay ours in a chat (no print dialog over their modal) and run nothing.
    expect(decideKey(cmd('ping'), ctx({ nativeModal: true }))).toEqual({ act: 'claim', run: null, refusal: 'overlay-open', command: 'ping' });
    for (const id of DISPATCHER_COMMAND_IDS) expect(decideKey(cmd(id), ctx({ composing: true }))).toEqual({ act: 'pass' });
    expect(decideUnmatched({ composing: true, focus: 'ours', combo: true })).toEqual({ act: 'pass' });
  });

  it('[HK-042] in a preview ⌘E/I/G/P generate there, ⌘. cancels there, the rest is refused; nothing sends', () => {
    const preview = ctx({ route: 'account', overlays: ['spenders', 'preview'], focus: 'ours' });
    for (const id of ['reply', 'fix', 'hi', 'ping', 'tone', 'split'] as const) expect(ran(decideKey(cmd(id), preview))).toBe(`${id}@preview`);
    expect(ran(decideKey(cmd('cancel'), preview))).toBe('cancel@preview');
    for (const id of ['recap', 'review', 'coach'] as const) expect(decideKey(cmd(id), preview)).toMatchObject({ act: 'claim', run: null, refusal: 'overlay-open' });
    expect(PREVIEW_COMMANDS).not.toContain('send');
    // «Отправить» has no key anywhere: no dispatcher command, no catalog key, and Enter is never a dispatcher command.
    expect(DISPATCHER_COMMAND_IDS).not.toContain('send');
    expect(DISPATCHER_COMMAND_IDS).not.toContain('open-and-insert');
    expect(UI_ACTION_TYPES).toContain('SendPart');
    expect(createActionCatalog('mac').entry('send').hotkey).toBeNull();
    expect(createActionCatalog('win').entry('send').hotkey).toBeNull();
    for (const platform of ['mac', 'win'] as const) {
      const resolver = createKeyResolver(platform);
      resolver.keydown(platform === 'mac' ? META : CTRL);
      expect(resolver.keydown(ev('Enter', platform === 'mac' ? { metaKey: true } : { ctrlKey: true }))).toBeNull();
      expect(createKeyResolver(platform).keydown(ev('Enter'))).toBeNull();
    }
  });

  it('[HK-030] [SP-033] inside our UI a key ChatSpace would act on is kept from it and left to our element; typing passes untouched', () => {
    // Enter on a card or in the Coach question, the arrows of a list, Tab, ⌘C: never a dispatcher command.
    expect(decideUnmatched({ composing: false, focus: 'ours', combo: true })).toEqual({ act: 'isolate', otherwise: null });
    expect(decideUnmatched({ composing: false, focus: 'ours-field', combo: true })).toEqual({ act: 'isolate', otherwise: null });
    expect(decideUnmatched({ composing: false, focus: 'ours-field', combo: false })).toEqual({ act: 'pass' });
    // In ChatSpace's own field Enter is ChatSpace's (it sends): never ours.
    for (const focus of ['composer', 'field', 'page'] as const) expect(decideUnmatched({ composing: false, focus, combo: true })).toEqual({ act: 'pass' });
    // Under a board J/K are the board's own rows, not chat navigation.
    const board: readonly OverlayKind[] = ['spenders'];
    expect(decideKey(cmd('chat-next'), ctx({ overlays: board, focus: 'ours', combo: false }))).toEqual({ act: 'pass' });
    expect(decideKey(cmd('fan-panel'), ctx({ overlays: board, focus: 'page', combo: false }))).toEqual({ act: 'pass' });
  });
});

// ── catalog, delivery, cheatsheet ──

describe('the action catalog', () => {
  it('[HK-032] every catalog action has a row, its label is a catalog key in both languages, and every dispatcher command is a catalog action', () => {
    for (const platform of ['mac', 'win'] as const) {
      const catalog = createActionCatalog(platform);
      expect(catalog.entries().map((entry) => entry.id)).toEqual([...CATALOG_ACTION_IDS]);
      for (const entry of catalog.entries()) {
        expect([entry.id, typeof RU[entry.label], typeof EN[entry.label]]).toEqual([entry.id, 'string', 'string']);
        if (entry.tooltip !== null) expect(RU[entry.tooltip]).toBeDefined();
        expect(catalog.entry(entry.id)).toBe(entry);
      }
    }
    for (const id of DISPATCHER_COMMAND_IDS) expect(CATALOG_ACTION_IDS).toContain(id);
    expect(() => createActionCatalog('mac').entry('nope' as 'reply')).toThrow(/unknown catalog action/);
  });

  it('[HK-032] keys are printed for the system: ⌘ on macOS, Ctrl and Alt elsewhere, with aria-keyshortcuts', () => {
    const mac = createActionCatalog('mac');
    const win = createActionCatalog('win');
    expect(mac.entry('reply').hotkey).toEqual({ display: '⌘E', aria: 'Meta+E', delivery: 'cancelable', fallback: null });
    expect(win.entry('reply').hotkey).toEqual({ display: 'Ctrl+E', aria: 'Control+E', delivery: 'cancelable', fallback: null });
    expect(mac.entry('recap').hotkey?.display).toBe('⌘⇧S');
    expect(win.entry('recap').hotkey?.display).toBe('Ctrl+Alt+S');
    expect(mac.entry('palette').hotkey).toMatchObject({ display: '⌘K', aria: 'Meta+K' });
    expect(win.entry('palette').hotkey).toMatchObject({ display: 'Ctrl+K', aria: 'Control+K' });
    expect(mac.entry('next-unread').hotkey).toEqual({ display: '⌘U', aria: 'Meta+U', delivery: 'unverified', fallback: { display: '⌥U', aria: 'Alt+U', delivery: 'unverified' } });
    expect(win.entry('quick-jump').hotkey).toEqual({ display: 'Ctrl+1–9', aria: 'Control+1', delivery: 'unverified', fallback: { display: 'Alt+1–9', aria: 'Alt+1', delivery: 'unverified' } });
    expect(mac.entry('chat-next').hotkey).toEqual({ display: 'J', aria: 'J', delivery: 'delivered', fallback: null });
    expect(mac.entry('cheatsheet').hotkey?.display).toBe('?');
    expect(mac.entry('close').hotkey?.display).toBe('Esc');
    expect(mac.entry('copy-part').hotkey?.display).toBe('⌘C');
    expect(win.entry('copy-part').hotkey?.display).toBe('Ctrl+C');
    expect(mac.entry('help')).toMatchObject({ status: 'removed', hotkey: { display: '⌘⇧H' } });
    expect(mac.entry('newcomers').hotkey).toBeNull();
    expect(mac.reason('overlay-open')).toEqual({ id: 'overlay-open', code: 'CG-GATE-OVERLAY', text: { key: 'dock.reason.overlayOpen' } });
    expect(mac.reason('quota-zero', { time: '03:00' }).text).toEqual({ key: 'dock.reason.quotaZero', params: { time: '03:00' } });
  });

  it('[ST-121] the rows outside the vendored scheme are marked; the scheme\'s twelve are not', () => {
    expect(CATALOG_ACTION_IDS.filter((id) => !isOutsideScheme(id)).sort()).toEqual(hotkeysForClient('extension').map((def) => def.action).sort());
    const rows = hotkeyReferenceRows(createActionCatalog('win'));
    expect(rows.find((row) => row.id === 'chat-next')).toMatchObject({ outsideScheme: true, hotkey: { display: 'J' } });
    expect(rows.find((row) => row.id === 'reply')).toMatchObject({ outsideScheme: false });
    expect(rows.find((row) => row.id === 'send')).toMatchObject({ hotkey: null });
    expect(rows.some((row) => row.id === 'newcomers')).toBe(false);
  });

  it('the delivery table names every printed combination on both systems; a reserved one is never printed as working', () => {
    const values: readonly HotkeyDelivery[] = ['delivered', 'cancelable', 'reserved', 'unverified'];
    for (const platform of ['mac', 'win'] as const) {
      expect(Object.keys(DELIVERY[platform]).sort()).toEqual([...DELIVERY_KEYS].sort());
      for (const key of DELIVERY_KEYS) expect(values).toContain(DELIVERY[platform][key]);
      // Nothing measured says «the browser keeps it» yet; the unmeasured ones are named unverified.
      for (const key of ['palette', 'next-unread', 'quick-jump', 'settings'] as const) expect(DELIVERY[platform][key]).toBe('unverified');
    }
    // A measurement comes in as an override: a reserved main key gives way to its fallback, or to nothing.
    const measured = createActionCatalog('win', { delivery: { 'next-unread': 'reserved', 'next-unread:fallback': 'delivered', settings: 'reserved' } });
    expect(printableHotkey(measured.entry('next-unread').hotkey)).toEqual({ display: 'Alt+U', aria: 'Alt+U', delivery: 'delivered' });
    expect(printableHotkey(measured.entry('settings').hotkey)).toBeNull();
    expect(printableHotkey(measured.entry('reply').hotkey)?.display).toBe('Ctrl+E');
    expect(printableHotkey(null)).toBeNull();
  });

  it('[HK-034] the cheatsheet lists every dispatcher key in groups, says «пока убран» for ⌘⇧H and «нет клавиши» for «Отправить»', () => {
    const catalog = createActionCatalog('mac');
    const groups = cheatsheetGroups(catalog);
    expect(groups.map((group) => group.id)).toEqual(['ai', 'windows', 'before', 'result', 'navigation', 'preview']);
    const ai = groups[0]?.rows ?? [];
    expect(ai.slice(0, 7).map((row) => row.hotkey?.display)).toEqual(DOCK_ACTION_IDS.map((id) => catalog.entry(id).hotkey?.display));
    expect(ai[7]).toEqual({ label: { key: 'cheatsheet.row.help' }, hotkey: catalog.entry('help').hotkey, note: { key: 'dock.helpRemoved' } });
    const preview = groups[5]?.rows ?? [];
    expect(preview[preview.length - 1]).toEqual({ label: { key: 'send.button' }, hotkey: null, note: { key: 'cheatsheet.row.sendNote' } });
    const printed = groups.flatMap((group) => group.rows.map((row) => row.hotkey?.display));
    for (const key of ['⌘E', '⌘K', '⌘⇧M', '?', '⌘,', '⌘⇧O', '⌘⇧L', '⌘.', 'J', 'K', '⌘U', '⌘1–9', ']', 'Esc', '↵']) expect(printed).toContain(key);
    for (const group of groups) {
      expect(typeof RU[group.title.key]).toBe('string');
      for (const row of group.rows) expect(typeof EN[row.label.key]).toBe('string');
    }
    // Some rows are not measured on a real browser yet: the view says so.
    expect(cheatsheetView(catalog)).toMatchObject({ view: { s: 'partial', gaps: [] }, platform: 'mac', note: { key: 'cheatsheet.note' } });
    const allMeasured = Object.fromEntries(DELIVERY_KEYS.map((key) => [key, 'delivered'])) as Record<(typeof DELIVERY_KEYS)[number], HotkeyDelivery>;
    expect(cheatsheetView(createActionCatalog('mac', { delivery: allMeasured })).view).toEqual({ s: 'ready' });
    // A combination the browser keeps is printed as its fallback with the note, or not printed.
    const reserved = cheatsheetGroups(createActionCatalog('win', { delivery: { 'next-unread': 'reserved', settings: 'reserved' } }));
    const nav = reserved.find((group) => group.id === 'navigation')?.rows ?? [];
    expect(nav[2]).toEqual({ label: { key: 'cheatsheet.row.nextUnread' }, hotkey: { display: 'Alt+U', aria: 'Alt+U', delivery: 'unverified', fallback: null }, note: { key: 'dock.reason.hotkeyReserved' } });
    const windows = reserved.find((group) => group.id === 'windows')?.rows ?? [];
    expect(windows[3]).toEqual({ label: { key: 'palette.item.settings' }, hotkey: null, note: { key: 'dock.reason.hotkeyReserved' } });
  });
});
