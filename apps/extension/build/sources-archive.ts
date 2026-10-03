// What the AMO sources archive leaves out besides docs and build output: the
// ChatSpace-like stand of R02 (its Vue + TipTap app, the stand server, the M0
// spike page and the fixture's DOM tests). None of it is needed to rebuild the
// XPI. wxt.config.ts excludes these paths; tools/archive-check fails if any
// of them is in the sources archive anyway.
//
// Relative imports carry `.ts`: this file also runs under plain Node 26.

/** Repo-relative paths: a trailing slash is a whole folder. */
export const STAND_SOURCE_PATHS = [
  'packages/testing/fixture-chatspace/',
  'packages/testing/fixture-chatspace.vite.config.ts',
  'packages/testing/stand/',
  'packages/testing/src/stand/',
  'packages/testing/src/stand-server.ts',
  'packages/testing/src/stand-cli.ts',
  'packages/testing/src/fixture/',
] as const;

/** The same paths as WXT `excludeSources` globs. */
export const STAND_SOURCE_GLOBS: readonly string[] = STAND_SOURCE_PATHS.map((path) => (path.endsWith('/') ? `${path}**` : path));

/** Whether an archive entry (repo-relative) belongs to the stand. */
export function isStandSource(name: string): boolean {
  return STAND_SOURCE_PATHS.some((path) => (path.endsWith('/') ? name.startsWith(path) : name === path));
}
