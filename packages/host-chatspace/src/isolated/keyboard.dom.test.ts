// ChatSpace's side of the early hotkey dispatcher on a real DOM (happy-dom):
// which field is ChatSpace's message field, whether ChatSpace has something
// of its own open, and the route by the address (architecture.md §9.1, D-18).
// The probe itself — the focus inside our closed root, the hand-over of a key
// into it, the mark of a waiting key — is tested where it lives
// (@cg/host-kit/isolated/keyboard.dom.test.ts).

import { mountClosedHost, type ClosedHost } from '@cg/host-kit/isolated/hosts';
import type { KeyboardProbe } from '@cg/host-kit/isolated/keyboard';
import { createShadowRootRegistry } from '@cg/host-kit/isolated/shadow-registry';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createKeyboardProbe, routeOfLocation } from './keyboard';

/** A key the browser itself dispatched (happy-dom marks every scripted event untrusted). */
function trustedKey(type: string, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, composed: true, ...init });
  Object.defineProperty(event, 'isTrusted', { value: true });
  return event;
}

let probe: KeyboardProbe;
let ours: ClosedHost;

beforeEach(() => {
  document.body.replaceChildren();
  const registry = createShadowRootRegistry();
  probe = createKeyboardProbe(document, registry);
  // ChatSpace's composer: div.relative > .composer-frame > .ProseMirror, with our dock as the root's first child.
  const composerRoot = document.createElement('div');
  composerRoot.className = 'relative';
  const frame = document.createElement('div');
  frame.className = 'composer-frame';
  const editor = document.createElement('div');
  editor.className = 'ProseMirror';
  editor.setAttribute('contenteditable', 'true');
  editor.tabIndex = 0;
  // Something else a person types into inside the composer frame: ChatSpace's own too.
  const caption = document.createElement('input');
  caption.id = 'frame-input';
  frame.append(editor, caption);
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

describe('where the focus is', () => {
  it('[HK-028] ChatSpace\'s message field — the Tiptap surface or anything editable inside the composer frame — another field of the site, a plain element and nothing at all are told apart', () => {
    const key = trustedKey('keydown', { key: 'j', code: 'KeyJ' });
    expect(probe.focus(key)).toBe('page');
    document.querySelector<HTMLElement>('.ProseMirror')?.focus();
    expect(probe.focus(key)).toBe('composer');
    document.querySelector<HTMLElement>('#frame-input')?.focus();
    expect(probe.focus(key)).toBe('composer');
    document.querySelector<HTMLElement>('#site-search')?.focus();
    expect(probe.focus(key)).toBe('field');
    document.querySelector<HTMLElement>('#site-button')?.focus();
    expect(probe.focus(key)).toBe('page');
  });
});

describe('a window of ChatSpace itself', () => {
  it('[HK-029] a visible dialog, menu or list of the site counts; ours never do — they live in closed roots', () => {
    expect(probe.nativeModalOpen()).toBe(false);
    const ourDialog = document.createElement('div');
    ourDialog.setAttribute('role', 'dialog');
    ourDialog.setAttribute('aria-modal', 'true');
    ours.root.append(ourDialog);
    expect(ourDialog.isConnected).toBe(true);
    expect(probe.nativeModalOpen()).toBe(false);
    for (const role of ['dialog', 'alertdialog', 'listbox', 'menu']) {
      const overlay = document.createElement('div');
      overlay.setAttribute('role', role);
      document.body.append(overlay);
      expect([role, probe.nativeModalOpen()]).toEqual([role, true]);
      // Rendered but hidden is not open.
      overlay.checkVisibility = () => false;
      expect([role, probe.nativeModalOpen()]).toEqual([role, false]);
      overlay.remove();
    }
  });
});

describe('the route by the address', () => {
  it('[HK-024] a chat, an account\'s list and the rest of ChatSpace are told apart before MAIN reports anything', () => {
    expect(routeOfLocation({ pathname: '/accounts/1001/chats/2002' })).toEqual({ kind: 'chat', epoch: '/accounts/1001/chats/2002' });
    expect(routeOfLocation({ pathname: '/accounts/1001/chats/2002/' }).kind).toBe('chat');
    expect(routeOfLocation({ pathname: '/accounts/1001/chats' }).kind).toBe('account');
    expect(routeOfLocation({ pathname: '/accounts/1001/chats/' }).kind).toBe('account');
    for (const pathname of ['/', '/accounts', '/accounts/1001', '/accounts/abc/chats/2002', '/accounts/1001/chats/2002/media', '/settings', '/accounts/0/chats/1']) {
      expect([pathname, routeOfLocation({ pathname }).kind]).toEqual([pathname, 'other']);
    }
  });
});
