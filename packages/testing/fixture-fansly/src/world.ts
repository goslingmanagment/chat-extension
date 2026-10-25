// The showcase world on the Fansly stand (`pnpm see --showcase`, packages/testing/src/showcase.ts): the page server
// sets `data-stand-world="showcase"` on `<html>`, and the page then draws its fans' pictures and tells the time in the
// browser's own zone, as fansly.com does. The DOM's shape and the page's requests stay as they are.

import type { Account } from './data';
import { FANSLY_STAND_WORLD_ATTRIBUTE } from './protocol';

export const showcase = (): boolean => typeof document !== 'undefined' && document.documentElement.getAttribute(FANSLY_STAND_WORLD_ATTRIBUTE) === 'showcase';

/** A message's or an inbox row's `HH:MM`: UTC on the stand, the local time in the showcase. */
export function clock(seconds: number): string {
  const date = new Date(seconds * 1000);
  if (!showcase()) return date.toISOString().slice(11, 16);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** An `app-account-avatar` with the account's picture in the showcase (the stand's own circles stay plain). */
export function picture<T extends HTMLElement>(avatar: T, account: Account | undefined): T {
  if (showcase() && account?.avatar !== undefined) avatar.style.background = `center / cover no-repeat url("${account.avatar}")`;
  return avatar;
}
