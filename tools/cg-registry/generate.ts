// Writes docs/error-registry.md from the CG registry and the `ru` catalog.
// Usage: node tools/cg-registry/generate.ts
// The package sources use extensionless imports, which plain Node does not
// resolve, so they are loaded through jiti.

import { writeFileSync } from 'node:fs';

import { createJiti } from 'jiti';

import type * as RegistryModule from '../../packages/contracts/src/errors/registry.ts';
import type * as RuModule from '../../packages/core/src/domain/i18n/ru.ts';
import { REPO_ROOT } from '../lib/paths.ts';
import { REGISTRY_DOC_PATH, renderRegistryDoc } from './render.ts';

const jiti = createJiti(import.meta.url);
const { CG_REGISTRY, CG_RETRY_APPENDIX_A } = await jiti.import<typeof RegistryModule>('../../packages/contracts/src/errors/registry.ts');
const { RU } = await jiti.import<typeof RuModule>('../../packages/core/src/domain/i18n/ru.ts');

const doc = renderRegistryDoc({
  entries: Object.values(CG_REGISTRY),
  retryWord: (entry) => CG_RETRY_APPENDIX_A[entry.retry],
  ru: (key) => RU[key],
});
writeFileSync(`${REPO_ROOT}${REGISTRY_DOC_PATH}`, doc);
console.log(`cg-registry: wrote ${REGISTRY_DOC_PATH} (${Object.keys(CG_REGISTRY).length} codes).`);
