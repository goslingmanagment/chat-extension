// Names of the zip artifacts a build leaves in .output/ (the XPI and, for a
// release, the AMO sources archive). wxt.config.ts fills them in as WXT's zip
// templates; tools/archive-check opens exactly the pair named by the version
// in the freshly built manifest, never "the first zip it finds" (an older
// version's archives would otherwise be checked instead).
//
// Relative imports carry `.ts`: this file also runs under plain Node 26.

import type { BuildFlavor } from './manifest.ts';

export const ARTIFACT_PREFIX = 'chatgoose-chatspace-';

export interface ArtifactNames {
  /** The extension itself (an XPI is a zip). */
  readonly xpi: string;
  /** The AMO sources archive (release builds only make it). */
  readonly sources: string;
}

const flavorSuffix = (flavor: BuildFlavor): string => (flavor === 'test' ? '-test' : '');

/** `version` may be WXT's `{{version}}` placeholder (wxt.config.ts) or a real version. */
export function artifactNames(version: string, flavor: BuildFlavor): ArtifactNames {
  const suffix = flavorSuffix(flavor);
  return {
    xpi: `${ARTIFACT_PREFIX}${version}-firefox${suffix}.zip`,
    sources: `${ARTIFACT_PREFIX}${version}-sources${suffix}.zip`,
  };
}

/** True for an archive of this flavor, any version (the build removes stale ones). */
export function isFlavorArtifact(name: string, flavor: BuildFlavor): boolean {
  const suffix = flavorSuffix(flavor);
  return name.startsWith(ARTIFACT_PREFIX) && (name.endsWith(`-firefox${suffix}.zip`) || name.endsWith(`-sources${suffix}.zip`));
}
