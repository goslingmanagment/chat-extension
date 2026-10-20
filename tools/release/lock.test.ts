// The lock against real git: a bare repository stands in for origin, two
// clones for two sessions.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { realExec } from './exec.ts';
import { Checkout } from './local.ts';
import { acquireLock, lockHolder, lockMessage, parseLockMessage, releaseLock } from './lock.ts';

let root = '';
afterEach(() => {
  if (root !== '') rmSync(root, { recursive: true, force: true });
  root = '';
});

function clones(): [Checkout, Checkout] {
  root = mkdtempSync(join(tmpdir(), 'cg-release-lock-'));
  const git = (cwd: string, ...args: string[]): void => void execFileSync('git', args, { cwd, stdio: 'ignore' });
  git(root, 'init', '--bare', '-q', 'origin.git');
  const make = (name: string): Checkout => {
    git(root, 'clone', '-q', join(root, 'origin.git'), name);
    const dir = join(root, name);
    git(dir, 'config', 'user.email', 'agent@example.test');
    git(dir, 'config', 'user.name', 'agent');
    return new Checkout(dir, realExec);
  };
  const one = make('one');
  git(one.root, 'commit', '-q', '--allow-empty', '-m', 'start');
  git(one.root, 'push', '-q', 'origin', 'HEAD:main');
  const two = make('two');
  git(two.root, 'checkout', '-q', 'main');
  return [one, two];
}

describe('the release lock', () => {
  it('names who and since when, and reads back', () => {
    const holder = { version: '0.5.8', by: 'dmitriy@mac/pid1', at: '2026-10-20T10:00:00.000Z' };
    expect(parseLockMessage(lockMessage(holder))).toEqual(holder);
    expect(parseLockMessage('something else')).toBeNull();
  });

  it('of two sessions the first takes it, the second is told who has it; once released it can be taken again', async () => {
    const [one, two] = clones();
    const first = { version: '0.5.8', by: 'one@mac/pid1', at: '2026-10-20T10:00:00.000Z' };
    expect(await lockHolder(one)).toBeNull();
    expect(await acquireLock(one, first)).toEqual({ ok: true });
    expect(await lockHolder(two)).toEqual(first);

    const second = await acquireLock(two, { version: '0.5.8', by: 'two@mac/pid2', at: '2026-10-20T10:11:00.000Z' });
    expect(second.ok).toBe(false);
    expect(!second.ok && second.reason).toContain('another release is under way: one@mac/pid1, releasing 0.5.8 since 2026-10-20T10:00:00.000Z');

    await releaseLock(one);
    expect(await lockHolder(two)).toBeNull();
    expect(await acquireLock(two, { version: '0.5.8', by: 'two@mac/pid2', at: '2026-10-20T10:12:00.000Z' })).toEqual({ ok: true });
    await releaseLock(two);
    expect(await lockHolder(one)).toBeNull();
  });
});
