// P11b, P11b2, P11c: «Заметки» on the Fansly stand (P11b2 — as in the Fansly extension 2.11–2.13: dates, the fill on
// the questionnaire being read, the fan's words, the month, the fields the hub names) — the actual MV3 extension in headless Firefox, the page's MAIN, the
// background's real `fansly-api` client and pacer against the fake Fansly's own note endpoints, all on loopback
// (FS-NOTE-1…6, FX-004…FX-016); «✨ Заполнить из чата» through the shared admission against the fake hub, which checks
// the body by the vendored SDK's schema and the hub's own rules (`fake-hub/ai-rules.ts`). The stand's chat spans the window, so «Всегда справа» finds no free column here until a test caps it.
import type { DiagnosticsSnapshot } from '@cg/contracts/tab-messages';
import { mkdirSync } from 'node:fs';
import { $, browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';
import { callsTo } from '../../src/fake-hub/journal';
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
/** The questionnaire as the Fansly extension 2.11–2.12 stores it (R20 P11b2): the text both clients read and write. */
const LABELS = ['Имя', 'Локация', 'Возраст', 'Работа', 'График', 'Хобби', 'Планы и даты', 'Фетиши', 'Характеристика', 'Медиа', 'Другое'];
const TEMPLATE = LABELS.map((label) => `${label}: `).join('\n');
/** One its 2.10 left: eight entries, a stamped month, a line written under a field, a line after a blank one. */
const OLD = 'Имя: Wayne\nЛокация: Флорида (08.2026)\nВозраст: \nРабота: медбрат\nХобби: \nФетиши: \nХарактеристика: депрессивный чел\nнужно поддерживать вайб\nМедиа: \n\nпросил кастом';

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
const value = (selector: string) => readOurs('panel', selector, (node) => (node as HTMLTextAreaElement).value);
const fieldRows = (selector: string) => readOurs('panel', selector, (node) => [...node.querySelectorAll('[data-notes-field]')].map((item) => item.getAttribute('data-notes-field')));
/** What the fake hub's `fan-notes-fill` writes for every label in its merge mode (fake-hub/ai.ts `NOTES_FILL_FAKE`):
 * the fact, the fan's words under it, «График» with the month, and one field it names itself. */
const FACT = 'Synthetic fact from the chat.';
const QUOTE = (label: string) => `my ${label}, in synthetic words`;
const NAMED = 'Питомцы';
/** What a fill of `OLD` asks: its labels in note order, then the template's it lacks. */
const ASKED = ['Имя', 'Локация', 'Возраст', 'Работа', 'Хобби', 'Фетиши', 'Характеристика', 'Медиа', 'График', 'Планы и даты', 'Другое'];
const tableLabels = (selector: string) => readOurs('panel', selector, (node) => [...node.querySelectorAll('dt')].map((item) => item.textContent));
const quotesUnder = (selector: string) => readOurs('panel', selector, (node) => [...node.querySelectorAll(':scope > .cg-notes__cell > [data-notes-quotes] li')].map((item) => item.textContent));

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

  it('[FX-004] [FS-NOTE-1] the button follows «Регистрация» in the header row, beside it, not over it; «Справа по кнопке» reads nothing before it opens', async () => {
    expect(
      await browser.execute((selector) => {
        const host = document.querySelector(selector);
        return host?.parentElement?.classList.contains('content-header-sub-row') === true && host.previousElementSibling?.getAttribute('data-header-order') === '10';
      }, SLOT),
    ).toBe(true);
    // Each slot is as wide as its words: the middle of «Регистрация» is «Регистрация»'s, not «Заметки»'s drawn over it
    // (WebDriver's own check of a click does not look across shadow roots).
    expect(
      await browser.execute(() =>
        [...document.querySelectorAll('[data-header-order]')].map((host) => {
          const box = host.getBoundingClientRect();
          return box.width > 0 && document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === host;
        }),
      ),
    ).toEqual([true, true]);
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
    // Every write of an existing note or of the name reads the fan's notes again first (a stale write is refused).
    expect(await routes(before)).toEqual(['account.byIds', 'notes.edit']);

    await pressIn('.cg-notes__foot button', '+ Заметка');
    await type('[data-notes-editor="new"] input', 'Plan');
    await type('[data-notes-editor="new"] textarea', `call ${SECRET}`);
    await ours('panel', '[data-notes-save]').click();
    await browser.waitUntil(async () => (await noteIds()).length === 3, { timeout: 15_000, timeoutMsg: 'the new note is not listed' });
    const created = (await noteIds())[2] as string;
    expect(await routes(before)).toEqual(['account.byIds', 'notes.edit', 'notes.create']);

    await pressIn(`[data-note-id="${created}"] button`, 'Изменить');
    await type(`[data-notes-editor="${created}"] textarea`, '!');
    await ours('panel', '[data-notes-save]').click();
    await browser.waitUntil(async () => !(await oursExists('panel', '[data-notes-editor]')), { timeout: 15_000 });
    expect(await routes(before)).toEqual(['account.byIds', 'notes.edit', 'notes.create', 'account.byIds', 'notes.edit']);

    await pressIn(`[data-note-id="${created}"] button`, 'Удалить');
    expect(await oursExists('panel', '[data-notes-confirm]')).toBe(true);
    expect(await routes(before)).toEqual(['account.byIds', 'notes.edit', 'notes.create', 'account.byIds', 'notes.edit']);
    await pressIn('[data-notes-confirm] button', 'Удалить');
    await browser.waitUntil(async () => (await noteIds()).length === 2, { timeout: 15_000 });
    expect(await routes(before)).toEqual(['account.byIds', 'notes.edit', 'notes.create', 'account.byIds', 'notes.edit', 'notes.delete']);
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

  it('[FX-019] [FS-NOTE-2] every free note shows when it was created — the day, the year outside this one, the full time on hover; the questionnaire does not (R20 P11b2, decision 171)', async () => {
    await waitBody('ready');
    const lastYear = new Date(new Date().getFullYear() - 1, 2, 4, 8, 5).getTime();
    await fakeFansly().command({ op: 'note', fanId: A.fan, title: '', note: 'old one', createdAt: lastYear });
    await ours('panel', 'button[aria-label="Обновить"]').click();
    await browser.waitUntil(async () => (await noteIds()).length === 3, { timeout: 15_000, timeoutMsg: 'the dated note is not read' });
    const [hobbies, , old] = await noteIds();
    const date = (id: string | null | undefined) => readOurs('panel', `[data-note-id="${String(id)}"] [data-notes-date]`, (node) => [node.textContent, node.getAttribute('title'), node.previousElementSibling?.textContent ?? null]);
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(await date(hobbies)).toEqual([`${pad(today.getDate())}.${pad(today.getMonth() + 1)}`, expect.stringMatching(new RegExp(`^Создана ${pad(today.getDate())}\\.${pad(today.getMonth() + 1)}\\.${String(today.getFullYear())} в \\d{2}:\\d{2}$`)), 'Hobbies']);
    // Untitled: the date alone heads it.
    expect(await date(old)).toEqual([`04.03.${String(today.getFullYear() - 1)}`, `Создана 04.03.${String(today.getFullYear() - 1)} в 08:05`, null]);
    await pressIn(`[data-note-id="${String(old)}"] button`, 'Удалить');
    await pressIn('[data-notes-confirm] button', 'Удалить');
    await browser.waitUntil(async () => (await noteIds()).length === 2, { timeout: 15_000 });
  });

  it('[FX-008] [FX-011] [FX-021] [FS-NOTE-2] the questionnaire: eleven fields typed one by one, «Текстом» the text Fansly keeps; an old one read as a table and edited field by field, its other lines as they were (R20 P11b2)', async () => {
    await waitBody('ready');
    const before = await fakeFansly().mark();
    await pressIn('.cg-notes__foot button', '+ Анкета');
    const editor = '[data-notes-editor="new"]';
    expect(await fieldRows(editor)).toEqual(LABELS);
    await type(`${editor} [data-notes-field="Имя"] textarea`, 'Alex');
    await type(`${editor} [data-notes-field="График"] textarea`, 'nights');
    await browser.keys([Key.Enter, ...'weekends'.split('')]);
    expect(await value(`${editor} [data-notes-field="График"] textarea`)).toBe('nights\nweekends');
    await pressIn(`${editor} button`, 'Текстом');
    const typed = TEMPLATE.replace('Имя: ', 'Имя: Alex').replace('График: ', 'График: nights; weekends');
    expect(await value(`${editor} textarea`)).toBe(typed);
    await pressIn(`${editor} button`, 'Полями');
    mkdirSync(E2E_EVIDENCE_DIR, { recursive: true });
    for (const theme of ['bright', 'dark'] as const) {
      await callFansly('setTheme', theme);
      await browser.waitUntil(async () => (await $(SLOT).getAttribute('data-scheme')) === (theme === 'bright' ? 'light' : 'dark'));
      await browser.saveScreenshot(`${E2E_EVIDENCE_DIR}/suite-fansly-notes-form-${theme}.png`);
    }
    await ours('panel', '[data-notes-save]').click();
    await browser.waitUntil(async () => (await noteIds()).length === 3, { timeout: 15_000, timeoutMsg: 'the questionnaire is not listed' });
    expect(await routes(before)).toEqual(['notes.create']);
    const created = (await noteIds())[2] as string;
    expect(await tableLabels(`[data-note-id="${created}"] [data-notes-form]`)).toEqual(['Имя', 'График']);
    expect(await oursExists('panel', `[data-note-id="${created}"] [data-notes-date]`)).toBe(false);
    expect(await readOurs('panel', '.cg-notes__foot', (node) => node.textContent ?? '')).not.toContain('+ Анкета');

    // What the old extension wrote: read as a table, one field edited, every other line kept byte for byte.
    await fakeFansly().command({ op: 'note', fanId: A.fan, title: 'Анкета', note: OLD });
    await ours('panel', 'button[aria-label="Обновить"]').click();
    await browser.waitUntil(async () => (await noteIds()).length === 4, { timeout: 15_000, timeoutMsg: 'the old questionnaire is not read' });
    const old = (await noteIds())[3] as string;
    expect(await tableLabels(`[data-note-id="${old}"] [data-notes-form]`)).toEqual(['Имя', 'Локация', 'Работа', 'Характеристика']);
    await pressIn(`[data-note-id="${old}"] button`, 'Изменить');
    await ours('panel', `[data-notes-editor="${old}"] [data-notes-field="Работа"] textarea`).click();
    await browser.keys([Key.End, Key.Enter, ...'nights'.split('')]);
    const since = await fakeFansly().mark();
    await ours('panel', '[data-notes-save]').click();
    await browser.waitUntil(async () => !(await oursExists('panel', '[data-notes-editor]')), { timeout: 15_000 });
    expect(await routes(since)).toEqual(['account.byIds', 'notes.edit']);
    await ours('panel', 'button[aria-label="Обновить"]').click();
    await browser.waitUntil(async () => (await routes(since)).length === 3, { timeout: 15_000 });
    await waitBody('ready');
    await pressIn(`[data-note-id="${old}"] button`, 'Изменить');
    await pressIn(`[data-notes-editor="${old}"] button`, 'Текстом');
    expect(await value(`[data-notes-editor="${old}"] textarea`)).toBe(OLD.replace('Работа: медбрат', 'Работа: медбрат; nights'));
    await pressIn('.cg-notes__foot button', 'Отмена');
  });

  it('[FX-014] [FX-015] [FX-016] [FX-023] [FX-024] [FS-NOTE-6] «✨ Дополнить из чата»: only the labels reach the hub, with empty values; the empty fields take the answer (marked), the filled ones get additions under them with the fan’s words, «Слова фана» shows the rest, the month stays on its fact, a field the hub named goes «В Другое»; nothing is written before «Сохранить» (R20 P11c, P11b2)', async () => {
    await waitBody('ready');
    const old = (await noteIds())[3] as string;
    await pressIn(`[data-note-id="${old}"] button`, 'Изменить');
    const editor = `[data-notes-editor="${old}"]`;
    const since = await fakeFansly().mark();
    const hubMark = await hub().mark();
    await pressIn('.cg-notes__foot button', '✨ Дополнить из чата');
    await browser.waitUntil(async () => (await readOurs('panel', editor, (node) => node.getAttribute('data-notes-fill'))) === 'done', { timeout: 30_000, timeoutMsg: 'the fill did not end' });
    // The hub took it (its schema and rules): the questionnaire's labels, then the template's it lacks — the journal keeps
    // their lengths only —, the group and the fan apart, the depth of HF-6, and no value: one empty one per label (X43).
    const fills = callsTo((await hub().journal(hubMark)).entries, 'aiFeatureStream');
    expect(fills.map((call) => call.status)).toEqual([200]);
    const request = fills[0]?.request as { feature: string; body: Record<string, unknown> };
    expect(request.feature).toBe('fan-notes-fill');
    expect(request.body).toMatchObject({ conversationRef: A.group, fanRef: A.fan, messageCount: 3000, noteFields: ASKED.map((label) => `‹${String(label.length)} chars›`) });
    expect(request.body['noteValues']).toEqual(ASKED.map(() => '‹0 chars›'));
    expect(JSON.stringify(await hub().journal(0))).not.toMatch(/Wayne|Флорида|медбрат|вайб|кастом/);
    // Empty fields took the answer, the template's new lines stand after the last field (the answer named them exactly),
    // then the field the hub named; the filled ones keep theirs. What the Goose wrote is marked.
    expect(await fieldRows(editor)).toEqual([...ASKED, NAMED]);
    expect(await value(`${editor} [data-notes-field="Возраст"] textarea`)).toBe(FACT);
    expect(await value(`${editor} [data-notes-field="График"] textarea`)).toBe(`${FACT} (10.2026)`);
    expect(await value(`${editor} [data-notes-field="Имя"] textarea`)).toBe('Wayne');
    expect(await readOurs('panel', editor, (node) => [...node.querySelectorAll('[data-notes-ai]')].map((item) => item.getAttribute('data-notes-field')))).toEqual(['Возраст', 'Хобби', 'Фетиши', 'Медиа', 'График', 'Планы и даты', 'Другое', NAMED]);
    // The words behind a rewrite stand under it; the rest wait for «Слова фана».
    expect(await readOurs('panel', `${editor} [data-notes-field="Работа"] [data-notes-suggestion] [data-notes-quotes]`, (node) => node.textContent)).toBe(`«${QUOTE('Работа')}»`);
    expect(await quotesUnder(`${editor} [data-notes-field="Возраст"]`)).toEqual([]);
    await pressIn(`${editor} button`, 'Слова фана');
    expect(await quotesUnder(`${editor} [data-notes-field="Возраст"]`)).toEqual([`«${QUOTE('Возраст')}»`]);
    expect(await quotesUnder(`${editor} [data-notes-field="${NAMED}"]`)).toEqual(['«my synthetic cat»']);
    expect(await readOurs('panel', editor, (node) => [...node.querySelectorAll('[data-notes-suggestion]')].map((item) => item.closest('[data-notes-field]')?.getAttribute('data-notes-field')))).toEqual(['Имя', 'Локация', 'Работа', 'Характеристика']);
    expect(await readOurs('panel', `${editor} [data-notes-field="Работа"] [data-notes-suggestion]`, (node) => [node.querySelectorAll('del').length, node.querySelector('ins')?.textContent])).toEqual([0, FACT]);
    expect(await readOurs('panel', '[data-notes-fill-line]', (node) => node.textContent)).toBe(`Гусь вписал: Возраст, Хобби, Фетиши, Медиа, График, Планы и даты, Другое, ${NAMED}. Добавки под полями: 4.`);
    expect(await routes(since)).toEqual([]);
    mkdirSync(E2E_EVIDENCE_DIR, { recursive: true });
    for (const theme of ['bright', 'dark'] as const) {
      await callFansly('setTheme', theme);
      await browser.waitUntil(async () => (await $(SLOT).getAttribute('data-scheme')) === (theme === 'bright' ? 'light' : 'dark'));
      await browser.saveScreenshot(`${E2E_EVIDENCE_DIR}/suite-fansly-notes-fill-${theme}.png`);
    }
    // «В Другое»: the named field's line leaves, its fact joins «Другое», its words with it.
    await pressIn(`${editor} [data-notes-proposed="${NAMED}"] button`, 'В Другое');
    expect(await fieldRows(editor)).toEqual(ASKED);
    expect(await value(`${editor} [data-notes-field="Другое"] textarea`)).toBe(`${FACT}\n${NAMED}: synthetic cat`);
    expect(await quotesUnder(`${editor} [data-notes-field="Другое"]`)).toEqual([`«${QUOTE('Другое')}»`, `${NAMED} — «my synthetic cat»`]);
    // «Принять» adds to its field, «Не нужно» leaves the field as it was; «Сохранить» writes once.
    await pressIn(`${editor} [data-notes-field="Имя"] [data-notes-suggestion] button`, 'Принять');
    await ours('panel', `${editor} [data-notes-field="Локация"] [data-notes-suggestion] button[aria-label="Не нужно"]`).click();
    expect(await value(`${editor} [data-notes-field="Имя"] textarea`)).toBe(`Wayne\n${FACT}`);
    expect(await value(`${editor} [data-notes-field="Локация"] textarea`)).toBe('Флорида (08.2026)');
    expect(await routes(since)).toEqual([]);
    await ours('panel', '[data-notes-save]').click();
    await browser.waitUntil(async () => !(await oursExists('panel', '[data-notes-editor]')), { timeout: 15_000 });
    expect(await routes(since)).toEqual(['account.byIds', 'notes.edit']);
    expect(await tableLabels(`[data-note-id="${old}"] [data-notes-form]`)).toEqual(ASKED);
    // The month the fan said it, at the right of its fact (FX-023).
    expect(await readOurs('panel', `[data-note-id="${old}"] [data-notes-field="График"] .cg-notes__fact-date`, (node) => node.textContent)).toBe('10.2026');
    // The questionnaire is not dated; its facts are.
    expect(await oursExists('panel', `[data-note-id="${old}"] [data-notes-date]`)).toBe(false);
  });

  it('[FX-022] [FS-NOTE-6] «✨ Дополнить из чата» stands on the questionnaire being read: one press opens it and fills; «Отмена» drops both (R20 P11b2)', async () => {
    await waitBody('ready');
    const old = (await noteIds())[3] as string;
    const since = await fakeFansly().mark();
    const hubMark = await hub().mark();
    await pressIn(`[data-note-id="${old}"] button`, '✨ Дополнить из чата');
    const editor = `[data-notes-editor="${old}"]`;
    await browser.waitUntil(async () => (await readOurs('panel', editor, (node) => node.getAttribute('data-notes-fill'))) === 'done', { timeout: 30_000, timeoutMsg: 'the fill from the read view did not end' });
    expect(callsTo((await hub().journal(hubMark)).entries, 'aiFeatureStream').map((call) => call.status)).toEqual([200]);
    // Every field was filled before: the answer waits under them, nothing is written.
    expect(await readOurs('panel', editor, (node) => node.querySelectorAll('[data-notes-suggestion]').length)).toBeGreaterThan(0);
    expect(await readOurs('panel', '.cg-notes__foot', (node) => node.textContent ?? '')).toContain('✨ Дополнить из чата');
    await pressIn('.cg-notes__foot button', 'Отмена');
    await browser.waitUntil(async () => !(await oursExists('panel', '[data-notes-editor]')), { timeout: 10_000 });
    expect(await routes(since)).toEqual([]);
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
    // The shift pins the tab's viewport (BiDi): a wider window would not widen the page.
    await browser.browsingContextSetViewport({ context: shift.fanslyTab, viewport: { width: 1500, height: 900 } });
    await waitShown(true);
    const before = await fakeFansly().mark();
    await callFansly('open', A.group, 'router');
    await browser.waitUntil(async () => (await readOurs('panel', '.cg-notes', (node) => [node.getAttribute('data-notes-place'), node.getAttribute('data-notes-body')].join())) === 'docked,ready', { timeout: 15_000 });
    expect(await routes(before)).toEqual(['account.byIds']);
  });

  it('[FX-010] [FS-NOTE-3] a 429 is not asked again by itself; during the cooldown «Повторить» sends nothing', async () => {
    await browser.browsingContextSetViewport({ context: shift.fanslyTab, viewport: { width: 1180, height: 850 } });
    await browser.refresh();
    // The slot stands before the chat is known; the button only with it.
    await browser.waitUntil(() => button().isExisting(), { timeout: 20_000, timeoutMsg: 'no «Заметки» button after the reload' });
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
