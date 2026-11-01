// «Рассылки» on the hub (2026-11-01, the owner: the page's team works the outreaches together; hub
// docs/plans/2026-11-01-outreach-store/spec.md): every «Отправить» claims the fan at the hub before the site is asked,
// so a fan of an outreach gets one message whoever clicks, from any tab or computer; a colleague's send comes into the
// window; the hub not answering is a warning the person passes, and the send is told to the hub when it answers. The
// hub is the stand's own model (@cg/testing/fake-hub OutreachModel), shared by two people; the site is a double.

import { describe, expect, it } from 'vitest';

import { type ActionReceipt, type OutreachWindowVM, type SettingsV1 } from '@cg/contracts';
import { Surfaces, fanHandle, type PageContextPort, type PageContextState, type TabRpc } from '@cg/core/application/boards';
import { OUTREACH_PACE_MS, OUTREACH_PUSH_MS, OUTREACH_SAVE_MS, createOutreachController, type OutreachAnswer, type OutreachBoardPort, type OutreachHub, type OutreachRequest, type OutreachStorePort } from '@cg/core/application/outreach';
import { createI18n } from '@cg/core/domain/i18n';
import { OutreachModel } from '@cg/testing/fake-hub';
import { BOOTSTRAP_PILOT_PAGES } from '@cg/testing/hub';

import { settingsWithPersona } from './support/ai-background';
import { FakeClock, settle } from './support/clock';
import { NOW_MS, WORLD, fanslyAccount, fanslyBinding, session, withFanslyPage } from './support/world';

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

const WHALE = '700000000000000201';
const TOP = '700000000000000202';
const ME = { id: 7, name: 'dmitriy' };
const GRISHA = { id: 9, name: 'grisha' };
const PAGE = { pageLabel: 'fansly-page' } as Parameters<OutreachModel['list']>[0];

type BoardIndex = NonNullable<ReturnType<OutreachBoardPort['list']>['index']>;
type BatchPreviewPort = Parameters<ReturnType<typeof createOutreachController>['attachBatch']>[0];

function boardOf(): BoardIndex {
  const row = (fanRef: string, name: string, usd: number) => ({ fanRef, name, username: name.toLowerCase().replace(' ', ''), lifetime: usd * 1000, period: null, fanWroteAt: null, weWroteAt: null, waiting: false, lastMessage: null, haystack: name.toLowerCase() });
  const rows = [row(WHALE, 'Jamie Carter', 1860), row(TOP, 'Daniel Brooks', 1120)];
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

function memoryStore(): OutreachStorePort {
  let value: unknown;
  return {
    load: () => Promise.resolve(value === undefined ? undefined : structuredClone(value)),
    save(next) {
      value = structuredClone(next);
      return Promise.resolve();
    },
  };
}

/** The hub as one person's tab reaches it: the shared model, and a switch for «the hub does not answer». */
function hubOf(model: OutreachModel, me: { readonly id: number; readonly name: string }, clock: FakeClock): OutreachHub & { offline: boolean } {
  const wrap = <T>(read: { readonly ok: true; readonly body: T } | { readonly ok: false; readonly refusal: unknown }) => (read.ok ? { ok: true as const, value: read.body } : { ok: false as const, kind: 'refused' as const, code: 'CG-HUB-REQUEST' });
  const down = { ok: false as const, kind: 'offline' as const, code: 'CG-NETWORK' };
  const port = {
    offline: false,
    list: () => Promise.resolve(port.offline ? down : wrap(model.list(PAGE, me.id, clock.now()))),
    get: (_page: number, id: string) => Promise.resolve(port.offline ? down : wrap(model.get(PAGE, me.id, id, clock.now()))),
    save: (_page: number, id: string, body: Parameters<OutreachModel['save']>[3]) => Promise.resolve(port.offline ? down : wrap(model.save(PAGE, me, id, body, clock.now()))),
    send: (_page: number, id: string, body: Parameters<OutreachModel['send']>[3]) => Promise.resolve(port.offline ? down : wrap(model.send(PAGE, me, id, body, clock.now()))),
    touches: () => Promise.resolve(port.offline ? down : wrap(model.touched(PAGE, me.id, clock.now()))),
  };
  return port as OutreachHub & { offline: boolean };
}

function tab(model: OutreachModel, me: { readonly id: number; readonly name: string }, options: { readonly store?: OutreachStorePort; readonly start?: number; readonly answer?: (request: OutreachRequest) => OutreachAnswer } = {}) {
  const clock = new FakeClock(options.start ?? NOW_MS);
  const sent: OutreachRequest[] = [];
  const rpc = {
    request: (type: string) => Promise.resolve(type === 'token.issue' ? { ok: true, payload: { actionToken: 'token-of-the-click-0001', expiresAt: NOW_MS + 10_000 } } : { ok: false, error: { code: 'CG-UNKNOWN' } }),
    onEvent: () => () => undefined,
  } as unknown as TabRpc;
  const index = boardOf();
  const board: OutreachBoardPort = {
    list: () => ({ index, loading: false, error: null, since: null }),
    recent: () => null,
    load: () => Promise.resolve(),
    seed: () => ({ picked: [], shelf: null }),
    info: () => null,
    group: (fanRef) => Promise.resolve(`81000000000000${fanRef.slice(-4)}`),
    openChat: (type) => Promise.resolve({ ok: true, type, outcome: 'done' }),
    subscribe: () => () => undefined,
  };
  const versions: Record<string, string> = { [WHALE]: 'welcome home ✈️ the second part is ready', [TOP]: 'how are the legs after leg day? 😅' };
  const batch: BatchPreviewPort = {
    batchStart: (_source, handle) => Promise.resolve({ s: 'ready', text: versions[handle.split(':').pop() ?? ''] ?? null }),
    batchLive: () => null,
    onBatch: () => () => undefined,
  };
  const hub = hubOf(model, me, clock);
  const outreach = createOutreachController({
    rpc,
    i18n: createI18n({ language: 'ru', now: () => clock.now(), timeZone: 'Europe/Moscow' }),
    clock,
    context,
    surfaces: new Surfaces(),
    board,
    store: options.store ?? memoryStore(),
    hub,
    own: {
      copied: () => Promise.resolve({ items: [], checked: true }),
      send(request) {
        sent.push(request);
        return Promise.resolve(options.answer?.(request) ?? { ok: true, messageId: '700000000000000099' });
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
    await settle(16);
    return answered;
  };
  const send = (fanRef: string, anyway = false) => act({ type: 'SendOutreach', targetHandle: handle(fanRef), ...(anyway ? { anyway: true } : {}) });
  /** Time passes: the saves go to the hub. */
  const later = async (ms = OUTREACH_PUSH_MS + OUTREACH_SAVE_MS): Promise<void> => {
    await clock.advance(ms);
    await settle(24);
  };
  const written = async (): Promise<void> => {
    await act({ type: 'SetOutreach', open: true });
    await act({ type: 'SetOutreach', text: 'the sunset set is up' });
    expect(await act({ type: 'GenerateBatch', list: 'outreach' })).toMatchObject({ ok: true, outcome: 'started' });
    await clock.advance(10);
    await settle(16);
    await later();
  };
  return { clock, hub, sent, outreach, vm, row, act, send, later, written };
}

const idOf = (model: OutreachModel): string => {
  const list = model.list(PAGE, ME.id, NOW_MS);
  if (!list.ok) throw new Error('no list');
  const first = list.body.outreaches[0];
  if (first === undefined) throw new Error('no outreach on the hub');
  return first.outreachId;
};

describe('[host:fansly] «Рассылки» on the hub: one send per fan, whoever clicks', () => {
  it('the outreach reaches the hub with its versions, and a send is claimed there before the site is asked, then reported', async () => {
    const model = new OutreachModel();
    const me = tab(model, ME);
    await me.written();
    const id = idOf(model);
    const kept = model.get(PAGE, ME.id, id, me.clock.now());
    expect(kept.ok && kept.body.fans.map((fan) => [fan.fanRef, fan.version])).toEqual([
      [WHALE, 'welcome home ✈️ the second part is ready'],
      [TOP, 'how are the legs after leg day? 😅'],
    ]);
    expect(me.vm().sync).toBe('hub');
    expect(await me.send(WHALE)).toMatchObject({ ok: true });
    await me.later();
    const after = model.get(PAGE, ME.id, id, me.clock.now());
    expect(after.ok && after.body.fans.find((fan) => fan.fanRef === WHALE)?.send).toMatchObject({ state: 'sent', by: { name: 'dmitriy', isMe: true }, text: 'welcome home ✈️ the second part is ready', platformMessageId: '700000000000000099' });
  });

  it('a fan a colleague sent from the same outreach is never sent from here: the window says who sent it', async () => {
    const model = new OutreachModel();
    const me = tab(model, ME);
    await me.written();
    const id = idOf(model);
    // Grisha opened the same outreach on his computer and sent Jamie's version.
    const attemptId = '11111111-2222-4333-8444-555555555555';
    expect(model.send(PAGE, GRISHA, id, { action: 'claim', fanRef: WHALE, attemptId, text: 'welcome home ✈️ the second part is ready', media: null }, me.clock.now())).toMatchObject({ ok: true, body: { outcome: 'ok' } });
    model.send(PAGE, GRISHA, id, { action: 'sent', fanRef: WHALE, attemptId }, me.clock.now());
    expect(await me.send(WHALE)).toMatchObject({ ok: false, code: 'CG-SEND-BUSY' });
    expect(me.sent).toEqual([]);
    expect(me.row(WHALE)).toMatchObject({ state: 'sent', by: 'grisha' });
    // Daniel's version is still the window's to send.
    await me.clock.advance(OUTREACH_PACE_MS);
    expect(await me.send(TOP)).toMatchObject({ ok: true });
    expect(me.sent.map((request) => request.fanRef)).toEqual([TOP]);
  });

  it('the hub not answering is a warning the person passes; the send is told to the hub once it answers', async () => {
    const model = new OutreachModel();
    const me = tab(model, ME);
    await me.written();
    const id = idOf(model);
    me.hub.offline = true;
    expect(await me.send(WHALE)).toMatchObject({ ok: false, code: 'CG-HUB-UNAVAILABLE' });
    expect(me.sent).toEqual([]);
    expect(me.row(WHALE)).toMatchObject({ state: 'ready', warning: { kind: 'hub' }, send: { kind: 'anyway' } });
    await me.clock.advance(OUTREACH_PACE_MS);
    expect(await me.send(WHALE, true)).toMatchObject({ ok: true });
    expect(me.sent.map((request) => request.fanRef)).toEqual([WHALE]);
    me.hub.offline = false;
    await me.later(65_000);
    const after = model.get(PAGE, ME.id, id, me.clock.now());
    expect(after.ok && after.body.fans.find((fan) => fan.fanRef === WHALE)?.send).toMatchObject({ state: 'sent', by: { name: 'dmitriy' } });
  });

  it("a reload takes the hub's copy: what a colleague sent meanwhile stands, and is never sent from here", async () => {
    const model = new OutreachModel();
    const store = memoryStore();
    const first = tab(model, ME, { store });
    await first.written();
    first.outreach.dispose();
    await settle(16);
    const id = idOf(model);
    const attemptId = '11111111-2222-4333-8444-666666666666';
    model.send(PAGE, GRISHA, id, { action: 'claim', fanRef: TOP, attemptId, text: 'how are the legs after leg day? 😅', media: null }, NOW_MS + 4_000);
    model.send(PAGE, GRISHA, id, { action: 'sent', fanRef: TOP, attemptId }, NOW_MS + 4_000);
    // The page loads again.
    const again = tab(model, ME, { store, start: NOW_MS + 5_000 });
    await again.later();
    expect(again.row(TOP)).toMatchObject({ state: 'sent', by: 'grisha' });
    expect(again.row(WHALE)).toMatchObject({ state: 'ready', version: 'welcome home ✈️ the second part is ready' });
    expect((await again.send(TOP)).ok).toBe(false);
    expect(again.sent).toEqual([]);
  });

  it("a colleague's outreach is in «Рассылки» with its author, and opens where it was left", async () => {
    const model = new OutreachModel();
    model.seed(PAGE, { id: '22222222-3333-4444-8555-666666666666', author: GRISHA, text: 'new set, the gym one', agoMin: 30, fans: [{ fanRef: WHALE, version: 'hey Jamie, the gym one is up', sent: { agoMin: 20 } }, { fanRef: TOP, version: 'Daniel, leg day pics are up' }] }, NOW_MS);
    const me = tab(model, ME);
    await me.act({ type: 'SetOutreach', open: true });
    await me.later();
    expect(me.vm().saved).toMatchObject([{ id: '22222222-3333-4444-8555-666666666666', author: 'grisha', total: 2, sent: 1 }]);
    expect(await me.act({ type: 'SetOutreach', resume: '22222222-3333-4444-8555-666666666666' })).toMatchObject({ ok: true });
    expect(me.vm().author).toBe('grisha');
    expect(me.row(WHALE)).toMatchObject({ state: 'sent', by: 'grisha' });
    expect(me.row(TOP)).toMatchObject({ state: 'ready', version: 'Daniel, leg day pics are up' });
    expect(await me.send(TOP)).toMatchObject({ ok: true });
    expect(me.sent.map((request) => [request.fanRef, request.text])).toEqual([[TOP, 'Daniel, leg day pics are up']]);
  });
});
