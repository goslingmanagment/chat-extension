// Web A's accounts in one browser (telegram-tt util/accountSlot.ts, util/multiaccount.ts, util/sessions.ts): the
// active one is the URL's `?account=N` (N > 1; none means 1), and each slot's session lives in `localStorage` under
// `account<N>`: `{ dcId, date, dc<N>_auth_key, …, userId, firstName, … }` (`isTest` only when true). Slot 1 also
// keeps the legacy keys — `user_auth` (`{ dcID, id }`), `dc`, `dc<N>_auth_key` — which the extension never reads:
// here `user_auth` names another id, so a reader of it is caught. The stand writes both slots on every load, as two
// signed-in accounts would have left them; the keys are synthetic hex.

import { TELEGRAM_STAND_IDS } from './protocol';
import { ACCOUNTS } from './world';

/** `getAccountSlot`: the slot of `?account=N`, N > 1 and an integer; otherwise none (slot 1). */
export function accountSlot(url: string): number | undefined {
  const slot = Number(new URL(url).searchParams.get('account'));
  return slot > 1 && Number.isInteger(slot) ? slot : undefined;
}

/** A synthetic auth key: 256 bytes of hex, the same every load (never a real one). */
function fakeKey(seed: number): string {
  let state = seed >>> 0;
  let out = '';
  for (let index = 0; index < 256; index += 1) {
    state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
    out += ((state >>> 16) & 0xff).toString(16).padStart(2, '0');
  }
  return out;
}

export function writeAccountSlots(storage: Storage, now: number): void {
  for (const [slot, account] of Object.entries(ACCOUNTS)) {
    storage.setItem(
      `account${slot}`,
      JSON.stringify({
        dcId: 2,
        date: Math.floor(now / 1000),
        authKeyCreatedAt: Math.floor(now / 1000) - 86_400 * 40,
        dc2_auth_key: fakeKey(Number(slot) * 7919),
        dc2_server_salt: fakeKey(Number(slot) * 104_729).slice(0, 16),
        userId: account.userId,
        firstName: account.firstName,
        ...(account.lastName === '' ? {} : { lastName: account.lastName }),
        isPremium: false,
      }),
    );
  }
  storage.setItem('user_auth', JSON.stringify({ dcID: 2, id: TELEGRAM_STAND_IDS.legacyUser }));
  storage.setItem('dc', '2');
  storage.setItem('dc2_auth_key', JSON.stringify(fakeKey(31)));
}
