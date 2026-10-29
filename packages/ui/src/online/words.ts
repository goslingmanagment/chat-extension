// «Онлайн» in words: why to write to a fan now, why they are set aside, how fresh their presence is, what wrote the
// text. One place for the rows and the card, so the two never say it differently.

import { type IsoTimestamp } from '@cg/contracts/primitives';
import { type I18n, type OnlineAct, type OnlineAsideVM, type OnlineCardVM, type OnlineReasonVM, type OnlineRowVM } from '@cg/contracts/vm';

/** «через 2 д»: the time left until `at` in the age's own words. */
export function timeLeft(i18n: I18n, at: IsoTimestamp, now = Date.now()): string {
  const end = Date.parse(at);
  return Number.isNaN(end) ? i18n.t('common.unknown') : i18n.formatAge(2 * now - end, now);
}

/** What wrote the text: «Reply», «Hi», «Ping», «Шаблон», «Fix», «Свой текст». */
export function actWord(i18n: I18n, act: OnlineAct | null): string {
  switch (act) {
    case 'reply':
      return i18n.t('online.act.reply');
    case 'hi':
      return i18n.t('online.act.hi');
    case 'ping':
      return i18n.t('online.act.ping');
    case 'template':
      return i18n.t('online.act.template');
    case 'fix':
      return i18n.t('online.act.fix');
    case 'own':
      return i18n.t('online.act.own');
    case 'none':
    case null:
      return i18n.t('online.act.text');
  }
}

/** The row's line of why to write now: «Ждёт ответа 7 мин», «Платил, молчит 12 д», «Подписка кончается через 2 д». */
export function reasonShort(i18n: I18n, reason: OnlineReasonVM, sentAct: OnlineAct | null): string {
  switch (reason.kind) {
    case 'waiting':
      return reason.since === null ? i18n.t('online.why.waitingNow') : i18n.t('online.why.waiting', { age: i18n.formatAge(reason.since) });
    case 'answered':
      return i18n.t('online.why.answered', { act: sentAct === 'template' ? i18n.t('online.act.templateLower') : sentAct === 'own' ? i18n.t('online.act.ownLower') : actWord(i18n, sentAct), age: reason.at === null ? i18n.t('common.unknown') : i18n.formatAge(reason.at) });
    case 'new':
      return reason.subscribedAt === null ? i18n.t('online.why.newNow') : i18n.t('online.why.new', { age: i18n.formatAge(reason.subscribedAt) });
    case 'expiring':
      return reason.endsAt === null ? i18n.t('online.why.expiringSoon') : i18n.t('online.why.expiring', { left: timeLeft(i18n, reason.endsAt) });
    case 'silent':
      return reason.since === null ? i18n.t('online.why.silentNow') : i18n.t('online.why.silent', { age: i18n.formatAge(reason.since) });
    case 'quiet':
      return reason.since === null ? i18n.t('online.why.quietNow') : i18n.t('online.why.quiet', { age: i18n.formatAge(reason.since) });
    case 'never':
      return reason.subscribedAt === null ? i18n.t('online.why.never') : i18n.t('online.why.neverFor', { age: i18n.formatAge(reason.subscribedAt) });
    case 'none':
      return reason.lastAt === null ? i18n.t('online.why.none') : i18n.t('online.why.noneLast', { age: i18n.formatAge(reason.lastAt) });
    case 'queue':
      // «Очереди»: why the fan is in the queue, as the asker or the hub put it; else the queue's name.
      return reason.why ?? i18n.t('queues.why.lead', { name: reason.queue });
  }
}

/** Why the fan is set aside, in one line: «С ним переписывается Аня», «Писали ему 5 ч назад». */
export function asideText(i18n: I18n, aside: OnlineAsideVM): string {
  switch (aside.kind) {
    case 'talking':
      return aside.names === '' ? i18n.t('online.aside.talkingSomeone') : i18n.t('online.aside.talking', { names: aside.names });
    case 'wrote':
      return aside.at === null ? i18n.t('online.aside.wroteRecently') : i18n.t('online.aside.wrote', { age: i18n.formatAge(aside.at) });
    case 'tried':
      return aside.at === null ? i18n.t('online.aside.triedRecently') : i18n.t('online.aside.tried', { age: i18n.formatAge(aside.at) });
    case 'dismissed':
      return aside.by === null ? i18n.t('online.aside.dismissedYou') : i18n.t('online.aside.dismissed', { by: aside.by });
    case 'unreachable':
      return i18n.t('online.aside.unreachable');
  }
}

/** How fresh the presence is, short for the row's end: «в сети», «3 мин», «1 ч». */
export function seenShort(i18n: I18n, fan: Pick<OnlineRowVM, 'live' | 'onlineSince' | 'seenAt'>): string {
  if (fan.live) return i18n.t('online.seen.live');
  const at = fan.onlineSince ?? fan.seenAt;
  return at === null ? i18n.t('common.unknown') : i18n.formatAge(at);
}

/** The same in a sentence for the card: «в сети сейчас», «зашёл 3 мин назад», «был 12 мин назад». */
export function seenLong(i18n: I18n, fan: Pick<OnlineCardVM, 'live' | 'onlineSince' | 'seenAt'>): string {
  if (fan.live) return i18n.t('online.seen.liveLong');
  if (fan.onlineSince !== null) return i18n.t('online.seen.came', { age: i18n.formatAge(fan.onlineSince) });
  if (fan.seenAt === null) return i18n.t('online.seen.unknown');
  return i18n.t('online.seen.was', { age: i18n.formatAge(fan.seenAt) });
}

/** The first word of a name: «Ivan» of «Ivan Petrov». */
export const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;
