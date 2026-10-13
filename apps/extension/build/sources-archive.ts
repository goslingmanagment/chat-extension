// What the AMO sources archive leaves out besides docs, tests and build output:
// the ChatSpace-like stand of R02 (its Vue + TipTap app, the stand server and
// entry, the M0 spike page, the fixture's DOM tests), the e2e harness that
// drives Firefox against it and the R20 spike's probes (P3a). None of it is
// needed to rebuild the XPI.
// wxt.config.ts excludes these paths; tools/archive-check fails if any of them
// is in the sources archive anyway, and if anything left in it imports or
// references a file that is not there (`dangling-import`).
//
// The archive's contract: `pnpm install --frozen-lockfile`, `pnpm typecheck`,
// `pnpm lint` and `pnpm build` work in it, and the build gives the same XPI.
// Tests are not in it (WXT drops every *.test.* / *.spec.* file), so neither
// is `pnpm test` nor `pnpm e2e`. For `tsc -b` the fixture's tsconfig and its
// wire-protocol types (no app code, no host library) stay: the testing
// project references that project.
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
  'packages/testing/e2e/',
  'packages/testing/spike/',
] as const;

/**
 * Dotfiles the archive needs although WXT skips dotfiles: the dependency
 * rules `pnpm lint` runs, the pnpm settings and the Node version.
 */
export const SOURCE_DOTFILES: readonly string[] = ['.dependency-cruiser.cjs', '.npmrc', '.nvmrc'];

/** Files inside STAND_SOURCE_PATHS that stay in the archive (see the header). */
export const STAND_SOURCE_KEPT: readonly string[] = ['packages/testing/fixture-chatspace/tsconfig.json', 'packages/testing/fixture-chatspace/src/protocol.ts'];

const FIXTURE = 'packages/testing/fixture-chatspace/';

/**
 * The same paths as WXT `excludeSources` globs (tinyglobby `ignore`, with
 * extglobs): the fixture folder goes except its kept files.
 */
export const STAND_SOURCE_GLOBS: readonly string[] = STAND_SOURCE_PATHS.flatMap((path) => {
  if (path === FIXTURE) return [`${FIXTURE}!(tsconfig.json|src)`, `${FIXTURE}src/!(protocol.ts)`, `${FIXTURE}src/*/**`];
  return [path.endsWith('/') ? `${path}**` : path];
});

/** Whether an archive entry (repo-relative) belongs to the stand or its e2e harness. */
export function isStandSource(name: string): boolean {
  if (STAND_SOURCE_KEPT.includes(name)) return false;
  return STAND_SOURCE_PATHS.some((path) => (path.endsWith('/') ? name.startsWith(path) : name === path));
}
