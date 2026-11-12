// The filters above Fansly's chats in a Fansly tab (2026-11-13; contracts fansly-filters.ts), wired: the controller (core
// application/hosts/fansly/filters.ts) over the port's block of filter chips (`fansly.filters`), the background's
// `fansly.filters.*` (the strip chosen, «Четыре группы»' memory) and two surfaces — the strip in the slot after the
// list's filter chips, before the pins' strip (order 5 < 10), and «Четыре группы»' refresh in the search row. In
// Fansly's `pins` chunk, loaded the first time the tab is on /messages.
//
// - The strip stands while the controller has a mode: it is drawn first, then Fansly's block is hidden, in one task; the
//   other way round when it goes (never our strip beside Fansly's visible block, never neither).
// - Its host is positioned above Fansly's scroller (`position: relative; z-index: 3`): the popovers paint over the list
//   and over the marks on its rows (z-index 2 there), and under Fansly's own menus (its sort menu opens down over the
//   strip at z-index 5, styles.e3071a57227c55dd.css:942).
// - A strip that fails to draw (the kit's boundary) gives the place back to Fansly's block for the rest of the tab.
// - The background's change of the strip is heard as an event; a tab back in view and another sign-in read again.
// - Nothing of ours throws into the port's sync: a surface that fails is reported and the page's sync goes on.
import type { MountSurfaceKind } from '@cg/contracts/vm';
import { createFanslyFilters, type FanslyFiltersStats } from '@cg/core/application/hosts/fansly/filters';
import { FILTERS_TEXTS } from '@cg/core/domain/hosts/fansly/i18n';
import type { FanslyPort } from '@cg/host-fansly/isolated';
import { filtersRefreshSurface, filtersSurface } from '@cg/ui/hosts/fansly/filters';
import { mountKitSurface, type KitMount } from '@cg/ui/kit';

import type { SiteAppEnv } from '../../adapter';
import { fanslyEvent, fanslyRequest } from './requests';

/** The strip's place among the list's slots: before the pins' strip (10). */
const STRIP_ORDER = 5;
/** Above the background's wait for its site's module (10 s, platform rpc-background `DEFAULT_SITE_WAIT_MS`). */
const FILTERS_TIMEOUT_MS = 15_000;

export function startFanslyFilters(env: SiteAppEnv<FanslyPort>): () => void {
  const { host, rpc, win } = env;
  const page = host.fansly;
  const probe = env.probe;
  let strip: { readonly slot: ReturnType<FanslyPort['inbox']['mount']>; readonly mount: KitMount } | null = null;
  let refresh: { readonly slot: ReturnType<FanslyPort['search']['mount']>; readonly mount: KitMount } | null = null;
  /** Test builds: the controller's state with what stands of ours, after every change of either. */
  function report(stats: FanslyFiltersStats): void {
    probe?.set('filters', { ...stats, slot: host.inbox.available(), mounted: strip !== null, refresh: refresh !== null });
  }

  const filters = createFanslyFilters({
    page: page.filters,
    creator: () => host.identity()?.hostAccountId ?? null,
    async read(creator) {
      const answer = await fanslyRequest(rpc, 'fansly.filters.read', { hostAccountId: creator }, FILTERS_TIMEOUT_MS);
      return answer.ok ? answer.payload : null;
    },
    async remember(creator, group, key) {
      const answer = await fanslyRequest(rpc, 'fansly.filters.remember', { hostAccountId: creator, group, key }, FILTERS_TIMEOUT_MS);
      return answer.ok ? answer.payload.memo : null;
    },
    copy: () => FILTERS_TEXTS[env.deps.i18n.language],
    timers: { set: (callback, ms) => win.setTimeout(callback, ms), clear: (handle) => win.clearTimeout(handle as number) },
    ...(probe === null ? {} : { observe: (stats: FanslyFiltersStats) => report(stats) }),
  });

  /** The strip failed to draw: Fansly's block for the rest of the tab, never a broken strip over a hidden block. */
  let broken = false;
  const reportStrip = (failure: Parameters<typeof env.report>[0]): void => {
    env.report(failure);
    if (failure.kind !== 'render' || broken) return;
    broken = true;
    queueMicrotask(() => place());
  };
  const unmountStrip = (): void => {
    const gone = strip;
    strip = null;
    // Fansly's block first: never a moment with neither.
    page.filters.hide(false);
    gone?.mount.unmount();
    gone?.slot.remove();
  };
  const unmountRefresh = (): void => {
    const gone = refresh;
    refresh = null;
    gone?.mount.unmount();
    gone?.slot.remove();
  };

  const place = (): void => {
    if (env.life.aborted) return;
    const mode = broken ? null : filters.view().mode;
    const want = mode !== null && host.inbox.available();
    if (want && strip === null) {
      const slot = host.inbox.mount(STRIP_ORDER);
      slot.host.style.setProperty('position', 'relative');
      // Above Fansly's scroller and the rows' marks (z-index 2), under Fansly's own menus (z-index 5).
      slot.host.style.setProperty('z-index', '3');
      strip = { slot, mount: mountKitSurface('inbox-slot' as MountSurfaceKind, slot.root, env.deps, filtersSurface(filters, FILTERS_TEXTS), { report: reportStrip }) };
      // Ours is drawn: Fansly's block goes in the same task.
      page.filters.hide(true);
    } else if (!want && strip !== null) unmountStrip();
    else if (want) page.filters.hide(true);
    const wantRefresh = mode === 'groups' && host.search.available();
    if (wantRefresh && refresh === null) {
      const slot = host.search.mount();
      refresh = { slot, mount: mountKitSurface('search-slot' as MountSurfaceKind, slot.root, env.deps, filtersRefreshSurface(filters, FILTERS_TEXTS), { report: env.report }) };
    } else if (!wantRefresh && refresh !== null) unmountRefresh();
    report(filters.stats());
  };
  /** The port's listeners: whatever fails here is ours to report, never the port's sync to break. */
  const safely = (run: () => void) => (): void => {
    try {
      run();
    } catch (error) {
      env.report({ kind: 'render', surface: 'inbox-slot' as MountSurfaceKind, code: 'CG-UI-FAILED', name: error instanceof Error ? error.name : typeof error });
    }
  };
  const sync = safely(() => {
    if (env.life.aborted) return;
    filters.sync();
    place();
  });
  const onVisible = (): void => {
    if (win.document.visibilityState === 'visible') filters.reread();
  };
  win.document.addEventListener('visibilitychange', onVisible);
  const offs = [
    host.subscribe((event) => {
      if (event.type === 'route' || event.type === 'accounts') sync();
    }),
    host.inbox.onChange(safely(place)),
    host.search.onChange(safely(place)),
    filters.subscribe(safely(place)),
    env.deps.i18n.subscribe(() => filters.sync()),
    fanslyEvent(rpc, 'fansly.filters.stripChanged', (payload) => filters.stripChanged(payload.strip)),
    // Another sign-in (or none): the background answers for whoever is signed in now.
    rpc.onEvent('session.changed', () => filters.reread()),
    () => win.document.removeEventListener('visibilitychange', onVisible),
  ];
  sync();
  return () => {
    for (const off of offs.splice(0)) off();
    unmountRefresh();
    unmountStrip();
    filters.dispose();
  };
}
