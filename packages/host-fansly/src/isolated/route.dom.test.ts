// Fansly's route in the isolated world (R20 P7c; docs/project-unite/architecture.md §7.2; FS-RTE-1…3): the address
// by its one rule, read again on the page's signals — the anchors' observers, `popstate`, `pageshow`, the Navigation
// API where there is one —, never on a timer and never through a hook on `history`; a change that only a verification
// finds is counted. Its anchors' observers with the route: anchors.dom.test.ts; the port on top: host-port.dom.test.ts.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeFanslyPage } from '../testing/fake-dom';
import { createAnchorWatcher } from './anchors';
import { createRouteWatcher, groupIdOfPath, routeOfLocation, type RouteChange, type RouteDiagnostic } from './route';

const A = '700000000000000010';
const B = '700000000000000011';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  history.replaceState({}, '', '/');
});

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('[host:fansly] the route by the address', () => {
  it('[AU-033] [FS-RTE-1] a conversation is `/messages/<group id>` exactly — stricter than the old extension; the group id stays a string', () => {
    expect(groupIdOfPath(`/messages/${A}`)).toBe(A);
    expect(groupIdOfPath('/messages/1000000000000000105')).toBe('1000000000000000105');
    expect(groupIdOfPath('/messages/99999999999999999')).toBe('99999999999999999');
    for (const path of ['/messages', '/messages/', `/messages/${A}/`, `/messages/${A}/media`, '/messages/0123', '/messages/abc', `/creator/messages/${A}`, `/${A}`, '/home']) {
      expect(groupIdOfPath(path), path).toBeNull();
    }
    // The early key dispatcher's route: a conversation is a chat, nothing else is; its epoch is the path.
    expect(routeOfLocation({ pathname: `/messages/${A}` })).toEqual({ kind: 'chat', epoch: `/messages/${A}` });
    expect(routeOfLocation({ pathname: '/messages' })).toEqual({ kind: 'other', epoch: '/messages' });
  });
});

describe('[host:fansly] route signals (FS-RTE-2, FS-RTE-3)', () => {
  it('[BG-009] [FS-RTE-2] [FS-RTE-3] the address is read again on the page’s signals — never on a timer, never through a hook on history', () => {
    const { pushState, replaceState } = Object.getOwnPropertyDescriptors(History.prototype);
    vi.useFakeTimers();
    history.replaceState({}, '', '/messages');
    const watcher = createRouteWatcher(window);
    cleanups.push(() => watcher.dispose());
    const changes: RouteChange[] = [];
    watcher.onChange((change) => changes.push(change));
    expect(watcher.current()).toEqual({ path: '/messages', groupId: null, epoch: 1 });
    // No timer of its own (BG-009: the old extension read the address twice every 500 ms), no hook on `history`.
    expect(vi.getTimerCount()).toBe(0);
    expect(Object.getOwnPropertyNames(history)).toEqual([]);
    expect([Object.getOwnPropertyDescriptor(History.prototype, 'pushState'), Object.getOwnPropertyDescriptor(History.prototype, 'replaceState')]).toEqual([pushState, replaceState]);
    // The address moved, and nothing said so: the watcher does not look by itself.
    history.pushState({}, '', `/messages/${A}`);
    vi.advanceTimersByTime(5000);
    expect(changes).toEqual([]);
    // A signal: the address is read again.
    watcher.signal('observer');
    expect(changes.map(({ route, via }) => [route.groupId, route.epoch, via])).toEqual([[A, 2, 'observer']]);
    // `popstate` (back and forward) is a signal of its own, before Angular moves a task later.
    history.replaceState({}, '', `/messages/${B}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(changes.at(-1)).toMatchObject({ route: { groupId: B, epoch: 3 }, previous: { groupId: A, epoch: 2 }, via: 'popstate' });
    // The same address again is no change.
    watcher.signal('observer');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(changes).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
    expect(watcher.stats()).toEqual({ changes: 2, unsignalled: 0, restorations: 0 });
  });

  it('[FS-RTE-2] the Navigation API, where Firefox has it (≥ 147), is an early signal; `pageshow` from bfcache moves the epoch even on the same address', () => {
    history.replaceState({}, '', `/messages/${A}`);
    const navigation = new EventTarget();
    Object.defineProperty(window, 'navigation', { value: navigation, configurable: true });
    cleanups.push(() => Reflect.deleteProperty(window, 'navigation'));
    const watcher = createRouteWatcher(window);
    cleanups.push(() => watcher.dispose());
    const vias: string[] = [];
    watcher.onChange(({ via, route }) => vias.push(`${via}:${route.epoch}`));
    history.pushState({}, '', `/messages/${B}`);
    navigation.dispatchEvent(new Event('currententrychange'));
    // A plain `pageshow` on the same address is nothing; a return from the back-forward cache is a new life of the page.
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }));
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    expect(vias).toEqual(['navigation:2', 'pageshow:3']);
    // The return from bfcache is a new life of the page: counted, and the change says so.
    expect(watcher.stats().restorations).toBe(1);
    expect(watcher.current()).toEqual({ path: `/messages/${B}`, groupId: B, epoch: 3 });
    // Disposed, it hears nothing more.
    watcher.dispose();
    history.pushState({}, '', `/messages/${A}`);
    navigation.dispatchEvent(new Event('currententrychange'));
    expect(vias).toHaveLength(2);
  });

  it('[FS-RTE-3] «адрес сменился без сигнала»: a change only a verification finds — the tab shown again, the focus, an action of our UI — is counted and logged without the address', () => {
    history.replaceState({}, '', `/messages/${A}`);
    const diagnostics: RouteDiagnostic[] = [];
    const watcher = createRouteWatcher(window, (diagnostic) => diagnostics.push(diagnostic));
    cleanups.push(() => watcher.dispose());
    watcher.verify('ui');
    expect(watcher.stats().unsignalled).toBe(0);
    history.pushState({}, '', `/messages/${B}`);
    document.dispatchEvent(new Event('visibilitychange'));
    history.pushState({}, '', '/home');
    window.dispatchEvent(new Event('focus'));
    history.pushState({}, '', `/messages/${A}`);
    watcher.verify('ui');
    expect(watcher.stats()).toEqual({ changes: 3, unsignalled: 3, restorations: 0 });
    expect(diagnostics).toEqual([
      { event: 'route-unsignalled', detail: { via: 'visibility', count: 1, chat: true } },
      { event: 'route-unsignalled', detail: { via: 'focus', count: 2, chat: false } },
      { event: 'route-unsignalled', detail: { via: 'ui', count: 3, chat: true } },
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain(A);
    expect(watcher.current()).toMatchObject({ groupId: A, epoch: 4 });
  });

  it('[FS-RTE-3] on Fansly’s own lifecycle the observers see every change of chat — A → B → inbox → home → back — and nothing is left for a verification to find', async () => {
    history.replaceState({}, '', '/messages');
    const page = createFakeFanslyPage();
    cleanups.push(() => page.destroy());
    const watcher = createRouteWatcher(window);
    const anchors = createAnchorWatcher(document, watcher);
    cleanups.push(() => anchors.dispose(), () => watcher.dispose());
    const seen: string[] = [];
    watcher.onChange(({ route, via }) => seen.push(`${route.path}@${route.epoch}:${via}`));
    page.openChat(A);
    await settle();
    page.openChat(B, { cached: false });
    await settle();
    page.arrive();
    page.openInbox();
    await settle();
    page.openHome();
    await settle();
    await page.popTo(`/messages/${A}`);
    await settle();
    // Every check without a signal finds the address where the signals left it.
    watcher.verify('focus');
    watcher.verify('visibility');
    expect(seen).toEqual([`/messages/${A}@2:observer`, `/messages/${B}@3:observer`, '/messages@4:observer', '/home@5:observer', `/messages/${A}@6:popstate`]);
    expect(watcher.stats()).toEqual({ changes: 5, unsignalled: 0, restorations: 0 });
  });
});
