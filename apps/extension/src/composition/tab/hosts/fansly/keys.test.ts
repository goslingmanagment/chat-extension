// The early keys of a Fansly tab (R20 P7i; docs/project-unite/architecture.md
// §7.9, §9.1; FS-HK-1): the tab's one dispatcher (tab/keys.ts) over the mount
// manager of Fansly and the early half of the adapter its entry point ships —
// its probe, its route by the address, its client of the key scheme — with the
// keys a person presses on a Fansly-like page: the conversation's field, the
// mini-chat's, a modal of Fansly, FBuddy's window and its translate key on the
// field. Fansly's own listeners stand where Fansly has them: one on `window`
// registered after ours, and the field's own (its Enter, FBuddy's ⌘⇧L). In
// Firefox, with the extension on the stand: packages/testing/e2e/specs/
// suite-fansly-host.e2e.ts.

import type { HotkeySink } from '@cg/core/application/hotkeys';
import type { DispatcherCommandId, KeyCommand, KeyRefusal } from '@cg/core/domain/hotkeys';
import { KEY_PENDING_ATTRIBUTE, createFanslyMounts, type FanslyMounts } from '@cg/host-fansly/isolated';
import { afterEach, describe, expect, it } from 'vitest';

import { FANSLY_ADAPTER } from '../../../../entrypoints/fansly';
import { startTabKeys, type TabKeys } from '../../keys';

const GROUP = '700000000000000010';

type Scheme = 'mac' | 'win';
interface Mods {
  readonly mod?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  readonly ctrl?: boolean;
  readonly repeat?: boolean;
}

/** A trusted keydown on `target` (happy-dom marks every scripted event untrusted). */
function press(target: EventTarget, scheme: Scheme, code: string, key: string, mods: Mods = {}, type: 'keydown' | 'keyup' = 'keydown'): KeyboardEvent {
  const mod = mods.mod === true;
  const event = new KeyboardEvent(type, {
    code,
    key,
    bubbles: true,
    composed: true,
    cancelable: true,
    metaKey: mod && scheme === 'mac',
    ctrlKey: (mod && scheme === 'win') || mods.ctrl === true,
    shiftKey: mods.shift === true,
    altKey: mods.alt === true,
    repeat: mods.repeat === true,
  });
  Object.defineProperty(event, 'isTrusted', { value: true });
  target.dispatchEvent(event);
  return event;
}

interface Page {
  readonly field: HTMLTextAreaElement;
  readonly mini: HTMLTextAreaElement;
  /** FBuddy's notes in an `fb-*-ui` host with an open root, beside the composer. */
  readonly neighbourNotes: HTMLTextAreaElement;
  /** What Fansly's own listener on `window` heard (registered after ours, as on the page). */
  readonly page: string[];
  /** What the conversation field's own keydown listeners heard: Fansly's Enter, FBuddy's ⌘⇧L. */
  readonly onField: string[];
  /** FBuddy's translations: its Mod+Shift+L listener on the field, exact modifiers, Mod = Meta on macOS. */
  readonly translated: number;
  /** Fansly's sends from the field: Enter without Shift. */
  readonly sent: number;
}

interface World extends Page {
  readonly keys: TabKeys;
  readonly mounts: FanslyMounts;
  readonly waiting: number[];
  readonly ran: string[];
  readonly refused: Array<[DispatcherCommandId, KeyRefusal]>;
  connect(): void;
  /** ⌘/Ctrl down, the key, both up — a fresh press, as the scheme's guarded keys want it. */
  chord(target: EventTarget, code: string, key: string, extra?: Omit<Mods, 'mod'>): KeyboardEvent;
}

const el = (tag: string, className?: string, children: readonly Node[] = []): HTMLElement => {
  const element = document.createElement(tag);
  if (className !== undefined) element.className = className;
  element.append(...children);
  return element;
};

/** Modifier keys alone: the field's log keeps only the keys that would type or act. */
const MODIFIERS = new Set(['MetaLeft', 'ControlLeft', 'ShiftLeft', 'AltLeft']);
const cleanups: Array<() => void> = [];

function fanslyPage(scheme: Scheme): Page {
  const field = el('textarea', 'message-input') as HTMLTextAreaElement;
  const composer = el('app-group-message-input', undefined, [el('div', 'message-composer', [el('div', 'collapsable-actions'), el('div', 'message-entry', [field, el('button', 'send-button')])])]);
  const route = el('app-messages-conversation-route', undefined, [el('div', 'message-content-header'), el('app-group-message-container', 'message-content', [el('div', 'message-content-list'), composer])]);
  const mini = el('textarea', 'message-input') as HTMLTextAreaElement;
  const overlay = el('app-messaging-overlay', undefined, [el('app-group-message-container', 'message-content', [el('app-group-message-input', undefined, [el('div', 'message-composer', [mini])])])]);
  const tag = 'fb-user-notes-panel-ui';
  if (customElements.get(tag) === undefined) customElements.define(tag, class extends HTMLElement {});
  const notesHost = document.createElement(tag);
  const neighbourNotes = document.createElement('textarea');
  notesHost.attachShadow({ mode: 'open' }).append(neighbourNotes);
  document.body.append(el('app-root', undefined, [el('div', 'content-wrapper', [el('div', 'messages-content-wrapper', [route])]), overlay]), notesHost);

  const state = { page: [] as string[], onField: [] as string[], translated: 0, sent: 0 };
  const onPage = (event: KeyboardEvent): void => void state.page.push(event.code);
  window.addEventListener('keydown', onPage, true);
  cleanups.push(() => window.removeEventListener('keydown', onPage, true));
  field.addEventListener('keydown', (event) => {
    if (!MODIFIERS.has(event.code)) state.onField.push(event.code);
    // FBuddy's translate: `keydown` on the field, by code, modifiers exact; preventDefault and stopPropagation (S5 §2.6).
    const mod = scheme === 'mac' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    if (event.code === 'KeyL' && event.shiftKey && !event.altKey && mod) {
      event.preventDefault();
      event.stopPropagation();
      state.translated += 1;
    }
    // Fansly sends on Enter without Shift (main:56025-56035).
    if (event.code === 'Enter' && !event.shiftKey) state.sent += 1;
  });
  return {
    field,
    mini,
    neighbourNotes,
    get page() {
      return state.page;
    },
    get onField() {
      return state.onField;
    },
    get translated() {
      return state.translated;
    },
    get sent() {
      return state.sent;
    },
  };
}

let current: { keys: TabKeys; mounts: FanslyMounts; platform: PropertyDescriptor | undefined } | null = null;
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  current?.keys.dispose();
  current?.mounts.dispose();
  if (current !== null) {
    if (current.platform === undefined) Reflect.deleteProperty(window.navigator, 'platform');
    else Object.defineProperty(window.navigator, 'platform', current.platform);
  }
  current = null;
  document.body.className = '';
  document.body.replaceChildren();
  window.history.replaceState(null, '', '/');
});

function world(scheme: Scheme, path = `/messages/${GROUP}`): World {
  const platform = Object.getOwnPropertyDescriptor(window.navigator, 'platform');
  Object.defineProperty(window.navigator, 'platform', { value: scheme === 'mac' ? 'MacIntel' : 'Win32', configurable: true });
  window.history.replaceState(null, '', path);
  const mounts = createFanslyMounts(document);
  const waiting: number[] = [];
  // Ours first: the isolated script runs at document_start, before any script of the page.
  const keys = startTabKeys({ win: window, mounts, site: FANSLY_ADAPTER, onWaiting: () => void waiting.push(waiting.length + 1) });
  current = { keys, mounts, platform };
  const page = fanslyPage(scheme);
  const ran: string[] = [];
  const refused: Array<[DispatcherCommandId, KeyRefusal]> = [];
  const sink: HotkeySink = {
    run: (command: KeyCommand) => void ran.push(`${command.id}@${command.target}`),
    refuse: (command, refusal) => void refused.push([command, refusal]),
    quickJump: () => undefined,
  };
  const modifier = scheme === 'mac' ? { code: 'MetaLeft', key: 'Meta' } : { code: 'ControlLeft', key: 'Control' };
  return Object.assign(Object.create(page), {
    keys,
    mounts,
    waiting,
    ran,
    refused,
    connect: () => keys.dispatcher.connect(sink),
    chord(target: EventTarget, code: string, key: string, extra: Omit<Mods, 'mod'> = {}) {
      press(target, scheme, modifier.code, modifier.key, { mod: true });
      const pressed = press(target, scheme, code, key, { ...extra, mod: true });
      press(target, scheme, code, key, { ...extra, mod: true }, 'keyup');
      press(target, scheme, modifier.code, modifier.key, {}, 'keyup');
      return pressed;
    },
  }) as World;
}

/** The panel level of a scheme: ⌘⇧ on macOS, Ctrl+Alt elsewhere. */
const panel = (scheme: Scheme): Omit<Mods, 'mod'> => (scheme === 'mac' ? { shift: true } : { alt: true });

describe('[host:fansly] the early keys of a Fansly tab (FS-HK-1)', () => {
  it('[R20-F5] [FX-005] the keys run as Fansly’s client of the scheme: `fansly` — Coach of the extension’s rows, and its Notes row (R20 P11b: the `notes` command)', () => {
    expect(FANSLY_ADAPTER.hotkeyClient).toBe('fansly');
    const w = world('win');
    w.connect();
    w.field.focus();
    w.chord(w.field, 'KeyC', 'c', panel('win'));
    const notes = w.chord(w.field, 'KeyK', 'k', panel('win'));
    expect(w.ran).toEqual(['coach@dock', 'notes@dock']);
    expect(notes.defaultPrevented).toBe(true);
    expect(w.refused).toEqual([]);
  });

  for (const scheme of ['mac', 'win'] as const) {
    it(`[HK-028] [HK-026] (${scheme}) in Fansly’s message field our keys are ours before Fansly hears them: Reply runs, nothing of the page sees the letter; Enter, typing and a key not ours are Fansly’s`, () => {
      const w = world(scheme);
      w.connect();
      w.field.focus();
      const reply = w.chord(w.field, 'KeyE', 'e');
      expect(reply.defaultPrevented).toBe(true);
      expect(w.ran).toEqual(['reply@dock']);
      expect(w.page).not.toContain('KeyE');
      expect(w.onField).not.toContain('KeyE');
      // Enter in the field is Fansly's: it sends, and nothing of ours stopped or cancelled it.
      const enter = press(w.field, scheme, 'Enter', 'Enter');
      expect([enter.defaultPrevented, w.sent, w.page.at(-1), w.onField.at(-1)]).toEqual([false, 1, 'Enter', 'Enter']);
      // `?`, J and ] typed into the field are text.
      for (const [code, key, mods] of [['Slash', '?', { shift: true }], ['KeyJ', 'j', {}], ['BracketRight', ']', {}]] as const) {
        expect([key, press(w.field, scheme, code, key, mods).defaultPrevented]).toEqual([key, false]);
      }
      // ⌘/Ctrl+C is nobody's here but the browser's.
      expect(w.chord(w.field, 'KeyC', 'c').defaultPrevented).toBe(false);
      expect(w.ran).toEqual(['reply@dock']);
    });
  }

  it('[HK-011] (mac) ⌘⇧L in Fansly’s field is our Split (X37): FBuddy’s translate on the field never hears it', () => {
    const w = world('mac');
    w.connect();
    w.field.value = 'hello';
    w.field.focus();
    const split = w.chord(w.field, 'KeyL', 'l', panel('mac'));
    expect([split.defaultPrevented, w.ran, w.translated]).toEqual([true, ['split@dock'], 0]);
    expect(w.onField).not.toContain('KeyL');
  });

  it('[HK-011] (win) Ctrl+Alt+L is our Split; FBuddy’s Ctrl+Shift+L is not ours and still translates', () => {
    const w = world('win');
    w.connect();
    w.field.focus();
    const split = w.chord(w.field, 'KeyL', 'l', panel('win'));
    expect([split.defaultPrevented, w.ran, w.translated]).toEqual([true, ['split@dock'], 0]);
    const theirs = w.chord(w.field, 'KeyL', 'l', { shift: true });
    expect([theirs.defaultPrevented, w.ran, w.translated]).toEqual([true, ['split@dock'], 1]);
    expect(w.onField).toContain('KeyL');
  });

  it('[HK-028] the mini-chat’s field is another field of the site: an AI key there is taken and says why, nothing runs', () => {
    const w = world('win');
    w.connect();
    w.mini.focus();
    expect(w.chord(w.mini, 'KeyE', 'e').defaultPrevented).toBe(true);
    expect([w.ran, w.refused]).toEqual([[], [['reply', 'in-field']]]);
  });

  it('[HK-029] a modal of Fansly (`body.modal-opened`) has the keys: Esc and the letters are its own, a key of ours runs nothing over it and says why; closed — ours again', () => {
    const w = world('win');
    w.connect();
    document.body.classList.add('modal-opened');
    const target = document.body;
    for (const [code, key, mods] of [['Escape', 'Escape', {}], ['Slash', '?', { shift: true }], ['KeyJ', 'j', {}], ['BracketRight', ']', {}]] as const) {
      expect([key, press(target, 'win', code, key, mods).defaultPrevented]).toEqual([key, false]);
    }
    expect(w.page).toEqual(['Escape', 'Slash', 'KeyJ', 'BracketRight']);
    const reply = w.chord(target, 'KeyE', 'e');
    expect([reply.defaultPrevented, w.ran, w.refused]).toEqual([true, [], [['reply', 'overlay-open']]]);
    document.body.classList.remove('modal-opened');
    press(target, 'win', 'Slash', '?', { shift: true });
    expect(w.ran).toEqual(['cheatsheet@global']);
  });

  it('[HK-029] the focus in FBuddy’s window (an `fb-*-ui` host): what is typed into its notes is its own — `?`, J, ], Esc —; a key of ours runs nothing there', () => {
    const w = world('win');
    w.connect();
    w.neighbourNotes.focus();
    for (const [code, key, mods] of [['Slash', '?', { shift: true }], ['KeyJ', 'j', {}], ['BracketRight', ']', {}], ['Escape', 'Escape', {}]] as const) {
      expect([key, press(w.neighbourNotes, 'win', code, key, mods).defaultPrevented]).toEqual([key, false]);
    }
    expect(w.chord(w.neighbourNotes, 'KeyE', 'e').defaultPrevented).toBe(true);
    expect([w.ran, w.refused]).toEqual([[], [['reply', 'overlay-open']]]);
    // Back in Fansly's field: ours again.
    w.field.focus();
    w.chord(w.field, 'KeyE', 'e');
    expect(w.ran).toEqual(['reply@dock']);
  });

  it('[HK-024] before the lazy part is loaded: a key of ours in a chat is kept — Fansly never hears it, the dock host says «waiting», the application is asked for — and runs once it connects', () => {
    const w = world('win');
    w.field.focus();
    const pressed = w.chord(w.field, 'KeyL', 'l', panel('win'));
    expect([pressed.defaultPrevented, w.waiting, w.mounts.dock.host.hasAttribute(KEY_PENDING_ATTRIBUTE)]).toEqual([true, [1], true]);
    expect([w.translated, w.onField]).toEqual([0, []]);
    w.connect();
    expect([w.ran, w.mounts.dock.host.hasAttribute(KEY_PENDING_ATTRIBUTE)]).toEqual([['split@dock'], false]);
  });

  it('[HK-024] [HK-026] outside a chat (the inbox) only the global keys are ours: `?` and Spenders wait for the application; Reply is Fansly’s', () => {
    const w = world('win', '/messages');
    const reply = w.chord(document.body, 'KeyE', 'e');
    expect([reply.defaultPrevented, w.waiting]).toEqual([false, []]);
    const spenders = w.chord(document.body, 'KeyM', 'm', panel('win'));
    expect([spenders.defaultPrevented, w.waiting]).toEqual([true, [1]]);
    w.connect();
    expect(w.ran).toEqual(['spenders@global']);
    press(document.body, 'win', 'Slash', '?', { shift: true });
    expect(w.ran).toEqual(['spenders@global', 'cheatsheet@global']);
  });

  it('[UI-019] a held Enter that went down in our UI never reaches Fansly’s field: its repeats are stopped there — Fansly sends nothing — and a fresh press is Fansly’s', () => {
    const w = world('win');
    w.connect();
    const ours = w.mounts.overlay('toast').host;
    press(ours, 'win', 'Enter', 'Enter');
    w.field.focus();
    const repeats = [press(w.field, 'win', 'Enter', 'Enter', { repeat: true }), press(w.field, 'win', 'Enter', 'Enter', { repeat: true })];
    expect(repeats.map((event) => event.defaultPrevented)).toEqual([true, true]);
    expect([w.sent, w.onField]).toEqual([0, []]);
    press(w.field, 'win', 'Enter', 'Enter', {}, 'keyup');
    press(w.field, 'win', 'Enter', 'Enter');
    expect(w.sent).toBe(1);
  });
});
