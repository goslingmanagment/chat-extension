// Where a test runs (docs/project-unite/plan.md §0): a test closes a parity
// row only on its own host and at its own level.
//
// - The host comes from the path of the test file. Fansly: the specs
//   `suite-fansly-*.e2e.ts` and `fansly-*.e2e.ts` (the perf probe),
//   `packages/host-fansly/**`, `packages/fansly-api/**`, `**/hosts/fansly/**`,
//   `**/bg/fansly/**`. ChatSpace: `packages/host-chatspace/**`,
//   `**/hosts/chatspace/**`, `**/bg/chatspace/**` and the ChatSpace stand's
//   fixture (`packages/testing/fixture-chatspace/**`,
//   `packages/testing/src/fixture/**`). A mark of the other site on such a
//   path is an error.
// - Elsewhere a test may carry an explicit host mark — `[host:fansly]`,
//   `[host:chatspace]` — in a test title. Marks are collected per file, like
//   the row tags: one mark anywhere in the file puts all its tests on that
//   site; both marks — on both (a mixed test).
// - Without a path or a mark, an e2e spec runs on the ChatSpace stand; any
//   other test is host-free (shared code).
//
// The level: an `.e2e.ts` spec runs in a browser, everything else is a unit
// (or integration) test.
//
// Relative imports carry `.ts`: this file runs under plain Node 26.

import type { CheckKind } from './derive.ts';

export const HOSTS = ['chatspace', 'fansly'] as const;
export type Host = (typeof HOSTS)[number];

/** `[host:fansly]` in a test title. */
export const HOST_MARK = /\[host:([a-z0-9-]+)\]/g;

export type TestLevel = 'unit' | 'browser';

const SITE_PATHS: Readonly<Record<Host, readonly RegExp[]>> = {
  fansly: [/(^|\/)(suite-)?fansly-[^/]*\.e2e\.tsx?$/, /^packages\/host-fansly\//, /^packages\/fansly-api\//, /(^|\/)hosts\/fansly\//, /(^|\/)bg\/fansly\//],
  chatspace: [/^packages\/host-chatspace\//, /(^|\/)hosts\/chatspace\//, /(^|\/)bg\/chatspace\//, /^packages\/testing\/fixture-chatspace\//, /^packages\/testing\/src\/fixture\//],
};

export interface TestPlace {
  /** The sites the test runs on; empty — a host-free test of shared code. */
  readonly hosts: readonly Host[];
  readonly level: TestLevel;
  /** What decided the host. */
  readonly by: 'path' | 'mark' | 'default';
}

export function levelOfTest(path: string): TestLevel {
  return /\.e2e\.tsx?$/.test(path) ? 'browser' : 'unit';
}

const isHost = (name: string): name is Host => (HOSTS as readonly string[]).includes(name);

/** The site of a test file and the problems of its host marks (an unknown site, a mark against its path). */
export function placeOfTest(path: string, marks: readonly string[]): { readonly place: TestPlace; readonly problems: readonly string[] } {
  const level = levelOfTest(path);
  const problems: string[] = [];
  for (const mark of marks) if (!isHost(mark)) problems.push(`${path}: [host:${mark}] is no site (${HOSTS.join(', ')})`);
  const marked = HOSTS.filter((host) => marks.includes(host));
  const byPath = HOSTS.find((host) => SITE_PATHS[host].some((pattern) => pattern.test(path)));
  if (byPath !== undefined) {
    for (const host of marked) if (host !== byPath) problems.push(`${path}: a test of ${byPath} code cannot carry [host:${host}]`);
    return { place: { hosts: [byPath], level, by: 'path' }, problems };
  }
  if (marked.length > 0) return { place: { hosts: marked, level, by: 'mark' }, problems };
  return { place: { hosts: level === 'browser' ? ['chatspace'] : [], level, by: 'default' }, problems };
}

/**
 * Whether a test that names a row is on the row's host: its own site, or —
 * host-free — on ChatSpace (whose rows shared code has always closed) and on
 * Fansly only for a `shared` row (`общий`: the same host-free test closes it
 * on both sites).
 */
export function onHost(place: TestPlace, host: Host, kind: CheckKind): boolean {
  if (place.hosts.length === 0) return host === 'chatspace' || kind === 'shared';
  return place.hosts.includes(host);
}

/** The level a check needs: a browser scenario for e2e and the stand's snapshots, any test for the rest. */
export function levelOfCheck(kind: CheckKind): TestLevel | null {
  if (kind === 'e2e' || kind === 'stand-visual') return 'browser';
  if (kind === 'unit' || kind === 'shared' || kind === 'manual-smoke') return 'unit';
  return null;
}

/** A browser test proves a unit-level row as well; a unit test never proves a browser-level one. */
export function atLevel(place: TestPlace, kind: CheckKind): boolean {
  const needed = levelOfCheck(kind);
  return needed !== null && (needed === 'unit' || place.level === 'browser');
}

/** Whether a test closes a row's check on a host: on that host and at that level. Hub, negative, after-pilot and n/a checks are never closed by a test of ours. */
export function closes(place: TestPlace, host: Host, kind: CheckKind): boolean {
  return onHost(place, host, kind) && atLevel(place, kind);
}
