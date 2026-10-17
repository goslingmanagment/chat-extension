// Fansly on the settings page as it renders (R20 P14b1; FS-SET-1, FS-PERM-1): the shared sections over the real pages
// controller, Fansly's controller (core application/hosts/fansly/pages.ts) and its surface (ui/hosts/fansly/pages),
// Fansly's part of the background scripted (./fansly.ts). What is drawn, what a click sends, what is saved.

import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Unmount } from '@cg/contracts';
import { AUTOSAVE_DEBOUNCE_MS } from '@cg/core/application/pages';
import { sessionFact } from '@cg/core/application/hosts/fansly/pages';
import { mountOptions } from '@cg/ui/pages';

import { FANSLY_CREATOR, FANSLY_LEGACY, FANSLY_OTHER, fanslyOffFixture, fanslyOnFixture, withFanslyModel, type FanslyFixture } from './fansly-settings';
import { PAGES_NOW, pagesWorld, settle, signedOutState, workingState, type PagesWorld } from './world';
import type { BackgroundState } from './background';

interface Mounted {
  readonly world: PagesWorld;
  readonly root: HTMLElement;
  $<T extends HTMLElement = HTMLElement>(selector: string): T | null;
  $$<T extends HTMLElement = HTMLElement>(selector: string): T[];
  text(): string;
}

let unmount: Unmount | null = null;
let current: PagesWorld | null = null;

async function flush(step: () => unknown = () => undefined): Promise<void> {
  await act(async () => {
    step();
    await settle();
  });
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await settle();
    });
  }
}

async function mount(options: { readonly state?: BackgroundState; readonly fansly?: FanslyFixture; readonly hash: string }): Promise<Mounted> {
  const world = pagesWorld({ page: 'options', state: options.state ?? withFanslyModel(workingState(), PAGES_NOW), fansly: options.fansly ?? fanslyOnFixture(PAGES_NOW), hash: options.hash });
  current = world;
  const root = document.createElement('div');
  document.body.append(root);
  await act(async () => {
    world.client.start();
    await settle();
    unmount = mountOptions(root, { ...world.deps, location: world.client.location, helpUrl: null, ...(world.slots === undefined ? {} : { slots: world.slots }) });
    await settle();
  });
  await flush();
  return {
    world,
    root,
    $: <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector),
    $$: <T extends HTMLElement = HTMLElement>(selector: string) => [...root.querySelectorAll<T>(selector)],
    text: () => (root.textContent ?? '').replace(/\s+/g, ' ').trim(),
  };
}

const clean = (node: Element | null | undefined): string => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();

const button = (scope: Mounted | Element, label: string): HTMLElement => {
  const nodes = scope instanceof Element ? [...scope.querySelectorAll<HTMLElement>('button, a')] : scope.$$('button, a');
  const found = nodes.find((node) => clean(node).startsWith(label) || node.getAttribute('aria-label') === label);
  if (found === undefined) throw new Error(`no button «${label}»`);
  return found;
};

const type = (input: HTMLElement, value: string): void => {
  (input as HTMLInputElement).value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const fanslyCalls = (page: Mounted, kind: string): unknown[] => (page.world.fanslyBackground?.calls ?? []).filter((call) => call.type === kind).map((call) => call.payload);

beforeEach(() => {
  vi.useFakeTimers({ now: PAGES_NOW });
});
afterEach(() => {
  unmount?.();
  unmount = null;
  current?.client.dispose();
  current = null;
  document.body.replaceChildren();
  vi.useRealTimers();
});

const CREATOR_ROW = `[data-pg-account="fansly-web:${FANSLY_CREATOR}"]`;
const OTHER_ROW = `[data-pg-account="fansly-web:${FANSLY_OTHER}"]`;

describe('[host:fansly] «Аккаунты» for Fansly models (R20 P14b1)', () => {
  it('[ST-067] [AU-035] the models this browser saw: the creator its tab reported and the model of a session no tab of ours named — rows of the shared groups, under Fansly’s card', async () => {
    const page = await mount({ hash: '#accounts' });
    expect(page.$('.pg-sitecard h2')?.textContent).toBe('Fansly');
    expect(page.$(CREATOR_ROW)).not.toBeNull();
    expect(page.$(OTHER_ROW)).not.toBeNull();
    // Both at work: the creator in its registered tab, the other model in a tab only its session shows.
    const working = page.$$('.pg-card').find((card) => clean(card.querySelector('.pg-group')) === 'В работе');
    expect(working?.querySelector(CREATOR_ROW)).not.toBeNull();
    expect(working?.querySelector(OTHER_ROW)).not.toBeNull();
    // The card comes first, the groups after it.
    const order = page.$$('.pg-sitecard, .pg-card .pg-group');
    expect(order[0]?.classList.contains('pg-sitecard')).toBe(true);
  });

  it('[ST-068] the count «N из M в работе» takes the Fansly models in; no account at all — the empty note under Fansly’s card', async () => {
    const page = await mount({ hash: '#accounts' });
    // ChatSpace 1 of 4 at work, plus the creator and the session's model: 3 of 6 — and the words name both sites.
    expect(page.text()).toContain('3 из 6 в работе · В работе — аккаунт открыт во вкладке ChatSpace или Fansly сейчас.');
    expect(page.$('.pg-lead')?.textContent).toBe('Аккаунты OnlyMonster и Fansly, которые видел этот браузер.');
    // A session whose creator no tab named yet is not a problem of the section: nothing binds it yet.
    expect(page.$$('.pg-nav__a').find((link) => clean(link).startsWith('Аккаунты'))?.querySelector('.cg-dot')).toBeNull();
    unmount?.();
    current?.client.dispose();
    document.body.replaceChildren();

    const state = withFanslyModel(workingState(), PAGES_NOW, false);
    state.accounts = [];
    const fansly = fanslyOnFixture(PAGES_NOW);
    fansly.accounts = { sessions: [], openTabs: 0, unattributedTabs: 0 };
    const empty = await mount({ state, fansly, hash: '#accounts' });
    expect(empty.$('.pg-sitecard')).not.toBeNull();
    // The hub's pages this browser never opened stand as «нет сессий»; the Fansly page among them.
    expect(empty.$('[data-pg-account="page-15"]')).not.toBeNull();
  });

  it('[ST-069] the heading: an 18-digit Fansly id by its first and last four digits, the whole id copied', async () => {
    const page = await mount({ hash: '#accounts' });
    const row = page.$(CREATOR_ROW);
    expect(clean(row?.querySelector('.pg-acc__head b'))).toBe('Fansly 7000…0001');
    expect(clean(page.$(OTHER_ROW)?.querySelector('.pg-acc__head b'))).toBe('Fansly 7000…0002');
    await flush(() => button(row as Element, 'Скопировать номер').click());
    expect(page.world.browser.record.clipboard).toEqual([FANSLY_CREATOR]);
  });

  it('[ST-071] the state line: «В работе» while a tab is on the model (its registration or its session), «Видели раньше» after', async () => {
    const state = withFanslyModel(workingState(), PAGES_NOW);
    state.accounts = state.accounts.map((entry) => (entry.account.host === 'fansly-web' ? { ...entry, openTabs: 0, routeTabs: 0 } : entry));
    const fansly = fanslyOnFixture(PAGES_NOW);
    fansly.accounts = { ...fansly.accounts, sessions: fansly.accounts.sessions.map((session) => ({ ...session, tabs: session.canonicalId === null ? 1 : 0 })) };
    const page = await mount({ state, fansly, hash: '#accounts' });
    const group = (selector: string): string => clean(page.$$('.pg-card').find((card) => card.querySelector(selector) !== null)?.querySelector('.pg-group'));
    expect(group(CREATOR_ROW)).toBe('Видели раньше');
    expect(group(OTHER_ROW)).toBe('В работе');
  });

  it('[ST-073] the persona by the hub page: the creator is bound to the Fansly page by its id, its persona is the page’s', async () => {
    const page = await mount({ hash: '#accounts' });
    const facts = clean(page.$(CREATOR_ROW)?.querySelector('dl'));
    expect(facts).toContain('Страница хабаLora FanslyFansly · lora-fansly');
    expect(facts).toContain('ПерсонаЛора · VIP');
    // The model of a session no tab named is not known to the hub yet: no page, no persona — never a guess by name.
    expect(clean(page.$(OTHER_ROW)?.querySelector('dl'))).toContain('Страница хабане привязан');
  });

  it('[ST-075] the model’s sound: one switch for all its ids — the creator’s and its session’s legacy one; off again clears both', async () => {
    const page = await mount({ hash: '#accounts' });
    const sound = (): HTMLElement => page.$(CREATOR_ROW)?.querySelector<HTMLElement>('[aria-label="Звук модели"]') as HTMLElement;
    await flush(() => sound().click());
    expect(page.world.state.settings.sound.mutedAccounts).toEqual([`fansly-web:${FANSLY_CREATOR}`, `fansly-web:${FANSLY_LEGACY}`]);
    expect(sound().getAttribute('aria-checked') ?? (sound() as HTMLInputElement).checked.toString()).toMatch(/false/);
    await flush(() => sound().click());
    expect(page.world.state.settings.sound.mutedAccounts).toEqual([]);
  });

  it('[ST-075] [ST-079] a stored legacy-only mute shows on the reconciled creator row and unmuting clears it', async () => {
    const state = withFanslyModel(workingState(), PAGES_NOW);
    state.settings = { ...state.settings, sound: { ...state.settings.sound, mutedAccounts: [`fansly-web:${FANSLY_LEGACY}`] } };
    const page = await mount({ state, hash: '#accounts' });
    const sound = (): HTMLElement => page.$(CREATOR_ROW)?.querySelector<HTMLElement>('[aria-label="Звук модели"]') as HTMLElement;
    expect(sound().getAttribute('aria-checked') ?? (sound() as HTMLInputElement).checked.toString()).toBe('false');
    await flush(() => sound().click());
    expect(page.world.state.settings.sound.mutedAccounts).toEqual([]);
    expect(sound().getAttribute('aria-checked') ?? (sound() as HTMLInputElement).checked.toString()).toBe('true');
  });

  it('[ST-076] «К вкладке»: Fansly’s own way — its tab by the registration or session, no command to the tab, no `tabs` right; a model with no open tab says why', async () => {
    const page = await mount({ hash: '#accounts' });
    await flush(() => button(page.$(CREATOR_ROW) as Element, 'К вкладке').click());
    expect(fanslyCalls(page, 'fansly.accounts.focus')).toEqual([{ hostAccountId: FANSLY_CREATOR }]);
    expect(page.world.fanslyBackground?.focused).toEqual([FANSLY_CREATOR]);
    expect(page.world.background.requests('tab.command')).toEqual([]);
    unmount?.();
    current?.client.dispose();
    document.body.replaceChildren();

    const state = withFanslyModel(workingState(), PAGES_NOW);
    state.accounts = state.accounts.map((entry) => (entry.account.host === 'fansly-web' ? { ...entry, openTabs: 0, routeTabs: 0 } : entry));
    const fansly = fanslyOnFixture(PAGES_NOW);
    fansly.accounts = { ...fansly.accounts, sessions: [] };
    const closed = await mount({ state, fansly, hash: '#accounts' });
    const toTab = button(closed.$(CREATOR_ROW) as Element, 'К вкладке');
    expect(toTab.getAttribute('aria-disabled')).toBe('true');
    await flush(() => toTab.click());
    expect(fanslyCalls(closed, 'fansly.accounts.focus')).toEqual([]);
  });

  it('[ST-077] «Вкладки Fansly без атрибуции: N» in Fansly’s card, with how many are open; none — no line', async () => {
    const page = await mount({ hash: '#accounts' });
    expect(clean(page.$('[data-pg-unattributed]'))).toBe('Вкладки Fansly без атрибуции: 1 — откройте в ней чат, и строка аккаунта оживёт.');
    expect(clean(page.$('[data-pg-fansly-tabs]'))).toBe('Открыто: 3');
    unmount?.();
    current?.client.dispose();
    document.body.replaceChildren();
    const fansly = fanslyOnFixture(PAGES_NOW);
    fansly.accounts = { ...fansly.accounts, unattributedTabs: 0 };
    const none = await mount({ fansly, hash: '#accounts' });
    expect(none.$('[data-pg-unattributed]')).toBeNull();
  });

  it('[ST-079] legacy ↔ canonical: a session’s legacy id folds into the creator’s row; its label shows there, and a change writes the creator’s id and clears the legacy one', async () => {
    expect(sessionFact({ legacyId: FANSLY_LEGACY, canonicalId: FANSLY_CREATOR, tabs: 1, observedAt: 5 })).toEqual({ id: FANSLY_CREATOR, aliases: [FANSLY_LEGACY], platformAccountId: FANSLY_CREATOR, tabs: 1, observedAt: 5 });
    expect(sessionFact({ legacyId: FANSLY_OTHER, canonicalId: null, tabs: 0, observedAt: 5 })).toEqual({ id: FANSLY_OTHER, aliases: [], platformAccountId: null, tabs: 0, observedAt: 5 });
    const state = withFanslyModel(workingState(), PAGES_NOW);
    state.settings = { ...state.settings, accounts: { labels: { [`fansly-web:${FANSLY_LEGACY}`]: 'Лора утро' } } };
    const page = await mount({ state, hash: '#accounts' });
    expect(page.$$(`[data-pg-account="fansly-web:${FANSLY_LEGACY}"]`)).toHaveLength(0);
    const row = page.$(CREATOR_ROW);
    expect(row?.getAttribute('data-pg-aliases')).toBe(FANSLY_LEGACY);
    expect(clean(row?.querySelector('.pg-chip'))).toBe('Лора утро');
    await flush(() => type(row?.querySelector('[aria-label="Подпись"]') as HTMLElement, 'Лора'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      await settle();
    });
    expect(page.world.state.settings.accounts.labels).toEqual({ [`fansly-web:${FANSLY_CREATOR}`]: 'Лора' });
  });
});

describe('[host:fansly] Fansly’s part of the settings, `settings.ext` (R20 P14b1, FS-SET-1)', () => {
  it('[ST-012] the first run: Fansly’s three steps under the chatter’s own — switch it on (the prompt inside the click), open Fansly as the model, reload the tabs', async () => {
    const state = withFanslyModel(workingState(), PAGES_NOW, false);
    state.settings = { ...state.settings, onboarding: { ...state.settings.onboarding, checklistDismissed: false } };
    const page = await mount({ state, fansly: fanslyOffFixture(), hash: '#status' });
    const group = (): Element | null => page.$('.pg-check__group');
    expect(clean(group()?.querySelector('.pg-check__sub'))).toBe('На Fansly0 из 3');
    expect(page.$$('.pg-check__group [data-pg-step]').map((node) => node.getAttribute('data-pg-step'))).toEqual(['fansly-enable', 'fansly-open', 'fansly-reload']);
    // The chatter's three of the shared list stay three (X55: the team lead's four are under «Ещё»).
    expect(page.$$('.pg-check > .pg-check__list > [data-pg-step]')).toHaveLength(3);
    await flush(() => button(group() as Element, 'Включить Fansly').click());
    expect(page.world.fanslyBackground?.prompts).toBe(1);
    expect(page.$('[data-pg-step="fansly-enable"]')?.classList.contains('is-done')).toBe(true);
    // Two Fansly tabs were open: they wait for a reload — the step says so and does it.
    await flush(() => button(group() as Element, 'Перезагрузить вкладки').click());
    expect(page.world.fanslyBackground?.calls.filter((call) => call.type === 'site.access').map((call) => call.payload)).toContainEqual({ host: 'fansly-web', reload: true });
    expect(page.$('[data-pg-step="fansly-reload"]')?.classList.contains('is-done')).toBe(true);
    expect(page.$('[data-pg-step="fansly-open"]')?.classList.contains('is-done')).toBe(false);
  });

  it('[ST-012] a ChatSpace chatter: no Fansly page, Fansly never switched on, no Fansly model seen — no card, no rows, no steps', async () => {
    const state = workingState();
    state.settings = { ...state.settings, onboarding: { ...state.settings.onboarding, checklistDismissed: false } };
    const page = await mount({ state, fansly: fanslyOffFixture(), hash: '#status' });
    expect(page.$('.pg-check')).not.toBeNull();
    expect(page.$('.pg-check__group')).toBeNull();
    close();
    const accounts = await mount({ state, fansly: fanslyOffFixture(), hash: '#accounts' });
    expect(accounts.$('.pg-sitecard')).toBeNull();
  });

  it('the sign-in screen: «Включить Fansly» stands there before the first sign-in (the P9a hook `.pg-site-access button`), without Fansly’s settings', async () => {
    const page = await mount({ state: signedOutState(), fansly: fanslyOffFixture(), hash: '' });
    expect(page.$('[data-pg-gate]')).not.toBeNull();
    const enable = page.$('.pg-sitecard .pg-site-access button');
    expect(clean(enable)).toBe('Включить Fansly');
    expect(page.$('[data-pg-anchor="fansly-via-tab"]')).toBeNull();
  });

  it('«Fansly через вкладку»: off by default, a click writes Fansly’s part alone and «Сохранено ✓» comes with the revision the background answered', async () => {
    const page = await mount({ hash: '#accounts' });
    const viaTab = (): HTMLElement => page.$('[data-pg-anchor="fansly-via-tab"] [aria-label="Fansly через вкладку"]') as HTMLElement;
    expect(viaTab()).not.toBeNull();
    await flush(() => viaTab().click());
    expect(fanslyCalls(page, 'fansly.settings.write')).toEqual([{ patch: { hosts: { 'fansly-web': { viaTab: true } } } }]);
    expect(page.world.fanslyBackground?.fixture.ext.ext.hosts['fansly-web'].viaTab).toBe(true);
    expect(page.$('[data-pg-fansly-save="saved"]')?.getAttribute('data-pg-revision')).toBe('2');
    // Settings v1 are untouched: Fansly's part has its own key.
    expect(page.world.background.requests('settings.patch')).toEqual([]);
  });

  it('a write that fails says so with its code, and «Повторить» sends it again — never by itself', async () => {
    const fansly = fanslyOnFixture(PAGES_NOW);
    const page = await mount({ fansly, hash: '#accounts' });
    fansly.ext = { ...fansly.ext, readOnly: true };
    await flush(() => (page.$('[aria-label="Fansly через вкладку"]') as HTMLElement).click());
    expect(page.$('[data-pg-fansly-save="failed"]')?.getAttribute('data-cg-code')).toBe('CG-STORAGE-VERSION');
    const writes = fanslyCalls(page, 'fansly.settings.write').length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
      await settle();
    });
    expect(fanslyCalls(page, 'fansly.settings.write')).toHaveLength(writes);
    fansly.ext = { ...fansly.ext, readOnly: false };
    await flush(() => button(page.$('[data-pg-fansly-save="failed"]') as Element, 'Повторить').click());
    expect(fanslyCalls(page, 'fansly.settings.write')).toHaveLength(writes + 1);
    expect(page.$('[data-pg-fansly-save="saved"]')).not.toBeNull();
  });

  it('[ST-127] [ST-129] the tones on Fansly in «Вид и звук»: the Fansly extension’s chime and double by default, a pick writes Fansly’s part, «Проверить» plays it at the shared volume', async () => {
    const page = await mount({ hash: '#appearance' });
    expect(page.$$('[data-pg-fansly-tone] .pg-pick').map(clean)).toEqual(['Chime', 'Double']);
    await flush(() => (page.$('[data-pg-fansly-tone="subscribersTone"] .pg-pick') as HTMLElement).click());
    await flush(() => ([...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((item) => clean(item) === 'Bell') as HTMLElement).click());
    expect(fanslyCalls(page, 'fansly.settings.write')).toEqual([{ patch: { hosts: { 'fansly-web': { sound: { subscribersTone: 'bell' } } } } }]);
    await flush(() => button(page.$('[data-pg-fansly-tone="subscribersTone"]') as Element, 'Проверить').click());
    expect(page.world.background.requests('sound.preview')).toEqual([{ tone: 'bell', volume: page.world.state.settings.sound.volume }]);
    // Fansly off: no tones of its own on the page.
    close();
    const off = await mount({ fansly: fanslyOffFixture(), hash: '#appearance' });
    expect(off.$('[data-pg-fansly-tone]')).toBeNull();
  });

  it('[ST-093] the Recap depth on Fansly above 3000: only when the hub takes more; written to `settings.ext`, 3000 removes the wish', async () => {
    const page = await mount({ hash: '#generation' });
    expect(page.$('[data-pg-anchor="fansly-deep"]')).toBeNull();
    close();
    const state = withFanslyModel(workingState(), PAGES_NOW);
    state.bootstrap = { ...state.bootstrap, limits: { ...state.bootstrap.limits, deepMax: 5000 } };
    const deep = await mount({ state, hash: '#generation' });
    const field = deep.$<HTMLInputElement>('[data-pg-anchor="fansly-deep"] .pg-step input');
    expect(field?.value).toBe('3000');
    await flush(() => button(deep.$('[data-pg-anchor="fansly-deep"]') as Element, 'Больше').click());
    expect(fanslyCalls(deep, 'fansly.settings.write')).toEqual([{ patch: { windows: { deep: 3100 } } }]);
    expect(deep.world.fanslyBackground?.fixture.ext.ext.windows.deep).toBe(3100);
    await flush(() => button(deep.$('[data-pg-anchor="fansly-deep"]') as Element, 'Меньше').click());
    expect(fanslyCalls(deep, 'fansly.settings.write').at(-1)).toEqual({ patch: { windows: { deep: null } } });
  });
});

/** Takes the page down inside a test that mounts another one. */
function close(): void {
  unmount?.();
  unmount = null;
  current?.client.dispose();
  current = null;
  document.body.replaceChildren();
}
