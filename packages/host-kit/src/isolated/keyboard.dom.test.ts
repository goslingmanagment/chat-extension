// The page side of the early hotkey dispatcher on a real DOM (happy-dom):
// where the focus is, whether the site has something of its own open, and
// the hand-over of a key into our closed root (architecture.md §9.1, D-18).
// The site here is a made-up one: its message field is `.site-field`, and it
// says itself when a window of its own is open. ChatSpace's two rules are
// tested with ChatSpace (host-chatspace/src/isolated/keyboard.dom.test.ts).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mountClosedHost, type ClosedHost } from './hosts';
import { DELIVERED_KEY_MARK, KEY_PENDING_ATTRIBUTE, createKeyPendingMark, createKeyboardProbe, isTypingTarget, type KeyboardProbe } from './keyboard';
import { createShadowRootRegistry, type ShadowRootRegistry } from './shadow-registry';

/** A key the browser itself dispatched (happy-dom marks every scripted event untrusted). */
function trustedKey(type: string, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, composed: true, ...init });
  Object.defineProperty(event, 'isTrusted', { value: true });
  return event;
}

let registry: ShadowRootRegistry;
let probe: KeyboardProbe;
let ours: ClosedHost;
/** What the site answers when asked whether a window of its own is open. */
let siteWindowOpen = false;

beforeEach(() => {
  document.body.replaceChildren();
  siteWindowOpen = false;
  registry = createShadowRootRegistry();
  probe = createKeyboardProbe(
    document,
    registry,
    (active) => active.closest('.site-field') !== null,
    () => siteWindowOpen,
  );
  // The site's composer: a root with its message field inside a frame, and our dock as the root's first child.
  const composerRoot = document.createElement('div');
  const frame = document.createElement('div');
  const editor = document.createElement('div');
  editor.className = 'site-field';
  editor.setAttribute('contenteditable', 'true');
  editor.tabIndex = 0;
  frame.append(editor);
  composerRoot.append(frame);
  const search = document.createElement('input');
  search.id = 'site-search';
  const button = document.createElement('button');
  button.id = 'site-button';
  document.body.append(composerRoot, search, button);
  ours = mountClosedHost(composerRoot, 'dock', 'first', registry);
});

afterEach(() => {
  ours.remove();
});

function inOurRoot<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  if (tag === 'div') element.tabIndex = 0;
  ours.root.append(element);
  return element;
}

describe('where the focus is', () => {
  it('[HK-028] the site\'s message field — the site says which one it is — another field of the site, a plain element and nothing at all are told apart', () => {
    const key = trustedKey('keydown', { key: 'j', code: 'KeyJ' });
    expect(probe.focus(key)).toBe('page');
    document.querySelector<HTMLElement>('.site-field')?.focus();
    expect(probe.focus(key)).toBe('composer');
    document.querySelector<HTMLElement>('#site-search')?.focus();
    expect(probe.focus(key)).toBe('field');
    document.querySelector<HTMLElement>('#site-button')?.focus();
    expect(probe.focus(key)).toBe('page');
  });

  it('[HK-028] focus inside our closed root is read through the registry: a field of ours, or the rest of our UI', () => {
    const key = trustedKey('keydown', { key: 'j', code: 'KeyJ' });
    const card = inOurRoot('div', { 'data-part': '1' });
    card.focus();
    expect(document.activeElement).toBe(ours.host);
    expect(probe.focus(key)).toBe('ours');
    inOurRoot('input', { type: 'search' }).focus();
    expect(probe.focus(key)).toBe('ours-field');
    inOurRoot('textarea').focus();
    expect(probe.focus(key)).toBe('ours-field');
    inOurRoot('button').focus();
    expect(probe.focus(key)).toBe('ours');
    // A host that is no longer registered is not ours any more.
    ours.remove();
    expect(probe.focus(key)).toBe('page');
  });

  it('a key that came through our host is ours even when the root\'s focus cannot be read', () => {
    const card = inOurRoot('div');
    const events: KeyFocusProbe[] = [];
    type KeyFocusProbe = ReturnType<KeyboardProbe['focus']>;
    window.addEventListener('keydown', (event) => events.push(probe.focus(event)), { capture: true, once: true });
    // Dispatched on an element of ours that does not hold the focus: only the composed path names our host.
    card.dispatchEvent(trustedKey('keydown', { key: 'Enter', code: 'Enter' }));
    expect(events).toEqual(['ours']);
  });

  it('what a person types into: text inputs, textareas, selects, contenteditable and text roles — not buttons or checkboxes', () => {
    const make = (tag: string, attributes: Record<string, string> = {}): Element => {
      const element = document.createElement(tag);
      for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
      document.body.append(element);
      return element;
    };
    for (const element of [make('textarea'), make('select'), make('input'), make('input', { type: 'search' }), make('input', { type: 'NUMBER' }), make('div', { contenteditable: 'true' }), make('div', { contenteditable: '' }), make('div', { role: 'textbox' }), make('div', { role: 'combobox' })]) {
      expect([element.outerHTML, isTypingTarget(element)]).toEqual([element.outerHTML, true]);
    }
    const editable = make('div', { contenteditable: 'true' });
    const inner = document.createElement('span');
    editable.append(inner);
    expect(isTypingTarget(inner)).toBe(true);
    for (const element of [make('button'), make('input', { type: 'checkbox' }), make('input', { type: 'submit' }), make('div'), make('a', { href: '#' }), make('div', { contenteditable: 'false' })]) {
      expect([element.outerHTML, isTypingTarget(element)]).toEqual([element.outerHTML, false]);
    }
  });
});

describe('a window of the site itself', () => {
  it('[HK-029] is the site\'s own answer, asked at every key: the probe adds nothing to it, and a window of ours changes nothing', () => {
    expect(probe.nativeModalOpen()).toBe(false);
    inOurRoot('div', { role: 'dialog', 'aria-modal': 'true' });
    expect(probe.nativeModalOpen()).toBe(false);
    siteWindowOpen = true;
    expect(probe.nativeModalOpen()).toBe(true);
    siteWindowOpen = false;
    expect(probe.nativeModalOpen()).toBe(false);
  });
});

describe('handing a key to our UI', () => {
  it('[HK-029] [HK-030] the copy reaches the focused element and its ancestors inside our root, and nothing outside it', () => {
    const list = inOurRoot('div');
    const card = document.createElement('div');
    card.tabIndex = 0;
    list.append(card);
    card.focus();
    const inside: string[] = [];
    const outside: string[] = [];
    // The copy is a scripted event: our UI sees it as such (isTrusted is not true).
    card.addEventListener('keydown', (event) => inside.push(`card:${event.key}:${String(event.isTrusted === true)}`));
    list.addEventListener('keydown', (event) => inside.push(`list:${event.key}`));
    ours.host.addEventListener('keydown', () => outside.push('host'));
    document.addEventListener('keydown', () => outside.push('document'), true);
    window.addEventListener('keydown', () => outside.push('window'), true);
    const original = trustedKey('keydown', { key: 'Enter', code: 'Enter', shiftKey: true, keyCode: 13 });
    expect(probe.deliver(original)).toBe(false);
    expect(inside).toEqual(['card:Enter:false', 'list:Enter']);
    expect(outside).toEqual([]);
    expect(original.defaultPrevented).toBe(false);
  });

  it('the copy carries the key as it was pressed; our UI taking it is reported back; only a delivered copy is marked', () => {
    const field = inOurRoot('input');
    field.focus();
    let seen: KeyboardEvent | null = null;
    field.addEventListener('keydown', (event) => {
      seen = event;
      event.preventDefault();
    });
    const original = trustedKey('keydown', { key: 'Escape', code: 'Escape', ctrlKey: true, altKey: true, metaKey: true, repeat: true, keyCode: 27 });
    expect(probe.deliver(original)).toBe(true);
    const copy = seen as KeyboardEvent | null;
    expect(copy).toMatchObject({ type: 'keydown', key: 'Escape', code: 'Escape', ctrlKey: true, altKey: true, metaKey: true, shiftKey: false, repeat: true, keyCode: 27, composed: false, bubbles: true, cancelable: true });
    // A plain Event with the key's fields: Gecko would make a KeyboardEvent of type keydown composed again.
    expect(copy instanceof KeyboardEvent).toBe(false);
    expect(copy?.getModifierState('Control')).toBe(true);
    expect(copy?.getModifierState('Shift')).toBe(false);
    expect(copy !== null && probe.isDelivered(copy)).toBe(true);
    expect(probe.isDelivered(original)).toBe(false);
  });

  it('a copy is the person\'s own key for §14 although its isTrusted is false: it carries the mark our UI can read without importing the adapter, and nothing else does', () => {
    const row = inOurRoot('div');
    row.tabIndex = 0;
    row.focus();
    const seen: Event[] = [];
    row.addEventListener('keydown', (event) => seen.push(event));
    const original = trustedKey('keydown', { key: 'Enter', code: 'Enter' });
    probe.deliver(original);
    const copy = seen[0] as unknown as Record<symbol, unknown>;
    // What a surface writes: no import of this package, the registry symbol by its name.
    const personKey = (event: Event): boolean => event.isTrusted || (event as unknown as Record<symbol, unknown>)[Symbol.for('cg.key.delivered')] === true;
    expect(DELIVERED_KEY_MARK).toBe(Symbol.for('cg.key.delivered'));
    expect([seen[0]?.isTrusted === true, copy[DELIVERED_KEY_MARK], personKey(seen[0] as Event)]).toEqual([false, true, true]);
    // Read-only and out of sight of spreads and loops over the event's own fields.
    expect(Object.getOwnPropertyDescriptor(copy, DELIVERED_KEY_MARK)).toEqual({ value: true, writable: false, enumerable: false, configurable: false });
    // Neither the real key nor a scripted event carries it; a scripted event is not a person's key.
    const scripted = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true });
    expect([(original as unknown as Record<symbol, unknown>)[DELIVERED_KEY_MARK], (scripted as unknown as Record<symbol, unknown>)[DELIVERED_KEY_MARK], personKey(scripted)]).toEqual([undefined, undefined, false]);
    // A scripted key is never copied, so it never gets the mark either.
    probe.deliver(scripted);
    expect(seen).toHaveLength(1);
  });

  it('a synthetic key of the page is never copied into our UI, and nothing is delivered when our UI has no focus', () => {
    const card = inOurRoot('div');
    card.focus();
    let hits = 0;
    card.addEventListener('keydown', () => (hits += 1));
    expect(probe.deliver(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter' }))).toBe(false);
    document.querySelector<HTMLElement>('#site-button')?.focus();
    expect(probe.deliver(trustedKey('keydown', { key: 'Enter', code: 'Enter' }))).toBe(false);
    expect(hits).toBe(0);
  });
});

describe('a key that waits', () => {
  it('[HK-024] the dock host carries data-pending and aria-busy from the keydown until the key runs or is dropped', () => {
    const mark = createKeyPendingMark(ours.host);
    expect(ours.host.hasAttribute(KEY_PENDING_ATTRIBUTE)).toBe(false);
    mark(true);
    expect([ours.host.getAttribute(KEY_PENDING_ATTRIBUTE), ours.host.getAttribute('aria-busy')]).toEqual(['', 'true']);
    mark(true);
    mark(false);
    expect([ours.host.hasAttribute(KEY_PENDING_ATTRIBUTE), ours.host.hasAttribute('aria-busy')]).toEqual([false, false]);
    // Nothing else on the host is touched.
    expect(ours.host.getAttribute('data-host')).toBe('dock');
  });
});
