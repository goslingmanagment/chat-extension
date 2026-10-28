// Optional-site configuration for the core's permission and observation services.
// The core takes these inert data/functions; no site's chunk is imported here.
import { FANSLY_API_MATCHES, FANSLY_MATCHES } from '../hosts/runtime/fansly';
import { FANSLY_STAND_MATCHES, TELEGRAM_STAND_MATCHES } from '../hosts/runtime';
import { TELEGRAM_MATCHES } from '../hosts/runtime/telegram';

export { FANSLY_RELAY_PAGE } from '../hosts/runtime/fansly';

export const OPTIONAL_HOST = 'fansly-web' as const;
export const SESSION_KEY = 'fansly.session';
export const RELOAD_KEY = 'fansly.waitingReload';
/**
 * The prefix of the site's own request types (contracts tab-messages-fansly.ts `FANSLY_TAB_TYPE_PREFIX`, pinned by
 * test/wiring-fansly.test.ts): a page's request of such a type goes to the site's module (R20 P14b1).
 */
export const SITE_TYPE_PREFIX = 'fansly.';
export const siteMatches = (): string[] => __CG_TEST_HOSTS__ ? [...FANSLY_MATCHES, ...FANSLY_STAND_MATCHES] : [...FANSLY_MATCHES];
export const permissionSet = () => ({ origins: __CG_TEST_HOSTS__ ? [...FANSLY_STAND_MATCHES] : [...FANSLY_MATCHES, ...FANSLY_API_MATCHES], permissions: ['webRequest'] });
export const apiMatches = (): string[] => __CG_TEST_HOSTS__ ? [...FANSLY_API_MATCHES, ...FANSLY_STAND_MATCHES] : [...FANSLY_API_MATCHES];
export const scriptSet = () => [
  { id: 'fansly-main', js: ['fansly-main.js'], world: 'MAIN' as const, matches: siteMatches() },
  { id: 'fansly', js: ['fansly.js'], world: 'ISOLATED' as const, matches: siteMatches() },
];
export function pageAddress(value: string | undefined): boolean {
  if (value === undefined) return false;
  try { const url = new URL(value); return url.origin === 'https://fansly.com' || (__CG_TEST_HOSTS__ && url.protocol === 'http:' && url.hostname === 'localhost'); } catch { return false; }
}
export function apiAddress(value: string): boolean {
  try { const url = new URL(value); return (url.origin === 'https://apiv3.fansly.com' || (__CG_TEST_HOSTS__ && url.protocol === 'http:' && url.hostname === 'localhost')) && url.pathname.startsWith('/api/v1/'); } catch { return false; }
}
/** Route checks are independent: a check for /account never replaces /message's. */
export function routeFamily(value: string): string | null {
  try {
    const path = new URL(value).pathname;
    return [
      ['/api/v1/account/wallets/earnings/', 'earnings'], ['/api/v1/subscribers', 'subscribers'],
      ['/api/v1/media/orderhistory', 'media'], ['/api/v1/messaging/groups', 'messagingGroups'],
      ['/api/v1/group/', 'group'], ['/api/v1/message', 'message'], ['/api/v1/account', 'account'],
    ].find(([prefix]) => prefix !== undefined && path.startsWith(prefix))?.[1] ?? null;
  } catch { return null; }
}

/**
 * Telegram Web A, the second optional site (docs/specs/2026-10-27-telegram-site.md §6.3): its own switch, rights and
 * script, apart from Fansly's. None of Fansly's services is Telegram's: no relay page, no `fansly.` requests, no network
 * session, no freshness hook, no notice script (an open tab reloads on the grant; after an update it needs a reload).
 */
export const TELEGRAM_HOST = 'telegram-web' as const;
export const TELEGRAM_RELOAD_KEY = 'telegram.waitingReload';
export const telegramMatches = (): string[] => __CG_TEST_HOSTS__ ? [...TELEGRAM_MATCHES, ...TELEGRAM_STAND_MATCHES] : [...TELEGRAM_MATCHES];
export const telegramPermissionSet = () => ({ origins: __CG_TEST_HOSTS__ ? [...TELEGRAM_STAND_MATCHES] : [...TELEGRAM_MATCHES] });
export const telegramScriptSet = () => [{ id: 'telegram', js: ['telegram.js'], world: 'ISOLATED' as const, matches: telegramMatches() }];
