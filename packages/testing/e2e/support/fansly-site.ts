// The Fansly site of the TEST build on its stand (R20 P7a0; docs/project-unite/
// architecture.md §4). Neither flavor declares Fansly's scripts in its
// manifest: Firefox grants every match of a manifest content script at install,
// and the stand — like fansly.com — is optional, granted on request only
// (R20 P6a). Its two scripts are registered as the background will register
// them after «Включить Fansly» (P9a): one call, MAIN first, at
// document_start, top frame only. Until P9a the e2e makes that call itself,
// from a page of the extension, and grants the stand's origins and webRequest
// as the add-on manager's switch does (support/permissions.ts). A registration
// without the grant passes but reaches no document (spike P3a §2).

import { browser } from '@wdio/globals';

import { testBuildPage } from './fake-hub';
import { grantOptional } from './permissions';

/** The Fansly stand's match pattern (apps/extension/src/hosts/runtime/index.ts FANSLY_STAND_MATCHES): a pattern has no port. */
export const FANSLY_STAND_PATTERN = 'http://localhost/*';

/** Fansly's scripts as the registry declares them (apps/extension/src/hosts/fansly.ts), in the order they register: MAIN first. */
export const FANSLY_SCRIPTS = [
  { id: 'fansly-main', js: ['fansly-main.js'], world: 'MAIN' },
  { id: 'fansly', js: ['fansly.js'], world: 'ISOLATED' },
] as const;

interface ScriptingApi {
  registerContentScripts(scripts: unknown[]): Promise<void>;
  getRegisteredContentScripts(): Promise<Array<{ id: string; matches?: string[]; world?: string; runAt?: string; js?: string[] }>>;
}

/** Registers Fansly's two scripts on the stand in one call, from the extension page the browser is put on. */
export async function registerFanslyScripts(matches: readonly string[] = [FANSLY_STAND_PATTERN]): Promise<void> {
  await browser.url(testBuildPage());
  await browser.execute(
    async (scripts: ReadonlyArray<{ id: string; js: readonly string[]; world: string }>, patterns: string[]) => {
      const api = (globalThis as unknown as { browser: { scripting: ScriptingApi } }).browser;
      await api.scripting.registerContentScripts(
        scripts.map((script) => ({ id: script.id, js: [...script.js], world: script.world, matches: patterns, runAt: 'document_start', allFrames: false, persistAcrossSessions: false })),
      );
    },
    FANSLY_SCRIPTS,
    [...matches],
  );
}

/** The content scripts registered now, from the extension page the browser is on. */
export async function registeredScripts(): Promise<Array<{ id: string; matches: string[]; world: string | null; runAt: string | null; js: string[] }>> {
  return browser.execute(async () => {
    const api = (globalThis as unknown as { browser: { scripting: ScriptingApi } }).browser;
    return (await api.scripting.getRegisteredContentScripts()).map((script) => ({ id: script.id, matches: [...(script.matches ?? [])], world: script.world ?? null, runAt: script.runAt ?? null, js: [...(script.js ?? [])] }));
  });
}

/** The person switched Fansly on, as far as the stand goes: its origins and webRequest granted, its scripts registered. */
export async function switchFanslyOnForTheStand(): Promise<void> {
  await grantOptional({ origins: [FANSLY_STAND_PATTERN], permissions: ['webRequest'] });
  await registerFanslyScripts();
}
