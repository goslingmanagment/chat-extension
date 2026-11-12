// The words of temporary chat pins on Fansly (contracts fansly-pins.ts): the strip, its chips, the rows' and the
// header's buttons. No long dash in what a chatter reads.
import { FANSLY_PIN_LIMITS, type FanslyPinsCopy } from '@cg/contracts/fansly-pins';

const HOURS = FANSLY_PIN_LIMITS.quietMs / (60 * 60 * 1000);
/** «Имя (@ник)»; a fan known by the handle alone is «@ник», said once. */
const who = (name: string, username: string | null): string => (username === null ? name : username === name ? `@${username}` : `${name} (@${username})`);

export const PINS_TEXTS: Readonly<Record<'ru' | 'en', FanslyPinsCopy>> = {
  ru: {
    strip: 'Закреплённые чаты',
    pin: 'Закрепить чат',
    unpin: 'Открепить',
    chipTitle: (name, username) => `${who(name, username)}. Снимется сам через ${HOURS} ч тишины`,
    chat: 'Чат',
  },
  en: {
    strip: 'Pinned chats',
    pin: 'Pin chat',
    unpin: 'Unpin',
    chipTitle: (name, username) => `${who(name, username)}. Unpins itself after ${HOURS} h of quiet`,
    chat: 'Chat',
  },
};
