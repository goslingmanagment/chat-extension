// What the window of «Рассылка» says, put together from its view model: the media as words («Видео 6:12 за $25 +
// бесплатное фото»), «Кому» («Whale, Top и Prime · 1 условие»), the names of a note («Mike R и Daniel»), why a fan is
// left out. Texts come from the catalog; nothing here knows which site it is on.

import { type I18n, type OutreachAsideVM, type OutreachAudienceVM, type OutreachMediaVM, type OutreachMediumVM, type OutreachNamesVM } from '@cg/contracts/vm';

import { priceText } from '../spenders/preview/MediaPicker';
import { shelfLabel, shelfTier } from '../spenders/rows';

/** «6:12». */
export const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds) % 60).padStart(2, '0')}`;

/** «Видео 6:12», «Фото», «GIF», «Аудио 0:40». */
export function mediumWords(i18n: I18n, item: Pick<OutreachMediumVM, 'type' | 'duration'>): string {
  const key = item.type === 'video' ? 'outreach.medium.video' : item.type === 'gif' ? 'outreach.medium.gif' : item.type === 'audio' ? 'outreach.medium.audio' : 'outreach.medium.photo';
  return i18n.t(key, { duration: clock(item.duration) });
}

const paidOf = (media: OutreachMediaVM): readonly OutreachMediumVM[] => (media.priceCents > 0 ? media.items.filter((item) => !item.free) : []);
const freeOf = (media: OutreachMediaVM): readonly OutreachMediumVM[] => (media.priceCents > 0 ? media.items.filter((item) => item.free) : media.items);

/** The offer has something behind a price (or a post's bundle, which carries its post's price). */
export const isPaid = (media: OutreachMediaVM | null): boolean => media !== null && (paidOf(media).length > 0 || media.posts > 0);

/** «Видео 6:12 за $25 + бесплатное фото», «2 медиа за $40», «Фото бесплатно», «Бандл из поста». */
export function mediaTitle(i18n: I18n, media: OutreachMediaVM): string {
  if (media.items.length === 0) return i18n.plural('outreach.media.posts', media.posts);
  const paid = paidOf(media);
  const free = freeOf(media);
  const price = priceText(media.priceCents);
  const head = paid.length === 1 ? i18n.t('outreach.media.paidOne', { what: mediumWords(i18n, paid[0] as OutreachMediumVM), price }) : paid.length > 1 ? i18n.t('outreach.media.paidMany', { n: paid.length, price }) : '';
  if (head === '') return free.length === 1 ? i18n.t('outreach.media.freeOne', { what: mediumWords(i18n, free[0] as OutreachMediumVM) }) : i18n.t('outreach.media.freeMany', { n: free.length });
  if (free.length === 0) return head;
  const tail = free.length === 1 ? i18n.t(free[0]?.type === 'video' ? 'outreach.media.plusFreeVideo' : 'outreach.media.plusFreePhoto') : i18n.plural('outreach.media.plusFree', free.length);
  return `${head} + ${tail}`;
}

/** What the offer sells, in two words: «Видео 6:12», «2 медиа», «бандл из поста»; text alone — «только текст». */
export function mediaShort(i18n: I18n, media: OutreachMediaVM | null): string {
  if (media === null) return i18n.t('outreach.textOnly');
  if (media.items.length === 0) return i18n.plural('outreach.media.postsShort', media.posts);
  const paid = paidOf(media);
  const lead = paid[0] ?? media.items[0];
  if (lead === undefined) return i18n.t('outreach.textOnly');
  return paid.length > 1 ? i18n.t('outreach.media.many', { n: paid.length }) : mediumWords(i18n, lead);
}

/** «3 медиа · 1 бесплатное превью · $25» of the sheet's foot; «бандл из поста уходит как есть». */
export function mediaSummary(i18n: I18n, media: OutreachMediaVM): string {
  if (media.items.length === 0) return i18n.plural('outreach.media.posts', media.posts);
  const parts = [i18n.plural('outreach.media.count', media.items.length)];
  const free = media.items.filter((item) => item.free).length;
  if (media.priceCents > 0 && free > 0) parts.push(i18n.plural('outreach.media.previews', free));
  parts.push(media.priceCents > 0 ? priceText(media.priceCents) : i18n.t('outreach.media.free'));
  return parts.join(' · ');
}

/** «Mike R», «Mike R и Daniel», «Gordon, Mike R, Steve и ещё 4». */
export function namesText(i18n: I18n, names: OutreachNamesVM): string {
  const list = [...names.names];
  if (names.more > 0) return i18n.t('outreach.names.more', { names: list.join(', '), n: names.more });
  if (list.length <= 1) return list[0] ?? '';
  return i18n.t('outreach.names.and', { names: list.slice(0, -1).join(', '), last: list[list.length - 1] ?? '' });
}

/** A tier by its bounds: «Whale», else «$600+». */
export function tierWords(i18n: I18n, range: OutreachAudienceVM['tiers'][number]['range']): string {
  return shelfTier(i18n, range) ?? shelfLabel(i18n, range);
}

/** «Whale, Top и Prime · 1 условие», «5 отмеченных в Spenders», «никого». */
export function audienceLabel(i18n: I18n, audience: OutreachAudienceVM): string {
  let who: string;
  if (audience.source === 'picked') who = i18n.plural('outreach.audience.picked', audience.picked);
  else {
    const on = audience.tiers.filter((tier) => tier.on).map((tier) => tierWords(i18n, tier.range));
    who = on.length === 0 ? i18n.t('outreach.audience.nobody') : namesText(i18n, { names: on.length > 3 ? on.slice(0, 3) : on, more: Math.max(0, on.length - 3) });
  }
  const conditions = audience.conditions.filter((condition) => condition.on).length;
  return conditions === 0 ? who : `${who} · ${i18n.plural('outreach.audience.conditions', conditions)}`;
}

/** Why a fan is left out: «Уже купил видео 6:12 · 20 окт», «Ждёт ответа 2 ч — без тех, кто ждёт», «Снят вручную». */
export function asideText(i18n: I18n, reason: OutreachAsideVM, media: OutreachMediaVM | null): string {
  switch (reason.kind) {
    case 'bought': {
      const what = media === null ? null : (paidOf(media)[0] ?? null);
      const bought = what === null ? i18n.t('outreach.aside.boughtIt') : i18n.t('outreach.aside.bought', { what: mediumWords(i18n, what).toLowerCase() });
      return reason.at === null ? bought : `${bought} · ${i18n.formatTime(reason.at, 'date')}`;
    }
    case 'waiting':
      return reason.since === null ? i18n.t('outreach.aside.waiting') : i18n.t('outreach.aside.waitingFor', { age: i18n.formatAge(reason.since) });
    case 'spent':
      return i18n.t('outreach.aside.spent', { spent: i18n.formatMoneyMills(reason.lifetime, { zero: 'show' }), min: i18n.formatMoneyMills(reason.min, { zero: 'show' }) });
    case 'inactive':
      return i18n.t('outreach.aside.inactive');
    case 'manual':
      return i18n.t('outreach.aside.manual');
    case 'gone':
      return i18n.t('outreach.aside.gone');
  }
}
