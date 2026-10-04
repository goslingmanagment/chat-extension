// The client's own sources, for negative checks that act as gates (R02,
// docs/parity: «не нужно» / «убрано владельцем» rows): every non-test source
// file of the packages that ship in the XPI and of the extension app. A
// removed function must not come back as a string or a call in any of them.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * Source roots of the shipped code (architecture.md §4): contracts, core, hub,
 * platform, host, UI, the extension app and its lazy chunks (lazy/entries:
 * `dock` ships as lazy/dock.js; the test-only `spike` entry is scanned too).
 */
export const CLIENT_SOURCE_ROOTS = [
  'packages/contracts/src',
  'packages/core/src',
  'packages/hub/src',
  'packages/platform/src',
  'packages/host-chatspace/src',
  'packages/ui/src',
  'apps/extension/src',
  'apps/extension/lazy/entries',
] as const;

const SOURCE = /\.(?:ts|tsx|js|mjs|html|css)$/;
const TEST = /\.(?:test|spec)\.(?:ts|tsx)$/;

export interface SourceFile {
  /** Repo-relative, forward slashes. */
  readonly path: string;
  readonly text: string;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name.startsWith('.') ? [] : walk(full);
    return SOURCE.test(entry.name) && !TEST.test(entry.name) ? [full] : [];
  });
}

let cache: readonly SourceFile[] | null = null;

/** Every shipped source file (read once per test file). */
export function clientSources(): readonly SourceFile[] {
  cache ??= CLIENT_SOURCE_ROOTS.flatMap((root) => walk(join(REPO_ROOT, root))).map((full) => ({ path: relative(REPO_ROOT, full).split('\\').join('/'), text: readFileSync(full, 'utf8') }));
  return cache;
}

/** `file:line: match` for every match of `pattern` in one file's text. */
export function findInFile(file: SourceFile, pattern: RegExp): string[] {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return file.text.split('\n').flatMap((line, index) => [...line.matchAll(new RegExp(pattern.source, flags))].map((match) => `${file.path}:${index + 1}: ${match[0]}`));
}

/**
 * `file:line: match` for every line matching `pattern` outside `allowed`
 * files (the contracts' own registries name what is forbidden).
 */
export function findInClientSources(pattern: RegExp, allowed: readonly string[] = []): string[] {
  return clientSources()
    .filter((file) => !allowed.includes(file.path))
    .flatMap((file) => findInFile(file, pattern));
}
