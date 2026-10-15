// Optional-site configuration for the core's permission and observation services.
// The core takes these inert data/functions; no site's chunk is imported here.
import { FANSLY_API_MATCHES, FANSLY_MATCHES } from '../hosts/runtime/fansly';
import { FANSLY_STAND_MATCHES } from '../hosts/runtime';

export const OPTIONAL_HOST = 'fansly-web' as const;
export const SESSION_KEY = 'fansly.session';
export const RELOAD_KEY = 'fansly.waitingReload';
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
