// Proves the package graph of architecture.md §4 is enforced: a deliberate
// violation turns ESLint and dependency-cruiser red, a clean file stays green.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { cruise, type ICruiseResult, type IConfiguration } from 'dependency-cruiser';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// Type-aware rules need files on disk inside a tsconfig; the boundary rules do
// not, so the fixtures are linted as virtual files with type info switched off.
const eslint = new ESLint({ cwd: repoRoot, overrideConfig: tseslint.configs.disableTypeChecked });

async function ruleIds(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: `${repoRoot}${filePath}` });
  return (result?.messages ?? []).map((message) => message.ruleId ?? `fatal: ${message.message}`).sort();
}

describe('ESLint package graph (§4)', () => {
  it.each([
    ['core imports the browser API', 'packages/core/src/domain/bad.ts', "import { browser } from '@wxt-dev/browser';\nexport const x = browser;", ['no-restricted-imports']],
    ['core imports platform', 'packages/core/src/domain/bad.ts', "import { extensionUrl } from '@cg/platform';\nexport const x = extensionUrl;", ['no-restricted-imports']],
    ['core calls fetch', 'packages/core/src/services/bad.ts', "export const x = () => fetch('/x');", ['no-restricted-globals']],
    ['core touches window.localStorage', 'packages/core/src/application/bad.ts', "export const x = () => window.localStorage;", ['no-restricted-properties']],
    ['ui imports platform', 'packages/ui/src/bad.tsx', "import { createTabRpcClient } from '@cg/platform';\nexport const x = createTabRpcClient;", ['no-restricted-imports']],
    ['core imports the light platform entry', 'packages/core/src/domain/bad.ts', "import { extensionUrl } from '@cg/platform/runtime';\nexport const x = extensionUrl;", ['no-restricted-imports']],
    ['ui opens a WebSocket', 'packages/ui/src/bad.ts', "export const x = () => new WebSocket('wss://x');", ['no-restricted-globals']],
    ['ui uses preact/compat', 'packages/ui/src/bad.ts', "import { forwardRef } from 'preact/compat';\nexport const x = forwardRef;", ['no-restricted-imports']],
    ['the MAIN bridge imports a package', 'packages/host-chatspace/src/main/bad.ts', "import { BRIDGE_TAGS } from '@cg/contracts';\nexport const x = BRIDGE_TAGS;", ['no-restricted-imports']],
    ['the isolated host imports core/domain', 'packages/host-chatspace/src/isolated/bad.ts', "import { OP_LIMITS } from '@cg/core/domain';\nexport const x = OP_LIMITS;", ['no-restricted-imports']],
    ['contracts imports core', 'packages/contracts/src/bad.ts', "import { OP_LIMITS } from '@cg/core/domain';\nexport const x = OP_LIMITS;", ['no-restricted-imports']],
    ['hub imports ui', 'packages/hub/src/bad.ts', "import { mountTempDock } from '@cg/ui';\nexport const x = mountTempDock;", ['no-restricted-imports']],
    ['a deep import into src', 'apps/extension/src/composition/bad.ts', "import { x } from '@cg/core/src/domain/index';\nexport const y = x;", ['no-restricted-imports']],
    ['a relative import across packages', 'packages/hub/src/bad.ts', "import { x } from '../../core/src/domain/index';\nexport const y = x;", ['no-restricted-imports']],
    ['the app imports the test harness', 'apps/extension/src/composition/bad.ts', "import { startStandServer } from '@cg/testing';\nexport const x = startStandServer;", ['no-restricted-imports']],
    // hub only in the background (§4, D-13)
    ['the tab composition root imports hub', 'apps/extension/src/composition/tab.ts', "import { DEFAULT_HUB_ORIGIN } from '@cg/hub';\nexport const x = DEFAULT_HUB_ORIGIN;", ['no-restricted-imports']],
    ['the page composition root imports the SDK', 'apps/extension/src/composition/pages.ts', "import { KERNEL_CONTRACT_HASH } from '@kernel/sdk';\nexport const x = KERNEL_CONTRACT_HASH;", ['no-restricted-imports']],
    ['a lazy chunk re-exports hub', 'apps/extension/lazy/entries/dock.ts', "export * as hubProbe from '@cg/hub';", ['no-restricted-imports']],
    ['the isolated content script imports hub', 'apps/extension/src/entrypoints/chatspace.content.ts', "import { DEFAULT_HUB_ORIGIN } from '@cg/hub';\nexport const x = DEFAULT_HUB_ORIGIN;", ['no-restricted-imports']],
    // …nor through the background composition root, which imports hub
    ['the tab composition root imports the background root', 'apps/extension/src/composition/tab.ts', "import { composeBackground } from './background';\nexport const x = composeBackground;", ['no-restricted-imports']],
    ['a page entry imports the background root', 'apps/extension/src/entrypoints/popup/main.ts', "import { composeBackground } from '../../composition/background';\nexport const x = composeBackground;", ['no-restricted-imports']],
    ['a lazy chunk re-exports the background root', 'apps/extension/lazy/entries/dock.ts', "export { composeBackground } from '../../src/composition/background';", ['no-restricted-imports']],
    ['a content script imports the background entry', 'apps/extension/src/entrypoints/chatspace.content.ts', "import definition from './background';\nexport const x = definition;", ['no-restricted-imports']],
    // MAIN-world entry points are self-contained (§4, D-06)
    ['the MAIN entry imports platform', 'apps/extension/src/entrypoints/chatspace-main.content.ts', "import { extensionUrl } from '@cg/platform';\nexport const x = extensionUrl;", ['no-restricted-imports']],
    ['the WS tap entry imports contracts', 'apps/extension/src/entrypoints/chatspace-ws.ts', "import { BRIDGE_TAGS } from '@cg/contracts';\nexport const x = BRIDGE_TAGS;", ['no-restricted-imports']],
    ['the MAIN entry imports zod', 'apps/extension/src/entrypoints/chatspace-main.content.ts', "import * as z from 'zod/mini';\nexport const x = z;", ['no-restricted-imports']],
    // browser.* only through @cg/platform (D-01)
    ['an entry point imports wxt/browser', 'apps/extension/src/entrypoints/background.ts', "import { browser } from 'wxt/browser';\nexport const x = browser;", ['no-restricted-imports']],
    // host-chatspace never goes to the network (§4, X3)
    ['the isolated host calls window.fetch', 'packages/host-chatspace/src/isolated/bad.ts', "export const x = () => window.fetch('https://example.invalid/');", ['no-restricted-properties']],
    ['the isolated host calls win.fetch', 'packages/host-chatspace/src/isolated/bad.ts', "export const x = (win: Window) => win.fetch('https://example.invalid/');", ['no-restricted-properties']],
    ['the MAIN bridge calls win.fetch', 'packages/host-chatspace/src/main/bad.ts', "export const x = (win: Window) => win.fetch('/x');", ['no-restricted-properties']],
    ['the MAIN bridge opens a WebSocket', 'packages/host-chatspace/src/main/bridge.ts', "export const x = () => new WebSocket('wss://x');", ['no-restricted-globals']],
    ['the MAIN bridge uses navigator.sendBeacon', 'packages/host-chatspace/src/main/bad.ts', "export const x = () => navigator.sendBeacon('/x');", ['no-restricted-properties']],
  ])('%s → red', async (_label, filePath, code, expected) => {
    expect(await ruleIds(filePath, code)).toEqual(expected);
  });

  it.each([
    ['core/domain imports contracts', 'packages/core/src/domain/ok.ts', "import { CONTRACTS_VERSION } from '@cg/contracts';\nexport const x = CONTRACTS_VERSION;"],
    ['the isolated host imports core/domain/text', 'packages/host-chatspace/src/isolated/ok.ts', "import { normalizeNewlines } from '@cg/core/domain/text';\nexport const x = normalizeNewlines;"],
    ['ui imports preact', 'packages/ui/src/ok.ts', "import { render } from 'preact';\nexport const x = render;"],
    ['platform imports the browser API', 'packages/platform/src/ok.ts', "import { browser } from '@wxt-dev/browser';\nexport const x = browser;"],
    ['the background composition root imports hub', 'apps/extension/src/composition/background.ts', "import { DEFAULT_HUB_ORIGIN } from '@cg/hub';\nexport const x = DEFAULT_HUB_ORIGIN;"],
    ['the background entry imports the background root', 'apps/extension/src/entrypoints/background.ts', "import { composeBackground } from '../composition/background';\nexport const x = composeBackground;"],
    [
      'the MAIN entry imports the bridge, a WXT define helper and the hosts list',
      'apps/extension/src/entrypoints/chatspace-main.content.ts',
      "import { installMainBridge } from '@cg/host-chatspace/main';\nimport type { ContentScriptDefinition } from 'wxt';\nimport { defineContentScript } from 'wxt/utils/define-content-script';\nimport { CHATSPACE_MATCHES } from '../hosts';\nexport const x: ContentScriptDefinition = defineContentScript({ matches: [...CHATSPACE_MATCHES], main: installMainBridge });",
    ],
    ['the WS tap wraps win.WebSocket', 'packages/host-chatspace/src/main/ws-tap.ts', 'export const x = (win: Window & typeof globalThis) => { win.WebSocket = new Proxy(win.WebSocket, {}); };'],
  ])('%s → green', async (_label, filePath, code) => {
    expect(await ruleIds(filePath, code)).toEqual([]);
  });
});

describe('dependency-cruiser package graph (§4)', () => {
  const ruleSet = createRequire(import.meta.url)('../.dependency-cruiser.cjs') as IConfiguration;

  it('reports cycles, relative cross-package imports and forbidden edges in the fixture tree', async () => {
    const baseDir = fileURLToPath(new URL('fixtures/depcruise/', import.meta.url));
    const result = await cruise(['packages', 'apps'], { ...ruleSet.options, baseDir, ruleSet: { forbidden: ruleSet.forbidden ?? [] }, validate: true });
    const output = result.output as ICruiseResult;
    const violations = output.summary.violations.map((violation) => `${violation.rule.name}: ${violation.from} → ${violation.to}`).sort();
    expect(violations).toEqual([
      'background-root-only-from-background-entry: apps/extension/lazy/entries/dock.ts → apps/extension/src/composition/background.ts',
      'background-root-only-from-background-entry: apps/extension/src/composition/pages.ts → apps/extension/src/composition/background.ts',
      'core-domain-pure: packages/core/src/domain/index.ts → packages/platform/src/index.ts',
      'host-main-self-contained: packages/host-chatspace/src/main/index.ts → packages/contracts/src/index.ts',
      'hub-only-in-background: apps/extension/src/composition/tab.ts → packages/hub/src/index.ts',
      // Transitive: no single edge is wrong from these bundle roots, the graph below them is.
      'hub-unreachable-outside-background: apps/extension/lazy/entries/dock.ts → packages/hub/src/index.ts',
      'hub-unreachable-outside-background: apps/extension/src/entrypoints/popup/main.ts → packages/hub/src/index.ts',
      'main-world-entries-self-contained: apps/extension/src/entrypoints/chatspace-main.content.ts → packages/platform/src/index.ts',
      'no-circular: packages/core/src/domain/cycle-a.ts → packages/core/src/domain/cycle-b.ts',
      'no-relative-cross-package: apps/extension/src/composition/background.ts → packages/hub/src/index.ts',
      'no-relative-cross-package: apps/extension/src/composition/tab.ts → packages/hub/src/index.ts',
      'no-relative-cross-package: apps/extension/src/entrypoints/chatspace-main.content.ts → packages/platform/src/index.ts',
      'no-relative-cross-package: packages/core/src/domain/index.ts → packages/platform/src/index.ts',
      'no-relative-cross-package: packages/host-chatspace/src/isolated/index.ts → packages/contracts/src/index.ts',
      'no-relative-cross-package: packages/host-chatspace/src/main/index.ts → packages/contracts/src/index.ts',
      'no-relative-cross-package: packages/ui/src/index.ts → packages/host-chatspace/src/main/index.ts',
      'ui-views-only: packages/ui/src/index.ts → packages/host-chatspace/src/main/index.ts',
    ]);
  });

  it('sees the vendored packages in the real graph', async () => {
    // They resolve to their `types` entry (dist/index.d.ts); were those files
    // excluded with our own .d.ts, every rule about the SDK and the hotkey
    // engine — `sdk-only-in-hub`, `hub-unreachable-outside-background` — would pass vacuously.
    const result = await cruise(['packages/hub/src', 'packages/core/src/domain'], { ...ruleSet.options, baseDir: repoRoot });
    const modules = (result.output as ICruiseResult).modules;
    const resolved = (source: string): string[] =>
      modules.find((module) => module.source === source)?.dependencies.map((dependency) => dependency.resolved) ?? [];
    expect(resolved('packages/hub/src/index.ts')).toContain('vendor/kernel-sdk/dist/index.d.ts');
    expect(resolved('packages/core/src/domain/index.ts')).toContain('vendor/chatgoose-hotkeys/dist/index.d.ts');
  });
});
