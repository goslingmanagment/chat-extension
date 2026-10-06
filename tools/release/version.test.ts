import { describe, expect, it } from 'vitest';

import { bumpVersion, compareVersions, isVersion, parseVersion, readPackageVersion, setPackageVersion } from './version.ts';

const PACKAGE = ['{', '  "name": "@cg/extension",', '  "version": "0.1.0",', '  "private": true,', '  "dependencies": {', '    "zod": "4.6.5"', '  }', '}', ''].join('\n');

describe('versions', () => {
  it('a version is three numbers without leading zeros', () => {
    for (const good of ['0.1.0', '1.0.0', '10.20.30', '0.0.999999999']) expect(isVersion(good), good).toBe(true);
    for (const bad of ['1.0', '1.0.0.0', '01.0.0', '1.0.0-beta', 'v1.0.0', '1.0.x', '', '1.0.1000000000']) expect(isVersion(bad), bad).toBe(false);
    expect(() => parseVersion('1.0')).toThrow(/not a version/);
  });

  it('compares part by part as numbers, the way Firefox does', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBeGreaterThan(0);
    expect(compareVersions('0.2.0', '0.10.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
  });

  it('bumps', () => {
    expect(bumpVersion('0.1.9', 'patch')).toBe('0.1.10');
    expect(bumpVersion('0.1.9', 'minor')).toBe('0.2.0');
    expect(bumpVersion('0.1.9', 'major')).toBe('1.0.0');
  });

  it('[UP-006] changes the one version line of package.json and nothing else', () => {
    const next = setPackageVersion(PACKAGE, '0.1.1');
    expect(readPackageVersion(next)).toBe('0.1.1');
    expect(next).toBe(PACKAGE.replace('"version": "0.1.0"', '"version": "0.1.1"'));
    // A dependency pinned at the same number is not the version.
    expect(setPackageVersion(PACKAGE.replace('"zod": "4.6.5"', '"version": "0.1.0"'), '0.2.0')).toContain('    "version": "0.1.0"');
  });

  it('[UP-003] a version never goes down and is never reused', () => {
    expect(() => setPackageVersion(PACKAGE, '0.1.0')).toThrow(/not higher/);
    expect(() => setPackageVersion(PACKAGE, '0.0.9')).toThrow(/not higher/);
    expect(() => setPackageVersion(PACKAGE, '0.2')).toThrow(/not a version/);
    expect(() => setPackageVersion('{\n  "name": "x"\n}\n', '0.2.0')).toThrow(/exactly one/);
    expect(() => readPackageVersion('{"version":"1.0"}')).toThrow(/not X\.Y\.Z/);
  });
});
