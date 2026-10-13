// File collection for the post-build tools (repo-relative POSIX paths).

import { globSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { REPO_ROOT } from './paths.ts';

export interface TextFile {
  readonly path: string;
  readonly text: string;
}

const toPosix = (path: string): string => path.split(sep).join('/');

/**
 * Our shipped source: packages, entry points, composition roots, the lazy entries of every site's build and the
 * sites' background chunks — no tests, and not the build configs that lie beside the entries.
 */
export const SOURCE_GLOBS = [
  'packages/*/src/**/*.{ts,tsx}',
  'apps/extension/src/**/*.{ts,tsx}',
  'apps/extension/lazy/**/*.{ts,tsx}',
  'apps/extension/bg/**/*.{ts,tsx}',
];

export function readSources(globs: readonly string[] = SOURCE_GLOBS): TextFile[] {
  const paths = globs.flatMap((pattern) => globSync(pattern, { cwd: REPO_ROOT }));
  return [...new Set(paths.map(toPosix))]
    .filter((path) => !/\.test\.tsx?$/.test(path) && !path.includes('/node_modules/') && !/(^|\/)vite\.config\.ts$/.test(path))
    .sort()
    .map((path) => ({ path, text: readFileSync(join(REPO_ROOT, path), 'utf8') }));
}

/** Every file under `dir`, paths relative to `dir`. */
export function listTree(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? listTree(path).map((child) => `${name}/${child}`) : [name];
    })
    .sort();
}

export function readTree(dir: string, filter: (path: string) => boolean = () => true): TextFile[] {
  return listTree(dir)
    .filter(filter)
    .map((path) => ({ path: toPosix(path), text: readFileSync(join(dir, path), 'utf8') }));
}

/** Every file under `dir` as it lies on disk, paths relative to `dir`. */
export function readTreeBytes(dir: string): Array<{ readonly path: string; readonly data: Uint8Array }> {
  return listTree(dir).map((path) => ({ path: toPosix(path), data: readFileSync(join(dir, path)) }));
}

export function repoRelative(path: string): string {
  return toPosix(relative(REPO_ROOT, path));
}
