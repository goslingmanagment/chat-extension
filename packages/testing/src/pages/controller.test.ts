// The page controllers of core (`createPagesClient`) over the scripted
// background: the view models of the popup, the options page and the debug
// pages, and the rules of §8.2, §9.3, §9.4, §9.5 and §9.9.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHATSPACE_STATUS_TEXTS, DEFAULT_SETTINGS, SETTINGS_SECTIONS, UiActionSchema, type DiagnosticsSnapshot, type HostKind, type OptionsVM, type SettingsSection, type StatusRowVM, type UiAction } from '@cg/contracts';
import { FEATURES_COMMON } from '@cg/contracts/features/common';
import { FANSLY_FEATURES } from '@cg/contracts/features/fansly';
import { AUTOSAVE_DEBOUNCE_MS, RECHECK_MIN_INTERVAL_MS, routeOfHash, type PageSite } from '@cg/core/application/pages';

import { SCENARIO_FEATURES } from '../scenarios/app-client';
import { PAGES_HOST_ORIGIN, PAGES_NOW, PAGES_SITES, PAGES_VERSION, hostReport, pagesWorld, sameTitleState, settle, signedOutState, troubledState, workingState, type PagesWorld, type PagesWorldOptions } from './world';

let world: PagesWorld | null = null;
let clock = PAGES_NOW;

async function open(options: PagesWorldOptions = {}): Promise<PagesWorld> {
  world = pagesWorld({ now: () => clock, ...options });
  world.client.start();
  await settle();
  return world;
}

const options = <S extends SettingsSection>(w: PagesWorld, section: S): Readonly<OptionsVM<S>> => w.client.getSnapshot({ of: 'options', section });
/** A row by its id, or a site's row by its site (R20 F7: one `host` row per site). */
const row = (w: PagesWorld, id: StatusRowVM['id'] | HostKind): StatusRowVM | undefined => options(w, 'status').body?.rows.find((entry) => entry.id === id || (entry.id === 'host' && entry.host === id));
const text = (w: PagesWorld, value: StatusRowVM['value'] | null | undefined): string => (value === null || value === undefined ? '' : typeof value === 'string' ? value : w.i18n.text(value));

/**
 * ChatSpace on `/accounts/<routeOn>/chats` with no chat open: one tab that has loaded both accounts 1001 and 1002
 * (1001 seen most recently), its route on `routeOn` — the owner's live check of 2026-10-09 (36408 and 36409).
 */
function twoLoadedState({ routeOn }: { readonly routeOn: '1001' | '1002' }): ReturnType<typeof workingState> {
  const state = workingState();
  state.diagnostics = { ...state.diagnostics, tabs: state.diagnostics.tabs.map((tab) => ({ ...tab, chatKey: null })) };
  state.accounts = state.accounts.map((entry) => {
    const id = entry.account.hostAccountId;
    return id === '1001' || id === '1002' ? { ...entry, openTabs: 1, routeTabs: id === routeOn ? 1 : 0 } : entry;
  });
  return state;
}

beforeEach(() => {
  clock = PAGES_NOW;
  vi.useFakeTimers({ now: PAGES_NOW });
});
afterEach(() => {
  world?.client.dispose();
  world = null;
  vi.useRealTimers();
});

describe('popup view model', () => {
  it('[PU-003] [PU-004] [PU-005] [PU-014] a working shift: version, persona of the page, both pills, the open chat, the quota', async () => {
    const w = await open({ page: 'popup' });
    const vm = w.client.getSnapshot({ of: 'popup' });
    expect(vm.view).toEqual({ s: 'ready' });
    expect(vm.version).toBe(PAGES_VERSION);
    expect(vm.pills).toEqual({ host: 'connected', hub: 'ok' });
    expect(vm.problems).toEqual([]);
    expect(vm.persona).toEqual({ s: 'set', label: 'Лора · VIP', pageName: 'LoraVie VIP', page: { platform: 'onlyfans', pageLabel: 'loravie-vip', platformName: 'OnlyFans' } });
    expect(vm.account?.login).toBe('chatter1');
    expect(vm.chat).toMatchObject({ hostAccountLabel: 'OnlyMonster 1001', copyIds: { hostAccountId: '1001', creatorId: '3003' } });
    expect(vm.quota).toEqual({ remaining: 12, resetsAt: '2026-10-04T00:00:00Z', low: true });
    expect(vm.newcomersCount).toBe(3);
  });

  it('[PU-008] the open chat is named by the name the tab already knows; without one, by the id — nothing is read for it (X47)', async () => {
    const state = workingState();
    const w = await open({ page: 'popup', state });
    expect(w.client.getSnapshot({ of: 'popup' }).chat?.fanName).toBe('фан 2002');
    expect(w.client.getSnapshot({ of: 'popup' }).chat?.copyIds.fanId).toBeUndefined();
    world?.client.dispose();
    const named = { ...state, fanLabels: [{ chatKey: 'chatspace:1001:2002' as const, label: 'Hubert' }] };
    const w2 = await open({ page: 'popup', state: named });
    expect(w2.client.getSnapshot({ of: 'popup' }).chat?.fanName).toBe('Hubert');
    // The id is not lost: the name copies it.
    expect(w2.client.getSnapshot({ of: 'popup' }).chat?.copyIds).toMatchObject({ fanId: '2002', hostAccountId: '1001' });
    // The names come from the background's memory alone: no hub read, no other fan's data.
    expect(w2.background.requests('fans.labels')).toEqual([{}]);
    expect(w2.background.calls.some((call) => call.type === 'fan.card' || call.type === 'fan.dossier')).toBe(false);
  });

  it('[PU-008] a slow answer of the names (CI run 39000333690): the persona is drawn first with the id, the name follows when the answer lands (X47)', async () => {
    const state = workingState();
    state.fanLabels = [{ chatKey: 'chatspace:1001:2002', label: 'Hubert' }];
    world = pagesWorld({ now: () => clock, page: 'popup', state });
    const release = world.background.hold('fans.labels');
    world.client.start();
    await settle();
    // What the e2e read on the PC runner: ready, the persona set — and the dialog still by its id.
    const early = world.client.getSnapshot({ of: 'popup' });
    expect(early.view.s).toBe('ready');
    expect(early.persona).toMatchObject({ s: 'set' });
    expect(early.chat?.fanName).toBe('фан 2002');
    release();
    await settle();
    expect(world.client.getSnapshot({ of: 'popup' }).chat?.fanName).toBe('Hubert');
  });

  it('[PU-008] a name the tab tells after the popup opened shows at once: `fans.changed` and a new read, no reopening (X47)', async () => {
    const w = await open({ page: 'popup' });
    expect(w.client.getSnapshot({ of: 'popup' }).chat?.fanName).toBe('фан 2002');
    const seen: string[] = [];
    w.client.subscribe({ of: 'popup' }, (vm) => seen.push(vm.chat?.fanName ?? ''));
    w.background.state.fanLabels = [{ chatKey: 'chatspace:1001:2002', label: 'Hubert' }];
    w.background.emit('fans.changed', {});
    await settle();
    expect(w.client.getSnapshot({ of: 'popup' }).chat?.fanName).toBe('Hubert');
    expect(seen.at(-1)).toBe('Hubert');
    expect(w.background.requests('fans.labels')).toEqual([{}, {}]);
    // An answer that comes after a newer one is not applied over it.
    const release = w.background.hold('fans.labels');
    w.background.emit('fans.changed', {});
    w.background.state.fanLabels = [{ chatKey: 'chatspace:1001:2002', label: 'Hubert P.' }];
    release();
    w.background.emit('fans.changed', {});
    await settle();
    expect(w.client.getSnapshot({ of: 'popup' }).chat?.fanName).toBe('Hubert P.');
  });

  it('[R20-F4] [NEW-01] the count of «Новые» is asked of the hub only where the site’s manifest admits them and names the hub as their source', async () => {
    const asked = (w: PagesWorld): boolean => w.background.calls.some((call) => call.type === 'newcomers.list');
    // ChatSpace: the hub's `audience-new`, under the page's own `newcomers`.
    const chatspace = await open({ page: 'popup' });
    expect([asked(chatspace), chatspace.client.getSnapshot({ of: 'popup' }).newcomersCount]).toEqual([true, 3]);
    chatspace.client.dispose();
    // A site whose «Новые» are its own pass over the page's API (Fansly's entry): the hub has no list to count.
    const pass = await open({ page: 'popup', features: () => ({ ...SCENARIO_FEATURES, newcomers: { ...FANSLY_FEATURES.newcomers, ...FEATURES_COMMON.newcomers } }) });
    expect([asked(pass), pass.client.getSnapshot({ of: 'popup' }).newcomersCount]).toEqual([false, null]);
    pass.client.dispose();
    // A site that has no «Новые» at all, and a site the extension has no slice for.
    const { newcomers: _newcomers, ...without } = SCENARIO_FEATURES;
    for (const features of [() => without, () => null]) {
      const w = await open({ page: 'popup', features });
      expect([asked(w), w.client.getSnapshot({ of: 'popup' }).newcomersCount]).toEqual([false, null]);
      w.client.dispose();
    }
    // And the page's own switch decides, as before: off for the page — nothing is asked.
    const state = workingState();
    state.bootstrap = { ...state.bootstrap, pages: state.bootstrap.pages.map((page) => ({ ...page, features: { ...page.features, newcomers: { available: false, reason: 'flag_off' } } })) };
    const off = await open({ page: 'popup', state });
    expect([asked(off), off.client.getSnapshot({ of: 'popup' }).newcomersCount]).toEqual([false, null]);
  });

  it('[PU-004] [AU-034] no chat open, two accounts loaded: the persona and page are of the account the route is on', async () => {
    const w = await open({ page: 'popup', state: twoLoadedState({ routeOn: '1002' }) });
    const vm = w.client.getSnapshot({ of: 'popup' });
    expect(vm.persona).toMatchObject({ s: 'set', label: 'Лора · Free', pageName: 'LoraVie Free' });
    expect(vm.chat).toBeNull();
  });

  it('[PU-001] a background that does not answer is CG-RUNTIME-UNREACHABLE with a retry, never an endless loading', async () => {
    const state = workingState();
    world = pagesWorld({ page: 'popup', state, now: () => clock });
    world.background.unreachable = true;
    world.client.start();
    await settle();
    const vm = world.client.getSnapshot({ of: 'popup' });
    expect(vm.view.s).toBe('error');
    expect(vm.view.s === 'error' ? vm.view.error.code : null).toBe('CG-RUNTIME-UNREACHABLE');
    expect(vm.view.s === 'error' ? vm.view.retry : null).toEqual({ type: 'ReloadView', selector: { of: 'popup' } });
    // «Повторить» reads again once the background is back.
    world.background.unreachable = false;
    await world.client.dispatch({ type: 'ReloadView', selector: { of: 'popup' } });
    await settle();
    expect(world.client.getSnapshot({ of: 'popup' }).view.s).toBe('ready');
  });

  it('[PU-002] without a sign-in the popup is CG-AUTH-REQUIRED and leads to «Аккаунт»', async () => {
    const w = await open({ page: 'popup', state: signedOutState() });
    const vm = w.client.getSnapshot({ of: 'popup' });
    expect(vm.view).toMatchObject({ s: 'forbidden', error: { code: 'CG-AUTH-REQUIRED' }, remedy: { type: 'OpenSettings', route: { section: 'account', code: 'CG-AUTH-REQUIRED' } } });
    expect(vm.account).toBeNull();
    // Nothing of the hub is asked for while nobody is signed in.
    expect(w.background.requests('bootstrap.get')).toEqual([]);
  });

  it('[PU-002] a sign-in state that could not be read is its error with «Повторить» — a failed read is not a sign-out', async () => {
    const w = pagesWorld({ page: 'popup', now: () => clock });
    world = w;
    w.background.failNext('session.get', { code: 'CG-TIMEOUT' });
    w.client.start();
    await settle();
    const vm = w.client.getSnapshot({ of: 'popup' });
    expect(vm.view).toMatchObject({ s: 'error', error: { code: 'CG-TIMEOUT' }, retry: { type: 'ReloadView', selector: { of: 'popup' } } });
    // Neither «Войдите» nor a made-up account, and nothing of the hub asked under an unknown sign-in.
    expect(vm.account).toBeNull();
    expect(w.background.requests('bootstrap.get')).toEqual([]);
    await w.client.dispatch({ type: 'ReloadView', selector: { of: 'popup' } });
    await settle();
    expect(w.client.getSnapshot({ of: 'popup' })).toMatchObject({ view: { s: 'ready' }, account: { login: 'chatter1' } });
  });

  it('[PU-002] a refresh that fails keeps what was known: signed in stays signed in', async () => {
    const w = await open({ page: 'popup' });
    w.background.failNext('session.get', { code: 'CG-TIMEOUT' });
    await w.client.dispatch({ type: 'ReloadView', selector: { of: 'popup' } });
    await settle();
    expect(w.client.getSnapshot({ of: 'popup' })).toMatchObject({ view: { s: 'ready' }, account: { login: 'chatter1' } });
  });

  it('a restricted setting is refused from the popup before anything is sent', async () => {
    const w = await open({ page: 'popup' });
    expect(await w.client.dispatch({ type: 'SetPreference', key: 'debug.enabled', value: true })).toMatchObject({ ok: false, code: 'CG-UNKNOWN' });
    expect(await w.client.dispatch({ type: 'SetPreference', key: 'debug.renderTrace', value: true })).toMatchObject({ ok: false, code: 'CG-UNKNOWN' });
    expect(await w.client.dispatch({ type: 'SetPreference', key: 'hub.baseUrl', value: 'https://hub.example.test' })).toMatchObject({ ok: false });
    expect([...w.background.requests('settings.patch'), ...w.background.requests('settings.patchRestricted')]).toEqual([]);
    expect(w.state.settings.debug.enabled).toBe(false);
  });

  it('[PU-006] [PU-022] the hub down and ChatSpace partly checked: the pills, and each problem once with its code', async () => {
    const state = troubledState();
    const w = pagesWorld({ page: 'popup', state, now: () => clock });
    world = w;
    w.background.failNext('bootstrap.get', { code: 'CG-HUB-UNAVAILABLE' }, 5);
    w.client.start();
    await settle();
    const vm = w.client.getSnapshot({ of: 'popup' });
    expect(vm.pills).toEqual({ host: 'copy-only', hub: 'down' });
    expect(vm.problems.map((problem) => problem.code)).toEqual(['CG-HUB-UNAVAILABLE', 'CG-HOST-CONTRACT']);
    expect(vm.view.s).toBe('offline');
  });

  it('[PU-009] quota 0 is shown as 0 with its reset time; an unknown quota is null, never 0', async () => {
    const state = workingState();
    state.quotas[11] = { pageId: 11, remainingRequestsToday: 0, remainingMicroUsdToday: null, resetsAt: '2026-10-04T00:00:00Z', observedAt: '2026-10-03T06:00:00Z' };
    const w = await open({ page: 'popup', state });
    expect(w.client.getSnapshot({ of: 'popup' }).quota).toEqual({ remaining: 0, resetsAt: '2026-10-04T00:00:00Z', low: true });
    state.quotas[11] = null;
    await w.client.dispatch({ type: 'ReloadView', selector: { of: 'popup' } });
    await settle();
    expect(w.client.getSnapshot({ of: 'popup' }).quota).toEqual({ remaining: null, resetsAt: null, low: false });
  });

  it('[PU-010] «Настройки» opens the one settings tab at «Статус» and closes the popup', async () => {
    const w = await open({ page: 'popup' });
    const settings = w.client.getSnapshot({ of: 'popup' }).buttons.find((button) => button.action.type === 'OpenSettings');
    expect(settings?.action).toEqual({ type: 'OpenSettings', route: { section: 'status' } });
    const receipt = await w.client.dispatch(settings?.action as UiAction);
    expect(receipt).toMatchObject({ ok: true, outcome: 'opened' });
    expect(w.browser.record.opened).toEqual([{ page: 'options', hash: 'status' }]);
    expect(w.browser.record.closed).toBe(1);
  });

  it('[PU-017] Spenders, «Новые» and «Клавиши» hand the click to a ChatSpace tab; without a tab they say why', async () => {
    const w = await open({ page: 'popup' });
    const [spenders, , keys] = w.client.getSnapshot({ of: 'popup' }).buttons;
    expect(spenders?.hotkey?.display).toBe('⌘⇧M');
    expect(keys?.hotkey?.display).toBe('?');
    await w.client.dispatch(keys?.action as UiAction);
    expect(w.background.requests('tab.command')).toEqual([{ command: { kind: 'surface', surface: 'cheatsheet' } }]);
    expect(w.browser.record.closed).toBe(1);

    const closed = workingState();
    closed.diagnostics = { ...closed.diagnostics, tabs: [] };
    world?.client.dispose();
    const w2 = await open({ page: 'popup', state: closed });
    const vm = w2.client.getSnapshot({ of: 'popup' });
    expect(vm.pills.host).toBe('closed');
    expect(vm.buttons.slice(0, 3).every((button) => !button.enabled && button.reason?.text.key === 'popup.needsChatSpace')).toBe(true);
    expect(vm.buttons[3]?.enabled).toBe(true);
    expect(vm.problems.map((problem) => problem.code)).not.toContain('CG-RUNTIME-RELOADED');
  });

  it('[PU-017] a ChatSpace tab left from the build before the update is not «no tab»: the reason is the reload, and the popup says so', async () => {
    const stale = workingState();
    const updated = { at: '2026-10-03T06:02:00.000Z', from: '0.4.2', staleTabs: 1 };
    stale.diagnostics = { ...stale.diagnostics, tabs: [], extension: { ...stale.diagnostics.extension, updated } };
    const w = await open({ page: 'popup', state: stale });
    const vm = w.client.getSnapshot({ of: 'popup' });
    expect(vm.pills.host).toBe('closed');
    expect(vm.problems.map((problem) => problem.code)).toContain('CG-RUNTIME-RELOADED');
    expect(vm.buttons.slice(0, 3).map((button) => [button.enabled, button.reason?.code, button.reason?.text.key])).toEqual(Array(3).fill([false, 'CG-RUNTIME-RELOADED', 'dock.reason.reloadNeeded']));
    expect(vm.buttons[3]?.enabled).toBe(true);
  });

  it('[PU-011] «Что нового» and «История версий» open the site pages over https', async () => {
    const w = await open({ page: 'popup' });
    const { links } = w.client.getSnapshot({ of: 'popup' });
    await w.client.dispatch(links.whatsNew);
    await w.client.dispatch(links.changelog);
    expect(w.browser.record.links).toEqual(['https://ext.example.test/chat-extension/whats-new.html', 'https://ext.example.test/chat-extension/changelog.html']);
  });

  it('[PU-011] a link that is not https is never opened: CG-NAV-FAILED', async () => {
    const w = await open({ page: 'popup', links: { whatsNew: 'http://ext.example.test/whats-new.html', changelog: null } });
    const { links } = w.client.getSnapshot({ of: 'popup' });
    expect(await w.client.dispatch(links.whatsNew)).toMatchObject({ ok: false, code: 'CG-NAV-FAILED' });
    expect(await w.client.dispatch(links.changelog)).toMatchObject({ ok: false, code: 'CG-NAV-FAILED' });
    expect(w.browser.record.links).toEqual([]);
    // Nothing was opened, so the notes of this version are not marked as seen either.
    expect(w.background.requests('settings.patch')).toEqual([]);
  });

  it('[PU-017] a click the tab did not take is CG-HOST-NOT-READY, and the popup stays open', async () => {
    const state = workingState();
    state.diagnostics = { ...state.diagnostics, tabs: [] };
    const w = await open({ page: 'popup', state });
    const receipt = await w.client.dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'spenders', open: true } });
    expect(w.background.requests('tab.command')).toHaveLength(1);
    expect(receipt).toMatchObject({ ok: false, code: 'CG-HOST-NOT-READY' });
    expect(w.browser.record.closed).toBe(0);
  });

  it('[PU-013] the popup redraws when the sign-in changes elsewhere', async () => {
    const w = await open({ page: 'popup' });
    const seen: string[] = [];
    w.client.subscribe({ of: 'popup' }, (vm) => seen.push(vm.view.s));
    w.background.setSession(null, 'revoked');
    await settle();
    const vm = w.client.getSnapshot({ of: 'popup' });
    expect(vm.view).toMatchObject({ s: 'forbidden', error: { code: 'CG-AUTH-REVOKED' } });
    expect(seen).toContain('forbidden');
  });

  it('[PU-016] «AI сегодня $» exists only in debug mode', async () => {
    const state = workingState();
    state.usage = {
      scope: { pageLabel: 'loravie-vip', userId: 7 },
      timeZone: 'Europe/Moscow',
      asOf: '2026-10-03T06:20:00Z',
      moneyUnit: 'micro-USD',
      days: [
        {
          date: '2026-10-03',
          from: '2026-10-02T21:00:00Z',
          toExclusive: '2026-10-03T21:00:00Z',
          coverage: 'partial',
          coverageReasons: ['day_open'],
          totals: { requestCount: 9, costMicroUsd: 420_000, costApproximate: false, tokens: { input: 1, output: 1, cacheWrite: 0, cacheRead: 0 }, completed: 9, failed: 0, cancelled: 0, quotaDenied: 0, openReservations: 0, regenerations: 0 },
          features: [],
        },
      ],
      quota: { dayBoundary: 'UTC', remainingRequestsToday: 12, remainingMicroUsdToday: null },
    };
    const w = await open({ page: 'popup', state });
    expect(w.client.getSnapshot({ of: 'popup' }).aiTodayLine).toBeNull();
    expect(w.background.requests('usage.get')).toEqual([]);

    world?.client.dispose();
    const debug = { ...state, settings: { ...state.settings, debug: { enabled: true, renderTrace: false } } };
    const w2 = await open({ page: 'popup', state: debug });
    expect(w2.client.getSnapshot({ of: 'popup' }).aiTodayLine).toBe('AI сегодня $0.4200');

    // A known zero of money is not drawn: before the day's first generation the line is not there at all.
    world?.client.dispose();
    const usage = state.usage;
    const day = usage?.days[0];
    if (usage === null || usage === undefined || day === undefined) throw new Error('the state has no usage day');
    const nothingYet = { ...debug, usage: { ...usage, days: [{ ...day, totals: { ...day.totals, requestCount: 0, costMicroUsd: 0, completed: 0 } }] } };
    const w3 = await open({ page: 'popup', state: nothingYet });
    expect(w3.client.getSnapshot({ of: 'popup' }).aiTodayLine).toBeNull();
  });
});

describe('options: hash routes and deep links', () => {
  it('[ST-003] `#section` and `#section:CODE`; garbage opens «Статус»', () => {
    expect(routeOfHash('#account')).toEqual({ section: 'account' });
    expect(routeOfHash('#account:CG-HUB-URL')).toEqual({ section: 'account', code: 'CG-HUB-URL' });
    expect(routeOfHash('')).toEqual({ section: 'status' });
    expect(routeOfHash('#nonsense')).toEqual({ section: 'status' });
    expect(routeOfHash('#account:NOT-A-CODE')).toEqual({ section: 'account' });
    expect(routeOfHash('#account:CG-HUB-URL:extra')).toEqual({ section: 'status' });
    expect(routeOfHash('#%E0%A4%A')).toEqual({ section: 'status' });
  });

  it('[ST-007] a code alone opens the section its registry entry names', () => {
    expect(routeOfHash('#CG-BINDING-MISSING')).toEqual({ section: 'accounts', code: 'CG-BINDING-MISSING' });
    expect(routeOfHash('#CG-PERSONA-UNASSIGNED')).toEqual({ section: 'personas', code: 'CG-PERSONA-UNASSIGNED' });
    expect(routeOfHash('#CG-HUB-URL')).toEqual({ section: 'account', code: 'CG-HUB-URL' });
    // A code with no section of its own lands on «Статус».
    expect(routeOfHash('#CG-NETWORK')).toEqual({ section: 'status', code: 'CG-NETWORK' });
  });

  it('[ST-008] [ST-009] a deep link carries the plate «КОД · описание»; every hash change is a new location', async () => {
    const w = await open({ hash: '#accounts:CG-BINDING-MISSING' });
    expect(w.client.location.value).toMatchObject({ section: 'accounts', code: 'CG-BINDING-MISSING' });
    const vm = options(w, 'accounts');
    expect(vm.highlight).toMatchObject({ code: 'CG-BINDING-MISSING', title: 'Аккаунт не привязан' });
    const before = w.client.location.value.seq;
    // The same link clicked again: the location changes, so the highlight runs again.
    w.browser.go('#accounts:CG-BINDING-MISSING');
    expect(w.client.location.value.seq).toBeGreaterThan(before);
    w.browser.go('#generation');
    expect(w.client.location.value).toMatchObject({ section: 'generation' });
    expect(options(w, 'generation').highlight).toBeNull();
  });

  it('[ST-002] [ST-004] eight sections in the navigation; a section with a problem carries a dot', async () => {
    const state = workingState();
    // One page loses its persona: «Персоны» gets a dot.
    const { '12': _dropped, ...kept } = state.settings.personas.byPageId;
    state.settings = { ...state.settings, personas: { ...state.settings.personas, byPageId: kept } };
    const w = await open({ state });
    const nav = options(w, 'status').nav;
    expect(nav.map((item) => item.section)).toEqual([...SETTINGS_SECTIONS]);
    expect(nav.filter((item) => item.problem).map((item) => item.section)).toEqual(['personas']);
  });

  it('[ST-006] OpenSettings on the options page moves the hash of this tab instead of opening another one', async () => {
    const w = await open();
    await w.client.dispatch({ type: 'OpenSettings', route: { section: 'personas', code: 'CG-PERSONA-UNASSIGNED' } });
    expect(w.browser.record.hashes).toEqual(['personas:CG-PERSONA-UNASSIGNED']);
    expect(w.browser.record.opened).toEqual([]);
    expect(w.client.location.value).toMatchObject({ section: 'personas', code: 'CG-PERSONA-UNASSIGNED' });
  });
});

describe('options: saving (§9.4)', () => {
  it('[ST-013] a switch is written at once; a typed number waits 300 ms after the last change and goes as one write', async () => {
    const w = await open();
    void w.client.dispatch({ type: 'SetPreference', key: 'ui.hints', value: false });
    await settle();
    expect(w.background.requests('settings.patch')).toEqual([{ patch: { ui: { hints: false } }, baseRevision: 7 }]);

    void w.client.dispatch({ type: 'SetPreference', key: 'generation.windows.quick', value: 80 });
    void w.client.dispatch({ type: 'SetPreference', key: 'generation.windows.quick', value: 60 });
    void w.client.dispatch({ type: 'SetPreference', key: 'generation.windows.ping', value: 50 });
    await settle();
    expect(w.background.requests('settings.patch')).toHaveLength(1);
    // The page already shows what the person chose, marked as still being saved.
    expect(options(w, 'generation').body?.windows).toMatchObject({ quick: 60, ping: 50 });
    expect(options(w, 'generation').save).toEqual({ s: 'saving' });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS - 1);
    expect(w.background.requests('settings.patch')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(w.background.requests('settings.patch')[1]).toEqual({ patch: { generation: { windows: { quick: 60, ping: 50 } } }, baseRevision: 8 });
    expect(w.state.settings.generation.windows).toMatchObject({ quick: 60, ping: 50 });
  });

  it('[ST-014] «Сохранено ✓» appears only with the revision the background confirmed', async () => {
    const w = await open();
    const release = w.background.hold('settings.patch');
    const pending = w.client.dispatch({ type: 'SetPreference', key: 'ui.resultStyle', value: 'sheet' });
    await settle();
    // Sent, not yet answered: nothing says «Сохранено».
    expect(options(w, 'appearance').save).toEqual({ s: 'saving' });
    expect(options(w, 'appearance').body?.resultStyle).toBe('sheet');
    release();
    const receipt = await pending;
    expect(receipt).toMatchObject({ ok: true, type: 'SetPreference', revision: 8 });
    expect(options(w, 'appearance').save).toEqual({ s: 'saved', revision: 8 });
  });

  it('[ST-014] a refused write is «не сохранено» with «Повторить»; the retry is a click and sends the same change', async () => {
    const w = await open();
    w.background.failNext('settings.patch', { code: 'CG-STORAGE-WRITE' });
    const receipt = await w.client.dispatch({ type: 'SetPreference', key: 'generation.split', value: true });
    expect(receipt).toMatchObject({ ok: false, code: 'CG-STORAGE-WRITE' });
    const vm = options(w, 'generation');
    expect(vm.save).toMatchObject({ s: 'failed', error: { code: 'CG-STORAGE-WRITE' }, retry: { type: 'RetrySettingsWrite' } });
    // The person's choice stays on the page, marked as unsaved; nothing was resent by itself.
    expect(vm.body?.split).toBe(true);
    expect(w.state.settings.generation.split).toBe(false);
    expect(w.background.requests('settings.patch')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(w.background.requests('settings.patch')).toHaveLength(1);

    const retried = await w.client.dispatch({ type: 'RetrySettingsWrite' });
    expect(retried).toMatchObject({ ok: true, revision: 8 });
    expect(w.state.settings.generation.split).toBe(true);
    expect(options(w, 'generation').save).toEqual({ s: 'saved', revision: 8 });
  });

  it('[ST-015] pagehide sends what still waits for its pause, best effort', async () => {
    const w = await open();
    void w.client.dispatch({ type: 'SetPreference', key: 'sound.volume', value: 35 });
    await settle();
    expect(w.background.requests('settings.patch')).toEqual([]);
    w.browser.pageHide();
    await settle();
    expect(w.background.requests('settings.patch')).toEqual([{ patch: { sound: { volume: 35 } }, baseRevision: 7 }]);
  });

  it('[ST-016] a store newer than this build is read-only: nothing is written', async () => {
    const state = workingState();
    state.readOnly = true;
    const w = await open({ state });
    expect(options(w, 'appearance').readOnly).toBe(true);
    const receipt = await w.client.dispatch({ type: 'SetPreference', key: 'ui.hints', value: false });
    expect(receipt).toMatchObject({ ok: false, code: 'CG-STORAGE-VERSION' });
    expect(w.background.requests('settings.patch')).toEqual([]);
  });

  it('[ST-017] settings that cannot be read are an error with a retry, never defaults', async () => {
    const w = pagesWorld({ now: () => clock });
    world = w;
    w.background.failNext('settings.get', { code: 'CG-STORAGE-READ' });
    w.client.start();
    await settle();
    const vm = options(w, 'generation');
    expect(vm.view).toMatchObject({ s: 'error', error: { code: 'CG-STORAGE-READ' } });
    expect(vm.body).toBeNull();
    await w.client.dispatch({ type: 'ReloadView', selector: { of: 'options', section: 'generation' } });
    await settle();
    expect(options(w, 'generation').view.s).toBe('ready');
  });

  it('[ST-018] a change made in another tab shows at once', async () => {
    const w = await open();
    w.background.changeSettings({ ui: { theme: 'dark' } });
    expect(options(w, 'appearance').body?.theme).toBe('dark');
    expect(w.client.theme.value).toBe('dark');
  });

  it('[ST-097] the debug switch goes through the options-only request', async () => {
    const w = await open();
    await w.client.dispatch({ type: 'SetPreference', key: 'debug.enabled', value: true });
    expect(w.background.requests('settings.patchRestricted')).toEqual([{ patch: { debug: { enabled: true } }, baseRevision: 7 }]);
    expect(w.background.requests('settings.patch')).toEqual([]);
    expect(options(w, 'diagnostics').body?.journals?.map((entry) => entry.journal)).toEqual(['operations', 'hub-calls', 'send-attempts', 'newcomers-check']);
    // [DB-022] [DB-027] (1.20.0): turned on, the page asks for this browser's AI spend and «Дополнительно» once.
    await settle();
    expect(w.background.requests('usage.local')).toEqual([{ days: 1 }, { days: 7 }]);
    expect(w.background.requests('account.advanced')).toEqual([{}]);
  });
});

describe('options: «Статус»', () => {
  it('[ST-020] a working shift is «Готово к смене» with its one warning', async () => {
    const w = await open();
    const body = options(w, 'status').body;
    expect(body?.readiness).toEqual({ s: 'ready', warnings: [{ key: 'settings.status.warning.quotaLow' }] });
    expect(body?.lastCheckedAt).toBe(PAGES_NOW);
    expect(text(w, row(w, 'extension')?.value)).toBe('Версия 0.4.3');
    expect(text(w, row(w, 'chatspace')?.value)).toBe('Сборка index-0000test, подключён');
    expect(text(w, row(w, 'hub')?.value)).toBe('gosling-agency.ru, на связи');
    expect(text(w, row(w, 'binding')?.value)).toBe('OnlyMonster 1001 → LoraVie VIP');
    expect(text(w, row(w, 'binding')?.note)).toBe('OnlyFans, @loravie_vip. Другие аккаунты: 3 привязаны.');
    expect(text(w, row(w, 'persona')?.value)).toBe('Лора · VIP');
    expect(text(w, row(w, 'quota')?.value)).toBe('Осталось 12 генераций');
    expect(row(w, 'quota')?.level).toBe('warn');
    expect(text(w, row(w, 'running')?.value)).toBe('3 генерации');
    expect(text(w, row(w, 'last-error')?.value)).toBe('ChatGoose · CG-PROVIDER-RATE-LIMIT в 08:41');
  });

  it('[ST-023] [AU-034] no chat open and two accounts loaded: binding and persona are those of the account the route is on', async () => {
    // ChatSpace on /accounts/1002/chats with no chat open; it has loaded both of the person's accounts, the newest seen first.
    const state = twoLoadedState({ routeOn: '1002' });
    const w = await open({ state });
    expect(text(w, row(w, 'binding')?.value)).toBe('OnlyMonster 1002 → LoraVie Free');
    expect(text(w, row(w, 'persona')?.value)).toBe('Лора · Free');
    // «Аккаунты» agrees: the route's account first, the other loaded one still at work.
    expect(options(w, 'accounts').body?.rows.slice(0, 2).map((entry) => [entry.title, entry.status])).toEqual([
      ['LoraVie Free', 'working'],
      ['LoraVie VIP', 'working'],
    ]);
    world?.client.dispose();
    // The route on the first one names the first one.
    const w2 = await open({ state: twoLoadedState({ routeOn: '1001' }) });
    expect(text(w2, row(w2, 'binding')?.value)).toBe('OnlyMonster 1001 → LoraVie VIP');
    expect(options(w2, 'accounts').body?.rows.slice(0, 2).map((entry) => entry.title)).toEqual(['LoraVie VIP', 'LoraVie Free']);
  });

  it('[AU-034] an open chat outranks the route; a background that counts no route falls back to the first loaded account', async () => {
    const chatOnFirst = twoLoadedState({ routeOn: '1002' });
    chatOnFirst.diagnostics = { ...chatOnFirst.diagnostics, tabs: chatOnFirst.diagnostics.tabs.map((tab) => ({ ...tab, chatKey: 'chatspace:1001:2002' })) };
    const w = await open({ state: chatOnFirst });
    expect(text(w, row(w, 'binding')?.value)).toBe('OnlyMonster 1001 → LoraVie VIP');
    world?.client.dispose();
    const older = twoLoadedState({ routeOn: '1002' });
    older.accounts = older.accounts.map(({ routeTabs: _ignored, ...entry }) => entry);
    const w2 = await open({ state: older });
    expect(text(w2, row(w2, 'binding')?.value)).toBe('OnlyMonster 1001 → LoraVie VIP');
  });

  it('[ST-021] [ST-023] [ST-024] what is missing is counted: ChatSpace closed, no bound account, no persona', async () => {
    const state = workingState();
    state.diagnostics = { ...state.diagnostics, tabs: [] };
    state.accounts = [];
    const w = await open({ state });
    const body = options(w, 'status').body;
    expect(body?.readiness).toMatchObject({ s: 'actions-needed', count: 2 });
    expect(row(w, 'chatspace')).toMatchObject({ level: 'warn' });
    expect(row(w, 'binding')).toMatchObject({ level: 'warn', action: { action: { type: 'OpenSettings', route: { section: 'accounts' } } } });
    expect(row(w, 'persona')?.level).toBe('unknown');
  });

  it('[ST-022] no host access to the hub is an action with «Дать доступ» on the row', async () => {
    const w = pagesWorld({ now: () => clock });
    world = w;
    w.browser.granted.delete(DEFAULT_SETTINGS.hub.baseUrl);
    w.client.start();
    await settle();
    expect(row(w, 'hub')).toMatchObject({ level: 'error', action: { action: { type: 'RequestPermission', kind: 'hub-host' } } });
    expect(options(w, 'status').body?.readiness).toMatchObject({ s: 'actions-needed' });
    await w.client.dispatch({ type: 'RequestPermission', kind: 'hub-host' });
    expect(w.browser.record.permissionRequests).toEqual([DEFAULT_SETTINGS.hub.baseUrl]);
    expect(row(w, 'hub')?.level).toBe('ok');
  });

  it('[ST-025] [ST-032] a partly checked ChatSpace is a warning, not a blocker; the contract row exists only in debug', async () => {
    const state = workingState();
    const tab = state.diagnostics.tabs[0];
    state.diagnostics = { ...state.diagnostics, tabs: tab === undefined ? [] : [{ ...tab, host: hostReport(PAGES_NOW, ['composerBridge']) }] };
    const w = await open({ state });
    expect(row(w, 'chatspace')).toMatchObject({ level: 'warn' });
    expect(text(w, row(w, 'chatspace')?.note)).toContain('composerBridge');
    expect(options(w, 'status').body?.readiness).toMatchObject({ s: 'ready', warnings: expect.arrayContaining([{ key: 'settings.status.warning.hostPartial' }]) as unknown });
    expect(row(w, 'contract')).toBeUndefined();
    await w.client.dispatch({ type: 'SetPreference', key: 'debug.enabled', value: true });
    expect(text(w, row(w, 'contract')?.note)).toBe('Не найдено: composerBridge.');
  });

  it('[R20 F7] a row per site in use, each read by its own expected anchors; none in use — every site of the build', async () => {
    // A second site of a test build: its own anchors and words (any text of the catalog will do for a test).
    const second: PageSite = {
      kind: 'fansly-web',
      contract: { anchors: ['conversationRoute', 'textarea', 'socket'], switchedAnchors: [], switchedCapabilities: [] },
      texts: { ...CHATSPACE_STATUS_TEXTS, title: 'settings.status.row.extension' },
    };
    const sites = [...PAGES_SITES, second];
    const base = hostReport(PAGES_NOW);
    const siteReport = {
      host: 'fansly-web',
      build: 'main.2e6b96097a4bb73b',
      adapterVersion: '0.1.0',
      checkedAt: PAGES_NOW - 60_000,
      capabilities: base.capabilities,
      // The block leaves `socket` out: it is missing, not «nothing to check» (FS-CTR-1).
      extensions: { 'fansly-web': { anchors: { conversationRoute: 'ok', textarea: 'ok' }, capabilities: {} } },
    } as const;
    const state = workingState();
    state.diagnostics = { ...state.diagnostics, tabs: [...state.diagnostics.tabs, { tabSessionId: '00000000-0000-4000-8000-000000000905', site: 'fansly-web', host: siteReport, chatKey: null }] };
    let w = await open({ state, sites });
    const hostRows = options(w, 'status').body?.rows.filter((entry) => entry.id === 'host') ?? [];
    expect(hostRows.map((entry) => [entry.host, entry.level])).toEqual([
      ['chatspace', 'ok'],
      ['fansly-web', 'warn'],
    ]);
    expect(text(w, row(w, 'fansly-web')?.value)).toBe('Сборка main.2e6b96097a4bb73b, проверен частично');
    expect(text(w, row(w, 'fansly-web')?.note)).toBe('Не найдено: socket. Вставка работает.');
    expect(text(w, row(w, 'chatspace')?.value)).toBe('Сборка index-0000test, подключён');
    // A partly checked site still works through «Копировать»: a warning, not a blocker.
    expect(options(w, 'status').body?.readiness).toMatchObject({ s: 'ready', warnings: expect.arrayContaining([{ key: 'settings.status.warning.hostPartial' }]) as unknown });
    world?.client.dispose();
    // The second site with no tab and no bound account: no row of it.
    w = await open({ state: workingState(), sites });
    expect((options(w, 'status').body?.rows ?? []).filter((entry) => entry.id === 'host').map((entry) => entry.host)).toEqual(['chatspace']);
    world?.client.dispose();
    // Nothing in use at all: every site of the build has its row («не открыт»).
    const idle = workingState();
    idle.diagnostics = { ...idle.diagnostics, tabs: [] };
    idle.accounts = [];
    w = await open({ state: idle, sites });
    expect((options(w, 'status').body?.rows ?? []).filter((entry) => entry.id === 'host').map((entry) => [entry.host, entry.level])).toEqual([
      ['chatspace', 'warn'],
      ['fansly-web', 'warn'],
    ]);
  });

  it('[ST-025] [PU-006] «Вставка работает через „Копировать“» is said only where the dock really is copy-only: a lost anchor of something else leaves «Вставка работает», in «Статус» and in the popup', async () => {
    const withHost = (host: ReturnType<typeof hostReport>): ReturnType<typeof workingState> => {
      const state = workingState();
      const tab = state.diagnostics.tabs[0];
      state.diagnostics = { ...state.diagnostics, tabs: tab === undefined ? [] : [{ ...tab, host }] };
      return state;
    };
    const base = hostReport(PAGES_NOW);

    // ChatSpace lost its send queue: the preview send is off, the dock generates and inserts as before.
    const noQueue = withHost({
      ...base,
      anchors: { ...base.anchors, pendingMessages: 'missing' },
      capabilities: { ...base.capabilities, sendObserve: { state: 'off', reason: 'pendingMessages', code: 'CG-SEND-HOST' }, previewSend: { state: 'off', reason: 'pendingMessages', code: 'CG-SEND-HOST' } },
    });
    let w = await open({ state: noQueue });
    expect(row(w, 'chatspace')).toMatchObject({ level: 'warn' });
    expect(text(w, row(w, 'chatspace')?.value)).toBe('Сборка index-0000test, проверен частично');
    expect(text(w, row(w, 'chatspace')?.note)).toBe('Не найдено: pendingMessages. Вставка работает.');
    world?.client.dispose();
    w = await open({ page: 'popup', state: noQueue });
    let popup = w.client.getSnapshot({ of: 'popup' });
    expect(popup.pills.host).toBe('partial');
    expect(popup.problems).toEqual([expect.objectContaining({ code: 'CG-HOST-CONTRACT', body: 'Не найдено: pendingMessages. Вставка работает.' })]);
    world?.client.dispose();

    // The field's bridge is gone: the insert capability is closed, parts are only copied.
    const noBridge = withHost({
      ...base,
      anchors: { ...base.anchors, composerBridge: 'missing' },
      capabilities: { ...base.capabilities, insert: { state: 'off', reason: 'composerBridge', code: 'CG-HOST-COMPOSER-MISSING' }, draftRead: { state: 'off', reason: 'composerBridge', code: 'CG-HOST-COMPOSER-MISSING' } },
    });
    w = await open({ state: noBridge });
    expect(text(w, row(w, 'chatspace')?.note)).toBe('Не найдено: composerBridge. Вставка работает через «Копировать».');
    world?.client.dispose();
    w = await open({ page: 'popup', state: noBridge });
    popup = w.client.getSnapshot({ of: 'popup' });
    expect(popup.pills.host).toBe('copy-only');
    expect(popup.problems.map((problem) => [problem.code, problem.body])).toEqual([['CG-HOST-CONTRACT', 'Часть функций выключена до проверки. Вставка работает через «Копировать».']]);
    world?.client.dispose();

    // The account list changed its shape: the insert capability itself is on, but the dock does not know whose
    // chat this is and writes nothing (its «только Копировать» banner) — the same words here.
    const noIdentity = withHost({
      ...base,
      anchors: { ...base.anchors, accounts: 'shape' },
      capabilities: { ...base.capabilities, accounts: { state: 'contractBroken', reason: 'accounts', code: 'CG-HOST-CONTRACT' }, identity: { state: 'contractBroken', reason: 'accounts', code: 'CG-HOST-CONTRACT' } },
    });
    w = await open({ state: noIdentity });
    expect(text(w, row(w, 'chatspace')?.note)).toBe('Не найдено: accounts, identity. Вставка работает через «Копировать».');
    world?.client.dispose();
    w = await open({ page: 'popup', state: noIdentity });
    expect(w.client.getSnapshot({ of: 'popup' }).pills.host).toBe('copy-only');
  });

  it('[ST-025] [PU-006] the tap and the preview send switched off are not a partly checked ChatSpace: their anchors are absent by design', async () => {
    // What the host adapter reports on a shift where the owner has not switched X8 on and the tap is not in the
    // document: both anchors `missing`, their capabilities `off` — nothing of ChatSpace changed.
    const offByDesign = (): ReturnType<typeof hostReport> => {
      const report = hostReport(PAGES_NOW);
      return {
        ...report,
        anchors: { ...report.anchors, wsFrames: 'missing', receiptProfile: 'missing' },
        capabilities: {
          ...report.capabilities,
          incoming: { state: 'off', reason: 'wsTap', code: 'CG-SEND-FRESHNESS' },
          sendObserve: { state: 'off', reason: 'wsTap', code: 'CG-SEND-FRESHNESS' },
          receipt: { state: 'off', reason: 'receiptProfile', code: 'CG-SEND-RECEIPT' },
          previewSend: { state: 'off', reason: 'flag', code: 'CG-SEND-OFF' },
        },
      };
    };
    const state = workingState();
    const tab = state.diagnostics.tabs[0];
    state.diagnostics = { ...state.diagnostics, tabs: tab === undefined ? [] : [{ ...tab, host: offByDesign() }] };
    const w = await open({ state });
    expect(row(w, 'chatspace')).toMatchObject({ level: 'ok' });
    const readiness = options(w, 'status').body?.readiness;
    expect(readiness?.s).toBe('ready');
    expect(readiness?.s === 'ready' ? readiness.warnings : null).not.toContainEqual({ key: 'settings.status.warning.hostPartial' });
    await w.client.dispatch({ type: 'SetPreference', key: 'debug.enabled', value: true });
    expect(row(w, 'contract')).toMatchObject({ level: 'ok' });
    world?.client.dispose();

    const popup = await open({ page: 'popup', state });
    expect(popup.client.getSnapshot({ of: 'popup' })).toMatchObject({ view: { s: 'ready' }, pills: { host: 'connected' }, problems: [] });
    world?.client.dispose();

    // The tap is in the page and cannot read the frames: that is a ChatSpace that changed, said by the capability.
    const broken = workingState();
    const report = offByDesign();
    broken.diagnostics = { ...broken.diagnostics, tabs: tab === undefined ? [] : [{ ...tab, host: { ...report, capabilities: { ...report.capabilities, incoming: { state: 'degraded', reason: 'wsFrames', code: 'CG-SEND-FRESHNESS' } } } }] };
    const degraded = await open({ state: broken });
    expect(row(degraded, 'chatspace')).toMatchObject({ level: 'warn' });
    expect(text(degraded, row(degraded, 'chatspace')?.note)).toContain('incoming');
  });

  it('[ST-025] [PU-006] [DB-031] no chat opened since the page loaded: the translator store ChatSpace has not created yet is no gap — «подключён», with what the preview send waits for; once a composer was there, the same absent store is «проверен частично» as before', async () => {
    const withHost = (host: ReturnType<typeof hostReport>): ReturnType<typeof workingState> => {
      const state = workingState();
      const tab = state.diagnostics.tabs[0];
      state.diagnostics = { ...state.diagnostics, tabs: tab === undefined ? [] : [{ ...tab, host }] };
      return state;
    };
    const base = hostReport(PAGES_NOW);
    // What the adapter reports after a reload with the preview send switched on and no chat opened yet.
    const notYet = withHost({
      ...base,
      anchors: { ...base.anchors, composerTranslator: 'notYet' },
      capabilities: { ...base.capabilities, previewSend: { state: 'off', reason: 'composerTranslator', code: 'CG-SEND-HOST' } },
    });
    let w = await open({ state: notYet });
    expect(row(w, 'chatspace')).toMatchObject({ level: 'ok' });
    expect(text(w, row(w, 'chatspace')?.value)).toBe('Сборка index-0000test, подключён');
    expect(text(w, row(w, 'chatspace')?.note)).toBe('Отправка из превью заработает, когда вы откроете любой чат.');
    const readiness = options(w, 'status').body?.readiness;
    expect(readiness?.s).toBe('ready');
    expect(readiness?.s === 'ready' ? readiness.warnings : null).not.toContainEqual({ key: 'settings.status.warning.hostPartial' });
    await w.client.dispatch({ type: 'SetPreference', key: 'debug.enabled', value: true });
    expect(row(w, 'contract')).toMatchObject({ level: 'ok' });
    expect(text(w, row(w, 'contract')?.note)).toBe('На месте все, кроме тех, что ChatSpace создаёт с первым открытым чатом: composerTranslator.');
    world?.client.dispose();
    w = await open({ page: 'popup', state: notYet });
    expect(w.client.getSnapshot({ of: 'popup' })).toMatchObject({ view: { s: 'ready' }, pills: { host: 'connected' }, problems: [] });
    world?.client.dispose();

    // The owner's switch is off: the store is still not there, but nothing waits for it — the usual note.
    w = await open({ state: withHost({ ...base, anchors: { ...base.anchors, composerTranslator: 'notYet' }, capabilities: { ...base.capabilities, previewSend: { state: 'off', reason: 'flag', code: 'CG-SEND-OFF' } } }) });
    expect(row(w, 'chatspace')).toMatchObject({ level: 'ok' });
    expect(text(w, row(w, 'chatspace')?.note)).toContain('проверены в');
    world?.client.dispose();

    // A chat's composer was there and the store did not come: ChatSpace changed — today's words.
    const missing = withHost({
      ...base,
      anchors: { ...base.anchors, composerTranslator: 'missing' },
      capabilities: { ...base.capabilities, previewSend: { state: 'off', reason: 'composerTranslator', code: 'CG-SEND-HOST' } },
    });
    w = await open({ state: missing });
    expect(row(w, 'chatspace')).toMatchObject({ level: 'warn' });
    expect(text(w, row(w, 'chatspace')?.value)).toBe('Сборка index-0000test, проверен частично');
    expect(text(w, row(w, 'chatspace')?.note)).toBe('Не найдено: composerTranslator. Вставка работает.');
    world?.client.dispose();
    w = await open({ page: 'popup', state: missing });
    expect(w.client.getSnapshot({ of: 'popup' }).pills.host).toBe('partial');
    world?.client.dispose();
  });

  describe('[X8-06] «Отправка из превью» — on which build, and the fuse (decision X25)', () => {
    const SENTINEL = { id: 'any-build', adapterVersion: '1.0.0', modules: { '*': '*' } };
    /** The owner switched X8 on for the pages; the tab in front of the person reports `host`; the browser's fuse is `fuse`. */
    const x8 = (host: Partial<ReturnType<typeof hostReport>> = {}, fuse?: { fuse: unknown; resetAt: number | null }): ReturnType<typeof workingState> => {
      const state = workingState();
      state.bootstrap = {
        ...state.bootstrap,
        pages: state.bootstrap.pages.map((page) => ({ ...page, features: { ...page.features, previewSend: { available: true } } })),
        limits: { ...state.bootstrap.limits, previewSendReceiptProfiles: [SENTINEL] },
      };
      const tab = state.diagnostics.tabs[0];
      state.diagnostics = {
        ...state.diagnostics,
        tabs: tab === undefined ? [] : [{ ...tab, host: { ...hostReport(PAGES_NOW), ...host } }],
        ...(fuse === undefined ? {} : { sendFuse: fuse as never }),
      };
      return state;
    };
    const tripped = (over: Record<string, unknown> = {}) => ({ trippedAt: PAGES_NOW - 30 * 60_000, reason: 'text', where: 'echo', build: 'index-0000test', attemptId: '00000000-0000-4000-8000-000000000070', ...over });
    const fusedCapability = (base = hostReport(PAGES_NOW)) => ({ ...base.capabilities, previewSend: { state: 'off' as const, reason: 'fuse', code: 'CG-SEND-FUSE' as const } });

    it('let in by the hub’s «any build» sentinel: «включена» with the build not reviewed — said in the row, in the debug contract row and in the report for the team lead', async () => {
      const w = await open({ state: x8({ receiptMatch: { profile: 'any-build', kind: 'anyBuild' } }) });
      expect(row(w, 'preview-send')).toMatchObject({ level: 'ok', action: null });
      expect(text(w, row(w, 'preview-send')?.value)).toBe('включена · сборка ChatSpace не проверена');
      expect(text(w, row(w, 'preview-send')?.note)).toBe(
        'Хаб пропускает любую сборку ChatSpace (профиль «any-build»). Если после отправки что-то пойдёт не так, предохранитель выключит её сам. Открытых попыток: 0, с неизвестным исходом: 0.',
      );
      await w.client.dispatch({ type: 'SetPreference', key: 'debug.enabled', value: true });
      expect(text(w, row(w, 'contract')?.note)).toBe(`Все элементы страницы на месте: ${String(Object.keys(hostReport(PAGES_NOW).anchors).length)}. Профиль квитанции «any-build»: любая сборка, без проверки.`);
      await w.client.dispatch({ type: 'CopyReport', scope: 'status' });
      expect(w.browser.record.clipboard.at(-1)).toContain('Отправка из превью: включена · сборка ChatSpace не проверена');
    });

    it('a reviewed build (an exact profile) says which; with no tab to tell, «включена» as before', async () => {
      let w = await open({ state: x8({ receiptMatch: { profile: 'chatspace-0.202.0', kind: 'exact' } }) });
      expect(text(w, row(w, 'preview-send')?.value)).toBe('включена · проверенная сборка ChatSpace (chatspace-0.202.0)');
      expect(text(w, row(w, 'preview-send')?.note)).toBe('Открытых попыток: 0, с неизвестным исходом: 0.');
      world?.client.dispose();
      w = await open({ state: x8() });
      expect(text(w, row(w, 'preview-send')?.value)).toBe('включена');
    });

    it('tripped on the tab’s build: «выключена предохранителем» — why, when, on which build — a warning, and «Сбросить предохранитель», which clears it', async () => {
      const w = await open({ state: x8({ receiptMatch: { profile: 'any-build', kind: 'anyBuild' }, capabilities: fusedCapability() }, { fuse: tripped(), resetAt: null }) });
      const fused = row(w, 'preview-send');
      expect(fused).toMatchObject({ level: 'warn', action: { action: { type: 'ResetSendFuse' } } });
      expect(text(w, fused?.value)).toBe('выключена предохранителем');
      expect(text(w, fused?.note)).toMatch(/^Текст отправленного сообщения не совпал с тем, что мы отправляли\. Когда: .+, сборка index-0000test\. Отправка из превью включится сама с новой сборкой ChatSpace или после сброса\.$/);
      expect(text(w, fused?.action?.label)).toBe('Сбросить предохранитель');
      expect(options(w, 'status').body?.readiness).toMatchObject({ warnings: expect.arrayContaining([{ key: 'settings.status.warning.sendFused' }]) as unknown });
      expect(UiActionSchema.safeParse(fused?.action?.action).success).toBe(true);
      // The person resets it: the background clears it, «Статус» reads it again.
      w.state.diagnostics = { ...w.state.diagnostics, tabs: w.state.diagnostics.tabs.map((tab) => ({ ...tab, host: tab.host === null ? null : { ...tab.host, capabilities: { ...tab.host.capabilities, previewSend: { state: 'on' } } } })) };
      expect(await w.client.dispatch({ type: 'ResetSendFuse' })).toMatchObject({ ok: true });
      expect(w.state.diagnostics.sendFuse).toEqual({ fuse: null, resetAt: PAGES_NOW });
      expect(row(w, 'preview-send')).toMatchObject({ level: 'ok', action: null });
      expect(text(w, row(w, 'preview-send')?.value)).toBe('включена · сборка ChatSpace не проверена');
    });

    it('each reason in plain words; a fuse of every build says the reset is the only way back', async () => {
      for (const [reason, words] of [
        ['count', 'Одно нажатие дало больше одного сообщения.'],
        ['target', 'Квитанция ChatSpace назвала другой чат или аккаунт.'],
        ['uncertain', 'Несколько отправок подряд (3) закончились неизвестным исходом.'],
      ] as const) {
        const w = await open({ state: x8({ capabilities: fusedCapability() }, { fuse: tripped({ reason }), resetAt: null }) });
        expect([reason, text(w, row(w, 'preview-send')?.note).startsWith(words)]).toEqual([reason, true]);
        world?.client.dispose();
      }
      const every = await open({ state: x8({ capabilities: fusedCapability() }, { fuse: tripped({ build: null }), resetAt: null }) });
      expect(text(every, row(every, 'preview-send')?.note)).toMatch(/держит любую сборку ChatSpace: отправка из превью включится только после сброса\.$/);
    });

    it('a fuse of another build does not hold the tab in front of the person; a trip the background has not heard of yet still shows', async () => {
      let w = await open({ state: x8({ build: 'index-1111next', receiptMatch: { profile: 'any-build', kind: 'anyBuild' } }, { fuse: tripped(), resetAt: null }) });
      expect(text(w, row(w, 'preview-send')?.value)).toBe('включена · сборка ChatSpace не проверена');
      world?.client.dispose();
      w = await open({ state: x8({ capabilities: fusedCapability() }, { fuse: null, resetAt: null }) });
      expect(row(w, 'preview-send')).toMatchObject({ level: 'warn', note: null, action: { action: { type: 'ResetSendFuse' } } });
      expect(text(w, row(w, 'preview-send')?.value)).toBe('выключена предохранителем');
      world?.client.dispose();
      // The owner's switch off: «выключена», whatever the fuse.
      const off = x8({ capabilities: fusedCapability() }, { fuse: tripped(), resetAt: null });
      off.bootstrap = { ...off.bootstrap, pages: off.bootstrap.pages.map((page) => ({ ...page, features: { ...page.features, previewSend: { available: false, reason: 'flag_off' } } })) };
      w = await open({ state: off });
      expect(text(w, row(w, 'preview-send')?.value)).toBe('выключена');
    });
  });

  it('[ST-026] the hub not answering is «нет связи» with the hub error, and the page is offline over what it knew', async () => {
    const w = await open();
    w.background.failNext('bootstrap.get', { code: 'CG-HUB-UNAVAILABLE' }, 3);
    w.state.diagnostics = { ...w.state.diagnostics, hub: { ...w.state.diagnostics.hub, reachable: false } };
    clock += RECHECK_MIN_INTERVAL_MS;
    await w.client.dispatch({ type: 'RecheckStatus' });
    await settle();
    expect(row(w, 'hub')).toMatchObject({ level: 'error' });
    expect(text(w, row(w, 'hub')?.value)).toBe('gosling-agency.ru, нет связи');
    expect(options(w, 'status').view).toMatchObject({ s: 'offline', error: { code: 'CG-HUB-UNAVAILABLE' }, retry: { type: 'RecheckStatus' } });
    // What was known stays on the page.
    expect(text(w, row(w, 'persona')?.value)).toBe('Лора · VIP');
  });

  it('[ST-028] the quota row leads with the worst page; an unknown quota is «неизвестно», never 0', async () => {
    const state = workingState();
    state.quotas[12] = { pageId: 12, remainingRequestsToday: 3, remainingMicroUsdToday: null, resetsAt: '2026-10-04T00:00:00Z', observedAt: '2026-10-03T06:00:00Z' };
    const w = await open({ state });
    expect(text(w, row(w, 'quota')?.value)).toBe('Осталось 3 генерации');
    expect(text(w, row(w, 'quota')?.note)).toContain('LoraVie Free: 3, LoraVie VIP: 12');
    world?.client.dispose();
    const unknown = workingState();
    unknown.quotas = {};
    const w2 = await open({ state: unknown });
    expect(row(w2, 'quota')).toMatchObject({ level: 'unknown' });
    expect(text(w2, row(w2, 'quota')?.value)).toBe('неизвестно');
  });

  it('[ST-033] «Проверить всё» not more often than every 10 s', async () => {
    const w = await open();
    const before = w.background.requests('bootstrap.get').length;
    expect(await w.client.dispatch({ type: 'RecheckStatus' })).toMatchObject({ ok: true, outcome: 'done' });
    expect(w.background.requests('bootstrap.get').at(-1)).toEqual({ force: true });
    expect(options(w, 'status').body?.recheck.enabled).toBe(false);
    expect(await w.client.dispatch({ type: 'RecheckStatus' })).toMatchObject({ ok: true, outcome: 'noop' });
    expect(w.background.requests('bootstrap.get')).toHaveLength(before + 1);
    clock += RECHECK_MIN_INTERVAL_MS;
    await vi.advanceTimersByTimeAsync(RECHECK_MIN_INTERVAL_MS);
    expect(options(w, 'status').body?.recheck.enabled).toBe(true);
    expect(await w.client.dispatch({ type: 'RecheckStatus' })).toMatchObject({ outcome: 'done' });
  });

  it('[ST-034] [ST-038] coming back to the page re-checks, not more often than every 5 s', async () => {
    const w = await open();
    const count = (): number => w.background.requests('diagnostics.get').length;
    const before = count();
    clock += 2_000;
    w.browser.focus();
    await settle();
    expect(count()).toBe(before);
    clock += 4_000;
    w.browser.focus();
    await settle();
    expect(count()).toBe(before + 1);
    expect(options(w, 'status').body?.lastCheckedAt).toBe(clock);
  });

  it('[ST-036] the report for the team lead: versions, rows, codes and times — no secret, no fan name', async () => {
    const w = await open();
    const receipt = await w.client.dispatch({ type: 'CopyReport', scope: 'status' });
    expect(receipt.ok).toBe(true);
    const report = w.browser.record.clipboard[0] ?? '';
    expect(report).toContain('ChatGoose 0.4.3');
    expect(report).toContain('Готово к смене');
    expect(report).toContain('Хаб: gosling-agency.ru, на связи');
    expect(report).toContain('CG-PROVIDER-RATE-LIMIT ×1');
    expect(report).not.toMatch(/synthetic-pass|password|token/i);
    w.browser.clipboardFails = true;
    expect(await w.client.dispatch({ type: 'CopyReport', scope: 'status' })).toMatchObject({ ok: false, code: 'CG-CLIPBOARD' });
  });

  it('[ST-029] running generations are listed by feature and by the fan\'s name the tabs told; the id where none is known', async () => {
    const w = await open();
    expect(text(w, row(w, 'running')?.note)).toBe('Reply для фана 2003, Recap для фана 2004, Hi для фана 2005.');
    world?.client.dispose();
    const state = workingState();
    const named = await open({ state: { ...state, fanLabels: [{ chatKey: 'chatspace:1001:2003', label: 'Hubert' }, { chatKey: 'chatspace:1001:2005', label: 'Mark' }] } });
    expect(text(named, row(named, 'running')?.note)).toBe('Reply для Hubert, Recap для фана 2004, Hi для Mark.');
    expect(options(named, 'status').body?.running.map((op) => op.fanLabel)).toEqual(['Hubert', null, 'Mark']);
    const [first] = options(w, 'status').body?.running ?? [];
    await w.client.dispatch(first?.cancel as UiAction);
    expect(w.background.requests('op.cancel')).toEqual([{ opId: first?.opId }]);
  });
});

describe('options: the sign-in screen and «Аккаунт» (§8.2)', () => {
  it('[ST-011] while nobody is signed in every section is the sign-in screen', async () => {
    const w = await open({ state: signedOutState() });
    for (const section of SETTINGS_SECTIONS) {
      const vm = options(w, section);
      expect(vm.view.s, section).toBe('forbidden');
      expect(vm.signIn, section).toMatchObject({ hubOrigin: DEFAULT_SETTINGS.hub.baseUrl, busy: false, error: null });
    }
    // The screen itself reads the hub address and the sound switches (ST-134).
    expect(options(w, 'account').body?.hub.origin).toBe(DEFAULT_SETTINGS.hub.baseUrl);
    expect(options(w, 'appearance').body?.sound.messages.on).toBe(true);
    expect(options(w, 'status').body).toBeNull();
  });

  it('[ST-046] signing in asks host access inside the click, sends the password once and keeps none of it', async () => {
    const w = pagesWorld({ state: signedOutState(), now: () => clock });
    world = w;
    w.browser.granted.delete(DEFAULT_SETTINGS.hub.baseUrl);
    w.client.start();
    await settle();
    const pending = w.client.dispatch({ type: 'SignIn', login: 'chatter1', password: 'synthetic-pass' });
    // Before anything was awaited: the permission prompt is already asked for.
    expect(w.browser.record.permissionRequests).toEqual([DEFAULT_SETTINGS.hub.baseUrl]);
    expect(options(w, 'account').signIn).toMatchObject({ busy: true, login: 'chatter1' });
    expect(await pending).toMatchObject({ ok: true });
    await settle();
    expect(w.background.requests('session.signIn')).toEqual([{ login: 'chatter1', password: '[14]' }]);
    expect(options(w, 'status').view.s).toBe('ready');
    expect(JSON.stringify(options(w, 'account'))).not.toContain('synthetic-pass');
  });

  it('[ST-046] wrong credentials stay on the form as CG-LOGIN-CREDENTIALS; refused host access never sends the sign-in', async () => {
    const w = await open({ state: signedOutState() });
    expect(await w.client.dispatch({ type: 'SignIn', login: 'chatter1', password: 'wrong' })).toMatchObject({ ok: false, code: 'CG-LOGIN-CREDENTIALS' });
    expect(options(w, 'account').signIn).toMatchObject({ busy: false, login: 'chatter1', error: { code: 'CG-LOGIN-CREDENTIALS' } });

    w.browser.granted.clear();
    w.browser.grantOnRequest = false;
    await w.client.dispatch({ type: 'RequestPermission', kind: 'hub-host' });
    const calls = w.background.requests('session.signIn').length;
    expect(await w.client.dispatch({ type: 'SignIn', login: 'chatter1', password: 'synthetic-pass' })).toMatchObject({ ok: false, code: 'CG-HUB-HOST-PERMISSION' });
    expect(w.background.requests('session.signIn')).toHaveLength(calls);
  });

  it('[ST-042] the hub address changes only while signed out', async () => {
    const w = await open();
    expect(await w.client.dispatch({ type: 'SetPreference', key: 'hub.baseUrl', value: 'https://hub.example.test' })).toMatchObject({ ok: false, code: 'CG-HUB-URL' });
    expect(w.background.requests('settings.patchRestricted')).toEqual([]);
    expect(w.state.settings.hub.baseUrl).toBe(DEFAULT_SETTINGS.hub.baseUrl);
  });

  it('[ST-041] [ST-043] a custom hub address is normalized, saved, and its host access is asked inside that click', async () => {
    const w = await open({ state: signedOutState() });
    const pending = w.client.dispatch({ type: 'SetPreference', key: 'hub.baseUrl', value: 'https://Hub.Example.test' });
    expect(w.browser.record.permissionRequests).toEqual(['https://hub.example.test']);
    expect(await pending).toMatchObject({ ok: true });
    expect(w.background.requests('settings.patchRestricted')).toEqual([{ patch: { hub: { baseUrl: 'https://hub.example.test' } }, baseRevision: 7 }]);
    expect(options(w, 'account').body?.hub).toMatchObject({ origin: 'https://hub.example.test', hostPermission: 'granted' });
    // Something that is no address at all is the person's to fix, not a crash.
    const junk = await w.client.dispatch({ type: 'SetPreference', key: 'hub.baseUrl', value: 'not an address' });
    expect(junk).toMatchObject({ ok: false, code: 'CG-HUB-URL' });
    expect(options(w, 'account').signIn?.error?.code).toBe('CG-HUB-URL');
  });

  it('[ST-051] signing out clears the sign-in here; a revoke the hub did not confirm is said, not hidden', async () => {
    const w = await open();
    w.state.serverRevoked = null;
    const receipt = await w.client.dispatch({ type: 'SignOut' });
    expect(receipt).toMatchObject({ ok: false, code: 'CG-HUB-UNAVAILABLE' });
    const vm = options(w, 'status');
    expect(vm.view).toMatchObject({ s: 'forbidden', error: { code: 'CG-AUTH-REQUIRED' } });
    expect(vm.view.s === 'forbidden' ? vm.view.error.detail : undefined).toBeDefined();
    expect(vm.signIn).not.toBeNull();
  });

  it('[ST-052] [ST-053] [ST-055] [ST-056] «Аккаунт»: who is signed in, the pages, the SDK contract, hub errors of today', async () => {
    const state = workingState();
    state.diagnostics = { ...state.diagnostics, counters: { 'CG-HUB-TIMEOUT': 2, 'CG-PROVIDER-RATE-LIMIT': 1 } };
    const w = await open({ state });
    const body = options(w, 'account').body;
    expect(body?.user).toEqual({ login: 'chatter1', role: 'chatter', deviceSince: null });
    expect(body?.pages.map((page) => [page.pageName, page.persona])).toEqual([
      ['LoraVie VIP', 'Лора · VIP'],
      ['LoraVie Free', 'Лора · Free'],
      ['Lora Reels', 'Лора · Free'],
      ['Anna M', 'Лора · VIP'],
    ]);
    expect(body?.sdk).toEqual({ contractHash: 'a'.repeat(64), compatible: true });
    expect(body?.hubErrorsToday).toEqual([{ code: 'CG-HUB-TIMEOUT', count: 2 }]);
    expect(body?.connection.s).toBe('ok');
  });
});

describe('options: personas and accounts', () => {
  it('[ST-060] [ST-061] [ST-062] the catalog is read-only; an archived persona shows only while a page still uses it', async () => {
    const state = workingState();
    const w = await open({ state });
    expect(options(w, 'personas').body?.catalog.map((persona) => persona.key)).toEqual(['lora-vip', 'lora-free']);

    world?.client.dispose();
    const archived = workingState();
    archived.settings = { ...archived.settings, personas: { ...archived.settings.personas, byPageId: { ...archived.settings.personas.byPageId, '13': { key: 'lora-old', definitionId: 'persona-definition-lora-old-0001' } } } };
    const w2 = await open({ state: archived });
    const body = options(w2, 'personas').body;
    expect(body?.catalog.find((persona) => persona.key === 'lora-old')).toEqual({ key: 'lora-old', label: 'Лора · старая', archived: true });
    const page = body?.pages.find((entry) => entry.pageName === 'Lora Reels');
    expect(page).toMatchObject({ persona: 'Лора · старая', replacementNeeded: true });
    // Only active personas can be chosen.
    expect(page?.choices.map((choice) => choice.key)).toEqual(['lora-vip', 'lora-free']);
  });

  it('[ST-073] choosing a persona stores a reference to it and is confirmed with a revision', async () => {
    const w = await open();
    const page = options(w, 'personas').body?.pages.find((entry) => entry.pageName === 'Lora Reels');
    expect(page?.persona).toBe('Лора · Free');
    const choice = page?.choices.find((entry) => entry.key === 'lora-vip');
    const receipt = await w.client.dispatch(choice?.choose as UiAction);
    expect(receipt).toMatchObject({ ok: true, revision: 8 });
    expect(w.state.settings.personas.byPageId['13']).toEqual({ key: 'lora-vip', definitionId: 'persona-definition-lora-vip-0001' });
    expect(options(w, 'personas').body?.pages.find((entry) => entry.pageName === 'Lora Reels')?.persona).toBe('Лора · VIP');
  });

  it('[ST-060] [ST-067] [PU-003] pages of one title are told apart wherever they are listed or chosen: each carries its platform and the hub\'s page label (1.3.0)', async () => {
    const state = sameTitleState();
    state.accounts = state.accounts.slice(0, 2);
    const w = await open({ state });
    // «Персоны»: three pages named «Lora Vie» — the tag is what the person chooses by.
    expect(options(w, 'personas').body?.pages.map((page) => [page.pageName, page.page])).toEqual([
      ['Lora Vie', { platform: 'onlyfans', pageLabel: 'lora-vip', platformName: 'OnlyFans' }],
      ['Lora Vie', { platform: 'onlyfans', pageLabel: 'lora-free', platformName: 'OnlyFans' }],
      ['Lora Vie', { platform: 'fansly', pageLabel: 'lora-fansly', platformName: 'Fansly' }],
      // A platform this build does not know is carried as it is.
      ['Lilly', { platform: 'somewhere-new', pageLabel: 'lilly-new' }],
    ]);
    // «Аккаунты»: the page an account is bound to, and the pages nobody opened here.
    expect((options(w, 'accounts').body?.rows ?? []).map((entry) => [entry.status, entry.pageName, entry.page])).toEqual([
      ['working', 'Lora Vie', { platform: 'onlyfans', pageLabel: 'lora-vip', platformName: 'OnlyFans' }],
      ['seen', 'Lora Vie', { platform: 'onlyfans', pageLabel: 'lora-free', platformName: 'OnlyFans' }],
      ['no-sessions', 'Lora Vie', { platform: 'fansly', pageLabel: 'lora-fansly', platformName: 'Fansly' }],
      ['no-sessions', 'Lilly', { platform: 'somewhere-new', pageLabel: 'lilly-new' }],
    ]);
    // «Аккаунт»: the platform was there before; the label joins it.
    expect(options(w, 'account').body?.pages.map((page) => [page.pageName, page.platform, page.pageLabel])).toEqual([
      ['Lora Vie', 'OnlyFans', 'lora-vip'],
      ['Lora Vie', 'OnlyFans', 'lora-free'],
      ['Lora Vie', 'Fansly', 'lora-fansly'],
      ['Lilly', 'somewhere-new', 'lilly-new'],
    ]);
    world?.client.dispose();
    // The popup: whose persona this is.
    const popup = await open({ page: 'popup', state: sameTitleState() });
    expect(popup.client.getSnapshot({ of: 'popup' }).persona).toEqual({ s: 'set', label: 'Лора · VIP', pageName: 'Lora Vie', page: { platform: 'onlyfans', pageLabel: 'lora-vip', platformName: 'OnlyFans' } });
  });

  it('[ST-067] an account bound to no hub page has no tag, and a page without a persona still has its own', async () => {
    const state = sameTitleState();
    state.settings = { ...state.settings, personas: { ...state.settings.personas, byPageId: {} } };
    const w = await open({ page: 'popup', state });
    expect(w.client.getSnapshot({ of: 'popup' }).persona).toEqual({ s: 'no-persona', pageName: 'Lora Vie', page: { platform: 'onlyfans', pageLabel: 'lora-vip', platformName: 'OnlyFans' } });
    world?.client.dispose();
    const unbound = sameTitleState();
    unbound.bootstrap = { ...unbound.bootstrap, pages: unbound.bootstrap.pages.filter((page) => page.pageId !== 11) };
    const w2 = await open({ state: unbound });
    const first = options(w2, 'accounts').body?.rows.find((entry) => entry.accountHandle === 'chatspace:1001');
    expect([first?.pageName, first?.page]).toEqual([null, null]);
  });

  it('[ST-067] [ST-068] [ST-071] accounts in three groups: at work, seen before, never opened here', async () => {
    const state = workingState();
    state.accounts = state.accounts.slice(0, 2);
    const w = await open({ state });
    const rows = options(w, 'accounts').body?.rows ?? [];
    expect(rows.map((entry) => [entry.title, entry.status])).toEqual([
      ['LoraVie VIP', 'working'],
      ['LoraVie Free', 'seen'],
      ['Lora Reels', 'no-sessions'],
      ['Anna M', 'no-sessions'],
    ]);
    expect(rows[0]).toMatchObject({ accountHandle: 'chatspace:1001', pageName: 'LoraVie VIP', persona: 'Лора · VIP', muted: false });
  });

  it('[ST-070] a local label is trimmed, kept to 60 characters by the contract, and removed when emptied', async () => {
    const w = await open();
    void w.client.dispatch({ type: 'SetAccountLabel', accountHandle: 'chatspace:1001', label: '  Основная  ' });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await settle();
    expect(w.state.settings.accounts.labels).toEqual({ 'chatspace:1001': 'Основная' });
    expect(options(w, 'accounts').body?.rows[0]?.localLabel).toBe('Основная');
    expect(UiActionSchema.safeParse({ type: 'SetAccountLabel', accountHandle: 'chatspace:1001', label: 'x'.repeat(61) }).success).toBe(false);
    void w.client.dispatch({ type: 'SetAccountLabel', accountHandle: 'chatspace:1001', label: null });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await settle();
    expect(w.state.settings.accounts.labels).toEqual({});
  });

  it('[ST-075] the sound of a model is switched per account', async () => {
    const w = await open();
    await w.client.dispatch({ type: 'SetAccountMuted', accountHandle: 'chatspace:1002', muted: true });
    expect(w.state.settings.sound.mutedAccounts).toEqual(['chatspace:1002']);
    expect(options(w, 'accounts').body?.rows.find((entry) => entry.accountHandle === 'chatspace:1002')?.muted).toBe(true);
    await w.client.dispatch({ type: 'SetAccountMuted', accountHandle: 'chatspace:1002', muted: false });
    expect(w.state.settings.sound.mutedAccounts).toEqual([]);
  });

  it('[ST-076] «к вкладке» asks the background to open the account in ChatSpace by this click; without a tab it says why', async () => {
    const w = await open();
    const goTo = options(w, 'accounts').body?.rows[1]?.goTo;
    expect(goTo?.enabled).toBe(true);
    expect(await w.client.dispatch(goTo?.action as UiAction)).toMatchObject({ ok: true, outcome: 'opened' });
    expect(w.background.requests('tab.command')).toEqual([{ command: { kind: 'account', host: 'chatspace', hostAccountId: '1002' } }]);

    world?.client.dispose();
    const closed = workingState();
    closed.diagnostics = { ...closed.diagnostics, tabs: [] };
    const w2 = await open({ state: closed });
    expect(options(w2, 'accounts').body?.rows[0]?.goTo).toMatchObject({ enabled: false, reason: { text: { key: 'settings.accounts.toTabUnavailable' } } });
  });
});

describe('options: generation, hotkeys, appearance, diagnostics', () => {
  it('[ST-093] a deep window above the hub limit is cut to it and the page says «сохранено как N»', async () => {
    const state = workingState();
    state.bootstrap = { ...state.bootstrap, limits: { ...state.bootstrap.limits, deepMax: 1500 } };
    const w = await open({ state });
    // What is stored is what is shown: 3000 from before the hub lowered its limit stays 3000 until the person changes it.
    expect(options(w, 'generation').body?.windows).toMatchObject({ deep: 3000, deepMax: 1500, savedAs: null });
    expect(w.background.requests('settings.patch')).toEqual([]);
    const release = w.background.hold('settings.patch');
    const pending = w.client.dispatch({ type: 'SetPreference', key: 'generation.windows.deep', value: 2000 });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await settle();
    // The write is on its way: «сохранено как N» is the background's word and is not said before it.
    expect(w.background.requests('settings.patch')).toHaveLength(1);
    expect(options(w, 'generation').body?.windows.savedAs).toBeNull();
    release();
    expect(await pending).toMatchObject({ ok: true, revision: 8 });
    expect(w.state.settings.generation.windows.deep).toBe(1500);
    expect(options(w, 'generation').body?.windows).toMatchObject({ deep: 1500, savedAs: 1500 });
  });

  it('[ST-093] a cut value that was not saved never says «сохранено как N»', async () => {
    const state = workingState();
    state.bootstrap = { ...state.bootstrap, limits: { ...state.bootstrap.limits, deepMax: 1500 } };
    const w = await open({ state });
    w.background.failNext('settings.patch', { code: 'CG-STORAGE-WRITE' });
    const pending = w.client.dispatch({ type: 'SetPreference', key: 'generation.windows.deep', value: 2000 });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(await pending).toMatchObject({ ok: false, code: 'CG-STORAGE-WRITE' });
    expect(options(w, 'generation').body?.windows.savedAs).toBeNull();
    expect(options(w, 'generation').save.s).toBe('failed');
    expect(w.state.settings.generation.windows.deep).toBe(3000);
  });

  it('[ST-095] [ST-096] Coach history and auto-recap are saved as chosen', async () => {
    const w = await open();
    await w.client.dispatch({ type: 'SetPreference', key: 'generation.coach.autoRecap', value: 'short' });
    void w.client.dispatch({ type: 'SetPreference', key: 'generation.coach.historyLimit', value: 20 });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await settle();
    expect(options(w, 'generation').body?.coach).toEqual({ historyLimit: 20, autoRecap: 'short' });
  });

  it('[ST-120] [ST-121] the reference comes from the vendored scheme, with the rows outside it and the platform', async () => {
    const w = await open();
    const body = options(w, 'hotkeys').body;
    expect(body?.platform).toBe('mac');
    const byId = new Map(body?.rows.map((entry) => [entry.id, entry]));
    expect(byId.get('reply')).toMatchObject({ outsideScheme: false, hotkey: { display: '⌘E', aria: 'Meta+E' } });
    expect(byId.get('recap')).toMatchObject({ outsideScheme: false, hotkey: { display: '⌘⇧S' } });
    expect(byId.get('insert-part')).toMatchObject({ outsideScheme: true, hotkey: { display: '↵' } });
    expect(byId.get('cheatsheet')).toMatchObject({ outsideScheme: true, hotkey: { display: '?' } });
    expect(byId.get('close')).toMatchObject({ outsideScheme: true, hotkey: { display: 'Esc' } });
    // «Отправить» has no key by design; a combination the browser may keep is not called working.
    expect(byId.get('send')?.hotkey).toBeNull();
    expect(byId.get('next-unread')?.hotkey).toMatchObject({ delivery: 'unverified', fallback: { display: '⌥U' } });
    expect(byId.get('settings')?.hotkey).toMatchObject({ delivery: 'reserved' });

    world?.client.dispose();
    const win = await open({ platform: 'win' });
    expect(options(win, 'hotkeys').body?.rows.find((entry) => entry.id === 'recap')?.hotkey?.display).toBe('Ctrl+Alt+S');
  });

  it('[ST-122] [ST-123] [ST-135] theme, what the system is now, and the language switch on the fly', async () => {
    const w = await open({ scheme: 'dark' });
    expect(options(w, 'appearance').body).toMatchObject({ theme: 'host', systemScheme: 'dark', locale: 'ru' });
    w.systemScheme.set('light');
    expect(options(w, 'appearance').body?.systemScheme).toBe('light');
    await w.client.dispatch({ type: 'SetPreference', key: 'ui.locale', value: 'en' });
    expect(w.i18n.language).toBe('en');
    expect(options(w, 'appearance').highlight).toBeNull();
    // Errors the controller renders follow the language too.
    w.browser.go('#status:CG-HUB-UNAVAILABLE');
    expect(options(w, 'status').highlight?.title).toBe(w.i18n.t('cg.hubUnavailable.title'));
    expect(w.i18n.t('cg.hubUnavailable.title')).not.toBe('Хаб недоступен');
  });

  it('[ST-135] [I18-001] a fresh install speaks Russian in a browser set to English (contracts 1.14.0, X29); «Как в системе» is a choice and follows the browser', async () => {
    const w = await open({ systemLanguages: ['en-US', 'en'] });
    expect(options(w, 'appearance').body?.locale).toBe('ru');
    expect(w.i18n.language).toBe('ru');
    await w.client.dispatch({ type: 'SetPreference', key: 'ui.locale', value: 'system' });
    expect(w.i18n.language).toBe('en');
    w.client.dispose();
    // «Как в системе» stored before 1.14.0 (the old default) is kept as it is: the page follows the browser.
    const state = workingState();
    state.settings = { ...state.settings, ui: { ...state.settings.ui, locale: 'system' } };
    const stored = await open({ state, systemLanguages: ['en-US', 'en'] });
    expect(options(stored, 'appearance').body?.locale).toBe('system');
    expect(stored.i18n.language).toBe('en');
  });

  it('[ST-135] [PU-001] a background that never answered: the error is said in the default’s language, not the browser’s', async () => {
    world = pagesWorld({ page: 'popup', systemLanguages: ['en-US', 'en'], now: () => clock });
    world.background.unreachable = true;
    world.client.start();
    await settle();
    // No settings were read, so nothing chose a language: the card speaks as a fresh install does.
    const vm = world.client.getSnapshot({ of: 'popup' });
    expect(vm.view.s === 'error' ? vm.view.error.title : null).toBe('Расширение не отвечает');
  });

  it('[ST-131] [ST-133] the sound test plays the chosen tone at the chosen volume; a blocked sound is said with its code', async () => {
    const w = await open();
    expect(await w.client.dispatch({ type: 'TestSound', which: 'subscribers' })).toMatchObject({ ok: true });
    expect(w.background.requests('sound.preview')).toEqual([{ tone: 'arpeggio', volume: 50 }]);
    w.state.sound = { played: false, code: 'CG-AUDIO-BLOCKED' };
    expect(await w.client.dispatch({ type: 'TestSound', which: 'messages' })).toMatchObject({ ok: false, code: 'CG-AUDIO-BLOCKED' });
    expect(options(w, 'appearance').body?.sound.status).toMatchObject({ listeningTabs: 1, error: { code: 'CG-AUDIO-BLOCKED' } });
  });

  it('[LG-025] «Выгрузить диагностику» saves the JSON and the short TXT through a Blob', async () => {
    const w = await open();
    expect(await w.client.dispatch({ type: 'ExportDiagnostics' })).toMatchObject({ ok: true });
    expect(w.background.requests('diagnostics.export')).toEqual([{ format: 'json' }, { format: 'txt' }]);
    expect(w.browser.record.downloads.map((file) => file.mime)).toEqual(['application/json', 'text/plain']);
  });

  it('[ST-110] sizes of our caches and logs; «Очистить локальные данные» only with the confirmation flag', async () => {
    const w = await open();
    expect(options(w, 'diagnostics').body).toMatchObject({ cachesKB: 412, logsKB: 1280, journals: null });
    expect(UiActionSchema.safeParse({ type: 'ClearLocalData', confirmed: false }).success).toBe(false);
    expect(await w.client.dispatch({ type: 'ClearLocalData', confirmed: true })).toMatchObject({ ok: true });
    expect(w.background.requests('data.clear')).toEqual([{ confirmed: true }]);
    expect(options(w, 'diagnostics').body).toMatchObject({ cachesKB: 0, logsKB: 0 });
  });
});

describe('options: first run (§9.9 онбординг, §9.6 согласие)', () => {
  it('[ST-012] [X55] the chatter’s three steps, then the team lead’s under «Ещё», each with what is known; hidden for good once dismissed', async () => {
    const state = workingState();
    state.settings = { ...state.settings, onboarding: { ...state.settings.onboarding, checklistDismissed: false } };
    state.diagnostics = { ...state.diagnostics, telemetry: { ...state.diagnostics.telemetry, consent: false } };
    const w = await open({ state });
    const checklist = options(w, 'status').checklist;
    // X55: no «Установить расширение» (a page of the extension is open); the team lead's steps are `more`.
    expect(checklist?.steps.map((step) => [step.id, step.done, step.more === true])).toEqual([
      ['host-permission', true, false],
      ['sign-in', true, false],
      ['open-chatspace', true, false],
      ['persona', true, true],
      ['binding', true, true],
      ['consent', false, true],
      ['sound-hotkeys', false, true],
    ]);
    const consent = checklist?.steps.find((step) => step.id === 'consent');
    expect(consent?.action?.action).toEqual({ type: 'RequestPermission', kind: 'data-collection' });
    await w.client.dispatch(consent?.action?.action as UiAction);
    expect(w.browser.record.consentRequests).toBe(1);
    expect(options(w, 'status').checklist?.steps.find((step) => step.id === 'consent')?.done).toBe(true);
    await w.client.dispatch({ type: 'TestSound', which: 'messages' });
    expect(options(w, 'status').checklist?.steps.find((step) => step.id === 'sound-hotkeys')?.done).toBe(true);

    await w.client.dispatch(checklist?.dismiss as UiAction);
    expect(w.state.settings.onboarding.checklistDismissed).toBe(true);
    expect(options(w, 'status').checklist).toBeNull();
  });

  it('§9.6 consent: without it the status row offers the browser prompt; a revoke elsewhere shows at once', async () => {
    const state = workingState();
    state.diagnostics = { ...state.diagnostics, telemetry: { ...state.diagnostics.telemetry, consent: false } };
    const w = await open({ state });
    expect(row(w, 'consent')).toMatchObject({ level: 'warn', action: { action: { type: 'RequestPermission', kind: 'data-collection' } } });
    w.browser.setConsent(true);
    expect(row(w, 'consent')).toMatchObject({ level: 'ok', action: null });
    w.browser.setConsent(false);
    expect(row(w, 'consent')?.level).toBe('warn');
    // The person may say no: the row stays as it is, nothing is asked again by itself.
    w.browser.grantOnRequest = false;
    expect(await w.client.dispatch({ type: 'RequestPermission', kind: 'data-collection' })).toMatchObject({ ok: true, outcome: 'noop' });
    expect(row(w, 'consent')?.level).toBe('warn');
  });

  it('[ST-005] the footer: the version, «Что нового» with the «нов.» mark until the notes of this version were opened', async () => {
    const state = workingState();
    state.settings = { ...state.settings, onboarding: { ...state.settings.onboarding, lastSeenVersion: '0.4.2' } };
    const w = await open({ state });
    const footer = options(w, 'status').footer;
    expect(options(w, 'status').version).toBe(PAGES_VERSION);
    expect(footer?.unseenNotes).toBe(true);
    await w.client.dispatch(footer?.whatsNew as UiAction);
    await settle();
    expect(w.state.settings.onboarding.lastSeenVersion).toBe(PAGES_VERSION);
    expect(options(w, 'status').footer?.unseenNotes).toBe(false);
  });

  it('the host-permission step asks for ChatSpace first, then the hub', async () => {
    const state = signedOutState();
    const w = pagesWorld({ state, now: () => clock });
    world = w;
    w.browser.granted.clear();
    w.client.start();
    await settle();
    w.background.state.session = workingState().session;
    w.background.setSession(workingState().session, 'sign-in');
    await settle();
    const step = options(w, 'status').checklist?.steps.find((entry) => entry.id === 'host-permission');
    expect(step?.action?.action).toEqual({ type: 'RequestPermission', kind: 'chatspace-host' });
    await w.client.dispatch(step?.action?.action as UiAction);
    expect(w.browser.record.permissionRequests).toEqual([PAGES_HOST_ORIGIN]);
    expect(options(w, 'status').checklist?.steps.find((entry) => entry.id === 'host-permission')?.action?.action).toEqual({ type: 'RequestPermission', kind: 'hub-host' });
  });
});

describe('debug pages (§9.3)', () => {
  const debugState = () => {
    const state = workingState();
    state.settings = { ...state.settings, debug: { enabled: true, renderTrace: false } };
    return state;
  };

  const spendTotals = (runs: number, cost: number) => ({ runs, inserts: 1, inputTokens: 824, outputTokens: 286, cacheReadTokens: 6000, cacheWriteTokens: 0, costMicroUsd: cost, approximate: false, cacheShare: 6000 / 6824 });

  it('[DB-022] «Расходы AI по функциям»: this browser\'s journal today and 7 days, only in debug mode, never from the hub\'s report (X47)', async () => {
    const state = debugState();
    const report = { source: 'local-browser' as const, fromDay: '2026-10-03', toDay: '2026-10-03', total: spendTotals(2, 28_600), byFeature: [{ feature: 'reply', ...spendTotals(2, 28_600) }] };
    state.localSpend = report;
    const w = await open({ state });
    const spend = options(w, 'diagnostics').body?.aiSpend;
    expect(spend?.periods.map((period) => w.i18n.text(period.label))).toEqual(['Сегодня', '7 дней']);
    expect(spend?.periods[0]?.rows).toEqual([{ feature: { key: 'dock.action.reply' }, runs: 2, inserts: 1, tokens: `${new Intl.NumberFormat('ru').format(6824)} / 286`, cache: '88 %', cost: '$0.0286' }]);
    expect(spend?.periods[0]?.total).toMatchObject({ feature: { key: 'settings.diagnostics.aiSpend.total' }, runs: 2, cost: '$0.0286' });
    expect(w.background.requests('usage.local')).toEqual([{ days: 1 }, { days: 7 }]);
    // Off: nothing is asked and nothing shows; turning it off drops what was read.
    world?.client.dispose();
    const off = await open({ state: { ...state, settings: { ...state.settings, debug: { enabled: false, renderTrace: false } } } });
    expect(options(off, 'diagnostics').body?.aiSpend ?? null).toBeNull();
    expect(off.background.requests('usage.local')).toEqual([]);
  });

  it('[DB-027] «Аккаунт → Дополнительно» in debug mode: the key\'s display prefix, its dates, each site\'s build and contract, the app line (X47)', async () => {
    const state = debugState();
    state.advanced = { signIn: { key: 'agh_dev_Zx81kQ…', issuedAt: '2026-10-01T10:00:00.000Z', expiresAt: null }, hosts: [{ host: 'chatspace', build: 'index-p8xPkCj8', contractOk: false }], app: '0.4.3 · Firefox 158 · macos' };
    const w = await open({ state });
    const advanced = options(w, 'account').body?.advanced;
    expect(advanced).toEqual({
      signIn: { key: 'agh_dev_Zx81kQ…', issuedAt: '2026-10-01T10:00:00.000Z', expiresAt: null },
      hosts: [{ label: 'ChatSpace', build: 'index-p8xPkCj8', contract: 'broken' }],
      app: '0.4.3 · Firefox 158 · macos',
    });
    expect(w.background.requests('account.advanced')).toEqual([{}]);
    world?.client.dispose();
    const off = await open({ state: { ...state, settings: { ...state.settings, debug: { enabled: false, renderTrace: false } } } });
    expect(options(off, 'account').body?.advanced ?? null).toBeNull();
    expect(off.background.requests('account.advanced')).toEqual([]);
  });

  it('[DB-007] the prompt snapshot is shown by its token: blocks, the manifest, when it goes; a cut block makes the view partial', async () => {
    const w = await open({ page: 'debug-prompt', state: debugState() });
    w.client.subscribe({ of: 'debug-prompt', token: 'prompt-token-1' }, () => undefined);
    await settle();
    const vm = w.client.getSnapshot({ of: 'debug-prompt', token: 'prompt-token-1' });
    expect(vm.view.s).toBe('partial');
    expect(vm.source).toBe('echo');
    expect(vm.blocks.map((block) => block.truncated)).toEqual([false, true]);
    expect(vm.expiresAt).toBe((vm.createdAt ?? 0) + 12 * 60_000);
    expect(vm.copyHandle).not.toBeNull();
    // «Копировать промпт» is an explicit action of this page.
    expect(w.browser.record.clipboard).toEqual([]);
    await w.client.dispatch({ type: 'Copy', artifactHandle: vm.copyHandle ?? '' });
    expect(w.browser.record.clipboard[0]).toContain('synthetic system block of the stand');
  });

  it('[DB-008] no prompt is explained: expired, echo off, from the cache, debug off', async () => {
    const w = await open({ page: 'debug-prompt', state: debugState() });
    const view = async (token: string) => {
      w.client.subscribe({ of: 'debug-prompt', token }, () => undefined);
      await settle();
      return w.client.getSnapshot({ of: 'debug-prompt', token });
    };
    const expired = await view('gone-token');
    expect(expired.view).toMatchObject({ s: 'error', retry: null });
    expect(expired.blocks).toEqual([]);
    expect((await view('prompt-no-echo')).view).toEqual({ s: 'empty', why: { key: 'debugPage.prompt.echoOff' } });
    expect((await view('prompt-cached')).view).toEqual({ s: 'empty', why: { key: 'debugPage.prompt.fromCache' } });

    world?.client.dispose();
    const off = await open({ page: 'debug-prompt' });
    off.client.subscribe({ of: 'debug-prompt', token: 'prompt-token-1' }, () => undefined);
    await settle();
    expect(off.client.getSnapshot({ of: 'debug-prompt', token: 'prompt-token-1' }).view).toMatchObject({ s: 'forbidden', remedy: { type: 'OpenSettings', route: { section: 'generation' } } });
    expect(off.background.requests('debug.prompt')).toEqual([]);
  });

  it('[NF-029] the journals: records without text, the cut mark, the check runs, copy and «Сохранить .txt»', async () => {
    const w = await open({ page: 'debug-journal', state: debugState() });
    w.client.subscribe({ of: 'journal', journal: 'operations' }, () => undefined);
    w.client.subscribe({ of: 'journal', journal: 'newcomers-check' }, () => undefined);
    await settle();
    const operations = w.client.getSnapshot({ of: 'journal', journal: 'operations' });
    expect(operations.view.s).toBe('ready');
    expect(operations.entries.map((entry) => [entry.level, entry.scope, entry.code])).toEqual([
      ['info', 'bg.ops', null],
      ['warn', 'tab.insert', 'CG-DRAFT-CHANGED'],
    ]);
    const check = w.client.getSnapshot({ of: 'journal', journal: 'newcomers-check' });
    expect(check.view.s).toBe('empty');
    expect(check.runs).toEqual([{ id: expect.any(String) as string, startedAt: PAGES_NOW - 5 * 60_000, events: 214 }]);
    expect(check.save.enabled).toBe(false);

    await w.client.dispatch(operations.save.action);
    expect(w.browser.record.downloads[0]).toMatchObject({ mime: 'text/plain', fileName: expect.stringMatching(/^chatgoose-journal-operations-\d{8}-\d{6}\.txt$/) as string });
    await w.client.dispatch({ type: 'Copy', artifactHandle: operations.copyHandle ?? '' });
    expect(w.browser.record.clipboard[0]).toContain('insert rejected');
  });

  it('[DB-001] with debug off the journal page says so and reads nothing', async () => {
    const w = await open({ page: 'debug-journal' });
    w.client.subscribe({ of: 'journal', journal: 'operations' }, () => undefined);
    await settle();
    const vm = w.client.getSnapshot({ of: 'journal', journal: 'operations' });
    expect(vm.view).toMatchObject({ s: 'forbidden', error: { code: 'CG-FEATURE-DISABLED' } });
    expect(vm.entries).toEqual([]);
    // «Обновить» with debug off asks for the settings, never for a journal.
    expect(await w.client.dispatch({ type: 'ReloadView', selector: { of: 'journal', journal: 'operations' } })).toMatchObject({ ok: true, outcome: 'noop' });
    await settle();
    expect(w.background.requests('journal.read')).toEqual([]);
    expect(await w.client.dispatch({ type: 'SaveJournal', journal: 'operations' })).toMatchObject({ ok: false, code: 'CG-FEATURE-DISABLED' });
    expect(w.browser.record.downloads).toEqual([]);
  });

  it('[DB-001] with debug off the prompt page asks the background for no prompt', async () => {
    const w = await open({ page: 'debug-prompt' });
    w.client.subscribe({ of: 'debug-prompt', token: 'prompt-token-1' }, () => undefined);
    await settle();
    await w.client.dispatch({ type: 'ReloadView', selector: { of: 'debug-prompt', token: 'prompt-token-1' } });
    await settle();
    expect(w.background.requests('debug.prompt')).toEqual([]);
    expect(w.client.getSnapshot({ of: 'debug-prompt', token: 'prompt-token-1' })).toMatchObject({ view: { s: 'forbidden', error: { code: 'CG-FEATURE-DISABLED' } }, blocks: [], copyHandle: null });
  });

  it('[DB-007] switching debug off takes the prompt off the page and out of «Копировать»; switching it on reads it again', async () => {
    const w = await open({ page: 'debug-prompt', state: debugState() });
    const selector = { of: 'debug-prompt', token: 'prompt-token-1' } as const;
    w.client.subscribe(selector, () => undefined);
    await settle();
    expect(w.client.getSnapshot(selector)).toMatchObject({ view: { s: 'partial' }, copyHandle: 'prompt' });

    w.background.changeSettings({ debug: { enabled: false } });
    const off = w.client.getSnapshot(selector);
    expect(off).toMatchObject({ view: { s: 'forbidden', error: { code: 'CG-FEATURE-DISABLED' } }, blocks: [], manifest: null, copyHandle: null, source: null });
    expect(await w.client.dispatch({ type: 'Copy', artifactHandle: 'prompt' })).toMatchObject({ ok: false, code: 'CG-CLIPBOARD' });
    expect(w.browser.record.clipboard).toEqual([]);

    // Back on: nothing kept from before is shown — the page asks the background again.
    const before = w.background.requests('debug.prompt').length;
    w.background.changeSettings({ debug: { enabled: true } });
    expect(w.client.getSnapshot(selector).view.s).toBe('loading');
    await settle();
    expect(w.background.requests('debug.prompt')).toHaveLength(before + 1);
    expect(w.client.getSnapshot(selector).view.s).toBe('partial');
  });

  it('[DB-007] signing out takes the prompt off the page and out of «Копировать»', async () => {
    const w = await open({ page: 'debug-prompt', state: debugState() });
    const selector = { of: 'debug-prompt', token: 'prompt-token-1' } as const;
    w.client.subscribe(selector, () => undefined);
    await settle();
    expect(w.client.getSnapshot(selector).blocks).toHaveLength(2);

    w.background.setSession(null, 'sign-out');
    await settle();
    expect(w.client.getSnapshot(selector)).toMatchObject({ view: { s: 'forbidden', error: { code: 'CG-AUTH-REQUIRED' } }, blocks: [], manifest: null, copyHandle: null });
    expect(await w.client.dispatch({ type: 'Copy', artifactHandle: 'prompt' })).toMatchObject({ ok: false, code: 'CG-CLIPBOARD' });
    expect(w.browser.record.clipboard).toEqual([]);
  });

  it('[DB-007] a prompt answer that comes after debug was switched off is dropped, not kept for later', async () => {
    const w = pagesWorld({ page: 'debug-prompt', state: debugState(), now: () => clock });
    world = w;
    const selector = { of: 'debug-prompt', token: 'prompt-token-1' } as const;
    const parked = w.background.park('debug.prompt');
    w.client.start();
    w.client.subscribe(selector, () => undefined);
    await settle();
    expect(parked.releases).toHaveLength(1);
    w.background.changeSettings({ debug: { enabled: false } });
    parked.stop();
    parked.releases[0]?.();
    await settle();
    expect(w.client.getSnapshot(selector)).toMatchObject({ view: { s: 'forbidden' }, blocks: [] });
    // Debug on again: the late answer is not what the page shows — it reads the prompt anew.
    w.background.state.prompts['prompt-token-1'] = { state: 'expired', fromCache: false, capturedAt: null, feature: null, manifest: null, blocks: [] };
    w.background.changeSettings({ debug: { enabled: true } });
    await settle();
    expect(w.client.getSnapshot(selector)).toMatchObject({ view: { s: 'error', retry: null }, blocks: [], copyHandle: null });
  });

  it('[NF-029] [DB-001] the journals go off the page with debug and with the sign-in: no records, no copy, no file', async () => {
    const w = await open({ page: 'debug-journal', state: debugState() });
    const selector = { of: 'journal', journal: 'operations' } as const;
    w.client.subscribe(selector, () => undefined);
    await settle();
    expect(w.client.getSnapshot(selector).entries).toHaveLength(2);
    const handle = w.client.getSnapshot(selector).copyHandle ?? '';

    w.background.setSession(null, 'sign-out');
    await settle();
    expect(w.client.getSnapshot(selector)).toMatchObject({ view: { s: 'forbidden', error: { code: 'CG-AUTH-REQUIRED' } }, entries: [], runs: null, copyHandle: null, save: { enabled: false } });
    expect(await w.client.dispatch({ type: 'Copy', artifactHandle: handle })).toMatchObject({ ok: false, code: 'CG-CLIPBOARD' });
    expect(await w.client.dispatch({ type: 'SaveJournal', journal: 'operations' })).toMatchObject({ ok: false, code: 'CG-FEATURE-DISABLED' });

    // Signed in again with debug on: read anew; then debug off: gone again.
    w.background.setSession(workingState().session, 'sign-in');
    await settle();
    expect(w.client.getSnapshot(selector).entries).toHaveLength(2);
    w.background.changeSettings({ debug: { enabled: false } });
    expect(w.client.getSnapshot(selector)).toMatchObject({ view: { s: 'forbidden', error: { code: 'CG-FEATURE-DISABLED' } }, entries: [], copyHandle: null });
    expect(await w.client.dispatch({ type: 'Copy', artifactHandle: handle })).toMatchObject({ ok: false, code: 'CG-CLIPBOARD' });
    expect(w.browser.record.clipboard).toEqual([]);
    expect(w.browser.record.downloads).toEqual([]);
  });

  it('a debug page whose settings could not be read says so with «Повторить», not an endless loading', async () => {
    const w = pagesWorld({ page: 'debug-journal', state: debugState(), now: () => clock });
    world = w;
    w.background.failNext('settings.get', { code: 'CG-STORAGE-READ' });
    w.client.start();
    const selector = { of: 'journal', journal: 'operations' } as const;
    w.client.subscribe(selector, () => undefined);
    await settle();
    expect(w.client.getSnapshot(selector).view).toMatchObject({ s: 'error', error: { code: 'CG-STORAGE-READ' }, retry: { type: 'ReloadView', selector } });
    expect(w.background.requests('journal.read')).toEqual([]);
    await w.client.dispatch({ type: 'ReloadView', selector });
    await settle();
    expect(w.client.getSnapshot(selector).view.s).toBe('ready');
  });
});

describe('options: what the mockup does not draw (parity rows)', () => {
  it('[ST-027] [ST-037] the account row: the login, the role and the number of pages; rows lead to their sections', async () => {
    const w = await open();
    expect(row(w, 'account')).toMatchObject({ level: 'ok', value: 'chatter1' });
    expect(text(w, row(w, 'account')?.note)).toBe('чаттер, страниц: 4');
    // «Куда смотреть»: the row itself carries the way to its section.
    expect(row(w, 'account')?.action?.action).toEqual({ type: 'OpenSettings', route: { section: 'account' } });
    expect(row(w, 'binding')?.action?.action).toEqual({ type: 'OpenSettings', route: { section: 'accounts' } });
    expect(row(w, 'persona')?.action?.action).toEqual({ type: 'OpenSettings', route: { section: 'personas' } });
    await w.client.dispatch(row(w, 'persona')?.action?.action as UiAction);
    expect(w.client.location.value.section).toBe('personas');
  });

  it('[ST-020] the extension row says when this version came and from which one; tabs on the old scripts are asked to reload', async () => {
    const withUpdate = (updated: { at: string; from: string; staleTabs: number | null } | undefined) => {
      const state = workingState();
      const { updated: _dropped, ...extension } = state.diagnostics.extension;
      state.diagnostics = { ...state.diagnostics, extension: updated === undefined ? extension : { ...extension, updated } };
      return state;
    };
    const at = new Date(PAGES_NOW - 18 * 60_000).toISOString();
    const w = await open({ state: withUpdate({ at, from: '0.4.2', staleTabs: 0 }) });
    expect(row(w, 'extension')?.level).toBe('ok');
    expect(text(w, row(w, 'extension')?.note)).toBe('Обновилось сегодня в 09:02 с 0.4.2. Вкладки перезагружены.');
    world?.client.dispose();
    // Not counted: nothing is claimed about the tabs.
    const w2 = await open({ state: withUpdate({ at, from: '0.4.2', staleTabs: null }) });
    expect(text(w2, row(w2, 'extension')?.note)).toBe('Обновилось сегодня в 09:02 с 0.4.2.');
    world?.client.dispose();
    const w3 = await open({ state: withUpdate({ at: '2026-10-01T10:00:00Z', from: '0.4.1', staleTabs: 0 }) });
    expect(text(w3, row(w3, 'extension')?.note)).toBe(`Обновилось ${w3.i18n.formatTime('2026-10-01T10:00:00Z', 'date')} с 0.4.1.`);
    world?.client.dispose();
    const w4 = await open({ state: withUpdate({ at, from: '0.4.2', staleTabs: 2 }) });
    expect(row(w4, 'extension')?.level).toBe('warn');
    expect(text(w4, row(w4, 'extension')?.note)).toBe('Перезагрузите вкладки ChatSpace, открытые до обновления: 2.');
    expect(options(w4, 'status').body?.readiness).toMatchObject({ s: 'ready', warnings: expect.arrayContaining([{ key: 'settings.status.warning.staleTabs' }]) as unknown });
    world?.client.dispose();
    // A fresh install, or a background that does not know: the version alone.
    const w5 = await open({ state: withUpdate(undefined) });
    expect(row(w5, 'extension')).toMatchObject({ level: 'ok', note: null });
  });

  it('[R20-F1] a site’s background services that did not start: «Статус» warns and asks for its tab to be reloaded; started, idle or unknown — nothing to say', async () => {
    const withModules = (hostModules: DiagnosticsSnapshot['hostModules']) => {
      const state = workingState();
      const { hostModules: _dropped, ...rest } = state.diagnostics;
      state.diagnostics = hostModules === undefined ? rest : { ...rest, hostModules };
      return state;
    };
    const warned = (w: Awaited<ReturnType<typeof open>>): boolean =>
      JSON.stringify(options(w, 'status').body?.readiness ?? null).includes('settings.status.warning.hostModule');
    const failed = await open({ state: withModules([{ host: 'chatspace', state: 'failed' }]) });
    expect(options(failed, 'status').body?.readiness).toMatchObject({ s: 'ready', warnings: expect.arrayContaining([{ key: 'settings.status.warning.hostModule' }]) as unknown });
    expect(failed.i18n.t('settings.status.warning.hostModule')).toBe('фоновые службы сайта не запустились — перезагрузите его вкладку');
    world?.client.dispose();
    for (const hostModules of [[{ host: 'chatspace', state: 'started' }], [{ host: 'chatspace', state: 'idle' }], undefined] as const) {
      const w = await open({ state: withModules(hostModules === undefined ? undefined : [...hostModules]) });
      expect(warned(w)).toBe(false);
      world?.client.dispose();
    }
  });

  it('[ST-030] the Spenders row says what the hub allows', async () => {
    const w = await open();
    expect(text(w, row(w, 'spenders')?.value)).toBe('включён');
    world?.client.dispose();
    // The page's own row decides — never the top-level flags, which are all false in a pilot switched on page by page.
    expect(Object.values(workingState().bootstrap.flags).some(Boolean)).toBe(false);
    const featureOff = (reason: string): ReturnType<typeof workingState> => {
      const state = workingState();
      state.bootstrap = { ...state.bootstrap, pages: state.bootstrap.pages.map((page) => ({ ...page, features: { ...page.features, spenders: { available: false, reason } } })) };
      return state;
    };
    const w2 = await open({ state: featureOff('flag_off') });
    expect(text(w2, row(w2, 'spenders')?.value)).toBe('выключен владельцем');
    expect(row(w2, 'spenders')?.note ?? null).toBeNull();
    world?.client.dispose();
    // Another reason than the flag itself is said in its own words: the owner's master switch is off for the page.
    const w3 = await open({ state: featureOff('disabled') });
    expect(text(w3, row(w3, 'spenders')?.value)).toBe('выключен владельцем');
    expect(text(w3, row(w3, 'spenders')?.note)).toBe('ChatGoose выключен владельцем');
    world?.client.dispose();
    // `"*"` on and the page's own row off: the page still wins.
    const starOn = featureOff('flag_off');
    starOn.bootstrap = { ...starOn.bootstrap, flags: { ...starOn.bootstrap.flags, spenders: true } };
    const w4 = await open({ state: starOn });
    expect(text(w4, row(w4, 'spenders')?.value)).toBe('выключен владельцем');
  });

  it('[ST-031] the sound row: how many tabs listen and the last signal; no tab; both sounds off', async () => {
    const w = await open();
    expect(text(w, row(w, 'sound')?.value)).toBe('слушает вкладок: 1');
    expect(text(w, row(w, 'sound')?.note)).toBe('Последний сигнал в 09:13.');
    world?.client.dispose();
    const silent = workingState();
    silent.diagnostics = { ...silent.diagnostics, sound: { listeningTabs: 0, lastIncomingAt: null, outcomes: {} } };
    const w2 = await open({ state: silent });
    expect(text(w2, row(w2, 'sound')?.value)).toBe(w2.i18n.t('settings.status.row.soundNoTabs'));
    expect(text(w2, row(w2, 'sound')?.note)).toBe(w2.i18n.t('settings.status.row.soundNever'));
    await w2.client.dispatch({ type: 'SetPreference', key: 'sound.messages.on', value: false });
    await w2.client.dispatch({ type: 'SetPreference', key: 'sound.subscribers.on', value: false });
    expect(text(w2, row(w2, 'sound')?.value)).toBe(w2.i18n.t('settings.status.row.soundOff'));
  });

  it('[ST-035] the support row: the version and the settings schema', async () => {
    const w = await open();
    expect(text(w, row(w, 'support')?.value)).toBe(`Версия 0.4.3, настройки v${String(DEFAULT_SETTINGS.schemaVersion)}`);
    expect(text(w, row(w, 'support')?.note)).toBe('Что-то не так — скопируйте отчёт и отправьте тимлиду.');
  });

  it('[ST-040] [ST-044] [ST-054] «Аккаунт»: the connection with its state, the time of the check and the latency; down — with the hub code', async () => {
    const w = await open();
    const body = options(w, 'account').body;
    expect(body?.hub).toEqual({ origin: DEFAULT_SETTINGS.hub.baseUrl, hostPermission: 'granted', requestPermission: null });
    expect(body?.connection).toEqual({ s: 'ok', latencyMs: 0, checkedAt: PAGES_NOW });
    expect(body?.signOut?.action).toEqual({ type: 'SignOut' });

    w.background.failNext('bootstrap.get', { code: 'CG-HUB-TIMEOUT' }, 3);
    w.state.diagnostics = { ...w.state.diagnostics, hub: { ...w.state.diagnostics.hub, reachable: false } };
    clock += RECHECK_MIN_INTERVAL_MS;
    await w.client.dispatch({ type: 'RecheckStatus' });
    await settle();
    expect(options(w, 'account').body?.connection).toMatchObject({ s: 'down', checkedAt: clock });
    expect(options(w, 'account').view).toMatchObject({ s: 'offline', error: { code: 'CG-HUB-TIMEOUT' } });
  });

  it('[ST-045] «Проверить связь» goes through the bootstrap, past its cache, and refreshes the personas with it', async () => {
    const w = await open();
    const catalog = w.background.requests('catalog.get').length;
    clock += RECHECK_MIN_INTERVAL_MS;
    expect(await w.client.dispatch({ type: 'RecheckStatus' })).toMatchObject({ ok: true, outcome: 'done' });
    await settle();
    expect(w.background.requests('bootstrap.get').at(-1)).toEqual({ force: true });
    expect(w.background.requests('catalog.get')).toHaveLength(catalog + 1);
    expect(options(w, 'account').body?.connection.checkedAt).toBe(clock);
  });

  it('[ST-047] «Это устройство»: signed in or not, and a re-sign-in in place; nothing of the device secret reaches the page', async () => {
    const w = await open();
    const body = options(w, 'account').body;
    expect(body?.user).toEqual({ login: 'chatter1', role: 'chatter', deviceSince: null });
    expect(body?.signInAgain?.action).toEqual({ type: 'OpenSettings', route: { section: 'account', code: 'CG-AUTH-REQUIRED' } });
    // The page never asks for more than the identity: the session answer has no credential in it.
    expect(JSON.stringify(w.background.calls.filter((call) => call.type === 'session.get'))).not.toMatch(/secret|credential|password/i);
    expect(Object.keys(w.state.session ?? {}).sort()).toEqual(['epoch', 'hubOrigin', 'login', 'role', 'userId']);
  });

  it('[ST-057] the last dossier save is not known to a page: null, never a made-up time', async () => {
    const w = await open();
    expect(options(w, 'account').body?.lastDossierSave).toBeNull();
  });

  it('[ST-058] opening the settings checks itself: the sign-in, the connection past the cache, then the personas', async () => {
    const w = await open();
    const order = w.background.calls.map((call) => call.type);
    const first = (type: string): number => order.indexOf(type as (typeof order)[number]);
    expect(first('session.get')).toBeGreaterThanOrEqual(0);
    expect(first('session.get')).toBeLessThan(first('bootstrap.get'));
    expect(first('bootstrap.get')).toBeLessThan(first('catalog.get'));
    expect(w.background.requests('bootstrap.get')[0]).toEqual({ force: true });
    // The popup opens on what the background already knows.
    world?.client.dispose();
    const popup = await open({ page: 'popup' });
    expect(popup.background.requests('bootstrap.get')[0]).toEqual({});
  });

  it('[ST-063] [ST-064] the catalog says when it was read; an empty one is empty, an unread one is not', async () => {
    const w = await open();
    expect(options(w, 'personas').body?.syncedAt).toBe(new Date(PAGES_NOW).toISOString());
    world?.client.dispose();
    const empty = workingState();
    empty.catalog = { personas: [] };
    const w2 = await open({ state: empty });
    expect(options(w2, 'personas').body).toMatchObject({ catalog: [], syncedAt: new Date(PAGES_NOW).toISOString() });
    expect(options(w2, 'personas').body?.pages.every((page) => page.choices.length === 0)).toBe(true);
    world?.client.dispose();
    const w3 = pagesWorld({ now: () => clock });
    world = w3;
    w3.background.failNext('catalog.get', { code: 'CG-HUB-UNAVAILABLE' }, 5);
    w3.client.start();
    await settle();
    expect(options(w3, 'personas').body).toMatchObject({ catalog: [], syncedAt: null });
  });

  it('[ST-072] [ST-078] an account shows the hub page of its binding; without a ChatSpace tab the list stays and «к вкладке» says why', async () => {
    const w = await open();
    expect(options(w, 'accounts').body?.rows.map((entry) => [entry.title, entry.pageName])).toEqual([
      ['LoraVie VIP', 'LoraVie VIP'],
      ['LoraVie Free', 'LoraVie Free'],
      ['Lora Reels', 'Lora Reels'],
      ['Anna M', 'Anna M'],
    ]);
    world?.client.dispose();
    const closed = workingState();
    closed.diagnostics = { ...closed.diagnostics, tabs: [] };
    closed.accounts = closed.accounts.map((entry) => ({ ...entry, openTabs: 0, routeTabs: 0 }));
    const w2 = await open({ state: closed });
    const rows = options(w2, 'accounts').body?.rows ?? [];
    expect(rows.map((entry) => entry.status)).toEqual(['seen', 'seen', 'seen', 'seen']);
    expect(rows.every((entry) => !entry.goTo.enabled && entry.goTo.reason?.code === 'CG-HOST-NOT-READY')).toBe(true);
  });

  it('[ST-090] [ST-091] [ST-092] the windows of Reply, Ping and Fix: 100 / 100 / 25 by default, each saved as one write', async () => {
    const w = await open();
    expect(options(w, 'generation').body?.windows).toMatchObject({ quick: 100, ping: 100, improve: 25 });
    void w.client.dispatch({ type: 'SetPreference', key: 'generation.windows.quick', value: 60 });
    void w.client.dispatch({ type: 'SetPreference', key: 'generation.windows.ping', value: 5 });
    void w.client.dispatch({ type: 'SetPreference', key: 'generation.windows.improve', value: 200 });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await settle();
    expect(w.background.requests('settings.patch')).toEqual([{ patch: { generation: { windows: { quick: 60, ping: 5, improve: 200 } } }, baseRevision: 7 }]);
    expect(w.state.settings.generation.windows).toMatchObject({ quick: 60, ping: 5, improve: 200 });
    // Outside 5–200 is not an action at all: the page clips before it sends (ST-094).
    for (const value of [4, 201, 12.5]) expect(UiActionSchema.safeParse({ type: 'SetPreference', key: 'generation.windows.quick', value }).success).toBe(false);
  });

  it('[ST-125] hints on hover are on by default; the switch is written at once and this page follows it', async () => {
    const w = await open();
    expect(DEFAULT_SETTINGS.ui.hints).toBe(true);
    expect(w.client.hints.value).toBe(true);
    await w.client.dispatch({ type: 'SetPreference', key: 'ui.hints', value: false });
    expect(w.background.requests('settings.patch')).toEqual([{ patch: { ui: { hints: false } }, baseRevision: 7 }]);
    expect(options(w, 'appearance').body?.hints).toBe(false);
    expect(w.client.hints.value).toBe(false);
  });

  it('[ST-128] [ST-129] the subscriber sound: on by default with its own tone; both are saved', async () => {
    const w = await open();
    expect(options(w, 'appearance').body?.sound.subscribers).toEqual(DEFAULT_SETTINGS.sound.subscribers);
    expect(DEFAULT_SETTINGS.sound.subscribers.on).toBe(true);
    await w.client.dispatch({ type: 'SetPreference', key: 'sound.subscribers.tone', value: 'arpeggio' });
    await w.client.dispatch({ type: 'SetPreference', key: 'sound.subscribers.on', value: false });
    expect(w.state.settings.sound.subscribers).toEqual({ on: false, tone: 'arpeggio' });
    expect(w.state.settings.sound.messages).toEqual(DEFAULT_SETTINGS.sound.messages);
  });

  it('[ST-136] the service records — the checklist, the seen version, the labels — are written only through the settings of the background', async () => {
    const state = workingState();
    state.settings = { ...state.settings, onboarding: { ...state.settings.onboarding, checklistDismissed: false, lastSeenVersion: '0.4.2' } };
    const w = await open({ state });
    await w.client.dispatch(options(w, 'status').checklist?.dismiss as UiAction);
    await w.client.dispatch(options(w, 'status').footer?.whatsNew as UiAction);
    await settle();
    expect(w.state.settings.onboarding).toMatchObject({ checklistDismissed: true, lastSeenVersion: PAGES_VERSION });
    const types = new Set(w.background.calls.map((call) => call.type));
    expect([...types].filter((type) => type.startsWith('settings.')).sort()).toEqual(['settings.get', 'settings.patch']);
  });
});

describe('the page protocol', () => {
  it('a page never sends a request the protocol does not allow from it', async () => {
    // The scripted background throws on a request its page may not send or whose payload the schema refuses:
    // every scenario above ran through that check. Here: the popup's whole start.
    const w = await open({ page: 'popup' });
    expect([...new Set(w.background.calls.map((call) => call.type))].sort()).toEqual(
      ['accounts.seen', 'binding.resolve', 'bootstrap.get', 'catalog.get', 'diagnostics.get', 'fans.labels', 'newcomers.list', 'quota.get', 'session.get', 'settings.get'].sort(),
    );
  });

  it('an action that belongs to a ChatSpace tab is refused, a malformed one is a contract breach', async () => {
    const w = await open();
    expect(await w.client.dispatch({ type: 'NewCoachDialog' })).toMatchObject({ ok: false, code: 'CG-UNKNOWN' });
    await expect(w.client.dispatch({ type: 'SetPreference', key: 'ui.theme', value: 'neon' } as unknown as UiAction)).rejects.toThrow(/UiActionSchema/);
  });
});
