// §12 п. 4 on the wired extension, part 7 — degradation and restarts
// (architecture.md §6.2, §7, §13): the TEST build on the stand against the
// fake hub.
// - ChatSpace renders its composers again after a pause (the same chat, new
//   nodes, nothing MAIN hears of): the dock comes back over the new field;
//   after such a re-render — with a pause or in one step — the person's
//   FIRST «Вставить» writes into the new field of the same chat;
// - ChatSpace «updated» and lost a store (its send queue): the feature that
//   needs it — the preview send — is off with its code, everything else
//   works; «Статус» of the settings names the anchor that is gone, the popup
//   says the contract is partial;
// - ChatSpace lost its composer bridge: only copying is left — the banner
//   with its code, «Копировать» in place of «Вставить», nothing is written;
// - the background refuses a start before any admission (the browser ran
//   out of room for the session's data): the dock says so with the code —
//   after a click and after a key alike — and the hub is asked nothing;
// - the event page is unloaded in the middle of a stream: the operation is
//   `interrupted` — «Операция прервана» with «Ещё раз» —, and the hub is not
//   asked again until the person presses it;
// - the extension itself is reloaded under the open tab in the middle of a
//   stream: «Перезагрузите вкладку» (CG-RUNTIME-RELOADED), every action off,
//   the hub's stream cut and never asked again; «Перезагрузить вкладку»
//   brings the dock back;
// - ChatSpace fills a store after our script started (a reload of 0.195): the
//   contract is broken for a moment, and that start-up is no error of the day
//   and no warning — only the settled contract is judged.
// What the adapter does with each lost anchor has its spec without the
// extension (host-adapter.e2e.ts); here the person sees it — in the dock, in
// the preview, in the settings, in the popup.

import type { LogRecord } from '@cg/contracts/logs';
import { $, browser, expect } from '@wdio/globals';

import { pilotPageFlags } from '../../src/fake-hub/config';
import { callsTo } from '../../src/fake-hub/journal';
import { suspendBackground } from '../support/background';
import { bridgeWrites, clearDraft, composerText, EDITOR, MOD, pageJournal, pageJournalMark, PANEL, queueAdds, waitForComposerText } from '../support/chat';
import { fillSessionStorage, freeSessionStorage, pageRpc, readReport, waitForReport } from '../support/extension';
import { QUIET_PAGE, testBuildPage, useFakeHub } from '../support/fake-hub';
import { useNetworkTrap } from '../support/network-trap';
import { oursExists, oursText, pressOurs, waitOursByText, waitOursText } from '../support/ours';
import { readChatSpaceStatus, type ChatSpaceStatus } from '../support/pages';
import { dockIs, startShift, type Shift } from '../support/shift';
import { callStand, chatPath, composerRoots, dockPlacement, foreignCalls, openStand, STAND_IDS, standServer, waitForChatReady } from '../support/stand';

const ACC = STAND_IDS.accounts.a;
const { a1, a2, a4, a5, a6 } = STAND_IDS.fans;
const reply = (fan: string): readonly [string, string] => [`Hey you, thanks for writing! @${fan}`, `How was your day? @${fan}`];
/** How long ChatSpace's composers are gone in a re-mount: far more than the dock takes to look for them. */
const REMOUNT_GAP_MS = 300;

describe('§12 п. 4 on the wired extension — degradation and restarts: what the person sees and what is never repeated', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let shift: Shift;
  let journalStart = 0;

  /** «Статус» of the settings, read on the extension page; the ChatSpace tab is in front again after it. */
  const statusPage = (): Promise<ChatSpaceStatus> => readChatSpaceStatus(shift);
  const streams = async (mark: number): Promise<Array<string | null>> => callsTo((await hub().journal(mark)).entries, 'aiFeatureStream').map((call) => call.stream?.outcome ?? null);

  before(async () => {
    await standServer.reset();
    await standServer.traffic({ firstSummaryMs: 150 });
    journalStart = await standServer.mark();
    await hub().command({ op: 'config', patch: { aiNameFan: true } });
    shift = await startShift(hub(), { previewSend: true, settings: { generation: { split: true } }, viewport: { width: 1440, height: 900 } });
    await dockIs((d) => d.status === 'ready' && d.actions['reply'] === true, 'the dock of the open chat is ready');
  });

  after(async () => {
    await hub().command({ op: 'config', patch: { aiChunkDelayMs: 0 } });
    expect(foreignCalls((await standServer.journal(journalStart)).entries)).toEqual([]);
  });

  it('a healthy ChatSpace first: «Статус» says it is checked, the popup has nothing to warn about', async () => {
    const healthy = await statusPage();
    expect(healthy.chatspace.level).toBe('ok');
    expect(healthy.popupCodes).not.toContain('CG-HOST-CONTRACT');
  });

  it('[LG-016] ChatSpace fills a store after our script started (a reload of 0.195): its start-up is no error of the day and no warning; the settled contract is written once, whole', async function () {
    this.timeout(90_000);
    /** Today's CG-HOST-CONTRACT, and the host contract records (and every record) of the tab script that started after `from`, read on the extension page. */
    const readBack = async (from: number): Promise<{ readonly contractErrors: number; readonly records: readonly LogRecord[]; readonly all: readonly LogRecord[] }> => {
      await shift.toPages();
      try {
        const diagnostics = await pageRpc<{ counters: Record<string, number> }>('diagnostics.get');
        await browser.url(testBuildPage('options.html'));
        const file = await pageRpc<{ body: string }>('diagnostics.export', { format: 'json' });
        if (!diagnostics.ok || !file.ok) throw new Error('diagnostics were not read');
        const records = (JSON.parse(file.payload.body) as { logs?: { recent?: LogRecord[] } }).logs?.recent ?? [];
        const session = records.find((record) => record.msg === 'tab script started' && Date.parse(record.ts) >= from)?.ctx?.tabSessionId;
        const all = session === undefined ? [] : records.filter((record) => record.ctx?.tabSessionId === session);
        const ofSession = all.filter((record) => record.scope === 'tab.host' && /^host contract/.test(record.msg));
        return { contractErrors: diagnostics.payload.counters['CG-HOST-CONTRACT'] ?? 0, records: ofSession, all };
      } finally {
        await browser.url(testBuildPage(QUIET_PAGE));
        await shift.toStand();
      }
    };
    const before = (await readBack(Date.now())).contractErrors;
    const from = Date.now();
    // The third live check: after a reload ChatSpace 0.195 filled its stores one by one, the contract was broken for
    // a second, and the day counted CG-HOST-CONTRACT four times. Here the stand shows its app and the open chat's
    // composer 1.5 s before its accounts and permissions start to load.
    await openStand(chatPath(ACC, a1), { slowStartMs: 1500 });
    await dockIs((d) => d.status === 'ready' && d.actions['reply'] === true, 'the dock after the slow start', 20_000);
    let seen: Awaited<ReturnType<typeof readBack>> = { contractErrors: before, records: [], all: [] };
    await browser.waitUntil(
      async () => {
        seen = await readBack(from);
        // The settled record — or, from a build that writes no `starting`, the change that made the contract whole.
        return seen.records.some((record) => record.fields?.['starting'] === undefined && record.fields?.['ok'] === true);
      },
      { timeout: 30_000, interval: 1000, timeoutMsg: 'the new tab wrote no whole host contract' },
    );
    // Once more: the day's counters are read before the export, and the last records may have come in between.
    seen = await readBack(from);
    // No error of the day, no warning, no code on any record of the start-up.
    expect(['CG-HOST-CONTRACT today', seen.contractErrors - before]).toEqual(['CG-HOST-CONTRACT today', 0]);
    expect(seen.records.filter((record) => record.level !== 'info' || record.code !== undefined).map((record) => [record.level, record.msg, record.code ?? null])).toEqual([]);
    // The start-up really was broken, and it was written as such — without the code, at info.
    expect(seen.records.some((record) => record.fields?.['starting'] === true && record.fields['ok'] === false)).toBe(true);
    const settled = seen.records.filter((record) => record.fields?.['starting'] === undefined);
    expect(settled.map((record) => [record.level, record.msg, record.code ?? null, record.fields?.['ok']])).toEqual([['info', 'host contract checked', null, true]]);
    // What the records name is readable: the contracts' version is a fixed word, not a masked text.
    expect(seen.all.find((record) => record.msg === 'tab script started')?.fields?.['contractsVersion']).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('[LG-008] a chat whose fan ChatSpace does not know yet (the fourth live check): MAIN’s «no such fan yet» is an answer — not one read is written as failed', async function () {
    this.timeout(90_000);
    // On a reload of the tab, ChatSpace showed the chat before its fan was in its map. MAIN answered `fan` with an
    // honest null, the bridge took it for a broken answer, kept nothing and was asked again on every look at the
    // chat: 30 `read-failed {invalid-answer}` records in two seconds, more than half of the log segment.
    await standServer.holdFans(true);
    const from = Date.now();
    try {
      await openStand(chatPath(ACC, a1));
      await dockIs((d) => d.status === 'ready' && d.target?.endsWith(`:${a1}`) === true, 'the dock of a chat whose fan is not known yet', 20_000);
      // The views look at the chat on every change while ChatSpace goes on loading: two seconds of it.
      await browser.pause(2000);
    } finally {
      await standServer.holdFans(false);
    }
    // ChatSpace learns the fan (the adapter's own spec follows it to the tab: stack.dom.test.ts).
    await browser.waitUntil(async () => (await callStand('queryState', ['fansMap', ACC])).hasData, { timeout: 10_000, timeoutMsg: 'the stand did not load its fans' });
    await browser.pause(500);
    await shift.toPages();
    let read: { readonly all: readonly LogRecord[]; readonly fails: readonly LogRecord[] };
    try {
      await browser.url(testBuildPage('options.html'));
      const file = await pageRpc<{ body: string }>('diagnostics.export', { format: 'json' });
      if (!file.ok) throw new Error('diagnostics were not exported');
      const records = (JSON.parse(file.payload.body) as { logs?: { recent?: LogRecord[] } }).logs?.recent ?? [];
      const session = records.find((record) => record.msg === 'tab script started' && Date.parse(record.ts) >= from)?.ctx?.tabSessionId;
      const all = session === undefined ? [] : records.filter((record) => record.ctx?.tabSessionId === session);
      read = { all, fails: all.filter((record) => record.msg === 'read-failed' || record.msg === 'read-recovered') };
    } finally {
      await browser.url(testBuildPage(QUIET_PAGE));
      await shift.toStand();
    }
    expect(read.all.length).toBeGreaterThan(0);
    expect(read.fails.map((record) => [record.msg, record.fields ?? null])).toEqual([]);
  });

  it('[UI-011] the owner switches ChatGoose off for the page (the master switch): the dock stays, says so in one line, every AI button is dimmed — a click starts nothing and the hub is asked nothing; switched on again, it works', async () => {
    /** The background reads the owner's switches again (as its 5-minute refresh does); the tab hears `bootstrap.changed`. */
    const rereadBootstrap = async (): Promise<void> => {
      await shift.toPages();
      try {
        expect(await pageRpc('bootstrap.get', { force: true })).toMatchObject({ ok: true });
      } finally {
        await shift.toStand();
      }
    };
    const hubMark = await hub().mark();
    await hub().command({ op: 'config', patch: { master: false } });
    await rereadBootstrap();
    const off = await dockIs((d) => d.notice !== null, 'the dock says the page is switched off', 20_000);
    // Not an error state: the dock is `ready`, without a banner of a failure — and nothing of AI can be started.
    expect(off).toMatchObject({ status: 'ready', mode: 'copy-only', notice: 'CG-FEATURE-DISABLED', banner: null, refusal: null });
    expect(Object.values(off.actions).some(Boolean)).toBe(false);
    const said = await oursText('dock');
    expect(said).toContain('ChatGoose выключен владельцем');
    expect(said).toContain('CG-FEATURE-DISABLED');
    // A click on a dimmed button: no generation, no refusal card, no request to the hub (it would answer 409).
    await pressOurs('dock', '.cg-strip button', /^Reply/);
    await pressOurs('dock', '.cg-strip button', /^Ping/);
    await browser.pause(700);
    const still = await dockIs(() => true, 'the dock');
    expect(still).toMatchObject({ result: null, refusal: null, notice: 'CG-FEATURE-DISABLED' });
    expect(callsTo((await hub().journal(hubMark)).entries, 'aiFeatureStream')).toEqual([]);
    expect(await oursText('toast')).not.toContain('CG-HUB');

    // The owner switches it on again: the same dock works, without a reload of the tab.
    await hub().command({ op: 'config', patch: { master: true } });
    await rereadBootstrap();
    const on = await dockIs((d) => d.notice === null && d.actions['reply'] === true, 'the dock works again', 20_000);
    expect(on).toMatchObject({ status: 'ready', mode: 'insert', banner: null });
    expect(await oursText('dock')).not.toContain('выключен владельцем');
  });

  it('[RB-008] [UI-001] ChatSpace renders its composers again after a pause — the same chat, new nodes, no store change, so MAIN says nothing new: the dock comes back over the new field by itself', async () => {
    // A re-mount with a pause (a leave transition, a layout swap, an async part): when the dock looked, there was no
    // composer, and the composer that came back is the same one to MAIN — only the DOM says it is there again.
    const ready = await dockIs((d) => d.status === 'ready' && d.kind === 'in-flow', 'the dock over the open chat');
    const [active] = (await composerRoots()).active;
    expect(await dockPlacement()).toEqual({ hosts: 1, parentKey: active, firstChild: true, visible: true });
    await browser.execute(() => document.querySelector('[data-host="dock"]')?.parentElement?.setAttribute('data-e2e-before', ''));
    await callStand('remountComposers', REMOUNT_GAP_MS);
    const onNewField = async (): Promise<boolean> => browser.execute(() => document.querySelector('[data-host="dock"]')?.parentElement?.matches('[data-stand-composer]:not([data-e2e-before])') === true);
    await browser.waitUntil(onNewField, { timeout: 5000, timeoutMsg: 'the dock did not come back over the re-rendered composer' });
    expect(await dockPlacement()).toEqual({ hosts: 1, parentKey: active, firstChild: true, visible: true });
    const back = await dockIs((d) => d.kind === 'in-flow' && d.inFlowFirstChild, 'the dock says it is in flow again');
    expect(back).toMatchObject({ status: 'ready', target: ready.target });
  });

  it('[RB-008] [UI-019] after ChatSpace renders the composer again — with a pause, and in one step — the FIRST «Вставить» writes into the new field of the same chat', async () => {
    // pilot-readiness §5 п. 15д: MAIN still held the old field, whose nodes were gone, and re-read the composer only on
    // the click — the first «Вставить» said «Чат ещё не готов» (CG-HOST-NOT-READY) and wrote nothing, the second one wrote.
    await dockIs((d) => d.status === 'ready' && d.kind === 'in-flow' && d.actions['reply'] === true, 'the dock over the open chat');
    expect(await composerText(ACC, a1)).toBe('');
    await pressOurs('dock', '.cg-strip button', /^Reply/);
    await dockIs((d) => d.result?.state === 'done' && d.result.parts === 2, 'the Reply result', 20_000);
    const onNewField = async (): Promise<boolean> => browser.execute(() => document.querySelector('[data-host="dock"]')?.parentElement?.matches('[data-stand-composer]:not([data-e2e-before])') === true);
    /** ChatSpace renders its composers again (`gapMs` 0 — in one step); the person then presses «Вставить» of `part` once. */
    const firstInsertAfter = async (gapMs: number, part: 0 | 1): Promise<void> => {
      await browser.execute(() => document.querySelectorAll('[data-stand-composer]').forEach((root) => root.setAttribute('data-e2e-before', '')));
      const field = (await dockIs((d) => d.kind === 'in-flow' && d.composer !== null, 'the dock over the field')).composer;
      const page = await pageJournalMark();
      await callStand('remountComposers', gapMs);
      await browser.waitUntil(onNewField, { timeout: 5000, timeoutMsg: `the dock did not come back over the re-rendered composer (${gapMs} ms)` });
      // The field is there and works, as the person sees it, and MAIN — silent for its settle time (a tenth of a
      // second: a chat switch would have been its own news by then), then asked — has told of the new field.
      await waitForChatReady(ACC, a1);
      await dockIs((d) => d.kind === 'in-flow' && d.inFlowFirstChild && d.mode === 'insert' && d.composer !== null && d.composer !== field, 'the dock is in flow over the new field, and the tab knows it is a new one', 5000);
      // Then one click.
      await pressOurs('dock', `[data-cg-part="${part}"] button`, /^Вставить/);
      await waitForComposerText(ACC, a1, reply(a1)[part], `the first «Вставить» after a re-render (${gapMs === 0 ? 'in one step' : `${gapMs} ms pause`})`);
      const journal = await pageJournal(page);
      // The page really rendered its composers again, and our one write went into the open chat's new field.
      expect(journal.filter((entry) => entry.type === 'composer-mounted').length).toBeGreaterThan(0);
      expect(bridgeWrites(journal)).toEqual([{ method: 'setText', chatId: a1 }]);
      expect(await oursText('dock')).not.toContain('Чат ещё не готов');
      expect(queueAdds(journal)).toEqual([]);
    };
    await firstInsertAfter(REMOUNT_GAP_MS, 0);
    // The person empties the field; ChatSpace swaps the composer nodes in one render — never a moment without a field.
    await clearDraft();
    await waitForComposerText(ACC, a1, '', 'the person emptied the field');
    await firstInsertAfter(0, 1);
    // The field is left empty for the specs that follow (ChatSpace keeps a draft across a reload).
    await clearDraft();
    await waitForComposerText(ACC, a1, '', 'the field is empty again');
  });

  it('[RB-008] [ER-049] [DB-031] ChatSpace lost its send queue (the store is gone): the preview send is off with CG-SEND-HOST, the dock still generates and inserts; «Статус» names the anchor, the popup says «проверен частично»', async () => {
    await openStand(chatPath(ACC, a1), { breaks: ['store:pendingMessages'] });
    await dockIs((d) => d.status === 'ready' && d.actions['reply'] === true, 'the dock works without the send queue', 20_000);
    // The dock's own features do not need that store: Reply, then «Вставить» into the open chat.
    const page = await pageJournalMark();
    await pressOurs('dock', '.cg-strip button', /^Reply/);
    await dockIs((d) => d.result?.state === 'done', 'the Reply result', 20_000);
    await pressOurs('dock', '[data-cg-part="0"] button', /^Вставить/);
    await waitForComposerText(ACC, a1, reply(a1)[0], 'the part is in the open chat’s field');
    expect(bridgeWrites(await pageJournal(page)).map((write) => write.chatId)).toEqual([a1]);

    // The preview send needs ChatSpace's queue: off, with the code, and nothing is asked of the hub's custody.
    const hubMark = await hub().mark();
    await browser.keys([...PANEL, 'm']);
    await waitOursText('modal', 'Fan Dune', 'the board', { timeout: 20_000 });
    await pressOurs('modal', '[data-cg-key^="fan:"]', /^Fan Dune/);
    await pressOurs('modal', '.cg-pv button', /^Reply/);
    await waitOursText('modal', reply(a4)[1], 'the preview’s result', { timeout: 20_000, selector: '.cg-pvr' });
    const row = await oursText('modal', '.cg-pv [data-cg-part="0"]');
    expect(row).toContain('CG-SEND-HOST');
    expect(row).toContain('Отправка недоступна');
    expect(await oursExists('modal', '.cg-pv [data-cg-send="unavailable"]')).toBe(true);
    expect(await oursExists('modal', '.cg-pv .cg-pvs__open')).toBe(true);
    expect(callsTo((await hub().journal(hubMark)).entries, 'clientFanClaim')).toEqual([]);
    expect(queueAdds(await pageJournal(page))).toEqual([]);
    await browser.keys('Escape');
    await browser.keys('Escape');

    const status = await statusPage();
    expect(status.chatspace.level).toBe('warn');
    expect(status.chatspace.text).toContain('проверен частично');
    expect(status.chatspace.text).toContain('pendingMessages');
    // pilot-readiness §5 п. 13: «Вставить» worked a moment ago — «Статус» does not send the person to «Копировать».
    expect(status.chatspace.text).toContain('Вставка работает.');
    expect(status.chatspace.text).not.toContain('Копировать');
    expect(status.popupCodes).toContain('CG-HOST-CONTRACT');
    // X61: the popup's stage says the same, with what was not found.
    expect(status.popupStage).toContain('pendingMessages');
  });

  it('[RB-008] [UI-027] ChatSpace lost its composer bridge: only copying is left — the banner with CG-HOST-COMPOSER-MISSING, «Копировать» in place of «Вставить», nothing is written; «Статус» names the anchor', async () => {
    await openStand(chatPath(ACC, a1), { breaks: ['composer-bridge'], waitForChat: false });
    const degraded = await dockIs((d) => d.banner === 'CG-HOST-COMPOSER-MISSING', 'the dock says the field is not available', 20_000);
    expect(degraded.mode).toBe('copy-only');
    expect(await oursText('dock', '.cg-dock')).toContain('Поле ввода недоступно');
    // Generating still works; a part can only be copied.
    const page = await pageJournalMark();
    await browser.waitUntil(async () => (await dockIs(() => true, 'the dock')).actions['reply'] === true, { timeout: 15_000, timeoutMsg: 'Reply did not come on in copy-only mode' });
    await pressOurs('dock', '.cg-strip button', /^Reply/);
    await dockIs((d) => d.result?.state === 'done', 'the Reply result', 20_000);
    expect(await waitOursByText('dock', '[data-cg-part="0"] button', /^Копировать/, 'the part offers «Копировать»')).not.toBeNull();
    expect(await oursExists('dock', '[data-cg-part] .cg-ins')).toBe(false);
    expect(bridgeWrites(await pageJournal(page))).toEqual([]);

    const status = await statusPage();
    expect(status.chatspace.level).toBe('warn');
    expect(status.chatspace.text).toContain('composerBridge');
    // Here the insert really is gone, and «Статус» says the same as the dock.
    expect(status.chatspace.text).toContain('Вставка работает через «Копировать»');
    expect(status.popupCodes).toContain('CG-HOST-CONTRACT');
  });

  it('[ER-005] a start the background refuses before any admission is said with its code — by a click and by a key alike — and nothing is asked of the hub', async () => {
    // The browser ran out of room for the session's data: the background cannot write its admission journal.
    await openStand(chatPath(ACC, a5));
    await dockIs((d) => d.status === 'ready' && d.actions['reply'] === true && d.result === null, 'the dock of a healthy ChatSpace', 20_000);
    await shift.toPages();
    expect(await fillSessionStorage()).toBeGreaterThan(0);
    await shift.toStand();
    const hubMark = await hub().mark();
    try {
      // By a click on the strip.
      await pressOurs('dock', '.cg-strip button', /^Reply/);
      const clicked = await dockIs((d) => d.refusal !== null, 'the refused start is on screen', 15_000);
      expect(clicked.refusal).toBe('CG-STORAGE-WRITE');
      expect(clicked.result).toBeNull();
      const card = await oursText('dock', '.cg-dock');
      expect(card).toContain('ChatGoose · CG-STORAGE-WRITE');
      expect(card).toContain('не запущен');
      // «Скрыть», then the same by the key: a new refusal, shown again.
      await pressOurs('dock', '.cg-sheet button', /^Скрыть/);
      await waitOursText('dock', 'CG-STORAGE-WRITE', 'the card is hidden', { gone: true });
      await $(EDITOR).click();
      await browser.keys([MOD, 'e']);
      await waitOursText('dock', 'ChatGoose · CG-STORAGE-WRITE', 'the start refused by the key is on screen again', { timeout: 15_000 });
      expect(await streams(hubMark)).toEqual([]);
    } finally {
      await shift.toPages();
      await freeSessionStorage();
      await shift.toStand();
    }
    // With room again the same click starts, and the card gives way to the result.
    await pressOurs('dock', '.cg-strip button', /^Reply/);
    const done = await dockIs((d) => d.result?.state === 'done', 'the Reply once the storage has room', 20_000);
    expect(done.refusal).toBeNull();
    expect(await streams(hubMark)).toEqual(['done']);
  });

  it('[RB-010] the tab’s port to the background was down and came back by itself: a preview generation that ended unheard is on its card as it ended, and an owner switch that changed unheard is what the dock and the preview go by — nothing is inserted on the word of before the outage', async function () {
    this.timeout(180_000);
    /** The stand holds the tab's port down, or lets it through again (the TEST build's probe, tab/probe.ts). */
    const holdPort = (down: boolean): Promise<void> =>
      browser.execute((isDown: boolean) => {
        if (isDown) document.documentElement.setAttribute('data-cg-spike-port', 'down');
        else document.documentElement.removeAttribute('data-cg-spike-port');
      }, down);
    const setInsertion = async (on: boolean): Promise<void> => {
      await hub().command({ op: 'config', patch: pilotPageFlags({ insertion: on }) });
      // The background reads the owner's switches again (as its 5-minute refresh does) and tells the tabs.
      await shift.toPages();
      try {
        expect(await pageRpc('bootstrap.get', { force: true })).toMatchObject({ ok: true });
      } finally {
        await shift.toStand();
      }
    };
    await openStand(chatPath(ACC, a5));
    await dockIs((d) => d.status === 'ready' && d.mode === 'insert' && d.actions['reply'] === true, 'the dock of a healthy ChatSpace', 20_000);
    try {
      // A Reply in a preview, slow enough to end while the port is down.
      await hub().command({ op: 'config', patch: { aiChunkDelayMs: 500 } });
      const hubMark = await hub().mark();
      await browser.keys([...PANEL, 'm']);
      await waitOursText('modal', 'Fan Fern', 'the board', { timeout: 20_000 });
      await pressOurs('modal', '[data-cg-key^="fan:"]', /^Fan Fern/);
      await pressOurs('modal', '.cg-pv button', /^Reply/);
      await browser.waitUntil(async () => callsTo((await hub().journal(hubMark)).entries, 'aiFeatureStream').length === 1, { timeout: 15_000, timeoutMsg: 'the preview’s generation did not reach the hub' });

      // The port goes down under the running generation; every quick attempt to open it again fails.
      await holdPort(true);
      await dockIs((d) => d.banner === 'CG-RUNTIME-UNREACHABLE', 'the tab lost its port', 20_000);
      // The generation ends at the hub and in the background; its end is said into a port that is down.
      await browser.waitUntil(async () => (await streams(hubMark)).includes('done'), { timeout: 30_000, timeoutMsg: 'the stream did not end at the hub' });
      await browser.pause(800);
      expect(await oursExists('modal', '.cg-pv [data-cg-part]')).toBe(false);
      // Meanwhile the owner switches `insertion` off for the page. The background reads it; this tab hears nothing.
      await setInsertion(false);
      expect((await dockIs(() => true, 'the dock')).banner).toBe('CG-RUNTIME-UNREACHABLE');
      const page = await pageJournalMark();

      // The port is let through again. Nobody clicks: the tab's own beat finds the background.
      await holdPort(false);
      const back = await dockIs((d) => d.banner === null && d.status === 'ready', 'the tab came back by itself', 40_000);
      // The dock goes by the owner's switch as it is NOW — read again with the port, not at the next 5-minute event.
      expect(back).toMatchObject({ status: 'ready', mode: 'copy-only' });
      // The card shows how its generation ended: the text, not «генерация» for ever.
      await waitOursText('modal', reply(a6)[0], 'the preview shows the result of the generation that ended unheard', { timeout: 20_000, selector: '.cg-pvr' });
      expect(await oursExists('modal', '.cg-pv [data-cg-part="0"]')).toBe(true);
      // …and «Открыть и вставить» is not offered on the word of before the outage: the page has no `insertion` now.
      await browser.waitUntil(async () => !(await oursExists('modal', '.cg-pv .cg-pvs__open:not([aria-disabled="true"])')), { timeout: 10_000, timeoutMsg: '«Открыть и вставить» is still offered although the owner switched insertion off during the outage' });
      await pressOurs('modal', '.cg-pv [data-cg-part="0"] .cg-pvs__open', /^Открыть и вставить/);
      await browser.pause(800);
      expect((await callStand('route')).chatId).toBe(a5);
      expect(bridgeWrites(await pageJournal(page))).toEqual([]);
      expect(await streams(hubMark)).toEqual(['done']);
    } finally {
      await holdPort(false);
      await browser.keys('Escape');
      await browser.keys('Escape');
      await hub().command({ op: 'config', patch: { aiChunkDelayMs: 0 } });
      await setInsertion(true);
    }
    await dockIs((d) => d.status === 'ready' && d.mode === 'insert', 'the dock inserts again once the owner switched it back on', 30_000);
  });

  it('[RB-003] the event page is unloaded in the middle of a stream: «Операция прервана» (CG-OP-INTERRUPTED) with «Ещё раз» — the hub is not asked again until the person presses it', async () => {
    // A chat nothing was generated for yet (a finished result of a chat comes back as it is on the next Reply).
    await openStand(chatPath(ACC, a2));
    await dockIs((d) => d.status === 'ready' && d.actions['reply'] === true && d.result === null, 'the dock of a healthy ChatSpace', 20_000);
    await hub().command({ op: 'config', patch: { aiChunkDelayMs: 600 } });
    const hubMark = await hub().mark();
    await pressOurs('dock', '.cg-strip button', /^Reply/);
    await dockIs((d) => d.result?.state === 'streaming', 'the stream is on screen', 20_000);
    expect(await suspendBackground()).toBe('stopped');
    // The open tab wakes the event page; the new instance knows the run was cut and says so.
    const cut = await dockIs((d) => d.result?.state === 'interrupted', 'the operation is interrupted', 20_000);
    expect(cut.result).toMatchObject({ feature: 'reply', error: 'CG-OP-INTERRUPTED', parts: 0, inserted: 0 });
    const shown = await oursText('dock', '.cg-dock');
    expect(shown).toContain('Операция прервана');
    expect(shown).toContain('CG-OP-INTERRUPTED');
    // Nothing half-made is offered for insertion.
    expect(await oursExists('dock', '[data-cg-part]')).toBe(false);
    // One POST, cut; not one more by a restore or a timer.
    await browser.pause(1500);
    expect(await streams(hubMark)).toEqual(['aborted']);
    expect((await dockIs(() => true, 'the dock')).result?.state).toBe('interrupted');
    // «Ещё раз» is the person's: a new generation, from the start.
    await hub().command({ op: 'config', patch: { aiChunkDelayMs: 0 } });
    await pressOurs('dock', '.cg-dock button', /^Ещё раз/);
    const again = await dockIs((d) => d.result?.state === 'done', 'the new generation', 20_000);
    expect(again.result).toMatchObject({ parts: 2, error: null });
    expect(await streams(hubMark)).toEqual(['aborted', 'done']);
    expect(await composerText(ACC, a2)).toBe('');
  });

  it('[UP-009] the extension is reloaded under the open tab in the middle of a stream: «Перезагрузите вкладку» (CG-RUNTIME-RELOADED), every action off, the hub is never asked again; «Перезагрузить вкладку» brings the dock back', async function () {
    this.timeout(180_000);
    await hub().command({ op: 'config', patch: { aiChunkDelayMs: 600 } });
    const hubMark = await hub().mark();
    // «Ещё раз» of the result on screen: a new generation, slow enough to be cut.
    await pressOurs('dock', '.cg-dock .cg-again', /^Ещё раз/);
    await dockIs((d) => d.result?.state === 'streaming', 'the stream is on screen', 20_000);
    const before = await readReport();
    // The add-on reloads itself, as an update does: asked from its own page, which goes away with it.
    await shift.toPages();
    await browser.execute(() => {
      setTimeout(() => (globalThis as unknown as { browser: { runtime: { reload(): void } } }).browser.runtime.reload(), 50);
    });
    await browser.waitUntil(async () => !(await browser.getWindowHandles()).includes(shift.pagesTab), { timeout: 15_000, timeoutMsg: 'the extension’s own page did not close with the reload' });
    await shift.toStand();
    // The new instance came into the open tab late, cleared what the dead one left, and asks for a reload of the tab.
    const fresh = await waitForReport((report) => report.startedAt !== before?.startedAt && report.dock?.status === 'reload-needed', 'the reloaded extension asks to reload the tab', 30_000);
    expect(fresh.lifecycle?.lateInjection).toBe(true);
    expect(fresh.lifecycle?.staleHosts).toBeGreaterThan(0);
    expect(fresh.dock).toMatchObject({ banner: 'CG-RUNTIME-RELOADED', result: null });
    expect(Object.values(fresh.dock?.actions ?? { none: true }).some(Boolean)).toBe(false);
    const said = await oursText('dock');
    expect(said).toContain('CG-RUNTIME-RELOADED');
    expect(said).toContain('расширение обновилось, перезагрузите вкладку');
    // One host of each kind on the page: the dead instance's dock is gone.
    expect(await browser.execute(() => document.querySelectorAll('[data-host="dock"]').length)).toBe(1);
    // The stream was cut with the old background; nobody asked the hub again.
    await browser.pause(1500);
    expect(await streams(hubMark)).toEqual(['aborted']);

    await pressOurs('dock', 'button', /^Перезагрузить вкладку/);
    await waitForChatReady(ACC, a2, 20_000);
    const back = await dockIs((d) => d.status === 'ready' && d.actions['reply'] === true, 'the dock after the tab was reloaded', 30_000);
    // The sign-in survived the reload; the session's results went with the old instance — nothing half-made is left behind.
    expect(back).toMatchObject({ login: 'chatter1', banner: null, result: null });
    expect(await composerText(ACC, a2)).toBe('');
    await hub().command({ op: 'config', patch: { aiChunkDelayMs: 0 } });
    await pressOurs('dock', '.cg-strip button', /^Reply/);
    expect((await dockIs((d) => d.result?.state === 'done', 'a generation after the reload', 20_000)).result?.parts).toBe(2);
    expect(await streams(hubMark)).toEqual(['aborted', 'done']);
  });
});
