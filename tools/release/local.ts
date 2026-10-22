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
import { NOTES_DIR, noteSlug, parseNote, type Note } from './changes.ts';
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
import { changelogMarkdown, historyOf, type History } from './notes.ts';
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

  /** main's own commits after `from` up to `to` (newest first): the subject, and whether the commit added or changed a note. */
  async commitsWithNotes(from: string | null, to: string): Promise<Array<{ readonly subject: string; readonly note: boolean }>> {
    const range = from === null ? [to, '-n', '50'] : [`${from}..${to}`];
    const out = await this.git('log', '--first-parent', '--format=%x01%s', '--name-only', ...range, '--');
    return out
      .split('\x01')
      .filter((chunk) => chunk.trim() !== '')
      .map((chunk) => {
        const [subject = '', ...files] = chunk.split('\n');
        return { subject, note: files.some((file) => file.startsWith(`${NOTES_DIR}/`) && noteSlug(file.slice(NOTES_DIR.length + 1)) !== null) };
      });
  }

  // ── the notes of changes (changes/) ──

  /** Every note in the tree by its slug; throws on the first one that does not parse (changes.ts). */
  notes(): Map<string, Note> {
    const dir = this.path(NOTES_DIR);
    const notes = new Map<string, Note>();
    if (!existsSync(dir)) return notes;
    for (const name of readdirSync(dir).sort()) {
      const slug = noteSlug(name);
      if (slug === null) continue;
      const size = (file: string): number | null => (existsSync(join(dir, file)) ? statSync(join(dir, file)).size : null);
      notes.set(slug, parseNote(slug, readFileSync(join(dir, name), 'utf8'), size));
    }
    return notes;
  }

  /** The problems of the notes in the tree, each with its file; [] — all of them parse. */
  noteProblems(): string[] {
    const dir = this.path(NOTES_DIR);
    if (!existsSync(dir)) return [];
    const problems: string[] = [];
    for (const name of readdirSync(dir).sort()) {
      const slug = noteSlug(name);
      if (slug === null) {
        if (name !== 'README.md' && !name.startsWith('_') && !/\.(?:png|jpe?g)$/.test(name)) problems.push(`${NOTES_DIR}/${name}: neither a note (.md) nor its screenshot (.png, .jpg)`);
        continue;
      }
      const size = (file: string): number | null => (existsSync(join(dir, file)) ? statSync(join(dir, file)).size : null);
      try {
        parseNote(slug, readFileSync(join(dir, name), 'utf8'), size);
      } catch (error) {
        problems.push(error instanceof Error ? error.message : String(error));
      }
    }
    return problems;
  }

  /** The slugs of the notes added to main after `from` up to `to`, in the order they came. */
  async notesAdded(from: string | null, to: string): Promise<string[]> {
    const range = from === null ? [to] : [`${from}..${to}`];
    const out = await this.git('log', '--first-parent', '--reverse', '--diff-filter=A', '--no-renames', '--format=', '--name-only', ...range, '--', `${NOTES_DIR}/`);
    const slugs = out
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith(`${NOTES_DIR}/`) && !line.slice(NOTES_DIR.length + 1).includes('/'))
      .flatMap((line) => {
        const slug = noteSlug(line.slice(NOTES_DIR.length + 1));
        return slug === null ? [] : [slug];
      });
    return [...new Set(slugs)];
  }

  /** The day a tag's commit was made, YYYY-MM-DD. */
  async tagDay(version: string): Promise<string> {
    return this.git('log', '-1', '--format=%cs', `v${version}^{commit}`);
  }

  /**
   * The history (notes.ts): the hand-written sections of CHANGELOG.md, under the
   * releases of notes of every tagged version above its top one and, when
   * given, of the version being released — each made of the notes added since
   * the tag before it, as the tree has them now. Throws on a note that does not parse.
   */
  async history(pending?: { readonly version: string; readonly head: string; readonly day: string; readonly uncommitted?: boolean }): Promise<History> {
    const changelog = this.changelog();
    const top = changelog.sections[0]?.version ?? '0.0.0';
    const tags = await this.versionTags();
    const all = this.notes();
    const before = (version: string): string | null => {
      const earlier = tags.filter((tag) => compareVersions(tag, version) < 0).at(-1);
      return earlier === undefined ? null : `v${earlier}`;
    };
    // A version's notes: those added since the tag before it that wait for no other version, and those held for it.
    const notesOf = async (version: string, from: string | null, to: string): Promise<Note[]> => [
      ...(await this.notesAdded(from, to)).flatMap((slug) => all.get(slug) ?? []).filter((note) => note.release === null),
      ...heldFor(all, version),
    ];
    const later: Array<{ version: string; date: string | null; notes: Note[] }> = [];
    for (const tag of tags.filter((candidate) => compareVersions(candidate, top) > 0)) later.unshift({ version: tag, date: await this.tagDay(tag), notes: await notesOf(tag, before(tag), `v${tag}`) });
    if (pending !== undefined && !tags.includes(pending.version) && compareVersions(pending.version, top) > 0) {
      const regular = await this.pendingNotes(pending.head, { all, uncommitted: pending.uncommitted ?? false });
      later.unshift({ version: pending.version, date: pending.day, notes: [...regular, ...heldFor(all, pending.version)] });
    }
    return historyOf(changelog, later);
  }

  /**
   * The notes no tag holds yet: those committed since the last tag up to `head`, in the order they came, and with
   * `uncommitted` (a preview) those only in the working tree — a note being written — by name. Notes held for a
   * version (`release:`) are not among them: `heldFor` gives them to their version.
   */
  async pendingNotes(head: string, options: { readonly all?: ReadonlyMap<string, Note>; readonly uncommitted?: boolean } = {}): Promise<Note[]> {
    const all = options.all ?? this.notes();
    const latest = (await this.versionTags()).at(-1);
    const released = new Set(latest === undefined ? [] : await this.notesAdded(null, `v${latest}`));
    const committed = (await this.notesAdded(latest === undefined ? null : `v${latest}`, head)).filter((slug) => !released.has(slug));
    const fresh = options.uncommitted === true ? [...all.keys()].filter((slug) => !released.has(slug) && !committed.includes(slug)) : [];
    return [...committed, ...fresh].flatMap((slug) => all.get(slug) ?? []).filter((note) => note.release === null);
  }

  /** The versions some note in the tree is held for, lowest first. */
  heldVersions(all: ReadonlyMap<string, Note> = this.notes()): string[] {
    return [...new Set([...all.values()].flatMap((note) => (note.release === null ? [] : [note.release])))].sort(compareVersions);
  }

  /** CHANGELOG.md as the build of a release holds it: git's hand-written sections under the releases of notes. */
  changelogText(history: History): string {
    return changelogMarkdown(this.read(CHANGELOG_FILE), history);
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

  siteContext(version: string, history: History): SiteContext {
    return { version, target: this.target, history };
  }

  /** File names of the site pages the extension itself opens (apps/extension/src/site.ts). */
  linkedPages(): string[] {
    return Object.values(EXTENSION_LINKS).map((url) => url.slice(url.lastIndexOf('/') + 1));
  }

  /** The files of the site as they go to the server, and the notes' screenshots under changes/. */
  publishablePages(only: readonly string[] = SITE_FILES, images: readonly string[] = []): LocalFile[] {
    const pages = only.map((name) => {
      const path = this.path(join(SITE_DIR, name));
      return { name, path, sha256: sha256Hex(readFileSync(path)) };
    });
    const shots = images.map((file) => {
      const path = this.path(join(NOTES_DIR, file));
      return { name: `${NOTES_DIR}/${file}`, path, sha256: sha256Hex(readFileSync(path)) };
    });
    return [...shots, ...pages];
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

/** The notes held for `version` (`release:` in their fields), by name. */
export function heldFor(all: ReadonlyMap<string, Note>, version: string): Note[] {
  return [...all.values()].filter((note) => note.release === version);
}
