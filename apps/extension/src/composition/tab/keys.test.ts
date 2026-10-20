// The tab's keys from document_start (tab/keys.ts): the early dispatcher over
// the real mount manager's registry and the ChatSpace adapter the build ships,
// the keydown the gate needs, and the key that waits for the lazy part (HK-024).

import type { HotkeySink } from '@cg/core/application/hotkeys';
import { hotkeyPlatformOf, type KeyCommand } from '@cg/core/domain/hotkeys';
import { createMountManager, type MountManager } from '@cg/host-chatspace/isolated';
import { afterEach, describe, expect, it } from 'vitest';

import { CHATSPACE_ADAPTER } from '../../entrypoints/chatspace.content';
import { startTabKeys, type TabKeys, type TabKeysEnv } from './keys';

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

function world(path = '/accounts/910101/chats/74001001', site: TabKeysEnv['site'] = CHATSPACE_ADAPTER): World {
  window.history.replaceState(null, '', path);
  const mounts = createMountManager(document);
  const waiting: number[] = [];
  const heard: Event[] = [];
  const native: string[] = [];
  const keys = startTabKeys({ win: window, mounts, site, onWaiting: () => void waiting.push(waiting.length + 1) });
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
  it('[AI-120] a synthetic key of the page starts nothing and is not handed to the gate', () => {
    const w = world();
    const forged = key('KeyE', { trusted: false });
    window.dispatchEvent(forged);
    expect(forged.defaultPrevented).toBe(false);
    expect(w.heard).toEqual([]);
    expect(w.waiting).toEqual([]);
    expect(w.native).toEqual(['KeyE']);
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
});
