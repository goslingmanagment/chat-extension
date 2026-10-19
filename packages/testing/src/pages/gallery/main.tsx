import { FANSLY_PAGE_SITES, fanslyPageState } from '../fansly';
// The pages gallery of the stand (architecture.md §10.2 «Приёмка UI»;
// ui-design §11): one extension page per document, as the browser would
// open it — popup, options, debug-prompt, debug-journal — mounted with the
// SHIPPED entry functions of ui/pages over the real controller of core and
// the scripted background. A plain document on purpose: an extension page
// has no ChatSpace variables, so the tokens' fallback values are what shows.
//
//   ?page=popup|options|debug-prompt|debug-journal
//   &state=working|troubled|unreachable|signed-out|first-run|read-only|debug|no-chatspace|stale-tabs|same-title|long-title
//   &theme=light|dark|system  &lang=ru|en  &platform=mac|win  &token=…
//   &fansly=on|off — R20 P14b1: Fansly's part of the settings (on: switched on, a model, sessions; off: not yet);
//     on the popup (X61) its quiet switch at the foot, and on: a tab that waits for a reload on the stage
//   &deep=5000 — the hub takes Recap depth up to 5000 (Fansly's row of «Генерация»)
// The hash is the page's own: `#appearance`, `#status:CG-QUOTA-DAILY`,
// `#hub-calls` (the journal). `window.__pages` gives the e2e what it checks.

import { type ColorScheme, type ExtensionPage, type Locale } from '@cg/contracts';
import { type KitFailure } from '@cg/ui/kit';
import { journalOfHash, mountDebugJournal, mountDebugPrompt, mountOptions, mountPopup } from '@cg/ui/pages';

import { type BackgroundState } from '../background';
import { fanslyOffFixture, fanslyOnFixture, withFanslyModel } from '../fansly-settings';
import { PAGES_NOW, longTitleState, pagesWorld, sameTitleState, signedOutState, troubledState, workingState } from '../world';

export interface PagesProbe {
  readonly failures: readonly KitFailure[];
  /** Elements that stick out of the viewport to the right (horizontal overflow). */
  overflow(): readonly string[];
  /** Requests the page sent to the scripted background, by type. */
  requests(type: string): readonly unknown[];
  /** What the scripted background holds now. */
  settings(): unknown;
  /** The page's text went to the fake clipboard. */
  clipboard(): readonly string[];
  downloads(): readonly string[];
}

declare global {
  interface Window {
    __pages?: PagesProbe;
  }
}

const PAGES: readonly ExtensionPage[] = ['popup', 'options', 'debug-prompt', 'debug-journal'];
const params = new URLSearchParams(location.search);
const page = PAGES.find((name) => name === params.get('page')) ?? 'options';
const language: Locale = params.get('lang') === 'en' ? 'en' : 'ru';
const themeParam = params.get('theme');
const theme = themeParam === 'dark' || themeParam === 'system' ? themeParam : 'light';
const stateName = params.get('state') ?? 'working';
const fanslyParam = params.get('fansly') === 'on' ? 'on' : params.get('fansly') === 'off' ? 'off' : null;

function stateOf(name: string): BackgroundState {
  const state =
    name === 'fansly' || name === 'mixed' || name === 'chatspace' ? fanslyPageState(name) : name === 'troubled'
      ? troubledState(PAGES_NOW)
      : name === 'signed-out'
        ? signedOutState(PAGES_NOW)
        : name === 'same-title'
          ? sameTitleState(PAGES_NOW)
          : name === 'long-title'
            ? longTitleState(PAGES_NOW)
            : workingState(PAGES_NOW);
  if (name === 'first-run') state.settings = { ...state.settings, onboarding: { ...state.settings.onboarding, checklistDismissed: false, lastSeenVersion: '0.4.2' } };
  if (name === 'read-only') state.readOnly = true;
  if (name === 'debug' || (name === 'fansly' && page === 'debug-prompt')) state.settings = { ...state.settings, debug: { enabled: true, renderTrace: false } };
  // 1.20.0 (X47): the fans' names the tabs told, this browser's AI spend and «Аккаунт → Дополнительно» (the last two in debug).
  if (name === 'working' || name === 'debug') state.fanLabels = [{ chatKey: 'chatspace:1001:2002', label: 'Theodore Whitfield' }, { chatKey: 'chatspace:1001:2003', label: 'Marco Rinaldi' }];
  if (name === 'debug') {
    const totals = (runs: number, cost: number, cacheShare: number | null) => ({ runs, inserts: Math.max(0, runs - 1), inputTokens: 824 * runs, outputTokens: 286 * runs, cacheReadTokens: 6000 * runs, cacheWriteTokens: 0, costMicroUsd: cost, approximate: false, cacheShare });
    const day = (scale: number) => ({
      source: 'local-browser' as const,
      fromDay: '2026-10-03',
      toDay: '2026-10-03',
      total: totals(14 * scale, 214_300 * scale, 0.87),
      byFeature: [
        { feature: 'reply', ...totals(9 * scale, 128_600 * scale, 0.88) },
        { feature: 'fix', ...totals(3 * scale, 21_900 * scale, 0.86) },
        { feature: 'recap', ...totals(2 * scale, 63_800 * scale, 0.84) },
      ],
    });
    state.localSpend = day(1);
    state.advanced = { signIn: { key: 'agh_dev_Zx81kQ…', issuedAt: '2026-10-01T10:00:00.000Z', expiresAt: '2027-01-01T10:00:00.000Z' }, hosts: [{ host: 'chatspace', build: 'index-p8xPkCj8', contractOk: true }], app: '0.4.3 · Firefox 158 · macos' };
  }
  if (name === 'no-chatspace' || name === 'stale-tabs') {
    state.diagnostics = { ...state.diagnostics, tabs: [], sound: { ...state.diagnostics.sound, listeningTabs: 0 } };
    state.accounts = state.accounts.map((entry) => ({ ...entry, openTabs: 0, routeTabs: 0 }));
  }
  // A ChatSpace tab opened before the update: still there, but its old script talks to nobody until it is reloaded.
  if (name === 'stale-tabs') {
    const updated = state.diagnostics.extension.updated;
    if (updated !== undefined) state.diagnostics = { ...state.diagnostics, extension: { ...state.diagnostics.extension, updated: { ...updated, staleTabs: 1 } } };
  }
  state.settings = { ...state.settings, ui: { ...state.settings.ui, theme, locale: language } };
  if (params.get('deep') === '5000') state.bootstrap = { ...state.bootstrap, limits: { ...state.bootstrap.limits, deepMax: 5000 } };
  return fanslyParam === null ? state : withFanslyModel(state, PAGES_NOW, fanslyParam === 'on');
}

const startedAt = performance.now();
const html = document.documentElement;
html.lang = language;
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const systemScheme: ColorScheme = darkQuery.matches ? 'dark' : 'light';

const world = pagesWorld({
  page,
  language,
  platform: params.get('platform') === 'win' ? 'win' : 'mac',
  scheme: systemScheme,
  state: stateOf(stateName),
  ...(['fansly', 'mixed', 'chatspace'].includes(stateName) ? { sites: FANSLY_PAGE_SITES } : {}),
  hash: location.hash,
  ...(fanslyParam === null ? {} : { fansly: fanslyParam === 'on' ? fanslyOnFixture(PAGES_NOW) : fanslyOffFixture() }),
  // The clock starts at the mockup's «now» and runs with the page; the timers are the browser's own.
  now: () => PAGES_NOW + Math.round(performance.now() - startedAt),
});
// The scripted hub takes as long as the mockup's does («Ответ за 180 мс»).
world.background.delays.set('bootstrap.get', 180);
if (stateName === 'unreachable') world.background.unreachable = true;

// The real window behind the page's hash routes: links, the address bar and Back work as in the extension.
window.addEventListener('hashchange', () => world.browser.go(location.hash));
const failures: KitFailure[] = [];
const report = (failure: KitFailure): void => {
  failures.push(failure);
};

const container = document.getElementById('app');
if (container === null) throw new Error('the gallery page has no #app');
world.client.start();
const deps = { ...world.deps, report };
if (page === 'popup') mountPopup(container, deps);
else if (page === 'options') mountOptions(container, { ...deps, location: world.client.location, helpUrl: 'https://ext.example.test/chat-extension/start.html', ...(world.slots === undefined ? {} : { slots: world.slots }) });
else if (page === 'debug-prompt') mountDebugPrompt(container, { ...deps, token: params.get('token') ?? 'prompt-token-1' });
else mountDebugJournal(container, { ...deps, journal: journalOfHash(location.hash) });

// The controller sets the hash through its port; the gallery mirrors it into the real address.
let mirrored = world.browser.hash;
world.client.location.subscribe(() => {
  if (world.browser.hash === mirrored) return;
  mirrored = world.browser.hash;
  const next = mirrored.startsWith('#') ? mirrored : `#${mirrored}`;
  if (location.hash !== next) history.replaceState(null, '', next);
});

window.__pages = {
  failures,
  overflow: () => {
    const limit = document.documentElement.clientWidth;
    return [...container.querySelectorAll<HTMLElement>('*')]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        // A journal table scrolls sideways inside its own frame; the frame itself must fit.
        return box.width > 0 && box.right > limit + 0.5 && element.closest('.cg-sr') === null && element.closest('.pg-scroll > *') === null;
      })
      .map((element) => `${element.tagName.toLowerCase()}.${element.className.toString().split(' ').join('.')}`)
      .slice(0, 20);
  },
  requests: (type) => world.background.calls.filter((call) => call.type === type).map((call) => call.payload),
  settings: () => world.background.settingsState(),
  clipboard: () => [...world.browser.record.clipboard],
  downloads: () => world.browser.record.downloads.map((file) => file.fileName),
};

// Ready once the first answers are drawn and two frames painted.
const ready = (): void => {
  requestAnimationFrame(() => requestAnimationFrame(() => html.setAttribute('data-pg-ready', '1')));
};
setTimeout(ready, 450);
