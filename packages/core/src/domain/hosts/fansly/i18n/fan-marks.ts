// The words of the fan's warning marks in Fansly's chat header (contracts fan-marks-fansly.ts): the blocklist mark,
// where the fan is in a list like «💩 Бомж», the explanation of FANSLY BLOCKLIST's posts. The list mark itself is the
// list's own label, as Fansly shows it. No long dash in what a chatter reads.
import type { FanMarksCopy } from '@cg/contracts/fan-marks-fansly';

const day = (locale: string) => (at: number, now: number): string => {
  const date = new Date(at);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  const text = date.toLocaleDateString(locale, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  // «12 окт. 2025 г.» reads as «12 окт. 2025» (and «24 авг.» keeps its month).
  return text.replace(/(\d)\s+г\.$/, '$1');
};

export const FAN_MARKS_TEXTS: Readonly<Record<'ru' | 'en', FanMarksCopy>> = {
  ru: {
    blocklist: '⛔ Блоклист',
    listsWhere: (label, here, names) => `В списке «${label}» у ${[...(here ? ['этой модели'] : []), ...names].join(', ')}`,
    postsTitle: 'Есть в FANSLY BLOCKLIST',
    postsAbout: 'Telegram-группа, где агентства предупреждают о проблемных фанах',
    open: 'Открыть в Telegram',
    openNote: 'Ссылка откроется, если вы состоите в группе',
    aboutHandle: (handle) => `о @${handle}`,
    date: day('ru'),
  },
  en: {
    blocklist: '⛔ Blocklist',
    listsWhere: (label, here, names) => `In the list «${label}» of ${[...(here ? ['this model'] : []), ...names].join(', ')}`,
    postsTitle: 'In FANSLY BLOCKLIST',
    postsAbout: 'A Telegram group where agencies warn about problem fans',
    open: 'Open in Telegram',
    openNote: 'The link opens if you are a member of the group',
    aboutHandle: (handle) => `about @${handle}`,
    date: day('en'),
  },
};
