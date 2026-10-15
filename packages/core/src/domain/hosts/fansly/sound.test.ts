// Fansly's sound report as the core's one arbiter takes it (R20 P14a): the
// shared incoming fact and its author, the page's own follow. Synthetic ids.

import { IncomingFactSchema } from '@cg/contracts/host';
import { FanslySoundFactsSchema, type FanslySoundFacts, type FanslySoundMessage } from '@cg/contracts/tab-messages-fansly';
import { describe, expect, it } from 'vitest';

import { fanslySoundOf } from './sound';

const CREATOR = '700000000000000001';
const FAN = '700000000000000002';
const GROUP = '700000000000000003';
const ISO = '2026-10-15T10:00:00.000Z';
const message = (over: Partial<FanslySoundMessage> = {}): FanslySoundMessage => ({ groupId: GROUP, fanId: FAN, senderId: FAN, msgId: '700000000000000101', fromFan: true, automated: false, tip: false, createdAt: ISO, ...over });
const report = (messages: FanslySoundMessage[], follows: FanslySoundFacts['follows'] = []): FanslySoundFacts => FanslySoundFactsSchema.parse({ creatorId: CREATOR, messages, follows });

describe('[host:fansly] Fansly’s sound report as the arbiter takes it (FS-SND-1)', () => {
  it('[SN-001] [SN-005] a message is the shared fact of the creator’s account: the group’s fan, its id, its sides and the page’s time, pushed by the socket', () => {
    const heard = fanslySoundOf(report([message()]));
    expect(heard.messages).toEqual([
      {
        fact: { host: 'fansly-web', hostAccountId: CREATOR, platformFanId: FAN, platformMessageId: '700000000000000101', fromFan: true, automatic: false, tip: false, sentAt: ISO, socketEpoch: 0, fanSequence: 0, source: 'ws-tap' },
        author: FAN,
      },
    ]);
    expect(IncomingFactSchema.safeParse(heard.messages[0]?.fact).success).toBe(true);
  });

  it('[SN-002] [SN-003] [SN-004] the author is the sender — the creator’s own message, another model’s — and the automation and the tip go as the page said them', () => {
    const heard = fanslySoundOf(
      report([
        message({ msgId: '700000000000000102', fromFan: false, senderId: CREATOR, automated: true }),
        message({ msgId: '700000000000000103', senderId: '700000000000000009', fanId: '700000000000000009' }),
        message({ msgId: '700000000000000104', tip: true }),
      ]),
    );
    expect(heard.messages.map(({ fact, author }) => [fact.platformMessageId, fact.fromFan, fact.automatic, fact.tip, author])).toEqual([
      ['700000000000000102', false, true, false, CREATOR],
      ['700000000000000103', true, false, false, '700000000000000009'],
      ['700000000000000104', true, false, true, FAN],
    ]);
  });

  it('[SN-001] a group MAIN does not know yet is still its sender’s chat; a MAIN of an older build names no sender — the fan’s message is the fan’s; a message of no named chat is left out', () => {
    const heard = fanslySoundOf(
      report([
        message({ msgId: '700000000000000105', fanId: null }),
        message({ msgId: '700000000000000106', senderId: undefined }),
        message({ msgId: '700000000000000107', fanId: null, senderId: undefined }),
        message({ msgId: '700000000000000108', fromFan: false, senderId: undefined }),
      ]),
    );
    expect(heard.messages.map(({ fact, author }) => [fact.platformMessageId, fact.platformFanId, author])).toEqual([
      ['700000000000000105', FAN, FAN],
      ['700000000000000106', FAN, FAN],
      ['700000000000000108', FAN, null],
    ]);
  });

  it('[SN-012] a follow is a subscriber the creator’s page heard itself: the event, the account followed, the follower', () => {
    expect(fanslySoundOf(report([], [{ eventId: '700000000000000201', accountId: CREATOR, followerId: FAN }])).follows).toEqual([
      { host: 'fansly-web', hostAccountId: CREATOR, eventId: '700000000000000201', accountId: CREATOR, followerId: FAN },
    ]);
  });
});
