// Synthetic data of the stand: accounts, fans, chats and messages. All names,
// ids and texts are invented here; no real message, fan or account appears
// (tools/archive-check rejects the owner's real ids). Ids follow the hub's one
// id form ^[1-9]\d{0,29}$ (docs/hub-pr-plan-critic.md item 14) and stay strings.

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

/** A fresh copy of the synthetic dataset (the server mutates its own copy). */
export function createDataset(): StandDataset {
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
