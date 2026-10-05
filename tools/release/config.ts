// What a release is made of and where it goes (architecture.md §13). Every
// public address comes from the manifest policy and the extension's own site
// map — the tool cannot publish to a place the built extension does not look
// at. What is private to the owner (the server login, the folder on it, the AMO
// and Telegram keys) is read from the environment at run time and is named
// here only by the variable.

import { fileURLToPath } from 'node:url';

import { ARTIFACT_PREFIX } from '../../apps/extension/build/artifacts.ts';
import { GECKO_ID, STRICT_MIN_VERSION, UPDATE_URL } from '../../apps/extension/build/manifest.ts';
import { HUB_HOST_PERMISSION } from '../../apps/extension/src/hosts.ts';
import { SITE_BASE } from '../../apps/extension/src/site.ts';

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The one place the version lives: WXT copies it into the manifest. */
export const VERSION_FILE = 'apps/extension/package.json';
export const CHANGELOG_FILE = 'CHANGELOG.md';
/** How to rebuild the XPI from the sources archive, for Mozilla's reviewers; it travels in that archive. */
export const BUILD_INSTRUCTIONS = 'BUILD.md';
export const SITE_DIR = 'site';
/** The manual checklist of a release, with its ticks (§12 п. 8: «галочки в заметке выпуска»). */
export const noteFile = (version: string): string => `docs/releases/${version}.md`;
/** Signed XPIs and the records of a release: outside .output/, which every build cleans. Never committed. */
export const RELEASE_DIR = '.release';

export interface ReleaseTarget {
  readonly geckoId: string;
  readonly strictMinVersion: string;
  /** The folder of the site, with a trailing slash. */
  readonly siteBase: string;
  /** The folder of the update feed, with a trailing slash (inside the site). */
  readonly feedBase: string;
  readonly feedUrl: string;
  /** The folder of the feed relative to the site folder, no slashes around: where it lies on the server. */
  readonly feedDir: string;
  /** The hub the release must be compatible with. */
  readonly hubOrigin: string;
}

function folderOf(url: string): string {
  return url.slice(0, url.lastIndexOf('/') + 1);
}

export function releaseTarget(overrides: Partial<Pick<ReleaseTarget, 'siteBase' | 'hubOrigin'>> = {}): ReleaseTarget {
  const feedDir = folderOf(UPDATE_URL).slice(SITE_BASE.length).replace(/\/$/, '');
  const feedName = UPDATE_URL.slice(UPDATE_URL.lastIndexOf('/') + 1);
  if (!UPDATE_URL.startsWith(SITE_BASE) || feedDir === '' || feedDir.includes('..')) {
    throw new Error(`release: the update feed (${UPDATE_URL}) must lie in a folder inside the site (${SITE_BASE}).`);
  }
  const siteBase = overrides.siteBase ?? SITE_BASE;
  return {
    geckoId: GECKO_ID,
    strictMinVersion: STRICT_MIN_VERSION,
    siteBase,
    feedBase: `${siteBase}${feedDir}/`,
    feedUrl: `${siteBase}${feedDir}/${feedName}`,
    feedDir,
    hubOrigin: overrides.hubOrigin ?? HUB_HOST_PERMISSION.replace(/\/\*$/, ''),
  };
}

export const FEED_FILE = UPDATE_URL.slice(UPDATE_URL.lastIndexOf('/') + 1);
/** The feed the swap replaced, kept next to it. */
export const FEED_PREVIOUS_FILE = 'updates.previous.json';
export const HUB_HEALTH_PATH = '/api/v1/health';

/** The signed XPI as it is served: one immutable file per version. */
export const signedXpiName = (version: string): string => `${ARTIFACT_PREFIX}${version}.xpi`;
/** The record of a release, served next to its XPI (sha256, source commit, SDK hash). */
export const recordName = (version: string): string => `${ARTIFACT_PREFIX}${version}.json`;

/** Environment variables the outward steps read. Values never go to the repository, a log or a command line. */
export const ENV = {
  /** AMO API credentials, read by web-ext itself (JWT issuer and JWT secret). */
  amoKey: 'WEB_EXT_API_KEY',
  amoSecret: 'WEB_EXT_API_SECRET',
  /** SSH destination of the server that serves the site, as ssh takes it (user@host or a Host from ~/.ssh/config). */
  ssh: 'CG_RELEASE_SSH',
  /** Absolute path of the folder on that server served as the site folder. */
  remoteDir: 'CG_RELEASE_REMOTE_DIR',
  telegramToken: 'TELEGRAM_BOT_TOKEN',
  telegramChannel: 'TELEGRAM_CHANNEL_ID',
  /** owner/repo of the hub on GitHub, for the «vendored from hub main» check (default below). */
  hubRepo: 'CG_HUB_REPO',
} as const;

export const DEFAULT_HUB_REPO = 'goslingmanagment/hub';
