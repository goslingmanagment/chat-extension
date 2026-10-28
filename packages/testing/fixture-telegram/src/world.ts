// The stand's synthetic world: Lora's Telegram account and its chats. Every name, text and id is invented. A message
// is dated relative to the page's load (days before today at a time of day, or minutes before now), so the day lines
// read as Web A's do on any day: Today, Yesterday, a weekday within a week, «October 19» before that, with the year
// for an earlier year.

import { TELEGRAM_STAND_IDS } from './protocol';

export type MessageKind = 'text' | 'photo' | 'video' | 'voice' | 'sticker' | 'round' | 'album' | 'call' | 'emoji-only' | 'action';

export interface SeedMessage {
  readonly own?: true;
  /** `{ day, time }`: so many days before today at that time of day; `{ ago }`: so many minutes before the load. */
  readonly when: { readonly day: number; readonly time: string } | { readonly ago: number };
  readonly kind?: MessageKind;
  /** The text, or a media message's caption, or a service line's words. */
  readonly text?: string;
  /** A reply: the quoted message's sender and its text, as `.EmbeddedMessage` shows them. */
  readonly reply?: { readonly sender: string; readonly text: string };
  readonly edited?: true;
  /** A sticker's emoji (`img.full-media[alt]`); null — a sticker without one. */
  readonly alt?: string | null;
  /** A media message's length badge («0:14»), a call's length («5 min»). */
  readonly length?: string;
}

export interface SeedChat {
  readonly peerId: string;
  readonly name: string;
  /** The header's status line: «last seen recently», «online», «bot», «service notifications». */
  readonly status: string;
  /** The avatar's two colours (Web A's peer colours as a gradient). */
  readonly colors: readonly [string, string];
  /** How this account's clock shows times in this chat: Web A's setting, 24-hour or 12-hour («2:05 PM»). */
  readonly clock: '24h' | '12h';
  /** The id of the chat's first message; the next ones count up (a service line takes an id too). */
  readonly firstId: number;
  readonly unread: number;
  readonly messages: readonly SeedMessage[];
}

const ID = TELEGRAM_STAND_IDS.chats;

/** Jamie: the long English chat the scenarios work in (38 messages over four days). */
const JAMIE: SeedChat = {
  peerId: ID.jamie,
  name: 'Jamie',
  status: 'last seen recently',
  colors: ['#ff885e', '#ff516a'],
  clock: '24h',
  firstId: 3101,
  unread: 0,
  messages: [
    { when: { day: 9, time: '21:14' }, text: 'hey Lora 👋 found you through your twitter, hope it’s ok to write here' },
    { own: true, when: { day: 9, time: '21:20' }, text: 'hi Jamie! of course it’s ok 😊 how did you like the pics?' },
    { when: { day: 9, time: '21:22' }, text: 'honestly? obsessed 😍' },
    { own: true, when: { day: 9, time: '21:31' }, kind: 'photo', text: 'a little something from the beach 🌊' },
    { when: { day: 9, time: '21:33' }, text: 'you look amazing in that one' },
    { when: { day: 9, time: '21:35' }, kind: 'action', text: 'Lora pinned a photo' },
    { when: { day: 4, time: '08:02' }, text: 'good morning sunshine ☀️' },
    { when: { day: 4, time: '08:03' }, text: 'what are you up to today?' },
    { own: true, when: { day: 4, time: '09:15' }, text: 'morning! coffee first, then the gym 💪' },
    { own: true, when: { day: 4, time: '09:16' }, kind: 'voice', length: '0:12' },
    { when: { day: 4, time: '09:40' }, text: 'your voice 🥺 say my name next time' },
    { when: { day: 4, time: '09:41' }, kind: 'sticker', alt: '😘' },
    { own: true, when: { day: 4, time: '10:05' }, kind: 'round', length: '0:09' },
    { when: { day: 4, time: '19:30' }, kind: 'call', text: 'Incoming call', length: '5 min' },
    { when: { day: 4, time: '19:36' }, text: 'that was fun, talk later?' },
    { own: true, when: { day: 4, time: '19:40' }, text: 'of course 😊', reply: { sender: 'Jamie', text: 'that was fun, talk later?' } },
    { when: { day: 1, time: '11:20' }, text: 'are you free this weekend? 😏' },
    { own: true, when: { day: 1, time: '11:24' }, text: 'depends who’s asking 🙈' },
    { when: { day: 1, time: '11:25' }, text: 'me, obviously', reply: { sender: 'Lora', text: 'depends who’s asking 🙈' } },
    { when: { day: 1, time: '12:40' }, kind: 'album', text: 'my trip to the mountains' },
    { own: true, when: { day: 1, time: '12:52' }, text: 'wow, where is this??', reply: { sender: 'Jamie', text: 'my trip to the mountains' } },
    { when: { day: 1, time: '12:53' }, text: 'Colorado. you’d love it' },
    { own: true, when: { day: 1, time: '13:30' }, kind: 'video', text: 'my view right now', length: '0:14' },
    { when: { day: 1, time: '13:31' }, text: 'jealous 😩' },
    { own: true, when: { day: 1, time: '14:02' }, text: 'ok I’m off for a nap, see you later 🌙', edited: true },
    { when: { day: 1, time: '14:05' }, kind: 'emoji-only' },
    { when: { ago: 95 }, text: 'hey you 😊' },
    { when: { ago: 94 }, text: 'I keep thinking about what you said' },
    { own: true, when: { ago: 80 }, text: 'which part? 😏' },
    { when: { ago: 79 }, text: 'the part about the weekend', reply: { sender: 'Lora', text: 'which part? 😏' } },
    { when: { ago: 78 }, text: 'so… are we doing something?' },
    { own: true, when: { ago: 60 }, text: 'maybe 🙊 tell me what you have in mind' },
    { when: { ago: 45 }, text: 'dinner first. then we’ll see 😘' },
    { own: true, when: { ago: 40 }, kind: 'photo' },
    { when: { ago: 30 }, text: 'ok you’re not playing fair' },
    { own: true, when: { ago: 22 }, text: 'never said I would 😇' },
    { when: { ago: 8 }, text: 'my wallet is crying already 😂' },
    { when: { ago: 3 }, text: 'but seriously, when can I see more?' },
  ],
};

const SASHA: SeedChat = {
  peerId: ID.sasha,
  name: 'Саша',
  status: 'online',
  colors: ['#a0de7e', '#54cb68'],
  clock: '24h',
  firstId: 812,
  unread: 2,
  messages: [
    { when: { day: 2, time: '18:10' }, text: 'Привет! Ты правда отвечаешь сама? 🙂' },
    { own: true, when: { day: 2, time: '18:25' }, text: 'Привет, Саша! Конечно сама 😊' },
    { when: { day: 2, time: '18:26' }, text: 'Круто. Как прошёл день?' },
    { own: true, when: { day: 2, time: '18:40' }, text: 'Устала, но довольна. Весь день снимали 📸' },
    { when: { day: 2, time: '18:41' }, text: 'Покажешь потом что-нибудь?', reply: { sender: 'Lora', text: 'Устала, но довольна. Весь день снимали 📸' } },
    { own: true, when: { day: 2, time: '18:50' }, text: 'Посмотрим 🙈' },
    { when: { ago: 14 }, text: 'Доброе утро ☀️' },
    { when: { ago: 12 }, text: 'Что делаешь сегодня вечером?' },
  ],
};

const MIKE: SeedChat = {
  peerId: ID.mike,
  name: 'Mike Torres',
  status: 'last seen within a week',
  colors: ['#72d5fd', '#2a9ef1'],
  clock: '12h',
  firstId: 57,
  unread: 1,
  messages: [
    { when: { day: 320, time: '20:05' }, text: 'hi Lora, big fan of your work' },
    { own: true, when: { day: 320, time: '20:30' }, text: 'aw thank you Mike 💛' },
    { when: { day: 3, time: '14:05' }, text: 'still here, still a fan 😄' },
    { own: true, when: { day: 3, time: '14:20' }, text: 'happy to hear that! how have you been?' },
    { when: { day: 3, time: '14:22' }, text: 'busy with work. you?' },
    { when: { day: 3, time: '14:23' }, kind: 'sticker', alt: null },
    { own: true, when: { day: 3, time: '15:01' }, text: 'same, a lot of shoots this month' },
    { when: { ago: 25 }, text: 'you around?' },
  ],
};

const BOT: SeedChat = {
  peerId: ID.bot,
  name: 'Stars Wallet Bot',
  status: 'bot',
  colors: ['#e0a2f3', '#d569ed'],
  clock: '24h',
  firstId: 4,
  unread: 0,
  messages: [
    { own: true, when: { day: 5, time: '10:00' }, text: '/start' },
    { when: { day: 5, time: '10:00' }, text: 'Welcome! Use /balance to see your Stars.' },
  ],
};

const SERVICE: SeedChat = {
  peerId: ID.service,
  name: 'Telegram',
  status: 'service notifications',
  colors: ['#72d5fd', '#2a9ef1'],
  clock: '24h',
  firstId: 900,
  unread: 0,
  messages: [{ when: { day: 1, time: '07:45' }, text: 'New login. Dear Lora, we detected a login into your account from a new device (Firefox on macOS). If this wasn’t you, go to Settings > Devices.' }],
};

/** The chats of the account, in the left column's order (the newest message first). */
export const SEED_CHATS: readonly SeedChat[] = [JAMIE, SASHA, MIKE, SERVICE, BOT];

/** What the other account (slot 2) sees: a chat list of its own, Jamie's included (the same person writes to both). */
export const OTHER_ACCOUNT_CHATS: readonly SeedChat[] = [JAMIE, MIKE];

/** The account slots of `localStorage` (Web A `account<N>`): who is signed in where. */
export const ACCOUNTS = {
  1: { userId: TELEGRAM_STAND_IDS.account, firstName: 'Lora', lastName: '' },
  2: { userId: TELEGRAM_STAND_IDS.otherAccount, firstName: 'Mia', lastName: 'Stone' },
} as const;
