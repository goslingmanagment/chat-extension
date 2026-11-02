// «Очереди» on Fansly (2026-10-29): what leaves the window. Each fan's text goes by our background's send, one click one
// message; «Отправить всем» of a template queue goes one fan at a time, a second apart, each fan reported to the hub once
// (`queues.done`, with its act and its template); an unknown outcome is reported as such and never sent again; a skip is
// one report with its reason; closing the window gives the untouched portion back. The hub and the channel are doubles.

import { describe, expect, it } from 'vitest';

import { BATCH_LIMITS, type ActionReceipt, type FanQueueItem, type FanQueueTake, type FanQueues, type QueueStripVM, type QueueWalkVM, type QueuesWindowVM, type SettingsV1 } from '@cg/contracts';
import { Surfaces, fanHandle, type PageContextPort, type PageContextState, type TabRpc } from '@cg/core/application/boards';
import { type OnlineSendAnswer, type OnlineSendRequest } from '@cg/core/application/online';
import { createQueuesController, createQueuesCount, fillQueueText, QUEUES_POLL_MS, QUEUES_SENT_READ_MS } from '@cg/core/application/queues';
import { createI18n } from '@cg/core/domain/i18n';
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

const PAGE_ID = WORLD.pages.fansly.pageId;
const TOKEN = 'token-of-the-click-0001';
const FANS = ['700000000000000301', '700000000000000302', '700000000000000303'] as const;
const NAMES = ['Mike', 'Jordan', null] as const;
const iso = (ms: number): string => new Date(ms).toISOString();

/** A cold follower of the queue's portion: the guide's B text the hub picked for him. */
function item(rank: number): FanQueueItem {
  const fanRef = FANS[rank] ?? FANS[0];
  return {
    fanRef,
    conversationRef: `81000000000000${fanRef.slice(-4)}`,
    username: `fan_${rank}`,
    displayName: NAMES[rank] === null ? null : `${NAMES[rank] ?? ''} Doe`,
    alias: null,
    greetingName: NAMES[rank] ?? null,
    lifetimeGrossMills: 0,
    last30dGrossMills: 0,
    seenAt: iso(NOW_MS - 3 * 3_600_000),
    onlineSince: null,
    seenSource: null,
    reason: 'never_wrote',
    reasonAt: null,
    act: 'template_b',
    aside: null,
    asideAt: null,
    asideBy: null,
    messageCount: 0,
    lastFanMessageAt: null,
    lastPageMessageAt: null,
    subscription: { isSubscriber: false, startedAt: null, endsAt: null, autoRenew: null },
    itemId: 100 + rank,
    queueId: 1,
    why: 'подписан 12 мар · ни разу не писал',
    leaseUntil: iso(NOW_MS + 30 * 60_000),
    templateId: `B${rank + 1}`,
    followedAt: null,
    massLast90d: { count: 3, lastAt: null },
  };
}

const LIST: FanQueues = {
  pageLabel: WORLD.pages.fansly.pageLabel,
  queues: [
    {
      queueId: 1,
      name: 'Холодные живые',
      goal: 'Познакомиться',
      kind: 'campaign',
      status: 'active',
      distribution: 'pool',
      mineOnly: false,
      scenario: { action: 'template', sendMode: 'batch', templates: 'b', texts: null, hint: null },
      ruleText: ['фолловеры', 'ни разу не писали'],
      requestedBy: 'Дмитрий',
      pausedAt: null,
      pausedBy: null,
      perPerson: 50,
      dailyLimit: 150,
      today: { mine: 12, page: 61 },
      pending: 1_948,
      leasedToMe: 0,
    },
  ],
  answered: [],
  templates: [
    { id: 'B1', group: 'b', text: 'hey love - we never actually talked?' },
    { id: 'B2', group: 'b', text: 'hey love 👋 shy or just picky?' },
    { id: 'B3', group: 'b', text: 'ok be honest love, quiet type?' },
  ],
  serverNow: iso(NOW_MS),
};
const TAKE: FanQueueTake = { queueId: 1, items: [item(0), item(1), item(2)], stopped: null, today: { mine: 12, page: 61 }, pending: 1_945, dropped: 0, left: [], results: { sent: 0, answered: 0, spentMills: 0 }, serverNow: iso(NOW_MS) };

function world(answer: (request: OnlineSendRequest) => OnlineSendAnswer = () => ({ ok: true, messageId: '700000000000000099' })) {
  const clock = new FakeClock(NOW_MS);
  const sent: OnlineSendRequest[] = [];
  const sentAt: number[] = [];
  const done: unknown[] = [];
  const released: unknown[] = [];
  const takes: unknown[] = [];
  let take: FanQueueTake = TAKE;
  let here: string | null = null;
  let strip: QueueWalkVM | null = null;
  let onRoute: () => void = () => undefined;
  let onSent: (fanRef: string) => void = () => undefined;
  const rpc = {
    request(type: string, payload: Record<string, unknown>) {
      if (type === 'token.issue') return Promise.resolve({ ok: true, payload: { actionToken: TOKEN, expiresAt: clock.now() + 10_000 } });
      if (type === 'queues.list') return Promise.resolve({ ok: true, payload: LIST });
      if (type === 'queues.take') {
        takes.push(payload);
        return Promise.resolve({ ok: true, payload: take });
      }
      if (type === 'queues.done') {
        done.push(payload);
        return Promise.resolve({ ok: true, payload: { itemId: payload['itemId'], state: payload['outcome'], today: { mine: 12 + done.length, page: 61 + done.length }, serverNow: iso(clock.now()) } });
      }
      if (type === 'queues.release') {
        released.push(payload);
        return Promise.resolve({ ok: true, payload: { released: 2 } });
      }
      return Promise.resolve({ ok: false, error: { code: 'CG-UNKNOWN' } });
    },
    onEvent: () => () => undefined,
  } as unknown as TabRpc;
  const queues = createQueuesController({
    rpc,
    i18n: createI18n({ language: 'ru', now: () => clock.now(), timeZone: 'Europe/Moscow' }),
    clock,
    context,
    surfaces: new Surfaces(),
    navigator: { open: () => Promise.resolve({ state: 'navigated' }) } as never,
    openChat: () => here,
    routed(listener) {
      onRoute = listener;
      return () => undefined;
    },
    sentHere(listener) {
      onSent = listener;
      return () => undefined;
    },
    strip(vm) {
      strip = vm;
    },
    own: {
      group: (_account, fan) => Promise.resolve(`81000000000000${fan.fanRef.slice(-4)}`),
      send(request) {
        sent.push(request);
        sentAt.push(clock.now());
        return Promise.resolve(answer(request));
      },
    },
  });
  queues.attachBatch({ batchStart: () => Promise.resolve({ s: 'ready', text: 'hey you 👋' }), batchLive: () => null, onBatch: () => () => undefined } as never);
  const vm = (): QueuesWindowVM => queues.getSnapshot({ of: 'queues' });
  const handle = (fanRef: string): string => fanHandle('queue', PAGE_ID, fanRef);
  const act = async (action: Parameters<typeof queues.dispatch>[0]): Promise<ActionReceipt> => {
    const receipt = queues.dispatch(action);
    if (receipt === null) throw new Error(`the window took no ${action.type}`);
    const answered = await receipt;
    await settle(12);
    return answered;
  };
  /** The window open on its first queue, the portion taken. */
  const opened = async (): Promise<void> => {
    await act({ type: 'SetQueues', open: true });
    await clock.advance(10);
    await settle(12);
  };
  /** The person's chat on the page, as the site's route says it. */
  const route = (fanRef: string | null): void => {
    here = fanRef;
    onRoute();
  };
  return {
    clock, sent, sentAt, done, released, takes, queues, vm, handle, act, opened, route,
    strip: (): QueueWalkVM | null => strip,
    sentFromChat: (fanRef: string): void => onSent(fanRef),
    answerTakes(next: FanQueueTake): void {
      take = next;
    },
  };
}

describe('[host:fansly] «Очереди»: what goes, to whom, and what the hub hears', () => {
  it('«Отправить всем»: each fan his own guide text with his name, one at a time, a second apart, each reported once', async () => {
    const w = world((request) => (request.fanRef === FANS[1] ? { ok: false, code: 'CG-SEND-UNCERTAIN' } : { ok: true, messageId: '700000000000000099' }));
    await w.opened();
    // The texts stand at once: nothing was written by the AI, nothing went.
    expect(w.vm().portion.map((row) => row.version)).toEqual(['hey Mike - we never actually talked?', 'hey Jordan 👋 shy or just picky?', 'ok be honest love, quiet type?']);
    expect(w.vm().batch).toMatchObject({ ready: 3, running: null });
    expect(w.sent).toEqual([]);

    expect(await w.act({ type: 'SendBatch', list: 'queue' })).toMatchObject({ ok: true, outcome: 'started' });
    for (let step = 0; step < 40; step += 1) await w.clock.advance(250);

    expect(w.sent.map((request) => [request.fanRef, request.text, request.cause.actionToken, request.composedWith])).toEqual([
      [FANS[0], 'hey Mike - we never actually talked?', TOKEN, 'hand'],
      [FANS[1], 'hey Jordan 👋 shy or just picky?', TOKEN, 'hand'],
      [FANS[2], 'ok be honest love, quiet type?', TOKEN, 'hand'],
    ]);
    expect((w.sentAt[1] ?? 0) - (w.sentAt[0] ?? 0)).toBeGreaterThanOrEqual(BATCH_LIMITS.sendGapMs);
    expect((w.sentAt[2] ?? 0) - (w.sentAt[1] ?? 0)).toBeGreaterThanOrEqual(BATCH_LIMITS.sendGapMs);
    // Once each, with what went; the unknown outcome counts as sent, flagged.
    expect(w.done).toEqual([
      { pageId: PAGE_ID, itemId: 100, outcome: 'sent', act: 'template', templateId: 'B1' },
      { pageId: PAGE_ID, itemId: 101, outcome: 'sent', act: 'template', templateId: 'B2', uncertain: true },
      { pageId: PAGE_ID, itemId: 102, outcome: 'sent', act: 'template', templateId: 'B3' },
    ]);
    expect(w.vm().batch?.running ?? null).toBeNull();

    // Nothing goes again from here: not by another «Отправить всем», not by the uncertain fan's own card.
    expect((await w.act({ type: 'SendBatch', list: 'queue' })).ok).toBe(false);
    expect((await w.act({ type: 'SendOnline', targetHandle: w.handle(FANS[1]) })).ok).toBe(false);
    await w.clock.advance(5_000);
    expect(w.sent).toHaveLength(3);
    expect(w.done).toHaveLength(3);
  });

  it('a skip is one report with its reason, the next card opens; closing gives the untouched portion back', async () => {
    const w = world();
    await w.opened();
    expect(w.vm().card?.handle).toBe(w.handle(FANS[0]));
    expect(await w.act({ type: 'SkipQueue', targetHandle: w.handle(FANS[0]), reason: 'not_fit' })).toMatchObject({ ok: true });
    expect(w.done).toEqual([{ pageId: PAGE_ID, itemId: 100, outcome: 'skipped', skipReason: 'not_fit' }]);
    expect(w.vm().card?.handle).toBe(w.handle(FANS[1]));
    expect(w.vm().card?.queue?.skipped ?? null).toBeNull();
    expect((await w.act({ type: 'SkipQueue', targetHandle: w.handle(FANS[0]), reason: 'later' })).ok).toBe(false);
    expect(w.done).toHaveLength(1);
    expect(w.sent).toEqual([]);

    await w.act({ type: 'SetQueues', open: false });
    expect(w.released).toEqual([{ pageId: PAGE_ID, queueId: 1 }]);
  });

  it('the queue in the chat: «Открыть чат» starts the walk, a send from the chat is seen at once and left to the hub to count', async () => {
    const w = world();
    await w.opened();
    await w.act({ type: 'Navigate', to: { kind: 'chat', targetHandle: w.handle(FANS[0]) } });
    w.route(FANS[0]);
    expect(w.strip()).toMatchObject({ kind: 'walk', name: 'Холодные живые', left: 3, today: 12, here: { state: 'todo', name: 'Mike Doe' }, next: { name: 'Jordan Doe' } });

    w.sentFromChat(FANS[0]);
    w.sentFromChat(FANS[0]);
    await settle(12);
    expect(w.strip()).toMatchObject({ left: 2, today: 13, here: { state: 'written' }, next: { handle: w.handle(FANS[1]) } });
    expect(w.vm().portion[0]?.state).toBe('sent');
    // No report from here, no card opens by itself: the hub counts it from the send's own report.
    expect(w.done).toEqual([]);
    expect(w.sent).toEqual([]);

    // The window closed in the chat: the portion stays the person's; each minute only renews it, nobody new comes.
    await w.act({ type: 'SetQueues', open: false });
    expect(w.released).toEqual([]);
    const before = w.takes.length;
    await w.clock.advance(QUEUES_SENT_READ_MS);
    await settle(12);
    expect(w.takes.slice(before)).toEqual([{ pageId: PAGE_ID, queueId: 1, count: 0, more: true }]);

    // A fan who is not of the queue: the strip stays, one line back to it.
    w.route('700000000000000999');
    expect(w.strip()).toMatchObject({ here: null, next: { handle: w.handle(FANS[1]) } });

    // The ×: the walk is over, who is not done goes back.
    await w.act({ type: 'SetQueues', walk: 'stop' });
    expect(w.released).toEqual([{ pageId: PAGE_ID, queueId: 1 }]);
    expect(w.strip()).toBeNull();
  });

  it('a portion held with no window open comes back after a reload; one list is looked at once, so the strip never takes itself up again', async () => {
    const w = world();
    const held: FanQueues = { ...LIST, queues: LIST.queues.map((queue) => ({ ...queue, leasedToMe: 3 })) };
    w.queues.noticeList(held);
    await settle(12);
    expect(w.takes).toEqual([{ pageId: PAGE_ID, queueId: 1, count: 0, more: true }]);
    expect(w.strip()).toMatchObject({ kind: 'walk', left: 3 });

    await w.act({ type: 'SetQueues', walk: 'stop' });
    w.queues.noticeList(held);
    await settle(12);
    expect(w.takes).toHaveLength(1);
    expect(w.strip()).toBeNull();
  });

  it('who the hub took out of the portion is said with why; what the person did to him themselves is not', async () => {
    const w = world();
    await w.opened();
    w.sentFromChat(FANS[1]);
    w.answerTakes({
      ...TAKE,
      items: [item(2)],
      left: [{ itemId: 100, fanRef: FANS[0], reason: 'fan_wrote' }, { itemId: 101, fanRef: FANS[1], reason: 'messaged' }],
      results: { sent: 1, answered: 0, spentMills: 0 },
    });
    await w.clock.advance(QUEUES_POLL_MS);
    await settle(12);
    expect(w.vm().gone).toEqual([{ name: 'Mike Doe', reason: 'fan_wrote' }]);
    expect(w.vm().results).toEqual({ sent: 1, answered: 0, spentMills: 0 });
    expect(w.vm().portion.map((row) => row.handle)).toEqual([w.handle(FANS[1]), w.handle(FANS[2])]);
  });

  it("the day's reminder: a queue with fans the person has not touched today, gone once seen off or walked, back on the next Moscow day", async () => {
    const clock = new FakeClock(NOW_MS);
    const saved: unknown[] = [];
    let list: FanQueues = { ...LIST, serverNow: '2026-11-02T10:00:00.000Z', queues: LIST.queues.map((queue) => ({ ...queue, today: { mine: 0, page: 0 }, leasedToMe: 0, pending: 25 })) };
    const count = createQueuesCount({
      clock,
      visible: () => true,
      page: () => ({ pageId: PAGE_ID }),
      read: () => Promise.resolve(list),
      nudges: { load: () => Promise.resolve(undefined), save: (value) => Promise.resolve(void saved.push(value)) },
    });
    await clock.advance(3_000);
    await settle(12);
    const nudge = (): QueueStripVM | null => count.strip();
    expect(nudge()).toMatchObject({ kind: 'nudge', waiting: 25, batch: true });

    count.dismissNudge();
    expect(nudge()).toBeNull();
    expect(saved).toEqual([{ [String(PAGE_ID)]: '2026-11-02' }]);

    list = { ...list, serverNow: '2026-11-02T21:30:00.000Z' };
    await clock.advance(60_000);
    await settle(12);
    // 00:30 in Moscow: another day.
    expect(nudge()).toMatchObject({ kind: 'nudge' });

    // A walk counts as the day's start: the reminder does not come back after it.
    const walk = { kind: 'walk' } as QueueWalkVM;
    count.setWalk(walk);
    expect(nudge()).toBe(walk);
    count.setWalk(null);
    expect(nudge()).toBeNull();
    count.dispose();
  });

  it("a queue's own message: every {name} the fan's name, the guide's first «love»; no name — {name} goes cleanly, «love» stays", () => {
    expect(fillQueueText('hey {name}, a whole month together 🥰', 'Mike')).toBe('hey Mike, a whole month together 🥰');
    expect(fillQueueText('hey {name}, a whole month together 🥰', null)).toBe('hey, a whole month together 🥰');
    expect(fillQueueText('{name}, you there? 🥹', null)).toBe('you there? 🥹');
    expect(fillQueueText('hi {name}!', ' ')).toBe('hi!');
    expect(fillQueueText("{name}, anything you'd love to see?", 'Mike')).toBe("Mike, anything you'd love to see?");
    expect(fillQueueText('hey love 👋 still here, love?', 'Mike')).toBe('hey Mike 👋 still here, love?');
    expect(fillQueueText('hey love 👋 still here?', null)).toBe('hey love 👋 still here?');
  });
});
