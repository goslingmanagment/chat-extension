// The MAIN-world scripts start without WXT's entry wrapper (build/main-world-entry.ts, decision X22): the plugin
// answers exactly their virtual entry modules, and only a TEST build's bridge gets the e2e's throwing probe.

import { describe, expect, it } from 'vitest';

import { MAIN_THROW_PROBE_EVENT, mainWorldEntryPlugin } from '../build/main-world-entry.ts';

const MAIN = '/repo/apps/extension/src/entrypoints/chatspace-main.content.ts';
const WS = '/repo/apps/extension/src/entrypoints/chatspace-ws.ts';
const load = (plugin: ReturnType<typeof mainWorldEntryPlugin>, id: string): unknown => (plugin.load as (id: string) => unknown)(id);

describe('[X22] the MAIN-world entry without WXT’s wrapper', () => {
  it('answers the virtual entry of a MAIN content script and of the unlisted tap script with a bare call of main()', () => {
    const plugin = mainWorldEntryPlugin([MAIN, WS]);
    expect(plugin.enforce).toBe('pre');
    expect(load(plugin, `\0virtual:wxt-content-script-main-world-entrypoint?${MAIN}`)).toBe(`import definition from ${JSON.stringify(MAIN)};\ndefinition.main();\n`);
    expect(load(plugin, `\0virtual:wxt-unlisted-script-entrypoint?${WS}`)).toBe(`import definition from ${JSON.stringify(WS)};\ndefinition.main();\n`);
  });

  it('leaves every other module to WXT: the isolated content script, the background, a real file', () => {
    const plugin = mainWorldEntryPlugin([MAIN, WS]);
    expect(load(plugin, '\0virtual:wxt-content-script-isolated-world-entrypoint?/repo/apps/extension/src/entrypoints/chatspace.content.ts')).toBeNull();
    expect(load(plugin, '\0virtual:wxt-background-entrypoint?/repo/apps/extension/src/entrypoints/background.ts')).toBeNull();
    expect(load(plugin, '\0virtual:wxt-unlisted-script-entrypoint?/repo/other.ts')).toBeNull();
    expect(load(plugin, MAIN)).toBeNull();
  });

  it('only the probe entry of a TEST build gets the throwing listener, and only on loopback', () => {
    const plugin = mainWorldEntryPlugin([MAIN, WS], { probe: MAIN });
    const bridge = String(load(plugin, `\0virtual:wxt-content-script-main-world-entrypoint?${MAIN}`));
    expect(bridge).toContain(MAIN_THROW_PROBE_EVENT);
    expect(bridge).toMatch(/127\\\.0\\\.0\\\.1\|localhost/);
    expect(String(load(plugin, `\0virtual:wxt-unlisted-script-entrypoint?${WS}`))).not.toContain(MAIN_THROW_PROBE_EVENT);
    expect(String(load(mainWorldEntryPlugin([MAIN, WS]), `\0virtual:wxt-content-script-main-world-entrypoint?${MAIN}`))).not.toContain(MAIN_THROW_PROBE_EVENT);
  });
});
