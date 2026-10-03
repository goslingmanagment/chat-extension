// dependency-cruiser: the package graph of architecture.md §4 on RESOLVED paths
// (workspace symlinks resolve to packages/<name>/src/...), plus cycles and
// cross-package relative imports. ESLint checks the same graph on import
// specifiers; tests/lint-boundaries.test.ts proves both go red.

/** A path inside a workspace package / app / vendored package. */
const pkg = (name) => `^packages/${name}/`;
/** A path inside an npm dependency; matches both the pnpm store layout and a hoisted one. */
const npm = (name) => `(^|/)node_modules/${name}/`;

const ZOD = npm('zod');
const PREACT = [npm('preact'), npm('@preact/signals'), npm('@preact/signals-core')];
const HOTKEYS = '^vendor/chatgoose-hotkeys/';
const SDK = '^vendor/kernel-sdk/';
const WXT_BROWSER = npm('@wxt-dev/browser');

/** `from` may depend only on paths matching `allowed` (plus itself). */
function only(name, from, allowed, comment) {
  return {
    name,
    comment,
    severity: 'error',
    from: { path: from },
    to: { pathNot: [from, ...allowed] },
  };
}

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'Cycles are forbidden (§4 «Проверка циклов обязательна»).',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-relative-cross-package',
      comment: 'Import another package by name through its `exports`, never by a relative path (§4).',
      severity: 'error',
      from: { path: '^(packages|apps|vendor)/([^/]+)/' },
      to: { path: '^(packages|apps|vendor)/', pathNot: '^$1/$2/', dependencyTypes: ['local'] },
    },
    {
      name: 'no-unresolvable',
      comment: 'Every import must resolve (a deep import past `exports` does not).',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    only('contracts-only-zod', pkg('contracts'), [ZOD], '`contracts` imports only zod (§4).'),
    only(
      'core-domain-pure',
      pkg('core/src/domain'),
      [pkg('contracts'), HOTKEYS],
      '`core/domain`: contracts and the vendored hotkey engine only (§4).',
    ),
    only(
      'core-services',
      pkg('core/src/services'),
      [pkg('core/src/domain'), pkg('contracts'), HOTKEYS],
      '`core/services`: contracts and core/domain only (§4).',
    ),
    only(
      'core-application',
      pkg('core/src/application'),
      [pkg('core/src/domain'), pkg('contracts'), HOTKEYS],
      '`core/application`: contracts and core/domain only (§4).',
    ),
    only('platform-only-contracts', pkg('platform'), [pkg('contracts'), WXT_BROWSER, ZOD], '`platform`: contracts + browser API (§4).'),
    only(
      'hub-background-only',
      pkg('hub'),
      [pkg('contracts'), pkg('core'), pkg('platform'), SDK, ZOD, HOTKEYS],
      '`hub`: contracts, core, platform, the vendored SDK (§4).',
    ),
    only(
      'host-main-self-contained',
      pkg('host-chatspace/src/main'),
      [],
      'The MAIN bridge is a self-contained, dependency-free bundle (§4).',
    ),
    only(
      'host-isolated',
      pkg('host-chatspace/src/isolated'),
      [pkg('contracts'), pkg('core/src/domain/text'), ZOD],
      '`host-chatspace/isolated`: contracts and core/domain/text only (§4).',
    ),
    only('ui-views-only', pkg('ui'), [pkg('contracts'), ZOD, ...PREACT], '`ui`: contracts, ui/kit and Preact only (§4).'),
    {
      name: 'hub-only-in-background',
      comment: '`hub` (and with it the SDK and the token) is used only by the background composition (§4, D-13).',
      severity: 'error',
      from: { pathNot: [pkg('hub'), pkg('testing'), '^apps/extension/src/(entrypoints|composition)/background\\.ts$'] },
      to: { path: pkg('hub') },
    },
    {
      name: 'main-world-entries-self-contained',
      comment: 'The MAIN-world entry points bundle only host-chatspace/main, the WXT define helpers and the hosts list (§4, D-06).',
      severity: 'error',
      from: { path: '^apps/extension/src/entrypoints/chatspace-(main\\.content|ws)\\.ts$' },
      to: { pathNot: [pkg('host-chatspace/src/main'), '^apps/extension/src/hosts\\.ts$', npm('wxt')] },
    },
    {
      name: 'sdk-only-in-hub',
      comment: 'The SDK, the token and the network stay in the background (§4, D-13).',
      severity: 'error',
      from: { pathNot: [pkg('hub'), SDK] },
      to: { path: SDK },
    },
    {
      name: 'testing-never-ships',
      comment: 'Nothing that ships may import the test harness.',
      severity: 'error',
      from: { pathNot: pkg('testing') },
      to: { path: pkg('testing') },
    },
    {
      name: 'nothing-imports-the-app',
      comment: 'Packages never import apps/extension (composition roots are the top).',
      severity: 'error',
      from: { pathNot: '^apps/extension/' },
      to: { path: '^apps/extension/' },
    },
    {
      name: 'no-preact-compat',
      comment: 'Preact without preact/compat (D-05).',
      severity: 'error',
      from: {},
      to: { path: `${npm('preact')}compat/` },
    },
  ],
  options: {
    doNotFollow: { path: ['node_modules', '^vendor/'] },
    exclude: { path: ['\\.test\\.tsx?$', '\\.d\\.ts$', '(^|/)\\.tsbuild/', '(^|/)\\.output/', '(^|/)\\.wxt/', '^packages/testing/(e2e|stand)/'] },
    tsPreCompilationDeps: true,
    combinedDependencies: false,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'types', 'default'],
      mainFields: ['module', 'main', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.d.ts'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
