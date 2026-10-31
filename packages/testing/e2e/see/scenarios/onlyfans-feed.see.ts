// The OnlyFans feed (hub #953): OnlyFansAPI is gone, and the hub's archive, chats and money come from what the
// chatter's ChatSpace already received. Fan Kestrel writes over ChatSpace's socket, the model's PPV goes out and
// Kestrel buys it: the tab passes all three on — no request of its own — the fake hub's archive and transactions take
// them, the fan's preview in Spenders shows the message, and a Reply reads it from the archive. What the fake hub took
// and what the Reply read are in the run's `onlyfans-feed.json`.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { STAND_IDS } from '../../support/stand';
import { around, scenario } from '../kit';

const ACC = STAND_IDS.accounts.a;
/** Fan Kestrel of account a: not the open chat, on the board. */
const FAN = '74001011';
const TEXT = 'Скинь тот сет, хочу посмотреть 😍';

scenario(
  'onlyfans-feed',
  async (s) => {
    await s.ready();
    const said = await s.stand.fanMessage(ACC, FAN, TEXT);
    const ppv = await s.stand.paidMessage(ACC, FAN, 25);
    // ChatSpace's socket says the fan bought it, as OnlyMonster's backend does.
    await s.stand.wsFrame(
      {
        event: 'account_fan_ppv_purchased',
        account: { account_id: ACC, platform: 'onlyfans', platform_account_id: STAND_IDS.platformAccounts.a, platform_id: 1 },
        fan_id: FAN,
        content_type: 'message',
        content_id: ppv,
        price_gross: 25,
      },
      ACC,
    );
    await s.browser.waitUntil(
      async () => {
        const feed = (await s.hub.status()).onlyfansFeed;
        return feed.transactions.some((row) => row.transactionId.includes(ppv)) && feed.records.some((entry) => entry.record.kind === 'message' && entry.record.messageRef === said);
      },
      { timeout: 30_000, interval: 500, timeoutMsg: 'the fake hub got no feed of the message and the purchase' },
    );

    await s.leaveField();
    await s.keys(...s.PANEL, 'm');
    await s.see('modal', 'Fan Kestrel', 20_000);
    await s.press(/^Fan Kestrel/, 'modal', '[data-cg-key^="fan:"]');
    await s.see('modal', TEXT, 20_000);
    // The fan's row and the preview under it, down to its composer: the messages the feed brought are between.
    const boxes = [await s.rect('modal', '[data-cg-key^="fan:"]'), await s.rect('modal', '.cg-pv')].filter((box) => box !== null);
    await s.shot('onlyfans-feed-preview', boxes.length < 2 ? {} : { clip: around(boxes, 8), file: 'onlyfans-feed-preview' });
    await s.press(/^Reply/, 'modal', '.cg-pv button');
    await s.see('modal', 'Ещё раз', 30_000);
    await s.shot('onlyfans-feed-reply');

    const status = await s.hub.status();
    const ours = status.onlyfansFeed.records.filter((entry) => ('fanRef' in entry.record && entry.record.fanRef === FAN) || ('contentRef' in entry.record && entry.record.contentRef === ppv));
    writeFileSync(
      join(s.out, 'onlyfans-feed.json'),
      `${JSON.stringify({ message: said, ppv, records: ours, transactions: status.onlyfansFeed.transactions, aiRead: status.aiReads.filter((read) => read.ref === FAN).at(-1) ?? null }, null, 2)}\n`,
    );
  },
  {
    previewSend: true,
    before: async ({ hub }) => {
      // The owner's switch of the feed, on every OnlyFans page (the `"*"` row).
      await hub.command({ op: 'config', patch: { flags: { ofFeed: true } } });
    },
  },
);
