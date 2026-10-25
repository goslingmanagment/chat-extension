// Synthetic data of the stand: accounts, fans, chats and messages. All names,
// ids and texts are invented here; no real message, fan or account appears
// (tools/archive-check rejects the owner's real ids). Ids follow the hub's one
// id form ^[1-9]\d{0,29}$ (docs/hub-pr-plan-critic.md item 14) and stay strings.
// The showcase world (`pnpm see --showcase`, src/showcase.ts) dresses the same
// ids as a working day: showcase.ts.

import { SHOWCASE, SHOWCASE_AT } from '../showcase';
import { SHOWCASE_ACCOUNTS } from './showcase';

export interface StandAccount {
  /** OnlyMonster account id (host namespace). */
  readonly id: string;
  /** OnlyFans creator id (platform namespace). */
  readonly platformAccountId: string;
  readonly name: string;
  readonly username: string;
  /** Opened as an account tab on first load (so ChatSpace subscribes it on the socket). */
  readonly openOnStart: boolean;
}

export interface StandFan {
  readonly id: string;
  readonly name: string;
  readonly username: string;
  isBlocked: boolean;
  isRestricted: boolean;
  canReceiveChatMessage: boolean;
  subscribedOn: boolean;
  readonly totalSpent: number;
  readonly buyingPower: number;
  readonly lastPaymentAt: string | null;
  /** When the platform last saw the fan (ISO); null on start — a test sets it (`setFan`). */
  lastSeen: string | null;
  /** What the server-side chat-list filters see (pinned, who_tipped, priority, fan lists). */
  readonly pinnedChat: boolean;
  readonly tipped: boolean;
  readonly priority: boolean;
  readonly lists: readonly string[];
}

export interface StandMessage {
  readonly id: string;
  readonly content: string;
  readonly sentAt: string;
  readonly isFromFan: boolean;
  readonly isPinned?: boolean;
  /** X54: a model's paid message (PPV): its listed price, USD, and whether the fan bought it (OnlyFans' `isOpened`). */
  readonly price?: number;
  isOpened?: boolean;
  /** OnlyFans' `isNew`: on the model's message, false once the fan has seen it; absent — true, as a fresh message. */
  isNew?: boolean;
  /** 1.47.0: a voice note the model's message carries (an audio the page uploaded): its medium's id and seconds. */
  readonly audio?: { readonly id: string; readonly duration: number };
}

export interface StandChat {
  readonly accountId: string;
  readonly fan: StandFan;
  /** Oldest first. */
  readonly messages: StandMessage[];
  unread: number;
}

export interface StandDataset {
  readonly userId: string;
  readonly accounts: readonly StandAccount[];
  /** Key: `${accountId}:${fanId}`. */
  readonly chats: Map<string, StandChat>;
}

/** Ids the e2e and unit tests refer to. */
export const STAND_IDS = {
  user: '6100042',
  accounts: { a: '910101', b: '910202', c: '910303' },
  platformAccounts: { a: '830000101', b: '830000202', c: '830000303' },
  /** Fans of account a; `a1` has the longest history, `a3` is blocked on start. */
  fans: { a1: '74001001', a2: '74001002', a3: '74001003', a4: '74001004', a5: '74001005', a6: '74001006', a7: '74001007', a8: '74001008', b1: '74002001', c1: '74003001' },
} as const;

const BASE_TIME = Date.UTC(2026, 8, 1, 9, 0, 0);
/** The one synthetic fan list (chat-list scope `list:<id>`). */
export const STAND_FAN_LIST_ID = '501';
const FAN_NAMES = ['Alder', 'Birch', 'Cedar', 'Dune', 'Elm', 'Fern', 'Grove', 'Heath', 'Iris', 'Juniper', 'Kestrel', 'Linden'];
const FAN_LINES = [
  'Синтетический привет #{n}',
  'Stand fan line #{n}, nothing real here',
  'Тестовая реплика фана {n}',
  'Synthetic question {n}?',
];
const CREATOR_LINES = ['Синтетический ответ #{n}', 'Stand creator reply {n}', 'Тестовый ответ {n} :)'];

export const chatKey = (accountId: string, fanId: string): string => `${accountId}:${fanId}`;

function line(pool: readonly string[], n: number): string {
  return (pool[n % pool.length] ?? '').replaceAll('{n}', String(n));
}

/** A fresh copy of the synthetic dataset (the server mutates its own copy); the showcase world's in a showcase run. */
export function createDataset(): StandDataset {
  if (SHOWCASE) return createShowcaseDataset(SHOWCASE_AT);
  const accounts: StandAccount[] = [
    { id: STAND_IDS.accounts.a, platformAccountId: STAND_IDS.platformAccounts.a, name: 'Stand Creator A', username: 'stand_creator_a', openOnStart: true },
    { id: STAND_IDS.accounts.b, platformAccountId: STAND_IDS.platformAccounts.b, name: 'Stand Creator B', username: 'stand_creator_b', openOnStart: true },
    { id: STAND_IDS.accounts.c, platformAccountId: STAND_IDS.platformAccounts.c, name: 'Stand Creator C', username: 'stand_creator_c', openOnStart: false },
  ];
  const chats = new Map<string, StandChat>();
  let messageId = 5_100_000_000;
  let minute = 0;
  accounts.forEach((account, accountIndex) => {
    const fanCount = accountIndex === 0 ? 12 : 6;
    for (let index = 0; index < fanCount; index += 1) {
      const fanId = `7400${accountIndex + 1}${String(index + 1).padStart(3, '0')}`;
      const name = FAN_NAMES[index % FAN_NAMES.length] ?? 'Fan';
      const fan: StandFan = {
        id: fanId,
        name: `Fan ${name}`,
        username: `stand_fan_${accountIndex + 1}_${index + 1}`,
        isBlocked: accountIndex === 0 && index === 2,
        isRestricted: false,
        canReceiveChatMessage: true,
        subscribedOn: index % 5 !== 4,
        totalSpent: (index * 37) % 400,
        buyingPower: index % 6,
        lastPaymentAt: index % 3 === 0 ? null : new Date(BASE_TIME - index * 86_400_000).toISOString(),
        lastSeen: null,
        pinnedChat: index % 5 === 1,
        tipped: (index * 37) % 400 > 0 && index % 2 === 0,
        priority: index % 3 === 0,
        lists: index % 2 === 1 ? [STAND_FAN_LIST_ID] : [],
      };
      // Fan 1 of account a has a long history (scrolling, keep-bottom tests).
      const length = accountIndex === 0 && index === 0 ? 40 : 4 + ((index * 3) % 9);
      const messages: StandMessage[] = [];
      for (let n = 0; n < length; n += 1) {
        minute += 3;
        messageId += 1;
        const isFromFan = n % 3 !== 1;
        messages.push({
          id: String(messageId),
          content: `<p>${line(isFromFan ? FAN_LINES : CREATOR_LINES, n + index)}</p>`,
          sentAt: new Date(BASE_TIME + minute * 60_000).toISOString(),
          isFromFan,
          // Two pinned messages per chat (the pinned-messages dialog has something to load).
          isPinned: n === 1 || n === 5,
        });
      }
      const last = messages.at(-1);
      chats.set(chatKey(account.id, fanId), { accountId: account.id, fan, messages, unread: last?.isFromFan === true ? 1 + (index % 3) : 0 });
    }
  });
  return { userId: STAND_IDS.user, accounts, chats };
}

/** Text as a message body: ChatSpace's paragraph, the few characters HTML reserves escaped. */
const paragraph = (text: string): string => `<p>${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</p>`;

/**
 * The showcase world's stand (showcase.ts): accounts a and b with the same fan ids, the showcase's names, money and
 * chats, dated back from `now`; message ids in time order across the stand, as OnlyFans gives them. Nobody is blocked.
 */
export function createShowcaseDataset(now: number): StandDataset {
  const ids = [STAND_IDS.platformAccounts.a, STAND_IDS.platformAccounts.b, STAND_IDS.platformAccounts.c];
  const accounts: StandAccount[] = [STAND_IDS.accounts.a, STAND_IDS.accounts.b, STAND_IDS.accounts.c].slice(0, SHOWCASE_ACCOUNTS.length).map((id, index) => {
    const showcase = SHOWCASE_ACCOUNTS[index];
    return { id, platformAccountId: ids[index] ?? '', name: showcase?.name ?? '', username: showcase?.username ?? '', openOnStart: true };
  });
  const pending: { readonly key: string; readonly at: number; readonly message: Omit<StandMessage, 'id'> }[] = [];
  const chats = new Map<string, StandChat>();
  accounts.forEach((account, accountIndex) => {
    (SHOWCASE_ACCOUNTS[accountIndex]?.fans ?? []).forEach((showcase, index) => {
      const fanId = `7400${accountIndex + 1}${String(index + 1).padStart(3, '0')}`;
      const last = showcase.chat.at(-1);
      const fan: StandFan = {
        id: fanId,
        name: showcase.name,
        username: showcase.username,
        isBlocked: false,
        isRestricted: false,
        canReceiveChatMessage: true,
        subscribedOn: true,
        totalSpent: showcase.spentUsd,
        buyingPower: Math.min(5, Math.floor(showcase.spentUsd / 300)),
        lastPaymentAt: showcase.spentUsd > 0 ? new Date(now - (last?.[2] ?? 0) * 60_000 - 86_400_000).toISOString() : null,
        lastSeen: showcase.online === true ? new Date(now - 60_000).toISOString() : null,
        pinnedChat: false,
        tipped: showcase.spentUsd >= 100,
        priority: showcase.spentUsd >= 600,
        lists: showcase.spentUsd >= 600 ? [STAND_FAN_LIST_ID] : [],
      };
      const key = chatKey(account.id, fanId);
      chats.set(key, { accountId: account.id, fan, messages: [], unread: showcase.unread });
      showcase.chat.forEach(([from, text, minutesAgo, ppv], n) => {
        const at = now - minutesAgo * 60_000;
        pending.push({
          key,
          at,
          message: { content: paragraph(text), sentAt: new Date(at).toISOString(), isFromFan: from === 'fan', isPinned: n === 1 || n === 5, ...(ppv === undefined ? {} : { price: ppv.usd, isOpened: ppv.bought }) },
        });
      });
    });
  });
  // Oldest first everywhere: a message's id grows with its time.
  pending
    .sort((a, b) => a.at - b.at)
    .forEach((item, rank) => {
      chats.get(item.key)?.messages.push({ id: String(5_100_000_001 + rank), ...item.message });
    });
  return { userId: STAND_IDS.user, accounts, chats };
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

/**
 * Plain text of a message body, for the journal: every tag dropped (no newline
 * for `<br>`), entities decoded (numeric and the common named ones; the page
 * itself decodes all of them with the browser's parser), trimmed.
 */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity: string, name: string) => {
      if (name.startsWith('#x') || name.startsWith('#X')) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
      if (name.startsWith('#')) return String.fromCodePoint(Number(name.slice(1)));
      return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
    })
    .trim();
}

/**
 * 1.30.0 (X53): the vault every stand account answers the media picker with (OnlyMonster's raw shapes): two folders,
 * twelve media — the seventh still processing —, what fans a1 and a2 already got of them, and the release form of one.
 * No thumbnail: the stand has no https origin, and the picker shows a medium without one by its type.
 */
export const STAND_VAULT = {
  folders: [
    { id: '880001', type: 'messages', name: 'Messages', photos_count: 8, videos_count: 4, gifs_count: 0, audios_count: 0 },
    // The showcase world's folder reads as a model's set (src/showcase.ts).
    { id: '880002', type: 'custom', name: SHOWCASE ? 'Red set &amp; lace' : 'Stand set &amp; one', photos_count: 4, videos_count: 0, gifs_count: 0, audios_count: 0 },
  ],
  media: Array.from({ length: 12 }, (_, i) => ({
    id: String(660_000_001 + i),
    type: i % 3 === 2 ? 'video' : 'photo',
    duration: i % 3 === 2 ? 30 + i : 0,
    is_ready: i !== 6,
    can_view: true,
    has_error: false,
    thumbnail_url: null,
    created_at: new Date(BASE_TIME - i * 3_600_000).toISOString(),
    folder: i < 8 ? '880001' : '880002',
  })),
  /** By fan: media sent to them, with the price and the purchase. */
  stats: {
    [STAND_IDS.fans.a2]: [
      { media_id: '660000002', message_id: '5199999003', price: 25, sent_at: new Date(BASE_TIME).toISOString(), purchased_at: new Date(BASE_TIME + 60_000).toISOString() },
      { media_id: '660000005', message_id: '5199999004', price: 10, sent_at: new Date(BASE_TIME).toISOString(), purchased_at: null },
    ],
    [STAND_IDS.fans.a1]: [
      { media_id: '660000002', message_id: '5199999001', price: 15, sent_at: new Date(BASE_TIME).toISOString(), purchased_at: new Date(BASE_TIME + 60_000).toISOString() },
      { media_id: '660000003', message_id: '5199999002', price: null, sent_at: new Date(BASE_TIME).toISOString(), purchased_at: null },
    ],
  } as Readonly<Record<string, readonly Record<string, unknown>[]>>,
  /** By medium: the release forms OnlyFans tags a message with it. */
  forms: { '660000004': [{ type: 'user', user: { id: 7_700_001, name: SHOWCASE ? 'Ella Moon' : 'Stand Collab' } }] } as Readonly<Record<string, readonly Record<string, unknown>[]>>,
} as const;
