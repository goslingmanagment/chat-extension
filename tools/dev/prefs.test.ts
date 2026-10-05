import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DEV_PREFS, devPrefsOf, ensureDevPrefs, prefLine, USER_JS, withDevPrefs } from './prefs.ts';
import { PROFILE_MARKER_PREF, profileMarker } from './profile.ts';

const ALL_FIVE = [
  'user_pref("devtools.debugger.remote-enabled", true);',
  'user_pref("devtools.chrome.enabled", true);',
  'user_pref("devtools.debugger.prompt-connection", false);',
  'user_pref("xpinstall.signatures.required", false);',
  'user_pref("browser.translations.automaticallyPopup", false);',
  '',
].join('\n');

const count = (text: string, part: string): number => text.split(part).length - 1;

describe('withDevPrefs', () => {
  it('writes all five prefs when there is no file', () => {
    expect(withDevPrefs('')).toBe(ALL_FIVE);
    expect(DEV_PREFS.map(([name, value]) => prefLine(name, value)).join('\n')).toBe(ALL_FIVE.trimEnd());
  });

  it('keeps the other prefs and adds the missing ones after them', () => {
    const existing = [
      '// written by hand',
      'user_pref("browser.startup.page", 0);',
      'user_pref("devtools.debugger.remote-enabled", true);',
      'user_pref("startup.homepage_welcome_url", "about:blank");',
      'user_pref("devtools.chrome.enabled", true);',
      '',
    ].join('\n');
    expect(withDevPrefs(existing)).toBe(
      `${existing}user_pref("devtools.debugger.prompt-connection", false);\nuser_pref("xpinstall.signatures.required", false);\nuser_pref("browser.translations.automaticallyPopup", false);\n`,
    );
  });

  it('replaces a wrong value of one of ours in place, without a second line', () => {
    const existing = ['user_pref("browser.startup.page", 0);', 'user_pref("xpinstall.signatures.required", true);', 'user_pref("signon.rememberSignons", false);', ''].join('\n');
    const result = withDevPrefs(existing);
    expect(result.startsWith('user_pref("browser.startup.page", 0);\nuser_pref("xpinstall.signatures.required", false);\nuser_pref("signon.rememberSignons", false);\n')).toBe(true);
    expect(count(result, '"xpinstall.signatures.required"')).toBe(1);
    for (const [name, value] of DEV_PREFS) expect(count(result, prefLine(name, value))).toBe(1);
  });

  it('changes nothing on a second run', () => {
    for (const text of ['', 'user_pref("a.b", 1);', 'user_pref("devtools.chrome.enabled", false);\n// tail', ALL_FIVE]) {
      const once = withDevPrefs(text);
      expect(withDevPrefs(once)).toBe(once);
    }
    expect(withDevPrefs(ALL_FIVE)).toBe(ALL_FIVE);
  });

  it('starts a new line when the file does not end with one', () => {
    expect(withDevPrefs('user_pref("a.b", 1);')).toBe(`user_pref("a.b", 1);\n${ALL_FIVE}`);
  });

  it('reads other spacing and quotes, and leaves a right value exactly as written', () => {
    const existing = "  user_pref( 'devtools.chrome.enabled' ,true ) ;\nuser_pref('devtools.debugger.prompt-connection',  true);\n";
    const result = withDevPrefs(existing);
    expect(result.startsWith("  user_pref( 'devtools.chrome.enabled' ,true ) ;\nuser_pref(\"devtools.debugger.prompt-connection\", false);\n")).toBe(true);
    expect(count(result, 'devtools.chrome.enabled')).toBe(1);
    expect(count(result, 'devtools.debugger.prompt-connection')).toBe(1);
  });

  it('fixes every line that sets one of ours, since Firefox takes the last', () => {
    const result = withDevPrefs('user_pref("devtools.chrome.enabled", true);\nuser_pref("a.b", 1);\nuser_pref("devtools.chrome.enabled", false);\n');
    expect(result.startsWith('user_pref("devtools.chrome.enabled", true);\nuser_pref("a.b", 1);\nuser_pref("devtools.chrome.enabled", true);\n')).toBe(true);
  });

  it('does not take a commented-out line for a pref', () => {
    const existing = '// user_pref("devtools.chrome.enabled", false);\n';
    const result = withDevPrefs(existing);
    expect(result.startsWith(existing)).toBe(true);
    expect(result).toContain('\nuser_pref("devtools.chrome.enabled", true);\n');
  });

  it('keeps Windows line endings', () => {
    const result = withDevPrefs('user_pref("a.b", 1);\r\nuser_pref("devtools.chrome.enabled", false);\r\n');
    expect(result.startsWith('user_pref("a.b", 1);\r\nuser_pref("devtools.chrome.enabled", true);\r\n')).toBe(true);
    expect(result.endsWith('user_pref("browser.translations.automaticallyPopup", false);\r\n')).toBe(true);
    expect(result.replaceAll('\r\n', '')).not.toContain('\n');
  });
});

describe('the marker that names the profile', () => {
  const dir = '/Users/u/Профили dev/cg (1)';
  const line = `user_pref("${PROFILE_MARKER_PREF}", "${profileMarker(dir)}");`;

  it('is one more line of user.js: the profile’s absolute path, percent-encoded, in double quotes', () => {
    expect(devPrefsOf(dir)).toEqual([...DEV_PREFS, [PROFILE_MARKER_PREF, profileMarker(dir)]]);
    expect(withDevPrefs('', devPrefsOf(dir))).toBe(`${ALL_FIVE}${line}\n`);
    expect(line).toBe('user_pref("chatgoose.dev.profile", "/Users/u/%D0%9F%D1%80%D0%BE%D1%84%D0%B8%D0%BB%D0%B8%20dev/cg%20(1)");');
  });

  it('a profile directory that was moved or copied gets its own path: the old marker is rewritten in place, once', () => {
    const copied = `${ALL_FIVE}user_pref("${PROFILE_MARKER_PREF}", "/somewhere/else (old)"); // copied with the profile\nuser_pref("a.b", 1);\n`;
    const result = withDevPrefs(copied, devPrefsOf(dir));
    expect(result).toBe(`${ALL_FIVE}${line}\nuser_pref("a.b", 1);\n`);
    expect(withDevPrefs(result, devPrefsOf(dir))).toBe(result);
    expect(count(result, PROFILE_MARKER_PREF)).toBe(1);
  });

  it('spells a string value so that user.js reads it back: quotes and backslashes escaped, non-ASCII as \\uXXXX', () => {
    expect(prefLine('x.y', 'a "b" \\ ё')).toBe('user_pref("x.y", "a \\"b\\" \\\\ \\u0451");');
    expect(prefLine('x.y', true)).toBe('user_pref("x.y", true);');
  });
});

describe('ensureDevPrefs', () => {
  let root = '';
  const marked = (profile: string): string => `${ALL_FIVE}user_pref("${PROFILE_MARKER_PREF}", "${profileMarker(profile)}");\n`;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('creates the profile directory and its user.js', () => {
    root = mkdtempSync(join(tmpdir(), 'cg-dev-prefs-'));
    const profile = join(root, 'nested', 'profile');
    expect(ensureDevPrefs(profile)).toBe('created');
    expect(readFileSync(join(profile, USER_JS), 'utf8')).toBe(marked(profile));
    expect(ensureDevPrefs(profile)).toBe('unchanged');
  });

  it('completes an existing user.js and leaves the rest of the profile alone', () => {
    root = mkdtempSync(join(tmpdir(), 'cg-dev-prefs-'));
    writeFileSync(join(root, USER_JS), 'user_pref("browser.startup.page", 0);\nuser_pref("devtools.debugger.prompt-connection", true);\n');
    writeFileSync(join(root, 'prefs.js'), '// Firefox owns this file\n');
    expect(ensureDevPrefs(root)).toBe('updated');
    const text = readFileSync(join(root, USER_JS), 'utf8');
    expect(text.startsWith('user_pref("browser.startup.page", 0);\nuser_pref("devtools.debugger.prompt-connection", false);\n')).toBe(true);
    for (const [name, value] of devPrefsOf(root)) expect(count(text, prefLine(name, value))).toBe(1);
    expect(readFileSync(join(root, 'prefs.js'), 'utf8')).toBe('// Firefox owns this file\n');
    expect(ensureDevPrefs(root)).toBe('unchanged');
    expect(existsSync(join(root, 'nested'))).toBe(false);
  });
});
