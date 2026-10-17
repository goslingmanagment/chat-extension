// The early dispatcher on a real document (happy-dom), wired the way the
// tab's composition root wires it: `window`, R09's mount manager with its
// closed shadow roots and registry, the keyboard probe of
// @cg/host-chatspace/isolated, the overlay state mirrored as
// `data-dismissible-open`. Around it — a page that behaves like ChatSpace:
// its global capture listener on `window` (registered after ours), the
// translator's capture listener on the composer root, a TipTap-like editor.
// The Firefox run of the same wiring is e2e/specs/hotkeys.e2e.ts.

import { createEarlyKeyDispatcher, createTabKeyState, type EarlyKeyDispatcher, type HotkeySink } from '@cg/core/application/hotkeys';
import { createOverlayState, mirrorDismissible, type OverlayState, type TabRpc } from '@cg/core/application/navigation';
import { hotkeyPlatformOf, type DispatcherCommandId, type KeyCommand, type KeyRefusal } from '@cg/core/domain/hotkeys';
import { type SoundAudioPort, type SoundPresencePort } from '@cg/core/services/sound';
import { type PresenceService } from '@cg/core/services';
import { createKeyboardProbe, createMountManager, mountClosedHost, routeOfLocation, type ClosedHost, type MountManager } from '@cg/host-chatspace/isolated';
import { type AudioPlayer, type TabRpcClient } from '@cg/platform';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';

/** What the page did natively: each entry is a failure of isolation if a test did not expect it. */
let native: string[] = [];
let ran: string[] = [];
let refused: string[] = [];
let quick: boolean[] = [];
let dispatcher: EarlyKeyDispatcher;
let overlays: OverlayState;
let mounts: MountManager;
let pathname = '/accounts/1001/chats/2002';
let cleanup: (() => void)[] = [];
let editor: HTMLElement;
let composerRoot: HTMLElement;
let dock: ClosedHost;

const sink: HotkeySink = {
  run: (command: KeyCommand) => ran.push(command.slot === null ? `${command.id}@${command.target}` : `${command.id}:${command.slot}@${command.target}`),
  refuse: (command: DispatcherCommandId, refusal: KeyRefusal) => refused.push(`${command}:${refusal}`),
  quickJump: (open: boolean) => quick.push(open),
};

/** A key as the browser dispatches it to the focused element (happy-dom marks scripted events untrusted). */
function press(target: EventTarget, init: KeyboardEventInit & { key: string; code: string }): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, composed: true, ...init });
  Object.defineProperty(event, 'isTrusted', { value: true });
  target.dispatchEvent(event);
  return event;
}

const META: KeyboardEventInit & { key: string; code: string } = { key: 'Meta', code: 'MetaLeft', metaKey: true };
/** ⌘ pressed freshly, then the key under it, on the focused element. */
function chord(target: EventTarget, code: string, key: string, mods: KeyboardEventInit = {}): KeyboardEvent {
  press(target, META);
  const event = press(target, { key, code, metaKey: true, ...mods });
  const up = new KeyboardEvent('keyup', { key: 'Meta', code: 'MetaLeft', bubbles: true, composed: true });
  Object.defineProperty(up, 'isTrusted', { value: true });
  target.dispatchEvent(up);
  return event;
}

function listen<K extends keyof WindowEventMap>(target: EventTarget, type: K, listener: (event: WindowEventMap[K]) => void, capture = false): void {
  target.addEventListener(type, listener as EventListener, { capture });
  cleanup.push(() => target.removeEventListener(type, listener as EventListener, { capture }));
}

beforeEach(() => {
  native = [];
  ran = [];
  refused = [];
  quick = [];
  cleanup = [];
  pathname = '/accounts/1001/chats/2002';
  document.body.replaceChildren();

  // ── ours, at document_start: before any script of the page ──
  mounts = createMountManager(document);
  overlays = createOverlayState();
  const state = createTabKeyState({ overlays, route: () => routeOfLocation({ pathname }) });
  dispatcher = createEarlyKeyDispatcher({
    platform: hotkeyPlatformOf('MacIntel'),
    client: 'extension',
    window,
    document: { source: document, hidden: () => document.hidden },
    ownership: createKeyboardProbe(document, mounts.registry),
    state,
    timers: { setTimer: (ms, fn) => setTimeout(fn, ms), clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    now: () => Date.now(),
  });
  const mirror = mirrorDismissible(overlays, (target, owner, open) => mounts.setDismissibleOpen(target, owner, open));
  dispatcher.connect(sink);
  cleanup.push(() => {
    mirror.dispose();
    dispatcher.dispose();
    mounts.dispose();
  });

  // ── the page, later: ChatSpace's layout mounts and registers its own listeners ──
  composerRoot = document.createElement('div');
  composerRoot.className = 'relative';
  const frame = document.createElement('div');
  frame.className = 'composer-frame';
  editor = document.createElement('div');
  editor.className = 'ProseMirror';
  editor.setAttribute('contenteditable', 'true');
  editor.tabIndex = 0;
  frame.append(editor);
  composerRoot.append(frame);
  document.body.append(composerRoot);
  // Our dock docks into the composer's frame root, first child, as the mount manager places it on a real page
  // (the manager's own placement needs ChatSpace's bridge slot; the host, the closed root and the registry are the same).
  dock = mountClosedHost(composerRoot, 'dock', 'first', mounts.registry);
  cleanup.push(() => dock.remove());

  // ChatSpace's global hotkeys: `window`, capture; Esc closes the chat tab unless something dismissible is open.
  listen(
    window,
    'keydown',
    (event) => {
      if (event.key === 'Escape') {
        const blocked = [...document.querySelectorAll('[data-dismissible-open], [role="dialog"]')].length > 0;
        native.push(blocked ? 'esc-skipped' : 'chat-tab-closed');
      }
      if (event.ctrlKey && event.key === 'Tab') native.push('chat-tab-switched');
    },
    true,
  );
  // The translator: a capture listener on the composer root, Alt+S by code with any other modifiers.
  listen(
    composerRoot,
    'keydown',
    (event) => {
      if (event.altKey && event.code === 'KeyS') native.push('translator-toggled');
    },
    true,
  );
  // TipTap: marks and Enter on the editor; ProseMirror skips an event that is already defaultPrevented.
  listen(editor, 'keydown', (event) => {
    if (event.defaultPrevented) return;
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.code === 'KeyE') native.push('inline-code-toggled');
    if (mod && event.code === 'KeyI') native.push('italic-toggled');
    if (mod && event.shiftKey && event.code === 'KeyS') native.push('strike-toggled');
    if (event.key === 'Enter' && !event.shiftKey) native.push('message-sent');
  });
  // A document-level listener of the page: anything that bubbles out of our UI would land here.
  listen(document, 'keydown', (event) => native.push(`document:${event.key}`));
});

afterEach(() => {
  for (const undo of cleanup.reverse()) undo();
});

function ourCard(root: ShadowRoot, onKey: (event: KeyboardEvent) => void): HTMLElement {
  const card = document.createElement('div');
  card.tabIndex = 0;
  card.addEventListener('keydown', onKey);
  root.append(card);
  return card;
}

const nativeActions = (): string[] => native.filter((entry) => !entry.startsWith('document:'));

describe('ports fit the real things', () => {
  it('`window`, R09\'s registry and probe, the platform\'s RPC client, audio player and R07\'s presence fit R17\'s ports as they are', () => {
    // The dispatcher above is built from `window`, `document` and createKeyboardProbe without an adapter: this file compiles.
    expectTypeOf<TabRpcClient>().toMatchTypeOf<Pick<TabRpc, 'onEvent'>>();
    const rpc = (client: TabRpcClient): TabRpc => client;
    const audio = (player: AudioPlayer): SoundAudioPort => player;
    const presence = (service: PresenceService): SoundPresencePort => ({
      listeningTabs: () => service.listeningTabs(),
      isChatInFocus: (chatKey) => service.isChatInFocus(chatKey),
      accounts: () => service.seenAccounts().map((seen) => seen.account),
    });
    expect([typeof rpc, typeof audio, typeof presence]).toEqual(['function', 'function', 'function']);
  });
});

describe('TipTap, the translator and the browser never get a key of ours', () => {
  it('[HK-002] [HK-003] ⌘E and ⌘I in the message field start Reply and Fix: no inline code, no italic', () => {
    editor.focus();
    const reply = chord(editor, 'KeyE', 'e');
    const fix = chord(editor, 'KeyI', 'i');
    expect(ran).toEqual(['reply@dock', 'fix@dock']);
    expect([reply.defaultPrevented, fix.defaultPrevented]).toEqual([true, true]);
    expect(native).toEqual(['document:Meta', 'document:Meta']);
  });

  it('[HK-008] ⌘⇧S and Ctrl+Alt+S are Recap: no strikethrough, and the translator on the composer root does not flip', () => {
    editor.focus();
    chord(editor, 'KeyS', 'S', { shiftKey: true });
    expect(ran).toEqual(['recap@dock']);
    expect(nativeActions()).toEqual([]);
    // The Windows scheme on the same page: Ctrl+Alt+S would be the translator's Alt+S.
    dispatcher.dispose();
    const win = createEarlyKeyDispatcher({
      platform: 'win',
      client: 'extension',
      window,
      ownership: createKeyboardProbe(document, mounts.registry),
      state: createTabKeyState({ overlays, route: () => routeOfLocation({ pathname }) }),
      timers: { setTimer: (ms, fn) => setTimeout(fn, ms), clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
      now: () => Date.now(),
    });
    win.connect(sink);
    cleanup.push(() => win.dispose());
    // Our listener was registered again, after the page's: on a real page it is first (document_start). Here the
    // page's `window` listener runs before it, but the translator's sits on a descendant and still comes later.
    press(editor, { key: 'Control', code: 'ControlLeft', ctrlKey: true });
    press(editor, { key: 's', code: 'KeyS', ctrlKey: true, altKey: true });
    expect(ran).toEqual(['recap@dock', 'recap@dock']);
    expect(nativeActions()).toEqual([]);
  });

  it('[HK-026] negative: ChatSpace\'s own keys in its own field are not touched — Alt+S, Enter, Esc, ⌘B, Ctrl+Tab', () => {
    editor.focus();
    const keys = [
      press(editor, { key: 's', code: 'KeyS', altKey: true }),
      press(editor, { key: 'Enter', code: 'Enter' }),
      press(editor, { key: 'Escape', code: 'Escape' }),
      press(editor, { key: 'Tab', code: 'Tab', ctrlKey: true }),
      chord(editor, 'KeyB', 'b'),
      press(editor, { key: 'j', code: 'KeyJ' }),
    ];
    expect(nativeActions()).toEqual(['translator-toggled', 'message-sent', 'chat-tab-closed', 'chat-tab-switched']);
    for (const event of keys) expect([event.key, event.defaultPrevented]).toEqual([event.key, false]);
    expect(ran).toEqual([]);
  });
});

describe('Esc', () => {
  it('[HK-029] our window is open: Esc closes it and the chat tab stays — from the message field and from inside our window', () => {
    overlays.set('palette', true);
    const host = mounts.overlay('modal').host;
    expect(host.hasAttribute('data-dismissible-open')).toBe(true);
    editor.focus();
    const fromComposer = press(editor, { key: 'Escape', code: 'Escape' });
    expect(ran).toEqual(['close@global']);
    expect(fromComposer.defaultPrevented).toBe(true);
    expect(native).toEqual([]);

    // Focus inside our window: its own Esc handler first.
    const root = mounts.overlay('modal').root;
    let closedMenu = 0;
    const field = document.createElement('input');
    field.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || closedMenu > 0) return;
      closedMenu += 1;
      event.preventDefault();
    });
    root.append(field);
    field.focus();
    press(field, { key: 'Escape', code: 'Escape' });
    expect([closedMenu, ran]).toEqual([1, ['close@global']]);
    // Nothing inside took the second one: the window closes.
    press(field, { key: 'Escape', code: 'Escape' });
    expect(ran).toEqual(['close@global', 'close@global']);
    expect(native).toEqual([]);
    overlays.set('palette', false);
    expect(host.hasAttribute('data-dismissible-open')).toBe(false);
  });

  it('[HK-029] nothing of ours open: Esc is ChatSpace\'s and closes its chat tab as before', () => {
    editor.focus();
    const event = press(editor, { key: 'Escape', code: 'Escape' });
    expect(nativeActions()).toEqual(['chat-tab-closed']);
    expect(event.defaultPrevented).toBe(false);
    expect(ran).toEqual([]);
  });
});

describe('inside our closed roots', () => {
  it('[HK-030] Enter on our card is the card\'s: ChatSpace does not send, and no listener of the page sees the key', () => {
    let inserted = 0;
    const card = ourCard(dock.root, (event) => {
      if (event.key !== 'Enter') return;
      inserted += 1;
      event.preventDefault();
    });
    card.focus();
    const event = press(card, { key: 'Enter', code: 'Enter' });
    expect(inserted).toBe(1);
    expect(event.defaultPrevented).toBe(true);
    expect(native).toEqual([]);
    expect(ran).toEqual([]);
    // It went through the dispatcher: kept from the page, handed to the card.
    expect(dispatcher.stats()).toMatchObject({ keydowns: 1, isolated: 1, claimed: 0 });
    // Without the dispatcher the same key bubbles out of our root to the page.
    dispatcher.dispose();
    press(card, { key: 'Enter', code: 'Enter' });
    expect([inserted, native]).toEqual([2, ['document:Enter']]);
  });

  it('[HK-037] [HK-039] [HK-034] J, K, ] and ? typed into our field are text; on a card of the dock J, K and ] do nothing (X44) and ? is the cheatsheet; on a card of a side panel they are navigation and the panel', () => {
    const field = document.createElement('input');
    dock.root.append(field);
    field.focus();
    const typed = [press(field, { key: 'j', code: 'KeyJ' }), press(field, { key: 'k', code: 'KeyK' }), press(field, { key: ']', code: 'BracketRight' }), press(field, { key: '?', code: 'Slash', shiftKey: true })];
    for (const event of typed) expect([event.key, event.defaultPrevented]).toEqual([event.key, false]);
    expect(ran).toEqual([]);
    // A part of the dock — one that took the focus by itself after a Reply (X44): a stray letter opens no other chat.
    const heard: string[] = [];
    const card = ourCard(dock.root, (event) => heard.push(event.key));
    card.focus();
    native.length = 0;
    press(card, { key: 'j', code: 'KeyJ' });
    press(card, { key: 'k', code: 'KeyK' });
    press(card, { key: ']', code: 'BracketRight' });
    press(card, { key: 'о', code: 'KeyJ' });
    expect(ran).toEqual([]);
    // Kept from the page: no listener of ChatSpace saw them; the dock's own card got them and did nothing.
    expect(native).toEqual([]);
    expect(heard).toEqual(['j', 'k', ']', 'о']);
    press(card, { key: '?', code: 'Slash', shiftKey: true });
    expect(ran).toEqual(['cheatsheet@global']);
    // A card of a side panel of ours (the fan panel, Coach): there they are the chat navigation and the panel, as before.
    const side = ourCard(mounts.overlay('panel').root, () => undefined);
    side.focus();
    press(side, { key: 'j', code: 'KeyJ' });
    press(side, { key: 'k', code: 'KeyK' });
    press(side, { key: ']', code: 'BracketRight' });
    // Russian layout: the same physical keys.
    press(side, { key: 'о', code: 'KeyJ' });
    expect(ran).toEqual(['cheatsheet@global', 'chat-next@global', 'chat-previous@global', 'fan-panel@dock', 'chat-next@global']);
  });

  it('[SP-033] in a board of ours J/K and the arrows are the board\'s rows; the translator and ChatSpace\'s Esc do not fire under it', () => {
    overlays.set('spenders', true);
    const root = mounts.overlay('modal').root;
    const rows: string[] = [];
    const board = ourCard(root, (event) => {
      rows.push(event.key);
      if (event.key === 'Escape' || event.key === 'ArrowDown') event.preventDefault();
    });
    board.focus();
    press(board, { key: 'j', code: 'KeyJ' });
    press(board, { key: 'ArrowDown', code: 'ArrowDown' });
    press(board, { key: 's', code: 'KeyS', altKey: true });
    press(board, { key: 'Escape', code: 'Escape' });
    expect(rows).toEqual(['j', 'ArrowDown', 's', 'Escape']);
    expect(nativeActions()).toEqual([]);
    expect(ran).toEqual([]);
    // The letter passed natively (typing is nobody's business); the three others were kept from the page.
    expect(dispatcher.stats()).toMatchObject({ keydowns: 4, isolated: 3 });
    expect(native).toEqual(['document:j']);
    // A paid generation under the board is refused with the reason (HK-027).
    chord(board, 'KeyE', 'e');
    expect(refused).toEqual(['reply:overlay-open']);
  });

  it('[HK-020] IME inside our field: a composing key is left entirely alone', () => {
    const field = document.createElement('input');
    mounts.overlay('modal').root.append(field);
    overlays.set('palette', true);
    field.focus();
    let seen = 0;
    field.addEventListener('keydown', () => (seen += 1));
    const composing = press(field, { key: 'Process', code: 'KeyJ', isComposing: true });
    const enter = press(field, { key: 'Enter', code: 'Enter', isComposing: true });
    const escape = press(field, { key: 'Escape', code: 'Escape', keyCode: 229 });
    // Each reached the field natively, once, untouched.
    expect(seen).toBe(3);
    for (const event of [composing, enter, escape]) expect(event.defaultPrevented).toBe(false);
    expect(ran).toEqual([]);
  });

  it('the dock sits inside ChatSpace\'s composer root: Alt+S pressed on our card does not flip the translator there', () => {
    const card = ourCard(dock.root, () => undefined);
    card.focus();
    press(card, { key: 's', code: 'KeyS', altKey: true });
    press(card, { key: 'Tab', code: 'Tab', ctrlKey: true });
    expect(native).toEqual([]);
    expect(dispatcher.stats().isolated).toBe(2);
    // The same two keys from ChatSpace's own field are ChatSpace's.
    editor.focus();
    press(editor, { key: 's', code: 'KeyS', altKey: true });
    press(editor, { key: 'Tab', code: 'Tab', ctrlKey: true });
    expect(nativeActions()).toEqual(['translator-toggled', 'chat-tab-switched']);
  });
});

describe('outside a chat', () => {
  it('[HK-026] [SP-001] only the global keys are ours: ⌘⇧M and ⌘K run, ⌘E is the browser\'s', () => {
    pathname = '/settings';
    const body = document.body;
    const reply = chord(body, 'KeyE', 'e');
    chord(body, 'KeyM', 'M', { shiftKey: true });
    chord(body, 'KeyK', 'k');
    expect(reply.defaultPrevented).toBe(false);
    expect(ran).toEqual(['spenders@global', 'palette@global']);
  });
});
