// Whose file is it (docs/project-unite/architecture.md §1.8): the one table of
// the sites' own paths, as regular expression sources over repo-relative POSIX
// paths. Two readers, so the graph and the gates cannot drift apart:
// .dependency-cruiser.cjs (who may import a site's code, what a ChatSpace
// bundle can reach) and tools/gates/sites.ts (the site literals, the marker
// strings, the diff of a pull request).
//
// A site's file is a file NAMED by the site — by ownership, not by one folder:
// a path where the site's name stands as a whole word of a folder or a file
// name. For Fansly that is packages/host-fansly/**, packages/fansly-api/**,
// **/hosts/fansly/**, apps/extension/src/hosts/fansly.ts,
// apps/extension/src/entrypoints/fansly*, apps/extension/lazy/fansly/**,
// apps/extension/bg/fansly.ts, packages/contracts/src/**/*fansly*.ts
// (features/fansly.ts, errors-fansly.ts, bridge-*-fansly.ts,
// tab-messages-fansly.ts, send-fansly.ts, fansly.ts), the Fansly text packs —
// and whatever a later PR names the same way.
//
// The claim «a change of Fansly's files alone moves no byte of ChatSpace» is
// not taken on the name's word: the rules `chatspace-graph-without-fansly` and
// `background-core-graph` fail when a ChatSpace bundle or the background core
// can reach such a file.
//
// One file named by a site is NOT the site's: its row of the hosts' runtime
// table (apps/extension/src/hosts/runtime/<site>.ts). The background core and
// the extension pages read the whole table (architecture.md §1.2), so a change
// of a row moves bytes both sites load — it is shared code.

/** The runtime table of the hosts: read by the background core and the pages of both sites. */
const RUNTIME_TABLE = 'apps/extension/src/hosts/runtime/';

/**
 * A path that names `site` as a whole word of a folder or file name — outside the runtime table. (Written without a
 * quantified group: dependency-cruiser refuses a regular expression that could backtrack without end.)
 */
const ownedBy = (site) => `^(?!${RUNTIME_TABLE}).*(?:^|[/._-])${site}(?:[/._-]|$)`;

module.exports = {
  RUNTIME_TABLE,
  /** Fansly's own files. */
  FANSLY_OWNED: ownedBy('fansly'),
  /** ChatSpace's own files. */
  CHATSPACE_OWNED: ownedBy('chatspace'),
  /**
   * What no bundle is built from: the documents, the release site, the tests and their package, the tools, the CI and
   * the configs of the linters and the test runner. A change of these alone cannot move a byte of the extension.
   */
  NEUTRAL: [
    '^docs/',
    '^site/',
    '^[^/]+\\.md$',
    '^tests/',
    '^tools/',
    '^\\.github/',
    '^(?:\\.dependency-cruiser\\.cjs|eslint\\.config\\.ts|vitest\\.config\\.ts)$',
    '^packages/testing/',
    '^packages/[^/]+/test/',
    '^apps/extension/test/',
    '\\.test\\.tsx?$',
  ],
};
