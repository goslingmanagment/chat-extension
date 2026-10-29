import { afterEach, describe, expect, it, vi } from 'vitest';

import { OUTREACH_MEDIA_HANDLE, type MediaItem, type SendAttemptView, type UiAction } from '@cg/contracts';
import { createPageContext, fanHandle, parseFanHandle, Surfaces, type PreviewDirectory, type PreviewSendClick } from '@cg/core/application/boards';
import { createPreviewController } from '@cg/core/application/preview';
import { createI18n } from '@cg/core/domain/i18n';
import { FakeHostPort, hostAccount, memory, startSnapshot } from '@cg/testing/host';
import { BOOTSTRAP_PILOT_PAGES, meta } from '@cg/testing/hub';

import { settingsWithPersona } from './support/ai-background';
import { BoardsBackground } from './support/boards-background';
import { FakeClock, sequentialIds, settle } from './support/clock';
import { checkpointFor, NOW_MS, persona, session, uuid, withX8, WORLD } from './support/world';

const BOOTSTRAP = withX8(BOOTSTRAP_PILOT_PAGES);
const OTHER_ACCOUNT = { ...hostAccount, hostAccountId: '1002', platformAccountId: '3004' };
const mediaItem = (id: string): MediaItem => ({ id, type: 'video', duration: 30, ready: true, thumb: null, createdAt: null });
type Change = 'page' | 'user';

afterEach(() => vi.restoreAllMocks());

async function world() {
  const clock = new FakeClock(NOW_MS);
  const bg = new BoardsBackground({
    clock,
    call: () => Promise.resolve({ status: 404, body: { error: 'not_found' } }),
    session,
    bootstrap: BOOTSTRAP,
    settings: settingsWithPersona({
      personas: { scope: { hubOrigin: session.hubOrigin, userId: session.userId }, byPageId: { '11': persona, '12': persona } },
    }),
    catalog: { personas: [{ ...persona, displayName: 'Model', version: 1, status: 'active' }] },
    tab: uuid(0xa1),
    instanceId: WORLD.instanceId,
  });
  const host = new FakeHostPort({
    start: startSnapshot,
    memory,
    checkpoint: null,
    answers: {},
    media: { folders: [], items: { all: ['501', '502', '601'].map(mediaItem) } },
    timeline: [{ kind: 'event', at: 0, event: { type: 'route', route: { epoch: 6, name: 'chat', account: OTHER_ACCOUNT, chat: null } } }],
  });
  vi.spyOn(host, 'checkpoint').mockImplementation((chat) => Promise.resolve(checkpointFor(chat.platformFanId, { hostAccountId: chat.hostAccountId })));
  const context = createPageContext({ rpc: bg.rpc, host });
  await context.refresh();
  expect(context.current().phase).toBe('ready');
  const directory: PreviewDirectory = {
    resolve(handle) {
      const fan = parseFanHandle(handle);
      if (fan === null || fan.source !== 'outreach') return null;
      return { ...fan, handle, name: 'Fan', username: null, lifetime: null, period30: null, weWroteAt: null, fanWroteAt: null, newcomer: null };
    },
    neighbours: () => ({ previous: null, next: null }),
    subscribe: () => () => undefined,
  };
  let attempt = 0;
  const send = vi.fn((_click: PreviewSendClick): Promise<SendAttemptView> => Promise.resolve({ attemptId: uuid(0x500 + attempt++), state: 'uncertain', code: 'CG-SEND-UNCERTAIN' }));
  const controller = createPreviewController({
    rpc: bg.rpc,
    host,
    i18n: createI18n({ language: 'ru', now: () => clock.now(), timeZone: 'Europe/Moscow' }),
    clock,
    ids: sequentialIds(0x9000),
    context,
    surfaces: new Surfaces(),
    navigator: { open: () => Promise.resolve({ state: 'navigated', routeEpoch: 1, insert: null }) },
    directories: { spenders: null, newcomers: null, palette: null, outreach: directory, online: null, queue: null },
    greeting: null,
    sender: { send, onView: () => () => undefined },
    drafts: null,
    clipboard: null,
    notifier: null,
  });
  expect(controller.setOutreach(true)).toBe(true);
  const dispatch = async (action: UiAction): Promise<void> => {
    expect(await controller.dispatch(action)).toMatchObject({ ok: true });
    await settle();
  };
  const pick = async (paid = '501', price = '25', free: string | null = '502'): Promise<void> => {
    await dispatch({ type: 'SetMediaOpen', targetHandle: OUTREACH_MEDIA_HANDLE, open: true });
    await dispatch({ type: 'PickMedia', targetHandle: OUTREACH_MEDIA_HANDLE, mediaId: paid, free: false });
    if (free !== null) await dispatch({ type: 'PickMedia', targetHandle: OUTREACH_MEDIA_HANDLE, mediaId: free, free: true });
    await dispatch({ type: 'SetMediaPrice', targetHandle: OUTREACH_MEDIA_HANDLE, text: price });
    await clock.advance(300);
  };
  let generation = 0;
  const generate = async (fan: string = WORLD.otherFan): Promise<string> => {
    const handle = fanHandle('outreach', context.current().binding?.pageId ?? 0, fan);
    const n = generation++;
    bg.streams.streamScript.push({ kind: 'stream', steps: [
      { kind: 'frame', frame: meta('improve-draft', { clientRequestId: uuid(0x100 + n), requestId: uuid(0x800 + n), pageLabel: context.current().binding?.pageLabel ?? '' }) },
      { kind: 'frame', frame: { type: 'content_delta', text: 'hey, I picked something for you' }, afterMs: 20 },
      { kind: 'frame', frame: { type: 'done', stopReason: 'end_turn' } },
    ] });
    const outcome = controller.batchStart('outreach', handle, 'fix', { draft: 'I picked something for you' });
    await settle(12);
    await clock.advance(500);
    expect(await outcome).toMatchObject({ s: 'ready' });
    return handle;
  };
  const change = async (kind: Change): Promise<void> => {
    const previousEpoch = context.current().epoch;
    if (kind === 'page') host.advance();
    else {
      bg.session = { ...session, userId: 8, epoch: session.epoch + 1 };
      bg.settings = { ...bg.settings, personas: { ...bg.settings.personas, scope: { hubOrigin: session.hubOrigin, userId: 8 } } };
    }
    await context.refresh();
    await settle(12);
    expect(context.current()).toMatchObject({ phase: 'ready', epoch: previousEpoch + 1 });
  };
  const dispose = (): void => {
    controller.dispose();
    context.dispose();
    host.dispose();
  };
  return { bg, host, context, controller, clock, send, pick, generate, change, dispose };
}

describe('outreach media belong to the current page and signed-in user', () => {
  it.each<Change>(['page', 'user'])('clears the offer and inherited media on a %s change before the new outreach sends', async (kind) => {
    const w = await world();
    try {
      await w.pick();
      const oldHandle = await w.generate();
      const offer = w.controller.outreachMedia();
      expect(offer).toMatchObject({ items: [{ id: '502', free: true }, { id: '501', free: false }], priceCents: 2500 });
      expect(w.controller.outreachRow(oldHandle)?.media).toEqual(offer);
      // An ordinary refresh of the same identity keeps the person's picks.
      await w.context.refresh();
      expect(w.controller.outreachMedia()).toEqual(offer);

      const observed: unknown[] = [];
      w.context.subscribe(() => observed.push(w.controller.outreachMedia()));
      const mediaReads = w.host.calls.media.length;
      await w.change(kind);
      expect(observed).toEqual([null]);
      expect(w.controller.outreachPicker()).toBeNull();
      const handle = await w.generate();
      expect(w.controller.outreachRow(handle)).toMatchObject({ media: null, ownMedia: false });
      expect(w.host.calls.media.slice(mediaReads)).toEqual([]);
      expect(w.send).not.toHaveBeenCalled();
      expect(await w.controller.outreachSend('SendOutreach', handle, true)).toMatchObject({ ok: true });
      expect(w.send).toHaveBeenCalledTimes(1);
      expect(w.send.mock.calls[0]?.[0].media).toBeUndefined();
      expect(w.send.mock.calls[0]?.[0].target.binding).toEqual(w.context.current().binding);

      // New picks still propagate normally, with only the new ids and price.
      await w.pick('601', '10', null);
      const next = await w.generate(WORLD.newFan);
      expect(await w.controller.outreachSend('SendOutreach', next, true)).toMatchObject({ ok: true });
      expect(w.send).toHaveBeenCalledTimes(2);
      expect(w.send.mock.calls[1]?.[0].media).toMatchObject({ items: [{ id: '601', free: false }], priceCents: 1000 });
      expect(w.bg.schemaFailures).toEqual([]);
    } finally {
      w.dispose();
    }
  });

  it.each<Change>(['page', 'user'])('keeps an in-flight send attachment intact across a %s change and never retries it', async (kind) => {
    const w = await world();
    try {
      await w.pick();
      const handle = await w.generate();
      const pending = Promise.withResolvers<SendAttemptView>();
      w.send.mockReturnValueOnce(pending.promise);
      const sending = w.controller.outreachSend('SendOutreach', handle, true);
      await settle(12);
      expect(w.send).toHaveBeenCalledTimes(1);
      const click = w.send.mock.calls[0]?.[0];
      const snapshot = structuredClone(click);
      expect(click?.media).toMatchObject({ items: [{ id: '502', free: true }, { id: '501', free: false }], priceCents: 2500 });

      await w.change(kind);
      expect(w.controller.outreachMedia()).toBeNull();
      expect(click).toEqual(snapshot);
      pending.resolve({ attemptId: uuid(0x501), state: 'uncertain', code: 'CG-SEND-UNCERTAIN' });
      expect(await sending).toMatchObject({ ok: true });
      await w.clock.advance(1000);
      expect(w.send).toHaveBeenCalledTimes(1);
      expect(w.controller.outreachMedia()).toBeNull();
      expect(w.controller.outreachRow(handle)).toBeNull();
      expect(w.bg.schemaFailures).toEqual([]);
    } finally {
      w.dispose();
    }
  });
});
