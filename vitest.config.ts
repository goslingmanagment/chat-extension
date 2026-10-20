// Vitest workspace (architecture.md §12 п. 1): one config, two projects —
// `unit` in Node (core logic, tools, repo invariants, manifest build test) and
// `dom` in happy-dom (bridge handshake, UI rendering into shadow roots).

import { defineConfig } from 'vitest/config';

const jsx = { runtime: 'automatic', importSource: 'preact' } as const;

export default defineConfig({
  oxc: { jsx },
  define: { __CG_TEST_HOSTS__: 'false' },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['packages/*/src/**/*.test.ts', 'packages/*/test/**/*.test.ts', 'apps/extension/test/**/*.test.ts', 'tools/**/*.test.ts', 'tests/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/*.dom.test.ts'],
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'happy-dom',
          include: ['packages/*/src/**/*.dom.test.ts', 'packages/*/src/**/*.test.tsx', 'apps/extension/src/**/*.test.ts'],
          exclude: ['**/node_modules/**'],
          // Vitest's 5 s default timed out a render test on a loaded CI runner; a hung test still fails, later.
          testTimeout: 30_000,
        },
      },
    ],
  },
});
