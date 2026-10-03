// Shared paths of the build output for the post-build tools.

import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const EXTENSION_ROOT = `${REPO_ROOT}apps/extension/`;
export const OUTPUT_ROOT = `${EXTENSION_ROOT}.output/`;
/** Release build (`pnpm build`). */
export const RELEASE_DIR = `${OUTPUT_ROOT}firefox-mv3`;
/** Test build (`pnpm build:test`, CG_TEST_HOSTS=1). */
export const TEST_DIR = `${OUTPUT_ROOT}firefox-mv3-test`;

export function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
