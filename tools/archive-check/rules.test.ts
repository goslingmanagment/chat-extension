import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { ZipEntry } from '../lib/zip.ts';
import { isStandSource, STAND_SOURCE_GLOBS, STAND_SOURCE_KEPT } from '../../apps/extension/build/sources-archive.ts';
import { checkArchive, compareWithBuild, danglingReferences, MAX_BACKGROUND_JS_BYTES, MAX_JS_BYTES, REAL_ID_SHA256, sha256 } from './rules.ts';

const entry = (name: string, text = ''): ZipEntry => ({ name, data: Buffer.from(text) });
/** A synthetic "real" id: tests never carry the owner's ids. */
const SYNTHETIC_ID = '123456789';
const syntheticHashes = new Set([sha256(SYNTHETIC_ID)]);

describe('archive check', () => {
  it('passes our own build', () => {
    expect(checkArchive('x.zip', [entry('background.js', 'console.log(1)'), entry('icons/48.png')], 'xpi')).toEqual([]);
  });

  it('a script of the XPI over its ceiling is flagged: 400 KiB for any file, the background (the vendored hub SDK lives there) has its own', () => {
    const sized = (name: string, bytes: number): ZipEntry => ({ name, data: Buffer.alloc(bytes, 0x61) });
    const rules = (entries: ZipEntry[], kind: 'xpi' | 'sources' = 'xpi'): string[] => checkArchive('x.zip', entries, kind).map((problem) => `${problem.rule}:${problem.file}`);
    expect(rules([sized('lazy/dock.js', MAX_JS_BYTES), sized('background.js', MAX_BACKGROUND_JS_BYTES)])).toEqual([]);
    expect(rules([sized('lazy/dock.js', MAX_JS_BYTES + 1), sized('content-scripts/chatspace.js', MAX_JS_BYTES + 1), sized('background.js', MAX_BACKGROUND_JS_BYTES + 1)])).toEqual([
      'oversized-js:lazy/dock.js',
      'oversized-js:content-scripts/chatspace.js',
      'oversized-js:background.js',
    ]);
    // Only the file at the root of the XPI is the background; the rule is about what ships.
    expect(rules([sized('lazy/background.js', MAX_JS_BYTES + 1)])).toEqual(['oversized-js:lazy/background.js']);
    expect(rules([sized('background.js', MAX_BACKGROUND_JS_BYTES + 1)], 'sources')).toEqual([]);
    expect(MAX_BACKGROUND_JS_BYTES).toBeGreaterThan(MAX_JS_BYTES);
  });

  it('flags OnlyMonster code, real data, fonts, foreign images and sourcemaps', () => {
    const problems = checkArchive(
      'x.zip',
      [
        entry('lazy/a.js', 'import "./messages-DlBZ5e81.js"'),
        entry('lazy/b.css', '.x[data-v-1a2b3c4d]{color:red}'),
        entry('fixtures/chat.json', `{"chatId":${SYNTHETIC_ID}}`),
        entry('fonts/inter.woff2'),
        entry('img/avatar.jpg'),
        entry('lazy/a.js.map', '{}'),
        entry('config.js', 'const t="Bearer abcdefghijklmnopqrstuvwxyz0123"'),
      ],
      'xpi',
      { realIdHashes: syntheticHashes },
    );
    expect(problems.map((problem) => problem.rule).sort()).toEqual(
      ['forbidden-file', 'foreign-image', 'onlymonster-code', 'onlymonster-code', 'real-data', 'real-data', 'sourcemap'].sort(),
    );
  });

  it('keeps the stand and its e2e harness out of the sources archive; only the testing manifest and the lockfile may name Vue/TipTap there', () => {
    const tiptap = "import { Editor } from '@tiptap/core';";
    const rules = (name: string, kind: 'xpi' | 'sources', text = tiptap): string[] => checkArchive('a.zip', [entry(name, text)], kind).map((problem) => problem.rule);
    expect(rules('packages/testing/package.json', 'sources', '{"@tiptap/core": "3.31.4"}')).toEqual([]);
    expect(rules('pnpm-lock.yaml', 'sources', "'@tiptap/core@3.31.4':")).toEqual([]);
    for (const stand of [
      'packages/testing/fixture-chatspace.vite.config.ts',
      'packages/testing/src/stand-server.ts',
      'packages/testing/src/stand-cli.ts',
      'packages/testing/src/fixture/queue.dom.test.ts',
      'packages/testing/src/stand/api.ts',
      'packages/testing/src/stand/index.ts',
      'packages/testing/stand/stand.js',
      'packages/testing/e2e/wdio.conf.ts',
      'packages/testing/e2e/support/fake-hub.ts',
      'packages/testing/fixture-chatspace/index.html',
      'packages/testing/fixture-chatspace/src/main.ts',
    ]) {
      expect(rules(stand, 'sources', 'export {};'), stand).toEqual(['stand-in-sources']);
    }
    // For `tsc -b` in the archive: the fixture's tsconfig and its wire-protocol types stay.
    for (const kept of STAND_SOURCE_KEPT) expect(rules(kept, 'sources', '{}'), kept).toEqual([]);
    expect(STAND_SOURCE_GLOBS).toEqual(expect.arrayContaining(['packages/testing/e2e/**', 'packages/testing/fixture-chatspace/src/!(protocol.ts)', 'packages/testing/fixture-chatspace/src/*/**']));
    expect(isStandSource('packages/testing/fixture-chatspace/src/protocol.ts')).toBe(false);
    expect(rules('packages/testing/fixture-chatspace/src/ui/editor.ts', 'sources')).toEqual(['stand-in-sources', 'onlymonster-code']);
    // The fake hub stays: it names no host library.
    expect(rules('packages/testing/src/fake-hub/hub.ts', 'sources', 'export {};')).toEqual([]);
    expect(rules('packages/testing/src/standalone.ts', 'sources', 'export {};')).toEqual([]);
    // Anywhere else, and in the XPI, it is foreign library code.
    expect(rules('packages/ui/src/editor.ts', 'sources')).toEqual(['onlymonster-code']);
    expect(rules('packages/testing/fixture-chatspace/src/ui/editor.ts', 'xpi')).toEqual(['onlymonster-code']);
  });

  it('keeps every stand folder to hand-written sources, should it travel again: no saved bundles, API answers, pages or notes', () => {
    const provenance = (name: string, text = '{}'): string[] =>
      checkArchive('a.zip', [entry(name, text)], 'xpi')
        .map((problem) => problem.rule)
        .filter((rule) => rule === 'fixture-provenance');
    expect(provenance('packages/testing/fixture-chatspace/tsconfig.json')).toEqual([]);
    expect(provenance('packages/testing/stand/stand.js', '(function () {})();')).toEqual([]);
    expect(provenance('packages/testing/src/stand/api.ts', 'export {};')).toEqual([]);
    for (const saved of [
      'packages/testing/fixture-chatspace/assets/index-abc.js',
      'packages/testing/fixture-chatspace/src/chats.json',
      'packages/testing/fixture-chatspace/notes.md',
      'packages/testing/stand/chat-list.json',
      'packages/testing/stand/page.md',
      'packages/testing/src/stand/answer.json',
      'packages/testing/src/stand/history.html',
    ]) {
      expect(provenance(saved), saved).toEqual(['fixture-provenance']);
    }
  });

  it('finds an import, a workspace export or a tsconfig reference that points out of the sources archive', () => {
    const files = [
      entry('packages/x/package.json', JSON.stringify({ name: '@cg/x', exports: { '.': './src/index.ts', './stand': './src/stand/index.ts', './data/*': './src/data/*.ts' } })),
      entry('packages/x/src/index.ts', "export * from './present';\nexport * from './gone';\nexport { y } from './lib.js';\nexport { z } from './dir';"),
      entry('packages/x/src/present.ts', 'export const a = 1;'),
      entry('packages/x/src/lib.ts', 'export const y = 1;'),
      entry('packages/x/src/dir/index.ts', 'export const z = 1;'),
      entry('packages/x/src/data/one.ts', 'export const one = 1;'),
      entry('packages/x/tsconfig.json', '{ "extends": "../../tsconfig.base.json", "references": [{ "path": "./fixture" }, { "path": "../../tools" }] }'),
      entry('tsconfig.base.json', '{}'),
      entry('apps/a/src/main.ts', "import '@cg/x';\nimport { s } from '@cg/x/stand';\nimport { n } from '@cg/x/nope';\nimport { one } from '@cg/x/data/one';\nimport { describe } from 'vitest';\nconst lazy = () => import('./later');\n/// <reference path=\"./types.d.ts\" />"),
      entry('apps/a/src/types.d.ts', 'export {};'),
    ];
    expect(danglingReferences('s.zip', files).map((problem) => [problem.file, problem.detail])).toEqual([
      ['packages/x/src/index.ts', 'import «./gone» is not in the archive'],
      ['packages/x/tsconfig.json', 'tsconfig reference «./fixture» is not in the archive'],
      ['packages/x/tsconfig.json', 'tsconfig reference «../../tools» is not in the archive'],
      ['apps/a/src/main.ts', 'import «@cg/x/stand» is not in the archive'],
      ['apps/a/src/main.ts', 'import «@cg/x/nope» is not in the archive'],
      ['apps/a/src/main.ts', 'import «./later» is not in the archive'],
    ]);
    expect(checkArchive('s.zip', files, 'sources').filter((problem) => problem.rule === 'dangling-import')).toHaveLength(6);
    expect(checkArchive('x.zip', files, 'xpi').filter((problem) => problem.rule === 'dangling-import')).toEqual([]);
  });

  it('finds a real id by hash anywhere a number stands alone, not inside longer numbers', () => {
    const scan = (text: string): string[] =>
      checkArchive('s.zip', [entry('a.ts', text)], 'sources', { realIdHashes: syntheticHashes }).map((problem) => problem.rule);
    expect(scan(`export const CHAT = '${SYNTHETIC_ID}';`)).toEqual(['real-data']);
    expect(scan(`see chat ${SYNTHETIC_ID}.`)).toEqual(['real-data']);
    expect(scan(`const x = 9${SYNTHETIC_ID}0; const h = 'ab${SYNTHETIC_ID}';`)).toEqual([]);
  });

  it('scans its own rule files for real data (only the OnlyMonster markers are exempt there)', () => {
    const problems = checkArchive(
      's.zip',
      [entry('tools/archive-check/rules.ts', `const ids = [${SYNTHETIC_ID}]; const m = /messages-DlBZ5e81/;`)],
      'sources',
      { realIdHashes: syntheticHashes },
    );
    expect(problems.map((problem) => problem.rule)).toEqual(['real-data']);
  });

  it('the shipped hashes are the X9 test account and chat (recomputed from the decision log)', () => {
    // docs/ is not in the sources archive; this check runs in the repo only.
    const decisions = fileURLToPath(new URL('../../docs/decisions.md', import.meta.url));
    if (!existsSync(decisions)) return;
    const x9 = /аккаунт OnlyMonster (\d+) → чат (\d+)/.exec(readFileSync(decisions, 'utf8'));
    expect(x9).not.toBeNull();
    const ids = [x9?.[1] ?? '', x9?.[2] ?? ''];
    expect(new Set(ids.map(sha256))).toEqual(REAL_ID_SHA256);
  });

  it('notices files smuggled into, missing from or changed in the XPI', () => {
    const problems = compareWithBuild(
      'x.zip',
      [entry('a.js', 'same'), entry('c.js', 'old build'), entry('extra.js')],
      [entry('a.js', 'same'), entry('b.js'), entry('c.js', 'new build')],
    );
    expect(problems.map((problem) => [problem.rule, problem.file])).toEqual([
      ['changed-file', 'c.js'],
      ['extra-file', 'extra.js'],
      ['missing-file', 'b.js'],
    ]);
  });
});
