// The update feed (UP-001): the `updates.json` Firefox reads from the
// manifest's `update_url`. It names ONE version — the current one — with the
// address of its signed XPI and the XPI's sha256; Firefox installs it when it
// is higher than what is installed and the hash matches. No I/O here.

import { signedXpiName, signedXpiNames, type ReleaseTarget } from './config.ts';
import { isVersion } from './version.ts';

export interface FeedEntry {
  readonly version: string;
  readonly updateLink: string;
  /** Hex, without the `sha256:` prefix. */
  readonly sha256: string;
  readonly strictMinVersion: string;
}

const SHA256_RE = /^[0-9a-f]{64}$/;
const HASH_RE = /^sha256:[0-9a-f]{64}$/;
/** https, or the loopback server of the tool's own tests. */
const LINK_RE = /^(?:https:\/\/|http:\/\/127\.0\.0\.1[:/])/;

/** `file` — the signed XPI as its record names it: today's name, or the old one of a version signed before the rename. */
export function feedEntryFor(target: ReleaseTarget, version: string, sha256: string, file: string = signedXpiName(version)): FeedEntry {
  if (!isVersion(version)) throw new Error(`feed: "${version}" is not a version.`);
  if (!SHA256_RE.test(sha256)) throw new Error(`feed: "${sha256}" is not a sha256.`);
  if (!signedXpiNames(version).includes(file)) throw new Error(`feed: "${file}" is no name of the signed XPI of ${version}.`);
  return { version, updateLink: `${target.feedBase}${file}`, sha256, strictMinVersion: target.strictMinVersion };
}

/** The exact bytes of updates.json for one entry. */
export function renderFeed(geckoId: string, entry: FeedEntry): string {
  const feed = {
    addons: {
      [geckoId]: {
        updates: [
          {
            version: entry.version,
            update_link: entry.updateLink,
            update_hash: `sha256:${entry.sha256}`,
            applications: { gecko: { strict_min_version: entry.strictMinVersion } },
          },
        ],
      },
    },
  };
  return `${JSON.stringify(feed, null, 2)}\n`;
}

/**
 * What a served feed offers to this add-on. Throws on anything that is not a
 * feed of ours with exactly one entry: the caller must not guess.
 */
export function parseFeed(text: string, geckoId: string): FeedEntry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('feed: not JSON.');
  }
  const addon = (parsed as { addons?: Record<string, { updates?: unknown }> } | null)?.addons?.[geckoId];
  if (addon === undefined) throw new Error(`feed: no entry for ${geckoId}.`);
  const updates = addon.updates;
  if (!Array.isArray(updates) || updates.length !== 1) throw new Error(`feed: exactly one update is expected, found ${Array.isArray(updates) ? updates.length : 'none'}.`);
  const update = updates[0] as { version?: unknown; update_link?: unknown; update_hash?: unknown; applications?: { gecko?: { strict_min_version?: unknown } } };
  const { version, update_link: updateLink, update_hash: updateHash } = update;
  const strictMinVersion = update.applications?.gecko?.strict_min_version;
  if (typeof version !== 'string' || !isVersion(version)) throw new Error(`feed: version ${JSON.stringify(version)} is not X.Y.Z.`);
  if (typeof updateLink !== 'string' || !LINK_RE.test(updateLink)) throw new Error(`feed: update_link ${JSON.stringify(updateLink)} is not an https address.`);
  if (typeof updateHash !== 'string' || !HASH_RE.test(updateHash)) throw new Error(`feed: update_hash ${JSON.stringify(updateHash)} is not sha256:<hex>.`);
  if (typeof strictMinVersion !== 'string' || strictMinVersion === '') throw new Error('feed: no applications.gecko.strict_min_version.');
  return { version, updateLink, sha256: updateHash.slice('sha256:'.length), strictMinVersion };
}

/** Human-readable differences between what is served and what was meant to be; [] — the same. */
export function feedDifferences(served: FeedEntry, expected: FeedEntry): string[] {
  const out: string[] = [];
  if (served.version !== expected.version) out.push(`version ${served.version}, expected ${expected.version}`);
  if (served.updateLink !== expected.updateLink) out.push(`update_link ${served.updateLink}, expected ${expected.updateLink}`);
  if (served.sha256 !== expected.sha256) out.push(`update_hash sha256:${served.sha256}, expected sha256:${expected.sha256}`);
  if (served.strictMinVersion !== expected.strictMinVersion) out.push(`strict_min_version ${served.strictMinVersion}, expected ${expected.strictMinVersion}`);
  return out;
}
