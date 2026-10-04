// The extension's own pages in e2e — the settings with its sign-in screen and
// the popup (docs/pages.md; ui/pages over core's pages controller, wired in
// apps/extension/src/composition/pages.ts). They are plain documents of the
// extension, so WebDriver reads and drives them directly: what is on screen
// is read from the DOM the person sees, and every press is a real pointer
// click — the browser's «inside a user gesture» checks (host access, the
// consent, the clipboard) run as they do for a person.

import { mkdirSync, writeFileSync } from 'node:fs';

import { browser, $ } from '@wdio/globals';

import { E2E_EVIDENCE_DIR } from '../../src/stand/paths';
import { testBuildPage } from './fake-hub';

export interface StatusRow {
  readonly level: string;
  readonly text: string;
  /** The label of the row's one button; null — none. */
  readonly action: string | null;
}

export interface ChecklistStep {
  readonly id: string;
  readonly done: boolean;
  readonly action: string | null;
}

export interface OptionsState {
  /** The page drew its shell: the sign-in screen or a section (not only a spinner or an error card). */
  readonly drawn: boolean;
  /** The sign-in screen stands instead of the settings (ST-011). */
  readonly gate: boolean;
  readonly section: string | null;
  readonly loading: boolean;
  readonly title: string;
  /** Codes of everything on screen that carries one: plates, error cards, toasts, the save state. */
  readonly codes: readonly string[];
  /** The save state next to the title: `saving`, `saved` (with the background's revision), `failed` (with its code). */
  readonly save: { readonly state: string; readonly revision: number | null; readonly code: string | null } | null;
  /** The plate of a deep link (ST-008). */
  readonly plate: string | null;
  /** What is highlighted now (ST-009): the anchors of the elements that carry the highlight. */
  readonly targets: readonly string[];
  readonly rows: Readonly<Record<string, StatusRow>>;
  readonly readiness: string | null;
  /** «Доступ к хабу»: `granted`, `missing`, `unknown`. */
  readonly access: string | null;
  readonly checklist: readonly ChecklistStep[];
  /** The address in «Дополнительно» of the sign-in screen, or the one «Аккаунт» shows. */
  readonly hubAddress: string | null;
  readonly text: string;
  readonly scheme: string | null;
  readonly lang: string;
  readonly documentTitle: string;
}

/**
 * The functions below are sent to the page as text. The e2e's transpiler wraps a named function inside them
 * in its `__name(...)` helper, and WebdriverIO's own shim for it does not reach `moz-extension:` documents —
 * so the page gets one before anything is read from it.
 */
export async function ensureNameShim(): Promise<void> {
  await browser.execute('if (typeof globalThis.__name !== "function") globalThis.__name = function (value) { return value; };');
}

export async function readOptions(): Promise<OptionsState> {
  await ensureNameShim();
  return browser.execute(() => {
    const page = document.querySelector('.pg-page');
    const clean = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim();
    const save = document.querySelector('[data-pg-save]');
    const revision = save?.getAttribute('data-pg-revision') ?? null;
    const rows: Record<string, { level: string; text: string; action: string | null }> = {};
    for (const row of document.querySelectorAll('[data-pg-row]')) {
      rows[row.getAttribute('data-pg-row') ?? ''] = {
        level: row.getAttribute('data-pg-level') ?? '',
        text: clean(row.querySelector('.pg-row__v')?.textContent),
        action: row.querySelector('.pg-row__a button') === null ? null : clean(row.querySelector('.pg-row__a button')?.textContent),
      };
    }
    const address = document.querySelector<HTMLInputElement>('[data-pg-anchor="hub-address"] input');
    return {
      drawn: page !== null && (page.hasAttribute('data-pg-gate') ? page.querySelector('.pg-signin') !== null : page.querySelector('main h1') !== null),
      gate: page?.hasAttribute('data-pg-gate') ?? false,
      section: page?.getAttribute('data-pg-section') ?? null,
      loading: document.querySelector('.cg-state--loading') !== null,
      title: clean(document.querySelector('main h1')?.textContent),
      codes: [...document.querySelectorAll('[data-cg-code]')].map((node) => node.getAttribute('data-cg-code') ?? ''),
      save: save === null ? null : { state: save.getAttribute('data-pg-save') ?? '', revision: revision === null ? null : Number(revision), code: save.getAttribute('data-cg-code') },
      plate: document.querySelector('[data-pg-plate]')?.getAttribute('data-pg-plate') ?? null,
      targets: [...document.querySelectorAll('.is-target[data-pg-anchor]')].map((node) => node.getAttribute('data-pg-anchor') ?? ''),
      rows,
      readiness: document.querySelector('[data-pg-readiness]')?.getAttribute('data-pg-readiness') ?? null,
      access: document.querySelector('[data-pg-access]')?.getAttribute('data-pg-access') ?? null,
      checklist: [...document.querySelectorAll('.pg-check__item')].map((item) => ({
        id: item.getAttribute('data-pg-step') ?? '',
        done: item.classList.contains('is-done'),
        action: item.querySelector('button') === null ? null : clean(item.querySelector('button')?.textContent),
      })),
      hubAddress: address !== null ? address.value : clean(document.querySelector('[data-pg-anchor="hub-address"] .pg-value')?.textContent) || null,
      text: clean(document.querySelector('#app')?.textContent),
      scheme: document.documentElement.getAttribute('data-cg-scheme'),
      lang: document.documentElement.lang,
      documentTitle: document.title,
    };
  });
}

export async function waitForOptions(predicate: (state: OptionsState) => boolean, message: string, timeout = 15_000): Promise<OptionsState> {
  let last: OptionsState | null = null;
  try {
    await browser.waitUntil(
      async () => {
        last = await readOptions();
        return last.drawn && predicate(last);
      },
      { timeout, interval: 100 },
    );
  } catch {
    const shown = last as OptionsState | null;
    throw new Error(`${message}: not reached in ${timeout} ms; the settings page shows ${JSON.stringify(shown === null ? null : { ...shown, text: shown.text.slice(0, 400) })}`);
  }
  return last as unknown as OptionsState;
}

/**
 * Opens the settings page of the TEST build at a hash (`account`, `status:CG-QUOTA-DAILY`) as a new document
 * and waits until it drew the sign-in screen or a section.
 */
export async function openOptions(hash = ''): Promise<OptionsState> {
  // A hash-only change would keep the document and its state.
  await browser.url('about:blank');
  await browser.url(testBuildPage(`options.html${hash === '' ? '' : `#${hash}`}`));
  return waitForOptions(() => true, 'the settings page');
}

/** A pointer click on the first button or link whose words start with `label` (or whose accessible name is it), inside `scope`. */
export async function press(label: string, scope = '#app'): Promise<void> {
  const mark = `e2e-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`;
  await ensureNameShim();
  const found = await browser.execute(
    (scopeSelector: string, wanted: string, id: string) => {
      const clean = (value: string | null): string => (value ?? '').replace(/\s+/g, ' ').trim();
      const root = document.querySelector(scopeSelector);
      const node = [...(root?.querySelectorAll<HTMLElement>('button, a, summary, [role="checkbox"], [role="radio"], [role="menuitemradio"], [role="menuitem"]') ?? [])].find(
        (candidate) => candidate.getAttribute('aria-label') === wanted || clean(candidate.textContent).startsWith(wanted),
      );
      if (node === undefined) return false;
      node.setAttribute('data-e2e-press', id);
      return true;
    },
    scope,
    label,
    mark,
  );
  if (!found) throw new Error(`nothing to press named «${label}» inside ${scope}`);
  const target = $(`[data-e2e-press="${mark}"]`);
  await target.scrollIntoView({ block: 'center' });
  await target.click();
  await browser.execute((id: string) => document.querySelector(`[data-e2e-press="${id}"]`)?.removeAttribute('data-e2e-press'), mark);
}

/** Answers the page's confirmation dialog («Выйти?», «Очистить локальные данные?»). */
export async function confirmDialog(answer: 'confirm' | 'cancel' = 'confirm'): Promise<void> {
  const button = $(answer === 'confirm' ? '.cg-confirm-dlg .cg-confirm-dlg__go' : '.cg-confirm-dlg__acts button:not(.cg-confirm-dlg__go)');
  await button.waitForExist({ timeout: 5000 });
  await button.click();
}

/** Fills the sign-in form — on the sign-in screen or under «Войти заново» — and submits it. The password is typed, never stored by the page. */
export async function submitSignIn(login: string, password: string): Promise<void> {
  const form = $('form.pg-form');
  await form.waitForExist({ timeout: 10_000 });
  await form.$('input[autocomplete="username"]').setValue(login);
  await form.$('input[type="password"]').setValue(password);
  await form.$('.pg-form__acts button').click();
}

/** «Дополнительно» of the sign-in screen → the hub address → «Сохранить»: real clicks, so the browser's host-access request runs inside a gesture (ST-042, ST-046). */
export async function saveHubAddress(origin: string): Promise<void> {
  const details = $('details[data-pg-anchor="hub-address"]');
  await details.waitForExist({ timeout: 10_000 });
  if ((await details.getAttribute('open')) === null) await details.$('summary').click();
  const field = details.$('input');
  await field.click();
  // The field keeps what was typed: select it all, then type over it.
  await browser.execute(() => document.querySelector<HTMLInputElement>('details[data-pg-anchor="hub-address"] input')?.select());
  await field.addValue(origin);
  await details.$('.pg-line button').click();
}

/** «Аккаунт» → «Выйти» → the confirmation. */
export async function signOutFromAccount(): Promise<void> {
  await openOptions('account');
  await waitForOptions((state) => state.section === 'account' && state.text.includes('Вы вошли как'), 'the account section of a signed-in person');
  await press('Выйти');
  await confirmDialog();
}

/** Assigns the hub page its persona on «Персоны»: the picker of the page's row, then the persona by its name (ST-061). */
export async function choosePersona(pageName: string, personaLabel: string): Promise<void> {
  await openOptions('personas');
  await waitForOptions((state) => state.section === 'personas' && state.text.includes(pageName), `the page «${pageName}» on «Персоны»`);
  await ensureNameShim();
  const row = await browser.execute((name: string) => {
    const item = [...document.querySelectorAll('[data-pg-page]')].find((node) => (node.querySelector('b')?.textContent ?? '').trim() === name);
    return item?.getAttribute('data-pg-page') ?? null;
  }, pageName);
  if (row === null) throw new Error(`«Персоны» lists no page «${pageName}»`);
  await $(`[data-pg-page="${row}"] button.pg-pick`).click();
  await press(personaLabel, 'body');
}

export interface PopupState {
  readonly drawn: boolean;
  /** `loading`, `error`, `forbidden` (nobody signed in) or `ready` (the pills and the rows are drawn). */
  readonly view: string;
  readonly codes: readonly string[];
  readonly pills: readonly string[];
  /** The four buttons by their words: whether each can be pressed. */
  readonly buttons: Readonly<Record<string, boolean>>;
  readonly persona: string;
  readonly login: string | null;
  readonly dialog: string;
  readonly quota: string;
  readonly version: string;
  readonly text: string;
  readonly spinners: number;
  readonly width: number;
}

export async function readPopup(): Promise<PopupState> {
  await ensureNameShim();
  return browser.execute(() => {
    const clean = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim();
    const popup = document.querySelector('.pg-popup');
    const sections = [...(popup?.querySelectorAll('.pg-popup__sec') ?? [])];
    const line = (index: number): string => clean(sections.filter((section) => section.querySelector('.pg-popup__cap') !== null)[index]?.querySelector('.pg-popup__line')?.textContent);
    const account = sections.find((section) => section.querySelector('.pg-popup__line button.cg-btn') !== null && section.querySelector('.pg-popup__copy') === null) ?? null;
    const state = popup?.querySelector('.pg-popup__state') ?? null;
    const view =
      popup === null
        ? 'none'
        : popup.querySelector('.cg-state--loading') !== null
          ? 'loading'
          : state !== null
            ? // «Нужно войти» is a state, not a failure: its card is not an alert (and the lead under it stands only for the other reasons).
              state.querySelector('.pg-popup__lead') !== null || state.querySelector('.cg-card:not([role="alert"])') !== null
              ? 'forbidden'
              : 'error'
            : popup.querySelector('.pg-pills') !== null
              ? 'ready'
              : 'none';
    const buttons: Record<string, boolean> = {};
    for (const button of popup?.querySelectorAll('.pg-popup__btns .cg-btn') ?? []) {
      // The words of the button itself, without its count or its key.
      const words = clean([...button.childNodes].find((node) => node.nodeType === Node.TEXT_NODE || (node instanceof HTMLElement && !node.matches('.pg-popup__count, .pg-popup__key, kbd')))?.textContent);
      buttons[words] = button.getAttribute('aria-disabled') !== 'true';
    }
    return {
      drawn: popup !== null && view !== 'none' && view !== 'loading',
      view,
      codes: [...(popup?.querySelectorAll('[data-cg-code]') ?? [])].map((node) => node.getAttribute('data-cg-code') ?? ''),
      pills: [...(popup?.querySelectorAll('.pg-pill') ?? [])].map((pill) => clean(pill.textContent)),
      buttons,
      persona: line(0),
      login: account === null ? null : clean(account.querySelector('.pg-popup__line b')?.textContent),
      dialog: clean(sections.find((section) => section.querySelector('.pg-popup__copy') !== null || section.querySelector('.pg-popup__line b.pg-muted') !== null)?.querySelector('.pg-popup__line')?.textContent),
      quota: clean(sections.at(-1)?.querySelector('.pg-popup__line')?.textContent),
      version: clean(popup?.querySelector('.pg-popup__ver')?.textContent),
      text: clean(popup?.textContent),
      spinners: popup?.querySelectorAll('.cg-spin').length ?? 0,
      width: popup?.getBoundingClientRect().width ?? 0,
    };
  });
}

export async function waitForPopup(predicate: (state: PopupState) => boolean, message: string, timeout = 15_000): Promise<PopupState> {
  let last: PopupState | null = null;
  try {
    await browser.waitUntil(
      async () => {
        last = await readPopup();
        return last.drawn && predicate(last);
      },
      { timeout, interval: 100 },
    );
  } catch {
    throw new Error(`${message}: not reached in ${timeout} ms; the popup shows ${JSON.stringify(last)}`);
  }
  return last as unknown as PopupState;
}

/** Opens the popup's document in the tab the browser is on (the toolbar's own frame is not reachable for WebDriver). */
export async function openPopup(): Promise<PopupState> {
  await browser.url('about:blank');
  await browser.url(testBuildPage('popup.html'));
  return waitForPopup(() => true, 'the popup');
}

/**
 * A picture of the page as it is, into .cache/e2e/ — to look at with one's own eyes. WebDriver Classic's
 * screenshot: BiDi's refuses `moz-extension:` documents («browsing contexts in privileged scope»).
 */
export async function capturePage(name: string): Promise<string> {
  mkdirSync(E2E_EVIDENCE_DIR, { recursive: true });
  const shot = await (browser as unknown as { takeScreenshot(): Promise<string> }).takeScreenshot();
  const path = `${E2E_EVIDENCE_DIR}${name}.png`;
  writeFileSync(path, Buffer.from(shot, 'base64'));
  return path;
}
