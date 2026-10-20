// What the release tool reads from this checkout: the version, the changelog,
// the site, the vendored manifests, the build in .output/, the records in
// .release/, and git. The only module that touches the local filesystem
// besides cli.ts; the network is not here.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';

import { builtArtifacts } from '../lib/artifacts.ts';
import { listTree } from '../lib/files.ts';
import type { ZipEntry } from '../lib/zip.ts';
import { SITE_PAGES as EXTENSION_LINKS } from '../../apps/extension/src/site.ts';
import { parseChangelog, type Changelog } from './changelog.ts';
import { CHANGELOG_FILE, RELEASE_DIR, releaseTarget, SITE_DIR, VERSION_FILE, type ReleaseTarget } from './config.ts';
import { mustRun, type Exec } from './exec.ts';
import type { VendorObservation } from './gate.ts';
import type { LocalFile } from './publish.ts';
import {
  parseAnnouncedRecord,
  parseGateRecord,
  parseReleaseRecord,
  releasePaths,
  type AnnouncedRecord,
  type ArtifactRef,
  type GateRecord,
  type ReleasePaths,
  type ReleaseRecord,
} from './records.ts';
import { changelogSection, withSections } from './notes.ts';
import { SITE_FILES, type SiteContext } from './site.ts';
import { compareVersions, isVersion, readPackageVersion } from './version.ts';
import { parseTestBuildSet, TEST_BUILDS_DIR, type TestBuildSet } from './test-builds.ts';
import { sha256Hex } from './xpi.ts';

export class Checkout {
  readonly root: string;
  readonly exec: Exec;
  readonly target: ReleaseTarget;

  constructor(root: string, exec: Exec, target: ReleaseTarget = releaseTarget()) {
    this.root = root.endsWith(sep) ? root : `${root}${sep}`;
    this.exec = exec;
    this.target = target;
  }

  path(relative: string): string {
    return join(this.root, relative);
  }

  read(relative: string): string {
    return readFileSync(this.path(relative), 'utf8');
  }

  readOrNull(relative: string): string | null {
    return existsSync(this.path(relative)) ? this.read(relative) : null;
  }

  write(relative: string, text: string): void {
    mkdirSync(dirname(this.path(relative)), { recursive: true });
    writeFileSync(this.path(relative), text);
  }

  /** The version in git's apps/extension/package.json: not raised by releases (the tags are), only a floor. */
  version(): string {
    return readPackageVersion(this.read(VERSION_FILE));
  }

  changelog(): Changelog {
    return parseChangelog(this.read(CHANGELOG_FILE));
  }

  /** The files as they are now; the function puts them back (a release writes them only for its build). */
  snapshot(relatives: readonly string[]): () => void {
    const saved = relatives.map((relative) => ({ relative, text: this.readOrNull(relative) }));
    return () => {
      for (const { relative, text } of saved) {
        if (text === null) rmSync(this.path(relative), { force: true });
        else this.write(relative, text);
      }
    };
  }

  // ── git ──

  async git(...args: string[]): Promise<string> {
    return (await mustRun(this.exec, { program: 'git', args, cwd: this.root })).stdout.trim();
  }

  /** The exit code of a git command that answers by it (`rev-parse --verify`, `merge-base --is-ancestor`). */
  async gitCode(...args: string[]): Promise<number> {
    return (await this.exec({ program: 'git', args, cwd: this.root })).code;
  }

  /** true — `older` is `newer` or one of its ancestors. Throws when git cannot tell (a commit it does not have). */
  async isAncestor(older: string, newer: string): Promise<boolean> {
    const code = await this.gitCode('merge-base', '--is-ancestor', older, newer);
    if (code > 1) throw new Error(`git cannot tell whether ${older.slice(0, 12)} is part of ${newer.slice(0, 12)} (merge-base exited ${code}): is the commit fetched?`);
    return code === 0;
  }

  /** The local tag `name`: the commit it points at and whether it is an annotated tag; null — there is none. */
  async tag(name: string): Promise<{ readonly commit: string; readonly annotated: boolean } | null> {
    if ((await this.gitCode('rev-parse', '-q', '--verify', `refs/tags/${name}^{commit}`)) !== 0) return null;
    return { commit: await this.git('rev-parse', `refs/tags/${name}^{commit}`), annotated: (await this.git('cat-file', '-t', `refs/tags/${name}`)) === 'tag' };
  }

  /** The released versions: the tags `vX.Y.Z` here (fetched from origin first), lowest first. */
  async versionTags(): Promise<string[]> {
    const names = (await this.git('tag', '-l', 'v*')).split('\n').map((line) => line.trim().replace(/^v/, ''));
    return names.filter(isVersion).sort(compareVersions);
  }

  /** The subjects of main's own commits after `from` up to `to`, newest first. */
  async subjects(from: string | null, to: string): Promise<string[]> {
    const range = from === null ? [to, '-n', '50'] : [`${from}..${to}`];
    return (await this.git('log', '--first-parent', '--format=%s', ...range)).split('\n').filter((line) => line.trim() !== '');
  }

  /**
   * CHANGELOG.md as git has it, under the sections of every tagged version above
   * its top one and, when given, of the version being released — each made from
   * the commits since the tag before it (notes.ts).
   */
  async changelogText(pending?: { readonly version: string; readonly head: string }): Promise<string> {
    const committed = this.read(CHANGELOG_FILE);
    const top = parseChangelog(committed).sections[0]?.version ?? '0.0.0';
    const tags = await this.versionTags();
    const before = (version: string): string | null => {
      const earlier = tags.filter((tag) => compareVersions(tag, version) < 0).at(-1);
      return earlier === undefined ? null : `v${earlier}`;
    };
    const sections: string[] = [];
    for (const tag of tags.filter((candidate) => compareVersions(candidate, top) > 0)) sections.unshift(changelogSection(tag, await this.subjects(before(tag), `v${tag}`)));
    if (pending !== undefined && !tags.includes(pending.version) && compareVersions(pending.version, top) > 0) sections.unshift(changelogSection(pending.version, await this.subjects(before(pending.version), pending.head)));
    return withSections(committed, sections);
  }

  /** Versions above `latest` that this checkout signed or sent to AMO and that were never tagged. */
  unfinished(latest: string | null): string[] {
    const dir = this.path(RELEASE_DIR);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => isVersion(name) && (latest === null || compareVersions(name, latest) > 0))
      .filter((name) => existsSync(this.paths(name).record) || existsSync(this.paths(name).submitted))
      .sort(compareVersions);
  }

  // ── the site ──

  siteFiles(): Map<string, string> {
    const dir = this.path(SITE_DIR);
    const names = existsSync(dir) ? readdirSync(dir).filter((name) => statSync(join(dir, name)).isFile() && !name.startsWith('.')) : [];
    return new Map(names.sort().map((name) => [name, readFileSync(join(dir, name), 'utf8')]));
  }

  siteContext(version: string = this.version()): SiteContext {
    return { version, target: this.target, changelog: this.changelog() };
  }

  /** File names of the site pages the extension itself opens (apps/extension/src/site.ts). */
  linkedPages(): string[] {
    return Object.values(EXTENSION_LINKS).map((url) => url.slice(url.lastIndexOf('/') + 1));
  }

  /** The files of the site as they go to the server. */
  publishablePages(only: readonly string[] = SITE_FILES): LocalFile[] {
    return only.map((name) => {
      const path = this.path(join(SITE_DIR, name));
      return { name, path, sha256: sha256Hex(readFileSync(path)) };
    });
  }

  // ── vendored packages ──

  vendor(): VendorObservation {
    const json = (relative: string): Record<string, unknown> => JSON.parse(this.read(relative)) as Record<string, unknown>;
    return {
      sdk: json('vendor/kernel-sdk/kernel-sdk.vendor.json'),
      hotkeys: json('vendor/chatgoose-hotkeys/chatgoose-hotkeys.vendor.json'),
      pins: json('tests/vendor-pins.json'),
    };
  }

  // ── the build in .output/ ──

  /** The release build and its two archives, or the reason there is none. */
  build(): { readonly dir: string; readonly version: string; readonly xpi: ArtifactRef & { readonly path: string }; readonly sources: ArtifactRef & { readonly path: string } } {
    const built = builtArtifacts('release', this.path('apps/extension/.output/'));
    if (built.sources === null) throw new Error('the release build has no sources archive.');
    const ref = (path: string): ArtifactRef & { readonly path: string } => {
      const data = readFileSync(path);
      return { path, file: path.slice(path.lastIndexOf(sep) + 1), sha256: sha256Hex(data), bytes: data.length };
    };
    return { dir: built.dir, version: built.version, xpi: ref(built.xpi), sources: ref(built.sources) };
  }

  buildFiles(dir: string): ZipEntry[] {
    return listTree(dir).map((name) => ({ name, data: readFileSync(join(dir, name)) }));
  }

  // ── the records in .release/ ──

  paths(version: string): ReleasePaths {
    return releasePaths(this.root, version);
  }

  gate(version: string): GateRecord | null {
    const path = this.paths(version).gate;
    return existsSync(path) ? parseGateRecord(readFileSync(path, 'utf8')) : null;
  }

  /**
   * Keeps what the last run of the gate ended with: its record, failed checks
   * and all — or, when the run stopped before there was a build to record
   * (null), nothing: the record of an earlier run is removed, so a pass never
   * outlives a later failure. true — an earlier record was removed.
   */
  saveGate(version: string, gate: GateRecord | null): boolean {
    const paths = this.paths(version);
    if (gate === null) {
      const had = existsSync(paths.gate);
      rmSync(paths.gate, { force: true });
      return had;
    }
    mkdirSync(paths.dir, { recursive: true });
    writeFileSync(paths.gate, `${JSON.stringify(gate, null, 2)}\n`);
    return false;
  }

  /** The gate the version was submitted to AMO under (records.ts); null — this checkout never submitted it. */
  submitted(version: string): GateRecord | null {
    const path = this.paths(version).submitted;
    return existsSync(path) ? parseGateRecord(readFileSync(path, 'utf8')) : null;
  }

  saveSubmitted(gate: GateRecord): void {
    const paths = this.paths(gate.version);
    mkdirSync(paths.dir, { recursive: true });
    writeFileSync(paths.submitted, `${JSON.stringify(gate, null, 2)}\n`);
  }

  announced(version: string): AnnouncedRecord | null {
    const path = this.paths(version).announced;
    return existsSync(path) ? parseAnnouncedRecord(readFileSync(path, 'utf8')) : null;
  }

  /** null — the send was refused outright: nothing was posted, nothing to remember. */
  saveAnnounced(version: string, record: Omit<AnnouncedRecord, 'schema' | 'version'> | null): void {
    const paths = this.paths(version);
    if (record === null) {
      rmSync(paths.announced, { force: true });
      return;
    }
    mkdirSync(paths.dir, { recursive: true });
    writeFileSync(paths.announced, `${JSON.stringify({ schema: 1, version, ...record }, null, 2)}\n`);
  }

  record(version: string): ReleaseRecord | null {
    const path = this.paths(version).record;
    return existsSync(path) ? parseReleaseRecord(readFileSync(path, 'utf8')) : null;
  }

  // ── the P3b test builds in .release/test-builds/ ──

  /** The folder of a set of test builds (test-builds.ts), by the version of its N. */
  testBuildsDir(set: string): string {
    return this.path(join(TEST_BUILDS_DIR, set));
  }

  /** The latest set (the highest stamp) with its folder; null — none was made here. */
  latestTestBuildSet(): { readonly dir: string; readonly set: TestBuildSet } | null {
    const root = this.path(TEST_BUILDS_DIR);
    if (!existsSync(root)) return null;
    const stamp = (name: string): number => Number(name.slice(name.lastIndexOf('.') + 1));
    const names = readdirSync(root)
      .filter((name) => existsSync(join(root, name, 'set.json')))
      .sort((a, b) => stamp(a) - stamp(b) || a.localeCompare(b));
    const name = names.at(-1);
    if (name === undefined) return null;
    const dir = join(root, name);
    return { dir, set: parseTestBuildSet(readFileSync(join(dir, 'set.json'), 'utf8')) };
  }
}
