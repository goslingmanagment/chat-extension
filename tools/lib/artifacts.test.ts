import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { builtArtifacts } from './artifacts.ts';

let root = '';

function output(version: string, zips: readonly string[], flavorDir = 'firefox-mv3'): string {
  root = mkdtempSync(join(tmpdir(), 'cg-artifacts-'));
  mkdirSync(join(root, flavorDir));
  writeFileSync(join(root, flavorDir, 'manifest.json'), JSON.stringify({ version }));
  for (const zip of zips) writeFileSync(join(root, zip), '');
  return root;
}

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('builtArtifacts', () => {
  it('picks the archives named by the built manifest version', () => {
    const dir = output('0.1.1', ['chatgoose-chatspace-0.1.1-firefox.zip', 'chatgoose-chatspace-0.1.1-sources.zip', 'chatgoose-chatspace-0.1.0-firefox-test.zip']);
    const built = builtArtifacts('release', dir);
    expect(built.version).toBe('0.1.1');
    expect(built.xpi).toBe(join(dir, 'chatgoose-chatspace-0.1.1-firefox.zip'));
    expect(built.sources).toBe(join(dir, 'chatgoose-chatspace-0.1.1-sources.zip'));
  });

  it('refuses an older version left next to the new build', () => {
    const dir = output('0.1.1', [
      'chatgoose-chatspace-0.1.0-firefox.zip',
      'chatgoose-chatspace-0.1.0-sources.zip',
      'chatgoose-chatspace-0.1.1-firefox.zip',
      'chatgoose-chatspace-0.1.1-sources.zip',
    ]);
    expect(() => builtArtifacts('release', dir)).toThrow(/stale release archives.*0\.1\.0-firefox\.zip/);
  });

  it('refuses when only an older version exists (the new build never zipped)', () => {
    const dir = output('0.1.1', ['chatgoose-chatspace-0.1.0-firefox.zip', 'chatgoose-chatspace-0.1.0-sources.zip']);
    expect(() => builtArtifacts('release', dir)).toThrow(/version 0\.1\.1 missing/);
  });

  it('handles the test flavor on its own', () => {
    const dir = output('0.2.0', ['chatgoose-chatspace-0.2.0-firefox-test.zip', 'chatgoose-chatspace-0.1.0-firefox.zip'], 'firefox-mv3-test');
    expect(builtArtifacts('test', dir)).toMatchObject({ version: '0.2.0', sources: null, xpi: join(dir, 'chatgoose-chatspace-0.2.0-firefox-test.zip') });
  });
});
