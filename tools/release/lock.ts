// One release at a time. The lock is the annotated tag `release-lock` on
// origin: pushing a tag that already exists there is refused, so of two
// sessions that start a release only the first gets it, and the second reads
// who holds it and since when. The tag's message names the holder, the
// version and the time; nothing else is in it. A release removes the tag when
// it ends, well or not; a process that died leaves it — `pnpm release unlock`.

import { LOCK_TAG } from './config.ts';
import type { Checkout } from './local.ts';

export interface LockHolder {
  readonly version: string;
  readonly by: string;
  readonly at: string;
}

export function lockMessage(holder: LockHolder): string {
  return `release ${holder.version} by ${holder.by} at ${holder.at}`;
}

export function parseLockMessage(text: string): LockHolder | null {
  const match = /^release (\S+) by (\S+) at (\S+)$/m.exec(text.trim());
  return match === null ? null : { version: match[1] ?? '', by: match[2] ?? '', at: match[3] ?? '' };
}

const REF = `refs/tags/${LOCK_TAG}`;

/** Who holds the lock on origin; null — nobody. */
export async function lockHolder(checkout: Checkout): Promise<LockHolder | { readonly unreadable: string } | null> {
  if ((await checkout.git('ls-remote', 'origin', REF)) === '') return null;
  await checkout.git('fetch', '--quiet', '--no-tags', 'origin', `+${REF}:${REF}`);
  const text = await checkout.git('tag', '-l', '--format=%(contents)', LOCK_TAG);
  return parseLockMessage(text) ?? { unreadable: text.split('\n')[0] ?? '' };
}

export function describeHolder(holder: LockHolder | { readonly unreadable: string }): string {
  return 'unreadable' in holder ? `a lock with an unknown message («${holder.unreadable}»)` : `${holder.by}, releasing ${holder.version} since ${holder.at}`;
}

/** Takes the lock, or says who has it. */
export async function acquireLock(checkout: Checkout, holder: LockHolder): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }> {
  await checkout.git('tag', '-f', '-a', LOCK_TAG, '-m', lockMessage(holder), 'HEAD');
  const push = await checkout.exec({ program: 'git', args: ['push', '--quiet', 'origin', REF], cwd: checkout.root });
  if (push.code === 0) return { ok: true };
  await checkout.gitCode('tag', '-d', LOCK_TAG);
  const other = await lockHolder(checkout).catch(() => null);
  if (other !== null) return { ok: false, reason: `another release is under way: ${describeHolder(other)}. Wait for it; if that session is gone, pnpm release unlock` };
  return { ok: false, reason: `could not push the lock tag to origin: ${push.stderr.trim().split('\n').at(-1) ?? `exit ${push.code}`}` };
}

/** Drops the lock on origin and here. */
export async function releaseLock(checkout: Checkout): Promise<void> {
  const push = await checkout.exec({ program: 'git', args: ['push', '--quiet', 'origin', `:${REF}`], cwd: checkout.root });
  await checkout.gitCode('tag', '-d', LOCK_TAG);
  if (push.code !== 0) throw new Error(`could not remove the lock tag on origin (${push.stderr.trim().split('\n').at(-1) ?? `exit ${push.code}`}): pnpm release unlock`);
}
