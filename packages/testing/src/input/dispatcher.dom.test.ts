// The early dispatcher on a real document (happy-dom), wired the way the
// tab's composition root wires it: `window`, R09's mount manager with its
// closed shadow roots and registry, the keyboard probe of
// @cg/host-chatspace/isolated, the overlay state mirrored as
// `data-dismissible-open`. Around it — a page that behaves like ChatSpace:
// its global capture listener on `window` (registered after ours), the
// translator's capture listener on the composer root, a TipTap-like editor
// that sends on Enter. An Enter on our own UI never reaches the page.

import { createEarlyKeyDispatcher, createTabKeyState, type EarlyKeyDispatcher, type HotkeySink } from '@cg/core/application/hotkeys';
import { createOverlayState, mirrorDismissible, type OverlayState } from '@cg/core/application/navigation';
import { hotkeyPlatformOf, type DispatcherCommandId, type KeyCommand, type KeyRefusal } from '@cg/core/domain/hotkeys';
import { createKeyboardProbe, createMountManager, mountClosedHost, routeOfLocation, type ClosedHost, type MountManager } from '@cg/host-chatspace/isolated';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
});
