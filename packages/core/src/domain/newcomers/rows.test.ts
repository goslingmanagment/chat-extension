import { describe, expect, it } from 'vitest';

import { greetingStatus, NO_LOCAL_GREETING } from './rows';

const NO_CLAIM = { greeting: 'none', lease: 'none', heldBy: null, custody: null } as const;
const AT = '2026-10-22T02:06:26.626Z';

describe('greetingStatus', () => {
  // 2026-10-22, Lora VIP: the welcome, then the chatter's own greeting typed in ChatSpace; the row said «Не поздоровались».
  it('a send by hand since the subscription is a greeting', () => {
    expect(greetingStatus(NO_CLAIM, NO_LOCAL_GREETING, null, false, AT)).toEqual({ s: 'greeted', at: AT });
    expect(greetingStatus(NO_CLAIM, NO_LOCAL_GREETING, null, true, AT)).toEqual({ s: 'greeted', at: AT });
  });

  it('outgoing messages alone are still no greeting', () => {
    expect(greetingStatus(NO_CLAIM, NO_LOCAL_GREETING, null, false, null)).toEqual({ s: 'none' });
  });
});
