// The models this browser has seen, including aliases supplied by a site's
// passive session owner. IDs only, durable across browser restarts; no keys
// or account headers. Bounded like the presence store.
import type { Platform } from '@cg/contracts/ids';

import type { KeyValueStore } from '../ports';

const KEY = 'sound.accounts';
const MAX = 500;
const id = (value: unknown): value is string => typeof value === 'string' && /^[0-9]{1,30}$/.test(value);

export class SoundAccounts {
  private readonly entries = new Map<string, readonly string[]>();
  private dirty = false;
  private readable = false;
  constructor(private readonly local?: KeyValueStore) {}

  async restore(): Promise<void> {
    const raw: unknown = await this.local?.get(KEY);
    this.readable = true;
    if (!Array.isArray(raw)) return;
    for (const row of raw.slice(-MAX)) {
      if (!Array.isArray(row) || typeof row[0] !== 'string' || !Array.isArray(row[1])) continue;
      this.entries.set(row[0], [...new Set([...(this.entries.get(row[0]) ?? []), ...row[1].filter(id)])].slice(0, 16));
    }
  }

  remember(platform: Platform, accountId: string, aliases: readonly string[]): void {
    const key = `${platform}:${accountId}`;
    const before = this.entries.get(key) ?? [];
    const next = [...new Set([accountId, ...before, ...aliases].filter(id))].slice(0, 16);
    if (before.join() === next.join()) return;
    this.entries.delete(key);
    this.entries.set(key, next);
    while (this.entries.size > MAX) this.entries.delete(this.entries.keys().next().value as string);
    this.dirty = true;
  }

  aliases(platform: Platform, accountId: string): readonly string[] { return this.entries.get(`${platform}:${accountId}`) ?? [accountId]; }
  has(platform: Platform, accountId: string): boolean {
    return [...this.entries].some(([key, ids]) => key.startsWith(`${platform}:`) && ids.includes(accountId));
  }
  async flush(): Promise<void> {
    if (!this.dirty || this.local === undefined) return;
    if (!this.readable) {
      try { await this.restore(); } catch { return; }
    }
    this.dirty = false;
    try { await this.local.set(KEY, [...this.entries]); }
    catch { this.dirty = true; }
  }
}
