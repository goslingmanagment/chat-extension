// Whose Telegram account the tab shows (docs/specs/2026-10-27-telegram-site.md §4.1). Web A keeps several accounts in
// one browser: the active one is the address's `?account=N` (N > 1; none means 1) while the browser has SharedWorker
// (telegram-tt src/util/accountSlot.ts, src/util/multiaccount.ts `ACCOUNT_SLOT`), and its session lives in the page's
// storage under `account<N>`. Only the `userId` field of that one entry is read; the rest of it (the auth keys sit next
// to it) is parsed and dropped at once, never kept or logged. The legacy `user_auth` key follows slot 1 only and is
// never read. Missing, unreadable, or empty because a passcode keeps the session store in memory: no account.
//
// The storage itself is the entry point's port (`read`): the packages' lint forbids `localStorage`.

/** The page's `?account=` query (telegram-tt src/config.ts `ACCOUNT_QUERY`). */
const ACCOUNT_QUERY = 'account';
/** A session entry's key: `account<N>` (telegram-tt src/config.ts `SESSION_ACCOUNT_PREFIX`). */
const SESSION_ACCOUNT_PREFIX = 'account';
/** A Telegram user id: a positive integer. */
const USER_ID = /^[1-9]\d{0,19}$/;

/** The page's storage as the entry point hands it in: one key's text, or null. */
export type SessionRead = (key: string) => string | null;

/**
 * The active slot: `?account=N` when N > 1 is an integer and the browser runs several accounts (SharedWorker), else 1 —
 * as telegram-tt's `getAccountSlot` reads it.
 */
export function accountSlotOf(href: string, multiaccount: boolean): number {
  if (!multiaccount) return 1;
  let raw: string | null;
  try {
    raw = new URL(href).searchParams.get(ACCOUNT_QUERY);
  } catch {
    return 1;
  }
  if (raw === null) return 1;
  const slot = Number(raw);
  return Number.isInteger(slot) && slot > 1 ? slot : 1;
}

/** The `userId` of one session entry's text; null — none, not JSON, or not a user id. */
export function userIdOf(text: string | null): string | null {
  if (text === null || text === '') return null;
  let id: unknown;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return null;
    id = (parsed as { readonly userId?: unknown }).userId;
  } catch {
    return null;
  }
  const value = typeof id === 'number' && Number.isSafeInteger(id) ? String(id) : typeof id === 'string' ? id : null;
  return value !== null && USER_ID.test(value) ? value : null;
}

/** The active account's user id, read anew on every call; null — no account the tab may act for. */
export function activeUserIdOf(href: string, multiaccount: boolean, read: SessionRead): string | null {
  let text: string | null;
  try {
    text = read(`${SESSION_ACCOUNT_PREFIX}${accountSlotOf(href, multiaccount)}`);
  } catch {
    return null;
  }
  return userIdOf(text);
}
