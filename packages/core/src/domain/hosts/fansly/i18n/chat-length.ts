// The words of the chat's length in Fansly's chat header (contracts deleted-fansly.ts, 2026-11-08): the badge's short
// age and count, and its title in full. Whole calendar units, as «Регистрация» counts them. No long dash in what a
// chatter reads.
import type { ChatLengthCopy } from '@cg/contracts/deleted-fansly';

type Lang = 'ru' | 'en';

const RU = new Intl.PluralRules('ru');
/** The Russian form for `n`: «1 сообщение», «2 сообщения», «5 сообщений». */
const ru = (n: number, one: string, few: string, many: string): string => {
  const form = RU.select(n);
  return form === 'one' ? one : form === 'few' ? few : many;
};

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

/** «12 августа 2025» (the year always: a title is read with no context). */
const longDate = (lang: Lang) => (at: number): string =>
  new Date(at).toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric' }).replace(/(\d)\s+г\.$/, '$1');

export const CHAT_LENGTH_TEXTS: Readonly<Record<Lang, ChatLengthCopy>> = {
  ru: {
    age: chatAge('ru'),
    count: (messages) => messages.toLocaleString('ru'),
    title: (messages, since) =>
      messages === null
        ? `Переписка с ${longDate('ru')(since)}. Сколько в ней сообщений, Hub пока не знает точно`
        : `${messages.toLocaleString('ru')} ${ru(messages, 'сообщение', 'сообщения', 'сообщений')} с ${longDate('ru')(since)}`,
  },
  en: {
    age: chatAge('en'),
    count: (messages) => messages.toLocaleString('en'),
    title: (messages, since) =>
      messages === null
        ? `Chatting since ${longDate('en')(since)}. Hub does not know the exact message count yet`
        : `${messages.toLocaleString('en')} ${messages === 1 ? 'message' : 'messages'} since ${longDate('en')(since)}`,
  },
};
