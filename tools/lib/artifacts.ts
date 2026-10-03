// The zip artifacts of the LAST build of a flavor, picked by the version in its
// freshly built manifest.json — never "the first zip in .output/". The build
// removes older archives of its flavor (wxt.config.ts `zip:start`); anything
// else lying around means the archives and the build dir disagree.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { artifactNames, isFlavorArtifact } from '../../apps/extension/build/artifacts.ts';
import type { BuildFlavor } from '../../apps/extension/build/manifest.ts';
import { OUTPUT_ROOT } from './paths.ts';

export interface BuiltArtifacts {
  readonly flavor: BuildFlavor;
  /** The build dir the archives were zipped from. */
  readonly dir: string;
  readonly version: string;
  /** Absolute path of the XPI. */
  readonly xpi: string;
  /** Absolute path of the AMO sources archive (release only). */
  readonly sources: string | null;
}

/** Throws with a human-readable reason when the archives are missing, stale or ambiguous. */
export function builtArtifacts(flavor: BuildFlavor, outputRoot: string = OUTPUT_ROOT): BuiltArtifacts {
  const dir = join(outputRoot, flavor === 'test' ? 'firefox-mv3-test' : 'firefox-mv3');
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`${flavor} build missing (${manifestPath}) — run the build first.`);
  const version = (JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: unknown }).version;
  if (typeof version !== 'string' || version === '') throw new Error(`${manifestPath} has no version.`);

  const names = artifactNames(version, flavor);
  const expected = flavor === 'release' ? [names.xpi, names.sources] : [names.xpi];
  const found = readdirSync(outputRoot).filter((name) => isFlavorArtifact(name, flavor));
  const missing = expected.filter((name) => !found.includes(name));
  const extra = found.filter((name) => !expected.includes(name));
  if (missing.length > 0) throw new Error(`${flavor} archives for version ${version} missing: ${missing.join(', ')} — run the build first.`);
  if (extra.length > 0) throw new Error(`stale ${flavor} archives next to version ${version}: ${extra.join(', ')} — rebuild (it removes them).`);
  return {
    flavor,
    dir,
    version,
    xpi: join(outputRoot, names.xpi),
    sources: flavor === 'release' ? join(outputRoot, names.sources) : null,
  };
}
