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
// Only these keys are touched: every other line of an existing user.js stays
// byte for byte.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const USER_JS = 'user.js';

export const DEV_PREFS: ReadonlyArray<readonly [name: string, value: boolean]> = [
  ['devtools.debugger.remote-enabled', true],
  ['devtools.chrome.enabled', true],
  ['devtools.debugger.prompt-connection', false],
  ['xpinstall.signatures.required', false],
  ['browser.translations.automaticallyPopup', false],
];

export const prefLine = (name: string, value: boolean): string => `user_pref("${name}", ${value});`;

/** A line that sets a pref: group 2 — the name, group 3 — the raw value. A commented-out line does not match. */
const PREF_LINE = /^\s*user_pref\(\s*(["'])([^"']+)\1\s*,\s*([^)]*?)\s*\)/;

/**
 * The text of a user.js that carries DEV_PREFS: a line that sets one of them to
 * another value is rewritten in place (never duplicated), a pref with no line
 * is appended, everything else is kept as it is. `''` — no file yet. Running it
 * on its own output changes nothing.
 */
export function withDevPrefs(text: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const wanted = new Map(DEV_PREFS.map(([name, value]) => [name, String(value)]));
  const present = new Set<string>();

  // Split after each line break, so a line keeps its own ending.
  const lines = text.split(/(?<=\n)/).map((line) => {
    const ending = /\r?\n$/.exec(line)?.[0] ?? '';
    const match = PREF_LINE.exec(line.slice(0, line.length - ending.length));
    const name = match?.[2];
    const want = name === undefined ? undefined : wanted.get(name);
    if (name === undefined || want === undefined) return line;
    present.add(name);
    return match?.[3] === want ? line : `${prefLine(name, want === 'true')}${ending}`;
  });

  const body = lines.join('');
  const missing = DEV_PREFS.filter(([name]) => !present.has(name)).map(([name, value]) => `${prefLine(name, value)}${eol}`);
  if (missing.length === 0) return body;
  return `${body}${body === '' || body.endsWith('\n') ? '' : eol}${missing.join('')}`;
}

export type PrefsOutcome = 'created' | 'updated' | 'unchanged';

/** Creates the profile directory when it is missing and makes its user.js carry DEV_PREFS. */
export function ensureDevPrefs(profileDir: string): PrefsOutcome {
  mkdirSync(profileDir, { recursive: true });
  const path = join(profileDir, USER_JS);
  const before = existsSync(path) ? readFileSync(path, 'utf8') : null;
  const after = withDevPrefs(before ?? '');
  if (after === before) return 'unchanged';
  writeFileSync(path, after);
  return before === null ? 'created' : 'updated';
}
