import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { ZipEntry } from '../lib/zip.ts';
import { checkArchive, compareWithBuild, REAL_ID_SHA256, sha256 } from './rules.ts';

const entry = (name: string, text = ''): ZipEntry => ({ name, data: Buffer.from(text) });
/** A synthetic "real" id: tests never carry the owner's ids. */
const SYNTHETIC_ID = '123456789';
const syntheticHashes = new Set([sha256(SYNTHETIC_ID)]);

describe('archive check', () => {
  it('passes our own build', () => {
    expect(checkArchive('x.zip', [entry('background.js', 'console.log(1)'), entry('icons/48.png')], 'xpi')).toEqual([]);
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
