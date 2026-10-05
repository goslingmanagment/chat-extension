// The prefs `pnpm dev` needs in its Firefox profile on macOS, kept in the
// profile's user.js (Firefox applies user.js on every start). There Firefox is
// started by LaunchServices and the build is installed over the debugger
// server (launch-macos.ts), so no web-ext writes them for us:
//  - devtools.debugger.remote-enabled, devtools.chrome.enabled — both true, or
//    Firefox ignores `-start-debugger-server`;
//  - devtools.debugger.prompt-connection=false — no "allow the incoming
//    connection?" dialog on every install;
//  - xpinstall.signatures.required=false — the unsigned test build installs;
//  - browser.translations.automaticallyPopup=false — no translation popup over
//    the page under test.
//  - chatgoose.dev.profile=<the profile's absolute path, percent-encoded> — the
//    marker by which the launcher tells that the Firefox answering on a
//    debugger port runs THIS profile before it installs anything (profile.ts).
// Only these keys are touched: every other line of an existing user.js stays
// byte for byte.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROFILE_MARKER_PREF, profileMarker } from './profile.ts';

export const USER_JS = 'user.js';

export type PrefValue = boolean | string;
export type DevPref = readonly [name: string, value: PrefValue];

export const DEV_PREFS: readonly DevPref[] = [
  ['devtools.debugger.remote-enabled', true],
  ['devtools.chrome.enabled', true],
  ['devtools.debugger.prompt-connection', false],
  ['xpinstall.signatures.required', false],
  ['browser.translations.automaticallyPopup', false],
];

/** DEV_PREFS and the marker that names this profile. */
export function devPrefsOf(profileDir: string): readonly DevPref[] {
  return [...DEV_PREFS, [PROFILE_MARKER_PREF, profileMarker(profileDir)]];
}

/** The value as user.js spells it: a bare boolean, a double-quoted string (non-ASCII as `\uXXXX`). */
export function prefLiteral(value: PrefValue): string {
  return typeof value === 'boolean' ? String(value) : JSON.stringify(value).replace(/[\u0080-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export const prefLine = (name: string, value: PrefValue): string => `user_pref("${name}", ${prefLiteral(value)});`;

/** A line that sets a pref: group 2 — the name, group 3 — the raw value. A commented-out line does not match. */
const PREF_LINE = /^\s*user_pref\(\s*(["'])([^"']+)\1\s*,\s*(.*?)\s*\)\s*;?\s*(?:\/\/.*)?$/;

/**
 * The text of a user.js that carries `prefs` (DEV_PREFS by default): a line
 * that sets one of them to another value is rewritten in place (never
 * duplicated), a pref with no line is appended, everything else is kept as it
 * is. `''` — no file yet. Running it on its own output changes nothing.
 */
export function withDevPrefs(text: string, prefs: readonly DevPref[] = DEV_PREFS): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const wanted = new Map(prefs.map(([name, value]) => [name, value]));
  const present = new Set<string>();

  // Split after each line break, so a line keeps its own ending.
  const lines = text.split(/(?<=\n)/).map((line) => {
    const ending = /\r?\n$/.exec(line)?.[0] ?? '';
    const match = PREF_LINE.exec(line.slice(0, line.length - ending.length));
    const name = match?.[2];
    const want = name === undefined ? undefined : wanted.get(name);
    if (name === undefined || want === undefined) return line;
    present.add(name);
    return match?.[3] === prefLiteral(want) ? line : `${prefLine(name, want)}${ending}`;
  });

  const body = lines.join('');
  const missing = prefs.filter(([name]) => !present.has(name)).map(([name, value]) => `${prefLine(name, value)}${eol}`);
  if (missing.length === 0) return body;
  return `${body}${body === '' || body.endsWith('\n') ? '' : eol}${missing.join('')}`;
}

export type PrefsOutcome = 'created' | 'updated' | 'unchanged';

/** Creates the profile directory when it is missing and makes its user.js carry DEV_PREFS and the profile's marker. */
export function ensureDevPrefs(profileDir: string): PrefsOutcome {
  mkdirSync(profileDir, { recursive: true });
  const path = join(profileDir, USER_JS);
  const before = existsSync(path) ? readFileSync(path, 'utf8') : null;
  const after = withDevPrefs(before ?? '', devPrefsOf(profileDir));
  if (after === before) return 'unchanged';
  writeFileSync(path, after);
  return before === null ? 'created' : 'updated';
}
