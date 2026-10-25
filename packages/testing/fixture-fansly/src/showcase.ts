// The Fansly stand of the showcase world (`pnpm see --showcase`, packages/testing/src/showcase.ts): Sofia Lane's
// inbox on a working day — Jamie back from a trip and asking about the set (the same moment as on OnlyFans, so the
// two sites' pictures show one shift), Daniel after the gym, a compliment, a tip, a paid set bought, a fan gone quiet —
// and the people who followed her today. Invented people and texts only; the ids stay the stand's (data.ts), so the
// hub's threads and every helper still name the same chats. data.ts builds the world from these.

/** One message: who wrote it, its text, how many minutes before the showcase's «now», and a paid message's price. */
export type ShowcaseLine = readonly [from: 'fan' | 'model', text: string, minutesAgo: number, ppv?: { readonly usd: number; readonly bought: boolean }];

export interface ShowcaseConversation {
  readonly displayName: string;
  readonly username: string;
  readonly about: string;
  /** What the fan spent on the page, USD: the hub's Spenders board says the same. */
  readonly spentUsd: number;
  readonly unread: number;
  readonly online?: boolean;
  /** Oldest first. */
  readonly chat: readonly ShowcaseLine[];
}

const H = 60;
const D = 24 * H;

/** Jamie's chat: a week of trips, the «Morning» set yesterday, the coffee question left hanging, and today's landing. */
export const jamieChat = (model: string): readonly ShowcaseLine[] => [
  ['fan', `hey ${model} 👋 your new pics are something else`, 9 * D + 4 * H],
  ['model', 'hiii Jamie 🥰 you always know what to say', 9 * D + 3 * H + 50],
  ['fan', 'only telling the truth 😌 what are you up to tonight?', 9 * D + 3 * H + 45],
  ['model', 'editing photos in pajamas… glamorous, right? 😅', 9 * D + 3 * H + 30],
  ['fan', 'honestly sounds perfect', 9 * D + 3 * H + 28],
  ['fan', 'flying to Denver again tomorrow 😩 3 days of meetings', 8 * D + 2 * H],
  ['model', 'nooo, again? 🥺 who is going to keep me company at night', 8 * D + H + 50],
  ['fan', 'you can keep me company from my hotel room 😏', 8 * D + H + 40],
  ['model', 'made you a little something for the hotel 🙈', 7 * D + 5 * H, { usd: 12, bought: true }],
  ['fan', 'ok that made the whole trip worth it 😍', 7 * D + 4 * H],
  ['model', 'how is Denver treating you? 🏔️', 5 * D + 6 * H],
  ['fan', 'cold and boring. tell me something good', 5 * D + 5 * H],
  ['model', 'something good is waiting for you… just unlock it 😏', 5 * D + 4 * H + 50, { usd: 12, bought: true }],
  ['fan', 'you are dangerous, you know that? 😂', 5 * D + 4 * H + 20],
  ['fan', 'back home for 2 days and then off to Austin lol', 3 * D + 2 * H],
  ['model', 'you collect airports like I collect lingerie 😂', 3 * D + H + 55],
  ['fan', 'haha now I want to see the collection', 3 * D + H + 50],
  ['model', 'good morning 😘 my «Morning» set is finally ready… 12 photos, just for you 🙈', D + 2 * H, { usd: 25, bought: true }],
  ['fan', 'haha straight to business this morning 😅 I’m at the airport, flight’s in an hour', D + H],
  ['fan', 'ok fine, I bought it ✈️ something to look at on the plane', D + 50],
  ['fan', 'do you drink coffee in the morning or are you a tea girl? ☕', D + 45],
  ['model', 'safe flight, handsome 💋 the second part waits until you’re back 😇', 20 * H],
  ['fan', 'just landed back home ✈️ what a week', 22],
  ['fan', 'missed talking to you, honestly', 21],
  ['fan', 'so… is the new set ready? you said there’s a second part 👀', 6],
];

export const SHOWCASE_CREATOR = { username: 'sofialane', displayName: 'Sofia Lane' } as const;

/** The inbox's first conversations, in the stand's group order: the first is the open chat (WORLD.fansly.chats.a), the second chats.b. */
export const SHOWCASE_CONVERSATIONS: readonly ShowcaseConversation[] = [
  { displayName: 'Jamie Carter', username: 'jamiec', about: 'flying somewhere, usually ✈️', spentUsd: 1120, unread: 3, online: true, chat: jamieChat('Sofia') },
  {
    displayName: 'Daniel Brooks',
    username: 'danbrooks',
    about: 'gym, coffee, bad jokes ☕',
    spentUsd: 1860,
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
    displayName: 'Owen Hart',
    username: 'owenhart',
    about: 'Seattle · rainy days and good music',
    spentUsd: 455,
    unread: 1,
    chat: [
      ['fan', 'when is the next set coming? 👀', 3 * D],
      ['model', 'soon… it’s red 🔥', 3 * D - 30],
      ['model', 'the red set is up 🔥 tell me which one is your favorite', 10 * H],
      ['fan', 'the third one. no question 😍', 95],
    ],
  },
  {
    displayName: 'Lucas Gray',
    username: 'lucasgray',
    about: 'accountant by day 📊',
    spentUsd: 95,
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
    displayName: 'Mason Lee',
    username: 'masonlee',
    about: '',
    spentUsd: 10,
    unread: 1,
    chat: [['fan', 'hey Sofia 👋 just found you on twitter', 14]],
  },
  {
    displayName: 'Jack Wilson',
    username: 'jackw',
    about: 'dog dad 🐶',
    spentUsd: 310,
    unread: 1,
    chat: [
      ['fan', 'just sent you a $20 tip for your coffee ☕', 2 * H + 40],
      ['model', 'you’re the sweetest 🥹 coffee’s on you today', 2 * H + 30],
      ['fan', 'anytime. how’s your day going?', 48],
    ],
  },
  {
    displayName: 'Henry Clark',
    username: 'henryclark',
    about: 'Texas 🤠',
    spentUsd: 740,
    unread: 0,
    chat: [
      ['fan', 'you up? 😏', D + 6 * H],
      ['model', 'always for you 😇', D + 5 * H],
      ['model', 'this one is a little bolder than usual 😈', 6 * H + 40, { usd: 30, bought: true }],
      ['fan', 'ok that was worth every cent 🔥', 6 * H + 20],
      ['model', 'glad you liked it 😏 there’s more where that came from', 5 * H + 50],
    ],
  },
  {
    displayName: 'Leo Martin',
    username: 'leomartin',
    about: 'night shift nurse 🌙',
    spentUsd: 40,
    unread: 0,
    chat: [
      ['fan', 'loved the beach pics 🌊', 11 * D],
      ['model', 'thank youuu 🥰 it was so windy lol', 11 * D - 40],
      ['fan', 'crazy week at work, talk soon', 9 * D + 8 * H],
      ['model', 'miss you around here 🥺 everything ok?', 9 * D],
    ],
  },
  {
    displayName: 'Adam Price',
    username: 'adamprice',
    about: 'weekend fisherman 🎣',
    spentUsd: 180,
    unread: 0,
    chat: [
      ['fan', 'any plans for the weekend?', 2 * D],
      ['model', 'maybe a little beach trip 🌊 you?', 2 * D - 20],
      ['fan', 'fishing with my brother lol, less exciting', 2 * D - 30],
      ['model', 'bring me a fish 🐟😂', 2 * D - 35],
    ],
  },
  {
    displayName: 'Nathan Cole',
    username: 'nathanc',
    about: 'here for the good vibes',
    spentUsd: 120,
    unread: 0,
    chat: [
      ['fan', 'do you do custom videos?', 15 * H],
      ['model', 'I do 😊 tell me what you have in mind', 14 * H + 40],
    ],
  },
  {
    displayName: 'Kevin Ross',
    username: 'kevinross',
    about: 'gamer & guitar 🎸',
    spentUsd: 64,
    unread: 0,
    chat: [
      ['model', 'good night 🌙 sweet dreams', 18 * H],
      ['fan', 'night night Sofia', 17 * H + 50],
    ],
  },
  {
    displayName: 'Brandon Hill',
    username: 'brandonh',
    about: 'Chicago born and raised',
    spentUsd: 48,
    unread: 0,
    chat: [
      ['fan', 'thanks for the birthday message 🎂', 41 * D],
      ['model', 'hey stranger 👀 it’s been a while', 40 * D],
    ],
  },
];

const FIRST = ['Ryan', 'Kyle', 'Sean', 'Eric', 'Matt', 'Josh', 'Brian', 'Mark', 'Paul', 'Tom', 'Luke', 'Nick', 'Zach', 'Cody', 'Derek', 'Evan', 'Gavin', 'Ian', 'Jordan', 'Logan', 'Miles', 'Oscar', 'Peter', 'Reid', 'Shane', 'Trevor', 'Victor', 'Wes', 'Blake', 'Caleb', 'Dylan', 'Grant', 'Hunter', 'Jake', 'Marcus', 'Tyler', 'Alex', 'Chris', 'Sam', 'Ben'] as const;
const LAST = ['Anderson', 'Baker', 'Campbell', 'Dixon', 'Ellis', 'Fisher', 'Graham', 'Hayes', 'Jensen', 'Keller', 'Lawson', 'Mitchell', 'Nolan', 'Owens', 'Parker', 'Riley', 'Sawyer', 'Turner', 'Vaughn', 'Watts', 'Young', 'Harper', 'Morgan', 'Foster', 'Hunt', 'Reed', 'Shaw', 'Wells', 'Price', 'Cole', 'Ward'] as const;
const ABOUT = ['', 'coffee first ☕', 'just here to support 💙', 'Denver · snowboarder 🏂', '', 'car guy 🏎️', 'music, beer and bad puns', 'Florida sunshine 🌴', '', 'chef at home 🍝', 'soccer on Sundays ⚽', 'NYC'] as const;

/** A made-up person for any other id of the world: the same name, handle and line for the same number. */
export function showcasePerson(seed: number): { readonly displayName: string; readonly username: string; readonly about: string } {
  const first = FIRST[(seed * 7) % FIRST.length] ?? 'Ryan';
  const last = LAST[(seed * 11 + 3) % LAST.length] ?? 'Baker';
  const styles = [`${first}${last}`, `${first}_${last.slice(0, 1)}`, `${first}${(seed * 37) % 90 + 10}`, `${first}.${last}`, `the${first}`];
  return { displayName: seed % 5 === 3 ? first : `${first} ${last}`, username: (styles[seed % styles.length] ?? first).toLowerCase(), about: ABOUT[seed % ABOUT.length] ?? '' };
}

/** What two people say in a chat a working day left behind: a pair of lines, the fan's or the model's first. */
const FILLER: readonly (readonly [first: 'fan' | 'model', string, string])[] = [
  ['fan', 'good morning beautiful ☀️', 'morning handsome 😘'],
  ['fan', 'how was your weekend?', 'lazy and perfect 😌 yours?'],
  ['model', 'did you see my new post? 🙈', 'saw it. wow'],
  ['fan', 'you look amazing in blue', 'blue is my lucky color 💙'],
  ['model', 'miss you 🥺', 'missed you too, busy week'],
  ['fan', 'what are you doing tonight?', 'movie night in bed 🍿 join me?'],
  ['fan', 'happy Friday!', 'happy Friday 🥂 any plans?'],
  ['fan', 'thanks for the voice note 🥹', 'anytime 💕'],
  ['model', 'good night 🌙', 'night night'],
  ['fan', 'that outfit though 😳', 'you like it? 😏'],
  ['model', 'how was work today?', 'long. better now'],
  ['fan', 'can’t stop thinking about your last post', 'that’s the idea 😇'],
];

/** The chat of a conversation past the hand-written ones (index 12 and on): two to four lines, a day to six weeks old. */
export function showcaseFillerChat(index: number): readonly ShowcaseLine[] {
  const [first, a, b] = FILLER[index % FILLER.length] ?? FILLER[0] ?? ['fan', 'hi', 'hi'];
  const second = first === 'fan' ? 'model' : 'fan';
  const at = D + ((index * 211) % (40 * D));
  const lines: ShowcaseLine[] = [
    [first, a, at],
    [second, b, at - 7],
  ];
  if (index % 3 === 0) lines.push([first, ['haha', 'you’re the best', 'deal 😉', 'good point'][index % 4] ?? 'haha', at - 9]);
  return lines;
}
