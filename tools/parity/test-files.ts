// Every test file of the repository with its row tags and host marks: the
// Vitest files and the e2e specs. Read by `pnpm parity` (the Fansly gate) and
// `pnpm parity:coverage` (the report).

import { globSync, readFileSync } from 'node:fs';
import { sep } from 'node:path';

import { tagsOfTestFile, type TaggedFile } from './coverage-report.ts';

const TEST_GLOBS = ['{packages,apps,tools,tests}/**/*.test.{ts,tsx}', 'packages/testing/e2e/**/*.e2e.ts'];
const NOT_OURS = /(^|\/)(node_modules|\.tsbuild|\.output|\.wxt|\.cache|dist|coverage)\//;
/** The tests of the parity tools themselves: their strings are samples of test files, with made-up tags. */
const OWN_TESTS = /^tools\/parity\//;

/** `root` ends with a slash (tools/lib/paths.ts REPO_ROOT). */
export function readTestFiles(root: string): TaggedFile[] {
  const paths = [...new Set(TEST_GLOBS.flatMap((pattern) => globSync(pattern, { cwd: root })).map((path) => path.split(sep).join('/')))]
    .filter((path) => !NOT_OURS.test(path) && !OWN_TESTS.test(path))
    .sort();
  return paths.map((path) => ({ path, ...tagsOfTestFile(path, readFileSync(`${root}${path}`, 'utf8')) }));
}
