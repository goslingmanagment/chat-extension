// What a release is made of and where it goes (architecture.md §13). Every
// public address comes from the manifest policy and the extension's own site
// map — the tool cannot publish to a place the built extension does not look
// at. What is private to the owner (the server login, the folder on it, the AMO
// and Telegram keys) is read from the environment at run time and is named
// here only by the variable.

import { fileURLToPath } from 'node:url';

import { ARTIFACT_PREFIX } from '../../apps/extension/build/artifacts.ts';
import { GECKO_ID, STRICT_MIN_VERSION, UPDATE_URL } from '../../apps/extension/build/manifest.ts';
import { HOSTS, HUB_HOST_PERMISSION } from '../../apps/extension/src/hosts/index.ts';
import { SITE_BASE } from '../../apps/extension/src/site.ts';

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The one place the version lives: WXT copies it into the manifest. */
export const VERSION_FILE = 'apps/extension/package.json';
export const CHANGELOG_FILE = 'CHANGELOG.md';
/** How to rebuild the XPI from the sources archive, for Mozilla's reviewers; it travels in that archive. */
export const BUILD_INSTRUCTIONS = 'BUILD.md';
export const SITE_DIR = 'site';
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

/**
 * The optional sites' permissions (the host registry's): asked for on a gesture, never at install. The P3b test builds
 * (test-builds.ts) leave them out of N0 and move the origins into host_permissions in the control.
 */
export const OPTIONAL_SITE_ORIGINS: readonly string[] = HOSTS.filter((host) => host.permissions.optional).flatMap((host) => host.permissions.origins);
export const OPTIONAL_SITE_API: readonly string[] = [...new Set(HOSTS.filter((host) => host.permissions.optional).flatMap((host) => host.permissions.api ?? []))];

export const FEED_FILE = UPDATE_URL.slice(UPDATE_URL.lastIndexOf('/') + 1);
/** The feed the swap replaced, kept next to it. */
export const FEED_PREVIOUS_FILE = 'updates.previous.json';
export const HUB_HEALTH_PATH = '/api/v1/health';

/**
 * The signed XPI of a version signed now, as it is served: one immutable file per version. A version signed before
 * the rename keeps its name on the server and in its record (`xpi.file`) forever — read it from there, never from here.
 */
export const signedXpiName = (version: string): string => `${ARTIFACT_PREFIX}${version}.xpi`;
/** The prefix of the files of every version signed before the rename (2026-10-25): `chatgoose-chatspace-0.10.5.xpi`. */
export const LEGACY_ARTIFACT_PREFIX = 'chatgoose-chatspace-';
/** The names a version's signed XPI may carry: today's first, then the one of a version signed before the rename. */
export const signedXpiNames = (version: string): readonly string[] => [signedXpiName(version), `${LEGACY_ARTIFACT_PREFIX}${version}.xpi`];
/** The record of a release (sha256, source commit, SDK hash), served next to its XPI under the XPI's name with .json. */
export const recordNameOf = (xpiFile: string): string => `${xpiFile.replace(/\.xpi$/, '')}.json`;
/** The record of a version signed now. */
export const recordName = (version: string): string => recordNameOf(signedXpiName(version));

/**
 * The site for chatters: the folder of `SITE_BASE`, served at the root of its own host since 3.0 (the pages under
 * `SITE_BASE` redirect there; the feed and its XPIs stay where the manifest looks for them). The post and its buttons
 * point here.
 */
export const PUBLIC_SITE = 'https://chatgoose.gosling-agency.ru/';

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
  /** The owner's own test chat or channel with the bot in it: `announce --preview` posts there instead. */
  telegramPreview: 'TELEGRAM_PREVIEW_CHAT_ID',
  /** owner/repo of the hub on GitHub, for the «vendored from hub main» check (default below). */
  hubRepo: 'CG_HUB_REPO',
  /** Seconds one read of a public address may take (default below): raise it over a slow route to the server. */
  httpTimeout: 'CG_RELEASE_HTTP_TIMEOUT_S',
} as const;

/**
 * The secrets among them. A child process gets one only when its command
 * names it (`secretEnv`): `web-ext sign` gets the AMO keys, nobody gets the
 * bot token — the request to Telegram is made by this process.
 */
export const SECRET_ENV: readonly string[] = [ENV.amoKey, ENV.amoSecret, ENV.telegramToken];

/** One GET of the feed, a page or an XPI: generous, the XPI is read back whole. */
export const DEFAULT_HTTP_TIMEOUT_S = 120;

export const DEFAULT_HUB_REPO = 'goslingmanagment/hub';

/** The server of ext.gosling-agency.ru and the site folder on it (~/code/8-docs/server-inventory.md); env overrides. */
export const DEFAULT_SSH = 'root@152.53.191.242';
export const DEFAULT_REMOTE_DIR = '/var/www/ext/chat-extension';

/** The tag on origin that says a release is under way: one release at a time (lock.ts). */
export const LOCK_TAG = 'release-lock';

/** This repository on GitHub: the gate reads the CI of the release commit on its main. */
export const EXTENSION_REPO = 'goslingmanagment/chat-extension';
/**
 * The jobs of .github/workflows/ci.yml that must be green on the release commit. A PR runs `pnpm check` alone; the
 * e2e suite runs on main, and «pnpm e2e» is green only when every part of it is.
 */
export const MAIN_CI_JOBS: readonly string[] = ['pnpm check', 'pnpm e2e'];
/**
 * Git pathspecs of everything but documents (docs/, site/, changes/, *.md in the root). A push of documents alone ends its e2e
 * parts green without running them (tools/ci/e2e-needed.sh), so the gate also reads the CI of the last commit of main
 * that changed anything else.
 */
export const BEYOND_DOCUMENTS: readonly string[] = ['.', ':(exclude)docs', ':(exclude)site', ':(exclude)changes', ':(exclude,glob)*.md'];
