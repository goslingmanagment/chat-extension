// Where `pnpm dev` keeps its Firefox profile, which debugger port belongs to
// it, and how a running Firefox is told to be the one of this profile.
//
// The directory. Default: `.dev-profile/` in the repo (gitignored).
// `CG_DEV_PROFILE` names another one — the owner's durable profile lives
// outside the repo and its worktrees, so it survives a removed worktree and
// keeps the ChatSpace sign-in (X9). A leading `~/` is the home directory; a
// relative path is taken from the repo root. Never the home directory itself
// and never a directory of Firefox's own profiles: `pnpm dev` writes prefs
// into the profile's user.js and installs an unsigned build into it.
//
// The port. One profile — one port: the default is derived from the absolute
// path of the profile (a stable hash into the private range), so two profiles
// — two worktrees, a worktree and the owner's durable profile — never share a
// port by default.
//
// The identity. A port that answers is NOT taken for our dev Firefox: the
// launcher asks the Firefox behind it which profile it runs before it installs
// anything (rdp.ts), and refuses another one. The exact answer is a marker
// pref this launcher keeps in the profile's user.js — the absolute path of the
// profile; a Firefox started before the marker existed is told by the name of
// its profile directory, which is what Firefox itself reports.

import { homedir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const DEFAULT_DEV_PROFILE = '.dev-profile';
export const DEV_PROFILE_ENV = 'CG_DEV_PROFILE';

/** The IANA private (dynamic) range: nothing is registered there. */
export const DEV_PORT_FIRST = 49_152;
export const DEV_PORT_COUNT = 65_536 - DEV_PORT_FIRST;

/** The pref of the profile's user.js that names the profile: `profileMarker(dir)`. */
export const PROFILE_MARKER_PREF = 'chatgoose.dev.profile';

/** Directories whose children are Firefox's own profiles (the person's real ones), under the home directory. */
const FIREFOX_PROFILE_ROOTS: ReadonlyArray<readonly string[]> = [
  ['Library', 'Application Support', 'Firefox'],
  ['Library', 'Caches', 'Firefox'],
  ['.mozilla', 'firefox'],
  ['snap', 'firefox'],
  ['.var', 'app', 'org.mozilla.firefox'],
  ['AppData', 'Roaming', 'Mozilla', 'Firefox'],
];

/** `inside` is `outer` or below it. Case is ignored: the default macOS and Windows volumes do not tell it apart. */
function within(inside: string, outer: string): boolean {
  const path = relative(outer.toLowerCase(), inside.toLowerCase());
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

/**
 * Why `dir` may not be a dev profile, or null. Refused: the home directory (or anything above it — the profile
 * would be the person's whole disk), and Firefox's own profile directories — a signed-in everyday profile is
 * never a place to install an unsigned test build into.
 */
export function devProfileRefusal(dir: string, home: string = homedir()): string | null {
  const path = resolve(dir);
  if (within(home, path)) return `"${path}" is the home directory (or above it), not a Firefox profile — name a directory of its own, e.g. ~/Documents/ChatGoose/firefox-dev-profile.`;
  for (const parts of FIREFOX_PROFILE_ROOTS) {
    const root = join(home, ...parts);
    if (within(path, root)) return `"${path}" is inside Firefox's own profiles (${root}) — a dev profile must be a separate directory, never a profile you browse with.`;
  }
  return null;
}

export function devProfileDir(repoRoot: string, env: Readonly<Record<string, string | undefined>> = process.env, home: string = homedir()): string {
  const raw = env[DEV_PROFILE_ENV]?.trim();
  const named = raw !== undefined && raw !== '';
  const dir = !named ? join(repoRoot, DEFAULT_DEV_PROFILE) : raw === '~' ? home : raw.startsWith('~/') ? join(home, raw.slice(2)) : isAbsolute(raw) ? resolve(raw) : resolve(repoRoot, raw);
  const refusal = devProfileRefusal(dir, home);
  if (refusal !== null) throw new Error(`${named ? DEV_PROFILE_ENV : 'the dev profile'}: ${refusal}`);
  return dir;
}

/** FNV-1a, 32 bit, over the UTF-8 bytes. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (const byte of Buffer.from(text, 'utf8')) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** The debugger port that belongs to a profile by default: stable for its absolute path, in the private range. */
export function devDebuggerPort(profileDir: string): number {
  return DEV_PORT_FIRST + (fnv1a(resolve(profileDir)) % DEV_PORT_COUNT);
}

/** What the marker pref of a profile holds: its absolute path, percent-encoded (pure ASCII, whatever the path). */
export function profileMarker(profileDir: string): string {
  return encodeURI(resolve(profileDir));
}

/** What a running Firefox says about its profile over the debugger (rdp.ts). */
export interface RunningProfile {
  /** The value of PROFILE_MARKER_PREF there; null — the pref is not set (a Firefox started before the marker existed, or not ours at all). */
  readonly marker: string | null;
  /** The device description's `profile`: the name of the profile directory (of a named profile — its name); null — not told. */
  readonly name: string | null;
}

export type ProfileCheck =
  /** `exact` — by the marker (the absolute path); false — only by the directory's name. */
  | { readonly same: true; readonly exact: boolean }
  /** `running` — the other profile, as far as it could be told. */
  | { readonly same: false; readonly running: string };

function decoded(marker: string): string {
  try {
    return decodeURI(marker);
  } catch {
    return marker;
  }
}

/** Whether the Firefox that answered runs `profileDir`. */
export function checkRunningProfile(running: RunningProfile, profileDir: string): ProfileCheck {
  if (running.marker !== null && running.marker !== '') {
    return running.marker === profileMarker(profileDir) ? { same: true, exact: true } : { same: false, running: decoded(running.marker) };
  }
  if (running.name !== null && running.name !== '' && running.name === basename(resolve(profileDir))) return { same: true, exact: false };
  return { same: false, running: running.name === null || running.name === '' ? 'a profile it does not name' : `a profile named "${running.name}"` };
}
