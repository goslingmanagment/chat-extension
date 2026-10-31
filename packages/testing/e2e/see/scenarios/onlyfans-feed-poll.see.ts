// The OnlyFans feed's light reads of ChatSpace (hub #955): with the page's `ofPoll` on, the hub lends this tab the
// page's poll, and the tab reads ChatSpace's own new-subscriber notifications and its sales ledger once, with the page's
// session, as ChatSpace's own client asks them. What they bring reaches the hub through the feed: a new subscriber for
// «Новые», a subscription payment and a tip for the page's money. The run's `onlyfans-feed-poll.json` has what the fake
// hub took and every request the stand answered for the two lists.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { STAND_IDS } from '../../support/stand';
import { scenario } from '../kit';

const ACC = STAND_IDS.accounts.a;
const FAN = '74001012';

scenario(
  'onlyfans-feed-poll',
  async (s) => {
    const mark = await s.stand.mark();
    await s.ready();
    await s.browser.waitUntil(
      async () => {
        const kinds = new Set((await s.hub.status()).onlyfansFeed.records.map((entry) => entry.record.kind));
        return kinds.has('subscriber') && kinds.has('ledger');
      },
      { timeout: 45_000, interval: 500, timeoutMsg: 'the fake hub got no subscriber and ledger records from the poll' },
    );
    const status = await s.hub.status();
    const reads = (await s.stand.journal(mark)).entries.filter((entry) => entry.kind === 'http' && /\/(notifications|platforms\/onlyfans\/transactions)/.test(String(entry.path)));
    writeFileSync(
      join(s.out, 'onlyfans-feed-poll.json'),
      `${JSON.stringify({ records: status.onlyfansFeed.records.filter((entry) => entry.record.kind === 'subscriber' || entry.record.kind === 'ledger'), transactions: status.onlyfansFeed.transactions, standReads: reads.map((entry) => ({ path: entry.path, status: entry.status, origin: entry.origin })) }, null, 2)}\n`,
    );
  },
  {
    before: async ({ hub, stand }) => {
      await hub.command({ op: 'config', patch: { flags: { ofFeed: true, ofPoll: true } } });
      const at = new Date(Date.now() - 5 * 60_000).toISOString();
      await stand.notification(ACC, { id: 88_001, type: 'subscribed', sub_type: 'new_subscriber', platform_fan_id: FAN, created_at: at, is_read: false, text: 'subscribed to your profile' });
      await stand.ledgerRow(ACC, { id: 'om7001', created_at: at, amount_gross: 9.99, amount_net: 7.99, description: 'Subscription from <a href="/u">Fan Linden</a>', platform_fan_id: FAN, status: null });
      await stand.ledgerRow(ACC, { id: 'om7002', created_at: new Date().toISOString(), amount_gross: 20, amount_net: 16, description: 'Tip from <a href="/u">Fan Linden</a>', platform_fan_id: FAN, status: null });
    },
  },
);
