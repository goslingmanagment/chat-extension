// The words of «Фан удалил» in Fansly's chat header (contracts deleted-fansly.ts): the mark, its card's title and hint,
// when each message was sent and how soon it went. No long dash in what a chatter reads.
import type { DeletedMessagesCopy } from '@cg/contracts/deleted-fansly';

type Lang = 'ru' | 'en';

const RU = new Intl.PluralRules('ru');
/** The Russian form for `n`: «1 сообщение», «2 сообщения», «5 сообщений». */
const ru = (n: number, one: string, few: string, many: string): string => {
  const form = RU.select(n);
  return form === 'one' ? one : form === 'few' ? few : many;
};
const en = (n: number, one: string, other: string): string => (n === 1 ? one : other);

const startOfDay = (at: number): number => {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

/** «сегодня 21:49», «вчера 21:49», «2 нояб., 21:49», «2 нояб. 2025, 21:49» in the tab's own time zone. */
export const deletedWhen = (lang: Lang) => (at: number, now: number): string => {
  const date = new Date(at);
  const time = date.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  if (days === 0) return lang === 'ru' ? `сегодня ${time}` : `today ${time}`;
  if (days === 1) return lang === 'ru' ? `вчера ${time}` : `yesterday ${time}`;
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  // «12 окт. 2025 г.» reads as «12 окт. 2025».
  const day = date.toLocaleDateString(lang, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }).replace(/(\d)\s+г\.$/, '$1');
  return `${day}, ${time}`;
};

/** How soon after the send it went: «8 сек», «12 мин», «5 ч», «3 дн.». */
export const deletedAfter = (lang: Lang) => (ms: number): string => {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return lang === 'ru' ? `${String(seconds)} сек` : `${String(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return lang === 'ru' ? `${String(minutes)} мин` : `${String(minutes)} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return lang === 'ru' ? `${String(hours)} ч` : `${String(hours)} h`;
  const days = Math.round(hours / 24);
  return lang === 'ru' ? `${String(days)} дн.` : `${String(days)} d`;
};

const meta = (lang: Lang) => {
  const when = deletedWhen(lang);
  const after = deletedAfter(lang);
  return (sentAt: number | null, deletedAt: number, now: number): string => {
    if (sentAt === null || sentAt > deletedAt) return lang === 'ru' ? `удалил ${when(deletedAt, now)}` : `deleted ${when(deletedAt, now)}`;
    return lang === 'ru' ? `${when(sentAt, now)} · удалил через ${after(deletedAt - sentAt)}` : `${when(sentAt, now)} · deleted ${after(deletedAt - sentAt)} later`;
  };
};

export const DELETED_TEXTS: Readonly<Record<Lang, DeletedMessagesCopy>> = {
  ru: {
    mark: 'Удалил',
    title: (count) => `Фан удалил ${String(count)} ${ru(count, 'сообщение', 'сообщения', 'сообщений')}`,
    hint: 'Фан не знает, что удалённое видно. Не цитируйте его и не намекайте.',
    meta: meta('ru'),
    fresh: 'новое',
    noText: 'Без текста',
    notKept: 'Текст не сохранился',
    attachments: (count) => `${String(count)} ${ru(count, 'вложение', 'вложения', 'вложений')}`,
    more: (count) => `Раньше удалено ещё ${String(count)} ${ru(count, 'сообщение', 'сообщения', 'сообщений')}`,
  },
  en: {
    mark: 'Deleted',
    title: (count) => `The fan deleted ${String(count)} ${en(count, 'message', 'messages')}`,
    hint: 'The fan does not know deleted messages stay visible. Do not quote them or hint at them.',
    meta: meta('en'),
    fresh: 'new',
    noText: 'No text',
    notKept: 'The text was not kept',
    attachments: (count) => `${String(count)} ${en(count, 'attachment', 'attachments')}`,
    more: (count) => `${String(count)} more deleted earlier`,
  },
};
