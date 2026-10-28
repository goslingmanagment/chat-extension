// Telegram's row of the runtime table (./index.ts): its addresses, and nothing
// else (docs/specs/2026-10-27-telegram-site.md §2, §6.4). Telegram's own entry
// point imports this file alone — never the table, never another site's row.
// The registry entry (../telegram.ts) reads its addresses from here.

/** Telegram Web A, where its script runs once the person switched Telegram on: never Web K (`/k/`). */
export const TELEGRAM_MATCHES: readonly string[] = ['https://web.telegram.org/a/*'];

/**
 * Quiet mode (X3): the extension never sends a request of its own to Telegram — it reads the page and writes into its
 * field, nothing else; the background's fetch refuses Telegram's addresses as it refuses ChatSpace's.
 */
export const TELEGRAM_QUIET_DOMAINS: readonly string[] = ['telegram.org'];

/**
 * Where Telegram's own build of the lazy chunks lies in the extension (§3.2): `<root>/<entry>.js`, its shared chunks in
 * `<root>/chunks/`. The tab asks for its chunks here; the registry entry (../telegram.ts) has its build write them here.
 */
export const TELEGRAM_LAZY_ROOT = 'lazy/telegram';
