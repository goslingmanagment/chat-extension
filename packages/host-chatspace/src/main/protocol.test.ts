// MAIN's hand-written request checks (MAIN cannot import the contracts' schemas): a navigation's deferred insert
// may only aim at the chat the navigation opens; an attach of ours takes what the contract takes.

import { BRIDGE_REQUEST_FIXTURES } from '@cg/contracts/fixtures';
import { describe, expect, it } from 'vitest';

import { PAYLOAD } from './requests';

describe('[EX-008] MAIN request checks', () => {
  it('[NEW-01] a navigation’s deferred insert must aim at the navigation’s own account and fan', () => {
    const then = (fan: string, acc = '1001') => ({
      intentId: '00000000-0000-4000-8000-000000000011',
      operationId: '00000000-0000-4000-8000-000000000012',
      part: { index: 0 },
      target: { host: 'chatspace', hostAccountId: acc, platformFanId: fan },
      expected: { kind: 'deferred', documentEpoch: 'doc' },
      mode: 'replace',
      text: 'hi',
      confirmationId: null,
      createdAt: 1,
      expiresAt: 2,
    });
    const navigate = (fan: string | null, insert: unknown) => ({ intent: { intentId: '00000000-0000-4000-8000-000000000010', acc: '1001', fan, thenInsert: insert } });
    expect(PAYLOAD['navigate']?.(navigate('2002', then('2002')))).toBe(true);
    expect(PAYLOAD['navigate']?.(navigate('2002', then('2003')))).toBe(false);
    expect(PAYLOAD['navigate']?.(navigate('2002', then('2002', '1009')))).toBe(false);
    expect(PAYLOAD['navigate']?.(navigate(null, then('2002')))).toBe(false);
  });

  it('an attach of ours: the name the page reads, the MP3 itself within the cap, no token — as the contract fixtures say', () => {
    const { valid, invalid } = BRIDGE_REQUEST_FIXTURES.attachFile.payload;
    for (const payload of valid) expect(PAYLOAD['attachFile']?.(payload)).toBe(true);
    for (const [index, payload] of invalid.entries()) expect(PAYLOAD['attachFile']?.(payload), `invalid #${index}`).toBe(false);
  });
});
