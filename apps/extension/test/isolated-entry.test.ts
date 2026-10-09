// The isolated ChatSpace content script starts without WXT's wrapper and its ContentScriptContext
// (build/isolated-entry.ts, §11): the plugin answers exactly that entry's virtual module with a bare call of main().

import { describe, expect, it } from 'vitest';

import { isolatedEntryPlugin } from '../build/isolated-entry.ts';

const ISOLATED = '/repo/apps/extension/src/entrypoints/chatspace.content.ts';
const load = (plugin: ReturnType<typeof isolatedEntryPlugin>, id: string): unknown => (plugin.load as (id: string) => unknown)(id);

describe('§11 the isolated entry without WXT’s context', () => {
  it('answers the virtual entry of the isolated content script with a bare call of main(), before WXT', () => {
    const plugin = isolatedEntryPlugin(ISOLATED);
    expect(plugin.enforce).toBe('pre');
    expect(load(plugin, `\0virtual:wxt-content-script-isolated-world-entrypoint?${ISOLATED}`)).toBe(`import definition from ${JSON.stringify(ISOLATED)};\ndefinition.main();\n`);
  });

  it('leaves every other module to WXT: another isolated script, the MAIN-world ones, the background, a real file', () => {
    const plugin = isolatedEntryPlugin(ISOLATED);
    expect(load(plugin, '\0virtual:wxt-content-script-isolated-world-entrypoint?/repo/apps/extension/src/entrypoints/other.content.ts')).toBeNull();
    expect(load(plugin, `\0virtual:wxt-content-script-main-world-entrypoint?${ISOLATED}`)).toBeNull();
    expect(load(plugin, '\0virtual:wxt-background-entrypoint?/repo/apps/extension/src/entrypoints/background.ts')).toBeNull();
    expect(load(plugin, ISOLATED)).toBeNull();
  });
});
