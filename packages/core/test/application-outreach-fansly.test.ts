// «Рассылка» on Fansly (2026-10-25): each fan's version goes by our background's send — the fan's own version, the
// bundles picked from the page's «Copied …» list, the click's own token — one click, one message, one attempt. What
// went, or may have, never goes again from this window, «Очистить» included. The board, the batch and the channel
// are doubles: what is checked is what leaves the window.

import { describe, expect, it } from 'vitest';

import { type ActionReceipt, type OutreachWindowVM, type SettingsV1 } from '@cg/contracts';
import { Surfaces, fanHandle, type PageContextPort, type PageContextState, type TabRpc } from '@cg/core/application/boards';
import { OUTREACH_PACE_MS, createOutreachController, type OutreachAnswer, type OutreachBoardPort, type OutreachRequest } from '@cg/core/application/outreach';
import { createI18n } from '@cg/core/domain/i18n';
import { BOOTSTRAP_PILOT_PAGES } from '@cg/testing/hub';

import { settingsWithPersona } from './support/ai-background';
import { FakeClock, settle } from './support/clock';
import { FANSLY, NOW_MS, WORLD, fanslyAccount, fanslyBinding, session, withFanslyPage } from './support/world';

const BOOTSTRAP = withFanslyPage(BOOTSTRAP_PILOT_PAGES);
const SETTINGS: SettingsV1 = settingsWithPersona();
const READY: PageContextState = {
  phase: 'ready',
  blocker: null,
  session,
  bootstrap: BOOTSTRAP,
  account: fanslyAccount,
  binding: fanslyBinding,
  page: BOOTSTRAP.pages.find((page) => page.pageId === WORLD.pages.fansly.pageId) ?? null,
  settings: SETTINGS,
  persona: null,
  epoch: 1,
};
const context: PageContextPort = { current: () => READY, subscribe: () => () => undefined, refresh: () => Promise.resolve(), dispose: () => undefined };

const TOKEN = 'token-of-the-click-0001';
const BUNDLE = '700000000000000011';
const PREVIEW = '700000000000000012';
const MEDIA = '700000000000000013';
const WHALE = '700000000000000201';
const TOP = '700000000000000202';
const LOST = '700000000000000203';

type BoardIndex = NonNullable<ReturnType<OutreachBoardPort['list']>['index']>;
/** The preview as the window's batch writes the versions through it. */
type BatchPreviewPort = Parameters<ReturnType<typeof createOutreachController>['attachBatch']>[0];

/** Three payers of one tier, richest first; the board is read and settled. */
function boardOf(): BoardIndex {
  const row = (fanRef: string, name: string, usd: number) => ({ fanRef, name, username: name.toLowerCase().replace(' ', ''), lifetime: usd * 1000, period: null, fanWroteAt: null, weWroteAt: null, waiting: false, lastMessage: null, haystack: name.toLowerCase() });
  const rows = [row(WHALE, 'Jamie Carter', 1860), row(TOP, 'Daniel Brooks', 1120), row(LOST, 'Owen Hart', 900)];
  return {
    rows,
    shelves: [{ id: 'shelf-600-plus', range: { fromMills: 600_000, toMills: null }, rows }],
    loaded: rows.length,
    asOf: null,
    fetchedAt: new Date(NOW_MS).toISOString(),
    coverage: 'complete',
    byFan: new Map(rows.map((entry) => [entry.fanRef, entry])),
  } as unknown as BoardIndex;
}

function world(answer: (request: OutreachRequest) => OutreachAnswer = () => ({ ok: true, messageId: '700000000000000099' })) {
  const clock = new FakeClock(NOW_MS);
  const sent: OutreachRequest[] = [];
  const rpc = {
    request: (type: string) => Promise.resolve(type === 'token.issue' ? { ok: true, payload: { actionToken: TOKEN, expiresAt: NOW_MS + 10_000 } } : { ok: false, error: { code: 'CG-UNKNOWN' } }),
    onEvent: () => () => undefined,
  } as unknown as TabRpc;
  const index = boardOf();
  const board: OutreachBoardPort = {
    list: () => ({ index, loading: false, error: null, since: null }),
    recent: () => null,
    load: () => Promise.resolve(),
    seed: () => ({ picked: [], shelf: null }),
    info: () => null,
    // Owen's chat is nowhere to be found: nothing can go to him.
    group: (fanRef) => Promise.resolve(fanRef === LOST ? null : `81000000000000${fanRef.slice(-4)}`),
    openChat: (type) => Promise.resolve({ ok: true, type, outcome: 'done' }),
    subscribe: () => () => undefined,
  };
  const versions: Record<string, string> = { [WHALE]: 'welcome home ✈️ the second part is ready', [TOP]: 'how are the legs after leg day? 😅', [LOST]: 'missed you around here 🥺' };
  const batch: BatchPreviewPort = {
    batchStart: (_source, handle) => Promise.resolve({ s: 'ready', text: versions[handle.split(':').pop() ?? ''] ?? null }),
    batchLive: () => null,
    onBatch: () => () => undefined,
  };
  const outreach = createOutreachController({
    rpc,
    i18n: createI18n({ language: 'ru', now: () => clock.now(), timeZone: 'Europe/Moscow' }),
    clock,
    context,
    surfaces: new Surfaces(),
    board,
    own: {
      copied: () => Promise.resolve({ items: [{ contentType: 2, contentId: BUNDLE }, { contentType: 2, contentId: PREVIEW }, { contentType: 1, contentId: MEDIA }], checked: true }),
      send(request) {
        sent.push(request);
        return Promise.resolve(answer(request));
      },
    },
  });
  outreach.attachBatch(batch);
  const vm = (): OutreachWindowVM => outreach.getSnapshot({ of: 'outreach' });
  const handle = (fanRef: string): string => fanHandle('outreach', WORLD.pages.fansly.pageId, fanRef);
  const row = (fanRef: string) => vm().rows.find((entry) => entry.handle === handle(fanRef));
  const act = async (action: Parameters<typeof outreach.dispatch>[0]): Promise<ActionReceipt> => {
    const receipt = outreach.dispatch(action);
    if (receipt === null) throw new Error(`the window took no ${action.type}`);
    const answered = await receipt;
    await settle(12);
    return answered;
  };
  const send = (fanRef: string) => act({ type: 'SendOutreach', targetHandle: handle(fanRef) });
  /** The window open, the text typed, the three versions written by one click. */
  const written = async (): Promise<void> => {
    await act({ type: 'SetOutreach', open: true });
    await act({ type: 'SetOutreach', text: 'the sunset set is up' });
    expect(await act({ type: 'GenerateBatch', list: 'outreach' })).toMatchObject({ ok: true, outcome: 'started' });
    await clock.advance(10);
    await settle(12);
  };
  return { clock, sent, outreach, vm, row, act, send, written };
}

describe('[host:fansly] «Рассылка»: who gets what, by whose click', () => {
  it('each fan gets their own version and the copied bundles, in their own chat, by their own click and its token', async () => {
    const w = world();
    await w.written();
    // Every «Copied Bundle» goes by default, a «Copied Media» only when ticked.
    expect(w.vm().posts?.items).toEqual([
      { contentType: 2, contentId: BUNDLE, picked: true },
      { contentType: 2, contentId: PREVIEW, picked: true },
      { contentType: 1, contentId: MEDIA, picked: false },
    ]);
    expect([w.row(WHALE)?.state, w.row(TOP)?.state]).toEqual(['ready', 'ready']);
    // Writing sent nothing.
    expect(w.sent).toEqual([]);

    expect(await w.send(WHALE)).toMatchObject({ ok: true });
    // The half second after a click rests every «Отправить» of the window.
    expect((await w.send(TOP)).ok).toBe(false);
    await w.clock.advance(OUTREACH_PACE_MS);
    await settle(12);
    expect(await w.send(TOP)).toMatchObject({ ok: true });

    const attachments = [
      { contentType: 2, contentId: BUNDLE },
      { contentType: 2, contentId: PREVIEW },
    ];
    expect(w.sent).toEqual([
      { hostAccountId: FANSLY.creator, fanRef: WHALE, groupId: '810000000000000201', text: 'welcome home ✈️ the second part is ready', attachments, cause: { kind: 'click', actionToken: TOKEN }, composedWith: 'fix' },
      { hostAccountId: FANSLY.creator, fanRef: TOP, groupId: '810000000000000202', text: 'how are the legs after leg day? 😅', attachments, cause: { kind: 'click', actionToken: TOKEN }, composedWith: 'fix' },
    ]);
    expect(w.row(WHALE)).toMatchObject({ state: 'sent', send: null });
    expect(w.vm().totals).toMatchObject({ sent: 2, total: 3 });
  });

  it('a fan reached, or maybe reached, never gets it again from here — «Очистить» included; a fan with no chat gets nothing', async () => {
    const w = world((request) => (request.fanRef === TOP ? { ok: false, code: 'CG-SEND-UNCERTAIN' } : { ok: true, messageId: '700000000000000099' }));
    await w.written();
    await w.send(WHALE);
    await w.clock.advance(OUTREACH_PACE_MS);
    await settle(12);
    expect((await w.send(WHALE)).ok).toBe(false);
    await w.send(TOP);
    await w.clock.advance(OUTREACH_PACE_MS);
    await settle(12);
    expect(w.row(TOP)).toMatchObject({ state: 'uncertain', send: null });
    expect((await w.send(TOP)).ok).toBe(false);
    // Owen's chat is not found: refused before anything left, his version may be sent again by a new click.
    expect((await w.send(LOST)).ok).toBe(false);
    expect(w.row(LOST)).toMatchObject({ state: 'failed', code: 'CG-HOST-CHAT-NOT-FOUND', send: { kind: 'retry' } });
    await w.clock.advance(OUTREACH_PACE_MS);
    await settle(12);

    // «Очистить» lets go of what did not go: the sent and the uncertain stay with their marks, and nothing goes again.
    expect(await w.act({ type: 'ClearBatch', list: 'outreach' })).toMatchObject({ ok: true });
    expect([w.row(WHALE)?.state, w.row(TOP)?.state]).toEqual(['sent', 'uncertain']);
    expect(w.vm().rows.map((entry) => entry.handle.split(':').pop())).toEqual([WHALE, TOP]);
    expect(await w.act({ type: 'GenerateBatch', list: 'outreach' })).toMatchObject({ ok: true, outcome: 'noop' });
    expect((await w.send(WHALE)).ok).toBe(false);
    expect((await w.send(TOP)).ok).toBe(false);
    expect(w.sent.map((request) => request.fanRef)).toEqual([WHALE, TOP]);
  });
});
