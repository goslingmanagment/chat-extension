import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DONE_PATH, PLAN_PATH } from './matrix.ts';
import { readPlanPrs } from './plan.ts';

const made: string[] = [];
afterEach(() => {
  for (const root of made.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'cg-done-'));
  made.push(root);
  mkdirSync(dirname(join(root, PLAN_PATH)), { recursive: true });
  writeFileSync(join(root, PLAN_PATH), '# Plan\n## 2. PR по этапам\n| P7a ✓ | tap |\n| P7b | page |\n| HF-7д0 | hub |\n');
  return root;
}

describe('the completion state read by parity, coverage and gates', () => {
  it('supports an older branch without a done directory', () => {
    expect(readPlanPrs(fixture()).done).toEqual(new Set(['P7a']));
  });

  it('reads empty files and notes by filename, unions them with legacy marks, and deduplicates', () => {
    const root = fixture();
    mkdirSync(join(root, DONE_PATH));
    writeFileSync(join(root, DONE_PATH, 'P7a'), '');
    writeFileSync(join(root, DONE_PATH, 'P7b'), 'Проверки пройдены.\n');
    writeFileSync(join(root, DONE_PATH, 'HF-7д0'), '');
    expect(readPlanPrs(root)).toEqual({ all: ['P7a', 'P7b', 'HF-7д0'], done: new Set(['P7a', 'P7b', 'HF-7д0']) });
  });

  it.each(['P99', 'P7b.md', 'README.md'])('fails on an unknown done filename: %s', (id) => {
    const root = fixture();
    mkdirSync(join(root, DONE_PATH));
    writeFileSync(join(root, DONE_PATH, id), 'P7b\n');
    expect(() => readPlanPrs(root)).toThrow(`${DONE_PATH}/${id}: unknown PR id`);
  });

  it('does not count a directory or symlink as a done file', () => {
    const root = fixture();
    const path = join(root, DONE_PATH, 'P7b');
    mkdirSync(path, { recursive: true });
    expect(() => readPlanPrs(root)).toThrow('expected a regular done file');
    rmSync(path, { recursive: true });
    symlinkSync(join(root, PLAN_PATH), path);
    expect(() => readPlanPrs(root)).toThrow('expected a regular done file');
  });

  it('does not mistake a malformed done directory for a legacy branch', () => {
    const root = fixture();
    writeFileSync(join(root, DONE_PATH), 'not a directory');
    expect(() => readPlanPrs(root)).toThrow();
  });
});
