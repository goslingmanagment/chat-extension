// The ChatSpace stand of the showcase world (src/showcase.ts): Mia Rose's OnlyFans account and her VIP page, and their
// fans' chats as a chatter finds them on a working day — Jamie back from a trip and asking about the set, Daniel after
// the gym, a compliment on a set, a tip for coffee, a new subscriber, a fan gone quiet. Invented people and texts
// only; the ids are the stand's own (dataset.ts STAND_IDS), so every test helper and hub seed still names the same
// chats. The open chat (fan a1) is what the mockup's AI texts answer (e2e/see/kit.ts SEE_AI_TEXTS); Jamie's chat is
// the Fansly stand's too (fixture-fansly/src/showcase.ts), so the two sites' pictures show one moment.

import { jamieChat, type ShowcaseLine } from '../../fixture-fansly/src/showcase';

export type { ShowcaseLine };

export interface ShowcaseFan {
  readonly name: string;
  readonly username: string;
  /** What the fan spent on the account, USD (the hub's Spenders seed says the same). */
  readonly spentUsd: number;
  readonly unread: number;
  /** Seen on the platform a moment ago: the green dot and «online». */
  readonly online?: boolean;
  /** Oldest first. */
  readonly chat: readonly ShowcaseLine[];
}

export interface ShowcaseAccount {
  readonly name: string;
  readonly username: string;
  /** In STAND_IDS order: a1… of account a, b1… of b, c1… of c. */
  readonly fans: readonly ShowcaseFan[];
}

const H = 60;
const D = 24 * H;

/** Mia Rose (account a) and her fans, a1…a12. */
const MIA: ShowcaseAccount = {
  name: 'Mia Rose',
  username: 'miarose',
  fans: [
    { name: 'Jamie Carter', username: 'jamiec', spentUsd: 1248, unread: 3, online: true, chat: jamieChat('Mia') },
    {
      name: 'Daniel Brooks',
      username: 'danbrooks',
      spentUsd: 2150,
      unread: 2,
      online: true,
      chat: [
        ['fan', 'morning gorgeous ☀️', 2 * D + 3 * H],
        ['model', 'morning handsome 😘 sleep well?', 2 * D + 2 * H],
        ['fan', 'like a baby. gym in an hour', 2 * D + 2 * H - 5],
        ['model', 'how was the gym today, champ? 💪', 3 * H + 20],
        ['fan', 'brutal. leg day 😵 can barely walk', 2 * H],
        ['fan', 'worth it though. what are you up to?', 35],
      ],
    },
    {
      name: 'Marco Rossi',
      username: 'marco.rossi',
      spentUsd: 560,
      unread: 1,
      chat: [
        ['fan', 'when is the next set coming? 👀', 3 * D],
        ['model', 'soon… it’s red 🔥', 3 * D - 30],
        ['model', 'the red set is up 🔥 tell me which one is your favorite', 10 * H],
        ['fan', 'the third one. no question 😍', 95],
      ],
    },
    {
      name: 'Ethan Walsh',
      username: 'ethanw',
      spentUsd: 240,
      unread: 3,
      chat: [
        ['model', 'how was your Monday? 🙂', 4 * D],
        ['fan', 'survived it lol', 4 * D - 60],
        ['fan', 'long day at the office 😮‍💨', 75],
        ['fan', 'my boss moved the deadline AGAIN', 74],
        ['fan', 'need some cheering up tbh', 70],
      ],
    },
    {
      name: 'Liam Turner',
      username: 'liamturner',
      spentUsd: 10,
      unread: 1,
      chat: [['fan', 'hey! just subscribed 👋', 12]],
    },
    {
      name: 'Noah Price',
      username: 'noahp',
      spentUsd: 410,
      unread: 1,
      chat: [
        ['fan', 'just sent you a $20 tip for your coffee ☕', 2 * H + 40],
        ['model', 'you’re the sweetest 🥹 coffee’s on you today', 2 * H + 30],
        ['fan', 'anytime. how’s your day going?', 48],
      ],
    },
    {
      name: 'Alex Kim',
      username: 'alexkim',
      spentUsd: 10,
      unread: 1,
      chat: [['fan', 'hi Mia 🙂', 2 * H + 10]],
    },
    {
      name: 'Chris Bennett',
      username: 'chrisb',
      spentUsd: 690,
      unread: 0,
      chat: [
        ['fan', 'you up? 😏', D + 6 * H],
        ['model', 'always for you 😇', D + 5 * H],
        ['model', 'this one is a little bolder than usual 😈', 6 * H + 40, { usd: 30, bought: true }],
        ['fan', 'ok that was worth every cent 🔥', 6 * H + 20],
        ['model', 'glad you liked it 😏 there’s more where that came from', 6 * H + 10],
      ],
    },
    {
      name: 'Ryan Cole',
      username: 'ryancole',
      spentUsd: 380,
      unread: 0,
      chat: [
        ['fan', 'loved the beach pics 🌊', 11 * D],
        ['model', 'thank youuu 🥰 it was so windy lol', 11 * D - 40],
        ['fan', 'crazy week at work, talk soon', 9 * D + 8 * H],
        ['model', 'miss you around here 🥺 everything ok?', 9 * D],
      ],
    },
    {
      name: 'Tyler Reed',
      username: 'tylerreed',
      spentUsd: 64,
      unread: 0,
      chat: [
        ['fan', 'any plans for the weekend?', 2 * D],
        ['model', 'maybe a little beach trip 🌊 you?', 2 * D - 20],
        ['fan', 'fishing with my brother lol, less exciting', 2 * D - 30],
        ['model', 'bring me a fish 🐟😂', 2 * D - 35],
      ],
    },
    {
      name: 'Sam Hughes',
      username: 'samh',
      spentUsd: 85,
      unread: 0,
      chat: [
        ['fan', 'do you do custom videos?', 15 * H],
        ['model', 'I do 😊 tell me what you have in mind', 14 * H + 40],
      ],
    },
    {
      name: 'Ben Foster',
      username: 'benfoster',
      spentUsd: 35,
      unread: 0,
      chat: [
        ['fan', 'thanks for the birthday message 🎂', 41 * D],
        ['model', 'hey stranger 👀 it’s been a while', 40 * D],
      ],
    },
  ],
};

/** A short chat of a fan of another account: a few lines a working day leaves. */
const short = (name: string, username: string, spentUsd: number, unread: number, chat: readonly ShowcaseLine[]): ShowcaseFan => ({ name, username, spentUsd, unread, chat });

/** Mia Rose VIP (account b): her second page, six fans. */
const MIA_VIP: ShowcaseAccount = {
  name: 'Mia Rose VIP',
  username: 'miarose.vip',
  fans: [
    short('Adam Price', 'adamprice', 1540, 1, [['model', 'the VIP set is live 💎', 7 * H], ['fan', 'already unlocked it 😍', 2 * H]]),
    short('Nathan Cole', 'nathanc', 760, 0, [['fan', 'thank you for the voice note 🥹', D], ['model', 'anytime 💕', D - 10]]),
    short('Kevin Ross', 'kevinross', 220, 1, [['fan', 'what’s your favorite movie?', 4 * H]]),
    short('Brandon Hill', 'brandonh', 95, 0, [['model', 'good morning 😘', 2 * D], ['fan', 'morning beautiful', 2 * D - 15]]),
    short('Aaron Scott', 'aaronscott', 30, 0, [['fan', 'see you tonight?', 5 * D]]),
    short('Justin Ward', 'justinw', 15, 1, [['fan', 'just joined VIP 🙌', 50]]),
  ],
};

/** The stand's accounts in STAND_IDS order: a — Mia Rose, b — her VIP page (account c is not in the showcase). */
export const SHOWCASE_ACCOUNTS: readonly ShowcaseAccount[] = [MIA, MIA_VIP];
