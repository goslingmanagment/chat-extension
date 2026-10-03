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
      'no-restricted-globals': ['error', ...BANNED_GLOBALS.filter((global) => global.name !== 'WebSocket')],
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
      'no-restricted-globals': ['error', ...BANNED_GLOBALS],
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
    files: ['apps/extension/src/**/*.ts', 'apps/extension/lazy/entries/**/*.ts'],
    rules: restrict({
      group: flat(CG.testing, BROWSER_API.filter((name) => !name.startsWith('wxt')), NODE),
      message: 'Entry points and composition roots wire packages; browser.* goes through @cg/platform; test code never ships (§4).',
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
