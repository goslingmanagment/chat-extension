// Fansly's side of the early hotkey dispatcher on a Fansly-like DOM (R20 P7i;
// docs/project-unite/architecture.md §7.9; FS-HK-1): which field is Fansly's
// message field — the conversation's, under the route, never the mini-chat's
// — and when a window that is not ours has the keys: a modal of Fansly
// (`body.modal-opened`) or the focus in one of FBuddy's hosts (`fb-*-ui`).
// The probe's shared part — the focus inside our closed root, the hand-over
// of a key into it — is tested where it lives (@cg/host-kit/isolated/
// keyboard.dom.test.ts); the dispatcher over this probe, with the keys a
// person presses: apps/extension/src/composition/tab/hosts/fansly/keys.test.ts;
// in Firefox: packages/testing/e2e/specs/suite-fansly-host.e2e.ts.

import { mountClosedHost, type ClosedHost } from '@cg/host-kit/isolated/hosts';
import type { KeyboardProbe } from '@cg/host-kit/isolated/keyboard';
import { createShadowRootRegistry } from '@cg/host-kit/isolated/shadow-registry';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFakeFanslyPage, type FakeFanslyPage } from '../testing/fake-dom';
import { createKeyboardProbe, fanslyWindowOpen, focusInNeighbor, isFanslyComposer } from './keyboard';

const A = '700000000000000010';

/** A key the browser itself dispatched (happy-dom marks every scripted event untrusted). */
function trustedKey(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, composed: true, ...init });
  Object.defineProperty(event, 'isTrusted', { value: true });
  return event;
}

/** One of FBuddy's hosts as it makes them: a custom element `fb-<feature>-ui` with an OPEN root and its own controls inside. */
function neighborHost(tag: string, inside: 'textarea' | 'button'): { readonly host: HTMLElement; readonly control: HTMLElement } {
  if (customElements.get(tag) === undefined) customElements.define(tag, class extends HTMLElement {});
  const host = document.createElement(tag);
  const root = host.attachShadow({ mode: 'open' });
  const control = document.createElement(inside);
  control.tabIndex = 0;
  root.append(control);
  return { host, control };
}

let page: FakeFanslyPage;
let probe: KeyboardProbe;
let ours: ClosedHost;

beforeEach(() => {
  page = createFakeFanslyPage();
  page.openChat(A);
  const registry = createShadowRootRegistry();
  probe = createKeyboardProbe(document, registry);
  const container = page.container();
  if (container === null) throw new Error('no container');
  ours = mountClosedHost(container, 'dock', 'first', registry);
});

afterEach(() => {
  ours.remove();
  page.destroy();
  document.body.className = '';
  for (const node of [...document.body.children]) node.remove();
  history.replaceState({}, '', '/');
});

const key = trustedKey({ key: 'j', code: 'KeyJ' });

describe('[host:fansly] where the focus is (FS-HK-1)', () => {
  it('[HK-028] the open conversation’s `textarea.message-input` is Fansly’s message field; the mini-chat’s, a search field, a button and nothing at all are not', () => {
    expect(probe.focus(key)).toBe('page');
    const field = page.textarea();
    field?.focus();
    expect(document.activeElement).toBe(field);
    expect(probe.focus(key)).toBe('composer');
    // The mini-chat repeats the container's classes outside the route (§7.3): another field of the site.
    page.miniChat(true);
    const mini = document.querySelector<HTMLTextAreaElement>('app-messaging-overlay textarea.message-input');
    mini?.focus();
    expect(document.activeElement).toBe(mini);
    expect(probe.focus(key)).toBe('field');
    const search = document.createElement('input');
    document.body.append(search);
    search.focus();
    expect(probe.focus(key)).toBe('field');
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    expect(probe.focus(key)).toBe('page');
  });

  it('[HK-028] a field the dock covers with an overlay (no container’s chain, FS-PLC-3) is still the conversation’s field: under the route is enough', () => {
    const route = page.route();
    const stray = document.createElement('textarea');
    stray.className = 'message-input';
    route?.append(stray);
    expect(isFanslyComposer(stray)).toBe(true);
    stray.focus();
    expect(probe.focus(key)).toBe('composer');
    // The same field outside any conversation is not Fansly's message field.
    document.body.append(stray);
    expect(isFanslyComposer(stray)).toBe(false);
  });
});

describe('[host:fansly] where the focus is now, with no key in hand (decision X44)', () => {
  it('[UI-023] the dock asks before it hands the focus to the next part: none, the conversation’s field, the mini-chat’s, ours', () => {
    expect(probe.now()).toBe('none');
    page.textarea()?.focus();
    expect(probe.now()).toBe('composer');
    page.miniChat(true);
    document.querySelector<HTMLTextAreaElement>('app-messaging-overlay textarea.message-input')?.focus();
    expect(probe.now()).toBe('field');
    const card = document.createElement('div');
    card.tabIndex = 0;
    ours.root.append(card);
    card.focus();
    expect(probe.now()).toBe('ours');
  });
});

describe('[host:fansly] a window that is not ours (FS-HK-1)', () => {
  it('[HK-029] a modal of Fansly: `body.modal-opened` while any stands — read in O(1), and gone with it', () => {
    expect(probe.nativeModalOpen()).toBe(false);
    document.body.classList.add('modal-opened');
    expect(probe.nativeModalOpen()).toBe(true);
    document.body.classList.remove('modal-opened');
    expect(probe.nativeModalOpen()).toBe(false);
    // Our own windows live in closed roots: a dialog of ours is never «a window of the site».
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    ours.root.append(dialog);
    expect(probe.nativeModalOpen()).toBe(false);
  });

  it('[HK-029] the focus inside one of FBuddy’s hosts — its notes field, a button of its panel, its toasts — is its window; the host merely standing in the page is not', () => {
    const notes = neighborHost('fb-notes-panel-ui', 'textarea');
    const toasts = neighborHost('fb-body-shadow-root-ui', 'button');
    document.body.prepend(toasts.host);
    page.composer()?.append(notes.host);
    expect(fanslyWindowOpen(document)).toBe(false);
    notes.control.focus();
    // The document names the outermost host: that is all the probe reads of FBuddy's own root.
    expect(document.activeElement).toBe(notes.host);
    expect([focusInNeighbor(document), probe.nativeModalOpen()]).toEqual([true, true]);
    // Not Fansly's field: the composer's subtree holds the host, the focus is FBuddy's.
    expect(probe.focus(key)).toBe('page');
    toasts.control.focus();
    expect(probe.nativeModalOpen()).toBe(true);
    page.textarea()?.focus();
    expect([probe.nativeModalOpen(), probe.focus(key)]).toEqual([false, 'composer']);
    // A slotted node of a host counts as inside it; an element merely named like FBuddy's does not.
    const slotted = document.createElement('button');
    notes.host.append(slotted);
    slotted.focus();
    expect(focusInNeighbor(document)).toBe(true);
    const lookalike = document.createElement('fb-notes');
    const inside = document.createElement('button');
    lookalike.append(inside);
    document.body.append(lookalike);
    inside.focus();
    expect(focusInNeighbor(document)).toBe(false);
  });
});
