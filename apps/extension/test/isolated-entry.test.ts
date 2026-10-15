// A site's isolated script starts without WXT's wrapper and its ContentScriptContext (build/isolated-entry.ts, §11):
// the plugin answers exactly that entry's virtual module — ChatSpace's content script, Fansly's unlisted script the
// background registers — with a bare call of main().

import { describe, expect, it } from 'vitest';

import { isolatedEntryPlugin } from '../build/isolated-entry.ts';

const ISOLATED = '/repo/apps/extension/src/entrypoints/chatspace.content.ts';
/** Fansly's isolated script: registered by the background, so an unlisted script of WXT's (R20 P7a0). */
const REGISTERED = '/repo/apps/extension/src/entrypoints/fansly.ts';
const load = (plugin: ReturnType<typeof isolatedEntryPlugin>, id: string): unknown => (plugin.load as (id: string) => unknown)(id);

describe('§11 the isolated entry without WXT’s context', () => {
  it('answers the virtual entry of the isolated content script with a bare call of main(), before WXT', () => {
    const plugin = isolatedEntryPlugin(ISOLATED);
    expect(plugin.enforce).toBe('pre');
    expect(load(plugin, `\0virtual:wxt-content-script-isolated-world-entrypoint?${ISOLATED}`)).toBe(`import definition from ${JSON.stringify(ISOLATED)};\ndefinition.main();\n`);
  });

  it('answers the virtual entry of a registered isolated script (an unlisted script of WXT’s) the same way', () => {
    const plugin = isolatedEntryPlugin(REGISTERED);
    expect(load(plugin, `\0virtual:wxt-unlisted-script-entrypoint?${REGISTERED}`)).toBe(`import definition from ${JSON.stringify(REGISTERED)};\ndefinition.main();\n`);
    expect(load(plugin, '\0virtual:wxt-unlisted-script-entrypoint?/repo/apps/extension/src/entrypoints/fansly-main.ts')).toBeNull();
  });

  it('leaves every other module to WXT: another isolated script, the MAIN-world ones, the background, a real file', () => {
    const plugin = isolatedEntryPlugin(ISOLATED);
    expect(load(plugin, '\0virtual:wxt-content-script-isolated-world-entrypoint?/repo/apps/extension/src/entrypoints/other.content.ts')).toBeNull();
    expect(load(plugin, `\0virtual:wxt-content-script-main-world-entrypoint?${ISOLATED}`)).toBeNull();
    expect(load(plugin, '\0virtual:wxt-background-entrypoint?/repo/apps/extension/src/entrypoints/background.ts')).toBeNull();
    expect(load(plugin, ISOLATED)).toBeNull();
  });
});
