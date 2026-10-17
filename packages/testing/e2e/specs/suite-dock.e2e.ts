// §12 п. 4 on the wired extension, part 1 — the dock over the open chat
// (architecture.md §6.3, §6.4): the TEST build on the ChatSpace-like stand
// against the fake hub, the real dock over its real controllers, every press
// a real click or key. What it proves end to end:
// - the dock stands above the composer of the open chat and moves with the
//   chat; ChatSpace's own message list keeps its bottom while our result
//   opens under it, keeps the message under the eyes in the middle of the
//   history, and keeps its bottom on a resize of the window; near its bottom,
//   where ChatSpace holds the top message instead, the dock itself keeps the
//   last messages in view (UI-016, keep-bottom.ts);
// - Б2 after decision X45: «Вставить» over the person's own draft replaces it
//   by that click — one write into this chat's field, a CAS on the revision
//   read at the click — and one Ctrl/⌘+Z in ChatSpace's field brings their
//   words back (the write is one step of its editor's own history). The
//   question and its binding to one revision (A→B→A, formatting, the
//   translator, a restored draft) stand only where the write is not the
//   click's: MAIN's CAS is proven in host-adapter.e2e.ts, the question's
//   binding in the unit tests;
// - Fix writes nothing by itself: «Заменить мой черновик» is the explicit
//   replace, «Вернуть мой текст» restores the person's text only while the
//   field still holds what Fix wrote, and asks once they changed it;
// - every write went through ChatSpace's own composer bridge into the field
//   of the chat it was aimed at; nothing of ours reached the stand's server.
// The adapter's own rules of the insert have their spec without the extension
// (host-adapter.e2e.ts); here the whole chain is real: the click, the action
// gate, the controller, the background's token, the host port, MAIN.

import { $, browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';

import { bridgeWrites, clearDraft, composerText, EDITOR, listAnchor, MOD, pageJournal, pageJournalMark, scrollList, sendsOf, twoFrames, typeDraft, waitForComposerText } from '../support/chat';
import { useFakeHub } from '../support/fake-hub';
import { useNetworkTrap } from '../support/network-trap';
import { oursExists, oursText, pressOurs, waitOursByText, waitOursText } from '../support/ours';
import { dockIs, startShift, type Shift } from '../support/shift';
import { callStand, composerRoots, dockPlacement, foreignCalls, STAND_IDS, standServer, waitForChatReady } from '../support/stand';
import { setViewport } from '../support/visual';

const ACC = STAND_IDS.accounts.a;
const { a1, a2 } = STAND_IDS.fans;
/** The fake hub's model, with `aiNameFan`: each part says whose chat it was written for. */
const reply = (fan: string): readonly [string, string] => [`Hey you, thanks for writing! @${fan}`, `How was your day? @${fan}`];
const fixed = (fan: string): string => `Here is a smoother version of your draft. @${fan}`;
const HUMAN_DRAFT = 'В поле ввода уже есть ваш текст.';
const DRAFT_CHANGED = 'Текст в поле изменился после генерации.';

describe('§12 п. 4 on the wired extension — the dock over the open chat: its place, ChatSpace’s list, the guarded insert, Fix', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let shift: Shift;
  let journalStart = 0;

  const chatDock = (fan: string, message: string) => dockIs((d) => d.status === 'ready' && d.target !== null && d.target.endsWith(`:${fan}`), message);
  const open = async (fan: string, newTab = false): Promise<void> => {
    await callStand('openChat', ACC, fan, newTab ? { newTab: true } : {});
    await waitForChatReady(ACC, fan);
    await chatDock(fan, `the dock of chat ${fan}`);
  };
  /** Reply by a click on the strip; resolves with the finished result on screen. */
  const generate = async (button: RegExp = /^Reply/): Promise<void> => {
    const before = (await dockIs((d) => d.status === 'ready', 'the dock')).result?.opId ?? null;
    await pressOurs('dock', '.cg-strip button', button);
    await dockIs((d) => d.result !== null && d.result.opId !== before && d.result.state === 'done', 'the result', 20_000);
  };
  const writesSince = async (mark: number) => bridgeWrites(await pageJournal(mark));
  const atBottom = async (message: string): Promise<void> => {
    await browser.waitUntil(async () => (await callStand('messageList'))?.atBottom === true, { timeout: 3000, timeoutMsg: message });
  };

  before(async () => {
    await standServer.reset();
    journalStart = await standServer.mark();
    await hub().command({ op: 'config', patch: { aiNameFan: true } });
    shift = await startShift(hub(), { settings: { generation: { split: true } }, viewport: { width: 1280, height: 800 } });
  });

  // A test that failed with the Б2 question still standing does not fail the next ones as well: the question hides
  // «Вставить» of its part. Its «Отмена» writes nothing; the failure itself stays reported.
  afterEach(async function (this: Mocha.Context) {
    if (this.currentTest?.state !== 'failed' || !(await oursExists('dock', '.cg-confirm'))) return;
    await pressOurs('dock', '.cg-confirm button', /^Отмена/, 'after a failed test: «Отмена» of the question left standing');
    await browser.waitUntil(async () => !(await oursExists('dock', '.cg-confirm')), { timeout: 5000, timeoutMsg: 'after a failed test: the question left standing did not close' });
  });

  after(async () => {
    await setViewport(null);
    // §0.4, §9.6: not one insert was proven to land in another chat.
    const diagnostics = await shift.rpc<{ counters: Record<string, number> }>('diagnostics.get');
    expect(diagnostics.ok ? Object.entries(diagnostics.payload.counters).filter(([name, count]) => (name.startsWith('p1.') || name === 'CG-INSERT-MISPLACED') && count > 0) : null).toEqual([]);
    // §12 «Гейт безопасности»: nothing but the page's own client and the harness talked to the stand.
    expect(foreignCalls((await standServer.journal(journalStart)).entries)).toEqual([]);
  });

  describe('where the dock stands and what ChatSpace’s list does', () => {
    it('[UI-001] [UI-016] the dock appears above the composer of the open chat; a result opening under the list keeps the list at its bottom', async () => {
      const ready = await dockIs((d) => d.status === 'ready' && d.actions['reply'] === true, 'the dock is ready with Reply on');
      const roots = await composerRoots();
      expect(roots.active).toHaveLength(1);
      expect(await dockPlacement()).toEqual({ hosts: 1, parentKey: roots.active[0], firstChild: true, visible: true });
      expect(ready).toMatchObject({ kind: 'in-flow', inFlowFirstChild: true, height: 40, result: null });
      await atBottom('the list is at its bottom before anything of ours opens');
      // A healthy shift with the preview send off (the pilot's default) has no error of the day: X8's anchors are switched off, not broken.
      const healthy = await shift.rpc<{ counters: Record<string, number> }>('diagnostics.get');
      expect(healthy.ok ? healthy.payload.counters : null).toEqual({});

      await generate();
      await twoFrames();
      const open = await dockIs((d) => d.result?.state === 'done', 'the result is on screen');
      // The sheet took its place from ChatSpace's list, not from the page.
      expect(open.height).toBeGreaterThan(40 + 60);
      await atBottom('the list lost its bottom when the result opened');
      expect(await browser.execute(() => document.documentElement.scrollHeight <= window.innerHeight && document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      await pressOurs('dock', '.cg-dock button', /^Скрыть/);
      await browser.waitUntil(async () => (await dockIs(() => true, 'the dock')).height === 40, { timeout: 5000, timeoutMsg: 'the dock did not collapse to its bar' });
      await twoFrames();
      await atBottom('the list lost its bottom when the result was hidden');
    });

    it('[UI-016] in the middle of the history the message under the eyes stays where it is while a result opens and hides', async () => {
      await scrollList('middle');
      const before = await listAnchor();
      expect(before.id).not.toBeNull();
      expect((await callStand('messageList'))?.atBottom).toBe(false);
      const same = async (message: string): Promise<void> => {
        let after = await listAnchor();
        await browser.waitUntil(
          async () => {
            after = await listAnchor();
            return after.id === before.id && Math.abs(after.offset - before.offset) <= 1;
          },
          { timeout: 3000, interval: 50, timeoutMsg: `${message}: ${JSON.stringify(before)} → ${JSON.stringify(after)}` },
        );
      };

      await generate();
      await twoFrames();
      await same('the message at the top moved when the result opened');
      expect((await callStand('messageList'))?.atBottom).toBe(false);
      await pressOurs('dock', '.cg-dock button', /^Скрыть/);
      await browser.waitUntil(async () => (await dockIs(() => true, 'the dock')).height === 40, { timeout: 5000, timeoutMsg: 'the dock did not collapse to its bar' });
      await twoFrames();
      await same('the message at the top moved when the result was hidden');
    });

    it('[UI-016] a few lines above its bottom ChatSpace’s list holds its top message by itself — the dock puts it at its bottom, so the last messages do not go under the result', async () => {
      await scrollList('near-bottom');
      expect((await callStand('messageList'))?.atBottom).toBe(false);
      await generate();
      await twoFrames();
      const open = await dockIs((d) => d.result?.state === 'done', 'the result is on screen');
      expect(open.height).toBeGreaterThan(40 + 60);
      await atBottom('the last messages went under the result: the list was near its bottom and was not put there');
      await pressOurs('dock', '.cg-dock button', /^Скрыть/);
      await browser.waitUntil(async () => (await dockIs(() => true, 'the dock')).height === 40, { timeout: 5000, timeoutMsg: 'the dock did not collapse to its bar' });
      await twoFrames();
      await atBottom('the list lost its bottom when the result was hidden');
    });

    it('[UI-016] a resize of the window with a result on screen keeps the list at its bottom and the dock in its place', async () => {
      await scrollList('bottom');
      await generate();
      await twoFrames();
      await atBottom('the list is at its bottom with the result open');
      try {
        await setViewport({ width: 1100, height: 700 });
        await twoFrames();
        await atBottom('the list lost its bottom on a resize with the result open');
        const narrow = await dockIs((d) => d.result?.state === 'done', 'the result is still on screen');
        expect(narrow).toMatchObject({ kind: 'in-flow', inFlowFirstChild: true });
        expect((await dockPlacement()).firstChild).toBe(true);
        // The sheet never takes the list away: it is capped (ui-design §3.2), ChatSpace's list keeps at least 160 px.
        expect((await callStand('messageList'))?.clientHeight ?? 0).toBeGreaterThanOrEqual(160);
      } finally {
        await setViewport({ width: 1280, height: 800 });
      }
      await twoFrames();
      await atBottom('the list lost its bottom when the window grew back');
    });

    it('[UI-001] [UI-012] the dock moves with the chat: one host, always the first child of the active composer, and each chat has its own result', async () => {
      const first = (await composerRoots()).active[0];
      await open(a2, true);
      const second = (await composerRoots()).active[0];
      expect(second).not.toBe(first);
      await browser.waitUntil(async () => (await dockPlacement()).parentKey === second, { timeout: 5000, timeoutMsg: 'the dock did not move to the second chat’s composer' });
      expect(await dockPlacement()).toEqual({ hosts: 1, parentKey: second, firstChild: true, visible: true });
      expect((await chatDock(a2, 'the dock of the second chat')).result).toBeNull();
      await open(a1);
      await browser.waitUntil(async () => (await dockPlacement()).parentKey === first, { timeout: 5000, timeoutMsg: 'the dock did not come back to the first chat’s composer' });
      const back = await dockIs((d) => d.target?.endsWith(`:${a1}`) === true && d.result !== null, 'the first chat’s result is back with its chat');
      expect(back.text).toContain(reply(a1)[0]);
      await atBottom('the list of the first chat is at its bottom after the switch back');
    });
  });

  describe('Б2 — the person’s own draft (§6.4; decision X45: the click is the consent, the field’s undo brings it back)', () => {
    const [part1, part2] = reply(a2);

    before(async () => {
      await open(a2);
      await typeDraft('my own words');
      await generate();
      // The person reads the answer before the click. Within 500 ms of the last keystroke TipTap's history would
      // fold the write into that typing (its `newGroupDelay`): the undo would then also take back the last letters.
      await browser.pause(600);
    });

    it('[NEW-05] [UI-020] «Вставить» over a typed draft replaces it at once — one write, into this chat’s field, and no question', async () => {
      const mark = await pageJournalMark();
      await pressOurs('dock', '[data-cg-part="0"] button', /^Вставить/);
      await waitForComposerText(ACC, a2, part1, 'the part replaced the person’s words by the click');
      expect(await oursExists('dock', '.cg-confirm')).toBe(false);
      expect(await oursText('dock')).not.toContain(HUMAN_DRAFT);
      await dockIs((d) => d.result?.inserted === 1, 'the part is marked inserted');
      expect((await writesSince(mark)).map((write) => write.chatId)).toEqual([a2]);
    });

    it('[UI-020] Ctrl/⌘+Z in ChatSpace’s field brings the person’s words back: our write is one step of its editor’s own history', async () => {
      const mark = await pageJournalMark();
      // After the insert the focus is in the field (UI-019): one press of the person’s own undo, nothing of ours.
      await $(EDITOR).click();
      await browser.keys([MOD, 'z']);
      await waitForComposerText(ACC, a2, 'my own words', 'one undo restored the person’s words');
      expect(await writesSince(mark)).toEqual([]);
    });

    it('[NEW-05] the next part over the restored words replaces them at once as well; nothing is ever sent', async () => {
      const standMark = await standServer.mark();
      const mark = await pageJournalMark();
      await pressOurs('dock', '[data-cg-part="1"] button', /^Вставить/);
      await waitForComposerText(ACC, a2, part2, 'the field holds the second part alone');
      expect((await writesSince(mark)).map((write) => write.chatId)).toEqual([a2]);
      await browser.pause(400);
      expect(sendsOf((await standServer.journal(standMark)).entries)).toEqual([]);
    });
  });

  describe('Fix: the explicit replace and «Вернуть мой текст» (§6.4 п. 4)', () => {
    const MINE = 'fix me pls';

    before(async () => {
      // One part: Fix shows the person's text next to the fixed one (a Split Fix is plain parts).
      await shift.patch({ generation: { split: false } });
      await open(a1);
      await clearDraft();
      await typeDraft(MINE);
      await dockIs((d) => d.actions['fix'] === true, 'Fix is on: the field holds a draft');
    });

    it('[AI-020] [AI-022] Fix writes nothing by itself: the field keeps the person’s text until «Заменить мой черновик»', async () => {
      const mark = await pageJournalMark();
      await generate(/^Fix/);
      const text = await oursText('dock');
      expect(text).toContain(MINE);
      expect(text).toContain(fixed(a1));
      expect(await composerText(ACC, a1)).toBe(MINE);
      expect(await writesSince(mark)).toEqual([]);
      await pressOurs('dock', '.cg-dock button', /^Заменить мой черновик/);
      await waitForComposerText(ACC, a1, fixed(a1), 'the fixed text replaced the draft');
      expect((await writesSince(mark)).map((write) => write.chatId)).toEqual([a1]);
    });

    it('[AI-022] «Вернуть мой текст» puts the person’s text back while the field still holds what Fix wrote — and the sheet is as before the replacement', async () => {
      const mark = await pageJournalMark();
      await pressOurs('dock', '.cg-dock button', /^Вернуть мой текст/);
      await waitForComposerText(ACC, a1, MINE, 'the person’s text is back');
      expect((await writesSince(mark)).map((write) => write.chatId)).toEqual([a1]);
      // Not «✓ Черновик заменён» over the person's own text: the sheet is as before the replacement, and the Fix can be applied again.
      await waitOursByText('dock', '.cg-dock button', /^Заменить мой черновик/, 'the replacement is undone on the sheet too');
      expect(await oursExists('dock', '.cg-fix__acts .cg-done')).toBe(false);
      const sheet = await oursText('dock', '.cg-fixbox');
      expect(sheet).toContain(MINE);
      expect(sheet).toContain(fixed(a1));
    });

    it('[AI-022] [NEW-05] once the person changed the fixed text, «Вернуть мой текст» asks instead of overwriting it', async () => {
      await pressOurs('dock', '.cg-dock button', /^Заменить мой черновик/);
      await waitForComposerText(ACC, a1, fixed(a1), 'the fixed text replaced the draft again');
      await $(EDITOR).click();
      await browser.keys([Key.End, '!']);
      await waitForComposerText(ACC, a1, `${fixed(a1)}!`, 'the person edited the fixed text');
      const mark = await pageJournalMark();
      await pressOurs('dock', '.cg-dock button', /^Вернуть мой текст/);
      await waitOursText('dock', DRAFT_CHANGED, 'the question about the changed draft');
      expect(await composerText(ACC, a1)).toBe(`${fixed(a1)}!`);
      expect(await writesSince(mark)).toEqual([]);
      await pressOurs('dock', '.cg-dock button', /^Отмена/);
      await waitOursText('dock', DRAFT_CHANGED, 'the question is gone', { gone: true });
      expect(await composerText(ACC, a1)).toBe(`${fixed(a1)}!`);
      expect(await writesSince(mark)).toEqual([]);
    });
  });
});
