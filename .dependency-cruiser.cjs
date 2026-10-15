// dependency-cruiser: the package graph of architecture.md §4 on RESOLVED paths
// (workspace symlinks resolve to packages/<name>/src/...), plus cycles,
// cross-package relative imports and what each bundle root can reach (`hub`
// and the SDK only from the background). ESLint checks single import
// specifiers; tests/lint-boundaries.test.ts proves both go red.
//
// The two sites (docs/project-unite/architecture.md §1.8, R20 F9a): whose file
// is whose comes from tools/gates/site-paths.cjs, the table the gates read too.
// Shared code never imports a site's own code, a ChatSpace bundle and the
// background core never reach Fansly's, and the packages of the page
// (host-kit, host-chatspace, host-fansly), fansly-api, the relay frame and the
// sites' background chunks each have their allowed graph written here.

const { FANSLY_OWNED } = require('./tools/gates/site-paths.cjs');

/** A path inside a workspace package / app / vendored package. */
const pkg = (name) => `^packages/${name}/`;
/** A path inside an npm dependency; matches both the pnpm store layout and a hoisted one. */
const npm = (name) => `(^|/)node_modules/${name}/`;

const ZOD = npm('zod');
const PREACT = [npm('preact'), npm('@preact/signals'), npm('@preact/signals-core')];
const HOTKEYS = '^vendor/chatgoose-hotkeys/';
const SDK = '^vendor/kernel-sdk/';
const WXT_BROWSER = npm('@wxt-dev/browser');

/** The host registry's entries and index: build data (docs/project-unite/architecture.md §1.2). Its runtime table is hosts/runtime/. */
const HOST_REGISTRY = '^apps/extension/src/hosts/[^/]+\\.ts$';
/** The registry's index: the one module that reads every site's entry. */
const HOST_REGISTRY_INDEX = '^apps/extension/src/hosts/index\\.ts$';
/** The extension pages' composition root and its own modules: the pages carry the texts and the errors of both sites (architecture.md §3.4, §1.6). */
const PAGES_ROOT = '^apps/extension/src/composition/pages(\\.ts$|/)';
/** ChatSpace's implementation: its page package and its folders in the shared packages and the composition. */
const CHATSPACE_HOST_CODE = [pkg('host-chatspace'), '(^|/)hosts/chatspace/'];
/** host-kit as a MAIN bundle may carry it: the MAIN boot and what both worlds share — dependency-free (`host-kit-*` rules). */
const HOST_KIT_MAIN = pkg('host-kit/src/(main|common)');
/** host-kit as an isolated adapter uses it. */
const HOST_KIT_ISOLATED = pkg('host-kit/src/(isolated|common)');
/** What never ships: the test harness and the packages' own test folders (fixtures, test worlds). They may import any site. */
const TEST_CODE = [pkg('testing'), '^packages/[^/]+/test/'];
/** Fansly's background chunk: `bg/fansly.ts` and its own folder. */
const FANSLY_CHUNK = '^apps/extension/bg/fansly(/|\\.ts$)';
/** The relay frame (architecture.md §8.5): an extension page inside a Fansly tab, up only for «Fansly через вкладку». */
const RELAY_ENTRY = '^apps/extension/src/entrypoints/fansly-relay/';
/**
 * What ChatSpace's bundles are built from: its entry points, the lazy entries of its build and its background chunk.
 * (The background core has its own rule, `background-core-graph`.)
 */
const CHATSPACE_BUNDLE_ROOTS = ['^apps/extension/src/entrypoints/chatspace', '^apps/extension/lazy/entries/', '^apps/extension/bg/chatspace(/|\\.ts$)'];

/** The background entry point and its composition root: the only modules that may import `hub` (§4, D-13). */
const BACKGROUND_ENTRY = '^apps/extension/src/entrypoints/background\\.ts$';
const BACKGROUND_ROOTS = '^apps/extension/src/(entrypoints|composition)/background\\.ts$';
/** The background core: its entry point, its composition root and the root's own modules (docs/project-unite/architecture.md §3.3). */
const BACKGROUND_CORE = '^apps/extension/src/(entrypoints/background\\.ts$|composition/background(\\.ts$|/))';
/** The sites' background chunks: `bg/<site>.ts` and their own folders (bg/vite.config.ts is build code, not cruised). */
const BACKGROUND_CHUNKS = { path: '^apps/extension/bg/' };
/** The contract a chunk is started with: types only (composition/background/host-module.ts). */
const BACKGROUND_KIT = '^apps/extension/src/composition/background/host-module\\.ts$';
/**
 * What only one site's background needs: never in the core's graph. Any site's chunk; ChatSpace's fan custody (the X8
 * coordinator, its journal and fuse, the greeting leases — core/services/custody); Fansly's own code (its host
 * folders, its API package, its tab protocol and schemas, its slice of the feature manifest — every file named by
 * Fansly, tools/gates/site-paths.cjs).
 */
const SITE_ONLY_BACKGROUND = [
  '^apps/extension/bg/',
  '^packages/core/src/services/(custody|send-coordinator|send-journal|send-fuse|greeting-leases)\\.ts$',
  FANSLY_OWNED,
];
/**
 * Every other bundle root: the content scripts, the WS tap, Fansly's scripts the
 * background registers, the extension pages and the lazy chunks of both sites.
 * Everything under entrypoints/ counts, so a new entry point is covered before
 * anyone remembers to list it.
 */
const NON_BACKGROUND_ENTRIES = { path: ['^apps/extension/src/entrypoints/', '^apps/extension/lazy/entries/', '^apps/extension/lazy/fansly/', '^apps/extension/bg/'], pathNot: BACKGROUND_ENTRY };

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
      [HOST_KIT_MAIN],
      'The MAIN bridge is a self-contained bundle: its own folder and the shared page mechanics of host-kit (the boot, `guard`), which are dependency-free themselves (§4; docs/project-unite/architecture.md §1.1).',
    ),
    only(
      'host-isolated',
      pkg('host-chatspace/src/isolated'),
      [HOST_KIT_ISOLATED, pkg('contracts'), pkg('core/src/domain/text'), pkg('core/src/domain/hosts/chatspace/i18n'), ZOD],
      '`host-chatspace/isolated`: host-kit, contracts, core/domain/text and ChatSpace\'s own text pack (its phrases for the profile, R20 F9b) only (§4).',
    ),
    // ── The packages of the page for two sites (docs/project-unite/architecture.md §1.1, §1.8) ──
    only(
      'host-kit-common-dependency-free',
      pkg('host-kit/src/common'),
      [],
      '`host-kit/common` is what both worlds of the page share: the MAIN bundles carry it, so it imports nothing (architecture.md §1.1).',
    ),
    only(
      'host-kit-main-self-contained',
      pkg('host-kit/src/main'),
      [pkg('host-kit/src/common')],
      '`host-kit/main` — the MAIN boot, the bridge and `guard` of every site — is self-contained: no contracts, no zod, no extension API, no site (architecture.md §1.1, §5.1).',
    ),
    only(
      'host-kit-isolated',
      pkg('host-kit/src/isolated'),
      [pkg('host-kit/src/common'), pkg('contracts'), pkg('core/src/domain/text'), ZOD],
      '`host-kit/isolated`: contracts and core/domain/text only, as the ChatSpace adapter it was moved out of; it knows no site (architecture.md §1.1).',
    ),
    {
      name: 'host-kit-knows-no-site',
      comment: 'host-kit is the shared mechanics of the page: it never imports a site\'s package, a site\'s folder or a site\'s contract modules, and nothing but contracts, core/domain/text and zod (docs/project-unite/architecture.md §1.1, §1.8).',
      severity: 'error',
      from: { path: pkg('host-kit') },
      to: { pathNot: [pkg('host-kit'), pkg('contracts'), pkg('core/src/domain/text'), ZOD] },
    },
    only(
      'host-fansly-main-self-contained',
      pkg('host-fansly/src/main'),
      [HOST_KIT_MAIN],
      'Fansly\'s MAIN script is one self-contained bundle: its own folder and host-kit\'s MAIN boot — no contracts, no zod, no extension API (docs/project-unite/architecture.md §5, §3.1).',
    ),
    only(
      'host-fansly-isolated',
      pkg('host-fansly/src/isolated'),
      [HOST_KIT_ISOLATED, pkg('contracts'), pkg('core/src/domain/text'), pkg('core/src/domain/hosts/fansly/i18n'), ZOD],
      '`host-fansly/isolated`: host-kit, contracts, core/domain/text and Fansly\'s own text pack (its phrases for the profile, R20 F9b) only — no token, no network, no MAIN code (docs/project-unite/architecture.md §7).',
    ),
    only(
      'fansly-api-graph',
      pkg('fansly-api'),
      [pkg('contracts'), pkg('core/src/domain'), ZOD],
      '`fansly-api` — the only code that requests Fansly — imports contracts, core/domain and zod: no hub, no SDK, no browser API (it runs in Fansly\'s background chunk, behind the core\'s kit), no UI (docs/project-unite/architecture.md §8.1, §8.3).',
    ),
    only('ui-views-only', pkg('ui'), [pkg('contracts'), ZOD, ...PREACT], '`ui`: contracts, ui/kit and Preact only (§4).'),
    {
      name: 'hub-only-in-background',
      comment: '`hub` (and with it the SDK and the token) is used only by the background composition (§4, D-13).',
      severity: 'error',
      from: { pathNot: [pkg('hub'), pkg('testing'), BACKGROUND_ROOTS] },
      to: { path: pkg('hub') },
    },
    {
      name: 'background-root-only-from-background-entry',
      comment:
        'The background composition root imports `hub`; any other importer would carry the hub, the SDK and the token into its bundle. Only the background entry point imports it, and nothing imports that entry point (§4, D-13).',
      severity: 'error',
      from: { pathNot: BACKGROUND_ENTRY },
      to: { path: BACKGROUND_ROOTS },
    },
    {
      name: 'hub-unreachable-outside-background',
      comment:
        'No content script, WS tap, extension page or lazy chunk may reach `hub` or the vendored SDK, however indirectly: the import rules above check single edges, this one the whole graph below each bundle root (§4, D-13).',
      severity: 'error',
      from: NON_BACKGROUND_ENTRIES,
      to: { path: [pkg('hub'), SDK], reachable: true },
    },
    {
      name: 'background-core-graph',
      comment:
        'The background core never reaches what only one site needs: a site\'s chunk, ChatSpace\'s fan custody (core/services/custody), Fansly\'s own code. Those run in the site\'s chunk bg/<site>.js, loaded by import(runtime.getURL(…)) — no static edge (docs/project-unite/architecture.md §3.3, §1.8).',
      severity: 'error',
      from: { path: BACKGROUND_CORE },
      to: { path: SITE_ONLY_BACKGROUND, reachable: true },
    },
    {
      name: 'background-chunk-boundaries',
      comment:
        'A site\'s background chunk imports contracts, core (domain and services), zod, the hotkey engine and the kit\'s types — the core\'s ports come through the kit, so the chunk makes no second owner of the hub, the settings, telemetry or the journals (docs/project-unite/architecture.md §3.3).',
      severity: 'error',
      from: BACKGROUND_CHUNKS,
      to: { pathNot: ['^apps/extension/bg/', pkg('contracts'), pkg('core/src/domain'), pkg('core/src/services'), pkg('fansly-api'), ZOD, HOTKEYS, BACKGROUND_KIT] },
    },
    {
      name: 'background-chunks-apart',
      comment:
        'A site\'s background chunk never imports another site\'s: `bg/<site>.ts` and its folder `bg/<site>/` are one chunk, built and loaded by itself (docs/project-unite/architecture.md §3.3, §1.8).',
      severity: 'error',
      from: { path: '^apps/extension/bg/([^/.]+)(/|\\.ts$)' },
      to: { path: '^apps/extension/bg/', pathNot: '^apps/extension/bg/$1(/|\\.ts$)' },
    },
    {
      name: 'fansly-api-only-in-its-chunk',
      comment:
        '`fansly-api` runs in the background and for Fansly alone: only Fansly\'s background chunk imports it — not the core, not ChatSpace\'s chunk, not a tab, a page or the relay frame (docs/project-unite/architecture.md §8.1, А9).',
      severity: 'error',
      from: { pathNot: [pkg('fansly-api'), FANSLY_CHUNK, ...TEST_CODE] },
      to: { path: pkg('fansly-api') },
    },
    {
      name: 'background-chunk-through-the-kit',
      comment: 'No site\'s chunk reaches the hub layer, the SDK, the browser API (platform) or the core\'s composition, however indirectly: they are the core\'s, reached through the kit (§3.3).',
      severity: 'error',
      from: BACKGROUND_CHUNKS,
      to: { path: [pkg('hub'), SDK, pkg('platform'), BACKGROUND_ROOTS], reachable: true },
    },
    {
      name: 'main-world-entries-self-contained',
      comment: 'The MAIN-world entry points bundle only host-chatspace/main, the WXT define helpers and ChatSpace\'s row of the hosts\' runtime table (§4, D-06).',
      severity: 'error',
      from: { path: '^apps/extension/src/entrypoints/chatspace-(main\\.content|ws)\\.ts$' },
      to: { pathNot: [pkg('host-chatspace/src/main'), '^apps/extension/src/hosts/runtime/chatspace\\.ts$', npm('wxt')] },
    },
    {
      name: 'fansly-main-entry-self-contained',
      comment: 'Fansly\'s MAIN-world entry point bundles only host-fansly/main, the WXT define helpers and Fansly\'s row of the hosts\' runtime table (docs/project-unite/architecture.md §5, §3.1).',
      severity: 'error',
      from: { path: '^apps/extension/src/entrypoints/fansly-main(\\.content)?\\.ts$' },
      to: { pathNot: [pkg('host-fansly/src/main'), '^apps/extension/src/hosts/runtime/fansly\\.ts$', npm('wxt')] },
    },
    {
      name: 'relay-entry-graph',
      comment:
        'The relay frame is a page of the extension inside a Fansly tab that passes the background\'s requests on (docs/project-unite/architecture.md §8.5): contracts and the platform port only — no core, no UI, no fansly-api (the background\'s), no hub.',
      severity: 'error',
      from: { path: RELAY_ENTRY },
      to: { pathNot: [RELAY_ENTRY, pkg('contracts'), pkg('platform'), ZOD, npm('wxt')] },
    },
    // ── The two sites kept apart (docs/project-unite/architecture.md §1.8) ──
    {
      name: 'fansly-code-only-from-fansly',
      comment:
        'Fansly\'s own code — every file named by Fansly (tools/gates/site-paths.cjs): its packages, its hosts/fansly folders, its entry points, lazy entries and background chunk, its contract modules and its slice of the feature manifest — is imported only by Fansly\'s own code, by the host registry\'s index and by the extension pages\' composition root (the pages carry both sites). Shared code and ChatSpace never import it: a change of Fansly\'s files alone then moves no byte of ChatSpace (docs/project-unite/architecture.md §1.8).',
      severity: 'error',
      from: { pathNot: [FANSLY_OWNED, HOST_REGISTRY_INDEX, PAGES_ROOT, ...TEST_CODE] },
      to: { path: FANSLY_OWNED },
    },
    {
      name: 'chatspace-graph-without-fansly',
      comment:
        'Nothing a ChatSpace bundle is built from — its entry points, the lazy entries of its build, its background chunk — reaches a file of Fansly\'s, however indirectly. This is what makes «only Fansly\'s files changed» mean «ChatSpace is byte-identical» (docs/project-unite/architecture.md §1.8; the background core: `background-core-graph`).',
      severity: 'error',
      from: { path: CHATSPACE_BUNDLE_ROOTS },
      to: { path: FANSLY_OWNED, reachable: true },
    },
    {
      name: 'chatspace-code-only-from-chatspace',
      comment:
        'ChatSpace\'s implementation — its page package and its hosts/chatspace folders — is imported only by ChatSpace\'s own code: its entry points, its halves of the adapter and the two lazy entries that carry them; and by the extension pages\' composition root, which speaks of every site of the build (ChatSpace\'s text pack, R20 F9b), as it may import Fansly\'s. The shared tab composition works with the common HostPort and the adapter (docs/project-unite/architecture.md §1.3, §1.8).',
      severity: 'error',
      from: { pathNot: [...CHATSPACE_HOST_CODE, '^apps/extension/src/entrypoints/chatspace', '^apps/extension/lazy/entries/(tab-app|bridge-validation)\\.ts$', PAGES_ROOT, ...TEST_CODE] },
      to: { path: CHATSPACE_HOST_CODE },
    },
    {
      name: 'host-registry-build-only',
      comment:
        'The host registry (apps/extension/src/hosts/*.ts) is build data — budgets, the contract check, archive markers, the test config — for the manifest, the WXT config and the tools. Code that ships reads the runtime table (hosts/runtime/) instead, and the table never reads the registry: no build field reaches a bundle (docs/project-unite/architecture.md §1.2).',
      severity: 'error',
      from: { pathNot: HOST_REGISTRY },
      to: { path: HOST_REGISTRY },
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
    // Our own .d.ts files are not code. The vendored packages resolve to theirs
    // (`types` comes first in their `exports`): excluding those would hide every
    // SDK and hotkey-engine edge from the rules above.
    // The build configs of the sites' background chunks and lazy chunks are build code (they read the host registry),
    // like wxt.config.ts.
    exclude: { path: ['\\.test\\.tsx?$', '^(?!vendor/).*\\.d\\.ts$', '(^|/)\\.tsbuild/', '(^|/)\\.output/', '(^|/)\\.wxt/', '^packages/testing/(e2e|stand|spike)/', '^apps/extension/(bg|lazy)/vite\\.config\\.ts$'] },
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
