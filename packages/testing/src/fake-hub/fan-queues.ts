// «Очереди» as the fake hub serves it (hub docs/plans/2026-10-29-fan-queues/spec.md §13, services/fan-queues.ts and
// fan-queue-rules.ts): the caller's queues of a page, a portion of up to ten with a 30-minute lease renewed by each take,
// each fan's outcome once (sent with what, or skipped with why) and the portion given back. Nothing here sends anything.
//
// A page has no queue until a scenario says so (`fanQueues`), as a page of the hub has none until someone asks Gengar.
// `stand` is the owner's prototype, made at the first read after the command (the shift seeds the board and the
// archives after a scenario's `before`): the paid and the chatter's own fans are the page's board fans (the stand's
// chats, so a card's send reaches one); the cold followers are fans of their own whom the stand has no chat with — no
// conversation, the page's mass messages only, as a follower who never wrote has.
// «Холодные живые» (followers who never wrote, the guide's B texts, «Отправить всем»), the standing «Платили, молчат»
// (Ping, one by one) with one fan who answered its Ping, «Холодные остальные» on pause, and «Мои: спендеры на смену»
// asked for by the chatter themselves. The numbers of the day before the stand's start (12 of 50, the page's 61 of 150,
// 1 948 still in the queue) are the prototype's; the fans counted beyond the listed ones are never handed out.

import { type FanQueueAnswered, type FanQueueItem, type FanQueueItemDone, type FanQueueItemDoneRequest, type FanQueueRelease, type FanQueueReleaseRequest, type FanQueueScenario, type FanQueueSummary, type FanQueueTake, type FanQueueTakeRequest, type FanQueues, type OnlineTemplate } from '@cg/contracts';

import { iso } from './clock';
import { type FakePage } from './config';
import { ONLINE_TEMPLATES, greetingNameOf, onlineReasonOf, type OnlineFacts } from './online';
import { type FakeFanQueueDone } from './types';

/** An answer of the model or the hub's refusal (data.ts `Read`, structurally). */
type Read<T> = { readonly ok: true; readonly body: T } | { readonly ok: false; readonly refusal: { readonly error: string; readonly reason?: string } };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** The hub's FAN_QUEUE_LEASE_MINUTES. */
export const FAN_QUEUE_LEASE_MS = 30 * MINUTE;
/** A fan who answered the caller's queue message stays on top this long (the hub's ANSWERED_HOURS). */
const ANSWERED_MS = 72 * HOUR;
/** Ping needs this many messages of the chat (the hub's ONLINE_RULES.pingMinMessages). */
const PING_MIN_MESSAGES = 10;
const GUIDE = { a: ONLINE_TEMPLATES.filter((one) => one.group === 'a').map((one) => one.id), b: ONLINE_TEMPLATES.filter((one) => one.group === 'b').map((one) => one.id) } as const;
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'] as const;
/** The cold followers: invented, no chat anywhere; null — a follower with no name but the site's handle. */
const COLD: readonly { readonly name: string | null; readonly username: string }[] = [
  { name: 'Mike Dalton', username: 'mikedalt' },
  { name: 'Jordan Pike', username: 'jpike' },
  { name: null, username: 'u285080777' },
  { name: 'Kevin Shaw', username: 'kshaw' },
  { name: 'Lucas Grant', username: 'lucasg' },
  { name: 'Owen Blake', username: 'owenb' },
  { name: 'Nate Rivers', username: 'nrivers' },
  { name: 'Sean Porter', username: 'seanp' },
  { name: 'Evan Hale', username: 'evanhale' },
  { name: 'Adam Ross', username: 'adamr' },
];
/**
 * Where the board's fans stand in the queues (the showcase's: Chris, Ryan and Tyler went quiet, Ben answered, Daniel and
 * Marco are the chatter's, Ethan and Liam get the thanks of a month).
 */
const BOARD_AT = { paid: [7, 8, 9], mine: [1, 2], thanks: [3, 4], answered: 11 } as const;
/** A paid fan's chat that went quiet: twelve lines, the model's last (Ping needs ten of the chat). */
const PAID_CHAT: readonly (readonly ['fan' | 'model', string])[] = [
  ['fan', 'hey gorgeous 😍 just saw your new post'],
  ['model', 'hey you 😘 glad you liked it. how was your day?'],
  ['fan', 'long one, work was crazy'],
  ['model', 'poor thing 🥺 want something to cheer you up?'],
  ['fan', 'always 😏'],
  ['model', 'check this one, just for you 😈'],
  ['fan', 'wow. worth every cent'],
  ['model', 'you know how to make a girl smile 🥰'],
  ['fan', 'you deserve it. what are you up to this weekend?'],
  ['model', 'beach if the weather is nice 🌊 you?'],
  ['fan', 'busy week ahead, talk soon'],
  ['model', 'good luck this week 💛 I will be here'],
];
/** «Спасибо за месяц»: the asker's own message, two variants, `{name}` for the fan's name. */
const THANKS = [
  'hey {name} 🥰 a whole month together, thank you for staying with me. how is your week going?',
  "{name}, it's been a month since you joined 🥹 thank you, really. anything you'd love to see next?",
] as const;

/** What a scenario says of a page's queues: the prototype's set over the board fans, or none. */
export type FanQueuesSet = 'stand' | null;

/** What the model reads of the rest of the fake hub when a scenario sets a page's queues. */
export interface FanQueuesWorld {
  /** The page's board fans with the facts «Онлайн» reads of them, the board's order (the stand's chats first). */
  readonly board: readonly OnlineFacts[];
  /** The chatter the stand signs in as: the asker of their own queue. */
  readonly me: { readonly userId: number; readonly name: string };
  /** The hub's archive of a conversation becomes these messages, oldest first: a queue fan's story. */
  conversation(conversationRef: string, messages: readonly { readonly sender: 'fan' | 'model'; readonly text: string; readonly at: number }[]): void;
}

interface QueueFan {
  readonly itemId: number;
  readonly rank: number;
  readonly facts: OnlineFacts;
  readonly why: string | null;
  readonly followedAt: number | null;
  readonly mass: { readonly count: number; readonly lastAt: number | null };
  state: 'pending' | 'leased' | 'sent' | 'skipped';
  leasedTo: number | null;
  leaseUntil: number | null;
  doneBy: number | null;
  doneAt: number | null;
  act: string | null;
  templateId: string | null;
  /** The fan wrote after the message from the queue went: his answer. */
  answer: { readonly at: number; readonly text: string } | null;
}

interface Queue {
  readonly queueId: number;
  readonly name: string;
  readonly goal: string | null;
  readonly kind: 'campaign' | 'standing';
  readonly status: 'active' | 'paused';
  readonly distribution: 'pool' | 'people';
  /** People who may work it; empty — the page's every chatter. */
  readonly people: readonly number[];
  readonly scenario: FanQueueScenario;
  readonly ruleText: readonly string[] | null;
  readonly requestedBy: string;
  readonly pausedAt: number | null;
  readonly pausedBy: string | null;
  readonly perPerson: number | null;
  readonly dailyLimit: number | null;
  /** Sent today before the stand started (the prototype's numbers): the caller's and the page's. */
  readonly before: { readonly mine: number; readonly page: number };
  /** Fans the queue holds beyond the listed ones: counted, never handed out. */
  readonly more: number;
  readonly fans: QueueFan[];
}

/** «12 мар». */
const dayMonth = (at: number): string => {
  const date = new Date(at);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()] ?? ''}`;
};
const dollars = (mills: number): string => `$${Math.round(mills / 1000).toLocaleString('en-US')}`;
const scenario = (action: string, sendMode: 'one' | 'batch', templates: 'a' | 'b' | null = null, texts: readonly string[] | null = null): FanQueueScenario => ({ action, sendMode, templates, texts: texts === null ? null : [...texts], hint: null });

/** What a fan of the queue is written with (hub fan-queue-rules.ts `fanQueueItemAct`): the scenario's act, a guide's text turn by rank. */
export function fanQueueActOf(queue: { readonly scenario: FanQueueScenario }, facts: OnlineFacts, rank: number): { readonly act: string; readonly templateId: string | null } {
  const pick = (list: readonly string[]): string | null => (list.length === 0 ? null : (list[rank % list.length] ?? null));
  const guide = (group: 'a' | 'b'): { act: string; templateId: string | null } => ({ act: `template_${group}`, templateId: pick(GUIDE[group]) });
  const pingOrGuide = (): { act: string; templateId: string | null } => (facts.messageCount >= PING_MIN_MESSAGES ? { act: 'ping', templateId: null } : guide('a'));
  const texts = queue.scenario.texts;
  switch (queue.scenario.action) {
    case 'hi':
    case 'reply':
    case 'own':
      return { act: queue.scenario.action, templateId: null };
    case 'ping':
      return pingOrGuide();
    case 'template':
      if (texts !== null && texts.length > 0) return { act: 'template_q', templateId: `Q${(rank % texts.length) + 1}` };
      return guide(queue.scenario.templates === 'a' ? 'a' : 'b');
    default: {
      // As «Онлайн» decides: a fan who wrote last waits for a Reply; a long chat gets Ping; the guide otherwise.
      const waiting = facts.lastFanMessageAt !== null && (facts.answeredAt === null || facts.lastFanMessageAt > facts.answeredAt);
      if (waiting) return { act: 'reply', templateId: null };
      if (facts.messageCount >= PING_MIN_MESSAGES) return { act: 'ping', templateId: null };
      return guide(facts.messageCount > 0 ? 'a' : 'b');
    }
  }
}

export class FanQueuesModel {
  private readonly pages = new Map<string, Queue[]>();
  /** A page's set waiting for its first read: the world is read then (the board and the archives are seeded by then). */
  private readonly waiting = new Map<string, (now: number) => FanQueuesWorld>();
  private readonly journal: FakeFanQueueDone[] = [];
  private nextItemId = 9_100;

  /** A scenario's queues of a page: `stand` — the prototype's set over the page's board fans, made at the first read; null — none. */
  set(page: FakePage, set: FanQueuesSet, world: (now: number) => FanQueuesWorld): void {
    this.pages.delete(page.pageLabel);
    this.waiting.delete(page.pageLabel);
    if (set === 'stand') this.waiting.set(page.pageLabel, world);
  }

  /** What the scenarios read: every report, in order. */
  reports(): readonly FakeFanQueueDone[] {
    return this.journal.map((row) => ({ ...row }));
  }

  private item(rank: number, facts: OnlineFacts, extra: Partial<Pick<QueueFan, 'why' | 'followedAt' | 'mass'>> = {}): QueueFan {
    this.nextItemId += 1;
    return {
      itemId: this.nextItemId,
      rank,
      facts,
      why: extra.why ?? null,
      followedAt: extra.followedAt ?? null,
      mass: extra.mass ?? { count: 0, lastAt: null },
      state: 'pending',
      leasedTo: null,
      leaseUntil: null,
      doneBy: null,
      doneAt: null,
      act: null,
      templateId: null,
      answer: null,
    };
  }

  /** The owner's prototype over the board's fans (the stand's chats): who is in which queue, and their stories. */
  private stand(page: FakePage, world: FanQueuesWorld, now: number): Queue[] {
    const board = world.board;
    const fansly = page.platform === 'fansly';
    const pick = (indexes: readonly number[]): OnlineFacts[] => indexes.flatMap((index) => (board[index] === undefined ? [] : [board[index]]));
    const paid = pick(BOARD_AT.paid);
    const mine = pick(BOARD_AT.mine);
    const answeredFan = board[BOARD_AT.answered] ?? board.at(-1);

    // Followers who never wrote: no money, no chat; the page's mass messages reached them, and nobody answered.
    const coldFans = COLD.map((who, index) => {
      const followed = now - (35 + 9 * index) * DAY;
      const seen = now - ([3, 26, 40, 7, 30, 52, 11, 19, 45, 5][index] ?? 12) * HOUR;
      const fanRef = fansly ? `9300000000000${String(10_000 + index)}` : String(9_300_100 + index);
      // OnlyFans names a chat by its fan; on Fansly a follower who never wrote has no chat yet (the first message makes one).
      world.conversation(fanRef, []);
      const facts: OnlineFacts = {
        fanRef,
        conversationRef: fansly ? null : fanRef,
        username: who.username,
        displayName: who.name,
        alias: null,
        lifetimeGrossMills: 0,
        last30dGrossMills: 0,
        seenAt: seen,
        onlineSince: null,
        seenSource: fansly ? 'fansly_followers_last_seen' : 'ofapi_last_seen',
        lastFanMessageAt: null,
        answeredAt: null,
        isSubscriber: !fansly,
        startedAt: fansly ? null : followed,
        endsAt: null,
        autoRenew: null,
        messageCount: 0,
      };
      return this.item(index, facts, {
        why: `${fansly ? 'подписан' : 'подписчик с'} ${dayMonth(followed)} · ни разу не писал`,
        followedAt: followed,
        mass: { count: 3 + (index % 5), lastAt: now - (1 + (index % 4)) * DAY },
      });
    });
    // Paid and went quiet: Ping over their last talk.
    const paidFans = paid.map((facts, index) => {
      const quiet = now - (12 + 4 * index) * DAY;
      const money = Math.max(facts.lifetimeGrossMills, (560 - 140 * index) * 1000);
      // The chat as the hub keeps it: long enough for Ping, its last line ours, twenty minutes after his.
      const last = PAID_CHAT.length - 1;
      world.conversation(
        facts.conversationRef ?? facts.fanRef,
        PAID_CHAT.map(([sender, text], line) => ({ sender, text, at: line === last ? quiet + 20 * MINUTE : quiet - (last - 1 - line) * HOUR })),
      );
      return this.item(index, { ...facts, lifetimeGrossMills: money, last30dGrossMills: 0, lastFanMessageAt: quiet, answeredAt: quiet + 20 * MINUTE, messageCount: PING_MIN_MESSAGES, seenAt: now - (2 + index) * DAY }, {
        why: `платил ${dollars(money)} · молчит ${12 + 4 * index} дн`,
      });
    });
    // The one who answered: his Ping went two hours ago, his answer came twelve minutes ago.
    const answered = answeredFan === undefined ? null : this.item(paid.length, { ...answeredFan, lifetimeGrossMills: Math.max(answeredFan.lifetimeGrossMills, 240_000), messageCount: PING_MIN_MESSAGES }, { why: 'платил $240 · молчал 18 дн' });
    if (answered !== null) {
      const sentAt = now - 2 * HOUR;
      const answerAt = now - 12 * MINUTE;
      const text = 'haha you noticed me 👀 I usually just lurk but ok hi';
      answered.state = 'sent';
      answered.doneBy = world.me.userId;
      answered.doneAt = sentAt;
      answered.act = 'ping';
      answered.answer = { at: answerAt, text };
      world.conversation(answered.facts.conversationRef ?? answered.facts.fanRef, [
        { sender: 'fan', text: 'omg that set was insane 🔥', at: now - 19 * DAY },
        { sender: 'model', text: 'glad you liked it 😏 more soon', at: now - 19 * DAY + 30 * MINUTE },
        { sender: 'model', text: 'hey stranger 👋 I was going through my chats and smiled at ours. where did you disappear to?', at: sentAt },
        { sender: 'fan', text, at: answerAt },
      ]);
    }
    // The chatter's own: their spenders for the shift, written as the hub advises.
    const mineFans = mine.map((facts, index) => this.item(index, { ...facts, seenAt: now - (25 + 20 * index) * MINUTE }, { why: `спендер ${dollars(Math.max(facts.lifetimeGrossMills, 100_000))} · на эту смену` }));
    // A month with the page: the asker's own words, one by one.
    const thanksFans = pick(BOARD_AT.thanks).map((facts, index) => this.item(index, { ...facts, seenAt: now - (5 + 3 * index) * HOUR }, { why: `подписан месяц назад · платил ${dollars(Math.max(facts.lifetimeGrossMills, 10_000))}` }));

    return [
      {
        queueId: 1,
        name: 'Холодные живые',
        goal: 'Познакомиться: пусть ответит хоть что-то. В первом сообщении не продаём.',
        kind: 'campaign',
        status: 'active',
        distribution: 'pool',
        people: [],
        scenario: scenario('template', 'batch', 'b'),
        ruleText: fansly ? ['фолловеры', 'ни разу не писали', 'не платили ни на одной странице модели', 'были на Fansly за 7 дней'] : ['подписчики', 'ни разу не писали', 'не платили', 'заходили за 7 дней'],
        requestedBy: 'Дмитрий',
        pausedAt: null,
        pausedBy: null,
        perPerson: 50,
        dailyLimit: 150,
        before: { mine: 12, page: 61 },
        more: 1_948 - COLD.length,
        fans: coldFans,
      },
      {
        queueId: 2,
        name: 'Платили, молчат',
        goal: 'Вернуть в разговор: Ping по прошлой переписке, без продажи в первом сообщении.',
        kind: 'standing',
        status: 'active',
        distribution: 'pool',
        people: [],
        scenario: scenario('ping', 'one'),
        ruleText: ['платили от $50', 'молчат 10+ дней', 'в чате 10+ сообщений'],
        requestedBy: 'Дмитрий',
        pausedAt: null,
        pausedBy: null,
        perPerson: 10,
        dailyLimit: null,
        before: { mine: 3, page: 9 },
        more: 38,
        fans: answered === null ? paidFans : [...paidFans, answered],
      },
      {
        queueId: 3,
        name: 'Холодные остальные',
        goal: 'Познакомиться с теми, кто давно не заходил: шаблон B с именем.',
        kind: 'campaign',
        status: 'paused',
        distribution: 'pool',
        people: [],
        scenario: scenario('template', 'batch', 'b'),
        ruleText: fansly ? ['фолловеры', 'ни разу не писали', 'не заходили 7+ дней'] : ['подписчики', 'ни разу не писали', 'не заходили 7+ дней'],
        requestedBy: 'Дмитрий',
        pausedAt: now - 2 * HOUR,
        pausedBy: 'Дмитрий',
        perPerson: 50,
        dailyLimit: 150,
        before: { mine: 0, page: 0 },
        more: 5_420,
        fans: [],
      },
      {
        queueId: 4,
        name: 'Мои: спендеры на смену',
        goal: 'Поговорить со своими спендерами за смену, как подскажет хаб.',
        kind: 'campaign',
        status: 'active',
        distribution: 'people',
        people: [world.me.userId],
        scenario: scenario('auto', 'one'),
        ruleText: ['мои спендеры от $100', 'писали за 30 дней'],
        requestedBy: world.me.name,
        pausedAt: null,
        pausedBy: null,
        perPerson: 30,
        dailyLimit: null,
        before: { mine: 0, page: 4 },
        more: 0,
        fans: mineFans,
      },
      {
        queueId: 5,
        name: 'Спасибо за месяц',
        goal: 'Сказать спасибо тем, кто с нами месяц, своими словами и без продажи.',
        kind: 'campaign',
        status: 'active',
        distribution: 'pool',
        people: [],
        scenario: scenario('template', 'one', null, THANKS),
        ruleText: ['подписаны месяц назад', 'платили от $10'],
        requestedBy: 'Дмитрий',
        pausedAt: null,
        pausedBy: null,
        perPerson: 20,
        dailyLimit: null,
        before: { mine: 0, page: 2 },
        more: 6,
        fans: thanksFans,
      },
    ];
  }

  private queuesOf(page: FakePage, userId: number, now: number): Queue[] {
    const world = this.waiting.get(page.pageLabel);
    if (world !== undefined) {
      this.waiting.delete(page.pageLabel);
      this.pages.set(page.pageLabel, this.stand(page, world(now), now));
    }
    return (this.pages.get(page.pageLabel) ?? []).filter((queue) => (queue.people.length === 0 ? queue.distribution === 'pool' : queue.people.includes(userId)));
  }

  /** Leases that ran out go back to the queue. */
  private expire(queue: Queue, now: number): void {
    for (const fan of queue.fans) {
      if (fan.state === 'leased' && (fan.leaseUntil ?? 0) <= now) {
        fan.state = 'pending';
        fan.leasedTo = null;
        fan.leaseUntil = null;
      }
    }
  }

  private today(queue: Queue, userId: number): { mine: number; page: number } {
    const sent = queue.fans.filter((fan) => fan.state === 'sent' && fan.answer === null);
    return { mine: queue.before.mine + sent.filter((fan) => fan.doneBy === userId).length, page: queue.before.page + sent.length };
  }

  /** Fans the caller can still be handed: the listed pending ones and, while the listed ones are worked, the counted rest. */
  private pending(queue: Queue): number {
    const listed = queue.fans.filter((fan) => fan.state === 'pending').length;
    // A paused queue keeps its fans, counted ones too.
    if (queue.status === 'paused') return listed + queue.more;
    const open = queue.fans.filter((fan) => fan.state === 'pending' || fan.state === 'leased').length;
    return open === 0 ? 0 : listed + queue.more;
  }

  private summary(queue: Queue, userId: number, now: number): FanQueueSummary {
    this.expire(queue, now);
    return {
      queueId: queue.queueId,
      name: queue.name,
      goal: queue.goal,
      kind: queue.kind,
      status: queue.status,
      distribution: queue.distribution,
      mineOnly: queue.distribution === 'people' && queue.people.length === 1 && queue.people[0] === userId,
      scenario: queue.scenario,
      ruleText: queue.ruleText === null ? null : [...queue.ruleText],
      requestedBy: queue.requestedBy,
      pausedAt: queue.pausedAt === null ? null : iso(queue.pausedAt),
      pausedBy: queue.pausedBy,
      perPerson: queue.perPerson,
      dailyLimit: queue.dailyLimit,
      today: this.today(queue, userId),
      pending: this.pending(queue),
      leasedToMe: queue.fans.filter((fan) => fan.state === 'leased' && fan.leasedTo === userId).length,
    };
  }

  /** The guide's texts and each template queue's own (group `q<queueId>`), as the hub lists them. */
  private templates(queues: readonly Queue[]): OnlineTemplate[] {
    const own = queues.flatMap((queue) => (queue.scenario.texts ?? []).map((text, index) => ({ id: `Q${index + 1}`, group: `q${queue.queueId}`, text })));
    return [...ONLINE_TEMPLATES.map((one) => ({ ...one })), ...own];
  }

  /** As the hub's `clientFanQueues`. */
  list(page: FakePage, userId: number, now: number): Read<FanQueues> {
    const queues = this.queuesOf(page, userId, now);
    const answered: FanQueueAnswered[] = [];
    for (const queue of queues) {
      for (const fan of queue.fans) {
        if (fan.state !== 'sent' || fan.doneBy !== userId || fan.answer === null || fan.doneAt === null || now - fan.doneAt > ANSWERED_MS) continue;
        answered.push({
          itemId: fan.itemId,
          queueId: queue.queueId,
          fanRef: fan.facts.fanRef,
          conversationRef: fan.facts.conversationRef,
          username: fan.facts.username,
          displayName: fan.facts.displayName,
          alias: fan.facts.alias,
          sentAt: iso(fan.doneAt),
          act: fan.act,
          templateId: fan.templateId,
          answeredAt: iso(fan.answer.at),
          answerText: fan.answer.text,
        });
      }
    }
    answered.sort((a, b) => Date.parse(b.answeredAt) - Date.parse(a.answeredAt));
    return { ok: true, body: { pageLabel: page.pageLabel, queues: queues.map((queue) => this.summary(queue, userId, now)), answered, templates: this.templates(queues), serverNow: iso(now) } };
  }

  private wire(queue: Queue, fan: QueueFan, until: number, now: number): FanQueueItem {
    const facts = fan.facts;
    const decided = onlineReasonOf(facts, now);
    const { act, templateId } = fanQueueActOf(queue, facts, fan.rank);
    return {
      itemId: fan.itemId,
      queueId: queue.queueId,
      why: fan.why,
      leaseUntil: iso(until),
      templateId,
      followedAt: fan.followedAt === null ? null : iso(fan.followedAt),
      massLast90d: { count: fan.mass.count, lastAt: fan.mass.lastAt === null ? null : iso(fan.mass.lastAt) },
      fanRef: facts.fanRef,
      conversationRef: facts.conversationRef,
      username: facts.username,
      displayName: facts.displayName,
      alias: facts.alias,
      greetingName: greetingNameOf(facts.displayName, facts.username),
      lifetimeGrossMills: facts.lifetimeGrossMills,
      last30dGrossMills: facts.last30dGrossMills,
      seenAt: facts.seenAt === null ? null : iso(facts.seenAt),
      onlineSince: null,
      seenSource: facts.seenSource,
      reason: decided.reason,
      reasonAt: decided.reasonAt === null ? null : iso(decided.reasonAt),
      act,
      aside: null,
      asideAt: null,
      asideBy: null,
      messageCount: facts.messageCount,
      lastFanMessageAt: facts.lastFanMessageAt === null ? null : iso(facts.lastFanMessageAt),
      lastPageMessageAt: facts.answeredAt === null ? null : iso(facts.answeredAt),
      subscription: {
        isSubscriber: facts.isSubscriber,
        startedAt: facts.startedAt === null ? null : iso(facts.startedAt),
        endsAt: facts.endsAt === null ? null : iso(facts.endsAt),
        autoRenew: facts.autoRenew,
      },
    };
  }

  /** As the hub's `clientFanQueueTake`: the caller's kept fans renewed, then new ones within their portion and the page's limit. */
  take(page: FakePage, userId: number, request: FanQueueTakeRequest, now: number): Read<FanQueueTake> {
    const queue = this.queuesOf(page, userId, now).find((one) => one.queueId === request.queueId);
    if (queue === undefined) return { ok: false, refusal: { error: 'not_found' } };
    this.expire(queue, now);
    const until = now + FAN_QUEUE_LEASE_MS;
    const mine = queue.fans.filter((fan) => fan.state === 'leased' && fan.leasedTo === userId);
    for (const fan of mine) fan.leaseUntil = until;
    const today = this.today(queue, userId);
    const leased = queue.fans.filter((fan) => fan.state === 'leased').length;
    let stopped: string | null = null;
    let need = Math.max(0, request.count - mine.length);
    if (queue.status === 'paused') {
      stopped = 'paused';
      need = 0;
    }
    // The person's own portion first (it is what they read), then the page's limit for the day.
    if (need > 0 && queue.perPerson !== null && !request.more) {
      const room = queue.perPerson - today.mine - mine.length;
      if (room <= 0) {
        stopped = 'portion_done';
        need = 0;
      } else need = Math.min(need, room);
    }
    if (need > 0 && queue.dailyLimit !== null) {
      const room = queue.dailyLimit - today.page - leased;
      if (room <= 0) {
        stopped = 'limit_reached';
        need = 0;
      } else need = Math.min(need, room);
    }
    const taken = queue.fans.filter((fan) => fan.state === 'pending').sort((a, b) => a.rank - b.rank).slice(0, need);
    for (const fan of taken) {
      fan.state = 'leased';
      fan.leasedTo = userId;
      fan.leaseUntil = until;
    }
    const portion = [...mine, ...taken].sort((a, b) => a.rank - b.rank);
    const pending = this.pending(queue);
    if (stopped === null && portion.length < request.count && pending === 0) stopped = 'empty';
    return { ok: true, body: { queueId: queue.queueId, items: portion.map((fan) => this.wire(queue, fan, until, now)), stopped, today, pending, dropped: 0, serverNow: iso(now) } };
  }

  /** As the hub's `clientFanQueueItemDone`: a fan of the caller's portion, once; another's or a done one is 409. */
  done(page: FakePage, userId: number, request: FanQueueItemDoneRequest, now: number): Read<FanQueueItemDone> {
    for (const queue of this.queuesOf(page, userId, now)) {
      this.expire(queue, now);
      const fan = queue.fans.find((one) => one.itemId === request.itemId);
      if (fan === undefined) continue;
      if (fan.state !== 'leased' || fan.leasedTo !== userId) return { ok: false, refusal: { error: 'conflict', reason: 'fan_queue_item_not_leased' } };
      fan.state = request.outcome === 'sent' ? 'sent' : 'skipped';
      fan.leasedTo = null;
      fan.leaseUntil = null;
      fan.doneBy = userId;
      fan.doneAt = now;
      fan.act = request.act ?? null;
      fan.templateId = request.templateId ?? null;
      this.journal.push({
        pageLabel: page.pageLabel,
        userId,
        queueId: queue.queueId,
        itemId: fan.itemId,
        fanRef: fan.facts.fanRef,
        outcome: request.outcome,
        act: request.act ?? null,
        templateId: request.templateId ?? null,
        skipReason: request.skipReason ?? null,
        uncertain: request.uncertain === true,
        at: iso(now),
      });
      return { ok: true, body: { itemId: fan.itemId, state: fan.state, today: this.today(queue, userId), serverNow: iso(now) } };
    }
    return { ok: false, refusal: { error: 'not_found' } };
  }

  /** As the hub's `clientFanQueueRelease`: the caller's untouched portion back to the queue. */
  release(page: FakePage, userId: number, request: FanQueueReleaseRequest, now: number): Read<FanQueueRelease> {
    const queue = this.queuesOf(page, userId, now).find((one) => one.queueId === request.queueId);
    if (queue === undefined) return { ok: false, refusal: { error: 'not_found' } };
    let released = 0;
    for (const fan of queue.fans) {
      if (fan.state !== 'leased' || fan.leasedTo !== userId) continue;
      fan.state = 'pending';
      fan.leasedTo = null;
      fan.leaseUntil = null;
      released += 1;
    }
    return { ok: true, body: { released } };
  }
}
