// «Очереди» on Fansly (2026-10-29): what leaves the window. Each fan's text goes by our background's send, one click one
// message; «Отправить всем» of a template queue goes one fan at a time, a second apart, each fan reported to the hub once
// (`queues.done`, with its act and its template); an unknown outcome is reported as such and never sent again; a skip is
// one report with its reason; closing the window gives the untouched portion back. The hub and the channel are doubles.

import { describe, expect, it } from 'vitest';

import { BATCH_LIMITS, type ActionReceipt, type FanQueueItem, type FanQueueTake, type FanQueues, type QueuesWindowVM, type SettingsV1 } from '@cg/contracts';
import { Surfaces, fanHandle, type PageContextPort, type PageContextState, type TabRpc } from '@cg/core/application/boards';
import { type OnlineSendAnswer, type OnlineSendRequest } from '@cg/core/application/online';
import { createQueuesController, fillQueueText } from '@cg/core/application/queues';
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
const TAKE: FanQueueTake = { queueId: 1, items: [item(0), item(1), item(2)], stopped: null, today: { mine: 12, page: 61 }, pending: 1_945, dropped: 0, serverNow: iso(NOW_MS) };

function world(answer: (request: OnlineSendRequest) => OnlineSendAnswer = () => ({ ok: true, messageId: '700000000000000099' })) {
  const clock = new FakeClock(NOW_MS);
  const sent: OnlineSendRequest[] = [];
  const sentAt: number[] = [];
  const done: unknown[] = [];
  const released: unknown[] = [];
  const rpc = {
    request(type: string, payload: Record<string, unknown>) {
      if (type === 'token.issue') return Promise.resolve({ ok: true, payload: { actionToken: TOKEN, expiresAt: clock.now() + 10_000 } });
      if (type === 'queues.list') return Promise.resolve({ ok: true, payload: LIST });
      if (type === 'queues.take') return Promise.resolve({ ok: true, payload: TAKE });
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
  return { clock, sent, sentAt, done, released, queues, vm, handle, act, opened };
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
