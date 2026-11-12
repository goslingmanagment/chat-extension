// Temporary chat pins in a Fansly tab (2026-11-12; contracts fansly-pins.ts), wired: the controller (core
// application/hosts/fansly/pins.ts) over the background's `fansly.pins.*`, the port's rows, words, activity and
// pointer, and two surfaces — the strip in the slot after the list's filter chips (host-fansly inbox-slot.ts) and the
// open chat's button first in the header (order 5, before «Заметки» 10 and «Регистрация» 20). In Fansly's `pins` chunk,
// loaded the first time the tab is on /messages.
//
// - The header's button is mounted as soon as the header has its place and the switch is not off (unseen until the
//   switch is known): nothing of the header moves after it came. Not for a group chat.
// - The strip is mounted while the controller says it stands, in the route's own list only: at full height at once
//   when its list has just come (the list is first painted with it) or shows no row yet, sliding in otherwise.
// - A chip opens its chat through Fansly's own router by the person's click: a navigation token of the `pins` surface
//   from the tab's gate (the click went through our root), spent by the port — given up when the person went elsewhere
//   while the token was asked.
// - The background's changes of the creator's pins and of the switch are heard as events; a tab back in view reads
//   again, so does another sign-in. No storage listener in the tab.
// - Nothing of ours throws into the port's sync: a surface that fails is reported and the page's sync goes on.
import type { MountSurfaceKind } from '@cg/contracts/vm';
import { issueCause } from '@cg/core/application/boards';
import { createFanslyPins, type FanslyPinsStats } from '@cg/core/application/hosts/fansly/pins';
import { PINS_TEXTS } from '@cg/core/domain/hosts/fansly/i18n';
import type { FanslyPort } from '@cg/host-fansly/isolated';
import { pinHeaderSurface, pinStripSurface } from '@cg/ui/hosts/fansly/pins';
import { mountKitSurface, type KitMount } from '@cg/ui/kit';

import type { SiteAppEnv } from '../../adapter';
import { fanslyEvent, fanslyRequest } from './requests';

/** The strip's place among the list's slots; the header's button is the first of our marks there. */
const STRIP_ORDER = 10;
const HEADER_ORDER = 5;
/** Above the background's wait for its site's module (10 s, platform rpc-background `DEFAULT_SITE_WAIT_MS`). */
const PINS_TIMEOUT_MS = 15_000;

export function startFanslyPins(env: SiteAppEnv<FanslyPort>): () => void {
  const { host, rpc, win } = env;
  const page = host.fansly;
  const gated = env.gated ?? null;
  const probe = env.probe;
  /** Test builds: the controller's state, the slot's and the background's last refusal, for the e2e's report. */
  const seen = probe === null ? null : { refused: null as string | null };
  let strip: { readonly slot: ReturnType<FanslyPort['inbox']['mount']>; readonly mount: KitMount } | null = null;
  let header: { readonly slot: ReturnType<FanslyPort['header']['mount']>; readonly mount: KitMount } | null = null;

  const pins = createFanslyPins({
    page,
    creator: () => host.identity()?.hostAccountId ?? null,
    openChat() {
      const { route } = host.current();
      if (route.name !== 'chat' || route.conversationRef === undefined) return null;
      return { groupId: route.conversationRef, group: route.conversationKind === 'group' };
    },
    async read(creator) {
      const answer = await fanslyRequest(rpc, 'fansly.pins.read', { hostAccountId: creator }, PINS_TIMEOUT_MS);
      if (seen !== null) seen.refused = answer.ok ? null : answer.error.code;
      return answer.ok ? answer.payload : null;
    },
    async change(creator, op) {
      const answer = await fanslyRequest(rpc, 'fansly.pins.change', op.op === 'pin' ? { hostAccountId: creator, op: 'pin', pin: op.pin } : op.op === 'unpin' ? { hostAccountId: creator, op: 'unpin', groupId: op.groupId } : { hostAccountId: creator, op: 'touch', groupId: op.groupId, at: op.at }, PINS_TIMEOUT_MS);
      if (seen !== null) seen.refused = answer.ok ? null : answer.error.code;
      return answer.ok ? answer.payload.pins : null;
    },
    // The token is asked inside the click (the tab's gate sees it through our root); the port spends it. A person who
    // went elsewhere while it was asked is not taken back to this chat.
    async navigate(target) {
      if (gated === null) return false;
      const from = win.location.pathname;
      const issued = await issueCause(gated, 'navigate', 'pins');
      if (!issued.ok || env.life.aborted || win.location.pathname !== from) return false;
      const receipt = await host.navigate({ intentId: win.crypto.randomUUID(), cause: issued.cause, target: { hostAccountId: target.creator, platformFanId: target.fanId, conversationRef: target.groupId } }).catch(() => null);
      return receipt?.state === 'navigated';
    },
    copy: () => PINS_TEXTS[env.deps.i18n.language],
    now: () => Date.now(),
    timers: { set: (callback, ms) => win.setTimeout(callback, ms), clear: (handle) => win.clearTimeout(handle as number) },
    ...(probe === null
      ? {}
      : {
          observe: (stats: FanslyPinsStats) =>
            probe.set('pins', { ...stats, slot: host.inbox.available(), mounted: strip !== null, header: header !== null, hostStats: host.inbox.stats(), refused: seen?.refused ?? null }),
        }),
  });

  const unmountStrip = (): void => {
    // Out of the record first: an unmount says `hold(false)`, which may come back here before this returns.
    const gone = strip;
    strip = null;
    gone?.mount.unmount();
    gone?.slot.remove();
  };
  const unmountHeader = (): void => {
    const gone = header;
    header = null;
    gone?.mount.unmount();
    gone?.slot.remove();
  };

  const place = (): void => {
    if (env.life.aborted) return;
    const view = pins.view();
    const wantStrip = view.visible && host.inbox.available();
    if (wantStrip && strip === null) {
      // A list that has just come is painted with the strip already in it; one with no row yet does not move either.
      const instant = host.inbox.fresh() || !host.inbox.hasRows();
      const slot = host.inbox.mount(STRIP_ORDER);
      strip = { slot, mount: mountKitSurface('inbox-slot' as MountSurfaceKind, slot.root, env.deps, pinStripSurface(pins, PINS_TEXTS, () => instant), { report: env.report }) };
    } else if (!wantStrip && strip !== null) unmountStrip();
    const { route } = host.current();
    const wantHeader = pins.active() && host.header.available() && route.name === 'chat' && route.conversationKind !== 'group';
    if (wantHeader && header === null) {
      const slot = host.header.mount(HEADER_ORDER);
      header = { slot, mount: mountKitSurface('header-slot' as MountSurfaceKind, slot.root, env.deps, pinHeaderSurface(pins, PINS_TEXTS), { report: env.report }) };
    } else if (!wantHeader && header !== null) unmountHeader();
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
    pins.sync();
    place();
  });
  const onVisible = (): void => {
    if (win.document.visibilityState === 'visible') pins.refresh();
  };
  win.document.addEventListener('visibilitychange', onVisible);
  const offs = [
    host.subscribe((event) => {
      if (event.type === 'route' || event.type === 'accounts') sync();
    }),
    host.header.onChange(safely(place)),
    host.inbox.onChange(safely(place)),
    pins.subscribe(safely(place)),
    env.deps.i18n.subscribe(() => pins.sync()),
    fanslyEvent(rpc, 'fansly.pins.changed', (payload) => pins.changed(payload.hostAccountId, payload.pins)),
    fanslyEvent(rpc, 'fansly.pins.switched', (payload) => pins.switched(payload.on)),
    // Another sign-in (or none): the background answers for whoever is signed in now.
    rpc.onEvent('session.changed', () => pins.sessionChanged()),
    () => win.document.removeEventListener('visibilitychange', onVisible),
  ];
  sync();
  return () => {
    for (const off of offs.splice(0)) off();
    unmountStrip();
    unmountHeader();
    pins.dispose();
  };
}
