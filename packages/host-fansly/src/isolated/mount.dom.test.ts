// The dock's place on a Fansly page and the narrow observers that keep it (R20 P7d; docs/project-unite/
// architecture.md §7.3; FS-PLC-1…4, FS-DOCK-2, FS-DOCK-3, FS-CTR-2): Fansly's own start, as the extension starts it,
// over a Fansly-like DOM (testing/fake-dom.ts) — MAIN is not there, the anchors and the port are. In Firefox, on the
// stand, next to the neighbour, with our real dock in it: suite-fansly-dock.e2e.ts.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeFanslyPage, type FakeFanslyPage } from '../testing/fake-dom';
import { DOCK_Z, spotOf } from './mount';
import { startFanslyTab, type StartedFanslyTab } from './starter';
import type { FanslyPort } from './host-port';
import { loadValidation } from './validation';

const GROUPS = Array.from({ length: 4 }, (_, index) => `70000000000000002${index}`);
const [A = '', B = ''] = GROUPS;

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.documentElement.className = '';
  history.replaceState({}, '', '/');
});

const settle = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Our `input` listeners on the page's fields, per element: added minus removed (the port's revision count). */
function listenerCounts(): { of(element: Element | null): number; restore(): void } {
  const add = vi.spyOn(HTMLTextAreaElement.prototype, 'addEventListener');
  const remove = vi.spyOn(HTMLTextAreaElement.prototype, 'removeEventListener');
  const count = (spy: typeof add | typeof remove, element: Element): number =>
    spy.mock.calls.filter((call, index) => call[0] === 'input' && spy.mock.contexts[index] === element).length;
  return {
    of: (element) => (element === null ? 0 : count(add, element) - count(remove, element)),
    restore() {
      add.mockRestore();
      remove.mockRestore();
    },
  };
}

async function start(path = '/messages'): Promise<{ page: FakeFanslyPage; started: StartedFanslyTab; port: FanslyPort }> {
  history.replaceState({}, '', path);
  const page = createFakeFanslyPage();
  const started = startFanslyTab({ win: window, validation: loadValidation, handshakeTimeoutMs: 20 });
  const port = await started.host;
  cleanups.push(
    () => port.dispose(),
    () => page.destroy(),
  );
  return { page, started, port };
}

const dockOf = (started: StartedFanslyTab): HTMLElement => started.mounts.dock.host;

describe('[host:fansly] the dock’s place (FS-PLC-1…3)', () => {
  it('[FS-PLC-1] in flow right before the composer, a child of the container: a host without classes, over the typing line, the field’s width untouched', async () => {
    const { page, started, port } = await start();
    page.openChat(A);
    await settle();
    const host = dockOf(started);
    expect(host.parentElement).toBe(page.container());
    expect(host.nextElementSibling).toBe(page.composer());
    expect([host.localName, host.className, host.getAttribute('data-host'), host.hasAttribute('data-mode')]).toEqual(['div', '', 'dock', false]);
    const style = host.style;
    expect([style.getPropertyValue('flex'), style.getPropertyValue('position'), style.getPropertyValue('z-index'), style.getPropertyValue('display')]).toEqual(['0 0 auto', 'relative', String(DOCK_Z), 'block']);
    expect(port.mounts().dock).toMatchObject({ kind: 'in-flow', composerInstanceId: expect.stringMatching(/^f\d+$/) as unknown });
    // The typing line comes and goes between the feed and us: nothing of ours moves or wakes.
    const { moves } = started.mounts.stats();
    const callbacks = started.anchors.stats();
    page.typing(true);
    await settle();
    page.typing(false);
    await settle();
    expect(started.mounts.stats().moves).toBe(moves);
    expect(started.anchors.stats()).toEqual(callbacks);
  });

  it('[FS-PLC-2] a chat switch makes the container anew: the same host, root and all, moves into it — once; the old, detached container keeps nothing of ours', async () => {
    const { page, started, port } = await start();
    page.openChat(A);
    await settle();
    const host = dockOf(started);
    const root = started.mounts.dock.root;
    const first = page.container();
    const before = started.mounts.stats().moves;
    page.openChat(B);
    await settle();
    expect(page.container()).not.toBe(first);
    expect(first?.isConnected).toBe(false);
    expect(first?.contains(host)).toBe(false);
    expect(dockOf(started)).toBe(host);
    expect(started.mounts.dock.root).toBe(root);
    expect(host.parentElement).toBe(page.container());
    expect(host.nextElementSibling).toBe(page.composer());
    expect(started.mounts.stats().moves).toBe(before + 1);
    expect(port.mounts().dock.kind).toBe('in-flow');
  });

  it('[FS-PLC-3] [RB-008] the container’s anchor gone in a new build, a field still under the route: a fixed overlay over that field in <html>, which pushes no feed', async () => {
    const { page, started, port } = await start();
    page.openChat(A);
    await settle();
    const container = page.container() as Element;
    const renamed = document.createElement('app-group-message-container-v2');
    renamed.append(...container.childNodes);
    container.replaceWith(renamed);
    await settle();
    const host = dockOf(started);
    expect(host.parentElement).toBe(document.documentElement);
    expect([host.getAttribute('data-mode'), host.style.getPropertyValue('position'), host.style.getPropertyValue('z-index')]).toEqual(['overlay', 'fixed', '900']);
    expect(port.mounts().dock.kind).toBe('fixed-overlay');
    expect(port.probe().extensions['fansly-web'].anchors.container).toBe('missing');
    // The next chat with the chain as it was: back in flow, dressed for it.
    page.openChat(B);
    await settle();
    expect(host.parentElement).toBe(page.container());
    expect([host.hasAttribute('data-mode'), host.style.getPropertyValue('position'), host.style.getPropertyValue('bottom')]).toEqual([false, 'relative', '']);
  });

  it('[FS-CTR-2] a container without the composer’s anchor and no field in it: the dock at its end, no field to name — copy only', () => {
    const route = document.createElement('app-messages-conversation-route');
    const container = document.createElement('app-group-message-container');
    container.append(document.createElement('div'));
    route.append(container);
    document.body.append(route);
    cleanups.push(() => route.remove());
    const conversation = { route, header: null, headerRow: null, contact: null, subRow: null, gallery: false, container, composer: null, textarea: null, sendButton: null, fileInput: null, attachments: null, copyOnly: false, strayField: false };
    expect(spotOf({ conversation, group: false, copyOnly: false, composerInstanceId: null })).toEqual({ kind: 'in-flow', at: container, before: null });
    // Detached nodes are nobody's: nothing is placed into them.
    route.remove();
    expect(spotOf({ conversation, group: false, copyOnly: false, composerInstanceId: null }).kind).toBe('none');
  });
});

describe('[host:fansly] where the dock is not, and copy only (FS-DOCK-2, FS-DOCK-3)', () => {
  it('[UI-012] the gallery, the inbox, another page, a group chat and the mini-chat: no dock', async () => {
    const { page, started, port } = await start();
    page.miniChat(true);
    page.openChat(A);
    await settle();
    const host = dockOf(started);
    expect(host.isConnected).toBe(true);
    // The mini-chat repeats the container's classes: the dock is never in it.
    expect(host.closest('app-messaging-overlay')).toBeNull();
    page.gallery(true);
    await settle();
    expect([host.isConnected, port.mounts().dock.kind]).toEqual([false, 'none']);
    page.gallery(false);
    await settle();
    expect(host.parentElement).toBe(page.container());
    page.openInbox();
    await settle();
    expect(host.isConnected).toBe(false);
    page.openChat(B);
    await settle();
    page.openHome();
    await settle();
    expect(host.isConnected).toBe(false);
    // MAIN says the group has more than one fan: the anchors are there, the dock is not.
    page.openChat(A);
    await settle();
    expect(host.isConnected).toBe(true);
    const conversation = started.anchors.current().conversation;
    expect(spotOf({ conversation, group: true, copyOnly: false, composerInstanceId: null }).kind).toBe('none');
    started.mounts.place({ conversation, group: true, copyOnly: false, composerInstanceId: null });
    expect(host.isConnected).toBe(false);
  });

  it('[UI-027] the DM rules unmet without a change of address: the dock stays in its place, copy only — and back', async () => {
    const { page, started, port } = await start();
    page.openChat(A);
    await settle();
    const host = dockOf(started);
    const moves = started.mounts.stats().moves;
    page.setCopyOnly(true);
    await settle();
    expect(host.nextElementSibling).toBe(page.composer());
    expect([host.getAttribute('data-mode'), port.mounts().dock.kind, port.mounts().dock.composerInstanceId]).toEqual(['copy-only', 'copy-only-row', null]);
    page.setCopyOnly(false);
    await settle();
    expect([host.hasAttribute('data-mode'), port.mounts().dock.kind]).toEqual([false, 'in-flow']);
    expect(started.mounts.stats().moves).toBe(moves);
    // A chat whose rules are unmet from its first moment.
    page.openChat(B, { copyOnly: true });
    await settle();
    expect(port.mounts().dock.kind).toBe('copy-only-row');
  });
});

describe('[host:fansly] the narrow observers of the field and the header (FS-PLC-4)', () => {
  it('[FS-PLC-4] the field made anew without a change of address: seen by the composer’s observer, our listener follows it — one, on the field in the page; the dock does not move', async () => {
    const counts = listenerCounts();
    cleanups.push(() => counts.restore());
    const { page, started, port } = await start();
    page.openChat(A);
    await settle();
    const oldField = page.textarea();
    const instance = port.mounts().dock.composerInstanceId;
    expect(counts.of(oldField)).toBe(1);
    const { moves } = started.mounts.stats();
    const { narrowCallbacks, workCallbacks } = started.anchors.stats();
    page.recreateField();
    await settle();
    const newField = page.textarea();
    expect(newField).not.toBe(oldField);
    expect(started.anchors.current().conversation?.textarea).toBe(newField);
    expect([counts.of(oldField), counts.of(newField)]).toEqual([0, 1]);
    expect(port.mounts().dock.composerInstanceId).not.toBe(instance);
    expect(started.mounts.stats().moves).toBe(moves);
    expect(started.anchors.stats()).toMatchObject({ narrowCallbacks: narrowCallbacks + 1, workCallbacks });
  });

  it('[FS-PLC-4] the contact block made anew (the participants changed): seen by the header row’s observer, the slot hears of it; the dock does not move', async () => {
    const { page, started, port } = await start();
    page.openChat(A);
    await settle();
    expect(started.anchors.current().conversation?.headerRow).toBe(page.headerRow());
    const contact = started.anchors.current().conversation?.contact;
    const { moves } = started.mounts.stats();
    const before = started.anchors.stats().narrowCallbacks;
    page.setPartners(2);
    await settle();
    expect(started.anchors.current().conversation?.contact).toBeNull();
    page.setPartners(1);
    await settle();
    const now = started.anchors.current().conversation?.contact;
    expect(now).not.toBeNull();
    expect(now).not.toBe(contact);
    expect(started.anchors.stats().narrowCallbacks).toBe(before + 2);
    expect(started.mounts.stats().moves).toBe(moves);
    expect(port.mounts().dock.kind).toBe('in-flow');
  });

  it('[FS-PLC-4] what changes inside the field and the header — an attachment, the recorder’s button, a node of FBuddy in the header — wakes nothing', async () => {
    const { page, started } = await start();
    page.openChat(A);
    await settle();
    const stats = started.anchors.stats();
    page.composer()?.querySelector('.message-attachments')?.append(document.createElement('app-account-media-create-template'));
    page.composer()?.querySelector('.collapsable-actions')?.append(document.createElement('button'));
    page.route()?.querySelector('.message-content-header')?.append(document.createElement('fb-user-profile-panel-mobile-ui'));
    page.textarea()?.setAttribute('rows', '2');
    await settle();
    expect(started.anchors.stats()).toEqual(stats);
  });

  it('200 chat switches: the observers’ callbacks stay within a few per switch, the host moved once per switch, one listener on the one field in the page', async () => {
    const counts = listenerCounts();
    cleanups.push(() => counts.restore());
    const { page, started } = await start();
    page.openChat(A);
    await settle();
    const fields: HTMLTextAreaElement[] = [];
    const before = { ...started.anchors.stats(), ...started.mounts.stats() };
    const SWITCHES = 200;
    for (let index = 0; index < SWITCHES; index += 1) {
      page.openChat(GROUPS[(index + 1) % GROUPS.length] as string, index % 7 === 0 ? { copyOnly: true } : {});
      await settle();
      const field = page.textarea();
      if (field !== null) fields.push(field);
    }
    const after = { ...started.anchors.stats(), ...started.mounts.stats() };
    expect(after.moves - before.moves).toBe(SWITCHES);
    // The route's own observer hears each switch; the narrow ones go with the nodes they stood on.
    expect(after.workCallbacks - before.workCallbacks).toBeLessThanOrEqual(SWITCHES * 2);
    expect(after.narrowCallbacks - before.narrowCallbacks).toBe(0);
    expect(after.searches).toBe(before.searches);
    // Only the field on the page carries our listener.
    const current = page.textarea();
    expect(counts.of(current)).toBe(1);
    expect(fields.filter((field) => field !== current).reduce((sum, field) => sum + counts.of(field), 0)).toBe(0);
    expect(document.querySelectorAll('[data-host="dock"]')).toHaveLength(1);
  });
});
