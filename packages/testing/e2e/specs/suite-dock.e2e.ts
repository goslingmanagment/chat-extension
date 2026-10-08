// §12 п. 4 on the wired extension, part 1 — the dock over the open chat
// (architecture.md §6.3, §6.4): the TEST build on the ChatSpace-like stand
// against the fake hub, the real dock over its real controllers, every press
// a real click or key. What it proves end to end:
// - the dock stands above the composer of the open chat and moves with the
//   chat; ChatSpace's own message list keeps its bottom while our result
//   opens under it, keeps the message under the eyes in the middle of the
//   history, and keeps its bottom on a resize of the window;
// - Б2: a part is never written over the person's own draft without their
//   answer — «Отмена» writes nothing, «Добавить в конец» keeps their words,
//   «Заменить» replaces them only by its own click; the question takes the
//   focus on «Отмена», so a stray Enter or Space right after it appears
//   writes nothing (X18);
// - the answer is for one revision of the draft: typing A→B→A, formatting,
//   ChatSpace's translator and a restored draft each make it stale — the old
//   answer writes nothing and the question is asked anew;
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

import { bridgeWrites, clearDraft, composerText, EDITOR, listAnchor, MOD, pageJournal, pageJournalMark, pressSend, scrollList, twoFrames, typeDraft, waitForComposerText } from '../support/chat';
import { useFakeHub } from '../support/fake-hub';
import { useNetworkTrap } from '../support/network-trap';
import { oursExists, oursFocus, oursText, pressOurs, waitOursByText, waitOursText } from '../support/ours';
import { dockIs, startShift, type Shift } from '../support/shift';
import { callStand, composerRoots, dockPlacement, foreignCalls, STAND_IDS, standServer, waitForChatReady } from '../support/stand';
import { setViewport } from '../support/visual';

const ACC = STAND_IDS.accounts.a;
const { a1, a2, a4, a5 } = STAND_IDS.fans;
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
      expect(ready).toMatchObject({ kind: 'in-flow', inFlowFirstChild: true, height: 34, result: null });
      await atBottom('the list is at its bottom before anything of ours opens');
      // A healthy shift with the preview send off (the pilot's default) has no error of the day: X8's anchors are switched off, not broken.
      const healthy = await shift.rpc<{ counters: Record<string, number> }>('diagnostics.get');
      expect(healthy.ok ? healthy.payload.counters : null).toEqual({});

      await generate();
      await twoFrames();
      const open = await dockIs((d) => d.result?.state === 'done', 'the result is on screen');
      // The sheet took its place from ChatSpace's list, not from the page.
      expect(open.height).toBeGreaterThan(34 + 60);
      await atBottom('the list lost its bottom when the result opened');
      expect(await browser.execute(() => document.documentElement.scrollHeight <= window.innerHeight && document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      await pressOurs('dock', '.cg-dock button', /^Скрыть/);
      await browser.waitUntil(async () => (await dockIs(() => true, 'the dock')).height === 34, { timeout: 5000, timeoutMsg: 'the dock did not collapse to its strip' });
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
      await browser.waitUntil(async () => (await dockIs(() => true, 'the dock')).height === 34, { timeout: 5000, timeoutMsg: 'the dock did not collapse to its strip' });
      await twoFrames();
      await same('the message at the top moved when the result was hidden');
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

  describe('Б2 — the person’s own draft (§6.4)', () => {
    const [part1, part2] = reply(a2);

    before(async () => {
      await open(a2);
      await typeDraft('my own words');
      await generate();
    });

    it('[NEW-05] [UI-020] «Вставить» over a typed draft asks and writes nothing; «Отмена» leaves the draft as it was', async () => {
      const mark = await pageJournalMark();
      await pressOurs('dock', '[data-cg-part="0"] button', /^Вставить/);
      await waitOursText('dock', HUMAN_DRAFT, 'the question about the person’s own text');
      expect(await composerText(ACC, a2)).toBe('my own words');
      for (const answer of ['Заменить', 'Добавить в конец', 'Отмена']) await waitOursByText('dock', '[data-cg-part="0"] button', new RegExp(`^${answer}`), `the answer «${answer}» of the question`);
      await pressOurs('dock', '[data-cg-part="0"] button', /^Отмена/);
      await waitOursText('dock', HUMAN_DRAFT, 'the question is gone', { gone: true });
      expect(await composerText(ACC, a2)).toBe('my own words');
      expect(await writesSince(mark)).toEqual([]);
      expect((await dockIs(() => true, 'the dock')).result).toMatchObject({ inserted: 0, state: 'done' });
    });

    it('[NEW-05] [UI-020] a stray Enter or Space right after the question appears is «Отмена» (X18): the field keeps the person’s words, nothing is written', async () => {
      const mark = await pageJournalMark();
      for (const [name, key] of [['Enter', Key.Enter], ['Space', Key.Space]] as const) {
        await pressOurs('dock', '[data-cg-part="0"] button', /^Вставить/, `${name}: «Вставить»`);
        await waitOursText('dock', HUMAN_DRAFT, `${name}: the question about the person’s own text`);
        expect((await oursFocus('dock'))?.text).toMatch(/^Отмена/);
        await browser.keys(key);
        await waitOursText('dock', HUMAN_DRAFT, `${name}: the question is gone`, { gone: true });
        expect(await composerText(ACC, a2)).toBe('my own words');
      }
      await browser.pause(400);
      expect(await composerText(ACC, a2)).toBe('my own words');
      expect(await writesSince(mark)).toEqual([]);
      expect((await dockIs(() => true, 'the dock')).result).toMatchObject({ inserted: 0, state: 'done' });
    });

    it('[NEW-05] «Добавить в конец» keeps the person’s words and adds the part after them — one write, into this chat’s field', async () => {
      const mark = await pageJournalMark();
      await pressOurs('dock', '[data-cg-part="0"] button', /^Вставить/);
      await waitOursText('dock', HUMAN_DRAFT, 'the question about the person’s own text');
      await pressOurs('dock', '[data-cg-part="0"] button', /^Добавить в конец/);
      await waitForComposerText(ACC, a2, `my own words\n${part1}`, 'the part is appended to the person’s words');
      await dockIs((d) => d.result?.inserted === 1, 'the part is marked inserted');
      expect((await writesSince(mark)).map((write) => write.chatId)).toEqual([a2]);
    });

    it('[NEW-05] the next part asks again — the person’s words are still in the field — and «Заменить» replaces them only by its own click', async () => {
      const mark = await pageJournalMark();
      await pressOurs('dock', '[data-cg-part="1"] button', /^Вставить/);
      await waitOursText('dock', HUMAN_DRAFT, 'the question about the person’s own text, again');
      expect(await composerText(ACC, a2)).toBe(`my own words\n${part1}`);
      expect(await writesSince(mark)).toEqual([]);
      await pressOurs('dock', '[data-cg-part="1"] button', /^Заменить/);
      await waitForComposerText(ACC, a2, part2, 'the field holds the second part alone');
      expect((await writesSince(mark)).map((write) => write.chatId)).toEqual([a2]);
    });
  });

  describe('[AI-022] the answer is for one revision of the draft', () => {
    /** With the question standing, the person changes the draft with `change`; the old answer then writes nothing and the question is asked anew. */
    const staleAnswer = async (label: string, change: () => Promise<void>, answer: RegExp, expected: () => Promise<void>): Promise<void> => {
      await pressOurs('dock', '[data-cg-part="0"] button', /^Вставить/, `${label}: «Вставить»`);
      await waitOursText('dock', HUMAN_DRAFT, `${label}: the question about the person’s own text`);
      const mark = await pageJournalMark();
      await change();
      await pressOurs('dock', '[data-cg-part="0"] button', answer, `${label}: the answer to the old question`);
      await waitOursText('dock', DRAFT_CHANGED, `${label}: the question about the changed draft`);
      expect(await writesSince(mark)).toEqual([]);
      await expected();
      await pressOurs('dock', '[data-cg-part="0"] button', /^Отмена/);
      await waitOursText('dock', DRAFT_CHANGED, `${label}: the question is gone`, { gone: true });
      expect(await writesSince(mark)).toEqual([]);
    };

    before(async () => {
      await open(a5, true);
      await typeDraft('A');
      await generate();
    });

    it('typing A→B→A: the text is the same, the revision is not', async () => {
      await staleAnswer(
        'A→B→A',
        async () => {
          await $(EDITOR).click();
          await browser.keys([Key.Backspace, 'B', Key.Backspace, 'A']);
        },
        /^Заменить/,
        async () => expect(await composerText(ACC, a5)).toBe('A'),
      );
    });

    it('formatting: the same letters in bold are another draft', async () => {
      await staleAnswer(
        'formatting',
        async () => {
          await $(EDITOR).click();
          await browser.keys([MOD, 'a']);
          await browser.keys([MOD, 'b']);
        },
        /^Добавить в конец/,
        async () => {
          const state = await callStand('composerState', ACC, a5);
          expect([state?.text, state?.marks['bold']]).toEqual(['A', true]);
        },
      );
    });

    it('ChatSpace’s translator rewrites the field on Send: the old answer does not write over its text', async () => {
      await callStand('setPermissions', ['om_message_translator'], true);
      await callStand('setTranslator', ACC, { enabled: true, autoTranslate: true });
      await standServer.script(ACC, a5, [{ kind: 'hang' }]);
      try {
        await pressOurs('dock', '[data-cg-part="0"] button', /^Вставить/);
        await waitOursText('dock', HUMAN_DRAFT, 'the question about the person’s own text');
        const mark = await pageJournalMark();
        const before = await callStand('composerState', ACC, a5);
        // The person presses ChatSpace's Send: its translator clears the field and writes the translation (the send itself hangs on the stand).
        await pressSend();
        await browser.waitUntil(async () => (await callStand('composerState', ACC, a5))?.html !== before?.html, { timeout: 5000, timeoutMsg: 'the translator did not touch the field' });
        const translated = await composerText(ACC, a5);
        await pressOurs('dock', '[data-cg-part="0"] button', /^Заменить/);
        await browser.pause(400);
        // Whatever the field holds now is ChatSpace's and the person's: our part was not written by the stale answer.
        expect(await writesSince(mark)).toEqual([]);
        expect(await composerText(ACC, a5)).toBe(translated);
        expect(await composerText(ACC, a5)).not.toContain(reply(a5)[0]);
      } finally {
        await callStand('setTranslator', ACC, { enabled: false, autoTranslate: false });
        await callStand('setPermissions', [], true);
      }
    });

    it('a restored draft (the chat tab closed and opened again) is a new field: the answer given to the old one writes nothing', async () => {
      await open(a4, true);
      await typeDraft('kept by ChatSpace');
      await generate();
      await pressOurs('dock', '[data-cg-part="0"] button', /^Вставить/);
      await waitOursText('dock', HUMAN_DRAFT, 'the question about the person’s own text');
      await callStand('closeActiveChatTab');
      await open(a4, true);
      // ChatSpace restored its draft from its own storage; the chat's result — and its open question — are ours and came back with the chat.
      expect(await composerText(ACC, a4)).toBe('kept by ChatSpace');
      const back = await dockIs((d) => d.target?.endsWith(`:${a4}`) === true && d.result?.state === 'done', 'the chat’s result is still there');
      expect(back.result?.inserted).toBe(0);
      await waitOursText('dock', HUMAN_DRAFT, 'the question came back with its chat');
      // The question was about the old field. Its answer is void for the restored one: nothing is written, the person is asked about this field.
      const mark = await pageJournalMark();
      await pressOurs('dock', '[data-cg-part="0"] button', /^Заменить/);
      await waitOursText('dock', DRAFT_CHANGED, 'the restored text needs the person’s own answer');
      expect(await composerText(ACC, a4)).toBe('kept by ChatSpace');
      expect(await writesSince(mark)).toEqual([]);
      await pressOurs('dock', '[data-cg-part="0"] button', /^Заменить/);
      await waitForComposerText(ACC, a4, reply(a4)[0], 'the part replaced the restored draft by the person’s click');
      expect((await writesSince(mark)).map((write) => write.chatId)).toEqual([a4]);
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
