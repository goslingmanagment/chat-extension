// §12 п. 4 on the wired extension, part 7 — degradation and restarts
// (architecture.md §6.2, §7, §13): the TEST build on the stand against the
// fake hub.
// - ChatSpace renders its composers again after a pause (the same chat, new
//   nodes, nothing MAIN hears of): the dock comes back over the new field;
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
//   brings the dock back.
// What the adapter does with each lost anchor has its spec without the
// extension (host-adapter.e2e.ts); here the person sees it — in the dock, in
// the preview, in the settings, in the popup.

import { $, browser, expect } from '@wdio/globals';

import { pilotPageFlags } from '../../src/fake-hub/config';
import { callsTo } from '../../src/fake-hub/journal';
import { suspendBackground } from '../support/background';
import { bridgeWrites, composerText, EDITOR, MOD, pageJournal, pageJournalMark, PANEL, queueAdds, waitForComposerText } from '../support/chat';
import { fillSessionStorage, freeSessionStorage, pageRpc, readReport, waitForReport } from '../support/extension';
import { QUIET_PAGE, testBuildPage, useFakeHub } from '../support/fake-hub';
import { useNetworkTrap } from '../support/network-trap';
import { oursExists, oursText, pressOurs, waitOursByText, waitOursText } from '../support/ours';
import { waitForOptions, waitForPopup } from '../support/pages';
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
  const statusPage = async (): Promise<{ readonly chatspace: { readonly level: string; readonly text: string }; readonly popupCodes: readonly string[]; readonly popupPills: readonly string[] }> => {
    await shift.toPages();
    try {
      await browser.url(testBuildPage('options.html#status'));
      const options = await waitForOptions((state) => state.rows['chatspace'] !== undefined && !['unknown', ''].includes(state.rows['chatspace'].level) && !state.rows['chatspace'].text.includes('проверяется'), '«Статус» read the tab’s host contract');
      await browser.url(testBuildPage('popup.html'));
      const popup = await waitForPopup((state) => state.view === 'ready' && !state.pills.join(' ').includes('проверяется'), 'the popup read the tab’s host contract');
      const row = options.rows['chatspace'];
      return { chatspace: { level: row?.level ?? '', text: row?.text ?? '' }, popupCodes: popup.codes, popupPills: popup.pills };
    } finally {
      await browser.url(testBuildPage(QUIET_PAGE));
      await shift.toStand();
    }
  };
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
    await browser.execute(() => document.querySelector('[data-cg="dock"]')?.parentElement?.setAttribute('data-e2e-before', ''));
    await callStand('remountComposers', REMOUNT_GAP_MS);
    const onNewField = async (): Promise<boolean> => browser.execute(() => document.querySelector('[data-cg="dock"]')?.parentElement?.matches('[data-stand-composer]:not([data-e2e-before])') === true);
    await browser.waitUntil(onNewField, { timeout: 5000, timeoutMsg: 'the dock did not come back over the re-rendered composer' });
    expect(await dockPlacement()).toEqual({ hosts: 1, parentKey: active, firstChild: true, visible: true });
    const back = await dockIs((d) => d.kind === 'in-flow' && d.inFlowFirstChild, 'the dock says it is in flow again');
    expect(back).toMatchObject({ status: 'ready', target: ready.target });
  });

  it('[RB-008] [ER-049] [DB-031] ChatSpace lost its send queue (the store is gone): the preview send is off with CG-SEND-HOST, the dock still generates and inserts; «Статус» names the anchor, the popup says «контракт частично»', async () => {
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
    expect(status.popupPills.join(' ')).toContain('контракт частично');
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
    expect(await browser.execute(() => document.querySelectorAll('[data-cg="dock"]').length)).toBe(1);
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
