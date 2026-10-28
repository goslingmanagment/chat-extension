// An optional site of the TEST build switched on for its stand, as far as a stand goes (R20 P7a0 for Fansly, Telegram
// spec §6.3 for Telegram): neither flavor declares an optional site's scripts in its manifest — Firefox grants every
// match of a manifest content script at install, and those sites are optional, granted on request only. The test
// grants the site's optional origins (and the API permissions its switch asks along) through Firefox's own permission
// store, as the add-on manager's switch does (support/permissions.ts); the background then registers the site's
// scripts itself — its registration, persistence and ordering are the production code's. The helper waits for that.

import { browser } from '@wdio/globals';

import { testBuildPage } from './fake-hub';
import { grantOptional } from './permissions';

export interface RegisteredScript {
  readonly id: string;
  readonly matches: string[];
  readonly world: string | null;
  readonly runAt: string | null;
  readonly js: string[];
}

interface ScriptingApi {
  getRegisteredContentScripts(): Promise<Array<{ id: string; matches?: string[]; world?: string; runAt?: string; js?: string[] }>>;
}

/** The content scripts registered now, from the extension page the browser is on. */
export async function registeredScripts(): Promise<RegisteredScript[]> {
  return browser.execute(async () => {
    const api = (globalThis as unknown as { browser: { scripting: ScriptingApi } }).browser;
    return (await api.scripting.getRegisteredContentScripts()).map((script) => ({ id: script.id, matches: [...(script.matches ?? [])], world: script.world ?? null, runAt: script.runAt ?? null, js: [...(script.js ?? [])] }));
  });
}

/** What switching an optional site on means on its stand. */
export interface OptionalStandSite {
  /** How a person names it (the wait's message). */
  readonly title: string;
  /** The stand's match patterns of the test build's optional permission (a pattern has no port). */
  readonly origins: readonly string[];
  /** API permissions the site's switch asks along. */
  readonly permissions: readonly string[];
  /** The registered script that says the background switched the site on. */
  readonly registered: (script: RegisteredScript) => boolean;
}

/** The Fansly stand's match pattern (apps/extension/src/hosts/runtime/index.ts FANSLY_STAND_MATCHES). */
export const FANSLY_STAND_PATTERN = 'http://localhost/*';
/** The Telegram stand's match pattern (apps/extension/src/hosts/runtime/index.ts TELEGRAM_STAND_MATCHES). */
export const TELEGRAM_STAND_PATTERN = 'http://telegram.localhost/*';

export const OPTIONAL_STAND_SITES = {
  /** «Включить Fansly»: the stand's origin and webRequest; the background registers `fansly-main` and `fansly`. */
  fansly: { title: 'Fansly', origins: [FANSLY_STAND_PATTERN], permissions: ['webRequest'], registered: (script) => script.id === 'fansly' },
  /** «Включить Telegram»: the stand's origin alone; the background registers Telegram's one isolated script. */
  telegram: { title: 'Telegram', origins: [TELEGRAM_STAND_PATTERN], permissions: [], registered: (script) => script.matches.includes(TELEGRAM_STAND_PATTERN) },
} as const satisfies Readonly<Record<string, OptionalStandSite>>;

/** The person switched the site on, as far as its stand goes: its origins (and permissions) granted, its scripts registered. */
export async function switchSiteOnForTheStand(site: OptionalStandSite): Promise<void> {
  await grantOptional({ origins: site.origins, permissions: site.permissions });
  await browser.url(testBuildPage());
  await browser.waitUntil(async () => (await registeredScripts()).some(site.registered), { timeout: 15_000, timeoutMsg: `background registers ${site.title} after the grant` });
}
