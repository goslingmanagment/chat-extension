// core/services/sound — the background's sound: the one arbiter of the
// extension, the subscriber poll and the protocol handlers (architecture.md
// §9.8). Ports only: the audio player, presence, settings and the hub come
// from the background's composition root.
//
// Wiring for the integrator (background composition root):
// 1. player = platform createAudioPlayer(); arbiter = new SoundArbiter({
//    clock, audio: player, presence: { listeningTabs: presence.listeningTabs,
//    isChatInFocus: presence.isChatInFocus, accounts: () =>
//    presence.seenAccounts().map((seen) => seen.account) }, settings: () =>
//    settingsState?.settings.sound ?? null, ownerSwitch: (scope) => the
//    `sound` feature of the PAGE the scope names (the page a host account is
//    bound to, or the batch's page) — never the bootstrap's top-level flag;
//    null without a bootstrap —, hostPermission: (host) =>
//    permissions.hasHost(host), session }).
// 2. The readiness barrier runs `arbiter.restore()`; `rpc.handle` each entry
//    of soundRequestHandlers(arbiter); onTabGone → arbiter.tabGone(id).
// 3. poller = createSubscriberPoller({ clock, pages, read: (page, hours) =>
//    hub.audienceNew({ pageLabel: page.pageLabel, windowHours: hours }),
//    presence, enabled, online: () => navigator.onLine, sink: arbiter });
//    start it when the first tab registers, stop it when the last one is
//    gone; `arbiter.forgetSubscribers()` on sign-out. R12's own «Новые» poll
//    may feed `handleSubscribers` instead.
// 4. `diagnostics.get`: sound = arbiter.diagnostics() (listeningTabs,
//    lastIncomingAt, outcomes).
// 5. Tab side: every HostPort `incoming` event goes to the background as it
//    is — `rpc.request('sound.event', { fact: event.fact })`; the tab decides
//    nothing about sound.
// 6. A site whose page hears more than the shared fact says (R20 P14a:
//    Fansly — who wrote, a new subscriber on its socket) reports its facts
//    in batches to its own background chunk, which hands them to this one
//    arbiter: `handleIncoming(tab, fact, author)` and `handleFollow(follow)`;
//    `aliases` and `siteTones` come from the composition root.

export {
  SOUND_COUNTER_NAMES,
  SOUND_SESSION_KEY,
  SUBSCRIBER_BASELINE_MAX,
  SoundArbiter,
  type SoundArbiterDeps,
  type SoundAudioPort,
  type SoundDiagnostics,
  type SoundPlayResult,
  type SoundPresencePort,
  type SoundScope,
  type SubscriberBatch,
} from './arbiter';
export type { PageFollow } from '../../domain/sound';
export { SUBSCRIBER_POLL_BACKOFF_MAX, SUBSCRIBER_POLL_JITTER, createSubscriberPoller, type SubscriberPage, type SubscriberPoller, type SubscriberPollerDeps } from './subscribers';
export { soundRequestHandlers } from './handlers';
