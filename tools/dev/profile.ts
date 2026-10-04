// Where `pnpm dev` keeps its Firefox profile. Default: `.dev-profile/` in the
// repo (gitignored). `CG_DEV_PROFILE` names another directory — the owner's
// durable profile lives outside the repo and its worktrees, so it survives a
// removed worktree and keeps the ChatSpace sign-in (X9). A leading `~` is the
// home directory; a relative path is taken from the repo root.

import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export const DEFAULT_DEV_PROFILE = '.dev-profile';
export const DEV_PROFILE_ENV = 'CG_DEV_PROFILE';

export function devProfileDir(repoRoot: string, env: Readonly<Record<string, string | undefined>> = process.env, home: string = homedir()): string {
  const raw = env[DEV_PROFILE_ENV]?.trim();
  if (raw === undefined || raw === '') return join(repoRoot, DEFAULT_DEV_PROFILE);
  if (raw === '~') return home;
  if (raw.startsWith('~/')) return join(home, raw.slice(2));
  return isAbsolute(raw) ? raw : resolve(repoRoot, raw);
}
