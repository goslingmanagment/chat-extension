// The extension pages as they render (ui/pages over the real controller and
// the scripted background): the popup, the options page with its sections
// and the sign-in screen, the debug pages. Layout and pixels are the e2e's
// job (pages-gallery in headless Firefox); here — what is drawn, what a
// click sends, and what the page says about saving.

import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS, SCHEME_ATTRIBUTE, SETTINGS_SECTIONS, type Unmount } from '@cg/contracts';
import { AUTOSAVE_DEBOUNCE_MS, SCHEME_ACTIONS } from '@cg/core/application/pages';
import { JOURNAL_PAGE_SIZE, JOURNAL_REFRESH_MS, PAGES_CSS, mountDebugJournal, mountDebugPrompt, mountOptions, mountPopup } from '@cg/ui/pages';

import { LONG_TITLE, PAGES_NOW, longTitleState, pagesWorld, sameTitleState, settle, signedOutState, troubledState, workingState, type PagesWorld, type PagesWorldOptions } from './world';

interface Mounted {
  readonly world: PagesWorld;
  readonly root: HTMLElement;
  $<T extends HTMLElement = HTMLElement>(selector: string): T | null;
  $$<T extends HTMLElement = HTMLElement>(selector: string): T[];
  text(): string;
}

let unmount: Unmount | null = null;
let current: PagesWorld | null = null;

/**
 * One step and everything it leads to: Preact renders at the end of `act`,
 * a render subscribes, a subscription asks the background, the answer
 * renders again — so a few rounds, each letting the requests settle.
 */
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

async function mount(kind: 'popup' | 'options' | 'debug-prompt' | 'debug-journal', options: PagesWorldOptions & { readonly token?: string; readonly before?: (world: PagesWorld) => void } = {}): Promise<Mounted> {
  const world = pagesWorld({ page: kind, ...options });
  current = world;
  options.before?.(world);
  const root = document.createElement('div');
  document.body.append(root);
  await act(async () => {
    world.client.start();
    await settle();
    if (kind === 'popup') unmount = mountPopup(root, world.deps);
    else if (kind === 'options') unmount = mountOptions(root, { ...world.deps, location: world.client.location, helpUrl: 'https://ext.example.test/chat-extension/start.html' });
    else if (kind === 'debug-prompt') unmount = mountDebugPrompt(root, { ...world.deps, token: options.token ?? 'prompt-token-1' });
    else unmount = mountDebugJournal(root, world.deps);
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

/** Takes a page down inside a test that mounts another one. */
function close(page: Mounted): void {
  unmount?.();
  unmount = null;
  page.world.client.dispose();
  document.body.replaceChildren();
}

const button = (page: Mounted, label: string): HTMLElement => {
  const found = page.$$('button, a').find((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim().startsWith(label) || node.getAttribute('aria-label') === label);
  if (found === undefined) throw new Error(`no button «${label}» on the page`);
  return found;
};

const type = (input: HTMLElement, value: string): void => {
  (input as HTMLInputElement).value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

beforeEach(() => {
  vi.useFakeTimers({ now: PAGES_NOW });
});
afterEach(() => {
  unmount?.();
  unmount = null;
  current?.client.dispose();
  current = null;
  document.body.replaceChildren();
  document.documentElement.removeAttribute(SCHEME_ATTRIBUTE);
  vi.useRealTimers();
});

describe('popup (ui-design §4.23)', () => {
  it('[PU-003] [PU-004] [PU-005] [PU-008] [PU-009] a working shift as final-20a draws it', async () => {
    const page = await mount('popup');
    expect(page.$('.pg-popup__ver')?.textContent).toBe('0.4.3');
    expect(page.$$('.pg-pill').map((pill) => pill.textContent)).toEqual(['ChatSpace: подключён', 'Хаб: на связи']);
    expect(page.$$('.pg-pill .cg-dot')).toHaveLength(0);
    const rows = page.$$('.pg-popup__sec').map((row) => (row.textContent ?? '').replace(/\s+/g, ' ').trim());
    // Whose persona: the page's title, its platform and the hub's page label (two pages may share a title).
    expect(rows[0]).toBe('ПерсонаЛора · VIPдля LoraVie VIPOnlyFans · loravie-vip');
    expect(rows[1]).toBe('Аккаунт ChatGoosechatter1Выйти');
    expect(rows[2]).toContain('Открыт диалог');
    expect(rows[2]).toContain('OnlyMonster 1001');
    expect(rows[3]).toBe('Квота AI на сегодняосталось 12обновится в 03:00');
    // PU-009 without amber: a ring before a low number, no colour.
    expect(page.$$('.pg-popup__sec')[3]?.querySelector('.cg-dot--ring')).not.toBeNull();
    expect(page.$$('.pg-popup__btns .cg-btn').map((node) => (node.textContent ?? '').trim())).toEqual(['Spenders⌘⇧M', 'Новые3', 'Клавиши?', 'Настройки']);
    expect(page.text()).not.toMatch(/\$\d/);
  });

  it('[PU-006] [PU-022] problems as final-20b: the red dot only next to the failure, each problem with its code', async () => {
    const page = await mount('popup', { state: troubledState(), before: (world) => world.background.failNext('bootstrap.get', { code: 'CG-HUB-UNAVAILABLE' }, 5) });
    expect(page.$$('.pg-pill').map((pill) => pill.textContent)).toEqual(['ChatSpace: только копия', 'Хаб: нет связи']);
    expect(page.$$('.pg-pill')[0]?.querySelector('.cg-dot--ring')).not.toBeNull();
    expect(page.$$('.pg-pill')[1]?.querySelector('.cg-dot--danger')).not.toBeNull();
    expect(page.$$('.pg-popup__err').map((node) => node.getAttribute('data-cg-code'))).toEqual(['CG-HUB-UNAVAILABLE', 'CG-HOST-CONTRACT']);
    expect(page.$$('.pg-popup__err')[0]?.textContent).toContain('ChatGoose · CG-HUB-UNAVAILABLE');
    expect(page.text()).toContain('Квота AI на сегодня—хаб не отвечает');
  });

  it('[PU-001] the background does not answer: a card with the code and «Повторить», no spinner', async () => {
    const page = await mount('popup', { before: (world) => (world.background.unreachable = true) });
    expect(page.$('[data-cg-code="CG-RUNTIME-UNREACHABLE"]')).not.toBeNull();
    expect(page.$('.cg-spin')).toBeNull();
    expect(page.$('[aria-busy="true"]')).toBeNull();
    page.world.background.unreachable = false;
    await flush(() => button(page, 'Повторить').click());
    expect(page.$$('.pg-pill')).toHaveLength(2);
  });

  it('[PU-002] not signed in: «Войти» leads to «Аккаунт» in the one settings tab', async () => {
    const page = await mount('popup', { state: signedOutState() });
    expect(page.$('[data-cg-code="CG-AUTH-REQUIRED"]')).not.toBeNull();
    expect(page.$$('.pg-pill')).toHaveLength(0);
    // The popup says where to sign in — not «через значок расширения», which is the popup the person is looking at.
    expect(page.text()).toContain('Войдите в настройках');
    expect(page.text()).not.toContain('через значок расширения');
    expect(page.text().split('Войдите в настройках')).toHaveLength(2);
    await flush(() => button(page, 'Войти').click());
    expect(page.world.browser.record.opened).toEqual([{ page: 'options', hash: 'account:CG-AUTH-REQUIRED' }]);
  });

  it('[PU-002] the sign-in state could not be read: the error with its code and «Повторить», not «Войдите»', async () => {
    const page = await mount('popup', { before: (world) => world.background.failNext('session.get', { code: 'CG-TIMEOUT' }) });
    expect(page.$('[data-cg-code="CG-TIMEOUT"]')).not.toBeNull();
    expect(page.$('[data-cg-code="CG-AUTH-REQUIRED"]')).toBeNull();
    expect(page.$$('button').map((node) => (node.textContent ?? '').trim())).not.toContain('Войти');
    await flush(() => button(page, 'Повторить').click());
    expect(page.$$('.pg-pill')).toHaveLength(2);
    expect(page.text()).toContain('chatter1');
  });

  it('[PU-007] a click on the account number copies it', async () => {
    const page = await mount('popup');
    await flush(() => button(page, 'OnlyMonster 1001').click());
    expect(page.world.browser.record.clipboard).toEqual(['1001']);
    expect(page.$('.cg-toast')?.textContent).toContain('Номер скопирован');
  });


  it('[PU-012] the popup takes its theme from the settings', async () => {
    const state = workingState();
    state.settings = { ...state.settings, ui: { ...state.settings.ui, theme: 'dark' } };
    await mount('popup', { state });
    expect(document.documentElement.getAttribute(SCHEME_ATTRIBUTE)).toBe('dark');
  });

  it('[PU-013] signing out asks first; then the popup redraws as signed out', async () => {
    const page = await mount('popup');
    await flush(() => button(page, 'Выйти').click());
    expect(page.$('[role="alertdialog"]')?.textContent).toContain('Выйти из ChatGoose?');
    expect(page.world.background.requests('session.signOut')).toEqual([]);
    await flush(() => button(page, 'Отмена').click());
    expect(page.$('[role="alertdialog"]')).toBeNull();
    expect(page.world.background.requests('session.signOut')).toEqual([]);
    await flush(() => button(page, 'Выйти').click());
    await flush(() => page.$<HTMLElement>('.cg-confirm-dlg__go')?.click());
    expect(page.world.background.requests('session.signOut')).toHaveLength(1);
    expect(page.$('[data-cg-code="CG-AUTH-REQUIRED"]')).not.toBeNull();
  });
});

describe('options: the shell (ui-design §4.24)', () => {
  it('[ST-001] [ST-002] eight sections; the hash decides which one is drawn', async () => {
    const page = await mount('options');
    expect(page.$$('.pg-nav__a').map((link) => link.textContent)).toEqual(['Статус', 'Аккаунт ChatGoose', 'Персоны', 'Аккаунты', 'Генерация', 'Хоткеи', 'Вид и звук', 'Диагностика']);
    expect(page.$('.pg-nav__a[aria-current="page"]')?.textContent).toBe('Статус');
    expect(page.$('main h1')?.textContent).toBe('Статус');
    for (const section of SETTINGS_SECTIONS) {
      await flush(() => page.world.browser.go(`#${section}`));
      expect(page.$('.pg-page')?.getAttribute('data-pg-section'), section).toBe(section);
      expect(page.$('.cg-boundary'), section).toBeNull();
      expect(page.$('main h1')?.textContent, section).toBe(page.$('.pg-nav__a[aria-current="page"]')?.textContent);
    }
  });

  it('[ST-003] a click on a section moves the hash of this tab', async () => {
    const page = await mount('options');
    await flush(() => button(page, 'Вид и звук').click());
    expect(page.world.browser.hash).toBe('appearance');
    expect(page.$('main h1')?.textContent).toBe('Вид и звук');
  });

  it('[ST-020] «Статус» as final-21a: the readiness line and the rows', async () => {
    const page = await mount('options');
    expect(page.$('.pg-lead')?.textContent).toBe('ChatGoose проверяет связь, когда вы открываете эту страницу. Последняя проверка в 09:20.');
    expect(page.$('.pg-sum b')?.textContent).toBe('Готово к смене');
    expect(page.$('.pg-sum > span')?.textContent).toBe('одно предупреждение: мало квоты AI');
    const rows: Record<string, string> = Object.fromEntries(page.$$('.pg-row').map((row) => [row.getAttribute('data-pg-row') ?? '', (row.querySelector('.pg-row__v')?.textContent ?? '').trim()]));
    expect(rows['extension']).toBe('Версия 0.4.3Обновилось сегодня в 09:02 с 0.4.2. Вкладки перезагружены.');
    // The page checked the connection as it opened (ST-058); the scripted hub answers at once.
    expect(rows['hub']).toBe('gosling-agency.ru, на связиОтвет за 0 мс. Архив чатов догоняет ChatSpace за 1–2 минуты.');
    expect(rows['binding']).toBe('OnlyMonster 1001 → LoraVie VIPOnlyFans, @loravie_vip. Другие аккаунты: 3 привязаны.');
    expect(rows['quota']).toBe('Осталось 12 генерацийОбновится в 03:00 по Москве (00:00 UTC).');
    expect(page.$('[data-pg-row="quota"]')?.getAttribute('data-pg-level')).toBe('warn');
    expect(page.$('[data-pg-row="quota"] .cg-dot--ring')).not.toBeNull();
    expect(page.$('[data-pg-row="hub"] .cg-dot--ink')).not.toBeNull();
    // No red anywhere on a working shift.
    expect(page.$$('.cg-dot--danger')).toHaveLength(0);
  });

  it('[ST-008] [ST-009] [ST-010] a deep link: the plate «КОД · описание» and the target highlighted for two seconds', async () => {
    const page = await mount('options', { hash: '#status:CG-QUOTA-DAILY' });
    expect(page.$('[data-pg-plate="CG-QUOTA-DAILY"]')?.textContent).toContain('ChatGoose · CG-QUOTA-DAILY');
    expect(page.$('[data-pg-plate="CG-QUOTA-DAILY"]')?.textContent).toContain('Дневная квота AI исчерпана');
    const target = page.$('[data-pg-anchor="quota"]');
    expect(target?.classList.contains('is-target')).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(target?.classList.contains('is-target')).toBe(false);
    // The same link again highlights again.
    await flush(() => page.world.browser.go('#status:CG-QUOTA-DAILY'));
    expect(page.$('[data-pg-anchor="quota"]')?.classList.contains('is-target')).toBe(true);
    // Another section, another target: the hub address of «Аккаунт».
    await flush(() => page.world.browser.go('#account:CG-HUB-URL'));
    expect(page.$('main h1')?.textContent).toBe('Аккаунт ChatGoose');
    expect(page.$('[data-pg-anchor="hub-address"]')?.classList.contains('is-target')).toBe(true);
    await flush(() => button(page, 'Закрыть').click());
    expect(page.$('[data-pg-plate]')).toBeNull();
  });

  it('[ST-013] [ST-014] a switch is saved at once and «Сохранено ✓» shows only after the background confirmed', async () => {
    const page = await mount('options', { hash: '#appearance' });
    const release = page.world.background.hold('settings.patch');
    await flush(() => page.$<HTMLElement>('[role="checkbox"][aria-label="Подсказки при наведении"]')?.click());
    expect(page.$('[data-pg-save]')?.getAttribute('data-pg-save')).toBe('saving');
    expect(page.text()).not.toContain('Сохранено ✓');
    await flush(release);
    expect(page.$('[data-pg-save="saved"]')?.textContent).toBe('Сохранено ✓');
    expect(page.$('[data-pg-save="saved"]')?.getAttribute('data-pg-revision')).toBe('8');
    expect(page.world.state.settings.ui.hints).toBe(false);
  });

  it('[ST-014] a refused write: «Не сохранено» with the code and «Повторить», which saves on a click', async () => {
    const page = await mount('options', { hash: '#generation' });
    page.world.background.failNext('settings.patch', { code: 'CG-STORAGE-WRITE' });
    await flush(() => page.$<HTMLElement>('[role="checkbox"][aria-label="Split по умолчанию"]')?.click());
    const failed = page.$('[data-pg-save="failed"]');
    expect(failed?.textContent).toContain('Не сохранено');
    expect(failed?.textContent).toContain('CG-STORAGE-WRITE');
    expect(page.text()).not.toContain('Сохранено ✓');
    await flush(() => button(page, 'Повторить').click());
    expect(page.$('[data-pg-save="saved"]')).not.toBeNull();
    expect(page.world.state.settings.generation.split).toBe(true);
  });

  it('[ST-016] a store newer than the build: the barrier is shown and the controls do nothing', async () => {
    const state = workingState();
    state.readOnly = true;
    const page = await mount('options', { state, hash: '#appearance' });
    expect(page.$('[data-cg-code="CG-STORAGE-VERSION"]')?.textContent).toContain('Данные новее расширения');
    const hints = page.$('[role="checkbox"][aria-label="Подсказки при наведении"]');
    expect(hints?.getAttribute('aria-disabled')).toBe('true');
    await flush(() => hints?.click());
    expect(page.world.background.requests('settings.patch')).toEqual([]);

    // The volume: a drag is put back and nothing is written.
    const volume = page.$<HTMLInputElement>('input[type="range"]');
    expect(volume?.getAttribute('aria-disabled')).toBe('true');
    const stored = String(state.settings.sound.volume);
    await flush(() => type(volume as HTMLElement, '35'));
    await flush(() => volume?.dispatchEvent(new Event('change', { bubbles: true })));
    expect(volume?.value).toBe(stored);
    expect(page.$('.pg-range__v')?.textContent).toBe(stored);

    // The numbers: the buttons, a typed value with Enter and with a blur — nothing is written.
    await flush(() => page.world.browser.go('#generation'));
    const input = page.$<HTMLInputElement>('input[aria-label="Reply и Coach"]');
    expect(input?.readOnly).toBe(true);
    for (const stepButton of input?.closest('.pg-step')?.querySelectorAll('button') ?? []) await flush(() => stepButton.click());
    await flush(() => type(input as HTMLElement, '60'));
    await flush(() => input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await flush(() => type(input as HTMLElement, '70'));
    await flush(() => input?.dispatchEvent(new FocusEvent('blur')));
    await flush(() => input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
      await settle();
    });
    expect(input?.value).toBe('100');
    expect(page.$('.pg-chip')).toBeNull();
    expect(page.world.background.requests('settings.patch')).toEqual([]);
    expect(page.world.background.requests('settings.patchRestricted')).toEqual([]);
    expect(page.world.state.revision).toBe(7);
  });

  it('[ST-017] settings that cannot be read: an error card with «Повторить», no section with made-up values', async () => {
    const page = await mount('options', { hash: '#generation', before: (world) => world.background.failNext('settings.get', { code: 'CG-STORAGE-READ' }) });
    expect(page.$('[data-cg-code="CG-STORAGE-READ"]')).not.toBeNull();
    expect(page.$('.pg-step')).toBeNull();
    await flush(() => button(page, 'Повторить').click());
    expect(page.$$('.pg-step').length).toBeGreaterThan(0);
  });

  it('[ST-012] the first-run checklist: eight steps, hidden for good by «Скрыть навсегда»', async () => {
    const state = workingState();
    state.settings = { ...state.settings, onboarding: { ...state.settings.onboarding, checklistDismissed: false } };
    const page = await mount('options', { state });
    expect(page.$$('.pg-check__item')).toHaveLength(8);
    expect(page.$('.pg-check__head span')?.textContent).toBe('7 из 8');
    await flush(() => button(page, 'Скрыть навсегда').click());
    expect(page.$('.pg-check')).toBeNull();
    expect(page.world.state.settings.onboarding.checklistDismissed).toBe(true);
  });

  it('[ST-012] the first run starts on the sign-in screen: the checklist stands there with what is to do before the sign-in', async () => {
    const state = signedOutState();
    state.diagnostics = { ...state.diagnostics, telemetry: { ...state.diagnostics.telemetry, consent: false } };
    const page = await mount('options', { state, before: (world) => world.browser.granted.clear() });
    expect(page.$('[data-pg-gate]')).not.toBeNull();
    expect(page.$$('.pg-check__item')).toHaveLength(8);
    const todo = (id: string): HTMLElement | null => page.$(`.pg-check__item[data-pg-step="${id}"]`);
    expect(todo('install')?.classList.contains('is-done')).toBe(true);
    for (const id of ['host-permission', 'sign-in', 'consent']) expect(todo(id)?.classList.contains('is-done'), id).toBe(false);
    // «Дать права на хосты» and the consent are asked from here, inside the click.
    await flush(() => todo('host-permission')?.querySelector('button')?.click());
    await flush(() => todo('host-permission')?.querySelector('button')?.click());
    expect(page.world.browser.record.permissionRequests).toEqual(['https://chatspace.example.test', DEFAULT_SETTINGS.hub.baseUrl]);
    expect(todo('host-permission')?.classList.contains('is-done')).toBe(true);
    await flush(() => todo('consent')?.querySelector('button')?.click());
    expect(page.world.browser.record.consentRequests).toBe(1);
    expect(todo('consent')?.classList.contains('is-done')).toBe(true);
    // «Войти в хаб» points at the form on this screen.
    await flush(() => todo('sign-in')?.querySelector('button')?.click());
    expect(page.$('[data-pg-anchor="sign-in"]')?.classList.contains('is-target')).toBe(true);
    expect(page.$('[data-pg-anchor="sign-in"] form')).not.toBeNull();
    // A step that needs the sign-in has nothing to press yet.
    expect(todo('persona')?.querySelector('button')).toBeNull();
  });

  it('[ST-005] the footer: the version, «Что нового» with «нов.», «История версий»', async () => {
    const state = workingState();
    state.settings = { ...state.settings, onboarding: { ...state.settings.onboarding, lastSeenVersion: '0.4.2' } };
    const page = await mount('options', { state });
    expect(page.$('.pg-nav__foot')?.textContent).toBe('Версия 0.4.3Что новогонов.История версий');
    await flush(() => button(page, 'Что нового').click());
    expect(page.world.browser.record.links).toEqual(['https://ext.example.test/chat-extension/whats-new.html']);
    expect(page.$('.pg-nav__foot .pg-tag')).toBeNull();
  });
});

describe('options: the sign-in screen and «Аккаунт» (§8.2)', () => {
  it('[ST-011] [ST-134] without a sign-in every route is the sign-in screen: the form, «Дополнительно», the sound, the version', async () => {
    const page = await mount('options', { state: signedOutState(), hash: '#generation' });
    expect(page.$('.pg-nav')).toBeNull();
    expect(page.$('h1')?.textContent).toBe('Вход в ChatGoose');
    expect(page.$$('form input').map((input) => input.getAttribute('type'))).toEqual(['text', 'password']);
    expect(page.text()).toContain('Дополнительно');
    expect(page.$$('details [role="checkbox"]').map((node) => node.getAttribute('aria-checked'))).toEqual(['true', 'true']);
    expect(page.$('.pg-brand span')?.textContent).toBe('0.4.3');
    expect(page.$('.pg-plate')).toBeNull();
  });

  it('[ST-046] the form sends the login and the password once; the password leaves the page', async () => {
    const page = await mount('options', { state: signedOutState() });
    const [login, password] = page.$$('form input');
    await flush(() => type(login as HTMLElement, 'chatter1'));
    await flush(() => type(password as HTMLElement, 'synthetic-pass'));
    await flush(() => button(page, 'Войти').click());
    expect(page.world.background.requests('session.signIn')).toEqual([{ login: 'chatter1', password: '[14]' }]);
    expect(page.$('.pg-nav')).not.toBeNull();
    expect(document.body.outerHTML).not.toContain('synthetic-pass');
  });

  it('[ST-046] wrong credentials: the error under the form with its code, and an empty password field', async () => {
    const page = await mount('options', { state: signedOutState() });
    const [login, password] = page.$$('form input');
    await flush(() => type(login as HTMLElement, 'chatter1'));
    await flush(() => type(password as HTMLElement, 'wrong'));
    await flush(() => button(page, 'Войти').click());
    expect(page.$('form [data-cg-code="CG-LOGIN-CREDENTIALS"]')?.textContent).toContain('Неверный логин или пароль');
    expect(page.$<HTMLInputElement>('form input[type="password"]')?.value).toBe('');
  });

  it('[AU-015] the screen says why the sign-in ended', async () => {
    const page = await mount('options');
    await flush(() => page.world.background.setSession(null, 'expired'));
    expect(page.$('.pg-plate')?.getAttribute('data-cg-code')).toBe('CG-AUTH-EXPIRED');
    expect(page.$('.pg-plate')?.textContent).toContain('Вход истёк');
  });

  it('[ST-041] [ST-043] the hub address is edited on the sign-in screen and saved by a click', async () => {
    const page = await mount('options', { state: signedOutState() });
    const address = page.$<HTMLInputElement>('input[aria-label="Адрес хаба"]');
    expect(address?.value).toBe(DEFAULT_SETTINGS.hub.baseUrl);
    await flush(() => type(address as HTMLElement, 'hub.example.test'));
    await flush(() => button(page, 'Сохранить адрес').click());
    expect(page.world.state.settings.hub.baseUrl).toBe('https://hub.example.test');
    expect(page.world.browser.record.permissionRequests).toEqual(['https://hub.example.test']);
  });

  it('[ST-042] signed in: the address is text, not a field, and says «Перед сменой адреса выйдите.»', async () => {
    const page = await mount('options', { hash: '#account' });
    expect(page.$('input[aria-label="Адрес хаба"]')).toBeNull();
    expect(page.$('[data-pg-anchor="hub-address"]')?.textContent).toContain(DEFAULT_SETTINGS.hub.baseUrl);
    expect(page.$('[data-pg-anchor="hub-address"]')?.textContent).toContain('Перед сменой адреса выйдите.');
  });

  it('[ST-048] [ST-051] «Войти заново» opens the form in place; «Выйти…» asks first', async () => {
    const page = await mount('options', { hash: '#account' });
    expect(page.$('form')).toBeNull();
    await flush(() => button(page, 'Войти заново').click());
    expect(page.$('form input[type="password"]')).not.toBeNull();
    await flush(() => button(page, 'Выйти…').click());
    expect(page.$('[role="alertdialog"]')).not.toBeNull();
    // «Отмена» is a no: nothing is sent and the person stays signed in.
    await flush(() => button(page, 'Отмена').click());
    expect(page.world.background.requests('session.signOut')).toEqual([]);
    expect(page.world.state.session?.login).toBe('chatter1');
    expect(page.$('.pg-nav')).not.toBeNull();
    await flush(() => button(page, 'Выйти…').click());
    await flush(() => page.$<HTMLElement>('.cg-confirm-dlg__go')?.click());
    expect(page.world.background.requests('session.signOut')).toHaveLength(1);
    expect(page.$('h1')?.textContent).toBe('Вход в ChatGoose');
  });

  it('[ST-046] [AU-009] a second submit while the sign-in is on its way sends nothing', async () => {
    const page = await mount('options', { state: signedOutState() });
    const release = page.world.background.hold('session.signIn');
    const [login, password] = page.$$('form input');
    await flush(() => type(login as HTMLElement, 'chatter1'));
    await flush(() => type(password as HTMLElement, 'synthetic-pass'));
    await flush(() => {
      button(page, 'Войти').click();
      password?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await flush(() => page.$<HTMLFormElement>('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(page.world.background.requests('session.signIn')).toHaveLength(1);
    // The button says the sign-in is on its way; a password typed meanwhile is not taken by a click or by Enter.
    expect(button(page, 'Входим…').getAttribute('aria-busy')).toBe('true');
    await flush(() => type(page.$$('form input')[1] as HTMLElement, 'typed-meanwhile'));
    await flush(() => button(page, 'Входим…').click());
    await flush(() => page.$$('form input')[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(page.$$<HTMLInputElement>('form input')[1]?.value).toBe('typed-meanwhile');
    expect(page.world.background.requests('session.signIn')).toHaveLength(1);
    await flush(release);
    expect(page.world.background.requests('session.signIn')).toHaveLength(1);
    expect(page.$('.pg-nav')).not.toBeNull();
  });

  it('[ST-042] an address that was not saved: the field shows the stored one and the form says why', async () => {
    const page = await mount('options', { state: signedOutState() });
    page.world.background.failNext('settings.patchRestricted', { code: 'CG-STORAGE-WRITE' });
    const address = page.$<HTMLInputElement>('input[aria-label="Адрес хаба"]');
    await flush(() => type(address as HTMLElement, 'hub.custom.example.test'));
    await flush(() => address?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(page.world.background.requests('settings.patchRestricted')).toHaveLength(1);
    // The address the sign-in would go to is the one on screen.
    expect(address?.value).toBe(DEFAULT_SETTINGS.hub.baseUrl);
    expect(page.$('form [data-cg-code="CG-STORAGE-WRITE"]')).not.toBeNull();
    expect(page.world.state.settings.hub.baseUrl).toBe(DEFAULT_SETTINGS.hub.baseUrl);
  });

  it('[ST-043] host access the browser has not answered about is «неизвестно», with the way to ask', async () => {
    const page = await mount('options', { hash: '#account', before: (world) => (world.browser.permissionsFail = true) });
    const access = page.$('[data-pg-anchor="hub-access"] [data-pg-access]');
    expect(access?.getAttribute('data-pg-access')).toBe('unknown');
    expect(access?.textContent).toContain('неизвестно');
    expect(access?.textContent).not.toContain('разрешён');
    page.world.browser.permissionsFail = false;
    await flush(() => access?.querySelector('button')?.click());
    expect(page.$('[data-pg-anchor="hub-access"] [data-pg-access]')?.getAttribute('data-pg-access')).toBe('granted');
  });

  it('[ST-042] [PU-002] a sign-in state that could not be read: an error card with «Повторить», no sign-in screen', async () => {
    const page = await mount('options', { before: (world) => world.background.failNext('session.get', { code: 'CG-STORAGE-READ' }) });
    expect(page.$('[data-pg-gate]')).toBeNull();
    expect(page.$('form')).toBeNull();
    expect(page.$('input[aria-label="Адрес хаба"]')).toBeNull();
    expect(page.$('[data-cg-code="CG-STORAGE-READ"]')).not.toBeNull();
    await flush(() => button(page, 'Повторить').click());
    expect(page.$('[data-pg-section="status"]')?.textContent).toContain('Готово к смене');
  });
});

describe('options: the sections', () => {
  it('[ST-094] a window is typed or stepped; the mouse wheel never changes it; out of range says «сохранено как N»', async () => {
    const page = await mount('options', { hash: '#generation' });
    const input = page.$<HTMLInputElement>('input[aria-label="Reply и Coach"]');
    expect(input?.value).toBe('100');
    expect(input?.getAttribute('type')).toBe('text');
    await flush(() => input?.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })));
    expect(input?.value).toBe('100');
    expect(page.world.background.requests('settings.patch')).toEqual([]);

    await flush(() => type(input as HTMLElement, '900'));
    await flush(() => input?.dispatchEvent(new FocusEvent('blur')));
    expect(input?.value).toBe('200');
    // Brought into range, on its way: «сохранено как 200» is not said before the background confirmed it.
    expect(page.$('.pg-chip')).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      await settle();
    });
    await flush();
    expect(page.world.state.settings.generation.windows.quick).toBe(200);
    expect(page.$('.pg-chip')?.textContent).toBe('сохранено как 200');
    expect(page.$('.pg-chip')?.getAttribute('data-pg-chip')).toBe('saved');

    // The stepper buttons move by the step and stop at the edge.
    const more = page.$$('.pg-step')[0]?.querySelectorAll('button')[1];
    expect(more?.getAttribute('aria-disabled')).toBe('true');
    await flush(() => page.$$('.pg-step')[0]?.querySelectorAll('button')[0]?.click());
    expect(input?.value).toBe('195');
  });

  it('[ST-093] the deep window stops at the hub limit and says so', async () => {
    const state = workingState();
    state.bootstrap = { ...state.bootstrap, limits: { ...state.bootstrap.limits, deepMax: 1500 } };
    state.settings = { ...state.settings, generation: { ...state.settings.generation, windows: { ...state.settings.generation.windows, deep: 1500 } } };
    const page = await mount('options', { state, hash: '#generation' });
    expect(page.text()).toContain('Хаб принимает не больше 1500 сообщений');
    const input = page.$<HTMLInputElement>('input[aria-label="Review и полный Recap"]');
    await flush(() => type(input as HTMLElement, '3000'));
    await flush(() => input?.dispatchEvent(new FocusEvent('blur')));
    expect(input?.value).toBe('1500');
    expect(page.$('.pg-chip')?.textContent).toBe('сохранено как 1500');
  });

  it('[ST-093] a deep window stored above the hub limit is shown as it is stored, with what the hub takes; nothing is rewritten by itself', async () => {
    const state = workingState();
    state.bootstrap = { ...state.bootstrap, limits: { ...state.bootstrap.limits, deepMax: 1500 } };
    const page = await mount('options', { state, hash: '#generation' });
    const input = page.$<HTMLInputElement>('input[aria-label="Review и полный Recap"]');
    // 3000 is what the settings hold: the field says 3000, not a clipped 1500 that is stored nowhere.
    expect(input?.value).toBe('3000');
    expect(page.$('[data-pg-deep="over"]')?.textContent).toBe('В настройках 3000, но хаб возьмёт не больше 1500. Измените число, чтобы сохранить новое.');
    expect(page.$('.pg-chip')).toBeNull();
    expect(page.world.background.requests('settings.patch')).toEqual([]);
    const [less, more] = [...(input?.closest('.pg-step')?.querySelectorAll('button') ?? [])];
    expect(more?.getAttribute('aria-disabled')).toBe('true');
    await flush(() => more?.click());
    expect(page.world.background.requests('settings.patch')).toEqual([]);
    // The person steps down: the limit is saved, by that click.
    await flush(() => less?.click());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      await settle();
    });
    await flush();
    expect(page.world.state.settings.generation.windows.deep).toBe(1500);
    expect(input?.value).toBe('1500');
    expect(page.$('[data-pg-deep="clipped"]')?.textContent).toContain('Хаб принимает не больше 1500 сообщений');
  });

  it('[ST-014] [ST-094] a number that was brought into range and not saved says «Не сохранено», never «сохранено как N»', async () => {
    const page = await mount('options', { hash: '#generation' });
    page.world.background.failNext('settings.patch', { code: 'CG-STORAGE-WRITE' });
    const input = page.$<HTMLInputElement>('input[aria-label="Reply и Coach"]');
    await flush(() => type(input as HTMLElement, '900'));
    await flush(() => input?.dispatchEvent(new FocusEvent('blur')));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      await settle();
    });
    await flush();
    expect(page.world.state.settings.generation.windows.quick).toBe(100);
    expect(page.$('.pg-chip')?.getAttribute('data-pg-chip')).toBe('failed');
    expect(page.$('.pg-chip')?.textContent).toBe('Не сохранено');
    expect(page.text()).not.toContain('сохранено как');
  });

  it('[ST-120] [ST-121] the hotkey reference: the scheme in the four groups of the cheatsheet, the rows outside it, the platform', async () => {
    const page = await mount('options', { hash: '#hotkeys' });
    expect(page.text()).toContain('Подписи для macOS');
    const scheme = page.$$('table')[0];
    const outside = page.$$('table')[1];
    // ST-120 «4 группы»: each with its heading row and its actions, in the order of use.
    const groups = [...(scheme?.querySelectorAll('tbody[data-pg-hotkeys]') ?? [])].map((group) => [
      group.getAttribute('data-pg-hotkeys'),
      group.querySelector('th[scope="rowgroup"]')?.textContent,
      [...group.querySelectorAll('[data-pg-hotkey]')].map((entry) => entry.getAttribute('data-pg-hotkey')),
    ]);
    expect(groups).toEqual([
      ['ai', 'AI в открытом чате', ['reply', 'fix', 'hi', 'ping', 'review', 'recap', 'coach']],
      ['before', 'Перед генерацией', ['tone', 'split']],
      ['result', 'Результат', ['cancel']],
      ['windows', 'Окна', ['spenders', 'help']],
    ]);
    // Every action of the vendored scheme stands in exactly one group.
    expect(scheme?.querySelectorAll('[data-pg-hotkey]')).toHaveLength(SCHEME_ACTIONS.length);
    expect(scheme?.querySelector('[data-pg-hotkey="reply"] kbd')?.textContent).toBe('⌘E');
    expect(scheme?.querySelector('[data-pg-hotkey="help"]')?.textContent).toContain('пока убран');
    expect(outside?.querySelector('[data-pg-hotkey="insert-part"] kbd')?.textContent).toBe('↵');
    expect(outside?.querySelector('[data-pg-hotkey="next-unread"]')?.textContent).toContain('не проверено');
    // A combination the browser keeps is never printed as a working one.
    expect(outside?.querySelector('[data-pg-hotkey="settings"]')?.textContent).not.toContain('⌘,');
    expect(page.$('[data-pg-hotkey="send"]')).toBeNull();
    // Every action is named as a sentence: no row starts with a small letter.
    const names = page.$$('[data-pg-hotkey] td:first-child').map((cell) => cell.textContent ?? '');
    expect(names.filter((name) => name === '' || name[0] !== name[0]?.toUpperCase())).toEqual([]);
    expect(outside?.querySelector('[data-pg-hotkey="variant-step"] td')?.textContent).toBe('Другой вариант');
  });

  it('[ST-122] [ST-123] [ST-135] theme, «Система сейчас — …», the language on the fly', async () => {
    const page = await mount('options', { hash: '#appearance', scheme: 'dark' });
    expect(page.text()).toContain('Система сейчас — тёмная');
    expect(document.documentElement.getAttribute(SCHEME_ATTRIBUTE)).toBe('dark');
    await flush(() => button(page, 'Светлая').click());
    expect(document.documentElement.getAttribute(SCHEME_ATTRIBUTE)).toBe('light');
    await flush(() => button(page, 'English').click());
    expect(page.world.i18n.language).toBe('en');
    expect(page.$('main h1')?.textContent).toBe(page.world.i18n.t('settings.section.appearance'));
    expect(page.$('main h1')?.textContent).not.toBe('Вид и звук');
    expect(page.$('[role="radiogroup"]')?.getAttribute('aria-label')).toBe(page.world.i18n.t('settings.appearance.resultStyle'));
  });

  it('[ST-124] [ST-126] [ST-127] [ST-130] «Вид ответа» cards, the sounds with their tones, the volume', async () => {
    const page = await mount('options', { hash: '#appearance' });
    const cards = page.$$('[role="radio"]');
    expect(cards.map((card) => card.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    await flush(() => cards[1]?.click());
    expect(page.world.state.settings.ui.resultStyle).toBe('sheet');

    await flush(() => button(page, 'Chime').click());
    expect(page.$$('[role="menuitemradio"]').map((item) => item.textContent)).toEqual(['Chime', 'Drop', 'Bell', 'Arpeggio', 'Knock', 'Double', 'Soft', 'Blip']);
    await flush(() => page.$$('[role="menuitemradio"]')[2]?.click());
    expect(page.world.state.settings.sound.messages.tone).toBe('bell');

    const range = page.$<HTMLInputElement>('input[type="range"]');
    expect([range?.getAttribute('min'), range?.getAttribute('max'), range?.getAttribute('step')]).toEqual(['5', '100', '5']);
    await flush(() => type(range as HTMLElement, '35'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      await settle();
    });
    expect(page.world.state.settings.sound.volume).toBe(35);
  });

  it('[ST-131] [ST-132] [ST-133] «Проверить», the sound state, the way to the per-model switch', async () => {
    const page = await mount('options', { hash: '#appearance' });
    expect(page.text()).toContain('Звук работает: вкладка ChatSpace слушает события.');
    page.world.state.sound = { played: false, code: 'CG-AUDIO-BLOCKED' };
    await flush(() => button(page, 'Проверить').click());
    expect(page.$('[data-cg-code="CG-AUDIO-BLOCKED"]')?.textContent).toContain('Звук не прозвучал');
    await flush(() => button(page, '«Аккаунты»').click());
    expect(page.$('main h1')?.textContent).toBe('Аккаунты');
  });

  it('[ST-061] [ST-073] [ST-074] a page with an archived persona asks for a replacement; choosing one saves it', async () => {
    const state = workingState();
    state.settings = { ...state.settings, personas: { ...state.settings.personas, byPageId: { ...state.settings.personas.byPageId, '13': { key: 'lora-old', definitionId: 'persona-definition-lora-old-0001' } } } };
    const page = await mount('options', { state, hash: '#personas' });
    const row = page.$('[data-pg-page="page-13"]');
    expect(row?.textContent).toContain('в архиве — выберите замену');
    await flush(() => row?.querySelector<HTMLElement>('.pg-pick')?.click());
    await flush(() => row?.querySelectorAll<HTMLElement>('[role="menuitemradio"]')[0]?.click());
    expect(page.world.state.settings.personas.byPageId['13']?.key).toBe('lora-vip');
    expect(page.$('[data-pg-page="page-13"]')?.textContent).not.toContain('выберите замену');
  });

  it('[ST-060] [ST-067] [PU-003] three pages named «Lora Vie»: every list prints the platform and the hub\'s page label next to the title (1.3.0)', async () => {
    const personas = await mount('options', { state: sameTitleState(), hash: '#personas' });
    const rows = personas.$$('[data-pg-page]');
    expect(rows.map((row) => [row.querySelector('b')?.textContent, row.querySelector('.pg-pagetag')?.textContent])).toEqual([
      ['Lora Vie', 'OnlyFans · lora-vip'],
      ['Lora Vie', 'OnlyFans · lora-free'],
      ['Lora Vie', 'Fansly · lora-fansly'],
      // A platform this build has no word for is printed as the hub named it.
      ['Lilly', 'somewhere-new · lilly-new'],
    ]);
    // The picker of each page is named by the page it changes — three «Персона для Lora Vie» would be one name for three menus.
    const names: (string | null)[] = [];
    for (const row of rows) {
      await flush(() => row.querySelector<HTMLElement>('.pg-pick')?.click());
      names.push(personas.$('[role="menu"]')?.getAttribute('aria-label') ?? null);
      await flush(() => row.querySelector<HTMLElement>('.pg-pick')?.click());
    }
    expect(names).toEqual([
      'Персона для Lora Vie (OnlyFans · lora-vip)',
      'Персона для Lora Vie (OnlyFans · lora-free)',
      'Персона для Lora Vie (Fansly · lora-fansly)',
      'Персона для Lilly (somewhere-new · lilly-new)',
    ]);
    // The catalog says on which pages a persona is, by the same names.
    expect(personas.text()).toContain('на ней: Lora Vie (OnlyFans · lora-vip), Lilly (somewhere-new · lilly-new)');
    close(personas);

    const accounts = await mount('options', { state: sameTitleState(), hash: '#accounts' });
    expect(accounts.$$('[data-pg-account] .pg-pagetag').map((node) => node.textContent)).toEqual(['OnlyFans · lora-vip', 'OnlyFans · lora-free', 'Fansly · lora-fansly', 'somewhere-new · lilly-new']);
    expect(accounts.$('[data-pg-account="chatspace:1001"]')?.textContent).toContain('Lora VieOnlyFans · lora-vip');
    close(accounts);

    const account = await mount('options', { state: sameTitleState(), hash: '#account' });
    expect(account.$$('[data-pg-anchor="pages"] > li').map((row) => row.textContent)).toEqual([
      'Lora VieOnlyFans · lora-vip · Лора · VIP',
      'Lora VieOnlyFans · lora-free · Лора · Free',
      'Lora VieFansly · lora-fansly · Лора · Free',
      'Lillysomewhere-new · lilly-new · Лора · VIP',
    ]);
    close(account);

    const popup = await mount('popup', { state: sameTitleState() });
    // The persona's name and «для <страница>» share the first line; the tag has a muted line of its own under them.
    const persona = popup.$$('.pg-popup__sec')[0];
    expect([...(persona?.children ?? [])].map((node) => [node.className, node.textContent])).toEqual([
      ['pg-popup__cap', 'Персона'],
      ['pg-popup__line pg-popup__line--fit', 'Лора · VIPдля Lora Vie'],
      ['pg-popup__under', 'OnlyFans · lora-vip'],
    ]);
    expect(popup.$('.pg-popup__under .pg-pagetag')?.getAttribute('data-pg-page-label')).toBe('lora-vip');
    expect(popup.$('.pg-popup__aside .pg-pagetag')).toBeNull();
  });

  it('[PU-007] a long page title and a long page label: each is one line that ends in «…» and says itself in full on hover; the persona’s name stays the first thing in its row', async () => {
    const popup = await mount('popup', { state: longTitleState() });
    const persona = popup.$$('.pg-popup__sec')[0];
    const [, line, under] = [...(persona?.children ?? [])];
    expect(line?.querySelector('b')?.textContent).toBe(LONG_TITLE.persona);
    expect(line?.querySelector('.pg-popup__aside')?.textContent).toBe(`для ${LONG_TITLE.title}`);
    // What «…» hides is still readable: the full text is the element's title.
    expect(line?.querySelector('.pg-popup__aside')?.getAttribute('title')).toBe(`для ${LONG_TITLE.title}`);
    expect(under?.textContent).toBe(`OnlyFans · ${LONG_TITLE.pageLabel}`);
    expect(under?.getAttribute('title')).toBe(`OnlyFans · ${LONG_TITLE.pageLabel}`);
    // The row is the one that fits: the styles cut both sides instead of letting the row grow (the widths are the e2e's to measure).
    expect(line?.className).toBe('pg-popup__line pg-popup__line--fit');
    expect(PAGES_CSS).toMatch(/\.pg-popup__line--fit > \.pg-popup__aside \{[^}]*min-width: 30%;[^}]*text-overflow: ellipsis;/);
    expect(PAGES_CSS).toMatch(/\.pg-popup__under \.pg-pagetag \{[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis;/);
  });

  it('[ST-069] [ST-070] [ST-076] accounts: the number is copied, the label is typed, «К вкладке» goes to ChatSpace', async () => {
    const page = await mount('options', { hash: '#accounts' });
    const first = page.$('[data-pg-account="chatspace:1001"]');
    expect(page.$$('.pg-group').map((node) => node.textContent)).toEqual(['В работе', 'Видели раньше']);
    await flush(() => first?.querySelector<HTMLElement>('[aria-label="Подпись"]') && type(first.querySelector('[aria-label="Подпись"]') as HTMLElement, 'Основная'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      await settle();
    });
    expect(page.world.state.settings.accounts.labels).toEqual({ 'chatspace:1001': 'Основная' });
    expect(first?.querySelector<HTMLInputElement>('[aria-label="Подпись"]')?.getAttribute('maxlength')).toBe('60');
    await flush(() => button(page, 'Скопировать номер').click());
    expect(page.world.browser.record.clipboard).toEqual(['1001']);
    await flush(() => button(page, 'К вкладке').click());
    expect(page.world.background.requests('tab.command')).toEqual([{ command: { kind: 'account', host: 'chatspace', hostAccountId: '1001' } }]);
  });

  it('[ST-110] «Очистить локальные данные» asks first; «Отмена» does nothing', async () => {
    const page = await mount('options', { hash: '#diagnostics' });
    expect(page.text()).toContain('Кэши: 412 КБ');
    expect(page.text()).toContain('Журнал: 1.3 МБ');
    await flush(() => button(page, 'Очистить локальные данные').click());
    expect(page.$('[role="alertdialog"]')?.textContent).toContain('Очистить локальные данные?');
    await flush(() => button(page, 'Отмена').click());
    expect(page.world.background.requests('data.clear')).toEqual([]);
    await flush(() => button(page, 'Очистить локальные данные').click());
    await flush(() => page.$<HTMLElement>('.cg-confirm-dlg__go')?.click());
    expect(page.world.background.requests('data.clear')).toEqual([{ confirmed: true }]);
    expect(page.text()).toContain('Кэши: 0 КБ');
  });

  it('[ER-012] the same failure said twice is one toast; a failure with another code is another toast', async () => {
    const page = await mount('options', { hash: '#diagnostics' });
    const codes = (): (string | null)[] => page.$$('.cg-toast').map((toast) => toast.querySelector('[data-cg-code]')?.getAttribute('data-cg-code') ?? toast.getAttribute('data-cg-code'));
    page.world.browser.clipboardFails = true;
    await flush(() => button(page, 'Скопировать отчёт для тимлида').click());
    await flush(() => button(page, 'Скопировать отчёт для тимлида').click());
    await flush(() => button(page, 'Скопировать отчёт для тимлида').click());
    expect(page.$$('.cg-toast')).toHaveLength(1);
    expect(page.$('.cg-toast')?.textContent).toContain('CG-CLIPBOARD');
    // A different failure stands next to it and replaces only itself.
    page.world.background.failNext('diagnostics.export', { code: 'CG-TIMEOUT' }, 2);
    await flush(() => button(page, 'Выгрузить диагностику').click());
    await flush(() => button(page, 'Выгрузить диагностику').click());
    expect(page.$$('.cg-toast')).toHaveLength(2);
    expect(page.$$('.cg-toast').map((toast) => (toast.textContent ?? '').includes('CG-TIMEOUT'))).toEqual([true, false]);
    expect(codes()).toHaveLength(2);
  });

  it('[LG-025] [ST-036] «Выгрузить диагностику» and «Скопировать отчёт» say what they did', async () => {
    const page = await mount('options', { hash: '#diagnostics' });
    await flush(() => button(page, 'Выгрузить диагностику').click());
    expect(page.world.browser.record.downloads).toHaveLength(2);
    expect(page.$('.cg-toast')?.textContent).toContain('Файлы сохранены');
    await flush(() => button(page, 'Скопировать отчёт для тимлида').click());
    expect(page.world.browser.record.clipboard[0]).toContain('ChatGoose 0.4.3');
  });

  it('[AU-019] no page prints token / key / API / bearer words, in either language, in any section', async () => {
    const forbidden = /(?<!\p{L})(tokens?|keys?|api|bearer)(?!\p{L})|(?<!\p{L})(токен|ключ)/iu;
    for (const language of ['ru', 'en'] as const) {
      const state = workingState();
      state.settings = { ...state.settings, debug: { enabled: true, renderTrace: false }, onboarding: { ...state.settings.onboarding, checklistDismissed: false } };
      const page = await mount('options', { state, language });
      for (const section of SETTINGS_SECTIONS) {
        await flush(() => page.world.browser.go(`#${section}`));
        expect(page.text().match(forbidden)?.[0], `${language} ${section}`).toBeUndefined();
      }
      unmount?.();
      unmount = null;
      page.world.client.dispose();
      document.body.replaceChildren();
    }
  });
});

describe('options: what the mockup does not draw (parity rows)', () => {
  it('[ST-027] [ST-030] [ST-031] [ST-035] [ST-037] «Статус» below the mockup: the account, Spenders, the sound, the support row, the ways to the sections', async () => {
    const page = await mount('options');
    const rows: Record<string, string> = Object.fromEntries(page.$$('.pg-row').map((row) => [row.getAttribute('data-pg-row') ?? '', (row.textContent ?? '').replace(/\s+/g, ' ').trim()]));
    expect(rows['account']).toBe('Аккаунт ChatGoosechatter1чаттер, страниц: 4Аккаунт');
    expect(rows['spenders']).toBe('Spendersвключён');
    expect(rows['sound']).toBe('Звукслушает вкладок: 1Последний сигнал в 09:13.');
    expect(rows['support']).toContain('Версия 0.4.3, настройки v1');
    await flush(() => page.$<HTMLElement>('[data-pg-row="persona"] button')?.click());
    expect(page.$('main h1')?.textContent).toBe('Персоны');
    expect(page.world.browser.hash).toBe('personas');
  });

  it('[ST-040] [ST-044] [ST-045] [ST-047] [ST-054] «Аккаунт» in four zones; the connection with its time and latency; «Проверить связь» asks again', async () => {
    const page = await mount('options', { hash: '#account' });
    expect(page.$$('main h2').map((node) => node.textContent)).toEqual(['Аккаунт', 'Подключение', 'Страницы', 'Диагностика']);
    expect(page.text()).toContain('Вы вошли какchatter1 · чаттер');
    expect(page.text()).toContain('Это устройствовход выполнен');
    expect(page.text()).toContain('Связьна связи');
    expect(page.text()).toMatch(/проверено в 09:20 · \d+ мс/);
    const before = page.world.background.requests('bootstrap.get').length;
    vi.setSystemTime(PAGES_NOW + 11_000);
    await flush(() => button(page, 'Проверить связь').click());
    expect(page.world.background.requests('bootstrap.get')).toHaveLength(before + 1);
    expect(page.world.background.requests('bootstrap.get').at(-1)).toEqual({ force: true });
  });

  it('[ST-049] [ST-050] [ST-057] the hub account is an https link; the sign-in help is a link of the site; an unknown time is «неизвестно»', async () => {
    const page = await mount('options', { hash: '#account' });
    const account = page.$$<HTMLAnchorElement>('main a').find((link) => link.textContent === 'gosling-agency.ru/account');
    expect(account?.getAttribute('href')).toBe('https://gosling-agency.ru/account');
    expect(account?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(page.text()).toContain('Последнее сохранение досьенеизвестно');
    close(page);
    const signIn = await mount('options', { state: signedOutState() });
    const help = signIn.$$<HTMLAnchorElement>('a').find((link) => link.textContent === 'Нужна помощь со входом');
    expect(help?.getAttribute('href')).toBe('https://ext.example.test/chat-extension/start.html');
  });

  it('[ST-049] a hub address that is not https never becomes a link', async () => {
    const state = workingState();
    state.settings = { ...state.settings, hub: { baseUrl: 'http://hub.example.test' } };
    state.session = state.session === null ? null : { ...state.session, hubOrigin: 'http://hub.example.test' };
    const page = await mount('options', { state, hash: '#account' });
    expect(page.$('[data-pg-anchor="hub-address"]')?.textContent).toContain('http://hub.example.test');
    expect(page.$$<HTMLAnchorElement>('main a').filter((link) => (link.getAttribute('href') ?? '').includes('hub.example.test'))).toEqual([]);
    expect(page.text()).not.toContain('hub.example.test/account');
  });

  it('[ST-063] [ST-064] [ST-065] «Персоны»: when the catalog was read, «Проверить связь и обновить», «К аккаунтам →», and an honest empty catalog', async () => {
    const page = await mount('options', { hash: '#personas' });
    expect(page.text()).toContain('Каталог обновлён в 09:20');
    await flush(() => button(page, 'К аккаунтам').click());
    expect(page.$('main h1')?.textContent).toBe('Аккаунты');
    close(page);

    const state = workingState();
    state.catalog = { personas: [] };
    state.bootstrap = { ...state.bootstrap, pages: [] };
    const empty = await mount('options', { state, hash: '#personas' });
    expect(empty.text()).toContain(empty.world.i18n.t('settings.personas.emptyPages'));
    expect(empty.text()).toContain(empty.world.i18n.t('settings.personas.emptyCatalog'));
    close(empty);

    // The hub did not answer: «недоступен», not «пуст».
    const down = await mount('options', {
      hash: '#personas',
      before: (world) => {
        world.background.failNext('catalog.get', { code: 'CG-HUB-UNAVAILABLE' }, 9);
        world.background.failNext('bootstrap.get', { code: 'CG-HUB-UNAVAILABLE' }, 9);
      },
    });
    expect(down.text()).toContain(down.world.i18n.t('settings.personas.unavailable'));
    expect(down.text()).not.toContain(down.world.i18n.t('settings.personas.emptyCatalog'));
  });

  it('[ST-072] [ST-078] «Аккаунты»: the hub page of each account, what «В работе» means; without ChatSpace the list stays and «К вкладке» says why', async () => {
    const page = await mount('options', { hash: '#accounts' });
    expect(page.text()).toContain('1 из 4 в работе');
    expect(page.text()).toContain('В работе — аккаунт открыт во вкладке ChatSpace сейчас.');
    expect(page.$('[data-pg-account="chatspace:1002"] dl')?.textContent).toContain('Страница хабаLoraVie Free');
    close(page);

    const state = workingState();
    state.diagnostics = { ...state.diagnostics, tabs: [] };
    state.accounts = state.accounts.map((entry) => ({ ...entry, openTabs: 0 }));
    const closed = await mount('options', { state, hash: '#accounts' });
    expect(closed.$$('.pg-group').map((node) => node.textContent)).toEqual(['Видели раньше']);
    expect(closed.$$('[data-pg-account]')).toHaveLength(4);
    const toTab = button(closed, 'К вкладке');
    expect(toTab.getAttribute('aria-disabled')).toBe('true');
    await flush(() => toTab.click());
    expect(closed.world.background.requests('tab.command')).toEqual([]);
  });

  it('[ST-090] [ST-091] [ST-092] the windows of Reply, Ping and Fix with their ranges and defaults', async () => {
    const page = await mount('options', { hash: '#generation' });
    const fields: Record<string, string> = Object.fromEntries(page.$$<HTMLInputElement>('.pg-step input').map((input) => [input.getAttribute('aria-label') ?? '', input.value]));
    expect(fields).toMatchObject({ 'Reply и Coach': '100', Ping: '100', Fix: '25' });
    expect(page.$$('.pg-opt').slice(0, 3).map((row) => row.querySelector('.pg-opt__k span')?.textContent)).toEqual(['от 5 до 200', 'от 5 до 200', 'от 5 до 200']);
    const ping = page.$<HTMLInputElement>('input[aria-label="Ping"]');
    await flush(() => type(ping as HTMLElement, '3'));
    await flush(() => ping?.dispatchEvent(new FocusEvent('blur')));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      await settle();
    });
    expect(page.world.state.settings.generation.windows.ping).toBe(5);
  });

  it('[ST-125] [ST-128] [ST-129] «Показывать» hints, the subscriber sound and its tone are switches of this page', async () => {
    const page = await mount('options', { hash: '#appearance' });
    const hints = page.$<HTMLElement>('[role="checkbox"][aria-label="Подсказки при наведении"]');
    expect(hints?.getAttribute('aria-checked')).toBe('true');
    expect(page.text()).toContain('Причина, почему кнопка недоступна, видна всегда.');
    await flush(() => hints?.click());
    expect(page.world.state.settings.ui.hints).toBe(false);
    const subscribers = page.$<HTMLElement>('[role="checkbox"][aria-label="Новые подписчики"]');
    expect(subscribers?.getAttribute('aria-checked')).toBe('true');
    await flush(() => subscribers?.click());
    expect(page.world.state.settings.sound.subscribers.on).toBe(false);
    expect(page.world.state.settings.sound.messages.on).toBe(true);
  });

  it('[ST-136] the checklist and the seen version are kept by the background, not by the page', async () => {
    const state = workingState();
    state.settings = { ...state.settings, onboarding: { ...state.settings.onboarding, checklistDismissed: false, lastSeenVersion: '0.4.2' } };
    const page = await mount('options', { state });
    await flush(() => button(page, 'Скрыть навсегда').click());
    expect(page.world.state.settings.onboarding.checklistDismissed).toBe(true);
    expect(page.$('.pg-check')).toBeNull();
    await flush(() => button(page, 'Что нового').click());
    expect(page.world.state.settings.onboarding.lastSeenVersion).toBe('0.4.3');
    expect(globalThis.localStorage?.length ?? 0).toBe(0);
  });
});

describe('debug pages (§9.3)', () => {
  const debugOn = () => {
    const state = workingState();
    state.settings = { ...state.settings, debug: { enabled: true, renderTrace: false } };
    return state;
  };

  it('[DB-007] the prompt page: blocks and the manifest in monospace, the cut mark, an explicit «Копировать промпт»; the token is never drawn', async () => {
    const page = await mount('debug-prompt', { state: debugOn(), token: 'prompt-token-1' });
    expect(page.$$('.pg-block__head').map((node) => node.textContent)).toEqual(['system 1 · cache write', 'user 1 · cache noneобрезано', 'Манифест контекста']);
    expect(page.$$('pre')[0]?.textContent).toBe('synthetic system block of the stand');
    expect(page.root.outerHTML).not.toContain('prompt-token-1');
    expect(page.world.browser.record.clipboard).toEqual([]);
    await flush(() => button(page, 'Копировать промпт').click());
    expect(page.world.browser.record.clipboard[0]).toContain('synthetic user block of the stand');
  });

  it('[DB-008] expired, echo off, from the cache and debug off are each explained', async () => {
    const expired = await mount('debug-prompt', { state: debugOn(), token: 'lost-token' });
    expect(expired.$('[data-pg-prompt="expired"]')?.textContent).toContain('Снимок истёк');
    expect(expired.$('pre')).toBeNull();
    unmount?.();
    // The page opened without a snapshot's token: the same words, no raw «invalid request», and nothing asked.
    const bare = await mount('debug-prompt', { state: debugOn(), token: '' });
    expect(bare.$('[data-pg-prompt="expired"]')?.textContent).toContain('Снимок истёк');
    expect(bare.text()).not.toContain('CG-UNKNOWN');
    expect(bare.world.background.requests('debug.prompt')).toEqual([]);
    unmount?.();
    const echo = await mount('debug-prompt', { state: debugOn(), token: 'prompt-no-echo' });
    expect(echo.$('[data-pg-prompt="no-echo"]')?.textContent).toContain('эхо отдаёт только окно, которое открыл владелец');
    unmount?.();
    const cached = await mount('debug-prompt', { state: debugOn(), token: 'prompt-cached' });
    expect(cached.$('[data-pg-prompt="no-echo"]')?.textContent).toContain('из кэша хаба');
    unmount?.();
    const off = await mount('debug-prompt', { token: 'prompt-token-1' });
    expect(off.$('[data-pg-prompt="debug-off"]')?.textContent).toContain('Режим отладки выключен');
    await flush(() => button(off, 'Настройки').click());
    expect(off.world.browser.record.opened).toEqual([{ page: 'options', hash: 'generation' }]);
  });

  it('[DB-007] debug switched off, or a sign-out: the prompt leaves the page at once, and so does «Копировать промпт»', async () => {
    const page = await mount('debug-prompt', { state: debugOn(), token: 'prompt-token-1' });
    expect(page.$$('pre').length).toBeGreaterThan(0);
    await flush(() => page.world.background.changeSettings({ debug: { enabled: false } }));
    expect(page.$('pre')).toBeNull();
    expect(page.$('.pg-block')).toBeNull();
    expect(page.root.textContent).not.toContain('synthetic system block');
    expect(page.$$('button').map((node) => (node.textContent ?? '').trim())).not.toContain('Копировать промпт');
    expect(page.$('[data-pg-prompt="debug-off"]')?.textContent).toContain('Режим отладки выключен');
    expect(page.world.browser.record.clipboard).toEqual([]);
    close(page);

    const out = await mount('debug-prompt', { state: debugOn(), token: 'prompt-token-1' });
    expect(out.$$('pre').length).toBeGreaterThan(0);
    await flush(() => out.world.background.setSession(null, 'sign-out'));
    expect(out.$('pre')).toBeNull();
    expect(out.root.textContent).not.toContain('synthetic system block');
    expect(out.$('[data-pg-prompt="signed-out"]')?.getAttribute('data-cg-code')).toBe('CG-AUTH-REQUIRED');
    await flush(() => button(out, 'Войти').click());
    expect(out.world.browser.record.opened).toEqual([{ page: 'options', hash: 'account:CG-AUTH-REQUIRED' }]);
  });

  it('[NF-029] the journal page: filters by level and scope, pages of records, and the count of what matches', async () => {
    const state = debugOn();
    const base = state.journals.operations?.records[0];
    if (base === undefined) throw new Error('the working state has an operations journal');
    const total = JOURNAL_PAGE_SIZE * 2 + 5;
    state.journals.operations = {
      truncated: false,
      runs: null,
      records: Array.from({ length: total }, (_, index) => ({ ...base, seq: index + 1, level: index % 10 === 0 ? 'warn' : 'info', scope: index % 2 === 0 ? 'bg.ops' : 'bg.hub', msg: `record ${String(index + 1)}` })),
    };
    const page = await mount('debug-journal', { state });
    const rows = (): number => page.$$('.pg-journal tbody tr').length;
    const pager = (): string => page.$('[data-pg-journal="pager"] [role="status"]')?.textContent ?? '';
    expect(rows()).toBe(JOURNAL_PAGE_SIZE);
    expect(pager()).toBe('Страница 1 из 3');
    expect(button(page, 'Назад').getAttribute('aria-disabled')).toBe('true');
    await flush(() => button(page, 'Вперёд').click());
    await flush(() => button(page, 'Вперёд').click());
    expect(pager()).toBe('Страница 3 из 3');
    expect(rows()).toBe(5);
    expect(button(page, 'Вперёд').getAttribute('aria-disabled')).toBe('true');

    // A filter starts from the first page and says how many records match.
    const choose = async (label: 'Уровень' | 'Область', option: string): Promise<void> => {
      // The two pickers of the filter row, in the order they stand: the level, then the scope.
      const trigger = page.$$('[data-pg-journal="filters"] button[aria-haspopup="menu"]')[label === 'Уровень' ? 0 : 1];
      await flush(() => trigger?.click());
      const item = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((node) => (node.textContent ?? '').trim() === option);
      if (item === undefined) throw new Error(`no «${option}» in the «${label}» filter`);
      await flush(() => item.click());
    };
    await choose('Уровень', 'warn');
    expect(pager()).toBe('');
    expect(rows()).toBe(Math.ceil(total / 10));
    expect(page.$$('.pg-journal tbody tr').every((entry) => entry.classList.contains('is-warn'))).toBe(true);
    expect(page.text()).toContain(`Записей: ${String(Math.ceil(total / 10))} из ${String(total)}`);
    await choose('Область', 'bg.hub');
    // Every tenth record is a warning and has an even index: none of them is in bg.hub.
    expect(rows()).toBe(0);
    expect(page.text()).toContain('Под фильтр не попала ни одна запись.');
    await choose('Уровень', 'все');
    expect(pager()).toBe('Страница 1 из 2');
    expect(page.$$('.pg-journal tbody tr td:nth-child(3)').every((cell) => cell.textContent === 'bg.hub')).toBe(true);
    // «Копировать» and «Сохранить .txt» take the journal as it was read, not the filtered page.
    await flush(() => button(page, 'Сохранить .txt').click());
    expect(page.world.browser.record.downloads[0]?.body.split('\n')).toHaveLength(total);
  });

  it('[NF-029] the journal page reads itself again while it is on screen; the switch stops that, and so does debug off', async () => {
    const page = await mount('debug-journal', { state: debugOn() });
    const reads = (): number => page.world.background.requests('journal.read').length;
    const tick = async (): Promise<void> => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(JOURNAL_REFRESH_MS);
        await settle();
      });
      await flush();
    };
    expect(reads()).toBe(1);
    expect(page.$$('.pg-journal tbody tr')).toHaveLength(2);
    const record = page.world.state.journals.operations?.records[0];
    if (record !== undefined && page.world.state.journals.operations !== undefined) {
      page.world.state.journals.operations = { ...page.world.state.journals.operations, records: [...page.world.state.journals.operations.records, { ...record, seq: 43, msg: 'operation started' }] };
    }
    await tick();
    expect(reads()).toBe(2);
    expect(page.$$('.pg-journal tbody tr')).toHaveLength(3);

    const auto = page.$$('[role="checkbox"]').find((node) => (node.textContent ?? '').includes('Обновлять автоматически'));
    expect(auto?.getAttribute('aria-checked')).toBe('true');
    await flush(() => auto?.click());
    await tick();
    await tick();
    expect(reads()).toBe(2);
    // «Обновить» is still there for a read by hand.
    await flush(() => button(page, 'Обновить').click());
    expect(reads()).toBe(3);

    await flush(() => auto?.click());
    await flush(() => page.world.background.changeSettings({ debug: { enabled: false } }));
    expect(page.$('[data-pg-journal="debug-off"]')).not.toBeNull();
    expect(page.$('.pg-journal')).toBeNull();
    // A page that shows no records asks nothing by itself — not even whether debug is back on.
    const calls = page.world.background.calls.length;
    await tick();
    await tick();
    expect(reads()).toBe(3);
    expect(page.world.background.calls).toHaveLength(calls);
  });

  it('[NF-029] after a sign-out the journal page shows no record of the last sign-in', async () => {
    const page = await mount('debug-journal', { state: debugOn() });
    expect(page.$$('.pg-journal tbody tr')).toHaveLength(2);
    await flush(() => page.world.background.setSession(null, 'sign-out'));
    expect(page.$('.pg-journal')).toBeNull();
    expect(page.$('[data-pg-journal="signed-out"]')?.getAttribute('data-cg-code')).toBe('CG-AUTH-REQUIRED');
    expect(page.$$('button').map((node) => (node.textContent ?? '').trim())).not.toContain('Копировать');
    expect(button(page, 'Сохранить .txt').getAttribute('aria-disabled')).toBe('true');
  });

  it('[NF-029] the journal page: one journal per tab, service records only, «Копировать» and «Сохранить .txt»', async () => {
    const page = await mount('debug-journal', { state: debugOn() });
    expect(page.$$('[role="tab"]').map((tab) => tab.textContent)).toEqual(['Операции', 'Вызовы хаба', 'Отправки из превью', 'Проверка «Новых»']);
    expect(page.$$('.pg-journal tbody tr')).toHaveLength(2);
    expect(page.$('.pg-journal tbody tr.is-warn')?.textContent).toContain('CG-DRAFT-CHANGED insert rejected');
    await flush(() => button(page, 'Сохранить .txt').click());
    expect(page.world.browser.record.downloads[0]?.fileName).toMatch(/^chatgoose-journal-operations-/);
    await flush(() => page.$$('[role="tab"]')[3]?.click());
    expect(page.text()).toContain('Запуски проверки');
    expect(page.text()).toContain('событий: 214');
    expect(page.text()).toContain('Записей пока нет.');
  });
});
