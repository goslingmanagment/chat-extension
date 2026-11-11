// The words of the chat's length in the site's chat header (contracts chat-length.ts, 2026-11-08 on Fansly): the
// badge's count (or its short age when the hub has no count), what a screen reader hears, and the card under it in full.
// Whole calendar units, as «Регистрация» counts them. No long dash in what a chatter reads.
//
// 2026-11-11 (the owner: «чтобы писалось, кто из чатеров сколько сообщений оставил»): the card's breakdown by author,
// in the words of «кто написал» under the model's messages (message-authors.ts, changes/fansly-message-authors.md): a
// hub login as it is, «без автора» for a message nobody is known for.
//
// The same day (the owner of ChatSpace: «и с хуя ли на чатспейсе его нет? там же все то же самое нужно») the words of
// both sites: moved here from Fansly's text pack, one catalog per site built by `chatLengthTexts`. The sites differ only
// in the day the hub began to record authors there (the «Без автора» line). And the card's last line where the hub's
// numbers are what it has seen, not proven from the chat's start (`approximate`, OnlyFans).
import type { ChatLengthCopy } from '@cg/contracts/chat-length';

type Lang = 'ru' | 'en';

const RU = new Intl.PluralRules('ru');
/** The Russian form for `n`: «1 сообщение», «2 сообщения», «5 сообщений». */
const ru = (n: number, one: string, few: string, many: string): string => {
  const form = RU.select(n);
  return form === 'one' ? one : form === 'few' ? few : many;
};
const en = (n: number, one: string, many: string): string => (n === 1 ? one : many);

const startOfDay = (at: number): number => {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

/** Whole days and whole calendar months from `since` to `now`, in the tab's own time zone. */
export function chatSpan(since: number, now: number): { readonly days: number; readonly months: number } {
  const then = new Date(since);
  const today = new Date(now);
  const days = Math.max(0, Math.round((startOfDay(now) - startOfDay(since)) / 86_400_000));
  const months = Math.max(0, (today.getFullYear() - then.getFullYear()) * 12 + today.getMonth() - then.getMonth() - (today.getDate() < then.getDate() ? 1 : 0));
  return { days, months };
}

/** «сегодня», «вчера», «5 дн», «3 нед», «4 мес», «1 г», «1 г 3 мес»; en «today», «5d», «3w», «4mo», «1y 3mo». */
export const chatAge = (lang: Lang) => (since: number, now: number): string => {
  const { days, months } = chatSpan(since, now);
  if (days === 0) return lang === 'ru' ? 'сегодня' : 'today';
  if (days === 1) return lang === 'ru' ? 'вчера' : 'yesterday';
  if (days < 7) return lang === 'ru' ? `${String(days)} дн` : `${String(days)}d`;
  if (months < 1) return lang === 'ru' ? `${String(Math.floor(days / 7))} нед` : `${String(Math.floor(days / 7))}w`;
  if (months < 12) return lang === 'ru' ? `${String(months)} мес` : `${String(months)}mo`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (lang === 'en') return rest === 0 ? `${String(years)}y` : `${String(years)}y ${String(rest)}mo`;
  return rest === 0 ? `${String(years)} г` : `${String(years)} г ${String(rest)} мес`;
};

/** The same span in words: «сегодня», «1 день», «3 недели», «4 месяца», «1 год 3 месяца»; en «2 weeks», «1 year 3 months». */
export const chatAgeLong = (lang: Lang) => (since: number, now: number): string => {
  const { days, months } = chatSpan(since, now);
  const n = String;
  if (days === 0) return lang === 'ru' ? 'сегодня' : 'today';
  if (days < 7) return lang === 'ru' ? `${n(days)} ${ru(days, 'день', 'дня', 'дней')}` : `${n(days)} ${en(days, 'day', 'days')}`;
  if (months < 1) {
    const weeks = Math.floor(days / 7);
    return lang === 'ru' ? `${n(weeks)} ${ru(weeks, 'неделя', 'недели', 'недель')}` : `${n(weeks)} ${en(weeks, 'week', 'weeks')}`;
  }
  const monthsText = (m: number): string => (lang === 'ru' ? `${n(m)} ${ru(m, 'месяц', 'месяца', 'месяцев')}` : `${n(m)} ${en(m, 'month', 'months')}`);
  if (months < 12) return monthsText(months);
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const yearsText = lang === 'ru' ? `${n(years)} ${ru(years, 'год', 'года', 'лет')}` : `${n(years)} ${en(years, 'year', 'years')}`;
  return rest === 0 ? yearsText : `${yearsText} ${monthsText(rest)}`;
};

/** «12 августа 2025» (the year always: the card is read with no context). */
const longDate = (lang: Lang) => (at: number): string =>
  new Date(at).toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric' }).replace(/(\d)\s+г\.$/, '$1');

/** Below a week the average says nothing. */
const PACE_FROM_DAYS = 7;

/** Messages a day, or a week when fewer than one a day; 'rare' below one a week; null below a week of chat. */
function paceOf(messages: number, since: number, now: number): { readonly per: 'day' | 'week'; readonly n: number } | 'rare' | null {
  const { days } = chatSpan(since, now);
  if (days < PACE_FROM_DAYS) return null;
  const daily = messages / days;
  if (daily >= 1) return { per: 'day', n: Math.round(daily) };
  const weekly = Math.round(daily * 7);
  return weekly < 1 ? 'rare' : { per: 'week', n: weekly };
}

/**
 * A site's catalog of the badge's words. `authorsSince` — the day the hub began to record authors on that site, as the
 * «Без автора» line says it, with no-break spaces (the date never splits across lines): «24 октября 2026».
 */
export function chatLengthTexts(authorsSince: Readonly<Record<Lang, string>>): Readonly<Record<Lang, ChatLengthCopy>> {
  return {
    ru: {
      age: chatAge('ru'),
      count: (messages) => messages.toLocaleString('ru'),
      title: (messages, since) =>
        messages === null
          ? `Переписка с ${longDate('ru')(since)}. Сколько в ней сообщений, Hub пока не знает точно`
          : `${messages.toLocaleString('ru')} ${ru(messages, 'сообщение', 'сообщения', 'сообщений')} с ${longDate('ru')(since)}`,
      heading: (messages) => (messages === null ? 'Переписка' : `${messages.toLocaleString('ru')} ${ru(messages, 'сообщение', 'сообщения', 'сообщений')}`),
      since: (since, now) => `с ${longDate('ru')(since)} · ${chatAgeLong('ru')(since, now)}`,
      pace: (messages, since, now) => {
        const pace = paceOf(messages, since, now);
        if (pace === null) return null;
        if (pace === 'rare') return 'реже одного сообщения в неделю';
        return `в среднем ${String(pace.n)} ${ru(pace.n, 'сообщение', 'сообщения', 'сообщений')} в ${pace.per === 'day' ? 'день' : 'неделю'}`;
      },
      unknown: 'Число сообщений Hub пока не знает: история чата ещё не дочитана',
      approximate: 'Hub считает сообщения, которые видел сам: самых старых здесь может не быть',
      authors: 'Кто сколько написал',
      fan: 'Фан',
      me: '(вы)',
      unattributed: 'Без автора',
      unattributedHint: `Массовые рассылки, сообщения не из расширения и всё до ${authorsSince.ru}, когда Hub начал записывать авторов`,
    },
    en: {
      age: chatAge('en'),
      count: (messages) => messages.toLocaleString('en'),
      title: (messages, since) =>
        messages === null
          ? `Chatting since ${longDate('en')(since)}. Hub does not know the exact message count yet`
          : `${messages.toLocaleString('en')} ${en(messages, 'message', 'messages')} since ${longDate('en')(since)}`,
      heading: (messages) => (messages === null ? 'Chat' : `${messages.toLocaleString('en')} ${en(messages, 'message', 'messages')}`),
      since: (since, now) => `since ${longDate('en')(since)} · ${chatAgeLong('en')(since, now)}`,
      pace: (messages, since, now) => {
        const pace = paceOf(messages, since, now);
        if (pace === null) return null;
        if (pace === 'rare') return 'less than one message a week';
        return `about ${String(pace.n)} ${en(pace.n, 'message', 'messages')} a ${pace.per}`;
      },
      unknown: 'Hub does not know the message count yet: the chat history is not read to its start',
      approximate: 'Hub counts the messages it has seen itself: the oldest ones may be missing here',
      authors: 'Who wrote how many',
      fan: 'Fan',
      me: '(you)',
      unattributed: 'No author',
      unattributedHint: `Mass messages, sends from outside the extension, and everything before ${authorsSince.en}, when Hub began to record authors`,
    },
  };
}
