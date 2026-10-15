// The router, as Fansly's Angular router behaves where the extension meets it
// (S2 Q4): the location keeps the `history` INSTANCE and calls its
// `pushState`/`replaceState` at call time (main:105913, :105951-105956), so a
// hook on either is seen; the address changes first, then the route
// activates, in the same task (deferred URL update, main:117119-117122);
// `popstate` is read a task later (`setTimeout(0)`) and navigates with
// `replaceUrl`, reading `state.navigationId` — a `state` of null is fine
// (main:117251-117255, :117353-117366). No Navigation API in the bundle.
// RouterLink on `<a href>`: a plain primary click navigates in the page, a
// modified one is left to the browser.

import { handler } from './events';
import { record } from './journal';

export type Route = { readonly kind: 'messages'; readonly groupId: string | null } | { readonly kind: 'vault' } | { readonly kind: 'other'; readonly path: string };

const CONVERSATION = /^\/messages\/(\d+)$/;

export function parseRoute(path: string): Route {
  if (path === '/messages' || path === '/messages/') return { kind: 'messages', groupId: null };
  const conversation = CONVERSATION.exec(path);
  if (conversation !== null) return { kind: 'messages', groupId: conversation[1] ?? null };
  if (path === '/creator/vault' || path === '/creator/vault/') return { kind: 'vault' };
  return { kind: 'other', path };
}

export class Router {
  private readonly history: History = window.history;
  private navigationId = 0;
  private readonly links = new Set<HTMLAnchorElement>();
  private readonly listeners = new Set<(path: string) => void>();

  private readonly onPopState = (event: PopStateEvent): void => {
    const state: unknown = event.state;
    const restored = typeof state === 'object' && state !== null ? (state as { navigationId?: unknown }).navigationId : undefined;
    setTimeout(() => void this.navigate(`${location.pathname}${location.search}`, { replaceUrl: true, source: 'popstate', restored: typeof restored === 'number' ? restored : null }), 0);
  };

  constructor(private readonly activate: (route: Route, path: string) => void) {
    window.addEventListener('popstate', this.onPopState);
  }

  destroy(): void {
    window.removeEventListener('popstate', this.onPopState);
  }

  get path(): string {
    return location.pathname;
  }

  /** The first navigation: the page's own address. */
  start(): void {
    this.navigationId += 1;
    this.history.replaceState({ navigationId: this.navigationId }, '', `${location.pathname}${location.search}`);
    this.run('imperative', null);
  }

  navigateByUrl(url: string): Promise<void> {
    return this.navigate(url, { replaceUrl: false, source: 'imperative', restored: null });
  }

  private navigate(url: string, options: { readonly replaceUrl: boolean; readonly source: 'imperative' | 'popstate'; readonly restored: number | null }): Promise<void> {
    return Promise.resolve().then(() => {
      this.navigationId += 1;
      const state = { navigationId: this.navigationId };
      if (options.replaceUrl) this.history.replaceState(state, '', url);
      else this.history.pushState(state, '', url);
      this.run(options.source, options.restored);
    });
  }

  private run(source: string, restored: number | null): void {
    const path = location.pathname;
    record('navigation', { path, source, restored, navigationId: this.navigationId });
    this.activate(parseRoute(path), path);
    for (const link of this.links) {
      if (!link.isConnected) this.links.delete(link);
      else if (link.hasAttribute('routerlinkactive')) link.classList.toggle('selected', link.getAttribute('href') === path);
    }
    for (const listener of [...this.listeners]) listener(path);
  }

  onNavigation(listener: (path: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** `routerLink` on an anchor (with `routerLinkActive="selected"` when `active`). */
  link(anchor: HTMLAnchorElement, active: boolean): void {
    if (active) {
      anchor.setAttribute('routerlinkactive', 'selected');
      if (anchor.getAttribute('href') === location.pathname) anchor.classList.add('selected');
    }
    this.links.add(anchor);
    anchor.addEventListener(
      'click',
      handler((event: MouseEvent) => {
        if (event.button !== 0 || event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;
        event.preventDefault();
        const href = anchor.getAttribute('href');
        if (href !== null) void this.navigateByUrl(href);
      }),
    );
  }
}
