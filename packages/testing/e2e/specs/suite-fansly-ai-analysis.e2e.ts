// Recap, Review and Coach on Fansly (R20 P8c, part B; docs/project-unite/spec.md FS-AI-1, FS-TAIL-1, FS-TAIL-8,
// FS-TAIL-10; plan.md §3 `suite-fansly-ai`): the extension's test build on the Fansly stand against the fake hub, a
// chatter signed in, the Fansly page's persona chosen and its own switches on.
// - They read the hub's history and the latest page text: each start carries MAIN's snapshot as its proof — the window the page holds,
//   checked by its ids — together with its text, never `clientContext`.
// - The verdict over what they made: an analysis whose window the hub has not got (its ordinary lag: the fan wrote,
//   the chatter starts at once) is marked as a result is — «Ответ мог не учесть последние сообщения чата.» — on its
//   own surface, the Review's sheet and the Coach answer, with «Ещё раз»; the hub holding the window — no mark.
//   The marks in both of Fansly's themes (pictures in .cache/e2e/, compared by eye with ui-design.md §4.7).
// - The full Recap's depth: the person's wish above 3000 from the settings page (`settings.ext`), never above the
//   hub's `limits.deepMax` (5000, then 3000); the short one 300.
// - The archive lags the page: once the fan wrote after them, the Recap and Coach say so — by the page's newest
//   message, no copy of a text in the tab.
// Nothing of ours asks the Fansly stand for anything.

import { mkdirSync } from 'node:fs';

import { browser, expect } from '@wdio/globals';

import type { FakeHubJournalEntry } from '../../src/fake-hub/types';
import { WORLD } from '../../src/scenarios/hub';
import { E2E_EVIDENCE_DIR } from '../../src/stand/paths';
import { pageRpc, waitForReport } from '../support/extension';
import { QUIET_PAGE, testBuildPage, useFakeHub } from '../support/fake-hub';
import { setFanslyNeighbor } from '../support/fansly-neighbor';
import { startFanslyShift, type FanslyShift } from '../support/fansly-shift';
import { callFansly, fakeFansly, fanslyStandServer } from '../support/fansly-stand';
import { useNetworkTrap } from '../support/network-trap';
import { allOurs, oursExists, oursFocus, oursText, pressOurs, waitOursText } from '../support/ours';
import { dockIs } from '../support/shift';

const A = WORLD.fansly.chats.a;
const PAGE_LABEL = WORLD.pages.fansly.pageLabel;
const MISS = 'Ответ мог не учесть последние сообщения чата.';

interface WindowCheck {
  readonly window: readonly { readonly id: string; readonly dir: 'fan' | 'model' }[];
  readonly deletedIds: readonly string[];
}
interface StreamBody {
  readonly conversationRef: string;
  readonly fanRef: string;
  readonly messageCount: number;
  readonly summaryMode?: string;
  readonly coverageCheck?: WindowCheck;
  readonly liveTextContext?: unknown;
}
interface Stream {
  readonly feature: string;
  readonly status: number;
  readonly capabilities: readonly string[];
  readonly body: StreamBody;
}
const streamOf = (entry: FakeHubJournalEntry): Stream => {
  const request = entry.request as { readonly feature: string; readonly capabilities: readonly string[]; readonly body: StreamBody };
  return { feature: request.feature, status: entry.status, capabilities: request.capabilities, body: request.body };
};

/** A picture of the stand's page as it is now, in .cache/e2e/ (compared by eye with ui-design.md). */
async function shootStand(name: string): Promise<void> {
  mkdirSync(E2E_EVIDENCE_DIR, { recursive: true });
  await browser.execute(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await browser.saveScreenshot(`${E2E_EVIDENCE_DIR}${name}.png`);
}

/** Leaves Fansly's field: a key of ours outside it is a command, not text. */
const leaveField = (): Promise<unknown> => browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());

/** Both of Fansly's themes, a picture of each, then back to the bright one. */
async function inBothThemes(name: string): Promise<void> {
  for (const theme of ['bright', 'dark'] as const) {
    await callFansly('setTheme', theme);
    await waitForReport((now) => now.dock?.scheme === (theme === 'bright' ? 'light' : 'dark'), `the dock in the ${theme} theme`);
    await shootStand(`${name}-${theme}`);
  }
  await callFansly('setTheme', 'bright');
}

describe('Recap, Review and Coach on Fansly: the hub’s history, the verdict over them, the deep window, the archive’s lag (R20 P8c, part B)', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let shift: FanslyShift;
  let journalStart = 0;

  /** The model streams of the hub since `mark`. */
  const streamsSince = async (mark: number): Promise<Stream[]> => (await hub().journal(mark)).entries.filter((entry) => entry.route === 'aiFeatureStream').map(streamOf);
  /** The hub's archive of the open chat becomes exactly these messages. */
  const seed = (window: WindowCheck['window']): Promise<unknown> =>
    hub().command({ op: 'archiveConversation', pageLabel: PAGE_LABEL, conversationRef: A.group, messages: window.map((entry) => ({ id: entry.id, sender: entry.dir })) });
  /** What the page holds of the open chat, oldest first. */
  const held = async (): Promise<string[]> => (await callFansly('list'))?.ids.slice() ?? [];

  before(async () => {
    await setFanslyNeighbor(null);
    await fakeFansly().command({ op: 'reset' });
    journalStart = await fanslyStandServer.mark();
    // The hub reads up to 5000 messages (HF-6); its archive of the chat holds none of the page's ids — each `absent`.
    await hub().command({ op: 'config', patch: { aiChunkDelayMs: 0, limits: { deepMax: 5000 } } });
    // «Тема: как на сайте»: the dock follows Fansly's own theme (the default is the light paper).
    shift = await startFanslyShift(hub(), { path: `/messages/${A.group}`, settings: { ui: { theme: 'host' } }, viewport: { width: 1440, height: 900 } });
    await dockIs((d) => d.status === 'ready' && d.actions['review'] === true && d.target?.endsWith(`:${A.fan}`) === true, 'the dock of the Fansly chat, ready', 20_000);
  });

  after(async () => {
    await hub().command({ op: 'config', patch: { limits: { deepMax: 1500 } } });
    // Nothing of the extension asked the Fansly stand for anything (the page's own calls go to the fake Fansly).
    expect((await fanslyStandServer.journal(journalStart)).filter((entry) => entry.origin !== 'asset')).toEqual([]);
  });

  it('[AI-050] [FS-TAIL-10] [FS-TAIL-8] Review: from the hub’s history, its window checked by ids and sent as text; the window the hub has not got marks the Review, «Ещё раз» on the mark rates anew — unmarked once the hub holds it', async function () {
    this.timeout(180_000);
    const page = await held();
    const mark = await hub().mark();
    await pressOurs('dock', '.cg-strip button', /^Review/);
    // X55: a Review opens in its «Развернуть ↗» window, over the page; the sheet under it keeps its head.
    await waitOursText('modal', 'Synthetic review of the chat.', 'the Review in its window', { timeout: 30_000, selector: '.cg-xdlg' });
    const [first] = await streamsSince(mark);
    if (first === undefined) throw new Error('the Review asked the hub nothing');
    expect([first.feature, first.status, first.body.conversationRef, first.body.fanRef]).toEqual(['chat-review', 200, A.group, A.fan]);
    expect(first.capabilities).toEqual(expect.arrayContaining(['context-v1', 'coverage-check-v1']));
    // The same observed window is checked by ids and sent as text; no `clientContext` (FS-TAIL-10).
    expect(first.body.coverageCheck?.window.map((entry) => entry.id)).toEqual(page.slice(-60));
    expect(['liveTextContext' in first.body, 'clientContext' in first.body]).toEqual([true, false]);
    expect(first.body.messageCount).toBe(3000);

    // The hub's archive holds none of the page's ids: the Review is marked, its «Ещё раз» on the mark.
    await waitOursText('modal', MISS, 'the mark over the Review', { selector: '.cg-xdlg .cg-stale__t' });
    expect(await oursText('modal', '.cg-xdlg .cg-stale button')).toBe('Ещё раз');
    await inBothThemes('suite-fansly-ai-analysis-review-mark');

    // The hub catches up with the page: «Ещё раз» on the mark rates the chat anew, with no mark.
    await seed(first.body.coverageCheck?.window ?? []);
    const again = await hub().mark();
    await pressOurs('modal', '.cg-xdlg .cg-stale button', /^Ещё раз/);
    await browser.waitUntil(async () => (await streamsSince(again)).length === 1 && !(await oursExists('modal', '.cg-xdlg .cg-stale')), {
      timeout: 30_000,
      timeoutMsg: 'the Review was not rated anew without a mark',
    });
    await waitOursText('modal', 'Synthetic review of the chat.', 'the new Review', { selector: '.cg-xdlg' });
    // Esc folds the window into the sheet, the next one hides the sheet.
    await browser.keys(['Escape']);
    await browser.waitUntil(async () => !(await oursExists('modal', '.cg-xdlg')), { timeout: 5000, timeoutMsg: 'Esc did not fold the Review window' });
    await browser.keys(['Escape']);
    await dockIs((d) => d.analysis === null, 'the Review sheet is hidden');
  });

  it('[AI-080] [FS-TAIL-8] [FS-TAIL-10] [NEW-02] Coach: a question answered from the hub’s history; the answer marked while the hub lacks the window’s newest message, «Ещё раз» asks it again; then the fan writes — «архив отстаёт» in Coach', async function () {
    this.timeout(180_000);
    // The hub lags the page by its newest message (the fan wrote, the chatter asks at once).
    const window = (await streamsSince(0)).at(-1)?.body.coverageCheck?.window ?? [];
    await seed(window.slice(0, -1));
    const mark = await hub().mark();
    await leaveField();
    await pressOurs('dock', '.cg-strip button', /^Coach/);
    await browser.waitUntil(async () => (await oursFocus('panel'))?.label === 'Вопрос Coach', { timeout: 10_000, timeoutMsg: 'the Coach field did not take the focus' });
    await browser.keys('What do I say next?'.split(''));
    await browser.keys('Enter');
    await waitOursText('panel', /Ask about their weekend/, 'the Coach answer', { timeout: 30_000 });
    await waitOursText('panel', MISS, 'the mark over the Coach answer', { selector: '.cg-stale__t' });
    const [asked] = await streamsSince(mark);
    expect([asked?.feature, asked?.status, asked?.body.coverageCheck?.window.length, asked !== undefined && 'liveTextContext' in asked.body]).toEqual(['coach-chat', 200, window.length, true]);
    await inBothThemes('suite-fansly-ai-analysis-coach-mark');

    // The hub catches up: «Ещё раз» asks the question again, and that answer has no mark.
    await seed(window);
    const again = await hub().mark();
    await pressOurs('panel', '.cg-stale button', /^Ещё раз/);
    await browser.waitUntil(async () => (await streamsSince(again)).length === 1, { timeout: 30_000, timeoutMsg: 'the question was not asked again' });
    await browser.waitUntil(async () => (await allOurs('panel', '[data-cg-answer] .cg-co__md').getElements()).length === 2, { timeout: 30_000, timeoutMsg: 'no answer to the question asked again' });
    // The first answer keeps its mark; the second has none.
    expect((await allOurs('panel', '[data-cg-answer] .cg-stale').getElements()).length).toBe(1);

    // The fan writes after the answers: the archive lags the page — by the page's newest message, no text copied.
    await fakeFansly().command({ op: 'message', groupId: A.group, text: 'are you there?' });
    await browser.waitUntil(() => oursExists('panel', '.cg-co__lag .is-lag'), { timeout: 15_000, timeoutMsg: 'Coach does not say the archive lags the chat' });
    await browser.keys(['Escape']);
    await browser.waitUntil(async () => !(await oursExists('panel', '.cg-coach')), { timeout: 5000, timeoutMsg: 'Coach did not close' });
  });

  it('[AI-062] [AI-134] [FS-AI-1] the full Recap’s depth: the person’s wish above 3000 from the settings page, up to the hub’s deepMax — 5000, then 3000 —; the short one 300; none carries a text of the page', async function () {
    this.timeout(180_000);
    // The settings page keeps a depth above 3000 in `settings.ext` (R20 §12); the Fansly tab asks for it at a deep start.
    await shift.toPages();
    await browser.url(testBuildPage('options.html'));
    expect(await pageRpc('fansly.settings.write', { patch: { windows: { deep: 5000 } } })).toMatchObject({ ok: true, payload: { ext: { windows: { deep: 5000 } } } });
    await browser.url(testBuildPage(QUIET_PAGE));
    await shift.toFansly();

    const mark = await hub().mark();
    await leaveField();
    await pressOurs('dock', '.cg-strip button', /^Recap/);
    await dockIs((d) => d.analysis === 'recap', 'the Recap sheet');
    await pressOurs('dock', '.cg-dock button', /^Собрать полностью/);
    // X55: the full Recap opens in its «Развернуть ↗» window.
    await waitOursText('modal', 'Synthetic recap of the conversation.', 'the full Recap in its window', { timeout: 30_000, selector: '.cg-xdlg' });

    // The hub takes 3000 now: the same wish asks for 3000.
    await hub().command({ op: 'config', patch: { limits: { deepMax: 3000 } } });
    expect(await shift.rpc('bootstrap.get', { force: true })).toMatchObject({ ok: true });
    await pressOurs('modal', '.cg-xdlg button', /Обновить/);
    await browser.waitUntil(async () => (await streamsSince(mark)).length === 2, { timeout: 30_000, timeoutMsg: 'the Recap was not built anew' });
    await waitOursText('modal', 'Synthetic recap of the conversation.', 'the full Recap built anew', { timeout: 30_000, selector: '.cg-xdlg' });

    // «Коротко» in the window: the short one is the sheet's — the window folds, the sheet offers to build it.
    await pressOurs('modal', '.cg-xdlg button', /^Коротко$/);
    await browser.waitUntil(async () => !(await oursExists('modal', '.cg-xdlg')), { timeout: 5000, timeoutMsg: 'the window did not give the short Recap to the sheet' });
    await pressOurs('dock', '.cg-dock button', /^Собрать коротко/);
    await waitOursText('dock', 'Synthetic short recap.', 'the short Recap', { timeout: 30_000 });

    const streams = await streamsSince(mark);
    // The hub's full Recap omits summaryMode: its schema accepts only the literal 'short'.
    expect(streams.map(({ feature, status, body }) => [feature, status, body.summaryMode ?? null, body.messageCount])).toEqual([
      ['fan-summary', 200, null, 5000],
      ['fan-summary', 200, null, 3000],
      ['fan-summary', 200, 'short', 300],
    ]);
    const window = Math.min(60, (await held()).length);
    for (const { body } of streams) expect([body.coverageCheck?.window.length, 'liveTextContext' in body, 'clientContext' in body]).toEqual([window, true, false]);
  });

  it('[AI-070] [NEW-02] the Recap lags the chat once the fan wrote after it: its facts say so, by the page’s newest message — no text of the page copied for it', async function () {
    this.timeout(120_000);
    const lag = '.cg-sheet .cg-facts [data-accent-use="archive-lag"]';
    if (!(await oursExists('dock', '.cg-sheet'))) await pressOurs('dock', '.cg-strip button', /^Recap/);
    await waitOursText('dock', 'Synthetic short recap.', 'the short Recap in the sheet', { timeout: 15_000 });
    await fakeFansly().command({ op: 'message', groupId: A.group, text: 'one more thing' });
    await browser.waitUntil(() => oursExists('dock', lag), { timeout: 15_000, timeoutMsg: 'the Recap does not say the archive lags the chat' });
    await browser.keys(['Escape']);
    await dockIs((d) => d.analysis === null, 'the Recap sheet is hidden');
  });
});
