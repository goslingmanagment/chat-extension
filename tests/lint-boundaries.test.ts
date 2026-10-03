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
    ['ui imports platform', 'packages/ui/src/bad.tsx', "import { connectTabPort } from '@cg/platform';\nexport const x = connectTabPort;", ['no-restricted-imports']],
    ['ui opens a WebSocket', 'packages/ui/src/bad.ts', "export const x = () => new WebSocket('wss://x');", ['no-restricted-globals']],
    ['ui uses preact/compat', 'packages/ui/src/bad.ts', "import { forwardRef } from 'preact/compat';\nexport const x = forwardRef;", ['no-restricted-imports']],
    ['the MAIN bridge imports a package', 'packages/host-chatspace/src/main/bad.ts', "import { BRIDGE_TAGS } from '@cg/contracts';\nexport const x = BRIDGE_TAGS;", ['no-restricted-imports']],
    ['the isolated host imports core/domain', 'packages/host-chatspace/src/isolated/bad.ts', "import { OP_LIMITS } from '@cg/core/domain';\nexport const x = OP_LIMITS;", ['no-restricted-imports']],
    ['contracts imports core', 'packages/contracts/src/bad.ts', "import { OP_LIMITS } from '@cg/core/domain';\nexport const x = OP_LIMITS;", ['no-restricted-imports']],
    ['hub imports ui', 'packages/hub/src/bad.ts', "import { mountDock } from '@cg/ui';\nexport const x = mountDock;", ['no-restricted-imports']],
    ['a deep import into src', 'apps/extension/src/composition/bad.ts', "import { x } from '@cg/core/src/domain/index';\nexport const y = x;", ['no-restricted-imports']],
    ['a relative import across packages', 'packages/hub/src/bad.ts', "import { x } from '../../core/src/domain/index';\nexport const y = x;", ['no-restricted-imports']],
    ['the app imports the test harness', 'apps/extension/src/composition/bad.ts', "import { startStandServer } from '@cg/testing';\nexport const x = startStandServer;", ['no-restricted-imports']],
  ])('%s → red', async (_label, filePath, code, expected) => {
    expect(await ruleIds(filePath, code)).toEqual(expected);
  });

  it.each([
    ['core/domain imports contracts', 'packages/core/src/domain/ok.ts', "import { CONTRACTS_VERSION } from '@cg/contracts';\nexport const x = CONTRACTS_VERSION;"],
    ['the isolated host imports core/domain/text', 'packages/host-chatspace/src/isolated/ok.ts', "import { normalizeNewlines } from '@cg/core/domain/text';\nexport const x = normalizeNewlines;"],
    ['ui imports preact', 'packages/ui/src/ok.ts', "import { render } from 'preact';\nexport const x = render;"],
    ['platform imports the browser API', 'packages/platform/src/ok.ts', "import { browser } from '@wxt-dev/browser';\nexport const x = browser;"],
  ])('%s → green', async (_label, filePath, code) => {
    expect(await ruleIds(filePath, code)).toEqual([]);
  });
});

describe('dependency-cruiser package graph (§4)', () => {
  it('reports cycles, relative cross-package imports and forbidden edges in the fixture tree', async () => {
    const ruleSet = createRequire(import.meta.url)('../.dependency-cruiser.cjs') as IConfiguration;
    const baseDir = fileURLToPath(new URL('fixtures/depcruise/', import.meta.url));
    const result = await cruise(['packages'], { ...ruleSet.options, baseDir, ruleSet: { forbidden: ruleSet.forbidden ?? [] }, validate: true });
    const output = result.output as ICruiseResult;
    const violations = output.summary.violations.map((violation) => `${violation.rule.name}: ${violation.from} → ${violation.to}`).sort();
    expect(violations).toEqual([
      'core-domain-pure: packages/core/src/domain/index.ts → packages/platform/src/index.ts',
      'host-main-self-contained: packages/host-chatspace/src/main/index.ts → packages/contracts/src/index.ts',
      'no-circular: packages/core/src/domain/cycle-a.ts → packages/core/src/domain/cycle-b.ts',
      'no-relative-cross-package: packages/core/src/domain/index.ts → packages/platform/src/index.ts',
      'no-relative-cross-package: packages/host-chatspace/src/isolated/index.ts → packages/contracts/src/index.ts',
      'no-relative-cross-package: packages/host-chatspace/src/main/index.ts → packages/contracts/src/index.ts',
      'no-relative-cross-package: packages/ui/src/index.ts → packages/host-chatspace/src/main/index.ts',
      'ui-views-only: packages/ui/src/index.ts → packages/host-chatspace/src/main/index.ts',
    ]);
  });
});
