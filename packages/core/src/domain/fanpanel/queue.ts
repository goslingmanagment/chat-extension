// «Очередь» of the fan panel (Chat Memory week 3): who a row names and why a fan is on the win-back list. Pure: the
// controller reads the hub and the clock.

import { WIN_BACK_REASONS } from '@cg/contracts/hub';
import { type Msg } from '@cg/contracts/vm';

const DAY_MS = 86_400_000;

export interface QueueFanNames {
  readonly fanRef: string;
  readonly alias?: string | null | undefined;
  readonly displayName?: string | null | undefined;
  readonly username: string | null;
}

/**
 * The name of a row: the team's alias as it is (it carries the 💵 / ❌ marks), else the fan's name, else «@username»,
 * else the id. `username` — «@username» to show beside a name that is not it.
 */
export function queueName(fan: QueueFanNames): { readonly name: string; readonly username: string | null } {
  const alias = fan.alias?.trim() ?? '';
  const display = fan.displayName?.trim() ?? '';
  const handle = fan.username === null || fan.username === '' ? null : `@${fan.username}`;
  const name = alias !== '' ? alias : display !== '' ? display : null;
  if (name !== null) return { name, username: handle };
  return { name: handle ?? fan.fanRef, username: null };
}

/**
 * Why the fan is listed, said in days from now: «подписка кончается через 2 дн» (the days left, rounded up: what ends
 * in 30 hours ends in 2 days), «новый, никто не написал», «молчит 16 дн» (whole days of silence). null — a reason this
 * build does not know, or a time it needs and the hub did not give.
 */
export function winBackReason(reason: string, reasonAt: string | null, now: number): Msg | null {
  if (!(WIN_BACK_REASONS as readonly string[]).includes(reason)) return null;
  if (reason === 'new_unattended') return { key: 'queue.reason.new' };
  const at = reasonAt === null ? Number.NaN : Date.parse(reasonAt);
  if (Number.isNaN(at)) return null;
  if (reason === 'expiring') {
    const days = Math.ceil((at - now) / DAY_MS);
    return days <= 0 ? { key: 'queue.reason.expiringToday' } : { key: 'queue.reason.expiring', params: { days } };
  }
  return { key: 'queue.reason.silent', params: { days: Math.max(0, Math.floor((now - at) / DAY_MS)) } };
}
