// The tab's keys from document_start (tab/keys.ts): the early dispatcher over
// the real mount manager's registry and the ChatSpace adapter the build ships,
// the keydown the gate needs, and the key that waits for the lazy part (HK-024).

import type { HotkeySink } from '@cg/core/application/hotkeys';
import { hotkeyPlatformOf, type KeyCommand } from '@cg/core/domain/hotkeys';
import { KEY_PENDING_ATTRIBUTE, createMountManager, type MountManager } from '@cg/host-chatspace/isolated';
import { afterEach, describe, expect, it } from 'vitest';

import { CHATSPACE_ADAPTER } from '../../entrypoints/chatspace.content';
import { startTabKeys, type TabKeys } from './keys';

/** The scheme the dispatcher picked for this environment: ⌘ on Apple platforms, Ctrl elsewhere. */
const MAC = hotkeyPlatformOf(window.navigator.platform) === 'mac';

function key(code: string, options: { readonly trusted?: boolean; readonly mod?: boolean; readonly shift?: boolean; readonly alt?: boolean } = {}): KeyboardEvent {
  const mod = options.mod ?? true;
  const event = new KeyboardEvent('keydown', {
    code,
    key: code.replace(/^Key/, '').toLowerCase(),
    bubbles: true,
    composed: true,
    cancelable: true,
    metaKey: mod && MAC,
    ctrlKey: mod && !MAC,
    shiftKey: options.shift ?? false,
    altKey: options.alt ?? false,
  });
  if (options.trusted !== false) Object.defineProperty(event, 'isTrusted', { value: true });
  return event;
}

const up = (code: string): KeyboardEvent => {
  const event = new KeyboardEvent('keyup', { code, key: code, bubbles: true, composed: true });
  Object.defineProperty(event, 'isTrusted', { value: true });
  return event;
};
const MODIFIER = MAC ? 'MetaLeft' : 'ControlLeft';

/**
 * ⌘/Ctrl goes down, then the letter, then both go up — as a person presses a combination. The engine takes
 * only a fresh press: the letter of a modifier that was already held for another key is a roll-over.
 * Returns the letter's keydown.
 */
function chord(code: string): KeyboardEvent {
  const modifier = new KeyboardEvent('keydown', { code: MODIFIER, key: MAC ? 'Meta' : 'Control', bubbles: true, composed: true, cancelable: true, metaKey: MAC, ctrlKey: !MAC });
  Object.defineProperty(modifier, 'isTrusted', { value: true });
  window.dispatchEvent(modifier);
  const pressed = key(code);
  window.dispatchEvent(pressed);
  window.dispatchEvent(up(code));
  window.dispatchEvent(up(MODIFIER));
  return pressed;
}

interface World {
  readonly keys: TabKeys;
  readonly mounts: MountManager;
  readonly waiting: number[];
  readonly heard: Event[];
  /** What ChatSpace's own listener on `window` saw (registered after ours, as on the page). */
  readonly native: string[];
  sink(): { readonly ran: KeyCommand[]; readonly sink: HotkeySink };
}

let current: World | null = null;
afterEach(() => {
  current?.keys.dispose();
  current?.mounts.dispose();
  current = null;
  window.history.replaceState(null, '', '/');
});

function world(path = '/accounts/910101/chats/74001001'): World {
  window.history.replaceState(null, '', path);
  const mounts = createMountManager(document);
  const waiting: number[] = [];
  const heard: Event[] = [];
  const native: string[] = [];
  const keys = startTabKeys({ win: window, mounts, site: CHATSPACE_ADAPTER, onWaiting: () => void waiting.push(waiting.length + 1) });
  keys.onKeydown((event) => void heard.push(event));
  const onNative = (event: Event): void => void native.push((event as KeyboardEvent).code);
  window.addEventListener('keydown', onNative, true);
  const made: World = {
    keys,
    mounts,
    waiting,
    heard,
    native,
    sink() {
      const ran: KeyCommand[] = [];
      return { ran, sink: { run: (command) => void ran.push(command), refuse: () => undefined, quickJump: () => undefined } };
    },
  };
  const dispose = keys.dispose.bind(keys);
  keys.dispose = () => {
    window.removeEventListener('keydown', onNative, true);
    dispose();
  };
  current = made;
  return made;
}

describe('the early keys of a tab', () => {
  it('[HK-024] a key of ours pressed before the lazy part is loaded is kept: ChatSpace never sees it, the dock host says «waiting», and the application is asked for', () => {
    const w = world();
    const pressed = chord('KeyE');
    expect(pressed.defaultPrevented).toBe(true);
    // ChatSpace saw ⌘/Ctrl go down — that key is nobody's — and never the letter.
    expect(w.native).toEqual([MODIFIER]);
    expect(w.waiting).toEqual([1]);
    expect(w.mounts.dock.host.hasAttribute(KEY_PENDING_ATTRIBUTE)).toBe(true);
    // The gate hears the keydown although the dispatcher stopped it.
    expect(w.heard.at(-1)).toBe(pressed);
    // Nothing is handed over until a sink is connected.
    expect(w.keys.takeKept()).toBeNull();
  });

  it('[HK-024] once the lazy part connects, the kept key runs — and its own keydown is handed over for the action gate, once', () => {
    const w = world();
    const pressed = chord('KeyE');
    const seen: (Event | null)[] = [];
    const ran: KeyCommand[] = [];
    w.keys.dispatcher.connect({
      run(command) {
        seen.push(w.keys.takeKept()?.event ?? null, w.keys.takeKept()?.event ?? null);
        ran.push(command);
      },
      refuse: () => undefined,
      quickJump: () => undefined,
    });
    expect(ran.map((command) => command.id)).toEqual(['reply']);
    expect(seen).toEqual([pressed, null]);
    expect(w.mounts.dock.host.hasAttribute(KEY_PENDING_ATTRIBUTE)).toBe(false);
    // A key pressed now runs at once: its keydown is still in flight, nothing is «kept».
    const live = chord('KeyP');
    expect(ran.map((command) => command.id)).toEqual(['reply', 'ping']);
    expect(seen).toEqual([pressed, null, null, null]);
    expect(w.heard.at(-1)).toBe(live);
  });

  it('only the newest key waits: a second one replaces the first, and its keydown is the one handed over', () => {
    const w = world();
    chord('KeyE');
    const second = chord('KeyG');
    const handed: (Event | null)[] = [];
    const { ran, sink } = w.sink();
    w.keys.dispatcher.connect({ ...sink, run: (command) => (handed.push(w.keys.takeKept()?.event ?? null), sink.run(command)) });
    expect(ran.map((command) => command.id)).toEqual(['hi']);
    expect(handed).toEqual([second]);
  });

  it('[HK-026] a key that is not ours is not touched: ChatSpace gets it, nothing waits', () => {
    const w = world();
    const typed = key('KeyA', { mod: false });
    window.dispatchEvent(typed);
    const copy = chord('KeyC');
    expect(typed.defaultPrevented).toBe(false);
    expect(copy.defaultPrevented).toBe(false);
    expect(w.native).toEqual(['KeyA', MODIFIER, 'KeyC']);
    expect(w.waiting).toEqual([]);
  });

  it('[AI-120] a synthetic key of the page starts nothing and is not handed to the gate', () => {
    const w = world();
    const forged = key('KeyE', { trusted: false });
    window.dispatchEvent(forged);
    expect(forged.defaultPrevented).toBe(false);
    expect(w.heard).toEqual([]);
    expect(w.waiting).toEqual([]);
    expect(w.native).toEqual(['KeyE']);
  });

  it('[HK-024] outside a chat the palette key is ours too: it waits for the application, an AI key does not', () => {
    const w = world('/accounts/910101/chats');
    const reply = chord('KeyE');
    expect(reply.defaultPrevented).toBe(false);
    expect(w.waiting).toEqual([]);
    const palette = chord('KeyK');
    expect(palette.defaultPrevented).toBe(true);
    expect(w.waiting).toEqual([1]);
  });

  it('[HK-029] the open overlays are mirrored on their hosts as `data-dismissible-open`, the dock’s sheet on the dock host', () => {
    const w = world();
    w.keys.overlays.set('spenders', true);
    const modal = w.mounts.overlay('modal').host;
    expect(modal.hasAttribute('data-dismissible-open')).toBe(true);
    w.keys.overlays.set('spenders', false);
    expect(modal.hasAttribute('data-dismissible-open')).toBe(false);
    w.keys.dockSheet(true);
    expect(w.mounts.dock.host.hasAttribute('data-dismissible-open')).toBe(true);
    w.keys.dockSheet(false);
    expect(w.mounts.dock.host.hasAttribute('data-dismissible-open')).toBe(false);
  });

  it('[UI-019] a held Enter that went down in our UI never reaches ChatSpace: its repeats are stopped where the focus went, a fresh press passes', () => {
    const w = world();
    const enter = (target: EventTarget, repeat: boolean, type: 'keydown' | 'keyup' = 'keydown'): KeyboardEvent => {
      const event = new KeyboardEvent(type, { code: 'Enter', key: 'Enter', repeat, bubbles: true, composed: true, cancelable: true });
      Object.defineProperty(event, 'isTrusted', { value: true });
      target.dispatchEvent(event);
      return event;
    };
    const ours = w.mounts.overlay('modal').host;
    expect(ours.isConnected).toBe(true);
    // «Вставить» is pressed with Enter inside a root of ours; the insert moves the focus to the composer.
    const first = enter(ours, false);
    expect(first.defaultPrevented).toBe(false);
    const heard = w.heard.length;
    const repeats = [enter(document.body, true), enter(document.body, true)];
    expect(repeats.map((event) => event.defaultPrevented)).toEqual([true, true]);
    // Neither ChatSpace nor the action gate heard the repeats (the press itself stayed in our UI: the dispatcher isolates it).
    expect(w.native).toEqual([]);
    expect(w.heard).toHaveLength(heard);
    // A repeat that is still inside our UI is the kit's own business.
    expect(enter(ours, true).defaultPrevented).toBe(false);
    // The key is released: the next Enter in the composer is the person's own, and so are its repeats.
    enter(document.body, false, 'keyup');
    expect(enter(document.body, false).defaultPrevented).toBe(false);
    expect(enter(document.body, true).defaultPrevented).toBe(false);
    expect(w.native).toEqual(['Enter', 'Enter']);
    // A synthetic «keyup» of the page does not end the hold.
    enter(document.body, false, 'keyup');
    enter(ours, false);
    const forged = new KeyboardEvent('keyup', { code: 'Enter', key: 'Enter', bubbles: true });
    document.body.dispatchEvent(forged);
    expect(enter(document.body, true).defaultPrevented).toBe(true);
  });

  it('dispose takes the listeners off `window`: a key of ours goes to the page again', () => {
    const w = world();
    w.keys.dispose();
    const pressed = chord('KeyE');
    expect(pressed.defaultPrevented).toBe(false);
    expect(w.heard).toEqual([]);
  });
});
