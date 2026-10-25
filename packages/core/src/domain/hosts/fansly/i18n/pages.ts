// Fansly's texts on the extension pages (R20 P14b1; docs/project-unite/architecture.md §3.4; FS-SET-1): its card in
// «Аккаунты», its rows in «Вид и звук» and «Генерация», its steps of the first run — keys `fansly.pages.*`
// (contracts pages-fansly.ts). The pages carry them; the shared catalog does not, so no ChatSpace bundle does. The old
// Fansly extension's words where it had them («Fansly через вкладку», «Вкладки Fansly без атрибуции»), in the
// chatter's vocabulary.

import type { I18nKey } from '@cg/contracts/errors';
import type { Locale } from '@cg/contracts/i18n/keys';
import type { FanslyPageTextKey } from '@cg/contracts/pages-fansly';
import type { I18n } from '@cg/contracts/vm';

import { createLiveI18n } from '../../../i18n/live';

export type FanslyPageCatalog = Readonly<Record<FanslyPageTextKey, string>>;

const RU: FanslyPageCatalog = {
  'fansly.pages.card': 'Fansly',
  'fansly.pages.leadOff': 'ChatGoose на Fansly выключен. При включении браузер спросит доступ к fansly.com, открытые вкладки Fansly перезагрузятся сами.',
  'fansly.pages.leadOn': 'ChatGoose работает на Fansly в этом браузере.',
  'fansly.pages.state': 'Состояние',
  'fansly.pages.stateHint': 'Только в этом браузере. Если выключено, на Fansly нет ни панели, ни звука.',
  'fansly.pages.stateOn': 'Включён',
  'fansly.pages.stateOff': 'Выключен',
  'fansly.pages.stateNoAccess': 'Включён, но браузер не дал доступ к fansly.com',
  'fansly.pages.stateUnknown': 'Неизвестно',
  'fansly.pages.tabs': 'Вкладки Fansly',
  'fansly.pages.tabsHint': 'Вкладка, открытая до включения или обновления, работает без ChatGoose, пока её не перезагрузить.',
  'fansly.pages.tabsOpen': 'Открыто: {n}',
  'fansly.pages.tabsUnknown': 'Неизвестно, сколько открыто',
  'fansly.pages.tabsUnattributed': 'Вкладки Fansly без атрибуции: {n}. Откройте в ней чат, и строка аккаунта оживёт.',
  'fansly.pages.viaTab': 'Fansly через вкладку',
  'fansly.pages.viaTabHint': 'Для работы без VPN: запросы ChatGoose к Fansly идут через открытую вкладку модели и её прокси.',
  'fansly.pages.readFailed': 'Настройки Fansly не прочитались.',
  'fansly.pages.tones': 'Тон звука на Fansly',
  'fansly.pages.tonesHint': 'Тон на Fansly; вкл/выкл и громкость общие',
  'fansly.pages.toneMessages': 'Сообщения на Fansly',
  'fansly.pages.toneSubscribers': 'Подписчики на Fansly',
  'fansly.pages.deep': 'Review и полный Recap на Fansly',
  'fansly.pages.deepHint': 'Хаб берёт до {max} сообщений. Больше 3000 можно только на Fansly; 3000 и меньше действует как в строке выше.',
  'fansly.pages.steps': 'На Fansly',
  'fansly.pages.stepEnable': 'Включить Fansly',
  'fansly.pages.stepOpen': 'Открыть Fansly под моделью',
  'fansly.pages.stepReload': 'Перезагрузить вкладки Fansly',
  'fansly.pages.importTitle': 'Перенос из старого расширения',
  'fansly.pages.importLead': 'Персоны страниц Fansly можно взять из старого ChatGoose для Fansly: в нём Настройки → «Персоны» → «Архив локальной персоны» → «Копировать» (или «Скачать JSON»). Вставьте сюда: персону получат только страницы, у которых её ещё нет.',
  'fansly.pages.importPlaceholder': 'Вставьте сюда то, что скопировали в старом расширении',
  'fansly.pages.importFile': 'Выбрать файл',
  'fansly.pages.importRun': 'Перенести',
  'fansly.pages.importDone': 'Персоны из старого расширения перенесены.',
  'fansly.pages.importNone': 'Переносить нечего: у страниц Fansly уже есть персоны, или в старом расширении их аккаунты ни с какой персоной не связаны.',
  'fansly.pages.importBad': 'Это не данные старого расширения. Скопируйте их там ещё раз.',
};

const EN: FanslyPageCatalog = {
  'fansly.pages.card': 'Fansly',
  'fansly.pages.leadOff': 'ChatGoose on Fansly is off. Turning it on, the browser asks for access to fansly.com; the open Fansly tabs reload by themselves.',
  'fansly.pages.leadOn': 'ChatGoose works on Fansly in this browser.',
  'fansly.pages.state': 'State',
  'fansly.pages.stateHint': 'This browser only. When off, Fansly gets no panel and no sound.',
  'fansly.pages.stateOn': 'On',
  'fansly.pages.stateOff': 'Off',
  'fansly.pages.stateNoAccess': 'On, but the browser gave no access to fansly.com',
  'fansly.pages.stateUnknown': 'Unknown',
  'fansly.pages.tabs': 'Fansly tabs',
  'fansly.pages.tabsHint': 'A tab opened before switching on or an update works without ChatGoose until it is reloaded.',
  'fansly.pages.tabsOpen': 'Open: {n}',
  'fansly.pages.tabsUnknown': 'How many are open is unknown',
  'fansly.pages.tabsUnattributed': 'Fansly tabs with no account: {n}. Open a chat in it and the account’s row comes alive.',
  'fansly.pages.viaTab': 'Fansly through the tab',
  'fansly.pages.viaTabHint': 'To work without a VPN: ChatGoose’s requests to Fansly go through the model’s open tab and its proxy.',
  'fansly.pages.readFailed': 'Fansly’s settings could not be read.',
  'fansly.pages.tones': 'Sound tone on Fansly',
  'fansly.pages.tonesHint': 'The tone on Fansly; on/off and volume are shared',
  'fansly.pages.toneMessages': 'Messages on Fansly',
  'fansly.pages.toneSubscribers': 'Subscribers on Fansly',
  'fansly.pages.deep': 'Review and full Recap on Fansly',
  'fansly.pages.deepHint': 'The hub takes up to {max} messages. Above 3000 is for Fansly only; 3000 or less works as in the row above.',
  'fansly.pages.steps': 'On Fansly',
  'fansly.pages.stepEnable': 'Turn Fansly on',
  'fansly.pages.stepOpen': 'Open Fansly as the model',
  'fansly.pages.stepReload': 'Reload the Fansly tabs',
  'fansly.pages.importTitle': 'Carry over from the old extension',
  'fansly.pages.importLead': 'The Fansly pages’ personas can come from the old ChatGoose for Fansly: there Settings → Personas → «Архив локальной персоны» → «Копировать» (or «Скачать JSON»). Paste it here: only pages without a persona get one.',
  'fansly.pages.importPlaceholder': 'Paste what you copied in the old extension',
  'fansly.pages.importFile': 'Choose a file',
  'fansly.pages.importRun': 'Carry over',
  'fansly.pages.importDone': 'The personas of the old extension are carried over.',
  'fansly.pages.importNone': 'Nothing to carry over: the Fansly pages already have personas, or the old extension tied their accounts to none.',
  'fansly.pages.importBad': 'This is not the old extension’s data. Copy it there again.',
};

export const FANSLY_PAGE_TEXTS: { readonly [L in Locale]: FanslyPageCatalog } = { ru: RU, en: EN };

const PREFIX = 'fansly.pages.';

/**
 * The pages' I18n with Fansly's page texts laid over it: a `fansly.pages.*` key is answered from this pack in the
 * page's language at the moment of the call; every other key, number and time is the page's own port's (its
 * language switch included).
 */
export function withFanslyPageTexts(base: I18n): I18n {
  const own = createLiveI18n((language) => FANSLY_PAGE_TEXTS[language], { language: base.language });
  const mine = (key: I18nKey): boolean => (key as string).startsWith(PREFIX);
  const now = (): typeof own => {
    if (own.language !== base.language) own.setLanguage(base.language);
    return own;
  };
  return {
    get language() {
      return base.language;
    },
    t: (key, params) => (mine(key) ? now().t(key, params) : base.t(key, params)),
    plural: (key, count, params) => base.plural(key, count, params),
    text: (msg) => (mine(msg.key) ? now().text(msg) : base.text(msg)),
    formatMoneyMills: (mills, format) => base.formatMoneyMills(mills, format),
    ...(base.formatMoneySpoken === undefined ? {} : { formatMoneySpoken: (mills: Parameters<I18n['formatMoneyMills']>[0], format?: Parameters<I18n['formatMoneyMills']>[1]) => base.formatMoneySpoken?.(mills, format) ?? '' }),
    formatAge: (from, at) => base.formatAge(from, at),
    formatTime: (at, style) => base.formatTime(at, style),
    ...(base.formatTimeIn === undefined ? {} : { formatTimeIn: (at: Parameters<I18n['formatTime']>[0], zone: string, style?: Parameters<I18n['formatTime']>[1]) => base.formatTimeIn?.(at, zone, style) ?? '' }),
    formatDuration: (ms, style) => base.formatDuration(ms, style),
    subscribe: (listener) => base.subscribe(listener),
  };
}

/** A Fansly page text through an I18n that has the pack laid over it (`withFanslyPageTexts`). */
export function fanslyPageText(i18n: I18n, key: FanslyPageTextKey, params?: Parameters<I18n['t']>[1]): string {
  return i18n.t(key as unknown as I18nKey, params);
}
