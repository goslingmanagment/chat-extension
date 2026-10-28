// Whose account the tab acts for (Telegram spec §4.1): the active slot of `?account=N`, its session entry's `userId`
// alone; never the legacy `user_auth`, never another slot's. A wrong answer here would put a chatter's own Telegram
// under Lora's page.

import { describe, expect, it } from 'vitest';

import { accountSlotOf, activeUserIdOf, userIdOf } from './account';

const LORA = '7700100200';
const OTHER = '7700100299';
const store = (entries: Record<string, string>) => (key: string): string | null => entries[key] ?? null;
const session = (userId: unknown): string => JSON.stringify({ dcId: 2, userId, dc2_auth_key: 'secret', firstName: 'x' });

describe('the active slot', () => {
  it('is 1 without `?account=`, N for an integer N > 1, 1 for anything else', () => {
    expect(accountSlotOf('https://web.telegram.org/a/#5550001001', true)).toBe(1);
    expect(accountSlotOf('https://web.telegram.org/a/?account=2#5550001001', true)).toBe(2);
    expect(accountSlotOf('https://web.telegram.org/a/?account=1', true)).toBe(1);
    for (const raw of ['0', '-3', '2.5', 'two', '']) expect(accountSlotOf(`https://web.telegram.org/a/?account=${raw}`, true), raw).toBe(1);
  });

  it('is always 1 where the browser runs one account (no SharedWorker), as Web A reads it', () => {
    expect(accountSlotOf('https://web.telegram.org/a/?account=3', false)).toBe(1);
  });
});

describe('the active account', () => {
  const both = store({ account1: session(LORA), account2: session(OTHER), user_auth: JSON.stringify({ dcId: 2, id: LORA }) });

  it('reads the active slot only: the second account in its own tab is not Lora', () => {
    expect(activeUserIdOf('https://web.telegram.org/a/#1', true, both)).toBe(LORA);
    expect(activeUserIdOf('https://web.telegram.org/a/?account=2#1', true, both)).toBe(OTHER);
  });

  it('never falls back to the legacy `user_auth` or another slot', () => {
    const legacyOnly = store({ user_auth: JSON.stringify({ dcId: 2, id: LORA }), account1: session(LORA) });
    expect(activeUserIdOf('https://web.telegram.org/a/?account=2#1', true, legacyOnly)).toBeNull();
  });

  it('is none for a missing, empty (a passcode keeps the store in memory) or unreadable entry', () => {
    expect(activeUserIdOf('https://web.telegram.org/a/#1', true, store({}))).toBeNull();
    expect(activeUserIdOf('https://web.telegram.org/a/#1', true, store({ account1: '' }))).toBeNull();
    expect(activeUserIdOf('https://web.telegram.org/a/#1', true, store({ account1: '{not json' }))).toBeNull();
    expect(activeUserIdOf('https://web.telegram.org/a/#1', true, () => { throw new Error('denied'); })).toBeNull();
  });

  it('takes a numeric or a string id, and nothing that is not a user id', () => {
    expect(userIdOf(session(7700100200))).toBe(LORA);
    expect(userIdOf(session(LORA))).toBe(LORA);
    for (const bad of [0, -1, '0123', '12a', null, 1.5, { id: 1 }]) expect(userIdOf(session(bad)), JSON.stringify(bad)).toBeNull();
    expect(userIdOf('[1,2]')).toBeNull();
  });
});
