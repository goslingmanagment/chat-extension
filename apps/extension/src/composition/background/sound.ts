// The sound of the extension in the background (architecture.md §9.8, §8.5;
// SN-001…SN-016): R17's one arbiter over R07's audio player, the tab
// presence and the settings, and the two sources of the subscriber sound —
// the slow poll of «Новые» (once a minute, while a ChatSpace tab lives) and
// the list a tab reads itself while its «Новые» window is open (every 30 s):
// the arbiter hears both, and a page a tab has just read is not asked again
// by the poll. Wiring only: what rings is decided by the arbiter's policy.
//
// A page whose «Новые» the hub cannot serve (the owner's switch, or a hub
// without the route — the dev compat bootstrap) is never polled, nor is a
// page whose `sound` switch is off. The owner's `sound` switch is the
// PAGE's own (docs/protocols/hub.md «Флаги: решает страница»): a fan's
// message asks the page its host account is bound to, a new subscriber the
// page of its batch; the poll as a whole runs while at least one page has it.

import { HOST_KINDS, HOST_PLATFORM } from '@cg/contracts/hosts';
import { AUDIENCE_KINDS, type AudienceNewPage, type Bootstrap, type ClientFeatureFlag } from '@cg/contracts/hub';
import { narrowPlatform, type HostKind } from '@cg/contracts/ids';
import { type SettingsV1 } from '@cg/contracts/settings';
import { DEFAULT_FANSLY_SETTINGS } from '@cg/contracts/settings-ext';
import { flagOnSomePage, flagUsable } from '@cg/core/domain/ops';
import { type SoundTones } from '@cg/core/domain/sound';
import { type Clock, type KeyValueStore as ThrowingStore, type LogSink, type PresenceService, type TabEventSink } from '@cg/core/services';
import { SoundArbiter, createSubscriberPoller, type GreetReminder, type SoundAudioPort, type SubscriberPage, type SubscriberPoller, type SoundStreamPort } from '@cg/core/services/sound';

/** A page a tab read itself less than this long ago is left out of the slow poll (the tab asks every 30 s). */
export const TAB_FED_FRESH_MS = 45_000;

/**
 * What each site rings for a tone the person left untouched (decision X26: each site the pair its own old client
 * rang), by kind — a new host kind does not typecheck until it says. null — the settings' own pair (ChatSpace: the
 * desktop app's blip and arpeggio, what the settings page shows). Fansly: the Fansly extension's, the default of its
 * section of `settings.ext` (FS-SND-2; the person's own Fansly tones there are P14a's).
 */
export const SITE_TONES = {
  chatspace: null,
  'fansly-web': { message: DEFAULT_FANSLY_SETTINGS.sound.messagesTone, subscriber: DEFAULT_FANSLY_SETTINGS.sound.subscribersTone },
  // Telegram rings nothing of ours (no sound in its slice): the settings' own pair, should it ever.
  'telegram-web': null,
} as const satisfies { readonly [K in HostKind]: SoundTones | null };

/** The site's tones by the platform it serves: a sound knows its platform (a page's batch has no tab of a site). */
const toneOfPlatform: ReadonlyMap<string, SoundTones | null> = new Map(HOST_KINDS.map((kind) => [HOST_PLATFORM[kind], SITE_TONES[kind]]));

export interface BackgroundSoundDeps {
  readonly stream?: SoundStreamPort;
  readonly local?: ThrowingStore;
  readonly clock: Clock;
  readonly audio: SoundAudioPort;
  readonly presence: Pick<PresenceService, 'listeningTabs' | 'isChatInFocus' | 'seenAccounts'>;
  /** `settings.sound`; null — the settings are not readable. */
  readonly settings: () => SettingsV1['sound'] | null;
  /** The bootstrap of the sign-in; null — signed out or not read yet. */
  readonly bootstrap: () => Bootstrap | null;
  /** «Новые» may be read for the page now (granted, switched on, the hub serves it). */
  readonly newcomersUsable: (pageLabel: string) => boolean;
  /**
   * An owner switch as it stands for a host account of this browser: the value of the page the account is
   * bound to; for an account bound to no page — the owner's `"*"` value; null — no bootstrap (signed out).
   */
  readonly accountFlag: (host: HostKind, hostAccountId: string, flag: ClientFeatureFlag) => boolean | null;
  readonly hostPermission: (host: HostKind) => Promise<boolean>;
  /** The newest rows of a page's «Новые» (the hub facade's `audienceNew`). */
  readonly read: (pageLabel: string, windowHours: number) => Promise<AudienceNewPage>;
  readonly online: () => boolean;
  readonly events: TabEventSink;
  /** Registered tab sessions. */
  readonly tabs: () => readonly string[];
  /** storage.session. */
  readonly session: ThrowingStore;
  readonly log: LogSink;
  /** 2026-10-24: the greeting reminder hears every answer of «Новые» the poll or a tab got; it keeps the poll on by itself. */
  readonly greetings?: Pick<GreetReminder, 'enabled' | 'handle'>;
}

export interface BackgroundSound {
  readonly arbiter: SoundArbiter;
  readonly poller: SubscriberPoller;
  /** Readiness step: what the previous instance of the event page knew (seen events, the throttle, the baselines). */
  start(): Promise<void>;
  /** The first page of «Новые» a tab read for itself: the same rows the poll would bring. */
  fed(page: { readonly pageId: number; readonly platform: string; readonly platformAccountId: string | null }, answer: AudienceNewPage, tabSessionId: string): void;
  /** A tab came or went, the sign-in changed: the poll runs only while a ChatSpace tab lives. */
  sync(): void;
  /** Sign-out, another person: the baselines belong to the previous sign-in. */
  forget(): void;
}

export function createBackgroundSound(deps: BackgroundSoundDeps): BackgroundSound {
  const accounts = () => deps.presence.seenAccounts().map((seen) => seen.account);
  const arbiter = new SoundArbiter({
    ...(deps.stream === undefined ? {} : { stream: deps.stream }),
    ...(deps.local === undefined ? {} : { local: deps.local }),
    clock: deps.clock,
    audio: deps.audio,
    presence: { listeningTabs: () => deps.presence.listeningTabs(), isChatInFocus: (chatKey) => deps.presence.isChatInFocus(chatKey), accounts },
    settings: deps.settings,
    // The owner's `sound` switch of the page in question; unknown while nobody is signed in (the message sound
    // needs no hub, §9.8).
    ownerSwitch: (scope) => {
      if (scope.kind === 'account') return deps.accountFlag(scope.host, scope.hostAccountId, 'sound');
      const bootstrap = deps.bootstrap();
      return bootstrap === null ? null : flagUsable(bootstrap, Number(scope.pageKey), 'sound');
    },
    hostPermission: deps.hostPermission,
    session: deps.session,
    log: deps.log,
    siteTones: (platform) => toneOfPlatform.get(platform) ?? null,
  });

  /** When a tab last read a page's «Новые» itself (epoch ms by pageId). */
  const tabFed = new Map<number, number>();

  /** New subscription events of a page reach the arbiter; every other tab reads its list again. */
  async function hear(batch: Parameters<SoundArbiter['handleSubscribers']>[0], except: string | null): Promise<void> {
    const outcomes = await arbiter.handleSubscribers(batch);
    const pageId = Number(batch.pageKey);
    // NF-029: the check as metadata, in debug mode only (a `debug` record) — how many rows, how many were news.
    deps.log.write({
      level: 'debug',
      scope: 'bg.newcomers',
      msg: 'audience checked',
      fields: { pageId, source: except === null ? 'poll' : 'tab', events: batch.events.length, fresh: outcomes.length, rang: outcomes.filter((outcome) => outcome === 'played').length },
    });
    if (outcomes.length === 0) return;
    for (const tab of deps.tabs()) if (tab !== except) deps.events.emit(tab, 'newcomers.changed', { pageId });
  }

  const pages = (): SubscriberPage[] => {
    const bootstrap = deps.bootstrap();
    if (bootstrap === null) return [];
    const now = deps.clock.now();
    const out: SubscriberPage[] = [];
    for (const page of bootstrap.pages) {
      const platform = narrowPlatform(page.platform);
      // A page with its `sound` switch off is still read for the greeting reminder; the arbiter then rings nothing for it.
      if (platform !== HOST_PLATFORM.chatspace || !deps.newcomersUsable(page.pageLabel) || !(flagUsable(bootstrap, page.pageId, 'sound') || deps.greetings?.enabled() === true)) continue;
      if (now - (tabFed.get(page.pageId) ?? Number.NEGATIVE_INFINITY) < TAB_FED_FRESH_MS) continue;
      out.push({ pageId: page.pageId, pageLabel: page.pageLabel, platform, platformAccountId: page.platformAccountId });
    }
    return out;
  };

  const poller = createSubscriberPoller({
    clock: deps.clock,
    pages,
    read: (page, windowHours) => deps.read(page.pageLabel, windowHours),
    presence: { listeningTabs: () => deps.presence.listeningTabs(), accounts },
    enabled: () => deps.settings()?.subscribers.on === true && flagOnSomePage(deps.bootstrap(), 'sound'),
    sink: { handleSubscribers: (batch) => hear(batch, null) },
    ...(deps.greetings === undefined ? {} : { rows: deps.greetings }),
    online: deps.online,
    log: deps.log,
  });

  return {
    arbiter,
    poller,
    start: () => arbiter.restore(),
    fed(page, answer, tabSessionId) {
      const platform = narrowPlatform(page.platform);
      if (platform !== HOST_PLATFORM.chatspace) return;
      tabFed.set(page.pageId, deps.clock.now());
      deps.greetings?.handle({ pageId: page.pageId, platform, platformAccountId: page.platformAccountId }, answer);
      void hear(
        {
          pageKey: String(page.pageId),
          platform,
          platformAccountId: page.platformAccountId,
          hub: true,
          serverNow: answer.serverNow,
          events: answer.items.filter((item) => (AUDIENCE_KINDS as readonly string[]).includes(item.kind)).map((item) => ({ eventRef: item.eventRef, subscribedAt: item.subscribedAt })),
        },
        tabSessionId,
      ).catch(() => undefined);
    },
    sync() {
      if (deps.tabs().length > 0 && deps.bootstrap() !== null) poller.start();
      else poller.stop();
    },
    forget() {
      tabFed.clear();
      arbiter.forgetSubscribers();
      poller.stop();
    },
  };
}
