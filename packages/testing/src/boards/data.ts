// The dataset of the boards' stand (architecture.md §10.2 п. 8; ui-design
// §0.2, states 11, 13, 14, 15): forty fans across six shelves, the statistics
// that agree with them, an archive feed, three newcomers, a Reply of three
// parts and a greeting of three. Everything is synthetic: names are made up
// and the handles are our own (`spenders:b001`); no id of a real account or
// fan appears (tools/archive-check rejects them). The numbers follow the
// binding mockup so a screenshot of the stand can be compared with it.

import {
  type FeedItemVM,
  type NewcomerRowVM,
  type PaletteItemVM,
  type ShelfVM,
  type SpenderRowVM,
  type SpendersStatsVM,
} from '@cg/contracts';

import { DAY, HOUR, MIN, iso, usd, type ScenarioCtx } from '../scenarios/app-client';

/** Minutes. */
const H = 60;
const D = 24 * 60;

export interface BoardFan {
  readonly key: string;
  readonly name: string;
  readonly username: string;
  /** Whole dollars. */
  readonly lifetime: number;
  readonly d30: number;
  readonly purchases30: number;
  /** Who wrote last. */
  readonly lastFrom: 'we' | 'fan';
  /** Minutes since our and the fan's last message; null — unknown. */
  readonly weAgo: number | null;
  readonly fanAgo: number | null;
  readonly last: string;
  readonly isNew?: boolean;
  readonly deleted?: boolean;
}

const fan = (n: number, name: string, username: string, lifetime: number, d30: number, purchases30: number, lastFrom: 'we' | 'fan', weAgo: number | null, fanAgo: number | null, last: string, extra: Partial<BoardFan> = {}): BoardFan => ({
  key: `b${String(n).padStart(3, '0')}`,
  name,
  username,
  lifetime,
  d30,
  purchases30,
  lastFrom,
  weAgo,
  fanAgo,
  last,
  ...extra,
});

/** Forty fans, as the mockup's board lists them. */
export const BOARD_FANS: readonly BoardFan[] = [
  fan(1, 'Theodore Whitfield', 'theo_whitfield', 41_760, 2_150, 9, 'fan', 3 * H, 6, 'tell me when you are free tonight, I have a surprise'),
  fan(2, 'Hubert', 'hubert_pl', 12_480, 320, 3, 'fan', 10 * H + 5, 7, 'are you awake? 😇'),
  fan(3, 'Christopher-Alexander von Hohenzollern-Sigmaringen', 'chris_alexander_hohenzollern_sigmaringen_official', 8_930, 0, 0, 'we', 2 * D, 19 * D, 'did you get my last message, Chris? 🙈'),
  fan(4, 'Marco Rinaldi', 'marco.rinaldi', 6_215, 940, 6, 'fan', 50, 22, 'ok that video was insane 🔥'),
  fan(5, 'Daniel K.', 'dank_88', 3_480, 125, 2, 'we', 4 * H, 9 * H, 'you always know what to say 😌'),
  fan(6, 'Jonas Becker', 'jbecker', 2_760, 0, 0, 'we', 6 * D, 19 * D, 'hey stranger, where did you go? 👀'),
  fan(7, "Ryan O'Connell", 'ryanoc', 1_945, 410, 4, 'we', 35, 2 * H, 'sent you something special ✨'),
  fan(8, 'Sebastian', 'seb_lux', 1_120, 60, 1, 'fan', 3 * D, 26 * H, 'maybe next week, busy now'),
  fan(9, 'Liam Carter', 'liamc', 585, 45, 1, 'fan', 2 * D, 3 * H, 'haha you are trouble'),
  fan(10, 'Mateusz Nowak', 'mateusz_n', 540, 0, 0, 'we', 11 * D, 24 * D, 'dzień dobry 🌸 miss you here'),
  fan(11, 'Ethan Brooks', 'ethanb', 495, 120, 2, 'we', 5 * H, 7 * H, 'thank you baby 🥰'),
  fan(12, 'Kenji Watanabe', 'kenji_w', 430, 0, 0, 'we', 40 * D, 41 * D, 'arigato for the tip 🙏', { deleted: true }),
  fan(13, 'Oliver Grant', 'olly_g', 395, 35, 1, 'we', 26 * H, 30 * H, 'sweet dreams 😴'),
  fan(14, 'Pierre Lambert', 'pierre.lmb', 362, 0, 0, 'fan', 9 * D, 9 * D, 'bonne nuit ❤️'),
  fan(15, 'Noah Fischer', 'noahf', 340, 80, 2, 'fan', 6 * H, 50, 'what are you wearing today?'),
  fan(16, 'Lucas Moreau', 'lucas_mrr', 310, 0, 0, 'we', 14 * D, 15 * D, 'coucou 😘'),
  fan(17, 'Aiden Clarke', 'aidenc', 275, 25, 1, 'we', 3 * H, 4 * H, 'you have good taste 😏'),
  fan(18, 'Viktor Hale', 'vhale', 240, 0, 0, 'we', 30 * D, null, 'hey you 👋'),
  fan(19, 'Samuel Ortiz', 'sam_ortiz', 205, 50, 1, 'fan', 20 * H, 12 * H, 'send me the new set'),
  fan(20, 'Henrik Dahl', 'henrikd', 180, 0, 0, 'we', 8 * D, 12 * D, 'god morgen ☀️'),
  fan(21, 'Jake Morrison', 'jake.m.88', 155, 155, 3, 'we', 15, 40, 'welcome back, Jake 🥰', { isNew: true }),
  fan(22, 'Felix Wagner', 'felixw', 145, 0, 0, 'we', 5 * D, 22 * D, 'guten Morgen 🌞'),
  fan(23, 'Tom Hughes', 'tomh', 120, 30, 1, 'we', 2 * H, 3 * H, 'you’re sweet 🙈'),
  fan(24, 'Mason Reed', 'mreed', 99, 0, 0, 'fan', 16 * D, 16 * D, '👍'),
  fan(25, 'Andrei Popescu', 'andrei_p', 85, 15, 1, 'we', 22 * H, 23 * H, 'noapte bună 💋'),
  fan(26, 'Caleb Wright', 'calebw', 70, 0, 0, 'we', 25 * D, null, 'thank you for subscribing 🥰'),
  fan(27, 'Diego Santos', 'diegos', 60, 60, 2, 'fan', 3 * H, 25, 'hola guapa 😍', { isNew: true }),
  fan(28, 'Owen Price', 'owenp', 52, 0, 0, 'we', 10 * D, 21 * D, 'miss you here 🥺'),
  fan(29, 'Leo Martin', 'leo_mrt', 49, 0, 0, 'we', 5 * H, 60 * D, 'welcome back, Léo 🌸'),
  fan(30, 'Isaac Bell', 'isaacb', 45, 10, 1, 'fan', 2 * D, 90, 'is there a discount?'),
  fan(31, 'Nathan Cole', 'ncole', 40, 0, 0, 'we', 18 * D, 20 * D, '😘'),
  fan(32, 'Adam Novak', 'adamnv', 35, 0, 0, 'we', 33 * D, 34 * D, 'ahoj 👋'),
  fan(33, 'Elliot Shaw', 'eshaw', 30, 30, 1, 'we', 45, 70, 'enjoy 😏', { isNew: true }),
  fan(34, 'Rafael Costa', 'rafa_c', 25, 0, 0, 'we', 12 * D, null, 'olá 🌸'),
  fan(35, 'Ben Turner', 'bturner', 24, 0, 0, 'we', 9 * D, 13 * D, 'good night 🌙'),
  fan(36, 'Hugo Laurent', 'hugo_l', 20, 5, 1, 'fan', 7 * H, 5 * H, 'merci 🙏'),
  fan(37, 'Karim Haddad', 'karimh', 15, 0, 0, 'we', 27 * D, 28 * D, 'hey 👋'),
  fan(38, 'Patrick Byrne', 'pbyrne', 10, 0, 0, 'we', 50 * D, null, 'thanks for the tip 🍀'),
  fan(39, 'Simon Ek', 'simon.ek', 8, 0, 0, 'we', 15 * D, 15 * D, 'hej 🌸'),
  fan(40, 'Max Weber', 'maxw', 5, 5, 1, 'we', 6 * H, 8 * H, 'thank you 🥰'),
];

export const HUBERT = BOARD_FANS[1] as BoardFan;

/** The hub's tiers, whole dollars: [from, to). */
export const SHELF_BOUNDS: readonly { readonly id: string; readonly from: number; readonly to: number | null }[] = [
  { id: 't600', from: 600, to: null },
  { id: 't350', from: 350, to: 600 },
  { id: 't150', from: 150, to: 350 },
  { id: 't50', from: 50, to: 150 },
  { id: 't25', from: 25, to: 50 },
  { id: 't1', from: 1, to: 25 },
];

export const boardHandle = (key: string): string => `spenders:${key}`;

const ago = (ctx: ScenarioCtx, minutes: number | null): string | null => (minutes === null ? null : iso(ctx.now - minutes * MIN));

export function boardRow(ctx: ScenarioCtx, source: BoardFan, selected: string | null): SpenderRowVM {
  return {
    handle: boardHandle(source.key),
    name: source.name,
    username: source.username,
    lifetime: usd(source.lifetime),
    period: usd(source.d30),
    isNew: source.isNew === true,
    deleted: source.deleted === true,
    weWroteAt: ago(ctx, source.weAgo),
    fanWroteAt: ago(ctx, source.fanAgo),
    waiting: source.lastFrom === 'fan',
    lastMessage: { fromUs: source.lastFrom === 'we', text: source.last },
    selected: source.key === selected,
  };
}

export type BoardSort = 'sum' | 'fan-age';

/** Shelves of `fans` in tier order; within a shelf by sum, or by how recently the fan wrote (unknown last). */
export function boardShelves(ctx: ScenarioCtx, fans: readonly BoardFan[], selected: string | null, sort: BoardSort = 'sum'): ShelfVM[] {
  return SHELF_BOUNDS.map((bounds): ShelfVM => {
    const inShelf = fans.filter((item) => item.lifetime >= bounds.from && (bounds.to === null || item.lifetime < bounds.to));
    const ordered =
      sort === 'sum'
        ? [...inShelf].sort((a, b) => b.lifetime - a.lifetime)
        : [...inShelf].sort((a, b) => (a.fanAgo === null ? 1 : b.fanAgo === null ? -1 : a.fanAgo - b.fanAgo));
    return {
      id: bounds.id,
      range: { fromMills: usd(bounds.from), toMills: bounds.to === null ? null : usd(bounds.to) },
      fans: inShelf.length,
      lifetime: usd(inShelf.reduce((sum, item) => sum + item.lifetime, 0)),
      period: usd(inShelf.reduce((sum, item) => sum + item.d30, 0)),
      rows: ordered.map((item) => boardRow(ctx, item, selected)),
      collapsed: null,
    };
  });
}

/** `count` synthetic fans spread over the shelves: the 1000-row board of the performance budget (§11). */
export function manyFans(count: number): BoardFan[] {
  const first = ['Aaron', 'Bruno', 'Cedric', 'Dmitri', 'Emil', 'Fabio', 'Gustav', 'Hector', 'Ivo', 'Jules', 'Kasper', 'Lorenz', 'Milan', 'Nils', 'Oskar', 'Pavel', 'Quentin', 'Rasmus', 'Stefan', 'Tobias'];
  const last = ['Albrecht', 'Bianchi', 'Carvalho', 'Dumont', 'Eriksen', 'Fontaine', 'Gruber', 'Halvorsen', 'Ionescu', 'Jansen', 'Kowalczyk', 'Lindqvist', 'Moretti', 'Novotny', 'Olsen', 'Petrov', 'Quist', 'Rossi', 'Schmid', 'Tanaka'];
  const out: BoardFan[] = [];
  for (let n = 0; n < count; n += 1) {
    const given = first[n % first.length] as string;
    const family = last[Math.floor(n / first.length) % last.length] as string;
    // Sums fall from the top shelf to the bottom one, so every shelf has fans; the tail spends little.
    const lifetime = Math.max(1, Math.round(40_000 * 0.991 ** n));
    const paid = n % 3 === 0;
    out.push(
      fan(1000 + n, `${given} ${family}`, `${given}.${family}${n}`.toLowerCase(), lifetime, paid ? Math.max(5, Math.round(lifetime / 12)) : 0, paid ? 1 + (n % 4) : 0, n % 4 === 0 ? 'fan' : 'we', (n * 37) % (40 * D), n % 11 === 0 ? null : (n * 53) % (60 * D), `message ${n}`, {
        ...(n % 97 === 0 ? { isNew: true } : {}),
        ...(n % 211 === 5 ? { deleted: true } : {}),
      }),
    );
  }
  return out;
}

// ── statistics: computed from the fans, so the numbers agree with the board ──

/** A deterministic 30-day series that sums exactly to the 30-day total; the last day is a partial «today». */
function daySeries(total: number): number[] {
  const weights: number[] = [];
  for (let i = 0; i < 30; i += 1) {
    const weight = i === 29 ? 0.45 : 1 + 0.55 * Math.sin(i * 1.7) + 0.35 * Math.cos(i * 0.9 + 1.3) + (i % 7 === 5 ? 0.6 : 0);
    weights.push(Math.max(0.15, weight));
  }
  const sum = weights.reduce((a, b) => a + b, 0);
  const days = weights.map((weight) => Math.round((weight / sum) * total));
  days[12] = (days[12] ?? 0) + (total - days.reduce((a, b) => a + b, 0));
  return days;
}

export function boardStats(ctx: ScenarioCtx, fans: readonly BoardFan[], coverage: 'complete' | 'partial' = 'complete'): Omit<SpendersStatsVM, 'view' | 'expanded'> {
  const stamp = { asOf: iso(ctx.now - 2 * MIN), coverage };
  const total = fans.reduce((sum, item) => sum + item.d30, 0);
  const purchases = fans.reduce((sum, item) => sum + item.purchases30, 0);
  const days = daySeries(total);
  const d7 = days.slice(23, 30).reduce((a, b) => a + b, 0);
  const prev7 = days.slice(16, 23).reduce((a, b) => a + b, 0);
  const shelves = boardShelves(ctx, fans, null);
  const top = shelves.reduce((most, shelf) => Math.max(most, shelf.period ?? 0), 0);
  const silent = (from: number, to: number): number => fans.filter((item) => item.fanAgo !== null && item.fanAgo >= from && item.fanAgo <= to).length;
  return {
    windowDays: 30,
    timeZone: 'Europe/Moscow',
    days: days.map((gross, index) => ({ date: iso(ctx.now - (29 - index) * DAY).slice(0, 10), gross: usd(gross), today: index === 29 })),
    today: { mills: usd(days[29] ?? 0), stamp },
    d7: { mills: usd(d7), stamp, changePct: prev7 === 0 ? null : ((d7 - prev7) / prev7) * 100, prev7: usd(prev7) },
    d30: { mills: usd(total), stamp, purchases },
    payers: { count: fans.filter((item) => item.d30 > 0).length, stamp },
    avgCheck: { mills: purchases === 0 ? null : usd(Math.round(total / purchases)), stamp },
    shelves: shelves.map((shelf) => ({ id: shelf.id, range: shelf.range, fans: shelf.fans, lifetime: shelf.lifetime, period: shelf.period, share: top === 0 ? 0 : (shelf.period ?? 0) / top })),
    attention: {
      awaiting: { count: fans.filter((item) => item.lastFrom === 'fan').length, stamp },
      newPayers: { count: fans.filter((item) => item.isNew === true).length, stamp, firstObserved: coverage !== 'complete' },
      silent8to21: { count: silent(8 * D, 21 * D), stamp },
      silentOver21: { count: fans.filter((item) => item.fanAgo !== null && item.fanAgo > 21 * D).length, stamp },
      noData: { count: fans.filter((item) => item.fanAgo === null).length, stamp },
    },
    stamp,
  };
}

// ── the archive feed of the previewed fan ──

export function hubertFeed(ctx: ScenarioCtx): FeedItemVM[] {
  // Moments on the Moscow clock of the stand: «30 сен, 21:04» … «3 окт, 09:13».
  const at = (daysAgo: number, hh: number, mm: number): string => {
    const today = new Date(ctx.now);
    return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - daysAgo, hh - 3, mm)).toISOString();
  };
  const item = (id: string, when: string, sender: FeedItemVM['sender'], text: string, patch: Partial<FeedItemVM> = {}): FeedItemVM => ({
    id,
    at: when,
    sender,
    text,
    deleted: false,
    automatic: false,
    tip: null,
    price: null,
    attachments: [],
    dayBreak: false,
    ...patch,
  });
  return [
    item('f1', at(3, 21, 4), 'model', 'what are you doing this weekend, traveler? ✈️', { dayBreak: true }),
    item('f2', at(3, 21, 30), 'fan', 'Gdańsk for work, boring. cheer me up', { tip: usd(50) }),
    item('f3', at(2, 10, 2), 'model', 'here is a little something to cheer you up 😘', { dayBreak: true, price: { mills: usd(30), purchased: true } }),
    item('f4', at(1, 22, 41), 'fan', 'hey beautiful, how was the photoshoot? 📸', { dayBreak: true }),
    item('f5', at(1, 22, 58), 'model', "it was sooo long 🙈 but I got some really cute ones… maybe I'll show you later 😏"),
    item('f6', at(1, 23, 2), 'fan', "you know I'm waiting. спасибо for the pic yesterday btw, you looked amazing"),
    item('f7', at(1, 23, 15), 'model', 'glad you liked it 🥰 I have a whole set from today, just for you', { price: { mills: usd(25), purchased: true } }),
    item('f8', at(0, 9, 12), 'fan', 'good morning Lora ☀️ just landed in Warsaw, still thinking about that set', { dayBreak: true }),
    item('f9', at(0, 9, 13), 'fan', 'are you awake? 😇'),
  ];
}

export const REPLY_PARTS = [
  'good morning, my traveler ☀️ доброе утро! how was the flight?',
  'I just woke up and saw your messages… you made me smile before my coffee 🙈',
  "the set is still waiting for you 😏 want me to send it now, or do you want to guess what's inside first?",
] as const;

export const GREETING_PARTS = ['hiii Tomasz 🥰 welcome to my VIP!', "I'm Lora, so happy you're here…", 'tell me, what made you subscribe? 😏'] as const;

// ── «Новые» ──

export const NEWCOMER_FANS = {
  tomasz: { key: 'n001', name: 'Tomasz Wiśniewski', username: 'tomwis' },
  jake: { key: 'n002', name: 'Jake Morrison', username: 'jake.m.88' },
  leo: { key: 'n003', name: 'Leo Martin', username: 'leo_mrt' },
} as const;

export const newcomerHandle = (key: string): string => `newcomers:${key}`;

export function newcomerRows(ctx: ScenarioCtx, selected: keyof typeof NEWCOMER_FANS, tomasz: NewcomerRowVM['greeting']): NewcomerRowVM[] {
  const row = (who: keyof typeof NEWCOMER_FANS, kind: NewcomerRowVM['kind'], minutesAgo: number, greeting: NewcomerRowVM['greeting']): NewcomerRowVM => ({
    handle: newcomerHandle(NEWCOMER_FANS[who].key),
    name: NEWCOMER_FANS[who].name,
    username: NEWCOMER_FANS[who].username,
    kind,
    subscribedAt: iso(ctx.now - minutesAgo * MIN),
    greeting,
    hasDraft: false,
    draftStale: false,
    selected: who === selected,
  });
  return [
    row('tomasz', 'new', 14, tomasz),
    row('jake', 'renewed', 2 * H, { s: 'greeted', at: iso(ctx.now - HOUR) }),
    // A colleague's lease: no name and no countdown (ui-design §12 п. 5).
    row('leo', 'returning', 5 * H, { s: 'claim-other' }),
  ];
}

// ── the palette's chats ──

export function paletteChat(ctx: ScenarioCtx, source: BoardFan, match: PaletteItemVM['match'] = []): PaletteItemVM {
  return {
    id: `chat:${source.key}`,
    label: source.name,
    sublabel: `@${source.username}`,
    match,
    hotkey: null,
    money: usd(source.lifetime),
    waitingSince: source.lastFrom === 'fan' && source.fanAgo !== null ? iso(ctx.now - source.fanAgo * MIN) : null,
    runningSince: null,
    enabled: true,
    reason: null,
    action: { type: 'Navigate', to: { kind: 'chat', targetHandle: `palette:${source.key}` } },
  };
}
