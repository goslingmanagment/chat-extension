// P11b: «Заметки» on the Fansly stand — the actual MV3 extension in headless Firefox, the page's MAIN, the background's
// real `fansly-api` client and pacer against the fake Fansly's own note endpoints, all on loopback (FS-NOTE-1…5,
// FX-004…FX-013). The stand's chat spans the window, so «Всегда справа» finds no free column here until a test caps it.
import type { DiagnosticsSnapshot } from '@cg/contracts/tab-messages';
import { mkdirSync } from 'node:fs';
import { $, browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';
import { WORLD } from '../../src/scenarios/hub';
import { E2E_EVIDENCE_DIR } from '../../src/stand/paths';
import { PANEL } from '../support/chat';
import { writeLocalStorage } from '../support/extension';
import { useFakeHub } from '../support/fake-hub';
import { startFanslyShift, type FanslyShift } from '../support/fansly-shift';
import { setFanslyNeighbor } from '../support/fansly-neighbor';
import { FANSLY_MAIN, callFansly, fakeFansly } from '../support/fansly-stand';
import { useNetworkTrap } from '../support/network-trap';
import { ours, oursExists, readOurs } from '../support/ours';
import { dockIs } from '../support/shift';

const A = WORLD.fansly.chats.a;
const B = WORLD.fansly.chats.b;
const SLOT = '[data-header-order="20"]';
/** Never anywhere but between the panel and the background (FS-NOTE-5). */
const SECRET = 'zebra-quartz-7731';

const button = () => $(SLOT).shadow$('.cg-nb__button');
const shown = () => oursExists('panel', '.cg-notes');
const body = () => readOurs('panel', '.cg-notes', (node) => node.getAttribute('data-notes-body'));
const waitBody = (state: string) => browser.waitUntil(async () => (await body()) === state, { timeout: 20_000, timeoutMsg: `notes did not become ${state}` });
const waitShown = (on: boolean) => browser.waitUntil(async () => (await shown()) === on, { timeout: 15_000, timeoutMsg: `notes panel did not ${on ? 'open' : 'close'}` });
const routes = async (since: number) => (await fakeFansly().calls('ours', since)).filter((call) => call.kind === 'http').map((call) => call.route);
const noteIds = async () => (await readOurs('panel', '.cg-notes__list', (node) => [...node.querySelectorAll('[data-note-id]')].map((item) => item.getAttribute('data-note-id')))) ?? [];
const pressIn = async (selector: string, text: string) => {
  const items = await $('[data-host="overlay"][data-layer="panel"]').shadow$$(selector).getElements();
  for (const item of items) if ((await item.getText()).trim() === text) return item.click();
  throw new Error(`no «${text}» in ${selector}`);
};
const type = async (selector: string, text: string) => {
  await ours('panel', selector).click();
  await browser.keys(text.split(''));
};

describe('Fansly «Заметки» (R20 P11b)', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let shift: FanslyShift;
  let mark = 0;
  before(async () => {
    await setFanslyNeighbor(null);
    await fakeFansly().command({ op: 'reset' });
    await fakeFansly().command({ op: 'note', fanId: A.fan, title: 'Hobbies', note: 'Plays chess' });
    await fakeFansly().command({ op: 'note', fanId: A.fan, title: 'FBuddy Notes', note: 'fb profile' });
    await fakeFansly().command({ op: 'note', fanId: A.fan, title: 'Custom Username', note: 'Алекс', contentType: 12002 });
    shift = await startFanslyShift(hub(), { path: `/messages/${A.group}`, viewport: { width: 1180, height: 850 } });
    await dockIs((d) => d.status === 'ready' && d.target?.endsWith(`:${A.fan}`) === true, 'known fan', 20_000);
    await shift.toPages();
    await writeLocalStorage({ 'dev.fanslyApi.origin': fakeFansly().apiOrigin });
    await shift.toFansly();
    await browser.waitUntil(() => $(SLOT).isExisting(), { timeout: 20_000, timeoutMsg: 'no «Заметки» in the header' });
    mark = await fakeFansly().mark();
  });
  after(async () => {
    try {
      await fakeFansly().assertOursClean(mark, 'P11b');
    } finally {
      await fakeFansly().command({ op: 'reset' });
    }
  });

  it('[FX-004] [FS-NOTE-1] the button follows «Регистрация» in the header row; «Справа по кнопке» reads nothing before it opens', async () => {
    expect(
      await browser.execute((selector) => {
        const host = document.querySelector(selector);
        return host?.parentElement?.classList.contains('content-header-sub-row') === true && host.previousElementSibling?.getAttribute('data-header-order') === '10';
      }, SLOT),
    ).toBe(true);
    expect(await shown()).toBe(false);
    await browser.pause(1000);
    expect(await routes(mark)).toEqual([]);
  });

  it('[FX-005] [FX-010] [FS-NOTE-1] [FS-NOTE-3] ⌘⇧K in the composer opens and closes the panel: one read, kept until «Обновить»; FBuddy’s note is read only', async () => {
    const before = await fakeFansly().mark();
    await $(FANSLY_MAIN.field).click();
    await browser.keys([...PANEL, 'k']);
    await waitBody('ready');
    expect(await routes(before)).toEqual(['account.byIds']);
    expect(await $(SLOT).shadow$('.cg-nb__count').getText()).toBe('2');
    expect(await readOurs('panel', '[data-notes-name]', (node) => (node as HTMLInputElement).value)).toBe('Алекс');
    const foreign = await readOurs('panel', '[data-foreign="true"]', (node) => ({ buttons: node.querySelectorAll('button').length, text: node.textContent ?? '' }));
    expect(foreign?.buttons).toBe(0);
    expect(foreign?.text).toContain('FBuddy Notes');
    await $(FANSLY_MAIN.field).click();
    await browser.keys([...PANEL, 'k']);
    await waitShown(false);
    await button().click();
    await waitBody('ready');
    expect(await routes(before)).toEqual(['account.byIds']);
    await ours('panel', 'button[aria-label="Обновить"]').click();
    await browser.waitUntil(async () => (await routes(before)).length === 2, { timeout: 15_000 });
    expect(await routes(before)).toEqual(['account.byIds', 'account.byIds']);
  });

  it('[FX-006] [FX-007] [FX-011] [FS-NOTE-2] [FS-NOTE-4] the name, a note created, edited and deleted — Fansly’s own calls, one each, only by the person’s action', async () => {
    await waitBody('ready');
    const before = await fakeFansly().mark();
    const name = ours('panel', '[data-notes-name]');
    await name.click();
    await browser.keys([Key.End, ...' Р'.split(''), Key.Enter]);
    await browser.waitUntil(async () => (await readOurs('panel', '.cg-notes__hint', (node) => node.getAttribute('data-status'))) === 'saved', { timeout: 15_000 });
    expect(await routes(before)).toEqual(['notes.edit']);

    await pressIn('.cg-notes__foot button', '+ Заметка');
    await type('[data-notes-editor="new"] input', 'Plan');
    await type('[data-notes-editor="new"] textarea', `call ${SECRET}`);
    await ours('panel', '[data-notes-save]').click();
    await browser.waitUntil(async () => (await noteIds()).length === 3, { timeout: 15_000, timeoutMsg: 'the new note is not listed' });
    const created = (await noteIds())[2] as string;
    expect(await routes(before)).toEqual(['notes.edit', 'notes.create']);

    await pressIn(`[data-note-id="${created}"] button`, 'Изменить');
    await type(`[data-notes-editor="${created}"] textarea`, '!');
    await ours('panel', '[data-notes-save]').click();
    await browser.waitUntil(async () => !(await oursExists('panel', '[data-notes-editor]')), { timeout: 15_000 });
    expect(await routes(before)).toEqual(['notes.edit', 'notes.create', 'notes.edit']);

    await pressIn(`[data-note-id="${created}"] button`, 'Удалить');
    expect(await oursExists('panel', '[data-notes-confirm]')).toBe(true);
    expect(await routes(before)).toEqual(['notes.edit', 'notes.create', 'notes.edit']);
    await pressIn('[data-notes-confirm] button', 'Удалить');
    await browser.waitUntil(async () => (await noteIds()).length === 2, { timeout: 15_000 });
    expect(await routes(before)).toEqual(['notes.edit', 'notes.create', 'notes.edit', 'notes.delete']);
  });

  it('[FX-013] [FS-NOTE-5] a note’s text reaches neither the hub nor the tab’s diagnostics', async () => {
    const journal = JSON.stringify(await hub().journal(0));
    expect(journal).not.toContain(SECRET);
    const diagnostics = await shift.rpc<DiagnosticsSnapshot>('diagnostics.get');
    expect(diagnostics.ok).toBe(true);
    expect(JSON.stringify(diagnostics)).not.toContain(SECRET);
  });

  it('[FX-012] [FS-NOTE-2] a draft is the fan’s: another chat in the middle of an edit loses nothing', async () => {
    await pressIn('.cg-notes__foot button', '+ Заметка');
    await type('[data-notes-editor="new"] textarea', 'half typed');
    await callFansly('open', B.group, 'router');
    await browser.waitUntil(async () => !(await oursExists('panel', '[data-notes-editor]')) && (await body()) === 'ready', { timeout: 15_000, timeoutMsg: 'B’s notes without A’s draft' });
    await callFansly('open', A.group, 'router');
    await browser.waitUntil(async () => (await readOurs('panel', '[data-notes-editor="new"] textarea', (node) => (node as HTMLTextAreaElement).value)) === 'half typed', { timeout: 15_000, timeoutMsg: 'A’s draft is lost' });
    await pressIn('.cg-notes__foot button', 'Отмена');
  });

  it('[FX-009] [FS-NOTE-2] the panel over the chat in both of Fansly’s themes; «Окно по центру» belongs to its chat; the view is the same in a reloaded tab', async () => {
    await waitBody('ready');
    expect(await readOurs('panel', '.cg-notes', (node) => node.getAttribute('data-notes-place'))).toBe('over');
    mkdirSync(E2E_EVIDENCE_DIR, { recursive: true });
    for (const theme of ['bright', 'dark'] as const) {
      await callFansly('setTheme', theme);
      await browser.waitUntil(async () => (await $(SLOT).getAttribute('data-scheme')) === (theme === 'bright' ? 'light' : 'dark'));
      await browser.saveScreenshot(`${E2E_EVIDENCE_DIR}/suite-fansly-notes-${theme}.png`);
    }
    await ours('panel', 'select.cg-notes__view').selectByAttribute('value', 'center');
    await browser.waitUntil(async () => (await readOurs('panel', '.cg-notes', (node) => node.classList.contains('is-center'))) === true, { timeout: 10_000 });
    await callFansly('open', B.group, 'router');
    await waitShown(false);
    await browser.refresh();
    await browser.waitUntil(() => $(SLOT).isExisting(), { timeout: 20_000 });
    // The stored view comes with the chunk's first answer of the background.
    await browser.pause(1000);
    await button().click();
    await browser.waitUntil(async () => (await readOurs('panel', '.cg-notes', (node) => node.getAttribute('data-notes-view'))) === 'center', { timeout: 15_000 });
    await browser.keys([Key.Escape]);
    await waitShown(false);
  });

  it('[FX-009] [FX-010] [FS-NOTE-3] «Всегда справа» stands in a free column beside every chat and reads it; without one it opens over the chat by the button', async () => {
    await button().click();
    await waitShown(true);
    // No free column on the stand: open over the chat, with the reason; Esc puts it away, the button brings it back.
    await ours('panel', 'select.cg-notes__view').selectByAttribute('value', 'docked');
    await browser.waitUntil(async () => (await readOurs('panel', '.cg-notes', (node) => [node.getAttribute('data-notes-place'), node.textContent?.includes('мало места') === true].join())) === 'over,true', { timeout: 10_000 });
    await browser.keys([Key.Escape]);
    await waitShown(false);
    await button().click();
    await waitShown(true);
    await browser.keys([Key.Escape]);
    await waitShown(false);
    // A capped chat leaves a column: the panel stands there by itself, and reads the chat it goes to after 0.7 s on it.
    await browser.execute(() => {
      const style = document.createElement('style');
      style.textContent = 'app-messages-route { max-width: 1000px; }';
      document.head.append(style);
    });
    await browser.setWindowSize(1500, 900);
    await waitShown(true);
    const before = await fakeFansly().mark();
    await callFansly('open', A.group, 'router');
    await browser.waitUntil(async () => (await readOurs('panel', '.cg-notes', (node) => [node.getAttribute('data-notes-place'), node.getAttribute('data-notes-body')].join())) === 'docked,ready', { timeout: 15_000 });
    expect(await routes(before)).toEqual(['account.byIds']);
  });

  it('[FX-010] [FS-NOTE-3] a 429 is not asked again by itself; during the cooldown «Повторить» sends nothing', async () => {
    await browser.setWindowSize(1180, 850);
    await browser.refresh();
    await browser.waitUntil(() => $(SLOT).isExisting(), { timeout: 20_000 });
    const before = await fakeFansly().mark();
    await fakeFansly().command({ op: 'api', rules: [{ route: 'account.byIds', caller: 'ours', times: 1, outcome: { kind: 'status', status: 429, retryAfterS: 60 } }] });
    await button().click();
    await waitBody('error');
    expect((await fakeFansly().calls('ours', before)).filter((call) => call.kind === 'http').map((call) => call.status)).toEqual([429]);
    await pressIn('.cg-notes__error button', 'Повторить');
    await browser.pause(1500);
    await waitBody('error');
    expect(await routes(before)).toEqual(['account.byIds']);
    const status = await shift.rpc<DiagnosticsSnapshot>('diagnostics.get');
    expect(status.ok).toBe(true);
  });
});
