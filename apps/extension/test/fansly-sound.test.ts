// Fansly's sounds in the background (R20 P14a; docs/project-unite/architecture.md §8.12; FS-SND-1, FS-SND-2): a Fansly
// tab reports what its page heard over its port — before its application exists, so its answer is not even read —,
// Fansly's background module hands it to the core's ONE arbiter through the kit, and the composition root says what
// is Fansly's: its tones (its section of `settings.ext`), its subscribers (its page's socket — the hub is never polled
// for a Fansly page) and its session's other names of its accounts. The platform's fake browser stands for Firefox; the
// arbiter is the real one over a fake clock and a recording player.

import { CONTRACTS_VERSION, DEFAULT_SETTINGS, type AudienceNewPage, type Bootstrap, type BootstrapPage, type HostAccount } from '@cg/contracts';
import { DEFAULT_SETTINGS_EXT, type SettingsExt } from '@cg/contracts/settings-ext';
import type { FanslySoundFacts } from '@cg/contracts/tab-messages-fansly';
import { TabRegisterResponseSchema } from '@cg/contracts/tab-protocol';
import { flagUsable } from '@cg/core/domain/ops';
import { TONES, type SoundTone } from '@cg/core/domain/sound';
import { createBackgroundRpc, createTabRpcClient, type TabPayloadValidator, type TabRpcClient } from '@cg/platform';
import { BOOTSTRAP_PILOT_PAGES, WORLD } from '@cg/testing/hub';
import { afterEach, describe, expect, it } from 'vitest';

import { FANSLY_ORIGIN, TAB_HOSTS, createFakeBrowser, tabSender, type FakeBrowser } from '../../../packages/platform/src/test-support/fake-browser.ts';
import { fanslyModule } from '../bg/fansly.ts';
import { SUBSCRIBER_SOURCES, createBackgroundSound, type BackgroundSound } from '../src/composition/background/sound.ts';
import type { BackgroundKit, HostSiteRegistry } from '../src/composition/background/host-module.ts';
import { until } from './support/world.ts';

const NOW = Date.parse('2026-10-15T10:00:00.000Z');
const CREATOR = WORLD.pages.fansly.platformAccountId;
const MODEL_TWO = '700000000000000018';
const LEGACY = '424242';
const FAN = WORLD.fansly.chats.a.fan;
const GROUP = WORLD.fansly.chats.a.group;
const FANSLY: HostAccount = { host: 'fansly-web', hostAccountId: CREATOR, platform: 'fansly', platformAccountId: CREATOR, username: 'model_two', displayName: 'Model Two' };
const FANSLY_TWO: HostAccount = { ...FANSLY, hostAccountId: MODEL_TWO, platformAccountId: MODEL_TWO, username: 'model_three' };
const ONE = WORLD.pages.one;
const CHATSPACE: HostAccount = { host: 'chatspace', hostAccountId: ONE.hostAccountId, platform: 'onlyfans', platformAccountId: ONE.platformAccountId, username: 'model_one', displayName: 'Model One' };

/** The pilot with the Fansly page's own `sound` and «Новые» switched on, as the owner may: still never polled for subscribers. */
const ON_FANSLY: Bootstrap = {
  ...BOOTSTRAP_PILOT_PAGES,
  pages: BOOTSTRAP_PILOT_PAGES.pages.map((page): BootstrapPage => {
    const one = BOOTSTRAP_PILOT_PAGES.pages.find((item) => item.pageId === ONE.pageId);
    return page.platform === 'fansly' && one !== undefined ? { ...page, features: { ...page.features, sound: one.features['sound'], newcomers: one.features['newcomers'] } as BootstrapPage['features'] } : page;
  }),
};

/** The early bundle's own check of answers (tab/runtime.ts): the register and the presence ack, nothing else — a Fansly answer included. */
const EARLY: TabPayloadValidator = (kind, type, payload) => {
  if (kind !== 'res' || type !== 'tab.register') return { ok: false };
  const parsed = TabRegisterResponseSchema.safeParse(payload);
  return parsed.success ? { ok: true, payload: parsed.data } : { ok: false };
};
/** The Fansly entry's request of its own registry over the shared client (entrypoints/fansly.ts `withSoundReports`). */
type SiteRequest = (type: string, payload: unknown) => Promise<{ readonly ok: boolean }>;
const report = (client: TabRpcClient, facts: FanslySoundFacts): Promise<{ readonly ok: boolean }> => (client.request as unknown as SiteRequest)('fansly.sound.facts', facts);

function fakeClock(start: number) {
  let now = start;
  return {
    now: () => now,
    setTimer: () => 0,
    clearTimer: () => undefined,
    advance(ms: number) {
      now += ms;
    },
  };
}

interface World {
  readonly fake: FakeBrowser;
  readonly clock: ReturnType<typeof fakeClock>;
  readonly state: { ext: SettingsExt; sound: typeof DEFAULT_SETTINGS.sound; accounts: HostAccount[]; tabs: string[]; bootstrap: Bootstrap | null; reads: string[]; focused: string | null };
  readonly played: SoundTone[];
  sound(): BackgroundSound;
  tab(id?: number): TabRpcClient;
}

const worlds: World[] = [];
afterEach(() => {
  for (const w of worlds.splice(0)) w.fake.unloadBackground();
});

function world(): World {
  const fake = createFakeBrowser();
  const clock = fakeClock(NOW);
  const played: SoundTone[] = [];
  const state: World['state'] = { ext: DEFAULT_SETTINGS_EXT, sound: DEFAULT_SETTINGS.sound, accounts: [FANSLY, FANSLY_TWO, CHATSPACE], tabs: ['tab-a'], bootstrap: null, reads: [], focused: null };
  let current: BackgroundSound | null = null;
  const soundOf = (): BackgroundSound =>
    createBackgroundSound({
      clock,
      audio: {
        prepare: () => Promise.resolve(true),
        play(tone) {
          played.push(tone);
          return Promise.resolve({ played: true });
        },
      },
      presence: {
        listeningTabs: () => state.tabs.length,
        isChatInFocus: (chatKey) => chatKey === state.focused,
        seenAccounts: () => state.accounts.map((account) => ({ account, lastSeenAt: new Date(NOW).toISOString(), openTabs: 1, routeTabs: 1 })),
      },
      settings: () => state.sound,
      bootstrap: () => state.bootstrap,
      newcomersUsable: () => true,
      accountFlag: (_host, hostAccountId, flag) => (state.bootstrap === null ? null : flagUsable(state.bootstrap, hostAccountId === CREATOR ? WORLD.pages.fansly.pageId : ONE.pageId, flag)),
      hostPermission: () => Promise.resolve(true),
      read(pageLabel): Promise<AudienceNewPage> {
        state.reads.push(pageLabel);
        return Promise.reject(new Error('the test serves no rows'));
      },
      online: () => true,
      events: { emit: () => undefined },
      tabs: () => state.tabs,
      session: { get: () => Promise.resolve(undefined), set: () => Promise.resolve() },
      log: { write: () => undefined },
      ext: () => state.ext,
      // As the background wires it: the site's session's ids on Fansly's platform, none elsewhere.
      aliases: (platform) => (platform === 'fansly' ? [LEGACY] : []),
    });
  // The event page as composition/background.ts starts it: the core's RPC, the kit's `site` and `sound` ports, Fansly's module.
  fake.onWake((context) => {
    const rpc = createBackgroundRpc({ api: context.api, tabHosts: TAB_HOSTS, ready: Promise.resolve(), contractsVersion: CONTRACTS_VERSION, testBuild: true, siteWaitMs: 2_000 });
    current = soundOf();
    const kit = {
      storage: { local: { get: () => Promise.resolve({ ok: true, value: {} }), set: () => Promise.resolve({ ok: true }), remove: () => Promise.resolve({ ok: true }) } },
      clock,
      log: { service: () => undefined },
      router: { tabs: () => rpc.tabs().map((tab) => tab.tabSessionId) },
      site: { plug: (registry: HostSiteRegistry) => rpc.site({ ...registry, host: 'fansly-web' }) },
      sound: current.port,
    } as unknown as BackgroundKit;
    void fanslyModule().start(kit);
  });
  const w: World = {
    fake,
    clock,
    state,
    played,
    sound() {
      if (current === null) throw new Error('no background yet');
      return current;
    },
    tab(id = 12) {
      const url = `${FANSLY_ORIGIN}/notifications`;
      return createTabRpcClient({ api: fake.context(tabSender(fake, { url, origin: FANSLY_ORIGIN, tab: { id, url } })).api, validate: EARLY, register: { host: 'fansly-web', lateInjection: false, contractsVersion: CONTRACTS_VERSION }, reconnectDelaysMs: [5, 10, 20] });
    },
  };
  worlds.push(w);
  return w;
}

const message = (msgId: string, over: Partial<FanslySoundFacts['messages'][number]> = {}): FanslySoundFacts['messages'][number] => ({
  groupId: GROUP,
  fanId: FAN,
  senderId: FAN,
  msgId,
  fromFan: true,
  automated: false,
  tip: false,
  createdAt: new Date(NOW - 1000).toISOString(),
  ...over,
});
const facts = (messages: FanslySoundFacts['messages'], follows: FanslySoundFacts['follows'] = []): FanslySoundFacts => ({ creatorId: CREATOR, messages, follows });
const outcomes = (w: World): Readonly<Record<string, number>> => w.sound().arbiter.diagnostics().outcomes;

describe('[host:fansly] Fansly’s sounds between its tab and the one arbiter (R20 P14a)', () => {
  it('[SN-001] [SN-016] [ST-127] a batch the early bundle reports reaches the arbiter through Fansly’s module: the fan’s message rings Fansly’s chime — no sign-in, no application', async () => {
    const w = world();
    const client = w.tab();
    await until(() => client.state() === 'ready', 'the Fansly tab registered');
    // Its answer passes the early bundle's check of nothing: the tab does not read it — the arbiter decides anyway.
    await report(client, facts([message('700000000000000101')]));
    await until(() => w.played.length === 1, 'the message rang');
    expect(w.played).toEqual([TONES.chime]);
    expect(outcomes(w)).toEqual({ played: 1 });
  });

  it('[SN-002] [SN-003] [SN-004] [SN-006] the creator’s own message, another model’s, the creator under its legacy id, an automation, a tip, a muted model: each silent with its name', async () => {
    const w = world();
    const client = w.tab();
    await until(() => client.state() === 'ready', 'the Fansly tab registered');
    await report(
      client,
      facts([
        message('700000000000000102', { fromFan: false, senderId: CREATOR }),
        message('700000000000000103', { fanId: MODEL_TWO, senderId: MODEL_TWO }),
        message('700000000000000104', { senderId: LEGACY }),
        message('700000000000000105', { automated: true }),
        message('700000000000000106', { tip: true }),
      ]),
    );
    await until(() => Object.values(outcomes(w)).reduce((sum, count) => sum + count, 0) === 5, 'five decided');
    expect(outcomes(w)).toEqual({ 'not-fan': 3, automatic: 1, tip: 1 });
    w.state.sound = { ...DEFAULT_SETTINGS.sound, mutedAccounts: [`fansly-web:${CREATOR}`] };
    await report(client, facts([message('700000000000000107')], [{ eventId: '700000000000000201', accountId: CREATOR, followerId: FAN }]));
    await until(() => outcomes(w)['muted'] === 1 && outcomes(w)['subscriber.muted'] === 1, 'the muted model counted');
    expect(w.played).toEqual([]);
  });

  it('[SN-008] [SN-010] [SN-012] [ST-129] two tabs of the model report the same message: it rings once; the chat in front rings nothing; a new subscriber of the page’s socket rings Fansly’s double; the Fansly section’s choice rings when made', async () => {
    const w = world();
    const first = w.tab(12);
    const second = w.tab(13);
    await until(() => first.state() === 'ready' && second.state() === 'ready', 'both Fansly tabs registered');
    await report(first, facts([message('700000000000000111')]));
    await report(second, facts([message('700000000000000111')]));
    await until(() => outcomes(w)['duplicate'] === 1, 'the second copy decided');
    expect(w.played).toEqual([TONES.chime]);
    w.state.focused = `fansly-web:${CREATOR}:${FAN}`;
    await report(first, facts([message('700000000000000112')]));
    await until(() => outcomes(w)['open-chat'] === 1, 'the chat in front decided');
    w.state.focused = null;
    w.clock.advance(2000);
    await report(first, facts([], [{ eventId: '700000000000000202', accountId: CREATOR, followerId: FAN }]));
    await until(() => w.played.length === 2, 'the subscriber rang');
    expect(w.played[1]).toBe(TONES.double);
    // The person's Fansly tones (`settings.ext`, «Вид»): they ring on Fansly; ChatSpace's own choice does not reach it.
    w.state.ext = { ...DEFAULT_SETTINGS_EXT, hosts: { 'fansly-web': { ...DEFAULT_SETTINGS_EXT.hosts['fansly-web'], sound: { messagesTone: 'bell', subscribersTone: 'knock' } } } };
    w.state.sound = { ...DEFAULT_SETTINGS.sound, messages: { on: true, tone: 'drop' } };
    w.clock.advance(10_000);
    await report(first, facts([message('700000000000000113', { createdAt: new Date(NOW + 11_000).toISOString() })], [{ eventId: '700000000000000203', accountId: CREATOR, followerId: '700000000000000099' }]));
    await until(() => w.played.length === 3, 'the message rang');
    expect(w.played.slice(2)).toEqual([TONES.bell]);
    expect(outcomes(w)['subscriber.throttled']).toBe(1);
  });

  it('[SN-012] a Fansly page is never polled for its subscribers — its page hears them — while ChatSpace’s page is; what a tab read of Fansly’s «Новые» rings nothing', async () => {
    const w = world();
    const client = w.tab();
    await until(() => client.state() === 'ready', 'the Fansly tab registered');
    expect(SUBSCRIBER_SOURCES).toEqual({ chatspace: 'hub', 'fansly-web': 'page' });
    w.state.bootstrap = ON_FANSLY;
    // Both pages may ring and have «Новые»: the Fansly one is still not asked.
    expect(flagUsable(ON_FANSLY, WORLD.pages.fansly.pageId, 'sound')).toBe(true);
    w.state.accounts = [FANSLY, CHATSPACE];
    await w.sound().poller.tick();
    expect(w.state.reads).toEqual([ONE.pageLabel]);
    w.sound().fed({ pageId: WORLD.pages.fansly.pageId, platform: 'fansly', platformAccountId: CREATOR }, { items: [] } as unknown as AudienceNewPage, 'tab-a');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(outcomes(w)).toEqual({});
  });
});
