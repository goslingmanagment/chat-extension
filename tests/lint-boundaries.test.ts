// Proves the package graph of architecture.md §4 is enforced: a deliberate
// violation turns ESLint and dependency-cruiser red, a clean file stays green.
// And the graph that keeps the two sites apart (docs/project-unite/architecture.md
// §1.8, R20 F9a): a negative fixture for every kind of Fansly path and for the
// allowed graph of host-kit, host-fansly, fansly-api, the relay frame and the
// sites' background chunks.

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
    ['hub imports ui', 'packages/hub/src/bad.ts', "import { mountOptions } from '@cg/ui/pages';\nexport const x = mountOptions;", ['no-restricted-imports']],
    ['a deep import into src', 'apps/extension/src/composition/bad.ts', "import { x } from '@cg/core/src/domain/index';\nexport const y = x;", ['no-restricted-imports']],
    ['a relative import across packages', 'packages/hub/src/bad.ts', "import { x } from '../../core/src/domain/index';\nexport const y = x;", ['no-restricted-imports']],
    ['the app imports the test harness', 'apps/extension/src/composition/bad.ts', "import { startStandServer } from '@cg/testing';\nexport const x = startStandServer;", ['no-restricted-imports']],
    // the packages of the page and Fansly's API package are wired by the app alone (R20 F9a, architecture §1.8)
    ['core imports Fansly’s adapter', 'packages/core/src/application/bad.ts', "import { startFansly } from '@cg/host-fansly/isolated';\nexport const x = startFansly;", ['no-restricted-imports']],
    ['ui imports Fansly’s API package', 'packages/ui/src/bad.ts', "import { createFanslyApi } from '@cg/fansly-api';\nexport const x = createFanslyApi;", ['no-restricted-imports']],
    ['hub imports the shared mechanics of the page', 'packages/hub/src/bad.ts', "import { guardWith } from '@cg/host-kit/main/guard';\nexport const x = guardWith;", ['no-restricted-imports']],
    ['ui imports the shared mechanics of the page', 'packages/ui/src/bad.ts', "import { OVERLAY_Z } from '@cg/host-kit/isolated/hosts';\nexport const x = OVERLAY_Z;", ['no-restricted-imports']],
    // host-kit (R20 P5, architecture §1.1): what a MAIN bundle carries imports nothing; the isolated half imports
    // contracts and core/domain/text alone; neither knows a site.
    ['the shared MAIN boot imports a package', 'packages/host-kit/src/main/bad.ts', "import { BRIDGE_TAGS } from '@cg/contracts';\nexport const x = BRIDGE_TAGS;", ['no-restricted-imports']],
    ['the shared MAIN boot imports a site’s MAIN code', 'packages/host-kit/src/main/bad.ts', "import { createMainRuntime } from '@cg/host-chatspace/main';\nexport const x = createMainRuntime;", ['no-restricted-imports']],
    ['the shared MAIN boot imports the isolated half next to it', 'packages/host-kit/src/main/bad.ts', "import { TAGS } from '../isolated/wire';\nexport const x = TAGS;", ['no-restricted-imports']],
    ['host-kit/common imports the MAIN boot', 'packages/host-kit/src/common/bad.ts', "import { guardWith } from '../main/guard';\nexport const x = guardWith;", ['no-restricted-imports']],
    ['the shared MAIN boot calls win.fetch', 'packages/host-kit/src/main/bad.ts', "export const x = (win: Window) => win.fetch('/x');", ['no-restricted-properties']],
    ['the shared isolated mechanics import a site’s adapter', 'packages/host-kit/src/isolated/bad.ts', "import { startChatSpaceHost } from '@cg/host-chatspace/isolated';\nexport const x = startChatSpaceHost;", ['no-restricted-imports']],
    ['the shared isolated mechanics import Fansly’s adapter', 'packages/host-kit/src/isolated/bad.ts', "import { startFansly } from '@cg/host-fansly/isolated';\nexport const x = startFansly;", ['no-restricted-imports']],
    ['the shared isolated mechanics import core/domain', 'packages/host-kit/src/isolated/bad.ts', "import { OP_LIMITS } from '@cg/core/domain';\nexport const x = OP_LIMITS;", ['no-restricted-imports']],
    ['the shared isolated mechanics import the MAIN boot', 'packages/host-kit/src/isolated/bad.ts', "import { installMainBridge } from '../main/bridge';\nexport const x = installMainBridge;", ['no-restricted-imports']],
    ['the shared isolated mechanics import platform', 'packages/host-kit/src/isolated/bad.ts', "import { extensionUrl } from '@cg/platform';\nexport const x = extensionUrl;", ['no-restricted-imports']],
    ['the shared isolated mechanics read win.localStorage', 'packages/host-kit/src/isolated/bad.ts', 'export const x = (win: Window) => win.localStorage;', ['no-restricted-properties']],
    ['ChatSpace’s MAIN code imports the isolated half of host-kit', 'packages/host-chatspace/src/main/bad.ts', "import { TAGS } from '@cg/host-kit/isolated/wire';\nexport const x = TAGS;", ['no-restricted-imports']],
    ['contracts imports Fansly’s API package', 'packages/contracts/src/bad.ts', "import { FANSLY_PATHS } from '@cg/fansly-api';\nexport const x = FANSLY_PATHS;", ['no-restricted-imports']],
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
    ['the MAIN entry imports the whole runtime table of the hosts', 'apps/extension/src/entrypoints/chatspace-main.content.ts', "import { CHATSPACE_MATCHES } from '../hosts/runtime';\nexport const x = CHATSPACE_MATCHES;", ['no-restricted-imports']],
    ['the MAIN entry imports the host registry', 'apps/extension/src/entrypoints/chatspace-main.content.ts', "import { HOSTS } from '../hosts';\nexport const x = HOSTS;", ['no-restricted-imports']],
    ['the MAIN entry imports zod', 'apps/extension/src/entrypoints/chatspace-main.content.ts', "import * as z from 'zod/mini';\nexport const x = z;", ['no-restricted-imports']],
    // a site's background chunk reaches the core's owners only through the kit (R20 F1, architecture §3.3)
    ['a site’s background chunk imports hub', 'apps/extension/bg/chatspace.ts', "import { DEFAULT_HUB_ORIGIN } from '@cg/hub';\nexport const x = DEFAULT_HUB_ORIGIN;", ['no-restricted-imports']],
    ['a site’s background chunk imports platform', 'apps/extension/bg/chatspace.ts', "import { createKeyValueStore } from '@cg/platform';\nexport const x = createKeyValueStore;", ['no-restricted-imports']],
    ['a site’s background chunk imports the background root', 'apps/extension/bg/chatspace.ts', "import { composeBackground } from '../src/composition/background';\nexport const x = composeBackground;", ['no-restricted-imports']],
    // browser.* only through @cg/platform (D-01)
    ['an entry point imports wxt/browser', 'apps/extension/src/entrypoints/background.ts', "import { browser } from 'wxt/browser';\nexport const x = browser;", ['no-restricted-imports']],
    // host-chatspace never goes to the network (§4, X3)
    ['the isolated host calls window.fetch', 'packages/host-chatspace/src/isolated/bad.ts', "export const x = () => window.fetch('https://example.invalid/');", ['no-restricted-properties']],
    ['the isolated host calls win.fetch', 'packages/host-chatspace/src/isolated/bad.ts', "export const x = (win: Window) => win.fetch('https://example.invalid/');", ['no-restricted-properties']],
    ['the MAIN bridge calls win.fetch', 'packages/host-chatspace/src/main/bad.ts', "export const x = (win: Window) => win.fetch('/x');", ['no-restricted-properties']],
    ['the MAIN bridge opens a WebSocket', 'packages/host-kit/src/main/bridge.ts', "export const x = () => new WebSocket('wss://x');", ['no-restricted-globals']],
    ['ChatSpace’s runtime opens a WebSocket', 'packages/host-chatspace/src/main/runtime.ts', "export const x = () => new WebSocket('wss://x');", ['no-restricted-globals']],
    ['the MAIN bridge uses navigator.sendBeacon', 'packages/host-chatspace/src/main/bad.ts', "export const x = () => navigator.sendBeacon('/x');", ['no-restricted-properties']],
    // The receipt observer may hold the page's `fetch` property, nothing else of the network, and never the global.
    ['the receipt observer calls the global fetch', 'packages/host-chatspace/src/main/receipt.ts', "export const x = () => fetch('/x');", ['no-restricted-globals']],
    ['the receipt observer opens a WebSocket', 'packages/host-chatspace/src/main/receipt.ts', "export const x = (win: Window & typeof globalThis) => new win.WebSocket('wss://x');", ['no-restricted-properties']],
    ['the send port touches win.fetch', 'packages/host-chatspace/src/main/send-port.ts', 'export const x = (win: Window) => win.fetch;', ['no-restricted-properties']],
  ])('%s → red', async (_label, filePath, code, expected) => {
    expect(await ruleIds(filePath, code)).toEqual(expected);
  });

  it.each([
    ['core/domain imports contracts', 'packages/core/src/domain/ok.ts', "import { CONTRACTS_VERSION } from '@cg/contracts';\nexport const x = CONTRACTS_VERSION;"],
    ['the isolated host imports core/domain/text', 'packages/host-chatspace/src/isolated/ok.ts', "import { normalizeNewlines } from '@cg/core/domain/text';\nexport const x = normalizeNewlines;"],
    // host-kit and the adapter over it (R20 P5)
    ['ChatSpace’s MAIN code imports the shared boot and what both worlds share', 'packages/host-chatspace/src/main/ok.ts', "import { installMainBridge } from '@cg/host-kit/main/bridge';\nimport { digest } from '@cg/host-kit/common/digest';\nexport const x = [installMainBridge, digest];"],
    ['ChatSpace’s adapter imports the shared isolated mechanics', 'packages/host-chatspace/src/isolated/ok.ts', "import { mountClosedHost } from '@cg/host-kit/isolated/hosts';\nexport const x = mountClosedHost;"],
    ['the shared MAIN boot imports its own folder and host-kit/common', 'packages/host-kit/src/main/ok.ts', "import { guardWith } from './guard';\nimport { digest } from '../common/digest';\nexport const x = [guardWith, digest];"],
    ['the shared isolated mechanics import contracts, core/domain/text and host-kit/common', 'packages/host-kit/src/isolated/ok.ts', "import { BRIDGE_LIMITS } from '@cg/contracts/limits';\nimport { normalizeNewlines } from '@cg/core/domain/text';\nimport { digest } from '../common/digest';\nexport const x = [BRIDGE_LIMITS, normalizeNewlines, digest];"],
    ['ui imports preact', 'packages/ui/src/ok.ts', "import { render } from 'preact';\nexport const x = render;"],
    ['platform imports the browser API', 'packages/platform/src/ok.ts', "import { browser } from '@wxt-dev/browser';\nexport const x = browser;"],
    ['the background composition root imports hub', 'apps/extension/src/composition/background.ts', "import { DEFAULT_HUB_ORIGIN } from '@cg/hub';\nexport const x = DEFAULT_HUB_ORIGIN;"],
    ['the background entry imports the background root', 'apps/extension/src/entrypoints/background.ts', "import { composeBackground } from '../composition/background';\nexport const x = composeBackground;"],
    ['a site’s background chunk imports the fan custody and the kit’s types', 'apps/extension/bg/chatspace.ts', "import { SendCoordinator } from '@cg/core/services/custody';\nimport type { BackgroundKit } from '../src/composition/background/host-module';\nexport const x = (kit: BackgroundKit) => [SendCoordinator, kit];"],
    [
      'the MAIN entry imports the bridge, a WXT define helper and ChatSpace’s row of the hosts’ runtime table',
      'apps/extension/src/entrypoints/chatspace-main.content.ts',
      "import { installMainBridge } from '@cg/host-chatspace/main';\nimport type { ContentScriptDefinition } from 'wxt';\nimport { defineContentScript } from 'wxt/utils/define-content-script';\nimport { CHATSPACE_MATCHES } from '../hosts/runtime/chatspace';\nexport const x: ContentScriptDefinition = defineContentScript({ matches: [...CHATSPACE_MATCHES], main: installMainBridge });",
    ],
    ['the WS tap wraps win.WebSocket', 'packages/host-chatspace/src/main/ws-tap.ts', 'export const x = (win: Window & typeof globalThis) => { win.WebSocket = new Proxy(win.WebSocket, {}); };'],
    [
      'the receipt observer puts an observer in place of win.fetch and back',
      'packages/host-chatspace/src/main/receipt.ts',
      'export const x = (win: Window & typeof globalThis) => { const previous = win.fetch; win.fetch = previous; };',
    ],
  ])('%s → green', async (_label, filePath, code) => {
    expect(await ruleIds(filePath, code)).toEqual([]);
  });
});

describe('dependency-cruiser package graph (§4)', () => {
  const load = createRequire(import.meta.url);
  const ruleSet = load('../.dependency-cruiser.cjs') as IConfiguration;
  const sitePaths = load('../tools/gates/site-paths.cjs') as { readonly FANSLY_OWNED: string };

  /**
   * The rules that keep the two sites apart and give the packages of the page, fansly-api and the relay frame their
   * allowed graph (R20 F9a). Each has its negative fixtures below; the rules of §4 keep theirs in the first list.
   */
  const SITE_RULES: ReadonlySet<string> = new Set([
    'background-chunks-apart',
    'fansly-code-only-from-fansly',
    'chatspace-graph-without-fansly',
    'chatspace-code-only-from-chatspace',
    'host-kit-common-dependency-free',
    'host-kit-main-self-contained',
    'host-kit-isolated',
    'host-kit-knows-no-site',
    'host-fansly-main-self-contained',
    'host-fansly-isolated',
    'fansly-api-graph',
    'fansly-api-only-in-its-chunk',
    'fansly-main-entry-self-contained',
    'relay-entry-graph',
  ]);

  /** Every violation in the fixture tree, as `rule: from → to`, sorted. */
  async function fixtureViolations(): Promise<Array<{ readonly rule: string; readonly line: string }>> {
    const baseDir = fileURLToPath(new URL('fixtures/depcruise/', import.meta.url));
    const result = await cruise(['packages', 'apps'], { ...ruleSet.options, baseDir, ruleSet: { forbidden: ruleSet.forbidden ?? [] }, validate: true });
    const output = result.output as ICruiseResult;
    return output.summary.violations
      .map((violation) => ({ rule: violation.rule.name, line: `${violation.rule.name}: ${violation.from} → ${violation.to}` }))
      .sort((a, b) => (a.line < b.line ? -1 : a.line > b.line ? 1 : 0));
  }

  it('reports cycles, relative cross-package imports and forbidden edges in the fixture tree', async () => {
    const violations = (await fixtureViolations()).filter((violation) => !SITE_RULES.has(violation.rule)).map((violation) => violation.line);
    expect(violations).toEqual([
      // R20 F1: a site's chunk reaches the core's owners only through the kit; the core never reaches a chunk or a
      // service only one site needs.
      'background-chunk-boundaries: apps/extension/bg/chatspace.ts → packages/hub/src/index.ts',
      'background-chunk-boundaries: apps/extension/bg/chatspace.ts → packages/platform/src/index.ts',
      'background-chunk-through-the-kit: apps/extension/bg/chatspace.ts → packages/hub/src/index.ts',
      'background-chunk-through-the-kit: apps/extension/bg/chatspace.ts → packages/platform/src/index.ts',
      // …and the same holds below a chunk's imports: fansly-api took the browser API itself, and both chunks that
      // import it reach it.
      'background-chunk-through-the-kit: apps/extension/bg/chatspace/greetings.ts → packages/platform/src/index.ts',
      'background-chunk-through-the-kit: apps/extension/bg/fansly.ts → packages/platform/src/index.ts',
      // The core's graph holds none of Fansly's own code: its tab protocol, its domain folder, its API package.
      'background-core-graph: apps/extension/src/composition/background/permissions.ts → packages/contracts/src/tab-messages-fansly.ts',
      'background-core-graph: apps/extension/src/composition/background/permissions.ts → packages/core/src/domain/hosts/fansly/index.ts',
      'background-core-graph: apps/extension/src/composition/background/permissions.ts → packages/fansly-api/src/index.ts',
      'background-core-graph: apps/extension/src/composition/background/sites.ts → apps/extension/bg/chatspace.ts',
      'background-core-graph: apps/extension/src/composition/background/sites.ts → packages/core/src/services/custody.ts',
      'background-root-only-from-background-entry: apps/extension/lazy/entries/dock.ts → apps/extension/src/composition/background.ts',
      'background-root-only-from-background-entry: apps/extension/src/composition/pages.ts → apps/extension/src/composition/background.ts',
      'core-domain-pure: packages/core/src/domain/index.ts → packages/platform/src/index.ts',
      'host-main-self-contained: packages/host-chatspace/src/main/index.ts → packages/contracts/src/index.ts',
      // The host registry is build data: neither a bundle root nor the runtime table reads it.
      'host-registry-build-only: apps/extension/src/entrypoints/chatspace.content.ts → apps/extension/src/hosts/chatspace.ts',
      'host-registry-build-only: apps/extension/src/hosts/runtime/index.ts → apps/extension/src/hosts/chatspace.ts',
      'hub-only-in-background: apps/extension/bg/chatspace.ts → packages/hub/src/index.ts',
      'hub-only-in-background: apps/extension/src/composition/tab.ts → packages/hub/src/index.ts',
      // Transitive: no single edge is wrong from these bundle roots, the graph below them is.
      'hub-unreachable-outside-background: apps/extension/bg/chatspace.ts → packages/hub/src/index.ts',
      'hub-unreachable-outside-background: apps/extension/lazy/entries/dock.ts → packages/hub/src/index.ts',
      'hub-unreachable-outside-background: apps/extension/src/entrypoints/popup/main.ts → packages/hub/src/index.ts',
      'main-world-entries-self-contained: apps/extension/src/entrypoints/chatspace-main.content.ts → packages/platform/src/index.ts',
      'no-circular: packages/core/src/domain/cycle-a.ts → packages/core/src/domain/cycle-b.ts',
      // Every fixture imports across packages by a relative path (there is no workspace to resolve a name in).
      'no-relative-cross-package: apps/extension/bg/chatspace.ts → packages/hub/src/index.ts',
      'no-relative-cross-package: apps/extension/bg/chatspace.ts → packages/platform/src/index.ts',
      'no-relative-cross-package: apps/extension/bg/chatspace/greetings.ts → packages/fansly-api/src/index.ts',
      'no-relative-cross-package: apps/extension/bg/fansly.ts → packages/contracts/src/tab-messages-fansly.ts',
      'no-relative-cross-package: apps/extension/bg/fansly.ts → packages/fansly-api/src/index.ts',
      'no-relative-cross-package: apps/extension/src/composition/background.ts → packages/hub/src/index.ts',
      'no-relative-cross-package: apps/extension/src/composition/background/permissions.ts → packages/contracts/src/tab-messages-fansly.ts',
      'no-relative-cross-package: apps/extension/src/composition/background/permissions.ts → packages/core/src/domain/hosts/fansly/index.ts',
      'no-relative-cross-package: apps/extension/src/composition/background/permissions.ts → packages/fansly-api/src/index.ts',
      'no-relative-cross-package: apps/extension/src/composition/background/sites.ts → packages/core/src/services/custody.ts',
      // R20 F9b: the pages' root reads both sites' texts — ChatSpace's text pack as Fansly's folder; only the path is wrong.
      'no-relative-cross-package: apps/extension/src/composition/pages.ts → packages/core/src/domain/hosts/chatspace/i18n/index.ts',
      'no-relative-cross-package: apps/extension/src/composition/pages.ts → packages/core/src/domain/hosts/fansly/index.ts',
      'no-relative-cross-package: apps/extension/src/composition/tab.ts → packages/hub/src/index.ts',
      'no-relative-cross-package: apps/extension/src/composition/tab/app.ts → packages/contracts/src/features/fansly.ts',
      'no-relative-cross-package: apps/extension/src/composition/tab/app.ts → packages/host-chatspace/src/isolated/index.ts',
      'no-relative-cross-package: apps/extension/src/composition/tab/app.ts → packages/host-fansly/src/isolated/index.ts',
      'no-relative-cross-package: apps/extension/src/entrypoints/chatspace-main.content.ts → packages/platform/src/index.ts',
      'no-relative-cross-package: apps/extension/src/entrypoints/fansly-main.content.ts → packages/host-fansly/src/main/index.ts',
      'no-relative-cross-package: apps/extension/src/entrypoints/fansly-main.content.ts → packages/platform/src/index.ts',
      'no-relative-cross-package: apps/extension/src/entrypoints/fansly-relay/main.ts → packages/contracts/src/index.ts',
      'no-relative-cross-package: apps/extension/src/entrypoints/fansly-relay/main.ts → packages/fansly-api/src/index.ts',
      'no-relative-cross-package: apps/extension/src/entrypoints/fansly-relay/main.ts → packages/platform/src/index.ts',
      'no-relative-cross-package: packages/core/src/domain/index.ts → packages/platform/src/index.ts',
      'no-relative-cross-package: packages/fansly-api/src/index.ts → packages/platform/src/index.ts',
      'no-relative-cross-package: packages/host-chatspace/src/isolated/index.ts → packages/contracts/src/index.ts',
      // R20 F9b: ChatSpace's profile takes its own text pack's phrases — `host-isolated` lets it through.
      'no-relative-cross-package: packages/host-chatspace/src/isolated/index.ts → packages/core/src/domain/hosts/chatspace/i18n/index.ts',
      // R20 P5: ChatSpace over host-kit — its isolated adapter over the shared mechanics, its MAIN code over the boot;
      // only the relative path is wrong here, `host-isolated` and `host-main-self-contained` let both through.
      'no-relative-cross-package: packages/host-chatspace/src/isolated/index.ts → packages/host-kit/src/common/index.ts',
      'no-relative-cross-package: packages/host-chatspace/src/main/index.ts → packages/contracts/src/index.ts',
      'no-relative-cross-package: packages/host-chatspace/src/main/index.ts → packages/host-kit/src/main/index.ts',
      'no-relative-cross-package: packages/host-fansly/src/isolated/index.ts → packages/host-kit/src/common/index.ts',
      'no-relative-cross-package: packages/host-fansly/src/isolated/index.ts → packages/platform/src/index.ts',
      'no-relative-cross-package: packages/host-fansly/src/main/index.ts → packages/contracts/src/index.ts',
      'no-relative-cross-package: packages/host-fansly/src/main/index.ts → packages/host-kit/src/common/index.ts',
      'no-relative-cross-package: packages/host-kit/src/common/digest.ts → packages/contracts/src/index.ts',
      'no-relative-cross-package: packages/host-kit/src/isolated/index.ts → packages/host-chatspace/src/isolated/index.ts',
      'no-relative-cross-package: packages/host-kit/src/main/index.ts → packages/contracts/src/index.ts',
      'no-relative-cross-package: packages/ui/src/index.ts → packages/host-chatspace/src/main/index.ts',
      'ui-views-only: packages/ui/src/index.ts → packages/host-chatspace/src/main/index.ts',
    ]);
  });

  it('[EX-014] [host:fansly] [host:chatspace] keeps the two sites apart: every kind of Fansly path is red when shared code or ChatSpace imports it, and host-kit, host-fansly, fansly-api, the relay frame and the chunks keep their allowed graph', async () => {
    const violations = (await fixtureViolations()).filter((violation) => SITE_RULES.has(violation.rule)).map((violation) => violation.line);
    expect(violations).toEqual([
      // A site's chunk never imports the other's, either way: ChatSpace's reads Fansly's chunk, Fansly's reads a
      // module of ChatSpace's.
      'background-chunks-apart: apps/extension/bg/chatspace/greetings.ts → apps/extension/bg/fansly.ts',
      'background-chunks-apart: apps/extension/bg/fansly.ts → apps/extension/bg/chatspace/journal.ts',
      // ChatSpace's implementation is imported by ChatSpace's own code alone: not by the shared tab composition, not
      // by host-kit, not by ui.
      'chatspace-code-only-from-chatspace: apps/extension/src/composition/tab/app.ts → packages/host-chatspace/src/isolated/index.ts',
      'chatspace-code-only-from-chatspace: packages/host-kit/src/isolated/index.ts → packages/host-chatspace/src/isolated/index.ts',
      'chatspace-code-only-from-chatspace: packages/ui/src/index.ts → packages/host-chatspace/src/main/index.ts',
      // Transitive, from what ChatSpace's bundles are built of. Its background chunk: `bg/fansly.ts`, the package
      // fansly-api and, below them, a `*-fansly.ts` contract module.
      'chatspace-graph-without-fansly: apps/extension/bg/chatspace/greetings.ts → apps/extension/bg/fansly.ts',
      'chatspace-graph-without-fansly: apps/extension/bg/chatspace/greetings.ts → packages/contracts/src/tab-messages-fansly.ts',
      'chatspace-graph-without-fansly: apps/extension/bg/chatspace/greetings.ts → packages/fansly-api/src/index.ts',
      // A lazy entry of its build: `lazy/fansly/**` by its own import, `features/fansly.ts` and the package
      // host-fansly through the shared tab composition.
      'chatspace-graph-without-fansly: apps/extension/lazy/entries/tab-app.ts → apps/extension/lazy/fansly/notes.ts',
      'chatspace-graph-without-fansly: apps/extension/lazy/entries/tab-app.ts → packages/contracts/src/features/fansly.ts',
      'chatspace-graph-without-fansly: apps/extension/lazy/entries/tab-app.ts → packages/host-fansly/src/isolated/index.ts',
      // fansly-api: its own imports (no browser API), and who imports it — Fansly's chunk alone (`bg/fansly.ts` is
      // not in this list): not ChatSpace's chunk, not the core, not the relay frame.
      'fansly-api-graph: packages/fansly-api/src/index.ts → packages/platform/src/index.ts',
      'fansly-api-only-in-its-chunk: apps/extension/bg/chatspace/greetings.ts → packages/fansly-api/src/index.ts',
      'fansly-api-only-in-its-chunk: apps/extension/src/composition/background/permissions.ts → packages/fansly-api/src/index.ts',
      'fansly-api-only-in-its-chunk: apps/extension/src/entrypoints/fansly-relay/main.ts → packages/fansly-api/src/index.ts',
      // One edge each, by the kind of Fansly path: `bg/fansly.ts` and the package fansly-api (from ChatSpace's
      // chunk), `lazy/fansly/**` (from a lazy entry of ChatSpace's build), `*-fansly.ts`, `**/hosts/fansly/**` and
      // fansly-api again (from the background core), `features/fansly.ts` and the package host-fansly (from the shared
      // tab composition), `**/hosts/fansly/**` (from a shared service of the core). Not in the list, because
      // allowed: the registry's index reading `hosts/fansly.ts`, the pages' root reading `hosts/fansly/`, Fansly's own
      // entry points and chunk.
      'fansly-code-only-from-fansly: apps/extension/bg/chatspace/greetings.ts → apps/extension/bg/fansly.ts',
      'fansly-code-only-from-fansly: apps/extension/bg/chatspace/greetings.ts → packages/fansly-api/src/index.ts',
      'fansly-code-only-from-fansly: apps/extension/lazy/entries/tab-app.ts → apps/extension/lazy/fansly/notes.ts',
      'fansly-code-only-from-fansly: apps/extension/src/composition/background/permissions.ts → packages/contracts/src/tab-messages-fansly.ts',
      'fansly-code-only-from-fansly: apps/extension/src/composition/background/permissions.ts → packages/core/src/domain/hosts/fansly/index.ts',
      'fansly-code-only-from-fansly: apps/extension/src/composition/background/permissions.ts → packages/fansly-api/src/index.ts',
      'fansly-code-only-from-fansly: apps/extension/src/composition/tab/app.ts → packages/contracts/src/features/fansly.ts',
      'fansly-code-only-from-fansly: apps/extension/src/composition/tab/app.ts → packages/host-fansly/src/isolated/index.ts',
      'fansly-code-only-from-fansly: packages/core/src/services/sound.ts → packages/core/src/domain/hosts/fansly/index.ts',
      // Fansly's MAIN entry point and its MAIN package stay self-contained; its isolated adapter has no browser API.
      'fansly-main-entry-self-contained: apps/extension/src/entrypoints/fansly-main.content.ts → packages/platform/src/index.ts',
      'host-fansly-isolated: packages/host-fansly/src/isolated/index.ts → packages/platform/src/index.ts',
      'host-fansly-main-self-contained: packages/host-fansly/src/main/index.ts → packages/contracts/src/index.ts',
      // host-kit: what MAIN carries is dependency-free, and it knows no site.
      'host-kit-common-dependency-free: packages/host-kit/src/common/digest.ts → packages/contracts/src/index.ts',
      'host-kit-isolated: packages/host-kit/src/isolated/index.ts → packages/host-chatspace/src/isolated/index.ts',
      'host-kit-knows-no-site: packages/host-kit/src/isolated/index.ts → packages/host-chatspace/src/isolated/index.ts',
      'host-kit-main-self-contained: packages/host-kit/src/main/index.ts → packages/contracts/src/index.ts',
      // The relay frame passes requests on: fansly-api stays the background's.
      'relay-entry-graph: apps/extension/src/entrypoints/fansly-relay/main.ts → packages/fansly-api/src/index.ts',
    ]);
    // Every site rule has a negative fixture, and each is a rule of the config under its name.
    const names = new Set((ruleSet.forbidden ?? []).map((rule) => rule.name));
    for (const rule of SITE_RULES) {
      expect(names.has(rule), rule).toBe(true);
      expect(violations.some((line) => line.startsWith(`${rule}: `)), rule).toBe(true);
    }
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

  it('[host:fansly] sees Fansly’s own files in the real graph, by the paths the site rules name', async () => {
    // The site rules match resolved paths against one expression (tools/gates/site-paths.cjs). Were it to match
    // nothing in the real tree, every one of them would pass vacuously.
    const owned = new RegExp(sitePaths.FANSLY_OWNED);
    const result = await cruise(['packages/contracts/src', 'packages/core/src/domain/hosts'], { ...ruleSet.options, baseDir: repoRoot });
    const sources = (result.output as ICruiseResult).modules.map((module) => module.source).filter((source) => owned.test(source));
    expect(sources).toEqual(expect.arrayContaining(['packages/contracts/src/tab-messages-fansly.ts', 'packages/contracts/src/errors-fansly.ts', 'packages/core/src/domain/hosts/fansly/i18n/index.ts']));
    // A subpath import of a site module resolves to the file the rules name.
    const catalog = (result.output as ICruiseResult).modules.find((module) => module.source === 'packages/core/src/domain/hosts/fansly/i18n/index.ts');
    expect(catalog?.dependencies.map((dependency) => dependency.resolved)).toContain('packages/contracts/src/errors-fansly.ts');
  });
});
