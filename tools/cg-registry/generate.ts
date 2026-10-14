// Writes docs/error-registry.md from the CG registry and the `ru` catalog.
// Usage: node tools/cg-registry/generate.ts
// The package sources use extensionless imports, which plain Node does not
// resolve, so they are loaded through jiti.

import { writeFileSync } from 'node:fs';

import { createJiti } from 'jiti';

import type * as RegistryModule from '../../packages/contracts/src/errors/registry.ts';
import type * as RuModule from '../../packages/core/src/domain/i18n/ru.ts';
import type * as FanslyModule from '../../packages/contracts/src/errors-fansly.ts';
import type * as FanslyRuModule from '../../packages/core/src/domain/hosts/fansly/i18n/ru.ts';
import type * as ChatSpacePackModule from '../../packages/core/src/domain/hosts/chatspace/i18n/index.ts';
import type * as LiveModule from '../../packages/core/src/domain/i18n/live.ts';
import { REPO_ROOT } from '../lib/paths.ts';
import { REGISTRY_DOC_PATH, renderRegistryDoc } from './render.ts';

const jiti = createJiti(import.meta.url);
const { CG_REGISTRY, CG_RETRY_APPENDIX_A } = await jiti.import<typeof RegistryModule>('../../packages/contracts/src/errors/registry.ts');
const { RU } = await jiti.import<typeof RuModule>('../../packages/core/src/domain/i18n/ru.ts');
const { CG_FANSLY_REGISTRY } = await jiti.import<typeof FanslyModule>('../../packages/contracts/src/errors-fansly.ts');
const { FANSLY_CG_RU } = await jiti.import<typeof FanslyRuModule>('../../packages/core/src/domain/hosts/fansly/i18n/ru.ts');
const { CHATSPACE_PHRASES } = await jiti.import<typeof ChatSpacePackModule>('../../packages/core/src/domain/hosts/chatspace/i18n/index.ts');
const { interpolate, withPhrases } = await jiti.import<typeof LiveModule>('../../packages/core/src/domain/i18n/live.ts');

const doc = renderRegistryDoc({
  entries: Object.values(CG_REGISTRY),
  retryWord: (entry) => CG_RETRY_APPENDIX_A[entry.retry],
  // The shared texts as ChatSpace says them: its phrases where a text says `{site}` (R20 F9b).
  ru: (key) => interpolate(RU[key], withPhrases(CHATSPACE_PHRASES.ru, {})),
  fansly: { entries: Object.values(CG_FANSLY_REGISTRY), ru: (key) => FANSLY_CG_RU[key] },
});
writeFileSync(`${REPO_ROOT}${REGISTRY_DOC_PATH}`, doc);
console.log(`cg-registry: wrote ${REGISTRY_DOC_PATH} (${Object.keys(CG_REGISTRY).length} codes, ${Object.keys(CG_FANSLY_REGISTRY).length} of Fansly).`);
