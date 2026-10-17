// The extension's own pages, wired (architecture.md §9.4, §9.5, §9.9; docs/pages.md):
// the real popup and the real settings page of the TEST build, over the real
// background, against the fake hub on loopback and the ChatSpace-like stand.
// The pages themselves — every state, both themes, both languages — are
// R16's gallery (pages-gallery.e2e.ts, a scripted background); here is what
// only the installed extension can show:
// - the popup's states follow the background: nobody signed in, a shift
//   without ChatSpace, a working shift, a sign-in the hub revoked;
// - one settings tab: «Войти» of the popup opens it once and points it again;
// - a custom hub address asks the browser for its host inside the click;
// - «Сохранено ✓» stands only on the background's confirmation: not while
//   the answer is on its way, not when the background did not answer;
// - a deep link by code opens its section with the plate and the highlight;
// - a popup button acts inside the ChatSpace tab;
// - the diagnostics file leaves through a Blob; the consent is asked of the
//   browser inside the click.
// Test titles carry the parity rows they prove.

import { DEFAULT_SETTINGS, STORAGE_KEYS, type SettingsV1 } from '@cg/contracts';
import { browser, expect, $ } from '@wdio/globals';

import { PAGE, WORLD } from '../../src/scenarios/hub';
import { setOptionalPermissionPrompts } from '../support/background';
import { assignPersona, installTestBuild, pageRpc, readLocalStorage, readReport, waitForReport, writeLocalStorage } from '../support/extension';
import { fakeHubOrigin, testBuildPage, useFakeHub } from '../support/fake-hub';
import { useNetworkTrap } from '../support/network-trap';
import { capturePage, ensureNameShim, openOptions, openPopup, press, readOptions, saveHubAddress, submitSignIn, waitForOptions, waitForPopup } from '../support/pages';
import { chatPath, foreignCalls, openStand, STAND_IDS, standServer, waitForChatReady } from '../support/stand';

const { a: accountA } = STAND_IDS.accounts;
const { a1 } = STAND_IDS.fans;
/** The stand's name of `a1` (stand/dataset.ts: «Fan» and the first of its names). */
const A1_NAME = 'Fan Alder';
const PASSWORD = 'synthetic-password';
/** A hub address that is not the stock one and not loopback: the browser has to be asked for its host. Nothing is ever sent to it. */
const CUSTOM_HUB = 'https://hub.example.test';

/** `browser.permissions.contains` for a host, asked from the extension page the browser is on. */
async function hasHostAccess(origin: string): Promise<boolean> {
  return browser.execute(async (pattern: string) => {
    const api = (globalThis as unknown as { browser: { permissions: { contains(permissions: { origins: string[] }): Promise<boolean> } } }).browser;
    return api.permissions.contains({ origins: [pattern] });
  }, `${origin}/*`);
}

/**
 * Stands between the page and the background for `settings.patch`: the answer of a request is kept until
 * `release`, and with `drop` the request is not delivered at all (the background did not answer).
 */
async function holdSettingsWrites(mode: 'hold' | 'drop' | 'off'): Promise<void> {
  await ensureNameShim();
  await browser.execute((wanted: string) => {
    interface Held {
      readonly resolve: (value: unknown) => void;
      readonly answer: Promise<unknown>;
    }
    interface Hold {
      mode: string;
      readonly held: Held[];
      readonly original: (message: unknown) => Promise<unknown>;
    }
    const scope = globalThis as unknown as { browser: { runtime: { sendMessage(message: unknown): Promise<unknown> } }; __cgHold?: Hold };
    if (scope.__cgHold === undefined) {
      const runtime = scope.browser.runtime;
      const hold: Hold = { mode: 'off', held: [], original: runtime.sendMessage.bind(runtime) };
      scope.__cgHold = hold;
      runtime.sendMessage = (message: unknown): Promise<unknown> => {
        const type = (message as { type?: unknown } | null)?.type;
        if (type !== 'settings.patch' || hold.mode === 'off') return hold.original(message);
        // Not delivered: the page waits for an answer that never comes, as with a background that is gone.
        if (hold.mode === 'drop') return Promise.resolve(undefined);
        const answer = hold.original(message);
        return new Promise((resolve) => hold.held.push({ resolve, answer }));
      };
    }
    scope.__cgHold.mode = wanted;
  }, mode);
}

/** Lets the kept answers through, in the order they were asked; resolves with how many there were. */
async function releaseSettingsWrites(): Promise<number> {
  return browser.execute(async () => {
    const hold = (globalThis as unknown as { __cgHold?: { held: { resolve(value: unknown): void; answer: Promise<unknown> }[] } }).__cgHold;
    const held = hold?.held.splice(0) ?? [];
    for (const entry of held) entry.resolve(await entry.answer);
    return held.length;
  });
}

const heldWrites = (): Promise<number> => browser.execute(() => (globalThis as unknown as { __cgHold?: { held: unknown[] } }).__cgHold?.held.length ?? 0);
const storedSettings = async (): Promise<SettingsV1> => (await readLocalStorage([STORAGE_KEYS.settings]))[STORAGE_KEYS.settings] as SettingsV1;
const splitBox = '[role="checkbox"][aria-label="Split по умолчанию"]';

describe('the extension pages wired: the popup and the settings of the installed build', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let journalStart = 0;
  let hubStart = 0;
  let popupTab = '';
  let standTab = '';

  /** The settings tab: the one that is not the popup's and not the stand's. */
  const settingsTab = async (): Promise<string> => {
    for (const handle of await browser.getWindowHandles()) {
      if (handle === popupTab || handle === standTab) continue;
      await browser.switchToWindow(handle);
      if ((await browser.getUrl()).includes('/options.html')) return handle;
    }
    throw new Error('no settings tab is open');
  };
  const toPopup = async (): Promise<void> => browser.switchToWindow(popupTab);

  before(async () => {
    await standServer.reset();
    journalStart = await standServer.mark();
    await hub().command({ op: 'pageAccount', pageLabel: PAGE, platformAccountId: STAND_IDS.platformAccounts.a });
    hubStart = await hub().mark();
    await installTestBuild();
    // The address of the fake hub, set from the journal page, which asks the background for no status.
    await browser.url(testBuildPage('debug-journal.html'));
    const settings: SettingsV1 = { ...DEFAULT_SETTINGS, hub: { baseUrl: fakeHubOrigin() } };
    await writeLocalStorage({ [STORAGE_KEYS.settings]: settings });
    await browser.waitUntil(
      async () => {
        const state = await pageRpc<{ settings: SettingsV1 }>('settings.get');
        return state.ok && state.payload.settings.hub.baseUrl === fakeHubOrigin();
      },
      { timeout: 15_000, timeoutMsg: 'the settings owner did not pick the hub address up' },
    );
    popupTab = await browser.getWindowHandle();
  });

  after(async () => {
    await setOptionalPermissionPrompts(null);
    // §12 «Гейт безопасности»: nothing but the page's own client and the harness talked to the stand.
    expect(foreignCalls((await standServer.journal(journalStart)).entries)).toEqual([]);
  });

  it('[PU-002] [PU-003] the popup with nobody signed in: «Нужно войти» with its code and one button, no spinner, nothing asked of the hub', async () => {
    await toPopup();
    const popup = await openPopup();
    expect(popup).toMatchObject({ view: 'forbidden', codes: ['CG-AUTH-REQUIRED'], pills: [], spinners: 0, login: null, width: 360 });
    expect(popup.version).not.toBe('');
    expect(popup.text).toContain('Войти');
    await capturePage('ext-popup-signed-out');
    expect((await hub().journal(hubStart)).entries).toEqual([]);
  });

  it('[ST-006] [ST-007] [PU-018] «Войти» of the popup opens the settings at «Аккаунт» with the code — and a second press points the same tab again, never a second one', async () => {
    await toPopup();
    const before = await browser.getWindowHandles();
    await press('Войти', '.pg-popup__state');
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length === before.length + 1, { timeout: 10_000, timeoutMsg: 'the settings tab did not open' });
    const tab = await settingsTab();
    await browser.waitUntil(async () => (await browser.getUrl()).endsWith('options.html#account:CG-AUTH-REQUIRED'), { timeout: 10_000, timeoutMsg: 'the settings tab is not at «Аккаунт»' });
    const shown = await waitForOptions((state) => state.gate, 'the sign-in screen');
    expect(shown.checklist).toHaveLength(8);
    // The person wandered off to another address of the page; the popup's button brings the same tab back.
    await browser.execute(() => {
      location.hash = '#hotkeys';
    });
    await toPopup();
    // In a tab the popup's document stays open after the click (the toolbar's own frame closes itself).
    await waitForPopup((state) => state.view === 'forbidden', 'the popup is still there');
    await press('Войти', '.pg-popup__state');
    await browser.switchToWindow(tab);
    await browser.waitUntil(async () => (await browser.getUrl()).endsWith('options.html#account:CG-AUTH-REQUIRED'), { timeout: 10_000, timeoutMsg: 'the open settings tab was not pointed at «Аккаунт» again' });
    expect(await browser.getWindowHandles()).toHaveLength(before.length + 1);
    // The address of the page is its route: the sign-in form is highlighted again (ST-009).
    await waitForOptions((state) => state.targets.includes('sign-in'), 'the sign-in form is highlighted', 5000);
  });

  it('[ST-041] [ST-043] [ST-046] a custom hub address: the browser is asked for its host inside the click, the address is normalized and saved, and no request goes to it', async () => {
    await settingsTab();
    await openOptions();
    // Firefox's own question is answered «Allow» for this headless run; the gesture check stays.
    await setOptionalPermissionPrompts(false);
    expect(await hasHostAccess(CUSTOM_HUB)).toBe(false);
    await saveHubAddress('HUB.example.test/some/path');
    const saved = await waitForOptions((state) => state.hubAddress === CUSTOM_HUB && state.access === 'granted', 'the custom address is saved and its host allowed');
    expect(saved.codes).toEqual([]);
    expect(await hasHostAccess(CUSTOM_HUB)).toBe(true);
    expect((await storedSettings()).hub.baseUrl).toBe(CUSTOM_HUB);
    await capturePage('ext-options-custom-hub');
    // Not an address: said on the form with its code, and the stored one stays.
    await saveHubAddress('not an address at all');
    const refused = await waitForOptions((state) => state.codes.includes('CG-HUB-URL'), 'a text that is no address is refused');
    expect(refused.hubAddress).toBe(CUSTOM_HUB);
    expect((await storedSettings()).hub.baseUrl).toBe(CUSTOM_HUB);
    // Back to the fake hub. Nothing was sent anywhere meanwhile: nobody is signed in (the network trap watches).
    await saveHubAddress(fakeHubOrigin());
    await waitForOptions((state) => state.hubAddress === fakeHubOrigin() && state.access === 'granted', 'the fake hub address is back');
    await browser.waitUntil(async () => (await storedSettings()).hub.baseUrl === fakeHubOrigin(), { timeout: 5000, timeoutMsg: 'the address did not reach the settings' });
    expect((await hub().journal(hubStart)).entries).toEqual([]);
  });

  it('[PU-013] [PU-015] a sign-in on the settings page redraws the open popup without a reload: the account, a hub that answers, and the buttons that need ChatSpace are off with their reason', async () => {
    await settingsTab();
    await submitSignIn(WORLD.user.username, PASSWORD);
    await waitForOptions((state) => !state.gate && state.rows['account']?.level === 'ok', 'signed in');
    await assignPersona(PAGE);
    await toPopup();
    const popup = await waitForPopup((state) => state.view === 'ready' && state.login === WORLD.user.username && state.pills.some((pill) => pill.includes('на связи')), 'the popup after the sign-in');
    expect(popup.pills).toEqual(['ChatSpace: не подключён', 'Хаб: на связи']);
    expect(popup.codes).toEqual([]);
    // Spenders, «Новые» and the cheatsheet live inside ChatSpace: without a tab there is nowhere to open them — and the
    // popup says so under them, not only in their tooltips (0.2.4).
    expect(popup.buttons).toEqual({ Spenders: false, Новые: false, Клавиши: false, Настройки: true });
    expect(popup.text).toContain('Откройте вкладку ChatSpace: эти окна открываются в ней');
    expect(popup.persona).toContain('Не подключено');
    await capturePage('ext-popup-no-chatspace');
  });

  it('[ST-013] [ST-014] «Сохранено ✓» stands only on the background’s confirmation: «Сохраняю…» while the answer is on its way, then the revision the background gave', async () => {
    await settingsTab();
    await openOptions('generation');
    await waitForOptions((state) => state.section === 'generation' && !state.loading, '«Генерация»');
    await $(splitBox).waitForExist({ timeout: 10_000 });
    const before = await pageRpc<{ revision: number; settings: SettingsV1 }>('settings.get');
    if (!before.ok) throw new Error('settings.get failed');
    expect((await readOptions()).save).toBeNull();

    await holdSettingsWrites('hold');
    await $(splitBox).click();
    await browser.waitUntil(async () => (await heldWrites()) === 1, { timeout: 5000, timeoutMsg: 'the write did not go out at once (a switch is not debounced)' });
    // The background has the write — it is in storage — but its answer has not reached the page.
    await browser.waitUntil(async () => (await storedSettings()).generation.split === !before.payload.settings.generation.split, { timeout: 5000, timeoutMsg: 'the background did not write the switch' });
    const waiting = await readOptions();
    expect(waiting.save).toEqual({ state: 'saving', revision: null, code: null });
    await browser.pause(800);
    expect((await readOptions()).save?.state).toBe('saving');
    await capturePage('ext-options-saving');

    expect(await releaseSettingsWrites()).toBe(1);
    const saved = await waitForOptions((state) => state.save?.state === 'saved', '«Сохранено ✓» once the answer came');
    const after = await pageRpc<{ revision: number }>('settings.get');
    expect(after.ok && after.payload.revision).toBe(before.payload.revision + 1);
    expect(saved.save).toEqual({ state: 'saved', revision: before.payload.revision + 1, code: null });
    await holdSettingsWrites('off');
  });

  it('[ST-015] a write the background did not answer is «Не сохранено» with its code and «Повторить» — never «Сохранено ✓»; the retry saves it', async () => {
    const before = await pageRpc<{ revision: number; settings: SettingsV1 }>('settings.get');
    if (!before.ok) throw new Error('settings.get failed');
    const wanted = !before.payload.settings.generation.split;
    await holdSettingsWrites('drop');
    await $(splitBox).click();
    const failed = await waitForOptions((state) => state.save?.state === 'failed', '«Не сохранено»');
    expect(failed.save).toEqual({ state: 'failed', revision: null, code: 'CG-RUNTIME-UNREACHABLE' });
    expect(failed.text).toContain('Повторить');
    // Nothing reached the background: the stored value and its revision are the old ones.
    expect((await storedSettings()).generation.split).toBe(before.payload.settings.generation.split);
    await capturePage('ext-options-not-saved');

    await holdSettingsWrites('off');
    await press('Повторить', '.pg-save');
    const saved = await waitForOptions((state) => state.save?.state === 'saved', '«Сохранено ✓» after «Повторить»');
    expect(saved.save?.revision).toBe(before.payload.revision + 1);
    expect((await storedSettings()).generation.split).toBe(wanted);
  });

  it('[ST-008] [ST-009] [ST-010] a deep link by code opens its section with the plate and highlights what the code is about; another code moves the same page', async () => {
    await settingsTab();
    await openOptions('status:CG-QUOTA-DAILY');
    const quota = await waitForOptions((state) => state.plate === 'CG-QUOTA-DAILY' && state.targets.includes('quota'), 'the quota row is highlighted under its plate', 10_000);
    expect(quota.section).toBe('status');
    await capturePage('ext-options-deep-link');
    // The highlight is for two seconds, the plate stays until closed.
    await browser.waitUntil(async () => (await readOptions()).targets.length === 0, { timeout: 5000, timeoutMsg: 'the highlight did not fade' });
    expect((await readOptions()).plate).toBe('CG-QUOTA-DAILY');
    // A code alone (an error toast's «Настройки») finds its section in the registry, without a reload.
    await browser.execute(() => {
      location.hash = '#CG-AUDIO-BLOCKED';
    });
    const sound = await waitForOptions((state) => state.plate === 'CG-AUDIO-BLOCKED' && state.targets.includes('sound'), 'the sound rows are highlighted', 10_000);
    expect(sound.section).toBe('appearance');
    // Garbage in the address is «Статус», not an error.
    await browser.execute(() => {
      location.hash = '#no-such-section:NOT-A-CODE';
    });
    const status = await waitForOptions((state) => state.section === 'status', 'garbage opens «Статус»');
    expect(status.plate).toBeNull();
  });

  it('[PU-005] [PU-008] [PU-017] a working shift: the popup names the persona, the open dialog and both connections, and «Spenders» opens the board inside the ChatSpace tab', async () => {
    standTab = (await browser.createWindow('tab')).handle;
    await browser.switchToWindow(standTab);
    await openStand(chatPath(accountA, a1));
    await waitForChatReady(accountA, a1);
    await waitForReport((report) => report.dock?.status === 'ready', 'the dock of the open chat is ready');
    await toPopup();
    // The popup reads the status when it opens (and on «Обновить статус»), like the toolbar's own one: it is
    // opened once the background knows the tab's chat and its host contract.
    await browser.waitUntil(
      async () => {
        const diagnostics = await pageRpc<{ tabs: ReadonlyArray<{ chatKey: string | null; host: unknown }> }>('diagnostics.get');
        return diagnostics.ok && diagnostics.payload.tabs.some((tab) => tab.host !== null && tab.chatKey?.endsWith(`:${a1}`) === true);
      },
      { timeout: 15_000, timeoutMsg: 'the background did not learn the chat of the ChatSpace tab' },
    );
    const popup = await openPopup();
    // X47 (1.20.0): the fan by the name the tab knows. The popup reads the names as it opens and again whenever the
    // background hears a new one (`fans.changed`), whichever comes first — so the test waits on what the popup shows.
    const working = await waitForPopup(
      (state) => state.view === 'ready' && state.pills[0] === 'ChatSpace: подключён' && !state.persona.includes('Не подключено') && state.dialog.includes(A1_NAME),
      'the popup of a working shift, the open chat’s fan named',
    );
    expect(popup.drawn).toBe(true);
    expect(working.pills).toEqual(['ChatSpace: подключён', 'Хаб: на связи']);
    expect(working.codes).toEqual([]);
    expect(working.persona).toContain(WORLD.pages.one.title);
    // PU-008: the fan by the name the tab knows (the stand's «Fan Alder»), not «фан 74001001»; the id is one click away —
    // in the name's tooltip, and the name copies it.
    expect(working.dialog).toContain(A1_NAME);
    expect(
      await browser.execute((name) => {
        const button = [...document.querySelectorAll('.pg-popup__line b .pg-popup__copy')].find((node) => node.textContent?.trim() === name);
        const tip = button?.getAttribute('aria-describedby');
        return tip === null || tip === undefined ? null : (document.getElementById(tip)?.textContent ?? null);
      }, A1_NAME),
    ).toBe(`фан ${a1}`);
    expect(working.buttons).toEqual({ Spenders: true, Новые: true, Клавиши: true, Настройки: true });
    // The buttons have just come on: the picture waits for their colour to settle (transitions ≤ 150 ms).
    await browser.pause(300);
    await capturePage('ext-popup-working-shift');

    await press('Spenders', '.pg-popup__btns');
    await browser.switchToWindow(standTab);
    // The overlay opens at once, its surface mounts once the board's lazy chunk has loaded: wait for both, as
    // tab-wiring and background-wiring do.
    const report = await waitForReport((item) => item.dock?.overlays.includes('spenders') === true && item.dock.surfaces.includes('spenders'), 'the Spenders window is open in the ChatSpace tab', 20_000);
    expect(report.dock?.surfaces).toContain('spenders');
    expect((await readReport())?.appError).toBeUndefined();
  });

  it('[ST-108] [LG-020] «Выгрузить диагностику» saves two files through a Blob of the page: the JSON for support and the short text', async () => {
    await settingsTab();
    await openOptions('diagnostics');
    await waitForOptions((state) => state.section === 'diagnostics' && state.text.includes('Выгрузить диагностику'), '«Диагностика»');
    // The save itself is the browser's: here the two links the page clicks are caught instead of files on disk.
    await ensureNameShim();
    await browser.execute(() => {
      const scope = globalThis as unknown as { __cgSaved?: { name: string; href: string; text: string }[] };
      const saved: { name: string; href: string; text: string }[] = [];
      scope.__cgSaved = saved;
      HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement): void {
        const entry = { name: this.download, href: this.href, text: '' };
        saved.push(entry);
        void fetch(this.href)
          .then((response) => response.text())
          .then((body) => {
            entry.text = body;
          });
      };
    });
    await press('Выгрузить диагностику');
    await browser.waitUntil(async () => (await browser.execute(() => (globalThis as unknown as { __cgSaved?: { text: string }[] }).__cgSaved?.filter((file) => file.text !== '').length ?? 0)) === 2, {
      timeout: 15_000,
      timeoutMsg: 'the two diagnostics files were not handed to the browser',
    });
    const files = await browser.execute(() => (globalThis as unknown as { __cgSaved: { name: string; href: string; text: string }[] }).__cgSaved);
    expect(files.map((file) => file.name.replace(/-\d[\d-]*/, '*'))).toEqual(['chatgoose-diagnostics*.json', 'chatgoose-diagnostics*.txt']);
    for (const file of files) expect(file.href.startsWith('blob:moz-extension://')).toBe(true);
    const bundle = JSON.parse(files[0]?.text ?? '{}') as { extension?: { testBuild?: boolean } };
    expect(bundle.extension?.testBuild).toBe(true);
    // Neither file carries the password, and the page says the files are saved.
    for (const file of files) expect(file.text).not.toContain(PASSWORD);
    await waitForOptions((state) => state.text.includes('Файлы сохранены'), 'the page says the files are saved', 5000);
  });

  it('[TL-015] [ST-034] «Разрешить замеры» asks the browser for the technical-data consent inside the click; the row and the checklist follow', async () => {
    await settingsTab();
    await openOptions('status');
    const asking = await waitForOptions((state) => state.rows['consent']?.level === 'warn', 'the consent row asks');
    expect(asking.rows['consent']?.action).toBe('Разрешить замеры');
    expect(asking.checklist.find((step) => step.id === 'consent')?.done).toBe(false);
    await press('Разрешить замеры', '[data-pg-row="consent"]');
    const granted = await waitForOptions((state) => state.rows['consent']?.level === 'ok', 'the consent is on');
    expect(granted.rows['consent']?.action).toBeNull();
    expect(granted.checklist.find((step) => step.id === 'consent')?.done).toBe(true);
    const diagnostics = await pageRpc<{ telemetry: { consent: boolean | null } }>('diagnostics.get');
    expect(diagnostics.ok && diagnostics.payload.telemetry.consent).toBe(true);
  });

  it('[DB-001] [DB-007] [NF-029] the debug pages of the installed build: nothing of a prompt or a journal without debug mode; with it «Журналы» of «Диагностика» open the journal in its own tab, and the prompt page says honestly that a snapshot is gone', async () => {
    const marker = (name: string): Promise<string | null> => browser.execute((attribute: string) => document.querySelector(`[${attribute}]`)?.getAttribute(attribute) ?? null, name);
    const tab = await settingsTab();
    // Debug mode is off: the prompt page shows no prompt and asks for none.
    await browser.url(testBuildPage('debug-prompt.html?t=prompt-token-nobody-has'));
    await browser.waitUntil(async () => (await marker('data-pg-prompt')) === 'debug-off', { timeout: 10_000, timeoutMsg: 'the prompt page did not say that debug mode is off' });
    expect(await browser.execute(() => document.body.outerHTML.includes('prompt-token-nobody-has'))).toBe(false);
    await openOptions('diagnostics');
    const off = await waitForOptions((state) => state.section === 'diagnostics' && state.text.includes('Журналы появятся в режиме отладки'), '«Диагностика» without the journals');
    expect(off.text).not.toContain('Вызовы хаба');

    // Debug mode on (the switch is on «Генерация»; here the page's own request): the page hears it and offers the journals.
    expect(await pageRpc('settings.patchRestricted', { patch: { debug: { enabled: true } }, baseRevision: null })).toMatchObject({ ok: true });
    await waitForOptions((state) => state.text.includes('Вызовы хаба'), 'the journals are offered');
    const before = await browser.getWindowHandles();
    await press('Операции');
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length === before.length + 1, { timeout: 10_000, timeoutMsg: 'the journal tab did not open' });
    const journalTab = (await browser.getWindowHandles()).find((handle) => !before.includes(handle)) ?? '';
    await browser.switchToWindow(journalTab);
    await browser.waitUntil(async () => (await browser.getUrl()).endsWith('debug-journal.html#operations'), { timeout: 10_000, timeoutMsg: 'the journal tab is not at «Операции»' });
    await browser.waitUntil(async () => (await marker('data-pg-journal')) === 'filters', { timeout: 10_000, timeoutMsg: 'the journal did not draw its records' });
    expect(await browser.execute(() => document.title)).toBe('ChatGoose · Журнал');
    await capturePage('ext-debug-journal');
    // Another journal from the settings: the open journal tab is pointed at it, not a second one.
    await browser.switchToWindow(tab);
    await press('Вызовы хаба');
    await browser.switchToWindow(journalTab);
    await browser.waitUntil(async () => (await browser.getUrl()).endsWith('debug-journal.html#hub-calls'), { timeout: 10_000, timeoutMsg: 'the open journal tab was not pointed at «Вызовы хаба»' });
    expect(await browser.getWindowHandles()).toHaveLength(before.length + 1);

    // A snapshot the background does not hold (they live 12 minutes, in memory): «истёк», never an empty page.
    await browser.url(testBuildPage('debug-prompt.html?t=prompt-token-nobody-has'));
    await browser.waitUntil(async () => (await marker('data-pg-prompt')) === 'expired', { timeout: 10_000, timeoutMsg: 'the prompt page did not say that the snapshot is gone' });
    expect(await browser.execute(() => document.body.outerHTML.includes('prompt-token-nobody-has'))).toBe(false);

    // As found: debug off — the open debug page drops what it showed at once — and the extra tab closed.
    await browser.switchToWindow(tab);
    expect(await pageRpc('settings.patchRestricted', { patch: { debug: { enabled: false } }, baseRevision: null })).toMatchObject({ ok: true });
    await browser.switchToWindow(journalTab);
    await browser.waitUntil(async () => (await marker('data-pg-prompt')) === 'debug-off', { timeout: 10_000, timeoutMsg: 'the prompt page kept its state after debug mode went off' });
    await browser.closeWindow();
    await browser.switchToWindow(tab);
  });

  it('[PU-013] [AU-015] a sign-in the hub revoked: «Обновить статус» of the popup learns it, and the popup and the settings both say why', async () => {
    await toPopup();
    await openPopup();
    await waitForPopup((state) => state.view === 'ready', 'the popup of a signed-in person');
    await hub().command({ op: 'revokeTokens' });
    await press('Обновить статус', '.pg-popup__foot');
    const popup = await waitForPopup((state) => state.view === 'forbidden', 'the popup after the revoke');
    expect(popup.codes).toEqual(['CG-AUTH-REVOKED']);
    expect(popup.login).toBeNull();
    await capturePage('ext-popup-revoked');
    await settingsTab();
    // The settings page was open all along: it heard the same event and stands on the sign-in screen with the reason.
    const settings = await waitForOptions((state) => state.gate && state.codes.includes('CG-AUTH-REVOKED'), 'the sign-in screen says the sign-in was revoked');
    expect(settings.text).toContain('CG-AUTH-REVOKED');
    expect(await pageRpc('session.get')).toEqual({ ok: true, payload: { session: null } });
  });
});
