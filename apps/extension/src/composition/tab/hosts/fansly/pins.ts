// Temporary chat pins in a Fansly tab (2026-11-12; contracts fansly-pins.ts), wired: the controller (core
// application/hosts/fansly/pins.ts) over the background's `fansly.pins.*`, the port's rows, words, activity and
// pointer, and two surfaces — the strip in the slot after the list's filter chips (host-fansly inbox-slot.ts) and the
// open chat's button first in the header (order 5, before «Заметки» 10 and «Регистрация» 20). In Fansly's `pins` chunk,
// loaded the first time the tab is on /messages.
//
// - The header's button is mounted as soon as the header has its place and the switch is not off: nothing of the
//   header moves after it came. Not for a group chat.
// - The strip is mounted while the controller says it stands, in the route's own list only.
// - A chip opens its chat through Fansly's own router by the person's click: a navigation token of the `pins` surface
//   from the tab's gate (the click went through our root), spent by the port.
// - The background's changes of the creator's pins and of the switch are heard as events; a tab back in view reads
//   again. No storage listener in the tab.
import type { MountSurfaceKind } from '@cg/contracts/vm';
import { issueCause, type TabRpc } from '@cg/core/application/boards';
import { createFanslyPins } from '@cg/core/application/hosts/fansly/pins';
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
  const gated = env.gated === undefined ? null : (env.gated as unknown as TabRpc);
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
      return answer.ok ? answer.payload : null;
    },
    async change(creator, op) {
      const answer = await fanslyRequest(rpc, 'fansly.pins.change', op.op === 'pin' ? { hostAccountId: creator, op: 'pin', pin: op.pin } : op.op === 'unpin' ? { hostAccountId: creator, op: 'unpin', groupId: op.groupId } : { hostAccountId: creator, op: 'touch', groupId: op.groupId, at: op.at }, PINS_TIMEOUT_MS);
      return answer.ok ? answer.payload.pins : null;
    },
    // The token is asked inside the click (the tab's gate sees it through our root); the port spends it.
    async navigate(target) {
      if (gated === null) return false;
      const issued = await issueCause(gated, 'navigate', 'pins');
      if (!issued.ok || env.life.aborted) return false;
      const receipt = await host.navigate({ intentId: win.crypto.randomUUID(), cause: issued.cause, target: { hostAccountId: target.creator, platformFanId: target.fanId, conversationRef: target.groupId } }).catch(() => null);
      return receipt?.state === 'navigated';
    },
    copy: () => PINS_TEXTS[env.deps.i18n.language],
    now: () => Date.now(),
    timers: { set: (callback, ms) => win.setTimeout(callback, ms), clear: (handle) => win.clearTimeout(handle as number) },
  });

  let strip: { readonly slot: ReturnType<FanslyPort['inbox']['mount']>; readonly mount: KitMount } | null = null;
  let header: { readonly slot: ReturnType<FanslyPort['header']['mount']>; readonly mount: KitMount } | null = null;
  const place = (): void => {
    if (env.life.aborted) return;
    const view = pins.view();
    const wantStrip = view.visible && host.inbox.available();
    if (wantStrip && strip === null) {
      // Before Fansly's first rows the strip simply stands: nothing on the page moves yet.
      const instant = !host.inbox.hasRows();
      const slot = host.inbox.mount(STRIP_ORDER);
      strip = { slot, mount: mountKitSurface('inbox-slot' as MountSurfaceKind, slot.root, env.deps, pinStripSurface(pins, PINS_TEXTS, () => instant), { report: env.report }) };
    } else if (!wantStrip && strip !== null) {
      strip.mount.unmount();
      strip.slot.remove();
      strip = null;
    }
    const { route } = host.current();
    const wantHeader = pins.active() && host.header.available() && route.name === 'chat' && route.conversationKind !== 'group';
    if (wantHeader && header === null) {
      const slot = host.header.mount(HEADER_ORDER);
      header = { slot, mount: mountKitSurface('header-slot' as MountSurfaceKind, slot.root, env.deps, pinHeaderSurface(pins, PINS_TEXTS), { report: env.report }) };
    } else if (!wantHeader && header !== null) {
      header.mount.unmount();
      header.slot.remove();
      header = null;
    }
    env.probe?.set('pins', { ...pins.stats(), slot: host.inbox.available(), mounted: strip !== null, header: header !== null, hostStats: host.inbox.stats() });
  };
  const sync = (): void => {
    if (env.life.aborted) return;
    pins.sync();
    place();
  };
  const onVisible = (): void => {
    if (win.document.visibilityState === 'visible') pins.refresh();
  };
  win.document.addEventListener('visibilitychange', onVisible);
  const offs = [
    host.subscribe((event) => {
      if (event.type === 'route' || event.type === 'accounts') sync();
    }),
    host.header.onChange(place),
    host.inbox.onChange(place),
    pins.subscribe(place),
    env.deps.i18n.subscribe(() => pins.sync()),
    fanslyEvent(rpc, 'fansly.pins.changed', (payload) => pins.changed(payload.hostAccountId, payload.pins)),
    fanslyEvent(rpc, 'fansly.pins.switched', (payload) => pins.switched(payload.on)),
    () => win.document.removeEventListener('visibilitychange', onVisible),
  ];
  sync();
  return () => {
    for (const off of offs.splice(0)) off();
    pins.dispose();
    strip?.mount.unmount();
    strip?.slot.remove();
    header?.mount.unmount();
    header?.slot.remove();
    strip = null;
    header = null;
  };
}
