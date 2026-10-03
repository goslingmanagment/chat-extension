import { describe, expect, it } from 'vitest';

import type { ZipEntry } from '../lib/zip.ts';
import { checkArchive, compareWithBuild } from './rules.ts';

const entry = (name: string, text = ''): ZipEntry => ({ name, data: Buffer.from(text) });

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
        entry('fixtures/chat.json', '{"chatId":518588958}'),
        entry('fonts/inter.woff2'),
        entry('img/avatar.jpg'),
        entry('lazy/a.js.map', '{}'),
        entry('config.js', 'const t="Bearer abcdefghijklmnopqrstuvwxyz0123"'),
      ],
      'xpi',
    );
    expect(problems.map((problem) => problem.rule).sort()).toEqual(
      ['forbidden-file', 'foreign-image', 'onlymonster-code', 'onlymonster-code', 'real-data', 'real-data', 'sourcemap'].sort(),
    );
  });

  it('notices files smuggled into or missing from the XPI', () => {
    const problems = compareWithBuild('x.zip', [entry('a.js'), entry('extra.js')], ['a.js', 'b.js']);
    expect(problems.map((problem) => [problem.rule, problem.file])).toEqual([
      ['extra-file', 'extra.js'],
      ['missing-file', 'b.js'],
    ]);
  });
});
