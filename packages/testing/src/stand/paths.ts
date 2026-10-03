// Where the stand's files live. The fixture build goes to a dot-folder of the
// repo root: never into the AMO sources archive (WXT skips dot-folders) and
// never into git (.cache/ is ignored).

import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
/** The M0 spike page and its script (static, no build). */
export const SPIKE_STAND_DIR = fileURLToPath(new URL('../../stand/', import.meta.url));
/** Sources of the ChatSpace-like fixture app. */
export const FIXTURE_SOURCE_DIR = fileURLToPath(new URL('../../fixture-chatspace/', import.meta.url));
/** Built fixture app (`pnpm --filter @cg/testing build:stand`). */
export const FIXTURE_BUILD_DIR = `${REPO_ROOT}.cache/fixture-chatspace/`;
/** Screenshots, timings and other e2e evidence. */
export const E2E_EVIDENCE_DIR = `${REPO_ROOT}.cache/e2e/`;
