// Where the release finds its keys. Whatever the environment already has wins;
// what it lacks is read from the owner's env files, first that has it:
//
//   ~/.config/agency/secrets.env                 the agency-wide file, when it exists
//   ~/code/1-platform/fansly-chat/.env.deploy    where the AMO keys live today
//
// Only the release's own variables are taken (config.ts `ENV`); no value is
// ever printed — `loadReleaseEnv` reports names and files only. The server
// address and folder are no secret and have defaults (config.ts).
//
// `op://fansly/Mozilla` in 1Password is the AMO website login, not the API keys.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DEFAULT_REMOTE_DIR, DEFAULT_SSH, ENV } from './config.ts';

/** The variables an env file may hand the release. */
export const FILE_VARIABLES: readonly string[] = [ENV.amoKey, ENV.amoSecret, ENV.telegramToken, ENV.telegramChannel, ENV.ssh, ENV.remoteDir];

export const envFiles = (home: string): readonly string[] => [join(home, '.config/agency/secrets.env'), join(home, 'code/1-platform/fansly-chat/.env.deploy')];

/** `KEY=value` and `export KEY=value` lines; quotes around a value are dropped; comments and anything else are skipped. */
export function parseEnvFile(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(raw);
    if (match === null) continue;
    let value = match[2] ?? '';
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) value = value.slice(1, -1);
    out.set(match[1] ?? '', value);
  }
  return out;
}

export interface LoadedEnv {
  readonly env: Record<string, string | undefined>;
  /** Which variable came from which file (names only). */
  readonly loaded: ReadonlyArray<{ readonly name: string; readonly file: string }>;
}

export function loadReleaseEnv(base: Readonly<Record<string, string | undefined>>, files: readonly string[], read: (path: string) => string | null = readIfExists): LoadedEnv {
  const env: Record<string, string | undefined> = { ...base };
  const loaded: Array<{ name: string; file: string }> = [];
  const parsed = files.flatMap((file) => {
    const text = read(file);
    return text === null ? [] : [{ file, values: parseEnvFile(text) }];
  });
  for (const name of FILE_VARIABLES) {
    if (env[name] !== undefined && env[name] !== '') continue;
    const from = parsed.find((entry) => (entry.values.get(name) ?? '') !== '');
    if (from === undefined) continue;
    env[name] = from.values.get(name);
    loaded.push({ name, file: from.file });
  }
  if ((env[ENV.ssh] ?? '') === '') env[ENV.ssh] = DEFAULT_SSH;
  if ((env[ENV.remoteDir] ?? '') === '') env[ENV.remoteDir] = DEFAULT_REMOTE_DIR;
  return { env, loaded };
}

function readIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}
