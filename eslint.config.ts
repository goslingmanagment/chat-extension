// ESLint (architecture.md §3 «pnpm check» п. 2, §4 «Правила»): the package
// graph, banned globals and banned deep imports. dependency-cruiser
// (.dependency-cruiser.cjs) checks the same graph on resolved paths plus
// cycles; tests/lint-boundaries.test.ts proves both go red on a violation.

import js from '@eslint/js';
import type { Linter } from 'eslint';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

type Restriction = { group?: string[]; regex?: string; message: string };

/** Packages a workspace package must not import, by §4. */
const CG = {
  contracts: '@cg/contracts',
  core: ['@cg/core', '@cg/core/*'],
  platform: '@cg/platform',
  hub: '@cg/hub',
  host: ['@cg/host-chatspace', '@cg/host-chatspace/*'],
  ui: ['@cg/ui', '@cg/ui/*'],
  testing: '@cg/testing',
  extension: '@cg/extension',
};

const BROWSER_API = ['@wxt-dev/browser', 'wxt', 'wxt/*', 'webextension-polyfill'];
const PREACT = ['preact', 'preact/*', '@preact/*'];
const SDK = ['@kernel/sdk'];
const NODE = ['node:*'];

/** No reaching into another package's files — only its `exports` (§4). */
const DEEP_IMPORTS: Restriction[] = [
  { group: ['@cg/*/src', '@cg/*/src/*'], message: 'Import a package through its `exports`, never its src/ (§4).' },
  {
    regex: '^(\\.\\./)+(packages|apps|vendor)/',
    message: 'No relative imports across packages; import the package by name (§4).',
  },
  {
    // Inside a package nothing needs to name a `src/` folder: climbing out and
    // into `<other>/src` is a cross-package relative import.
    regex: '^(\\.\\./)+[^./][^/]*/src(/|$)',
    message: 'No relative imports across packages; import the package by name (§4).',
  },
  { group: ['**/vendor/**'], message: 'Vendored packages are imported by name (@kernel/sdk, @chatgoose/hotkeys).' },
];

function restrict(...groups: Restriction[]): Linter.RulesRecord {
  return {
    'no-restricted-imports': ['error', { patterns: [...DEEP_IMPORTS, ...groups] }],
  };
}

const flat = (...items: Array<string | string[]>): string[] => items.flat();

/** §4: `core` and `ui` never touch the browser, the network or storage directly. */
const BANNED_GLOBALS = ['browser', 'chrome', 'fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage'].map((name) => ({
  name,
  message: `\`${name}\` is not allowed here: capabilities come through ports from the composition root (architecture.md §4).`,
}));
const BANNED_GLOBAL_PROPERTIES = ['window', 'globalThis', 'self'].flatMap((object) =>
  ['browser', 'chrome', 'fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage'].map((property) => ({
    object,
    property,
    message: `\`${object}.${property}\` is not allowed here (architecture.md §4).`,
  })),
);

/**
 * §4 «host-chatspace не ходит в сеть»: the host code receives the page window
 * as a parameter (`win.fetch`), so network and storage are banned as a property
 * of ANY object there, not only of window/globalThis/self.
 */
const HOST_NETWORK = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'localStorage', 'sessionStorage'];
const hostNetworkProperties = (allow: readonly string[] = []) =>
  HOST_NETWORK.filter((property) => !allow.includes(property)).map((property) => ({
    property,
    message: `\`.${property}\` is not allowed in host-chatspace: the host never goes to the network or page storage (§4, X3).`,
  }));
const hostBannedGlobals = (allow: readonly string[] = []) => [
  ...BANNED_GLOBALS.filter((global) => !allow.includes(global.name)),
  ...['EventSource', 'sessionStorage']
    .filter((name) => !allow.includes(name))
    .map((name) => ({ name, message: `\`${name}\` is not allowed in host-chatspace (§4, X3).` })),
];

/** The background is the only place that may use the hub facade and the SDK (§4, D-13). */
const BACKGROUND_FILES = ['apps/extension/src/entrypoints/background.ts', 'apps/extension/src/composition/background.ts'];
/** MAIN-world entry points: bundled self-contained, like host-chatspace/main itself (§4, D-06). */
const MAIN_WORLD_ENTRIES = ['apps/extension/src/entrypoints/chatspace-main.content.ts', 'apps/extension/src/entrypoints/chatspace-ws.ts'];
/** The tap is the one MAIN file that wraps the page's WebSocket constructor (§6.8). */
const WS_TAP_FILE = 'packages/host-chatspace/src/main/ws-tap.ts';

const APP_RESTRICTION: Restriction = {
  // `wxt` and `wxt/utils/*` stay allowed for the define helpers and types;
  // `wxt/browser` is browser.* and goes through @cg/platform (D-01).
  group: flat(CG.testing, '@wxt-dev/browser', 'webextension-polyfill', 'wxt/browser', 'wxt/browser/*', NODE),
  message: 'Entry points and composition roots wire packages; browser.* goes through @cg/platform; test code never ships (§4, D-01).',
};
const HUB_BACKGROUND_ONLY: Restriction = {
  group: flat(CG.hub, SDK),
  message: '`hub` and the SDK are background-only: the token and the network never reach a content script, a page or a lazy chunk (§4, D-13).',
};

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/.output/**',
      '**/.wxt/**',
      '**/.tsbuild/**',
      '**/dist/**',
      '**/coverage/**',
      'vendor/**',
      'docs/**',
      '.dev-profile/**',
      '.cache/**',
      'tests/fixtures/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
      // Every package boundary goes through `exports` (§4).
      'no-restricted-imports': ['error', { patterns: DEEP_IMPORTS }],
    },
  },
  {
    // Plain JS/CJS files are not in a TS project: no type-aware rules.
    files: ['**/*.{js,cjs,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['.dependency-cruiser.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
  {
    files: ['packages/testing/stand/**/*.js'],
    languageOptions: { sourceType: 'script', globals: globals.browser },
  },

  // ── Package graph (architecture.md §4) ──
  {
    files: ['packages/contracts/src/**/*.ts'],
    rules: restrict({
      group: flat(CG.core, CG.platform, CG.hub, CG.host, CG.ui, CG.testing, CG.extension, BROWSER_API, PREACT, SDK, NODE, '@chatgoose/*'),
      message: '`contracts` imports only zod (§4).',
    }),
  },
  {
    files: ['packages/core/src/**/*.ts'],
    rules: {
      ...restrict({
        group: flat(CG.platform, CG.hub, CG.host, CG.ui, CG.testing, CG.extension, BROWSER_API, PREACT, SDK, NODE, 'zod', 'zod/*'),
        message: '`core` has no DOM, browser.*, fetch, Preact or SDK: only @cg/contracts and the vendored hotkey engine (§4).',
      }),
      'no-restricted-globals': ['error', ...BANNED_GLOBALS],
      'no-restricted-properties': ['error', ...BANNED_GLOBAL_PROPERTIES],
    },
  },
  {
    files: ['packages/platform/src/**/*.ts'],
    rules: restrict({
      group: flat(CG.core, CG.hub, CG.host, CG.ui, CG.testing, CG.extension, PREACT, SDK, 'wxt', 'wxt/*'),
      message: '`platform` wraps browser.* via @wxt-dev/browser and depends only on @cg/contracts (§4).',
    }),
  },
  {
    files: ['packages/hub/src/**/*.ts'],
    rules: restrict({
      group: flat(CG.host, CG.ui, CG.testing, CG.extension, PREACT, BROWSER_API),
      message: '`hub` is background-only: contracts, core, platform and the vendored SDK (§4).',
    }),
  },
  {
    files: ['packages/host-chatspace/src/main/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!\\./)',
              message: 'The MAIN bridge is a self-contained bundle: only same-folder imports (§4).',
            },
          ],
        },
      ],
      'no-restricted-globals': ['error', ...hostBannedGlobals()],
      'no-restricted-properties': ['error', ...BANNED_GLOBAL_PROPERTIES, ...hostNetworkProperties()],
    },
  },
  {
    files: [WS_TAP_FILE],
    rules: {
      'no-restricted-globals': ['error', ...hostBannedGlobals(['WebSocket'])],
      'no-restricted-properties': [
        'error',
        ...BANNED_GLOBAL_PROPERTIES.filter((rule) => rule.property !== 'WebSocket'),
        ...hostNetworkProperties(['WebSocket']),
      ],
    },
  },
  {
    files: ['packages/host-chatspace/src/isolated/**/*.ts'],
    rules: {
      ...restrict(
        {
          // Exact match: core/domain/text is allowed, core's other entries are not.
          regex: '^@cg/core(/(domain|services|application))?$',
          message: '`host-chatspace/isolated` may import only @cg/core/domain/text from core (§4).',
        },
        {
        group: flat(
          CG.platform,
          CG.hub,
          CG.ui,
          CG.testing,
          CG.extension,
          BROWSER_API,
          PREACT,
          SDK,
          NODE,
          '../main',
          '../main/*',
        ),
        message: '`host-chatspace/isolated` imports only @cg/contracts and @cg/core/domain/text; no token, no network (§4).',
        },
      ),
      'no-restricted-globals': ['error', ...hostBannedGlobals()],
      'no-restricted-properties': ['error', ...BANNED_GLOBAL_PROPERTIES, ...hostNetworkProperties()],
    },
  },
  {
    files: ['packages/ui/src/**/*.{ts,tsx}'],
    rules: {
      ...restrict({
        group: flat(CG.core, CG.platform, CG.hub, CG.host, CG.testing, CG.extension, BROWSER_API, SDK, NODE, 'preact/compat'),
        message: '`ui` renders view models from AppClient: only @cg/contracts, ui/kit and Preact; no preact/compat (§4, §10.2, D-05).',
      }),
      'no-restricted-globals': ['error', ...BANNED_GLOBALS],
      'no-restricted-properties': ['error', ...BANNED_GLOBAL_PROPERTIES],
    },
  },
  {
    // Content-script and page composition roots, entry points, lazy chunks.
    files: ['apps/extension/src/**/*.ts', 'apps/extension/lazy/entries/**/*.ts'],
    ignores: BACKGROUND_FILES,
    rules: restrict(APP_RESTRICTION, HUB_BACKGROUND_ONLY),
  },
  {
    files: BACKGROUND_FILES,
    rules: restrict(APP_RESTRICTION),
  },
  {
    files: MAIN_WORLD_ENTRIES,
    rules: restrict({
      regex: '^(?!@cg/host-chatspace/main$|wxt$|wxt/utils/define-[a-z-]+$|\\.\\./hosts$)',
      message: 'MAIN-world entry points bundle only @cg/host-chatspace/main, the WXT define helpers and ../hosts (§4, D-06).',
    }),
  },
  {
    files: ['packages/*/src/**/*.test.{ts,tsx}', 'apps/extension/test/**/*.ts', 'tools/**/*.ts', 'tests/**/*.ts', 'packages/testing/**/*.ts'],
    rules: { 'no-restricted-imports': 'off', 'no-restricted-globals': 'off', 'no-restricted-properties': 'off', 'no-console': 'off' },
  },
  {
    files: ['tools/**/*.ts', 'tests/**/*.ts', 'packages/testing/**/*.ts', 'apps/extension/{build,test,lazy}/**/*.ts', '*.config.ts', 'apps/extension/wxt.config.ts'],
    languageOptions: { globals: globals.node },
  },
);
