// «Fansly через вкладку» in Fansly's background module (R20 P9c; docs/
// project-unite/architecture.md §8.5; spec FS-NET-4, FX-001): the relay
// transport of packages/fansly-api over the core's ports.
//
// - The switch is the person's (`settings.ext`, `hosts['fansly-web'].viaTab`,
//   off by default, X33), read at each route; settings that are not read yet
//   give no route at all (no guess, no direct request instead).
// - A tab of the request's session is the one whose own page requests the core
//   bound to that session (`networkSession.forTab`, P9a); the module asks it to
//   raise its frame (`fansly.relay.open`, to the tab) and posts the request to
//   the frame (`fansly.relay.fetch`, `.abort`) through the core's RPC
//   (`kit.site.emit`): the core checks the event by Fansly's schema and hands it
//   only to that tab session's own tab or frames.
// - The frame's own requests (`fansly.relay.hello`, `.head`, `.body`,
//   `.failure`) come here through Fansly's registry, the core having checked
//   that it is our relay page in a subframe of that registered tab; the core
//   says when a frame's port went (`relayGone`).

import { createRelayTransport, type FanslyFetch, type RelayHub } from '@cg/fansly-api';
import type { FanslyTabRequestPayload } from '@cg/contracts/tab-messages-fansly';

import type { BackgroundKit, HostAnswer, HostSiteSender } from '../../src/composition/background/host-module';

type RelaySender = Extract<HostSiteSender, { readonly kind: 'relay' }>;

export interface RelayService {
  readonly hub: RelayHub;
  /** A `fansly.relay.*` request of a frame; null — not one of the relay's types. */
  handle(type: string, payload: unknown, sender: HostSiteSender): HostAnswer | null;
  /** The core: a frame's port went. */
  gone(sender: RelaySender): void;
}

const ok = (recorded: boolean): HostAnswer => ({ ok: true, payload: { recorded } });

export function createRelayService(kit: BackgroundKit, viaTab: () => boolean | null, options: { readonly fetch?: FanslyFetch; readonly settled?: () => Promise<void> } = {}): RelayService {
  const site = kit.site;
  const session = kit.networkSession;
  const hub = createRelayTransport({
    viaTab,
    ...(options.settled === undefined ? {} : { settled: options.settled }),
    // The direct route: the event page's own `fetch` (packages/fansly-api's), a test's own.
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    tabs: () => kit.siteTabs?.registered() ?? [],
    sessionOfTab: (tabId) => session?.forTab(tabId)?.legacyId ?? null,
    open: (tabSessionId) => (site?.emit('fansly.relay.open', {}, { tabSessionId }) ?? 0) > 0,
    post: (tabSessionId, type, payload) => site?.emit(type, payload, { tabSessionId }) ?? 0,
    randomUUID: () => kit.ids.uuid(),
    setTimer: (callback, ms) => kit.clock.setTimer(ms, callback),
    clearTimer: (handle) => kit.clock.clearTimer(handle as ReturnType<BackgroundKit['clock']['setTimer']>),
  });
  return {
    hub,
    handle(type, payload, sender) {
      if (!type.startsWith('fansly.relay.')) return null;
      // The registry admits these from a relay alone (contracts `from: relay`); a tab never reaches here with them.
      if (sender.kind !== 'relay') return ok(false);
      const frame = { tabSessionId: sender.tabSessionId, frameId: sender.frameId };
      switch (type) {
        case 'fansly.relay.hello':
          return ok(hub.hello(frame, payload as FanslyTabRequestPayload<'fansly.relay.hello'>));
        case 'fansly.relay.head':
          return ok(hub.head(frame, payload as FanslyTabRequestPayload<'fansly.relay.head'>));
        case 'fansly.relay.body':
          return ok(hub.body(frame, payload as FanslyTabRequestPayload<'fansly.relay.body'>));
        case 'fansly.relay.failure':
          return ok(hub.failure(frame, payload as FanslyTabRequestPayload<'fansly.relay.failure'>));
        default:
          return null;
      }
    },
    gone: (sender) => hub.gone({ tabSessionId: sender.tabSessionId, frameId: sender.frameId }),
  };
}
