// The fake hub's part of the showcase world (src/showcase.ts): what its synthetic reads say when no scenario seeded
// them — the Spenders statistics of a mid-size page, the few lines the archive holds of a fan the stand does not show,
// the people who subscribed today. Invented numbers, names and texts; a scenario's own seeds still win.

import type { SpendersStats } from '@cg/contracts';

import { iso } from './clock';

const DAY_MS = 86_400_000;
const MILLS = 1000;

/** The page's last 30 days, oldest first: dollars a day, Fridays and Saturdays busier, today still going. */
const DAILY_USD = [512, 584, 655, 701, 598, 547, 529, 561, 607, 688, 742, 633, 571, 548, 590, 626, 703, 761, 652, 589, 566, 604, 641, 719, 778, 664, 602, 583, 621, 344] as const;
/** What one purchase brings on average, USD: the day's purchases follow from it. */
const CHECK_USD = 38;

/**
 * The page's statistics (the hub's `spenders/stats`) at `now`: the days, the totals (the platform keeps 20 %), the tiers
 * of a page with a few whales and most fans under $100, the silent fans, today's new payers.
 */
export function showcaseStats(now: number, timeZone: string, pageLabel: string, queue: SpendersStats['queueSummary']): SpendersStats {
  const days = DAILY_USD.map((usd, index) => {
    const gross = usd * MILLS;
    return {
      date: new Date(now - (DAILY_USD.length - 1 - index) * DAY_MS).toISOString().slice(0, 10),
      grossMills: gross,
      purchasesGrossMills: gross,
      adjustmentsMills: 0,
      creatorNetMills: Math.round(gross * 0.8),
      purchaseCount: Math.max(1, Math.round(usd / CHECK_USD)),
      byState: { posted: gross },
    };
  });
  const total = (from: number, to: number, payers: number): SpendersStats['totals']['today'] => {
    const slice = days.slice(from, to);
    const gross = slice.reduce((sum, day) => sum + day.grossMills, 0);
    return { grossMills: gross, purchasesGrossMills: gross, adjustmentsMills: 0, creatorNetMills: Math.round(gross * 0.8), purchaseCount: slice.reduce((sum, day) => sum + day.purchaseCount, 0), payerCount: payers };
  };
  const d7 = total(23, 30, 58);
  const prev7 = total(16, 23, 54);
  const d30 = total(0, 30, 214);
  const tier = (key: string, label: string, minUsd: number | null, maxUsd: number | null, members: number, windowPayers: number, windowUsd: number) => ({
    key,
    label,
    minMills: minUsd === null ? null : minUsd * MILLS,
    maxMills: maxUsd === null ? null : maxUsd * MILLS,
    members,
    windowPayers,
    windowGrossMills: windowUsd * MILLS,
    windowNetMills: Math.round(windowUsd * MILLS * 0.8),
  });
  return {
    pageLabel,
    metricVersion: 1,
    moneyUnit: 'USD-mills',
    basis: 'gross',
    timeZone,
    from: days[0]?.date ?? '',
    to: days.at(-1)?.date ?? '',
    asOf: iso(now),
    projectionAsOf: iso(now - 120_000),
    includedStates: ['posted', 'pending', 'unknown'],
    coverage: { state: 'complete', reasons: [] },
    days,
    totals: { today: total(29, 30, 11), d7, prev7, d30, d7DeltaPct: Math.round(((d7.grossMills - prev7.grossMills) / prev7.grossMills) * 10_000) / 100 },
    avgCheckMills: Math.round(d30.grossMills / d30.purchaseCount),
    tiers: [
      tier('1-25', '$1–25', 1, 25, 55, 38, 640),
      tier('25-50', '$25–50', 25, 50, 47, 33, 1310),
      tier('50-150', '$50–150', 50, 150, 58, 41, 3050),
      tier('150-350', '$150–350', 150, 350, 31, 22, 3940),
      tier('350-600', '$350–600', 350, 600, 14, 10, 3180),
      tier('600-plus', '$600+', 600, null, 9, 7, 6120),
      tier('untiered', 'Без тира', null, null, 6, 0, 0),
      tier('unattributed', 'Не распределено', null, null, 0, 0, 420),
    ],
    silence: { d8to21: { fans: 38, lifetimeGrossMills: 4_210_000 }, over21: { fans: 96, lifetimeGrossMills: 7_850_000 }, unknown: { fans: 3, lifetimeGrossMills: 90_000 } },
    newPayers: { count: 23, firstPurchaseKnown: true },
    queueSummary: queue,
  };
}

/** A fan the stand does not show: three lines of a first day (newest last), one of them by the fan's id. */
const FIRST_DAYS: readonly (readonly [fan: string, model: string, fan2: string])[] = [
  ['hey! just found your page 👋', 'welcome 🥰 so happy you’re here', 'you’re even prettier than on insta 😍'],
  ['hi there 🙂', 'hi handsome 😘 what brought you to me?', 'saw your reel and couldn’t resist 😅'],
  ['love your style', 'aww thank you 💕 tell me about you', 'just a guy from Ohio who likes good vibes'],
  ['finally subscribed 🙌', 'took you long enough 😏 welcome!', 'worth the wait though'],
];

/** The archive's lines of such a fan, newest first (the archive's order): what the fan wrote, what we answered. */
export function showcaseFirstDay(fanRef: string): readonly { readonly sender: 'fan' | 'model'; readonly text: string }[] {
  const [fan, model, fan2] = FIRST_DAYS[Number(BigInt(fanRef) % BigInt(FIRST_DAYS.length))] ?? FIRST_DAYS[0] ?? ['hi', 'hi', 'hi'];
  return [
    { sender: 'fan', text: fan2 },
    { sender: 'model', text: model },
    { sender: 'fan', text: fan },
  ];
}

/** A message that lands in the archive while a scenario runs (`archiveMessage`). */
export const SHOWCASE_NEW_MESSAGE = { fan: 'are you there? 🙂', model: 'did you like it? 😏' } as const;

/** People who subscribed today, for «Новые»: the hub's own synthetic ones and a fan a scenario names without a name. */
const SUBSCRIBERS: readonly (readonly [username: string, displayName: string])[] = [
  ['ethan.r', 'Ethan R'],
  ['mike_92', 'Mike'],
  ['jordanp', 'Jordan Parker'],
  ['caleb.w', 'Caleb'],
  ['drew_m', 'Drew Morgan'],
  ['nickyb', 'Nick B'],
  ['sam.travels', 'Sam'],
];

export function showcaseSubscriber(seed: number): { readonly username: string; readonly displayName: string } {
  const [username, displayName] = SUBSCRIBERS[seed % SUBSCRIBERS.length] ?? SUBSCRIBERS[0] ?? ['fan', 'Fan'];
  return { username, displayName };
}
