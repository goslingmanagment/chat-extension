import { describe, expect, it } from 'vitest';
import { SoundBatchSchema } from '../src/sound';
import { TAB_REQUESTS, mayRequest } from '../src/tab-messages';
import { FROM_MAIN_FANSLY } from '../src/bridge-messages-fansly';

const message = { kind: 'message', id: '901', conversationRef: '501', senderId: '201', fromFan: true, automatic: false, tip: false, sentAt: '2026-10-15T10:00:00.000Z' };
const batch = { host: 'fansly-web', hostAccountId: '101', events: [message] };

describe('[host:fansly] sound wire (1.15.0 P14a)', () => {
  it('[SN-016] accepts bounded, text-free batches from tabs only', () => {
    expect(SoundBatchSchema.safeParse(batch).success).toBe(true);
    expect(SoundBatchSchema.safeParse({ ...batch, events: Array.from({ length: 512 }, () => message) }).success).toBe(true);
    for (const events of [[], Array.from({ length: 513 }, () => message), [{ ...message, text: 'private' }], [{ ...message, senderId: null }]]) {
      expect(SoundBatchSchema.safeParse({ ...batch, events }).success).toBe(false);
    }
    expect(mayRequest('sound.batch', 'tab', null)).toBe(true);
    expect(mayRequest('sound.batch', 'page', 'options')).toBe(false);
    expect(TAB_REQUESTS['sound.batch'].res.safeParse({ recorded: true }).success).toBe(true);
  });
  it('incoming accepts the additive author and the previous MAIN shape', () => {
    const fact = { groupId: '500', fanId: null, msgId: '900', fromFan: true, automated: false, tip: false, createdAt: null };
    expect(FROM_MAIN_FANSLY['fx.incoming'].safeParse(fact).success).toBe(true);
    expect(FROM_MAIN_FANSLY['fx.incoming'].safeParse({ ...fact, senderId: '200', accountId: '100' }).success).toBe(true);
  });
  it('presence optionally carries the host conversation, even without a known fan', () => {
    const presence = { chat: null, routeEpoch: 1, focused: true, visible: true };
    expect(TAB_REQUESTS['tab.presence'].req.safeParse(presence).success).toBe(true);
    expect(TAB_REQUESTS['tab.presence'].req.safeParse({ ...presence, conversationRef: '501' }).success).toBe(true);
  });
});
